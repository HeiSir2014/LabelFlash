import {
  CANVAS_LIMITS,
  type CanvasTable,
  type CanvasTableCell,
  DEFAULT_TABLE_CELL,
} from '../../../core/templates/canvas-model';
import { roundMm } from './canvas-edit';

/**
 * 表格的行和列：模型里最后一行、最后一列「占剩下的」，所以在末尾加一行时，原来的最后一行先改成固定高度
 * （它现在的实际高度），表格加高一行；删最后一行时表格减掉那一行。这样加减行列都不会挤压别的行。
 */

/** 新加的一行高 5mm、一列宽 12mm：放得下默认 2.8mm 的字和两三个汉字。 */
export const NEW_ROW_MM = 5;
export const NEW_COLUMN_MM = 12;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function newCell(): CanvasTableCell {
  return { ...DEFAULT_TABLE_CELL };
}

/** 最后一行实际的高：表格高减去前面几行。 */
export function lastRowMm(table: CanvasTable): number {
  return roundMm(Math.max(0, table.height - sum(table.rowsMm.slice(0, -1))));
}

/** 最后一列实际的宽。 */
export function lastColumnMm(table: CanvasTable): number {
  return roundMm(Math.max(0, table.width - sum(table.columnsMm.slice(0, -1))));
}

/** 在末尾加一行；已到行数上限时原样返回。 */
export function addTableRow(table: CanvasTable): CanvasTable {
  if (table.rowsMm.length >= CANVAS_LIMITS.tableRows) {
    return table;
  }
  return {
    ...table,
    height: roundMm(table.height + NEW_ROW_MM),
    rowsMm: [...table.rowsMm.slice(0, -1), lastRowMm(table), 0],
    cells: [...table.cells, table.columnsMm.map(newCell)],
  };
}

/** 删掉最后一行，表格减去它的高度；只剩一行时原样返回。 */
export function removeTableRow(table: CanvasTable): CanvasTable {
  if (table.rowsMm.length <= 1) {
    return table;
  }
  const rowsMm = table.rowsMm.slice(0, -1);
  return {
    ...table,
    height: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, sum(rowsMm))),
    rowsMm,
    cells: table.cells.slice(0, -1),
  };
}

/** 在末尾加一列；已到列数上限时原样返回。 */
export function addTableColumn(table: CanvasTable): CanvasTable {
  if (table.columnsMm.length >= CANVAS_LIMITS.tableColumns) {
    return table;
  }
  return {
    ...table,
    width: roundMm(table.width + NEW_COLUMN_MM),
    columnsMm: [...table.columnsMm.slice(0, -1), lastColumnMm(table), 0],
    cells: table.cells.map((row) => [...row, newCell()]),
  };
}

/** 删掉最后一列，表格减去它的宽度；只剩一列时原样返回。 */
export function removeTableColumn(table: CanvasTable): CanvasTable {
  if (table.columnsMm.length <= 1) {
    return table;
  }
  const columnsMm = table.columnsMm.slice(0, -1);
  return {
    ...table,
    width: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, sum(columnsMm))),
    columnsMm,
    cells: table.cells.map((row) => row.slice(0, -1)),
  };
}

/** 改一行的高（最后一行不用改：它占剩下的）。 */
export function setRowMm(table: CanvasTable, index: number, mm: number): CanvasTable {
  return { ...table, rowsMm: table.rowsMm.map((size, row) => (row === index ? mm : size)) };
}

/** 改一列的宽。 */
export function setColumnMm(table: CanvasTable, index: number, mm: number): CanvasTable {
  return { ...table, columnsMm: table.columnsMm.map((size, column) => (column === index ? mm : size)) };
}

/** 改一格（文字、字号、加粗、对齐），其余格子不变。 */
export function updateTableCell(
  table: CanvasTable,
  row: number,
  column: number,
  patch: Partial<CanvasTableCell>,
): CanvasTable {
  return {
    ...table,
    cells: table.cells.map((cells, r) =>
      r === row ? cells.map((cell, c) => (c === column ? { ...cell, ...patch } : cell)) : cells,
    ),
  };
}
