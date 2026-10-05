import {
  CANVAS_LIMITS,
  type CanvasBarcode,
  type CanvasElementBase,
  type CanvasLine,
  type CanvasQr,
  type CanvasTable,
  type CanvasTableCell,
  type CanvasText,
  DEFAULT_TABLE_CELL,
} from '../canvas-model';
import type { QrErrorLevel, TextAlign } from '../template-model';

/**
 * 写模板库模板用的小工具：元素的框写成元组，一个模板读起来像一张坐标表。
 * 只是 CanvasElement 的简写，产出的元素和设计器保存的一模一样（测试核对过一遍校验器不变）。
 */

/** 元素的框（mm）：左、上、宽、高。 */
export type Box = readonly [x: number, y: number, width: number, height: number];

/** 文字的样式：只写和默认不同的。 */
export interface TextOptions {
  fontSizeMm?: number;
  bold?: boolean;
  align?: TextAlign;
  /** 反白：黑底白字（标题、特价横幅、大尺码）。 */
  inverse?: boolean;
  /** 配料这类长文字按框宽折行；其余放不下先缩小。 */
  wrap?: boolean;
}

/** 文字默认字号：60×40 标签上正文的常用大小。 */
const DEFAULT_FONT_SIZE_MM = 3;
/** 条码下面号码的默认字号：比正文小一点，13 位的 EAN-13 号码在 36mm 宽的框里放得下。 */
const DEFAULT_BARCODE_TEXT_MM = 2.4;
/** 表格默认字号：和设计器新建表格一致。 */
const DEFAULT_TABLE_FONT_MM = DEFAULT_TABLE_CELL.fontSizeMm;

function base(id: string, name: string, [x, y, width, height]: Box): CanvasElementBase {
  return { id, name, x, y, width, height, rotation: 0, locked: false };
}

/** 文字：垂直居中；放不下先缩小（wrap 时先折行）。 */
export function text(id: string, name: string, box: Box, content: string, options: TextOptions = {}): CanvasText {
  return {
    ...base(id, name, box),
    kind: 'text',
    text: content,
    fontSizeMm: options.fontSizeMm ?? DEFAULT_FONT_SIZE_MM,
    bold: options.bold ?? false,
    align: options.align ?? 'left',
    valign: 'middle',
    fit: options.wrap === true ? 'wrap' : 'shrink',
    inverse: options.inverse ?? false,
  };
}

/** 一维码，下面印号码。模板库只用两种：零售结算的 EAN-13，货号、库位、箱号的 Code128。 */
export function barcode(
  id: string,
  name: string,
  box: Box,
  symbology: 'code128' | 'ean13',
  value: string,
  textSizeMm: number = DEFAULT_BARCODE_TEXT_MM,
): CanvasBarcode {
  return { ...base(id, name, box), kind: 'barcode', symbology, value, showText: true, textSizeMm };
}

/** 二维码：默认容错 M（标签常用；放不下时排版自动降级）。 */
export function qr(id: string, name: string, box: Box, value: string, errorCorrection: QrErrorLevel = 'M'): CanvasQr {
  return { ...base(id, name, box), kind: 'qr', value, errorCorrection };
}

/** 横线：粗细是最小线宽（203dpi 上 2 个点）。 */
export function hLine(id: string, name: string, x: number, y: number, width: number): CanvasLine {
  return { ...base(id, name, [x, y, width, CANVAS_LIMITS.minSizeMm]), kind: 'line', dashed: false };
}

/**
 * 两列的「名称 | 值」表格：每行一样高，左列加粗写名称，右列写值（通常是 {字段名}）。
 * 合格证、价签、食品标签的参数区都是这个样子；边框是最小线宽。
 */
export function pairTable(
  id: string,
  name: string,
  box: Box,
  nameWidthMm: number,
  rows: readonly (readonly [label: string, value: string])[],
  fontSizeMm: number = DEFAULT_TABLE_FONT_MM,
): CanvasTable {
  const [, , , height] = box;
  const rowHeightMm = height / rows.length;
  const cell = (cellText: string, bold: boolean): CanvasTableCell => ({
    text: cellText,
    fontSizeMm,
    bold,
    align: 'left',
  });
  return {
    ...base(id, name, box),
    kind: 'table',
    // 最后一行、最后一列存 0：排版时占剩下的，和设计器保存的表格一致。
    rowsMm: rows.map((_, index) => (index === rows.length - 1 ? 0 : rowHeightMm)),
    columnsMm: [nameWidthMm, 0],
    borderMm: CANVAS_LIMITS.minSizeMm,
    cells: rows.map(([label, value]) => [cell(label, true), cell(value, false)]),
  };
}
