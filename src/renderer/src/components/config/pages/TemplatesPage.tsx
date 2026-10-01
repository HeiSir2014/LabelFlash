import { useId } from 'react';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../../../core/templates/template-model';
import type { PrinterInfo } from '../../../../../core/types';
import { DEFAULT_PAPER } from '../../../../../shared/label-paper';
import { NO_RENDER_WARNINGS } from '../../../../../shared/render-warnings';
import { FIELD_NAME_LIST_ID } from '../../../lib/field-names';
import { describeTemplateUse } from '../../../lib/printer-assignment';
import type { TemplatePreview } from '../../../view-models/use-template-preview';
import { DeleteButton } from '../../ConfirmButton';
import { LabelPreview } from '../../LabelPreview';
import { TemplateEditor } from '../../TemplateEditor';
import { WaybillEditor } from '../../WaybillEditor';

/** 模板页的标签比工作台的更大：这里就是看效果的地方。 */
const MAX_PREVIEW_SCALE = 3;

/** 还没有结果时说「正在生成」，有结果但没有 HTML 才是内容识别不了：只说程序确知的事。 */
function previewPlaceholder(preview: TemplatePreview | null): string {
  return preview === null ? '正在生成预览…' : '这段预览内容无法识别，换一段试试';
}

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
  /** 选中的模板（编辑时是草稿）按「预览内容」渲染的结果；第一次生成前为 null。 */
  preview: TemplatePreview | null;
  /** 字段名输入框的候选。 */
  fieldNames: readonly string[];
  /** 本机的打印机和纸张分配：编辑器选打印机、列表显示实际会用哪台。 */
  printers: readonly PrinterInfo[];
  paperPrinters: Readonly<Record<string, string>>;
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

function ListView({
  templates,
  activeId,
  selected,
  sample,
  preview,
  onSelect,
  onActivate,
  onDuplicate,
  onEdit,
  onRemove,
  printers,
  paperPrinters,
}: TemplatesPageProps) {
  const builtIn = templates.filter((template) => isBuiltInTemplateId(template.id));
  const custom = templates.filter((template) => !isBuiltInTemplateId(template.id));
  const names = printers.map((printer) => printer.name);
  const displayName = (name: string) => printers.find((printer) => printer.name === name)?.displayName ?? name;
  // 只在和默认不同时写纸张和打印机（见 describeTemplateUse）；纸张分配改了，这里跟着变。
  const describeUse = (template: LabelTemplate) => describeTemplateUse(template, paperPrinters, names, displayName);
  const groupProps = { selectedId: selected?.id ?? null, activeId, onSelect, describeUse };

  return (
    <div className="templates-page">
      <div className="template-list">
        <p className="template-list__intro">点一套模板即可预览，不会改变正在使用的模板。</p>
        <TemplateGroup label="内置" items={builtIn} empty="" {...groupProps} />
        <TemplateGroup
          label="自定义"
          items={custom}
          empty="还没有自定义模板：选一套模板，点「复制」生成后再编辑。"
          {...groupProps}
        />
      </div>
      <section className="template-stage" aria-label="模板预览">
        <PreviewSource template={selected} sample={sample} />
        <LabelPreview
          html={preview?.html ?? null}
          warnings={preview?.warnings ?? NO_RENDER_WARNINGS}
          feedKey={preview?.templateId ?? 'none'}
          maxScale={MAX_PREVIEW_SCALE}
          paper={preview?.paper ?? selected?.paper ?? DEFAULT_PAPER}
          placeholder={previewPlaceholder(preview)}
        />
        {selected && (
          <SelectedActions
            template={selected}
            isActive={selected.id === activeId}
            onActivate={onActivate}
            onDuplicate={onDuplicate}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        )}
      </section>
    </div>
  );
}

interface TemplateGroupProps {
  label: string;
  items: readonly LabelTemplate[];
  empty: string;
  selectedId: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** 纸张和实际会用的打印机，例如「100×180 二联面单 · 面单机B」。 */
  describeUse: (template: LabelTemplate) => string | null;
}

/** 一组模板：点选即预览（按下状态表示正在预览的那一套）。 */
function TemplateGroup({ label, items, empty, selectedId, activeId, onSelect, describeUse }: TemplateGroupProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="template-list__heading">
        {label}
      </h2>
      {items.length === 0 ? (
        <p className="template-list__empty">{empty}</p>
      ) : (
        <ul className="template-list__items">
          {items.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="template-item"
                aria-pressed={template.id === selectedId}
                onClick={() => onSelect(template.id)}
              >
                <span className="template-item__text">
                  <span className="template-item__name">{template.name}</span>
                  {describeUse(template) !== null && (
                    <span className="template-item__use">{describeUse(template)}</span>
                  )}
                </span>
                {template.id === activeId && <span className="badge">使用中</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      {!isBuiltIn && <DeleteButton className="button button--quiet" onConfirm={() => onRemove(template.id)} />}
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
  printers,
  paperPrinters,
}: TemplatesPageProps & { draft: LabelTemplate }) {
  return (
    <div className="template-editing">
      <div className="template-editing__form">
        {draft.kind === 'label' ? (
          <TemplateEditor
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        ) : draft.kind === 'waybill' ? (
          <WaybillEditor
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        ) : // 自由设计模板的编辑器在 1b（Task 11）加入，这里先不渲染表单。
        null}
      </div>
      <section className="template-editing__preview" aria-label="模板预览">
        <PreviewSource template={draft} sample={sample} />
        <LabelPreview
          html={preview?.html ?? null}
          warnings={preview?.warnings ?? NO_RENDER_WARNINGS}
          feedKey={preview?.templateId ?? 'none'}
          maxScale={MAX_PREVIEW_SCALE}
          paper={preview?.paper ?? draft.paper}
          placeholder={previewPlaceholder(preview)}
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

/**
 * 预览用什么内容：标签模板用「预览内容」（扫码内容）；面单模板要的是收件人、运单号这些字段，
 * 单凭扫码内容填不出来，设计时固定用示例面单数据，这里说明实际打印时字段从哪来。
 */
function PreviewSource({ template, sample }: { template: LabelTemplate | null; sample: SampleContent }) {
  if (template?.kind === 'waybill') {
    return (
      <p className="sample-input sample-input--note">
        用示例面单数据预览。实际打印时，字段由订单系统经本机接口发来，或者扫码后由识别规则的加工步骤（例如 HTTP
        查询订单）补出来。
      </p>
    );
  }
  return <SampleInput sample={sample} />;
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
