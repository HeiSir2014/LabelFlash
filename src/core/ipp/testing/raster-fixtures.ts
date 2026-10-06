/**
 * 测试用：按 PWG 5102.4 和 Apple Raster 的格式写出光栅文件（行程编码和 CUPS 的解压互为逆过程）。
 * 只在测试里用，主程序只解不编。
 */

/** 一页：每个像素 bytesPerPixel 个字节，逐行。 */
export interface FixturePage {
  width: number;
  height: number;
  dpi: number;
  bytesPerPixel: 1 | 3;
  pixels: Uint8Array;
}

export const PWG_HEADER_BYTES = 1796;
/** CUPS 的颜色空间编号：18 = sGray，19 = sRGB；3 = K（黑，本程序不收）。 */
export const CUPS_SGRAY = 18;
export const CUPS_SRGB = 19;
/** 一个包最多 128 个像素。 */
const MAX_PACKET_PIXELS = 128;
const LITERAL_BASE = 257;
const BITS_PER_BYTE = 8;
const GRAY_MID = 128;
const WHITE = 255;
/** Apple Raster 页头的大小和几项的位置；颜色空间 0 = sGray，1 = sRGB；单面、普通质量。 */
const URF_PAGE_HEADER_BYTES = 32;
const URF_DUPLEX_NONE = 1;
const URF_QUALITY_NORMAL = 4;
const URF_OFFSETS = { width: 12, height: 16, dpi: 20 } as const;
/** CUPS v2 页头里几项的偏移（和 raster.ts 一致）。 */
const PWG_OFFSETS = {
  resolutionX: 276,
  resolutionY: 280,
  width: 372,
  height: 376,
  bitsPerColor: 384,
  bitsPerPixel: 388,
  bytesPerLine: 392,
  colorOrder: 396,
  colorSpace: 400,
} as const;

export interface PwgHeaderFields {
  width: number;
  height: number;
  dpi: number;
  /** 不给时等于 dpi；给了就是横竖不同的分辨率。 */
  dpiY?: number;
  bitsPerPixel: number;
  colorSpace: number;
  bytesPerLine?: number;
  bitsPerColor?: number;
  colorOrder?: number;
}

/** 1796 字节的 CUPS v2 页头，只填解码要看的几项。 */
export function pwgHeader(fields: PwgHeaderFields): Uint8Array {
  const header = new Uint8Array(PWG_HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('PwgRaster'), 0);
  view.setUint32(PWG_OFFSETS.resolutionX, fields.dpi);
  view.setUint32(PWG_OFFSETS.resolutionY, fields.dpiY ?? fields.dpi);
  view.setUint32(PWG_OFFSETS.width, fields.width);
  view.setUint32(PWG_OFFSETS.height, fields.height);
  view.setUint32(PWG_OFFSETS.bitsPerColor, fields.bitsPerColor ?? BITS_PER_BYTE);
  view.setUint32(PWG_OFFSETS.bitsPerPixel, fields.bitsPerPixel);
  view.setUint32(PWG_OFFSETS.bytesPerLine, fields.bytesPerLine ?? (fields.width * fields.bitsPerPixel) / BITS_PER_BYTE);
  view.setUint32(PWG_OFFSETS.colorOrder, fields.colorOrder ?? 0);
  view.setUint32(PWG_OFFSETS.colorSpace, fields.colorSpace);
  return header;
}

/** Apple Raster 的 32 字节页头：位深、颜色空间（0 = sGray，1 = sRGB）、单面、普通质量、宽、高、分辨率。 */
export function urfHeader(fields: {
  width: number;
  height: number;
  dpi: number;
  bitsPerPixel: number;
  colorSpace: number;
}): Uint8Array {
  const header = new Uint8Array(URF_PAGE_HEADER_BYTES);
  const view = new DataView(header.buffer);
  header[0] = fields.bitsPerPixel;
  header[1] = fields.colorSpace;
  header[2] = URF_DUPLEX_NONE;
  header[3] = URF_QUALITY_NORMAL;
  view.setUint32(URF_OFFSETS.width, fields.width);
  view.setUint32(URF_OFFSETS.height, fields.height);
  view.setUint32(URF_OFFSETS.dpi, fields.dpi);
  return header;
}

/** 一行的行程编码：相同的像素合成一段，其余原样写；每行只出现一次（行重复字节为 0）。 */
export function encodeLine(line: Uint8Array, bytesPerPixel: number): number[] {
  const width = line.length / bytesPerPixel;
  const pixelAt = (x: number) => line.subarray(x * bytesPerPixel, (x + 1) * bytesPerPixel);
  const same = (a: number, b: number) => pixelAt(a).every((value, index) => value === pixelAt(b)[index]);
  const out: number[] = [0];
  let x = 0;
  while (x < width) {
    let run = 1;
    while (x + run < width && run < MAX_PACKET_PIXELS && same(x, x + run)) {
      run += 1;
    }
    if (run >= 2 || x + 1 === width) {
      out.push(run - 1, ...pixelAt(x));
      x += run;
      continue;
    }
    let literal = 1;
    while (
      x + literal < width &&
      literal < MAX_PACKET_PIXELS &&
      !(x + literal + 1 < width && same(x + literal, x + literal + 1))
    ) {
      literal += 1;
    }
    if (literal === 1) {
      out.push(0, ...pixelAt(x));
    } else {
      out.push(LITERAL_BASE - literal, ...line.subarray(x * bytesPerPixel, (x + literal) * bytesPerPixel));
    }
    x += literal;
  }
  return out;
}

function encodePage(page: FixturePage): number[] {
  const lineBytes = page.width * page.bytesPerPixel;
  const out: number[] = [];
  for (let y = 0; y < page.height; y += 1) {
    for (const byte of encodeLine(page.pixels.subarray(y * lineBytes, (y + 1) * lineBytes), page.bytesPerPixel)) {
      out.push(byte);
    }
  }
  return out;
}

function append(parts: number[], bytes: Iterable<number>): void {
  for (const byte of bytes) {
    parts.push(byte);
  }
}

/** 'RaS2' + 每页（页头 + 数据）。 */
export function pwgRaster(pages: readonly FixturePage[]): Uint8Array {
  const parts: number[] = [...new TextEncoder().encode('RaS2')];
  for (const page of pages) {
    const header = pwgHeader({
      width: page.width,
      height: page.height,
      dpi: page.dpi,
      bitsPerPixel: page.bytesPerPixel * BITS_PER_BYTE,
      colorSpace: page.bytesPerPixel === 1 ? CUPS_SGRAY : CUPS_SRGB,
    });
    append(parts, header);
    append(parts, encodePage(page));
  }
  return Uint8Array.from(parts);
}

/** 'UNIRAST\0' + 页数 + 每页（页头 + 数据）。 */
export function urfRaster(pages: readonly FixturePage[]): Uint8Array {
  const parts: number[] = [...new TextEncoder().encode('UNIRAST\0'), 0, 0, 0, pages.length];
  for (const page of pages) {
    const header = urfHeader({
      width: page.width,
      height: page.height,
      dpi: page.dpi,
      bitsPerPixel: page.bytesPerPixel * BITS_PER_BYTE,
      colorSpace: page.bytesPerPixel === 1 ? 0 : 1,
    });
    append(parts, header);
    append(parts, encodePage(page));
  }
  return Uint8Array.from(parts);
}

/** 一页灰度：左半黑、右半白，最后一行全灰（测试能看出行、列有没有错位）。 */
export function grayPage(width: number, height: number, dpi = 203): FixturePage {
  const pixels = new Uint8Array(width * height).fill(WHITE);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (y === height - 1) {
        pixels[y * width + x] = GRAY_MID;
      } else if (x < width / 2) {
        pixels[y * width + x] = 0;
      }
    }
  }
  return { width, height, dpi, bytesPerPixel: 1, pixels };
}
