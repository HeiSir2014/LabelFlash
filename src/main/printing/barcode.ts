import bwipjs from 'bwip-js';
import { barcodeType } from '../../core/templates/canvas-model';

/**
 * 条码：编码交给 bwip-js（只要条空宽度或点阵），画法自己来：每个模块取整数个打印点，路径坐标以模块为单位，
 * 外面的 SVG 按点数定大小，crispEdges 不抗锯齿。面单（Code128，自己的编码器）和自由设计共用这里的画法和限制。
 */

/** 条码两侧的空白（静区）：标准要求一维码至少 10 个模块，扫码枪才找得到条码的起止。 */
export const QUIET_ZONE_MODULES = 10;
/** 模块宽下限 0.25mm：203dpi 上 2 个点，再窄扫码枪读不稳。 */
export const MIN_MODULE_MM = 0.25;
/** 面单的模块宽上限：二联的运单条码约 88mm 宽，15 位单号的模块约 0.6mm（照平台面单）。 */
export const WAYBILL_MAX_MODULE_MM = 0.625;
/** 自由设计的模块宽上限：标签可以很大（100×150），条码按框放大到 1mm 的模块就够了。 */
export const CANVAS_MAX_MODULE_MM = 1;
/** 条码最矮 4mm：再矮手持扫码枪的扫描线不好对准，放不下就不印并提示。 */
export const MIN_BAR_HEIGHT_MM = 4;

/** 二维码制的静区（模块数）：Data Matrix 1、PDF417 2，其余按 1（标准里写 0 的也留 1，和相邻的线分开）。 */
const MATRIX_QUIET_ZONE_MODULES: Readonly<Record<string, number>> = { pdf417: 2, pdf417compact: 2 };
const DEFAULT_MATRIX_QUIET_ZONE_MODULES = 1;

export interface LinearCode {
  dimensions: 1;
  /** 条、空、条……的宽度（模块数），条开头、条结尾。 */
  widths: number[];
  /** 每根条的高度（占满高的比例，0–1）；四态邮政码各不相同，其余都是 1。 */
  heights: number[];
  /** 每根条离底边的距离（占满高的比例）。 */
  offsets: number[];
}

export interface MatrixCode {
  dimensions: 2;
  /** 逐行的点：1 = 黑。 */
  cells: number[];
  columns: number;
  rows: number;
  /** 一行有几个模块高（PDF417 一行 3 个模块高，其余 1）。 */
  rowScale: number;
}

export type BarcodeResult = { ok: true; code: LinearCode | MatrixCode } | { ok: false; reason: string };

interface RawLinear {
  sbs: number[];
  bhs: number[];
  bbs: number[];
}

interface RawMatrix {
  pixs: number[];
  pixx: number;
  pixy: number;
  height: number;
  width: number;
}

/** bwip-js 的 raw()：同步，出错时抛出。返回值按 bwip-js 的文档收窄成两种形状之一。 */
function rawEncode(bcid: string, text: string): RawLinear | RawMatrix {
  const raw = bwipjs.raw({ bcid, text }) as unknown;
  const first = Array.isArray(raw) ? (raw[0] as unknown) : null;
  if (typeof first === 'object' && first !== null) {
    if ('sbs' in first) {
      return first as RawLinear;
    }
    if ('pixs' in first) {
      return first as RawMatrix;
    }
  }
  throw new Error(`bwip-js returned an unexpected shape for ${bcid}`);
}

/** 编码；内容不合这种码制（位数、校验位、字符）时给出中文原因，不抛出。 */
export function encodeBarcode(symbology: string, text: string): BarcodeResult {
  const type = barcodeType(symbology);
  if (type === null) {
    return { ok: false, reason: `不认识的条码类型：${symbology}` };
  }
  let raw: RawLinear | RawMatrix;
  try {
    raw = rawEncode(symbology, text);
  } catch (error) {
    return { ok: false, reason: `内容不符合 ${type.label} 的要求：${explain(error)}` };
  }
  if ('sbs' in raw) {
    const tallest = Math.max(...raw.bhs.map((height, index) => height + (raw.bbs[index] ?? 0)));
    return {
      ok: true,
      code: {
        dimensions: 1,
        widths: raw.sbs,
        heights: raw.bhs.map((height) => height / tallest),
        offsets: raw.bbs.map((offset) => offset / tallest),
      },
    };
  }
  // pixs 里只有不重复的行（PDF417 7 行 × 103 列）；pixy 是把每行的高度（几个模块）算进去之后的行数（7 × 3 = 21）。
  // 实测（bwip-js 4.11.4）：PDF417 一行 3 个模块高、Micro PDF417 2 个、Data Matrix 1 个。
  const rows = Math.max(1, Math.round(raw.pixs.length / raw.pixx));
  const rowScale = Math.max(1, Math.round(raw.pixy / rows));
  return { ok: true, code: { dimensions: 2, cells: raw.pixs, columns: raw.pixx, rows, rowScale } };
}

/** bwip-js 的错误信息是英文的「bwipp.ean13badLength#4372: EAN-13 must be 12 or 13 digits」：按错误码说中文。 */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/badLength|tooLong|tooShort/i.test(message)) {
    return '位数不对';
  }
  if (/badCheck/i.test(message)) {
    return '校验位不对';
  }
  if (/badChar|invalid/i.test(message)) {
    return '有这种条码不能编的字';
  }
  return '内容不对';
}

/** 二维码制的静区。 */
export function matrixQuietZone(symbology: string): number {
  return MATRIX_QUIET_ZONE_MODULES[symbology] ?? DEFAULT_MATRIX_QUIET_ZONE_MODULES;
}

/**
 * 每个模块几个点：在 lengthDots 个点里放 totalModules 个模块（含静区），不超过 maxModuleMm；
 * 小于 MIN_MODULE_MM 时返回 null（放不下，不印）。
 */
export function moduleDotsFor(
  lengthDots: number,
  totalModules: number,
  dot: number,
  maxModuleMm: number,
): number | null {
  const minDots = Math.max(1, Math.round(MIN_MODULE_MM / dot));
  const maxDots = Math.max(minDots, Math.round(maxModuleMm / dot));
  const dots = Math.min(maxDots, Math.floor(lengthDots / totalModules));
  return dots < minDots ? null : dots;
}

/**
 * 一维条码的路径，坐标以模块为单位：横排时条沿 x 排开、高度占 viewBox 的 1；竖排时转 90°（条纹横着走）。
 * heights、offsets 不给时每根条满高（面单的 Code128 就是这样，输出和原来逐字相同）。
 */
export function linearBarsPath(
  widths: readonly number[],
  vertical: boolean,
  heights?: readonly number[],
  offsets?: readonly number[],
): string {
  let position = 0;
  let path = '';
  widths.forEach((width, index) => {
    if (index % 2 === 0) {
      const bar = index / 2;
      const height = heights?.[bar] ?? 1;
      const top = 1 - height - (offsets?.[bar] ?? 0);
      path += vertical
        ? `M${top} ${position}h${height}v${width}H${top}z`
        : `M${position} ${top}h${width}v${height}H${position}z`;
    }
    position += width;
  });
  return path;
}

/** 二维码制的路径：每行连续的黑点合成一个矩形，一行 rowScale 个模块高。 */
export function matrixPath(cells: readonly number[], columns: number, rows: number, rowScale: number): string {
  let path = '';
  for (let row = 0; row < rows; row += 1) {
    let column = 0;
    while (column < columns) {
      if (cells[row * columns + column] !== 1) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < columns && cells[row * columns + column] === 1) {
        column += 1;
      }
      path += `M${start} ${row * rowScale}h${column - start}v${rowScale}H${start}z`;
    }
  }
  return path;
}
