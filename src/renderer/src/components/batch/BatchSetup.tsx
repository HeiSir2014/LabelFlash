import { useId, useState } from 'react';
import {
  BATCH_LIMITS,
  type CopiesSettings,
  DEFAULT_COPIES,
  type FieldSource,
  sourceOf,
} from '../../../../core/batch/batch-model';
import { usesSerial } from '../../../../core/batch/column-mapping';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import { describeTable, serialExample, sourceFromKey, sourceKey } from '../../lib/batch-view';
import type { BatchViewModel } from '../../view-models/use-batch';
import { NumberField, Segmented, SelectField, TextAreaField, TextInput, Toggle } from '../form-controls';

const COPIES_OPTIONS: ReadonlyArray<{ value: CopiesSettings['kind']; label: string }> = [
  { value: 'fixed', label: '每行固定' },
  { value: 'column', label: '取一列' },
];
const SERIAL_SOURCE_OPTIONS = [
  { value: 'generate', label: '按规则生成' },
  { value: 'column', label: '取一列' },
] as const;
const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

interface SectionProps {
  batch: BatchViewModel;
}

/** 批量打印的前四段：模板、数据、对列、序号与份数。 */
export function BatchSetup({ batch, templates }: SectionProps & { templates: readonly LabelTemplate[] }) {
  const titleId = useId();
  return (
    <>
      <section className="config-card" aria-labelledby={titleId}>
        <h2 id={titleId} className="config-card__title">
          1 模板
        </h2>
        <SelectField
          label="模板"
          value={batch.template?.id ?? ''}
          options={templates.map((template) => ({ value: template.id, label: template.name }))}
          onChange={batch.setTemplateId}
        />
      </section>
      <DataSection batch={batch} />
      <MappingSection batch={batch} />
      <SerialSection batch={batch} />
    </>
  );
}

function DataSection({ batch }: SectionProps) {
  const titleId = useId();
  const [isPasting, setIsPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const applyPaste = async () => {
    if (await batch.pasteTable(pasted)) {
      setIsPasting(false);
      setPasted('');
    }
  };
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        2 数据
      </h2>
      <p className="config-card__text">
        导入 .xlsx 或 .csv（也可以直接把文件拖进窗口），或者粘贴从 Excel 复制的表格。第一行是列名，最多{' '}
        {NUMBER_FORMAT.format(BATCH_LIMITS.rows)} 行。
      </p>
      <div className="batch-data__actions">
        <button type="button" className="button" disabled={batch.isLoading} onClick={batch.openFile}>
          选择文件…
        </button>
        <button
          type="button"
          className="button"
          aria-expanded={isPasting}
          onClick={() => setIsPasting((open) => !open)}
        >
          粘贴表格
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={batch.dataKind === 'serial-only'}
          onClick={batch.toggleSerialOnly}
        >
          只按序号打
        </button>
      </div>
      {isPasting && (
        <div className="batch-data__paste">
          <TextAreaField
            label="粘贴从 Excel 复制的表格（第一行是列名）"
            value={pasted}
            maxLength={BATCH_LIMITS.pasteChars}
            rows={6}
            onChange={setPasted}
          />
          <div className="batch-data__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={pasted.trim() === '' || batch.isLoading}
              onClick={() => void applyPaste()}
            >
              用这些数据
            </button>
            <button type="button" className="button button--quiet" onClick={() => setIsPasting(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      {batch.dataKind === 'serial-only' ? (
        <NumberField
          label="张数"
          value={batch.serialOnlyCount}
          min={1}
          max={BATCH_LIMITS.serialOnlyCount}
          step={1}
          unit="张"
          onChange={batch.setSerialOnlyCount}
        />
      ) : (
        <p className="batch-data__status">{batch.isLoading ? '正在读取…' : describeTable(batch.table)}</p>
      )}
      {batch.loadIssue !== null && (
        <p className="batch-data__issue" role="alert">
          {batch.loadIssue}
        </p>
      )}
    </section>
  );
}

function MappingSection({ batch }: SectionProps) {
  const titleId = useId();
  const { variables, columns, fields } = batch;
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        3 对列
      </h2>
      {fields.mode === 'ALL' && (
        <p className="config-card__text">这个模板显示全部字段：表格的每一列都会印出来，列名就是字段名。</p>
      )}
      {variables.length === 0 && fields.mode === 'PICKED' && (
        <p className="config-card__text">这个模板没有用到字段，不用对列。</p>
      )}
      {variables.length > 0 && (
        <table className="batch-mapping">
          <thead>
            <tr>
              <th scope="col">模板里的字段</th>
              <th scope="col">取值</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((variable) => (
              <MappingRow
                key={variable}
                variable={variable}
                source={sourceOf(batch.mapping, variable)}
                columns={columns}
                isMissing={batch.unmapped.includes(variable)}
                onChange={(source) => batch.setSource(variable, source)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface MappingRowProps {
  variable: string;
  source: FieldSource;
  columns: readonly string[];
  isMissing: boolean;
  onChange: (source: FieldSource) => void;
}

function MappingRow({ variable, source, columns, isMissing, onChange }: MappingRowProps) {
  const name = `{${variable}}`;
  return (
    <tr className={isMissing ? 'batch-mapping__row--missing' : undefined}>
      <th scope="row">{name}</th>
      <td>
        <select
          className="select-field"
          aria-label={`${name} 的取值`}
          value={sourceKey(source)}
          onChange={(event) => onChange(sourceFromKey(event.target.value, source))}
        >
          <option value="none">不填</option>
          {columns.map((column) => (
            <option key={column} value={`column:${column}`}>
              列：{column}
            </option>
          ))}
          <option value="fixed">固定值…</option>
        </select>
        {source.kind === 'fixed' && (
          <input
            type="text"
            className="text-field"
            aria-label={`${name} 的固定值`}
            value={source.value}
            maxLength={BATCH_LIMITS.fixedValueLength}
            onChange={(event) => onChange({ kind: 'fixed', value: event.target.value })}
          />
        )}
        {isMissing && (
          <span className="batch-mapping__hint">没有对上的列：选一列、填固定值，或者不填（这一项不印）</span>
        )}
      </td>
    </tr>
  );
}

function SerialSection({ batch }: SectionProps) {
  const titleId = useId();
  const { fields, serial, copies, columns, hasTable } = batch;
  const isEnabled = batch.plan?.serial.enabled ?? false;
  const columnOptions = columns.map((column) => ({ value: column, label: column }));
  const serialFromColumn = hasTable && serial.column !== null ? serial.column : null;
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        4 序号与份数
      </h2>
      {fields.mode === 'PICKED' && !usesSerial(fields) && (
        <p className="config-card__text">
          这个模板没有用到 {'{序号}'}：要印序号，先在模板里插入 {'{序号}'}。
        </p>
      )}
      {fields.mode === 'ALL' && !usesSerial(fields) && hasTable && (
        <Toggle label="印序号" checked={batch.wantsSerial} onChange={batch.setWantsSerial} />
      )}
      {isEnabled && hasTable && (
        <Segmented
          label="序号"
          value={serialFromColumn === null ? 'generate' : 'column'}
          options={SERIAL_SOURCE_OPTIONS}
          onChange={(mode) => batch.setSerial({ column: mode === 'column' ? (columns[0] ?? null) : null })}
        />
      )}
      {isEnabled && serialFromColumn !== null && (
        <SelectField
          label="序号列"
          value={serialFromColumn}
          options={columnOptions}
          onChange={(column) => batch.setSerial({ column })}
        />
      )}
      {isEnabled && serialFromColumn === null && (
        <>
          <TextInput
            label="前缀"
            value={serial.prefix}
            maxLength={BATCH_LIMITS.serialAffixLength}
            onChange={(prefix) => batch.setSerial({ prefix })}
          />
          <NumberField
            label="起始"
            value={serial.start}
            min={0}
            max={BATCH_LIMITS.serialStart}
            step={1}
            unit=""
            onChange={(start) => batch.setSerial({ start })}
          />
          <NumberField
            label="步长"
            value={serial.step}
            min={1}
            max={BATCH_LIMITS.serialStep}
            step={1}
            unit=""
            onChange={(step) => batch.setSerial({ step })}
          />
          <NumberField
            label="位数"
            value={serial.digits}
            min={0}
            max={BATCH_LIMITS.serialDigits}
            step={1}
            unit="位"
            onChange={(digits) => batch.setSerial({ digits })}
          />
          <TextInput
            label="后缀"
            value={serial.suffix}
            maxLength={BATCH_LIMITS.serialAffixLength}
            onChange={(suffix) => batch.setSerial({ suffix })}
          />
          <p className="config-card__text">例：{serialExample(serial)}（位数为 0 时不补零）</p>
        </>
      )}
      <Segmented
        label="份数"
        value={copies.kind}
        options={hasTable ? COPIES_OPTIONS : COPIES_OPTIONS.slice(0, 1)}
        onChange={(kind) =>
          batch.setCopies(kind === 'column' && columns[0] !== undefined ? { kind, column: columns[0] } : DEFAULT_COPIES)
        }
      />
      {copies.kind === 'fixed' ? (
        <NumberField
          label="每行几份"
          value={copies.count}
          min={1}
          max={BATCH_LIMITS.copiesPerRow}
          step={1}
          unit="份"
          onChange={(count) => batch.setCopies({ kind: 'fixed', count })}
        />
      ) : (
        <SelectField
          label="份数列"
          value={copies.column}
          options={columnOptions}
          onChange={(column) => batch.setCopies({ kind: 'column', column })}
        />
      )}
    </section>
  );
}
