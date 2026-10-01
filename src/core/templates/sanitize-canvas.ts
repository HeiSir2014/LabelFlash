import type { PaperSize } from '../../shared/paper-sizes';
import {
  barcodeType,
  CANVAS_ELEMENT_KINDS,
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasElementBase,
  type CanvasElementKind,
  type CanvasTableCell,
  DEFAULT_IMAGE_MODE,
  DEFAULT_IMAGE_THRESHOLD,
  DEFAULT_TABLE_CELL,
  IMAGE_MODES,
  newCanvasElement,
  ROTATIONS,
  TEXT_FITS,
} from './canvas-model';
import { asLoose, bool, clamp, type Loose, pick, sanitizeText } from './sanitize-primitives';
import { QR_ERROR_LEVELS, TEXT_ALIGNS } from './template-model';
import { VERTICAL_ALIGNS } from './waybill-model';

/** 元素 id：字母、数字、下划线、连字符。编辑器用它记住选中的元素，不进 HTML。 */
const ELEMENT_ID_PATTERN = /^[\w-]{1,32}$/;
/** base64 只允许这些字符（去掉换行后）。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * base64 文本里允许的空白字符数量的宽裕上限：标准换行是每 76 个字符一个，最坏情况下约等于正文长度 / 76；
 * 给固定的 64 KiB 容忍已经远超这个比例，不用真的按比例算。超过这个长度在替换空白之前就拒绝，
 * 不给不可信输入一个「构造超大字符串让 replace 白跑」的机会。
 */
const IMAGE_BASE64_WHITESPACE_ALLOWANCE = 64 * 1024;

/** base64 文本长度上限：按最大允许的图片字节数经 base64 膨胀（4/3 倍，向上取整到 4 的倍数）反推，再加上空白容忍。 */
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(CANVAS_LIMITS.imageBytes / 3) * 4 + IMAGE_BASE64_WHITESPACE_ALLOWANCE;

/**
 * 不可信的元素列表 → 合法元素：认不出的类型、像素对不上的图片直接丢掉，其余每一项缺了或不对就取这一类的默认值；
 * 位置和大小收进纸内。不改顺序（顺序就是上下层）。
 */
export function sanitizeCanvasElements(value: unknown, paper: PaperSize): CanvasElement[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const usedIds = new Set<string>();
  let imageBudget = CANVAS_LIMITS.templateImageBytes;
  const elements: CanvasElement[] = [];
  for (const item of value) {
    if (elements.length === CANVAS_LIMITS.elements) {
      break;
    }
    const input = asLoose(item);
    const kind = pick<CanvasElementKind | ''>(input['kind'], CANVAS_ELEMENT_KINDS, '');
    if (kind === '') {
      continue;
    }
    const id = uniqueId(input['id'], usedIds, elements.length);
    const element = sanitizeElement(input, kind, id, paper);
    if (element === null) {
      continue;
    }
    if (element.kind === 'image') {
      const bytes = element.pixelWidth * element.pixelHeight;
      if (bytes > imageBudget) {
        continue;
      }
      imageBudget -= bytes;
    }
    usedIds.add(id);
    elements.push(element);
  }
  return elements;
}

function uniqueId(value: unknown, used: ReadonlySet<string>, index: number): string {
  if (typeof value === 'string' && ELEMENT_ID_PATTERN.test(value) && !used.has(value)) {
    return value;
  }
  let candidate = `e${index + 1}`;
  for (let suffix = 2; used.has(candidate); suffix += 1) {
    candidate = `e${index + 1}-${suffix}`;
  }
  return candidate;
}

function sanitizeElement(input: Loose, kind: CanvasElementKind, id: string, paper: PaperSize): CanvasElement | null {
  const fallback = newCanvasElement(kind, id, paper);
  const base = sanitizeBase(input, fallback, paper);
  const { fontSizeMm } = CANVAS_LIMITS;
  switch (fallback.kind) {
    case 'text':
      return {
        ...base,
        kind: 'text',
        text: sanitizeText(input['text'], CANVAS_LIMITS.textLength, fallback.text),
        fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, fallback.fontSizeMm),
        bold: bool(input['bold'], fallback.bold),
        align: pick(input['align'], TEXT_ALIGNS, fallback.align),
        valign: pick(input['valign'], VERTICAL_ALIGNS, fallback.valign),
        fit: pick(input['fit'], TEXT_FITS, fallback.fit),
        inverse: bool(input['inverse'], fallback.inverse),
      };
    case 'barcode': {
      const symbology = typeof input['symbology'] === 'string' ? input['symbology'] : '';
      return {
        ...base,
        kind: 'barcode',
        symbology: barcodeType(symbology) === null ? fallback.symbology : symbology,
        value: sanitizeText(input['value'], CANVAS_LIMITS.valueLength, fallback.value).replace(/\n/g, ''),
        showText: bool(input['showText'], fallback.showText),
        textSizeMm: clamp(input['textSizeMm'], fontSizeMm.min, fontSizeMm.max, fallback.textSizeMm),
      };
    }
    case 'qr':
      return {
        ...base,
        kind: 'qr',
        value: sanitizeText(input['value'], CANVAS_LIMITS.valueLength, fallback.value),
        errorCorrection: pick(input['errorCorrection'], QR_ERROR_LEVELS, fallback.errorCorrection),
      };
    case 'image':
      return sanitizeImage(input, base);
    case 'line':
      return { ...base, kind: 'line', dashed: bool(input['dashed'], fallback.dashed) };
    case 'rect':
      return {
        ...base,
        kind: 'rect',
        borderMm: clamp(input['borderMm'], CANVAS_LIMITS.borderMm.min, CANVAS_LIMITS.borderMm.max, fallback.borderMm),
        filled: bool(input['filled'], fallback.filled),
        radiusMm: clamp(input['radiusMm'], 0, CANVAS_LIMITS.radiusMm.max, fallback.radiusMm),
      };
    case 'table':
      return sanitizeTable(input, base, fallback.borderMm);
  }
}

function sanitizeBase(input: Loose, fallback: CanvasElementBase, paper: PaperSize): CanvasElementBase {
  const min = CANVAS_LIMITS.minSizeMm;
  const width = clamp(input['width'], min, paper.widthMm, fallback.width);
  const height = clamp(input['height'], min, paper.heightMm, fallback.height);
  return {
    id: fallback.id,
    name:
      sanitizeText(input['name'], CANVAS_LIMITS.nameLength, fallback.name).replace(/\n/g, '').trim() || fallback.name,
    // 先定大小再定位置：位置夹到「纸宽 − 元素宽」以内，元素整个在纸上。
    x: clamp(input['x'], 0, paper.widthMm - width, fallback.x),
    y: clamp(input['y'], 0, paper.heightMm - height, fallback.y),
    width,
    height,
    rotation: pick(input['rotation'], ROTATIONS, 0),
    locked: bool(input['locked'], false),
  };
}

/** 像素边长：正整数，且不超过 imageSidePixels（防止宽 1、高一百万这种畸形输入）。 */
function isPixelSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CANVAS_LIMITS.imageSidePixels;
}

function sanitizeImage(input: Loose, base: CanvasElementBase): CanvasElement | null {
  const width = input['pixelWidth'];
  const height = input['pixelHeight'];
  if (!isPixelSide(width) || !isPixelSide(height)) {
    return null;
  }
  const rawPixels = input['pixels'];
  // 先按长度拒绝，再去掉空白：不可信输入传一个几百 MB 的字符串时，不花时间去拷贝、替换它。
  if (typeof rawPixels !== 'string' || rawPixels.length > MAX_IMAGE_BASE64_LENGTH) {
    return null;
  }
  const pixels = rawPixels.replace(/\s/g, '');
  if (!BASE64_PATTERN.test(pixels)) {
    return null;
  }
  const bytes = width * height;
  if (bytes > CANVAS_LIMITS.imageBytes || base64ByteLength(pixels) !== bytes) {
    return null;
  }
  return {
    ...base,
    kind: 'image',
    pixels,
    pixelWidth: width,
    pixelHeight: height,
    mode: pick(input['mode'], IMAGE_MODES, DEFAULT_IMAGE_MODE),
    threshold: Math.round(clamp(input['threshold'], 0, 255, DEFAULT_IMAGE_THRESHOLD)),
  };
}

/** base64 解码后的字节数（不真的解码）。 */
function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function sanitizeTable(input: Loose, base: CanvasElementBase, borderFallback: number): CanvasElement {
  // 行高夹到元素高度以内、列宽夹到元素宽度以内：既防止 1.7e308 这类畸形输入累加成 Infinity，
  // 也保证单独一行/一列不会比整个表格元素还大。
  const rowsMm = sanitizeSizes(input['rowsMm'], CANVAS_LIMITS.tableRows, base.height, [base.height]);
  const columnsMm = sanitizeSizes(input['columnsMm'], CANVAS_LIMITS.tableColumns, base.width, [base.width]);
  const rowsInput = Array.isArray(input['cells']) ? input['cells'] : [];
  const cells: CanvasTableCell[][] = rowsMm.map((_, row) => {
    const rowInput = Array.isArray(rowsInput[row]) ? (rowsInput[row] as unknown[]) : [];
    return columnsMm.map((__, column) => sanitizeCell(rowInput[column]));
  });
  return {
    ...base,
    kind: 'table',
    rowsMm,
    columnsMm,
    borderMm: clamp(input['borderMm'], CANVAS_LIMITS.borderMm.min, CANVAS_LIMITS.borderMm.max, borderFallback),
    cells,
  };
}

/** 行高、列宽：夹到 [0, max] 内，至少一项，最多 limit 项；最后一项排版时按剩下的算，这里不管。 */
function sanitizeSizes(value: unknown, limit: number, max: number, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const sizes = value.slice(0, limit).map((size) => clamp(size, 0, max, 0));
  return sizes.length > 0 ? sizes : fallback;
}

function sanitizeCell(value: unknown): CanvasTableCell {
  const input = asLoose(value);
  const { fontSizeMm } = CANVAS_LIMITS;
  return {
    text: sanitizeText(input['text'], CANVAS_LIMITS.textLength, DEFAULT_TABLE_CELL.text),
    fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, DEFAULT_TABLE_CELL.fontSizeMm),
    bold: bool(input['bold'], DEFAULT_TABLE_CELL.bold),
    align: pick(input['align'], TEXT_ALIGNS, DEFAULT_TABLE_CELL.align),
  };
}
