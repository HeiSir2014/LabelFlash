import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS, type CanvasTable, newCanvasElement } from '../../../core/templates/canvas-model';
import {
  addTableColumn,
  addTableRow,
  lastColumnMm,
  lastRowMm,
  NEW_COLUMN_MM,
  NEW_ROW_MM,
  removeTableColumn,
  removeTableRow,
  setColumnMm,
  setRowMm,
  updateTableCell,
} from './canvas-table';

const PAPER = { widthMm: 60, heightMm: 40 };

/** 默认的新表格：36×12mm，两行（6mm + 剩下的）两列（12mm + 剩下的）。 */
function table(): CanvasTable {
  const element = newCanvasElement('table', 't', PAPER);
  if (element.kind !== 'table') {
    throw new Error('expected a table');
  }
  return element;
}

describe('table sizes', () => {
  test('the last row and column take what is left', () => {
    expect(lastRowMm(table())).toBe(6);
    expect(lastColumnMm(table())).toBe(24);
  });

  test('adding a row fixes the old last row and grows the table by the new row', () => {
    const grown = addTableRow(table());
    expect(grown.rowsMm).toEqual([6, 6, 0]);
    expect(grown.height).toBe(12 + NEW_ROW_MM);
    expect(grown.cells).toHaveLength(3);
    expect(grown.cells[2]?.map((cell) => cell.text)).toEqual(['', '']);
  });

  test('removing the last row shrinks the table by that row', () => {
    expect(removeTableRow(addTableRow(table()))).toMatchObject({ rowsMm: [6, 6], height: 12 });
    const single = removeTableRow(table());
    expect(single).toMatchObject({ rowsMm: [6], height: 6 });
    expect(single.cells).toHaveLength(1);
    expect(removeTableRow(single)).toBe(single);
  });

  test('adds and removes columns in every row', () => {
    const wide = addTableColumn(table());
    expect(wide.columnsMm).toEqual([12, 24, 0]);
    expect(wide.width).toBe(36 + NEW_COLUMN_MM);
    expect(wide.cells.every((row) => row.length === 3)).toBe(true);
    const narrow = removeTableColumn(table());
    expect(narrow).toMatchObject({ columnsMm: [12], width: 12 });
    expect(narrow.cells.every((row) => row.length === 1)).toBe(true);
  });

  test('stops at the row and column limits', () => {
    const tall = { ...table(), rowsMm: Array.from({ length: CANVAS_LIMITS.tableRows }, () => 1) };
    expect(addTableRow(tall)).toBe(tall);
    const wide = { ...table(), columnsMm: Array.from({ length: CANVAS_LIMITS.tableColumns }, () => 1) };
    expect(addTableColumn(wide)).toBe(wide);
  });

  test('changes one row height or column width', () => {
    expect(setRowMm(table(), 0, 8).rowsMm).toEqual([8, 0]);
    expect(setColumnMm(table(), 0, 15).columnsMm).toEqual([15, 0]);
  });
});

describe('table cells', () => {
  test('changes one cell and keeps the rest', () => {
    const next = updateTableCell(table(), 1, 1, { bold: true });
    expect(next.cells[1]?.[1]).toMatchObject({ text: '{尺码}', bold: true });
    expect(next.cells[0]).toEqual(table().cells[0]);
  });
});
