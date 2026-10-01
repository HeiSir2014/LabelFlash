import { describe, expect, test } from 'bun:test';
import { TEMPLATE_LIMITS } from './template-model';
import {
  countLines,
  estimateTextWidthEm,
  fitFontSizeMm,
  fitRowFontSizes,
  STACKED_PREFIX_SCALE,
  textHeightMm,
} from './text-fit';

/** 通用模板在 24mm 二维码旁的字段区大小。 */
const SIDE_WIDTH_MM = 31;
const SIDE_HEIGHT_MM = 35;
const INLINE = { arrangement: 'inline', uniform: false } as const;

describe('estimateTextWidthEm', () => {
  test('counts CJK as full width and narrow Latin glyphs as narrower than digits and capitals', () => {
    // 汉字按 1.01 个字宽：苹方实测 1.004。
    expect(estimateTextWidthEm('图片色')).toBeCloseTo(3.03);
    expect(estimateTextWidthEm('i')).toBeLessThan(estimateTextWidthEm('0'));
    expect(estimateTextWidthEm('0')).toBeLessThan(estimateTextWidthEm('C'));
    expect(estimateTextWidthEm('C')).toBeLessThan(estimateTextWidthEm('W'));
  });

  // 微软雅黑、苹方的数字是等宽的：1 和 0 一样宽，不能当窄字（以前当窄字，订单号会被估窄）。
  test('treats every digit as the same width', () => {
    expect(new Set([...'0123456789'].map((digit) => estimateTextWidthEm(digit))).size).toBe(1);
  });

  // 2026-10-01 在 Edge 里实测的微软雅黑粗体字宽（em）：估算不能比它窄，否则字会被边缘裁掉。
  test('is never narrower than the measured Microsoft YaHei bold widths', () => {
    const measured: Record<string, number> = {
      '0': 0.617,
      '1': 0.617,
      A: 0.752,
      L: 0.547,
      W: 1.076,
      a: 0.578,
      m: 0.982,
      i: 0.296,
      '-': 0.448,
      ' ': 0.298,
      '*': 0.487,
      '×': 0.761,
      '…': 0.963,
      '&': 0.911,
      '+': 0.761,
      '/': 0.473,
      '—': 1.08,
    };
    for (const [char, width] of Object.entries(measured)) {
      expect(estimateTextWidthEm(char)).toBeGreaterThanOrEqual(width);
    }
  });
});

describe('countLines', () => {
  test('breaks between any two characters, like word-break: break-all', () => {
    // 每行 10.1em：10 个汉字（每个 1.01em）正好一行，第 11 个换行。
    expect(countLines('汉'.repeat(10), 1, 10.1)).toBe(1);
    expect(countLines('汉'.repeat(11), 1, 10.1)).toBe(2);
  });

  test('counts every explicit line, blank ones included', () => {
    expect(countLines('一\n\n三', 1, 10)).toBe(3);
  });

  test('never fits in no width', () => {
    expect(countLines('a', 1, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fitFontSizeMm', () => {
  test('keeps the font size when the text fits', () => {
    expect(fitFontSizeMm('CL5640-TK', 3.2, 30, 1)).toBe(3.2);
  });

  test('finds the largest size that fits the allowed lines, never below the minimum', () => {
    const long = 'C'.repeat(80);
    const fitted = fitFontSizeMm(long, 3, 55, 2);
    expect(fitted).toBeLessThan(3);
    expect(countLines(long, fitted, 55)).toBeLessThanOrEqual(2);
    expect(countLines(long, fitted + 0.1, 55)).toBeGreaterThan(2);
    expect(fitFontSizeMm('C'.repeat(1_000), 3, 55, 1)).toBe(TEMPLATE_LIMITS.fontSizeMm.min);
  });
});

describe('fitRowFontSizes', () => {
  test('keeps rows that fit as they are', () => {
    const rows = [
      { prefix: '编码：', value: 'CL5640-TK', fontSizeMm: 3.2 },
      { prefix: '尺码：', value: 'XL', fontSizeMm: 3.2 },
    ];
    expect(fitRowFontSizes(rows, SIDE_WIDTH_MM, SIDE_HEIGHT_MM, INLINE)).toEqual([3.2, 3.2]);
  });

  test('keeps the size and wraps when one line would need more than a small shrink', () => {
    const row = { prefix: '订单号：', value: '2026092800012345678', fontSizeMm: 3 };
    expect(fitRowFontSizes([row], SIDE_WIDTH_MM, SIDE_HEIGHT_MM, INLINE)).toEqual([3]);
  });

  test('shrinks a little rather than breaking an order number across lines', () => {
    const row = { prefix: '订单号：', value: '202609280001', fontSizeMm: 3 };
    const [size = 0] = fitRowFontSizes([row], SIDE_WIDTH_MM, SIDE_HEIGHT_MM, INLINE);
    expect(size).toBeLessThan(row.fontSizeMm);
    expect(size).toBeGreaterThanOrEqual(row.fontSizeMm * 0.75);
    // 值从前缀列之后开始：一行放得下。
    const valueWidth = SIDE_WIDTH_MM - estimateTextWidthEm(row.prefix) * row.fontSizeMm;
    expect(countLines(row.value, size, valueWidth)).toBe(1);
  });

  // 样衣模板二维码大一些，字段区只有 29mm：12 位订单号要缩到 0.74 倍才放得进一行，以前会断成「202609280 / 001」。
  test('shrinks a code further than ordinary text rather than breaking it', () => {
    const sideWidthMm = 29;
    const row = { prefix: '订单号：', value: '202609280001', fontSizeMm: 3 };
    const [size = 0] = fitRowFontSizes([row], sideWidthMm, SIDE_HEIGHT_MM, INLINE);
    const valueWidth = sideWidthMm - estimateTextWidthEm(row.prefix) * row.fontSizeMm;
    expect(countLines(row.value, size, valueWidth)).toBe(1);
    expect(size).toBeGreaterThanOrEqual(row.fontSizeMm * 0.6);
  });

  test('still wraps ordinary text that would need a big shrink', () => {
    const row = { prefix: '备注：', value: '这是一段写给仓库的备注文字', fontSizeMm: 3 };
    const [size = 0] = fitRowFontSizes([row], 29, SIDE_HEIGHT_MM, INLINE);
    expect(size).toBe(3);
  });

  test('lets long text wrap and uses as much of the height as it can', () => {
    const value = '这是一段很长的原样打印内容'.repeat(8);
    const row = { prefix: '内容：', value, fontSizeMm: 3 };
    const [size = 0] = fitRowFontSizes([row], SIDE_WIDTH_MM, SIDE_HEIGHT_MM, INLINE);
    expect(size).toBeGreaterThan(TEMPLATE_LIMITS.fontSizeMm.min);
    const valueWidth = (fontSize: number) => SIDE_WIDTH_MM - estimateTextWidthEm('内容：') * fontSize;
    expect(textHeightMm(value, size, valueWidth(size))).toBeLessThanOrEqual(SIDE_HEIGHT_MM);
    // 再大 0.1mm 就放不下：用满了高度。
    expect(textHeightMm(value, size + 0.1, valueWidth(size + 0.1))).toBeGreaterThan(SIDE_HEIGHT_MM);
  });

  test('scales every row down together when they do not fit the height', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      prefix: `字段${index}：`,
      value: '内容比较长的一行文字内容',
      fontSizeMm: 4,
    }));
    const sizes = fitRowFontSizes(rows, SIDE_WIDTH_MM, SIDE_HEIGHT_MM, INLINE);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeLessThan(4);
  });

  test('gives every row the same size when asked to', () => {
    const rows = [
      { prefix: '订单号：', value: 'A2026-0001', fontSizeMm: 3 },
      { prefix: '款号：', value: 'CL5640', fontSizeMm: 3 },
    ];
    const [first, second] = fitRowFontSizes(rows, SIDE_WIDTH_MM, SIDE_HEIGHT_MM, { ...INLINE, uniform: true });
    expect(first).toBeLessThan(3);
    expect(second).toBe(first);
  });

  test('stacked rows give the value the full width and count the name line in the height', () => {
    const row = { prefix: '订单号', value: 'A20260928-00001', fontSizeMm: 3 };
    const [stacked = 0] = fitRowFontSizes([row], SIDE_WIDTH_MM, SIDE_HEIGHT_MM, { ...INLINE, arrangement: 'stacked' });
    const [inline = 0] = fitRowFontSizes([row], SIDE_WIDTH_MM, SIDE_HEIGHT_MM, INLINE);
    expect(stacked).toBeGreaterThanOrEqual(inline);

    const tall = Array.from({ length: 6 }, () => row);
    const sizes = fitRowFontSizes(tall, SIDE_WIDTH_MM, SIDE_HEIGHT_MM, { ...INLINE, arrangement: 'stacked' });
    const rowHeight = (size: number) =>
      textHeightMm(row.prefix, size * STACKED_PREFIX_SCALE, SIDE_WIDTH_MM) +
      textHeightMm(row.value, size, SIDE_WIDTH_MM);
    const height = sizes.reduce((sum, size) => sum + rowHeight(size), 0);
    expect(height).toBeLessThanOrEqual(SIDE_HEIGHT_MM + 0.5);
  });
});
