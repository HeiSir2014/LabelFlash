import type { ImageMode } from './canvas-model';

/**
 * 图片 → 热敏标签机能打的黑白点：只有黑和白，没有灰。全部是纯 TypeScript（不解码图片文件，见 canvas-model 的 CanvasImage），
 * 主进程和测试都能直接用。
 */

export interface GrayImage {
  width: number;
  height: number;
  /** 8 位灰度，逐行，0 黑 – 255 白。 */
  pixels: Uint8Array;
}

/** base64 的灰度像素 → 图像；宽高不是正整数，或字节数和宽高对不上（被改坏的模板）都返回 null。 */
export function decodeGray(base64: string, width: number, height: number): GrayImage | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    // 两个都是负数时乘积仍是正数，不单独守卫宽高就会被下面的长度检查误判成合法尺寸
    return null;
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length !== width * height) {
    return null;
  }
  const pixels = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pixels[index] = binary.charCodeAt(index);
  }
  return { width, height, pixels };
}

/**
 * 等比放进框里（整数像素，至少 1×1）。
 * 源或目标的宽高不是正数时（被改坏的模板数据）直接给 1×1，不算出负数或 NaN 尺寸。
 */
export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { width: 1, height: 1 };
  }
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.min(boxWidth, Math.round(sourceWidth * scale))),
    height: Math.max(1, Math.min(boxHeight, Math.round(sourceHeight * scale))),
  };
}

/** 缩放：每个目标点取它覆盖的源像素的平均值（缩小时不丢细节、不出摩尔纹），放大时就是最近邻。 */
export function resizeGray(image: GrayImage, width: number, height: number): GrayImage {
  const pixels = new Uint8Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor(y * scaleY);
    // 夹到 image.height 内：避免浮点误差把最后一行的区间算过头，读到数组外
    const bottom = Math.min(image.height, Math.max(top + 1, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor(x * scaleX);
      const right = Math.min(image.width, Math.max(left + 1, Math.floor((x + 1) * scaleX)));
      let sum = 0;
      for (let sy = top; sy < bottom; sy += 1) {
        // 按行取子数组再用 for...of 读值：子数组的长度本身就保证了下标有效，不用再额外判断
        const rowStart = sy * image.width + left;
        const row = image.pixels.subarray(rowStart, rowStart + (right - left));
        for (const value of row) {
          sum += value;
        }
      }
      pixels[y * width + x] = Math.round(sum / ((bottom - top) * (right - left)));
    }
  }
  return { width, height, pixels };
}

/** Floyd–Steinberg 误差扩散的权重（右、左下、下、右下，分母 16）。 */
const DITHER_WEIGHTS = [
  { dx: 1, dy: 0, weight: 7 },
  { dx: -1, dy: 1, weight: 3 },
  { dx: 0, dy: 1, weight: 5 },
  { dx: 1, dy: 1, weight: 1 },
] as const;
const DITHER_DIVISOR = 16;
const WHITE = 255;

/** 转黑白：1 = 黑点、0 = 白。阈值：比 threshold 暗的为黑；抖动：同一阈值，误差分给邻居，灰度变成点的疏密。 */
export function toMono(image: GrayImage, mode: ImageMode, threshold: number): Uint8Array {
  const { width, height } = image;
  const mono = new Uint8Array(width * height);
  if (mode === 'threshold') {
    // 用 forEach 顺序取值：回调拿到的 value 是确定的 number，不走可能越界的下标读取
    image.pixels.forEach((value, index) => {
      mono[index] = value < threshold ? 1 : 0;
    });
    return mono;
  }
  const values = Float32Array.from(image.pixels);
  // forEach 按顺序访问，index 和「y*width+x」是同一个数，用它反推 x、y
  values.forEach((old, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const isBlack = old < threshold;
    mono[index] = isBlack ? 1 : 0;
    const error = old - (isBlack ? 0 : WHITE);
    for (const { dx, dy, weight } of DITHER_WEIGHTS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny < height) {
        const target = ny * width + nx;
        // target 已经被上面的条件夹在 [0, width*height) 内，values 是定长数组，一定有值
        // biome-ignore lint/style/noNonNullAssertion: 上面的边界检查已经保证 target 落在 values 范围内
        values[target] = values[target]! + (error * weight) / DITHER_DIVISOR;
      }
    }
  });
  return mono;
}

// ---- 1 位 BMP 编码 ----
// 黑白点原来按二维码的画法拼 SVG 路径，但一张 100×150mm 的抖动照片有 787×1181 个点，
// 黑白像素交替密集时路径字符串能到几 MB，拖慢预览 IPC 和打印渲染。改成 1 位 BMP：
// 大小只随点数线性增长（每点 1 bit），不随黑白交替的密度膨胀。

/** BITMAPFILEHEADER：'BM' 签名 + 文件大小 + 两个保留字段 + 数据偏移，共 14 字节。 */
const BMP_FILE_HEADER_BYTES = 14;
/** BITMAPINFOHEADER：标准的 40 字节头，含宽高、位深、压缩方式等。 */
const BMP_INFO_HEADER_BYTES = 40;
/** 1 位图像的调色板：2 个颜色，每个颜色 4 字节（蓝、绿、红、保留）。 */
const BMP_PALETTE_BYTES = 8;
/** 像素数据的起始偏移：文件头 + 信息头 + 调色板，正好是 62。 */
const BMP_DATA_OFFSET = BMP_FILE_HEADER_BYTES + BMP_INFO_HEADER_BYTES + BMP_PALETTE_BYTES;
/** 转 base64 时分块处理的字节数，避免把几十万字节的数组一次性展开成函数实参。 */
const BASE64_CHUNK_BYTES = 0x8000;

/** 灰度图 → base64（decodeGray 的反过程）：PDF 的一块交给自由设计的图片元素时用。 */
export function encodeGray(image: GrayImage): string {
  return bytesToBase64(image.pixels);
}

/**
 * 黑白点 → 1 位 BMP 的 base64：调色板索引 0 = 白、索引 1 = 黑，和 mono 里 1 = 黑点一一对应。
 * 不依赖任何图片编码库，Chromium 能直接把结果当 `data:image/bmp;base64,...` 渲染。
 */
export function monoBmp(mono: Uint8Array, width: number, height: number): string {
  const rowBytes = Math.ceil(width / 8);
  const rowBytesPadded = Math.ceil(rowBytes / 4) * 4; // BMP 要求每行字节数是 4 的倍数
  const imageSize = rowBytesPadded * height;
  const fileSize = BMP_DATA_OFFSET + imageSize;

  const buffer = new Uint8Array(fileSize);
  const view = new DataView(buffer.buffer);

  // BITMAPFILEHEADER
  buffer[0] = 0x42; // 'B'
  buffer[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // 两个保留字段，固定 0
  view.setUint32(10, BMP_DATA_OFFSET, true);

  // BITMAPINFOHEADER
  view.setUint32(14, BMP_INFO_HEADER_BYTES, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // 正数：行从下到上存（BMP 的默认方向）
  view.setUint16(26, 1, true); // 色彩平面数，固定 1
  view.setUint16(28, 1, true); // 每像素 1 位
  view.setUint32(30, 0, true); // 不压缩（BI_RGB）
  view.setUint32(34, imageSize, true);
  view.setUint32(38, 0, true); // 水平分辨率，不关心，填 0
  view.setUint32(42, 0, true); // 垂直分辨率，不关心，填 0
  view.setUint32(46, 2, true); // 调色板用了 2 个颜色
  view.setUint32(50, 0, true); // 2 个颜色都算「重要」

  // 调色板：索引 0 = 白，索引 1 = 黑，和 mono 的 1 = 黑一一对应
  const paletteOffset = BMP_FILE_HEADER_BYTES + BMP_INFO_HEADER_BYTES;
  buffer.set([0xff, 0xff, 0xff, 0], paletteOffset);
  buffer.set([0, 0, 0, 0], paletteOffset + 4);

  // 像素数据：BMP 从下到上存储；每行按位打包（高位在前），行末补 0 到 4 字节的倍数
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const rowOffset = BMP_DATA_OFFSET + y * rowBytesPadded;
    for (let x = 0; x < width; x += 1) {
      if (mono[sourceY * width + x] === 1) {
        const byteIndex = rowOffset + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8);
        // byteIndex 落在刚分配的 buffer 范围内，未设过的字节默认是 0
        buffer[byteIndex] = (buffer[byteIndex] ?? 0) | (1 << bitIndex);
      }
    }
  }

  return bytesToBase64(buffer);
}

/** 字节数组 → base64：分块转成二进制字符串再一次性 btoa，避免大数组展开成函数实参拖慢或爆栈。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
