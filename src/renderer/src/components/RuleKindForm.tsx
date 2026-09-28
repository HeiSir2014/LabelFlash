import { useEffect, useState } from 'react';
import { MAX_RAW_LENGTH } from '../../../core/scan/normalize-raw';
import {
  type DelimitedRule,
  type KeyValueField,
  type KeyValueRule,
  type RegexRule,
  RULE_LIMITS,
  type ScanRule,
  WHOLE_CHARSETS,
  type WholeCharset,
  type WholeRule,
} from '../../../core/scan/rule-model';
import { NumberField, Segmented, SelectField, StringList, TextAreaField, TextInput, Toggle } from './form-controls';

interface KindFormProps<R extends ScanRule> {
  rule: R;
  onChange: (rule: R) => void;
}

/** 按规则类型显示对应的表单。 */
export function RuleKindForm({ rule, onChange }: KindFormProps<ScanRule>) {
  switch (rule.kind) {
    case 'delimited':
      return <DelimitedForm rule={rule} onChange={onChange} />;
    case 'keyValue':
      return <KeyValueForm rule={rule} onChange={onChange} />;
    case 'whole':
      return <WholeForm rule={rule} onChange={onChange} />;
    case 'regex':
      return <RegexForm rule={rule} onChange={onChange} />;
  }
}

/** 常用分隔符；看不见的（换行、制表符、空格）只能从这里选。 */
const DELIMITER_PRESETS = [
  { value: '-', label: '横杠 -' },
  { value: '_', label: '下划线 _' },
  { value: '|', label: '竖线 |' },
  { value: ',', label: '逗号 ,' },
  { value: '/', label: '斜杠 /' },
  { value: ' ', label: '空格' },
  { value: '\t', label: '制表符' },
  { value: '\n', label: '换行' },
] as const;
const CUSTOM_DELIMITER = 'custom';

function DelimitedForm({ rule, onChange }: KindFormProps<DelimitedRule>) {
  const preset = DELIMITER_PRESETS.find((option) => option.value === rule.delimiter)?.value ?? CUSTOM_DELIMITER;
  const { min, max } = RULE_LIMITS.delimitedFields;
  return (
    <section className="form-section">
      <h2 className="form-section__title">分隔符拆分</h2>
      <SelectField
        label="分隔符"
        value={preset}
        options={[...DELIMITER_PRESETS, { value: CUSTOM_DELIMITER, label: '其他…' }]}
        onChange={(value) => onChange({ ...rule, delimiter: value === CUSTOM_DELIMITER ? '#' : value })}
      />
      {preset === CUSTOM_DELIMITER && (
        <TextInput
          label="自定义"
          value={rule.delimiter}
          maxLength={RULE_LIMITS.delimiterLength}
          onChange={(delimiter) => onChange({ ...rule, delimiter })}
        />
      )}
      <StringList
        label="字段（按顺序）"
        values={rule.fields}
        maxItems={max}
        maxLength={RULE_LIMITS.fieldNameLength}
        placeholder="字段名"
        onChange={(fields) =>
          onChange({ ...rule, fields, overflowIndex: Math.min(rule.overflowIndex, Math.max(0, fields.length - 1)) })
        }
      />
      <p className="form-hint">
        要有 {min}–{max} 个字段。段数正好等于字段数才算匹配；段数更多时，多出来的分隔符并入下面选的字段。
      </p>
      <SelectField
        label="多余分隔符并入"
        value={String(rule.overflowIndex)}
        options={rule.fields.map((field, index) => ({
          value: String(index),
          label: field || `第 ${index + 1} 个字段`,
        }))}
        onChange={(value) => onChange({ ...rule, overflowIndex: Number(value) })}
      />
    </section>
  );
}

function KeyValueForm({ rule, onChange }: KindFormProps<KeyValueRule>) {
  const setField = (index: number, patch: Partial<KeyValueField>) =>
    onChange({ ...rule, fields: rule.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) });
  const removeField = (index: number) => {
    const removed = rule.fields[index]?.name;
    onChange({
      ...rule,
      fields: rule.fields.filter((_, i) => i !== index),
      required: rule.required.filter((name) => name !== removed),
    });
  };
  const toggleRequired = (name: string, isRequired: boolean) =>
    onChange({
      ...rule,
      required: isRequired ? [...rule.required, name] : rule.required.filter((item) => item !== name),
    });
  return (
    <section className="form-section">
      <h2 className="form-section__title">多行键值</h2>
      <StringList
        label="键和值之间的分隔符"
        values={rule.separators}
        maxItems={RULE_LIMITS.separators}
        maxLength={RULE_LIMITS.separatorLength}
        placeholder="例如 ："
        onChange={(separators) => onChange({ ...rule, separators })}
      />
      <fieldset className="key-fields">
        <legend className="form-row__label">登记的字段</legend>
        {rule.fields.map((field, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 按位置编辑的列表，编辑中字段名可能为空或重复
          <div key={index} className="key-fields__row">
            <input
              type="text"
              className="text-field"
              aria-label={`第 ${index + 1} 个字段名`}
              value={field.name}
              maxLength={RULE_LIMITS.fieldNameLength}
              placeholder="字段名"
              onChange={(event) => setField(index, { name: event.target.value })}
            />
            <AliasesInput
              label={`第 ${index + 1} 个字段的其他写法`}
              aliases={field.aliases}
              onChange={(aliases) => setField(index, { aliases })}
            />
            <label className="key-fields__required">
              <input
                type="checkbox"
                checked={rule.required.includes(field.name)}
                onChange={(event) => toggleRequired(field.name, event.target.checked)}
              />
              必填
            </label>
            <button type="button" className="button button--small button--quiet" onClick={() => removeField(index)}>
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--small"
          disabled={rule.fields.length >= RULE_LIMITS.keyValueFields}
          onClick={() => onChange({ ...rule, fields: [...rule.fields, { name: '', aliases: [] }] })}
        >
          添加字段（{rule.fields.length}/{RULE_LIMITS.keyValueFields}）
        </button>
      </fieldset>
      <p className="form-hint">
        每行按最先出现的分隔符拆成「名称」和「值」；名称和其他写法都不区分大小写。勾了必填的字段都识别到才算匹配，没勾时至少要识别到一个登记的字段。
      </p>
      <Toggle
        label="保留未登记的键"
        checked={rule.keepUnknown}
        onChange={(keepUnknown) => onChange({ ...rule, keepUnknown })}
      />
    </section>
  );
}

const CHARSET_OPTIONS: ReadonlyArray<{ value: WholeCharset; label: string }> = WHOLE_CHARSETS.map((charset) => ({
  value: charset,
  label: { digits: '纯数字', alphanumeric: '字母和数字', any: '不限' }[charset],
}));

function WholeForm({ rule, onChange }: KindFormProps<WholeRule>) {
  return (
    <section className="form-section">
      <h2 className="form-section__title">整段匹配</h2>
      <TextInput
        label="字段名"
        value={rule.field}
        maxLength={RULE_LIMITS.fieldNameLength}
        onChange={(field) => onChange({ ...rule, field })}
      />
      <Segmented
        label="字符"
        value={rule.charset}
        options={CHARSET_OPTIONS}
        onChange={(charset) => onChange({ ...rule, charset })}
      />
      <NumberField
        label="最短"
        unit="位"
        value={rule.minLength}
        min={1}
        max={MAX_RAW_LENGTH}
        step={1}
        onChange={(minLength) => onChange({ ...rule, minLength })}
      />
      <NumberField
        label="最长"
        unit="位"
        value={rule.maxLength}
        min={1}
        max={MAX_RAW_LENGTH}
        step={1}
        onChange={(maxLength) => onChange({ ...rule, maxLength })}
      />
    </section>
  );
}

const REGEX_FLAG_LABELS: ReadonlyArray<{ flag: string; label: string }> = [
  { flag: 'i', label: '忽略大小写' },
  { flag: 'm', label: '^ $ 按行匹配' },
  { flag: 's', label: '. 能匹配换行' },
  { flag: 'u', label: 'Unicode' },
];

function RegexForm({ rule, onChange }: KindFormProps<RegexRule>) {
  const toggleFlag = (flag: string, isOn: boolean) =>
    onChange({ ...rule, flags: isOn ? `${rule.flags}${flag}` : rule.flags.replace(flag, '') });
  return (
    <section className="form-section">
      <h2 className="form-section__title">正则</h2>
      <TextAreaField
        label="正则"
        value={rule.pattern}
        maxLength={RULE_LIMITS.patternLength}
        rows={2}
        placeholder="例如 ^(?<订单号>\d{12})$"
        onChange={(pattern) => onChange({ ...rule, pattern })}
      />
      <p className="form-hint">
        用命名分组 (?&lt;字段名&gt;…) 取字段，分组名就是字段名。正则在隔离环境里执行，超过 20 毫秒按不匹配处理。
      </p>
      {REGEX_FLAG_LABELS.map(({ flag, label }) => (
        <Toggle
          key={flag}
          label={label}
          checked={rule.flags.includes(flag)}
          onChange={(isOn) => toggleFlag(flag, isOn)}
        />
      ))}
    </section>
  );
}

interface AliasesInputProps {
  label: string;
  aliases: readonly string[];
  onChange: (aliases: string[]) => void;
}

/**
 * 别名用一个输入框、逗号分隔。输入框保留自己的文字（否则刚打的逗号会被规范化吃掉），
 * 只有外部的别名真正变了（例如撤销编辑）才同步回来。
 */
function AliasesInput({ label, aliases, onChange }: AliasesInputProps) {
  const [text, setText] = useState(aliases.join('，'));
  useEffect(() => {
    setText((current) => (sameList(splitList(current), aliases) ? current : aliases.join('，')));
  }, [aliases]);
  return (
    <input
      type="text"
      className="text-field"
      aria-label={label}
      value={text}
      placeholder="其他写法，用逗号分隔"
      onChange={(event) => {
        setText(event.target.value);
        onChange(splitList(event.target.value));
      }}
    />
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** 「单号，Order,  No」→ ['单号', 'Order', 'No']：中英文逗号都算分隔。 */
function splitList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
