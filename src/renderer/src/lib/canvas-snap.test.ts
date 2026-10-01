import { describe, expect, test } from 'bun:test';
import { SNAP_DISTANCE_PX, snapMove, snapResize, snapTargets, snapThresholdMm } from './canvas-snap';
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
});

describe('snapResize', () => {
  test('snaps only the edge being dragged', () => {
    const { box, guides } = snapResize({ x: 1.3, y: 10, width: 28.9, height: 5 }, 'e', PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBe(1.3);
    expect(box.x + box.width).toBeCloseTo(30, 9);
    expect(guides).toEqual([{ axis: 'x', at: 30 }]);
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
});
