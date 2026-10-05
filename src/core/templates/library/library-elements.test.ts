import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS } from '../canvas-model';
import { barcode, hLine, pairTable, qr, text } from './library-elements';

describe('library elements', () => {
  test('text uses the designer defaults and overrides only what it is given', () => {
    expect(text('name', '品名', [2, 2, 36, 5], '{品名}', { bold: true })).toEqual({
      id: 'name',
      name: '品名',
      x: 2,
      y: 2,
      width: 36,
      height: 5,
      rotation: 0,
      locked: false,
      kind: 'text',
      text: '{品名}',
      fontSizeMm: 3,
      bold: true,
      align: 'left',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    });
  });

  test('text wraps long content when asked', () => {
    expect(text('ingredients', '配料', [2, 11, 96, 14], '配料：{配料}', { wrap: true }).fit).toBe('wrap');
  });

  test('barcode prints its number underneath', () => {
    expect(barcode('code', '商品码', [2, 18, 36, 10], 'ean13', '{商品码}')).toMatchObject({
      kind: 'barcode',
      symbology: 'ean13',
      value: '{商品码}',
      showText: true,
      textSizeMm: 2.4,
    });
  });

  test('qr defaults to error correction M', () => {
    expect(qr('qr', '二维码', [44, 2, 14, 14], '{编码}').errorCorrection).toBe('M');
  });

  test('hLine is a solid line of the minimum width', () => {
    expect(hLine('rule', '分隔线', 2, 37, 66)).toMatchObject({
      kind: 'line',
      x: 2,
      y: 37,
      width: 66,
      height: CANVAS_LIMITS.minSizeMm,
      dashed: false,
    });
  });

  test('pairTable puts bold names on the left and lets the last row and column take the rest', () => {
    const table = pairTable(
      'info',
      '参数',
      [2, 9, 46, 15],
      10,
      [
        ['货号', '{编码}'],
        ['颜色', '{颜色}'],
        ['价格', '¥{价格}'],
      ],
      2.8,
    );
    expect(table.rowsMm).toEqual([5, 5, 0]);
    expect(table.columnsMm).toEqual([10, 0]);
    expect(table.borderMm).toBe(CANVAS_LIMITS.minSizeMm);
    expect(table.cells.map((row) => row.map((cell) => [cell.text, cell.bold, cell.fontSizeMm]))).toEqual([
      [
        ['货号', true, 2.8],
        ['{编码}', false, 2.8],
      ],
      [
        ['颜色', true, 2.8],
        ['{颜色}', false, 2.8],
      ],
      [
        ['价格', true, 2.8],
        ['¥{价格}', false, 2.8],
      ],
    ]);
  });
});
