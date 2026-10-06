import type { Locator, Page } from '@playwright/test';
import type { FakeDiagnosisSpec, FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakeAdminPrompts, openConfig } from './support/app-helpers';
import { expect, test } from './support/fixtures';

const PRINTER = '标签机A';

function labelPrinter(diagnosis: FakeDiagnosisSpec, overrides: Partial<FakePrinterSpec> = {}): FakePrinterSpec {
  return {
    name: PRINTER,
    paper: { widthMm: 60, heightMm: 40, dpi: 203 },
    readiness: { ready: true },
    diagnosis,
    ...overrides,
  };
}

/** 把 60×40 分给标签机A，打开配置中心「打印机」，点它的「诊断」，等六项查完。 */
async function openDiagnosis(page: Page): Promise<Locator> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': PRINTER } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await openConfig(page, '打印机');
  await page.locator('.printer-row', { hasText: PRINTER }).getByRole('button', { name: '诊断', exact: true }).click();
  const panel = page.getByRole('region', { name: `诊断：${PRINTER}` });
  await expect(panel.locator('.diagnosis__summary')).toContainText('查完了');
  return panel;
}

function item(panel: Locator, title: string): Locator {
  return panel.locator('.diagnosis-item', { hasText: title });
}

test('finds stuck jobs, clears ours first and the rest after the admin prompt', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({
    fakePrinters: [labelPrinter({ stuckJobs: { ours: 2, others: 1 } })],
  });
  const queue = item(await openDiagnosis(page), '打印队列');
  await expect(queue).toContainText(/有 3 个任务卡在队列里（最早的已经等了 \d+ 分钟），其中 2 个是本程序发的/);

  await queue.getByRole('button', { name: '清除本程序的任务' }).click();
  await expect(queue).toContainText('已请求取消本程序的 2 个任务');
  await expect(queue).toContainText('认不出是本程序发的');
  expect(await fakeAdminPrompts(app)).toEqual([]);

  await queue.getByRole('button', { name: '清除全部任务（需要管理员权限）' }).click();
  await expect(queue).toContainText('队列是空的');
  expect(await fakeAdminPrompts(app)).toHaveLength(1);
});

test('changes nothing when the admin prompt is declined', async ({ electronApp }) => {
  const { page } = await electronApp.launch({
    fakePrinters: [labelPrinter({ stuckJobs: { ours: 0, others: 1 }, adminPrompt: 'decline' })],
  });
  const queue = item(await openDiagnosis(page), '打印队列');
  await queue.getByRole('button', { name: '清除全部任务（需要管理员权限）' }).click();
  await expect(queue.getByRole('alert')).toContainText('没有拿到管理员权限');
  await expect(queue).toContainText('有 1 个任务卡在队列里');
});

test('sets the driver paper to the paper the printer holds', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({
    fakePrinters: [labelPrinter({}, { paper: { widthMm: 100, heightMm: 150, dpi: 203 } })],
  });
  const paper = item(await openDiagnosis(page), '驱动纸张');
  await expect(paper).toContainText('驱动纸张是 100×150mm，它负责的是 60×40mm');
  await paper.getByRole('button', { name: /^自动设置驱动纸张/ }).click();
  await expect(paper).toContainText('驱动纸张 60×40mm，和它负责的 60×40mm 一致');
  // Windows 改驱动默认设置一定要管理员；macOS 先以当前用户改（假打印机直接改成）。
  expect(await fakeAdminPrompts(app)).toHaveLength(process.platform === 'win32' ? 1 : 0);
});

test('asks the operator whether a label came out after a feed', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [labelPrinter({})] });
  const commands = item(await openDiagnosis(page), '指令集');
  await expect(commands).toContainText('待确认');
  await commands.getByRole('button', { name: '走一张纸' }).click();
  const question = commands.getByRole('group', { name: '标签机走出空白标签了吗？' });
  await question.getByRole('button', { name: '没反应' }).click();
  await expect(commands).toContainText('标签机没有反应');
  await expect(commands).toContainText('有问题');
});

test('checks the print service when the system lists no printers', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [] });
  await openConfig(page, '打印机');
  await page.getByRole('button', { name: '检查后台打印服务' }).click();
  const panel = page.getByRole('region', { name: '诊断：后台打印服务' });
  await expect(panel.locator('.diagnosis-item')).toHaveCount(1);
  await expect(panel.locator('.diagnosis-item')).toContainText('通过');
});
