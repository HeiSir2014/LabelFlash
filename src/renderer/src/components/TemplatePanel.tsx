import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import { ConfirmButton } from './ConfirmButton';
import { TemplateEditor } from './TemplateEditor';

interface TemplatePanelProps {
  templates: LabelTemplate[];
  activeId: string | null;
  draft: LabelTemplate | null;
  isDirty: boolean;
  onActivate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDraftChange: (draft: LabelTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function TemplatePanel(props: TemplatePanelProps) {
  const { templates, activeId, draft } = props;
  if (draft) {
    return (
      <TemplateEditor
        draft={draft}
        isDirty={props.isDirty}
        onChange={props.onDraftChange}
        onSave={props.onSave}
        onCancel={props.onCancel}
      />
    );
  }
  return (
    <div className="panel-body">
      <p className="panel-intro">纸张固定 60×40mm。内置模板不能修改，点「复制」生成自定义模板后再编辑。</p>
      <ul className="scroll-list">
        {templates.map((template) => {
          const isActive = template.id === activeId;
          const isBuiltIn = isBuiltInTemplateId(template.id);
          return (
            <li key={template.id} className={`template-row${isActive ? ' template-row--active' : ''}`}>
              <div className="template-row__head">
                <span className="template-row__name">{template.name}</span>
                <span className="badge badge--quiet">{isBuiltIn ? '内置' : '自定义'}</span>
                {isActive && <span className="badge">使用中</span>}
              </div>
              <div className="template-row__actions">
                {!isActive && (
                  <button type="button" className="button button--small" onClick={() => props.onActivate(template.id)}>
                    使用
                  </button>
                )}
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => props.onDuplicate(template.id)}
                >
                  复制
                </button>
                {!isBuiltIn && (
                  <>
                    <button
                      type="button"
                      className="button button--small button--quiet"
                      onClick={() => props.onEdit(template.id)}
                    >
                      编辑
                    </button>
                    <ConfirmButton
                      className="button button--small button--quiet"
                      label="删除"
                      confirmLabel="确认删除"
                      onConfirm={() => props.onRemove(template.id)}
                    />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
