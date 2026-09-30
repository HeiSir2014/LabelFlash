import type { LabelTemplate } from '../../../../core/templates/template-model';
import type { PreviewUsage } from '../../lib/preview-usage';

interface PreviewToolbarProps {
  templates: readonly LabelTemplate[];
  /** 这一张用的模板、是不是规则指定的、内容从哪来（见 lib/preview-usage.ts）。 */
  usage: PreviewUsage;
  onActivate: (id: string) => void;
}

/** 预览区顶部：左边是这一张用的模板（没被规则指定时可以切换当前模板），右边说明内容从哪来。 */
export function PreviewToolbar({ templates, usage, onActivate }: PreviewToolbarProps) {
  return (
    <div className="preview-toolbar">
      <label className="preview-toolbar__template">
        <span className="preview-toolbar__label">模板</span>
        <select
          className="select-field preview-toolbar__select"
          value={usage.templateId ?? ''}
          disabled={usage.isRuleBound}
          title={usage.isRuleBound ? '这一张的模板由识别规则指定，要改请到「识别规则」' : undefined}
          onChange={(event) => {
            onActivate(event.target.value);
            // 离开下拉框，焦点按扫码框的回焦规则回去，下一次扫码的回车不会落在下拉框上。
            event.currentTarget.blur();
          }}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      {usage.isRuleBound && <span className="badge badge--quiet">规则指定</span>}
      {usage.source && (
        <p className="preview-toolbar__usage" title={usage.source}>
          {usage.source}
        </p>
      )}
    </div>
  );
}
