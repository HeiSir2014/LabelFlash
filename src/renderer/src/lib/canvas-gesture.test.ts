import { describe, expect, test } from 'bun:test';
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import {
  createGestureStore,
  DRAG_START_PX,
  type Gesture,
  gestureBadge,
  gesturePhase,
  hasPassedDragThreshold,
  isResizeHandle,
  keepsRatio,
  moveGestureBox,
  NO_GESTURE_VIEW,
  resizeGestureBox,
  rotationFromPointer,
  sameIds,
  viewOf,
} from './canvas-gesture';
import type { SnapTargets } from './canvas-snap';

const PAPER = { widthMm: 60, heightMm: 40 };
const NO_TARGETS: SnapTargets = { x: [], y: [] };

function template(elements: CanvasTemplate['elements']): CanvasTemplate {
  return { kind: 'canvas', id: 't', name: '模板', paper: PAPER, printer: null, elements };
}

function textElement(id: string, box: { x: number; y: number; width: number; height: number }) {
  return {
    id,
    name: '文字',
    ...box,
    rotation: 0 as const,
    locked: false,
    kind: 'text' as const,
    text: '',
    fontSizeMm: 3,
    bold: false,
    align: 'left' as const,
    valign: 'middle' as const,
    fit: 'shrink' as const,
    inverse: false,
  };
}

describe('isResizeHandle', () => {
  test('accepts the eight handle names', () => {
    expect(isResizeHandle('nw')).toBe(true);
    expect(isResizeHandle('se')).toBe(true);
  });

  test('rejects anything else, including undefined', () => {
    expect(isResizeHandle('center')).toBe(false);
    expect(isResizeHandle(undefined)).toBe(false);
  });
});

describe('hasPassedDragThreshold', () => {
  test('is false for a tiny jitter', () => {
    expect(hasPassedDragThreshold(1, 1)).toBe(false);
  });

  test('is true once the distance reaches the threshold', () => {
    expect(hasPassedDragThreshold(DRAG_START_PX, 0)).toBe(true);
    expect(hasPassedDragThreshold(DRAG_START_PX + 10, 0)).toBe(true);
  });

  test('measures the straight-line distance, so a small diagonal wobble stays a click', () => {
    expect(hasPassedDragThreshold(2, 2)).toBe(false);
    expect(hasPassedDragThreshold(-2, 2)).toBe(false);
    expect(hasPassedDragThreshold(3, 3)).toBe(true);
  });

  // 数位板的笔落下时笔尖会在按下的位置附近抖几下：每次都从按下的位置量，不累加走过的路，
  // 抖得再多也不会变成拖动，点一下只选中、不挪动元素。
  test('measures from the press point, so a pen tip wobbling around it never starts a drag', () => {
    const wobble = [
      [1, 0],
      [2, 1],
      [1, -1],
      [-1, -2],
      [0, 2],
      [2, -2],
    ] as const;
    expect(wobble.some(([dx, dy]) => hasPassedDragThreshold(dx, dy))).toBe(false);
  });
});

describe('keepsRatio', () => {
  test('keeps the ratio of images and QR codes unless Shift is held', () => {
    expect(keepsRatio('image', false)).toBe(true);
    expect(keepsRatio('qr', false)).toBe(true);
    expect(keepsRatio('image', true)).toBe(false);
  });

  test('keeps the ratio of other elements only while Shift is held', () => {
    expect(keepsRatio('text', false)).toBe(false);
    expect(keepsRatio('barcode', true)).toBe(true);
  });
});

describe('rotationFromPointer', () => {
  const center = { x: 20, y: 20 };

  test('keeps the rotation while the pointer is still below the element, where the handle starts', () => {
    expect(rotationFromPointer(center, { x: 20, y: 40 }, 0)).toBe(0);
    expect(rotationFromPointer(center, { x: 23, y: 40 }, 90)).toBe(90);
  });

  test('turns clockwise in right angles as the handle is dragged around the centre', () => {
    expect(rotationFromPointer(center, { x: 0, y: 20 }, 0)).toBe(90);
    expect(rotationFromPointer(center, { x: 20, y: 0 }, 0)).toBe(180);
    expect(rotationFromPointer(center, { x: 40, y: 20 }, 0)).toBe(270);
    expect(rotationFromPointer(center, { x: 0, y: 20 }, 270)).toBe(0);
  });
});

describe('gestureBadge', () => {
  const box = { x: 12.04, y: 4.5, width: 32, height: 8 };
  const pressed = { client: { x: 0, y: 0 }, hasMoved: true, pointer: { x: 30, y: 9 } };

  test('shows the position while moving and the size while resizing, next to the pointer', () => {
    expect(
      gestureBadge({ ...pressed, kind: 'move', ids: ['e1'], start: box, box, guides: [], selectOnClick: null }),
    ).toEqual({ at: { x: 30, y: 9 }, text: 'X 12.0  Y 4.5 mm' });
    expect(gestureBadge({ ...pressed, kind: 'resize', id: 'e1', handle: 'se', start: box, box, guides: [] })).toEqual({
      at: { x: 30, y: 9 },
      text: '32.0 × 8.0 mm',
    });
  });

  test('shows the angle while rotating and nothing for a marquee or before moving', () => {
    expect(
      gestureBadge({
        ...pressed,
        kind: 'rotate',
        id: 'e1',
        center: { x: 0, y: 0 },
        startRotation: 0,
        rotation: 90,
      })?.text,
    ).toBe('90°');
    expect(
      gestureBadge({ ...pressed, kind: 'marquee', origin: { x: 0, y: 0 }, current: { x: 1, y: 1 }, base: [] }),
    ).toBeNull();
    expect(
      gestureBadge({
        ...pressed,
        hasMoved: false,
        kind: 'resize',
        id: 'e1',
        handle: 'se',
        start: box,
        box,
        guides: [],
      }),
    ).toBeNull();
  });
});

describe('viewOf', () => {
  const elements = [textElement('e1', { x: 10, y: 10, width: 20, height: 5 })];

  test('is empty with no gesture', () => {
    expect(viewOf(null, template(elements))).toEqual(NO_GESTURE_VIEW);
  });

  test('is empty before the drag threshold is passed', () => {
    const gesture: Gesture = {
      kind: 'move',
      client: { x: 0, y: 0 },
      hasMoved: false,
      ids: ['e1'],
      start: { x: 10, y: 10, width: 20, height: 5 },
      box: { x: 10, y: 10, width: 20, height: 5 },
      guides: [],
      selectOnClick: null,
    };
    expect(viewOf(gesture, template(elements))).toEqual(NO_GESTURE_VIEW);
  });

  test('offsets every moving element by the gesture delta, from the template (not the start box)', () => {
    const gesture: Gesture = {
      kind: 'move',
      client: { x: 0, y: 0 },
      hasMoved: true,
      ids: ['e1'],
      start: { x: 10, y: 10, width: 20, height: 5 },
      box: { x: 13, y: 16, width: 20, height: 5 },
      guides: [{ axis: 'x', at: 13 }],
      selectOnClick: null,
    };
    const view = viewOf(gesture, template(elements));
    expect(view.boxes.get('e1')).toEqual({ x: 13, y: 16, width: 20, height: 5 });
    expect(view.guides).toEqual([{ axis: 'x', at: 13 }]);
    expect(view.marquee).toBeNull();
  });

  test('resize shows only the resized element at its new box', () => {
    const gesture: Gesture = {
      kind: 'resize',
      client: { x: 0, y: 0 },
      hasMoved: true,
      id: 'e1',
      handle: 'se',
      start: { x: 10, y: 10, width: 20, height: 5 },
      box: { x: 10, y: 10, width: 25, height: 8 },
      guides: [],
    };
    const view = viewOf(gesture, template(elements));
    expect(view.boxes).toEqual(new Map([['e1', { x: 10, y: 10, width: 25, height: 8 }]]));
  });

  test('marquee shows the rectangle between origin and current, no boxes', () => {
    const gesture: Gesture = {
      kind: 'marquee',
      client: { x: 0, y: 0 },
      hasMoved: true,
      origin: { x: 5, y: 5 },
      current: { x: 1, y: 20 },
      base: [],
    };
    const view = viewOf(gesture, template(elements));
    expect(view.boxes.size).toBe(0);
    expect(view.marquee).toEqual({ x: 1, y: 5, width: 4, height: 15 });
  });
});

describe('moveGestureBox', () => {
  const start = { x: 10, y: 10, width: 20, height: 5 };

  test('offsets the start box by dx, dy when snap is off', () => {
    const result = moveGestureBox(start, 3, -2, PAPER, NO_TARGETS, 1, false);
    expect(result).toEqual({ box: { x: 13, y: 8, width: 20, height: 5 }, guides: [] });
  });

  test('snaps to a nearby target when snap is on', () => {
    const targets: SnapTargets = { x: [13.2], y: [] };
    const result = moveGestureBox(start, 3, 0, PAPER, targets, 1, true);
    expect(result.box.x).toBe(13.2);
    expect(result.guides).toEqual([{ axis: 'x', at: 13.2 }]);
  });

  test('clamps the result to stay on the paper', () => {
    const result = moveGestureBox(start, -100, 0, PAPER, NO_TARGETS, 1, false);
    expect(result.box.x).toBe(0);
  });
});

describe('resizeGestureBox', () => {
  const start = { x: 10, y: 10, width: 20, height: 5 };

  test('grows from the dragged corner when snap is off', () => {
    const result = resizeGestureBox(start, 'se', 5, 2, PAPER, NO_TARGETS, 1, false);
    expect(result).toEqual({ box: { x: 10, y: 10, width: 25, height: 7 }, guides: [] });
  });

  test('snaps the dragged edge when snap is on', () => {
    // 右边缘拖到 30.3（10 + 20 + 0.3），离参考线 30.4 只差 0.1mm，在 1mm 的吸附距离以内。
    const targets: SnapTargets = { x: [30.4], y: [] };
    const result = resizeGestureBox(start, 'e', 0.3, 0, PAPER, targets, 1, true);
    expect(result.box.width).toBe(20.4);
    expect(result.guides).toEqual([{ axis: 'x', at: 30.4 }]);
  });
});

describe('gesturePhase', () => {
  const pressed: Gesture = {
    kind: 'marquee',
    client: { x: 0, y: 0 },
    hasMoved: false,
    origin: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    base: [],
  };

  // 按下还没拖（笔尖落下的抖动、一次点选）时浮动工具条不藏：藏了又出来会闪一下。
  test('tells idle, pressed and dragging apart', () => {
    expect(gesturePhase(null)).toBe('idle');
    expect(gesturePhase(pressed)).toBe('pressed');
    expect(gesturePhase({ ...pressed, hasMoved: true })).toBe('dragging');
  });
});

describe('createGestureStore', () => {
  test('notifies subscribers of every change until they unsubscribe', () => {
    const store = createGestureStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.setHover('e1');
    expect(store.get().hoverId).toBe('e1');
    unsubscribe();
    store.setHover('e2');
    expect(calls).toBe(1);
  });

  // 指针在同一个元素上挪动时不重新渲染覆盖层。
  test('does not notify when nothing changed', () => {
    const store = createGestureStore();
    store.setHover('e1');
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setHover('e1');
    store.setGesture(null);
    expect(calls).toBe(0);
  });

  test('keeps the gesture and the hover side by side', () => {
    const store = createGestureStore();
    const gesture: Gesture = {
      kind: 'marquee',
      client: { x: 0, y: 0 },
      hasMoved: false,
      origin: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
      base: [],
    };
    store.setHover('e1');
    store.setGesture(gesture);
    expect(store.get()).toEqual({ gesture, hoverId: 'e1' });
  });
});

describe('sameIds', () => {
  // 框选每挪一下都算一次框到了谁：没变就不改选中，整个设计器不跟着重新渲染。
  test('compares selections regardless of order', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
    expect(sameIds([], [])).toBe(true);
  });
});
