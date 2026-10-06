/**
 * 就地改字：双击文字（或表格的一格）时，在画布上盖一个和它同样大小、字号、粗细、对齐的输入框。
 * 这里只算盖在哪、长什么样，以及改完怎么写回模板。纯函数。
 */
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasTemplate,
  type Rotation,
} from '../../../core/templates/canvas-model';
import type { TextAlign } from '../../../core/templates/template-model';
import { type Box, replaceElement } from './canvas-edit';
import { type TableCellHit, updateTableCell } from './canvas-table';

/** 正在改哪一个：文字元素（cell 为 null），或表格的某一格。 */
export interface InlineTarget {
  elementId: string;
  cell: { row: number; column: number } | null;
}

export interface InlineEditorLayout {
  /** 输入框盖住的框（mm）：文字是元素的框，表格是那一格。 */
  box: Box;
  text: string;
  fontSizeMm: number;
  bold: boolean;
  align: TextAlign;
  /** 文字转过时输入框跟着转（和打印的画法一样），读起来和画布上一个方向。 */
  rotation: Rotation;
}

/** 能就地改的只有文字和（没转过的）表格格子；别的返回 null。 */
export function inlineEditorLayout(element: CanvasElement, cell: TableCellHit | null): InlineEditorLayout | null {
  if (element.kind === 'text') {
    return {
      box: { x: element.x, y: element.y, width: element.width, height: element.height },
      text: element.text,
      fontSizeMm: element.fontSizeMm,
      bold: element.bold,
      align: element.align,
      rotation: element.rotation,
    };
  }
  if (element.kind === 'table' && cell !== null) {
    const content = element.cells[cell.row]?.[cell.column];
    if (content === undefined) {
      return null;
    }
    return {
      box: cell.box,
      text: content.text,
      fontSizeMm: content.fontSizeMm,
      bold: content.bold,
      align: content.align,
      rotation: 0,
    };
  }
  return null;
}

/** 改完写回模板（一次 commit、一步撤销）；元素已经不在了（比如这期间被撤销掉）时原样返回。 */
export function applyInlineEdit(template: CanvasTemplate, target: InlineTarget, text: string): CanvasTemplate {
  const element = template.elements.find((candidate) => candidate.id === target.elementId);
  const clipped = text.slice(0, CANVAS_LIMITS.textLength);
  if (element?.kind === 'text') {
    return replaceElement(template, { ...element, text: clipped });
  }
  if (element?.kind === 'table' && target.cell !== null) {
    return replaceElement(template, updateTableCell(element, target.cell.row, target.cell.column, { text: clipped }));
  }
  return template;
}
