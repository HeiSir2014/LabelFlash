import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES } from './builtin-rules';
import { type RegexRunner, recognize } from './recognize';
import type { ScanRule } from './rule-model';
import type { ScanResult } from './scan-result';

/** 测试里直接用本进程的正则（超时保护由主进程的 sandboxed-regex 负责，另有测试）。 */
const runRegex: RegexRunner = (pattern, flags, input) => {
  const groups = new RegExp(pattern, flags).exec(input)?.groups;
  return groups ? { ...groups } : null;
};

function builtIn<K extends ScanRule['kind']>(id: string, kind: K): Extract<ScanRule, { kind: K }> {
  const rule = BUILT_IN_RULES.find((candidate) => candidate.id === id);
  if (rule?.kind !== kind) {
    throw new Error(`built-in rule ${id} is not ${kind}`);
  }
  return rule as Extract<ScanRule, { kind: K }>;
}
const DASH = builtIn('builtin:dash-three', 'delimited');
const DIGITS = builtIn('builtin:digits-order', 'whole');
const KEY_VALUE = builtIn('builtin:key-value', 'keyValue');
const RAW = builtIn('builtin:raw', 'whole');

const fieldsOf = (result: ScanResult | null) =>
  result ? Object.fromEntries(result.fields.map(({ name, value }) => [name, value])) : null;

describe('recognize: delimited', () => {
  test('splits code, colour and size with extra hyphens kept in the code', () => {
    const result = recognize('CL5640-TK-图片色-XL', [DASH], runRegex);
    expect(result).toEqual({
      raw: 'CL5640-TK-图片色-XL',
      ruleId: DASH.id,
      ruleName: DASH.name,
      fields: [
        { name: '编码', value: 'CL5640-TK' },
        { name: '颜色', value: '图片色' },
        { name: '尺码', value: 'XL' },
      ],
    });
  });

  test('merges the overflow into the chosen field, whichever position it has', () => {
    const lastAbsorbs: ScanRule = { ...DASH, id: 'custom:last', fields: ['款号', '颜色', '备注'], overflowIndex: 2 };
    expect(fieldsOf(recognize('A1-红-左袖-加长', [lastAbsorbs], runRegex))).toEqual({
      款号: 'A1',
      颜色: '红',
      备注: '左袖-加长',
    });
  });

  test('trims each part and rejects empty parts or too few parts', () => {
    expect(fieldsOf(recognize('CL1- 红 -36', [DASH], runRegex))).toEqual({ 编码: 'CL1', 颜色: '红', 尺码: '36' });
    for (const raw of ['CL5640', 'CL5640-36', '-红-36', 'CL1--36', 'CL1-红-']) {
      expect(recognize(raw, [DASH], runRegex)).toBeNull();
    }
  });

  test('supports other delimiters, and line breaks as the delimiter', () => {
    const underscore: ScanRule = { ...DASH, id: 'custom:underscore', delimiter: '_' };
    expect(fieldsOf(recognize('CL1_红_M', [underscore], runRegex))).toEqual({ 编码: 'CL1', 颜色: '红', 尺码: 'M' });
    const lines: ScanRule = { ...DASH, id: 'custom:lines', delimiter: '\n' };
    expect(fieldsOf(recognize('CL1\n红\nM', [lines], runRegex))).toEqual({ 编码: 'CL1', 颜色: '红', 尺码: 'M' });
    // 分隔符不是换行时，多行内容不按它拆。
    expect(recognize('CL1-红\n-M', [DASH], runRegex)).toBeNull();
  });
});

describe('recognize: key-value', () => {
  test('reads lines with mixed separators, aliases in any case, and keeps unknown keys', () => {
    const result = recognize('order no: 2026001\n货号：CL5640\nSize=M\n批次:B7\n随便一行', [KEY_VALUE], runRegex);
    expect(result?.fields).toEqual([
      { name: '订单号', value: '2026001' },
      { name: '款号', value: 'CL5640' },
      { name: '尺码', value: 'M' },
      { name: '批次', value: 'B7' },
    ]);
  });

  test('keeps the first value when a key repeats, and splits at the earliest separator', () => {
    expect(fieldsOf(recognize('尺码:M\n尺码:L\n备注:a=b', [KEY_VALUE], runRegex))).toEqual({
      尺码: 'M',
      备注: 'a=b',
    });
  });

  test('needs every required field, or at least one registered field when none is required', () => {
    const strict: ScanRule = { ...KEY_VALUE, id: 'custom:strict', required: ['订单号', '尺码'] };
    expect(recognize('订单号:1\n颜色:红', [strict], runRegex)).toBeNull();
    expect(fieldsOf(recognize('订单号:1\n尺码:M', [strict], runRegex))).toEqual({ 订单号: '1', 尺码: 'M' });
    expect(recognize('批次:B7\n仓库:1', [KEY_VALUE], runRegex)).toBeNull();
  });

  test('ignores unknown keys when told to, and keys that are not valid field names', () => {
    const closed: ScanRule = { ...KEY_VALUE, id: 'custom:closed', keepUnknown: false };
    expect(fieldsOf(recognize('尺码:M\n批次:B7', [closed], runRegex))).toEqual({ 尺码: 'M' });
    expect(fieldsOf(recognize('尺码:M\n{坏键}:1', [KEY_VALUE], runRegex))).toEqual({ 尺码: 'M' });
  });
});

describe('recognize: whole content', () => {
  test('takes a numeric order number within the length range', () => {
    expect(fieldsOf(recognize('202609281234567', [DIGITS], runRegex))).toEqual({ 订单号: '202609281234567' });
    for (const raw of ['1234567', '1'.repeat(31), '2026A9281234567']) {
      expect(recognize(raw, [DIGITS], runRegex)).toBeNull();
    }
  });

  test('prints anything as-is, including multi-line content', () => {
    expect(fieldsOf(recognize('https://example.com/a?b=1\n第二行', [RAW], runRegex))).toEqual({
      内容: 'https://example.com/a?b=1\n第二行',
    });
  });

  test('allows only single-line content for digits and letters', () => {
    const alnum: ScanRule = { ...DIGITS, id: 'custom:alnum', charset: 'alphanumeric' };
    expect(recognize('AB12345678', [alnum], runRegex)).not.toBeNull();
    expect(recognize('AB1234\n5678', [alnum], runRegex)).toBeNull();
  });
});

describe('recognize: regex and ordering', () => {
  test('maps named groups to fields in pattern order', () => {
    const rule: ScanRule = {
      id: 'custom:re',
      name: '井号',
      kind: 'regex',
      pattern: '^(?<款号>\\w+)#(?<尺码>\\w+)$',
      flags: '',
    };
    expect(recognize('CL1#XL', [rule], runRegex)?.fields).toEqual([
      { name: '款号', value: 'CL1' },
      { name: '尺码', value: 'XL' },
    ]);
  });

  test('tries rules in order and falls through to the next one', () => {
    const rules = [DASH, DIGITS, KEY_VALUE, RAW];
    expect(recognize('CL1-红-M', rules, runRegex)?.ruleId).toBe(DASH.id);
    expect(recognize('202609281234567', rules, runRegex)?.ruleId).toBe(DIGITS.id);
    expect(recognize('订单号:1\n尺码:M', rules, runRegex)?.ruleId).toBe(KEY_VALUE.id);
    expect(recognize('随便什么', rules, runRegex)?.ruleId).toBe(RAW.id);
    expect(recognize('随便什么', [DASH, DIGITS], runRegex)).toBeNull();
  });

  test('normalises the raw content before matching', () => {
    expect(recognize(' 202609281234567\r\n', [DIGITS], runRegex)?.raw).toBe('202609281234567');
    expect(recognize('', [RAW], runRegex)).toBeNull();
  });
});
