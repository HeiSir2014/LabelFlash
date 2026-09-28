/**
 * 浏览器测试：真实的 Edge + 假摄像头（含二维码的视频）打开扫码页，确认页面从取景画面里扫到码、
 * 经真实的中转服务送到电脑端打印一次，并在任务列表里显示结果。
 *
 * 需要本机装有 Edge（Windows 自带）。运行：bun run test:relay-browser
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { buildRelay } from '../../scripts/relay/build';
import { systemClock } from '../../src/core/types';
import { MobileHost } from '../../src/main/mobile/mobile-host';
import type { PhonePrintResult } from '../../src/shared/mobile-protocol';
import type { MobileStatus } from '../../src/shared/mobile-status';
import type { SocketLike } from '../../src/shared/relay-socket';
import { type RunningRelay, startRelay } from '../src/server';
import { writeQrVideo } from './fake-camera';

const LABEL = 'CL5640-TK-图片色-XL';
const PRINTED: PhonePrintResult = {
  status: 'printed',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};
const BUILD_TIMEOUT_MS = 60_000;
const SCAN_TIMEOUT_MS = 30_000;
/** 看着同一张标签再等一会儿，确认防抖让它只打一次。 */
const HOLD_STILL_MS = 4_000;

let workDir: string;
let relay: RunningRelay;
let host: MobileHost;
let browser: Browser;
const prints: string[] = [];

/** 先占一个空闲端口：扫码页的 origin 要在启动中转服务前确定。 */
function freePort(): number {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'relay-browser-'));
  await buildRelay({ outDir: join(workDir, 'dist'), version: 'browser-test' });
  const video = join(workDir, 'label.y4m');
  await writeQrVideo(video, LABEL);

  const port = freePort();
  const origin = `http://localhost:${port}`;
  relay = startRelay(
    { host: '127.0.0.1', port, publicOrigin: origin, webRoot: join(workDir, 'dist', 'web'), version: 'browser-test' },
    () => {},
  );
  host = new MobileHost({
    relayBase: new URL(`${origin}/`),
    clock: systemClock,
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    selectedPrinter: async () => ({ name: 'LABEL_PRINTER_01', displayName: '热敏标签机' }),
    print: async (raw) => {
      prints.push(raw);
      return PRINTED;
    },
    log: () => {},
  });
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  host?.stop('quit');
  await relay?.stop();
  await rm(workDir, { recursive: true, force: true });
});

test(
  'scans the label in view and prints it once',
  async () => {
    host.start();
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    while (host.status().state !== 'active' && Date.now() < deadline) {
      await Bun.sleep(50);
    }
    const status = host.status() as Extract<MobileStatus, { state: 'active' }>;
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(status.url);

    // 摄像头要等拿手机的人点「开始扫码」才打开（振动和授权都需要一次点按）。
    await page.getByRole('button', { name: '开始扫码' }).click({ timeout: SCAN_TIMEOUT_MS });
    await page.locator('.job-title', { hasText: '已发送打印' }).waitFor({ timeout: SCAN_TIMEOUT_MS });
    expect(await page.locator('.job-detail').first().textContent()).toBe('CL5640 · 图片色 · XL');
    expect(await page.locator('#printer').textContent()).toBe('打印机：热敏标签机');
    // 屏幕阅读器从单独的朗读区听到最新一张的结果。
    expect(await page.locator('#announcer').textContent()).toBe('已发送打印：CL5640 · 图片色 · XL');

    await Bun.sleep(HOLD_STILL_MS);
    expect(prints).toEqual([LABEL]);
    expect(await page.locator('.job').count()).toBe(1);
    expect(host.status()).toMatchObject({ phones: [{ online: true, printed: 1 }], printed: 1 });
    expect(errors).toEqual([]);
  },
  SCAN_TIMEOUT_MS * 2,
);
