import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { type HttpStep, STEP_LIMITS } from '../../src/core/scan/enrich-model';
import { TEMPLATE_LIBRARY } from '../../src/core/templates/library/template-library';
import type { FakeDiagnosisSpec, FakePrinterSpec } from '../../src/main/printing/fake-printers';
import { RECENT_DELIVERY_COUNT } from '../../src/shared/ipc-contract';
import { HISTORY_LIMIT_RANGE } from '../../src/shared/settings';
import {
  allowSlowScannerLines,
  blurActiveElement,
  callApi,
  clickSwitch,
  fakePrints,
  openConfig,
  recordClipboard,
  scan,
  stubOpenDialog,
  stubPrinting,
  typeLikeScanner,
} from '../support/app-helpers';
import { catalogModel, catalogText, e2eCatalogKeys, fakeDrivers } from '../support/driver-catalog';
import { APP_ROOT, type LaunchOptions } from '../support/electron-app';
import { expect, test } from '../support/fixtures';
import { connectTestPhone, type LocalRelay, startLocalRelay, type TestPhone } from '../support/relay-server';
import {
  ALL_SIZES,
  addJobs,
  capturePng,
  formatBounds,
  isSameRectangle,
  pushBatchStatus,
  pushUpdateStatus,
  resize,
  SIZE_1024,
  SIZE_1280,
  SIZE_1366_150,
  SIZE_1920,
  type Size,
  setFullScreen,
  sizeLabel,
  startServer,
  type WindowHandle,
  waitForStableBounds,
} from './acceptance-support';
import { type Issue, pageChecks } from './checks';

/**
 * 视觉验收（设计文档 §8.2 的验收项，V01 起；自由设计的设计器是 V44–V49、V56–V59、V64–V66，模板库是 V50–V55，
 * 批量打印是 V60–V63，标签机指令是 V80–V83，诊断是 V84–V86，驱动安装是 V87–V89）：每项在三种窗口尺寸下截图，每张跑 §8.3 的自动检查，
 * 结果写进 manifest.json，供验收页面逐项展示和确认。
 */

const OUT_DIR = join(APP_ROOT, 'test-results', 'visual-acceptance');
/**
 * 截图前等界面静下来：最长的一次性过渡是出纸动画（--feed-duration 180ms）和配置中心进出（--config-duration 160ms），
 * 多留一倍左右，截到的是动画结束后的样子。
 */
const SETTLE_MS = 350;
/** V49、V56–V59、V64–V66 设计器：常用笔记本、最小支持宽度，和 1366×768 开 150% 缩放（店里常见的小屏笔记本）。 */
const DESIGNER_SIZES: readonly Size[] = [SIZE_1280, SIZE_1024, SIZE_1366_150];
/** V01：扫码栏在 100% / 150% / 200% 缩放下截图。 */
const ZOOM_FACTORS: readonly number[] = [1, 1.5, 2];
/** V01：「扫码」标签与输入文字的中线最多差 1px（设计文档 §8.2）。 */
const ALIGNMENT_TOLERANCE_PX = 1;

/** 配置中心扫码的验收项选这台（假的）打印机并打开自动打印，打印处理先换成只计数的假实现。 */
const FAKE_PRINTER = 'E2E 打印机';
/** V04：打印记录里放这么多条，一屏放不下，能看到列表滚动。 */
const HISTORY_SAMPLE_JOBS = 12;
/** V27：比「打印记录保留」的最小值多几条，把上限调到最小值时才会弹出删除确认条。 */
const EXTRA_JOBS_OVER_LIMIT = 5;
/** 端口 9（discard）本机一般没有服务在听，连接会被立即拒绝：用来得到「连不上」的结果。 */
const UNREACHABLE_ORIGIN = 'http://127.0.0.1:9';
/** V12：试一试里的 HTTP 查询失败（连接被拒绝，最迟到步骤默认的 1.5 秒超时）在这之内出结果。 */
const HTTP_FAILURE_TIMEOUT_MS = 10_000;
/** V19：本机接口很快送达；连不上的接口第一次发送失败后转为等待重试。真实网络栈，留足时间。 */
const DELIVERY_TIMEOUT_MS = 15_000;
/** V08：把表单滚到中段，看预览是否固定不动。 */
const FORM_SCROLL_PX = 400;
/** V16：比行预览显示的 20 行多，确认只显示前 20 行。 */
const LOOKUP_SAMPLE_ROWS = 30;
/** V24：从「返回工作台」开始按这么多次 Tab，走完导航（9 项）和通用页前几个控件，足够看出顺序。 */
const TAB_ORDER_STEPS = 16;
/** V24：Tab 顺序备注里每个元素只取开头几个字。 */
const FOCUS_LABEL_LENGTH = 12;
/**
 * V28：本机接口过这么久才返回。要比「正在查询」出现（200ms）加上截图的时间长得多，
 * 又要短于 HTTP 步骤允许的最长超时（STEP_LIMITS.timeoutMs.max，5 秒），不然界面显示的是超时。
 */
const SLOW_QUERY_DELAY_MS = 4_000;
/** V25：进入全屏前把窗口挪离默认的居中位置，退出全屏后如果被拉回默认位置，一眼就能看出来。 */
const OFF_CENTER_PX = 48;

interface Context {
  app: ElectronApplication;
  page: Page;
  userData: string;
  /** 主窗口。不用 BrowserWindow.getAllWindows()[0]：隐藏的打印窗口也在那个列表里。 */
  window: WindowHandle;
  notes: string[];
  /** 这一项结束时（包括失败时）要做的收尾，例如关掉本机接口。按登记的倒序执行，在程序关闭之前。 */
  cleanups: (() => Promise<void>)[];
  /** 用 stubPrinting 换掉打印处理之后，读取打印次数。 */
  printCalls?: () => Promise<number>;
}

interface Shot {
  label: string;
  /** 每种尺寸截图前都执行一次（例如悬停）。 */
  prepare?: (ctx: Context) => Promise<void>;
}

interface Item {
  id: string;
  title: string;
  points: string;
  sizes?: readonly Size[];
  /** 启动选项，例如用假打印机代替系统打印机。 */
  launch?: LaunchOptions;
  setup?: (ctx: Context) => Promise<void>;
  shots?: Shot[];
  /** 不走通用的截图流程，自己截（缩放、系统窗口截图）。 */
  custom?: (
    ctx: Context,
    record: (label: string, size: string, png: Buffer, issues: Issue[]) => Promise<void>,
  ) => Promise<void>;
}

/** V80–V83：认得出指令集的标签机、驱动不收 RAW 的面单机、认不出的家用打印机。 */
const COMMAND_PRINTERS: FakePrinterSpec[] = [
  {
    name: '标签机A',
    paper: { widthMm: 60, heightMm: 40, dpi: 203 },
    readiness: { ready: true },
    driverName: 'Label Printer TSPL',
  },
  {
    name: '面单机B',
    paper: { widthMm: 100, heightMm: 150, dpi: 203 },
    readiness: { ready: true },
    driverName: 'Label Printer ZPL',
    rawFailure: 'raw-rejected',
  },
  {
    name: '家用打印机',
    paper: { widthMm: 210, heightMm: 297, dpi: 600 },
    readiness: null,
    driverName: 'Office Inkjet',
  },
];

/** V87–V89：测试现场生成的清单密钥（公钥经启动选项交给程序）。 */
const DRIVER_KEYS = e2eCatalogKeys();
/** V88：假的提权安装停在「安装」这一步，够截图。 */
const DRIVER_INSTALL_HOLD_MS = 600_000;
/** V89：60 天前签的清单（有效期 30 天），已过期。 */
const EXPIRED_CATALOG_AGE_MS = 60 * 86_400_000;

async function openDriverCard(ctx: Context, catalog: string): Promise<void> {
  const server = await startServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(catalog);
  });
  ctx.cleanups.push(server.close);
  await callApi(ctx.page, 'updateSettings', { driverCatalogUrl: `${server.origin}/driver-catalog.json` });
  await openConfig(ctx.page, '打印机');
  await ctx.page.getByRole('region', { name: '驱动' }).scrollIntoViewIfNeeded();
}

/** 分配好纸张、打开打印机页，展开这台打印机的「标签机指令」。 */
async function openPrinterCommands(page: Page, printerName: string): Promise<Locator> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x150': '面单机B' } });
  await page.reload();
  await openConfig(page, '打印机');
  await page.locator('.printer-row', { hasText: printerName }).getByRole('button', { name: '标签机指令' }).click();
  const panel = page.getByRole('region', { name: `${printerName} 的标签机指令` });
  await expect(panel.getByLabel('指令集')).toBeVisible();
  return panel;
}

interface ShotRecord {
  label: string;
  size: string;
  file: string;
  issues: Issue[];
}

interface ItemRecord {
  id: string;
  title: string;
  points: string;
  shots: ShotRecord[];
  notes: string[];
}

// ── 通用操作 ──

/** 选一台假打印机、打开自动打印（打印处理先换成只计数的假实现），重新加载界面让设置生效。 */
async function useFakePrinter(ctx: Context): Promise<void> {
  ctx.printCalls = await stubPrinting(ctx.app);
  await callApi(ctx.page, 'updateSettings', { paperPrinters: { '60x40': FAKE_PRINTER }, autoPrint: true });
  await ctx.page.reload();
}

// ── 验收项 ──

/**
 * V35–V37：几台假打印机（打印只记下来，不碰真打印机）。驱动纸张各不相同，面单机B 缺纸，
 * 家用打印机没有负责任何纸张（只显示驱动纸张，不提醒）。
 */
const PAPER_PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  {
    name: '面单机B',
    paper: { widthMm: 100, heightMm: 180, dpi: 203 },
    readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
  },
  { name: '面单机C', paper: { widthMm: 100, heightMm: 180, dpi: 300 }, readiness: { ready: true } },
  { name: '家用打印机', paper: { widthMm: 210, heightMm: 297, dpi: 600 }, readiness: null },
];

/** V84–V86：一台 60×40 的假标签机，诊断的各项按需要设成好的或坏的。 */
const DIAGNOSIS_PRINTER = '标签机A';

function diagnosisPrinters(diagnosis: FakeDiagnosisSpec, overrides: Partial<FakePrinterSpec> = {}): FakePrinterSpec[] {
  return [
    {
      name: DIAGNOSIS_PRINTER,
      paper: { widthMm: 60, heightMm: 40, dpi: 203 },
      readiness: { ready: true },
      diagnosis,
      ...overrides,
    },
  ];
}

/** 把 60×40 分给标签机A，打开「打印机」页，点「诊断」，等全部查完。 */
async function openDiagnosisPanel(page: Page): Promise<Locator> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': DIAGNOSIS_PRINTER } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await openConfig(page, '打印机');
  await page
    .locator('.printer-row', { hasText: DIAGNOSIS_PRINTER })
    .getByRole('button', { name: '诊断', exact: true })
    .click();
  const panel = page.getByRole('region', { name: `诊断：${DIAGNOSIS_PRINTER}` });
  await expect(panel.locator('.diagnosis__summary')).toContainText('查完了');
  return panel;
}

/** V60–V62：一台 60×40 的假标签机，每张打 300ms（V62 要在打完之前暂停）。 */
const BATCH_PRINTERS: FakePrinterSpec[] = [
  {
    name: '标签机A',
    paper: { widthMm: 60, heightMm: 40, dpi: 203 },
    readiness: { ready: true },
    printDelayMs: 300,
  },
];
/** V61：12 行，第 5 行缺颜色（标黄）；表里没有「货架号」（对列标红）。 */
const BATCH_CSV = [
  '编码,颜色,尺码,备注',
  ...Array.from({ length: 12 }, (_, index) => `CL${5640 + index},${index === 4 ? '' : '图片色'},XL,第 ${index + 1} 箱`),
].join('\n');
/** V62：只按序号打这么多张，暂停时还剩很多。 */
const BATCH_SERIAL_COUNT = 30;

async function openBatchPage(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await page.getByRole('button', { name: '批量打印' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '批量打印' })).toBeVisible();
}

/** 复制通用模板，改成指定的纸张（和打印机）后保存；返回新模板的 id。 */
async function saveCopyOnPaper(
  page: Page,
  name: string,
  paper: { widthMm: number; heightMm: number },
  printer: string | null = null,
): Promise<string> {
  const copy = await callApi(page, 'duplicateTemplate', 'builtin:generic');
  await callApi(page, 'saveTemplate', { ...copy, name, paper, printer });
  return copy.id;
}

/** V38：在测试进程里占住一个端口，让本机接口「端口被占用」。 */
async function occupyPort(ctx: Context): Promise<number> {
  // 收下连接但从不回应（程序的自检会连过来）；关掉之前先断开这些连接，不然 close 会一直等。
  const sockets = new Set<Socket>();
  const blocker: Server = createServer((socket) => sockets.add(socket));
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  ctx.cleanups.push(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    takenPort = null;
  });
  const address = blocker.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the blocker has no port');
  }
  return address.port;
}

/** V38：占住的端口（每种尺寸共用，只占一次）。 */
let takenPort: number | null = null;

/** V28 每次扫一个新码：旧的查询还没返回也不影响，界面只认最新的一次扫码。 */
let slowScanCount = 0;

const ITEMS: Item[] = [
  {
    id: 'V01',
    title: '工作台 · 空闲',
    points:
      '扫码框输入区至少 240px 宽，1024 宽度下备注和自动打印整体换到第二行；「扫码」标签与占位文字、输入文字在 100% / 150% / 200% 缩放下中线对齐（误差 ≤ 1px）；预览工具条模板下拉框完整显示模板名；右侧栏两个标签各占一半',
    custom: async (ctx, record) => {
      for (const size of ALL_SIZES) {
        await resize(ctx.window, size);
        await ctx.page.waitForTimeout(SETTLE_MS);
        const width = await ctx.page.locator('.scan-bar__input').evaluate((el) => el.getBoundingClientRect().width);
        ctx.notes.push(`${sizeLabel(size)}：扫码框输入区宽 ${Math.round(width)}px`);
        await record('空闲', sizeLabel(size), await capturePng(ctx.window), await pageChecks(ctx.page));
      }
      for (const zoom of ZOOM_FACTORS) {
        await resize(ctx.window, SIZE_1280, zoom);
        await ctx.page.waitForTimeout(SETTLE_MS);
        for (const text of ['', 'CL5640-TK-图片色-XL']) {
          // 经界面填写（不直接改 DOM 的 value）：Windows 上看得见的文字画在 .scan-bar__text，要由界面状态更新。
          await ctx.page.locator('.scan-bar__input').fill(text);
          const mids = await ctx.page.evaluate(() => {
            const mid = (selector: string) => {
              const rect = document.querySelector(selector)?.getBoundingClientRect();
              return rect ? rect.top + rect.height / 2 : Number.NaN;
            };
            // 量看得见的那一层：Windows 上输入框是透明的密码框，文字在 .scan-bar__text；macOS 上是输入框本身。
            const input = document.querySelector<HTMLInputElement>('.scan-bar__input');
            const visible = input?.type === 'password' ? '.scan-bar__text' : '.scan-bar__input';
            return { label: mid('.scan-bar__label'), input: mid(visible) };
          });
          const offset = Math.abs(mids.label - mids.input);
          const percent = `${zoom * 100}%`;
          const kind = text ? '输入文字' : '占位文字';
          ctx.notes.push(
            `缩放 ${percent}、${kind}：标签中线 ${mids.label.toFixed(1)}px，输入框中线 ${mids.input.toFixed(1)}px，相差 ${offset.toFixed(1)}px`,
          );
          await record(
            `缩放 ${percent} · ${kind}`,
            `${sizeLabel(SIZE_1280)} @${zoom}x`,
            await capturePng(ctx.window),
            offset > ALIGNMENT_TOLERANCE_PX ? [{ check: 'alignment', detail: `中线相差 ${offset.toFixed(1)}px` }] : [],
          );
        }
      }
      await resize(ctx.window, SIZE_1280);
    },
  },
  {
    id: 'V02',
    title: '工作台 · 已扫码（样衣码）',
    points:
      '工具条：模板下拉框显示当前模板「通用（二维码在左）」、可以换，右侧只写「规则：横杠三段（编码-颜色-尺码）」；预览列出编码、颜色、尺码；空闲时底部状态条不说话',
    setup: async ({ page }) => {
      await scan(page, 'CL5640-TK-图片色-XL');
      await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：横杠三段（编码-颜色-尺码）');
    },
  },
  {
    id: 'V03',
    title: '工作台 · 已扫码（多行键值）',
    points: '预览字段完整，工具条规则名正确',
    setup: async ({ page }) => {
      // 分界调大才不会被 CI 的延迟拆成几张（每一项都是新启动的程序和数据目录，影响不到别的项）。
      await allowSlowScannerLines(page);
      await page.locator('.scan-bar__input').focus();
      await typeLikeScanner(page, ['订单号：A20260929001', '款号：CL5640', '颜色：图片色', '尺码：XL', '数量：2']);
      await expect(page.locator('.preview-toolbar__usage')).toContainText('多行键值');
    },
  },
  {
    id: 'V04',
    title: '工作台 · 打印记录',
    points: '右侧只有打印记录（没有标签页头）：列表、搜索框、分页与现在一致，无横向滚动',
    setup: async ({ page }) => {
      await addJobs(page, HISTORY_SAMPLE_JOBS);
      await page.reload();
      await expect(page.locator('.job-row').first()).toBeVisible();
    },
  },
  {
    id: 'V05',
    title: '标题栏 · 配置按钮三种状态',
    points: '常态、悬停、按下（配置中心打开时）；与打印机胶囊高度、圆角、间距一致；macOS 红绿灯不遮挡',
    shots: [
      {
        label: '常态',
        prepare: async ({ page }) => {
          if ((await page.locator('.config-center').count()) > 0) {
            await page.locator('.config-button:not(.batch-button)').click();
            await expect(page.locator('.config-center')).toHaveCount(0);
          }
          await page.locator('.title-bar__name').hover();
        },
      },
      { label: '悬停', prepare: async ({ page }) => page.locator('.config-button:not(.batch-button)').hover() },
      {
        label: '按下（配置中心打开时）',
        prepare: async ({ page }) => {
          if ((await page.locator('.config-center').count()) === 0) {
            await page.locator('.config-button:not(.batch-button)').click();
          }
          await expect(page.locator('.config-button:not(.batch-button)')).toHaveAttribute('aria-pressed', 'true');
        },
      },
    ],
  },
  {
    id: 'V06',
    title: '配置中心 · 框架',
    points: '导航分组、当前项样式、页头对齐（「配置中不打印」只在扫码后出现）；工作台不可聚焦',
    setup: async ({ page, notes }) => {
      await openConfig(page, '通用');
      const inert = await page.locator('.workspace[inert]').count();
      notes.push(`工作台 inert：${inert === 1 ? '是' : '否'}`);
    },
  },
  {
    id: 'V07',
    title: '模板 · 列表视图',
    points: '列表行高、分组、「使用中」标记；右侧大预览随选中变化；预览内容输入框',
    setup: async ({ page }) => {
      await scan(page, 'CL5640-TK-图片色-XL');
      await openConfig(page, '模板');
      await page.locator('.template-item', { hasText: '通用 · 小二维码 + 底部备注' }).click();
    },
  },
  {
    id: 'V08',
    title: '模板 · 编辑视图（≥1100px）',
    points: '表单与预览并排；预览固定不随表单滚动；面包屑；底部操作条',
    sizes: [SIZE_1280, SIZE_1920],
    setup: async ({ page }) => {
      await openConfig(page, '模板');
      await page.getByRole('button', { name: '复制' }).click();
      await page.locator('.template-form').getByLabel('模板名称').fill('通用 · 仓库版');
      await page.locator('.template-editing__form').evaluate((el, top) => el.scrollTo(0, top), FORM_SCROLL_PX);
    },
  },
  {
    id: 'V09',
    title: '模板 · 编辑视图（1024px）',
    points: '预览在上 220px，表单在下滚动；无横向滚动',
    sizes: [SIZE_1024],
    setup: async ({ page }) => {
      await openConfig(page, '模板');
      await page.getByRole('button', { name: '复制' }).click();
    },
  },
  {
    id: 'V10',
    title: '模板 · 编辑 · 指定字段 + 垂直排列',
    points: '字段行卡片、分隔符输入、预览同步',
    setup: async ({ page }) => {
      await scan(page, 'CL5640-TK-图片色-XL');
      await openConfig(page, '模板');
      // 内置模板带着「指定字段」的预设（编码、颜色、尺码、货架号），复制后切过去就有现成的字段行。
      await page.locator('.template-item', { hasText: '通用（二维码在左）' }).click();
      await page.getByRole('button', { name: '复制' }).click();
      await page.locator('.template-form').getByText('指定字段', { exact: true }).click();
      await page.locator('.template-form').getByText('垂直（名称在上）', { exact: true }).click();
      await page.locator('.slot-card').first().scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'V11',
    title: '识别规则 · 列表视图',
    points: '规则卡片三行布局、停用样式、模板下拉框宽度；右侧试一试固定',
    setup: async ({ page }) => {
      await openConfig(page, '识别规则');
      // 勾选框跟着保存结果更新：点一下，再等它变成未勾选。
      await page.getByLabel('启用「多行键值」').click();
      await expect(page.getByLabel('启用「多行键值」')).not.toBeChecked();
    },
  },
  {
    id: 'V12',
    title: '识别规则 · 列表 · 试一试有结果',
    points: '命中规则、字段、加工步骤结果（含失败的红色项）排版',
    setup: async ({ page }) => {
      await openConfig(page, '识别规则');
      await page.getByRole('button', { name: '新建规则' }).click();
      await page.getByLabel('要添加的步骤类型').selectOption({ label: 'HTTP 查询' });
      await page.getByRole('button', { name: /添加步骤/ }).click();
      await page.getByLabel('地址', { exact: true }).fill(`${UNREACHABLE_ORIGIN}/shelf?code={字段1}`);
      await page.getByRole('button', { name: '保存规则' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '识别规则' })).toBeVisible();
      await page.getByLabel('要识别的内容').fill('CL5640_XL');
      await expect(page.locator('.rule-tester__step--failed')).toBeVisible({ timeout: HTTP_FAILURE_TIMEOUT_MS });
    },
  },
  {
    id: 'V13',
    title: '识别规则 · 编辑（分隔符拆分 + HTTP 步骤展开）',
    points: '表单与试一试并排；步骤卡片、请求头 / 取值路径两列表格；底部操作条和校验失败原因',
    sizes: [SIZE_1280, SIZE_1920],
    setup: async ({ page }) => {
      await openConfig(page, '识别规则');
      await page.getByRole('button', { name: '新建规则' }).click();
      await page.getByLabel('要添加的步骤类型').selectOption({ label: 'HTTP 查询' });
      await page.getByRole('button', { name: /添加步骤/ }).click();
      await page.getByLabel('要识别的内容').fill('CL5640_XL');
      // 故意填一个不合法的地址再保存，让操作条显示校验失败的原因。
      await page.getByLabel('地址', { exact: true }).fill('ftp://example.com');
      await page.getByRole('button', { name: '保存规则' }).click();
      await expect(page.locator('.config-actions__status--error')).toBeVisible();
      await page.locator('.step-card__head').first().scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'V14',
    title: '识别规则 · 编辑（1024px）',
    points: '试一试折叠在上方；表单无横向滚动',
    sizes: [SIZE_1024],
    setup: async ({ page }) => {
      await openConfig(page, '识别规则');
      await page.getByRole('button', { name: '新建规则' }).click();
      await page.getByLabel('要识别的内容').fill('CL5640_XL');
    },
  },
  {
    id: 'V15',
    title: '识别规则 · 编辑 · 多行键值 / 整段 / 正则',
    points: '三种表单各一张：别名输入、必填勾选、字符集分段、正则标志',
    sizes: [SIZE_1280],
    shots: ['多行键值', '整段匹配', '正则'].map((kind) => ({
      label: kind,
      prepare: async ({ page }) => {
        await openConfig(page, '识别规则');
        if ((await page.locator('.rule-editing').count()) > 0) {
          await page
            .locator('.config-actions')
            .getByRole('button', { name: /放弃修改|返回列表/ })
            .click();
        }
        await page.getByLabel('新规则的类型').selectOption({ label: kind });
        await page.getByRole('button', { name: '新建规则' }).click();
        await expect(page.locator('.rule-editing')).toBeVisible();
      },
    })),
  },
  {
    id: 'V16',
    title: '查找表 · 有表格 + 行预览',
    points: '卡片信息、行预览表头固定、表格内横向滚动而页面不滚动',
    setup: async ({ app, page, userData }) => {
      const columns = ['编码', '货架', '仓库', '区域', '备注', '负责人', '供应商', '面料', '更新时间', '说明'];
      const rows = Array.from({ length: LOOKUP_SAMPLE_ROWS }, (_, i) =>
        [
          `CL56${i}-TK`,
          `A-${i}`,
          '一号仓',
          '样衣间',
          '常规款',
          '张三',
          '某某面料厂',
          '棉 95%',
          '2026-09-29 10:00',
          '长文字说明用来撑宽表格',
        ].join(','),
      );
      const csvPath = join(userData, '货架.csv');
      await writeFile(csvPath, `${columns.join(',')}\n${rows.join('\n')}\n`, 'utf8');
      await stubOpenDialog(app, csvPath);
      await openConfig(page, '查找表');
      await page.getByRole('button', { name: '导入 CSV 表格' }).click();
      await page.getByRole('button', { name: '查看前 20 行' }).click();
      await expect(page.getByRole('table')).toBeVisible();
    },
  },
  {
    id: 'V17',
    title: '密钥',
    points: '引用写法可复制；密码框；错误提示位置',
    shots: [
      { label: '已有密钥（点过「复制引用」）' },
      {
        label: '保存失败的提示',
        prepare: async ({ page }) => {
          await page.getByLabel('名称', { exact: true }).fill('带{花括号}的名称');
          await page.getByLabel('内容', { exact: true }).fill('abc');
          await page.getByRole('button', { name: '保存密钥' }).click();
        },
      },
    ],
    // 剪贴板写入换成只记录：点「复制引用」不会改掉跑验收这台电脑上的系统剪贴板。
    setup: async ({ app, page, notes }) => {
      const copied = await recordClipboard(app);
      await openConfig(page, '密钥');
      await page.getByLabel('名称', { exact: true }).fill('仓库接口');
      await page.getByLabel('内容', { exact: true }).fill('token-123');
      await page.getByRole('button', { name: '保存密钥' }).click();
      await expect(page.locator('.secret-card')).toContainText('{密钥:仓库接口}');
      await page.getByRole('button', { name: '复制引用' }).click();
      await expect.poll(copied).toEqual(['{密钥:仓库接口}']);
      notes.push(`「复制引用」写进剪贴板的内容：${(await copied()).join('、')}`);
    },
  },
  {
    id: 'V18',
    title: '打印结果通知 · 列表 + 编辑卡片',
    points: '接口行、编辑卡片、事件开关',
    setup: async ({ page }) => {
      await openConfig(page, '打印结果通知');
      await page.getByRole('button', { name: /添加接口/ }).click();
      await page.getByLabel('名称', { exact: true }).fill('ERP');
      await page.getByLabel('地址', { exact: true }).fill('https://erp.example.com/hooks/labels');
      await page.getByRole('button', { name: '保存接口' }).click();
      await page.getByRole('button', { name: /添加接口/ }).click();
      await page.getByLabel('名称', { exact: true }).fill('群机器人');
    },
  },
  {
    id: 'V19',
    title: '打印结果通知 · 发送记录',
    points: '表格列宽、状态颜色（等待 / 已送达 / 失败）、立即重试按钮',
    setup: async ({ page }) => {
      const server = await startServer((_request, response) => {
        response.statusCode = 200;
        response.end('ok');
      });
      try {
        await openConfig(page, '打印结果通知');
        for (const [name, address] of [
          ['本机测试接口', `${server.origin}/hooks`],
          ['连不上的接口', `${UNREACHABLE_ORIGIN}/hooks`],
        ] as const) {
          await page.getByRole('button', { name: /添加接口/ }).click();
          await page.getByLabel('名称', { exact: true }).fill(name);
          await page.getByLabel('地址', { exact: true }).fill(address);
          await page.getByRole('button', { name: '保存接口' }).click();
        }
        await expect(page.locator('.webhook-card')).toHaveCount(2);
        for (const button of await page.getByRole('button', { name: '发送测试' }).all()) {
          await button.click();
        }
        await expect(page.locator('.delivery-state--delivered')).toBeVisible({ timeout: DELIVERY_TIMEOUT_MS });
        await expect(page.locator('.delivery-state--pending')).toBeVisible({ timeout: DELIVERY_TIMEOUT_MS });
        await page
          .getByRole('region', { name: `发送记录（最近 ${RECENT_DELIVERY_COUNT} 条）` })
          .getByRole('button', { name: '刷新' })
          .click();
      } finally {
        await server.close();
      }
    },
  },
  {
    id: 'V20',
    title: '语音播报 / 通用 / 关于',
    points: '与现有内容一致，标签列 120px 对齐',
    shots: ['语音播报', '通用', '关于'].map((name) => ({ label: name, prepare: ({ page }) => openConfig(page, name) })),
  },
  {
    id: 'V21',
    title: '未保存确认框',
    points: '居中、宽 400px、遮罩、默认焦点在「继续编辑」',
    setup: async ({ page, notes }) => {
      await openConfig(page, '模板');
      await page.getByRole('button', { name: '复制' }).click();
      await page.locator('.template-form').getByLabel('模板名称').fill('改过的名字');
      await page.getByRole('navigation', { name: '配置' }).getByRole('button', { name: '识别规则' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      const width = await dialog.evaluate((el) => el.getBoundingClientRect().width);
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
      notes.push(`确认框宽 ${Math.round(width)}px；默认焦点：「${focused}」`);
    },
  },
  {
    id: 'V22',
    title: '配置中心扫码 · 规则页',
    points: '扫码内容进入试一试，结果出现；没有打印',
    setup: async (ctx) => {
      await useFakePrinter(ctx);
      await openConfig(ctx.page, '识别规则');
      await blurActiveElement(ctx.page);
      await typeLikeScanner(ctx.page, ['CL5640-TK-图片色-XL']);
      await expect(ctx.page.locator('.rule-tester__result')).toContainText('命中');
      ctx.notes.push(`打印调用次数：${await ctx.printCalls?.()}`);
    },
  },
  {
    id: 'V23',
    title: '配置中心扫码 · 其他页',
    points: '胶囊闪烁、播报；没有打印、设置没被改动',
    shots: [
      {
        label: '扫码后「配置中不打印」闪烁',
        prepare: async ({ page, notes, printCalls }) => {
          await blurActiveElement(page);
          await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
          await expect(page.locator('.config-pill--flash')).toBeVisible();
          const dedup = await page.getByLabel('防重复打印').inputValue();
          notes.push(`扫码后：打印调用次数 ${await printCalls?.()}，「防重复打印」仍是 ${dedup} 秒`);
        },
      },
    ],
    setup: async (ctx) => {
      await useFakePrinter(ctx);
      await openConfig(ctx.page, '通用');
    },
  },
  {
    id: 'V24',
    title: '键盘操作',
    points: 'Tab 顺序：返回 → 导航 → 内容 → 操作条；所有可交互元素有清晰的焦点框（2px --color-ink）',
    sizes: [SIZE_1280],
    setup: async ({ page, notes }) => {
      await openConfig(page, '通用');
      await page.getByRole('button', { name: '返回工作台' }).focus();
      const order: string[] = [];
      for (let i = 0; i < TAB_ORDER_STEPS; i += 1) {
        order.push(
          await page.evaluate((length) => {
            const el = document.activeElement;
            const label = (el?.textContent || el?.getAttribute('aria-label') || '').trim().slice(0, length);
            return el ? `${el.tagName.toLowerCase()}「${label}」` : '';
          }, FOCUS_LABEL_LENGTH),
        );
        await page.keyboard.press('Tab');
      }
      notes.push(`Tab 顺序（从「返回工作台」开始）：${order.join(' → ')}`);
    },
    shots: [
      {
        label: '焦点在导航项',
        prepare: async ({ page }) =>
          page.getByRole('navigation', { name: '配置' }).getByRole('button', { name: '通用' }).focus(),
      },
      { label: '焦点在数字输入框', prepare: async ({ page }) => page.getByLabel('防重复打印').focus() },
      {
        label: '焦点在按钮',
        prepare: async ({ page }) => {
          // 日志在「关于」里。
          await openConfig(page, '关于');
          await page.getByRole('button', { name: '打开日志目录' }).focus();
        },
      },
    ],
  },
  {
    id: 'V25',
    title: 'macOS',
    points: '红绿灯区域、全屏时标题栏；配置中心快捷键显示 ⌘,；退出全屏后窗口回到进入全屏前的位置',
    sizes: [SIZE_1280],
    custom: async (ctx, record) => {
      const title = await ctx.page.locator('.config-button:not(.batch-button)').getAttribute('title');
      ctx.notes.push(`「配置」按钮的悬停提示：${title}`);
      if (process.platform !== 'darwin') {
        ctx.notes.push('不是 macOS：本项在 Mac 上复验');
        return;
      }
      // 挪离默认的居中位置：退出全屏后如果窗口被拉回默认位置，前后位置就对不上。
      const current = await ctx.window.evaluate((win) => win.getBounds());
      const workArea = await ctx.app.evaluate(
        ({ screen }, bounds) => screen.getDisplayMatching(bounds).workArea,
        current,
      );
      await ctx.window.evaluate((win, { x, y }) => win.setPosition(x, y), {
        x: workArea.x + OFF_CENTER_PX,
        y: workArea.y + OFF_CENTER_PX,
      });
      const before = await waitForStableBounds(ctx.window);
      try {
        for (const fullScreen of [false, true]) {
          await setFullScreen(ctx.window, fullScreen);
          await waitForStableBounds(ctx.window);
          await ctx.page.waitForTimeout(SETTLE_MS);
          const sourceId = await ctx.window.evaluate((win) => win.getMediaSourceId());
          const windowId = sourceId.split(':')[1] ?? '';
          const file = join(OUT_DIR, `V25-window-${fullScreen ? 'fullscreen' : 'normal'}.png`);
          try {
            await promisify(execFile)('screencapture', ['-x', '-o', `-l${windowId}`, file]);
            await record(
              fullScreen ? '全屏（系统窗口截图）' : '窗口（系统窗口截图，含红绿灯）',
              sizeLabel(SIZE_1280),
              await readFile(file),
              [],
            );
          } catch (error) {
            ctx.notes.push(`系统窗口截图失败：${String(error)}`);
            await record(
              fullScreen ? '全屏（页面截图）' : '窗口（页面截图）',
              sizeLabel(SIZE_1280),
              await capturePng(ctx.window),
              [],
            );
          }
        }
      } finally {
        await setFullScreen(ctx.window, false);
      }
      const after = await waitForStableBounds(ctx.window);
      const isSame = isSameRectangle(before, after);
      ctx.notes.push(
        `进入全屏前窗口 ${formatBounds(before)}，退出全屏后 ${formatBounds(after)}：${isSame ? '一致' : '不一致'}`,
      );
    },
  },
  {
    id: 'V26',
    title: '常用备注页',
    points: '说明卡片、多行备注照原样显示、添加按钮计数与禁用状态；从工作台「管理常用备注…」直达',
    setup: async ({ page }) => {
      await callApi(page, 'updateSettings', { notePresets: ['样衣间 {日期}', '返修\n第二行：{订单号}'] });
      await page.reload();
      await page.getByRole('combobox', { name: '备注' }).selectOption({ label: '管理常用备注…' });
      await expect(page.getByRole('heading', { level: 1, name: '常用备注' })).toBeVisible();
    },
  },
  {
    id: 'V27',
    title: '通用页 / 关于页的更新',
    points: '各行控件对齐；调小记录上限时的确认条；「关于」里的更新状态文字与「检查更新」',
    setup: async ({ page, window, notes }) => {
      await addJobs(page, HISTORY_LIMIT_RANGE.min + EXTRA_JOBS_OVER_LIMIT);
      await page.reload();
      // 软件更新在「关于」里。开发版不检查更新：页面读到初始状态之后，再模拟一次「已是最新版本」。
      await openConfig(page, '关于');
      await expect(page.getByText('开发版不检查更新')).toBeVisible();
      await pushUpdateStatus(window, { state: 'up-to-date', checkedAt: Date.now() });
      await expect(page.getByText(/已是最新版本/)).toBeVisible();
      await openConfig(page, '通用');
      const limit = page.getByLabel('打印记录保留');
      await limit.fill(String(HISTORY_LIMIT_RANGE.min));
      await limit.press('Enter');
      await expect(page.locator('.confirm-row')).toBeVisible();
      notes.push(`确认条：${await page.locator('.confirm-row p').textContent()}`);
    },
  },
  {
    id: 'V28',
    title: '工作台 · 正在查询',
    points: '预览超过 200ms 未返回时状态条显示「正在查询…」，上一张预览保持不闪',
    shots: [
      {
        label: '正在查询',
        prepare: async ({ page, notes }) => {
          slowScanCount += 1;
          await scan(page, `CL5640_${slowScanCount}`);
          await expect(page.locator('.status-strip__title')).toHaveText('正在查询…');
          const usage = `查询中工具条仍是上一张：${await page.locator('.preview-toolbar__usage').textContent()}`;
          if (!notes.includes(usage)) {
            notes.push(usage);
          }
        },
      },
    ],
    // 走真实的路径：一条带 HTTP 查询步骤的规则，查询本机一个故意慢返回的接口。
    setup: async (ctx) => {
      const server = await startServer((_request, response) => {
        const timer = setTimeout(() => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ shelf: 'A-01' }));
        }, SLOW_QUERY_DELAY_MS);
        response.on('close', () => clearTimeout(timer));
      });
      ctx.cleanups.push(server.close);
      const created = await callApi(ctx.page, 'createRule', 'delimited');
      if (!created.ok) {
        throw new Error(`createRule failed: ${created.issue}`);
      }
      const lookupShelf: HttpStep = {
        kind: 'http',
        method: 'GET',
        url: `${server.origin}/shelf?code={字段1}`,
        headers: [],
        body: '',
        timeoutMs: STEP_LIMITS.timeoutMs.max,
        // 不缓存：每次扫码都真的去查。
        cacheSeconds: STEP_LIMITS.cacheSeconds.min,
        outputs: [{ path: 'shelf', field: '货架' }],
        onError: 'empty',
      };
      const saved = await callApi(ctx.page, 'saveRule', {
        ...created.rule,
        name: '慢查询（下划线 + 货架）',
        steps: [lookupShelf],
      });
      if (!saved.ok) {
        throw new Error(`saveRule failed: ${saved.issue}`);
      }
      // 先扫一张不用查询的样衣码，作为「上一张预览」。
      await scan(ctx.page, 'CL5640-TK-图片色-XL');
      await expect(ctx.page.locator('.preview-toolbar__usage')).toHaveText('规则：横杠三段（编码-颜色-尺码）');
    },
  },
  {
    id: 'V29',
    title: '模板编辑 · 字段名候选；识别规则 · 单条导出',
    points: '字段名输入框弹出候选列表；规则卡片「导出」按钮位置',
    sizes: [SIZE_1280],
    shots: [
      {
        label: '字段名输入框（候选列表由系统绘制，截图里看不到，候选内容见备注）',
        prepare: async ({ page, notes }) => {
          await openConfig(page, '模板');
          if ((await page.locator('.template-editing').count()) === 0) {
            await page.locator('.template-item', { hasText: '通用（二维码在左）' }).click();
            await page.getByRole('button', { name: '复制' }).click();
          }
          // 字段名输入框在「指定字段」的字段行里。
          await page.locator('.template-form').getByText('指定字段', { exact: true }).click();
          const input = page.locator('.slot-card').first().getByLabel('字段名');
          await input.scrollIntoViewIfNeeded();
          await input.focus();
          const options = await page.evaluate(() =>
            [...document.querySelectorAll('#field-name-suggestions option')].map(
              (option) => (option as HTMLOptionElement).value,
            ),
          );
          notes.push(`字段名候选：${options.join('、')}`);
        },
      },
      {
        label: '规则卡片的「导出」',
        prepare: async ({ page }) => {
          await page
            .locator('.config-actions')
            .getByRole('button', { name: /放弃修改|返回列表/ })
            .click();
          await openConfig(page, '识别规则');
          if ((await page.getByRole('button', { name: '导出', exact: true }).count()) === 0) {
            await page.getByRole('button', { name: '新建规则' }).click();
            await page.locator('.config-actions').getByRole('button', { name: '返回列表' }).click();
          }
        },
      },
    ],
  },
  {
    id: 'V30',
    title: '跳转链接',
    points: '§5.9 四处文案的链接样式；有未保存修改时点链接先弹确认',
    sizes: [SIZE_1280],
    shots: [
      {
        label: '工作台状态条 · 没有匹配的识别规则',
        prepare: async ({ page }) => {
          await openConfig(page, '识别规则');
          await page.getByLabel('启用「原样打印」').click();
          await expect(page.getByLabel('启用「原样打印」')).not.toBeChecked();
          await page.getByRole('button', { name: '返回工作台' }).click();
          await scan(page, 'hello world');
          await expect(page.getByRole('button', { name: '打开「识别规则」' })).toBeVisible();
        },
      },
      {
        label: '加工步骤 · 查找表：还没有表格的链接',
        prepare: async ({ page }) => {
          await page.getByRole('button', { name: '打开「识别规则」' }).click();
          await page.getByRole('button', { name: '新建规则' }).click();
          await page.getByLabel('要添加的步骤类型').selectOption({ label: '查找表' });
          await page.getByRole('button', { name: /添加步骤/ }).click();
          await page.getByRole('button', { name: '「查找表」页' }).scrollIntoViewIfNeeded();
        },
      },
      {
        label: '加工步骤 · HTTP 查询：密钥的链接',
        prepare: async ({ page }) => {
          await page.getByLabel('要添加的步骤类型').selectOption({ label: 'HTTP 查询' });
          await page.getByRole('button', { name: /添加步骤/ }).click();
          await page.getByRole('button', { name: '去「密钥」页添加' }).scrollIntoViewIfNeeded();
        },
      },
      {
        label: '有未保存的修改时点链接',
        prepare: async ({ page }) => {
          await page.getByRole('button', { name: '去「密钥」页添加' }).click();
          await expect(page.getByRole('alertdialog')).toBeVisible();
        },
      },
      {
        label: '通知接口 · 签名密钥的链接',
        prepare: async ({ page }) => {
          await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
          await openConfig(page, '打印结果通知');
          await page.getByRole('button', { name: /添加接口/ }).click();
        },
      },
    ],
  },
  {
    id: 'V31',
    title: '标题栏 · 有待安装的更新',
    points: '「新版本已就绪」胶囊、「配置」按钮、打印机胶囊三者的顺序和间距',
    setup: async ({ page, window }) => {
      await pushUpdateStatus(window, { state: 'ready', version: '1.0.2' });
      await expect(page.locator('.update-pill')).toBeVisible();
    },
  },
  {
    id: 'V32',
    title: '标题栏 · 手机扫码按钮与浮层',
    points:
      '「手机扫码」按钮在「配置」和打印机胶囊之间，同高、同样式，状态点随会话变化；浮层挂在按钮下方，不遮挡扫码框；二维码、有效期、手机列表、操作按钮完整显示，无横向滚动',
    setup: async (ctx) => {
      const relay = await startLocalRelay();
      ctx.cleanups.push(relay.stop);
      mobileRelay = relay;
      mobilePhone = null;
      await callApi(ctx.page, 'updateSettings', {
        mobileRelayUrl: relay.baseUrl,
        paperPrinters: { '60x40': FAKE_PRINTER },
      });
      await ctx.page.reload();
      ctx.cleanups.push(async () => mobilePhone?.session.stop());
    },
    shots: [
      {
        label: '按钮常态',
        prepare: async ({ page }) => {
          if (await page.getByRole('dialog', { name: '手机扫码' }).isVisible()) {
            await page.keyboard.press('Escape');
          }
          await page.locator('.title-bar__name').hover();
        },
      },
      {
        label: '浮层 · 二维码（还没有手机加入）',
        prepare: async ({ page }) => {
          await page.getByRole('button', { name: '手机扫码' }).click();
          await expect(page.getByRole('img', { name: '手机扫码的二维码' })).toBeVisible();
        },
      },
      {
        label: '浮层 · 一部手机已加入',
        prepare: async ({ page }) => {
          if (!mobilePhone && mobileRelay) {
            const status = await callApi(page, 'getMobileStatus');
            if (status.state === 'active') {
              mobilePhone = await connectTestPhone(mobileRelay, status.url, 'iPhone · 微信');
            }
          }
          await expect(page.locator('.mobile-phone__device')).toHaveText(['iPhone · 微信']);
        },
      },
    ],
  },
  {
    id: 'V33',
    title: '通用 · 手机扫码中转地址',
    points: '「通用」里「手机扫码」卡片：中转地址输入框和「恢复默认」一行；说明文字不截断；格式不对时的提示',
    shots: [
      {
        label: '默认',
        prepare: async ({ page }) => {
          if ((await page.getByLabel('中转地址').count()) === 0) {
            await openConfig(page, '通用');
          }
          await page.getByLabel('中转地址').fill('');
          await blurActiveElement(page);
        },
      },
      {
        label: '地址格式不对',
        prepare: async ({ page }) => {
          await page.getByLabel('中转地址').fill('http://relay.example.com/');
          await page.getByLabel('中转地址').press('Enter');
          await expect(page.getByRole('alert')).toBeVisible();
        },
      },
    ],
  },
  {
    id: 'V34',
    title: '工作台 · 扫码框内容、手动编辑模式与提醒',
    points:
      'Windows 上扫码框是透明密码框盖在文字层上（关掉输入法）：多行码的换行显示为 ⏎；光标和选区画在真实位置（方向键移动光标、双击全选看得见）；内容比框长时光标留在看得见的范围里；点进扫码框进入手动编辑模式（普通输入框、虚线边框、边框上方有「手动输入 · 回车提交 · Esc 返回扫码」）；输入法截走扫码枪按键又拼不回来时，扫码条下方出现提醒，不遮挡预览',
    setup: async (ctx) => {
      if (process.platform === 'darwin') {
        ctx.notes.push(
          'macOS 上扫码框始终是普通输入框，没有手动编辑模式：「双击全选」「手动编辑模式」两张和普通状态相同。',
        );
      }
    },
    shots: [
      {
        label: '多行码（⏎）',
        prepare: async ({ page }) => {
          // 上一种尺寸停在手动编辑模式：按 Esc 回到扫码模式，这几张截的是扫码模式的文字层。
          if ((await page.locator('.scan-bar__field--manual').count()) > 0) {
            await page.locator('.scan-bar__input').press('Escape');
          }
          await page.locator('.scan-bar__input').fill('编码：CL5887⏎颜色：灰色⏎尺码：M');
        },
      },
      {
        label: '超长内容显示末尾',
        prepare: async ({ page }) => {
          await page
            .locator('.scan-bar__input')
            .fill('https://example.com/order/2026092900012345678?sku=CL5887-灰色-M&batch=A-2-10-1');
        },
      },
      {
        label: '方向键把光标移到中间',
        prepare: async ({ page }) => {
          const input = page.locator('.scan-bar__input');
          await input.fill('CL5887-灰色-M');
          await input.press('Home');
          await input.press('ArrowRight');
          await input.press('ArrowRight');
          await expect(page.locator('.scan-bar__text')).toHaveText('CL5887-灰色-M');
        },
      },
      {
        label: '双击全选（进入手动编辑）',
        prepare: async ({ page }) => {
          const input = page.locator('.scan-bar__input');
          await input.dblclick();
          // 双击也是点进扫码框：Windows 上进入手动编辑模式，全选显示在普通输入框里。
          const selection = await input.evaluate((element: HTMLInputElement) => [
            element.selectionStart,
            element.selectionEnd,
          ]);
          expect(selection).toEqual([0, 'CL5887-灰色-M'.length]);
        },
      },
      {
        label: '手动编辑模式',
        prepare: async ({ page }) => {
          const input = page.locator('.scan-bar__input');
          await input.fill('');
          // 鼠标点进扫码框：Windows 上换成普通输入框（输入法可用），虚线边框和「手动输入」说明。
          await input.click();
          await page.keyboard.type('CL5887-M');
          await expect(input).toHaveAttribute('type', 'text');
        },
      },
      {
        label: '输入法截走扫码、拼不回来的提醒',
        prepare: async ({ page }) => {
          const input = page.locator('.scan-bar__input');
          // 输入法开着时扫码枪飞快地按了一串键，没有结尾的回车：拼不回来，不提交，提醒操作员。
          await input.evaluate((element: HTMLInputElement) => {
            // 先建好再派发：事件的 timeStamp 是创建的时间，边建边派发时 CI 忙起来会被当成几串（见 app.e2e.ts）。
            const events = ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE'].map(
              (code) => new KeyboardEvent('keydown', { key: 'Process', code, bubbles: true, cancelable: true }),
            );
            for (const event of events) {
              element.dispatchEvent(event);
            }
          });
          await expect(page.locator('.scan-bar__ime')).toBeVisible();
        },
      },
    ],
  },
  {
    id: 'V35',
    title: '配置中心 · 打印机',
    points:
      '顶部「纸张 → 打印机」表每种纸一行，下拉框完整显示打印机名；没有可用打印机的纸标红，旁边有「建议：…」按钮；没在用的内置面单的纸（76×130）列出来但不标红；下面每台打印机显示状态（缺纸的红点和「缺纸」）、「负责：…」、驱动纸张（对不上时的提醒和「打开打印首选项」）；没负责纸张的打印机只显示驱动纸张；标题栏胶囊显示出问题的那一台',
    launch: { fakePrinters: PAPER_PRINTERS },
    setup: async ({ page }) => {
      await saveCopyOnPaper(page, '极兔面单', { widthMm: 100, heightMm: 180 });
      await saveCopyOnPaper(page, '顺丰面单', { widthMm: 100, heightMm: 150 }, '面单机B');
      await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' } });
      await page.reload();
      await openConfig(page, '打印机');
      // 60×40、100×180、100×150，加上内置一联面单的 76×130（没在用：列出来但不标红）。
      await expect(page.locator('.paper-row')).toHaveCount(4);
      await expect(page.locator('.paper-row', { hasText: '76×130' })).not.toHaveClass(/paper-row--missing/);
      await expect(page.locator('.printer-chip')).toHaveText('面单机B（缺纸）');
    },
  },
  {
    id: 'V36',
    title: '模板编辑器 · 纸张和打印机',
    points:
      '「基本」区的纸张尺寸下拉框（预设名带适用的快递）、自定义时的宽和高两个输入框、打印机下拉框（「按纸张分配（当前是 …）」、指定的打印机不在这台电脑上时标明）；换纸张后右侧预览的软尺跟着变；模板列表只在纸张不是默认、或模板自己指定了打印机时，才在名字下面写纸张和实际会用的打印机',
    launch: { fakePrinters: PAPER_PRINTERS },
    setup: async ({ page }) => {
      await saveCopyOnPaper(page, '旧电脑的面单', { widthMm: 100, heightMm: 180 }, '旧电脑上的打印机');
      await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x180': '面单机C' } });
      await page.reload();
    },
    shots: [
      {
        label: '面单预设 · 指定的打印机不在这台电脑上',
        prepare: async ({ page }) => {
          // 每种尺寸都从头打开这个模板：上一张截图改过草稿（自定义尺寸、按纸张分配）。
          await page.reload();
          await expect(page.locator('.scan-bar__input')).toBeFocused();
          await openConfig(page, '模板');
          await page.locator('.template-item', { hasText: '旧电脑的面单' }).click();
          await page.getByRole('button', { name: '编辑' }).click();
          const form = page.locator('.template-form');
          await form
            .getByLabel('纸张尺寸')
            .selectOption({ label: '100×180 二联面单 · 申通、极兔、中通、圆通、韵达、顺丰、EMS' });
          await expect(form.getByLabel('打印机').locator('option:checked')).toHaveText(
            '旧电脑上的打印机（这台电脑上没有）',
          );
        },
      },
      {
        label: '自定义尺寸 · 按纸张分配',
        prepare: async ({ page }) => {
          const form = page.locator('.template-form');
          await form.getByLabel('纸张尺寸').selectOption({ label: '自定义…' });
          await form.getByLabel('纸张宽').fill('88');
          await form.getByLabel('纸张高').fill('55');
          await form.getByLabel('打印机').selectOption('');
          await blurActiveElement(page);
          await expect(page.locator('.template-editing .ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 88 /);
        },
      },
    ],
  },
  {
    id: 'V37',
    title: '非 60×40 的预览',
    points: '50×30、100×100 两种纸：软尺刻度是实际毫米数，标签框比例正确；二维码和字号放得下，没有被裁掉',
    launch: { fakePrinters: PAPER_PRINTERS },
    shots: [
      {
        label: '50×30 标签',
        prepare: async ({ page }) => {
          const id = await saveCopyOnPaper(page, '小标签', { widthMm: 50, heightMm: 30 });
          await callApi(page, 'updateSettings', { activeTemplateId: id, autoPrint: false, paperPrinters: {} });
          await page.reload();
          // 只有「整段内容」规则认得：用当前模板（规则没指定模板）。
          await scan(page, '订单 A20260929001 小标签');
          // 等扫码结果：「规则：」只在扫码之后出现。
          await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：原样打印');
          await expect(page.locator('.ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 50 /);
        },
      },
      {
        label: '100×100 标签',
        prepare: async ({ page }) => {
          const id = await saveCopyOnPaper(page, '箱唛', { widthMm: 100, heightMm: 100 });
          await callApi(page, 'updateSettings', { activeTemplateId: id, autoPrint: false, paperPrinters: {} });
          await page.reload();
          await scan(page, '订单 A20260929001 箱唛');
          await expect(page.locator('.preview-toolbar__usage')).toHaveText('规则：原样打印');
          await expect(page.locator('.ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 100 /);
        },
      },
    ],
  },
  {
    id: 'V38',
    title: '配置中心 · 本机接口',
    points:
      '状态（正在运行 / 已自动换端口：跳过的端口、占用的程序和新端口）、地址列表（等宽字体，可以选中）、局域网访问开关、端口输入框和「恢复默认」；程序密钥列表（名称、最后使用、改名、撤销）；刚生成的密钥单独一块，原文完整显示，旁边「复制」「完成」；已授权的网站和「撤销」；最后一段隐私说明',
    launch: { fakePrinters: PAPER_PRINTERS },
    setup: async ({ page }) => {
      await callApi(page, 'createApiKey', 'ERP 服务器');
      await callApi(page, 'createApiKey', '仓库面单机');
      await callApi(page, 'updateSettings', { apiAuthorizedOrigins: ['https://erp.example.com'] });
    },
    shots: [
      {
        label: '正在运行 · 刚生成的密钥',
        prepare: async ({ page }) => {
          // 每种尺寸都从默认端口、没有新密钥开始：上一张截图占了端口，上一轮生成过密钥。
          await callApi(page, 'updateSettings', { apiPort: null });
          for (const key of await callApi(page, 'listApiKeys')) {
            if (key.name === '门店收银') {
              await callApi(page, 'removeApiKey', key.id);
            }
          }
          await page.reload();
          await expect(page.locator('.scan-bar__input')).toBeFocused();
          await openConfig(page, '本机接口');
          await expect(page.locator('.api-status').first()).toHaveText('正在运行');
          await page.getByLabel('名称', { exact: true }).fill('门店收银');
          await page.getByRole('button', { name: '生成密钥' }).click();
          await expect(page.getByLabel('新密钥')).toHaveValue(/^lf_/);
          await blurActiveElement(page);
        },
      },
      {
        label: '端口被占用 · 已自动换端口',
        prepare: async (ctx) => {
          takenPort ??= await occupyPort(ctx);
          // 在页面上填：经 IPC 改的设置不会推给界面，输入框会和实际不一致。
          await ctx.page.getByLabel('端口', { exact: true }).fill(String(takenPort));
          await blurActiveElement(ctx.page);
          await expect(ctx.page.locator('.api-status').first()).toHaveText('正在运行（已自动换端口）');
        },
      },
    ],
  },
  waybillCase(
    'V39',
    '平台标准二联（通达系）',
    '对照平台二联模板：横线在 15、30、40、55、67、89、120、130mm，三段码右侧虚线竖线、存根竖线在 70mm；运单条码约 84mm 宽、号码在下方居中；「集」只在有集包地时印；156mm 处「已验视」靠右；文字都在格子里、没有被裁掉',
  ),
  waybillCase(
    'V40',
    '平台标准一联（通达系）',
    '对照平台一联模板：横线在 12、21、37、43.6、48.7、69、79mm，左列到 58mm，右侧竖排条码；「集」「末」「虚拟号码」三个反白标记各在自己的格子里；「标准快递」折成两行；103mm 处「已验视」靠右',
  ),
  waybillCase(
    'V41',
    '顺丰二联',
    '对照平台顺丰模板：横线在 15、40、55、70.6、82.6、92、123、131.5、140mm，条码右侧竖线在 75mm、时效格下边在 25mm；托寄物一块竖线在 20、26、80mm，103mm 有横线；存根竖线在 80mm；174mm 处「已验视」',
  ),
  waybillCase(
    'V42',
    '顺丰 100×150',
    '对照平台顺丰 100×150 模板：虚线在 12、35、45、55、81、98mm，收件人和二维码之间的虚线竖线在 66mm，寄件人下面不画线；城市代码 / 出港码 / 产品类型一行三格对齐',
  ),
  waybillCase(
    'V43',
    '德邦二联',
    '对照平台德邦模板：4×2 路由格的竖线在 25、50、75mm，横线在 15、29、43、65.3、72.1、88.3、99.8、120、130mm；打印时间和末端码之间竖线在 71mm；存根竖线在 70mm；156mm 处「已验视」',
  ),
  {
    id: 'V44',
    title: '模板 · 自由设计 · 吊牌示例',
    points:
      '编码大字、颜色尺码表格（格线对齐、字在格内）、Code128 和号码、二维码、分隔线、货架号和日期都在纸内，没有被裁',
    setup: async ({ page }) => {
      await scan(page, 'CL5640-TK-图片色-XL');
      await openConfig(page, '模板');
      await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
    },
  },
  {
    id: 'V60',
    title: '批量打印 · 刚打开',
    points:
      '页头「← 返回工作台」和标题「批量打印」；五段（模板、数据、对列、序号与份数、预览）自上而下，没有数据时预览段只有一句说明；底部操作条「打印 0 张」灰掉；标题栏「批量打印」是按下状态，「配置」不是；1024 宽时标题栏不换行、不溢出',
    launch: { fakePrinters: BATCH_PRINTERS },
    setup: async ({ page }) => {
      await openBatchPage(page);
    },
  },
  {
    id: 'V61',
    title: '批量打印 · 导入后的对列和预览',
    points:
      '数据行「batch.csv · 12 行 · 4 列」；对列表里 {货架号} 标红并说明可以不填；第 5 行（缺颜色）整行标黄、悬停能看到「缺：颜色」；表头固定，列多时表格自己横向滚动、页面不变宽；右侧是当前行的真实预览（吊牌），上方「上一张 / 下一张」；预览段顶部「共 12 行 · 打 12 张 · 1 行有问题（标黄）」；1024 宽时表格和预览上下排列',
    launch: { fakePrinters: BATCH_PRINTERS },
    setup: async ({ app, page, userData }) => {
      const path = join(userData, 'batch.csv');
      await writeFile(path, BATCH_CSV, 'utf8');
      await stubOpenDialog(app, path);
      await openBatchPage(page);
      // 工作台一直挂载在后面（只是不显示），同名的「模板」控件不止一个：只认批量打印页里的。
      await page
        .locator('.batch-page')
        .getByLabel('模板', { exact: true })
        .selectOption({ label: '吊牌（自由设计示例）' });
      await page.getByRole('button', { name: '选择文件…' }).click();
      await expect(page.getByText('batch.csv · 12 行 · 4 列')).toBeVisible();
      // 检查条码和排版期间汇总后面带着「正在检查…」：等它查完再截图。
      await expect(page.locator('.batch-preview__summary')).toHaveText('共 12 行 · 打 12 张 · 1 行有问题（标黄）');
      await page.getByRole('heading', { level: 2, name: '5 预览' }).scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'V62',
    title: '批量打印 · 暂停中',
    points:
      '底部操作条：「已暂停（点继续接着打）· 已发送 n / 30 张」、进度条、「继续」（主按钮）「取消」；标题栏「批量打印」按钮上的进度「n/30」用等宽数字；提示条不盖住操作条',
    launch: { fakePrinters: BATCH_PRINTERS },
    setup: async ({ app, page }) => {
      await openBatchPage(page);
      await page.getByRole('button', { name: '只按序号打' }).click();
      await page.getByLabel('张数').fill(String(BATCH_SERIAL_COUNT));
      await page.getByRole('button', { name: `打印 ${BATCH_SERIAL_COUNT} 张` }).click();
      // 进度是合并推送的，文字可能跳过某个数：按假打印机实际收到的张数等。
      await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: '暂停' }).click();
      await expect(page.locator('.batch-actions').getByRole('status')).toContainText('已暂停');
    },
  },
  {
    id: 'V63',
    title: '标题栏 · 批量打印按钮的进度数字很长',
    points:
      '一批 2 万张、打到 19999 张时，标题栏「批量打印」按钮上的「19999/20000」不换行、不挤出标题栏；1024 宽时同样不溢出',
    sizes: [SIZE_1024, SIZE_1280],
    setup: async ({ page, window }) => {
      await pushBatchStatus(window, {
        batchId: '20261002-143501-a1b2',
        state: 'running',
        total: 20000,
        sent: 19999,
        failed: 0,
        pauseReason: null,
        failures: [],
        templateName: '通用',
        tableId: null,
        isActive: true,
      });
      await expect(page.getByRole('button', { name: '批量打印' })).toContainText('19999/20000');
    },
  },
  {
    id: 'V45',
    title: '模板 · 自由设计 · 设计器（1280px）',
    points:
      '画布优先：左边竖排 7 个元素图标（图标下两三个字）、中间画布、右边检查器（「条码 / 排列 / 图层」分段标签）；上面一条窄栏（预览内容、网格、吸附、?）；画布左上角撤销重做、右下角缩放胶囊；画布有毫米标尺、1mm 网格、1.5mm 安全区虚线；选中的条码有蓝色选框、圆角控制点和下方的旋转手柄，上方浮动工具条；画布就是打印的样子（Code128、二维码、表格格线）；底部一条「没有发现问题」，操作条有「打印一张试试」',
    sizes: [SIZE_1280],
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
      await selectLayer(page, '编码条码（条码）');
    },
  },
  {
    id: 'V46',
    title: '模板 · 自由设计 · 设计器（1024px）',
    points:
      '没有横向滚动；检查器收窄到 260px 仍放得下标签和数字框、分段标签不换行；窄栏一行放下；画布缩到放得下整张标签；浮动工具条不出画布区；选中的文字检查器里「内容」框完整',
    sizes: [SIZE_1024],
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
      await selectLayer(page, '编码（文字）');
    },
  },
  {
    id: 'V47',
    title: '模板 · 自由设计 · 多选和放大（1920px）',
    points:
      'Shift 多选三个文字：每个都有选框、没有控制点，外面一圈合起来的虚线框；检查器「排列」写「已选 3 个元素」，等距按钮可用；浮动工具条是对齐和等距；放大一档后画布出现滚动条，标尺和网格跟着放大、不糊',
    sizes: [SIZE_1920],
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
      await selectLayer(page, '编码（文字）');
      await inspectorOf(page).getByRole('tab', { name: '图层' }).click();
      const layers = page.getByRole('list', { name: '图层' });
      await layers.getByRole('button', { name: '货架号（文字）' }).click({ modifiers: ['Shift'] });
      await layers.getByRole('button', { name: '日期（文字）' }).click({ modifiers: ['Shift'] });
      await inspectorOf(page).getByRole('tab').first().click();
      await page.getByRole('button', { name: '放大' }).click();
    },
  },
  {
    id: 'V48',
    title: '模板 · 自由设计 · 元素属性',
    points:
      '每种元素一张：标签列对齐、数字框带单位、开关和分段按钮不换行；文字有「内容」和「插入字段」；条码的码制下拉分「常用」「更多一维码」「更多二维码」，改成 EAN-13 后底部打印前检查写明原因；图片有「选择图片…」和阈值滑块；表格有行高、列宽、加减行列和格子编辑',
    sizes: [SIZE_1280],
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
      const designer = page.getByRole('region', { name: '设计器' });
      await designer.getByRole('button', { name: '添加图片' }).click();
      await designer.getByRole('button', { name: '添加矩形' }).click();
    },
    shots: [
      { label: '文字', prepare: ({ page }) => selectLayer(page, '编码（文字）') },
      {
        label: '条码 · EAN-13 内容不合',
        prepare: async ({ page }) => {
          await selectLayer(page, '编码条码（条码）');
          await page.getByRole('region', { name: '设计器' }).getByLabel('码制').selectOption('ean13');
          await expect(page.getByRole('region', { name: '打印前检查' })).toContainText('条码「编码条码」');
        },
      },
      { label: '二维码', prepare: ({ page }) => selectLayer(page, '二维码 {完整内容}（二维码）') },
      { label: '图片', prepare: ({ page }) => selectLayer(page, '图片（图片）') },
      { label: '线', prepare: ({ page }) => selectLayer(page, '分隔线（线）') },
      { label: '矩形', prepare: ({ page }) => selectLayer(page, '矩形（矩形）') },
      { label: '表格', prepare: ({ page }) => selectLayer(page, '颜色尺码（表格）') },
    ],
  },
  {
    id: 'V49',
    title: '模板 · 设计器 · 画布优先的布局',
    points:
      '没选中时：左边竖排元素图标，画布在平静的灰底上、纸是带阴影的卡片；画布左上角撤销重做、右下角缩放胶囊；检查器「模板 / 图层」两页，纸张下拉写「60×40 标签 · 样衣标签」；底部一条「没有发现问题」；每个元素一圈浅色虚线；1024 宽和 1366 @150% 时没有横向滚动、标签整张可见、检查器不被裁',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
  },
  {
    id: 'V56',
    title: '模板 · 设计器 · 选中文字：浮动工具条和检查器',
    points:
      '选中的文字上方一条圆角浮动工具条（字号 −/数字/+、加粗、三个对齐、改字、复制一份、删除、锁定、置顶、置底、⋯），不盖住控制点和旋转手柄；检查器「文字」页：名称、内容、插入字段、字号；「排列」页 X/Y、宽/高两两一行、旋转、锁定、对齐到安全区和叠放图标；标尺上标出选中范围',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
    shots: [
      { label: '文字页', prepare: ({ page }) => selectLayer(page, '编码（文字）') },
      {
        label: '排列页',
        prepare: async ({ page }) => {
          await selectLayer(page, '编码（文字）');
          await inspectorOf(page).getByRole('tab', { name: '排列' }).click();
        },
      },
    ],
  },
  {
    id: 'V57',
    title: '模板 · 设计器 · 条码太窄：不印的标记和「放大到能印」',
    points:
      '条码框浅红底，框里写「条码不印：框不够宽」；浮动工具条有「绑定字段」下拉（「编码 — CL5640-TK」）和红色「放大到能印」；检查器最上面红色一条「条码「编码条码」不印：内容 CL5640-TK 至少要 …mm 宽（现在 20mm）」和按钮；底部一条「⚠ 1 项」加这一条',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
    shots: [{ label: '条码太窄', prepare: ({ page }) => narrowTagBarcode(page) }],
  },
  {
    id: 'V58',
    title: '模板 · 设计器 · 多选：合起来的外框和对齐',
    points:
      'Ctrl+A 全选：每个元素蓝框，外面一圈合起来的虚线框；浮动工具条是六个对齐、两个等距和复制、删除、锁定、叠放、⋯；检查器「排列」写「已选 N 个元素」和对齐、等距、叠放图标；标尺上标出整组的范围',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
    shots: [
      {
        label: '全选',
        prepare: async ({ page }) => {
          await page.locator('.canvas-overlay').focus();
          await page.keyboard.press('Control+a');
        },
      },
    ],
  },
  {
    id: 'V59',
    title: '模板 · 设计器 · 右键菜单',
    points:
      '右键选中的元素：页面里的圆角菜单（不是系统菜单），复制、粘贴（灰）、复制一份、删除，分隔线，置顶、上移一层、下移一层、置底，分隔线，锁定，多选时还有「对齐 ›」；右边一列快捷键按平台写；靠窗口边时菜单往回挪、不出窗口；第一项有焦点底色',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
    shots: [
      {
        label: '多选的右键菜单',
        prepare: async ({ page }) => {
          await page.locator('.canvas-overlay').focus();
          await page.keyboard.press('Control+a');
          const point = await canvasPoint(page, 20, 5);
          await page.mouse.click(point.x, point.y, { button: 'right' });
          await expect(page.getByRole('menu', { name: '元素菜单' })).toBeVisible();
        },
      },
    ],
  },
  {
    id: 'V64',
    title: '模板 · 设计器 · 图层和打印前检查',
    points:
      '「图层」页：每行种类图标、名字（没改过名的写内容摘要，例如「二维码 {完整内容}」）、隐藏和锁定按钮（开着的常亮，没开的淡）；隐藏的一行变淡、画布上看不到它；锁定的一行锁图标亮；底部打印前检查展开成清单，红的在前，点一项选中那个元素',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
      await narrowTagBarcode(page);
      await inspectorOf(page).getByRole('tab', { name: '图层' }).click();
      const layers = page.getByRole('list', { name: '图层' });
      await layers.getByRole('button', { name: '隐藏「日期」' }).click();
      await layers.getByRole('button', { name: '锁定「分隔线」' }).click();
      await page.getByRole('region', { name: '打印前检查' }).getByRole('button', { expanded: false }).click();
    },
  },
  {
    id: 'V65',
    title: '模板 · 设计器 · 就地改字和快捷键表',
    points:
      '双击文字：同字体、同字号、同对齐的白底输入框盖在文字上，蓝框，整段选中；快捷键表（F1）：编辑、选择、移动和叠放、视图四组，快捷键按平台写（Windows「Ctrl+Shift+]」），写着方向键 0.1mm、Shift 1mm，最下面说明画布不用字母数字做快捷键',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
    shots: [
      {
        label: '就地改字',
        prepare: async ({ page }) => {
          // 上一种尺寸留下的快捷键表盖在画布上：先关掉（焦点在它的「关闭」上，Esc 只关它）。
          if (await page.getByRole('dialog', { name: '快捷键' }).isVisible()) {
            await page.keyboard.press('Escape');
          }
          await selectLayer(page, '编码（文字）');
          const point = await canvasPoint(page, 10, 5);
          await page.mouse.dblclick(point.x, point.y);
          await expect(page.getByRole('textbox', { name: /就地改文字/ })).toBeFocused();
        },
      },
      {
        label: '快捷键表',
        prepare: async ({ page }) => {
          // 焦点在就地改字的输入框里：Esc 只放弃这次改字，不离开设计器。
          await page.keyboard.press('Escape');
          await page.locator('.canvas-overlay').focus();
          await page.keyboard.press('F1');
          await expect(page.getByRole('dialog', { name: '快捷键' })).toBeVisible();
        },
      },
    ],
  },
  {
    id: 'V66',
    title: '模板 · 设计器 · 拖动中：参考线、间距和尺寸标签',
    points:
      '按住二维码往左拖（吸附开着）：洋红参考线，和左边、上边邻居之间的间距线写着毫米数，两边相等时数字前有「=」；指针右下方深色小标签「X … Y … mm」；浮动工具条拖动时藏起来；标尺上一条指针细线和选中范围',
    sizes: DESIGNER_SIZES,
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
    },
    shots: [
      {
        label: '拖动中',
        prepare: async ({ page }) => {
          // 上一种尺寸留下的拖动还按着：Esc 取消（不提交），再松开。没有拖动时不按 Esc——没选中时 Esc 会回到模板列表。
          if ((await page.locator('.canvas-overlay__badge').count()) > 0) {
            await page.keyboard.press('Escape');
          }
          await page.mouse.up();
          const from = await canvasPoint(page, 51, 9);
          const to = await canvasPoint(page, 47, 10);
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 6 });
        },
      },
    ],
  },
  {
    id: 'V50',
    title: '模板库 · 全部',
    points:
      '左栏八项（全部 18、服装吊牌 3、价签 3、商品条码 3、鞋盒标 2、食品标签 2、珠宝 / 小商品 2、仓储 3），个数右对齐、等宽数字，「全部」是按下状态；右边「纸张」下拉和一行说明；缩略图网格：每张卡片缩略图框一样高、纸居中、有细边框，30×20 不放大，100×150 整张可见；名字、纸张和说明、「用这个模板」按钮在各卡片里对齐；1024 宽时少放几列、没有横向滚动；底部「18 个模板」「返回列表」；面包屑「模板 › 从模板库新建」',
    setup: async ({ page }) => {
      await openTemplateLibrary(page);
    },
  },
  {
    id: 'V51',
    title: '模板库 · 仓储（大纸张的缩略图）',
    points:
      '「仓储」按下；三张卡片：货架 / 库位标（100×100，库位号大字、Code128）、资产标签（50×30，反白标题、表格、二维码）、箱标（100×150，表格、条码、二维码、备注折行），缩略图都没有被裁；纸张下拉只有全部纸张、50×30mm、100×100mm、100×150mm',
    setup: async ({ page }) => {
      await openTemplateLibrary(page);
      await libraryCategory(page, '仓储').click();
    },
  },
  {
    id: 'V52',
    title: '模板库 · 按纸张筛选（40×30）',
    points: '「全部」下选 40×30mm：三张卡片（简洁价签、EAN-13 商品条码、小商品标），来自三个分类；底部「3 个模板」',
    setup: async ({ page }) => {
      await openTemplateLibrary(page);
      await page.getByRole('region', { name: '模板库' }).getByLabel('纸张').selectOption('40x30');
    },
  },
  {
    id: 'V53',
    title: '模板库 · 键盘焦点',
    points: '用 Tab 走到的分类按钮、「用这个模板」按钮都有清楚的焦点框，没有被卡片边框或网格裁掉',
    sizes: [SIZE_1280],
    setup: async ({ page }) => {
      await openTemplateLibrary(page);
    },
    shots: [
      {
        label: '分类按钮',
        prepare: async ({ page }) => {
          await libraryCategory(page, '全部').focus();
          await page.keyboard.press('Tab');
        },
      },
      {
        label: '「用这个模板」',
        prepare: async ({ page }) => {
          const buttons = page.getByRole('region', { name: '模板库' }).getByRole('button', { name: '用这个模板' });
          await buttons.nth(1).focus();
          await page.keyboard.press('Shift+Tab');
        },
      },
    ],
  },
  {
    id: 'V54',
    title: '模板库 · 用这个模板后进设计器',
    points:
      '复制「服装合格证」进设计器：画布是示例数据（反白「合 格 证」、参数表格线对齐、二维码、等级和安全类别、「零售价 ¥399.00」），工具条「预览内容 · 示例数据」；底部打印前检查「没有发现问题」；面包屑「编辑：服装合格证」；1024 宽时设计器同 V46',
    setup: async ({ page }) => {
      await openConfig(page, '模板');
      await useLibraryTemplate(page, '服装合格证');
    },
  },
  {
    id: 'V55',
    title: '模板库 · 逐个模板',
    points:
      '每个模板复制进设计器后的画布一张（示例数据）：所有文字、条码号码、表格、二维码都在纸内没有被裁；条码两侧留白、号码在条下居中；反白块的字在黑底中间；和缩略图一致；打印前检查「没有发现问题」',
    sizes: [SIZE_1280],
    setup: async ({ page }) => {
      await openConfig(page, '模板');
    },
    shots: TEMPLATE_LIBRARY.map(({ template }) => ({
      label: template.name,
      prepare: ({ page }) => useLibraryTemplate(page, template.name),
    })),
  },
  {
    id: 'V80',
    title: '打印机 · 标签机指令（认出 TSPL，已发送）',
    points:
      '「标签机A」一行右侧「测试页」「标签机指令」两个按钮同高，后者按下；下面展开浅底面板：指令集「自动（TSPL）」和一句认出的依据；浓度、速度、设置纸张（纸宽、纸高、纸张类型、间隙）、打印方向、出纸方式逐行对齐，TSPL 不显示分辨率；单向提示完整换行；「保存并发送」主按钮；四个动作按钮一行（窄时换行，不溢出）；绿色「设置已发出（TSPL）…」；1024 宽时面板不撑宽页面、没有横向滚动',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '标签机A');
      await panel.getByLabel('浓度').selectOption('8');
      await panel.getByLabel('速度').selectOption('4');
      // 用 page 作范围：对 getByRole('region', …) 这样按名字过滤出来的动态定位器再叠一层 filter({ has }) 不可靠
      // （Playwright 的已知限制），同一时间只有一台打印机的面板打开，用整页范围找这个开关没有歧义。
      await clickSwitch(page, '设置纸张');
      await panel.getByLabel('出纸方式').selectOption('tear');
      await panel.getByRole('button', { name: '保存并发送' }).click();
      await expect(panel.getByRole('status')).toContainText('设置已发出（TSPL）');
    },
  },
  {
    id: 'V81',
    title: '打印机 · 标签机指令（认不出）',
    points:
      '指令集「自动（认不出）」，下面一句说明从驱动名认不出、请手动选择或选「不发指令」；没有设置项；四个动作按钮灰掉，下面说明原因；面板高度随内容收拢，不留大块空白',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '家用打印机');
      await expect(panel.getByRole('button', { name: '纸张校准' })).toBeDisabled();
    },
  },
  {
    id: 'V82',
    title: '打印机 · 标签机指令（发送失败）',
    points:
      '指令集「自动（ZPL）」；浓度选项到 30；「分辨率」一行显示「按驱动（203dpi）」；红色提示说明驱动不接受直接发送的指令和下一步，完整换行、不被按钮遮住',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '面单机B');
      await panel.getByLabel('浓度').selectOption('10');
      await panel.getByRole('button', { name: '保存并发送' }).click();
      await expect(panel.getByRole('alert')).toContainText('驱动不接受直接发送的指令');
    },
  },
  {
    id: 'V83',
    title: '打印机 · 恢复出厂设置的二次确认',
    points:
      '模态对话框：标题「恢复出厂设置」、说明会回到出厂值、要重新校准、程序里保存的设置不变；「不恢复」是默认焦点的主按钮，「恢复出厂设置」是次要按钮；背后的页面变暗、不可操作',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '标签机A');
      await panel.getByRole('button', { name: '恢复出厂设置' }).click();
      await panel.getByRole('button', { name: '确认恢复出厂？' }).click();
      await expect(page.getByRole('alertdialog', { name: '恢复出厂设置' })).toBeVisible();
    },
  },
  {
    id: 'V84',
    title: '打印机 · 诊断 · 全部通过',
    points:
      '打印机行右侧「诊断」「测试页」并排、不换行；面板在行下面展开、占满整行；顶部「查完了：没发现问题，1 项待确认」和「重新检查」「打测试页」「收起」一行排开；六项依次是后台打印服务、打印机和驱动状态、USB 连接、打印队列、驱动纸张、指令集，标记分别是绿「通过」和橙「待确认」；指令集一项有「走一张纸」「纸张校准」「改指令集」；1024 宽时文字折行、不溢出',
    launch: { fakePrinters: diagnosisPrinters({}) },
    setup: async ({ page }) => {
      await openDiagnosisPanel(page);
    },
  },
  {
    id: 'V85',
    title: '打印机 · 诊断 · 发现问题',
    points:
      '红「有问题」的几项：驱动报告缺纸（下一步「装好标签纸…」、按钮「打开打印首选项」）、USB 没连上（下一步说换线换口）、队列卡住 3 个任务其中 1 个是本程序发的（「清除本程序的任务」「清除全部任务（需要管理员权限）」，Windows 上还有「打开打印队列」）、驱动纸张 100×150mm 不是 60×40mm（「自动设置驱动纸张（需要管理员权限）」，macOS 上没有括号）；按钮多时换行、和文字左对齐；顶部「查完了：4 项有问题，1 项待确认」',
    launch: {
      fakePrinters: diagnosisPrinters(
        { usb: 'disconnected', stuckJobs: { ours: 1, others: 2 } },
        {
          paper: { widthMm: 100, heightMm: 150, dpi: 203 },
          readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
        },
      ),
    },
    setup: async ({ page }) => {
      await openDiagnosisPanel(page);
    },
  },
  {
    id: 'V86',
    title: '打印机 · 诊断 · 修复之后',
    points:
      '队列一项下面绿色说明「已请求取消本程序的 1 个任务」，随后结论变成「…认不出是本程序发的」；点了管理员按钮又拒绝后，红色提示「没有拿到管理员权限…」（读屏按 alert 念）；指令集一项问「标签机走出一张空白标签了吗？」并点了「没反应」：变红「有问题」，下面出现指令集下拉（5a 的控件）；提示不遮挡按钮',
    launch: { fakePrinters: diagnosisPrinters({ stuckJobs: { ours: 1, others: 1 }, adminPrompt: 'decline' }) },
    setup: async ({ page }) => {
      const panel = await openDiagnosisPanel(page);
      const queue = panel.locator('.diagnosis-item', { hasText: '打印队列' });
      await queue.getByRole('button', { name: '清除本程序的任务' }).click();
      await expect(queue).toContainText('认不出是本程序发的');
      await queue.getByRole('button', { name: '清除全部任务（需要管理员权限）' }).click();
      await expect(queue.getByRole('alert')).toContainText('没有拿到管理员权限');
      const commands = panel.locator('.diagnosis-item', { hasText: '指令集' });
      await commands.getByRole('button', { name: '走一张纸' }).click();
      await commands.getByRole('button', { name: '没反应' }).click();
      await expect(commands).toContainText('标签机没有反应');
    },
  },
  {
    id: 'V87',
    title: '打印机 · 驱动（发现缺驱动的设备）',
    points:
      '「驱动」卡片在打印机卡片下面，标题和「重新检测」同一行；清单那一行「驱动清单：… 签发，1 个型号，有效期到 …」是普通灰字；两台设备各一行：「示例品牌 示例型号 X1」右侧「安装驱动（0.0 MB）」按钮、下面「USB 1234:ABCD · 没装驱动」；另一台「USB 打印支持」没有按钮，下面是通用驱动的指引；长名字省略不撑宽；「驱动清单地址」收起；1024 宽时按钮不换到下一行',
    launch: { fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: DRIVER_KEYS.publicKey },
    setup: async (ctx) => {
      await openDriverCard(ctx, catalogText(DRIVER_KEYS, [catalogModel()]));
      await expect(ctx.page.getByRole('region', { name: '驱动' })).toContainText('1 个型号');
    },
  },
  {
    id: 'V88',
    title: '打印机 · 驱动（正在安装）',
    points:
      '安装区淡黄底：步骤「下载 核对 安装 找打印机」前两步绿色、「安装」加粗、最后一步灰；下面一句「请在 Windows 弹出的窗口里点「是」…」完整换行不溢出；没有取消按钮（提权之后取消不了）；设备行的按钮和「重新检测」都灰掉',
    launch: {
      fakePrinters: [],
      fakeDrivers: fakeDrivers({ installDelayMs: DRIVER_INSTALL_HOLD_MS }),
      driverCatalogKey: DRIVER_KEYS.publicKey,
    },
    setup: async (ctx) => {
      await openDriverCard(ctx, catalogText(DRIVER_KEYS, [catalogModel()]));
      const card = ctx.page.getByRole('region', { name: '驱动' });
      await card.getByRole('button', { name: /安装驱动/ }).click();
      await expect(card.getByRole('status')).toContainText('点「是」');
    },
  },
  {
    id: 'V89',
    title: '打印机 · 驱动（清单不能用）',
    points:
      '清单那一行红字「驱动清单不能用：驱动清单已在 … 过期（电脑时间是 …）…」完整换行；设备行都没有按钮，指引「驱动清单不可用，不能自动安装：…」；展开「驱动清单地址」后是一行地址设置（输入框、「恢复默认」），和「通用」页的中转地址那一行对齐方式一致',
    launch: { fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: DRIVER_KEYS.publicKey },
    setup: async (ctx) => {
      await openDriverCard(ctx, catalogText(DRIVER_KEYS, [catalogModel()], Date.now() - EXPIRED_CATALOG_AGE_MS));
      const card = ctx.page.getByRole('region', { name: '驱动' });
      await expect(card).toContainText('过期');
      await card.getByText('驱动清单地址', { exact: true }).first().click();
    },
  },
];

/**
 * V39–V43：五套内置面单（模板页的大预览，示例面单数据）。分区和每条线的位置要和平台公开的标准面单模板一致，
 * 验收时把截图和官方模板的坐标逐条核对（设计文档第 2 节）。
 */
function waybillCase(id: string, name: string, points: string): Item {
  return {
    id,
    title: `模板 · 面单 · ${name}`,
    points,
    setup: async ({ page }) => {
      await openConfig(page, '模板');
      await page.locator('.template-item', { hasText: name }).click();
      const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame').locator('body');
      await expect(label).toContainText('781234567890123');
    },
  };
}

/** V45–V48：复制内置的吊牌示例，进设计器。 */
async function openCanvasDesigner(page: Page): Promise<void> {
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.getByRole('region', { name: '设计器' })).toBeVisible();
}

/** V50–V55：打开模板库，等缩略图出来。 */
async function openTemplateLibrary(page: Page): Promise<void> {
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '从模板库新建' }).click();
  await expect(page.getByRole('region', { name: '模板库' }).getByRole('article')).toHaveCount(TEMPLATE_LIBRARY.length);
}

/** 模板库左栏的一个分类（名字后面跟着个数）。 */
function libraryCategory(page: Page, label: string) {
  return page.getByRole('navigation', { name: '模板库分类' }).getByRole('button', { name: new RegExp(`^${label}`) });
}

/** V54、V55：从模板库复制 name 进设计器（已在设计器里时先回到列表）。 */
async function useLibraryTemplate(page: Page, name: string): Promise<void> {
  const designer = page.getByRole('region', { name: '设计器' });
  if (await designer.isVisible()) {
    await page.getByRole('button', { name: '返回列表' }).click();
  }
  await page.getByRole('button', { name: '从模板库新建' }).click();
  await page
    .getByRole('region', { name: '模板库' })
    .getByRole('article', { name, exact: true })
    .getByRole('button', { name: '用这个模板' })
    .click();
  await expect(designer).toBeVisible();
  await expect(page.getByRole('region', { name: '打印前检查' })).toContainText('没有发现问题');
}

/** 设计器右边的检查器。 */
function inspectorOf(page: Page): Locator {
  return page.getByRole('complementary', { name: '检查器' });
}

/** 在图层列表里点选一个元素（名字形如「编码条码（条码）」），再翻回检查器第一页（这个元素自己的设置）。 */
async function selectLayer(page: Page, name: string): Promise<void> {
  const inspector = inspectorOf(page);
  await inspector.getByRole('tab', { name: '图层' }).click();
  await page.getByRole('list', { name: '图层' }).getByRole('button', { name, exact: true }).click();
  await inspector.getByRole('tab').first().click();
}

/** 设计器画布上纸上 (x, y) mm 在窗口里的位置（吊牌示例是 60×40）。 */
async function canvasPoint(page: Page, xMm: number, yMm: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('.canvas-overlay').boundingBox();
  if (box === null) {
    throw new Error('the canvas is not visible');
  }
  return { x: box.x + (xMm * box.width) / 60, y: box.y + (yMm * box.height) / 40 };
}

/** V57：把吊牌的条码改窄到印不出（排列页的宽度），回到条码页。 */
async function narrowTagBarcode(page: Page): Promise<void> {
  await selectLayer(page, '编码条码（条码）');
  const inspector = inspectorOf(page);
  await inspector.getByRole('tab', { name: '排列' }).click();
  const width = inspector.getByLabel('宽', { exact: true });
  await width.fill('20');
  await width.blur();
  await inspector.getByRole('tab').first().click();
  await expect(page.getByRole('region', { name: '打印前检查' })).toContainText('至少要');
}

/** V32：本机中转服务和一部测试手机（每种尺寸共用，只连一次）。 */
let mobileRelay: LocalRelay | null = null;
let mobilePhone: TestPhone | null = null;

// 不用 serial：一项没过也继续截后面的项。某项失败后 Playwright 会换一个工作进程，
// 所以每项的结果各写一个文件，manifest 每次都从这些文件重新汇总。
test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  const files = (await readdir(OUT_DIR)).filter((file) => /^V\d+\.json$/.test(file)).sort();
  const items = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(OUT_DIR, file), 'utf8')) as ItemRecord),
  );
  const manifest = { generatedAt: new Date().toISOString(), platform: process.platform, items };
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
});

for (const item of ITEMS) {
  // 程序由 electronApp 夹具启动：用例结束时（包括失败时）关掉程序、删掉数据目录。
  test(`${item.id} ${item.title}`, async ({ electronApp }) => {
    const { app, page, userData } = await electronApp.launch(item.launch);
    const window = (await app.browserWindow(page)) as WindowHandle;
    const ctx: Context = { app, page, userData, window, notes: [], cleanups: [] };
    const record: ItemRecord = { id: item.id, title: item.title, points: item.points, shots: [], notes: ctx.notes };
    const save = async (label: string, size: string, png: Buffer, issues: Issue[]) => {
      const file = `${item.id}-${record.shots.length + 1}.png`;
      await writeFile(join(OUT_DIR, file), png);
      record.shots.push({ label, size, file, issues });
    };
    try {
      await resize(window, SIZE_1280);
      await page.waitForTimeout(SETTLE_MS);
      await item.setup?.(ctx);
      if (item.custom) {
        await item.custom(ctx, save);
      } else {
        for (const size of item.sizes ?? ALL_SIZES) {
          await resize(window, size, size.zoom ?? 1);
          await page.waitForTimeout(SETTLE_MS);
          for (const shot of item.shots ?? [{ label: item.title }]) {
            await shot.prepare?.(ctx);
            await page.waitForTimeout(SETTLE_MS);
            const issues = await pageChecks(page);
            await save(shot.label, sizeLabel(size), await capturePng(window), issues);
          }
        }
      }
    } finally {
      for (const cleanup of ctx.cleanups.reverse()) {
        await cleanup().catch((error: unknown) => ctx.notes.push(`收尾失败：${String(error)}`));
      }
      await writeFile(join(OUT_DIR, `${item.id}.json`), JSON.stringify(record, null, 2), 'utf8');
    }
    const issues = record.shots.flatMap((shot) =>
      shot.issues.map((issue) => `${shot.label} ${shot.size}: ${issue.check} ${issue.detail}`),
    );
    expect(issues).toEqual([]);
  });
}
