import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { minimalXlsx } from '../src/main/batch/testing/minimal-xlsx';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, stubOpenDialog } from './support/app-helpers';
import { expect, test } from './support/fixtures';

const LABEL_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
};
/** 暂停、取消的用例里每张打 300ms：按钮要在打完之前点到。 */
const SLOW_PRINT_MS = 300;
/** 暂停、取消后等正在打的那一张打完：它已经交出去了，收不回来。 */
const IN_FLIGHT_SETTLE_MS = SLOW_PRINT_MS * 2;

/** 60×40 分给标签机A（当前模板「通用」就是 60×40）。 */
async function assignLabelPrinter(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': LABEL_PRINTER.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function openBatch(page: Page): Promise<void> {
  await page.getByRole('button', { name: '批量打印' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '批量打印' })).toBeVisible();
}

function batchStatus(page: Page) {
  return page.locator('.batch-actions').getByRole('status');
}

test('prints the rows of a csv file in order with serials and finds them by batch', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER] });
  await assignLabelPrinter(page);
  const path = join(userData, 'rows.csv');
  await writeFile(path, '编码,颜色,尺码\nCL1,红,S\nCL2,蓝,M\nCL3,黑,L\n', 'utf8');
  await stubOpenDialog(app, path);
  await openBatch(page);
  await page.getByRole('button', { name: '选择文件…' }).click();
  await expect(page.getByText('rows.csv · 3 行 · 3 列')).toBeVisible();
  // 「通用」显示全部字段：每一列都印，再打开序号、补到 3 位。
  // 原生复选框被画出来的滑轨盖着：像用户一样点开关本身（和 local-api.e2e.ts 的「局域网访问」一样）。
  await page
    .locator('label.switch')
    .filter({ has: page.getByRole('switch', { name: '印序号' }) })
    .click();
  await page.getByLabel('位数').fill('3');
  await page.getByRole('button', { name: '打印 3 张' }).click();
  await expect(batchStatus(page)).toContainText('全部已发送 · 已发送 3 / 3 张');
  expect((await fakePrints(app)).map((print) => print.raw)).toEqual([
    '编码：CL1\n颜色：红\n尺码：S\n序号：001',
    '编码：CL2\n颜色：蓝\n尺码：M\n序号：002',
    '编码：CL3\n颜色：黑\n尺码：L\n序号：003',
  ]);

  await page.getByRole('button', { name: '返回工作台' }).click();
  const records = page.locator('.job-row');
  await expect(records).toHaveCount(3);
  await expect(records.first()).toContainText('批量（第 3 行）');
  await records.first().getByRole('button', { name: '这一批' }).click();
  await expect(page.getByText(/^批次 \d{8}-\d{6}-[0-9a-f]{4}$/)).toBeVisible();
  await expect(records).toHaveCount(3);
});

test('reads an xlsx file in the reader process and takes copies from a column', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER] });
  const path = join(userData, 'rows.xlsx');
  await writeFile(
    path,
    minimalXlsx([
      ['编码', '数量'],
      ['CL1', '2'],
      ['CL2', '3'],
    ]),
  );
  await stubOpenDialog(app, path);
  await openBatch(page);
  await page.getByRole('button', { name: '选择文件…' }).click();
  await expect(page.getByText('rows.xlsx · 2 行 · 2 列')).toBeVisible();
  await page.getByRole('group', { name: '份数' }).getByRole('button', { name: '取一列' }).click();
  await page.getByLabel('份数列').selectOption('数量');
  await expect(page.getByRole('button', { name: '打印 5 张' })).toBeEnabled();
});

test('refuses an .xls file with a hint to save it as .xlsx or csv', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch();
  const path = join(userData, 'old.xls');
  await writeFile(path, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  await stubOpenDialog(app, path);
  await openBatch(page);
  await page.getByRole('button', { name: '选择文件…' }).click();
  await expect(page.getByRole('alert')).toContainText('另存为');
});

test('uses a table pasted from Excel', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openBatch(page);
  await page.getByRole('button', { name: '粘贴表格' }).click();
  await page.getByLabel('粘贴从 Excel 复制的表格（第一行是列名）').fill('编码\t颜色\nCL9\t灰\n');
  await page.getByRole('button', { name: '用这些数据' }).click();
  await expect(page.getByText('粘贴的数据 · 1 行 · 2 列')).toBeVisible();
});

test('opens the batch page with a file dropped on the window', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['编码\nCL1\nCL2\n'], 'drop.csv', { type: 'text/csv' }));
    for (const type of ['dragover', 'drop']) {
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  });
  await expect(page.getByRole('heading', { level: 1, name: '批量打印' })).toBeVisible();
  await expect(page.getByText('drop.csv · 2 行 · 1 列')).toBeVisible();
});

test('pauses, resumes and cancels a running batch between labels', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [{ ...LABEL_PRINTER, printDelayMs: SLOW_PRINT_MS }] });
  await assignLabelPrinter(page);
  await openBatch(page);
  await page.getByRole('button', { name: '只按序号打' }).click();
  await page.getByLabel('张数').fill('20');
  await page.getByRole('button', { name: '打印 20 张' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(batchStatus(page)).toContainText('已暂停');
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  const pausedAt = (await fakePrints(app)).length;
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  expect((await fakePrints(app)).length).toBe(pausedAt);

  await page.getByRole('button', { name: '继续' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(pausedAt);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(batchStatus(page)).toContainText('已取消');
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  const canceledAt = (await fakePrints(app)).length;
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  expect((await fakePrints(app)).length).toBe(canceledAt);
  expect(canceledAt).toBeLessThan(20);
});
