import { request as httpRequest } from 'node:http';
import { createServer, type Socket } from 'node:net';
import type { Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, openConfig, recordClipboard } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/** 两种纸各一台（打印只记下来，不碰真打印机）。 */
const PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
];
const GENERIC = 'templates/builtin-generic';
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

/** 复制一个模板改成 100×180；返回它的编号和在接口里的名字。 */
async function createWaybillTemplate(page: Page): Promise<{ id: string; name: string }> {
  const copy = await callApi(page, 'duplicateTemplate', 'builtin:generic');
  await callApi(page, 'saveTemplate', { ...copy, name: '面单', paper: { widthMm: 100, heightMm: 180 } });
  return { id: copy.id, name: `templates/${copy.id.replace(':', '-')}` };
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
  const waybill = await createWaybillTemplate(page);
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
  // 模板是经接口新建的：重新加载界面，让打印记录知道这个模板还在（能按原样重打）。
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  const base = await apiBase(page);
  const headers = await createKey(page);
  // 内容不是任何识别规则认得的码：重打、预览都要按记录里的模板和字段，重新识别的话会落到别的模板和打印机。
  const fields = [
    { name: '单号', value: 'SF1234567890' },
    { name: '收件人', value: '张三' },
  ];
  const content = 'SF1234567890 张三';
  const created = await fetch(`${base}/v1/printJobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ template: waybill.name, fields, content }),
  });
  expect(created.status).toBe(200);
  await waitAllSent(base, headers, 1);
  const printed = { printerName: '面单机B', raw: content, paper: '100x180', templateId: waybill.id };
  expect(await fakePrints(app)).toEqual([printed]);
  const [job] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
  expect(job).toMatchObject({ source: 'api', raw: content, fields, templateId: waybill.id });
  expect(job?.caller).toMatch(/^key:/);

  // 打印记录（工作台右侧一直显示）由主进程推送刷新；本机接口的记录按当时的模板和字段重打。
  const apiRow = page.locator('.job-row').filter({ hasText: '本机接口（E2E）' });
  await expect(apiRow).toHaveCount(1);
  await apiRow.getByRole('button', { name: '重打' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBe(2);
  expect((await fakePrints(app))[1]).toEqual(printed);
  // 重打出来的记录带着原来的调用方和字段，写明是原提交的调用方。
  const [reprinted] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
  expect(reprinted).toMatchObject({ source: 'history', raw: content, fields, caller: job?.caller });
  await expect(page.locator('.job-row').first().locator('.job-row__meta')).toContainText('记录重打（原提交：E2E）');

  // 先预览、核对后按 F2：同样按记录里的模板和字段。
  await apiRow.getByRole('button', { name: '预览' }).click();
  await expect(page.locator('.status-strip__title')).toHaveText('待打印');
  await page.keyboard.press('F2');
  await expect.poll(async () => (await fakePrints(app)).length).toBe(3);
  expect((await fakePrints(app))[2]).toEqual(printed);
});

// 快递面单：订单系统取好号，带着字段交给内置的面单模板，打到装着面单纸的那台。
test('prints a courier waybill with a built-in waybill template', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const template = 'templates/builtin-waybill-platform-180';
  const listed = (await (await fetch(`${base}/v1/templates`, { headers })).json()) as {
    templates: { name: string; paper: unknown; fieldsMode: string; fieldNames: string[] }[];
  };
  const described = listed.templates.find((item) => item.name === template);
  expect(described?.fieldsMode).toBe('PICKED');
  expect(described?.fieldNames).toEqual(expect.arrayContaining(['运单号', '三段码', '收件人', '收件地址']));

  const fields = [
    { name: '快递公司', value: '中通快递' },
    { name: '运单号', value: '781234567890123' },
    { name: '三段码', value: '531-A03 12' },
    { name: '收件人', value: '张三' },
    { name: '收件电话', value: '138****0000' },
    { name: '收件地址', value: '浙江省杭州市西湖区文三路 478 号' },
  ];
  const created = await fetch(`${base}/v1/printJobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ template, fields, content: '781234567890123' }),
  });
  expect(created.status).toBe(200);
  await waitAllSent(base, headers, 1);
  expect(await fakePrints(app)).toEqual([
    { printerName: '面单机B', raw: '781234567890123', paper: '100x180', templateId: 'builtin:waybill-platform-180' },
  ]);
});

// 自由设计模板：本机接口列出它用到的字段，按这些字段打到装着 60×40 的那台。
test('prints a canvas template through the local API', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const template = 'templates/builtin-canvas-tag';
  const listed = (await (await fetch(`${base}/v1/templates`, { headers })).json()) as {
    templates: { name: string; fieldsMode: string; fieldNames: string[] }[];
  };
  expect(listed.templates.find((item) => item.name === template)).toMatchObject({
    fieldsMode: 'PICKED',
    fieldNames: ['编码', '颜色', '尺码', '货架号'],
  });

  const fields = [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ];
  const created = await fetch(`${base}/v1/printJobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ template, fields, content: 'CL5640-TK-图片色-XL' }),
  });
  expect(created.status).toBe(200);
  await waitAllSent(base, headers, 1);
  expect(await fakePrints(app)).toEqual([
    { printerName: '标签机A', raw: 'CL5640-TK-图片色-XL', paper: '60x40', templateId: 'builtin:canvas-tag' },
  ]);
});

// 自己设计的自由设计模板：本机接口列出它用到的字段，按它打到这种纸的打印机。
test('prints a canvas template made in the designer through the local API', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
  const created = await callApi(page, 'createCanvasTemplate');
  await callApi(page, 'saveTemplate', {
    ...created,
    name: '价签',
    elements: [
      {
        id: 'price',
        name: '价格',
        kind: 'text',
        x: 2,
        y: 2,
        width: 40,
        height: 10,
        rotation: 0,
        locked: false,
        text: '￥{价格}',
        fontSizeMm: 6,
        bold: true,
        align: 'left',
        valign: 'middle',
        fit: 'shrink',
        inverse: false,
      },
      {
        id: 'code',
        name: '商品码',
        kind: 'barcode',
        x: 2,
        y: 20,
        width: 50,
        height: 15,
        rotation: 0,
        locked: false,
        symbology: 'ean13',
        value: '{商品码}',
        showText: true,
        textSizeMm: 2.5,
      },
    ],
  });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const template = `templates/${created.id.replace(':', '-')}`;
  const listed = (await (await fetch(`${base}/v1/templates`, { headers })).json()) as {
    templates: { name: string; fieldsMode: string; fieldNames: string[] }[];
  };
  expect(listed.templates.find((item) => item.name === template)).toMatchObject({
    fieldsMode: 'PICKED',
    fieldNames: ['价格', '商品码'],
  });
  const response = await fetch(`${base}/v1/printJobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      template,
      fields: [
        { name: '价格', value: '59.90' },
        { name: '商品码', value: '6901234567892' },
      ],
      content: '6901234567892',
    }),
  });
  expect(response.status).toBe(200);
  await waitAllSent(base, headers, 1);
  expect(await fakePrints(app)).toEqual([
    { printerName: '标签机A', raw: '6901234567892', paper: '60x40', templateId: created.id },
  ]);
});

test('prints a batch of 300 labels on two papers, each printer in submission order', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const waybill = await createWaybillTemplate(page);
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' } });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const requests = Array.from({ length: BATCH_SIZE }, (_, index) => ({
    template: index % 2 === 0 ? GENERIC : waybill.name,
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
  const response = await fetch(`${base}/v1/${GENERIC}:render`, {
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

// 自由设计模板里的图片转成 1 位 BMP 后按打印点数线性增长；本机接口导出 PDF 用 PDF_DPI=1200，
// 100×100 的纸铺满一张图能到 3MB 以上的 HTML。标签窗口曾经用 data: URL 加载这段 HTML，
// Chromium 对 data: URL 有大小限制（实测约 1.9MB 就 ERR_FAILED），这张图稳定超过那个上限。
test('renders a PDF for a canvas template with a large image on 100x100 paper', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const created = await callApi(page, 'createCanvasTemplate');
  const pixelSide = 8;
  const pixels = Buffer.from(
    Uint8Array.from({ length: pixelSide * pixelSide }, (_, index) => (index % 2 === 0 ? 20 : 235)),
  ).toString('base64');
  await callApi(page, 'saveTemplate', {
    ...created,
    name: '大图片',
    paper: { widthMm: 100, heightMm: 100 },
    elements: [
      {
        id: 'photo',
        name: '图片',
        kind: 'image',
        x: 2,
        y: 2,
        width: 96,
        height: 96,
        rotation: 0,
        locked: false,
        pixels,
        pixelWidth: pixelSide,
        pixelHeight: pixelSide,
        mode: 'dither',
        threshold: 128,
      },
    ],
  });
  const base = await apiBase(page);
  const headers = await createKey(page);
  const template = `templates/${created.id.replace(':', '-')}`;
  const response = await fetch(`${base}/v1/${template}:render`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields: [{ name: '占位', value: '1' }] }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
});

test('asks the operator before a website may use it, and forgets it when revoked', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const base = await apiBase(page);
  const templatesUrl = `${base}/v1/templates`;
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(403);
  // 程序顶部列出等确认的网站；按钮只能用鼠标点。
  const request = page.getByRole('region', { name: '等待确认的网站' });
  await expect(request).toContainText(SITE);
  await request.getByRole('button', { name: '允许' }).click();
  await expect(request).toHaveCount(0);
  expect((await callApi(page, 'getLocalApiStatus')).authorizedOrigins).toEqual([SITE]);
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(200);
  await callApi(page, 'revokeApiOrigin', SITE);
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(403);
});

test('tells a website the operator refused that it was refused', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const base = await apiBase(page);
  const templatesUrl = `${base}/v1/templates`;
  await requestAsWebsite(templatesUrl, SITE);
  await page.getByRole('region', { name: '等待确认的网站' }).getByRole('button', { name: '拒绝' }).click();
  expect(await requestAsWebsite(templatesUrl, SITE)).toBe(403);
  await expect(page.getByRole('region', { name: '等待确认的网站' })).toHaveCount(0);
  expect((await callApi(page, 'getLocalApiStatus')).authorizedOrigins).toEqual([]);
});

test('manages program keys and the LAN switch on the local api page', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const copied = await recordClipboard(app);
  const base = await apiBase(page);
  await openConfig(page, '本机接口');
  await expect(page.getByRole('status').filter({ hasText: '正在运行' })).toBeVisible();
  await expect(page.locator('.api-address').first()).toHaveText(base);
  // 关掉局域网之前，本机地址之外还列着局域网地址：关掉后只剩本机的，才说明开关起了作用。
  const { lanAddresses } = await callApi(page, 'getLocalApiStatus');
  expect(lanAddresses.length).toBeGreaterThan(0);
  await expect(page.locator('.api-address')).toHaveCount(1 + lanAddresses.length);

  await page.getByLabel('名称', { exact: true }).fill('仓库');
  await page.getByRole('button', { name: '生成密钥' }).click();
  const secretField = page.getByLabel('新密钥');
  await expect(secretField).toHaveValue(/^lf_/);
  const secret = await secretField.inputValue();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
  expect(await copied()).toEqual([secret]);
  await page.getByRole('button', { name: '完成' }).click();
  await expect(secretField).toHaveCount(0);

  const headers = { authorization: `Bearer ${secret}` };
  expect((await fetch(`${base}/v1/templates`, { headers })).status).toBe(200);
  const card = page.locator('.api-key-card').filter({ hasText: '仓库' });
  await card.getByRole('button', { name: '撤销' }).click();
  await card.getByRole('button', { name: '确认撤销' }).click();
  await expect(page.getByText('还没有程序密钥。')).toBeVisible();
  expect((await fetch(`${base}/v1/templates`, { headers })).status).toBe(401);

  // 原生复选框被画出来的滑轨盖着：像用户一样点开关本身。
  await page
    .locator('label.switch')
    .filter({ has: page.getByRole('switch', { name: '局域网访问' }) })
    .click();
  await expect
    .poll(async () => (await callApi(page, 'getLocalApiStatus')).server)
    .toMatchObject({
      state: 'listening',
      lanEnabled: false,
    });
  await expect(page.locator('.api-address')).toHaveCount(1);
});

// Windows 上别的程序占着 127.0.0.1 的端口时，Electron 里监听所有网卡照样成功，本机的请求却到了那个程序：
// 程序要发现这一点，自动换一个端口，并说清楚跳过了哪个。
test('moves off a port that another program answers on locally, even with the LAN open', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  await apiBase(page);
  // 占端口的程序收下连接但从不回应；关掉它之前先断开这些连接，不然 close 会一直等。
  const sockets = new Set<Socket>();
  const blocker = createServer((socket) => sockets.add(socket));
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const address = blocker.address();
    const taken = typeof address === 'object' && address !== null ? address.port : 0;
    await callApi(page, 'updateSettings', { apiPort: taken, apiLanEnabled: true });
    await expect
      .poll(async () => (await callApi(page, 'getLocalApiStatus')).server)
      .toMatchObject({ state: 'listening', lanEnabled: true, skippedPorts: [taken] });
    const { server } = await callApi(page, 'getLocalApiStatus');
    const moved = server.state === 'listening' ? server.port : taken;
    expect(moved).not.toBe(taken);
    expect((await fetch(`http://127.0.0.1:${moved}/v1/service`)).status).toBe(200);
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => blocker.close(resolve));
  }
});
