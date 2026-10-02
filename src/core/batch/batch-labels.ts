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
 * 序号按「真正会打印」的行的顺序数：份数解析失败、超过上限或明确填了 0 的行不占一个序号，
 * 这样预览（labelForRow）给出的序号和真正打印时一致。
 */
export function planLabels(input: LabelPlanInput): LabelPlan {
  const labels: BatchLabel[] = [];
  const problems: RowProblem[] = [];
  const rowCount = rowCountOf(input);
  let position = 0;
  for (const index of selectedRows(input.plan, rowCount)) {
    const { copies, problem } = computeCopies(input, index);
    if (copies <= 0) {
      // copies <= 0 时一定带着问题说明（解析失败、超过上限，或明确填了 0）；这一行不进入标签、也不占序号。
      problems.push({ row: index + 1, texts: [problem ?? '份数为 0，这一行不打'] });
      continue;
    }
    const row = buildRow(input, index, position);
    position += 1;
    if (row.problems.length > 0) {
      problems.push({ row: index + 1, texts: row.problems });
    }
    for (let copy = 1; copy <= copies; copy += 1) {
      if (labels.length >= BATCH_LIMITS.labels) {
        return { ok: false, issue: `一批最多 ${BATCH_LIMITS.labels} 张：请减少份数或分几批打` };
      }
      labels.push({ row: index + 1, copy, fields: row.fields, content: row.content });
    }
  }
  return { ok: true, labels, problems, rowCount };
}

/**
 * 某一行（勾没勾都行）打出来的第一份：预览用。序号按它前面「真正会打印」的行数算（份数为 0 的行不占序号），
 * 和 planLabels 用的是同一条规则，预览和实际打印不会对不上。
 */
export function labelForRow(input: LabelPlanInput, index: number): BatchLabel | null {
  const rowCount = rowCountOf(input);
  if (!Number.isInteger(index) || index < 0 || index >= rowCount) {
    return null;
  }
  let position = 0;
  for (const selected of selectedRows(input.plan, rowCount)) {
    if (selected >= index) {
      break;
    }
    if (computeCopies(input, selected).copies > 0) {
      position += 1;
    }
  }
  const row = buildRow(input, index, position);
  return { row: index + 1, copy: 1, fields: row.fields, content: row.content };
}

interface BuiltRow {
  fields: ScanField[];
  content: string;
  problems: string[];
}

/** 列名 → 下标：建一次复用，取代每取一列都线性扫描 columns.indexOf。 */
function columnIndexOf(table: BatchTable | null): ReadonlyMap<string, number> {
  return new Map((table?.columns ?? []).map((name, at) => [name, at]));
}

/** 这一行某一列的值；这张表里没有这一列时为 null。 */
function cellReaderFor(
  table: BatchTable | null,
  index: number,
  columnIndex: ReadonlyMap<string, number>,
): (column: string) => string | null {
  const cells = table?.rows[index] ?? [];
  return (column: string): string | null => {
    const at = columnIndex.get(column);
    return at === undefined ? null : (cells[at] ?? '');
  };
}

function buildRow({ table, plan, fields: templateFields }: LabelPlanInput, index: number, position: number): BuiltRow {
  const columnIndex = columnIndexOf(table);
  const cell = cellReaderFor(table, index, columnIndex);
  // 用 Map 存字段：同一个名字再 put 一次时覆盖值、不改变原来的顺序，和原来「find 到就改值」的行为一致。
  const fieldValues = new Map<string, string>();
  const put = (name: string, value: string) => {
    fieldValues.set(name, value);
  };
  // 「显示全部字段」的模板：每一列都是一个字段（列名就是字段名），和扫码识别出的字段一样逐行印出；
  // 份数、序号取值用的列是控制列，不是标签内容，不能当成字段打出来。
  if (templateFields.mode === 'ALL') {
    const controlColumns = new Set<string>();
    if (plan.copies.kind === 'column') {
      controlColumns.add(plan.copies.column);
    }
    if (plan.serial.column !== null) {
      controlColumns.add(plan.serial.column);
    }
    const columns = table?.columns ?? [];
    const cells = table?.rows[index] ?? [];
    for (const [at, column] of columns.entries()) {
      if (controlColumns.has(column)) {
        continue;
      }
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
  const fields = [...fieldValues].map(([name, value]) => ({ name, value }));
  return { fields, content: contentOf({ fields, content: null }), problems };
}

interface CopiesResult {
  copies: number;
  /** copies 为 0 时一定有值：解析失败、超过上限，或明确填了 0。 */
  problem: string | null;
}

/**
 * 这一行打几份：和字段取值分开算，好让 planLabels／labelForRow 在决定「这一行占不占一个序号」之前
 * 就知道份数，不用等整行的字段都组装完。
 */
function computeCopies(input: LabelPlanInput, index: number): CopiesResult {
  const { table, plan } = input;
  if (plan.copies.kind === 'fixed') {
    // 校验过的计划里 fixed 份数总是 ≥ 1；这里仍防一手直接构造的计划。
    return plan.copies.count > 0 ? { copies: plan.copies.count, problem: null } : zeroCopies();
  }
  const columnIndex = columnIndexOf(table);
  const cell = cellReaderFor(table, index, columnIndex);
  const raw = (cell(plan.copies.column) ?? '').trim();
  // 份数列空着按 1 份：表格里常常只给要多打的行填份数。
  if (raw === '') {
    return { copies: 1, problem: null };
  }
  // 按字符规范化后要求纯数字：Number() 会把 "0x2"、"1e1" 这样的写法当成数字，用户填的不是这个意思；
  // normalize('NFKC') 把全角数字（例如 "２"）换成半角，和中文用户的输入习惯一致。
  const normalized = raw.normalize('NFKC');
  if (!/^\d+$/.test(normalized) || Number(normalized) > BATCH_LIMITS.copiesPerRow) {
    return {
      copies: 0,
      problem: `份数「${raw.slice(0, 10)}」不对：应为 0–${BATCH_LIMITS.copiesPerRow} 的整数，这一行不打`,
    };
  }
  const count = Number(normalized);
  return count === 0 ? zeroCopies() : { copies: count, problem: null };
}

function zeroCopies(): CopiesResult {
  return { copies: 0, problem: '份数为 0，这一行不打' };
}
