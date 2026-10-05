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
export const UNREADABLE_ISSUE = '读不出这个文件：可能已损坏或有密码保护。可以在 Excel 里「另存为」.xlsx 或 CSV 再试';
const UNSUPPORTED_ISSUE = '只能导入 .xlsx 或 .csv 文件';
/** 97-2003 复合文档（.xls）的文件头。 */
const OLE_MAGIC: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0];
/** ZIP（.xlsx）的文件头。 */
const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];

/**
 * 压缩炸弹的上限：.xlsx 本质是 ZIP，压缩率能把几百 MB 的内容压成几十 KB。read-excel-file 会把整个文件解压进
 * 内存，分配的 Buffer 不受子进程 --max-old-space-size 的堆上限约束（Buffer 的底层内存在 V8 堆外），
 * 只能在真正解压之前，自己核对 ZIP 里声明的大小先拦一道。
 *
 * 这里只看「本地文件头」（每个条目自己带的头），不看「中央目录」（文件末尾汇总的一份目录）：
 * read-excel-file 的 unzipper-esm 是按本地文件头流式解压的，根本不读中央目录——中央目录可以随便写、
 * 甚至整个不存在，解压库都不在乎。只核对中央目录等于没核对，精心构造的文件能把真实情况全部瞒在
 * 本地文件头里，中央目录声称多小都行。
 */
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** 正常的 .xlsx 解压后远小于这个数：一万行、一百列、每格 1000 字的理论上限也就几亿字节；200MB 留足余量。 */
const MAX_XLSX_UNCOMPRESSED_BYTES = 200 * BYTES_PER_MEGABYTE;
/** 正常的 .xlsx 内部文件不会有几千个（通常几十个）：用它顺带挡住「海量空文件」式的压缩炸弹。 */
const MAX_XLSX_ZIP_ENTRIES = 5_000;
const ZIP_BOMB_ISSUE = `文件太大：解压后的内容超过 ${MAX_XLSX_UNCOMPRESSED_BYTES / BYTES_PER_MEGABYTE}MB，可能不是正常的 Excel 文件。可以在 Excel 里「另存为」CSV 再试`;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
/** 本地文件头的固定部分长度：文件名、扩展字段的长度跟在后面（都是变长的），再往后紧跟着这个条目的数据。 */
const LOCAL_HEADER_FIXED_SIZE = 30;
/**
 * 通用标志位第 3 位（0 起数，即 0x0008）：这一条目的压缩大小、CRC 另外存在数据后面的「数据描述符」里，
 * 本地文件头上的大小字段只是占位的 0。不在不整个重新解析（找下一个已知签名）的前提下，没法安全跳过
 * 这个条目有多大，直接按「可疑」拦下——真正的 Excel 不会用这种边写边算大小的流式写法。
 */
const DATA_DESCRIPTOR_FLAG = 0x0008;
/** ZIP64 格式里，大小字段放不下时用这个哨兵值，实际大小在扩展字段里；这里不解析扩展字段，直接按「太大」处理。 */
const ZIP64_SENTINEL = 0xffffffff;

/**
 * 从头顺序走一遍本地文件头，核对每个条目、累计声明的解压后大小。走到中央目录的签名就算正常结束；
 * 条目数超限、单个或累计声明的大小超限、用了数据描述符、或者结构跟预期的不一样（不是本地文件头，
 * 也不是中央目录，包括没有中央目录、文件在条目中间就断掉），都按「太大或可疑」拦下——
 * 宁可错拦一个真文件，也不要在看不懂结构时放行。
 */
function zipBombIssue(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let uncompressedTotal = 0;
  let entries = 0;
  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === CENTRAL_DIR_SIGNATURE) {
      return null;
    }
    if (signature !== LOCAL_HEADER_SIGNATURE || offset + LOCAL_HEADER_FIXED_SIZE > bytes.length) {
      return ZIP_BOMB_ISSUE;
    }
    entries += 1;
    if (entries > MAX_XLSX_ZIP_ENTRIES) {
      return ZIP_BOMB_ISSUE;
    }
    const flags = view.getUint16(offset + 6, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & DATA_DESCRIPTOR_FLAG) !== 0 && compressedSize === 0 && uncompressedSize === 0) {
      return ZIP_BOMB_ISSUE;
    }
    if (uncompressedSize === ZIP64_SENTINEL || compressedSize === ZIP64_SENTINEL) {
      return ZIP_BOMB_ISSUE;
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_XLSX_UNCOMPRESSED_BYTES) {
      return ZIP_BOMB_ISSUE;
    }
    offset += LOCAL_HEADER_FIXED_SIZE + filenameLength + extraLength + compressedSize;
  }
  // 扫到文件末尾都没遇到中央目录：结构跟正常的 ZIP 不一样，不放行。
  return ZIP_BOMB_ISSUE;
}

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

/**
 * IEEE 754 双精度最多能保真表示约 15–17 位十进制有效数字；取 15 位稳妥地滤掉二进制转换误差
 * （例如 0.1 + 0.2 实际存成 0.30000000000000004），又不会把本来就需要这么多位的数值提前截断。
 */
const NUMBER_SIGNIFICANT_DIGITS = 15;

/** Excel 的日期从 1899-12-30 起算（第 0 天）：只填了时间没填日期的格子，解出来的日期部分就是这一天。 */
const EXCEL_EPOCH_YEAR = 1899;
const EXCEL_EPOCH_MONTH_INDEX = 11;
const EXCEL_EPOCH_DATE = 30;

function isExcelEpochDay(value: Date): boolean {
  return (
    value.getUTCFullYear() === EXCEL_EPOCH_YEAR &&
    value.getUTCMonth() === EXCEL_EPOCH_MONTH_INDEX &&
    value.getUTCDate() === EXCEL_EPOCH_DATE
  );
}

/**
 * Excel 的值 → 表格里看到的文字。日期按 UTC 取：read-excel-file 把日期格子解成 UTC 零点的 Date。
 * 不按单元格的数字格式（Excel 的「数字格式」不在 read-excel-file 的 SheetData 里）：
 * 「000123」会变成「123」，「50%」会变成「0.5」——这是已知的限制，不是这里能修的 bug。
 */
export function cellText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Number(value.toPrecision(NUMBER_SIGNIFICANT_DIGITS))) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const seconds = value.getUTCSeconds();
    const time = `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}${seconds === 0 ? '' : `:${pad2(seconds)}`}`;
    if (isExcelEpochDay(value)) {
      return time;
    }
    const day = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    const hasTime = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || seconds !== 0;
    return hasTime ? `${day} ${time}` : day;
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
    const bomb = zipBombIssue(request.bytes);
    if (bomb !== null) {
      return { ok: false, issue: bomb };
    }
    const sheet = await readSheet(Buffer.from(request.bytes));
    return limitRecords(sheet.map((row) => trimTrailingEmpty(row.map(cellText))));
  } catch (error) {
    return { ok: false, issue: UNREADABLE_ISSUE, detail: error instanceof Error ? error.message : String(error) };
  }
}
