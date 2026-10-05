import { describe, expect, test } from 'bun:test';
import { parsePdfLayout, parsePdfPrintRequest } from './parse-pdf-request';
import type { PdfLayout } from './pdf-model';

const LAYOUT: PdfLayout = { paperKey: '100x150', crop: 'split', boxes: [], mono: 'threshold', threshold: 128 };
const BOX = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
const RUN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('parsePdfLayout', () => {
  test('accepts a valid layout and copies it', () => {
    const manual: PdfLayout = { ...LAYOUT, crop: 'manual', boxes: [BOX] };
    expect(parsePdfLayout(LAYOUT)).toEqual(LAYOUT);
    const parsed = parsePdfLayout(manual);
    expect(parsed).toEqual(manual);
    expect(parsed?.boxes[0]).not.toBe(BOX);
  });

  test('refuses unknown papers, modes and thresholds', () => {
    expect(parsePdfLayout({ ...LAYOUT, paperKey: '100x999' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'zoom' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, mono: 'gray' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, threshold: 0 })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, threshold: 128.5 })).toBeNull();
    expect(parsePdfLayout('x')).toBeNull();
    expect(parsePdfLayout([LAYOUT])).toBeNull();
  });

  test('needs at least one box to crop by hand, and sane boxes', () => {
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: [{ ...BOX, x: 0.8 }] })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: [{ ...BOX, width: 0.01 }] })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: [{ ...BOX, y: Number.NaN }] })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: new Array(13).fill(BOX) })).toBeNull();
  });
});

describe('parsePdfPrintRequest', () => {
  const REQUEST = { runId: RUN_ID, pieceIds: ['1-2', '1-1'], copies: 2 };

  test('accepts a valid request', () => {
    expect(parsePdfPrintRequest(REQUEST)).toEqual(REQUEST);
  });

  test('refuses bad ids, repeats, empty lists and copy counts out of range', () => {
    const tooMany = Array.from({ length: 1001 }, (_, index) => `1-${index + 1}`);
    expect(parsePdfPrintRequest({ ...REQUEST, runId: 'x' })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: [] })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: ['1-1', '1-1'] })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: ['0-1'] })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: tooMany })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, copies: 0 })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, copies: 100 })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, copies: 1.5 })).toBeNull();
  });
});
