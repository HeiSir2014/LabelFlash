# 多台打印机、多种纸张 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：模板带纸张尺寸（含快递面单预设），每一张按「模板指定的打印机 → 纸张分配的打印机」自动打到装着对应纸张的那台打印机上，所有打印入口共用这套规则。

**架构**：纸张预设和纸张键放在 `src/shared/paper-sizes.ts`；「决定打印机」是 core 里的纯函数 `resolvePrinter`，由 `PrintService` 通过注入的 `choosePrinter` 调用，所以扫码枪、记录重打、手机扫码都在主进程里按模板决定打印机（界面不再传打印机名）。排版、打印页面尺寸、二维码对齐都改为按模板的纸张和打印机分辨率计算。

**技术栈**：TypeScript、Electron、React 19、bun test、Playwright、Biome、SQLite（`node:sqlite`）。

**设计文档**：`docs/superpowers/specs/2026-09-29-multi-printer-paper-design.md`

**约定**（见根目录和各目录的 CLAUDE.md）：测试先行；每个提交都通过 `bun run check`；改了界面或主进程再跑 `bun run test:e2e`；注释中文，标识符和提交信息英文；不写魔法数字；提交信息结尾带协作署名。

---

## 文件地图

| 文件 | 状态 | 职责 |
|---|---|---|
| `src/shared/paper-sizes.ts` | 新建 | 纸张预设、纸张键（`60x40`）、名称、上下限、校验、宽松相等 |
| `src/shared/label-paper.ts` | 修改 | 只保留 `DEFAULT_PAPER`（60×40）作为内置模板和旧数据的缺省值 |
| `src/core/templates/template-model.ts` | 修改 | `LabelTemplate` 加 `paper`、`printer`；尺寸计算改为按模板纸张 |
| `src/core/templates/sanitize-template.ts` | 修改 | 校验 `paper`、`printer` |
| `src/core/templates/builtin-templates.ts` | 修改 | 内置模板加 `paper: DEFAULT_PAPER, printer: null` |
| `src/core/printing/resolve-printer.ts` | 新建 | 纯函数：模板 + 纸张分配 + 本机打印机 → 用哪台、为什么 |
| `src/core/types.ts` | 修改 | `PrintRequest` 去掉 `printerName`；`PrintResult` 加 `no-printer`；`JobRecord` 加 `paper`；`PreviewResult` 带打印机 |
| `src/core/print-service.ts` | 修改 | 注入 `choosePrinter`；没有打印机时返回 `no-printer`、不写记录 |
| `src/shared/settings.ts` | 修改 | 加 `paperPrinters`，从 `selectedPrinter` 迁移，去掉 `selectedPrinter` |
| `src/shared/driver-paper.ts` | 修改 | `checkDriverPaper(paper, expected)` 按模板纸张比较 |
| `src/main/printing/qr-code.ts` | 修改 | `planQr` 接收分辨率 |
| `src/main/printing/label-html.ts` | 修改 | 按模板纸张排版，接收分辨率 |
| `src/main/printing/printer-profiles.ts` | 新建 | 每台打印机的驱动纸张和分辨率（短时缓存） |
| `src/main/printing/electron-driver-adapter.ts` | 修改 | 页面尺寸按模板纸张；分辨率来自打印机资料 |
| `src/main/storage/migrations.ts` | 修改 | 末尾追加第 2 条迁移：`jobs.paper` |
| `src/main/storage/sqlite-job-store.ts` | 修改 | 读写 `paper` |
| `src/core/notify/webhook-event.ts` | 修改 | 通知里加 `paper` |
| `src/main/index.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/shared/ipc-contract.ts` | 修改 | 接线：`choosePrinter`、`print(raw, options)`、打印机资料、状态检测多台 |
| `src/main/mobile/mobile-host.ts`、`mobile-station.ts` | 修改 | 打印不再传打印机名；手机顶部显示打印机汇总 |
| `src/renderer/src/lib/printer-assignment.ts` | 新建 | 纯函数：纸张分配表、建议、每台打印机负责什么、标题栏汇总 |
| `src/renderer/src/components/PrinterList.tsx` | 改写 | 打印机页：纸张分配表 + 打印机列表 |
| `src/renderer/src/components/TemplateEditor.tsx` | 修改 | 「纸张尺寸」「打印机」两项 |
| `src/renderer/src/components/LabelPreview.tsx`、`PreviewStage.tsx`、`workbench/PreviewToolbar.tsx` | 修改 | 按纸张显示；工具条显示打印机 |
| `src/renderer/src/lib/printer-chip.ts`、`status-text.ts`、`App.tsx`、`view-models/*` | 修改 | 汇总胶囊、`no-printer` 状态、去掉「选中的打印机」 |
| `e2e/support/app-helpers.ts`、`e2e/*.e2e.ts`、`e2e/visual/acceptance.visual.ts` | 修改 | 用纸张分配代替 `selectedPrinter`；新增用例和视觉项 |

---

## 阶段 1：纸张模型（纯逻辑）

**目标**：有纸张预设和纸张键；模板带纸张和指定打印机；60×40 的一切结果不变。
**成功标准**：`bun run check` 通过；60×40 排版快照不变。
**状态**：Not Started

### Task 1.1：先给 60×40 的排版结果拍快照（防退步）

**Files:**
- Create: `src/main/printing/label-html.snapshot.test.ts`

- [ ] **Step 1：写快照测试（在改任何排版代码之前）**

```ts
import { describe, expect, test } from 'bun:test';
import { BUILT_IN_TEMPLATES } from '../../core/templates/builtin-templates';
import type { LabelJob } from '../../core/types';
import { renderLabelHtml } from './label-html';

/** 固定的识别结果和打印时间：快照只随排版规则变，不随时间变。 */
const SCAN = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};
const PRINTED_AT = Date.UTC(2026, 8, 29, 8, 0, 0);

// 支持多种纸张以后，60×40 的每个内置模板必须和现在一字不差：操作员天天在打的标签不能变。
describe('60×40 label HTML stays the same', () => {
  for (const template of BUILT_IN_TEMPLATES) {
    test(template.name, () => {
      const job: LabelJob = { scan: SCAN, template, printedAt: PRINTED_AT };
      expect(renderLabelHtml(job).html).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2：运行，生成快照**

Run: `bun test src/main/printing/label-html.snapshot.test.ts`
Expected: PASS，生成 `src/main/printing/__snapshots__/label-html.snapshot.test.ts.snap`

- [ ] **Step 3：提交**

```bash
git add src/main/printing/label-html.snapshot.test.ts src/main/printing/__snapshots__
git commit -m "test(printing): snapshot the 60x40 label HTML before paper sizes change"
```

### Task 1.2：纸张预设与纸张键

**Files:**
- Create: `src/shared/paper-sizes.ts`
- Test: `src/shared/paper-sizes.test.ts`

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
  test('cover the courier waybill sizes with their cut points', () => {
    expect(findPreset({ widthMm: 100, heightMm: 177 })?.parts).toEqual([107, 70]);
    expect(findPreset({ widthMm: 100, heightMm: 180 })?.parts).toEqual([110, 70]);
    expect(findPreset({ widthMm: 76, heightMm: 130 })?.parts).toEqual([]);
  });

  test('every preset fits the limits and its parts add up to its height', () => {
    for (const preset of PAPER_PRESETS) {
      expect(preset.widthMm).toBeGreaterThanOrEqual(PAPER_LIMITS_MM.width.min);
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
  test('keeps a valid size and rounds to 0.1mm', () => {
    expect(sanitizePaper({ widthMm: 100.04, heightMm: 150 }, { widthMm: 60, heightMm: 40 })).toEqual({
      widthMm: 100,
      heightMm: 150,
    });
  });

  test('falls back when the size is missing or out of range', () => {
    const fallback = { widthMm: 60, heightMm: 40 };
    expect(sanitizePaper(undefined, fallback)).toEqual(fallback);
    expect(sanitizePaper({ widthMm: 5, heightMm: 40 }, fallback)).toEqual(fallback);
    expect(sanitizePaper({ widthMm: 100, heightMm: 999 }, fallback)).toEqual(fallback);
  });
});

describe('isSamePaper', () => {
  // 驱动以 0.1mm 为单位保存纸张，四舍五入后可能差零点几毫米。
  test('treats sizes within 1mm as the same paper', () => {
    expect(isSamePaper({ widthMm: 60.4, heightMm: 39.8 }, { widthMm: 60, heightMm: 40 })).toBe(true);
    expect(isSamePaper({ widthMm: 100, heightMm: 177 }, { widthMm: 100, heightMm: 180 })).toBe(false);
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `bun test src/shared/paper-sizes.test.ts`
Expected: FAIL，`Cannot find module './paper-sizes'`

- [ ] **Step 3：实现**

```ts
/**
 * 纸张尺寸：模板用多大的纸、打印机装的是多大的纸，都用它描述。
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
  /** 二联、三联面单每一联的高度（mm），从上到下；一联和普通标签为空。 */
  parts: readonly number[];
  /** 用在哪些地方（只用于显示）。 */
  usage: string;
}

/** 自定义尺寸的范围：覆盖所有预设并留出余量。 */
export const PAPER_LIMITS_MM = {
  width: { min: 20, max: 120 },
  height: { min: 20, max: 220 },
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

function formatMm(mm: number): string {
  return String(Math.round(mm * TENTHS_PER_MM) / TENTHS_PER_MM);
}

/** 纸张分配表的键：宽x高（毫米，去掉多余的 0），例如 60x40、76.5x130。 */
export function paperKey(paper: PaperSize): string {
  return `${formatMm(paper.widthMm)}x${formatMm(paper.heightMm)}`;
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
  return PAPER_PRESETS.find((preset) => paperKey(preset) === paperKey(paper)) ?? null;
}

/** 例如「60×40 标签」；不是预设时「88×55」。 */
export function formatPaperName(paper: PaperSize): string {
  return findPreset(paper)?.name ?? `${formatMm(paper.widthMm)}×${formatMm(paper.heightMm)}`;
}

export function sanitizePaper(value: unknown, fallback: PaperSize): PaperSize {
  if (typeof value !== 'object' || value === null) {
    return fallback;
  }
  const input = value as Record<string, unknown>;
  const widthMm = input['widthMm'];
  const heightMm = input['heightMm'];
  if (typeof widthMm !== 'number' || typeof heightMm !== 'number') {
    return fallback;
  }
  const paper = {
    widthMm: Math.round(widthMm * TENTHS_PER_MM) / TENTHS_PER_MM,
    heightMm: Math.round(heightMm * TENTHS_PER_MM) / TENTHS_PER_MM,
  };
  return isWithinLimits(paper) ? paper : fallback;
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

- [ ] **Step 4：运行，确认通过**

Run: `bun test src/shared/paper-sizes.test.ts`
Expected: PASS

- [ ] **Step 5：`label-paper.ts` 改成缺省纸张**

```ts
import type { PaperSize } from './paper-sizes';

/** 内置模板和旧数据（没有纸张字段）的纸张：60×40mm 背胶热敏标签。 */
export const DEFAULT_PAPER: PaperSize = { widthMm: 60, heightMm: 40 };
```

先不删 `LABEL_PAPER_MM`：把它改成 `export const LABEL_PAPER_MM = { width: DEFAULT_PAPER.widthMm, height: DEFAULT_PAPER.heightMm } as const;`，后面的任务逐个换掉用法，最后一个任务删掉它。

- [ ] **Step 6：`bun run check`，提交**

```bash
git add src/shared/paper-sizes.ts src/shared/paper-sizes.test.ts src/shared/label-paper.ts
git commit -m "feat(paper): paper presets, paper keys and validation"
```

### Task 1.3：模板带纸张和指定打印机

**Files:**
- Modify: `src/core/templates/template-model.ts`（`LabelTemplate`、`maxQrSizeMm`、`sideTextWidthMm`、`fullTextWidthMm`、`TEMPLATE_LIMITS`）
- Modify: `src/core/templates/sanitize-template.ts`
- Modify: `src/core/templates/builtin-templates.ts`
- Modify: `src/renderer/src/components/TemplateEditor.tsx:120,144`（`maxQrSizeMm` 新签名）
- Test: `src/core/templates/templates.test.ts`

- [ ] **Step 1：写失败的测试**（加到 `templates.test.ts` 末尾）

```ts
describe('template paper and printer', () => {
  const fallback = BUILT_IN_TEMPLATES[0] as LabelTemplate;

  test('an old template without paper is 60x40 with no printer of its own', () => {
    const { paper, printer, ...old } = fallback;
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

  test('limits the QR code to the paper height', () => {
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
});
```

（文件顶部补 import：`maxQrSizeMm`、`fullTextWidthMm`、`sanitizeTemplate`、`BUILT_IN_TEMPLATES`、`type LabelTemplate`，按文件现有写法。）

- [ ] **Step 2：运行，确认失败**

Run: `bun test src/core/templates/templates.test.ts`
Expected: FAIL（`paper` 不存在、`maxQrSizeMm` 参数不对）

- [ ] **Step 3：实现 `template-model.ts`**

```ts
import { DEFAULT_PAPER } from '../../shared/label-paper';
import type { PaperSize } from '../../shared/paper-sizes';
```

`LabelTemplate` 里 `name` 后面加：

```ts
  /** 用多大的纸：排版、预览软尺和打印页面尺寸都按它；按纸张分配打印机。 */
  paper: PaperSize;
  /** 指定的打印机（系统里的打印机名）；null = 按纸张分配。这台电脑上没有这台打印机时退回按纸张分配。 */
  printer: string | null;
```

`TEMPLATE_LIMITS.qrSizeMm` 改为 `{ min: 10 }`（上限按纸张算，见 `maxQrSizeMm`），并加 `printerNameLength: 256`。三个尺寸函数：

```ts
/** 二维码允许的最大边长：纸张的短边去掉两边的边距。 */
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
```

60×40 下 `min(60, 40) = 40`，和原来的「纸张高度」相同，快照不变。

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
    // …原有字段不变，只改二维码上限：
    qr: {
      visible: bool(qrInput['visible'], fallback.qr.visible),
      sizeMm: clamp(qrInput['sizeMm'], qrSizeMm.min, maxQrSizeMm(paper, padding), fallback.qr.sizeMm),
      // …
    },
```

文件末尾加：

```ts
/** 打印机名只保存、只比较，不交给系统命令；超长或非字符串当作不指定。 */
function sanitizePrinterName(value: unknown): string | null {
  const { printerNameLength } = TEMPLATE_LIMITS;
  return typeof value === 'string' && value.trim() !== '' && value.length <= printerNameLength ? value : null;
}
```

注意：`fallback.qr.sizeMm` 可能大于新纸张的上限，`clamp` 的缺省值也要夹到上限内：`Math.min(fallback.qr.sizeMm, maxQrSizeMm(paper, padding))`。

- [ ] **Step 5：内置模板**：`builtin-templates.ts` 每个模板加 `paper: DEFAULT_PAPER, printer: null`。

- [ ] **Step 6：模板编辑器跟上新签名**：`TemplateEditor.tsx` 两处 `maxQrSizeMm(paddingMm)` → `maxQrSizeMm(draft.paper, paddingMm)`，`maxQrSizeMm(draft.paddingMm)` → `maxQrSizeMm(draft.paper, draft.paddingMm)`。

- [ ] **Step 7：运行测试和快照**

Run: `bun test src/core/templates src/main/printing/label-html.snapshot.test.ts`
Expected: PASS（快照不变）

- [ ] **Step 8：`bun run check`，提交**

```bash
git add src/core/templates src/renderer/src/components/TemplateEditor.tsx
git commit -m "feat(templates): templates carry their paper size and an optional printer"
```

---

## 阶段 2：排版和打印按纸张

**目标**：标签 HTML、打印页面尺寸、二维码对齐都按模板纸张和打印机分辨率。
**成功标准**：50×30、70×50、100×100 放得下；60×40 快照不变；E2E 通过。
**状态**：Not Started

### Task 2.1：二维码按打印机分辨率对齐

**Files:**
- Modify: `src/main/printing/qr-code.ts`
- Test: `src/main/printing/qr-code.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
test('aligns modules to the dots of a 300dpi printer', () => {
  const plan = planQr('CL5640-TK-图片色-XL', 'M', 20, 300);
  expect(plan).not.toBeNull();
  const dotMm = 25.4 / 300;
  expect((plan?.sizeMm ?? 0) / dotMm).toBeCloseTo((plan?.moduleCount ?? 0) * (plan?.moduleDots ?? 0), 6);
});

test('uses 203dpi when the printer does not say', () => {
  expect(planQr('ABC', 'M', 20)).toEqual(planQr('ABC', 'M', 20, DEFAULT_PRINTER_DPI));
});
```

- [ ] **Step 2：运行，确认失败**：`bun test src/main/printing/qr-code.test.ts` → FAIL

- [ ] **Step 3：实现**

```ts
/**
 * 热敏标签机最常见的分辨率 203dpi（打印头一个点 ≈ 0.125mm）；驱动报告了分辨率时按驱动的（例如 300dpi）。
 * 二维码每个模块取整数个点：模块边缘落在点与点之间，打出来宽窄一致、边缘清晰。
 */
export const DEFAULT_PRINTER_DPI = 203;
const MM_PER_INCH = 25.4;

export function dotMm(dpi: number): number {
  return MM_PER_INCH / dpi;
}

export function planQr(text: string, preferred: QrErrorLevel, boxMm: number, dpi = DEFAULT_PRINTER_DPI): QrPlan | null {
  const dot = dotMm(dpi);
  const boxDots = Math.floor(boxMm / dot + 1e-9);
  // …循环不变，只把 PRINTER_DOT_MM 换成 dot：
  //   sizeMm: modules.size * moduleDots * dot,
}
```

删掉 `PRINTER_DPI`、`PRINTER_DOT_MM` 两个导出，用到它们的地方（测试）改用 `DEFAULT_PRINTER_DPI`、`dotMm(...)`。

- [ ] **Step 4：运行，确认通过**；**Step 5：提交** `feat(printing): align QR modules to the printer's own resolution`

### Task 2.2：标签 HTML 按模板纸张

**Files:**
- Modify: `src/main/printing/label-html.ts:44-99`
- Test: `src/main/printing/label-html.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
describe('paper sizes', () => {
  const base = BUILT_IN_TEMPLATES[0] as LabelTemplate;
  const job = (paper: PaperSize): LabelJob => ({
    scan: SCAN,
    template: { ...base, paper, qr: { ...base.qr, sizeMm: Math.min(base.qr.sizeMm, maxQrSizeMm(paper, base.paddingMm)) } },
    printedAt: PRINTED_AT,
  });

  test.each([
    { widthMm: 50, heightMm: 30 },
    { widthMm: 70, heightMm: 50 },
    { widthMm: 100, heightMm: 100 },
  ])('lays out a $widthMm x $heightMm label on that paper', (paper) => {
    const { html, qrOmitted } = renderLabelHtml(job(paper));
    expect(html).toContain(`@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: 0; }`);
    expect(qrOmitted).toBe(false);
  });

  test('renders the QR code for a 300dpi printer', () => {
    expect(renderLabelHtml(job({ widthMm: 60, heightMm: 40 }), 300).html).toContain('<svg');
  });
});
```

（`SCAN`、`PRINTED_AT` 用文件里现有的样例；没有就照 Task 1.1 的写法加。）

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**：`renderLabelHtml(job: LabelJob, dpi = DEFAULT_PRINTER_DPI)`；第 52 行改为

```ts
  const { widthMm: width, heightMm: height } = template.paper;
```

`planQr(…, template.qr.sizeMm)` 改为 `planQr(…, template.qr.sizeMm, dpi)`；删掉 `LABEL_PAPER_MM` 的 import；注释「由模板生成 60×40mm 标签 HTML」改为「按模板的纸张生成标签 HTML」。

- [ ] **Step 4：运行 `bun test src/main/printing`**：新测试和 60×40 快照都通过

- [ ] **Step 5：提交** `feat(printing): lay labels out on the template's paper`

### Task 2.3：打印机资料（驱动纸张 + 分辨率）

**Files:**
- Create: `src/main/printing/printer-profiles.ts`
- Test: `src/main/printing/printer-profiles.test.ts`
- Modify: `src/shared/driver-paper.ts`（`checkDriverPaper(paper, expected)`）

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { PRINTER_PROFILE_TTL_MS, PrinterProfiles } from './printer-profiles';

describe('PrinterProfiles', () => {
  test('reads a printer once and reuses it for a while', async () => {
    const clock = new FakeClock();
    let reads = 0;
    const profiles = new PrinterProfiles(async () => {
      reads += 1;
      return { widthMm: 100, heightMm: 180, dpi: 300 };
    }, clock);
    expect(await profiles.get('面单机B')).toEqual({ widthMm: 100, heightMm: 180, dpi: 300 });
    await profiles.get('面单机B');
    expect(reads).toBe(1);
    clock.advance(PRINTER_PROFILE_TTL_MS);
    await profiles.get('面单机B');
    expect(reads).toBe(2);
  });

  test('gives 203dpi when the driver does not report a resolution', async () => {
    const profiles = new PrinterProfiles(async () => null, new FakeClock());
    expect(await profiles.dpiOf('标签机A')).toBe(203);
  });
});
```

（`FakeClock` 在 `src/core/testing/fake-clock.ts`，有 `advance(ms)`。）

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**

```ts
import type { Clock } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { DEFAULT_PRINTER_DPI } from './qr-code';

/** 驱动设置很少变；1 分钟内重复打印、预览不必每次都去查（Windows 上一次查询约耗 1 秒 CPU）。 */
export const PRINTER_PROFILE_TTL_MS = 60_000;

interface Entry {
  at: number;
  paper: Promise<DriverPaper | null>;
}

/** 每台打印机的驱动默认纸张和分辨率，短时缓存。查询失败按「读不到」处理，不影响打印。 */
export class PrinterProfiles {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly read: (printerName: string) => Promise<DriverPaper | null>,
    private readonly clock: Clock,
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

  async dpiOf(printerName: string): Promise<number> {
    return (await this.get(printerName))?.dpi ?? DEFAULT_PRINTER_DPI;
  }

  /** 操作员刚在「打印首选项」里改过设置：下次重新读。 */
  forget(printerName: string): void {
    this.entries.delete(printerName);
  }
}
```

`driver-paper.ts` 的 `checkDriverPaper` 改为按期望纸张比较（`isSamePaper` 来自 `paper-sizes.ts`），`PAPER_TOLERANCE_MM` 移到 `paper-sizes.ts` 并从这里删掉：

```ts
export function checkDriverPaper(paper: DriverPaper | null, expected: PaperSize): PaperCheck {
  if (paper === null) {
    return { status: 'unknown' };
  }
  return { status: isSamePaper(paper, expected) ? 'ok' : 'mismatch', paper };
}
```

`src/shared/driver-paper.test.ts` 里原有的用例补上第二个参数 `DEFAULT_PAPER`，再加一条：`100×180` 的驱动纸张对 `100×180` 模板是 `ok`、对 60×40 是 `mismatch`。

- [ ] **Step 4：运行，确认通过**；**Step 5：提交** `feat(printing): cache each printer's driver paper and resolution`

### Task 2.4：打印页面尺寸按模板纸张

**Files:**
- Modify: `src/main/printing/electron-driver-adapter.ts:35-105`
- Modify: `src/main/index.ts`（创建 `PrinterProfiles`，交给适配器）

- [ ] **Step 1**：`ElectronDriverAdapter` 构造参数加 `private readonly profiles: PrinterProfiles`；`print()` 里：

```ts
    const dpi = await this.profiles.dpiOf(printerName);
    const { html } = renderLabelHtml(job, dpi);
    // …
      await printSilently(printWindow.webContents, printerName, job.template.paper, signal);
```

`printSilently` 加参数 `paper: PaperSize`，`pageSize: { width: paper.widthMm * MICRONS_PER_MM, height: paper.heightMm * MICRONS_PER_MM }`；删掉 `LABEL_PAPER_MM` 的 import。

- [ ] **Step 2**：`index.ts` 在创建适配器前：

```ts
  const profiles = new PrinterProfiles((name) => queryDriverPaper(name, probeHost), systemClock);
```

（`queryDriverPaper(printerName, host)` 在 `src/main/printing/driver-paper.ts`；`probeHost` 是 `index.ts:185` 创建的常驻探测进程，macOS 上为 null，此时 `queryDriverPaper` 走 ipptool。`PrinterProfiles` 要在 `probeHost` 之后创建。）

- [ ] **Step 3**：`bun run check`；`bun run test:e2e`（打印用假适配器，行为不变）→ 都通过

- [ ] **Step 4：提交** `feat(printing): print each label at its template's paper size`

---

## 阶段 3：按模板决定打印机

**目标**：主进程按「模板指定 → 纸张分配」决定打印机；没有打印机时不打、不记；手机、记录重打同一套；打印记录带纸张。
**成功标准**：单元测试覆盖 `resolvePrinter` 和迁移；E2E 全过（辅助函数改用纸张分配）。
**状态**：Not Started

### Task 3.1：设置里的纸张分配和迁移

**Files:**
- Modify: `src/shared/settings.ts`
- Test: `src/shared/settings.test.ts`

- [ ] **Step 1：写失败的测试**

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

  test('does not bring the old printer back once paper is assigned', () => {
    const settings = sanitizeSettings({ selectedPrinter: '旧打印机', paperPrinters: { '100x180': '面单机B' } });
    expect(settings.paperPrinters).toEqual({ '100x180': '面单机B' });
  });

  test('has no printer assigned by default', () => {
    expect(sanitizeSettings({}).paperPrinters).toEqual({});
  });
});
```

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**：`AppSettings` 删掉 `selectedPrinter`，加

```ts
  /**
   * 纸张 → 打印机：键是纸张键（src/shared/paper-sizes.ts 的 paperKey），值是系统里的打印机名。
   * 模板按自己的纸张打到对应的打印机；模板也可以自己指定打印机（优先）。
   */
  paperPrinters: Record<string, string>;
```

`DEFAULT_SETTINGS.paperPrinters = {}`；`sanitizeSettings` 里：

```ts
    paperPrinters: sanitizePaperPrinters(input['paperPrinters'], input['selectedPrinter']),
```

```ts
/** 1.0.x 的「选中的打印机」：没有纸张分配时（第一次升级）迁移成「60×40 → 这台」，以后不再读。 */
function sanitizePaperPrinters(value: unknown, legacySelected: unknown): Record<string, string> {
  if (!isRecord(value)) {
    const legacy = sanitizePrinterName(legacySelected);
    return legacy === null ? {} : { [paperKey(DEFAULT_PAPER)]: legacy };
  }
  const result: Record<string, string> = {};
  for (const [key, name] of Object.entries(value)) {
    const paper = parsePaperKey(key);
    const printer = sanitizePrinterName(name);
    if (paper !== null && printer !== null) {
      result[paperKey(paper)] = printer;
    }
  }
  return result;
}
```

说明：`SqliteSettingsStore.update` 写的是整份设置，数据库里旧的 `selectedPrinter` 行不会被覆盖也不会被删；只要还没有 `paperPrinters` 这一行，每次启动都按它迁移一次（结果相同）。第一次保存设置后就有了 `paperPrinters`，迁移不再发生。

- [ ] **Step 4：运行，确认通过**（`bun run typecheck` 会报出所有用到 `selectedPrinter` 的地方，留给后面几个任务逐个改）

- [ ] **Step 5：提交**（这一步先不单独提交：类型检查要等 Task 3.6 改完调用方才通过。和 3.2–3.7 一起在 Task 3.7 结束时提交，每个任务结束仍跑对应的单元测试。）

### Task 3.2：`resolvePrinter`

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

  // 模板导到别的电脑、或打印机改了名：不能打到不相关的打印机上，退回按纸张分配并说明原因。
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
    });
  });

  test('matches a paper assigned as a slightly different size', () => {
    expect(resolvePrinter({ paper: { widthMm: 60.3, heightMm: 40 }, printer: null }, ASSIGNED, INSTALLED).printerName).toBe(
      '标签机A',
    );
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
  /** 这种纸没有分配打印机（模板指定的也不在）：不打印。 */
  | { printerName: null; reason: 'unassigned'; paperKey: string };

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
    return { printerName: null, reason: 'unassigned', paperKey: paperKey(target.paper) };
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

注意：分配到的打印机即使不在系统里也照样返回它的名字，由适配器报 `PRINTER_NOT_FOUND`（和现在拔掉打印机时一样），不在这里悄悄换打印机。

- [ ] **Step 4：运行，确认通过**

### Task 3.3：`PrintService` 按模板决定打印机

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/print-service.ts`
- Modify: `src/core/testing/*`（假实现按新依赖补齐）
- Test: `src/core/print-service.test.ts`

- [ ] **Step 1：写失败的测试**（按文件里现有的 `createService` 写法补 `choosePrinter`）

```ts
describe('printer choice', () => {
  test('prints on the printer chosen for the template and records it with the paper', async () => {
    const { service, adapter, store } = createService({
      choosePrinter: async () => ({ printerName: '面单机B', reason: 'paper' }),
    });
    const result = await service.submit({ raw: 'CL5640-TK-图片色-XL', source: 'desktop' });
    expect(result.status).toBe('printed');
    expect(adapter.printed.at(-1)?.printerName).toBe('面单机B');
    expect(store.jobs.at(-1)).toMatchObject({ printerName: '面单机B', paper: '60x40' });
  });

  // 没有打印机时和 1.0.x 没选打印机一样：不打印、不写记录、不占防重复窗口。
  test('does not print or record when no printer holds the paper', async () => {
    const { service, adapter, store } = createService({
      choosePrinter: async () => ({ printerName: null, reason: 'unassigned', paperKey: '100x180' }),
    });
    const result = await service.submit({ raw: 'CL5640-TK-图片色-XL', source: 'desktop' });
    expect(result).toEqual({ status: 'no-printer', paperKey: '100x180' });
    expect(adapter.printed).toEqual([]);
    expect(store.jobs).toEqual([]);
    const retry = await service.submit({ raw: 'CL5640-TK-图片色-XL', source: 'desktop' });
    expect(retry.status).toBe('no-printer');
  });

  test('shows in the preview which printer the label would go to', async () => {
    const { service } = createService({ choosePrinter: async () => ({ printerName: '标签机A', reason: 'paper' }) });
    const preview = await service.preview('CL5640-TK-图片色-XL');
    expect(preview).toMatchObject({ status: 'ok', printer: { printerName: '标签机A', reason: 'paper' } });
  });
});
```

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现 `types.ts`**

```ts
import type { PrinterChoice } from './printing/resolve-printer';

export interface PrintRequest {
  raw: string;
  source: PrintSource;
  /** 强制补打：跳过门限窗口（不跳过正在打印的同一个码）。 */
  force?: boolean;
}

export type PrintResult =
  | { status: 'printed'; jobId: string; scan: ScanResult }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'failed'; reason: PrintFailureReason; detail?: string; issue?: PrinterIssue }
  /** 这种纸没有可用的打印机：没有打印，也不写打印记录。 */
  | { status: 'no-printer'; paperKey: string };

/** 写进打印记录的结果（no-printer 不写记录）。 */
export type PrintStatus = Exclude<PrintResult['status'], 'no-printer'>;
```

`PreviewResult` 的 `ok` 分支加 `printer: PrinterChoice;`。`JobRecord` 加 `/** 这一张的纸张键（例如 100x180）；1.0.x 的旧记录没有。 */ paper?: string;`。

- [ ] **Step 4：实现 `print-service.ts`**：`PrintServiceDeps` 加

```ts
  /** 这个模板用哪台打印机（模板指定 → 纸张分配，见 printing/resolve-printer.ts）；每次打印都重新决定。 */
  choosePrinter: (template: LabelTemplate) => Promise<PrinterChoice>;
```

`preview()`：`const template = this.deps.resolveTemplate(scan);` 后 `printer: await this.deps.choosePrinter(template)` 放进返回值。

`submit()`：识别之后、占防重复窗口之前：

```ts
    const template = this.deps.resolveTemplate(recognition.scan);
    const choice = await this.deps.choosePrinter(template);
    if (choice.printerName === null) {
      return { status: 'no-printer', paperKey: choice.paperKey };
    }
    const printerName = choice.printerName;
    const paper = paperKey(template.paper);
```

后面 `request.printerName` 全部换成 `printerName`；`finish(id, request, raw, result, scan)` 改为 `finish(id, request, printerName, paper, raw, result, scan)`，写记录时带上 `printerName` 和 `paper`。识别失败的记录（`invalid`）没有模板可用：`printerName` 记 `''`、`paper` 不写（和现在「记录里的打印机」一样只用于显示）。

`createJob(scan)` 改为 `createJob(scan, template)`，不再重复调用 `resolveTemplate`，保证打印用的模板和决定打印机用的是同一个。

`printTest(printerName)` 不变：测试页是对指定打印机打的，不走分配。

- [ ] **Step 5：运行 `bun test src/core`**，确认通过（原有用例补上 `choosePrinter`，去掉请求里的 `printerName`）

### Task 3.4：打印记录加纸张列

**Files:**
- Modify: `src/main/storage/migrations.ts`（末尾追加第 2 条）
- Modify: `src/main/storage/sqlite-job-store.ts:9-11,38-40,71-80,149-162`
- Test: `src/main/storage/sqlite-job-store.test.ts`、`src/main/storage/migrations.test.ts`（没有就新建）

- [ ] **Step 1：写失败的测试**

```ts
test('keeps the paper of each job and leaves it empty for 1.0.x jobs', () => {
  const store = createStore();
  store.append({ ...JOB, id: 'a', paper: '100x180' });
  store.append({ ...JOB, id: 'b' });
  const { jobs } = store.list({ limit: 10 });
  expect(jobs.find((job) => job.id === 'a')?.paper).toBe('100x180');
  expect(jobs.find((job) => job.id === 'b')?.paper).toBeUndefined();
});
```

迁移测试：用 `storage/testing/temp-dir.ts` 建一个只跑第 1 条迁移的库，插一条旧记录，再打开（跑全部迁移），旧记录还在，`paper` 为 NULL。

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**：`MIGRATIONS` 末尾追加（1.0.1 发布后第一次改表结构，已发布的第 1 条不动）：

```ts
  // 2：打印记录记下纸张（多台打印机、多种纸张）；1.0.x 的旧记录为 NULL。
  `
  ALTER TABLE jobs ADD COLUMN paper TEXT;
  `,
```

`JOB_COLUMNS` 加 `, jobs.paper`；插入语句加 `paper` 列和 `:paper` 参数（`job.paper ?? null`）；`toJobRecord` 里 `if (row['paper'] !== null) { job.paper = readString(row, 'paper'); }`。

- [ ] **Step 4：运行，确认通过**

### Task 3.5：打印结果通知带纸张

**Files:**
- Modify: `src/core/notify/webhook-event.ts:12-26,41-55`
- Test: `src/core/notify/webhook-event.test.ts`

- [ ] **Step 1：写失败的测试**：`payloadOf({ ...job, paper: '100x180' }, scan, station).paper` 为 `'100x180'`，没有纸张的旧记录为 `null`。
- [ ] **Step 2：失败** → **Step 3：实现**：`WebhookPayload` 加 `/** 纸张键（例如 100x180）；旧记录为 null。新增字段，不影响已有的接收方。 */ paper: string | null;`，`payloadOf` 里 `paper: job.paper ?? null`。
- [ ] **Step 4：通过**

### Task 3.6：主进程接线、IPC 和界面调用

**Files:**
- Modify: `src/main/index.ts`（`choosePrinter`、状态检测多台）
- Modify: `src/main/ipc.ts:141-155`、`src/shared/ipc-contract.ts:119-129`、`src/preload/index.ts:17-22`
- Modify: `src/renderer/src/view-models/use-scan-station.ts`、`src/renderer/src/App.tsx`

- [ ] **Step 1：`index.ts` 创建 `PrintService` 时**

```ts
    choosePrinter: async (template) => {
      const installed = (await adapter.listPrinters()).map((printer) => printer.name);
      return resolvePrinter(template, settings.current.paperPrinters, installed);
    },
```

（`adapter.listPrinters` 每次都会问系统；打印时用 `ElectronDriverAdapter` 里现有的 5 秒缓存：给适配器加一个公开的 `knownPrinterNames()`，内部走 `knownPrinters()`，这里调它。）

- [ ] **Step 2：状态检测多台**：`PrinterStatusMonitor.watch(printerName: string | null)` 现在一次只盯一台（`printer-status.ts:83`，字段 `watched: string | null`）。先在 `printer-status.test.ts` 写失败的用例「`watchAll(['A','B'])` 后两台都被查询，B 缺纸时 `onNotReady('B', …)`」，再把它改为 `watchAll(names: readonly string[])`：`watched` 换成 `string[]`，`poll()` 逐台查询，每台的结果只在它仍被盯着时写入；删掉 `watch`。`index.ts` 里：

```ts
  const watchedPrinters = () => [
    ...new Set([
      ...Object.values(settings.current.paperPrinters),
      ...templateCatalog.list().flatMap((template) => (template.printer ? [template.printer] : [])),
    ]),
  ];
  void status.watchAll(watchedPrinters());
```

设置变化（`paperPrinters`）和模板保存后都重新 `watchAll`。

- [ ] **Step 3：IPC**：`print(raw, options)`（去掉 `printerName` 参数）；`ipc.ts` 的 `IpcChannel.Print` 处理函数只收 `raw` 和 `options`；preload 同步。`checkDriverPaper(printerName)` 改为 `checkDriverPaper(printerName, paperKey)`，主进程里 `checkDriverPaper(await profiles.get(name), parsePaperKey(paperKey) ?? DEFAULT_PAPER)`，并在读之前 `profiles.forget(name)`（界面上的检查总是取最新）。

- [ ] **Step 4：界面**：`use-scan-station.ts` 删掉 `printerName` 选项和「没选打印机就提醒」那段（主进程返回 `no-printer`，播报沿用 `announce({ kind: 'result', result, … })`，`printResultCue` 已经把 `no-printer` 映射到 `noPrinter`）；`window.api.print(raw, { source, force })`；`willPrint` 去掉 `printerName !== null`。`App.tsx` 暂时把 `printerName` 取成「60×40 分配到的打印机」（`settings.paperPrinters['60x40'] ?? null`）让界面先编译通过，阶段 4 再换成真正的汇总。

- [ ] **Step 5：`status-text.ts` 处理 `no-printer`**：先在 `status-text.test.ts` 加失败的用例：

```ts
test('tells which paper has no printer', () => {
  expect(describeResult({ status: 'no-printer', paperKey: '100x180' }, NOW)).toEqual({
    tone: 'warning',
    title: '没有可用的打印机',
    detail: '100×180 二联面单 还没有打印机：在右侧「打印机」里为这种纸指定一台',
  });
});
```

`describeResult` 的 switch 加（打印机面板在工作台右侧，不是配置中心的页面，所以不带 `link`）：

```ts
    case 'no-printer':
      return {
        tone: 'warning',
        title: VOICE_CUE_TEXT.noPrinter,
        detail: `${formatPaperName(parsePaperKey(result.paperKey) ?? DEFAULT_PAPER)} 还没有打印机：在右侧「打印机」里为这种纸指定一台`,
      };
```

同时把 `src/shared/voice.ts` 的 `noPrinter` 文字从「请先选择打印机」改为「没有可用的打印机」（已经没有「选择打印机」这个操作了；播报和状态栏同一句，`voice.test.ts` 跟着改）。

### Task 3.7：手机扫码跟上

**Files:**
- Modify: `src/main/mobile/mobile-host.ts:32-36,315-333`
- Modify: `src/main/mobile/mobile-station.ts:30-40,95-150`
- Test: `src/main/mobile/mobile-host.test.ts`、`mobile-station.test.ts`

- [ ] **Step 1：写失败的测试**：手机提交任务、`submit` 返回 `no-printer` 时，手机收到 `{ status: 'no-printer' }`；手机加入时收到的打印机文字是汇总（假的 `printerSummary` 返回「打印机 2 台就绪」）。

- [ ] **Step 2：实现**：`MobileHostDeps.print` 改为 `(raw: string, force: boolean) => Promise<PhonePrintResult>`；`selectedPrinter` 换成 `printerSummary: () => Promise<string | null>`；`mobile-host.ts` 的 `print()` 直接调 `this.deps.print(raw, force)`（`no-printer` 由 `toPhonePrintResult` 换算：它已经支持 `status: 'no-printer'`，入参类型跟着 `PrintResult` 变即可）；`printerLabel()` 调 `printerSummary()`。`mobile-station.ts` 删掉 `selectedPrinter()`，`StationSettings` 改为 `Pick<AppSettings, 'mobileRelayUrl' | 'paperPrinters'>`，`paperPrinters` 变化时 `printerChanged()`；`printerSummary` 由 `index.ts` 注入（阶段 4 的 `describePrintersSummary`，这里先返回「已分配的打印机数」：`${n} 台打印机`，没有时 null）。

- [ ] **Step 3：E2E 辅助函数改用纸张分配**：全仓库 `grep -rn "selectedPrinter" e2e src`，每一处 `updateSettings({ selectedPrinter: X, … })` 改为 `updateSettings({ paperPrinters: { '60x40': X }, … })`（`e2e/app.e2e.ts:20`、`e2e/mobile.e2e.ts:26`、`e2e/visual/acceptance.visual.ts:139,835` 等）。

- [ ] **Step 4：`bun run check` 和 `bun run test:e2e` 全部通过**

- [ ] **Step 5：提交（阶段 3 一起）**

```bash
git add src e2e
git commit -m "feat(printing): choose the printer from the template's paper or its own printer"
```

提交说明正文写清：界面不再传打印机名，主进程按模板决定；没有打印机时返回 no-printer、不写记录；设置从 selectedPrinter 迁移；jobs 表追加 paper 列（1.0.1 发布后第一次追加迁移）；手机协议不变。

---

## 阶段 4：界面

**目标**：打印机页能按纸张分配打印机并给出建议；模板能选纸张和打印机；预览按纸张；标题栏显示汇总。
**成功标准**：E2E 新用例通过；新增视觉验收项自动检查全过；原有 V01–V35 重截无问题。
**状态**：Not Started

### Task 4.1：纯逻辑：分配表、建议、汇总

**Files:**
- Create: `src/renderer/src/lib/printer-assignment.ts`
- Test: `src/renderer/src/lib/printer-assignment.test.ts`

- [ ] **Step 1：写失败的测试**

```ts
import { describe, expect, test } from 'bun:test';
import { describePrintersSummary, paperRows, responsibilitiesOf } from './printer-assignment';

const TEMPLATES = [
  { name: '样衣标准', paper: { widthMm: 60, heightMm: 40 }, printer: null },
  { name: '申通面单', paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' },
  { name: '极兔面单', paper: { widthMm: 100, heightMm: 180 }, printer: null },
];
const DRIVER_PAPER = {
  标签机A: { widthMm: 60, heightMm: 40, dpi: 203 },
  面单机C: { widthMm: 100, heightMm: 180, dpi: 203 },
};

describe('paperRows', () => {
  test('lists every paper the templates use, with its printer or a suggestion', () => {
    expect(paperRows(TEMPLATES, { '60x40': '标签机A' }, DRIVER_PAPER)).toEqual([
      { key: '60x40', name: '60×40 标签', printer: '标签机A', suggestion: null },
      { key: '100x180', name: '100×180 二联面单', printer: null, suggestion: '面单机C' },
    ]);
  });

  test('does not suggest a printer already assigned elsewhere for the same paper', () => {
    const rows = paperRows(TEMPLATES, { '60x40': '标签机A', '100x180': '面单机C' }, DRIVER_PAPER);
    expect(rows.map((row) => row.suggestion)).toEqual([null, null]);
  });
});

describe('responsibilitiesOf', () => {
  test('says which papers and templates a printer handles', () => {
    expect(responsibilitiesOf('面单机B', TEMPLATES, { '60x40': '标签机A' })).toEqual({
      papers: [],
      templates: ['申通面单'],
    });
    expect(responsibilitiesOf('标签机A', TEMPLATES, { '60x40': '标签机A' })).toEqual({
      papers: ['60×40 标签'],
      templates: [],
    });
  });
});

describe('describePrintersSummary', () => {
  test('counts ready printers', () => {
    expect(
      describePrintersSummary([
        { name: '标签机A', readiness: { ready: true } },
        { name: '面单机B', readiness: { ready: true } },
      ]),
    ).toEqual({ tone: 'ready', text: '打印机 2 台就绪' });
  });

  test('names the first printer with a problem', () => {
    expect(
      describePrintersSummary([
        { name: '标签机A', readiness: { ready: true } },
        { name: '面单机B', readiness: { ready: false, detail: '缺纸', issue: 'paperOut' } },
      ]),
    ).toEqual({ tone: 'error', text: '面单机B（缺纸）' });
  });

  // macOS 上状态按「未知」处理：只说台数，不说就绪。
  test('does not claim ready when the status is unknown', () => {
    expect(describePrintersSummary([{ name: '标签机A', readiness: null }])).toEqual({
      tone: 'unknown',
      text: '打印机 1 台',
    });
  });

  test('says when no printer is assigned', () => {
    expect(describePrintersSummary([])).toEqual({ tone: 'muted', text: '还没有分配打印机' });
  });
});
```

- [ ] **Step 2：失败** → **Step 3：实现**

```ts
import type { DriverPaper } from '../../../shared/driver-paper';
import { formatPaperName, isSamePaper, type PaperSize, paperKey } from '../../../shared/paper-sizes';
import type { PrinterReadiness } from '../../../shared/printer-readiness';
import type { PrinterChipView } from './printer-chip';

interface TemplateUse {
  name: string;
  paper: PaperSize;
  printer: string | null;
}

export interface PaperRow {
  key: string;
  name: string;
  /** 分配到的打印机；没分配时为 null。 */
  printer: string | null;
  /** 没分配、而某台打印机的驱动纸张正好是这个尺寸时，建议它（只建议，不自动分配：驱动纸张可能只是出厂默认值）。 */
  suggestion: string | null;
}

/** 打印机页顶部的「纸张 → 打印机」表：模板里用到的每种纸一行，按第一次出现的顺序。 */
export function paperRows(
  templates: readonly TemplateUse[],
  paperPrinters: Readonly<Record<string, string>>,
  driverPaper: Readonly<Record<string, DriverPaper | null>>,
): PaperRow[] {
  const seen = new Map<string, PaperSize>();
  for (const template of templates) {
    const key = paperKey(template.paper);
    if (!seen.has(key)) {
      seen.set(key, template.paper);
    }
  }
  const assigned = new Set(Object.values(paperPrinters));
  return [...seen].map(([key, paper]) => {
    const printer = paperPrinters[key] ?? null;
    const suggestion =
      printer === null
        ? (Object.entries(driverPaper).find(
            ([name, driver]) => driver !== null && !assigned.has(name) && isSamePaper(driver, paper),
          )?.[0] ?? null)
        : null;
    return { key, name: formatPaperName(paper), printer, suggestion };
  });
}

/** 一台打印机负责哪些纸张（纸张分配）和哪些模板（模板指定了它）。 */
export function responsibilitiesOf(
  printerName: string,
  templates: readonly TemplateUse[],
  paperPrinters: Readonly<Record<string, string>>,
): { papers: string[]; templates: string[] } {
  const papers = Object.entries(paperPrinters)
    .filter(([, name]) => name === printerName)
    .map(([key]) => {
      const template = templates.find((item) => paperKey(item.paper) === key);
      return template ? formatPaperName(template.paper) : key;
    });
  return { papers, templates: templates.filter((item) => item.printer === printerName).map((item) => item.name) };
}

/** 标题栏的打印机胶囊：都就绪时说几台，有问题时说出第一台的问题（写法和单台时的 describePrinterChip 一致）。 */
export function describePrintersSummary(
  printers: readonly { name: string; readiness: PrinterReadiness | null }[],
): PrinterChipView {
  if (printers.length === 0) {
    return { tone: 'muted', text: '还没有分配打印机' };
  }
  for (const { name, readiness } of printers) {
    if (readiness !== null && !readiness.ready) {
      return { tone: 'error', text: `${name}（${readiness.detail}）` };
    }
  }
  const isKnown = printers.every((printer) => printer.readiness !== null);
  return { tone: isKnown ? 'ready' : 'unknown', text: `打印机 ${printers.length} 台${isKnown ? '就绪' : ''}` };
}
```

`paperRows` 里「没分配的纸标红」由组件按 `printer === null` 决定。

- [ ] **Step 4：通过** → **Step 5：提交** `feat(ui): paper assignment rows, suggestions and printer summary`

### Task 4.2：打印机页

**Files:**
- Modify: `src/renderer/src/components/PrinterList.tsx`（改写）
- Modify: `src/renderer/src/App.tsx:236-262`（传入模板、分配、各打印机的驱动纸张和状态）
- Create: `src/renderer/src/view-models/use-printer-profiles.ts`（逐台读驱动纸张和状态）
- Modify: `src/renderer/src/styles/app.css`（沿用现有变量）

- [ ] **Step 1：`use-printer-profiles.ts`**：对 `printers.printers` 逐台调 `window.api.checkDriverPaper(name, paperKey)`（用这台负责的第一种纸，没有就 `60x40`）和 `window.api.printerStatus(name)`，返回 `Record<string, { paper: DriverPaper | null; readiness: PrinterReadiness | null }>`；打印机列表或分配变化时重读。沿用 `use-driver-paper.ts`、`use-printer-status.ts` 的写法（取消过期请求、出错走 `reportError`），然后删掉这两个旧 hook。

- [ ] **Step 2：改写 `PrinterList.tsx`**：结构

```tsx
<div className="panel-body">
  <section className="paper-assignments" aria-label="纸张和打印机">
    <h3 className="paper-assignments__title">纸张 → 打印机</h3>
    <ul>
      {rows.map((row) => (
        <li key={row.key} className={`paper-row${row.printer === null ? ' paper-row--missing' : ''}`}>
          <span className="paper-row__name">{row.name}</span>
          <select
            className="select-field select-field--fill"
            aria-label={`${row.name} 用哪台打印机`}
            value={row.printer ?? ''}
            onChange={(event) => onAssign(row.key, event.target.value || null)}
          >
            <option value="">还没有打印机</option>
            {printers.map((printer) => (
              <option key={printer.name} value={printer.name}>{printer.displayName}</option>
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
  {/* 下面是原来的搜索框和打印机列表：每行加「驱动纸张 100×180」「负责：…」、状态点；去掉「点选 = 选中」 */}
</div>
```

`onAssign(key, printer)` 在 `App.tsx` 里：`update({ paperPrinters: withAssignment(settings.paperPrinters, key, printer) })`（`printer === null` 时删掉这个键；这个小函数放进 `lib/printer-assignment.ts` 并补一条测试）。纸张提醒（驱动纸张和它负责的纸对不上）沿用 `describePaperCheck` 和「打开打印首选项」按钮，显示在那一台的行里。

- [ ] **Step 3：E2E**（`e2e/app.e2e.ts` 新增）：两台假打印机（沿用 `stubPrinting` 的假打印机列表写法）、一个自定义模板改成 100×180；在打印机页把 100×180 分给第二台；扫一个用这个模板的码，假打印记录里是第二台；打印记录显示「100×180」。

- [ ] **Step 4：`bun run check`、`bun run test:e2e` 通过；提交** `feat(ui): assign printers per paper on the printers panel`

### Task 4.3：模板编辑器的纸张和打印机

**Files:**
- Modify: `src/renderer/src/components/TemplateEditor.tsx:81-130`
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx`（列表每行显示纸张和实际打印机）

- [ ] **Step 1**：「基本」区在「模板名称」后加两项（沿用文件里现有的表单组件，下面是结构）：

```tsx
<label className="form-row">
  <span className="form-row__label">纸张尺寸</span>
  <select
    className="select-field select-field--fill"
    value={findPreset(draft.paper) ? paperKey(draft.paper) : 'custom'}
    onChange={(event) => {
      const preset = PAPER_PRESETS.find((item) => paperKey(item) === event.target.value);
      const paper = preset ? { widthMm: preset.widthMm, heightMm: preset.heightMm } : draft.paper;
      onChange({ ...draft, paper, qr: { ...draft.qr, sizeMm: Math.min(draft.qr.sizeMm, maxQrSizeMm(paper, draft.paddingMm)) } });
    }}
  >
    {PAPER_PRESETS.map((preset) => (
      <option key={paperKey(preset)} value={paperKey(preset)}>{`${preset.name}（${preset.usage}）`}</option>
    ))}
    <option value="custom">自定义…</option>
  </select>
</label>
{/* 选「自定义」时显示宽、高两个数字框（mm），范围 PAPER_LIMITS_MM；改完同样夹二维码边长 */}
<label className="form-row">
  <span className="form-row__label">打印机</span>
  <select
    className="select-field select-field--fill"
    value={draft.printer ?? ''}
    onChange={(event) => onChange({ ...draft, printer: event.target.value || null })}
  >
    <option value="">{`按纸张分配（当前是 ${assignedPrinter ?? '还没有'}）`}</option>
    {printers.map((printer) => (
      <option key={printer.name} value={printer.name}>{printer.displayName}</option>
    ))}
  </select>
</label>
```

`printers`、`assignedPrinter`（这张纸分配到的打印机）由模板页传入。

- [ ] **Step 2**：E2E：复制内置模板 → 纸张选「100×100 标签」→ 预览的软尺刻度到 100 → 保存后列表这行显示「100×100 标签 · 按纸张分配」。

- [ ] **Step 3：通过；提交** `feat(ui): choose the paper and printer of a template`

### Task 4.4：预览按纸张、工具条显示打印机、标题栏汇总

**Files:**
- Modify: `src/shared/ipc-contract.ts:85-97`（`LabelPreview` 加 `paper: PaperSize`）
- Modify: `src/main/ipc.ts:120-140`（`renderPreview` 填 `paper`，用打印机的分辨率渲染 HTML）
- Modify: `src/renderer/src/components/LabelPreview.tsx`（`paper` 参数代替 `LABEL_PAPER_MM`）
- Modify: `src/renderer/src/components/PreviewStage.tsx:54`
- Modify: `src/renderer/src/components/workbench/PreviewToolbar.tsx`（「打印机：xxx」）
- Modify: `src/renderer/src/lib/printer-chip.ts`、`App.tsx`（标题栏用 `describePrintersSummary`）
- Delete: `src/shared/label-paper.ts` 里的 `LABEL_PAPER_MM`（这时已经没有用处）

- [ ] **Step 1**：`LabelPreview` 的 props 加 `paper: PaperSize`：

```tsx
  const scale = useFitScale(benchRef, paper.widthMm + RULER_DEPTH_MM, paper.heightMm + RULER_DEPTH_MM, maxScale);
  // …
        <Ruler orientation="horizontal" lengthMm={paper.widthMm} />
        <Ruler orientation="vertical" lengthMm={paper.heightMm} />
```

`PreviewStage.tsx` 的占位文字改为 `扫码后在这里预览 ${formatPaperName(paper)}`（没有扫码时用当前模板的纸张）。

- [ ] **Step 2**：工具条右侧在「规则 · 模板」后加 `· 打印机：${name}`；`reason === 'template-missing'` 时写「打印机：${name}（模板指定的 ${missingPrinter} 不在这台电脑上）」；`unassigned` 时写「打印机：还没有」。文字规则写进 `lib/`（沿用 `preview-usage.ts` 的写法）并补测试。

- [ ] **Step 3**：`grep -rn "LABEL_PAPER_MM" src e2e` 为空后删掉这个常量。

- [ ] **Step 4**：`bun run check`、`bun run test:e2e` 通过；**提交** `feat(ui): preview on the template's paper and show where it prints`

### Task 4.5：视觉验收新增三项

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`（新增 V36–V38）
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md` §8.2（表里加三行）

- [ ] **Step 1**：新增：
  - **V36 打印机页 · 纸张分配**：三台假打印机、两种纸张（一种已分配、一种未分配带建议）；截图检查分配表、未分配的提示、建议按钮、每台打印机的驱动纸张和「负责」。
  - **V37 模板编辑器 · 纸张和打印机**：纸张下拉框展开、自定义尺寸两个数字框、打印机下拉框。
  - **V38 非 60×40 的预览**：50×30、100×100 两张（软尺刻度、二维码和字号是否放得下）。
- [ ] **Step 2**：`bunx playwright test --config e2e/visual/playwright.config.ts` 全过（原有各项重截无问题）。
- [ ] **Step 3：提交** `test(visual): cover printer assignment, paper choice and other paper sizes`

---

## 阶段 5：验收与文档

**目标**：真机验证、文档跟上。
**状态**：Not Started

- [ ] **Step 1：真机（Windows）**：两台打印机（至少一台真的热敏标签机）按纸张分配各打一张；模板指定打印机优先；拔掉一台时状态胶囊和系统通知正确；在打印首选项里改驱动纸张后打印机页的建议和提醒更新。结果写进 `docs/windows-acceptance.md`（新编号）。
- [ ] **Step 2：真机（macOS）**：同样各打一张，`lpstat -W completed -l` 或 CUPS 网页查看任务纸张是不是模板尺寸；结果写进 `docs/roadmap.md` 的 macOS 一行。
- [ ] **Step 3：文档**：
  - `README.md`：功能里「打印机」一段改为多台打印机、按纸张分配；扫码枪设置不变。
  - `CLAUDE.md`（根目录）：「项目」一段的「60×40mm 标签」改为「按模板纸张（默认 60×40mm）」；「文档」表加本设计。
  - `src/main/CLAUDE.md`：打印一节加 `printer-profiles.ts`；`src/core/CLAUDE.md`：模块表加 `printing/resolve-printer.ts`。
  - 路线图：「多台打印机、多种纸张」标为已完成（版本号发版时填）。
- [ ] **Step 4：`bun run check`、`bun run test:e2e`、视觉验收全过；提交** `docs: multiple printers and paper sizes`
- [ ] **Step 5**：PR 合进 master；发版前按项目规定先问用户（版本号建议 1.1.0）。

---

## 自查记录

- **设计覆盖**：纸张预设（1.2）、模板纸张和指定打印机（1.3）、排版按纸张（2.2）、分辨率（2.1、2.3）、页面尺寸（2.4）、分配规则和退回（3.2）、没有打印机不打不记（3.3）、迁移（3.1）、打印记录纸张（3.4）、通知字段（3.5）、多台状态检测（3.6）、手机（3.7）、打印机页和建议（4.1、4.2）、模板编辑器（4.3）、预览软尺和工具条、标题栏汇总（4.4）、视觉验收（4.5）、真机和文档（阶段 5）。设计里「导入导出」一条（程序目前没有这个功能）和「没有打印机」的提示文字已随本计划一起修正。
- **类型一致**：`PaperSize`、`paperKey`、`PrinterChoice`、`resolvePrinter`、`choosePrinter`、`PrinterProfiles.dpiOf`、`paperPrinters` 在各任务里同名同签名。
- **提交粒度**：阶段 3 的 3.1–3.7 改的是同一条调用链（去掉 `selectedPrinter` 后类型检查要等调用方全改完才通过），合成一个提交；其余每个任务单独提交，都能通过 `bun run check`。
