import { MAX_MONO_SIDE } from '../pdf/mono-pack';
import { PDF_LIMITS } from '../pdf/pdf-model';
import type { GrayImage } from '../templates/mono-image';

/**
 * PWG Raster（PWG 5102.4，Windows 的 IPP 类驱动发它）和 Apple Raster（URF，系统自带的打印发它）→ 一页页灰度图。
 * 输入来自局域网，不可信：页数、边长、像素数都有上限；输出大小由页头决定，行程编码越界、数据不完整都抛 RasterError。
 * 用生成器一页一页给出，同一时刻只占一页的内存。
 */

export const RASTER_LIMITS = {
  /** 边长 8192 点：和 PDF 打印的黑白位图一样（120×220mm 在 600dpi 下也只有 5197 点）。 */
  side: MAX_MONO_SIDE,
  /** 一页 1600 万像素：和 PDF 渲染的上限一致。 */
  pagePixels: PDF_LIMITS.pagePixels,
  /** 200 页：和 PDF 打印一致。 */
  pages: PDF_LIMITS.pages,
  /** 分辨率 72–2400dpi：打印机常见 203、300、600；这个范围外的多半是坏数据。 */
  minDpi: 72,
  maxDpi: 2400,
} as const;

/**
 * 一个任务一共最多解出 2 亿像素：200 页 100×150mm 在 203dpi 下约 1.9 亿；再多就是故意的（几百 KB 的行程编码能写出几十亿像素），
 * 解码虽然不在主进程里，也不能让渲染页一直算下去。
 */
export const MAX_RASTER_JOB_PIXELS = 200_000_000;
/** 一页的长、短边最多是纸在打印机分辨率下的 2 倍：我们只声明了这一种纸和这台打印机的分辨率，客户端照着它出光栅。 */
const PAGE_TO_PAPER_FACTOR = 2;
const MM_PER_INCH = 25.4;

/** 一个任务的光栅限制（按这台共享打印机的纸和分辨率算）。 */
export interface RasterJobLimits {
  /** 每页任一边最多多少点。 */
  maxSideDots: number;
  /** 整个任务一共最多解出多少像素。 */
  maxTotalPixels: number;
}

/** 不知道纸的时候（测试、只看格式）：只有通用的上限。 */
const UNBOUNDED_JOB: RasterJobLimits = { maxSideDots: MAX_MONO_SIDE, maxTotalPixels: MAX_RASTER_JOB_PIXELS };

/** 这张纸、这台打印机的光栅限制：页面任一边不超过纸的长边在打印机分辨率下的 2 倍。 */
export function rasterJobLimits(paper: { widthMm: number; heightMm: number }, printerDpi: number): RasterJobLimits {
  const longMm = Math.max(paper.widthMm, paper.heightMm);
  return {
    maxSideDots: Math.min(MAX_MONO_SIDE, Math.ceil((longMm / MM_PER_INCH) * printerDpi * PAGE_TO_PAPER_FACTOR)),
    maxTotalPixels: MAX_RASTER_JOB_PIXELS,
  };
}

/** 一页：灰度（0 黑 – 255 白）和它的分辨率。 */
export interface RasterPage {
  image: GrayImage;
  dpi: number;
}

/** 光栅数据坏了或用了程序没声明的类型。 */
export class RasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RasterError';
  }
}

/** 'RaS2'：PWG Raster 的同步字（大端）。 */
const PWG_SYNC = [0x52, 0x61, 0x53, 0x32] as const;
/** CUPS v2 页头的大小和要看的几项的偏移（cups_page_header2_t，大端 32 位整数）。 */
const PWG_HEADER_BYTES = 1796;
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
/** CUPS 的颜色空间：18 = sGray，19 = sRGB；颜色顺序 0 = 每个像素的各色挨着放（chunky）。 */
const CUPS_SGRAY = 18;
const CUPS_SRGB = 19;
const CUPS_ORDER_CHUNKED = 0;
const BITS_PER_COLOR = 8;
/** 'UNIRAST\0' + 4 字节页数；每页 32 字节页头。 */
const URF_MAGIC = [0x55, 0x4e, 0x49, 0x52, 0x41, 0x53, 0x54, 0x00] as const;
const URF_FILE_HEADER_BYTES = 12;
const URF_PAGE_HEADER_BYTES = 32;
const URF_OFFSETS = { bitsPerPixel: 0, colorSpace: 1, width: 12, height: 16, dpi: 20 } as const;
/** Apple Raster 的颜色空间编号（CUPS 的 rawcspace 表）：0 = sGray、4 = W（灰度），1 = sRGB、5 = RGB。 */
const URF_GRAY_SPACES: ReadonlySet<number> = new Set([0, 4]);
const URF_RGB_SPACES: ReadonlySet<number> = new Set([1, 5]);
const GRAY_BITS = 8;
const RGB_BITS = 24;
const RGB_BYTES = 3;
/** 行程编码的控制字节：0–127 重复下一个像素 n+1 次；128 这一行剩下的填白；129–255 跟着 257−n 个原样像素。 */
const MAX_REPEAT_CODE = 127;
const CLEAR_TO_END = 128;
const LITERAL_BASE = 257;
const WHITE = 0xff;
/** BT.601 的亮度权重（千分之）：和 PDF 渲染页的 rgbaToGray 一致。 */
const LUMA = { red: 299, green: 587, blue: 114, total: 1000 } as const;

interface PageFormat {
  width: number;
  height: number;
  dpi: number;
  bytesPerPixel: 1 | 3;
}

/** 顺序读字节；越过末尾说明数据不完整。 */
class Cursor {
  constructor(
    private readonly data: Uint8Array,
    private offset: number,
  ) {}

  get remaining(): number {
    return this.data.length - this.offset;
  }

  u8(): number {
    if (this.offset >= this.data.length) {
      throw new RasterError('the raster data ends early');
    }
    const value = this.data[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.data.length) {
      throw new RasterError('the raster data ends early');
    }
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  return data.length >= magic.length && magic.every((value, index) => data[index] === value);
}

function checkPage(format: PageFormat): void {
  const { width, height, dpi } = format;
  if (width < 1 || height < 1 || width > RASTER_LIMITS.side || height > RASTER_LIMITS.side) {
    throw new RasterError(`a page of ${width}×${height} dots is out of range`);
  }
  if (width * height > RASTER_LIMITS.pagePixels) {
    throw new RasterError(`a page of ${width}×${height} dots has too many pixels`);
  }
  if (dpi < RASTER_LIMITS.minDpi || dpi > RASTER_LIMITS.maxDpi) {
    throw new RasterError(`a resolution of ${dpi}dpi is out of range`);
  }
}

/**
 * 一页页解：先看页头（这张纸的边长上限、整个任务的像素上限都在分配内存、解码之前核对），再解这一页。
 * 几百 KB 的行程编码能写出几十亿像素：超过上限的在页头就拒绝，不先解出来再说。
 */
function* readPages(
  cursor: Cursor,
  headerBytes: number,
  parseHeader: (header: Uint8Array) => PageFormat,
  limits: RasterJobLimits,
): Generator<RasterPage> {
  let pages = 0;
  let pixels = 0;
  while (cursor.remaining > 0) {
    if (pages >= RASTER_LIMITS.pages) {
      throw new RasterError(`more than ${RASTER_LIMITS.pages} pages`);
    }
    const format = parseHeader(cursor.take(headerBytes));
    if (format.width > limits.maxSideDots || format.height > limits.maxSideDots) {
      throw new RasterError(`a page of ${format.width}×${format.height} dots is far bigger than the paper`);
    }
    pixels += format.width * format.height;
    if (pixels > limits.maxTotalPixels) {
      throw new RasterError(`the job decodes to more than ${limits.maxTotalPixels} pixels`);
    }
    pages += 1;
    yield { image: decodePage(cursor, format), dpi: format.dpi };
  }
  if (pages === 0) {
    throw new RasterError('the raster has no pages');
  }
}

/** PWG 5102.4：'RaS2'，然后每页一个 1796 字节的页头和压缩数据，直到文件末尾。 */
export function readPwgRaster(data: Uint8Array, limits: RasterJobLimits = UNBOUNDED_JOB): Generator<RasterPage> {
  if (!startsWith(data, PWG_SYNC)) {
    throw new RasterError('not a PWG raster stream');
  }
  return readPages(new Cursor(data, PWG_SYNC.length), PWG_HEADER_BYTES, pwgFormat, limits);
}

function pwgFormat(header: Uint8Array): PageFormat {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const field = (offset: number) => view.getUint32(offset);
  const bitsPerPixel = field(PWG_OFFSETS.bitsPerPixel);
  const colorSpace = field(PWG_OFFSETS.colorSpace);
  const isGray = bitsPerPixel === GRAY_BITS && colorSpace === CUPS_SGRAY;
  const isRgb = bitsPerPixel === RGB_BITS && colorSpace === CUPS_SRGB;
  if (field(PWG_OFFSETS.bitsPerColor) !== BITS_PER_COLOR || !(isGray || isRgb)) {
    throw new RasterError(`unsupported PWG color space ${colorSpace} at ${bitsPerPixel} bits per pixel`);
  }
  if (field(PWG_OFFSETS.colorOrder) !== CUPS_ORDER_CHUNKED) {
    throw new RasterError('only chunky color order is supported');
  }
  const format: PageFormat = {
    width: field(PWG_OFFSETS.width),
    height: field(PWG_OFFSETS.height),
    dpi: field(PWG_OFFSETS.resolutionX),
    bytesPerPixel: isGray ? 1 : RGB_BYTES,
  };
  if (field(PWG_OFFSETS.resolutionY) !== format.dpi) {
    throw new RasterError('the horizontal and vertical resolutions differ');
  }
  if (field(PWG_OFFSETS.bytesPerLine) !== format.width * format.bytesPerPixel) {
    throw new RasterError('bytes per line do not match the width');
  }
  checkPage(format);
  return format;
}

/** Apple Raster：'UNIRAST\0' + 页数，然后每页一个 32 字节的页头和压缩数据。 */
export function readUrf(data: Uint8Array, limits: RasterJobLimits = UNBOUNDED_JOB): Generator<RasterPage> {
  if (!startsWith(data, URF_MAGIC) || data.length < URF_FILE_HEADER_BYTES) {
    throw new RasterError('not an Apple raster stream');
  }
  const declared = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(URF_MAGIC.length);
  if (declared > RASTER_LIMITS.pages) {
    throw new RasterError(`the raster declares ${declared} pages`);
  }
  return readPages(new Cursor(data, URF_FILE_HEADER_BYTES), URF_PAGE_HEADER_BYTES, urfFormat, limits);
}

function urfFormat(header: Uint8Array): PageFormat {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const bitsPerPixel = header[URF_OFFSETS.bitsPerPixel] ?? 0;
  const colorSpace = header[URF_OFFSETS.colorSpace] ?? 0;
  const isGray = bitsPerPixel === GRAY_BITS && URF_GRAY_SPACES.has(colorSpace);
  const isRgb = bitsPerPixel === RGB_BITS && URF_RGB_SPACES.has(colorSpace);
  if (!(isGray || isRgb)) {
    throw new RasterError(`unsupported Apple raster color space ${colorSpace} at ${bitsPerPixel} bits per pixel`);
  }
  const format: PageFormat = {
    width: view.getUint32(URF_OFFSETS.width),
    height: view.getUint32(URF_OFFSETS.height),
    dpi: view.getUint32(URF_OFFSETS.dpi),
    bytesPerPixel: isGray ? 1 : RGB_BYTES,
  };
  checkPage(format);
  return format;
}

/** 解一页：每行先读重复次数，再解一行，转灰度后按次数写进去（不超过页高）。 */
function decodePage(cursor: Cursor, format: PageFormat): GrayImage {
  const { width, height, bytesPerPixel } = format;
  const line = new Uint8Array(width * bytesPerPixel);
  const grayLine = new Uint8Array(width);
  const pixels = new Uint8Array(width * height);
  let y = 0;
  while (y < height) {
    const repeat = cursor.u8() + 1;
    decodeLine(cursor, line, bytesPerPixel);
    toGray(line, grayLine, bytesPerPixel);
    for (let copy = 0; copy < repeat && y < height; copy += 1) {
      pixels.set(grayLine, y * width);
      y += 1;
    }
  }
  return { width, height, pixels };
}

function decodeLine(cursor: Cursor, line: Uint8Array, bytesPerPixel: number): void {
  let at = 0;
  while (at < line.length) {
    const code = cursor.u8();
    if (code === CLEAR_TO_END) {
      line.fill(WHITE, at);
      return;
    }
    const count = (code <= MAX_REPEAT_CODE ? code + 1 : LITERAL_BASE - code) * bytesPerPixel;
    if (at + count > line.length) {
      throw new RasterError('a run goes past the end of a line');
    }
    if (code <= MAX_REPEAT_CODE) {
      const pixel = cursor.take(bytesPerPixel);
      for (let offset = 0; offset < count; offset += bytesPerPixel) {
        line.set(pixel, at + offset);
      }
    } else {
      line.set(cursor.take(count), at);
    }
    at += count;
  }
}

function toGray(line: Uint8Array, gray: Uint8Array, bytesPerPixel: number): void {
  if (bytesPerPixel === 1) {
    gray.set(line);
    return;
  }
  for (let x = 0; x < gray.length; x += 1) {
    const at = x * bytesPerPixel;
    const red = line[at] ?? WHITE;
    const green = line[at + 1] ?? WHITE;
    const blue = line[at + 2] ?? WHITE;
    gray[x] = Math.round((red * LUMA.red + green * LUMA.green + blue * LUMA.blue) / LUMA.total);
  }
}
