import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { BRAND } from '../shared/brand';
import { IpcChannel } from '../shared/ipc-contract';
import { forwardRendererConsole } from './logging';

const WINDOW_BOUNDS = { width: 1280, height: 800, minWidth: 1024, minHeight: 680 } as const;
const HOUSING_COLOR = '#E4E7E2';

export interface MainWindowOptions {
  icon: string;
  shouldHideOnClose: () => boolean;
  onHidden: () => void;
}

/** 无系统边框窗口，标题栏由渲染进程自绘。 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_BOUNDS,
    frame: false,
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
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (options.shouldHideOnClose()) {
      event.preventDefault();
      window.hide();
      options.onHidden();
    }
  });
  const sendMaximized = () => window.webContents.send(IpcChannel.WindowMaximizedChanged, window.isMaximized());
  window.on('maximize', sendMaximized);
  window.on('unmaximize', sendMaximized);

  const { webContents } = window;
  forwardRendererConsole(webContents);
  // 预览按实物比例显示，禁止缩放；导航和新窗口一律拒绝。
  void webContents.setVisualZoomLevelLimits(1, 1);
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event) => event.preventDefault());
  webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] renderer process gone, reloading', details);
    if (!window.isDestroyed()) {
      webContents.reload();
    }
  });
  window.on('unresponsive', () => console.error('[window] renderer is unresponsive'));
  window.on('responsive', () => console.info('[window] renderer is responsive again'));

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}
