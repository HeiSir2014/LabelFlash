import type { ScanResult } from '../scan/scan-result';
import {
  CANVAS_LIMITS,
  type CanvasBarcode,
  type CanvasElement,
  type CanvasImage,
  type CanvasQr,
  type CanvasTable,
  type CanvasTemplate,
  type CanvasText,
  type Rotation,
} from './canvas-model';
import { expandVariables } from './note-text';
import type { TextAlign } from './template-model';
import { FLOAT_EPSILON } from './text-fit';
import {
  CELL_PADDING_MM,
  expandParagraph,
  fitParagraphs,
  type Rect,
  resolveSizes,
  type TextLine,
} from './waybill-layout';
import type { VerticalAlign } from './waybill-model';

/**
 * 自由设计模板的排版：位置大小取整到打印点、展开变量、排文字、切表格，并列出打印前检查的问题。
 * 条码、二维码、图片的点阵在主进程画（要编码），这里只给出它们的框和展开后的内容。
 */

export interface CanvasLayoutContext {
  scan: ScanResult;
  printedAt: Date;
  /** 打印机一个点有多少毫米（203dpi ≈ 0.125）。 */
  dotMm: number;
}

export type LaidCanvasContent =
  | { kind: 'text'; lines: TextLine[]; align: TextAlign; valign: VerticalAlign; inverse: boolean }
  | { kind: 'barcode'; element: CanvasBarcode; value: string }
  | { kind: 'qr'; element: CanvasQr; value: string }
  | { kind: 'image'; element: CanvasImage }
  | { kind: 'line'; dashed: boolean }
  | { kind: 'rect'; borderMm: number; filled: boolean; radiusMm: number }
  | {
      kind: 'table';
      /** 行高、列宽（mm），取整到打印点，加起来正好是框的高、宽。 */
      rows: number[];
      columns: number[];
      borderMm: number;
      cells: { lines: TextLine[]; align: TextAlign }[][];
    };

export interface LaidCanvasElement {
  /** 元素在纸上占的框（转过之后），取整到打印点。 */
  rect: Rect;
  /** 没转之前的内容框：转 90° / 270° 时宽高对调。 */
  frame: { width: number; height: number };
  rotation: Rotation;
  name: string;
  content: LaidCanvasContent;
}

export interface CanvasLayout {
  elements: LaidCanvasElement[];
  /** 打印前检查：给人看的中文，每条指出是哪个元素。 */
  issues: string[];
  /** 文字缩到最小仍放不下、被截断的元素数。 */
  overflowCount: number;
}

/** 表格每格的内边距沿用面单的格子。 */
const TABLE_CELL_PADDING_MM = CELL_PADDING_MM;

export function layoutCanvas(template: CanvasTemplate, context: CanvasLayoutContext): CanvasLayout {
  const issues: string[] = [];
  const elements: LaidCanvasElement[] = [];
  let overflowCount = 0;
  for (const element of template.elements) {
    const rect = snapRect(element, context.dotMm);
    const turned = element.rotation === 90 || element.rotation === 270;
    const frame = turned ? { width: rect.height, height: rect.width } : { width: rect.width, height: rect.height };
    const laid = layoutContent(element, frame, context);
    if (laid.overflow) {
      overflowCount += 1;
      issues.push(`文字「${element.name}」放不下，已截断：加大文字框或调小字号`);
    }
    if (laid.issue !== null) {
      issues.push(laid.issue);
    }
    if (laid.content === null) {
      continue;
    }
    if (isNearEdge(rect, template.paper.widthMm, template.paper.heightMm)) {
      issues.push(`「${element.name}」靠近纸边（离纸边不到 ${CANVAS_LIMITS.safeMarginMm}mm），可能打不全`);
    }
    elements.push({ rect, frame, rotation: element.rotation, name: element.name, content: laid.content });
  }
  return { elements, issues, overflowCount };
}

/** 四条边各自取整到最近的点，宽高是取整后的差（至少 1 个点）：相邻元素的边对得上。 */
function snapRect(element: CanvasElement, dot: number): Rect {
  const left = Math.round(element.x / dot);
  const top = Math.round(element.y / dot);
  const right = Math.max(left + 1, Math.round((element.x + element.width) / dot));
  const bottom = Math.max(top + 1, Math.round((element.y + element.height) / dot));
  return { x: left * dot, y: top * dot, width: (right - left) * dot, height: (bottom - top) * dot };
}

function isNearEdge(rect: Rect, paperWidth: number, paperHeight: number): boolean {
  const margin = CANVAS_LIMITS.safeMarginMm - FLOAT_EPSILON;
  return (
    rect.x < margin ||
    rect.y < margin ||
    rect.x + rect.width > paperWidth - margin ||
    rect.y + rect.height > paperHeight - margin
  );
}

interface LaidResult {
  /** null = 这一张不印（内容是空的）。 */
  content: LaidCanvasContent | null;
  overflow: boolean;
  issue: string | null;
}

function layoutContent(
  element: CanvasElement,
  frame: { width: number; height: number },
  context: CanvasLayoutContext,
): LaidResult {
  switch (element.kind) {
    case 'text':
      return layoutText(element, frame, context);
    case 'barcode':
    case 'qr': {
      const value = expandVariables(element.value, context.scan, context.printedAt, (text) => text, 'empty').trim();
      if (value === '') {
        const label = element.kind === 'barcode' ? '条码' : '二维码';
        return { content: null, overflow: false, issue: `${label}「${element.name}」这一张没有内容，不印` };
      }
      return {
        content: element.kind === 'barcode' ? { kind: 'barcode', element, value } : { kind: 'qr', element, value },
        overflow: false,
        issue: null,
      };
    }
    case 'image':
      return { content: { kind: 'image', element }, overflow: false, issue: null };
    case 'line':
      return { content: { kind: 'line', dashed: element.dashed }, overflow: false, issue: null };
    case 'rect':
      return {
        content: { kind: 'rect', borderMm: element.borderMm, filled: element.filled, radiusMm: element.radiusMm },
        overflow: false,
        issue: null,
      };
    case 'table':
      return layoutTable(element, frame, context);
  }
}

function layoutText(
  element: CanvasText,
  frame: { width: number; height: number },
  context: CanvasLayoutContext,
): LaidResult {
  const paragraphs = element.text
    .split('\n')
    .map((line) => expandParagraph(line, context))
    .filter((line): line is string => line !== null && line.trim() !== '')
    .map((line) => ({ text: line, fontSizeMm: element.fontSizeMm, bold: element.bold, wrap: element.fit === 'wrap' }));
  if (paragraphs.length === 0) {
    return { content: null, overflow: false, issue: null };
  }
  const fitted = fitParagraphs(paragraphs, frame.width, frame.height);
  return {
    content: {
      kind: 'text',
      lines: fitted.lines,
      align: element.align,
      valign: element.valign,
      inverse: element.inverse,
    },
    overflow: fitted.overflow,
    issue: null,
  };
}

function layoutTable(
  element: CanvasTable,
  frame: { width: number; height: number },
  context: CanvasLayoutContext,
): LaidResult {
  const rows = snapSizes(resolveSizes(element.rowsMm, frame.height), frame.height, context.dotMm);
  const columns = snapSizes(resolveSizes(element.columnsMm, frame.width), frame.width, context.dotMm);
  let overflow = false;
  const cells = rows.map((rowHeight, row) =>
    columns.map((columnWidth, column) => {
      const cell = element.cells[row]?.[column];
      const text = cell
        ? expandVariables(cell.text, context.scan, context.printedAt, (value) => value, 'empty').trim()
        : '';
      if (!cell || text === '') {
        return { lines: [], align: cell?.align ?? 'left' };
      }
      const fitted = fitParagraphs(
        [{ text, fontSizeMm: cell.fontSizeMm, bold: cell.bold, wrap: true }],
        columnWidth - 2 * TABLE_CELL_PADDING_MM.x,
        rowHeight - 2 * TABLE_CELL_PADDING_MM.y,
      );
      overflow ||= fitted.overflow;
      return { lines: fitted.lines, align: cell.align };
    }),
  );
  return {
    content: { kind: 'table', rows, columns, borderMm: element.borderMm, cells },
    overflow,
    issue: null,
  };
}

/** 累计后取整到点：每条格线都落在点上，总和正好等于框的大小。 */
function snapSizes(sizes: readonly number[], totalMm: number, dot: number): number[] {
  const snapped: number[] = [];
  let previous = 0;
  let sum = 0;
  for (const [index, size] of sizes.entries()) {
    sum += size;
    const edge = index === sizes.length - 1 ? totalMm : Math.round(sum / dot) * dot;
    snapped.push(edge - previous);
    previous = edge;
  }
  return snapped;
}
