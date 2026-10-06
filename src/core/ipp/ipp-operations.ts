import { PDF_LIMITS } from '../pdf/pdf-model';
import { AUTO_FORMAT, type DocumentFormat, isSupportedFormat, sniffFormat } from './document-format';
import {
  booleanValue,
  charsetAttr,
  findAttribute,
  integerValue,
  keywordAttr,
  languageAttr,
  mimeTypeAttr,
  stringValue,
  stringValues,
  textAttr,
} from './ipp-attributes';
import type { IppAttribute, IppGroup, IppMessage, IppVersion } from './ipp-codec';
import { GROUP_TAGS, IPP_CHARSET, IPP_LANGUAGE, OPERATIONS, STATUS } from './ipp-constants';
import { type IppJob, type IppJobBook, type JobContext, jobAttributes, jobIdFromUri } from './ipp-job-book';
import { IPP_COPIES_MAX, type PrinterContext, printerAttributes, selectAttributes } from './printer-attributes';
import type { SharedPrinter } from './shared-printer';

/** 这台电脑对来请求的电脑的态度：allowed = 记住了允许；denied = 记住了拒绝；ask = 第一次来，打印前要问操作员。 */
export type ClientDecision = 'allowed' | 'denied' | 'ask';

/** 处理一个请求要用到的、请求之外的东西。 */
export interface IppRequestContext {
  /** 网址指向的共享打印机；没有这台（纸张不再分配打印机）时为 null。 */
  printer: SharedPrinter | null;
  /** 按对方请求时用的主机拼的网址。 */
  printerUri: string;
  moreInfoUri: string;
  /** basic = 设了共享密码。 */
  authentication: 'none' | 'basic';
  /** 对方的 IPv4 地址。 */
  client: string;
  decision: ClientDecision;
  book: IppJobBook;
  /** POST 到任务网址（/printers/60x40/jobs/12）时网址里的编号。 */
  pathJobId: number | null;
  /** 共享服务启动的时刻和现在（毫秒）。 */
  startedAt: number;
  nowMs: number;
}

/** 收下的文档：认出来的格式、字节、份数（1–99）。 */
export interface AcceptedDocument {
  format: DocumentFormat;
  data: Uint8Array;
  copies: number;
}

/** Print-Job 收下的任务和文档。 */
export interface AcceptedPrint {
  job: IppJob;
  document: AcceptedDocument;
  /** 新电脑：处理之前先等操作员允许。 */
  needsApproval: boolean;
}

/** 一个请求的结果：要回的报文，和（Print-Job 时）收下的文档。 */
export interface IppOutcome {
  response: IppMessage;
  /** Print-Job 收下了文档；其余为 null。 */
  accepted: AcceptedPrint | null;
}

/** 任务名最多 100 个字（和 PDF 打印的文件名一样，打印记录里要放下）；用户名 64 个字，一行放得下。 */
const JOB_NAME_CHARS = PDF_LIMITS.fileNameChars;
const USER_NAME_CHARS = 64;
const MS_PER_SECOND = 1_000;
/** 对方没给任务名时，打印记录里显示的名字。 */
export const UNTITLED_JOB = '未命名文档';
const SUPPORTED_CHARSETS: ReadonlySet<string> = new Set(['utf-8', 'us-ascii']);
const VERSION_1: IppVersion = { major: 1, minor: 1 };
const VERSION_2: IppVersion = { major: 2, minor: 0 };
/**
 * 收下不报错的任务属性：纸就是这台共享打印机的纸，方向、颜色、质量、分辨率、缩放由程序按纸和打印机决定，
 * 客户端照例都会带这些，一律接受。份数和单双面另外核对。
 */
const ACCEPTED_JOB_ATTRIBUTES: ReadonlySet<string> = new Set([
  'media',
  'media-col',
  'orientation-requested',
  'print-color-mode',
  'print-quality',
  'printer-resolution',
  'print-scaling',
  'print-content-optimize',
  'print-rendering-intent',
  'output-bin',
  'finishings',
  'multiple-document-handling',
  'job-priority',
]);
/** Get-Jobs 默认只给这两项（RFC 8011 §4.2.6.1）。 */
const DEFAULT_JOB_LIST_ATTRIBUTES = ['job-id', 'job-uri'];
/** Print-Job 回复里的任务属性（RFC 8011 §4.2.1.2）。 */
const PRINT_JOB_REPLY_ATTRIBUTES = ['job-id', 'job-uri', 'job-state', 'job-state-reasons', 'job-state-message'];
/**
 * 名字里去掉的字符：控制字符（Cc，含 C1）和格式字符（Cf：双向文字控制 U+202A–202E、U+2066–2069，
 * 零宽字符、软连字符等）。名字是对方自己填的，格式字符能让它在界面上显示成另一个样子。
 */
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/** 给对方电脑看的原因（status-message 最长 255 字节：每句不超过 80 个字）。 */
export const IPP_MESSAGES = {
  badRequest: '请求格式不对',
  version: '只支持 IPP 1.1 和 2.0',
  charset: '只支持 UTF-8',
  operation: '不支持这个操作',
  noPrinter: '没有这台共享打印机：它的纸张可能已经不再分配打印机',
  noPrinterUri: '请求里缺少 printer-uri',
  format: '只能打印 PDF、JPEG、PNG 和 PWG / URF 光栅',
  formatMismatch: '文档的内容和声明的格式不一致',
  compression: '不支持压缩的文档',
  noDocument: '没有收到文档',
  denied: '这台电脑没有被允许使用共享打印机：请那台电脑上的操作员在「局域网共享」页撤销拒绝',
  busy: '共享打印机正忙：稍后再试',
  clientBusy: '这台电脑交来的任务还没处理完：稍后再试',
  attributes: '有不支持的打印设置',
  noJob: '没有这个任务',
  notOwner: '只能取消自己电脑交来的任务',
  finished: '任务已经结束',
  whichJobs: 'which-jobs 只支持 completed 和 not-completed',
} as const;

interface Call {
  request: IppMessage;
  operation: readonly IppAttribute[];
  version: IppVersion;
  context: IppRequestContext;
}

interface JobRequest {
  name: string;
  user: string;
  declaredFormat: string;
  copies: number;
  unsupported: IppAttribute[];
}

/**
 * 处理一个 IPP 请求：Get-Printer-Attributes、Validate-Job、Print-Job、Get-Jobs、Get-Job-Attributes、Cancel-Job。
 * data 是属性之后的文档字节（只有 Print-Job 用）。请求不可信：每一项都核对，不对就回对应的状态码和中文原因。
 */
export function handleIppRequest(request: IppMessage, data: Uint8Array, context: IppRequestContext): IppOutcome {
  const version = request.version.major === 1 ? VERSION_1 : request.version.major === 2 ? VERSION_2 : null;
  if (version === null) {
    return reply(failure(VERSION_2, request.requestId, STATUS.versionNotSupported, IPP_MESSAGES.version));
  }
  const envelope = checkEnvelope(request);
  if (envelope !== null) {
    return reply(failure(version, request.requestId, envelope.status, envelope.message));
  }
  const call: Call = { request, operation: request.groups[0]?.attributes ?? [], version, context };
  switch (request.code) {
    case OPERATIONS.getPrinterAttributes:
      return reply(getPrinterAttributes(call));
    case OPERATIONS.validateJob:
      return reply(validateJob(call));
    case OPERATIONS.printJob:
      return printJob(call, data);
    case OPERATIONS.getJobs:
      return reply(getJobs(call));
    case OPERATIONS.getJobAttributes:
      return reply(getJobAttributes(call));
    case OPERATIONS.cancelJob:
      return reply(cancelJob(call));
    default:
      return reply(failure(version, request.requestId, STATUS.operationNotSupported, IPP_MESSAGES.operation));
  }
}

function reply(response: IppMessage): IppOutcome {
  return { response, accepted: null };
}

/** RFC 8011 §4.1.4：第一组是操作属性，前两个依次是 attributes-charset、attributes-natural-language；请求编号 1–2^31-1。 */
function checkEnvelope(request: IppMessage): { status: number; message: string } | null {
  const first = request.groups[0];
  const charset = first?.attributes[0];
  const language = first?.attributes[1];
  if (
    request.requestId < 1 ||
    first?.tag !== GROUP_TAGS.operation ||
    charset?.name !== 'attributes-charset' ||
    language?.name !== 'attributes-natural-language'
  ) {
    return { status: STATUS.badRequest, message: IPP_MESSAGES.badRequest };
  }
  const charsetName = stringValue(charset)?.toLowerCase();
  if (charsetName === undefined || !SUPPORTED_CHARSETS.has(charsetName)) {
    return { status: STATUS.charsetNotSupported, message: IPP_MESSAGES.charset };
  }
  return null;
}

function response(
  version: IppVersion,
  requestId: number,
  status: number,
  message: string | null,
  groups: IppGroup[] = [],
): IppMessage {
  const operation = [
    charsetAttr('attributes-charset', IPP_CHARSET),
    languageAttr('attributes-natural-language', IPP_LANGUAGE),
  ];
  if (message !== null) {
    operation.push(textAttr('status-message', message));
  }
  return {
    version,
    code: status,
    requestId,
    groups: [{ tag: GROUP_TAGS.operation, attributes: operation }, ...groups],
  };
}

function failure(
  version: IppVersion,
  requestId: number,
  status: number,
  message: string,
  unsupported: IppAttribute[] = [],
): IppMessage {
  return response(version, requestId, status, message, unsupportedGroups(unsupported));
}

function unsupportedGroups(unsupported: IppAttribute[]): IppGroup[] {
  return unsupported.length > 0 ? [{ tag: GROUP_TAGS.unsupported, attributes: unsupported }] : [];
}

function fail(call: Call, status: number, message: string, unsupported: IppAttribute[] = []): { failure: IppMessage } {
  return { failure: failure(call.version, call.request.requestId, status, message, unsupported) };
}

/** 要找打印机的操作先核对：请求里有 printer-uri（或 job-uri），网址指向的共享打印机在。 */
function targetPrinter(call: Call): { printer: SharedPrinter } | { failure: IppMessage } {
  if (
    findAttribute(call.operation, 'printer-uri') === undefined &&
    findAttribute(call.operation, 'job-uri') === undefined
  ) {
    return fail(call, STATUS.badRequest, IPP_MESSAGES.noPrinterUri);
  }
  if (call.context.printer === null) {
    return fail(call, STATUS.notFound, IPP_MESSAGES.noPrinter);
  }
  return { printer: call.context.printer };
}

function printerContextOf(context: IppRequestContext): PrinterContext {
  return {
    printerUri: context.printerUri,
    moreInfoUri: context.moreInfoUri,
    authentication: context.authentication,
    upTimeSeconds: Math.max(0, Math.floor((context.nowMs - context.startedAt) / MS_PER_SECOND)),
    nowMs: context.nowMs,
  };
}

function jobContextOf(context: IppRequestContext): JobContext {
  return { printerUri: context.printerUri, startedAt: context.startedAt, nowMs: context.nowMs };
}

function getPrinterAttributes(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const all = printerAttributes(target.printer, printerContextOf(call.context));
  const requested = stringValues(findAttribute(call.operation, 'requested-attributes'));
  return response(call.version, call.request.requestId, STATUS.ok, null, [
    { tag: GROUP_TAGS.printer, attributes: selectAttributes(all, requested) },
  ]);
}

/** 名字：去掉控制、格式字符和首尾空白，按字符数截短。 */
function cleanName(value: string | null, maxChars: number): string {
  return [...(value ?? '').replace(INVISIBLE_CHARACTERS, '').trim()].slice(0, maxChars).join('');
}

/** Print-Job、Validate-Job 共用的核对（RFC 8011 §4.2.1.1、§4.2.3）。 */
function readJobRequest(call: Call): { job: JobRequest } | { failure: IppMessage } {
  const { operation, request } = call;
  const declaredFormat = (stringValue(findAttribute(operation, 'document-format')) ?? AUTO_FORMAT).toLowerCase();
  if (!isSupportedFormat(declaredFormat)) {
    return fail(call, STATUS.documentFormatNotSupported, IPP_MESSAGES.format, [
      mimeTypeAttr('document-format', declaredFormat),
    ]);
  }
  const compression = stringValue(findAttribute(operation, 'compression'));
  if (compression !== null && compression !== 'none') {
    return fail(call, STATUS.compressionNotSupported, IPP_MESSAGES.compression, [
      keywordAttr('compression', compression),
    ]);
  }
  const unsupported: IppAttribute[] = [];
  let copies = 1;
  const jobGroup = request.groups.find((group) => group.tag === GROUP_TAGS.job)?.attributes ?? [];
  for (const attribute of jobGroup) {
    if (attribute.name === 'copies') {
      const requested = integerValue(attribute);
      copies = Math.min(IPP_COPIES_MAX, Math.max(1, requested ?? 1));
      if (requested !== copies) {
        unsupported.push(attribute);
      }
    } else if (attribute.name === 'sides') {
      if (stringValue(attribute) !== 'one-sided') {
        unsupported.push(attribute);
      }
    } else if (!ACCEPTED_JOB_ATTRIBUTES.has(attribute.name)) {
      unsupported.push(attribute);
    }
  }
  if (unsupported.length > 0 && booleanValue(findAttribute(operation, 'ipp-attribute-fidelity')) === true) {
    return fail(call, STATUS.attributesOrValuesNotSupported, IPP_MESSAGES.attributes, unsupported);
  }
  const name = cleanName(stringValue(findAttribute(operation, 'job-name')), JOB_NAME_CHARS);
  return {
    job: {
      name: name === '' ? UNTITLED_JOB : name,
      user: cleanName(stringValue(findAttribute(operation, 'requesting-user-name')), USER_NAME_CHARS),
      declaredFormat,
      copies,
      unsupported,
    },
  };
}

/** 有被替换掉的设置时状态是 successful-ok-ignored-or-substituted-attributes，并列出它们。 */
function accepted(call: Call, unsupported: IppAttribute[], groups: IppGroup[]): IppMessage {
  const status = unsupported.length > 0 ? STATUS.okIgnoredOrSubstituted : STATUS.ok;
  return response(call.version, call.request.requestId, status, null, [...unsupportedGroups(unsupported), ...groups]);
}

function validateJob(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const parsed = readJobRequest(call);
  if ('failure' in parsed) {
    return parsed.failure;
  }
  if (call.context.decision === 'denied') {
    return failure(call.version, call.request.requestId, STATUS.forbidden, IPP_MESSAGES.denied);
  }
  return accepted(call, parsed.job.unsupported, []);
}

function printJob(call: Call, data: Uint8Array): IppOutcome {
  const { context } = call;
  const target = targetPrinter(call);
  if ('failure' in target) {
    return reply(target.failure);
  }
  const parsed = readJobRequest(call);
  if ('failure' in parsed) {
    return reply(parsed.failure);
  }
  if (context.decision === 'denied') {
    return reply(fail(call, STATUS.forbidden, IPP_MESSAGES.denied).failure);
  }
  if (data.length === 0) {
    return reply(fail(call, STATUS.badRequest, IPP_MESSAGES.noDocument).failure);
  }
  // 按文件头认格式；客户端声明了具体格式却对不上，按坏文档拒绝（不猜它想打什么）。
  const format = sniffFormat(data);
  if (format === null) {
    return reply(fail(call, STATUS.documentFormatNotSupported, IPP_MESSAGES.format).failure);
  }
  if (parsed.job.declaredFormat !== AUTO_FORMAT && parsed.job.declaredFormat !== format) {
    return reply(fail(call, STATUS.documentFormatError, IPP_MESSAGES.formatMismatch).failure);
  }
  const created = context.book.create({
    printerKey: target.printer.key,
    name: parsed.job.name,
    user: parsed.job.user,
    client: context.client,
    sizeBytes: data.length,
    held: context.decision === 'ask',
  });
  if (created.status !== 'created') {
    const message = created.status === 'busy' ? IPP_MESSAGES.busy : IPP_MESSAGES.clientBusy;
    return reply(fail(call, STATUS.busy, message).failure);
  }
  const jobGroup: IppGroup = {
    tag: GROUP_TAGS.job,
    attributes: selectJobAttributes(jobAttributes(created.job, jobContextOf(context)), PRINT_JOB_REPLY_ATTRIBUTES),
  };
  return {
    response: accepted(call, parsed.job.unsupported, [jobGroup]),
    accepted: {
      job: created.job,
      document: { format, data, copies: parsed.job.copies },
      needsApproval: context.decision === 'ask',
    },
  };
}

/** 任务属性按 requested-attributes 挑：all、job-description、job-template 都给全部，其余按名字。 */
export function selectJobAttributes(all: readonly IppAttribute[], requested: readonly string[]): IppAttribute[] {
  if (requested.some((name) => name === 'all' || name === 'job-description' || name === 'job-template')) {
    return [...all];
  }
  return all.filter((attribute) => requested.includes(attribute.name));
}

/** 任务名、用户名是交任务那台电脑的事：每台电脑只看得到自己交的任务。 */
function getJobs(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const which = stringValue(findAttribute(call.operation, 'which-jobs')) ?? 'not-completed';
  if (which !== 'not-completed' && which !== 'completed') {
    return failure(
      call.version,
      call.request.requestId,
      STATUS.attributesOrValuesNotSupported,
      IPP_MESSAGES.whichJobs,
      [keywordAttr('which-jobs', which)],
    );
  }
  const limit = integerValue(findAttribute(call.operation, 'limit'));
  const requested = stringValues(findAttribute(call.operation, 'requested-attributes')) ?? DEFAULT_JOB_LIST_ATTRIBUTES;
  const jobs = call.context.book
    .list(target.printer.key, which, null)
    .filter((job) => job.client === call.context.client)
    .slice(0, limit !== null && limit > 0 ? limit : undefined);
  const groups = jobs.map(
    (job): IppGroup => ({
      tag: GROUP_TAGS.job,
      attributes: selectJobAttributes(jobAttributes(job, jobContextOf(call.context)), requested),
    }),
  );
  return response(call.version, call.request.requestId, STATUS.ok, null, groups);
}

/** 要操作的任务：job-id，或 job-uri 末尾的编号，或 POST 的网址里的编号；只认这台共享打印机的任务。 */
function targetJob(call: Call, printer: SharedPrinter): { job: IppJob } | { failure: IppMessage } {
  const id =
    integerValue(findAttribute(call.operation, 'job-id')) ??
    jobIdFromUri(stringValue(findAttribute(call.operation, 'job-uri'))) ??
    call.context.pathJobId;
  if (id === null) {
    return fail(call, STATUS.badRequest, IPP_MESSAGES.badRequest);
  }
  const job = call.context.book.get(id);
  if (job === null || job.printerKey !== printer.key) {
    return fail(call, STATUS.notFound, IPP_MESSAGES.noJob);
  }
  return { job };
}

function getJobAttributes(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const found = targetJob(call, target.printer);
  if ('failure' in found) {
    return found.failure;
  }
  // 别的电脑的任务当作没有：不透露别人打了什么。
  if (found.job.client !== call.context.client) {
    return failure(call.version, call.request.requestId, STATUS.notFound, IPP_MESSAGES.noJob);
  }
  const requested = stringValues(findAttribute(call.operation, 'requested-attributes')) ?? ['all'];
  return response(call.version, call.request.requestId, STATUS.ok, null, [
    {
      tag: GROUP_TAGS.job,
      attributes: selectJobAttributes(jobAttributes(found.job, jobContextOf(call.context)), requested),
    },
  ]);
}

function cancelJob(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const found = targetJob(call, target.printer);
  if ('failure' in found) {
    return found.failure;
  }
  const { version, request } = call;
  switch (call.context.book.cancel(found.job.id, call.context.client)) {
    case 'canceled':
    case 'requested':
      return response(version, request.requestId, STATUS.ok, null);
    case 'not-owner':
      return failure(version, request.requestId, STATUS.notAuthorized, IPP_MESSAGES.notOwner);
    case 'finished':
      return failure(version, request.requestId, STATUS.notPossible, IPP_MESSAGES.finished);
    case 'not-found':
      return failure(version, request.requestId, STATUS.notFound, IPP_MESSAGES.noJob);
  }
}
