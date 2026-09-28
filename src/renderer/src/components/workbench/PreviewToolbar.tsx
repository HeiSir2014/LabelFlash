import type { LabelTemplate } from '../../../../core/templates/template-model';
import { type PreviewUsage, usageText } from '../../lib/preview-usage';

interface PreviewToolbarProps {
  templates: readonly LabelTemplate[];
  activeTemplateId: string | null;
  /** 这一张实际用到的规则和模板；null 时右侧留空。 */
  usage: PreviewUsage | null;
  onActivate: (id: string) => void;
}

/** 预览区顶部：左边切换当前模板，右边说明这一张用的规则和模板。 */
export function PreviewToolbar({ templates, activeTemplateId, usage, onActivate }: PreviewToolbarProps) {
  return (
    <div className="preview-toolbar">
      <label className="preview-toolbar__template">
        <span className="preview-toolbar__label">当前模板</span>
        <select
          className="preview-toolbar__select"
          value={activeTemplateId ?? ''}
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
      {usage && (
        <p className="preview-toolbar__usage" title={usageText(usage)}>
          <span className="preview-toolbar__source">{usage.source}</span>
          <span className="preview-toolbar__separator"> · </span>
          <span className="preview-toolbar__used-template">{usage.template}</span>
        </p>
      )}
    </div>
  );
}
