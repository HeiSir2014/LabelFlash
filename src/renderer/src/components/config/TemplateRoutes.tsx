import { useId, useState } from 'react';
import { RULE_LIMITS } from '../../../../core/scan/rule-model';
import {
  TEMPLATE_ROUTE_LIMITS,
  TEMPLATE_ROUTE_MATCHES,
  type TemplateRoute,
  type TemplateRouteMatch,
} from '../../../../core/scan/rule-settings';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import {
  MATCH_LABELS,
  newRouteDraft,
  type RouteDraft,
  routesToSave,
  routeTemplateMissing,
} from '../../lib/template-routes';

interface TemplateRoutesProps {
  ruleName: string;
  routes: readonly TemplateRoute[];
  templates: readonly LabelTemplate[];
  onSave: (routes: TemplateRoute[]) => void;
}

/**
 * 一条规则的「按字段换模板」：每行「字段 包含 / 等于 值 → 模板」，从上往下第一条命中的生效。
 * 改动随手保存；还没填完整的行留在这里，不保存（见 lib/template-routes.ts）。
 */
export function TemplateRoutes({ ruleName, routes, templates, onSave }: TemplateRoutesProps) {
  const [drafts, setDrafts] = useState<RouteDraft[]>(() => routes.map((route) => ({ ...route })));
  const hintId = useId();
  const templateIds = templates.map((template) => template.id);
  const change = (next: RouteDraft[]) => {
    setDrafts(next);
    onSave(routesToSave(next));
  };
  const setRow = (index: number, patch: Partial<RouteDraft>) =>
    change(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  return (
    <fieldset className="template-routes" aria-describedby={hintId}>
      <legend className="visually-hidden">{`「${ruleName}」按字段换模板`}</legend>
      <p id={hintId} className="form-hint">
        从上往下第一条命中的生效，都不命中时用上面选的模板。字段可以是加工步骤补出来的，例如 HTTP
        查询回来的「快递公司」：顺丰用顺丰面单，其他用平台标准面单。
      </p>
      {drafts.map((draft, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行按位置编辑（填到一半时字段和值可能重复），位置即身份
        <div key={index} className="template-routes__row">
          <input
            className="text-field"
            aria-label={`第 ${index + 1} 条的字段`}
            value={draft.field}
            maxLength={RULE_LIMITS.fieldNameLength}
            placeholder="字段名"
            onChange={(event) => setRow(index, { field: event.target.value })}
          />
          <select
            className="select-field"
            aria-label={`第 ${index + 1} 条的比较方式`}
            value={draft.match}
            onChange={(event) => setRow(index, { match: event.target.value as TemplateRouteMatch })}
          >
            {TEMPLATE_ROUTE_MATCHES.map((match) => (
              <option key={match} value={match}>
                {MATCH_LABELS[match]}
              </option>
            ))}
          </select>
          <input
            className="text-field"
            aria-label={`第 ${index + 1} 条的值`}
            value={draft.value}
            maxLength={TEMPLATE_ROUTE_LIMITS.valueLength}
            placeholder="例如 顺丰"
            onChange={(event) => setRow(index, { value: event.target.value })}
          />
          <span className="template-routes__arrow" aria-hidden="true">
            →
          </span>
          <select
            className="select-field"
            aria-label={`第 ${index + 1} 条用的模板`}
            value={draft.templateId}
            onChange={(event) => setRow(index, { templateId: event.target.value })}
          >
            <option value="">选模板…</option>
            {routeTemplateMissing(draft, templateIds) && (
              <option value={draft.templateId}>已删除的模板（这一条不生效）</option>
            )}
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--small button--quiet"
            aria-label={`删除第 ${index + 1} 条`}
            onClick={() => change(drafts.filter((_, i) => i !== index))}
          >
            删除
          </button>
        </div>
      ))}
      {drafts.length < TEMPLATE_ROUTE_LIMITS.routes && (
        <button
          type="button"
          className="button button--small button--quiet template-routes__add"
          onClick={() => setDrafts([...drafts, newRouteDraft()])}
        >
          加一条
        </button>
      )}
    </fieldset>
  );
}
