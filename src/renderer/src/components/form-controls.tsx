import { useEffect, useId, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  /** 失焦时除了恢复非法输入，还要做的事：设计器属性栏用它结束撤销历史的合并（见 canvas-history 的 mergeKey）。 */
  onBlur?: () => void;
}

/** 输入过程中只提交范围内的合法数字；失焦时把非法输入恢复成当前值。 */
export function NumberField({ label, value, min, max, step, unit = 'mm', onChange, onBlur }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <span className="form-row__control">
        <input
          id={id}
          type="number"
          className="text-field text-field--number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
              onChange(parsed);
            }
          }}
          onBlur={() => {
            setDraft(String(value));
            onBlur?.();
          }}
        />
        <span className="form-row__unit">{unit}</span>
      </span>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 旁边的标签文字用 htmlFor 指向开关时传入。 */
  id?: string;
  /** 旁边没有可见的标签文字时，读屏软件念的名称。 */
  ariaLabel?: string;
  disabled?: boolean;
  /** 开关右边的状态文字，例如「开启 / 关闭」。 */
  text?: string;
  /** 不带底色，放在设置行、卡片里时用。 */
  isBare?: boolean;
  className?: string;
}

/** 开关：原生复选框（role=switch）加上画出来的滑轨，各页共用这一份结构。 */
export function Switch({ checked, onChange, id, ariaLabel, disabled, text, isBare = false, className }: SwitchProps) {
  const classes = ['switch', isBare ? 'switch--bare' : null, className].filter(Boolean).join(' ');
  return (
    <label className={classes}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      {text && <span className="switch__text">{text}</span>}
    </label>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** 表单里的一行开关：左边标签，右边开关。 */
export function Toggle({ label, checked, onChange }: ToggleProps) {
  const id = useId();
  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <Switch id={id} isBare checked={checked} onChange={onChange} />
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  /** hint：悬停提示，选项上写不下的说明（例如二维码容错「低」能恢复约 7%）。 */
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  /** 只要选项本身（放在 SettingRow 里，标签由它显示），不要表单行和标签。 */
  isBare?: boolean;
}

export function Segmented<T extends string>({ label, value, options, onChange, isBare }: SegmentedProps<T>) {
  const group = (
    <fieldset className="segmented" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          title={option.hint}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
  if (isBare) {
    return group;
  }
  return (
    <div className="form-row">
      <span className="form-row__label">{label}</span>
      {group}
    </div>
  );
}

interface TextInputProps {
  label: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  /** 候选列表（`<datalist>`）的 id：仍可输入候选之外的内容。 */
  list?: string;
  onChange: (value: string) => void;
  /** 失焦时要做的事：设计器属性栏用它结束撤销历史的合并（见 canvas-history 的 mergeKey）。 */
  onBlur?: () => void;
}

export function TextInput({ label, value, maxLength, placeholder, list, onChange, onBlur }: TextInputProps) {
  const id = useId();
  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="text-field"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        list={list}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/** 选项较多时用下拉框（少量选项用 Segmented）。 */
export function SelectField<T extends string>({ label, value, options, onChange }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select-field" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  maxLength: number;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}

export function TextAreaField({ label, value, maxLength, rows = 3, placeholder, onChange }: TextAreaFieldProps) {
  const id = useId();
  return (
    <div className="form-row form-row--stacked">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="text-field text-area"
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

interface StringListProps {
  label: string;
  values: readonly string[];
  maxItems: number;
  maxLength: number;
  placeholder?: string;
  onChange: (values: string[]) => void;
}

/** 有顺序的一组短文本（例如分隔符拆分的字段名）：逐项编辑、增删。 */
export function StringList({ label, values, maxItems, maxLength, placeholder, onChange }: StringListProps) {
  const set = (index: number, next: string) => onChange(values.map((value, i) => (i === index ? next : value)));
  return (
    <fieldset className="string-list">
      <legend className="form-row__label">{label}</legend>
      {values.map((value, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 按位置编辑的列表，编辑中可能为空或重复，位置即身份
        <div key={index} className="string-list__row">
          <span className="string-list__index">{index + 1}</span>
          <input
            type="text"
            className="text-field"
            aria-label={`${label}第 ${index + 1} 项`}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => set(index, event.target.value)}
          />
          <button
            type="button"
            className="button button--small button--quiet"
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button--small"
        disabled={values.length >= maxItems}
        onClick={() => onChange([...values, ''])}
      >
        添加（{values.length}/{maxItems}）
      </button>
    </fieldset>
  );
}
