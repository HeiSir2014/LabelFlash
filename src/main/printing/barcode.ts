import bwipjs from 'bwip-js';
import { barcodeType } from '../../core/templates/canvas-model';
import { FLOAT_EPSILON } from '../../core/templates/text-fit';

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
/** 条码内容最长 1000 字：标签本来就放不下更长的内容，而且 bwip-js 编码超长的 Aztec 之类会卡顿近 1 秒。 */
export const MAX_BARCODE_TEXT_LENGTH = 1000;

/** 一维条码只收可打印 ASCII（0x20–0x7E）：中文、重音字母等要靠扩展模式编码，扫码枪读出来是乱码。 */
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

/**
 * 二维码制的静区（模块数）：PDF417、紧凑 PDF417 按 AIM 标准至少 2 个模块；汉信码（GB/T 21049）、DotCode（AIM）
 * 按各自标准至少 3 倍模块宽（3X）；Data Matrix 1，其余按 1（标准里写 0 的也留 1，和相邻的线分开）。
 */
const MATRIX_QUIET_ZONE_MODULES: Readonly<Record<string, number>> = {
  pdf417: 2,
  pdf417compact: 2,
  hanxin: 3,
  dotcode: 3,
};
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

export type BarcodeResult =
  | { ok: true; code: LinearCode | MatrixCode }
  | {
      ok: false;
      reason: string;
      /** 原始错误，写日志用，不给用户看。 */
      detail?: string;
    };

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

/**
 * bwip-js 的 raw() 返回值按文档应该是两种形状之一；形状不对说明我们这边的假设错了（库升级、
 * 新码制的输出和预期不一样……），是我们自己的 bug，不是用户内容的问题，直接抛出去，不要吞掉。
 * 调用方要在 bwipjs.raw() 的 try/catch 之外调用这个函数，这个 throw 才不会被当成内容错误接住。
 */
function narrowRaw(raw: unknown, bcid: string): RawLinear | RawMatrix {
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

/** 编码；内容不合这种码制（位数、校验位、字符，或是 bwip-js 对这份内容干脆处理不了）时给出中文原因，不抛出；真的 bug 原样抛出。 */
export function encodeBarcode(symbology: string, text: string): BarcodeResult {
  const type = barcodeType(symbology);
  if (type === null) {
    return { ok: false, reason: `不认识的条码类型：${symbology}` };
  }
  if (text === '') {
    return { ok: false, reason: '内容是空的' };
  }
  if (text.length > MAX_BARCODE_TEXT_LENGTH) {
    return { ok: false, reason: `${type.label}：内容太长，这种条码放不下` };
  }
  // 一维码只接可打印 ASCII：Code 128 之类塞中文会走扩展模式，编出来的条码扫出来是乱码（面单的编码器本就只收 ASCII）。
  // 二维码（Data Matrix、PDF417……）本就是按 UTF-8 编的，不限制。
  if (type.dimensions === 1 && !PRINTABLE_ASCII.test(text)) {
    return { ok: false, reason: `${type.label}：有这种条码不能编的字` };
  }
  // 只把 bwipjs.raw() 这一行圈进 try/catch：它是第三方库在处理不可信的外部内容，任何异常都当成「这份内容编不出来」，
  // 不管消息长什么样（bwip-js 对某些查不到规则的内容会直接抛 TypeError，不走它自己「bwipp.」前缀的错误体系）。
  // 下面的形状收窄、行列整除检查是我们自己对「正常输出该是什么样」的假设，放在 try/catch 外面，假设错了就是 bug，原样抛出。
  let output: unknown;
  try {
    output = bwipjs.raw({ bcid: symbology, text });
  } catch (error) {
    return explain(error, type.label);
  }
  const raw = narrowRaw(output, symbology);
  if ('sbs' in raw) {
    if (!raw.sbs.every((width) => Number.isInteger(width) && width >= 0)) {
      // 邮政四态码（POSTNET、USPS 智能邮件码……）按 PostScript 点给小数条宽，不取整到打印点；
      // 它们已经不在 BARCODE_TYPES 里了，这道检查是防着以后又加进一个输出小数条宽的码制。
      return { ok: false, reason: `${type.label}：这种条码的模块宽不是整数，打印不出` };
    }
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
  // 实测（bwip-js 4.11.4）：PDF417 一行 3 个模块高、Micro PDF417 2 个、Data Matrix 1 个。两个都应该整除，
  // 除不尽说明 bwip-js 的输出和预期的形状不一样，是 bug，不是内容问题，直接抛出去。
  const rows = raw.pixs.length / raw.pixx;
  if (!Number.isInteger(rows)) {
    throw new Error(
      `bwip-js returned pixs (${raw.pixs.length}) that is not a multiple of pixx (${raw.pixx}) for ${symbology}`,
    );
  }
  const rowScale = raw.pixy / rows;
  if (!Number.isInteger(rowScale)) {
    throw new Error(
      `bwip-js returned pixy (${raw.pixy}) that is not a multiple of the row count (${rows}) for ${symbology}`,
    );
  }
  return { ok: true, code: { dimensions: 2, cells: raw.pixs, columns: raw.pixx, rows, rowScale } };
}

/**
 * bwipjs.raw() 抛出的异常都当成内容问题：按它的错误码（消息形如 `bwipp.<code>#<行号>: ……`）给中文原因，
 * `detail` 留原始英文消息写日志用。孤立的 UTF-16 代理项抛的是 URIError，当成坏字符；
 * 其余没有 `bwipp.` 错误码的异常（例如某些内容让 bwip-js 自己内部抛出 TypeError，不走它的错误体系）给通用的「内容不对」。
 */
function explain(error: unknown, label: string): { ok: false; reason: string; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof URIError) {
    return { ok: false, reason: `${label}：有这种条码不能编的字`, detail: message };
  }
  const code = /^bwipp\.(\w+)#/.exec(message)?.[1] ?? '';
  if (code === '') {
    return { ok: false, reason: `${label}：内容不对`, detail: message };
  }
  if (/Length$/i.test(code) || /badLength|tooLong|tooShort/i.test(code)) {
    return { ok: false, reason: `${label}：位数不对`, detail: message };
  }
  if (/NoValidSymbol/.test(code)) {
    return { ok: false, reason: `${label}：内容太长，这种条码放不下`, detail: message };
  }
  if (/^GS1/.test(code)) {
    return { ok: false, reason: `${label}：要写成 GS1 格式，例如 (01)06901234567892`, detail: message };
  }
  if (/badCheck/i.test(code)) {
    return { ok: false, reason: `${label}：校验位不对`, detail: message };
  }
  if (/badChar|Character|invalid/i.test(code)) {
    return { ok: false, reason: `${label}：有这种条码不能编的字`, detail: message };
  }
  return { ok: false, reason: `${label}：内容不对`, detail: message };
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
  // 用 ceil 而不是 round：MIN_MODULE_MM / dot 只要比某个整数大一点（哪怕只大 0.01），round 也会降到那个整数，
  // 而那点和整数的点数一样宽（没有多那一点），实际宽度就比 MIN_MODULE_MM 窄了（例如 204dpi 上比值约 2.0079，
  // round 得 2，但 2 个点只有 0.249mm）；换成 ceil 才能保证点数折算出来的宽度总是不小于 MIN_MODULE_MM。
  // 减去的 FLOAT_EPSILON 只是去掉浮点除法在「比值数学上正好是整数」时的噪声（例如 203.2dpi），
  // 不是为了纠正上面这种本来就该进位的情况。
  const minDots = Math.max(1, Math.ceil(MIN_MODULE_MM / dot - FLOAT_EPSILON));
  const maxDots = Math.max(minDots, Math.round(maxModuleMm / dot));
  const dots = Math.min(maxDots, Math.floor(lengthDots / totalModules));
  return dots < minDots ? null : dots;
}

/**
 * 一维条码的路径，坐标以模块为单位：横排时条沿 x 排开、高度占 viewBox 的 1；竖排时转 90°（条纹横着走）。
 * heights、offsets 不给时每根条满高（面单的 Code128 就是这样，输出和原来逐字相同）。
 * 竖排（vertical）目前只给面单的 Code 128 用，这种条总是满高；heights、offsets 是给横排、条高不一的码制用的
 * （目前没有码制同时用到两者），不要假设竖排能配合变高的条一起用。
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
