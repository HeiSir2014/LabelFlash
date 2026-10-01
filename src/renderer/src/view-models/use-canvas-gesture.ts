import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import {
  type Box,
  boundsOf,
  boxOf,
  clampBox,
  elementsInRect,
  moveBy,
  type Point,
  RESIZE_HANDLES,
  type ResizeHandle,
  rectFromPoints,
  resizeBox,
  roundTo,
  setBox,
  toggleId,
} from '../lib/canvas-edit';
import { type Guide, type Snapped, snapMove, snapResize, snapTargets, snapThresholdMm } from '../lib/canvas-snap';
import { pxToMm } from '../lib/canvas-view';

/** 按下后挪动不到 3 个屏幕像素算点击，不算拖动：手抖不该把元素挪走半毫米。 */
const DRAG_START_PX = 3;
/** 拖动的位移取整到 0.1mm（和方向键一步一样），数字框里不会出现 12.37；吸附上的位置以参考线为准。 */
const DRAG_STEP_MM = 0.1;

interface Pressed {
  /** 按下时指针的屏幕位置：算拖了多远、是不是真的拖了。 */
  client: Point;
  hasMoved: boolean;
}

interface MoveGesture extends Pressed {
  kind: 'move';
  /** 跟着动的元素（选中的、没锁定的）。 */
  ids: readonly string[];
  /** 这些元素合起来的外框：按下时的、现在的。 */
  start: Box;
  box: Box;
  guides: readonly Guide[];
}

interface ResizeGesture extends Pressed {
  kind: 'resize';
  id: string;
  handle: ResizeHandle;
  start: Box;
  box: Box;
  guides: readonly Guide[];
}

interface MarqueeGesture extends Pressed {
  kind: 'marquee';
  /** 框选的两个角（纸上的毫米）。 */
  origin: Point;
  current: Point;
  /** 按住 Shift 框选时原来就选中的。 */
  base: readonly string[];
}

type Gesture = MoveGesture | ResizeGesture | MarqueeGesture;

/** 覆盖层上要画的：拖动中的临时框、吸附参考线、框选的范围。模板在松手时才改。 */
export interface GestureView {
  boxes: ReadonlyMap<string, Box>;
  guides: readonly Guide[];
  marquee: Box | null;
}

/** 挂在覆盖层上的指针事件：按在哪个元素、哪个控制点上，看 data-element-id、data-handle。 */
export interface GestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

interface GestureOptions {
  template: CanvasTemplate;
  selection: readonly string[];
  zoom: number;
  snap: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  onSelect: (ids: readonly string[]) => void;
  onCommit: (next: CanvasTemplate) => void;
}

const NO_GESTURE_VIEW: GestureView = { boxes: new Map(), guides: [], marquee: null };

function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return value !== undefined && (RESIZE_HANDLES as readonly string[]).includes(value);
}

function viewOf(gesture: Gesture | null, template: CanvasTemplate): GestureView {
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
  }
}

/**
 * 画布上的鼠标操作：点选、Shift 加选、拖动（选中的一起动）、拖控制点缩放、在空白处框选。
 * 拖动中只更新覆盖层上的框和参考线；松手时把结果交给 onCommit，一次拖动是一步撤销。
 * 指针捕获在覆盖层上：拖出画布也不会丢。
 */
export function useCanvasGesture(options: GestureOptions): { view: GestureView; handlers: GestureHandlers } {
  const { template, selection, zoom, snap, overlayRef, onSelect, onCommit } = options;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const { paper } = template;
  const threshold = snapThresholdMm(zoom);

  /** 屏幕位置 → 纸上的毫米（以覆盖层左上角为原点）。 */
  const toPaper = (client: Point): Point => {
    const rect = overlayRef.current?.getBoundingClientRect();
    return { x: pxToMm(client.x - (rect?.left ?? 0), zoom), y: pxToMm(client.y - (rect?.top ?? 0), zoom) };
  };
  /** 吸附目标：纸，和没在动的元素。 */
  const targetsWithout = (ids: readonly string[]) =>
    snapTargets(
      paper,
      template.elements.filter((element) => !ids.includes(element.id)),
    );

  const startMove = (id: string, isAdditive: boolean, pressed: Pressed): Gesture | null => {
    const ids = isAdditive ? toggleId(selection, id) : selection.includes(id) ? selection : [id];
    onSelect(ids);
    // Shift 点了已选中的：只是取消选中它，不拖动。
    if (!ids.includes(id)) {
      return null;
    }
    const moving = template.elements.filter((element) => ids.includes(element.id) && !element.locked);
    const start = boundsOf(moving);
    return start === null
      ? null
      : { ...pressed, kind: 'move', ids: moving.map((element) => element.id), start, box: start, guides: [] };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 只认主键（左键、触屏、笔尖）。
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    const id = target?.closest<HTMLElement>('[data-element-id]')?.dataset['elementId'];
    const element = template.elements.find((candidate) => candidate.id === id);
    const pressed: Pressed = { client: { x: event.clientX, y: event.clientY }, hasMoved: false };
    let next: Gesture | null;
    if (element === undefined) {
      // 点在空白处：不按 Shift 先清空选中（单击空白就是取消选中），再开始框选。
      const base = event.shiftKey ? selection : [];
      onSelect(base);
      const origin = toPaper(pressed.client);
      next = { ...pressed, kind: 'marquee', origin, current: origin, base };
    } else if (isResizeHandle(handle)) {
      next = element.locked
        ? null
        : {
            ...pressed,
            kind: 'resize',
            id: element.id,
            handle,
            start: boxOf(element),
            box: boxOf(element),
            guides: [],
          };
    } else {
      next = startMove(element.id, event.shiftKey, pressed);
    }
    if (next !== null) {
      overlayRef.current?.setPointerCapture(event.pointerId);
      setGesture(next);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture === null) {
      return;
    }
    const dxPx = event.clientX - gesture.client.x;
    const dyPx = event.clientY - gesture.client.y;
    if (!gesture.hasMoved && Math.hypot(dxPx, dyPx) < DRAG_START_PX) {
      return;
    }
    if (gesture.kind === 'marquee') {
      const current = toPaper({ x: event.clientX, y: event.clientY });
      setGesture({ ...gesture, hasMoved: true, current });
      const touched = elementsInRect(template, rectFromPoints(gesture.origin, current));
      onSelect([...new Set([...gesture.base, ...touched])]);
      return;
    }
    const dx = roundTo(pxToMm(dxPx, zoom), DRAG_STEP_MM);
    const dy = roundTo(pxToMm(dyPx, zoom), DRAG_STEP_MM);
    if (gesture.kind === 'move') {
      const moved = { ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy };
      const snapped: Snapped = snap
        ? snapMove(moved, targetsWithout(gesture.ids), threshold)
        : { box: moved, guides: [] };
      setGesture({ ...gesture, hasMoved: true, box: clampBox(snapped.box, paper), guides: snapped.guides });
      return;
    }
    const resized = resizeBox(gesture.start, gesture.handle, dx, dy, paper);
    const snapped: Snapped = snap
      ? snapResize(resized, gesture.handle, targetsWithout([gesture.id]), threshold)
      : { box: resized, guides: [] };
    setGesture({ ...gesture, hasMoved: true, box: clampBox(snapped.box, paper), guides: snapped.guides });
  };

  const onPointerUp = () => {
    if (gesture === null) {
      return;
    }
    setGesture(null);
    if (!gesture.hasMoved) {
      return;
    }
    if (gesture.kind === 'move') {
      onCommit(moveBy(template, gesture.ids, gesture.box.x - gesture.start.x, gesture.box.y - gesture.start.y));
    } else if (gesture.kind === 'resize') {
      onCommit(setBox(template, gesture.id, gesture.box));
    }
  };

  return {
    view: viewOf(gesture, template),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => setGesture(null) },
  };
}

/**
 * Ctrl（macOS 上 ⌘）+ 滚轮缩放画布。React 的 onWheel 是被动监听，拦不住页面自己的滚动，所以挂原生监听（passive: false）。
 */
export function useCtrlWheelZoom(ref: RefObject<HTMLElement | null>, onZoom: (direction: 1 | -1) => void): void {
  const latest = useRef(onZoom);
  useEffect(() => {
    latest.current = onZoom;
  });
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      latest.current(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}
