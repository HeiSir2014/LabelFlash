import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES, DASH_THREE_RULE_ID, RAW_RULE_ID } from '../../../core/scan/builtin-rules';
import type { ScanRule } from '../../../core/scan/rule-model';
import type { ScanResult } from '../../../core/scan/scan-result';
import { fieldNameSuggestions, ruleFieldNames } from './field-names';

function builtIn(id: string): ScanRule {
  const rule = BUILT_IN_RULES.find((candidate) => candidate.id === id);
  if (!rule) {
    throw new Error(`built-in rule ${id} missing`);
  }
  return rule;
}

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
  });

  test('reads the fields of every rule kind', () => {
    // 内置规则都带「图中文字识别」，最后都多一个货架号。
    expect(ruleFieldNames(builtIn(DASH_THREE_RULE_ID))).toEqual(['编码', '颜色', '尺码', '货架号']);
    expect(ruleFieldNames(builtIn('builtin:key-value'))).toEqual(['订单号', '款号', '颜色', '尺码', '数量', '货架号']);
    expect(ruleFieldNames(builtIn(RAW_RULE_ID))).toEqual(['内容', '货架号']);
  });

  test('includes what regex replacements and HTTP queries write', () => {
    const rule: ScanRule = {
      ...builtIn(RAW_RULE_ID),
      steps: [
        { kind: 'regexReplace', input: null, pattern: '^SO', flags: '', replacement: '', output: '单号' },
        {
          kind: 'http',
          method: 'GET',
          url: 'https://erp.example.com/orders/{单号}',
          headers: [],
          body: '',
          timeoutMs: 1_500,
          cacheSeconds: 60,
          outputs: [
            { path: 'data.shelf', field: '货架' },
            { path: 'data.customer', field: '客户' },
          ],
          onError: 'empty',
        },
      ],
    };
    expect(ruleFieldNames(rule)).toEqual(['内容', '单号', '货架', '客户']);
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
