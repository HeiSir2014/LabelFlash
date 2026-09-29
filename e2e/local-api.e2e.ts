import { request as httpRequest } from 'node:http';
import type { ElectronApplication, Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/** 两种纸各一台（打印只记下来，不碰真打印机）。 */
const PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
];
const STANDARD = 'templates/builtin-standard';
const SITE = 'https://erp.example.com';
/** 服装标签一批两三百张很常见：E2E 按这个量走一遍。 */
const BATCH_SIZE = 300;

interface ApiJob {
  name: string;
  state: string;
  sentCopies: number;
}

/** 本机接口的地址：程序启动、主窗口建好之后才开始监听。 */
async function apiBase(page: Page): Promise<string> {
  await expect
    .poll(async () => (await callApi(page, 'getLocalApiStatus')).server.state, { timeout: 10_000 })
    .toBe('listening');
  const { server } = await callApi(page, 'getLocalApiStatus');
  if (server.state !== 'listening') {
    throw new Error('local api is not listening');
  }
  return `http://127.0.0.1:${server.port}`;
}

async function createKey(page: Page): Promise<Record<string, string>> {
  const { secret } = await callApi(page, 'createApiKey', 'E2E');
  return { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
}

async function waitAllSent(base: string, headers: Record<string, string>, count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await fetch(`${base}/v1/printJobs?pageSize=1000`, { headers });
        const { printJobs } = (await response.json()) as { printJobs: ApiJob[] };
        return printJobs.filter((job) => job.state === 'SENT').length;
      },
      { timeout: 60_000 },
    )
    .toBe(count);
}

/** 带 Origin 的请求（像网页那样）：Node 的 fetch 不一定让设置 Origin，这里直接用 http 模块。 */
function requestAsWebsite(url: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(url, { headers: { origin } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** 换掉系统对话框：网站授权框一律点「允许」，并记下问过哪些网站。 */
async function allowEveryWebsite(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ dialog }) => {
    const asked: string[] = [];
    (globalThis as { e2eAskedOrigins?: string[] }).e2eAskedOrigins = asked;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { detail?: string };
      asked.push((options.detail ?? '').split('\n')[0] ?? '');
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  return () => app.evaluate(() => [...((globalThis as { e2eAskedOrigins?: string[] }).e2eAskedOrigins ?? [])]);
}

/** 复制一个模板改成 100×180；返回它在接口里的名字。 */
async function createWaybillTemplate(page: Page): Promise<string> {
  const copy = await callApi(page, 'duplicateTemplate', 'builtin:generic');
  await callApi(page, 'saveTemplate', { ...copy, name: '面单', paper: { widthMm: 100, heightMm: 180 } });
  return `templates/${copy.id.replace(':', '-')}`;
}

test('asks for a program key before anything else', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const base = await apiBase(page);
  expect(await (await fetch(`${base}/v1/service`)).json()).toMatchObject({
    product: 'CDL-LabelFlash',
    apiVersion: 'v1',
  });
  const denied = await fetch(`${base}/v1/templates`);
  expect(denied.status).toBe(401);
  expect(JSON.stringify(await denied.json())).toContain('NO_KEYS_YET');
});

test('prints a job from a program, records it with its fields and reprints it from the job log', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' } });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const fields = [
    { name: '编码', value: 'CL5640-TK' },
    { name: '尺码', value: 'XL' },
  ];
  const created = await fetch(`${base}/v1/printJobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ template: STANDARD, fields, content: 'CL5640-TK-XL' }),
  });
  expect(created.status).toBe(200);
  await waitAllSent(base, headers, 1);
  expect(await fakePrints(app)).toEqual([
    { printerName: '标签机A', raw: 'CL5640-TK-XL', paper: '60x40', templateId: 'builtin:standard' },
  ]);
  const [job] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
  expect(job).toMatchObject({ source: 'api', raw: 'CL5640-TK-XL', fields, templateId: 'builtin:standard' });
  expect(job?.caller).toMatch(/^key:/);

  // 打印记录由主进程推送刷新；本机接口的记录按当时的模板和字段重打。
  await page.getByRole('tab', { name: '打印记录' }).click();
  const row = page.locator('.job-row').first();
  await expect(row.locator('.job-row__meta')).toContainText('本机接口');
  await row.getByRole('button', { name: '重打' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBe(2);
  expect((await fakePrints(app))[1]).toMatchObject({ raw: 'CL5640-TK-XL', templateId: 'builtin:standard' });
});

test('prints a batch of 300 labels on two papers, each printer in submission order', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const waybill = await createWaybillTemplate(page);
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const requests = Array.from({ length: BATCH_SIZE }, (_, index) => ({
    template: index % 2 === 0 ? STANDARD : waybill,
    fields: [{ name: '序号', value: String(index) }],
    content: `NO-${index}`,
  }));
  const response = await fetch(`${base}/v1/printJobs:batchCreate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requests }),
  });
  expect(response.status).toBe(200);
  await waitAllSent(base, headers, BATCH_SIZE);
  const printed = await fakePrints(app);
  const onLabels = printed.filter((item) => item.printerName === '标签机A').map((item) => item.raw);
  const onWaybills = printed.filter((item) => item.printerName === '面单机B').map((item) => item.raw);
  expect(onLabels).toEqual(requests.filter((_, index) => index % 2 === 0).map((item) => item.content));
  expect(onWaybills).toEqual(requests.filter((_, index) => index % 2 === 1).map((item) => item.content));
});

test('renders a PDF on the paper of the template', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const response = await fetch(`${base}/v1/${STANDARD}:render`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields: [{ name: '编码', value: 'CL5640-TK' }] }),
  });
  expect(response.headers.get('content-type')).toBe('application/pdf');
  const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  // 60×40mm = 170.08×113.39 点（1 点 = 1/72 英寸）。
  const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(Number(mediaBox?.[1])).toBeCloseTo(170.08, 0);
  expect(Number(mediaBox?.[2])).toBeCloseTo(113.39, 0);
});

test('asks the operator before a website may use it, and forgets it when revoked', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const asked = await allowEveryWebsite(app);
  const base = await apiBase(page);
  const templatesUrl = `${base}/v1/templates`;
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(403);
  await expect.poll(async () => (await callApi(page, 'getLocalApiStatus')).authorizedOrigins).toEqual([SITE]);
  expect(await asked()).toEqual([SITE]);
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(200);
  await callApi(page, 'revokeApiOrigin', SITE);
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(403);
});
