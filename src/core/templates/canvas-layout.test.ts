import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { layoutCanvas } from './canvas-layout';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from './canvas-model';
import { textWidthMm } from './waybill-layout';

const DOT = 25.4 / 203;
const PAPER = { widthMm: 60, heightMm: 40 };
const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '尺码', value: 'XL' },
  ],
};

function canvasOf(elements: CanvasElement[]): CanvasTemplate {
  return { kind: 'canvas', id: 'custom:c', name: 'c', paper: PAPER, printer: null, elements };
}

function layout(elements: CanvasElement[]) {
  return layoutAt(elements, DOT);
}

function layoutAt(elements: CanvasElement[], dotMm: number) {
  return layoutCanvas(canvasOf(elements), { scan: SCAN, printedAt: new Date(2026, 9, 1, 9, 5), dotMm });
}

function text(overrides: Partial<CanvasElement> & { text?: string }): CanvasElement {
  return { ...newCanvasElement('text', 't', PAPER), x: 5, y: 5, ...overrides } as CanvasElement;
}

describe('layoutCanvas', () => {
  test('puts every element on whole printer dots', () => {
    const { elements } = layout([text({ x: 5.07, y: 3.33, width: 20.01, height: 6.06 })]);
    const onDot = (mm: number) => Math.abs(mm / DOT - Math.round(mm / DOT)) < 1e-6;
    const rect = elements[0]?.rect;
    if (!rect) throw new Error('expected a laid element');
    expect([rect.x, rect.y, rect.width, rect.height].every(onDot)).toBe(true);
  });

  test('swaps the frame for elements turned by 90 or 270 degrees', () => {
    const [turned] = layout([text({ width: 6, height: 20, rotation: 90 })]).elements;
    expect(turned?.frame.width).toBeCloseTo(turned?.rect.height ?? 0);
    expect(turned?.frame.height).toBeCloseTo(turned?.rect.width ?? 0);
  });

  test('keeps the frame for an element turned 180 degrees', () => {
    const [laid] = layout([text({ width: 6, height: 20, rotation: 180 })]).elements;
    expect(laid?.frame.width).toBeCloseTo(laid?.rect.width ?? 0);
    expect(laid?.frame.height).toBeCloseTo(laid?.rect.height ?? 0);
  });

  test('swaps the frame for an element turned 270 degrees', () => {
    const [laid] = layout([text({ width: 6, height: 20, rotation: 270 })]).elements;
    expect(laid?.frame.width).toBeCloseTo(laid?.rect.height ?? 0);
    expect(laid?.frame.height).toBeCloseTo(laid?.rect.width ?? 0);
  });

  test('passes align, valign and inverse through to the laid text', () => {
    const [laid] = layout([text({ align: 'right', valign: 'top', inverse: true })]).elements;
    if (laid?.content.kind !== 'text') throw new Error('expected text');
    expect(laid.content.align).toBe('right');
    expect(laid.content.valign).toBe('top');
    expect(laid.content.inverse).toBe(true);
  });

  test('keeps a 2% slack on text width so macOS font drift does not get clipped', () => {
    // 不留余量时，这段文字刚好放得下（宽度正好等于估算值 / 0.99，也就是文字占框宽的 99%）；
    // 留了 2% 余量之后，99% 比「框宽 × 98%」还宽，放不下，字号要缩小。
    const content = 'ABCDEFGHIJ';
    const fontSizeMm = 3.5;
    const widthMm = textWidthMm(content, fontSizeMm) / 0.99;
    const [laid] = layout([text({ text: content, fontSizeMm, width: widthMm, height: 10 })]).elements;
    if (laid?.content.kind !== 'text') throw new Error('expected text');
    expect(laid.content.lines[0]?.fontSizeMm).toBeLessThan(fontSizeMm);
  });

  test('fills variables and drops lines whose fields are all missing', () => {
    const [laid] = layout([text({ text: '编码：{编码}\n颜色：{颜色}', height: 10 })]).elements;
    if (laid?.content.kind !== 'text') throw new Error('expected text');
    expect(laid.content.lines.map((line) => line.text)).toEqual(['编码：CL5640-TK']);
  });

  test('leaves out an element whose content came out empty', () => {
    expect(layout([text({ text: '{颜色}' })]).elements).toHaveLength(0);
  });

  test('keeps a blank line the user typed on purpose between two real lines', () => {
    const [laid] = layout([text({ text: 'A\n\nB', height: 15 })]).elements;
    if (laid?.content.kind !== 'text') throw new Error('expected text');
    expect(laid.content.lines.map((line) => line.text)).toEqual(['A', '', 'B']);
  });

  test('reports text that had to be cut and elements near the paper edge', () => {
    const { issues, overflowCount } = layout([
      text({ name: '长文字', text: '很长很长的文字'.repeat(20), width: 10, height: 3 }),
      text({ name: '边上', x: 0.5, y: 10 }),
    ]);
    expect(overflowCount).toBe(1);
    expect(issues).toEqual([
      '文字「长文字」放不下，已截断：加大文字框或调小字号',
      '「边上」靠近纸边（离纸边不到 1.5mm），可能打不全',
    ]);
  });

  test.each([
    { dpi: 203, dotMm: 25.4 / 203 },
    { dpi: 300, dotMm: 25.4 / 300 },
  ])('does not flag an element sitting exactly on the safe margin at $dpi dpi', ({ dotMm }) => {
    // 左上在安全线上，右下也刚好在安全线上（60×40 的纸，1.5mm 安全区）。
    const onLine = text({ x: 1.5, y: 1.5, width: 57, height: 37 });
    expect(layoutAt([onLine], dotMm).issues).toEqual([]);
  });

  test.each([
    { dpi: 203, dotMm: 25.4 / 203 },
    { dpi: 300, dotMm: 25.4 / 300 },
  ])('still flags an element that is really inside the safe margin at $dpi dpi', ({ dotMm }) => {
    const insideMargin = text({ name: '太靠边', x: 1.0, y: 1.5, width: 57, height: 37 });
    expect(layoutAt([insideMargin], dotMm).issues).toEqual(['「太靠边」靠近纸边（离纸边不到 1.5mm），可能打不全']);
  });

  test('reports a barcode that has nothing to encode', () => {
    const barcode = { ...newCanvasElement('barcode', 'b', PAPER), name: '商品码', value: '{商品码}' };
    const result = layout([barcode]);
    expect(result.elements).toHaveLength(0);
    expect(result.issues).toEqual(['条码「商品码」这一张没有内容，不印']);
  });

  test('reports a QR code that has nothing to encode', () => {
    const qr = { ...newCanvasElement('qr', 'q', PAPER), name: '二维码A', value: '{不存在}' };
    const result = layout([qr]);
    expect(result.elements).toHaveLength(0);
    expect(result.issues).toEqual(['二维码「二维码A」这一张没有内容，不印']);
  });

  test('keeps whitespace in the expanded barcode value, trimming only to check for emptiness', () => {
    const barcode = { ...newCanvasElement('barcode', 'b', PAPER), value: '  {完整内容}  ' };
    const [laid] = layout([barcode]).elements;
    if (laid?.content.kind !== 'barcode') throw new Error('expected a barcode');
    expect(laid.content.value).toBe(`  ${SCAN.raw}  `);
  });

  test('splits a table into dot-aligned cells with the last row and column taking the rest', () => {
    const table = { ...newCanvasElement('table', 'tb', PAPER), x: 5, y: 5, width: 30, height: 10 };
    const [laid] = layout([table]).elements;
    if (laid?.content.kind !== 'table') throw new Error('expected a table');
    const { rows, columns } = laid.content;
    expect(rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(laid.frame.height);
    expect(columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(laid.frame.width);
    expect(laid.content.cells[1]?.[1]?.lines[0]?.text).toBe('XL');
  });

  test('shrinks table rows that ask for more than the frame and still sums to the frame height', () => {
    const table = {
      ...newCanvasElement('table', 'tb', PAPER),
      x: 5,
      y: 5,
      width: 30,
      height: 3,
      rowsMm: [6, 6, 2],
    } as CanvasElement;
    const [laid] = layout([table]).elements;
    if (laid?.content.kind !== 'table') throw new Error('expected a table');
    expect(laid.content.rows).toHaveLength(3);
    expect(laid.content.rows.every((size) => size < 6)).toBe(true);
    expect(laid.content.rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(laid.frame.height);
  });

  test('reports a cut table cell with table-specific wording', () => {
    const table = {
      ...newCanvasElement('table', 'tb', PAPER),
      name: '表格A',
      x: 5,
      y: 5,
      width: 10,
      height: 6,
      rowsMm: [6, 0],
      columnsMm: [5, 5],
      cells: [
        [
          { text: '很长很长放不下的文字内容字段'.repeat(3), fontSizeMm: 2.8, bold: false, align: 'left' },
          { text: '', fontSizeMm: 2.8, bold: false, align: 'left' },
        ],
      ],
    } as CanvasElement;
    const { issues, overflowCount } = layout([table]);
    expect(overflowCount).toBe(1);
    expect(issues).toEqual(['表格「表格A」有格子放不下，已截断：加大行高、列宽或调小字号']);
  });

  test('counts both a cut text and a cut table toward overflowCount', () => {
    const longText = text({ name: '文字B', text: '很长很长的文字'.repeat(20), width: 10, height: 3 });
    const table = {
      ...newCanvasElement('table', 'tb', PAPER),
      name: '表格B',
      x: 5,
      y: 15,
      width: 10,
      height: 6,
      rowsMm: [6, 0],
      columnsMm: [5, 5],
      cells: [
        [
          { text: '很长很长放不下的文字内容字段'.repeat(3), fontSizeMm: 2.8, bold: false, align: 'left' },
          { text: '', fontSizeMm: 2.8, bold: false, align: 'left' },
        ],
      ],
    } as CanvasElement;
    const { overflowCount, issues } = layout([longText, table]);
    expect(overflowCount).toBe(2);
    expect(issues).toContain('文字「文字B」放不下，已截断：加大文字框或调小字号');
    expect(issues).toContain('表格「表格B」有格子放不下，已截断：加大行高、列宽或调小字号');
  });

  test('keeps a table with many thin rows and a thick border from producing a negative content box', () => {
    const table = {
      ...newCanvasElement('table', 'tb', PAPER),
      x: 5,
      y: 5,
      width: 20,
      height: 2,
      rowsMm: Array.from({ length: 20 }, () => 1),
      columnsMm: [20],
      borderMm: 2,
      cells: [[{ text: '很长很长放不下的文字内容', fontSizeMm: 2.8, bold: false, align: 'left' }]],
    } as CanvasElement;
    const [laid] = layout([table]).elements;
    if (laid?.content.kind !== 'table') throw new Error('expected a table');
    expect(laid.content.rows).toHaveLength(20);
    expect(laid.content.rows.every((size) => size >= 0)).toBe(true);
    expect(laid.content.rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(laid.frame.height);
    expect(laid.content.cells).toHaveLength(20);
  });
});
