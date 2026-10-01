/**
 * 表格的行和列：模型里最后一行、最后一列「占剩下的」，所以在末尾加一行时，原来的最后一行先改成固定高度
 * （它现在按布局实际算出的高度），表格加高一行；删最后一行时表格减掉那一行。这样加减行列都不会挤压别的行。
 *
 * 转了 90°/270° 时，行列占的是转之前的方向：`canvas-layout` 里内容的 frame 是转之前的坐标系，
 * 转过的外框（`element.width`/`height`）里「高」对应转之前的「宽」。所以这里算「实际的行高」用的总长度、
 * 加一行要长出来的那一维，都要按转了多少跟着换——换算方式必须和 canvas-layout 一致，否则编辑器显示的
 * 行高和实际打印排出来的对不上。
 */
import {
  CANVAS_LIMITS,
  type CanvasTable,
  type CanvasTableCell,
  DEFAULT_TABLE_CELL,
  type Rotation,
} from '../../../core/templates/canvas-model';
import { resolveSizes } from '../../../core/templates/waybill-layout';
import { roundMm } from './canvas-edit';

/** 新加的一行高 5mm、一列宽 12mm：放得下默认 2.8mm 的字和两三个汉字。 */
export const NEW_ROW_MM = 5;
export const NEW_COLUMN_MM = 12;

function newCell(): CanvasTableCell {
  return { ...DEFAULT_TABLE_CELL };
}

/** 转了一个直角：行列占的方向和 `element.width`/`height` 互换了（canvas-layout 的 frame 换算）。 */
function isTurned(rotation: Rotation): boolean {
  return rotation % 180 === 90;
}

/**
 * 行要占满的总长度：没转或转了半圈用高，转了一个直角用宽。属性栏的行高数字框也用它当上限
 * ——单独一行不能比表格自己占的总长度还大，不论表格转了多少度。
 */
export function rowsExtentMm(table: CanvasTable): number {
  return isTurned(table.rotation) ? table.width : table.height;
}

/** 列要占满的总长度；属性栏的列宽数字框用它当上限，理由同 rowsExtentMm。 */
export function columnsExtentMm(table: CanvasTable): number {
  return isTurned(table.rotation) ? table.height : table.width;
}

/** 最后一行实际的高：和 canvas-layout 排版时一样，用 `resolveSizes` 把 rowsMm 摊到总长度上再取最后一项。 */
export function lastRowMm(table: CanvasTable): number {
  return roundMm(resolveSizes(table.rowsMm, rowsExtentMm(table)).at(-1) ?? 0);
}

/** 最后一列实际的宽。 */
export function lastColumnMm(table: CanvasTable): number {
  return roundMm(resolveSizes(table.columnsMm, columnsExtentMm(table)).at(-1) ?? 0);
}

/** 在末尾加一行；已到行数上限时原样返回。 */
export function addTableRow(table: CanvasTable): CanvasTable {
  if (table.rowsMm.length >= CANVAS_LIMITS.tableRows) {
    return table;
  }
  const fixedLastRow = lastRowMm(table);
  const grown = isTurned(table.rotation)
    ? { ...table, width: roundMm(table.width + NEW_ROW_MM) }
    : { ...table, height: roundMm(table.height + NEW_ROW_MM) };
  return {
    ...grown,
    rowsMm: [...table.rowsMm.slice(0, -1), fixedLastRow, 0],
    cells: [...table.cells, table.columnsMm.map(newCell)],
  };
}

/** 删掉最后一行，表格减去它按布局实际算出的高度；只剩一行时原样返回。 */
export function removeTableRow(table: CanvasTable): CanvasTable {
  if (table.rowsMm.length <= 1) {
    return table;
  }
  const removed = lastRowMm(table);
  const shrunk = isTurned(table.rotation)
    ? { ...table, width: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, table.width - removed)) }
    : { ...table, height: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, table.height - removed)) };
  return { ...shrunk, rowsMm: table.rowsMm.slice(0, -1), cells: table.cells.slice(0, -1) };
}

/** 在末尾加一列；已到列数上限时原样返回。 */
export function addTableColumn(table: CanvasTable): CanvasTable {
  if (table.columnsMm.length >= CANVAS_LIMITS.tableColumns) {
    return table;
  }
  const fixedLastColumn = lastColumnMm(table);
  const grown = isTurned(table.rotation)
    ? { ...table, height: roundMm(table.height + NEW_COLUMN_MM) }
    : { ...table, width: roundMm(table.width + NEW_COLUMN_MM) };
  return {
    ...grown,
    columnsMm: [...table.columnsMm.slice(0, -1), fixedLastColumn, 0],
    cells: table.cells.map((row) => [...row, newCell()]),
  };
}

/** 删掉最后一列，表格减去它按布局实际算出的宽度；只剩一列时原样返回。 */
export function removeTableColumn(table: CanvasTable): CanvasTable {
  if (table.columnsMm.length <= 1) {
    return table;
  }
  const removed = lastColumnMm(table);
  const shrunk = isTurned(table.rotation)
    ? { ...table, height: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, table.height - removed)) }
    : { ...table, width: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, table.width - removed)) };
  return { ...shrunk, columnsMm: table.columnsMm.slice(0, -1), cells: table.cells.map((row) => row.slice(0, -1)) };
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
