import { describe, expect, test } from 'bun:test';
import { DASH_THREE_RULE_ID, RAW_RULE_ID } from '../core/scan/builtin-rules';
import { RuleCatalog } from '../core/scan/rule-catalog';
import type { ScanResult } from '../core/scan/scan-result';
import { GENERIC_TEMPLATE } from '../core/templates/builtin-templates';
import { SF_150 } from '../core/templates/builtin-waybills';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { InMemoryRuleRepository, InMemoryTemplateRepository } from '../core/testing/in-memory-repositories';
import { labelOf } from '../core/testing/templates';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { activeRules, resolvePrintTemplate } from './print-template';

function scanOf(ruleId: string): ScanResult {
  return { raw: 'x', ruleId, ruleName: 'r', fields: [{ name: '内容', value: 'x' }] };
}

function createTemplates() {
  let next = 0;
  return new TemplateCatalog(new InMemoryTemplateRepository(), () => `t${++next}`);
}

/** 横杠三段绑定到「大二维码」：内置规则默认都不绑定，测绑定时自己绑。 */
const BIG_QR_ID = 'builtin:big-qr';
const BOUND_SETTINGS = {
  ...DEFAULT_SETTINGS,
  ruleSettings: DEFAULT_SETTINGS.ruleSettings.map((setting) =>
    setting.id === DASH_THREE_RULE_ID ? { ...setting, templateId: BIG_QR_ID } : setting,
  ),
};

describe('resolvePrintTemplate', () => {
  test('uses the template bound to the matched rule', () => {
    const resolved = resolvePrintTemplate(createTemplates(), BOUND_SETTINGS, scanOf(DASH_THREE_RULE_ID));
    expect(resolved.template.id).toBe(BIG_QR_ID);
    expect(resolved.isBound).toBe(true);
  });

  test('uses the active template for the garment rule by default', () => {
    expect(resolvePrintTemplate(createTemplates(), DEFAULT_SETTINGS, scanOf(DASH_THREE_RULE_ID))).toMatchObject({
      template: { id: GENERIC_TEMPLATE.id },
      isBound: false,
    });
  });

  test('uses the active template for rules without a binding and when nothing was recognised', () => {
    const templates = createTemplates();
    expect(resolvePrintTemplate(templates, DEFAULT_SETTINGS, scanOf(RAW_RULE_ID))).toMatchObject({
      template: { id: GENERIC_TEMPLATE.id },
      isBound: false,
    });
    expect(resolvePrintTemplate(templates, DEFAULT_SETTINGS, null)).toMatchObject({
      template: { id: GENERIC_TEMPLATE.id },
      isBound: false,
    });
  });

  test('says the rule chose it even when the bound template is also the active one', () => {
    const settings = { ...BOUND_SETTINGS, activeTemplateId: BIG_QR_ID };
    expect(resolvePrintTemplate(createTemplates(), settings, scanOf(DASH_THREE_RULE_ID))).toMatchObject({
      template: { id: BIG_QR_ID },
      isBound: true,
    });
  });

  test('switches template by a field of the processed scan and says the rule chose it', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ruleSettings: DEFAULT_SETTINGS.ruleSettings.map((setting) =>
        setting.id === RAW_RULE_ID
          ? {
              ...setting,
              templateRoutes: [{ field: '快递公司', match: 'contains' as const, value: '顺丰', templateId: SF_150.id }],
            }
          : setting,
      ),
    };
    const scan: ScanResult = { ...scanOf(RAW_RULE_ID), fields: [{ name: '快递公司', value: '顺丰速运' }] };
    expect(resolvePrintTemplate(createTemplates(), settings, scan)).toMatchObject({
      template: { id: SF_150.id },
      isBound: true,
    });
    expect(resolvePrintTemplate(createTemplates(), settings, scanOf(RAW_RULE_ID))).toMatchObject({
      template: { id: GENERIC_TEMPLATE.id },
      isBound: false,
    });
  });

  test('falls back to the active template when the bound one was deleted', () => {
    const templates = createTemplates();
    const copy = templates.duplicate(BIG_QR_ID);
    const settings = {
      ...DEFAULT_SETTINGS,
      activeTemplateId: copy.id,
      ruleSettings: DEFAULT_SETTINGS.ruleSettings.map((setting) => ({ ...setting, templateId: 'custom:deleted' })),
    };
    expect(resolvePrintTemplate(templates, settings, scanOf(DASH_THREE_RULE_ID))).toMatchObject({
      template: { id: copy.id },
      isBound: false,
    });
  });

  test('applies the note chosen on the main screen', () => {
    const settings = { ...DEFAULT_SETTINGS, noteOverride: { kind: 'text', text: '返修' } as const };
    expect(labelOf(resolvePrintTemplate(createTemplates(), settings, null).template).note).toMatchObject({
      visible: true,
      text: '返修',
    });
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
