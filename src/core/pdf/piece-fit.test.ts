import { describe, expect, test } from 'bun:test';
import { chooseTurn, cropGray, paperDots, placeOnPaper, renderPiece, rotateClockwise, thumbnail } from './piece-fit';
import { blankPage, fill } from './testing/synthetic-page';

describe('paperDots', () => {
  test('counts printer dots across the paper the same way the canvas layout does', () => {
    expect(paperDots({ widthMm: 100, heightMm: 150 }, 203)).toEqual({ width: 799, height: 1199 });
    expect(paperDots({ widthMm: 60, heightMm: 40 }, 300)).toEqual({ width: 709, height: 472 });
  });
});

describe('chooseTurn', () => {
  test('turns a landscape piece for portrait paper', () => {
    expect(chooseTurn(300, 200, 100, 150)).toBe(90);
  });

  test('keeps a piece that already fits the paper the right way up', () => {
    expect(chooseTurn(200, 300, 100, 150)).toBe(0);
  });

  // 差不多是正方形时转不转都一样大：保持原方向，免得文字无缘无故躺下。
  test('keeps a nearly square piece as it is', () => {
    expect(chooseTurn(100, 101, 100, 150)).toBe(0);
  });
});

describe('cropGray and rotateClockwise', () => {
  test('cuts a rectangle out of the page', () => {
    const page = { width: 4, height: 3, pixels: Uint8Array.from({ length: 12 }, (_, index) => index) };
    expect(cropGray(page, { x: 1, y: 1, width: 2, height: 2 })).toEqual({
      width: 2,
      height: 2,
      pixels: Uint8Array.of(5, 6, 9, 10),
    });
  });

  test('turns the image a quarter clockwise', () => {
    const image = { width: 3, height: 2, pixels: Uint8Array.of(1, 2, 3, 4, 5, 6) };
    expect(rotateClockwise(image)).toEqual({ width: 2, height: 3, pixels: Uint8Array.of(4, 1, 5, 2, 6, 3) });
  });
});

describe('placeOnPaper', () => {
  test('scales to fit, centres and fills the rest with white', () => {
    const piece = { width: 10, height: 10, pixels: new Uint8Array(100) };
    const placed = placeOnPaper(piece, { width: 20, height: 10 });
    expect(placed.width).toBe(20);
    expect([placed.pixels[4], placed.pixels[5], placed.pixels[14], placed.pixels[15]]).toEqual([255, 0, 0, 255]);
    expect(placed.pixels.filter((value) => value === 0)).toHaveLength(100);
  });
});

describe('renderPiece', () => {
  test('turns, fits and converts a piece into black dots on the paper', () => {
    // 横放的一块，左半边是黑的；纸是竖的：顺时针转过来后黑的在上半边。
    const page = fill(blankPage(60, 40), { x: 0, y: 0, width: 30, height: 40 });
    const piece = renderPiece(
      page,
      { x: 0, y: 0, width: 60, height: 40 },
      {
        dots: { width: 20, height: 30 },
        mono: 'threshold',
        threshold: 128,
      },
    );
    expect([piece.width, piece.height]).toEqual([20, 30]);
    expect([...piece.bits.subarray(0, 20)]).toEqual(new Array(20).fill(1));
    expect([...piece.bits.subarray(29 * 20)]).toEqual(new Array(20).fill(0));
  });
});

describe('thumbnail', () => {
  test('samples down to the size limit and keeps a one-dot line', () => {
    const bits = new Uint8Array(480 * 10);
    for (let y = 0; y < 10; y += 1) {
      bits[y * 480 + 1] = 1;
    }
    const small = thumbnail({ width: 480, height: 10, bits });
    expect([small.width, small.height]).toEqual([240, 5]);
    expect(small.bits[0]).toBe(1);
    expect(small.bits[1]).toBe(0);
  });

  test('leaves a small bitmap as it is', () => {
    const bitmap = { width: 2, height: 2, bits: Uint8Array.of(1, 0, 0, 1) };
    expect(thumbnail(bitmap)).toEqual(bitmap);
  });
});
