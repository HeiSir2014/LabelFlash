import { useId } from 'react';
import { RULE_LIMITS } from '../../../core/scan/rule-model';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';
import {
  type BottomLine,
  type LabelTemplate,
  maxQrSizeMm,
  type NoteConfig,
  type NotePlacement,
  type QrContent,
  type QrContentKind,
  type QrErrorLevel,
  type QrLayout,
  TEMPLATE_LIMITS,
  type TextAlign,
} from '../../../core/templates/template-model';
import { FIELD_NAME_LIST_ID } from '../lib/field-names';
import { FieldsAreaEditor } from './FieldsAreaEditor';
import { NumberField, Segmented, TextInput, Toggle } from './form-controls';

const FONT_STEP_MM = 0.1;
const PADDING_STEP_MM = 0.5;
const QR_STEP_MM = 1;

const QR_CONTENT_OPTIONS: ReadonlyArray<{ value: QrContentKind; label: string }> = [
  { value: 'raw', label: '完整内容' },
  { value: 'field', label: '某个字段' },
  { value: 'text', label: '自定义文本' },
];

/** 切换二维码内容来源时的初始值。 */
const QR_CONTENT_DEFAULTS: Record<QrContentKind, QrContent> = {
  raw: { kind: 'raw' },
  field: { kind: 'field', field: '订单号' },
  text: { kind: 'text', text: '' },
};

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

interface SectionProps {
  draft: LabelTemplate;
  onChange: (draft: LabelTemplate) => void;
}

/** 自定义模板的编辑表单：改动实时反映在旁边的预览里，保存后才用于打印（滚动和保存按钮由页面提供）。 */
export function TemplateEditor({ draft, onChange }: SectionProps) {
  return (
    <div className="template-form">
      <BasicSection draft={draft} onChange={onChange} />
      <QrSection draft={draft} onChange={onChange} />
      <FieldsAreaEditor area={draft.fieldsArea} onChange={(fieldsArea) => onChange({ ...draft, fieldsArea })} />
      <BottomSection draft={draft} onChange={onChange} />
      <NoteSection draft={draft} onChange={onChange} />
    </div>
  );
}

function BasicSection({ draft, onChange }: SectionProps) {
  return (
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
        对齐按区域统一设置：二维码旁的字段（和旁边的备注）共用一种对齐，前缀与值分两列，值永远对齐。
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
  );
}

function QrSection({ draft, onChange }: SectionProps) {
  const setQrContent = (content: QrContent) => onChange({ ...draft, qr: { ...draft.qr, content } });
  const { content } = draft.qr;

  return (
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
      <p className="form-hint">内容太长时自动降低容错，仍然放不下就不印二维码。</p>
      <Segmented
        label="内容"
        value={content.kind}
        options={QR_CONTENT_OPTIONS}
        onChange={(kind) => setQrContent(QR_CONTENT_DEFAULTS[kind])}
      />
      {content.kind === 'field' && (
        <TextInput
          label="字段名"
          value={content.field}
          maxLength={RULE_LIMITS.fieldNameLength}
          placeholder="例如 订单号"
          list={FIELD_NAME_LIST_ID}
          onChange={(field) => setQrContent({ kind: 'field', field })}
        />
      )}
      {content.kind === 'text' && (
        <TextInput
          label="文本"
          value={content.text}
          maxLength={TEMPLATE_LIMITS.noteLength}
          placeholder="例如 https://example.com/o/{订单号}"
          onChange={(text) => setQrContent({ kind: 'text', text })}
        />
      )}
      {content.kind !== 'raw' && (
        <p className="form-hint">字段没识别到、文本为空时，二维码改用完整内容。文本里可以写 {'{字段名}'} 等变量。</p>
      )}
    </section>
  );
}

function BottomSection({ draft, onChange }: SectionProps) {
  const { fontSizeMm } = TEMPLATE_LIMITS;
  const setBottom = (patch: Partial<BottomLine>) => onChange({ ...draft, bottom: { ...draft.bottom, ...patch } });

  return (
    <section className="form-section">
      <h3 className="form-section__title">底部整行</h3>
      <p className="form-hint">
        显示完整内容，多行用「 / 」连起来；只识别出一个字段、且它就是完整内容时（例如纯数字订单号）自动不显示。
      </p>
      <Toggle label="显示" checked={draft.bottom.visible} onChange={(visible) => setBottom({ visible })} />
      <NumberField
        label="字号"
        value={draft.bottom.fontSizeMm}
        min={fontSizeMm.min}
        max={fontSizeMm.max}
        step={FONT_STEP_MM}
        onChange={(size) => setBottom({ fontSizeMm: size })}
      />
      <Toggle label="加粗" checked={draft.bottom.bold} onChange={(bold) => setBottom({ bold })} />
    </section>
  );
}

function NoteSection({ draft, onChange }: SectionProps) {
  const noteId = useId();
  const { fontSizeMm } = TEMPLATE_LIMITS;
  const setNote = (patch: Partial<NoteConfig>) => onChange({ ...draft, note: { ...draft.note, ...patch } });

  return (
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
              onClick={() => setNote({ text: `${draft.note.text}${variable}`.slice(0, TEMPLATE_LIMITS.noteLength) })}
            >
              {variable}
            </button>
          ))}
        </fieldset>
        <p className="form-hint">
          也可以写 {'{字段名}'} 取识别到的字段，例如 {'{订单号}'}；这次没识别到的字段原样印出。
        </p>
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
  );
}
