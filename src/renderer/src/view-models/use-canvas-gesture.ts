import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import {
  boundsOf,
  boxOf,
  moveBy,
  type Point,
  rectFromPoints,
  rotateElement,
  roundTo,
  setBox,
  toggleId,
} from '../lib/canvas-edit';
import {
  type Gesture,
  type GestureView,
  hasPassedDragThreshold,
  isResizeHandle,
  keepsRatio,
  moveGestureBox,
  ROTATE_HANDLE,
  resizeGestureBox,
  rotationFromPointer,
  viewOf,
} from '../lib/canvas-gesture';
import { hitStack, hitTest, marqueeHits, nextInStack } from '../lib/canvas-hit';
import { neighbourGaps, snapTargets, snapThresholdMm } from '../lib/canvas-snap';
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
  /** 指针离开画布：清掉悬停。 */
  onPointerLeave: () => void;
}

interface GestureOptions {
  template: CanvasTemplate;
  selection: readonly string[];
  zoom: number;
  snap: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  onSelect: (ids: readonly string[]) => void;
  onCommit: (next: CanvasTemplate) => void;
  /** 设计器里隐藏的元素（只在设计器里隐藏，照常打印）：点不中。 */
  hidden?: ReadonlySet<string>;
}

const NO_HIDDEN: ReadonlySet<string> = new Set();

/**
 * 画布上的鼠标操作：点选、Shift 加选、Alt+点击轮流选叠着的元素、拖动（选中的一起动）、拖控制点缩放、
 * 在空白处（或按住 Ctrl / ⌘）框选。按在哪个元素上由 lib/canvas-hit 的点中测试决定。
 * 拖动中只更新覆盖层上的框和参考线；松手时把结果交给 onCommit，一次拖动是一步撤销。
 * 指针捕获在覆盖层上：拖出画布也不会丢。
 *
 * **组件接线**：`isActive` 为真时说明有一个手势正按着（哪怕还没过拖动阈值），这段时间里
 * 撤销 / 重做和其它会改模板的命令都要跳过不执行——撤销会把 `template` 换成另一个版本，而手势的
 * `start` 框是按下时那个版本算的，松手提交时继续用旧的 `start` 去套新模板会把错的偏移量套用到
 * 撤销之后的位置上。键盘上 Esc：手势进行中时调用这里的 `cancel()`（不提交，恢复到按下之前的样子），
 * 没有手势时才按原来的逻辑清空选中。
 */
export function useCanvasGesture(options: GestureOptions): {
  view: GestureView;
  handlers: GestureHandlers;
  isActive: boolean;
  /** 指针下面（没按着时）的元素：覆盖层给它画浅色框。 */
  hoverId: string | null;
  cancel: () => void;
} {
  const { template, selection, zoom, snap, overlayRef, onSelect, onCommit, hidden = NO_HIDDEN } = options;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // 设计器里隐藏的元素看不见，也就不该点得中。
  const hittable = template.elements.filter((element) => !hidden.has(element.id));
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

  /** 拖动 ids 里没锁定的元素；一个能动的都没有时返回 null（只选中，不拖）。 */
  const moveOf = (ids: readonly string[], client: Point, selectOnClick: string | null): Gesture | null => {
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
          selectOnClick,
        };
  };

  /** 选中了不止一个时，点是不是落在它们合起来的外框里（覆盖层画着这个框，可以按住它整组拖动）。 */
  const isInsideGroup = (point: Point): boolean => {
    if (selection.length < 2) {
      return false;
    }
    const group = boundsOf(hittable.filter((element) => selection.includes(element.id)));
    return (
      group !== null &&
      point.x >= group.x &&
      point.x <= group.x + group.width &&
      point.y >= group.y &&
      point.y <= group.y + group.height
    );
  };

  const marqueeOf = (client: Point, isAdditive: boolean): Gesture => {
    // 不按 Shift 先清空选中（单击空白就是取消选中），再开始框选。
    const base = isAdditive ? selection : [];
    onSelect(base);
    const origin = toPaper(client);
    return { kind: 'marquee', client, hasMoved: false, origin, current: origin, base };
  };

  /** 按在元素上：选中谁、拖动谁。stack 是按下位置的一叠元素（上层在前，见 lib/canvas-hit）。 */
  const pressOn = (stack: readonly string[], event: ReactPointerEvent<HTMLDivElement>, client: Point) => {
    if (event.altKey) {
      // Alt+点击：叠在一起的元素轮流选（选中的换成它下面的一个）。
      const id = nextInStack(stack, selection) ?? '';
      onSelect([id]);
      return moveOf([id], client, null);
    }
    const top = stack[0] ?? '';
    if (event.shiftKey) {
      const ids = toggleId(selection, top);
      onSelect(ids);
      // Shift 点了已选中的：只是取消选中它，不拖动。
      return ids.includes(top) ? moveOf(ids, client, null) : null;
    }
    if (stack.some((id) => selection.includes(id))) {
      // 按在已选中的元素上（哪怕它被别的盖着）：拖动整组；没拖动就松手时才改选最上层的那个。
      return moveOf(selection, client, top);
    }
    onSelect([top]);
    return moveOf([top], client, null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 只认主键（鼠标左键、数位板的笔尖）；笔杆按键、右键走 contextmenu，中键由平移接走。
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    const handleOwner = target?.closest<HTMLElement>('[data-element-id]')?.dataset['elementId'];
    const resized = template.elements.find((candidate) => candidate.id === handleOwner);
    const client: Point = { x: event.clientX, y: event.clientY };
    let next: Gesture | null;
    if (handle === ROTATE_HANDLE && resized !== undefined && !resized.locked) {
      next = {
        kind: 'rotate',
        client,
        hasMoved: false,
        id: resized.id,
        center: { x: resized.x + resized.width / 2, y: resized.y + resized.height / 2 },
        startRotation: resized.rotation,
        rotation: resized.rotation,
      };
    } else if (isResizeHandle(handle) && resized !== undefined && !resized.locked) {
      next = {
        kind: 'resize',
        client,
        hasMoved: false,
        id: resized.id,
        handle,
        start: boxOf(resized),
        box: boxOf(resized),
        guides: [],
      };
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl（⌘）+ 拖动一定是框选：从一个大元素上面开始框选里面的小元素。
      next = marqueeOf(client, event.shiftKey);
    } else {
      // 按点中测试认元素，不按覆盖层上框的 DOM 顺序：只有边框的矩形、锁定的元素不挡住下面的。
      const point = toPaper(client);
      const stack = hitStack(hittable, point, zoom);
      if (stack.length > 0) {
        next = pressOn(stack, event, client);
      } else if (!event.shiftKey && isInsideGroup(point)) {
        // 选中了好几个时，按在它们合起来的外框里（元素之间的空隙也算）：整组拖动。
        next = moveOf(selection, client, null);
      } else {
        next = marqueeOf(client, event.shiftKey);
      }
    }
    if (next !== null) {
      overlayRef.current?.setPointerCapture(event.pointerId);
      setBoth(next);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gestureRef.current;
    if (current === null) {
      // 没按着：只更新悬停的元素（覆盖层画浅色框、指针变成「移动」）。
      const hovered = hitTest(hittable, toPaper({ x: event.clientX, y: event.clientY }), zoom);
      if (hovered !== hoverId) {
        setHoverId(hovered);
      }
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
      // 框选和点选一样不碰锁定、隐藏的元素（它们只能在图层列表里选）；只有边框的矩形要框到边框才算。
      const touched = marqueeHits(hittable, rectFromPoints(current.origin, point));
      onSelect([...new Set([...current.base, ...touched])]);
      return;
    }
    const pointer = toPaper({ x: event.clientX, y: event.clientY });
    if (current.kind === 'rotate') {
      const rotation = rotationFromPointer(current.center, pointer, current.startRotation);
      setBoth({ ...current, hasMoved: true, rotation, pointer });
      return;
    }
    const dx = roundTo(pxToMm(dxPx, zoom), DRAG_STEP_MM);
    const dy = roundTo(pxToMm(dyPx, zoom), DRAG_STEP_MM);
    if (current.kind === 'move') {
      const snapped = moveGestureBox(current.start, dx, dy, paper, targetsWithout(current.ids), threshold, snap);
      // 吸附开着时写出和四周邻居的间距、标出等距（看得见的、没在动的元素才算邻居）。
      const neighbours = hittable.filter((element) => !current.ids.includes(element.id));
      const gaps = snap ? neighbourGaps(snapped.box, neighbours) : [];
      setBoth({ ...current, hasMoved: true, box: snapped.box, guides: snapped.guides, gaps, pointer });
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
      keepsRatio(template.elements.find((element) => element.id === current.id)?.kind ?? 'text', event.shiftKey),
    );
    setBoth({ ...current, hasMoved: true, box: snapped.box, guides: snapped.guides, pointer });
  };

  const onPointerUp = () => {
    const current = gestureRef.current;
    if (current === null) {
      return;
    }
    setBoth(null);
    if (!current.hasMoved) {
      if (current.kind === 'move' && current.selectOnClick !== null) {
        onSelect([current.selectOnClick]);
      }
      return;
    }
    if (current.kind === 'move') {
      onCommit(moveBy(template, current.ids, current.box.x - current.start.x, current.box.y - current.start.y));
    } else if (current.kind === 'resize') {
      onCommit(setBox(template, current.id, current.box));
    } else if (current.kind === 'rotate' && current.rotation !== current.startRotation) {
      onCommit(rotateElement(template, current.id, current.rotation));
    }
  };

  return {
    view: viewOf(gesture, template),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onPointerLeave: () => setHoverId(null),
    },
    isActive: gesture !== null,
    // 拖动中不显示悬停：拖着的元素已经有选框了。
    hoverId: gesture === null ? hoverId : null,
    cancel,
  };
}

/**
 * Ctrl（macOS 上 ⌘）+ 滚轮、触控板捏合（Chromium 发成带 ctrlKey 的 wheel）缩放画布，交出 deltaY 和指针位置，
 * 调用方以指针为中心连续缩放（lib/canvas-view 的 wheelZoom、scrollToKeep）。不按 Ctrl 的滚轮、两指滑动照常滚动画布。
 * React 的 onWheel 是被动监听，拦不住页面自己的缩放和滚动，所以挂原生监听（passive: false）。
 */
export function useWheelZoom(
  ref: RefObject<HTMLElement | null>,
  onZoom: (deltaY: number, client: Point) => void,
): void {
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
      latest.current(event.deltaY, { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}

/**
 * 平移画布：按住中键拖，或画布有焦点时按住空格再拖。只认空格本身：扫码枪的第一个字符本来就不会是空格
 * （配置中心转交扫码时也不认空格，见 lib/scan-focus 的 isScannerCharacter），字母数字照常交给「预览内容」。
 * 拖动时直接改滚动区的滚动位置，不经 React 渲染。笔（数位板）和鼠标走同一条路。
 */
export function useCanvasPan(stageRef: RefObject<HTMLElement | null>) {
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{ client: Point; scroll: Point } | null>(null);

  /** 按下时要不要开始平移；开始了就返回 true，调用方不再当成选中、拖动元素。 */
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): boolean => {
    const stage = stageRef.current;
    if (stage === null || !(event.button === 1 || (event.button === 0 && isSpaceHeld))) {
      return false;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      client: { x: event.clientX, y: event.clientY },
      scroll: { x: stage.scrollLeft, y: stage.scrollTop },
    };
    setIsPanning(true);
    return true;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): boolean => {
    const pan = panRef.current;
    const stage = stageRef.current;
    if (pan === null || stage === null) {
      return false;
    }
    stage.scrollLeft = pan.scroll.x - (event.clientX - pan.client.x);
    stage.scrollTop = pan.scroll.y - (event.clientY - pan.client.y);
    return true;
  };
  const end = (): boolean => {
    if (panRef.current === null) {
      return false;
    }
    panRef.current = null;
    setIsPanning(false);
    return true;
  };
  return {
    isSpaceHeld,
    isPanning,
    onPointerDown,
    onPointerMove,
    end,
    /** 画布上的空格：按下开始「抓手」，松开结束。返回 true 表示这个按键已经用掉。 */
    onKey: (event: { key: string; type: string; repeat: boolean }): boolean => {
      if (event.key !== ' ') {
        return false;
      }
      setIsSpaceHeld(event.type === 'keydown');
      return true;
    },
    releaseSpace: () => setIsSpaceHeld(false),
  };
}
