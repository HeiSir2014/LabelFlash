import { describe, expect, test } from 'bun:test';
import { readSheet } from 'read-excel-file/node';
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import { cellText, readTableBytes, tableFileKind, XLS_ISSUE } from './table-file';
import { minimalXlsx } from './testing/minimal-xlsx';

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

  test('explains a file the library cannot read, with the library error as detail', async () => {
    const result = await readTableBytes({ kind: 'xlsx', bytes: encode('PK\u0003\u0004 broken') }, sheetReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('读不出这个文件') });
    expect(result.ok ? '' : (result.detail ?? '')).not.toBe('');
  });

  test('rejects a malformed request', async () => {
    expect(await readTableBytes({ kind: 'pdf' }, sheetReader)).toMatchObject({ ok: false });
  });
});
