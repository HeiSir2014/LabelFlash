/**
 * 加工步骤：识别出字段之后，按顺序生成新字段（纯数据，随规则导出）。
 * - template：用变量拼出一段文本，例如把订单号拼成 URL。
 * - regexReplace：对一个字段做正则替换，例如去掉前缀。
 * - lookup：拿一个字段去本机的查找表里查，取出其他列。
 * - http：拿字段去调用 HTTP 接口，从返回的 JSON 里取值。
 */
export const STEP_KINDS = ['template', 'regexReplace', 'lookup', 'http'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface TemplateStep {
  kind: 'template';
  /** 支持 {字段名} {完整内容} {规则} {日期} {时间}。 */
  text: string;
  output: string;
}

export interface RegexReplaceStep {
  kind: 'regexReplace';
  /** 要处理的字段；null = 完整内容。 */
  input: string | null;
  pattern: string;
  /** 只允许 g i m s u。 */
  flags: string;
  /** 支持 $1、$<名字>。 */
  replacement: string;
  output: string;
}

/** 从查找表或 HTTP 返回里取一个值放进字段。 */
export interface LookupOutput {
  /** 查找表：列名。 */
  column: string;
  field: string;
}

export interface LookupStep {
  kind: 'lookup';
  input: string | null;
  tableId: string;
  /** 按哪一列匹配。 */
  keyColumn: string;
  ignoreCase: boolean;
  outputs: LookupOutput[];
}

export const HTTP_METHODS = ['GET', 'POST'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** empty = 照常打印，输出字段为空；block = 拦下不打印。 */
export const HTTP_ERROR_POLICIES = ['empty', 'block'] as const;
export type HttpErrorPolicy = (typeof HTTP_ERROR_POLICIES)[number];

export interface HttpHeader {
  name: string;
  /** 支持字段变量和 {密钥:名称}。 */
  value: string;
}

export interface HttpOutput {
  /** 简单路径：data.shelf、items[0].name。 */
  path: string;
  field: string;
}

export interface HttpStep {
  kind: 'http';
  method: HttpMethod;
  /** 支持字段变量（按 URL 编码）。 */
  url: string;
  headers: HttpHeader[];
  /** POST 的 JSON 请求体，支持字段变量（按 JSON 字符串转义）；GET 时忽略。 */
  body: string;
  timeoutMs: number;
  cacheSeconds: number;
  outputs: HttpOutput[];
  onError: HttpErrorPolicy;
}

export type EnrichStep = TemplateStep | RegexReplaceStep | LookupStep | HttpStep;

export const STEP_LIMITS = {
  steps: 10,
  textLength: 500,
  patternLength: 300,
  replacementLength: 200,
  outputs: 10,
  columnLength: 50,
  headers: 10,
  headerNameLength: 64,
  headerValueLength: 500,
  urlLength: 1_000,
  bodyLength: 2_000,
  pathLength: 100,
  timeoutMs: { min: 200, max: 5_000, default: 1_500 },
  cacheSeconds: { min: 0, max: 3_600, default: 60 },
} as const;

export const REPLACE_FLAGS = 'gimsu';
export const LOOKUP_TABLE_ID_PATTERN = /^[\w-]{1,64}$/;
/** 请求头名称：HTTP token 字符。 */
export const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** 请求头里引用本机密钥：{密钥:名称}。 */
export const SECRET_REFERENCE_PATTERN = /\{密钥:([^{}\n]{1,30})\}/g;

/** 写进请求头的密钥引用，和 SECRET_REFERENCE_PATTERN 对应。 */
export function secretReference(name: string): string {
  return `{密钥:${name}}`;
}

export const SECRET_LIMITS = { nameLength: 30, valueLength: 4_096 } as const;

/** 密钥名称：1–30 个字符，不含花括号和控制字符，首尾没有空白（要能写进 {密钥:名称}）。 */
export function isValidSecretName(name: string): boolean {
  return (
    name.length > 0 && name.length <= SECRET_LIMITS.nameLength && name === name.trim() && !/[{}\p{Cc}]/u.test(name)
  );
}

/** 密钥内容会放进请求头：不能为空、不能换行。 */
export function isValidSecretValue(value: string): boolean {
  return value.length > 0 && value.length <= SECRET_LIMITS.valueLength && !/[\r\n]/.test(value);
}

/** 正则替换执行器：返回替换后的文本，超时返回 null。主进程注入隔离实现。 */
export type RegexReplacer = (pattern: string, flags: string, input: string, replacement: string) => string | null;
