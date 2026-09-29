import {
  type EnrichStep,
  HEADER_NAME_PATTERN,
  HTTP_ERROR_POLICIES,
  HTTP_METHODS,
  type HttpHeader,
  type HttpOutput,
  type HttpStep,
  IMAGE_TEXT_MISSING_POLICIES,
  type ImageTextStep,
  LOOKUP_TABLE_ID_PATTERN,
  type LookupOutput,
  type LookupStep,
  MATCH_FLAGS,
  REPLACE_FLAGS,
  type RegexReplaceStep,
  STEP_KINDS,
  STEP_LIMITS,
  type TemplateStep,
} from './enrich-model';
import { type CodeRelativeArea, wrapImageTextPattern } from './image-text';
import { parseJsonPath } from './json-path';
import { isValidFieldName, RULE_LIMITS } from './rule-model';

export interface StepIssue {
  issue: string;
}

class StepInvalid extends Error {}

type Loose = Record<string, unknown>;

/** 替换变量后用来检查地址格式的占位文字。 */
const URL_PLACEHOLDER = 'x';
const VARIABLE_PATTERN = /\{[^{}\n]{1,30}\}/g;

/**
 * 严格校验加工步骤（和规则一样不做静默修正）。缺少 steps 视为没有步骤。
 * 不合法时返回「第 N 步：原因」。
 */
export function sanitizeSteps(value: unknown): EnrichStep[] | StepIssue {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return { issue: '加工步骤格式不对' };
  }
  if (value.length > STEP_LIMITS.steps) {
    return { issue: `加工步骤最多 ${STEP_LIMITS.steps} 个` };
  }
  const steps: EnrichStep[] = [];
  for (const [index, item] of value.entries()) {
    try {
      steps.push(step(asLoose(item)));
    } catch (error) {
      if (error instanceof StepInvalid) {
        return { issue: `第 ${index + 1} 个加工步骤：${error.message}` };
      }
      throw error;
    }
  }
  return steps;
}

export function isStepIssue(value: EnrichStep[] | StepIssue): value is StepIssue {
  return !Array.isArray(value);
}

function step(input: Loose): EnrichStep {
  const kind = input['kind'];
  if (typeof kind !== 'string' || !(STEP_KINDS as readonly string[]).includes(kind)) {
    throw new StepInvalid('类型不对，只能是文本拼接、正则替换、查找表、HTTP 查询或图中文字识别');
  }
  switch (kind as EnrichStep['kind']) {
    case 'template':
      return template(input);
    case 'regexReplace':
      return regexReplace(input);
    case 'lookup':
      return lookup(input);
    case 'http':
      return http(input);
    case 'imageText':
      return imageText(input);
  }
}

function imageText(input: Loose): ImageTextStep {
  const pattern = text(input['pattern'], STEP_LIMITS.patternLength, '正则');
  const flags = flagSet(input['flags'], MATCH_FLAGS);
  try {
    new RegExp(wrapImageTextPattern(pattern), flags);
  } catch {
    throw new StepInvalid('正则写法不对，无法解析');
  }
  return {
    kind: 'imageText',
    pattern,
    flags,
    preferredArea: codeArea(input['preferredArea']),
    whenMissing: pick(input['whenMissing'], IMAGE_TEXT_MISSING_POLICIES, '没有说明认不出时怎么办'),
    output: field(input['output']),
  };
}

/** 优先区域：四个有限的数，左 < 右、上 < 下，离二维码不超过 areaExtent 个边长；null 表示不分先后。 */
function codeArea(value: unknown): CodeRelativeArea | null {
  if (value === null || value === undefined) {
    return null;
  }
  const area = asLoose(value);
  const [left, top, right, bottom] = ['left', 'top', 'right', 'bottom'].map((key) => area[key]);
  const inRange = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= STEP_LIMITS.areaExtent;
  if (!inRange(left) || !inRange(top) || !inRange(right) || !inRange(bottom) || left >= right || top >= bottom) {
    throw new StepInvalid(`优先区域要左小于右、上小于下，离二维码不超过 ${STEP_LIMITS.areaExtent} 个边长`);
  }
  return { left, top, right, bottom };
}

/** 正则标志：只能是 allowed 里的字母、不重复；按字母顺序存。 */
function flagSet(value: unknown, allowed: string): string {
  const flags = value ?? '';
  if (
    typeof flags !== 'string' ||
    [...flags].some((flag) => !allowed.includes(flag)) ||
    new Set(flags).size !== flags.length
  ) {
    throw new StepInvalid(`正则标志只能是 ${[...allowed].join(' ')} 中的几个`);
  }
  return [...flags].sort().join('');
}

function template(input: Loose): TemplateStep {
  return {
    kind: 'template',
    text: text(input['text'], STEP_LIMITS.textLength, '文本'),
    output: field(input['output']),
  };
}

function regexReplace(input: Loose): RegexReplaceStep {
  const pattern = text(input['pattern'], STEP_LIMITS.patternLength, '正则');
  const flags = flagSet(input['flags'], REPLACE_FLAGS);
  try {
    new RegExp(pattern, flags);
  } catch {
    throw new StepInvalid('正则写法不对，无法解析');
  }
  const replacement = input['replacement'] ?? '';
  if (typeof replacement !== 'string' || replacement.length > STEP_LIMITS.replacementLength) {
    throw new StepInvalid(`替换文本不能超过 ${STEP_LIMITS.replacementLength} 个字符`);
  }
  return {
    kind: 'regexReplace',
    input: inputField(input['input']),
    pattern,
    flags,
    replacement,
    output: field(input['output']),
  };
}

function lookup(input: Loose): LookupStep {
  const tableId = input['tableId'];
  if (typeof tableId !== 'string' || !LOOKUP_TABLE_ID_PATTERN.test(tableId)) {
    throw new StepInvalid('没有选择查找表');
  }
  const ignoreCase = input['ignoreCase'];
  if (typeof ignoreCase !== 'boolean') {
    throw new StepInvalid('没有说明是否忽略大小写');
  }
  const lookupOutput = (item: Loose): LookupOutput => ({
    column: text(item['column'], STEP_LIMITS.columnLength, '列名'),
    field: field(item['field']),
  });
  const outputs = outputList(input['outputs'], lookupOutput);
  return {
    kind: 'lookup',
    input: inputField(input['input']),
    tableId,
    keyColumn: text(input['keyColumn'], STEP_LIMITS.columnLength, '匹配列'),
    ignoreCase,
    outputs,
  };
}

function http(input: Loose): HttpStep {
  const method = pick(input['method'], HTTP_METHODS, '请求方法只能是 GET 或 POST');
  const url = httpUrl(input['url']);
  const headers = list(input['headers']).map((item) => header(asLoose(item)));
  if (headers.length > STEP_LIMITS.headers) {
    throw new StepInvalid(`请求头最多 ${STEP_LIMITS.headers} 个`);
  }
  const body = input['body'] ?? '';
  if (typeof body !== 'string' || body.length > STEP_LIMITS.bodyLength) {
    throw new StepInvalid(`请求体不能超过 ${STEP_LIMITS.bodyLength} 个字符`);
  }
  const outputs = outputList(input['outputs'], (item): HttpOutput => {
    const path = text(item['path'], STEP_LIMITS.pathLength, '取值路径');
    if (!parseJsonPath(path)) {
      throw new StepInvalid(`取值路径「${path}」写法不对，例如 data.shelf 或 items[0].name`);
    }
    return { path, field: field(item['field']) };
  });
  return {
    kind: 'http',
    method,
    url,
    headers,
    body,
    timeoutMs: integer(input['timeoutMs'], STEP_LIMITS.timeoutMs, '超时（毫秒）'),
    cacheSeconds: integer(input['cacheSeconds'], STEP_LIMITS.cacheSeconds, '缓存时间（秒）'),
    outputs,
    onError: pick(input['onError'], HTTP_ERROR_POLICIES, '没有说明查询失败时怎么办'),
  };
}

/** 地址必须以 http:// 或 https:// 加主机名开头；主机名里不能放变量（防止拼出任意地址）。 */
function httpUrl(value: unknown): string {
  const url = text(value, STEP_LIMITS.urlLength, '地址');
  const origin = /^https?:\/\/[^/?#]+/i.exec(url)?.[0] ?? '';
  if (origin === '' || origin.includes('{')) {
    throw new StepInvalid('地址要以 http:// 或 https:// 加固定的主机名开头，主机名里不能用变量');
  }
  try {
    new URL(url.replace(VARIABLE_PATTERN, URL_PLACEHOLDER));
  } catch {
    throw new StepInvalid('地址写法不对');
  }
  return url;
}

function header(input: Loose): HttpHeader {
  const name = input['name'];
  if (typeof name !== 'string' || name.length > STEP_LIMITS.headerNameLength || !HEADER_NAME_PATTERN.test(name)) {
    throw new StepInvalid(`请求头名称不对：「${String(name ?? '')}」`);
  }
  const value = input['value'];
  if (typeof value !== 'string' || value.length > STEP_LIMITS.headerValueLength || /[\r\n]/.test(value)) {
    throw new StepInvalid(`请求头「${name}」的值不能换行，不能超过 ${STEP_LIMITS.headerValueLength} 个字符`);
  }
  return { name, value };
}

function outputList<T extends { field: string }>(value: unknown, parse: (item: Loose) => T): T[] {
  const outputs = list(value).map((item) => parse(asLoose(item)));
  if (outputs.length === 0 || outputs.length > STEP_LIMITS.outputs) {
    throw new StepInvalid(`要产出 1–${STEP_LIMITS.outputs} 个字段`);
  }
  const seen = new Set<string>();
  for (const output of outputs) {
    if (seen.has(output.field)) {
      throw new StepInvalid(`产出的字段重复：「${output.field}」`);
    }
    seen.add(output.field);
  }
  return outputs;
}

/** null 表示完整内容。 */
function inputField(value: unknown): string | null {
  return value === null || value === undefined ? null : field(value);
}

function field(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!isValidFieldName(name)) {
    throw new StepInvalid(
      `字段名要有 1–${RULE_LIMITS.fieldNameLength} 个字符，不能含花括号、换行或控制字符：「${String(value ?? '')}」`,
    );
  }
  return name;
}

function text(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new StepInvalid(`${label}要有 1–${maxLength} 个字符`);
  }
  return value;
}

function integer(value: unknown, range: { min: number; max: number }, label: string): number {
  if (!Number.isInteger(value) || (value as number) < range.min || (value as number) > range.max) {
    throw new StepInvalid(`${label}要在 ${range.min}–${range.max} 之间`);
  }
  return value as number;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new StepInvalid(message);
  }
  return value as T;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asLoose(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}
