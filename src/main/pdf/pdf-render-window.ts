import { join } from 'node:path';
import { app, BrowserWindow, type Session, session } from 'electron';
import { PDF_RENDER_CHANNELS } from '../../shared/pdf-render-protocol';
import { handleAppScheme } from '../app-protocol';
import { APP_HOST, APP_SCHEME } from '../bundle-path';
import type { RenderPort } from './pdf-render-host';
import {
  isAllowedRenderRequest,
  PDF_RENDER_CSP,
  RENDER_PARTITIONS,
  type RenderPartition,
} from './render-session-policy';

const PDF_RENDER_PAGE = 'pdf-render.html';
/** 日志里记下被拦的地址时最多 200 个字：data: 地址可能很长。 */
const MAX_LOGGED_URL_LENGTH = 200;

const renderSessions = new Map<RenderPartition, Session>();

/** 第一次用到时准备会话：只服务本程序的文件、拒绝一切权限、拦下所有对外请求。 */
function prepareSession(partition: RenderPartition, rendererDir: string, devServerUrl: string | null): Session {
  const existing = renderSessions.get(partition);
  if (existing !== undefined) {
    return existing;
  }
  const prepared = session.fromPartition(RENDER_PARTITIONS[partition]);
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
  renderSessions.set(partition, prepared);
  return prepared;
}

/**
 * 开一个隐藏的 PDF 渲染窗口（sandbox、contextIsolation、没有 Node；只有这个窗口开 JS，pdf.js 要用）。
 * 窗口导航、新窗口由 security.ts 对所有 webContents 统一拒绝。只收这个窗口主 frame 发来的回复。
 * partition 选会话：「打印 PDF」和局域网共享各用各的（见 RENDER_PARTITIONS）。
 */
export async function openRenderWindow(rendererDir: string, partition: RenderPartition): Promise<RenderPort> {
  const devServerUrl = app.isPackaged ? null : (process.env['ELECTRON_RENDERER_URL'] ?? null);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: prepareSession(partition, rendererDir, devServerUrl),
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
  try {
    await window.loadURL(url);
  } catch (error) {
    // 页面都加载不起来（协议没挂好、开发服务器没起来……）：这个窗口没用了，不能留着——
    // 隐藏窗口没人看得见，泄漏的话主窗口关掉之后它还占着，程序退不出去。
    if (!window.isDestroyed()) {
      window.destroy();
    }
    throw error;
  }
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
