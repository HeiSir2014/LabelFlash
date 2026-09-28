import { describe, expect, test } from 'bun:test';
import type { HttpStep } from './enrich-model';
import { httpHostsOf, parseRuleFile, RULE_FILE_FORMAT, RULE_FILE_VERSION, serializeRules } from './rule-file';
import type { ScanRule } from './rule-model';

const HTTP_STEP: HttpStep = {
  kind: 'http',
  method: 'GET',
  url: 'https://WMS.example.com/shelf?code={编码}',
  headers: [],
  body: '',
  timeoutMs: 1_500,
  cacheSeconds: 60,
  outputs: [{ path: 'shelf', field: '货架号' }],
  onError: 'empty',
};

const RULE: ScanRule = {
  id: 'custom:abc',
  name: '下划线',
  kind: 'delimited',
  delimiter: '_',
  fields: ['款号', '颜色'],
  overflowIndex: 0,
  steps: [HTTP_STEP],
};

describe('rule files', () => {
  test('export without ids and read back', () => {
    const text = serializeRules([RULE], Date.UTC(2026, 8, 28));
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ format: RULE_FILE_FORMAT, version: RULE_FILE_VERSION });
    expect(parsed.rules[0].id).toBeUndefined();
    const { id: _id, ...withoutId } = RULE;
    expect(parseRuleFile(text)).toEqual({ ok: true, rules: [withoutId] });
  });

  test('explain files that are not rule files', () => {
    expect(parseRuleFile('{oops')).toEqual({ ok: false, issue: '文件不是有效的 JSON' });
    expect(parseRuleFile('[]')).toEqual({ ok: false, issue: '不是识别规则文件' });
    const other = parseRuleFile('{"format":"other","version":1,"rules":[]}');
    expect(other).toEqual({ ok: false, issue: '不是识别规则文件' });
    expect(parseRuleFile(`{"format":"${RULE_FILE_FORMAT}","version":2,"rules":[]}`)).toMatchObject({ ok: false });
    expect(parseRuleFile(`{"format":"${RULE_FILE_FORMAT}","version":1}`)).toEqual({
      ok: false,
      issue: '文件里没有规则列表',
    });
  });

  test('list the hosts that HTTP steps would contact', () => {
    const other: ScanRule = { ...RULE, steps: [HTTP_STEP, { ...HTTP_STEP, url: 'http://10.0.0.8:8080/x' }] };
    expect(httpHostsOf([RULE, other])).toEqual(['http://10.0.0.8:8080', 'https://wms.example.com']);
    expect(httpHostsOf([{ ...RULE, steps: [] }])).toEqual([]);
  });
});
