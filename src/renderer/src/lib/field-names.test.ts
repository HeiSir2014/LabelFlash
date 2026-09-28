import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES } from '../../../core/scan/builtin-rules';
import type { ScanRule } from '../../../core/scan/rule-model';
import type { ScanResult } from '../../../core/scan/scan-result';
import { fieldNameSuggestions, ruleFieldNames } from './field-names';

const REGEX_WITH_STEPS: ScanRule = {
  id: 'custom:re',
  name: '正则',
  kind: 'regex',
  pattern: '^(?<单号>\\w+)#(?<尺码>\\w+)$',
  flags: '',
  steps: [
    { kind: 'template', text: 'x', output: '链接' },
    {
      kind: 'lookup',
      input: '单号',
      tableId: 't',
      keyColumn: '单号',
      ignoreCase: false,
      outputs: [{ column: '货架', field: '货架号' }],
    },
  ],
};

describe('ruleFieldNames', () => {
  test('collects recognised fields and fields produced by processing steps', () => {
    expect(ruleFieldNames(REGEX_WITH_STEPS)).toEqual(['单号', '尺码', '链接', '货架号']);
    const [dashThree] = BUILT_IN_RULES;
    if (!dashThree) throw new Error('built-in rules missing');
    expect(ruleFieldNames(dashThree)).toEqual(['编码', '颜色', '尺码']);
  });

  test('ignores a regex that no longer compiles', () => {
    expect(ruleFieldNames({ ...REGEX_WITH_STEPS, pattern: '(', steps: [] })).toEqual([]);
  });
});

describe('fieldNameSuggestions', () => {
  test('lists this scan first, then the rules in order, without duplicates', () => {
    const scan: ScanResult = {
      raw: 'x',
      ruleId: 'builtin:raw',
      ruleName: '原样打印',
      fields: [
        { name: '内容', value: 'x' },
        { name: '尺码', value: 'M' },
      ],
    };
    const suggestions = fieldNameSuggestions([...BUILT_IN_RULES, REGEX_WITH_STEPS], scan);
    expect(suggestions.slice(0, 4)).toEqual(['内容', '尺码', '编码', '颜色']);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect(suggestions).toContain('货架号');
  });

  test('works without a scan', () => {
    expect(fieldNameSuggestions([REGEX_WITH_STEPS], null)).toEqual(['单号', '尺码', '链接', '货架号']);
  });
});
