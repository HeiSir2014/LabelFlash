import { normalizeRaw } from './normalize-raw';
import {
  type DelimitedRule,
  isValidFieldName,
  type KeyValueRule,
  namedGroups,
  type RegexRule,
  type ScanRule,
  type WholeRule,
} from './rule-model';
import type { ScanField, ScanResult } from './scan-result';

/**
 * 执行一条正则，返回参与了匹配的命名分组；不匹配或超时返回 null。
 * 主进程注入带超时的隔离实现（见 src/main/scan/sandboxed-regex.ts），核心层不直接执行来路不明的正则。
 */
export type RegexRunner = (pattern: string, flags: string, input: string) => Record<string, string> | null;

/** 按顺序逐条尝试规则（调用方只传入已启用的规则），返回第一条匹配的结果。 */
export function recognize(input: string, rules: readonly ScanRule[], runRegex: RegexRunner): ScanResult | null {
  const raw = normalizeRaw(input);
  if (raw === null) {
    return null;
  }
  for (const rule of rules) {
    const fields = extract(rule, raw, runRegex);
    if (fields) {
      return { raw, ruleId: rule.id, ruleName: rule.name, fields };
    }
  }
  return null;
}

function extract(rule: ScanRule, raw: string, runRegex: RegexRunner): ScanField[] | null {
  switch (rule.kind) {
    case 'delimited':
      return extractDelimited(rule, raw);
    case 'keyValue':
      return extractKeyValue(rule, raw);
    case 'whole':
      return extractWhole(rule, raw);
    case 'regex':
      return extractRegex(rule, raw, runRegex);
  }
}

function extractDelimited(rule: DelimitedRule, raw: string): ScanField[] | null {
  if (rule.delimiter !== '\n' && raw.includes('\n')) {
    return null;
  }
  const parts = raw.split(rule.delimiter);
  const extra = parts.length - rule.fields.length;
  if (extra < 0) {
    return null;
  }
  const at = rule.overflowIndex;
  const values = [
    ...parts.slice(0, at),
    parts.slice(at, at + extra + 1).join(rule.delimiter),
    ...parts.slice(at + extra + 1),
  ].map((value) => value.trim());
  if (values.some((value) => value === '')) {
    return null;
  }
  return rule.fields.map((name, index) => ({ name, value: values[index] ?? '' }));
}

function extractKeyValue(rule: KeyValueRule, raw: string): ScanField[] | null {
  const canonical = new Map<string, string>();
  for (const field of rule.fields) {
    for (const key of [field.name, ...field.aliases]) {
      canonical.set(key.toLowerCase(), field.name);
    }
  }
  const known = new Map<string, string>();
  const unknown = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const split = splitAtFirstSeparator(line, rule.separators);
    if (!split) {
      continue;
    }
    const [key, value] = split;
    const name = canonical.get(key.toLowerCase());
    if (name) {
      if (!known.has(name)) {
        known.set(name, value);
      }
    } else if (rule.keepUnknown && isValidFieldName(key) && !unknown.has(key)) {
      unknown.set(key, value);
    }
  }
  const isMatch = rule.required.length > 0 ? rule.required.every((name) => known.has(name)) : known.size > 0;
  if (!isMatch) {
    return null;
  }
  return [
    ...rule.fields
      .filter((field) => known.has(field.name))
      .map((field) => ({ name: field.name, value: known.get(field.name) ?? '' })),
    ...[...unknown].filter(([name]) => !known.has(name)).map(([name, value]) => ({ name, value })),
  ];
}

/** 按最先出现的分隔符把一行拆成键和值；键或值为空时返回 null。 */
function splitAtFirstSeparator(line: string, separators: readonly string[]): [string, string] | null {
  let best: { index: number; length: number } | null = null;
  for (const separator of separators) {
    const index = line.indexOf(separator);
    if (index > 0 && (best === null || index < best.index)) {
      best = { index, length: separator.length };
    }
  }
  if (!best) {
    return null;
  }
  const key = line.slice(0, best.index).trim();
  const value = line.slice(best.index + best.length).trim();
  return key !== '' && value !== '' ? [key, value] : null;
}

const CHARSET_PATTERNS = {
  digits: /^\d+$/,
  alphanumeric: /^[A-Za-z0-9]+$/,
} as const;

function extractWhole(rule: WholeRule, raw: string): ScanField[] | null {
  if (raw.length < rule.minLength || raw.length > rule.maxLength) {
    return null;
  }
  if (rule.charset !== 'any' && !CHARSET_PATTERNS[rule.charset].test(raw)) {
    return null;
  }
  return [{ name: rule.field, value: raw }];
}

function extractRegex(rule: RegexRule, raw: string, runRegex: RegexRunner): ScanField[] | null {
  const groups = runRegex(rule.pattern, rule.flags, raw);
  if (!groups) {
    return null;
  }
  const fields = namedGroups(rule.pattern, rule.flags)
    .map((name) => ({ name, value: groups[name]?.trim() ?? '' }))
    .filter((field) => field.value !== '');
  return fields.length > 0 ? fields : null;
}
