import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES } from './builtin-rules';
import { RULE_LIMITS, type ScanRule } from './rule-model';
import { isRuleIssue, sanitizeRule } from './sanitize-rule';

const ID = 'custom:test-1';

function issueOf(value: unknown): string {
  const result = sanitizeRule(value, ID);
  if (!isRuleIssue(result)) {
    throw new Error(`expected an issue, got ${JSON.stringify(result)}`);
  }
  return result.issue;
}

function ruleOf(value: unknown): ScanRule {
  const result = sanitizeRule(value, ID);
  if (isRuleIssue(result)) {
    throw new Error(`expected a rule, got issue ${result.issue}`);
  }
  return result;
}

const DELIMITED = {
  kind: 'delimited',
  name: '下划线',
  delimiter: '_',
  fields: ['款号', '颜色', '尺码'],
  overflowIndex: 0,
};
const KEY_VALUE = {
  kind: 'keyValue',
  name: '键值',
  separators: [':', '：'],
  fields: [
    { name: '订单号', aliases: ['单号', 'Order'] },
    { name: '尺码', aliases: ['Size'] },
  ],
  required: ['订单号'],
  keepUnknown: false,
};
const WHOLE = { kind: 'whole', name: '单号', field: '订单号', charset: 'digits', minLength: 8, maxLength: 30 };
const REGEX = { kind: 'regex', name: '正则', pattern: '^(?<款号>[A-Z]+\\d+)#(?<尺码>\\w+)$', flags: 'i' };

describe('sanitizeRule', () => {
  test('accepts a valid rule of every kind and always uses the given id', () => {
    for (const value of [DELIMITED, KEY_VALUE, WHOLE, REGEX]) {
      const rule = ruleOf({ ...value, id: 'builtin:spoofed' });
      expect(rule.id).toBe(ID);
      expect(rule.kind).toBe(value.kind as ScanRule['kind']);
    }
  });

  test('trims names and field names', () => {
    const rule = ruleOf({ ...DELIMITED, name: '  下划线  ', fields: [' 款号 ', '颜色', '尺码'] });
    expect(rule.name).toBe('下划线');
    expect(rule.kind === 'delimited' && rule.fields).toEqual(['款号', '颜色', '尺码']);
  });

  test('rejects unknown kinds and missing names', () => {
    expect(issueOf({ ...DELIMITED, kind: 'script' })).toContain('类型');
    expect(issueOf({ ...DELIMITED, name: '   ' })).toContain('名称');
    expect(issueOf(null)).toContain('类型');
  });

  test('rejects field names that cannot be used as note variables', () => {
    for (const bad of ['', '款{号}', '换\n行', 'x'.repeat(RULE_LIMITS.fieldNameLength + 1)]) {
      expect(issueOf({ ...DELIMITED, fields: [bad, '颜色', '尺码'] })).toContain('字段名');
    }
    expect(issueOf({ ...DELIMITED, fields: ['颜色', '颜色', '尺码'] })).toContain('重复');
  });

  test('checks delimited rules', () => {
    expect(issueOf({ ...DELIMITED, fields: ['款号'] })).toContain('2');
    expect(issueOf({ ...DELIMITED, fields: Array.from({ length: 11 }, (_, i) => `字段${i}`) })).toContain('10');
    expect(issueOf({ ...DELIMITED, delimiter: '' })).toContain('分隔符');
    expect(issueOf({ ...DELIMITED, delimiter: '----' })).toContain('分隔符');
    expect(issueOf({ ...DELIMITED, overflowIndex: 3 })).toContain('并入');
    expect(ruleOf({ ...DELIMITED, delimiter: '\n' }).kind).toBe('delimited');
  });

  test('checks key-value rules', () => {
    expect(issueOf({ ...KEY_VALUE, required: ['数量'] })).toContain('必填');
    expect(issueOf({ ...KEY_VALUE, separators: [] })).toContain('分隔符');
    expect(
      issueOf({
        ...KEY_VALUE,
        fields: [
          { name: '订单号', aliases: ['单号'] },
          { name: '尺码', aliases: ['单号'] },
        ],
      }),
    ).toContain('别名');
  });

  test('checks whole-content rules', () => {
    expect(issueOf({ ...WHOLE, minLength: 20, maxLength: 10 })).toContain('长度');
    expect(issueOf({ ...WHOLE, charset: 'emoji' })).toContain('字符');
  });

  test('checks regex rules', () => {
    expect(issueOf({ ...REGEX, pattern: '(?<款号>[A-Z' })).toContain('正则');
    expect(issueOf({ ...REGEX, pattern: '^([A-Z]+)$' })).toContain('命名分组');
    expect(issueOf({ ...REGEX, flags: 'g' })).toContain('标志');
    expect(issueOf({ ...REGEX, pattern: `(?<款号>${'a'.repeat(RULE_LIMITS.patternLength)})` })).toContain(
      String(RULE_LIMITS.patternLength),
    );
  });

  test('every built-in rule passes its own validation', () => {
    for (const rule of BUILT_IN_RULES) {
      const result = sanitizeRule(rule, rule.id);
      expect(isRuleIssue(result) ? result.issue : result).toEqual(rule);
    }
  });
});
