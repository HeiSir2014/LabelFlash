import { describe, expect, test } from 'bun:test';
import { type CanvasElement, newCanvasElement } from '../../../core/templates/canvas-model';
import { hitStack, hitTest, marqueeHits, nextInStack } from './canvas-hit';
import { PX_PER_MM } from './canvas-view';

const PAPER = { widthMm: 60, heightMm: 40 };
/** 1 倍缩放下 1 屏幕像素是多少毫米。 */
const PX = 1 / PX_PER_MM;

function at<T extends CanvasElement>(element: T, box: { x: number; y: number; width: number; height: number }): T {
  return { ...element, ...box };
}

const border = at({ ...newCanvasElement('rect', 'border', PAPER), borderMm: 0.3, filled: false } as CanvasElement, {
  x: 0.5,
  y: 0.5,
  width: 59,
  height: 39,
});
const price = at(newCanvasElement('text', 'price', PAPER), { x: 2, y: 16, width: 30, height: 7 });
const line = at(newCanvasElement('line', 'line', PAPER), { x: 2, y: 23.5, width: 56, height: 0.25 });

describe('hitTest', () => {
  test('clicks inside an outline-only rectangle fall through to the element underneath', () => {
    expect(hitTest([price, border], { x: 10, y: 19 }, 1)).toBe('price');
  });

  test('hits an outline-only rectangle on its stroke', () => {
    expect(hitTest([price, border], { x: 0.6, y: 19 }, 1)).toBe('border');
  });

  test('hits an outline-only rectangle within 4 screen pixels of its stroke', () => {
    expect(hitTest([border], { x: 0.5 + 0.3 + 3.5 * PX, y: 19 }, 1)).toBe('border');
    expect(hitTest([border], { x: 0.5 + 0.3 + 5 * PX, y: 19 }, 1)).toBeNull();
  });

  test('the stroke tolerance is in screen pixels, so it shrinks in millimetres when zoomed in', () => {
    const point = { x: 0.5 + 0.3 + 3 * PX, y: 19 };
    expect(hitTest([border], point, 1)).toBe('border');
    expect(hitTest([border], point, 4)).toBeNull();
  });

  test('a filled rectangle is hit anywhere inside', () => {
    const block = { ...border, filled: true } as CanvasElement;
    expect(hitTest([block], { x: 30, y: 20 }, 1)).toBe('border');
  });

  test('a thin line is hit within 4 screen pixels of it', () => {
    expect(hitTest([line], { x: 20, y: 23.5 + 0.25 + 3 * PX }, 1)).toBe('line');
    expect(hitTest([line], { x: 20, y: 23.5 + 0.25 + 6 * PX }, 1)).toBeNull();
  });

  test('picks the topmost element (the last in the array)', () => {
    const below = at(newCanvasElement('text', 'below', PAPER), { x: 2, y: 16, width: 30, height: 7 });
    expect(hitTest([below, price], { x: 10, y: 19 }, 1)).toBe('price');
  });

  test('never hits a locked element', () => {
    expect(hitTest([{ ...price, locked: true }], { x: 10, y: 19 }, 1)).toBeNull();
    expect(hitTest([price, { ...border, filled: true, locked: true } as CanvasElement], { x: 10, y: 19 }, 1)).toBe(
      'price',
    );
  });

  test('returns null on empty paper', () => {
    expect(hitTest([price], { x: 50, y: 5 }, 1)).toBeNull();
  });
});

describe('hitStack', () => {
  test('lists every element under the point, topmost first', () => {
    const below = at(newCanvasElement('text', 'below', PAPER), { x: 2, y: 16, width: 30, height: 7 });
    const block = { ...border, id: 'block', filled: true } as CanvasElement;
    expect(hitStack([block, below, price], { x: 10, y: 19 }, 1)).toEqual(['price', 'below', 'block']);
  });
});

describe('marqueeHits', () => {
  test('selects what the rectangle touches, top layer last as in the element order', () => {
    expect(marqueeHits([price, line], { x: 1, y: 15, width: 5, height: 10 })).toEqual(['price', 'line']);
  });

  test('leaves out an outline-only rectangle when the marquee stays inside its border', () => {
    expect(marqueeHits([price, border], { x: 1.5, y: 14, width: 30, height: 10 })).toEqual(['price']);
  });

  test('takes an outline-only rectangle when the marquee crosses its border', () => {
    expect(marqueeHits([price, border], { x: 0, y: 14, width: 30, height: 10 })).toEqual(['price', 'border']);
  });

  test('never takes a locked element', () => {
    expect(marqueeHits([{ ...price, locked: true }], { x: 0, y: 0, width: 60, height: 40 })).toEqual([]);
  });
});

describe('nextInStack', () => {
  test('starts at the top when nothing under the pointer is selected', () => {
    expect(nextInStack(['a', 'b', 'c'], [])).toBe('a');
    expect(nextInStack(['a', 'b', 'c'], ['x'])).toBe('a');
  });

  test('moves one element down from the selected one and wraps around', () => {
    expect(nextInStack(['a', 'b', 'c'], ['a'])).toBe('b');
    expect(nextInStack(['a', 'b', 'c'], ['b'])).toBe('c');
    expect(nextInStack(['a', 'b', 'c'], ['c'])).toBe('a');
  });

  test('returns null for an empty stack', () => {
    expect(nextInStack([], ['a'])).toBeNull();
  });
});
