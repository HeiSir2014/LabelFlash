import { describe, expect, test } from 'bun:test';
import { readSheet } from 'read-excel-file/node';
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import { cellText, readTableBytes, tableFileKind, XLS_ISSUE } from './table-file';
import { minimalXlsx } from './testing/minimal-xlsx';

/** 一个本地文件头（PK\x03\x04）加紧跟着的数据：read-excel-file 的 unzipper-esm 实际依据的是这个，不是中央目录。 */
function localHeader(options: {
  uncompressedSize: number;
  compressedSize?: number;
  flags?: number;
  data?: Uint8Array;
}): Uint8Array {
  const filename = new TextEncoder().encode('x');
  const compressedSize = options.compressedSize ?? options.uncompressedSize;
  const data = options.data ?? new Uint8Array(compressedSize);
  const buf = new Uint8Array(30 + filename.length + data.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(6, options.flags ?? 0, true);
  view.setUint32(18, compressedSize, true);
  view.setUint32(22, options.uncompressedSize, true);
  view.setUint16(26, filename.length, true);
  buf.set(filename, 30);
  buf.set(data, 30 + filename.length);
  return buf;
}

/** 一段「看起来人畜无害」的中央目录 + 目录结束记录：用来证明解压库不看这里，只看本地文件头。 */
function craftedCentralDirectory(entries: readonly { uncompressedSize: number }[]): Uint8Array {
  const filename = new TextEncoder().encode('x');
  const centralEntries = entries.map((entry) => {
    const buf = new Uint8Array(46 + filename.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, entry.uncompressedSize, true);
    view.setUint16(28, filename.length, true);
    buf.set(filename, 46);
    return buf;
  });
  const centralSize = centralEntries.reduce((sum, entry) => sum + entry.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, 0, true);
  return concatAll([...centralEntries, eocd]);
}

function concatAll(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const OLE_HEADER = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const encode = (text: string) => new TextEncoder().encode(text);
const sheetReader = (bytes: Buffer) => readSheet(bytes);

describe('tableFileKind', () => {
  test('accepts .xlsx (a zip) and .csv', () => {
    expect(tableFileKind('货号.XLSX', minimalXlsx([['a']]))).toEqual({ ok: true, kind: 'xlsx' });
    expect(tableFileKind('rows.csv', encode('a\n1'))).toEqual({ ok: true, kind: 'csv' });
  });

  // .xls 是 97-2003 的复合文档格式，read-excel-file 读不了；改了扩展名的也按文件头认出来。
  test('refuses .xls, also when it was renamed', () => {
    expect(tableFileKind('old.xls', OLE_HEADER)).toEqual({ ok: false, issue: XLS_ISSUE });
    expect(tableFileKind('renamed.xlsx', OLE_HEADER)).toEqual({ ok: false, issue: XLS_ISSUE });
  });

  test('explains a broken .xlsx and an unsupported type', () => {
    expect(tableFileKind('broken.xlsx', encode('not a zip'))).toMatchObject({ ok: false });
    expect(tableFileKind('notes.txt', encode('a'))).toEqual({ ok: false, issue: '只能导入 .xlsx 或 .csv 文件' });
  });
});

describe('cellText', () => {
  test('turns Excel values into the text people see', () => {
    expect(cellText('CL1')).toBe('CL1');
    expect(cellText(6901234567890)).toBe('6901234567890');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(null)).toBe('');
    // read-excel-file 把日期格子解成 UTC 零点：按 UTC 取年月日，西边的时区不会差一天。
    expect(cellText(new Date(Date.UTC(2026, 9, 2)))).toBe('2026-10-02');
    expect(cellText(new Date(Date.UTC(2026, 9, 2, 14, 5)))).toBe('2026-10-02 14:05');
  });

  // 浮点数的二进制误差：0.1 + 0.2 在双精度里实际是 0.30000000000000004。
  test('rounds away binary floating-point noise instead of printing it', () => {
    expect(cellText(0.1 + 0.2)).toBe('0.3');
    expect(cellText(1.1 * 3)).toBe('3.3');
  });

  // Excel 的日期从 1899-12-30 起算：只填了时间没填日期的格子，解出来的日期部分就是这一天。
  test('shows only the time for a time-only cell (the Excel epoch day)', () => {
    expect(cellText(new Date(Date.UTC(1899, 11, 30, 14, 5)))).toBe('14:05');
    expect(cellText(new Date(Date.UTC(1899, 11, 30, 14, 5, 30)))).toBe('14:05:30');
  });
});

describe('readTableBytes', () => {
  test('reads the first sheet of an xlsx file as text, without trailing empty cells', async () => {
    const bytes = minimalXlsx([
      ['编码', '数量', ''],
      ['CL1', '2', ''],
    ]);
    expect(await readTableBytes({ kind: 'xlsx', bytes }, sheetReader)).toEqual({
      ok: true,
      records: [
        ['编码', '数量'],
        ['CL1', '2'],
      ],
    });
  });

  test('reads a GBK csv saved by Chinese Excel', async () => {
    // 「编码,货架\nCL1,A」的 GBK 编码。
    const gbk = new Uint8Array([
      0xb1, 0xe0, 0xc2, 0xeb, 0x2c, 0xbb, 0xf5, 0xbc, 0xdc, 0x0a, 0x43, 0x4c, 0x31, 0x2c, 0x41,
    ]);
    expect(await readTableBytes({ kind: 'csv', bytes: gbk }, sheetReader)).toEqual({
      ok: true,
      records: [
        ['编码', '货架'],
        ['CL1', 'A'],
      ],
    });
  });

  test('stops at the row limit before handing anything back', async () => {
    const text = `编码\n${'x\n'.repeat(BATCH_LIMITS.rows + 1)}`;
    expect(await readTableBytes({ kind: 'csv', bytes: encode(text) }, sheetReader)).toMatchObject({
      ok: false,
      issue: expect.stringContaining(`最多 ${BATCH_LIMITS.rows} 行`),
    });
  });

  // 结构上是一个正常、不大的 ZIP（本地文件头、数据、中央目录都对得上），不会被压缩炸弹的检查拦下；
  // 但里面不是真的 Excel 内容，readSheet 自己会报错——这种「损坏」交给它的错误处理，不是这里的事。
  test('explains a file the library cannot read, with the library error as detail', async () => {
    const data = encode('not real xlsx content');
    const entry = localHeader({ uncompressedSize: data.length, compressedSize: data.length, data });
    const bytes = concatAll([entry, craftedCentralDirectory([{ uncompressedSize: data.length }])]);
    const result = await readTableBytes({ kind: 'xlsx', bytes }, sheetReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('读不出这个文件') });
    expect(result.ok ? '' : (result.detail ?? '')).not.toBe('');
  });

  test('rejects a malformed request', async () => {
    expect(await readTableBytes({ kind: 'pdf' }, sheetReader)).toMatchObject({ ok: false });
  });

  // 压缩炸弹：read-excel-file 的 unzipper-esm 按本地文件头（不是中央目录）流式解压，所以防护要核对
  // 本地文件头里声明的大小，不用真的解压就能拦住——子进程的堆上限管不住 Buffer（分配在 V8 堆外）。
  test('refuses an xlsx whose local header claims an absurd uncompressed size, without inflating it', async () => {
    const entry = localHeader({ uncompressedSize: 500 * 1024 * 1024, compressedSize: 0, data: new Uint8Array(0) });
    const bytes = concatAll([entry, craftedCentralDirectory([{ uncompressedSize: 500 * 1024 * 1024 }])]);
    let readSheetCalled = false;
    const refusingReader = async (buffer: Buffer) => {
      readSheetCalled = true;
      return sheetReader(buffer);
    };
    const result = await readTableBytes({ kind: 'xlsx', bytes }, refusingReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('文件太大') });
    expect(readSheetCalled).toBe(false);
  });

  test('refuses an xlsx with too many local entries', async () => {
    const entries = Array.from({ length: 5_001 }, () => localHeader({ uncompressedSize: 0, data: new Uint8Array(0) }));
    const bytes = concatAll([...entries, craftedCentralDirectory([])]);
    const result = await readTableBytes({ kind: 'xlsx', bytes }, sheetReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('文件太大') });
  });

  // 中央目录只是个摆设：解压库按本地文件头流式处理，中央目录声称的大小再小也挡不住本地头里的「数据描述符」
  // 标记——真实大小写在数据后面，本地头上看到的是占位的 0，没法在不整个重新解析的前提下安全跳过。
  test('refuses a local entry that uses a data descriptor, even if the central directory claims it is tiny', async () => {
    const DATA_DESCRIPTOR_FLAG = 0x0008;
    const entry = localHeader({
      uncompressedSize: 0,
      compressedSize: 0,
      flags: DATA_DESCRIPTOR_FLAG,
      data: new Uint8Array(4),
    });
    const bytes = concatAll([entry, craftedCentralDirectory([{ uncompressedSize: 10 }])]);
    const result = await readTableBytes({ kind: 'xlsx', bytes }, sheetReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('文件太大') });
  });

  test('refuses a zip with no central directory at all', async () => {
    const entry = localHeader({ uncompressedSize: 4, data: new Uint8Array(4) });
    const result = await readTableBytes({ kind: 'xlsx', bytes: entry }, sheetReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('文件太大') });
  });
});
