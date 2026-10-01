import type { PaperSize } from '../../shared/paper-sizes';
import type { QrErrorLevel, TemplateBase, TextAlign } from './template-model';
import type { VerticalAlign } from './waybill-model';

/**
 * 自由设计模板：画布上一组绝对定位的元素（毫米），用于吊牌、价签、商品条码这类「设计一次、填数据打印」的标签。
 * 和标签模板（字段数不定）、面单模板（格子拼满）并列。设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 3 节。
 */

export const CANVAS_ELEMENT_KINDS = ['text', 'barcode', 'qr', 'image', 'line', 'rect', 'table'] as const;
export type CanvasElementKind = (typeof CANVAS_ELEMENT_KINDS)[number];

/** 只转直角：转任意角度时边缘落不到打印点上，条码会糊。 */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** 文字放不下时：shrink = 先缩小，仍放不下截断；wrap = 按框宽折行，放不下再缩小、截断。 */
export const TEXT_FITS = ['shrink', 'wrap'] as const;
export type TextFit = (typeof TEXT_FITS)[number];

/** 图片转黑白：threshold = 按阈值一刀切（线稿、Logo）；dither = 抖动（照片，用点的疏密表示灰度）。 */
export const IMAGE_MODES = ['threshold', 'dither'] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

/** 所有元素共有的：位置和大小是元素在纸上占的框（转过之后的外框），单位 mm。 */
export interface CanvasElementBase {
  /** 模板内唯一，编辑器用它记住选中的元素。 */
  id: string;
  /** 给人看的名字，打印前检查用它指出是哪个元素。 */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
  /** 锁定后编辑器里不能拖动、缩放（防止误碰）。打印不受影响。 */
  locked: boolean;
}

export interface CanvasText extends CanvasElementBase {
  kind: 'text';
  /** 可以多行，可以有 {字段名} 等变量；一行里的字段全是空的，这一行不印。 */
  text: string;
  fontSizeMm: number;
  bold: boolean;
  align: TextAlign;
  valign: VerticalAlign;
  fit: TextFit;
  /** 反白：黑底白字。 */
  inverse: boolean;
}

export interface CanvasBarcode extends CanvasElementBase {
  kind: 'barcode';
  /** 码制，取 BARCODE_TYPES 里的 id（bwip-js 的 bcid）。 */
  symbology: string;
  /** 条码内容，可以有变量，例如 {商品码}。 */
  value: string;
  /** 一维码下方印号码（二维码不印）。 */
  showText: boolean;
  textSizeMm: number;
}

export interface CanvasQr extends CanvasElementBase {
  kind: 'qr';
  value: string;
  errorCorrection: QrErrorLevel;
}

export interface CanvasImage extends CanvasElementBase {
  kind: 'image';
  /**
   * 8 位灰度像素（0 黑 – 255 白，逐行），base64。编辑器在 sandbox 的页面里把图片文件解码成灰度再存，
   * 主进程只缩放、转黑白，不解码图片文件（不可信输入不进高权限进程里的 C++ 解码器）。
   */
  pixels: string;
  pixelWidth: number;
  pixelHeight: number;
  mode: ImageMode;
  /** 0–255：比它暗的算黑（抖动时作为基准）。 */
  threshold: number;
}

/** 线：就是一个实心的细框，横竖由宽高决定，粗细是较短的那一边。 */
export interface CanvasLine extends CanvasElementBase {
  kind: 'line';
  dashed: boolean;
}

export interface CanvasRect extends CanvasElementBase {
  kind: 'rect';
  /** 边框粗细，0 = 没有边框。 */
  borderMm: number;
  filled: boolean;
  radiusMm: number;
}

export interface CanvasTableCell {
  text: string;
  fontSizeMm: number;
  bold: boolean;
  align: TextAlign;
}

export interface CanvasTable extends CanvasElementBase {
  kind: 'table';
  /** 行高（mm），最后一行占剩下的。 */
  rowsMm: number[];
  /** 列宽（mm），最后一列占剩下的。 */
  columnsMm: number[];
  borderMm: number;
  /** cells[行][列]，行列数和 rowsMm、columnsMm 一致。 */
  cells: CanvasTableCell[][];
}

export type CanvasElement = CanvasText | CanvasBarcode | CanvasQr | CanvasImage | CanvasLine | CanvasRect | CanvasTable;

export interface CanvasTemplate extends TemplateBase {
  kind: 'canvas';
  /** 数组顺序就是上下层：后面的盖在前面的上面。 */
  elements: CanvasElement[];
}

export const CANVAS_LIMITS = {
  /** 一张标签 100 个元素已经很满；再多编辑器难选、排版也慢。 */
  elements: 100,
  nameLength: 20,
  textLength: 500,
  valueLength: 200,
  /** 1.5mm 是热敏纸上还认得出汉字的下限；30mm 够印大号价格。 */
  fontSizeMm: { min: 1.5, max: 30 },
  /** 元素最小 0.25mm：203dpi 上 2 个点，也是线的最小粗细（1 个点的线在热敏纸上时断时续）。 */
  minSizeMm: 0.25,
  tableRows: 20,
  tableColumns: 10,
  borderMm: { min: 0, max: 2 },
  radiusMm: { max: 10 },
  /** 一张图的灰度像素最多 1MB（约 1000×1000）：60×40 的标签在 300dpi 上也只要 709×472。 */
  imageBytes: 1024 * 1024,
  /** 一个模板里所有图片加起来最多 4MB：模板存在数据库里，每次打印都要读。 */
  templateImageBytes: 4 * 1024 * 1024,
  /** 图片边长上限（像素）：防止宽 1、高一百万这种畸形输入。 */
  imageSidePixels: 4000,
  /** 纸边往里这么多是安全区：标签机打到最边上常常打不全。 */
  safeMarginMm: 1.5,
} as const;

export interface BarcodeType {
  /** bwip-js 的 bcid。 */
  id: string;
  label: string;
  dimensions: 1 | 2;
  /** 下拉框前面直接列出的常用码制；其余放在「更多」里。 */
  common: boolean;
}

/** 码制清单：常用的 10 种在前，其余按一维、二维分组。加一种码制只需在这里加一行（bwip-js 支持即可）。 */
export const BARCODE_TYPES: readonly BarcodeType[] = [
  { id: 'code128', label: 'Code 128', dimensions: 1, common: true },
  { id: 'ean13', label: 'EAN-13（商品条码）', dimensions: 1, common: true },
  { id: 'ean8', label: 'EAN-8', dimensions: 1, common: true },
  { id: 'upca', label: 'UPC-A', dimensions: 1, common: true },
  { id: 'upce', label: 'UPC-E', dimensions: 1, common: true },
  { id: 'code39', label: 'Code 39', dimensions: 1, common: true },
  { id: 'code93', label: 'Code 93', dimensions: 1, common: true },
  { id: 'itf14', label: 'ITF-14（箱码）', dimensions: 1, common: true },
  { id: 'rationalizedCodabar', label: '库得巴（Codabar）', dimensions: 1, common: true },
  { id: 'gs1-128', label: 'GS1-128', dimensions: 1, common: true },
  { id: 'interleaved2of5', label: '交叉 25 码', dimensions: 1, common: false },
  { id: 'code39ext', label: 'Code 39 全 ASCII', dimensions: 1, common: false },
  { id: 'code93ext', label: 'Code 93 全 ASCII', dimensions: 1, common: false },
  { id: 'code11', label: 'Code 11', dimensions: 1, common: false },
  { id: 'msi', label: 'MSI', dimensions: 1, common: false },
  { id: 'pharmacode', label: 'Pharmacode', dimensions: 1, common: false },
  { id: 'plessey', label: 'Plessey', dimensions: 1, common: false },
  { id: 'telepen', label: 'Telepen', dimensions: 1, common: false },
  { id: 'isbn', label: 'ISBN', dimensions: 1, common: false },
  { id: 'issn', label: 'ISSN', dimensions: 1, common: false },
  { id: 'ismn', label: 'ISMN', dimensions: 1, common: false },
  { id: 'databaromni', label: 'GS1 DataBar', dimensions: 1, common: false },
  { id: 'databarlimited', label: 'GS1 DataBar Limited', dimensions: 1, common: false },
  { id: 'databarexpanded', label: 'GS1 DataBar Expanded', dimensions: 1, common: false },
  { id: 'postnet', label: 'POSTNET', dimensions: 1, common: false },
  { id: 'onecode', label: 'USPS 智能邮件码', dimensions: 1, common: false },
  { id: 'royalmail', label: 'Royal Mail 四态码', dimensions: 1, common: false },
  { id: 'auspost', label: '澳大利亚邮政码', dimensions: 1, common: false },
  { id: 'japanpost', label: '日本邮政码', dimensions: 1, common: false },
  { id: 'kix', label: 'KIX', dimensions: 1, common: false },
  { id: 'datamatrix', label: 'Data Matrix', dimensions: 2, common: false },
  { id: 'gs1datamatrix', label: 'GS1 Data Matrix', dimensions: 2, common: false },
  { id: 'pdf417', label: 'PDF417', dimensions: 2, common: false },
  { id: 'pdf417compact', label: '紧凑 PDF417', dimensions: 2, common: false },
  { id: 'micropdf417', label: 'Micro PDF417', dimensions: 2, common: false },
  { id: 'azteccode', label: 'Aztec', dimensions: 2, common: false },
  { id: 'dotcode', label: 'DotCode', dimensions: 2, common: false },
  { id: 'hanxin', label: '汉信码', dimensions: 2, common: false },
  { id: 'codeone', label: 'Code One', dimensions: 2, common: false },
];

/** 按 id 找码制；不认识的返回 null。 */
export function barcodeType(id: string): BarcodeType | null {
  return BARCODE_TYPES.find((type) => type.id === id) ?? null;
}

/** 新元素的默认大小（mm）：放在纸的左上角安全区内，编辑器再挪到中间。 */
const NEW_ELEMENT_SIZE_MM: Readonly<Record<CanvasElementKind, { width: number; height: number }>> = {
  text: { width: 30, height: 6 },
  barcode: { width: 40, height: 12 },
  qr: { width: 15, height: 15 },
  image: { width: 15, height: 15 },
  line: { width: 30, height: CANVAS_LIMITS.minSizeMm },
  rect: { width: 20, height: 10 },
  table: { width: 36, height: 12 },
};

const NEW_ELEMENT_NAMES: Readonly<Record<CanvasElementKind, string>> = {
  text: '文字',
  barcode: '条码',
  qr: '二维码',
  image: '图片',
  line: '线',
  rect: '矩形',
  table: '表格',
};

/** 新元素：默认内容让人一眼看出它是什么，大小收进纸内。 */
export function newCanvasElement(kind: CanvasElementKind, id: string, paper: PaperSize): CanvasElement {
  const margin = CANVAS_LIMITS.safeMarginMm;
  const size = NEW_ELEMENT_SIZE_MM[kind];
  const base: CanvasElementBase = {
    id,
    name: NEW_ELEMENT_NAMES[kind],
    x: margin,
    y: margin,
    width: Math.min(size.width, paper.widthMm - 2 * margin),
    height: Math.min(size.height, paper.heightMm - 2 * margin),
    rotation: 0,
    locked: false,
  };
  switch (kind) {
    case 'text':
      return {
        ...base,
        kind,
        text: '文字',
        fontSizeMm: 3.5,
        bold: false,
        align: 'left',
        valign: 'middle',
        fit: 'shrink',
        inverse: false,
      };
    case 'barcode':
      return { ...base, kind, symbology: 'code128', value: '{完整内容}', showText: true, textSizeMm: 2.5 };
    case 'qr':
      return { ...base, kind, value: '{完整内容}', errorCorrection: 'M' };
    case 'image':
      // 1×1 的白点：插入图片时编辑器换成真正的像素。
      return { ...base, kind, pixels: '/w==', pixelWidth: 1, pixelHeight: 1, mode: 'threshold', threshold: 128 };
    case 'line':
      return { ...base, kind, dashed: false };
    case 'rect':
      return { ...base, kind, borderMm: 0.3, filled: false, radiusMm: 0 };
    case 'table':
      return {
        ...base,
        kind,
        rowsMm: [6, 0],
        columnsMm: [12, 0],
        borderMm: 0.25,
        cells: [
          [cell('名称', true), cell('{编码}', false)],
          [cell('尺码', true), cell('{尺码}', false)],
        ],
      };
  }
}

function cell(text: string, bold: boolean): CanvasTableCell {
  return { text, fontSizeMm: 2.8, bold, align: 'left' };
}
