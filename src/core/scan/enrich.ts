import { expandVariables } from '../templates/note-text';
import type {
  EnrichStep,
  HttpHeader,
  HttpMethod,
  HttpStep,
  LookupStep,
  RegexReplacer,
  RegexReplaceStep,
  StepKind,
} from './enrich-model';
import { parseJsonPath, readJsonPath } from './json-path';
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
  now: () => number;
}

/** 每一步的执行情况，给「试一试」显示。 */
export interface StepTrace {
  kind: StepKind;
  ok: boolean;
  /** 失败或没有查到时的原因（中文）。 */
  detail: string | null;
  durationMs: number;
}

export interface EnrichResult {
  scan: ScanResult;
  traces: StepTrace[];
  /** 设为「拦下不打印」的 HTTP 步骤失败了：不能打印。 */
  blocked: { stepIndex: number; detail: string } | null;
}

interface StepOutcome {
  values: Array<[field: string, value: string]>;
  detail: string | null;
  /** 失败时是否拦下（只有 HTTP 步骤会）。 */
  blocks: boolean;
}

/**
 * 按顺序执行加工步骤：每一步产出字段，后面的步骤能用前面的结果。
 * 步骤失败时产出空值（模板里不显示）；HTTP 步骤设为拦下时停止执行并报告。
 */
export async function enrich(
  scan: ScanResult,
  steps: readonly EnrichStep[],
  deps: EnrichDeps,
  printedAt: Date,
): Promise<EnrichResult> {
  let current = scan;
  const traces: StepTrace[] = [];
  for (const [stepIndex, step] of steps.entries()) {
    const startedAt = deps.now();
    const outcome = await runStep(step, current, deps, printedAt);
    current = withFields(current, outcome.values);
    traces.push({
      kind: step.kind,
      ok: outcome.detail === null,
      detail: outcome.detail,
      durationMs: deps.now() - startedAt,
    });
    if (outcome.blocks && outcome.detail !== null) {
      return { scan: current, traces, blocked: { stepIndex, detail: outcome.detail } };
    }
  }
  return { scan: current, traces, blocked: null };
}

function runStep(
  step: EnrichStep,
  scan: ScanResult,
  deps: EnrichDeps,
  printedAt: Date,
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
  }
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
