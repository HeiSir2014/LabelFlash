import { LOOKUP_LIMITS, type LookupTableData } from './lookup-model';

export type CsvResult = { ok: true; table: LookupTableData } | { ok: false; issue: string };

const BOM = '﻿';

/**
 * 解析 CSV（RFC 4180）：逗号分隔；带引号的单元格里可以有逗号、换行和 "" 转义的引号；
 * 行尾 CRLF / LF 都可以；开头的 BOM 去掉；完全空白的行跳过。
 * 第一行是列名：不能为空、不能重复。数据行比列名少的补空，多的报错（多半是分隔符不对）。
 */
export function parseCsv(input: string): CsvResult {
  const records = splitRecords(input.startsWith(BOM) ? input.slice(BOM.length) : input);
  if (!records.ok) {
    return records;
  }
  const [header, ...body] = records.rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (!header) {
    return { ok: false, issue: '文件是空的，第一行应该是列名' };
  }
  const columns = header.map((name) => name.trim());
  const columnIssue = checkColumns(columns);
  if (columnIssue) {
    return { ok: false, issue: columnIssue };
  }
  if (body.length > LOOKUP_LIMITS.rows) {
    return { ok: false, issue: `最多 ${LOOKUP_LIMITS.rows} 行数据，这个文件有 ${body.length} 行` };
  }
  const rows: string[][] = [];
  for (const [index, row] of body.entries()) {
    if (row.length > columns.length) {
      return {
        ok: false,
        issue: `第 ${index + 2} 行有 ${row.length} 列，比列名多（${columns.length} 列）；请检查是不是用逗号分隔的 CSV`,
      };
    }
    if (row.some((cell) => cell.length > LOOKUP_LIMITS.cellLength)) {
      return { ok: false, issue: `第 ${index + 2} 行有单元格超过 ${LOOKUP_LIMITS.cellLength} 个字符` };
    }
    rows.push(columns.map((_, column) => row[column] ?? ''));
  }
  return { ok: true, table: { columns, rows } };
}

function checkColumns(columns: readonly string[]): string | null {
  if (columns.length > LOOKUP_LIMITS.columns) {
    return `最多 ${LOOKUP_LIMITS.columns} 列，这个文件有 ${columns.length} 列`;
  }
  const seen = new Set<string>();
  for (const [index, name] of columns.entries()) {
    if (name === '') {
      return `第 ${index + 1} 列没有列名`;
    }
    if (name.length > LOOKUP_LIMITS.columnNameLength) {
      return `列名「${name.slice(0, 10)}…」超过 ${LOOKUP_LIMITS.columnNameLength} 个字符`;
    }
    if (seen.has(name)) {
      return `列名重复：「${name}」`;
    }
    seen.add(name);
  }
  return null;
}

type Records = { ok: true; rows: string[][] } | { ok: false; issue: string };

/** 逐字符扫描，按引号状态切分单元格和行。 */
function splitRecords(text: string): Records {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let isQuoted = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (isQuoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        isQuoted = false;
      } else {
        cell += char;
      }
      index += 1;
      continue;
    }
    if (char === '"' && cell === '') {
      isQuoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
    } else {
      cell += char;
    }
    index += 1;
  }
  if (isQuoted) {
    return { ok: false, issue: '有引号没有闭合，文件可能不完整' };
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { ok: true, rows };
}
