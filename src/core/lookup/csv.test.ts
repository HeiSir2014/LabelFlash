import { describe, expect, test } from 'bun:test';
import { parseCsv } from './csv';
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
