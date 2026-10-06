import { describe, expect, test } from 'bun:test';
import { type CanvasElement, newCanvasElement } from '../../../core/templates/canvas-model';
import { DISPLAY_NAME_LENGTH, displayName } from './canvas-names';

const PAPER = { widthMm: 60, heightMm: 40 };

function element<T extends CanvasElement>(kind: T['kind'], patch: Partial<T> = {}): CanvasElement {
  return { ...newCanvasElement(kind, 'e1', PAPER), ...patch } as CanvasElement;
}

describe('displayName', () => {
  test('summarises an unnamed text by its first line', () => {
    expect(displayName(element('text', { text: '品名：{编码}' }))).toBe('品名：{编码}');
    expect(displayName(element('text', { name: '文字 2', text: '¥199.00\n第二行' }))).toBe('¥199.00');
  });

  test('summarises an unnamed barcode and QR code by their content', () => {
    expect(displayName(element('barcode', { value: '{编码}' }))).toBe('条码 {编码}');
    expect(displayName(element('qr', { name: '二维码 3', value: '{编码}' }))).toBe('二维码 {编码}');
  });

  test('summarises an unnamed table by its size, columns first', () => {
    const table = element('table');
    if (table.kind !== 'table') {
      throw new Error('expected a table');
    }
    const wider = { ...table, columnsMm: [10, 10, 0], cells: table.cells.map((row) => [...row, row[0]]) };
    expect(displayName(wider as CanvasElement)).toBe('表格 3×2');
  });

  test('keeps the numbered name of shapes and images, which have no content to show', () => {
    expect(displayName(element('image'))).toBe('图片');
    expect(displayName(element('rect', { name: '矩形 2' }))).toBe('矩形 2');
    expect(displayName(element('line'))).toBe('线');
  });

  test('shows a name the operator gave', () => {
    expect(displayName(element('text', { name: '价格', text: '¥199.00' }))).toBe('价格');
    expect(displayName(element('barcode', { name: '编码条码' }))).toBe('编码条码');
  });

  test(`cuts a long summary to ${DISPLAY_NAME_LENGTH} characters with an ellipsis`, () => {
    const name = displayName(element('text', { text: '这是一段很长很长很长的说明文字' }));
    expect([...name]).toHaveLength(DISPLAY_NAME_LENGTH);
    expect(name.endsWith('…')).toBe(true);
  });

  test('falls back to the kind when an unnamed text or code is empty', () => {
    expect(displayName(element('text', { text: '  ' }))).toBe('文字');
    expect(displayName(element('barcode', { value: '' }))).toBe('条码');
  });
});
