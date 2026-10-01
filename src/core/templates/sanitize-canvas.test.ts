import { describe, expect, test } from 'bun:test';
import { GENERIC_TEMPLATE } from './builtin-templates';
import type { CanvasTemplate } from './canvas-model';
import { newCanvasElement } from './canvas-model';
import { sanitizeCanvasElements } from './sanitize-canvas';
import { sanitizeTemplate } from './sanitize-template';

const PAPER = { widthMm: 60, heightMm: 40 };

function sanitize(elements: unknown) {
  return sanitizeCanvasElements(elements, PAPER);
}

/** 构造一个「解码出来是 byteLength 个字节」的假 base64 字符串：内容全是占位字符，长度和 padding 算对就行，
 * 校验代码（base64ByteLength）不真的解码，只看长度和末尾的 `=`。 */
function fakeBase64(byteLength: number): string {
  const remainder = byteLength % 3;
  const padding = remainder === 0 ? 0 : 3 - remainder;
  const contentChars = ((byteLength + padding) / 3) * 4 - padding;
  return 'A'.repeat(contentChars) + '='.repeat(padding);
}

function fakeImage(pixelWidth: number, pixelHeight: number): Record<string, unknown> {
  return { kind: 'image', pixelWidth, pixelHeight, pixels: fakeBase64(pixelWidth * pixelHeight) };
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

  test('clamps huge row heights to the table height so they cannot sum to Infinity', () => {
    const [table] = sanitize([{ kind: 'table', height: 10, rowsMm: [1e300, 5, 0] }]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.rowsMm).toEqual([10, 5, 0]);
    expect(table.rowsMm.every((size) => Number.isFinite(size) && size <= table.height)).toBe(true);
  });

  test('clamps huge column widths to the table width', () => {
    const [table] = sanitize([{ kind: 'table', width: 20, columnsMm: [1e300, 5] }]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.columnsMm).toEqual([20, 5]);
  });

  test('rejects pixels whose base64 length is not a multiple of four', () => {
    expect(sanitize([{ kind: 'image', pixels: '//8', pixelWidth: 2, pixelHeight: 1 }])).toEqual([]);
  });

  test('strips whitespace inside pixels before validating', () => {
    const pixelsWithWhitespace = '/\n/\t8 =';
    const [image] = sanitize([{ kind: 'image', pixels: pixelsWithWhitespace, pixelWidth: 2, pixelHeight: 1 }]);
    expect(image).toMatchObject({ kind: 'image', pixels: '//8=' });
  });

  test('drops an image whose side exceeds the pixel limit', () => {
    expect(sanitize([{ kind: 'image', pixels: '', pixelWidth: 4001, pixelHeight: 1 }])).toEqual([]);
  });

  test('drops an image whose pixel count exceeds the 1MB budget', () => {
    expect(sanitize([{ kind: 'image', pixels: '', pixelWidth: 2000, pixelHeight: 600 }])).toEqual([]);
  });

  test('spends the template image budget greedily in order, skipping an oversized image but keeping a later small one', () => {
    const fillers = Array.from({ length: 4 }, () => fakeImage(1000, 1000)); // 各 1,000,000 字节，共 4,000,000
    const tooBig = fakeImage(1024, 1024); // 1,048,576 字节：超过剩下的 194,304 字节预算，被跳过
    const small = fakeImage(400, 250); // 100,000 字节：剩下的预算够用，被保留
    const result = sanitize([...fillers, tooBig, small]);
    const widths = result.flatMap((element) => (element.kind === 'image' ? [element.pixelWidth] : []));
    expect(widths).toEqual([1000, 1000, 1000, 1000, 400]);
  });

  test('drops an image whose pixel size is non-integer or zero', () => {
    expect(sanitize([{ kind: 'image', pixelWidth: 1.5, pixelHeight: 1, pixels: '/w==' }])).toEqual([]);
    expect(sanitize([{ kind: 'image', pixelWidth: 0, pixelHeight: 1, pixels: '/w==' }])).toEqual([]);
  });

  test('places an element as wide as the paper at x = 0', () => {
    const [rect] = sanitize([{ kind: 'rect', width: 60, x: 999 }]);
    expect(rect).toMatchObject({ x: 0, width: 60 });
  });

  test('replaces NaN or Infinity geometry with the default', () => {
    const [rect] = sanitize([
      { kind: 'rect', x: Number.NaN, y: Number.POSITIVE_INFINITY, width: Number.NaN, height: Number.NEGATIVE_INFINITY },
    ]);
    const fallback = newCanvasElement('rect', rect?.id ?? 'e1', PAPER);
    expect(rect).toMatchObject({ x: fallback.x, y: fallback.y, width: fallback.width, height: fallback.height });
  });

  test('falls back to a single row and column when rowsMm/columnsMm are missing or empty', () => {
    const [emptyArrays] = sanitize([{ kind: 'table', height: 8, width: 14, rowsMm: [], columnsMm: [] }]);
    if (emptyArrays?.kind !== 'table') throw new Error('expected a table');
    expect(emptyArrays.rowsMm).toEqual([8]);
    expect(emptyArrays.columnsMm).toEqual([14]);

    const [notList] = sanitize([{ kind: 'table', height: 8, width: 14, rowsMm: 'nope', columnsMm: null }]);
    if (notList?.kind !== 'table') throw new Error('expected a table');
    expect(notList.rowsMm).toEqual([8]);
    expect(notList.columnsMm).toEqual([14]);
  });

  test('turns negative or NaN row/column sizes into 0', () => {
    const [table] = sanitize([{ kind: 'table', height: 9, rowsMm: [-5, Number.NaN, 3] }]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.rowsMm).toEqual([0, 0, 3]);
  });

  test('keeps at most 20 rows and 10 columns', () => {
    const [table] = sanitize([
      { kind: 'table', rowsMm: Array.from({ length: 30 }, () => 1), columnsMm: Array.from({ length: 15 }, () => 1) },
    ]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.rowsMm).toHaveLength(20);
    expect(table.columnsMm).toHaveLength(10);
  });

  test('pads missing cells when cells is not an array', () => {
    const [table] = sanitize([{ kind: 'table', rowsMm: [5, 5], columnsMm: [10, 10], cells: 'nope' }]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.cells).toHaveLength(2);
    expect(table.cells.every((row) => row.length === 2 && row.every((c) => c.text === ''))).toBe(true);
  });

  test('renames an explicit id that collides with an earlier generated id', () => {
    const ids = sanitize([{ kind: 'line' }, { kind: 'line', id: 'e1' }]).map((element) => element.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe('e1');
    expect(ids[1]).not.toBe('e1');
  });

  test('strips newlines from barcode values and element names', () => {
    const [barcode] = sanitize([{ kind: 'barcode', value: 'A\nB\nC', name: '条\n码' }]);
    expect(barcode).toMatchObject({ value: 'ABC', name: '条码' });
  });

  test('falls back to the default name when the given name is blank', () => {
    const [line] = sanitize([{ kind: 'line', name: '   ' }]);
    expect(line?.name).toBe('线');
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

  test('keeps the previous elements when elements is missing from the input', () => {
    const fallbackTemplate: CanvasTemplate = {
      kind: 'canvas',
      id: 'x',
      name: '旧',
      paper: PAPER,
      printer: null,
      elements: [newCanvasElement('text', 'keep-me', PAPER)],
    };
    const result = sanitizeTemplate({ kind: 'canvas', name: '新' }, 'custom:c2', fallbackTemplate);
    expect(result.kind === 'canvas' && result.elements).toEqual(fallbackTemplate.elements);
  });

  test('reads an unknown kind as a label template', () => {
    const result = sanitizeTemplate({ kind: 'mystery', name: 'X' }, 'custom:z1', GENERIC_TEMPLATE);
    expect(result.kind).toBe('label');
  });
});
