# 标签设计器 1b：编辑器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自由设计模板（`kind: 'canvas'`）的三栏设计器，取代 1a 的过渡表单 `CanvasBasics`：左边 7 种元素，中间是真实打印 HTML 加一层透明覆盖层（选框、控制点、吸附参考线、框选），右边属性和图层，上面工具条，下面打印前检查；能新建空白的自由设计模板，能「打印一张试试」。

**Architecture:** 照 `src/renderer/CLAUDE.md` 的 MVVM 分三层。`lib/` 里全是纯函数并先写测试：`canvas-history.ts`（撤销重做）、`canvas-edit.ts`（移动、缩放、旋转、增删、对齐、等距、叠放、复制粘贴、框选）、`canvas-view.ts`（缩放档位、像素换毫米、按键 → 命令）、`canvas-snap.ts`（吸附和参考线）、`canvas-table.ts`（表格行列）、`gray-image.ts`（RGBA → 灰度、像素预算、base64）。`view-models/` 持有状态：`use-canvas-designer.ts`（选中、历史、剪贴板、缩放、开关）、`use-canvas-gesture.ts`（拖动、缩放、框选）、`use-image-import.ts`（在 sandbox 的页面里解码图片）。`components/canvas-editor/` 只渲染。画布的标签就是模板页现有的预览（`previewTemplate`，已有 150ms 防抖），不新加预览通道。新增两个 IPC：`templates:create-canvas`（没有参数，新建空白模板）和 `label:print-sample`（按预览内容打印草稿，不写记录）。

**Tech Stack:** TypeScript、React 19、Bun test、Electron（主进程 IPC）、Playwright E2E 和视觉验收。不加新依赖。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3.3、3.4 节和第 11 节（用户 2026-10-01：「按面单和标签最佳实践设计，但不要太复杂」）。前一步：`docs/superpowers/plans/2026-10-01-canvas-designer-1a-model-render.md`。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件。`bun run lint`（`biome check`）同时核对格式（行宽 120）和 import 顺序：报差异时照它给出的 diff 用 Edit 调整（import 顺序：离得远的路径在前；同一来源里的名字逐字比较，同一个字母大写在前，不同字母按字母序）。计划里的代码已按这些规则写，个别换行和 Biome 的结果不同时以 Biome 为准。
- **删除文件前先征得用户同意**（用户的全局规则）。本计划只删一个文件：Task 15 的 `CanvasBasics.tsx`。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`、带单位后缀并写一句取值依据；不用 `!` 非空断言（Biome 禁止）。注释中文，写为什么；界面文字中文；标识符、测试名、提交信息英文。
- **分层**：`lib/` 不碰 React、DOM、`window.api`；组件不调 `window.api`；样式只用 `styles/tokens.css` 的变量。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，末尾带两行：

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK
```

- 分支：`feature/canvas-designer`（1a 之后继续）。

## 关键取舍（写进设计文档第 3.3 节，Task 18）

1. **画布就是预览**：用模板页现有的 `useTemplatePreview`（草稿变了 150ms 后经 `previewTemplate` 重新排版），不新加预览通道；覆盖层只画框，拖动时只动覆盖层，松手才改草稿。
2. **扫码不受影响**：画布是一个可聚焦的 `div`（`role="application"`），不是输入框。它只处理方向键、Delete / Backspace、Esc 和 Ctrl / ⌘ 组合键（`lib/canvas-view.ts` 的 `designerCommand`，测试覆盖「扫码枪打的字符一律不拦」）。配置中心的 `useConfigScan` 在捕获阶段把可打印字符连同焦点送进隐藏接收框，模板页再填进「预览内容」——焦点在画布上时也一样。不给画布加 `data-keep-focus`：那个属性只对工作台的 `useScanFocus` 有意义，配置中心里它是停用的。Esc 只在有选中时被画布用掉（取消选中）；没有选中时照常冒泡，配置中心返回列表。
3. **双击文字**：选中它并把焦点放进属性栏的「内容」框（整段选中）。不在画布上就地编辑：画布是打印 HTML，叠一个编辑框会挡住所见即所打，也多一处输入框要照顾扫码。
4. **新建入口**：新加 `templates:create-canvas`（没有参数，主进程建一个空白的 60×40 自由设计模板），比「复制示例再删光元素」直接；纸张进设计器后在右栏「模板」里改。没有参数就不用新校验函数，符合「新通道只暴露最小能力」。
5. **打印一张试试**：新加 `label:print-sample`（预览内容 + 草稿）→ `PrintService.printSample`：和预览一样识别、加工，按草稿的纸张选打印机；不写打印记录、不占防重复窗口（在调模板，不是业务打印）；加工步骤设为拦下的查询失败时和正式打印一样不打。按钮只在设计器里有（标签、面单的编辑器不变）。
6. **锁定**：锁定的元素不能拖动、缩放、删除（防误碰），可以选中，属性栏照样能改。
7. **对齐**：选一个时对齐到安全区（纸边往里 1.5mm），选几个时对齐到它们的外框；等距要选三个以上。
8. **剪贴板**：设计器自己的，在内存里（页面的剪贴板权限一律被拒绝，也不需要跨程序粘贴元素）；粘贴往右下错开 2mm。
9. **撤销**：最多 100 步；同一个输入框连续输入、连续按方向键各算一步。
10. **网格只是显示**：吸附的目标是纸边、安全区、纸的中线、其他元素的边和中线（设计文档原文），不吸网格。
11. **图片**：在页面里用 `createImageBitmap` + `OffscreenCanvas` 解码并缩到像素预算（单张 ≤ 1MB 灰度像素、边长 ≤ 4000），透明处当白纸；文件超过 20MB 不读；整个模板的图片超过 4MB 不插入并说明上限。主进程从不解码图片文件。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/renderer/src/lib/canvas-history.ts` (+ `.test.ts`) | 新建 | 撤销 / 重做历史（纯函数，100 步，按键合并） |
| `src/renderer/src/lib/canvas-edit.ts` (+ `.test.ts`) | 新建 | 框的取整和收边、移动、缩放、旋转、增删、改名编号、对齐、等距、叠放、复制粘贴、框选 |
| `src/renderer/src/lib/canvas-view.ts` (+ `.test.ts`) | 新建 | 每毫米像素、缩放档位、按键 → 设计器命令、拖放数据格式 |
| `src/renderer/src/lib/canvas-snap.ts` (+ `.test.ts`) | 新建 | 吸附目标、移动和缩放时的吸附、参考线 |
| `src/renderer/src/lib/canvas-table.ts` (+ `.test.ts`) | 新建 | 表格加减行列、行高列宽、改一格 |
| `src/renderer/src/lib/gray-image.ts` (+ `.test.ts`) | 新建 | RGBA → 灰度、像素预算、base64、模板图片总量 |
| `src/renderer/src/lib/status-text.ts` (+ `.test.ts`) | 修改 | 「打印一张试试」结果的提示文字 |
| `src/renderer/src/view-models/use-fit-scale.ts` | 修改 | 每毫米像素改用 `canvas-view` 的常量 |
| `src/renderer/src/view-models/use-canvas-designer.ts` | 新建 | 选中、历史、剪贴板、缩放、网格和吸附开关、命令 |
| `src/renderer/src/view-models/use-canvas-gesture.ts` | 新建 | 指针拖动、缩放、框选；Ctrl+滚轮缩放 |
| `src/renderer/src/view-models/use-image-import.ts` | 新建 | 在页面里解码图片文件 → 灰度像素 |
| `src/renderer/src/view-models/use-templates.ts` | 修改 | `createCanvas`、`printSample` |
| `src/renderer/src/components/SampleInput.tsx` | 新建 | 「预览内容」输入框（从 TemplatesPage 挪出来，设计器工具条也用） |
| `src/renderer/src/components/canvas-editor/options.ts` | 新建 | 属性栏的分段按钮选项和数字框步长 |
| `src/renderer/src/components/canvas-editor/InsertField.tsx` | 新建 | 「插入字段」下拉框 |
| `src/renderer/src/components/canvas-editor/CanvasStage.tsx` | 新建 | 软尺、标签 iframe、覆盖层（网格、安全区、选框、控制点、参考线、框选） |
| `src/renderer/src/components/canvas-editor/DesignerToolbar.tsx` | 新建 | 工具条 |
| `src/renderer/src/components/canvas-editor/ElementPalette.tsx` | 新建 | 左边的元素栏（点击添加、拖放） |
| `src/renderer/src/components/canvas-editor/LayerList.tsx` | 新建 | 图层列表 |
| `src/renderer/src/components/canvas-editor/ElementProperties.tsx` | 新建 | 选中元素的属性（通用 + 文字、条码、二维码、图片、线、矩形） |
| `src/renderer/src/components/canvas-editor/TableProperties.tsx` | 新建 | 表格的属性 |
| `src/renderer/src/components/canvas-editor/CanvasDesigner.tsx` | 新建 | 组装三栏、工具条、检查列表 |
| `src/renderer/src/components/config/pages/TemplatesPage.tsx` | 修改 | 自由设计模板进设计器；「新建自由设计模板」；「打印一张试试」 |
| `src/renderer/src/components/CanvasBasics.tsx` | 删除（先征得同意） | 1a 的过渡表单 |
| `src/renderer/src/App.tsx` | 修改 | 接上 `onCreateCanvas`、`onPrintSample` |
| `src/renderer/src/styles/tokens.css`、`app.css` | 修改 | 设计器的尺寸、颜色变量和样式 |
| `src/core/templates/canvas-model.ts` (+ `.test.ts`) | 修改 | 导出 `CANVAS_ELEMENT_LABELS`（元素名称只写一处） |
| `src/core/templates/template-catalog.ts`、`templates.test.ts` | 修改 | `createCanvas()` |
| `src/core/print-service.ts` (+ `.test.ts`) | 修改 | `printSample()` |
| `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts` | 修改 | 两个新通道 |
| `e2e/app.e2e.ts`、`e2e/local-api.e2e.ts` | 修改 | 设计器主流程、扫码、试打、经本机接口打印 |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V45–V48 |
| `docs/superpowers/specs/2026-10-01-feature-parity-design.md`、`src/renderer/CLAUDE.md`、`README.md`、`docs/roadmap.md` | 修改 | 文档 |

---

### Task 1: 撤销 / 重做历史

**Files:**
- Create: `src/renderer/src/lib/canvas-history.ts`
- Create: `src/renderer/src/lib/canvas-history.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/canvas-history.test.ts
import { describe, expect, test } from 'bun:test';
import { emptyHistory, HISTORY_LIMIT, type History, record, redo, type Stepped, undo } from './canvas-history';

/** 撤销 / 重做应当有结果：没有时让用例失败，而不是带着 null 往下走。 */
function must<T>(stepped: Stepped<T> | null): Stepped<T> {
  if (stepped === null) {
    throw new Error('expected a step');
  }
  return stepped;
}

describe('canvas history', () => {
  test('undoes the recorded steps in order and stops at the start', () => {
    let history: History<string> = emptyHistory();
    history = record(history, 'a');
    history = record(history, 'ab');
    const first = must(undo(history, 'abc'));
    expect(first.present).toBe('ab');
    const second = must(undo(first.history, first.present));
    expect(second.present).toBe('a');
    expect(undo(second.history, second.present)).toBeNull();
  });

  test('redoes what was undone, and a new change drops the redo steps', () => {
    const history = record(record(emptyHistory<string>(), 'a'), 'ab');
    const back = must(undo(history, 'abc'));
    expect(must(redo(back.history, back.present)).present).toBe('abc');
    const changed = record(back.history, back.present);
    expect(redo(changed, 'abX')).toBeNull();
  });

  test('merges consecutive changes with the same key into one step', () => {
    let history = record(emptyHistory<string>(), '', 'e1:text');
    history = record(history, 'a', 'e1:text');
    history = record(history, 'ab', 'e1:text');
    expect(history.past).toEqual(['']);
    expect(must(undo(history, 'abc')).present).toBe('');
    expect(record(history, 'abc', 'e1:fontSizeMm').past).toEqual(['', 'abc']);
  });

  test('starts a new step after an undo even with the same key', () => {
    const history = record(record(emptyHistory<string>(), '', 'e1:text'), 'a', 'e1:text');
    const back = must(undo(history, 'ab'));
    expect(back.history.past).toEqual([]);
    expect(record(back.history, back.present, 'e1:text').past).toEqual(['']);
  });

  test('keeps at most the history limit', () => {
    let history = emptyHistory<number>();
    for (let step = 0; step < HISTORY_LIMIT + 50; step += 1) {
      history = record(history, step);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(50);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/canvas-history.test.ts`
Expected: FAIL，`Cannot find module './canvas-history'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/canvas-history.ts
/**
 * 设计器的撤销 / 重做。只记「改之前的样子」：现在的样子由调用方持有（模板页的草稿），
 * 这里只存过去和将来，草稿仍然只有一份，不会和历史里的副本走散。纯函数，不碰 React。
 */

/** 最多记 100 步：一张标签改 100 步已经很多；每步存一份整个模板，有图片时一份可达几 MB，再多占内存。 */
export const HISTORY_LIMIT = 100;

export interface History<T> {
  /** 旧的在前；最后一项是上一步之前的样子。 */
  past: readonly T[];
  /** 撤销掉的步骤，最近撤销的在前。 */
  future: readonly T[];
  /** 上一步的合并键：连续在同一个输入框里打字只算一步。撤销、重做之后清空。 */
  mergeKey: string | null;
}

/** 撤销或重做一步的结果：新的历史和要显示的样子。 */
export interface Stepped<T> {
  history: History<T>;
  present: T;
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], mergeKey: null };
}

/**
 * 记下一步：before 是改之前的样子。mergeKey 和上一步相同时不新增一步（撤销时一次回到开始打字之前）。
 * 做了新的修改，重做的记录就作废。
 */
export function record<T>(history: History<T>, before: T, mergeKey: string | null = null): History<T> {
  if (mergeKey !== null && mergeKey === history.mergeKey) {
    return { ...history, future: [] };
  }
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [], mergeKey };
}

/** 撤销：回到上一步之前的样子；没有可撤销的返回 null。 */
export function undo<T>(history: History<T>, present: T): Stepped<T> | null {
  if (history.past.length === 0) {
    return null;
  }
  const previous = history.past[history.past.length - 1] as T;
  return {
    history: { past: history.past.slice(0, -1), future: [present, ...history.future], mergeKey: null },
    present: previous,
  };
}

/** 重做：回到最近撤销掉的那一步；没有可重做的返回 null。 */
export function redo<T>(history: History<T>, present: T): Stepped<T> | null {
  if (history.future.length === 0) {
    return null;
  }
  const [next, ...rest] = history.future;
  return {
    history: { past: [...history.past, present].slice(-HISTORY_LIMIT), future: rest, mergeKey: null },
    present: next as T,
  };
}
```

`as T`：长度已经检查过，元素一定存在（`noUncheckedIndexedAccess` 下下标的类型带 `undefined`，这里收窄）。

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/renderer/src/lib/canvas-history.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: `bun run check` 后提交**

Run: `bun run check`
Expected: Biome 零问题、类型检查零错误、单元测试全过。

```bash
git add src/renderer/src/lib/canvas-history.ts src/renderer/src/lib/canvas-history.test.ts
git commit -m "feat(renderer): undo history for the canvas designer" -m "The designer records the template before each change and merges consecutive edits of the same field, so typing a word is one undo step. The draft itself stays the single copy of the template." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 2: 移动、缩放、旋转、添加和删除元素

**Files:**
- Create: `src/renderer/src/lib/canvas-edit.ts`
- Create: `src/renderer/src/lib/canvas-edit.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/canvas-edit.test.ts
import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS, type CanvasElement, type CanvasTemplate, newCanvasElement } from '../../../core/templates/canvas-model';
import {
  addElement,
  clampAll,
  clampBox,
  deleteElements,
  moveBy,
  newElementId,
  replaceElement,
  resizeBox,
  rotateElement,
  roundMm,
  roundTo,
  setBox,
  toggleId,
  uniqueName,
} from './canvas-edit';

const PAPER = { widthMm: 60, heightMm: 40 };

/** 一个矩形元素（其余属性取默认值）。 */
function rect(id: string, x: number, y: number, width: number, height: number, locked = false): CanvasElement {
  return { ...newCanvasElement('rect', id, PAPER), x, y, width, height, locked };
}

function canvas(...elements: CanvasElement[]): CanvasTemplate {
  return { kind: 'canvas', id: 'custom:t', name: '测试', paper: PAPER, printer: null, elements };
}

/** 只取位置和大小，断言时一目了然。 */
function boxes(template: CanvasTemplate) {
  return template.elements.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
}

describe('rounding', () => {
  test('keeps millimetres to two decimals and never shows minus zero', () => {
    expect(roundMm(12.3456)).toBe(12.35);
    expect(Object.is(roundMm(-0.001), 0)).toBe(true);
  });

  test('rounds to a step', () => {
    expect(roundTo(1.26, 0.1)).toBe(1.3);
    expect(roundTo(0.04, 0.1)).toBe(0);
  });
});

describe('clampBox', () => {
  test('keeps a box on the paper and at least the minimum size', () => {
    expect(clampBox({ x: 55, y: -3, width: 20, height: 0 }, PAPER)).toEqual({
      x: 40,
      y: 0,
      width: 20,
      height: CANVAS_LIMITS.minSizeMm,
    });
    expect(clampBox({ x: -5, y: 5, width: 80, height: 10 }, PAPER)).toEqual({ x: 0, y: 5, width: 60, height: 10 });
  });

  test('pulls every element back onto a smaller paper', () => {
    const template = { ...canvas(rect('a', 50, 30, 10, 5)), paper: { widthMm: 40, heightMm: 30 } };
    expect(boxes(clampAll(template))).toEqual([{ id: 'a', x: 30, y: 25, width: 10, height: 5 }]);
  });
});

describe('moveBy', () => {
  test('moves a group as far as the paper allows, keeping the spacing', () => {
    const template = canvas(rect('a', 10, 10, 10, 5), rect('b', 30, 20, 10, 5));
    expect(boxes(moveBy(template, ['a', 'b'], 25, 0))).toEqual([
      { id: 'a', x: 30, y: 10, width: 10, height: 5 },
      { id: 'b', x: 50, y: 20, width: 10, height: 5 },
    ]);
  });

  test('leaves locked elements where they are', () => {
    const template = canvas(rect('a', 10, 10, 10, 5, true), rect('b', 30, 20, 10, 5));
    expect(boxes(moveBy(template, ['a', 'b'], 5, 5))).toEqual([
      { id: 'a', x: 10, y: 10, width: 10, height: 5 },
      { id: 'b', x: 35, y: 25, width: 10, height: 5 },
    ]);
    expect(moveBy(template, ['a'], 5, 5)).toBe(template);
  });
});

describe('resizeBox', () => {
  const start = { x: 10, y: 10, width: 20, height: 10 };

  test('moves only the edges of the dragged handle', () => {
    expect(resizeBox(start, 'se', 5, 5, PAPER)).toEqual({ x: 10, y: 10, width: 25, height: 15 });
    expect(resizeBox(start, 'nw', 5, 2, PAPER)).toEqual({ x: 15, y: 12, width: 15, height: 8 });
    expect(resizeBox(start, 'e', 0, 9, PAPER)).toEqual(start);
  });

  test('stops at the minimum size and at the paper edge', () => {
    expect(resizeBox(start, 'w', 30, 0, PAPER)).toEqual({ x: 29.75, y: 10, width: 0.25, height: 10 });
    expect(resizeBox(start, 'e', 100, 0, PAPER)).toEqual({ x: 10, y: 10, width: 50, height: 10 });
    expect(resizeBox(start, 'n', 0, -50, PAPER)).toEqual({ x: 10, y: 0, width: 20, height: 20 });
  });
});

describe('setBox and replaceElement', () => {
  test('put a changed box back on the paper', () => {
    const template = canvas(rect('a', 10, 10, 10, 5));
    expect(boxes(setBox(template, 'a', { x: 50, y: 0, width: 20, height: 5 }))[0]).toMatchObject({ x: 40, width: 20 });
    const element = template.elements[0];
    if (element === undefined) {
      throw new Error('expected an element');
    }
    expect(replaceElement(template, { ...element, x: 100 }).elements[0]?.x).toBe(50);
  });

  test('do not resize a locked element', () => {
    const template = canvas(rect('a', 10, 10, 10, 5, true));
    expect(boxes(setBox(template, 'a', { x: 0, y: 0, width: 30, height: 30 }))).toEqual(boxes(template));
  });
});

describe('rotateElement', () => {
  test('swaps width and height around the centre on a quarter turn', () => {
    const rotated = rotateElement(canvas(rect('a', 15, 17, 30, 6)), 'a', 90);
    expect(rotated.elements[0]).toMatchObject({ x: 27, y: 5, width: 6, height: 30, rotation: 90 });
  });

  test('keeps the box on a half turn and keeps a turned box on the paper', () => {
    expect(rotateElement(canvas(rect('a', 15, 17, 30, 6)), 'a', 180).elements[0]).toMatchObject({
      x: 15,
      y: 17,
      width: 30,
      height: 6,
      rotation: 180,
    });
    expect(rotateElement(canvas(rect('a', 0, 0, 30, 6)), 'a', 270).elements[0]).toMatchObject({
      x: 12,
      y: 0,
      width: 6,
      height: 30,
    });
  });
});

describe('adding elements', () => {
  test('puts a new element in the middle of the paper, on top', () => {
    const added = addElement(canvas(rect('a', 0, 0, 5, 5)), 'text');
    expect(added?.ids).toEqual(['e1']);
    expect(added?.template.elements.at(-1)).toMatchObject({ id: 'e1', kind: 'text', x: 15, y: 17, width: 30, height: 6 });
  });

  test('centres a dropped element on the drop point, inside the paper', () => {
    expect(addElement(canvas(), 'text', { x: 58, y: 2 })?.template.elements[0]).toMatchObject({ x: 30, y: 0 });
  });

  test('numbers the names of elements of the same kind', () => {
    const first = addElement(canvas(), 'text');
    const second = first && addElement(first.template, 'text');
    expect(second?.template.elements.map((element) => element.name)).toEqual(['文字', '文字 2']);
  });

  test('refuses to add past the element limit', () => {
    const full = canvas(...Array.from({ length: CANVAS_LIMITS.elements }, (_, index) => rect(`r${index}`, 0, 0, 1, 1)));
    expect(addElement(full, 'line')).toBeNull();
  });

  test('picks the first unused id and a free name', () => {
    expect(newElementId([rect('e1', 0, 0, 1, 1), rect('e3', 0, 0, 1, 1)])).toBe('e2');
    const named = [
      { ...rect('a', 0, 0, 1, 1), name: '文字' },
      { ...rect('b', 0, 0, 1, 1), name: '文字 2' },
    ];
    expect(uniqueName('文字', named)).toBe('文字 3');
    expect(uniqueName('文字 2', named)).toBe('文字 3');
    expect(uniqueName('条码', named)).toBe('条码');
    const long = 'x'.repeat(CANVAS_LIMITS.nameLength);
    expect(uniqueName(long, [{ ...rect('c', 0, 0, 1, 1), name: long }])).toBe(`${'x'.repeat(CANVAS_LIMITS.nameLength - 2)} 2`);
  });
});

describe('deleteElements and toggleId', () => {
  test('deletes the selected elements except locked ones', () => {
    const template = canvas(rect('a', 0, 0, 5, 5), rect('b', 0, 0, 5, 5, true), rect('c', 0, 0, 5, 5));
    expect(deleteElements(template, ['a', 'b']).elements.map((element) => element.id)).toEqual(['b', 'c']);
    expect(deleteElements(template, ['b'])).toBe(template);
  });

  test('adds or removes one id from a selection', () => {
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleId(['a'], 'c')).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/canvas-edit.test.ts`
Expected: FAIL，`Cannot find module './canvas-edit'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/canvas-edit.ts
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasElementKind,
  type CanvasTemplate,
  newCanvasElement,
  type Rotation,
} from '../../../core/templates/canvas-model';
import type { PaperSize } from '../../../shared/paper-sizes';

/**
 * 设计器的编辑操作，全是纯函数：输入模板，返回改好的新模板（不改原来的；没有变化时尽量原样返回）。
 * 位置和大小的规则和 core 的 sanitize-canvas 一致（不小于最小尺寸、整个元素在纸上），保存时不会再被改动。
 * 锁定的元素不移动、不缩放、不删除（防止误碰），但可以选中、在属性栏里改。
 */

/** 元素在纸上占的框（mm），和 CanvasElementBase 的 x、y、width、height 一致。 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 纸上的一个点（mm）。 */
export interface Point {
  x: number;
  y: number;
}

/** 添加、粘贴的结果：新模板和新元素的 id（设计器接着选中它们）。 */
export interface Added {
  template: CanvasTemplate;
  ids: string[];
}

/** 0.01mm：比打印点（203dpi 约 0.125mm）细得多；再细的小数存进模板没有意义，数字框里还会出现 12.300000001。 */
const MM_PRECISION = 100;

/** 保留两位小数；`|| 0` 把 -0 变成 0，数字框不会显示「-0」。 */
export function roundMm(value: number): number {
  return Math.round(value * MM_PRECISION) / MM_PRECISION || 0;
}

/** 取整到 step 的整数倍（例如拖动按 0.1mm 一步）。 */
export function roundTo(value: number, step: number): number {
  return roundMm(Math.round(value / step) * step);
}

/** 只取框的四个数（元素本身也是一个框）。 */
export function boxOf(box: Box): Box {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** 几个框合起来的外框；空列表返回 null。 */
export function boundsOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) {
    return null;
  }
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 框收进纸内：先定大小（不小于最小尺寸、不大于纸），再定位置（整个框在纸上）。 */
export function clampBox(box: Box, paper: PaperSize): Box {
  const min = CANVAS_LIMITS.minSizeMm;
  const width = roundMm(Math.min(paper.widthMm, Math.max(min, box.width)));
  const height = roundMm(Math.min(paper.heightMm, Math.max(min, box.height)));
  return {
    x: roundMm(Math.min(paper.widthMm - width, Math.max(0, box.x))),
    y: roundMm(Math.min(paper.heightMm - height, Math.max(0, box.y))),
    width,
    height,
  };
}

/** 选中的里面加上或去掉一个（Shift 点选）。 */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

function withBox<T extends CanvasElement>(element: T, box: Box): T {
  return { ...element, x: box.x, y: box.y, width: box.width, height: box.height };
}

/** 选中了、又没锁定：拖动、缩放、删除、对齐都只动这些。 */
function isMovable(element: CanvasElement, ids: readonly string[]): boolean {
  return ids.includes(element.id) && !element.locked;
}

/** 所有元素收进纸内：换了更小的纸以后用，不然元素落在纸外，覆盖层上也看不到。 */
export function clampAll(template: CanvasTemplate): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) => withBox(element, clampBox(element, template.paper))),
  };
}

/** 按 id 换掉一个元素（属性栏的修改），框收进纸内；没有这个 id 时元素不变。 */
export function replaceElement(template: CanvasTemplate, next: CanvasElement): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) =>
      element.id === next.id ? withBox(next, clampBox(next, template.paper)) : element,
    ),
  };
}

/** 给一个元素新的框（拖控制点松手时），收进纸内；锁定的不变。 */
export function setBox(template: CanvasTemplate, id: string, box: Box): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) =>
      element.id === id && !element.locked ? withBox(element, clampBox(box, template.paper)) : element,
    ),
  };
}

/** 整组移动：位移先限制在「整组都还在纸上」以内，组里元素的相对位置不变。锁定的不动；没有能动的原样返回。 */
export function moveBy(template: CanvasTemplate, ids: readonly string[], dx: number, dy: number): CanvasTemplate {
  const moving = template.elements.filter((element) => isMovable(element, ids));
  const bounds = boundsOf(moving);
  if (bounds === null) {
    return template;
  }
  const { paper } = template;
  const clampedDx = Math.min(paper.widthMm - bounds.x - bounds.width, Math.max(-bounds.x, dx));
  const clampedDy = Math.min(paper.heightMm - bounds.y - bounds.height, Math.max(-bounds.y, dy));
  return {
    ...template,
    elements: template.elements.map((element) =>
      isMovable(element, ids)
        ? { ...element, x: roundMm(element.x + clampedDx), y: roundMm(element.y + clampedDy) }
        : element,
    ),
  };
}

/** 选框的 8 个控制点：四个角和四条边的中点。 */
export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** 拖控制点改框：只动这个控制点所在的边，对边不动；不小于最小尺寸、不出纸。 */
export function resizeBox(start: Box, handle: ResizeHandle, dx: number, dy: number, paper: PaperSize): Box {
  const min = CANVAS_LIMITS.minSizeMm;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) {
    left = Math.min(right - min, Math.max(0, left + dx));
  }
  if (handle.includes('e')) {
    right = Math.max(left + min, Math.min(paper.widthMm, right + dx));
  }
  if (handle.includes('n')) {
    top = Math.min(bottom - min, Math.max(0, top + dy));
  }
  if (handle.includes('s')) {
    bottom = Math.max(top + min, Math.min(paper.heightMm, bottom + dy));
  }
  return { x: roundMm(left), y: roundMm(top), width: roundMm(right - left), height: roundMm(bottom - top) };
}

/**
 * 转到新的直角：框是转过之后的外框，横竖互换时（0 ↔ 90 这类）以中心为准交换宽高，再收进纸内；
 * 转半圈（0 ↔ 180）框不变。
 */
export function rotateElement(template: CanvasTemplate, id: string, rotation: Rotation): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) => {
      if (element.id !== id) {
        return element;
      }
      if ((element.rotation - rotation) % 180 === 0) {
        return { ...element, rotation };
      }
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      const box = clampBox(
        {
          x: centerX - element.height / 2,
          y: centerY - element.width / 2,
          width: element.height,
          height: element.width,
        },
        template.paper,
      );
      return withBox({ ...element, rotation }, box);
    }),
  };
}

/** 新元素的 id：e1、e2……取第一个没用过的（符合 sanitize-canvas 的 id 规则：字母、数字、连字符）。 */
export function newElementId(elements: readonly CanvasElement[]): string {
  const used = new Set(elements.map((element) => element.id));
  let number = 1;
  while (used.has(`e${number}`)) {
    number += 1;
  }
  return `e${number}`;
}

/** 名字末尾的编号（「文字 2」的「 2」）：再编号时去掉，不会变成「文字 2 2」。 */
const NAME_NUMBER_PATTERN = / \d+$/;

/**
 * 不和别的元素重名：重名时在末尾加编号（文字 → 文字 2 → 文字 3）。打印前检查用名字指出是哪个元素，重名就分不清。
 * 名字有长度上限，太长时截掉前面部分的末尾给编号让位。
 */
export function uniqueName(name: string, elements: readonly CanvasElement[]): string {
  const used = new Set(elements.map((element) => element.name));
  if (!used.has(name)) {
    return name;
  }
  const base = name.replace(NAME_NUMBER_PATTERN, '');
  const numbered = (number: number) => {
    const suffix = ` ${number}`;
    return `${base.slice(0, CANVAS_LIMITS.nameLength - suffix.length)}${suffix}`;
  };
  let number = 2;
  while (used.has(numbered(number))) {
    number += 1;
  }
  return numbered(number);
}

/** 加一个元素，中心放在 center（默认纸的中心），收进纸内，放在最上层；已到元素上限时返回 null（界面提示）。 */
export function addElement(template: CanvasTemplate, kind: CanvasElementKind, center?: Point): Added | null {
  if (template.elements.length >= CANVAS_LIMITS.elements) {
    return null;
  }
  const id = newElementId(template.elements);
  const created = newCanvasElement(kind, id, template.paper);
  const at = center ?? { x: template.paper.widthMm / 2, y: template.paper.heightMm / 2 };
  const box = clampBox(
    { ...boxOf(created), x: at.x - created.width / 2, y: at.y - created.height / 2 },
    template.paper,
  );
  const element = withBox({ ...created, name: uniqueName(created.name, template.elements) }, box);
  return { template: { ...template, elements: [...template.elements, element] }, ids: [id] };
}

/** 删掉选中的（锁定的留着）；没有能删的原样返回。 */
export function deleteElements(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const kept = template.elements.filter((element) => !isMovable(element, ids));
  return kept.length === template.elements.length ? template : { ...template, elements: kept };
}
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/renderer/src/lib/canvas-edit.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/canvas-edit.ts src/renderer/src/lib/canvas-edit.test.ts
git commit -m "feat(renderer): move, resize, rotate, add and delete canvas elements" -m "Pure editing functions for the designer. They keep every element on the paper and at least the minimum size, the same rules the template sanitizer applies, so saving never moves an element. Locked elements are not moved, resized or deleted." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 3: 对齐、等距、叠放、复制粘贴、框选

**Files:**
- Modify: `src/renderer/src/lib/canvas-edit.ts`（文件末尾追加）
- Modify: `src/renderer/src/lib/canvas-edit.test.ts`（import 换成下面的；文件末尾追加用例）

- [ ] **Step 1: 写测试**

`canvas-edit.test.ts` 里 `from './canvas-edit'` 的 import 换成：

```ts
import {
  type Alignment,
  addElement,
  alignElements,
  bringToFront,
  clampAll,
  clampBox,
  copyElements,
  deleteElements,
  distributeElements,
  elementsInRect,
  moveBy,
  newElementId,
  pasteElements,
  rectFromPoints,
  replaceElement,
  resizeBox,
  rotateElement,
  roundMm,
  roundTo,
  sendToBack,
  setBox,
  toggleId,
  uniqueName,
} from './canvas-edit';
```

文件末尾加：

```ts
describe('alignElements', () => {
  test('aligns a single element to the safe area', () => {
    const template = canvas(rect('a', 10, 10, 20, 10));
    const x = (alignment: Alignment) => alignElements(template, ['a'], alignment).elements[0]?.x;
    const y = (alignment: Alignment) => alignElements(template, ['a'], alignment).elements[0]?.y;
    expect([x('left'), x('center'), x('right')]).toEqual([1.5, 20, 38.5]);
    expect([y('top'), y('middle'), y('bottom')]).toEqual([1.5, 15, 28.5]);
  });

  test('aligns several elements to their common bounds, leaving locked ones in place', () => {
    const template = canvas(rect('a', 10, 10, 10, 5), rect('b', 30, 20, 20, 5));
    expect(boxes(alignElements(template, ['a', 'b'], 'right')).map((box) => box.x)).toEqual([40, 30]);
    expect(boxes(alignElements(template, ['a', 'b'], 'middle')).map((box) => box.y)).toEqual([15, 15]);
    const locked = canvas(rect('a', 10, 10, 10, 5, true), rect('b', 30, 20, 20, 5));
    expect(boxes(alignElements(locked, ['a', 'b'], 'left')).map((box) => box.x)).toEqual([10, 10]);
  });
});

describe('distributeElements', () => {
  test('spaces the middle elements evenly between the first and the last', () => {
    const row = canvas(rect('a', 0, 0, 10, 5), rect('c', 50, 0, 10, 5), rect('b', 12, 0, 10, 5));
    expect(boxes(distributeElements(row, ['a', 'b', 'c'], 'horizontal')).map((box) => box.x)).toEqual([0, 50, 25]);
    const column = canvas(rect('a', 0, 0, 10, 4), rect('b', 0, 10, 10, 4), rect('c', 0, 30, 10, 4));
    expect(boxes(distributeElements(column, ['a', 'b', 'c'], 'vertical')).map((box) => box.y)).toEqual([0, 15, 30]);
  });

  test('needs at least three elements', () => {
    const template = canvas(rect('a', 0, 0, 10, 5), rect('b', 30, 0, 10, 5));
    expect(distributeElements(template, ['a', 'b'], 'horizontal')).toBe(template);
  });
});

describe('layer order', () => {
  const template = canvas(rect('a', 0, 0, 1, 1), rect('b', 0, 0, 1, 1), rect('c', 0, 0, 1, 1), rect('d', 0, 0, 1, 1));
  const order = (next: CanvasTemplate) => next.elements.map((element) => element.id);

  test('brings the selection to the front keeping its own order', () => {
    expect(order(bringToFront(template, ['b', 'a']))).toEqual(['c', 'd', 'a', 'b']);
  });

  test('sends the selection to the back keeping its own order', () => {
    expect(order(sendToBack(template, ['d', 'c']))).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('copy and paste', () => {
  test('copies deeply, so later edits do not change the clipboard', () => {
    const template = canvas(rect('a', 10, 10, 10, 5));
    const [copy] = copyElements(template, ['a']);
    if (copy === undefined) {
      throw new Error('expected a copy');
    }
    copy.x = 0;
    expect(template.elements[0]?.x).toBe(10);
  });

  test('pastes with new ids and names, offset and unlocked', () => {
    const template = canvas(rect('a', 10, 10, 10, 5, true));
    const pasted = pasteElements(template, copyElements(template, ['a']));
    expect(pasted.ids).toEqual(['e1']);
    expect(pasted.template.elements[1]).toMatchObject({ id: 'e1', name: '矩形 2', x: 12, y: 12, locked: false });
  });

  test('keeps pasted elements on the paper and within the element limit', () => {
    const edge = canvas(rect('a', 50, 35, 10, 5));
    expect(pasteElements(edge, copyElements(edge, ['a'])).template.elements[1]).toMatchObject({ x: 50, y: 35 });
    const almostFull = canvas(
      ...Array.from({ length: CANVAS_LIMITS.elements - 1 }, (_, index) => rect(`r${index}`, 0, 0, 1, 1)),
    );
    expect(pasteElements(almostFull, copyElements(almostFull, ['r0', 'r1'])).ids).toHaveLength(1);
  });
});

describe('marquee selection', () => {
  test('selects every element the rectangle touches', () => {
    const template = canvas(rect('a', 10, 10, 10, 5), rect('b', 40, 30, 10, 5), rect('c', 0, 20, 60, 0.25));
    expect(elementsInRect(template, { x: 5, y: 5, width: 20, height: 20 })).toEqual(['a', 'c']);
  });

  test('builds the rectangle from two corners in any order', () => {
    expect(rectFromPoints({ x: 20, y: 5 }, { x: 10, y: 15 })).toEqual({ x: 10, y: 5, width: 10, height: 10 });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/canvas-edit.test.ts`
Expected: FAIL（`alignElements` 等没有导出）。

- [ ] **Step 3: 实现**（`canvas-edit.ts` 末尾追加）

```ts
export const ALIGNMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** 安全区：纸边往里 1.5mm（再往外，打印前检查会提示「靠近纸边」）。 */
function safeArea(paper: PaperSize): Box {
  const margin = CANVAS_LIMITS.safeMarginMm;
  return { x: margin, y: margin, width: paper.widthMm - 2 * margin, height: paper.heightMm - 2 * margin };
}

function aligned(box: Box, target: Box, alignment: Alignment): Box {
  switch (alignment) {
    case 'left':
      return { ...boxOf(box), x: target.x };
    case 'center':
      return { ...boxOf(box), x: target.x + (target.width - box.width) / 2 };
    case 'right':
      return { ...boxOf(box), x: target.x + target.width - box.width };
    case 'top':
      return { ...boxOf(box), y: target.y };
    case 'middle':
      return { ...boxOf(box), y: target.y + (target.height - box.height) / 2 };
    case 'bottom':
      return { ...boxOf(box), y: target.y + target.height - box.height };
  }
}

/**
 * 对齐：选一个时对齐到安全区（单个元素居中、靠边是最常用的）；选几个时对齐到它们合起来的外框。
 * 锁定的不动，但算进外框（拿它当基准对齐别的元素）。
 */
export function alignElements(template: CanvasTemplate, ids: readonly string[], alignment: Alignment): CanvasTemplate {
  const selected = template.elements.filter((element) => ids.includes(element.id));
  const target = selected.length === 1 ? safeArea(template.paper) : boundsOf(selected);
  if (target === null) {
    return template;
  }
  return {
    ...template,
    elements: template.elements.map((element) =>
      isMovable(element, ids) ? withBox(element, clampBox(aligned(element, target, alignment), template.paper)) : element,
    ),
  };
}

export type DistributeAxis = 'horizontal' | 'vertical';

/** 「等距」至少要三个：两个之间的空隙本来就只有一个。 */
export const MIN_DISTRIBUTE_COUNT = 3;

/** 等距：按位置排好，第一个和最后一个不动，中间的让相邻两个之间的空隙相等。锁定的不参与。 */
export function distributeElements(
  template: CanvasTemplate,
  ids: readonly string[],
  axis: DistributeAxis,
): CanvasTemplate {
  const isHorizontal = axis === 'horizontal';
  const startOf = (box: Box) => (isHorizontal ? box.x : box.y);
  const sizeOf = (box: Box) => (isHorizontal ? box.width : box.height);
  const moving = template.elements.filter((element) => isMovable(element, ids)).sort((a, b) => startOf(a) - startOf(b));
  const first = moving[0];
  const last = moving.at(-1);
  if (moving.length < MIN_DISTRIBUTE_COUNT || first === undefined || last === undefined) {
    return template;
  }
  const span = startOf(last) + sizeOf(last) - startOf(first);
  const gap = (span - moving.reduce((sum, element) => sum + sizeOf(element), 0)) / (moving.length - 1);
  const positions = new Map<string, number>();
  let cursor = startOf(first);
  for (const element of moving) {
    positions.set(element.id, cursor);
    cursor += sizeOf(element) + gap;
  }
  return {
    ...template,
    elements: template.elements.map((element) => {
      const at = positions.get(element.id);
      if (at === undefined) {
        return element;
      }
      const box = isHorizontal ? { ...boxOf(element), x: at } : { ...boxOf(element), y: at };
      return withBox(element, clampBox(box, template.paper));
    }),
  };
}

/** 置顶：选中的按原来的先后挪到最上层（数组末尾就是最上层）。 */
export function bringToFront(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const picked = template.elements.filter((element) => ids.includes(element.id));
  const rest = template.elements.filter((element) => !ids.includes(element.id));
  return { ...template, elements: [...rest, ...picked] };
}

/** 置底：选中的按原来的先后挪到最下层。 */
export function sendToBack(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const picked = template.elements.filter((element) => ids.includes(element.id));
  const rest = template.elements.filter((element) => !ids.includes(element.id));
  return { ...template, elements: [...picked, ...rest] };
}

/** 粘贴往右下错开 2mm：和原来的叠在一起时看不出粘贴成功了。 */
export const PASTE_OFFSET_MM = 2;

/** 复制：深拷贝（之后改模板不影响剪贴板里的）。 */
export function copyElements(template: CanvasTemplate, ids: readonly string[]): CanvasElement[] {
  return template.elements.filter((element) => ids.includes(element.id)).map((element) => structuredClone(element));
}

/** 粘贴：换新 id、名字加编号、错开 offsetMm 再收进纸内、不带锁定；超出元素上限的部分不贴（调用方提示）。 */
export function pasteElements(
  template: CanvasTemplate,
  clip: readonly CanvasElement[],
  offsetMm: number = PASTE_OFFSET_MM,
): Added {
  const room = Math.max(0, CANVAS_LIMITS.elements - template.elements.length);
  const elements = [...template.elements];
  const ids: string[] = [];
  for (const source of clip.slice(0, room)) {
    const id = newElementId(elements);
    const copy: CanvasElement = { ...structuredClone(source), id, name: uniqueName(source.name, elements), locked: false };
    const box = clampBox({ ...boxOf(source), x: source.x + offsetMm, y: source.y + offsetMm }, template.paper);
    elements.push(withBox(copy, box));
    ids.push(id);
  }
  return { template: { ...template, elements }, ids };
}

/** 两个角（任意顺序）围成的框：框选用。 */
export function rectFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** 框选：和选框有重叠的元素（细线、小元素不用整个框住），按上下层顺序。 */
export function elementsInRect(template: CanvasTemplate, rect: Box): string[] {
  return template.elements
    .filter(
      (element) =>
        element.x < rect.x + rect.width &&
        element.x + element.width > rect.x &&
        element.y < rect.y + rect.height &&
        element.y + element.height > rect.y,
    )
    .map((element) => element.id);
}
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/renderer/src/lib/canvas-edit.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/canvas-edit.ts src/renderer/src/lib/canvas-edit.test.ts
git commit -m "feat(renderer): align, distribute, reorder, copy and paste canvas elements" -m "A single element aligns to the safe area, several align to their common bounds. Pasted elements get new ids, numbered names and a 2 mm offset so a paste is visible; marquee selection picks every element the rectangle touches, so thin lines are easy to catch." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 4: 缩放档位、像素换毫米、按键命令

**Files:**
- Create: `src/renderer/src/lib/canvas-view.ts`
- Create: `src/renderer/src/lib/canvas-view.test.ts`
- Modify: `src/renderer/src/view-models/use-fit-scale.ts:3`（每毫米像素改用这里的常量，只写一处）

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/canvas-view.test.ts
import { describe, expect, test } from 'bun:test';
import {
  type DesignerKey,
  designerCommand,
  NUDGE_LARGE_MM,
  NUDGE_MM,
  PX_PER_MM,
  pxToMm,
  ZOOM_LEVELS,
  zoomIn,
  zoomOut,
} from './canvas-view';

function key(name: string, modifiers: Partial<Omit<DesignerKey, 'key'>> = {}): DesignerKey {
  return { key: name, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe('zoom', () => {
  test('steps to the next level up or down', () => {
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomOut(1)).toBe(0.75);
  });

  test('steps from a fitted zoom to the nearest level', () => {
    expect(zoomIn(1.2)).toBe(1.5);
    expect(zoomOut(1.2)).toBe(1);
  });

  test('stays at the ends', () => {
    expect(zoomIn(ZOOM_LEVELS.at(-1) ?? 0)).toBe(6);
    expect(zoomOut(ZOOM_LEVELS[0] ?? 0)).toBe(0.5);
  });

  test('converts screen pixels to millimetres at a zoom', () => {
    expect(pxToMm(PX_PER_MM * 2, 2)).toBe(1);
  });
});

describe('designerCommand', () => {
  test('nudges by a tenth of a millimetre, or one millimetre with Shift', () => {
    expect(designerCommand(key('ArrowRight'))).toEqual({ kind: 'nudge', dx: NUDGE_MM, dy: 0 });
    expect(designerCommand(key('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'nudge', dx: 0, dy: -NUDGE_LARGE_MM });
  });

  test('maps the Ctrl and Command shortcuts', () => {
    expect(designerCommand(key('z', { ctrlKey: true }))).toEqual({ kind: 'undo' });
    expect(designerCommand(key('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
    expect(designerCommand(key('y', { ctrlKey: true }))).toEqual({ kind: 'redo' });
    expect(designerCommand(key('c', { metaKey: true }))).toEqual({ kind: 'copy' });
    expect(designerCommand(key('v', { ctrlKey: true }))).toEqual({ kind: 'paste' });
    expect(designerCommand(key('a', { ctrlKey: true }))).toBeNull();
  });

  test('deletes with Delete or Backspace and clears the selection with Escape', () => {
    expect(designerCommand(key('Delete'))).toEqual({ kind: 'delete' });
    expect(designerCommand(key('Backspace'))).toEqual({ kind: 'delete' });
    expect(designerCommand(key('Escape'))).toEqual({ kind: 'deselect' });
  });

  // 扫码枪「打字」的字符不能被画布吃掉：配置中心要把它们送进「预览内容」（见 use-config-scan）。
  test('leaves the characters a scanner types alone', () => {
    for (const character of ['a', 'Z', '7', '-', '{', '中', ' ', 'Enter', 'Tab']) {
      expect(designerCommand(key(character))).toBeNull();
      expect(designerCommand(key(character, { shiftKey: true }))).toBeNull();
    }
  });

  test('ignores Alt combinations', () => {
    expect(designerCommand(key('ArrowLeft', { altKey: true }))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/canvas-view.test.ts`
Expected: FAIL，`Cannot find module './canvas-view'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/canvas-view.ts
/** 设计器画布的显示和按键：缩放档位、屏幕像素换毫米、按键 → 命令。纯函数，不碰 DOM。 */

/** CSS 像素每毫米（CSS 规定 1in = 96px = 25.4mm）：预览和设计器都按它把毫米换成屏幕上的大小。 */
export const PX_PER_MM = 96 / 25.4;

/** 缩放档位：0.5 倍看全 100×150 的面单，6 倍看清 30×20 小标签上 0.25mm 的线；中间是常用的倍数。 */
export const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

/** 比较档位时容许的误差：「适合窗口」算出来的倍数是任意小数。 */
const ZOOM_EPSILON = 0.001;

/** 放大一档：从当前倍数（可能是「适合窗口」算出的任意值）到下一个更大的档位；已是最大时不变。 */
export function zoomIn(current: number): number {
  return ZOOM_LEVELS.find((level) => level > current + ZOOM_EPSILON) ?? ZOOM_LEVELS.at(-1) ?? current;
}

/** 缩小一档；已是最小时不变。 */
export function zoomOut(current: number): number {
  return [...ZOOM_LEVELS].reverse().find((level) => level < current - ZOOM_EPSILON) ?? ZOOM_LEVELS[0] ?? current;
}

/** 屏幕像素 → 纸上的毫米（在 zoom 倍下）。 */
export function pxToMm(px: number, zoom: number): number {
  return px / (PX_PER_MM * zoom);
}

/** 方向键一次挪 0.1mm（接近 203dpi 的一个打印点 0.125mm），按住 Shift 一次 1mm。 */
export const NUDGE_MM = 0.1;
export const NUDGE_LARGE_MM = 1;

/** 从元素栏拖到画布上时，拖动数据里放元素类型用的格式名（只在这个页面内部用）。 */
export const ELEMENT_DRAG_TYPE = 'application/x-labelflash-element';

export type DesignerCommand =
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'delete' }
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'deselect' };

/** 按键里判断要用的几项（React 和 DOM 的键盘事件本身就满足这个形状）。 */
export interface DesignerKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * 画布上的按键 → 设计器命令。只认方向键、Delete / Backspace、Esc 和 Ctrl（macOS 上 ⌘）组合键；
 * 字母、数字这类可打印字符一律返回 null，不拦：配置中心把它们当作扫码枪的输入送进「预览内容」。
 */
export function designerCommand(event: DesignerKey): DesignerCommand | null {
  if (event.altKey) {
    return null;
  }
  if (event.ctrlKey || event.metaKey) {
    switch (event.key.toLowerCase()) {
      case 'z':
        return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
      case 'y':
        return { kind: 'redo' };
      case 'c':
        return { kind: 'copy' };
      case 'v':
        return { kind: 'paste' };
      default:
        return null;
    }
  }
  const arrow = ARROWS[event.key];
  if (arrow) {
    const step = event.shiftKey ? NUDGE_LARGE_MM : NUDGE_MM;
    return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return { kind: 'delete' };
  }
  if (event.key === 'Escape') {
    return { kind: 'deselect' };
  }
  return null;
}
```

- [ ] **Step 4: `use-fit-scale.ts` 改用这里的常量**

`src/renderer/src/view-models/use-fit-scale.ts` 第 3 行 `const PX_PER_MM = 96 / 25.4;` 删掉，在第 1 行 react 的 import 之后加：

```ts
import { PX_PER_MM } from '../lib/canvas-view';
```

- [ ] **Step 5: 跑测试通过、`bun run check`**

Run: `bun test src/renderer/src/lib/canvas-view.test.ts && bun run check`
Expected: PASS；check 通过。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/lib/canvas-view.ts src/renderer/src/lib/canvas-view.test.ts src/renderer/src/view-models/use-fit-scale.ts
git commit -m "feat(renderer): zoom levels and keyboard commands for the canvas designer" -m "The canvas only takes arrows, Delete, Escape and Ctrl or Command shortcuts. Printable characters are left alone so the config center keeps routing scanner input into the preview content while the canvas has focus." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 5: 吸附和参考线

**Files:**
- Create: `src/renderer/src/lib/canvas-snap.ts`
- Create: `src/renderer/src/lib/canvas-snap.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/canvas-snap.test.ts
import { describe, expect, test } from 'bun:test';
import { SNAP_DISTANCE_PX, snapMove, snapResize, snapTargets, snapThresholdMm } from './canvas-snap';
import { PX_PER_MM } from './canvas-view';

const PAPER = { widthMm: 60, heightMm: 40 };
const PAPER_ONLY = snapTargets(PAPER, []);
/** 用例里的吸附距离：0.5mm。 */
const THRESHOLD_MM = 0.5;

describe('snapTargets', () => {
  test('lists the paper edges, the safe area, the centre lines and the edges and centres of the others', () => {
    expect(snapTargets(PAPER, [{ x: 10, y: 5, width: 20, height: 10 }])).toEqual({
      x: [0, 1.5, 30, 58.5, 60, 10, 20, 30],
      y: [0, 1.5, 20, 38.5, 40, 5, 10, 15],
    });
  });

  test('turns the snap distance on screen into millimetres', () => {
    expect(snapThresholdMm(2)).toBeCloseTo(SNAP_DISTANCE_PX / (PX_PER_MM * 2), 9);
  });
});

describe('snapMove', () => {
  test('pulls a box edge onto the safe area and draws the guide', () => {
    const { box, guides } = snapMove({ x: 1.2, y: 10, width: 10, height: 5 }, PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(1.5, 9);
    expect(box.y).toBe(10);
    expect(guides).toEqual([{ axis: 'x', at: 1.5 }]);
  });

  test('pulls the centre of a box onto the centre lines of the paper', () => {
    const { box, guides } = snapMove({ x: 24.8, y: 17.4, width: 10, height: 5 }, PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(25, 9);
    expect(box.y).toBeCloseTo(17.5, 9);
    expect(guides).toEqual([
      { axis: 'x', at: 30 },
      { axis: 'y', at: 20 },
    ]);
  });

  test('snaps to the edges of other elements', () => {
    const targets = snapTargets(PAPER, [{ x: 30, y: 0, width: 10, height: 5 }]);
    const { box, guides } = snapMove({ x: 40.3, y: 10, width: 5, height: 5 }, targets, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(40, 9);
    expect(guides).toEqual([{ axis: 'x', at: 40 }]);
  });

  test('leaves a box alone when nothing is close enough', () => {
    const box = { x: 5, y: 7, width: 10, height: 5 };
    expect(snapMove(box, PAPER_ONLY, THRESHOLD_MM)).toEqual({ box, guides: [] });
  });
});

describe('snapResize', () => {
  test('snaps only the edge being dragged', () => {
    const { box, guides } = snapResize({ x: 1.3, y: 10, width: 28.9, height: 5 }, 'e', PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBe(1.3);
    expect(box.x + box.width).toBeCloseTo(30, 9);
    expect(guides).toEqual([{ axis: 'x', at: 30 }]);
  });

  test('snaps both edges at a corner', () => {
    const { box, guides } = snapResize({ x: 1.7, y: 1.2, width: 10, height: 10 }, 'nw', PAPER_ONLY, THRESHOLD_MM);
    expect(box.x).toBeCloseTo(1.5, 9);
    expect(box.width).toBeCloseTo(10.2, 9);
    expect(box.y).toBeCloseTo(1.5, 9);
    expect(box.height).toBeCloseTo(9.7, 9);
    expect(guides).toEqual([
      { axis: 'x', at: 1.5 },
      { axis: 'y', at: 1.5 },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/canvas-snap.test.ts`
Expected: FAIL，`Cannot find module './canvas-snap'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/canvas-snap.ts
import { CANVAS_LIMITS } from '../../../core/templates/canvas-model';
import type { PaperSize } from '../../../shared/paper-sizes';
import type { Box, ResizeHandle } from './canvas-edit';
import { pxToMm } from './canvas-view';

/**
 * 拖动和缩放时的吸附：靠近纸边、安全区、纸的中线、其他元素的边和中线时吸过去，并给出要画的参考线。
 * 网格只是显示，不吸网格（设计文档第 3.3 节列的吸附目标里没有网格；吸网格会和吸元素抢位置）。
 */

/** 离参考线 6 个屏幕像素以内就吸过去：和常见设计软件的手感接近；按缩放换算成毫米，放大后吸得更准。 */
export const SNAP_DISTANCE_PX = 6;

/** 一条参考线：axis 为 x 时是竖线（位置是 x），为 y 时是横线。 */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

/** 能吸附的位置（mm）。 */
export interface SnapTargets {
  x: readonly number[];
  y: readonly number[];
}

export interface Snapped {
  box: Box;
  guides: Guide[];
}

/** 吸附距离：屏幕上的 SNAP_DISTANCE_PX 在这个缩放下是多少毫米。 */
export function snapThresholdMm(zoom: number): number {
  return pxToMm(SNAP_DISTANCE_PX, zoom);
}

/** 吸附目标：纸边、安全区、纸的中线，以及没在动的元素的边和中线。 */
export function snapTargets(paper: PaperSize, others: readonly Box[]): SnapTargets {
  const margin = CANVAS_LIMITS.safeMarginMm;
  return {
    x: [
      0,
      margin,
      paper.widthMm / 2,
      paper.widthMm - margin,
      paper.widthMm,
      ...others.flatMap((box) => [box.x, box.x + box.width / 2, box.x + box.width]),
    ],
    y: [
      0,
      margin,
      paper.heightMm / 2,
      paper.heightMm - margin,
      paper.heightMm,
      ...others.flatMap((box) => [box.y, box.y + box.height / 2, box.y + box.height]),
    ],
  };
}

interface Match {
  delta: number;
  at: number;
}

/** 在 edges（框上的几个位置）里找离某条参考线最近的一对；距离超过 threshold 不算。 */
function nearest(edges: readonly number[], targets: readonly number[], threshold: number): Match | null {
  let best: Match | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: target };
      }
    }
  }
  return best;
}

/** 移动时吸附：框的左边、中线、右边（上、中、下）离参考线够近就整个框挪过去。 */
export function snapMove(box: Box, targets: SnapTargets, threshold: number): Snapped {
  const x = nearest([box.x, box.x + box.width / 2, box.x + box.width], targets.x, threshold);
  const y = nearest([box.y, box.y + box.height / 2, box.y + box.height], targets.y, threshold);
  const guides: Guide[] = [];
  if (x !== null) {
    guides.push({ axis: 'x', at: x.at });
  }
  if (y !== null) {
    guides.push({ axis: 'y', at: y.at });
  }
  return { box: { ...box, x: box.x + (x?.delta ?? 0), y: box.y + (y?.delta ?? 0) }, guides };
}

/** 缩放时吸附：只吸正在拖的那条（那两条）边，对边不动。 */
export function snapResize(box: Box, handle: ResizeHandle, targets: SnapTargets, threshold: number): Snapped {
  let { x, y, width, height } = box;
  const guides: Guide[] = [];
  if (handle.includes('w')) {
    const match = nearest([x], targets.x, threshold);
    if (match !== null) {
      x += match.delta;
      width -= match.delta;
      guides.push({ axis: 'x', at: match.at });
    }
  } else if (handle.includes('e')) {
    const match = nearest([x + width], targets.x, threshold);
    if (match !== null) {
      width += match.delta;
      guides.push({ axis: 'x', at: match.at });
    }
  }
  if (handle.includes('n')) {
    const match = nearest([y], targets.y, threshold);
    if (match !== null) {
      y += match.delta;
      height -= match.delta;
      guides.push({ axis: 'y', at: match.at });
    }
  } else if (handle.includes('s')) {
    const match = nearest([y + height], targets.y, threshold);
    if (match !== null) {
      height += match.delta;
      guides.push({ axis: 'y', at: match.at });
    }
  }
  return { box: { x, y, width, height }, guides };
}
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/renderer/src/lib/canvas-snap.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/canvas-snap.ts src/renderer/src/lib/canvas-snap.test.ts
git commit -m "feat(renderer): snap canvas elements to the paper, the safe area and each other" -m "Moving snaps the nearest edge or centre line; resizing snaps only the dragged edges. The snap distance is six screen pixels at any zoom, and the matched lines are returned so the canvas can draw guides." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 6: 表格的行列

**Files:**
- Create: `src/renderer/src/lib/canvas-table.ts`
- Create: `src/renderer/src/lib/canvas-table.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/canvas-table.test.ts
import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS, type CanvasTable, newCanvasElement } from '../../../core/templates/canvas-model';
import {
  addTableColumn,
  addTableRow,
  lastColumnMm,
  lastRowMm,
  NEW_COLUMN_MM,
  NEW_ROW_MM,
  removeTableColumn,
  removeTableRow,
  setColumnMm,
  setRowMm,
  updateTableCell,
} from './canvas-table';

const PAPER = { widthMm: 60, heightMm: 40 };

/** 默认的新表格：36×12mm，两行（6mm + 剩下的）两列（12mm + 剩下的）。 */
function table(): CanvasTable {
  const element = newCanvasElement('table', 't', PAPER);
  if (element.kind !== 'table') {
    throw new Error('expected a table');
  }
  return element;
}

describe('table sizes', () => {
  test('the last row and column take what is left', () => {
    expect(lastRowMm(table())).toBe(6);
    expect(lastColumnMm(table())).toBe(24);
  });

  test('adding a row fixes the old last row and grows the table by the new row', () => {
    const grown = addTableRow(table());
    expect(grown.rowsMm).toEqual([6, 6, 0]);
    expect(grown.height).toBe(12 + NEW_ROW_MM);
    expect(grown.cells).toHaveLength(3);
    expect(grown.cells[2]?.map((cell) => cell.text)).toEqual(['', '']);
  });

  test('removing the last row shrinks the table by that row', () => {
    expect(removeTableRow(addTableRow(table()))).toMatchObject({ rowsMm: [6, 6], height: 12 });
    const single = removeTableRow(table());
    expect(single).toMatchObject({ rowsMm: [6], height: 6 });
    expect(single.cells).toHaveLength(1);
    expect(removeTableRow(single)).toBe(single);
  });

  test('adds and removes columns in every row', () => {
    const wide = addTableColumn(table());
    expect(wide.columnsMm).toEqual([12, 24, 0]);
    expect(wide.width).toBe(36 + NEW_COLUMN_MM);
    expect(wide.cells.every((row) => row.length === 3)).toBe(true);
    const narrow = removeTableColumn(table());
    expect(narrow).toMatchObject({ columnsMm: [12], width: 12 });
    expect(narrow.cells.every((row) => row.length === 1)).toBe(true);
  });

  test('stops at the row and column limits', () => {
    const tall = { ...table(), rowsMm: Array.from({ length: CANVAS_LIMITS.tableRows }, () => 1) };
    expect(addTableRow(tall)).toBe(tall);
    const wide = { ...table(), columnsMm: Array.from({ length: CANVAS_LIMITS.tableColumns }, () => 1) };
    expect(addTableColumn(wide)).toBe(wide);
  });

  test('changes one row height or column width', () => {
    expect(setRowMm(table(), 0, 8).rowsMm).toEqual([8, 0]);
    expect(setColumnMm(table(), 0, 15).columnsMm).toEqual([15, 0]);
  });
});

describe('table cells', () => {
  test('changes one cell and keeps the rest', () => {
    const next = updateTableCell(table(), 1, 1, { bold: true });
    expect(next.cells[1]?.[1]).toMatchObject({ text: '{尺码}', bold: true });
    expect(next.cells[0]).toEqual(table().cells[0]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/canvas-table.test.ts`
Expected: FAIL，`Cannot find module './canvas-table'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/canvas-table.ts
import {
  CANVAS_LIMITS,
  type CanvasTable,
  type CanvasTableCell,
  DEFAULT_TABLE_CELL,
} from '../../../core/templates/canvas-model';
import { roundMm } from './canvas-edit';

/**
 * 表格的行和列：模型里最后一行、最后一列「占剩下的」，所以在末尾加一行时，原来的最后一行先改成固定高度
 * （它现在的实际高度），表格加高一行；删最后一行时表格减掉那一行。这样加减行列都不会挤压别的行。
 */

/** 新加的一行高 5mm、一列宽 12mm：放得下默认 2.8mm 的字和两三个汉字。 */
export const NEW_ROW_MM = 5;
export const NEW_COLUMN_MM = 12;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function newCell(): CanvasTableCell {
  return { ...DEFAULT_TABLE_CELL };
}

/** 最后一行实际的高：表格高减去前面几行。 */
export function lastRowMm(table: CanvasTable): number {
  return roundMm(Math.max(0, table.height - sum(table.rowsMm.slice(0, -1))));
}

/** 最后一列实际的宽。 */
export function lastColumnMm(table: CanvasTable): number {
  return roundMm(Math.max(0, table.width - sum(table.columnsMm.slice(0, -1))));
}

/** 在末尾加一行；已到行数上限时原样返回。 */
export function addTableRow(table: CanvasTable): CanvasTable {
  if (table.rowsMm.length >= CANVAS_LIMITS.tableRows) {
    return table;
  }
  return {
    ...table,
    height: roundMm(table.height + NEW_ROW_MM),
    rowsMm: [...table.rowsMm.slice(0, -1), lastRowMm(table), 0],
    cells: [...table.cells, table.columnsMm.map(newCell)],
  };
}

/** 删掉最后一行，表格减去它的高度；只剩一行时原样返回。 */
export function removeTableRow(table: CanvasTable): CanvasTable {
  if (table.rowsMm.length <= 1) {
    return table;
  }
  const rowsMm = table.rowsMm.slice(0, -1);
  return {
    ...table,
    height: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, sum(rowsMm))),
    rowsMm,
    cells: table.cells.slice(0, -1),
  };
}

/** 在末尾加一列；已到列数上限时原样返回。 */
export function addTableColumn(table: CanvasTable): CanvasTable {
  if (table.columnsMm.length >= CANVAS_LIMITS.tableColumns) {
    return table;
  }
  return {
    ...table,
    width: roundMm(table.width + NEW_COLUMN_MM),
    columnsMm: [...table.columnsMm.slice(0, -1), lastColumnMm(table), 0],
    cells: table.cells.map((row) => [...row, newCell()]),
  };
}

/** 删掉最后一列，表格减去它的宽度；只剩一列时原样返回。 */
export function removeTableColumn(table: CanvasTable): CanvasTable {
  if (table.columnsMm.length <= 1) {
    return table;
  }
  const columnsMm = table.columnsMm.slice(0, -1);
  return {
    ...table,
    width: roundMm(Math.max(CANVAS_LIMITS.minSizeMm, sum(columnsMm))),
    columnsMm,
    cells: table.cells.map((row) => row.slice(0, -1)),
  };
}

/** 改一行的高（最后一行不用改：它占剩下的）。 */
export function setRowMm(table: CanvasTable, index: number, mm: number): CanvasTable {
  return { ...table, rowsMm: table.rowsMm.map((size, row) => (row === index ? mm : size)) };
}

/** 改一列的宽。 */
export function setColumnMm(table: CanvasTable, index: number, mm: number): CanvasTable {
  return { ...table, columnsMm: table.columnsMm.map((size, column) => (column === index ? mm : size)) };
}

/** 改一格（文字、字号、加粗、对齐），其余格子不变。 */
export function updateTableCell(
  table: CanvasTable,
  row: number,
  column: number,
  patch: Partial<CanvasTableCell>,
): CanvasTable {
  return {
    ...table,
    cells: table.cells.map((cells, r) =>
      r === row ? cells.map((cell, c) => (c === column ? { ...cell, ...patch } : cell)) : cells,
    ),
  };
}
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/renderer/src/lib/canvas-table.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/canvas-table.ts src/renderer/src/lib/canvas-table.test.ts
git commit -m "feat(renderer): add and remove rows and columns of canvas tables" -m "The last row and column take what is left, so adding one first fixes the old last row at its current size and grows the table; removing one shrinks the table by that row. Other rows never get squeezed." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 7: 图片转灰度像素和大小上限

**Files:**
- Create: `src/renderer/src/lib/gray-image.ts`
- Create: `src/renderer/src/lib/gray-image.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/gray-image.test.ts
import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS, type CanvasElement, newCanvasElement } from '../../../core/templates/canvas-model';
import { decodeGray } from '../../../core/templates/mono-image';
import { bytesToBase64, fitPixelBudget, fitsTemplateBudget, imageBytesUsed, rgbaToGray } from './gray-image';

const PAPER = { widthMm: 60, heightMm: 40 };

/** 指定像素尺寸的图片元素。只算字节数的用例用不到像素内容，留空省时间。 */
function image(id: string, pixelWidth: number, pixelHeight: number): CanvasElement {
  const base = newCanvasElement('image', id, PAPER);
  return base.kind === 'image' ? { ...base, pixelWidth, pixelHeight, pixels: '' } : base;
}

describe('rgbaToGray', () => {
  test('weighs the colour channels like a printer driver does', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect(rgbaToGray(rgba, 3, 1)).toEqual(new Uint8Array([255, 0, 76]));
  });

  test('treats transparent pixels as white paper', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]);
    expect(rgbaToGray(rgba, 2, 1)).toEqual(new Uint8Array([255, 127]));
  });
});

describe('fitPixelBudget', () => {
  test('keeps an image that already fits', () => {
    expect(fitPixelBudget(100, 50, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels)).toEqual({
      width: 100,
      height: 50,
    });
  });

  test('shrinks a large photo to the pixel budget keeping its shape', () => {
    const size = fitPixelBudget(2000, 1000, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels);
    expect(size).toEqual({ width: 1448, height: 724 });
    expect(size.width * size.height).toBeLessThanOrEqual(CANVAS_LIMITS.imageBytes);
  });

  test('limits the longest side of a very thin image', () => {
    expect(fitPixelBudget(10000, 10, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels)).toEqual({
      width: 4000,
      height: 4,
    });
  });
});

describe('bytesToBase64', () => {
  test('encodes gray pixels that the template decoder reads back', () => {
    const pixels = new Uint8Array([0, 128, 255, 7]);
    expect(decodeGray(bytesToBase64(pixels), 2, 2)?.pixels).toEqual(pixels);
  });

  test('encodes a megabyte without running out of stack', () => {
    const pixels = new Uint8Array(CANVAS_LIMITS.imageBytes).fill(200);
    expect(atob(bytesToBase64(pixels)).length).toBe(CANVAS_LIMITS.imageBytes);
  });
});

describe('template image budget', () => {
  test('adds up the gray pixels of every image except the one being replaced', () => {
    const elements = [image('a', 20, 10), image('b', 5, 5), newCanvasElement('text', 't', PAPER)];
    expect(imageBytesUsed(elements, null)).toBe(225);
    expect(imageBytesUsed(elements, 'a')).toBe(25);
  });

  test('refuses an image that would take the template over its limit', () => {
    // 3MB 的一张，再放 1MB 正好到 4MB 的上限。
    const big = image('a', 2048, 1536);
    expect(fitsTemplateBudget([big], null, CANVAS_LIMITS.imageBytes)).toBe(true);
    expect(fitsTemplateBudget([big], null, CANVAS_LIMITS.imageBytes + 1)).toBe(false);
    expect(fitsTemplateBudget([big], 'a', CANVAS_LIMITS.imageBytes + 1)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/gray-image.test.ts`
Expected: FAIL，`Cannot find module './gray-image'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/gray-image.ts
import { CANVAS_LIMITS, type CanvasElement } from '../../../core/templates/canvas-model';

/**
 * 设计器插入图片的纯计算部分：RGBA → 8 位灰度、存进模板的像素尺寸、base64。
 * 解码图片文件在 view-models/use-image-import.ts（页面里，sandbox）；主进程只拿到灰度像素，不解码图片文件。
 */

/** Rec. 601 亮度权重：打印机驱动和大多数图片软件转灰度用的就是它。 */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
/** 8 位灰度里的白（也是 alpha 的最大值）。 */
const WHITE = 255;
const RGBA_CHANNELS = 4;
/** 一次交给 String.fromCharCode 的字节数：参数太多会爆栈（一张 1MB 的图有一百多万个字节）。 */
const BASE64_CHUNK_BYTES = 0x8000;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/** 选图时文件最大 20MB：手机照片一般 3–8MB；再大的文件解码要占几百 MB 内存，界面会卡住。 */
export const MAX_IMAGE_FILE_BYTES = 20 * BYTES_PER_MEGABYTE;

/** RGBA（逐行）→ 8 位灰度（0 黑 – 255 白）。透明的地方当作白纸：透明底的 Logo 不能印成一块黑。 */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * RGBA_CHANNELS;
    const luma =
      LUMA_RED * (rgba[offset] ?? WHITE) + LUMA_GREEN * (rgba[offset + 1] ?? WHITE) + LUMA_BLUE * (rgba[offset + 2] ?? WHITE);
    const alpha = (rgba[offset + 3] ?? WHITE) / WHITE;
    gray[index] = Math.round(luma * alpha + WHITE * (1 - alpha));
  }
  return gray;
}

/** 存进模板的像素尺寸：等比缩小到不超过 maxPixels 个像素、每边不超过 maxSide；本来就够小的不放大。 */
export function fitPixelBudget(
  width: number,
  height: number,
  maxPixels: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxSide / width, maxSide / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** 字节 → base64（分段拼，避免爆栈）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** 模板里的图片一共占多少字节（灰度像素，一个像素一个字节）；exceptId 那张不算（换图时算换掉以后的）。 */
export function imageBytesUsed(elements: readonly CanvasElement[], exceptId: string | null): number {
  return elements.reduce(
    (total, element) =>
      element.kind === 'image' && element.id !== exceptId ? total + element.pixelWidth * element.pixelHeight : total,
    0,
  );
}

/** 再放一张 bytes 字节的图，整个模板的图片还在上限以内吗（超了 sanitize-canvas 会把它丢掉，所以插入前就拦住）。 */
export function fitsTemplateBudget(elements: readonly CanvasElement[], exceptId: string | null, bytes: number): boolean {
  return imageBytesUsed(elements, exceptId) + bytes <= CANVAS_LIMITS.templateImageBytes;
}

/** 提示里说的上限：字节换成 MB。 */
export function megabytes(bytes: number): number {
  return bytes / BYTES_PER_MEGABYTE;
}
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/renderer/src/lib/gray-image.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/gray-image.ts src/renderer/src/lib/gray-image.test.ts
git commit -m "feat(renderer): turn picked images into gray pixels within the size limits" -m "Transparent areas become white paper, large photos shrink to the per-image pixel budget, and an image that would take the template over its total is refused before insertion instead of being dropped silently by the sanitizer." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 8: 新建空白的自由设计模板

**Files:**
- Modify: `src/core/templates/template-catalog.ts`
- Modify: `src/core/templates/templates.test.ts`（`describe('TemplateCatalog')` 里加用例）
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/view-models/use-templates.ts`

- [ ] **Step 1: 写测试**

`templates.test.ts` 第 8 行改成：

```ts
import { NEW_CANVAS_TEMPLATE_NAME, TemplateCatalog, TemplateError } from './template-catalog';
```

`describe('TemplateCatalog', ...)` 里 `'duplicate creates an editable custom copy'` 之后加：

```ts
  test('createCanvas saves an empty canvas template on the default paper', () => {
    const { catalog, repository } = createCatalog();
    const created = catalog.createCanvas();
    expect(created).toEqual({
      kind: 'canvas',
      id: `${CUSTOM_TEMPLATE_PREFIX}t1`,
      name: NEW_CANVAS_TEMPLATE_NAME,
      paper: { widthMm: 60, heightMm: 40 },
      printer: null,
      elements: [],
    });
    expect(repository.saved.get(created.id)).toEqual(created);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/templates.test.ts`
Expected: FAIL（`NEW_CANVAS_TEMPLATE_NAME` 没有导出 / `createCanvas` 不存在）。

- [ ] **Step 3: 实现 `createCanvas`**

`template-catalog.ts` 文件头的 import 改成：

```ts
import { DEFAULT_PAPER } from '../../shared/label-paper';
import { BUILT_IN_TEMPLATES, currentTemplateId, GENERIC_TEMPLATE } from './builtin-templates';
import type { CanvasTemplate } from './canvas-model';
import { sanitizeTemplate } from './sanitize-template';
import { CUSTOM_TEMPLATE_PREFIX, isBuiltInTemplateId, type LabelTemplate, TEMPLATE_LIMITS } from './template-model';
```

`export type TemplateErrorCode` 之前加：

```ts
/** 新建的自由设计模板的名字：进了设计器在右栏「模板」里改。 */
export const NEW_CANVAS_TEMPLATE_NAME = '新的自由设计';
```

`duplicate` 方法之后加：

```ts
  /** 新建空白的自由设计模板（默认纸张、没有元素），存成自定义模板，接着在设计器里编辑。 */
  createCanvas(): CanvasTemplate {
    const template: CanvasTemplate = {
      kind: 'canvas',
      id: `${CUSTOM_TEMPLATE_PREFIX}${this.createId()}`,
      name: NEW_CANVAS_TEMPLATE_NAME,
      paper: { ...DEFAULT_PAPER },
      printer: null,
      elements: [],
    };
    this.repository.save(template);
    return template;
  }
```

- [ ] **Step 4: 跑测试通过**

Run: `bun test src/core/templates/templates.test.ts`
Expected: PASS。

- [ ] **Step 5: IPC 通道**（按 `src/main/CLAUDE.md` 的顺序）

`src/shared/ipc-contract.ts`：

1. 文件头 import 区（`LabelTemplate` 那行之前）加 `import type { CanvasTemplate } from '../core/templates/canvas-model';`
2. `IpcChannel` 里 `DuplicateTemplate: 'templates:duplicate',` 之后加 `CreateCanvasTemplate: 'templates:create-canvas',`
3. `LabelFlashApi` 里 `duplicateTemplate(sourceId: string): Promise<LabelTemplate>;` 之后加：

```ts
  /** 新建空白的自由设计模板（默认纸张），返回它；没有参数，页面不能指定内容。 */
  createCanvasTemplate(): Promise<CanvasTemplate>;
```

`src/main/ipc.ts`：`handle(IpcChannel.DuplicateTemplate, ...)` 那一行之后加：

```ts
  // 没有参数：主进程自己建空白模板，页面传不进任何内容（新通道只给最小能力）。
  handle(IpcChannel.CreateCanvasTemplate, () => deps.templates.createCanvas());
```

`src/preload/index.ts`：`duplicateTemplate: ...` 那一行之后加：

```ts
  createCanvasTemplate: () => ipcRenderer.invoke(IpcChannel.CreateCanvasTemplate),
```

- [ ] **Step 6: 视图模型**

`src/renderer/src/view-models/use-templates.ts`：`const duplicate = useCallback(...)` 之后加：

```ts
  /** 新建空白的自由设计模板：选中它，直接进设计器。 */
  const createCanvas = useCallback(async () => {
    try {
      const created = await window.api.createCanvasTemplate();
      await load();
      setSelectedId(created.id);
      setDraft(structuredClone(created));
    } catch (error) {
      reportError('新建自由设计模板', error);
    }
  }, [load]);
```

返回对象里 `duplicate,` 之后加 `createCanvas,`。

- [ ] **Step 7: `bun run check` 后提交**

Run: `bun run check`
Expected: 通过（界面还没用到 `createCanvas`，Task 15 接上）。

```bash
git add src/core/templates/template-catalog.ts src/core/templates/templates.test.ts src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/view-models/use-templates.ts
git commit -m "feat(templates): create a blank canvas template" -m "Starting a design from nothing is more direct than copying the sample tag and deleting its elements. The new channel takes no arguments: the main process builds the empty template on the default paper." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 9: 打印一张试试

**Files:**
- Modify: `src/core/print-service.ts`（`printTest` 之后加 `printSample`）
- Modify: `src/core/print-service.test.ts`（文件末尾加 describe）
- Modify: `src/renderer/src/lib/status-text.ts`、`status-text.test.ts`
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts`
- Modify: `src/renderer/src/view-models/use-templates.ts`

- [ ] **Step 1: 写测试（core）**

`print-service.test.ts` 末尾加：

```ts
describe('PrintService.printSample', () => {
  const draft: LabelTemplate = { ...PICK_TEMPLATE, id: 'custom:draft' };

  test('prints the draft with the enriched scan, without recording it or holding the dedup window', async () => {
    const { service, adapter, store, useEnrich } = createHarness();
    useEnrich(withShelf);
    expect((await service.printSample(RAW, draft)).status).toBe('printed');
    expect((await service.printSample(RAW, draft)).status).toBe('printed');
    expect(adapter.printed.map((job) => job.templateId)).toEqual(['custom:draft', 'custom:draft']);
    expect(adapter.printed[0]?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
    expect(store.listRecent(10)).toEqual([]);
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('reports content it cannot recognise', async () => {
    const { service, adapter } = createHarness();
    expect(await service.printSample('   ', draft)).toEqual({ status: 'invalid', reason: 'INVALID_CONTENT' });
    expect(adapter.printed).toEqual([]);
  });

  test('does not print when the paper of the draft has no printer', async () => {
    const { service, adapter, useChoice } = createHarness();
    useChoice({ printerName: null, reason: 'unassigned', paperKey: '60x40', missingPrinter: null });
    expect(await service.printSample(RAW, draft)).toEqual({ status: 'no-printer', paperKey: '60x40', missingPrinter: null });
    expect(adapter.printed).toEqual([]);
  });

  test('stops like a real print when a blocking lookup fails', async () => {
    const { service, adapter, useEnrich } = createHarness();
    useEnrich(lookupFails);
    expect(await service.printSample(RAW, draft)).toEqual({
      status: 'failed',
      reason: 'LOOKUP_FAILED',
      detail: '查询超时',
    });
    expect(adapter.printed).toEqual([]);
  });

  test('reports printer failures', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_FOUND'));
    expect(await service.printSample(RAW, draft)).toEqual({ status: 'failed', reason: 'PRINTER_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: 写测试（界面文字）**

`status-text.test.ts` 的 `from './status-text'` import 里按顺序加 `describeNoPrinter`（`describeJobStatus` 之后）和 `describeSamplePrint`（`describeResult` 之后），文件末尾加：

```ts
describe('describeSamplePrint', () => {
  test('says the sample was sent, with the first fields', () => {
    expect(describeSamplePrint({ status: 'printed', jobId: 'sample', scan: SCAN }, NOW)).toEqual({
      tone: 'info',
      message: '已发送打印：CL5640-TK · 图片色 · XL',
    });
  });

  test('says which paper has no printer', () => {
    const view = describeNoPrinter('60x40', null);
    expect(describeSamplePrint({ status: 'no-printer', paperKey: '60x40', missingPrinter: null }, NOW)).toEqual({
      tone: 'warning',
      message: `${view.title}：${view.detail}`,
    });
  });

  test('reports a printer failure as an error', () => {
    expect(describeSamplePrint({ status: 'failed', reason: 'PRINTER_NOT_FOUND' }, NOW)).toEqual({
      tone: 'error',
      message: '找不到打印机：系统里找不到这台打印机，刷新打印机列表后重新选择',
    });
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/print-service.test.ts src/renderer/src/lib/status-text.test.ts`
Expected: FAIL（`printSample`、`describeSamplePrint` 不存在）。

- [ ] **Step 4: 实现 `PrintService.printSample`**

`print-service.ts` 里 `/** 超时说明结果不确定（可能已出纸或仍在排队）：按已打印处理，避免重扫出第二张；确认没出纸再强制补打。 */` 那一行之前加：

```ts
  /**
   * 模板页「打印一张试试」：按预览内容和正在编辑的草稿打一张，看实际出纸的效果。
   * 和预览一样识别、加工（看到的就是打出来的），加工步骤设为拦下的查询失败时和正式打印一样不打；
   * 按草稿的纸张和打印机设置选打印机。不占防重复窗口、不写打印记录：这是在调模板，不是业务打印。
   */
  async printSample(raw: string, template: LabelTemplate): Promise<PrintResult> {
    const preview = await this.preview(raw);
    if (preview.status !== 'ok') {
      return preview;
    }
    if (preview.lookupFailure !== null) {
      return { status: 'failed', reason: 'LOOKUP_FAILED', detail: preview.lookupFailure };
    }
    const choice = await this.deps.choosePrinter(template);
    if (choice.printerName === null) {
      return { status: 'no-printer', paperKey: choice.paperKey, missingPrinter: choice.missingPrinter };
    }
    const printerName = choice.printerName;
    const { scan } = preview;
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(scan, template), signal),
      );
      // 不写记录，没有记录编号：和测试页一样给一个固定的说明性编号。
      return { status: 'printed', jobId: 'sample', scan };
    } catch (error) {
      console.error('[PrintService] sample print failed', error);
      return failed(toPrintFailure(error));
    }
  }
```

- [ ] **Step 5: 实现界面文字**

`status-text.ts` 文件头加 `import type { NoticeTone } from './notices';`（放在 `./app-view` 那行之后），`describeNoPrinter` 之后加：

```ts
/** 「打印一张试试」的结果：用提示条说，用词和状态条一致（成功是「已发送打印」，不说「打印成功」）。 */
export function describeSamplePrint(result: PrintResult, now: number): { tone: NoticeTone; message: string } {
  const view = describeResult(result, now);
  const tone: NoticeTone = view.tone === 'success' ? 'info' : view.tone;
  return { tone, message: view.detail === '' ? view.title : `${view.title}：${view.detail}` };
}
```

- [ ] **Step 6: 跑测试通过**

Run: `bun test src/core/print-service.test.ts src/renderer/src/lib/status-text.test.ts`
Expected: PASS。

- [ ] **Step 7: IPC 通道和视图模型**

`src/shared/ipc-contract.ts`：`IpcChannel` 里 `Print: 'label:print',` 之后加 `PrintSample: 'label:print-sample',`；`LabelFlashApi` 里 `printTest(...)` 之后加：

```ts
  /** 模板页「打印一张试试」：按预览内容打印没保存的草稿；不写打印记录、不占防重复窗口。 */
  printSample(raw: string, template: LabelTemplate): Promise<PrintResult>;
```

`src/main/ipc.ts`：`handle(IpcChannel.PrintTest, ...)` 那三行之后加：

```ts
  // 「打印一张试试」：草稿和预览一样先校验（不可信的输入），再按预览内容打一张。
  handle(IpcChannel.PrintSample, (raw, template) =>
    deps.service.printSample(
      requireRaw(raw),
      sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, GENERIC_TEMPLATE),
    ),
  );
```

`src/preload/index.ts`：`printTest: ...` 那一行之后加：

```ts
  printSample: (raw, template) => ipcRenderer.invoke(IpcChannel.PrintSample, raw, template),
```

`src/renderer/src/view-models/use-templates.ts`：文件头加 `import { describeSamplePrint } from '../lib/status-text';`（`../lib/notices` 之后）；`saveDraft` 之后加：

```ts
  /** 「打印一张试试」：按预览内容打印草稿，结果用提示条说。 */
  const printSample = useCallback(
    async (raw: string) => {
      if (!draft) {
        return;
      }
      try {
        const notice = describeSamplePrint(await window.api.printSample(raw, draft), Date.now());
        notices.push(notice.tone, notice.message);
      } catch (error) {
        reportError('打印一张试试', error);
      }
    },
    [draft],
  );
```

返回对象里 `saveDraft,` 之后加 `printSample,`。

- [ ] **Step 8: `bun run check` 后提交**

```bash
git add src/core/print-service.ts src/core/print-service.test.ts src/renderer/src/lib/status-text.ts src/renderer/src/lib/status-text.test.ts src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/view-models/use-templates.ts
git commit -m "feat(print): print one sample of the template being edited" -m "Designing a label needs a look at real paper before saving. The sample uses the preview content and the unsaved draft, is recognised and enriched like the preview, and is neither recorded nor held by the duplicate window because it is template tuning, not a business print." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 10: 设计器状态和图片导入（视图模型）

**Files:**
- Create: `src/renderer/src/view-models/use-canvas-designer.ts`
- Create: `src/renderer/src/view-models/use-image-import.ts`

视图模型调 DOM 和 React，不写单元测试（行为在 lib 里测过，接线由 Task 16 的 E2E 覆盖）。

- [ ] **Step 1: `use-canvas-designer.ts`**

```ts
// src/renderer/src/view-models/use-canvas-designer.ts
import { useMemo, useState } from 'react';
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasElementKind,
  type CanvasTemplate,
} from '../../../core/templates/canvas-model';
import {
  type Alignment,
  addElement,
  alignElements,
  bringToFront,
  copyElements,
  type DistributeAxis,
  deleteElements,
  distributeElements,
  MIN_DISTRIBUTE_COUNT,
  moveBy,
  type Point,
  pasteElements,
  sendToBack,
} from '../lib/canvas-edit';
import {
  emptyHistory,
  type History,
  record,
  redo as redoStep,
  type Stepped,
  undo as undoStep,
} from '../lib/canvas-history';
import type { DesignerCommand } from '../lib/canvas-view';
import { deepEqual } from '../lib/deep-equal';
import { notices } from '../lib/notices';

/** 缩放：「适合窗口」随窗口大小变，或者固定的倍数。 */
export type ZoomSetting = 'fit' | number;

interface CanvasDesignerOptions {
  /** 模板页的草稿（use-templates）：设计器不另存一份。 */
  draft: CanvasTemplate;
  onChange: (next: CanvasTemplate) => void;
}

/** 元素到上限时的提示：说清上限和下一步。 */
const ELEMENT_LIMIT_NOTICE = `一个模板最多 ${CANVAS_LIMITS.elements} 个元素：先删掉不用的再加`;

/**
 * 设计器的状态：选中的元素、撤销历史、设计器自己的剪贴板、缩放、网格和吸附开关。
 * 每次修改都经 commit：先记历史，再交给草稿。剪贴板只在内存里：页面的剪贴板权限一律被拒绝，
 * 也不需要跨程序粘贴元素。
 */
export function useCanvasDesigner({ draft, onChange }: CanvasDesignerOptions) {
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [history, setHistory] = useState<History<CanvasTemplate>>(emptyHistory);
  const [clipboard, setClipboard] = useState<readonly CanvasElement[]>([]);
  const [zoom, setZoom] = useState<ZoomSetting>('fit');
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);

  // 撤销、删除之后，选中的元素可能已经不在了：只留还在的。
  const liveSelection = useMemo(
    () => selection.filter((id) => draft.elements.some((element) => element.id === id)),
    [selection, draft.elements],
  );
  const movableCount = draft.elements.filter((element) => liveSelection.includes(element.id) && !element.locked).length;

  /** 每一次修改都经过这里：先记下改之前的样子（撤销用），再交给草稿；没有变化的不记。 */
  const commit = (next: CanvasTemplate, mergeKey: string | null = null) => {
    if (deepEqual(next, draft)) {
      return;
    }
    setHistory((current) => record(current, draft, mergeKey));
    onChange(next);
  };
  const apply = (stepped: Stepped<CanvasTemplate> | null) => {
    if (stepped !== null) {
      setHistory(stepped.history);
      onChange(stepped.present);
    }
  };
  const undo = () => apply(undoStep(history, draft));
  const redo = () => apply(redoStep(history, draft));

  const add = (kind: CanvasElementKind, center?: Point) => {
    const added = addElement(draft, kind, center);
    if (added === null) {
      notices.push('warning', ELEMENT_LIMIT_NOTICE);
      return;
    }
    commit(added.template);
    setSelection(added.ids);
  };
  const copy = () => {
    if (liveSelection.length > 0) {
      setClipboard(copyElements(draft, liveSelection));
    }
  };
  const paste = () => {
    if (clipboard.length === 0) {
      return;
    }
    const pasted = pasteElements(draft, clipboard);
    if (pasted.ids.length < clipboard.length) {
      notices.push('warning', ELEMENT_LIMIT_NOTICE);
    }
    if (pasted.ids.length === 0) {
      return;
    }
    commit(pasted.template);
    setSelection(pasted.ids);
    // 再粘贴一次从刚贴的这几个往下错开，不和它们叠在一起。
    setClipboard(pasted.template.elements.filter((element) => pasted.ids.includes(element.id)));
  };
  const remove = () => commit(deleteElements(draft, liveSelection));
  // 连续按方向键挪同一组元素算一步撤销。
  const nudge = (dx: number, dy: number) =>
    commit(moveBy(draft, liveSelection, dx, dy), `nudge:${liveSelection.join(',')}`);

  /** 画布上的按键：用掉了返回 true（调用方拦下这个按键）；没用掉（没选中时的方向键、Esc）返回 false。 */
  const runCommand = (command: DesignerCommand): boolean => {
    const hasSelection = liveSelection.length > 0;
    switch (command.kind) {
      case 'undo':
        undo();
        return true;
      case 'redo':
        redo();
        return true;
      case 'paste':
        paste();
        return true;
      case 'copy':
        copy();
        return hasSelection;
      case 'delete':
        remove();
        return hasSelection;
      case 'nudge':
        nudge(command.dx, command.dy);
        return hasSelection;
      case 'deselect':
        setSelection([]);
        return hasSelection;
    }
  };

  return {
    selection: liveSelection,
    select: setSelection,
    commit,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    hasSelection: liveSelection.length > 0,
    canPaste: clipboard.length > 0,
    canDistribute: movableCount >= MIN_DISTRIBUTE_COUNT,
    add,
    copy,
    paste,
    remove,
    align: (alignment: Alignment) => commit(alignElements(draft, liveSelection, alignment)),
    distribute: (axis: DistributeAxis) => commit(distributeElements(draft, liveSelection, axis)),
    toFront: () => commit(bringToFront(draft, liveSelection)),
    toBack: () => commit(sendToBack(draft, liveSelection)),
    runCommand,
    zoom,
    setZoom,
    showGrid,
    setShowGrid,
    snap,
    setSnap,
  };
}

export type CanvasDesignerViewModel = ReturnType<typeof useCanvasDesigner>;
```

- [ ] **Step 2: `use-image-import.ts`**

```ts
// src/renderer/src/view-models/use-image-import.ts
import { useCallback } from 'react';
import { CANVAS_LIMITS, type CanvasElement, type CanvasImage } from '../../../core/templates/canvas-model';
import {
  bytesToBase64,
  fitPixelBudget,
  fitsTemplateBudget,
  MAX_IMAGE_FILE_BYTES,
  megabytes,
  rgbaToGray,
} from '../lib/gray-image';
import { notices, reportError } from '../lib/notices';

/** 选一个图片文件放进这个图片元素：成功返回换了像素的元素；不行时已经提示过，返回 null。 */
export type ImageImporter = (
  file: File,
  image: CanvasImage,
  elements: readonly CanvasElement[],
) => Promise<CanvasImage | null>;

async function readImage(
  file: File,
  image: CanvasImage,
  elements: readonly CanvasElement[],
): Promise<CanvasImage | null> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    notices.push('warning', `图片文件超过 ${megabytes(MAX_IMAGE_FILE_BYTES)}MB：换一张小一点的`);
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    console.warn('[renderer] cannot decode the picked image', file.type, error);
    notices.push('warning', '这个文件不是能识别的图片：请选 PNG、JPEG、BMP、GIF 或 WebP');
    return null;
  }
  try {
    const size = fitPixelBudget(bitmap.width, bitmap.height, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels);
    if (!fitsTemplateBudget(elements, image.id, size.width * size.height)) {
      notices.push(
        'warning',
        `一个模板里的图片加起来最多 ${megabytes(CANVAS_LIMITS.templateImageBytes)}MB：先删掉一张图，或换一张小一点的`,
      );
      return null;
    }
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('OffscreenCanvas has no 2d context');
    }
    // 缩小用高质量插值：照片缩到像素预算以内时不出锯齿和摩尔纹。
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const { data } = context.getImageData(0, 0, size.width, size.height);
    return {
      ...image,
      pixels: bytesToBase64(rgbaToGray(data, size.width, size.height)),
      pixelWidth: size.width,
      pixelHeight: size.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * 「选择图片」：在这个页面里（sandbox 的渲染进程）把图片文件解码成灰度像素，存进模板。
 * 主进程从不解码图片文件（Chromium 的两条法则：不可信的输入不进高权限进程里的 C++ 解码器），只拿到校验过的灰度像素。
 * 解码交给浏览器：createImageBitmap 解码，OffscreenCanvas 缩到要存的尺寸并取出 RGBA。
 */
export function useImageImport(): ImageImporter {
  return useCallback(async (file, image, elements) => {
    try {
      return await readImage(file, image, elements);
    } catch (error) {
      reportError('读取图片', error);
      return null;
    }
  }, []);
}
```

- [ ] **Step 3: `bun run check`**

Expected: 通过（还没有组件用到它们）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/view-models/use-canvas-designer.ts src/renderer/src/view-models/use-image-import.ts
git commit -m "feat(renderer): designer state and image import" -m "The designer keeps selection, undo history, its own clipboard, zoom and the grid and snap switches; every change goes through one commit that records history before updating the draft. Picked images are decoded in the sandboxed page and stored as gray pixels, so the main process never decodes image files." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 11: 画布上的鼠标操作（视图模型）

**Files:**
- Create: `src/renderer/src/view-models/use-canvas-gesture.ts`

- [ ] **Step 1: 实现**

```ts
// src/renderer/src/view-models/use-canvas-gesture.ts
import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import {
  type Box,
  boundsOf,
  boxOf,
  clampBox,
  elementsInRect,
  moveBy,
  type Point,
  RESIZE_HANDLES,
  type ResizeHandle,
  rectFromPoints,
  resizeBox,
  roundTo,
  setBox,
  toggleId,
} from '../lib/canvas-edit';
import { type Guide, type Snapped, snapMove, snapResize, snapTargets, snapThresholdMm } from '../lib/canvas-snap';
import { pxToMm } from '../lib/canvas-view';

/** 按下后挪动不到 3 个屏幕像素算点击，不算拖动：手抖不该把元素挪走半毫米。 */
const DRAG_START_PX = 3;
/** 拖动的位移取整到 0.1mm（和方向键一步一样），数字框里不会出现 12.37；吸附上的位置以参考线为准。 */
const DRAG_STEP_MM = 0.1;

interface Pressed {
  /** 按下时指针的屏幕位置：算拖了多远、是不是真的拖了。 */
  client: Point;
  hasMoved: boolean;
}

interface MoveGesture extends Pressed {
  kind: 'move';
  /** 跟着动的元素（选中的、没锁定的）。 */
  ids: readonly string[];
  /** 这些元素合起来的外框：按下时的、现在的。 */
  start: Box;
  box: Box;
  guides: readonly Guide[];
}

interface ResizeGesture extends Pressed {
  kind: 'resize';
  id: string;
  handle: ResizeHandle;
  start: Box;
  box: Box;
  guides: readonly Guide[];
}

interface MarqueeGesture extends Pressed {
  kind: 'marquee';
  /** 框选的两个角（纸上的毫米）。 */
  origin: Point;
  current: Point;
  /** 按住 Shift 框选时原来就选中的。 */
  base: readonly string[];
}

type Gesture = MoveGesture | ResizeGesture | MarqueeGesture;

/** 覆盖层上要画的：拖动中的临时框、吸附参考线、框选的范围。模板在松手时才改。 */
export interface GestureView {
  boxes: ReadonlyMap<string, Box>;
  guides: readonly Guide[];
  marquee: Box | null;
}

/** 挂在覆盖层上的指针事件：按在哪个元素、哪个控制点上，看 data-element-id、data-handle。 */
export interface GestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

interface GestureOptions {
  template: CanvasTemplate;
  selection: readonly string[];
  zoom: number;
  snap: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  onSelect: (ids: readonly string[]) => void;
  onCommit: (next: CanvasTemplate) => void;
}

const NO_GESTURE_VIEW: GestureView = { boxes: new Map(), guides: [], marquee: null };

function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return value !== undefined && (RESIZE_HANDLES as readonly string[]).includes(value);
}

function viewOf(gesture: Gesture | null, template: CanvasTemplate): GestureView {
  if (gesture === null || !gesture.hasMoved) {
    return NO_GESTURE_VIEW;
  }
  switch (gesture.kind) {
    case 'move': {
      const dx = gesture.box.x - gesture.start.x;
      const dy = gesture.box.y - gesture.start.y;
      const boxes = new Map<string, Box>();
      for (const element of template.elements) {
        if (gesture.ids.includes(element.id)) {
          boxes.set(element.id, { ...boxOf(element), x: element.x + dx, y: element.y + dy });
        }
      }
      return { boxes, guides: gesture.guides, marquee: null };
    }
    case 'resize':
      return { boxes: new Map([[gesture.id, gesture.box]]), guides: gesture.guides, marquee: null };
    case 'marquee':
      return { boxes: new Map(), guides: [], marquee: rectFromPoints(gesture.origin, gesture.current) };
  }
}

/**
 * 画布上的鼠标操作：点选、Shift 加选、拖动（选中的一起动）、拖控制点缩放、在空白处框选。
 * 拖动中只更新覆盖层上的框和参考线；松手时把结果交给 onCommit，一次拖动是一步撤销。
 * 指针捕获在覆盖层上：拖出画布也不会丢。
 */
export function useCanvasGesture(options: GestureOptions): { view: GestureView; handlers: GestureHandlers } {
  const { template, selection, zoom, snap, overlayRef, onSelect, onCommit } = options;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const { paper } = template;
  const threshold = snapThresholdMm(zoom);

  /** 屏幕位置 → 纸上的毫米（以覆盖层左上角为原点）。 */
  const toPaper = (client: Point): Point => {
    const rect = overlayRef.current?.getBoundingClientRect();
    return { x: pxToMm(client.x - (rect?.left ?? 0), zoom), y: pxToMm(client.y - (rect?.top ?? 0), zoom) };
  };
  /** 吸附目标：纸，和没在动的元素。 */
  const targetsWithout = (ids: readonly string[]) =>
    snapTargets(
      paper,
      template.elements.filter((element) => !ids.includes(element.id)),
    );

  const startMove = (id: string, isAdditive: boolean, pressed: Pressed): Gesture | null => {
    const ids = isAdditive ? toggleId(selection, id) : selection.includes(id) ? selection : [id];
    onSelect(ids);
    // Shift 点了已选中的：只是取消选中它，不拖动。
    if (!ids.includes(id)) {
      return null;
    }
    const moving = template.elements.filter((element) => ids.includes(element.id) && !element.locked);
    const start = boundsOf(moving);
    return start === null
      ? null
      : { ...pressed, kind: 'move', ids: moving.map((element) => element.id), start, box: start, guides: [] };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 只认主键（左键、触屏、笔尖）。
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    const id = target?.closest<HTMLElement>('[data-element-id]')?.dataset['elementId'];
    const element = template.elements.find((candidate) => candidate.id === id);
    const pressed: Pressed = { client: { x: event.clientX, y: event.clientY }, hasMoved: false };
    let next: Gesture | null;
    if (element === undefined) {
      // 点在空白处：不按 Shift 先清空选中（单击空白就是取消选中），再开始框选。
      const base = event.shiftKey ? selection : [];
      onSelect(base);
      const origin = toPaper(pressed.client);
      next = { ...pressed, kind: 'marquee', origin, current: origin, base };
    } else if (isResizeHandle(handle)) {
      next = element.locked
        ? null
        : {
            ...pressed,
            kind: 'resize',
            id: element.id,
            handle,
            start: boxOf(element),
            box: boxOf(element),
            guides: [],
          };
    } else {
      next = startMove(element.id, event.shiftKey, pressed);
    }
    if (next !== null) {
      overlayRef.current?.setPointerCapture(event.pointerId);
      setGesture(next);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture === null) {
      return;
    }
    const dxPx = event.clientX - gesture.client.x;
    const dyPx = event.clientY - gesture.client.y;
    if (!gesture.hasMoved && Math.hypot(dxPx, dyPx) < DRAG_START_PX) {
      return;
    }
    if (gesture.kind === 'marquee') {
      const current = toPaper({ x: event.clientX, y: event.clientY });
      setGesture({ ...gesture, hasMoved: true, current });
      const touched = elementsInRect(template, rectFromPoints(gesture.origin, current));
      onSelect([...new Set([...gesture.base, ...touched])]);
      return;
    }
    const dx = roundTo(pxToMm(dxPx, zoom), DRAG_STEP_MM);
    const dy = roundTo(pxToMm(dyPx, zoom), DRAG_STEP_MM);
    if (gesture.kind === 'move') {
      const moved = { ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy };
      const snapped: Snapped = snap ? snapMove(moved, targetsWithout(gesture.ids), threshold) : { box: moved, guides: [] };
      setGesture({ ...gesture, hasMoved: true, box: clampBox(snapped.box, paper), guides: snapped.guides });
      return;
    }
    const resized = resizeBox(gesture.start, gesture.handle, dx, dy, paper);
    const snapped: Snapped = snap
      ? snapResize(resized, gesture.handle, targetsWithout([gesture.id]), threshold)
      : { box: resized, guides: [] };
    setGesture({ ...gesture, hasMoved: true, box: clampBox(snapped.box, paper), guides: snapped.guides });
  };

  const onPointerUp = () => {
    if (gesture === null) {
      return;
    }
    setGesture(null);
    if (!gesture.hasMoved) {
      return;
    }
    if (gesture.kind === 'move') {
      onCommit(moveBy(template, gesture.ids, gesture.box.x - gesture.start.x, gesture.box.y - gesture.start.y));
    } else if (gesture.kind === 'resize') {
      onCommit(setBox(template, gesture.id, gesture.box));
    }
  };

  return {
    view: viewOf(gesture, template),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => setGesture(null) },
  };
}

/**
 * Ctrl（macOS 上 ⌘）+ 滚轮缩放画布。React 的 onWheel 是被动监听，拦不住页面自己的滚动，所以挂原生监听（passive: false）。
 */
export function useCtrlWheelZoom(ref: RefObject<HTMLElement | null>, onZoom: (direction: 1 | -1) => void): void {
  const latest = useRef(onZoom);
  useEffect(() => {
    latest.current = onZoom;
  });
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      latest.current(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}
```

- [ ] **Step 2: `bun run check`**

Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/view-models/use-canvas-gesture.ts
git commit -m "feat(renderer): drag, resize and marquee gestures on the canvas" -m "While dragging only the overlay boxes and snap guides change; the template is updated once on release, so a drag is one undo step and the real print HTML is laid out again only then. Pointer capture keeps the drag when the pointer leaves the canvas." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 12: 画布组件和设计器的样式

**Files:**
- Create: `src/renderer/src/components/canvas-editor/CanvasStage.tsx`
- Modify: `src/renderer/src/styles/tokens.css`
- Modify: `src/renderer/src/styles/app.css`（在 `/* ── 应用内确认框（原生模态 dialog，浏览器负责居中和置顶） ── */` 之前插入）

- [ ] **Step 1: 组件**

```tsx
// src/renderer/src/components/canvas-editor/CanvasStage.tsx
import type { CSSProperties, DragEvent, KeyboardEvent, RefObject } from 'react';
import {
  CANVAS_ELEMENT_KINDS,
  CANVAS_LIMITS,
  type CanvasElementKind,
  type CanvasTemplate,
} from '../../../../core/templates/canvas-model';
import { type Box, RESIZE_HANDLES } from '../../lib/canvas-edit';
import { ELEMENT_DRAG_TYPE, pxToMm } from '../../lib/canvas-view';
import type { GestureHandlers, GestureView } from '../../view-models/use-canvas-gesture';
import { Ruler } from '../Ruler';

interface CanvasStageProps {
  template: CanvasTemplate;
  /** 和打印相同的 HTML（预览经主进程排版）；还没有、或预览内容识别不了时为 null。 */
  html: string | null;
  placeholder: string;
  zoom: number;
  showGrid: boolean;
  selection: readonly string[];
  gesture: GestureView;
  handlers: GestureHandlers;
  /** 外层滚动区：量「适合窗口」的大小、挂 Ctrl+滚轮。 */
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onDropElement: (kind: CanvasElementKind, center: { x: number; y: number }) => void;
  onEditText: (id: string) => void;
}

/** 框（毫米）→ 覆盖层上的位置：乘以 --mm（随缩放变化的每毫米像素数）。 */
function boxStyle(box: Box): CSSProperties {
  return {
    left: `calc(${box.x} * var(--mm))`,
    top: `calc(${box.y} * var(--mm))`,
    width: `calc(${box.width} * var(--mm))`,
    height: `calc(${box.height} * var(--mm))`,
  };
}

function isElementKind(value: string): value is CanvasElementKind {
  return (CANVAS_ELEMENT_KINDS as readonly string[]).includes(value);
}

/**
 * 画布：软尺、标签（和打印同一份 HTML，放在 sandbox 的 iframe 里）、上面一层透明的覆盖层。
 * 覆盖层画网格、安全区、选框、控制点、吸附参考线和框选；鼠标和键盘都在它上面操作，元素框本身不挂事件
 * （覆盖层按 data-element-id、data-handle 认出按在哪里）。
 */
export function CanvasStage({
  template,
  html,
  placeholder,
  zoom,
  showGrid,
  selection,
  gesture,
  handlers,
  stageRef,
  overlayRef,
  onKeyDown,
  onDropElement,
  onEditText,
}: CanvasStageProps) {
  const { paper } = template;
  const single = selection.length === 1 ? (template.elements.find((element) => element.id === selection[0]) ?? null) : null;

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const kind = event.dataTransfer.getData(ELEMENT_DRAG_TYPE);
    if (!isElementKind(kind)) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDropElement(kind, { x: pxToMm(event.clientX - rect.left, zoom), y: pxToMm(event.clientY - rect.top, zoom) });
  };

  return (
    <div ref={stageRef} className="canvas-stage">
      <div
        className="canvas-stage__bench"
        style={{ '--preview-scale': zoom, '--paper-w': paper.widthMm, '--paper-h': paper.heightMm } as CSSProperties}
      >
        <div className="tape">
          <div className="tape__corner" aria-hidden="true">
            mm
          </div>
          <Ruler orientation="horizontal" lengthMm={paper.widthMm} />
          <Ruler orientation="vertical" lengthMm={paper.heightMm} />
          <div className="label-slot">
            {html ? (
              <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
            ) : (
              <p className="label-placeholder">{placeholder}</p>
            )}
          </div>
          <div
            ref={overlayRef}
            className={showGrid ? 'canvas-overlay canvas-overlay--grid' : 'canvas-overlay'}
            role="application"
            aria-label="画布：方向键移动选中的元素（Shift 加方向键一次 1 毫米），Delete 删除，Ctrl+Z 撤销"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onDoubleClick={() => {
              // 指针被覆盖层捕获，双击事件落在覆盖层上：按刚才点选的元素判断是不是文字。
              if (single?.kind === 'text') {
                onEditText(single.id);
              }
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div
              className="canvas-overlay__safe"
              aria-hidden="true"
              style={{ inset: `calc(${CANVAS_LIMITS.safeMarginMm} * var(--mm))` }}
            />
            {template.elements.map((element) => {
              const classes = [
                'canvas-overlay__box',
                selection.includes(element.id) ? 'canvas-overlay__box--selected' : null,
                element.locked ? 'canvas-overlay__box--locked' : null,
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={element.id}
                  className={classes}
                  data-element-id={element.id}
                  aria-hidden="true"
                  style={boxStyle(gesture.boxes.get(element.id) ?? element)}
                >
                  {single?.id === element.id &&
                    !element.locked &&
                    RESIZE_HANDLES.map((handle) => (
                      <div key={handle} className="canvas-overlay__handle" data-handle={handle} />
                    ))}
                </div>
              );
            })}
            {gesture.guides.map((guide) => (
              <div
                key={`${guide.axis}${guide.at}`}
                className={`canvas-overlay__guide canvas-overlay__guide--${guide.axis}`}
                aria-hidden="true"
                style={
                  guide.axis === 'x'
                    ? { left: `calc(${guide.at} * var(--mm))` }
                    : { top: `calc(${guide.at} * var(--mm))` }
                }
              />
            ))}
            {gesture.marquee && (
              <div className="canvas-overlay__marquee" aria-hidden="true" style={boxStyle(gesture.marquee)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 变量**

`tokens.css`：`--color-error-wash: #f8dedb;` 之后加：

```css
  /* 设计器的选框、控制点和吸附参考线：标签只有黑白，选框用蓝、参考线用洋红才分得清（热敏纸上不会出现这两种颜色） */
  --color-selection: #2563eb;
  --color-guide: #d6336c;
```

`--tester-width: 360px;` 之后加：

```css
  /* 设计器：左边元素栏放得下「二维码」三个字的按钮；右边属性栏放得下标签列和一个数字框 */
  --designer-palette-width: 88px;
  --designer-panel-width: 300px;
  /* 设计器属性栏的标签列：放得下四个字的标签（「放不下时」「号码字号」） */
  --designer-label-width: 64px;
  /* 选中元素的控制点：鼠标好抓，又不至于盖住小元素 */
  --designer-handle-size: 8px;
```

`@media (max-width: 1199px)` 里 `--config-nav-width: 160px;` 之后加：

```css
    /* 1024 宽的窗口里画布还要占一半以上 */
    --designer-panel-width: 260px;
```

- [ ] **Step 3: 样式**（`app.css` 里 `/* ── 应用内确认框（原生模态 dialog，浏览器负责居中和置顶） ── */` 之前插入）

```css
/* ── 模板页 · 自由设计的设计器：上面工具条；左元素、中画布、右属性和图层；下面打印前检查 ── */
.template-editing.template-editing--canvas {
  grid-template-areas:
    "designer"
    "actions";
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
}

.canvas-designer {
  display: grid;
  grid-area: designer;
  grid-template-areas:
    "toolbar toolbar toolbar"
    "palette stage panel"
    "checks checks checks";
  grid-template-columns: var(--designer-palette-width) minmax(0, 1fr) var(--designer-panel-width);
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}

/* 工具条：按组排开，放不下时整组换行，组内的按钮不拆开 */
.designer-toolbar {
  display: flex;
  grid-area: toolbar;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-rule);
  background: var(--color-paper);
}

.designer-toolbar__group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.designer-toolbar__label {
  margin-right: var(--space-1);
  color: var(--color-ink-soft);
  font-size: 12px;
}

/* 开着的开关（网格、吸附、适合窗口）：软尺黄，和导航当前项一致 */
.designer-toolbar .button[aria-pressed="true"] {
  border-color: var(--color-tape);
  background: var(--color-tape-wash);
}

.designer-toolbar__zoom {
  min-width: 4em;
  color: var(--color-ink-soft);
  font: 12px var(--font-data);
  text-align: center;
}

/* 预览内容占工具条剩下的宽度，至少放得下一个编码 */
.designer-toolbar .sample-input {
  flex: 1 1 240px;
  min-width: 200px;
}

.sample-input--compact {
  align-items: center;
  gap: var(--space-2);
}

.sample-input--compact .sample-input__label {
  padding-top: 0;
  font-size: 12px;
}

/* 一行高，和工具条按钮（28px）对齐；多行内容在框里横着滚动，换行照样保留 */
.sample-input--compact .sample-input__field {
  height: 28px;
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
  line-height: 26px;
  white-space: nowrap;
}

/* 左：元素栏 */
.element-palette {
  display: flex;
  grid-area: palette;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  padding: var(--space-3) var(--space-2);
  overflow-y: auto;
  border-right: 1px solid var(--color-rule);
  background: var(--color-paper);
}

.element-palette__item {
  height: 36px;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  color: inherit;
  background: var(--color-field);
  font: inherit;
  font-size: 13px;
  cursor: grab;
}

.element-palette__item:hover {
  border-color: var(--color-ink);
}

.element-palette__item:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 1px;
}

.element-palette__hint {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 11px;
}

/* 中：画布。放大后超出时可以滚动；margin: auto 居中，超出时仍能滚到左上角 */
.canvas-stage {
  display: flex;
  grid-area: stage;
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  overflow: auto;
  background: var(--color-housing);
}

/* --mm、--ruler-depth 和标签预览（.label-preview）同一种算法：软尺、标签和覆盖层按同一个缩放 */
.canvas-stage__bench {
  --mm: calc(3.7795px * var(--preview-scale));
  --ruler-depth: calc(4 * var(--mm));
  margin: auto;
}

/* 覆盖层盖在标签上（同一个格子），接收鼠标和键盘；拖动时不选中页面上的文字 */
.canvas-overlay {
  position: relative;
  z-index: 1;
  grid-area: label;
  cursor: default;
  touch-action: none;
  user-select: none;
}

/* 1mm 网格：淡灰细线，只在屏幕上，不进打印 */
.canvas-overlay--grid {
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--color-rule) 45%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--color-rule) 45%, transparent) 1px, transparent 1px);
  background-size: var(--mm) var(--mm);
}

.canvas-overlay:focus-visible {
  outline: 2px solid var(--color-selection);
  outline-offset: 2px;
}

.canvas-overlay__safe {
  position: absolute;
  border: 1px dashed var(--color-warning);
  pointer-events: none;
}

.canvas-overlay__box {
  position: absolute;
  outline: 1px solid transparent;
  cursor: move;
}

/* 往外多 3px 的点击范围：0.25mm 的细线在屏幕上只有一两个像素，不扩大点不中 */
.canvas-overlay__box::after {
  position: absolute;
  inset: -3px;
  content: "";
}

.canvas-overlay__box:hover {
  outline-color: color-mix(in srgb, var(--color-selection) 50%, transparent);
}

.canvas-overlay__box.canvas-overlay__box--selected {
  outline-color: var(--color-selection);
}

.canvas-overlay__box.canvas-overlay__box--locked {
  cursor: default;
}

/* 锁定的选中元素：虚线框，一眼看出拖不动 */
.canvas-overlay__box--locked.canvas-overlay__box--selected {
  outline-style: dashed;
}

.canvas-overlay__handle {
  position: absolute;
  z-index: 1;
  width: var(--designer-handle-size);
  height: var(--designer-handle-size);
  margin: calc(var(--designer-handle-size) / -2) 0 0 calc(var(--designer-handle-size) / -2);
  border: 1px solid var(--color-selection);
  background: var(--color-field);
}

.canvas-overlay__handle[data-handle="nw"] {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.canvas-overlay__handle[data-handle="n"] {
  top: 0;
  left: 50%;
  cursor: ns-resize;
}

.canvas-overlay__handle[data-handle="ne"] {
  top: 0;
  left: 100%;
  cursor: nesw-resize;
}

.canvas-overlay__handle[data-handle="e"] {
  top: 50%;
  left: 100%;
  cursor: ew-resize;
}

.canvas-overlay__handle[data-handle="se"] {
  top: 100%;
  left: 100%;
  cursor: nwse-resize;
}

.canvas-overlay__handle[data-handle="s"] {
  top: 100%;
  left: 50%;
  cursor: ns-resize;
}

.canvas-overlay__handle[data-handle="sw"] {
  top: 100%;
  left: 0;
  cursor: nesw-resize;
}

.canvas-overlay__handle[data-handle="w"] {
  top: 50%;
  left: 0;
  cursor: ew-resize;
}

.canvas-overlay__guide {
  position: absolute;
  background: var(--color-guide);
  pointer-events: none;
}

.canvas-overlay__guide--x {
  top: 0;
  bottom: 0;
  width: 1px;
}

.canvas-overlay__guide--y {
  right: 0;
  left: 0;
  height: 1px;
}

.canvas-overlay__marquee {
  position: absolute;
  border: 1px dashed var(--color-selection);
  background: color-mix(in srgb, var(--color-selection) 8%, transparent);
  pointer-events: none;
}

/* 右：属性和图层 */
.designer-panel {
  display: flex;
  grid-area: panel;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  padding: var(--space-3);
  overflow-y: auto;
  border-left: 1px solid var(--color-rule);
  background: var(--color-paper);
}

.designer-panel .form-section {
  padding: var(--space-3);
}

.designer-panel .form-row {
  grid-template-columns: var(--designer-label-width) minmax(0, 1fr);
}

.designer-panel .form-row--stacked {
  grid-template-columns: minmax(0, 1fr);
}

.designer-subtitle {
  margin: var(--space-2) 0 0;
  font-size: 13px;
  font-weight: 700;
}

.designer-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.designer-range {
  flex: 1;
  min-width: 0;
  accent-color: var(--color-ink);
}

.designer-image {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.layer-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.layer-list__items {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  list-style: none;
}

.layer-list__items > li + li {
  border-top: 1px solid var(--color-rule);
}

.layer-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-3);
  border: 0;
  color: inherit;
  background: var(--color-field);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.layer-list__item:hover {
  background: var(--color-tape-wash);
}

/* 选中的图层：和模板列表的选中项一样，左边 4px 竖条 */
.layer-list__item[aria-pressed="true"] {
  background: var(--color-tape-wash);
  box-shadow: inset 4px 0 0 var(--color-tape);
}

.layer-list__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-list__kind {
  flex: none;
  color: var(--color-ink-soft);
  font-size: 12px;
}

/* 下：打印前检查，最多三四行高，多了在里面滚动 */
.designer-checks {
  grid-area: checks;
  max-height: 96px;
  padding: var(--space-2) var(--space-4);
  overflow-y: auto;
  border-top: 1px solid var(--color-rule);
  background: var(--color-paper);
}

.designer-checks__title {
  margin: 0 0 var(--space-1);
  font-size: 13px;
  font-weight: 700;
}

.designer-checks__ok {
  margin: 0;
  color: var(--color-success);
  font-size: 13px;
}

.designer-checks__list {
  margin: 0;
  padding-left: var(--space-5);
  font-size: 13px;
}

.designer-checks__list li::marker {
  color: var(--color-warning);
}
```

- [ ] **Step 4: `bun run check`**

Expected: 通过。若 Biome 在覆盖层的 `div` 上报 `lint/a11y/noNoninteractiveTabindex` 或 `lint/a11y/noStaticElementInteractions`，在这个 `<div` 的上一行加一条（规则名照它报的写）：

```tsx
          // biome-ignore lint/a11y/noNoninteractiveTabindex: 画布是自定义的鼠标和键盘控件（role=application），键盘操作写在 aria-label 里
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/canvas-editor/CanvasStage.tsx src/renderer/src/styles/tokens.css src/renderer/src/styles/app.css
git commit -m "feat(renderer): canvas stage with rulers, grid, safe area and a selection overlay" -m "The label on the canvas is the same print HTML as the preview, in a sandboxed iframe. A transparent overlay on top draws the grid, the 1.5 mm safe area, selection boxes, resize handles, snap guides and the marquee, and takes all pointer and keyboard input." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 13: 工具条、元素栏、图层列表

**Files:**
- Modify: `src/core/templates/canvas-model.ts`（导出 `CANVAS_ELEMENT_LABELS`）
- Modify: `src/core/templates/canvas-model.test.ts`
- Create: `src/renderer/src/components/SampleInput.tsx`（从 TemplatesPage 挪出来）
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx`（改用它）
- Create: `src/renderer/src/components/canvas-editor/DesignerToolbar.tsx`
- Create: `src/renderer/src/components/canvas-editor/ElementPalette.tsx`
- Create: `src/renderer/src/components/canvas-editor/LayerList.tsx`

- [ ] **Step 1: 写测试**

`canvas-model.test.ts` 第 2 行的 import 加上 `CANVAS_ELEMENT_LABELS`：

```ts
import {
  BARCODE_TYPES,
  barcodeType,
  CANVAS_ELEMENT_KINDS,
  CANVAS_ELEMENT_LABELS,
  newCanvasElement,
  snapBorderDots,
} from './canvas-model';
```

`describe('canvas model', ...)` 里加：

```ts
  test('names a new element after its kind', () => {
    for (const kind of CANVAS_ELEMENT_KINDS) {
      expect(newCanvasElement(kind, 'e1', { widthMm: 60, heightMm: 40 }).name).toBe(CANVAS_ELEMENT_LABELS[kind]);
    }
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/templates/canvas-model.test.ts`
Expected: FAIL（`CANVAS_ELEMENT_LABELS` 没有导出，`toBe(undefined)` 不成立）。

- [ ] **Step 3: 实现**

`canvas-model.ts`：

```ts
const NEW_ELEMENT_NAMES: Readonly<Record<CanvasElementKind, string>> = {
```

换成

```ts
/** 每种元素的名称：新元素的默认名字、设计器的元素栏和图层列表都用它（只写这一处）。 */
export const CANVAS_ELEMENT_LABELS: Readonly<Record<CanvasElementKind, string>> = {
```

`newCanvasElement` 里 `name: NEW_ELEMENT_NAMES[kind],` 换成 `name: CANVAS_ELEMENT_LABELS[kind],`。

Run: `bun test src/core/templates`
Expected: PASS。

- [ ] **Step 4: `SampleInput.tsx`**

```tsx
// src/renderer/src/components/SampleInput.tsx
import { useId } from 'react';

/** 「预览内容」的值和修改：默认是最近一次扫码的内容；配置中心里扫码也填进这里。 */
export interface SampleContent {
  value: string;
  onChange: (value: string) => void;
}

interface SampleInputProps {
  sample: SampleContent;
  /** 放在设计器的工具条里：一行高，和工具按钮对齐。 */
  isCompact?: boolean;
}

/** 「预览内容」：多行内容照原样保留，所以用 textarea。 */
export function SampleInput({ sample, isCompact = false }: SampleInputProps) {
  const id = useId();
  return (
    <div className={isCompact ? 'sample-input sample-input--compact' : 'sample-input'}>
      <label className="sample-input__label" htmlFor={id}>
        预览内容
      </label>
      <textarea
        id={id}
        className="text-field text-area sample-input__field"
        rows={isCompact ? 1 : 2}
        value={sample.value}
        placeholder="扫码，或输入要预览的内容"
        spellCheck={false}
        onChange={(event) => sample.onChange(event.target.value)}
      />
    </div>
  );
}
```

`TemplatesPage.tsx`：删掉 `export interface SampleContent { ... }`（第 23–26 行）和文件末尾的 `function SampleInput(...) { ... }`（第 286–305 行及其注释）；import 区在 `import { LabelPreview } from '../../LabelPreview';` 之后加：

```ts
import { type SampleContent, SampleInput } from '../../SampleInput';
```

（`useId` 仍被 `TemplateGroup` 用到，保留。）

- [ ] **Step 5: `ElementPalette.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/ElementPalette.tsx
import {
  CANVAS_ELEMENT_KINDS,
  CANVAS_ELEMENT_LABELS,
  type CanvasElementKind,
} from '../../../../core/templates/canvas-model';
import { ELEMENT_DRAG_TYPE } from '../../lib/canvas-view';

interface ElementPaletteProps {
  onAdd: (kind: CanvasElementKind) => void;
}

/** 左边的元素栏：点一下加到画布中间，或拖到画布上松手的位置。 */
export function ElementPalette({ onAdd }: ElementPaletteProps) {
  return (
    <section className="element-palette" aria-label="元素">
      {CANVAS_ELEMENT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="element-palette__item"
          draggable
          aria-label={`添加${CANVAS_ELEMENT_LABELS[kind]}`}
          onClick={() => onAdd(kind)}
          onDragStart={(event) => {
            event.dataTransfer.setData(ELEMENT_DRAG_TYPE, kind);
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          {CANVAS_ELEMENT_LABELS[kind]}
        </button>
      ))}
      <p className="element-palette__hint">点一下放到中间，或拖到画布上</p>
    </section>
  );
}
```

- [ ] **Step 6: `LayerList.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/LayerList.tsx
import { useId } from 'react';
import { CANVAS_ELEMENT_LABELS, type CanvasElement } from '../../../../core/templates/canvas-model';
import { toggleId } from '../../lib/canvas-edit';

interface LayerListProps {
  elements: readonly CanvasElement[];
  selection: readonly string[];
  onSelect: (ids: readonly string[]) => void;
}

/** 图层：上层在前，只用来点选（叠在一起、很小的元素在画布上不好点），Shift 加选。 */
export function LayerList({ elements, selection, onSelect }: LayerListProps) {
  const headingId = useId();
  return (
    <section className="layer-list" aria-labelledby={headingId}>
      <h2 id={headingId} className="form-section__title">
        图层
      </h2>
      {elements.length === 0 ? (
        <p className="form-hint">还没有元素：点左边的元素加到画布中间，或拖到画布上。</p>
      ) : (
        <ul className="layer-list__items" aria-label="图层">
          {[...elements].reverse().map((element) => (
            <li key={element.id}>
              <button
                type="button"
                className="layer-list__item"
                aria-pressed={selection.includes(element.id)}
                aria-label={`${element.name}（${CANVAS_ELEMENT_LABELS[element.kind]}）`}
                onClick={(event) => onSelect(event.shiftKey ? toggleId(selection, element.id) : [element.id])}
              >
                <span className="layer-list__name">{element.name}</span>
                <span className="layer-list__kind">
                  {element.locked ? `${CANVAS_ELEMENT_LABELS[element.kind]} · 锁定` : CANVAS_ELEMENT_LABELS[element.kind]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: `DesignerToolbar.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/DesignerToolbar.tsx
import type { ReactNode } from 'react';
import type { Alignment } from '../../lib/canvas-edit';
import { zoomIn, zoomOut } from '../../lib/canvas-view';
import type { CanvasDesignerViewModel } from '../../view-models/use-canvas-designer';
import { type SampleContent, SampleInput } from '../SampleInput';

interface DesignerToolbarProps {
  designer: CanvasDesignerViewModel;
  /** 现在的缩放倍数（「适合窗口」时是算出来的倍数）。 */
  zoom: number;
  sample: SampleContent;
}

/** 对齐按钮：按钮上一个字，完整名称给读屏和鼠标悬停（名称里含按钮上的字）。 */
const ALIGN_BUTTONS: ReadonlyArray<{ value: Alignment; label: string; name: string }> = [
  { value: 'left', label: '左', name: '左对齐' },
  { value: 'center', label: '中', name: '水平居中' },
  { value: 'right', label: '右', name: '右对齐' },
  { value: 'top', label: '顶', name: '顶对齐' },
  { value: 'middle', label: '中', name: '垂直居中' },
  { value: 'bottom', label: '底', name: '底对齐' },
];

/** 缩放倍数显示成百分比：1 倍 = 100%（实物大小）。 */
const PERCENT = 100;

interface ToolButtonProps {
  label: string;
  name: string;
  disabled?: boolean;
  /** 开关按钮的状态；普通按钮不传。 */
  pressed?: boolean;
  onClick: () => void;
}

function ToolButton({ label, name, disabled = false, pressed, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="button button--small button--quiet"
      title={name}
      aria-label={name}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** 一组按钮：组名给读屏；对齐、等距的按钮只有一个字，把组名也显示出来。 */
function ToolGroup({ label, showLabel = false, children }: { label: string; showLabel?: boolean; children: ReactNode }) {
  return (
    <fieldset className="designer-toolbar__group" aria-label={label}>
      {showLabel && (
        <span className="designer-toolbar__label" aria-hidden="true">
          {label}
        </span>
      )}
      {children}
    </fieldset>
  );
}

/** 设计器的工具条：编辑、对齐、等距、叠放、网格和吸附、缩放，最后是预览内容。 */
export function DesignerToolbar({ designer, zoom, sample }: DesignerToolbarProps) {
  const { hasSelection } = designer;
  return (
    <div className="designer-toolbar">
      <ToolGroup label="编辑">
        <ToolButton label="撤销" name="撤销" disabled={!designer.canUndo} onClick={designer.undo} />
        <ToolButton label="重做" name="重做" disabled={!designer.canRedo} onClick={designer.redo} />
        <ToolButton label="复制" name="复制" disabled={!hasSelection} onClick={designer.copy} />
        <ToolButton label="粘贴" name="粘贴" disabled={!designer.canPaste} onClick={designer.paste} />
        <ToolButton label="删除" name="删除" disabled={!hasSelection} onClick={designer.remove} />
      </ToolGroup>
      <ToolGroup label="对齐" showLabel>
        {ALIGN_BUTTONS.map((button) => (
          <ToolButton
            key={button.value}
            label={button.label}
            name={button.name}
            disabled={!hasSelection}
            onClick={() => designer.align(button.value)}
          />
        ))}
      </ToolGroup>
      <ToolGroup label="等距" showLabel>
        <ToolButton
          label="横"
          name="横向等距"
          disabled={!designer.canDistribute}
          onClick={() => designer.distribute('horizontal')}
        />
        <ToolButton
          label="纵"
          name="纵向等距"
          disabled={!designer.canDistribute}
          onClick={() => designer.distribute('vertical')}
        />
      </ToolGroup>
      <ToolGroup label="叠放">
        <ToolButton label="置顶" name="置顶" disabled={!hasSelection} onClick={designer.toFront} />
        <ToolButton label="置底" name="置底" disabled={!hasSelection} onClick={designer.toBack} />
      </ToolGroup>
      <ToolGroup label="辅助">
        <ToolButton
          label="网格"
          name="网格"
          pressed={designer.showGrid}
          onClick={() => designer.setShowGrid(!designer.showGrid)}
        />
        <ToolButton label="吸附" name="吸附" pressed={designer.snap} onClick={() => designer.setSnap(!designer.snap)} />
      </ToolGroup>
      <ToolGroup label="缩放">
        <ToolButton label="缩小" name="缩小" onClick={() => designer.setZoom(zoomOut(zoom))} />
        <output className="designer-toolbar__zoom" aria-label="缩放倍数">
          {`${Math.round(zoom * PERCENT)}%`}
        </output>
        <ToolButton label="放大" name="放大" onClick={() => designer.setZoom(zoomIn(zoom))} />
        <ToolButton
          label="适合"
          name="适合窗口"
          pressed={designer.zoom === 'fit'}
          onClick={() => designer.setZoom('fit')}
        />
      </ToolGroup>
      <SampleInput sample={sample} isCompact />
    </div>
  );
}
```

- [ ] **Step 8: `bun run check`，再跑一遍模板页的 E2E**

Run: `bun run check && bun run test:e2e -- --grep "template"`
Expected: 都通过（`SampleInput` 挪了位置，模板页的「预览内容」照常工作）。

- [ ] **Step 9: 提交**

```bash
git add src/core/templates/canvas-model.ts src/core/templates/canvas-model.test.ts src/renderer/src/components/SampleInput.tsx src/renderer/src/components/config/pages/TemplatesPage.tsx src/renderer/src/components/canvas-editor/DesignerToolbar.tsx src/renderer/src/components/canvas-editor/ElementPalette.tsx src/renderer/src/components/canvas-editor/LayerList.tsx
git commit -m "feat(renderer): designer toolbar, element palette and layer list" -m "Element names live in one place in the canvas model and are shared by new elements, the palette and the layers. The preview content input moves to its own component so the designer toolbar can show it on one line." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 14: 属性栏

**Files:**
- Create: `src/renderer/src/components/canvas-editor/options.ts`
- Create: `src/renderer/src/components/canvas-editor/InsertField.tsx`
- Create: `src/renderer/src/components/canvas-editor/ElementProperties.tsx`
- Create: `src/renderer/src/components/canvas-editor/TableProperties.tsx`

- [ ] **Step 1: `options.ts`**

```ts
// src/renderer/src/components/canvas-editor/options.ts
import { type ImageMode, ROTATIONS, type TextFit } from '../../../../core/templates/canvas-model';
import type { QrErrorLevel, TextAlign } from '../../../../core/templates/template-model';
import type { VerticalAlign } from '../../../../core/templates/waybill-model';

/** 属性栏里分段按钮的选项（文字、表格格子共用）。 */
export const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

export const VALIGN_OPTIONS: ReadonlyArray<{ value: VerticalAlign; label: string }> = [
  { value: 'top', label: '靠上' },
  { value: 'middle', label: '居中' },
];

export const FIT_OPTIONS: ReadonlyArray<{ value: TextFit; label: string }> = [
  { value: 'shrink', label: '缩小' },
  { value: 'wrap', label: '折行' },
];

/** 二维码容错：字母后面是能恢复的比例，选的时候知道代价。 */
export const QR_LEVEL_OPTIONS: ReadonlyArray<{ value: QrErrorLevel; label: string }> = [
  { value: 'L', label: 'L 7%' },
  { value: 'M', label: 'M 15%' },
  { value: 'Q', label: 'Q 25%' },
  { value: 'H', label: 'H 30%' },
];

export const IMAGE_MODE_OPTIONS: ReadonlyArray<{ value: ImageMode; label: string }> = [
  { value: 'threshold', label: '阈值' },
  { value: 'dither', label: '抖动' },
];

export const ROTATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = ROTATIONS.map((rotation) => ({
  value: String(rotation),
  label: `${rotation}°`,
}));

/** 位置和大小按 0.1mm 调：和方向键一步一样。 */
export const POSITION_STEP_MM = 0.1;
/** 字号按 0.1mm 调：热敏纸上能分辨的字号差。 */
export const FONT_STEP_MM = 0.1;
/** 边框按 0.05mm 调：203dpi 一个点约 0.125mm，再细调没有意义。 */
export const BORDER_STEP_MM = 0.05;
/** 圆角按 0.5mm 调。 */
export const RADIUS_STEP_MM = 0.5;
```

- [ ] **Step 2: `InsertField.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/InsertField.tsx
import { NOTE_VARIABLES } from '../../../../core/templates/note-text';
import { SelectField } from '../form-controls';

/** 下拉框的第一项是提示，不是字段：选了字段之后马上回到它，下次还能再插。 */
const PLACEHOLDER = '';

interface InsertFieldProps {
  /** 规则里出现过的字段名和这次预览识别出的字段名。 */
  fieldNames: readonly string[];
  onInsert: (variable: string) => void;
}

/** 「插入字段」：把 {字段名} 接到内容末尾，免得手打花括号和字段名。 */
export function InsertField({ fieldNames, onInsert }: InsertFieldProps) {
  const fixed = NOTE_VARIABLES.filter((variable) => !fieldNames.includes(variable.slice(1, -1)));
  const options = [
    { value: PLACEHOLDER, label: '插入字段…' },
    ...fieldNames.map((name) => ({ value: `{${name}}`, label: name })),
    ...fixed.map((variable) => ({ value: variable, label: variable.slice(1, -1) })),
  ];
  return (
    <SelectField
      label="插入字段"
      value={PLACEHOLDER}
      options={options}
      onChange={(value) => {
        if (value !== PLACEHOLDER) {
          onInsert(value);
        }
      }}
    />
  );
}
```

- [ ] **Step 3: `TableProperties.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/TableProperties.tsx
import { useState } from 'react';
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasTable,
  type CanvasTableCell,
  DEFAULT_TABLE_CELL,
} from '../../../../core/templates/canvas-model';
import type { PaperSize } from '../../../../shared/paper-sizes';
import {
  addTableColumn,
  addTableRow,
  lastColumnMm,
  lastRowMm,
  removeTableColumn,
  removeTableRow,
  setColumnMm,
  setRowMm,
  updateTableCell,
} from '../../lib/canvas-table';
import { NumberField, Segmented, SelectField, TextInput, Toggle } from '../form-controls';
import { InsertField } from './InsertField';
import { ALIGN_OPTIONS, BORDER_STEP_MM, FONT_STEP_MM, POSITION_STEP_MM } from './options';

interface TablePropertiesProps {
  element: CanvasTable;
  paper: PaperSize;
  fieldNames: readonly string[];
  onChange: (next: CanvasElement, field: string) => void;
}

const SIZE_TEXT = {
  row: { unit: '行', size: '高', rest: '高度' },
  column: { unit: '列', size: '宽', rest: '宽度' },
} as const;

/** 行高或列宽：除了最后一个都能改，最后一个占剩下的（写出它现在多大）。 */
function SizeList({
  kind,
  sizes,
  lastMm,
  max,
  onChange,
}: {
  kind: 'row' | 'column';
  sizes: readonly number[];
  lastMm: number;
  max: number;
  onChange: (index: number, mm: number) => void;
}) {
  const text = SIZE_TEXT[kind];
  return (
    <>
      {sizes.slice(0, -1).map((size, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行高、列宽按位置编辑，位置就是身份
        <NumberField
          key={index}
          label={`第 ${index + 1} ${text.unit}${text.size}`}
          value={size}
          min={CANVAS_LIMITS.minSizeMm}
          max={max}
          step={POSITION_STEP_MM}
          onChange={(mm) => onChange(index, mm)}
        />
      ))}
      <p className="form-hint">{`最后一${text.unit}：${lastMm.toFixed(1)}mm，占剩下的${text.rest}`}</p>
    </>
  );
}

/** 表格：边框、行高和列宽、加减行列，再选一格改文字。 */
export function TableProperties({ element, paper, fieldNames, onChange }: TablePropertiesProps) {
  const [picked, setPicked] = useState({ row: 0, column: 0 });
  const row = Math.min(picked.row, element.rowsMm.length - 1);
  const column = Math.min(picked.column, element.columnsMm.length - 1);
  const cell = element.cells[row]?.[column] ?? DEFAULT_TABLE_CELL;
  const setCell = (patch: Partial<CanvasTableCell>, field: string) =>
    onChange(updateTableCell(element, row, column, patch), `cell:${row}:${column}:${field}`);
  const { fontSizeMm } = CANVAS_LIMITS;

  return (
    <>
      <NumberField
        label="边框"
        value={element.borderMm}
        min={CANVAS_LIMITS.borderMm.min}
        max={CANVAS_LIMITS.borderMm.max}
        step={BORDER_STEP_MM}
        onChange={(borderMm) => onChange({ ...element, borderMm }, 'borderMm')}
      />
      <h3 className="designer-subtitle">行</h3>
      <SizeList
        kind="row"
        sizes={element.rowsMm}
        lastMm={lastRowMm(element)}
        max={paper.heightMm}
        onChange={(index, mm) => onChange(setRowMm(element, index, mm), `row:${index}`)}
      />
      <div className="designer-actions-row">
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.rowsMm.length >= CANVAS_LIMITS.tableRows}
          onClick={() => onChange(addTableRow(element), 'rows')}
        >
          加一行
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.rowsMm.length <= 1}
          onClick={() => onChange(removeTableRow(element), 'rows')}
        >
          删最后一行
        </button>
      </div>
      <h3 className="designer-subtitle">列</h3>
      <SizeList
        kind="column"
        sizes={element.columnsMm}
        lastMm={lastColumnMm(element)}
        max={paper.widthMm}
        onChange={(index, mm) => onChange(setColumnMm(element, index, mm), `column:${index}`)}
      />
      <div className="designer-actions-row">
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.columnsMm.length >= CANVAS_LIMITS.tableColumns}
          onClick={() => onChange(addTableColumn(element), 'columns')}
        >
          加一列
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          disabled={element.columnsMm.length <= 1}
          onClick={() => onChange(removeTableColumn(element), 'columns')}
        >
          删最后一列
        </button>
      </div>
      <h3 className="designer-subtitle">格子</h3>
      <SelectField
        label="行"
        value={String(row)}
        options={element.rowsMm.map((_, index) => ({ value: String(index), label: `第 ${index + 1} 行` }))}
        onChange={(value) => setPicked({ row: Number(value), column })}
      />
      <SelectField
        label="列"
        value={String(column)}
        options={element.columnsMm.map((_, index) => ({ value: String(index), label: `第 ${index + 1} 列` }))}
        onChange={(value) => setPicked({ row, column: Number(value) })}
      />
      <TextInput
        label="文字"
        value={cell.text}
        maxLength={CANVAS_LIMITS.textLength}
        onChange={(text) => setCell({ text }, 'text')}
      />
      <InsertField
        fieldNames={fieldNames}
        onInsert={(variable) => setCell({ text: `${cell.text}${variable}`.slice(0, CANVAS_LIMITS.textLength) }, 'text')}
      />
      <NumberField
        label="字号"
        value={cell.fontSizeMm}
        min={fontSizeMm.min}
        max={fontSizeMm.max}
        step={FONT_STEP_MM}
        onChange={(value) => setCell({ fontSizeMm: value }, 'fontSizeMm')}
      />
      <Toggle label="加粗" checked={cell.bold} onChange={(bold) => setCell({ bold }, 'bold')} />
      <Segmented label="对齐" value={cell.align} options={ALIGN_OPTIONS} onChange={(align) => setCell({ align }, 'align')} />
    </>
  );
}
```

（`biome-ignore` 放在元素之前，和 `WaybillEditor.tsx` 第 400 行的写法一致。）

- [ ] **Step 4: `ElementProperties.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/ElementProperties.tsx
import { useEffect, useId, useRef, useState } from 'react';
import {
  BARCODE_TYPES,
  barcodeType,
  CANVAS_ELEMENT_LABELS,
  CANVAS_LIMITS,
  type CanvasBarcode,
  type CanvasElement,
  type CanvasImage,
  type CanvasLine,
  type CanvasQr,
  type CanvasRect,
  type CanvasText,
  ROTATIONS,
  type Rotation,
} from '../../../../core/templates/canvas-model';
import type { PaperSize } from '../../../../shared/paper-sizes';
import { useImageImport } from '../../view-models/use-image-import';
import { NumberField, Segmented, TextInput, Toggle } from '../form-controls';
import { InsertField } from './InsertField';
import {
  ALIGN_OPTIONS,
  BORDER_STEP_MM,
  FIT_OPTIONS,
  FONT_STEP_MM,
  IMAGE_MODE_OPTIONS,
  POSITION_STEP_MM,
  QR_LEVEL_OPTIONS,
  RADIUS_STEP_MM,
  ROTATION_OPTIONS,
  VALIGN_OPTIONS,
} from './options';
import { TableProperties } from './TableProperties';

/** 灰度阈值的上限：0 全白、255 全黑之间。 */
const THRESHOLD_MAX = 255;
/** 选图片时接受的格式：浏览器能解码的常见位图。 */
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/bmp,image/gif,image/webp';

/** 改了一项：field 是哪一项，撤销历史按「元素 + 字段」合并连续输入。 */
type ElementChange = (next: CanvasElement, field: string) => void;

export interface ElementPropertiesProps {
  element: CanvasElement;
  paper: PaperSize;
  /** 模板里所有元素：插入图片时核对整个模板的图片总量。 */
  elements: readonly CanvasElement[];
  fieldNames: readonly string[];
  /** 双击了哪个文字元素：它的「内容」框拿到焦点后调用 onTextEditStarted 清掉。 */
  editTextId: string | null;
  onTextEditStarted: () => void;
  onChange: ElementChange;
  onRotate: (rotation: Rotation) => void;
}

/** 选中一个元素时右栏的属性：通用的位置、大小、旋转、锁定，再加这一类自己的设置。 */
export function ElementProperties(props: ElementPropertiesProps) {
  const { element, paper, onChange, onRotate } = props;
  const min = CANVAS_LIMITS.minSizeMm;
  return (
    <>
      <section className="form-section">
        <h2 className="form-section__title">{CANVAS_ELEMENT_LABELS[element.kind]}</h2>
        <TextInput
          label="名称"
          value={element.name}
          maxLength={CANVAS_LIMITS.nameLength}
          onChange={(name) => onChange({ ...element, name }, 'name')}
        />
        <NumberField
          label="X"
          value={element.x}
          min={0}
          max={paper.widthMm - element.width}
          step={POSITION_STEP_MM}
          onChange={(x) => onChange({ ...element, x }, 'x')}
        />
        <NumberField
          label="Y"
          value={element.y}
          min={0}
          max={paper.heightMm - element.height}
          step={POSITION_STEP_MM}
          onChange={(y) => onChange({ ...element, y }, 'y')}
        />
        <NumberField
          label="宽"
          value={element.width}
          min={min}
          max={paper.widthMm - element.x}
          step={POSITION_STEP_MM}
          onChange={(width) => onChange({ ...element, width }, 'width')}
        />
        <NumberField
          label="高"
          value={element.height}
          min={min}
          max={paper.heightMm - element.y}
          step={POSITION_STEP_MM}
          onChange={(height) => onChange({ ...element, height }, 'height')}
        />
        <Segmented
          label="旋转"
          value={String(element.rotation)}
          options={ROTATION_OPTIONS}
          onChange={(value) => onRotate(ROTATIONS.find((rotation) => String(rotation) === value) ?? 0)}
        />
        <Toggle label="锁定" checked={element.locked} onChange={(locked) => onChange({ ...element, locked }, 'locked')} />
        {element.locked && <p className="form-hint">锁定后在画布上不能拖动、缩放和删除；这里的数字照样能改。</p>}
      </section>
      <section className="form-section">
        <h2 className="form-section__title">设置</h2>
        <KindProperties {...props} />
      </section>
    </>
  );
}

function KindProperties({ element, paper, elements, fieldNames, editTextId, onTextEditStarted, onChange }: ElementPropertiesProps) {
  switch (element.kind) {
    case 'text':
      return (
        <TextProperties
          element={element}
          fieldNames={fieldNames}
          editTextId={editTextId}
          onTextEditStarted={onTextEditStarted}
          onChange={onChange}
        />
      );
    case 'barcode':
      return <BarcodeProperties element={element} fieldNames={fieldNames} onChange={onChange} />;
    case 'qr':
      return <QrProperties element={element} fieldNames={fieldNames} onChange={onChange} />;
    case 'image':
      return <ImageProperties element={element} elements={elements} onChange={onChange} />;
    case 'line':
      return <LineProperties element={element} onChange={onChange} />;
    case 'rect':
      return <RectProperties element={element} onChange={onChange} />;
    case 'table':
      return <TableProperties element={element} paper={paper} fieldNames={fieldNames} onChange={onChange} />;
  }
}

function TextProperties({
  element,
  fieldNames,
  editTextId,
  onTextEditStarted,
  onChange,
}: {
  element: CanvasText;
  fieldNames: readonly string[];
  editTextId: string | null;
  onTextEditStarted: () => void;
  onChange: ElementChange;
}) {
  const id = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  // 双击了画布上的这个文字：直接在这里改内容（整段选中，打字即替换）。
  useEffect(() => {
    if (editTextId === element.id) {
      textRef.current?.focus();
      textRef.current?.select();
      onTextEditStarted();
    }
  }, [editTextId, element.id, onTextEditStarted]);
  const setText = (text: string) => onChange({ ...element, text: text.slice(0, CANVAS_LIMITS.textLength) }, 'text');
  const { fontSizeMm } = CANVAS_LIMITS;
  return (
    <>
      <div className="form-row form-row--stacked">
        <label className="form-row__label" htmlFor={id}>
          内容
        </label>
        <textarea
          ref={textRef}
          id={id}
          className="text-field text-area"
          rows={3}
          value={element.text}
          maxLength={CANVAS_LIMITS.textLength}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <InsertField fieldNames={fieldNames} onInsert={(variable) => setText(`${element.text}${variable}`)} />
      <p className="form-hint">用 {'{字段名}'} 印扫码识别出的字段；一行里的字段全是空的，这一行不印。</p>
      <NumberField
        label="字号"
        value={element.fontSizeMm}
        min={fontSizeMm.min}
        max={fontSizeMm.max}
        step={FONT_STEP_MM}
        onChange={(value) => onChange({ ...element, fontSizeMm: value }, 'fontSizeMm')}
      />
      <Toggle label="加粗" checked={element.bold} onChange={(bold) => onChange({ ...element, bold }, 'bold')} />
      <Segmented
        label="对齐"
        value={element.align}
        options={ALIGN_OPTIONS}
        onChange={(align) => onChange({ ...element, align }, 'align')}
      />
      <Segmented
        label="垂直"
        value={element.valign}
        options={VALIGN_OPTIONS}
        onChange={(valign) => onChange({ ...element, valign }, 'valign')}
      />
      <Segmented
        label="放不下时"
        value={element.fit}
        options={FIT_OPTIONS}
        onChange={(fit) => onChange({ ...element, fit }, 'fit')}
      />
      <Toggle label="反白" checked={element.inverse} onChange={(inverse) => onChange({ ...element, inverse }, 'inverse')} />
    </>
  );
}

function BarcodeProperties({
  element,
  fieldNames,
  onChange,
}: {
  element: CanvasBarcode;
  fieldNames: readonly string[];
  onChange: ElementChange;
}) {
  const id = useId();
  const isLinear = barcodeType(element.symbology)?.dimensions !== 2;
  const { fontSizeMm, valueLength } = CANVAS_LIMITS;
  const group = (label: string, types: typeof BARCODE_TYPES) => (
    <optgroup label={label}>
      {types.map((type) => (
        <option key={type.id} value={type.id}>
          {type.label}
        </option>
      ))}
    </optgroup>
  );
  return (
    <>
      <div className="form-row">
        <label className="form-row__label" htmlFor={id}>
          码制
        </label>
        <select
          id={id}
          className="select-field"
          value={element.symbology}
          onChange={(event) => onChange({ ...element, symbology: event.target.value }, 'symbology')}
        >
          {group('常用', BARCODE_TYPES.filter((type) => type.common))}
          {group('更多一维码', BARCODE_TYPES.filter((type) => !type.common && type.dimensions === 1))}
          {group('更多二维码', BARCODE_TYPES.filter((type) => type.dimensions === 2))}
        </select>
      </div>
      <TextInput
        label="内容"
        value={element.value}
        maxLength={valueLength}
        placeholder="{编码}"
        onChange={(value) => onChange({ ...element, value }, 'value')}
      />
      <InsertField
        fieldNames={fieldNames}
        onInsert={(variable) => onChange({ ...element, value: `${element.value}${variable}`.slice(0, valueLength) }, 'value')}
      />
      <p className="form-hint">内容不合这种码制（位数不对、校验位错、有中文）时这张不印条码，底部「打印前检查」写明原因。</p>
      {isLinear && (
        <Toggle
          label="印号码"
          checked={element.showText}
          onChange={(showText) => onChange({ ...element, showText }, 'showText')}
        />
      )}
      {isLinear && element.showText && (
        <NumberField
          label="号码字号"
          value={element.textSizeMm}
          min={fontSizeMm.min}
          max={fontSizeMm.max}
          step={FONT_STEP_MM}
          onChange={(textSizeMm) => onChange({ ...element, textSizeMm }, 'textSizeMm')}
        />
      )}
    </>
  );
}

function QrProperties({
  element,
  fieldNames,
  onChange,
}: {
  element: CanvasQr;
  fieldNames: readonly string[];
  onChange: ElementChange;
}) {
  const { valueLength } = CANVAS_LIMITS;
  return (
    <>
      <TextInput
        label="内容"
        value={element.value}
        maxLength={valueLength}
        placeholder="{完整内容}"
        onChange={(value) => onChange({ ...element, value }, 'value')}
      />
      <InsertField
        fieldNames={fieldNames}
        onInsert={(variable) => onChange({ ...element, value: `${element.value}${variable}`.slice(0, valueLength) }, 'value')}
      />
      <Segmented
        label="容错"
        value={element.errorCorrection}
        options={QR_LEVEL_OPTIONS}
        onChange={(errorCorrection) => onChange({ ...element, errorCorrection }, 'errorCorrection')}
      />
      <p className="form-hint">内容太长放不下时自动降低容错，仍放不下就不印，并在底部「打印前检查」说明。</p>
    </>
  );
}

function RangeField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <span className="form-row__control">
        <input
          id={id}
          type="range"
          className="designer-range"
          min={0}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="form-row__unit">{value}</span>
      </span>
    </div>
  );
}

function ImageProperties({
  element,
  elements,
  onChange,
}: {
  element: CanvasImage;
  elements: readonly CanvasElement[];
  onChange: ElementChange;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const importImage = useImageImport();
  // 新建的图片元素是 1×1 的白点（canvas-model 的默认值），还没有真正的图。
  const hasPicture = element.pixelWidth > 1 || element.pixelHeight > 1;
  const onFile = async (file: File) => {
    setIsReading(true);
    const next = await importImage(file, element, elements);
    setIsReading(false);
    if (next !== null) {
      onChange(next, 'pixels');
    }
  };
  return (
    <>
      <div className="form-row">
        <span className="form-row__label">图片</span>
        <div className="designer-image">
          <span className="form-row__unit">
            {hasPicture ? `${element.pixelWidth}×${element.pixelHeight} 像素` : '还没有选图片'}
          </span>
          <button
            type="button"
            className="button button--small"
            disabled={isReading}
            onClick={() => inputRef.current?.click()}
          >
            {isReading ? '正在读取…' : '选择图片…'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // 清掉选择：同一个文件改过之后再选一次也能触发。
              event.target.value = '';
              if (file) {
                void onFile(file);
              }
            }}
          />
        </div>
      </div>
      <Segmented
        label="转黑白"
        value={element.mode}
        options={IMAGE_MODE_OPTIONS}
        onChange={(mode) => onChange({ ...element, mode }, 'mode')}
      />
      <RangeField
        label="阈值"
        value={element.threshold}
        max={THRESHOLD_MAX}
        onChange={(threshold) => onChange({ ...element, threshold }, 'threshold')}
      />
      <p className="form-hint">
        标签机只有黑白两色：「阈值」适合 Logo 和线稿，比阈值暗的印黑；「抖动」适合照片，用点的疏密表示深浅。图片在框里等比缩放。
      </p>
    </>
  );
}

function LineProperties({ element, onChange }: { element: CanvasLine; onChange: ElementChange }) {
  return (
    <>
      <Toggle label="虚线" checked={element.dashed} onChange={(dashed) => onChange({ ...element, dashed }, 'dashed')} />
      <p className="form-hint">{`横线还是竖线看宽和高哪个长，粗细是短的那一边（最细 ${CANVAS_LIMITS.minSizeMm}mm）。`}</p>
    </>
  );
}

function RectProperties({ element, onChange }: { element: CanvasRect; onChange: ElementChange }) {
  return (
    <>
      <NumberField
        label="边框"
        value={element.borderMm}
        min={CANVAS_LIMITS.borderMm.min}
        max={CANVAS_LIMITS.borderMm.max}
        step={BORDER_STEP_MM}
        onChange={(borderMm) => onChange({ ...element, borderMm }, 'borderMm')}
      />
      <Toggle label="填黑" checked={element.filled} onChange={(filled) => onChange({ ...element, filled }, 'filled')} />
      <NumberField
        label="圆角"
        value={element.radiusMm}
        min={0}
        max={CANVAS_LIMITS.radiusMm.max}
        step={RADIUS_STEP_MM}
        onChange={(radiusMm) => onChange({ ...element, radiusMm }, 'radiusMm')}
      />
      <p className="form-hint">边框填 0 就没有边框；填黑之后可以在上面放反白的文字。</p>
    </>
  );
}
```

- [ ] **Step 5: `bun run check`**

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/canvas-editor/options.ts src/renderer/src/components/canvas-editor/InsertField.tsx src/renderer/src/components/canvas-editor/ElementProperties.tsx src/renderer/src/components/canvas-editor/TableProperties.tsx
git commit -m "feat(renderer): property panels for every canvas element kind" -m "Position, size, rotation and lock for all elements, plus text content with field insertion, the barcode symbology list with the ten common types first, QR error correction, image picking with threshold or dither, line, rectangle and table rows, columns and cells. Edits of one field merge into one undo step." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 15: 组装设计器，接进模板页

**Files:**
- Create: `src/renderer/src/components/canvas-editor/CanvasDesigner.tsx`
- Modify: `src/renderer/src/components/config/pages/TemplatesPage.tsx`
- Modify: `src/renderer/src/App.tsx:369-371`
- Modify: `src/renderer/src/styles/app.css`（`.template-list__items` 之后加 `.template-list__create`）
- Modify: `e2e/app.e2e.ts`（1a 的「previews the built-in canvas tag and copies it」最后一行）
- Delete: `src/renderer/src/components/CanvasBasics.tsx`（**先征得用户同意**）

- [ ] **Step 1: `CanvasDesigner.tsx`**

```tsx
// src/renderer/src/components/canvas-editor/CanvasDesigner.tsx
import { type KeyboardEvent, useRef, useState } from 'react';
import type { CanvasTemplate } from '../../../../core/templates/canvas-model';
import { NO_RENDER_WARNINGS, renderWarningTexts } from '../../../../shared/render-warnings';
import { clampAll, replaceElement, rotateElement } from '../../lib/canvas-edit';
import { designerCommand, zoomIn, zoomOut } from '../../lib/canvas-view';
import { useCanvasDesigner } from '../../view-models/use-canvas-designer';
import { useCanvasGesture, useCtrlWheelZoom } from '../../view-models/use-canvas-gesture';
import { useFitScale } from '../../view-models/use-fit-scale';
import type { TemplatePreview } from '../../view-models/use-template-preview';
import { RULER_DEPTH_MM } from '../Ruler';
import type { SampleContent } from '../SampleInput';
import { type PrinterChoices, TemplateBasics } from '../TemplateBasics';
import { CanvasStage } from './CanvasStage';
import { DesignerToolbar } from './DesignerToolbar';
import { ElementPalette } from './ElementPalette';
import { ElementProperties } from './ElementProperties';
import { LayerList } from './LayerList';

/** 「适合窗口」最多放大到 4 倍：小标签放得太大反而看不出实际大小，要更大用「放大」。 */
const MAX_FIT_ZOOM = 4;

export interface CanvasDesignerProps extends PrinterChoices {
  draft: CanvasTemplate;
  /** 草稿按「预览内容」排版的结果（和打印同一份 HTML）；第一次生成前为 null。 */
  preview: TemplatePreview | null;
  sample: SampleContent;
  /** 「插入字段」的候选。 */
  fieldNames: readonly string[];
  onChange: (draft: CanvasTemplate) => void;
}

/** 画布上没有标签时说的话：只说程序确知的事。 */
function placeholderOf(preview: TemplatePreview | null): string {
  return preview === null ? '正在生成预览…' : '这段预览内容无法识别：换一段试试，元素照样可以摆放';
}

/**
 * 自由设计模板的设计器（经典三栏）：上面工具条，左边元素，中间画布，右边属性和图层，下面打印前检查。
 * 状态在 use-canvas-designer、use-canvas-gesture；这里只把它们接到各个部分上。
 */
export function CanvasDesigner({ draft, preview, sample, fieldNames, onChange, printers, paperPrinters }: CanvasDesignerProps) {
  const designer = useCanvasDesigner({ draft, onChange });
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [editTextId, setEditTextId] = useState<string | null>(null);
  const fitZoom = useFitScale(
    stageRef,
    draft.paper.widthMm + RULER_DEPTH_MM,
    draft.paper.heightMm + RULER_DEPTH_MM,
    MAX_FIT_ZOOM,
  );
  const zoom = designer.zoom === 'fit' ? fitZoom : designer.zoom;
  const gesture = useCanvasGesture({
    template: draft,
    selection: designer.selection,
    zoom,
    snap: designer.snap,
    overlayRef,
    onSelect: designer.select,
    onCommit: designer.commit,
  });
  useCtrlWheelZoom(stageRef, (direction) => designer.setZoom(direction > 0 ? zoomIn(zoom) : zoomOut(zoom)));
  const selected =
    designer.selection.length === 1
      ? (draft.elements.find((element) => element.id === designer.selection[0]) ?? null)
      : null;
  const checks = renderWarningTexts(preview?.warnings ?? NO_RENDER_WARNINGS);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const command = designerCommand(event);
    // 只拦下设计器用掉的按键：没选中时的方向键、Esc 照常（Esc 冒泡到配置中心，返回模板列表）。
    if (command !== null && designer.runCommand(command)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <section className="canvas-designer" aria-label="设计器">
      <DesignerToolbar designer={designer} zoom={zoom} sample={sample} />
      <ElementPalette onAdd={(kind) => designer.add(kind)} />
      <CanvasStage
        template={draft}
        html={preview?.html ?? null}
        placeholder={placeholderOf(preview)}
        zoom={zoom}
        showGrid={designer.showGrid}
        selection={designer.selection}
        gesture={gesture.view}
        handlers={gesture.handlers}
        stageRef={stageRef}
        overlayRef={overlayRef}
        onKeyDown={onKeyDown}
        onDropElement={(kind, center) => designer.add(kind, center)}
        onEditText={setEditTextId}
      />
      <aside className="designer-panel" aria-label="属性">
        {selected !== null ? (
          <ElementProperties
            key={selected.id}
            element={selected}
            paper={draft.paper}
            elements={draft.elements}
            fieldNames={fieldNames}
            editTextId={editTextId}
            onTextEditStarted={() => setEditTextId(null)}
            onChange={(next, field) => designer.commit(replaceElement(draft, next), `${next.id}:${field}`)}
            onRotate={(rotation) => designer.commit(rotateElement(draft, selected.id, rotation))}
          />
        ) : designer.selection.length > 1 ? (
          <p className="form-hint">{`已选 ${designer.selection.length} 个元素：用上面的按钮对齐、等距、置顶置底，方向键一起移动。`}</p>
        ) : (
          <section className="form-section">
            <h2 className="form-section__title">模板</h2>
            <TemplateBasics
              draft={draft}
              onChange={(next) => designer.commit(clampAll(next), 'basics')}
              printers={printers}
              paperPrinters={paperPrinters}
            />
          </section>
        )}
        <LayerList elements={draft.elements} selection={designer.selection} onSelect={designer.select} />
      </aside>
      <section className="designer-checks" aria-label="打印前检查">
        <h2 className="designer-checks__title">打印前检查</h2>
        {preview === null ? (
          <p className="designer-checks__ok">正在检查…</p>
        ) : checks.length === 0 ? (
          <p className="designer-checks__ok">按这段预览内容没有发现问题</p>
        ) : (
          <ul className="designer-checks__list">
            {checks.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
```

- [ ] **Step 2: 模板页**

`TemplatesPage.tsx`：

1. import：删掉 `import { CanvasBasics } from '../../CanvasBasics';`，在 `import { DeleteButton } from '../../ConfirmButton';` 之后加 `import { CanvasDesigner } from '../../canvas-editor/CanvasDesigner';`。
2. `TemplatesPageProps` 里 `onCancel: () => void;` 之后加：

```ts
  /** 新建空白的自由设计模板，直接进设计器。 */
  onCreateCanvas: () => void;
  /** 「打印一张试试」：按预览内容打印正在编辑的草稿（只在设计器里有）。 */
  onPrintSample: () => void;
```

3. `ListView` 的参数里加 `onCreateCanvas`，`<TemplateGroup label="自定义" ... />` 之后加：

```tsx
        <button
          type="button"
          className="button button--small button--quiet template-list__create"
          onClick={onCreateCanvas}
        >
          新建自由设计模板
        </button>
```

4. `EditView` 整个函数（`function EditView(` 到它的结束 `}`）换成：

```tsx
function EditView({
  draft,
  isDirty,
  sample,
  preview,
  fieldNames,
  onDraftChange,
  onSave,
  onCancel,
  onPrintSample,
  printers,
  paperPrinters,
}: TemplatesPageProps & { draft: LabelTemplate }) {
  if (draft.kind === 'canvas') {
    return (
      <div className="template-editing template-editing--canvas">
        <CanvasDesigner
          key={draft.id}
          draft={draft}
          preview={preview}
          sample={sample}
          fieldNames={fieldNames}
          printers={printers}
          paperPrinters={paperPrinters}
          onChange={onDraftChange}
        />
        <EditActions isDirty={isDirty} onSave={onSave} onCancel={onCancel} onPrintSample={onPrintSample} />
      </div>
    );
  }
  return (
    <div className="template-editing">
      <div className="template-editing__form">
        {draft.kind === 'label' ? (
          <TemplateEditor
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        ) : (
          <WaybillEditor
            key={draft.id}
            draft={draft}
            onChange={onDraftChange}
            printers={printers}
            paperPrinters={paperPrinters}
          />
        )}
      </div>
      <section className="template-editing__preview" aria-label="模板预览">
        <PreviewSource template={draft} sample={sample} />
        <LabelPreview
          html={preview?.html ?? null}
          warnings={preview?.warnings ?? NO_RENDER_WARNINGS}
          feedKey={preview?.templateId ?? 'none'}
          maxScale={MAX_PREVIEW_SCALE}
          paper={preview?.paper ?? draft.paper}
          placeholder={previewPlaceholder(preview)}
        />
      </section>
      <EditActions isDirty={isDirty} onSave={onSave} onCancel={onCancel} onPrintSample={null} />
    </div>
  );
}

interface EditActionsProps {
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** 只有设计器有「打印一张试试」；标签、面单的编辑器传 null。 */
  onPrintSample: (() => void) | null;
}

/** 编辑视图底部的操作条。 */
function EditActions({ isDirty, onSave, onCancel, onPrintSample }: EditActionsProps) {
  return (
    <div className="config-actions">
      <p className="config-actions__status">{isDirty ? '有未保存的修改，保存后才会用于打印' : '还没有修改'}</p>
      <button type="button" className="button button--quiet" onClick={onCancel}>
        {isDirty ? '放弃修改' : '返回列表'}
      </button>
      {onPrintSample && (
        <button type="button" className="button button--quiet" onClick={onPrintSample}>
          打印一张试试
        </button>
      )}
      <button type="button" className="button button--primary" onClick={onSave} disabled={!isDirty}>
        保存模板
      </button>
    </div>
  );
}
```

`app.css` 里 `.template-list__items { ... }` 之后加：

```css
/* 「新建自由设计模板」：跟在自定义模板下面，左对齐，和列表文字同一条边 */
.template-list__create {
  align-self: flex-start;
  margin: var(--space-2) var(--space-4) 0;
}
```

- [ ] **Step 3: App 接线**

`App.tsx` 里传给 `ConfigPages` 的 `templates={{ ... }}`，`onCancel: templates.cancelEdit,` 之后加：

```ts
              onCreateCanvas: () => void templates.createCanvas(),
              onPrintSample: () => void templates.printSample(config.templatePage.sample.value),
```

- [ ] **Step 4: 删掉过渡表单**

先问用户：「`src/renderer/src/components/CanvasBasics.tsx`（1a 的过渡表单）已经没有地方用了，可以删掉吗？」得到同意后：

Run: `git rm src/renderer/src/components/CanvasBasics.tsx`
Expected: `rm 'src/renderer/src/components/CanvasBasics.tsx'`。

- [ ] **Step 5: 1a 的 E2E 跟着改**

`e2e/app.e2e.ts` 里「previews the built-in canvas tag and copies it」的最后一行

```ts
  await expect(page.locator('.template-editing__form').getByText('设计器')).toBeVisible();
```

换成

```ts
  await expect(page.getByRole('region', { name: '设计器' })).toBeVisible();
```

用例上方的注释「复制后能改纸张（设计器在 1b）」改成「复制后进设计器」。

- [ ] **Step 6: `bun run check` 和 E2E**

Run: `bun run check && bun run test:e2e`
Expected: 全部通过。

- [ ] **Step 7: 手动看一眼**

Run: `bun run dev`，配置中心 → 模板 → 「吊牌（自由设计示例）」→ 复制：三栏、标尺、网格、安全区虚线；点条码出现 8 个控制点；拖动有洋红参考线；方向键微调；Ctrl+Z 撤销；Esc 取消选中，再按 Esc 回到列表（有修改时弹确认）。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/components/canvas-editor/CanvasDesigner.tsx src/renderer/src/components/config/pages/TemplatesPage.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css e2e/app.e2e.ts
git commit -m "feat(renderer): open canvas templates in the designer" -m "Canvas templates now open in the three-panel designer instead of the interim basics form. The templates page can start a blank canvas template, and the designer's action bar adds a sample print next to discard and save." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

（`git rm` 已经把删除放进暂存区，跟这个提交一起。）

---

### Task 16: E2E

**Files:**
- Modify: `e2e/app.e2e.ts`
- Modify: `e2e/local-api.e2e.ts`

- [ ] **Step 1: 设计器主流程、扫码、试打**（`app.e2e.ts`）

文件头：`import type { ElectronApplication, Page } from '@playwright/test';` 之后加 `import type { FakePrinterSpec } from '../src/main/printing/fake-printers';`；`./support/app-helpers` 的 import 里按顺序加 `fakePrints`（`callApi` 之后）。

1a 的「previews the built-in canvas tag and copies it」用例之后加：

```ts
/** 「打印一张试试」：一台装 60×40 的假打印机（打印只记下来）。 */
const SAMPLE_PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
];
/** 把文字往右拖这么多屏幕像素：在「适合窗口」的倍数下是几毫米，又远大于吸附距离。 */
const DRAG_PX = 40;

// 自由设计：新建空白模板，加文字、拖动、改字号、撤销重做，再加条码看打印前检查，保存后扫码按它排版。
test('designs a canvas template from scratch and uses it for scans', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '新建自由设计模板' }).click();
  const designer = page.getByRole('region', { name: '设计器' });
  await expect(designer).toBeVisible();
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');

  // 加一个文字：放在纸中间、选中；改内容，画布上就是打印的样子。
  await designer.getByRole('button', { name: '添加文字' }).click();
  await designer.getByLabel('内容', { exact: true }).fill('品名 {编码}');
  await expect(label.locator('.line', { hasText: '品名 CL5640-TK' })).toBeVisible();

  // 拖到右边：位置跟着变。
  const x = designer.getByLabel('X', { exact: true });
  const before = Number(await x.inputValue());
  const box = await page.locator('.canvas-overlay__box[data-element-id="e1"]').boundingBox();
  if (box === null) {
    throw new Error('the text box is not on the canvas');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + DRAG_PX, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(before);

  // 改字号，再在画布上用键盘撤销、重做。
  const fontSize = designer.getByLabel('字号', { exact: true });
  await fontSize.fill('5');
  await page.locator('.canvas-overlay').focus();
  await page.keyboard.press('Control+Z');
  await expect(fontSize).toHaveValue('3.5');
  await page.keyboard.press('Control+Y');
  await expect(fontSize).toHaveValue('5');

  // 加一个条码：默认内容 {完整内容} 里有中文，Code 128 印不了，底部写明原因；改成 {编码} 就印出来。
  await designer.getByRole('button', { name: '添加条码' }).click();
  await expect(designer.getByLabel('码制')).toHaveValue('code128');
  const checks = designer.getByRole('region', { name: '打印前检查' });
  await expect(checks).toContainText('条码「条码」');
  await designer.getByLabel('内容', { exact: true }).fill('{编码}');
  await expect(label.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(1);
  await expect(checks).toContainText('没有发现问题');

  // Esc 取消选中（不离开编辑），右栏换成模板设置，改名后保存。
  await page.locator('.canvas-overlay').focus();
  await page.keyboard.press('Escape');
  await designer.getByLabel('模板名称').fill('E2E 吊牌');
  await page.getByRole('button', { name: '保存模板' }).click();
  await expect(page.locator('.template-item', { hasText: 'E2E 吊牌' })).toHaveAttribute('aria-pressed', 'true');

  // 设为当前模板，回到工作台扫码：标签按设计出来的样子排。
  const saved = (await callApi(page, 'listTemplates')).find((template) => template.name === 'E2E 吊牌');
  if (saved === undefined) {
    throw new Error('the designed template was not saved');
  }
  expect(saved.kind === 'canvas' && saved.elements.map((element) => element.kind)).toEqual(['text', 'barcode']);
  await callApi(page, 'updateSettings', { activeTemplateId: saved.id, autoPrint: false });
  await page.reload();
  await scan(page, 'CL5640-TK-图片色-XL');
  await expect(page.frameLocator('.label-frame').locator('.line', { hasText: '品名 CL5640-TK' })).toBeVisible();
});

// 焦点在画布上时扫码：字符不当成快捷键，照样填进「预览内容」，画布按新内容排版。
test('keeps the scanner working while the canvas has focus', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '新建自由设计模板' }).click();
  const designer = page.getByRole('region', { name: '设计器' });
  await designer.getByRole('button', { name: '添加文字' }).click();
  await designer.getByLabel('内容', { exact: true }).fill('{编码}');
  await page.locator('.canvas-overlay').focus();
  await typeLikeScanner(page, ['CL5640-TK-图片色-XL']);
  await expect(page.getByLabel('预览内容')).toHaveValue('CL5640-TK-图片色-XL');
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');
  await expect(label.locator('.line', { hasText: 'CL5640-TK' })).toBeVisible();
  await expect(designer.getByRole('list', { name: '图层' }).getByRole('button')).toHaveCount(1);
});

// 「打印一张试试」：按预览内容把没保存的草稿打到装着这种纸的打印机上。
test('prints one sample of a canvas draft', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: SAMPLE_PRINTERS });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' }, autoPrint: false });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
  await page.getByRole('button', { name: '复制' }).click();
  await page.getByRole('button', { name: '打印一张试试' }).click();
  await expect
    .poll(() => fakePrints(app))
    .toEqual([{ printerName: '标签机A', raw: 'CL5640-TK-图片色-XL', paper: '60x40', templateId: 'custom:draft' }]);
});
```

- [ ] **Step 2: 经本机接口按自己设计的模板打印**（`local-api.e2e.ts`）

1a 的「prints a canvas template through the local API」之后加：

```ts
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
```

（6901234567892 的校验位是对的：6+27+0+3+2+9+4+15+6+21+8+27 = 128，(10 − 8) mod 10 = 2。）

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e`
Expected: 全部通过。

- [ ] **Step 4: `bun run check` 后提交**

```bash
git add e2e/app.e2e.ts e2e/local-api.e2e.ts
git commit -m "test(e2e): design, scan, sample-print and API-print a canvas template" -m "Covers creating a blank template, adding, dragging and editing elements with undo and redo, the pre-print check for a barcode that cannot be encoded, saving and scanning with it, the scanner still filling the preview content while the canvas has focus, the sample print, and printing a designed template through the local API." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 17: 视觉验收 V45–V48

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（验收表）

前提：1a 的 Task 12 已经加了 V44（「模板 · 自由设计 · 吊牌示例」）。如果文件里还没有 V44，先按 1a 计划补上再做这一步，编号才连续。

- [ ] **Step 1: 两个操作**（`waybillCase` 函数之后加）

```ts
/** V45–V48：复制内置的吊牌示例，进设计器。 */
async function openCanvasDesigner(page: Page): Promise<void> {
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: '吊牌（自由设计示例）' }).click();
  await page.getByRole('button', { name: '复制' }).click();
  await expect(page.getByRole('region', { name: '设计器' })).toBeVisible();
}

/** 在图层列表里点选一个元素（名字形如「编码条码（条码）」）。 */
async function selectLayer(page: Page, name: string): Promise<void> {
  await page.getByRole('list', { name: '图层' }).getByRole('button', { name }).click();
}
```

- [ ] **Step 2: 四个验收项**（`ITEMS` 末尾、V44 之后加）

```ts
  {
    id: 'V45',
    title: '模板 · 自由设计 · 设计器（1280px）',
    points:
      '三栏：左边 7 种元素、中间画布、右边属性和图层；工具条按组排开，放不下时整组换行、按钮文字不裁；画布有毫米标尺、1mm 网格、1.5mm 安全区虚线；选中的条码有蓝色选框和 8 个控制点；画布就是打印的样子（Code128、二维码、表格格线）；底部打印前检查写「没有发现问题」，操作条有「打印一张试试」',
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
      '没有横向滚动；属性栏收窄到 260px 仍放得下标签和数字框；工具条换成两三行；画布缩到放得下整张标签；选中的文字属性栏里「内容」框完整',
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
      'Shift 多选三个文字：每个都有选框、没有控制点，属性栏写「已选 3 个元素」，等距按钮可用；放大一档后画布出现滚动条，标尺和网格跟着放大、不糊',
    sizes: [SIZE_1920],
    setup: async ({ page }) => {
      await openCanvasDesigner(page);
      await selectLayer(page, '编码（文字）');
      const layers = page.getByRole('list', { name: '图层' });
      await layers.getByRole('button', { name: '货架号（文字）' }).click({ modifiers: ['Shift'] });
      await layers.getByRole('button', { name: '日期（文字）' }).click({ modifiers: ['Shift'] });
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
      { label: '二维码', prepare: ({ page }) => selectLayer(page, '二维码（二维码）') },
      { label: '图片', prepare: ({ page }) => selectLayer(page, '图片（图片）') },
      { label: '线', prepare: ({ page }) => selectLayer(page, '分隔线（线）') },
      { label: '矩形', prepare: ({ page }) => selectLayer(page, '矩形（矩形）') },
      { label: '表格', prepare: ({ page }) => selectLayer(page, '颜色尺码（表格）') },
    ],
  },
```

文件头注释里的验收范围（现在是「V01–V43」或 1a 改成的「V01–V44」）改成「V01–V48」。

- [ ] **Step 3: 设计文档的验收表**（`2026-09-29-config-center-layout-design.md`，`| V44 |` 那一行之后加）

```
| V45 | 模板 · 自由设计 · 设计器（1280px） | 三栏；工具条整组换行、文字不裁；毫米标尺、1mm 网格、1.5mm 安全区虚线；选中元素蓝框 + 8 个控制点；画布即打印 HTML；底部打印前检查和「打印一张试试」 |
| V46 | 模板 · 自由设计 · 设计器（1024px） | 无横向滚动；属性栏 260px 放得下标签和数字框；工具条换行；画布放得下整张标签 |
| V47 | 模板 · 自由设计 · 多选和放大（1920px） | 多选有选框无控制点、属性栏「已选 3 个元素」、等距可用；放大后可滚动，标尺和网格清晰 |
| V48 | 模板 · 自由设计 · 元素属性 | 七种元素的属性栏逐张核对：对齐、单位、不换行；条码码制分组；EAN-13 内容不合时检查写明原因；图片、表格的操作 |
```

- [ ] **Step 4: 跑视觉验收**

Run: `bun run build && bunx playwright test --config e2e/visual/playwright.config.ts -g "V4[5-8]"`
Expected: 4 项通过（自动检查没有问题）。打开 `test-results/visual-acceptance/` 里 V45–V48 的截图逐条核对上面的要点；Windows 再看 150% 缩放，macOS 看红绿灯区域。

- [ ] **Step 5: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance shots for the canvas designer" -m "V45 to V48 capture the designer at 1280, 1024 and 1920 pixels and the property panel of every element kind, including the pre-print check for an EAN-13 barcode whose content does not fit." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

---

### Task 18: 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（3.2 的 renderer 一行、3.3 整节、3.4 第 6 条）
- Modify: `src/renderer/CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: 设计文档**

3.2 节表格里 renderer 一行换成：

```
| renderer | `components/canvas-editor/*`、`lib/canvas-edit.ts`（及 `canvas-snap`、`canvas-history`、`canvas-table`、`canvas-view`、`gray-image`） | 三栏编辑器；移动、缩放、对齐、等距、吸附、撤销重做、复制粘贴、表格行列、图片转灰度都是 `lib/` 里的纯函数，有单元测试；图片文件在页面里解码，模板里只存灰度像素 |
```

3.3 节（从「### 3.3 编辑器」下面第一条到「拖动吸附到纸边、安全边距、其他元素的边和中线。」）换成：

```
- **入口**：模板页「新建自由设计模板」（空白、60×40，进设计器后在右栏改纸张），或复制内置的吊牌示例；自定义的自由设计模板点「编辑」进设计器。
- **顶部**：撤销、重做；复制、粘贴、删除；对齐（左中右、上中下：选一个时对齐到安全区，选几个时对齐到它们的外框）、等距（选三个以上）；置顶、置底；网格、吸附开关；缩放（缩小、放大、适合窗口，Ctrl+滚轮）；预览内容（默认最近一次扫码，可自填；配置中心里扫码也填进来）。
- **左**：7 种元素，点一下放到画布中间，或拖到画布上松手的位置。
- **中**：毫米标尺、1mm 网格、安全边距虚线（纸边往里 1.5mm）。画布是**真实打印 HTML**（和模板页预览同一条路，草稿变了 150 毫秒后重新排版），上面一层透明覆盖层画选框、控制点、参考线和框选；拖动时只动覆盖层，松手才改模板、重新排版。所见即所打。
- **右**：没选中时是模板的名称、纸张、打印机；选中一个时是它的属性（位置、大小、旋转、锁定 + 本类设置，「插入字段」下拉）；选中几个时提示能做的操作。下面是图层列表（上层在前，只用来点选，Shift 加选）。
- **底部**：打印前检查（见 3.4）；操作条「放弃修改」「打印一张试试」「保存模板」。「打印一张试试」按预览内容打印没保存的草稿，和预览一样识别、加工，不写打印记录、不占防重复窗口。
- **键盘、鼠标**：点选、Shift 加选、框选（碰到就算）；方向键 0.1mm、Shift+方向键 1mm；Delete / Backspace 删除；Esc 取消选中（没选中时照常返回列表）；Ctrl+C / V（设计器自己的剪贴板：页面没有系统剪贴板权限）；Ctrl+Z / Y（最多 100 步，同一个输入框连续输入、连续按方向键各算一步）；Ctrl+滚轮缩放；双击文字把焦点放进右栏的「内容」框。拖动吸附到纸边、安全边距、纸的中线、其他元素的边和中线（网格只显示，不吸）。锁定的元素不能拖动、缩放、删除。
- **扫码不受影响**：画布是可聚焦的区域，不是输入框；它只处理方向键、Delete、Esc 和 Ctrl 组合键，字母数字照常被当作扫码送进「预览内容」。
```

3.4 节第 6 条换成：

```
6. 图片太大：选图时按像素上限（单张 1MB 灰度像素、边长 4000）缩小后存；文件超过 20MB 不读；整个模板的图片超过 4MB 不插入，并说明上限。
```

- [ ] **Step 2: `src/renderer/CLAUDE.md`**

「## 播报与提示音」之前加一节：

```
## 自由设计的设计器

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3.3 节。

- **分层**：纯逻辑在 `lib/canvas-edit.ts`（移动、缩放、旋转、增删、对齐、等距、叠放、复制粘贴、框选）、`canvas-snap.ts`、`canvas-history.ts`、`canvas-table.ts`、`canvas-view.ts`（缩放档位、按键 → 命令）、`gray-image.ts`；状态在 `view-models/use-canvas-designer.ts`（选中、撤销历史、剪贴板、缩放、开关）、`use-canvas-gesture.ts`（拖动、缩放、框选）、`use-image-import.ts`；组件在 `components/canvas-editor/`。
- **画布就是预览**：标签是模板页预览的同一份 HTML（`previewTemplate`），透明覆盖层只画框；拖动时只动覆盖层，松手才改草稿。不要在覆盖层上自己画元素内容。
- **扫码**：画布是可聚焦的 `div`，不是输入框；只处理方向键、Delete / Backspace、Esc、Ctrl / ⌘ 组合键（`designerCommand`，有测试）。不要拦字母、数字做快捷键，也不要给画布加 `data-keep-focus`（那只对工作台有意义）：配置中心要把扫码枪的字符送进「预览内容」。
- **改模板只经 `commit`**：先记撤销历史再交给草稿；同一个字段的连续输入用同一个合并键。
- **剪贴板**在设计器的内存里；**图片**在页面里解码，模板只存灰度像素。
```

同一文件「**不能打印的界面**」那条的句末加：「模板页设计器的「打印一张试试」同样是明确点的按钮，照常打印（不写打印记录）。」

- [ ] **Step 3: `README.md`**

「打印模板」下 `  - 快递面单按毫米分行分格排版：……复制后可以逐格修改。` 那一条之后加：

```
  - 自由设计模板（吊牌、价签、商品条码）：在设计器里把文字、条码（Code128、EAN-13、UPC、Code39、ITF-14 等常用码制，另有 Data Matrix、PDF417 等）、二维码、图片（自动转黑白）、线、矩形、表格摆到标签上。画布显示的就是打印出来的样子；支持对齐、等距、吸附参考线、撤销重做、复制粘贴、方向键微调；底部列出打印前检查（例如条码位数不对、元素靠近纸边），可以先「打印一张试试」。在配置中心「模板」页点「新建自由设计模板」，或复制内置的吊牌示例。
```

- [ ] **Step 4: `docs/roadmap.md`**

状态表里「| 驱动生态、云打印机……」那一行之前加：

```
| 标签设计器（自由设计模板）：画布上摆文字、条码（常用 10 种 + 更多）、二维码、黑白图片、线、矩形、表格；三栏编辑器，画布就是打印的 HTML；对齐、等距、吸附、撤销重做；打印前检查；打印一张试试 | 必须 | 进行中：第 1 个子项目（`feature/canvas-designer`），1a 模型与渲染、1b 编辑器已完成；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3 节。热敏标签机真机出纸、扫码枪逐个码制扫一遍待验收 |
```

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add docs/superpowers/specs/2026-10-01-feature-parity-design.md src/renderer/CLAUDE.md README.md docs/roadmap.md
git commit -m "docs: describe the canvas designer" -m "Records the editor decisions (entry points, sample print, scanner handling, lock, align, clipboard, undo, snapping, image limits) in the design, the renderer rules for the designer, and the feature in the README and roadmap." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK"
```

- [ ] **Step 6: 推送、开 PR**

```bash
git push -u origin feature/canvas-designer
gh pr create --base master --title "feat: canvas templates and the designer (1a + 1b)" --body "<中文说明：做了什么、为什么、验证（单元测试、E2E、V44–V48 截图核对、平台）；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过；只在一个平台上人工验证过的（真机打印、缩放截图）在 PR 说明里写明。

---

## Self-Review 记录

- **设计覆盖（第 3.3 节）**
  - 顶部：撤销重做 → Task 1、10、13；复制粘贴删除 → Task 2、3、10、13；对齐、等距 → Task 3、13；置顶置底 → Task 3、13；网格、吸附开关 → Task 5、12、13；缩放（适合、放大、缩小）→ Task 4、13、15；预览数据 → Task 13（`SampleInput` 进工具条）。
  - 左：7 种元素点击添加、拖到画布 → Task 2（`addElement` 带中心点）、Task 12（`onDrop`）、Task 13（`ElementPalette`）。
  - 中：毫米标尺、1mm 网格、1.5mm 安全区 → Task 12；真实打印 HTML + 透明覆盖层、拖动只动覆盖层 → Task 11、12、15。
  - 右：属性（位置、大小、旋转、锁定、本类设置、插入字段）→ Task 14；图层列表 → Task 13。
  - 底部：打印前检查、放弃修改 / 打印一张试试 / 保存 → Task 9、15。
  - 键盘鼠标：点选、Shift 加选、框选 → Task 3、11、13；方向键 0.1 / 1mm、Delete、Ctrl+C/V、Ctrl+Z/Y → Task 4、10；Ctrl+滚轮 → Task 11；双击文字改内容 → Task 12、14、15；吸附纸边、安全区、元素边和中线 → Task 5、11。
  - 扫码焦点 → Task 4（`designerCommand` 的测试）、Task 15（Esc 只在有选中时拦下）、Task 16（焦点在画布上扫码的 E2E）。
- **第 3.4 节**：1 靠近纸边、2 条码、3 二维码、4 字段缺失、5 文字截断由 1a 的排版给出，这里在底部列出（Task 15，E2E 在 Task 16 核对条码那条）；6 图片太大 → Task 7（像素预算、模板总量）、Task 10（选图时的提示）。
- **新建入口、打印一张试试** → Task 8、9、15。
- **没有占位**：每个代码步骤都给了完整代码；Task 12 的 Biome 无障碍规则写了确定的处理办法；Task 17 写明依赖 1a 的 V44。
- **类型一致**：`Box`、`Point`、`ResizeHandle`、`Alignment`、`DistributeAxis`、`MIN_DISTRIBUTE_COUNT` 都从 `canvas-edit.ts` 导出（Task 2、3），Task 5、10、11、12、13 用的就是这些名字；`Guide`、`Snapped` 从 `canvas-snap.ts`（Task 5），Task 11 用；`DesignerCommand`、`ELEMENT_DRAG_TYPE`、`PX_PER_MM` 从 `canvas-view.ts`（Task 4）；`GestureView`、`GestureHandlers` 从 `use-canvas-gesture.ts`（Task 11），Task 12 用；`CanvasDesignerViewModel` 从 `use-canvas-designer.ts`（Task 10），Task 13 用；`SampleContent` 从 `SampleInput.tsx`（Task 13），Task 13、15 用；`CANVAS_ELEMENT_LABELS`（Task 13）在 Task 13、14 用；`printSample`、`createCanvasTemplate` 的签名在 Task 8、9 的契约、主进程、preload、视图模型里一致。
- **每个提交都能过 `bun run check`**：组件在 Task 12–14 先建好但还没被引用（类型检查照样覆盖），Task 15 一次接进模板页并删掉过渡表单。
