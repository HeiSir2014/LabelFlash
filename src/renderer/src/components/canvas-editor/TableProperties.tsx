import { useState } from 'react';
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasTable,
  type CanvasTableCell,
  DEFAULT_TABLE_CELL,
} from '../../../../core/templates/canvas-model';
import {
  addTableColumn,
  addTableRow,
  columnsExtentMm,
  lastColumnMm,
  lastRowMm,
  removeTableColumn,
  removeTableRow,
  rowsExtentMm,
  setColumnMm,
  setRowMm,
  updateTableCell,
} from '../../lib/canvas-table';
import { NumberField, Segmented, SelectField, TextInput, Toggle } from '../form-controls';
import { InsertField } from './InsertField';
import { ALIGN_OPTIONS, BORDER_STEP_MM, FONT_STEP_MM, POSITION_STEP_MM } from './options';

interface TablePropertiesProps {
  element: CanvasTable;
  fieldNames: readonly string[];
  /** field 非空时（连续输入）撤销历史和上一步合并；按钮、开关、分段选择一次点一下就改完，传 null。 */
  onChange: (next: CanvasElement, field: string | null) => void;
  /** 属性栏的文字 / 数字框失焦时调用：结束撤销历史的合并，不然焦点挪回来接着改会并进上一步。 */
  onEndMerge: () => void;
}

const SIZE_TEXT = {
  row: { unit: '行', size: '高', rest: '高度' },
  column: { unit: '列', size: '宽', rest: '宽度' },
} as const;

/** 行高或列宽：除了最后一个都能改，最后一个占剩下的（写出它现在多大）。 */
function SizeList({
  kind,
  sizes,
  lastMm,
  max,
  onChange,
  onEndMerge,
}: {
  kind: 'row' | 'column';
  sizes: readonly number[];
  lastMm: number;
  max: number;
  onChange: (index: number, mm: number) => void;
  onEndMerge: () => void;
}) {
  const text = SIZE_TEXT[kind];
  return (
    <>
      {sizes.slice(0, -1).map((size, index) => (
        <NumberField
          // biome-ignore lint/suspicious/noArrayIndexKey: 行高、列宽按位置编辑，位置就是身份
          key={index}
          label={`第 ${index + 1} ${text.unit}${text.size}`}
          value={size}
          min={CANVAS_LIMITS.minSizeMm}
          max={max}
          step={POSITION_STEP_MM}
          onChange={(mm) => onChange(index, mm)}
          onBlur={onEndMerge}
        />
      ))}
      <p className="form-hint">{`最后一${text.unit}：${lastMm.toFixed(1)}mm，占剩下的${text.rest}`}</p>
    </>
  );
}

/** 表格：边框、行高和列宽、加减行列，再选一格改文字。 */
export function TableProperties({ element, fieldNames, onChange, onEndMerge }: TablePropertiesProps) {
  const [picked, setPicked] = useState({ row: 0, column: 0 });
  const row = Math.min(picked.row, element.rowsMm.length - 1);
  const column = Math.min(picked.column, element.columnsMm.length - 1);
  const cell = element.cells[row]?.[column] ?? DEFAULT_TABLE_CELL;
  // field 为 null（加粗、对齐这类一次点一下就改完的）不生成合并键；连续输入（文字、字号）才按格子 + 字段合并。
  const setCell = (patch: Partial<CanvasTableCell>, field: string | null) =>
    onChange(updateTableCell(element, row, column, patch), field === null ? null : `cell:${row}:${column}:${field}`);
  const { fontSizeMm } = CANVAS_LIMITS;

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
      <h3 className="designer-subtitle">行</h3>
      <SizeList
        kind="row"
        sizes={element.rowsMm}
        lastMm={lastRowMm(element)}
        max={rowsExtentMm(element)}
        onChange={(index, mm) => onChange(setRowMm(element, index, mm), `row:${index}`)}
        onEndMerge={onEndMerge}
      />
      <div className="designer-actions-row">
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.rowsMm.length >= CANVAS_LIMITS.tableRows}
          onClick={() => onChange(addTableRow(element), null)}
        >
          加一行
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.rowsMm.length <= 1}
          onClick={() => onChange(removeTableRow(element), null)}
        >
          删最后一行
        </button>
      </div>
      <h3 className="designer-subtitle">列</h3>
      <SizeList
        kind="column"
        sizes={element.columnsMm}
        lastMm={lastColumnMm(element)}
        max={columnsExtentMm(element)}
        onChange={(index, mm) => onChange(setColumnMm(element, index, mm), `column:${index}`)}
        onEndMerge={onEndMerge}
      />
      <div className="designer-actions-row">
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.columnsMm.length >= CANVAS_LIMITS.tableColumns}
          onClick={() => onChange(addTableColumn(element), null)}
        >
          加一列
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.columnsMm.length <= 1}
          onClick={() => onChange(removeTableColumn(element), null)}
        >
          删最后一列
        </button>
      </div>
      <h3 className="designer-subtitle">格子</h3>
      <SelectField
        label="行"
        value={String(row)}
        options={element.rowsMm.map((_, index) => ({ value: String(index), label: `第 ${index + 1} 行` }))}
        onChange={(value) => setPicked({ row: Number(value), column })}
      />
      <SelectField
        label="列"
        value={String(column)}
        options={element.columnsMm.map((_, index) => ({ value: String(index), label: `第 ${index + 1} 列` }))}
        onChange={(value) => setPicked({ row, column: Number(value) })}
      />
      <TextInput
        label="文字"
        value={cell.text}
        maxLength={CANVAS_LIMITS.textLength}
        onChange={(text) => setCell({ text }, 'text')}
        onBlur={onEndMerge}
      />
      <InsertField
        fieldNames={fieldNames}
        onInsert={(variable) => setCell({ text: `${cell.text}${variable}`.slice(0, CANVAS_LIMITS.textLength) }, 'text')}
      />
      <NumberField
        label="字号"
        value={cell.fontSizeMm}
        min={fontSizeMm.min}
        max={fontSizeMm.max}
        step={FONT_STEP_MM}
        onChange={(value) => setCell({ fontSizeMm: value }, 'fontSizeMm')}
        onBlur={onEndMerge}
      />
      <Toggle label="加粗" checked={cell.bold} onChange={(bold) => setCell({ bold }, null)} />
      <Segmented
        label="对齐"
        value={cell.align}
        options={ALIGN_OPTIONS}
        onChange={(align) => setCell({ align }, null)}
      />
    </>
  );
}
