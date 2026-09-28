import type { FocusEvent } from 'react';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import { useHoverPreview } from '../view-models/use-hover-preview';
import { ConfirmButton } from './ConfirmButton';
import { TemplateEditor } from './TemplateEditor';

interface TemplatePanelProps {
  templates: LabelTemplate[];
  activeId: string | null;
  /** 正在悬停预览的模板（不是使用中的模板）。 */
  previewId: string | null;
  draft: LabelTemplate | null;
  isDirty: boolean;
  /** 指针或键盘焦点在某个模板上停留满 1 秒时上报它的 id；离开列表时上报 null。 */
  onPreviewChange: (id: string | null) => void;
  onActivate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDraftChange: (draft: LabelTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function TemplatePanel(props: TemplatePanelProps) {
  const { templates, activeId, previewId, draft } = props;
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
    <TemplateList
      templates={templates}
      activeId={activeId}
      previewId={previewId}
      onPreviewChange={props.onPreviewChange}
      onActivate={props.onActivate}
      onDuplicate={props.onDuplicate}
      onEdit={props.onEdit}
      onRemove={props.onRemove}
    />
  );
}

type TemplateListProps = Pick<
  TemplatePanelProps,
  'templates' | 'activeId' | 'previewId' | 'onPreviewChange' | 'onActivate' | 'onDuplicate' | 'onEdit' | 'onRemove'
>;

/** 单独成组件：进入编辑时它被卸载，悬停预览随之清除。 */
function TemplateList(props: TemplateListProps) {
  const { templates, activeId, previewId } = props;
  const hover = useHoverPreview(props.onPreviewChange);
  // 焦点移到列表外才清除；在列表内的按钮之间移动不算离开。
  const onListBlur = (event: FocusEvent<HTMLUListElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      hover.leave();
    }
  };
  return (
    <div className="panel-body">
      <p className="panel-intro">
        纸张固定 60×40mm。鼠标在模板上停留 1 秒即可预览；内置模板不能修改，点「复制」生成自定义模板后再编辑。
      </p>
      <ul className="scroll-list" onPointerLeave={() => hover.leave()} onBlur={onListBlur}>
        {templates.map((template) => {
          const isActive = template.id === activeId;
          const isBuiltIn = isBuiltInTemplateId(template.id);
          const isPreviewing = template.id === previewId;
          const className = `template-row${isActive ? ' template-row--active' : ''}${isPreviewing ? ' template-row--previewing' : ''}`;
          return (
            <li
              key={template.id}
              className={className}
              onPointerEnter={() => hover.enter(template.id)}
              onFocus={() => hover.enter(template.id)}
            >
              <div className="template-row__head">
                <span className="template-row__name">{template.name}</span>
                <span className="badge badge--quiet">{isBuiltIn ? '内置' : '自定义'}</span>
                {isActive && <span className="badge">使用中</span>}
                {isPreviewing && <span className="badge badge--preview">预览中</span>}
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
