# 多台打印机、多种纸张 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：模板带纸张尺寸（含快递面单预设），每一张按「模板指定的打印机 → 纸张分配的打印机」自动打到装着对应纸张的那台打印机上，所有打印入口共用这套规则。

**架构**：
- 纸张预设和纸张键放在 `src/shared/paper-sizes.ts`。
- 「决定打印机」是 core 里的纯函数 `resolvePrinter`，由 `PrintService` 通过注入的 `choosePrinter` 调用。扫码枪、记录重打、手机扫码都在主进程里按模板决定打印机，界面不再传打印机名。
- 排版、打印页面尺寸、二维码对齐都按模板的纸张和打印机分辨率计算。
- `PrintService` 拆成「识别 → 模板」和「按模板打印」两半，给第 2 个子项目（本机接口）留入口。

**技术栈**：TypeScript、Electron、React 19、bun test、Playwright、Biome、SQLite（`node:sqlite`）。

**设计文档**：`docs/superpowers/specs/2026-09-29-multi-printer-paper-design.md`（第 10 节是和后两个子项目的衔接）

**约定**（见根目录和各目录的 CLAUDE.md）：
- 测试先行：每个任务先写失败的测试，再实现。
- 每个提交都通过 `bun run check`；提交前先跑 `bun run lint:fix`（Biome 会重排超过 120 字符的行）。
- 改了界面或主进程，再跑 `bun run test:e2e`；改了扫码页的文字，再跑 `bun run test:relay-browser`。
- 注释中文，标识符和提交信息英文；不写魔法数字；提交信息结尾带协作署名。
- 只在一个平台验证过的改动，在提交说明里写明。

**审核记录**：初稿经过四路逐段对照代码的审核（阶段 1–2、阶段 3、阶段 4–5、与后续子项目的衔接），本版已修正全部问题。主要修正：
- 补齐漏掉的调用方和测试文件；
- 60×40 快照改用本地时间；
- 二维码模块尺寸按毫米定、随分辨率换算；
- 打印时最多等驱动资料 1 秒；
- 状态检测改为按「打印机 + 问题」限频；
- E2E 用只在未打包时生效的假打印机；
- 预览的 CSS 按纸张；
- 手动模式的「能不能打」按这一张的打印机判断；
- 视觉验收编号改为 V35–V37；
- 阶段 3 拆成 8 个都能通过检查的提交；
- 打印记录追加 `template_id`；
- `PrintService` 拆出「按模板打印」。

---

## 文件地图

| 文件 | 状态 | 职责 |
|---|---|---|
| `src/shared/paper-sizes.ts` | 新建 | 纸张预设、纸张键（`60x40`）、名称、上下限、校验、宽松相等 |
| `src/shared/label-paper.ts` | 修改 | `DEFAULT_PAPER`（60×40）；`LABEL_PAPER_MM` 在 4.5 删除 |
| `src/core/templates/template-model.ts` | 修改 | `LabelTemplate` 加 `paper`、`printer`；尺寸计算按模板纸张；`withPaper` |
| `src/core/templates/sanitize-template.ts` | 修改 | 校验 `paper`、`printer` |
| `src/core/templates/builtin-templates.ts` | 修改 | 内置模板加 `paper`、`printer` |
| `src/core/printing/resolve-printer.ts` | 新建 | 纯函数：模板 + 纸张分配 + 本机打印机 → 用哪台、为什么 |
| `src/core/types.ts` | 修改 | `PrintRequest` 去掉 `printerName`；`PrintResult` 加 `no-printer`；`JobRecord` 加 `paper`、`templateId`；`PreviewResult` 带打印机 |
| `src/core/print-service.ts` | 修改 | 拆出 `printLabel`；注入 `choosePrinter`；测试页按纸张 |
| `src/core/testing/fake-printer-adapter.ts` | 修改 | 记下每张的纸张和字段 |
| `src/shared/settings.ts` | 修改 | 加 `paperPrinters`，从 `selectedPrinter` 迁移，去掉 `selectedPrinter` |
| `src/shared/driver-paper.ts` | 修改 | `checkDriverPaper(paper, expected)` |
| `src/shared/printer-summary.ts` | 新建 | 多台打印机的汇总文字（标题栏、手机共用） |
| `src/shared/voice.ts` | 修改 | `noPrinter` 改为「没有可用的打印机」 |
| `src/main/printing/qr-code.ts` | 修改 | `planQr` 接收分辨率，模块点数按分辨率换算 |
| `src/main/printing/label-html.ts` | 修改 | 按模板纸张排版，接收分辨率 |
| `src/main/printing/printer-profiles.ts` | 新建 | 每台打印机的驱动纸张和分辨率（短时缓存、打印时限时等待） |
| `src/main/printing/page-size.ts` | 新建 | 纸张 → 打印页面尺寸（微米），纯函数 |
| `src/main/printing/electron-driver-adapter.ts` | 修改 | 页面尺寸和分辨率按纸张、打印机；打印机列表并发共享一次查询 |
| `src/main/printing/printer-status.ts` | 修改 | 同时检测几台打印机 |
| `src/main/printing/alert-throttle.ts`、`printer-alerts.ts` | 修改 | 限频按「打印机 + 问题」 |
| `src/main/printing/fake-printers.ts` | 新建 | 只在未打包时生效的假打印机（E2E、视觉验收用） |
| `src/main/storage/migrations.ts` | 修改 | 末尾追加迁移：`jobs.paper`、`jobs.template_id` |
| `src/main/storage/sqlite-job-store.ts` | 修改 | 读写 `paper`、`template_id` |
| `src/core/notify/webhook-event.ts` | 修改 | 通知里加 `paper` |
| `src/main/index.ts`、`src/main/ipc.ts`、`src/main/ipc-validators.ts`、`src/preload/index.ts`、`src/shared/ipc-contract.ts` | 修改 | 接线 |
| `src/main/mobile/mobile-host.ts`、`mobile-station.ts`、`mobile-replies.ts` | 修改 | 打印不再传打印机名；手机顶部显示打印机汇总；`no-printer` 回复 |
| `scripts/relay/demo-desktop.ts`、`relay/test/phone-page.browser.ts` | 修改 | 跟上 `MobileHostDeps` |
| `relay/web/src/result-view.ts` | 修改 | 手机上「选择打印机」的文字 |
| `src/renderer/src/lib/printer-assignment.ts` | 新建 | 纸张分配表、建议、每台打印机负责什么、模板实际用哪台 |
| `src/renderer/src/lib/paper-text.ts` | 修改 | 驱动纸张提醒按期望纸张 |
| `src/renderer/src/lib/status-text.ts` | 修改 | `no-printer`；「能不能打」按这一张的打印机；打印记录的一行说明 |
| `src/renderer/src/lib/preview-usage.ts` | 修改 | 预览工具条带打印机 |
| `src/renderer/src/lib/printer-chip.ts` | 删除 | 由 `src/shared/printer-summary.ts` 代替（4.5） |
| `src/renderer/src/lib/feedback-cues.ts`、`mobile-text.ts` | 修改 | 删掉「没选打印机」的提示；手机浮层文字 |
| `src/renderer/src/view-models/use-printer-profiles.ts` | 新建 | 逐台读驱动纸张和状态、打开打印首选项 |
| `src/renderer/src/view-models/use-driver-paper.ts`、`use-printer-status.ts` | 删除 | 由 `use-printer-profiles.ts` 代替（4.3） |
| `src/renderer/src/components/PrinterList.tsx` | 改写 | 纸张分配表 + 打印机列表 |
| `src/renderer/src/components/TemplateEditor.tsx`、`config/pages/TemplatesPage.tsx`、`config/ConfigPages.tsx` | 修改 | 纸张和打印机 |
| `src/renderer/src/components/LabelPreview.tsx`、`PreviewStage.tsx`、`workbench/PreviewToolbar.tsx`、`workbench/WorkbenchSide.tsx`、`TitleBar.tsx`、`JobLog.tsx`、`App.tsx` | 修改 | 按纸张预览；工具条打印机；标题栏汇总胶囊可点；打印记录显示纸张 |
| `src/renderer/src/styles/app.css` | 修改 | 预览的软尺和标签框按纸张 |
| `e2e/support/electron-app.ts`、`fixtures.ts`、`app-helpers.ts` | 修改 | 假打印机启动选项、查看假打印记录、写入旧设置 |
| `e2e/*.e2e.ts`、`e2e/visual/acceptance.visual.ts` | 修改 | 纸张分配代替 `selectedPrinter`；新增用例；V35–V37 |

---

## 阶段 1：纸张模型（纯逻辑）

**目标**：有纸张预设和纸张键；模板带纸张和指定打印机；60×40 的一切结果不变。
**成功标准**：`bun run check` 通过；60×40 排版快照不变；模板存进数据库再读出来纸张和打印机不丢。
**状态**：Complete

### Task 1.1：先给 60×40 的排版结果拍快照（防退步）

**Files:**
- Create: `src/main/printing/label-html.snapshot.test.ts`

- [ ] **Step 1：写快照测试（在改任何排版代码之前）**

```ts
import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../core/scan/scan-result';
import { BUILT_IN_TEMPLATES } from '../../core/templates/builtin-templates';
import { renderLabelHtml } from './label-html';

const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};
// 用本地时间：{日期}、{时间} 按本地时区显示，用 UTC 时间戳的话东八区录的快照到 UTC 的 CI 上会对不上。
const PRINTED_AT = new Date(2026, 8, 29, 9, 5).getTime();

// 支持多种纸张以后，60×40 的每个内置模板必须和现在一字不差：操作员天天在打的标签不能变。
describe('60x40 label HTML stays the same', () => {
  for (const template of BUILT_IN_TEMPLATES) {
    test(template.name, () => {
      expect(renderLabelHtml({ scan: SCAN, template, printedAt: PRINTED_AT }).html).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2：运行，生成快照**

Run: `bun test src/main/printing/label-html.snapshot.test.ts`
Expected: PASS，生成 `src/main/printing/__snapshots__/label-html.snapshot.test.ts.snap`（必须提交：CI 上新快照会失败）

- [ ] **Step 3：`bun run check`，提交**

```bash
git add src/main/printing/label-html.snapshot.test.ts src/main/printing/__snapshots__
git commit -m "test(printing): snapshot the 60x40 label HTML before paper sizes change"
```

### Task 1.2：纸张预设与纸张键

**Files:**
- Create: `src/shared/paper-sizes.ts`
- Test: `src/shared/paper-sizes.test.ts`
- Modify: `src/shared/label-paper.ts`

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import {
  findPreset,
  formatPaperName,
  isSamePaper,
  PAPER_LIMITS_MM,
  PAPER_PRESETS,
  paperKey,
  parsePaperKey,
  sanitizePaper,
} from './paper-sizes';

describe('paperKey', () => {
  test('writes width x height without trailing zeros', () => {
    expect(paperKey({ widthMm: 60, heightMm: 40 })).toBe('60x40');
    expect(paperKey({ widthMm: 100, heightMm: 177 })).toBe('100x177');
    expect(paperKey({ widthMm: 76.5, heightMm: 130 })).toBe('76.5x130');
  });

  test('reads a key back into a paper size', () => {
    expect(parsePaperKey('100x180')).toEqual({ widthMm: 100, heightMm: 180 });
    expect(parsePaperKey('76.5x130')).toEqual({ widthMm: 76.5, heightMm: 130 });
  });

  test('rejects keys that are not a paper size', () => {
    expect(parsePaperKey('100×180')).toBeNull();
    expect(parsePaperKey('0x40')).toBeNull();
    expect(parsePaperKey('abc')).toBeNull();
  });
});

describe('presets', () => {
  test('cover the courier waybill sizes with their default cut points', () => {
    expect(findPreset({ widthMm: 100, heightMm: 177 })?.parts).toEqual([107, 70]);
    expect(findPreset({ widthMm: 100, heightMm: 180 })?.parts).toEqual([110, 70]);
    expect(findPreset({ widthMm: 76, heightMm: 130 })?.parts).toEqual([]);
  });

  test('every preset fits the limits and its parts add up to its height', () => {
    for (const preset of PAPER_PRESETS) {
      expect(preset.widthMm).toBeGreaterThanOrEqual(PAPER_LIMITS_MM.width.min);
      expect(preset.widthMm).toBeLessThanOrEqual(PAPER_LIMITS_MM.width.max);
      expect(preset.heightMm).toBeGreaterThanOrEqual(PAPER_LIMITS_MM.height.min);
      expect(preset.heightMm).toBeLessThanOrEqual(PAPER_LIMITS_MM.height.max);
      if (preset.parts.length > 0) {
        expect(preset.parts.reduce((sum, part) => sum + part, 0)).toBe(preset.heightMm);
      }
    }
  });

  test('keys are unique', () => {
    const keys = PAPER_PRESETS.map(paperKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('formatPaperName', () => {
  test('uses the preset name, or the size for a custom paper', () => {
    expect(formatPaperName({ widthMm: 60, heightMm: 40 })).toBe('60×40 标签');
    expect(formatPaperName({ widthMm: 88, heightMm: 55 })).toBe('88×55');
  });
});

describe('sanitizePaper', () => {
  const fallback = { widthMm: 60, heightMm: 40 };

  test('keeps a valid size and rounds to 0.1mm', () => {
    expect(sanitizePaper({ widthMm: 100.04, heightMm: 150 }, fallback)).toEqual({ widthMm: 100, heightMm: 150 });
  });

  test('falls back when the size is missing or out of range', () => {
    expect(sanitizePaper(undefined, fallback)).toEqual(fallback);
    expect(sanitizePaper({ widthMm: 20, heightMm: 40 }, fallback)).toEqual(fallback);
    expect(sanitizePaper({ widthMm: 100, heightMm: 999 }, fallback)).toEqual(fallback);
  });

  // 返回的是新对象：调用方改了它，不会改到别的模板共用的缺省纸张。
  test('never hands out the fallback object itself', () => {
    expect(sanitizePaper(undefined, fallback)).not.toBe(fallback);
  });
});

describe('isSamePaper', () => {
  // 驱动以 0.1mm 为单位保存纸张，四舍五入后可能差零点几毫米。
  test('treats sizes within 1mm as the same paper', () => {
    expect(isSamePaper({ widthMm: 60.4, heightMm: 39.8 }, { widthMm: 60, heightMm: 40 })).toBe(true);
    expect(isSamePaper({ widthMm: 100, heightMm: 177 }, { widthMm: 100, heightMm: 180 })).toBe(false);
  });

  test('treats swapped width and height as a different paper', () => {
    expect(isSamePaper({ widthMm: 40, heightMm: 60 }, { widthMm: 60, heightMm: 40 })).toBe(false);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `bun test src/shared/paper-sizes.test.ts`
Expected: FAIL，`Cannot find module './paper-sizes'`

- [ ] **Step 3：实现 `src/shared/paper-sizes.ts`**

```ts
/**
 * 纸张尺寸：模板用多大的纸、打印机装的是多大的纸，都用它描述。纸张用纸张键（宽x高）识别，尺寸相同就是同一种纸。
 *
 * 快递面单的尺寸和各联高度（切点）来自电商平台的标准电子面单说明和面单服务商公开的模板规格汇总（2026-09 查询，
 * 多个来源互相印证），并参考国家标准 GB/T 41833-2022《快递电子运单》。以各快递官方模板规范为准：
 * 做面单模板（第 3 个子项目）前取得官方规范，不一致就改这里。
 */

export interface PaperSize {
  widthMm: number;
  heightMm: number;
}

export interface PaperPreset extends PaperSize {
  name: string;
  /** 二联、三联面单默认的每一联高度（mm），从上到下；一联和普通标签为空。面单模板可以声明自己的切点。 */
  parts: readonly number[];
  /** 用在哪些地方（只用于显示）。 */
  usage: string;
}

/**
 * 自定义尺寸的范围：覆盖所有预设并留出余量。下限 25mm：边距最大 6mm 时，二维码仍放得下最小边长 10mm。
 * 宽度上限 120mm：不做横版纸（例如 150×100）。
 */
export const PAPER_LIMITS_MM = {
  width: { min: 25, max: 120 },
  height: { min: 25, max: 220 },
} as const;

/** 驱动以 0.1mm 为单位保存纸张尺寸，四舍五入后可能差零点几毫米。 */
export const PAPER_TOLERANCE_MM = 1;

/** 尺寸保留到 0.1mm：驱动和打印页面的精度都是这个量级。 */
const TENTHS_PER_MM = 10;

export const PAPER_PRESETS: readonly PaperPreset[] = [
  { name: '60×40 标签', widthMm: 60, heightMm: 40, parts: [], usage: '样衣标签（内置模板）' },
  { name: '50×30 标签', widthMm: 50, heightMm: 30, parts: [], usage: '小标签' },
  { name: '40×30 标签', widthMm: 40, heightMm: 30, parts: [], usage: '小标签' },
  { name: '70×50 标签', widthMm: 70, heightMm: 50, parts: [], usage: '标签' },
  { name: '100×100 标签', widthMm: 100, heightMm: 100, parts: [], usage: '标签、箱唛' },
  { name: '76×130 一联面单', widthMm: 76, heightMm: 130, parts: [], usage: '申通、极兔、中通、圆通、韵达' },
  { name: '100×150 二联面单', widthMm: 100, heightMm: 150, parts: [90, 60], usage: '顺丰、申通、EMS' },
  { name: '100×177 面单', widthMm: 100, heightMm: 177, parts: [107, 70], usage: '德邦' },
  {
    name: '100×180 二联面单',
    widthMm: 100,
    heightMm: 180,
    parts: [110, 70],
    usage: '申通、极兔、中通、圆通、韵达、顺丰、EMS',
  },
  { name: '100×203 二联面单', widthMm: 100, heightMm: 203, parts: [152, 51], usage: '韵达' },
  { name: '100×210 三联面单', widthMm: 100, heightMm: 210, parts: [90, 60, 60], usage: '顺丰' },
  { name: '100×110 二联面单', widthMm: 100, heightMm: 110, parts: [60, 50], usage: '京东' },
];

function roundMm(mm: number): number {
  return Math.round(mm * TENTHS_PER_MM) / TENTHS_PER_MM;
}

/** 纸张分配表的键：宽x高（毫米，去掉多余的 0），例如 60x40、76.5x130。 */
export function paperKey(paper: PaperSize): string {
  return `${roundMm(paper.widthMm)}x${roundMm(paper.heightMm)}`;
}

const PAPER_KEY_PATTERN = /^(\d+(?:\.\d)?)x(\d+(?:\.\d)?)$/;

export function parsePaperKey(key: string): PaperSize | null {
  const match = PAPER_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  const paper = { widthMm: Number(match[1]), heightMm: Number(match[2]) };
  return isWithinLimits(paper) ? paper : null;
}

export function isSamePaper(a: PaperSize, b: PaperSize): boolean {
  return (
    Math.abs(a.widthMm - b.widthMm) <= PAPER_TOLERANCE_MM && Math.abs(a.heightMm - b.heightMm) <= PAPER_TOLERANCE_MM
  );
}

export function findPreset(paper: PaperSize): PaperPreset | null {
  const key = paperKey(paper);
  return PAPER_PRESETS.find((preset) => paperKey(preset) === key) ?? null;
}

/** 例如「60×40 标签」；不是预设时「88×55」。 */
export function formatPaperName(paper: PaperSize): string {
  return findPreset(paper)?.name ?? `${roundMm(paper.widthMm)}×${roundMm(paper.heightMm)}`;
}

export function sanitizePaper(value: unknown, fallback: PaperSize): PaperSize {
  const copy = { widthMm: fallback.widthMm, heightMm: fallback.heightMm };
  if (typeof value !== 'object' || value === null) {
    return copy;
  }
  const input = value as Record<string, unknown>;
  const widthMm = input['widthMm'];
  const heightMm = input['heightMm'];
  if (typeof widthMm !== 'number' || typeof heightMm !== 'number') {
    return copy;
  }
  const paper = { widthMm: roundMm(widthMm), heightMm: roundMm(heightMm) };
  return isWithinLimits(paper) ? paper : copy;
}

function isWithinLimits(paper: PaperSize): boolean {
  const { width, height } = PAPER_LIMITS_MM;
  return (
    Number.isFinite(paper.widthMm) &&
    Number.isFinite(paper.heightMm) &&
    paper.widthMm >= width.min &&
    paper.widthMm <= width.max &&
    paper.heightMm >= height.min &&
    paper.heightMm <= height.max
  );
}
```

- [ ] **Step 4：`label-paper.ts` 加缺省纸张**（`LABEL_PAPER_MM` 先保留，4.5 删）

```ts
import type { PaperSize } from './paper-sizes';

/** 内置模板和旧数据（没有纸张字段）的纸张：60×40mm 背胶热敏标签。冻结：各处共用这一个对象。 */
export const DEFAULT_PAPER: Readonly<PaperSize> = Object.freeze({ widthMm: 60, heightMm: 40 });

/** 旧写法，逐步换成模板的纸张；4.5 删除。 */
export const LABEL_PAPER_MM = { width: DEFAULT_PAPER.widthMm, height: DEFAULT_PAPER.heightMm } as const;
```

- [ ] **Step 5：运行测试，`bun run lint:fix && bun run check`，提交**

```bash
git add src/shared/paper-sizes.ts src/shared/paper-sizes.test.ts src/shared/label-paper.ts
git commit -m "feat(paper): paper presets, paper keys and validation"
```

### Task 1.3：模板带纸张和指定打印机

**Files:**
- Modify: `src/core/templates/template-model.ts`（`LabelTemplate`、`TEMPLATE_LIMITS`、`maxQrSizeMm`、`sideTextWidthMm`、`fullTextWidthMm`，新增 `withPaper`）
- Modify: `src/core/templates/sanitize-template.ts`
- Modify: `src/core/templates/builtin-templates.ts`
- Modify: `src/renderer/src/components/TemplateEditor.tsx:120,144`（`maxQrSizeMm` 新签名）
- Modify: `src/core/templates/templates.test.ts:80`、`src/main/storage/sqlite-template-repository.test.ts:4,51`（`maxQrSizeMm` 新签名）
- Test: `src/core/templates/templates.test.ts`、`src/main/storage/sqlite-template-repository.test.ts`

- [ ] **Step 1：写失败的测试**（加到 `templates.test.ts` 末尾；import 按文件现有写法补 `maxQrSizeMm`、`fullTextWidthMm`、`withPaper`、`sanitizeTemplate`、`STANDARD_TEMPLATE`）

```ts
describe('template paper and printer', () => {
  const fallback = STANDARD_TEMPLATE;

  test('an old template without paper is 60x40 with no printer of its own', () => {
    const { paper: _paper, printer: _printer, ...old } = fallback;
    const template = sanitizeTemplate(old, 'custom:old', fallback);
    expect(template.paper).toEqual({ widthMm: 60, heightMm: 40 });
    expect(template.printer).toBeNull();
  });

  test('keeps a waybill paper and a named printer', () => {
    const template = sanitizeTemplate(
      { ...fallback, paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' },
      'custom:waybill',
      fallback,
    );
    expect(template.paper).toEqual({ widthMm: 100, heightMm: 180 });
    expect(template.printer).toBe('面单机B');
  });

  test('treats a blank or oversized printer name as no printer', () => {
    expect(sanitizeTemplate({ ...fallback, printer: '  ' }, 'custom:a', fallback).printer).toBeNull();
    expect(sanitizeTemplate({ ...fallback, printer: 'x'.repeat(257) }, 'custom:a', fallback).printer).toBeNull();
  });

  test('limits the QR code to the short side of the paper', () => {
    const small = sanitizeTemplate(
      { ...fallback, paper: { widthMm: 40, heightMm: 30 }, qr: { ...fallback.qr, sizeMm: 36 } },
      'custom:small',
      fallback,
    );
    expect(small.qr.sizeMm).toBe(maxQrSizeMm(small.paper, small.paddingMm));
  });

  test('measures the text areas on the template paper', () => {
    const wide = { ...fallback, paper: { widthMm: 100, heightMm: 100 } };
    expect(fullTextWidthMm(wide)).toBe(100 - 2 * wide.paddingMm);
  });

  test('moves a template to another paper and shrinks the QR code to fit', () => {
    const moved = withPaper({ ...fallback, qr: { ...fallback.qr, sizeMm: 36 } }, { widthMm: 40, heightMm: 30 });
    expect(moved.paper).toEqual({ widthMm: 40, heightMm: 30 });
    expect(moved.qr.sizeMm).toBe(maxQrSizeMm(moved.paper, moved.paddingMm));
  });
});
```

`sqlite-template-repository.test.ts` 末尾加（沿用文件里建库、建仓库的写法和变量名）：

```ts
test('keeps the paper and printer of a template and reads old rows as 60x40', () => {
  const saved = { ...STANDARD_TEMPLATE, id: 'custom:waybill', paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' };
  repository.save(saved);
  expect(repository.get('custom:waybill')).toMatchObject({ paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' });

  const { paper: _paper, printer: _printer, ...old } = { ...STANDARD_TEMPLATE, id: 'custom:old' };
  db.prepare('INSERT INTO templates (id, body, created_at, updated_at) VALUES (?, ?, 0, 0)').run(
    'custom:old',
    JSON.stringify(old),
  );
  expect(repository.get('custom:old')).toMatchObject({ paper: { widthMm: 60, heightMm: 40 }, printer: null });
});
```

（仓库写入用 `JSON.stringify(template)`，读出经 `sanitizeTemplate(…, STANDARD_TEMPLATE)`（`sqlite-template-repository.ts:32,41`），所以仓库本身不用改；方法名以文件为准。）

- [ ] **Step 2：运行，确认失败**

Run: `bun test src/core/templates src/main/storage/sqlite-template-repository.test.ts`
Expected: FAIL（`paper` 不存在、`maxQrSizeMm` 参数不对、`withPaper` 不存在）

- [ ] **Step 3：实现 `template-model.ts`**

```ts
import type { PaperSize } from '../../shared/paper-sizes';
```

`LabelTemplate` 里 `name` 后面加：

```ts
  /** 用多大的纸：排版、预览软尺和打印页面尺寸都按它；按纸张分配打印机。和版式无关，元素式模板也保留。 */
  paper: PaperSize;
  /** 指定的打印机（系统里的打印机名）；null = 按纸张分配。这台电脑上没有这台打印机时退回按纸张分配。 */
  printer: string | null;
```

`TEMPLATE_LIMITS.qrSizeMm` 改为 `{ min: 10 }`（上限按纸张算，见 `maxQrSizeMm`），加 `printerNameLength: 256`。三个尺寸函数和 `withPaper`：

```ts
/** 二维码允许的最大边长：纸张的短边去掉两边的边距。60×40 时是 40 − 2 × 边距，和原来一样。 */
export function maxQrSizeMm(paper: PaperSize, paddingMm: number): number {
  return Math.min(paper.widthMm, paper.heightMm) - 2 * paddingMm;
}

/** 二维码旁字段区的可用宽度（mm）。 */
export function sideTextWidthMm(template: LabelTemplate): number {
  const qrWidth = template.qr.visible ? template.qr.sizeMm + LAYOUT_GAP_MM : 0;
  return template.paper.widthMm - 2 * template.paddingMm - qrWidth;
}

/** 底部整行的可用宽度（mm）。 */
export function fullTextWidthMm(template: LabelTemplate): number {
  return template.paper.widthMm - 2 * template.paddingMm;
}

/** 换一种纸打同一个模板（测试页按打印机负责的纸打印、编辑器换纸张）：二维码边长夹到新纸张的上限内。 */
export function withPaper(template: LabelTemplate, paper: PaperSize): LabelTemplate {
  const sizeMm = Math.min(template.qr.sizeMm, maxQrSizeMm(paper, template.paddingMm));
  return { ...template, paper: { ...paper }, qr: { ...template.qr, sizeMm } };
}
```

- [ ] **Step 4：实现 `sanitize-template.ts`**

```ts
import { DEFAULT_PAPER } from '../../shared/label-paper';
import { sanitizePaper } from '../../shared/paper-sizes';
```

`sanitizeTemplate` 里：

```ts
  const paper = sanitizePaper(input['paper'], fallback.paper ?? DEFAULT_PAPER);
  const padding = clamp(input['paddingMm'], paddingMm.min, paddingMm.max, fallback.paddingMm);
  return {
    id,
    name: sanitizeText(input['name'], nameLength, fallback.name).trim() || fallback.name,
    paper,
    printer: sanitizePrinterName(input['printer']),
    paddingMm: padding,
    // …原有字段不变，只改二维码上限（clamp 本身会把缺省值也夹进范围）：
    qr: {
      visible: bool(qrInput['visible'], fallback.qr.visible),
      sizeMm: clamp(qrInput['sizeMm'], qrSizeMm.min, maxQrSizeMm(paper, padding), fallback.qr.sizeMm),
      // …
    },
```

文件末尾加：

```ts
/** 打印机名只保存、只比较，交给系统命令之前主进程会先核对它在系统里存在；空白或超长当作不指定。 */
function sanitizePrinterName(value: unknown): string | null {
  const { printerNameLength } = TEMPLATE_LIMITS;
  return typeof value === 'string' && value.trim() !== '' && value.length <= printerNameLength ? value : null;
}
```

- [ ] **Step 5：内置模板**：`builtin-templates.ts` 每个模板加 `paper: { ...DEFAULT_PAPER }, printer: null`。

- [ ] **Step 6：跟上新签名的调用方**
  - `TemplateEditor.tsx:120`：`maxQrSizeMm(paddingMm)` → `maxQrSizeMm(draft.paper, paddingMm)`
  - `TemplateEditor.tsx:144`：`maxQrSizeMm(draft.paddingMm)` → `maxQrSizeMm(draft.paper, draft.paddingMm)`
  - `templates.test.ts:80`：→ `maxQrSizeMm(STANDARD_TEMPLATE.paper, TEMPLATE_LIMITS.paddingMm.max)`
  - `sqlite-template-repository.test.ts:51`：→ `maxQrSizeMm(STANDARD_TEMPLATE.paper, STANDARD_TEMPLATE.paddingMm)`

- [ ] **Step 7：运行测试和快照**

Run: `bun test src/core/templates src/main/storage/sqlite-template-repository.test.ts src/main/printing`
Expected: PASS（60×40 快照不变）

- [ ] **Step 8：`bun run lint:fix && bun run check`，提交**

```bash
git add src/core/templates src/main/storage/sqlite-template-repository.test.ts src/renderer/src/components/TemplateEditor.tsx
git commit -m "feat(templates): templates carry their paper size and an optional printer"
```

---

## 阶段 2：排版和打印按纸张

**目标**：标签 HTML、打印页面尺寸、二维码对齐按模板纸张和打印机分辨率；驱动纸张和分辨率短时缓存。
**成功标准**：
- 50×30、70×50、100×100 放得下；
- 60×40 快照不变；
- 300dpi、600dpi 下二维码模块不小于 0.25mm；
- Windows 和 macOS 各实打一张 60×40。

**状态**：Complete

### Task 2.1：二维码按打印机分辨率对齐

**Files:**
- Modify: `src/main/printing/qr-code.ts`
- Test: `src/main/printing/qr-code.test.ts`（`PRINTER_DOT_MM` 的 import 换成 `dotMm`）

- [ ] **Step 1：写失败的测试**

```ts
test('aligns modules to the dots of a 300dpi printer', () => {
  const plan = planQr('CL5640-TK-图片色-XL', 'M', 20, 300);
  if (!plan) throw new Error('expected a QR plan');
  expect(plan.sizeMm / dotMm(300)).toBeCloseTo(plan.moduleCount * plan.moduleDots, 6);
});

// 模块的最小、最大尺寸按毫米定：分辨率高的打印机不能把二维码打得更小，也不能小到扫不出。
test('keeps modules at least 0.25mm on a 600dpi printer', () => {
  const plan = planQr('CL5640-TK-图片色-XL', 'M', 20, 600);
  if (!plan) throw new Error('expected a QR plan');
  expect(plan.moduleDots * dotMm(600)).toBeGreaterThanOrEqual(0.24);
});

test('prints short content about as large at 600dpi as at 203dpi', () => {
  const low = planQr('1', 'L', 36);
  const high = planQr('1', 'L', 36, 600);
  if (!low || !high) throw new Error('expected QR plans');
  expect(Math.abs(high.sizeMm - low.sizeMm)).toBeLessThan(1);
});

test('uses 203dpi when the printer does not say', () => {
  expect(planQr('ABC', 'M', 20)).toEqual(planQr('ABC', 'M', 20, DEFAULT_PRINTER_DPI));
});
```

原有第 12 行 `PRINTER_DOT_MM` 改为 `dotMm(DEFAULT_PRINTER_DPI)`。

- [ ] **Step 2：运行，确认失败**：`bun test src/main/printing/qr-code.test.ts` → FAIL

- [ ] **Step 3：实现**（替换文件开头的常量，`planQr` 按下面改）

```ts
/**
 * 热敏标签机最常见的分辨率 203dpi（打印头一个点 ≈ 0.125mm）；驱动报告了分辨率时按驱动的（例如 300dpi）。
 * 二维码每个模块取整数个点：模块边缘落在点与点之间，打出来宽窄一致、边缘清晰；
 * 不是整数个点时，有的模块多一个点、有的少一个点，扫码枪容易读错。
 */
export const DEFAULT_PRINTER_DPI = 203;
const MM_PER_INCH = 25.4;
/** 在 203dpi 上：模块至少 2 个点（约 0.25mm），再小扫码枪和手机都很难稳定识别。 */
export const MIN_MODULE_DOTS = 2;
/** 在 203dpi 上：模块最多 8 个点（约 1mm），内容很短时二维码不会撑满方框，和文字之间始终留出静区。 */
export const MAX_MODULE_DOTS = 8;

export function dotMm(dpi: number): number {
  return MM_PER_INCH / dpi;
}

/** 其他分辨率按比例换算点数，模块的实际毫米数和 203dpi 时一样。 */
export function moduleDotLimits(dpi: number): { min: number; max: number } {
  const scale = dpi / DEFAULT_PRINTER_DPI;
  return {
    min: Math.max(1, Math.round(MIN_MODULE_DOTS * scale)),
    max: Math.max(1, Math.round(MAX_MODULE_DOTS * scale)),
  };
}

export function planQr(
  text: string,
  preferred: QrErrorLevel,
  boxMm: number,
  dpi: number = DEFAULT_PRINTER_DPI,
): QrPlan | null {
  const dot = dotMm(dpi);
  const limits = moduleDotLimits(dpi);
  const boxDots = Math.floor(boxMm / dot + 1e-9);
  const levels = QR_ERROR_LEVELS.slice(0, QR_ERROR_LEVELS.indexOf(preferred) + 1).reverse();
  for (const level of levels) {
    const modules = createModules(text, level);
    if (!modules) {
      continue;
    }
    const moduleDots = Math.min(limits.max, Math.floor(boxDots / modules.size));
    if (moduleDots >= limits.min) {
      return {
        svg: modulesToSvg(modules),
        level,
        moduleCount: modules.size,
        moduleDots,
        sizeMm: modules.size * moduleDots * dot,
      };
    }
  }
  return null;
}
```

删掉 `PRINTER_DPI`、`PRINTER_DOT_MM`（`grep -rn "PRINTER_DPI\|PRINTER_DOT_MM" src e2e scripts` 只剩 qr-code.test.ts，Step 1 已改掉）。

- [ ] **Step 4：`bun test src/main/printing`**：新旧测试和 60×40 快照都通过

- [ ] **Step 5：`bun run lint:fix && bun run check`，提交** `feat(printing): align QR modules to the printer's own resolution`

### Task 2.2：标签 HTML 按模板纸张

**Files:**
- Modify: `src/main/printing/label-html.ts:44-99`
- Test: `src/main/printing/label-html.test.ts`

- [ ] **Step 1：写失败的测试**（用文件里现有的 `GARMENT`、`PRINTED_AT`；import 补 `maxQrSizeMm`、`type LabelJob`、`type PaperSize`）

```ts
describe('paper sizes', () => {
  const job = (paper: PaperSize): LabelJob => ({
    scan: GARMENT,
    template: {
      ...STANDARD_TEMPLATE,
      paper,
      qr: {
        ...STANDARD_TEMPLATE.qr,
        sizeMm: Math.min(STANDARD_TEMPLATE.qr.sizeMm, maxQrSizeMm(paper, STANDARD_TEMPLATE.paddingMm)),
      },
    },
    printedAt: PRINTED_AT,
  });

  test.each([
    { widthMm: 50, heightMm: 30 },
    { widthMm: 70, heightMm: 50 },
    { widthMm: 100, heightMm: 100 },
  ])('lays out a $widthMm x $heightMm label on that paper', (paper) => {
    const { html, qrOmitted } = renderLabelHtml(job(paper));
    expect(html).toContain(`${paper.widthMm}mm ${paper.heightMm}mm`);
    expect(qrOmitted).toBe(false);
  });

  test('aligns the QR code to the resolution it is given', () => {
    const label = job({ widthMm: 60, heightMm: 40 });
    expect(renderLabelHtml(label, 300).html).not.toBe(renderLabelHtml(label, 203).html);
  });
});
```

（期望的 `@page size` 写法先 `grep -n "@page" src/main/printing/label-html.ts` 核对；上面只断言「宽mm 高mm」这一段。）

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**
  - 签名改为 `renderLabelHtml(job: LabelJob, dpi: number = DEFAULT_PRINTER_DPI)`。
  - 取纸张处改为：

    ```ts
      const { widthMm: width, heightMm: height } = template.paper;
    ```

  - `planQr(…, template.qr.sizeMm)` 改为 `planQr(…, template.qr.sizeMm, dpi)`。
  - 删掉 `LABEL_PAPER_MM` 的 import；注释里「60×40mm 标签」改为「按模板的纸张」。

- [ ] **Step 4：`bun test src/main/printing`**：新测试和 60×40 快照都通过

- [ ] **Step 5：`bun run lint:fix && bun run check`，提交** `feat(printing): lay labels out on the template's paper`

### Task 2.3：打印机资料（驱动纸张 + 分辨率）

**Files:**
- Create: `src/main/printing/printer-profiles.ts`
- Test: `src/main/printing/printer-profiles.test.ts`
- Modify: `src/shared/driver-paper.ts`（`checkDriverPaper(paper, expected = DEFAULT_PAPER)`；`PAPER_TOLERANCE_MM` 改从 `paper-sizes.ts` 取）
- Test: `src/shared/driver-paper.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { PRINTER_PROFILE_TTL_MS, PrinterProfiles } from './printer-profiles';

const LABEL = { widthMm: 60, heightMm: 40, dpi: 300 };
const never = () => new Promise<void>(() => {});
const immediately = () => Promise.resolve();

describe('PrinterProfiles', () => {
  test('reads a printer once and reuses it for a while', async () => {
    const clock = new FakeClock();
    let reads = 0;
    const read = async () => {
      reads += 1;
      return LABEL;
    };
    const profiles = new PrinterProfiles(read, clock, never);
    expect(await profiles.get('标签机A')).toEqual(LABEL);
    await profiles.get('标签机A');
    expect(reads).toBe(1);
    clock.advance(PRINTER_PROFILE_TTL_MS);
    await profiles.get('标签机A');
    expect(reads).toBe(2);
  });

  test('reads again after being told the driver settings changed', async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return LABEL;
    };
    const profiles = new PrinterProfiles(read, new FakeClock(), never);
    await profiles.get('标签机A');
    profiles.forget('标签机A');
    await profiles.get('标签机A');
    expect(reads).toBe(2);
  });

  test('gives 203dpi when the driver does not report a resolution', async () => {
    const profiles = new PrinterProfiles(async () => null, new FakeClock(), never);
    expect(await profiles.dpiOf('标签机A')).toBe(203);
  });

  // 打印时不能等冷查询（Windows 上最长约 10 秒）：等不到就按 203dpi 打，查询照常在后台完成并缓存。
  test('does not hold up printing while the driver is slow to answer', async () => {
    const profiles = new PrinterProfiles(() => new Promise(() => {}), new FakeClock(), immediately);
    expect(await profiles.dpiOf('标签机A')).toBe(203);
  });

  test('treats a failed read as unknown', async () => {
    const read = async () => {
      throw new Error('probe crashed');
    };
    const profiles = new PrinterProfiles(read, new FakeClock(), never);
    expect(await profiles.get('标签机A')).toBeNull();
  });
});
```

`driver-paper.test.ts`：原有用例不变（第二个参数有缺省值），再加：

```ts
test('checks the driver paper against the paper it is expected to hold', () => {
  const waybill = { widthMm: 100, heightMm: 180, dpi: 203 };
  expect(checkDriverPaper(waybill, { widthMm: 100, heightMm: 180 }).status).toBe('ok');
  expect(checkDriverPaper(waybill, DEFAULT_PAPER).status).toBe('mismatch');
});
```

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现 `printer-profiles.ts`**

```ts
import type { Clock } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { DEFAULT_PRINTER_DPI } from './qr-code';

/** 驱动设置很少变；1 分钟内重复打印、预览不必每次都去查（Windows 上一次查询约耗 1 秒 CPU）。 */
export const PRINTER_PROFILE_TTL_MS = 60_000;
/** 打印时最多等驱动资料这么久：冷查询最长约 10 秒（PROBE_QUERY_TIMEOUT_MS），不能拖慢出纸；等不到按 203dpi。 */
export const PROFILE_WAIT_MS = 1_000;

interface Entry {
  at: number;
  paper: Promise<DriverPaper | null>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 每台打印机的驱动默认纸张和分辨率，短时缓存。查询失败按「读不到」处理，不影响打印。 */
export class PrinterProfiles {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly read: (printerName: string) => Promise<DriverPaper | null>,
    private readonly clock: Clock,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  get(printerName: string): Promise<DriverPaper | null> {
    const cached = this.entries.get(printerName);
    if (cached && this.clock.now() - cached.at < PRINTER_PROFILE_TTL_MS) {
      return cached.paper;
    }
    const paper = this.read(printerName).catch((error: unknown) => {
      console.warn(`[PrinterProfiles] cannot read the driver paper of ${printerName}`, error);
      return null;
    });
    this.entries.set(printerName, { at: this.clock.now(), paper });
    return paper;
  }

  /** 打印用的分辨率：限时等待，等不到或读不到按 203dpi。 */
  async dpiOf(printerName: string): Promise<number> {
    const paper = await Promise.race([this.get(printerName), this.wait(PROFILE_WAIT_MS).then(() => null)]);
    return paper?.dpi ?? DEFAULT_PRINTER_DPI;
  }

  /** 操作员刚在打印首选项里改过设置：下次重新读。 */
  forget(printerName: string): void {
    this.entries.delete(printerName);
  }
}
```

`driver-paper.ts`：

```ts
export function checkDriverPaper(paper: DriverPaper | null, expected: PaperSize = DEFAULT_PAPER): PaperCheck {
  if (paper === null) {
    return { status: 'unknown' };
  }
  return { status: isSamePaper(paper, expected) ? 'ok' : 'mismatch', paper };
}
```

删掉本文件里的 `PAPER_TOLERANCE_MM`，改用 `paper-sizes.ts` 的（`grep -rn PAPER_TOLERANCE_MM src` 核对没有别的用处）。第二个参数有缺省值，所以 `src/main/ipc.ts:152` 的旧调用照常编译，Task 2.4 再换掉。

- [ ] **Step 4：运行，确认通过**；**Step 5：`bun run lint:fix && bun run check`，提交** `feat(printing): cache each printer's driver paper and resolution`

### Task 2.4：打印页面尺寸按模板纸张，驱动资料接到打印和 IPC

**Files:**
- Create: `src/main/printing/page-size.ts`、`src/main/printing/page-size.test.ts`
- Modify: `src/main/printing/electron-driver-adapter.ts`
- Modify: `src/main/index.ts`（创建 `PrinterProfiles`，交给适配器和 IPC）
- Modify: `src/main/ipc.ts`（`IpcDeps.profiles`；`CheckDriverPaper` 用缓存；`OpenPrinterPreferences` 之后 `forget`）

- [ ] **Step 1：写失败的测试**（`page-size.ts` 不依赖 Electron，能用 bun test）

```ts
import { expect, test } from 'bun:test';
import { pageSizeMicrons } from './page-size';

test('turns the paper into the page size Electron prints with', () => {
  expect(pageSizeMicrons({ widthMm: 60, heightMm: 40 })).toEqual({ width: 60_000, height: 40_000 });
  expect(pageSizeMicrons({ widthMm: 76.5, heightMm: 130 })).toEqual({ width: 76_500, height: 130_000 });
});
```

- [ ] **Step 2：失败** → **Step 3：实现**

```ts
import type { PaperSize } from '../../shared/paper-sizes';

const MICRONS_PER_MM = 1_000;

/** webContents.print 的 pageSize 以微米为单位；取整：0.1mm 精度的纸张不会产生小数。 */
export function pageSizeMicrons(paper: PaperSize): { width: number; height: number } {
  return { width: Math.round(paper.widthMm * MICRONS_PER_MM), height: Math.round(paper.heightMm * MICRONS_PER_MM) };
}
```

- [ ] **Step 4：适配器**：构造参数加 `private readonly profiles: PrinterProfiles`（放在最后）；`print()` 里

```ts
    const dpi = await this.profiles.dpiOf(printerName);
    const { html } = renderLabelHtml(job, dpi);
    // …
      await printSilently(printWindow.webContents, printerName, pageSizeMicrons(job.template.paper), signal);
```

  - `printSilently` 的参数加 `pageSize: { width: number; height: number }`，直接交给 `webContents.print`；
  - 删掉 `MICRONS_PER_MM` 和 `LABEL_PAPER_MM` 的 import。

- [ ] **Step 5：`index.ts`**：在 `probeHost` 创建之后、适配器之前

```ts
  const profiles = new PrinterProfiles((name) => queryDriverPaper(name, probeHost), systemClock);
  const adapter = new ElectronDriverAdapter(requireWebContents, status, systemClock, profiles);
```

  import `queryDriverPaper`（`./printing/driver-paper`）和 `PrinterProfiles`；`registerIpc({ …, profiles })`。

- [ ] **Step 6：`ipc.ts`**：`IpcDeps` 加 `profiles: PrinterProfiles;`。两个处理函数：

```ts
  handle(IpcChannel.CheckDriverPaper, async (printerName) =>
    checkDriverPaper(await deps.profiles.get(await requireKnownPrinter(printerName))),
  );
  handle(IpcChannel.OpenPrinterPreferences, async (printerName) => {
    const name = await requireKnownPrinter(printerName);
    await openPrinterPreferences(name);
    // 操作员可能刚改了纸张：界面随后重新检查时要读到新的设置。
    deps.profiles.forget(name);
  });
```

  `ipc.ts` 里不再用 `queryDriverPaper` 时去掉它的 import；`probeHost` 在 IPC 里没有别的用处时，一并从 `IpcDeps` 去掉。

- [ ] **Step 7：检查**：`bun run lint:fix && bun run check`；再跑 `bun run test:e2e`。E2E 替换了打印的 IPC，不经过适配器，所以这里只证明没有接坏。

- [ ] **Step 8：真机**：在 Windows 和 macOS 上用开发版（`bun run dev`）各打一张 60×40，核对出纸和原来一样；结果写进提交说明。

- [ ] **Step 9：提交** `feat(printing): print each label at its template's paper size`

---

## 阶段 3：按模板决定打印机

**目标**：
- 主进程按「模板指定 → 纸张分配」决定打印机；
- 没有打印机时不打、不记；
- 手机、记录重打走同一套规则；
- 打印记录带纸张和模板；
- 同时检测多台打印机的状态；
- E2E 能用假打印机验证。

**成功标准**：每个提交都通过 `bun run check`；阶段结束时 `bun run test:e2e`、`bun run test:relay-browser` 通过。
**状态**：Complete

提交顺序（每个都能单独通过检查）：3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8（切换，一个提交）。

### Task 3.1：`resolvePrinter`

**Files:**
- Create: `src/core/printing/resolve-printer.ts`
- Test: `src/core/printing/resolve-printer.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { resolvePrinter } from './resolve-printer';

const LABEL = { paper: { widthMm: 60, heightMm: 40 }, printer: null };
const WAYBILL = { paper: { widthMm: 100, heightMm: 180 }, printer: null };
const ASSIGNED = { '60x40': '标签机A', '100x180': '面单机B' };
const INSTALLED = ['标签机A', '面单机B', '面单机C'];

describe('resolvePrinter', () => {
  test('sends each paper to the printer assigned to it', () => {
    expect(resolvePrinter(LABEL, ASSIGNED, INSTALLED)).toEqual({ printerName: '标签机A', reason: 'paper' });
    expect(resolvePrinter(WAYBILL, ASSIGNED, INSTALLED)).toEqual({ printerName: '面单机B', reason: 'paper' });
  });

  test('prefers the printer the template names', () => {
    expect(resolvePrinter({ ...WAYBILL, printer: '面单机C' }, ASSIGNED, INSTALLED)).toEqual({
      printerName: '面单机C',
      reason: 'template',
    });
  });

  // 打印机改了名、数据库搬到别的电脑：不能打到不相关的打印机上，退回按纸张分配并说明原因。
  test('falls back to the paper assignment when the named printer is not here', () => {
    expect(resolvePrinter({ ...WAYBILL, printer: '别的电脑上的打印机' }, ASSIGNED, INSTALLED)).toEqual({
      printerName: '面单机B',
      reason: 'template-missing',
      missingPrinter: '别的电脑上的打印机',
    });
  });

  test('has no printer when the paper is not assigned', () => {
    expect(resolvePrinter({ paper: { widthMm: 100, heightMm: 150 }, printer: null }, ASSIGNED, INSTALLED)).toEqual({
      printerName: null,
      reason: 'unassigned',
      paperKey: '100x150',
      missingPrinter: null,
    });
  });

  test('says both things when the named printer is missing and the paper is unassigned', () => {
    const target = { paper: { widthMm: 100, heightMm: 150 }, printer: '面单机D' };
    expect(resolvePrinter(target, ASSIGNED, INSTALLED)).toEqual({
      printerName: null,
      reason: 'unassigned',
      paperKey: '100x150',
      missingPrinter: '面单机D',
    });
  });

  test('matches a paper assigned as a slightly different size', () => {
    const choice = resolvePrinter({ paper: { widthMm: 60.3, heightMm: 40 }, printer: null }, ASSIGNED, INSTALLED);
    expect(choice.printerName).toBe('标签机A');
  });

  // 分配到的打印机拔掉了：不悄悄换打印机，照样交给它，由适配器报「找不到打印机」（和现在一样）。
  test('keeps an assigned printer even when it is not installed', () => {
    expect(resolvePrinter(LABEL, ASSIGNED, []).printerName).toBe('标签机A');
  });
});
```

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**

```ts
import { isSamePaper, type PaperSize, paperKey, parsePaperKey } from '../../shared/paper-sizes';

/** 决定打印机只需要模板的这两项。 */
export interface PrinterTarget {
  paper: PaperSize;
  printer: string | null;
}

export type PrinterChoice =
  | { printerName: string; reason: 'template' | 'paper' }
  /** 模板指定的打印机不在这台电脑上，已退回按纸张分配。 */
  | { printerName: string; reason: 'template-missing'; missingPrinter: string }
  /** 这种纸没有分配打印机（模板指定的也不在时 missingPrinter 是它的名字）：不打印。 */
  | { printerName: null; reason: 'unassigned'; paperKey: string; missingPrinter: string | null };

/**
 * 用哪台打印机：模板指定的（这台电脑上有）→ 纸张分配的 → 没有。
 * installed 是系统里的打印机名；纸张分配按宽松相等匹配（驱动和模板的尺寸可能差零点几毫米）。
 */
export function resolvePrinter(
  target: PrinterTarget,
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
): PrinterChoice {
  if (target.printer !== null && installed.includes(target.printer)) {
    return { printerName: target.printer, reason: 'template' };
  }
  const assigned = findAssigned(target.paper, paperPrinters);
  if (assigned === null) {
    return {
      printerName: null,
      reason: 'unassigned',
      paperKey: paperKey(target.paper),
      missingPrinter: target.printer,
    };
  }
  return target.printer === null
    ? { printerName: assigned, reason: 'paper' }
    : { printerName: assigned, reason: 'template-missing', missingPrinter: target.printer };
}

function findAssigned(paper: PaperSize, paperPrinters: Readonly<Record<string, string>>): string | null {
  const exact = paperPrinters[paperKey(paper)];
  if (exact !== undefined) {
    return exact;
  }
  for (const [key, printer] of Object.entries(paperPrinters)) {
    const assigned = parsePaperKey(key);
    if (assigned !== null && isSamePaper(assigned, paper)) {
      return printer;
    }
  }
  return null;
}
```

- [ ] **Step 4：通过**；**Step 5：`bun run lint:fix && bun run check`，提交** `feat(printing): resolve the printer from a template and the paper assignment`

### Task 3.2：打印记录加纸张和模板

**Files:**
- Modify: `src/core/types.ts`（`JobRecord` 加两个可选字段）
- Modify: `src/main/storage/migrations.ts`（末尾追加第 2 条）
- Modify: `src/main/storage/sqlite-job-store.ts`（`JOB_COLUMNS`、插入语句、`toJobRecord`）
- Test: `src/main/storage/sqlite-job-store.test.ts`、`src/main/storage/database.test.ts`

- [ ] **Step 1：写失败的测试**

`sqlite-job-store.test.ts`（用文件里的 `job(n, overrides)` 和 `listPage`）：

```ts
test('keeps the paper and template of each job and leaves them empty for 1.0.x jobs', () => {
  const store = new SqliteJobStore(db, 10);
  store.append(job(1, { paper: '100x180', templateId: 'custom:waybill' }));
  store.append(job(2));
  const { jobs } = store.listPage({ limit: 10 });
  expect(jobs.find((item) => item.id === 'job-1')).toMatchObject({ paper: '100x180', templateId: 'custom:waybill' });
  const old = jobs.find((item) => item.id === 'job-2');
  expect(old?.paper).toBeUndefined();
  expect(old?.templateId).toBeUndefined();
});
```

`database.test.ts`（`migrate` 已导出，可以只跑前几条迁移）：

```ts
test('adds the paper and template columns to an existing 1.0.x database', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS.slice(0, 1));
  db.prepare(
    "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('old', 1, 'A', 'P', 'desktop', 'printed', 0)",
  ).run();
  migrate(db);
  expect(db.prepare("SELECT paper, template_id FROM jobs WHERE id = 'old'").get()).toEqual({
    paper: null,
    template_id: null,
  });
  db.close();
});
```

（import：`DatabaseSync` 来自 `node:sqlite`，`migrate` 来自 `./database`，`MIGRATIONS` 来自 `./migrations`。）

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**
  - `types.ts` 的 `JobRecord` 加：

```ts
  /** 这一张的纸张键（例如 100x180）；1.0.x 的旧记录和识别不了的记录没有。 */
  paper?: string;
  /** 这一张用的模板；1.0.x 的旧记录和识别不了的记录没有。 */
  templateId?: string;
```

  - `migrations.ts` 的 `MIGRATIONS` 末尾追加（1.0.1 发布后第一次改表结构，已发布的第 1 条不动）：

```ts
  // 2：打印记录记下纸张和模板（多台打印机、多种纸张）；1.0.x 的旧记录为 NULL。
  // source、failure_reason 的取值检查（CHECK）不在这里改：本机接口（第 2 个子项目）需要新取值时再重建这张表。
  `
  ALTER TABLE jobs ADD COLUMN paper TEXT;
  ALTER TABLE jobs ADD COLUMN template_id TEXT;
  `,
```

  - `sqlite-job-store.ts`：
    - `JOB_COLUMNS` 加 `jobs.paper, jobs.template_id`；
    - 插入语句加两列 `:paper`、`:templateId`，值为 `job.paper ?? null`、`job.templateId ?? null`；
    - `toJobRecord` 里列不为 NULL 时用 `readString` 读出，赋给 `paper`、`templateId`。

- [ ] **Step 4：`bun test src/main/storage`，通过**

- [ ] **Step 5：`bun run lint:fix && bun run check`，提交** `feat(storage): record the paper and template of each print job`

### Task 3.3：打印结果通知带纸张

**Files:**
- Modify: `src/core/notify/webhook-event.ts:12-26,41-55,59-74`
- Test: `src/core/notify/webhook-event.test.ts`

- [ ] **Step 1：写失败的测试**：
  - `payloadOf({ ...job, paper: '100x180' }, scan, station).paper` 为 `'100x180'`；
  - 没有纸张的旧记录为 `null`。

  原有的「测试通知和真实通知的字段一致」用例（第 59–63 行）会要求 `testPayload` 也带 `paper`。
- [ ] **Step 2：失败** → **Step 3：实现**
  - `WebhookPayload` 加一个字段：

    ```ts
    /** 纸张键（例如 100x180）；旧记录和识别不了的记录为 null。新增字段，不影响已有的接收方。 */
    paper: string | null;
    ```

  - `payloadOf` 里写 `paper: job.paper ?? null`；`testPayload` 里写 `paper: paperKey(DEFAULT_PAPER)`。
  - 文档里列了通知字段的地方同步加上（`grep -rn '"printer"' docs README.md`）。
- [ ] **Step 4：通过**；**Step 5：`bun run lint:fix && bun run check`，提交** `feat(notify): include the paper in print result notifications`

### Task 3.4：同时检测几台打印机，通知按打印机限频

**Files:**
- Modify: `src/main/printing/printer-status.ts`（`watch` → `watchPrinters`）
- Modify: `src/main/printing/alert-throttle.ts`（`alertKey`）、`printer-alerts.ts:11`
- Modify: `src/main/index.ts`（暂时只检测旧的「选中的打印机」，3.8 改成全部分配到的）
- Test: `src/main/printing/printer-status.test.ts`（原有三个 `watch` 用例改写）、`alert-throttle.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
describe('PrinterStatusMonitor with several printers', () => {
  test('checks every watched printer and reports each one that stops being ready', async () => {
    const answers = new Map<string, PrinterReadiness | null>([
      ['A', { ready: true }],
      ['B', PAPER_OUT],
    ]);
    const notified: string[] = [];
    const monitor = new PrinterStatusMonitor(
      async (name) => answers.get(name) ?? null,
      (name, detail) => notified.push(`${name}:${detail}`),
    );
    await monitor.watchPrinters(() => ['A', 'B']);
    expect(monitor.get('A')).toEqual({ ready: true });
    expect(monitor.get('B')).toEqual(PAPER_OUT);
    expect(notified).toEqual(['B:缺纸']);
  });

  test('forgets printers that are no longer watched and keeps the others', async () => {
    let names = ['A', 'B'];
    const monitor = new PrinterStatusMonitor(async () => PAPER_OUT);
    await monitor.watchPrinters(() => names);
    names = ['B'];
    await monitor.poll();
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toEqual(PAPER_OUT);
  });

  // 设置保存时会重新检测一次：还在检测的打印机不能因此再报一次同样的问题。
  test('does not report the same problem again after the watch list changes', async () => {
    const notified: string[] = [];
    let names = ['B'];
    const monitor = new PrinterStatusMonitor(async () => PAPER_OUT, (name) => notified.push(name));
    await monitor.watchPrinters(() => names);
    names = ['B', 'C'];
    await monitor.poll();
    expect(notified).toEqual(['B', 'C']);
  });
});
```

`alert-throttle.test.ts`：

```ts
test('counts the cooldown per printer', () => {
  const throttle = new AlertThrottle(new FakeClock());
  expect(throttle.shouldNotify(alertKey('标签机A', '缺纸'))).toBe(true);
  expect(throttle.shouldNotify(alertKey('面单机B', '缺纸'))).toBe(true);
  expect(throttle.shouldNotify(alertKey('标签机A', '缺纸'))).toBe(false);
});
```

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现 `printer-status.ts`**：`watched: string | null` 换成 `watched: () => readonly string[] = () => []`，加 `private polling = false`。

```ts
  /** 要检测哪些打印机：每次轮询都重新取（纸张分配、模板改了不用另外通知）。 */
  watchPrinters(names: () => readonly string[]): Promise<void> {
    this.watched = names;
    return this.poll();
  }

  async poll(): Promise<void> {
    // 上一轮还没查完就跳过：Windows 上一台最长要等 10 秒，几台叠起来不能越积越多。
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const names = [...new Set(this.watched())];
      for (const name of [...this.readiness.keys()]) {
        if (!names.includes(name)) {
          this.readiness.delete(name);
        }
      }
      for (const printerName of names) {
        const result = await this.probe(printerName);
        if (this.watched().includes(printerName)) {
          this.update(printerName, result);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /** 从能打变成不能打（或问题变了）才通知：检测列表变化不会让同样的问题再报一次。 */
  private update(printerName: string, result: PrinterReadiness | null): void {
    const previous = this.readiness.get(printerName);
    if (result) {
      this.readiness.set(printerName, result);
    } else {
      this.readiness.delete(printerName);
    }
    const becameNotReady =
      result !== null &&
      !result.ready &&
      (previous === undefined || previous.ready || previous.detail !== result.detail);
    if (becameNotReady) {
      this.onNotReady(printerName, result.detail);
    }
  }
```

删掉 `watch`。原有三个用例（`printer-status.test.ts:32-77`）要改写：
- `watch('A')` 改成 `watchPrinters(() => ['A'])`；
- 「换一台」改成先改变 getter 的返回值，再调 `poll()`。

- [ ] **Step 4：限频**：`alert-throttle.ts` 加

```ts
/** 限频按「打印机 + 问题」计：一台缺纸不能压住另一台的缺纸通知。 */
export function alertKey(printerName: string, detail: string): string {
  return `${printerName}\u0000${detail}`;
}
```

  `printer-alerts.ts` 改用 `throttle.shouldNotify(alertKey(printerName, detail))`，注释「按问题类型节流」改为「按打印机和问题节流」。

- [ ] **Step 5：`index.ts` 暂时的接线**：
  - 启动时的 `status.watch(...)` 改为：

    ```ts
    void status.watchPrinters(() => (settings.current.selectedPrinter ? [settings.current.selectedPrinter] : []));
    ```

  - `onSettingsChanged` 里，`selectedPrinter` 变了时改为 `void status.poll();`。
  - 名字交给探测进程之前，要先核对它在系统里存在（`src/main/CLAUDE.md` 的规定）。所以状态探测包一层：

    ```ts
    const probe = createReadinessProbe(probeHost);
    const status = new PrinterStatusMonitor(
      async (name) => ((await adapter.hasPrinter(name)) ? probe(name) : null),
      …,
    );
    ```

  - 因为这一层要用 `adapter`，适配器必须先于 `status` 创建。适配器只在打印时读状态，所以它的构造参数从 `status` 换成 `(name: string) => PrinterReadiness | null`，传 `(name) => status.get(name)`。

- [ ] **Step 6：`bun test src/main/printing`，通过；`bun run lint:fix && bun run check`，提交** `feat(printing): watch several printers and throttle alerts per printer`

### Task 3.5：`no-printer` 结果进入类型（先让所有地方认识它）

**Files:**
- Modify: `src/core/types.ts`（`PrintResult`、`PrintStatus`、`RecordedResult`）
- Modify: `src/core/print-service.ts`（`finish`、`failed` 的类型）
- Modify: `src/main/mobile/mobile-replies.ts:13-35`（`toPhonePrintResult`）
- Modify: `src/renderer/src/lib/status-text.ts`（`StatusView.link`、`describeResult`）、`components/PreviewStage.tsx`（`onOpenPage` 类型）、`App.tsx`（暂不处理 `'printers'`）
- Modify: `src/shared/voice.ts:41`（`noPrinter` 文字）
- Modify: `src/shared/print-cues.ts:12`、`src/shared/mobile-protocol.ts:159`（注释）
- Modify: `relay/web/src/result-view.ts:63,169`（手机上「选择打印机」的文字）
- Test: `src/main/mobile/mobile-replies.test.ts`、`src/renderer/src/lib/status-text.test.ts`、`relay/web/src/result-view.test.ts:91`

- [ ] **Step 1：写失败的测试**

`mobile-replies.test.ts`：

```ts
test('tells the phone there is no printer for this paper', () => {
  expect(toPhonePrintResult({ status: 'no-printer', paperKey: '100x180', missingPrinter: null })).toEqual({
    status: 'no-printer',
  });
});
```

`status-text.test.ts`：

```ts
test('tells which paper has no printer and offers to open the printer panel', () => {
  expect(describeResult({ status: 'no-printer', paperKey: '100x180', missingPrinter: null }, NOW)).toEqual({
    tone: 'warning',
    title: '没有可用的打印机',
    detail: '100×180 二联面单 还没有打印机',
    link: { page: 'printers', label: '去指定打印机' },
  });
});

test('says when the printer named by the template is not on this computer', () => {
  const result = { status: 'no-printer', paperKey: '100x180', missingPrinter: '面单机D' } as const;
  expect(describeResult(result, NOW).detail).toBe('模板指定的 面单机D 不在这台电脑上，100×180 二联面单 也还没有打印机');
});
```

`relay/web/src/result-view.test.ts:91` 的期望从「请先选择打印机」改为「没有可用的打印机」。

- [ ] **Step 2：运行，确认失败**：`bun test src/main/mobile src/renderer/src/lib relay/web/src`

- [ ] **Step 3：实现**
- `types.ts`：

```ts
  /** 这种纸没有可用的打印机：没有打印，不写打印记录，不占防重复窗口。 */
  | { status: 'no-printer'; paperKey: string; missingPrinter: string | null };

/** 写进打印记录的结果（no-printer 不写记录）。 */
export type PrintStatus = Exclude<PrintResult['status'], 'no-printer'>;
export type RecordedResult = Exclude<PrintResult, { status: 'no-printer' }>;
```

- `print-service.ts`：
  - `finish(…, result: RecordedResult, …)`；
  - `failed()` 返回 `Extract<PrintResult, { status: 'failed' }>`；
  - `submit` 里构造 `duplicate`、`lookupFailed` 的变量类型改为 `RecordedResult`。
- `mobile-replies.ts`：switch 加 `case 'no-printer': return { status: 'no-printer' };`。
- `status-text.ts`：
  - `StatusView.link` 的类型改为 `{ page: ConfigPage | 'printers'; label: string }`。`'printers'` 指工作台右侧的打印机页，不是配置中心的页面。
  - `PreviewStage` 的 `onOpenPage` 参数类型跟着放宽。App 里收到 `'printers'` 时先什么都不做，右侧标签页的切换在 4.5 接上；这一步只要编译通过。
  - `describeResult` 加：

```ts
    case 'no-printer': {
      const paper = formatPaperName(parsePaperKey(result.paperKey) ?? DEFAULT_PAPER);
      return {
        tone: 'warning',
        title: VOICE_CUE_TEXT.noPrinter,
        detail:
          result.missingPrinter === null
            ? `${paper} 还没有打印机`
            : `模板指定的 ${result.missingPrinter} 不在这台电脑上，${paper} 也还没有打印机`,
        link: { page: 'printers', label: '去指定打印机' },
      };
    }
```

- `voice.ts`：`noPrinter: '没有可用的打印机'`。已经没有「选择打印机」这个操作了；播报和状态栏用同一句。
- `relay/web/src/result-view.ts:63,169`：把「请先在电脑上选择打印机」一类的说法改为「电脑上还没有可用的打印机」。以文件里现有的句子为准，只改「选择打印机」的说法。

- [ ] **Step 4：`bun run lint:fix && bun run check`**（relay 的测试也在 `bun test` 里）；**`bun run test:relay-browser`**

- [ ] **Step 5：提交** `feat(printing): add the no-printer print result`

扫码页的文字变了，需要重新部署中转服务（阶段 5 Step 4）。新文字对旧版桌面程序同样成立，所以可以先于桌面版部署。

### Task 3.6：多台打印机的汇总文字（纯逻辑，标题栏和手机共用）

**Files:**
- Create: `src/shared/printer-summary.ts`
- Test: `src/shared/printer-summary.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { describePrintersSummary, phonePrinterLabel } from './printer-summary';

const READY = { ready: true } as const;
const PAPER_OUT = { ready: false, detail: '缺纸', issue: 'paperOut' } as const;
const A = { name: '标签机A', isListed: true, readiness: READY };
const B = { name: '面单机B', isListed: true, readiness: READY };

describe('describePrintersSummary', () => {
  test('names a single ready printer', () => {
    expect(describePrintersSummary([A])).toEqual({ tone: 'ready', text: '标签机A · 就绪' });
  });

  test('counts several ready printers', () => {
    expect(describePrintersSummary([A, B])).toEqual({ tone: 'ready', text: '打印机 2 台就绪' });
  });

  test('names the first printer with a problem', () => {
    expect(describePrintersSummary([A, { ...B, readiness: PAPER_OUT }])).toEqual({
      tone: 'error',
      text: '面单机B（缺纸）',
    });
  });

  test('says when an assigned printer is gone from the system', () => {
    expect(describePrintersSummary([{ ...A, isListed: false, readiness: null }])).toEqual({
      tone: 'error',
      text: '标签机A（系统里找不到）',
    });
  });

  // macOS 上状态按「未知」处理：只说名字或台数，不说就绪。
  test('does not claim ready when the status is unknown', () => {
    expect(describePrintersSummary([{ ...A, readiness: null }])).toEqual({ tone: 'unknown', text: '标签机A' });
    expect(describePrintersSummary([A, { ...B, readiness: null }])).toEqual({ tone: 'unknown', text: '打印机 2 台' });
  });

  test('says when no printer is assigned', () => {
    expect(describePrintersSummary([])).toEqual({ tone: 'muted', text: '还没有分配打印机' });
  });
});

// 手机页自带「打印机：」前缀（中转服务单独部署），这里不能再带。
describe('phonePrinterLabel', () => {
  test('is the printer name, a count, or nothing', () => {
    expect(phonePrinterLabel([A])).toBe('标签机A');
    expect(phonePrinterLabel([A, { ...B, readiness: null }])).toBe('2 台');
    expect(phonePrinterLabel([A, B])).toBe('2 台就绪');
    expect(phonePrinterLabel([])).toBeNull();
  });
});
```

- [ ] **Step 2：失败** → **Step 3：实现**

```ts
import type { PrinterReadiness } from './printer-readiness';

export interface PrinterSummaryInput {
  /** 显示用的名字。 */
  name: string;
  /** 系统打印机列表里有没有它（拔掉、删掉的打印机仍可能留在分配里）。 */
  isListed: boolean;
  /** null = 未知（尚未查询、查询失败或 macOS）。 */
  readiness: PrinterReadiness | null;
}

export type PrinterSummaryTone = 'ready' | 'unknown' | 'error' | 'muted';

export interface PrinterSummaryView {
  tone: PrinterSummaryTone;
  text: string;
}

/** 标题栏的打印机胶囊：都就绪时说几台，有问题时说出第一台的问题（和原来单台时的写法一致）。 */
export function describePrintersSummary(printers: readonly PrinterSummaryInput[]): PrinterSummaryView {
  const [only] = printers;
  if (!only) {
    return { tone: 'muted', text: '还没有分配打印机' };
  }
  for (const { name, isListed, readiness } of printers) {
    if (!isListed) {
      return { tone: 'error', text: `${name}（系统里找不到）` };
    }
    if (readiness !== null && !readiness.ready) {
      return { tone: 'error', text: `${name}（${readiness.detail}）` };
    }
  }
  const isKnown = printers.every((printer) => printer.readiness !== null);
  if (printers.length === 1) {
    return isKnown ? { tone: 'ready', text: `${only.name} · 就绪` } : { tone: 'unknown', text: only.name };
  }
  return { tone: isKnown ? 'ready' : 'unknown', text: `打印机 ${printers.length} 台${isKnown ? '就绪' : ''}` };
}

/** 手机顶部「打印机：」后面的文字；没有分配打印机时为 null（手机按原来的「没有打印机」显示）。 */
export function phonePrinterLabel(printers: readonly PrinterSummaryInput[]): string | null {
  const [only] = printers;
  if (!only) {
    return null;
  }
  if (printers.length === 1) {
    return only.name;
  }
  const isReady = printers.every((printer) => printer.isListed && printer.readiness?.ready === true);
  return `${printers.length} 台${isReady ? '就绪' : ''}`;
}
```

- [ ] **Step 4：通过**；**Step 5：`bun run lint:fix && bun run check`，提交** `feat(printing): summary text for several printers`

### Task 3.7：E2E 用的假打印机

只在未打包时生效，和 `CDL_LABELFLASH_USER_DATA` 一样。假打印机有名字、驱动纸张和状态；打印只记下来，不碰真打印机。

**Files:**
- Create: `src/main/printing/fake-printers.ts`
- Test: `src/main/printing/fake-printers.test.ts`
- Modify: `src/main/printing/electron-driver-adapter.ts`（导出接口 `PrinterDriver`，加 `knownPrinterNames`）
- Modify: `src/main/index.ts`（有这个环境变量时换掉适配器、驱动纸张查询和状态探测）
- Modify: `src/main/ipc.ts`（`IpcDeps.adapter` 的类型换成 `PrinterDriver`）
- Modify: `e2e/support/electron-app.ts`（`launchApp(userData, options?)`）、`e2e/support/fixtures.ts`（`AppLauncher.launch(options?)`）、`e2e/support/app-helpers.ts`（`fakePrints`）

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import type { LabelJob } from '../../core/types';
import { FAKE_PRINTERS_ENV, FakePrinters, parseFakePrinters } from './fake-printers';

const SPEC = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: null },
];
const JOB: LabelJob = {
  scan: { raw: 'X', ruleId: 'r', ruleName: 'r', fields: [] },
  template: STANDARD_TEMPLATE,
  printedAt: 0,
};

describe('parseFakePrinters', () => {
  test('is off for a packaged app or without the variable', () => {
    expect(parseFakePrinters({ [FAKE_PRINTERS_ENV]: JSON.stringify(SPEC) }, true)).toBeNull();
    expect(parseFakePrinters({}, false)).toBeNull();
  });

  test('reads the printers from the variable', () => {
    expect(parseFakePrinters({ [FAKE_PRINTERS_ENV]: JSON.stringify(SPEC) }, false)).toEqual(SPEC);
  });

  test('fails loudly on a malformed value', () => {
    expect(() => parseFakePrinters({ [FAKE_PRINTERS_ENV]: '[{"name":1}]' }, false)).toThrow(FAKE_PRINTERS_ENV);
  });
});

describe('FakePrinters', () => {
  test('lists, describes and records prints without touching real printers', async () => {
    const printers = new FakePrinters(SPEC);
    expect((await printers.listPrinters()).map((printer) => printer.name)).toEqual(['标签机A', '面单机B']);
    expect(await printers.driverPaper('面单机B')).toEqual({ widthMm: 100, heightMm: 180, dpi: 203 });
    expect(await printers.readiness('标签机A')).toEqual({ ready: true });
    await printers.print('面单机B', JOB, new AbortController().signal);
    expect(printers.printed).toEqual([
      { printerName: '面单机B', raw: 'X', paper: '60x40', templateId: STANDARD_TEMPLATE.id },
    ]);
  });

  test('reports an unknown printer as not found', async () => {
    const printers = new FakePrinters(SPEC);
    await expect(printers.print('没有这台', JOB, new AbortController().signal)).rejects.toMatchObject({
      reason: 'PRINTER_NOT_FOUND',
    });
  });
});
```

（`PrintError` 的字段名以 `src/core/errors.ts` 为准；不是 `reason` 就按实际字段断言。）

- [ ] **Step 2：失败** → **Step 3：实现 `fake-printers.ts`**

```ts
import { PrintError } from '../../core/errors';
import type { LabelJob, PrinterInfo } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { paperKey } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';

/** 仅开发 / E2E 可用：用假打印机代替系统打印机，验证多台打印机的分配。安装版忽略它。 */
export const FAKE_PRINTERS_ENV = 'CDL_LABELFLASH_FAKE_PRINTERS';

export interface FakePrinterSpec {
  name: string;
  paper: DriverPaper | null;
  readiness: PrinterReadiness | null;
}

export interface FakePrint {
  printerName: string;
  raw: string;
  paper: string;
  templateId: string;
}

export function parseFakePrinters(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
): FakePrinterSpec[] | null {
  const value = env[FAKE_PRINTERS_ENV];
  if (isPackaged || value === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isSpec)) {
    throw new Error(`${FAKE_PRINTERS_ENV} must be a JSON array of { name, paper, readiness }`);
  }
  return parsed;
}

function isSpec(value: unknown): value is FakePrinterSpec {
  return typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string';
}

export class FakePrinters {
  readonly printed: FakePrint[] = [];

  constructor(private readonly specs: readonly FakePrinterSpec[]) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.specs.map(({ name }) => ({ name, displayName: name }));
  }

  async driverPaper(name: string): Promise<DriverPaper | null> {
    return this.find(name)?.paper ?? null;
  }

  async readiness(name: string): Promise<PrinterReadiness | null> {
    return this.find(name)?.readiness ?? null;
  }

  async print(printerName: string, job: LabelJob, _signal: AbortSignal): Promise<void> {
    if (!this.find(printerName)) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    this.printed.push({
      printerName,
      raw: job.scan.raw,
      paper: paperKey(job.template.paper),
      templateId: job.template.id,
    });
  }

  private find(name: string): FakePrinterSpec | undefined {
    return this.specs.find((spec) => spec.name === name);
  }
}
```

- [ ] **Step 4：适配器接口**
  - `electron-driver-adapter.ts` 导出：

    ```ts
    /** 主进程用到的打印机能力：真的适配器和 E2E 的假打印机都实现它。 */
    export interface PrinterDriver extends PrinterAdapter {
      hasPrinter(printerName: string): Promise<boolean>;
      knownPrinterNames(): Promise<string[]>;
    }
    ```

  - `ElectronDriverAdapter implements PrinterDriver`，并加 `knownPrinterNames()`：`(await this.knownPrinters()).map((printer) => printer.name)`。
  - `fake-printers.ts` 加 `FakeDriverAdapter implements PrinterDriver`，每个方法都委托给 `FakePrinters`。
  - `IpcDeps.adapter` 的类型改为 `PrinterDriver`。

- [ ] **Step 5：接进 `index.ts`**：先 `const fakes = parseFakePrinters(process.env, app.isPackaged);`。有值时：
  - 适配器用 `new FakeDriverAdapter(new FakePrinters(fakes))`；
  - `PrinterProfiles` 的读取函数用 `(name) => fakePrinters.driverPaper(name)`；
  - 状态探测用 `(name) => fakePrinters.readiness(name)`；
  - `(globalThis as { e2eFakePrinters?: FakePrinters }).e2eFakePrinters = fakePrinters`，供 E2E 读取；
  - 启动日志写 `[print] using ${fakes.length} fake printers`。

- [ ] **Step 6：E2E 支持**
  - `launchApp(userData, options: { fakePrinters?: FakePrinterSpec[] } = {})`：有 `fakePrinters` 时 `env[FAKE_PRINTERS_ENV] = JSON.stringify(options.fakePrinters)`。环境变量名从 `src/main/printing/fake-printers.ts` 导入，和 `USER_DATA_ENV` 的写法一致。
  - `fixtures.ts` 的 `launch(options?)` 透传给 `launchApp`。
  - `app-helpers.ts` 加：

```ts
/** 假打印机收到的打印（见 src/main/printing/fake-printers.ts）。 */
export function fakePrints(app: ElectronApplication): Promise<FakePrint[]> {
  return app.evaluate(
    () => (globalThis as { e2eFakePrinters?: { printed: FakePrint[] } }).e2eFakePrinters?.printed ?? [],
  );
}
```

- [ ] **Step 7：`bun run lint:fix && bun run check`；`bun run test:e2e`**：还没有用例用到假打印机，这一步确认启动不受影响。

- [ ] **Step 8：提交** `test(e2e): fake printers for unpackaged builds`

### Task 3.8：切换：主进程按模板决定打印机（一个提交）

这一步把 `selectedPrinter` 换成纸张分配。去掉之后，要等调用方全部改完类型检查才通过，所以整个任务是一个提交。按下面的顺序改，每一步跑对应的单元测试。

**Files:**
- Modify: `src/shared/settings.ts`；Test: `src/shared/settings.test.ts`（含第 23 行）、`src/main/storage/sqlite-settings-store.test.ts:29-33`
- Modify: `src/main/ipc-validators.ts`（`requirePaperKey`）；Test: `ipc-validators.test.ts`
- Modify: `src/core/types.ts`（`PrintRequest`、`PreviewResult`）、`src/core/print-service.ts`、`src/core/testing/fake-printer-adapter.ts`；Test: `src/core/print-service.test.ts`
- Modify: `src/main/printing/electron-driver-adapter.ts`（打印机列表并发共享）
- Modify: `src/main/index.ts`、`src/main/ipc.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`
- Modify: `src/main/mobile/mobile-host.ts`、`mobile-station.ts`；Test: 两个对应的测试文件
- Modify: `scripts/relay/demo-desktop.ts:38`、`relay/test/phone-page.browser.ts:71`
- Modify: `src/renderer/src/App.tsx:62-78,149,246-253,345`、`view-models/use-scan-station.ts`、`view-models/use-driver-paper.ts:24`、`components/PrinterList.tsx`（测试页的调用）、`lib/status-text.ts:209-235`、`lib/feedback-cues.ts:12,47`、`lib/mobile-text.ts:178-179`
- Test fixtures: `src/renderer/src/lib/preview-usage.test.ts:15`、`status-text.test.ts:28,173,183,200`、`mobile-text.test.ts:91`、`voice.test.ts:82`
- Modify: `e2e/app.e2e.ts:20,50`、`e2e/mobile.e2e.ts:26`、`e2e/visual/acceptance.visual.ts:139,837`、`e2e/support/app-helpers.ts`（`seedLegacySelectedPrinter`）
- Test: `e2e/printers.e2e.ts`（新建）

- [ ] **Step 1：设置——先写失败的测试**

`settings.test.ts`（第 23 行完整的 `AppSettings` 对象把 `selectedPrinter` 换成 `paperPrinters: {}`）：

```ts
describe('paperPrinters', () => {
  test('keeps valid paper keys and printer names', () => {
    const settings = sanitizeSettings({ paperPrinters: { '60x40': '标签机A', '100x180': '面单机B', bad: 'x' } });
    expect(settings.paperPrinters).toEqual({ '60x40': '标签机A', '100x180': '面单机B' });
  });

  // 1.0.x 只有一台「选中的打印机」，打的都是 60×40：升级后不用重新设置。
  test('moves the old selected printer to 60x40', () => {
    expect(sanitizeSettings({ selectedPrinter: '标签机A' }).paperPrinters).toEqual({ '60x40': '标签机A' });
  });

  test('does not bring the old printer back once paper is assigned, even when cleared', () => {
    const assigned = sanitizeSettings({ selectedPrinter: '旧打印机', paperPrinters: { '100x180': '面单机B' } });
    expect(assigned.paperPrinters).toEqual({ '100x180': '面单机B' });
    expect(sanitizeSettings({ selectedPrinter: '旧打印机', paperPrinters: {} }).paperPrinters).toEqual({});
  });

  test('keeps at most MAX_PAPER_ASSIGNMENTS papers', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PAPER_ASSIGNMENTS + 5 }, (_, index) => [`${30 + index}x40`, 'P']),
    );
    expect(Object.keys(sanitizeSettings({ paperPrinters: many }).paperPrinters)).toHaveLength(MAX_PAPER_ASSIGNMENTS);
  });
});
```

`sqlite-settings-store.test.ts`（数据库里旧的 `selectedPrinter` 行不会被删，这里核对它不会在保存后复活；原有第 29–33 行用到 `selectedPrinter` 的用例改用 `paperPrinters`）：

```ts
test('migrates the old selected printer once and never brings it back', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('selectedPrinter', '\"标签机A\"')").run();
  const store = new SqliteSettingsStore(db);
  expect(store.current.paperPrinters).toEqual({ '60x40': '标签机A' });
  store.update({ autoPrint: false });
  expect(new SqliteSettingsStore(db).current.paperPrinters).toEqual({ '60x40': '标签机A' });
  store.update({ paperPrinters: {} });
  expect(new SqliteSettingsStore(db).current.paperPrinters).toEqual({});
});
```

- [ ] **Step 2：实现设置**：`AppSettings` 删 `selectedPrinter`，加

```ts
  /**
   * 纸张 → 打印机：键是纸张键（src/shared/paper-sizes.ts 的 paperKey），值是系统里的打印机名。
   * 模板按自己的纸张打到对应的打印机；模板也可以自己指定打印机（优先）。
   */
  paperPrinters: Record<string, string>;
```

`DEFAULT_SETTINGS.paperPrinters = {}`；`sanitizeSettings` 里 `paperPrinters: sanitizePaperPrinters(input['paperPrinters'], input['selectedPrinter'])`：

```ts
/** 纸张分配最多这么多种纸：预设 12 种加自定义，足够一台电脑用；防止异常数据撑大设置。 */
export const MAX_PAPER_ASSIGNMENTS = 32;

/** 1.0.x 的「选中的打印机」：设置里还没有 paperPrinters 时（第一次升级）迁移成「60×40 → 这台」，以后不再读。 */
function sanitizePaperPrinters(value: unknown, legacySelected: unknown): Record<string, string> {
  if (!isRecord(value)) {
    const legacy = sanitizePrinterName(legacySelected);
    return legacy === null ? {} : { [paperKey(DEFAULT_PAPER)]: legacy };
  }
  const result: Record<string, string> = {};
  for (const [key, name] of Object.entries(value)) {
    const paper = parsePaperKey(key);
    const printer = sanitizePrinterName(name);
    if (paper !== null && printer !== null && Object.keys(result).length < MAX_PAPER_ASSIGNMENTS) {
      result[paperKey(paper)] = printer;
    }
  }
  return result;
}
```

说明：`SqliteSettingsStore.update` 写的是整份设置，所以第一次保存任何设置后，数据库里就有了 `paperPrinters` 这一行，迁移不再发生。旧的 `selectedPrinter` 行留在表里，不再读，也不删。

- [ ] **Step 3：IPC 校验**：`ipc-validators.ts` 加 `requirePaperKey(value)`：
  - 必须是字符串，而且 `parsePaperKey` 不为 null；
  - 返回规范化的键；不合格就抛 `TypeError`，写法照文件里其他的 `require*`；
  - 测试覆盖 `'100x180'`、`'100×180'` 和数字三种输入。

- [ ] **Step 4：`PrintService`——先写失败的测试**

改测试工具：
- `createHarness` 加一个可切换的 `choosePrinter`，缺省返回 `{ printerName: PRINTER, reason: 'paper' }`，并暴露 `useChoice(next)`；
- `FakePrinterAdapter.printed` 的元素加 `paper: string`（`paperKey(job.template.paper)`）和 `fields: ScanField[]`（`job.scan.fields`）；
- `request()` 帮手去掉 `printerName`。

```ts
describe('PrintService printer choice', () => {
  test('prints on the printer chosen for the template and records it with the paper and template', async () => {
    const { service, adapter, store, useChoice } = createHarness();
    useChoice({ printerName: '面单机B', reason: 'paper' });
    expect((await service.submit(request())).status).toBe('printed');
    expect(adapter.printed.at(-1)).toMatchObject({ printerName: '面单机B', paper: '60x40' });
    expect(store.listRecent(1)[0]).toMatchObject({
      printerName: '面单机B',
      paper: '60x40',
      templateId: STANDARD_TEMPLATE.id,
    });
  });

  // 没有打印机时和 1.0.x 没选打印机一样：不打印、不写记录、不占防重复窗口。
  test('does not print, record or hold the dedup window when no printer holds the paper', async () => {
    const { service, adapter, store, useChoice } = createHarness();
    useChoice({ printerName: null, reason: 'unassigned', paperKey: '100x180', missingPrinter: null });
    expect(await service.submit(request())).toEqual({ status: 'no-printer', paperKey: '100x180', missingPrinter: null });
    expect(adapter.printed).toEqual([]);
    expect(store.listRecent(10)).toEqual([]);
    useChoice({ printerName: PRINTER, reason: 'paper' });
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('resolves the template once and prints the processed scan with it', async () => {
    const { service, useEnrich, templateRequests, adapter } = createHarness();
    useEnrich(withShelf);
    await service.submit(request());
    expect(templateRequests).toHaveLength(1);
    expect(adapter.printed.at(-1)?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
  });

  test('shows in the preview which printer the label would go to', async () => {
    const { service } = createHarness();
    expect(await service.preview(RAW)).toMatchObject({
      status: 'ok',
      printer: { printerName: PRINTER, reason: 'paper' },
    });
  });

  test('prints the test page on the paper it is given', async () => {
    const { service, adapter } = createHarness();
    await service.printTest('面单机B', { widthMm: 100, heightMm: 180 });
    expect(adapter.printed.at(-1)).toMatchObject({ printerName: '面单机B', paper: '100x180' });
  });
});
```

另外两处原有用例：
- 删掉第 255 行「从加工后的识别结果取模板」的用例，由上面第三个用例代替。模板只看命中的规则（`print-template.ts:35`），和加工步骤补的字段无关。
- 第 222 行的精确 `toEqual` 补上 `printer` 字段。

- [ ] **Step 5：实现 `PrintService`**

**`types.ts`**：`PrintRequest` 去掉 `printerName`；`PreviewResult` 的 `ok` 分支加 `printer: PrinterChoice`。

**`PrintServiceDeps`** 加：

```ts
  /** 这个模板用哪台打印机（模板指定 → 纸张分配，见 printing/resolve-printer.ts）；每次打印都重新决定。实现不能抛错。 */
  choosePrinter: (template: LabelTemplate) => Promise<PrinterChoice>;
```

**`submit`** 拆成两半：

```ts
  async submit(request: PrintRequest): Promise<PrintResult> {
    const id = this.deps.createId();
    const recognition = this.recognize(request.raw);
    if (!recognition.ok) {
      const truncated = request.raw.trim().slice(0, MAX_RAW_LENGTH);
      return this.finish(id, request, NO_TARGET, truncated, recognition.result, null);
    }
    // 模板只看命中的规则，和加工步骤补的字段无关：在加工之前就能决定打印机。
    return this.printLabel(id, request, recognition.scan, this.deps.resolveTemplate(recognition.scan));
  }

  /**
   * 按模板决定打印机 → 防重复 → 加工 → 排队打印 → 写记录。
   * 本机接口（第 2 个子项目）传来的是字段 + 模板，从这里进来，不经过识别规则。
   */
  private async printLabel(
    id: string,
    request: PrintRequest,
    recognized: ScanResult,
    template: LabelTemplate,
  ): Promise<PrintResult> {
    const choice = await this.deps.choosePrinter(template);
    if (choice.printerName === null) {
      return { status: 'no-printer', paperKey: choice.paperKey, missingPrinter: choice.missingPrinter };
    }
    const target: JobTarget = {
      printerName: choice.printerName,
      paper: paperKey(template.paper),
      templateId: template.id,
    };
    // …把原 submit 从「先占住防重复窗口」开始的代码搬过来，搬的时候改三处：
    //   request.printerName → target.printerName；
    //   finish(id, request, raw, …) → finish(id, request, target, raw, …)；
    //   this.createJob(scan) → this.createJob(scan, template)。
  }
```

文件里加：

```ts
/** 这一张打到哪、用什么纸和模板；识别不了的记录没有这些。 */
interface JobTarget {
  printerName: string;
  paper: string | null;
  templateId: string | null;
}
const NO_TARGET: JobTarget = { printerName: '', paper: null, templateId: null };
```

**`finish`** 写记录时 `printerName: target.printerName`；`target.paper` 不为 null 时写 `job.paper`，`target.templateId` 不为 null 时写 `job.templateId`。

**`preview()`**：

```ts
    const template = this.deps.resolveTemplate(recognition.scan);
    // …加工照旧…
    return {
      status: 'ok',
      scan,
      recent: this.deps.guard.peek(scan.raw),
      lookupFailure: enriched.blocked?.detail ?? null,
      printer: await this.deps.choosePrinter(template),
    };
```

**`createJob(scan, template)`**：不再自己调 `resolveTemplate`，保证打印用的模板和决定打印机用的是同一个。

**`printTest(printerName: string, paper: PaperSize)`**：`const template = withPaper(this.deps.resolveTemplate(scan), paper);`，用 `this.createJob(scan, template)` 打印。

Run: `bun test src/core` → PASS

- [ ] **Step 6：适配器的打印机列表并发共享**（`electron-driver-adapter.ts`）

缓存过期后，几张同时决定打印机时会各自去查系统列表，谁先查完谁先进队列，破坏「先扫先打」。改为共享同一次查询，各张按调用顺序继续：

```ts
  private pending: Promise<PrinterInfo[]> | null = null;

  private knownPrinters(): Promise<PrinterInfo[]> {
    if (this.cache && this.clock.now() - this.cache.at < PRINTER_LIST_TTL_MS) {
      return Promise.resolve(this.cache.printers);
    }
    this.pending ??= this.listPrinters().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
```

- [ ] **Step 7：主进程接线（`index.ts`）**

```ts
  /** 要检测状态的打印机：纸张分配和模板指定里出现的（交给探测进程前再核对系统里有）。 */
  const assignedPrinterNames = (): string[] => [
    ...new Set([
      ...Object.values(settings.current.paperPrinters),
      ...templates.list().flatMap((template) => (template.printer ? [template.printer] : [])),
    ]),
  ];
  const choosePrinter = async (template: LabelTemplate): Promise<PrinterChoice> => {
    let installed: string[];
    try {
      installed = await adapter.knownPrinterNames();
    } catch (error) {
      // 读不到打印机列表时不能让打印抛错：按模板指定的在（交给适配器去报找不到）处理，不悄悄换打印机。
      console.error('[print] cannot list printers', error);
      installed = template.printer ? [template.printer] : [];
    }
    return resolvePrinter(template, settings.current.paperPrinters, installed);
  };
```

接着改这几处：
- `PrintService` 加 `choosePrinter`，`registerIpc` 也传 `choosePrinter`，4.2 的预览要用。
- `status.watchPrinters(assignedPrinterNames)`。
- `onSettingsChanged` 里加：

  ```ts
  if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) {
    void status.poll();
    warmProfiles();
  }
  ```

  `sanitizeSettings` 每次都建新对象，不能用 `!==` 比较。
- 保存、删除模板之后也 `void status.poll()`：`IpcDeps` 加 `onTemplatesChanged: () => void`，在 `SaveTemplate`、`DeleteTemplate` 处理函数的末尾调用。
- `warmProfiles = () => { for (const name of assignedPrinterNames()) void profiles.get(name); }`，启动时调用一次。这样第一张打印就能用上驱动的分辨率。

- [ ] **Step 8：IPC 契约**

`ipc-contract.ts`：
- `print(raw: string, options: PrintOptions)`；
- `printTest(printerName: string, paperKey: string)`；
- `checkDriverPaper(printerName: string, paperKey: string)`，同时更新第 126 行的注释。

`preload/index.ts` 同步。

`ipc.ts`：
- `Print` 处理函数只收 `raw` 和 `options`。
- `PrintTest`：`deps.service.printTest(await requireKnownPrinter(name), parsePaperKey(requirePaperKey(key)) ?? DEFAULT_PAPER)`。
- `CheckDriverPaper`：`checkDriverPaper(await deps.profiles.get(await requireKnownPrinter(name)), parsePaperKey(requirePaperKey(key)) ?? DEFAULT_PAPER)`。

- [ ] **Step 9：手机**

**`mobile-host.ts`**：
- `MobileHostDeps.print` 改为 `(raw: string, force: boolean) => Promise<PhonePrintResult>`；
- `selectedPrinter` 换成 `printerLabel: () => Promise<string | null>`；
- `print()` 直接 `return await this.deps.print(raw, force)`，保留 try/catch；
- `printerLabel()` 调 `this.deps.printerLabel()`。

**`mobile-station.ts`**：
- `StationSettings = Pick<AppSettings, 'mobileRelayUrl' | 'paperPrinters'>`；
- `MobileStationDeps` 去掉 `listPrinters`，加 `printerLabel`；
- `createHost` 的 Pick 换成 `'relayBase' | 'print' | 'printerLabel'`；
- `settingsChanged` 里 `if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) this.host?.printerChanged();`；
- 删掉私有的 `selectedPrinter()`。

**`index.ts`** 注入：

```ts
    printerLabel: async () => {
      const known = await adapter.knownPrinterNames().catch(() => []);
      return phonePrinterLabel(
        assignedPrinterNames().map((name) => ({ name, isListed: known.includes(name), readiness: status.get(name) })),
      );
    },
```

`submit` 改为 `(request) => service.submit(request)`，请求里不再有打印机名。

**测试**：两个测试文件照新依赖改写。原有「没选打印机时回复 no-printer」的用例改成：`submit` 返回 `no-printer` 时，手机收到 `{ status: 'no-printer' }`。

**演示脚本和中转测试**：
- `scripts/relay/demo-desktop.ts:38`：`printerLabel: async () => DEMO_PRINTER.displayName`。
- `relay/test/phone-page.browser.ts:71`：`printerLabel: async () => '热敏标签机'`。第 138 行「打印机：热敏标签机」的断言不变。

- [ ] **Step 10：界面**

**`use-scan-station.ts`**：
- 删掉 `printerName` 选项和「没选打印机就提醒」那段（第 59–61 行）。主进程会返回 `no-printer`，照常经 `announce({ kind: 'result', … })` 播报。
- 调用改为 `window.api.print(raw, { source, force })`。
- `willPrint` 去掉 `printerName !== null`。

**`feedback-cues.ts:12,47`**：删掉 `{ kind: 'no-printer' }` 和它的分支，`voice.test.ts:82` 同步。

**`status-text.ts`**：
- `ScanContext.hasPrinter` 改为按这一张判断。App 传入：

  ```ts
  hasPrinter: scan?.preview.result.status === 'ok' ? scan.preview.result.printer.printerName !== null : true
  ```

  识别不了的码本来就不能打，所以这时取 `true`，不影响结果。
- 「还没选打印机 / 在右侧「打印机」列表里点选一台」（第 230–234 行）改为和 `no-printer` 同一句：
  - 标题用 `VOICE_CUE_TEXT.noPrinter`；
  - 详情用 `describeResult` 里同样的纸张说明；
  - 带 `link: { page: 'printers', label: '去指定打印机' }`。
- `no-printer` 结果允许 `print: 'retry'`：指定好打印机后按 F2 直接重打这一张，不用再扫。
- `status-text.test.ts:200` 和 `e2e/app.e2e.ts:50` 里的「还没选打印机」同步改。

**`App.tsx`**：
- 第 62 行起，暂时把「当前打印机」取成 60×40 分配到的那台：

  ```ts
  const printerName = settings?.paperPrinters[paperKey(DEFAULT_PAPER)] ?? null;
  ```

  标题栏胶囊和打印机列表先照旧用它，4.3、4.5 再换掉。
- 第 253 行的 `onSelect` 改为：

  ```ts
  update({ paperPrinters: { ...settings.paperPrinters, [paperKey(DEFAULT_PAPER)]: name } })
  ```

- 第 345 行手机浮层的 `hasPrinter` 改为 `Object.keys(settings.paperPrinters).length > 0`。

**其他**：
- `use-driver-paper.ts:24` 改为 `window.api.checkDriverPaper(name, paperKey(DEFAULT_PAPER))`；`PrinterList` 的「测试页」调用补上 `paperKey(DEFAULT_PAPER)`。
- `mobile-text.ts:178-179`：「电脑上还没选打印机…手机会提示「请先选择打印机」」改为「电脑上还没有分配打印机…手机会提示「没有可用的打印机」」，`mobile-text.test.ts:91` 同步。
- 测试夹具补 `printer` 字段：`preview-usage.test.ts:15`、`status-text.test.ts:28,173,183`。

- [ ] **Step 11：E2E 跟上**
  - 所有 `selectedPrinter: X` 改成 `paperPrinters: { '60x40': X }`，位置在 `app.e2e.ts:20`、`mobile.e2e.ts:26`、`acceptance.visual.ts:139,837`。
  - 手机的 E2E 仍然走「分配到的打印机不存在 → PRINTER_NOT_FOUND」这条路，行为不变。
  - `app-helpers.ts` 加 `seedLegacySelectedPrinter(app, name)`，模拟 1.0.x 留下的设置：
    - 借运行中程序的主进程写库：`app.evaluate` 里用 `process.getBuiltinModule('node:sqlite')` 另开一个连接，连到 `app.getPath('userData')` 下的 `labelflash.db`；
    - 执行 `DELETE FROM settings WHERE key = 'paperPrinters'` 和 `INSERT OR REPLACE INTO settings (key, value) VALUES ('selectedPrinter', ?)`，值是 `JSON.stringify(name)`，然后关掉这个连接；
    - 数据库是 WAL 模式，两个连接可以同时开。不从测试进程直接开库：Playwright 所在的运行时不一定带 `node:sqlite`；
    - 调用方随后关掉程序，再用同一个数据目录启动。

- [ ] **Step 12：新 E2E `e2e/printers.e2e.ts`**（用 3.7 的假打印机）

```ts
const PRINTERS = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机C', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: { ready: true } },
];
```

准备一个 100×180 的模板：先 `callApi(page, 'duplicateTemplate', 'builtin:generic')`，再 `saveTemplate`，把纸张改成 100×180。「整段内容」规则绑定到这个模板，绑定的写法照 `app.e2e.ts` 里现有的规则绑定用例（设置里的 `ruleSettings`）。

四个用例：
1. **两台打印机、两种纸**：
   - 设 `paperPrinters: { '60x40': '标签机A', '100x180': '面单机B' }`；
   - 扫 `CL5640-TK-图片色-XL` 和 `hello`，`fakePrints` 依次是 `标签机A / 60x40`、`面单机B / 100x180`；
   - `callApi(page, 'listJobs', …)` 里两条记录的 `printerName` 和 `paper` 与之对应。
2. **模板指定打印机优先**：把 100×180 模板的 `printer` 设为 `面单机C`，扫 `hello`，打到 `面单机C`。
3. **纸张没分配时不打印**：
   - 去掉 `100x180` 的分配，扫 `hello`；
   - 状态条出现「没有可用的打印机」，`fakePrints` 和打印记录都没有新增；
   - 经 `updateSettings` 分配后按 F2，这一张打到 `面单机B`；
   - 「去指定打印机」按钮切换右侧标签页的断言在 4.5 补上。
4. **从旧设置启动**：
   - 第一次启动后 `seedLegacySelectedPrinter(app, '标签机A')`，然后关掉程序；
   - 用同一个数据目录再启动，`getSettings` 得到 `paperPrinters: { '60x40': '标签机A' }`。

- [ ] **Step 13：检查**：`bun run lint:fix && bun run check`；`bun run test:e2e`；`bun run test:relay-browser`

- [ ] **Step 14：提交**

```bash
git add -A src e2e scripts relay
git commit -m "feat(printing): choose the printer from the template's paper or its own printer"
```

提交说明的正文写清：
- 界面不再传打印机名，主进程按模板决定打印机；
- 没有打印机时返回 no-printer，不写记录、不占防重复窗口；
- 设置从 selectedPrinter 迁移到纸张分配；
- `PrintService` 拆出 printLabel，给本机接口留入口；
- 手机协议不变，顶部改显示打印机汇总；
- 在哪个平台跑过 E2E（另一个平台由 CI 跑）。

---

## 阶段 4：界面

**目标**：
- 打印机页能按纸张分配打印机，并给出建议；
- 模板能选纸张和打印机；
- 预览按纸张显示；
- 标题栏显示汇总，点一下打开打印机页；
- 打印记录显示纸张。

**成功标准**：E2E 新用例通过；新增的视觉验收 V35–V37 自动检查全过；原有 V01–V34 重截没有问题。
**状态**：Complete

顺序：
1. 4.1 纯逻辑；
2. 4.2 预览按纸张（4.4 模板编辑器的 E2E 要用到）；
3. 4.3 打印机页；
4. 4.4 模板编辑器；
5. 4.5 标题栏、状态条、打印记录，删除旧常量；
6. 4.6 视觉验收。

### Task 4.1：纯逻辑：分配表、建议、每台负责什么

**Files:**
- Create: `src/renderer/src/lib/printer-assignment.ts`
- Test: `src/renderer/src/lib/printer-assignment.test.ts`
- Modify: `src/renderer/src/lib/paper-text.ts`（`describePaperCheck(check, expected)`）；Test: `paper-text.test.ts:23`
- Modify: `src/renderer/src/components/PrinterList.tsx`（先传 `DEFAULT_PAPER`）

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { describeTemplatePrinter, paperRows, responsibilitiesOf, withAssignment } from './printer-assignment';

const TEMPLATES = [
  { name: '样衣标准', paper: { widthMm: 60, heightMm: 40 }, printer: null },
  { name: '申通面单', paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' },
  { name: '极兔面单', paper: { widthMm: 100, heightMm: 180 }, printer: null },
  { name: '顺丰面单', paper: { widthMm: 100, heightMm: 150 }, printer: '面单机B' },
];
const INSTALLED = ['标签机A', '面单机B', '面单机C'];
const DRIVER_PAPER = {
  标签机A: { widthMm: 60, heightMm: 40, dpi: 203 },
  面单机C: { widthMm: 100, heightMm: 180, dpi: 203 },
};

describe('paperRows', () => {
  test('lists every paper the templates use, with its printer or a suggestion', () => {
    expect(paperRows(TEMPLATES, { '60x40': '标签机A' }, INSTALLED, DRIVER_PAPER)).toEqual([
      { key: '60x40', name: '60×40 标签', printer: '标签机A', suggestion: null, isMissing: false, isCovered: true },
      {
        key: '100x180',
        name: '100×180 二联面单',
        printer: null,
        suggestion: '面单机C',
        isMissing: false,
        isCovered: false,
      },
      { key: '100x150', name: '100×150 二联面单', printer: null, suggestion: null, isMissing: false, isCovered: true },
    ]);
  });

  test('keeps a paper that no template uses any more, so it can be cleared', () => {
    expect(paperRows([], { '70x50': '标签机A' }, INSTALLED, {})).toEqual([
      { key: '70x50', name: '70×50 标签', printer: '标签机A', suggestion: null, isMissing: false, isCovered: true },
    ]);
  });

  test('flags an assigned printer that is not on this computer', () => {
    expect(paperRows([], { '60x40': '旧打印机' }, INSTALLED, {})[0]?.isMissing).toBe(true);
  });

  test('does not suggest a printer already assigned to another paper', () => {
    const rows = paperRows(TEMPLATES, { '60x40': '面单机C' }, INSTALLED, DRIVER_PAPER);
    expect(rows.find((row) => row.key === '100x180')?.suggestion).toBeNull();
  });
});

describe('responsibilitiesOf', () => {
  test('lists the papers and templates a printer handles', () => {
    expect(responsibilitiesOf('面单机B', TEMPLATES, { '60x40': '标签机A' })).toEqual({
      papers: [],
      templates: [
        { name: '申通面单', paperKey: '100x180' },
        { name: '顺丰面单', paperKey: '100x150' },
      ],
    });
    expect(responsibilitiesOf('标签机A', TEMPLATES, { '60x40': '标签机A' })).toEqual({
      papers: [{ key: '60x40', name: '60×40 标签' }],
      templates: [],
    });
  });
});

describe('withAssignment', () => {
  test('assigns and clears a paper without touching the others', () => {
    expect(withAssignment({ '60x40': 'A' }, '100x180', 'B')).toEqual({ '60x40': 'A', '100x180': 'B' });
    expect(withAssignment({ '60x40': 'A', '100x180': 'B' }, '100x180', null)).toEqual({ '60x40': 'A' });
  });
});

describe('describeTemplatePrinter', () => {
  const label = { paper: { widthMm: 60, heightMm: 40 }, printer: null };

  test('describes the printer a template will actually use', () => {
    expect(describeTemplatePrinter(label, { '60x40': 'A' }, ['A'])).toBe('A');
    expect(describeTemplatePrinter(label, {}, ['A'])).toBe('还没有打印机');
    expect(describeTemplatePrinter({ ...label, printer: 'B' }, { '60x40': 'A' }, ['A'])).toBe(
      'A（指定的 B 不在这台电脑上）',
    );
  });
});
```

`paper-text.test.ts:23` 的期望文字改为按传入的纸张：

```ts
test('warns with the paper the printer is expected to hold', () => {
  const view = describePaperCheck(
    { status: 'mismatch', paper: { widthMm: 60, heightMm: 40, dpi: 203 } },
    { widthMm: 100, heightMm: 180 },
  );
  expect(view?.text).toContain('不是 100×180 二联面单');
});
```

- [ ] **Step 2：失败** → **Step 3：实现 `printer-assignment.ts`**

```ts
import { type PrinterTarget, resolvePrinter } from '../../../core/printing/resolve-printer';
import type { DriverPaper } from '../../../shared/driver-paper';
import { formatPaperName, isSamePaper, type PaperSize, paperKey, parsePaperKey } from '../../../shared/paper-sizes';

export interface TemplateUse extends PrinterTarget {
  name: string;
}

export interface PaperRow {
  key: string;
  name: string;
  /** 分配到的打印机；没分配时为 null。 */
  printer: string | null;
  /** 没分配、而某台打印机的驱动纸张正好是这个尺寸时，建议它（只建议，不自动分配：驱动纸张可能只是出厂默认值）。 */
  suggestion: string | null;
  /** 分配到的打印机不在这台电脑上。 */
  isMissing: boolean;
  /** 用这种纸的模板都有打印机可用（分配了，或模板自己指定了本机有的打印机）；为 false 时标红。 */
  isCovered: boolean;
}

/** 打印机页顶部的「纸张 → 打印机」表：模板用到的每种纸一行（按第一次出现的顺序），再加上已分配、没有模板在用的纸。 */
export function paperRows(
  templates: readonly TemplateUse[],
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
  driverPaper: Readonly<Record<string, DriverPaper | null>>,
): PaperRow[] {
  const papers = new Map<string, PaperSize>();
  for (const template of templates) {
    const key = paperKey(template.paper);
    if (!papers.has(key)) {
      papers.set(key, template.paper);
    }
  }
  for (const key of Object.keys(paperPrinters)) {
    const paper = parsePaperKey(key);
    if (paper !== null && !papers.has(key)) {
      papers.set(key, paper);
    }
  }
  const assigned = new Set(Object.values(paperPrinters));
  return [...papers].map(([key, paper]) => {
    const printer = paperPrinters[key] ?? null;
    const users = templates.filter((template) => paperKey(template.paper) === key);
    const isCovered = users.every((template) => resolvePrinter(template, paperPrinters, installed).printerName !== null);
    const suggestion =
      printer === null
        ? (Object.entries(driverPaper).find(
            ([name, driver]) => driver !== null && !assigned.has(name) && isSamePaper(driver, paper),
          )?.[0] ?? null)
        : null;
    return {
      key,
      name: formatPaperName(paper),
      printer,
      suggestion,
      isMissing: printer !== null && !installed.includes(printer),
      isCovered,
    };
  });
}

/** 一台打印机负责哪些纸张（纸张分配）和哪些模板（模板指定了它）。 */
export function responsibilitiesOf(
  printerName: string,
  templates: readonly TemplateUse[],
  paperPrinters: Readonly<Record<string, string>>,
): { papers: { key: string; name: string }[]; templates: { name: string; paperKey: string }[] } {
  const papers = Object.entries(paperPrinters).flatMap(([key, name]) => {
    const paper = parsePaperKey(key);
    return name === printerName && paper !== null ? [{ key, name: formatPaperName(paper) }] : [];
  });
  return {
    papers,
    templates: templates
      .filter((template) => template.printer === printerName)
      .map((template) => ({ name: template.name, paperKey: paperKey(template.paper) })),
  };
}

/** 改一种纸的分配；printer 为 null 时删掉这一项。 */
export function withAssignment(
  paperPrinters: Readonly<Record<string, string>>,
  key: string,
  printer: string | null,
): Record<string, string> {
  const { [key]: _removed, ...rest } = paperPrinters;
  return printer === null ? rest : { ...rest, [key]: printer };
}

/** 模板实际会用的打印机（模板列表、编辑器用）。 */
export function describeTemplatePrinter(
  target: PrinterTarget,
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
): string {
  const choice = resolvePrinter(target, paperPrinters, installed);
  if (choice.printerName === null) {
    return '还没有打印机';
  }
  return choice.reason === 'template-missing'
    ? `${choice.printerName}（指定的 ${choice.missingPrinter} 不在这台电脑上）`
    : choice.printerName;
}
```

`paper-text.ts`：
- 签名改为 `describePaperCheck(check: PaperCheck | null, expected: PaperSize)`；
- 提醒文字里的 `LABEL_SIZE_TEXT` 换成 `formatPaperName(expected)`；
- 删掉 `LABEL_PAPER_MM` 的 import。

唯一的调用方 `PrinterList.tsx` 暂时传 `DEFAULT_PAPER`，4.3 再改。

- [ ] **Step 4：通过**；**Step 5：`bun run lint:fix && bun run check`，提交** `feat(ui): paper assignment rows, suggestions and responsibilities`

### Task 4.2：预览按纸张、工具条显示打印机

**Files:**
- Modify: `src/shared/ipc-contract.ts:85-97`（`LabelPreview` 加 `paper: PaperSize` 和 `printer: PrinterChoice | null`）
- Modify: `src/main/ipc.ts`（`renderPreview` 填 `paper`、`printer`，按打印机分辨率渲染；`PreviewTemplate` 按草稿模板决定打印机）
- Modify: `src/renderer/src/components/LabelPreview.tsx`（`paper` 参数）、`styles/app.css:748-749,826-827`
- Modify: `src/renderer/src/components/PreviewStage.tsx:12-17,54`（`PreviewOverride.paper`）、`App.tsx:126-133`
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx:88,199`（`LabelPreview` 传 `paper`）
- Modify: `src/renderer/src/view-models/use-scan-station.ts:10`（`NO_PREVIEW` 带 `paper: DEFAULT_PAPER`、`printer: null`）
- Modify: `src/renderer/src/lib/preview-usage.ts`、`components/workbench/PreviewToolbar.tsx`；Test: `preview-usage.test.ts`

- [ ] **Step 1：写失败的测试**（`preview-usage.test.ts`）

```ts
describe('describePreviewPrinter', () => {
  test('names the printer the label goes to', () => {
    expect(describePreviewPrinter({ printerName: '面单机B', reason: 'paper' })).toBe('打印机：面单机B');
  });

  test('explains a fallback from a missing template printer', () => {
    const choice = { printerName: '面单机B', reason: 'template-missing', missingPrinter: '面单机D' } as const;
    expect(describePreviewPrinter(choice)).toBe('打印机：面单机B（模板指定的 面单机D 不在这台电脑上）');
  });

  test('says when there is no printer', () => {
    const choice = { printerName: null, reason: 'unassigned', paperKey: '100x180', missingPrinter: null } as const;
    expect(describePreviewPrinter(choice)).toBe('打印机：还没有');
  });
});
```

- [ ] **Step 2：失败** → **Step 3：实现**

**预览工具条**：
- `preview-usage.ts` 加 `describePreviewPrinter(choice: PrinterChoice): string`。
- `PreviewToolbar` 在「规则 · 模板」后面显示 `· ${describePreviewPrinter(choice)}`；`choice` 为 null（还没有扫码）时不显示。

**主进程**：
- `renderPreview(result, printTemplate)` 的返回值加 `paper: printTemplate.template.paper` 和 `printer`。`printer` 用 `deps.choosePrinter(printTemplate.template)`（3.8 已放进 `IpcDeps`）。
- 渲染 HTML 用 `await deps.profiles.dpiOf(printerName)`；没有打印机时按 203dpi。
- `PreviewTemplate` 处理函数对草稿模板重新调 `choosePrinter(draft)`。`service.preview(raw)` 里的 `printer` 属于样张内容 `CL5640-TK-图片色-XL` 绑定的「样衣标准」，不是草稿的，不能直接用。

**`LabelPreview` 组件**：props 加 `paper: PaperSize`。
- 缩放：`useFitScale(benchRef, paper.widthMm + RULER_DEPTH_MM, paper.heightMm + RULER_DEPTH_MM, maxScale)`；
- 两把软尺的 `lengthMm` 分别是 `paper.widthMm`、`paper.heightMm`；
- 根元素加 `style={{ '--paper-w': paper.widthMm, '--paper-h': paper.heightMm } as CSSProperties}`。

**`app.css`**：
- `.tape` 的 `calc(60 * var(--mm))` / `calc(40 * var(--mm))` 改为 `calc(var(--paper-w) * var(--mm))` / `calc(var(--paper-h) * var(--mm))`；
- `.label-frame` 的 `60mm` / `40mm` 改为 `calc(var(--paper-w) * 1mm)` / `calc(var(--paper-h) * 1mm)`。

**把 `paper` 传下去**：
- `PreviewOverride` 加 `paper`，App 里取 `effectiveTemplate.paper`；
- `PreviewStage` 的占位文字改为 `扫码后在这里预览 ${formatPaperName(paper)}`；
- `TemplatesPage` 两处 `LabelPreview` 分别传 `selected.paper` / `draft.paper`。

- [ ] **Step 4：E2E**（`app.e2e.ts`）：
  - `saveTemplate` 把一个复制出来的模板改成 100×100，设为当前模板后扫码；
  - `.ruler--horizontal svg` 的 `viewBox` 以 `0 0 100` 开头（软尺不画终点的数字，只能看 viewBox）；
  - `.label-frame` 的宽高比约为 1。

- [ ] **Step 5：`bun run lint:fix && bun run check`、`bun run test:e2e`，提交** `feat(ui): preview on the template's paper and show where it prints`

### Task 4.3：打印机页

**Files:**
- Create: `src/renderer/src/view-models/use-printer-profiles.ts`
- Delete: `src/renderer/src/view-models/use-driver-paper.ts`、`use-printer-status.ts`
- Modify: `src/renderer/src/components/PrinterList.tsx`（改写）、`App.tsx:62-78,236-262`、`styles/app.css`

- [ ] **Step 1：`use-printer-profiles.ts`**：把 `use-driver-paper.ts`、`use-printer-status.ts` 的写法合在一起（取消过期请求、出错走 `reportError`）。

  **输入**：
  - `names`：系统打印机名；
  - `expected: Record<string, string>`：每台要核对的纸张键，只有负责纸张或模板的打印机才有。

  **返回**：`{ profiles: Record<string, { paper: PaperCheck | null; readiness: PrinterReadiness | null }>, openingName: string | null, openPreferences(name): Promise<void> }`。

  **驱动纸张**：
  - 对每台调 `window.api.checkDriverPaper(name, expected[name] ?? paperKey(DEFAULT_PAPER))`。
  - effect 的依赖用 `names.join('\n')` 和 `JSON.stringify(expected)`。`usePrinters` 每次窗口获得焦点都返回新数组，按数组本身比较的话，每次都会重新查一遍所有打印机。
  - 没有负责任何纸张的打印机，只拿 `paper` 显示「驱动纸张 X」，不提醒对不上。

  **状态**：每 `PRINTER_STATUS_POLL_MS` 对 `expected` 里的打印机调一次 `window.api.printerStatus(name)`。主进程只检测分配到的打印机，其余打印机返回 null。

  **打开打印首选项**：`openPreferences(name)` 等首选项窗口关掉后，只重新检查这一台的纸张。主进程在打开之后已经 `forget` 了这台的缓存。

- [ ] **Step 2：改写 `PrinterList.tsx`**

  **props**：
  - `printers`、`rows: PaperRow[]`、`profiles`、`responsibilities: Record<string, ReturnType<typeof responsibilitiesOf>>`、`openingName`、`isLoading`；
  - `onAssign(key, printer | null)`、`onOpenPreferences(name)`、`onTestPrint(name, paperKey)`、`onRefresh`。

  **结构**（样式沿用现有的 `panel-body`、`select-field`、`button--small`、`tone--*`）：

```tsx
<div className="panel-body">
  <section className="paper-assignments" aria-label="纸张和打印机">
    <h3 className="paper-assignments__title">纸张 → 打印机</h3>
    <ul>
      {rows.map((row) => (
        <li key={row.key} className={`paper-row${row.isCovered ? '' : ' paper-row--missing'}`}>
          <span className="paper-row__name">{row.name}</span>
          <select
            className="select-field select-field--fill"
            aria-label={`${row.name} 用哪台打印机`}
            value={row.printer ?? ''}
            onChange={(event) => {
              onAssign(row.key, event.target.value || null);
              // 选完就离开下拉框：焦点留在下拉框里时，扫码框的回焦规则不会把焦点拉回去。
              event.currentTarget.blur();
            }}
          >
            <option value="">还没有打印机</option>
            {row.printer !== null && row.isMissing && (
              <option value={row.printer}>{`${row.printer}（这台电脑上没有）`}</option>
            )}
            {printers.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.displayName}
              </option>
            ))}
          </select>
          {row.suggestion && (
            <button type="button" className="button button--small" onClick={() => onAssign(row.key, row.suggestion)}>
              建议：{row.suggestion}
            </button>
          )}
        </li>
      ))}
    </ul>
  </section>
  {/* 下面是原来的搜索框和打印机列表 */}
</div>
```

  **打印机列表每行**：
  - 名称和状态点：就绪 / 缺纸 / 离线 / 未知，文字来自 `readiness`。
  - 「驱动纸张 100×180 · 203dpi」，用 `describePaperCheck(paper, 期望纸张)`。只有它负责的纸对不上时才用提醒色，并显示「打开打印首选项」。
  - 「负责：60×40 标签；申通面单」，没有负责的纸和模板时不显示。
  - 「测试页」按钮：按它负责的第一种纸打，先看纸张分配、再看模板；都没有时按 60×40。

  **去掉**：「点选 = 选中」、「当前」标记和 `isSelectedMissing` 的提示。分配表里的「这台电脑上没有」代替它。

- [ ] **Step 3：`App.tsx` 接线**
  - `templates` 用 `window.api.listTemplates()`，模板保存后重新读，写法照配置中心里现有的读取；
  - `rows = paperRows(templates, settings.paperPrinters, installedNames, driverPapers)`；
  - `onAssign = (key, printer) => update({ paperPrinters: withAssignment(settings.paperPrinters, key, printer) })`；
  - 删掉 3.8 里暂时的 `printerName`、`useDriverPaper`、`usePrinterStatus`；
  - 标题栏胶囊在 4.5 换，这一步先用 `describePrintersSummary`（`src/shared/printer-summary.ts`）的结果喂给现有的胶囊元素。

- [ ] **Step 4：E2E**（`e2e/printers.e2e.ts` 加用例，用假打印机）
  - 有两种纸时分配表有两行，未分配的那行标红，并显示「建议：面单机C」；
  - 点建议后这一行选中 `面单机C`，`getSettings` 里有这一项；
  - 经 `updateSettings` 分配一个假打印机里没有的名字，下拉框显示「（这台电脑上没有）」；
  - 面单机B 那一行显示「驱动纸张 100×180」和「负责：…」。

- [ ] **Step 5：`bun run lint:fix && bun run check`、`bun run test:e2e`，提交** `feat(ui): assign printers per paper on the printers panel`

### Task 4.4：模板编辑器的纸张和打印机

**Files:**
- Modify: `src/renderer/src/components/TemplateEditor.tsx:81-150`（`BasicSection`）
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx:77,131-141`（去掉「纸张固定 60×40mm」；列表每行显示纸张和打印机）
- Modify: `src/renderer/src/components/config/ConfigPages.tsx:27,59`、`App.tsx`（打印机列表和纸张分配传进配置中心）

- [ ] **Step 1：`BasicSection` 加两项**（沿用文件里现有的表单组件 `label.form-row`、`select-field`、`NumberField`，props 名以 `form-controls.tsx` 为准）

```tsx
const [isCustom, setIsCustom] = useState(() => findPreset(draft.paper) === null);
const setPaper = (paper: PaperSize) => onChange(withPaper(draft, paper));
const assignedPrinter = resolvePrinter({ paper: draft.paper, printer: null }, paperPrinters, names).printerName;
// …
<label className="form-row">
  <span className="form-row__label">纸张尺寸</span>
  <select
    className="select-field select-field--fill"
    value={isCustom ? 'custom' : paperKey(draft.paper)}
    onChange={(event) => {
      const preset = PAPER_PRESETS.find((item) => paperKey(item) === event.target.value);
      // 选「自定义」只打开宽、高两个输入框，纸张先不变。
      setIsCustom(preset === undefined);
      if (preset) {
        setPaper({ widthMm: preset.widthMm, heightMm: preset.heightMm });
      }
    }}
  >
    {PAPER_PRESETS.map((preset) => (
      <option key={paperKey(preset)} value={paperKey(preset)}>{`${preset.name}（${preset.usage}）`}</option>
    ))}
    <option value="custom">自定义…</option>
  </select>
</label>
{isCustom && (
  <>
    <NumberField
      label="宽（mm）"
      min={PAPER_LIMITS_MM.width.min}
      max={PAPER_LIMITS_MM.width.max}
      step={0.1}
      value={draft.paper.widthMm}
      onChange={(widthMm) => setPaper({ ...draft.paper, widthMm })}
    />
    <NumberField
      label="高（mm）"
      min={PAPER_LIMITS_MM.height.min}
      max={PAPER_LIMITS_MM.height.max}
      step={0.1}
      value={draft.paper.heightMm}
      onChange={(heightMm) => setPaper({ ...draft.paper, heightMm })}
    />
  </>
)}
<label className="form-row">
  <span className="form-row__label">打印机</span>
  <select
    className="select-field select-field--fill"
    value={draft.printer ?? ''}
    onChange={(event) => onChange({ ...draft, printer: event.target.value || null })}
  >
    <option value="">{`按纸张分配（当前是 ${assignedPrinter ?? '还没有'}）`}</option>
    {draft.printer !== null && !names.includes(draft.printer) && (
      <option value={draft.printer}>{`${draft.printer}（这台电脑上没有）`}</option>
    )}
    {printers.map((printer) => (
      <option key={printer.name} value={printer.name}>
        {printer.displayName}
      </option>
    ))}
  </select>
</label>
```

- [ ] **Step 2：接线**
  - `printers`、`paperPrinters` 从 App 一路传下来：App → `ConfigPages`（第 27、59 行的 props）→ `TemplatesPageProps` → `EditView` → `TemplateEditor` → `BasicSection`。App 里已经有 `usePrinters`，配置中心打开时直接复用。
  - `TemplatesPage.tsx:77` 删掉「纸张固定 60×40mm」。
  - 模板列表（`TemplateGroup` 第 131–141 行）每行加一行小字：`${formatPaperName(template.paper)} · ${describeTemplatePrinter(template, paperPrinters, names)}`。

- [ ] **Step 3：E2E**（`app.e2e.ts`）：
  - 复制一个内置模板，纸张选「100×100 标签」，预览的 `.ruler--horizontal svg` 的 viewBox 变成 100；
  - 选「自定义…」后出现宽、高两个输入框，填 88 × 55，预览跟着变；
  - 保存后，列表这一行显示「88×55 · 还没有打印机」。

- [ ] **Step 4：`bun run lint:fix && bun run check`、`bun run test:e2e`，提交** `feat(ui): choose the paper and printer of a template`

### Task 4.5：标题栏汇总胶囊、状态条去打印机页、打印记录显示纸张

**Files:**
- Modify: `src/renderer/src/components/workbench/WorkbenchSide.tsx`（当前标签页由外面传入）
- Modify: `src/renderer/src/components/TitleBar.tsx:96`（胶囊改成按钮）
- Modify: `src/renderer/src/App.tsx`（标签页状态、`onOpenPage('printers')`）
- Delete: `src/renderer/src/lib/printer-chip.ts`、`printer-chip.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`（`describeJobMeta`）、`components/JobLog.tsx:57`
- Modify: `src/shared/label-paper.ts`（删 `LABEL_PAPER_MM`）

- [ ] **Step 1：写失败的测试**（`status-text.test.ts`，`JOB` 用文件里现有的 `JobRecord` 夹具，来源文字以 `describeSource` 为准）

```ts
describe('describeJobMeta', () => {
  test('shows the time, source, printer and paper of a job', () => {
    expect(describeJobMeta({ ...JOB, printerName: '面单机B', paper: '100x180' })).toBe(
      `${formatDateTime(JOB.createdAt)} · ${describeSource(JOB.source)} · 面单机B · 100×180 二联面单`,
    );
  });

  test('shows a dash for 1.0.x jobs without paper and skips an empty printer', () => {
    expect(describeJobMeta({ ...JOB, printerName: '', paper: undefined })).toBe(
      `${formatDateTime(JOB.createdAt)} · ${describeSource(JOB.source)} · —`,
    );
  });
});
```

- [ ] **Step 2：失败** → **Step 3：实现**

**打印记录**：`describeJobMeta(job)` 拼出时间、来源、打印机、纸张：
- 打印机为空时不显示这一项；
- 有 `paper` 时显示 `formatPaperName(parsePaperKey(job.paper))`，没有时显示「—」。

`JobLog.tsx:57` 改用它。

**右侧标签页**：
- `WorkbenchSide` 的 `active`、`onSelect` 改由 props 传入，`SideTab` 类型导出；
- 状态提到 App：`const [sideTab, setSideTab] = useState<SideTab>('printers')`。

**标题栏胶囊**：
- 改成 `<button type="button" className="printer-chip …" onClick={onOpenPrinters} title="打印机">`；
- 外观保持胶囊，沿用 `.printer-chip`，只补 `button` 的样式重置和焦点框；
- 数据来自 `describePrintersSummary(inputs)`。`inputs` 是界面这边算出来的打印机列表：`Object.values(settings.paperPrinters)` 加上模板指定的打印机，去重；`isListed` 看 `usePrinters`，`readiness` 看 `use-printer-profiles`。

**App 的 `onOpenPage(page)`**：
- 收到 `'printers'` 时 `setSideTab('printers')`，焦点照常回扫码框，不打开配置中心；
- 其他页照旧打开配置中心。

**清理**：
- 删掉 `printer-chip.ts` 和它的测试；
- `grep -rn "LABEL_PAPER_MM" src e2e scripts` 为空之后，删掉 `label-paper.ts` 里的 `LABEL_PAPER_MM`。

- [ ] **Step 4：E2E**：
  - 补上 3.8 第 3 个用例的后半段：点「去指定打印机」后，右侧「打印机」标签页被选中；
  - 标题栏胶囊：两台假打印机都就绪时显示「打印机 2 台就绪」，点一下右侧切到「打印机」页；
  - 打印记录：两条记录分别显示「60×40 标签」和「100×180 二联面单」。

- [ ] **Step 5：`bun run lint:fix && bun run check`、`bun run test:e2e`，提交** `feat(ui): printer summary chip, open the printers panel, paper in the job log`

### Task 4.6：视觉验收新增三项

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`：
  - 第 43 行的头注释改为 V01–V37；
  - `useFakePrinter` 改为用假打印机启动；
  - 新增 V35–V37。
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md` §8.2（表里加三行）

- [ ] **Step 1**：`useFakePrinter` 改为用 3.7 的假打印机启动，并设好纸张分配（`paperPrinters: { '60x40': FAKE_PRINTER }`）。原来依赖它的各项（第 519、544、837 行附近）照常工作。
- [ ] **Step 2**：新增三项：
  - **V35 打印机页 · 纸张分配**：
    - 三台假打印机，驱动纸张各不相同，其中一台缺纸；
    - 两种纸：一种已分配，一种未分配、带建议；
    - 截图检查分配表、未分配的标红、建议按钮、每台的驱动纸张和「负责」、缺纸状态，以及标题栏的汇总胶囊。
  - **V36 模板编辑器 · 纸张和打印机**：
    - 纸张下拉框选中一个面单预设；
    - 自定义尺寸的两个数字框；
    - 打印机下拉框，含「这台电脑上没有」的一项。
  - **V37 非 60×40 的预览**：50×30、100×100 两张，看软尺刻度，以及二维码和字号是否放得下。
- [ ] **Step 3**：`bunx playwright test --config e2e/visual/playwright.config.ts` 全部通过，原有 V01–V34 重截没有问题。验收页照原来的办法发给用户逐项确认。
- [ ] **Step 4：提交** `test(visual): cover printer assignment, paper choice and other paper sizes`

---

## 阶段 5：验收与文档

**目标**：真机验证、文档跟上。
**状态**：In Progress（文档已更新；两台真打印机的实测、中转服务部署待做）

- [ ] **Step 1：真机（Windows）**：
  - 两台打印机（至少一台真的热敏标签机）按纸张分配各打一张；
  - 模板指定的打印机优先；
  - 拔掉一台时，状态胶囊和系统通知正确，另一台缺纸的通知不被压住；
  - 在打印首选项里改驱动纸张后，打印机页的建议和提醒跟着更新；
  - 在 150% 缩放下看一遍打印机页和模板编辑器。

  结果写进 `docs/windows-acceptance.md`，从 #45 开始编号。
- [ ] **Step 2：真机（macOS）**：
  - 同样各打一张，用 `lpstat -W completed -l` 或 CUPS 网页查看任务的纸张是不是模板尺寸；
  - 用驱动报 600dpi 的家用打印机，核对二维码的大小。

  结果写进 `docs/roadmap.md` 的 macOS 一行。
- [ ] **Step 3：文档**：
  - **`README.md`**：第 3 行「60×40mm 标签…在选中的本机打印机上打印」和第 52 行的打印机说明，改为多台打印机、按纸张分配。
  - **根目录 `CLAUDE.md`**：
    - 「项目」一段的「60×40mm 标签」改为「按模板纸张（默认 60×40mm）」；
    - 第 150 行「CUPS 任务的纸张是不是 60×40」改为「是不是模板的纸张」；
    - 「文档」表加上本设计。
  - **`src/renderer/CLAUDE.md:63`**：「60×40mm 按容器大小等比缩放」改为按模板纸张，并写明预览的 CSS 变量 `--paper-w`、`--paper-h`。
  - **`src/main/CLAUDE.md`**：
    - 打印一节加上 `printer-profiles.ts`、`page-size.ts`、`fake-printers.ts`，以及环境变量 `CDL_LABELFLASH_FAKE_PRINTERS`（只对未打包的程序生效）；
    - `qr-code.ts` 的「203dpi」改为「按打印机分辨率，读不到按 203dpi」。
  - **`src/core/CLAUDE.md`**：模块表加 `printing/resolve-printer.ts`，写明 `PrintService.printLabel` 是本机接口的入口。
  - **`docs/roadmap.md`**：第 31、35、38 行里 60×40 的说法；「多台打印机、多种纸张」一行标为已完成（版本号发版时填）。
- [ ] **Step 4：部署中转服务**：3.5 改了扫码页的文字，合进 master 后按 `relay/README.md` 部署一次，部署后用手机打开扫码页核对文字。部署前告诉用户。
- [ ] **Step 5**：`bun run check`、`bun run test:e2e`、`bun run test:relay-browser`、视觉验收全部通过；提交 `docs: multiple printers and paper sizes`。
- [ ] **Step 6**：PR 合进 master。发版前按项目规定先问用户（版本号建议 1.1.0）。

---

## 自查记录

**设计覆盖**（设计文档的章节 → 任务）：

| 设计文档 | 任务 |
|---|---|
| 3.1 预设 | 1.2 |
| 3.3 模板纸张、二维码上限、分辨率 | 1.3、2.1、2.2 |
| 4.1 规则（含两种原因同时出现） | 3.1 |
| 4.1 第 3 条：不打、不记、可重试、去指定打印机 | 3.5、3.8、4.5 |
| 4.2 建议 | 4.1、4.3 |
| 5.1 打印机页（含已不用的纸、这台电脑上没有、测试页的纸张） | 4.1、4.3 |
| 5.2 模板编辑器和列表 | 4.4 |
| 5.3 标题栏 | 4.5 |
| 5.3 工具条 | 4.2 |
| 5.3 打印记录 | 4.5 |
| 5.3 状态检测和限频 | 3.4 |
| 5.3 手机 | 3.6、3.8 |
| 6 数据：设置迁移 | 3.8 |
| 6 数据：`jobs.paper`、`jobs.template_id` | 3.2 |
| 6 数据：分辨率不存盘 | 2.3 |
| 7 流程：先决定打印机再占防重复窗口、每台一个队列 | 3.8 |
| 7 流程：通知的 `paper` 字段 | 3.3 |
| 8 测试：单元 | 各任务 |
| 8 测试：E2E | 3.7、3.8、4.x |
| 8 测试：视觉 | 4.6 |
| 8 测试：真机 | 2.4、阶段 5 |
| 9 打印时限时等驱动资料 | 2.3 |
| 10 衔接：`printLabel` | 3.8 |
| 10 衔接：`template_id` | 3.2 |
| 10 衔接：推迟的表重建 | 写在迁移注释（3.2）和设计文档第 10 节里 |

**类型一致**：以下名字在各任务里同名、同签名。

| 类别 | 名字 |
|---|---|
| 纸张与模板 | `PaperSize`、`paperKey`、`parsePaperKey`、`withPaper` |
| 决定打印机 | `PrinterTarget`、`PrinterChoice`（`unassigned` 带 `missingPrinter`）、`resolvePrinter`、`choosePrinter` |
| 驱动资料 | `PrinterProfiles.get` / `dpiOf` / `forget` |
| 打印结果与设置 | `RecordedResult`、`JobTarget`、`paperPrinters`、`MAX_PAPER_ASSIGNMENTS` |
| 汇总文字 | `describePrintersSummary`、`phonePrinterLabel`、`PrinterSummaryInput` |
| 假打印机 | `PrinterDriver`、`FakePrinters`、`FakeDriverAdapter`、`FAKE_PRINTERS_ENV`、`fakePrints`、`seedLegacySelectedPrinter` |
| 界面纯逻辑 | `PaperRow`、`paperRows`、`responsibilitiesOf`、`withAssignment`、`describeTemplatePrinter`、`describePreviewPrinter`、`describeJobMeta` |

**每个提交都能通过检查**：
- 改了签名的，调用方放在同一个任务里：1.3 的 `maxQrSizeMm`；2.3 的 `checkDriverPaper` 带缺省参数，旧调用照常编译；3.5 先加类型，3.8 才开始产出这种结果。
- 只有 3.8 必须一次改完，已列出全部调用方：设置、PrintService、IPC、手机、脚本、中转测试、界面和 E2E。
