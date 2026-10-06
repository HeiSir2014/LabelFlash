import type { Page } from '@playwright/test';
import { integerAttr, integerValue, nameAttr, stringValue, stringValues } from '../src/core/ipp/ipp-attributes';
import type { IppMessage } from '../src/core/ipp/ipp-codec';
import { GROUP_TAGS, JOB_STATE, OPERATIONS, STATUS } from '../src/core/ipp/ipp-constants';
import { attributeIn, ippRequest } from '../src/core/ipp/testing/ipp-requests';
import { basicAuth, sendIpp } from '../src/main/ipp/testing/ipp-client';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, clickSwitch, fakePrints, openConfig } from './support/app-helpers';
import { expect, test } from './support/fixtures';
import { labelPdfBytes } from './support/pdf-files';

/** 一台 60×40 的假标签机（打印只记下来）。 */
const PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
];
/** 任务从收下到打完：渲染一页、出块、交给假打印机，几秒内完成；CI 机器慢，给足 30 秒。 */
const JOB_TIMEOUT_MS = 30_000;
/** 打开共享到开始监听：几百毫秒；给足 10 秒。 */
const LISTEN_TIMEOUT_MS = 10_000;

/** 给 60×40 分配打印机、打开共享，等它开始监听；返回这台共享打印机的 http 地址和 ipp 地址。 */
async function shareLabelPaper(page: Page): Promise<{ url: string; printerUri: string }> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' }, ippSharingEnabled: true });
  await expect
    .poll(async () => (await callApi(page, 'getIppSharingStatus')).server.state, { timeout: LISTEN_TIMEOUT_MS })
    .toBe('listening');
  const { server } = await callApi(page, 'getIppSharingStatus');
  if (server.state !== 'listening') {
    throw new Error('LAN sharing is not listening');
  }
  const url = `http://127.0.0.1:${server.port}/printers/60x40`;
  return { url, printerUri: url.replace('http:', 'ipp:') };
}

function jobState(message: IppMessage | null): number | null {
  return message === null ? null : integerValue(attributeIn(message, GROUP_TAGS.job, 'job-state'));
}

async function waitForJobState(url: string, printerUri: string, jobId: number, state: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const reply = await sendIpp(
          url,
          ippRequest(OPERATIONS.getJobAttributes, { printerUri, operation: [integerAttr('job-id', jobId)] }),
        );
        return jobState(reply.message);
      },
      { timeout: JOB_TIMEOUT_MS },
    )
    .toBe(state);
}

test('shares each paper that has a printer as a driverless IPP printer', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const { url, printerUri } = await shareLabelPaper(page);
  const reply = await sendIpp(url, ippRequest(OPERATIONS.getPrinterAttributes, { printerUri }));
  expect(reply.message?.code).toBe(STATUS.ok);
  const message = reply.message ?? ippRequest(0);
  expect(stringValue(attributeIn(message, GROUP_TAGS.printer, 'printer-name'))).toBe('60×40 标签');
  expect(stringValue(attributeIn(message, GROUP_TAGS.printer, 'media-default'))).toBe('om_label-60x40_60x40mm');
  expect(stringValues(attributeIn(message, GROUP_TAGS.printer, 'document-format-supported'))).toContain(
    'image/pwg-raster',
  );
  // 浏览器打开同一个地址是一页说明。
  expect(await (await fetch(url)).text()).toContain('60×40 标签');
});

test('asks before a new computer prints, then prints to the paper printer and records it', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const { url, printerUri } = await shareLabelPaper(page);
  const pdf = await labelPdfBytes(app, 'CL5640');
  const first = await sendIpp(
    url,
    ippRequest(OPERATIONS.printJob, {
      printerUri,
      operation: [nameAttr('job-name', 'e2e 标签'), nameAttr('requesting-user-name', 'e2e')],
    }),
    pdf,
  );
  expect(first.message?.code).toBe(STATUS.ok);
  expect(jobState(first.message)).toBe(JOB_STATE['pending-held']);
  const firstId = integerValue(attributeIn(first.message ?? ippRequest(0), GROUP_TAGS.job, 'job-id')) ?? 0;

  const requests = page.getByRole('region', { name: '等待确认的电脑' });
  await expect(requests).toContainText('局域网里的电脑 127.0.0.1');
  await expect(requests).toContainText('用户 e2e 要打印到「60×40 标签」');
  await requests.getByRole('button', { name: '允许' }).click();
  await expect(requests).toHaveCount(0);
  await waitForJobState(url, printerUri, firstId, JOB_STATE.completed);

  expect((await fakePrints(app)).map((print) => print.printerName)).toEqual(['标签机A']);
  const { jobs } = await callApi(page, 'listJobs', { limit: 5 });
  expect(jobs[0]).toMatchObject({
    source: 'ipp',
    status: 'printed',
    printerName: '标签机A',
    paper: '60x40',
    raw: 'e2e 标签 第 1 页第 1 张',
    ipp: { client: '127.0.0.1', user: 'e2e' },
  });

  // 同一台电脑再打（一张 PNG）：记住了允许，不再问；图片在渲染页里解码。
  const png = await page.screenshot();
  const second = await sendIpp(url, ippRequest(OPERATIONS.printJob, { printerUri }), new Uint8Array(png));
  expect(jobState(second.message)).toBe(JOB_STATE.pending);
  const secondId = integerValue(attributeIn(second.message ?? ippRequest(0), GROUP_TAGS.job, 'job-id')) ?? 0;
  await waitForJobState(url, printerUri, secondId, JOB_STATE.completed);
  expect(await fakePrints(app)).toHaveLength(2);
  expect((await callApi(page, 'getIppSharingStatus')).clients).toMatchObject([
    { address: '127.0.0.1', decision: 'allow' },
  ]);
});

test('asks for the share password once it is set', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const { url, printerUri } = await shareLabelPaper(page);
  await callApi(page, 'setSharePassword', '前台1234');
  const pdf = await labelPdfBytes(app, 'X');
  expect((await sendIpp(url, ippRequest(OPERATIONS.printJob, { printerUri }), pdf)).httpStatus).toBe(401);
  const allowed = await sendIpp(
    url,
    ippRequest(OPERATIONS.printJob, { printerUri }),
    pdf,
    basicAuth('anyone', '前台1234'),
  );
  expect(allowed.message?.code).toBe(STATUS.ok);
});

test('turns sharing on from the config page and lists the shared paper', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' } });
  await page.reload();
  await openConfig(page, '局域网共享');
  const status = page.getByRole('region', { name: '共享状态' });
  await expect(status.getByRole('status')).toHaveText('没有开');
  await clickSwitch(page, '局域网共享');
  await expect(status.getByRole('status')).toHaveText('正在共享');
  const printers = page.getByRole('region', { name: '共享的打印机' });
  await expect(printers).toContainText('60×40 标签');
  await expect(printers).toContainText('打到 标签机A');
  await expect(printers.getByText(/^http:\/\/.+\/printers\/60x40$/).first()).toBeVisible();
});
