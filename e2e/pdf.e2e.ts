import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, stubOpenDialog } from './support/app-helpers';
import { expect, test } from './support/fixtures';
import { gridPdfBytes, writeGridPdf } from './support/pdf-files';

const WAYBILL_PRINTER: FakePrinterSpec = {
  name: '面单机',
  paper: { widthMm: 100, heightMm: 150, dpi: 203 },
  readiness: { ready: true },
};
/** 比 50MB 的上限多 1MB：超过上限的文件不读，直接说明。 */
const OVERSIZE_BYTES = 51 * 1024 * 1024;

async function assignWaybillPrinter(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '100x150': WAYBILL_PRINTER.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function openPdfPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打印 PDF' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '打印 PDF' })).toBeVisible();
}

/** 打开 2×2 面单的 PDF，等 8 张都出来。 */
async function openGrid(app: ElectronApplication, page: Page, userData: string): Promise<void> {
  const path = join(userData, 'grid.pdf');
  await writeGridPdf(app, path);
  await stubOpenDialog(app, path);
  await openPdfPage(page);
  await page.getByRole('button', { name: '选择 PDF…' }).click();
  await expect(page.getByText('grid.pdf · 2 页')).toBeVisible();
  await expect(pieces(page)).toHaveCount(8);
}

function pieces(page: Page) {
  return page.getByRole('list', { name: '要打的标签' }).getByRole('listitem');
}

function pdfStatus(page: Page) {
  return page.locator('.pdf-actions').getByRole('status');
}

const ALL_PIECES = [1, 2].flatMap((pageNumber) =>
  [1, 2, 3, 4].map((piece) => `grid.pdf 第 ${pageNumber} 页第 ${piece} 张`),
);

test('splits a 2x2 waybill PDF into eight labels, prints them in order and reprints one from the records', async ({
  electronApp,
}) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await assignWaybillPrinter(page);
  await openGrid(app, page, userData);
  await expect(page.getByLabel('一页多张（自动识别）')).toBeChecked();
  await expect(page.getByLabel('纸张', { exact: true })).toHaveValue('100x150');
  await page.getByRole('button', { name: '打印 8 张' }).click();
  await expect(pdfStatus(page)).toContainText('全部已发送 · 已发送 8 / 8 张');
  const prints = await fakePrints(app);
  expect(prints.map((print) => print.raw)).toEqual(ALL_PIECES);
  expect(new Set(prints.map((print) => `${print.printerName} ${print.paper} ${print.templateId}`))).toEqual(
    new Set(['面单机 100x150 builtin:pdf-piece']),
  );

  await page.getByRole('button', { name: '返回工作台' }).click();
  const records = page.locator('.job-row');
  await expect(records).toHaveCount(8);
  await expect(records.first()).toContainText('PDF（第 2 页第 4 张）');
  await records.first().getByRole('button', { name: '重打' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBe(9);
  expect((await fakePrints(app)).at(-1)?.raw).toBe('grid.pdf 第 2 页第 4 张');
});

test('prints the chosen pieces in the chosen order with copies', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await assignWaybillPrinter(page);
  await openGrid(app, page, userData);
  await page.getByRole('button', { name: '删掉第 1 页第 2 张' }).click();
  await page.getByRole('button', { name: '第 1 页第 3 张往前移' }).click();
  await page.getByLabel('每张份数').fill('2');
  await expect(page.getByText('共 8 张 · 删掉 1 张 · 每张 2 份 · 打 14 张')).toBeVisible();
  await page.getByRole('button', { name: '打印 14 张' }).click();
  await expect(pdfStatus(page)).toContainText('全部已发送 · 已发送 14 / 14 张');
  expect((await fakePrints(app)).slice(0, 4).map((print) => print.raw)).toEqual([
    'grid.pdf 第 1 页第 3 张',
    'grid.pdf 第 1 页第 3 张',
    'grid.pdf 第 1 页第 1 张',
    'grid.pdf 第 1 页第 1 张',
  ]);
});

test('applies a box drawn on the first page to every page', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await assignWaybillPrinter(page);
  await openGrid(app, page, userData);
  await page.getByLabel('手动框选').check();
  const firstPage = await page.getByRole('img', { name: '第一页' }).boundingBox();
  if (firstPage === null) {
    throw new Error('the first page is not shown');
  }
  // 框住左上那一张（A4 上大约 2%–48% 的位置）。
  await page.mouse.move(firstPage.x + firstPage.width * 0.02, firstPage.y + firstPage.height * 0.02);
  await page.mouse.down();
  await page.mouse.move(firstPage.x + firstPage.width * 0.48, firstPage.y + firstPage.height * 0.48, { steps: 5 });
  await page.mouse.up();
  await expect(pieces(page)).toHaveCount(2);
  await expect(page.getByText('共 2 张 · 每张 1 份 · 打 2 张')).toBeVisible();
});

test('opens a PDF dropped on the window', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const base64 = (await gridPdfBytes(app)).toString('base64');
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'drop.pdf', { type: 'application/pdf' }));
    for (const type of ['dragover', 'drop']) {
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  }, base64);
  await expect(page.getByRole('heading', { level: 1, name: '打印 PDF' })).toBeVisible();
  await expect(page.getByText('drop.pdf · 2 页')).toBeVisible();
});

test('refuses files that are not PDFs, too large or damaged', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch();
  await openPdfPage(page);
  const cases = [
    { name: 'note.pdf', bytes: Buffer.from('hello'), issue: /这不是 PDF 文件/ },
    // pdf.js 对坏文件可能报「不是 PDF」，也可能修复出 0 页：两种说明都算对。
    { name: 'broken.pdf', bytes: Buffer.from('%PDF-1.7\nnot really a pdf\n'), issue: /打不开这个 PDF|一页也没有/ },
    {
      name: 'huge.pdf',
      bytes: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(OVERSIZE_BYTES)]),
      issue: /文件超过 50MB/,
    },
  ];
  for (const { name, bytes, issue } of cases) {
    const path = join(userData, name);
    await writeFile(path, bytes);
    await stubOpenDialog(app, path);
    await page.getByRole('button', { name: '选择 PDF…' }).click();
    await expect(page.getByRole('alert')).toContainText(issue);
  }
});
