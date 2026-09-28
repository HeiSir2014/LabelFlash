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

const BUILT_IN_IDS = BUILT_IN_RULES.map((rule) => rule.id);
const CUSTOM: ScanRule = {
  id: 'custom:a',
  name: '下划线',
  kind: 'delimited',
  delimiter: '_',
  fields: ['a', 'b'],
  overflowIndex: 0,
};

describe('defaultRuleSettings', () => {
  test('enables every built-in rule in order and binds the garment rule to the garment template', () => {
    const settings = defaultRuleSettings();
    expect(settings.map((setting) => setting.id)).toEqual(BUILT_IN_IDS);
    expect(settings.every((setting) => setting.enabled)).toBe(true);
    expect(templateIdFor(settings, DASH_THREE_RULE_ID)).toBe('builtin:standard');
    expect(templateIdFor(settings, RAW_RULE_ID)).toBeNull();
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
      { id: 'custom:a', enabled: false, templateId: 'custom:t1' },
      { id: 'builtin:raw', enabled: true, templateId: null },
    ]);
  });

  test('falls back to the defaults for anything that is not a list', () => {
    expect(sanitizeRuleSettings('x')).toEqual(defaultRuleSettings());
  });
});

describe('mergeRuleSettings', () => {
  test('drops settings of rules that no longer exist', () => {
    const saved: RuleSetting[] = [...defaultRuleSettings(), { id: 'custom:gone', enabled: true, templateId: null }];
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
