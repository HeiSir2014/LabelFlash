import { TEMPLATE_ID_PATTERN } from '../templates/template-model';
import { BUILT_IN_RULES, DEFAULT_RULE_TEMPLATE_BINDINGS, RAW_RULE_ID } from './builtin-rules';
import { isValidFieldName, RULE_ID_PATTERN, RULE_LIMITS, type ScanRule } from './rule-model';
import { fieldValue, type ScanResult } from './scan-result';

/**
 * 每台电脑自己的规则设置：数组顺序就是匹配顺序，另记是否启用、绑定哪个模板。
 * 和规则定义分开存：规则定义可以导出分享，这些本机选择不导出。
 */
export interface RuleSetting {
  id: string;
  enabled: boolean;
  /** 命中这条规则时用的模板；null 表示用当前模板。 */
  templateId: string | null;
  /**
   * 按字段换模板：从上往下第一条命中的生效，都不命中时用 templateId。字段可以是加工步骤补出来的
   * （例如 HTTP 查询回来的「快递公司」：顺丰用顺丰面单，其他用平台标准面单）。
   */
  templateRoutes: TemplateRoute[];
}

export const TEMPLATE_ROUTE_MATCHES = ['contains', 'equals'] as const;
export type TemplateRouteMatch = (typeof TEMPLATE_ROUTE_MATCHES)[number];

export interface TemplateRoute {
  field: string;
  /** contains = 字段值里有这段文字（不分大小写）；equals = 字段值就是它（去掉首尾空白后比较）。 */
  match: TemplateRouteMatch;
  value: string;
  templateId: string;
}

export const TEMPLATE_ROUTE_LIMITS = {
  /** 一条规则最多几条：按快递公司分也就三五家，留出余量。 */
  routes: 10,
  valueLength: 40,
} as const;

/** 内置规则 + 自定义规则上限，留一点余量给刚删除还没合并掉的项。 */
const MAX_RULE_SETTINGS = BUILT_IN_RULES.length + RULE_LIMITS.customRules + 10;

export function defaultRuleSettings(): RuleSetting[] {
  return BUILT_IN_RULES.map((rule) => newRuleSetting(rule.id));
}

/** 新出现的规则（内置、新建、导入）：启用，按内置的默认绑定，没有按字段换模板。 */
function newRuleSetting(id: string): RuleSetting {
  return { id, enabled: true, templateId: DEFAULT_RULE_TEMPLATE_BINDINGS[id] ?? null, templateRoutes: [] };
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
    const { id, enabled, templateId, templateRoutes } = item as Record<string, unknown>;
    const isValid =
      typeof id === 'string' &&
      RULE_ID_PATTERN.test(id) &&
      !seen.has(id) &&
      typeof enabled === 'boolean' &&
      (templateId === null || isTemplateId(templateId));
    if (isValid) {
      seen.add(id);
      settings.push({
        id,
        enabled,
        templateId: templateId as string | null,
        // 1.2.0 及以前没有这一项：读成没有按字段换模板。
        templateRoutes: sanitizeTemplateRoutes(templateRoutes),
      });
    }
  }
  return settings;
}

function isTemplateId(value: unknown): value is string {
  return typeof value === 'string' && TEMPLATE_ID_PATTERN.test(value);
}

/** 字段名不合法、比较方式不认识、没写值或模板不合法的那一条丢掉。 */
function sanitizeTemplateRoutes(value: unknown): TemplateRoute[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const routes: TemplateRoute[] = [];
  for (const item of value.slice(0, TEMPLATE_ROUTE_LIMITS.routes)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { field, match, value: text, templateId } = item as Record<string, unknown>;
    if (
      typeof field === 'string' &&
      isValidFieldName(field) &&
      typeof match === 'string' &&
      (TEMPLATE_ROUTE_MATCHES as readonly string[]).includes(match) &&
      typeof text === 'string' &&
      text.trim() !== '' &&
      text.length <= TEMPLATE_ROUTE_LIMITS.valueLength &&
      isTemplateId(templateId)
    ) {
      routes.push({ field, match: match as TemplateRouteMatch, value: text, templateId });
    }
  }
  return routes;
}

/**
 * 让规则设置和现有规则对齐：丢掉已不存在的规则；没有设置的规则（新建、导入或新版本新增的内置规则）
 * 默认启用，插到「原样打印」之前——排在兜底规则后面就永远匹配不到了。
 */
export function mergeRuleSettings(saved: readonly RuleSetting[], knownIds: readonly string[]): RuleSetting[] {
  const known = new Set(knownIds);
  const kept = saved.filter((setting) => known.has(setting.id));
  const present = new Set(kept.map((setting) => setting.id));
  const added = knownIds.filter((id) => !present.has(id)).map(newRuleSetting);
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

/**
 * 这一张用哪个模板：命中规则的「按字段换模板」从上往下第一条命中的，都不命中时用规则指定的模板；
 * null 表示规则没指定（用当前模板）。scan 要是加工之后的结果，加工步骤补的字段也能用来换模板。
 */
export function templateIdFor(settings: readonly RuleSetting[], scan: ScanResult): string | null {
  const setting = settings.find((item) => item.id === scan.ruleId);
  if (!setting) {
    return null;
  }
  const route = setting.templateRoutes.find((candidate) => routeMatches(candidate, scan));
  return route?.templateId ?? setting.templateId;
}

function routeMatches(route: TemplateRoute, scan: ScanResult): boolean {
  const actual = (fieldValue(scan, route.field) ?? '').trim();
  const expected = route.value.trim();
  if (actual === '') {
    return false;
  }
  return route.match === 'equals' ? actual === expected : actual.toLowerCase().includes(expected.toLowerCase());
}
