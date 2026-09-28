import type { EnrichStep } from './enrich-model';
import { MAX_RAW_LENGTH } from './normalize-raw';

/**
 * 识别规则：纯数据，可以导出成 JSON 分享给别的厂家。四种类型：
 * - delimited：按分隔符拆成固定顺序的字段（例如 编码-颜色-尺码）。
 * - keyValue：每行一个「键:值」，键名可以有多个别名。
 * - whole：整段内容就是一个字段（例如纯数字订单号），可以限制字符集和长度。
 * - regex：用命名分组取字段；在隔离环境里带超时执行。
 */
export const RULE_KINDS = ['delimited', 'keyValue', 'whole', 'regex'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const WHOLE_CHARSETS = ['digits', 'alphanumeric', 'any'] as const;
export type WholeCharset = (typeof WHOLE_CHARSETS)[number];

interface RuleBase {
  id: string;
  name: string;
  /** 识别之后依次执行的加工步骤（见 enrich-model.ts）。 */
  steps: EnrichStep[];
}

export interface DelimitedRule extends RuleBase {
  kind: 'delimited';
  /** 1–3 个字符；可以是换行或制表符。 */
  delimiter: string;
  fields: string[];
  /** 段数多于字段数时，多出来的分隔符并入这个字段（例如编码本身带「-」）。 */
  overflowIndex: number;
}

export interface KeyValueField {
  name: string;
  /** 其他写法（不区分大小写），例如「单号」「Order」都算「订单号」。 */
  aliases: string[];
}

export interface KeyValueRule extends RuleBase {
  kind: 'keyValue';
  /** 键和值之间的分隔符，每行按最先出现的那个拆开。 */
  separators: string[];
  fields: KeyValueField[];
  /** 这些字段都识别到才算匹配；为空时至少要识别到一个登记过的字段。 */
  required: string[];
  /** 保留没有登记的键（键名必须是合法的字段名）。 */
  keepUnknown: boolean;
}

export interface WholeRule extends RuleBase {
  kind: 'whole';
  field: string;
  charset: WholeCharset;
  minLength: number;
  maxLength: number;
}

export interface RegexRule extends RuleBase {
  kind: 'regex';
  pattern: string;
  /** 只允许 i m s u。 */
  flags: string;
}

export type ScanRule = DelimitedRule | KeyValueRule | WholeRule | RegexRule;

export const RULE_LIMITS = {
  nameLength: 30,
  fieldNameLength: 20,
  delimiterLength: 3,
  delimitedFields: { min: 2, max: 10 },
  keyValueFields: 20,
  aliasesPerField: 10,
  aliasLength: 30,
  separators: 5,
  separatorLength: 3,
  wholeLength: { min: 1, max: MAX_RAW_LENGTH },
  patternLength: 300,
  customRules: 50,
} as const;

export const REGEX_FLAGS = 'imsu';

export const BUILT_IN_RULE_PREFIX = 'builtin:';
export const CUSTOM_RULE_PREFIX = 'custom:';
export const RULE_ID_PATTERN = /^(builtin|custom):[\w-]{1,64}$/;

export function isBuiltInRuleId(id: string): boolean {
  return id.startsWith(BUILT_IN_RULE_PREFIX);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 字段名里不允许任何控制字符
const FIELD_NAME_FORBIDDEN = /[{}\u0000-\u001f\u007f]/;

/** 字段名同时是备注变量名（{字段名}），所以不能含花括号、换行和控制字符。 */
export function isValidFieldName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= RULE_LIMITS.fieldNameLength &&
    name === name.trim() &&
    !FIELD_NAME_FORBIDDEN.test(name)
  );
}

/** 正则里的命名分组名（按出现顺序）；正则非法时抛出 SyntaxError。 */
export function namedGroups(pattern: string, flags: string): string[] {
  // 在正则后面接一个能匹配空串的分支：exec('') 必定成功，groups 里就有全部命名分组的键。
  const groups = new RegExp(`(?:${pattern})|`, flags).exec('')?.groups;
  return groups ? Object.keys(groups) : [];
}
