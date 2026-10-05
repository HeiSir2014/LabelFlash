import { join } from 'node:path';
import { app, BrowserWindow, type Session, session } from 'electron';
import { PDF_RENDER_CHANNELS } from '../../shared/pdf-render-protocol';
import { handleAppScheme } from '../app-protocol';
import { APP_HOST, APP_SCHEME } from '../bundle-path';
import type { RenderPort } from './pdf-render-host';
import { isAllowedRenderRequest, PDF_RENDER_CSP } from './render-session-policy';

/** 内存里的独立会话（名字不带 persist:）：不和主窗口共用存储、缓存、同源数据，程序退出就没了。 */
const PDF_RENDER_PARTITION = 'labelflash-pdf-render';
const PDF_RENDER_PAGE = 'pdf-render.html';
/** 日志里记下被拦的地址时最多 200 个字：data: 地址可能很长。 */
const MAX_LOGGED_URL_LENGTH = 200;

let renderSession: Session | null = null;

/** 第一次用到时准备会话：只服务本程序的文件、拒绝一切权限、拦下所有对外请求。 */
function prepareSession(rendererDir: string, devServerUrl: string | null): Session {
  if (renderSession !== null) {
    return renderSession;
  }
  const prepared = session.fromPartition(PDF_RENDER_PARTITION);
  handleAppScheme(rendererDir, prepared.protocol, PDF_RENDER_CSP);
  prepared.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  prepared.setPermissionCheckHandler(() => false);
  prepared.webRequest.onBeforeRequest((details, callback) => {
    const isAllowed = isAllowedRenderRequest(details.url, devServerUrl);
    if (!isAllowed) {
      console.warn(`[pdf] blocked a request from the render page: ${details.url.slice(0, MAX_LOGGED_URL_LENGTH)}`);
    }
    callback({ cancel: !isAllowed });
  });
  renderSession = prepared;
  return prepared;
}

/**
 * 开一个隐藏的 PDF 渲染窗口（sandbox、contextIsolation、没有 Node；只有这个窗口开 JS，pdf.js 要用）。
 * 窗口导航、新窗口由 security.ts 对所有 webContents 统一拒绝。只收这个窗口主 frame 发来的回复。
 */
export async function openRenderWindow(rendererDir: string): Promise<RenderPort> {
  const devServerUrl = app.isPackaged ? null : (process.env['ELECTRON_RENDERER_URL'] ?? null);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: prepareSession(rendererDir, devServerUrl),
      preload: join(__dirname, '../preload/pdf-render.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      // 隐藏窗口也要全速跑：后台节流会让一页渲染慢好几倍。
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const goneListeners: (() => void)[] = [];
  const notifyGone = () => {
    for (const listener of goneListeners.splice(0)) {
      listener();
    }
  };
  window.webContents.on('render-process-gone', notifyGone);
  window.on('closed', notifyGone);
  const url =
    devServerUrl === null
      ? `${APP_SCHEME}://${APP_HOST}/${PDF_RENDER_PAGE}`
      : new URL(PDF_RENDER_PAGE, devServerUrl).href;
  await window.loadURL(url);
  return {
    send: (request) => {
      if (!window.isDestroyed()) {
        window.webContents.send(PDF_RENDER_CHANNELS.request, request);
      }
    },
    onReply: (listener) => {
      window.webContents.ipc.on(PDF_RENDER_CHANNELS.reply, (event, message: unknown) => {
        if (event.senderFrame === window.webContents.mainFrame) {
          listener(message);
        }
      });
    },
    onGone: (listener) => {
      goneListeners.push(listener);
    },
    close: () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    },
  };
}
