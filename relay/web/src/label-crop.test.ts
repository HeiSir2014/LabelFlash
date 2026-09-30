import { describe, expect, test } from 'bun:test';
import { type ImageRequest, MAX_IMAGE_SIDE } from '../../../src/shared/mobile-protocol';
import { type CodeCorners, cropLabel, cropLayout, type PixelImage, squareToQuad } from './label-crop';

const REQUEST: ImageRequest = {
  area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 },
  pixelsPerCode: 20,
  frames: 1,
};

/** 一张 w×h 的画面，按 color(x, y) 上色（灰度）。 */
function frame(width: number, height: number, color: (x: number, y: number) => number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = color(x, y);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function gray(image: PixelImage, x: number, y: number): number {
  return image.data[(Math.round(y) * image.width + Math.round(x)) * 4] ?? -1;
}

describe('cropLayout', () => {
  test('sizes the crop by the area and puts the code where the area says', () => {
    expect(cropLayout(REQUEST)).toEqual({
      width: 120,
      height: 80,
      pixelsPerCode: 20,
      code: { x: 50, y: 30, size: 20 },
    });
  });

  test('scales down to the side limit', () => {
    const layout = cropLayout({ ...REQUEST, pixelsPerCode: 400 });
    // 区域宽 6 个、高 4 个二维码边长：按宽度缩到上限。
    expect(layout.width).toBe(MAX_IMAGE_SIDE);
    expect(layout.height).toBeCloseTo((MAX_IMAGE_SIDE * 4) / 6, 0);
    expect(layout.code.size).toBeCloseTo(MAX_IMAGE_SIDE / 6, 5);
  });
});

describe('squareToQuad', () => {
  test('maps the unit square onto the corners of the code', () => {
    const corners: CodeCorners = {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 300, y: 120 },
      bottomRight: { x: 290, y: 330 },
      bottomLeft: { x: 90, y: 300 },
    };
    const map = squareToQuad(corners);
    if (!map) throw new Error('expected a transform');
    for (const [u, v, point] of [
      [0, 0, corners.topLeft],
      [1, 0, corners.topRight],
      [1, 1, corners.bottomRight],
      [0, 1, corners.bottomLeft],
    ] as const) {
      expect(map(u, v).x).toBeCloseTo(point.x, 6);
      expect(map(u, v).y).toBeCloseTo(point.y, 6);
    }
  });

  test('refuses corners on one line', () => {
    const point = { x: 1, y: 1 };
    expect(squareToQuad({ topLeft: point, topRight: point, bottomRight: point, bottomLeft: point })).toBeNull();
  });
});

describe('cropLabel', () => {
  // 画面里二维码占 (100,100)–(200,200)，二维码左上角那一格涂黑，二维码正下方一条（字所在的地方）涂成 50。
  const upright = frame(400, 400, (x, y) => {
    if (x >= 100 && x < 125 && y >= 100 && y < 125) return 0;
    if (x >= 100 && x < 200 && y >= 210 && y < 250) return 50;
    return 200;
  });

  test('puts the code and the text below it where the layout says', () => {
    const crop = cropLabel(
      upright,
      {
        topLeft: { x: 100, y: 100 },
        topRight: { x: 200, y: 100 },
        bottomRight: { x: 200, y: 200 },
        bottomLeft: { x: 100, y: 200 },
      },
      REQUEST,
    );
    if (!crop) throw new Error('expected a crop');
    const { code } = cropLayout(REQUEST);
    expect(gray(crop, code.x + 2, code.y + 2)).toBe(0);
    expect(gray(crop, code.x + code.size / 2, code.y + code.size * 1.3)).toBe(50);
    expect(gray(crop, code.x + code.size / 2, code.y + code.size / 2)).toBe(200);
  });

  // 同一张标签顺时针转了 90° 拍：按二维码自己的四个角截出来，结果还是正的。
  test('turns a label photographed on its side upright', () => {
    const rotated = frame(400, 400, (x, y) => gray(upright, y, 399 - x));
    const crop = cropLabel(
      rotated,
      {
        topLeft: { x: 300, y: 100 },
        topRight: { x: 300, y: 200 },
        bottomRight: { x: 200, y: 200 },
        bottomLeft: { x: 200, y: 100 },
      },
      REQUEST,
    );
    if (!crop) throw new Error('expected a crop');
    const { code } = cropLayout(REQUEST);
    expect(gray(crop, code.x + 2, code.y + 2)).toBe(0);
    expect(gray(crop, code.x + code.size / 2, code.y + code.size * 1.3)).toBe(50);
  });

  test('fills what the camera did not see with white', () => {
    const crop = cropLabel(
      upright,
      {
        topLeft: { x: 10, y: 10 },
        topRight: { x: 60, y: 10 },
        bottomRight: { x: 60, y: 60 },
        bottomLeft: { x: 10, y: 60 },
      },
      REQUEST,
    );
    if (!crop) throw new Error('expected a crop');
    expect(gray(crop, 0, 0)).toBe(255);
    expect(crop.data[3]).toBe(255);
  });
});
