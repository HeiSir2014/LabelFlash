# 工作台 + 配置中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「左边扫码 + 右边 5 个标签页」改成「工作台 + 全窗口配置中心」，并补齐审查发现的界面缺口，全部通过逐项视觉验收后随 1.0.1 发布。

**Architecture:**
- 视图状态、扫码路由、字段名候选都是渲染层的纯逻辑（`src/renderer/src/lib/`），有完整单元测试；组件只负责展示。
- 工作台和配置中心是同一个窗口里的两个视图：配置中心是标题栏以下的覆盖层，打开时工作台设为 `inert`，F2 和自动回焦按视图启停。
- 现有编辑组件（模板编辑器、规则编辑器、加工步骤、试一试、查找表、密钥、通知、语音）只换容器；`SettingsForm` 拆成各页面。主进程只加一个 `lookup:rows` 通道。

**Tech Stack:** 沿用现有：Bun 1.4、Electron 44、React 19、TypeScript 5.9 strict、Biome 2、Playwright。无新增依赖。

**执行方式:**
- 本会话在分支 `feature/config-center`（基于 `feature/phase1-desktop-client`）上内联执行，每个任务先写失败的测试，再写实现。
- 纯逻辑模块在计划里给出完整代码和测试；界面组件给出结构、接口、样式和验收点，完整代码以对应提交为准。
- 每个任务结束：`bun run check` 零问题，涉及界面的任务再跑 `bun run test:e2e` 并截图自查；提交后回填提交号。
- 全部任务完成后做 §Task 8 的逐项视觉验收，需求方逐项确认后才合回 `feature/phase1-desktop-client`。

## 执行记录

| 任务 | 提交 | 与计划不同的地方（原因） |
|---|---|---|
| 1 纯逻辑 | d62acd9 | — |
| 2 `lookup:rows`、第 20 句 | d535845 | — |
| 3 工作台工具条、正在查询、扫码框 | e0e4882 | 工具条说明由 `lib/preview-usage.ts` 生成，分「规则」「模板」两段，放不下时先省略规则名（1280 宽时模板名和「规则指定」要完整可见）；「正在查询」放在 `ScanContext.queryingRaw`（查询中的是新扫的码，快照里还是上一张）；1024 宽时备注和自动打印整体换行（扫码框原来只剩 128px）。 |
| 4 配置中心框架和四页 | 774aa7d | `.button--primary` 只管颜色，大号改用 `.button--large`（页面操作不该像工作台的打印按钮）；「配置」按钮用和打印机胶囊一样的全圆角。 |
| 5 模板页 | cef4bc9 | `hover-intent.ts` 改名 `timers.ts`，只留计时器接口；配置中心打开时提示条抬到操作条上方（「已保存」曾挡住「使用」8 秒）；带候选的输入框里 Esc 只收起下拉。 |
| 6 规则、查找表、密钥、通知 | 40615b7 | 查找表行预览、复制引用各用一个 view-model（`use-lookup-preview`、`use-copy-text`）；复制经新增的 IPC `clipboard:write-text` 由主进程代写（最初放开过 `clipboard-sanitized-write` 网页权限，违反「权限一律拒绝」的安全底线，已改回）；关闭配置中心时工作台立即恢复，配置中心只淡出（淡出期间扫的码曾丢失）。 |
| 7 配置中心扫码、跳转链接 | 0faec25 | 扫码先进隐藏的接收框（和扫码框共用 `use-scan-input.ts`），拼好后替换测试框内容，而不是把焦点切进测试框（那样新码会接在旧内容后面，Tab 也会带走焦点）；通知接口的草稿也纳入未保存确认（`use-endpoint-editor.ts`）。 |
| 8 视觉验收 | 0bc3baf、1ca2cc5 | 验收页面是手写的 HTML（读 `manifest.json` 和截图），不用脚本生成报告；需求方的确认保存在验收页面里。验收顺带发现并修好 macOS 全屏会被立刻退出的问题（0bc3baf）。 |

## Global Constraints

- 规格：`docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（下称「规格」）。
- 最小窗口 1024×680：任何页面不出现横向滚动条，文字不被意外截断（省略号 + 悬停提示除外）。
- 配置中心里**永远不打印**：扫码不打印，F2 不响应。
- 设计变量只用 `src/renderer/src/styles/tokens.css` 里已有的（颜色、`--space-*`、`--radius`）；新增尺寸写成 CSS 变量或命名常量。
- 语音共 20 句，新增一句「正在配置，没有打印」（提醒级）。
- 只用 Edit / Write 改文件；仓库和提交信息里不出现参考产品、竞品或打印机品牌。
- 文案：中文，按钮说清楚会发生什么；指向其他页面的文案做成跳转链接（规格 §5.9）。

## 文件结构

新增：

| 文件 | 职责 |
|---|---|
| `src/renderer/src/lib/app-view.ts` | 视图类型、配置中心导航表、返回逻辑、快捷键判定 |
| `src/renderer/src/lib/scan-routing.ts` | 按视图决定扫码目标、是否启用工作台回焦 |
| `src/renderer/src/lib/field-names.ts` | 从规则和识别结果收集字段名候选 |
| `src/renderer/src/view-models/use-app-view.ts` | 视图状态、离开前确认、快捷键、Esc |
| `src/renderer/src/components/LabelPreview.tsx` | 软尺 + iframe + 自适应缩放（从 `PreviewStage` 抽出） |
| `src/renderer/src/components/workbench/Workbench.tsx` | 工作台布局：扫码栏、预览区、右侧栏 |
| `src/renderer/src/components/workbench/PreviewToolbar.tsx` | 当前模板下拉框 + 本张的规则和模板 |
| `src/renderer/src/components/workbench/WorkbenchSide.tsx` | 打印机、打印记录两个标签 |
| `src/renderer/src/components/config/ConfigCenter.tsx` | 覆盖层框架：导航、页头、内容、确认框 |
| `src/renderer/src/components/config/ConfirmDialog.tsx` | 应用内确认框 |
| `src/renderer/src/components/config/pages/*.tsx` | 9 个页面 |
| `src/renderer/src/view-models/use-scan-sink.ts` | 配置中心里的隐藏接收框（拼接扫码、提醒） |
| `e2e/visual/capture.e2e.ts`、`e2e/visual/checks.ts`、`e2e/visual/report.ts` | 视觉验收截图、自动检查、报告 |

修改：`App.tsx`、`TitleBar.tsx`、`ScanBar.tsx`、`PreviewStage.tsx`、`JobLog.tsx`、`use-scan-focus.ts`、`use-hotkey.ts`、`use-scan-station.ts`、`use-rules.ts`、`use-templates.ts`、`status-text.ts`、`feedback-cues.ts`、`StepForms.tsx`、`WebhookSettings.tsx`、`FieldsAreaEditor.tsx`、`TemplateEditor.tsx`、`RulePanel.tsx`（拆成页面后删除）、`app.css`、`src/shared/voice.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/main/ipc.ts`、`src/main/lookup/lookup-tables.ts`、`src/main/storage/sqlite-lookup-store.ts`、`e2e/app.e2e.ts`。

删除：`SidePanel.tsx`、`TemplatePanel.tsx`、`SettingsForm.tsx`、`use-hover-preview.ts`（以及 `hover-intent.ts` 里只给悬停预览用的 `HoverIntent`）。

---

### Task 1: 视图、扫码路由、字段名候选（纯逻辑）

**Files:**
- Create: `src/renderer/src/lib/app-view.ts`、`src/renderer/src/lib/scan-routing.ts`、`src/renderer/src/lib/field-names.ts`
- Test: `src/renderer/src/lib/app-view.test.ts`、`src/renderer/src/lib/scan-routing.test.ts`、`src/renderer/src/lib/field-names.test.ts`

**Interfaces（Produces）:**
- `CONFIG_PAGES`、`type ConfigPage`、`CONFIG_NAV: readonly NavGroup[]`、`pageLabel(page): string`
- `type AppView = { kind: 'workbench' } | { kind: 'config'; page: ConfigPage }`、`WORKBENCH`
- `backStep(view, isEditing): 'close-editor' | 'close-config' | 'none'`
- `isConfigShortcut(event, platform): boolean`、`configShortcutLabel(platform): string`
- `scanTargetFor(view): 'scan-box' | 'test-box' | 'sink'`、`isWorkbenchActive(view): boolean`
- `ruleFieldNames(rule): string[]`、`fieldNameSuggestions(rules, scan): string[]`

- [ ] **Step 1: 写失败的测试**

`app-view.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';
import {
  backStep,
  CONFIG_NAV,
  CONFIG_PAGES,
  configShortcutLabel,
  isConfigShortcut,
  pageLabel,
  WORKBENCH,
} from './app-view';

const key = (overrides: Partial<Parameters<typeof isConfigShortcut>[0]> = {}) => ({
  key: ',',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('config navigation', () => {
  test('lists every page exactly once, in four groups', () => {
    const pages = CONFIG_NAV.flatMap((group) => group.pages.map((item) => item.page));
    expect(pages).toEqual([...CONFIG_PAGES]);
    expect(CONFIG_NAV.map((group) => group.label)).toEqual(['标签', '识别', '集成', '系统']);
    expect(pageLabel('notes')).toBe('常用备注');
  });
});

describe('backStep', () => {
  test('closes an open editor first, then the config center, and does nothing on the workbench', () => {
    expect(backStep({ kind: 'config', page: 'rules' }, true)).toBe('close-editor');
    expect(backStep({ kind: 'config', page: 'rules' }, false)).toBe('close-config');
    expect(backStep(WORKBENCH, false)).toBe('none');
  });
});

describe('config shortcut', () => {
  test('is Ctrl+, on Windows and ⌘, on macOS, without other modifiers', () => {
    expect(isConfigShortcut(key({ ctrlKey: true }), 'other')).toBe(true);
    expect(isConfigShortcut(key({ metaKey: true }), 'mac')).toBe(true);
    expect(isConfigShortcut(key({ ctrlKey: true }), 'mac')).toBe(false);
    expect(isConfigShortcut(key({ ctrlKey: true, shiftKey: true }), 'other')).toBe(false);
    expect(isConfigShortcut(key(), 'other')).toBe(false);
    expect(configShortcutLabel('mac')).toBe('⌘,');
    expect(configShortcutLabel('other')).toBe('Ctrl+,');
  });
});
```

`scan-routing.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';
import { WORKBENCH } from './app-view';
import { isWorkbenchActive, scanTargetFor } from './scan-routing';

describe('scanTargetFor', () => {
  test('uses the scan box on the workbench', () => {
    expect(scanTargetFor(WORKBENCH)).toBe('scan-box');
  });

  test('fills the try-it box on pages that have one, and swallows scans elsewhere', () => {
    expect(scanTargetFor({ kind: 'config', page: 'rules' })).toBe('test-box');
    expect(scanTargetFor({ kind: 'config', page: 'templates' })).toBe('test-box');
    expect(scanTargetFor({ kind: 'config', page: 'general' })).toBe('sink');
    expect(scanTargetFor({ kind: 'config', page: 'secrets' })).toBe('sink');
  });
});

describe('isWorkbenchActive', () => {
  test('enables printing shortcuts and auto refocus only on the workbench', () => {
    expect(isWorkbenchActive(WORKBENCH)).toBe(true);
    expect(isWorkbenchActive({ kind: 'config', page: 'about' })).toBe(false);
  });
});
```

`field-names.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES } from '../../../core/scan/builtin-rules';
import type { ScanRule } from '../../../core/scan/rule-model';
import type { ScanResult } from '../../../core/scan/scan-result';
import { fieldNameSuggestions, ruleFieldNames } from './field-names';

const REGEX_WITH_STEPS: ScanRule = {
  id: 'custom:re',
  name: '正则',
  kind: 'regex',
  pattern: '^(?<单号>\\w+)#(?<尺码>\\w+)$',
  flags: '',
  steps: [
    { kind: 'template', text: 'x', output: '链接' },
    {
      kind: 'lookup',
      input: '单号',
      tableId: 't',
      keyColumn: '单号',
      ignoreCase: false,
      outputs: [{ column: '货架', field: '货架号' }],
    },
  ],
};

describe('ruleFieldNames', () => {
  test('collects recognised fields and fields produced by processing steps', () => {
    expect(ruleFieldNames(REGEX_WITH_STEPS)).toEqual(['单号', '尺码', '链接', '货架号']);
    expect(ruleFieldNames(BUILT_IN_RULES[0] as ScanRule)).toEqual(['编码', '颜色', '尺码']);
  });

  test('ignores a regex that no longer compiles', () => {
    expect(ruleFieldNames({ ...REGEX_WITH_STEPS, pattern: '(', steps: [] })).toEqual([]);
  });
});

describe('fieldNameSuggestions', () => {
  test('lists this scan first, then the rules in order, without duplicates', () => {
    const scan: ScanResult = {
      raw: 'x',
      ruleId: 'builtin:raw',
      ruleName: '原样打印',
      fields: [{ name: '内容', value: 'x' }, { name: '尺码', value: 'M' }],
    };
    const suggestions = fieldNameSuggestions([...BUILT_IN_RULES, REGEX_WITH_STEPS], scan);
    expect(suggestions.slice(0, 4)).toEqual(['内容', '尺码', '编码', '颜色']);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect(suggestions).toContain('货架号');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `bun test src/renderer/src/lib/app-view.test.ts src/renderer/src/lib/scan-routing.test.ts src/renderer/src/lib/field-names.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`app-view.ts`：

```ts
/** 配置中心的页面，顺序就是导航顺序。 */
export const CONFIG_PAGES = [
  'templates',
  'notes',
  'rules',
  'lookup',
  'secrets',
  'webhooks',
  'voice',
  'general',
  'about',
] as const;
export type ConfigPage = (typeof CONFIG_PAGES)[number];

export interface NavGroup {
  label: string;
  pages: ReadonlyArray<{ page: ConfigPage; label: string }>;
}

export const CONFIG_NAV: readonly NavGroup[] = [
  { label: '标签', pages: [{ page: 'templates', label: '模板' }, { page: 'notes', label: '常用备注' }] },
  {
    label: '识别',
    pages: [
      { page: 'rules', label: '识别规则' },
      { page: 'lookup', label: '查找表' },
      { page: 'secrets', label: '密钥' },
    ],
  },
  { label: '集成', pages: [{ page: 'webhooks', label: '打印结果通知' }] },
  {
    label: '系统',
    pages: [
      { page: 'voice', label: '语音播报' },
      { page: 'general', label: '通用' },
      { page: 'about', label: '关于' },
    ],
  },
];

const PAGE_LABELS = new Map(CONFIG_NAV.flatMap((group) => group.pages.map((item) => [item.page, item.label])));

export function pageLabel(page: ConfigPage): string {
  return PAGE_LABELS.get(page) ?? page;
}

/** 整个窗口只有两种视图：工作台，或配置中心的某一页。 */
export type AppView = { kind: 'workbench' } | { kind: 'config'; page: ConfigPage };

export const WORKBENCH: AppView = { kind: 'workbench' };

export type BackStep = 'close-editor' | 'close-config' | 'none';

/** Esc 和「返回」：编辑器开着就先回到列表，否则关掉配置中心回工作台。 */
export function backStep(view: AppView, isEditing: boolean): BackStep {
  if (view.kind === 'workbench') {
    return 'none';
  }
  return isEditing ? 'close-editor' : 'close-config';
}

export type Platform = 'mac' | 'other';

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 打开 / 关闭配置中心：Windows 是 Ctrl+,，macOS 是 ⌘,（系统惯例的「设置」快捷键）。 */
export function isConfigShortcut(event: ShortcutKey, platform: Platform): boolean {
  const primary = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return event.key === ',' && primary && !event.altKey && !event.shiftKey;
}

export function configShortcutLabel(platform: Platform): string {
  return platform === 'mac' ? '⌘,' : 'Ctrl+,';
}
```

`scan-routing.ts`：

```ts
import type { AppView, ConfigPage } from './app-view';

export type ScanTarget = 'scan-box' | 'test-box' | 'sink';

/** 有测试框的页面：识别规则的「试一试」、模板的「预览内容」。在这些页面扫码，内容填进测试框。 */
const PAGES_WITH_TEST_BOX: ReadonlySet<ConfigPage> = new Set(['rules', 'templates']);

/** 焦点不在输入框时，扫码枪打出的字符送到哪里（配置中心里永远不打印）。 */
export function scanTargetFor(view: AppView): ScanTarget {
  if (view.kind === 'workbench') {
    return 'scan-box';
  }
  return PAGES_WITH_TEST_BOX.has(view.page) ? 'test-box' : 'sink';
}

/** F2 打印和扫码框的自动回焦只在工作台生效：配置中心里管理员在填表，焦点留在他放的位置。 */
export function isWorkbenchActive(view: AppView): boolean {
  return view.kind === 'workbench';
}
```

`field-names.ts`：

```ts
import { namedGroups, type ScanRule } from '../../../core/scan/rule-model';
import type { ScanResult } from '../../../core/scan/scan-result';

/** 一条规则能产出的字段名：识别出的字段 + 加工步骤产出的字段，按出现顺序。 */
export function ruleFieldNames(rule: ScanRule): string[] {
  return [...recognisedNames(rule), ...rule.steps.flatMap(stepOutputs)];
}

/** 字段名候选：先列这次识别出的字段，再按规则顺序列其余字段，去重。 */
export function fieldNameSuggestions(rules: readonly ScanRule[], scan: ScanResult | null): string[] {
  const names = [...(scan?.fields.map((field) => field.name) ?? []), ...rules.flatMap(ruleFieldNames)];
  return [...new Set(names)];
}

function recognisedNames(rule: ScanRule): string[] {
  switch (rule.kind) {
    case 'delimited':
      return rule.fields;
    case 'keyValue':
      return rule.fields.map((field) => field.name);
    case 'whole':
      return [rule.field];
    case 'regex':
      try {
        return namedGroups(rule.pattern, rule.flags);
      } catch {
        // 编辑中的正则可能暂时写不对：不给候选即可。
        return [];
      }
  }
}

function stepOutputs(step: ScanRule['steps'][number]): string[] {
  switch (step.kind) {
    case 'template':
    case 'regexReplace':
      return [step.output];
    case 'lookup':
    case 'http':
      return step.outputs.map((output) => output.field);
  }
}
```

- [ ] **Step 4: 运行，确认通过**；`bun run check` 零问题。
- [ ] **Step 5: 提交** `feat(ui): view model for the config center, scan routing and field-name suggestions`

---

### Task 2: `lookup:rows` 通道与第 20 句播报

**Files:**
- Modify: `src/main/storage/sqlite-lookup-store.ts`（`loadRows(id, limit)`）、`src/main/lookup/lookup-tables.ts`（`rows(id, limit)`）、`src/shared/ipc-contract.ts`（`ListLookupRows: 'lookup:rows'`，`listLookupRows(id): Promise<LookupTableData | null>`）、`src/preload/index.ts`、`src/main/ipc.ts`、`src/shared/voice.ts`、`src/renderer/src/lib/feedback-cues.ts`
- Test: `sqlite-lookup-store.test.ts`、`lookup-tables.test.ts`、`voice.test.ts`、`src/main/voice/voice-clips.test.ts`（按 `VOICE_CUES.length` 断言，不写死）

**Interfaces（Produces）:**
- `LOOKUP_PREVIEW_ROWS = 20`（`src/core/lookup/lookup-model.ts`）
- `window.api.listLookupRows(id): Promise<LookupTableData | null>`：最多 20 行
- `VoiceCue` 新增 `'configuring'`，文案「正在配置，没有打印」，级别 `notice`
- `FeedbackEvent` 新增 `{ kind: 'configuring' }` → cue `configuring`

- [ ] **Step 1: 写失败的测试**
  - 存储：建一张 30 行的表，`loadRows(id, 20)` 返回列名和前 20 行，顺序与导入一致；不存在的表返回 null。SQL：`SELECT cells FROM lookup_rows WHERE table_id = :id ORDER BY row_index LIMIT :limit`。
  - `LookupTables.rows(id)`：返回 `LOOKUP_PREVIEW_ROWS` 行。
  - 语音：`VOICE_CUES` 长度 20；`describeFeedback({ kind: 'configuring' })` 为 `{ cue: 'configuring', tone: 'warning' }`。
- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**：IPC 参数用 `requireLookupTableId` 校验；voice-clips 的预热自动包含新句子（遍历 `VOICE_CUES`）。
- [ ] **Step 4: 运行，确认通过**；`bun run check`。
- [ ] **Step 5: 提交** `feat: preview lookup table rows and announce scans made while configuring`

---

### Task 3: 工作台：预览工具条、正在查询、扫码框对齐

**Files:**
- Create: `src/renderer/src/components/LabelPreview.tsx`、`src/renderer/src/components/workbench/PreviewToolbar.tsx`
- Modify: `PreviewStage.tsx`（用 `LabelPreview`，去掉角标，只留二维码放不下的提示）、`use-scan-station.ts`（`isQuerying`）、`status-text.ts`（`describeScan` 的 querying 分支）、`ScanBar.tsx` + `app.css`（对齐）、`JobLog.tsx`（占位文字）、`App.tsx`
- Test: `status-text.test.ts`、`e2e/app.e2e.ts`（角标断言改成工具条）

**Interfaces:**
- `LabelPreview({ html, qrOmitted, feedKey, maxScale, placeholder })`：软尺 + iframe + `useFitScale`
- `PreviewToolbar({ templates, activeTemplateId, onActivate, usage })`，`usage: { kind: 'sample'; templateName } | { kind: 'scan'; ruleName; templateName; isRuleBound } | null`
- `ScanSnapshot` 增加 `isQuerying: boolean`；`describeScan` 在 `isQuerying` 时返回 `{ tone: 'pending', title: '正在查询…', detail: 扫码内容首行 }`
- `use-scan-station`：`load()` 发出预览请求后启动 `QUERYING_DELAY_MS = 200` 的计时器，到点仍未返回就把当前扫描标成 `isQuerying: true`（沿用上一张的预览，不清空），返回后清除。
- `isRuleBound`：`LabelPreview` 需要知道模板是不是规则指定的 → 预览结果 `LabelPreview` 增加 `isTemplateBound: boolean`（主进程 `renderPreview` 按 `templateIdFor(settings.ruleSettings, scan.ruleId) !== null && 模板存在` 计算），同步改 `ipc-contract.ts`、`src/main/ipc.ts`。

- [ ] **Step 1: 失败的测试**
  - `status-text.test.ts`：querying 时标题「正在查询…」，没有操作按钮；不影响已有分支。
  - E2E：扫样衣码后 `.preview-toolbar__usage` 文字为「规则：横杠三段（编码-颜色-尺码） · 模板：样衣标准（二维码在左）（规则指定）」；扫订单号为「规则：纯数字订单号 · 模板：通用（二维码在左）」；空闲时为「示例内容 · 模板：通用（二维码在左）」；工具条下拉框切换到「通用（二维码在右）」后预览 body 带 `layout-qr-right`。
- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**
  - 工具条：高 44px，`--color-paper` 底，底边 1px `--color-rule`，左右内边距 `--space-4`；左「当前模板」+ `select`（宽 220px）；右 usage 文字单行省略 + `title`。
  - 扫码框对齐（规格 §4.2）：

    ```css
    .scan-bar__input {
      height: 32px;
      line-height: 32px;
      padding: 0;
    }

    .scan-bar__input::placeholder {
      font-size: 15px;
      line-height: 32px;
    }
    ```

  - `JobLog` 搜索框占位文字「按扫码内容搜索」。
- [ ] **Step 4: 运行，确认通过**；`bun run check && bun run test:e2e`；截图核对扫码栏在 `deviceScaleFactor` 1 / 1.5 / 2 下的对齐（Playwright `electron.launch` 后用 `webContents.setZoomFactor` 模拟缩放）。
- [ ] **Step 5: 提交** `feat(ui): preview toolbar with the rule and template in use, querying state, aligned scan box`

---

### Task 4: 配置中心框架，常用备注、语音、通用、关于四页

**Files:**
- Create: `view-models/use-app-view.ts`、`components/config/ConfigCenter.tsx`、`components/config/ConfirmDialog.tsx`、`components/config/pages/NotePresetsPage.tsx`、`VoicePage.tsx`、`GeneralPage.tsx`、`AboutPage.tsx`
- Modify: `TitleBar.tsx`（「配置」按钮）、`App.tsx`（两个视图）、`use-hotkey.ts`（`enabled` 参数）、`use-scan-focus.ts`（`isWorkbenchActive` 参数）、`SidePanel.tsx`（去掉「设置」标签）、`note-options` 调用处（「管理常用备注…」→ `openConfig('notes')`）、`app.css`
- Delete: `SettingsForm.tsx`（内容拆进四个页面和 Task 6 的通知页）
- Test: `e2e/app.e2e.ts`

**Interfaces:**
- `useAppView({ platform, guard })` → `{ view, open(page?), close(), navigate(page), back(), requestLeave(action) , confirm }`
  - `guard: () => { isDirty: boolean; discard: () => void }`：当前编辑器的未保存状态（模板或规则草稿，Task 5 / 6 接入）。
  - 任何离开编辑器的动作（切换导航、返回、关闭、快捷键、Esc、跳转链接）先调用 `requestLeave`：不脏直接执行，脏则弹 `ConfirmDialog`，选「放弃修改」时先 `discard()` 再执行。
  - 记住上次的页面（`useRef`，不持久化），默认 `templates`。
  - 打开时焦点移到页标题（`tabindex="-1"`），关闭后焦点回扫码框。
- `ConfigCenter({ view, onNavigate, onBack, breadcrumb, children })`：
  - `position: absolute; inset: var(--title-bar-height) 0 0 0`，工作台容器 `inert`。
  - 导航宽 `--config-nav-width`（184px；`@media (max-width: 1199px)` 为 160px）；分组标题、导航项高 36px、当前项 `--color-tape-wash` 底 + 4px `--color-tape` 左边、`aria-current="page"`。
  - 页头 56px：「← 返回工作台」、标题或面包屑、右侧「配置中不打印」胶囊（`.config-pill`）。
  - 进出动画 160ms（`prefers-reduced-motion` 时 0）。
- `ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel })`：`role="alertdialog"`、`aria-modal="true"`、宽 400px、默认焦点「继续编辑」、Enter / Esc 都等于继续编辑，焦点困在框内。
- 标题栏：顺序为更新胶囊、「配置」按钮、打印机胶囊、窗口按钮；按钮 `aria-pressed`，打开时文字「配置中」，`title` 为「打开配置（Ctrl+,）」或 macOS「⌘,」。
- `useHotkey('F2', handler, { enabled: isWorkbenchActive(view) })`。
- `useScanFocus(isWorkbenchActive(view))`：为 false 时不做三条回焦（按钮后回焦、10 秒空闲、窗口获焦）；首字符路由在 Task 7 接入。
- 通用页：防重复、多行扫码等待、打印记录保留（含删除旧记录的确认条，沿用原逻辑）、开机自启、软件更新（状态文字 + 检查更新）、日志（打开日志目录）；配置中心里表单标签列宽 120px（`.config-page .form-row { grid-template-columns: 120px minmax(0, 1fr) }`）。

- [ ] **Step 1: 失败的 E2E**
  - 点「配置」打开，默认「模板」页；标题栏按钮 `aria-pressed="true"`；工作台容器有 `inert` 属性；Esc 回到工作台，焦点在扫码框。
  - Ctrl+,（macOS 为 Meta+,）开关配置中心。
  - 备注下拉框选「管理常用备注…」打开「常用备注」页，添加一条后回工作台，下拉框里有它（取代原「设置」标签里的用例）。
  - 配置中心打开时按 F2：`window.api.print` 没有被调用（用 `page.evaluate` 包一层计数）。
- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: `bun run check && bun run test:e2e`；截图自查 1280×800 和 1024×680 下的框架和四个页面。**
- [ ] **Step 5: 提交** `feat(ui): full-window config center with note presets, voice, general and about pages`

---

### Task 5: 模板页

**Files:**
- Create: `components/config/pages/TemplatesPage.tsx`
- Modify: `TemplateEditor.tsx`（去掉自己的滚动容器和底部操作条，由页面提供）、`FieldsAreaEditor.tsx` 和 `TemplateEditor.tsx`（字段名输入框接 `datalist`）、`use-templates.ts`（`selectedId`、预览内容）、`App.tsx`、`SidePanel.tsx`（去掉「模板」标签）、`app.css`
- Delete: `TemplatePanel.tsx`、`use-hover-preview.ts`、`hover-intent.ts` 里的 `HoverIntent` 和 `HOVER_PREVIEW_DELAY_MS`（`WINDOW_TIMERS`、`IntentTimers` 保留给扫码焦点和多行扫码）及其测试
- Test: `e2e/app.e2e.ts`

**Interfaces:**
- 列表视图：左 320px 列表（「内置」「自定义」两组，行高 ≥ 52px，选中项同导航当前项样式，「使用中」标签）；右侧 `LabelPreview`（`maxScale` 3）+「预览内容」输入框 + 操作按钮（使用、复制、编辑、删除两次确认）。预览套用备注下拉框的选择（`applyNoteOverride`）。
- 编辑视图：`grid-template-columns: minmax(380px, 1fr) minmax(360px, 1fr)`；左表单滚动；右预览固定；底部操作条（`.config-actions`，64px）：左侧校验原因，右侧「返回列表 / 放弃修改」「保存模板」。`@media (max-width: 1099px)`：预览在上 220px、表单在下。
- 面包屑「模板 / 编辑：<名称>」，第一段是按钮（走未保存确认）。
- 字段名候选：`<datalist id="field-name-suggestions">` 放在页面里，内容为 `fieldNameSuggestions(rules, previewScan)`；`FieldsAreaEditor` 的字段名输入框和二维码「某个字段」输入框加 `list="field-name-suggestions"`。
- 预览内容默认取最近一次扫码内容（`station.scan?.raw`），没有则示例码；用户改过后保持用户的内容。
- `use-app-view` 的 `guard` 接入模板草稿：`{ isDirty: templates.isDirty, discard: templates.cancelEdit }`。

- [ ] **Step 1: 失败的 E2E**（改写原两条模板用例）
  - 在模板页点选「通用（二维码在右）」，右侧预览 body 带 `layout-qr-right`，工作台当前模板不变。
  - 复制第一套模板 → 改名「E2E 模板」→ 保存 → 使用；重启后仍是「使用中」。
  - 编辑中改了名字再点导航「识别规则」：弹确认框；「继续编辑」留在编辑器，「放弃修改」离开且名字恢复。
- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: `bun run check && bun run test:e2e`；截图自查列表、编辑（1280 / 1024）、指定字段 + 垂直排列、字段名候选弹出。**
- [ ] **Step 5: 提交** `feat(ui): template page with click-to-preview and a side-by-side editor`

---

### Task 6: 识别规则、查找表、密钥、打印结果通知四页；工作台侧栏只剩两个标签

**Files:**
- Create: `components/config/pages/RulesPage.tsx`、`LookupTablesPage.tsx`、`SecretsPage.tsx`、`WebhooksPage.tsx`；`components/workbench/WorkbenchSide.tsx`、`components/workbench/Workbench.tsx`
- Modify: `RuleEditor.tsx`（去掉滚动容器和操作条）、`RuleTester.tsx`（`compact` 模式：一行输入 + 一行摘要 +「展开」）、`LookupTables.tsx`（选中表时显示前 20 行）、`WebhookSettings.tsx`（发送记录改成表格）、`use-rules.ts`（`exportOne`、`listLookupRows`）、`App.tsx`、`app.css`
- Delete: `RulePanel.tsx`、`SidePanel.tsx`
- Test: `e2e/app.e2e.ts`、`src/renderer/src/lib/rule-text.test.ts`（如有文案变化）

**Interfaces:**
- 规则列表视图：`grid-template-columns: minmax(0, 1fr) var(--tester-width)`（360px），右侧试一试 `position: sticky; top: 0`。卡片三行（规格 §5.5）；内置规则标签「内置」，自定义显示类型；第三行加「导出」（`rules.exportRules([id])`）。
- 规则编辑视图：`minmax(420px, 1fr) var(--tester-width)`；`@media (max-width: 1099px)` 试一试移到上方并用 `compact` 模式。
- `use-app-view` 的 `guard` 在规则页接入规则草稿。
- 查找表页：卡片列表 + 右上角「导入 CSV 表格」；点选卡片显示前 20 行表格（`.data-table`：表头 `position: sticky`，外层 `overflow-x: auto`，页面本身不横向滚动）。
- 通知页：接口卡片列表、编辑卡片、发送记录表格（时间、事件、接口、结果、状态码、尝试次数、下次重试、操作），状态用 `.delivery-state--*` 颜色。
- 工作台：`Workbench` 组合扫码栏、预览区、`WorkbenchSide`（打印机 | 打印记录，各占一半）。

- [ ] **Step 1: 失败的 E2E**（改写原识别规则用例）
  - 配置中心「识别规则」：试一试输入 `202609280001` 命中「纯数字订单号」；`CL1_红_M` 命中「原样打印」；新建下划线规则后命中新规则；「纯数字订单号」绑定「样衣标准」后回工作台扫码，工具条显示规则指定的模板。
  - 工作台右侧栏只有「打印机」「打印记录」两个标签。
- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: `bun run check && bun run test:e2e`；截图自查四页（1280 / 1024），规则编辑含 HTTP 步骤展开。**
- [ ] **Step 5: 提交** `feat(ui): rules, lookup tables, secrets and notification pages; two-tab workbench side`

---

### Task 7: 配置中心里的扫码、跳转链接

**Files:**
- Create: `view-models/use-scan-sink.ts`
- Modify: `use-scan-focus.ts`（首字符路由改为按 `scanTargetFor(view)`：扫码框 / 当前页测试框 / 接收框）、`RuleTester.tsx` 和模板页预览内容框（注册为测试框：`data-scan-target="test-box"` + 暴露 ref）、`ConfigCenter.tsx`（隐藏接收框、胶囊闪烁）、`status-text.ts`（没有匹配规则时的跳转）、`StepForms.tsx`（查找表链接）、`WebhookSettings.tsx`（密钥链接）、`RulesPage.tsx`（说明文字）
- Test: `src/renderer/src/lib/scan-assembler.test.ts`（接收框复用 `ScanAssembler`，已有测试覆盖拼接）、`e2e/app.e2e.ts`

**Interfaces:**
- 测试框：页面把自己的测试输入框 ref 通过 `ScanTargetContext` 注册；`use-scan-focus` 在焦点不在输入框、按下扫码字符时把焦点移到当前目标：
  - `scan-box` → 扫码框（原逻辑）
  - `test-box` → 已注册的测试框；多行由测试框本身的 `ScanAssembler` 拼接（与扫码框同一套 `onChange` 规则），拼好后不打印，只触发试一试 / 预览
  - `sink` → 配置中心里一个视觉隐藏的 `textarea`（`.visually-hidden`，`aria-hidden="true"`，`tabIndex={-1}`），`ScanAssembler` 拼完一次后清空，调用 `announce({ kind: 'configuring' })` 并让「配置中不打印」胶囊闪烁两次（`.config-pill--flash`，每次 300ms）
- 跳转链接：`<button className="link-button">`，点击走 `requestLeave(() => navigate(page))`；工作台状态条的链接先打开配置中心再导航。

- [ ] **Step 1: 失败的 E2E**
  - 配置中心「识别规则」页，焦点在页面空白处时用键盘打出 `202609280001` 并回车：试一试里出现这段内容和命中结果；`window.api.print` 调用次数为 0。
  - 在「通用」页同样输入：没有任何输入框被改动，胶囊出现 `config-pill--flash`，打印次数为 0。
  - 规则编辑中有未保存修改时，点加工步骤里的「去查找表」链接：先弹确认框。
- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: `bun run check && bun run test:e2e`**
- [ ] **Step 5: 提交** `feat(ui): scans in the config center fill the try-it box and never print; cross-page links`

---

### Task 8: 逐项视觉验收、文档

**Files:**
- Create: `e2e/visual/capture.e2e.ts`（截图 + 自动检查，本地运行：`bunx playwright test e2e/visual`）、`e2e/visual/checks.ts`、`e2e/visual/report.ts`（生成验收报告 HTML）
- Modify: `playwright.config.ts`（默认 `testIgnore: 'visual/**'`，CI 只跑自动检查的轻量版本）、`README.md`（功能说明改成配置中心的说法）、`docs/windows-acceptance.md`（#11、#38）、本计划（回填提交号）、`docs/roadmap.md`

**Interfaces:**
- `checks.ts`（在页面里执行，返回问题列表，空表示通过）：
  - `findHorizontalOverflow()`：所有 `overflow-y: auto|scroll` 的元素，`scrollWidth > clientWidth + 1` 且没有 `data-allow-x-scroll`。
  - `findClippedText()`：可见的文字元素 `scrollWidth > clientWidth + 1`，且不是（`text-overflow: ellipsis` 并带 `title`）。
  - `findOverlaps(selectors)`：页头、导航、内容、操作条、试一试、预览的矩形两两不相交。
  - `findSmallTargets()`：`button, [role=tab], a, input[type=checkbox]` 的可点击高度 < 28px（勾选框按其 label 计算）。
  - `findLowContrast()`：文字颜色与其最近的不透明背景对比度 < 4.5（大字 < 3）。
  - `findOffGridSpacing(selectors)`：卡片、表单行的 margin / padding 不是 4 的倍数。
  - `focusIsInside(selector)`：`document.activeElement` 在配置中心内，工作台带 `inert`。
- `capture.e2e.ts`：按规格 §8.2 的 V01–V31，每项在 1280×800、1024×680、1920×1080 截图（V01 另在缩放 1 / 1.5 / 2 下截扫码栏），每张跑全部检查，结果写 `test-results/visual/manifest.json`。
- `report.ts`：读 manifest，生成单文件 HTML：每项一个区块（编号、名称、验收要点、三种尺寸截图、自动检查结果、需求方确认勾选框 + 意见输入框）。发布为 Artifact 给需求方逐项确认。

- [ ] **Step 1: 写 `checks.ts` 并在一个故意溢出的测试页面上验证每条检查能发现问题**
- [ ] **Step 2: 写 `capture.e2e.ts`，跑一遍，自动检查必须全部通过（有问题就修，修完重跑）**
- [ ] **Step 3: 生成报告，发布给需求方逐项确认；按意见修改、重截、重验，直到全部确认**
- [ ] **Step 4: 更新 README、Windows 验收文档、路线图；回填本计划提交号**
- [ ] **Step 5: 提交** `test(ui): visual acceptance for the workbench and config center` 和 `docs: config center`；需求方确认后合回 `feature/phase1-desktop-client` 并通知 Windows 会话复验（150% 缩放、键盘、配置中心扫码不打印）

---

## 自查

- 规格覆盖：§3.1 每一行都有去向（Task 3–7）；§4.2 对齐（Task 3）；§4.3 工具条和正在查询（Task 3）；§4.5 标题栏（Task 4）；§5.1–5.9（Task 4–7）；§6.1 离开确认（Task 4–6）；§6.2 扫码、F2、回焦（Task 4、7）；§6.3 同步（Task 3、5、6）；§7 `lookup:rows`（Task 2）；§8 视觉验收（Task 8）；第 20 句播报（Task 2）。
- 审查缺口：常用备注页、更新状态、记录上限确认、F2、回焦、关闭时的未保存确认、`lookup:rows`、跳转链接、正在查询、字段名候选、单条导出、打印记录占位文字、扫码框对齐——都已分配到任务。
