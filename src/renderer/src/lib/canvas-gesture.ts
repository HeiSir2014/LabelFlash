/**
 * 画布上鼠标（和数位板的笔）操作的纯计算部分：拖动、缩放、旋转的算法，覆盖层要画的内容。
 * 不碰 React、DOM 和指针事件——指针事件的接线、指针捕获、ref 这些留在 view-models/use-canvas-gesture.ts。
 */
import {
  type CanvasElementKind,
  type CanvasTemplate,
  ROTATIONS,
  type Rotation,
} from '../../../core/templates/canvas-model';
import type { PaperSize } from '../../../shared/paper-sizes';
import {
  type Box,
  boxOf,
  clampBox,
  type Point,
  RESIZE_HANDLES,
  type ResizeHandle,
  rectFromPoints,
  resizeBox,
  rotateElement,
} from './canvas-edit';
import { type Guide, type Snapped, type SnapTargets, snapMove, snapResize } from './canvas-snap';

/**
 * 按下后挪动不到 3 个屏幕像素算点击，不算拖动：手抖、数位板的笔尖落下时的抖动不该把元素挪走半毫米。
 * 鼠标和笔（pointerType 'pen'）用同一个阈值，不分设备。
 */
export const DRAG_START_PX = 3;

/** 按下之后挪了这么远（屏幕像素，从按下的位置直线量）算真的拖动了，不是手抖。 */
export function hasPassedDragThreshold(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) >= DRAG_START_PX;
}

interface Pressed {
  /** 按下时指针的屏幕位置：算拖了多远、是不是真的拖了。 */
  client: Point;
  hasMoved: boolean;
}

export interface MoveGesture extends Pressed {
  kind: 'move';
  /** 跟着动的元素（选中的、没锁定的）。 */
  ids: readonly string[];
  /** 这些元素合起来的外框：按下时的、现在的。 */
  start: Box;
  box: Box;
  guides: readonly Guide[];
  /**
   * 按在已经选中的元素上时先不改选中（这样能拖动整组，或拖动 Alt+点击选出的下层元素）；
   * 没拖动就松手时才改选成点中的最上层元素。null 表示松手时不改选中。
   */
  selectOnClick: string | null;
}

export interface ResizeGesture extends Pressed {
  kind: 'resize';
  id: string;
  handle: ResizeHandle;
  start: Box;
  box: Box;
  guides: readonly Guide[];
}

export interface MarqueeGesture extends Pressed {
  kind: 'marquee';
  /** 框选的两个角（纸上的毫米）。 */
  origin: Point;
  current: Point;
  /** 按住 Shift 框选时原来就选中的。 */
  base: readonly string[];
}

/** 拖旋转手柄：只转直角，松手时才改模板。 */
export interface RotateGesture extends Pressed {
  kind: 'rotate';
  id: string;
  /** 元素中心（纸上的毫米）：按指针绕它的方向算转多少。 */
  center: Point;
  startRotation: Rotation;
  rotation: Rotation;
}

export type Gesture = MoveGesture | ResizeGesture | MarqueeGesture | RotateGesture;

/** 天生要保持比例的元素：图片拉变形就失真，二维码本来就是方的。按住 Shift 时反过来。 */
const RATIO_KINDS: ReadonlySet<CanvasElementKind> = new Set(['image', 'qr']);

/** 缩放时要不要保持宽高比：图片、二维码默认保持（Shift 放开），其余按住 Shift 才保持。 */
export function keepsRatio(kind: CanvasElementKind, isShiftHeld: boolean): boolean {
  return RATIO_KINDS.has(kind) !== isShiftHeld;
}

/** 一个直角的度数。 */
const RIGHT_ANGLE_DEG = 90;
const FULL_TURN_DEG = 360;

/**
 * 拖旋转手柄时转到哪个直角：手柄起初在元素正下方，指针绕中心转过的角度（屏幕上顺时针为正）就近取整到 90°，
 * 加到原来的角度上。只转直角：任意角度时边缘落不到打印点上，条码会糊。
 */
export function rotationFromPointer(center: Point, pointer: Point, startRotation: Rotation): Rotation {
  // 从「正下方」量起：屏幕 y 向下，正下方 → 左边是顺时针。
  const degrees = (Math.atan2(center.x - pointer.x, pointer.y - center.y) * 180) / Math.PI;
  const turns = Math.round(degrees / RIGHT_ANGLE_DEG);
  const next = (((startRotation + turns * RIGHT_ANGLE_DEG) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
  return ROTATIONS.find((rotation) => rotation === next) ?? startRotation;
}

/** 覆盖层上要画的：拖动中的临时框、吸附参考线、框选的范围。模板在松手时才改。 */
export interface GestureView {
  boxes: ReadonlyMap<string, Box>;
  guides: readonly Guide[];
  marquee: Box | null;
}

export const NO_GESTURE_VIEW: GestureView = { boxes: new Map(), guides: [], marquee: null };

/** 旋转手柄的 data-handle：选中一个元素时画在它正下方。 */
export const ROTATE_HANDLE = 'rotate';

/** 指针按下的位置是不是落在某个控制点上（看 data-handle 的值）。 */
export function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return value !== undefined && (RESIZE_HANDLES as readonly string[]).includes(value);
}

/**
 * 拖动中覆盖层要画的内容：没有手势、或者还没过拖动阈值（只是点了一下）时什么都不画。
 * 移动用模板里元素「现在」的位置加上手势的位移算，不是只用按下时记的那份快照——
 * 拖动过程中如果别处改了模板（例如属性栏），覆盖层仍然跟着最新的位置走。
 */
export function viewOf(gesture: Gesture | null, template: CanvasTemplate): GestureView {
  if (gesture === null || !gesture.hasMoved) {
    return NO_GESTURE_VIEW;
  }
  switch (gesture.kind) {
    case 'move': {
      const dx = gesture.box.x - gesture.start.x;
      const dy = gesture.box.y - gesture.start.y;
      const boxes = new Map<string, Box>();
      for (const element of template.elements) {
        if (gesture.ids.includes(element.id)) {
          boxes.set(element.id, { ...boxOf(element), x: element.x + dx, y: element.y + dy });
        }
      }
      return { boxes, guides: gesture.guides, marquee: null };
    }
    case 'resize':
      return { boxes: new Map([[gesture.id, gesture.box]]), guides: gesture.guides, marquee: null };
    case 'marquee':
      return { boxes: new Map(), guides: [], marquee: rectFromPoints(gesture.origin, gesture.current) };
    case 'rotate': {
      // 转直角时框按中心交换宽高（和松手后的结果一模一样，用的就是同一个函数）。
      const rotated = rotateElement(template, gesture.id, gesture.rotation).elements.find(
        (element) => element.id === gesture.id,
      );
      return {
        boxes: rotated === undefined ? new Map() : new Map([[gesture.id, boxOf(rotated)]]),
        guides: [],
        marquee: null,
      };
    }
  }
}

/**
 * 移动一步的结果：起始框按位移（mm）挪动，按需吸附，再收进纸内。
 * dx、dy 是鼠标挪动的毫米数（已经取整到 0.1mm），不是元素的绝对位置。
 */
export function moveGestureBox(
  start: Box,
  dx: number,
  dy: number,
  paper: PaperSize,
  targets: SnapTargets,
  threshold: number,
  snap: boolean,
): Snapped {
  const moved = { ...start, x: start.x + dx, y: start.y + dy };
  const snapped = snap ? snapMove(moved, targets, threshold) : { box: moved, guides: [] };
  return { box: clampBox(snapped.box, paper), guides: snapped.guides };
}

/**
 * 缩放一步的结果：从起始框按控制点和位移（mm）算出新框，按需吸附，再收进纸内。
 * dx、dy 是鼠标挪动的毫米数（已经取整到 0.1mm）。
 */
export function resizeGestureBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  paper: PaperSize,
  targets: SnapTargets,
  threshold: number,
  snap: boolean,
  keepRatio = false,
): Snapped {
  const resized = resizeBox(start, handle, dx, dy, paper, keepRatio);
  // 保持比例时不吸附：吸到一条参考线就得改另一边，比例就保不住了。
  const snapped = snap && !keepRatio ? snapResize(resized, handle, targets, threshold) : { box: resized, guides: [] };
  return { box: clampBox(snapped.box, paper), guides: snapped.guides };
}
