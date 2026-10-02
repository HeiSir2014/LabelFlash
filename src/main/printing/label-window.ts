import { BrowserWindow, session, type WebContents } from 'electron';
import { LabelRenderStore } from './label-render-store';

/**
 * 标签窗口专用的协议：用它代替 `data:text/html,...` 加载标签 HTML。
 * Chromium 对 data: URL 有大小限制（实测约 1.9MB 就 ERR_FAILED），自由设计模板里内嵌的图片转成
 * 1 位 BMP 后按打印机（或本机接口导出 PDF 用的 PDF_DPI=1200）的点数线性增长，100×100 的标签配一张
 * 铺满的图片就有 3MB 以上，高分辨率或很多张图片更容易超过这个上限。
 *
 * 换成这个方案：HTML 存进 LabelRenderStore（内存，不落盘），每次生成一个随机 token，
 * 挂在标签窗口专用的会话（session.fromPartition，不持久化、不缓存，和主窗口的 app:// 会话完全分开）上的
 * 协议处理器按 token 取一次就忘。比起写临时文件再 loadFile、用完删除，少了磁盘 I/O 和清理失败的风险；
 * 比起给每个窗口建一个独立 session（Electron 不提供显式销毁 session 的 API，会越积越多），
 * 固定用一个专用分区更干净。
 *
 * 安全性不变：还是 sandbox、禁用 JS（标签 HTML 来自扫码和第三方，不能执行），hardenAllWebContents
 * 对所有 webContents 生效（拒绝导航、新窗口），token 一次性且只在这个进程内存里，不经过网络。
 */
const LABEL_RENDER_SCHEME = 'cdl-label';
const LABEL_SESSION_PARTITION = 'label-render';

const renderStore = new LabelRenderStore();
let protocolRegistered = false;

function labelSession() {
  const labelSessionInstance = session.fromPartition(LABEL_SESSION_PARTITION, { cache: false });
  if (!protocolRegistered) {
    labelSessionInstance.protocol.handle(LABEL_RENDER_SCHEME, (request) => {
      const token = new URL(request.url).hostname;
      const html = renderStore.take(token);
      if (html === undefined) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    protocolRegistered = true;
  }
  return labelSessionInstance;
}

/**
 * 在隐藏窗口里加载标签 HTML 再使用它（静默打印、导出 PDF 共用），用完一定销毁。
 * 窗口开 sandbox、禁用 JS：标签 HTML 里的内容来自扫码和第三方，不能执行。
 * signal 中止（超时）时立刻销毁窗口并结束等待：窗口销毁后打印、导出的回调可能永远不来，不能留下悬挂的任务。
 */
export async function withLabelWindow<T>(
  html: string,
  signal: AbortSignal,
  use: (contents: WebContents) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const token = renderStore.put(html);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      session: labelSession(),
    },
  });
  const destroy = () => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
    // 正常情况下协议处理器已经取过一次；这里兜底清掉（例如加载中途被中止），避免没取走的 HTML 永远留在内存里。
    renderStore.take(token);
  };
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      destroy();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        await window.loadURL(`${LABEL_RENDER_SCHEME}://${token}/`);
        return use(window.webContents);
      })(),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    destroy();
  }
}
