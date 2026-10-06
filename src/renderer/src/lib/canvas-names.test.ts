import { describe, expect, test } from 'bun:test';
import { type CanvasElement, newCanvasElement } from '../../../core/templates/canvas-model';
import { DISPLAY_NAME_LENGTH, displayName, renameKeyAction } from './canvas-names';

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

  // 新加的文字内容就是「文字」：几个新文字的摘要一模一样，分不清，用带编号的名字。
  test('keeps the numbered name while a new text still holds its placeholder content', () => {
    expect(displayName(element('text', { name: '文字 3', text: '文字' }))).toBe('文字 3');
  });

  test('falls back to the kind when an unnamed text or code is empty', () => {
    expect(displayName(element('text', { text: '  ' }))).toBe('文字');
    expect(displayName(element('barcode', { value: '' }))).toBe('条码');
  });
});

describe('renameKeyAction', () => {
  test('saves on Enter and cancels on Escape', () => {
    expect(renameKeyAction('Enter', false)).toBe('save');
    expect(renameKeyAction('Escape', false)).toBe('cancel');
    expect(renameKeyAction('a', false)).toBeNull();
  });

  // 中文输入法选字时的回车是确认候选词、Esc 是取消候选，不是结束改名。
  test('leaves Enter and Escape to the input method while composing', () => {
    expect(renameKeyAction('Enter', true)).toBeNull();
    expect(renameKeyAction('Escape', true)).toBeNull();
  });
});
