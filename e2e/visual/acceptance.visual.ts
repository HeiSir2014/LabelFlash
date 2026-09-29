import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from '@playwright/test';
import { type HttpStep, STEP_LIMITS } from '../../src/core/scan/enrich-model';
import type { FakePrinterSpec } from '../../src/main/printing/fake-printers';
import { RECENT_DELIVERY_COUNT } from '../../src/shared/ipc-contract';
import { HISTORY_LIMIT_RANGE } from '../../src/shared/settings';
import {
  blurActiveElement,
  callApi,
  openConfig,
  recordClipboard,
  scan,
  stubOpenDialog,
  stubPrinting,
  typeLikeScanner,
} from '../support/app-helpers';
import { APP_ROOT, type LaunchOptions } from '../support/electron-app';
import { expect, test } from '../support/fixtures';
import { connectTestPhone, type LocalRelay, startLocalRelay, type TestPhone } from '../support/relay-server';
import {
  ALL_SIZES,
  addJobs,
  capturePng,
  formatBounds,
  isSameRectangle,
  pushUpdateStatus,
  resize,
  SIZE_1024,
  SIZE_1280,
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
 * 视觉验收（设计文档 §8.2 的 V01–V37）：每项在三种窗口尺寸下截图，每张跑 §8.3 的自动检查，
 * 结果写进 manifest.json，供验收页面逐项展示和确认。
 */

const OUT_DIR = join(APP_ROOT, 'test-results', 'visual-acceptance');
/**
 * 截图前等界面静下来：最长的一次性过渡是出纸动画（--feed-duration 180ms）和配置中心进出（--config-duration 160ms），
 * 多留一倍左右，截到的是动画结束后的样子。
 */
const SETTLE_MS = 350;
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
    title: '工作台 · 已扫码（样衣码，规则指定了模板）',
    points:
      '工具条显示「规则：横杠三段（编码-颜色-尺码） · 模板：样衣标准（二维码在左）（规则指定）」；预览为样衣标准模板',
    setup: async ({ page }) => {
      await scan(page, 'CL5640-TK-图片色-XL');
      await expect(page.locator('.preview-toolbar__usage')).toContainText('规则指定');
    },
  },
  {
    id: 'V03',
    title: '工作台 · 已扫码（多行键值）',
    points: '预览字段完整，工具条规则名正确',
    setup: async ({ page }) => {
      await page.locator('.scan-bar__input').focus();
      await typeLikeScanner(page, ['订单号：A20260929001', '款号：CL5640', '颜色：图片色', '尺码：XL', '数量：2']);
      await expect(page.locator('.preview-toolbar__usage')).toContainText('多行键值');
    },
  },
  {
    id: 'V04',
    title: '工作台 · 打印记录标签',
    points: '列表、搜索框、分页与现在一致，无横向滚动',
    setup: async ({ page }) => {
      await addJobs(page, HISTORY_SAMPLE_JOBS);
      await page.reload();
      await page.getByRole('tab', { name: '打印记录' }).click();
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
            await page.locator('.config-button').click();
            await expect(page.locator('.config-center')).toHaveCount(0);
          }
          await page.locator('.title-bar__name').hover();
        },
      },
      { label: '悬停', prepare: async ({ page }) => page.locator('.config-button').hover() },
      {
        label: '按下（配置中心打开时）',
        prepare: async ({ page }) => {
          if ((await page.locator('.config-center').count()) === 0) {
            await page.locator('.config-button').click();
          }
          await expect(page.locator('.config-button')).toHaveAttribute('aria-pressed', 'true');
        },
      },
    ],
  },
  {
    id: 'V06',
    title: '配置中心 · 框架',
    points: '导航分组、当前项样式、页头三段对齐；「配置中不打印」胶囊可见；工作台不可聚焦',
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
      await page.locator('.template-item', { hasText: '样衣标准（二维码在左）' }).click();
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
      await page.locator('.template-form').getByLabel('模板名称').fill('样衣标准 · 仓库版');
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
      // 样衣标准本来就是「指定字段」，复制后有现成的字段行。
      await page.locator('.template-item', { hasText: '样衣标准（二维码在左）' }).click();
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
      { label: '焦点在按钮', prepare: async ({ page }) => page.getByRole('button', { name: '打开日志目录' }).focus() },
    ],
  },
  {
    id: 'V25',
    title: 'macOS',
    points: '红绿灯区域、全屏时标题栏；配置中心快捷键显示 ⌘,；退出全屏后窗口回到进入全屏前的位置',
    sizes: [SIZE_1280],
    custom: async (ctx, record) => {
      const title = await ctx.page.locator('.config-button').getAttribute('title');
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
    title: '通用页',
    points: '各行控件对齐；调小记录上限时的确认条；更新状态文字与「检查更新」',
    setup: async ({ page, window, notes }) => {
      await addJobs(page, HISTORY_LIMIT_RANGE.min + EXTRA_JOBS_OVER_LIMIT);
      await page.reload();
      await openConfig(page, '通用');
      // 开发版不检查更新：页面读到初始状态之后，再模拟一次「已是最新版本」。
      await expect(page.getByText('开发版不检查更新')).toBeVisible();
      await pushUpdateStatus(window, { state: 'up-to-date', checkedAt: Date.now() });
      await expect(page.getByText(/已是最新版本/)).toBeVisible();
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
      await expect(ctx.page.locator('.preview-toolbar__usage')).toContainText('规则指定');
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
            await page.locator('.template-item', { hasText: '样衣标准（二维码在左）' }).click();
            await page.getByRole('button', { name: '复制' }).click();
          }
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
    title: '配置中心 · 手机扫码',
    points: '中转地址输入框和「恢复默认」一行；说明文字不截断；格式不对时的提示；当前状态',
    shots: [
      {
        label: '默认',
        prepare: async ({ page }) => {
          if ((await page.getByLabel('中转地址').count()) === 0) {
            await openConfig(page, '手机扫码');
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
            for (const code of ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE']) {
              element.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Process', code, bubbles: true, cancelable: true }),
              );
            }
          });
          await expect(page.locator('.scan-bar__ime')).toBeVisible();
        },
      },
    ],
  },
  {
    id: 'V35',
    title: '打印机页 · 纸张分配',
    points:
      '顶部「纸张 → 打印机」表每种纸一行，下拉框完整显示打印机名；没有可用打印机的纸标红，旁边有「建议：…」按钮；下面每台打印机显示状态（缺纸的红点和「缺纸」）、「负责：…」、驱动纸张（对不上时的提醒和「打开打印首选项」）；没负责纸张的打印机只显示驱动纸张；标题栏胶囊显示出问题的那一台',
    launch: { fakePrinters: PAPER_PRINTERS },
    setup: async ({ page }) => {
      await saveCopyOnPaper(page, '极兔面单', { widthMm: 100, heightMm: 180 });
      await saveCopyOnPaper(page, '顺丰面单', { widthMm: 100, heightMm: 150 }, '面单机B');
      await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' } });
      await page.reload();
      await expect(page.locator('.paper-row')).toHaveCount(3);
      await expect(page.locator('.printer-chip')).toHaveText('面单机B（缺纸）');
    },
  },
  {
    id: 'V36',
    title: '模板编辑器 · 纸张和打印机',
    points:
      '「基本」区的纸张尺寸下拉框（预设名带适用的快递）、自定义时的宽和高两个输入框、打印机下拉框（「按纸张分配（当前是 …）」、指定的打印机不在这台电脑上时标明）；换纸张后右侧预览的软尺跟着变；模板列表每行下面是纸张和实际会用的打印机',
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
            .selectOption({ label: '100×180 二联面单（申通、极兔、中通、圆通、韵达、顺丰、EMS）' });
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
    points:
      '50×30、100×100 两种纸：软尺刻度是实际毫米数，标签框比例正确；二维码和字号放得下，没有被裁掉；工具条显示打印机',
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
          await expect(page.locator('.preview-toolbar__usage')).toContainText('模板：小标签');
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
          await expect(page.locator('.preview-toolbar__usage')).toContainText('模板：箱唛');
          await expect(page.locator('.ruler--horizontal')).toHaveAttribute('viewBox', /^0 0 100 /);
        },
      },
    ],
  },
];

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
          await resize(window, size);
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
