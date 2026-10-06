import { describe, expect, test } from 'bun:test';
import {
  BARCODE_TYPES,
  barcodeGroups,
  barcodeType,
  CANVAS_ELEMENT_KINDS,
  CANVAS_ELEMENT_LABELS,
  newCanvasElement,
  snapBorderDots,
} from './canvas-model';

const DOT = 25.4 / 203;

describe('canvas model', () => {
  test('lists the ten common barcode types first', () => {
    expect(BARCODE_TYPES.filter((type) => type.common).map((type) => type.id)).toEqual([
      'code128',
      'ean13',
      'ean8',
      'upca',
      'upce',
      'code39',
      'code93',
      'itf14',
      'rationalizedCodabar',
      'gs1-128',
    ]);
  });

  test('has unique barcode ids and knows 1D from 2D', () => {
    const ids = BARCODE_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(barcodeType('datamatrix')?.dimensions).toBe(2);
    expect(barcodeType('ean13')?.dimensions).toBe(1);
    expect(barcodeType('nope')).toBeNull();
  });

  test('barcodeGroups lists every barcode type exactly once', () => {
    const groups = barcodeGroups();
    const listed = groups.flatMap((group) => group.types.map((type) => type.id));
    expect(listed.sort()).toEqual([...BARCODE_TYPES.map((type) => type.id)].sort());
    expect(new Set(listed).size).toBe(listed.length);
    // 二维码也要被 !common 过滤，不然将来加一种常用的二维码会在「更多二维码」里重复出现。
    const moreQr = groups.find((group) => group.label === '更多二维码');
    expect(moreQr?.types.every((type) => !type.common)).toBe(true);
  });

  test('creates every element kind with a size that fits a 60x40 label', () => {
    for (const kind of CANVAS_ELEMENT_KINDS) {
      const element = newCanvasElement(kind, 'e1', { widthMm: 60, heightMm: 40 });
      expect(element.kind).toBe(kind);
      expect(element.x + element.width).toBeLessThanOrEqual(60);
      expect(element.y + element.height).toBeLessThanOrEqual(40);
    }
  });

  test('names a new element after its kind', () => {
    for (const kind of CANVAS_ELEMENT_KINDS) {
      expect(newCanvasElement(kind, 'e1', { widthMm: 60, heightMm: 40 }).name).toBe(CANVAS_ELEMENT_LABELS[kind]);
    }
  });

  // {完整内容} 常带中文，一维码编不了，新加的条码一上来就是「不印」；{编码} 是识别规则里最常见、只有字母数字的字段。
  test('binds a new barcode to the code field', () => {
    const barcode = newCanvasElement('barcode', 'e1', { widthMm: 60, heightMm: 40 });
    expect(barcode.kind === 'barcode' && barcode.value).toBe('{编码}');
  });

  describe('snapBorderDots', () => {
    test('has no border at zero or less', () => {
      expect(snapBorderDots(0, DOT)).toBe(0);
      expect(snapBorderDots(-1, DOT)).toBe(0);
    });

    test('keeps at least one dot for any positive border, even one far thinner than a dot', () => {
      // 0.01mm 在 203dpi（一点约 0.125mm）上四舍五入会降到 0 点：边框必须至少给 1 个点，不能时有时无。
      expect(snapBorderDots(0.01, DOT)).toBe(1);
    });

    test('rounds an ordinary border to the nearest whole dot', () => {
      expect(snapBorderDots(2, DOT)).toBe(Math.round(2 / DOT));
    });
  });
});
