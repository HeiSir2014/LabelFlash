import type { ScanResult } from '../scan/scan-result';
import { expandVariables, NOTE_VARIABLES, variableNames } from './note-text';
import type { TextAlign } from './template-model';
import { LINE_HEIGHT } from './text-fit';
import {
  isSplit,
  type SplitDirection,
  type VerticalAlign,
  WAYBILL_LIMITS,
  type WaybillContent,
  type WaybillNode,
  type WaybillParagraph,
  type WaybillTemplate,
} from './waybill-model';

/**
 * 面单排版：把分割树切成一个个格子和线，算好每一格的文字怎么折行、用多大字号。
 * 打印窗口不运行脚本，位置和换行都要在生成 HTML 之前算好；预览和打印共用这份结果。
 *
 * 所有边界先换算成打印点再取整：相邻两格的边界是同一个整数点，线宽是整数个点，打出来粗细一致、不发虚。
 */

/** 格子内边距（mm）：左右 0.8、上下 0.5，文字不会贴着线。 */
export const CELL_PADDING_MM = { x: 0.8, y: 0.5 } as const;
/** 线至少 0.25mm（203dpi 上 2 个点）：1 个点（0.125mm）的线在热敏纸上时断时续；高分辨率时按毫米算，不会更细。 */
const MIN_LINE_MM = 0.25;
/** 放不下时字号最多缩到原来的 60%，再小就截断：远看还认得出是哪一行。 */
export const MIN_TEXT_SCALE = 0.6;
const SCALE_STEP = 0.05;
const FONT_SIZE_STEP_PER_MM = 10;
const ELLIPSIS = '…';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLine {
  text: string;
  fontSizeMm: number;
  bold: boolean;
}

export type LaidContent =
  | {
      kind: 'text';
      lines: TextLine[];
      align: TextAlign;
      valign: VerticalAlign;
      inverse: boolean;
      /** 缩到最小字号仍放不下，已截断。 */
      overflow: boolean;
    }
  | { kind: 'barcode'; value: string; showText: boolean; textSizeMm: number; vertical: boolean }
  | { kind: 'qr'; value: string }
  | { kind: 'empty' };

export interface LaidCell {
  rect: Rect;
  content: LaidContent;
}

export interface LaidRule {
  rect: Rect;
  style: 'solid' | 'dashed';
  /** horizontal = 行与行之间的横线；vertical = 格与格之间的竖线。 */
  orientation: 'horizontal' | 'vertical';
}

export interface WaybillLayout {
  cells: LaidCell[];
  rules: LaidRule[];
  /** 放不下、被截断的格子数。 */
  overflowCells: number;
}

export interface LayoutContext {
  scan: ScanResult;
  printedAt: Date;
  /** 打印机一个点有多少毫米（203dpi ≈ 0.125）。 */
  dotMm: number;
}

export function layoutWaybill(template: WaybillTemplate, context: LayoutContext): WaybillLayout {
  const { paper, marginsMm } = template;
  const dots = (mm: number) => Math.round(mm / context.dotMm);
  const page: DotRect = {
    x: dots(marginsMm.left),
    y: dots(marginsMm.top),
    width: dots(paper.widthMm - marginsMm.left - marginsMm.right),
    height: dots(paper.heightMm - marginsMm.top - marginsMm.bottom),
  };
  const lineDots = Math.max(1, dots(MIN_LINE_MM), dots(template.lineWidthMm));
  const cells: LaidCell[] = [];
  const rules: LaidRule[] = [];
  const toMm = (rect: DotRect): Rect => ({
    x: rect.x * context.dotMm,
    y: rect.y * context.dotMm,
    width: rect.width * context.dotMm,
    height: rect.height * context.dotMm,
  });

  const place = (node: WaybillNode, rect: DotRect) => {
    if (!isSplit(node.body)) {
      cells.push({ rect: toMm(rect), content: layoutContent(node.body.content, toMm(rect), context) });
      return;
    }
    const { split, children } = node.body;
    const along = split === 'rows' ? rect.height : rect.width;
    const sizes = resolveSizes(
      children.map((child) => child.sizeMm),
      along * context.dotMm,
    );
    let offsetMm = 0;
    let start = 0;
    children.forEach((child, index) => {
      offsetMm += sizes[index] ?? 0;
      const end = index === children.length - 1 ? along : Math.min(along, dots(offsetMm));
      const childRect = sliceRect(rect, split, start, end);
      place(child, childRect);
      if (index < children.length - 1 && child.ruleAfter !== 'none') {
        rules.push({
          rect: toMm(ruleRect(rect, split, end, lineDots)),
          style: child.ruleAfter,
          orientation: split === 'rows' ? 'horizontal' : 'vertical',
        });
      }
      start = end;
    });
  };
  place(template.root, page);
  const overflowCells = cells.filter((cell) => cell.content.kind === 'text' && cell.content.overflow).length;
  return { cells, rules, overflowCells };
}

interface DotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 每个子项的尺寸：前面的照给定值，最后一项占剩下的。前面的加起来太大（例如换成更短的纸）时按比例缩小，
 * 给最后一项留出最小尺寸；连最小尺寸都放不下时平均分。
 */
export function resolveSizes(sizes: readonly number[], totalMm: number): number[] {
  if (sizes.length === 0) {
    return [];
  }
  const { minSizeMm } = WAYBILL_LIMITS;
  const fixed = sizes.slice(0, -1).map((size) => Math.max(minSizeMm, size));
  const fixedTotal = fixed.reduce((sum, size) => sum + size, 0);
  if (totalMm < sizes.length * minSizeMm) {
    return sizes.map(() => totalMm / sizes.length);
  }
  if (fixedTotal + minSizeMm <= totalMm) {
    return [...fixed, totalMm - fixedTotal];
  }
  const scale = (totalMm - minSizeMm) / fixedTotal;
  const scaled = fixed.map((size) => size * scale);
  return [...scaled, minSizeMm];
}

function sliceRect(rect: DotRect, split: SplitDirection, start: number, end: number): DotRect {
  return split === 'rows'
    ? { x: rect.x, y: rect.y + start, width: rect.width, height: end - start }
    : { x: rect.x + start, y: rect.y, width: end - start, height: rect.height };
}

/** 线以边界为中心，宽 lineDots 个点，长度是整个父格子。 */
function ruleRect(rect: DotRect, split: SplitDirection, boundary: number, lineDots: number): DotRect {
  const before = Math.floor(lineDots / 2);
  return split === 'rows'
    ? { x: rect.x, y: rect.y + boundary - before, width: rect.width, height: lineDots }
    : { x: rect.x + boundary - before, y: rect.y, width: lineDots, height: rect.height };
}

function layoutContent(content: WaybillContent, rect: Rect, context: LayoutContext): LaidContent {
  switch (content.kind) {
    case 'empty':
      return content;
    case 'qr':
      return { kind: 'qr', value: expand(content.value, context) };
    case 'barcode':
      return {
        kind: 'barcode',
        value: expand(content.value, context),
        showText: content.showText,
        textSizeMm: content.textSizeMm,
        vertical: content.vertical,
      };
    case 'text': {
      const paragraphs = content.paragraphs
        .map((paragraph) => ({ ...paragraph, text: expandParagraph(paragraph.text, context) }))
        .filter((paragraph): paragraph is WaybillParagraph => paragraph.text !== null);
      const fitted = fitParagraphs(paragraphs, rect.width - 2 * CELL_PADDING_MM.x, rect.height - 2 * CELL_PADDING_MM.y);
      return { kind: 'text', align: content.align, valign: content.valign, inverse: content.inverse, ...fitted };
    }
  }
}

function expand(text: string, context: LayoutContext): string {
  return expandVariables(text, context.scan, context.printedAt, (value) => value, 'empty');
}

const FIXED_VARIABLES: ReadonlySet<string> = new Set(NOTE_VARIABLES.map((variable) => variable.slice(1, -1)));

/**
 * 展开一段文字的变量。段落里有字段变量、而这些字段全都是空的，整段不印（返回 null）：
 * 例如没有代收货款时，「代收货款：{代收货款}」这一行不出现。只有固定文字的段落照常印。
 */
export function expandParagraph(text: string, context: Pick<LayoutContext, 'scan' | 'printedAt'>): string | null {
  const fields = variableNames(text).filter((name) => !FIXED_VARIABLES.has(name));
  const hasValue = fields.some(
    (name) => (context.scan.fields.find((field) => field.name === name)?.value ?? '') !== '',
  );
  if (fields.length > 0 && !hasValue) {
    return null;
  }
  return expandVariables(text, context.scan, context.printedAt, (value) => value, 'empty');
}

interface FittedText {
  lines: TextLine[];
  overflow: boolean;
}

/**
 * 整格的段落同比缩小，找放得下的最大字号；最小（原字号的 60%）仍放不下时，装到格高为止，
 * 最后一行截断加「…」并标记 overflow。宁可让人看出被截断，也不悄悄裁掉。
 */
export function fitParagraphs(paragraphs: readonly WaybillParagraph[], widthMm: number, heightMm: number): FittedText {
  if (paragraphs.length === 0) {
    return { lines: [], overflow: false };
  }
  for (let scale = 1; scale >= MIN_TEXT_SCALE - 1e-9; scale -= SCALE_STEP) {
    const attempt = linesAt(paragraphs, widthMm, scale);
    if (attempt.fitsWidth && blockHeightMm(attempt.lines) <= heightMm + 1e-9) {
      return { lines: attempt.lines, overflow: false };
    }
  }
  return clampLines(linesAt(paragraphs, widthMm, MIN_TEXT_SCALE).lines, widthMm, heightMm);
}

export function blockHeightMm(lines: readonly TextLine[]): number {
  return lines.reduce((sum, line) => sum + line.fontSizeMm * LINE_HEIGHT, 0);
}

function linesAt(paragraphs: readonly WaybillParagraph[], widthMm: number, scale: number) {
  const lines: TextLine[] = [];
  let fitsWidth = true;
  for (const paragraph of paragraphs) {
    const fontSizeMm = scaledSize(paragraph.fontSizeMm, scale);
    if (paragraph.wrap) {
      for (const text of wrapText(paragraph.text, widthMm, fontSizeMm)) {
        lines.push({ text, fontSizeMm, bold: paragraph.bold });
      }
      continue;
    }
    const text = paragraph.text.replace(/\s*\n\s*/g, ' ');
    if (textWidthMm(text, fontSizeMm) > widthMm + 1e-9) {
      fitsWidth = false;
    }
    lines.push({ text, fontSizeMm, bold: paragraph.bold });
  }
  return { lines, fitsWidth };
}

/** 缩小后的字号向下取到 0.1mm（向上取会再次超出），不小于最小字号。 */
function scaledSize(fontSizeMm: number, scale: number): number {
  if (scale >= 1) {
    return fontSizeMm;
  }
  const rounded = Math.floor(fontSizeMm * scale * FONT_SIZE_STEP_PER_MM + 1e-9) / FONT_SIZE_STEP_PER_MM;
  return Math.max(WAYBILL_LIMITS.fontSizeMm.min, rounded);
}

function clampLines(lines: readonly TextLine[], widthMm: number, heightMm: number): FittedText {
  const kept: TextLine[] = [];
  let used = 0;
  let overflow = false;
  for (const line of lines) {
    const height = line.fontSizeMm * LINE_HEIGHT;
    // 第一行无论如何都留着：格子比一行还矮时，被格子边缘裁掉一点也比整格空白好认。
    if (kept.length > 0 && used + height > heightMm + 1e-9) {
      overflow = true;
      break;
    }
    const tooWide = textWidthMm(line.text, line.fontSizeMm) > widthMm + 1e-9;
    kept.push(tooWide ? { ...line, text: ellipsize(line.text, line.fontSizeMm, widthMm) } : line);
    overflow ||= tooWide || used + height > heightMm + 1e-9;
    used += height;
  }
  const last = kept.at(-1);
  if (overflow && last && !last.text.endsWith(ELLIPSIS)) {
    kept[kept.length - 1] = { ...last, text: ellipsize(`${last.text}${ELLIPSIS}`, last.fontSizeMm, widthMm) };
  }
  return { lines: kept, overflow };
}

/** 截到放得下，末尾加「…」。 */
function ellipsize(text: string, fontSizeMm: number, widthMm: number): string {
  const chars = [...text.replace(new RegExp(`${ELLIPSIS}$`), '')];
  while (chars.length > 0 && textWidthMm(`${chars.join('')}${ELLIPSIS}`, fontSizeMm) > widthMm) {
    chars.pop();
  }
  return `${chars.join('').trimEnd()}${ELLIPSIS}`;
}

export function textWidthMm(text: string, fontSizeMm: number): number {
  let em = 0;
  for (const char of text) {
    em += charWidthEm(char);
  }
  return em * fontSizeMm;
}

/**
 * 面单文字的字宽（em）。面单每一行都单独画、不让浏览器折行，估窄了字就被格子边缘裁掉，所以按实测取上限：
 * 2026-10-01 在 Edge 里量微软雅黑粗体（比常规体宽 3%–5%，也比苹方宽），每类取最宽的字再留一点余量。
 * 标签模板用的 text-fit 估算偏窄（例如数字 1 当窄字），面单不用它。
 */
const WAYBILL_EM = {
  wide: 1,
  digit: 0.63,
  upper: 0.86,
  upperWide: 1.1,
  lower: 0.68,
  lowerWide: 1,
  thin: 0.36,
  bracket: 0.48,
  dash: 0.46,
  space: 0.31,
  times: 0.78,
  other: 0.92,
} as const;

/** 全角：CJK、全角标点和符号、韩文；省略号在雅黑粗体里接近一个字宽，也按全角算。 */
const WIDE_CHAR = /[ᄀ-ᅟ…⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const THIN_CHARS = new Set([..."iIjl.,:;!'`|"]);
const BRACKET_CHARS = new Set([...'()[]{}/\\']);

function charWidthEm(char: string): number {
  if (WIDE_CHAR.test(char)) return WAYBILL_EM.wide;
  if (char >= '0' && char <= '9') return WAYBILL_EM.digit;
  if ('MW@%—'.includes(char)) return WAYBILL_EM.upperWide;
  if (char >= 'A' && char <= 'Z') return WAYBILL_EM.upper;
  if (char === 'm' || char === 'w') return WAYBILL_EM.lowerWide;
  if (THIN_CHARS.has(char)) return WAYBILL_EM.thin;
  if (char >= 'a' && char <= 'z') return WAYBILL_EM.lower;
  if (BRACKET_CHARS.has(char)) return WAYBILL_EM.bracket;
  if (char === '-' || char === '_') return WAYBILL_EM.dash;
  if (char === ' ') return WAYBILL_EM.space;
  if (char === '×') return WAYBILL_EM.times;
  return WAYBILL_EM.other;
}

/** 句末标点：跟着前一个字，不落在行首。 */
const CLOSING_PUNCTUATION = '，。、；：！？）》」』”’,.;:!?)';
const TOKEN_PATTERN = new RegExp(
  `[A-Za-z0-9.\\-_/#@*+]+[${CLOSING_PUNCTUATION}]*|\\s+|[^\\s][${CLOSING_PUNCTUATION}]*`,
  'gu',
);

/**
 * 按格宽折行：西文和数字连成一段不拆开（比一整行还长才逐字拆），句末标点跟着前一个字；
 * 字段值里的换行照样换行，空白行去掉。
 */
export function wrapText(text: string, widthMm: number, fontSizeMm: number): string[] {
  const lines: string[] = [];
  for (const segment of text.split('\n')) {
    let line = '';
    const push = () => {
      if (line.trim() !== '') {
        lines.push(line.trim());
      }
      line = '';
    };
    for (const token of segment.match(TOKEN_PATTERN) ?? []) {
      if (textWidthMm(line + token, fontSizeMm) <= widthMm + 1e-9) {
        line += token;
        continue;
      }
      push();
      if (/^\s+$/.test(token)) {
        continue;
      }
      if (textWidthMm(token, fontSizeMm) <= widthMm + 1e-9) {
        line = token;
        continue;
      }
      for (const char of token) {
        if (line !== '' && textWidthMm(line + char, fontSizeMm) > widthMm + 1e-9) {
          push();
        }
        line += char;
      }
    }
    push();
  }
  return lines;
}
