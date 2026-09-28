import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

/**
 * 以项目根目录启动：Electron 读 package.json 的 main 找到构建产物，app.getVersion() 才是软件版本。
 * 直接传 out/main/index.js 时找不到 package.json，拿到的是 Electron 自己的版本号。
 */
const APP_ROOT = join(__dirname, '..');
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
  const app = await electron.launch({ args: [APP_ROOT], env });
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
  const { version } = JSON.parse(await readFile(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string };
  await expect(page.locator('.title-bar__version')).toHaveText(`v${version}`);

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

test('previews a template after the pointer rests on it, without switching to it', async () => {
  const { app, page } = await launch();
  await page.getByRole('tab', { name: '模板' }).click();
  const badge = page.locator('.label-badge');
  await expect(badge).toHaveText('示例 · 标准（二维码在左）');

  const rightRow = page.locator('.template-row', { hasText: '二维码在右' });
  const name = rightRow.locator('.template-row__name');
  await name.hover();
  // 停留不到 1 秒不切换，满 1 秒后才预览。
  await page.waitForTimeout(500);
  await expect(badge).toHaveText('示例 · 标准（二维码在左）');
  // 在有人使用的电脑上，系统会按真实光标位置补发「离开窗口」，打断计时。
  // 每一轮重新悬停（像手在行上轻微晃动），再等满 1 秒以上：没被打断时第一轮就通过。
  await expect(async () => {
    await name.hover({ position: { x: 2, y: 2 } });
    await expect(badge).toHaveText('预览 · 二维码在右 · 点「使用」后才会用于打印', { timeout: 1_500 });
  }).toPass({ timeout: 6_000 });
  await expect(rightRow).toContainText('预览中');
  await expect(page.frameLocator('.label-frame').locator('body')).toHaveClass(/layout-qr-right/);
  await expect(page.locator('.template-row', { hasText: '使用中' })).toContainText('标准（二维码在左）');

  // 离开列表立即恢复成使用中的模板。
  await page.locator('.scan-bar__input').hover();
  await expect(badge).toHaveText('示例 · 标准（二维码在左）');
  await expect(rightRow).not.toContainText('预览中');
  await app.close();
});

test('keeps the scan box ready without touching its selection', async () => {
  const { app, page } = await launch();
  const input = page.locator('.scan-bar__input');
  const selection = () => input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd]);

  // 焦点在按钮上时扫码枪开始「打字」：第一个字符就切到扫码框，一个都不丢。
  await page.getByRole('tab', { name: '打印记录' }).focus();
  await page.keyboard.type('ABC-RED-XL');
  await expect(input).toHaveValue('ABC-RED-XL');

  // 点软件里的空白处：焦点回到扫码框，但不全选、不改动内容。
  await page.locator('.preview-stage').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(400);
  await expect(input).toBeFocused();
  const [start, end] = await selection();
  expect(start).toBe(end);
  await expect(input).toHaveValue('ABC-RED-XL');

  // 只有在扫码框里双击才全选：编码里有「-」，默认双击只会选中其中一截。
  await input.dblclick();
  expect(await selection()).toEqual([0, 'ABC-RED-XL'.length]);
  await app.close();
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
