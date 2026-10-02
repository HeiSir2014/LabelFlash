import type { TemplateFields } from '../../../core/api/template-fields';
import {
  type BatchPlan,
  type BatchTable,
  type CopiesSettings,
  DEFAULT_COPIES,
  type FieldSource,
  NO_SOURCE,
  type RowProblem,
  type SerialSettings,
} from '../../../core/batch/batch-model';
import type { BatchFailure, BatchPauseReason } from '../../../core/batch/batch-runner';
import { usesSerial } from '../../../core/batch/column-mapping';
import { serialText } from '../../../core/batch/serial';
import type { BatchStatus } from '../../../shared/batch';

/** 数据表一行的高度：和 tokens.css 的 --batch-row-height 一致，虚拟滚动按它算哪些行在视野里。 */
export const BATCH_ROW_HEIGHT_PX = 28;
/** 视野上下多画几行：滚得快时不露白。 */
const OVERSCAN_ROWS = 10;
const COLUMN_KEY_PREFIX = 'column:';
/** 序号示例显示前几张。 */
const SERIAL_EXAMPLE_COUNT = 3;
const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

export type DataKind = 'table' | 'serial-only';

/** 界面里的设置（还没整理成交给主进程的 BatchPlan）。 */
export interface PlanInput {
  templateId: string;
  fields: TemplateFields;
  dataKind: DataKind;
  table: BatchTable | null;
  serialOnlyCount: number;
  mapping: Readonly<Record<string, FieldSource>>;
  serial: SerialSettings;
  /** 「显示全部字段」的模板：操作员要不要把序号也印出来。 */
  wantsSerial: boolean;
  copies: CopiesSettings;
  /** null = 全部行。 */
  selected: ReadonlySet<number> | null;
}

/** 序号印不印：模板用了 {序号} 就印；「显示全部字段」的模板由操作员决定，只按序号打时必须印（不然标签是空的）。 */
export function isSerialEnabled(fields: TemplateFields, wantsSerial: boolean, hasTable: boolean): boolean {
  if (usesSerial(fields)) {
    return true;
  }
  return fields.mode === 'ALL' && (wantsSerial || !hasTable);
}

/**
 * 界面的设置 → 交给主进程的 BatchPlan。对的列不在当前表里的（换了表格、只按序号打）一律去掉：
 * 主进程按 parseBatchPlan 严格核对，不能把无效的列名交过去。还没导入表格时为 null（不能打、不预览）。
 */
export function buildPlan(input: PlanInput): BatchPlan | null {
  const table = input.dataKind === 'table' ? input.table : null;
  if (input.dataKind === 'table' && table === null) {
    return null;
  }
  const columns = table?.columns ?? [];
  const hasColumn = (column: string) => columns.includes(column);
  const mapping = Object.fromEntries(
    Object.entries(input.mapping).map(([variable, source]): [string, FieldSource] => [
      variable,
      source.kind === 'column' && !hasColumn(source.column) ? NO_SOURCE : source,
    ]),
  );
  const serialColumn = input.serial.column !== null && hasColumn(input.serial.column) ? input.serial.column : null;
  return {
    templateId: input.templateId,
    data: table === null ? { kind: 'serial-only', count: input.serialOnlyCount } : { kind: 'table', tableId: table.id },
    mapping,
    serial: {
      ...input.serial,
      column: serialColumn,
      enabled: isSerialEnabled(input.fields, input.wantsSerial, table !== null),
    },
    copies: input.copies.kind === 'column' && !hasColumn(input.copies.column) ? DEFAULT_COPIES : input.copies,
    rows: table === null || input.selected === null ? null : [...input.selected].sort((a, b) => a - b),
  };
}

/** 搜索：任意一格包含关键字（不区分大小写）的行，返回 0 起的下标；没有表格时（只按序号打）全部。 */
export function filterRows(table: BatchTable | null, rowCount: number, search: string): number[] {
  const all = Array.from({ length: rowCount }, (_, index) => index);
  const needle = search.trim().toLowerCase();
  if (needle === '' || table === null) {
    return all;
  }
  return all.filter((index) => (table.rows[index] ?? []).some((cell) => cell.toLowerCase().includes(needle)));
}

/** 虚拟滚动：只画视野里的行（加上下各几行），一万行的表也不卡。 */
export function visibleRange(scrollTop: number, viewportHeight: number, total: number): { start: number; end: number } {
  const first = Math.floor(scrollTop / BATCH_ROW_HEIGHT_PX);
  const count = Math.ceil(viewportHeight / BATCH_ROW_HEIGHT_PX);
  return { start: Math.max(0, first - OVERSCAN_ROWS), end: Math.min(total, first + count + OVERSCAN_ROWS) };
}

/** 把一组行勾上或取消；全部勾上时回到 null（之后表格行数变了也还是全选）。 */
export function withRowsChecked(
  selected: ReadonlySet<number> | null,
  indexes: readonly number[],
  checked: boolean,
  rowCount: number,
): ReadonlySet<number> | null {
  const next = new Set(selected ?? Array.from({ length: rowCount }, (_, index) => index));
  for (const index of indexes) {
    if (checked) {
      next.add(index);
    } else {
      next.delete(index);
    }
  }
  return next.size === rowCount ? null : next;
}

export function toggledSelection(
  selected: ReadonlySet<number> | null,
  index: number,
  rowCount: number,
): ReadonlySet<number> | null {
  const isChecked = selected === null || selected.has(index);
  return withRowsChecked(selected, [index], !isChecked, rowCount);
}

/** 上一张 / 下一张：在搜索结果里走；当前行不在结果里时跳到结果的第一行。 */
export function stepRowIndex(rows: readonly number[], current: number, delta: number): number {
  const position = rows.indexOf(current);
  if (position < 0) {
    return rows[0] ?? current;
  }
  const next = Math.min(rows.length - 1, Math.max(0, position + delta));
  return rows[next] ?? current;
}

/** 同一行的问题合在一起（数据的问题在前，排版的问题在后）；键是从 1 数的行号。 */
export function problemsByRow(...lists: ReadonlyArray<readonly RowProblem[]>): Map<number, string[]> {
  const merged = new Map<number, string[]>();
  for (const list of lists) {
    for (const problem of list) {
      merged.set(problem.row, [...(merged.get(problem.row) ?? []), ...problem.texts]);
    }
  }
  return merged;
}

/** 这一批每行的失败（状态里带着的那些）；键是从 1 数的行号。 */
export function failuresByRow(status: BatchStatus | null): Map<number, BatchFailure[]> {
  const byRow = new Map<number, BatchFailure[]>();
  for (const failure of status?.failures ?? []) {
    byRow.set(failure.row, [...(byRow.get(failure.row) ?? []), failure]);
  }
  return byRow;
}

export function describeTable(table: BatchTable | null): string {
  return table === null ? '还没有导入数据' : `${table.name} · ${table.rows.length} 行 · ${table.columns.length} 列`;
}

export interface SummaryInput {
  rowCount: number;
  selectedCount: number;
  labelCount: number;
  problemRows: number;
}

export function describeSummary({ rowCount, selectedCount, labelCount, problemRows }: SummaryInput): string {
  return [
    `共 ${rowCount} 行`,
    selectedCount < rowCount ? `选中 ${selectedCount} 行` : null,
    `打 ${labelCount} 张`,
    problemRows > 0 ? `${problemRows} 行有问题（标黄）` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

export interface ProgressView {
  text: string;
  /** 0–100。 */
  percent: number;
}

const PERCENT = 100;

/** 底部操作条的进度文字：用「已发送」（驱动收下了），不说「打印成功」。 */
export function describeProgress(status: BatchStatus): ProgressView {
  const done = status.sent + status.failed;
  const percent = status.total === 0 ? 0 : Math.round((done / status.total) * PERCENT);
  const counts = `已发送 ${status.sent} / ${status.total} 张${status.failed > 0 ? ` · 失败 ${status.failed} 张` : ''}`;
  switch (status.state) {
    case 'running':
      return { text: `正在打印 · ${counts}`, percent };
    case 'paused':
      return { text: `已暂停（${describePauseReason(status.pauseReason)}）· ${counts}`, percent };
    case 'canceled':
      return { text: `已取消 · ${counts}`, percent };
    case 'done':
      return { text: `${status.failed > 0 ? '已结束' : '全部已发送'} · ${counts}`, percent };
  }
}

export function describePauseReason(reason: BatchPauseReason | null): string {
  switch (reason) {
    case 'no-printer':
      return '这种纸还没有打印机：到「打印机」页分配后点继续';
    case 'PRINTER_NOT_READY':
      return '打印机现在不能打印：缺纸、离线或卡纸，处理好后点继续';
    case 'PRINTER_NOT_FOUND':
      return '找不到打印机：检查连接后点继续';
    // 打印机状态在 macOS 上一直是「未知」，拔纸、卡纸不会被认成上面那几种：连续失败几张就自动暂停，
    // 和「这种纸没有打印机」分开提示，操作员知道要去检查打印机本身，而不是去配置页分配打印机。
    case 'consecutive-failures':
      return '连续几张都没打印成功：检查打印机后点继续';
    // 触发暂停的那一张是超时：驱动没回话不代表没打印，和前一种分开措辞，提醒操作员自己确认有没有出纸，
    // 而不是直接当成「没打」去重打（重打有重复出纸的风险）。
    case 'consecutive-failures-after-timeout':
      return '最后一张可能已经打出来了：看一眼打印机，确认后点继续';
    case 'operator':
    case null:
      return '点继续接着打';
  }
}

/** 标题栏「批量打印」按钮上的进度：正在打或暂停时显示「36/120」，其余不显示。 */
export function batchButtonProgress(status: BatchStatus | null): string | null {
  if (status === null || (status.state !== 'running' && status.state !== 'paused')) {
    return null;
  }
  return `${status.sent + status.failed}/${status.total}`;
}

export function serialExample(settings: SerialSettings): string {
  return Array.from({ length: SERIAL_EXAMPLE_COUNT }, (_, position) => serialText(settings, position)).join('、');
}

/**
 * 一批的张数比打印记录保留的条数（设置页「打印记录保留」）还多时的提醒：超出的那部分会被自动顶掉，
 * 不在这次会话里（关掉程序、换了别的批次之后）就找不回来了，整批重打失败的会漏掉这些行。
 * labelCount 不超过 historyLimit 时不提醒（正常情况：默认 10 万条留得下任何一批）。
 */
export function historyLimitWarning(labelCount: number, historyLimit: number): string | null {
  if (labelCount <= historyLimit) {
    return null;
  }
  return `这一批 ${NUMBER_FORMAT.format(labelCount)} 张比打印记录保留的 ${NUMBER_FORMAT.format(historyLimit)} 条多：多出的部分会被自动顶掉，重启后整批重打失败的可能会漏掉这些行`;
}

/** 对列下拉框的选项值。 */
export function sourceKey(source: FieldSource): string {
  switch (source.kind) {
    case 'none':
      return 'none';
    case 'fixed':
      return 'fixed';
    case 'column':
      return `${COLUMN_KEY_PREFIX}${source.column}`;
  }
}

/** 下拉框选了某项 → 取值方式；切到「固定值」时保留原来填的值。 */
export function sourceFromKey(key: string, previous: FieldSource): FieldSource {
  if (key.startsWith(COLUMN_KEY_PREFIX)) {
    return { kind: 'column', column: key.slice(COLUMN_KEY_PREFIX.length) };
  }
  if (key === 'fixed') {
    return previous.kind === 'fixed' ? previous : { kind: 'fixed', value: '' };
  }
  return NO_SOURCE;
}
