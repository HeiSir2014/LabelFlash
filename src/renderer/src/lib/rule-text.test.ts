import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES } from '../../../core/scan/builtin-rules';
import type { EnrichStep } from '../../../core/scan/enrich-model';
import { describeDelimiter, fieldsSummary, ruleSummary, stepSummary } from './rule-text';

describe('ruleSummary', () => {
  test('summarises every built-in rule', () => {
    expect(BUILT_IN_RULES.map(ruleSummary)).toEqual([
      '分隔符 - · 编码 / 颜色 / 尺码',
      '纯数字 8–30 位 · 订单号',
      '键值 · 订单号 / 款号 / 颜色 / 尺码 / 数量 等',
      '不限 1–1000 位 · 内容',
    ]);
  });

  test('spells out invisible delimiters', () => {
    expect(describeDelimiter('\t')).toBe('制表符');
    expect(describeDelimiter(' | ')).toBe('空格|空格');
  });
});

describe('stepSummary', () => {
  test('summarises each kind of step', () => {
    const steps: EnrichStep[] = [
      { kind: 'template', text: 'https://x.com/{订单号}', output: '链接' },
      { kind: 'regexReplace', input: null, pattern: '^SO-', flags: '', replacement: '', output: '单号' },
      {
        kind: 'lookup',
        input: '编码',
        tableId: 't',
        keyColumn: '编码',
        ignoreCase: false,
        outputs: [{ column: '货架', field: '货架号' }],
      },
      {
        kind: 'http',
        method: 'GET',
        url: 'https://wms.example.com/q?c={编码}',
        headers: [],
        body: '',
        timeoutMs: 1_500,
        cacheSeconds: 60,
        outputs: [
          { path: 'shelf', field: '货架号' },
          { path: 'zone', field: '库区' },
        ],
        onError: 'empty',
      },
    ];
    expect(steps.map(stepSummary)).toEqual([
      '链接 = https://x.com/{订单号}',
      '单号 = 完整内容 替换 /^SO-/',
      '按「编码」查表 → 货架号',
      'GET https://wms.example.com → 货架号、库区',
    ]);
  });
});

describe('fieldsSummary', () => {
  test('lists names and values on one line', () => {
    expect(
      fieldsSummary([
        { name: '编码', value: 'CL1' },
        { name: '地址', value: '一号楼\n三单元' },
        { name: '货架号', value: '' },
      ]),
    ).toBe('编码 CL1 · 地址 一号楼 / 三单元 · 货架号 （空）');
  });
});
