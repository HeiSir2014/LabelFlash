import { describe, expect, test } from 'bun:test';
import { RAW_RULE_ID } from '../../core/scan/builtin-rules';
import type { HttpStep } from '../../core/scan/enrich-model';
import { RuleCatalog } from '../../core/scan/rule-catalog';
import { serializeRules } from '../../core/scan/rule-file';
import type { ScanRule } from '../../core/scan/rule-model';
import { FakeClock } from '../../core/testing/fake-clock';
import { InMemoryRuleRepository } from '../../core/testing/in-memory-repositories';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { RuleService } from './rule-service';

const HTTP_STEP: HttpStep = {
  kind: 'http',
  method: 'GET',
  url: 'https://wms.example.com/shelf?code={款号}',
  headers: [],
  body: '',
  timeoutMs: 1_500,
  cacheSeconds: 60,
  outputs: [{ path: 'shelf', field: '货架号' }],
  onError: 'empty',
};

const UNDERSCORE: ScanRule = {
  id: 'custom:x',
  name: '下划线',
  kind: 'delimited',
  delimiter: '_',
  fields: ['款号', '颜色'],
  overflowIndex: 0,
  steps: [{ kind: 'template', text: 'https://example.com/{款号}', output: '链接' }],
};

function createService() {
  let current: AppSettings = DEFAULT_SETTINGS;
  let next = 0;
  const catalog = new RuleCatalog(new InMemoryRuleRepository(), () => `r${++next}`);
  const service = new RuleService({
    catalog,
    settings: {
      get current() {
        return current;
      },
      update: (patch) => {
        current = { ...current, ...patch };
        return current;
      },
    },
    runRegex: () => null,
    enrich: async (scan, steps) => ({
      scan: { ...scan, fields: [...scan.fields, ...steps.map((_, index) => ({ name: `步骤${index}`, value: 'x' }))] },
      traces: [],
      blocked: null,
    }),
    clock: new FakeClock(),
  });
  return { service, catalog, settings: () => current };
}

describe('RuleService', () => {
  test('creates rules before the print-as-is fallback and remembers that in settings', () => {
    const { service, settings } = createService();
    const created = service.create('delimited');
    if (!created.ok) throw new Error(created.issue);
    const ids = settings().ruleSettings.map((setting) => setting.id);
    expect(ids.at(-2)).toBe(created.rule.id);
    expect(ids.at(-1)).toBe(RAW_RULE_ID);
  });

  test('returns reasons instead of throwing for invalid edits and read-only rules', () => {
    const { service } = createService();
    const created = service.create('delimited');
    if (!created.ok) throw new Error(created.issue);
    expect(service.save(created.rule.id, { ...created.rule, fields: ['只有一个'] })).toMatchObject({ ok: false });
    expect(service.save(RAW_RULE_ID, {})).toEqual({ ok: false, issue: '内置规则不能修改，请先复制一份再改' });
  });

  test('tests a draft rule with its steps before it is saved', async () => {
    const { service } = createService();
    const result = await service.test('CL1_红', UNDERSCORE);
    expect(result).toMatchObject({
      status: 'ok',
      recognized: {
        ruleId: 'custom:draft',
        fields: [
          { name: '款号', value: 'CL1' },
          { name: '颜色', value: '红' },
        ],
      },
    });
    expect(await service.test('CL1_红', { ...UNDERSCORE, delimiter: '' })).toMatchObject({ status: 'invalid-rule' });
    expect(await service.test('CL1-红', UNDERSCORE)).toEqual({ status: 'invalid', reason: 'NO_MATCHING_RULE' });
  });

  test('tests with the saved rules in their order when no draft is given', async () => {
    const { service } = createService();
    expect(await service.test('202609280001', undefined)).toMatchObject({
      status: 'ok',
      recognized: { ruleId: 'builtin:digits-order' },
    });
    expect(await service.test('  ', undefined)).toEqual({ status: 'invalid', reason: 'INVALID_CONTENT' });
  });

  test('imports rules as new ones and keeps those with HTTP lookups disabled until confirmed', () => {
    const { service, settings } = createService();
    const text = serializeRules([UNDERSCORE, { ...UNDERSCORE, name: '查货架', steps: [HTTP_STEP] }], 0);
    expect(service.importText(text)).toEqual({
      status: 'imported',
      imported: 2,
      skipped: [],
      httpHosts: ['https://wms.example.com'],
    });
    const enabled = Object.fromEntries(settings().ruleSettings.map((setting) => [setting.id, setting.enabled]));
    expect(enabled).toMatchObject({ 'custom:r1': true, 'custom:r2': false });
    expect(service.importText('nope')).toEqual({ status: 'invalid', issue: '文件不是有效的 JSON' });
  });

  test('exports the chosen rules in list order', () => {
    const { service } = createService();
    service.importText(serializeRules([UNDERSCORE, { ...UNDERSCORE, name: '第二条' }], 0));
    const { text, count } = service.exportText(['custom:r2', 'custom:r1', 'custom:missing']);
    expect(count).toBe(2);
    expect(JSON.parse(text).rules.map((rule: ScanRule) => rule.name)).toEqual(['下划线', '第二条']);
  });

  test('removing a rule drops its setting', () => {
    const { service, settings } = createService();
    const created = service.create('whole');
    if (!created.ok) throw new Error(created.issue);
    service.remove(created.rule.id);
    expect(settings().ruleSettings.some((setting) => setting.id === created.rule.id)).toBe(false);
  });
});
