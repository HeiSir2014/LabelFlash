import { describe, expect, test } from 'bun:test';
import { parseCsv, splitCsvRecords, type TableLimits, tableFromRecords } from './csv';
import { LOOKUP_LIMITS } from './lookup-model';

function tableOf(text: string) {
  const result = parseCsv(text);
  if (!result.ok) throw new Error(result.issue);
  return result.table;
}

function issueOf(text: string): string {
  const result = parseCsv(text);
  return result.ok ? '' : result.issue;
}

describe('parseCsv', () => {
  test('reads a header and rows with CRLF or LF line ends', () => {
    expect(tableOf('编码,货架\r\nCL1,A-01\nCL2,B-02\n')).toEqual({
      columns: ['编码', '货架'],
      rows: [
        ['CL1', 'A-01'],
        ['CL2', 'B-02'],
      ],
    });
  });

  test('handles quotes, escaped quotes, commas and line breaks inside quoted cells', () => {
    expect(tableOf('编码,备注\n"CL,1","他说""好""\n第二行"').rows).toEqual([['CL,1', '他说"好"\n第二行']]);
  });

  test('drops a leading BOM and blank lines, trims column names and pads short rows', () => {
    expect(tableOf('﻿ 编码 ,货架\n\nCL1\n,,\n')).toEqual({ columns: ['编码', '货架'], rows: [['CL1', '']] });
  });

  test('explains what is wrong with the file', () => {
    expect(issueOf('')).toContain('文件是空的');
    expect(issueOf('编码,\nCL1,x')).toContain('第 2 列没有列名');
    expect(issueOf('编码,编码\n1,2')).toContain('列名重复');
    expect(issueOf('编码,货架\nCL1,A,多余')).toContain('第 2 行有 3 列');
    expect(issueOf('编码\n"CL1')).toContain('引号没有闭合');
    expect(issueOf(Array.from({ length: LOOKUP_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(','))).toContain(
      `最多 ${LOOKUP_LIMITS.columns} 列`,
    );
  });

  test('limits the number of rows', () => {
    const text = `编码\n${'x\n'.repeat(LOOKUP_LIMITS.rows + 1)}`;
    expect(issueOf(text)).toContain(`最多 ${LOOKUP_LIMITS.rows} 行`);
  });
});

describe('parseCsv options', () => {
  test('splits tab-separated text copied from Excel', () => {
    expect(parseCsv('编码\t备注\nCL1\t"有\t制表符"\n', { delimiter: '\t' })).toEqual({
      ok: true,
      table: { columns: ['编码', '备注'], rows: [['CL1', '有\t制表符']] },
    });
  });

  // 从 Excel 复制时多选中了一列：粘贴的文字每行末尾都多一个 Tab 后的空字符串。
  test('drops a trailing blank column from text pasted out of one column too many', () => {
    expect(parseCsv('编码\t颜色\t\nCL1\t红\t\n', { delimiter: '\t' })).toEqual({
      ok: true,
      table: { columns: ['编码', '颜色'], rows: [['CL1', '红']] },
    });
  });

  test('applies the limits it is given', () => {
    const limits: TableLimits = { rows: 1, columns: 2, columnNameLength: 10, cellLength: 5, totalChars: 8 };
    expect(parseCsv('a,b,c\n1,2,3', { limits })).toMatchObject({ ok: false, issue: '最多 2 列，这个文件有 3 列' });
    expect(parseCsv('a\n1\n2', { limits })).toMatchObject({ ok: false, issue: expect.stringContaining('最多 1 行') });
    expect(parseCsv('a,b\n12345,1234', { limits })).toMatchObject({
      ok: false,
      issue: expect.stringContaining('表格内容太多'),
    });
  });
});

describe('tableFromRecords', () => {
  test('uses the first non-blank record as the header and pads short rows', () => {
    expect(tableFromRecords([[''], ['编码', '颜色'], ['CL1']], LOOKUP_LIMITS)).toEqual({
      ok: true,
      table: { columns: ['编码', '颜色'], rows: [['CL1', '']] },
    });
  });

  // Excel 多选中了一列、或列应用过格式但没有内容：表头和每一行在最右边都多出一个空白格子。
  test('drops trailing columns that are blank in the header and every row (xlsx-style records)', () => {
    expect(
      tableFromRecords(
        [
          ['编码', '颜色', ''],
          ['CL1', '红', ''],
        ],
        LOOKUP_LIMITS,
      ),
    ).toEqual({ ok: true, table: { columns: ['编码', '颜色'], rows: [['CL1', '红']] } });
  });

  test('keeps the error for a blank header in the middle', () => {
    expect(
      tableFromRecords(
        [
          ['编码', '', '颜色'],
          ['CL1', 'x', '红'],
        ],
        LOOKUP_LIMITS,
      ),
    ).toEqual({ ok: false, issue: '第 2 列没有列名' });
  });

  // 表头空着但这一列其实有数据：不能当成多余的列悄悄丢掉，照样要求补上列名。
  test('keeps the error for a trailing blank header that has data', () => {
    expect(
      tableFromRecords(
        [
          ['编码', ''],
          ['CL1', '备注文字'],
        ],
        LOOKUP_LIMITS,
      ),
    ).toEqual({ ok: false, issue: '第 2 列没有列名' });
  });
});

describe('splitCsvRecords', () => {
  test('keeps blank records and strips a leading BOM', () => {
    expect(splitCsvRecords('﻿a,b\n\n1,2', ',')).toEqual({ ok: true, rows: [['a', 'b'], [''], ['1', '2']] });
  });
});
