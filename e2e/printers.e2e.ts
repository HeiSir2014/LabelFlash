import type { Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, scan, seedLegacySelectedPrinter } from './support/app-helpers';
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

  // 指定好打印机后按 F2 直接重打这一张，不用再扫。
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
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
