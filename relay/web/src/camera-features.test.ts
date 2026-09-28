import { describe, expect, test } from 'bun:test';
import {
  type CameraCapabilities,
  focusAtConstraints,
  hasTorch,
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
