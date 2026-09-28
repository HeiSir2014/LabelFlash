import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js');
/** 与 src/main/index.ts 中的 USER_DATA_OVERRIDE_ENV 一致：只在未打包时生效。 */
const USER_DATA_ENV = 'CDL_LABELFLASH_USER_DATA';

let userData: string;

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'cdl-labelflash-e2e-'));
});

test.afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  // 不带 ELECTRON_RENDERER_URL：界面必须走 app:// 协议，和安装版一致。
  const env: Record<string, string> = { [USER_DATA_ENV]: userData };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }
  const app = await electron.launch({ args: [MAIN_ENTRY], env });
  const page = await app.firstWindow();
  await expect(page.locator('.scan-bar__input')).toBeVisible();
  return { app, page };
}

async function scan(page: Page, raw: string): Promise<void> {
  await page.locator('.scan-bar__input').fill(raw);
  await page.locator('.scan-bar__input').press('Enter');
}

test('loads the UI over app:// and previews a scanned label', async () => {
  const { app, page } = await launch();
  await expect(page).toHaveTitle('CDL-云签速印');
  expect(page.url()).toBe('app://bundle/index.html');

  await scan(page, 'CL5640-TK-图片色-XXL');
  await expect(page.locator('.status-strip__title')).toHaveText('还没选打印机');
  const label = page.frameLocator('.label-frame');
  await expect(label.locator('.value-code')).toHaveText('CL5640-TK');
  await expect(label.locator('.value-size')).toHaveText('XXL');

  await scan(page, 'hello');
  await expect(page.locator('.status-strip__title')).toHaveText('二维码格式不对');
  await app.close();
});

test('keeps a saved custom template and the note selection after a restart', async () => {
  const first = await launch();
  const page = first.page;
  await page.getByRole('tab', { name: '模板' }).click();
  await page.locator('.template-row').first().getByRole('button', { name: '复制' }).click();
  await page.locator('.template-editor').getByLabel('模板名称').fill('E2E 模板');
  await page.getByRole('button', { name: '保存模板' }).click();
  const customRow = page.locator('.template-row', { hasText: 'E2E 模板' });
  await customRow.getByRole('button', { name: '使用' }).click();
  await expect(customRow).toContainText('使用中');

  await page.getByRole('tab', { name: '设置' }).click();
  await page.locator('.note-presets textarea').fill('E2E 备注 {日期}');
  await page.getByRole('button', { name: /添加常用备注/ }).click();
  await page.getByRole('combobox', { name: '备注' }).selectOption({ label: 'E2E 备注 {日期}' });
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await first.app.close();

  const second = await launch();
  await second.page.getByRole('tab', { name: '模板' }).click();
  await expect(second.page.locator('.template-row', { hasText: 'E2E 模板' })).toContainText('使用中');
  await expect(second.page.getByRole('combobox', { name: '备注' }).locator('option:checked')).toHaveText(
    'E2E 备注 {日期}',
  );
  await expect(second.page.frameLocator('.label-frame').locator('.note')).toContainText('E2E 备注');
  await second.app.close();
});

test('keeps the page isolated from Node and blocks new windows', async () => {
  const { app, page } = await launch();
  const exposure = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    api: typeof (window as unknown as { api?: unknown }).api,
    popup: window.open('https://example.com') === null,
  }));
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', api: 'object', popup: true });
  expect(app.windows()).toHaveLength(1);
  await app.close();
});
