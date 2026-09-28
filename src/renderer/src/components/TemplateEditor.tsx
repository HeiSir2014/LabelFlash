import { useId } from 'react';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';
import {
  type FieldConfig,
  type FieldKey,
  type LabelTemplate,
  maxQrSizeMm,
  type NoteConfig,
  type NotePlacement,
  type QrErrorLevel,
  type QrLayout,
  TEMPLATE_LIMITS,
  type TextAlign,
} from '../../../core/templates/template-model';
import { NumberField, Segmented, TextInput, Toggle } from './form-controls';

const FONT_STEP_MM = 0.1;
const PADDING_STEP_MM = 0.5;
const QR_STEP_MM = 1;

const FIELD_LABELS: ReadonlyArray<{ key: FieldKey; label: string }> = [
  { key: 'code', label: '编码' },
  { key: 'color', label: '颜色' },
  { key: 'size', label: '尺码' },
  { key: 'raw', label: '完整编码（底部）' },
];

const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

const LAYOUT_OPTIONS: ReadonlyArray<{ value: QrLayout; label: string }> = [
  { value: 'qr-left', label: '二维码在左' },
  { value: 'qr-right', label: '二维码在右' },
];

const ERROR_LEVEL_OPTIONS: ReadonlyArray<{ value: QrErrorLevel; label: string }> = [
  { value: 'L', label: 'L 7%' },
  { value: 'M', label: 'M 15%' },
  { value: 'Q', label: 'Q 25%' },
  { value: 'H', label: 'H 30%' },
];

const NOTE_PLACEMENT_OPTIONS: ReadonlyArray<{ value: NotePlacement; label: string }> = [
  { value: 'beside-qr', label: '二维码旁空白处' },
  { value: 'bottom', label: '底部整行' },
];

interface TemplateEditorProps {
  draft: LabelTemplate;
  isDirty: boolean;
  onChange: (draft: LabelTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** 编辑自定义模板：改动实时反映在左侧预览，点「保存模板」后才用于打印。 */
export function TemplateEditor({ draft, isDirty, onChange, onSave, onCancel }: TemplateEditorProps) {
  const noteId = useId();
  const { fontSizeMm } = TEMPLATE_LIMITS;
  const setField = (key: FieldKey, patch: Partial<FieldConfig>) =>
    onChange({ ...draft, fields: { ...draft.fields, [key]: { ...draft.fields[key], ...patch } } });
  const setNote = (patch: Partial<NoteConfig>) => onChange({ ...draft, note: { ...draft.note, ...patch } });

  return (
    <div className="template-editor">
      <div className="template-editor__scroll">
        <section className="form-section">
          <h3 className="form-section__title">基本</h3>
          <TextInput
            label="模板名称"
            value={draft.name}
            maxLength={TEMPLATE_LIMITS.nameLength}
            onChange={(name) => onChange({ ...draft, name })}
          />
          <Segmented
            label="布局"
            value={draft.layout}
            options={LAYOUT_OPTIONS}
            onChange={(layout) => onChange({ ...draft, layout })}
          />
          <Segmented
            label="旁侧文字"
            value={draft.sideAlign}
            options={ALIGN_OPTIONS}
            onChange={(sideAlign) => onChange({ ...draft, sideAlign })}
          />
          <Segmented
            label="底部文字"
            value={draft.bottomAlign}
            options={ALIGN_OPTIONS}
            onChange={(bottomAlign) => onChange({ ...draft, bottomAlign })}
          />
          <p className="form-hint">
            对齐按区域统一设置：二维码旁的编码、颜色、尺码（和旁边的备注）共用一种对齐，前缀与值分两列，值永远对齐。
          </p>
          <NumberField
            label="页边距"
            value={draft.paddingMm}
            min={TEMPLATE_LIMITS.paddingMm.min}
            max={TEMPLATE_LIMITS.paddingMm.max}
            step={PADDING_STEP_MM}
            onChange={(paddingMm) =>
              onChange({
                ...draft,
                paddingMm,
                qr: { ...draft.qr, sizeMm: Math.min(draft.qr.sizeMm, maxQrSizeMm(paddingMm)) },
              })
            }
          />
        </section>

        <section className="form-section">
          <h3 className="form-section__title">二维码</h3>
          <Toggle
            label="显示二维码"
            checked={draft.qr.visible}
            onChange={(visible) => onChange({ ...draft, qr: { ...draft.qr, visible } })}
          />
          <NumberField
            label="边长"
            value={draft.qr.sizeMm}
            min={TEMPLATE_LIMITS.qrSizeMm.min}
            max={maxQrSizeMm(draft.paddingMm)}
            step={QR_STEP_MM}
            onChange={(sizeMm) => onChange({ ...draft, qr: { ...draft.qr, sizeMm } })}
          />
          <Segmented
            label="容错等级"
            value={draft.qr.errorCorrection}
            options={ERROR_LEVEL_OPTIONS}
            onChange={(errorCorrection) => onChange({ ...draft, qr: { ...draft.qr, errorCorrection } })}
          />
          <p className="form-hint">容错越高，二维码被磨损后越容易识别，但图案更密；热敏标签建议 M 或 Q。</p>
        </section>

        {FIELD_LABELS.map(({ key, label }) => {
          const field = draft.fields[key];
          return (
            <section key={key} className="form-section">
              <h3 className="form-section__title">{label}</h3>
              <Toggle label="显示" checked={field.visible} onChange={(visible) => setField(key, { visible })} />
              <TextInput
                label="前缀文字"
                value={field.prefix}
                maxLength={TEMPLATE_LIMITS.prefixLength}
                placeholder="例如 编码："
                onChange={(prefix) => setField(key, { prefix })}
              />
              <NumberField
                label="字号"
                value={field.fontSizeMm}
                min={fontSizeMm.min}
                max={fontSizeMm.max}
                step={FONT_STEP_MM}
                onChange={(size) => setField(key, { fontSizeMm: size })}
              />
              <Toggle label="加粗" checked={field.bold} onChange={(bold) => setField(key, { bold })} />
            </section>
          );
        })}

        <section className="form-section">
          <h3 className="form-section__title">备注</h3>
          <Toggle label="显示备注" checked={draft.note.visible} onChange={(visible) => setNote({ visible })} />
          <div className="form-row form-row--stacked">
            <label className="form-row__label" htmlFor={noteId}>
              备注内容
            </label>
            <textarea
              id={noteId}
              className="text-field text-area"
              rows={3}
              maxLength={TEMPLATE_LIMITS.noteLength}
              value={draft.note.text}
              placeholder="例如：样衣间 {日期}"
              onChange={(event) => setNote({ text: event.target.value })}
            />
            <fieldset className="variable-chips" aria-label="插入变量">
              {NOTE_VARIABLES.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  className="chip"
                  onClick={() =>
                    setNote({ text: `${draft.note.text}${variable}`.slice(0, TEMPLATE_LIMITS.noteLength) })
                  }
                >
                  {variable}
                </button>
              ))}
            </fieldset>
          </div>
          <Segmented
            label="位置"
            value={draft.note.placement}
            options={NOTE_PLACEMENT_OPTIONS}
            onChange={(placement) => setNote({ placement })}
          />
          <NumberField
            label="字号"
            value={draft.note.fontSizeMm}
            min={fontSizeMm.min}
            max={fontSizeMm.max}
            step={FONT_STEP_MM}
            onChange={(size) => setNote({ fontSizeMm: size })}
          />
          <Toggle label="加粗" checked={draft.note.bold} onChange={(bold) => setNote({ bold })} />
        </section>
      </div>
      <div className="template-editor__footer">
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
