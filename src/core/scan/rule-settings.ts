import { TEMPLATE_ID_PATTERN } from '../templates/template-model';
import { BUILT_IN_RULES, DEFAULT_RULE_TEMPLATE_BINDINGS, RAW_RULE_ID } from './builtin-rules';
import { RULE_ID_PATTERN, RULE_LIMITS, type ScanRule } from './rule-model';

/**
 * 每台电脑自己的规则设置：数组顺序就是匹配顺序，另记是否启用、绑定哪个模板。
 * 和规则定义分开存：规则定义可以导出分享，这些本机选择不导出。
 */
export interface RuleSetting {
  id: string;
  enabled: boolean;
  /** 命中这条规则时用的模板；null 表示用当前模板。 */
  templateId: string | null;
}

/** 内置规则 + 自定义规则上限，留一点余量给刚删除还没合并掉的项。 */
const MAX_RULE_SETTINGS = BUILT_IN_RULES.length + RULE_LIMITS.customRules + 10;

export function defaultRuleSettings(): RuleSetting[] {
  return BUILT_IN_RULES.map((rule) => ({
    id: rule.id,
    enabled: true,
    templateId: DEFAULT_RULE_TEMPLATE_BINDINGS[rule.id] ?? null,
  }));
}

/** 校验保存的规则设置：不合法或重复的项直接丢弃（缺少的规则会在合并时补回来）。 */
export function sanitizeRuleSettings(value: unknown): RuleSetting[] {
  if (!Array.isArray(value)) {
    return defaultRuleSettings();
  }
  const seen = new Set<string>();
  const settings: RuleSetting[] = [];
  for (const item of value.slice(0, MAX_RULE_SETTINGS)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { id, enabled, templateId } = item as Record<string, unknown>;
    const isValid =
      typeof id === 'string' &&
      RULE_ID_PATTERN.test(id) &&
      !seen.has(id) &&
      typeof enabled === 'boolean' &&
      (templateId === null || (typeof templateId === 'string' && TEMPLATE_ID_PATTERN.test(templateId)));
    if (isValid) {
      seen.add(id);
      settings.push({ id, enabled, templateId: templateId as string | null });
    }
  }
  return settings;
}

/**
 * 让规则设置和现有规则对齐：丢掉已不存在的规则；没有设置的规则（新建、导入或新版本新增的内置规则）
 * 默认启用，插到「原样打印」之前——排在兜底规则后面就永远匹配不到了。
 */
export function mergeRuleSettings(saved: readonly RuleSetting[], knownIds: readonly string[]): RuleSetting[] {
  const known = new Set(knownIds);
  const kept = saved.filter((setting) => known.has(setting.id));
  const present = new Set(kept.map((setting) => setting.id));
  const added = knownIds
    .filter((id) => !present.has(id))
    .map((id) => ({ id, enabled: true, templateId: DEFAULT_RULE_TEMPLATE_BINDINGS[id] ?? null }));
  const fallbackIndex = kept.findIndex((setting) => setting.id === RAW_RULE_ID);
  if (fallbackIndex === -1) {
    return [...kept, ...added];
  }
  return [...kept.slice(0, fallbackIndex), ...added, ...kept.slice(fallbackIndex)];
}

/** 按设置的顺序返回启用的规则（设置里没有的规则不参与，调用前应先合并）。 */
export function orderedEnabledRules(settings: readonly RuleSetting[], rules: readonly ScanRule[]): ScanRule[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return settings
    .filter((setting) => setting.enabled)
    .map((setting) => byId.get(setting.id))
    .filter((rule): rule is ScanRule => rule !== undefined);
}

export function templateIdFor(settings: readonly RuleSetting[], ruleId: string): string | null {
  return settings.find((setting) => setting.id === ruleId)?.templateId ?? null;
}
