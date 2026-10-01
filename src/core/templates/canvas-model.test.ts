import { describe, expect, test } from 'bun:test';
import { BARCODE_TYPES, barcodeType, CANVAS_ELEMENT_KINDS, newCanvasElement } from './canvas-model';

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

  test('creates every element kind with a size that fits a 60x40 label', () => {
    for (const kind of CANVAS_ELEMENT_KINDS) {
      const element = newCanvasElement(kind, 'e1', { widthMm: 60, heightMm: 40 });
      expect(element.kind).toBe(kind);
      expect(element.x + element.width).toBeLessThanOrEqual(60);
      expect(element.y + element.height).toBeLessThanOrEqual(40);
    }
  });
});
