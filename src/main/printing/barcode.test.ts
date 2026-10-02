import { describe, expect, test } from 'bun:test';
import {
  CANVAS_MAX_MODULE_MM,
  encodeBarcode,
  linearBarsPath,
  MAX_BARCODE_TEXT_LENGTH,
  matrixPath,
  matrixQuietZone,
  moduleDotsFor,
  WAYBILL_MAX_MODULE_MM,
} from './barcode';
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

  test('draws Micro PDF417 rows two modules tall', () => {
    const result = encodeBarcode('micropdf417', 'ABC');
    if (!result.ok || result.code.dimensions !== 2) throw new Error('expected a 2D code');
    expect(result.code.rowScale).toBe(2);
  });

  test('draws a DataBar code whose widths include zero (merged bars)', () => {
    const result = encodeBarcode('databarexpanded', '(01)00012345678905');
    if (!result.ok || result.code.dimensions !== 1) throw new Error('expected a 1D code');
    expect(result.code.widths.some((width) => width === 0)).toBe(true);
    expect(result.code.widths.every((width) => Number.isInteger(width) && width >= 0)).toBe(true);
  });

  test('turns any failure inside bwip-js into a content failure instead of throwing', () => {
    // bwip-js 4.11.4 对 DataBar Expanded 的 '1'、'A'、'-' 这类内容不走它自己「bwipp.」前缀的错误体系，
    // 而是直接抛 TypeError（undefined is not an object ('_1V.length')）——这是它处理不可信内容时的真实行为，
    // 不是我们能控制的，必须当成「这份内容编不出来」而不是让它一路抛出去砸穿标签预览、打印。
    for (const text of ['1', 'A', '-']) {
      const result = encodeBarcode('databarexpanded', text);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('GS1 DataBar Expanded：内容不对');
    }
  });

  test('rejects an unknown barcode type', () => {
    expect(encodeBarcode('nope', '1')).toEqual({ ok: false, reason: '不认识的条码类型：nope' });
  });

  test('rejects empty content up front', () => {
    expect(encodeBarcode('ean13', '')).toEqual({ ok: false, reason: '内容是空的' });
  });

  test('rejects content longer than the label can hold', () => {
    const text = 'A'.repeat(MAX_BARCODE_TEXT_LENGTH + 1);
    expect(encodeBarcode('code128', text)).toEqual({ ok: false, reason: 'Code 128：内容太长，这种条码放不下' });
  });

  test('rejects non-ASCII content for a 1D symbology but accepts it for a 2D one', () => {
    expect(encodeBarcode('code128', '中')).toEqual({ ok: false, reason: 'Code 128：有这种条码不能编的字' });
    const result = encodeBarcode('datamatrix', '中');
    expect(result.ok).toBe(true);
  });

  test('rejects a lone UTF-16 surrogate as a bad character', () => {
    const result = encodeBarcode('datamatrix', '\uD800');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('Data Matrix：有这种条码不能编的字');
  });

  describe('explains bwip-js content errors in Chinese, by error code', () => {
    test('a "...Length" error reports the wrong length', () => {
      // onecode（USPS 智能邮件码）已经从 BARCODE_TYPES 去掉，换一个仍然按位数报错的码制：itf14badLength。
      const result = encodeBarcode('itf14', '123');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('ITF-14（箱码）：位数不对');
      expect(result.detail).toContain('itf14badLength');
    });

    test('an over-long Aztec message reports "too long"', () => {
      // 'ÿ' 不是 ASCII，Aztec 得用字节模式（每字符 8 位）编，999 个字符就超出符号容量；
      // 字数仍在 MAX_BARCODE_TEXT_LENGTH 以内，走的是 bwip-js 自己的「放不下」，不是我们先拦的「太长」。
      const result = encodeBarcode('azteccode', 'ÿ'.repeat(999));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('Aztec：内容太长，这种条码放不下');
      expect(result.detail).toContain('aztecNoValidSymbol');
    });

    test('GS1-128 without parentheses hints at the GS1 format', () => {
      const result = encodeBarcode('gs1-128', '0106901234567892');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('GS1-128：要写成 GS1 格式，例如 (01)06901234567892');
      expect(result.detail).toContain('GS1');
    });

    test('a non-digit EAN-13 reports a bad character', () => {
      const result = encodeBarcode('ean13', 'ABCDEFGHIJKL');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('EAN-13（商品条码）：有这种条码不能编的字');
      expect(result.detail).toContain('ean13badCharacter');
    });

    test('a wrong EAN-13 check digit reports the check digit', () => {
      const result = encodeBarcode('ean13', '5901234123458');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('EAN-13（商品条码）：校验位不对');
      expect(result.detail).toContain('ean13badCheckDigit');
    });
  });
});

describe('matrixQuietZone', () => {
  test("knows each symbology's quiet zone in modules", () => {
    expect(matrixQuietZone('pdf417')).toBe(2);
    expect(matrixQuietZone('datamatrix')).toBe(1);
    expect(matrixQuietZone('hanxin')).toBe(3);
  });
});

describe('drawing', () => {
  test('fits whole printer dots per module within the limits', () => {
    // 0.125mm 一个点：100 个点放 40 个模块 → 每个模块 2 个点。
    expect(moduleDotsFor(100, 40, 0.125, 0.625)).toBe(2);
    expect(moduleDotsFor(100, 60, 0.125, 0.625)).toBeNull();
    expect(moduleDotsFor(10_000, 10, 0.125, 0.625)).toBe(5);
  });

  test('rounds the minimum up instead of to the nearest dot', () => {
    // 204dpi：MIN_MODULE_MM / dot ≈ 2.0079（比 2 大一点，不是浮点误差，是这个 DPI 本来就要比 2 个点多一些）。
    // 用 round 会降到 2，但 2 个点只有 0.249mm，比 0.25mm 还窄；ceil 才能保证点数折算出来的宽度够。
    const dot204 = 25.4 / 204;
    expect(moduleDotsFor(2, 1, dot204, WAYBILL_MAX_MODULE_MM)).toBeNull();
    expect(moduleDotsFor(3, 1, dot204, WAYBILL_MAX_MODULE_MM)).toBe(3);
  });

  test('finds the minimum and the canvas maximum at 300dpi', () => {
    const dot300 = 25.4 / 300;
    expect(moduleDotsFor(2, 1, dot300, CANVAS_MAX_MODULE_MM)).toBeNull();
    expect(moduleDotsFor(3, 1, dot300, CANVAS_MAX_MODULE_MM)).toBe(3);
    expect(moduleDotsFor(100_000, 1, dot300, CANVAS_MAX_MODULE_MM)).toBe(12);
  });

  test('draws bars of equal height as full-height rectangles', () => {
    expect(linearBarsPath([2, 1, 3], false)).toBe('M0 0h2v1H0zM3 0h3v1H3z');
    expect(linearBarsPath([2, 1, 3], true)).toBe('M0 0h1v2H0zM0 3h1v3H0z');
  });

  test('draws a zero-width bar (DataBar merges adjacent bars) without breaking the path', () => {
    expect(linearBarsPath([0, 1, 2], false)).toBe('M0 0h0v1H0zM1 0h2v1H1z');
  });

  test('draws four-state bars at their own heights', () => {
    // 两根条：第一根占上半，第二根满高。
    expect(linearBarsPath([1, 1, 1], false, [0.5, 1], [0.5, 0])).toBe('M0 0h1v0.5H0zM2 0h1v1H2z');
  });

  test('draws a 2D grid with taller rows when asked', () => {
    expect(matrixPath([1, 0, 0, 1], 2, 2, 3)).toBe('M0 0h1v3H0zM1 3h1v3H1z');
  });
});
