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
  await expect(page.locator('.title-bar__name')).toHaveText('CDL-云签速印');
  await expect(page.locator('.title-bar__version')).toHaveText(`v${version}`);

  // 没扫码时用示例内容展示当前模板。
  const usage = page.locator('.preview-toolbar__usage');
  await expect(usage).toHaveText('示例内容 · 模板：通用（二维码在左）');

  // 横杠三段：默认绑定样衣标准模板，只显示编码 / 颜色 / 尺码。
  await scan(page, 'CL5640-TK-图片色-XXL');
  await expect(page.locator('.status-strip__title')).toHaveText('还没选打印机');
  await expect(usage).toHaveText('规则：横杠三段（编码-颜色-尺码） · 模板：样衣标准（二维码在左）（规则指定）');
  const values = page.frameLocator('.label-frame').locator('.value');
  await expect(values).toHaveText(['CL5640-TK', '图片色', 'XXL']);

  // 纯数字订单号：用当前模板（通用），字段区列出「订单号」。
  await scan(page, '202609280001');
  await expect(usage).toHaveText('规则：纯数字订单号 · 模板：通用（二维码在左）');
  await expect(values).toHaveText(['202609280001']);
  await expect(page.frameLocator('.label-frame').locator('.prefix')).toHaveText(['订单号：']);

  // 任意内容原样打印。
  await scan(page, 'hello');
  await expect(usage).toHaveText('规则：原样打印 · 模板：通用（二维码在左）');
  await expect(values).toHaveText(['hello']);

  // 含不可见字符的内容无法识别。
  await scan(page, 'ab​cd');
  await expect(page.locator('.status-strip__title')).toHaveText('扫码内容无法识别');
  await app.close();
});

test('takes a burst of lines with Enters in between as one multi-line scan', async () => {
  const { app, page } = await launch();
  const input = page.locator('.scan-bar__input');
  await input.focus();
  // 像扫码枪一样连续发出按键：码里的换行后面紧跟着下一个字符，只有最后的回车后面是停顿。
  for (const line of ['订单号：A001', '款号：CL5640', '尺码：XL']) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：多行键值 · 模板：通用（二维码在左）');
  await expect(page.frameLocator('.label-frame').locator('.value')).toHaveText(['A001', 'CL5640', 'XL']);
  await expect(input).toHaveValue('');
  await app.close();
});

test('tries content against the rules and prints with the template bound to a rule', async () => {
  const { app, page } = await launch();
  await page.getByRole('tab', { name: '识别规则' }).click();
  await page.getByLabel('要识别的内容').first().fill('202609280001');
  await expect(page.locator('.rule-tester__result').first()).toContainText('命中「纯数字订单号」');

  // 没有规则认得下划线：落到「原样打印」；新建一条下划线分隔的规则后，命中新规则。
  const tester = page.getByLabel('要识别的内容').first();
  await tester.fill('CL1_红_M');
  await expect(page.locator('.rule-tester__result').first()).toContainText('命中「原样打印」');
  await page.getByRole('button', { name: '新建规则' }).click();
  await page.getByRole('button', { name: '返回列表' }).click();
  await tester.fill('CL1_红_M ');
  await expect(page.locator('.rule-tester__result').first()).toContainText('命中「新规则（分隔符拆分）」');

  await page.getByLabel('「纯数字订单号」用的模板').selectOption({ label: '样衣标准（二维码在左）' });
  await scan(page, '202609280001');
  await expect(page.locator('.preview-toolbar__usage')).toHaveText(
    '规则：纯数字订单号 · 模板：样衣标准（二维码在左）（规则指定）',
  );
  await app.close();
});

test('switches the current template from the preview toolbar', async () => {
  const { app, page } = await launch();
  await page.getByRole('combobox', { name: '当前模板' }).selectOption({ label: '通用（二维码在右）' });
  await expect(page.locator('.preview-toolbar__usage')).toHaveText('示例内容 · 模板：通用（二维码在右）');
  await expect(page.frameLocator('.label-frame').locator('body')).toHaveClass(/layout-qr-right/);
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await app.close();
});

/** 打开配置中心的某一页（默认「模板」）。 */
async function openConfig(page: Page, pageName = '模板'): Promise<void> {
  if ((await page.locator('.config-center').count()) === 0) {
    await page.getByRole('button', { name: '配置', exact: true }).click();
  }
  await page.getByRole('navigation', { name: '配置' }).getByRole('button', { name: pageName, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: pageName })).toBeVisible();
}

test('keeps a saved custom template and the note selection after a restart', async () => {
  const first = await launch();
  const page = first.page;
  await openConfig(page);
  await page.locator('.template-item').first().click();
  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('编辑：');
  await page.locator('.template-form').getByLabel('模板名称').fill('E2E 模板');
  await page.getByRole('button', { name: '保存模板' }).click();
  const customItem = page.locator('.template-item', { hasText: 'E2E 模板' });
  await expect(customItem).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await expect(customItem).toContainText('使用中');
  await page.getByRole('button', { name: '返回工作台' }).click();

  // 备注下拉框的「管理常用备注…」打开配置中心的「常用备注」页。
  await page.getByRole('combobox', { name: '备注' }).selectOption({ label: '管理常用备注…' });
  await expect(page.getByRole('heading', { level: 1, name: '常用备注' })).toBeVisible();
  await page.getByLabel('新的常用备注').fill('E2E 备注 {日期}');
  await page.getByRole('button', { name: /添加常用备注/ }).click();
  await expect(page.locator('.note-card')).toHaveText(['E2E 备注 {日期}删除']);
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.getByRole('combobox', { name: '备注' }).selectOption({ label: 'E2E 备注 {日期}' });
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await first.app.close();

  const second = await launch();
  await expect(second.page.locator('.preview-toolbar__usage')).toHaveText('示例内容 · 模板：E2E 模板');
  await expect(second.page.getByRole('combobox', { name: '备注' }).locator('option:checked')).toHaveText(
    'E2E 备注 {日期}',
  );
  await expect(second.page.frameLocator('.label-frame').locator('.note')).toContainText('E2E 备注');
  await openConfig(second.page);
  await expect(second.page.locator('.template-item', { hasText: 'E2E 模板' })).toContainText('使用中');
  await second.app.close();
});

test('previews a template by selecting it, without switching the current template', async () => {
  const { app, page } = await launch();
  await openConfig(page);
  const preview = page.frameLocator('.config-center .label-frame').locator('body');
  await expect(preview).toHaveClass(/layout-qr-left/);

  await page.locator('.template-item', { hasText: '通用（二维码在右）' }).click();
  await expect(preview).toHaveClass(/layout-qr-right/);
  await expect(page.locator('.template-item', { hasText: '使用中' })).toContainText('通用（二维码在左）');

  // 预览内容可以改成任意扫码内容。
  await page.getByLabel('预览内容').fill('202609280001');
  await expect(page.frameLocator('.config-center .label-frame').locator('.value')).toHaveText(['202609280001']);

  await page.getByRole('button', { name: '返回工作台' }).click();
  await expect(page.getByRole('combobox', { name: '当前模板' }).locator('option:checked')).toHaveText(
    '通用（二维码在左）',
  );
  await app.close();
});

test('asks before leaving a template with unsaved changes', async () => {
  const { app, page } = await launch();
  await openConfig(page);
  await page.locator('.template-item', { hasText: '通用（二维码在左）' }).click();
  await page.getByRole('button', { name: '复制' }).click();
  const name = page.locator('.template-form').getByLabel('模板名称');
  const original = await name.inputValue();
  await name.fill('改过的名字');

  const nav = page.getByRole('navigation', { name: '配置' });
  const dialog = page.getByRole('alertdialog', { name: '有未保存的修改' });
  await nav.getByRole('button', { name: '识别规则' }).click();
  await expect(dialog).toBeVisible();
  // 回车等于「继续编辑」：扫码枪的回车不会丢掉修改。
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(name).toHaveValue('改过的名字');

  await nav.getByRole('button', { name: '识别规则' }).click();
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '识别规则' })).toBeVisible();
  await openConfig(page);
  await expect(page.locator('.template-item', { hasText: '改过的名字' })).toHaveCount(0);
  await expect(page.locator('.template-item', { hasText: original })).toHaveCount(1);
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

test('opens the config center over the workbench and comes back to the scan box', async () => {
  const { app, page } = await launch();
  const workspaceInert = page.locator('.workspace[inert]');
  await page.getByRole('button', { name: '配置', exact: true }).click();

  // 默认打开「模板」页，焦点在页标题；工作台不可聚焦，标题栏按钮显示按下。
  await expect(page.getByRole('heading', { level: 1, name: '模板' })).toBeFocused();
  await expect(page.getByRole('button', { name: '配置中', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspaceInert).toHaveCount(1);
  await expect(page.getByText('配置中不打印')).toBeVisible();
  const nav = page.getByRole('navigation', { name: '配置' });
  await expect(nav.getByRole('button', { name: '模板', exact: true })).toHaveAttribute('aria-current', 'page');

  // Esc 回工作台，焦点回扫码框。
  await nav.getByRole('button', { name: '通用' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '通用' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.config-center')).toHaveCount(0);
  await expect(workspaceInert).toHaveCount(0);
  await expect(page.locator('.scan-bar__input')).toBeFocused();

  // 快捷键开关配置中心，再次打开时回到上次的页面。
  const shortcut = process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma';
  await page.keyboard.press(shortcut);
  await expect(page.getByRole('heading', { level: 1, name: '通用' })).toBeFocused();
  await page.keyboard.press(shortcut);
  await expect(page.locator('.config-center')).toHaveCount(0);
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await app.close();
});

test('never prints from the config center, even with F2', async () => {
  const { app, page } = await launch();
  // 换掉主进程的打印处理：只计数，不碰真实打印机。
  await app.evaluate(({ ipcMain }) => {
    const calls = { count: 0 };
    (globalThis as { e2ePrintCalls?: typeof calls }).e2ePrintCalls = calls;
    ipcMain.removeHandler('label:print');
    ipcMain.handle('label:print', () => {
      calls.count += 1;
      return { status: 'failed', reason: 'PRINT_ERROR' };
    });
  });
  const printCalls = () =>
    app.evaluate(() => (globalThis as { e2ePrintCalls?: { count: number } }).e2ePrintCalls?.count ?? -1);
  await page.evaluate(() =>
    (window as unknown as { api: { updateSettings(patch: object): Promise<unknown> } }).api.updateSettings({
      selectedPrinter: 'E2E 打印机',
      autoPrint: false,
    }),
  );
  await page.reload();
  await scan(page, 'CL5640-TK-图片色-XL');
  await expect(page.locator('.status-strip__title')).toHaveText('待打印');

  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '模板' })).toBeFocused();
  await page.keyboard.press('F2');
  await page.waitForTimeout(500);
  expect(await printCalls()).toBe(0);

  // 对照：回到工作台后 F2 照常打印。
  await page.getByRole('button', { name: '返回工作台' }).click();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await page.keyboard.press('F2');
  await expect.poll(printCalls).toBe(1);
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
