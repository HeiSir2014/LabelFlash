import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import sharp from 'sharp';
import { BUILT_IN_WAYBILLS } from '../src/core/templates/builtin-waybills';
import { estimateTextWidthEm } from '../src/core/templates/text-fit';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import {
  allowSlowScannerLines,
  blurActiveElement,
  callApi,
  clippedLines,
  fakePrints,
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

  // 没扫码时用示例内容展示当前模板：模板只在下拉框里显示一次，旁边只说内容从哪来。
  const usage = page.locator('.preview-toolbar__usage');
  await expect(usage).toHaveText('示例内容');
  await expect(page.getByRole('combobox', { name: '模板', exact: true }).locator('option:checked')).toHaveText(
    '通用（二维码在左）',
  );

  // 横杠三段：用当前模板（通用），列出编码 / 颜色 / 尺码。
  await scan(page, 'CL5640-TK-图片色-XXL');
  await expect(page.locator('.status-strip__title')).toHaveText('没有可用的打印机');
  const template = page.getByRole('combobox', { name: '模板', exact: true });
  await expect(usage).toHaveText('规则：横杠三段（编码-颜色-尺码）');
  await expect(template.locator('option:checked')).toHaveText('通用（二维码在左）');
  const values = page.frameLocator('.label-frame').locator('.value');
  await expect(values).toHaveText(['CL5640-TK', '图片色', 'XXL']);
  await expect(page.frameLocator('.label-frame').locator('.prefix')).toHaveText(['编码：', '颜色：', '尺码：']);

  // 纯数字订单号：用当前模板（通用），字段区列出「订单号」。
  await scan(page, '202609280001');
  await expect(usage).toHaveText('规则：纯数字订单号');
  await expect(template.locator('option:checked')).toHaveText('通用（二维码在左）');
  await expect(values).toHaveText(['202609280001']);
  await expect(page.frameLocator('.label-frame').locator('.prefix')).toHaveText(['订单号：']);

  // 任意内容原样打印。
  await scan(page, 'hello');
  await expect(usage).toHaveText('规则：原样打印');
  await expect(values).toHaveText(['hello']);

  // 含不可见字符的内容无法识别。
  await scan(page, 'ab​cd');
  await expect(page.locator('.status-strip__title')).toHaveText('扫码内容无法识别');
});

/**
 * 退出不能卡住：没有批量打印、没有 PDF 在打印时，关窗应该在几秒内让程序真的退出，不是等到测试框架的
 * 60 秒整体超时才发现。曾经因为在 will-quit 里 preventDefault 之后又在 will-quit 里重新调用
 * app.quit()（而不是走 before-quit 本来就有的那一套）而彻底卡死：Electron 不会因为在 will-quit
 * 里再调一次 app.quit() 就重新走一遍退出流程，进程永远不会真的退出。
 */
test('quits promptly when nothing is printing', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  const start = Date.now();
  await app.close();
  // 明显比测试整体的 60 秒超时短：正常退出不该接近这个数，拖到这么久本身就说明卡住了。
  expect(Date.now() - start).toBeLessThan(10_000);
});

test('takes a burst of lines with Enters in between as one multi-line scan', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await allowSlowScannerLines(page);
  const input = page.locator('.scan-bar__input');
  await input.focus();
  // 像扫码枪一样连续发出按键：码里的换行后面紧跟着下一个字符，只有最后的回车后面是停顿。
  await typeLikeScanner(page, ['订单号：A001', '款号：CL5640', '尺码：XL']);
  await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：多行键值');
  await expect(page.frameLocator('.label-frame').locator('.value')).toHaveText(['A001', 'CL5640', 'XL']);
  await expect(input).toHaveValue('');
});

test('tries content against the rules and previews with the template a rule is bound to', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  // 工作台右侧栏只有打印记录（打印机在配置中心的「打印机」页），没有标签页。
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '打印记录' })).toBeVisible();

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

  await page.getByLabel('「纯数字订单号」用的模板').selectOption({ label: '通用 · 大二维码 + 日期备注' });
  await page.getByRole('button', { name: '返回工作台' }).click();
  await scan(page, '202609280001');
  // 规则指定的模板显示在下拉框里、锁住（改当前模板对这一张不起作用），旁边标「规则指定」。
  await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：纯数字订单号');
  const template = page.getByRole('combobox', { name: '模板', exact: true });
  await expect(template.locator('option:checked')).toHaveText('通用 · 大二维码 + 日期备注');
  await expect(template).toBeDisabled();
  await expect(page.locator('.preview-toolbar').getByText('规则指定')).toBeVisible();
});

// 按字段换模板：同一条规则按字段的值换模板（例如快递公司是顺丰就用顺丰面单），纸张和打印机跟着模板走。
test('switches the template by a field value set on the rules page', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '识别规则');
  const card = page.locator('.rule-card', { hasText: '原样打印' });
  await card.getByRole('button', { name: '按字段换模板' }).click();
  await card.getByRole('button', { name: '加一条' }).click();
  await card.getByLabel('第 1 条的字段').fill('内容');
  await card.getByLabel('第 1 条的值').fill('SF');
  await card.getByLabel('第 1 条用的模板').selectOption({ label: '顺丰 100×150' });
  await expect(card.getByRole('button', { name: '按字段换模板（1 条）' })).toBeVisible();
  const raw = (await callApi(page, 'getSettings')).ruleSettings.find((setting) => setting.id === 'builtin:raw');
  expect(raw?.templateRoutes).toEqual([
    { field: '内容', match: 'contains', value: 'SF', templateId: 'builtin:waybill-sf-150' },
  ]);

  await page.getByRole('button', { name: '返回工作台' }).click();
  const template = page.getByRole('combobox', { name: '模板', exact: true });
  await scan(page, 'SF1234567890123');
  await expect(template.locator('option:checked')).toHaveText('顺丰 100×150');
  await expect(page.locator('.preview-toolbar').getByText('规则指定')).toBeVisible();
  // 不命中时用规则原来的（这里没指定，就是当前模板）。
  await scan(page, 'hello');
  await expect(template.locator('option:checked')).toHaveText('通用（二维码在左）');
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
  await page.getByRole('combobox', { name: '模板', exact: true }).selectOption({ label: '通用（二维码在右）' });
  await expect(page.locator('.preview-toolbar__usage')).toHaveText('示例内容');
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
  await expect(second.page.getByRole('combobox', { name: '模板', exact: true }).locator('option:checked')).toHaveText(
    'E2E 模板',
  );
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
  await expect(page.getByRole('combobox', { name: '模板', exact: true }).locator('option:checked')).toHaveText(
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
  await page.getByRole('button', { name: '配置', exact: true }).focus();
  await page.keyboard.type('ABC-RED-XL');
  await expect(input).toHaveValue('ABC-RED-XL');

  // 焦点在下拉框上时也一样：字母不会被下拉框当成跳选吞掉。
  await input.fill('');
  await page.getByRole('combobox', { name: '模板', exact: true }).focus();
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
  await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：原样打印');
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
    // 先建好再派发：事件的 timeStamp 是创建的时间，见下一个用例的说明。
    const events = ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE'].map(
      (code) => new KeyboardEvent('keydown', { key: 'Process', code, bubbles: true, cancelable: true }),
    );
    for (const event of events) {
      element.dispatchEvent(event);
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
    // 先建好全部事件再逐个派发：事件的 timeStamp 是创建的时间。边建边派发的话，CI 机器忙时处理第一个键
    // （要重绘）比扫码枪的按键间隔还久，下一个键就像隔了很久才按，第一个字被当成另一串（2026-10-01 macOS CI 出现过）。
    // 真扫码枪的事件带的是系统收到按键的时间，不受处理快慢影响。
    const events = keys.map(
      ([code, shiftKey]) =>
        new KeyboardEvent('keydown', { key: 'Process', code, shiftKey, bubbles: true, cancelable: true }),
    );
    for (const event of events) {
      element.dispatchEvent(event);
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
  // 「配置中不打印」只在这里扫了码之后才出现。
  await expect(page.getByText('配置中不打印')).toHaveCount(0);
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
  // 标签框按纸张缩放后才有最终尺寸：等它排好再量，不在刚渲染出来的那一刻读。
  await expect
    .poll(async () => {
      const frame = await page.locator('.label-frame').boundingBox();
      return frame === null ? Number.POSITIVE_INFINITY : Math.abs(frame.width / frame.height - 1);
    })
    .toBeLessThan(0.02);
});

// 面单模板：用示例面单数据预览（不是扫码内容）；复制后改一格的文字，预览跟着变，保存后用于打印。
test('previews a built-in waybill with sample data and edits a copy cell by cell', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '平台标准二联' }).click();
  await expect(page.locator('.sample-input--note')).toContainText('示例面单数据');
  const templatesPage = page.getByRole('main', { name: '模板' });
  const label = templatesPage.frameLocator('.label-frame').locator('body');
  await expect(label).toContainText('781234567890123');
  await expect(label).toContainText('杭州转运中心');
  await expect(templatesPage.locator('.ruler--vertical')).toHaveAttribute('viewBox', /^0 0 \S+ 180$/);

  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('编辑：');
  const outline = page.getByRole('list', { name: '格子' });
  await outline.getByRole('button', { name: /文字 \{集包地\}/ }).click();
  await page.locator('.waybill-node').getByLabel('文字', { exact: true }).first().fill('集包：{集包地}');
  await expect(label).toContainText('集包：杭州转运中心');
  await page.getByRole('button', { name: '保存模板' }).click();
  await expect(page.locator('.template-item', { hasText: '平台标准二联' }).last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(label).toContainText('集包：杭州转运中心');
});

// 自由设计模板：内置示例按扫码内容排版，复制后进设计器。
test('previews the built-in canvas tag and copies it', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
  const frame = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');
  await expect(frame.locator('.line', { hasText: 'CL5640-TK' }).first()).toBeVisible();
  await expect(frame.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(2);
  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.getByRole('region', { name: '设计器' })).toBeVisible();
});

/** 「打印一张试试」：一台装 60×40 的假打印机（打印只记下来）。 */
const SAMPLE_PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
];
/** 把文字往右拖这么多屏幕像素：在「适合窗口」的倍数下是几毫米，又远大于吸附距离。 */
const DRAG_PX = 40;

// 自由设计：新建空白模板，加文字、拖动、改字号、撤销重做，再加条码看打印前检查，保存后扫码按它排版。
test('designs a canvas template from scratch and uses it for scans', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '新建自由设计模板' }).click();
  const designer = page.getByRole('region', { name: '设计器' });
  await expect(designer).toBeVisible();
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');

  // 加一个文字：放在纸中间、选中；改内容，画布上就是打印的样子。
  await designer.getByRole('button', { name: '添加文字' }).click();
  await designer.getByLabel('内容', { exact: true }).fill('品名 {编码}');
  await expect(label.locator('.line', { hasText: '品名 CL5640-TK' })).toBeVisible();

  // 拖到右边：位置跟着变（位置在检查器的「排列」页）。
  const inspector = designer.getByRole('complementary', { name: '检查器' });
  await inspector.getByRole('tab', { name: '排列' }).click();
  const x = designer.getByLabel('X', { exact: true });
  const before = Number(await x.inputValue());
  const box = await page.locator('.canvas-overlay__box[data-element-id="e1"]').boundingBox();
  if (box === null) {
    throw new Error('the text box is not on the canvas');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + DRAG_PX, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(before);

  // 改字号，再在画布上用键盘撤销、重做。
  await inspector.getByRole('tab', { name: '文字' }).click();
  const fontSize = designer.getByLabel('字号', { exact: true });
  await fontSize.fill('5');
  await page.locator('.canvas-overlay').focus();
  await page.keyboard.press('Control+Z');
  await expect(fontSize).toHaveValue('3.5');
  await page.keyboard.press('Control+Y');
  await expect(fontSize).toHaveValue('5');

  // 加一个条码：默认绑 {编码}，直接印得出；改成 {完整内容}（有中文）Code 128 印不了，底部写明原因；改回来又印出来。
  await designer.getByRole('button', { name: '添加条码' }).click();
  await expect(designer.getByLabel('码制')).toHaveValue('code128');
  const content = designer.getByLabel('内容', { exact: true });
  await expect(content).toHaveValue('{编码}');
  const checks = designer.getByRole('region', { name: '打印前检查' });
  await expect(label.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(1);
  await content.fill('{完整内容}');
  await expect(checks).toContainText('条码「条码」');
  await content.fill('{编码}');
  await expect(label.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(1);
  await expect(checks).toContainText('没有发现问题');

  // Esc 取消选中（不离开编辑），右栏换成模板设置，改名后保存。
  await page.locator('.canvas-overlay').focus();
  await page.keyboard.press('Escape');
  await designer.getByLabel('模板名称').fill('E2E 吊牌');
  await page.getByRole('button', { name: '保存模板' }).click();
  await expect(page.locator('.template-item', { hasText: 'E2E 吊牌' })).toHaveAttribute('aria-pressed', 'true');

  // 设为当前模板，回到工作台扫码：标签按设计出来的样子排。
  const saved = (await callApi(page, 'listTemplates')).find((template) => template.name === 'E2E 吊牌');
  if (saved === undefined) {
    throw new Error('the designed template was not saved');
  }
  expect(saved.kind === 'canvas' && saved.elements.map((element) => element.kind)).toEqual(['text', 'barcode']);
  await callApi(page, 'updateSettings', { activeTemplateId: saved.id, autoPrint: false });
  await page.reload();
  await scan(page, 'CL5640-TK-图片色-XL');
  await expect(page.frameLocator('.label-frame').locator('.line', { hasText: '品名 CL5640-TK' })).toBeVisible();
});

// 焦点在画布上时扫码：字符不当成快捷键，照样填进「预览内容」，画布按新内容排版。
test('keeps the scanner working while the canvas has focus', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '新建自由设计模板' }).click();
  const designer = page.getByRole('region', { name: '设计器' });
  await designer.getByRole('button', { name: '添加文字' }).click();
  await designer.getByLabel('内容', { exact: true }).fill('{编码}');
  await page.locator('.canvas-overlay').focus();
  await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
  await expect(page.getByLabel('预览内容')).toHaveValue('CL5640-TK-图片色-XL');
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');
  await expect(label.locator('.line', { hasText: 'CL5640-TK' })).toBeVisible();
  await designer.getByRole('tab', { name: '图层' }).click();
  await expect(designer.getByRole('list', { name: '图层' }).getByRole('listitem')).toHaveCount(1);
});

// 「打印一张试试」：按预览内容把没保存的草稿打到装着这种纸的打印机上；不写打印记录。
test('prints one sample of a canvas draft without recording a job', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: SAMPLE_PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' }, autoPrint: false });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await scan(page, 'CL5640-TK-图片色-XL');
  const jobsBefore = (await callApi(page, 'listJobs', { limit: 100 })).jobs.length;
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
  await page.getByRole('button', { name: '复制' }).click();
  await page.getByRole('button', { name: '打印一张试试' }).click();
  await expect
    .poll(() => fakePrints(app))
    .toEqual([{ printerName: '标签机A', raw: 'CL5640-TK-图片色-XL', paper: '60x40', templateId: 'custom:draft' }]);
  // 打印只记下来；草稿没保存过，不占打印记录、也不占防重复窗口。
  expect((await callApi(page, 'listJobs', { limit: 100 })).jobs.length).toBe(jobsBefore);
});

// 设计器剩下的操作：拖到画布上新建、方向键微调、缩放控制点、复制粘贴、对齐、叠放、双击改文字、
// 表格加减行、选图片、Esc 取消一次还按着的拖动。
test('covers the rest of the designer toolbox: drag-add, resize, copy, align, stack, table and image', async ({
  electronApp,
}) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '新建自由设计模板' }).click();
  const designer = page.getByRole('region', { name: '设计器' });
  const overlay = page.locator('.canvas-overlay');

  // 点一下加文字（e1）。
  await designer.getByRole('button', { name: '添加文字' }).click();

  // 拖到画布上加条码（e2）：源是元素栏的按钮，画布接收 drop；用 DataTransfer 手动模拟（HTML5 拖拽，
  // Playwright 的鼠标事件驱动不了原生拖拽），不关心落点，只关心加上了。
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await designer.getByRole('button', { name: '添加条码' }).dispatchEvent('dragstart', { dataTransfer });
  await overlay.dispatchEvent('dragover', { dataTransfer });
  await overlay.dispatchEvent('drop', { dataTransfer });
  const inspector = designer.getByRole('complementary', { name: '检查器' });
  const showTab = (name: string) => inspector.getByRole('tab', { name }).click();
  await showTab('图层');
  const layerList = designer.getByRole('list', { name: '图层' });
  await expect(layerList.getByRole('listitem')).toHaveCount(2);

  // 选中文字（e1），方向键微调：右移一步是 0.1mm（位置在「排列」页）。
  await layerList.getByRole('button', { name: '文字（文字）' }).click();
  await showTab('排列');
  const x = designer.getByLabel('X', { exact: true });
  const beforeArrow = Number(await x.inputValue());
  await overlay.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(beforeArrow + 0.1, 5);

  // 拖控制点缩放：选中的元素有 8 个控制点，拖右下角（se）变大。
  const width = designer.getByLabel('宽', { exact: true });
  const beforeWidth = Number(await width.inputValue());
  const handle = page.locator('.canvas-overlay__box[data-element-id="e1"] [data-handle="se"]');
  const handleBox = await handle.boundingBox();
  if (handleBox === null) {
    throw new Error('the resize handle is not on the canvas');
  }
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + DRAG_PX, handleBox.y + handleBox.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBeGreaterThan(beforeWidth);

  // Esc 取消一次还按着的拖动：按下不松手就按 Esc，位置恢复，不提交这一步。
  const beforeCancel = Number(await x.inputValue());
  const boxBeforeCancel = await page.locator('.canvas-overlay__box[data-element-id="e1"]').boundingBox();
  if (boxBeforeCancel === null) {
    throw new Error('the text box is not on the canvas');
  }
  await page.mouse.move(boxBeforeCancel.x + boxBeforeCancel.width / 2, boxBeforeCancel.y + boxBeforeCancel.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxBeforeCancel.x + DRAG_PX * 2, boxBeforeCancel.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => Number(await x.inputValue())).toBe(beforeCancel);

  // 双击文字：就地改字的输入框盖在文字上、拿到焦点；Esc 放弃。
  const boxToEdit = await page.locator('.canvas-overlay__box[data-element-id="e1"]').boundingBox();
  if (boxToEdit === null) {
    throw new Error('the text box is not on the canvas');
  }
  await page.mouse.dblclick(boxToEdit.x + boxToEdit.width / 2, boxToEdit.y + boxToEdit.height / 2);
  await expect(page.getByRole('textbox', { name: /就地改文字/ })).toBeFocused();
  await page.keyboard.press('Escape');

  // 复制粘贴：图层多一个，新元素选中、名字自动编号。
  await overlay.focus();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await showTab('图层');
  await expect(layerList.getByRole('listitem')).toHaveCount(3);
  await showTab('文字');
  await expect(designer.getByLabel('名称', { exact: true })).toHaveValue('文字 2');

  // 对齐：单选时对齐到安全区（左对齐落在安全边距 1.5mm）。
  await showTab('排列');
  await inspector.getByRole('button', { name: '左对齐到安全区' }).click();
  await expect.poll(async () => Number(await x.inputValue())).toBe(1.5);

  // 叠放：置底之后，这个元素在图层列表（上层在前）里排到最后一个。
  await inspector.getByRole('button', { name: '置底' }).click();
  await showTab('图层');
  await expect(layerList.getByRole('listitem').last().locator('.layer-row__select')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // 加一个表格（e4），加一行、再删掉（新加的元素选中；刚才在看「图层」，检查器留在那一页，切到「表格」）。
  await designer.getByRole('button', { name: '添加表格' }).click();
  await showTab('表格');
  const rowCountBefore = await designer.getByLabel(/第 \d+ 行高$/).count();
  await designer.getByRole('button', { name: '加一行' }).click();
  await expect(designer.getByLabel(/第 \d+ 行高$/)).toHaveCount(rowCountBefore + 1);
  await designer.getByRole('button', { name: '删最后一行' }).click();
  await expect(designer.getByLabel(/第 \d+ 行高$/)).toHaveCount(rowCountBefore);

  // 加一张图片（e5），选一张很小的 PNG：读完之后属性栏写出像素尺寸。
  await designer.getByRole('button', { name: '添加图片' }).click();
  const fixture = join(tmpdir(), `canvas-designer-e2e-${process.pid}.png`);
  await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toFile(fixture);
  await designer.locator('input[type="file"]').setInputFiles(fixture);
  await expect(designer.getByText('4×3 像素')).toBeVisible();
});

// 面单每一行的位置和换行是按字宽表算好的：用这台电脑的系统字体真实渲染一遍，没有哪一行被格子边缘裁掉。
// CI 在 Windows（微软雅黑）和 macOS（苹方）上都跑这一条。
test('lays out every built-in waybill so that no line is clipped with the system fonts', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const waybills = (await callApi(page, 'listTemplates')).filter((template) => template.kind === 'waybill');
  expect(waybills).toHaveLength(BUILT_IN_WAYBILLS.length);
  for (const template of waybills) {
    const { html, warnings } = await callApi(page, 'previewTemplate', '示例', template);
    if (html === null) throw new Error(`no preview for ${template.name}`);
    // 排版自己报的问题（格子装不下、条码或二维码放不下）也不能有：下面只量横向有没有被裁。
    expect({ template: template.name, warnings }).toEqual({
      template: template.name,
      warnings: { qrOmitted: false, barcodeOmitted: false, overflowCells: 0, issues: [], elements: [] },
    });
    const clipped = await clippedLines(app, html);
    expect({ template: template.name, clipped }).toEqual({ template: template.name, clipped: [] });
  }
});

// 字宽表（text-fit.ts）是按 Windows 的微软雅黑量的：在每个平台上用标签、面单同一套字体逐个字符量一遍，
// 表里的估算不能比实际窄（窄了字会被格子边缘裁掉）。失败时列出估窄的字和实测宽度，照着补表。
test('never estimates a character narrower than the system font draws it', async ({ electronApp }) => {
  const { app } = await electronApp.launch();
  const chars = [
    ...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)),
    ...'×…—–·°¥中，。：（）',
  ];
  const measured = await app.evaluate(async ({ BrowserWindow }, list) => {
    const window = new BrowserWindow({ show: false });
    try {
      await window.loadURL('data:text/html;charset=utf-8,<body></body>');
      return (await window.webContents.executeJavaScript(`(() => {
        const span = document.createElement('span');
        span.style.cssText = 'font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif; font-size: 100px; white-space: pre';
        document.body.append(span);
        const result = {};
        for (const char of ${JSON.stringify(list)}) {
          const widths = [400, 700].map((weight) => {
            span.style.fontWeight = String(weight);
            span.textContent = char.repeat(20);
            return span.getBoundingClientRect().width / 2000;
          });
          result[char] = Math.max(...widths);
        }
        return result;
      })()`)) as Record<string, number>;
    } finally {
      window.destroy();
    }
  }, chars);
  const narrow = Object.entries(measured)
    .filter(([char, width]) => estimateTextWidthEm(char) < width)
    .map(
      ([char, width]) =>
        `${JSON.stringify(char)} 实测 ${width.toFixed(3)} 估算 ${estimateTextWidthEm(char).toFixed(3)}`,
    );
  expect(narrow).toEqual([]);
});
