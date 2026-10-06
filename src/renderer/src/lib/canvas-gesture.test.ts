import { describe, expect, test } from 'bun:test';
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import {
  accumulateWheelZoom,
  DRAG_START_PX,
  type Gesture,
  hasPassedDragThreshold,
  isResizeHandle,
  moveGestureBox,
  NO_GESTURE_VIEW,
  resizeGestureBox,
  viewOf,
  WHEEL_ZOOM_ACCUMULATION_THRESHOLD,
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

describe('accumulateWheelZoom', () => {
  test('does not step while the accumulated delta is under the threshold', () => {
    const step = accumulateWheelZoom(0, 5);
    expect(step.direction).toBeNull();
    expect(step.nextAccumulated).toBe(5);
  });

  test('keeps accumulating across several small trackpad-pinch events before stepping', () => {
    let accumulated = 0;
    for (let i = 0; i < 4; i += 1) {
      const step = accumulateWheelZoom(accumulated, 5);
      accumulated = step.nextAccumulated;
      expect(step.direction).toBeNull();
    }
    expect(accumulated).toBe(20);
  });

  test('steps once the magnitude passes the threshold and resets the accumulator', () => {
    const step = accumulateWheelZoom(WHEEL_ZOOM_ACCUMULATION_THRESHOLD - 1, 5);
    expect(step.direction).toBe(-1);
    expect(step.nextAccumulated).toBe(0);
  });

  test('a single large mouse-wheel notch steps immediately, same as before', () => {
    const step = accumulateWheelZoom(0, -120);
    expect(step.direction).toBe(1);
    expect(step.nextAccumulated).toBe(0);
  });
});
