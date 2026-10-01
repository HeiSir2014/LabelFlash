import { useState } from 'react';
import { WAYBILL_FIELD_NAMES } from '../../../core/templates/builtin-waybills';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';
import { DEFAULT_PARAGRAPH } from '../../../core/templates/sanitize-waybill';
import type { TextAlign } from '../../../core/templates/template-model';
import {
  isSplit,
  type RuleStyle,
  type VerticalAlign,
  WAYBILL_LIMITS,
  type WaybillContent,
  type WaybillContentKind,
  type WaybillMargins,
  type WaybillNode,
  type WaybillParagraph,
  type WaybillTemplate,
} from '../../../core/templates/waybill-model';
import { PAPER_LIMITS_MM } from '../../../shared/paper-sizes';
import {
  canAdd,
  canSplit,
  insertAfter,
  moveNode,
  type NodePath,
  nodeAt,
  outline,
  pathKey,
  removeNode,
  splitNode,
  updateNode,
} from '../lib/waybill-edit';
import { NumberField, Segmented, SelectField, TextInput, Toggle } from './form-controls';
import { type PrinterChoices, TemplateBasics } from './TemplateBasics';

const SIZE_STEP_MM = 0.5;
const FONT_STEP_MM = 0.1;
const LINE_STEP_MM = 0.05;

const RULE_OPTIONS: ReadonlyArray<{ value: RuleStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'none', label: '不画线' },
];

const KIND_OPTIONS: ReadonlyArray<{ value: WaybillContentKind; label: string }> = [
  { value: 'text', label: '文字' },
  { value: 'barcode', label: '条码' },
  { value: 'qr', label: '二维码' },
  { value: 'empty', label: '空白' },
];

const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

const VALIGN_OPTIONS: ReadonlyArray<{ value: VerticalAlign; label: string }> = [
  { value: 'middle', label: '居中' },
  { value: 'top', label: '靠上' },
];

/** 换内容类型时的初始内容。 */
const CONTENT_DEFAULTS: Record<WaybillContentKind, WaybillContent> = {
  text: { kind: 'text', paragraphs: [{ ...DEFAULT_PARAGRAPH }], align: 'left', valign: 'middle', inverse: false },
  barcode: { kind: 'barcode', value: '{运单号}', showText: true, textSizeMm: 3, vertical: false },
  qr: { kind: 'qr', value: '{二维码}' },
  empty: { kind: 'empty' },
};

/** 「插入字段」下拉框：内置面单的字段和固定变量；第一项是提示，不是字段。 */
const INSERT_PLACEHOLDER = '';
const INSERT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: INSERT_PLACEHOLDER, label: '插入字段…' },
  ...WAYBILL_FIELD_NAMES.map((name) => ({ value: `{${name}}`, label: name })),
  ...NOTE_VARIABLES.map((variable) => ({ value: variable, label: variable.slice(1, -1) })),
];

interface WaybillEditorProps extends PrinterChoices {
  draft: WaybillTemplate;
  onChange: (draft: WaybillTemplate) => void;
}

/**
 * 面单模板的编辑表单：上面是基本设置，下面是格子的大纲，点一格在下方编辑它。
 * 改动实时反映在旁边的预览里，保存后才用于打印。
 */
export function WaybillEditor({ draft, onChange, printers, paperPrinters }: WaybillEditorProps) {
  const [selected, setSelected] = useState<NodePath>([0]);
  const node = nodeAt(draft.root, selected);
  const select = (path: NodePath) => setSelected(nodeAt(draft.root, path) ? path : [0]);
  const apply = (next: WaybillTemplate, nextSelection: NodePath = selected) => {
    onChange(next);
    setSelected(nodeAt(next.root, nextSelection) ? nextSelection : [0]);
  };

  return (
    <div className="template-form">
      <section className="form-section">
        <h2 className="form-section__title">基本</h2>
        <TemplateBasics draft={draft} onChange={onChange} printers={printers} paperPrinters={paperPrinters} />
        <MarginsFields margins={draft.marginsMm} onChange={(marginsMm) => onChange({ ...draft, marginsMm })} />
        <NumberField
          label="线宽"
          value={draft.lineWidthMm}
          min={WAYBILL_LIMITS.lineWidthMm.min}
          max={WAYBILL_LIMITS.lineWidthMm.max}
          step={LINE_STEP_MM}
          onChange={(lineWidthMm) => onChange({ ...draft, lineWidthMm })}
        />
      </section>
      <section className="form-section">
        <h2 className="form-section__title">格子</h2>
        <p className="form-hint">
          版面先分行，行里再分格。每一组的最后一格自动占剩下的地方，所以格子总能拼满、线总能对齐。点一格在下面修改。
        </p>
        <Outline template={draft} selected={selected} onSelect={select} />
        {node && selected.length > 0 && (
          <NodeEditor template={draft} path={selected} node={node} onChange={(next) => apply(next)} onApply={apply} />
        )}
      </section>
    </div>
  );
}

function MarginsFields({
  margins,
  onChange,
}: {
  margins: WaybillMargins;
  onChange: (margins: WaybillMargins) => void;
}) {
  const { min, max } = WAYBILL_LIMITS.marginMm;
  const field = (key: keyof WaybillMargins, label: string) => (
    <NumberField
      label={label}
      value={margins[key]}
      min={min}
      max={max}
      step={SIZE_STEP_MM}
      onChange={(value) => onChange({ ...margins, [key]: value })}
    />
  );
  return (
    <>
      {field('left', '左留白')}
      {field('right', '右留白')}
      {field('top', '上留白')}
      {field('bottom', '下留白')}
    </>
  );
}

function Outline({
  template,
  selected,
  onSelect,
}: {
  template: WaybillTemplate;
  selected: NodePath;
  onSelect: (path: NodePath) => void;
}) {
  const selectedKey = pathKey(selected);
  return (
    <ul className="waybill-outline" aria-label="格子">
      {outline(template).map((item) => (
        <li key={pathKey(item.path)} style={{ paddingInlineStart: `calc(${item.depth - 1} * var(--space-4))` }}>
          <button
            type="button"
            className="waybill-outline__item"
            aria-pressed={pathKey(item.path) === selectedKey}
            onClick={() => onSelect(item.path)}
          >
            <span className="waybill-outline__label">{item.label}</span>
            <span className="waybill-outline__size">{item.size}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface NodeEditorProps {
  template: WaybillTemplate;
  path: NodePath;
  node: WaybillNode;
  onChange: (template: WaybillTemplate) => void;
  onApply: (template: WaybillTemplate, selection: NodePath) => void;
}

function NodeEditor({ template, path, node, onChange, onApply }: NodeEditorProps) {
  const item = outline(template).find((entry) => pathKey(entry.path) === pathKey(path));
  const parent = nodeAt(template.root, path.slice(0, -1));
  const siblings = parent && isSplit(parent.body) ? parent.body.children.length : 1;
  const index = path.at(-1) ?? 0;
  const update = (patch: (current: WaybillNode) => WaybillNode) => onChange(updateNode(template, path, patch));
  const setContent = (content: WaybillContent) => update((current) => ({ ...current, body: { content } }));
  const sizeLabel = item?.parentSplit === 'rows' ? '高' : '宽';
  const isRoot = path.length === 1 && siblings <= 1;

  return (
    <div className="waybill-node">
      {item?.isLast ? (
        <p className="form-hint">{`这一组的最后一格：${item.size}（自动占剩下的地方，改前面几格的尺寸来调整它）。`}</p>
      ) : (
        <NumberField
          label={sizeLabel}
          value={node.sizeMm}
          min={WAYBILL_LIMITS.minSizeMm}
          max={PAPER_LIMITS_MM.height.max}
          step={SIZE_STEP_MM}
          onChange={(sizeMm) => update((current) => ({ ...current, sizeMm }))}
        />
      )}
      {!item?.isLast && (
        <Segmented
          label="和下一格之间"
          value={node.ruleAfter}
          options={RULE_OPTIONS}
          onChange={(ruleAfter) => update((current) => ({ ...current, ruleAfter }))}
        />
      )}
      {isSplit(node.body) ? (
        <p className="form-hint">{`这一格又分成了 ${node.body.children.length} 格：在大纲里点它下面的格子编辑。`}</p>
      ) : (
        <ContentEditor content={node.body.content} onChange={setContent} />
      )}
      <div className="waybill-node__actions">
        {!isSplit(node.body) && (
          <>
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={!canSplit(template, path)}
              onClick={() => onApply(splitNode(template, path, 'columns'), [...path, 0])}
            >
              左右拆分
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={!canSplit(template, path)}
              onClick={() => onApply(splitNode(template, path, 'rows'), [...path, 0])}
            >
              上下拆分
            </button>
          </>
        )}
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={!canAdd(template, 1) || siblings >= WAYBILL_LIMITS.children}
          onClick={() => onApply(insertAfter(template, path), [...path.slice(0, -1), index + 1])}
        >
          后面加一格
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={index === 0}
          onClick={() => onApply(moveNode(template, path, -1), [...path.slice(0, -1), index - 1])}
        >
          {item?.parentSplit === 'columns' ? '左移' : '上移'}
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={index >= siblings - 1}
          onClick={() => onApply(moveNode(template, path, 1), [...path.slice(0, -1), index + 1])}
        >
          {item?.parentSplit === 'columns' ? '右移' : '下移'}
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={isRoot}
          onClick={() => onApply(removeNode(template, path), [...path.slice(0, -1), Math.max(0, index - 1)])}
        >
          删除
        </button>
      </div>
    </div>
  );
}

function ContentEditor({
  content,
  onChange,
}: {
  content: WaybillContent;
  onChange: (content: WaybillContent) => void;
}) {
  return (
    <>
      <Segmented
        label="内容"
        value={content.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => onChange(kind === content.kind ? content : structuredClone(CONTENT_DEFAULTS[kind]))}
      />
      {content.kind === 'text' && <TextContentEditor content={content} onChange={onChange} />}
      {content.kind === 'barcode' && (
        <>
          <TextInput
            label="条码内容"
            value={content.value}
            maxLength={WAYBILL_LIMITS.valueLength}
            placeholder="{运单号}"
            onChange={(value) => onChange({ ...content, value })}
          />
          <p className="form-hint">Code128：只能是字母、数字和常见符号，不能有中文。</p>
          <Toggle label="竖排" checked={content.vertical} onChange={(vertical) => onChange({ ...content, vertical })} />
          {!content.vertical && (
            <>
              <Toggle
                label="印号码"
                checked={content.showText}
                onChange={(showText) => onChange({ ...content, showText })}
              />
              {content.showText && (
                <NumberField
                  label="号码字号"
                  value={content.textSizeMm}
                  min={WAYBILL_LIMITS.fontSizeMm.min}
                  max={WAYBILL_LIMITS.fontSizeMm.max}
                  step={FONT_STEP_MM}
                  onChange={(textSizeMm) => onChange({ ...content, textSizeMm })}
                />
              )}
            </>
          )}
        </>
      )}
      {content.kind === 'qr' && (
        <TextInput
          label="二维码内容"
          value={content.value}
          maxLength={WAYBILL_LIMITS.valueLength}
          placeholder="{二维码}"
          onChange={(value) => onChange({ ...content, value })}
        />
      )}
    </>
  );
}

function TextContentEditor({
  content,
  onChange,
}: {
  content: Extract<WaybillContent, { kind: 'text' }>;
  onChange: (content: WaybillContent) => void;
}) {
  const setParagraph = (index: number, patch: Partial<WaybillParagraph>) =>
    onChange({
      ...content,
      paragraphs: content.paragraphs.map((paragraph, i) => (i === index ? { ...paragraph, ...patch } : paragraph)),
    });
  return (
    <>
      <Segmented
        label="对齐"
        value={content.align}
        options={ALIGN_OPTIONS}
        onChange={(align) => onChange({ ...content, align })}
      />
      <Segmented
        label="垂直"
        value={content.valign}
        options={VALIGN_OPTIONS}
        onChange={(valign) => onChange({ ...content, valign })}
      />
      <Toggle
        label="反白（黑底白字）"
        checked={content.inverse}
        onChange={(inverse) => onChange({ ...content, inverse })}
      />
      <p className="form-hint">
        用 {'{字段名}'}{' '}
        印订单系统发来的字段；一段里的字段全是空的，这一段不印。放不下时整格一起缩小字号，再放不下就截断并在预览上提示。
      </p>
      {content.paragraphs.map((paragraph, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 段落按位置编辑（文字可能为空或重复），位置即身份
        <fieldset key={index} className="slot-card">
          <legend className="slot-card__title">第 {index + 1} 段</legend>
          <TextInput
            label="文字"
            value={paragraph.text}
            maxLength={WAYBILL_LIMITS.paragraphLength}
            placeholder="例如 {收件人}  {收件电话}"
            onChange={(text) => setParagraph(index, { text })}
          />
          <SelectField
            label="插入"
            value={INSERT_PLACEHOLDER}
            options={INSERT_OPTIONS}
            onChange={(variable) => {
              if (variable !== INSERT_PLACEHOLDER) {
                setParagraph(index, { text: `${paragraph.text}${variable}`.slice(0, WAYBILL_LIMITS.paragraphLength) });
              }
            }}
          />
          <NumberField
            label="字号"
            value={paragraph.fontSizeMm}
            min={WAYBILL_LIMITS.fontSizeMm.min}
            max={WAYBILL_LIMITS.fontSizeMm.max}
            step={FONT_STEP_MM}
            onChange={(fontSizeMm) => setParagraph(index, { fontSizeMm })}
          />
          <Toggle label="加粗" checked={paragraph.bold} onChange={(bold) => setParagraph(index, { bold })} />
          <Toggle label="折行" checked={paragraph.wrap} onChange={(wrap) => setParagraph(index, { wrap })} />
          <div className="slot-card__actions">
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => onChange({ ...content, paragraphs: content.paragraphs.filter((_, i) => i !== index) })}
            >
              删除这一段
            </button>
          </div>
        </fieldset>
      ))}
      {content.paragraphs.length < WAYBILL_LIMITS.paragraphs && (
        <button
          type="button"
          className="button button--small button--quiet"
          onClick={() => onChange({ ...content, paragraphs: [...content.paragraphs, { ...DEFAULT_PARAGRAPH }] })}
        >
          加一段
        </button>
      )}
    </>
  );
}
