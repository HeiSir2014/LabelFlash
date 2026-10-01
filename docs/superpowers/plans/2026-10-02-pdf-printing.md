# PDF 打印（子项目 4）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台标题栏加「打印 PDF」（把 PDF 拖进窗口也行），打开和配置中心、批量打印同级的全窗口页面：选 PDF → 自动识别裁切方式（整页 / 去白边 / 一页多张 / 手动框选，可改）→ 选纸张、转黑白方式（阈值 / 抖动）→ 全部块的缩略图网格（就是打出来的黑白点），可以删掉不要的、调整顺序、设份数 → 按顺序打印（暂停、继续、取消）。每张一条打印记录（来源「PDF」，记文件名、页码、第几张）；打印用的黑白位图在数据目录里留 7 天，打印记录能预览、重打；过期后说明原因。

**Architecture:** 按 Chromium 两条法则，PDF（不可信的输入）只在一个**隐藏的 sandbox 窗口**里用 `pdfjs-dist` 渲染：独立的内存会话（不和主窗口共用存储）、只开 JS、没有 Node、CSP `default-src 'none'`、会话层拦下一切对外请求，pdf.js 的 worker、字符映射、标准字体、解码器都从安装包里的 `app://bundle/` 读；它只经一个最小的 preload（收请求、回结果）和主进程说话，交回的是灰度像素，主进程按自己算出的尺寸逐字节核对（`shared/pdf-render-protocol.ts`、`main/pdf/pdf-render-host.ts`）。裁切、切分、旋转、缩放、转黑白都是 core 里的纯函数（`core/pdf/`），用合成的位图做单元测试。每一块转成按目标打印机打印点做好的黑白位图，存进缓存（`main/pdf/piece-cache.ts`），打印时包成一个只有一张图的**临时自由设计模板**（`core/pdf/piece-template.ts`），经 `PrintService.printFields`（来源 `pdf`）照常决定打印机、排队、写记录，渲染和打印完全复用 `canvas-html.ts` 的 1 位 BMP 画法（`image-rendering: pixelated`，一个像素一个打印点）。按顺序打印、暂停、打印机问题自动暂停直接复用批量打印的 `BatchRun`。打印记录追加迁移 7（`pdf_file`、`pdf_page`、`pdf_piece`、`pdf_bitmap` 四列，只加列，来源 `pdf` 已在迁移 6 里）。

**Tech Stack:** TypeScript、Bun test、Electron 主进程 + 隐藏的 sandbox 窗口、`pdfjs-dist`（新依赖，Apache-2.0）、React 19、Playwright E2E。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 2、6、9、10、11 节。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **分支**：批量打印（子项目 3，`docs/superpowers/plans/2026-10-02-batch-printing.md`）合进 master 之后，从 master 拉 `feature/pdf-printing`。本计划用到批量打印留下的：`BatchRun`（`core/batch/batch-runner.ts`）和 `BatchLabel`、`FieldsRule` / `BATCH_RULE` / `fieldsScan(content, fields, rule)`（`core/print-service.ts`）、`requireBytes`（`main/ipc-validators.ts`）、`MAX_FILE_NAME_LENGTH`（`main/ipc.ts`）、`useFileDrop`、`BATCH_VIEW` / `openBatch` / `'close-batch'`（`lib/app-view.ts`、`use-app-view.ts`）、标题栏的 `batch-button`、`.batch-page` 的样式、打印记录的 `batch` 列和 `JobLog` 里的批次按钮。
- **迁移**：协调决定迁移 6 一次加上 `batch`、`pdf`、`ipp`、`remote` 四个来源（Task 1 Step 1 核对）。本计划**不重建** jobs 表，只追加迁移 7 加四列。
- **视觉验收编号**：PDF 打印固定用 **V70–V72**，追加在 `ITEMS` 当时最后一项之后，不和设计器（V45+）、批量打印（V60–V62）抢编号。
- **用词**：界面上「已发送」，不说「打印成功」；页码、第几张都从 1 数；一块 = 打出来的一张标签。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `package.json`、`bun.lock` | 修改 | 加 `pdfjs-dist` |
| `src/core/pdf/pdf-model.ts` | 新建 | `PDF_LIMITS`、保留期、裁切方式、框和矩形、`PdfLayout`、`PdfPrintRequest`、块编号 |
| `src/core/pdf/mono-pack.ts` | 新建 | 黑白位图（每点一字节）↔ 缓存文件格式（每点一位）；黑白 → 灰度 |
| `src/core/templates/mono-image.ts` | 修改 | 加 `encodeGray`（`decodeGray` 的反过程） |
| `src/core/pdf/content-box.ts` | 新建 | 有墨的点、行列投影、内容外框 |
| `src/core/pdf/page-split.ts` | 新建 | 空白缝、等分位置的分割线、XY 切分、裁切方式自动识别、每种方式的矩形 |
| `src/core/pdf/piece-fit.ts` | 新建 | 打印点数、要不要转 90°、裁、转、等比放到纸上、转黑白、缩略图 |
| `src/core/pdf/piece-template.ts` | 新建 | 一块 → 临时自由设计模板；记录的内容和字段 |
| `src/core/pdf/parse-pdf-request.ts` | 新建 | 界面交来的裁切设置、打印设置的严格校验 |
| `src/core/pdf/testing/synthetic-page.ts` | 新建 | 测试用的合成页面（2×2 面单、虚线、外框） |
| `src/core/types.ts`、`src/core/print-service.ts`、`src/core/testing/in-memory-job-store.ts` | 修改 | `PdfRef`；`PDF_RULE`、`fieldsRuleFor`；PDF 打的不参与防重复恢复 |
| `src/main/storage/migrations.ts`、`sqlite-job-store.ts` | 修改 | 迁移 7；四列读写 |
| `src/shared/pdf-render-protocol.ts` | 新建 | 主进程 ↔ 渲染页的消息、回复核对、渲染缩放、RGBA → 灰度 |
| `src/shared/pdf.ts` | 新建 | IPC 用的 PDF 打印类型 |
| `src/main/pdf/piece-cache.ts` | 新建 | 黑白位图缓存：存、读、续期、删、按天数清理 |
| `src/main/pdf/pdf-render-host.ts` | 新建 | 请求 / 回复、超时、核对、渲染页崩溃 |
| `src/main/pdf/render-session-policy.ts` | 新建 | 渲染页的会话只许读 `app://bundle/` |
| `src/main/pdf/pdf-render-window.ts` | 新建 | 隐藏窗口、独立会话、只收这一页的消息（接线） |
| `src/main/pdf/pdf-station.ts` | 新建 | 读文件、识别、按设置出块、预览一块、按顺序打印、状态推送 |
| `src/preload/pdf-render.ts` | 新建 | 渲染页的 preload（只有收请求、回结果） |
| `src/renderer/pdf-render.html`、`src/renderer/src/pdf-render/main.ts` | 新建 | 隐藏的渲染页（pdf.js） |
| `scripts/pdfjs-assets.ts` | 新建 | 构建时把 pdf.js 的字符映射、字体、解码器原样放进产物（Vite 插件，不新增依赖） |
| `electron.vite.config.ts`、`src/main/app-protocol.ts` | 修改 | 第二个 preload、第二个页面；协议处理可以挂到别的会话 |
| `src/main/ipc-validators.ts`、`src/main/ipc.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/main/index.ts` | 修改 | 新通道、记录的预览和重打、接线、启动时清理缓存 |
| `src/renderer/src/lib/pdf-view.ts` | 新建 | PDF 页的纯逻辑（纸张选项、框、顺序、文字） |
| `src/renderer/src/lib/app-view.ts`、`scan-routing.ts`、`reprint.ts`、`status-text.ts` | 修改 | 视图 `pdf`；记录的 PDF 位置；过期 |
| `src/renderer/src/view-models/use-pdf.ts`、`use-app-view.ts` | 新建 / 修改 | 页面状态、打开 PDF 页 |
| `src/renderer/src/components/pdf/PdfPage.tsx`、`PdfSetup.tsx`、`PdfBoxEditor.tsx`、`PdfPieces.tsx` | 新建 | 页面 |
| `src/renderer/src/components/TitleBar.tsx`、`JobLog.tsx`、`App.tsx`、`styles/app.css` | 修改 | 入口、拖文件分流、过期提示、样式 |
| `e2e/support/pdf-files.ts`、`e2e/pdf.e2e.ts` | 新建 | 用 printToPDF 生成 2×2 面单 PDF；E2E |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V70–V72 |
| `README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`、设计文档第 6 节、`docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md`、`CLAUDE.md`、`src/*/CLAUDE.md` | 修改 | 文档 |

---

### Task 1: 核对前提，加入 pdfjs-dist

**Files:**
- Modify: `package.json`（`dependencies`）、`bun.lock`

- [ ] **Step 1: 核对批量打印留下的前提**

Run（Git Bash）:

```bash
cd /d/project/LabelFlash && git switch master && git pull && git switch -c feature/pdf-printing
```

用 Grep 核对：

1. `src/main/storage/migrations.ts` 里第 6 条迁移的 `source` CHECK 含 `'pdf'`；`src/core/types.ts` 的 `PRINT_SOURCES` 含 `'pdf'`；`src/renderer/src/lib/status-text.ts` 的 `SOURCE_LABELS` 有 `pdf` 一项。
2. `src/core/batch/batch-runner.ts` 导出 `BatchRun`、`BatchProgress`；`src/core/batch/batch-model.ts` 导出 `BatchLabel`。
3. `src/core/print-service.ts` 导出 `BATCH_RULE`、`FieldsRule`，`fieldsScan` 有第三个参数 `rule`。
4. `src/main/ipc-validators.ts` 导出 `requireBytes`；`src/main/ipc.ts` 有 `MAX_FILE_NAME_LENGTH`。
5. `src/renderer/src/lib/app-view.ts` 有 `BATCH_VIEW` 和 `'close-batch'`；`src/renderer/src/view-models/use-file-drop.ts` 存在。

Expected: 全部都在。第 1 条缺 `'pdf'` 时**停下来**问协调者（不要再写一条重建 jobs 表的迁移）；`SOURCE_LABELS` 只缺 `pdf` 一项时在 Task 8 补 `pdf: 'PDF',`。

- [ ] **Step 2: 安装**

Run: `bun add pdfjs-dist`
Expected: `package.json` 的 `dependencies` 多一行 `"pdfjs-dist": "^x.y.z"`（写计划时 context7 上的最新版是 6.3.x），`bun.lock` 更新。

- [ ] **Step 3: 核对 API 和文件**（读 `node_modules/pdfjs-dist/package.json`、`types/src/display/api.d.ts`，Glob `node_modules/pdfjs-dist/{build,cmaps,standard_fonts,wasm}/*`）

逐项确认，后面的代码按这些写：

1. 主入口 `import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'` 可用；`build/pdf.worker.min.mjs` 存在（Task 11 用 `?url` 引它）。
2. `getDocument` 的参数里有 `data`、`cMapUrl`、`cMapPacked`、`standardFontDataUrl`、`wasmUrl`、`enableXfa`、`useSystemFonts`；**没有** `isEvalSupported`（新版已经去掉了用 `new Function` 画字体的路径，CSP 不需要 `unsafe-eval`）。如果还有 `isEvalSupported`，Task 11 的 `getDocument` 参数里加 `isEvalSupported: false`。
3. `RenderParameters`：Task 11 同时传 `canvas` 和 `canvasContext`。如果类型里没有 `canvas`（旧版），删掉这一项；如果 `canvasContext` 已被标成不再接受，删掉 `canvasContext`。
4. 目录 `cmaps/`（`.bcmap`）、`standard_fonts/`、`wasm/` 都在。没有 `wasm/` 时，Task 11 的 `PDFJS_ASSET_DIRS` 去掉 `'wasm'`、`getDocument` 去掉 `wasmUrl`，CSP 去掉 `'wasm-unsafe-eval'`。
5. `bun -e "console.log(require.resolve('pdfjs-dist/package.json'))"` 能打出路径（Task 11 的 `pdfjsPackageDir` 用它）。如果 `exports` 不许解析 `package.json`，`pdfjsPackageDir` 改为 `dirname(dirname(createRequire(import.meta.url).resolve('pdfjs-dist')))`。
6. 许可证是 Apache-2.0。

- [ ] **Step 4: bundle 自包含检查**

Run: `bun run build && bun run verify:bundle`
Expected: 通过（还没有代码用到 pdfjs-dist；它只会打进渲染进程的产物，主进程和 preload 不引用它）。

- [ ] **Step 5: 提交**

```bash
git add package.json bun.lock
git commit -m "build(deps): add pdfjs-dist for PDF printing" -m "PDF pages are rendered to bitmaps by pdf.js inside a hidden sandboxed window; it is only bundled into that renderer page, never into the main process or a preload." -m "$TRAILER"
```

---

### Task 2: PDF 的限制和类型；黑白位图的缓存格式

**Files:**
- Create: `src/core/pdf/pdf-model.ts`
- Create: `src/core/pdf/mono-pack.ts`、`src/core/pdf/mono-pack.test.ts`
- Modify: `src/core/templates/mono-image.ts`、`src/core/templates/mono-image.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/pdf/mono-pack.test.ts
import { describe, expect, test } from 'bun:test';
import { type MonoBitmap, monoToGray, packMono, unpackMono } from './mono-pack';

/** 10×3：宽度不是 8 的倍数，最后一个字节只用 2 位。 */
const BITMAP: MonoBitmap = {
  width: 10,
  height: 3,
  bits: Uint8Array.from([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    0, 1, 1, 0, 0, 0, 0, 0, 1, 0,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ]),
};

describe('mono pack', () => {
  test('packs one bit per dot and reads back the same dots', () => {
    const packed = packMono(BITMAP);
    // 12 字节头 + 每行 2 字节 × 3 行
    expect(packed).toHaveLength(12 + 2 * 3);
    expect(unpackMono(packed)).toEqual(BITMAP);
  });

  test('refuses files that are not ours or are cut short', () => {
    const packed = packMono(BITMAP);
    expect(unpackMono(packed.slice(0, packed.length - 1))).toBeNull();
    const wrongMagic = packed.slice();
    wrongMagic[0] = 0;
    expect(unpackMono(wrongMagic)).toBeNull();
    expect(unpackMono(new Uint8Array(4))).toBeNull();
  });

  test('refuses an empty or oversized bitmap header', () => {
    const empty = packMono({ width: 1, height: 1, bits: Uint8Array.of(1) });
    new DataView(empty.buffer).setUint32(4, 0, true);
    expect(unpackMono(empty)).toBeNull();
    const huge = packMono({ width: 1, height: 1, bits: Uint8Array.of(1) });
    new DataView(huge.buffer).setUint32(8, 100_000, true);
    expect(unpackMono(huge)).toBeNull();
  });

  test('reads a buffer that is a view into a larger array', () => {
    const packed = packMono(BITMAP);
    const larger = new Uint8Array(packed.length + 5);
    larger.set(packed, 5);
    expect(unpackMono(larger.subarray(5))).toEqual(BITMAP);
  });

  test('turns black dots into gray 0 and white dots into gray 255', () => {
    expect(monoToGray({ width: 2, height: 1, bits: Uint8Array.of(1, 0) })).toEqual({
      width: 2,
      height: 1,
      pixels: Uint8Array.of(0, 255),
    });
  });
});
```

`src/core/templates/mono-image.test.ts` 末尾加（import 里加 `encodeGray`）：

```ts
describe('encodeGray', () => {
  test('is the inverse of decodeGray', () => {
    const image = { width: 3, height: 2, pixels: Uint8Array.of(0, 64, 128, 192, 255, 7) };
    expect(decodeGray(encodeGray(image), 3, 2)).toEqual(image);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/pdf/mono-pack.test.ts src/core/templates/mono-image.test.ts`
Expected: FAIL，`Cannot find module './mono-pack'`、`encodeGray` 没有导出。

- [ ] **Step 3: 实现**

```ts
// src/core/pdf/pdf-model.ts
import type { ImageMode } from '../templates/canvas-model';

/**
 * PDF 打印：导入 PDF，把每页（或每页里的每一块）缩放到标签纸上、转黑白后照常打印。
 * 设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 6 节。
 */

export const PDF_LIMITS = {
  /** 50MB：平台导出的几百张面单的 PDF 也就几 MB；再大多半是扫描件，逐页渲染太慢。 */
  fileBytes: 50 * 1024 * 1024,
  /** 200 页：一次打一个班次的面单够用；更多拆成几个文件。 */
  pages: 200,
  /**
   * 一页渲染出的像素上限：1600 万（A4 在 400dpi 约 1550 万）。灰度一个像素一字节，一页经 IPC 传回最多 16MB；
   * 更大的页（海报）按比例降低渲染分辨率，不拒绝。
   */
  pagePixels: 16_000_000,
  /** 一次最多 1000 张：200 页 × 每页 4 张是 800，留余量；更多的不处理并说明。 */
  pieces: 1000,
  /** 手动框选最多 12 个框：一页 3×4 的小标签已经很密。 */
  manualBoxes: 12,
  /** 打印记录里文件名最多 100 个字：记录的内容是「文件名 第几页第几张」，太长的截断。 */
  fileNameChars: 100,
  /** 每张最多 99 份。 */
  copies: 99,
} as const;

/** 黑白位图在缓存里留 7 天：能从打印记录预览、重打；更久的 PDF 重新打开文件再打。 */
export const PDF_PIECE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 裁切方式：page = 整页缩放到纸上；trim = 去掉四周空白再缩放；split = 按空白或分割线切成几张；
 * manual = 在第一页上画框，每页按同样的位置裁。
 */
export const CROP_MODES = ['page', 'trim', 'split', 'manual'] as const;
export type CropMode = (typeof CROP_MODES)[number];

/** 页面上的一个框，按页面宽高的比例（0–1）记：页面大小不同时按比例套用。 */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 位图上的一个矩形（整数像素，左上角起）。 */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 怎么把 PDF 变成标签：界面交来，经 parsePdfLayout 校验。 */
export interface PdfLayout {
  /** 纸张键（例如 100x150）：按它决定打印机和分辨率。 */
  paperKey: string;
  crop: CropMode;
  /** 手动框选的框；crop 为 manual 时至少一个，其余方式忽略。 */
  boxes: NormalizedBox[];
  mono: ImageMode;
  /** 0–255：比它暗的算黑（抖动时作为基准）。 */
  threshold: number;
}

/** 打印设置：要打的块（按打印顺序，删掉的不在里面）和每张几份。 */
export interface PdfPrintRequest {
  /** 这一次出块的编号：预览变了（改了纸张、裁切）就对不上，拒绝打印旧的。 */
  runId: string;
  pieceIds: string[];
  copies: number;
}

/** 一块的编号：页码-第几张（都从 1 数），例如 2-1。 */
export function pieceId(page: number, piece: number): string {
  return `${page}-${piece}`;
}

/** 页码最多 3 位（200 页）、第几张最多 4 位（1000 张）。 */
export const PIECE_ID_PATTERN = /^[1-9]\d{0,2}-[1-9]\d{0,3}$/;
```

```ts
// src/core/pdf/mono-pack.ts
import type { GrayImage } from '../templates/mono-image';

/** 黑白位图：每个点一个字节，1 = 黑、0 = 白（和 mono-image.ts 的 toMono 输出一致）。 */
export interface MonoBitmap {
  width: number;
  height: number;
  bits: Uint8Array;
}

/** 缓存文件开头的标记 'LFM1'：认出是本程序写的黑白位图，版本变了换数字。 */
const MAGIC = [0x4c, 0x46, 0x4d, 0x31] as const;
/** 标记 4 字节 + 宽、高各 4 字节（小端）。 */
const HEADER_BYTES = 12;
const BITS_PER_BYTE = 8;
const HIGH_BIT = 0x80;
/** 边长上限（点）：纸最大 120×220mm，600dpi 也只有 5197 点；挡住被改坏的文件。 */
export const MAX_MONO_SIDE = 8192;

/** 黑白位图 → 缓存文件的字节：每行按位打包（高位在前），一张 100×150mm、203dpi 的面单约 120KB。 */
export function packMono({ width, height, bits }: MonoBitmap): Uint8Array {
  const rowBytes = Math.ceil(width / BITS_PER_BYTE);
  const bytes = new Uint8Array(HEADER_BYTES + rowBytes * height);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, width, true);
  view.setUint32(8, height, true);
  bits.forEach((bit, index) => {
    if (bit === 1) {
      const x = index % width;
      const y = Math.floor(index / width);
      const at = HEADER_BYTES + y * rowBytes + Math.floor(x / BITS_PER_BYTE);
      bytes[at] = (bytes[at] ?? 0) | (HIGH_BIT >> x % BITS_PER_BYTE);
    }
  });
  return bytes;
}

/** 缓存文件的字节 → 黑白位图；不是本程序写的、尺寸不合理、长度对不上都返回 null（文件在用户的磁盘上，不全信）。 */
export function unpackMono(bytes: Uint8Array): MonoBitmap | null {
  if (bytes.length < HEADER_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  if (width === 0 || height === 0 || width > MAX_MONO_SIDE || height > MAX_MONO_SIDE) {
    return null;
  }
  const rowBytes = Math.ceil(width / BITS_PER_BYTE);
  if (bytes.length !== HEADER_BYTES + rowBytes * height) {
    return null;
  }
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = bytes.subarray(HEADER_BYTES + y * rowBytes, HEADER_BYTES + (y + 1) * rowBytes);
    for (let x = 0; x < width; x += 1) {
      const byte = row[Math.floor(x / BITS_PER_BYTE)] ?? 0;
      bits[y * width + x] = (byte >> (BITS_PER_BYTE - 1 - (x % BITS_PER_BYTE))) & 1;
    }
  }
  return { width, height, bits };
}

/** 黑白 → 灰度（黑 0、白 255）：交给自由设计的图片元素，按 128 一刀切回来正好是同一批点。 */
export function monoToGray({ width, height, bits }: MonoBitmap): GrayImage {
  return { width, height, pixels: bits.map((bit) => (bit === 1 ? 0 : 255)) };
}
```

`src/core/templates/mono-image.ts`：在 `monoBmp` 之前加：

```ts
/** 灰度图 → base64（decodeGray 的反过程）：PDF 的一块交给自由设计的图片元素时用。 */
export function encodeGray(image: GrayImage): string {
  return bytesToBase64(image.pixels);
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/pdf src/core/templates/mono-image.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/pdf/pdf-model.ts src/core/pdf/mono-pack.ts src/core/pdf/mono-pack.test.ts src/core/templates/mono-image.ts src/core/templates/mono-image.test.ts
git commit -m "feat(pdf): limits, layout types and a packed format for printed bitmaps" -m "PDF printing keeps each printed label as a one-bit bitmap for a week so it can be reprinted from the records. The cache format is ours: a magic tag, the size and packed rows, and anything that does not match is refused." -m "$TRAILER"
```

---

### Task 3: 内容外框

**Files:**
- Create: `src/core/pdf/testing/synthetic-page.ts`
- Create: `src/core/pdf/content-box.ts`、`src/core/pdf/content-box.test.ts`

- [ ] **Step 1: 测试用的合成页面**

```ts
// src/core/pdf/testing/synthetic-page.ts
import type { GrayImage } from '../../templates/mono-image';
import type { PixelRect } from '../pdf-model';

/**
 * 测试用的合成页面：白纸上画黑块、框、虚线，模拟渲染出来的 PDF 页（只有 0 和 255 两种灰度）。
 * 尺寸按「一个像素约 0.5mm」想：400×560 大致是 48dpi 的 A4。
 */

const WHITE = 255;
const BLACK = 0;

export function blankPage(width: number, height: number): GrayImage {
  return { width, height, pixels: new Uint8Array(width * height).fill(WHITE) };
}

/** 涂黑一块（模拟文字、条码这类内容）；超出页面的部分不画。 */
export function fill(page: GrayImage, rect: PixelRect): GrayImage {
  const left = Math.max(0, rect.x);
  const right = Math.min(page.width, rect.x + rect.width);
  for (let y = Math.max(0, rect.y); y < Math.min(page.height, rect.y + rect.height); y += 1) {
    page.pixels.fill(BLACK, y * page.width + left, y * page.width + right);
  }
  return page;
}

/** 空心框（模拟面单的外框），边粗 border。 */
export function frame(page: GrayImage, rect: PixelRect, border: number): GrayImage {
  fill(page, { ...rect, height: border });
  fill(page, { ...rect, y: rect.y + rect.height - border, height: border });
  fill(page, { ...rect, width: border });
  fill(page, { ...rect, x: rect.x + rect.width - border, width: border });
  return page;
}

/** 横贯整页的虚线：每段 dash 个像素、间隔 gap 个像素。 */
export function dashedRow(page: GrayImage, y: number, thickness: number, dash: number, gap: number): GrayImage {
  for (let x = 0; x < page.width; x += dash + gap) {
    fill(page, { x, y, width: dash, height: thickness });
  }
  return page;
}

/** 竖贯整页的虚线。 */
export function dashedColumn(page: GrayImage, x: number, thickness: number, dash: number, gap: number): GrayImage {
  for (let y = 0; y < page.height; y += dash + gap) {
    fill(page, { x, y, width: thickness, height: dash });
  }
  return page;
}

/** 一张有外框的「面单」：边粗 2 的外框、三行字、底部一个条码；内容外框就是 rect。 */
export function framedLabel(page: GrayImage, rect: PixelRect): GrayImage {
  frame(page, rect, 2);
  for (let line = 0; line < 3; line += 1) {
    fill(page, { x: rect.x + 10, y: rect.y + 10 + line * 20, width: Math.floor(rect.width / 2), height: 8 });
  }
  fill(page, { x: rect.x + 10, y: rect.y + rect.height - 60, width: rect.width - 20, height: 40 });
  return page;
}

/** 一张没有外框的「面单」（185×266）：一行满宽的字、两行短字、底部一个满宽的条码。用来测紧挨着、只靠分割线分开的排法。 */
export function denseLabel(page: GrayImage, x: number, y: number): GrayImage {
  fill(page, { x, y, width: 185, height: 8 });
  fill(page, { x, y: y + 40, width: 120, height: 8 });
  fill(page, { x, y: y + 60, width: 90, height: 8 });
  fill(page, { x, y: y + 200, width: 185, height: 66 });
  return page;
}

/** gridPage 上四张面单的位置：2×2，之间留 20 像素空白（约 10mm）。 */
export const GRID_LABELS: readonly PixelRect[] = [
  { x: 20, y: 20, width: 170, height: 250 },
  { x: 210, y: 20, width: 170, height: 250 },
  { x: 20, y: 290, width: 170, height: 250 },
  { x: 210, y: 290, width: 170, height: 250 },
];

/** 400×560 的「A4」上 2×2 四张有框的面单（A4 四联面单的样子）。 */
export function gridPage(): GrayImage {
  const page = blankPage(400, 560);
  for (const rect of GRID_LABELS) {
    framedLabel(page, rect);
  }
  return page;
}
```

- [ ] **Step 2: 写测试**

```ts
// src/core/pdf/content-box.test.ts
import { describe, expect, test } from 'bun:test';
import { columnProfile, contentBox, fullRect, inkMask, rowProfile } from './content-box';
import { blankPage, fill } from './testing/synthetic-page';

describe('content box', () => {
  test('finds nothing on a blank page', () => {
    const mask = inkMask(blankPage(50, 40));
    expect(contentBox(mask, fullRect(mask))).toBeNull();
  });

  test('finds the box around everything that is darker than paper', () => {
    const page = fill(fill(blankPage(50, 40), { x: 5, y: 6, width: 10, height: 4 }), { x: 30, y: 20, width: 8, height: 10 });
    const mask = inkMask(page);
    expect(contentBox(mask, fullRect(mask))).toEqual({ x: 5, y: 6, width: 33, height: 24 });
  });

  // 抗锯齿的浅灰边、很浅的底纹不算内容，不然白边去不掉。
  test('treats light gray as paper', () => {
    const page = blankPage(20, 20);
    page.pixels.fill(230);
    fill(page, { x: 4, y: 4, width: 2, height: 2 });
    const mask = inkMask(page);
    expect(contentBox(mask, fullRect(mask))).toEqual({ x: 4, y: 4, width: 2, height: 2 });
  });

  // 扫描件上孤立的一个灰尘点不能把外框撑到页边。
  test('ignores a single speck', () => {
    const page = fill(blankPage(50, 40), { x: 10, y: 10, width: 6, height: 6 });
    page.pixels[49] = 0;
    const mask = inkMask(page);
    expect(contentBox(mask, fullRect(mask))).toEqual({ x: 10, y: 10, width: 6, height: 6 });
  });

  test('looks only inside the given rectangle', () => {
    const page = fill(fill(blankPage(50, 40), { x: 2, y: 2, width: 4, height: 4 }), { x: 30, y: 30, width: 5, height: 5 });
    const mask = inkMask(page);
    expect(contentBox(mask, { x: 20, y: 20, width: 30, height: 20 })).toEqual({ x: 30, y: 30, width: 5, height: 5 });
  });

  test('counts ink per row and per column inside a rectangle', () => {
    const mask = inkMask(fill(blankPage(6, 4), { x: 1, y: 1, width: 3, height: 2 }));
    expect([...rowProfile(mask, fullRect(mask))]).toEqual([0, 3, 3, 0]);
    expect([...columnProfile(mask, { x: 0, y: 1, width: 6, height: 1 })]).toEqual([0, 1, 1, 1, 0, 0]);
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/pdf/content-box.test.ts`
Expected: FAIL，`Cannot find module './content-box'`。

- [ ] **Step 4: 实现**

```ts
// src/core/pdf/content-box.ts
import type { GrayImage } from '../templates/mono-image';
import type { PixelRect } from './pdf-model';

/** 比这个暗的算「有内容」：抗锯齿的浅灰边、浅底纹不算，免得白边去不掉；黑字、线、条码都远比它暗。 */
export const INK_THRESHOLD = 200;
/** 一行（一列）至少这么多个有墨的点才算有内容：扫描件上孤立的灰尘点不能把外框撑到页边。 */
const MIN_INK_PER_LINE = 2;

/** 有墨的点：1 = 有内容、0 = 白纸。 */
export interface InkMask {
  width: number;
  height: number;
  ink: Uint8Array;
}

export function inkMask(image: GrayImage, threshold: number = INK_THRESHOLD): InkMask {
  const ink = new Uint8Array(image.pixels.length);
  image.pixels.forEach((value, index) => {
    ink[index] = value < threshold ? 1 : 0;
  });
  return { width: image.width, height: image.height, ink };
}

/** 整个位图。 */
export function fullRect(size: { width: number; height: number }): PixelRect {
  return { x: 0, y: 0, width: size.width, height: size.height };
}

/** rect 里每一行有墨的点数（下标从 rect.y 起算）。 */
export function rowProfile(mask: InkMask, rect: PixelRect): Uint32Array {
  const profile = new Uint32Array(rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * mask.width + rect.x;
    let count = 0;
    for (const value of mask.ink.subarray(start, start + rect.width)) {
      count += value;
    }
    profile[row] = count;
  }
  return profile;
}

/** rect 里每一列有墨的点数（下标从 rect.x 起算）。 */
export function columnProfile(mask: InkMask, rect: PixelRect): Uint32Array {
  const profile = new Uint32Array(rect.width);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * mask.width + rect.x;
    mask.ink.subarray(start, start + rect.width).forEach((value, column) => {
      profile[column] = (profile[column] ?? 0) + value;
    });
  }
  return profile;
}

/** rect 里内容的外框；整块都是白的返回 null。 */
export function contentBox(mask: InkMask, rect: PixelRect): PixelRect | null {
  const hasInk = (count: number) => count >= MIN_INK_PER_LINE;
  const rows = rowProfile(mask, rect);
  const top = rows.findIndex(hasInk);
  if (top === -1) {
    return null;
  }
  const bottom = rows.findLastIndex(hasInk);
  const columns = columnProfile(mask, { x: rect.x, y: rect.y + top, width: rect.width, height: bottom - top + 1 });
  const left = columns.findIndex(hasInk);
  if (left === -1) {
    return null;
  }
  const right = columns.findLastIndex(hasInk);
  return { x: rect.x + left, y: rect.y + top, width: right - left + 1, height: bottom - top + 1 };
}
```

（列只在已经找到的上下边之间统计：一个灰尘点自己所在的行先被 `MIN_INK_PER_LINE` 排除，它的列也就不再算。）

- [ ] **Step 5: 跑测试**

Run: `bun test src/core/pdf`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/pdf/testing/synthetic-page.ts src/core/pdf/content-box.ts src/core/pdf/content-box.test.ts
git commit -m "feat(pdf): find the content box of a rendered page" -m "Light gray anti-aliasing and lone specks do not count as content, so white margins can be trimmed from both vector and scanned pages. Synthetic pages drive the tests." -m "$TRAILER"
```

---

### Task 4: 一页多张的切分，和裁切方式的自动识别

切分用 XY 切分（先按行、再在每一行里按列、再按行，最多三层），**先只按空白缝**（4mm 以上）切：缝里画着裁切虚线也切得开（虚线两边各有一段缝，切出来的细条比一张标签小，丢掉）。**整页一条缝也没有**时（几张紧挨着），才找分割线（实线或虚线）：横贯这一段、不超过 1mm 粗、**正好落在等分位置上**（2–4 等分，偏差不超过 5%）。等分这一条是区分「切线」和「面单里的表格线、字行」的关键：面单里的线很少恰好把整页等分。认出的分割线先从墨迹里擦掉再切，竖着的分割线就不会让每一行都「有墨」。

**Files:**
- Create: `src/core/pdf/page-split.ts`、`src/core/pdf/page-split.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/pdf/page-split.test.ts
import { describe, expect, test } from 'bun:test';
import { inkMask } from './content-box';
import {
  boxRect,
  cropRects,
  detectCropMode,
  regularDividers,
  runsWhere,
  type SplitOptions,
  splitOptionsFor,
  splitPage,
} from './page-split';
import {
  blankPage,
  dashedColumn,
  dashedRow,
  denseLabel,
  fill,
  framedLabel,
  GRID_LABELS,
  gridPage,
} from './testing/synthetic-page';

/** 合成页面约 0.5mm 一个像素：缝至少 8 像素（4mm）、分割线最粗 3、一块至少 40、去白边的边距 20。 */
const OPTIONS: SplitOptions = { minGapPx: 8, maxDividerPx: 3, minPiecePx: 40, trimMarginPx: 20 };

/** 2×2 四张紧挨着的面单，中间只有虚线（缝只有一两个像素）。 */
function dividedPage() {
  const page = blankPage(400, 560);
  for (const [x, y] of [
    [12, 12],
    [203, 12],
    [12, 283],
    [203, 283],
  ] as const) {
    denseLabel(page, x, y);
  }
  dashedColumn(page, 199, 2, 6, 4);
  dashedRow(page, 280, 2, 6, 4);
  return page;
}

describe('split options', () => {
  test('turns millimetres into pixels at the rendered resolution', () => {
    expect(splitOptionsFor(203)).toEqual({ minGapPx: 32, maxDividerPx: 8, minPiecePx: 160, trimMarginPx: 80 });
  });
});

describe('runsWhere', () => {
  test('lists runs that pass the test and are long enough', () => {
    expect(runsWhere([0, 0, 5, 0, 0, 0, 7], (count) => count === 0, 2)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
  });
});

describe('regularDividers', () => {
  test('finds a thin line that halves the span', () => {
    const profile = new Array<number>(100).fill(10);
    profile[49] = 90;
    profile[50] = 90;
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([{ start: 49, end: 51 }]);
  });

  test('finds the lines of a three-way split', () => {
    const profile = new Array<number>(90).fill(10);
    profile[30] = 80;
    profile[60] = 80;
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([
      { start: 30, end: 31 },
      { start: 60, end: 61 },
    ]);
  });

  // 面单里的表格线（例如二联面单 60% 处的那条）不在等分位置上：不是切线。
  test('ignores a full line that does not divide the span evenly', () => {
    const profile = new Array<number>(100).fill(10);
    profile[60] = 100;
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([]);
  });

  test('ignores a thick band in the middle', () => {
    const profile = new Array<number>(100).fill(10);
    profile.fill(100, 45, 55);
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([]);
  });
});

describe('splitPage', () => {
  test('cuts four labels on a page at the blank gaps, in reading order', () => {
    expect(splitPage(inkMask(gridPage()), OPTIONS)).toEqual([...GRID_LABELS]);
  });

  test('cuts labels that touch along dashed divider lines', () => {
    expect(splitPage(inkMask(dividedPage()), OPTIONS)).toEqual([
      { x: 12, y: 12, width: 185, height: 266 },
      { x: 203, y: 12, width: 185, height: 266 },
      { x: 12, y: 283, width: 185, height: 266 },
      { x: 203, y: 283, width: 185, height: 266 },
    ]);
  });

  test('keeps one label with a full-width line inside it whole', () => {
    const page = framedLabel(blankPage(400, 560), { x: 20, y: 20, width: 360, height: 520 });
    fill(page, { x: 20, y: 332, width: 360, height: 2 });
    expect(splitPage(inkMask(page), OPTIONS)).toEqual([{ x: 20, y: 20, width: 360, height: 520 }]);
  });

  // 页脚的页码这类零碎不当一张标签。
  test('drops scraps smaller than a label', () => {
    const page = fill(gridPage(), { x: 190, y: 548, width: 20, height: 8 });
    expect(splitPage(inkMask(page), OPTIONS)).toEqual([...GRID_LABELS]);
  });

  test('finds nothing on a blank page', () => {
    expect(splitPage(inkMask(blankPage(100, 100)), OPTIONS)).toEqual([]);
  });
});

describe('detectCropMode', () => {
  test('suggests splitting a page of same-sized labels', () => {
    expect(detectCropMode(inkMask(gridPage()), OPTIONS)).toBe('split');
    expect(detectCropMode(inkMask(dividedPage()), OPTIONS)).toBe('split');
  });

  test('suggests trimming one label with wide margins around it', () => {
    const page = framedLabel(blankPage(400, 560), { x: 20, y: 20, width: 100, height: 150 });
    expect(detectCropMode(inkMask(page), OPTIONS)).toBe('trim');
  });

  test('keeps the whole page when content reaches its edges', () => {
    const page = framedLabel(blankPage(400, 560), { x: 5, y: 5, width: 390, height: 550 });
    expect(detectCropMode(inkMask(page), OPTIONS)).toBe('page');
    expect(detectCropMode(inkMask(blankPage(400, 560)), OPTIONS)).toBe('page');
  });
});

describe('cropRects', () => {
  const grid = inkMask(gridPage());

  test('gives the whole page, the content box or the pieces', () => {
    expect(cropRects('page', grid, OPTIONS, [])).toEqual([{ x: 0, y: 0, width: 400, height: 560 }]);
    expect(cropRects('trim', grid, OPTIONS, [])).toEqual([{ x: 20, y: 20, width: 360, height: 520 }]);
    expect(cropRects('split', grid, OPTIONS, [])).toEqual([...GRID_LABELS]);
  });

  test('falls back to the content box when nothing can be split', () => {
    const page = inkMask(fill(blankPage(400, 560), { x: 10, y: 10, width: 30, height: 30 }));
    expect(cropRects('split', page, OPTIONS, [])).toEqual([{ x: 10, y: 10, width: 30, height: 30 }]);
  });

  test('skips blank pages in every mode', () => {
    const blank = inkMask(blankPage(400, 560));
    for (const mode of ['page', 'trim', 'split'] as const) {
      expect(cropRects(mode, blank, OPTIONS, [])).toEqual([]);
    }
  });

  test('applies manual boxes by proportion and skips the blank ones', () => {
    const boxes = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.97, width: 0.5, height: 0.03 },
    ];
    expect(cropRects('manual', grid, OPTIONS, boxes)).toEqual([{ x: 0, y: 0, width: 200, height: 280 }]);
  });

  test('keeps a box inside the page', () => {
    expect(boxRect({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }, { width: 100, height: 50 })).toEqual({
      x: 90,
      y: 45,
      width: 10,
      height: 5,
    });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/pdf/page-split.test.ts`
Expected: FAIL，`Cannot find module './page-split'`。

- [ ] **Step 3: 实现**

```ts
// src/core/pdf/page-split.ts
import { columnProfile, contentBox, fullRect, type InkMask, rowProfile } from './content-box';
import type { CropMode, NormalizedBox, PixelRect } from './pdf-model';

const MM_PER_INCH = 25.4;
/** 两张之间至少 4mm 空白才算缝：面单里字行之间的空白不到 2mm，带框的面单里每一行都有边框的墨。 */
const MIN_GAP_MM = 4;
/** 分割线（实线或虚线）最粗 1mm：再粗就是内容里的色块。 */
const MAX_DIVIDER_MM = 1;
/** 一块至少 20mm 见方：更小的是页码、页脚这类零碎，不当一张标签。 */
const MIN_PIECE_MM = 20;
/** 四周空白都有 10mm 以上才建议「去白边」：铺满一页的 PDF 边距一般只有几毫米。 */
const TRIM_MARGIN_MM = 10;

/** 分割线上的墨点至少占这一段的一半：裁切用的虚线一般一半左右是墨，实线是满的。 */
export const DIVIDER_COVERAGE = 0.5;
/** 一页最多切成 4 行或 4 列：A4 上 2×2、1×3、4 行的小标签都在内。 */
const MAX_GRID_PARTS = 4;
/** 分割线离等分位置最多偏这一段的 5%：靠「正好等分」区分切线和面单里的表格线。 */
const GRID_TOLERANCE = 0.05;
/** 几块的宽、高都在中位数的 ±20% 以内才算「一页多张」：同一种面单排成一页，大小基本一样。 */
const SIMILAR_SIZE = 0.2;
/** 内容外框不到页面的 80% 时也建议去白边（例如 A4 左上角的一张面单）。 */
const TRIM_AREA_RATIO = 0.8;
/** XY 切分的层次：行 → 列 → 行，一行两张、另一行三张也切得开。 */
const CUT_AXES = ['rows', 'columns', 'rows'] as const;

/** 切分用的长度（像素），按渲染出来的分辨率由毫米换算。 */
export interface SplitOptions {
  minGapPx: number;
  maxDividerPx: number;
  minPiecePx: number;
  trimMarginPx: number;
}

export function splitOptionsFor(dpi: number): SplitOptions {
  const pixels = (mm: number) => Math.max(1, Math.round((mm * dpi) / MM_PER_INCH));
  return {
    minGapPx: pixels(MIN_GAP_MM),
    maxDividerPx: pixels(MAX_DIVIDER_MM),
    minPiecePx: pixels(MIN_PIECE_MM),
    trimMarginPx: pixels(TRIM_MARGIN_MM),
  };
}

/** 一段下标 [start, end)。 */
export interface Run {
  start: number;
  end: number;
}

/** profile 里连续满足 test、至少 minLength 长的段。 */
export function runsWhere(profile: ArrayLike<number>, test: (count: number) => boolean, minLength: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let index = 0; index <= profile.length; index += 1) {
    const isIn = index < profile.length && test(profile[index] ?? 0);
    if (isIn && start === -1) {
      start = index;
    }
    if (!isIn && start !== -1) {
      if (index - start >= minLength) {
        runs.push({ start, end: index });
      }
      start = -1;
    }
  }
  return runs;
}

/**
 * 等分位置上的分割线：墨点占这一段（span 是和它垂直的长度）的 DIVIDER_COVERAGE 以上、不超过 maxDividerPx 粗，
 * 并且 k-1 条正好把这一段等分成 k 份（k 从 4 往下试，每个等分位置取离它最近的一条）。
 */
export function regularDividers(profile: ArrayLike<number>, span: number, options: SplitOptions): Run[] {
  const candidates = runsWhere(profile, (count) => count >= span * DIVIDER_COVERAGE, 1).filter(
    (run) => run.end - run.start <= options.maxDividerPx,
  );
  const length = profile.length;
  const center = (run: Run) => (run.start + run.end) / 2;
  for (let parts = MAX_GRID_PARTS; parts >= 2; parts -= 1) {
    const picked: Run[] = [];
    for (let cut = 1; cut < parts; cut += 1) {
      const target = (length * cut) / parts;
      const nearest = candidates
        .filter((run) => Math.abs(center(run) - target) <= length * GRID_TOLERANCE)
        .sort((a, b) => Math.abs(center(a) - target) - Math.abs(center(b) - target))[0];
      if (nearest === undefined) {
        break;
      }
      picked.push(nearest);
    }
    if (picked.length === parts - 1) {
      return picked;
    }
  }
  return [];
}

/** 把长 length 的一段按分隔（缝、分割线）切开，返回每一份。 */
function segments(length: number, separators: readonly Run[]): Run[] {
  const sorted = [...separators].sort((a, b) => a.start - b.start);
  const parts: Run[] = [];
  let start = 0;
  for (const separator of sorted) {
    if (separator.start > start) {
      parts.push({ start, end: separator.start });
    }
    start = Math.max(start, separator.end);
  }
  if (start < length) {
    parts.push({ start, end: length });
  }
  return parts;
}

interface Dividers {
  /** 整页内容外框坐标下的横线、竖线。 */
  rows: Run[];
  columns: Run[];
}

/** 把分割线从墨迹里擦掉：竖的分割线不再让每一行都「有墨」，缝才找得到。 */
function withoutDividers(mask: InkMask, page: PixelRect, dividers: Dividers): InkMask {
  const ink = mask.ink.slice();
  for (const run of dividers.rows) {
    for (let y = page.y + run.start; y < page.y + run.end; y += 1) {
      ink.fill(0, y * mask.width + page.x, y * mask.width + page.x + page.width);
    }
  }
  for (const run of dividers.columns) {
    for (let y = page.y; y < page.y + page.height; y += 1) {
      ink.fill(0, y * mask.width + page.x + run.start, y * mask.width + page.x + run.end);
    }
  }
  return { ...mask, ink };
}

/** XY 切分的一层：先收到内容外框，再按这一层的方向切开，每一份交给下一层。 */
function cut(
  mask: InkMask,
  rect: PixelRect,
  level: number,
  page: PixelRect,
  dividers: Dividers,
  options: SplitOptions,
  out: PixelRect[],
): void {
  const box = contentBox(mask, rect);
  if (box === null) {
    return;
  }
  const axis = CUT_AXES[level];
  if (axis === undefined) {
    out.push(box);
    return;
  }
  const isRows = axis === 'rows';
  const profile = isRows ? rowProfile(mask, box) : columnProfile(mask, box);
  const offset = isRows ? box.y - page.y : box.x - page.x;
  const pageDividers = (isRows ? dividers.rows : dividers.columns)
    .map((run) => ({ start: run.start - offset, end: run.end - offset }))
    .filter((run) => run.end > 0 && run.start < profile.length);
  const separators = [...runsWhere(profile, (count) => count === 0, options.minGapPx), ...pageDividers];
  for (const part of segments(profile.length, separators)) {
    const next: PixelRect = isRows
      ? { x: box.x, y: box.y + part.start, width: box.width, height: part.end - part.start }
      : { x: box.x + part.start, y: box.y, width: part.end - part.start, height: box.height };
    cut(mask, next, level + 1, page, dividers, options, out);
  }
}

const NO_DIVIDERS: Dividers = { rows: [], columns: [] };

/** 按缝（和给定的分割线）把整页切开，丢掉比 minPiecePx 小的零碎。 */
function cutPage(mask: InkMask, page: PixelRect, dividers: Dividers, options: SplitOptions): PixelRect[] {
  const pieces: PixelRect[] = [];
  cut(mask, page, 0, page, dividers, options, pieces);
  return pieces.filter((piece) => piece.width >= options.minPiecePx && piece.height >= options.minPiecePx);
}

/**
 * 一页切成几张（按阅读顺序：先上后下、先左后右）。先只按缝切；切不出两张时（几张紧挨着）再找等分位置上的分割线，
 * 擦掉它们、以它们为界再切一次。缝优先：带框的面单之间有缝时，靠近中线的是面单自己的边框，不能当切线擦掉。
 */
export function splitPage(mask: InkMask, options: SplitOptions): PixelRect[] {
  const page = contentBox(mask, fullRect(mask));
  if (page === null) {
    return [];
  }
  const byGaps = cutPage(mask, page, NO_DIVIDERS, options);
  if (byGaps.length > 1) {
    return byGaps;
  }
  const dividers: Dividers = {
    rows: regularDividers(rowProfile(mask, page), page.width, options),
    columns: regularDividers(columnProfile(mask, page), page.height, options),
  };
  if (dividers.rows.length === 0 && dividers.columns.length === 0) {
    return byGaps;
  }
  return cutPage(withoutDividers(mask, page, dividers), page, dividers, options);
}

function isNearMedian(values: readonly number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return values.every((value) => Math.abs(value - median) <= median * SIMILAR_SIZE);
}

/**
 * 第一页该用哪种裁切方式：切得出两张以上、大小差不多 → 一页多张；四周都有大片空白或内容不到页面的 80% → 去白边；
 * 其余（包括空白页）→ 整页。操作员可以改。
 */
export function detectCropMode(mask: InkMask, options: SplitOptions): CropMode {
  const box = contentBox(mask, fullRect(mask));
  if (box === null) {
    return 'page';
  }
  const pieces = splitPage(mask, options);
  if (
    pieces.length >= 2 &&
    isNearMedian(pieces.map((piece) => piece.width)) &&
    isNearMedian(pieces.map((piece) => piece.height))
  ) {
    return 'split';
  }
  const margin = Math.min(box.x, box.y, mask.width - box.x - box.width, mask.height - box.y - box.height);
  const area = (box.width * box.height) / (mask.width * mask.height);
  return margin >= options.trimMarginPx || area < TRIM_AREA_RATIO ? 'trim' : 'page';
}

/** 按比例记的框 → 这一页上的像素矩形（收在页面内，至少 1 像素）。 */
export function boxRect(box: NormalizedBox, size: { width: number; height: number }): PixelRect {
  const x = Math.min(size.width - 1, Math.max(0, Math.round(box.x * size.width)));
  const y = Math.min(size.height - 1, Math.max(0, Math.round(box.y * size.height)));
  const right = Math.min(size.width, Math.round((box.x + box.width) * size.width));
  const bottom = Math.min(size.height, Math.round((box.y + box.height) * size.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/**
 * 这一页按裁切方式要打的矩形（按打印顺序）。空白页（以及手动框里是空白的框）不出块：打一张白纸没有意义。
 * 一页多张切不出来时退回内容外框（例如这一页只剩一张小标签）。
 */
export function cropRects(
  mode: CropMode,
  mask: InkMask,
  options: SplitOptions,
  boxes: readonly NormalizedBox[],
): PixelRect[] {
  const whole = fullRect(mask);
  const content = contentBox(mask, whole);
  switch (mode) {
    case 'page':
      return content === null ? [] : [whole];
    case 'trim':
      return content === null ? [] : [content];
    case 'split': {
      const pieces = splitPage(mask, options);
      if (pieces.length > 0) {
        return pieces;
      }
      return content === null ? [] : [content];
    }
    case 'manual':
      return boxes.map((box) => boxRect(box, mask)).filter((rect) => contentBox(mask, rect) !== null);
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/pdf`
Expected: PASS。几处数字是这样来的，用例不过时对照着查实现，不改测试数字：
- `gridPage`：四张之间行、列方向各有 20 像素的缝，三层切完每块正好收到外框（外框让面单内部每一行、每一列都有墨，不会被切开）。
- `dividedPage`：竖、横两条虚线贯穿整页，缝最多 4 像素（虚线的空当），按缝切不开；内容外框是 0–395 × 0–555（虚线画到页边），横虚线中心 281、竖虚线中心 200，离等分位置 278、198 都在 5% 以内；虚线的墨点约占 60%，字行、条码的墨点虽然也过半，但 8 像素以上粗，不算分割线。
- 带内部横线的单张：那条线在 60% 处（离 50% 有 10%），三等分、四等分的位置上也没有线，所以不切。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/pdf/page-split.ts src/core/pdf/page-split.test.ts
git commit -m "feat(pdf): split pages into labels and detect the crop mode" -m "Labels are cut at blank gaps of 4mm or more. Only when a page has no gap at all are thin divider lines used, and only those that sit exactly on an even split of the page, which tells cut lines apart from the table lines inside a waybill; they are erased before cutting so a vertical line does not hide the horizontal split. The first page suggests split, trim or whole page." -m "$TRAILER"
```

---

### Task 5: 每一块放到纸上

一块（页面上的一个矩形）→ 裁出来 → 横竖和纸不一致时顺时针转 90° → 等比缩放、居中、四周补白 → 按操作员选的方式转黑白，得到的点数正好是纸在目标打印机上的点数。缩略图按整数倍取样，块里有一个黑点就算黑（细线、条码在缩略图里不会消失）。

**Files:**
- Create: `src/core/pdf/piece-fit.ts`、`src/core/pdf/piece-fit.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/pdf/piece-fit.test.ts
import { describe, expect, test } from 'bun:test';
import { chooseTurn, cropGray, paperDots, placeOnPaper, renderPiece, rotateClockwise, thumbnail } from './piece-fit';
import { blankPage, fill } from './testing/synthetic-page';

describe('paperDots', () => {
  test('counts printer dots across the paper the same way the canvas layout does', () => {
    expect(paperDots({ widthMm: 100, heightMm: 150 }, 203)).toEqual({ width: 799, height: 1199 });
    expect(paperDots({ widthMm: 60, heightMm: 40 }, 300)).toEqual({ width: 709, height: 472 });
  });
});

describe('chooseTurn', () => {
  test('turns a landscape piece for portrait paper', () => {
    expect(chooseTurn(300, 200, 100, 150)).toBe(90);
  });

  test('keeps a piece that already fits the paper the right way up', () => {
    expect(chooseTurn(200, 300, 100, 150)).toBe(0);
  });

  // 差不多是正方形时转不转都一样大：保持原方向，免得文字无缘无故躺下。
  test('keeps a nearly square piece as it is', () => {
    expect(chooseTurn(100, 101, 100, 150)).toBe(0);
  });
});

describe('cropGray and rotateClockwise', () => {
  test('cuts a rectangle out of the page', () => {
    const page = { width: 4, height: 3, pixels: Uint8Array.from({ length: 12 }, (_, index) => index) };
    expect(cropGray(page, { x: 1, y: 1, width: 2, height: 2 })).toEqual({
      width: 2,
      height: 2,
      pixels: Uint8Array.of(5, 6, 9, 10),
    });
  });

  test('turns the image a quarter clockwise', () => {
    const image = { width: 3, height: 2, pixels: Uint8Array.of(1, 2, 3, 4, 5, 6) };
    expect(rotateClockwise(image)).toEqual({ width: 2, height: 3, pixels: Uint8Array.of(4, 1, 5, 2, 6, 3) });
  });
});

describe('placeOnPaper', () => {
  test('scales to fit, centres and fills the rest with white', () => {
    const piece = { width: 10, height: 10, pixels: new Uint8Array(100) };
    const placed = placeOnPaper(piece, { width: 20, height: 10 });
    expect(placed.width).toBe(20);
    expect([placed.pixels[4], placed.pixels[5], placed.pixels[14], placed.pixels[15]]).toEqual([255, 0, 0, 255]);
    expect(placed.pixels.filter((value) => value === 0)).toHaveLength(100);
  });
});

describe('renderPiece', () => {
  test('turns, fits and converts a piece into black dots on the paper', () => {
    // 横放的一块，左半边是黑的；纸是竖的：顺时针转过来后黑的在上半边。
    const page = fill(blankPage(60, 40), { x: 0, y: 0, width: 30, height: 40 });
    const piece = renderPiece(page, { x: 0, y: 0, width: 60, height: 40 }, {
      dots: { width: 20, height: 30 },
      mono: 'threshold',
      threshold: 128,
    });
    expect([piece.width, piece.height]).toEqual([20, 30]);
    expect([...piece.bits.subarray(0, 20)]).toEqual(new Array(20).fill(1));
    expect([...piece.bits.subarray(29 * 20)]).toEqual(new Array(20).fill(0));
  });
});

describe('thumbnail', () => {
  test('samples down to the size limit and keeps a one-dot line', () => {
    const bits = new Uint8Array(480 * 10);
    for (let y = 0; y < 10; y += 1) {
      bits[y * 480 + 1] = 1;
    }
    const small = thumbnail({ width: 480, height: 10, bits });
    expect([small.width, small.height]).toEqual([240, 5]);
    expect(small.bits[0]).toBe(1);
    expect(small.bits[1]).toBe(0);
  });

  test('leaves a small bitmap as it is', () => {
    const bitmap = { width: 2, height: 2, bits: Uint8Array.of(1, 0, 0, 1) };
    expect(thumbnail(bitmap)).toEqual(bitmap);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/pdf/piece-fit.test.ts`
Expected: FAIL，`Cannot find module './piece-fit'`。

- [ ] **Step 3: 实现**

```ts
// src/core/pdf/piece-fit.ts
import type { PaperSize } from '../../shared/paper-sizes';
import type { ImageMode } from '../templates/canvas-model';
import { fitContain, type GrayImage, resizeGray, toMono } from '../templates/mono-image';
import type { MonoBitmap } from './mono-pack';
import type { PixelRect } from './pdf-model';

const MM_PER_INCH = 25.4;
/** 转过来要能放大 2% 以上才转：差不多大时保持原方向，近似正方形的块不会无缘无故躺下。 */
const TURN_GAIN = 0.02;
/** 缩略图最长边（点）：一千张的缩略图加起来也只有几 MB，界面一次拿得动。 */
export const THUMBNAIL_MAX_SIDE = 240;
const WHITE = 255;

/** 转多少度（顺时针）。 */
export type Turn = 0 | 90;

/**
 * 纸在这台打印机上有多少个点。和 canvas-layout 的 snapRect 用同一个算式（毫米 ÷ 每点毫米数再四舍五入），
 * 自由设计的图片框正好是这么多点，打印时不会再缩放一次。
 */
export function paperDots(paper: PaperSize, dpi: number): { width: number; height: number } {
  const dotMm = MM_PER_INCH / dpi;
  return { width: Math.round(paper.widthMm / dotMm), height: Math.round(paper.heightMm / dotMm) };
}

/** 横竖和纸不一致时转 90°：比较两种放法哪种放得更大。 */
export function chooseTurn(width: number, height: number, boxWidth: number, boxHeight: number): Turn {
  const straight = Math.min(boxWidth / width, boxHeight / height);
  const turned = Math.min(boxWidth / height, boxHeight / width);
  return turned > straight * (1 + TURN_GAIN) ? 90 : 0;
}

export function cropGray(image: GrayImage, rect: PixelRect): GrayImage {
  const pixels = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * image.width + rect.x;
    pixels.set(image.pixels.subarray(start, start + rect.width), row * rect.width);
  }
  return { width: rect.width, height: rect.height, pixels };
}

/** 顺时针转 90°：原来的 (x, y) 到 (高 - 1 - y, x)，原来的左边到了上边。 */
export function rotateClockwise(image: GrayImage): GrayImage {
  const { width, height } = image;
  const pixels = new Uint8Array(width * height);
  image.pixels.forEach((value, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    pixels[x * height + (height - 1 - y)] = value;
  });
  return { width: height, height: width, pixels };
}

/** 等比放进纸里、居中，四周补白。 */
export function placeOnPaper(piece: GrayImage, dots: { width: number; height: number }): GrayImage {
  const size = fitContain(piece.width, piece.height, dots.width, dots.height);
  const scaled = resizeGray(piece, size.width, size.height);
  const pixels = new Uint8Array(dots.width * dots.height).fill(WHITE);
  const left = Math.floor((dots.width - size.width) / 2);
  const top = Math.floor((dots.height - size.height) / 2);
  for (let row = 0; row < size.height; row += 1) {
    pixels.set(scaled.pixels.subarray(row * size.width, (row + 1) * size.width), (top + row) * dots.width + left);
  }
  return { width: dots.width, height: dots.height, pixels };
}

export interface PieceOptions {
  /** 纸在目标打印机上的点数（paperDots）。 */
  dots: { width: number; height: number };
  mono: ImageMode;
  threshold: number;
}

/** 页面上的一块 → 纸上的黑白点：裁出来、横竖和纸不一致时转 90°、等比缩放居中、转黑白。 */
export function renderPiece(page: GrayImage, rect: PixelRect, options: PieceOptions): MonoBitmap {
  const cropped = cropGray(page, rect);
  const turn = chooseTurn(cropped.width, cropped.height, options.dots.width, options.dots.height);
  const placed = placeOnPaper(turn === 90 ? rotateClockwise(cropped) : cropped, options.dots);
  return { width: placed.width, height: placed.height, bits: toMono(placed, options.mono, options.threshold) };
}

/**
 * 缩略图：按整数倍缩小，仍然只有黑白（看到的就是打出来的点）。一格里有一个黑点就算黑：
 * 面单上的细线、条码在缩略图里不会消失；抖动的照片会显得暗一些，可以点开看原大。
 */
export function thumbnail(bitmap: MonoBitmap, maxSide: number = THUMBNAIL_MAX_SIDE): MonoBitmap {
  const step = Math.max(1, Math.ceil(Math.max(bitmap.width, bitmap.height) / maxSide));
  const width = Math.ceil(bitmap.width / step);
  const height = Math.ceil(bitmap.height / step);
  const bits = new Uint8Array(width * height);
  bitmap.bits.forEach((bit, index) => {
    if (bit === 1) {
      const x = Math.floor((index % bitmap.width) / step);
      const y = Math.floor(Math.floor(index / bitmap.width) / step);
      bits[y * width + x] = 1;
    }
  });
  return { width, height, bits };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/pdf`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/pdf/piece-fit.ts src/core/pdf/piece-fit.test.ts
git commit -m "feat(pdf): fit each piece onto the paper as printer dots" -m "A piece is cropped, turned a quarter when that makes it larger on the paper, scaled to fit and centred, then converted with the chosen threshold or dithering, with exactly as many dots as the paper has on the target printer. Thumbnails keep thin lines by marking a cell black when any of its dots is black." -m "$TRAILER"
```

---

### Task 6: 一块 → 打印用的模板；界面交来的设置的校验

一块不新建模板种类：包成**只有一张图的临时自由设计模板**（图片框铺满纸，灰度 0 / 255、阈值 128），打印、预览都走现有的 `renderLabelHtml` → `canvas-html.ts`，画成 1 位 BMP、`image-rendering: pixelated`，一个像素一个打印点。这个模板不进模板库，编号固定为 `builtin:pdf-piece`，只用来让打印记录、打印结果通知知道这一张不是按模板排的。

**Files:**
- Create: `src/core/pdf/piece-template.ts`、`src/core/pdf/piece-template.test.ts`
- Create: `src/core/pdf/parse-pdf-request.ts`、`src/core/pdf/parse-pdf-request.test.ts`
- Modify: `src/main/printing/canvas-html.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/pdf/piece-template.test.ts
import { describe, expect, test } from 'bun:test';
import { decodeGray } from '../templates/mono-image';
import { PDF_PIECE_TEMPLATE_ID, pieceContent, pieceFields, pieceTemplate, shortFileName } from './piece-template';

describe('pieceTemplate', () => {
  test('wraps a bitmap into a one-image canvas template that fills the paper', () => {
    const template = pieceTemplate({ width: 2, height: 1, bits: Uint8Array.of(1, 0) }, { widthMm: 100, heightMm: 150 });
    expect(template).toMatchObject({
      kind: 'canvas',
      id: PDF_PIECE_TEMPLATE_ID,
      paper: { widthMm: 100, heightMm: 150 },
      printer: null,
    });
    expect(template.elements).toHaveLength(1);
    const [image] = template.elements;
    expect(image).toMatchObject({
      kind: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 150,
      rotation: 0,
      pixelWidth: 2,
      pixelHeight: 1,
      mode: 'threshold',
      threshold: 128,
    });
    if (image?.kind !== 'image') {
      throw new Error('expected an image element');
    }
    expect(decodeGray(image.pixels, 2, 1)?.pixels).toEqual(Uint8Array.of(0, 255));
  });
});

describe('piece records', () => {
  test('name the record after the file, the page and the piece', () => {
    expect(pieceContent('面单.pdf', 2, 1)).toBe('面单.pdf 第 2 页第 1 张');
    expect(pieceFields('面单.pdf', 2, 1)).toEqual([
      { name: '文件', value: '面单.pdf' },
      { name: '页码', value: '2' },
      { name: '第几张', value: '1' },
    ]);
  });

  test('shortens very long file names', () => {
    expect([...shortFileName('长'.repeat(150))]).toHaveLength(100);
  });
});
```

```ts
// src/core/pdf/parse-pdf-request.test.ts
import { describe, expect, test } from 'bun:test';
import { parsePdfLayout, parsePdfPrintRequest } from './parse-pdf-request';

const LAYOUT = { paperKey: '100x150', crop: 'split', boxes: [], mono: 'threshold', threshold: 128 };
const BOX = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
const RUN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('parsePdfLayout', () => {
  test('accepts a valid layout and copies it', () => {
    const manual = { ...LAYOUT, crop: 'manual', boxes: [BOX] };
    expect(parsePdfLayout(LAYOUT)).toEqual(LAYOUT);
    const parsed = parsePdfLayout(manual);
    expect(parsed).toEqual(manual);
    expect(parsed?.boxes[0]).not.toBe(BOX);
  });

  test('refuses unknown papers, modes and thresholds', () => {
    expect(parsePdfLayout({ ...LAYOUT, paperKey: '100x999' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'zoom' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, mono: 'gray' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, threshold: 0 })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, threshold: 128.5 })).toBeNull();
    expect(parsePdfLayout('x')).toBeNull();
    expect(parsePdfLayout([LAYOUT])).toBeNull();
  });

  test('needs at least one box to crop by hand, and sane boxes', () => {
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual' })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: [{ ...BOX, x: 0.8 }] })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: [{ ...BOX, width: 0.01 }] })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: [{ ...BOX, y: Number.NaN }] })).toBeNull();
    expect(parsePdfLayout({ ...LAYOUT, crop: 'manual', boxes: new Array(13).fill(BOX) })).toBeNull();
  });
});

describe('parsePdfPrintRequest', () => {
  const REQUEST = { runId: RUN_ID, pieceIds: ['1-2', '1-1'], copies: 2 };

  test('accepts a valid request', () => {
    expect(parsePdfPrintRequest(REQUEST)).toEqual(REQUEST);
  });

  test('refuses bad ids, repeats, empty lists and copy counts out of range', () => {
    expect(parsePdfPrintRequest({ ...REQUEST, runId: 'x' })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: [] })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: ['1-1', '1-1'] })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: ['0-1'] })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, pieceIds: Array.from({ length: 1001 }, (_, index) => `1-${index + 1}`) })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, copies: 0 })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, copies: 100 })).toBeNull();
    expect(parsePdfPrintRequest({ ...REQUEST, copies: 1.5 })).toBeNull();
  });
});
```

`src/main/printing/canvas-html.test.ts` 末尾加（import 加 `paperDots`、`pieceTemplate`、`monoBmp`）：

```ts
describe('PDF pieces', () => {
  // 黑白位图按这台打印机的点做好，包进自由设计模板后不能再被缩放或重新转黑白：打出来的点和预览一模一样。
  test('prints a PDF piece dot for dot', () => {
    const paper = { widthMm: 60, heightMm: 40 };
    const dots = paperDots(paper, 203);
    const bits = new Uint8Array(dots.width * dots.height).map((_, index) => (index % 3 === 0 ? 1 : 0));
    const { html } = renderCanvasHtml(
      {
        scan: { raw: 'x.pdf 第 1 页第 1 张', ruleId: 'pdf', ruleName: 'PDF 打印', fields: [] },
        template: pieceTemplate({ width: dots.width, height: dots.height, bits }, paper),
        printedAt: 0,
      },
      203,
    );
    expect(html).toContain(monoBmp(bits, dots.width, dots.height));
  });
});
```

（import 路径：`import { paperDots } from '../../core/pdf/piece-fit';`、`import { pieceTemplate } from '../../core/pdf/piece-template';`、`import { monoBmp } from '../../core/templates/mono-image';`。这个用例失败说明 `paperDots` 和 `canvas-layout` 的 `snapRect` 取整不一致，改 `paperDots`，不改用例。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/pdf src/main/printing/canvas-html.test.ts`
Expected: FAIL，`Cannot find module './piece-template'`、`'./parse-pdf-request'`。

- [ ] **Step 3: 实现**

```ts
// src/core/pdf/piece-template.ts
import type { PaperSize } from '../../shared/paper-sizes';
import type { ScanField } from '../scan/scan-result';
import type { CanvasTemplate } from '../templates/canvas-model';
import { encodeGray } from '../templates/mono-image';
import { type MonoBitmap, monoToGray } from './mono-pack';
import { PDF_LIMITS } from './pdf-model';

/** 打印记录里 PDF 这一块用的「模板」编号：不在模板库里，只说明这一张不是按模板排的。 */
export const PDF_PIECE_TEMPLATE_ID = 'builtin:pdf-piece';
/** 黑白位图转回灰度（0 / 255）再按 128 一刀切：打出来正好是同一批点。 */
const PIECE_THRESHOLD = 128;
const PIECE_NAME = 'PDF';

/**
 * 一块 → 只有一张图的自由设计模板：图片框铺满纸，打印和预览都走 canvas-html 的 1 位 BMP 画法。
 * 位图已经是按目标打印机的点做好的；打印时换了分辨率不同的打印机，canvas-html 会按新的点数重新缩放。
 */
export function pieceTemplate(bitmap: MonoBitmap, paper: PaperSize): CanvasTemplate {
  const gray = monoToGray(bitmap);
  return {
    kind: 'canvas',
    id: PDF_PIECE_TEMPLATE_ID,
    name: PIECE_NAME,
    paper: { widthMm: paper.widthMm, heightMm: paper.heightMm },
    printer: null,
    elements: [
      {
        kind: 'image',
        id: 'pdf-piece',
        name: PIECE_NAME,
        x: 0,
        y: 0,
        width: paper.widthMm,
        height: paper.heightMm,
        rotation: 0,
        locked: true,
        pixels: encodeGray(gray),
        pixelWidth: gray.width,
        pixelHeight: gray.height,
        mode: 'threshold',
        threshold: PIECE_THRESHOLD,
      },
    ],
  };
}

/** 打印记录里的文件名：最多 PDF_LIMITS.fileNameChars 个字（按字符数，不切开汉字和表情）。 */
export function shortFileName(fileName: string): string {
  return [...fileName].slice(0, PDF_LIMITS.fileNameChars).join('');
}

/** 打印记录的内容（也是记录搜索、二维码「完整内容」的来源）：「面单.pdf 第 2 页第 1 张」。 */
export function pieceContent(fileName: string, page: number, piece: number): string {
  return `${shortFileName(fileName)} 第 ${page} 页第 ${piece} 张`;
}

/** 打印记录和打印结果通知里的字段。 */
export function pieceFields(fileName: string, page: number, piece: number): ScanField[] {
  return [
    { name: '文件', value: shortFileName(fileName) },
    { name: '页码', value: String(page) },
    { name: '第几张', value: String(piece) },
  ];
}
```

```ts
// src/core/pdf/parse-pdf-request.ts
import { parsePaperKey } from '../../shared/paper-sizes';
import { IMAGE_MODES, type ImageMode } from '../templates/canvas-model';
import {
  CROP_MODES,
  type CropMode,
  type NormalizedBox,
  PDF_LIMITS,
  type PdfLayout,
  type PdfPrintRequest,
  PIECE_ID_PATTERN,
} from './pdf-model';

/** 框至少占页面宽、高的 2%：A4 上约 4×6mm，再小是手抖拖出来的。 */
export const MIN_BOX_FRACTION = 0.02;
/** 浮点误差的余量：界面算出来的右边、下边可能是 1.0000000002。 */
const EDGE_EPSILON = 1e-9;
/** 阈值 1–254：0 和 255 会让整张全白或全黑。 */
const THRESHOLD_RANGE = { min: 1, max: 254 } as const;
/** 出块编号是 UUID（主进程生成）。 */
export const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseBox(value: unknown): NormalizedBox | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = value['x'];
  const y = value['y'];
  const width = value['width'];
  const height = value['height'];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  const isInside =
    x >= 0 &&
    y >= 0 &&
    width >= MIN_BOX_FRACTION &&
    height >= MIN_BOX_FRACTION &&
    x + width <= 1 + EDGE_EPSILON &&
    y + height <= 1 + EDGE_EPSILON;
  return isInside ? { x, y, width, height } : null;
}

/**
 * 渲染进程交来的裁切设置（IPC 是信任边界）：任何一项不对整个拒绝。界面只会交合法的值，
 * 不合法说明页面出了问题，不去猜它想要什么。
 */
export function parsePdfLayout(value: unknown): PdfLayout | null {
  if (!isRecord(value)) {
    return null;
  }
  const paperKey = value['paperKey'];
  const crop = value['crop'];
  const mono = value['mono'];
  const threshold = value['threshold'];
  const boxes = value['boxes'];
  if (typeof paperKey !== 'string' || parsePaperKey(paperKey) === null) {
    return null;
  }
  if (!(CROP_MODES as readonly unknown[]).includes(crop) || !(IMAGE_MODES as readonly unknown[]).includes(mono)) {
    return null;
  }
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < THRESHOLD_RANGE.min ||
    threshold > THRESHOLD_RANGE.max
  ) {
    return null;
  }
  if (!Array.isArray(boxes) || boxes.length > PDF_LIMITS.manualBoxes) {
    return null;
  }
  const parsedBoxes: NormalizedBox[] = [];
  for (const box of boxes) {
    const parsed = parseBox(box);
    if (parsed === null) {
      return null;
    }
    parsedBoxes.push(parsed);
  }
  if (crop === 'manual' && parsedBoxes.length === 0) {
    return null;
  }
  return { paperKey, crop: crop as CropMode, boxes: parsedBoxes, mono: mono as ImageMode, threshold };
}

/** 渲染进程交来的打印设置：块编号合法、不重复、不超过上限；份数 1–99。 */
export function parsePdfPrintRequest(value: unknown): PdfPrintRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const runId = value['runId'];
  const pieceIds = value['pieceIds'];
  const copies = value['copies'];
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    return null;
  }
  if (!Array.isArray(pieceIds) || pieceIds.length === 0 || pieceIds.length > PDF_LIMITS.pieces) {
    return null;
  }
  const ids: string[] = [];
  for (const id of pieceIds) {
    if (typeof id !== 'string' || !PIECE_ID_PATTERN.test(id)) {
      return null;
    }
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) {
    return null;
  }
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > PDF_LIMITS.copies) {
    return null;
  }
  return { runId, pieceIds: ids, copies };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/pdf src/main/printing`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/pdf/piece-template.ts src/core/pdf/piece-template.test.ts src/core/pdf/parse-pdf-request.ts src/core/pdf/parse-pdf-request.test.ts src/main/printing/canvas-html.test.ts
git commit -m "feat(pdf): print a piece through a one-image canvas template" -m "A piece is wrapped in a transient canvas template whose image fills the paper, so printing, preview and records reuse the canvas renderer and its one-bit BMP drawn dot for dot. Layouts and print requests from the page are parsed strictly at the IPC boundary." -m "$TRAILER"
```

---

### Task 7: 打印记录：PDF 的文件、页码、第几张和位图（迁移 7）

来源 `pdf` 已在迁移 6 的 CHECK 里，这里只加四列（`ALTER TABLE ... ADD COLUMN`，不重建表、不动全文索引）。四列要么都有、要么都没有：ADD COLUMN 加不了跨列的 CHECK，由 `toJobRecord` 读出时核对（`readString` / `readInteger` 遇到 NULL 会抛错）。PDF 打的和批量打的一样，不参与扫码防重复窗口的恢复。

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/testing/in-memory-job-store.ts`
- Modify: `src/main/storage/migrations.ts`、`src/main/storage/database.test.ts`
- Modify: `src/main/storage/sqlite-job-store.ts`、`src/main/storage/sqlite-job-store.test.ts`

- [ ] **Step 1: 写测试**

`database.test.ts` 末尾加：

```ts
describe('migration 7', () => {
  test('adds the PDF columns and keeps every row', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 6));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('a', 1, 'CL5640', 'P', 'desktop', 'printed', 0)",
    ).run();
    migrate(db);
    expect({ ...db.prepare("SELECT seq, pdf_file, pdf_bitmap FROM jobs WHERE id = 'a'").get() }).toEqual({
      seq: 1,
      pdf_file: null,
      pdf_bitmap: null,
    });
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, pdf_file, pdf_page, pdf_piece, pdf_bitmap) VALUES ('b', 2, '面单.pdf 第 1 页第 2 张', 'P', 'pdf', 'printed', 0, '面单.pdf', 1, 2, 'k')",
    ).run();
    expect({ ...db.prepare("SELECT pdf_page, pdf_piece FROM jobs WHERE id = 'b'").get() }).toEqual({
      pdf_page: 1,
      pdf_piece: 2,
    });
    const hits = db.prepare('SELECT rowid FROM jobs_search WHERE jobs_search MATCH \'"面单.pdf"\'').all();
    expect(hits.map((row) => row['rowid'])).toEqual([2]);
    db.close();
  });

  test('refuses a page or piece number below 1', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, pdf_file, pdf_page, pdf_piece, pdf_bitmap) VALUES ('c', 3, 'x', 'P', 'pdf', 'printed', 0, 'x.pdf', 0, 1, 'k')",
    );
    expect(() => insert.run()).toThrow();
    db.close();
  });
});
```

`sqlite-job-store.test.ts` 的 `describe('SqliteJobStore')` 里加（文件顶部常量区加 `const PDF_PIECE = { file: '面单.pdf', page: 2, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' };`）：

```ts
  test('keeps the PDF piece of a job', () => {
    const store = new SqliteJobStore(db, 100);
    store.append(job(1, { source: 'pdf', pdf: PDF_PIECE }));
    store.append(job(2));
    expect(store.listPage({ limit: 10 }).jobs.map((record) => record.pdf)).toEqual([undefined, PDF_PIECE]);
    expect(store.get('job-1')?.pdf).toEqual(PDF_PIECE);
  });

  test('leaves PDF prints out of the recent prints', () => {
    const store = new SqliteJobStore(db, 100);
    store.append(job(1, { source: 'pdf', pdf: PDF_PIECE }));
    expect(store.listLastPrinted(0)).toEqual([]);
  });
```

（`job(n, overrides)`、`ids` 是文件里现成的工厂和取编号的小函数；如果名字不同，用文件里构造 `JobRecord` 的那个。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/storage`
Expected: FAIL（`pdf_file` 列不存在；`pdf` 不是 `JobRecord` 的字段）。

- [ ] **Step 3: 实现**

`src/core/types.ts` 在 `BatchRef` 之后加：

```ts
/** PDF 打印的一块：哪个文件、第几页、这一页的第几张（都从 1 数），和缓存里那张黑白位图的编号（预览、重打用，保留 7 天）。 */
export interface PdfRef {
  file: string;
  page: number;
  piece: number;
  bitmap: string;
}
```

`PrintRequest` 末尾加：

```ts
  /** PDF 打印的一块（含从打印记录重打的）；其他入口没有。 */
  pdf?: PdfRef;
```

`JobRecord` 末尾加：

```ts
  /** PDF 打印的一块：文件、页码、第几张、位图编号；其他来源没有。 */
  pdf?: PdfRef;
```

`src/core/testing/in-memory-job-store.ts` 的 `listLastPrinted` 条件末尾加 `&& job.pdf === undefined`。

`src/main/storage/migrations.ts`：在第 6 条之后、`];` 之前追加：

```ts
  // 7：PDF 打印的一块：文件名、页码、第几张、缓存的黑白位图编号。来源 pdf 在第 6 条已经加进 CHECK，这里只加列、不重建表。
  // 四列要么都有、要么都没有：ADD COLUMN 加不了跨列的 CHECK，由 sqlite-job-store 的 toJobRecord 读出时核对。
  `
  ALTER TABLE jobs ADD COLUMN pdf_file TEXT;
  ALTER TABLE jobs ADD COLUMN pdf_page INTEGER CHECK (pdf_page IS NULL OR pdf_page >= 1);
  ALTER TABLE jobs ADD COLUMN pdf_piece INTEGER CHECK (pdf_piece IS NULL OR pdf_piece >= 1);
  ALTER TABLE jobs ADD COLUMN pdf_bitmap TEXT;
  `,
```

`src/main/storage/sqlite-job-store.ts`：

1. `JOB_COLUMNS` 末尾（批次三列之后）加 `,\n  jobs.pdf_file AS pdfFile, jobs.pdf_page AS pdfPage, jobs.pdf_piece AS pdfPiece, jobs.pdf_bitmap AS pdfBitmap`。
2. `insertJob` 的列表末尾加 `, pdf_file, pdf_page, pdf_piece, pdf_bitmap`，`VALUES` 末尾加 `, :pdfFile, :pdfPage, :pdfPiece, :pdfBitmap`。
3. `selectLastPrinted` 的条件末尾加 ` AND pdf_bitmap IS NULL`，`listLastPrinted` 的文档注释改为「扫码防重复窗口的恢复：只算扫码打的；本机接口、按字段重打（带调用方）、批量打印（带批次号）和 PDF 打印（带位图编号）都不用这个窗口」。
4. `append` 的参数对象末尾加：

```ts
        pdfFile: job.pdf?.file ?? null,
        pdfPage: job.pdf?.page ?? null,
        pdfPiece: job.pdf?.piece ?? null,
        pdfBitmap: job.pdf?.bitmap ?? null,
```

5. `toJobRecord` 在批次那段之后加：

```ts
  // 位图编号在，其余三项也必须在：readString / readInteger 遇到 NULL 抛错，坏行不当成合法记录。
  if (row['pdfBitmap'] !== null) {
    job.pdf = {
      file: readString(row, 'pdfFile'),
      page: readInteger(row, 'pdfPage'),
      piece: readInteger(row, 'pdfPiece'),
      bitmap: readString(row, 'pdfBitmap'),
    };
  }
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/storage src/core`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/types.ts src/core/testing/in-memory-job-store.ts src/main/storage
git commit -m "feat(records): record the file, page, piece and bitmap of PDF prints" -m "Migration 7 only adds four columns: the pdf source is already allowed by migration 6. A record keeps the cache key of its printed bitmap so it can be previewed and reprinted for a week, and PDF prints stay out of the scan dedup window on restart." -m "$TRAILER"
```

---

### Task 8: PrintService 记下 PDF；记录的位置文字、过期

**Files:**
- Modify: `src/core/print-service.ts`、`src/core/print-service.test.ts`
- Modify: `src/main/ipc.ts`（`PreviewJob` 的规则名）
- Modify: `src/renderer/src/lib/reprint.ts`、`reprint.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`、`status-text.test.ts`
- Modify: `src/renderer/src/components/JobLog.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 写测试**

`print-service.test.ts` 末尾加（import 加 `API_RULE`、`BATCH_RULE`、`fieldsRuleFor`、`PDF_RULE`）：

```ts
describe('PrintService.printFields for a PDF piece', () => {
  const pdf = { file: '面单.pdf', page: 2, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' };
  const pdfInput = {
    template: PICK_TEMPLATE,
    fields: [{ name: '文件', value: '面单.pdf' }],
    content: '面单.pdf 第 2 页第 1 张',
    source: 'pdf',
    caller: null,
    printerName: null,
    pdf,
  } as const;

  test('records the piece and names PDF printing as the rule', async () => {
    const { service, store, recorded } = createHarness();
    expect((await service.printFields(pdfInput)).status).toBe('printed');
    expect(store.listRecent(1)[0]).toMatchObject({ source: 'pdf', pdf });
    expect(recorded.at(-1)?.scan).toMatchObject({ ruleId: 'pdf', ruleName: 'PDF 打印' });
  });

  test('stays out of the scan dedup window after a restart', async () => {
    const { service } = createHarness();
    await service.printFields({ ...pdfInput, content: RAW });
    service.restore();
    expect((await service.submit(request())).status).toBe('printed');
  });
});

describe('fieldsRuleFor', () => {
  test('names the rule after where the fields came from', () => {
    expect(fieldsRuleFor({})).toBe(API_RULE);
    expect(fieldsRuleFor({ batch: { id: '20261002-143501-a1b2', row: 1, copy: 1 } })).toBe(BATCH_RULE);
    expect(fieldsRuleFor({ pdf: { file: 'a.pdf', page: 1, piece: 1, bitmap: 'k' } })).toBe(PDF_RULE);
  });
});
```

`reprint.test.ts`：文件顶部加 `const NOW = 1_800_000_000_000;`，把已有的每个 `reprintMode(x, y)` 调用改成 `reprintMode(x, y, NOW)`；import 加 `canReprint`、`PDF_PIECE_RETENTION_MS`（`../../../core/pdf/pdf-model`）；`describe` 里加：

```ts
  test('reprints PDF pieces from the cached bitmap for a week, then explains they expired', () => {
    const pdfJob: JobRecord = {
      id: 'p1',
      createdAt: NOW,
      raw: '面单.pdf 第 1 页第 1 张',
      printerName: 'P',
      source: 'pdf',
      status: 'printed',
      forced: false,
      paper: '100x150',
      templateId: 'builtin:pdf-piece',
      fields: [],
      pdf: { file: '面单.pdf', page: 1, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    };
    const noTemplates = () => false;
    expect(reprintMode(pdfJob, noTemplates, NOW + 1)).toBe('stored');
    expect(reprintMode({ ...pdfJob, source: 'history' }, noTemplates, NOW + 1)).toBe('stored');
    expect(reprintMode(pdfJob, noTemplates, NOW + PDF_PIECE_RETENTION_MS)).toBe('expired');
    expect(reprintMode({ ...pdfJob, status: 'invalid' }, noTemplates, NOW)).toBe('unavailable');
  });

  test('offers the reprint buttons only when a reprint can happen', () => {
    expect(canReprint('rescan')).toBe(true);
    expect(canReprint('stored')).toBe(true);
    expect(canReprint('expired')).toBe(false);
    expect(canReprint('unavailable')).toBe(false);
  });
```

`status-text.test.ts` 的 `describe('describeJobMeta')` 加：

```ts
  test('shows the page and piece of a PDF job', () => {
    const pdfJob = {
      ...job,
      source: 'pdf' as const,
      printerName: 'P',
      forced: false,
      pdf: { file: 'a.pdf', page: 2, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    };
    expect(describeJobMeta(pdfJob)).toContain('PDF（第 2 页第 1 张）');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/print-service.test.ts src/renderer/src/lib/reprint.test.ts src/renderer/src/lib/status-text.test.ts`
Expected: FAIL（`pdf` 不是 `FieldsPrint` 的字段；`fieldsRuleFor`、`PDF_RULE`、`canReprint` 没有导出；记录里没有 PDF 的位置）。

- [ ] **Step 3: 实现**

`src/core/print-service.ts`：

1. import 里加 `PdfRef`（按字母顺序放进 `./types` 那一组）。
2. `BATCH_RULE` 之后加：

```ts
/** PDF 打印的「规则」：备注变量 {规则} 和打印结果通知里显示为「PDF 打印」。 */
export const PDF_RULE = { id: 'pdf', name: 'PDF 打印' } as const;

/** 不经过识别规则的一张算在哪条「规则」名下：批量、PDF 各有名字，其余（本机接口和它的重打）是本机接口。 */
export function fieldsRuleFor(origin: { batch?: unknown; pdf?: unknown }): FieldsRule {
  if (origin.batch !== undefined) {
    return BATCH_RULE;
  }
  if (origin.pdf !== undefined) {
    return PDF_RULE;
  }
  return API_RULE;
}
```

3. `FieldsPrint` 末尾加：

```ts
  /** PDF 打印的一块（含从打印记录重打的）：写进打印记录；规则名记为「PDF 打印」。 */
  pdf?: PdfRef;
```

4. `printFields` 里 `const scan = fieldsScan(...)` 改为 `const scan = fieldsScan(input.content, input.fields, fieldsRuleFor(input));`，在 `if (input.batch !== undefined) { ... }` 之后加：

```ts
    if (input.pdf !== undefined) {
      request.pdf = input.pdf;
    }
```

5. `finish` 里 `batch` 那段之后加：

```ts
    if (request.pdf !== undefined) {
      job.pdf = request.pdf;
    }
```

`src/main/ipc.ts`：import 里把 `BATCH_RULE` 换成 `fieldsRuleFor`（`API_RULE` 不再用到就一起去掉）；`PreviewJob` 里 `scan: fieldsScan(job.raw, fields, job.batch === undefined ? API_RULE : BATCH_RULE),` 改为 `scan: fieldsScan(job.raw, fields, fieldsRuleFor(job)),`。

`src/renderer/src/lib/reprint.ts` 整个换成：

```ts
import { PDF_PIECE_RETENTION_MS } from '../../../core/pdf/pdf-model';
import type { JobRecord } from '../../../core/types';

/**
 * 打印记录的「预览」「重打」怎么做：
 * - rescan：扫码来的，照旧按内容重新识别（规则、加工步骤按现在的）；
 * - stored：本机接口、批量打印、PDF 打印来的，没有识别规则可用，按当时的模板和字段（PDF 按缓存的黑白位图）；
 * - expired：PDF 打印的，缓存的位图只留 7 天，已经过期；
 * - unavailable：做不了（识别不了的内容，或缺了模板、字段）。
 */
export type ReprintMode = 'rescan' | 'stored' | 'expired' | 'unavailable';

/**
 * 本机接口打的记录都带调用方，批量打的都带批次，PDF 打的都带位图编号；从它们重打出来的那一张来源是「记录重打」，
 * 也带着这些，同样按原样重打。hasTemplate 查模板是否还在：删掉了就不能按原样重打。now 是现在的时间（毫秒）。
 */
export function reprintMode(
  job: JobRecord,
  hasTemplate: (templateId: string) => boolean,
  now: number,
): ReprintMode {
  if (job.status === 'invalid') {
    return 'unavailable';
  }
  // PDF 的一块不在模板库里：按缓存的位图重打。主进程启动时才清理，这里按记录时间算，宁可早一点说过期。
  if (job.pdf !== undefined) {
    return now - job.createdAt < PDF_PIECE_RETENTION_MS ? 'stored' : 'expired';
  }
  if (job.source !== 'api' && job.source !== 'batch' && job.caller === undefined && job.batch === undefined) {
    return 'rescan';
  }
  return job.templateId !== undefined && job.fields !== undefined && hasTemplate(job.templateId)
    ? 'stored'
    : 'unavailable';
}

/** 显示「预览」「重打」按钮。 */
export function canReprint(mode: ReprintMode): boolean {
  return mode === 'rescan' || mode === 'stored';
}
```

（`rescan` 那一行照批量打印合并后的样子写；如果合并后的条件和上面不同，保留合并后的条件，只加 PDF 那一段和 `now` 参数。）

`src/renderer/src/lib/status-text.ts`：在 `describeJobMeta` 之前加：

```ts
/** 记录里批量打印、PDF 打印的位置：「（第 3 行第 2 份）」「（第 2 页第 1 张）」；其他来源没有。 */
function positionOf(job: JobRecord): string {
  if (job.batch !== undefined) {
    return `（第 ${job.batch.row} 行${job.batch.copy > 1 ? `第 ${job.batch.copy} 份` : ''}）`;
  }
  if (job.pdf !== undefined) {
    return `（第 ${job.pdf.page} 页第 ${job.pdf.piece} 张）`;
  }
  return '';
}
```

`describeJobMeta` 里 `const position = ...` 那一行换成 `const position = positionOf(job);`。`SOURCE_LABELS` 没有 `pdf` 时加 `pdf: 'PDF',`。

`src/renderer/src/App.tsx`：`reprintModeOf` 改为：

```ts
  const reprintModeOf = useCallback(
    (job: JobRecord) =>
      reprintMode(job, (id) => templates.templates.some((template) => template.id === id), Date.now()),
    [templates.templates],
  );
```

`src/renderer/src/components/JobLog.tsx`：import 改为 `import { canReprint, type ReprintMode } from '../lib/reprint';`；文件里每一处 `reprintModeOf(job) !== 'unavailable'` 换成 `canReprint(reprintModeOf(job))`；在 `job-row__meta` 那个元素之后加：

```tsx
              {reprintModeOf(job) === 'expired' && (
                <p className="job-row__hint">PDF 的图只保留 7 天，已过期：重新打开 PDF 再打</p>
              )}
```

`app.css` 在 `.job-row__meta` 那一段之后加：

```css
/* 不能重打的原因（例如 PDF 的图过期了）：和元信息同一字号，颜色更淡 */
.job-row__hint {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 12px;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core src/renderer/src/lib`
Expected: PASS。

- [ ] **Step 5: 检查后提交**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（记录的按钮对现有来源行为不变）。

```bash
git add src/core/print-service.ts src/core/print-service.test.ts src/main/ipc.ts src/renderer/src/lib/reprint.ts src/renderer/src/lib/reprint.test.ts src/renderer/src/lib/status-text.ts src/renderer/src/lib/status-text.test.ts src/renderer/src/components/JobLog.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(print): record PDF pieces and show their page in the records" -m "PDF pieces carry their file, page, piece and bitmap through printFields and are recorded under the rule PDF 打印. Records show the page and piece; once the cached bitmap is older than a week the record says so instead of offering a reprint that cannot work." -m "$TRAILER"
```

---

### Task 9: 黑白位图缓存（留 7 天）

缓存在数据目录的 `pdf-cache/`，一块一个文件（`<UUID>.lfm`）。打印时存下，打印记录的预览、重打读回并续期（从那时起再留 7 天）；启动时清掉 7 天没用过的。这是程序自己的缓存（和日志按天数保留一样），不是用户数据，清理不需要确认。

**Files:**
- Create: `src/main/pdf/piece-cache.ts`、`src/main/pdf/piece-cache.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/pdf/piece-cache.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { PDF_PIECE_RETENTION_MS } from '../../core/pdf/pdf-model';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { PieceCache } from './piece-cache';

const BITMAP: MonoBitmap = { width: 3, height: 2, bits: Uint8Array.of(1, 0, 1, 0, 1, 0) };
const NOW = 1_800_000_000_000;
const KEYS = ['0f8fad5b-d9cb-469f-a165-70867728950e', '7c9e6679-7425-40de-944b-e07fc1f90ae7'];

let dir: string;

beforeEach(async () => {
  dir = await createTempDir('piece-cache-');
});

afterEach(async () => {
  await removeTempDir(dir);
});

function cacheDir(): string {
  return join(dir, 'pdf-cache');
}

function createCache(): PieceCache {
  const keys = [...KEYS];
  return new PieceCache({ dir: cacheDir(), createKey: () => keys.shift() ?? 'no-more-keys', now: () => NOW });
}

/** 把文件的修改时间设到某个时刻（毫秒）。 */
async function setAge(key: string, at: number): Promise<void> {
  await utimes(join(cacheDir(), `${key}.lfm`), new Date(at), new Date(at));
}

describe('PieceCache', () => {
  test('saves a bitmap under a new key and reads it back', async () => {
    const cache = createCache();
    const key = await cache.save(BITMAP);
    expect(key).toBe(KEYS[0]);
    expect(await cache.load(key)).toEqual(BITMAP);
  });

  test('returns null for a missing piece or a key that is not ours', async () => {
    const cache = createCache();
    expect(await cache.load(KEYS[1] ?? '')).toBeNull();
    expect(await cache.load('../labelflash.db')).toBeNull();
  });

  test('removes pieces that will not be printed', async () => {
    const cache = createCache();
    const key = await cache.save(BITMAP);
    await cache.remove([key, '../labelflash.db']);
    expect(await cache.load(key)).toBeNull();
  });

  test('prunes pieces not used for a week and leaves other files alone', async () => {
    const cache = createCache();
    const old = await cache.save(BITMAP);
    const fresh = await cache.save(BITMAP);
    await setAge(old, NOW - PDF_PIECE_RETENTION_MS - 1);
    await setAge(fresh, NOW);
    await writeFile(join(cacheDir(), 'notes.txt'), 'keep');
    expect(await cache.prune(PDF_PIECE_RETENTION_MS)).toBe(1);
    expect((await readdir(cacheDir())).sort()).toEqual([`${fresh}.lfm`, 'notes.txt'].sort());
  });

  test('touching a piece keeps it for another week', async () => {
    const cache = createCache();
    const key = await cache.save(BITMAP);
    await setAge(key, NOW - PDF_PIECE_RETENTION_MS - 1);
    await cache.touch(key);
    expect((await stat(join(cacheDir(), `${key}.lfm`))).mtimeMs).toBe(NOW);
    expect(await cache.prune(PDF_PIECE_RETENTION_MS)).toBe(0);
  });

  test('prunes nothing when the folder does not exist yet', async () => {
    expect(await createCache().prune(PDF_PIECE_RETENTION_MS)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/pdf/piece-cache.test.ts`
Expected: FAIL，`Cannot find module './piece-cache'`。

- [ ] **Step 3: 实现**

```ts
// src/main/pdf/piece-cache.ts
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type MonoBitmap, packMono, unpackMono } from '../../core/pdf/mono-pack';

/** 缓存的编号是 UUID：从打印记录读回来的编号拼进路径之前先核对格式，挡住 ../ 这类内容。 */
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_SUFFIX = '.lfm';

export interface PieceCacheDeps {
  /** 数据目录下的 pdf-cache。 */
  dir: string;
  createKey: () => string;
  now: () => number;
}

/**
 * PDF 每一块的黑白位图（mono-pack 格式）：出块时存下，打印、从打印记录预览和重打时读回。
 * 按「最后一次用到」的时间（文件的修改时间）保留，启动时清理过期的；只碰本目录里本程序命名的文件。
 */
export class PieceCache {
  constructor(private readonly deps: PieceCacheDeps) {}

  async save(bitmap: MonoBitmap): Promise<string> {
    const key = this.deps.createKey();
    await mkdir(this.deps.dir, { recursive: true });
    await writeFile(this.pathOf(key), packMono(bitmap));
    return key;
  }

  /** 读回一块；编号不合格式、文件不在（已清理）或内容不对时返回 null。 */
  async load(key: string): Promise<MonoBitmap | null> {
    if (!KEY_PATTERN.test(key)) {
      return null;
    }
    try {
      return unpackMono(new Uint8Array(await readFile(this.pathOf(key))));
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  /** 又用到了（从打印记录预览、重打）：从现在起再留一个保留期。 */
  async touch(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) {
      return;
    }
    const at = new Date(this.deps.now());
    try {
      await utimes(this.pathOf(key), at, at);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  /** 删掉不会再打的块（换了设置、关了文件，而且没打过的）。 */
  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      if (KEY_PATTERN.test(key)) {
        await rm(this.pathOf(key), { force: true });
      }
    }
  }

  /** 删掉超过 maxAgeMs 没用过的块，返回删了几个。目录还不存在时什么也不做。 */
  async prune(maxAgeMs: number): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.deps.dir);
    } catch (error) {
      if (isMissing(error)) {
        return 0;
      }
      throw error;
    }
    const oldest = this.deps.now() - maxAgeMs;
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(FILE_SUFFIX) || !KEY_PATTERN.test(name.slice(0, -FILE_SUFFIX.length))) {
        continue;
      }
      const path = join(this.deps.dir, name);
      if ((await stat(path)).mtimeMs < oldest) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  private pathOf(key: string): string {
    return join(this.deps.dir, `${key}${FILE_SUFFIX}`);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/pdf`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/pdf/piece-cache.ts src/main/pdf/piece-cache.test.ts
git commit -m "feat(pdf): cache printed bitmaps for a week" -m "Each piece is stored as a small file named by a UUID in the data folder. Keys read back from the records are checked before they touch a path, previews and reprints extend the retention, and startup prunes files unused for a week without touching anything else in the folder." -m "$TRAILER"
```

---

### Task 10: 渲染协议和 PdfRenderHost

主进程和隐藏渲染页之间只有两种请求（打开、渲染一页）和三种回复（打开了、渲染好了、出错了）。渲染页里跑着第三方库和不可信的 PDF，它发回的每条消息主进程都重新核对：编号对得上、页数和页面大小合理、位图的宽高**等于主进程自己算出来的**、字节数等于宽 × 高。格式不对就关掉这个渲染页（可能已经被 PDF 攻破），不再用它；卡住（超时）同样关掉。

**Files:**
- Create: `src/shared/pdf-render-protocol.ts`、`src/shared/pdf-render-protocol.test.ts`
- Create: `src/main/pdf/pdf-render-host.ts`、`src/main/pdf/pdf-render-host.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/shared/pdf-render-protocol.test.ts
import { describe, expect, test } from 'bun:test';
import { PDF_LIMITS } from '../core/pdf/pdf-model';
import { readRenderReply, renderedSize, renderScale, rgbaToGray } from './pdf-render-protocol';

const A4 = { width: 595, height: 842 };

describe('renderScale', () => {
  test('renders at the printer resolution', () => {
    expect(renderScale(A4, 203, PDF_LIMITS.pagePixels)).toBeCloseTo(203 / 72);
  });

  test('lowers the resolution of very large pages to stay under the pixel limit', () => {
    const a0 = { width: 2384, height: 3370 };
    const size = renderedSize(a0, renderScale(a0, 300, PDF_LIMITS.pagePixels));
    expect(size.width * size.height).toBeLessThanOrEqual(PDF_LIMITS.pagePixels);
    expect(size.width * size.height).toBeGreaterThan(PDF_LIMITS.pagePixels * 0.99);
  });

  test('keeps both sides within the canvas limit', () => {
    const strip = { width: 14_400, height: 10 };
    expect(renderedSize(strip, renderScale(strip, 600, Number.MAX_SAFE_INTEGER)).width).toBeLessThanOrEqual(32_767);
  });
});

describe('rgbaToGray', () => {
  test('weighs the channels like the eye and treats transparency as paper', () => {
    const gray = new Uint8Array(4);
    rgbaToGray(Uint8ClampedArray.of(0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0), gray);
    expect([...gray]).toEqual([0, 255, 76, 255]);
  });
});

describe('readRenderReply', () => {
  const opened = { id: 1, kind: 'opened', maxPages: 200 } as const;
  const rendered = { id: 2, kind: 'rendered', width: 2, height: 1 } as const;

  test('accepts the page list of an opened document', () => {
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 2, pages: [A4, A4] }, opened)).toEqual({
      id: 1,
      kind: 'opened',
      pageCount: 2,
      pages: [A4, A4],
    });
  });

  // 页数超过上限时渲染页不逐页读大小：主进程按页数拒绝这个文件。
  test('accepts a page count over the limit without page sizes', () => {
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 300, pages: [] }, opened)).toMatchObject({
      pageCount: 300,
    });
  });

  test('refuses page lists that do not add up or have impossible sizes', () => {
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 2, pages: [A4] }, opened)).toBeNull();
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 1, pages: [{ width: 0, height: 842 }] }, opened)).toBeNull();
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 1, pages: [{ width: 20_000, height: 842 }] }, opened)).toBeNull();
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: -1, pages: [] }, opened)).toBeNull();
  });

  test('accepts a bitmap of exactly the size the main process expects', () => {
    const gray = new Uint8Array(2);
    expect(readRenderReply({ id: 2, kind: 'rendered', width: 2, height: 1, gray }, rendered)).toEqual({
      id: 2,
      kind: 'rendered',
      width: 2,
      height: 1,
      gray,
    });
  });

  test('refuses bitmaps of another size or type', () => {
    expect(readRenderReply({ id: 2, kind: 'rendered', width: 2, height: 1, gray: new Uint8Array(3) }, rendered)).toBeNull();
    expect(readRenderReply({ id: 2, kind: 'rendered', width: 3, height: 1, gray: new Uint8Array(3) }, rendered)).toBeNull();
    expect(readRenderReply({ id: 2, kind: 'rendered', width: 2, height: 1, gray: [0, 0] }, rendered)).toBeNull();
  });

  test('passes on known errors with a bounded detail', () => {
    expect(readRenderReply({ id: 2, kind: 'error', error: 'password', detail: 'x'.repeat(600) }, rendered)).toEqual({
      id: 2,
      kind: 'error',
      error: 'password',
      detail: 'x'.repeat(500),
    });
    expect(readRenderReply({ id: 2, kind: 'error', error: 'boom', detail: '' }, rendered)).toBeNull();
  });

  test('refuses replies to another request and non-objects', () => {
    expect(readRenderReply({ id: 3, kind: 'rendered', width: 2, height: 1, gray: new Uint8Array(2) }, rendered)).toBeNull();
    expect(readRenderReply('x', rendered)).toBeNull();
  });
});
```

```ts
// src/main/pdf/pdf-render-host.test.ts
import { describe, expect, test } from 'bun:test';
import type { RenderRequest } from '../../shared/pdf-render-protocol';
import { PDF_ISSUES, PdfRenderHost, type RenderPort } from './pdf-render-host';

const A4 = { width: 595, height: 842 };

class FakePort implements RenderPort {
  readonly sent: RenderRequest[] = [];
  closed = false;
  private replyListener: ((message: unknown) => void) | null = null;
  private goneListener: (() => void) | null = null;

  send(request: RenderRequest): void {
    this.sent.push(request);
  }

  onReply(listener: (message: unknown) => void): void {
    this.replyListener = listener;
  }

  onGone(listener: () => void): void {
    this.goneListener = listener;
  }

  close(): void {
    this.closed = true;
  }

  reply(message: unknown): void {
    this.replyListener?.(message);
  }

  gone(): void {
    this.goneListener?.();
  }
}

/** 等 openPort 和发请求之间的微任务跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function createHost() {
  const ports: FakePort[] = [];
  const timers: (() => void)[] = [];
  const logs: string[] = [];
  const host = new PdfRenderHost({
    openPort: async () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    openTimeoutMs: 20_000,
    pageTimeoutMs: 30_000,
    schedule: (run) => {
      timers.push(run);
      return () => {
        timers.splice(timers.indexOf(run), 1);
      };
    },
    log: (line) => logs.push(line),
  });
  return { host, ports, timers, logs };
}

/** 打开一个一页的 A4。 */
async function opened() {
  const harness = createHost();
  const opening = harness.host.open(Uint8Array.of(1));
  await settle();
  const port = harness.ports[0];
  if (port === undefined) {
    throw new Error('no render page was opened');
  }
  port.reply({ id: port.sent[0]?.id, kind: 'opened', pageCount: 1, pages: [A4] });
  await opening;
  return { ...harness, port };
}

describe('PdfRenderHost', () => {
  test('opens a document in a new render page and lists its pages', async () => {
    const { host, ports } = createHost();
    const opening = host.open(Uint8Array.of(1, 2));
    await settle();
    const request = ports[0]?.sent[0];
    expect(request).toMatchObject({ kind: 'open', data: Uint8Array.of(1, 2) });
    ports[0]?.reply({ id: request?.id, kind: 'opened', pageCount: 1, pages: [A4] });
    expect(await opening).toEqual({ pageCount: 1, pages: [A4] });
  });

  test('renders a page at the requested resolution', async () => {
    const { host, port } = await opened();
    const rendering = host.render(1, A4, 72);
    const request = port.sent[1];
    expect(request).toMatchObject({ kind: 'render', page: 1, scale: 1 });
    port.reply({ id: request?.id, kind: 'rendered', width: 595, height: 842, gray: new Uint8Array(595 * 842) });
    const { image, dpi } = await rendering;
    expect([image.width, image.height, dpi]).toEqual([595, 842, 72]);
  });

  test('refuses a bitmap of the wrong size and stops using that render page', async () => {
    const { host, port, logs } = await opened();
    const rendering = host.render(1, A4, 72);
    port.reply({ id: port.sent[1]?.id, kind: 'rendered', width: 594, height: 842, gray: new Uint8Array(594 * 842) });
    await expect(rendering).rejects.toMatchObject({ issue: PDF_ISSUES.failed });
    expect(port.closed).toBe(true);
    expect(logs.join('\n')).toContain('malformed');
  });

  test('explains a password-protected PDF', async () => {
    const { host, ports } = createHost();
    const opening = host.open(Uint8Array.of(1));
    await settle();
    ports[0]?.reply({ id: ports[0]?.sent[0]?.id, kind: 'error', error: 'password', detail: 'PasswordException' });
    await expect(opening).rejects.toMatchObject({ issue: PDF_ISSUES.password });
  });

  test('gives up on a page that takes too long and closes the stuck render page', async () => {
    const { host, port, timers, logs } = await opened();
    const rendering = host.render(1, A4, 203);
    timers[0]?.();
    await expect(rendering).rejects.toMatchObject({ issue: PDF_ISSUES.timeout });
    expect(port.closed).toBe(true);
    expect(logs.join('\n')).toContain('timed out');
  });

  test('fails waiting requests when the render page dies', async () => {
    const { host, port } = await opened();
    const rendering = host.render(1, A4, 203);
    port.gone();
    await expect(rendering).rejects.toMatchObject({ issue: PDF_ISSUES.gone });
  });

  test('closes the previous render page when another PDF is opened', async () => {
    const { host, port, ports } = await opened();
    void host.open(Uint8Array.of(2)).catch(() => undefined);
    await settle();
    expect(port.closed).toBe(true);
    expect(ports).toHaveLength(2);
  });

  test('refuses to render before a PDF is open', async () => {
    const { host } = createHost();
    await expect(host.render(1, A4, 203)).rejects.toMatchObject({ issue: PDF_ISSUES.gone });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/pdf-render-protocol.test.ts src/main/pdf/pdf-render-host.test.ts`
Expected: FAIL，两个模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/shared/pdf-render-protocol.ts
/**
 * 主进程和隐藏的 PDF 渲染页之间的消息（main/pdf/pdf-render-host.ts ↔ renderer/src/pdf-render/main.ts）。
 * 渲染页里跑着 pdf.js（第三方库）和不可信的 PDF，它发回的每条消息主进程都用 readRenderReply 重新核对。
 * 这个文件主进程和渲染页都用：不碰 DOM、Node、Electron。
 */

export const PDF_RENDER_CHANNELS = { request: 'pdf-render:request', reply: 'pdf-render:reply' } as const;

/** PDF 的长度单位是点：1/72 英寸。 */
export const POINTS_PER_INCH = 72;
/** 一页最大 14400 点（200 英寸）：PDF 规范里页面尺寸的上限。 */
export const MAX_PAGE_POINTS = 14_400;
/** Chromium 画布的边长上限（像素）。 */
const MAX_CANVAS_SIDE = 32_767;
/** 出错说明最多 500 个字：只写日志，更长的截掉。 */
const MAX_DETAIL_LENGTH = 500;

/** 一页的大小（点），已经按页面自带的旋转转好。 */
export interface PageSize {
  width: number;
  height: number;
}

export type RenderRequest =
  | { id: number; kind: 'open'; data: Uint8Array }
  /** page 从 1 数；scale = 每点多少像素。 */
  | { id: number; kind: 'render'; page: number; scale: number };

/** password = 要密码；invalid = 不是 PDF 或文件坏了；failed = 其他错误。 */
export const RENDER_ERRORS = ['password', 'invalid', 'failed'] as const;
export type RenderError = (typeof RENDER_ERRORS)[number];

export type RenderReply =
  /** 页数超过主进程给的上限时 pages 为空（不逐页读几千页）。 */
  | { id: number; kind: 'opened'; pageCount: number; pages: PageSize[] }
  /** 8 位灰度，逐行，0 黑 – 255 白。 */
  | { id: number; kind: 'rendered'; width: number; height: number; gray: Uint8Array }
  | { id: number; kind: 'error'; error: RenderError; detail: string };

/** 渲染页能用的全部能力：preload 用 contextBridge 暴露成 window.pdfHost。 */
export interface PdfHostApi {
  onRequest(listener: (request: RenderRequest) => void): void;
  reply(reply: RenderReply): void;
}

/** 主进程在等的回复：编号、种类，以及它自己算好的位图宽高。 */
export type ExpectedReply =
  | { id: number; kind: 'opened'; maxPages: number }
  | { id: number; kind: 'rendered'; width: number; height: number };

/** 按 dpi 渲染这一页用的缩放（每点多少像素）；像素数或边长超过上限时等比降低（海报这类特大的页）。 */
export function renderScale(page: PageSize, dpi: number, maxPixels: number): number {
  let scale = dpi / POINTS_PER_INCH;
  const pixels = page.width * page.height * scale * scale;
  if (pixels > maxPixels) {
    scale *= Math.sqrt(maxPixels / pixels);
  }
  const side = Math.max(page.width, page.height) * scale;
  if (side > MAX_CANVAS_SIDE) {
    scale *= MAX_CANVAS_SIDE / side;
  }
  return scale;
}

/** 渲染出来的位图大小：渲染页和主进程都用这一个算式，主进程据此核对回来的位图。 */
export function renderedSize(page: PageSize, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(page.width * scale)),
    height: Math.max(1, Math.floor(page.height * scale)),
  };
}

/** RGBA → 8 位灰度（ITU-R BT.601：0.299R + 0.587G + 0.114B）；透明的地方按白纸算。 */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, gray: Uint8Array): void {
  for (let index = 0; index < gray.length; index += 1) {
    const at = index * 4;
    const luma = ((rgba[at] ?? 255) * 299 + (rgba[at + 1] ?? 255) * 587 + (rgba[at + 2] ?? 255) * 114) / 1000;
    const alpha = rgba[at + 3] ?? 255;
    gray[index] = Math.round(255 - ((255 - luma) * alpha) / 255);
  }
}

/** 渲染页的回复 → 核对过的回复；编号、种类、大小任何一项对不上都返回 null。 */
export function readRenderReply(message: unknown, expected: ExpectedReply): RenderReply | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const reply = message as Record<string, unknown>;
  if (reply['id'] !== expected.id) {
    return null;
  }
  if (reply['kind'] === 'error') {
    return readError(expected.id, reply);
  }
  return expected.kind === 'opened' ? readOpened(reply, expected) : readRendered(reply, expected);
}

function readError(id: number, reply: Record<string, unknown>): RenderReply | null {
  const error = reply['error'];
  const detail = reply['detail'];
  if (!(RENDER_ERRORS as readonly unknown[]).includes(error) || typeof detail !== 'string') {
    return null;
  }
  return { id, kind: 'error', error: error as RenderError, detail: detail.slice(0, MAX_DETAIL_LENGTH) };
}

function isPageSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PAGE_POINTS;
}

function readPageSize(value: unknown): PageSize | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { width, height } = value as { width?: unknown; height?: unknown };
  return isPageSide(width) && isPageSide(height) ? { width, height } : null;
}

function readOpened(
  reply: Record<string, unknown>,
  expected: Extract<ExpectedReply, { kind: 'opened' }>,
): RenderReply | null {
  const pageCount = reply['pageCount'];
  const pages = reply['pages'];
  if (
    reply['kind'] !== 'opened' ||
    typeof pageCount !== 'number' ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 0 ||
    !Array.isArray(pages) ||
    pages.length !== (pageCount <= expected.maxPages ? pageCount : 0)
  ) {
    return null;
  }
  const sizes: PageSize[] = [];
  for (const page of pages) {
    const size = readPageSize(page);
    if (size === null) {
      return null;
    }
    sizes.push(size);
  }
  return { id: expected.id, kind: 'opened', pageCount, pages: sizes };
}

function readRendered(
  reply: Record<string, unknown>,
  expected: Extract<ExpectedReply, { kind: 'rendered' }>,
): RenderReply | null {
  const gray = reply['gray'];
  if (
    reply['kind'] !== 'rendered' ||
    reply['width'] !== expected.width ||
    reply['height'] !== expected.height ||
    !(gray instanceof Uint8Array) ||
    gray.length !== expected.width * expected.height
  ) {
    return null;
  }
  return { id: expected.id, kind: 'rendered', width: expected.width, height: expected.height, gray };
}
```

```ts
// src/main/pdf/pdf-render-host.ts
import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import type { GrayImage } from '../../core/templates/mono-image';
import {
  type ExpectedReply,
  type PageSize,
  POINTS_PER_INCH,
  type RenderReply,
  type RenderRequest,
  readRenderReply,
  renderedSize,
  renderScale,
} from '../../shared/pdf-render-protocol';

/** 渲染页这一端：index.ts 用隐藏窗口实现（pdf-render-window.ts），测试里换成假的。 */
export interface RenderPort {
  send(request: RenderRequest): void;
  onReply(listener: (message: unknown) => void): void;
  /** 渲染页崩溃、被关掉时调用。 */
  onGone(listener: () => void): void;
  close(): void;
}

export interface PdfRenderHostDeps {
  openPort: () => Promise<RenderPort>;
  openTimeoutMs: number;
  pageTimeoutMs: number;
  schedule: (run: () => void, delayMs: number) => () => void;
  log: (line: string) => void;
}

/** 给用户看的原因（中文、带下一步）；原始的英文错误另写日志。 */
export const PDF_ISSUES = {
  password: 'PDF 加了密码：先在 PDF 阅读器里另存一份不带密码的再打',
  invalid: '打不开这个 PDF：文件不完整或不是 PDF。重新导出或下载一次再试',
  failed: '这个 PDF 渲染出错：重新导出一次再试，详细原因已写入日志',
  timeout: 'PDF 渲染超时：页面太复杂或文件有问题。重新导出一次再试',
  gone: 'PDF 渲染进程意外退出：重新选择这个文件再试',
} as const;

/** 打不开、渲染失败：issue 是给用户看的中文，message 是写日志的原始说明。 */
export class PdfRenderError extends Error {
  constructor(
    readonly issue: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'PdfRenderError';
  }
}

export interface OpenedPdf {
  pageCount: number;
  /** 每页大小（点）；页数超过上限时为空。 */
  pages: PageSize[];
}

export interface RenderedPage {
  image: GrayImage;
  /** 实际用的分辨率：特大的页会低于要求的 dpi。 */
  dpi: number;
}

interface Waiter {
  expected: ExpectedReply;
  resolve: (reply: RenderReply) => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
}

/**
 * 主进程这一侧的 PDF 渲染：一次只开一个渲染页（一个 PDF），请求带编号、各自限时。
 * 渲染页不可信：回复格式不对、超时都关掉它，下次打开文件时新建。
 */
export class PdfRenderHost {
  private port: RenderPort | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiter>();

  constructor(private readonly deps: PdfRenderHostDeps) {}

  /** 打开一个 PDF（关掉上一个）。打不开时抛 PdfRenderError。 */
  async open(data: Uint8Array): Promise<OpenedPdf> {
    this.close();
    const port = await this.deps.openPort();
    this.port = port;
    port.onReply((message) => this.receive(port, message));
    port.onGone(() => {
      if (this.port === port) {
        this.deps.log('[pdf] the render page is gone');
        this.drop(new PdfRenderError(PDF_ISSUES.gone, 'render page is gone'));
      }
    });
    const reply = await this.request(
      (id) => ({ id, kind: 'open', data }),
      (id) => ({ id, kind: 'opened', maxPages: PDF_LIMITS.pages }),
      this.deps.openTimeoutMs,
    );
    if (reply.kind !== 'opened') {
      throw new PdfRenderError(PDF_ISSUES.failed, `unexpected ${reply.kind} reply to open`);
    }
    return { pageCount: reply.pageCount, pages: reply.pages };
  }

  /** 把第 page 页（从 1 数）按 dpi 渲染成灰度；像素超过上限时自动降低分辨率，实际用的 dpi 一起返回。 */
  async render(page: number, size: PageSize, dpi: number): Promise<RenderedPage> {
    const scale = renderScale(size, dpi, PDF_LIMITS.pagePixels);
    const expected = renderedSize(size, scale);
    const reply = await this.request(
      (id) => ({ id, kind: 'render', page, scale }),
      (id) => ({ id, kind: 'rendered', width: expected.width, height: expected.height }),
      this.deps.pageTimeoutMs,
    );
    if (reply.kind !== 'rendered') {
      throw new PdfRenderError(PDF_ISSUES.failed, `unexpected ${reply.kind} reply to render`);
    }
    return { image: { width: reply.width, height: reply.height, pixels: reply.gray }, dpi: scale * POINTS_PER_INCH };
  }

  /** 关掉渲染页（换文件、关文件、退出时）；还在等的请求都失败。 */
  close(): void {
    this.drop(new PdfRenderError(PDF_ISSUES.gone, 'render page closed'));
  }

  private drop(error: PdfRenderError): void {
    const port = this.port;
    this.port = null;
    port?.close();
    const waiters = [...this.waiting.values()];
    this.waiting.clear();
    for (const waiter of waiters) {
      waiter.cancelTimer();
      waiter.reject(error);
    }
  }

  private request(
    build: (id: number) => RenderRequest,
    expect: (id: number) => ExpectedReply,
    timeoutMs: number,
  ): Promise<RenderReply> {
    const port = this.port;
    if (port === null) {
      return Promise.reject(new PdfRenderError(PDF_ISSUES.gone, 'no PDF is open'));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const cancelTimer = this.deps.schedule(() => {
        this.waiting.delete(id);
        this.deps.log(`[pdf] render request ${id} timed out after ${timeoutMs}ms`);
        reject(new PdfRenderError(PDF_ISSUES.timeout, 'timed out'));
        // 卡住的渲染页不能再用：关掉它，下次打开文件时新建。
        this.drop(new PdfRenderError(PDF_ISSUES.timeout, 'another request timed out'));
      }, timeoutMs);
      this.waiting.set(id, { expected: expect(id), resolve, reject, cancelTimer });
      port.send(build(id));
    });
  }

  private receive(port: RenderPort, message: unknown): void {
    if (port !== this.port) {
      return; // 已经关掉的渲染页迟到的回复
    }
    const id = typeof message === 'object' && message !== null ? (message as { id?: unknown }).id : undefined;
    if (typeof id !== 'number') {
      this.deps.log('[pdf] ignored a reply without a request id');
      return;
    }
    const waiter = this.waiting.get(id);
    if (waiter === undefined) {
      this.deps.log(`[pdf] ignored a reply to request ${id} that nobody is waiting for`);
      return;
    }
    this.waiting.delete(id);
    waiter.cancelTimer();
    const reply = readRenderReply(message, waiter.expected);
    if (reply === null) {
      this.deps.log(`[pdf] the render page sent a malformed reply to request ${id}`);
      waiter.reject(new PdfRenderError(PDF_ISSUES.failed, 'malformed reply'));
      // 回复不合格式说明渲染页出了问题（甚至被 PDF 攻破）：不再用它。
      this.drop(new PdfRenderError(PDF_ISSUES.failed, 'render page sent a malformed reply'));
      return;
    }
    if (reply.kind === 'error') {
      this.deps.log(`[pdf] the render page reported ${reply.error}: ${reply.detail}`);
      waiter.reject(new PdfRenderError(PDF_ISSUES[reply.error], reply.detail));
      return;
    }
    waiter.resolve(reply);
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/pdf-render-protocol.test.ts src/main/pdf`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/pdf-render-protocol.ts src/shared/pdf-render-protocol.test.ts src/main/pdf/pdf-render-host.ts src/main/pdf/pdf-render-host.test.ts
git commit -m "feat(pdf): talk to the render page with checked replies and timeouts" -m "The main process computes the size of every bitmap it asks for and accepts only a reply of exactly that size and type. A malformed reply or a page that hangs closes the render page for good; errors become Chinese hints and the raw message goes to the log." -m "$TRAILER"
```

---

### Task 11: 隐藏的渲染页（pdf.js、preload、会话、构建）

**Files:**
- Create: `src/renderer/pdf-render.html`、`src/renderer/src/pdf-render/main.ts`
- Create: `src/preload/pdf-render.ts`
- Create: `src/main/pdf/render-session-policy.ts`、`src/main/pdf/render-session-policy.test.ts`
- Create: `src/main/pdf/pdf-render-window.ts`
- Create: `scripts/pdfjs-assets.ts`、`scripts/pdfjs-assets.test.ts`
- Modify: `src/main/app-protocol.ts`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/pdf/render-session-policy.test.ts
import { describe, expect, test } from 'bun:test';
import { isAllowedRenderRequest } from './render-session-policy';

describe('isAllowedRenderRequest', () => {
  test('lets the render page read only files of the app', () => {
    expect(isAllowedRenderRequest('app://bundle/pdfjs/cmaps/UniGB-UCS2-H.bcmap', null)).toBe(true);
    expect(isAllowedRenderRequest('app://other/x', null)).toBe(false);
    expect(isAllowedRenderRequest('https://example.com/a.js', null)).toBe(false);
    expect(isAllowedRenderRequest('file:///C:/Windows/win.ini', null)).toBe(false);
    expect(isAllowedRenderRequest('not a url', null)).toBe(false);
  });

  test('allows fonts and images that pdf.js builds in the page', () => {
    expect(isAllowedRenderRequest('data:font/ttf;base64,AAAA', null)).toBe(true);
    expect(isAllowedRenderRequest('blob:app://bundle/1234', null)).toBe(true);
  });

  test('allows the local dev server only in the dev build', () => {
    expect(isAllowedRenderRequest('http://localhost:5173/pdf-render.html', 'http://localhost:5173')).toBe(true);
    expect(isAllowedRenderRequest('ws://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedRenderRequest('http://localhost:5174/x', 'http://localhost:5173')).toBe(false);
    expect(isAllowedRenderRequest('http://localhost:5173/pdf-render.html', null)).toBe(false);
  });
});
```

```ts
// scripts/pdfjs-assets.test.ts
import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir, removeTempDir } from '../src/main/storage/testing/temp-dir';
import { pdfjsAssetFiles, pdfjsPackageDir } from './pdfjs-assets';

describe('pdfjsAssetFiles', () => {
  test('publishes the runtime files of pdf.js under fixed paths', async () => {
    const dir = await createTempDir('pdfjs-assets-');
    try {
      for (const sub of ['cmaps', 'cmaps/nested', 'standard_fonts', 'wasm']) {
        await mkdir(join(dir, sub), { recursive: true });
      }
      await writeFile(join(dir, 'cmaps', 'UniGB-UCS2-H.bcmap'), 'x');
      await writeFile(join(dir, 'standard_fonts', 'FoxitSans.pfb'), 'x');
      await writeFile(join(dir, 'wasm', 'openjpeg.wasm'), 'x');
      const files = pdfjsAssetFiles(dir);
      expect(files.map((file) => file.fileName).sort()).toEqual([
        'pdfjs/cmaps/UniGB-UCS2-H.bcmap',
        'pdfjs/standard_fonts/FoxitSans.pfb',
        'pdfjs/wasm/openjpeg.wasm',
      ]);
      expect(files.find((file) => file.fileName.endsWith('.bcmap'))?.path).toBe(
        join(dir, 'cmaps', 'UniGB-UCS2-H.bcmap'),
      );
    } finally {
      await removeTempDir(dir);
    }
  });

  test('finds the installed package and its character maps', () => {
    expect(pdfjsAssetFiles(pdfjsPackageDir()).some((file) => file.fileName.startsWith('pdfjs/cmaps/'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/pdf/render-session-policy.test.ts scripts/pdfjs-assets.test.ts`
Expected: FAIL，两个模块不存在。

- [ ] **Step 3: 会话策略和构建插件**

```ts
// src/main/pdf/render-session-policy.ts
import { APP_HOST, APP_SCHEME } from '../bundle-path';

/**
 * PDF 渲染页的会话放行哪些请求：只许读本程序的文件（app://bundle/），以及 pdf.js 在页内生成的 data:、blob:（字体、图片，不出本机）。
 * 开发版另外放行本机的开发服务器（页面和热更新）。其余一律拦下：被攻破的渲染页也连不了网、读不了本机文件。
 */
export function isAllowedRenderRequest(url: string, devServerUrl: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_SCHEME}:`) {
    return parsed.host === APP_HOST;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
    return true;
  }
  if (devServerUrl === null) {
    return false;
  }
  const dev = new URL(devServerUrl);
  return (parsed.protocol === 'http:' || parsed.protocol === 'ws:') && parsed.host === dev.host;
}
```

```ts
// scripts/pdfjs-assets.ts
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** pdf.js 运行时按需读取的文件：字符映射（中文等非嵌入字体要用）、PDF 标准 14 种字体、图像解码器（wasm）。 */
export const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm'] as const;
/** 在渲染进程产物里的位置：app://bundle/pdfjs/<目录>/<文件>，渲染页按这个固定路径读。 */
export const PDFJS_ASSET_BASE = 'pdfjs';

export interface AssetFile {
  /** 产物里的路径。 */
  fileName: string;
  /** 源文件。 */
  path: string;
}

/** 这几个目录里的文件（不进子目录），一一对应到产物里的固定路径。 */
export function pdfjsAssetFiles(packageDir: string): AssetFile[] {
  return PDFJS_ASSET_DIRS.flatMap((dir) =>
    readdirSync(join(packageDir, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ fileName: `${PDFJS_ASSET_BASE}/${dir}/${entry.name}`, path: join(packageDir, dir, entry.name) })),
  );
}

export function pdfjsPackageDir(): string {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
}

/**
 * 构建渲染进程时把 pdf.js 的运行时文件原样放进产物（不打包、不改名）；开发服务器上按同样的路径提供。
 * 自己写这几行，不为复制文件引入新的插件依赖。
 */
export function pdfjsAssets(): Plugin {
  return {
    name: 'labelflash-pdfjs-assets',
    configureServer(server) {
      const files = new Map(pdfjsAssetFiles(pdfjsPackageDir()).map((file) => [`/${file.fileName}`, file.path]));
      server.middlewares.use((request, response, next) => {
        const path = files.get((request.url ?? '').split('?')[0] ?? '');
        if (path === undefined) {
          next();
          return;
        }
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const file of pdfjsAssetFiles(pdfjsPackageDir())) {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: readFileSync(file.path) });
      }
    },
  };
}
```

（Task 1 Step 3 第 4、5 条的结果在这里落实：没有 `wasm/` 就从 `PDFJS_ASSET_DIRS` 去掉，测试里的 `wasm` 一并去掉；`pdfjsPackageDir` 按那里核对的写法。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/pdf/render-session-policy.test.ts scripts/pdfjs-assets.test.ts`
Expected: PASS。

- [ ] **Step 5: 渲染页**

```html
<!-- src/renderer/pdf-render.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>PDF 渲染</title>
    <!--
      只渲染 PDF 的隐藏页（见 src/main/pdf/pdf-render-window.ts）：没有 http、ws，只读本程序的文件
      （pdf.js 的脚本和 worker、字符映射、字体、解码器）。wasm-unsafe-eval 只允许编译 WebAssembly（pdf.js 的图像解码器），
      不允许 eval 脚本；字体和图片由 pdf.js 在页内生成（data:、blob:）。
    -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data: blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
  </head>
  <body>
    <script type="module" src="/src/pdf-render/main.ts"></script>
  </body>
</html>
```

```ts
// src/renderer/src/pdf-render/main.ts
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_LIMITS } from '../../../core/pdf/pdf-model';
import {
  type PageSize,
  type PdfHostApi,
  type RenderError,
  type RenderReply,
  type RenderRequest,
  renderedSize,
  rgbaToGray,
} from '../../../shared/pdf-render-protocol';

/**
 * 隐藏的 PDF 渲染页（主进程的 pdf-render-window.ts 打开，不显示）：用 pdf.js 把页面画到画布上，转成灰度交回主进程。
 * PDF 不可信，所以这一页开 sandbox、不连网、没有 Node，只能经 window.pdfHost 收请求、回结果；
 * 不碰主窗口的 window.api，也不属于界面的 MVVM 分层（它没有界面）。
 */

declare global {
  interface Window {
    pdfHost: PdfHostApi;
  }
}

/** pdf.js 的运行时文件在产物里的位置（见 scripts/pdfjs-assets.ts）。 */
const ASSETS = new URL('pdfjs/', document.baseURI);

GlobalWorkerOptions.workerSrc = workerUrl;

let current: PDFDocumentProxy | null = null;

window.pdfHost.onRequest((request) => {
  void handle(request).then(
    (reply) => window.pdfHost.reply(reply),
    (error: unknown) => window.pdfHost.reply(failure(request.id, error)),
  );
});

function handle(request: RenderRequest): Promise<RenderReply> {
  return request.kind === 'open' ? open(request.id, request.data) : render(request.id, request.page, request.scale);
}

async function open(id: number, data: Uint8Array): Promise<RenderReply> {
  await current?.destroy();
  current = null;
  const pdf = await getDocument({
    data,
    cMapUrl: new URL('cmaps/', ASSETS).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', ASSETS).href,
    wasmUrl: new URL('wasm/', ASSETS).href,
    // 不读 XFA 表单；缺字体时用随包的标准字体而不是系统字体：同一个 PDF 在每台电脑上打出来一样。
    enableXfa: false,
    useSystemFonts: false,
  }).promise;
  current = pdf;
  const pages: PageSize[] = [];
  // 页数超过上限时不逐页读大小（几千页要读很久），主进程按页数拒绝。
  if (pdf.numPages <= PDF_LIMITS.pages) {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      page.cleanup();
    }
  }
  return { id, kind: 'opened', pageCount: pdf.numPages, pages };
}

async function render(id: number, number: number, scale: number): Promise<RenderReply> {
  if (current === null) {
    throw new Error('no document is open');
  }
  const page = await current.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const size = renderedSize({ width: base.width, height: base.height }, scale);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (context === null) {
    throw new Error('2d canvas is not available');
  }
  // 先铺白纸：PDF 里透明的地方按白纸打。
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  // intent: 'print' 和打印 PDF 一样画表单里填的内容、不画只在屏幕上显示的批注。
  await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), intent: 'print' })
    .promise;
  const gray = new Uint8Array(size.width * size.height);
  rgbaToGray(context.getImageData(0, 0, size.width, size.height).data, gray);
  page.cleanup();
  // 马上放掉画布：一页最多 1600 万像素，RGBA 就是 64MB。
  canvas.width = 0;
  canvas.height = 0;
  return { id, kind: 'rendered', width: size.width, height: size.height, gray };
}

/** pdf.js 的异常名：PasswordException（要密码）、InvalidPDFException（不是 PDF 或坏了）。 */
function failure(id: number, error: unknown): RenderReply {
  const name = error instanceof Error ? error.name : '';
  const kind: RenderError =
    name === 'PasswordException' ? 'password' : name === 'InvalidPDFException' ? 'invalid' : 'failed';
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { id, kind: 'error', error: kind, detail };
}
```

（Task 1 Step 3 第 2、3 条的结果在这里落实：`isEvalSupported`、`canvas` / `canvasContext` 按安装的版本取舍。）

```ts
// src/preload/pdf-render.ts
import { contextBridge, ipcRenderer } from 'electron';
import { PDF_RENDER_CHANNELS, type PdfHostApi, type RenderRequest } from '../shared/pdf-render-protocol';

/**
 * PDF 渲染页的 preload：只暴露「收请求」「回结果」两个函数，不暴露 ipcRenderer 本身。
 * 跑着不可信 PDF 的这一页碰不到主窗口的任何通道（那些通道在主进程里也只认主窗口）。
 */
const host: PdfHostApi = {
  onRequest: (listener) => {
    ipcRenderer.on(PDF_RENDER_CHANNELS.request, (_event, request: RenderRequest) => listener(request));
  },
  reply: (reply) => ipcRenderer.send(PDF_RENDER_CHANNELS.reply, reply),
};

contextBridge.exposeInMainWorld('pdfHost', host);
```

- [ ] **Step 6: 隐藏窗口和会话（接线）**

`src/main/app-protocol.ts` 的 `handleAppScheme` 改为可以挂到别的会话：

```ts
import { pathToFileURL } from 'node:url';
import { net, type Protocol, protocol } from 'electron';
import { APP_SCHEME, resolveBundlePath } from './bundle-path';
```

```ts
/**
 * app ready 之后调用：只服务 rootDir（渲染进程构建目录）里的文件。
 * target 默认是主窗口用的默认会话；PDF 渲染页的独立会话也挂一份（见 pdf/pdf-render-window.ts）。
 */
export function handleAppScheme(rootDir: string, target: Protocol = protocol): void {
  target.handle(APP_SCHEME, (request) => {
    const filePath = resolveBundlePath(rootDir, request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
```

```ts
// src/main/pdf/pdf-render-window.ts
import { join } from 'node:path';
import { app, BrowserWindow, type Session, session } from 'electron';
import { PDF_RENDER_CHANNELS } from '../../shared/pdf-render-protocol';
import { handleAppScheme } from '../app-protocol';
import { APP_HOST, APP_SCHEME } from '../bundle-path';
import type { RenderPort } from './pdf-render-host';
import { isAllowedRenderRequest } from './render-session-policy';

/** 内存里的独立会话（名字不带 persist:）：不和主窗口共用存储、缓存、同源数据，程序退出就没了。 */
const PDF_RENDER_PARTITION = 'labelflash-pdf-render';
const PDF_RENDER_PAGE = 'pdf-render.html';
/** 日志里记下被拦的地址时最多 200 个字：data: 地址可能很长。 */
const MAX_LOGGED_URL_LENGTH = 200;

let renderSession: Session | null = null;

/** 第一次用到时准备会话：只服务本程序的文件、拒绝一切权限、拦下所有对外请求。 */
function prepareSession(rendererDir: string, devServerUrl: string | null): Session {
  if (renderSession !== null) {
    return renderSession;
  }
  const prepared = session.fromPartition(PDF_RENDER_PARTITION);
  handleAppScheme(rendererDir, prepared.protocol);
  prepared.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  prepared.setPermissionCheckHandler(() => false);
  prepared.webRequest.onBeforeRequest((details, callback) => {
    const isAllowed = isAllowedRenderRequest(details.url, devServerUrl);
    if (!isAllowed) {
      console.warn(`[pdf] blocked a request from the render page: ${details.url.slice(0, MAX_LOGGED_URL_LENGTH)}`);
    }
    callback({ cancel: !isAllowed });
  });
  renderSession = prepared;
  return prepared;
}

/**
 * 开一个隐藏的 PDF 渲染窗口（sandbox、contextIsolation、没有 Node；只有这个窗口开 JS，pdf.js 要用）。
 * 窗口导航、新窗口由 security.ts 对所有 webContents 统一拒绝。只收这个窗口主 frame 发来的回复。
 */
export async function openRenderWindow(rendererDir: string): Promise<RenderPort> {
  const devServerUrl = app.isPackaged ? null : (process.env['ELECTRON_RENDERER_URL'] ?? null);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: prepareSession(rendererDir, devServerUrl),
      preload: join(__dirname, '../preload/pdf-render.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      // 隐藏窗口也要全速跑：后台节流会让一页渲染慢好几倍。
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const goneListeners: (() => void)[] = [];
  const notifyGone = () => {
    for (const listener of goneListeners.splice(0)) {
      listener();
    }
  };
  window.webContents.on('render-process-gone', notifyGone);
  window.on('closed', notifyGone);
  const url =
    devServerUrl === null ? `${APP_SCHEME}://${APP_HOST}/${PDF_RENDER_PAGE}` : new URL(PDF_RENDER_PAGE, devServerUrl).href;
  await window.loadURL(url);
  return {
    send: (request) => {
      if (!window.isDestroyed()) {
        window.webContents.send(PDF_RENDER_CHANNELS.request, request);
      }
    },
    onReply: (listener) => {
      window.webContents.ipc.on(PDF_RENDER_CHANNELS.reply, (event, message: unknown) => {
        if (event.senderFrame === window.webContents.mainFrame) {
          listener(message);
        }
      });
    },
    onGone: (listener) => {
      goneListeners.push(listener);
    },
    close: () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    },
  };
}
```

- [ ] **Step 7: 构建配置**

`electron.vite.config.ts`：文件顶部 import 加：

```ts
import { resolve } from 'node:path';
import { pdfjsAssets } from './scripts/pdfjs-assets';
```

`preload` 一段改为（第二个 preload 给 PDF 渲染页，同样打成自包含的 CommonJS）：

```ts
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'pdf-render': resolve(__dirname, 'src/preload/pdf-render.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
```

`renderer` 一段改为：

```ts
  renderer: {
    plugins: [react(), pdfjsAssets()],
    build: {
      rollupOptions: {
        // 第二个页面是隐藏的 PDF 渲染页（只有 pdf.js，没有界面）。
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'pdf-render': resolve(__dirname, 'src/renderer/pdf-render.html'),
        },
      },
    },
  },
```

（如果合并后的 `main.build.rollupOptions` 里已经有批量打印子进程的 `input`，不动它。）

- [ ] **Step 8: 构建并核对产物**

Run: `bun run build && bun run verify:bundle`
Expected: `verify:bundle` 列出 `out/preload/pdf-render.js` 为 `ok`。再用 Glob 核对：`out/renderer/pdf-render.html` 存在、`out/renderer/assets/` 里有 `pdf.worker.min-*.mjs`、`out/renderer/pdfjs/cmaps/*.bcmap` 和 `out/renderer/pdfjs/standard_fonts/*` 存在。主进程 bundle 里不应出现 `pdfjs-dist`（Grep `out/main` 搜 `pdfjs` 只应命中 `pdf-render` 的通道名和文件名）。

- [ ] **Step 9: `bun run check` 后提交**

```bash
git add src/renderer/pdf-render.html src/renderer/src/pdf-render/main.ts src/preload/pdf-render.ts src/main/pdf/render-session-policy.ts src/main/pdf/render-session-policy.test.ts src/main/pdf/pdf-render-window.ts scripts/pdfjs-assets.ts scripts/pdfjs-assets.test.ts src/main/app-protocol.ts electron.vite.config.ts
git commit -m "feat(pdf): render PDF pages in a hidden sandboxed window" -m "pdf.js runs only in a hidden window with its own in-memory session, a deny-all CSP, every permission refused and every request outside app://bundle/ cancelled. It reaches the main process through a two-function preload and returns grayscale pixels. The worker, character maps, standard fonts and decoders ship inside the app, copied by a small build plugin instead of a new dependency." -m "$TRAILER"
```

---

### Task 12: PdfStation（主进程的 PDF 打印）

打开文件 → 识别第一页 → 按设置出块（逐页渲染、切、放到纸上、存缓存，换设置时上一次作废）→ 预览一块 → 按顺序打印（复用 `BatchRun`：暂停、继续、取消，打印机不能用时自动暂停）。都不 import electron。

**Files:**
- Create: `src/shared/pdf.ts`
- Create: `src/main/pdf/pdf-station.ts`、`src/main/pdf/pdf-station.test.ts`

- [ ] **Step 1: IPC 用的类型**

```ts
// src/shared/pdf.ts
import type { BatchProgress } from '../core/batch/batch-runner';
import { type CropMode, PDF_LIMITS } from '../core/pdf/pdf-model';
import type { PaperSize } from './paper-sizes';

const BYTES_PER_MB = 1024 * 1024;

/** 文件太大：主进程（选文件时）和界面（拖进来、读字节之前）说同一句话。 */
export const PDF_TOO_LARGE_ISSUE = `文件超过 ${PDF_LIMITS.fileBytes / BYTES_PER_MB}MB：拆成几个小一点的 PDF 再打`;

/** 一张黑白小图：1 位 BMP 的 base64（界面用 data:image/bmp 显示）和宽高（像素）。 */
export interface BitmapView {
  bmp: string;
  width: number;
  height: number;
}

export interface PdfDocumentView {
  name: string;
  pageCount: number;
  /** 按第一页自动识别的裁切方式。 */
  detected: CropMode;
  /** 第一页里「有内容」的地方（黑白），手动框选时在上面画框。 */
  firstPage: BitmapView;
}

export type PdfOpenResult =
  | { status: 'loaded'; document: PdfDocumentView }
  | { status: 'canceled' }
  | { status: 'invalid'; issue: string };

export interface PdfPieceView {
  /** 页码-第几张，例如 2-1。 */
  id: string;
  page: number;
  piece: number;
  /** 缩略图：就是打出来的黑白点（按整数倍缩小）。 */
  thumbnail: BitmapView;
}

export type PdfLayoutResult =
  | {
      status: 'ok';
      /** 这一次出块的编号：打印时带上，预览变了就对不上。 */
      runId: string;
      paper: PaperSize;
      pieces: PdfPieceView[];
      /** 空白、没出块的页数。 */
      skippedPages: number;
      /** 超过 1000 张，后面的没处理。 */
      truncated: boolean;
    }
  /** 又换了文件或设置：这一次的结果作废，界面等新的那次。 */
  | { status: 'superseded' }
  | { status: 'invalid'; issue: string };

export type PdfPiecePreviewResult =
  | { status: 'ok'; html: string; paper: PaperSize }
  | { status: 'invalid'; issue: string };

/** 推给界面的状态：处理到第几页、打印进度（失败、暂停原因都在 BatchProgress 里）。 */
export interface PdfStatus {
  fileName: string | null;
  processing: { done: number; total: number } | null;
  print: BatchProgress | null;
}

export type PdfPrintStartResult =
  | { status: 'started'; progress: BatchProgress }
  | { status: 'invalid'; issue: string };
```

- [ ] **Step 2: 写测试**

```ts
// src/main/pdf/pdf-station.test.ts
import { describe, expect, test } from 'bun:test';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import type { PdfLayout } from '../../core/pdf/pdf-model';
import { PDF_PIECE_TEMPLATE_ID } from '../../core/pdf/piece-template';
import { blankPage, gridPage } from '../../core/pdf/testing/synthetic-page';
import type { FieldsPrint } from '../../core/print-service';
import type { PrintResult } from '../../core/types';
import type { PdfStatus } from '../../shared/pdf';
import type { PageSize } from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PDF_ISSUES, PdfRenderError, type RenderedPage } from './pdf-render-host';
import {
  PDF_STATION_ISSUES,
  type PdfDocumentRenderer,
  PdfStation,
  type PdfStationDeps,
  type PieceStore,
  tooManyPagesIssue,
} from './pdf-station';

const A4: PageSize = { width: 595, height: 842 };
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%test\n');
const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'pdf', ruleName: 'PDF 打印', fields: [] },
};
const LAYOUT: PdfLayout = { paperKey: '100x150', crop: 'split', boxes: [], mono: 'threshold', threshold: 128 };
const RUN_IDS = [
  '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
];
/** 合成页面约 0.5mm 一个像素：按 48dpi 报给切分（4mm 的缝 = 8 像素）。 */
const SYNTHETIC_DPI = 48;

/** 假的渲染页：每页都是 2×2 的合成面单页（blank 里的页是白纸）；gate 不为 null 时每页等测试放行。 */
class FakeRenderer implements PdfDocumentRenderer {
  pageCount = 2;
  failure: Error | null = null;
  gate: (() => void)[] | null = null;
  readonly blank = new Set<number>();
  readonly renders: { page: number; dpi: number }[] = [];

  async open(_data: Uint8Array): Promise<OpenedPdf> {
    if (this.failure !== null) {
      throw this.failure;
    }
    const pages = this.pageCount <= 200 ? Array.from({ length: this.pageCount }, () => A4) : [];
    return { pageCount: this.pageCount, pages };
  }

  async render(page: number, _size: PageSize, dpi: number): Promise<RenderedPage> {
    this.renders.push({ page, dpi });
    const gate = this.gate;
    if (gate !== null) {
      await new Promise<void>((resolve) => gate.push(resolve));
    }
    if (this.failure !== null) {
      throw this.failure;
    }
    return { image: this.blank.has(page) ? blankPage(400, 560) : gridPage(), dpi: SYNTHETIC_DPI };
  }

  close(): void {}
}

class MemoryPieces implements PieceStore {
  readonly stored = new Map<string, MonoBitmap>();
  readonly touched: string[] = [];
  private count = 0;

  async save(bitmap: MonoBitmap): Promise<string> {
    this.count += 1;
    const key = `k${this.count}`;
    this.stored.set(key, bitmap);
    return key;
  }

  async load(key: string): Promise<MonoBitmap | null> {
    return this.stored.get(key) ?? null;
  }

  async touch(key: string): Promise<void> {
    this.touched.push(key);
  }

  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.stored.delete(key);
    }
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await settle();
  }
  expect(condition()).toBe(true);
}

function createStation(overrides: Partial<PdfStationDeps> = {}) {
  const renderer = new FakeRenderer();
  const pieces = new MemoryPieces();
  const printed: FieldsPrint[] = [];
  const statuses: PdfStatus[] = [];
  const runIds = [...RUN_IDS];
  const deps: PdfStationDeps = {
    renderer,
    pieces,
    readFile: async () => PDF_BYTES,
    fileSize: async () => PDF_BYTES.length,
    dpiFor: async () => 50,
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    renderHtml: (template, content) => `<p data-template="${template.id}">${content}</p>`,
    createRunId: () => runIds.shift() ?? 'no-more-run-ids',
    schedule: (run) => {
      const timer = setTimeout(run, 0);
      return () => clearTimeout(timer);
    },
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    log: () => undefined,
    ...overrides,
  };
  return { station: new PdfStation(deps), renderer, pieces, printed, statuses };
}

async function loaded(overrides: Partial<PdfStationDeps> = {}) {
  const harness = createStation(overrides);
  const result = await harness.station.loadBytes('面单.pdf', PDF_BYTES);
  if (result.status !== 'loaded') {
    throw new Error(`not loaded: ${JSON.stringify(result)}`);
  }
  return harness;
}

async function laidOut(overrides: Partial<PdfStationDeps> = {}) {
  const harness = await loaded(overrides);
  const result = await harness.station.layout(LAYOUT);
  if (result.status !== 'ok') {
    throw new Error(`not laid out: ${JSON.stringify(result)}`);
  }
  return { ...harness, result };
}

describe('PdfStation files', () => {
  test('opens a PDF, suggests splitting and shows the first page', async () => {
    const { station, renderer } = createStation();
    expect(await station.loadBytes('面单.pdf', PDF_BYTES)).toMatchObject({
      status: 'loaded',
      document: { name: '面单.pdf', pageCount: 2, detected: 'split', firstPage: { width: 400, height: 560 } },
    });
    expect(renderer.renders).toEqual([{ page: 1, dpi: 96 }]);
    expect(station.status().fileName).toBe('面单.pdf');
  });

  test('refuses files that are not PDFs', async () => {
    const { station } = createStation();
    expect(await station.loadBytes('a.pdf', new TextEncoder().encode('hello'))).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.notPdf,
    });
  });

  test('checks the size of a file before reading it', async () => {
    let reads = 0;
    const { station } = createStation({
      fileSize: async () => 60 * 1024 * 1024,
      readFile: async () => {
        reads += 1;
        return PDF_BYTES;
      },
    });
    expect(await station.loadPath('C:/big.pdf')).toEqual({ status: 'invalid', issue: PDF_STATION_ISSUES.tooLarge });
    expect(reads).toBe(0);
  });

  test('refuses more than 200 pages', async () => {
    const { station, renderer } = createStation();
    renderer.pageCount = 201;
    expect(await station.loadBytes('a.pdf', PDF_BYTES)).toEqual({ status: 'invalid', issue: tooManyPagesIssue(201) });
  });

  test('passes on why the render page could not open the file', async () => {
    const { station, renderer } = createStation();
    renderer.failure = new PdfRenderError(PDF_ISSUES.password, 'PasswordException');
    expect(await station.loadBytes('a.pdf', PDF_BYTES)).toEqual({ status: 'invalid', issue: PDF_ISSUES.password });
  });
});

describe('PdfStation layout', () => {
  test('cuts every page into pieces on the paper at the printer resolution', async () => {
    const { result, renderer } = await laidOut();
    expect(result.pieces.map((piece) => piece.id)).toEqual(['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4']);
    expect(result.paper).toEqual({ widthMm: 100, heightMm: 150 });
    expect(renderer.renders.slice(1)).toEqual([
      { page: 1, dpi: 50 },
      { page: 2, dpi: 50 },
    ]);
    // 100×150mm 在 50dpi 上是 197×295 个点；缩略图按 2 倍缩小到不超过 240。
    expect(result.pieces[0]?.thumbnail).toMatchObject({ width: 99, height: 148 });
  });

  test('skips blank pages and says how many', async () => {
    const { station, renderer } = await loaded();
    renderer.blank.add(2);
    expect(await station.layout(LAYOUT)).toMatchObject({ status: 'ok', skippedPages: 1 });
  });

  test('a newer layout supersedes one still running and drops its pieces', async () => {
    const { station, renderer, pieces } = await loaded();
    const gate: (() => void)[] = [];
    renderer.gate = gate;
    const first = station.layout(LAYOUT);
    await settle();
    const second = station.layout({ ...LAYOUT, crop: 'page' });
    await settle();
    renderer.gate = null;
    for (const release of gate.splice(0)) {
      release();
    }
    expect(await first).toEqual({ status: 'superseded' });
    const latest = await second;
    expect(latest.status === 'ok' ? latest.pieces.map((piece) => piece.id) : latest).toEqual(['1-1', '2-1']);
    expect(pieces.stored.size).toBe(2);
  });

  test('replaces the pieces of the previous layout', async () => {
    const { station, pieces } = await laidOut();
    expect(pieces.stored.size).toBe(8);
    await station.layout({ ...LAYOUT, crop: 'trim' });
    expect(pieces.stored.size).toBe(2);
  });

  test('needs an open file', async () => {
    expect(await createStation().station.layout(LAYOUT)).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.noDocument,
    });
  });

  test('reports a page that could not be drawn and stops processing', async () => {
    const { station, renderer } = await loaded();
    renderer.failure = new PdfRenderError(PDF_ISSUES.timeout, 'timed out');
    expect(await station.layout(LAYOUT)).toEqual({ status: 'invalid', issue: PDF_ISSUES.timeout });
    expect(station.status().processing).toBeNull();
  });
});

describe('PdfStation printing', () => {
  test('prints the chosen pieces in order with copies as PDF records', async () => {
    const { station, printed, result } = await laidOut();
    expect(await station.print({ runId: result.runId, pieceIds: ['1-2', '1-1'], copies: 2 })).toMatchObject({
      status: 'started',
      progress: { total: 4 },
    });
    await waitUntil(() => station.status().print?.state === 'done');
    expect(printed.map((input) => input.content)).toEqual([
      '面单.pdf 第 1 页第 2 张',
      '面单.pdf 第 1 页第 2 张',
      '面单.pdf 第 1 页第 1 张',
      '面单.pdf 第 1 页第 1 张',
    ]);
    expect(printed[0]).toMatchObject({
      source: 'pdf',
      caller: null,
      printerName: null,
      pdf: { file: '面单.pdf', page: 1, piece: 2 },
      template: { id: PDF_PIECE_TEMPLATE_ID, paper: { widthMm: 100, heightMm: 150 } },
    });
  });

  test('keeps the pieces that were printed when the layout changes', async () => {
    const { station, pieces, result } = await laidOut();
    await station.print({ runId: result.runId, pieceIds: ['1-1'], copies: 1 });
    await waitUntil(() => station.status().print?.state === 'done');
    await station.layout({ ...LAYOUT, crop: 'trim' });
    expect(pieces.stored.size).toBe(3);
  });

  test('refuses an old preview', async () => {
    const { station } = await laidOut();
    expect(await station.print({ runId: RUN_IDS[2] ?? '', pieceIds: ['1-1'], copies: 1 })).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.stale,
    });
  });

  test('refuses to change the layout or the file while printing', async () => {
    const { station, result } = await laidOut({ printFields: () => new Promise(() => undefined) });
    await station.print({ runId: result.runId, pieceIds: ['1-1'], copies: 1 });
    await settle();
    expect(await station.layout(LAYOUT)).toEqual({ status: 'invalid', issue: PDF_STATION_ISSUES.printing });
    expect(await station.loadBytes('b.pdf', PDF_BYTES)).toEqual({ status: 'invalid', issue: PDF_STATION_ISSUES.printing });
    expect(station.pendingLabels).toBe(1);
  });

  test('previews one piece with the same HTML as printing', async () => {
    const { station, result } = await laidOut();
    expect(await station.previewPiece(result.runId, '2-3')).toEqual({
      status: 'ok',
      html: `<p data-template="${PDF_PIECE_TEMPLATE_ID}">面单.pdf 第 2 页第 3 张</p>`,
      paper: { widthMm: 100, heightMm: 150 },
    });
  });

  test('reads back a stored piece for the records and keeps it another week', async () => {
    const { station, pieces } = await laidOut();
    const key = [...pieces.stored.keys()][0] ?? '';
    expect(await station.storedPiece(key)).not.toBeNull();
    expect(pieces.touched).toEqual([key]);
    expect(await station.storedPiece('missing')).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/pdf/pdf-station.test.ts`
Expected: FAIL，`Cannot find module './pdf-station'`。

- [ ] **Step 4: 实现**

```ts
// src/main/pdf/pdf-station.ts
import { basename } from 'node:path';
import type { BatchLabel } from '../../core/batch/batch-model';
import { type BatchProgress, BatchRun } from '../../core/batch/batch-runner';
import { inkMask } from '../../core/pdf/content-box';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { cropRects, detectCropMode, splitOptionsFor } from '../../core/pdf/page-split';
import { PDF_LIMITS, type PdfLayout, type PdfPrintRequest, pieceId } from '../../core/pdf/pdf-model';
import { paperDots, renderPiece, thumbnail } from '../../core/pdf/piece-fit';
import { pieceContent, pieceFields, pieceTemplate, shortFileName } from '../../core/pdf/piece-template';
import type { FieldsPrint } from '../../core/print-service';
import type { ScanField } from '../../core/scan/scan-result';
import { monoBmp } from '../../core/templates/mono-image';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { PrintResult } from '../../core/types';
import { type PaperSize, parsePaperKey } from '../../shared/paper-sizes';
import {
  type BitmapView,
  PDF_TOO_LARGE_ISSUE,
  type PdfLayoutResult,
  type PdfOpenResult,
  type PdfPiecePreviewResult,
  type PdfPieceView,
  type PdfPrintStartResult,
  type PdfStatus,
} from '../../shared/pdf';
import type { PageSize } from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PdfRenderError, type RenderedPage } from './pdf-render-host';

/** 第一页按 96dpi 渲染来识别裁切方式、当手动框选的底图：4mm 的缝有 15 个像素，够判断；A4 只有 79 万像素，打开很快。 */
const ANALYSIS_DPI = 96;
/** PDF 文件头：规范允许它出现在前 1024 字节里的任何位置（有的导出工具会在前面加几个字节）。 */
const PDF_HEADER = '%PDF-';
const PDF_HEADER_WINDOW_BYTES = 1024;
/** 打印进度最多 0.25 秒推一次：一千张逐张推会让界面一直重画。 */
const STATUS_INTERVAL_MS = 250;

/** 给用户看的原因（渲染页的原因见 PDF_ISSUES）。 */
export const PDF_STATION_ISSUES = {
  notPdf: '这不是 PDF 文件：只能打印 .pdf',
  tooLarge: PDF_TOO_LARGE_ISSUE,
  empty: '这个 PDF 一页也没有',
  noDocument: '先选一个 PDF',
  printing: '正在打印：打完或取消之后再换文件、改设置',
  stale: '预览已经变了：等这次处理完再打印',
  failed: '处理 PDF 时出错：详细原因已写入日志，重新选择文件再试',
} as const;

export function tooManyPagesIssue(pageCount: number): string {
  return `这个 PDF 有 ${pageCount} 页，一次最多 ${PDF_LIMITS.pages} 页：拆成几个文件再打`;
}

/** 渲染 PDF 的那一端（PdfRenderHost）。 */
export interface PdfDocumentRenderer {
  open(data: Uint8Array): Promise<OpenedPdf>;
  render(page: number, size: PageSize, dpi: number): Promise<RenderedPage>;
  close(): void;
}

/** 黑白位图的缓存（PieceCache）。 */
export interface PieceStore {
  save(bitmap: MonoBitmap): Promise<string>;
  load(key: string): Promise<MonoBitmap | null>;
  touch(key: string): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface PdfStationDeps {
  renderer: PdfDocumentRenderer;
  pieces: PieceStore;
  readFile: (path: string) => Promise<Uint8Array>;
  fileSize: (path: string) => Promise<number>;
  /** 这种纸会打到的那台打印机的分辨率（没有打印机时按 203dpi）。 */
  dpiFor: (paper: PaperSize) => Promise<number>;
  /** PrintService.printFields：决定打印机、排队、写记录。 */
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 一块打出来的 HTML（和打印同一份）。 */
  renderHtml: (template: LabelTemplate, content: string, fields: ScanField[], dpi: number) => string;
  createRunId: () => string;
  schedule: (run: () => void, delayMs: number) => () => void;
  onStatus: (status: PdfStatus) => void;
  /** 写了打印记录：界面刷新记录列表。 */
  onJobsChanged: () => void;
  log: (line: string) => void;
}

interface OpenDocument {
  name: string;
  pages: PageSize[];
}

interface StoredPiece {
  page: number;
  piece: number;
  /** 缓存里的位图编号。 */
  key: string;
}

/** 处理完的一次出块：打印、预览都按它。 */
interface FinishedRun {
  id: string;
  paper: PaperSize;
  dpi: number;
  pieces: Map<string, StoredPiece>;
}

/**
 * 主进程的 PDF 打印：一次一个文件。打开 → 按第一页识别裁切方式 → 按界面交来的设置出块（逐页渲染、切、放到纸上、存缓存）
 * → 预览一块 → 按顺序打印。换文件、改设置时还在处理的上一次作废，它存下的块删掉（打过的除外：打印记录指着它们）。
 */
export class PdfStation {
  private document: OpenDocument | null = null;
  private run: FinishedRun | null = null;
  /** 每次换文件、改设置加一：还在处理的上一次看到它变了就停下。 */
  private generation = 0;
  private processing: { done: number; total: number } | null = null;
  private printing: BatchRun | null = null;
  private progress: BatchProgress | null = null;
  /** 打过（或正在打）的块：打印记录指着它们，换设置、关文件时不删，到期由启动时的清理删。 */
  private readonly printedKeys = new Set<string>();
  private cancelStatusTimer: (() => void) | null = null;

  constructor(private readonly deps: PdfStationDeps) {}

  /** 还没打的张数（暂停中的也算）：有的时候不静默更新。 */
  get pendingLabels(): number {
    const progress = this.progress;
    return this.printing === null || progress === null ? 0 : progress.total - progress.sent - progress.failed;
  }

  /** 打开对话框选的文件：先看大小再读，不把几 GB 的文件读进内存。 */
  async loadPath(path: string): Promise<PdfOpenResult> {
    if (this.printing !== null) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    if ((await this.deps.fileSize(path)) > PDF_LIMITS.fileBytes) {
      return invalid(PDF_STATION_ISSUES.tooLarge);
    }
    return this.loadBytes(basename(path), await this.deps.readFile(path));
  }

  /** 打开一个 PDF（拖进窗口的文件直接给字节）；关掉上一个。 */
  async loadBytes(name: string, bytes: Uint8Array): Promise<PdfOpenResult> {
    if (this.printing !== null) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    if (bytes.length > PDF_LIMITS.fileBytes) {
      return invalid(PDF_STATION_ISSUES.tooLarge);
    }
    if (!hasPdfHeader(bytes)) {
      return invalid(PDF_STATION_ISSUES.notPdf);
    }
    this.generation += 1;
    await this.discardRun();
    this.document = null;
    let opened: OpenedPdf;
    let first: RenderedPage;
    try {
      opened = await this.deps.renderer.open(bytes);
      if (opened.pageCount > PDF_LIMITS.pages) {
        this.deps.renderer.close();
        return invalid(tooManyPagesIssue(opened.pageCount));
      }
      const firstSize = opened.pages[0];
      if (firstSize === undefined) {
        this.deps.renderer.close();
        return invalid(PDF_STATION_ISSUES.empty);
      }
      first = await this.deps.renderer.render(1, firstSize, ANALYSIS_DPI);
    } catch (error) {
      return invalid(this.issueOf(error));
    }
    const mask = inkMask(first.image);
    const document: OpenDocument = { name: shortFileName(name), pages: opened.pages };
    this.document = document;
    this.pushStatus();
    return {
      status: 'loaded',
      document: {
        name: document.name,
        pageCount: opened.pageCount,
        detected: detectCropMode(mask, splitOptionsFor(first.dpi)),
        // 底图就是程序认为「有内容」的地方：和识别、去白边用的是同一个判断。
        firstPage: bitmapView({ width: mask.width, height: mask.height, bits: mask.ink }),
      },
    };
  }

  /** 按设置出块：逐页按目标打印机的分辨率渲染、切、放到纸上、转黑白、存缓存。 */
  async layout(layout: PdfLayout): Promise<PdfLayoutResult> {
    const document = this.document;
    if (document === null) {
      return invalid(PDF_STATION_ISSUES.noDocument);
    }
    if (this.printing !== null) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    const paper = parsePaperKey(layout.paperKey);
    if (paper === null) {
      return invalid(PDF_STATION_ISSUES.failed); // parsePdfLayout 已经核对过，只为类型
    }
    this.generation += 1;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation;
    await this.discardRun();
    const dpi = await this.deps.dpiFor(paper);
    const dots = paperDots(paper, dpi);
    const pieces = new Map<string, StoredPiece>();
    const views: PdfPieceView[] = [];
    let skippedPages = 0;
    let truncated = false;
    this.setProcessing({ done: 0, total: document.pages.length });
    try {
      for (const [index, size] of document.pages.entries()) {
        const page = index + 1;
        const rendered = await this.deps.renderer.render(page, size, dpi);
        if (!isCurrent()) {
          break;
        }
        const rects = cropRects(layout.crop, inkMask(rendered.image), splitOptionsFor(rendered.dpi), layout.boxes);
        if (rects.length === 0) {
          skippedPages += 1;
        }
        for (const [rectIndex, rect] of rects.entries()) {
          if (pieces.size >= PDF_LIMITS.pieces) {
            truncated = true;
            break;
          }
          const piece = rectIndex + 1;
          const bitmap = renderPiece(rendered.image, rect, { dots, mono: layout.mono, threshold: layout.threshold });
          const id = pieceId(page, piece);
          pieces.set(id, { page, piece, key: await this.deps.pieces.save(bitmap) });
          views.push({ id, page, piece, thumbnail: bitmapView(thumbnail(bitmap)) });
        }
        if (isCurrent()) {
          this.setProcessing({ done: page, total: document.pages.length });
        }
        if (truncated) {
          break;
        }
      }
    } catch (error) {
      await this.deps.pieces.remove(keysOf(pieces));
      if (!isCurrent()) {
        return { status: 'superseded' };
      }
      this.setProcessing(null);
      return invalid(this.issueOf(error));
    }
    if (!isCurrent()) {
      await this.deps.pieces.remove(keysOf(pieces));
      return { status: 'superseded' };
    }
    const runId = this.deps.createRunId();
    this.run = { id: runId, paper, dpi, pieces };
    this.setProcessing(null);
    return { status: 'ok', runId, paper, pieces: views, skippedPages, truncated };
  }

  /** 一块打出来的样子（和打印同一份 HTML）。 */
  async previewPiece(runId: string, id: string): Promise<PdfPiecePreviewResult> {
    const run = this.run;
    const document = this.document;
    const piece = run?.id === runId ? run.pieces.get(id) : undefined;
    if (run === null || document === null || piece === undefined) {
      return invalid(PDF_STATION_ISSUES.stale);
    }
    const bitmap = await this.deps.pieces.load(piece.key);
    if (bitmap === null) {
      return invalid(PDF_STATION_ISSUES.failed);
    }
    const html = this.deps.renderHtml(
      pieceTemplate(bitmap, run.paper),
      pieceContent(document.name, piece.page, piece.piece),
      pieceFields(document.name, piece.page, piece.piece),
      run.dpi,
    );
    return { status: 'ok', html, paper: run.paper };
  }

  /** 按顺序打选中的块，每块 copies 份；上一张进了打印队列才交下一张（BatchRun）。 */
  async print(request: PdfPrintRequest): Promise<PdfPrintStartResult> {
    if (this.printing !== null) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    const run = this.run;
    const document = this.document;
    if (run === null || document === null || run.id !== request.runId) {
      return invalid(PDF_STATION_ISSUES.stale);
    }
    const chosen: StoredPiece[] = [];
    for (const id of request.pieceIds) {
      const piece = run.pieces.get(id);
      if (piece === undefined) {
        return invalid(PDF_STATION_ISSUES.stale);
      }
      chosen.push(piece);
    }
    // 行号就是打印顺序里的第几块（从 1 数），份号是这一块的第几份：BatchRun 按它们报进度和失败。
    const labels: BatchLabel[] = chosen.flatMap((piece, index) =>
      Array.from({ length: request.copies }, (_, copy) => ({
        row: index + 1,
        copy: copy + 1,
        fields: pieceFields(document.name, piece.page, piece.piece),
        content: pieceContent(document.name, piece.page, piece.piece),
      })),
    );
    const batchRun = new BatchRun(run.id, labels, {
      print: (label) => this.printPiece(run, document.name, chosen[label.row - 1], label),
      onChange: (progress) => {
        this.progress = progress;
        this.scheduleStatus();
      },
    });
    this.printing = batchRun;
    this.progress = batchRun.snapshot();
    void batchRun
      .run()
      .catch((error: unknown) => this.deps.log(`[pdf] printing stopped: ${String(error)}`))
      .finally(() => {
        this.printing = null;
        this.progress = batchRun.snapshot();
        this.pushStatus();
      });
    this.pushStatus();
    return { status: 'started', progress: this.progress };
  }

  pause(): void {
    this.printing?.pause();
  }

  resume(): void {
    this.printing?.resume();
  }

  cancel(): void {
    this.printing?.cancel();
  }

  /** 关掉文件：放掉渲染页和没打过的块。打印中不关（要用缓存里的块），界面在打印时也不显示这个按钮。 */
  async closeDocument(): Promise<void> {
    if (this.printing !== null) {
      return;
    }
    this.generation += 1;
    await this.discardRun();
    this.document = null;
    this.progress = null;
    this.processing = null;
    this.deps.renderer.close();
    this.pushStatus();
  }

  /** 打印记录的预览、重打：读回那一块的位图，并从现在起再留一个保留期。已被清理时返回 null。 */
  async storedPiece(key: string): Promise<MonoBitmap | null> {
    const bitmap = await this.deps.pieces.load(key);
    if (bitmap !== null) {
      await this.deps.pieces.touch(key);
    }
    return bitmap;
  }

  status(): PdfStatus {
    return { fileName: this.document?.name ?? null, processing: this.processing, print: this.progress };
  }

  private async printPiece(
    run: FinishedRun,
    fileName: string,
    piece: StoredPiece | undefined,
    label: BatchLabel,
  ): Promise<PrintResult> {
    if (piece === undefined) {
      throw new Error(`No PDF piece for print position ${label.row}`);
    }
    const bitmap = await this.deps.pieces.load(piece.key);
    if (bitmap === null) {
      throw new Error(`PDF piece ${piece.key} is missing from the cache`);
    }
    // 打印记录会指着这张位图：从现在起换设置、关文件都不删它。
    this.printedKeys.add(piece.key);
    const result = await this.deps.printFields({
      template: pieceTemplate(bitmap, run.paper),
      fields: label.fields,
      content: label.content,
      source: 'pdf',
      caller: null,
      printerName: null,
      pdf: { file: fileName, page: piece.page, piece: piece.piece, bitmap: piece.key },
    });
    this.deps.onJobsChanged();
    return result;
  }

  private async discardRun(): Promise<void> {
    const run = this.run;
    this.run = null;
    if (run !== null) {
      await this.deps.pieces.remove(keysOf(run.pieces).filter((key) => !this.printedKeys.has(key)));
    }
  }

  private setProcessing(processing: { done: number; total: number } | null): void {
    this.processing = processing;
    this.pushStatus();
  }

  private scheduleStatus(): void {
    if (this.cancelStatusTimer !== null) {
      return;
    }
    this.cancelStatusTimer = this.deps.schedule(() => {
      this.cancelStatusTimer = null;
      this.pushStatus();
    }, STATUS_INTERVAL_MS);
  }

  private pushStatus(): void {
    this.cancelStatusTimer?.();
    this.cancelStatusTimer = null;
    this.deps.onStatus(this.status());
  }

  /** 渲染页的错误已经有中文原因（并已写日志）；其他意外写日志，给一句通用的。 */
  private issueOf(error: unknown): string {
    if (error instanceof PdfRenderError) {
      return error.issue;
    }
    this.deps.log(`[pdf] processing failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return PDF_STATION_ISSUES.failed;
  }
}

function invalid(issue: string): { status: 'invalid'; issue: string } {
  return { status: 'invalid', issue };
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, PDF_HEADER_WINDOW_BYTES)).includes(PDF_HEADER);
}

function bitmapView(bitmap: MonoBitmap): BitmapView {
  return { bmp: monoBmp(bitmap.bits, bitmap.width, bitmap.height), width: bitmap.width, height: bitmap.height };
}

function keysOf(pieces: ReadonlyMap<string, StoredPiece>): string[] {
  return [...pieces.values()].map((piece) => piece.key);
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/pdf`
Expected: PASS。「换设置」那个用例里第一次出块在渲染第 1 页时被第二次取代：它放行后发现自己过期，什么也不存就返回 `superseded`。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/shared/pdf.ts src/main/pdf/pdf-station.ts src/main/pdf/pdf-station.test.ts
git commit -m "feat(pdf): open, lay out, preview and print PDF pieces in the main process" -m "The station checks the size and header before handing a file to the render page, detects the crop mode from the first page, and lays out every page at the target printer's resolution into cached one-bit pieces. A newer layout supersedes a running one and drops its pieces, except those already printed. Printing reuses BatchRun for order, pause, cancel and pausing on printer problems." -m "$TRAILER"
```

---

### Task 13: IPC 和接线

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 写测试**（`ipc-validators.test.ts`：import 加 `requirePdfLayout`、`requirePdfPrintRequest`、`requirePieceId`、`requireRunId`，`describe` 里加）

```ts
  test('PDF layouts, print requests, run ids and piece ids are checked', () => {
    const layout = { paperKey: '100x150', crop: 'split', boxes: [], mono: 'threshold', threshold: 128 };
    expect(requirePdfLayout(layout)).toEqual(layout);
    expect(() => requirePdfLayout({ ...layout, crop: 'x' })).toThrow('Invalid PDF layout');
    const runId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(requirePdfPrintRequest({ runId, pieceIds: ['1-1'], copies: 1 })).toEqual({
      runId,
      pieceIds: ['1-1'],
      copies: 1,
    });
    expect(() => requirePdfPrintRequest({ runId, pieceIds: [], copies: 1 })).toThrow('Invalid PDF print request');
    expect(requireRunId(runId)).toBe(runId);
    expect(() => requireRunId('x')).toThrow('Invalid PDF run id');
    expect(requirePieceId('2-3')).toBe('2-3');
    expect(() => requirePieceId('../x')).toThrow('Invalid PDF piece id');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL，四个函数没有导出。

- [ ] **Step 3: 校验函数**（`src/main/ipc-validators.ts`，import 加 `import { PIECE_ID_PATTERN, type PdfLayout, type PdfPrintRequest } from '../core/pdf/pdf-model';` 和 `import { parsePdfLayout, parsePdfPrintRequest, RUN_ID_PATTERN } from '../core/pdf/parse-pdf-request';`）

```ts
/** PDF 打印的裁切设置：逐项核对（见 core/pdf/parse-pdf-request.ts）。 */
export function requirePdfLayout(value: unknown): PdfLayout {
  const layout = parsePdfLayout(value);
  if (layout === null) {
    throw new TypeError('Invalid PDF layout');
  }
  return layout;
}

/** PDF 打印的打印设置：块编号、份数。 */
export function requirePdfPrintRequest(value: unknown): PdfPrintRequest {
  const request = parsePdfPrintRequest(value);
  if (request === null) {
    throw new TypeError('Invalid PDF print request');
  }
  return request;
}

export function requireRunId(value: unknown): string {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid PDF run id');
  }
  return value;
}

export function requirePieceId(value: unknown): string {
  if (typeof value !== 'string' || !PIECE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid PDF piece id');
  }
  return value;
}
```

- [ ] **Step 4: 通道和 API 类型**（`src/shared/ipc-contract.ts`）

import 加：

```ts
import type { PdfLayout, PdfPrintRequest } from '../core/pdf/pdf-model';
import type { PdfLayoutResult, PdfOpenResult, PdfPiecePreviewResult, PdfPrintStartResult, PdfStatus } from './pdf';
```

`IpcChannel` 的批量打印通道之后加：

```ts
  PdfOpenFile: 'pdf:open-file',
  PdfReadDropped: 'pdf:read-dropped',
  PdfLayout: 'pdf:layout',
  PdfPreviewPiece: 'pdf:preview-piece',
  PdfPrint: 'pdf:print',
  PdfPause: 'pdf:pause',
  PdfResume: 'pdf:resume',
  PdfCancel: 'pdf:cancel',
  PdfClose: 'pdf:close',
  PdfStatus: 'pdf:status',
  PdfStatusChanged: 'pdf:status-changed',
```

`LabelFlashApi` 的批量打印方法之后加：

```ts
  /** 主进程弹出打开对话框选 PDF，在隐藏的渲染页里打开并识别第一页。 */
  openPdfFile(): Promise<PdfOpenResult>;
  /** 拖进窗口的 PDF：界面读成字节交来（不传路径）。 */
  readDroppedPdf(name: string, bytes: Uint8Array): Promise<PdfOpenResult>;
  /** 按设置出块；处理期间又调用了一次时，这一次返回 superseded。 */
  layoutPdf(layout: PdfLayout): Promise<PdfLayoutResult>;
  /** 一块打出来的样子（和打印同一份 HTML）。 */
  previewPdfPiece(runId: string, pieceId: string): Promise<PdfPiecePreviewResult>;
  printPdf(request: PdfPrintRequest): Promise<PdfPrintStartResult>;
  /** 打完正在打的这一张后暂停。 */
  pausePdf(): Promise<void>;
  resumePdf(): Promise<void>;
  /** 不再交新的；正在打的这一张照常打完。 */
  cancelPdf(): Promise<void>;
  /** 关掉文件，放掉渲染页和没打过的块。 */
  closePdf(): Promise<void>;
  getPdfStatus(): Promise<PdfStatus>;
  /** 处理进度和打印进度（合并推送）。 */
  onPdfStatus(listener: (status: PdfStatus) => void): () => void;
```

- [ ] **Step 5: 主进程处理函数**（`src/main/ipc.ts`）

import 加（按字母顺序放）：

```ts
import { PDF_LIMITS, PDF_PIECE_RETENTION_MS } from '../core/pdf/pdf-model';
import { pieceTemplate } from '../core/pdf/piece-template';
import type { JobRecord, PdfRef, PreviewResult } from '../core/types';
import type { PdfOpenResult } from '../shared/pdf';
import type { PdfStation } from './pdf/pdf-station';
```

（`PreviewResult` 原来就从 `../core/types` 导入，合并成一行；`PDF_PIECE_RETENTION_MS` 只在下面的错误说明里用，Biome 报没用到就去掉。）`ipc-validators` 的 import 加 `requirePdfLayout`、`requirePdfPrintRequest`、`requirePieceId`、`requireRunId`。

`IpcDeps` 加：

```ts
  /** PDF 打印：打开、出块、预览、打印；打印记录的预览、重打读它缓存的位图。 */
  pdf: PdfStation;
```

把 `storedLabelOf` 换成下面四段：

```ts
  const jobOf = (value: unknown): JobRecord => {
    const jobId = requireString(value, 'jobId', MAX_JOB_ID_LENGTH);
    const job = deps.jobs.get(jobId);
    if (job === null) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return job;
  };
  /**
   * 按原样重打要用的模板和字段（本机接口、批量打印的记录）。界面按 reprintMode 只对能重打的记录显示按钮，
   * 这里再遇到缺东西（刚好被环形保留删掉、模板刚被删）就报错，由界面提示。
   */
  const storedLabelOf = (job: JobRecord) => {
    if (job.templateId === undefined || job.fields === undefined) {
      throw new Error(`Job ${job.id} has no stored template or fields`);
    }
    const template = deps.templates.get(job.templateId);
    if (template === null) {
      throw new Error(`Template of job ${job.id} was deleted: ${job.templateId}`);
    }
    return { template, fields: job.fields };
  };
  /**
   * PDF 打印的记录：模板用缓存的黑白位图临时包出来。界面只对保留期内的记录显示按钮；
   * 位图已被清理（刚好过期）就报错，由界面提示。
   */
  const pdfLabelOf = async (job: JobRecord, pdf: PdfRef) => {
    const paper = job.paper === undefined ? null : parsePaperKey(job.paper);
    if (paper === null) {
      throw new Error(`PDF job ${job.id} has no paper`);
    }
    const bitmap = await deps.pdf.storedPiece(pdf.bitmap);
    if (bitmap === null) {
      throw new Error(`The bitmap of PDF job ${job.id} is gone (kept ${PDF_PIECE_RETENTION_MS}ms): ${pdf.bitmap}`);
    }
    return { template: pieceTemplate(bitmap, paper), fields: job.fields ?? [] };
  };
  const labelOf = (job: JobRecord) =>
    job.pdf === undefined ? Promise.resolve(storedLabelOf(job)) : pdfLabelOf(job, job.pdf);
```

`PreviewJob`、`ReprintJob` 两个处理函数换成：

```ts
  handle(IpcChannel.PreviewJob, async (jobId) => {
    const job = jobOf(jobId);
    const { template, fields } = await labelOf(job);
    const result: PreviewResult = {
      status: 'ok',
      scan: fieldsScan(job.raw, fields, fieldsRuleFor(job)),
      recent: null,
      lookupFailure: null,
      printer: await deps.choosePrinter(template),
    };
    const preview = renderPreview(result, { template, isBound: false }, await dpiFor(result));
    // PDF 的一块铺满整张纸：自由设计的「靠近纸边」检查对它没有意义，预览上不显示。
    return job.pdf === undefined ? preview : { ...preview, warnings: NO_RENDER_WARNINGS };
  });
  handle(IpcChannel.ReprintJob, async (jobId) => {
    const job = jobOf(jobId);
    const { template, fields } = await labelOf(job);
    return deps.service.printFields({
      template,
      fields,
      content: job.raw,
      source: 'history',
      caller: job.caller ?? null,
      printerName: null,
      // 批量打的重打后还算这一批的这一行这一份（重打成功的不再算失败）；PDF 的重打指着同一张位图。
      ...(job.batch === undefined ? {} : { batch: job.batch }),
      ...(job.pdf === undefined ? {} : { pdf: job.pdf }),
    });
  });
```

在批量打印的处理函数之后加：

```ts
  handle(IpcChannel.PdfOpenFile, async (): Promise<PdfOpenResult> => {
    const window = deps.getWindow();
    const options: OpenDialogOptions = {
      title: '选择要打印的 PDF',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) {
      return { status: 'canceled' };
    }
    return deps.pdf.loadPath(path);
  });
  // 拖进来的文件只收字节，不收路径：页面给不了主进程任何路径。超过上限的界面会先拦下并说明，这里只兜底。
  handle(IpcChannel.PdfReadDropped, (name, bytes) =>
    deps.pdf.loadBytes(
      requireString(name, 'file name', MAX_FILE_NAME_LENGTH),
      requireBytes(bytes, 'PDF file', PDF_LIMITS.fileBytes),
    ),
  );
  handle(IpcChannel.PdfLayout, (layout) => deps.pdf.layout(requirePdfLayout(layout)));
  handle(IpcChannel.PdfPreviewPiece, (runId, pieceId) =>
    deps.pdf.previewPiece(requireRunId(runId), requirePieceId(pieceId)),
  );
  handle(IpcChannel.PdfPrint, (request) => deps.pdf.print(requirePdfPrintRequest(request)));
  handle(IpcChannel.PdfPause, () => deps.pdf.pause());
  handle(IpcChannel.PdfResume, () => deps.pdf.resume());
  handle(IpcChannel.PdfCancel, () => deps.pdf.cancel());
  handle(IpcChannel.PdfClose, () => deps.pdf.closeDocument());
  handle(IpcChannel.PdfStatus, () => deps.pdf.status());
```

- [ ] **Step 6: preload**（`src/preload/index.ts` 的 `api` 对象末尾加）

```ts
  openPdfFile: () => ipcRenderer.invoke(IpcChannel.PdfOpenFile),
  readDroppedPdf: (name, bytes) => ipcRenderer.invoke(IpcChannel.PdfReadDropped, name, bytes),
  layoutPdf: (layout) => ipcRenderer.invoke(IpcChannel.PdfLayout, layout),
  previewPdfPiece: (runId, pieceId) => ipcRenderer.invoke(IpcChannel.PdfPreviewPiece, runId, pieceId),
  printPdf: (request) => ipcRenderer.invoke(IpcChannel.PdfPrint, request),
  pausePdf: () => ipcRenderer.invoke(IpcChannel.PdfPause),
  resumePdf: () => ipcRenderer.invoke(IpcChannel.PdfResume),
  cancelPdf: () => ipcRenderer.invoke(IpcChannel.PdfCancel),
  closePdf: () => ipcRenderer.invoke(IpcChannel.PdfClose),
  getPdfStatus: () => ipcRenderer.invoke(IpcChannel.PdfStatus),
  onPdfStatus: (listener) => subscribe(IpcChannel.PdfStatusChanged, listener),
```

- [ ] **Step 7: 接线**（`src/main/index.ts`）

import 加（按 Biome 的顺序放；`readFile`、`stat` 已有的 `node:fs/promises` import 里没有就加上）：

```ts
import { PDF_PIECE_RETENTION_MS } from '../core/pdf/pdf-model';
import { fieldsScan, PDF_RULE } from '../core/print-service';
import { GENERIC_TEMPLATE } from '../core/templates/builtin-templates';
import { withPaper } from '../core/templates/template-model';
import { PieceCache } from './pdf/piece-cache';
import { PdfRenderHost } from './pdf/pdf-render-host';
import { openRenderWindow } from './pdf/pdf-render-window';
import { PdfStation } from './pdf/pdf-station';
```

（`fieldsScan`、`PrintService` 已经从 `../core/print-service` 导入时合并成一行；`GENERIC_TEMPLATE`、`withPaper` 已有就不重复。）

常量区（`TABLE_READER_SERVICE_NAME` 之后）加：

```ts
/** PDF 每一块的黑白位图缓存（数据目录下）：打印记录的预览、重打用，保留 7 天。 */
const PDF_CACHE_DIR_NAME = 'pdf-cache';
/** 打开一个 PDF（读出页数和每页大小、建渲染页）最多等 20 秒：200 页的 PDF 在普通电脑上几秒内打开，更久多半是坏文件。 */
const PDF_OPEN_TIMEOUT_MS = 20_000;
/** 渲染一页最多等 30 秒：最复杂的矢量页在 1600 万像素上也只要几秒。 */
const PDF_PAGE_TIMEOUT_MS = 30_000;
```

在批量打印的 `BatchStation` 之后加：

```ts
  // PDF 打印：PDF 只在隐藏的 sandbox 渲染页里解析（见 pdf/pdf-render-window.ts），这里只收核对过的灰度位图。
  const pdfCache = new PieceCache({
    dir: join(dataPath, PDF_CACHE_DIR_NAME),
    createKey: randomUUID,
    now: () => Date.now(),
  });
  // 程序自己的缓存，和日志一样按天数保留：启动时删掉 7 天没用过的，不打扰用户。
  pdfCache
    .prune(PDF_PIECE_RETENTION_MS)
    .then((removed) => {
      if (removed > 0) {
        console.log(`[pdf] pruned ${removed} cached pieces older than the retention`);
      }
    })
    .catch((error: unknown) => console.error('[pdf] failed to prune the piece cache', error));
  const pdfRenderer = new PdfRenderHost({
    openPort: () => openRenderWindow(join(__dirname, '../renderer')),
    openTimeoutMs: PDF_OPEN_TIMEOUT_MS,
    pageTimeoutMs: PDF_PAGE_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const pdf = new PdfStation({
    renderer: pdfRenderer,
    pieces: pdfCache,
    readFile: async (path) => new Uint8Array(await readFile(path)),
    fileSize: async (path) => (await stat(path)).size,
    // 按纸张决定打印机（和打印时同一个规则），用那台的分辨率出块；只为选打印机，借通用模板换上这种纸。
    dpiFor: async (paper) => {
      const { printerName } = await choosePrinter(withPaper(GENERIC_TEMPLATE, paper));
      return printerName !== null && (await isInstalled(printerName))
        ? profiles.dpiOf(printerName)
        : DEFAULT_PRINTER_DPI;
    },
    printFields: (input) => service.printFields(input),
    renderHtml: (template, content, fields, dpi) =>
      renderLabelHtml({ scan: fieldsScan(content, fields, PDF_RULE), template, printedAt: Date.now() }, dpi).html,
    createRunId: randomUUID,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    onStatus: (status) => sendToMainWindow(IpcChannel.PdfStatusChanged, status),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    log: (line) => console.warn(line),
  });
```

`registerIpc({` 的参数里加 `pdf,`；`backgroundUpdateTimer` 里的 `pendingPrints` 末尾加 ` + pdf.pendingLabels`（注释补一句「PDF 还有没打的时也不静默更新」）；退出时的清理（`clearInterval(backgroundUpdateTimer)` 那一处）加 `pdfRenderer.close();`。

- [ ] **Step 8: 构建、检查、手动试一次**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（PDF 的 E2E 在 Task 17）。

再 `bun run dev`，在开发者工具的控制台（主窗口）里调用 `await window.api.readDroppedPdf('a.pdf', new TextEncoder().encode('%PDF-1.4'))`，应返回 `{ status: 'invalid', issue: '打不开这个 PDF：…' }`，日志里有 `[pdf] the render page reported invalid`：说明渲染页能起来、pdf.js 和 worker 能加载、CSP 没有挡住它们。日志里出现 `blocked a request from the render page` 时，看被拦的地址：只应是外网地址；如果拦的是 `app://bundle/` 下的文件，说明 `isAllowedRenderRequest` 或协议挂载有问题。

- [ ] **Step 9: 提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(pdf): wire PDF printing to IPC, the render window and the records" -m "New pdf channels expose only what the page needs and validate every argument; dropped files arrive as bytes, never as paths. Records of PDF prints preview and reprint from the cached bitmap, which extends its retention, and startup prunes bitmaps unused for a week." -m "$TRAILER"
```

---

### Task 14: 界面的纯逻辑

**Files:**
- Create: `src/renderer/src/lib/pdf-view.ts`、`src/renderer/src/lib/pdf-view.test.ts`
- Modify: `src/renderer/src/lib/app-view.ts`、`app-view.test.ts`
- Modify: `src/renderer/src/lib/scan-routing.ts`、`scan-routing.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/pdf-view.test.ts
import { describe, expect, test } from 'bun:test';
import type { BatchProgress } from '../../../core/batch/batch-runner';
import {
  boxFromDrag,
  cropLabel,
  defaultPaperKey,
  describePdfPrint,
  describePieces,
  describeProcessing,
  isPdfFileName,
  movePiece,
  paperOptions,
  parseCopies,
  pdfButtonProgress,
  printCount,
  visibleOrder,
} from './pdf-view';

describe('isPdfFileName', () => {
  test('recognises PDF files by their extension', () => {
    expect(isPdfFileName('面单.PDF')).toBe(true);
    expect(isPdfFileName('rows.csv')).toBe(false);
    expect(isPdfFileName('pdf')).toBe(false);
  });
});

describe('papers', () => {
  const assigned = { '100x150': '面单机', '60x40': '标签机A' };

  test('lists assigned papers first with their printer, then the other presets', () => {
    const options = paperOptions(assigned);
    expect(options.slice(0, 2)).toEqual([
      { key: '100x150', label: '100×150 二联面单 · 面单机', hasPrinter: true },
      { key: '60x40', label: '60×40 标签 · 标签机A', hasPrinter: true },
    ]);
    expect(options.find((option) => option.key === '50x30')).toEqual({
      key: '50x30',
      label: '50×30 标签（没有分配打印机）',
      hasPrinter: false,
    });
    expect(options.filter((option) => option.key === '100x150')).toHaveLength(1);
  });

  test('starts with the 100×150 waybill paper when it has a printer, else the first assigned paper', () => {
    expect(defaultPaperKey(assigned)).toBe('100x150');
    expect(defaultPaperKey({ '60x40': '标签机A' })).toBe('60x40');
    expect(defaultPaperKey({})).toBe('100x150');
  });
});

describe('cropLabel', () => {
  test('marks the detected mode', () => {
    expect(cropLabel('split', 'split')).toBe('一页多张（自动识别）');
    expect(cropLabel('trim', 'split')).toBe('去白边');
    expect(cropLabel('page', null)).toBe('整页');
  });
});

describe('boxFromDrag', () => {
  test('normalises a drag in any direction and keeps it on the page', () => {
    expect(boxFromDrag({ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.25 })).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.25 });
    expect(boxFromDrag({ x: -0.25, y: 0.5 }, { x: 0.5, y: 1.5 })).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
  });

  test('ignores a click or a tiny drag', () => {
    expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.75 })).toBeNull();
  });
});

describe('order and counts', () => {
  const order = ['1-1', '1-2', '1-3'];

  test('moves a piece past the deleted ones and not off the ends', () => {
    expect(movePiece(order, '1-3', -1, new Set(['1-2']))).toEqual(['1-3', '1-2', '1-1']);
    expect(movePiece(order, '1-1', 1, new Set())).toEqual(['1-2', '1-1', '1-3']);
    expect(movePiece(order, '1-1', -1, new Set())).toEqual(order);
  });

  test('counts what will be printed', () => {
    expect(visibleOrder(order, new Set(['1-2']))).toEqual(['1-1', '1-3']);
    expect(printCount(order, new Set(['1-2']), 3)).toBe(6);
    expect(describePieces({ total: 3, removed: 1, copies: 3 })).toBe('共 3 张 · 删掉 1 张 · 每张 3 份 · 打 6 张');
    expect(describePieces({ total: 8, removed: 0, copies: 1 })).toBe('共 8 张 · 每张 1 份 · 打 8 张');
  });

  test('keeps copies within 1 to 99', () => {
    expect(parseCopies('3')).toBe(3);
    expect(parseCopies('0')).toBe(1);
    expect(parseCopies('500')).toBe(99);
    expect(parseCopies('')).toBe(1);
  });
});

describe('progress', () => {
  const running: BatchProgress = {
    batchId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    state: 'running',
    total: 8,
    sent: 3,
    failed: 0,
    pauseReason: null,
    failures: [],
  };

  test('describes processing pages', () => {
    expect(describeProcessing({ done: 2, total: 200 })).toBe('正在处理第 3 / 200 页…');
    expect(describeProcessing({ done: 200, total: 200 })).toBe('正在处理第 200 / 200 页…');
  });

  test('describes printing, pausing and the end', () => {
    expect(describePdfPrint(running)).toEqual({ text: '正在打印 · 已发送 3 / 8 张', percent: 38, isActive: true });
    expect(describePdfPrint({ ...running, state: 'paused', pauseReason: 'operator' }).text).toBe(
      '已暂停（点继续接着打） · 已发送 3 / 8 张',
    );
    expect(describePdfPrint({ ...running, state: 'paused', pauseReason: 'PRINTER_NOT_READY' }).text).toContain(
      '打印机不能用',
    );
    expect(describePdfPrint({ ...running, state: 'paused', pauseReason: 'no-printer' }).text).toContain(
      '没有分配打印机',
    );
    expect(describePdfPrint({ ...running, state: 'done', sent: 8 })).toEqual({
      text: '全部已发送 · 已发送 8 / 8 张',
      percent: 100,
      isActive: false,
    });
    expect(describePdfPrint({ ...running, state: 'done', sent: 7, failed: 1 }).text).toBe(
      '打完了 · 已发送 7 / 8 张，1 张失败：在打印记录里重打',
    );
    expect(describePdfPrint({ ...running, state: 'canceled' }).text).toBe('已取消 · 已发送 3 / 8 张');
  });

  test('puts the progress on the title bar button only while printing', () => {
    expect(pdfButtonProgress({ fileName: 'a.pdf', processing: null, print: running })).toBe('3/8');
    expect(pdfButtonProgress({ fileName: 'a.pdf', processing: null, print: { ...running, state: 'done' } })).toBeNull();
    expect(pdfButtonProgress(null)).toBeNull();
  });
});
```

`app-view.test.ts` 的 `describe('backStep')` 里加一行（import 加 `PDF_VIEW`）：

```ts
    expect(backStep(PDF_VIEW, false)).toBe('close-pdf');
```

`scan-routing.test.ts`（import 加 `PDF_VIEW`）：`scanTargetFor` 的用例加 `expect(scanTargetFor(PDF_VIEW)).toBe('sink');`；`isWorkbenchActive` 用例加 `expect(isWorkbenchActive(PDF_VIEW)).toBe(false);`。

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib`
Expected: FAIL，`Cannot find module './pdf-view'`、`PDF_VIEW` 没有导出。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/pdf-view.ts
import type { BatchProgress } from '../../../core/batch/batch-runner';
import { MIN_BOX_FRACTION } from '../../../core/pdf/parse-pdf-request';
import { type CropMode, type NormalizedBox, PDF_LIMITS } from '../../../core/pdf/pdf-model';
import { formatPaperName, PAPER_PRESETS, paperKey, parsePaperKey } from '../../../shared/paper-sizes';
import type { PdfStatus } from '../../../shared/pdf';

/** 没有特别分配时默认用 100×150 面单纸：PDF 打印最常见的就是平台导出的电子面单。 */
export const DEFAULT_PDF_PAPER_KEY = '100x150';

/** 认 PDF 只看扩展名（拖进窗口时分流用）；是不是真的 PDF 由主进程看文件头。 */
export function isPdfFileName(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

export interface CropChoice {
  mode: CropMode;
  label: string;
  hint: string;
}

export const CROP_CHOICES: readonly CropChoice[] = [
  { mode: 'page', label: '整页', hint: '整页缩放到纸上，横竖和纸不一样时自动转过来' },
  { mode: 'trim', label: '去白边', hint: '裁掉四周的空白再缩放（A4 上打的一张面单）' },
  { mode: 'split', label: '一页多张', hint: '按空白或分割线切开，每块打一张（A4 上的四联面单）' },
  { mode: 'manual', label: '手动框选', hint: '在第一页上画框，每一页按同样的位置裁（固定格式的导出件）' },
];

/** 单选项的文字：自动识别出的那一种后面注明。 */
export function cropLabel(mode: CropMode, detected: CropMode | null): string {
  const label = CROP_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode;
  return mode === detected ? `${label}（自动识别）` : label;
}

export interface PaperOption {
  key: string;
  label: string;
  hasPrinter: boolean;
}

/** 纸张下拉：分配了打印机的纸在前（写上打印机），其余预设在后（注明没有打印机，打的时候会暂停提示）。 */
export function paperOptions(paperPrinters: Readonly<Record<string, string>>): PaperOption[] {
  const assigned = Object.entries(paperPrinters).flatMap(([key, printer]) => {
    const paper = parsePaperKey(key);
    return paper === null ? [] : [{ key, label: `${formatPaperName(paper)} · ${printer}`, hasPrinter: true }];
  });
  const others = PAPER_PRESETS.filter((preset) => !Object.hasOwn(paperPrinters, paperKey(preset))).map((preset) => ({
    key: paperKey(preset),
    label: `${preset.name}（没有分配打印机）`,
    hasPrinter: false,
  }));
  return [...assigned, ...others];
}

export function defaultPaperKey(paperPrinters: Readonly<Record<string, string>>): string {
  if (Object.hasOwn(paperPrinters, DEFAULT_PDF_PAPER_KEY)) {
    return DEFAULT_PDF_PAPER_KEY;
  }
  return Object.keys(paperPrinters).find((key) => parsePaperKey(key) !== null) ?? DEFAULT_PDF_PAPER_KEY;
}

/** 第一页上的一点，按页面宽高的比例（0–1）。 */
export interface Point {
  x: number;
  y: number;
}

/** 拖动的起点、终点 → 框（任意方向拖都行，超出页面的部分收回来）；点一下、拖得太小返回 null。 */
export function boxFromDrag(start: Point, end: Point): NormalizedBox | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const left = clamp(Math.min(start.x, end.x));
  const right = clamp(Math.max(start.x, end.x));
  const top = clamp(Math.min(start.y, end.y));
  const bottom = clamp(Math.max(start.y, end.y));
  const box = { x: left, y: top, width: right - left, height: bottom - top };
  return box.width >= MIN_BOX_FRACTION && box.height >= MIN_BOX_FRACTION ? box : null;
}

export function canAddBox(boxes: readonly NormalizedBox[]): boolean {
  return boxes.length < PDF_LIMITS.manualBoxes;
}

/** 要打的块（按打印顺序，删掉的不在里面）。 */
export function visibleOrder(order: readonly string[], removed: ReadonlySet<string>): string[] {
  return order.filter((id) => !removed.has(id));
}

/** 和看得见的前一张（后一张）换位置；删掉的留在原位，恢复时回到原来的地方。到头了不动。 */
export function movePiece(
  order: readonly string[],
  id: string,
  delta: -1 | 1,
  removed: ReadonlySet<string>,
): string[] {
  const next = [...order];
  const from = next.indexOf(id);
  if (from === -1) {
    return next;
  }
  let to = from + delta;
  while (to >= 0 && to < next.length && removed.has(next[to] ?? '')) {
    to += delta;
  }
  const other = next[to];
  if (other === undefined) {
    return next;
  }
  next[to] = id;
  next[from] = other;
  return next;
}

export function printCount(order: readonly string[], removed: ReadonlySet<string>, copies: number): number {
  return visibleOrder(order, removed).length * copies;
}

export function describePieces({ total, removed, copies }: { total: number; removed: number; copies: number }): string {
  const parts = [`共 ${total} 张`];
  if (removed > 0) {
    parts.push(`删掉 ${removed} 张`);
  }
  parts.push(`每张 ${copies} 份`, `打 ${(total - removed) * copies} 张`);
  return parts.join(' · ');
}

/** 份数输入框：1–99，不是数字时按 1。 */
export function parseCopies(text: string): number {
  const copies = Number.parseInt(text, 10);
  return Number.isFinite(copies) ? Math.min(PDF_LIMITS.copies, Math.max(1, copies)) : 1;
}

export function describeProcessing({ done, total }: { done: number; total: number }): string {
  return `正在处理第 ${Math.min(done + 1, total)} / ${total} 页…`;
}

export interface PrintProgressView {
  text: string;
  /** 0–100（已发送 + 失败）。 */
  percent: number;
  /** 正在打或暂停中：显示暂停、继续、取消。 */
  isActive: boolean;
}

const PAUSE_TEXT: Record<NonNullable<BatchProgress['pauseReason']>, string> = {
  operator: '已暂停（点继续接着打）',
  'no-printer': '这种纸没有分配打印机，已暂停：到「打印机」页分配后点继续',
  PRINTER_NOT_READY: '打印机不能用，已暂停：处理好后点继续',
  PRINTER_NOT_FOUND: '找不到打印机，已暂停：接好后点继续',
};

/** 打印进度的文字（「已发送」= 进了打印队列，不说「打印成功」）。 */
export function describePdfPrint(progress: BatchProgress): PrintProgressView {
  const counts = `已发送 ${progress.sent} / ${progress.total} 张`;
  const percent = progress.total === 0 ? 0 : Math.round(((progress.sent + progress.failed) / progress.total) * 100);
  switch (progress.state) {
    case 'running':
      return { text: `正在打印 · ${counts}`, percent, isActive: true };
    case 'paused':
      return { text: `${PAUSE_TEXT[progress.pauseReason ?? 'operator']} · ${counts}`, percent, isActive: true };
    case 'done':
      return {
        text:
          progress.failed > 0
            ? `打完了 · ${counts}，${progress.failed} 张失败：在打印记录里重打`
            : `全部已发送 · ${counts}`,
        percent: 100,
        isActive: false,
      };
    case 'canceled':
      return { text: `已取消 · ${counts}`, percent, isActive: false };
  }
}

/** 标题栏按钮上的进度（「3/8」）：只在打印中、暂停中显示，关掉 PDF 页也看得到。 */
export function pdfButtonProgress(status: PdfStatus | null): string | null {
  const print = status?.print;
  if (print === undefined || print === null || (print.state !== 'running' && print.state !== 'paused')) {
    return null;
  }
  return `${print.sent}/${print.total}`;
}
```

（`BatchProgress['pauseReason']` 的取值以批量打印合并后的 `BatchPauseReason` 为准；多出取值时 `PAUSE_TEXT` 会类型报错，按它补一句。）

`src/renderer/src/lib/app-view.ts`：

```ts
/** 整个窗口的视图：工作台、配置中心的某一页、批量打印页、打印 PDF 页（后两个和配置中心同级）。 */
export type AppView =
  | { kind: 'workbench' }
  | { kind: 'config'; page: ConfigPage }
  | { kind: 'batch' }
  | { kind: 'pdf' };

export const WORKBENCH: AppView = { kind: 'workbench' };
export const BATCH_VIEW: AppView = { kind: 'batch' };
export const PDF_VIEW: AppView = { kind: 'pdf' };

export type BackStep = 'close-editor' | 'close-config' | 'close-batch' | 'close-pdf' | 'none';

/** Esc 和「返回」：编辑器开着就先回到列表，否则关掉配置中心（或批量打印页、打印 PDF 页）回工作台。 */
export function backStep(view: AppView, isEditing: boolean): BackStep {
  if (view.kind === 'workbench') {
    return 'none';
  }
  if (view.kind === 'batch') {
    return 'close-batch';
  }
  if (view.kind === 'pdf') {
    return 'close-pdf';
  }
  return isEditing ? 'close-editor' : 'close-config';
}
```

`src/renderer/src/lib/scan-routing.ts` 的 `scanTargetFor`：批量打印页那个分支的条件改为 `view.kind === 'batch' || view.kind === 'pdf'`（打印 PDF 页里扫码同样不打印），注释里补上「打印 PDF 页」。

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib`
Expected: PASS。`bun run typecheck` 会指出 `use-app-view.ts` 的 `switch` 少了 `'close-pdf'`：在 `case 'close-batch':` 上面加一行 `case 'close-pdf':`（同样是 `close()`）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/pdf-view.ts src/renderer/src/lib/pdf-view.test.ts src/renderer/src/lib/app-view.ts src/renderer/src/lib/app-view.test.ts src/renderer/src/lib/scan-routing.ts src/renderer/src/lib/scan-routing.test.ts src/renderer/src/view-models/use-app-view.ts
git commit -m "feat(renderer): pure logic for the PDF printing page" -m "Paper choices with their printers, crop labels that mark the detected mode, boxes from a drag on the first page, piece order that skips deleted pieces, copy counts and progress texts, plus a pdf view beside the batch page where scans never print." -m "$TRAILER"
```

---

### Task 15: 打印 PDF 页（视图模型、组件、样式）

**Files:**
- Create: `src/renderer/src/view-models/use-pdf.ts`
- Create: `src/renderer/src/components/pdf/PdfPage.tsx`、`PdfSetup.tsx`、`PdfBoxEditor.tsx`、`PdfPieces.tsx`
- Modify: `src/renderer/src/styles/app.css`、`src/renderer/src/styles/tokens.css`

- [ ] **Step 1: 视图模型**

```ts
// src/renderer/src/view-models/use-pdf.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { type NormalizedBox, PDF_LIMITS, type PdfLayout } from '../../../core/pdf/pdf-model';
import { DEFAULT_IMAGE_THRESHOLD } from '../../../core/templates/canvas-model';
import {
  PDF_TOO_LARGE_ISSUE,
  type PdfDocumentView,
  type PdfLayoutResult,
  type PdfOpenResult,
  type PdfPiecePreviewResult,
  type PdfStatus,
} from '../../../shared/pdf';
import { reportError } from '../lib/notices';
import { canAddBox, defaultPaperKey, movePiece, printCount, visibleOrder } from '../lib/pdf-view';

/** 拖阈值滑块时停下 0.3 秒再重新出块：每次出块都要把每一页重新渲染一遍。 */
const THRESHOLD_DEBOUNCE_MS = 300;

type LaidOut = Extract<PdfLayoutResult, { status: 'ok' }>;
type PrintControl = 'pause' | 'resume' | 'cancel';

export interface PdfViewModel {
  pdfFile: PdfDocumentView | null;
  /** 打不开、处理失败、打印被拒的原因；没有为 null。 */
  issue: string | null;
  layout: PdfLayout;
  result: LaidOut | null;
  isLayingOut: boolean;
  /** 全部块的顺序（含删掉的，删掉的在 removed 里）。 */
  order: readonly string[];
  removed: ReadonlySet<string>;
  copies: number;
  labelCount: number;
  selectedId: string | null;
  preview: PdfPiecePreviewResult | null;
  status: PdfStatus | null;
  /** 正在打或暂停中：不能换文件、改设置。 */
  isPrinting: boolean;
  openFile: () => Promise<void>;
  dropFile: (file: File) => void;
  changeLayout: (patch: Partial<PdfLayout>) => void;
  addBox: (box: NormalizedBox) => void;
  removeBox: (index: number) => void;
  select: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  removePiece: (id: string) => void;
  restoreAll: () => void;
  setCopies: (copies: number) => void;
  print: () => Promise<void>;
  control: (action: PrintControl) => void;
  close: () => Promise<void>;
}

/** 打印 PDF 页的状态：设置留在这里（关掉页面再打开还在），文件、出块、打印都在主进程。 */
export function usePdf({ paperPrinters }: { paperPrinters: Readonly<Record<string, string>> }): PdfViewModel {
  const [pdfFile, setPdfFile] = useState<PdfDocumentView | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [layout, setLayout] = useState<PdfLayout>(() => ({
    paperKey: defaultPaperKey(paperPrinters),
    crop: 'page',
    boxes: [],
    mono: 'threshold',
    threshold: DEFAULT_IMAGE_THRESHOLD,
  }));
  const [result, setResult] = useState<LaidOut | null>(null);
  const [isLayingOut, setIsLayingOut] = useState(false);
  const [order, setOrder] = useState<readonly string[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [copies, setCopies] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PdfPiecePreviewResult | null>(null);
  const [status, setStatus] = useState<PdfStatus | null>(null);
  /** 最新的设置：连着改两项时第二次在第一次的基础上改（不等这一帧重新渲染）。 */
  const layoutRef = useRef(layout);
  const layoutTimer = useRef<number | null>(null);
  /** 每次出块加一：晚回来的旧结果丢掉。 */
  const layoutRequest = useRef(0);

  useEffect(() => {
    let isMounted = true;
    window.api.getPdfStatus().then(
      (next) => {
        if (isMounted) {
          setStatus(next);
        }
      },
      (error: unknown) => reportError('读取 PDF 打印状态', error),
    );
    const unsubscribe = window.api.onPdfStatus(setStatus);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      if (layoutTimer.current !== null) {
        window.clearTimeout(layoutTimer.current);
      }
    },
    [],
  );

  // 还没打开文件时，默认纸张跟着纸张分配走（设置是异步读进来的）。
  useEffect(() => {
    if (pdfFile === null) {
      const next = { ...layoutRef.current, paperKey: defaultPaperKey(paperPrinters) };
      layoutRef.current = next;
      setLayout(next);
    }
  }, [paperPrinters, pdfFile]);

  const clearPieces = useCallback(() => {
    setResult(null);
    setOrder([]);
    setRemoved(new Set());
    setSelectedId(null);
  }, []);

  const relayout = useCallback(
    async (next: PdfLayout) => {
      layoutRequest.current += 1;
      const request = layoutRequest.current;
      // 手动框选还没画框：没有可出的块，等画了框再出。
      if (next.crop === 'manual' && next.boxes.length === 0) {
        clearPieces();
        setIsLayingOut(false);
        return;
      }
      setIsLayingOut(true);
      try {
        const outcome = await window.api.layoutPdf(next);
        if (request !== layoutRequest.current || outcome.status === 'superseded') {
          return;
        }
        if (outcome.status === 'invalid') {
          setIssue(outcome.issue);
          clearPieces();
          return;
        }
        setIssue(null);
        setResult(outcome);
        setOrder(outcome.pieces.map((piece) => piece.id));
        setRemoved(new Set());
        setSelectedId(outcome.pieces[0]?.id ?? null);
      } catch (error) {
        reportError('处理 PDF', error);
      } finally {
        if (request === layoutRequest.current) {
          setIsLayingOut(false);
        }
      }
    },
    [clearPieces],
  );

  const applyLayout = useCallback(
    (next: PdfLayout, delayMs: number) => {
      layoutRef.current = next;
      setLayout(next);
      if (layoutTimer.current !== null) {
        window.clearTimeout(layoutTimer.current);
      }
      layoutTimer.current = window.setTimeout(() => {
        layoutTimer.current = null;
        void relayout(next);
      }, delayMs);
    },
    [relayout],
  );

  const opened = useCallback(
    (outcome: PdfOpenResult) => {
      if (outcome.status === 'canceled') {
        return;
      }
      if (outcome.status === 'invalid') {
        setIssue(outcome.issue);
        return;
      }
      setIssue(null);
      setPdfFile(outcome.document);
      clearPieces();
      // 新文件：裁切方式用自动识别的；手动框是上一个文件的，清掉；纸张、转黑白方式沿用。
      applyLayout({ ...layoutRef.current, crop: outcome.document.detected, boxes: [] }, 0);
    },
    [applyLayout, clearPieces],
  );

  const openFile = useCallback(async () => {
    try {
      opened(await window.api.openPdfFile());
    } catch (error) {
      reportError('打开 PDF', error);
    }
  }, [opened]);

  const dropFile = useCallback(
    (file: File) => {
      // 太大的文件不读进内存，直接说明（主进程收到后还会再核对一次）。
      if (file.size > PDF_LIMITS.fileBytes) {
        setIssue(PDF_TOO_LARGE_ISSUE);
        return;
      }
      void (async () => {
        try {
          opened(await window.api.readDroppedPdf(file.name, new Uint8Array(await file.arrayBuffer())));
        } catch (error) {
          reportError('打开拖进来的 PDF', error);
        }
      })();
    },
    [opened],
  );

  const changeLayout = useCallback(
    (patch: Partial<PdfLayout>) =>
      applyLayout({ ...layoutRef.current, ...patch }, patch.threshold === undefined ? 0 : THRESHOLD_DEBOUNCE_MS),
    [applyLayout],
  );

  const addBox = useCallback(
    (box: NormalizedBox) => {
      const current = layoutRef.current;
      if (canAddBox(current.boxes)) {
        applyLayout({ ...current, boxes: [...current.boxes, box] }, 0);
      }
    },
    [applyLayout],
  );

  const removeBox = useCallback(
    (index: number) => {
      const current = layoutRef.current;
      applyLayout({ ...current, boxes: current.boxes.filter((_, at) => at !== index) }, 0);
    },
    [applyLayout],
  );

  const runId = result?.runId ?? null;
  useEffect(() => {
    if (runId === null || selectedId === null) {
      setPreview(null);
      return;
    }
    let isCurrent = true;
    window.api.previewPdfPiece(runId, selectedId).then(
      (next) => {
        if (isCurrent) {
          setPreview(next);
        }
      },
      (error: unknown) => reportError('预览这一张', error),
    );
    return () => {
      isCurrent = false;
    };
  }, [runId, selectedId]);

  const move = useCallback(
    (id: string, delta: -1 | 1) => setOrder((current) => movePiece(current, id, delta, removed)),
    [removed],
  );

  const removePiece = useCallback((id: string) => {
    setRemoved((current) => new Set(current).add(id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const restoreAll = useCallback(() => setRemoved(new Set()), []);

  const print = useCallback(async () => {
    const pieceIds = visibleOrder(order, removed);
    if (result === null || pieceIds.length === 0) {
      return;
    }
    try {
      const started = await window.api.printPdf({ runId: result.runId, pieceIds, copies });
      setIssue(started.status === 'invalid' ? started.issue : null);
    } catch (error) {
      reportError('打印 PDF', error);
    }
  }, [result, order, removed, copies]);

  const control = useCallback((action: PrintControl) => {
    const calls = { pause: window.api.pausePdf, resume: window.api.resumePdf, cancel: window.api.cancelPdf };
    calls[action]().catch((error: unknown) => reportError('控制 PDF 打印', error));
  }, []);

  const close = useCallback(async () => {
    try {
      await window.api.closePdf();
      layoutRequest.current += 1;
      setPdfFile(null);
      setIssue(null);
      clearPieces();
    } catch (error) {
      reportError('关闭 PDF', error);
    }
  }, [clearPieces]);

  const printState = status?.print?.state;
  return {
    pdfFile,
    issue,
    layout,
    result,
    isLayingOut,
    order,
    removed,
    copies,
    labelCount: printCount(order, removed, copies),
    selectedId,
    preview,
    status,
    isPrinting: printState === 'running' || printState === 'paused',
    openFile,
    dropFile,
    changeLayout,
    addBox,
    removeBox,
    select: setSelectedId,
    move,
    removePiece,
    restoreAll,
    setCopies,
    print,
    control,
    close,
  };
}
```

- [ ] **Step 2: 组件**

```tsx
// src/renderer/src/components/pdf/PdfSetup.tsx
import { useId } from 'react';
import { CROP_CHOICES, cropLabel, type PaperOption } from '../../lib/pdf-view';
import type { PdfViewModel } from '../../view-models/use-pdf';

interface PdfSetupProps {
  pdf: PdfViewModel;
  paperOptions: readonly PaperOption[];
}

/** 纸张、裁切方式、转黑白：改了就重新出块（阈值停下 0.3 秒再出）。打印中锁住。 */
export function PdfSetup({ pdf, paperOptions }: PdfSetupProps) {
  const titleId = useId();
  const detected = pdf.pdfFile?.detected ?? null;
  const hint = CROP_CHOICES.find((choice) => choice.mode === pdf.layout.crop)?.hint ?? '';
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        纸张和裁切
      </h2>
      <div className="pdf-setup">
        <label className="pdf-setup__row">
          <span className="pdf-setup__label">纸张</span>
          <select
            className="select-field"
            aria-label="纸张"
            value={pdf.layout.paperKey}
            disabled={pdf.isPrinting}
            onChange={(event) => pdf.changeLayout({ paperKey: event.target.value })}
          >
            {paperOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="pdf-setup__choices" disabled={pdf.isPrinting}>
          <legend className="pdf-setup__label">裁切方式</legend>
          {CROP_CHOICES.map((choice) => (
            <label key={choice.mode} className="pdf-setup__choice" title={choice.hint}>
              <input
                type="radio"
                name="pdf-crop"
                checked={pdf.layout.crop === choice.mode}
                onChange={() => pdf.changeLayout({ crop: choice.mode })}
              />
              {cropLabel(choice.mode, detected)}
            </label>
          ))}
        </fieldset>
        <p className="pdf-setup__hint">{hint}</p>
        <fieldset className="pdf-setup__choices" disabled={pdf.isPrinting}>
          <legend className="pdf-setup__label">转黑白</legend>
          <label className="pdf-setup__choice">
            <input
              type="radio"
              name="pdf-mono"
              checked={pdf.layout.mono === 'threshold'}
              onChange={() => pdf.changeLayout({ mono: 'threshold' })}
            />
            阈值（文字、条码）
          </label>
          <label className="pdf-setup__choice">
            <input
              type="radio"
              name="pdf-mono"
              checked={pdf.layout.mono === 'dither'}
              onChange={() => pdf.changeLayout({ mono: 'dither' })}
            />
            抖动（照片）
          </label>
          <label className="pdf-setup__threshold">
            深浅
            <input
              type="range"
              aria-label="阈值"
              min={1}
              max={254}
              value={pdf.layout.threshold}
              onChange={(event) => pdf.changeLayout({ threshold: Number(event.target.value) })}
            />
            <span className="pdf-setup__value">{pdf.layout.threshold}</span>
          </label>
        </fieldset>
      </div>
    </section>
  );
}
```

```tsx
// src/renderer/src/components/pdf/PdfBoxEditor.tsx
import { type CSSProperties, type PointerEvent, useState } from 'react';
import { type NormalizedBox, PDF_LIMITS } from '../../../../core/pdf/pdf-model';
import type { BitmapView } from '../../../../shared/pdf';
import { boxFromDrag, canAddBox, type Point } from '../../lib/pdf-view';

interface PdfBoxEditorProps {
  firstPage: BitmapView;
  boxes: readonly NormalizedBox[];
  onAdd: (box: NormalizedBox) => void;
  onRemove: (index: number) => void;
}

function boxStyle(box: NormalizedBox): CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

function pointOf(event: PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

/** 在第一页上拖出要打印的区域（按页面比例记），每一页按同样的位置裁。底图是程序认为「有内容」的地方。 */
export function PdfBoxEditor({ firstPage, boxes, onAdd, onRemove }: PdfBoxEditorProps) {
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const canAdd = canAddBox(boxes);
  const draft = drag === null ? null : boxFromDrag(drag.start, drag.end);
  return (
    <div className="pdf-box-editor">
      <div
        className="pdf-box-editor__stage"
        role="application"
        aria-label="在第一页上画框"
        style={{ aspectRatio: `${firstPage.width} / ${firstPage.height}` }}
        onPointerDown={(event) => {
          if (!canAdd || event.button !== 0) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointOf(event);
          setDrag({ start: point, end: point });
        }}
        onPointerMove={(event) => {
          if (drag !== null) {
            setDrag({ start: drag.start, end: pointOf(event) });
          }
        }}
        onPointerUp={(event) => {
          if (drag === null) {
            return;
          }
          const box = boxFromDrag(drag.start, pointOf(event));
          setDrag(null);
          if (box !== null) {
            onAdd(box);
          }
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <img
          className="pdf-box-editor__page"
          alt="第一页"
          src={`data:image/bmp;base64,${firstPage.bmp}`}
          draggable={false}
        />
        {boxes.map((box, index) => (
          <div key={`${box.x}-${box.y}-${box.width}-${box.height}`} className="pdf-box" style={boxStyle(box)}>
            <span className="pdf-box__number">{index + 1}</span>
          </div>
        ))}
        {draft !== null && <div className="pdf-box pdf-box--draft" style={boxStyle(draft)} />}
      </div>
      <div className="pdf-box-editor__side">
        <p className="config-card__text">
          {canAdd
            ? '在第一页上按住鼠标拖出要打印的区域，可以画几个；每一页按同样的位置裁，空白的不打。'
            : `最多 ${PDF_LIMITS.manualBoxes} 个框。`}
        </p>
        {boxes.length > 0 && (
          <ol className="pdf-box-list">
            {boxes.map((box, index) => (
              <li key={`${box.x}-${box.y}-${box.width}-${box.height}`}>
                框 {index + 1}
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-label={`删掉框 ${index + 1}`}
                  onClick={() => onRemove(index)}
                >
                  删除
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
```

```tsx
// src/renderer/src/components/pdf/PdfPieces.tsx
import type { PdfPieceView } from '../../../../shared/pdf';
import { visibleOrder } from '../../lib/pdf-view';

interface PdfPiecesProps {
  pieces: readonly PdfPieceView[];
  order: readonly string[];
  removed: ReadonlySet<string>;
  selectedId: string | null;
  /** 打印中不能调整顺序、删除。 */
  isLocked: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
}

/** 要打的块的缩略图网格（按打印顺序）：缩略图就是打出来的黑白点。 */
export function PdfPieces({ pieces, order, removed, selectedId, isLocked, onSelect, onMove, onRemove }: PdfPiecesProps) {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const visible = visibleOrder(order, removed).flatMap((id) => {
    const piece = byId.get(id);
    return piece === undefined ? [] : [piece];
  });
  return (
    <ol className="pdf-pieces" aria-label="要打的标签">
      {visible.map((piece, index) => {
        const name = `第 ${piece.page} 页第 ${piece.piece} 张`;
        return (
          <li key={piece.id} className="pdf-piece">
            <button
              type="button"
              className="pdf-piece__image"
              aria-pressed={piece.id === selectedId}
              aria-label={`看${name}打出来的样子`}
              onClick={() => onSelect(piece.id)}
            >
              <img
                alt={name}
                src={`data:image/bmp;base64,${piece.thumbnail.bmp}`}
                width={piece.thumbnail.width}
                height={piece.thumbnail.height}
              />
            </button>
            <span className="pdf-piece__name">
              {index + 1}. {name}
            </span>
            <div className="pdf-piece__actions">
              <button
                type="button"
                className="button button--small button--quiet"
                aria-label={`${name}往前移`}
                disabled={isLocked || index === 0}
                onClick={() => onMove(piece.id, -1)}
              >
                ←
              </button>
              <button
                type="button"
                className="button button--small button--quiet"
                aria-label={`${name}往后移`}
                disabled={isLocked || index === visible.length - 1}
                onClick={() => onMove(piece.id, 1)}
              >
                →
              </button>
              <button
                type="button"
                className="button button--small button--quiet"
                aria-label={`删掉${name}`}
                disabled={isLocked}
                onClick={() => onRemove(piece.id)}
              >
                删除
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

```tsx
// src/renderer/src/components/pdf/PdfPage.tsx
import { useCallback, useId } from 'react';
import { PDF_LIMITS } from '../../../../core/pdf/pdf-model';
import { NO_RENDER_WARNINGS } from '../../../../shared/render-warnings';
import { describePdfPrint, describePieces, describeProcessing, type PaperOption, parseCopies } from '../../lib/pdf-view';
import type { PdfViewModel } from '../../view-models/use-pdf';
import { LabelPreview } from '../LabelPreview';
import { PdfBoxEditor } from './PdfBoxEditor';
import { PdfPieces } from './PdfPieces';
import { PdfSetup } from './PdfSetup';

/** 这一张的预览放大倍数上限：100×150 的面单在右栏放到 2 倍，条码和小字已经看得清。 */
const PDF_PREVIEW_MAX_SCALE = 2;

interface PdfPageProps {
  pdf: PdfViewModel;
  paperOptions: readonly PaperOption[];
  onClose: () => void;
}

/** 打印 PDF 页：和配置中心、批量打印同级，铺满标题栏以下；自上而下文件、纸张和裁切、（框选）、预览，底部是打印和进度。 */
export function PdfPage({ pdf, paperOptions, onClose }: PdfPageProps) {
  const fileTitleId = useId();
  const boxesTitleId = useId();
  const previewTitleId = useId();
  // 打开时焦点落到标题：读屏软件读出所在位置，Tab 从页面内容开始（和配置中心一样）。
  const focusTitle = useCallback((title: HTMLHeadingElement | null) => title?.focus(), []);
  const { pdfFile, result, status } = pdf;
  const progress = status?.print ? describePdfPrint(status.print) : null;
  const statusText = status?.processing ? describeProcessing(status.processing) : (progress?.text ?? '');

  return (
    <div className="pdf-page">
      <div className="config-center__back">
        <button type="button" className="button button--quiet" onClick={onClose}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
      </div>
      <div className="config-header">
        <h1 ref={focusTitle} className="config-header__title" tabIndex={-1}>
          打印 PDF
        </h1>
      </div>
      <div className="config-content">
        <div className="config-content__inner pdf-page__inner">
          <section className="config-card" aria-labelledby={fileTitleId}>
            <h2 id={fileTitleId} className="config-card__title">
              文件
            </h2>
            <p className="config-card__text">
              选一个 PDF，或者直接把 PDF 拖进窗口。最多 {PDF_LIMITS.pages} 页；PDF 在隔离的进程里打开，不连网。
            </p>
            <div className="pdf-file__actions">
              <button type="button" className="button" disabled={pdf.isPrinting} onClick={() => void pdf.openFile()}>
                选择 PDF…
              </button>
              {pdfFile !== null && !pdf.isPrinting && (
                <button type="button" className="button button--quiet" onClick={() => void pdf.close()}>
                  关闭这个文件
                </button>
              )}
            </div>
            {pdfFile !== null && (
              <p className="pdf-file__status">
                {pdfFile.name} · {pdfFile.pageCount} 页
              </p>
            )}
          </section>
          {pdfFile !== null && <PdfSetup pdf={pdf} paperOptions={paperOptions} />}
          {pdfFile !== null && pdf.layout.crop === 'manual' && (
            <section className="config-card" aria-labelledby={boxesTitleId}>
              <h2 id={boxesTitleId} className="config-card__title">
                框选区域
              </h2>
              <PdfBoxEditor
                firstPage={pdfFile.firstPage}
                boxes={pdf.layout.boxes}
                onAdd={pdf.addBox}
                onRemove={pdf.removeBox}
              />
            </section>
          )}
          {pdfFile !== null && (
            <section className="config-card" aria-labelledby={previewTitleId}>
              <h2 id={previewTitleId} className="config-card__title">
                预览
              </h2>
              {result === null ? (
                <p className="config-card__text">
                  {pdf.isLayingOut
                    ? '正在处理…'
                    : pdf.layout.crop === 'manual'
                      ? '在第一页上拖出要打印的区域，这里会列出每一页裁出来的样子。'
                      : '没有可打印的内容。'}
                </p>
              ) : (
                <>
                  <p className="pdf-preview__summary">
                    {describePieces({ total: result.pieces.length, removed: pdf.removed.size, copies: pdf.copies })}
                    {result.skippedPages > 0 ? ` · 跳过 ${result.skippedPages} 页空白页` : ''}
                    {result.truncated ? ` · 超过 ${PDF_LIMITS.pieces} 张，后面的没有处理` : ''}
                    {pdf.removed.size > 0 && !pdf.isPrinting && (
                      <button type="button" className="button button--small button--quiet" onClick={pdf.restoreAll}>
                        恢复删掉的
                      </button>
                    )}
                  </p>
                  <div className="pdf-preview__body">
                    <PdfPieces
                      pieces={result.pieces}
                      order={pdf.order}
                      removed={pdf.removed}
                      selectedId={pdf.selectedId}
                      isLocked={pdf.isPrinting}
                      onSelect={pdf.select}
                      onMove={pdf.move}
                      onRemove={pdf.removePiece}
                    />
                    <div className="pdf-preview__label">
                      <LabelPreview
                        html={pdf.preview?.status === 'ok' ? pdf.preview.html : null}
                        warnings={NO_RENDER_WARNINGS}
                        feedKey={pdf.selectedId ?? ''}
                        maxScale={PDF_PREVIEW_MAX_SCALE}
                        placeholder={pdf.preview?.status === 'invalid' ? pdf.preview.issue : '点一张缩略图，看它打出来的样子'}
                        paper={result.paper}
                      />
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
      <div className="config-actions pdf-actions">
        {pdf.issue === null ? (
          <p className="config-actions__status" role="status">
            {statusText}
          </p>
        ) : (
          <p className="config-actions__status config-actions__status--error" role="alert">
            {pdf.issue}
          </p>
        )}
        {progress !== null && (
          <progress className="batch-progress" max={100} value={progress.percent} aria-label="PDF 打印进度" />
        )}
        {pdf.isPrinting ? (
          <>
            {status?.print?.state === 'paused' ? (
              <button type="button" className="button button--primary" onClick={() => pdf.control('resume')}>
                继续
              </button>
            ) : (
              <button type="button" className="button" onClick={() => pdf.control('pause')}>
                暂停
              </button>
            )}
            <button type="button" className="button" onClick={() => pdf.control('cancel')}>
              取消
            </button>
          </>
        ) : (
          <>
            <label className="pdf-actions__copies">
              每张
              <input
                type="number"
                className="text-field text-field--number"
                aria-label="每张份数"
                min={1}
                max={PDF_LIMITS.copies}
                value={pdf.copies}
                onChange={(event) => pdf.setCopies(parseCopies(event.target.value))}
              />
              份
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={pdf.labelCount === 0 || pdf.isLayingOut}
              onClick={() => void pdf.print()}
            >
              打印 {pdf.labelCount} 张
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

（`.batch-progress`、`.config-actions__status--error` 是批量打印页已有的样式，直接复用。）

- [ ] **Step 3: 样式**

`src/renderer/src/styles/tokens.css` 在批量打印那一组变量之后加：

```css
  /* 打印 PDF：缩略图格子 120×160px（100×150 的面单缩略图约 99×148 点，放得下不放大）；框选的第一页最宽 420px。 */
  --pdf-thumb-width: 120px;
  --pdf-thumb-height: 160px;
  --pdf-first-page-width: 420px;
```

`src/renderer/src/styles/app.css`：批量打印的 `.batch-page {` 选择器改为 `.batch-page,\n.pdf-page {`（同一套外框）；`.batch-page ~ .notice-bar {` 改为 `.batch-page ~ .notice-bar,\n.pdf-page ~ .notice-bar {`。文件末尾加：

```css
/* ── 打印 PDF 页：外框和批量打印页共用（见 .batch-page） ── */
.pdf-page__inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pdf-file__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.pdf-file__status {
  margin: var(--space-2) 0 0;
  font-family: var(--font-data);
  font-size: 13px;
}

.pdf-setup {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.pdf-setup__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.pdf-setup__label {
  min-width: 64px;
  color: var(--color-ink-soft);
  font-size: 13px;
}

.pdf-setup__choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: 0;
  border: 0;
}

.pdf-setup__choice,
.pdf-setup__threshold {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 13px;
}

.pdf-setup__hint {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 12px;
}

.pdf-setup__value {
  min-width: 3ch;
  font-family: var(--font-data);
}

/* 框选：左边第一页（按页面的宽高比），右边框的列表 */
.pdf-box-editor {
  display: grid;
  grid-template-columns: minmax(0, var(--pdf-first-page-width)) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-4);
}

.pdf-box-editor__stage {
  position: relative;
  border: 1px solid var(--color-rule);
  background: var(--color-paper);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.pdf-box-editor__page {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}

.pdf-box {
  position: absolute;
  border: 2px solid var(--color-selection);
  background: color-mix(in srgb, var(--color-selection) 12%, transparent);
  pointer-events: none;
}

.pdf-box--draft {
  border-style: dashed;
}

.pdf-box__number {
  position: absolute;
  top: 2px;
  left: 4px;
  color: var(--color-selection);
  font-family: var(--font-data);
  font-size: 12px;
  font-weight: 700;
}

.pdf-box-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding-left: var(--space-4);
  font-size: 13px;
}

.pdf-box-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

/* 预览：左边缩略图网格（自己滚动），右边这一张的真实预览 */
.pdf-preview__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: 13px;
}

.pdf-preview__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--batch-label-pane-width);
  gap: var(--space-4);
  height: var(--batch-preview-height);
}

.pdf-pieces {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--pdf-thumb-width), 1fr));
  align-content: start;
  gap: var(--space-3);
  min-height: 0;
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-field);
  list-style: none;
}

.pdf-piece {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  font-size: 12px;
}

.pdf-piece__image {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--pdf-thumb-height);
  padding: var(--space-1);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-paper);
  cursor: pointer;
}

.pdf-piece__image[aria-pressed="true"] {
  border-color: var(--color-selection);
  outline: 2px solid var(--color-selection);
}

/* 缩略图按原始点数显示（不超过格子），不插值：看到的就是黑白点 */
.pdf-piece__image img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  image-rendering: pixelated;
}

.pdf-piece__name {
  font-family: var(--font-data);
  white-space: nowrap;
}

.pdf-piece__actions {
  display: flex;
  gap: var(--space-1);
}

.pdf-preview__label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pdf-actions__copies {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 13px;
}

/* 和编辑视图同一个断点（App.tsx 的 NARROW_QUERY）：窄窗口里网格和预览、第一页和框列表上下排列 */
@media (max-width: 1099px) {
  .pdf-preview__body {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }

  .pdf-pieces {
    max-height: var(--batch-preview-height);
  }

  .pdf-preview__label {
    height: var(--batch-preview-height);
  }

  .pdf-box-editor {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 4: 检查**

Run: `bun run check`
Expected: 通过。Biome 对 `role="application"` 的舞台如果仍报交互规则，按它的提示改（例如换成 `<div role="application" tabIndex={-1}>`），不要关规则。页面在 Task 16 接上入口。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/view-models/use-pdf.ts src/renderer/src/components/pdf src/renderer/src/styles/app.css src/renderer/src/styles/tokens.css
git commit -m "feat(renderer): the PDF printing page" -m "One page from top to bottom: the file, paper and crop mode with the detected one marked, black-and-white conversion, boxes drawn on the first page for manual cropping, and a grid of thumbnails that are the real printed dots beside a full preview of the selected piece. Pieces can be reordered or deleted, copies set, and printing paused, resumed or cancelled from the action bar." -m "$TRAILER"
```

---

### Task 16: 入口：标题栏「打印 PDF」、拖文件分流

**Files:**
- Modify: `src/renderer/src/view-models/use-app-view.ts`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 打开 PDF 页**（`use-app-view.ts`）

import 加 `PDF_VIEW`。把批量打印加的 `openBatch` 换成下面三段（同一套离开配置中心的流程）：

```ts
  /** 打开和配置中心同级的整页（批量打印、打印 PDF）；配置中心里有未保存的修改时先确认。 */
  const openFullPage = useCallback(
    (next: AppView) => {
      if (canOpen) {
        requestLeave(() => {
          fadeOutConfig();
          setView(next);
        });
      }
    },
    [canOpen, requestLeave, fadeOutConfig],
  );
  const openBatch = useCallback(() => openFullPage(BATCH_VIEW), [openFullPage]);
  const openPdf = useCallback(() => openFullPage(PDF_VIEW), [openFullPage]);
```

`return` 里加 `openPdf`；文档注释改为「整个窗口的视图：工作台、配置中心的某一页、批量打印页或打印 PDF 页。」

- [ ] **Step 2: 标题栏按钮**（`TitleBar.tsx`）

`BatchButtonProps` 之后加：

```ts
export interface PdfButtonProps {
  isOpen: boolean;
  /** 正在打或暂停时的进度（「3/8」）；其余为 null。 */
  progress: string | null;
  onToggle: () => void;
}
```

`TitleBarProps` 加 `pdf: PdfButtonProps;`，参数解构加 `pdf,`。在「批量打印」按钮之后加：

```tsx
        {/* 打印 PDF 页和批量打印页一样与配置中心同级：按下表示正在看它；打印中按钮上带进度。 */}
        <button
          type="button"
          className="config-button pdf-button"
          aria-pressed={pdf.isOpen}
          title={pdf.isOpen ? '返回工作台' : '打印 PDF：把 PDF 里的面单、标签裁好，缩放到标签纸上打印'}
          onClick={pdf.onToggle}
        >
          打印 PDF
          {pdf.progress !== null && <span className="batch-button__progress">{pdf.progress}</span>}
        </button>
```

- [ ] **Step 3: App 接线**（`App.tsx`）

import 加（按顺序放）：

```ts
import { PdfPage } from './components/pdf/PdfPage';
import { isPdfFileName, paperOptions, pdfButtonProgress } from './lib/pdf-view';
import { usePdf } from './view-models/use-pdf';
```

在批量打印的 `useBatch(...)` 之后加：

```ts
  // 打印 PDF：设置留在这里，文件、出块、打印在主进程。
  const isPdfOpen = appView.view.kind === 'pdf';
  const pdf = usePdf({ paperPrinters });
  const pdfPaperOptions = useMemo(() => paperOptions(paperPrinters), [paperPrinters]);
```

批量打印加的 `useFileDrop(...)` 换成：

```ts
  // 把文件拖进窗口：PDF 打开打印 PDF 页，其余（.xlsx / .csv / .xls）打开批量打印页，由那边说明认不认。
  useFileDrop(
    (file) => {
      if (isPdfFileName(file.name)) {
        appView.openPdf();
        pdf.dropFile(file);
        return;
      }
      appView.openBatch();
      batch.dropFile(file);
    },
    settings !== null,
  );
```

`<TitleBar` 加：

```tsx
        pdf={{
          isOpen: isPdfOpen,
          progress: pdfButtonProgress(pdf.status),
          onToggle: isPdfOpen ? appView.close : appView.openPdf,
        }}
```

在批量打印页那一段之后加：

```tsx
      {settings !== null && isPdfOpen && <PdfPage pdf={pdf} paperOptions={pdfPaperOptions} onClose={appView.close} />}
```

- [ ] **Step 4: 检查**

Run: `bun run check && bun run test:e2e`
Expected: 都通过。再 `bun run dev` 手动走一遍：标题栏「打印 PDF」→ 页面出现，Esc 回工作台；把一个平台导出的面单 PDF 拖进窗口 → 打开打印 PDF 页、缩略图出来；把 CSV 拖进窗口仍然打开批量打印页。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/view-models/use-app-view.ts src/renderer/src/components/TitleBar.tsx src/renderer/src/App.tsx
git commit -m "feat(renderer): open PDF printing from the title bar or by dropping a PDF" -m "The PDF page sits beside the config center and the batch page: the title bar button toggles it and shows progress while printing, Esc returns to the workbench, and a dropped .pdf opens it while other files still go to batch printing." -m "$TRAILER"
```

---

### Task 17: E2E

**Files:**
- Create: `e2e/support/pdf-files.ts`
- Create: `e2e/pdf.e2e.ts`

- [ ] **Step 1: 生成测试用的 PDF**

```ts
// e2e/support/pdf-files.ts
import { writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';

/**
 * A4 上 2×2 四张「面单」（1mm 黑框 + 一个大字母），两页，之间留 10mm 空白：和平台导出的四联面单一样是矢量 PDF。
 * 页高留 1mm 余量，避免取整多出一页白纸。
 */
const GRID_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; }
.page { display: grid; grid-template-columns: 95mm 95mm; grid-template-rows: 138mm 138mm; gap: 10mm;
  width: 210mm; height: 296mm; padding: 5mm; overflow: hidden; }
.page + .page { break-before: page; }
.label { display: flex; align-items: center; justify-content: center; border: 1mm solid #000; font: bold 60mm sans-serif; }
</style></head><body>
<div class="page"><div class="label">A</div><div class="label">B</div><div class="label">C</div><div class="label">D</div></div>
<div class="page"><div class="label">E</div><div class="label">F</div><div class="label">G</div><div class="label">H</div></div>
</body></html>`;

/** 用被测程序自己的 Electron（printToPDF）生成 2×2 面单的 PDF。 */
export async function gridPdfBytes(app: ElectronApplication): Promise<Buffer> {
  const base64 = await app.evaluate(async ({ BrowserWindow }, html) => {
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await window.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      return pdf.toString('base64');
    } finally {
      window.destroy();
    }
  }, GRID_HTML);
  return Buffer.from(base64, 'base64');
}

export async function writeGridPdf(app: ElectronApplication, path: string): Promise<void> {
  await writeFile(path, await gridPdfBytes(app));
}
```

- [ ] **Step 2: 写 E2E**

```ts
// e2e/pdf.e2e.ts
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, stubOpenDialog } from './support/app-helpers';
import { expect, test } from './support/fixtures';
import { gridPdfBytes, writeGridPdf } from './support/pdf-files';

const WAYBILL_PRINTER: FakePrinterSpec = {
  name: '面单机',
  paper: { widthMm: 100, heightMm: 150, dpi: 203 },
  readiness: { ready: true },
};
/** 比 50MB 的上限多 1MB：超过上限的文件不读，直接说明。 */
const OVERSIZE_BYTES = 51 * 1024 * 1024;

async function assignWaybillPrinter(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '100x150': WAYBILL_PRINTER.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function openPdfPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打印 PDF' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '打印 PDF' })).toBeVisible();
}

/** 打开 2×2 面单的 PDF，等 8 张都出来。 */
async function openGrid(app: ElectronApplication, page: Page, userData: string): Promise<void> {
  const path = join(userData, 'grid.pdf');
  await writeGridPdf(app, path);
  await stubOpenDialog(app, path);
  await openPdfPage(page);
  await page.getByRole('button', { name: '选择 PDF…' }).click();
  await expect(page.getByText('grid.pdf · 2 页')).toBeVisible();
  await expect(pieces(page)).toHaveCount(8);
}

function pieces(page: Page) {
  return page.getByRole('list', { name: '要打的标签' }).getByRole('listitem');
}

function pdfStatus(page: Page) {
  return page.locator('.pdf-actions').getByRole('status');
}

const ALL_PIECES = [1, 2].flatMap((pageNumber) =>
  [1, 2, 3, 4].map((piece) => `grid.pdf 第 ${pageNumber} 页第 ${piece} 张`),
);

test('splits a 2×2 waybill PDF into eight labels, prints them in order and reprints one from the records', async ({
  electronApp,
}) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await assignWaybillPrinter(page);
  await openGrid(app, page, userData);
  await expect(page.getByLabel('一页多张（自动识别）')).toBeChecked();
  await expect(page.getByLabel('纸张')).toHaveValue('100x150');
  await page.getByRole('button', { name: '打印 8 张' }).click();
  await expect(pdfStatus(page)).toContainText('全部已发送 · 已发送 8 / 8 张');
  const prints = await fakePrints(app);
  expect(prints.map((print) => print.raw)).toEqual(ALL_PIECES);
  expect(new Set(prints.map((print) => `${print.printerName} ${print.paper} ${print.templateId}`))).toEqual(
    new Set(['面单机 100x150 builtin:pdf-piece']),
  );

  await page.getByRole('button', { name: '返回工作台' }).click();
  const records = page.locator('.job-row');
  await expect(records).toHaveCount(8);
  await expect(records.first()).toContainText('PDF（第 2 页第 4 张）');
  await records.first().getByRole('button', { name: '重打' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBe(9);
  expect((await fakePrints(app)).at(-1)?.raw).toBe('grid.pdf 第 2 页第 4 张');
});

test('prints the chosen pieces in the chosen order with copies', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await assignWaybillPrinter(page);
  await openGrid(app, page, userData);
  await page.getByRole('button', { name: '删掉第 1 页第 2 张' }).click();
  await page.getByRole('button', { name: '第 1 页第 3 张往前移' }).click();
  await page.getByLabel('每张份数').fill('2');
  await expect(page.getByText('共 8 张 · 删掉 1 张 · 每张 2 份 · 打 14 张')).toBeVisible();
  await page.getByRole('button', { name: '打印 14 张' }).click();
  await expect(pdfStatus(page)).toContainText('全部已发送 · 已发送 14 / 14 张');
  expect((await fakePrints(app)).slice(0, 4).map((print) => print.raw)).toEqual([
    'grid.pdf 第 1 页第 3 张',
    'grid.pdf 第 1 页第 3 张',
    'grid.pdf 第 1 页第 1 张',
    'grid.pdf 第 1 页第 1 张',
  ]);
});

test('applies a box drawn on the first page to every page', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await assignWaybillPrinter(page);
  await openGrid(app, page, userData);
  await page.getByLabel('手动框选').check();
  const firstPage = await page.getByRole('img', { name: '第一页' }).boundingBox();
  if (firstPage === null) {
    throw new Error('the first page is not shown');
  }
  // 框住左上那一张（A4 上大约 2%–48% 的位置）。
  await page.mouse.move(firstPage.x + firstPage.width * 0.02, firstPage.y + firstPage.height * 0.02);
  await page.mouse.down();
  await page.mouse.move(firstPage.x + firstPage.width * 0.48, firstPage.y + firstPage.height * 0.48, { steps: 5 });
  await page.mouse.up();
  await expect(pieces(page)).toHaveCount(2);
  await expect(page.getByText('共 2 张 · 每张 1 份 · 打 2 张')).toBeVisible();
});

test('opens a PDF dropped on the window', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const base64 = (await gridPdfBytes(app)).toString('base64');
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'drop.pdf', { type: 'application/pdf' }));
    for (const type of ['dragover', 'drop']) {
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  }, base64);
  await expect(page.getByRole('heading', { level: 1, name: '打印 PDF' })).toBeVisible();
  await expect(page.getByText('drop.pdf · 2 页')).toBeVisible();
});

test('refuses files that are not PDFs, too large or damaged', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch();
  await openPdfPage(page);
  const cases = [
    { name: 'note.pdf', bytes: Buffer.from('hello'), issue: /这不是 PDF 文件/ },
    // pdf.js 对坏文件可能报「不是 PDF」，也可能修复出 0 页：两种说明都算对。
    { name: 'broken.pdf', bytes: Buffer.from('%PDF-1.7\nnot really a pdf\n'), issue: /打不开这个 PDF|一页也没有/ },
    {
      name: 'huge.pdf',
      bytes: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(OVERSIZE_BYTES)]),
      issue: /文件超过 50MB/,
    },
  ];
  for (const { name, bytes, issue } of cases) {
    const path = join(userData, name);
    await writeFile(path, bytes);
    await stubOpenDialog(app, path);
    await page.getByRole('button', { name: '选择 PDF…' }).click();
    await expect(page.getByRole('alert')).toContainText(issue);
  }
});
```

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e -- e2e/pdf.e2e.ts`
Expected: 5 个用例通过。第一个用例同时证明：构建版里隐藏渲染页能起来，pdf.js、worker、字符映射从 `app://bundle/` 读得到（CSP 和会话策略没挡住），切出来的块经 `PrintService` 打到按纸张分配的打印机，打印记录能按缓存的位图重打。再跑一次全部 `bun run test:e2e`。

如果第一个用例停在「8 张」之前，先看日志（`userData/logs/`）里 `[pdf]` 开头的行：`blocked a request` 说明会话策略拦了本该放行的地址；`render page reported failed` 后面是 pdf.js 的原始错误。

- [ ] **Step 4: 提交**

```bash
git add e2e/support/pdf-files.ts e2e/pdf.e2e.ts
git commit -m "test(e2e): PDF printing from a 2x2 waybill PDF, drops, boxes and refusals" -m "A two-page A4 PDF with four boxed labels per page is generated with printToPDF; it must be detected as multi-up, split into eight labels printed in order on the paper's printer, and reprinted from the records. Also covers order, deletion and copies, manual boxes, dropped files, and files that are not PDFs, too large or damaged." -m "$TRAILER"
```

---

### Task 18: 视觉验收 V70–V72，文档

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（第 8.2 节的表）
- Modify: `README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 6 节）、`docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md`
- Modify: `CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`

- [ ] **Step 1: 加验收项**

`e2e/visual/acceptance.visual.ts`：import 加 `import { writeGridPdf } from '../support/pdf-files';`（`join`、`stubOpenDialog`、`callApi`、`FakePrinterSpec` 已有）。在批量打印的 `BATCH_PRINTERS` 之后加：

```ts
/** V70–V72：一台 100×150 的假面单机。 */
const PDF_PRINTERS: FakePrinterSpec[] = [
  { name: '面单机', paper: { widthMm: 100, heightMm: 150, dpi: 203 }, readiness: { ready: true } },
];

async function openPdfPage(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '100x150': '面单机' } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await page.getByRole('button', { name: '打印 PDF' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '打印 PDF' })).toBeVisible();
}

async function openGridPdf(app: ElectronApplication, page: Page, userData: string): Promise<void> {
  const path = join(userData, 'grid.pdf');
  await writeGridPdf(app, path);
  await stubOpenDialog(app, path);
  await openPdfPage(page);
  await page.getByRole('button', { name: '选择 PDF…' }).click();
  await expect(page.locator('.pdf-preview__summary')).toContainText('共 8 张');
}

/** 在第一页上从 (x1, y1) 拖到 (x2, y2)，按页面比例。 */
async function dragBox(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await page.getByRole('img', { name: '第一页' }).boundingBox();
  if (box === null) {
    throw new Error('the first page is not shown');
  }
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 });
  await page.mouse.up();
}
```

（`ElectronApplication`、`Page` 的类型从 `@playwright/test` 导入；文件里已有就不重复。）在 `ITEMS` 里、当时最后一项之后加：

```ts
  {
    id: 'V70',
    title: '打印 PDF · 刚打开',
    points:
      '页头「← 返回工作台」和标题「打印 PDF」；只有「文件」一段：一句说明和「选择 PDF…」；底部操作条「每张 1 份」「打印 0 张」灰掉；标题栏「打印 PDF」按下，「批量打印」「配置」没按下；1024 宽时标题栏不换行、不溢出',
    launch: { fakePrinters: PDF_PRINTERS },
    setup: async ({ page }) => {
      await openPdfPage(page);
    },
  },
  {
    id: 'V71',
    title: '打印 PDF · 2×2 面单自动切成 8 张',
    points:
      '「grid.pdf · 2 页」；裁切方式「一页多张（自动识别）」选中，下面一句说明；纸张「100×150 二联面单 · 面单机」；缩略图网格 8 张，每张黑框和字母清楚、没有糊成灰色，下面是「1. 第 1 页第 1 张」和 ← → 删除；第一张是按下状态，右侧软尺框住 100×150 的同一张，黑框贴近纸边但没有被裁；汇总「共 8 张 · 每张 1 份 · 打 8 张」；网格自己滚动，页面不横向滚动；1024 宽时网格和预览上下排列',
    launch: { fakePrinters: PDF_PRINTERS },
    setup: async ({ app, page, userData }) => {
      await openGridPdf(app, page, userData);
    },
  },
  {
    id: 'V72',
    title: '打印 PDF · 手动框选',
    points:
      '「框选区域」一段：第一页的底图按 A4 比例完整显示，两个蓝框带编号 1、2，框住左上和右下两张；右边一句说明和「框 1」「框 2」各带「删除」；预览汇总「共 4 张 · 每张 1 份 · 打 4 张」，缩略图 4 张；1024 宽时底图和框列表上下排列',
    launch: { fakePrinters: PDF_PRINTERS },
    setup: async ({ app, page, userData }) => {
      await openGridPdf(app, page, userData);
      await page.getByLabel('手动框选').check();
      await dragBox(page, [0.02, 0.02], [0.48, 0.48]);
      await dragBox(page, [0.52, 0.52], [0.98, 0.98]);
      await expect(page.locator('.pdf-preview__summary')).toContainText('共 4 张');
    },
  },
```

文件开头的说明注释里「批量打印是 V60–V62」后面加「，打印 PDF 是 V70–V72」。

`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 第 8.2 节表格最后一行之后加：

```
| V70 | 打印 PDF · 刚打开 | 页头和标题；只有「文件」一段；「打印 0 张」灰掉；标题栏「打印 PDF」按下、「批量打印」「配置」没按下；1024 宽时标题栏不溢出 |
| V71 | 打印 PDF · 2×2 面单自动切成 8 张 | 「一页多张（自动识别）」选中；纸张带打印机；8 张缩略图清楚、带序号和操作；选中的一张在右侧按 100×150 预览、不被裁；汇总；网格自己滚动；1024 宽时上下排列 |
| V72 | 打印 PDF · 手动框选 | 第一页底图完整、两个带编号的框；框列表带删除；预览变成 4 张；1024 宽时上下排列 |
```

- [ ] **Step 2: 跑视觉验收并逐张核对**

Run: `bunx playwright test --config e2e/visual/playwright.config.ts -g "V7"`
Expected: V70–V72 在 1280 / 1024 / 1920 三种尺寸下通过自动检查；打开 `test-results/visual-acceptance/` 里的截图逐项核对 points。如果 1024 宽时标题栏溢出（多了一个按钮），在 `app.css` 已有的 `@media (max-width: 1279px)` 规则里加：

```css
  /* 窄窗口里两个整页入口收紧内边距：标题栏一行放得下 */
  .title-bar .batch-button,
  .title-bar .pdf-button {
    padding-inline: var(--space-2);
  }
```

再跑一次。全部视觉验收跑一遍确认没有别的项受影响：`bunx playwright test --config e2e/visual/playwright.config.ts`。

- [ ] **Step 3: 提交验收项**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items for the PDF printing page" -m "V70 to V72 cover the empty page, a 2x2 waybill PDF detected and split into eight thumbnails beside the selected label, and two boxes drawn on the first page, at 1280, 1024 and 1920 wide. Numbered from V70 so they do not collide with the designer or batch items." -m "$TRAILER"
```

（如果 Step 2 改了 `app.css`，一起 `git add`。）

- [ ] **Step 4: 文档**

`README.md`「功能」一节，批量打印那一条之后加：

```
- **打印 PDF**：标题栏「打印 PDF」或把 PDF 拖进窗口。自动识别裁切方式：整页、去白边、一页多张（A4 上的四联面单按空白或切线切开）、手动框选（在第一页上画框，每页按同样的位置裁）；按打印机分辨率转成黑白点（阈值或抖动），缩略图就是打出来的样子；可以删掉、调顺序、设份数。PDF 只在隔离的隐藏窗口里打开，不连网。打印记录记文件名和页码，7 天内能重打。最多 200 页、50MB。
```

`README.md`「数据与日志」一节的数据目录说明里加一行：`pdf-cache/`：PDF 打印的黑白位图（重打用，7 天没用自动删）。

`docs/roadmap.md`「状态」表里 PDF 打印那一行（没有就在批量打印之后加一行）改为：

```
| PDF 打印：整页 / 去白边 / 一页多张 / 手动框选，按打印机分辨率转黑白，缩略图网格，删、排序、份数；记录 7 天内重打 | 必须 | ✅ 子项目 4 已完成（`feature/pdf-printing`）；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 6 节。Windows 上 E2E、视觉验收通过；热敏标签机真机（A4 四联面单 PDF 裁切打印、条码能扫）、macOS 待人工验收 |
```

`docs/windows-acceptance.md` 末尾（「与计划的差异」之前）加一节：

```
## PDF 打印验收（待做）

- [ ] 平台导出的 A4 四联面单 PDF：自动识别为「一页多张」，4 张都完整（外框不缺边），打到 100×150 面单纸上居中；条码用扫码枪能扫出单号。
- [ ] 一张 100×150 的面单 PDF：识别为「整页」，打出来和 PDF 1:1，没有被缩小、没有偏移。
- [ ] 跨境面单（A4 左上角一张 4×6 英寸）：识别为「去白边」，放大铺满面单纸。
- [ ] 打印点对齐：用放大镜看细线和条码边缘，没有灰边、没有一粗一细（1 位 BMP 按 pixelated 一个像素一个点；如果出现，记下打印机分辨率和驱动设置）。
- [ ] 抖动：带照片的 PDF 选「抖动」，打出来是点的疏密，不是一片黑。
- [ ] 打印记录：重打一张，出纸和第一次一样；把系统时间调后 8 天重启程序，这条记录显示「已过期」，`pdf-cache/` 里对应的文件被删掉。
- [ ] 加密的 PDF、损坏的 PDF、60MB 的 PDF：各有一句中文说明，程序不卡。
```

`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 6 节末尾加「**实现说明**（实施计划 `docs/superpowers/plans/2026-10-02-pdf-printing.md`）」一段：

```
- **实现说明**：
  - 渲染页是一个隐藏窗口，用内存里的独立会话（不和主窗口共用存储），CSP `default-src 'none'`，会话层拦下 `app://bundle/` 以外的一切请求，pdf.js 的 worker、字符映射、标准字体、解码器都随安装包；只经两个函数的 preload 和主进程通信，主进程按自己算出的尺寸核对每张位图。
  - 第一页按 96dpi 渲染来识别裁切方式；出块时每页按目标打印机的分辨率渲染（一页最多 1600 万像素，特大的页降低分辨率）。
  - 一页多张：先按 4mm 以上的空白缝切（行 → 列 → 行三层）；整页没有缝时才用分割线，而且只认正好落在 2–4 等分位置上的细线（区分切线和面单里的表格线）；小于 20mm 的零碎丢掉；几块大小差不多（±20%）才自动识别为一页多张。
  - 一块包成只有一张图的临时自由设计模板打印（不新建模板种类），渲染复用 `canvas-html.ts` 的 1 位 BMP；打印记录的模板编号是 `builtin:pdf-piece`。
  - 份数是全部块统一的；每块每份一条打印记录。按顺序打印、暂停、打印机问题自动暂停复用批量打印的 `BatchRun`。
  - 一次最多 1000 张（超出的不处理并说明）；缩略图按整数倍缩小、一格有黑点就算黑。
```

`docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md` 打印结果通知的 `source` 说明里补上 `pdf`（PDF 打印）：PDF 打的 `rule` 固定为 `{ "id": "pdf", "name": "PDF 打印" }`，`fields` 是「文件」「页码」「第几张」。

`CLAUDE.md`（根目录）：「数据与环境」表第一行的内容加 `PDF 位图缓存 pdf-cache/`；「架构」代码块里 `src/main` 那一行的括号里加 `PDF 打印（pdf/）`；「安全底线」第一条之后加一条：

```
- PDF 只在隐藏的渲染窗口里解析（`src/main/pdf/pdf-render-window.ts`）：独立的内存会话、CSP `default-src 'none'`、拦下 `app://bundle/` 以外的请求、只有两个函数的 preload；主进程按自己算出的尺寸核对回来的位图。不要把 pdf.js 挪进主进程或主窗口。
```

`src/core/CLAUDE.md` 模块表加一行：

```
| `pdf/` | PDF 打印的纯逻辑：限制和类型（`pdf-model.ts`）、黑白位图的缓存格式（`mono-pack.ts`）、内容外框（`content-box.ts`）、一页多张的切分和裁切方式识别（`page-split.ts`，先按缝切，整页没有缝才认等分位置上的分割线）、放到纸上（`piece-fit.ts`：转 90°、等比居中、转黑白、缩略图）、一块 → 临时自由设计模板（`piece-template.ts`）、界面交来的设置的校验（`parse-pdf-request.ts`）；测试用合成页面 `testing/synthetic-page.ts` |
```

`src/main/CLAUDE.md` 在「本地文字识别」一节之前加一节：

```
## PDF 打印（`pdf/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 6 节。

- **分层**：除了 `pdf-render-window.ts`（隐藏窗口、会话），都不 import electron，用 `bun test` 测试。
  - `pdf-render-host.ts`：请求带编号、各自限时；回复用 `shared/pdf-render-protocol.ts` 的 `readRenderReply` 核对（位图宽高等于主进程自己算的），格式不对或超时就关掉渲染页；
  - `pdf-station.ts`：打开文件（先看大小和 `%PDF-` 文件头）、识别第一页、按设置出块（换设置时上一次作废，它存的块删掉，打过的留着）、预览一块、按顺序打印（`BatchRun`，来源 `pdf`）；
  - `piece-cache.ts`：每块一个 `<UUID>.lfm`，在数据目录的 `pdf-cache/`；预览、重打时续期，启动时删 7 天没用过的。编号拼进路径前先核对格式。
- **渲染页**：`src/renderer/pdf-render.html` + `src/renderer/src/pdf-render/main.ts`（第二个页面入口）、`src/preload/pdf-render.ts`（第二个 preload）。会话是内存里的独立分区，`app://` 协议另挂一份（`handleAppScheme` 的 `target`），权限一律拒绝，`render-session-policy.ts` 决定放行哪些请求。pdf.js 的运行时文件由 `scripts/pdfjs-assets.ts` 在构建时放进 `out/renderer/pdfjs/`。
- **打印记录**：PDF 打的记录带 `pdf`（文件、页码、第几张、位图编号，迁移 7）；`jobs:preview`、`jobs:reprint` 按位图编号读回、包成临时模板；预览不显示「靠近纸边」（一块本来就铺满纸）。
```

`src/renderer/CLAUDE.md`「分层」表之后加一条：

```
- **PDF 渲染页**（`src/pdf-render/main.ts`）不是界面：没有 React，不用 `window.api`，只经 `window.pdfHost` 收请求、回灰度位图；它跑着不可信的 PDF，不要给它的 preload 加任何别的能力。
```

- [ ] **Step 5: `bun run check` 后提交，推送，开 PR**

```bash
git add README.md docs/roadmap.md docs/windows-acceptance.md docs/superpowers/specs/2026-10-01-feature-parity-design.md docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md CLAUDE.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs: describe PDF printing" -m "README, roadmap, the Windows acceptance checklist for real printers, the implementation notes in the design, the webhook source list and the CLAUDE.md files now cover the sandboxed render window, splitting rules, the bitmap cache and the records." -m "$TRAILER"
git push -u origin feature/pdf-printing
gh pr create --base master --title "feat: PDF printing (sub-project 4)" --body "<中文说明：做了什么、为什么、安全上怎么隔离 PDF、验证（单元测试、E2E、视觉验收 V70–V72、待真机验收的项）；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并（中间不发版，见设计第 1 节）。macOS 上只跑了 CI：PR 说明里写明 PDF 打印只在 Windows 上实测过。

---

## Self-Review 记录

- **设计覆盖（第 6 节）**：
  - 入口（工作台「打印 PDF」、拖进窗口）→ Task 16（标题栏按钮、`useFileDrop` 按扩展名分流）、Task 13（拖进来的只收字节）。
  - 渲染（隐藏窗口、sandbox、只加载本程序的页面、按目标打印机分辨率、≤ 200 页、≤ 50MB）→ Task 10（核对、超时）、Task 11（窗口、会话、CSP、构建）、Task 12（大小、文件头、页数、按 `dpiFor` 渲染）；每页像素上限、超时 → `PDF_LIMITS.pagePixels`、`PDF_OPEN_TIMEOUT_MS` / `PDF_PAGE_TIMEOUT_MS`。
  - 裁切方式（自动识别、可改）→ Task 3、4（外框、切分、识别）、Task 12（第一页识别）、Task 15（单选、标注自动识别）；手动框选 → Task 4（`boxRect`、`cropRects`）、Task 14（`boxFromDrag`）、Task 15（`PdfBoxEditor`）。
  - 输出（黑白、阈值 / 抖动、按纸张的标签 HTML、照常打印、纸张 → 打印机、份数、顺序、删除、缩略图网格 = 真实输出）→ Task 5、6、12、15。
  - 记录和重打（来源 PDF、文件名 + 页码 + 第几张、位图留 7 天、过期说明）→ Task 7、8、9、13。
  - 纯逻辑单元测试（外框、空白切分、分割线、旋转、缩放、黑白）→ Task 3、4、5（合成位图）。
  - 第 9、11 节：不可信输入有上限（文件、页数、像素、块数、框数、份数、文件名）；Rule of 2（PDF 只在 sandbox 窗口里）；IPC 每个参数校验（Task 6 的 parse、Task 13 的 require*）；新通道只给最小能力（打印的是「这次出块的这些块」，不是任意位图）；小步提交。
- **没有占位**：每个代码步骤都给了完整代码；需要按安装的版本取舍的三处（`isEvalSupported`、`canvas` / `canvasContext`、`wasm/`）在 Task 1 Step 3 核对，Task 11 写明怎么落实。依赖批量打印的地方（`BatchRun`、`requireBytes`、`useFileDrop`、`.batch-page` 样式、`JobLog` 的批次按钮）在 Task 1 Step 1 核对，写法按批量打印计划里的代码。
- **类型一致**：`PdfRef`（Task 7）在 Task 8 的 `FieldsPrint.pdf`、Task 12 的 `printPiece`、Task 13 的 `pdfLabelOf` 里用同样的四个字段；`MonoBitmap`（Task 2）贯穿 `piece-fit`、`piece-template`、`piece-cache`、`pdf-station`；`PdfLayout` / `PdfPrintRequest`（Task 2）由 Task 6 的 parse 产出、Task 12 消费、Task 14–15 组装；`RenderedPage.dpi` 是实际渲染分辨率，切分按它换算毫米（`splitOptionsFor(rendered.dpi)`），出块的点数按打印机的 `dpi`（`paperDots(paper, dpi)`）。
- **要回头确认的决定**：
  1. 一块用临时自由设计模板打印，不新建模板种类：预览、打印、记录全部复用；代价是每打一张，打印适配器的日志里会有一条「靠近纸边」的检查提示（Task 13 只在预览里去掉了）。
  2. 改阈值、纸张、裁切都整份重新渲染（不缓存页面位图）：200 页的 PDF 每次改设置要等几十秒；阈值滑块有 0.3 秒防抖。
  3. 份数对所有块统一，没有每块单独的份数。
  4. 分割线只在整页一条缝也没有时才用，而且必须正好落在等分位置上：不规则排版的多联面单要用手动框选。
  5. 缓存位图在启动时按「最后用到的时间」清理，不征求确认（程序自己的缓存，和日志按天数保留一样）；界面按记录时间判断过期，比实际清理略早。
  6. 隐藏渲染窗口在打开文件期间一直保留（改设置要重新渲染），关文件、换文件、退出时销毁。

