import { BATCH_LIMITS } from '../../core/batch/batch-model';
import { splitCsvRecords, totalCharsIssue } from '../../core/lookup/csv';
import { decodeCsvBytes } from '../../core/lookup/decode-text';

/**
 * 读表格：认文件类型（主进程）、把字节读成一行行文字（子进程，见 reader-worker.ts）。
 * 不 import electron：读取逻辑用 bun test 直接测，子进程入口只是把它接到 parentPort 上。
 */

export type TableFileKind = 'xlsx' | 'csv';

/** 交给子进程的：文件类型和全部字节（不给路径：子进程只读这一份内容）。 */
export interface TableReadRequest {
  kind: TableFileKind;
  bytes: Uint8Array;
}

/** 子进程的回复：每行是文字的数组（还没认表头）；读不了时给中文原因，detail 是库的原始错误（写日志，不给用户看）。 */
export type TableReadReply = { ok: true; records: string[][] } | { ok: false; issue: string; detail?: string };

/** 读 .xlsx 第一个工作表的函数（read-excel-file 的 readSheet；测试里也用真的）。 */
export type SheetReader = (bytes: Buffer) => Promise<readonly (readonly unknown[])[]>;

export const XLS_ISSUE = '不支持 .xls（Excel 97-2003）格式：请在 Excel 里「另存为」.xlsx 或 CSV 后再导入';
const BROKEN_XLSX_ISSUE = '这个 .xlsx 文件已损坏，或不是 Excel 保存的：请在 Excel 里「另存为」.xlsx 或 CSV 再试';
const UNREADABLE_ISSUE = '读不出这个文件：可能已损坏或有密码保护。可以在 Excel 里「另存为」.xlsx 或 CSV 再试';
const UNSUPPORTED_ISSUE = '只能导入 .xlsx 或 .csv 文件';
/** 97-2003 复合文档（.xls）的文件头。 */
const OLE_MAGIC: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0];
/** ZIP（.xlsx）的文件头。 */
const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/** 按扩展名和文件头认类型：.xls（含改了扩展名的）直接拒绝，说明怎么另存。 */
export function tableFileKind(
  name: string,
  bytes: Uint8Array,
): { ok: true; kind: TableFileKind } | { ok: false; issue: string } {
  const extension = extensionOf(name);
  if (extension === '.xls' || startsWith(bytes, OLE_MAGIC)) {
    return { ok: false, issue: XLS_ISSUE };
  }
  if (extension === '.xlsx') {
    return startsWith(bytes, ZIP_MAGIC) ? { ok: true, kind: 'xlsx' } : { ok: false, issue: BROKEN_XLSX_ISSUE };
  }
  if (extension === '.csv') {
    return { ok: true, kind: 'csv' };
  }
  return { ok: false, issue: UNSUPPORTED_ISSUE };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Excel 的值 → 表格里看到的文字。日期按 UTC 取：read-excel-file 把日期格子解成 UTC 零点的 Date。 */
export function cellText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    const hasTime = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0;
    return hasTime ? `${day} ${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}` : day;
  }
  return '';
}

function isRequest(value: unknown): value is TableReadRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (request['kind'] === 'xlsx' || request['kind'] === 'csv') && request['bytes'] instanceof Uint8Array;
}

/** Excel 的行末常有一串空格子（格式刷过的列）：去掉，免得比表头多。 */
function trimTrailingEmpty(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === '') {
    end -= 1;
  }
  return cells.slice(0, end);
}

/**
 * 在子进程里提前按上限截住：一万行以上、一行一百列以上、总字数超限的文件不用整个传回主进程。
 * 表头、重复列名这些规则由主进程的 tableFromRecords 判断（规则只有一份）。
 */
function limitRecords(records: string[][]): TableReadReply {
  const kept = records.filter((record) => record.some((cell) => cell.trim() !== ''));
  if (kept.length > BATCH_LIMITS.rows + 1) {
    return { ok: false, issue: `最多 ${BATCH_LIMITS.rows} 行数据，这个文件有 ${kept.length - 1} 行：请分成几个文件` };
  }
  let chars = 0;
  for (const record of kept) {
    if (record.length > BATCH_LIMITS.columns) {
      return { ok: false, issue: `最多 ${BATCH_LIMITS.columns} 列，这个文件有一行有 ${record.length} 列` };
    }
    for (const cell of record) {
      chars += cell.length;
    }
    if (chars > BATCH_LIMITS.totalChars) {
      return { ok: false, issue: totalCharsIssue(BATCH_LIMITS.totalChars) };
    }
  }
  return { ok: true, records: kept };
}

/** 子进程里读一个文件：xlsx 交给 readSheet（第一个工作表），csv 用自己的解析器（UTF-8 / GBK）。 */
export async function readTableBytes(request: unknown, readSheet: SheetReader): Promise<TableReadReply> {
  if (!isRequest(request)) {
    return { ok: false, issue: UNREADABLE_ISSUE, detail: 'malformed table read request' };
  }
  try {
    if (request.kind === 'csv') {
      const records = splitCsvRecords(decodeCsvBytes(request.bytes), ',');
      return records.ok ? limitRecords(records.rows) : { ok: false, issue: records.issue };
    }
    const sheet = await readSheet(Buffer.from(request.bytes));
    return limitRecords(sheet.map((row) => trimTrailingEmpty(row.map(cellText))));
  } catch (error) {
    return { ok: false, issue: UNREADABLE_ISSUE, detail: error instanceof Error ? error.message : String(error) };
  }
}
