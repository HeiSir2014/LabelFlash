import { describe, expect, test } from 'bun:test';
import type { CanvasTemplate } from './canvas-model';
import { sanitizeCanvasElements } from './sanitize-canvas';
import { sanitizeTemplate } from './sanitize-template';

const PAPER = { widthMm: 60, heightMm: 40 };

function sanitize(elements: unknown) {
  return sanitizeCanvasElements(elements, PAPER);
}

describe('sanitizeCanvasElements', () => {
  test('drops elements of unknown kind and anything that is not a list', () => {
    expect(sanitize('x')).toEqual([]);
    expect(sanitize([{ kind: 'video' }, null, 3])).toEqual([]);
  });

  test('fills a text element field by field from the defaults', () => {
    const [text] = sanitize([{ kind: 'text', text: '品名', fontSizeMm: 99, align: 'diagonal' }]);
    expect(text).toMatchObject({ kind: 'text', text: '品名', fontSizeMm: 30, align: 'left', rotation: 0 });
  });

  test('keeps elements inside the paper and at least the minimum size', () => {
    const [box] = sanitize([{ kind: 'rect', x: 55, y: -3, width: 20, height: 0 }]);
    expect(box).toMatchObject({ x: 40, y: 0, width: 20, height: 0.25 });
  });

  test('accepts only right-angle rotations', () => {
    expect(sanitize([{ kind: 'line', rotation: 90 }])[0]?.rotation).toBe(90);
    expect(sanitize([{ kind: 'line', rotation: 45 }])[0]?.rotation).toBe(0);
  });

  test('gives every element a unique id', () => {
    const ids = sanitize([
      { kind: 'line', id: 'a' },
      { kind: 'line', id: 'a' },
      { kind: 'line', id: '<script>' },
    ]).map((element) => element.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('a');
  });

  test('falls back to Code 128 for an unknown symbology', () => {
    expect(sanitize([{ kind: 'barcode', symbology: 'nope' }])[0]).toMatchObject({ symbology: 'code128' });
    expect(sanitize([{ kind: 'barcode', symbology: 'ean13' }])[0]).toMatchObject({ symbology: 'ean13' });
  });

  test('keeps an image only when its pixels match its size and fit the budget', () => {
    const white2x1 = { kind: 'image', pixels: '//8=', pixelWidth: 2, pixelHeight: 1 };
    expect(sanitize([white2x1])[0]).toMatchObject({ kind: 'image', pixelWidth: 2 });
    expect(sanitize([{ ...white2x1, pixelWidth: 3 }])).toEqual([]);
    expect(sanitize([{ ...white2x1, pixels: '***' }])).toEqual([]);
  });

  test('makes table cells match the rows and columns', () => {
    const [table] = sanitize([{ kind: 'table', rowsMm: [5, 0], columnsMm: [10, 10, 0], cells: [[{ text: 'a' }]] }]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.cells).toHaveLength(2);
    expect(table.cells.every((row) => row.length === 3)).toBe(true);
    expect(table.cells[0]?.[0]?.text).toBe('a');
    expect(table.cells[1]?.[2]?.text).toBe('');
  });

  test('keeps at most the element limit', () => {
    expect(sanitize(Array.from({ length: 150 }, () => ({ kind: 'line' })))).toHaveLength(100);
  });
});

describe('sanitizeTemplate for canvas templates', () => {
  test('keeps the canvas kind and sanitizes its elements', () => {
    const result = sanitizeTemplate(
      { kind: 'canvas', name: '吊牌', elements: [{ kind: 'text', text: 'A' }] },
      'custom:c1',
      { kind: 'canvas', id: 'x', name: '旧', paper: PAPER, printer: null, elements: [] } satisfies CanvasTemplate,
    );
    expect(result).toMatchObject({ kind: 'canvas', id: 'custom:c1', name: '吊牌' });
    expect(result.kind === 'canvas' && result.elements[0]?.kind).toBe('text');
  });
});
