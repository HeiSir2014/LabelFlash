import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { layoutCanvas } from './canvas-layout';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from './canvas-model';

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
  return layoutCanvas(canvasOf(elements), { scan: SCAN, printedAt: new Date(2026, 9, 1, 9, 5), dotMm: DOT });
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

  test('fills variables and drops lines whose fields are all missing', () => {
    const [laid] = layout([text({ text: '编码：{编码}\n颜色：{颜色}', height: 10 })]).elements;
    if (laid?.content.kind !== 'text') throw new Error('expected text');
    expect(laid.content.lines.map((line) => line.text)).toEqual(['编码：CL5640-TK']);
  });

  test('leaves out an element whose content came out empty', () => {
    expect(layout([text({ text: '{颜色}' })]).elements).toHaveLength(0);
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

  test('reports a barcode that has nothing to encode', () => {
    const barcode = { ...newCanvasElement('barcode', 'b', PAPER), name: '商品码', value: '{商品码}' };
    const result = layout([barcode]);
    expect(result.elements).toHaveLength(0);
    expect(result.issues).toEqual(['条码「商品码」这一张没有内容，不印']);
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
});
