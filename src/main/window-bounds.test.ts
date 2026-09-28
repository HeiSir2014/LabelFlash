import { describe, expect, test } from 'bun:test';
import { fitWindowToWorkArea, MAIN_WINDOW_SIZE } from './window-bounds';

const FULL_HD = { x: 0, y: 0, width: 1920, height: 1040 };
/** 1366×768 屏幕、125% 缩放、任务栏在底部时的工作区（DIP）。 */
const SMALL_SCALED = { x: 0, y: 0, width: 1093, height: 582 };

describe('fitWindowToWorkArea', () => {
  test('keeps the preferred size on a large screen and centers the window', () => {
    expect(fitWindowToWorkArea(FULL_HD)).toEqual({
      bounds: {
        x: (FULL_HD.width - MAIN_WINDOW_SIZE.width) / 2,
        y: (FULL_HD.height - MAIN_WINDOW_SIZE.height) / 2,
        width: MAIN_WINDOW_SIZE.width,
        height: MAIN_WINDOW_SIZE.height,
      },
      minWidth: MAIN_WINDOW_SIZE.minWidth,
      minHeight: MAIN_WINDOW_SIZE.minHeight,
    });
  });

  test('never makes the window or its minimum size larger than the work area', () => {
    const { bounds, minWidth, minHeight } = fitWindowToWorkArea(SMALL_SCALED);
    expect(bounds.width).toBeLessThanOrEqual(SMALL_SCALED.width);
    expect(bounds.height).toBeLessThanOrEqual(SMALL_SCALED.height);
    expect(minWidth).toBeLessThanOrEqual(bounds.width);
    expect(minHeight).toBeLessThanOrEqual(bounds.height);
  });

  test('places the window inside a work area that does not start at the origin', () => {
    const secondary = { x: 1920, y: 40, width: 1366, height: 728 };
    const { bounds } = fitWindowToWorkArea(secondary);
    expect(bounds.x).toBeGreaterThanOrEqual(secondary.x);
    expect(bounds.y).toBeGreaterThanOrEqual(secondary.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(secondary.x + secondary.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(secondary.y + secondary.height);
  });
});
