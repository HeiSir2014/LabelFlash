import { useId } from 'react';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../../../core/templates/template-model';
import type { LabelPreview as LabelPreviewData } from '../../../../../shared/ipc-contract';
import { FIELD_NAME_LIST_ID } from '../../../lib/field-names';
import { ConfirmButton } from '../../ConfirmButton';
import { LabelPreview } from '../../LabelPreview';
import { TemplateEditor } from '../../TemplateEditor';

/** 模板页的标签比工作台的更大：这里就是看效果的地方。 */
const MAX_PREVIEW_SCALE = 3;

export interface SampleContent {
  value: string;
  onChange: (value: string) => void;
}

export interface TemplatesPageProps {
  templates: readonly LabelTemplate[];
  activeId: string | null;
  selected: LabelTemplate | null;
  draft: LabelTemplate | null;
  isDirty: boolean;
  sample: SampleContent;
  /** 选中的模板（编辑时是草稿）按「预览内容」渲染的结果。 */
  preview: LabelPreviewData | null;
  /** 字段名输入框的候选。 */
  fieldNames: readonly string[];
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDraftChange: (draft: LabelTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** 模板：左边列表点选即预览，右边大号预览和操作；编辑时表单和预览并排。 */
export function TemplatesPage(props: TemplatesPageProps) {
  const { draft, fieldNames } = props;
  return (
    <>
      {draft ? <EditView {...props} draft={draft} /> : <ListView {...props} />}
      <datalist id={FIELD_NAME_LIST_ID}>
        {fieldNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}

function ListView({ templates, activeId, selected, sample, preview, ...actions }: TemplatesPageProps) {
  const builtIn = templates.filter((template) => isBuiltInTemplateId(template.id));
  const custom = templates.filter((template) => !isBuiltInTemplateId(template.id));
  const group = (label: string, items: readonly LabelTemplate[], empty: string) => (
    <section className="template-list__group" aria-label={label}>
      <h2 className="template-list__heading">{label}</h2>
      {items.length === 0 ? (
        <p className="template-list__empty">{empty}</p>
      ) : (
        <ul className="template-list__items">
          {items.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="template-item"
                aria-current={template.id === selected?.id ? 'true' : undefined}
                onClick={() => actions.onSelect(template.id)}
              >
                <span className="template-item__name">{template.name}</span>
                {template.id === activeId && <span className="badge">使用中</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="templates-page">
      <nav className="template-list" aria-label="模板列表">
        <p className="template-list__intro">纸张固定 60×40mm。点一套模板即可预览，不会改变正在使用的模板。</p>
        {group('内置', builtIn, '')}
        {group('自定义', custom, '还没有自定义模板：选一套模板，点「复制」生成后再编辑。')}
      </nav>
      <section className="template-stage" aria-label="模板预览">
        <SampleInput sample={sample} />
        <LabelPreview
          html={preview?.html ?? null}
          qrOmitted={preview?.qrOmitted ?? false}
          feedKey={selected?.id ?? 'none'}
          maxScale={MAX_PREVIEW_SCALE}
          placeholder="这段预览内容无法识别，换一段试试"
        />
        {selected && <SelectedActions template={selected} isActive={selected.id === activeId} {...actions} />}
      </section>
    </div>
  );
}

interface SelectedActionsProps extends Pick<TemplatesPageProps, 'onActivate' | 'onDuplicate' | 'onEdit' | 'onRemove'> {
  template: LabelTemplate;
  isActive: boolean;
}

function SelectedActions({ template, isActive, onActivate, onDuplicate, onEdit, onRemove }: SelectedActionsProps) {
  const isBuiltIn = isBuiltInTemplateId(template.id);
  return (
    <div className="template-stage__actions">
      <p className="template-stage__hint">
        {isBuiltIn ? '内置模板不能修改：点「复制」生成自定义模板后再编辑。' : '改好后点「使用」，扫码就按它打印。'}
      </p>
      {!isBuiltIn && (
        <ConfirmButton
          className="button button--quiet"
          label="删除"
          confirmLabel="再点一次确认删除"
          onConfirm={() => onRemove(template.id)}
        />
      )}
      <button type="button" className="button button--quiet" onClick={() => onDuplicate(template.id)}>
        复制
      </button>
      {!isBuiltIn && (
        <button type="button" className="button button--quiet" onClick={() => onEdit(template.id)}>
          编辑
        </button>
      )}
      <button
        type="button"
        className="button button--primary"
        disabled={isActive}
        onClick={() => onActivate(template.id)}
      >
        {isActive ? '使用中' : '使用'}
      </button>
    </div>
  );
}

function EditView({
  draft,
  isDirty,
  sample,
  preview,
  onDraftChange,
  onSave,
  onCancel,
}: TemplatesPageProps & { draft: LabelTemplate }) {
  return (
    <div className="template-editing">
      <div className="template-editing__form">
        <TemplateEditor draft={draft} onChange={onDraftChange} />
      </div>
      <section className="template-editing__preview" aria-label="模板预览">
        <SampleInput sample={sample} />
        <LabelPreview
          html={preview?.html ?? null}
          qrOmitted={preview?.qrOmitted ?? false}
          feedKey={draft.id}
          maxScale={MAX_PREVIEW_SCALE}
          placeholder="这段预览内容无法识别，换一段试试"
        />
      </section>
      <div className="config-actions">
        <p className="config-actions__status">{isDirty ? '有未保存的修改，保存后才会用于打印' : '还没有修改'}</p>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {isDirty ? '放弃修改' : '返回列表'}
        </button>
        <button type="button" className="button button--primary" onClick={onSave} disabled={!isDirty}>
          保存模板
        </button>
      </div>
    </div>
  );
}

/** 「预览内容」：默认是最近一次扫码的内容；多行内容照原样保留，所以用 textarea。 */
function SampleInput({ sample }: { sample: SampleContent }) {
  const id = useId();
  return (
    <div className="sample-input">
      <label className="sample-input__label" htmlFor={id}>
        预览内容
      </label>
      <textarea
        id={id}
        className="text-field text-area sample-input__field"
        rows={2}
        value={sample.value}
        placeholder="扫码，或输入要预览的内容"
        spellCheck={false}
        onChange={(event) => sample.onChange(event.target.value)}
      />
    </div>
  );
}
