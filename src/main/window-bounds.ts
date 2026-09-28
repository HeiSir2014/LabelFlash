import type { Rectangle } from 'electron';

/** 期望的窗口尺寸；布局按这个设计，屏幕放不下时再缩小。 */
export const MAIN_WINDOW_SIZE = { width: 1280, height: 800, minWidth: 1024, minHeight: 680 } as const;

export interface MainWindowGeometry {
  bounds: Rectangle;
  minWidth: number;
  minHeight: number;
}

/**
 * 按显示器工作区（DIP，已扣除任务栏）确定初始位置和最小尺寸。
 * 车间常见 1366×768 屏幕，开 125% 缩放后工作区只有约 1093×582：固定 1280×800 的窗口会跑出屏幕，
 * 固定的最小尺寸也会让窗口无法缩回屏幕内，所以两者都不能超过工作区。
 */
export function fitWindowToWorkArea(workArea: Rectangle): MainWindowGeometry {
  const width = Math.min(MAIN_WINDOW_SIZE.width, workArea.width);
  const height = Math.min(MAIN_WINDOW_SIZE.height, workArea.height);
  return {
    bounds: {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2),
      width,
      height,
    },
    minWidth: Math.min(MAIN_WINDOW_SIZE.minWidth, width),
    minHeight: Math.min(MAIN_WINDOW_SIZE.minHeight, height),
  };
}
