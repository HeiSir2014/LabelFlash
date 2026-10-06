import { describe, expect, test } from 'bun:test';
import { floatingToolbarPosition } from './canvas-float';

const BOUNDS = { left: -40, top: -60, right: 640, bottom: 460 };
const TOOLBAR = { width: 200, height: 40 };
const GAP = 16;

describe('floatingToolbarPosition', () => {
  test('sits centred above the selection, clear of its handles', () => {
    const position = floatingToolbarPosition({
      selection: { x: 100, y: 200, width: 100, height: 50 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(position).toEqual({ left: 50, top: 200 - GAP - 40, placement: 'above' });
  });

  test('goes below the selection when there is no room above', () => {
    const position = floatingToolbarPosition({
      selection: { x: 100, y: -30, width: 100, height: 50 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(position).toEqual({ left: 50, top: 20 + GAP, placement: 'below' });
  });

  test('keeps a larger gap below, where the rotation handle is', () => {
    const position = floatingToolbarPosition({
      selection: { x: 100, y: -30, width: 100, height: 50 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
      gapBelow: 40,
    });
    expect(position.top).toBe(20 + 40);
  });

  test('stays inside the area horizontally', () => {
    const atRight = floatingToolbarPosition({
      selection: { x: 600, y: 200, width: 30, height: 30 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(atRight.left).toBe(BOUNDS.right - TOOLBAR.width);
    const atLeft = floatingToolbarPosition({
      selection: { x: -20, y: 200, width: 10, height: 10 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(atLeft.left).toBe(BOUNDS.left);
  });

  test('pins to the top of the area when the selection fills it, rather than leaving the view', () => {
    const position = floatingToolbarPosition({
      selection: { x: 0, y: -50, width: 600, height: 500 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(position).toEqual({ left: 200, top: BOUNDS.top, placement: 'inside' });
  });
});
