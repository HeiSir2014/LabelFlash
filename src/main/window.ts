import { join } from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';
import { BRAND } from '../shared/brand';
import { IpcChannel } from '../shared/ipc-contract';
import { windowChromeFor } from '../shared/window-chrome';
import { APP_ENTRY_URL } from './bundle-path';
import { buildContextMenuTemplate } from './context-menu';
import { forwardRendererConsole } from './logging';
import { bringToFront } from './window-activation';
import { type CloseState, closeAction } from './window-close';
import type { WindowPlacement } from './window-state';

const HOUSING_COLOR = '#E4E7E2';
/** macOS 红绿灯的位置：按钮高约 14px，在 40px 高的自绘标题栏里垂直居中（与 app.css 的 --title-bar-height 一致）。 */
const MAC_TRAFFIC_LIGHT_POSITION = { x: 14, y: 13 };
/** 渲染进程在这段时间内再次崩溃就不再自动重载：同一个问题反复重载只会让车间电脑卡死。 */
const RENDERER_RELOAD_COOLDOWN_MS = 30_000;

export interface MainWindowOptions {
  icon: string;
  /** 打开的位置、尺寸和最小尺寸（见 window-placement.ts）：上次的位置，或鼠标所在屏幕的默认位置。 */
  placement: WindowPlacement;
  /** 点关闭时：藏进托盘、先走退出确认，还是放行（window-close.ts）。 */
  closeState: () => CloseState;
  onHidden: () => void;
  /**
   * 启动时窗口去哪：front = 到最前并拿到焦点（扫码框要有焦点才收得到扫码枪的输入）；
   * tray = 关在托盘里时静默更新的，新版本也待在托盘里。
   */
  startup: 'front' | 'tray';
}

/** 无系统边框窗口，标题栏由渲染进程自绘。 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const { bounds, minWidth, minHeight, isMaximized } = options.placement;
  const chrome = windowChromeFor(process.platform);
  const window = new BrowserWindow({
    ...bounds,
    minWidth,
    minHeight,
    ...(chrome === 'mac-traffic-lights'
      ? { titleBarStyle: 'hidden', trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION }
      : { frame: false }),
    show: false,
    title: BRAND.productName,
    icon: options.icon,
    backgroundColor: HOUSING_COLOR,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      // 编码、颜色、尺码不是英文单词：拼写检查只会画红线，还会去网上下载词典。
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => {
    if (options.startup === 'tray') {
      // maximize() 会把隐藏的窗口显示出来：等第一次从托盘打开时再最大化。
      if (isMaximized) {
        window.once('show', () => window.maximize());
      }
      return;
    }
    if (isMaximized) {
      window.maximize();
    }
    // 从最小化还原时回到最大化的样子。
    bringToFront(window, process.platform);
  });
  window.on('close', (event) => {
    switch (closeAction(options.closeState())) {
      case 'hide':
        event.preventDefault();
        window.hide();
        options.onHidden();
        break;
      case 'quit':
        event.preventDefault();
        app.quit();
        break;
      case 'close':
        break;
    }
  });
  const sendMaximized = () => window.webContents.send(IpcChannel.WindowMaximizedChanged, window.isMaximized());
  window.on('maximize', sendMaximized);
  window.on('unmaximize', sendMaximized);
  const sendFullScreen = () => window.webContents.send(IpcChannel.WindowFullScreenChanged, window.isFullScreen());
  window.on('enter-full-screen', sendFullScreen);
  window.on('leave-full-screen', sendFullScreen);

  const { webContents } = window;
  forwardRendererConsole(webContents);
  // 预览按实物比例显示，禁止缩放。（新窗口、导航、webview 的拦截在 security.ts 里对所有 webContents 统一处理。）
  void webContents.setVisualZoomLevelLimits(1, 1);
  webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params);
    if (template.length > 0 && !window.isDestroyed()) {
      Menu.buildFromTemplate(template).popup({ window });
    }
  });
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame) {
      console.error(`[window] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    }
  });
  let lastRendererCrashAt = Number.NEGATIVE_INFINITY;
  webContents.on('render-process-gone', (_event, details) => {
    const now = Date.now();
    const isCrashLoop = now - lastRendererCrashAt < RENDERER_RELOAD_COOLDOWN_MS;
    lastRendererCrashAt = now;
    if (isCrashLoop) {
      console.error('[window] renderer process gone again right after a reload, not reloading', details);
      return;
    }
    console.error('[window] renderer process gone, reloading', details);
    if (!window.isDestroyed()) {
      webContents.reload();
    }
  });
  window.on('unresponsive', () => console.error('[window] renderer is unresponsive'));
  window.on('responsive', () => console.info('[window] renderer is responsive again'));

  // 开发时连 Vite 开发服务器；其他情况一律走 app:// 自定义协议，不用 file://。
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  void window.loadURL(!app.isPackaged && devServerUrl ? devServerUrl : APP_ENTRY_URL);
  return window;
}
