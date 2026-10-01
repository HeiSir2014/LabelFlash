import type { RuleCatalog } from '../core/scan/rule-catalog';
import type { ScanRule } from '../core/scan/rule-model';
import { mergeRuleSettings, orderedEnabledRules, templateIdFor } from '../core/scan/rule-settings';
import type { ScanResult } from '../core/scan/scan-result';
import { applyNoteOverride } from '../core/templates/note-override';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import type { LabelTemplate } from '../core/templates/template-model';
import type { AppSettings } from '../shared/settings';

/** 本机当前参与识别的规则，按设置里的顺序；设置里还没有的新规则按合并规则补上。 */
export function activeRules(rules: RuleCatalog, settings: AppSettings): ScanRule[] {
  const all = rules.list();
  const merged = mergeRuleSettings(
    settings.ruleSettings,
    all.map((rule) => rule.id),
  );
  return orderedEnabledRules(merged, all);
}

export interface PrintTemplate {
  template: LabelTemplate;
  /** 模板由命中的规则指定；规则没指定、指定的模板已被删除或没有识别结果时为 false（用的是当前模板）。 */
  isBound: boolean;
}

/**
 * 实际用于打印和预览的模板：命中的规则指定了模板就用它，否则用当前模板；
 * 再叠加主界面「备注」下拉框的选择。
 */
export function resolvePrintTemplate(
  templates: TemplateCatalog,
  settings: AppSettings,
  scan: ScanResult | null,
): PrintTemplate {
  const boundId = scan ? templateIdFor(settings.ruleSettings, scan, (id) => templates.get(id) !== null) : null;
  const bound = boundId ? templates.get(boundId) : null;
  return {
    template: applyNoteOverride(bound ?? templates.resolve(settings.activeTemplateId), settings.noteOverride),
    isBound: bound !== null,
  };
}
