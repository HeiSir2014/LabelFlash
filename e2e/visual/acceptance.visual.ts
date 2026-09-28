import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { APP_ROOT, type LaunchedApp, launchApp } from '../support/electron-app';
import { DEFAULT_CHECK_OPTIONS, type Issue, pageChecks } from './checks';

/**
 * 视觉验收（设计文档 §8.2 的 V01–V31）：每项在三种窗口尺寸下截图，每张跑 §8.3 的自动检查，
 * 结果写进 manifest.json，供验收页面逐项展示和确认。
 */

const OUT_DIR = join(APP_ROOT, 'test-results', 'visual-acceptance');
const SETTLE_MS = 350;

interface Size {
  width: number;
  height: number;
}
const S1280: Size = { width: 1280, height: 800 };
const S1024: Size = { width: 1024, height: 680 };
const S1920: Size = { width: 1920, height: 1080 };
const ALL_SIZES = [S1280, S1024, S1920];

interface Context extends LaunchedApp {
  notes: string[];
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
  sizes?: Size[];
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

async function resize(app: ElectronApplication, size: Size, zoom = 1): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { width, height, factor }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(Math.round(width * factor), Math.round(height * factor));
      window?.webContents.setZoomFactor(factor);
    },
    { width: size.width, height: size.height, factor: zoom },
  );
}

async function capturePng(app: ElectronApplication): Promise<Buffer> {
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const image = await window?.webContents.capturePage();
    return image?.toPNG().toString('base64') ?? '';
  });
  return Buffer.from(base64, 'base64');
}

async function openConfig(page: Page, name: string): Promise<void> {
  if ((await page.locator('.config-center:not(.config-center--leaving)').count()) === 0) {
    await page.getByRole('button', { name: '配置', exact: true }).click();
  }
  await page.getByRole('navigation', { name: '配置' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
}

async function scanWith(page: Page, raw: string): Promise<void> {
  await page.locator('.scan-bar__input').fill(raw);
  await page.locator('.scan-bar__input').press('Enter');
}

/** 像扫码枪一样打字：焦点不在输入框时由程序决定落点。 */
async function typeLikeScanner(page: Page, lines: string[]): Promise<void> {
  for (const line of lines) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
}

async function api(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    ({ name, params }) =>
      (window as unknown as { api: Record<string, (...values: unknown[]) => Promise<unknown>> }).api[name]?.(...params),
    { name: method, params: args },
  );
}

/** 换掉主进程的打印处理：只计数，不碰真实打印机。 */
async function stubPrinting(app: ElectronApplication): Promise<() => Promise<number>> {
  await app.evaluate(({ ipcMain }) => {
    const calls = { count: 0 };
    (globalThis as { visualPrintCalls?: typeof calls }).visualPrintCalls = calls;
    ipcMain.removeHandler('label:print');
    ipcMain.handle('label:print', () => {
      calls.count += 1;
      return { status: 'failed', reason: 'PRINT_ERROR' };
    });
  });
  return () => printCount(app);
}

function printCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as { visualPrintCalls?: { count: number } }).visualPrintCalls?.count ?? -1);
}

/** 用一台不存在的打印机提交打印：主进程记一条「找不到打印机」的记录，不会出纸。 */
async function addJobs(page: Page, count: number): Promise<void> {
  await page.evaluate(async (total) => {
    const bridge = (
      window as unknown as { api: { print(raw: string, printer: string, options: object): Promise<unknown> } }
    ).api;
    for (let i = 0; i < total; i += 1) {
      await bridge.print(`CL${5600 + i}-TK-图片色-XL`, 'E2E 不存在的打印机', { source: 'desktop', force: false });
    }
  }, count);
}

async function startServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/hooks` };
}

// ── 验收项 ──

const ITEMS: Item[] = [
  {
    id: 'V01',
    title: '工作台 · 空闲',
    points:
      '扫码框输入区至少 240px 宽，1024 宽度下备注和自动打印整体换到第二行；「扫码」标签与占位文字、输入文字在 100% / 150% / 200% 缩放下中线对齐（误差 ≤ 1px）；预览工具条模板下拉框完整显示模板名；右侧栏两个标签各占一半',
    custom: async (ctx, record) => {
      for (const size of ALL_SIZES) {
        await resize(ctx.app, size);
        await ctx.page.waitForTimeout(SETTLE_MS);
        const width = await ctx.page.locator('.scan-bar__input').evaluate((el) => el.getBoundingClientRect().width);
        ctx.notes.push(`${size.width}×${size.height}：扫码框输入区宽 ${Math.round(width)}px`);
        await record(
          '空闲',
          `${size.width}×${size.height}`,
          await capturePng(ctx.app),
          await ctx.page.evaluate(pageChecks, DEFAULT_CHECK_OPTIONS),
        );
      }
      for (const zoom of [1, 1.5, 2]) {
        await resize(ctx.app, S1280, zoom);
        await ctx.page.waitForTimeout(SETTLE_MS);
        for (const text of ['', 'CL5640-TK-图片色-XL']) {
          await ctx.page.locator('.scan-bar__input').evaluate((el, value) => {
            (el as HTMLTextAreaElement).value = value;
          }, text);
          const mids = await ctx.page.evaluate(() => {
            const mid = (selector: string) => {
              const rect = document.querySelector(selector)?.getBoundingClientRect();
              return rect ? rect.top + rect.height / 2 : Number.NaN;
            };
            return { label: mid('.scan-bar__label'), input: mid('.scan-bar__input') };
          });
          const offset = Math.abs(mids.label - mids.input);
          ctx.notes.push(
            `缩放 ${zoom * 100}%、${text ? '输入文字' : '占位文字'}：标签中线 ${mids.label.toFixed(1)}px，输入框中线 ${mids.input.toFixed(1)}px，相差 ${offset.toFixed(1)}px`,
          );
          await record(
            `缩放 ${zoom * 100}% · ${text ? '输入文字' : '占位文字'}`,
            `1280×800 @${zoom}x`,
            await capturePng(ctx.app),
            offset > 1 ? [{ check: 'alignment', detail: `中线相差 ${offset.toFixed(1)}px` }] : [],
          );
        }
      }
      await resize(ctx.app, S1280);
    },
  },
  {
    id: 'V02',
    title: '工作台 · 已扫码（样衣码，规则指定了模板）',
    points:
      '工具条显示「规则：横杠三段（编码-颜色-尺码） · 模板：样衣标准（二维码在左）（规则指定）」；预览为样衣标准模板',
    setup: async ({ page }) => {
      await scanWith(page, 'CL5640-TK-图片色-XL');
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
      await addJobs(page, 12);
      await page.reload();
      await page.getByRole('tab', { name: '打印记录' }).click();
    },
  },
  {
    id: 'V05',
    title: '标题栏 · 配置按钮三种状态',
    points: '常态、悬停、按下（配置中）；与打印机胶囊高度、圆角、间距一致；macOS 红绿灯不遮挡',
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
        label: '按下（配置中）',
        prepare: async ({ page }) => {
          if ((await page.locator('.config-center').count()) === 0) {
            await page.locator('.config-button').click();
          }
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
      await scanWith(page, 'CL5640-TK-图片色-XL');
      await openConfig(page, '模板');
      await page.locator('.template-item', { hasText: '样衣标准（二维码在左）' }).click();
    },
  },
  {
    id: 'V08',
    title: '模板 · 编辑视图（≥1100px）',
    points: '表单与预览并排；预览固定不随表单滚动；面包屑；底部操作条',
    sizes: [S1280, S1920],
    setup: async ({ page }) => {
      await openConfig(page, '模板');
      await page.getByRole('button', { name: '复制' }).click();
      await page.locator('.template-form').getByLabel('模板名称').fill('样衣标准 · 仓库版');
      await page.locator('.template-editing__form').evaluate((el) => el.scrollTo(0, 400));
    },
  },
  {
    id: 'V09',
    title: '模板 · 编辑视图（1024px）',
    points: '预览在上 220px，表单在下滚动；无横向滚动',
    sizes: [S1024],
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
      await scanWith(page, 'CL5640-TK-图片色-XL');
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
      await page.getByLabel('地址', { exact: true }).fill('http://127.0.0.1:9/shelf?code={字段1}');
      await page.getByRole('button', { name: '保存规则' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '识别规则' })).toBeVisible();
      await page.getByLabel('要识别的内容').fill('CL5640_XL');
      await expect(page.locator('.rule-tester__step--failed')).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    id: 'V13',
    title: '识别规则 · 编辑（分隔符拆分 + HTTP 步骤展开）',
    points: '表单与试一试并排；步骤卡片、请求头 / 取值路径两列表格；底部操作条和校验失败原因',
    sizes: [S1280, S1920],
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
    sizes: [S1024],
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
    sizes: [S1280],
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
      const rows = Array.from({ length: 30 }, (_, i) =>
        [
          `CL56${i}-TK`,
          `A-${i}`,
          '一号仓',
          '样衣间',
          '常规款',
          '张三',
          '某某面料厂',
          '棉 95%',
          `2026-09-${(i % 28) + 1}`,
          '长文字说明用来撑宽表格',
        ].join(','),
      );
      const csvPath = join(userData, '货架.csv');
      await writeFile(csvPath, `${columns.join(',')}\n${rows.join('\n')}\n`, 'utf8');
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
      }, csvPath);
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
      { label: '已有密钥' },
      {
        label: '保存失败的提示',
        prepare: async ({ page }) => {
          await page.getByLabel('名称', { exact: true }).fill('带{花括号}的名称');
          await page.getByLabel('内容', { exact: true }).fill('abc');
          await page.getByRole('button', { name: '保存密钥' }).click();
        },
      },
    ],
    // 不点「复制引用」：那会改掉跑验收这台电脑上的系统剪贴板。
    setup: async ({ page }) => {
      await openConfig(page, '密钥');
      await page.getByLabel('名称', { exact: true }).fill('仓库接口');
      await page.getByLabel('内容', { exact: true }).fill('token-123');
      await page.getByRole('button', { name: '保存密钥' }).click();
      await expect(page.locator('.secret-card')).toContainText('{密钥:仓库接口}');
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
      const { server, url } = await startServer();
      await openConfig(page, '打印结果通知');
      for (const [name, address] of [
        ['本机测试接口', url],
        ['连不上的接口', 'http://127.0.0.1:9/hooks'],
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
      await expect(page.locator('.delivery-state--delivered')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.delivery-state--pending')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('region', { name: '发送记录' }).getByRole('button', { name: '刷新' }).click();
      server.close();
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
    setup: async ({ app, page, notes }) => {
      const printCalls = await stubPrinting(app);
      await api(page, 'updateSettings', { selectedPrinter: 'E2E 打印机', autoPrint: true });
      await page.reload();
      await openConfig(page, '识别规则');
      await page.locator('.rules-page__main').click({ position: { x: 4, y: 4 } });
      await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
      await expect(page.locator('.rule-tester__result')).toContainText('命中');
      notes.push(`打印调用次数：${await printCalls()}`);
    },
  },
  {
    id: 'V23',
    title: '配置中心扫码 · 其他页',
    points: '胶囊闪烁、播报；没有打印、设置没被改动',
    shots: [
      {
        label: '扫码后「配置中不打印」闪烁',
        prepare: async ({ app, page, notes }) => {
          await page.locator('.config-content').click({ position: { x: 4, y: 4 } });
          await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
          await expect(page.locator('.config-pill--flash')).toBeVisible();
          const dedup = await page.getByLabel('防重复打印').inputValue();
          notes.push(`扫码后：打印调用次数 ${await printCount(app)}，「防重复打印」仍是 ${dedup} 秒`);
        },
      },
    ],
    setup: async ({ app, page }) => {
      await stubPrinting(app);
      await api(page, 'updateSettings', { selectedPrinter: 'E2E 打印机', autoPrint: true });
      await page.reload();
      await openConfig(page, '通用');
    },
  },
  {
    id: 'V24',
    title: '键盘操作',
    points: 'Tab 顺序：返回 → 导航 → 内容 → 操作条；所有可交互元素有清晰的焦点框（2px --color-ink）',
    sizes: [S1280],
    setup: async ({ page, notes }) => {
      await openConfig(page, '通用');
      await page.getByRole('button', { name: '返回工作台' }).focus();
      const order: string[] = [];
      for (let i = 0; i < 16; i += 1) {
        order.push(
          await page.evaluate(() => {
            const el = document.activeElement;
            return el
              ? `${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」`
              : '';
          }),
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
    points: '红绿灯区域、全屏时标题栏；配置中心快捷键显示 ⌘,',
    sizes: [S1280],
    custom: async (ctx, record) => {
      const title = await ctx.page.locator('.config-button').getAttribute('title');
      ctx.notes.push(`「配置」按钮的悬停提示：${title}`);
      if (process.platform !== 'darwin') {
        ctx.notes.push('不是 macOS：本项在 Mac 上复验');
        return;
      }
      for (const fullScreen of [false, true]) {
        await ctx.app.evaluate(
          ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0]?.setFullScreen(value),
          fullScreen,
        );
        // macOS 进出全屏有一段切换动画，等它结束再截。
        await expect
          .poll(() => ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()))
          .toBe(fullScreen);
        await ctx.page.waitForTimeout(1500);
        const sourceId = await ctx.app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getMediaSourceId() ?? '',
        );
        const windowId = sourceId.split(':')[1] ?? '';
        const file = join(OUT_DIR, `V25-window-${fullScreen ? 'fullscreen' : 'normal'}.png`);
        try {
          await promisify(execFile)('screencapture', ['-x', '-o', `-l${windowId}`, file]);
          await record(
            fullScreen ? '全屏（系统窗口截图）' : '窗口（系统窗口截图，含红绿灯）',
            '1280×800',
            await readFile(file),
            [],
          );
        } catch (error) {
          ctx.notes.push(`系统窗口截图失败：${String(error)}`);
          await record(fullScreen ? '全屏（页面截图）' : '窗口（页面截图）', '1280×800', await capturePng(ctx.app), []);
        }
      }
      await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(false));
      await ctx.page.waitForTimeout(1000);
    },
  },
  {
    id: 'V26',
    title: '常用备注页',
    points: '说明卡片、多行备注照原样显示、添加按钮计数与禁用状态；从工作台「管理常用备注…」直达',
    setup: async ({ page }) => {
      await api(page, 'updateSettings', { notePresets: ['样衣间 {日期}', '返修\n第二行：{订单号}'] });
      await page.reload();
      await page.getByRole('combobox', { name: '备注' }).selectOption({ label: '管理常用备注…' });
      await expect(page.getByRole('heading', { level: 1, name: '常用备注' })).toBeVisible();
    },
  },
  {
    id: 'V27',
    title: '通用页',
    points: '各行控件对齐；调小记录上限时的确认条；更新状态文字与「检查更新」',
    setup: async ({ app, page, notes }) => {
      await addJobs(page, 1_005);
      await page.reload();
      await openConfig(page, '通用');
      // 开发版不检查更新：页面读到初始状态之后，再模拟一次「已是最新版本」。
      await expect(page.getByText('开发版不检查更新')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.send('update:status-changed', {
          state: 'up-to-date',
          checkedAt: Date.now(),
        }),
      );
      await expect(page.getByText(/已是最新版本/)).toBeVisible();
      const limit = page.getByLabel('打印记录保留');
      await limit.fill('1000');
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
        prepare: async ({ page }) => {
          await scanWith(page, `20260929${Math.floor(Math.random() * 10_000)}`);
          await expect(page.locator('.status-strip__title')).toHaveText('正在查询…');
        },
      },
    ],
    setup: async ({ app, page }) => {
      await scanWith(page, 'CL5640-TK-图片色-XL');
      await expect(page.locator('.preview-toolbar__usage')).toContainText('规则指定');
      // 模拟加工步骤里慢的接口查询：包一层延迟的预览处理。
      await app.evaluate(({ ipcMain }) => {
        const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })
          ._invokeHandlers;
        const original = handlers.get('label:preview');
        ipcMain.removeHandler('label:preview');
        ipcMain.handle('label:preview', async (...args: unknown[]) => {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          return original?.(...args);
        });
      });
    },
  },
  {
    id: 'V29',
    title: '模板编辑 · 字段名候选；识别规则 · 单条导出',
    points: '字段名输入框弹出候选列表；规则卡片「导出」按钮位置',
    sizes: [S1280],
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
    sizes: [S1280],
    shots: [
      {
        label: '工作台状态条 · 没有匹配的识别规则',
        prepare: async ({ page }) => {
          await openConfig(page, '识别规则');
          await page.getByLabel('启用「原样打印」').click();
          await expect(page.getByLabel('启用「原样打印」')).not.toBeChecked();
          await page.getByRole('button', { name: '返回工作台' }).click();
          await scanWith(page, 'hello world');
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
    setup: async ({ app, page }) => {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.send('update:status-changed', {
          state: 'ready',
          version: '1.0.2',
        }),
      );
      await expect(page.locator('.update-pill')).toBeVisible();
    },
  },
];

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
  test(`${item.id} ${item.title}`, async () => {
    const launched = await launchApp();
    const ctx: Context = { ...launched, notes: [] };
    const record: ItemRecord = { id: item.id, title: item.title, points: item.points, shots: [], notes: ctx.notes };
    const save = async (label: string, size: string, png: Buffer, issues: Issue[]) => {
      const file = `${item.id}-${record.shots.length + 1}.png`;
      await writeFile(join(OUT_DIR, file), png);
      record.shots.push({ label, size, file, issues });
    };
    try {
      await resize(ctx.app, S1280);
      await ctx.page.waitForTimeout(SETTLE_MS);
      await item.setup?.(ctx);
      if (item.custom) {
        await item.custom(ctx, save);
      } else {
        for (const size of item.sizes ?? ALL_SIZES) {
          await resize(ctx.app, size);
          await ctx.page.waitForTimeout(SETTLE_MS);
          for (const shot of item.shots ?? [{ label: item.title }]) {
            await shot.prepare?.(ctx);
            await ctx.page.waitForTimeout(SETTLE_MS);
            const issues = await ctx.page.evaluate(pageChecks, DEFAULT_CHECK_OPTIONS);
            await save(shot.label, `${size.width}×${size.height}`, await capturePng(ctx.app), issues);
          }
        }
      }
    } finally {
      await writeFile(join(OUT_DIR, `${item.id}.json`), JSON.stringify(record, null, 2), 'utf8');
      await ctx.close();
    }
    const issues = record.shots.flatMap((shot) =>
      shot.issues.map((issue) => `${shot.label} ${shot.size}: ${issue.check} ${issue.detail}`),
    );
    expect(issues).toEqual([]);
  });
}
