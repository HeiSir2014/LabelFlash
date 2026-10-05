import type { Locator, Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, clickSwitch, fakePrints, fakeRawJobs, openConfig, scan } from './support/app-helpers';
import { expect, test } from './support/fixtures';

const TSPL_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
  driverName: 'Label Printer TSPL',
};
const OFFICE_PRINTER: FakePrinterSpec = {
  name: '家用打印机',
  paper: { widthMm: 210, heightMm: 297, dpi: 600 },
  readiness: null,
  driverName: 'Office Inkjet',
};
/** 横杠三段：用当前模板「通用」（60×40）。 */
const LABEL_CODE = 'CL5640-TK-图片色-XL';

async function openCommands(page: Page, printerName: string): Promise<Locator> {
  await openConfig(page, '打印机');
  await page.locator('.printer-row', { hasText: printerName }).getByRole('button', { name: '标签机指令' }).click();
  const panel = page.getByRole('region', { name: `${printerName} 的标签机指令` });
  await expect(panel.getByLabel('指令集')).toBeVisible();
  return panel;
}

test('sends TSPL settings once on save, actions on demand, and nothing before each print', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [TSPL_PRINTER] });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': TSPL_PRINTER.name }, autoPrint: true });
  await page.reload();
  const panel = await openCommands(page, TSPL_PRINTER.name);
  await expect(panel.getByLabel('指令集').locator('option:checked')).toHaveText('自动（TSPL）');
  await expect(panel.getByText('驱动名「Label Printer TSPL」里写着 TSPL')).toBeVisible();

  await panel.getByLabel('浓度').selectOption('8');
  await panel.getByLabel('速度').selectOption('4');
  // 用 page 作范围：对 getByRole('region', …) 这样按名字过滤出来的动态定位器再叠一层 filter({ has }) 不可靠
  // （Playwright 的已知限制），同一时间只有一台打印机的面板打开，用整页范围找这个开关没有歧义。
  await clickSwitch(page, '设置纸张');
  await expect(panel.getByLabel('纸宽')).toHaveValue('60');
  await panel.getByLabel('出纸方式').selectOption('tear');
  await panel.getByRole('button', { name: '保存并发送' }).click();
  await expect(panel.getByRole('status')).toHaveText('设置已发送到打印机（TSPL）。指令是单向的：打一张看看效果');
  expect(await fakeRawJobs(app)).toEqual([
    {
      printerName: TSPL_PRINTER.name,
      text: 'SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nDENSITY 8\r\nSPEED 4\r\nSET PEEL OFF\r\nSET TEAR ON\r\n',
    },
  ]);

  await panel.getByRole('button', { name: '纸张校准' }).click();
  await expect(panel.getByRole('status')).toHaveText('纸张校准指令已发送到打印机');
  expect((await fakeRawJobs(app)).at(-1)?.text).toBe('GAPDETECT\r\n');

  // 设置只在保存时发：回到工作台打一张，不再带指令。
  await page.getByRole('button', { name: '返回工作台' }).click();
  await scan(page, LABEL_CODE);
  await expect.poll(async () => (await fakePrints(app)).length).toBe(1);
  expect(await fakeRawJobs(app)).toHaveLength(2);
});

test('asks twice before restoring factory settings', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [TSPL_PRINTER] });
  const panel = await openCommands(page, TSPL_PRINTER.name);
  const dialog = page.getByRole('alertdialog', { name: '恢复出厂设置' });

  await panel.getByRole('button', { name: '恢复出厂设置' }).click();
  await panel.getByRole('button', { name: '确认恢复出厂？' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '不恢复' }).click();
  await expect(dialog).toBeHidden();
  expect(await fakeRawJobs(app)).toEqual([]);

  await panel.getByRole('button', { name: '恢复出厂设置' }).click();
  await panel.getByRole('button', { name: '确认恢复出厂？' }).click();
  await dialog.getByRole('button', { name: '恢复出厂设置' }).click();
  await expect(panel.getByRole('status')).toHaveText('恢复出厂设置指令已发送到打印机');
  expect(await fakeRawJobs(app)).toEqual([{ printerName: TSPL_PRINTER.name, text: 'INITIALPRINTER\r\n' }]);
});

test('does not guess a command set it cannot recognise, and sends ZPL once chosen', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [OFFICE_PRINTER] });
  const panel = await openCommands(page, OFFICE_PRINTER.name);
  await expect(panel.getByText('从驱动名「Office Inkjet」认不出用哪种指令')).toBeVisible();
  await expect(panel.getByRole('button', { name: '纸张校准' })).toBeDisabled();

  await panel.getByRole('button', { name: '保存并发送' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    '已保存。认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
  );
  expect(await fakeRawJobs(app)).toEqual([]);

  await panel.getByLabel('指令集').selectOption('zpl');
  await panel.getByLabel('浓度').selectOption('15');
  await expect(panel.getByLabel('分辨率').locator('option:checked')).toHaveText('按驱动（600dpi）');
  await panel.getByRole('button', { name: '保存并发送' }).click();
  await expect(panel.getByRole('status')).toHaveText('设置已发送到打印机（ZPL）。指令是单向的：打一张看看效果');
  expect(await fakeRawJobs(app)).toEqual([{ printerName: OFFICE_PRINTER.name, text: '~SD15\n^XA\n^JUS\n^XZ\n' }]);

  // 主进程只发给系统打印机列表里有的打印机。
  await expect(callApi(page, 'runPrinterAction', '没有这台', 'feed')).rejects.toThrow('Printer not found');
});

test('explains a driver that does not take raw commands', async ({ electronApp }) => {
  const printer: FakePrinterSpec = { ...TSPL_PRINTER, rawFailure: 'raw-rejected' };
  const { page } = await electronApp.launch({ fakePrinters: [printer] });
  const panel = await openCommands(page, printer.name);
  await panel.getByRole('button', { name: '走一张纸' }).click();
  await expect(panel.getByRole('alert')).toContainText('驱动不接受直接发送的指令');
});
