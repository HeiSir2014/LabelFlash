/**
 * 图层列表、右键菜单里元素的叫法。新元素的名字是「文字」「文字 2」这类编号，一列下来分不清谁是谁；
 * 操作员没改过名字时，用内容摘要（「品名：{编码}」「条码 {编码}」）代替。纯函数。
 */
import { CANVAS_ELEMENT_LABELS, type CanvasElement } from '../../../core/templates/canvas-model';

/** 摘要最多 12 个字：图层列表一行放得下，后面还要留出种类和两个按钮。 */
export const DISPLAY_NAME_LENGTH = 12;

const ELLIPSIS = '…';

/** 名字还是新建时的默认名（「文字」「文字 2」）：操作员没给它起过名字。 */
function hasDefaultName(element: CanvasElement): boolean {
  const label = CANVAS_ELEMENT_LABELS[element.kind];
  return element.name === label || new RegExp(`^${label} \\d+$`).test(element.name);
}

/** 按字（码点）截断：中文、表情都不会被切成半个。 */
function clip(text: string): string {
  const characters = [...text];
  return characters.length <= DISPLAY_NAME_LENGTH
    ? text
    : `${characters.slice(0, DISPLAY_NAME_LENGTH - 1).join('')}${ELLIPSIS}`;
}

/** 有内容可摘的元素的摘要；没有内容（图片、形状，或内容是空的）时为 null。 */
function summaryOf(element: CanvasElement): string | null {
  switch (element.kind) {
    case 'text': {
      const firstLine = element.text.split('\n').find((line) => line.trim() !== '');
      return firstLine === undefined ? null : firstLine.trim();
    }
    case 'barcode':
    case 'qr':
      return element.value.trim() === '' ? null : `${CANVAS_ELEMENT_LABELS[element.kind]} ${element.value.trim()}`;
    case 'table':
      return `${CANVAS_ELEMENT_LABELS.table} ${element.columnsMm.length}×${element.rowsMm.length}`;
    case 'image':
    case 'line':
    case 'rect':
      return null;
  }
}

/** 元素给人看的叫法：起过名字的用名字；没起过的用内容摘要，没有内容可摘时用默认名。 */
export function displayName(element: CanvasElement): string {
  if (!hasDefaultName(element)) {
    return element.name;
  }
  const summary = summaryOf(element);
  // 新文字的内容还是占位的「文字」：摘要和种类名一样，几个新文字分不清，用带编号的名字（「文字 2」）。
  if (summary === CANVAS_ELEMENT_LABELS[element.kind]) {
    return element.name;
  }
  if (summary === null) {
    // 内容是空的文字、条码：「文字 2」的编号没有意义，只说种类；图片、形状保留编号，几个之间还分得清。
    return element.kind === 'text' || element.kind === 'barcode' || element.kind === 'qr'
      ? CANVAS_ELEMENT_LABELS[element.kind]
      : element.name;
  }
  return clip(summary);
}
