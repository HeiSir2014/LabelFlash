# 模板库（子项目 2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配置中心「模板」页加「从模板库新建」：左边 7 个分类，右边是 18 个内置自由设计模板的缩略图（就是按示例数据排好的真实打印 HTML），可按纸张筛选；点「用这个模板」复制成自定义模板并进入设计器，设计器先按这个模板的示例数据预览，「打印一张试试」打的也是它。模板库覆盖服装吊牌、价签、商品条码、鞋盒标、食品标签、珠宝 / 小商品、仓储（货架 / 库位、资产、箱标），纸张覆盖 30×20、40×30、50×30、60×40、70×50、100×100、100×150；字段名统一（品名、编码、颜色、尺码、价格、商品码、生产日期、保质期、货架号……），和内置识别规则、批量打印的按列名自动对列一致。

**Architecture:** 模板库是 core 里的纯数据（`src/core/templates/library/`）：每个模板是一个普通的 `CanvasTemplate`（编号前缀 `library:`，`TEMPLATE_ID_PATTERN` 不认它，所以进不了模板列表、设置、规则绑定和本机接口）加一份示例数据，单元测试逐个核对：过用户模板同一个校验器不变、示例数据正好覆盖用到的字段、字段名在统一的字段表里、203 / 300dpi 下排版没有任何问题、主进程画出来每个条码二维码都印得出（HTML 快照）。缩略图由一个没有参数的 IPC（`templates:library`）在主进程按示例数据现排（和打印同一个 `renderLabelHtml`，18 个约 20ms、80KB），界面用 `sandbox=""` 的 `srcdoc` iframe 按比例缩小显示（和现有的预览同一种隔离）。「用这个模板」走只收模板库编号的 `templates:create-from-library` → `TemplateCatalog.createFromLibrary`（复制、存成自定义模板）。复制出的模板在设计器里先按示例数据预览：`previewTemplate` / `printSample` 多一个可选的模板库编号，主进程按编号取示例数据（页面交不进任意字段），预览内容一改（打字或扫码）就回到按内容识别。不加数据库迁移，不加依赖。

**Tech Stack:** TypeScript、Bun test、Electron 主进程 IPC、React 19、Playwright E2E 和视觉验收。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3.5、4、10、11 节（用户 2026-10-01：「按面单和标签最佳实践设计！但是也不要太复杂！」）。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件。`bun run lint`（`biome check`）同时核对格式（行宽 120）和 import 顺序：报差异时照它给出的 diff 用 Edit 调整（离得远的路径在前；同一来源里的名字逐字比较）。计划里的代码已按这些规则写，个别换行和 Biome 的结果不同时以 Biome 为准。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言（Biome 禁止）。注释中文，写为什么；数值常量起名、带单位、写取值依据。模板里元素的坐标、字号是版式数据（和 `builtin-canvas.ts`、`builtin-waybills.ts` 一样直接写数字），不算魔法数字。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **分支**：实现顺序是 1（设计器）→ 3（批量打印）→ 2（本计划）→ 4（PDF）。批量打印合进 master 之后，从 master 拉 `feature/template-library`。本计划用到前面留下的：
  - 设计器 1b：`CanvasDesigner`（`aria-label="设计器"`，打印前检查 `aria-label="打印前检查"`）、1b Task 15 改过的 `TemplatesPage`（`EditView` 里的设计器、`EditActions` 的「打印一张试试」、列表里的「新建自由设计模板」按钮和 `.template-list__create`）、`use-templates.ts` 的 `createCanvas` / `printSample`、`templates:create-canvas`、`label:print-sample`（只收自由设计模板）、`PrintService.printSample`、`SampleInput` 的 `isCompact`、`lib/canvas-view.ts` 的 `PX_PER_MM`。
  - 批量打印：`core/batch/column-mapping.ts` 的 `autoMapping`、`mappableVariables`，`core/batch/batch-model.ts` 的 `SERIAL_FIELD`（只在测试里用，核对字段名能自动对列）。
- **数据库**：不需要迁移。模板库是随程序发布的静态数据；复制出来的模板就是普通的自定义模板，存进现有的模板表。
- **视觉验收编号**：模板库固定用 **V50–V55**，追加在 `ITEMS` 当时最后一项之后，不和设计器（V45–V48）、批量打印（V60–V62）、PDF（V70–V72）抢编号。
- **用词**：界面上说「示例数据」「用这个模板」「从模板库新建」；不说「打印成功」。

## 关键取舍（Task 14 写进设计文档第 4 节）

1. **18 个模板**：设计文档第 4 节各类的个数加起来是 18（3 + 3 + 3 + 2 + 2 + 2 + 3），就按它做，不凑 20。
2. **30×20 纸**：现在纸张高度下限是 25mm，30×20 存不进模板（`sanitizePaper` 退回默认纸张）。Task 1 把高度下限降到 20mm，加预设「30×20 标签」。标签模板在 20mm 高的纸上二维码跟着按短边缩小（`withPaper`），边距超过 5mm 时二维码会小于 10mm 的下限，按现有规则放不下就不印并提示。
3. **模板库不进模板列表**：编号用 `library:` 前缀，`TEMPLATE_ID_PATTERN` 不认它：不能设为当前模板、不能被规则绑定或按字段换模板选中、本机接口 `GET /v1/templates` 不列出。理由：模板库是起点（几乎总要改纸张、打印机、字），18 个直接摆进列表会把用户自己的模板淹没；「内置只读、复制后再改」本来就是这个程序的做法。内置的「吊牌（自由设计示例）」（`builtin:canvas-tag`）保留在模板列表里不动（1b、批量打印的测试和视觉验收都用它），模板库的「样衣吊牌」直接复用它的元素，不写第二份。
4. **缩略图怎么来**：一个没有参数的 IPC `templates:library` 返回每个模板的说明和按示例数据排好的 HTML（主进程 `renderLabelHtml`，和打印同一份，按 203dpi；条码编码要用主进程里的 bwip-js，界面画不了）。一次往返拿全部，不是每张缩略图各调一次。实测（写计划时用当前代码排了一遍）：18 个模板在 203 和 300dpi 各排一次共 36ms，HTML 每套约 80KB，所以每次打开现排、不缓存（{日期} 跟着今天）。界面用 `<iframe sandbox="" srcdoc>`（不能跑脚本、独立的源，和模板页预览一样）按比例缩小显示，缩放比例是纯函数（`lib/template-library.ts`），不超过实物大小。
5. **复制后的预览用示例数据**：模板库里的价签、食品标签这些字段（品名、价格、配料……）不是扫码识别出来的，复制后要是按「预览内容」（最近一次扫码）预览，设计器的画布几乎是空的。所以「用这个模板」之后预览内容换成这个模板的示例数据，标签旁写「预览内容 · 示例数据」；打字或扫码改了预览内容就回到按内容识别。页面只交模板库编号，示例数据由主进程按编号取（`previewTemplate`、`printSample` 多一个可选参数），页面交不进任意字段（IPC 只给最小能力）。
6. **字段名**：统一的字段表 `LIBRARY_FIELD_NAMES`（29 个），测试核对：每个模板用到的字段都在表里、表里每个名字都有模板在用、内置规则「横杠三段」的编码 / 颜色 / 尺码、内置的货架号、「多行键值」的数量、批量打印的序号都在表里；用表里的名字做表头时，批量打印的 `autoMapping` 能把每个模板的每个变量都自动对上。注意：内置规则「多行键值」把「编码」当成「款号」的别名，按它扫进来的是「款号」——这一条不改（改内置规则会影响已有用户的识别结果），模板库按设计文档用「编码」，和主要的样衣流程（横杠三段）一致。
7. **珠宝「尾巴标」**：真正的哑铃形尾巴标是 72×10、95×12 这类窄长条，比纸张高度下限 20mm 还矮，这一期不做；珠宝 / 小商品用 30×20、40×30 的矩形标签。
8. **最佳实践，但不复杂**：边距统一 2mm（安全区 1.5mm 之内再留 0.5mm）；价签按明码标价的要素（品名、产地、规格、等级、单位、零售价）；服装合格证按服装标识的常见内容（品名、款号、号型、成分、执行标准、等级、安全类别）；食品标签按预包装食品标签的要素（品名、配料、净含量、生产日期、保质期、贮存条件、生产者、产地）；商品条码一律 EAN-13（零售结算），货号、库位、箱号用 Code128，资产编号用二维码（50×30 上放不下 12 位的 Code128）。条码模块、二维码模块取整到点、静区由现有渲染保证，测试在 203 和 300dpi 都排一遍。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/shared/paper-sizes.ts` (+ `.test.ts`) | 修改 | 高度下限 20mm；预设「30×20 标签」 |
| `src/core/templates/templates.test.ts` | 修改 | 30×20 上的标签模板；`createFromLibrary` |
| `src/core/templates/library/library-model.ts` (+ `.test.ts`) | 新建 | 分类、编号、示例数据、统一字段表、`libraryEntry`、`librarySampleScan` |
| `src/core/templates/library/library-elements.ts` (+ `.test.ts`) | 新建 | 写模板用的小工具：文字、条码、二维码、横线、「名称 \| 值」表格 |
| `src/core/templates/library/garment.ts`、`price.ts`、`product-barcode.ts` | 新建 | 服装吊牌 3、价签 3、商品条码 3 |
| `src/core/templates/library/shoe-box.ts`、`food.ts`、`jewelry.ts`、`warehouse.ts` | 新建 | 鞋盒标 2、食品标签 2、珠宝 / 小商品 2、仓储 3 |
| `src/core/templates/library/template-library.ts` (+ `.test.ts`) | 新建 | 按分类排好的 `TEMPLATE_LIBRARY`、`findLibraryEntry`；逐个模板的核对 |
| `src/core/templates/builtin-canvas.ts` | 修改 | 文件说明指向模板库 |
| `src/core/templates/template-catalog.ts` | 修改 | `createFromLibrary` |
| `src/core/print-service.ts` (+ `.test.ts`) | 修改 | `printSample` 可以按示例数据打 |
| `src/shared/template-library.ts` | 新建 | IPC 用的 `LibraryPreview` |
| `src/main/printing/library-previews.ts` (+ `.test.ts`) | 新建 | 按示例数据排出全部缩略图 |
| `src/main/printing/library-html.test.ts`、`__snapshots__/library-html.test.ts.snap` | 新建 | 每个模板在 203 / 300dpi 都印得出；HTML 快照 |
| `src/main/ipc-validators.ts` (+ `.test.ts`) | 修改 | `requireLibraryTemplateId` |
| `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts` | 修改 | `templates:library`、`templates:create-from-library`；预览、试打带模板库编号 |
| `src/renderer/src/lib/template-library.ts` (+ `.test.ts`) | 新建 | 分类和纸张筛选、缩略图比例、示例数据跟着哪个模板 |
| `src/renderer/src/view-models/use-sample-content.ts`、`use-template-preview.ts`、`use-templates.ts`、`use-config-center.ts` | 修改 | 示例数据；模板库开关、复制 |
| `src/renderer/src/view-models/use-template-library.ts` | 新建 | 读模板库、分类和纸张筛选 |
| `src/renderer/src/components/SampleInput.tsx` | 修改 | 「预览内容 · 示例数据」 |
| `src/renderer/src/components/TemplateLibrary.tsx` | 新建 | 模板库：分类、纸张、缩略图卡片 |
| `src/renderer/src/components/config/pages/TemplatesPage.tsx`、`src/renderer/src/App.tsx` | 修改 | 入口、第三个视图、接线 |
| `src/renderer/src/styles/tokens.css`、`app.css` | 修改 | 模板库的样式 |
| `e2e/support/app-helpers.ts`、`e2e/app.e2e.ts` | 修改 | 把「量有没有被裁」挪成共用的 `clippedLines` |
| `e2e/template-library.e2e.ts` | 新建 | 从模板库新建并打印、示例数据试打、Esc、系统字体下不被裁 |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V50–V55 |
| `docs/superpowers/specs/2026-10-01-feature-parity-design.md`、`README.md`、`docs/roadmap.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md` | 修改 | 文档 |

---

### Task 1: 30×20 纸

**Files:**
- Modify: `src/shared/paper-sizes.ts`
- Modify: `src/shared/paper-sizes.test.ts`
- Modify: `src/core/templates/templates.test.ts`

- [ ] **Step 1: 写测试**

`paper-sizes.test.ts` 的 `describe('presets')` 末尾加：

```ts
  test('include the 30x20 label for jewellery and small goods', () => {
    expect(formatPaperName({ widthMm: 30, heightMm: 20 })).toBe('30×20 标签');
    expect(parsePaperKey('30x20')).toEqual({ widthMm: 30, heightMm: 20 });
  });
```

`describe('sanitizePaper')` 里 `'keeps a valid size and rounds to 0.1mm'` 之后加：

```ts
  // 最小的常用热敏标签：珠宝、小商品的 30×20。
  test('keeps a 30x20 label', () => {
    expect(sanitizePaper({ widthMm: 30, heightMm: 20 }, fallback)).toEqual({ widthMm: 30, heightMm: 20 });
  });
```

`templates.test.ts` 的 `describe('TemplateCatalog', ...)` 之前（`describe('built-in templates', ...)` 里最后一个用例之后）加：

```ts
  // 30×20 是最小的常用标签：标签模板换上去，二维码跟着缩小、仍在纸内，纸张也存得住。
  test('moves a label template onto 30x20 paper with its QR code still inside', () => {
    const paper = { widthMm: 30, heightMm: 20 };
    const small = withPaper(GENERIC_TEMPLATE, paper);
    expect(small.qr.sizeMm).toBeLessThanOrEqual(maxQrSizeMm(paper, small.paddingMm));
    expect(sanitizeLabel(small, small.id, GENERIC_TEMPLATE).paper).toEqual(paper);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/paper-sizes.test.ts src/core/templates/templates.test.ts`
Expected: FAIL：`formatPaperName` 得到 `30×20`；`parsePaperKey('30x20')`、`sanitizePaper` 因为高度低于 25mm 返回 null / 默认纸张。

- [ ] **Step 3: 实现**（`src/shared/paper-sizes.ts`）

`PAPER_LIMITS_MM` 和它的注释换成：

```ts
/**
 * 自定义尺寸的范围：覆盖所有预设并留出余量。
 * 高度下限 20mm：最小的常用热敏标签是 30×20（珠宝、小商品）。标签模板换到这么矮的纸上，二维码按短边等比缩小（withPaper），
 * 边距超过 5mm 时二维码会小于最小边长 10mm，按 planQr 的规则放不下就不印并提示。
 * 宽度下限 25mm：边距最大 6mm 时，二维码仍放得下最小边长 10mm。宽度上限 120mm：不做横版纸（例如 150×100）。
 */
export const PAPER_LIMITS_MM = {
  width: { min: 25, max: 120 },
  height: { min: 20, max: 220 },
} as const;
```

`PAPER_PRESETS` 里 `{ name: '40×30 标签', ... }` 那一行之后加：

```ts
  { name: '30×20 标签', widthMm: 30, heightMm: 20, parts: [], usage: '珠宝、小商品' },
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared src/core/templates`
Expected: PASS（`'falls back when the size is missing or out of range'` 里宽 20mm 的纸仍然不收：宽度下限没变）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/paper-sizes.ts src/shared/paper-sizes.test.ts src/core/templates/templates.test.ts
git commit -m "feat(paper): allow 30x20 labels" -m "The template library needs the 30x20 label used for jewellery and small goods, which was below the 25mm height limit and fell back to 60x40. Label templates on such short paper shrink their QR code with the paper as before." -m "$TRAILER"
```

---

### Task 2: 模板库的模型和写模板的小工具

**Files:**
- Create: `src/core/templates/library/library-model.ts`、`library-model.test.ts`
- Create: `src/core/templates/library/library-elements.ts`、`library-elements.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/library/library-model.test.ts
import { describe, expect, test } from 'bun:test';
import { TEMPLATE_ID_PATTERN } from '../template-model';
import { LIBRARY_SAMPLE_RULE, LIBRARY_TEMPLATE_ID_PATTERN, libraryEntry, librarySampleScan } from './library-model';

const SPEC = {
  category: 'price',
  slug: 'price-simple',
  name: '简洁价签',
  description: '品名、大号价格、EAN-13',
  paper: { widthMm: 40, heightMm: 30 },
  elements: [],
  sample: { content: '6901234567892', fields: { 品名: '纯棉袜子', 价格: '12.80' } },
} as const;

describe('libraryEntry', () => {
  test('builds a canvas template with a library id and keeps the sample fields in order', () => {
    const entry = libraryEntry({ ...SPEC, elements: [] });
    expect(entry.template).toEqual({
      kind: 'canvas',
      id: 'library:price-simple',
      name: '简洁价签',
      paper: { widthMm: 40, heightMm: 30 },
      printer: null,
      elements: [],
    });
    expect(entry.sample).toEqual({
      content: '6901234567892',
      fields: [
        { name: '品名', value: '纯棉袜子' },
        { name: '价格', value: '12.80' },
      ],
    });
  });

  // 模板库的编号进不了模板列表：TEMPLATE_ID_PATTERN 只认 builtin: 和 custom:。
  test('uses ids the template list does not accept', () => {
    const { id } = libraryEntry({ ...SPEC, elements: [] }).template;
    expect(LIBRARY_TEMPLATE_ID_PATTERN.test(id)).toBe(true);
    expect(TEMPLATE_ID_PATTERN.test(id)).toBe(false);
  });

  test('fails fast on a slug that is not lowercase letters, digits and hyphens', () => {
    expect(() => libraryEntry({ ...SPEC, slug: 'Price Tag', elements: [] })).toThrow('library template slug');
  });
});

describe('librarySampleScan', () => {
  test('treats the sample as a scan by the library sample rule, on a copy of the fields', () => {
    const { sample } = libraryEntry({ ...SPEC, elements: [] });
    const scan = librarySampleScan(sample);
    expect(scan).toEqual({
      raw: '6901234567892',
      ruleId: LIBRARY_SAMPLE_RULE.id,
      ruleName: '模板库示例',
      fields: [
        { name: '品名', value: '纯棉袜子' },
        { name: '价格', value: '12.80' },
      ],
    });
    scan.fields[0] = { name: '品名', value: '改了' };
    expect(sample.fields[0]?.value).toBe('纯棉袜子');
  });
});
```

```ts
// src/core/templates/library/library-elements.test.ts
import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS } from '../canvas-model';
import { barcode, hLine, pairTable, qr, text } from './library-elements';

describe('library elements', () => {
  test('text uses the designer defaults and overrides only what it is given', () => {
    expect(text('name', '品名', [2, 2, 36, 5], '{品名}', { bold: true })).toEqual({
      id: 'name',
      name: '品名',
      x: 2,
      y: 2,
      width: 36,
      height: 5,
      rotation: 0,
      locked: false,
      kind: 'text',
      text: '{品名}',
      fontSizeMm: 3,
      bold: true,
      align: 'left',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    });
  });

  test('text wraps long content when asked', () => {
    expect(text('ingredients', '配料', [2, 11, 96, 14], '配料：{配料}', { wrap: true }).fit).toBe('wrap');
  });

  test('barcode prints its number underneath', () => {
    expect(barcode('code', '商品码', [2, 18, 36, 10], 'ean13', '{商品码}')).toMatchObject({
      kind: 'barcode',
      symbology: 'ean13',
      value: '{商品码}',
      showText: true,
      textSizeMm: 2.4,
    });
  });

  test('qr defaults to error correction M', () => {
    expect(qr('qr', '二维码', [44, 2, 14, 14], '{编码}').errorCorrection).toBe('M');
  });

  test('hLine is a solid line of the minimum width', () => {
    expect(hLine('rule', '分隔线', 2, 37, 66)).toMatchObject({
      kind: 'line',
      x: 2,
      y: 37,
      width: 66,
      height: CANVAS_LIMITS.minSizeMm,
      dashed: false,
    });
  });

  test('pairTable puts bold names on the left and lets the last row and column take the rest', () => {
    const table = pairTable(
      'info',
      '参数',
      [2, 9, 46, 15],
      10,
      [
        ['货号', '{编码}'],
        ['颜色', '{颜色}'],
        ['价格', '¥{价格}'],
      ],
      2.8,
    );
    expect(table.rowsMm).toEqual([5, 5, 0]);
    expect(table.columnsMm).toEqual([10, 0]);
    expect(table.borderMm).toBe(CANVAS_LIMITS.minSizeMm);
    expect(table.cells.map((row) => row.map((cell) => [cell.text, cell.bold, cell.fontSizeMm]))).toEqual([
      [
        ['货号', true, 2.8],
        ['{编码}', false, 2.8],
      ],
      [
        ['颜色', true, 2.8],
        ['{颜色}', false, 2.8],
      ],
      [
        ['价格', true, 2.8],
        ['¥{价格}', false, 2.8],
      ],
    ]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/library`
Expected: FAIL，`Cannot find module './library-model'`。

- [ ] **Step 3: 实现**

```ts
// src/core/templates/library/library-model.ts
import type { PaperSize } from '../../../shared/paper-sizes';
import type { ScanField, ScanResult } from '../../scan/scan-result';
import type { CanvasElement, CanvasTemplate } from '../canvas-model';

/**
 * 模板库：按行业分类的自由设计模板，挑一个复制成自定义模板再改。
 * 设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 4 节。模板库的模板不进模板列表：
 * 不能设为当前模板、不能被规则绑定、本机接口不列出，要用先复制（TemplateCatalog.createFromLibrary）。
 */

/** 分类：顺序就是模板库左栏的顺序，也是 TEMPLATE_LIBRARY 的顺序。 */
export const LIBRARY_CATEGORIES = [
  { id: 'garment', label: '服装吊牌' },
  { id: 'price', label: '价签' },
  { id: 'barcode', label: '商品条码' },
  { id: 'shoe-box', label: '鞋盒标' },
  { id: 'food', label: '食品标签' },
  { id: 'jewelry', label: '珠宝 / 小商品' },
  { id: 'warehouse', label: '仓储' },
] as const;

export type LibraryCategoryId = (typeof LIBRARY_CATEGORIES)[number]['id'];

/** 模板库里模板的编号前缀：和内置（builtin:）、自定义（custom:）分开，TEMPLATE_ID_PATTERN 不认它。 */
export const LIBRARY_TEMPLATE_PREFIX = 'library:';
/** 前缀 + 小写字母、数字、连字符；40 个字符足够写清楚是哪个模板。 */
export const LIBRARY_TEMPLATE_ID_PATTERN = /^library:[a-z0-9-]{1,40}$/;

/** 示例数据：缩略图、复制后设计器里的预览、「打印一张试试」都用它。 */
export interface LibrarySample {
  /** 完整内容：{完整内容}、二维码的「完整内容」。 */
  content: string;
  fields: readonly ScanField[];
}

/** 示例数据算在哪条「规则」名下：{规则} 印出来是「模板库示例」。 */
export const LIBRARY_SAMPLE_RULE = { id: 'library', name: '模板库示例' } as const;

/** 模板库里的一个模板。 */
export interface LibraryEntry {
  category: LibraryCategoryId;
  /** 一句话：印了哪些内容、适合什么场景。 */
  description: string;
  /** 编号是 library:xxx；复制时换成自定义模板的编号。 */
  template: CanvasTemplate;
  sample: LibrarySample;
}

/**
 * 模板库统一用的字段名。批量打印按列名自动对列：Excel 的表头写这些名字就能对上；
 * 编码、颜色、尺码和内置规则「横杠三段」一致，货架号是内置的图中文字识别产出的字段，数量和「多行键值」一致，
 * 序号是批量打印给的。测试核对模板只用这些名字、每个名字都有模板在用。
 */
export const LIBRARY_FIELD_NAMES: readonly string[] = [
  '品名',
  '编码',
  '颜色',
  '尺码',
  '货架号',
  '价格',
  '原价',
  '商品码',
  '规格',
  '产地',
  '等级',
  '单位',
  '成分',
  '执行标准',
  '安全类别',
  '净含量',
  '配料',
  '生产日期',
  '保质期',
  '贮存条件',
  '生产商',
  '材质',
  '重量',
  '资产名称',
  '资产编号',
  '使用部门',
  '数量',
  '序号',
  '备注',
];

/**
 * 示例用的 EAN-13：690 是中国的前缀，校验位按 GS1 算法核对过
 * （6+27+0+3+2+9+4+15+6+21+8+27 = 128，(10 − 8) mod 10 = 2）。
 */
export const SAMPLE_EAN13 = '6901234567892';

/** 写一个模板库模板要给的东西；示例字段按写的顺序成为字段列表。 */
export interface LibraryEntrySpec {
  category: LibraryCategoryId;
  /** 编号里 library: 后面的部分。 */
  slug: string;
  name: string;
  description: string;
  paper: PaperSize;
  elements: CanvasElement[];
  sample: { content: string; fields: Readonly<Record<string, string>> };
}

/**
 * 组装模板库的一个模板。编号不合法时立刻抛错（模板库是随程序发布的数据，写错了在加载时就暴露，测试会挂）。
 * @throws Error slug 不是小写字母、数字、连字符时。
 */
export function libraryEntry(spec: LibraryEntrySpec): LibraryEntry {
  const id = `${LIBRARY_TEMPLATE_PREFIX}${spec.slug}`;
  if (!LIBRARY_TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid library template slug: ${spec.slug}`);
  }
  return {
    category: spec.category,
    description: spec.description,
    template: {
      kind: 'canvas',
      id,
      name: spec.name,
      paper: { ...spec.paper },
      printer: null,
      elements: spec.elements,
    },
    sample: {
      content: spec.sample.content,
      fields: Object.entries(spec.sample.fields).map(([name, value]) => ({ name, value })),
    },
  };
}

/** 示例数据当作一次识别结果（不经过识别规则）；字段是拷贝，调用方改了不会改到模板库。 */
export function librarySampleScan(sample: LibrarySample): ScanResult {
  return {
    raw: sample.content,
    ruleId: LIBRARY_SAMPLE_RULE.id,
    ruleName: LIBRARY_SAMPLE_RULE.name,
    fields: sample.fields.map((field) => ({ ...field })),
  };
}
```

```ts
// src/core/templates/library/library-elements.ts
import {
  CANVAS_LIMITS,
  type CanvasBarcode,
  type CanvasElementBase,
  type CanvasLine,
  type CanvasQr,
  type CanvasTable,
  type CanvasTableCell,
  type CanvasText,
  DEFAULT_TABLE_CELL,
} from '../canvas-model';
import type { QrErrorLevel, TextAlign } from '../template-model';

/**
 * 写模板库模板用的小工具：元素的框写成元组，一个模板读起来像一张坐标表。
 * 只是 CanvasElement 的简写，产出的元素和设计器保存的一模一样（测试核对过一遍校验器不变）。
 */

/** 元素的框（mm）：左、上、宽、高。 */
export type Box = readonly [x: number, y: number, width: number, height: number];

/** 文字的样式：只写和默认不同的。 */
export interface TextOptions {
  fontSizeMm?: number;
  bold?: boolean;
  align?: TextAlign;
  /** 反白：黑底白字（标题、特价横幅、大尺码）。 */
  inverse?: boolean;
  /** 配料这类长文字按框宽折行；其余放不下先缩小。 */
  wrap?: boolean;
}

/** 文字默认字号：60×40 标签上正文的常用大小。 */
const DEFAULT_FONT_SIZE_MM = 3;
/** 条码下面号码的默认字号：比正文小一点，13 位的 EAN-13 号码在 36mm 宽的框里放得下。 */
const DEFAULT_BARCODE_TEXT_MM = 2.4;
/** 表格默认字号：和设计器新建表格一致。 */
const DEFAULT_TABLE_FONT_MM = DEFAULT_TABLE_CELL.fontSizeMm;

function base(id: string, name: string, [x, y, width, height]: Box): CanvasElementBase {
  return { id, name, x, y, width, height, rotation: 0, locked: false };
}

/** 文字：垂直居中；放不下先缩小（wrap 时先折行）。 */
export function text(id: string, name: string, box: Box, content: string, options: TextOptions = {}): CanvasText {
  return {
    ...base(id, name, box),
    kind: 'text',
    text: content,
    fontSizeMm: options.fontSizeMm ?? DEFAULT_FONT_SIZE_MM,
    bold: options.bold ?? false,
    align: options.align ?? 'left',
    valign: 'middle',
    fit: options.wrap === true ? 'wrap' : 'shrink',
    inverse: options.inverse ?? false,
  };
}

/** 一维码，下面印号码。模板库只用两种：零售结算的 EAN-13，货号、库位、箱号的 Code128。 */
export function barcode(
  id: string,
  name: string,
  box: Box,
  symbology: 'code128' | 'ean13',
  value: string,
  textSizeMm: number = DEFAULT_BARCODE_TEXT_MM,
): CanvasBarcode {
  return { ...base(id, name, box), kind: 'barcode', symbology, value, showText: true, textSizeMm };
}

/** 二维码：默认容错 M（标签常用；放不下时排版自动降级）。 */
export function qr(id: string, name: string, box: Box, value: string, errorCorrection: QrErrorLevel = 'M'): CanvasQr {
  return { ...base(id, name, box), kind: 'qr', value, errorCorrection };
}

/** 横线：粗细是最小线宽（203dpi 上 2 个点）。 */
export function hLine(id: string, name: string, x: number, y: number, width: number): CanvasLine {
  return { ...base(id, name, [x, y, width, CANVAS_LIMITS.minSizeMm]), kind: 'line', dashed: false };
}

/**
 * 两列的「名称 | 值」表格：每行一样高，左列加粗写名称，右列写值（通常是 {字段名}）。
 * 合格证、价签、食品标签的参数区都是这个样子；边框是最小线宽。
 */
export function pairTable(
  id: string,
  name: string,
  box: Box,
  nameWidthMm: number,
  rows: readonly (readonly [label: string, value: string])[],
  fontSizeMm: number = DEFAULT_TABLE_FONT_MM,
): CanvasTable {
  const [, , , height] = box;
  const rowHeightMm = height / rows.length;
  const cell = (cellText: string, bold: boolean): CanvasTableCell => ({ text: cellText, fontSizeMm, bold, align: 'left' });
  return {
    ...base(id, name, box),
    kind: 'table',
    // 最后一行、最后一列存 0：排版时占剩下的，和设计器保存的表格一致。
    rowsMm: rows.map((_, index) => (index === rows.length - 1 ? 0 : rowHeightMm)),
    columnsMm: [nameWidthMm, 0],
    borderMm: CANVAS_LIMITS.minSizeMm,
    cells: rows.map(([label, value]) => [cell(label, true), cell(value, false)]),
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/templates/library`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/templates/library
git commit -m "feat(templates): model and building blocks for the template library" -m "Library templates are plain canvas templates with a library: id the template list does not accept, plus sample data for thumbnails and the designer preview. One shared table of field names keeps them in line with the built-in rules and batch column mapping." -m "$TRAILER"
```

---

### Task 3: 服装吊牌、价签、商品条码（9 个），逐个核对

**Files:**
- Create: `src/core/templates/library/garment.ts`、`price.ts`、`product-barcode.ts`
- Create: `src/core/templates/library/template-library.ts`、`template-library.test.ts`
- Modify: `src/core/templates/builtin-canvas.ts`（文件说明）

- [ ] **Step 1: 写测试**

```ts
// src/core/templates/library/template-library.test.ts
import { describe, expect, test } from 'bun:test';
import { findPreset } from '../../../shared/paper-sizes';
import { templateFields } from '../../api/template-fields';
import { GENERIC_TEMPLATE } from '../builtin-templates';
import { layoutCanvas } from '../canvas-layout';
import { sanitizeTemplate } from '../sanitize-template';
import { TEMPLATE_ID_PATTERN, TEMPLATE_LIMITS } from '../template-model';
import { LIBRARY_FIELD_NAMES, LIBRARY_TEMPLATE_ID_PATTERN, type LibraryEntry, librarySampleScan } from './library-model';
import { findLibraryEntry, TEMPLATE_LIBRARY } from './template-library';

/** 设计文档第 4 节定的每类个数（Task 4 补上其余四类）。 */
const EXPECTED_COUNTS: Readonly<Record<string, number>> = { garment: 3, price: 3, barcode: 3 };
/** 热敏标签机常见的两种分辨率：条码模块、文字、格线取整到点之后，两种都要排得下。 */
const DPIS = [203, 300] as const;
const MM_PER_INCH = 25.4;
// 本地时间：{日期} 按本地时区显示（和标签快照一样的理由）。
const PRINTED_AT = new Date(2026, 9, 2, 9, 5);

function countByCategory(entries: readonly LibraryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }
  return counts;
}

describe('template library', () => {
  test('has the planned number of templates in each category', () => {
    expect(countByCategory(TEMPLATE_LIBRARY)).toEqual(EXPECTED_COUNTS);
  });

  test('gives every template a unique library id that the template list does not accept', () => {
    const ids = TEMPLATE_LIBRARY.map((entry) => entry.template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !LIBRARY_TEMPLATE_ID_PATTERN.test(id) || TEMPLATE_ID_PATTERN.test(id))).toEqual([]);
  });

  test('finds a template by its library id only', () => {
    const [first] = TEMPLATE_LIBRARY;
    expect(first === undefined ? null : findLibraryEntry(first.template.id)).toBe(first ?? null);
    expect(findLibraryEntry('library:nope')).toBeNull();
    expect(findLibraryEntry('builtin:canvas-tag')).toBeNull();
  });

  for (const { template, sample } of TEMPLATE_LIBRARY) {
    describe(template.name, () => {
      test('fits the template name limit and sits on a preset paper', () => {
        expect(template.name.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.nameLength);
        expect(findPreset(template.paper)).not.toBeNull();
      });

      // 和用户保存的模板过同一个校验器：模板库里没有校验器会改掉的东西（超出纸张、超限、码制不认识……）。
      test('comes out of the user template sanitizer unchanged', () => {
        expect(sanitizeTemplate(structuredClone(template), template.id, GENERIC_TEMPLATE)).toEqual(template);
      });

      test('has a non-empty sample value for exactly the fields it prints', () => {
        expect(sample.fields.map((field) => field.name).sort()).toEqual([...templateFields(template).names].sort());
        expect(sample.fields.filter((field) => field.value.trim() === '')).toEqual([]);
      });

      test('uses only the shared field names', () => {
        expect(templateFields(template).names.filter((name) => !LIBRARY_FIELD_NAMES.includes(name))).toEqual([]);
      });

      // 示例数据排出来：每个元素都在（没有「这一张没有内容」）、不靠近纸边、文字表格都放得下。
      test.each(DPIS)('lays out the sample with every element and no issue at %i dpi', (dpi) => {
        const layout = layoutCanvas(template, {
          scan: librarySampleScan(sample),
          printedAt: PRINTED_AT,
          dotMm: MM_PER_INCH / dpi,
        });
        expect(layout.issues).toEqual([]);
        expect(layout.overflowCount).toBe(0);
        expect(layout.elements).toHaveLength(template.elements.length);
      });
    });
  }
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/library/template-library.test.ts`
Expected: FAIL，`Cannot find module './template-library'`。

- [ ] **Step 3: 实现三个分类**

```ts
// src/core/templates/library/garment.ts
import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';
import { CANVAS_TAG } from '../builtin-canvas';
import { barcode, hLine, pairTable, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry } from './library-model';

/** 样衣码的示例字段：和内置规则「横杠三段」识别 SAMPLE_LABEL_RAW 的结果一致，再加手机读到的货架号。 */
const GARMENT_FIELDS = { 编码: 'CL5640-TK', 颜色: '图片色', 尺码: 'XL', 货架号: 'A-1-2-3' } as const;

/**
 * 服装吊牌。字段名和内置规则「横杠三段」一致：扫样衣码就能打。
 * 合格证按服装标识的常见内容排：品名、款号、号型、成分、执行标准、等级、安全类别、零售价。
 */
export const GARMENT_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'garment',
    slug: 'garment-sample-tag',
    name: '样衣吊牌',
    description: '编码大字、颜色尺码、Code128、二维码、货架号；扫样衣码直接能打',
    paper: { widthMm: 60, heightMm: 40 },
    // 和内置的「吊牌（自由设计示例）」同一个版式：内置那个可以直接设为当前模板，这里是复制来改的起点。
    elements: CANVAS_TAG.elements,
    sample: { content: SAMPLE_LABEL_RAW, fields: GARMENT_FIELDS },
  }),
  libraryEntry({
    category: 'garment',
    slug: 'garment-certificate',
    name: '服装合格证',
    description: '品名、款号、颜色、号型、成分、执行标准、等级、安全类别、零售价',
    paper: { widthMm: 70, heightMm: 50 },
    elements: [
      text('title', '标题', [2, 2, 66, 6], '合 格 证', { fontSizeMm: 4, bold: true, align: 'center', inverse: true }),
      pairTable(
        'info',
        '参数',
        [2, 9.5, 44, 30],
        12,
        [
          ['品名', '{品名}'],
          ['款号', '{编码}'],
          ['颜色', '{颜色}'],
          ['号型', '{尺码}'],
          ['成分', '{成分}'],
          ['标准', '{执行标准}'],
        ],
        2.6,
      ),
      qr('qr', '二维码', [49, 9.5, 19, 19], '{编码}'),
      text('grade', '等级', [48, 30, 20, 4], '等级 {等级}', { fontSizeMm: 2.6 }),
      text('safety', '安全类别', [48, 35, 20, 4], '{安全类别}', { fontSizeMm: 2.6 }),
      hLine('rule', '分隔线', 2, 41, 66),
      text('price', '零售价', [2, 42, 66, 6], '零售价 ¥{价格}', { fontSizeMm: 4.5, bold: true, align: 'right' }),
    ],
    sample: {
      content: 'CL5640-TK',
      fields: {
        品名: '女式连衣裙',
        编码: 'CL5640-TK',
        颜色: '图片色',
        尺码: '165/88A',
        成分: '面料 100%棉',
        执行标准: 'FZ/T 81004-2022',
        等级: '合格品',
        安全类别: 'GB 18401 B类',
        价格: '399.00',
      },
    },
  }),
  libraryEntry({
    category: 'garment',
    slug: 'garment-simple-tag',
    name: '简洁吊牌',
    description: '编码、颜色尺码、Code128、货架号，50×30 小吊牌',
    paper: { widthMm: 50, heightMm: 30 },
    elements: [
      text('code', '编码', [2, 2, 46, 6], '{编码}', { fontSizeMm: 4.5, bold: true }),
      text('spec', '颜色尺码', [2, 8.5, 46, 4], '{颜色}  {尺码}'),
      barcode('barcode', '编码条码', [2, 13, 46, 12], 'code128', '{编码}', 2.2),
      text('shelf', '货架号', [2, 25.5, 46, 3], '货架号 {货架号}', { fontSizeMm: 2.4 }),
    ],
    sample: { content: SAMPLE_LABEL_RAW, fields: GARMENT_FIELDS },
  }),
];
```

```ts
// src/core/templates/library/price.ts
import { barcode, hLine, pairTable, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 价签。明码标价签按要素排：品名、产地、规格、等级、计价单位、零售价。 */
export const PRICE_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'price',
    slug: 'price-simple',
    name: '简洁价签',
    description: '品名、大号价格、EAN-13',
    paper: { widthMm: 40, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 36, 5], '{品名}', { fontSizeMm: 3.2, bold: true }),
      text('price', '价格', [2, 7.5, 36, 10], '¥{价格}', { fontSizeMm: 8, bold: true, align: 'center' }),
      barcode('barcode', '商品码', [2, 18, 36, 10], 'ean13', '{商品码}', 2),
    ],
    sample: { content: SAMPLE_EAN13, fields: { 品名: '纯棉袜子', 价格: '12.80', 商品码: SAMPLE_EAN13 } },
  }),
  libraryEntry({
    category: 'price',
    slug: 'price-standard',
    name: '明码标价签',
    description: '品名、产地、规格、等级、单位、零售价、EAN-13，按明码标价的要素排',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('name', '品名', [2, 2, 56, 6], '{品名}', { fontSizeMm: 4, bold: true }),
      pairTable(
        'info',
        '参数',
        [2, 8.5, 30, 20],
        10,
        [
          ['产地', '{产地}'],
          ['规格', '{规格}'],
          ['等级', '{等级}'],
          ['单位', '{单位}'],
        ],
        2.6,
      ),
      text('price-label', '零售价标题', [33, 8.5, 25, 4], '零售价', { fontSizeMm: 2.6, align: 'center' }),
      text('price', '零售价', [33, 12.5, 25, 10], '¥{价格}', { fontSizeMm: 6, bold: true, align: 'center' }),
      barcode('barcode', '商品码', [2, 29.5, 36, 8.5], 'ean13', '{商品码}', 2),
      text('code', '货号', [40, 33, 18, 4], '{编码}', { fontSizeMm: 2.4, align: 'right' }),
    ],
    sample: {
      content: SAMPLE_EAN13,
      fields: {
        品名: '红富士苹果',
        产地: '山东烟台',
        规格: '75mm 以上',
        等级: '一级',
        单位: '500g',
        价格: '6.80',
        商品码: SAMPLE_EAN13,
        编码: 'GP0301',
      },
    },
  }),
  libraryEntry({
    category: 'price',
    slug: 'price-promo',
    name: '促销价签',
    description: '「特价」反白横幅、原价和现价、EAN-13',
    paper: { widthMm: 70, heightMm: 50 },
    elements: [
      text('banner', '特价', [2, 2, 66, 8], '特 价', { fontSizeMm: 6, bold: true, align: 'center', inverse: true }),
      text('name', '品名', [2, 11, 66, 6], '{品名}', { fontSizeMm: 4, bold: true, align: 'center' }),
      text('was', '原价', [2, 18.5, 32, 5], '原价 ¥{原价}'),
      text('spec', '规格', [36, 18.5, 32, 5], '{规格}', { align: 'right' }),
      text('price', '现价', [2, 24, 66, 12], '¥{价格}', { fontSizeMm: 10, bold: true, align: 'center' }),
      hLine('rule', '分隔线', 2, 37, 66),
      barcode('barcode', '商品码', [2, 38, 40, 10], 'ean13', '{商品码}', 2),
      text('code', '货号', [44, 41, 24, 5], '货号 {编码}', { fontSizeMm: 2.6, align: 'right' }),
    ],
    sample: {
      content: SAMPLE_EAN13,
      fields: { 品名: '保温杯 500ml', 原价: '89.00', 规格: '500ml', 价格: '59.00', 商品码: SAMPLE_EAN13, 编码: 'BW0500' },
    },
  }),
];
```

```ts
// src/core/templates/library/product-barcode.ts
import { barcode, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 商品条码：零售结算用 EAN-13；货号条码用 Code128（字母、数字、连字符都能编）。 */
export const PRODUCT_BARCODE_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'barcode',
    slug: 'barcode-ean13-small',
    name: 'EAN-13 商品条码',
    description: '品名、EAN-13、规格，40×30',
    paper: { widthMm: 40, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 36, 5], '{品名}', { bold: true, align: 'center' }),
      barcode('barcode', '商品码', [2, 8, 36, 16], 'ean13', '{商品码}'),
      text('spec', '规格', [2, 24.5, 36, 4], '{规格}', { fontSizeMm: 2.6, align: 'center' }),
    ],
    sample: { content: SAMPLE_EAN13, fields: { 品名: '纯棉袜子', 商品码: SAMPLE_EAN13, 规格: '均码 3双装' } },
  }),
  libraryEntry({
    category: 'barcode',
    slug: 'barcode-ean13-price',
    name: 'EAN-13 条码 + 价格',
    description: '品名、价格、EAN-13，50×30',
    paper: { widthMm: 50, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 30, 5], '{品名}', { bold: true }),
      text('price', '价格', [32, 2, 16, 5], '¥{价格}', { fontSizeMm: 3.4, bold: true, align: 'right' }),
      barcode('barcode', '商品码', [2, 8, 46, 20], 'ean13', '{商品码}'),
    ],
    sample: { content: SAMPLE_EAN13, fields: { 品名: '纯棉袜子', 价格: '12.80', 商品码: SAMPLE_EAN13 } },
  }),
  libraryEntry({
    category: 'barcode',
    slug: 'barcode-code128',
    name: 'Code128 货号条码',
    description: '品名、货号、颜色尺码、Code128、价格，60×40',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('name', '品名', [2, 2, 56, 5], '{品名}', { fontSizeMm: 3.2, bold: true }),
      text('code', '货号', [2, 7.5, 56, 4.5], '货号 {编码}'),
      text('spec', '颜色尺码', [2, 12.5, 56, 4.5], '颜色 {颜色}   尺码 {尺码}'),
      barcode('barcode', '货号条码', [2, 18, 56, 16], 'code128', '{编码}', 2.5),
      text('price', '价格', [2, 34.5, 56, 4], '¥{价格}', { bold: true, align: 'right' }),
    ],
    sample: {
      content: 'CL5640-TK',
      fields: { 品名: '女式连衣裙', 编码: 'CL5640-TK', 颜色: '图片色', 尺码: 'XL', 价格: '399.00' },
    },
  }),
];
```

```ts
// src/core/templates/library/template-library.ts
import { GARMENT_TEMPLATES } from './garment';
import type { LibraryEntry } from './library-model';
import { PRICE_TEMPLATES } from './price';
import { PRODUCT_BARCODE_TEMPLATES } from './product-barcode';

/** 模板库：按 LIBRARY_CATEGORIES 的顺序排好（模板库「全部」里就是这个顺序）。 */
export const TEMPLATE_LIBRARY: readonly LibraryEntry[] = [
  ...GARMENT_TEMPLATES,
  ...PRICE_TEMPLATES,
  ...PRODUCT_BARCODE_TEMPLATES,
];

/** 按编号（library:xxx）找模板库里的模板；没有时返回 null。 */
export function findLibraryEntry(id: string): LibraryEntry | null {
  return TEMPLATE_LIBRARY.find((entry) => entry.template.id === id) ?? null;
}
```

`src/core/templates/builtin-canvas.ts` 文件说明的第一行「内置的自由设计模板（只读，复制后修改）。这里只有一个示例，完整的模板库是子项目 2。」改成：

```ts
 * 内置的自由设计模板（只读，复制后修改）：模板列表里只放这一个示例，能直接设为当前模板。
 * 按行业分类的模板在模板库（library/），复制后才能用；模板库的「样衣吊牌」复用这里的元素。
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/templates`
Expected: PASS。写计划时用当前代码把这 9 个模板在 203 和 300dpi 各排过一遍，没有任何问题。如果实现时某个模板报「放不下」「靠近纸边」，改那个元素的框或字号（不改测试），示例数据保持真实可信。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/templates/library src/core/templates/builtin-canvas.ts
git commit -m "feat(templates): garment, price and product barcode templates for the library" -m "Nine library templates on 40x30 to 70x50 paper. Each passes the user template sanitizer unchanged, has sample data for exactly the fields it prints, uses only the shared field names, and lays out without issues at 203 and 300 dpi." -m "$TRAILER"
```

---

### Task 4: 鞋盒标、食品标签、珠宝 / 小商品、仓储（9 个），覆盖和字段名

**Files:**
- Create: `src/core/templates/library/shoe-box.ts`、`food.ts`、`jewelry.ts`、`warehouse.ts`
- Modify: `src/core/templates/library/template-library.ts`
- Modify: `src/core/templates/library/template-library.test.ts`

- [ ] **Step 1: 写测试**

`template-library.test.ts`：

1. import 区加（按 Biome 的顺序放）：

```ts
import { paperKey } from '../../../shared/paper-sizes';
import { SERIAL_FIELD } from '../../batch/batch-model';
import { autoMapping, mappableVariables } from '../../batch/column-mapping';
import { BUILT_IN_RULES, DASH_THREE_RULE_ID, SHELF_NUMBER_FIELD } from '../../scan/builtin-rules';
```

（`findPreset` 和 `paperKey` 合成一行 `import { findPreset, paperKey } from '../../../shared/paper-sizes';`；`./library-model` 那一行加上 `LIBRARY_CATEGORIES`。）

2. `EXPECTED_COUNTS` 换成全部七类，并加纸张表：

```ts
/** 设计文档第 4 节定的每类个数。 */
const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  garment: 3,
  price: 3,
  barcode: 3,
  'shoe-box': 2,
  food: 2,
  jewelry: 2,
  warehouse: 3,
};
/** 设计文档第 4 节要覆盖的纸张。 */
const EXPECTED_PAPERS = ['30x20', '40x30', '50x30', '60x40', '70x50', '100x100', '100x150'];
```

3. `'finds a template by its library id only'` 之后加：

```ts
  test('covers every paper size of the design', () => {
    const papers = new Set(TEMPLATE_LIBRARY.map((entry) => paperKey(entry.template.paper)));
    expect([...papers].sort()).toEqual([...EXPECTED_PAPERS].sort());
  });

  test('lists the templates in the order of the categories', () => {
    const order: readonly string[] = LIBRARY_CATEGORIES.map((category) => category.id);
    const positions = TEMPLATE_LIBRARY.map((entry) => order.indexOf(entry.category));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('uses every shared field name somewhere', () => {
    const used = new Set(TEMPLATE_LIBRARY.flatMap((entry) => templateFields(entry.template).names));
    expect(LIBRARY_FIELD_NAMES.filter((name) => !used.has(name))).toEqual([]);
  });

  // 扫样衣码、手机读货架号、批量打印的序号、「多行键值」的数量：模板库用的是同样的写法。
  test('spells fields like the built-in rules and batch printing do', () => {
    const dashThree = BUILT_IN_RULES.find((rule) => rule.id === DASH_THREE_RULE_ID);
    const ruleFields = dashThree?.kind === 'delimited' ? dashThree.fields : [];
    expect(ruleFields).toEqual(['编码', '颜色', '尺码']);
    const expected = [...ruleFields, SHELF_NUMBER_FIELD, SERIAL_FIELD, '数量'];
    expect(expected.filter((name) => !LIBRARY_FIELD_NAMES.includes(name))).toEqual([]);
  });

  // 批量打印按列名自动对列：Excel 表头写统一的字段名，每个模板的每个变量都能自动对上。
  test('maps every variable automatically from a sheet headed with the shared field names', () => {
    const unmapped = TEMPLATE_LIBRARY.flatMap((entry) =>
      Object.entries(autoMapping(mappableVariables(templateFields(entry.template)), LIBRARY_FIELD_NAMES))
        .filter(([, source]) => source.kind !== 'column')
        .map(([name]) => `${entry.template.name}：${name}`),
    );
    expect(unmapped).toEqual([]);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/library/template-library.test.ts`
Expected: FAIL：分类个数只有三类、纸张少了 30×20 / 100×100 / 100×150、字段表里的名字有没用上的。

- [ ] **Step 3: 实现四个分类**

```ts
// src/core/templates/library/shoe-box.ts
import { barcode, pairTable, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 鞋盒标：尺码反白放大（仓库里隔着货架也认得出），EAN-13 给收银，货号给库存。 */
export const SHOE_BOX_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'shoe-box',
    slug: 'shoe-box-standard',
    name: '鞋盒标',
    description: '品名、货号、颜色、价格，反白大尺码，EAN-13 和货号二维码',
    paper: { widthMm: 70, heightMm: 50 },
    elements: [
      text('name', '品名', [2, 2, 46, 6], '{品名}', { fontSizeMm: 4, bold: true }),
      text('size', '尺码', [50, 2, 18, 14], '{尺码}', { fontSizeMm: 9, bold: true, align: 'center', inverse: true }),
      text('size-label', '尺码标题', [50, 16.5, 18, 4], '尺码', { fontSizeMm: 2.6, align: 'center' }),
      pairTable(
        'info',
        '参数',
        [2, 9, 46, 15],
        10,
        [
          ['货号', '{编码}'],
          ['颜色', '{颜色}'],
          ['价格', '¥{价格}'],
        ],
        2.8,
      ),
      barcode('barcode', '商品码', [2, 26, 46, 20], 'ean13', '{商品码}'),
      qr('qr', '货号二维码', [51, 27, 17, 17], '{编码}'),
    ],
    sample: {
      content: 'XZ2026-BK',
      fields: { 品名: '男式休闲鞋', 尺码: '42', 编码: 'XZ2026-BK', 颜色: '黑色', 价格: '459.00', 商品码: SAMPLE_EAN13 },
    },
  }),
  libraryEntry({
    category: 'shoe-box',
    slug: 'shoe-box-compact',
    name: '鞋盒标（大尺码）',
    description: '反白大尺码在左，品名、货号、颜色，Code128 货号，60×40',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('size', '尺码', [2, 2, 20, 16], '{尺码}', { fontSizeMm: 9, bold: true, align: 'center', inverse: true }),
      text('name', '品名', [24, 2, 34, 5], '{品名}', { fontSizeMm: 3.2, bold: true }),
      text('code', '货号', [24, 7.5, 34, 4.5], '货号 {编码}', { fontSizeMm: 2.8 }),
      text('color', '颜色', [24, 12.5, 34, 4.5], '颜色 {颜色}', { fontSizeMm: 2.8 }),
      barcode('barcode', '货号条码', [2, 19.5, 56, 18], 'code128', '{编码}'),
    ],
    sample: { content: 'XZ2026-BK', fields: { 尺码: '42', 品名: '男式休闲鞋', 编码: 'XZ2026-BK', 颜色: '黑色' } },
  }),
];
```

```ts
// src/core/templates/library/food.ts
import { barcode, pairTable, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 现做现卖、散装食品常用的示例日期：生产日期按批量打印或本机接口每批给，不用 {日期}（打印日不一定是生产日）。 */
const SAMPLE_PRODUCTION_DATE = '2026-10-02';

/**
 * 食品标签。预包装食品标签的要素：品名、配料、净含量、生产日期、保质期、贮存条件、生产者、产地；
 * 净含量在大标签上单独放大（包装正面要求醒目）。
 */
export const FOOD_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'food',
    slug: 'food-simple',
    name: '食品标签',
    description: '品名、净含量、生产日期、保质期、贮存条件、生产商，60×40',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('name', '品名', [2, 2, 56, 6], '{品名}', { fontSizeMm: 4, bold: true }),
      pairTable(
        'info',
        '参数',
        [2, 9, 56, 20],
        14,
        [
          ['净含量', '{净含量}'],
          ['生产日期', '{生产日期}'],
          ['保质期', '{保质期}'],
          ['贮存条件', '{贮存条件}'],
        ],
        2.6,
      ),
      text('maker', '生产商', [2, 30, 56, 4], '生产商：{生产商}', { fontSizeMm: 2.6 }),
    ],
    sample: {
      content: '手工曲奇饼干',
      fields: {
        品名: '手工曲奇饼干',
        净含量: '200g',
        生产日期: SAMPLE_PRODUCTION_DATE,
        保质期: '30 天',
        贮存条件: '常温避光保存',
        生产商: '广州市某某食品有限公司',
      },
    },
  }),
  libraryEntry({
    category: 'food',
    slug: 'food-full',
    name: '预包装食品标签',
    description: '品名、配料、生产日期、保质期、贮存条件、生产商、产地、醒目的净含量、EAN-13，100×100',
    paper: { widthMm: 100, heightMm: 100 },
    elements: [
      text('name', '品名', [2, 2, 96, 8], '{品名}', { fontSizeMm: 6, bold: true }),
      text('ingredients', '配料', [2, 11, 96, 14], '配料：{配料}', { wrap: true }),
      pairTable(
        'info',
        '参数',
        [2, 26, 96, 35],
        20,
        [
          ['生产日期', '{生产日期}'],
          ['保质期', '{保质期}'],
          ['贮存条件', '{贮存条件}'],
          ['生产商', '{生产商}'],
          ['产地', '{产地}'],
        ],
        3,
      ),
      barcode('barcode', '商品码', [2, 64, 60, 30], 'ean13', '{商品码}', 3),
      text('net-label', '净含量标题', [64, 66, 34, 6], '净含量', { align: 'center' }),
      text('net', '净含量', [64, 72, 34, 14], '{净含量}', { fontSizeMm: 7, bold: true, align: 'center' }),
    ],
    sample: {
      content: SAMPLE_EAN13,
      fields: {
        品名: '手工曲奇饼干',
        配料: '小麦粉、黄油、白砂糖、鸡蛋、全脂乳粉、食用盐、食品添加剂（碳酸氢铵）',
        生产日期: SAMPLE_PRODUCTION_DATE,
        保质期: '30 天',
        贮存条件: '常温避光保存',
        生产商: '广州市某某食品有限公司',
        产地: '广东广州',
        净含量: '200g',
        商品码: SAMPLE_EAN13,
      },
    },
  }),
];
```

```ts
// src/core/templates/library/jewelry.ts
import { barcode, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry } from './library-model';

/**
 * 珠宝 / 小商品。30×20 上放不下 Code128（8 位编码连静区要 30mm 以上），编码用二维码；40×30 放得下 Code128。
 * 真正的哑铃形尾巴标（72×10 这类）比纸张高度下限还矮，这一期不做。
 */
export const JEWELRY_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'jewelry',
    slug: 'jewelry-tag',
    name: '珠宝标',
    description: '品名、材质重量、价格、编码二维码，30×20',
    paper: { widthMm: 30, heightMm: 20 },
    elements: [
      text('name', '品名', [2, 2, 15, 4], '{品名}', { fontSizeMm: 2.4, bold: true }),
      text('material', '材质重量', [2, 6.5, 15, 3.5], '{材质} {重量}', { fontSizeMm: 2 }),
      text('price', '价格', [2, 10.5, 15, 5], '¥{价格}', { fontSizeMm: 3.4, bold: true }),
      qr('qr', '编码二维码', [17.5, 2, 10.5, 10.5], '{编码}'),
      text('code', '编码', [2, 15.5, 26, 3], '{编码}', { fontSizeMm: 2 }),
    ],
    sample: {
      content: 'JW260001',
      fields: { 品名: '足金吊坠', 材质: '足金999', 重量: '3.25g', 价格: '2680', 编码: 'JW260001' },
    },
  }),
  libraryEntry({
    category: 'jewelry',
    slug: 'small-goods-tag',
    name: '小商品标',
    description: '品名、价格、规格、Code128 编码，40×30',
    paper: { widthMm: 40, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 36, 5], '{品名}', { bold: true }),
      text('price', '价格', [2, 7, 20, 8], '¥{价格}', { fontSizeMm: 6, bold: true }),
      text('spec', '规格', [22, 7, 16, 8], '{规格}', { fontSizeMm: 2.6, align: 'right' }),
      barcode('barcode', '编码条码', [2, 16, 36, 12], 'code128', '{编码}', 2),
    ],
    sample: { content: 'SP1024', fields: { 品名: '发夹', 价格: '9.90', 规格: '2只装', 编码: 'SP1024' } },
  }),
];
```

```ts
// src/core/templates/library/warehouse.ts
import { barcode, hLine, pairTable, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry } from './library-model';

/**
 * 仓储：货架 / 库位（库位号大字，隔几米能看清，Code128 给手持终端扫）、资产标签（编号二维码，手机也能扫）、
 * 箱标（100×150，箱号用批量打印的 {序号}，二维码里是整箱的完整内容）。
 */
export const WAREHOUSE_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'warehouse',
    slug: 'shelf-location',
    name: '货架 / 库位标',
    description: '大号库位号和 Code128，下面写存放的货品，100×100',
    paper: { widthMm: 100, heightMm: 100 },
    elements: [
      text('title', '标题', [2, 2, 96, 10], '库 位', { fontSizeMm: 6, bold: true, align: 'center', inverse: true }),
      text('location', '库位号', [2, 14, 96, 30], '{货架号}', { fontSizeMm: 15, bold: true, align: 'center' }),
      barcode('barcode', '库位条码', [6, 46, 88, 30], 'code128', '{货架号}', 3),
      hLine('rule', '分隔线', 2, 79, 96),
      text('goods', '存放货品', [2, 81, 96, 15], '存放：{品名}', { fontSizeMm: 5, wrap: true }),
    ],
    sample: { content: 'A-12-03-02', fields: { 货架号: 'A-12-03-02', 品名: '女式连衣裙（夏季款）' } },
  }),
  libraryEntry({
    category: 'warehouse',
    slug: 'asset-tag',
    name: '资产标签',
    description: '「固定资产」反白标题、名称、编号、使用部门、编号二维码，50×30',
    paper: { widthMm: 50, heightMm: 30 },
    elements: [
      text('title', '标题', [2, 2, 46, 5], '固定资产', { fontSizeMm: 3.2, bold: true, align: 'center', inverse: true }),
      pairTable(
        'info',
        '参数',
        [2, 8, 30, 19.5],
        8,
        [
          ['名称', '{资产名称}'],
          ['编号', '{资产编号}'],
          ['部门', '{使用部门}'],
        ],
        2.4,
      ),
      qr('qr', '编号二维码', [33, 8, 15, 15], '{资产编号}'),
    ],
    sample: {
      content: 'ZC-2026-0001',
      fields: { 资产名称: '笔记本电脑', 资产编号: 'ZC-2026-0001', 使用部门: '财务部' },
    },
  }),
  libraryEntry({
    category: 'warehouse',
    slug: 'carton',
    name: '箱标',
    description: '品名、货号、颜色、尺码、数量、箱号（批量打印的序号）、Code128、整箱二维码，100×150',
    paper: { widthMm: 100, heightMm: 150 },
    elements: [
      text('name', '品名', [2, 2, 96, 10], '{品名}', { fontSizeMm: 6, bold: true }),
      pairTable(
        'info',
        '参数',
        [2, 14, 96, 50],
        24,
        [
          ['货号', '{编码}'],
          ['颜色', '{颜色}'],
          ['尺码', '{尺码}'],
          ['数量', '{数量}'],
          ['箱号', '{序号}'],
        ],
        5,
      ),
      barcode('barcode', '货号条码', [2, 68, 96, 30], 'code128', '{编码}', 3.5),
      hLine('rule', '分隔线', 2, 100, 96),
      qr('qr', '整箱二维码', [2, 103, 40, 40], '{完整内容}'),
      text('date', '装箱日期', [46, 104, 52, 8], '装箱日期 {日期}', { fontSizeMm: 3.5 }),
      text('weight', '毛重', [46, 114, 52, 8], '毛重 {重量}', { fontSizeMm: 3.5 }),
      text('note', '备注', [46, 124, 52, 19], '{备注}', { fontSizeMm: 4, wrap: true }),
    ],
    sample: {
      // 批量打印时完整内容就是「字段名：值」逐行拼起来的（batch-labels.ts 的 contentOf）。
      content: '编码：CL5640-TK\n颜色：图片色\n尺码：XL\n数量：50 件\n序号：001',
      fields: {
        品名: '女式连衣裙',
        编码: 'CL5640-TK',
        颜色: '图片色',
        尺码: 'XL',
        数量: '50 件',
        序号: '001',
        重量: '12.5kg',
        备注: '易皱，请勿挤压',
      },
    },
  }),
];
```

`template-library.ts` 换成：

```ts
// src/core/templates/library/template-library.ts
import { FOOD_TEMPLATES } from './food';
import { GARMENT_TEMPLATES } from './garment';
import { JEWELRY_TEMPLATES } from './jewelry';
import type { LibraryEntry } from './library-model';
import { PRICE_TEMPLATES } from './price';
import { PRODUCT_BARCODE_TEMPLATES } from './product-barcode';
import { SHOE_BOX_TEMPLATES } from './shoe-box';
import { WAREHOUSE_TEMPLATES } from './warehouse';

/** 模板库：按 LIBRARY_CATEGORIES 的顺序排好（模板库「全部」里就是这个顺序）。 */
export const TEMPLATE_LIBRARY: readonly LibraryEntry[] = [
  ...GARMENT_TEMPLATES,
  ...PRICE_TEMPLATES,
  ...PRODUCT_BARCODE_TEMPLATES,
  ...SHOE_BOX_TEMPLATES,
  ...FOOD_TEMPLATES,
  ...JEWELRY_TEMPLATES,
  ...WAREHOUSE_TEMPLATES,
];

/** 按编号（library:xxx）找模板库里的模板；没有时返回 null。 */
export function findLibraryEntry(id: string): LibraryEntry | null {
  return TEMPLATE_LIBRARY.find((entry) => entry.template.id === id) ?? null;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/templates src/core/batch`
Expected: PASS。写计划时用当前代码把全部 18 个模板在 203 和 300dpi 各排过、画过一遍，没有任何问题；库位号 15mm 的字在 96mm 宽里不用缩小。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/templates/library
git commit -m "feat(templates): shoe box, food, jewellery and warehouse templates for the library" -m "Completes the 18 library templates over all seven categories and the papers of the design, from 30x20 to 100x150. Tests check that field names match the built-in rules and that a sheet headed with them maps every variable in batch printing." -m "$TRAILER"
```

---

### Task 5: 主进程画出来每个都印得出；缩略图

**Files:**
- Create: `src/main/printing/library-html.test.ts`（快照 `src/main/printing/__snapshots__/library-html.test.ts.snap` 由第一次运行生成）
- Create: `src/shared/template-library.ts`
- Create: `src/main/printing/library-previews.ts`、`library-previews.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/printing/library-html.test.ts
import { describe, expect, test } from 'bun:test';
import { librarySampleScan } from '../../core/templates/library/library-model';
import { TEMPLATE_LIBRARY } from '../../core/templates/library/template-library';
import { renderCanvasHtml } from './canvas-html';

// 本地时间：{日期} 按本地时区显示（和标签快照一样的理由）。
const PRINTED_AT = new Date(2026, 9, 2, 9, 5).getTime();
/** 热敏标签机常见的两种分辨率：条码模块取整到点之后，两种都要放得下。 */
const DPIS = [203, 300] as const;

describe('template library HTML', () => {
  for (const { template, sample } of TEMPLATE_LIBRARY) {
    // 条码要真的编码（EAN-13 位数、校验位）、二维码要放得进框、号码不被截断：这些只有画的时候才知道。
    test(`${template.name}: prints every barcode, QR code and text of the sample`, () => {
      for (const dpi of DPIS) {
        const rendered = renderCanvasHtml({ scan: librarySampleScan(sample), template, printedAt: PRINTED_AT }, dpi);
        expect({
          dpi,
          issues: rendered.issues,
          diagnostics: rendered.diagnostics,
          overflowCells: rendered.overflowCells,
          barcodeOmitted: rendered.barcodeOmitted,
          qrOmitted: rendered.qrOmitted,
        }).toEqual({ dpi, issues: [], diagnostics: [], overflowCells: 0, barcodeOmitted: false, qrOmitted: false });
      }
    });

    test(`${template.name}: HTML stays the same`, () => {
      const rendered = renderCanvasHtml({ scan: librarySampleScan(sample), template, printedAt: PRINTED_AT });
      expect(rendered.html).toMatchSnapshot();
    });
  }
});
```

```ts
// src/main/printing/library-previews.test.ts
import { describe, expect, test } from 'bun:test';
import { TEMPLATE_LIBRARY } from '../../core/templates/library/template-library';
import { renderLibraryPreviews } from './library-previews';

const PRINTED_AT = new Date(2026, 9, 2, 9, 5).getTime();

describe('renderLibraryPreviews', () => {
  test('lists every library template in order with its sample laid out', () => {
    const previews = renderLibraryPreviews(TEMPLATE_LIBRARY, PRINTED_AT);
    expect(previews.map((preview) => preview.id)).toEqual(TEMPLATE_LIBRARY.map((entry) => entry.template.id));
    const [first] = previews;
    expect(first).toMatchObject({
      id: 'library:garment-sample-tag',
      category: 'garment',
      name: '样衣吊牌',
      paper: { widthMm: 60, heightMm: 40 },
      sampleContent: 'CL5640-TK-图片色-XL',
    });
    expect(first?.html).toContain('CL5640-TK');
    expect(first?.html).toContain('shape-rendering="crispEdges"');
  });

  test('hands out copies of the paper, not the library objects', () => {
    const [entry] = TEMPLATE_LIBRARY;
    const [preview] = renderLibraryPreviews(TEMPLATE_LIBRARY, PRINTED_AT);
    expect(preview?.paper).toEqual(entry?.template.paper);
    expect(preview?.paper).not.toBe(entry?.template.paper);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/library-html.test.ts src/main/printing/library-previews.test.ts`
Expected: `library-html.test.ts` 通过并写出新快照（36 个用例：18 个模板 × 能印 + 快照）；`library-previews.test.ts` FAIL，`Cannot find module './library-previews'`。打开新生成的 `.snap` 抽看两三个（条码是 `<svg ... shape-rendering="crispEdges">`、表格格线、反白文字）。

- [ ] **Step 3: 实现**

```ts
// src/shared/template-library.ts
import type { LibraryCategoryId } from '../core/templates/library/library-model';
import type { PaperSize } from './paper-sizes';

/** 模板库里一个模板的缩略图和说明（IPC templates:library 返回）。 */
export interface LibraryPreview {
  /** library:xxx；「用这个模板」时交回主进程。 */
  id: string;
  category: LibraryCategoryId;
  name: string;
  description: string;
  paper: PaperSize;
  /** 示例数据的完整内容：复制后显示在「预览内容」里。 */
  sampleContent: string;
  /** 按示例数据排好的标签 HTML（和打印同一份），在 sandbox 的 iframe 里显示。 */
  html: string;
}
```

```ts
// src/main/printing/library-previews.ts
import { type LibraryEntry, librarySampleScan } from '../../core/templates/library/library-model';
import type { LibraryPreview } from '../../shared/template-library';
import { renderLabelHtml } from './label-html';
import { DEFAULT_PRINTER_DPI } from './qr-code';

/**
 * 模板库的缩略图：每个模板按自己的示例数据排一次，和打印同一份 HTML（renderLabelHtml）。
 * 按 203dpi 画：缩略图不对应某台打印机。18 个模板一共约 20ms、80KB（写计划时实测），
 * 所以每次打开模板库现排、不缓存，{日期} 跟着今天。
 */
export function renderLibraryPreviews(entries: readonly LibraryEntry[], printedAt: number): LibraryPreview[] {
  return entries.map(({ category, description, template, sample }) => ({
    id: template.id,
    category,
    name: template.name,
    description,
    paper: { ...template.paper },
    sampleContent: sample.content,
    html: renderLabelHtml({ scan: librarySampleScan(sample), template, printedAt }, DEFAULT_PRINTER_DPI).html,
  }));
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/printing`
Expected: PASS（原有的快照不变）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/printing/library-html.test.ts src/main/printing/__snapshots__/library-html.test.ts.snap src/shared/template-library.ts src/main/printing/library-previews.ts src/main/printing/library-previews.test.ts
git commit -m "feat(print): render the template library with its sample data" -m "Every library template must encode all its barcodes, fit its QR codes and keep its numbers whole at 203 and 300 dpi; HTML snapshots catch layout drift. Thumbnails are the same HTML as printing, laid out with each template's sample." -m "$TRAILER"
```

---

### Task 6: 从模板库复制；列出模板库的 IPC

**Files:**
- Modify: `src/core/templates/template-catalog.ts`
- Modify: `src/core/templates/templates.test.ts`
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts`

- [ ] **Step 1: 写测试**

`templates.test.ts` 文件头加（按 Biome 的顺序）：

```ts
import { findLibraryEntry } from './library/template-library';
```

`describe('TemplateCatalog', ...)` 里 `'createCanvas saves an empty canvas template on the default paper'` 之后加：

```ts
  test('createFromLibrary saves an editable copy of a library template under its own name', () => {
    const { catalog, repository } = createCatalog();
    const entry = findLibraryEntry('library:price-simple');
    if (entry === null) {
      throw new Error('the library has no price-simple template');
    }
    const created = catalog.createFromLibrary(entry.template.id);
    expect(created).toEqual({ ...entry.template, id: `${CUSTOM_TEMPLATE_PREFIX}t1` });
    expect(created.elements).not.toBe(entry.template.elements);
    expect(repository.saved.get(created.id)).toEqual(created);
  });

  // 模板库的模板只能复制后用：不在列表里，也找不到。
  test('keeps library templates out of the template list', () => {
    const { catalog } = createCatalog();
    expect(catalog.list().some((template) => template.id.startsWith('library:'))).toBe(false);
    expect(catalog.get('library:price-simple')).toBeNull();
  });

  test('createFromLibrary refuses an id that is not in the library', () => {
    const { catalog, repository } = createCatalog();
    expect(() => catalog.createFromLibrary('library:nope')).toThrow(TemplateError);
    expect(repository.saved.size).toBe(0);
  });
```

`ipc-validators.test.ts`：import 列表里按顺序加 `requireLibraryTemplateId`；`'requireTemplateId accepts built-in and custom ids only'` 之后加：

```ts
  test('requireLibraryTemplateId accepts library ids only', () => {
    expect(requireLibraryTemplateId('library:price-simple')).toBe('library:price-simple');
    expect(() => requireLibraryTemplateId('custom:abc')).toThrow(TypeError);
    expect(() => requireLibraryTemplateId('library:../x')).toThrow(TypeError);
    expect(() => requireLibraryTemplateId(42)).toThrow(TypeError);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/templates.test.ts src/main/ipc-validators.test.ts`
Expected: FAIL（`createFromLibrary`、`requireLibraryTemplateId` 不存在）。

- [ ] **Step 3: 实现**

`template-catalog.ts`：import 区加 `import { findLibraryEntry } from './library/template-library';`（`./canvas-model` 之后）；`createCanvas` 方法之后加：

```ts
  /**
   * 从模板库新建：把模板库里的模板复制成自定义模板（名字照抄，不加「副本」：它本来就是起点），接着在设计器里改。
   * 模板库的模板不在 list() 里，只能经这里复制后使用。
   * @throws TemplateError NOT_FOUND：模板库里没有这个编号。
   */
  createFromLibrary(libraryId: string): CanvasTemplate {
    const entry = findLibraryEntry(libraryId);
    if (entry === null) {
      throw new TemplateError('NOT_FOUND', `Library template ${libraryId} does not exist`);
    }
    const template: CanvasTemplate = {
      ...structuredClone(entry.template),
      id: `${CUSTOM_TEMPLATE_PREFIX}${this.createId()}`,
    };
    this.repository.save(template);
    return template;
  }
```

`ipc-validators.ts`：import 区加 `import { LIBRARY_TEMPLATE_ID_PATTERN } from '../core/templates/library/library-model';`（`../core/templates/template-model` 之前）；`requireTemplateId` 之后加：

```ts
/** 模板库里模板的编号（library:xxx）；模板库里有没有这个模板由 TemplateCatalog / findLibraryEntry 核对。 */
export function requireLibraryTemplateId(value: unknown): string {
  if (typeof value !== 'string' || !LIBRARY_TEMPLATE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid library template id');
  }
  return value;
}
```

`src/shared/ipc-contract.ts`：

1. import 区加 `import type { LibraryPreview } from './template-library';`（`./settings` 之后）。
2. `IpcChannel` 里 `CreateCanvasTemplate: 'templates:create-canvas',` 之后加：

```ts
  ListTemplateLibrary: 'templates:library',
  CreateTemplateFromLibrary: 'templates:create-from-library',
```

3. `LabelFlashApi` 里 `createCanvasTemplate(): Promise<CanvasTemplate>;` 之后加：

```ts
  /** 模板库：每个模板的说明和按示例数据排好的 HTML（缩略图）。没有参数。 */
  listTemplateLibrary(): Promise<LibraryPreview[]>;
  /** 把模板库里的一个模板复制成自定义模板，返回它；只收模板库的编号（library:xxx）。 */
  createTemplateFromLibrary(libraryId: string): Promise<CanvasTemplate>;
```

`src/main/ipc.ts`：

1. import 区加 `import { TEMPLATE_LIBRARY } from '../core/templates/library/template-library';`、`import { renderLibraryPreviews } from './printing/library-previews';`，`./ipc-validators` 的列表里按顺序加 `requireLibraryTemplateId`。
2. `handle(IpcChannel.CreateCanvasTemplate, ...)` 之后加：

```ts
  // 模板库的缩略图：主进程按示例数据现排（和打印同一份 HTML），页面只拿到结果。
  handle(IpcChannel.ListTemplateLibrary, () => renderLibraryPreviews(TEMPLATE_LIBRARY, Date.now()));
  // 只收模板库的编号：复制什么由主进程决定，页面交不进模板内容（新通道只给最小能力）。
  handle(IpcChannel.CreateTemplateFromLibrary, (libraryId) =>
    deps.templates.createFromLibrary(requireLibraryTemplateId(libraryId)),
  );
```

`src/preload/index.ts`：`createCanvasTemplate: ...` 那一行之后加：

```ts
  listTemplateLibrary: () => ipcRenderer.invoke(IpcChannel.ListTemplateLibrary),
  createTemplateFromLibrary: (libraryId) => ipcRenderer.invoke(IpcChannel.CreateTemplateFromLibrary, libraryId),
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/templates src/main/ipc-validators.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/templates/template-catalog.ts src/core/templates/templates.test.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(templates): list the template library and copy from it" -m "Library templates stay out of the template list, settings and rules; they are used by copying one into a custom template. The copy channel accepts only a library id, and the listing has no arguments: the page cannot hand in template content." -m "$TRAILER"
```

---

### Task 7: 预览和「打印一张试试」可以用模板库的示例数据

**Files:**
- Modify: `src/core/print-service.ts`、`src/core/print-service.test.ts`
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts`

- [ ] **Step 1: 写测试**

`print-service.test.ts` 的 `describe('PrintService.printSample', ...)` 末尾加：

```ts
  // 模板库复制出的模板：按它的示例数据打，不识别预览内容（这里的预览内容是空白，识别的话会是「无法识别」）。
  test('prints the library sample instead of recognising the preview content', async () => {
    const { service, adapter, store } = createHarness();
    const sample = { content: '6901234567892', fields: [{ name: '品名', value: '纯棉袜子' }] };
    expect((await service.printSample('   ', draft, sample)).status).toBe('printed');
    expect(adapter.printed[0]).toMatchObject({
      raw: '6901234567892',
      templateId: 'custom:draft',
      fields: [{ name: '品名', value: '纯棉袜子' }],
    });
    expect(store.listRecent(10)).toEqual([]);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/print-service.test.ts`
Expected: FAIL（结果是 `invalid`：第三个参数还没有用上）。

- [ ] **Step 3: 实现 core**

`print-service.ts`：import 区加 `import { type LibrarySample, librarySampleScan } from './templates/library/library-model';`（按 Biome 的顺序）。`printSample` 整个方法换成下面两个方法：

```ts
  /**
   * 模板页「打印一张试试」：按预览内容和正在编辑的草稿打一张，看实际出纸的效果。
   * 和预览一样识别、加工（看到的就是打出来的），加工步骤设为拦下的查询失败时和正式打印一样不打；
   * 从模板库复制出的模板还在用示例数据预览时（sample 不为 null），按示例数据打、不识别预览内容。
   * 按草稿的纸张和打印机设置选打印机。不占防重复窗口、不写打印记录：这是在调模板，不是业务打印。
   */
  async printSample(raw: string, template: LabelTemplate, sample: LibrarySample | null = null): Promise<PrintResult> {
    const scanned = sample === null ? await this.sampleScan(raw) : librarySampleScan(sample);
    if ('status' in scanned) {
      return scanned;
    }
    const choice = await this.deps.choosePrinter(template);
    if (choice.printerName === null) {
      return { status: 'no-printer', paperKey: choice.paperKey, missingPrinter: choice.missingPrinter };
    }
    const printerName = choice.printerName;
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(scanned, template), signal),
      );
      // 调试用：只记打到哪、什么纸、什么模板种类，不记标签内容（内容可能是顾客信息）。
      console.info(`[PrintService] sample printed on ${printerName} (${paperKey(template.paper)}, ${template.kind})`);
      // 不写记录，没有记录编号：和测试页一样给一个固定的说明性编号。
      return { status: 'printed', jobId: 'sample', scan: scanned };
    } catch (error) {
      console.error('[PrintService] sample print failed', error);
      return failed(toPrintFailure(error));
    }
  }

  /** 「打印一张试试」按预览内容打时的识别结果；识别不了、查询被拦下时返回不打的原因。 */
  private async sampleScan(raw: string): Promise<ScanResult | PrintResult> {
    const preview = await this.preview(raw);
    if (preview.status !== 'ok') {
      return preview;
    }
    // preview() 固定传 NO_ENRICH_CONTEXT（没有图、没有手动字段）：图中文字识别这一步只会被跳过（skip），
    // 不会拦下（block），所以这里只可能是 HTTP 查询失败，blocked.reason 不会是 TEXT_NOT_FOUND
    // （见 scan/enrich.ts 的 imageText：context.images.length === 0 时直接 skip，不产生 blocked）。
    if (preview.lookupFailure !== null) {
      return { status: 'failed', reason: 'LOOKUP_FAILED', detail: preview.lookupFailure };
    }
    return preview.scan;
  }
```

（`ScanResult` 如果还没在 `print-service.ts` 里 import，加到 `./scan/scan-result` 那一行。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/print-service.test.ts`
Expected: PASS（1b 原有的五个用例行为不变）。

- [ ] **Step 5: IPC**

`src/shared/ipc-contract.ts` 的 `LabelFlashApi`：

```ts
  /**
   * 模板编辑时的实时预览：用未保存的草稿模板渲染。librarySampleId 是模板库的编号时按那个模板的示例数据预览，
   * 不识别 raw（「用这个模板」复制出来、还没改过预览内容）。
   */
  previewTemplate(raw: string, template: LabelTemplate, librarySampleId?: string | null): Promise<LabelPreview>;
```

```ts
  /**
   * 模板页「打印一张试试」：按预览内容打印没保存的草稿；不写打印记录、不占防重复窗口。
   * librarySampleId 和 previewTemplate 的一样：预览用的是示例数据时，打的也是示例数据。
   */
  printSample(raw: string, template: LabelTemplate, librarySampleId?: string | null): Promise<PrintResult>;
```

`src/main/ipc.ts`：

1. import 区：`../core/templates/library/library-model` 加 `type LibrarySample, librarySampleScan`；`../core/templates/library/template-library` 那一行加 `findLibraryEntry`。
2. `const dpiFor = ...` 之后加：

```ts
  /**
   * 预览、试打用模板库的示例数据：页面只交模板库的编号（不能交任意字段），示例数据由主进程按编号取。
   * 没交（null / undefined）就按预览内容识别；编号不对就报错。
   */
  const librarySampleOf = (value: unknown): LibrarySample | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const id = requireLibraryTemplateId(value);
    const entry = findLibraryEntry(id);
    if (entry === null) {
      throw new Error(`Library template not found: ${id}`);
    }
    return entry.sample;
  };
```

3. `handle(IpcChannel.PreviewTemplate, ...)` 换成：

```ts
  handle(IpcChannel.PreviewTemplate, async (raw, template, librarySampleId) => {
    const content = requireRaw(raw);
    const input = requireRecord(template, 'template');
    const librarySample = librarySampleOf(librarySampleId);
    // 面单设计时看的是排版：用示例面单数据预览，不识别、不加工预览内容（加工步骤可能要发 HTTP 查询，结果也用不上）；
    // 从模板库复制出的模板同理，先看它自己的示例数据。模板页指定了要看的模板，不是规则选的；打印机也按这个模板重新决定。
    if (input['kind'] === 'waybill' || librarySample !== null) {
      const draft = sanitizeTemplate(input, DRAFT_TEMPLATE_ID, GENERIC_TEMPLATE);
      const printer = await deps.choosePrinter(draft);
      const sample: PreviewResult = {
        status: 'ok',
        scan: librarySample === null ? waybillSampleScan() : librarySampleScan(librarySample),
        recent: null,
        lookupFailure: null,
        printer,
      };
      return renderPreview(sample, { template: draft, isBound: false }, await dpiFor(sample));
    }
    const result = await deps.service.preview(content);
    const draft = sanitizeTemplate(input, DRAFT_TEMPLATE_ID, printTemplateFor(result).template);
    const printer = await deps.choosePrinter(draft);
    const forDraft: PreviewResult = result.status === 'ok' ? { ...result, printer } : result;
    return renderPreview(forDraft, { template: draft, isBound: false }, await dpiFor(forDraft));
  });
```

4. `handle(IpcChannel.PrintSample, ...)` 换成：

```ts
  // 「打印一张试试」：草稿和预览一样先校验（不可信的输入）；按钮只在设计器里有，只接受自由设计模板（最小权限）。
  handle(IpcChannel.PrintSample, (raw, template, librarySampleId) => {
    const draft = sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, GENERIC_TEMPLATE);
    if (draft.kind !== 'canvas') {
      throw new Error(`label:print-sample only accepts canvas templates, got kind "${draft.kind}"`);
    }
    return deps.service.printSample(requireRaw(raw), draft, librarySampleOf(librarySampleId));
  });
```

`src/preload/index.ts`：`previewTemplate`、`printSample` 两行换成：

```ts
  previewTemplate: (raw, template, librarySampleId = null) =>
    ipcRenderer.invoke(IpcChannel.PreviewTemplate, raw, template, librarySampleId),
```

```ts
  printSample: (raw, template, librarySampleId = null) =>
    ipcRenderer.invoke(IpcChannel.PrintSample, raw, template, librarySampleId),
```

- [ ] **Step 6: `bun run check` 和 E2E 后提交**

Run: `bun run check && bun run test:e2e`
Expected: 全部通过（界面还没传第三个参数，行为不变）。

```bash
git add src/core/print-service.ts src/core/print-service.test.ts src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(print): preview and sample-print a copied library template with its sample data" -m "Library templates such as price tags print fields that scanning does not produce, so a copy previewed with the last scan would look empty in the designer. The page passes only a library id; the main process looks up the sample, so no arbitrary fields cross the IPC boundary." -m "$TRAILER"
```

---

### Task 8: 模板库页面的纯逻辑

**Files:**
- Create: `src/renderer/src/lib/template-library.ts`、`template-library.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/template-library.test.ts
import { describe, expect, test } from 'bun:test';
import type { LibraryPreview } from '../../../shared/template-library';
import { PX_PER_MM } from './canvas-view';
import { ALL, librarySampleIdFor, libraryView, THUMBNAIL_BOX_PX, thumbnailScale } from './template-library';

function item(id: string, category: LibraryPreview['category'], widthMm: number, heightMm: number): LibraryPreview {
  return {
    id: `library:${id}`,
    category,
    name: id,
    description: '',
    paper: { widthMm, heightMm },
    sampleContent: '',
    html: '',
  };
}

const ITEMS = [
  item('tag', 'garment', 60, 40),
  item('small-tag', 'garment', 50, 30),
  item('price', 'price', 40, 30),
  item('carton', 'warehouse', 100, 150),
];

describe('libraryView', () => {
  test('counts every category, including empty ones, after「全部」', () => {
    const { categories } = libraryView(ITEMS, ALL, ALL);
    expect(categories.map((category) => [category.label, category.count])).toEqual([
      ['全部', 4],
      ['服装吊牌', 2],
      ['价签', 1],
      ['商品条码', 0],
      ['鞋盒标', 0],
      ['食品标签', 0],
      ['珠宝 / 小商品', 0],
      ['仓储', 1],
    ]);
  });

  test('offers the papers of the chosen category, smallest first', () => {
    expect(libraryView(ITEMS, ALL, ALL).papers).toEqual([
      { value: ALL, label: '全部纸张' },
      { value: '40x30', label: '40×30mm' },
      { value: '50x30', label: '50×30mm' },
      { value: '60x40', label: '60×40mm' },
      { value: '100x150', label: '100×150mm' },
    ]);
    expect(libraryView(ITEMS, 'garment', ALL).papers.map((paper) => paper.value)).toEqual([ALL, '50x30', '60x40']);
  });

  test('filters by category and paper', () => {
    expect(libraryView(ITEMS, 'garment', '50x30').visible.map((preview) => preview.id)).toEqual([
      'library:small-tag',
    ]);
    expect(libraryView(ITEMS, ALL, '40x30').visible.map((preview) => preview.id)).toEqual(['library:price']);
  });

  // 换了分类，原来选的纸张这一类里没有：回到「全部纸张」，不会出现一个空的网格。
  test('falls back to all papers when the chosen paper is not in the category', () => {
    const view = libraryView(ITEMS, 'warehouse', '50x30');
    expect(view.paper).toBe(ALL);
    expect(view.visible.map((preview) => preview.id)).toEqual(['library:carton']);
  });
});

describe('thumbnailScale', () => {
  test('fits the paper in the thumbnail box', () => {
    const scale = thumbnailScale({ widthMm: 60, heightMm: 40 });
    expect(60 * PX_PER_MM * scale).toBeLessThanOrEqual(THUMBNAIL_BOX_PX.width + 1e-9);
    expect(40 * PX_PER_MM * scale).toBeLessThanOrEqual(THUMBNAIL_BOX_PX.height + 1e-9);
    expect(thumbnailScale({ widthMm: 100, heightMm: 150 })).toBeCloseTo(THUMBNAIL_BOX_PX.height / (150 * PX_PER_MM));
  });

  // 小标签不放大到超过实物大小：一眼看得出 30×20 比 60×40 小。
  test('never enlarges a small label beyond its real size', () => {
    expect(thumbnailScale({ widthMm: 30, heightMm: 20 })).toBe(1);
  });
});

describe('librarySampleIdFor', () => {
  const binding = { templateId: 'custom:t1', libraryId: 'library:price-simple' };

  test('applies the library sample only to the template copied from it', () => {
    expect(librarySampleIdFor(binding, 'custom:t1')).toBe('library:price-simple');
    expect(librarySampleIdFor(binding, 'custom:t2')).toBeNull();
    expect(librarySampleIdFor(binding, null)).toBeNull();
    expect(librarySampleIdFor(null, 'custom:t1')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/template-library.test.ts`
Expected: FAIL，`Cannot find module './template-library'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/template-library.ts
import { LIBRARY_CATEGORIES, type LibraryCategoryId } from '../../../core/templates/library/library-model';
import { formatPaperSize } from '../../../shared/driver-paper';
import { type PaperSize, paperKey } from '../../../shared/paper-sizes';
import type { LibraryPreview } from '../../../shared/template-library';
import { PX_PER_MM } from './canvas-view';

/** 左栏「全部」和纸张下拉框「全部纸张」的值：不会和分类、纸张键重名。 */
export const ALL = 'all';

/** 左栏选的分类。 */
export type CategoryFilter = LibraryCategoryId | typeof ALL;

/** 左栏的一项：分类名和这一类有几个模板。 */
export interface CategoryOption {
  id: CategoryFilter;
  label: string;
  count: number;
}

/** 纸张下拉框的一项。 */
export interface PaperOption {
  value: string;
  label: string;
}

/** 模板库页面上显示什么。 */
export interface LibraryView {
  categories: CategoryOption[];
  /** 这一类里有的纸张（「全部纸张」在最前）。 */
  papers: PaperOption[];
  /** 实际生效的纸张：选的纸张这一类里没有时回到「全部纸张」。 */
  paper: string;
  visible: LibraryPreview[];
}

/** 按分类、纸张筛选模板库。分类的个数不随纸张变：左栏说的是这一类一共有几个。 */
export function libraryView(items: readonly LibraryPreview[], category: CategoryFilter, paper: string): LibraryView {
  const inCategory = category === ALL ? [...items] : items.filter((item) => item.category === category);
  const papers = paperOptions(inCategory);
  const effective = papers.some((option) => option.value === paper) ? paper : ALL;
  return {
    categories: [
      { id: ALL, label: '全部', count: items.length },
      ...LIBRARY_CATEGORIES.map(({ id, label }) => ({
        id,
        label,
        count: items.filter((item) => item.category === id).length,
      })),
    ],
    papers,
    paper: effective,
    visible: effective === ALL ? inCategory : inCategory.filter((item) => paperKey(item.paper) === effective),
  };
}

/** 纸张从小到大（先比宽、再比高）。 */
function paperOptions(items: readonly LibraryPreview[]): PaperOption[] {
  const papers = new Map<string, PaperSize>();
  for (const item of items) {
    papers.set(paperKey(item.paper), item.paper);
  }
  const sorted = [...papers.entries()].sort(([, a], [, b]) => a.widthMm - b.widthMm || a.heightMm - b.heightMm);
  return [
    { value: ALL, label: '全部纸张' },
    ...sorted.map(([value, paper]) => ({ value, label: formatPaperSize(paper) })),
  ];
}

/** 卡片里给缩略图留的框（px）：一行放得下 60×40 的标签，100×150 的箱标按高度缩小。 */
export const THUMBNAIL_BOX_PX = { width: 200, height: 140 } as const;
/** 缩略图最多按实物大小（96dpi 屏幕像素）显示：小标签不会放得比大标签还大，一眼看出纸的大小。 */
const MAX_THUMBNAIL_SCALE = 1;

/** 缩略图的缩放比例：整张纸放进 THUMBNAIL_BOX_PX，不超过实物大小。 */
export function thumbnailScale(paper: PaperSize): number {
  return Math.min(
    THUMBNAIL_BOX_PX.width / (paper.widthMm * PX_PER_MM),
    THUMBNAIL_BOX_PX.height / (paper.heightMm * PX_PER_MM),
    MAX_THUMBNAIL_SCALE,
  );
}

/** 「用这个模板」后预览内容绑着的模板库示例：哪个自定义模板是从哪个模板库模板复制来的。 */
export interface LibrarySampleBinding {
  templateId: string;
  libraryId: string;
}

/**
 * 正在预览的模板用不用模板库的示例数据：只对复制出的那个模板生效（回到列表点别的模板时，按预览内容识别）。
 * 返回模板库编号，或 null。
 */
export function librarySampleIdFor(binding: LibrarySampleBinding | null, templateId: string | null): string | null {
  return binding !== null && binding.templateId === templateId ? binding.libraryId : null;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib/template-library.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/template-library.ts src/renderer/src/lib/template-library.test.ts
git commit -m "feat(renderer): filtering and thumbnail logic for the template library" -m "Pure functions for the category list with counts, the papers present in a category, a paper filter that falls back instead of showing an empty grid, thumbnails never larger than the real label, and which template a library sample belongs to." -m "$TRAILER"
```

---

### Task 9: 预览内容可以绑着模板库示例

**Files:**
- Modify: `src/renderer/src/view-models/use-sample-content.ts`
- Modify: `src/renderer/src/view-models/use-template-preview.ts`
- Modify: `src/renderer/src/components/SampleInput.tsx`
- Modify: `src/renderer/src/view-models/use-config-center.ts`
- Modify: `src/renderer/src/view-models/use-templates.ts`
- Modify: `src/renderer/src/App.tsx`

纯逻辑（示例跟着哪个模板）已在 Task 8 测过；这里是接线，由 Task 12 的 E2E 验证（模板库复制后「预览内容 · 示例数据」、试打打的是示例数据、改了预览内容回到识别）。

- [ ] **Step 1: `use-sample-content.ts`**（整个文件换成）

```ts
import { useCallback, useState } from 'react';
import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';
import type { LibrarySampleBinding } from '../lib/template-library';

/**
 * 模板页的「预览内容」：默认跟着最近一次扫码（还没扫过就用示例），
 * 用户改过之后保持用户的内容，不再被新的扫码覆盖。
 * 「用这个模板」从模板库复制出的模板先按模板库的示例数据预览（library）；预览内容一改（打字、扫码）就回到按内容识别。
 */
export function useSampleContent(latestScanRaw: string | null) {
  const [custom, setCustom] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibrarySampleBinding | null>(null);
  const onChange = useCallback((value: string) => {
    setCustom(value);
    setLibrary(null);
  }, []);
  /** 复制出 binding.templateId 之后：预览内容显示示例数据的完整内容，预览、试打用示例数据。 */
  const showLibrarySample = useCallback((binding: LibrarySampleBinding, content: string) => {
    setCustom(content);
    setLibrary(binding);
  }, []);
  return { value: custom ?? latestScanRaw ?? SAMPLE_LABEL_RAW, library, onChange, showLibrarySample };
}
```

- [ ] **Step 2: `use-template-preview.ts`**

函数签名换成：

```ts
export function useTemplatePreview(
  raw: string,
  template: LabelTemplate | null,
  /** 打印机设置（纸张分配、本机打印机）：变了就重新生成，预览里的「打印机：…」跟着变。 */
  printerSetup = '',
  /** 模板库编号：有时按那个模板的示例数据预览，不识别 raw（见 lib/template-library.ts 的 librarySampleIdFor）。 */
  librarySampleId: string | null = null,
): TemplatePreview | null {
```

`window.api.previewTemplate(raw, template)` 改成 `window.api.previewTemplate(raw, template, librarySampleId)`；effect 的依赖数组改成 `[raw, template, printerSetup, librarySampleId]`。

- [ ] **Step 3: `SampleInput.tsx`**

`SampleContent` 换成：

```ts
/** 「预览内容」的值和修改：默认是最近一次扫码的内容；配置中心里扫码也填进这里。 */
export interface SampleContent {
  value: string;
  onChange: (value: string) => void;
  /** 正在按模板库的示例数据预览（「用这个模板」之后、改预览内容之前）。 */
  isLibrarySample: boolean;
}
```

`<label>` 的文字换成：

```tsx
        {sample.isLibrarySample ? '预览内容 · 示例数据' : '预览内容'}
```

并给 `<label>` 加 `title={sample.isLibrarySample ? '按模板库的示例数据预览；扫码或改这里就换成按内容识别' : undefined}`。

- [ ] **Step 4: `use-config-center.ts`**

1. import 区加 `import { librarySampleIdFor } from '../lib/template-library';`（`../lib/scan-routing` 之后）和 `import type { SampleContent } from '../components/SampleInput';`（文件最前面的相对路径 import 里按顺序放）。
2. 原来的

```ts
  const templatePreview = useTemplatePreview(
    sample.value,
    page === 'templates' ? (templates.draft ?? selectedTemplate) : null,
  );
```

换成：

```ts
  const previewedTemplate = page === 'templates' ? (templates.draft ?? selectedTemplate) : null;
  // 复制出的那个模板（草稿或保存后选中）才用模板库示例；回到列表点别的模板，按预览内容识别。
  const librarySampleId = librarySampleIdFor(sample.library, previewedTemplate?.id ?? null);
  const templatePreview = useTemplatePreview(sample.value, previewedTemplate, '', librarySampleId);
  const sampleView: SampleContent = {
    value: sample.value,
    onChange: sample.onChange,
    isLibrarySample: librarySampleId !== null,
  };
```

3. 返回值里 `templatePage: { sample, preview: templatePreview, fieldNames },` 换成：

```ts
    templatePage: { sample: sampleView, preview: templatePreview, fieldNames },
    /** 正在预览的模板绑着的模板库示例（「打印一张试试」也用它）。 */
    librarySampleId,
```

（扫码处理里的 `sample.onChange(raw)` 不变：扫码改了预览内容，示例数据跟着解除。）

- [ ] **Step 5: `use-templates.ts` 的 `printSample`**

```ts
  const printSample = useCallback(
    async (raw: string, librarySampleId: string | null) => {
```

`window.api.printSample(raw, draft)` 改成 `window.api.printSample(raw, draft, librarySampleId)`。文档注释末尾加一句「复制自模板库、还在用示例数据预览时，打的也是示例数据（librarySampleId）。」

- [ ] **Step 6: `App.tsx`**

1b Task 15 加的 `onPrintSample: () => void templates.printSample(config.templatePage.sample.value),` 改成：

```ts
              onPrintSample: () => void templates.printSample(config.templatePage.sample.value, config.librarySampleId),
```

如果 `bun run check` 报还有别处构造 `SampleContent`（写计划时只有 `use-config-center.ts`），那里补 `isLibrarySample: false`。

- [ ] **Step 7: `bun run check` 和 E2E 后提交**

Run: `bun run check && bun run test:e2e`
Expected: 全部通过（还没有入口能绑上示例数据，行为不变）。

```bash
git add src/renderer/src/view-models/use-sample-content.ts src/renderer/src/view-models/use-template-preview.ts src/renderer/src/components/SampleInput.tsx src/renderer/src/view-models/use-config-center.ts src/renderer/src/view-models/use-templates.ts src/renderer/src/App.tsx
git commit -m "feat(renderer): let the preview content carry a library sample" -m "A template copied from the library is previewed and sample-printed with its sample data until the operator types or scans new preview content. The label says so, and the sample applies only to that copy." -m "$TRAILER"
```

---

### Task 10: 视图模型：打开模板库、读取、复制

**Files:**
- Create: `src/renderer/src/view-models/use-template-library.ts`
- Modify: `src/renderer/src/view-models/use-templates.ts`
- Modify: `src/renderer/src/view-models/use-config-center.ts`

- [ ] **Step 1: `use-template-library.ts`**

```ts
// src/renderer/src/view-models/use-template-library.ts
import { useEffect, useMemo, useState } from 'react';
import type { LibraryPreview } from '../../../shared/template-library';
import { reportError } from '../lib/notices';
import { ALL, type CategoryFilter, libraryView } from '../lib/template-library';

/**
 * 「从模板库新建」：第一次打开时读一次模板库（主进程按示例数据排好的缩略图），之后留着
 * （模板库随程序发布，不会变）；左栏分类、纸张筛选。读失败时提示，下次打开再读。
 */
export function useTemplateLibrary(isOpen: boolean) {
  const [items, setItems] = useState<readonly LibraryPreview[] | null>(null);
  const [category, setCategory] = useState<CategoryFilter>(ALL);
  const [paper, setPaper] = useState<string>(ALL);
  const hasItems = items !== null;

  useEffect(() => {
    if (!isOpen || hasItems) {
      return;
    }
    let isActive = true;
    window.api.listTemplateLibrary().then(
      (next) => {
        if (isActive) {
          setItems(next);
        }
      },
      (error: unknown) => reportError('读取模板库', error),
    );
    return () => {
      isActive = false;
    };
  }, [isOpen, hasItems]);

  const view = useMemo(() => libraryView(items ?? [], category, paper), [items, category, paper]);
  return { items, view, category, selectCategory: setCategory, selectPaper: setPaper };
}

export type TemplateLibraryModel = ReturnType<typeof useTemplateLibrary>;
```

- [ ] **Step 2: `use-templates.ts`**

1. import 区：`../../../core/templates/canvas-model` 加 `import type { CanvasTemplate } from '../../../core/templates/canvas-model';`（按顺序放）。
2. `const [isPrintingSample, ...]` 之前加：

```ts
  /** 「从模板库新建」打开着：模板页显示模板库，不显示列表。 */
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
```

3. `createCanvas` 之后加：

```ts
  /**
   * 「用这个模板」：把模板库里的模板复制成自定义模板，选中它、直接进设计器。返回复制出的模板（失败时提示并返回 null），
   * 调用方据此把预览内容换成这个模板的示例数据。
   */
  const createFromLibrary = useCallback(
    async (libraryId: string): Promise<CanvasTemplate | null> => {
      try {
        const created = await window.api.createTemplateFromLibrary(libraryId);
        await load();
        setSelectedId(created.id);
        setDraft(structuredClone(created));
        setIsLibraryOpen(false);
        return created;
      } catch (error) {
        reportError('从模板库新建', error);
        return null;
      }
    },
    [load],
  );
```

4. 返回对象里：`cancelEdit: () => setDraft(null),` 换成

```ts
    // 关掉编辑器（返回列表、Esc、离开模板页）也关掉模板库：两者都是列表之上的一层。
    cancelEdit: () => {
      setDraft(null);
      setIsLibraryOpen(false);
    },
    isLibraryOpen,
    openLibrary: () => setIsLibraryOpen(true),
    closeLibrary: () => setIsLibraryOpen(false),
    createFromLibrary,
```

- [ ] **Step 3: `use-config-center.ts`**

1. import 区加 `import type { LibraryPreview } from '../../../shared/template-library';` 和 `import { useTemplateLibrary } from './use-template-library';`（按顺序）。
2. `drafts` 里模板那一项换成：

```ts
    // 模板库也算「编辑器」：Esc、点面包屑的「模板」回到列表，离开模板页时一并关掉。
    templates: { isEditing: templates.draft !== null || templates.isLibraryOpen, isDirty: templates.isDirty },
```

3. 面包屑那几行（`const editingName = ...` 到 `breadcrumb` 定义结束）换成：

```ts
  const editingName = page === 'templates' ? templates.draft?.name : page === 'rules' ? rules.draft?.name : undefined;
  const editingLabel =
    editingName !== undefined
      ? `编辑：${editingName}`
      : page === 'templates' && templates.isLibraryOpen
        ? '从模板库新建'
        : null;
  const breadcrumb =
    editingLabel === null ? null : { current: editingLabel, onList: () => appView.requestLeave(() => undefined) };
```

4. Task 9 加的 `const previewedTemplate = ...` 改成模板库打开时不预览（页面上没有大预览，省掉一次排版）：

```ts
  const previewedTemplate =
    page === 'templates' && !templates.isLibraryOpen ? (templates.draft ?? selectedTemplate) : null;
```

5. `const lookupPreview = ...` 之前加：

```ts
  const templateLibrary = useTemplateLibrary(isOpen && page === 'templates' && templates.isLibraryOpen);
  /** 「用这个模板」：复制成功后，预览内容换成这个模板的示例数据（只对复制出的那个模板生效）。 */
  const createFromLibrary = async (item: LibraryPreview) => {
    const created = await templates.createFromLibrary(item.id);
    if (created !== null) {
      sample.showLibrarySample({ templateId: created.id, libraryId: item.id }, item.sampleContent);
    }
  };
```

6. 返回值里 `librarySampleId,` 之后加：

```ts
    templateLibrary: { ...templateLibrary, createFromLibrary },
```

- [ ] **Step 4: `bun run check` 后提交**

Run: `bun run check`
Expected: 通过（界面还没用到，Task 11 接上）。

```bash
git add src/renderer/src/view-models/use-template-library.ts src/renderer/src/view-models/use-templates.ts src/renderer/src/view-models/use-config-center.ts
git commit -m "feat(renderer): view models for opening the library and copying from it" -m "The library loads once when first opened. It counts as an editor of the templates page, so Esc and the breadcrumb return to the list. Copying a template opens it in the designer with its sample data as the preview content." -m "$TRAILER"
```

---

### Task 11: 模板库页面

**Files:**
- Create: `src/renderer/src/components/TemplateLibrary.tsx`
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/tokens.css`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: `TemplateLibrary.tsx`**

```tsx
// src/renderer/src/components/TemplateLibrary.tsx
import type { CSSProperties } from 'react';
import { formatPaperSize } from '../../../shared/driver-paper';
import type { LibraryPreview } from '../../../shared/template-library';
import { type CategoryFilter, type LibraryView, THUMBNAIL_BOX_PX, thumbnailScale } from '../lib/template-library';
import { SelectField } from './form-controls';

export interface TemplateLibraryProps {
  /** 还没读到时为 null。 */
  items: readonly LibraryPreview[] | null;
  view: LibraryView;
  category: CategoryFilter;
  onCategory: (category: CategoryFilter) => void;
  onPaper: (paper: string) => void;
  /** 「用这个模板」：复制成自定义模板，进设计器。 */
  onUse: (item: LibraryPreview) => void;
  /** 「返回列表」。 */
  onClose: () => void;
}

/** 网格和卡片的尺寸跟着缩略图框走：框的大小只在 lib/template-library.ts 写一处。 */
const GRID_STYLE = {
  '--thumb-box-w': `${THUMBNAIL_BOX_PX.width}px`,
  '--thumb-box-h': `${THUMBNAIL_BOX_PX.height}px`,
} as CSSProperties;

/** 模板库：左边分类，右边纸张筛选和缩略图卡片，底部操作条。 */
export function TemplateLibrary({ items, view, category, onCategory, onPaper, onUse, onClose }: TemplateLibraryProps) {
  return (
    <div className="template-library">
      <nav className="template-library__categories" aria-label="模板库分类">
        <ul className="template-list__items">
          {view.categories.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="template-item"
                aria-pressed={option.id === category}
                onClick={() => onCategory(option.id)}
              >
                <span className="template-item__text">
                  <span className="template-item__name">{option.label}</span>
                </span>
                <span className="template-library__count">{option.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="template-library__main" aria-label="模板库">
        <div className="template-library__filters">
          <SelectField label="纸张" value={view.paper} options={view.papers} onChange={onPaper} />
          <p className="form-hint">
            缩略图按示例数据排版，打出来就是这样。点「用这个模板」复制成自定义模板，在设计器里改字、换纸张；字段名和内置识别规则、批量打印的列名一致。
          </p>
        </div>
        {items === null ? (
          <p className="template-list__empty">正在读取模板库…</p>
        ) : (
          <ul className="template-library__grid" aria-label="模板" style={GRID_STYLE}>
            {view.visible.map((item) => (
              <LibraryCard key={item.id} item={item} onUse={onUse} />
            ))}
          </ul>
        )}
      </section>
      <div className="config-actions">
        <p className="config-actions__status">{items === null ? '' : `${view.visible.length} 个模板`}</p>
        <button type="button" className="button button--quiet" onClick={onClose}>
          返回列表
        </button>
      </div>
    </div>
  );
}

interface LibraryCardProps {
  item: LibraryPreview;
  onUse: (item: LibraryPreview) => void;
}

/** 一张卡片：缩略图（真实打印 HTML，sandbox 的 iframe 里显示）、名字、纸张和说明、「用这个模板」。 */
function LibraryCard({ item, onUse }: LibraryCardProps) {
  const paperStyle = {
    '--paper-w': item.paper.widthMm,
    '--paper-h': item.paper.heightMm,
    '--thumb-scale': thumbnailScale(item.paper),
  } as CSSProperties;
  return (
    <li>
      <article className="library-card" aria-label={item.name}>
        <div className="library-card__thumb">
          <div className="library-card__paper" style={paperStyle}>
            <iframe
              className="library-card__frame"
              title={`${item.name}（示例）`}
              sandbox=""
              srcDoc={item.html}
              tabIndex={-1}
            />
          </div>
        </div>
        <h3 className="library-card__name">{item.name}</h3>
        <p className="library-card__meta">{`${formatPaperSize(item.paper)} · ${item.description}`}</p>
        <button
          type="button"
          className="button button--small button--primary library-card__use"
          onClick={() => onUse(item)}
        >
          用这个模板
        </button>
      </article>
    </li>
  );
}
```

- [ ] **Step 2: 模板页**

`TemplatesPage.tsx`：

1. import 区加 `import { TemplateLibrary, type TemplateLibraryProps } from '../../TemplateLibrary';`（`../../TemplateEditor` 之后）。
2. `TemplatesPageProps` 里 `onCreateCanvas: () => void;`（1b Task 15 加的）之后加：

```ts
  /** 「从模板库新建」打开时是模板库；没打开时为 null。 */
  library: TemplateLibraryProps | null;
  onOpenLibrary: () => void;
```

3. `TemplatesPage` 里 `{draft ? <EditView {...props} draft={draft} /> : <ListView {...props} />}` 换成：

```tsx
      {draft ? (
        <EditView {...props} draft={draft} />
      ) : props.library ? (
        <TemplateLibrary {...props.library} />
      ) : (
        <ListView {...props} />
      )}
```

4. `ListView` 的参数里加 `onOpenLibrary`；1b Task 15 加的那个「新建自由设计模板」按钮换成两个按钮一组：

```tsx
        <div className="template-list__create">
          <button type="button" className="button button--small button--quiet" onClick={onCreateCanvas}>
            新建自由设计模板
          </button>
          <button type="button" className="button button--small button--quiet" onClick={onOpenLibrary}>
            从模板库新建
          </button>
        </div>
```

5. `TemplateGroup label="自定义"` 的 `empty` 文字换成「还没有自定义模板：选一套模板点「复制」，或从模板库新建。」

- [ ] **Step 3: App 接线**

`App.tsx` 传给 `ConfigPages` 的 `templates={{ ... }}`，`onCreateCanvas: ...` 之后加：

```tsx
              library: templates.isLibraryOpen
                ? {
                    items: config.templateLibrary.items,
                    view: config.templateLibrary.view,
                    category: config.templateLibrary.category,
                    onCategory: config.templateLibrary.selectCategory,
                    onPaper: config.templateLibrary.selectPaper,
                    onUse: (item) => void config.templateLibrary.createFromLibrary(item),
                    onClose: templates.closeLibrary,
                  }
                : null,
              onOpenLibrary: templates.openLibrary,
```

- [ ] **Step 4: 样式**

`tokens.css` 的 `:root` 里 `--template-list-width: 320px;` 之后加：

```css
  /* 模板库左栏：放得下「珠宝 / 小商品」和个数 */
  --template-library-nav-width: 184px;
```

`@media (max-width: 1199px)` 里加：

```css
    --template-library-nav-width: 160px;
```

`app.css`：1b 加的 `.template-list__create { ... }` 换成：

```css
/* 「新建自由设计模板」「从模板库新建」：跟在自定义模板下面，和列表文字同一条边，放不下时换行 */
.template-list__create {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) var(--space-4) 0;
}
```

`.template-editing { ... }` 之前加：

```css
/* 模板库：左边分类（和模板列表同样的条目），右边筛选和缩略图网格，底部操作条 */
.template-library {
  display: grid;
  flex: 1;
  grid-template-areas:
    "nav main"
    "actions actions";
  grid-template-columns: var(--template-library-nav-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
}

.template-library__categories {
  grid-area: nav;
  padding: var(--space-4) 0;
  overflow-y: auto;
  border-right: 1px solid var(--color-rule);
  background: var(--color-paper);
}

.template-library__count {
  margin-left: auto;
  color: var(--color-ink-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.template-library__main {
  display: flex;
  grid-area: main;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  overflow-y: auto;
}

.template-library__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

/* 卡片最窄 = 缩略图框 + 两边内边距：窗口变窄时少放几列，不出横向滚动条 */
.template-library__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--thumb-box-w) + 2 * var(--space-3)), 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-paper);
}

/* 缩略图框：固定高度，纸居中；各张卡片的名字和按钮因此对齐 */
.library-card__thumb {
  display: grid;
  place-items: center;
  height: var(--thumb-box-h);
  background: var(--color-housing);
}

/* 缩小后的纸：外框是缩小后的大小，里面的 iframe 按实物大小排版再整体缩小（和预览同一种做法） */
.library-card__paper {
  width: calc(var(--paper-w) * 1mm * var(--thumb-scale));
  height: calc(var(--paper-h) * 1mm * var(--thumb-scale));
  overflow: hidden;
  background: var(--color-field);
  box-shadow: 0 0 0 1px var(--color-rule);
}

.library-card__frame {
  display: block;
  width: calc(var(--paper-w) * 1mm);
  height: calc(var(--paper-h) * 1mm);
  border: 0;
  background: var(--color-field);
  pointer-events: none;
  transform: scale(var(--thumb-scale));
  transform-origin: 0 0;
}

.library-card__name {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.library-card__meta {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 12px;
}

/* 按钮贴在卡片底部：说明长短不一时按钮仍在同一条线上 */
.library-card__use {
  align-self: flex-start;
  margin-top: auto;
}
```

- [ ] **Step 5: `bun run check` 和 E2E**

Run: `bun run check && bun run test:e2e`
Expected: 全部通过。

- [ ] **Step 6: 手动看一眼**

Run: `bun run dev`，配置中心 → 模板 → 「从模板库新建」：左边八项（全部 18、服装吊牌 3……仓储 3），右边缩略图（30×20 不放大、100×150 按高度缩小），选「仓储」后纸张下拉只剩 50×30、100×100、100×150；点「价签」里「明码标价签」的「用这个模板」→ 进设计器，画布是示例数据（红富士苹果、¥6.80、EAN-13），工具条「预览内容 · 示例数据」，底部「没有发现问题」；按 Esc 取消选中、再按 Esc 回到列表，新模板「明码标价签」在自定义里、处于选中。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/TemplateLibrary.tsx src/renderer/src/components/config/pages/TemplatesPage.tsx src/renderer/src/App.tsx src/renderer/src/styles/tokens.css src/renderer/src/styles/app.css
git commit -m "feat(renderer): create a template from the template library" -m "The templates page gains 从模板库新建: categories on the left, a paper filter and real thumbnails laid out with sample data, each in a sandboxed iframe. 用这个模板 copies the template and opens it in the designer." -m "$TRAILER"
```

---

### Task 12: E2E

**Files:**
- Modify: `e2e/support/app-helpers.ts`（挪进 `clippedLines`）
- Modify: `e2e/app.e2e.ts`（面单用例改用 `clippedLines`）
- Create: `e2e/template-library.e2e.ts`

- [ ] **Step 1: 共用「量有没有被裁」**

`app-helpers.ts` 末尾加（内容就是 `app.e2e.ts` 里「lays out every built-in waybill ...」用例中 `app.evaluate(...)` 那一段，原样挪过来）：

```ts
/**
 * 用这台电脑的系统字体真实渲染一份标签 HTML，列出被框边缘裁掉的行：测试自己开一个能跑脚本的隐藏窗口来量
 * （打印窗口禁用了脚本），用 Range 量文字本身的宽度（带小数），比这一行的可用宽度宽就是被裁掉了。
 * 每项写出文字、两者的宽度和字号，方便对照字宽表。
 */
export function clippedLines(app: ElectronApplication, html: string): Promise<string[]> {
  return app.evaluate(async ({ BrowserWindow }, source) => {
    const window = new BrowserWindow({ show: false });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(source)}`);
      return (await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('.line, .code__text')].flatMap((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          const text = range.getBoundingClientRect().width;
          const box = line.getBoundingClientRect().width;
          return text > box + 0.5
            ? [line.textContent + ' | 文字 ' + text.toFixed(2) + 'px | 可用 ' + box.toFixed(2) + 'px | 字号 ' + getComputedStyle(line).fontSize]
            : [];
        })`,
      )) as string[];
    } finally {
      window.destroy();
    }
  }, html);
}
```

`app.e2e.ts` 的面单用例里 `const clipped = await app.evaluate(async ({ BrowserWindow }, source) => { ... }, html);` 整段换成 `const clipped = await clippedLines(app, html);`，用例上方关于「测试自己开一个能跑脚本的隐藏窗口来量」的注释删掉（挪到了 `clippedLines` 的文档注释里）；`./support/app-helpers` 的 import 里按顺序加 `clippedLines`。

Run: `bun run test:e2e -- e2e/app.e2e.ts -g "waybill so that no line is clipped"`
Expected: PASS（行为不变）。

- [ ] **Step 2: 写 E2E**

```ts
// e2e/template-library.e2e.ts
import type { Page } from '@playwright/test';
import { TEMPLATE_LIBRARY } from '../src/core/templates/library/template-library';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, clippedLines, fakePrints, openConfig, scan } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/** 装 50×30 的假标签机：「简洁吊牌」的纸。 */
const TAG_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 50, heightMm: 30, dpi: 203 },
  readiness: { ready: true },
};
/** 装 40×30 的假标签机：「简洁价签」的纸。 */
const PRICE_PRINTER: FakePrinterSpec = {
  name: '标签机B',
  paper: { widthMm: 40, heightMm: 30, dpi: 203 },
  readiness: { ready: true },
};

async function assignPrinter(page: Page, printer: FakePrinterSpec): Promise<void> {
  const key = `${printer.paper.widthMm}x${printer.paper.heightMm}`;
  await callApi(page, 'updateSettings', { paperPrinters: { [key]: printer.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function openLibrary(page: Page) {
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '从模板库新建' }).click();
  const library = page.getByRole('region', { name: '模板库' });
  await expect(library.getByRole('article')).toHaveCount(TEMPLATE_LIBRARY.length);
  return library;
}

// 从模板库新建：挑 50×30 的「简洁吊牌」，复制成自定义模板进设计器（示例数据预览），设为当前模板后扫码，打到装 50×30 的标签机。
test('creates a template from the library and prints scans with it', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [TAG_PRINTER] });
  await assignPrinter(page, TAG_PRINTER);
  const library = await openLibrary(page);
  await page.getByRole('navigation', { name: '模板库分类' }).getByRole('button', { name: /^服装吊牌/ }).click();
  await library.getByLabel('纸张').selectOption('50x30');
  await expect(library.getByRole('article')).toHaveCount(1);
  const card = library.getByRole('article', { name: '简洁吊牌', exact: true });
  // 缩略图就是打印的 HTML：示例数据里的编码和 Code128 都在。
  const thumbnail = card.frameLocator('iframe');
  await expect(thumbnail.locator('.line', { hasText: 'CL5640-TK' }).first()).toBeVisible();
  await expect(thumbnail.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(1);
  await card.getByRole('button', { name: '用这个模板' }).click();

  await expect(page.getByRole('region', { name: '设计器' })).toBeVisible();
  await expect(page.getByLabel('预览内容 · 示例数据')).toHaveValue('CL5640-TK-图片色-XL');
  await expect(page.getByRole('region', { name: '打印前检查' })).toContainText('没有发现问题');

  // 只多了一个自定义模板；模板库的模板不进模板列表。
  const templates = await callApi(page, 'listTemplates');
  const copies = templates.filter((template) => template.name === '简洁吊牌');
  expect(copies.map((template) => template.id)).toEqual([expect.stringMatching(/^custom:/)]);
  expect(templates.some((template) => template.id.startsWith('library:'))).toBe(false);

  await page.getByRole('button', { name: '返回列表' }).click();
  await expect(page.locator('.template-item', { hasText: '简洁吊牌' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台' }).click();
  await scan(page, 'CL5640-TK-图片色-XL');
  await expect
    .poll(() => fakePrints(app))
    .toEqual([{ printerName: '标签机A', raw: 'CL5640-TK-图片色-XL', paper: '50x30', templateId: copies[0]?.id }]);
});

// 复制出的价签在设计器里「打印一张试试」：打的是示例数据（完整内容是示例的商品码），不是最近一次扫码。
test('sample-prints a copied library template with its sample data', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [PRICE_PRINTER] });
  await assignPrinter(page, PRICE_PRINTER);
  await scan(page, 'CL5640-TK-图片色-XL');
  const library = await openLibrary(page);
  await library
    .getByRole('article', { name: '简洁价签', exact: true })
    .getByRole('button', { name: '用这个模板' })
    .click();
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');
  await expect(label.locator('.line', { hasText: '¥12.80' })).toBeVisible();
  await page.getByRole('button', { name: '打印一张试试' }).click();
  await expect
    .poll(() => fakePrints(app))
    .toEqual([{ printerName: '标签机B', raw: '6901234567892', paper: '40x30', templateId: 'custom:draft' }]);

  // 改了预览内容：回到按内容识别，标签旁不再写「示例数据」。
  await page.getByLabel('预览内容 · 示例数据').fill('CL5640-TK-图片色-XL');
  await expect(page.getByLabel('预览内容', { exact: true })).toBeVisible();
});

test('returns from the library to the template list with Esc', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const library = await openLibrary(page);
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await expect(page.getByRole('button', { name: '从模板库新建' })).toBeVisible();
});

// 字宽表按估算排版：用这台电脑的系统字体真实渲染每个模板的缩略图，没有哪一行被裁。CI 在 Windows 和 macOS 上都跑。
test('lays out every library template so that no line is clipped with the system fonts', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch();
  const previews = await callApi(page, 'listTemplateLibrary');
  expect(previews.map((preview) => preview.id)).toEqual(TEMPLATE_LIBRARY.map((entry) => entry.template.id));
  for (const preview of previews) {
    expect({ template: preview.name, clipped: await clippedLines(app, preview.html) }).toEqual({
      template: preview.name,
      clipped: [],
    });
  }
});
```

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e -- e2e/template-library.e2e.ts`
Expected: 4 个用例通过。如果「no line is clipped」在某个模板上失败，照报出的字和宽度调那个元素（加宽框或调小字号），再跑 Task 3–5 的单元测试和快照（快照有变化时核对后用 `bun test src/main/printing/library-html.test.ts --update-snapshots` 更新）。再跑一次全部 `bun run test:e2e`。

- [ ] **Step 4: `bun run check` 后提交**

```bash
git add e2e/support/app-helpers.ts e2e/app.e2e.ts e2e/template-library.e2e.ts
git commit -m "test(e2e): create from the template library, sample-print and check real fonts" -m "Covers picking a template by category and paper, the copy opening in the designer with sample data, printing scans with it to the printer holding its paper, sample-printing the sample data, Esc back to the list, and every library template laid out with the system fonts without clipped lines." -m "$TRAILER"
```

---

### Task 13: 视觉验收 V50–V55

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（第 8.2 节的表）

- [ ] **Step 1: 操作**

文件头 import 加 `import { TEMPLATE_LIBRARY } from '../../src/core/templates/library/template-library';`（`../../src/core/scan/enrich-model` 之后）。`openCanvasDesigner`（1b 加的）之后加：

```ts
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
```

- [ ] **Step 2: 六个验收项**（`ITEMS` 里当时最后一项之后加）

```ts
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
```

文件开头的说明注释里的验收范围（当时是「V01–V48」或批量打印改成的写法）改成「设计文档 §8.2 的验收项（V01 起；模板库是 V50–V55，批量打印 V60–V62，PDF V70–V72）」。

- [ ] **Step 3: 设计文档的验收表**（`2026-09-29-config-center-layout-design.md` 第 8.2 节表格的最后一行之后加）

```
| V50 | 模板库 · 全部 | 左栏八项和个数；纸张下拉和说明；卡片缩略图框等高、纸居中，30×20 不放大、100×150 整张可见；名字、说明、按钮对齐；1024 宽时少放几列、无横向滚动；面包屑「从模板库新建」 |
| V51 | 模板库 · 仓储 | 100×100、50×30、100×150 三张缩略图都没被裁；纸张下拉只有这一类的纸 |
| V52 | 模板库 · 按纸张筛选 | 40×30 下三张卡片来自三个分类；底部个数 |
| V53 | 模板库 · 键盘焦点 | 分类按钮、「用这个模板」的焦点框完整可见 |
| V54 | 模板库 · 用这个模板后进设计器 | 画布是示例数据；工具条「预览内容 · 示例数据」；检查没有问题；面包屑「编辑：…」 |
| V55 | 模板库 · 逐个模板 | 18 个模板逐张：文字、号码、表格、二维码都在纸内，和缩略图一致，检查没有问题 |
```

- [ ] **Step 4: 跑视觉验收并逐张核对**

Run: `bun run build && bunx playwright test --config e2e/visual/playwright.config.ts -g "V5[0-5]"`
Expected: 6 项通过（自动检查没有问题）。打开 `test-results/visual-acceptance/` 里 V50–V55 的截图逐条核对 points；Windows 再看 150% 缩放，macOS 看红绿灯区域。再跑一次全部视觉验收，确认别的项没受影响：`bunx playwright test --config e2e/visual/playwright.config.ts`。

- [ ] **Step 5: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items for the template library" -m "V50 to V55 cover the library at three widths, tall papers, the paper filter, keyboard focus, a copy opened in the designer with sample data, and every library template one by one." -m "$TRAILER"
```

---

### Task 14: 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 3.5、4 节）
- Modify: `README.md`、`docs/roadmap.md`
- Modify: `src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`

- [ ] **Step 1: 设计文档**

第 3.5 节末句「内置示例模板放进子项目 2。」改成「内置的吊牌示例（`builtin:canvas-tag`）留在模板列表里，可以直接用；按行业分类的模板在模板库（子项目 2），复制后使用。」

第 4 节「**测试**」那一条之后加：

```
- **实现时定下的细节**（2026-10-02）：
  - 18 个模板（各类个数照上面）；纸张高度下限从 25mm 降到 20mm，加预设「30×20 标签」。哑铃形尾巴标（72×10 这类）比下限还矮，这一期不做，珠宝 / 小商品用 30×20、40×30 的矩形标签。
  - 模板库的模板编号是 `library:xxx`，不进模板列表：不能设为当前模板、不能被规则绑定、本机接口不列出，要用先复制。「样衣吊牌」复用内置吊牌示例的元素。
  - 缩略图：主进程按每个模板的示例数据现排（和打印同一份 HTML，203dpi），一次 IPC 拿全部，界面用 `sandbox=""` 的 iframe 缩小显示，不超过实物大小。
  - 「用这个模板」复制成自定义模板（名字不加「副本」）并进设计器；设计器先按这个模板的示例数据预览，「打印一张试试」打的也是示例数据；打字或扫码改了预览内容就回到按内容识别。页面只交模板库编号，示例数据由主进程取。
  - 字段名统一在 `LIBRARY_FIELD_NAMES`（29 个），测试核对和内置规则、批量打印一致：用这些名字做 Excel 表头，批量打印能把每个模板的变量全部自动对上。内置规则「多行键值」把「编码」当「款号」的别名，这一条没改。
  - 版式：边距 2mm；零售商品条码用 EAN-13，货号、库位、箱号用 Code128，资产编号用二维码；每个模板在 203、300dpi 下排版、编码都没有问题（单元测试 + HTML 快照），系统字体下没有被裁的行（E2E，Windows 和 macOS）。
```

- [ ] **Step 2: README**

「打印模板」下 1b 加的自由设计那一条之后加：

```
  - 模板库：在配置中心「模板」页点「从模板库新建」，按分类（服装吊牌、价签、商品条码、鞋盒标、食品标签、珠宝 / 小商品、仓储）和纸张（30×20 到 100×150）挑一个，缩略图就是打出来的样子；点「用这个模板」复制成自己的模板，在设计器里改。设计器先用示例数据预览，可以马上「打印一张试试」。模板库的字段名（品名、编码、颜色、尺码、价格、商品码、生产日期、保质期、货架号……）和内置识别规则、批量打印的列名一致：Excel 表头用同样的名字，批量打印自动对上。
```

- [ ] **Step 3: 路线图**

`docs/roadmap.md` 状态表里标签设计器那一行之后加：

```
| 模板库：18 个按行业分类的自由设计模板（服装吊牌、价签、商品条码、鞋盒标、食品标签、珠宝 / 小商品、仓储），纸张 30×20 到 100×150；缩略图即真实排版，按纸张筛选，复制后进设计器、先用示例数据预览和试打；字段名和内置规则、批量打印一致 | 必须 | 开发完成（`feature/template-library`），随 2.0.0 发布；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 4 节。Windows 上 E2E 和视觉验收 V50–V55 通过；热敏标签机逐个模板出纸、扫码枪扫 EAN-13 / Code128 / 二维码待人工验收 |
```

- [ ] **Step 4: CLAUDE.md**

`src/core/CLAUDE.md` 模块表 `templates/` 一行末尾（`builtin-canvas.ts` 之后）加：「；模板库在 `templates/library/`：`library-model.ts`（分类、`library:` 编号、示例数据、统一字段表 `LIBRARY_FIELD_NAMES`）、`library-elements.ts`（写模板的小工具）、每类一个文件、`template-library.ts`（`TEMPLATE_LIBRARY`、`findLibraryEntry`）。模板库的模板不进 `TemplateCatalog.list()`，经 `createFromLibrary` 复制后使用；加模板时 `template-library.test.ts` 逐个核对校验器不变、示例数据、字段名、两种分辨率下排版」。

`src/main/CLAUDE.md`「打印（`printing/`）」末尾加一条：

```
- **模板库** `library-previews.ts`：按每个模板的示例数据排出缩略图 HTML（`renderLabelHtml`，203dpi），`templates:library` 每次现排、不缓存；`library-html.test.ts` 核对每个模板在 203、300dpi 都印得出并做 HTML 快照。预览、试打带模板库编号时，`ipc.ts` 的 `librarySampleOf` 按编号取示例数据（页面不能交字段）。
```

`src/renderer/CLAUDE.md`「## 自由设计的设计器」一节末尾加：

```
- **模板库**：模板页的第三个视图（列表 / 编辑 / 模板库），算作模板页的「编辑器」（Esc、面包屑回到列表）。筛选和缩略图比例在 `lib/template-library.ts`，读取在 `view-models/use-template-library.ts`，组件 `components/TemplateLibrary.tsx`；缩略图是 `sandbox=""` 的 iframe，不要换成能跑脚本的方式。「用这个模板」之后预览内容绑着模板库示例（`use-sample-content.ts` 的 `library`，只对复制出的那个模板生效，`librarySampleIdFor`），改预览内容就解除。
```

- [ ] **Step 5: `bun run check` 后提交，推送，开 PR**

```bash
git add docs/superpowers/specs/2026-10-01-feature-parity-design.md README.md docs/roadmap.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs: describe the template library" -m "Records the decisions made while building it (18 templates, 30x20 paper, library ids kept out of the template list, thumbnails, sample data in the designer, shared field names) and where the code lives in each layer." -m "$TRAILER"
git push -u origin feature/template-library
gh pr create --base master --title "feat: template library (sub-project 2)" --body "<中文说明：做了什么、为什么、验证（单元测试、HTML 快照、E2E、视觉验收 V50–V55）；只在 Windows 上验证过的写明；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并（macOS 的「系统字体下没有被裁的行」用苹方再核对一遍）。合并前用热敏标签机逐个纸张至少打一张（30×20、40×30、50×30、60×40、70×50、100×100、100×150），扫码枪扫 EAN-13、Code128 和二维码，结果写进 `docs/windows-acceptance.md`。

---

## Self-Review 记录

- **设计覆盖（第 4 节）**：约 20 个模板分 7 类（服装吊牌 3、价签 3、商品条码 3、鞋盒标 2、食品标签 2、珠宝 / 小商品 2、仓储 3）→ Task 3、4（个数由测试 `EXPECTED_COUNTS` 把关，合计 18，见关键取舍 1）；纸张 30×20 … 100×150 → Task 1（30×20 能存）、Task 4（覆盖测试）；界面「从模板库新建」、左边分类、缩略图是真实排版、按纸张筛选、「用这个模板」复制并进设计器 → Task 5、6、8、10、11；字段名约定和内置规则、批量打印列名对应 → Task 2（字段表）、Task 4（规则和自动对列的测试）；测试：每个模板的快照 → Task 5，视觉验收逐个截图 → Task 13（V55 逐个模板），E2E 抽一个新建并打印 → Task 12。第 3.5 节「内置示例模板放进子项目 2」→ 关键取舍 3、Task 3（复用元素）、Task 14（改设计文档）。第 10 节（单元测试、HTML 快照、E2E 两个平台、视觉验收）→ Task 3–5、12、13。第 11 节：IPC 最小能力（两个新通道一个没参数、一个只收编号；示例数据只交编号）→ Task 6、7；快速失败（`libraryEntry` 的编号、`createFromLibrary`、`librarySampleOf` 不认识就抛错）→ Task 2、6、7；小步提交 → 14 个任务各自能过 `bun run check`。
- **没有占位**：每个代码步骤给了完整代码。18 个模板的坐标、字号和示例数据在写计划时用当前代码（`layoutCanvas`、`renderCanvasHtml`、`sanitizeCanvasElements`、`templateFields`）在 203 / 300dpi 实际排过、画过一遍，全部没有问题；Task 3、4、12 写明了如果实现时某个模板报问题怎么改（改元素，不改测试）。依赖 1b、批量打印的地方在「约定 · 分支」里列出了具体符号。
- **类型一致**：`LibraryEntry { category, description, template, sample }`、`LibrarySample { content, fields }`、`LIBRARY_TEMPLATE_ID_PATTERN`、`librarySampleScan`（Task 2）在 Task 3–7 用；`LibraryPreview { id, category, name, description, paper, sampleContent, html }`（Task 5，`src/shared/template-library.ts`）在 Task 6 的契约、Task 8 的 lib、Task 10 的视图模型、Task 11 的组件、Task 12 的 E2E 用；`LibraryView`、`CategoryFilter`、`ALL`、`THUMBNAIL_BOX_PX`、`thumbnailScale`、`LibrarySampleBinding`、`librarySampleIdFor`（Task 8）在 Task 9–11 用；`previewTemplate` / `printSample` 的第三个参数在契约、`ipc.ts`、preload、`use-template-preview.ts`、`use-templates.ts` 里一致（`string | null`，缺省 null）；`TemplateLibraryProps`（Task 11）和 App 传的对象字段一一对应（`items`、`view`、`category`、`onCategory`、`onPaper`、`onUse`、`onClose`）；`useTemplateLibrary` 返回的 `selectCategory` / `selectPaper` 在 App 接到 `onCategory` / `onPaper`。
- **每个提交都能过 `bun run check`**：Task 7 先改主进程（第三个参数可选，界面不传时行为不变），Task 9 接上界面但还没有入口绑定示例，Task 10 的视图模型先建好，Task 11 一次接进模板页。
- **迁移**：不需要（模板库是静态数据，复制出的模板存进现有的模板表）。
