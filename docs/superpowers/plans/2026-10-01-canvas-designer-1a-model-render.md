# 标签设计器 1a：模型与渲染 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第三类模板「自由设计」（`kind: 'canvas'`）：模型、校验、排版、条码（bwip-js）、黑白图片、HTML 渲染，能被规则绑定、经本机接口打印、在模板页预览；编辑器在 1b。

**Architecture:** 和面单同一套路：core 里纯 TypeScript 的模型（`canvas-model.ts`）、校验（`sanitize-canvas.ts`）、排版（`canvas-layout.ts`，取整到打印点、排文字、出「打印前检查」）和黑白图片（`mono-image.ts`）；main 里 `barcode.ts` 用 bwip-js 只编码、自己按打印点画 SVG（面单的条码画法也搬进来，输出不变），`canvas-html.ts` 画绝对定位的 HTML，`renderLabelHtml` 按 `kind` 分派。图片在模板里存的是灰度像素（编辑器在 sandbox 的页面里解码，1b 做），主进程不解码图片文件（Chromium 两条法则）。

**Tech Stack:** TypeScript、Bun test、Electron 主进程、bwip-js（新依赖）、Playwright E2E。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3 节、第 11 节。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本改文件。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`。注释用中文，写为什么。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过 → 提交。提交信息英文 Conventional Commits，末尾带：

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK
```

- 分支：`feature/canvas-designer`（从 `design/feature-parity` 拉出，设计 PR #33 合并后 rebase 到 master）。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/core/templates/sanitize-primitives.ts` | 新建 | 三个校验文件共用的小工具：`asLoose`、`bool`、`clamp`、`pick`、`sanitizeText` |
| `src/core/templates/canvas-model.ts` | 新建 | 自由设计模板的类型、限制、码制清单、元素默认值 |
| `src/core/templates/sanitize-canvas.ts` | 新建 | 不可信输入 → 合法的元素列表 |
| `src/core/templates/canvas-layout.ts` | 新建 | 元素 → 取整到打印点的位置、排好的文字、表格格子、打印前检查 |
| `src/core/templates/mono-image.ts` | 新建 | 灰度像素解码、缩放、阈值 / 抖动转黑白、黑白位图 → SVG 路径 |
| `src/core/templates/builtin-canvas.ts` | 新建 | 内置示例「吊牌（自由设计示例）」 |
| `src/core/templates/template-model.ts` | 修改 | `LabelTemplate` 联合加 `CanvasTemplate`；`withPaper` 处理 canvas |
| `src/core/templates/sanitize-template.ts` | 修改 | 按 `kind: 'canvas'` 分派；改用 `sanitize-primitives` |
| `src/core/templates/sanitize-waybill.ts` | 修改 | 改用 `sanitize-primitives` |
| `src/core/templates/builtin-templates.ts` | 修改 | 内置模板列表加示例 |
| `src/core/api/template-fields.ts` | 修改 | 自由设计模板用到的变量 |
| `src/shared/render-warnings.ts` | 修改 | 加 `issues`（打印前检查的文字） |
| `src/main/printing/barcode.ts` | 新建 | bwip-js 编码、模块宽取整、条码 SVG（一维、二维） |
| `src/main/printing/waybill-html.ts` | 修改 | 条码画法改用 `barcode.ts`（输出不变） |
| `src/main/printing/canvas-html.ts` | 新建 | 自由设计模板 → HTML |
| `src/main/printing/label-html.ts` | 修改 | 分派 canvas；标签结果带 `issues: []` |
| `src/renderer/src/lib/printer-assignment.ts` | 修改 | 没在用的内置自由设计模板也算「可选」 |
| `src/renderer/src/components/config/pages/TemplatesPage.tsx` | 修改 | canvas 草稿：只编辑名称、纸张、打印机，说明设计器随后提供 |
| `e2e/app.e2e.ts`、`e2e/local-api.e2e.ts`、`e2e/visual/acceptance.visual.ts` | 修改 | 预览、经本机接口打印、视觉验收 V44 |
| `docs/local-api.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、spec | 修改 | 文档 |

---

### Task 1: 加入 bwip-js

**Files:**
- Modify: `package.json`（`dependencies`）

- [ ] **Step 1: 安装**

Run: `bun add bwip-js`
Expected: `package.json` 的 `dependencies` 多一行 `"bwip-js": "^4.x.x"`，`bun.lock` 更新。

- [ ] **Step 2: 确认类型和导出**

Read `node_modules/bwip-js/package.json` 的 `exports`、`types` 字段，和对应 `.d.ts` 里 `raw` 的签名。后面 Task 7 按 `import bwipjs from 'bwip-js'` + `bwipjs.raw({ bcid, text })` 写；如果 `.d.ts` 里 `raw` 的返回类型不是 `unknown` / 具体类型，Task 7 的 `rawEncode` 包一层窄类型（代码已写好，不用改）。

- [ ] **Step 3: bundle 自包含检查**

Run: `bun run build && bun run verify:bundle`
Expected: 通过（主进程 bundle 里只引用 Electron 内置模块和两个可选模块）。这一步在 Task 7 用上 bwip-js 之后再跑一次。

- [ ] **Step 4: 提交**

```bash
git add package.json bun.lock
git commit -m "build(deps): add bwip-js for barcode encoding" -m "The canvas designer needs EAN, UPC, Code 39, ITF-14, Data Matrix, PDF417 and more. bwip-js only encodes here; bars are drawn on printer dots by our own renderer." -m "<trailer>"
```

---

### Task 2: 校验小工具抽成一个模块

**Files:**
- Create: `src/core/templates/sanitize-primitives.ts`
- Create: `src/core/templates/sanitize-primitives.test.ts`
- Modify: `src/core/templates/sanitize-template.ts`（删掉文件末尾的 `asLoose`、`bool`、`clamp`、`pick`、`CONTROL_CHARACTERS`、`sanitizeText`，改为 import）
- Modify: `src/core/templates/sanitize-waybill.ts`（同上）

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/sanitize-primitives.test.ts
import { describe, expect, test } from 'bun:test';
import { asLoose, bool, clamp, pick, sanitizeText } from './sanitize-primitives';

describe('sanitize primitives', () => {
  test('asLoose accepts only plain objects', () => {
    expect(asLoose({ a: 1 })).toEqual({ a: 1 });
    expect(asLoose([1])).toEqual({});
    expect(asLoose(null)).toEqual({});
    expect(asLoose('x')).toEqual({});
  });

  test('bool falls back on anything that is not a boolean', () => {
    expect(bool(true, false)).toBe(true);
    expect(bool('true', false)).toBe(false);
  });

  test('clamp keeps finite numbers in range and falls back on the rest', () => {
    expect(clamp(5, 0, 3, 1)).toBe(3);
    expect(clamp(-1, 0, 3, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 3, 1)).toBe(1);
    expect(clamp('2', 0, 3, 1)).toBe(1);
  });

  test('pick only accepts listed values', () => {
    expect(pick('b', ['a', 'b'] as const, 'a')).toBe('b');
    expect(pick('c', ['a', 'b'] as const, 'a')).toBe('a');
  });

  test('sanitizeText strips control characters, keeps line breaks and truncates', () => {
    expect(sanitizeText('a\u0007b\nc', 10, '')).toBe('ab\nc');
    expect(sanitizeText('abcdef', 3, '')).toBe('abc');
    expect(sanitizeText(3, 3, 'x')).toBe('x');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/sanitize-primitives.test.ts`
Expected: FAIL，`Cannot find module './sanitize-primitives'`。

- [ ] **Step 3: 实现**

```ts
// src/core/templates/sanitize-primitives.ts
/** 模板校验共用的小工具：输入一律不可信，类型不对就取 fallback，数值夹到范围内。 */

export type Loose = Record<string, unknown>;

/** 只接受普通对象；数组、null、其他类型当作空对象，后面每一项都会取默认值。 */
export function asLoose(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

export function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（保留换行）
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** 去掉控制字符（保留换行，文字可以多行）并截断长度。 */
export function sanitizeText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.replace(CONTROL_CHARACTERS, '').slice(0, maxLength);
}
```

`pick` 的泛型放宽到 `string | number`：画布的旋转角度是数字（0 / 90 / 180 / 270）。

- [ ] **Step 4: 两个旧文件改用它**

在 `sanitize-template.ts` 和 `sanitize-waybill.ts` 里删掉各自的 `type Loose`、`asLoose`、`bool`、`clamp`、`pick`、`CONTROL_CHARACTERS`、`sanitizeText` 定义（两份内容和上面一致），文件头加：

```ts
import { asLoose, bool, clamp, type Loose, pick, sanitizeText } from './sanitize-primitives';
```

（`sanitize-waybill.ts` 里只 import 它用到的那几个；Biome 会指出没用到的。）

- [ ] **Step 5: 全部模板测试通过**

Run: `bun test src/core/templates`
Expected: PASS（行为不变）。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/templates/sanitize-primitives.ts src/core/templates/sanitize-primitives.test.ts src/core/templates/sanitize-template.ts src/core/templates/sanitize-waybill.ts
git commit -m "refactor(templates): share the sanitize primitives" -m "The label and waybill sanitizers each carried a copy of the same helpers, and the canvas sanitizer needs them too." -m "<trailer>"
```

---

### Task 3: 渲染提示加「打印前检查」文字

**Files:**
- Modify: `src/shared/render-warnings.ts`
- Modify: `src/shared/render-warnings.test.ts`
- Modify: `src/main/printing/label-html.ts:55-58`（标签结果带 `issues: []`）
- Modify: `src/main/printing/waybill-html.ts`（返回值带 `issues: []`）
- Modify: `e2e/app.e2e.ts:603`

- [ ] **Step 1: 写测试**（在 `render-warnings.test.ts` 末尾的 describe 里加）

```ts
  test('lists the checks of a canvas template after the other warnings', () => {
    expect(
      renderWarningTexts({ ...NO_RENDER_WARNINGS, overflowCells: 1, issues: ['条码「商品码」：位数不对'] }),
    ).toEqual(['有 1 格内容放不下，已截断：加大这一格或调小字号', '条码「商品码」：位数不对']);
  });
```

并把文件里已有的 `renderWarningTexts({ qrOmitted: true, barcodeOmitted: true, overflowCells: 2 })` 改成 `renderWarningTexts({ qrOmitted: true, barcodeOmitted: true, overflowCells: 2, issues: [] })`。确认文件顶部 import 了 `NO_RENDER_WARNINGS`。

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/render-warnings.test.ts`
Expected: FAIL（类型错误 / 多出的文字没有列出）。

- [ ] **Step 3: 实现**

`src/shared/render-warnings.ts`：

```ts
export interface RenderWarnings {
  /** 内容太长、容错降到 L 仍然放不下能扫的二维码：这张不印二维码。 */
  qrOmitted: boolean;
  /** 面单：条码太长放不下、或内容不能编码（例如有中文），这张不印条码。 */
  barcodeOmitted: boolean;
  /** 面单：缩到最小字号仍放不下、被截断的格子数。 */
  overflowCells: number;
  /** 自由设计模板的打印前检查：每条写清楚是哪个元素、怎么了。标签和面单是空的。 */
  issues: readonly string[];
}

export const NO_RENDER_WARNINGS: RenderWarnings = {
  qrOmitted: false,
  barcodeOmitted: false,
  overflowCells: 0,
  issues: [],
};
```

`renderWarningTexts` 的 `return texts;` 前加一行：

```ts
  texts.push(...warnings.issues);
```

`label-html.ts` 的 `renderLabelHtml` 里 label 分支：

```ts
  return { ...renderQrLabel({ ...job, template }, dpi), barcodeOmitted: false, overflowCells: 0, issues: [] };
```

`waybill-html.ts` 的返回值对象加 `issues: [],`。`e2e/app.e2e.ts` 第 603 行的期望改成 `{ qrOmitted: false, barcodeOmitted: false, overflowCells: 0, issues: [] }`。

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/shared src/main/printing`
Expected: PASS（快照不变：`issues` 不进 HTML）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/render-warnings.ts src/shared/render-warnings.test.ts src/main/printing/label-html.ts src/main/printing/waybill-html.ts e2e/app.e2e.ts
git commit -m "feat(print): carry plain-language issues in render warnings" -m "Canvas templates report checks per element (a barcode whose content does not fit its symbology, an element too close to the paper edge); labels and waybills report none." -m "<trailer>"
```

---

### Task 4: 自由设计模板的模型

**Files:**
- Create: `src/core/templates/canvas-model.ts`
- Create: `src/core/templates/canvas-model.test.ts`
- Modify: `src/core/templates/template-model.ts`（联合类型、`withPaper`）

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/canvas-model.test.ts
import { describe, expect, test } from 'bun:test';
import { BARCODE_TYPES, barcodeType, CANVAS_ELEMENT_KINDS, newCanvasElement } from './canvas-model';

describe('canvas model', () => {
  test('lists the ten common barcode types first', () => {
    expect(BARCODE_TYPES.filter((type) => type.common).map((type) => type.id)).toEqual([
      'code128',
      'ean13',
      'ean8',
      'upca',
      'upce',
      'code39',
      'code93',
      'itf14',
      'rationalizedCodabar',
      'gs1-128',
    ]);
  });

  test('has unique barcode ids and knows 1D from 2D', () => {
    const ids = BARCODE_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(barcodeType('datamatrix')?.dimensions).toBe(2);
    expect(barcodeType('ean13')?.dimensions).toBe(1);
    expect(barcodeType('nope')).toBeNull();
  });

  test('creates every element kind with a size that fits a 60x40 label', () => {
    for (const kind of CANVAS_ELEMENT_KINDS) {
      const element = newCanvasElement(kind, 'e1', { widthMm: 60, heightMm: 40 });
      expect(element.kind).toBe(kind);
      expect(element.x + element.width).toBeLessThanOrEqual(60);
      expect(element.y + element.height).toBeLessThanOrEqual(40);
    }
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/canvas-model.test.ts`
Expected: FAIL，`Cannot find module './canvas-model'`。

- [ ] **Step 3: 实现 `canvas-model.ts`**

```ts
// src/core/templates/canvas-model.ts
import type { PaperSize } from '../../shared/paper-sizes';
import type { QrErrorLevel, TemplateBase, TextAlign } from './template-model';
import type { VerticalAlign } from './waybill-model';

/**
 * 自由设计模板：画布上一组绝对定位的元素（毫米），用于吊牌、价签、商品条码这类「设计一次、填数据打印」的标签。
 * 和标签模板（字段数不定）、面单模板（格子拼满）并列。设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 3 节。
 */

export const CANVAS_ELEMENT_KINDS = ['text', 'barcode', 'qr', 'image', 'line', 'rect', 'table'] as const;
export type CanvasElementKind = (typeof CANVAS_ELEMENT_KINDS)[number];

/** 只转直角：转任意角度时边缘落不到打印点上，条码会糊。 */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** 文字放不下时：shrink = 先缩小，仍放不下截断；wrap = 按框宽折行，放不下再缩小、截断。 */
export const TEXT_FITS = ['shrink', 'wrap'] as const;
export type TextFit = (typeof TEXT_FITS)[number];

/** 图片转黑白：threshold = 按阈值一刀切（线稿、Logo）；dither = 抖动（照片，用点的疏密表示灰度）。 */
export const IMAGE_MODES = ['threshold', 'dither'] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

/** 所有元素共有的：位置和大小是元素在纸上占的框（转过之后的外框），单位 mm。 */
export interface CanvasElementBase {
  /** 模板内唯一，编辑器用它记住选中的元素。 */
  id: string;
  /** 给人看的名字，打印前检查用它指出是哪个元素。 */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
  /** 锁定后编辑器里不能拖动、缩放（防止误碰）。打印不受影响。 */
  locked: boolean;
}

export interface CanvasText extends CanvasElementBase {
  kind: 'text';
  /** 可以多行，可以有 {字段名} 等变量；一行里的字段全是空的，这一行不印。 */
  text: string;
  fontSizeMm: number;
  bold: boolean;
  align: TextAlign;
  valign: VerticalAlign;
  fit: TextFit;
  /** 反白：黑底白字。 */
  inverse: boolean;
}

export interface CanvasBarcode extends CanvasElementBase {
  kind: 'barcode';
  /** 码制，取 BARCODE_TYPES 里的 id（bwip-js 的 bcid）。 */
  symbology: string;
  /** 条码内容，可以有变量，例如 {商品码}。 */
  value: string;
  /** 一维码下方印号码（二维码不印）。 */
  showText: boolean;
  textSizeMm: number;
}

export interface CanvasQr extends CanvasElementBase {
  kind: 'qr';
  value: string;
  errorCorrection: QrErrorLevel;
}

export interface CanvasImage extends CanvasElementBase {
  kind: 'image';
  /**
   * 8 位灰度像素（0 黑 – 255 白，逐行），base64。编辑器在 sandbox 的页面里把图片文件解码成灰度再存，
   * 主进程只缩放、转黑白，不解码图片文件（不可信输入不进高权限进程里的 C++ 解码器）。
   */
  pixels: string;
  pixelWidth: number;
  pixelHeight: number;
  mode: ImageMode;
  /** 0–255：比它暗的算黑（抖动时作为基准）。 */
  threshold: number;
}

/** 线：就是一个实心的细框，横竖由宽高决定，粗细是较短的那一边。 */
export interface CanvasLine extends CanvasElementBase {
  kind: 'line';
  dashed: boolean;
}

export interface CanvasRect extends CanvasElementBase {
  kind: 'rect';
  /** 边框粗细，0 = 没有边框。 */
  borderMm: number;
  filled: boolean;
  radiusMm: number;
}

export interface CanvasTableCell {
  text: string;
  fontSizeMm: number;
  bold: boolean;
  align: TextAlign;
}

export interface CanvasTable extends CanvasElementBase {
  kind: 'table';
  /** 行高（mm），最后一行占剩下的。 */
  rowsMm: number[];
  /** 列宽（mm），最后一列占剩下的。 */
  columnsMm: number[];
  borderMm: number;
  /** cells[行][列]，行列数和 rowsMm、columnsMm 一致。 */
  cells: CanvasTableCell[][];
}

export type CanvasElement = CanvasText | CanvasBarcode | CanvasQr | CanvasImage | CanvasLine | CanvasRect | CanvasTable;

export interface CanvasTemplate extends TemplateBase {
  kind: 'canvas';
  /** 数组顺序就是上下层：后面的盖在前面的上面。 */
  elements: CanvasElement[];
}

export const CANVAS_LIMITS = {
  /** 一张标签 100 个元素已经很满；再多编辑器难选、排版也慢。 */
  elements: 100,
  nameLength: 20,
  textLength: 500,
  valueLength: 200,
  /** 1.5mm 是热敏纸上还认得出汉字的下限；30mm 够印大号价格。 */
  fontSizeMm: { min: 1.5, max: 30 },
  /** 元素最小 0.25mm：203dpi 上 2 个点，也是线的最小粗细（1 个点的线在热敏纸上时断时续）。 */
  minSizeMm: 0.25,
  tableRows: 20,
  tableColumns: 10,
  borderMm: { min: 0, max: 2 },
  radiusMm: { max: 10 },
  /** 一张图的灰度像素最多 1MB（约 1000×1000）：60×40 的标签在 300dpi 上也只要 709×472。 */
  imageBytes: 1024 * 1024,
  /** 一个模板里所有图片加起来最多 4MB：模板存在数据库里，每次打印都要读。 */
  templateImageBytes: 4 * 1024 * 1024,
  /** 图片边长上限（像素）：防止宽 1、高一百万这种畸形输入。 */
  imageSidePixels: 4000,
  /** 纸边往里这么多是安全区：标签机打到最边上常常打不全。 */
  safeMarginMm: 1.5,
} as const;

export interface BarcodeType {
  /** bwip-js 的 bcid。 */
  id: string;
  label: string;
  dimensions: 1 | 2;
  /** 下拉框前面直接列出的常用码制；其余放在「更多」里。 */
  common: boolean;
}

/** 码制清单：常用的 10 种在前，其余按一维、二维分组。加一种码制只需在这里加一行（bwip-js 支持即可）。 */
export const BARCODE_TYPES: readonly BarcodeType[] = [
  { id: 'code128', label: 'Code 128', dimensions: 1, common: true },
  { id: 'ean13', label: 'EAN-13（商品条码）', dimensions: 1, common: true },
  { id: 'ean8', label: 'EAN-8', dimensions: 1, common: true },
  { id: 'upca', label: 'UPC-A', dimensions: 1, common: true },
  { id: 'upce', label: 'UPC-E', dimensions: 1, common: true },
  { id: 'code39', label: 'Code 39', dimensions: 1, common: true },
  { id: 'code93', label: 'Code 93', dimensions: 1, common: true },
  { id: 'itf14', label: 'ITF-14（箱码）', dimensions: 1, common: true },
  { id: 'rationalizedCodabar', label: '库得巴（Codabar）', dimensions: 1, common: true },
  { id: 'gs1-128', label: 'GS1-128', dimensions: 1, common: true },
  { id: 'interleaved2of5', label: '交叉 25 码', dimensions: 1, common: false },
  { id: 'code39ext', label: 'Code 39 全 ASCII', dimensions: 1, common: false },
  { id: 'code93ext', label: 'Code 93 全 ASCII', dimensions: 1, common: false },
  { id: 'code11', label: 'Code 11', dimensions: 1, common: false },
  { id: 'msi', label: 'MSI', dimensions: 1, common: false },
  { id: 'pharmacode', label: 'Pharmacode', dimensions: 1, common: false },
  { id: 'plessey', label: 'Plessey', dimensions: 1, common: false },
  { id: 'telepen', label: 'Telepen', dimensions: 1, common: false },
  { id: 'isbn', label: 'ISBN', dimensions: 1, common: false },
  { id: 'issn', label: 'ISSN', dimensions: 1, common: false },
  { id: 'ismn', label: 'ISMN', dimensions: 1, common: false },
  { id: 'databaromni', label: 'GS1 DataBar', dimensions: 1, common: false },
  { id: 'databarlimited', label: 'GS1 DataBar Limited', dimensions: 1, common: false },
  { id: 'databarexpanded', label: 'GS1 DataBar Expanded', dimensions: 1, common: false },
  { id: 'postnet', label: 'POSTNET', dimensions: 1, common: false },
  { id: 'onecode', label: 'USPS 智能邮件码', dimensions: 1, common: false },
  { id: 'royalmail', label: 'Royal Mail 四态码', dimensions: 1, common: false },
  { id: 'auspost', label: '澳大利亚邮政码', dimensions: 1, common: false },
  { id: 'japanpost', label: '日本邮政码', dimensions: 1, common: false },
  { id: 'kix', label: 'KIX', dimensions: 1, common: false },
  { id: 'datamatrix', label: 'Data Matrix', dimensions: 2, common: false },
  { id: 'gs1datamatrix', label: 'GS1 Data Matrix', dimensions: 2, common: false },
  { id: 'pdf417', label: 'PDF417', dimensions: 2, common: false },
  { id: 'pdf417compact', label: '紧凑 PDF417', dimensions: 2, common: false },
  { id: 'micropdf417', label: 'Micro PDF417', dimensions: 2, common: false },
  { id: 'azteccode', label: 'Aztec', dimensions: 2, common: false },
  { id: 'dotcode', label: 'DotCode', dimensions: 2, common: false },
  { id: 'hanxin', label: '汉信码', dimensions: 2, common: false },
  { id: 'codeone', label: 'Code One', dimensions: 2, common: false },
];

/** 按 id 找码制；不认识的返回 null。 */
export function barcodeType(id: string): BarcodeType | null {
  return BARCODE_TYPES.find((type) => type.id === id) ?? null;
}

/** 新元素的默认大小（mm）：放在纸的左上角安全区内，编辑器再挪到中间。 */
const NEW_ELEMENT_SIZE_MM: Readonly<Record<CanvasElementKind, { width: number; height: number }>> = {
  text: { width: 30, height: 6 },
  barcode: { width: 40, height: 12 },
  qr: { width: 15, height: 15 },
  image: { width: 15, height: 15 },
  line: { width: 30, height: CANVAS_LIMITS.minSizeMm },
  rect: { width: 20, height: 10 },
  table: { width: 36, height: 12 },
};

const NEW_ELEMENT_NAMES: Readonly<Record<CanvasElementKind, string>> = {
  text: '文字',
  barcode: '条码',
  qr: '二维码',
  image: '图片',
  line: '线',
  rect: '矩形',
  table: '表格',
};

/** 新元素：默认内容让人一眼看出它是什么，大小收进纸内。 */
export function newCanvasElement(kind: CanvasElementKind, id: string, paper: PaperSize): CanvasElement {
  const margin = CANVAS_LIMITS.safeMarginMm;
  const size = NEW_ELEMENT_SIZE_MM[kind];
  const base: CanvasElementBase = {
    id,
    name: NEW_ELEMENT_NAMES[kind],
    x: margin,
    y: margin,
    width: Math.min(size.width, paper.widthMm - 2 * margin),
    height: Math.min(size.height, paper.heightMm - 2 * margin),
    rotation: 0,
    locked: false,
  };
  switch (kind) {
    case 'text':
      return {
        ...base,
        kind,
        text: '文字',
        fontSizeMm: 3.5,
        bold: false,
        align: 'left',
        valign: 'middle',
        fit: 'shrink',
        inverse: false,
      };
    case 'barcode':
      return { ...base, kind, symbology: 'code128', value: '{完整内容}', showText: true, textSizeMm: 2.5 };
    case 'qr':
      return { ...base, kind, value: '{完整内容}', errorCorrection: 'M' };
    case 'image':
      // 1×1 的白点：插入图片时编辑器换成真正的像素。
      return { ...base, kind, pixels: '/w==', pixelWidth: 1, pixelHeight: 1, mode: 'threshold', threshold: 128 };
    case 'line':
      return { ...base, kind, dashed: false };
    case 'rect':
      return { ...base, kind, borderMm: 0.3, filled: false, radiusMm: 0 };
    case 'table':
      return {
        ...base,
        kind,
        rowsMm: [6, 0],
        columnsMm: [12, 0],
        borderMm: 0.25,
        cells: [
          [cell('名称', true), cell('{编码}', false)],
          [cell('尺码', true), cell('{尺码}', false)],
        ],
      };
  }
}

function cell(text: string, bold: boolean): CanvasTableCell {
  return { text, fontSizeMm: 2.8, bold, align: 'left' };
}
```

- [ ] **Step 4: `template-model.ts` 接入**

文件顶部加 `import type { CanvasTemplate } from './canvas-model';`，把联合类型改为：

```ts
/** label = 标签模板；waybill = 快递面单（格子版式）；canvas = 自由设计（元素版式）。数据库里的旧模板没有 kind，按 label 读。 */
export type LabelTemplate = QrLabelTemplate | WaybillTemplate | CanvasTemplate;
```

`withPaper` 改为：

```ts
export function withPaper<T extends LabelTemplate>(template: T, paper: PaperSize): T {
  // 面单：版面的最后一行（商家自定义区）在排版时吸收高度差；自由设计：超出新纸张的元素排版时收进纸内。
  if (template.kind !== 'label') {
    return { ...template, paper: { ...paper } };
  }
  return withLabelPaper(template, paper) as T;
}
```

- [ ] **Step 5: 跑测试通过、类型检查**

Run: `bun test src/core/templates/canvas-model.test.ts && bun run typecheck`（`package.json` 里五份 tsconfig 的类型检查脚本；没有单独脚本时用 `bun run check`）
Expected: 测试 PASS。类型检查会在 `sanitize-template.ts`、`label-html.ts`、`template-fields.ts` 报 canvas 分支没处理的错误——这是预期的，Task 5、8、9 处理；这一步只确认 canvas-model 本身没有类型错误。

- [ ] **Step 6: 提交**（这一步 `bun run check` 还不能全过，和 Task 5 一起提交：先 `git add`，不提交，接着做 Task 5）

---

### Task 5: 校验自由设计模板

**Files:**
- Create: `src/core/templates/sanitize-canvas.ts`
- Create: `src/core/templates/sanitize-canvas.test.ts`
- Modify: `src/core/templates/sanitize-template.ts`（按 kind 分派）

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/sanitize-canvas.test.ts
import { describe, expect, test } from 'bun:test';
import type { CanvasTemplate } from './canvas-model';
import { sanitizeCanvasElements } from './sanitize-canvas';
import { sanitizeTemplate } from './sanitize-template';

const PAPER = { widthMm: 60, heightMm: 40 };

function sanitize(elements: unknown) {
  return sanitizeCanvasElements(elements, PAPER);
}

describe('sanitizeCanvasElements', () => {
  test('drops elements of unknown kind and anything that is not a list', () => {
    expect(sanitize('x')).toEqual([]);
    expect(sanitize([{ kind: 'video' }, null, 3])).toEqual([]);
  });

  test('fills a text element field by field from the defaults', () => {
    const [text] = sanitize([{ kind: 'text', text: '品名', fontSizeMm: 99, align: 'diagonal' }]);
    expect(text).toMatchObject({ kind: 'text', text: '品名', fontSizeMm: 30, align: 'left', rotation: 0 });
  });

  test('keeps elements inside the paper and at least the minimum size', () => {
    const [box] = sanitize([{ kind: 'rect', x: 55, y: -3, width: 20, height: 0 }]);
    expect(box).toMatchObject({ x: 40, y: 0, width: 20, height: 0.25 });
  });

  test('accepts only right-angle rotations', () => {
    expect(sanitize([{ kind: 'line', rotation: 90 }])[0]?.rotation).toBe(90);
    expect(sanitize([{ kind: 'line', rotation: 45 }])[0]?.rotation).toBe(0);
  });

  test('gives every element a unique id', () => {
    const ids = sanitize([
      { kind: 'line', id: 'a' },
      { kind: 'line', id: 'a' },
      { kind: 'line', id: '<script>' },
    ]).map((element) => element.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('a');
  });

  test('falls back to Code 128 for an unknown symbology', () => {
    expect(sanitize([{ kind: 'barcode', symbology: 'nope' }])[0]).toMatchObject({ symbology: 'code128' });
    expect(sanitize([{ kind: 'barcode', symbology: 'ean13' }])[0]).toMatchObject({ symbology: 'ean13' });
  });

  test('keeps an image only when its pixels match its size and fit the budget', () => {
    const white2x1 = { kind: 'image', pixels: '//8=', pixelWidth: 2, pixelHeight: 1 };
    expect(sanitize([white2x1])[0]).toMatchObject({ kind: 'image', pixelWidth: 2 });
    expect(sanitize([{ ...white2x1, pixelWidth: 3 }])).toEqual([]);
    expect(sanitize([{ ...white2x1, pixels: '***' }])).toEqual([]);
  });

  test('makes table cells match the rows and columns', () => {
    const [table] = sanitize([{ kind: 'table', rowsMm: [5, 0], columnsMm: [10, 10, 0], cells: [[{ text: 'a' }]] }]);
    if (table?.kind !== 'table') throw new Error('expected a table');
    expect(table.cells).toHaveLength(2);
    expect(table.cells.every((row) => row.length === 3)).toBe(true);
    expect(table.cells[0]?.[0]?.text).toBe('a');
    expect(table.cells[1]?.[2]?.text).toBe('');
  });

  test('keeps at most the element limit', () => {
    expect(sanitize(Array.from({ length: 150 }, () => ({ kind: 'line' })))).toHaveLength(100);
  });
});

describe('sanitizeTemplate for canvas templates', () => {
  test('keeps the canvas kind and sanitizes its elements', () => {
    const result = sanitizeTemplate(
      { kind: 'canvas', name: '吊牌', elements: [{ kind: 'text', text: 'A' }] },
      'custom:c1',
      { kind: 'canvas', id: 'x', name: '旧', paper: PAPER, printer: null, elements: [] } satisfies CanvasTemplate,
    );
    expect(result).toMatchObject({ kind: 'canvas', id: 'custom:c1', name: '吊牌' });
    expect(result.kind === 'canvas' && result.elements[0]?.kind).toBe('text');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/sanitize-canvas.test.ts`
Expected: FAIL，`Cannot find module './sanitize-canvas'`。

- [ ] **Step 3: 实现 `sanitize-canvas.ts`**

```ts
// src/core/templates/sanitize-canvas.ts
import type { PaperSize } from '../../shared/paper-sizes';
import {
  barcodeType,
  CANVAS_ELEMENT_KINDS,
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasElementBase,
  type CanvasElementKind,
  type CanvasTableCell,
  IMAGE_MODES,
  newCanvasElement,
  ROTATIONS,
  TEXT_FITS,
} from './canvas-model';
import { asLoose, bool, clamp, type Loose, pick, sanitizeText } from './sanitize-primitives';
import { QR_ERROR_LEVELS, TEXT_ALIGNS } from './template-model';
import { VERTICAL_ALIGNS } from './waybill-model';

/** 元素 id：字母、数字、下划线、连字符。编辑器用它记住选中的元素，不进 HTML。 */
const ELEMENT_ID_PATTERN = /^[\w-]{1,32}$/;
/** base64 只允许这些字符（去掉换行后）。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * 不可信的元素列表 → 合法元素：认不出的类型、像素对不上的图片直接丢掉，其余每一项缺了或不对就取这一类的默认值；
 * 位置和大小收进纸内。不改顺序（顺序就是上下层）。
 */
export function sanitizeCanvasElements(value: unknown, paper: PaperSize): CanvasElement[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const usedIds = new Set<string>();
  let imageBudget = CANVAS_LIMITS.templateImageBytes;
  const elements: CanvasElement[] = [];
  for (const item of value) {
    if (elements.length === CANVAS_LIMITS.elements) {
      break;
    }
    const input = asLoose(item);
    const kind = pick<CanvasElementKind | ''>(input['kind'], CANVAS_ELEMENT_KINDS, '');
    if (kind === '') {
      continue;
    }
    const id = uniqueId(input['id'], usedIds, elements.length);
    const element = sanitizeElement(input, kind, id, paper);
    if (element === null) {
      continue;
    }
    if (element.kind === 'image') {
      const bytes = element.pixelWidth * element.pixelHeight;
      if (bytes > imageBudget) {
        continue;
      }
      imageBudget -= bytes;
    }
    usedIds.add(id);
    elements.push(element);
  }
  return elements;
}

function uniqueId(value: unknown, used: ReadonlySet<string>, index: number): string {
  if (typeof value === 'string' && ELEMENT_ID_PATTERN.test(value) && !used.has(value)) {
    return value;
  }
  let candidate = `e${index + 1}`;
  for (let suffix = 2; used.has(candidate); suffix += 1) {
    candidate = `e${index + 1}-${suffix}`;
  }
  return candidate;
}

function sanitizeElement(input: Loose, kind: CanvasElementKind, id: string, paper: PaperSize): CanvasElement | null {
  const fallback = newCanvasElement(kind, id, paper);
  const base = sanitizeBase(input, fallback, paper);
  const { fontSizeMm } = CANVAS_LIMITS;
  switch (fallback.kind) {
    case 'text':
      return {
        ...base,
        kind: 'text',
        text: sanitizeText(input['text'], CANVAS_LIMITS.textLength, fallback.text),
        fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, fallback.fontSizeMm),
        bold: bool(input['bold'], fallback.bold),
        align: pick(input['align'], TEXT_ALIGNS, fallback.align),
        valign: pick(input['valign'], VERTICAL_ALIGNS, fallback.valign),
        fit: pick(input['fit'], TEXT_FITS, fallback.fit),
        inverse: bool(input['inverse'], fallback.inverse),
      };
    case 'barcode': {
      const symbology = typeof input['symbology'] === 'string' ? input['symbology'] : '';
      return {
        ...base,
        kind: 'barcode',
        symbology: barcodeType(symbology) === null ? fallback.symbology : symbology,
        value: sanitizeText(input['value'], CANVAS_LIMITS.valueLength, fallback.value).replace(/\n/g, ''),
        showText: bool(input['showText'], fallback.showText),
        textSizeMm: clamp(input['textSizeMm'], fontSizeMm.min, fontSizeMm.max, fallback.textSizeMm),
      };
    }
    case 'qr':
      return {
        ...base,
        kind: 'qr',
        value: sanitizeText(input['value'], CANVAS_LIMITS.valueLength, fallback.value),
        errorCorrection: pick(input['errorCorrection'], QR_ERROR_LEVELS, fallback.errorCorrection),
      };
    case 'image':
      return sanitizeImage(input, base);
    case 'line':
      return { ...base, kind: 'line', dashed: bool(input['dashed'], fallback.dashed) };
    case 'rect':
      return {
        ...base,
        kind: 'rect',
        borderMm: clamp(input['borderMm'], CANVAS_LIMITS.borderMm.min, CANVAS_LIMITS.borderMm.max, fallback.borderMm),
        filled: bool(input['filled'], fallback.filled),
        radiusMm: clamp(input['radiusMm'], 0, CANVAS_LIMITS.radiusMm.max, fallback.radiusMm),
      };
    case 'table':
      return sanitizeTable(input, base, fallback.borderMm);
  }
}

function sanitizeBase(input: Loose, fallback: CanvasElementBase, paper: PaperSize): CanvasElementBase {
  const min = CANVAS_LIMITS.minSizeMm;
  const width = clamp(input['width'], min, paper.widthMm, fallback.width);
  const height = clamp(input['height'], min, paper.heightMm, fallback.height);
  return {
    id: fallback.id,
    name: sanitizeText(input['name'], CANVAS_LIMITS.nameLength, fallback.name).replace(/\n/g, '').trim() || fallback.name,
    // 先定大小再定位置：位置夹到「纸宽 − 元素宽」以内，元素整个在纸上。
    x: clamp(input['x'], 0, paper.widthMm - width, fallback.x),
    y: clamp(input['y'], 0, paper.heightMm - height, fallback.y),
    width,
    height,
    rotation: pick(input['rotation'], ROTATIONS, 0),
    locked: bool(input['locked'], false),
  };
}

function sanitizeImage(input: Loose, base: CanvasElementBase): CanvasElement | null {
  const width = input['pixelWidth'];
  const height = input['pixelHeight'];
  const pixels = typeof input['pixels'] === 'string' ? input['pixels'].replace(/\s/g, '') : '';
  const side = CANVAS_LIMITS.imageSidePixels;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > side ||
    (height as number) > side ||
    !BASE64_PATTERN.test(pixels)
  ) {
    return null;
  }
  const bytes = (width as number) * (height as number);
  if (bytes > CANVAS_LIMITS.imageBytes || base64ByteLength(pixels) !== bytes) {
    return null;
  }
  return {
    ...base,
    kind: 'image',
    pixels,
    pixelWidth: width as number,
    pixelHeight: height as number,
    mode: pick(input['mode'], IMAGE_MODES, 'threshold'),
    threshold: Math.round(clamp(input['threshold'], 0, 255, 128)),
  };
}

/** base64 解码后的字节数（不真的解码）。 */
function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function sanitizeTable(input: Loose, base: CanvasElementBase, borderFallback: number): CanvasElement {
  const rowsMm = sanitizeSizes(input['rowsMm'], CANVAS_LIMITS.tableRows, [base.height]);
  const columnsMm = sanitizeSizes(input['columnsMm'], CANVAS_LIMITS.tableColumns, [base.width]);
  const rowsInput = Array.isArray(input['cells']) ? input['cells'] : [];
  const cells: CanvasTableCell[][] = rowsMm.map((_, row) => {
    const rowInput = Array.isArray(rowsInput[row]) ? (rowsInput[row] as unknown[]) : [];
    return columnsMm.map((__, column) => sanitizeCell(rowInput[column]));
  });
  return {
    ...base,
    kind: 'table',
    rowsMm,
    columnsMm,
    borderMm: clamp(input['borderMm'], CANVAS_LIMITS.borderMm.min, CANVAS_LIMITS.borderMm.max, borderFallback),
    cells,
  };
}

/** 行高、列宽：非负的数，至少一项，最多 limit 项；最后一项排版时按剩下的算，这里不管。 */
function sanitizeSizes(value: unknown, limit: number, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const sizes = value
    .slice(0, limit)
    .map((size) => (typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0));
  return sizes.length > 0 ? sizes : fallback;
}

function sanitizeCell(value: unknown): CanvasTableCell {
  const input = asLoose(value);
  const { fontSizeMm } = CANVAS_LIMITS;
  return {
    text: sanitizeText(input['text'], CANVAS_LIMITS.textLength, ''),
    fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, 2.8),
    bold: bool(input['bold'], false),
    align: pick(input['align'], TEXT_ALIGNS, 'left'),
  };
}
```

注：`pick<CanvasElementKind | ''>` 需要 `CANVAS_ELEMENT_KINDS` 能赋给 `readonly (CanvasElementKind | '')[]`——可以（只读数组协变）。`newCanvasElement` 的图片默认像素 `'/w=='` 是 1 个字节（255，白）。

- [ ] **Step 4: `sanitize-template.ts` 分派**

`sanitizeTemplate` 里把 `const kind = input['kind'] === 'waybill' ? 'waybill' : 'label';` 换成：

```ts
  const kind = pick(input['kind'], ['label', 'waybill', 'canvas'] as const, 'label');
```

在 `if (kind === 'waybill') { ... }` 之后加：

```ts
  if (kind === 'canvas') {
    return { kind, ...base, elements: sanitizeCanvasElements(input['elements'], paper) };
  }
```

文件头加 `import { sanitizeCanvasElements } from './sanitize-canvas';`。

- [ ] **Step 5: 跑测试通过**

Run: `bun test src/core/templates`
Expected: PASS。

- [ ] **Step 6: 提交 Task 4 + 5**（类型检查此时 `label-html.ts`、`template-fields.ts` 仍缺 canvas 分支：在 `renderLabelHtml` 和 `templateFields` 里临时加一行保证编译——见下，Task 8、9 换成真实现）

`label-html.ts` 的 `renderLabelHtml` 开头加：

```ts
  if (template.kind === 'canvas') {
    // Task 8 换成 renderCanvasHtml。
    return { html: '', qrOmitted: false, barcodeOmitted: false, overflowCells: 0, issues: [] };
  }
```

`template-fields.ts` 的 `templateFields` 开头加：

```ts
  if (template.kind === 'canvas') {
    return { mode: 'PICKED', names: [] };
  }
```

Run: `bun run check`
Expected: 通过。

```bash
git add src/core/templates/canvas-model.ts src/core/templates/canvas-model.test.ts src/core/templates/template-model.ts src/core/templates/sanitize-canvas.ts src/core/templates/sanitize-canvas.test.ts src/core/templates/sanitize-template.ts src/main/printing/label-html.ts src/core/api/template-fields.ts
git commit -m "feat(templates): add the canvas template model and its sanitizer" -m "A third template kind for designed labels (tags, price labels, product barcodes): absolutely placed text, barcodes, QR codes, images, lines, rectangles and tables. Untrusted input is clamped into the paper, images must match their pixel size and fit a budget, and unknown element kinds are dropped." -m "<trailer>"
```

（「Task 8 换成…」这类注释在 Task 8、9 里删掉；它们只存在于这一个提交。）

---

### Task 6: 黑白图片

**Files:**
- Create: `src/core/templates/mono-image.ts`
- Create: `src/core/templates/mono-image.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/mono-image.test.ts
import { describe, expect, test } from 'bun:test';
import { decodeGray, fitContain, monoPath, resizeGray, toMono } from './mono-image';

/** 把 0–255 的数组编码成 base64，方便写用例。 */
function base64(values: number[]): string {
  return btoa(String.fromCharCode(...values));
}

describe('mono image', () => {
  test('decodes gray pixels only when the size matches', () => {
    expect(decodeGray(base64([0, 255]), 2, 1)?.pixels).toEqual(new Uint8Array([0, 255]));
    expect(decodeGray(base64([0, 255]), 3, 1)).toBeNull();
  });

  test('fits an image into a box keeping its aspect ratio', () => {
    expect(fitContain(200, 100, 50, 50)).toEqual({ width: 50, height: 25 });
    expect(fitContain(100, 200, 50, 50)).toEqual({ width: 25, height: 50 });
    expect(fitContain(1, 1000, 50, 50)).toEqual({ width: 1, height: 50 });
  });

  test('averages pixels when shrinking', () => {
    const image = { width: 2, height: 2, pixels: new Uint8Array([0, 255, 255, 255]) };
    expect(resizeGray(image, 1, 1).pixels).toEqual(new Uint8Array([191]));
  });

  test('turns pixels darker than the threshold black', () => {
    const image = { width: 3, height: 1, pixels: new Uint8Array([10, 127, 200]) };
    expect(toMono(image, 'threshold', 128)).toEqual(new Uint8Array([1, 1, 0]));
  });

  test('dithers a mid gray into about half black dots', () => {
    const size = 20;
    const image = { width: size, height: size, pixels: new Uint8Array(size * size).fill(128) };
    const black = toMono(image, 'dither', 128).reduce((sum, value) => sum + value, 0);
    expect(black / (size * size)).toBeGreaterThan(0.4);
    expect(black / (size * size)).toBeLessThan(0.6);
  });

  test('draws runs of black dots as one rectangle each', () => {
    const mono = new Uint8Array([1, 1, 0, 1, 0, 0, 0, 0]);
    expect(monoPath(mono, 4, 2)).toBe('M0 0h2v1H0zM3 0h1v1H3z');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/mono-image.test.ts`
Expected: FAIL，`Cannot find module './mono-image'`。

- [ ] **Step 3: 实现**

```ts
// src/core/templates/mono-image.ts
import type { ImageMode } from './canvas-model';

/**
 * 图片 → 热敏标签机能打的黑白点：只有黑和白，没有灰。全部是纯 TypeScript（不解码图片文件，见 canvas-model 的 CanvasImage），
 * 主进程和测试都能直接用。
 */

export interface GrayImage {
  width: number;
  height: number;
  /** 8 位灰度，逐行，0 黑 – 255 白。 */
  pixels: Uint8Array;
}

/** base64 的灰度像素 → 图像；字节数和宽高对不上（被改坏的模板）返回 null。 */
export function decodeGray(base64: string, width: number, height: number): GrayImage | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length !== width * height) {
    return null;
  }
  const pixels = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pixels[index] = binary.charCodeAt(index);
  }
  return { width, height, pixels };
}

/** 等比放进框里（整数像素，至少 1）。 */
export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.min(boxWidth, Math.round(sourceWidth * scale))),
    height: Math.max(1, Math.min(boxHeight, Math.round(sourceHeight * scale))),
  };
}

/** 缩放：每个目标点取它覆盖的源像素的平均值（缩小时不丢细节、不出摩尔纹），放大时就是最近邻。 */
export function resizeGray(image: GrayImage, width: number, height: number): GrayImage {
  const pixels = new Uint8Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor(y * scaleY);
    const bottom = Math.max(top + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor(x * scaleX);
      const right = Math.max(left + 1, Math.floor((x + 1) * scaleX));
      let sum = 0;
      for (let sy = top; sy < bottom; sy += 1) {
        for (let sx = left; sx < right; sx += 1) {
          sum += image.pixels[sy * image.width + sx] ?? 255;
        }
      }
      pixels[y * width + x] = Math.round(sum / ((bottom - top) * (right - left)));
    }
  }
  return { width, height, pixels };
}

/** Floyd–Steinberg 误差扩散的权重（右、左下、下、右下，分母 16）。 */
const DITHER_WEIGHTS = [
  { dx: 1, dy: 0, weight: 7 },
  { dx: -1, dy: 1, weight: 3 },
  { dx: 0, dy: 1, weight: 5 },
  { dx: 1, dy: 1, weight: 1 },
] as const;
const DITHER_DIVISOR = 16;
const WHITE = 255;

/** 转黑白：1 = 黑点、0 = 白。阈值：比 threshold 暗的为黑；抖动：同一阈值，误差分给邻居，灰度变成点的疏密。 */
export function toMono(image: GrayImage, mode: ImageMode, threshold: number): Uint8Array {
  const { width, height } = image;
  const mono = new Uint8Array(width * height);
  if (mode === 'threshold') {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] = (image.pixels[index] ?? WHITE) < threshold ? 1 : 0;
    }
    return mono;
  }
  const values = Float32Array.from(image.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const old = values[index] ?? WHITE;
      const isBlack = old < threshold;
      mono[index] = isBlack ? 1 : 0;
      const error = old - (isBlack ? 0 : WHITE);
      for (const { dx, dy, weight } of DITHER_WEIGHTS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) {
          const target = ny * width + nx;
          values[target] = (values[target] ?? WHITE) + (error * weight) / DITHER_DIVISOR;
        }
      }
    }
  }
  return mono;
}

/** 黑点 → SVG 路径：每行连续的黑点合成一个矩形（和二维码的画法一样），坐标单位是点。 */
export function monoPath(mono: Uint8Array, width: number, height: number): string {
  let path = '';
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (mono[y * width + x] !== 1) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && mono[y * width + x] === 1) {
        x += 1;
      }
      path += `M${start} ${y}h${x - start}v1H${start}z`;
    }
  }
  return path;
}
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/core/templates/mono-image.test.ts`
Expected: PASS（`resizeGray` 的 `(0+255+255+255)/4 = 191.25 → 191`）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/templates/mono-image.ts src/core/templates/mono-image.test.ts
git commit -m "feat(templates): turn gray images into printer dots" -m "Thermal label printers only print black dots. Images are resized by area averaging and turned black and white by threshold (logos) or Floyd-Steinberg dithering (photos), then drawn as SVG runs aligned to dots. Pure TypeScript: no image decoding in the main process." -m "<trailer>"
```

---

### Task 7: 条码模块 `barcode.ts`（bwip-js 编码，按打印点画）

**Files:**
- Create: `src/main/printing/barcode.ts`
- Create: `src/main/printing/barcode.test.ts`
- Modify: `src/main/printing/waybill-html.ts`（改用 `barcode.ts` 的常量和画法，输出不变）

- [ ] **Step 1: 写测试**

```ts
// src/main/printing/barcode.test.ts
import { describe, expect, test } from 'bun:test';
import { encodeBarcode, linearBarsPath, matrixPath, moduleDotsFor } from './barcode';
import { encodeCode128 } from './code128';

describe('encodeBarcode', () => {
  test('encodes EAN-13 into 95 modules and adds the check digit itself', () => {
    const result = encodeBarcode('ean13', '590123412345');
    if (!result.ok || result.code.dimensions !== 1) throw new Error('expected a 1D code');
    expect(result.code.widths.reduce((sum, width) => sum + width, 0)).toBe(95);
  });

  test('encodes Code 128 to the same width as our own encoder', () => {
    const result = encodeBarcode('code128', 'ABC');
    if (!result.ok || result.code.dimensions !== 1) throw new Error('expected a 1D code');
    expect(result.code.widths.reduce((sum, width) => sum + width, 0)).toBe(encodeCode128('ABC')?.modules);
  });

  test('encodes Data Matrix as a square grid of cells', () => {
    const result = encodeBarcode('datamatrix', 'ABC');
    if (!result.ok || result.code.dimensions !== 2) throw new Error('expected a 2D code');
    expect(result.code.columns).toBe(result.code.rows);
    expect(result.code.cells).toHaveLength(result.code.columns * result.code.rows);
    expect(result.code.rowScale).toBe(1);
  });

  test('draws PDF417 rows three modules tall', () => {
    const result = encodeBarcode('pdf417', 'ABC');
    if (!result.ok || result.code.dimensions !== 2) throw new Error('expected a 2D code');
    expect(result.code.rowScale).toBe(3);
    // 只有不重复的行进 cells：行数 × 列数正好是 cells 的长度。
    expect(result.code.cells).toHaveLength(result.code.rows * result.code.columns);
  });

  test('explains in Chinese what is wrong with the content', () => {
    const result = encodeBarcode('ean13', '12345');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('位数不对') });
    expect(encodeBarcode('ean13', 'ABCDEFGHIJKL').ok).toBe(false);
    expect(encodeBarcode('nope', '1')).toEqual({ ok: false, reason: '不认识的条码类型：nope' });
  });
});

describe('drawing', () => {
  test('fits whole printer dots per module within the limits', () => {
    // 0.125mm 一个点：100 个点放 40 个模块 → 每个模块 2 个点。
    expect(moduleDotsFor(100, 40, 0.125, 0.625)).toBe(2);
    expect(moduleDotsFor(100, 60, 0.125, 0.625)).toBeNull();
    expect(moduleDotsFor(10_000, 10, 0.125, 0.625)).toBe(5);
  });

  test('draws bars of equal height as full-height rectangles', () => {
    expect(linearBarsPath([2, 1, 3], false)).toBe('M0 0h2v1H0zM3 0h3v1H3z');
    expect(linearBarsPath([2, 1, 3], true)).toBe('M0 0h1v2H0zM0 3h1v3H0z');
  });

  test('draws four-state bars at their own heights', () => {
    // 两根条：第一根占上半，第二根满高。
    expect(linearBarsPath([1, 1, 1], false, [0.5, 1], [0.5, 0])).toBe('M0 0h1v0.5H0zM2 0h1v1H2z');
  });

  test('draws a 2D grid with taller rows when asked', () => {
    expect(matrixPath([1, 0, 0, 1], 2, 2, 3)).toBe('M0 0h1v3H0zM1 3h1v3H1z');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/barcode.test.ts`
Expected: FAIL，`Cannot find module './barcode'`。

- [ ] **Step 3: 实现**

```ts
// src/main/printing/barcode.ts
import bwipjs from 'bwip-js';
import { barcodeType } from '../../core/templates/canvas-model';

/**
 * 条码：编码交给 bwip-js（只要条空宽度或点阵），画法自己来：每个模块取整数个打印点，路径坐标以模块为单位，
 * 外面的 SVG 按点数定大小，crispEdges 不抗锯齿。面单（Code128，自己的编码器）和自由设计共用这里的画法和限制。
 */

/** 条码两侧的空白（静区）：标准要求一维码至少 10 个模块，扫码枪才找得到条码的起止。 */
export const QUIET_ZONE_MODULES = 10;
/** 模块宽下限 0.25mm：203dpi 上 2 个点，再窄扫码枪读不稳。 */
export const MIN_MODULE_MM = 0.25;
/** 面单的模块宽上限：二联的运单条码约 88mm 宽，15 位单号的模块约 0.6mm（照平台面单）。 */
export const WAYBILL_MAX_MODULE_MM = 0.625;
/** 自由设计的模块宽上限：标签可以很大（100×150），条码按框放大到 1mm 的模块就够了。 */
export const CANVAS_MAX_MODULE_MM = 1;
/** 条码最矮 4mm：再矮手持扫码枪的扫描线不好对准，放不下就不印并提示。 */
export const MIN_BAR_HEIGHT_MM = 4;

/** 二维码制的静区（模块数）：Data Matrix 1、PDF417 2，其余按 1（标准里写 0 的也留 1，和相邻的线分开）。 */
const MATRIX_QUIET_ZONE_MODULES: Readonly<Record<string, number>> = { pdf417: 2, pdf417compact: 2 };
const DEFAULT_MATRIX_QUIET_ZONE_MODULES = 1;

export interface LinearCode {
  dimensions: 1;
  /** 条、空、条……的宽度（模块数），条开头、条结尾。 */
  widths: number[];
  /** 每根条的高度（占满高的比例，0–1）；四态邮政码各不相同，其余都是 1。 */
  heights: number[];
  /** 每根条离底边的距离（占满高的比例）。 */
  offsets: number[];
}

export interface MatrixCode {
  dimensions: 2;
  /** 逐行的点：1 = 黑。 */
  cells: number[];
  columns: number;
  rows: number;
  /** 一行有几个模块高（PDF417 一行 3 个模块高，其余 1）。 */
  rowScale: number;
}

export type BarcodeResult = { ok: true; code: LinearCode | MatrixCode } | { ok: false; reason: string };

interface RawLinear {
  sbs: number[];
  bhs: number[];
  bbs: number[];
}

interface RawMatrix {
  pixs: number[];
  pixx: number;
  pixy: number;
  height: number;
  width: number;
}

/** bwip-js 的 raw()：同步，出错时抛出。返回值按 bwip-js 的文档收窄成两种形状之一。 */
function rawEncode(bcid: string, text: string): RawLinear | RawMatrix {
  const raw = bwipjs.raw({ bcid, text }) as unknown;
  const first = Array.isArray(raw) ? (raw[0] as unknown) : null;
  if (typeof first === 'object' && first !== null) {
    if ('sbs' in first) {
      return first as RawLinear;
    }
    if ('pixs' in first) {
      return first as RawMatrix;
    }
  }
  throw new Error(`bwip-js returned an unexpected shape for ${bcid}`);
}

/** 编码；内容不合这种码制（位数、校验位、字符）时给出中文原因，不抛出。 */
export function encodeBarcode(symbology: string, text: string): BarcodeResult {
  const type = barcodeType(symbology);
  if (type === null) {
    return { ok: false, reason: `不认识的条码类型：${symbology}` };
  }
  let raw: RawLinear | RawMatrix;
  try {
    raw = rawEncode(symbology, text);
  } catch (error) {
    return { ok: false, reason: `内容不符合 ${type.label} 的要求：${explain(error)}` };
  }
  if ('sbs' in raw) {
    const tallest = Math.max(...raw.bhs.map((height, index) => height + (raw.bbs[index] ?? 0)));
    return {
      ok: true,
      code: {
        dimensions: 1,
        widths: raw.sbs,
        heights: raw.bhs.map((height) => height / tallest),
        offsets: raw.bbs.map((offset) => offset / tallest),
      },
    };
  }
  // pixs 里只有不重复的行（PDF417 7 行 × 103 列）；pixy 是把每行的高度（几个模块）算进去之后的行数（7 × 3 = 21）。
  // 实测（bwip-js 4.11.4）：PDF417 一行 3 个模块高、Micro PDF417 2 个、Data Matrix 1 个。
  const rows = Math.max(1, Math.round(raw.pixs.length / raw.pixx));
  const rowScale = Math.max(1, Math.round(raw.pixy / rows));
  return { ok: true, code: { dimensions: 2, cells: raw.pixs, columns: raw.pixx, rows, rowScale } };
}

/** bwip-js 的错误信息是英文的「bwipp.ean13badLength#4372: EAN-13 must be 12 or 13 digits」：按错误码说中文。 */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/badLength|tooLong|tooShort/i.test(message)) {
    return '位数不对';
  }
  if (/badCheck/i.test(message)) {
    return '校验位不对';
  }
  if (/badChar|invalid/i.test(message)) {
    return '有这种条码不能编的字';
  }
  return '内容不对';
}

/** 二维码制的静区。 */
export function matrixQuietZone(symbology: string): number {
  return MATRIX_QUIET_ZONE_MODULES[symbology] ?? DEFAULT_MATRIX_QUIET_ZONE_MODULES;
}

/**
 * 每个模块几个点：在 lengthDots 个点里放 totalModules 个模块（含静区），不超过 maxModuleMm；
 * 小于 MIN_MODULE_MM 时返回 null（放不下，不印）。
 */
export function moduleDotsFor(lengthDots: number, totalModules: number, dot: number, maxModuleMm: number): number | null {
  const minDots = Math.max(1, Math.round(MIN_MODULE_MM / dot));
  const maxDots = Math.max(minDots, Math.round(maxModuleMm / dot));
  const dots = Math.min(maxDots, Math.floor(lengthDots / totalModules));
  return dots < minDots ? null : dots;
}

/**
 * 一维条码的路径，坐标以模块为单位：横排时条沿 x 排开、高度占 viewBox 的 1；竖排时转 90°（条纹横着走）。
 * heights、offsets 不给时每根条满高（面单的 Code128 就是这样，输出和原来逐字相同）。
 */
export function linearBarsPath(
  widths: readonly number[],
  vertical: boolean,
  heights?: readonly number[],
  offsets?: readonly number[],
): string {
  let position = 0;
  let path = '';
  widths.forEach((width, index) => {
    if (index % 2 === 0) {
      const bar = index / 2;
      const height = heights?.[bar] ?? 1;
      const top = 1 - height - (offsets?.[bar] ?? 0);
      path += vertical
        ? `M${top} ${position}h${height}v${width}H${top}z`
        : `M${position} ${top}h${width}v${height}H${position}z`;
    }
    position += width;
  });
  return path;
}

/** 二维码制的路径：每行连续的黑点合成一个矩形，一行 rowScale 个模块高。 */
export function matrixPath(cells: readonly number[], columns: number, rows: number, rowScale: number): string {
  let path = '';
  for (let row = 0; row < rows; row += 1) {
    let column = 0;
    while (column < columns) {
      if (cells[row * columns + column] !== 1) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < columns && cells[row * columns + column] === 1) {
        column += 1;
      }
      path += `M${start} ${row * rowScale}h${column - start}v${rowScale}H${start}z`;
    }
  }
  return path;
}
```

`linearBarsPath` 竖排输出和 `waybill-html.ts` 原来的 `M0 ${offset}h1v${width}H0z` 相同（`top = 0`、`height = 1`）。`.forEach` 在这里只做累加，不需要提前退出，保留（Google 规范只在需要 break / await 时要求 for…of）。

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/printing/barcode.test.ts`
Expected: PASS。若 EAN-13 错误信息里的错误码不含 `badLength`（bwip-js 版本不同），用 `bun -e "import b from 'bwip-js'; try { b.raw({bcid:'ean13',text:'12345'}) } catch (e) { console.log(e.message) }"` 看实际文字，把 `explain` 的正则补上，并在测试旁注释实际的错误码。

- [ ] **Step 5: 面单改用 `barcode.ts`**

`waybill-html.ts`：
- 删掉文件里的 `QUIET_ZONE_MODULES`、`MIN_MODULE_MM`、`MAX_MODULE_MM`、`MIN_BAR_HEIGHT_MM` 定义，改为
  `import { linearBarsPath, MIN_BAR_HEIGHT_MM, moduleDotsFor, QUIET_ZONE_MODULES, WAYBILL_MAX_MODULE_MM } from './barcode';`
- `barcodeSvg` 里的模块计算换成：

```ts
  const moduleDots = moduleDotsFor(lengthDots, totalModules, dot, WAYBILL_MAX_MODULE_MM);
  if (moduleDots === null) {
    return null;
  }
```

  （删掉原来的 `minDots`、`maxDots` 两行和 `if (moduleDots < minDots)`。）
- 路径生成的 `forEach` 换成 `const path = linearBarsPath(code.widths, content.vertical);`（删掉 `let offset`、`let path` 和那段 forEach）。

- [ ] **Step 6: 面单快照不变**

Run: `bun test src/main/printing`
Expected: PASS，快照一个都没变（`git diff src/main/printing/__snapshots__` 为空）。

- [ ] **Step 7: bundle 检查、`bun run check` 后提交**

Run: `bun run build && bun run verify:bundle && bun run check`

```bash
git add src/main/printing/barcode.ts src/main/printing/barcode.test.ts src/main/printing/waybill-html.ts
git commit -m "feat(print): encode barcodes with bwip-js and draw them on printer dots" -m "One place for barcode limits and drawing: modules are whole printer dots, quiet zones are kept, four-state postal bars keep their own heights and PDF417 rows are three modules tall. Content that does not fit a symbology is explained in Chinese. Waybills keep their own Code 128 encoder and render byte for byte as before." -m "<trailer>"
```

---

### Task 8: 自由设计模板的排版（core）

**Files:**
- Create: `src/core/templates/canvas-layout.ts`
- Create: `src/core/templates/canvas-layout.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/canvas-layout.test.ts
import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from './canvas-model';
import { layoutCanvas } from './canvas-layout';

const DOT = 25.4 / 203;
const PAPER = { widthMm: 60, heightMm: 40 };
const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '尺码', value: 'XL' },
  ],
};

function canvasOf(elements: CanvasElement[]): CanvasTemplate {
  return { kind: 'canvas', id: 'custom:c', name: 'c', paper: PAPER, printer: null, elements };
}

function layout(elements: CanvasElement[]) {
  return layoutCanvas(canvasOf(elements), { scan: SCAN, printedAt: new Date(2026, 9, 1, 9, 5), dotMm: DOT });
}

function text(overrides: Partial<CanvasElement> & { text?: string }): CanvasElement {
  return { ...newCanvasElement('text', 't', PAPER), x: 5, y: 5, ...overrides } as CanvasElement;
}

describe('layoutCanvas', () => {
  test('puts every element on whole printer dots', () => {
    const { elements } = layout([text({ x: 5.07, y: 3.33, width: 20.01, height: 6.06 })]);
    const onDot = (mm: number) => Math.abs(mm / DOT - Math.round(mm / DOT)) < 1e-6;
    const rect = elements[0]?.rect;
    if (!rect) throw new Error('expected a laid element');
    expect([rect.x, rect.y, rect.width, rect.height].every(onDot)).toBe(true);
  });

  test('swaps the frame for elements turned by 90 or 270 degrees', () => {
    const [turned] = layout([text({ width: 6, height: 20, rotation: 90 })]).elements;
    expect(turned?.frame.width).toBeCloseTo(turned?.rect.height ?? 0);
    expect(turned?.frame.height).toBeCloseTo(turned?.rect.width ?? 0);
  });

  test('fills variables and drops lines whose fields are all missing', () => {
    const [laid] = layout([text({ text: '编码：{编码}\n颜色：{颜色}', height: 10 })]).elements;
    if (laid?.content.kind !== 'text') throw new Error('expected text');
    expect(laid.content.lines.map((line) => line.text)).toEqual(['编码：CL5640-TK']);
  });

  test('leaves out an element whose content came out empty', () => {
    expect(layout([text({ text: '{颜色}' })]).elements).toHaveLength(0);
  });

  test('reports text that had to be cut and elements near the paper edge', () => {
    const { issues, overflowCount } = layout([
      text({ name: '长文字', text: '很长很长的文字'.repeat(20), width: 10, height: 3 }),
      text({ name: '边上', x: 0.5, y: 10 }),
    ]);
    expect(overflowCount).toBe(1);
    expect(issues).toEqual([
      '文字「长文字」放不下，已截断：加大文字框或调小字号',
      '「边上」靠近纸边（离纸边不到 1.5mm），可能打不全',
    ]);
  });

  test('reports a barcode that has nothing to encode', () => {
    const barcode = { ...newCanvasElement('barcode', 'b', PAPER), name: '商品码', value: '{商品码}' };
    const result = layout([barcode]);
    expect(result.elements).toHaveLength(0);
    expect(result.issues).toEqual(['条码「商品码」这一张没有内容，不印']);
  });

  test('splits a table into dot-aligned cells with the last row and column taking the rest', () => {
    const table = { ...newCanvasElement('table', 'tb', PAPER), x: 5, y: 5, width: 30, height: 10 };
    const [laid] = layout([table]).elements;
    if (laid?.content.kind !== 'table') throw new Error('expected a table');
    const { rows, columns } = laid.content;
    expect(rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(laid.frame.height);
    expect(columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(laid.frame.width);
    expect(laid.content.cells[1]?.[1]?.lines[0]?.text).toBe('XL');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/canvas-layout.test.ts`
Expected: FAIL，`Cannot find module './canvas-layout'`。

- [ ] **Step 3: 实现**

```ts
// src/core/templates/canvas-layout.ts
import type { ScanResult } from '../scan/scan-result';
import {
  CANVAS_LIMITS,
  type CanvasBarcode,
  type CanvasElement,
  type CanvasImage,
  type CanvasQr,
  type CanvasTable,
  type CanvasTemplate,
  type CanvasText,
  type Rotation,
} from './canvas-model';
import { expandVariables } from './note-text';
import type { TextAlign } from './template-model';
import { FLOAT_EPSILON } from './text-fit';
import {
  CELL_PADDING_MM,
  expandParagraph,
  fitParagraphs,
  type Rect,
  resolveSizes,
  type TextLine,
} from './waybill-layout';
import type { VerticalAlign } from './waybill-model';

/**
 * 自由设计模板的排版：位置大小取整到打印点、展开变量、排文字、切表格，并列出打印前检查的问题。
 * 条码、二维码、图片的点阵在主进程画（要编码），这里只给出它们的框和展开后的内容。
 */

export interface CanvasLayoutContext {
  scan: ScanResult;
  printedAt: Date;
  /** 打印机一个点有多少毫米（203dpi ≈ 0.125）。 */
  dotMm: number;
}

export type LaidCanvasContent =
  | { kind: 'text'; lines: TextLine[]; align: TextAlign; valign: VerticalAlign; inverse: boolean }
  | { kind: 'barcode'; element: CanvasBarcode; value: string }
  | { kind: 'qr'; element: CanvasQr; value: string }
  | { kind: 'image'; element: CanvasImage }
  | { kind: 'line'; dashed: boolean }
  | { kind: 'rect'; borderMm: number; filled: boolean; radiusMm: number }
  | {
      kind: 'table';
      /** 行高、列宽（mm），取整到打印点，加起来正好是框的高、宽。 */
      rows: number[];
      columns: number[];
      borderMm: number;
      cells: { lines: TextLine[]; align: TextAlign }[][];
    };

export interface LaidCanvasElement {
  /** 元素在纸上占的框（转过之后），取整到打印点。 */
  rect: Rect;
  /** 没转之前的内容框：转 90° / 270° 时宽高对调。 */
  frame: { width: number; height: number };
  rotation: Rotation;
  name: string;
  content: LaidCanvasContent;
}

export interface CanvasLayout {
  elements: LaidCanvasElement[];
  /** 打印前检查：给人看的中文，每条指出是哪个元素。 */
  issues: string[];
  /** 文字缩到最小仍放不下、被截断的元素数。 */
  overflowCount: number;
}

/** 表格每格的内边距沿用面单的格子。 */
const TABLE_CELL_PADDING_MM = CELL_PADDING_MM;

export function layoutCanvas(template: CanvasTemplate, context: CanvasLayoutContext): CanvasLayout {
  const issues: string[] = [];
  const elements: LaidCanvasElement[] = [];
  let overflowCount = 0;
  for (const element of template.elements) {
    const rect = snapRect(element, context.dotMm);
    const turned = element.rotation === 90 || element.rotation === 270;
    const frame = turned ? { width: rect.height, height: rect.width } : { width: rect.width, height: rect.height };
    const laid = layoutContent(element, frame, context);
    if (laid.overflow) {
      overflowCount += 1;
      issues.push(`文字「${element.name}」放不下，已截断：加大文字框或调小字号`);
    }
    if (laid.issue !== null) {
      issues.push(laid.issue);
    }
    if (laid.content === null) {
      continue;
    }
    if (isNearEdge(rect, template.paper.widthMm, template.paper.heightMm)) {
      issues.push(`「${element.name}」靠近纸边（离纸边不到 ${CANVAS_LIMITS.safeMarginMm}mm），可能打不全`);
    }
    elements.push({ rect, frame, rotation: element.rotation, name: element.name, content: laid.content });
  }
  return { elements, issues, overflowCount };
}

/** 四条边各自取整到最近的点，宽高是取整后的差（至少 1 个点）：相邻元素的边对得上。 */
function snapRect(element: CanvasElement, dot: number): Rect {
  const left = Math.round(element.x / dot);
  const top = Math.round(element.y / dot);
  const right = Math.max(left + 1, Math.round((element.x + element.width) / dot));
  const bottom = Math.max(top + 1, Math.round((element.y + element.height) / dot));
  return { x: left * dot, y: top * dot, width: (right - left) * dot, height: (bottom - top) * dot };
}

function isNearEdge(rect: Rect, paperWidth: number, paperHeight: number): boolean {
  const margin = CANVAS_LIMITS.safeMarginMm - FLOAT_EPSILON;
  return (
    rect.x < margin ||
    rect.y < margin ||
    rect.x + rect.width > paperWidth - margin ||
    rect.y + rect.height > paperHeight - margin
  );
}

interface LaidResult {
  /** null = 这一张不印（内容是空的）。 */
  content: LaidCanvasContent | null;
  overflow: boolean;
  issue: string | null;
}

function layoutContent(
  element: CanvasElement,
  frame: { width: number; height: number },
  context: CanvasLayoutContext,
): LaidResult {
  switch (element.kind) {
    case 'text':
      return layoutText(element, frame, context);
    case 'barcode':
    case 'qr': {
      const value = expandVariables(element.value, context.scan, context.printedAt, (text) => text, 'empty').trim();
      if (value === '') {
        const label = element.kind === 'barcode' ? '条码' : '二维码';
        return { content: null, overflow: false, issue: `${label}「${element.name}」这一张没有内容，不印` };
      }
      return {
        content: element.kind === 'barcode' ? { kind: 'barcode', element, value } : { kind: 'qr', element, value },
        overflow: false,
        issue: null,
      };
    }
    case 'image':
      return { content: { kind: 'image', element }, overflow: false, issue: null };
    case 'line':
      return { content: { kind: 'line', dashed: element.dashed }, overflow: false, issue: null };
    case 'rect':
      return {
        content: { kind: 'rect', borderMm: element.borderMm, filled: element.filled, radiusMm: element.radiusMm },
        overflow: false,
        issue: null,
      };
    case 'table':
      return layoutTable(element, frame, context);
  }
}

function layoutText(element: CanvasText, frame: { width: number; height: number }, context: CanvasLayoutContext): LaidResult {
  const paragraphs = element.text
    .split('\n')
    .map((line) => expandParagraph(line, context))
    .filter((line): line is string => line !== null && line.trim() !== '')
    .map((line) => ({ text: line, fontSizeMm: element.fontSizeMm, bold: element.bold, wrap: element.fit === 'wrap' }));
  if (paragraphs.length === 0) {
    return { content: null, overflow: false, issue: null };
  }
  const fitted = fitParagraphs(paragraphs, frame.width, frame.height);
  return {
    content: {
      kind: 'text',
      lines: fitted.lines,
      align: element.align,
      valign: element.valign,
      inverse: element.inverse,
    },
    overflow: fitted.overflow,
    issue: null,
  };
}

function layoutTable(element: CanvasTable, frame: { width: number; height: number }, context: CanvasLayoutContext): LaidResult {
  const rows = snapSizes(resolveSizes(element.rowsMm, frame.height), frame.height, context.dotMm);
  const columns = snapSizes(resolveSizes(element.columnsMm, frame.width), frame.width, context.dotMm);
  let overflow = false;
  const cells = rows.map((rowHeight, row) =>
    columns.map((columnWidth, column) => {
      const cell = element.cells[row]?.[column];
      const text = cell
        ? expandVariables(cell.text, context.scan, context.printedAt, (value) => value, 'empty').trim()
        : '';
      if (!cell || text === '') {
        return { lines: [], align: cell?.align ?? 'left' };
      }
      const fitted = fitParagraphs(
        [{ text, fontSizeMm: cell.fontSizeMm, bold: cell.bold, wrap: true }],
        columnWidth - 2 * TABLE_CELL_PADDING_MM.x,
        rowHeight - 2 * TABLE_CELL_PADDING_MM.y,
      );
      overflow ||= fitted.overflow;
      return { lines: fitted.lines, align: cell.align };
    }),
  );
  return {
    content: { kind: 'table', rows, columns, borderMm: element.borderMm, cells },
    overflow,
    issue: null,
  };
}

/** 累计后取整到点：每条格线都落在点上，总和正好等于框的大小。 */
function snapSizes(sizes: readonly number[], totalMm: number, dot: number): number[] {
  const snapped: number[] = [];
  let previous = 0;
  let sum = 0;
  sizes.forEach((size, index) => {
    sum += size;
    const edge = index === sizes.length - 1 ? totalMm : Math.round(sum / dot) * dot;
    snapped.push(edge - previous);
    previous = edge;
  });
  return snapped;
}
```

（`fitParagraphs` 的宽高这里直接用框的宽高：文字框没有内边距，用户摆的框就是字的范围。表格格子有内边距，和面单一致。）

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/core/templates/canvas-layout.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/templates/canvas-layout.ts src/core/templates/canvas-layout.test.ts
git commit -m "feat(templates): lay out canvas templates on printer dots" -m "Snap every element to whole printer dots, fill variables (lines whose fields are all missing are left out), fit text with the waybill text fitter, split tables into dot-aligned cells, and list pre-print checks: text that had to be cut, empty barcodes and elements too close to the paper edge." -m "<trailer>"
```

---

### Task 9: 自由设计模板的 HTML

**Files:**
- Create: `src/main/printing/canvas-html.ts`
- Create: `src/main/printing/canvas-html.test.ts`
- Modify: `src/main/printing/label-html.ts`（分派，删掉 Task 5 的临时分支）

- [ ] **Step 1: 写测试**

```ts
// src/main/printing/canvas-html.test.ts
import { describe, expect, test } from 'bun:test';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from '../../core/templates/canvas-model';
import { renderCanvasHtml } from './canvas-html';
import { renderLabelHtml } from './label-html';

const PAPER = { widthMm: 60, heightMm: 40 };
const PRINTED_AT = new Date(2026, 9, 1, 9, 5).getTime();
const SCAN = {
  raw: '6901234567892',
  ruleId: 'builtin:raw',
  ruleName: '原样打印',
  fields: [
    { name: '商品码', value: '6901234567892' },
    { name: '品名', value: '<棉T恤>' },
  ],
};

function render(elements: CanvasElement[], dpi = 203) {
  const template: CanvasTemplate = { kind: 'canvas', id: 'custom:c', name: 'c', paper: PAPER, printer: null, elements };
  return renderCanvasHtml({ scan: SCAN, template, printedAt: PRINTED_AT }, dpi);
}

function element<K extends CanvasElement['kind']>(kind: K, overrides: object = {}): CanvasElement {
  return { ...newCanvasElement(kind, `${kind}1`, PAPER), x: 5, y: 5, ...overrides } as CanvasElement;
}

describe('renderCanvasHtml', () => {
  test('sets the page to the template paper', () => {
    expect(render([]).html).toContain('@page { size: 60mm 40mm; margin: 0; }');
  });

  test('escapes text from the scan', () => {
    const { html } = render([element('text', { text: '{品名}' })]);
    expect(html).toContain('&lt;棉T恤&gt;');
    expect(html).not.toContain('<棉T恤>');
  });

  test('draws an EAN-13 barcode with its number underneath', () => {
    const { html, issues } = render([
      element('barcode', { symbology: 'ean13', value: '{商品码}', width: 40, height: 15 }),
    ]);
    expect(issues).toEqual([]);
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('>6901234567892</div>');
  });

  test('leaves out a barcode whose content does not fit the symbology and says why', () => {
    const { html, issues, barcodeOmitted } = render([
      element('barcode', { name: '商品码', symbology: 'ean13', value: '{品名}' }),
    ]);
    expect(barcodeOmitted).toBe(true);
    expect(issues[0]).toStartWith('条码「商品码」');
    expect(html).not.toContain('crispEdges');
  });

  test('turns an element by 90 degrees around whole dots', () => {
    const { html } = render([element('text', { text: 'A', width: 5, height: 20, rotation: 90 })]);
    expect(html).toMatch(/transform:translate\([\d.]+mm,0mm\) rotate\(90deg\)/);
  });

  test('draws an image as a 1-bit bitmap, one pixel per printer dot', () => {
    // 2×1：左黑右白。
    const { html } = render([element('image', { pixels: 'AP8=', pixelWidth: 2, pixelHeight: 1, width: 10, height: 5 })]);
    expect(html).toContain('src="data:image/bmp;base64,');
    expect(html).toContain('image-rendering:pixelated');
  });

  test('draws a filled rectangle and a dashed line', () => {
    const { html } = render([
      element('rect', { filled: true }),
      element('line', { dashed: true, width: 30, height: 0.25 }),
    ]);
    expect(html).toContain('background:#000');
    expect(html).toContain('repeating-linear-gradient(90deg');
  });

  test('is what renderLabelHtml returns for a canvas template', () => {
    const template: CanvasTemplate = {
      kind: 'canvas',
      id: 'custom:c',
      name: 'c',
      paper: PAPER,
      printer: null,
      elements: [element('text', { text: 'A' })],
    };
    const job = { scan: SCAN, template, printedAt: PRINTED_AT };
    expect(renderLabelHtml(job, 300)).toEqual(renderCanvasHtml(job, 300));
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/canvas-html.test.ts`
Expected: FAIL，`Cannot find module './canvas-html'`。

- [ ] **Step 3: 实现**

```ts
// src/main/printing/canvas-html.ts
import type { CanvasBarcode, CanvasImage, CanvasQr, CanvasTemplate } from '../../core/templates/canvas-model';
import { type LaidCanvasContent, type LaidCanvasElement, layoutCanvas } from '../../core/templates/canvas-layout';
import { decodeGray, fitContain, monoBmp, resizeGray, toMono } from '../../core/templates/mono-image';
import { LINE_HEIGHT } from '../../core/templates/text-fit';
import { CELL_PADDING_MM } from '../../core/templates/waybill-layout';
import type { LabelJob } from '../../core/types';
import type { RenderWarnings } from '../../shared/render-warnings';
import {
  CANVAS_MAX_MODULE_MM,
  encodeBarcode,
  linearBarsPath,
  MIN_BAR_HEIGHT_MM,
  matrixPath,
  matrixQuietZone,
  moduleDotsFor,
  QUIET_ZONE_MODULES,
} from './barcode';
import { escapeHtml, mm } from './html-text';
import { DEFAULT_PRINTER_DPI, dotMm, planQr } from './qr-code';

/** 号码和条码之间的空隙（mm），和面单一致。 */
const BARCODE_TEXT_GAP_MM = 0.4;
/** 虚线：一段 1.2mm、空 0.8mm，和面单一致。 */
const DASH_MM = 1.2;
const DASH_GAP_MM = 0.8;

export interface RenderedCanvas extends RenderWarnings {
  html: string;
}

interface Findings {
  barcodeOmitted: boolean;
  qrOmitted: boolean;
  issues: string[];
}

/**
 * 自由设计模板 → HTML：每个元素一个绝对定位的框（取整到打印点），转角度时内容框用整点的平移 + 直角旋转，
 * 条码、二维码、图片按打印点画成 SVG。预览和打印共用这一份（打印窗口不运行脚本）。
 */
export function renderCanvasHtml(
  job: LabelJob & { template: CanvasTemplate },
  dpi: number = DEFAULT_PRINTER_DPI,
): RenderedCanvas {
  const { template } = job;
  const dot = dotMm(dpi);
  const layout = layoutCanvas(template, { scan: job.scan, printedAt: new Date(job.printedAt), dotMm: dot });
  const findings: Findings = { barcodeOmitted: false, qrOmitted: false, issues: [...layout.issues] };
  const body = layout.elements.map((element) => elementHtml(element, dot, dpi, findings)).join('');
  const { widthMm, heightMm } = template.paper;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(job.scan.raw)}</title>
<style>
  @page { size: ${mm(widthMm)} ${mm(heightMm)}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${mm(widthMm)}; height: ${mm(heightMm)}; overflow: hidden; background: #fff; color: #000; }
  body { position: relative; font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif; }
  .el { position: absolute; }
  .frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
  .text { display: flex; flex-direction: column; height: 100%; }
  .text--middle { justify-content: center; }
  .text--top { justify-content: flex-start; }
  .line { white-space: pre; overflow: hidden; line-height: ${LINE_HEIGHT}; }
  .code { position: absolute; }
  .code svg { display: block; }
  .dots { position: absolute; display: block; }
  .code__text { white-space: pre; line-height: ${LINE_HEIGHT}; font-weight: 700; text-align: center; }
</style>
</head>
<body>${body}</body>
</html>`;
  return {
    html,
    qrOmitted: findings.qrOmitted,
    barcodeOmitted: findings.barcodeOmitted,
    overflowCells: layout.overflowCount,
    issues: findings.issues,
  };
}

function elementHtml(element: LaidCanvasElement, dot: number, dpi: number, findings: Findings): string {
  const inner = contentHtml(element, dot, dpi, findings);
  if (inner === '') {
    return '';
  }
  const { rect, frame } = element;
  return `<div class="el" style="left:${mm(rect.x)};top:${mm(rect.y)};width:${mm(rect.width)};height:${mm(rect.height)}"><div class="frame" style="width:${mm(frame.width)};height:${mm(frame.height)}${rotationCss(element)}">${inner}</div></div>`;
}

/**
 * 直角旋转：内容框先绕左上角转，再平移回元素的框里。平移量是元素框的宽或高（都是整数个点），
 * 转完的每条边仍在打印点上；绕中心转的话，奇数个点的框会落在半个点上。
 */
function rotationCss({ rotation, rect }: LaidCanvasElement): string {
  switch (rotation) {
    case 0:
      return '';
    case 90:
      return `;transform:translate(${mm(rect.width)},0mm) rotate(90deg)`;
    case 180:
      return `;transform:translate(${mm(rect.width)},${mm(rect.height)}) rotate(180deg)`;
    case 270:
      return `;transform:translate(0mm,${mm(rect.height)}) rotate(270deg)`;
  }
}

function contentHtml(element: LaidCanvasElement, dot: number, dpi: number, findings: Findings): string {
  const { content, frame, name } = element;
  switch (content.kind) {
    case 'text':
      return textHtml(content);
    case 'barcode':
      return barcodeHtml(content.element, content.value, frame, dot, name, findings);
    case 'qr':
      return qrHtml(content.element, content.value, frame, dot, dpi, findings);
    case 'image':
      return imageHtml(content.element, frame, dot, findings);
    case 'line':
      return lineHtml(content.dashed, frame);
    case 'rect':
      return rectHtml(content, dot);
    case 'table':
      return tableHtml(content, frame, dot);
  }
}

function linesHtml(lines: readonly { text: string; fontSizeMm: number; bold: boolean }[]): string {
  return lines
    .map(
      (line) =>
        `<div class="line" style="font-size:${mm(line.fontSizeMm)};font-weight:${line.bold ? 700 : 400}">${escapeHtml(line.text)}</div>`,
    )
    .join('');
}

function textHtml(content: Extract<LaidCanvasContent, { kind: 'text' }>): string {
  const colors = content.inverse ? ';background:#000;color:#fff' : '';
  return `<div class="text text--${content.valign}" style="text-align:${content.align}${colors}">${linesHtml(content.lines)}</div>`;
}

function barcodeHtml(
  element: CanvasBarcode,
  value: string,
  frame: { width: number; height: number },
  dot: number,
  name: string,
  findings: Findings,
): string {
  const omit = (reason: string) => {
    findings.barcodeOmitted = true;
    findings.issues.push(`条码「${name}」${reason}，这张不印条码`);
    return '';
  };
  const result = encodeBarcode(element.symbology, value);
  if (!result.ok) {
    return omit(`：${result.reason}`);
  }
  const widthDots = Math.round(frame.width / dot);
  const heightDots = Math.round(frame.height / dot);
  if (result.code.dimensions === 2) {
    const { cells, columns, rows, rowScale } = result.code;
    const quiet = matrixQuietZone(element.symbology);
    const across = moduleDotsFor(widthDots, columns + 2 * quiet, dot, CANVAS_MAX_MODULE_MM);
    const down = moduleDotsFor(heightDots, rows * rowScale + 2 * quiet, dot, CANVAS_MAX_MODULE_MM);
    if (across === null || down === null) {
      return omit('放不下（框太小）');
    }
    const moduleDots = Math.min(across, down);
    const width = columns * moduleDots;
    const height = rows * rowScale * moduleDots;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${rows * rowScale}" shape-rendering="crispEdges" style="width:${mm(width * dot)};height:${mm(height * dot)}"><path d="${matrixPath(cells, columns, rows, rowScale)}"/></svg>`;
    return `<div class="code" style="left:${mm(Math.floor((widthDots - width) / 2) * dot)};top:${mm(Math.floor((heightDots - height) / 2) * dot)}">${svg}</div>`;
  }
  const { widths, heights, offsets } = result.code;
  const modules = widths.reduce((sum, width) => sum + width, 0);
  const moduleDots = moduleDotsFor(widthDots, modules + 2 * QUIET_ZONE_MODULES, dot, CANVAS_MAX_MODULE_MM);
  if (moduleDots === null) {
    return omit('放不下（框不够宽）');
  }
  const textBlockMm = element.showText ? element.textSizeMm * LINE_HEIGHT + BARCODE_TEXT_GAP_MM : 0;
  const barHeightMm = frame.height - textBlockMm;
  if (barHeightMm < MIN_BAR_HEIGHT_MM) {
    return omit(`太矮（条高不到 ${MIN_BAR_HEIGHT_MM}mm）`);
  }
  const barsDots = modules * moduleDots;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules} 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="width:${mm(barsDots * dot)};height:${mm(barHeightMm)}"><path d="${linearBarsPath(widths, false, heights, offsets)}"/></svg>`;
  const text = element.showText
    ? `<div class="code__text" style="font-size:${mm(element.textSizeMm)};margin-top:${mm(BARCODE_TEXT_GAP_MM)}">${escapeHtml(value)}</div>`
    : '';
  // 起点落在整数个点上（见面单 barcodeSvg 的说明）；号码在条码下方居中。
  return `<div class="code" style="left:${mm(Math.floor((widthDots - barsDots) / 2) * dot)};top:0;width:${mm(barsDots * dot)}">${svg}${text}</div>`;
}

function qrHtml(
  element: CanvasQr,
  value: string,
  frame: { width: number; height: number },
  dot: number,
  dpi: number,
  findings: Findings,
): string {
  const plan = planQr(value, element.errorCorrection, Math.min(frame.width, frame.height), dpi);
  if (plan === null) {
    findings.qrOmitted = true;
    findings.issues.push(`二维码「${element.name}」内容太长、框太小，这张不印二维码`);
    return '';
  }
  const sizeDots = plan.moduleCount * plan.moduleDots;
  const left = Math.floor((Math.round(frame.width / dot) - sizeDots) / 2) * dot;
  const top = Math.floor((Math.round(frame.height / dot) - sizeDots) / 2) * dot;
  return `<div class="code" style="left:${mm(left)};top:${mm(top)};width:${mm(plan.sizeMm)};height:${mm(plan.sizeMm)}">${plan.svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
}

function imageHtml(element: CanvasImage, frame: { width: number; height: number }, dot: number, findings: Findings): string {
  const gray = decodeGray(element.pixels, element.pixelWidth, element.pixelHeight);
  if (gray === null) {
    findings.issues.push(`图片「${element.name}」的数据坏了，这张不印这张图`);
    return '';
  }
  const box = fitContain(gray.width, gray.height, Math.round(frame.width / dot), Math.round(frame.height / dot));
  const mono = toMono(resizeGray(gray, box.width, box.height), element.mode, element.threshold);
  const left = Math.floor((Math.round(frame.width / dot) - box.width) / 2) * dot;
  const top = Math.floor((Math.round(frame.height / dot) - box.height) / 2) * dot;
  // 1 位 BMP：大小有上限（约 宽×高/8 字节），抖动的照片画成 SVG 路径会到几 MB。每个像素正好一个打印点，pixelated 不做插值。
  return `<img class="dots" alt="" src="data:image/bmp;base64,${monoBmp(mono, box.width, box.height)}" style="left:${mm(left)};top:${mm(top)};width:${mm(box.width * dot)};height:${mm(box.height * dot)};image-rendering:pixelated" />`;
}

function lineHtml(dashed: boolean, frame: { width: number; height: number }): string {
  const horizontal = frame.width >= frame.height;
  const fill = dashed
    ? `repeating-linear-gradient(${horizontal ? 90 : 180}deg, #000 0 ${mm(DASH_MM)}, transparent ${mm(DASH_MM)} ${mm(DASH_MM + DASH_GAP_MM)})`
    : '#000';
  return `<div style="width:100%;height:100%;background:${fill}"></div>`;
}

/** 边框粗细取整到点（至少 1 个点）：不取整的话细边框会时有时无。 */
function snapBorder(borderMm: number, dot: number): number {
  return borderMm <= 0 ? 0 : Math.max(1, Math.round(borderMm / dot)) * dot;
}

function rectHtml(content: Extract<LaidCanvasContent, { kind: 'rect' }>, dot: number): string {
  const border = snapBorder(content.borderMm, dot);
  const style = [
    'width:100%',
    'height:100%',
    border > 0 ? `border:${mm(border)} solid #000` : '',
    content.filled ? 'background:#000' : '',
    content.radiusMm > 0 ? `border-radius:${mm(content.radiusMm)}` : '',
  ]
    .filter((part) => part !== '')
    .join(';');
  return `<div style="${style}"></div>`;
}

function tableHtml(content: Extract<LaidCanvasContent, { kind: 'table' }>, frame: { width: number; height: number }, dot: number): string {
  const border = snapBorder(content.borderMm, dot);
  const parts: string[] = [];
  let top = 0;
  content.rows.forEach((rowHeight, row) => {
    let left = 0;
    content.columns.forEach((columnWidth, column) => {
      const cell = content.cells[row]?.[column];
      if (cell && cell.lines.length > 0) {
        parts.push(
          `<div class="text text--middle" style="position:absolute;left:${mm(left + CELL_PADDING_MM.x)};top:${mm(top + CELL_PADDING_MM.y)};width:${mm(columnWidth - 2 * CELL_PADDING_MM.x)};height:${mm(rowHeight - 2 * CELL_PADDING_MM.y)};text-align:${cell.align}">${linesHtml(cell.lines)}</div>`,
        );
      }
      left += columnWidth;
    });
    top += rowHeight;
  });
  if (border > 0) {
    // 外框画在框内侧；内部格线以格子边界为中心，和面单的线一样。
    parts.push(`<div style="position:absolute;inset:0;border:${mm(border)} solid #000"></div>`);
    const half = Math.floor(border / dot / 2) * dot;
    let y = 0;
    for (const rowHeight of content.rows.slice(0, -1)) {
      y += rowHeight;
      parts.push(`<div style="position:absolute;left:0;top:${mm(y - half)};width:${mm(frame.width)};height:${mm(border)};background:#000"></div>`);
    }
    let x = 0;
    for (const columnWidth of content.columns.slice(0, -1)) {
      x += columnWidth;
      parts.push(`<div style="position:absolute;left:${mm(x - half)};top:0;width:${mm(border)};height:${mm(frame.height)};background:#000"></div>`);
    }
  }
  return parts.join('');
}
```

`label-html.ts`：Task 5 的临时分支换成

```ts
  if (template.kind === 'canvas') {
    return renderCanvasHtml({ ...job, template }, dpi);
  }
```

并 `import { renderCanvasHtml } from './canvas-html';`。

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/main/printing`
Expected: PASS。若 `toStartWith` 在 bun 里不可用，改成 `expect(issues[0]?.startsWith('条码「商品码」')).toBe(true)`。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/printing/canvas-html.ts src/main/printing/canvas-html.test.ts src/main/printing/label-html.ts
git commit -m "feat(print): render canvas templates to HTML" -m "Each element is an absolutely placed box on whole printer dots. Right-angle turns rotate the content around a corner and translate it back by whole dots, so edges stay on dots. Barcodes, QR codes and images are drawn as dot-aligned SVG; problems are listed per element instead of printing something unreadable." -m "<trailer>"
```

---

### Task 10: 内置示例模板、字段清单、打印机页

**Files:**
- Create: `src/core/templates/builtin-canvas.ts`
- Modify: `src/core/templates/builtin-templates.ts`（列表加示例）
- Modify: `src/core/api/template-fields.ts`（删掉 Task 5 的临时分支，写真实现）
- Modify: `src/core/api/template-fields.test.ts`
- Modify: `src/renderer/src/lib/printer-assignment.ts:38`
- Modify: `src/renderer/src/lib/printer-assignment.test.ts`
- Create: `src/main/printing/__snapshots__/canvas-html.snapshot.test.ts` 的快照（由测试生成）
- Create: `src/main/printing/canvas-html.snapshot.test.ts`

- [ ] **Step 1: 写测试**

`template-fields.test.ts` 末尾加：

```ts
  test('lists the variables a canvas template uses, in order and without duplicates', () => {
    expect(templateFields(CANVAS_TAG)).toEqual({ mode: 'PICKED', names: ['编码', '颜色', '尺码', '货架号'] });
  });
```

（文件头 `import { CANVAS_TAG } from '../templates/builtin-canvas';`）

`printer-assignment.test.ts` 的 `describe('optional templates', ...)` 里加：

```ts
  test('treats an unused built-in canvas template as optional', () => {
    expect(templateUses([CANVAS_TAG], null, [])[0]?.optional).toBe(true);
    expect(templateUses([CANVAS_TAG], CANVAS_TAG.id, [])[0]?.optional).toBe(false);
  });
```

（import `CANVAS_TAG` from `'../../../core/templates/builtin-canvas'`。）

新建快照测试：

```ts
// src/main/printing/canvas-html.snapshot.test.ts
import { describe, expect, test } from 'bun:test';
import { BUILT_IN_CANVAS_TEMPLATES } from '../../core/templates/builtin-canvas';
import { renderCanvasHtml } from './canvas-html';

const SCAN = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
    { name: '货架号', value: 'A-1-2-3' },
  ],
};
// 用本地时间：{日期} 按本地时区显示（和标签快照一样的理由）。
const PRINTED_AT = new Date(2026, 9, 1, 9, 5).getTime();

describe('built-in canvas template HTML stays the same', () => {
  for (const template of BUILT_IN_CANVAS_TEMPLATES) {
    test(template.name, () => {
      const rendered = renderCanvasHtml({ scan: SCAN, template, printedAt: PRINTED_AT });
      expect(rendered.issues).toEqual([]);
      expect(rendered.html).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/api/template-fields.test.ts src/renderer/src/lib/printer-assignment.test.ts src/main/printing/canvas-html.snapshot.test.ts`
Expected: FAIL，`Cannot find module '../templates/builtin-canvas'`。

- [ ] **Step 3: 实现示例模板**

```ts
// src/core/templates/builtin-canvas.ts
import { DEFAULT_PAPER } from '../../shared/label-paper';
import type { CanvasElementBase, CanvasTemplate } from './canvas-model';
import { BUILT_IN_TEMPLATE_PREFIX } from './template-model';

/**
 * 内置的自由设计模板（只读，复制后修改）。这里只有一个示例，完整的模板库是子项目 2。
 * 坐标都在 1.5mm 安全区内（打印前检查不报问题，快照测试把关）。
 */

function box(id: string, name: string, x: number, y: number, width: number, height: number): CanvasElementBase {
  return { id, name, x, y, width, height, rotation: 0, locked: false };
}

/** 吊牌示例 60×40：编码大字、颜色尺码表格、Code128、二维码、分隔线、货架号和日期。 */
export const CANVAS_TAG: CanvasTemplate = {
  kind: 'canvas',
  id: `${BUILT_IN_TEMPLATE_PREFIX}canvas-tag`,
  name: '吊牌（自由设计示例）',
  paper: { ...DEFAULT_PAPER },
  printer: null,
  elements: [
    {
      ...box('code', '编码', 2, 2, 38, 7),
      kind: 'text',
      text: '{编码}',
      fontSizeMm: 5,
      bold: true,
      align: 'left',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    },
    { ...box('qr', '二维码', 44, 2, 14, 14), kind: 'qr', value: '{完整内容}', errorCorrection: 'M' },
    {
      ...box('spec', '颜色尺码', 2, 10, 38, 10),
      kind: 'table',
      rowsMm: [5, 0],
      columnsMm: [12, 0],
      borderMm: 0.25,
      cells: [
        [
          { text: '颜色', fontSizeMm: 2.8, bold: true, align: 'left' },
          { text: '{颜色}', fontSizeMm: 2.8, bold: false, align: 'left' },
        ],
        [
          { text: '尺码', fontSizeMm: 2.8, bold: true, align: 'left' },
          { text: '{尺码}', fontSizeMm: 2.8, bold: false, align: 'left' },
        ],
      ],
    },
    {
      ...box('barcode', '编码条码', 2, 21.5, 56, 12),
      kind: 'barcode',
      symbology: 'code128',
      value: '{编码}',
      showText: true,
      textSizeMm: 2.5,
    },
    { ...box('rule', '分隔线', 2, 34, 56, 0.25), kind: 'line', dashed: false },
    {
      ...box('shelf', '货架号', 2, 34.6, 36, 3.6),
      kind: 'text',
      text: '货架号 {货架号}',
      fontSizeMm: 2.6,
      bold: true,
      align: 'left',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    },
    {
      ...box('date', '日期', 40, 34.6, 18, 3.6),
      kind: 'text',
      text: '{日期}',
      fontSizeMm: 2.4,
      bold: false,
      align: 'right',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    },
  ],
};

export const BUILT_IN_CANVAS_TEMPLATES: readonly CanvasTemplate[] = [CANVAS_TAG];
```

`builtin-templates.ts`：`import { BUILT_IN_CANVAS_TEMPLATES } from './builtin-canvas';`，列表末尾 `...BUILT_IN_WAYBILLS,` 之后加 `...BUILT_IN_CANVAS_TEMPLATES,`。

- [ ] **Step 4: 字段清单**

`template-fields.ts`：Task 5 的临时分支换成

```ts
  if (template.kind === 'canvas') {
    return { mode: 'PICKED', names: withoutFixed(canvasVariables(template)) };
  }
```

文件末尾加：

```ts
/** 自由设计模板每个元素（文字、条码、二维码、表格每格）里用到的变量，按上下层顺序。 */
function canvasVariables(template: CanvasTemplate): string[] {
  const names: string[] = [];
  for (const element of template.elements) {
    switch (element.kind) {
      case 'text':
        names.push(...variableNames(element.text));
        break;
      case 'barcode':
      case 'qr':
        names.push(...variableNames(element.value));
        break;
      case 'table':
        for (const row of element.cells) {
          for (const cell of row) {
            names.push(...variableNames(cell.text));
          }
        }
        break;
      default:
        break;
    }
  }
  return names;
}
```

import `type CanvasTemplate` from `'../templates/canvas-model'`。示例模板的顺序：编码（文字）→ 完整内容（二维码，固定变量被去掉）→ 颜色、尺码（表格）→ 编码（条码，去重）→ 货架号 → 日期（固定）= `['编码', '颜色', '尺码', '货架号']`。

- [ ] **Step 5: 打印机页**

`printer-assignment.ts` 第 38 行 `template.kind === 'waybill' &&` 改成 `template.kind !== 'label' &&`，上面的注释改成「内置面单、内置自由设计模板人人都有，没设为当前模板、也没被规则指定时算『可选』」。

- [ ] **Step 6: 跑测试，生成快照并检查**

Run: `bun test src/core src/main src/renderer/src/lib`
Expected: PASS；新快照写入 `src/main/printing/__snapshots__/canvas-html.snapshot.test.ts.snap`。打开快照粗看：7 个元素都在（货架号这张有值），没有 `issues`。

另外两处会受影响，一并检查并修正：
- `src/core/templates/templates.test.ts` 的 `'are all valid and unchanged by sanitizing'` 现在覆盖示例模板：必须 PASS（示例模板的每一项都在合法范围内）。
- `e2e/printers.e2e.ts`、视觉验收 V35 的纸张行数：示例模板是 60×40，不新增纸张，行数不变。

- [ ] **Step 7: `bun run check` 后提交**

```bash
git add src/core/templates/builtin-canvas.ts src/core/templates/builtin-templates.ts src/core/api/template-fields.ts src/core/api/template-fields.test.ts src/renderer/src/lib/printer-assignment.ts src/renderer/src/lib/printer-assignment.test.ts src/main/printing/canvas-html.snapshot.test.ts src/main/printing/__snapshots__/canvas-html.snapshot.test.ts.snap
git commit -m "feat(templates): ship a built-in canvas tag and list its fields" -m "A sample tag (code, color and size table, Code 128, QR code, shelf number, date) so canvas templates can be tried and copied before the designer lands. The local API lists the variables a canvas template uses, and an unused built-in canvas template is optional on the printers page like the built-in waybills." -m "<trailer>"
```

---

### Task 11: 模板页支持自由设计模板（编辑器之前的过渡）

**Files:**
- Create: `src/renderer/src/components/CanvasBasics.tsx`
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx:219-235`

- [ ] **Step 1: 组件**

```tsx
// src/renderer/src/components/CanvasBasics.tsx
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import { type PrinterChoices, TemplateBasics } from './TemplateBasics';

interface CanvasBasicsProps extends PrinterChoices {
  draft: CanvasTemplate;
  onChange: (draft: CanvasTemplate) => void;
}

/** 自由设计模板在设计器做好之前：能改名称、纸张、打印机，元素先用内置示例里的。 */
export function CanvasBasics({ draft, onChange, printers, paperPrinters }: CanvasBasicsProps) {
  return (
    <>
      <TemplateBasics draft={draft} onChange={onChange} printers={printers} paperPrinters={paperPrinters} />
      <p className="form-hint">
        自由设计模板的设计器（拖放元素、对齐、条码、图片、表格）在下一步提供；现在可以预览、打印和改纸张。
      </p>
    </>
  );
}
```

（`PrinterChoices` 是 `TemplateBasics.tsx` 导出的 `{ printers, paperPrinters }`，`TemplateEditor`、`WaybillEditor` 的 props 都继承它。）

- [ ] **Step 2: 分派**

`TemplatesPage.tsx` 的 `EditView` 里把 `draft.kind === 'label' ? (<TemplateEditor …/>) : (<WaybillEditor …/>)` 换成按 kind 三选一：

```tsx
        {draft.kind === 'label' ? (
          <TemplateEditor
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        ) : draft.kind === 'waybill' ? (
          <WaybillEditor
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        ) : (
          <CanvasBasics
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        )}
```

import `CanvasBasics`。

- [ ] **Step 3: `bun run check`**

Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/CanvasBasics.tsx src/renderer/src/components/config/pages/TemplatesPage.tsx
git commit -m "feat(renderer): open canvas templates on the templates page" -m "Until the designer lands, a canvas template can be renamed, moved to another paper and given a printer, and is previewed and printed like any template." -m "<trailer>"
```

---

### Task 12: E2E 和视觉验收

**Files:**
- Modify: `e2e/app.e2e.ts`
- Modify: `e2e/local-api.e2e.ts`
- Modify: `e2e/visual/acceptance.visual.ts`（新增 V44，表头说明改为 V01–V44）
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（验收表加 V44）

- [ ] **Step 1: E2E——模板页预览示例、复制后能改纸张**

在 `e2e/app.e2e.ts` 面单预览用例附近加：

```ts
// 自由设计模板：内置示例按扫码内容排版，复制后能改纸张（设计器在 1b）。
test('previews the built-in canvas tag and copies it', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
  const frame = page.frameLocator('.label-frame');
  await expect(frame.locator('.line', { hasText: 'CL5640-TK' }).first()).toBeVisible();
  await expect(frame.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(2);
  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.locator('.template-form').getByText('设计器')).toBeVisible();
});
```

- [ ] **Step 2: E2E——经本机接口按示例模板打印**

在 `e2e/local-api.e2e.ts` 的「prints a courier waybill with a built-in waybill template」用例之后加（`PRINTERS`、`apiBase`、`createKey`、`waitAllSent`、`fakePrints` 都是这个文件里已有的）：

```ts
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
```

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e`
Expected: 全部通过。

- [ ] **Step 4: 视觉验收 V44**

在 `e2e/visual/acceptance.visual.ts` 的 `waybillCase` 定义之后、`ITEMS` 列表里 V43 之后加一项（写法照 V39–V43）：

```ts
  {
    id: 'V44',
    title: '模板 · 自由设计 · 吊牌示例',
    points: '编码大字、颜色尺码表格（格线对齐、字在格内）、Code128 和号码、二维码、分隔线、货架号和日期都在纸内，没有被裁',
    setup: async ({ page }) => {
      await scan(page, 'CL5640-TK-图片色-XL');
      await openConfig(page, '模板');
      await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
    },
  },
```

文件头注释里的「V01–V43」改成「V01–V44」。设计文档 `2026-09-29-config-center-layout-design.md` 验收表 V43 之后加一行：

```
| V44 | 模板 · 自由设计 · 吊牌示例 | 编码大字、颜色尺码表格（格线对齐、字在格内）、Code128 和号码、二维码、分隔线、货架号和日期都在纸内，没有被裁 |
```

Run: `bunx playwright test --config e2e/visual/playwright.config.ts`
Expected: 44 项通过；打开 V44 的截图核对上面几点。

- [ ] **Step 5: 提交**

```bash
git add e2e/app.e2e.ts e2e/local-api.e2e.ts e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(e2e): preview, copy and print the built-in canvas tag" -m "<trailer>"
```

---

### Task 13: 文档

**Files:**
- Modify: `docs/local-api.md`（「模板」一节说明第三类）
- Modify: `src/core/CLAUDE.md`（`templates/` 一行加自由设计的文件）
- Modify: `src/main/CLAUDE.md`（打印一节加 `barcode.ts`、`canvas-html.ts`）
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3.2 节：「面单的 Code128 也改走它」改成「面单保留自己的 Code128 编码器，画法和限制共用 `barcode.ts`，输出逐字不变」

- [ ] **Step 1: 写**

`docs/local-api.md` 模板一节在 `fieldsMode` 说明后加一句：

```
- 模板分三类：标签（二维码 + 字段区）、面单（格子版式）、自由设计（元素版式，吊牌、价签、商品条码）。面单和自由设计的 `fieldsMode` 都是 `PICKED`，`fieldNames` 列出版面上用到的全部字段，按这个清单传字段即可。
```

`src/core/CLAUDE.md` 模块表 `templates/` 一行末尾加：

```
；自由设计模板：`canvas-model.ts`（元素、限制、码制清单）、`sanitize-canvas.ts`、`canvas-layout.ts`（取整到打印点、排文字、表格、打印前检查）、`mono-image.ts`（灰度 → 黑白点，纯 TS，不解码图片文件）、`builtin-canvas.ts`
```

`src/main/CLAUDE.md` 打印一节「面单」那条之后加：

```
- **条码** `barcode.ts`：编码交给 bwip-js（只取条空宽度或点阵），画法自己来：模块取整数个点、留静区、四态码各自的条高、PDF417 一行 3 个模块高；内容不合码制时给中文原因。面单的 Code128 用自己的编码器、共用这里的画法。
- **自由设计** `canvas-html.ts`：元素绝对定位在整点上，直角旋转绕左上角转再整点平移；条码、二维码、图片画成按点对齐的 SVG；问题逐个元素列进 `RenderWarnings.issues`。
```

- [ ] **Step 2: `bun run check` 后提交，推送，开 PR**

```bash
git add docs/local-api.md src/core/CLAUDE.md src/main/CLAUDE.md docs/superpowers/specs/2026-10-01-feature-parity-design.md
git commit -m "docs: describe canvas templates and the shared barcode module" -m "<trailer>"
git push -u origin feature/canvas-designer
gh pr create --base master --title "feat: canvas templates (designer 1a: model and rendering)" --body "<中文说明：做了什么、为什么、验证；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并（1b 在这之上继续）。

---

## Self-Review 记录

- **设计覆盖（第 3 节）**：模型 3.1 → Task 4、5；分层 3.2 → Task 4–9；所见即所打、编辑器 3.3 → 1b；打印前检查 3.4 → Task 8（截断、边距、空条码）、Task 9（条码不合码制 / 放不下 / 太矮、二维码放不下、图片坏了）；图片太大不保存 → Task 5（校验丢掉超预算的图片，1b 的编辑器在插入时提示）；3.5 和现有功能的关系 → Task 10（字段清单、打印机页）、Task 11（模板页）、Task 12（本机接口打印）。
- **没有占位**：Task 11 用 `TemplateBasics.tsx` 导出的 `PrinterChoices`；Task 12 的本机接口用例给出了完整代码。
- **类型一致**：`LaidCanvasElement`（Task 8）在 Task 9 用到的字段：`rect`、`frame`、`rotation`、`name`、`content`；`encodeBarcode` 返回 `{ ok, code | reason }`，`code.dimensions` 区分 1 / 2；`RenderWarnings.issues`（Task 3）在 Task 9 填写。
