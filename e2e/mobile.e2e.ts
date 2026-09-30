import { join } from 'node:path';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import type { SessionEvent } from '../relay/web/src/phone-session';
import { SHELF_NUMBER_PATTERN } from '../src/core/scan/image-text';
import { LABEL_FRAMES, PIXELS_PER_CODE } from '../src/main/mobile/image-request';
import { missingOcrFiles, ocrFiles } from '../src/main/ocr/ocr-files';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import type { MobileStatus } from '../src/shared/mobile-status';
import { OCR_MODEL_TIERS, type OcrModelTier } from '../src/shared/ocr-model';
import { callApi, openConfig } from './support/app-helpers';
import { APP_ROOT } from './support/electron-app';
import { expect, test } from './support/fixtures';
import { connectTestPhone, type LocalRelay, startLocalRelay } from './support/relay-server';

/** 不存在的打印机：手机的任务照常经 PrintService 记进打印记录（结果是找不到打印机），不碰真实打印机。 */
const MISSING_PRINTER = 'E2E 不存在的热敏标签机';
const RAW = 'CL5640-TK-图片色-XL';
/** 构建中转服务要几秒。 */
const RELAY_SETUP_TIMEOUT_MS = 60_000;

let relay: LocalRelay;

test.beforeAll(async () => {
  test.setTimeout(RELAY_SETUP_TIMEOUT_MS);
  relay = await startLocalRelay();
});

test.afterAll(async () => {
  await relay?.stop();
});

async function useLocalRelay(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { mobileRelayUrl: relay.baseUrl, paperPrinters: { '60x40': MISSING_PRINTER } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function activeUrl(page: Page): Promise<string> {
  await expect.poll(async () => (await callApi(page, 'getMobileStatus')).state).toBe('active');
  const status: MobileStatus = await callApi(page, 'getMobileStatus');
  if (status.state !== 'active') {
    throw new Error(`手机扫码没有进行中：${status.state}`);
  }
  return status.url;
}

function hasEvent(events: SessionEvent[], type: SessionEvent['type']): boolean {
  return events.some((event) => event.type === type);
}

test('prints a phone scan through the relay and lists it as a mobile print', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await useLocalRelay(page);

  // 点标题栏的「手机扫码」：这时才连中转服务，浮层里出现二维码和有效期。
  await page.getByRole('button', { name: '手机扫码' }).click();
  const overlay = page.getByRole('dialog', { name: '手机扫码' });
  await expect(overlay.getByRole('img', { name: '手机扫码的二维码' })).toBeVisible();
  await expect(overlay).toContainText('后失效');

  const phone = await connectTestPhone(relay, await activeUrl(page));
  try {
    await expect.poll(() => hasEvent(phone.events, 'welcomed')).toBe(true);
    await expect(overlay.locator('.mobile-phone__device')).toHaveText(['E2E 手机']);
    await expect(overlay).not.toContainText('后失效');

    phone.session.submit(RAW, false);
    await expect.poll(() => hasEvent(phone.events, 'result')).toBe(true);
    expect(phone.events).toContainEqual(
      expect.objectContaining({ type: 'result', result: expect.objectContaining({ reason: 'PRINTER_NOT_FOUND' }) }),
    );
    // 打印记录里多了一条来源为「手机」的记录。
    await expect(page.locator('.job-row__meta').first()).toContainText('手机');

    // Esc 关闭浮层，焦点立即回到扫码框；会话照常进行。
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(page.locator('.scan-bar__input')).toBeFocused();
    expect((await callApi(page, 'getMobileStatus')).state).toBe('active');

    // 结束：手机收到「已结束」。
    await page.getByRole('button', { name: '手机扫码' }).click();
    await overlay.getByRole('button', { name: '结束', exact: true }).click();
    await overlay.getByRole('button', { name: /确认结束/ }).click();
    await expect.poll(() => hasEvent(phone.events, 'ended')).toBe(true);
  } finally {
    phone.session.stop();
  }
});

test('keeps the overlay non-modal: scans still reach the scan box', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await useLocalRelay(page);
  await page.getByRole('button', { name: '手机扫码' }).click();
  const overlay = page.getByRole('dialog', { name: '手机扫码' });
  await expect(overlay).toBeVisible();
  // 焦点在浮层里时，扫码枪打出的字符照样进扫码框。
  await overlay.focus();
  await page.keyboard.type('20260929001');
  await expect(page.locator('.scan-bar__input')).toHaveValue('20260929001');
});

test('points to the relay address when none is set, and edits it in the config center', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  // E2E 构建没有注入默认地址：没填时点「手机扫码」提示去填写。
  await page.getByRole('button', { name: '手机扫码' }).click();
  const overlay = page.getByRole('dialog', { name: '手机扫码' });
  await expect(overlay).toContainText('还没有设置中转地址');
  await overlay.getByRole('button', { name: '去填写中转地址' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('手机扫码');

  const address = page.getByLabel('中转地址');
  await address.fill('http://relay.example.com/');
  await address.press('Enter');
  await expect(page.getByRole('alert')).toContainText('https://');
  expect((await callApi(page, 'getSettings')).mobileRelayUrl).toBeNull();

  await address.fill(relay.baseUrl.replace(/\/$/, ''));
  await address.press('Enter');
  await expect.poll(async () => (await callApi(page, 'getSettings')).mobileRelayUrl).toBe(relay.baseUrl);
  await expect(address).toHaveValue(relay.baseUrl);

  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect.poll(async () => (await callApi(page, 'getSettings')).mobileRelayUrl).toBeNull();
  await expect(address).toHaveValue('');
});

test('opens the mobile scan page from the config navigation', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '手机扫码');
  await expect(page.getByLabel('中转地址')).toBeVisible();
});

// ---------- 货架号识别：手机随扫码带标签图，电脑读出货架号补进这一张 ----------

const LABEL_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
};
/** 这条测试规则认的内容：「标签:编码」，内置规则都不认它。 */
const SHELF_RAW = '标签:CL5640-TK';
/** 协议要求是 JPEG（/9j/ 开头）；假的文字识别不看图的内容。 */
const LABEL_IMAGE = { jpeg: '/9j/4AAQSkZJRgABAQ==', code: { x: 325, y: 195, size: 130 } };

/** 加一条带「图中文字识别」步骤的规则，打印机指给假的标签机，重新加载界面。 */
async function useShelfRule(page: Page): Promise<void> {
  const created = await callApi(page, 'createRule', 'delimited');
  if (!created.ok || created.rule.kind !== 'delimited') {
    throw new Error(created.ok ? `新规则的类型不对：${created.rule.kind}` : created.issue);
  }
  const saved = await callApi(page, 'saveRule', {
    ...created.rule,
    name: '样衣标签',
    delimiter: ':',
    fields: ['类型', '编码'],
    steps: [
      {
        kind: 'imageText',
        pattern: SHELF_NUMBER_PATTERN,
        flags: '',
        preferredArea: { left: -0.1, top: 1, right: 1.1, bottom: 1.6 },
        whenMissing: 'block',
        output: '货架号',
      },
    ],
  });
  if (!saved.ok) {
    throw new Error(saved.issue);
  }
  await callApi(page, 'updateSettings', {
    mobileRelayUrl: relay.baseUrl,
    paperPrinters: { '60x40': LABEL_PRINTER.name },
  });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function startMobile(page: Page): Promise<void> {
  await page.getByRole('button', { name: '手机扫码' }).click();
  await expect(
    page.getByRole('dialog', { name: '手机扫码' }).getByRole('img', { name: '手机扫码的二维码' }),
  ).toBeVisible();
}

function resultOf(events: SessionEvent[], job: string) {
  const event = events.find((item) => item.type === 'result' && item.job === job);
  return event?.type === 'result' ? event.result : null;
}

test('reads the shelf number from the label image a phone sends', async ({ electronApp }) => {
  const { page } = await electronApp.launch({
    fakePrinters: [LABEL_PRINTER],
    fakeOcr: ['编码：CL5640-TK', 'A-12-3-10'],
  });
  await useShelfRule(page);
  await startMobile(page);
  const phone = await connectTestPhone(relay, await activeUrl(page));
  try {
    await expect.poll(() => hasEvent(phone.events, 'welcomed')).toBe(true);
    // 有这种步骤、电脑能识别：welcome 里要整张标签的图。
    expect(phone.events.find((event) => event.type === 'welcomed')).toMatchObject({
      image: {
        area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 },
        pixelsPerCode: PIXELS_PER_CODE,
        frames: LABEL_FRAMES,
      },
    });
    const job = phone.session.submit(SHELF_RAW, false, { image: LABEL_IMAGE, moreImages: [], fields: [] });
    await expect.poll(() => resultOf(phone.events, job)?.status).toBe('printed');
    expect(resultOf(phone.events, job)).toMatchObject({
      fields: expect.arrayContaining([{ name: '货架号', value: 'A-12-3-10' }]),
    });
    const [record] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
    expect(record).toMatchObject({ source: 'mobile', status: 'printed' });
    expect(record?.fields).toContainEqual({ name: '货架号', value: 'A-12-3-10' });
  } finally {
    phone.session.stop();
  }
});

test('asks the phone for the shelf number it could not read and prints it once typed', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER], fakeOcr: ['尺码：36'] });
  await useShelfRule(page);
  await startMobile(page);
  const phone = await connectTestPhone(relay, await activeUrl(page));
  try {
    await expect.poll(() => hasEvent(phone.events, 'welcomed')).toBe(true);
    const unread = phone.session.submit(SHELF_RAW, false, { image: LABEL_IMAGE, moreImages: [], fields: [] });
    await expect.poll(() => resultOf(phone.events, unread)?.status).toBe('failed');
    expect(resultOf(phone.events, unread)).toEqual({
      status: 'failed',
      reason: 'TEXT_NOT_FOUND',
      detail: '没认出货架号',
      issue: null,
      field: '货架号',
    });
    // 电脑上的打印记录写明没认出，没有打印。
    await expect(page.locator('.job-row').first()).toContainText('没认出');

    const typed = phone.session.submit(SHELF_RAW, false, {
      image: null,
      moreImages: [],
      fields: [{ name: '货架号', value: 'B-1-2-3' }],
    });
    await expect.poll(() => resultOf(phone.events, typed)?.status).toBe('printed');
    const [record] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
    expect(record?.fields).toContainEqual({ name: '货架号', value: 'B-1-2-3' });
  } finally {
    phone.session.stop();
  }
});

// 扫码枪没有图：这一步跳过，和没有这一步时一样照常打印，不拦下。
test('prints scanner scans without the image text step getting in the way', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER], fakeOcr: ['A-1-2-3'] });
  await useShelfRule(page);
  await callApi(page, 'updateSettings', { autoPrint: true });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await page.locator('.scan-bar__input').fill(SHELF_RAW);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await callApi(page, 'listJobs', { limit: 1 })).jobs[0]?.status).toBe('printed');
  const [record] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
  expect(record?.fields?.some((field) => field.name === '货架号')).toBe(false);
});

/** 仓库里编译好的扩展和下载好的这一档模型（bun run ocr:build、ocr:models）；CI 上没有，这个用例跳过。 */
const hasRealOcr = (tier: OcrModelTier): boolean =>
  missingOcrFiles(
    ocrFiles({
      isPackaged: false,
      resourcesPath: '',
      appRoot: APP_ROOT,
      platform: process.platform,
      arch: process.arch,
      tier,
    }),
  ).length === 0;

// 真实的文字识别：主进程加载扩展和模型，读一张真实的标签照片（横着拍的，货架号在二维码左边，不在优先区域里）。
for (const { id: tier } of OCR_MODEL_TIERS) {
  test(`reads the shelf number from a real label photo with the ${tier} OCR models`, async ({ electronApp }) => {
    test.skip(!hasRealOcr(tier), '没有编译好的 OCR 扩展或模型（bun run ocr:build、bun run ocr:models）');
    // 像手机那样只截标签那一块、压成 JPEG（不超过 64 KB）。
    const jpeg = await sharp(join(APP_ROOT, 'native', 'ocr', 'fixtures', 'shelf-label.jpg'))
      .extract({ left: 200, top: 270, width: 640, height: 880 })
      .grayscale()
      .jpeg({ quality: 80 })
      .toBuffer();
    const { page } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER] });
    await callApi(page, 'updateSettings', { ocrModelTier: tier });
    await useShelfRule(page);
    expect((await callApi(page, 'getAppInfo')).canReadImageText).toBe(true);
    await startMobile(page);
    const phone = await connectTestPhone(relay, await activeUrl(page));
    try {
      await expect.poll(() => hasEvent(phone.events, 'welcomed')).toBe(true);
      const image = { jpeg: jpeg.toString('base64'), code: { x: 237, y: 17, size: 340 } };
      const job = phone.session.submit(SHELF_RAW, false, { image, moreImages: [], fields: [] });
      await expect.poll(() => resultOf(phone.events, job)?.status, { timeout: 30_000 }).toBe('printed');
      const [record] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
      expect(record?.fields).toContainEqual({ name: '货架号', value: 'A-1-2-3' });
    } finally {
      phone.session.stop();
    }
  });
}

test('switches the text recognition speed on the general page and keeps it', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER], fakeOcr: ['A-1-2-3'] });
  await openConfig(page, '通用');
  const speed = page.getByRole('group', { name: '文字识别速度' });
  await expect(speed.getByRole('button', { name: '极速' })).toHaveAttribute('aria-pressed', 'true');
  await speed.getByRole('button', { name: '精准' }).click();
  await expect.poll(async () => (await callApi(page, 'getSettings')).ocrModelTier).toBe('accurate');
  await expect(speed.getByRole('button', { name: '精准' })).toHaveAttribute('aria-pressed', 'true');
});
