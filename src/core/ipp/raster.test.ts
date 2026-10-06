import { describe, expect, test } from 'bun:test';
import { RasterError, readPwgRaster, readUrf } from './raster';
import {
  CUPS_SGRAY,
  CUPS_SRGB,
  type FixturePage,
  grayPage,
  pwgHeader,
  pwgRaster,
  urfHeader,
  urfRaster,
} from './testing/raster-fixtures';

const SYNC = [...new TextEncoder().encode('RaS2')];

/** 页头 + 手写的数据。 */
function pwgWith(header: Uint8Array, data: readonly number[]): Uint8Array {
  return Uint8Array.from([...SYNC, ...header, ...data]);
}

describe('readPwgRaster', () => {
  test('decodes gray pages at their resolution', () => {
    const page = grayPage(7, 4);
    const pages = [...readPwgRaster(pwgRaster([page, grayPage(3, 2, 300)]))];
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ image: { width: 7, height: 4, pixels: page.pixels }, dpi: 203 });
    expect(pages[1]?.dpi).toBe(300);
  });

  test('turns sRGB pixels into gray the way the eye weighs them', () => {
    const page: FixturePage = {
      width: 3,
      height: 1,
      dpi: 203,
      bytesPerPixel: 3,
      pixels: Uint8Array.of(255, 0, 0, 0, 0, 0, 255, 255, 255),
    };
    const [decoded] = [...readPwgRaster(pwgRaster([page]))];
    expect([...(decoded?.image.pixels ?? [])]).toEqual([76, 0, 255]);
  });

  test('repeats lines and clears the rest of a line to white', () => {
    const header = pwgHeader({ width: 4, height: 3, dpi: 203, bitsPerPixel: 8, colorSpace: CUPS_SGRAY });
    // 第 1 行出现 2 次、整行填白；第 3 行：两个黑点，其余填白。
    const [page] = [...readPwgRaster(pwgWith(header, [1, 128, 0, 1, 0, 128]))];
    expect([...(page?.image.pixels ?? [])]).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255]);
  });

  test('refuses broken or unsupported raster', () => {
    const gray = (fields: Partial<Parameters<typeof pwgHeader>[0]> = {}) =>
      pwgHeader({ width: 4, height: 1, dpi: 203, bitsPerPixel: 8, colorSpace: CUPS_SGRAY, ...fields });
    const cases: Uint8Array[] = [
      // 不是 PWG
      new TextEncoder().encode('RaS3'),
      // 行程越过行尾（6 个像素放进 4 个）
      pwgWith(gray(), [0, 5, 0]),
      // 原样像素越过行尾
      pwgWith(gray(), [0, 251, 1, 2, 3, 4, 5, 6]),
      // 数据提前结束
      pwgWith(gray(), [0, 1]),
      // 页头不完整
      Uint8Array.from([...SYNC, 0, 0]),
      // 黑白 1 位（K），程序没声明
      pwgWith(gray({ bitsPerPixel: 1, bitsPerColor: 1, colorSpace: 3, bytesPerLine: 1 }), [0, 128]),
      // 每行字节数对不上
      pwgWith(gray({ bytesPerLine: 5 }), [0, 128]),
      // 颜色分平面存放
      pwgWith(gray({ colorOrder: 2 }), [0, 128]),
      // 横竖分辨率不同
      pwgWith(gray({ dpiY: 300 }), [0, 128]),
      // 页面太大
      pwgWith(gray({ width: 9000, bytesPerLine: 9000 }), [0, 128]),
      // 像素太多（每边都没超，乘起来超了 1600 万）
      pwgWith(gray({ width: 8000, height: 8000, bytesPerLine: 8000 }), [0, 128]),
      // 分辨率不合理
      pwgWith(gray({ dpi: 1 }), [0, 128]),
      // 一页也没有
      Uint8Array.from(SYNC),
      // sRGB 的颜色空间配 8 位
      pwgWith(gray({ colorSpace: CUPS_SRGB }), [0, 128]),
    ];
    for (const data of cases) {
      expect(() => [...readPwgRaster(data)]).toThrow(RasterError);
    }
  });

  test('refuses more than 200 pages', () => {
    const tiny = grayPage(1, 1);
    expect(() => [...readPwgRaster(pwgRaster(Array.from({ length: 201 }, () => tiny)))]).toThrow(RasterError);
  });
});

describe('readUrf', () => {
  test('decodes gray and sRGB pages', () => {
    const gray = grayPage(5, 3, 300);
    const rgb: FixturePage = {
      width: 2,
      height: 1,
      dpi: 300,
      bytesPerPixel: 3,
      pixels: Uint8Array.of(0, 0, 255, 255, 255, 255),
    };
    const pages = [...readUrf(urfRaster([gray, rgb]))];
    expect(pages[0]).toEqual({ image: { width: 5, height: 3, pixels: gray.pixels }, dpi: 300 });
    expect([...(pages[1]?.image.pixels ?? [])]).toEqual([29, 255]);
  });

  test('refuses a wrong magic, unknown color spaces and truncated pages', () => {
    const head = [...new TextEncoder().encode('UNIRAST\0'), 0, 0, 0, 1];
    const header = (colorSpace: number, bitsPerPixel = 8) => [
      ...urfHeader({ width: 2, height: 1, dpi: 300, bitsPerPixel, colorSpace }),
    ];
    const cases: Uint8Array[] = [
      new TextEncoder().encode('UNIRAS\0\0'),
      Uint8Array.from([...head, ...header(6, 32), 0, 128]),
      Uint8Array.from([...head, ...header(0), 0]),
      Uint8Array.from([...head, ...header(0).slice(0, 10)]),
      // 声明的页数超过上限
      Uint8Array.from([...new TextEncoder().encode('UNIRAST\0'), 0, 0, 0xff, 0xff]),
    ];
    for (const data of cases) {
      expect(() => [...readUrf(data)]).toThrow(RasterError);
    }
  });
});
