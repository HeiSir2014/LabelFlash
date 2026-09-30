import { expandVariables } from '../templates/note-text';
import type {
  EnrichStep,
  HttpHeader,
  HttpMethod,
  HttpStep,
  ImageTextStep,
  LookupStep,
  RegexReplacer,
  RegexReplaceStep,
  StepKind,
} from './enrich-model';
import {
  findImageText,
  IMAGE_TEXT_MIN_SCORE,
  type ImageTextMatch,
  type ImageTextRegion,
  type ScanImage,
} from './image-text';
import { parseJsonPath, readJsonPath } from './json-path';
import type { RegexRunner } from './recognize';
import { fieldValue, type ScanField, type ScanResult } from './scan-result';

/** HTTP 步骤交给主进程执行的请求：字段变量已展开，{密钥:名称} 还没有替换。 */
export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  /** GET 时为 null。 */
  body: string | null;
  timeoutMs: number;
  cacheSeconds: number;
}

export type HttpOutcome = { ok: true; json: unknown } | { ok: false; detail: string };

export interface EnrichDeps {
  replace: RegexReplacer;
  /** 在查找表里按 keyColumn 精确匹配 key，返回整行（列名 → 值）；表不存在或查不到时返回 null。 */
  lookup: (
    tableId: string,
    keyColumn: string,
    key: string,
    ignoreCase: boolean,
  ) => Readonly<Record<string, string>> | null;
  http: (request: HttpRequest) => Promise<HttpOutcome>;
  /** 执行一条正则（隔离环境、有超时），图中文字识别用。 */
  match: RegexRunner;
  /** 用 OCR 读出图上的所有文字（按阅读顺序）；这台电脑上没有文字识别时返回 null。 */
  readImageText: (image: ScanImage) => Promise<ImageTextRegion[] | null>;
  now: () => number;
}

/**
 * 这一次扫码随请求带来的东西：手机拍下的标签图（同一张标签连续的几帧，按顺序；没有图时为空）、手机上手动输入的字段。
 */
export interface EnrichContext {
  images: readonly ScanImage[];
  manualFields: Readonly<Record<string, string>>;
}

export const NO_ENRICH_CONTEXT: EnrichContext = { images: [], manualFields: {} };

/** 拦下不打印的原因：LOOKUP_FAILED = HTTP 查询失败；TEXT_NOT_FOUND = 图中文字没认出。 */
export type BlockReason = 'LOOKUP_FAILED' | 'TEXT_NOT_FOUND';

/** 每一步的执行情况，给「试一试」显示。 */
export interface StepTrace {
  kind: StepKind;
  ok: boolean;
  /** 失败或没有查到时的原因、跳过的原因（中文）。 */
  detail: string | null;
  /** 这一步这次用不上（例如不是手机扫码、没有图），没有执行。 */
  skipped: boolean;
  durationMs: number;
}

export interface EnrichResult {
  scan: ScanResult;
  traces: StepTrace[];
  /** 设为「拦下不打印」的步骤失败了：不能打印。field 是没认出的字段（图中文字识别）。 */
  blocked: { stepIndex: number; detail: string; reason: BlockReason; field: string | null } | null;
}

interface StepOutcome {
  values: Array<[field: string, value: string]>;
  detail: string | null;
  /** 失败时是否拦下（HTTP 查询、图中文字识别设为拦下时）。 */
  blocks: boolean;
  skipped?: boolean;
  reason?: BlockReason;
  field?: string;
}

/** 同一次扫码每一帧最多识别一次：几个图中文字识别步骤共用结果。 */
type ReadImage = (image: ScanImage) => Promise<ImageTextRegion[] | null>;

/**
 * 按顺序执行加工步骤：每一步产出字段，后面的步骤能用前面的结果。
 * 步骤失败时产出空值（模板里不显示）；HTTP 步骤设为拦下时停止执行并报告。
 */
export async function enrich(
  scan: ScanResult,
  steps: readonly EnrichStep[],
  deps: EnrichDeps,
  printedAt: Date,
  context: EnrichContext = NO_ENRICH_CONTEXT,
): Promise<EnrichResult> {
  let current = scan;
  const traces: StepTrace[] = [];
  const recognized = new Map<ScanImage, Promise<ImageTextRegion[] | null>>();
  const readImage: ReadImage = (image) => {
    let regions = recognized.get(image);
    if (regions === undefined) {
      regions = deps.readImageText(image);
      recognized.set(image, regions);
    }
    return regions;
  };
  for (const [stepIndex, step] of steps.entries()) {
    const startedAt = deps.now();
    const outcome = await runStep(step, current, deps, printedAt, context, readImage);
    current = withFields(current, outcome.values);
    const skipped = outcome.skipped === true;
    traces.push({
      kind: step.kind,
      ok: outcome.detail === null || skipped,
      detail: outcome.detail,
      skipped,
      durationMs: deps.now() - startedAt,
    });
    if (outcome.blocks && outcome.detail !== null) {
      const blocked = {
        stepIndex,
        detail: outcome.detail,
        reason: outcome.reason ?? 'LOOKUP_FAILED',
        field: outcome.field ?? null,
      };
      return { scan: current, traces, blocked };
    }
  }
  return { scan: current, traces, blocked: null };
}

function runStep(
  step: EnrichStep,
  scan: ScanResult,
  deps: EnrichDeps,
  printedAt: Date,
  context: EnrichContext,
  readImage: ReadImage,
): Promise<StepOutcome> | StepOutcome {
  switch (step.kind) {
    case 'template':
      return done([[step.output, expandVariables(step.text, scan, printedAt).trim()]]);
    case 'regexReplace':
      return regexReplace(step, scan, deps.replace);
    case 'lookup':
      return lookup(step, scan, deps);
    case 'http':
      return http(step, scan, deps, printedAt);
    case 'imageText':
      return imageText(step, context, deps.match, readImage);
  }
}

/**
 * 图中文字识别：手动输入的值优先；没有图（不是手机扫码）或这台电脑上没有文字识别时跳过；
 * 否则按顺序识别同一张标签的几帧，按正则取值（优先区域先看），第一帧认出就停，后面的帧不再识别。
 * 几帧都没认出时按设置拦下或留空；有读到但没把握的，说出把握最大的那次读到了什么。
 */
async function imageText(
  step: ImageTextStep,
  context: EnrichContext,
  match: RegexRunner,
  readImage: ReadImage,
): Promise<StepOutcome> {
  const manual = context.manualFields[step.output]?.trim();
  if (manual !== undefined && manual !== '') {
    return done([[step.output, manual]]);
  }
  if (context.images.length === 0) {
    return skip('这次扫码没有标签图（只有手机扫码带图），跳过');
  }
  const query = { pattern: step.pattern, flags: step.flags, preferredArea: step.preferredArea };
  let unsure: ImageTextMatch | null = null;
  let failure: string | null = null;
  for (const image of context.images) {
    let regions: ImageTextRegion[] | null;
    try {
      regions = await readImage(image);
    } catch (error) {
      failure = `识别标签上的字时出错：${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (regions === null) {
      return skip('这台电脑上没有文字识别，跳过');
    }
    const found = findImageText(regions, image.code, query, match);
    if (found !== null && found.score >= IMAGE_TEXT_MIN_SCORE) {
      return done([[step.output, found.value]]);
    }
    if (found !== null && (unsure === null || found.score > unsure.score)) {
      unsure = found;
    }
  }
  if (unsure !== null) {
    return textNotFound(
      step,
      `没认出${step.output}：读到「${unsure.value}」，但把握只有 ${Math.floor(unsure.score * 100)}%`,
    );
  }
  return textNotFound(step, failure ?? `没认出${step.output}`);
}

function textNotFound(step: ImageTextStep, detail: string): StepOutcome {
  return {
    values: [[step.output, '']],
    detail,
    blocks: step.whenMissing === 'block',
    reason: 'TEXT_NOT_FOUND',
    field: step.output,
  };
}

function skip(detail: string): StepOutcome {
  return { values: [], detail, blocks: false, skipped: true };
}

function regexReplace(step: RegexReplaceStep, scan: ScanResult, replace: RegexReplacer): StepOutcome {
  const source = inputValue(scan, step.input);
  if (source === undefined) {
    return done([[step.output, '']], `没有识别到字段「${step.input}」`);
  }
  const replaced = replace(step.pattern, step.flags, source, step.replacement);
  return replaced === null ? done([[step.output, source]], '正则执行超时，保留原值') : done([[step.output, replaced]]);
}

function lookup(step: LookupStep, scan: ScanResult, deps: EnrichDeps): StepOutcome {
  const empty = step.outputs.map(({ field }): [string, string] => [field, '']);
  const key = inputValue(scan, step.input)?.trim();
  if (key === undefined || key === '') {
    return done(empty, `没有可查的内容（字段「${step.input ?? '完整内容'}」为空）`);
  }
  const row = deps.lookup(step.tableId, step.keyColumn, key, step.ignoreCase);
  if (!row) {
    return done(empty, `查找表里没有「${key}」`);
  }
  return done(step.outputs.map(({ column, field }) => [field, row[column] ?? '']));
}

async function http(step: HttpStep, scan: ScanResult, deps: EnrichDeps, printedAt: Date): Promise<StepOutcome> {
  const expand = (text: string, encode?: (value: string) => string) => expandVariables(text, scan, printedAt, encode);
  const outcome = await deps.http({
    method: step.method,
    url: expand(step.url, encodeURIComponent),
    headers: step.headers.map((header) => ({ name: header.name, value: expand(header.value, stripLineBreaks) })),
    body: step.method === 'POST' ? expand(step.body, escapeJsonString) : null,
    timeoutMs: step.timeoutMs,
    cacheSeconds: step.cacheSeconds,
  });
  const empty = step.outputs.map(({ field }): [string, string] => [field, '']);
  const blocks = step.onError === 'block';
  if (!outcome.ok) {
    return { values: empty, detail: outcome.detail, blocks };
  }
  const values: Array<[string, string]> = [];
  const missing: string[] = [];
  for (const { path, field } of step.outputs) {
    const parsed = parseJsonPath(path);
    const value = parsed ? readJsonPath(outcome.json, parsed) : null;
    if (value === null) {
      missing.push(path);
    }
    values.push([field, value ?? '']);
  }
  return { values, detail: missing.length > 0 ? `返回内容里取不到 ${missing.join('、')}` : null, blocks };
}

function done(values: Array<[string, string]>, detail: string | null = null): StepOutcome {
  return { values, detail, blocks: false };
}

/** null = 完整内容；字段没识别到返回 undefined。 */
function inputValue(scan: ScanResult, input: string | null): string | undefined {
  return input === null ? scan.raw : fieldValue(scan, input);
}

/** 同名字段覆盖原值（位置不变），新字段追加到末尾。 */
function withFields(scan: ScanResult, values: ReadonlyArray<[string, string]>): ScanResult {
  const fields: ScanField[] = scan.fields.map((field) => ({ ...field }));
  for (const [name, value] of values) {
    const existing = fields.find((field) => field.name === name);
    if (existing) {
      existing.value = value;
    } else {
      fields.push({ name, value });
    }
  }
  return { ...scan, fields };
}

function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}

/** 放进 JSON 字符串字面量里的值：按 JSON 规则转义（不含两边的引号）。 */
function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}
