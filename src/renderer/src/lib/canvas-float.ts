/**
 * 跟着选中走的浮动工具条放在哪：选框上方居中，上方放不下就放下方，都放不下（选中的东西占满了）就贴在可用区域顶上。
 * 和选框之间至少隔 gap（控制点的可点范围再留一点），不盖住控制点。单位都是屏幕像素，以覆盖层左上角为原点。纯函数。
 */
import type { Box } from './canvas-edit';

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
}

export function floatingToolbarPosition({
  selection,
  toolbar,
  bounds,
  gap,
  gapBelow = gap,
}: FloatingInput): FloatingPosition {
  const centred = selection.x + selection.width / 2 - toolbar.width / 2;
  const left = Math.max(bounds.left, Math.min(bounds.right - toolbar.width, centred));
  const above = selection.y - gap - toolbar.height;
  if (above >= bounds.top) {
    return { left, top: above, placement: 'above' };
  }
  const below = selection.y + selection.height + gapBelow;
  if (below + toolbar.height <= bounds.bottom) {
    return { left, top: below, placement: 'below' };
  }
  return { left, top: bounds.top, placement: 'inside' };
}
