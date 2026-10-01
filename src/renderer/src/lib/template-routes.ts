import { isValidFieldName } from '../../../core/scan/rule-model';
import { TEMPLATE_ROUTE_LIMITS, type TemplateRoute, type TemplateRouteMatch } from '../../../core/scan/rule-settings';

/**
 * 「按字段换模板」的编辑：编辑中的一行可能还没填完（没写值、没选模板），这样的行留在界面上，
 * 只把填完整的行保存下来——保存时不完整的行会被校验丢掉，留在界面上才不会打到一半就消失。
 */
export interface RouteDraft {
  field: string;
  match: TemplateRouteMatch;
  value: string;
  /** 空字符串 = 还没选模板。 */
  templateId: string;
}

export const MATCH_LABELS: Record<TemplateRouteMatch, string> = {
  contains: '包含',
  equals: '等于',
};

/** 新加的一行：按快递公司换面单是最常见的用法。 */
export function newRouteDraft(): RouteDraft {
  return { field: '快递公司', match: 'contains', value: '', templateId: '' };
}

export function isCompleteRoute(draft: RouteDraft): boolean {
  return (
    isValidFieldName(draft.field.trim()) &&
    draft.value.trim() !== '' &&
    draft.value.length <= TEMPLATE_ROUTE_LIMITS.valueLength &&
    draft.templateId !== ''
  );
}

/** 要保存的：填完整的行，按界面上的顺序；字段名去掉首尾空格（输入时不去，字段名中间可以有空格）。 */
export function routesToSave(drafts: readonly RouteDraft[]): TemplateRoute[] {
  return drafts.filter(isCompleteRoute).map((draft) => ({ ...draft, field: draft.field.trim() }));
}

/**
 * 这一行选的模板已被删除：打印时跳过这一行（见 templateIdFor），界面上要说出来，
 * 不然下拉框里找不到这个模板，只显示「选模板…」，看起来像没选。
 */
export function routeTemplateMissing(draft: RouteDraft, templateIds: readonly string[]): boolean {
  return draft.templateId !== '' && !templateIds.includes(draft.templateId);
}

/** 卡片上的按钮文字：有几条就写几条。 */
export function routesButtonLabel(count: number): string {
  return count === 0 ? '按字段换模板' : `按字段换模板（${count} 条）`;
}
