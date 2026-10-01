import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import {
  boundsOf,
  boxOf,
  elementsInRect,
  moveBy,
  type Point,
  rectFromPoints,
  roundTo,
  setBox,
  toggleId,
} from '../lib/canvas-edit';
import {
  accumulateWheelZoom,
  type Gesture,
  type GestureView,
  hasPassedDragThreshold,
  isResizeHandle,
  moveGestureBox,
  resizeGestureBox,
  viewOf,
} from '../lib/canvas-gesture';
import { snapTargets, snapThresholdMm } from '../lib/canvas-snap';
import { pxToMm } from '../lib/canvas-view';

/** 拖动的位移取整到 0.1mm（和方向键一步一样），数字框里不会出现 12.37；吸附上的位置以参考线为准。 */
const DRAG_STEP_MM = 0.1;

export type { GestureView };

/** 挂在覆盖层上的指针事件：按在哪个元素、哪个控制点上，看 data-element-id、data-handle。 */
export interface GestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  /**
   * 失去指针捕获时触发（比如拖动中 Alt+Tab 切走、系统弹出对话框）：这时很可能收不到 pointerup，
   * 拖动会卡在「还在拖」的状态，所以一律当作取消，不提交。挂在覆盖层的 onLostPointerCapture 上。
   */
  onLostPointerCapture: () => void;
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

/**
 * 画布上的鼠标操作：点选、Shift 加选、拖动（选中的一起动）、拖控制点缩放、在空白处框选。
 * 拖动中只更新覆盖层上的框和参考线；松手时把结果交给 onCommit，一次拖动是一步撤销。
 * 指针捕获在覆盖层上：拖出画布也不会丢。
 *
 * **组件接线（Task 15）**：`isActive` 为真时说明有一个手势正按着（哪怕还没过拖动阈值），这段时间里
 * 撤销 / 重做和其它会改模板的命令都要跳过不执行——撤销会把 `template` 换成另一个版本，而手势的
 * `start` 框是按下时那个版本算的，松手提交时继续用旧的 `start` 去套新模板会把错的偏移量套用到
 * 撤销之后的位置上。键盘上 Esc：手势进行中时调用这里的 `cancel()`（不提交，恢复到按下之前的样子），
 * 没有手势时才按原来的逻辑清空选中。
 */
export function useCanvasGesture(options: GestureOptions): {
  view: GestureView;
  handlers: GestureHandlers;
  isActive: boolean;
  cancel: () => void;
} {
  const { template, selection, zoom, snap, overlayRef, onSelect, onCommit } = options;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  // 手势的「现成事实」：指针事件之间同步读写这份 ref，不依赖 state 在下一次渲染才更新。
  // 很快的一次「按下-挪动-松开」有可能在 React 重新渲染之前就把三个事件都派发完，
  // 这时 onPointerUp 如果只看 state 闭包里的 gesture，读到的还是按下那一刻的值（hasMoved: false），
  // 会把已经挪动过的一次拖动误判成点击，什么都不提交。state 仍然保留，只用来触发覆盖层重新渲染。
  const gestureRef = useRef<Gesture | null>(null);
  const { paper } = template;
  const threshold = snapThresholdMm(zoom);

  const setBoth = (next: Gesture | null) => {
    gestureRef.current = next;
    setGesture(next);
  };

  /** 取消当前手势：不提交，覆盖层上的临时框和参考线一起消失。指针捕获不用手动释放：
   * 要么是浏览器自己刚释放的（onLostPointerCapture 调用这里），要么等真正的 pointerup 来了自然释放。 */
  const cancel = () => {
    if (gestureRef.current !== null) {
      setBoth(null);
    }
  };

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

  const startMove = (id: string, isAdditive: boolean, client: Point): Gesture | null => {
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
      : {
          kind: 'move',
          client,
          hasMoved: false,
          ids: moving.map((element) => element.id),
          start,
          box: start,
          guides: [],
        };
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
    const client: Point = { x: event.clientX, y: event.clientY };
    let next: Gesture | null;
    if (element === undefined) {
      // 点在空白处：不按 Shift 先清空选中（单击空白就是取消选中），再开始框选。
      const base = event.shiftKey ? selection : [];
      onSelect(base);
      const origin = toPaper(client);
      next = { kind: 'marquee', client, hasMoved: false, origin, current: origin, base };
    } else if (isResizeHandle(handle)) {
      next = element.locked
        ? null
        : {
            kind: 'resize',
            client,
            hasMoved: false,
            id: element.id,
            handle,
            start: boxOf(element),
            box: boxOf(element),
            guides: [],
          };
    } else {
      next = startMove(element.id, event.shiftKey, client);
    }
    if (next !== null) {
      overlayRef.current?.setPointerCapture(event.pointerId);
      setBoth(next);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gestureRef.current;
    if (current === null) {
      return;
    }
    // 按钮已经松开却没收到 pointerup（指针捕获被别的什么抢走、系统手势吞掉了松开事件……）：
    // 当作取消，不留着一个粘住不放的拖动，下次点按才不会莫名其妙地把这个半成品也提交了。
    if (event.buttons === 0) {
      cancel();
      return;
    }
    const dxPx = event.clientX - current.client.x;
    const dyPx = event.clientY - current.client.y;
    if (!current.hasMoved && !hasPassedDragThreshold(dxPx, dyPx)) {
      return;
    }
    if (current.kind === 'marquee') {
      const point = toPaper({ x: event.clientX, y: event.clientY });
      setBoth({ ...current, hasMoved: true, current: point });
      const touched = elementsInRect(template, rectFromPoints(current.origin, point));
      onSelect([...new Set([...current.base, ...touched])]);
      return;
    }
    const dx = roundTo(pxToMm(dxPx, zoom), DRAG_STEP_MM);
    const dy = roundTo(pxToMm(dyPx, zoom), DRAG_STEP_MM);
    if (current.kind === 'move') {
      const snapped = moveGestureBox(current.start, dx, dy, paper, targetsWithout(current.ids), threshold, snap);
      setBoth({ ...current, hasMoved: true, box: snapped.box, guides: snapped.guides });
      return;
    }
    const snapped = resizeGestureBox(
      current.start,
      current.handle,
      dx,
      dy,
      paper,
      targetsWithout([current.id]),
      threshold,
      snap,
    );
    setBoth({ ...current, hasMoved: true, box: snapped.box, guides: snapped.guides });
  };

  const onPointerUp = () => {
    const current = gestureRef.current;
    if (current === null) {
      return;
    }
    setBoth(null);
    if (!current.hasMoved) {
      return;
    }
    if (current.kind === 'move') {
      onCommit(moveBy(template, current.ids, current.box.x - current.start.x, current.box.y - current.start.y));
    } else if (current.kind === 'resize') {
      onCommit(setBox(template, current.id, current.box));
    }
  };

  return {
    view: viewOf(gesture, template),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel, onLostPointerCapture: cancel },
    isActive: gesture !== null,
    cancel,
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
  // 触控板捏合缩放会连续发很多个 deltaY 很小的 wheel 事件：攒够阈值才真的切一档（见 lib/canvas-gesture.ts）。
  const accumulated = useRef(0);
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
      const step = accumulateWheelZoom(accumulated.current, event.deltaY);
      accumulated.current = step.nextAccumulated;
      if (step.direction !== null) {
        latest.current(step.direction);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}
