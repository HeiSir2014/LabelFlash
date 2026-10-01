import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES, DASH_THREE_RULE_ID, RAW_RULE_ID } from './builtin-rules';
import type { ScanRule } from './rule-model';
import {
  defaultRuleSettings,
  mergeRuleSettings,
  orderedEnabledRules,
  type RuleSetting,
  sanitizeRuleSettings,
  templateIdFor,
} from './rule-settings';
import type { ScanResult } from './scan-result';

const BUILT_IN_IDS = BUILT_IN_RULES.map((rule) => rule.id);
const CUSTOM: ScanRule = {
  id: 'custom:a',
  name: '下划线',
  kind: 'delimited',
  delimiter: '_',
  fields: ['a', 'b'],
  overflowIndex: 0,
  steps: [],
};

describe('defaultRuleSettings', () => {
  // 内置模板都是「通用」，样衣码用哪个由当前模板决定，不再默认绑定。
  test('enables every built-in rule in order with the active template and no routes', () => {
    const settings = defaultRuleSettings();
    expect(settings.map((setting) => setting.id)).toEqual(BUILT_IN_IDS);
    expect(settings.every((setting) => setting.enabled)).toBe(true);
    expect(templateIdFor(settings, scanOf(DASH_THREE_RULE_ID))).toBeNull();
    expect(templateIdFor(settings, scanOf(RAW_RULE_ID))).toBeNull();
    expect(settings.every((setting) => setting.templateRoutes.length === 0)).toBe(true);
  });
});

function scanOf(ruleId: string, fields: Record<string, string> = {}): ScanResult {
  return {
    raw: 'x',
    ruleId,
    ruleName: '规则',
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
  };
}

describe('templateIdFor with template routes', () => {
  const routed: RuleSetting[] = [
    {
      id: 'custom:orders',
      enabled: true,
      templateId: 'builtin:waybill-platform-180',
      templateRoutes: [
        { field: '快递公司', match: 'contains', value: '顺丰', templateId: 'builtin:waybill-sf-150' },
        { field: '快递公司', match: 'equals', value: '德邦快递', templateId: 'builtin:waybill-deppon-180' },
      ],
    },
  ];

  test('uses the first route whose field matches', () => {
    expect(templateIdFor(routed, scanOf('custom:orders', { 快递公司: '顺丰速运' }))).toBe('builtin:waybill-sf-150');
    expect(templateIdFor(routed, scanOf('custom:orders', { 快递公司: ' 德邦快递 ' }))).toBe(
      'builtin:waybill-deppon-180',
    );
  });

  test('compares contains without case and equals exactly', () => {
    const latin: RuleSetting[] = [
      {
        ...routed[0],
        id: 'custom:orders',
        templateRoutes: [{ field: '快递公司', match: 'contains', value: 'sf', templateId: 'custom:sf' }],
      } as RuleSetting,
    ];
    expect(templateIdFor(latin, scanOf('custom:orders', { 快递公司: 'SF Express' }))).toBe('custom:sf');
    expect(templateIdFor(routed, scanOf('custom:orders', { 快递公司: '德邦' }))).toBe('builtin:waybill-platform-180');
  });

  test('falls back to the rule template when no route matches or the field is missing', () => {
    expect(templateIdFor(routed, scanOf('custom:orders', { 快递公司: '中通快递' }))).toBe(
      'builtin:waybill-platform-180',
    );
    expect(templateIdFor(routed, scanOf('custom:orders'))).toBe('builtin:waybill-platform-180');
  });

  test('ignores routes of other rules', () => {
    expect(templateIdFor(routed, scanOf(RAW_RULE_ID, { 快递公司: '顺丰' }))).toBeNull();
  });
});

describe('sanitizeRuleSettings', () => {
  test('keeps valid entries and drops malformed or repeated ones', () => {
    const input: unknown[] = [
      { id: 'custom:a', enabled: false, templateId: 'custom:t1' },
      { id: 'custom:a', enabled: true, templateId: null },
      { id: 'bad id', enabled: true, templateId: null },
      { id: 'builtin:raw', enabled: 'yes', templateId: null },
      { id: 'builtin:raw', enabled: true, templateId: 'not a template' },
      { id: 'builtin:raw', enabled: true, templateId: null },
      null,
    ];
    expect(sanitizeRuleSettings(input)).toEqual([
      { id: 'custom:a', enabled: false, templateId: 'custom:t1', templateRoutes: [] },
      { id: 'builtin:raw', enabled: true, templateId: null, templateRoutes: [] },
    ]);
  });

  test('keeps valid template routes and drops broken ones', () => {
    const good = { field: '快递公司', match: 'contains' as const, value: '顺丰', templateId: 'builtin:waybill-sf-150' };
    const [setting] = sanitizeRuleSettings([
      {
        id: 'custom:a',
        enabled: true,
        templateId: null,
        templateRoutes: [
          good,
          { ...good, field: '{坏}' },
          { ...good, match: 'startsWith' },
          { ...good, value: '   ' },
          { ...good, templateId: 'nope' },
          'x',
        ],
      },
    ]);
    expect(setting?.templateRoutes).toEqual([good]);
  });

  test('falls back to the defaults for anything that is not a list', () => {
    expect(sanitizeRuleSettings('x')).toEqual(defaultRuleSettings());
  });

  // 1.2.x 的横杠三段默认绑定「样衣标准」：升级后换成版式相同的通用模板，照样打出编码、颜色、尺码。
  test('moves bindings and routes from a retired garment template to its generic replacement', () => {
    const [setting] = sanitizeRuleSettings([
      {
        id: DASH_THREE_RULE_ID,
        enabled: true,
        templateId: 'builtin:standard',
        templateRoutes: [{ field: '尺码', match: 'equals', value: 'XL', templateId: 'builtin:qr-right' }],
      },
    ]);
    expect(setting?.templateId).toBe('builtin:generic');
    expect(setting?.templateRoutes[0]?.templateId).toBe('builtin:generic-qr-right');
  });
});

describe('mergeRuleSettings', () => {
  test('drops settings of rules that no longer exist', () => {
    const saved: RuleSetting[] = [
      ...defaultRuleSettings(),
      { id: 'custom:gone', enabled: true, templateId: null, templateRoutes: [] },
    ];
    expect(mergeRuleSettings(saved, BUILT_IN_IDS).map((setting) => setting.id)).toEqual(BUILT_IN_IDS);
  });

  test('keeps the order and choices the user made', () => {
    const saved = defaultRuleSettings()
      .reverse()
      .map((setting) => ({ ...setting, enabled: false }));
    const merged = mergeRuleSettings(saved, BUILT_IN_IDS);
    expect(merged.map((setting) => setting.id)).toEqual([...BUILT_IN_IDS].reverse());
    expect(merged.every((setting) => !setting.enabled)).toBe(true);
  });

  test('puts new rules just before the print-as-is fallback so they can still match', () => {
    const merged = mergeRuleSettings(defaultRuleSettings(), [...BUILT_IN_IDS, CUSTOM.id]);
    expect(merged.map((setting) => setting.id)).toEqual([...BUILT_IN_IDS.slice(0, -1), CUSTOM.id, RAW_RULE_ID]);
    expect(merged.find((setting) => setting.id === CUSTOM.id)).toEqual({
      id: CUSTOM.id,
      enabled: true,
      templateId: null,
      templateRoutes: [],
    });
  });

  test('appends new rules at the end when the fallback is not in the list', () => {
    const saved = defaultRuleSettings().filter((setting) => setting.id !== RAW_RULE_ID);
    const merged = mergeRuleSettings(saved, [...BUILT_IN_IDS.filter((id) => id !== RAW_RULE_ID), CUSTOM.id]);
    expect(merged.at(-1)?.id).toBe(CUSTOM.id);
  });
});

describe('orderedEnabledRules', () => {
  test('returns enabled rules in the configured order', () => {
    const rules = [...BUILT_IN_RULES, CUSTOM];
    const merged = mergeRuleSettings(
      defaultRuleSettings(),
      rules.map((rule) => rule.id),
    );
    const settings = merged.map((setting) =>
      setting.id === 'builtin:digits-order' ? { ...setting, enabled: false } : setting,
    );
    expect(orderedEnabledRules(settings, rules).map((rule) => rule.id)).toEqual([
      DASH_THREE_RULE_ID,
      'builtin:key-value',
      CUSTOM.id,
      RAW_RULE_ID,
    ]);
  });
});
