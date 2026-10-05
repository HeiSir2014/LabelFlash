import { TEMPLATE_ID_PATTERN } from '../templates/template-model';
import {
  BATCH_LIMITS,
  type BatchData,
  type BatchPlan,
  type CopiesSettings,
  type FieldSource,
  type SerialSettings,
  TABLE_ID_PATTERN,
  VARIABLE_NAME_MAX_LENGTH,
} from './batch-model';

type Loose = Record<string, unknown>;

/**
 * 渲染进程交来的批量打印设置：逐项核对类型和范围，有一项不对就整个不收（返回 null，由 IPC 报错）。
 * 渲染进程不可信（Chromium 的 IPC 信任边界）：这里不纠正、不兜底，界面自己负责交合法的设置。
 */
export function parseBatchPlan(value: unknown): BatchPlan | null {
  const plan = asObject(value);
  if (plan === null) {
    return null;
  }
  const templateId = plan['templateId'];
  const data = parseData(plan['data']);
  const mapping = parseMapping(plan['mapping']);
  const serial = parseSerial(plan['serial']);
  const copies = parseCopies(plan['copies']);
  const rows = parseRows(plan['rows']);
  if (
    typeof templateId !== 'string' ||
    !TEMPLATE_ID_PATTERN.test(templateId) ||
    data === null ||
    mapping === null ||
    serial === null ||
    copies === null ||
    rows === undefined
  ) {
    return null;
  }
  // 只按序号打没有表格：份数、序号取列都没有列可取。这类设置本身就是错的，解析时直接拒绝，
  // 不要留到逐行展开时对着一张不存在的表格给每一行都报同一个问题。
  if (data.kind === 'serial-only' && (copies.kind === 'column' || serial.column !== null)) {
    return null;
  }
  return { templateId, data, mapping, serial, copies, rows };
}

function asObject(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null;
}

function isText(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isColumnName(value: unknown): value is string {
  return isText(value, 1, BATCH_LIMITS.columnNameLength);
}

function parseData(value: unknown): BatchData | null {
  const data = asObject(value);
  if (data === null) {
    return null;
  }
  const kind = data['kind'];
  const tableId = data['tableId'];
  const count = data['count'];
  if (kind === 'table' && typeof tableId === 'string' && TABLE_ID_PATTERN.test(tableId)) {
    return { kind: 'table', tableId };
  }
  if (kind === 'serial-only' && isInteger(count, 1, BATCH_LIMITS.serialOnlyCount)) {
    return { kind: 'serial-only', count };
  }
  return null;
}

function parseMapping(value: unknown): Record<string, FieldSource> | null {
  const mapping = asObject(value);
  if (mapping === null) {
    return null;
  }
  // 先只数键名、不取值：渲染进程不可信，键名数量超限时不该为了数数而把每个键的值都读一遍
  // （攻击者可以在每个键上放一个很大的值，让 Object.entries 白白多做一遍没用的工作）。
  const keys = Object.keys(mapping);
  if (keys.length > BATCH_LIMITS.variables) {
    return null;
  }
  const parsed: [string, FieldSource][] = [];
  for (const name of keys) {
    const field = parseSource(mapping[name]);
    if (!isText(name, 1, VARIABLE_NAME_MAX_LENGTH) || field === null) {
      return null;
    }
    parsed.push([name, field]);
  }
  // fromEntries 按「定义自己的属性」写入：名为 __proto__ 的变量也只是一个普通的键。
  return Object.fromEntries(parsed);
}

function parseSource(value: unknown): FieldSource | null {
  const source = asObject(value);
  if (source === null) {
    return null;
  }
  const kind = source['kind'];
  const column = source['column'];
  const fixed = source['value'];
  if (kind === 'none') {
    return { kind: 'none' };
  }
  if (kind === 'column' && isColumnName(column)) {
    return { kind: 'column', column };
  }
  if (kind === 'fixed' && isText(fixed, 0, BATCH_LIMITS.fixedValueLength)) {
    return { kind: 'fixed', value: fixed };
  }
  return null;
}

function parseSerial(value: unknown): SerialSettings | null {
  const serial = asObject(value);
  if (serial === null) {
    return null;
  }
  const { enabled, prefix, start, step, digits, suffix, column } = serial;
  if (
    typeof enabled !== 'boolean' ||
    !isText(prefix, 0, BATCH_LIMITS.serialAffixLength) ||
    !isText(suffix, 0, BATCH_LIMITS.serialAffixLength) ||
    !isInteger(start, 0, BATCH_LIMITS.serialStart) ||
    !isInteger(step, 1, BATCH_LIMITS.serialStep) ||
    !isInteger(digits, 0, BATCH_LIMITS.serialDigits)
  ) {
    return null;
  }
  if (column !== null && !isColumnName(column)) {
    return null;
  }
  return { enabled, prefix, start, step, digits, suffix, column };
}

function parseCopies(value: unknown): CopiesSettings | null {
  const copies = asObject(value);
  if (copies === null) {
    return null;
  }
  const kind = copies['kind'];
  const count = copies['count'];
  const column = copies['column'];
  if (kind === 'fixed' && isInteger(count, 1, BATCH_LIMITS.copiesPerRow)) {
    return { kind: 'fixed', count };
  }
  if (kind === 'column' && isColumnName(column)) {
    return { kind: 'column', column };
  }
  return null;
}

/** null = 全部行；数组 = 勾选的行（至少一行，空数组没有意义，当不合法处理）；undefined = 不合法。 */
function parseRows(value: unknown): number[] | null | undefined {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > BATCH_LIMITS.rows) {
    return undefined;
  }
  const rows: number[] = [];
  for (const row of value) {
    if (!isInteger(row, 0, BATCH_LIMITS.rows - 1)) {
      return undefined;
    }
    rows.push(row);
  }
  return rows;
}
