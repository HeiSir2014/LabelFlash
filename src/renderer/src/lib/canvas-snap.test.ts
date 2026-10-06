import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS } from '../../../core/templates/canvas-model';
import {
  neighbourGaps,
  SNAP_DISTANCE_PX,
  type SnapTargets,
  snapMove,
  snapResize,
  snapTargets,
  snapThresholdMm,
} from './canvas-snap';
import { PX_PER_MM } from './canvas-view';

const PAPER = { widthMm: 60, heightMm: 40 };
const PAPER_ONLY = snapTargets(PAPER, []);
/** 用例里的吸附距离：0.5mm。 */
const THRESHOLD_MM = 0.5;

describe('snapTargets', () => {
  test('lists the paper edges, the safe area, the centre lines and the edges and centres of the others', () => {
    expect(snapTargets(PAPER, [{ x: 10, y: 5, width: 20, height: 10 }])).toEqual({
      x: [0, 1.5, 30, 58.5, 60, 10, 20, 30],
      y: [0, 1.5, 20, 38.5, 40, 5, 10, 15],
    });
  });

  test('turns the snap distance on screen into millimetres', () => {
    expect(snapThresholdMm(2)).toBeCloseTo(SNAP_DISTANCE_PX / (PX_PER_MM * 2), 9);
  });
});

describe('neighbourGaps', () => {
  const moving = { x: 20, y: 10, width: 10, height: 5 };

  test('measures the gap to the nearest neighbour on each side that it lines up with', () => {
    const left = { x: 5, y: 8, width: 10, height: 4 };
    const below = { x: 22, y: 20, width: 5, height: 5 };
    const farLeft = { x: 0, y: 10, width: 2, height: 2 };
    expect(neighbourGaps(moving, [left, below, farLeft])).toEqual([
      { axis: 'x', start: 15, end: 20, cross: 11, isEqual: false },
      { axis: 'y', start: 15, end: 20, cross: 24.5, isEqual: false },
    ]);
  });

  test('ignores elements that do not line up across, and overlapping ones', () => {
    const offRow = { x: 0, y: 30, width: 10, height: 5 };
    const overlapping = { x: 25, y: 12, width: 10, height: 5 };
    expect(neighbourGaps(moving, [offRow, overlapping])).toEqual([]);
  });

  test('marks both gaps when the element sits exactly midway between two neighbours', () => {
    const left = { x: 10, y: 10, width: 5, height: 5 };
    const right = { x: 35, y: 10, width: 5, height: 5 };
    const gaps = neighbourGaps(moving, [left, right]);
    expect(gaps.map((gap) => [gap.start, gap.end, gap.isEqual])).toEqual([
      [15, 20, true],
      [30, 35, true],
    ]);
  });
});

describe('snapMove', () => {
  test('pulls a box edge onto the safe area and draws the guide', () => {
    const { box, guides } = snapMove({ x: 1.2, y: 10, width: 10, height: 5 }, PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(1.5, 9);
    expect(box.y).toBe(10);
    expect(guides).toEqual([{ axis: 'x', at: 1.5 }]);
  });

  test('pulls the centre of a box onto the centre lines of the paper', () => {
    const { box, guides } = snapMove({ x: 24.8, y: 17.4, width: 10, height: 5 }, PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(25, 9);
    expect(box.y).toBeCloseTo(17.5, 9);
    expect(guides).toEqual([
      { axis: 'x', at: 30 },
      { axis: 'y', at: 20 },
    ]);
  });

  test('snaps to the edges of other elements', () => {
    const targets = snapTargets(PAPER, [{ x: 30, y: 0, width: 10, height: 5 }]);
    const { box, guides } = snapMove({ x: 40.3, y: 10, width: 5, height: 5 }, targets, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(40, 9);
    expect(guides).toEqual([{ axis: 'x', at: 40 }]);
  });

  test('leaves a box alone when nothing is close enough', () => {
    const box = { x: 5, y: 7, width: 10, height: 5 };
    expect(snapMove(box, PAPER_ONLY, THRESHOLD_MM)).toEqual({ box, guides: [] });
  });

  test('picks the nearest of several candidate targets on the same edge', () => {
    const targets: SnapTargets = { x: [10, 10.3, 10.6], y: [] };
    const { box, guides } = snapMove({ x: 10.4, y: 5, width: 4, height: 4 }, targets, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(10.3, 9);
    expect(box.y).toBe(5);
    expect(guides).toEqual([{ axis: 'x', at: 10.3 }]);
  });
});

describe('snapResize', () => {
  test('snaps only the edge being dragged', () => {
    const { box, guides } = snapResize({ x: 1.3, y: 10, width: 28.9, height: 5 }, 'e', PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBe(1.3);
    expect(box.x + box.width).toBeCloseTo(30, 9);
    expect(guides).toEqual([{ axis: 'x', at: 30 }]);
  });

  test('snaps the west edge alone, leaving the opposite edge fixed', () => {
    const { box, guides } = snapResize({ x: 1.3, y: 10, width: 10, height: 5 }, 'w', PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(1.5, 9);
    expect(box.x + box.width).toBeCloseTo(11.3, 9);
    expect(box.y).toBe(10);
    expect(box.height).toBe(5);
    expect(guides).toEqual([{ axis: 'x', at: 1.5 }]);
  });

  test('snaps the north edge alone, leaving the opposite edge fixed', () => {
    const { box, guides } = snapResize({ x: 10, y: 1.2, width: 10, height: 10 }, 'n', PAPER_ONLY, THRESHOLD_MM);
    expect(box.y).toBeCloseTo(1.5, 9);
    expect(box.y + box.height).toBeCloseTo(11.2, 9);
    expect(box.x).toBe(10);
    expect(box.width).toBe(10);
    expect(guides).toEqual([{ axis: 'y', at: 1.5 }]);
  });

  test('snaps the south edge alone, leaving the opposite edge fixed', () => {
    const { box, guides } = snapResize({ x: 10, y: 10, width: 10, height: 28.3 }, 's', PAPER_ONLY, THRESHOLD_MM);
    expect(box.y).toBe(10);
    expect(box.y + box.height).toBeCloseTo(38.5, 9);
    expect(guides).toEqual([{ axis: 'y', at: 38.5 }]);
  });

  test('snaps both edges at a corner', () => {
    const { box, guides } = snapResize({ x: 1.7, y: 1.2, width: 10, height: 10 }, 'nw', PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(1.5, 9);
    expect(box.width).toBeCloseTo(10.2, 9);
    expect(box.y).toBeCloseTo(1.5, 9);
    expect(box.height).toBeCloseTo(9.7, 9);
    expect(guides).toEqual([
      { axis: 'x', at: 1.5 },
      { axis: 'y', at: 1.5 },
    ]);
  });

  test('skips a target that would shrink a thin line past the minimum size', () => {
    const thinLine = { x: 10, y: 5, width: 10, height: CANVAS_LIMITS.minSizeMm };
    // 目标线紧贴着线的下边缘（没动的那边）：往上吸这条线会把高度压到最小尺寸以下，不该吸。
    const targets: SnapTargets = { x: [], y: [5 + CANVAS_LIMITS.minSizeMm - 0.05] };
    const { box, guides } = snapResize(thinLine, 'n', targets, THRESHOLD_MM);
    expect(box).toEqual(thinLine);
    expect(guides).toEqual([]);
  });
});
