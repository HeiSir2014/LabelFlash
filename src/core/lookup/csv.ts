import { LOOKUP_LIMITS, type LookupTableData } from './lookup-model';

export type CsvResult = { ok: true; table: LookupTableData } | { ok: false; issue: string };

/** 一张表的上限：查找表用 LOOKUP_LIMITS，批量打印用 BATCH_LIMITS。 */
export interface TableLimits {
  rows: number;
  columns: number;
  columnNameLength: number;
  cellLength: number;
  /** 整张表的字符总数；不设就不限（查找表靠文件大小限住）。 */
  totalChars?: number;
}

/** 分隔符：CSV 文件是逗号；从 Excel 复制出来的表格是 Tab。 */
export type CsvDelimiter = ',' | '\t';

export interface CsvOptions {
  delimiter?: CsvDelimiter;
  limits?: TableLimits;
}

/** 拆好的记录（还没认表头）；引号没闭合时说明原因。 */
export type CsvRecords = { ok: true; rows: string[][] } | { ok: false; issue: string };

const BOM = '﻿';

/**
 * 解析 CSV（RFC 4180）：带引号的单元格里可以有分隔符、换行和 "" 转义的引号；
 * 行尾 CRLF / LF 都可以；开头的 BOM 去掉。表头和上限的规则见 tableFromRecords。
 */
export function parseCsv(input: string, options: CsvOptions = {}): CsvResult {
  const records = splitCsvRecords(input, options.delimiter ?? ',');
  if (!records.ok) {
    return records;
  }
  return tableFromRecords(records.rows, options.limits ?? LOOKUP_LIMITS);
}

/** 表格内容超过总字数上限时的说明（读 Excel 的子进程提前拦下时用同一句）。 */
export function totalCharsIssue(limit: number): string {
  return `表格内容太多（超过 ${limit} 字）：请分成几个文件`;
}

/**
 * 记录 → 表格：完全空白的记录跳过；第一条是列名，不能为空、不能重复；数据行比列名少的补空，
 * 多的报错（多半是分隔符不对或表头不全）。CSV 拆出来的和 Excel 读出来的都走这里，规则只有一份。
 */
export function tableFromRecords(records: readonly (readonly string[])[], limits: TableLimits): CsvResult {
  const [header, ...body] = records.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (!header) {
    return { ok: false, issue: '文件是空的，第一行应该是列名' };
  }
  const columns = header.map((name) => name.trim());
  const columnIssue = checkColumns(columns, limits);
  if (columnIssue) {
    return { ok: false, issue: columnIssue };
  }
  if (body.length > limits.rows) {
    return { ok: false, issue: `最多 ${limits.rows} 行数据，这个文件有 ${body.length} 行` };
  }
  const rows: string[][] = [];
  let totalChars = 0;
  for (const [index, row] of body.entries()) {
    if (row.length > columns.length) {
      return {
        ok: false,
        issue: `第 ${index + 2} 行有 ${row.length} 列，比列名多（${columns.length} 列）：请检查表头是否完整、分隔符是否正确`,
      };
    }
    if (row.some((cell) => cell.length > limits.cellLength)) {
      return { ok: false, issue: `第 ${index + 2} 行有单元格超过 ${limits.cellLength} 个字符` };
    }
    for (const cell of row) {
      totalChars += cell.length;
    }
    if (limits.totalChars !== undefined && totalChars > limits.totalChars) {
      return { ok: false, issue: totalCharsIssue(limits.totalChars) };
    }
    rows.push(columns.map((_, column) => row[column] ?? ''));
  }
  return { ok: true, table: { columns, rows } };
}

function checkColumns(columns: readonly string[], limits: TableLimits): string | null {
  if (columns.length > limits.columns) {
    return `最多 ${limits.columns} 列，这个文件有 ${columns.length} 列`;
  }
  const seen = new Set<string>();
  for (const [index, name] of columns.entries()) {
    if (name === '') {
      return `第 ${index + 1} 列没有列名`;
    }
    if (name.length > limits.columnNameLength) {
      return `列名「${name.slice(0, 10)}…」超过 ${limits.columnNameLength} 个字符`;
    }
    if (seen.has(name)) {
      return `列名重复：「${name}」`;
    }
    seen.add(name);
  }
  return null;
}

/** 逐字符扫描，按引号状态切分单元格和记录；开头的 BOM 去掉，空白记录原样保留（由 tableFromRecords 跳过）。 */
export function splitCsvRecords(input: string, delimiter: CsvDelimiter): CsvRecords {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
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
    } else if (char === delimiter) {
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
