import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type JSHandle, type Page } from '@playwright/test';
import type { BrowserWindow, Rectangle } from 'electron';
import { IpcChannel, type LabelFlashApi } from '../../src/shared/ipc-contract';
import type { UpdateStatus } from '../../src/shared/update-status';

/** 视觉验收用到的窗口、本机接口和测试数据操作（验收项本身在 acceptance.visual.ts）。 */

export interface Size {
  width: number;
  height: number;
}
/** 设计文档 §8.1 的三种窗口尺寸：常用笔记本、最小支持宽度、常用台式显示器。 */
export const SIZE_1280: Size = { width: 1280, height: 800 };
export const SIZE_1024: Size = { width: 1024, height: 680 };
export const SIZE_1920: Size = { width: 1920, height: 1080 };
export const ALL_SIZES: readonly Size[] = [SIZE_1280, SIZE_1024, SIZE_1920];

/** 用不存在的打印机提交打印：主进程记一条「找不到打印机」的记录，不会出纸。 */
const MISSING_PRINTER = 'E2E 不存在的打印机';
/** macOS 进出全屏的动画不到 1 秒；5 秒还没完成就当作卡住。 */
const FULL_SCREEN_TIMEOUT_MS = 5_000;
/** 每隔这么久读一次窗口位置。 */
const BOUNDS_POLL_INTERVAL_MS = 200;
/** 连续这么多次读到同样的位置才算稳定（约 0.6 秒）：退出全屏后系统或程序可能还会再挪一次窗口。 */
const STABLE_BOUNDS_READS = 4;

/** 主窗口：由 ElectronApplication.browserWindow(page) 取得，不会拿成隐藏的打印窗口。 */
export type WindowHandle = JSHandle<BrowserWindow>;

export function sizeLabel({ width, height }: Size): string {
  return `${width}×${height}`;
}

export function formatBounds({ x, y, width, height }: Rectangle): string {
  return `(${x}, ${y}) ${width}×${height}`;
}

export function isSameRectangle(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export async function resize(window: WindowHandle, size: Size, zoom = 1): Promise<void> {
  await window.evaluate(
    (win, { width, height, factor }) => {
      win.setContentSize(Math.round(width * factor), Math.round(height * factor));
      win.webContents.setZoomFactor(factor);
    },
    { width: size.width, height: size.height, factor: zoom },
  );
}

export async function capturePng(window: WindowHandle): Promise<Buffer> {
  const base64 = await window.evaluate(async (win) => (await win.webContents.capturePage()).toPNG().toString('base64'));
  return Buffer.from(base64, 'base64');
}

/** 模拟主进程推送的更新状态（开发版不检查更新）。 */
export async function pushUpdateStatus(window: WindowHandle, status: UpdateStatus): Promise<void> {
  await window.evaluate((win, { channel, payload }) => win.webContents.send(channel, payload), {
    channel: IpcChannel.UpdateStatusChanged,
    payload: status,
  });
}

/** 进入或退出全屏，等到系统的切换动画结束（enter-full-screen / leave-full-screen 事件）。 */
export async function setFullScreen(window: WindowHandle, fullScreen: boolean): Promise<void> {
  const isDone = await window.evaluate(
    (win, { value, timeoutMs }) =>
      new Promise<boolean>((resolve) => {
        if (win.isFullScreen() === value) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => resolve(false), timeoutMs);
        const done = () => {
          clearTimeout(timer);
          resolve(true);
        };
        if (value) {
          win.once('enter-full-screen', done);
        } else {
          win.once('leave-full-screen', done);
        }
        win.setFullScreen(value);
      }),
    { value: fullScreen, timeoutMs: FULL_SCREEN_TIMEOUT_MS },
  );
  expect(isDone, `${fullScreen ? '进入' : '退出'}全屏没有在 ${FULL_SCREEN_TIMEOUT_MS}ms 内完成`).toBe(true);
}

/** 等窗口位置连续几次读到都一样，返回这个位置。 */
export async function waitForStableBounds(window: WindowHandle): Promise<Rectangle> {
  const reads: Rectangle[] = [];
  await expect
    .poll(
      async () => {
        reads.push(await window.evaluate((win) => win.getBounds()));
        const recent = reads.slice(-STABLE_BOUNDS_READS);
        const [first] = recent;
        return (
          first !== undefined &&
          recent.length === STABLE_BOUNDS_READS &&
          recent.every((rect) => isSameRectangle(rect, first))
        );
      },
      { intervals: [BOUNDS_POLL_INTERVAL_MS], timeout: FULL_SCREEN_TIMEOUT_MS },
    )
    .toBe(true);
  const last = reads.at(-1);
  if (!last) {
    throw new Error('No window bounds were read');
  }
  return last;
}

/**
 * 把 60×40 暂时分配给一台不存在的打印机再提交打印：主进程记一条「找不到打印机」的记录，不会出纸。
 * 打完恢复原来的纸张分配，不影响截图里的打印机状态。
 */
export async function addJobs(page: Page, count: number): Promise<void> {
  await page.evaluate(
    async ({ total, printer }) => {
      const bridge = (window as unknown as { api: LabelFlashApi }).api;
      const { paperPrinters } = await bridge.getSettings();
      await bridge.updateSettings({ paperPrinters: { '60x40': printer } });
      try {
        for (let i = 0; i < total; i += 1) {
          await bridge.print(`CL5640-TK${i}-图片色-XL`, { source: 'desktop', force: false });
        }
      } finally {
        await bridge.updateSettings({ paperPrinters });
      }
    },
    { total: count, printer: MISSING_PRINTER },
  );
}

export interface LocalServer {
  origin: string;
  close: () => Promise<void>;
}

/** 在本机随机端口起一个 HTTP 服务。close 会断开还没返回的请求。 */
export async function startServer(listener: RequestListener): Promise<LocalServer> {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
