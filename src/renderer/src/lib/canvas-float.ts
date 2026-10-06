/**
 * 跟着选中走的浮动工具条放在哪：选框上方居中，上方放不下就放下方，都放不下（选中的东西占满了）就贴在可用区域顶上。
 * 和选框之间至少隔 gap（控制点的可点范围再留一点），不盖住控制点。单位都是屏幕像素，以覆盖层左上角为原点。纯函数。
 */
import type { Box } from './canvas-edit';

export interface FloatingPosition {
  left: number;
  top: number;
  placement: 'above' | 'below' | 'inside';
  /**
   * 让不开、还盖着的浮动控件（工具条太宽、挪到它右边就出范围了）：调用方把工具条收窄（折行）到
   * 这个宽度以内再算一次，就能放在控件右边。没盖着时为 null。
   */
  narrowTo: number | null;
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
  /** 别盖住的浮动控件（画布角上的撤销重做、缩放胶囊）：碰上了就往右让开（右边放不下就算了）。 */
  avoid?: readonly Box[];
}

/** 让开浮动控件时留的空隙（px）。 */
const AVOID_GAP_PX = 8;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 碰上了要让开的控件就挪到它右边；挪过去会出范围时保持原位，并给出要收窄到多宽才放得下。 */
function clearOf(
  position: FloatingPosition,
  size: { width: number; height: number },
  avoid: readonly Box[],
  right: number,
): FloatingPosition {
  let { left } = position;
  let narrowTo: number | null = null;
  for (const box of avoid) {
    if (overlaps({ x: left, y: position.top, ...size }, box)) {
      const shifted = box.x + box.width + AVOID_GAP_PX;
      if (shifted + size.width <= right) {
        left = shifted;
      } else {
        narrowTo = right - shifted;
      }
    }
  }
  return { ...position, left, narrowTo };
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
      ? { left, top: above, placement: 'above', narrowTo: null }
      : below + toolbar.height <= bounds.bottom
        ? { left, top: below, placement: 'below', narrowTo: null }
        : { left, top: bounds.top, placement: 'inside', narrowTo: null };
  return clearOf(placed, toolbar, avoid, bounds.right);
}
