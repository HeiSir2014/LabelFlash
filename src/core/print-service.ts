import { type PaperSize, paperKey } from '../shared/paper-sizes';
import { SAMPLE_SHELF_NUMBER } from '../shared/sample-label';
import { templateFingerprint } from './api/template-fields';
import { type DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { type PrintFailure, toPrintFailure } from './errors';
import type { JobStore } from './job-store';
import type { PrintQueue } from './print-queue';
import type { PrinterChoice } from './printing/resolve-printer';
import { SHELF_NUMBER_FIELD } from './scan/builtin-rules';
import { type EnrichContext, type EnrichResult, NO_ENRICH_CONTEXT } from './scan/enrich';
import { MAX_RAW_LENGTH, normalizeRaw } from './scan/normalize-raw';
import type { ScanField, ScanResult } from './scan/scan-result';
import { GENERIC_TEMPLATE } from './templates/builtin-templates';
import { type LibrarySample, librarySampleScan } from './templates/library/library-model';
import { type LabelTemplate, withPaper } from './templates/template-model';
import type {
  BatchRef,
  Clock,
  IppRef,
  JobRecord,
  LabelJob,
  PdfRef,
  PreviewResult,
  PrinterAdapter,
  PrintRequest,
  PrintResult,
  PrintSource,
  RecordedResult,
} from './types';

export const TEST_RAW = 'TEST-0001-测试色-XL';

/**
 * 模板预览（工作台没扫码时的示例、模板页、设计器）和「打印一张试试」的加工条件：没有手机拍的图，
 * 货架号用示例值（当作手动输入的字段，只有规则里有读货架号的「图中文字识别」时才用上），看得到它印在哪。
 * 正式打印、扫码后的预览不用它：那里只印真的读到的。
 */
export const TEMPLATE_PREVIEW_CONTEXT: EnrichContext = {
  images: [],
  manualFields: { [SHELF_NUMBER_FIELD]: SAMPLE_SHELF_NUMBER },
};

/** 所有识别规则都关掉时，测试页仍然要能打：整段内容作为一个字段。 */
const TEST_FALLBACK_SCAN: ScanResult = {
  raw: TEST_RAW,
  ruleId: 'builtin:test',
  ruleName: '测试页',
  fields: [{ name: '内容', value: TEST_RAW }],
};

export interface PrintServiceDeps {
  adapter: PrinterAdapter;
  store: JobStore;
  guard: DedupGuard;
  queue: PrintQueue;
  clock: Clock;
  createId: () => string;
  /** 按本机当前启用的规则识别；每次调用都读取最新规则，改规则立即生效。 */
  recognize: (raw: string) => ScanResult | null;
  /** 执行命中规则的加工步骤。 */
  enrich: (scan: ScanResult, context: EnrichContext) => Promise<EnrichResult>;
  /**
   * 这一张用的模板（按字段换模板 → 规则绑定的模板 → 当前模板）；传入的是加工之后的结果，
   * 每次打印时读取，切换模板立即生效。
   */
  resolveTemplate: (scan: ScanResult) => LabelTemplate;
  /**
   * 这个模板用哪台打印机（模板指定 → 纸张分配，见 printing/resolve-printer.ts）；每次打印都重新决定，
   * 改了分配立即生效。实现不能抛错：读不到打印机列表时自己兜底。
   */
  choosePrinter: (template: LabelTemplate) => Promise<PrinterChoice>;
  /** 每条打印记录写入后调用（打印结果通知在这里入队）；实现不能抛错、不能阻塞。测试页不调用。 */
  onRecorded?: (job: JobRecord, scan: ScanResult | null) => void;
}

/** 这一张打到哪、用什么纸和模板；识别不了的记录没有这些。 */
interface JobTarget {
  printerName: string;
  paper: string | null;
  templateId: string | null;
  /** 模板的指纹（字段 + 纸张）：按记录原样重打时核对模板有没有改过。 */
  templateFingerprint: string | null;
}

const NO_TARGET: JobTarget = { printerName: '', paper: null, templateId: null, templateFingerprint: null };

/**
 * 最多记住多少个码上一次的打印机和模板：一个班次扫几百张，防重复窗口（最长一天）内够用；
 * 超出时忘掉最早的，那张再重复时按识别结果选。
 */
const MAX_REMEMBERED_TARGETS = 2_000;

/** 按模板打印的几种入口在这几处不同。 */
interface LabelOptions {
  /** 扫码内容的防重复窗口：扫码枪、手机要；本机接口靠调用方的 requestId，不用它。 */
  dedup: boolean;
  /** 执行识别规则的加工步骤：扫码要；本机接口的字段由调用方给出，不执行。 */
  enrich: boolean;
  /** 调用方指定的打印机（接口已核对过在系统里）；null = 按模板决定。 */
  printerName: string | null;
}

const SCAN_OPTIONS: LabelOptions = { dedup: true, enrich: true, printerName: null };

/** 本机接口的识别结果里的「规则」：备注变量 {规则} 和打印结果通知里显示为「本机接口」。 */
export const API_RULE = { id: 'api', name: '本机接口' } as const;

/** 批量打印的「规则」：备注变量 {规则} 和打印结果通知里显示为「批量打印」。 */
export const BATCH_RULE = { id: 'batch', name: '批量打印' } as const;

/** PDF 打印的「规则」：备注变量 {规则} 和打印结果通知里显示为「PDF 打印」。 */
export const PDF_RULE = { id: 'pdf', name: 'PDF 打印' } as const;

/** 局域网共享的「规则」：备注变量 {规则} 和打印结果通知里显示为「局域网共享」。 */
export const IPP_RULE = { id: 'ipp', name: '局域网共享' } as const;

/**
 * 不经过识别规则的一张算在哪条「规则」名下：批量、PDF、局域网共享各有名字，其余（本机接口和它的重打）是本机接口。
 * 局域网共享打来的也带着 PDF 的位图编号，所以先认它。
 */
export function fieldsRuleFor(origin: { batch?: unknown; pdf?: unknown; ipp?: unknown }): FieldsRule {
  if (origin.ipp !== undefined) {
    return IPP_RULE;
  }
  if (origin.batch !== undefined) {
    return BATCH_RULE;
  }
  if (origin.pdf !== undefined) {
    return PDF_RULE;
  }
  return API_RULE;
}

/** 不经过识别规则的一张算在哪条「规则」名下。 */
export interface FieldsRule {
  id: string;
  name: string;
}

/** 不经过识别规则的一张的识别结果（预览按记录重打时也用它，和打印时一致）。 */
export function fieldsScan(content: string, fields: ScanField[], rule: FieldsRule = API_RULE): ScanResult {
  return { raw: content, ruleId: rule.id, ruleName: rule.name, fields };
}

/** 不经过识别规则的一张：本机接口提交的，批量打印的，或从打印记录按当时的模板和字段重打的。 */
export interface FieldsPrint {
  template: LabelTemplate;
  fields: ScanField[];
  /** 完整内容：二维码的「完整内容」、底部整行、{完整内容}；也是打印记录的 raw。 */
  content: string;
  source: PrintSource;
  caller: string | null;
  printerName: string | null;
  /** 批量打印的一张（含从打印记录重打批量打的）：写进打印记录；规则名记为「批量打印」。 */
  batch?: BatchRef;
  /** PDF 打印的一块（含从打印记录重打的）：写进打印记录；规则名记为「PDF 打印」。 */
  pdf?: PdfRef;
  /** 局域网共享打来的（含从打印记录重打的）：写进打印记录；规则名记为「局域网共享」。 */
  ipp?: IppRef;
}

type Recognition = { ok: true; scan: ScanResult } | { ok: false; result: Extract<PrintResult, { status: 'invalid' }> };

/** 所有入口（扫码枪、记录重打、手机扫码、本机接口）的唯一业务入口。 */
export class PrintService {
  /** 每个码上一次实际用的打印机和模板，重复的一张照着记（见 duplicateTarget）。 */
  private readonly recentTargets = new Map<string, JobTarget>();

  constructor(private readonly deps: PrintServiceDeps) {}

  /** 启动时从打印记录回放门限状态，重启后窗口仍然有效。 */
  restore(): void {
    const since = this.deps.clock.now() - MAX_DEDUP_WINDOW_MS;
    for (const { raw, printedAt } of this.deps.store.listLastPrinted(since)) {
      this.deps.guard.restore(raw, printedAt);
    }
  }

  /**
   * 预览同样执行加工步骤（HTTP 查询的结果会被缓存，紧接着打印时直接用）。
   * context：按记录预览时带上记录里的字段（见 job-reprint.ts 的 recordedFieldValues）；平常没有图、没有手动字段。
   */
  async preview(raw: string, context: EnrichContext = NO_ENRICH_CONTEXT): Promise<PreviewResult> {
    const recognition = this.recognize(raw);
    if (!recognition.ok) {
      return recognition.result;
    }
    const enriched = await this.enrich(recognition.scan, context);
    const { scan } = enriched;
    // 和打印一样，按加工后的字段决定模板（按字段换模板）。
    const template = this.deps.resolveTemplate(scan);
    return {
      status: 'ok',
      scan,
      recent: this.deps.guard.peek(scan.raw),
      lookupFailure: enriched.blocked?.detail ?? null,
      printer: await this.deps.choosePrinter(template),
    };
  }

  async submit(request: PrintRequest): Promise<PrintResult> {
    const id = this.deps.createId();
    const recognition = this.recognize(request.raw);
    if (!recognition.ok) {
      const truncated = request.raw.trim().slice(0, MAX_RAW_LENGTH);
      return this.finish(id, request, NO_TARGET, truncated, recognition.result, null);
    }
    return this.printLabel(id, request, recognition.scan, this.deps.resolveTemplate, SCAN_OPTIONS);
  }

  /** 按给定的模板和字段打印一张：不识别、不加工、不用扫码的防重复窗口。 */
  async printFields(input: FieldsPrint): Promise<PrintResult> {
    const scan = fieldsScan(input.content, input.fields, fieldsRuleFor(input));
    const request: PrintRequest = { raw: input.content, source: input.source };
    if (input.caller !== null) {
      request.caller = input.caller;
    }
    if (input.batch !== undefined) {
      request.batch = input.batch;
    }
    if (input.pdf !== undefined) {
      request.pdf = input.pdf;
    }
    if (input.ipp !== undefined) {
      request.ipp = input.ipp;
    }
    return this.printLabel(this.deps.createId(), request, scan, () => input.template, {
      dedup: false,
      enrich: false,
      printerName: input.printerName,
    });
  }

  /**
   * 防重复 → 加工 → 按加工后的字段决定模板和打印机 → 排队打印 → 写记录（防重复和加工由 options 决定）。
   * 模板在加工之后才定：「按字段换模板」可以用加工步骤补出来的字段（例如 HTTP 查询回来的快递公司）。
   */
  private async printLabel(
    id: string,
    request: PrintRequest,
    recognized: ScanResult,
    templateFor: (scan: ScanResult) => LabelTemplate,
    options: LabelOptions,
  ): Promise<PrintResult> {
    const { raw } = recognized;
    // 先占住防重复窗口再加工：HTTP 查询要花时间，扫码枪连按的第二下必须在这里就被拦下。
    const reservation = options.dedup
      ? this.deps.guard.tryReserve(raw, request.force === true)
      : ({ ok: true } as const);
    if (!reservation.ok) {
      const duplicate: RecordedResult = {
        status: 'duplicate',
        recent: reservation.recent,
        windowMs: this.deps.guard.windowMs,
      };
      return this.finish(
        id,
        request,
        await this.duplicateTarget(recognized, templateFor, options),
        raw,
        duplicate,
        recognized,
      );
    }
    let template: LabelTemplate;
    let enriched: EnrichResult;
    let planned: Awaited<ReturnType<PrintService['plan']>>;
    try {
      const context: EnrichContext = { images: request.images ?? [], manualFields: request.manualFields ?? {} };
      enriched = options.enrich
        ? await this.enrich(recognized, context)
        : { scan: recognized, traces: [], blocked: null };
      template = templateFor(enriched.scan);
      planned = await this.plan(template, options);
    } catch (error) {
      // 读模板（自定义模板在数据库里）出错时也要放开窗口，不然这个码之后一直算「正在打印」，强制补打也打不了。
      if (options.dedup) {
        this.deps.guard.release(raw);
      }
      throw error;
    }
    // 没有打印机时和 1.0.x 没选打印机一样：不打印、不写记录、放开防重复窗口，指定好打印机后可以直接重打。
    if (planned.target === null) {
      if (options.dedup) {
        this.deps.guard.release(raw);
      }
      return planned.noPrinter;
    }
    const { target } = planned;
    if (options.dedup) {
      this.rememberTarget(raw, target);
    }
    if (enriched.blocked) {
      this.deps.guard.release(raw);
      const { reason, detail, field } = enriched.blocked;
      const blocked: RecordedResult = { status: 'failed', reason, detail, ...(field === null ? {} : { field }) };
      return this.finish(id, request, target, raw, blocked, enriched.scan);
    }
    const { scan } = enriched;
    try {
      await this.deps.queue.enqueue(target.printerName, (signal) =>
        this.deps.adapter.print(target.printerName, this.createJob(scan, template), signal),
      );
    } catch (error) {
      console.error('[PrintService] print failed', error);
      const failure = toPrintFailure(error);
      if (options.dedup) {
        this.settleFailedReservation(scan.raw, failure);
      }
      return this.finish(id, request, target, scan.raw, failed(failure), scan);
    }
    if (options.dedup) {
      this.deps.guard.commit(scan.raw);
    }
    return this.finish(id, request, target, scan.raw, { status: 'printed', jobId: id, scan }, scan);
  }

  /** 这个模板打到哪台打印机；没有打印机时给出 no-printer 结果。 */
  /**
   * 重复的一张记在哪台打印机、哪个模板名下：用这个码上一次实际用的。重复的不加工，按识别结果重新选的话，
   * 靠加工补出的字段换的模板就选错了（甚至说「没有打印机」）。没记下（上一张还在加工）时按识别结果选，
   * 再选不出打印机就不写打印机——它就是一张重复，不该提示去分配打印机。
   */
  private async duplicateTarget(
    recognized: ScanResult,
    templateFor: (scan: ScanResult) => LabelTemplate,
    options: LabelOptions,
  ): Promise<JobTarget> {
    const remembered = this.recentTargets.get(recognized.raw);
    if (remembered) {
      return remembered;
    }
    const planned = await this.plan(templateFor(recognized), options);
    return planned.target ?? NO_TARGET;
  }

  private rememberTarget(raw: string, target: JobTarget): void {
    // 重新插入放到最后：超过上限时删掉最早的那个。
    this.recentTargets.delete(raw);
    this.recentTargets.set(raw, target);
    if (this.recentTargets.size > MAX_REMEMBERED_TARGETS) {
      const oldest = this.recentTargets.keys().next().value;
      if (oldest !== undefined) {
        this.recentTargets.delete(oldest);
      }
    }
  }

  private async plan(
    template: LabelTemplate,
    options: LabelOptions,
  ): Promise<
    { target: JobTarget; noPrinter: null } | { target: null; noPrinter: Extract<PrintResult, { status: 'no-printer' }> }
  > {
    const choice: PrinterChoice =
      options.printerName === null
        ? await this.deps.choosePrinter(template)
        : { printerName: options.printerName, reason: 'template' };
    if (choice.printerName === null) {
      return {
        target: null,
        noPrinter: { status: 'no-printer', paperKey: choice.paperKey, missingPrinter: choice.missingPrinter },
      };
    }
    return {
      target: {
        printerName: choice.printerName,
        paper: paperKey(template.paper),
        templateId: template.id,
        templateFingerprint: templateFingerprint(template),
      },
      noPrinter: null,
    };
  }

  /**
   * 测试页按规则识别、按规则绑定的模板打印，但不执行加工步骤：
   * 测试页是检查打印机的，不应该因为 HTTP 接口不通而打不出来，也不该拿测试内容去查接口。
   * paper 是这台打印机负责的纸：测试页按它的尺寸打，看到的就是这台打印机实际出纸的样子。
   */
  async printTest(printerName: string, paper: PaperSize): Promise<PrintResult> {
    const scan = this.deps.recognize(TEST_RAW) ?? TEST_FALLBACK_SCAN;
    // 测试内容填不出面单（面单要订单系统的字段）：规则绑的是面单模板时，按通用标签打。
    const resolved = this.deps.resolveTemplate(scan);
    const template = withPaper(resolved.kind === 'waybill' ? GENERIC_TEMPLATE : resolved, paper);
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(scan, template), signal),
      );
      return { status: 'printed', jobId: 'test', scan };
    } catch (error) {
      console.error('[PrintService] test print failed', error);
      return failed(toPrintFailure(error));
    }
  }

  /**
   * 模板页「打印一张试试」：按预览内容和正在编辑的草稿打一张，看实际出纸的效果。
   * 和预览一样识别、加工（看到的就是打出来的），加工步骤设为拦下的查询失败时和正式打印一样不打；
   * 从模板库复制出的模板还在用示例数据预览时（sample 不为 null），按示例数据打、不识别预览内容。
   * 按草稿的纸张和打印机设置选打印机。不占防重复窗口、不写打印记录：这是在调模板，不是业务打印。
   */
  async printSample(raw: string, template: LabelTemplate, sample: LibrarySample | null = null): Promise<PrintResult> {
    const scanned = sample === null ? await this.sampleScan(raw) : librarySampleScan(sample);
    if ('status' in scanned) {
      return scanned;
    }
    const choice = await this.deps.choosePrinter(template);
    if (choice.printerName === null) {
      return { status: 'no-printer', paperKey: choice.paperKey, missingPrinter: choice.missingPrinter };
    }
    const printerName = choice.printerName;
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(scanned, template), signal),
      );
      // 调试用：只记打到哪、什么纸、什么模板种类，不记标签内容（内容可能是顾客信息）。
      console.info(`[PrintService] sample printed on ${printerName} (${paperKey(template.paper)}, ${template.kind})`);
      // 不写记录，没有记录编号：和测试页一样给一个固定的说明性编号。
      return { status: 'printed', jobId: 'sample', scan: scanned };
    } catch (error) {
      console.error('[PrintService] sample print failed', error);
      return failed(toPrintFailure(error));
    }
  }

  /** 「打印一张试试」按预览内容打时的识别结果；识别不了、查询被拦下时返回不打的原因。 */
  private async sampleScan(raw: string): Promise<ScanResult | PrintResult> {
    const preview = await this.preview(raw, TEMPLATE_PREVIEW_CONTEXT);
    if (preview.status !== 'ok') {
      return preview;
    }
    // 模板预览没有图：图中文字识别要么用示例值，要么跳过（skip），不会拦下（block），所以这里只可能是
    // HTTP 查询失败，blocked.reason 不会是 TEXT_NOT_FOUND（见 scan/enrich.ts 的 imageText：没有图时直接 skip）。
    if (preview.lookupFailure !== null) {
      return { status: 'failed', reason: 'LOOKUP_FAILED', detail: preview.lookupFailure };
    }
    return preview.scan;
  }

  /** 超时说明结果不确定（可能已出纸或仍在排队）：按已打印处理，避免重扫出第二张；确认没出纸再强制补打。 */
  private settleFailedReservation(raw: string, failure: PrintFailure): void {
    if (failure.reason === 'PRINT_TIMEOUT') {
      this.deps.guard.commit(raw);
    } else {
      this.deps.guard.release(raw);
    }
  }

  private recognize(raw: string): Recognition {
    if (normalizeRaw(raw) === null) {
      return { ok: false, result: { status: 'invalid', reason: 'INVALID_CONTENT' } };
    }
    const scan = this.deps.recognize(raw);
    return scan ? { ok: true, scan } : { ok: false, result: { status: 'invalid', reason: 'NO_MATCHING_RULE' } };
  }

  /** 加工步骤里意外的异常（不是查询失败）不能拦住打印：记日志，按没有加工处理。 */
  private async enrich(scan: ScanResult, context: EnrichContext): Promise<EnrichResult> {
    try {
      return await this.deps.enrich(scan, context);
    } catch (error) {
      console.error('[PrintService] processing steps failed', error);
      return { scan, traces: [], blocked: null };
    }
  }

  /** 打印用的模板和决定打印机用的是同一个：不在这里重新选模板。 */
  private createJob(scan: ScanResult, template: LabelTemplate): LabelJob {
    return { scan, template, printedAt: this.deps.clock.now() };
  }

  /** 写打印记录，并通知订阅者（打印结果通知）；scan 是当时的识别结果，识别不了时为 null。 */
  private finish(
    id: string,
    request: PrintRequest,
    target: JobTarget,
    raw: string,
    result: RecordedResult,
    scan: ScanResult | null,
  ): PrintResult {
    const job: JobRecord = {
      id,
      createdAt: this.deps.clock.now(),
      raw,
      printerName: target.printerName,
      source: request.source,
      status: result.status,
      forced: request.force === true,
    };
    if (result.status === 'failed') {
      job.failureReason = result.reason;
    }
    if (target.paper !== null) {
      job.paper = target.paper;
    }
    if (target.templateId !== null) {
      job.templateId = target.templateId;
    }
    if (target.templateFingerprint !== null) {
      job.templateFingerprint = target.templateFingerprint;
    }
    if (scan !== null) {
      job.fields = scan.fields;
    }
    if (request.caller !== undefined) {
      job.caller = request.caller;
    }
    if (request.batch !== undefined) {
      job.batch = request.batch;
    }
    if (request.pdf !== undefined) {
      job.pdf = request.pdf;
    }
    if (request.ipp !== undefined) {
      job.ipp = request.ipp;
    }
    try {
      this.deps.store.append(job);
    } catch (error) {
      // 以打印机为准：记录写失败不能把已出纸的任务报成失败，否则操作员会重复打印。
      console.error('[PrintService] failed to record job', error);
    }
    this.deps.onRecorded?.(job, scan);
    return result;
  }
}

function failed(failure: PrintFailure): Extract<PrintResult, { status: 'failed' }> {
  return { status: 'failed', ...failure };
}
