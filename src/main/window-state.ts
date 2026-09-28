import type { Rectangle } from 'electron';
import { isRecord } from '../shared/settings';
import { fitWindowToWorkArea, type MainWindowGeometry } from './window-bounds';

/** 用来判断「还是不是同一块屏幕」：换了显示器、改了分辨率或缩放、挪了排列位置，都算不同。 */
export interface DisplayFingerprint {
  id: number;
  bounds: Rectangle;
  scaleFactor: number;
}

export interface DisplaySnapshot extends DisplayFingerprint {
  /** 扣除任务栏 / 菜单栏后的可用区域（DIP）。 */
  workArea: Rectangle;
}

export interface SavedWindowState {
  /** 非最大化时的位置和尺寸（最大化时保存的是还原后的尺寸）。 */
  bounds: Rectangle;
  isMaximized: boolean;
  /** 保存时窗口所在的屏幕。 */
  display: DisplayFingerprint;
}

export interface WindowPlacement extends MainWindowGeometry {
  isMaximized: boolean;
}

/** 与 app.css 的 --title-bar-height 一致：标题栏是用户拖动窗口的唯一把手。 */
const TITLE_BAR_HEIGHT = 40;
/** 标题栏至少要有这么大一块落在某块屏幕的可用区域里，用户才抓得住、拖得回来。 */
export const MIN_REACHABLE_TITLE_BAR = { width: 120, height: 24 } as const;

/**
 * 决定窗口打开在哪里。
 * - 保存时的那块屏幕还在，且分辨率、缩放、排列位置都没变：回到上次的位置（超出可用区域的部分收回来）。
 * - 否则（拔插、换了显示器、改了分辨率或缩放，或从没保存过）：回到默认位置，
 *   即鼠标所在屏幕的居中位置，保证用户一定看得到窗口。
 */
export function planWindowPlacement(
  saved: SavedWindowState | null,
  displays: readonly DisplaySnapshot[],
  fallbackWorkArea: Rectangle,
): WindowPlacement {
  const display = saved ? displays.find((candidate) => isSameDisplay(candidate, saved.display)) : undefined;
  if (!saved || !display) {
    return { ...fitWindowToWorkArea(fallbackWorkArea), isMaximized: false };
  }
  const { workArea } = display;
  const { minWidth, minHeight } = fitWindowToWorkArea(workArea);
  const width = clamp(saved.bounds.width, minWidth, workArea.width);
  const height = clamp(saved.bounds.height, minHeight, workArea.height);
  return {
    bounds: {
      x: clamp(saved.bounds.x, workArea.x, workArea.x + workArea.width - width),
      y: clamp(saved.bounds.y, workArea.y, workArea.y + workArea.height - height),
      width,
      height,
    },
    minWidth,
    minHeight,
    isMaximized: saved.isMaximized,
  };
}

/** 创建窗口时系统实际给出的尺寸比请求的尺寸多出多少（DIP）。 */
export interface SizeError {
  width: number;
  height: number;
}

/**
 * Windows 小数缩放（例如 150%）下，按某个尺寸创建窗口，实际得到的会多出几个像素（实测 +2×+3）。
 * 如果把实际尺寸原样保存、下次再按它创建，窗口每次启动都会变大一点。
 * 所以在创建后立刻量出这个误差，保存时减掉：窗口没被调整过时，保存的就是这次请求的尺寸。
 */
export function measureSizeError(requested: Rectangle, created: Rectangle): SizeError {
  return { width: created.width - requested.width, height: created.height - requested.height };
}

/** 去掉创建误差后的尺寸，下次按它创建正好得到现在的大小。位置不受影响。 */
export function withoutSizeError(bounds: Rectangle, error: SizeError): Rectangle {
  return {
    x: bounds.x,
    y: bounds.y,
    // 保存的尺寸必须为正，否则读回时会被当作损坏而丢弃。
    width: Math.max(1, bounds.width - error.width),
    height: Math.max(1, bounds.height - error.height),
  };
}

/** 运行中拔掉显示器或改了分辨率后，窗口的标题栏是否还在某块屏幕上。 */
export function isTitleBarReachable(bounds: Rectangle, displays: readonly DisplaySnapshot[]): boolean {
  const titleBar = { x: bounds.x, y: bounds.y, width: bounds.width, height: TITLE_BAR_HEIGHT };
  return displays.some((display) => {
    const overlap = intersect(titleBar, display.workArea);
    return overlap.width >= MIN_REACHABLE_TITLE_BAR.width && overlap.height >= MIN_REACHABLE_TITLE_BAR.height;
  });
}

/**
 * 窗口还在用户够得着的地方吗：屏幕配置变化后据此决定要不要拉回默认位置。
 * 全屏窗口铺满整块屏幕，macOS 上标题栏落在菜单栏的位置（不在可用区域里），
 * 只要它还在某块接着的屏幕上就算够得着；否则进入全屏时会被当成「跑到屏幕外」立刻退出全屏。
 */
export function isWindowReachable(
  bounds: Rectangle,
  displays: readonly DisplaySnapshot[],
  isFullScreen: boolean,
): boolean {
  if (!isFullScreen) {
    return isTitleBarReachable(bounds, displays);
  }
  return displays.some((display) => {
    const overlap = intersect(bounds, display.bounds);
    return overlap.width >= MIN_REACHABLE_TITLE_BAR.width && overlap.height >= MIN_REACHABLE_TITLE_BAR.height;
  });
}

/** 读取保存的窗口状态；任何字段不合法都当作没有保存过（打开在默认位置）。 */
export function parseWindowState(value: unknown): SavedWindowState | null {
  if (!isRecord(value) || typeof value['isMaximized'] !== 'boolean' || !isRecord(value['display'])) {
    return null;
  }
  const bounds = parseRectangle(value['bounds']);
  const displayBounds = parseRectangle(value['display']['bounds']);
  const { id, scaleFactor } = value['display'];
  if (!bounds || !displayBounds || !Number.isInteger(id) || !isPositive(scaleFactor)) {
    return null;
  }
  return {
    bounds,
    isMaximized: value['isMaximized'],
    display: { id: id as number, bounds: displayBounds, scaleFactor: scaleFactor as number },
  };
}

function isSameDisplay(display: DisplayFingerprint, saved: DisplayFingerprint): boolean {
  return (
    display.id === saved.id &&
    display.scaleFactor === saved.scaleFactor &&
    display.bounds.x === saved.bounds.x &&
    display.bounds.y === saved.bounds.y &&
    display.bounds.width === saved.bounds.width &&
    display.bounds.height === saved.bounds.height
  );
}

function parseRectangle(value: unknown): Rectangle | null {
  if (!isRecord(value)) {
    return null;
  }
  const { x, y, width, height } = value;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isPositive(width) || !isPositive(height)) {
    return null;
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function intersect(a: Rectangle, b: Rectangle): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}
