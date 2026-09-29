import { BrowserWindow, type WebContents } from 'electron';

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
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  const destroy = () => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
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
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return use(window.webContents);
      })(),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    destroy();
  }
}
