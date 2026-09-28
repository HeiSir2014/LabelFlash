import { describe, expect, test } from 'bun:test';
import { fitWindowToWorkArea } from './window-bounds';
import {
  type DisplaySnapshot,
  isTitleBarReachable,
  parseWindowState,
  planWindowPlacement,
  type SavedWindowState,
} from './window-state';

/** 主屏 1920×1080（任务栏在底部），右边接一块 2560×1440、150% 缩放的副屏。 */
const PRIMARY: DisplaySnapshot = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
const SECONDARY: DisplaySnapshot = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1707, height: 960 },
  workArea: { x: 1920, y: 0, width: 1707, height: 920 },
  scaleFactor: 1.5,
};
const fingerprint = ({ id, bounds, scaleFactor }: DisplaySnapshot) => ({ id, bounds, scaleFactor });

const ON_SECONDARY: SavedWindowState = {
  bounds: { x: 2100, y: 60, width: 1300, height: 820 },
  isMaximized: false,
  display: fingerprint(SECONDARY),
};

describe('planWindowPlacement', () => {
  test('opens at the default place when nothing was saved', () => {
    expect(planWindowPlacement(null, [PRIMARY], PRIMARY.workArea)).toEqual({
      ...fitWindowToWorkArea(PRIMARY.workArea),
      isMaximized: false,
    });
  });

  test('restores the saved place and maximized state on the same display', () => {
    const placement = planWindowPlacement(
      { ...ON_SECONDARY, isMaximized: true },
      [PRIMARY, SECONDARY],
      PRIMARY.workArea,
    );
    expect(placement.bounds).toEqual(ON_SECONDARY.bounds);
    expect(placement.isMaximized).toBe(true);
  });

  test('falls back to the default place when that display was unplugged', () => {
    expect(planWindowPlacement(ON_SECONDARY, [PRIMARY], PRIMARY.workArea)).toEqual({
      ...fitWindowToWorkArea(PRIMARY.workArea),
      isMaximized: false,
    });
  });

  test('falls back when the display changed resolution, scaling or position', () => {
    const changes: DisplaySnapshot[] = [
      { ...SECONDARY, scaleFactor: 1.25 },
      { ...SECONDARY, bounds: { ...SECONDARY.bounds, width: 1920, height: 1080 } },
      { ...SECONDARY, bounds: { ...SECONDARY.bounds, x: -1707 } },
    ];
    for (const changed of changes) {
      const placement = planWindowPlacement(ON_SECONDARY, [PRIMARY, changed], PRIMARY.workArea);
      expect(placement.bounds).toEqual(fitWindowToWorkArea(PRIMARY.workArea).bounds);
    }
  });

  test('pulls a window that hangs over the edge back inside the work area', () => {
    const saved = { ...ON_SECONDARY, bounds: { x: 3200, y: -30, width: 1300, height: 820 } };
    const { bounds } = planWindowPlacement(saved, [PRIMARY, SECONDARY], PRIMARY.workArea);
    expect(bounds).toEqual({ x: 1920 + 1707 - 1300, y: 0, width: 1300, height: 820 });
  });

  test('shrinks a saved size that no longer fits, but not below the minimum size', () => {
    const tooBig = { ...ON_SECONDARY, bounds: { x: 1920, y: 0, width: 4000, height: 3000 } };
    expect(planWindowPlacement(tooBig, [PRIMARY, SECONDARY], PRIMARY.workArea).bounds).toEqual(SECONDARY.workArea);
    const tooSmall = { ...ON_SECONDARY, bounds: { x: 2000, y: 40, width: 300, height: 200 } };
    const placement = planWindowPlacement(tooSmall, [PRIMARY, SECONDARY], PRIMARY.workArea);
    expect(placement.bounds.width).toBe(placement.minWidth);
    expect(placement.bounds.height).toBe(placement.minHeight);
  });
});

describe('isTitleBarReachable', () => {
  test('is reachable while enough of the title bar is inside some work area', () => {
    expect(isTitleBarReachable({ x: 100, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBe(true);
    expect(isTitleBarReachable({ x: 1800, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBe(true);
  });

  test('is unreachable once the title bar is off every screen', () => {
    // 副屏拔掉后，原来在副屏上的窗口。
    expect(isTitleBarReachable(ON_SECONDARY.bounds, [PRIMARY])).toBe(false);
    // 只剩一小角露在屏幕边缘，或者标题栏在屏幕上方。
    expect(isTitleBarReachable({ x: 1880, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBe(false);
    expect(isTitleBarReachable({ x: 100, y: -60, width: 1280, height: 800 }, [PRIMARY])).toBe(false);
  });
});

describe('parseWindowState', () => {
  test('reads back what was saved', () => {
    expect(parseWindowState(JSON.parse(JSON.stringify(ON_SECONDARY)))).toEqual(ON_SECONDARY);
  });

  test('rejects anything malformed, so the window opens at the default place', () => {
    for (const value of [null, 'x', {}, { ...ON_SECONDARY, bounds: { x: 0, y: 0, width: 'wide', height: 1 } }]) {
      expect(parseWindowState(value)).toBeNull();
    }
    expect(parseWindowState({ ...ON_SECONDARY, isMaximized: 'yes' })).toBeNull();
    expect(parseWindowState({ ...ON_SECONDARY, display: { ...ON_SECONDARY.display, scaleFactor: 0 } })).toBeNull();
    expect(parseWindowState({ ...ON_SECONDARY, bounds: { ...ON_SECONDARY.bounds, width: 0 } })).toBeNull();
  });
});
