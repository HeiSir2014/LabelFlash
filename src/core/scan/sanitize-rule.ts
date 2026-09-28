import {
  type DelimitedRule,
  isValidFieldName,
  type KeyValueField,
  type KeyValueRule,
  namedGroups,
  REGEX_FLAGS,
  type RegexRule,
  RULE_KINDS,
  RULE_LIMITS,
  type ScanRule,
  WHOLE_CHARSETS,
  type WholeRule,
} from './rule-model';

/** 规则不合法的原因（中文，直接展示给配置规则的人）。 */
export interface RuleIssue {
  issue: string;
}

export function isRuleIssue(value: ScanRule | RuleIssue): value is RuleIssue {
  return 'issue' in value;
}

class RuleInvalid extends Error {}

type Loose = Record<string, unknown>;

/**
 * 校验来自界面、数据库或导入文件的规则。和模板不同，这里不做静默修正：
 * 规则写错会导致扫码识别出错，必须明确告诉配置的人哪里不对。id 永远取调用方给的值。
 */
export function sanitizeRule(value: unknown, id: string): ScanRule | RuleIssue {
  try {
    const input = asLoose(value);
    const kind = input['kind'];
    if (typeof kind !== 'string' || !(RULE_KINDS as readonly string[]).includes(kind)) {
      throw new RuleInvalid('规则类型不对，只能是分隔符拆分、多行键值、整段匹配或正则');
    }
    const name = text(input['name'], RULE_LIMITS.nameLength, '规则名称');
    switch (kind as ScanRule['kind']) {
      case 'delimited':
        return delimited(input, id, name);
      case 'keyValue':
        return keyValue(input, id, name);
      case 'whole':
        return whole(input, id, name);
      case 'regex':
        return regex(input, id, name);
    }
  } catch (error) {
    if (error instanceof RuleInvalid) {
      return { issue: error.message };
    }
    throw error;
  }
}

function delimited(input: Loose, id: string, name: string): DelimitedRule {
  const delimiter = input['delimiter'];
  if (typeof delimiter !== 'string' || delimiter.length === 0 || delimiter.length > RULE_LIMITS.delimiterLength) {
    throw new RuleInvalid(`分隔符要有 1–${RULE_LIMITS.delimiterLength} 个字符`);
  }
  const { min, max } = RULE_LIMITS.delimitedFields;
  const fields = fieldNames(input['fields']);
  if (fields.length < min || fields.length > max) {
    throw new RuleInvalid(`分隔符拆分要有 ${min}–${max} 个字段`);
  }
  const overflowIndex = input['overflowIndex'];
  if (!Number.isInteger(overflowIndex) || (overflowIndex as number) < 0 || (overflowIndex as number) >= fields.length) {
    throw new RuleInvalid('多出来的分隔符要并入一个已有的字段');
  }
  return { id, name, kind: 'delimited', delimiter, fields, overflowIndex: overflowIndex as number };
}

function keyValue(input: Loose, id: string, name: string): KeyValueRule {
  const separators = list(input['separators']).map((separator) => {
    if (typeof separator !== 'string' || separator.length === 0 || separator.length > RULE_LIMITS.separatorLength) {
      throw new RuleInvalid(`键值分隔符要有 1–${RULE_LIMITS.separatorLength} 个字符`);
    }
    if (separator.includes('\n')) {
      throw new RuleInvalid('键值分隔符不能是换行');
    }
    return separator;
  });
  if (separators.length === 0 || separators.length > RULE_LIMITS.separators) {
    throw new RuleInvalid(`键值分隔符要有 1–${RULE_LIMITS.separators} 个`);
  }
  const fields = list(input['fields']).map(keyValueField);
  if (fields.length === 0 || fields.length > RULE_LIMITS.keyValueFields) {
    throw new RuleInvalid(`多行键值要登记 1–${RULE_LIMITS.keyValueFields} 个字段`);
  }
  assertUnique(
    fields.map((field) => field.name),
    '字段名',
  );
  // 所有写法（字段名和别名）不区分大小写都不能重复，否则同一个键对应两个字段。
  assertUnique(
    fields.flatMap((field) => [field.name, ...field.aliases]).map((key) => key.toLowerCase()),
    '字段名或别名',
    '别名',
  );
  const names = new Set(fields.map((field) => field.name));
  const required = list(input['required']).map((value) => {
    if (typeof value !== 'string' || !names.has(value)) {
      throw new RuleInvalid('必填字段必须是已登记的字段');
    }
    return value;
  });
  const keepUnknown = input['keepUnknown'];
  if (typeof keepUnknown !== 'boolean') {
    throw new RuleInvalid('没有说明是否保留未登记的键');
  }
  return { id, name, kind: 'keyValue', separators, fields, required: [...new Set(required)], keepUnknown };
}

function keyValueField(value: unknown): KeyValueField {
  const input = asLoose(value);
  const name = fieldName(input['name']);
  const aliases = list(input['aliases']).map((alias) => text(alias, RULE_LIMITS.aliasLength, '别名'));
  if (aliases.length > RULE_LIMITS.aliasesPerField) {
    throw new RuleInvalid(`每个字段最多 ${RULE_LIMITS.aliasesPerField} 个别名`);
  }
  return { name, aliases };
}

function whole(input: Loose, id: string, name: string): WholeRule {
  const field = fieldName(input['field']);
  const charset = input['charset'];
  if (typeof charset !== 'string' || !(WHOLE_CHARSETS as readonly string[]).includes(charset)) {
    throw new RuleInvalid('字符集只能是纯数字、字母加数字或不限');
  }
  const { min, max } = RULE_LIMITS.wholeLength;
  const minLength = input['minLength'];
  const maxLength = input['maxLength'];
  const isLength = (length: unknown) =>
    Number.isInteger(length) && (length as number) >= min && (length as number) <= max;
  if (!isLength(minLength) || !isLength(maxLength) || (minLength as number) > (maxLength as number)) {
    throw new RuleInvalid(`长度范围要在 ${min}–${max} 之间，且最短不能大于最长`);
  }
  return {
    id,
    name,
    kind: 'whole',
    field,
    charset: charset as WholeRule['charset'],
    minLength: minLength as number,
    maxLength: maxLength as number,
  };
}

function regex(input: Loose, id: string, name: string): RegexRule {
  const pattern = input['pattern'];
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new RuleInvalid('正则不能为空');
  }
  if (pattern.length > RULE_LIMITS.patternLength) {
    throw new RuleInvalid(`正则不能超过 ${RULE_LIMITS.patternLength} 个字符`);
  }
  const flags = input['flags'] ?? '';
  if (
    typeof flags !== 'string' ||
    [...flags].some((flag) => !REGEX_FLAGS.includes(flag)) ||
    new Set(flags).size !== flags.length
  ) {
    throw new RuleInvalid(`正则标志只能是 ${[...REGEX_FLAGS].join(' ')} 中的几个`);
  }
  let groups: string[];
  try {
    groups = namedGroups(pattern, flags);
  } catch {
    throw new RuleInvalid('正则写法不对，无法解析');
  }
  if (groups.length === 0) {
    throw new RuleInvalid('正则至少要有一个命名分组，例如 (?<订单号>\\d+)，分组名就是字段名');
  }
  for (const group of groups) {
    if (!isValidFieldName(group)) {
      throw new RuleInvalid(`命名分组「${group}」不能作为字段名`);
    }
  }
  return { id, name, kind: 'regex', pattern, flags: [...flags].sort().join('') };
}

function fieldNames(value: unknown): string[] {
  const names = list(value).map(fieldName);
  assertUnique(names, '字段名');
  return names;
}

function fieldName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!isValidFieldName(name)) {
    throw new RuleInvalid(
      `字段名要有 1–${RULE_LIMITS.fieldNameLength} 个字符，不能含花括号、换行或控制字符：「${String(value ?? '')}」`,
    );
  }
  return name;
}

function text(value: unknown, maxLength: number, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '' || trimmed.length > maxLength) {
    throw new RuleInvalid(`${label}要有 1–${maxLength} 个字符`);
  }
  return trimmed;
}

function assertUnique(values: string[], label: string, reason = label): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new RuleInvalid(`${reason}重复：「${value}」（${label}不能重复）`);
    }
    seen.add(value);
  }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asLoose(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}
