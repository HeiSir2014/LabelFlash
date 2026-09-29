import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/** 两种纸：一台装 60×40 标签，两台装 100×180 面单（打印只记下来，不碰真打印机）。 */
const PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机C', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
];

test('lists the fake printers and their driver paper instead of the system printers', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  expect((await callApi(page, 'listPrinters')).map((printer) => printer.name)).toEqual([
    '标签机A',
    '面单机B',
    '面单机C',
  ]);
  expect(await callApi(page, 'checkDriverPaper', '面单机B')).toEqual({
    status: 'mismatch',
    paper: { widthMm: 100, heightMm: 180, dpi: 203 },
  });
});
