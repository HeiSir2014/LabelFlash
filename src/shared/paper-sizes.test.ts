import { describe, expect, test } from 'bun:test';
import {
  findPreset,
  formatPaperName,
  isSamePaper,
  PAPER_LIMITS_MM,
  PAPER_PRESETS,
  paperKey,
  parsePaperKey,
  sanitizePaper,
} from './paper-sizes';

describe('paperKey', () => {
  test('writes width x height without trailing zeros', () => {
    expect(paperKey({ widthMm: 60, heightMm: 40 })).toBe('60x40');
    expect(paperKey({ widthMm: 100, heightMm: 177 })).toBe('100x177');
    expect(paperKey({ widthMm: 76.5, heightMm: 130 })).toBe('76.5x130');
  });

  test('reads a key back into a paper size', () => {
    expect(parsePaperKey('100x180')).toEqual({ widthMm: 100, heightMm: 180 });
    expect(parsePaperKey('76.5x130')).toEqual({ widthMm: 76.5, heightMm: 130 });
  });

  test('rejects keys that are not a paper size', () => {
    expect(parsePaperKey('100×180')).toBeNull();
    expect(parsePaperKey('0x40')).toBeNull();
    expect(parsePaperKey('abc')).toBeNull();
  });
});

describe('presets', () => {
  test('cover the courier waybill sizes with their default cut points', () => {
    expect(findPreset({ widthMm: 100, heightMm: 177 })?.parts).toEqual([107, 70]);
    expect(findPreset({ widthMm: 100, heightMm: 180 })?.parts).toEqual([110, 70]);
    expect(findPreset({ widthMm: 76, heightMm: 130 })?.parts).toEqual([]);
  });

  test('every preset fits the limits and its parts add up to its height', () => {
    for (const preset of PAPER_PRESETS) {
      expect(preset.widthMm).toBeGreaterThanOrEqual(PAPER_LIMITS_MM.width.min);
      expect(preset.widthMm).toBeLessThanOrEqual(PAPER_LIMITS_MM.width.max);
      expect(preset.heightMm).toBeGreaterThanOrEqual(PAPER_LIMITS_MM.height.min);
      expect(preset.heightMm).toBeLessThanOrEqual(PAPER_LIMITS_MM.height.max);
      if (preset.parts.length > 0) {
        expect(preset.parts.reduce((sum, part) => sum + part, 0)).toBe(preset.heightMm);
      }
    }
  });

  test('include the 30x20 label for jewellery and small goods', () => {
    expect(formatPaperName({ widthMm: 30, heightMm: 20 })).toBe('30×20 标签');
    expect(parsePaperKey('30x20')).toEqual({ widthMm: 30, heightMm: 20 });
  });

  test('keys are unique', () => {
    const keys = PAPER_PRESETS.map(paperKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('formatPaperName', () => {
  test('uses the preset name, or the size for a custom paper', () => {
    expect(formatPaperName({ widthMm: 60, heightMm: 40 })).toBe('60×40 标签');
    expect(formatPaperName({ widthMm: 88, heightMm: 55 })).toBe('88×55');
  });
});

describe('sanitizePaper', () => {
  const fallback = { widthMm: 60, heightMm: 40 };

  test('keeps a valid size and rounds to 0.1mm', () => {
    expect(sanitizePaper({ widthMm: 100.04, heightMm: 150 }, fallback)).toEqual({ widthMm: 100, heightMm: 150 });
  });

  // 最小的常用热敏标签：珠宝、小商品的 30×20。
  test('keeps a 30x20 label', () => {
    expect(sanitizePaper({ widthMm: 30, heightMm: 20 }, fallback)).toEqual({ widthMm: 30, heightMm: 20 });
  });

  test('falls back when the size is missing or out of range', () => {
    expect(sanitizePaper(undefined, fallback)).toEqual(fallback);
    expect(sanitizePaper({ widthMm: 20, heightMm: 40 }, fallback)).toEqual(fallback);
    expect(sanitizePaper({ widthMm: 100, heightMm: 999 }, fallback)).toEqual(fallback);
  });

  // 返回的是新对象：调用方改了它，不会改到别的模板共用的缺省纸张。
  test('never hands out the fallback object itself', () => {
    expect(sanitizePaper(undefined, fallback)).not.toBe(fallback);
  });
});

describe('isSamePaper', () => {
  // 驱动以 0.1mm 为单位保存纸张，四舍五入后可能差零点几毫米。
  test('treats sizes within 1mm as the same paper', () => {
    expect(isSamePaper({ widthMm: 60.4, heightMm: 39.8 }, { widthMm: 60, heightMm: 40 })).toBe(true);
    expect(isSamePaper({ widthMm: 100, heightMm: 177 }, { widthMm: 100, heightMm: 180 })).toBe(false);
  });

  test('treats swapped width and height as a different paper', () => {
    expect(isSamePaper({ widthMm: 40, heightMm: 60 }, { widthMm: 60, heightMm: 40 })).toBe(false);
  });
});
