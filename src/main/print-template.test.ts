import { describe, expect, test } from 'bun:test';
import { DASH_THREE_RULE_ID, RAW_RULE_ID } from '../core/scan/builtin-rules';
import { RuleCatalog } from '../core/scan/rule-catalog';
import type { ScanResult } from '../core/scan/scan-result';
import { GENERIC_TEMPLATE, STANDARD_TEMPLATE } from '../core/templates/builtin-templates';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { InMemoryRuleRepository, InMemoryTemplateRepository } from '../core/testing/in-memory-repositories';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { activeRules, boundTemplate, resolvePrintTemplate } from './print-template';

function scanOf(ruleId: string): ScanResult {
  return { raw: 'x', ruleId, ruleName: 'r', fields: [{ name: '内容', value: 'x' }] };
}

function createTemplates() {
  let next = 0;
  return new TemplateCatalog(new InMemoryTemplateRepository(), () => `t${++next}`);
}

describe('resolvePrintTemplate', () => {
  test('uses the template bound to the matched rule', () => {
    const template = resolvePrintTemplate(createTemplates(), DEFAULT_SETTINGS, scanOf(DASH_THREE_RULE_ID));
    expect(template.id).toBe(STANDARD_TEMPLATE.id);
  });

  test('uses the active template for rules without a binding and when nothing was recognised', () => {
    const templates = createTemplates();
    expect(resolvePrintTemplate(templates, DEFAULT_SETTINGS, scanOf(RAW_RULE_ID)).id).toBe(GENERIC_TEMPLATE.id);
    expect(resolvePrintTemplate(templates, DEFAULT_SETTINGS, null).id).toBe(GENERIC_TEMPLATE.id);
  });

  test('falls back to the active template when the bound one was deleted', () => {
    const templates = createTemplates();
    const copy = templates.duplicate(STANDARD_TEMPLATE.id);
    const settings = {
      ...DEFAULT_SETTINGS,
      activeTemplateId: copy.id,
      ruleSettings: DEFAULT_SETTINGS.ruleSettings.map((setting) => ({ ...setting, templateId: 'custom:deleted' })),
    };
    expect(resolvePrintTemplate(templates, settings, scanOf(DASH_THREE_RULE_ID)).id).toBe(copy.id);
    expect(boundTemplate(templates, settings, scanOf(DASH_THREE_RULE_ID))).toBeNull();
  });

  test('tells whether the template came from the rule', () => {
    const templates = createTemplates();
    expect(boundTemplate(templates, DEFAULT_SETTINGS, scanOf(DASH_THREE_RULE_ID))?.id).toBe(STANDARD_TEMPLATE.id);
    expect(boundTemplate(templates, DEFAULT_SETTINGS, scanOf(RAW_RULE_ID))).toBeNull();
    expect(boundTemplate(templates, DEFAULT_SETTINGS, null)).toBeNull();
  });

  test('applies the note chosen on the main screen', () => {
    const settings = { ...DEFAULT_SETTINGS, noteOverride: { kind: 'text', text: '返修' } as const };
    expect(resolvePrintTemplate(createTemplates(), settings, null).note).toMatchObject({ visible: true, text: '返修' });
  });
});

describe('activeRules', () => {
  test('keeps the configured order, skips disabled rules and slots new custom rules before the fallback', () => {
    let next = 0;
    const rules = new RuleCatalog(new InMemoryRuleRepository(), () => `r${++next}`);
    const custom = rules.create('delimited');
    const settings = {
      ...DEFAULT_SETTINGS,
      ruleSettings: DEFAULT_SETTINGS.ruleSettings.map((setting) =>
        setting.id === 'builtin:key-value' ? { ...setting, enabled: false } : setting,
      ),
    };
    expect(activeRules(rules, settings).map((rule) => rule.id)).toEqual([
      DASH_THREE_RULE_ID,
      'builtin:digits-order',
      custom.id,
      RAW_RULE_ID,
    ]);
  });
});
