import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  blurActiveElement,
  callApi,
  openConfig,
  recordClipboard,
  recordVoiceCues,
  scan,
  stubOpenDialog,
  stubPrinting,
  typeLikeScanner,
} from './support/app-helpers';
import { APP_ROOT } from './support/electron-app';
import { expect, test } from './support/fixtures';

/** 选一台假打印机、设好打印方式，重新加载界面让设置生效（打印处理要先用 stubPrinting 换掉）。 */
async function usePrinter(page: Page, autoPrint: boolean): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': 'E2E 打印机' }, autoPrint });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

/**
 * 断言到此为止没有发出过打印：先走一次 IPC 往返再读计数。同一个页面发出的 IPC 按顺序到达主进程，
 * 之前如果误发了打印，这时一定已经计上了，不用靠固定的等待时间。
 */
async function expectNoPrintSoFar(app: ElectronApplication, page: Page): Promise<void> {
  const printCalls = () =>
    app.evaluate(() => (globalThis as { e2ePrintCalls?: { count: number } }).e2ePrintCalls?.count ?? -1);
  await callApi(page, 'getSettings');
  expect(await printCalls()).toBe(0);
}

test('loads the UI over app:// and previews a scanned label', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await expect(page).toHaveTitle('CDL-云签速印');
  expect(page.url()).toBe('app://bundle/index.html');
  const { version } = JSON.parse(await readFile(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string };
  await expect(page.locator('.title-bar__name')).toHaveText('CDL-云签速印');
  await expect(page.locator('.title-bar__version')).toHaveText(`v${version}`);

  // 没扫码时用示例内容展示当前模板。
  const usage = page.locator('.preview-toolbar__usage');
  await expect(usage).toHaveText('示例内容 · 模板：通用（二维码在左） · 打印机：还没有');

  // 横杠三段：默认绑定样衣标准模板，只显示编码 / 颜色 / 尺码。
  await scan(page, 'CL5640-TK-图片色-XXL');
  await expect(page.locator('.status-strip__title')).toHaveText('没有可用的打印机');
  await expect(usage).toHaveText(
    '规则：横杠三段（编码-颜色-尺码） · 模板：样衣标准（二维码在左）（规则指定） · 打印机：还没有',
  );
  const values = page.frameLocator('.label-frame').locator('.value');
  await expect(values).toHaveText(['CL5640-TK', '图片色', 'XXL']);

  // 纯数字订单号：用当前模板（通用），字段区列出「订单号」。
  await scan(page, '202609280001');
  await expect(usage).toHaveText('规则：纯数字订单号 · 模板：通用（二维码在左） · 打印机：还没有');
  await expect(values).toHaveText(['202609280001']);
  await expect(page.frameLocator('.label-frame').locator('.prefix')).toHaveText(['订单号：']);

  // 任意内容原样打印。
  await scan(page, 'hello');
  await expect(usage).toHaveText('规则：原样打印 · 模板：通用（二维码在左） · 打印机：还没有');
  await expect(values).toHaveText(['hello']);

  // 含不可见字符的内容无法识别。
  await scan(page, 'ab​cd');
  await expect(page.locator('.status-strip__title')).toHaveText('扫码内容无法识别');
});

test('takes a burst of lines with Enters in between as one multi-line scan', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const input = page.locator('.scan-bar__input');
  await input.focus();
  // 像扫码枪一样连续发出按键：码里的换行后面紧跟着下一个字符，只有最后的回车后面是停顿。
  await typeLikeScanner(page, ['订单号：A001', '款号：CL5640', '尺码：XL']);
  await expect(page.locator('.preview-toolbar__usage')).toHaveText(
    '规则：多行键值 · 模板：通用（二维码在左） · 打印机：还没有',
  );
  await expect(page.frameLocator('.label-frame').locator('.value')).toHaveText(['A001', 'CL5640', 'XL']);
  await expect(input).toHaveValue('');
});

test('tries content against the rules and previews with the template a rule is bound to', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  // 工作台右侧栏只剩打印机和打印记录。
  await expect(page.getByRole('tab')).toHaveText(['打印机', '打印记录']);

  await openConfig(page, '识别规则');
  const tester = page.getByLabel('要识别的内容');
  const result = page.locator('.rule-tester__result');
  await tester.fill('202609280001');
  await expect(result).toContainText('命中「纯数字订单号」');

  // 没有规则认得下划线：落到「原样打印」；新建一条下划线分隔的规则后，命中新规则。
  await tester.fill('CL1_红_M');
  await expect(result).toContainText('命中「原样打印」');
  await page.getByRole('button', { name: '新建规则' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('编辑：新规则（分隔符拆分）');
  await page.getByRole('button', { name: '返回列表' }).click();
  // 「试一试」只在内容变化时重新识别：末尾加一个空格（识别前会去掉首尾空白），按新的规则列表再试一次。
  await tester.fill('CL1_红_M ');
  await expect(result).toContainText('命中「新规则（分隔符拆分）」');

  await page.getByLabel('「纯数字订单号」用的模板').selectOption({ label: '样衣标准（二维码在左）' });
  await page.getByRole('button', { name: '返回工作台' }).click();
  await scan(page, '202609280001');
  await expect(page.locator('.preview-toolbar__usage')).toHaveText(
    '规则：纯数字订单号 · 模板：样衣标准（二维码在左）（规则指定） · 打印机：还没有',
  );
});

test('imports a lookup table and shows its first rows', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const csvPath = join(electronApp.userData, '货架.csv');
  await writeFile(csvPath, '编码,货架\nCL5640-TK,A-01\nCL5641-TK,A-02\n', 'utf8');
  await stubOpenDialog(app, csvPath);

  await openConfig(page, '查找表');
  await page.getByRole('button', { name: '导入 CSV 表格' }).click();
  const card = page.locator('.lookup-card', { hasText: '货架' });
  await expect(card).toContainText('2 行');
  await card.getByRole('button', { name: '查看前 20 行' }).click();
  const table = page.getByRole('table', { name: '「货架」前 20 行' });
  await expect(table.getByRole('columnheader')).toHaveText(['编码', '货架']);
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row').nth(1)).toContainText('CL5640-TK');
});

test('switches the current template from the preview toolbar', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await page.getByRole('combobox', { name: '当前模板' }).selectOption({ label: '通用（二维码在右）' });
  await expect(page.locator('.preview-toolbar__usage')).toHaveText(
    '示例内容 · 模板：通用（二维码在右） · 打印机：还没有',
  );
  await expect(page.frameLocator('.label-frame').locator('body')).toHaveClass(/layout-qr-right/);
  await expect(page.locator('.scan-bar__input')).toBeFocused();
});

test('keeps a saved custom template and the note selection after a restart', async ({ electronApp }) => {
  const first = await electronApp.launch();
  const page = first.page;
  await openConfig(page, '模板');
  await page.locator('.template-item').first().click();
  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('编辑：');
  await page.locator('.template-form').getByLabel('模板名称').fill('E2E 模板');
  await page.getByRole('button', { name: '保存模板' }).click();
  const customItem = page.locator('.template-item', { hasText: 'E2E 模板' });
  await expect(customItem).toHaveAttribute('aria-pressed', 'true');
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

  const second = await electronApp.launch();
  await expect(second.page.locator('.preview-toolbar__usage')).toHaveText('示例内容 · 模板：E2E 模板 · 打印机：还没有');
  await expect(second.page.getByRole('combobox', { name: '备注' }).locator('option:checked')).toHaveText(
    'E2E 备注 {日期}',
  );
  await expect(second.page.frameLocator('.label-frame').locator('.note')).toContainText('E2E 备注');
  await openConfig(second.page, '模板');
  await expect(second.page.locator('.template-item', { hasText: 'E2E 模板' })).toContainText('使用中');
});

test('previews a template by selecting it, without switching the current template', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '模板');
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
});

test('asks before leaving a template with unsaved changes', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '通用（二维码在左）' }).click();
  await page.getByRole('button', { name: '复制' }).click();
  const name = page.locator('.template-form').getByLabel('模板名称');
  const original = await name.inputValue();
  await name.fill('改过的名字');

  const nav = page.getByRole('navigation', { name: '配置' });
  const dialog = page.getByRole('alertdialog', { name: '有未保存的修改' });
  await nav.getByRole('button', { name: '识别规则' }).click();
  await expect(dialog).toBeVisible();
  // 回车等于「继续编辑」：扫码枪的回车不会丢掉修改。焦点回到打开确认框之前的导航按钮。
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(name).toHaveValue('改过的名字');
  await expect(nav.getByRole('button', { name: '识别规则' })).toBeFocused();

  // 放弃修改后换页：焦点落在新页面的标题上，不被确认框抢回导航。
  await nav.getByRole('button', { name: '识别规则' }).click();
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '识别规则' })).toBeFocused();
  await openConfig(page, '模板');
  await expect(page.locator('.template-item', { hasText: '改过的名字' })).toHaveCount(0);
  await expect(page.locator('.template-item', { hasText: original })).toHaveCount(1);
});

test('keeps the scan box ready without touching its selection', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const input = page.locator('.scan-bar__input');
  const selection = () => input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd]);

  // 焦点在按钮上时扫码枪开始「打字」：第一个字符就切到扫码框，一个都不丢。
  await page.getByRole('tab', { name: '打印记录' }).focus();
  await page.keyboard.type('ABC-RED-XL');
  await expect(input).toHaveValue('ABC-RED-XL');

  // 焦点在下拉框上时也一样：字母不会被下拉框当成跳选吞掉。
  await input.fill('');
  await page.getByRole('combobox', { name: '当前模板' }).focus();
  await page.keyboard.type('CL5640');
  await expect(input).toHaveValue('CL5640');
  await input.fill('ABC-RED-XL');

  // 点软件里的空白处：焦点回到扫码框，但不全选、不改动内容。
  await page.locator('.preview-stage').click({ position: { x: 5, y: 5 } });
  await expect(input).toBeFocused();
  const [start, end] = await selection();
  expect(start).toBe(end);
  await expect(input).toHaveValue('ABC-RED-XL');

  // 只有在扫码框里双击才全选：编码里有「-」，默认双击只会选中其中一截。
  await input.dblclick();
  expect(await selection()).toEqual([0, 'ABC-RED-XL'.length]);
});

test('keeps the line breaks of a code pasted into the scan box', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const input = page.locator('.scan-bar__input');
  await input.focus();
  // 单行输入框（Windows 上是密码框）自己粘贴会删掉换行；从表格复制时末尾的换行不算码的一部分。
  await input.evaluate((element: HTMLInputElement) => {
    const data = new DataTransfer();
    data.setData('text/plain', '编码：CL5887\r\n颜色：灰色\r\n');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(input).toHaveValue('编码：CL5887⏎颜色：灰色');
  await expect(page.locator('.scan-bar__text')).toHaveText('编码：CL5887⏎颜色：灰色');
});

test('edits the scan box by hand after a click and goes back to scanning', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const input = page.locator('.scan-bar__input');
  // Windows：扫码模式是密码框（关掉输入法），点进去手动编辑时换成普通输入框；macOS 始终是普通输入框。
  const scanType = process.platform === 'win32' ? 'password' : 'text';
  await expect(input).toHaveAttribute('type', scanType);

  await input.click();
  await expect(input).toHaveAttribute('type', 'text');
  if (process.platform === 'win32') {
    await expect(page.getByText('手动输入 · 回车提交 · Esc 返回扫码')).toBeVisible();
  }
  await page.keyboard.type('CL5887-M');
  // 在中间改字：光标移到「CL」后面插入。
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await expect(input).toHaveValue('CLX5887-M');
  await page.keyboard.press('Enter');
  await expect(page.locator('.preview-toolbar__usage')).toHaveText(
    '规则：原样打印 · 模板：通用（二维码在左） · 打印机：还没有',
  );
  await expect(page.frameLocator('.label-frame').locator('.value')).toHaveText(['CLX5887-M']);
  await expect(input).toHaveAttribute('type', scanType);

  // Esc 回到扫码模式，内容留着。
  await input.click();
  await page.keyboard.type('AB');
  await page.keyboard.press('Escape');
  await expect(input).toHaveAttribute('type', scanType);
  await expect(input).toHaveValue('AB');
});

// 输入法开着时（macOS，或 Windows 的手动编辑模式）扫码枪的按键被输入法截住：keydown 的 key 是 Process，
// 框里是输入法组出来的错字。按物理按键（code + Shift）拼回扫码枪发出的内容，提交它，丢掉错字。
test('clears the lost-scan notice once the operator clicks into the scan box', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const input = page.locator('.scan-bar__input');
  // 输入法开着时一串扫码枪那样快的按键、没有结尾的回车：拼不回来，不提交，提醒操作员。
  await input.evaluate((element: HTMLInputElement) => {
    for (const code of ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE']) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code, bubbles: true, cancelable: true }));
    }
  });
  const notice = page.locator('.scan-bar__ime');
  await expect(notice).toBeVisible();
  // 操作员点进扫码框（macOS 上没有模式可切换，也一样）：提醒不再挂着。
  await input.click();
  await expect(notice).toBeHidden();
});

test('rebuilds a scan that the input method intercepted from the physical keys', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const input = page.locator('.scan-bar__input');
  await input.click();
  await input.evaluate((element: HTMLInputElement) => {
    const keys: [string, boolean][] = [
      ['KeyC', true],
      ['KeyL', true],
      ['Digit5', false],
      ['Digit8', false],
      ['Digit8', false],
      ['Digit7', false],
      ['Minus', false],
      ['KeyM', true],
      ['Enter', false],
    ];
    for (const [code, shiftKey] of keys) {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Process', code, shiftKey, bubbles: true, cancelable: true }),
      );
    }
    // 输入法随后把组出来的错字交给框（实测：数字被吞掉）。
    element.value = 'CL-M';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.frameLocator('.label-frame').locator('.value')).toHaveText(['CL5887-M']);
  await expect(input).toHaveValue('');
});

test('opens the config center over the workbench and comes back to the scan box', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const workspaceInert = page.locator('.workspace[inert]');
  await page.getByRole('button', { name: '配置', exact: true }).click();

  // 默认打开「模板」页，焦点在页标题；工作台不可聚焦，标题栏按钮显示按下。
  await expect(page.getByRole('heading', { level: 1, name: '模板' })).toBeFocused();
  await expect(page.getByRole('button', { name: '配置', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
});

test('never prints from the config center, even with F2', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const printCalls = await stubPrinting(app);
  await usePrinter(page, false);
  await scan(page, 'CL5640-TK-图片色-XL');
  await expect(page.locator('.status-strip__title')).toHaveText('待打印');

  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '模板' })).toBeFocused();
  await page.keyboard.press('F2');
  await expectNoPrintSoFar(app, page);

  // 对照：回到工作台后 F2 照常打印。
  await page.getByRole('button', { name: '返回工作台' }).click();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await page.keyboard.press('F2');
  await expect.poll(printCalls).toBe(1);
});

test('sends scans in the config center to the test box, or announces that nothing was printed', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch();
  // 自动打印：在工作台扫码会立即打印，配置中心里扫码一次都不能打。
  const printCalls = await stubPrinting(app);
  await usePrinter(page, true);
  const voiceCues = await recordVoiceCues(app);

  // 识别规则页：焦点不在输入框时扫码，内容填进「试一试」（替换原有内容）。
  await openConfig(page, '识别规则');
  const tester = page.getByLabel('要识别的内容');
  await tester.fill('旧内容');
  await blurActiveElement(page);
  await typeLikeScanner(page, ['202609280001']);
  await expect(tester).toHaveValue('202609280001');
  await expect(page.locator('.rule-tester__result')).toContainText('命中「纯数字订单号」');

  // 焦点停在下拉框上时也一样：扫码不会被下拉框吞掉，也不会改掉规则用的模板。
  const binding = page.getByLabel('「纯数字订单号」用的模板');
  await binding.focus();
  await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
  await expect(tester).toHaveValue('CL5640-TK-图片色-XL');
  await expect(binding.locator('option:checked')).toHaveText('用当前模板');

  // 模板页：填进「预览内容」，预览跟着换。
  await openConfig(page, '模板');
  await blurActiveElement(page);
  await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
  await expect(page.getByLabel('预览内容')).toHaveValue('CL5640-TK-图片色-XL');
  await expect(page.frameLocator('.config-center .label-frame').locator('.value')).toHaveText([
    'CL5640-TK',
    '图片色',
    'XL',
  ]);

  // 通用页没有测试框：哪个输入框都不改，播报「正在配置，没有打印」，「配置中不打印」闪烁提醒。
  await openConfig(page, '通用');
  await blurActiveElement(page);
  await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
  await expect.poll(voiceCues).toEqual(['configuring']);
  await expect(page.locator('.config-pill')).toHaveClass(/config-pill--flash/);
  await expect(page.getByLabel('防重复打印')).toHaveValue('3');

  // 回到工作台后扫码照常打印（对照）。
  await page.getByRole('button', { name: '返回工作台' }).click();
  await expectNoPrintSoFar(app, page);
  await scan(page, '202609280001');
  await expect.poll(printCalls).toBe(1);
});

test('types a secret by hand and copies its reference through the main process', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const copied = await recordClipboard(app);
  const voiceCues = await recordVoiceCues(app);
  await openConfig(page, '密钥');
  await page.getByLabel('名称', { exact: true }).fill('仓库接口');
  // 逐字输入（不是一次填入）：密码框里的按键属于密码框，不能被当成扫码切到隐藏的接收框。
  const secretValue = page.getByLabel('内容', { exact: true });
  await secretValue.pressSequentially('token-123');
  await expect(secretValue).toHaveValue('token-123');
  await page.getByRole('button', { name: '保存密钥' }).click();
  await page.getByRole('button', { name: '复制引用' }).click();
  await expect.poll(copied).toEqual(['{密钥:仓库接口}']);
  expect(await voiceCues()).toEqual([]);
});

test('asks before following a link out of a rule with unsaved changes', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '识别规则');
  await page.getByRole('button', { name: '新建规则' }).click();
  await page.getByLabel('要添加的步骤类型').selectOption({ label: '查找表' });
  await page.getByRole('button', { name: /添加步骤/ }).click();
  await page.getByRole('button', { name: '「查找表」页' }).click();
  const dialog = page.getByRole('alertdialog', { name: '有未保存的修改' });
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '查找表' })).toBeVisible();
});

test('keeps the page isolated from Node, the clipboard and new windows', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const exposure = await page.evaluate(async () => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    api: typeof (window as unknown as { api?: unknown }).api,
    popup: window.open('https://example.com') === null,
    // 网页权限一律拒绝：页面自己写不了剪贴板，只能经主进程复制密钥引用。
    clipboard: await navigator.clipboard.writeText('x').then(
      () => 'written',
      (error: unknown) => (error instanceof Error ? error.name : 'rejected'),
    ),
  }));
  expect(exposure).toEqual({
    require: 'undefined',
    process: 'undefined',
    api: 'object',
    popup: true,
    clipboard: 'NotAllowedError',
  });
  expect(app.windows()).toHaveLength(1);
});

// 模板换成别的纸：软尺刻度和标签框按这种纸的实际毫米数。
test('previews a label on the paper of its template', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const copy = await callApi(page, 'duplicateTemplate', 'builtin:generic');
  await callApi(page, 'saveTemplate', { ...copy, paper: { widthMm: 100, heightMm: 100 } });
  await callApi(page, 'updateSettings', { activeTemplateId: copy.id, autoPrint: false });
  await page.reload();
  await scan(page, 'hello');
  await expect(page.locator('.ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 100 /);
  await expect(page.locator('.ruler--vertical')).toHaveAttribute('viewBox', /^0 0 \S+ 100$/);
  const frame = await page.locator('.label-frame').boundingBox();
  expect(frame && Math.abs(frame.width / frame.height - 1)).toBeLessThan(0.02);
});
