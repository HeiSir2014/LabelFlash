import { isValidFieldName, RULE_LIMITS } from '../../../core/scan/rule-model';
import {
  type FieldArrangement,
  type FieldSlot,
  type FieldsArea,
  type FieldsMode,
  TEMPLATE_LIMITS,
} from '../../../core/templates/template-model';
import { NumberField, Segmented, TextInput, Toggle } from './form-controls';

const FONT_STEP_MM = 0.1;
const NEW_SLOT_STYLE = { fontSizeMm: 3.2, bold: true } as const;

const MODE_OPTIONS: ReadonlyArray<{ value: FieldsMode; label: string }> = [
  { value: 'all', label: '全部字段' },
  { value: 'pick', label: '指定字段' },
];

const ARRANGEMENT_OPTIONS: ReadonlyArray<{ value: FieldArrangement; label: string }> = [
  { value: 'inline', label: '横向（名称 值）' },
  { value: 'stacked', label: '垂直（名称在上）' },
];

interface FieldsAreaEditorProps {
  area: FieldsArea;
  onChange: (area: FieldsArea) => void;
}

/** 二维码旁的字段区：两种模式的设置都保留，切换模式不会丢掉另一种的配置。 */
export function FieldsAreaEditor({ area, onChange }: FieldsAreaEditorProps) {
  const { fontSizeMm } = TEMPLATE_LIMITS;
  const setAll = (patch: Partial<FieldsArea['all']>) => onChange({ ...area, all: { ...area.all, ...patch } });
  const setSlots = (slots: FieldSlot[]) => onChange({ ...area, slots });

  return (
    <section className="form-section">
      <h3 className="form-section__title">字段</h3>
      <Segmented
        label="显示"
        value={area.mode}
        options={MODE_OPTIONS}
        onChange={(mode) => onChange({ ...area, mode })}
      />
      <Segmented
        label="排列"
        value={area.arrangement}
        options={ARRANGEMENT_OPTIONS}
        onChange={(arrangement) => onChange({ ...area, arrangement })}
      />
      <p className="form-hint">
        横向：名称和值在同一行，值对齐成一列；垂直：名称单独一行（小一号），值在下一行，适合值比较长的内容。
      </p>
      {area.mode === 'all' ? (
        <>
          <p className="form-hint">
            按识别顺序列出识别到的全部字段，最多 {TEMPLATE_LIMITS.allFieldRows} 行；各行同一字号，放不下时一起缩小。
          </p>
          <Toggle label="显示字段名" checked={area.all.showNames} onChange={(showNames) => setAll({ showNames })} />
          {area.all.showNames && (
            <TextInput
              label="分隔符"
              value={area.all.separator}
              maxLength={TEMPLATE_LIMITS.separatorLength}
              placeholder="不填则名称后不加符号"
              onChange={(separator) => setAll({ separator })}
            />
          )}
          <NumberField
            label="字号"
            value={area.all.fontSizeMm}
            min={fontSizeMm.min}
            max={fontSizeMm.max}
            step={FONT_STEP_MM}
            onChange={(size) => setAll({ fontSizeMm: size })}
          />
          <Toggle label="加粗" checked={area.all.bold} onChange={(bold) => setAll({ bold })} />
        </>
      ) : (
        <SlotList slots={area.slots} onChange={setSlots} />
      )}
    </section>
  );
}

function SlotList({ slots, onChange }: { slots: FieldSlot[]; onChange: (slots: FieldSlot[]) => void }) {
  const setSlot = (index: number, patch: Partial<FieldSlot>) =>
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  const move = (index: number, offset: -1 | 1) => {
    const next = [...slots];
    const [moved] = next.splice(index, 1);
    if (moved) {
      next.splice(index + offset, 0, moved);
      onChange(next);
    }
  };
  const add = () => onChange([...slots, { ...NEW_SLOT_STYLE, field: unusedFieldName(slots), prefix: '' }]);

  return (
    <>
      <p className="form-hint">
        只显示这里列出、且这次识别到的字段；一个都没识别到时，按「全部字段」显示，标签不会空白。
      </p>
      {slots.map((slot, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行就是按位置编辑的（编辑中字段名可能为空或重复），位置即身份
        <fieldset key={index} className="slot-card">
          <legend className="slot-card__title">第 {index + 1} 行</legend>
          <TextInput
            label="字段名"
            value={slot.field}
            maxLength={RULE_LIMITS.fieldNameLength}
            placeholder="例如 订单号"
            onChange={(field) => setSlot(index, { field })}
          />
          {!isValidFieldName(slot.field) && (
            <p className="form-hint form-hint--error">
              字段名不能为空，不能含花括号、换行或首尾空格；保存时会去掉这一行
            </p>
          )}
          <TextInput
            label="前缀文字"
            value={slot.prefix}
            maxLength={TEMPLATE_LIMITS.prefixLength}
            placeholder="例如 编码："
            onChange={(prefix) => setSlot(index, { prefix })}
          />
          <NumberField
            label="字号"
            value={slot.fontSizeMm}
            min={TEMPLATE_LIMITS.fontSizeMm.min}
            max={TEMPLATE_LIMITS.fontSizeMm.max}
            step={FONT_STEP_MM}
            onChange={(size) => setSlot(index, { fontSizeMm: size })}
          />
          <Toggle label="加粗" checked={slot.bold} onChange={(bold) => setSlot(index, { bold })} />
          <div className="slot-card__actions">
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              上移
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={index === slots.length - 1}
              onClick={() => move(index, 1)}
            >
              下移
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => onChange(slots.filter((_, i) => i !== index))}
            >
              删除
            </button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="button" disabled={slots.length >= TEMPLATE_LIMITS.slots} onClick={add}>
        添加字段（{slots.length}/{TEMPLATE_LIMITS.slots}）
      </button>
    </>
  );
}

function unusedFieldName(slots: readonly FieldSlot[]): string {
  const used = new Set(slots.map((slot) => slot.field));
  let index = slots.length + 1;
  while (used.has(`字段${index}`)) {
    index += 1;
  }
  return `字段${index}`;
}
