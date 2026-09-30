import { describe, expect, test } from 'bun:test';
import {
  type CameraCapabilities,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  decodedToFramePoint,
  FAR_ZOOM,
  focusAtConstraints,
  frameScale,
  hasTorch,
  isDoubleTap,
  lensZooms,
  PREFERRED_ZOOM,
  startupConstraints,
  tapToVideoPoint,
  visibleVideoRect,
} from './camera-features';

const ANDROID: CameraCapabilities = {
  focusMode: ['manual', 'single-shot', 'continuous'],
  zoom: { min: 1, max: 8, step: 0.1 },
  torch: true,
};

describe('startupConstraints', () => {
  test('asks for continuous focus and a moderate zoom when the camera offers them', () => {
    expect(startupConstraints(ANDROID)).toEqual([{ focusMode: 'continuous' }, { zoom: PREFERRED_ZOOM }]);
  });

  test('aligns the zoom to the camera step and range', () => {
    expect(startupConstraints({ zoom: { min: 1, max: 10, step: 0.4 } })).toEqual([{ zoom: 1.4 }]);
    expect(startupConstraints({ zoom: { min: 1, max: 1.2, step: 0.1 } })).toEqual([{ zoom: 1.2 }]);
  });

  test('leaves the zoom alone when the camera cannot zoom', () => {
    expect(startupConstraints({ zoom: { min: 1, max: 1, step: 0.1 } })).toEqual([]);
  });

  test('asks for nothing when the browser exposes no capabilities (iPhone)', () => {
    expect(startupConstraints({})).toEqual([]);
  });

  test('does not force a focus mode the camera lacks', () => {
    expect(startupConstraints({ focusMode: ['manual'] })).toEqual([]);
  });

  test('reopens the camera on the far lens the user chose', () => {
    expect(startupConstraints(ANDROID, 'far')).toEqual([{ focusMode: 'continuous' }, { zoom: FAR_ZOOM }]);
  });

  test('stays on the near zoom when the camera has no far lens', () => {
    expect(startupConstraints({ zoom: { min: 1, max: 1.5, step: 0.1 } }, 'far')).toEqual([{ zoom: PREFERRED_ZOOM }]);
  });
});

describe('lensZooms', () => {
  test('offers the moderate zoom as near and the telephoto zoom as far', () => {
    expect(lensZooms(ANDROID)).toEqual({ near: PREFERRED_ZOOM, far: FAR_ZOOM });
  });

  test('stops the far lens at the largest zoom the camera has', () => {
    expect(lensZooms({ zoom: { min: 1, max: 2, step: 0.1 } })).toEqual({ near: PREFERRED_ZOOM, far: 2 });
  });

  test('offers no switch when far would be no closer than near', () => {
    expect(lensZooms({ zoom: { min: 1, max: 1.5, step: 0.1 } })).toBeNull();
    expect(lensZooms({ zoom: { min: 1, max: 1, step: 0.1 } })).toBeNull();
  });

  test('offers no switch when the browser cannot zoom', () => {
    expect(lensZooms({})).toBeNull();
  });
});

describe('isDoubleTap', () => {
  const first = { point: { x: 100, y: 100 }, at: 1_000 };

  test('takes a second tap in the same place soon after as a double tap', () => {
    expect(isDoubleTap(first, { x: 110, y: 95 }, first.at + DOUBLE_TAP_MS)).toBe(true);
  });

  test('takes a slow second tap as a new single tap', () => {
    expect(isDoubleTap(first, { x: 100, y: 100 }, first.at + DOUBLE_TAP_MS + 1)).toBe(false);
  });

  test('takes a quick tap somewhere else as a new single tap', () => {
    expect(isDoubleTap(first, { x: 100 + DOUBLE_TAP_SLOP_PX + 1, y: 100 }, first.at + 100)).toBe(false);
  });

  test('needs a first tap', () => {
    expect(isDoubleTap(null, { x: 100, y: 100 }, first.at)).toBe(false);
  });
});

describe('focusAtConstraints', () => {
  const point = { x: 0.3, y: 0.6 };

  test('keeps focusing continuously around the tapped point', () => {
    expect(focusAtConstraints(ANDROID, true, point)).toEqual({ focusMode: 'continuous', pointsOfInterest: [point] });
  });

  test('focuses once on the point when only single-shot focus exists', () => {
    expect(focusAtConstraints({ focusMode: ['single-shot'] }, true, point)).toEqual({
      focusMode: 'single-shot',
      pointsOfInterest: [point],
    });
  });

  test('offers nothing without point-of-interest support or focus modes', () => {
    expect(focusAtConstraints(ANDROID, false, point)).toBeNull();
    expect(focusAtConstraints({}, true, point)).toBeNull();
  });
});

describe('hasTorch', () => {
  test('reads the torch capability', () => {
    expect(hasTorch(ANDROID)).toBe(true);
    expect(hasTorch({})).toBe(false);
  });
});

describe('visibleVideoRect', () => {
  test('keeps the whole frame when it fits the element exactly', () => {
    expect(visibleVideoRect({ width: 200, height: 200 }, { width: 720, height: 720 })).toEqual({
      x: 0,
      y: 0,
      width: 720,
      height: 720,
    });
  });

  test('crops the sides of a wide video shown in a square', () => {
    expect(visibleVideoRect({ width: 360, height: 360 }, { width: 1280, height: 720 })).toEqual({
      x: 280,
      y: 0,
      width: 720,
      height: 720,
    });
  });

  test('crops the top and bottom of a tall video shown in a wide box', () => {
    expect(visibleVideoRect({ width: 400, height: 200 }, { width: 720, height: 1280 })).toEqual({
      x: 0,
      y: 460,
      width: 720,
      height: 360,
    });
  });

  test('falls back to the whole frame before the element has a size', () => {
    expect(visibleVideoRect({ width: 0, height: 0 }, { width: 1280, height: 720 })).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
  });
});

describe('tapToVideoPoint', () => {
  test('scales directly when the video fills the element exactly', () => {
    expect(tapToVideoPoint({ x: 50, y: 150 }, { width: 200, height: 200 }, { width: 720, height: 720 })).toEqual({
      x: 0.25,
      y: 0.75,
    });
  });

  test('accounts for the sides cropped off a wide video', () => {
    // 1280×720 的画面铺满 360×360 的方框：宽 640 显示，左右各裁掉 140。
    const point = tapToVideoPoint({ x: 180, y: 180 }, { width: 360, height: 360 }, { width: 1280, height: 720 });
    expect(point).toEqual({ x: 0.5, y: 0.5 });
    const left = tapToVideoPoint({ x: 0, y: 0 }, { width: 360, height: 360 }, { width: 1280, height: 720 });
    expect(left.x).toBeCloseTo(140 / 640);
    expect(left.y).toBe(0);
  });

  test('accounts for the top and bottom cropped off a tall video', () => {
    const top = tapToVideoPoint({ x: 0, y: 0 }, { width: 360, height: 360 }, { width: 720, height: 1280 });
    expect(top.x).toBe(0);
    expect(top.y).toBeCloseTo(140 / 640);
  });

  test('stays within the frame', () => {
    const point = tapToVideoPoint({ x: -20, y: 999 }, { width: 200, height: 200 }, { width: 720, height: 720 });
    expect(point).toEqual({ x: 0, y: 1 });
  });
});

describe('frameScale', () => {
  test('keeps frames that already fit and shrinks larger ones to the longest edge', () => {
    expect(frameScale({ width: 1280, height: 720 }, 1280)).toBe(1);
    expect(frameScale({ width: 1920, height: 1080 }, 1280)).toBeCloseTo(2 / 3);
    expect(frameScale({ width: 1080, height: 1920 }, 1920)).toBe(1);
  });
});

describe('decodedToFramePoint', () => {
  // 竖屏：只看得见画面中间 1080×1440 这一块，解码时缩到 960×1280（×1280/1440）；快照是整个画面。
  const area = { x: 0, y: 240, width: 1080, height: 1440 };
  const decodeScale = 1280 / 1440;

  test('maps a point in the shrunken visible area back into the whole frame', () => {
    const point = decodedToFramePoint({ x: 480, y: 640 }, area, decodeScale, 1);
    expect(point.x).toBeCloseTo(540);
    expect(point.y).toBeCloseTo(960);
  });

  test('applies the snapshot scale when the whole frame is shrunk too', () => {
    const point = decodedToFramePoint({ x: 480, y: 640 }, area, decodeScale, 0.5);
    expect(point.x).toBeCloseTo(270);
    expect(point.y).toBeCloseTo(480);
  });
});
