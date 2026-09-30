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
import { type Browser, chromium, devices, expect as expectPage } from '@playwright/test';
import sharp from 'sharp';
import { buildRelay } from '../../scripts/relay/build';
import { systemClock } from '../../src/core/types';
import { MobileHost } from '../../src/main/mobile/mobile-host';
import type { PhoneJob } from '../../src/main/mobile/mobile-session';
import type { ImageRequest, PhonePrintResult } from '../../src/shared/mobile-protocol';
import type { MobileStatus } from '../../src/shared/mobile-status';
import type { SocketLike } from '../../src/shared/relay-socket';
import { type RunningRelay, startRelay } from '../src/server';
import { SCANNED_FREQUENCY_HZ } from '../web/src/scan-sound';
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
/** 布局检查连扫几张：一屏放不下的数量。 */
const MANY_JOBS = 12;

let workDir: string;
let relay: RunningRelay;
let host: MobileHost;
let browser: Browser;
const prints: string[] = [];
const jobs: PhoneJob[] = [];
/** 电脑要不要标签图：货架号识别的那个测试里才要。 */
let imageRequest: ImageRequest | null = null;

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
    printerLabel: async () => '热敏标签机',
    imageRequest: () => imageRequest,
    print: async (job) => {
      prints.push(job.raw);
      jobs.push(job);
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
    // 记下页面合成的每一声（振荡器的频率）：扫到码要真的调用 Web Audio 响一声「嘀」。
    await page.addInitScript(() => {
      // 这段在页面里运行；中转服务的 tsconfig 不带 DOM 类型，只声明用到的几项。
      interface Oscillator {
        frequency: { value: number };
        start(when?: number): void;
      }
      const scope = globalThis as unknown as {
        e2eTones: number[];
        AudioContext: { prototype: { createOscillator(this: unknown): Oscillator } };
      };
      const tones: number[] = [];
      scope.e2eTones = tones;
      const original = scope.AudioContext.prototype.createOscillator;
      scope.AudioContext.prototype.createOscillator = function createOscillator(this: unknown) {
        const oscillator = original.call(this);
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => {
          tones.push(oscillator.frequency.value);
          start(when);
        };
        return oscillator;
      };
    });
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
    // 同一张标签停在镜头里：只打一次，也只「嘀」一声。
    expect(await page.evaluate(() => (globalThis as unknown as { e2eTones: number[] }).e2eTones)).toEqual([
      SCANNED_FREQUENCY_HZ,
    ]);
    expect(await page.locator('.job').count()).toBe(1);
    expect(host.status()).toMatchObject({ phones: [{ online: true, printed: 1 }], printed: 1 });

    // 一卷内容相同的标签：码一直在画面里，防抖不放行，点最新一张上的「再打一张」再打（电脑的防重复窗口也不挡）。
    await page.getByRole('button', { name: '再打一张' }).click();
    const againDeadline = Date.now() + SCAN_TIMEOUT_MS;
    while (prints.length < 2 && Date.now() < againDeadline) {
      await Bun.sleep(50);
    }
    expect(prints).toEqual([LABEL, LABEL]);
    await page.locator('.job-title', { hasText: '已补打' }).waitFor({ timeout: SCAN_TIMEOUT_MS });
    expect(await page.locator('.job').count()).toBe(2);

    // 页面不能被双指或双击放大：双击取景画面只切换焦段（假摄像头不能变焦，焦段按钮不出现，也不报错）。
    const touchAction = await page.evaluate(() => {
      const scope = globalThis as unknown as {
        document: { documentElement: unknown };
        getComputedStyle(element: unknown): { touchAction: string };
      };
      return scope.getComputedStyle(scope.document.documentElement).touchAction;
    });
    expect(touchAction).toBe('pan-x pan-y');
    await page.locator('#viewfinder').dblclick({ position: { x: 40, y: 40 } });
    expect(await page.locator('#lens').isHidden()).toBe(true);
    expect(errors).toEqual([]);
  },
  SCAN_TIMEOUT_MS * 2,
);

/** 截图里 (x, y) 处的亮度（0 黑、255 白）。 */
function brightness(pixels: Buffer, width: number, x: number, y: number): number {
  return pixels[Math.round(y) * width + Math.round(x)] ?? -1;
}

// 货架号识别：电脑要图时，手机按二维码的四个角把整张标签摆正截下来，随扫码发给电脑。
// 假摄像头里标签横着放（顺时针转了 90°），二维码下方有一条黑条（货架号那一行）：截图里它应当在二维码正下方。
// 电脑要 3 帧：假摄像头的画面一直在，手机应当截满 3 帧一起发。
test(
  'crops the label upright from a sideways photo and sends several frames with the scan',
  async () => {
    imageRequest = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130, frames: 3 };
    const video = join(workDir, 'sideways.y4m');
    await writeQrVideo(video, 'SHELF-TEST-001', { shelfBar: true, rotated: true });
    const sideways = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${video}`,
      ],
    });
    try {
      const status = host.status() as Extract<MobileStatus, { state: 'active' }>;
      const page = await sideways.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(status.url);
      await page.getByRole('button', { name: '开始扫码' }).click({ timeout: SCAN_TIMEOUT_MS });
      const deadline = Date.now() + SCAN_TIMEOUT_MS;
      while (!jobs.some((job) => job.raw === 'SHELF-TEST-001') && Date.now() < deadline) {
        await Bun.sleep(50);
      }
      const job = jobs.find((entry) => entry.raw === 'SHELF-TEST-001');
      expect(job?.images).toHaveLength(3);
      const image = job?.images[0];
      if (!image) throw new Error('expected a label image');
      const { data, info } = await sharp(Buffer.from(image.jpeg, 'base64'))
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect({ width: info.width, height: info.height }).toEqual({ width: 780, height: 520 });
      const { x, y, size } = image.code;
      expect({ x, y, size }).toEqual({ x: 325, y: 195, size: 130 });
      // 二维码左上角定位角的外圈（一个模块宽，约 1/21 个边长）是黑的：截图是正的，不是转着的。
      expect(brightness(data, info.width, x + size * 0.02, y + size * 0.02)).toBeLessThan(100);
      // 黑条在二维码正下方（假摄像头里在二维码下 42 像素、高 20 像素，二维码 168 像素：1.25–1.37 个边长），
      // 二维码上方同样的位置是白的。
      expect(brightness(data, info.width, x + size * 0.5, y + size * 1.31)).toBeLessThan(100);
      expect(brightness(data, info.width, x + size * 0.5, y - size * 0.31)).toBeGreaterThan(160);
      expect(errors).toEqual([]);
    } finally {
      await sideways.close();
      imageRequest = null;
    }
  },
  SCAN_TIMEOUT_MS * 2,
);

// 扫了很多张之后页面不能被撑长：取景框在上、手动输入在下，都一直在屏幕上，只有任务列表在中间滚动。
for (const device of ['Pixel 7', 'iPhone SE'] as const) {
  test(
    `keeps the viewfinder and the manual input on screen after many jobs on ${device}`,
    async () => {
      const status = host.status() as Extract<MobileStatus, { state: 'active' }>;
      const context = await browser.newContext({ ...devices[device] });
      try {
        const page = await context.newPage();
        await page.goto(status.url);
        await page.getByRole('button', { name: '开始扫码' }).click({ timeout: SCAN_TIMEOUT_MS });
        const manual = page.getByRole('textbox', { name: '手动输入扫码内容' });
        for (let index = 1; index <= MANY_JOBS; index += 1) {
          await manual.fill(`LAYOUT-${device}-${index}`);
          await manual.press('Enter');
        }
        await expectPage(page.locator('.job')).toHaveCount(MANY_JOBS + 1, { timeout: SCAN_TIMEOUT_MS });
        // 页面本身不滚动（中转服务的 tsconfig 不带 DOM 类型，按对象读取）。
        const scroll = await page.evaluate(() => {
          const root = (globalThis as unknown as { document: { documentElement: { scrollHeight: number } } }).document;
          return root.documentElement.scrollHeight;
        });
        const viewport = page.viewportSize()?.height ?? 0;
        const viewfinder = await page.locator('#viewfinder').boundingBox();
        const input = await manual.boundingBox();
        expect(scroll).toBeLessThanOrEqual(viewport + 1);
        expect(viewfinder?.y).toBeGreaterThanOrEqual(0);
        expect((input?.y ?? Number.POSITIVE_INFINITY) + (input?.height ?? 0)).toBeLessThanOrEqual(viewport);
      } finally {
        await context.close();
      }
    },
    SCAN_TIMEOUT_MS * 2,
  );
}
