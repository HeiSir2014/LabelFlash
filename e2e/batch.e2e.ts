import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { minimalXlsx } from '../src/main/batch/testing/minimal-xlsx';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, stubOpenDialog } from './support/app-helpers';
import { stubBatchQuitConfirm } from './support/electron-app';
import { expect, test } from './support/fixtures';

const LABEL_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
};
/** 暂停、取消的用例里每张打 300ms：按钮要在打完之前点到。 */
const SLOW_PRINT_MS = 300;

/**
 * 等打印数量稳定下来（连续两次读到的一样）：暂停、取消之后用，比固定等一段时间更快也更可靠——
 * 慢的时候（CI 负载高）不会因为等得不够久而读错，快的时候也不用白等。
 */
async function waitForPrintCountToSettle(app: ElectronApplication): Promise<number> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const current = (await fakePrints(app)).length;
        const isStable = current === previous;
        previous = current;
        return isStable;
      },
      // 两次读到一样的数才算稳定：间隔要比一张的打印延迟长，不然可能在正在打的那一张还没落地时
      // 就连续读到两次一样的旧值，提前把还没结束的当成已经结束（暂停、取消这一刻可能正有一张在打，
      // 状态已经是 paused/canceled 了，但它还没真的打完）。
      { intervals: [SLOW_PRINT_MS + 100] },
    )
    .toBe(true);
  return previous;
}

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
  const pausedAt = await waitForPrintCountToSettle(app);

  await page.getByRole('button', { name: '继续' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(pausedAt);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(batchStatus(page)).toContainText('已取消');
  const canceledAt = await waitForPrintCountToSettle(app);
  expect(canceledAt).toBeLessThan(20);
});

test('quitting mid-batch and confirming records exactly one CANCELED job per unattempted label', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [{ ...LABEL_PRINTER, printDelayMs: SLOW_PRINT_MS }] });
  await assignLabelPrinter(page);
  await openBatch(page);
  await page.getByRole('button', { name: '只按序号打' }).click();
  await page.getByLabel('张数').fill('5');
  await page.getByRole('button', { name: '打印 5 张' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(batchStatus(page)).toContainText('已暂停');
  // 真的暂停下来之后（不是正在打的那一刻）没有哪一张算「正在打」，剩下没打的就是全部还没轮到的。
  const sentBeforeQuit = await waitForPrintCountToSettle(app);
  const unattempted = 5 - sentBeforeQuit;

  // launchApp 默认把确认框换成「仍要退出」：退出走完整个确认 → 取消批次 → 记 CANCELED 的流程。
  await app.close();

  // 重开同一个数据目录：批量打印页不记得这一批了，但打印记录里应该能看到。
  const relaunched = await electronApp.launch({ fakePrinters: [LABEL_PRINTER] });
  const canceledRows = relaunched.page.locator('.job-row', { hasText: '退出时未打' });
  await expect(canceledRows).toHaveCount(unattempted);
  await expect(relaunched.page.locator('.job-row')).toHaveCount(5);
});

test('quitting mid-batch and cancelling keeps the app running and hides the window on close', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [{ ...LABEL_PRINTER, printDelayMs: SLOW_PRINT_MS }] });
  await assignLabelPrinter(page);
  await openBatch(page);
  await page.getByRole('button', { name: '只按序号打' }).click();
  await page.getByLabel('张数').fill('20');
  await page.getByRole('button', { name: '打印 20 张' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(batchStatus(page)).toContainText('已暂停');
  const pausedAt = await waitForPrintCountToSettle(app);

  await stubBatchQuitConfirm(app, 'cancel');
  try {
    // app.quit() 本身不等退出完成（真退出的话也不该等，会一直等不到）：用一次之后还能正常 evaluate
    // 来确认进程确实没有退出。
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await expect.poll(() => app.evaluate(({ app: electronApp }) => electronApp.getVersion())).toBeTruthy();
    // 批次被取消了吗？没有：退出被取消，批次原样留着，暂停时的张数不该变。
    expect((await fakePrints(app)).length).toBe(pausedAt);

    // 关窗口（不是退出）：还是藏进托盘，不是真的关掉。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? null))
      .toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    // 换回「仍要退出」：不管上面的断言有没有通过，用例结束时夹具都要能关掉这个程序，
    // 不然一直卡在「取消」的确认框上，teardown 会超时（这个确认框现在没有真的窗口能去点它）。
    await stubBatchQuitConfirm(app, 'confirm');
  }
});
