/**
 * 跟着选中走的浮动工具条：放哪些按钮、放在哪。纯函数。
 * 位置：选框上方居中，上方放不下就放下方，都放不下（选中的东西占满了）就贴在可用区域顶上。
 * 和选框之间至少隔 gap（控制点的可点范围再留一点），不盖住控制点。单位都是屏幕像素，以覆盖层左上角为原点。
 */
import type { CanvasElementKind } from '../../../core/templates/canvas-model';
import type { TextAlign } from '../../../core/templates/template-model';
import type { Box } from './canvas-edit';

/**
 * 工具条上的一样东西。fontSize 是「− 字号 +」三件一组，alignElements 是六个对齐按钮一组，其余各一个按钮。
 * 锁定、叠放、等距都不在这里：收在「⋯」打开的菜单里，工具条保持一行、六到八个按钮。
 */
export type FloatingTool =
  | 'fontSize'
  | 'bold'
  | 'textAlign'
  | 'editText'
  | 'field'
  | 'grow'
  | 'alignElements'
  | 'duplicate'
  | 'delete'
  | 'more';

/** 每样占几个按钮（「− 字号 +」里的数字不算按钮）。 */
export const FLOATING_CONTROL_COUNT: Readonly<Record<FloatingTool, number>> = {
  fontSize: 2,
  bold: 1,
  textAlign: 1,
  editText: 1,
  field: 1,
  grow: 1,
  alignElements: 6,
  duplicate: 1,
  delete: 1,
  more: 1,
};

const COMMON_TOOLS: readonly FloatingTool[] = ['duplicate', 'delete', 'more'];

/**
 * 这次选中的东西工具条上放什么：文字是字号、加粗、对齐、改字；条码二维码是绑定字段、印不出时「放大到能印」；
 * 选中几个时是对齐；最后都是复制一份、删除和「⋯」。canGrow：选中的条码（二维码）现在印不出、能放大。
 */
export function floatingTools(selection: { kinds: readonly CanvasElementKind[]; canGrow: boolean }): FloatingTool[] {
  const [kind] = selection.kinds;
  if (selection.kinds.length > 1) {
    return ['alignElements', ...COMMON_TOOLS];
  }
  switch (kind) {
    case 'text':
      return ['fontSize', 'bold', 'textAlign', 'editText', ...COMMON_TOOLS];
    case 'barcode':
    case 'qr':
      return selection.canGrow ? ['field', 'grow', ...COMMON_TOOLS] : ['field', ...COMMON_TOOLS];
    default:
      return [...COMMON_TOOLS];
  }
}

const TEXT_ALIGN_CYCLE: readonly TextAlign[] = ['left', 'center', 'right'];

/** 工具条上的「对齐」只有一个按钮：点一下换成下一种（靠左 → 居中 → 靠右 → 靠左）。 */
export function nextTextAlign(current: TextAlign): TextAlign {
  const index = TEXT_ALIGN_CYCLE.indexOf(current);
  return TEXT_ALIGN_CYCLE[(index + 1) % TEXT_ALIGN_CYCLE.length] ?? 'left';
}

export interface FloatingPosition {
  left: number;
  top: number;
  placement: 'above' | 'below' | 'inside';
}

interface FloatingInput {
  /** 选中的东西合起来的框。 */
  selection: Box;
  toolbar: { width: number; height: number };
  /** 工具条能放的范围（滚动区里覆盖层四周还留着的地方也算），超出会被滚动区裁掉。 */
  bounds: { left: number; top: number; right: number; bottom: number };
  gap: number;
  /** 放在下方时和选框隔多远：下方还有旋转手柄，要隔得更远；不给就和 gap 一样。 */
  gapBelow?: number;
  /** 别盖住的浮动控件（画布角上的撤销重做、缩放胶囊）：碰上了就往右让开，右边放不下就往下让开。 */
  avoid?: readonly Box[];
}

/** 让开浮动控件时留的空隙（px）。 */
const AVOID_GAP_PX = 8;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 碰上了要让开的控件：挪到它右边；挪过去会出范围（工具条一行不折，不能收窄）就挪到它下面。 */
function clearOf(
  position: FloatingPosition,
  size: { width: number; height: number },
  avoid: readonly Box[],
  right: number,
): FloatingPosition {
  let { left, top } = position;
  for (const box of avoid) {
    if (overlaps({ x: left, y: top, ...size }, box)) {
      const shifted = box.x + box.width + AVOID_GAP_PX;
      if (shifted + size.width <= right) {
        left = shifted;
      } else {
        top = box.y + box.height + AVOID_GAP_PX;
      }
    }
  }
  return { ...position, left, top };
}

export function floatingToolbarPosition({
  selection,
  toolbar,
  bounds,
  gap,
  gapBelow = gap,
  avoid = [],
}: FloatingInput): FloatingPosition {
  const centred = selection.x + selection.width / 2 - toolbar.width / 2;
  const left = Math.max(bounds.left, Math.min(bounds.right - toolbar.width, centred));
  const above = selection.y - gap - toolbar.height;
  const below = selection.y + selection.height + gapBelow;
  const placed: FloatingPosition =
    above >= bounds.top
      ? { left, top: above, placement: 'above' }
      : below + toolbar.height <= bounds.bottom
        ? { left, top: below, placement: 'below' }
        : { left, top: bounds.top, placement: 'inside' };
  return clearOf(placed, toolbar, avoid, bounds.right);
}
