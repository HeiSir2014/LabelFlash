import type { Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, openConfig, scan, seedLegacySelectedPrinter } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/** 两种纸：一台装 60×40 标签，两台装 100×180 面单（打印只记下来，不碰真打印机）。 */
const PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机C', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
];
/** 横杠三段：默认绑定「样衣标准」（60×40）。 */
const LABEL_CODE = 'CL5640-TK-图片色-XL';
/** 只有「整段内容」规则能识别：下面把这条规则绑到 100×180 的模板上。 */
const WAYBILL_CODE = 'hello';
const RAW_RULE_ID = 'builtin:raw';

/** 复制一个模板改成 100×180，并让「整段内容」规则用它；返回模板 id。 */
async function useWaybillTemplate(page: Page, printer: string | null = null): Promise<string> {
  const copy = await callApi(page, 'duplicateTemplate', 'builtin:generic');
  await callApi(page, 'saveTemplate', { ...copy, name: '面单', paper: { widthMm: 100, heightMm: 180 }, printer });
  const { ruleSettings } = await callApi(page, 'getSettings');
  await callApi(page, 'updateSettings', {
    ruleSettings: ruleSettings.map((setting) =>
      setting.id === RAW_RULE_ID ? { ...setting, templateId: copy.id } : setting,
    ),
  });
  return copy.id;
}

async function assign(page: Page, paperPrinters: Record<string, string>): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters, autoPrint: true });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

test('lists the fake printers and their driver paper instead of the system printers', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  expect((await callApi(page, 'listPrinters')).map((printer) => printer.name)).toEqual([
    '标签机A',
    '面单机B',
    '面单机C',
  ]);
  expect(await callApi(page, 'checkDriverPaper', '面单机B', '60x40')).toEqual({
    status: 'mismatch',
    paper: { widthMm: 100, heightMm: 180, dpi: 203 },
  });
});

test('prints each paper on the printer assigned to it and records printer and paper', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const waybillId = await useWaybillTemplate(page);
  await assign(page, { '60x40': '标签机A', '100x180': '面单机B' });

  await scan(page, LABEL_CODE);
  await expect(page.locator('.status-strip__title')).toHaveText('已发送打印');
  await scan(page, WAYBILL_CODE);
  await expect.poll(async () => (await fakePrints(app)).length).toBe(2);
  expect(await fakePrints(app)).toEqual([
    { printerName: '标签机A', raw: LABEL_CODE, paper: '60x40', templateId: 'builtin:standard' },
    { printerName: '面单机B', raw: WAYBILL_CODE, paper: '100x180', templateId: waybillId },
  ]);
  const { jobs } = await callApi(page, 'listJobs', { limit: 10 });
  expect(jobs.map((job) => [job.printerName, job.paper])).toEqual([
    ['面单机B', '100x180'],
    ['标签机A', '60x40'],
  ]);
  await expect(page.locator('.job-row__meta')).toContainText(['面单机B · 100×180 二联面单', '标签机A · 60×40 标签']);
});

test('summarises the assigned printers in the title bar and opens the printers page', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await assign(page, { '60x40': '标签机A', '100x180': '面单机B' });
  const chip = page.locator('.printer-chip');
  await expect(chip).toHaveText('打印机 2 台就绪');
  await chip.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('打印机');
});

test('prefers the printer the template names over the paper assignment', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await useWaybillTemplate(page, '面单机C');
  await assign(page, { '100x180': '面单机B' });

  await scan(page, WAYBILL_CODE);
  await expect.poll(async () => (await fakePrints(app)).map((print) => print.printerName)).toEqual(['面单机C']);
});

test('does not print or record when no printer holds the paper, and prints once one is assigned', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await useWaybillTemplate(page);
  await assign(page, { '60x40': '标签机A' });

  await scan(page, WAYBILL_CODE);
  await expect(page.locator('.status-strip__title')).toHaveText('没有可用的打印机');
  await expect(page.locator('.status-strip__detail')).toHaveText('100×180 二联面单 还没有打印机');
  expect(await fakePrints(app)).toEqual([]);
  expect((await callApi(page, 'listJobs', { limit: 10 })).jobs).toEqual([]);

  // 状态条的「去指定打印机」打开配置中心的「打印机」页。
  await page.getByRole('button', { name: '去指定打印机' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('打印机');

  // 指定好打印机、回到工作台后按 F2 直接重打这一张，不用再扫（配置中心里永远不打印）。
  await page.getByLabel('100×180 二联面单 用哪台打印机').selectOption('面单机B');
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.keyboard.press('F2');
  await expect.poll(async () => (await fakePrints(app)).map((print) => print.printerName)).toEqual(['面单机B']);
});

// 1.0.x 只有一台「选中的打印机」：升级后自动变成「60×40 → 这台」，不用重新设置。
test('moves the printer selected in 1.0.x to the 60x40 paper', async ({ electronApp }) => {
  const first = await electronApp.launch({ fakePrinters: PRINTERS });
  await seedLegacySelectedPrinter(first.app, '标签机A');
  await first.app.close();

  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  expect((await callApi(page, 'getSettings')).paperPrinters).toEqual({ '60x40': '标签机A' });
});

test('assigns a paper from the printers panel, following the suggestion from the driver paper', async ({
  electronApp,
}) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await useWaybillTemplate(page);
  await assign(page, { '60x40': '标签机A' });
  await openConfig(page, '打印机');

  const panel = page.getByRole('region', { name: '纸张和打印机' });
  const waybillRow = panel.locator('.paper-row', { hasText: '100×180 二联面单' });
  await expect(panel.locator('.paper-row')).toHaveCount(2);
  await expect(waybillRow).toHaveClass(/paper-row--missing/);
  // 面单机B、面单机C 的驱动纸张都是 100×180：建议列表里第一台还没分配的。
  await waybillRow.getByRole('button', { name: '建议：面单机B' }).click();
  await expect(page.getByLabel('100×180 二联面单 用哪台打印机')).toHaveValue('面单机B');
  await expect(waybillRow).not.toHaveClass(/paper-row--missing/);
  expect((await callApi(page, 'getSettings')).paperPrinters).toEqual({ '60x40': '标签机A', '100x180': '面单机B' });

  const printerRow = page.locator('.printer-row', { hasText: '面单机B' });
  await expect(printerRow).toContainText('负责：100×180 二联面单');
  await expect(printerRow).toContainText('驱动纸张 100×180mm');
});

test('keeps showing an assigned printer that is not on this computer', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await assign(page, { '60x40': '旧打印机' });
  await openConfig(page, '打印机');
  const select = page.getByLabel('60×40 标签 用哪台打印机');
  await expect(select).toHaveValue('旧打印机');
  await expect(select.locator('option:checked')).toHaveText('旧打印机（这台电脑上没有）');
});

// 驱动纸张和它负责的纸对不上：在那一台下面提醒；没负责纸张的打印机不提醒。
test('warns only on a printer whose driver paper differs from the paper it holds', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await assign(page, { '60x40': '面单机C' });
  await openConfig(page, '打印机');
  await expect(page.locator('.printer-row', { hasText: '面单机C' }).locator('.paper-warning')).toContainText(
    '驱动默认纸张是 100×180mm，不是 60×40mm',
  );
  await expect(page.locator('.printer-row', { hasText: '面单机B' }).locator('.paper-warning')).toHaveCount(0);
});

test('chooses the paper and printer of a template in the editor', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await assign(page, { '60x40': '标签机A' });
  await openConfig(page, '模板');
  await page.locator('.template-item').first().click();
  await page.getByRole('button', { name: '复制' }).click();
  const form = page.locator('.template-form');

  // 纸张换成预设：预览的软尺跟着变。
  await form.getByLabel('纸张尺寸').selectOption({ label: '100×100 标签（标签、箱唛）' });
  await expect(page.locator('.template-editing .ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 100 /);
  await expect(form.getByLabel('打印机')).toHaveValue('');
  await expect(form.getByLabel('打印机').locator('option:checked')).toHaveText('按纸张分配（当前是 还没有）');

  // 自定义尺寸：出现宽、高两个输入框。
  await form.getByLabel('纸张尺寸').selectOption({ label: '自定义…' });
  await form.getByLabel('纸张宽').fill('88');
  await form.getByLabel('纸张高').fill('55');
  await expect(page.locator('.template-editing .ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 88 /);
  await form.getByLabel('打印机').selectOption('面单机C');
  await form.getByLabel('模板名称').fill('E2E 88×55');
  await page.getByRole('button', { name: '保存模板' }).click();

  const item = page.locator('.template-item', { hasText: 'E2E 88×55' });
  await expect(item.locator('.template-item__use')).toHaveText('88×55 · 面单机C');
  const saved = (await callApi(page, 'listTemplates')).find((template) => template.name === 'E2E 88×55');
  expect(saved).toMatchObject({ paper: { widthMm: 88, heightMm: 55 }, printer: '面单机C' });
});

// 在打印机页分配之后，不用重新扫：回到工作台，这一张的状态已经按新的分配更新。
test('updates the scan right after a paper is assigned on the printers page', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await callApi(page, 'updateSettings', { autoPrint: false });
  await page.reload();

  await scan(page, LABEL_CODE);
  await expect(page.locator('.status-strip__title')).toHaveText('没有可用的打印机');
  await page.getByRole('button', { name: '去指定打印机' }).click();
  await page.getByLabel('60×40 标签 用哪台打印机').selectOption('标签机A');
  await page.getByRole('button', { name: '返回工作台' }).click();
  await expect(page.locator('.status-strip__title')).toHaveText('待打印');
});
