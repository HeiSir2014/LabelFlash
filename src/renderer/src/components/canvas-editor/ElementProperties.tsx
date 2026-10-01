import { useEffect, useId, useRef, useState } from 'react';
import {
  BARCODE_TYPES,
  barcodeType,
  CANVAS_ELEMENT_LABELS,
  CANVAS_LIMITS,
  type CanvasBarcode,
  type CanvasElement,
  type CanvasImage,
  type CanvasLine,
  type CanvasQr,
  type CanvasRect,
  type CanvasText,
  ROTATIONS,
  type Rotation,
} from '../../../../core/templates/canvas-model';
import type { PaperSize } from '../../../../shared/paper-sizes';
import { useImageImport } from '../../view-models/use-image-import';
import { NumberField, Segmented, TextInput, Toggle } from '../form-controls';
import { InsertField } from './InsertField';
import {
  ALIGN_OPTIONS,
  BORDER_STEP_MM,
  FIT_OPTIONS,
  FONT_STEP_MM,
  IMAGE_MODE_OPTIONS,
  POSITION_STEP_MM,
  QR_LEVEL_OPTIONS,
  RADIUS_STEP_MM,
  ROTATION_OPTIONS,
  VALIGN_OPTIONS,
} from './options';
import { TableProperties } from './TableProperties';

/** 灰度阈值的上限：0 全白、255 全黑之间。 */
const THRESHOLD_MAX = 255;
/** 选图片时接受的格式：浏览器能解码的常见位图。 */
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/bmp,image/gif,image/webp';

/** 改了一项：field 是哪一项，撤销历史按「元素 + 字段」合并连续输入。 */
type ElementChange = (next: CanvasElement, field: string) => void;

export interface ElementPropertiesProps {
  element: CanvasElement;
  paper: PaperSize;
  /** 模板里所有元素：插入图片时核对整个模板的图片总量。 */
  elements: readonly CanvasElement[];
  fieldNames: readonly string[];
  /** 双击了哪个文字元素：它的「内容」框拿到焦点后调用 onTextEditStarted 清掉。 */
  editTextId: string | null;
  onTextEditStarted: () => void;
  onChange: ElementChange;
  onRotate: (rotation: Rotation) => void;
  /** 属性栏的文字 / 数字框失焦时调用：结束撤销历史的合并，不然焦点挪回来接着改会并进上一步。 */
  onEndMerge: () => void;
}

/** 选中一个元素时右栏的属性：通用的位置、大小、旋转、锁定，再加这一类自己的设置。 */
export function ElementProperties(props: ElementPropertiesProps) {
  const { element, paper, onChange, onRotate, onEndMerge } = props;
  const min = CANVAS_LIMITS.minSizeMm;
  return (
    <>
      <section className="form-section">
        <h2 className="form-section__title">{CANVAS_ELEMENT_LABELS[element.kind]}</h2>
        <TextInput
          label="名称"
          value={element.name}
          maxLength={CANVAS_LIMITS.nameLength}
          onChange={(name) => onChange({ ...element, name }, 'name')}
          onBlur={onEndMerge}
        />
        <NumberField
          label="X"
          value={element.x}
          min={0}
          max={paper.widthMm - element.width}
          step={POSITION_STEP_MM}
          onChange={(x) => onChange({ ...element, x }, 'x')}
          onBlur={onEndMerge}
        />
        <NumberField
          label="Y"
          value={element.y}
          min={0}
          max={paper.heightMm - element.height}
          step={POSITION_STEP_MM}
          onChange={(y) => onChange({ ...element, y }, 'y')}
          onBlur={onEndMerge}
        />
        <NumberField
          label="宽"
          value={element.width}
          min={min}
          max={paper.widthMm - element.x}
          step={POSITION_STEP_MM}
          onChange={(width) => onChange({ ...element, width }, 'width')}
          onBlur={onEndMerge}
        />
        <NumberField
          label="高"
          value={element.height}
          min={min}
          max={paper.heightMm - element.y}
          step={POSITION_STEP_MM}
          onChange={(height) => onChange({ ...element, height }, 'height')}
          onBlur={onEndMerge}
        />
        <Segmented
          label="旋转"
          value={String(element.rotation)}
          options={ROTATION_OPTIONS}
          onChange={(value) => onRotate(ROTATIONS.find((rotation) => String(rotation) === value) ?? 0)}
        />
        <Toggle
          label="锁定"
          checked={element.locked}
          onChange={(locked) => onChange({ ...element, locked }, 'locked')}
        />
        {element.locked && <p className="form-hint">锁定后在画布上不能拖动、缩放和删除；这里的数字照样能改。</p>}
      </section>
      <section className="form-section">
        <h2 className="form-section__title">设置</h2>
        <KindProperties {...props} />
      </section>
    </>
  );
}

function KindProperties({
  element,
  paper,
  elements,
  fieldNames,
  editTextId,
  onTextEditStarted,
  onChange,
  onEndMerge,
}: ElementPropertiesProps) {
  switch (element.kind) {
    case 'text':
      return (
        <TextProperties
          element={element}
          fieldNames={fieldNames}
          editTextId={editTextId}
          onTextEditStarted={onTextEditStarted}
          onChange={onChange}
          onEndMerge={onEndMerge}
        />
      );
    case 'barcode':
      return (
        <BarcodeProperties element={element} fieldNames={fieldNames} onChange={onChange} onEndMerge={onEndMerge} />
      );
    case 'qr':
      return <QrProperties element={element} fieldNames={fieldNames} onChange={onChange} onEndMerge={onEndMerge} />;
    case 'image':
      return <ImageProperties element={element} elements={elements} onChange={onChange} />;
    case 'line':
      return <LineProperties element={element} onChange={onChange} />;
    case 'rect':
      return <RectProperties element={element} onChange={onChange} onEndMerge={onEndMerge} />;
    case 'table':
      return (
        <TableProperties
          element={element}
          paper={paper}
          fieldNames={fieldNames}
          onChange={onChange}
          onEndMerge={onEndMerge}
        />
      );
  }
}

function TextProperties({
  element,
  fieldNames,
  editTextId,
  onTextEditStarted,
  onChange,
  onEndMerge,
}: {
  element: CanvasText;
  fieldNames: readonly string[];
  editTextId: string | null;
  onTextEditStarted: () => void;
  onChange: ElementChange;
  onEndMerge: () => void;
}) {
  const id = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  // 双击了画布上的这个文字：直接在这里改内容（整段选中，打字即替换）。
  useEffect(() => {
    if (editTextId === element.id) {
      textRef.current?.focus();
      textRef.current?.select();
      onTextEditStarted();
    }
  }, [editTextId, element.id, onTextEditStarted]);
  const setText = (text: string) => onChange({ ...element, text: text.slice(0, CANVAS_LIMITS.textLength) }, 'text');
  const { fontSizeMm } = CANVAS_LIMITS;
  return (
    <>
      <div className="form-row form-row--stacked">
        <label className="form-row__label" htmlFor={id}>
          内容
        </label>
        <textarea
          ref={textRef}
          id={id}
          className="text-field text-area"
          rows={3}
          value={element.text}
          maxLength={CANVAS_LIMITS.textLength}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onBlur={onEndMerge}
        />
      </div>
      <InsertField fieldNames={fieldNames} onInsert={(variable) => setText(`${element.text}${variable}`)} />
      <p className="form-hint">用 {'{字段名}'} 印扫码识别出的字段；一行里的字段全是空的，这一行不印。</p>
      <NumberField
        label="字号"
        value={element.fontSizeMm}
        min={fontSizeMm.min}
        max={fontSizeMm.max}
        step={FONT_STEP_MM}
        onChange={(value) => onChange({ ...element, fontSizeMm: value }, 'fontSizeMm')}
        onBlur={onEndMerge}
      />
      <Toggle label="加粗" checked={element.bold} onChange={(bold) => onChange({ ...element, bold }, 'bold')} />
      <Segmented
        label="对齐"
        value={element.align}
        options={ALIGN_OPTIONS}
        onChange={(align) => onChange({ ...element, align }, 'align')}
      />
      <Segmented
        label="垂直"
        value={element.valign}
        options={VALIGN_OPTIONS}
        onChange={(valign) => onChange({ ...element, valign }, 'valign')}
      />
      <Segmented
        label="放不下时"
        value={element.fit}
        options={FIT_OPTIONS}
        onChange={(fit) => onChange({ ...element, fit }, 'fit')}
      />
      <Toggle
        label="反白"
        checked={element.inverse}
        onChange={(inverse) => onChange({ ...element, inverse }, 'inverse')}
      />
    </>
  );
}

function BarcodeProperties({
  element,
  fieldNames,
  onChange,
  onEndMerge,
}: {
  element: CanvasBarcode;
  fieldNames: readonly string[];
  onChange: ElementChange;
  onEndMerge: () => void;
}) {
  const id = useId();
  const isLinear = barcodeType(element.symbology)?.dimensions !== 2;
  const { fontSizeMm, valueLength } = CANVAS_LIMITS;
  const group = (label: string, types: typeof BARCODE_TYPES) => (
    <optgroup label={label}>
      {types.map((type) => (
        <option key={type.id} value={type.id}>
          {type.label}
        </option>
      ))}
    </optgroup>
  );
  return (
    <>
      <div className="form-row">
        <label className="form-row__label" htmlFor={id}>
          码制
        </label>
        <select
          id={id}
          className="select-field"
          value={element.symbology}
          onChange={(event) => onChange({ ...element, symbology: event.target.value }, 'symbology')}
        >
          {group(
            '常用',
            BARCODE_TYPES.filter((type) => type.common),
          )}
          {group(
            '更多一维码',
            BARCODE_TYPES.filter((type) => !type.common && type.dimensions === 1),
          )}
          {group(
            '更多二维码',
            BARCODE_TYPES.filter((type) => type.dimensions === 2),
          )}
        </select>
      </div>
      <TextInput
        label="内容"
        value={element.value}
        maxLength={valueLength}
        placeholder="{编码}"
        onChange={(value) => onChange({ ...element, value }, 'value')}
        onBlur={onEndMerge}
      />
      <InsertField
        fieldNames={fieldNames}
        onInsert={(variable) =>
          onChange({ ...element, value: `${element.value}${variable}`.slice(0, valueLength) }, 'value')
        }
      />
      <p className="form-hint">
        内容不合这种码制（位数不对、校验位错、有中文）时这张不印条码，底部「打印前检查」写明原因。
      </p>
      {isLinear && (
        <Toggle
          label="印号码"
          checked={element.showText}
          onChange={(showText) => onChange({ ...element, showText }, 'showText')}
        />
      )}
      {isLinear && element.showText && (
        <NumberField
          label="号码字号"
          value={element.textSizeMm}
          min={fontSizeMm.min}
          max={fontSizeMm.max}
          step={FONT_STEP_MM}
          onChange={(textSizeMm) => onChange({ ...element, textSizeMm }, 'textSizeMm')}
          onBlur={onEndMerge}
        />
      )}
    </>
  );
}

function QrProperties({
  element,
  fieldNames,
  onChange,
  onEndMerge,
}: {
  element: CanvasQr;
  fieldNames: readonly string[];
  onChange: ElementChange;
  onEndMerge: () => void;
}) {
  const { valueLength } = CANVAS_LIMITS;
  return (
    <>
      <TextInput
        label="内容"
        value={element.value}
        maxLength={valueLength}
        placeholder="{完整内容}"
        onChange={(value) => onChange({ ...element, value }, 'value')}
        onBlur={onEndMerge}
      />
      <InsertField
        fieldNames={fieldNames}
        onInsert={(variable) =>
          onChange({ ...element, value: `${element.value}${variable}`.slice(0, valueLength) }, 'value')
        }
      />
      <Segmented
        label="容错"
        value={element.errorCorrection}
        options={QR_LEVEL_OPTIONS}
        onChange={(errorCorrection) => onChange({ ...element, errorCorrection }, 'errorCorrection')}
      />
      <p className="form-hint">内容太长放不下时自动降低容错，仍放不下就不印，并在底部「打印前检查」说明。</p>
    </>
  );
}

function RangeField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <span className="form-row__control">
        <input
          id={id}
          type="range"
          className="designer-range"
          min={0}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="form-row__unit">{value}</span>
      </span>
    </div>
  );
}

function ImageProperties({
  element,
  elements,
  onChange,
}: {
  element: CanvasImage;
  elements: readonly CanvasElement[];
  onChange: ElementChange;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const importImage = useImageImport();
  // 导入耗时（解码、缩放可能要几百毫秒），期间用户可能已经改了这个元素的其他属性（位置、阈值……）；
  // 不能用选文件那一刻（渲染时闭包捕获的、这时已经过时）的元素去覆盖这些改动，所以用 ref 跟住最新的元素，
  // 在 useEffect 里更新（不在渲染过程中改 ref）。
  const elementRef = useRef(element);
  useEffect(() => {
    elementRef.current = element;
  }, [element]);
  // 新建的图片元素是 1×1 的白点（canvas-model 的默认值），还没有真正的图。
  const hasPicture = element.pixelWidth > 1 || element.pixelHeight > 1;
  const onFile = async (file: File) => {
    setIsReading(true);
    const picked = await importImage(file, element, elements);
    setIsReading(false);
    if (picked !== null) {
      onChange(
        {
          ...elementRef.current,
          pixels: picked.pixels,
          pixelWidth: picked.pixelWidth,
          pixelHeight: picked.pixelHeight,
        },
        'pixels',
      );
    }
  };
  return (
    <>
      <div className="form-row">
        <span className="form-row__label">图片</span>
        <div className="designer-image">
          <span className="form-row__unit">
            {hasPicture ? `${element.pixelWidth}×${element.pixelHeight} 像素` : '还没有选图片'}
          </span>
          <button
            type="button"
            className="button button--small"
            disabled={isReading}
            onClick={() => inputRef.current?.click()}
          >
            {isReading ? '正在读取…' : '选择图片…'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // 清掉选择：同一个文件改过之后再选一次也能触发。
              event.target.value = '';
              if (file) {
                void onFile(file);
              }
            }}
          />
        </div>
      </div>
      <Segmented
        label="转黑白"
        value={element.mode}
        options={IMAGE_MODE_OPTIONS}
        onChange={(mode) => onChange({ ...element, mode }, 'mode')}
      />
      <RangeField
        label="阈值"
        value={element.threshold}
        max={THRESHOLD_MAX}
        onChange={(threshold) => onChange({ ...element, threshold }, 'threshold')}
      />
      <p className="form-hint">
        标签机只有黑白两色：「阈值」适合 Logo
        和线稿，比阈值暗的印黑；「抖动」适合照片，用点的疏密表示深浅。图片在框里等比缩放。
      </p>
    </>
  );
}

function LineProperties({ element, onChange }: { element: CanvasLine; onChange: ElementChange }) {
  return (
    <>
      <Toggle label="虚线" checked={element.dashed} onChange={(dashed) => onChange({ ...element, dashed }, 'dashed')} />
      <p className="form-hint">{`横线还是竖线看宽和高哪个长，粗细是短的那一边（最细 ${CANVAS_LIMITS.minSizeMm}mm）。`}</p>
    </>
  );
}

function RectProperties({
  element,
  onChange,
  onEndMerge,
}: {
  element: CanvasRect;
  onChange: ElementChange;
  onEndMerge: () => void;
}) {
  return (
    <>
      <NumberField
        label="边框"
        value={element.borderMm}
        min={CANVAS_LIMITS.borderMm.min}
        max={CANVAS_LIMITS.borderMm.max}
        step={BORDER_STEP_MM}
        onChange={(borderMm) => onChange({ ...element, borderMm }, 'borderMm')}
        onBlur={onEndMerge}
      />
      <Toggle label="填黑" checked={element.filled} onChange={(filled) => onChange({ ...element, filled }, 'filled')} />
      <NumberField
        label="圆角"
        value={element.radiusMm}
        min={0}
        max={CANVAS_LIMITS.radiusMm.max}
        step={RADIUS_STEP_MM}
        onChange={(radiusMm) => onChange({ ...element, radiusMm }, 'radiusMm')}
        onBlur={onEndMerge}
      />
      <p className="form-hint">边框填 0 就没有边框；填黑之后可以在上面放反白的文字。</p>
    </>
  );
}
