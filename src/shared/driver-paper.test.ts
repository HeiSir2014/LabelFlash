import { describe, expect, test } from 'bun:test';
import { checkDriverPaper, formatPaperSize } from './driver-paper';

describe('checkDriverPaper', () => {
  test('is unknown when the driver paper could not be read', () => {
    expect(checkDriverPaper(null)).toEqual({ status: 'unknown' });
  });

  test('accepts 60×40mm within the rounding tolerance', () => {
    expect(checkDriverPaper({ widthMm: 60, heightMm: 40, dpi: 203 }).status).toBe('ok');
    expect(checkDriverPaper({ widthMm: 60.9, heightMm: 39.2, dpi: null }).status).toBe('ok');
  });

  test('flags other sizes, including the rotated 40×60mm', () => {
    const factoryDefault = { widthMm: 76, heightMm: 130, dpi: 203 };
    expect(checkDriverPaper(factoryDefault)).toEqual({ status: 'mismatch', paper: factoryDefault });
    expect(checkDriverPaper({ widthMm: 40, heightMm: 60, dpi: 203 }).status).toBe('mismatch');
    expect(checkDriverPaper({ widthMm: 62, heightMm: 40, dpi: 203 }).status).toBe('mismatch');
  });
});

describe('formatPaperSize', () => {
  test('prints millimetres with at most one decimal', () => {
    expect(formatPaperSize({ widthMm: 76, heightMm: 130 })).toBe('76×130mm');
    expect(formatPaperSize({ widthMm: 50.8, heightMm: 25.4 })).toBe('50.8×25.4mm');
    expect(formatPaperSize({ widthMm: 60.04, heightMm: 40 })).toBe('60×40mm');
  });
});
