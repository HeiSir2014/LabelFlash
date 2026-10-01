import { contentOf } from '../api/api-model';
import type { TemplateFields } from '../api/template-fields';
import type { ScanField } from '../scan/scan-result';
import {
  BATCH_LIMITS,
  type BatchLabel,
  type BatchPlan,
  type BatchTable,
  type RowProblem,
  SERIAL_FIELD,
  sourceOf,
} from './batch-model';
import { mappableVariables } from './column-mapping';
import { serialText } from './serial';

export interface LabelPlanInput {
  /** 只按序号打时为 null。 */
  table: BatchTable | null;
  plan: BatchPlan;
  /** 模板用到的字段（templateFields）：决定要对哪些变量、是不是每一列都印。 */
  fields: TemplateFields;
}

export type LabelPlan =
  | { ok: true; labels: BatchLabel[]; problems: RowProblem[]; rowCount: number }
  | { ok: false; issue: string };

/** 一共几行：表格的数据行数，或只按序号打的张数。 */
export function rowCountOf(input: LabelPlanInput): number {
  return input.plan.data.kind === 'serial-only' ? input.plan.data.count : (input.table?.rows.length ?? 0);
}

/** 要打的行（0 起，按表格顺序、不重复、在范围内）。 */
export function selectedRows(plan: BatchPlan, rowCount: number): number[] {
  if (plan.rows === null) {
    return Array.from({ length: rowCount }, (_, index) => index);
  }
  return [...new Set(plan.rows)].filter((index) => index >= 0 && index < rowCount).sort((a, b) => a - b);
}

/**
 * 按设置把要打的行展开成一张张标签（每行按份数重复），同时列出有问题的行。
 * 序号按要打的行的顺序数（第一行要打的是起始值），同一行的几份序号相同。
 */
export function planLabels(input: LabelPlanInput): LabelPlan {
  const labels: BatchLabel[] = [];
  const problems: RowProblem[] = [];
  const rowCount = rowCountOf(input);
  for (const [position, index] of selectedRows(input.plan, rowCount).entries()) {
    const row = buildRow(input, index, position);
    if (row.problems.length > 0) {
      problems.push({ row: index + 1, texts: row.problems });
    }
    for (let copy = 1; copy <= row.copies; copy += 1) {
      if (labels.length >= BATCH_LIMITS.labels) {
        return { ok: false, issue: `一批最多 ${BATCH_LIMITS.labels} 张：请减少份数或分几批打` };
      }
      labels.push({ row: index + 1, copy, fields: row.fields, content: row.content });
    }
  }
  return { ok: true, labels, problems, rowCount };
}

/** 某一行（勾没勾都行）打出来的第一份：预览用。序号按它前面要打的行数算，和真正打的时候一样。 */
export function labelForRow(input: LabelPlanInput, index: number): BatchLabel | null {
  const rowCount = rowCountOf(input);
  if (!Number.isInteger(index) || index < 0 || index >= rowCount) {
    return null;
  }
  const position = selectedRows(input.plan, rowCount).filter((selected) => selected < index).length;
  const row = buildRow(input, index, position);
  return { row: index + 1, copy: 1, fields: row.fields, content: row.content };
}

interface BuiltRow {
  fields: ScanField[];
  content: string;
  copies: number;
  problems: string[];
}

function buildRow({ table, plan, fields: templateFields }: LabelPlanInput, index: number, position: number): BuiltRow {
  const columns = table?.columns ?? [];
  const cells = table?.rows[index] ?? [];
  /** 这一行某一列的值；这张表里没有这一列时为 null。 */
  const cell = (column: string): string | null => {
    const at = columns.indexOf(column);
    return at < 0 ? null : (cells[at] ?? '');
  };
  const fields: ScanField[] = [];
  const put = (name: string, value: string) => {
    const existing = fields.find((field) => field.name === name);
    if (existing) {
      existing.value = value;
    } else {
      fields.push({ name, value });
    }
  };
  // 「显示全部字段」的模板：每一列都是一个字段（列名就是字段名），和扫码识别出的字段一样逐行印出；空格子不印。
  if (templateFields.mode === 'ALL') {
    for (const [at, column] of columns.entries()) {
      const value = cells[at] ?? '';
      if (value.trim() !== '') {
        put(column, value);
      }
    }
  }
  const problems: string[] = [];
  const missing: string[] = [];
  for (const variable of mappableVariables(templateFields)) {
    const source = sourceOf(plan.mapping, variable);
    if (source.kind === 'fixed' && source.value !== '') {
      put(variable, source.value);
    }
    if (source.kind !== 'column') {
      continue;
    }
    const value = cell(source.column);
    // 对的列不在这张表里：对列那里已经标红，不逐行重复说。
    if (value === null) {
      continue;
    }
    if (value.trim() === '') {
      missing.push(variable);
    } else {
      put(variable, value);
    }
  }
  if (missing.length > 0) {
    problems.push(`缺：${missing.join('、')}`);
  }
  if (plan.serial.enabled) {
    const serial = plan.serial.column === null ? serialText(plan.serial, position) : (cell(plan.serial.column) ?? '');
    if (serial.trim() === '') {
      problems.push('序号为空');
    } else {
      put(SERIAL_FIELD, serial);
    }
  }
  const copies = copiesOf(plan, cell, problems);
  return { fields, content: contentOf({ fields, content: null }), copies, problems };
}

function copiesOf(plan: BatchPlan, cell: (column: string) => string | null, problems: string[]): number {
  if (plan.copies.kind === 'fixed') {
    return plan.copies.count;
  }
  const text = (cell(plan.copies.column) ?? '').trim();
  // 份数列空着按 1 份：表格里常常只给要多打的行填份数。
  if (text === '') {
    return 1;
  }
  const count = Number(text);
  if (!Number.isInteger(count) || count < 0 || count > BATCH_LIMITS.copiesPerRow) {
    problems.push(`份数「${text.slice(0, 10)}」不对：应为 0–${BATCH_LIMITS.copiesPerRow} 的整数，这一行不打`);
    return 0;
  }
  if (count === 0) {
    problems.push('份数为 0，这一行不打');
  }
  return count;
}
