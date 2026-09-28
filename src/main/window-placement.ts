import { type BrowserWindow, type Display, screen } from 'electron';
import type { SqliteWindowStateStore } from './storage/sqlite-window-state-store';
import { fitWindowToWorkArea } from './window-bounds';
import {
  type DisplaySnapshot,
  isTitleBarReachable,
  measureSizeError,
  planWindowPlacement,
  type WindowPlacement,
  withoutSizeError,
} from './window-state';

/** 移动、缩放停下这么久才保存：拖动过程中不反复写数据库。 */
const SAVE_DEBOUNCE_MS = 500;

function snapshot({ id, bounds, workArea, scaleFactor }: Display): DisplaySnapshot {
  return { id, bounds, workArea, scaleFactor };
}

function connectedDisplays(): DisplaySnapshot[] {
  return screen.getAllDisplays().map(snapshot);
}

/** 默认位置：鼠标所在的屏幕，用户一定看得到。 */
function cursorWorkArea() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

/** 启动时窗口打开的位置：上次的位置（同一块屏幕、配置未变），否则默认位置。 */
export function planInitialPlacement(store: SqliteWindowStateStore): WindowPlacement {
  return planWindowPlacement(store.load(), connectedDisplays(), cursorWorkArea());
}

/**
 * 记住窗口位置，并在显示器变化后把找不到的窗口拉回来。
 * - 移动、缩放、最大化后停下 0.5 秒保存；关闭（包括隐藏到托盘）、关机注销时立即保存。全屏时不保存。
 * - 运行中拔掉显示器或改了分辨率 / 缩放，标题栏已经不在任何屏幕上：移回默认位置。
 * 必须在窗口刚创建、还没显示时调用：requested 是创建时请求的位置和尺寸，用来量出系统的尺寸误差。
 */
export function trackWindowPlacement(
  window: BrowserWindow,
  store: SqliteWindowStateStore,
  requested: WindowPlacement['bounds'],
): void {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const sizeError = measureSizeError(requested, window.getBounds());

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (window.isDestroyed() || window.isFullScreen()) {
      return;
    }
    const normalBounds = window.getNormalBounds();
    const bounds = withoutSizeError(normalBounds, sizeError);
    const { id, bounds: displayBounds, scaleFactor } = screen.getDisplayMatching(normalBounds);
    try {
      store.save({ bounds, isMaximized: window.isMaximized(), display: { id, bounds: displayBounds, scaleFactor } });
    } catch (error) {
      console.warn('[window] failed to save the window position', error);
    }
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  const bringBackOnScreen = () => {
    if (window.isDestroyed() || isTitleBarReachable(window.getBounds(), connectedDisplays())) {
      return;
    }
    if (window.isFullScreen()) {
      window.setFullScreen(false);
    }
    if (window.isMaximized()) {
      window.unmaximize();
    }
    window.setBounds(fitWindowToWorkArea(cursorWorkArea()).bounds);
    console.info('[window] the display changed and the window was off screen; moved it back to the default place');
  };

  window.on('move', scheduleSave);
  window.on('resize', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', save);
  // Windows 关机、注销：不一定还有 close 事件，数据库也随后关闭，先保存。
  window.on('session-end', save);
  screen.on('display-removed', bringBackOnScreen);
  screen.on('display-metrics-changed', bringBackOnScreen);
  window.once('closed', () => {
    clearTimeout(saveTimer);
    screen.off('display-removed', bringBackOnScreen);
    screen.off('display-metrics-changed', bringBackOnScreen);
  });
}
