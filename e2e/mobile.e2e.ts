import type { Page } from '@playwright/test';
import type { SessionEvent } from '../relay/web/src/phone-session';
import type { MobileStatus } from '../src/shared/mobile-status';
import { callApi, openConfig } from './support/app-helpers';
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
