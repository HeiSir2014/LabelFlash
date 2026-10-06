/**
 * 画布上的点中测试：按下的位置落在哪个元素上。纯函数，不碰 DOM。
 * 不能按覆盖层上框的 DOM 顺序认：一个画满纸的边框矩形会盖住下面所有元素，点哪里都选中它、框选也开始不了。
 * 参考产品的做法：只有边框的形状只在边框附近算点中，框里面的点击落到下面的元素上。
 */
import type { CanvasElement } from '../../../core/templates/canvas-model';
import type { Box, Point } from './canvas-edit';
import { pxToMm } from './canvas-view';

/** 只有边框的矩形、细线：离描边 4 个屏幕像素以内算点中——0.25mm 的线在屏幕上只有一两个像素，不放宽点不中。 */
export const STROKE_HIT_PX = 4;
/** 实心元素（文字、条码、图片……）往外多算 3 个屏幕像素：很小的元素也好点。 */
export const BOX_HIT_SLOP_PX = 3;

function grow(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
}

function contains(box: Box, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

/** 只画边框、里面是空的：点在里面应该落到下面的元素上。 */
function isOutlineOnly(element: CanvasElement): element is Extract<CanvasElement, { kind: 'rect' }> {
  return element.kind === 'rect' && !element.filled;
}

function isHit(element: CanvasElement, point: Point, zoom: number): boolean {
  if (isOutlineOnly(element)) {
    const tolerance = pxToMm(STROKE_HIT_PX, zoom);
    if (!contains(grow(element, tolerance), point)) {
      return false;
    }
    // 描边往里 borderMm，再加容差：比这更靠里的是「框里面」。框很小、里面什么也不剩时整个框都算描边。
    const inset = element.borderMm + tolerance;
    const inner = grow(element, -inset);
    return inner.width <= 0 || inner.height <= 0 || !contains(inner, point);
  }
  const slop = pxToMm(element.kind === 'line' ? STROKE_HIT_PX : BOX_HIT_SLOP_PX, zoom);
  return contains(grow(element, slop), point);
}

/**
 * 点下去落在哪些元素上，上层在前（数组后面的在上层）。锁定的不算：锁定就是防误碰，只能在图层列表里选它。
 * 设计器里隐藏的元素由调用方先去掉。
 */
export function hitStack(elements: readonly CanvasElement[], point: Point, zoom: number): string[] {
  const hits: string[] = [];
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element !== undefined && !element.locked && isHit(element, point, zoom)) {
      hits.push(element.id);
    }
  }
  return hits;
}

/** 点中的最上层元素；落在空白处（或只有锁定的元素）时为 null，调用方开始框选。 */
export function hitTest(elements: readonly CanvasElement[], point: Point, zoom: number): string | null {
  return hitStack(elements, point, zoom)[0] ?? null;
}

/**
 * Alt+点击轮流选叠在一起的元素：选中的那个在这一叠里时，换成它下面的一个（到底了回到最上面）；
 * 这一叠里一个也没选中时从最上面开始。
 */
export function nextInStack(stack: readonly string[], selection: readonly string[]): string | null {
  if (stack.length === 0) {
    return null;
  }
  const current = stack.findIndex((id) => selection.includes(id));
  return stack[(current + 1) % stack.length] ?? null;
}
