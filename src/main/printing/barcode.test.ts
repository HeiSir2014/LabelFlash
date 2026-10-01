import { describe, expect, test } from 'bun:test';
import { encodeBarcode, linearBarsPath, matrixPath, moduleDotsFor } from './barcode';
import { encodeCode128 } from './code128';

describe('encodeBarcode', () => {
  test('encodes EAN-13 into 95 modules and adds the check digit itself', () => {
    const result = encodeBarcode('ean13', '590123412345');
    if (!result.ok || result.code.dimensions !== 1) throw new Error('expected a 1D code');
    expect(result.code.widths.reduce((sum, width) => sum + width, 0)).toBe(95);
  });

  test('encodes Code 128 to the same width as our own encoder', () => {
    const result = encodeBarcode('code128', 'ABC');
    if (!result.ok || result.code.dimensions !== 1) throw new Error('expected a 1D code');
    const ours = encodeCode128('ABC');
    if (ours === null) throw new Error('expected our encoder to succeed');
    expect(result.code.widths.reduce((sum, width) => sum + width, 0)).toBe(ours.modules);
  });

  test('encodes Data Matrix as a square grid of cells', () => {
    const result = encodeBarcode('datamatrix', 'ABC');
    if (!result.ok || result.code.dimensions !== 2) throw new Error('expected a 2D code');
    expect(result.code.columns).toBe(result.code.rows);
    expect(result.code.cells).toHaveLength(result.code.columns * result.code.rows);
    expect(result.code.rowScale).toBe(1);
  });

  test('draws PDF417 rows three modules tall', () => {
    const result = encodeBarcode('pdf417', 'ABC');
    if (!result.ok || result.code.dimensions !== 2) throw new Error('expected a 2D code');
    expect(result.code.rowScale).toBe(3);
    // 只有不重复的行进 cells：行数 × 列数正好是 cells 的长度。
    expect(result.code.cells).toHaveLength(result.code.rows * result.code.columns);
  });

  test('explains in Chinese what is wrong with the content', () => {
    const result = encodeBarcode('ean13', '12345');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('位数不对') });
    expect(encodeBarcode('ean13', 'ABCDEFGHIJKL').ok).toBe(false);
    expect(encodeBarcode('nope', '1')).toEqual({ ok: false, reason: '不认识的条码类型：nope' });
  });
});

describe('drawing', () => {
  test('fits whole printer dots per module within the limits', () => {
    // 0.125mm 一个点：100 个点放 40 个模块 → 每个模块 2 个点。
    expect(moduleDotsFor(100, 40, 0.125, 0.625)).toBe(2);
    expect(moduleDotsFor(100, 60, 0.125, 0.625)).toBeNull();
    expect(moduleDotsFor(10_000, 10, 0.125, 0.625)).toBe(5);
  });

  test('draws bars of equal height as full-height rectangles', () => {
    expect(linearBarsPath([2, 1, 3], false)).toBe('M0 0h2v1H0zM3 0h3v1H3z');
    expect(linearBarsPath([2, 1, 3], true)).toBe('M0 0h1v2H0zM0 3h1v3H0z');
  });

  test('draws four-state bars at their own heights', () => {
    // 两根条：第一根占上半，第二根满高。
    expect(linearBarsPath([1, 1, 1], false, [0.5, 1], [0.5, 0])).toBe('M0 0h1v0.5H0zM2 0h1v1H2z');
  });

  test('draws a 2D grid with taller rows when asked', () => {
    expect(matrixPath([1, 0, 0, 1], 2, 2, 3)).toBe('M0 0h1v3H0zM1 3h1v3H1z');
  });
});
