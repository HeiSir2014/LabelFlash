import { describe, expect, test } from 'bun:test';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from '../../../core/templates/canvas-model';
import { applyInlineEdit, inlineEditorLayout } from './canvas-inline';

const PAPER = { widthMm: 60, heightMm: 40 };

function canvas(...elements: CanvasElement[]): CanvasTemplate {
  return { kind: 'canvas', id: 'custom:t', name: 't', paper: PAPER, printer: null, elements };
}

const text = {
  ...newCanvasElement('text', 't1', PAPER),
  x: 2,
  y: 16,
  width: 30,
  height: 7,
  text: '¥199.00',
  fontSizeMm: 6,
  bold: true,
  align: 'center',
} as CanvasElement;
const table = { ...newCanvasElement('table', 'tb', PAPER), x: 5, y: 5 } as CanvasElement;

describe('inlineEditorLayout', () => {
  test('covers a text element with its font size, weight and alignment', () => {
    expect(inlineEditorLayout(text, null)).toEqual({
      box: { x: 2, y: 16, width: 30, height: 7 },
      text: '¥199.00',
      fontSizeMm: 6,
      bold: true,
      align: 'center',
      rotation: 0,
    });
  });

  test('covers one table cell with that cell’s style', () => {
    const layout = inlineEditorLayout(table, { row: 1, column: 1, box: { x: 17, y: 11, width: 24, height: 6 } });
    expect(layout).toMatchObject({ box: { x: 17, y: 11, width: 24, height: 6 }, text: '{尺码}', bold: false });
  });

  test('has nothing to edit inline for other kinds', () => {
    expect(inlineEditorLayout(newCanvasElement('barcode', 'b', PAPER), null)).toBeNull();
  });
});

describe('applyInlineEdit', () => {
  test('replaces the text of a text element', () => {
    const next = applyInlineEdit(canvas(text), { elementId: 't1', cell: null }, '¥99.00\n特价');
    expect(next.elements[0]).toMatchObject({ text: '¥99.00\n特价', x: 2, y: 16 });
  });

  test('replaces the text of one table cell only', () => {
    const next = applyInlineEdit(canvas(table), { elementId: 'tb', cell: { row: 0, column: 1 } }, '{颜色}');
    const edited = next.elements[0];
    expect(edited?.kind === 'table' && edited.cells.map((row) => row.map((cell) => cell.text))).toEqual([
      ['名称', '{颜色}'],
      ['尺码', '{尺码}'],
    ]);
  });

  test('keeps the text within the length limit and ignores a missing element', () => {
    const template = canvas(text);
    const long = applyInlineEdit(template, { elementId: 't1', cell: null }, 'x'.repeat(600));
    expect(long.elements[0]?.kind === 'text' && long.elements[0].text.length).toBe(500);
    expect(applyInlineEdit(template, { elementId: 'gone', cell: null }, 'x')).toBe(template);
  });
});
