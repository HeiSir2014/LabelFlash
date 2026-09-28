# CDL-云签速印 Phase 1 — Windows 桌面客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 Windows 桌面程序：扫码枪扫样衣标签二维码后，按模板立即预览 60×40mm 标签，并自动或手动打印到选中的本机打印机。程序还包含：
- 时间窗口防重门限
- 可回溯重打的环形打印记录
- 内置加自定义打印模板，以及扫码框旁的「备注」快速切换
- 打印机状态检测
- 无边框自绘窗口

**Architecture:**
- `src/core`：纯 TypeScript 业务层，负责解析、门限、队列、模板和 `PrintService`。不依赖 Electron，用 `bun test` 全覆盖。
- Electron 主进程：
  - 存储用内置的 `node:sqlite`（WAL、迁移、FTS5）。
  - 打印用驱动加隐藏窗口渲染 HTML，静默打印。
  - 后台检测打印机状态。
  - 通过类型化 IPC 与界面通信，每个参数都做校验。
- 渲染层：React，采用 MVVM 结构，纯逻辑 lib → view-model hooks → 组件。预览和打印共用同一份标签 HTML。

**Tech Stack:** Bun 1.4、Electron 44（Node 24.21 / `node:sqlite` / SQLite 3.53.4）、electron-vite 5、Vite 7、React 19、TypeScript 5.9 strict、Biome 2、qrcode、electron-log 5、electron-updater 6、msedge-tts 2、sharp（仅用于生成图标）、@playwright/test（E2E）、electron-builder 26（NSIS）

**Verified:**
- 本计划的全部代码都来自一个已跑通的参考工程。
- `bun run check`（lint + 三个 tsconfig + 186 个单元测试）全部通过；`bun run test:e2e`（Playwright 驱动 Electron）3 个用例通过；`electron-vite build` 成功。
- 开发版走过"复制模板 → 编辑 → 保存 → 使用 → 扫码"和"添加常用备注 → 下拉框切换 → 扫码"。
- 语音预热在 Electron 中真实生成 6 段 mp3 缓存。
- `electron-builder --mac dir` 打包后能启动，fuses 生效。

**v3 修订（最终 review）：**
- 任务顺序：Task 0–13 → Task 13A–13E（本版新增）→ Task 14。
- 新增：`app://` 自定义协议、全局 webContents 加固、主 frame 校验、自动更新、E2E、语音播报、打印机异常系统通知。
- Task 14 的 electron-builder / CI / README 改为发布到 GitHub Releases 的版本。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-09-28-label-flash-design.md`（v3）。
- **品牌与命名**：CDL = 陈大露。产品名 `CDL-云签速印`，ASCII 名 `CDL-LabelFlash`，appId `com.cdl.labelflash`，包名 `cdl-labelflash`，安装包 `CDL-LabelFlash-Setup-${version}.exe`。
- **数据目录**：`%LOCALAPPDATA%\CDL-LabelFlash`，包含 `labelflash.db`、`logs\main.log`。
- **纸张**：固定 60×40mm 背胶标签。二维码内容为 `编码-颜色-尺码`，从右往左拆；尺码是文本（S/M/L/XL/XXL/均码/36.5 都合法）。
- **门限**：窗口默认 10 分钟，范围 0–1440 分钟。超时按已打印处理；确定没有出纸的失败释放占位；force 不跳过正在打印的码。
- **打印记录**：环形保留，默认 100,000 条，范围 1,000–1,000,000；插入和裁剪在同一个事务里完成；界面每页 100 条；搜索走 FTS5 trigram。
- **模板**：结构化数据，所有输入都经过 `sanitizeTemplate`；内置模板只读；预览和打印共用 `renderLabelHtml`。
- **安全**：
  - `contextIsolation`、`sandbox` 开启，`nodeIntegration` 关闭；`app.enableSandbox()` 让所有渲染进程进沙箱。
  - 界面从 `app://bundle/` 自定义协议加载，不用 `file://`；路径解析拒绝越出打包目录。
  - 所有 webContents 统一拒绝 `window.open`、跳转和 `<webview>`。
  - IPC 只接受主窗口**主 frame** 发来的消息，参数全部校验。
  - 权限请求与权限检查一律拒绝；fuses 收紧（含 `grantFileProtocolExtraPrivileges: false`）；安装版移除默认菜单。
  - CSP：`default-src 'self'`，`media-src 'self' blob:`（语音播放用）。
  - 标签 HTML 中的文本全部转义。
- **依赖**：不引入第三方原生运行时模块。运行时依赖只有 `qrcode`、`electron-log`、`electron-updater`、`msedge-tts`；sharp、@playwright/test 只作为开发依赖。
- **语音**：在线合成（msedge-tts），按 `sha256(音色|语速|文本)` 缓存 mp3 到 `<userData>\voice-cache`；每种结果只播固定短语；语速 -50%～+100%、步长 10%；合成失败退回提示音。
- **命名**：仓库、代码、文档、提交信息中不出现任何参考产品或竞品名称，统一写「参考产品」；打印机也只写「热敏标签机」，不写品牌。
- **质量门槛**：每个任务结束时，`bun run lint`、`bun run typecheck`、`bun test` 都必须零错误、零警告；Task 13E 起还要 `bun run test:e2e` 通过。
- **代码风格**：TS 用 camelCase / PascalCase / UPPER_SNAKE_CASE，不写魔法数字；界面文案用中文；注释只写「为什么」。
- **Git**：在 `feature/phase1-desktop-client` 分支上开发，每个任务单独提交；最后按 squash 方式合并 PR。提交身份为 `heisir2014 <heisir21@163.com>`；远程仓库 `git@github.com:HeiSir2014/LabelFlash.git`。

---

## File Structure

```
.github/workflows/ci.yml          CI：check + E2E；非标签打包上传；v* 标签发布到 Releases（Task 14）
biome.json  bunfig.toml  tsconfig.json  electron.vite.config.ts  package.json  .gitignore   工具链（Task 1、10）
electron-builder.yml  resources/installer.nsh                                          打包（Task 14）
playwright.config.ts  e2e/tsconfig.json  e2e/app.e2e.ts                                E2E（Task 13E）
resources/icon.svg  tray.svg → icon.png  tray*.png    scripts/generate-icons.ts        图标（Task 10）
src/core/                         纯业务层（不依赖 Electron）
  types.ts  errors.ts  label-parser.ts  dedup-guard.ts  serial-queue.ts  print-queue.ts
  job-store.ts  print-service.ts                                                       （Task 1–3、5）
  templates/  template-model.ts  sanitize-template.ts  builtin-templates.ts  note-text.ts
              note-override.ts  text-fit.ts  template-catalog.ts                       （Task 4）
  testing/    fake-clock.ts  fake-printer-adapter.ts  in-memory-job-store.ts
src/shared/                       主进程与界面共用
  brand.ts  label-paper.ts  print-timing.ts  printer-readiness.ts  job-history.ts
  settings.ts  ipc-contract.ts  sample-label.ts                                        （Task 5、8、10）
  update-status.ts（13B）  voice.ts（13C）
src/main/
  storage/    database.ts  migrations.ts  row-readers.ts  sqlite-job-store.ts
              sqlite-settings-store.ts  sqlite-template-repository.ts                  （Task 6–8）
  printing/   label-html.ts  printer-status.ts  electron-driver-adapter.ts             （Task 9）
              alert-throttle.ts  printer-alerts.ts                                     （13D）
  voice/      voice-clips.ts  edge-synthesizer.ts                                      （13C）
  bundle-path.ts  app-protocol.ts  security.ts                                         （13A）
  updater.ts                                                                           （13B）
  print-template.ts  ipc-validators.ts  ipc.ts  logging.ts  window.ts  tray.ts  index.ts   （Task 10）
src/preload/index.ts
src/renderer/
  index.html  tsconfig.json
  src/  main.tsx  App.tsx  env.d.ts
        assets/fonts/  SmileySans-Oblique.woff2  SmileySans-OFL.txt                    （Task 11）
        styles/        tokens.css  app.css
        lib/           status-text  notices  printer-chip  list-filters  repeat-filter
                       note-options  feedback-sound                                    （Task 11）
                       update-text（13B）  feedback-cues  voice-player（13C）
        view-models/   use-*.ts                                                        （Task 12；13B/13C 新增两个）
        components/    TitleBar  ScanBar  PreviewStage  Ruler  PrinterList  SidePanel
                       JobLog  NoticeBar  TemplatePanel  TemplateEditor  SettingsForm
                       ConfirmButton  ErrorBoundary  form-controls                     （Task 13）
                       VoiceSettingsSection（13C）
docs/  roadmap.md  superpowers/specs/…  superpowers/plans/…  windows-acceptance.md
```

---

### Task 0: 分支与环境确认

- [ ] **Step 1: 确认分支、身份与远程**

```bash
git switch feature/phase1-desktop-client
git config user.name && git config user.email
git remote -v
git status --short
```
Expected：当前分支是 `feature/phase1-desktop-client`；身份是 `heisir2014` / `heisir21@163.com`；`origin` 指向 `git@github.com:HeiSir2014/LabelFlash.git`；工作区干净（spec 和本计划已经提交）。

- [ ] **Step 2: 确认工具版本**

Run: `bun --version`
Expected：`1.4.2` 或更高。

---

### Task 1: 工具链 + 领域类型 + 标签解析

一次装好全部依赖，建立 TypeScript / Biome / Bun 测试配置，定义领域类型（包括模板模型），用 TDD 实现二维码解析。

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.json`, `biome.json`, `.gitignore`, `src/shared/label-paper.ts`, `src/core/templates/template-model.ts`, `src/core/types.ts`, `src/core/errors.ts`, `src/core/label-parser.ts`
- Test: `src/core/label-parser.test.ts`

**Interfaces:**
- Produces：
  - `src/core/types.ts`：`LabelData`、`PrintSource`/`PRINT_SOURCES`、`PrintRequest`、`PrintFailureReason`/`PRINT_FAILURE_REASONS`、`RecentPrint`、`PrintResult`、`PrintStatus`/`PRINT_STATUSES`、`PreviewResult`、`PrinterInfo`、`LabelJob`、`PrinterAdapter`（`print(printerName, job, signal)`）、`JobRecord`、`Clock`、`systemClock`
  - `src/core/errors.ts`：`PrintError(reason, message?, detail?)`、`toPrintFailure(error): { reason; detail? }`
  - `src/core/templates/template-model.ts`：模板类型（对齐按区域：`sideAlign`、`bottomAlign`，不逐字段设置）、枚举常量、`TEMPLATE_LIMITS`、`LAYOUT_GAP_MM`、`maxQrSizeMm(paddingMm)`、`sideTextWidthMm(template)`、`fullTextWidthMm(template)`、`isBuiltInTemplateId(id)`、`BUILT_IN_TEMPLATE_PREFIX`/`CUSTOM_TEMPLATE_PREFIX`/`TEMPLATE_ID_PATTERN`
  - `src/shared/label-paper.ts`：`LABEL_PAPER_MM = { width: 60, height: 40 }`
  - `src/core/label-parser.ts`：`MAX_RAW_LENGTH = 128`、`parseLabel(input): LabelData | null`

- [ ] **Step 1: 创建 `package.json`**

> electron-vite 5 的 peer 依赖是 `vite ^5 || ^6 || ^7`，所以固定 Vite 7 和 plugin-react 5。Electron 44 没有 postinstall，二进制在第一次运行时下载。不要加 `"type": "module"`：sandbox 下的 preload 必须是 CommonJS。

```json
{
  "name": "cdl-labelflash",
  "productName": "CDL-云签速印",
  "version": "0.1.0",
  "description": "CDL-云签速印：样衣标签扫码重打",
  "author": "heisir2014 <heisir21@163.com>",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/renderer/tsconfig.json",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "bun test",
    "check": "bun run lint && bun run typecheck && bun test",
    "icons": "bun scripts/generate-icons.ts",
    "dist:win": "electron-vite build && electron-builder --win --x64 --publish never"
  },
  "dependencies": {
    "electron-log": "^5.4.4",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.14",
    "@types/bun": "^1.4.2",
    "@types/node": "^24.0.0",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "electron": "^44.4.5",
    "electron-builder": "^26.15.3",
    "electron-vite": "^5.0.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "sharp": "0.35.5",
    "typescript": "^5.9.3",
    "vite": "^7.3.6"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/HeiSir2014/LabelFlash.git"
  }
}
```

- [ ] **Step 2: 创建 `bunfig.toml`**

```toml
[test]
root = "src"
```

- [ ] **Step 3: 创建 `tsconfig.json`**

> 根 tsconfig 覆盖 core / shared / main / preload / scripts；renderer 有独立的 tsconfig（Task 10）。

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "bun", "electron-vite/node"]
  },
  "include": [
    "src/core/**/*",
    "src/shared/**/*",
    "src/main/**/*",
    "src/preload/**/*",
    "scripts/**/*",
    "electron.vite.config.ts"
  ]
}
```

- [ ] **Step 4: 创建 `biome.json`**

> `useLiteralKeys` 关闭：TS 开启了 `noPropertyAccessFromIndexSignature`，索引签名必须用方括号访问，两者冲突。

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/out", "!**/dist", "!**/resources"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 120 },
  "javascript": { "formatter": { "quoteStyle": "single", "trailingCommas": "all", "semicolons": "always" } },
  "linter": {
    "rules": {
      "preset": "recommended",
      "complexity": { "useLiteralKeys": "off" }
    }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 5: 创建 `.gitignore`**

```text
node_modules/
out/
dist/
*.log
.DS_Store
```

- [ ] **Step 6: 执行**

Run: `bun install`
Expected: 安装成功，生成 `bun.lock`。Bun 提示 `Blocked 1 postinstall`（electron-winstaller，NSIS 打包用不到），忽略。

- [ ] **Step 7: 创建 `src/shared/label-paper.ts`**

```ts
/** 标签纸：固定为 60×40mm 背胶热敏标签。打印页面尺寸、预览软尺都以它为准。 */
export const LABEL_PAPER_MM = { width: 60, height: 40 } as const;
```

- [ ] **Step 8: 创建 `src/core/templates/template-model.ts`**

> 模板模型是领域类型的一部分（`LabelJob` 引用它），这里先定义；内置模板和校验在 Task 4。

```ts
import { LABEL_PAPER_MM } from '../../shared/label-paper';

/** 标签模板：结构化数据（不是任意 HTML），可校验、可持久化，打印和预览共用。纸张固定 60×40mm。 */

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const QR_LAYOUTS = ['qr-left', 'qr-right'] as const;
export type QrLayout = (typeof QR_LAYOUTS)[number];

export const QR_ERROR_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorLevel = (typeof QR_ERROR_LEVELS)[number];

/** beside-qr = 二维码旁的空白区（字段下方）；bottom = 标签底部整行。 */
export const NOTE_PLACEMENTS = ['beside-qr', 'bottom'] as const;
export type NotePlacement = (typeof NOTE_PLACEMENTS)[number];

/** code / color / size 排在二维码旁；raw（完整编码）排在底部。 */
export const SIDE_FIELD_KEYS = ['code', 'color', 'size'] as const;
export const FIELD_KEYS = [...SIDE_FIELD_KEYS, 'raw'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface TextStyle {
  fontSizeMm: number;
  bold: boolean;
}

export interface FieldConfig extends TextStyle {
  visible: boolean;
  /** 字段前缀，例如「编码：」。 */
  prefix: string;
}

export interface NoteConfig extends TextStyle {
  visible: boolean;
  /** 支持变量：{编码} {颜色} {尺码} {完整编码} {日期} {时间}；可以多行。 */
  text: string;
  placement: NotePlacement;
}

export interface QrConfig {
  visible: boolean;
  sizeMm: number;
  errorCorrection: QrErrorLevel;
}

export interface LabelTemplate {
  id: string;
  name: string;
  paddingMm: number;
  layout: QrLayout;
  /**
   * 对齐按区域统一设置，保证同一列文字对齐：
   * side = 二维码旁的字段（前缀列 + 值列的网格，对齐作用于值列）和旁边的备注；bottom = 底部完整编码和底部备注。
   */
  sideAlign: TextAlign;
  bottomAlign: TextAlign;
  qr: QrConfig;
  fields: Record<FieldKey, FieldConfig>;
  note: NoteConfig;
}

export const TEMPLATE_LIMITS = {
  paddingMm: { min: 0, max: 6 },
  qrSizeMm: { min: 10, max: LABEL_PAPER_MM.height },
  fontSizeMm: { min: 1.5, max: 8 },
  nameLength: 40,
  prefixLength: 16,
  noteLength: 200,
} as const;

/** 元素之间的固定间距（mm）。 */
export const LAYOUT_GAP_MM = 2;

export const BUILT_IN_TEMPLATE_PREFIX = 'builtin:';
export const CUSTOM_TEMPLATE_PREFIX = 'custom:';
export const TEMPLATE_ID_PATTERN = /^(builtin|custom):[\w-]{1,64}$/;

export function isBuiltInTemplateId(id: string): boolean {
  return id.startsWith(BUILT_IN_TEMPLATE_PREFIX);
}

/** 二维码允许的最大边长：纸张高度去掉上下边距。 */
export function maxQrSizeMm(paddingMm: number): number {
  return LABEL_PAPER_MM.height - 2 * paddingMm;
}

/** 二维码旁字段区的可用宽度（mm）。 */
export function sideTextWidthMm(template: LabelTemplate): number {
  const qrWidth = template.qr.visible ? template.qr.sizeMm + LAYOUT_GAP_MM : 0;
  return LABEL_PAPER_MM.width - 2 * template.paddingMm - qrWidth;
}

/** 底部整行的可用宽度（mm）。 */
export function fullTextWidthMm(template: LabelTemplate): number {
  return LABEL_PAPER_MM.width - 2 * template.paddingMm;
}
```

- [ ] **Step 9: 创建 `src/core/types.ts`**

```ts
import type { LabelTemplate } from './templates/template-model';

export interface LabelData {
  /** 二维码原文（已 trim），同时作为门限的去重 key。 */
  raw: string;
  code: string;
  color: string;
  /** 尺码是文本：36、36.5、S、M、XL、XXL、3XL、均码都合法。 */
  size: string;
}

/** desktop = 扫码枪，history = 从打印记录重打，mobile = 手机（Phase 2）。 */
export const PRINT_SOURCES = ['desktop', 'history', 'mobile'] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];

export interface PrintRequest {
  raw: string;
  printerName: string;
  source: PrintSource;
  /** 强制补打：跳过门限窗口（不跳过正在打印的同一个码）。 */
  force?: boolean;
}

export const PRINT_FAILURE_REASONS = [
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_TIMEOUT',
  'PRINT_ERROR',
] as const;
export type PrintFailureReason = (typeof PRINT_FAILURE_REASONS)[number];

/** 门限命中时的状态：printing = 同一个码正在打印；printed = 窗口期内已打印。 */
export interface RecentPrint {
  state: 'printing' | 'printed';
  at: number;
}

export type PrintResult =
  | { status: 'printed'; jobId: string; label: LabelData }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' }
  | { status: 'failed'; reason: PrintFailureReason; detail?: string };

export type PrintStatus = PrintResult['status'];
export const PRINT_STATUSES = ['printed', 'duplicate', 'invalid', 'failed'] as const satisfies readonly PrintStatus[];

export type PreviewResult =
  | { status: 'ok'; label: LabelData; recent: RecentPrint | null }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' };

export interface PrinterInfo {
  name: string;
  displayName: string;
}

/** 一次打印的完整输入：标签数据 + 模板 + 打印时间（备注里的 {日期}/{时间} 用它）。 */
export interface LabelJob {
  label: LabelData;
  template: LabelTemplate;
  printedAt: number;
}

export interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  /** signal 触发（超时）时，实现必须放弃并清理这次打印。 */
  print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void>;
}

export interface JobRecord {
  id: string;
  createdAt: number;
  raw: string;
  printerName: string;
  source: PrintSource;
  status: PrintStatus;
  forced: boolean;
  failureReason?: PrintFailureReason;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
```

- [ ] **Step 10: 创建 `src/core/errors.ts`**

```ts
import type { PrintFailureReason } from './types';

export class PrintError extends Error {
  readonly reason: PrintFailureReason;
  /** 给操作员看的补充说明（中文），例如打印机报告的「缺纸」。 */
  readonly detail: string | undefined;

  constructor(reason: PrintFailureReason, message: string = reason, detail?: string) {
    super(message);
    this.name = 'PrintError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface PrintFailure {
  reason: PrintFailureReason;
  detail?: string;
}

export function toPrintFailure(error: unknown): PrintFailure {
  if (!(error instanceof PrintError)) {
    return { reason: 'PRINT_ERROR' };
  }
  return error.detail === undefined ? { reason: error.reason } : { reason: error.reason, detail: error.detail };
}
```

- [ ] **Step 11: 写失败的测试 `src/core/label-parser.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH, parseLabel } from './label-parser';

describe('parseLabel', () => {
  test('splits code, color and size from the right', () => {
    expect(parseLabel('CL5640-TK-图片色-36')).toEqual({
      raw: 'CL5640-TK-图片色-36',
      code: 'CL5640-TK',
      color: '图片色',
      size: '36',
    });
  });

  test.each(['S', 'M', 'L', 'XL', 'XXL', '3XL', '均码', '36.5', 'F'])(
    'accepts letter and text sizes like %p',
    (size) => {
      expect(parseLabel(`CL5640-TK-图片色-${size}`)?.size).toBe(size);
    },
  );

  test('keeps every extra hyphen inside the code', () => {
    expect(parseLabel('A-B-C-红-XL')).toEqual({ raw: 'A-B-C-红-XL', code: 'A-B-C', color: '红', size: 'XL' });
  });

  test('trims whitespace and line endings sent by scanners', () => {
    expect(parseLabel('  CL1-黑-40\r\n')?.raw).toBe('CL1-黑-40');
  });

  test.each(['', '   ', 'CL5640', 'CL5640-36', '-红-36', 'CL1--36', 'CL1-红-', 'CL1- -36'])(
    'rejects malformed input %p',
    (input) => {
      expect(parseLabel(input)).toBeNull();
    },
  );

  test('rejects control characters inside the code', () => {
    expect(parseLabel('CL1-红\t色-36')).toBeNull();
  });

  test('accepts input exactly at the length limit', () => {
    const suffix = '-红-36';
    const raw = `${'C'.repeat(MAX_RAW_LENGTH - suffix.length)}${suffix}`;
    expect(parseLabel(raw)?.raw).toBe(raw);
  });

  test('rejects input over the length limit', () => {
    expect(parseLabel(`${'C'.repeat(MAX_RAW_LENGTH)}-红-36`)).toBeNull();
  });
});
```

- [ ] **Step 12: 运行测试，确认失败**

Run: `bun test src/core/label-parser.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 13: 实现 `src/core/label-parser.ts`**

```ts
import type { LabelData } from './types';

export const MAX_RAW_LENGTH = 128;

/** 编码本身可能含 "-"：贪婪匹配编码，最后两段固定为颜色和尺码。 */
const LABEL_PATTERN = /^(.+)-([^-]+)-([^-]+)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来过滤控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function parseLabel(input: string): LabelData | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_RAW_LENGTH || CONTROL_CHARACTERS.test(raw)) {
    return null;
  }
  const match = LABEL_PATTERN.exec(raw);
  if (!match) {
    return null;
  }
  const [, code = '', color = '', size = ''] = match;
  if ([code, color, size].some((field) => field.trim() === '')) {
    return null;
  }
  return { raw, code, color, size };
}
```

- [ ] **Step 14: 运行测试、类型检查和 lint**

Run: `bun test src/core/label-parser.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 23 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 23 pass。

- [ ] **Step 15: Commit**

```bash
git add package.json bunfig.toml tsconfig.json biome.json .gitignore src/shared/label-paper.ts src/core/templates/template-model.ts src/core/types.ts src/core/errors.ts src/core/label-parser.test.ts src/core/label-parser.ts
git commit -m "feat(core): toolchain, domain types and label parser"
```

---

### Task 2: DedupGuard 时间窗口门限

同一二维码在窗口期内只打一次；区分「正在打印」和「已打印」；force 不能跳过正在打印。

**Files:**
- Create: `src/core/testing/fake-clock.ts`, `src/core/dedup-guard.ts`
- Test: `src/core/dedup-guard.test.ts`

**Interfaces:**
- Consumes：`Clock`、`RecentPrint`（Task 1）
- Produces：`MAX_DEDUP_WINDOW_MS`、`Reservation`、`class DedupGuard(clock, windowMs)`：`windowMs`、`setWindowMs`、`peek(key): RecentPrint | null`、`tryReserve(key, force)`、`commit(key)`、`release(key)`、`restore(key, printedAt)`；测试工具 `FakeClock`、`FAKE_CLOCK_START`

- [ ] **Step 1: 创建 `src/core/testing/fake-clock.ts`**

```ts
import type { Clock } from '../types';

export const FAKE_CLOCK_START = Date.UTC(2026, 8, 28, 9, 0, 0);

export class FakeClock implements Clock {
  private current: number;

  constructor(start: number = FAKE_CLOCK_START) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
```

- [ ] **Step 2: 写失败的测试 `src/core/dedup-guard.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { FakeClock } from './testing/fake-clock';

const WINDOW_MS = 10 * 60_000;
const KEY = 'CL5640-TK-图片色-XL';

describe('DedupGuard', () => {
  let clock: FakeClock;
  let guard: DedupGuard;

  beforeEach(() => {
    clock = new FakeClock();
    guard = new DedupGuard(clock, WINDOW_MS);
  });

  function printOnce(): number {
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    return clock.now();
  }

  test('allows the first reservation', () => {
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('blocks a second reservation while the first is still printing', () => {
    const reservedAt = clock.now();
    guard.tryReserve(KEY, false);
    clock.advance(500);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printing', at: reservedAt } });
  });

  test('force does not bypass a print that is still in flight', () => {
    guard.tryReserve(KEY, false);
    expect(guard.tryReserve(KEY, true).ok).toBe(false);
  });

  test('blocks inside the window after a successful print', () => {
    const printedAt = printOnce();
    clock.advance(WINDOW_MS - 1);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: printedAt } });
  });

  test('allows again once the window has passed', () => {
    printOnce();
    clock.advance(WINDOW_MS);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('release after a failed print allows an immediate retry', () => {
    guard.tryReserve(KEY, false);
    guard.release(KEY);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('force bypasses the window after a successful print', () => {
    printOnce();
    expect(guard.tryReserve(KEY, true)).toEqual({ ok: true });
  });

  test('a zero window turns the threshold off', () => {
    guard.setWindowMs(0);
    printOnce();
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('shrinking the window takes effect immediately', () => {
    printOnce();
    clock.advance(2 * 60_000);
    guard.setWindowMs(60_000);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('clamps the window to the supported range', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS * 2);
    expect(guard.windowMs).toBe(MAX_DEDUP_WINDOW_MS);
    guard.setWindowMs(-1);
    expect(guard.windowMs).toBe(0);
  });

  test('peek distinguishes printing from printed and never reserves', () => {
    expect(guard.peek(KEY)).toBeNull();
    guard.tryReserve(KEY, false);
    expect(guard.peek(KEY)?.state).toBe('printing');
    guard.commit(KEY);
    expect(guard.peek(KEY)?.state).toBe('printed');
    expect(guard.peek('OTHER-红-1')).toBeNull();
    expect(guard.tryReserve('OTHER-红-1', false)).toEqual({ ok: true });
  });

  test('restore seeds the window after a restart and keeps the latest timestamp', () => {
    const latest = clock.now() - 1_000;
    guard.restore(KEY, latest);
    guard.restore(KEY, latest - 5_000);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: latest } });
  });

  test('forgets prints older than the maximum window', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS);
    printOnce();
    clock.advance(MAX_DEDUP_WINDOW_MS);
    guard.tryReserve('OTHER-红-1', false);
    guard.commit('OTHER-红-1');
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS);
    expect(guard.peek(KEY)).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/core/dedup-guard.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 4: 实现 `src/core/dedup-guard.ts`**

```ts
import type { Clock, RecentPrint } from './types';

export const MAX_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type Reservation = { ok: true } | { ok: false; recent: RecentPrint };

/**
 * 同一二维码的时间窗口门限。
 * 所有方法都是同步的：Node 单线程保证 tryReserve 是原子操作，
 * 多个入口同时扫同一个码时只有一个能占位成功。
 */
export class DedupGuard {
  private readonly printedAt = new Map<string, number>();
  private readonly reservedAt = new Map<string, number>();
  private currentWindowMs: number;

  constructor(
    private readonly clock: Clock,
    windowMs: number,
  ) {
    this.currentWindowMs = clampWindow(windowMs);
  }

  get windowMs(): number {
    return this.currentWindowMs;
  }

  setWindowMs(windowMs: number): void {
    this.currentWindowMs = clampWindow(windowMs);
  }

  /** 只读：正在打印，或窗口期内已打印，返回对应状态；否则 null。 */
  peek(key: string): RecentPrint | null {
    const reserved = this.reservedAt.get(key);
    if (reserved !== undefined) {
      return { state: 'printing', at: reserved };
    }
    const printed = this.printedAt.get(key);
    if (printed !== undefined && this.clock.now() - printed < this.currentWindowMs) {
      return { state: 'printed', at: printed };
    }
    return null;
  }

  tryReserve(key: string, force: boolean): Reservation {
    const recent = this.peek(key);
    if (recent && (recent.state === 'printing' || !force)) {
      return { ok: false, recent };
    }
    this.reservedAt.set(key, this.clock.now());
    return { ok: true };
  }

  /** 打印已交给打印机（或结果不确定）：记为已打印。 */
  commit(key: string): void {
    this.reservedAt.delete(key);
    this.printedAt.set(key, this.clock.now());
    this.pruneExpired();
  }

  /** 确定没有出纸：释放占位，允许立即重试。 */
  release(key: string): void {
    this.reservedAt.delete(key);
  }

  restore(key: string, printedAt: number): void {
    const current = this.printedAt.get(key);
    if (current === undefined || printedAt > current) {
      this.printedAt.set(key, printedAt);
    }
  }

  /** 按最大窗口清理：之后调大窗口时，旧记录仍然有效。 */
  private pruneExpired(): void {
    const now = this.clock.now();
    for (const [key, printedAt] of this.printedAt) {
      if (now - printedAt >= MAX_DEDUP_WINDOW_MS) {
        this.printedAt.delete(key);
      }
    }
  }
}

function clampWindow(windowMs: number): number {
  return Math.min(MAX_DEDUP_WINDOW_MS, Math.max(0, windowMs));
}
```

- [ ] **Step 5: 运行测试、类型检查和 lint**

Run: `bun test src/core/dedup-guard.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 13 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 36 pass。

- [ ] **Step 6: Commit**

```bash
git add src/core/testing/fake-clock.ts src/core/dedup-guard.test.ts src/core/dedup-guard.ts
git commit -m "feat(core): time-window dedup guard for repeat scans"
```

---

### Task 3: SerialQueue + PrintQueue（超时中止）

每台打印机一个串行队列；超时时通过 AbortSignal 通知任务清理，并以 `PRINT_TIMEOUT` 失败。

**Files:**
- Create: `src/core/serial-queue.ts`, `src/core/print-queue.ts`
- Test: `src/core/print-queue.test.ts`

**Interfaces:**
- Consumes：`PrintError`（Task 1）
- Produces：`class SerialQueue { run<T>(task) }`；`type PrintTask<T> = (signal: AbortSignal) => Promise<T>`；`class PrintQueue(timeoutMs) { enqueue<T>(printerName, task: PrintTask<T>) }`

- [ ] **Step 1: 写失败的测试 `src/core/print-queue.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { PrintError } from './errors';
import { PrintQueue } from './print-queue';

function recorder() {
  const events: string[] = [];
  const task = (name: string, ms: number) => async () => {
    events.push(`start:${name}`);
    await Bun.sleep(ms);
    events.push(`end:${name}`);
  };
  return { events, task };
}

const hang = () => new Promise<void>(() => {});

describe('PrintQueue', () => {
  test('runs jobs for the same printer one at a time', async () => {
    const queue = new PrintQueue(1_000);
    const { events, task } = recorder();
    await Promise.all([queue.enqueue('P1', task('a', 20)), queue.enqueue('P1', task('b', 1))]);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  test('runs different printers in parallel', async () => {
    const queue = new PrintQueue(1_000);
    const { events, task } = recorder();
    await Promise.all([queue.enqueue('P1', task('a', 20)), queue.enqueue('P2', task('b', 1))]);
    expect(events).toEqual(['start:a', 'start:b', 'end:b', 'end:a']);
  });

  test('rejects with PRINT_TIMEOUT and aborts the task when it hangs', async () => {
    const queue = new PrintQueue(20);
    let received: AbortSignal | undefined;
    const error = await queue
      .enqueue('P1', (signal) => {
        received = signal;
        return hang();
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrintError);
    expect((error as PrintError).reason).toBe('PRINT_TIMEOUT');
    expect(received?.aborted).toBe(true);
  });

  test('a failed or hung job does not block the next one', async () => {
    const queue = new PrintQueue(20);
    const hung = queue.enqueue('P1', hang).catch(() => 'hung');
    const failed = queue
      .enqueue('P1', async () => {
        throw new Error('paper jam');
      })
      .catch(() => 'failed');
    const next = queue.enqueue('P1', async () => 'ok');
    expect(await Promise.all([hung, failed, next])).toEqual(['hung', 'failed', 'ok']);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/core/print-queue.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 3: 实现 `src/core/serial-queue.ts`**

```ts
/** 按提交顺序逐个执行异步任务；前一个任务失败不影响后续任务。 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
```

- [ ] **Step 4: 实现 `src/core/print-queue.ts`**

```ts
import { PrintError } from './errors';
import { SerialQueue } from './serial-queue';

export type PrintTask<T> = (signal: AbortSignal) => Promise<T>;

/** 每台打印机一个串行队列；不同打印机之间可以并行。超时会中止任务（signal）并以 PRINT_TIMEOUT 失败。 */
export class PrintQueue {
  private readonly queues = new Map<string, SerialQueue>();

  constructor(private readonly timeoutMs: number) {}

  enqueue<T>(printerName: string, task: PrintTask<T>): Promise<T> {
    let queue = this.queues.get(printerName);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(printerName, queue);
    }
    return queue.run(() => runWithTimeout(task, this.timeoutMs));
  }
}

function runWithTimeout<T>(task: PrintTask<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PrintError('PRINT_TIMEOUT'));
    }, timeoutMs);
  });
  return Promise.race([task(controller.signal), timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 5: 运行测试、类型检查和 lint**

Run: `bun test src/core/print-queue.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 4 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 40 pass。

- [ ] **Step 6: Commit**

```bash
git add src/core/print-queue.test.ts src/core/serial-queue.ts src/core/print-queue.ts
git commit -m "feat(core): per-printer serial print queue with abortable timeout"
```

---

### Task 4: 标签模板：内置模板、校验、备注变量、字号适配、模板目录

模板是结构化数据：不可信输入统一经 `sanitizeTemplate` 收敛；内置 5 套 60×40 模板只读；自定义模板经 `TemplateCatalog` 复制、保存、删除；主界面的备注下拉框通过 `applyNoteOverride` 覆盖备注文字。

**Files:**
- Create: `src/core/templates/builtin-templates.ts`, `src/core/templates/sanitize-template.ts`, `src/core/templates/note-text.ts`, `src/core/templates/text-fit.ts`, `src/core/templates/template-catalog.ts`, `src/core/templates/note-override.ts`
- Test: `src/core/templates/templates.test.ts`, `src/core/templates/note-override.test.ts`

**Interfaces:**
- Consumes：`template-model`、`LabelData`（Task 1）
- Produces：
  - `STANDARD_TEMPLATE`、`BUILT_IN_TEMPLATES`、`DEFAULT_TEMPLATE_ID`
  - `sanitizeTemplate(value: unknown, id: string, fallback: LabelTemplate): LabelTemplate`
  - `NOTE_VARIABLES`、`expandNoteText(text, label, printedAt: Date)`
  - `estimateTextWidthEm(text)`、`fitFontSizeMm(text, fontSizeMm, availableWidthMm, maxLines)`
  - `NoteOverride`（`{ kind: 'template' } | { kind: 'none' } | { kind: 'text'; text }`）、`DEFAULT_NOTE_OVERRIDE`、`applyNoteOverride(template, override)`：主界面「备注」下拉框的选择，只替换备注文字，位置和字号仍按模板
  - `interface TemplateRepository { listCustom(); save(t); remove(id) }`、`TemplateError(code)`、`class TemplateCatalog(repository, createId)`：`list()`、`get(id)`、`resolve(id)`（找不到回退标准模板）、`duplicate(sourceId)`、`save(id, value)`、`remove(id)`

- [ ] **Step 1: 写失败的测试 `src/core/templates/templates.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE } from './builtin-templates';
import { expandNoteText } from './note-text';
import { sanitizeTemplate } from './sanitize-template';
import { TemplateCatalog, TemplateError, type TemplateRepository } from './template-catalog';
import {
  CUSTOM_TEMPLATE_PREFIX,
  isBuiltInTemplateId,
  type LabelTemplate,
  maxQrSizeMm,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_LIMITS,
} from './template-model';
import { estimateTextWidthEm, fitFontSizeMm } from './text-fit';

const LABEL = { raw: 'CL5640-TK-图片色-XXL', code: 'CL5640-TK', color: '图片色', size: 'XXL' };

class MemoryRepository implements TemplateRepository {
  readonly saved = new Map<string, LabelTemplate>();

  listCustom(): LabelTemplate[] {
    return [...this.saved.values()];
  }

  save(template: LabelTemplate): void {
    this.saved.set(template.id, template);
  }

  remove(id: string): void {
    this.saved.delete(id);
  }
}

function createCatalog() {
  const repository = new MemoryRepository();
  let nextId = 0;
  const catalog = new TemplateCatalog(repository, () => `t${++nextId}`);
  return { repository, catalog };
}

describe('built-in templates', () => {
  test('are all valid and unchanged by sanitizing', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(sanitizeTemplate(template, template.id, STANDARD_TEMPLATE)).toEqual(template);
    }
  });

  test('have unique built-in ids', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isBuiltInTemplateId)).toBe(true);
    expect(ids.every((id) => TEMPLATE_ID_PATTERN.test(id))).toBe(true);
  });
});

describe('sanitizeTemplate', () => {
  test('falls back field by field and always uses the given id', () => {
    const result = sanitizeTemplate(
      { id: 'evil', name: '我的模板', layout: 'nope', qr: { sizeMm: 'x' } },
      'custom:1',
      STANDARD_TEMPLATE,
    );
    expect(result.id).toBe('custom:1');
    expect(result.name).toBe('我的模板');
    expect(result.layout).toBe(STANDARD_TEMPLATE.layout);
    expect(result.qr.sizeMm).toBe(STANDARD_TEMPLATE.qr.sizeMm);
  });

  test('clamps padding, QR and font sizes to the allowed ranges', () => {
    const result = sanitizeTemplate(
      { paddingMm: 50, qr: { sizeMm: 500 }, fields: { code: { fontSizeMm: 0.1 } } },
      'custom:1',
      STANDARD_TEMPLATE,
    );
    expect(result.paddingMm).toBe(TEMPLATE_LIMITS.paddingMm.max);
    expect(result.qr.sizeMm).toBe(maxQrSizeMm(TEMPLATE_LIMITS.paddingMm.max));
    expect(result.fields.code.fontSizeMm).toBe(TEMPLATE_LIMITS.fontSizeMm.min);
  });

  test('strips control characters but keeps line breaks in notes', () => {
    const result = sanitizeTemplate({ note: { text: '第一行\n第二\u0007行' } }, 'custom:1', STANDARD_TEMPLATE);
    expect(result.note.text).toBe('第一行\n第二行');
  });

  test('truncates long text', () => {
    const result = sanitizeTemplate({ note: { text: 'x'.repeat(1_000) } }, 'custom:1', STANDARD_TEMPLATE);
    expect(result.note.text).toHaveLength(TEMPLATE_LIMITS.noteLength);
  });

  test('keeps the fallback name when the new one is blank', () => {
    expect(sanitizeTemplate({ name: '' }, 'custom:1', STANDARD_TEMPLATE).name).toBe(STANDARD_TEMPLATE.name);
  });
});

describe('expandNoteText', () => {
  test('replaces every supported variable with local date and time', () => {
    const printedAt = new Date(2026, 8, 28, 9, 5);
    expect(expandNoteText('{编码}/{颜色}/{尺码}/{完整编码} {日期} {时间}', LABEL, printedAt)).toBe(
      'CL5640-TK/图片色/XXL/CL5640-TK-图片色-XXL 2026-09-28 09:05',
    );
  });

  test('leaves unknown variables untouched', () => {
    expect(expandNoteText('质检 {工号}', LABEL, new Date())).toBe('质检 {工号}');
  });
});

describe('TemplateCatalog', () => {
  test('lists built-ins before custom templates', () => {
    const { catalog } = createCatalog();
    const copy = catalog.duplicate(STANDARD_TEMPLATE.id);
    expect(catalog.list().map((t) => t.id)).toEqual([...BUILT_IN_TEMPLATES.map((t) => t.id), copy.id]);
  });

  test('duplicate creates an editable custom copy', () => {
    const { catalog, repository } = createCatalog();
    const copy = catalog.duplicate(STANDARD_TEMPLATE.id);
    expect(copy.id).toBe(`${CUSTOM_TEMPLATE_PREFIX}t1`);
    expect(copy.name).toBe(`${STANDARD_TEMPLATE.name} 副本`);
    expect(repository.saved.get(copy.id)).toEqual(copy);
    copy.fields.code.prefix = 'changed';
    expect(STANDARD_TEMPLATE.fields.code.prefix).toBe('编码：');
  });

  test('save sanitizes and persists a custom template', () => {
    const { catalog } = createCatalog();
    const copy = catalog.duplicate(STANDARD_TEMPLATE.id);
    const saved = catalog.save(copy.id, { ...copy, note: { ...copy.note, visible: true, text: '样衣间' } });
    expect(saved.note).toMatchObject({ visible: true, text: '样衣间' });
    expect(catalog.get(copy.id)).toEqual(saved);
  });

  test('built-in templates are read-only', () => {
    const { catalog } = createCatalog();
    expect(() => catalog.save(STANDARD_TEMPLATE.id, STANDARD_TEMPLATE)).toThrow(TemplateError);
    expect(() => catalog.remove(STANDARD_TEMPLATE.id)).toThrow(TemplateError);
  });

  test('saving or removing an unknown template fails', () => {
    const { catalog } = createCatalog();
    expect(() => catalog.save('custom:missing', {})).toThrow(TemplateError);
    expect(() => catalog.remove('custom:missing')).toThrow(TemplateError);
  });

  test('resolve falls back to the standard template', () => {
    const { catalog } = createCatalog();
    expect(catalog.resolve('custom:deleted')).toBe(STANDARD_TEMPLATE);
  });
});

describe('fitFontSizeMm', () => {
  test('counts CJK characters as wide and Latin as narrow', () => {
    expect(estimateTextWidthEm('图片色')).toBe(3);
    expect(estimateTextWidthEm('CL')).toBeCloseTo(1.24);
  });

  test('keeps the font size when the text fits', () => {
    expect(fitFontSizeMm('CL5640-TK', 3.2, 30, 1)).toBe(3.2);
  });

  test('shrinks long text to fit the allowed lines, never below the minimum', () => {
    const long = 'C'.repeat(80);
    const fitted = fitFontSizeMm(long, 3, 55, 2);
    expect(fitted).toBeLessThan(3);
    expect(estimateTextWidthEm(long) * fitted).toBeLessThanOrEqual(55 * 2);
    expect(fitFontSizeMm('C'.repeat(1_000), 3, 55, 1)).toBe(TEMPLATE_LIMITS.fontSizeMm.min);
  });
});
```

- [ ] **Step 2: 写失败的测试 `src/core/templates/note-override.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { STANDARD_TEMPLATE } from './builtin-templates';
import { applyNoteOverride } from './note-override';

describe('applyNoteOverride', () => {
  const withNote = { ...STANDARD_TEMPLATE, note: { ...STANDARD_TEMPLATE.note, visible: true, text: '模板备注' } };

  test('keeps the template note by default', () => {
    expect(applyNoteOverride(withNote, { kind: 'template' })).toBe(withNote);
  });

  test('hides the note', () => {
    expect(applyNoteOverride(withNote, { kind: 'none' }).note.visible).toBe(false);
  });

  test('replaces the text but keeps the template placement and style', () => {
    const result = applyNoteOverride(STANDARD_TEMPLATE, { kind: 'text', text: '返修' });
    expect(result.note).toEqual({ ...STANDARD_TEMPLATE.note, visible: true, text: '返修' });
    expect(STANDARD_TEMPLATE.note.visible).toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/core/templates/templates.test.ts src/core/templates/note-override.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 4: 实现 `src/core/templates/builtin-templates.ts`**

```ts
import { BUILT_IN_TEMPLATE_PREFIX, type FieldConfig, type LabelTemplate, type NoteConfig } from './template-model';

function field(prefix: string, fontSizeMm: number, overrides: Partial<FieldConfig> = {}): FieldConfig {
  return { visible: true, prefix, fontSizeMm, bold: true, ...overrides };
}

function note(overrides: Partial<NoteConfig> = {}): NoteConfig {
  return {
    visible: false,
    text: '',
    placement: 'beside-qr',
    fontSizeMm: 2.6,
    bold: false,
    ...overrides,
  };
}

/** 标准：复刻原标签（二维码在左，三行字段在右，底部完整编码），去掉库位。 */
export const STANDARD_TEMPLATE: LabelTemplate = {
  id: `${BUILT_IN_TEMPLATE_PREFIX}standard`,
  name: '标准（二维码在左）',
  paddingMm: 2.5,
  layout: 'qr-left',
  sideAlign: 'left',
  bottomAlign: 'left',
  qr: { visible: true, sizeMm: 24, errorCorrection: 'M' },
  fields: {
    code: field('编码：', 3.2),
    color: field('颜色：', 3.2),
    size: field('尺码：', 3.2),
    raw: field('', 3),
  },
  note: note(),
};

/** 内置模板都是 60×40mm，只读；要修改先复制成自定义模板。 */
export const BUILT_IN_TEMPLATES: readonly LabelTemplate[] = [
  STANDARD_TEMPLATE,
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}qr-right`,
    name: '二维码在右',
    layout: 'qr-right',
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}big-qr`,
    name: '大二维码 + 日期备注',
    qr: { visible: true, sizeMm: 30, errorCorrection: 'Q' },
    fields: {
      code: field('', 3.4),
      color: field('', 3),
      size: field('', 3.4),
      raw: field('', 2.6, { visible: false }),
    },
    note: note({ visible: true, text: '{日期}', fontSizeMm: 2.4 }),
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}bottom-note`,
    name: '小二维码 + 底部备注',
    qr: { visible: true, sizeMm: 18, errorCorrection: 'M' },
    fields: {
      code: field('编码：', 3.4),
      color: field('颜色：', 3.4),
      size: field('尺码：', 3.4),
      raw: field('', 2.6),
    },
    note: note({ visible: true, text: '{日期} {时间}', placement: 'bottom', fontSizeMm: 2.4 }),
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}plain`,
    name: '精简（无前缀）',
    fields: {
      code: field('', 3.8),
      color: field('', 3.4),
      size: field('', 3.8),
      raw: field('', 2.8, { bold: false }),
    },
  },
];

export const DEFAULT_TEMPLATE_ID = STANDARD_TEMPLATE.id;
```

- [ ] **Step 5: 实现 `src/core/templates/sanitize-template.ts`**

```ts
import {
  FIELD_KEYS,
  type FieldConfig,
  type FieldKey,
  type LabelTemplate,
  maxQrSizeMm,
  NOTE_PLACEMENTS,
  type NoteConfig,
  QR_ERROR_LEVELS,
  QR_LAYOUTS,
  TEMPLATE_LIMITS,
  TEXT_ALIGNS,
  type TextStyle,
} from './template-model';

type Loose = Record<string, unknown>;

/**
 * 把不可信的输入（IPC、数据库）收敛成合法模板：缺失或类型错误的字段取 fallback，数值夹到允许范围。
 * id 永远取调用方给定的值，不信任输入里的 id。
 */
export function sanitizeTemplate(value: unknown, id: string, fallback: LabelTemplate): LabelTemplate {
  const input = asLoose(value);
  const qrInput = asLoose(input['qr']);
  const fieldsInput = asLoose(input['fields']);
  const { paddingMm, qrSizeMm, nameLength } = TEMPLATE_LIMITS;
  const padding = clamp(input['paddingMm'], paddingMm.min, paddingMm.max, fallback.paddingMm);
  const fields = {} as Record<FieldKey, FieldConfig>;
  for (const key of FIELD_KEYS) {
    fields[key] = sanitizeField(fieldsInput[key], fallback.fields[key]);
  }
  return {
    id,
    name: sanitizeText(input['name'], nameLength, fallback.name) || fallback.name,
    paddingMm: padding,
    layout: pick(input['layout'], QR_LAYOUTS, fallback.layout),
    sideAlign: pick(input['sideAlign'], TEXT_ALIGNS, fallback.sideAlign),
    bottomAlign: pick(input['bottomAlign'], TEXT_ALIGNS, fallback.bottomAlign),
    qr: {
      visible: bool(qrInput['visible'], fallback.qr.visible),
      sizeMm: clamp(qrInput['sizeMm'], qrSizeMm.min, maxQrSizeMm(padding), fallback.qr.sizeMm),
      errorCorrection: pick(qrInput['errorCorrection'], QR_ERROR_LEVELS, fallback.qr.errorCorrection),
    },
    fields,
    note: sanitizeNote(input['note'], fallback.note),
  };
}

function sanitizeStyle(input: Loose, fallback: TextStyle): TextStyle {
  const { fontSizeMm } = TEMPLATE_LIMITS;
  return {
    fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, fallback.fontSizeMm),
    bold: bool(input['bold'], fallback.bold),
  };
}

function sanitizeField(value: unknown, fallback: FieldConfig): FieldConfig {
  const input = asLoose(value);
  return {
    ...sanitizeStyle(input, fallback),
    visible: bool(input['visible'], fallback.visible),
    prefix: sanitizeText(input['prefix'], TEMPLATE_LIMITS.prefixLength, fallback.prefix),
  };
}

function sanitizeNote(value: unknown, fallback: NoteConfig): NoteConfig {
  const input = asLoose(value);
  return {
    ...sanitizeStyle(input, fallback),
    visible: bool(input['visible'], fallback.visible),
    text: sanitizeText(input['text'], TEMPLATE_LIMITS.noteLength, fallback.text),
    placement: pick(input['placement'], NOTE_PLACEMENTS, fallback.placement),
  };
}

function asLoose(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（保留换行）
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** 去掉控制字符（保留换行，备注允许多行）并截断长度。 */
function sanitizeText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.replace(CONTROL_CHARACTERS, '').slice(0, maxLength);
}
```

- [ ] **Step 6: 实现 `src/core/templates/note-text.ts`**

```ts
import type { LabelData } from '../types';

/** 备注支持的变量（中文名，方便操作员记忆）。未知变量原样保留。 */
export const NOTE_VARIABLES = ['{编码}', '{颜色}', '{尺码}', '{完整编码}', '{日期}', '{时间}'] as const;

const VARIABLE_PATTERN = /\{(编码|颜色|尺码|完整编码|日期|时间)\}/g;

export function expandNoteText(text: string, label: LabelData, printedAt: Date): string {
  return text.replace(VARIABLE_PATTERN, (_, name: string) => {
    switch (name) {
      case '编码':
        return label.code;
      case '颜色':
        return label.color;
      case '尺码':
        return label.size;
      case '完整编码':
        return label.raw;
      case '日期':
        return formatDate(printedAt);
      default:
        return formatTime(printedAt);
    }
  });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地时间 YYYY-MM-DD。 */
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地时间 HH:mm。 */
function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
```

- [ ] **Step 7: 实现 `src/core/templates/text-fit.ts`**

```ts
import { TEMPLATE_LIMITS } from './template-model';

/** 字宽估算（单位 em，按微软雅黑粗体偏保守取值）。 */
const WIDE_CHAR_EM = 1;
const NARROW_CHAR_EM = 0.62;
const SPACE_EM = 0.32;
const WIDE_CHAR_PATTERN = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function estimateTextWidthEm(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') {
      width += SPACE_EM;
    } else {
      width += WIDE_CHAR_PATTERN.test(char) ? WIDE_CHAR_EM : NARROW_CHAR_EM;
    }
  }
  return width;
}

/**
 * 文本在 maxLines 行内放不下时缩小字号（不低于最小字号），避免被标签边缘裁掉。
 * 这是估算：保证常见编码（含 128 字符上限）不被裁切，而不是精确排版。
 */
export function fitFontSizeMm(text: string, fontSizeMm: number, availableWidthMm: number, maxLines: number): number {
  const widthEm = estimateTextWidthEm(text);
  if (widthEm === 0 || availableWidthMm <= 0) {
    return fontSizeMm;
  }
  const fitting = (availableWidthMm * maxLines) / widthEm;
  const fitted = Math.min(fontSizeMm, fitting);
  return Math.max(TEMPLATE_LIMITS.fontSizeMm.min, Math.floor(fitted * 10) / 10);
}
```

- [ ] **Step 8: 实现 `src/core/templates/template-catalog.ts`**

```ts
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE } from './builtin-templates';
import { sanitizeTemplate } from './sanitize-template';
import { CUSTOM_TEMPLATE_PREFIX, isBuiltInTemplateId, type LabelTemplate, TEMPLATE_LIMITS } from './template-model';

/** 自定义模板的持久化（同步，与 DatabaseSync 一致）。 */
export interface TemplateRepository {
  listCustom(): LabelTemplate[];
  save(template: LabelTemplate): void;
  remove(id: string): void;
}

export type TemplateErrorCode = 'BUILT_IN_READ_ONLY' | 'NOT_FOUND';

export class TemplateError extends Error {
  readonly code: TemplateErrorCode;

  constructor(code: TemplateErrorCode, message: string) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
  }
}

/** 内置模板（只读，随程序发布）+ 自定义模板（存数据库）。 */
export class TemplateCatalog {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly createId: () => string,
  ) {}

  list(): LabelTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...this.repository.listCustom()];
  }

  get(id: string): LabelTemplate | null {
    return this.list().find((template) => template.id === id) ?? null;
  }

  /** 找不到（例如已被删除）时回退到标准模板，保证打印永远有模板可用。 */
  resolve(id: string): LabelTemplate {
    return this.get(id) ?? STANDARD_TEMPLATE;
  }

  duplicate(sourceId: string): LabelTemplate {
    const source = this.resolve(sourceId);
    const copy: LabelTemplate = {
      ...structuredClone(source),
      id: `${CUSTOM_TEMPLATE_PREFIX}${this.createId()}`,
      name: `${source.name} 副本`.slice(0, TEMPLATE_LIMITS.nameLength),
    };
    this.repository.save(copy);
    return copy;
  }

  save(id: string, value: unknown): LabelTemplate {
    const existing = this.requireCustom(id);
    const template = sanitizeTemplate(value, id, existing);
    this.repository.save(template);
    return template;
  }

  remove(id: string): void {
    this.requireCustom(id);
    this.repository.remove(id);
  }

  private requireCustom(id: string): LabelTemplate {
    if (isBuiltInTemplateId(id)) {
      throw new TemplateError('BUILT_IN_READ_ONLY', `Built-in template ${id} cannot be changed`);
    }
    const existing = this.get(id);
    if (!existing) {
      throw new TemplateError('NOT_FOUND', `Template ${id} does not exist`);
    }
    return existing;
  }
}
```

- [ ] **Step 9: 实现 `src/core/templates/note-override.ts`**

```ts
import type { LabelTemplate } from './template-model';

/**
 * 主界面「备注」下拉框的选择：沿用模板备注、不打印备注，或用一条常用备注替换模板的备注文字
 * （位置、字号、对齐仍取模板设置）。
 */
export type NoteOverride = { kind: 'template' } | { kind: 'none' } | { kind: 'text'; text: string };

export const DEFAULT_NOTE_OVERRIDE: NoteOverride = { kind: 'template' };

export function applyNoteOverride(template: LabelTemplate, override: NoteOverride): LabelTemplate {
  switch (override.kind) {
    case 'template':
      return template;
    case 'none':
      return { ...template, note: { ...template.note, visible: false } };
    case 'text':
      return { ...template, note: { ...template.note, visible: true, text: override.text } };
  }
}
```

- [ ] **Step 10: 运行测试、类型检查和 lint**

Run: `bun test src/core/templates/templates.test.ts src/core/templates/note-override.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 21 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 61 pass。

- [ ] **Step 11: Commit**

```bash
git add src/core/templates/templates.test.ts src/core/templates/note-override.test.ts src/core/templates/builtin-templates.ts src/core/templates/sanitize-template.ts src/core/templates/note-text.ts src/core/templates/text-fit.ts src/core/templates/template-catalog.ts src/core/templates/note-override.ts
git commit -m "feat(templates): built-in 60x40 templates, sanitizer, note variables and catalog"
```

---

### Task 5: JobStore 接口 + PrintService

所有入口的唯一业务入口：预览、门限占位、按当前模板打印、结果语义（超时 = 已打印，确定未出纸 = 释放）、记录。

**Files:**
- Create: `src/core/job-store.ts`, `src/core/testing/in-memory-job-store.ts`, `src/core/testing/fake-printer-adapter.ts`, `src/core/print-service.ts`
- Test: `src/core/print-service.test.ts`

**Interfaces:**
- Consumes：Task 1–4 的导出
- Produces：
  - `interface JobStore { append(job); listLastPrinted(since): LastPrinted[] }`（同步，与 `DatabaseSync` 一致）
  - `TEST_LABEL`、`class PrintService(deps)`：`restore()`、`preview(raw)`、`submit(request)`、`printTest(printerName)`；`PrintServiceDeps` 含 `resolveTemplate: () => LabelTemplate`
  - 测试替身：`InMemoryJobStore`（额外 `listRecent`）、`FakePrinterAdapter`（`failNext`、`hold`）

- [ ] **Step 1: 创建 `src/core/job-store.ts`**

```ts
import type { JobRecord } from './types';

export interface LastPrinted {
  raw: string;
  printedAt: number;
}

/** PrintService 需要的打印记录能力（同步，与 DatabaseSync 一致）。 */
export interface JobStore {
  append(job: JobRecord): void;
  /** since 之后每个码最后一次成功打印的时间，用于重启后恢复门限。 */
  listLastPrinted(since: number): LastPrinted[];
}
```

- [ ] **Step 2: 创建 `src/core/testing/in-memory-job-store.ts`**

```ts
import type { JobStore, LastPrinted } from '../job-store';
import type { JobRecord } from '../types';

/** 测试替身：只实现 PrintService 需要的能力，另加 listRecent 供断言。 */
export class InMemoryJobStore implements JobStore {
  private readonly jobs: JobRecord[] = [];

  append(job: JobRecord): void {
    this.jobs.push(job);
  }

  listLastPrinted(since: number): LastPrinted[] {
    const latest = new Map<string, number>();
    for (const job of this.jobs) {
      if (job.status === 'printed' && job.createdAt >= since) {
        latest.set(job.raw, Math.max(latest.get(job.raw) ?? job.createdAt, job.createdAt));
      }
    }
    return [...latest].map(([raw, printedAt]) => ({ raw, printedAt }));
  }

  listRecent(limit: number): JobRecord[] {
    return this.jobs.slice(-limit).reverse();
  }
}
```

- [ ] **Step 3: 创建 `src/core/testing/fake-printer-adapter.ts`**

```ts
import type { LabelJob, PrinterAdapter, PrinterInfo } from '../types';

export class FakePrinterAdapter implements PrinterAdapter {
  readonly printed: Array<{ printerName: string; raw: string; templateId: string }> = [];
  printers: PrinterInfo[] = [{ name: '热敏标签机', displayName: '热敏标签机' }];
  private nextError: unknown = null;
  private gate: Promise<void> | null = null;

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.printers;
  }

  async print(printerName: string, job: LabelJob): Promise<void> {
    if (this.gate) {
      await this.gate;
    }
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    this.printed.push({ printerName, raw: job.label.raw, templateId: job.template.id });
  }

  failNext(error: unknown): void {
    this.nextError = error;
  }

  /** 让后续 print 挂起，直到调用返回的 release()。 */
  hold(): () => void {
    let release: () => void = () => {};
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = null;
      release();
    };
  }
}
```

- [ ] **Step 4: 写失败的测试 `src/core/print-service.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { DedupGuard } from './dedup-guard';
import { PrintError } from './errors';
import { MAX_RAW_LENGTH } from './label-parser';
import { PrintQueue } from './print-queue';
import { PrintService, TEST_LABEL } from './print-service';
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE } from './templates/builtin-templates';
import type { LabelTemplate } from './templates/template-model';
import { FAKE_CLOCK_START, FakeClock } from './testing/fake-clock';
import { FakePrinterAdapter } from './testing/fake-printer-adapter';
import { InMemoryJobStore } from './testing/in-memory-job-store';
import type { PrintRequest } from './types';

const WINDOW_MS = 10 * 60_000;
const RAW = 'CL5640-TK-图片色-XL';
const PRINTER = '热敏标签机';

function createHarness(store = new InMemoryJobStore()) {
  const clock = new FakeClock();
  const adapter = new FakePrinterAdapter();
  const guard = new DedupGuard(clock, WINDOW_MS);
  let template: LabelTemplate = STANDARD_TEMPLATE;
  let nextId = 0;
  const service = new PrintService({
    adapter,
    store,
    guard,
    clock,
    queue: new PrintQueue(1_000),
    createId: () => `job-${++nextId}`,
    resolveTemplate: () => template,
  });
  const useTemplate = (next: LabelTemplate) => {
    template = next;
  };
  return { clock, adapter, store, service, useTemplate };
}

function request(overrides: Partial<PrintRequest> = {}): PrintRequest {
  return { raw: RAW, printerName: PRINTER, source: 'desktop', ...overrides };
}

describe('PrintService.submit', () => {
  test('prints a valid label with the active template and records it', async () => {
    const { service, adapter, store } = createHarness();
    const result = await service.submit(request());
    expect(result).toEqual({
      status: 'printed',
      jobId: 'job-1',
      label: { raw: RAW, code: 'CL5640-TK', color: '图片色', size: 'XL' },
    });
    expect(adapter.printed).toEqual([{ printerName: PRINTER, raw: RAW, templateId: STANDARD_TEMPLATE.id }]);
    expect(store.listRecent(1)[0]).toMatchObject({
      id: 'job-1',
      raw: RAW,
      printerName: PRINTER,
      source: 'desktop',
      status: 'printed',
      forced: false,
    });
  });

  test('uses the template that is active at print time', async () => {
    const { service, adapter, useTemplate } = createHarness();
    const [, second] = BUILT_IN_TEMPLATES;
    if (!second) throw new Error('expected more than one built-in template');
    useTemplate(second);
    await service.submit(request());
    expect(adapter.printed[0]?.templateId).toBe(second.id);
  });

  test('rejects malformed input without printing and stores a truncated copy', async () => {
    const { service, adapter, store } = createHarness();
    expect(await service.submit(request({ raw: `  ${'x'.repeat(500)}  ` }))).toEqual({
      status: 'invalid',
      reason: 'INVALID_FORMAT',
    });
    expect(adapter.printed).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ status: 'invalid', raw: 'x'.repeat(MAX_RAW_LENGTH) });
  });

  test('blocks and records a repeat scan inside the window', async () => {
    const { service, adapter, clock, store } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(60_000);
    expect(await service.submit(request())).toEqual({
      status: 'duplicate',
      recent: { state: 'printed', at: printedAt },
      windowMs: WINDOW_MS,
    });
    expect(adapter.printed).toHaveLength(1);
    expect(store.listRecent(1)[0]?.status).toBe('duplicate');
  });

  test('concurrent scans of the same code print once', async () => {
    const { service, adapter } = createHarness();
    const release = adapter.hold();
    const first = service.submit(request());
    const second = await service.submit(request({ source: 'history' }));
    expect(second).toMatchObject({ status: 'duplicate', recent: { state: 'printing' } });
    release();
    expect((await first).status).toBe('printed');
    expect(adapter.printed).toHaveLength(1);
  });

  test('a printer that is not ready fails with detail and can be retried immediately', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_READY', 'offline', '打印机离线'));
    expect(await service.submit(request())).toEqual({
      status: 'failed',
      reason: 'PRINTER_NOT_READY',
      detail: '打印机离线',
    });
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('a timeout is treated as possibly printed: re-scans are blocked until forced', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINT_TIMEOUT'));
    expect(await service.submit(request())).toEqual({ status: 'failed', reason: 'PRINT_TIMEOUT' });
    expect((await service.submit(request())).status).toBe('duplicate');
    expect((await service.submit(request({ force: true }))).status).toBe('printed');
  });

  test('unexpected errors are reported as PRINT_ERROR', async () => {
    const { service, adapter, store } = createHarness();
    adapter.failNext(new Error('driver crashed'));
    expect(await service.submit(request())).toEqual({ status: 'failed', reason: 'PRINT_ERROR' });
    expect(store.listRecent(1)[0]?.failureReason).toBe('PRINT_ERROR');
  });

  test('force reprints inside the window and is recorded as forced', async () => {
    const { service, adapter, store } = createHarness();
    await service.submit(request());
    expect((await service.submit(request({ force: true, source: 'history' }))).status).toBe('printed');
    expect(adapter.printed).toHaveLength(2);
    expect(store.listRecent(1)[0]).toMatchObject({ forced: true, source: 'history' });
  });

  test('a history write failure does not turn a printed job into a failure', async () => {
    const failingStore = new InMemoryJobStore();
    failingStore.append = () => {
      throw new Error('disk full');
    };
    const { service } = createHarness(failingStore);
    expect((await service.submit(request())).status).toBe('printed');
  });
});

describe('PrintService.preview', () => {
  test('parses the label and reports no recent print', () => {
    const { service } = createHarness();
    expect(service.preview(RAW)).toEqual({
      status: 'ok',
      label: { raw: RAW, code: 'CL5640-TK', color: '图片色', size: 'XL' },
      recent: null,
    });
  });

  test('reports a recent print inside the window', async () => {
    const { service, clock } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(30_000);
    expect(service.preview(RAW)).toMatchObject({ recent: { state: 'printed', at: printedAt } });
  });

  test('rejects malformed input', () => {
    const { service } = createHarness();
    expect(service.preview('???')).toEqual({ status: 'invalid', reason: 'INVALID_FORMAT' });
  });
});

describe('PrintService.restore', () => {
  test('rebuilds the window from recorded prints after a restart', async () => {
    const store = new InMemoryJobStore();
    const printedAt = FAKE_CLOCK_START - 60_000;
    store.append({
      id: 'old',
      createdAt: printedAt,
      raw: RAW,
      printerName: PRINTER,
      source: 'desktop',
      status: 'printed',
      forced: false,
    });
    const { service } = createHarness(store);
    service.restore();
    expect(await service.submit(request())).toMatchObject({
      status: 'duplicate',
      recent: { state: 'printed', at: printedAt },
    });
  });
});

describe('PrintService.printTest', () => {
  test('prints the test label without recording or dedup', async () => {
    const { service, adapter, store } = createHarness();
    expect((await service.printTest(PRINTER)).status).toBe('printed');
    expect((await service.printTest(PRINTER)).status).toBe('printed');
    expect(adapter.printed.map((p) => p.raw)).toEqual([TEST_LABEL.raw, TEST_LABEL.raw]);
    expect(store.listRecent(10)).toEqual([]);
  });

  test('reports test print failures', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_FOUND'));
    expect(await service.printTest(PRINTER)).toEqual({ status: 'failed', reason: 'PRINTER_NOT_FOUND' });
  });
});
```

- [ ] **Step 5: 运行测试，确认失败**

Run: `bun test src/core/print-service.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 6: 实现 `src/core/print-service.ts`**

```ts
import { type DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { type PrintFailure, toPrintFailure } from './errors';
import type { JobStore } from './job-store';
import { MAX_RAW_LENGTH, parseLabel } from './label-parser';
import type { PrintQueue } from './print-queue';
import type { LabelTemplate } from './templates/template-model';
import type {
  Clock,
  JobRecord,
  LabelData,
  LabelJob,
  PreviewResult,
  PrinterAdapter,
  PrintRequest,
  PrintResult,
} from './types';

export const TEST_LABEL: LabelData = {
  raw: 'TEST-0001-测试色-XL',
  code: 'TEST-0001',
  color: '测试色',
  size: 'XL',
};

export interface PrintServiceDeps {
  adapter: PrinterAdapter;
  store: JobStore;
  guard: DedupGuard;
  queue: PrintQueue;
  clock: Clock;
  createId: () => string;
  /** 当前启用的模板；每次打印时读取，切换模板立即生效。 */
  resolveTemplate: () => LabelTemplate;
}

/** 所有入口（扫码枪、记录重打、Phase 2 的手机）的唯一业务入口。 */
export class PrintService {
  constructor(private readonly deps: PrintServiceDeps) {}

  /** 启动时从打印记录回放门限状态，重启后窗口仍然有效。 */
  restore(): void {
    const since = this.deps.clock.now() - MAX_DEDUP_WINDOW_MS;
    for (const { raw, printedAt } of this.deps.store.listLastPrinted(since)) {
      this.deps.guard.restore(raw, printedAt);
    }
  }

  preview(raw: string): PreviewResult {
    const label = parseLabel(raw);
    if (!label) {
      return { status: 'invalid', reason: 'INVALID_FORMAT' };
    }
    return { status: 'ok', label, recent: this.deps.guard.peek(label.raw) };
  }

  async submit(request: PrintRequest): Promise<PrintResult> {
    const id = this.deps.createId();
    const label = parseLabel(request.raw);
    if (!label) {
      const truncated = request.raw.trim().slice(0, MAX_RAW_LENGTH);
      return this.finish(id, request, truncated, { status: 'invalid', reason: 'INVALID_FORMAT' });
    }
    const reservation = this.deps.guard.tryReserve(label.raw, request.force === true);
    if (!reservation.ok) {
      return this.finish(id, request, label.raw, {
        status: 'duplicate',
        recent: reservation.recent,
        windowMs: this.deps.guard.windowMs,
      });
    }
    try {
      await this.deps.queue.enqueue(request.printerName, (signal) =>
        this.deps.adapter.print(request.printerName, this.createJob(label), signal),
      );
    } catch (error) {
      console.error('[PrintService] print failed', error);
      const failure = toPrintFailure(error);
      if (failure.reason === 'PRINT_TIMEOUT') {
        // 超时说明结果不确定（可能已出纸或仍在排队）：按已打印处理，避免重扫出第二张；确认没出纸再强制补打。
        this.deps.guard.commit(label.raw);
      } else {
        this.deps.guard.release(label.raw);
      }
      return this.finish(id, request, label.raw, failed(failure));
    }
    this.deps.guard.commit(label.raw);
    return this.finish(id, request, label.raw, { status: 'printed', jobId: id, label });
  }

  async printTest(printerName: string): Promise<PrintResult> {
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(TEST_LABEL), signal),
      );
      return { status: 'printed', jobId: 'test', label: TEST_LABEL };
    } catch (error) {
      console.error('[PrintService] test print failed', error);
      return failed(toPrintFailure(error));
    }
  }

  private createJob(label: LabelData): LabelJob {
    return { label, template: this.deps.resolveTemplate(), printedAt: this.deps.clock.now() };
  }

  private finish(id: string, request: PrintRequest, raw: string, result: PrintResult): PrintResult {
    const job: JobRecord = {
      id,
      createdAt: this.deps.clock.now(),
      raw,
      printerName: request.printerName,
      source: request.source,
      status: result.status,
      forced: request.force === true,
    };
    if (result.status === 'failed') {
      job.failureReason = result.reason;
    }
    try {
      this.deps.store.append(job);
    } catch (error) {
      // 以打印机为准：记录写失败不能把已出纸的任务报成失败，否则操作员会重复打印。
      console.error('[PrintService] failed to record job', error);
    }
    return result;
  }
}

function failed(failure: PrintFailure): PrintResult {
  return { status: 'failed', ...failure };
}
```

- [ ] **Step 7: 运行测试、类型检查和 lint**

Run: `bun test src/core/print-service.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 16 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 77 pass。

- [ ] **Step 8: Commit**

```bash
git add src/core/job-store.ts src/core/testing/in-memory-job-store.ts src/core/testing/fake-printer-adapter.ts src/core/print-service.test.ts src/core/print-service.ts
git commit -m "feat(core): PrintService with preview, dedup-guarded submit and template-aware printing"
```

---

### Task 6: SQLite 数据库（node:sqlite + 迁移 + FTS5 + 事务）

`node:sqlite` 是 Electron 44 内置 Node 24.21 自带的模块（SQLite 3.53.4，含 FTS5 trigram）；Bun 1.4 同样实现了它，所以存储层直接 `bun test`。

**Files:**
- Create: `src/main/storage/migrations.ts`, `src/main/storage/database.ts`, `src/main/storage/row-readers.ts`
- Test: `src/main/storage/database.test.ts`

**Interfaces:**
- Produces：`openDatabase(path)`（建目录、pragma、迁移；支持 `:memory:`）、`migrate(db, migrations?)`、`runInTransaction(db, work)`、`MIGRATIONS`、行读取 `Row`/`readString`/`readInteger`/`readEnum`

- [ ] **Step 1: 写失败的测试 `src/main/storage/database.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { migrate, openDatabase, runInTransaction } from './database';
import { MIGRATIONS } from './migrations';

function userVersion(db: DatabaseSync): unknown {
  return db.prepare('PRAGMA user_version').get()?.['user_version'];
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'jobs_search_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row['name']));
}

describe('openDatabase', () => {
  test('migrates a fresh database to the latest schema', () => {
    const db = openDatabase(':memory:');
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).toEqual(['jobs', 'jobs_search', 'settings', 'templates']);
    db.close();
  });
});

describe('migrate', () => {
  test('applies only pending migrations and is idempotent', () => {
    const db = openDatabase(':memory:');
    const extra = [...MIGRATIONS, 'CREATE TABLE extra (x INTEGER) STRICT;'];
    migrate(db, extra);
    migrate(db, extra);
    expect(userVersion(db)).toBe(extra.length);
    expect(tableNames(db)).toContain('extra');
    db.close();
  });

  test('rolls back a failing migration and keeps the old version', () => {
    const db = openDatabase(':memory:');
    const broken = [...MIGRATIONS, 'CREATE TABLE half (x INTEGER) STRICT; CREATE TABLE half (x INTEGER) STRICT;'];
    expect(() => migrate(db, broken)).toThrow();
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).not.toContain('half');
    db.close();
  });

  test('refuses a database written by a newer app version', () => {
    const db = openDatabase(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer/);
    db.close();
  });
});

describe('runInTransaction', () => {
  test('rolls back every statement when the work throws', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      runInTransaction(db, () => {
        db.prepare("INSERT INTO settings (key, value) VALUES ('a', '1')").run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()?.['n']).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/main/storage/database.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 3: 实现 `src/main/storage/migrations.ts`**

```ts
/**
 * Schema 迁移：按顺序执行，数组下标 + 1 就是 PRAGMA user_version。
 * 已发布的迁移不能修改，只能在末尾追加。
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE jobs (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    id             TEXT    NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL,
    raw            TEXT    NOT NULL,
    printer_name   TEXT    NOT NULL,
    source         TEXT    NOT NULL CHECK (source IN ('desktop', 'history', 'mobile')),
    status         TEXT    NOT NULL CHECK (status IN ('printed', 'duplicate', 'invalid', 'failed')),
    forced         INTEGER NOT NULL CHECK (forced IN (0, 1)),
    failure_reason TEXT             CHECK (failure_reason IN
      ('PRINTER_NOT_FOUND', 'PRINTER_NOT_READY', 'PRINT_TIMEOUT', 'PRINT_ERROR'))
  ) STRICT;

  CREATE INDEX jobs_printed_at ON jobs (created_at) WHERE status = 'printed';

  -- 打印记录全文索引（trigram：任意 3 个字符以上的子串都能走索引，中文同样适用）
  CREATE VIRTUAL TABLE jobs_search USING fts5 (raw, content = 'jobs', content_rowid = 'seq', tokenize = 'trigram');

  CREATE TRIGGER jobs_search_insert AFTER INSERT ON jobs BEGIN
    INSERT INTO jobs_search (rowid, raw) VALUES (new.seq, new.raw);
  END;

  CREATE TRIGGER jobs_search_delete AFTER DELETE ON jobs BEGIN
    INSERT INTO jobs_search (jobs_search, rowid, raw) VALUES ('delete', old.seq, old.raw);
  END;

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE templates (
    id         TEXT    PRIMARY KEY,
    body       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  `,
];
```

- [ ] **Step 4: 实现 `src/main/storage/database.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

const IN_MEMORY_PATH = ':memory:';
const BUSY_TIMEOUT_MS = 5_000;

/** 打开（或创建）数据库，设置 pragma，并执行尚未应用的迁移。 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== IN_MEMORY_PATH) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
  `);
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): void {
  const current = readUserVersion(db);
  if (current > migrations.length) {
    throw new Error(`Database schema v${current} is newer than this app supports (v${migrations.length})`);
  }
  for (const [index, sql] of migrations.entries()) {
    if (index < current) {
      continue;
    }
    runInTransaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}

export function runInTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readUserVersion(db: DatabaseSync): number {
  const version = db.prepare('PRAGMA user_version').get()?.['user_version'];
  if (typeof version !== 'number') {
    throw new Error('Unable to read database schema version');
  }
  return version;
}
```

- [ ] **Step 5: 实现 `src/main/storage/row-readers.ts`**

```ts
export type Row = Record<string, unknown>;

/** 数据库行进入领域层前的类型校验：列类型不符说明数据损坏，直接抛错。 */
export function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`Column "${column}" is not TEXT`);
  }
  return value;
}

export function readInteger(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`Column "${column}" is not INTEGER`);
  }
  return value;
}

export function readEnum<T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = readString(row, column);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`Column "${column}" has unexpected value "${value}"`);
  }
  return value as T;
}
```

- [ ] **Step 6: 运行测试、类型检查和 lint**

Run: `bun test src/main/storage/database.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 5 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 82 pass。

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/database.test.ts src/main/storage/migrations.ts src/main/storage/database.ts src/main/storage/row-readers.ts
git commit -m "feat(storage): node:sqlite database with WAL, versioned migrations, FTS5 and transactions"
```

---

### Task 7: SqliteJobStore（环形保留 + 全文搜索 + 分页）

插入后按主键裁剪（开销与容量无关）；调小容量分批删除并让出主线程；总数内存维护；搜索 ≥3 字走 FTS5 trigram，短词退回转义 LIKE；keyset 分页。

**Files:**
- Create: `src/shared/job-history.ts`, `src/main/storage/sqlite-job-store.ts`
- Test: `src/main/storage/sqlite-job-store.test.ts`

**Interfaces:**
- Consumes：Task 5、6
- Produces：`JobQuery`、`JobPage`、`JOB_PAGE_SIZE`、`MAX_JOB_PAGE_SIZE`（`src/shared/job-history.ts`）；`class SqliteJobStore(db, capacity) implements JobStore`：`initialize()`、`append`、`listPage(query)`、`count()`、`listLastPrinted`、`setCapacity(capacity): Promise<void>`

- [ ] **Step 1: 创建 `src/shared/job-history.ts`**

```ts
import type { JobRecord } from '../core/types';

export const JOB_PAGE_SIZE = 100;
export const MAX_JOB_PAGE_SIZE = 500;

export interface JobQuery {
  limit: number;
  /** 按二维码内容模糊搜索（不区分 ASCII 大小写）。 */
  search?: string;
  /** 分页游标：上一页返回的 nextCursor。 */
  before?: number;
}

export interface JobPage {
  /** 从新到旧。 */
  jobs: JobRecord[];
  nextCursor: number | null;
  /** 当前保留的记录总数（不受搜索影响）。 */
  total: number;
}
```

- [ ] **Step 2: 写失败的测试 `src/main/storage/sqlite-job-store.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { JobRecord } from '../../core/types';
import { openDatabase } from './database';
import { SqliteJobStore } from './sqlite-job-store';

function job(n: number, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: `job-${n}`,
    createdAt: 1_000 + n,
    raw: `CL${n}-红-XL`,
    printerName: '热敏标签机',
    source: 'desktop',
    status: 'printed',
    forced: false,
    ...overrides,
  };
}

function ids(jobs: JobRecord[]): string[] {
  return jobs.map((j) => j.id);
}

function rowCount(db: DatabaseSync): unknown {
  return db.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.['n'];
}

describe('SqliteJobStore', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  test('starts empty', () => {
    expect(new SqliteJobStore(db, 10).listPage({ limit: 10 })).toEqual({ jobs: [], nextCursor: null, total: 0 });
  });

  test('round-trips every field, newest first', () => {
    const store = new SqliteJobStore(db, 10);
    const failed = job(2, { status: 'failed', failureReason: 'PRINTER_NOT_READY', source: 'history', forced: true });
    store.append(job(1));
    store.append(failed);
    expect(store.listPage({ limit: 10 }).jobs).toEqual([failed, job(1)]);
  });

  test('keeps only the newest jobs once capacity is reached (ring) and tracks the total', () => {
    const store = new SqliteJobStore(db, 3);
    for (let n = 1; n <= 5; n += 1) store.append(job(n));
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-5', 'job-4', 'job-3']);
    expect(store.count()).toBe(3);
    expect(rowCount(db)).toBe(3);
  });

  test('setCapacity trims in batches and keeps the total in sync', async () => {
    const store = new SqliteJobStore(db, 50);
    for (let n = 1; n <= 30; n += 1) store.append(job(n));
    await store.setCapacity(4);
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-30', 'job-29', 'job-28', 'job-27']);
    expect(store.count()).toBe(4);
    expect(rowCount(db)).toBe(4);
  });

  test('growing the capacity keeps history and accepts more', async () => {
    const store = new SqliteJobStore(db, 2);
    for (let n = 1; n <= 3; n += 1) store.append(job(n));
    await store.setCapacity(5);
    for (let n = 4; n <= 6; n += 1) store.append(job(n));
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-6', 'job-5', 'job-4', 'job-3', 'job-2']);
  });

  test('initialize trims history that exceeds the capacity', async () => {
    const large = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 4; n += 1) large.append(job(n));
    const small = new SqliteJobStore(db, 2);
    await small.initialize();
    expect(small.count()).toBe(2);
  });

  test('pages through history with a cursor', () => {
    const store = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 5; n += 1) store.append(job(n));
    const first = store.listPage({ limit: 2 });
    expect(ids(first.jobs)).toEqual(['job-5', 'job-4']);
    expect(first.total).toBe(5);
    const second = store.listPage({ limit: 2, before: first.nextCursor ?? undefined });
    expect(ids(second.jobs)).toEqual(['job-3', 'job-2']);
    const last = store.listPage({ limit: 2, before: second.nextCursor ?? undefined });
    expect(ids(last.jobs)).toEqual(['job-1']);
    expect(last.nextCursor).toBeNull();
  });

  test('searches with the full-text index, case-insensitively, including Chinese', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'CL5640-TK-图片色-XL' }));
    store.append(job(2, { raw: 'AB12-黑色-S' }));
    expect(ids(store.listPage({ limit: 10, search: 'cl5640' }).jobs)).toEqual(['job-1']);
    expect(ids(store.listPage({ limit: 10, search: '图片色' }).jobs)).toEqual(['job-1']);
    expect(store.listPage({ limit: 10, search: 'cl5640' }).total).toBe(2);
  });

  test('short searches fall back to LIKE and treat wildcards literally', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'X%Y-红-M' }));
    store.append(job(2, { raw: 'XAY-黑-M' }));
    expect(ids(store.listPage({ limit: 10, search: '%' }).jobs)).toEqual(['job-1']);
    expect(ids(store.listPage({ limit: 10, search: '黑' }).jobs)).toEqual(['job-2']);
  });

  test('search terms cannot inject FTS syntax', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'A"B OR C-红-M' }));
    expect(ids(store.listPage({ limit: 10, search: 'A"B OR' }).jobs)).toEqual(['job-1']);
    expect(store.listPage({ limit: 10, search: '") OR ("' }).jobs).toEqual([]);
  });

  test('search results page with a cursor too', () => {
    const store = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 5; n += 1) store.append(job(n, { raw: `SAME-红-${n}` }));
    store.append(job(6, { raw: 'OTHER-黑-1' }));
    const first = store.listPage({ limit: 2, search: 'SAME' });
    expect(ids(first.jobs)).toEqual(['job-5', 'job-4']);
    const second = store.listPage({ limit: 10, search: 'SAME', before: first.nextCursor ?? undefined });
    expect(ids(second.jobs)).toEqual(['job-3', 'job-2', 'job-1']);
  });

  test('ring deletions also leave the search index', () => {
    const store = new SqliteJobStore(db, 1);
    store.append(job(1, { raw: 'GONE-红-M' }));
    store.append(job(2, { raw: 'KEPT-黑-M' }));
    expect(store.listPage({ limit: 10, search: 'GONE' }).jobs).toEqual([]);
  });

  test('lists the latest successful print per code since a timestamp', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'A-红-1', createdAt: 100 }));
    store.append(job(2, { raw: 'A-红-1', createdAt: 300 }));
    store.append(job(3, { raw: 'B-黑-2', createdAt: 400, status: 'duplicate' }));
    store.append(job(4, { raw: 'C-白-3', createdAt: 50 }));
    expect(store.listLastPrinted(90)).toEqual([{ raw: 'A-红-1', printedAt: 300 }]);
  });

  test.each([0, -1, 2.5])('rejects capacity %p', (capacity) => {
    expect(() => new SqliteJobStore(db, capacity)).toThrow(RangeError);
  });
});

describe('SqliteJobStore persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'labelflash-db-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('keeps history and the search index across reopen', () => {
    const path = join(dir, 'CDL-LabelFlash', 'labelflash.db');
    const first = openDatabase(path);
    new SqliteJobStore(first, 10).append(job(1, { raw: 'CL5640-TK-图片色-XXL' }));
    first.close();
    const second = openDatabase(path);
    const store = new SqliteJobStore(second, 10);
    expect(ids(store.listPage({ limit: 10, search: 'XXL' }).jobs)).toEqual(['job-1']);
    expect(store.count()).toBe(1);
    second.close();
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/main/storage/sqlite-job-store.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 4: 实现 `src/main/storage/sqlite-job-store.ts`**

```ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { JobStore, LastPrinted } from '../../core/job-store';
import { type JobRecord, PRINT_FAILURE_REASONS, PRINT_SOURCES, PRINT_STATUSES } from '../../core/types';
import type { JobPage, JobQuery } from '../../shared/job-history';
import { runInTransaction } from './database';
import { type Row, readEnum, readInteger, readString } from './row-readers';

const JOB_COLUMNS = `
  jobs.seq, jobs.id, jobs.created_at AS createdAt, jobs.raw, jobs.printer_name AS printerName,
  jobs.source, jobs.status, jobs.forced, jobs.failure_reason AS failureReason`;
/** trigram 索引至少需要 3 个字符；更短的搜索词退回 LIKE（LIMIT 保证找够一页就停）。 */
const FTS_MIN_QUERY_LENGTH = 3;
/** 调小容量时每批删除的行数；批与批之间让出主线程，避免卡住打印。 */
const TRIM_BATCH_SIZE = 10_000;

/**
 * 打印记录，环形保留：jobs 表只保留最新的 capacity 条。
 * seq 是 AUTOINCREMENT，单调递增且不复用；总数在内存中维护，避免每次翻页都 COUNT(*)。
 */
export class SqliteJobStore implements JobStore {
  private capacity: number;
  private total: number;
  private readonly insertJob: StatementSync;
  private readonly trimBehind: StatementSync;
  private readonly trimOldestBatch: StatementSync;
  private readonly selectPage: StatementSync;
  private readonly searchPageFts: StatementSync;
  private readonly searchPageLike: StatementSync;
  private readonly selectCount: StatementSync;
  private readonly selectLastPrinted: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    capacity: number,
  ) {
    this.capacity = assertCapacity(capacity);
    this.insertJob = db.prepare(`
      INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, failure_reason)
      VALUES (:id, :createdAt, :raw, :printerName, :source, :status, :forced, :failureReason)`);
    // 插入后使用：只保留 seq 落在最新 capacity 个序号内的记录，走主键，开销与容量无关。
    this.trimBehind = db.prepare('DELETE FROM jobs WHERE seq <= :lastSeq - :capacity');
    this.trimOldestBatch = db.prepare(`
      DELETE FROM jobs WHERE seq IN (SELECT seq FROM jobs ORDER BY seq ASC LIMIT :batch)`);
    this.selectPage = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    this.searchPageFts = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs_search JOIN jobs ON jobs.seq = jobs_search.rowid
      WHERE jobs_search MATCH :match AND (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    this.searchPageLike = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE jobs.raw LIKE :pattern ESCAPE '\\' AND (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    this.selectCount = db.prepare('SELECT COUNT(*) AS total FROM jobs');
    this.selectLastPrinted = db.prepare(`
      SELECT raw, MAX(created_at) AS printedAt
      FROM jobs
      WHERE status = 'printed' AND created_at >= :since
      GROUP BY raw`);
    this.total = this.readCount();
  }

  /** 启动时调用：历史超过容量（例如上次调小容量后异常退出）时分批裁剪。 */
  async initialize(): Promise<void> {
    await this.trimToCapacity();
  }

  append(job: JobRecord): void {
    runInTransaction(this.db, () => {
      const { lastInsertRowid } = this.insertJob.run({
        id: job.id,
        createdAt: job.createdAt,
        raw: job.raw,
        printerName: job.printerName,
        source: job.source,
        status: job.status,
        forced: job.forced ? 1 : 0,
        failureReason: job.failureReason ?? null,
      });
      const { changes } = this.trimBehind.run({ lastSeq: lastInsertRowid, capacity: this.capacity });
      this.total += 1 - Number(changes);
    });
  }

  listPage(query: JobQuery): JobPage {
    const rows = this.selectRows(query.search?.trim() ?? '', query.before ?? null, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      jobs: pageRows.map(toJobRecord),
      nextCursor: hasMore && lastRow ? readInteger(lastRow, 'seq') : null,
      total: this.total,
    };
  }

  count(): number {
    return this.total;
  }

  listLastPrinted(since: number): LastPrinted[] {
    return this.selectLastPrinted.all({ since }).map((row) => ({
      raw: readString(row, 'raw'),
      printedAt: readInteger(row, 'printedAt'),
    }));
  }

  async setCapacity(capacity: number): Promise<void> {
    this.capacity = assertCapacity(capacity);
    await this.trimToCapacity();
  }

  private selectRows(search: string, before: number | null, limit: number): Row[] {
    if (search === '') {
      return this.selectPage.all({ before, limit });
    }
    if ([...search].length >= FTS_MIN_QUERY_LENGTH) {
      return this.searchPageFts.all({ match: toFtsPhrase(search), before, limit });
    }
    return this.searchPageLike.all({ pattern: `%${escapeLike(search)}%`, before, limit });
  }

  private async trimToCapacity(): Promise<void> {
    while (this.total > this.capacity) {
      const batch = Math.min(TRIM_BATCH_SIZE, this.total - this.capacity);
      const { changes } = this.trimOldestBatch.run({ batch });
      this.total -= Number(changes);
      if (Number(changes) === 0) {
        this.total = this.readCount();
        return;
      }
      await yieldToEventLoop();
    }
  }

  private readCount(): number {
    const row = this.selectCount.get();
    if (!row) {
      throw new Error('COUNT query returned no row');
    }
    return readInteger(row, 'total');
  }
}

function toJobRecord(row: Row): JobRecord {
  const job: JobRecord = {
    id: readString(row, 'id'),
    createdAt: readInteger(row, 'createdAt'),
    raw: readString(row, 'raw'),
    printerName: readString(row, 'printerName'),
    source: readEnum(row, 'source', PRINT_SOURCES),
    status: readEnum(row, 'status', PRINT_STATUSES),
    forced: readInteger(row, 'forced') === 1,
  };
  if (row['failureReason'] !== null) {
    job.failureReason = readEnum(row, 'failureReason', PRINT_FAILURE_REASONS);
  }
  return job;
}

/** FTS5 短语查询：用双引号包住，内部双引号转义，避免被当成查询语法。 */
function toFtsPhrase(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

function assertCapacity(capacity: number): number {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`Invalid history capacity: ${capacity}`);
  }
  return capacity;
}
```

- [ ] **Step 5: 运行测试、类型检查和 lint**

Run: `bun test src/main/storage/sqlite-job-store.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 17 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 99 pass。

- [ ] **Step 6: Commit**

```bash
git add src/shared/job-history.ts src/main/storage/sqlite-job-store.test.ts src/main/storage/sqlite-job-store.ts
git commit -m "feat(storage): SQLite job history with ring retention, FTS search and keyset paging"
```

---

### Task 8: 设置 + 自定义模板仓库（SQLite 持久化）

设置（当前打印机、当前模板、备注选择与常用备注、自动打印、门限、记录上限、开机自启）与自定义模板都存 SQLite，读出时再校验一遍。

**Files:**
- Create: `src/shared/settings.ts`, `src/main/storage/sqlite-settings-store.ts`, `src/main/storage/sqlite-template-repository.ts`
- Test: `src/shared/settings.test.ts`, `src/main/storage/sqlite-settings-store.test.ts`, `src/main/storage/sqlite-template-repository.test.ts`

**Interfaces:**
- Consumes：Task 2、4、6
- Produces：`AppSettings`（含 `noteOverride`、`notePresets`）、`DEFAULT_SETTINGS`、`MAX_DEDUP_WINDOW_MINUTES`、`HISTORY_LIMIT_RANGE`、`MAX_NOTE_PRESETS`、`sanitizeSettings`、`sanitizeNoteText`、`minutesToMs`、`isRecord`；`class SqliteSettingsStore(db)`：`current`、`update(patch): AppSettings`；`class SqliteTemplateRepository(db, clock) implements TemplateRepository`

- [ ] **Step 1: 写失败的测试 `src/shared/settings.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  HISTORY_LIMIT_RANGE,
  MAX_DEDUP_WINDOW_MINUTES,
  MAX_NOTE_PRESETS,
  sanitizeSettings,
} from './settings';

describe('sanitizeSettings', () => {
  // 不用 test.each：Bun 会把 undefined 那一行的参数当成 done 回调，导致超时。
  test('falls back to defaults for non-object input', () => {
    for (const value of [undefined, null, 42, 'x', []]) {
      expect(sanitizeSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test('keeps valid values', () => {
    const settings: AppSettings = {
      selectedPrinter: '标签',
      activeTemplateId: 'custom:3f2c-9a',
      noteOverride: { kind: 'text', text: '返修' },
      notePresets: ['返修', '样衣间 {日期}'],
      autoPrint: false,
      dedupWindowMinutes: 30,
      historyLimit: 20_000,
      launchAtLogin: true,
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  test('clamps and rounds numbers', () => {
    expect(sanitizeSettings({ dedupWindowMinutes: -5 }).dedupWindowMinutes).toBe(0);
    expect(sanitizeSettings({ dedupWindowMinutes: 99_999 }).dedupWindowMinutes).toBe(MAX_DEDUP_WINDOW_MINUTES);
    expect(sanitizeSettings({ dedupWindowMinutes: 12.6 }).dedupWindowMinutes).toBe(13);
    expect(sanitizeSettings({ historyLimit: 1 }).historyLimit).toBe(HISTORY_LIMIT_RANGE.min);
    expect(sanitizeSettings({ historyLimit: 1e9 }).historyLimit).toBe(HISTORY_LIMIT_RANGE.max);
  });

  test('sanitizes the note selection', () => {
    expect(sanitizeSettings({ noteOverride: { kind: 'none' } }).noteOverride).toEqual({ kind: 'none' });
    expect(sanitizeSettings({ noteOverride: { kind: 'text', text: '  返修 \u0007 ' } }).noteOverride).toEqual({
      kind: 'text',
      text: '返修',
    });
    expect(sanitizeSettings({ noteOverride: { kind: 'text', text: '   ' } }).noteOverride).toEqual({
      kind: 'template',
    });
    expect(sanitizeSettings({ noteOverride: { kind: 'evil' } }).noteOverride).toEqual({ kind: 'template' });
  });

  test('cleans, de-duplicates and caps note presets', () => {
    const presets = sanitizeSettings({ notePresets: ['样衣间', ' 样衣间 ', '', 3, 'x'.repeat(500)] }).notePresets;
    expect(presets).toEqual(['样衣间', 'x'.repeat(200)]);
    const many = Array.from({ length: 30 }, (_, i) => `备注${i}`);
    expect(sanitizeSettings({ notePresets: many }).notePresets).toHaveLength(MAX_NOTE_PRESETS);
  });

  test('rejects malformed template ids', () => {
    expect(sanitizeSettings({ activeTemplateId: '../etc' }).activeTemplateId).toBe(DEFAULT_SETTINGS.activeTemplateId);
  });

  test('replaces wrong types with defaults', () => {
    expect(
      sanitizeSettings({ selectedPrinter: '', autoPrint: 'yes', dedupWindowMinutes: Number.NaN, launchAtLogin: 1 }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: 写失败的测试 `src/main/storage/sqlite-settings-store.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, MAX_DEDUP_WINDOW_MINUTES } from '../../shared/settings';
import { openDatabase } from './database';
import { SqliteSettingsStore } from './sqlite-settings-store';

describe('SqliteSettingsStore', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'labelflash-settings-'));
    path = join(dir, 'labelflash.db');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('uses defaults on a fresh database', () => {
    const db = openDatabase(path);
    expect(new SqliteSettingsStore(db).current).toEqual(DEFAULT_SETTINGS);
    db.close();
  });

  test('persists the selected printer across reopen', () => {
    const first = openDatabase(path);
    new SqliteSettingsStore(first).update({ selectedPrinter: '热敏标签机', autoPrint: false });
    first.close();
    const second = openDatabase(path);
    expect(new SqliteSettingsStore(second).current).toMatchObject({
      selectedPrinter: '热敏标签机',
      autoPrint: false,
    });
    second.close();
  });

  test('sanitizes updates', () => {
    const db = openDatabase(path);
    expect(new SqliteSettingsStore(db).update({ dedupWindowMinutes: 99_999 }).dedupWindowMinutes).toBe(
      MAX_DEDUP_WINDOW_MINUTES,
    );
    db.close();
  });

  test('ignores a stored value that is not valid JSON', () => {
    const db = openDatabase(path);
    db.prepare("INSERT INTO settings (key, value) VALUES ('autoPrint', 'not json')").run();
    expect(new SqliteSettingsStore(db).current.autoPrint).toBe(DEFAULT_SETTINGS.autoPrint);
    db.close();
  });
});
```

- [ ] **Step 3: 写失败的测试 `src/main/storage/sqlite-template-repository.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import { maxQrSizeMm } from '../../core/templates/template-model';
import { FakeClock } from '../../core/testing/fake-clock';
import { openDatabase } from './database';
import { SqliteTemplateRepository } from './sqlite-template-repository';

describe('SqliteTemplateRepository', () => {
  let db: DatabaseSync;
  let clock: FakeClock;
  let repository: SqliteTemplateRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    clock = new FakeClock();
    repository = new SqliteTemplateRepository(db, clock);
  });

  afterEach(() => {
    db.close();
  });

  test('saves, updates and lists templates in creation order', () => {
    const first = { ...structuredClone(STANDARD_TEMPLATE), id: 'custom:a', name: '甲' };
    const second = { ...structuredClone(STANDARD_TEMPLATE), id: 'custom:b', name: '乙' };
    repository.save(first);
    clock.advance(1_000);
    repository.save(second);
    clock.advance(1_000);
    repository.save({ ...first, name: '甲（改）' });
    expect(repository.listCustom().map((t) => t.name)).toEqual(['甲（改）', '乙']);
  });

  test('removes a template', () => {
    repository.save({ ...structuredClone(STANDARD_TEMPLATE), id: 'custom:a' });
    repository.remove('custom:a');
    expect(repository.listCustom()).toEqual([]);
  });

  test('re-validates stored bodies and skips unreadable rows', () => {
    db.prepare(
      "INSERT INTO templates (id, body, created_at, updated_at) VALUES ('custom:bad', 'not json', 1, 1)",
    ).run();
    db.prepare(
      'INSERT INTO templates (id, body, created_at, updated_at) VALUES (\'custom:old\', \'{"name":"旧版","qr":{"sizeMm":999}}\', 2, 2)',
    ).run();
    const [only] = repository.listCustom();
    expect(repository.listCustom()).toHaveLength(1);
    expect(only?.name).toBe('旧版');
    expect(only?.qr.sizeMm).toBe(maxQrSizeMm(STANDARD_TEMPLATE.paddingMm));
  });
});
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `bun test src/shared/settings.test.ts src/main/storage/sqlite-settings-store.test.ts src/main/storage/sqlite-template-repository.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 5: 实现 `src/shared/settings.ts`**

```ts
import { MAX_DEDUP_WINDOW_MS } from '../core/dedup-guard';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { DEFAULT_NOTE_OVERRIDE, type NoteOverride } from '../core/templates/note-override';
import { TEMPLATE_LIMITS } from '../core/templates/template-model';

export interface AppSettings {
  selectedPrinter: string | null;
  activeTemplateId: string;
  /** 主界面「备注」下拉框的当前选择。 */
  noteOverride: NoteOverride;
  /** 常用备注，供下拉框快速切换。 */
  notePresets: string[];
  autoPrint: boolean;
  dedupWindowMinutes: number;
  historyLimit: number;
  launchAtLogin: boolean;
}

export const MS_PER_MINUTE = 60_000;
export const MAX_DEDUP_WINDOW_MINUTES = MAX_DEDUP_WINDOW_MS / MS_PER_MINUTE;
export const HISTORY_LIMIT_RANGE = { min: 1_000, max: 1_000_000 } as const;
const MAX_PRINTER_NAME_LENGTH = 256;
export const MAX_NOTE_PRESETS = 20;
const TEMPLATE_ID_PATTERN = /^(builtin|custom):[\w-]{1,64}$/;

export const DEFAULT_SETTINGS: AppSettings = {
  selectedPrinter: null,
  activeTemplateId: DEFAULT_TEMPLATE_ID,
  noteOverride: DEFAULT_NOTE_OVERRIDE,
  notePresets: [],
  autoPrint: true,
  dedupWindowMinutes: 10,
  historyLimit: 100_000,
  launchAtLogin: false,
};

export function sanitizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  return {
    selectedPrinter: sanitizePrinterName(input['selectedPrinter']),
    activeTemplateId: sanitizeTemplateId(input['activeTemplateId']),
    noteOverride: sanitizeNoteOverride(input['noteOverride']),
    notePresets: sanitizeNotePresets(input['notePresets']),
    autoPrint: sanitizeBoolean(input['autoPrint'], DEFAULT_SETTINGS.autoPrint),
    dedupWindowMinutes: sanitizeInteger(
      input['dedupWindowMinutes'],
      0,
      MAX_DEDUP_WINDOW_MINUTES,
      DEFAULT_SETTINGS.dedupWindowMinutes,
    ),
    historyLimit: sanitizeInteger(
      input['historyLimit'],
      HISTORY_LIMIT_RANGE.min,
      HISTORY_LIMIT_RANGE.max,
      DEFAULT_SETTINGS.historyLimit,
    ),
    launchAtLogin: sanitizeBoolean(input['launchAtLogin'], DEFAULT_SETTINGS.launchAtLogin),
  };
}

export function minutesToMs(minutes: number): number {
  return minutes * MS_PER_MINUTE;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePrinterName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PRINTER_NAME_LENGTH ? value : null;
}

function sanitizeTemplateId(value: unknown): string {
  return typeof value === 'string' && TEMPLATE_ID_PATTERN.test(value) ? value : DEFAULT_SETTINGS.activeTemplateId;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（保留换行）
const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** 备注文本：去掉控制字符（保留换行）、首尾空白，限制长度；空文本返回 null。 */
export function sanitizeNoteText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(NOTE_CONTROL_CHARACTERS, '').trim().slice(0, TEMPLATE_LIMITS.noteLength);
  return text === '' ? null : text;
}

function sanitizeNoteOverride(value: unknown): NoteOverride {
  if (!isRecord(value)) {
    return DEFAULT_NOTE_OVERRIDE;
  }
  if (value['kind'] === 'none') {
    return { kind: 'none' };
  }
  if (value['kind'] === 'text') {
    const text = sanitizeNoteText(value['text']);
    return text === null ? DEFAULT_NOTE_OVERRIDE : { kind: 'text', text };
  }
  return DEFAULT_NOTE_OVERRIDE;
}

function sanitizeNotePresets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const presets = value.map(sanitizeNoteText).filter((text): text is string => text !== null);
  return [...new Set(presets)].slice(0, MAX_NOTE_PRESETS);
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
```

- [ ] **Step 6: 实现 `src/main/storage/sqlite-settings-store.ts`**

```ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type AppSettings, sanitizeSettings } from '../../shared/settings';
import { runInTransaction } from './database';
import { readString } from './row-readers';

/** 设置存在 settings 表（key → JSON value）；读取和写入都经过 sanitizeSettings。 */
export class SqliteSettingsStore {
  private readonly selectAll: StatementSync;
  private readonly upsert: StatementSync;
  private settings: AppSettings;

  constructor(private readonly db: DatabaseSync) {
    this.selectAll = db.prepare('SELECT key, value FROM settings');
    this.upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (:key, :value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    this.settings = sanitizeSettings(this.readStored());
  }

  get current(): AppSettings {
    return this.settings;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = sanitizeSettings({ ...this.settings, ...patch });
    runInTransaction(this.db, () => {
      for (const [key, value] of Object.entries(next)) {
        this.upsert.run({ key, value: JSON.stringify(value) });
      }
    });
    this.settings = next;
    return next;
  }

  private readStored(): Record<string, unknown> {
    const stored: Record<string, unknown> = {};
    for (const row of this.selectAll.all()) {
      const key = readString(row, 'key');
      try {
        stored[key] = JSON.parse(readString(row, 'value'));
      } catch (error) {
        console.warn(`[SettingsStore] setting "${key}" is unreadable, using its default`, error);
      }
    }
    return stored;
  }
}
```

- [ ] **Step 7: 实现 `src/main/storage/sqlite-template-repository.ts`**

```ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import { sanitizeTemplate } from '../../core/templates/sanitize-template';
import type { TemplateRepository } from '../../core/templates/template-catalog';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { Clock } from '../../core/types';
import { readString } from './row-readers';

/** 自定义模板：每行一个模板，body 是 JSON；读出时重新校验，防止旧数据或手改数据破坏打印。 */
export class SqliteTemplateRepository implements TemplateRepository {
  private readonly selectAll: StatementSync;
  private readonly upsert: StatementSync;
  private readonly deleteById: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    this.selectAll = db.prepare('SELECT id, body FROM templates ORDER BY created_at, id');
    this.upsert = db.prepare(`
      INSERT INTO templates (id, body, created_at, updated_at) VALUES (:id, :body, :now, :now)
      ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
    this.deleteById = db.prepare('DELETE FROM templates WHERE id = :id');
  }

  listCustom(): LabelTemplate[] {
    const templates: LabelTemplate[] = [];
    for (const row of this.selectAll.all()) {
      const id = readString(row, 'id');
      try {
        templates.push(sanitizeTemplate(JSON.parse(readString(row, 'body')), id, STANDARD_TEMPLATE));
      } catch (error) {
        console.error(`[TemplateRepository] template "${id}" is unreadable and was skipped`, error);
      }
    }
    return templates;
  }

  save(template: LabelTemplate): void {
    this.upsert.run({ id: template.id, body: JSON.stringify(template), now: this.clock.now() });
  }

  remove(id: string): void {
    this.deleteById.run({ id });
  }
}
```

- [ ] **Step 8: 运行测试、类型检查和 lint**

Run: `bun test src/shared/settings.test.ts src/main/storage/sqlite-settings-store.test.ts src/main/storage/sqlite-template-repository.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 14 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 113 pass。

- [ ] **Step 9: Commit**

```bash
git add src/shared/settings.test.ts src/main/storage/sqlite-settings-store.test.ts src/main/storage/sqlite-template-repository.test.ts src/shared/settings.ts src/main/storage/sqlite-settings-store.ts src/main/storage/sqlite-template-repository.ts
git commit -m "feat(settings): validated settings and custom templates persisted in SQLite"
```

---

### Task 9: 标签 HTML 渲染 + 打印机状态检测 + 驱动打印适配器

模板驱动的 60×40 HTML（预览与打印共用；二维码旁字段是「前缀列 + 值列」网格，值永远对齐）；Windows 打印机状态后台轮询；驱动适配器带打印机列表缓存、就绪检查和超时中止。

**Files:**
- Create: `src/shared/printer-readiness.ts`, `src/shared/print-timing.ts`, `src/main/printing/electron-driver-adapter.ts`, `src/main/printing/label-html.ts`, `src/main/printing/printer-status.ts`
- Test: `src/main/printing/label-html.test.ts`, `src/main/printing/printer-status.test.ts`

**Interfaces:**
- Consumes：Task 1、4
- Produces：`renderLabelHtml(job): Promise<string>`、`escapeHtml`；`PrinterReadiness`（`src/shared/printer-readiness.ts`）；`PRINT_TIMEOUT_MS`、`PRINT_TIMEOUT_SECONDS`、`PRINTER_STATUS_POLL_MS`（`src/shared/print-timing.ts`）；`parsePrinterStatus`、`queryPrinterReadiness`、`class PrinterStatusMonitor(probe)`：`start/stop/watch/get/poll`；`class ElectronDriverAdapter(getWebContents, status, clock) implements PrinterAdapter`

- [ ] **Step 1: 创建 `src/shared/printer-readiness.ts`**

```ts
/** 打印机是否可以打印；null 表示未知（尚未查询、查询失败或非 Windows），不阻止打印。 */
export type PrinterReadiness = { ready: true } | { ready: false; detail: string };
```

- [ ] **Step 2: 创建 `src/shared/print-timing.ts`**

```ts
/** 单张打印的超时时间：主进程的打印队列和界面文案共用。 */
export const PRINT_TIMEOUT_MS = 30_000;
export const PRINT_TIMEOUT_SECONDS = PRINT_TIMEOUT_MS / 1_000;

/** 当前打印机状态的轮询间隔：主进程后台检测和界面刷新共用。 */
export const PRINTER_STATUS_POLL_MS = 5_000;
```

- [ ] **Step 3: 写失败的测试 `src/main/printing/label-html.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH } from '../../core/label-parser';
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import type { LabelTemplate } from '../../core/templates/template-model';
import { escapeHtml, renderLabelHtml } from './label-html';

const LABEL = { raw: 'CL5640-TK-图片色-XL', code: 'CL5640-TK', color: '图片色', size: 'XL' };
const PRINTED_AT = new Date(2026, 8, 28, 9, 5).getTime();

function render(template: LabelTemplate = STANDARD_TEMPLATE, label = LABEL) {
  return renderLabelHtml({ label, template, printedAt: PRINTED_AT });
}

function withChanges(changes: (template: LabelTemplate) => void): LabelTemplate {
  const template = structuredClone(STANDARD_TEMPLATE);
  changes(template);
  return template;
}

/** 取出二维码旁网格里每个值单元格的对齐方式。 */
function valueAligns(html: string): string[] {
  return [...html.matchAll(/class="value value-\w+" style="[^"]*text-align:(\w+)"/g)].map((match) => match[1] ?? '');
}

describe('renderLabelHtml', () => {
  test('renders the standard label like the original tag (without the shelf location)', async () => {
    const html = await render();
    expect(html).toContain('>编码：</span><span class="value value-code"');
    expect(html).toContain('>CL5640-TK</span>');
    expect(html).toContain('>图片色</span>');
    expect(html).toContain('>XL</span>');
    expect(html).toContain('>CL5640-TK-图片色-XL</p>');
    expect(html).toContain('<svg');
    expect(html).toContain('size: 60mm 40mm');
    expect(html).toContain('class="layout-qr-left"');
  });

  test('lays side fields out as a prefix/value grid so values always line up', async () => {
    const html = await render(
      withChanges((t) => {
        t.fields.code.prefix = '款号：';
        t.fields.size.prefix = 'Size ';
      }),
    );
    expect(html).toContain('grid-template-columns: max-content minmax(0, 1fr)');
    expect(html).toContain('<span class="prefix prefix-code"');
    expect(html).toContain('<span class="prefix prefix-size"');
    expect(valueAligns(html)).toEqual(['left', 'left', 'left']);
  });

  test('applies one alignment per area: every side value shares it, the bottom row has its own', async () => {
    const html = await render(
      withChanges((t) => {
        t.sideAlign = 'right';
        t.bottomAlign = 'center';
      }),
    );
    expect(valueAligns(html)).toEqual(['right', 'right', 'right']);
    expect(html).toMatch(/class="field field-raw" style="[^"]*text-align:center"/);
  });

  test('keeps side values aligned whether or not a note is shown', async () => {
    const withNote = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '返修' };
      }),
    );
    const withoutNote = await render();
    expect(valueAligns(withNote)).toEqual(valueAligns(withoutNote));
  });

  test('mirrors the layout when the QR code is on the right', async () => {
    const qrRight = BUILT_IN_TEMPLATES.find((t) => t.layout === 'qr-right');
    if (!qrRight) throw new Error('qr-right template missing');
    const html = await render(qrRight);
    expect(html).toContain('size: 60mm 40mm');
    expect(html).toContain('class="layout-qr-right"');
  });

  test('shrinks a 128-character code so it is not clipped', async () => {
    const code = 'C'.repeat(MAX_RAW_LENGTH - '-红-XL'.length);
    const html = await render(STANDARD_TEMPLATE, { raw: `${code}-红-XL`, code, color: '红', size: 'XL' });
    const rawSize = /class="field field-raw" style="font-size:([\d.]+)mm/.exec(html)?.[1];
    expect(Number(rawSize)).toBeLessThan(STANDARD_TEMPLATE.fields.raw.fontSizeMm);
  });

  test('skips an empty note', async () => {
    const html = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '   ' };
      }),
    );
    expect(html).not.toContain('class="note"');
  });

  test('omits the QR code and hidden fields', async () => {
    const html = await render(
      withChanges((t) => {
        t.qr.visible = false;
        t.fields.color.visible = false;
      }),
    );
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('颜色：');
    expect(valueAligns(html)).toHaveLength(2);
  });

  test('applies per-field font size and weight', async () => {
    const html = await render(
      withChanges((t) => {
        t.fields.size = { ...t.fields.size, fontSizeMm: 4.5, bold: false };
      }),
    );
    expect(html).toContain(
      '<span class="value value-size" style="font-size:4.5mm;font-weight:400;text-align:left">XL</span>',
    );
  });

  test('places the note beside the QR code or at the bottom, with variables expanded', async () => {
    const beside = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '备注 {日期}', placement: 'beside-qr' };
      }),
    );
    expect(beside).toMatch(/<div class="side">.*备注 2026-09-28<\/p>\s*<\/div>/s);

    const bottom = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '底部备注', placement: 'bottom' };
      }),
    );
    expect(bottom).toMatch(/<div class="bottom">.*底部备注<\/p><\/div>/s);
  });

  test('escapes markup in label data, prefixes and notes', async () => {
    const html = await render(
      withChanges((t) => {
        t.fields.code.prefix = '<i>';
        t.note = { ...t.note, visible: true, text: '<img src=x>' };
      }),
      { raw: '<b>-"红"-&36', code: '<b>', color: '"红"', size: '&36' },
    );
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('escapeHtml', () => {
  test('escapes all five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
```

- [ ] **Step 4: 写失败的测试 `src/main/printing/printer-status.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { type PrinterReadiness, PrinterStatusMonitor, parsePrinterStatus } from './printer-status';

describe('parsePrinterStatus', () => {
  test('treats Normal and busy states as ready', () => {
    expect(parsePrinterStatus('Normal\r\n')).toEqual({ ready: true });
    expect(parsePrinterStatus('Printing')).toEqual({ ready: true });
  });

  test('reports not-ready states in Chinese, including combined flags', () => {
    expect(parsePrinterStatus('Offline')).toEqual({ ready: false, detail: '打印机离线' });
    expect(parsePrinterStatus('Offline, PaperOut')).toEqual({ ready: false, detail: '打印机离线、缺纸' });
  });
});

describe('PrinterStatusMonitor', () => {
  test('caches the watched printer and forgets it when switching', async () => {
    const answers = new Map<string, PrinterReadiness | null>([
      ['A', { ready: false, detail: '缺纸' }],
      ['B', null],
    ]);
    const monitor = new PrinterStatusMonitor(async (name) => answers.get(name) ?? null);
    await monitor.watch('A');
    expect(monitor.get('A')).toEqual({ ready: false, detail: '缺纸' });
    await monitor.watch('B');
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toBeNull();
  });

  test('drops a stale answer when the watched printer changed during the probe', async () => {
    let release: (value: PrinterReadiness) => void = () => {};
    const monitor = new PrinterStatusMonitor((name) =>
      name === 'A' ? new Promise<PrinterReadiness>((resolve) => (release = resolve)) : Promise.resolve({ ready: true }),
    );
    const pending = monitor.watch('A');
    await monitor.watch('B');
    release({ ready: false, detail: '卡纸' });
    await pending;
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toEqual({ ready: true });
  });
});
```

- [ ] **Step 5: 运行测试，确认失败**

Run: `bun test src/main/printing/label-html.test.ts src/main/printing/printer-status.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 6: 实现 `src/main/printing/label-html.ts`**

```ts
import QRCode from 'qrcode';
import { expandNoteText } from '../../core/templates/note-text';
import {
  type FieldConfig,
  fullTextWidthMm,
  LAYOUT_GAP_MM,
  type LabelTemplate,
  SIDE_FIELD_KEYS,
  sideTextWidthMm,
  type TextAlign,
  type TextStyle,
} from '../../core/templates/template-model';
import { fitFontSizeMm } from '../../core/templates/text-fit';
import type { LabelData, LabelJob } from '../../core/types';
import { LABEL_PAPER_MM } from '../../shared/label-paper';

const LINE_HEIGHT = 1.2;
/** 每种文本允许占用的最多行数；超出时自动缩小字号，保证不被标签边缘裁掉。 */
const MAX_LINES = { sideField: 2, raw: 3, noteBeside: 3, noteBottom: 2 } as const;

/**
 * 由模板生成 60×40mm 标签 HTML：预览和打印共用同一份输出。
 * 二维码旁的字段是「前缀列 + 值列」的网格：无论前缀长短、字号大小，同一列的值始终对齐。
 * 文本全部转义，样式值只来自已校验的模板。
 */
export async function renderLabelHtml(job: LabelJob): Promise<string> {
  const { label, template } = job;
  const { width, height } = LABEL_PAPER_MM;
  const qrSvg = template.qr.visible
    ? await QRCode.toString(label.raw, { type: 'svg', errorCorrectionLevel: template.qr.errorCorrection, margin: 0 })
    : '';
  const isNoteBesideQr = template.note.placement === 'beside-qr';
  const noteText = expandNoteText(template.note.text, label, new Date(job.printedAt));
  const hasNote = template.note.visible && noteText.trim() !== '';
  const note = hasNote
    ? paragraph(
        'note',
        template.note,
        isNoteBesideQr ? template.sideAlign : template.bottomAlign,
        noteText,
        isNoteBesideQr ? sideTextWidthMm(template) : fullTextWidthMm(template),
        isNoteBesideQr ? MAX_LINES.noteBeside : MAX_LINES.noteBottom,
      )
    : '';
  const raw = template.fields.raw;
  const rawField = raw.visible
    ? paragraph(
        'field field-raw',
        raw,
        template.bottomAlign,
        `${raw.prefix}${label.raw}`,
        fullTextWidthMm(template),
        MAX_LINES.raw,
      )
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${mm(width)} ${mm(height)}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${mm(width)}; height: ${mm(height)}; overflow: hidden; background: #fff; color: #000; }
  body {
    display: flex; flex-direction: column; gap: ${mm(LAYOUT_GAP_MM)}; padding: ${mm(template.paddingMm)};
    font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif;
  }
  .main { display: flex; flex: 1 1 auto; gap: ${mm(LAYOUT_GAP_MM)}; min-height: 0; }
  .layout-qr-right .main { flex-direction: row-reverse; }
  .qr { flex: none; width: ${mm(template.qr.sizeMm)}; height: ${mm(template.qr.sizeMm)}; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .side { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
  .fields {
    display: grid; flex: 1 1 auto; grid-template-columns: max-content minmax(0, 1fr);
    align-content: space-evenly; align-items: baseline;
  }
  .prefix { white-space: nowrap; }
  .bottom { display: flex; flex: none; flex-direction: column; }
  p, span { line-height: ${LINE_HEIGHT}; word-break: break-all; }
  .note { white-space: pre-line; }
</style>
</head>
<body class="layout-${template.layout}">
  <div class="main">
    ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
    <div class="side">
      <div class="fields">${sideFieldRows(template, label)}</div>
      ${isNoteBesideQr ? note : ''}
    </div>
  </div>
  <div class="bottom">${rawField}${isNoteBesideQr ? '' : note}</div>
</body>
</html>`;
}

/** 二维码旁的每个字段占网格一行：前缀一格、值一格；字号按整行（前缀 + 值）适配。 */
function sideFieldRows(template: LabelTemplate, label: LabelData): string {
  const widthMm = sideTextWidthMm(template);
  return SIDE_FIELD_KEYS.filter((key) => template.fields[key].visible)
    .map((key) => {
      const field: FieldConfig = template.fields[key];
      const value = label[key];
      const fontSizeMm = fitFontSizeMm(`${field.prefix}${value}`, field.fontSizeMm, widthMm, MAX_LINES.sideField);
      const font = fontCss(field, fontSizeMm);
      return (
        `<span class="prefix prefix-${key}" style="${font}">${escapeHtml(field.prefix)}</span>` +
        `<span class="value value-${key}" style="${font};text-align:${template.sideAlign}">${escapeHtml(value)}</span>`
      );
    })
    .join('');
}

function paragraph(
  className: string,
  style: TextStyle,
  align: TextAlign,
  text: string,
  widthMm: number,
  maxLines: number,
): string {
  const fontSizeMm = fitFontSizeMm(text, style.fontSizeMm, widthMm, maxLines);
  return `<p class="${className}" style="${fontCss(style, fontSizeMm)};text-align:${align}">${escapeHtml(text)}</p>`;
}

function fontCss(style: TextStyle, fontSizeMm: number): string {
  return `font-size:${mm(fontSizeMm)};font-weight:${style.bold ? 700 : 400}`;
}

function mm(value: number): string {
  return `${Number(value.toFixed(2))}mm`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 7: 实现 `src/main/printing/printer-status.ts`**

```ts
import { execFile } from 'node:child_process';

import type { PrinterReadiness } from '../../shared/printer-readiness';

export type { PrinterReadiness };

/** Get-Printer 的 PrinterStatus 中表示「打不了」的状态 → 给操作员看的中文说明。 */
const NOT_READY_STATUS: Readonly<Record<string, string>> = {
  Offline: '打印机离线',
  Error: '打印机报错',
  PaperJam: '卡纸',
  PaperOut: '缺纸',
  PaperProblem: '纸张异常',
  NotAvailable: '打印机不可用',
  DoorOpen: '机盖未关',
  UserIntervention: '需要人工处理',
  Paused: '打印机已暂停',
  NoToner: '碳带或墨粉耗尽',
  OutOfMemory: '打印机内存不足',
};

const PROBE_TIMEOUT_MS = 3_000;
/** 打印机名通过环境变量传入，不拼接进命令行，避免注入。 */
const PRINTER_NAME_ENV = 'CDL_PRINTER_NAME';
const PROBE_SCRIPT = `(Get-Printer -Name $env:${PRINTER_NAME_ENV} -ErrorAction Stop).PrinterStatus.ToString()`;

/** PrinterStatus 可能是单个状态（Normal），也可能是组合（Offline, PaperOut）。 */
export function parsePrinterStatus(output: string): PrinterReadiness {
  const problems = output
    .split(/[\s,]+/)
    .map((flag) => NOT_READY_STATUS[flag])
    .filter((detail): detail is string => detail !== undefined);
  return problems.length === 0 ? { ready: true } : { ready: false, detail: [...new Set(problems)].join('、') };
}

/** 查询打印机状态；非 Windows 或查询失败返回 null（未知，不阻止打印）。 */
export function queryPrinterReadiness(printerName: string): Promise<PrinterReadiness | null> {
  if (process.platform !== 'win32') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, env: { ...process.env, [PRINTER_NAME_ENV]: printerName } },
      (error, stdout) => {
        if (error) {
          console.warn(`[printer-status] probe failed for "${printerName}": ${error.message}`);
          resolve(null);
          return;
        }
        resolve(parsePrinterStatus(stdout));
      },
    );
  });
}

import { PRINTER_STATUS_POLL_MS } from '../../shared/print-timing';

export const STATUS_POLL_INTERVAL_MS = PRINTER_STATUS_POLL_MS;

/** 后台轮询当前打印机状态；打印时直接读缓存，不增加出纸延迟。 */
export class PrinterStatusMonitor {
  private readonly readiness = new Map<string, PrinterReadiness>();
  private watched: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly probe: (printerName: string) => Promise<PrinterReadiness | null>,
    private readonly intervalMs: number = STATUS_POLL_INTERVAL_MS,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  watch(printerName: string | null): Promise<void> {
    this.watched = printerName;
    this.readiness.clear();
    return this.poll();
  }

  /** null = 未知（尚未查询、查询失败或非 Windows）。 */
  get(printerName: string): PrinterReadiness | null {
    return this.readiness.get(printerName) ?? null;
  }

  async poll(): Promise<void> {
    const printerName = this.watched;
    if (!printerName) {
      return;
    }
    const result = await this.probe(printerName);
    if (printerName !== this.watched) {
      return;
    }
    if (result) {
      this.readiness.set(printerName, result);
    } else {
      this.readiness.delete(printerName);
    }
  }
}
```

- [ ] **Step 8: 运行测试、类型检查和 lint**

Run: `bun test src/main/printing/label-html.test.ts src/main/printing/printer-status.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 16 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 129 pass。

- [ ] **Step 9: 创建 `src/main/printing/electron-driver-adapter.ts`**

> 依赖 Electron 运行时，没有单元测试；Task 14 在 Windows 真机验证。

```ts
import { BrowserWindow, type WebContents } from 'electron';
import { PrintError } from '../../core/errors';
import type { Clock, LabelJob, PrinterAdapter, PrinterInfo } from '../../core/types';
import { LABEL_PAPER_MM } from '../../shared/label-paper';
import { renderLabelHtml } from './label-html';
import type { PrinterStatusMonitor } from './printer-status';

const MICRONS_PER_MM = 1_000;
/** 打印时用的打印机列表缓存；界面上的「刷新」总是取最新列表。 */
const PRINTER_LIST_TTL_MS = 5_000;

interface PrinterListCache {
  at: number;
  printers: PrinterInfo[];
}

/** 通过打印机驱动静默打印：隐藏窗口渲染标签 HTML，然后调用 webContents.print。 */
export class ElectronDriverAdapter implements PrinterAdapter {
  private cache: PrinterListCache | null = null;

  constructor(
    private readonly getWebContents: () => WebContents,
    private readonly status: PrinterStatusMonitor,
    private readonly clock: Clock,
  ) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const printers = (await this.getWebContents().getPrintersAsync())
      .map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
    this.cache = { at: this.clock.now(), printers };
    return printers;
  }

  async print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void> {
    if (!(await this.knownPrinters()).some((printer) => printer.name === printerName)) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    const readiness = this.status.get(printerName);
    if (readiness && !readiness.ready) {
      throw new PrintError('PRINTER_NOT_READY', `Printer not ready: ${printerName}`, readiness.detail);
    }
    const html = await renderLabelHtml(job);
    signal.throwIfAborted();
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    const destroy = () => {
      if (!printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    };
    // 超时（PrintQueue 触发 abort）时立刻销毁打印窗口，避免隐藏窗口堆积。
    signal.addEventListener('abort', destroy, { once: true });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await printSilently(printWindow.webContents, printerName);
    } finally {
      signal.removeEventListener('abort', destroy);
      destroy();
    }
  }

  private async knownPrinters(): Promise<PrinterInfo[]> {
    if (this.cache && this.clock.now() - this.cache.at < PRINTER_LIST_TTL_MS) {
      return this.cache.printers;
    }
    return this.listPrinters();
  }
}

function printSilently(webContents: WebContents, deviceName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    webContents.print(
      {
        silent: true,
        deviceName,
        printBackground: true,
        landscape: false,
        margins: { marginType: 'none' },
        pageSize: { width: LABEL_PAPER_MM.width * MICRONS_PER_MM, height: LABEL_PAPER_MM.height * MICRONS_PER_MM },
      },
      (success, failureReason) => {
        if (success) {
          resolve();
        } else {
          reject(new PrintError('PRINT_ERROR', failureReason));
        }
      },
    );
  });
}
```

- [ ] **Step 10: Commit**

```bash
git add src/shared/printer-readiness.ts src/shared/print-timing.ts src/main/printing/electron-driver-adapter.ts src/main/printing/label-html.test.ts src/main/printing/printer-status.test.ts src/main/printing/label-html.ts src/main/printing/printer-status.ts
git commit -m "feat(printing): template-driven label HTML, printer readiness monitor and driver adapter"
```

---

### Task 10: Electron 外壳：IPC、日志、窗口、托盘、图标、入口

无边框窗口、托盘、类型化 IPC（只接受主窗口、参数全部校验）、electron-log 日志、默认菜单移除、权限拒绝、关机不阻塞、图标由 SVG 生成。

**Files:**
- Create: `src/shared/brand.ts`, `src/shared/ipc-contract.ts`, `src/main/logging.ts`, `src/main/window.ts`, `src/main/tray.ts`, `src/main/print-template.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `electron.vite.config.ts`, `resources/icon.svg`, `resources/tray.svg`, `scripts/generate-icons.ts`, `src/renderer/index.html`, `src/renderer/tsconfig.json`, `src/renderer/src/env.d.ts`, `src/renderer/src/main.tsx`, `src/main/ipc-validators.ts`
- Test: `src/main/ipc-validators.test.ts`

**Interfaces:**
- Consumes：Task 1–9 的全部导出
- Produces：`BRAND`（`src/shared/brand.ts`）、`IpcChannel`、`LabelFlashApi`、`WindowControlsApi`、`LabelPreview`、`PrintOptions`、`RendererPrintSource`、`AppInfo`（`src/shared/ipc-contract.ts`）；`ipc-validators`；`registerIpc(deps)`；`setupLogging()`、`forwardRendererConsole(webContents)`；`createMainWindow`；`createTray`；渲染进程全局 `window.api`、`window.windowControls`

- [ ] **Step 1: 创建 `src/shared/brand.ts`**

```ts
/** 品牌与产品标识：CDL = 陈大露。所有对外显示的名字都从这里取。 */
export const BRAND = {
  mark: 'CDL',
  owner: '陈大露',
  productName: 'CDL-云签速印',
  productNameAscii: 'CDL-LabelFlash',
  appId: 'com.cdl.labelflash',
} as const;
```

- [ ] **Step 2: 创建 `src/shared/ipc-contract.ts`**

```ts
import type { LabelTemplate } from '../core/templates/template-model';
import type { PreviewResult, PrinterInfo, PrintResult } from '../core/types';
import type { JobPage, JobQuery } from './job-history';
import type { PrinterReadiness } from './printer-readiness';
import type { AppSettings } from './settings';

export const IpcChannel = {
  Preview: 'label:preview',
  PreviewTemplate: 'label:preview-template',
  Print: 'label:print',
  PrintTest: 'printer:test',
  ListPrinters: 'printer:list',
  PrinterStatus: 'printer:status',
  ListJobs: 'jobs:list',
  GetSettings: 'settings:get',
  UpdateSettings: 'settings:update',
  ListTemplates: 'templates:list',
  DuplicateTemplate: 'templates:duplicate',
  SaveTemplate: 'templates:save',
  DeleteTemplate: 'templates:delete',
  GetAppInfo: 'app:info',
  OpenLogFolder: 'app:open-log-folder',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowMaximizedChanged: 'window:maximized-changed',
} as const;

/** 渲染进程只能发起这两种来源；mobile 属于 Phase 2 的 HTTP 入口。 */
export type RendererPrintSource = 'desktop' | 'history';

export interface PrintOptions {
  source: RendererPrintSource;
  force: boolean;
}

export interface LabelPreview {
  result: PreviewResult;
  /** 与实际打印相同的标签 HTML；格式错误时为 null。 */
  html: string | null;
}

export interface AppInfo {
  productName: string;
  brandOwner: string;
  version: string;
  dataPath: string;
  logPath: string;
}

export interface LabelFlashApi {
  preview(raw: string): Promise<LabelPreview>;
  /** 模板编辑时的实时预览：用未保存的草稿模板渲染。 */
  previewTemplate(raw: string, template: LabelTemplate): Promise<LabelPreview>;
  print(raw: string, printerName: string, options: PrintOptions): Promise<PrintResult>;
  printTest(printerName: string): Promise<PrintResult>;
  listPrinters(): Promise<PrinterInfo[]>;
  printerStatus(printerName: string): Promise<PrinterReadiness | null>;
  listJobs(query: JobQuery): Promise<JobPage>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listTemplates(): Promise<LabelTemplate[]>;
  duplicateTemplate(sourceId: string): Promise<LabelTemplate>;
  saveTemplate(template: LabelTemplate): Promise<LabelTemplate>;
  /** 删除后若它正在使用，自动切回标准模板；返回最新设置。 */
  deleteTemplate(id: string): Promise<AppSettings>;
  getAppInfo(): Promise<AppInfo>;
  openLogFolder(): Promise<void>;
}

export interface WindowControlsApi {
  minimize(): void;
  toggleMaximize(): void;
  /** 隐藏到托盘，不退出。 */
  close(): void;
  onMaximizedChange(listener: (isMaximized: boolean) => void): () => void;
}
```

- [ ] **Step 3: 写失败的测试 `src/main/ipc-validators.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import {
  MAX_IPC_STRING_LENGTH,
  requireJobQuery,
  requirePrintOptions,
  requireString,
  requireTemplateId,
} from './ipc-validators';

describe('ipc validators', () => {
  test('requireString rejects non-strings and oversized input', () => {
    expect(requireString('CL1-红-36', 'raw')).toBe('CL1-红-36');
    expect(() => requireString(42, 'raw')).toThrow('Invalid raw');
    expect(() => requireString('x'.repeat(MAX_IPC_STRING_LENGTH + 1), 'raw')).toThrow(TypeError);
  });

  test('requirePrintOptions only allows renderer sources', () => {
    expect(requirePrintOptions({ source: 'history', force: true })).toEqual({ source: 'history', force: true });
    expect(() => requirePrintOptions({ source: 'mobile', force: false })).toThrow(TypeError);
    expect(() => requirePrintOptions({ source: 'desktop' })).toThrow(TypeError);
    expect(() => requirePrintOptions(null)).toThrow(TypeError);
  });

  test('requireJobQuery bounds the page size and checks optional fields', () => {
    expect(requireJobQuery({ limit: 100, search: 'CL', before: 7 })).toEqual({ limit: 100, search: 'CL', before: 7 });
    expect(requireJobQuery({ limit: 1 })).toEqual({ limit: 1, search: undefined, before: undefined });
    expect(() => requireJobQuery({ limit: 0 })).toThrow(TypeError);
    expect(() => requireJobQuery({ limit: 501 })).toThrow(TypeError);
    expect(() => requireJobQuery({ limit: 10, before: 1.5 })).toThrow(TypeError);
    expect(() => requireJobQuery({ limit: 10, search: 3 })).toThrow(TypeError);
  });

  test('requireTemplateId accepts built-in and custom ids only', () => {
    expect(requireTemplateId('builtin:standard')).toBe('builtin:standard');
    expect(requireTemplateId('custom:3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d')).toBe(
      'custom:3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d',
    );
    expect(() => requireTemplateId('../../etc')).toThrow(TypeError);
    expect(() => requireTemplateId('custom:')).toThrow(TypeError);
  });
});
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 5: 实现 `src/main/ipc-validators.ts`**

```ts
import type { PrintOptions, RendererPrintSource } from '../shared/ipc-contract';
import type { JobQuery } from '../shared/job-history';
import { MAX_JOB_PAGE_SIZE } from '../shared/job-history';
import { isRecord } from '../shared/settings';

/** 渲染进程不可信：IPC 参数在进入业务层之前逐一校验，不合法直接抛错（fail loudly）。 */
export const MAX_IPC_STRING_LENGTH = 1_024;
const TEMPLATE_ID_PATTERN = /^(builtin|custom):[\w-]{1,64}$/;
const RENDERER_PRINT_SOURCES: ReadonlySet<string> = new Set<RendererPrintSource>(['desktop', 'history']);

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_IPC_STRING_LENGTH) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function requireTemplateId(value: unknown): string {
  if (typeof value !== 'string' || !TEMPLATE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid template id');
  }
  return value;
}

export function requirePrintOptions(value: unknown): PrintOptions {
  const options = requireRecord(value, 'print options');
  const source = options['source'];
  const force = options['force'];
  if (typeof source !== 'string' || !RENDERER_PRINT_SOURCES.has(source) || typeof force !== 'boolean') {
    throw new TypeError('Invalid print options');
  }
  return { source: source as RendererPrintSource, force };
}

export function requireJobQuery(value: unknown): JobQuery {
  const query = requireRecord(value, 'job query');
  const limit = query['limit'];
  const search = query['search'];
  const before = query['before'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_PAGE_SIZE) {
    throw new TypeError('Invalid job query limit');
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > MAX_IPC_STRING_LENGTH)) {
    throw new TypeError('Invalid job query search');
  }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    throw new TypeError('Invalid job query cursor');
  }
  return { limit, search, before };
}
```

- [ ] **Step 6: 运行测试、类型检查和 lint**

Run: `bun test src/main/ipc-validators.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 4 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 133 pass。

- [ ] **Step 7: 创建 `src/main/logging.ts`**

```ts
import { join } from 'node:path';
import { app, crashReporter, type WebContents } from 'electron';
import log from 'electron-log/main';

const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 安装版没有控制台：主进程的 console 输出和未捕获异常都写进
 * <userData>/logs/main.log（超过 5MB 自动轮转）。必须在设置 userData 之后、创建窗口之前调用。
 */
export function setupLogging(): string {
  log.initialize();
  // 默认路径因平台而异（Windows 在漫游目录）；固定到数据目录，和「打开日志目录」、启动失败提示一致。
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log');
  log.transports.file.maxSize = LOG_MAX_BYTES;
  log.transports.file.level = 'info';
  log.transports.console.level = app.isPackaged ? false : 'debug';
  Object.assign(console, log.functions);
  log.errorHandler.startCatching({ showDialog: false });
  crashReporter.start({ uploadToServer: false });
  return log.transports.file.getFile().path;
}

/** 渲染进程的警告和错误也写进同一个日志文件（使用 Electron 44 的 console-message 事件对象）。 */
export function forwardRendererConsole(webContents: WebContents): void {
  webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      log.error(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    } else if (event.level === 'warning') {
      log.warn(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });
}
```

- [ ] **Step 8: 创建 `src/main/window.ts`**

```ts
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { BRAND } from '../shared/brand';
import { IpcChannel } from '../shared/ipc-contract';
import { forwardRendererConsole } from './logging';

const WINDOW_BOUNDS = { width: 1280, height: 800, minWidth: 1024, minHeight: 680 } as const;
const HOUSING_COLOR = '#E4E7E2';

export interface MainWindowOptions {
  icon: string;
  shouldHideOnClose: () => boolean;
  onHidden: () => void;
}

/** 无系统边框窗口，标题栏由渲染进程自绘。 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_BOUNDS,
    frame: false,
    show: false,
    title: BRAND.productName,
    icon: options.icon,
    backgroundColor: HOUSING_COLOR,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (options.shouldHideOnClose()) {
      event.preventDefault();
      window.hide();
      options.onHidden();
    }
  });
  const sendMaximized = () => window.webContents.send(IpcChannel.WindowMaximizedChanged, window.isMaximized());
  window.on('maximize', sendMaximized);
  window.on('unmaximize', sendMaximized);

  const { webContents } = window;
  forwardRendererConsole(webContents);
  // 预览按实物比例显示，禁止缩放；导航和新窗口一律拒绝。
  void webContents.setVisualZoomLevelLimits(1, 1);
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event) => event.preventDefault());
  webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] renderer process gone, reloading', details);
    if (!window.isDestroyed()) {
      webContents.reload();
    }
  });
  window.on('unresponsive', () => console.error('[window] renderer is unresponsive'));
  window.on('responsive', () => console.info('[window] renderer is responsive again'));

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}
```

- [ ] **Step 9: 创建 `src/main/tray.ts`**

```ts
import { Menu, nativeImage, Tray } from 'electron';
import { BRAND } from '../shared/brand';

export interface TrayActions {
  show: () => void;
  quit: () => void;
}

export interface AppTray {
  /** 第一次隐藏到托盘时提示：窗口隐藏期间扫码枪的输入会进入别的程序。 */
  notifyHiddenOnce: () => void;
  destroy: () => void;
}

/** 托盘图标用 resources/tray.png，Electron 会按屏幕缩放自动选 @1.25x/@1.5x/@2x 版本。 */
export function createTray(iconPath: string, actions: TrayActions): AppTray {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip(BRAND.productName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: actions.show },
      { type: 'separator' },
      { label: `退出 ${BRAND.productName}`, click: actions.quit },
    ]),
  );
  tray.on('click', actions.show);

  let hasNotified = false;
  return {
    notifyHiddenOnce: () => {
      if (hasNotified || process.platform !== 'win32') {
        return;
      }
      hasNotified = true;
      tray.displayBalloon({
        title: `${BRAND.productName} 仍在运行`,
        content: '窗口已隐藏到托盘。扫码前请先打开窗口，否则扫码内容会输入到其他程序。',
        iconType: 'info',
      });
    },
    destroy: () => tray.destroy(),
  };
}
```

- [ ] **Step 10: 创建 `src/main/print-template.ts`**

> 打印和预览统一用「当前模板 + 备注下拉框选择」。

```ts
import { applyNoteOverride } from '../core/templates/note-override';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import type { LabelTemplate } from '../core/templates/template-model';
import type { AppSettings } from '../shared/settings';

/** 实际用于打印和预览的模板：当前模板 + 主界面「备注」下拉框的选择。 */
export function resolvePrintTemplate(templates: TemplateCatalog, settings: AppSettings): LabelTemplate {
  return applyNoteOverride(templates.resolve(settings.activeTemplateId), settings.noteOverride);
}
```

- [ ] **Step 11: 创建 `src/main/ipc.ts`**

```ts
import { dirname } from 'node:path';
import { type BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import type { PrintService } from '../core/print-service';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { sanitizeTemplate } from '../core/templates/sanitize-template';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import { CUSTOM_TEMPLATE_PREFIX, type LabelTemplate } from '../core/templates/template-model';
import type { PreviewResult } from '../core/types';
import { type AppInfo, IpcChannel, type LabelPreview } from '../shared/ipc-contract';
import type { AppSettings } from '../shared/settings';
import {
  requireJobQuery,
  requirePrintOptions,
  requireRecord,
  requireString,
  requireTemplateId,
} from './ipc-validators';
import { resolvePrintTemplate } from './print-template';
import type { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { renderLabelHtml } from './printing/label-html';
import type { PrinterStatusMonitor } from './printing/printer-status';
import type { SqliteJobStore } from './storage/sqlite-job-store';
import type { SqliteSettingsStore } from './storage/sqlite-settings-store';

const DRAFT_TEMPLATE_ID = `${CUSTOM_TEMPLATE_PREFIX}draft`;

export interface IpcDeps {
  service: PrintService;
  adapter: ElectronDriverAdapter;
  jobs: SqliteJobStore;
  settings: SqliteSettingsStore;
  templates: TemplateCatalog;
  status: PrinterStatusMonitor;
  appInfo: AppInfo;
  getWindow: () => BrowserWindow | null;
  onSettingsChanged: (next: AppSettings, previous: AppSettings) => Promise<void>;
}

/** 渲染进程不可信：只接受主窗口发来的消息，所有参数先校验再进入业务层。 */
export function registerIpc(deps: IpcDeps): void {
  const isTrusted = (sender: WebContents) => sender === deps.getWindow()?.webContents;
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrusted(event.sender)) {
        throw new Error(`Rejected IPC from untrusted sender on ${channel}`);
      }
      return listener(...args);
    });
  };
  const on = (channel: string, listener: () => void) => {
    ipcMain.on(channel, (event) => {
      if (isTrusted(event.sender)) {
        listener();
      }
    });
  };
  const activeTemplate = () => resolvePrintTemplate(deps.templates, deps.settings.current);
  const updateSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const previous = deps.settings.current;
    const next = deps.settings.update(patch);
    await deps.onSettingsChanged(next, previous);
    return next;
  };

  handle(IpcChannel.Preview, (raw) => renderPreview(deps.service.preview(requireString(raw, 'raw')), activeTemplate()));
  handle(IpcChannel.PreviewTemplate, (raw, template) => {
    const draft = sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, activeTemplate());
    return renderPreview(deps.service.preview(requireString(raw, 'raw')), draft);
  });
  handle(IpcChannel.Print, (raw, printerName, options) =>
    deps.service.submit({
      raw: requireString(raw, 'raw'),
      printerName: requireString(printerName, 'printerName'),
      ...requirePrintOptions(options),
    }),
  );
  handle(IpcChannel.PrintTest, (printerName) => deps.service.printTest(requireString(printerName, 'printerName')));
  handle(IpcChannel.ListPrinters, () => deps.adapter.listPrinters());
  handle(IpcChannel.PrinterStatus, (printerName) => deps.status.get(requireString(printerName, 'printerName')));
  handle(IpcChannel.ListJobs, (query) => deps.jobs.listPage(requireJobQuery(query)));
  handle(IpcChannel.GetSettings, () => deps.settings.current);
  handle(IpcChannel.UpdateSettings, (patch) => updateSettings(requireRecord(patch, 'settings patch')));
  handle(IpcChannel.ListTemplates, () => deps.templates.list());
  handle(IpcChannel.DuplicateTemplate, (sourceId) => deps.templates.duplicate(requireTemplateId(sourceId)));
  handle(IpcChannel.SaveTemplate, (template) => {
    const record = requireRecord(template, 'template');
    return deps.templates.save(requireTemplateId(record['id']), record);
  });
  handle(IpcChannel.DeleteTemplate, (id) => {
    const templateId = requireTemplateId(id);
    deps.templates.remove(templateId);
    return deps.settings.current.activeTemplateId === templateId
      ? updateSettings({ activeTemplateId: DEFAULT_TEMPLATE_ID })
      : deps.settings.current;
  });
  handle(IpcChannel.GetAppInfo, () => deps.appInfo);
  handle(IpcChannel.OpenLogFolder, async () => {
    const error = await shell.openPath(dirname(deps.appInfo.logPath));
    if (error) {
      throw new Error(error);
    }
  });

  on(IpcChannel.WindowMinimize, () => deps.getWindow()?.minimize());
  on(IpcChannel.WindowToggleMaximize, () => {
    const window = deps.getWindow();
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });
  on(IpcChannel.WindowClose, () => deps.getWindow()?.close());
}

async function renderPreview(result: PreviewResult, template: LabelTemplate): Promise<LabelPreview> {
  if (result.status !== 'ok') {
    return { result, html: null };
  }
  return { result, html: await renderLabelHtml({ label: result.label, template, printedAt: Date.now() }) };
}
```

- [ ] **Step 12: 创建 `src/main/index.ts`**

> IPC 在窗口创建前注册；`userData` 与默认菜单都在 ready 之前设置。

```ts
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog, Menu, session } from 'electron';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';
import { DedupGuard } from '../core/dedup-guard';
import { PrintQueue } from '../core/print-queue';
import { PrintService } from '../core/print-service';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { systemClock } from '../core/types';
import { BRAND } from '../shared/brand';
import { PRINT_TIMEOUT_MS } from '../shared/print-timing';
import { minutesToMs } from '../shared/settings';
import { registerIpc } from './ipc';
import { setupLogging } from './logging';
import { resolvePrintTemplate } from './print-template';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { PrinterStatusMonitor, queryPrinterReadiness } from './printing/printer-status';
import { openDatabase } from './storage/database';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { SqliteTemplateRepository } from './storage/sqlite-template-repository';
import { type AppTray, createTray } from './tray';
import { createMainWindow } from './window';

const DATABASE_FILE_NAME = 'labelflash.db';

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let database: DatabaseSync | null = null;
let isQuitting = false;

// 数据、日志、Chromium 缓存都放 %LOCALAPPDATA%\CDL-LabelFlash（本机目录，不进漫游配置）。
app.setPath('userData', join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), BRAND.productNameAscii));

if (app.isPackaged) {
  // 在 ready 之前去掉默认菜单：它的快捷键（刷新、开发者工具、缩放）在安装版里会破坏扫码状态和预览比例。
  Menu.setApplicationMenu(null);
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function quit(): void {
  isQuitting = true;
  app.quit();
}

function closeDatabase(): void {
  if (database?.isOpen) {
    database.close();
  }
}

function applyLaunchAtLogin(enabled: boolean): void {
  // 开发模式下注册的会是 electron.exe，所以只在安装版生效。卸载程序按同一个 name 删除启动项。
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled, name: BRAND.appId });
  }
}

function requireWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available');
  }
  return mainWindow.webContents;
}

async function bootstrap(): Promise<void> {
  const logPath = setupLogging();
  console.info(`[app] ${BRAND.productName} ${app.getVersion()} starting`);
  app.setAppUserModelId(BRAND.appId);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const dataPath = app.getPath('userData');
  database = openDatabase(join(dataPath, DATABASE_FILE_NAME));
  const settings = new SqliteSettingsStore(database);
  const jobs = new SqliteJobStore(database, settings.current.historyLimit);
  await jobs.initialize();
  const templates = new TemplateCatalog(new SqliteTemplateRepository(database, systemClock), randomUUID);
  const guard = new DedupGuard(systemClock, minutesToMs(settings.current.dedupWindowMinutes));
  const status = new PrinterStatusMonitor(queryPrinterReadiness);
  status.start();
  void status.watch(settings.current.selectedPrinter);
  const adapter = new ElectronDriverAdapter(requireWebContents, status, systemClock);
  const service = new PrintService({
    adapter,
    store: jobs,
    guard,
    clock: systemClock,
    queue: new PrintQueue(PRINT_TIMEOUT_MS),
    createId: randomUUID,
    resolveTemplate: () => resolvePrintTemplate(templates, settings.current),
  });
  service.restore();

  registerIpc({
    service,
    adapter,
    jobs,
    settings,
    templates,
    status,
    appInfo: {
      productName: BRAND.productName,
      brandOwner: BRAND.owner,
      version: app.getVersion(),
      dataPath,
      logPath,
    },
    getWindow: () => mainWindow,
    onSettingsChanged: async (next, previous) => {
      guard.setWindowMs(minutesToMs(next.dedupWindowMinutes));
      if (next.selectedPrinter !== previous.selectedPrinter) {
        void status.watch(next.selectedPrinter);
      }
      if (next.launchAtLogin !== previous.launchAtLogin) {
        applyLaunchAtLogin(next.launchAtLogin);
      }
      if (next.historyLimit !== previous.historyLimit) {
        await jobs.setCapacity(next.historyLimit);
      }
    },
  });
  applyLaunchAtLogin(settings.current.launchAtLogin);

  mainWindow = createMainWindow({
    icon: appIcon,
    shouldHideOnClose: () => !isQuitting,
    onHidden: () => tray?.notifyHiddenOnce(),
  });
  // Windows 关机、注销时不会触发 before-quit：放行窗口关闭并关闭数据库，不能阻塞关机。
  mainWindow.on('query-session-end', () => {
    isQuitting = true;
  });
  mainWindow.on('session-end', () => {
    isQuitting = true;
    closeDatabase();
  });
  tray = createTray(trayIcon, { show: showMainWindow, quit });
  app.on('will-quit', () => {
    status.stop();
    tray?.destroy();
    closeDatabase();
  });
}

function describeStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/newer than this app supports/.test(message)) {
    return '数据文件来自更新版本的程序，请安装最新版本后再打开。';
  }
  return `程序启动失败：${message}`;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('[app] startup failed', error);
      dialog.showErrorBox(
        `${BRAND.productName} 无法启动`,
        `${describeStartupError(error)}\n\n详细日志：${join(app.getPath('userData'), 'logs')}`,
      );
      app.quit();
    });
}
```

- [ ] **Step 13: 创建 `src/preload/index.ts`**

```ts
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { IpcChannel, type LabelFlashApi, type WindowControlsApi } from '../shared/ipc-contract';

const api: LabelFlashApi = {
  preview: (raw) => ipcRenderer.invoke(IpcChannel.Preview, raw),
  previewTemplate: (raw, template) => ipcRenderer.invoke(IpcChannel.PreviewTemplate, raw, template),
  print: (raw, printerName, options) => ipcRenderer.invoke(IpcChannel.Print, raw, printerName, options),
  printTest: (printerName) => ipcRenderer.invoke(IpcChannel.PrintTest, printerName),
  listPrinters: () => ipcRenderer.invoke(IpcChannel.ListPrinters),
  printerStatus: (printerName) => ipcRenderer.invoke(IpcChannel.PrinterStatus, printerName),
  listJobs: (query) => ipcRenderer.invoke(IpcChannel.ListJobs, query),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
  listTemplates: () => ipcRenderer.invoke(IpcChannel.ListTemplates),
  duplicateTemplate: (sourceId) => ipcRenderer.invoke(IpcChannel.DuplicateTemplate, sourceId),
  saveTemplate: (template) => ipcRenderer.invoke(IpcChannel.SaveTemplate, template),
  deleteTemplate: (id) => ipcRenderer.invoke(IpcChannel.DeleteTemplate, id),
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.GetAppInfo),
  openLogFolder: () => ipcRenderer.invoke(IpcChannel.OpenLogFolder),
};

const windowControls: WindowControlsApi = {
  minimize: () => ipcRenderer.send(IpcChannel.WindowMinimize),
  toggleMaximize: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
  close: () => ipcRenderer.send(IpcChannel.WindowClose),
  onMaximizedChange: (listener) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean) => listener(isMaximized);
    ipcRenderer.on(IpcChannel.WindowMaximizedChanged, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannel.WindowMaximizedChanged, handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('windowControls', windowControls);
```

- [ ] **Step 14: 创建 `electron.vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// electron-vite 5 默认把 dependencies 外部化（qrcode 走 node_modules）。
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
```

- [ ] **Step 15: 创建 `resources/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- CDL-云签速印：墨黑机壳 + 软尺 + 标签纸上的 CDL 字标 -->
  <rect width="512" height="512" rx="104" fill="#18211E"/>
  <rect x="56" y="58" width="400" height="74" rx="16" fill="#F2C12E"/>
  <g stroke="#18211E" stroke-width="8" stroke-linecap="square">
    <path d="M96 60v42M136 60v24M176 60v24M216 60v42M256 60v24M296 60v24M336 60v42M376 60v24M416 60v24"/>
  </g>
  <rect x="78" y="164" width="356" height="276" rx="22" fill="#FBFBF8"/>
  <g fill="none" stroke="#18211E" stroke-width="30" stroke-linecap="square" stroke-linejoin="miter">
    <path d="M190 226 A 50 58 0 1 0 190 330"/>
    <path d="M230 214 V 342 H 254 A 54 64 0 0 0 254 214 Z"/>
    <path d="M346 214 V 342 H 404"/>
  </g>
  <rect x="116" y="382" width="280" height="22" rx="6" fill="#F2C12E"/>
</svg>
```

- [ ] **Step 16: 创建 `resources/tray.svg`**

> 托盘小图标不放文字（16px 下字母会糊成噪点）。

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- 托盘小图标：软尺 + 带二维码定位块的标签（小尺寸不放文字） -->
  <rect width="32" height="32" rx="7" fill="#18211E"/>
  <rect x="4" y="4" width="24" height="7" rx="2" fill="#F2C12E"/>
  <path d="M9 4v4M16 4v4M23 4v4" stroke="#18211E" stroke-width="2"/>
  <rect x="6" y="14" width="20" height="14" rx="2" fill="#FBFBF8"/>
  <rect x="9" y="17" width="8" height="8" fill="#18211E"/>
  <rect x="11" y="19" width="4" height="4" fill="#FBFBF8"/>
  <rect x="19" y="18" width="5" height="2.4" fill="#18211E"/>
  <rect x="19" y="22" width="4" height="2.4" fill="#18211E"/>
</svg>
```

- [ ] **Step 17: 创建 `scripts/generate-icons.ts`**

```ts
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

/** 由 resources/*.svg 生成应用图标和多倍率托盘图标。修改 SVG 后运行 `bun run icons`。 */
const RESOURCES_DIR = 'resources';
const APP_ICON_SIZE_PX = 512;
const TRAY_ICON_BASE_PX = 16;
const TRAY_SCALES = [
  { suffix: '', scale: 1 },
  { suffix: '@1.25x', scale: 1.25 },
  { suffix: '@1.5x', scale: 1.5 },
  { suffix: '@2x', scale: 2 },
] as const;
const RENDER_DENSITY = 384;

async function render(svgName: string, sizePx: number, outputName: string): Promise<void> {
  const svg = await readFile(`${RESOURCES_DIR}/${svgName}`);
  await sharp(svg, { density: RENDER_DENSITY }).resize(sizePx, sizePx).png().toFile(`${RESOURCES_DIR}/${outputName}`);
  console.log(`wrote ${RESOURCES_DIR}/${outputName} (${sizePx}px)`);
}

await render('icon.svg', APP_ICON_SIZE_PX, 'icon.png');
for (const { suffix, scale } of TRAY_SCALES) {
  await render('tray.svg', Math.round(TRAY_ICON_BASE_PX * scale), `tray${suffix}.png`);
}
```

- [ ] **Step 18: 执行**

Run: `bun run icons`
Expected: 输出 `wrote resources/icon.png (512px)` 以及 4 个 `tray*.png`（16/20/24/32px）。

- [ ] **Step 19: 创建 `src/renderer/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>CDL-云签速印</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 20: 创建 `src/renderer/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun", "vite/client"]
  },
  "include": ["src/**/*", "../shared/**/*", "../core/**/*"]
}
```

- [ ] **Step 21: 创建 `src/renderer/src/env.d.ts`**

```ts
import type { LabelFlashApi, WindowControlsApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    api: LabelFlashApi;
    windowControls: WindowControlsApi;
  }
}
```

- [ ] **Step 22: 创建 `src/renderer/src/main.tsx`**

> 占位界面，Task 13 替换。

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing');
}

// 占位界面：Task 13 替换为完整的 App。
createRoot(container).render(
  <StrictMode>
    <p style={{ padding: 24 }}>CDL-云签速印：外壳已就绪</p>
  </StrictMode>,
);
```

- [ ] **Step 23: 执行**

Run: `bun run lint && bun run typecheck && bun test && bun run build`
Expected: Biome 无问题；两个 tsconfig 零错误；测试全部通过；构建输出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`。

- [ ] **Step 24: 执行**

Run: `bun run dev`
Expected: 出现无边框窗口，显示「CDL-云签速印：外壳已就绪」；托盘出现图标；`<数据目录>/labelflash.db`、`logs/main.log` 被创建（macOS 开发机在 `~/Library/Application Support/CDL-LabelFlash/`）。从托盘「退出」关闭。

- [ ] **Step 25: Commit**

```bash
git add src/shared/brand.ts src/shared/ipc-contract.ts src/main/logging.ts src/main/window.ts src/main/tray.ts src/main/print-template.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts electron.vite.config.ts resources/icon.svg resources/tray.svg scripts/generate-icons.ts src/renderer/index.html src/renderer/tsconfig.json src/renderer/src/env.d.ts src/renderer/src/main.tsx src/main/ipc-validators.test.ts src/main/ipc-validators.ts
git commit -m "feat(shell): frameless window, tray, validated IPC, logging and generated icons"
```

---

### Task 11: 渲染层基础：设计 token、字体、纯逻辑库

所有界面逻辑先做成可测试的纯函数：状态文案、打印机胶囊、通知中心、过滤、去抖。

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `src/shared/sample-label.ts`, `src/renderer/src/lib/feedback-sound.ts`, `src/renderer/src/lib/repeat-filter.ts`, `src/renderer/src/lib/list-filters.ts`, `src/renderer/src/lib/status-text.ts`, `src/renderer/src/lib/notices.ts`, `src/renderer/src/lib/printer-chip.ts`, `src/renderer/src/lib/note-options.ts`
- Test: `src/renderer/src/lib/repeat-filter.test.ts`, `src/renderer/src/lib/list-filters.test.ts`, `src/renderer/src/lib/status-text.test.ts`, `src/renderer/src/lib/notices.test.ts`, `src/renderer/src/lib/printer-chip.test.ts`, `src/renderer/src/lib/note-options.test.ts`

**Interfaces:**
- Consumes：Task 1、7、9、10 的类型
- Produces：`RepeatFilter`；`filterPrinters`；`describeResult`/`describeScan`/`describeJobStatus`/`describeSource`/`formatAgo`/`formatWindow`/`formatDateTime`/`IPC_ERROR_VIEW` 及 `ScanSnapshot`/`ScanView` 等类型；`NoticeCenter`/`notices`/`reportError`；`describePrinterChip`；`buildNoteOptions`/`resolveNoteSelection`/`summarizeNote`/`NOTE_OPTION_VALUES`（备注下拉框）；`playFeedback(tone)`；`SAMPLE_LABEL_RAW`

- [ ] **Step 1: 执行**

```bash
mkdir -p src/renderer/src/assets/fonts
TMP_DIR=$(mktemp -d)
curl -fsSL -o "$TMP_DIR/smiley.zip" https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip
unzip -p "$TMP_DIR/smiley.zip" SmileySans-Oblique.otf.woff2 > src/renderer/src/assets/fonts/SmileySans-Oblique.woff2
curl -fsSL -o src/renderer/src/assets/fonts/SmileySans-OFL.txt https://raw.githubusercontent.com/atelier-anchor/smiley-sans/main/LICENSE
rm -rf "$TMP_DIR"
ls -l src/renderer/src/assets/fonts
```
Expected: `SmileySans-Oblique.woff2` 为 1361268 字节；`SmileySans-OFL.txt` 含 `SIL OPEN FONT LICENSE`。

- [ ] **Step 2: 创建 `src/renderer/src/styles/tokens.css`**

```css
@font-face {
  font-family: "Smiley Sans";
  src: url("../assets/fonts/SmileySans-Oblique.woff2") format("woff2");
  font-display: swap;
}

:root {
  /* 取材：标签机机壳、热敏纸、墨、软尺 */
  --color-housing: #e4e7e2;
  --color-paper: #fbfbf8;
  --color-ink: #18211e;
  --color-ink-soft: #55605b;
  --color-rule: #c5cbc4;
  --color-tape: #f2c12e;
  --color-tape-wash: #fdf5d8;
  --color-success: #1f8a5b;
  --color-warning: #e0752d;
  --color-warning-wash: #fbe6d7;
  --color-error: #c8372d;
  --color-error-wash: #f8dedb;

  --font-display: "Smiley Sans", "Microsoft YaHei UI", sans-serif;
  --font-body: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  --font-data: "Cascadia Mono", Consolas, "SF Mono", monospace;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --radius: 6px;

  --title-bar-height: 40px;
  --side-width: 380px;
  --feed-duration: 180ms;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --feed-duration: 0ms;
  }
}
```

- [ ] **Step 3: 创建 `src/shared/sample-label.ts`**

```ts
/** 没有扫码时用来预览模板效果的示例标签。 */
export const SAMPLE_LABEL_RAW = 'CL5640-TK-图片色-XL';
```

- [ ] **Step 4: 写失败的测试 `src/renderer/src/lib/repeat-filter.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { RepeatFilter } from './repeat-filter';

describe('RepeatFilter', () => {
  test('drops the same value inside the interval and accepts it afterwards', () => {
    let now = 0;
    const filter = new RepeatFilter(1_000, () => now);
    expect(filter.shouldAccept('A')).toBe(true);
    now = 999;
    expect(filter.shouldAccept('A')).toBe(false);
    now = 1_000;
    expect(filter.shouldAccept('A')).toBe(true);
  });

  test('always accepts a different value', () => {
    const filter = new RepeatFilter(1_000, () => 0);
    expect(filter.shouldAccept('A')).toBe(true);
    expect(filter.shouldAccept('B')).toBe(true);
    expect(filter.shouldAccept('A')).toBe(true);
  });
});
```

- [ ] **Step 5: 写失败的测试 `src/renderer/src/lib/list-filters.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { filterPrinters } from './list-filters';

const PRINTERS = [
  { name: '面单打印机', displayName: '面单打印机' },
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF' },
  { name: '热敏标签机', displayName: '热敏标签机' },
];

describe('filterPrinters', () => {
  test('returns everything for a blank query', () => {
    expect(filterPrinters(PRINTERS, '  ')).toEqual(PRINTERS);
  });

  test('matches case-insensitively', () => {
    expect(filterPrinters(PRINTERS, 'pdf').map((p) => p.name)).toEqual(['Microsoft Print to PDF']);
    expect(filterPrinters(PRINTERS, '面单').map((p) => p.name)).toEqual(['面单打印机']);
  });
});
```

- [ ] **Step 6: 写失败的测试 `src/renderer/src/lib/status-text.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import type { LabelPreview } from '../../../shared/ipc-contract';
import {
  describeJobStatus,
  describeResult,
  describeScan,
  formatAgo,
  formatWindow,
  IPC_ERROR_VIEW,
  type ScanContext,
  type ScanSnapshot,
} from './status-text';

const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);
const MINUTE = 60_000;
const LABEL = { raw: 'CL5640-TK-图片色-XL', code: 'CL5640-TK', color: '图片色', size: 'XL' };
const OK_PREVIEW: LabelPreview = { result: { status: 'ok', label: LABEL, recent: null }, html: '<html></html>' };

const snapshot = (overrides: Partial<ScanSnapshot> = {}): ScanSnapshot => ({
  raw: LABEL.raw,
  preview: OK_PREVIEW,
  print: null,
  isPrinting: false,
  hasIpcError: false,
  ...overrides,
});
const context = (overrides: Partial<ScanContext> = {}): ScanContext => ({
  autoPrint: false,
  hasPrinter: true,
  now: NOW,
  ...overrides,
});

describe('formatAgo / formatWindow', () => {
  test('formats relative time', () => {
    expect(formatAgo(NOW - 30_000, NOW)).toBe('刚刚');
    expect(formatAgo(NOW - 3.5 * MINUTE, NOW)).toBe('3 分钟前');
    expect(formatAgo(NOW - 125 * MINUTE, NOW)).toBe('2 小时前');
  });

  test('formats the dedup window', () => {
    expect(formatWindow(10 * MINUTE)).toBe('10 分钟');
    expect(formatWindow(120 * MINUTE)).toBe('2 小时');
  });
});

describe('describeResult', () => {
  test('printed means sent to the printer', () => {
    expect(describeResult({ status: 'printed', jobId: 'j', label: LABEL }, NOW)).toEqual({
      tone: 'success',
      title: '已发送打印',
      detail: 'CL5640-TK · 图片色 · XL',
    });
  });

  test('duplicate explains when and why', () => {
    const printed = describeResult(
      { status: 'duplicate', recent: { state: 'printed', at: NOW - 3 * MINUTE }, windowMs: 10 * MINUTE },
      NOW,
    );
    expect(printed.detail).toBe('3 分钟前已打印过，10 分钟内同一标签只打一次');
    const printing = describeResult(
      { status: 'duplicate', recent: { state: 'printing', at: NOW }, windowMs: 10 * MINUTE },
      NOW,
    );
    expect(printing.detail).toStartWith('同一标签正在打印');
  });

  test('not-ready failures show the printer-reported reason', () => {
    const view = describeResult({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '缺纸' }, NOW);
    expect(view).toMatchObject({ tone: 'error', title: '打印机未就绪' });
    expect(view.detail).toStartWith('缺纸');
  });

  test('timeouts say the label may already be printed', () => {
    expect(describeResult({ status: 'failed', reason: 'PRINT_TIMEOUT' }, NOW).detail).toContain('可能已出纸');
  });
});

describe('describeScan', () => {
  test('waiting state mentions F2 in manual mode', () => {
    const view = describeScan(null, context());
    expect(view.status.tone).toBe('idle');
    expect(view.status.detail).toContain('F2');
  });

  test('IPC failures are shown as internal errors, not as format errors', () => {
    expect(describeScan(snapshot({ hasIpcError: true }), context()).status).toEqual(IPC_ERROR_VIEW);
  });

  test('invalid preview is an error with no actions', () => {
    const view = describeScan(
      snapshot({ preview: { result: { status: 'invalid', reason: 'INVALID_FORMAT' }, html: null } }),
      context(),
    );
    expect(view.status.title).toBe('二维码格式不对');
    expect(view.actions).toEqual({ print: null, forceReprint: false });
  });

  test('printing is pending', () => {
    expect(describeScan(snapshot({ isPrinting: true }), context()).status.tone).toBe('pending');
  });

  test('manual mode offers print for a fresh label', () => {
    const view = describeScan(snapshot(), context());
    expect(view.status.title).toBe('待打印');
    expect(view.actions).toEqual({ print: 'print', forceReprint: false });
  });

  test('manual mode still lets F2 submit a recently printed label (the threshold decides) and offers force', () => {
    const preview: LabelPreview = {
      result: { status: 'ok', label: LABEL, recent: { state: 'printed', at: NOW - 2 * MINUTE } },
      html: '',
    };
    const view = describeScan(snapshot({ preview }), context());
    expect(view.status).toMatchObject({ tone: 'warning', title: '2 分钟前已打印过' });
    expect(view.actions).toEqual({ print: 'print', forceReprint: true });
  });

  test('no printer selected blocks printing in both modes', () => {
    for (const autoPrint of [true, false]) {
      const view = describeScan(snapshot(), context({ hasPrinter: false, autoPrint }));
      expect(view.status.title).toBe('还没选打印机');
      expect(view.actions.print).toBeNull();
    }
  });

  test('retryable failures offer retry; timeouts only offer force reprint', () => {
    const notReady = describeScan(snapshot({ print: { status: 'failed', reason: 'PRINTER_NOT_READY' } }), context());
    expect(notReady.actions).toEqual({ print: 'retry', forceReprint: false });
    const timeout = describeScan(snapshot({ print: { status: 'failed', reason: 'PRINT_TIMEOUT' } }), context());
    expect(timeout.actions).toEqual({ print: null, forceReprint: true });
  });

  test('a duplicate of a finished print offers force reprint, one still printing does not', () => {
    const printed = snapshot({
      print: { status: 'duplicate', recent: { state: 'printed', at: NOW }, windowMs: 10 * MINUTE },
    });
    expect(describeScan(printed, context()).actions).toEqual({ print: null, forceReprint: true });
    const printing = snapshot({
      print: { status: 'duplicate', recent: { state: 'printing', at: NOW }, windowMs: 10 * MINUTE },
    });
    expect(describeScan(printing, context()).actions.forceReprint).toBe(false);
  });
});

describe('describeJobStatus', () => {
  const base = { id: 'j', createdAt: NOW, raw: LABEL.raw, printerName: 'P', source: 'desktop' as const, forced: false };

  test('marks forced reprints', () => {
    expect(describeJobStatus({ ...base, status: 'printed', forced: true })).toEqual({
      tone: 'success',
      text: '已补打',
    });
  });

  test('includes the failure reason', () => {
    expect(describeJobStatus({ ...base, status: 'failed', failureReason: 'PRINTER_NOT_READY' })).toEqual({
      tone: 'error',
      text: '失败：未就绪',
    });
  });
});
```

- [ ] **Step 7: 写失败的测试 `src/renderer/src/lib/notices.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { NoticeCenter } from './notices';

describe('NoticeCenter', () => {
  test('notifies subscribers and keeps only the newest three notices', () => {
    const center = new NoticeCenter();
    const seen: string[][] = [];
    center.subscribe((notices) => seen.push(notices.map((n) => n.message)));
    for (const message of ['a', 'b', 'c', 'd']) center.push('error', message);
    expect(center.snapshot().map((n) => n.message)).toEqual(['b', 'c', 'd']);
    expect(seen).toHaveLength(4);
  });

  test('does not stack the same message twice in a row', () => {
    const center = new NoticeCenter();
    center.push('error', 'x');
    center.push('error', 'x');
    expect(center.snapshot()).toHaveLength(1);
  });

  test('dismisses by id and stops notifying after unsubscribe', () => {
    const center = new NoticeCenter();
    let calls = 0;
    const unsubscribe = center.subscribe(() => {
      calls += 1;
    });
    center.push('info', 'hello');
    const [first] = center.snapshot();
    unsubscribe();
    center.dismiss(first?.id ?? -1);
    expect(center.snapshot()).toEqual([]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 8: 写失败的测试 `src/renderer/src/lib/printer-chip.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { describePrinterChip } from './printer-chip';

const base = { printerName: '热敏标签机', isLoading: false, isListed: true, readiness: null };

describe('describePrinterChip', () => {
  test('no printer selected', () => {
    expect(describePrinterChip({ ...base, printerName: null })).toEqual({ tone: 'muted', text: '未选择打印机' });
  });

  test('does not flag a saved printer as missing while the list is loading', () => {
    expect(describePrinterChip({ ...base, isListed: false, isLoading: true }).tone).toBe('muted');
    expect(describePrinterChip({ ...base, isListed: false }).tone).toBe('error');
  });

  test('shows readiness from the status monitor', () => {
    expect(describePrinterChip(base)).toEqual({ tone: 'unknown', text: '热敏标签机' });
    expect(describePrinterChip({ ...base, readiness: { ready: true } }).tone).toBe('ready');
    expect(describePrinterChip({ ...base, readiness: { ready: false, detail: '缺纸' } })).toEqual({
      tone: 'error',
      text: '热敏标签机（缺纸）',
    });
  });
});
```

- [ ] **Step 9: 写失败的测试 `src/renderer/src/lib/note-options.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { buildNoteOptions, NOTE_OPTION_VALUES, resolveNoteSelection, summarizeNote } from './note-options';

const PRESETS = ['样衣间 {日期}', '返修'];

describe('note options', () => {
  test('lists template, none, presets and the manage entry', () => {
    const { options, selected } = buildNoteOptions(PRESETS, { kind: 'template' });
    expect(options.map((o) => o.label)).toEqual(['模板备注', '不打印备注', '样衣间 {日期}', '返修', '管理常用备注…']);
    expect(selected).toBe(NOTE_OPTION_VALUES.template);
  });

  test('selects the matching preset', () => {
    const { selected } = buildNoteOptions(PRESETS, { kind: 'text', text: '返修' });
    expect(resolveNoteSelection(selected, PRESETS)).toEqual({ kind: 'text', text: '返修' });
  });

  test('keeps showing a note that was removed from the presets', () => {
    const { options, selected } = buildNoteOptions(PRESETS, { kind: 'text', text: '临时备注' });
    expect(selected).toBe(NOTE_OPTION_VALUES.current);
    expect(options.find((o) => o.value === selected)?.label).toBe('临时备注（已不在常用备注）');
  });

  test('resolves special entries and rejects unknown values', () => {
    expect(resolveNoteSelection(NOTE_OPTION_VALUES.none, PRESETS)).toEqual({ kind: 'none' });
    expect(resolveNoteSelection(NOTE_OPTION_VALUES.manage, PRESETS)).toBe('manage');
    expect(resolveNoteSelection('preset:9', PRESETS)).toBeNull();
    expect(resolveNoteSelection('???', PRESETS)).toBeNull();
  });

  test('summarizes long and multi-line notes', () => {
    expect(summarizeNote('第一行\n第二行')).toBe('第一行…');
    expect(summarizeNote('一二三四五六七八九十一二三四五六七八')).toBe('一二三四五六七八九十一二三四五六…');
    expect(summarizeNote('返修')).toBe('返修');
  });
});
```

- [ ] **Step 10: 运行测试，确认失败**

Run: `bun test src/renderer/src/lib/repeat-filter.test.ts src/renderer/src/lib/list-filters.test.ts src/renderer/src/lib/status-text.test.ts src/renderer/src/lib/notices.test.ts src/renderer/src/lib/printer-chip.test.ts src/renderer/src/lib/note-options.test.ts`
Expected: FAIL，报错 `Cannot find module`（被测模块还不存在）

- [ ] **Step 11: 实现 `src/renderer/src/lib/repeat-filter.ts`**

```ts
/** 扫码枪可能连击：同一个值在 intervalMs 内只接受一次。 */
export class RepeatFilter {
  private lastValue: string | null = null;
  private lastAcceptedAt = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  shouldAccept(value: string): boolean {
    const now = this.now();
    if (value === this.lastValue && now - this.lastAcceptedAt < this.intervalMs) {
      return false;
    }
    this.lastValue = value;
    this.lastAcceptedAt = now;
    return true;
  }
}
```

- [ ] **Step 12: 实现 `src/renderer/src/lib/list-filters.ts`**

```ts
import type { PrinterInfo } from '../../../core/types';

export function filterPrinters(printers: PrinterInfo[], query: string): PrinterInfo[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return printers;
  }
  return printers.filter(
    (printer) => printer.displayName.toLowerCase().includes(needle) || printer.name.toLowerCase().includes(needle),
  );
}
```

- [ ] **Step 13: 实现 `src/renderer/src/lib/status-text.ts`**

```ts
import type { JobRecord, PrintFailureReason, PrintResult, PrintSource, RecentPrint } from '../../../core/types';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { PRINT_TIMEOUT_SECONDS } from '../../../shared/print-timing';

export type FeedbackTone = 'success' | 'warning' | 'error';
export type StatusTone = FeedbackTone | 'idle' | 'pending';

export interface StatusView {
  tone: StatusTone;
  title: string;
  detail: string;
}

export interface FeedbackStatusView extends StatusView {
  tone: FeedbackTone;
}

export interface ScanActions {
  print: 'print' | 'retry' | null;
  forceReprint: boolean;
}

export interface ScanSnapshot {
  raw: string;
  preview: LabelPreview;
  print: PrintResult | null;
  isPrinting: boolean;
  /** 调用主进程失败（程序内部错误），与打印机故障区分开。 */
  hasIpcError: boolean;
}

export interface ScanContext {
  autoPrint: boolean;
  hasPrinter: boolean;
  now: number;
}

export interface ScanView {
  status: StatusView;
  actions: ScanActions;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const NO_ACTIONS: ScanActions = { print: null, forceReprint: false };

const FORMAT_HINT = '应为「编码-颜色-尺码」，例如 CL5640-TK-图片色-XL。出现乱码时，检查扫码枪是否开启中文输出';

const FAILURE_TITLES: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_NOT_READY: '打印机未就绪',
  PRINT_TIMEOUT: '打印机没有响应',
  PRINT_ERROR: '打印失败',
};

const FAILURE_SHORT: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_NOT_READY: '未就绪',
  PRINT_TIMEOUT: '超时',
  PRINT_ERROR: '驱动报错',
};

/** 这些失败确定没有出纸，可以直接重试；超时结果不确定，只能强制补打。 */
const RETRYABLE_FAILURES: ReadonlySet<PrintFailureReason> = new Set([
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_ERROR',
]);

const SOURCE_LABELS: Record<PrintSource, string> = {
  desktop: '扫码枪',
  history: '记录重打',
  mobile: '手机',
};

export function formatAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / MS_PER_MINUTE);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} 分钟前`;
  }
  return `${Math.floor(minutes / MINUTES_PER_HOUR)} 小时前`;
}

export function formatWindow(windowMs: number): string {
  const minutes = Math.round(windowMs / MS_PER_MINUTE);
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
    return `${minutes / MINUTES_PER_HOUR} 小时`;
  }
  return `${minutes} 分钟`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function failureDetail(reason: PrintFailureReason, detail: string | undefined): string {
  switch (reason) {
    case 'PRINTER_NOT_FOUND':
      return '系统里找不到这台打印机，刷新打印机列表后重新选择';
    case 'PRINTER_NOT_READY':
      return `${detail ?? '打印机当前无法打印'}，处理好后点「重试打印」`;
    case 'PRINT_TIMEOUT':
      return `${PRINT_TIMEOUT_SECONDS} 秒内没有响应，可能已出纸或仍在排队；确认没有出纸再用「强制补打」`;
    case 'PRINT_ERROR':
      return '打印机驱动报错，检查打印机状态后重试';
  }
}

function describeRecent(recent: RecentPrint, now: number): string {
  return recent.state === 'printing' ? '同一标签正在打印' : `${formatAgo(recent.at, now)}已打印过`;
}

export function describeResult(result: PrintResult, now: number): FeedbackStatusView {
  switch (result.status) {
    case 'printed':
      return {
        tone: 'success',
        title: '已发送打印',
        detail: `${result.label.code} · ${result.label.color} · ${result.label.size}`,
      };
    case 'duplicate':
      return {
        tone: 'warning',
        title: '重复扫码，已拦截',
        detail: `${describeRecent(result.recent, now)}，${formatWindow(result.windowMs)}内同一标签只打一次`,
      };
    case 'invalid':
      return { tone: 'error', title: '二维码格式不对', detail: FORMAT_HINT };
    case 'failed':
      return {
        tone: 'error',
        title: FAILURE_TITLES[result.reason],
        detail: failureDetail(result.reason, result.detail),
      };
  }
}

export const IPC_ERROR_VIEW: FeedbackStatusView = {
  tone: 'error',
  title: '程序内部错误',
  detail: '已写入日志；请重试，仍然不行请重启程序',
};

export function describeScan(scan: ScanSnapshot | null, context: ScanContext): ScanView {
  if (!scan) {
    return {
      status: {
        tone: 'idle',
        title: '等待扫码',
        detail: context.autoPrint ? '扫码后自动预览并打印' : '扫码后先预览，核对无误按 F2 打印',
      },
      actions: NO_ACTIONS,
    };
  }
  if (scan.hasIpcError) {
    return { status: IPC_ERROR_VIEW, actions: NO_ACTIONS };
  }
  const previewResult = scan.preview.result;
  if (previewResult.status === 'invalid') {
    return { status: describeResult(previewResult, context.now), actions: NO_ACTIONS };
  }
  if (scan.isPrinting) {
    return { status: { tone: 'pending', title: '正在打印…', detail: scan.raw }, actions: NO_ACTIONS };
  }
  if (scan.print) {
    const { print } = scan;
    const canRetry = print.status === 'failed' && RETRYABLE_FAILURES.has(print.reason);
    const canForce =
      (print.status === 'duplicate' && print.recent.state === 'printed') ||
      (print.status === 'failed' && print.reason === 'PRINT_TIMEOUT');
    return {
      status: describeResult(print, context.now),
      actions: {
        print: canRetry && context.hasPrinter ? 'retry' : null,
        forceReprint: canForce && context.hasPrinter,
      },
    };
  }
  if (!context.hasPrinter) {
    return {
      status: { tone: 'warning', title: '还没选打印机', detail: '在右侧「打印机」列表里点选一台，选好后按 F2 打印' },
      actions: NO_ACTIONS,
    };
  }
  const { recent } = previewResult;
  if (recent) {
    return {
      status: {
        tone: 'warning',
        title: describeRecent(recent, context.now),
        detail: '再打印会被门限拦截；确实需要再打一张，请用「强制补打」',
      },
      actions: { print: 'print', forceReprint: recent.state === 'printed' },
    };
  }
  return {
    status: { tone: 'idle', title: '待打印', detail: '核对预览无误后，按 F2 或点「打印」' },
    actions: { print: 'print', forceReprint: false },
  };
}

export function describeJobStatus(job: JobRecord): { tone: FeedbackTone; text: string } {
  switch (job.status) {
    case 'printed':
      return { tone: 'success', text: job.forced ? '已补打' : '已发送' };
    case 'duplicate':
      return { tone: 'warning', text: '已拦截' };
    case 'invalid':
      return { tone: 'error', text: '格式不对' };
    case 'failed':
      return { tone: 'error', text: job.failureReason ? `失败：${FAILURE_SHORT[job.failureReason]}` : '失败' };
  }
}

export function describeSource(source: PrintSource): string {
  return SOURCE_LABELS[source];
}
```

- [ ] **Step 14: 实现 `src/renderer/src/lib/notices.ts`**

```ts
export type NoticeTone = 'error' | 'warning' | 'info';

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
}

type Listener = (notices: readonly Notice[]) => void;

/** 同时最多显示的通知条数，超出时丢弃最早的一条。 */
const MAX_VISIBLE_NOTICES = 3;

/** 界面级通知：IPC 失败、后台操作结果等。与扫码状态条分开，不会覆盖当前扫码结果。 */
export class NoticeCenter {
  private notices: readonly Notice[] = [];
  private nextId = 1;
  private readonly listeners = new Set<Listener>();

  push(tone: NoticeTone, message: string): void {
    // 连续出现同一条消息时不重复堆叠。
    if (this.notices.at(-1)?.message === message) {
      return;
    }
    this.notices = [...this.notices, { id: this.nextId++, tone, message }].slice(-MAX_VISIBLE_NOTICES);
    this.emit();
  }

  dismiss(id: number): void {
    this.notices = this.notices.filter((notice) => notice.id !== id);
    this.emit();
  }

  snapshot(): readonly Notice[] {
    return this.notices;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.notices);
    }
  }
}

export const notices = new NoticeCenter();

/** 调用主进程失败时使用：写日志（主进程会收集渲染进程的 console）并提示操作员。 */
export function reportError(action: string, error: unknown): void {
  console.error(`[renderer] ${action} failed`, error);
  notices.push('error', `${action}失败：程序内部错误，已写入日志`);
}
```

- [ ] **Step 15: 实现 `src/renderer/src/lib/printer-chip.ts`**

```ts
import type { PrinterReadiness } from '../../../shared/printer-readiness';

export type PrinterChipTone = 'ready' | 'unknown' | 'error' | 'muted';

export interface PrinterChipView {
  tone: PrinterChipTone;
  text: string;
}

export interface PrinterChipInput {
  printerName: string | null;
  isLoading: boolean;
  isListed: boolean;
  readiness: PrinterReadiness | null;
}

/** 标题栏里当前打印机的状态胶囊。 */
export function describePrinterChip({
  printerName,
  isLoading,
  isListed,
  readiness,
}: PrinterChipInput): PrinterChipView {
  if (printerName === null) {
    return { tone: 'muted', text: '未选择打印机' };
  }
  if (!isListed) {
    return isLoading
      ? { tone: 'muted', text: `${printerName}（读取中…）` }
      : { tone: 'error', text: `${printerName}（系统里找不到）` };
  }
  if (readiness === null) {
    return { tone: 'unknown', text: printerName };
  }
  return readiness.ready
    ? { tone: 'ready', text: `${printerName} · 就绪` }
    : { tone: 'error', text: `${printerName}（${readiness.detail}）` };
}
```

- [ ] **Step 16: 实现 `src/renderer/src/lib/note-options.ts`**

```ts
import type { NoteOverride } from '../../../core/templates/note-override';

export interface NoteOption {
  value: string;
  label: string;
}

export const NOTE_OPTION_VALUES = {
  template: 'template',
  none: 'none',
  /** 当前使用的备注已从常用备注里删除，但仍保留生效。 */
  current: 'current',
  manage: 'manage',
} as const;

const PRESET_PREFIX = 'preset:';
const MAX_LABEL_LENGTH = 16;

/** 下拉框里的显示文字：只取第一行，过长截断。 */
export function summarizeNote(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const hasMore = text.includes('\n') || [...firstLine].length > MAX_LABEL_LENGTH;
  return hasMore ? `${[...firstLine].slice(0, MAX_LABEL_LENGTH).join('')}…` : firstLine;
}

export function buildNoteOptions(
  presets: readonly string[],
  override: NoteOverride,
): { options: NoteOption[]; selected: string } {
  const options: NoteOption[] = [
    { value: NOTE_OPTION_VALUES.template, label: '模板备注' },
    { value: NOTE_OPTION_VALUES.none, label: '不打印备注' },
    ...presets.map((text, index) => ({ value: `${PRESET_PREFIX}${index}`, label: summarizeNote(text) })),
  ];
  let selected: string = override.kind === 'none' ? NOTE_OPTION_VALUES.none : NOTE_OPTION_VALUES.template;
  if (override.kind === 'text') {
    const index = presets.indexOf(override.text);
    if (index >= 0) {
      selected = `${PRESET_PREFIX}${index}`;
    } else {
      options.push({ value: NOTE_OPTION_VALUES.current, label: `${summarizeNote(override.text)}（已不在常用备注）` });
      selected = NOTE_OPTION_VALUES.current;
    }
  }
  options.push({ value: NOTE_OPTION_VALUES.manage, label: '管理常用备注…' });
  return { options, selected };
}

/** 把下拉框的值还原成设置；`manage` 表示打开设置页；无法识别返回 null。 */
export function resolveNoteSelection(value: string, presets: readonly string[]): NoteOverride | 'manage' | null {
  if (value === NOTE_OPTION_VALUES.manage) {
    return 'manage';
  }
  if (value === NOTE_OPTION_VALUES.template) {
    return { kind: 'template' };
  }
  if (value === NOTE_OPTION_VALUES.none) {
    return { kind: 'none' };
  }
  if (value.startsWith(PRESET_PREFIX)) {
    const text = presets[Number(value.slice(PRESET_PREFIX.length))];
    return text === undefined ? null : { kind: 'text', text };
  }
  return null;
}
```

- [ ] **Step 17: 运行测试、类型检查和 lint**

Run: `bun test src/renderer/src/lib/repeat-filter.test.ts src/renderer/src/lib/list-filters.test.ts src/renderer/src/lib/status-text.test.ts src/renderer/src/lib/notices.test.ts src/renderer/src/lib/printer-chip.test.ts src/renderer/src/lib/note-options.test.ts && bunx tsc --noEmit -p tsconfig.json && bun run lint`
Expected: 本任务 32 pass、0 fail；tsc 无输出；Biome 无问题。此时 `bun test` 共 165 pass。

- [ ] **Step 18: 创建 `src/renderer/src/lib/feedback-sound.ts`**

> 依赖 WebAudio，没有单元测试；Task 13 听声验证。

```ts
import type { FeedbackTone } from './status-text';

interface Beep {
  frequencyHz: number;
  durationMs: number;
}

/** 三种声音一听就能区分：成功短高音，重复两声中音，失败长低音。 */
const PATTERNS: Record<FeedbackTone, Beep[]> = {
  success: [{ frequencyHz: 1320, durationMs: 110 }],
  warning: [
    { frequencyHz: 880, durationMs: 110 },
    { frequencyHz: 880, durationMs: 110 },
  ],
  error: [{ frequencyHz: 220, durationMs: 450 }],
};
const GAP_MS = 80;
const VOLUME = 0.15;
const MS_PER_SECOND = 1_000;

let context: AudioContext | null = null;

export function playFeedback(tone: FeedbackTone): void {
  context ??= new AudioContext();
  let startAt = context.currentTime;
  for (const beep of PATTERNS[tone]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = beep.frequencyHz;
    gain.gain.value = VOLUME;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + beep.durationMs / MS_PER_SECOND);
    startAt += (beep.durationMs + GAP_MS) / MS_PER_SECOND;
  }
}
```

- [ ] **Step 19: Commit**

```bash
git add src/renderer/src/styles/tokens.css src/shared/sample-label.ts src/renderer/src/lib/feedback-sound.ts src/renderer/src/lib/repeat-filter.test.ts src/renderer/src/lib/list-filters.test.ts src/renderer/src/lib/status-text.test.ts src/renderer/src/lib/notices.test.ts src/renderer/src/lib/printer-chip.test.ts src/renderer/src/lib/note-options.test.ts src/renderer/src/lib/repeat-filter.ts src/renderer/src/lib/list-filters.ts src/renderer/src/lib/status-text.ts src/renderer/src/lib/notices.ts src/renderer/src/lib/printer-chip.ts src/renderer/src/lib/note-options.ts
git commit -m "feat(ui): design tokens, font and tested presentation logic"
```

---

### Task 12: View-models（MVVM 的 VM 层）

hook 只薄薄包一层 IPC，逻辑都在 Task 11 的纯函数里；每个 IPC 失败都经 `reportError` 写日志并提示操作员。

**Files:**
- Create: `src/renderer/src/view-models/use-notices.ts`, `src/renderer/src/view-models/use-settings.ts`, `src/renderer/src/view-models/use-printers.ts`, `src/renderer/src/view-models/use-printer-status.ts`, `src/renderer/src/view-models/use-job-log.ts`, `src/renderer/src/view-models/use-scan-station.ts`, `src/renderer/src/view-models/use-templates.ts`, `src/renderer/src/view-models/use-preview-html.ts`, `src/renderer/src/view-models/use-fit-scale.ts`, `src/renderer/src/view-models/use-window-controls.ts`, `src/renderer/src/view-models/use-hotkey.ts`, `src/renderer/src/view-models/use-app-info.ts`

**Interfaces:**
- Consumes：`window.api`、`window.windowControls`（Task 10）；Task 11 的纯函数
- Produces：`useNotices`、`useSettings`（`update` 返回校验后的设置）、`usePrinters`（窗口获焦时刷新）、`usePrinterStatus`、`useJobLog`（去抖搜索、防并发加载更多）、`useScanStation`（`ScanState`，含 `hasIpcError`、`refreshPreview`）、`useTemplates`（草稿编辑）、`usePreviewHtml(raw, template)`、`useFitScale`、`useWindowControls`、`useHotkey`、`useAppInfo`

- [ ] **Step 1: 创建 `src/renderer/src/view-models/use-notices.ts`**

```ts
import { useSyncExternalStore } from 'react';
import { notices } from '../lib/notices';

export function useNotices() {
  const current = useSyncExternalStore(
    (listener) => notices.subscribe(listener),
    () => notices.snapshot(),
  );
  return { notices: current, dismiss: (id: number) => notices.dismiss(id) };
}
```

- [ ] **Step 2: 创建 `src/renderer/src/view-models/use-settings.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../../../shared/settings';
import { reportError } from '../lib/notices';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);

  const load = useCallback(async () => {
    setHasLoadError(false);
    try {
      setSettings(await window.api.getSettings());
    } catch (error) {
      reportError('读取设置', error);
      setHasLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 返回主进程校验后的设置（数值可能被纠正）；失败返回 null。 */
  const update = useCallback(async (patch: Partial<AppSettings>): Promise<AppSettings | null> => {
    try {
      const next = await window.api.updateSettings(patch);
      setSettings(next);
      return next;
    } catch (error) {
      reportError('保存设置', error);
      return null;
    }
  }, []);

  return { settings, hasLoadError, reload: load, update, replace: setSettings };
}
```

- [ ] **Step 3: 创建 `src/renderer/src/view-models/use-printers.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';
import { reportError } from '../lib/notices';

export function usePrinters() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPrinters(await window.api.listPrinters());
    } catch (error) {
      reportError('读取打印机列表', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const printTest = useCallback(async (printerName: string): Promise<PrintResult | null> => {
    try {
      return await window.api.printTest(printerName);
    } catch (error) {
      reportError('打印测试页', error);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 窗口重新获得焦点时刷新：新接上的打印机不用手动点刷新。
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return { printers, isLoading, refresh, printTest };
}
```

- [ ] **Step 4: 创建 `src/renderer/src/view-models/use-printer-status.ts`**

```ts
import { useEffect, useState } from 'react';
import { PRINTER_STATUS_POLL_MS } from '../../../shared/print-timing';
import type { PrinterReadiness } from '../../../shared/printer-readiness';

/** 当前打印机的就绪状态（主进程后台检测的缓存结果）；null = 未知。 */
export function usePrinterStatus(printerName: string | null): PrinterReadiness | null {
  const [readiness, setReadiness] = useState<PrinterReadiness | null>(null);

  useEffect(() => {
    setReadiness(null);
    if (!printerName) {
      return;
    }
    let isActive = true;
    const poll = async () => {
      try {
        const next = await window.api.printerStatus(printerName);
        if (isActive) {
          setReadiness(next);
        }
      } catch (error) {
        console.error('[renderer] printer status failed', error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), PRINTER_STATUS_POLL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [printerName]);

  return readiness;
}
```

- [ ] **Step 5: 创建 `src/renderer/src/view-models/use-job-log.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { JOB_PAGE_SIZE, type JobPage } from '../../../shared/job-history';
import { reportError } from '../lib/notices';

const SEARCH_DEBOUNCE_MS = 200;
const EMPTY_PAGE: JobPage = { jobs: [], nextCursor: null, total: 0 };

/** 打印记录只按页加载（容量可达百万级），搜索交给数据库的全文索引。 */
export function useJobLog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<JobPage>(EMPTY_PAGE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const searchRef = useRef(search);
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async (query: string) => {
    requestId.current += 1;
    const id = requestId.current;
    try {
      const first = await window.api.listJobs({ limit: JOB_PAGE_SIZE, search: query });
      if (id === requestId.current) {
        setPage(first);
      }
    } catch (error) {
      reportError('读取打印记录', error);
    }
  }, []);

  useEffect(() => {
    searchRef.current = search;
    const timer = window.setTimeout(() => void loadFirstPage(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, loadFirstPage]);

  const refresh = useCallback(() => loadFirstPage(searchRef.current), [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (page.nextCursor === null || isLoadingMore) {
      return;
    }
    const id = requestId.current;
    setIsLoadingMore(true);
    try {
      const next = await window.api.listJobs({
        limit: JOB_PAGE_SIZE,
        search: searchRef.current,
        before: page.nextCursor,
      });
      if (id === requestId.current) {
        setPage((current) => ({
          jobs: [...current.jobs, ...next.jobs],
          nextCursor: next.nextCursor,
          total: next.total,
        }));
      }
    } catch (error) {
      reportError('读取更早的打印记录', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [page.nextCursor, isLoadingMore]);

  return {
    jobs: page.jobs,
    total: page.total,
    hasMore: page.nextCursor !== null,
    isLoadingMore,
    search,
    setSearch,
    refresh,
    loadMore,
  };
}
```

- [ ] **Step 6: 创建 `src/renderer/src/view-models/use-scan-station.ts`**

```ts
import { useCallback, useRef, useState } from 'react';
import type { PrintResult } from '../../../core/types';
import type { LabelPreview, RendererPrintSource } from '../../../shared/ipc-contract';
import { playFeedback } from '../lib/feedback-sound';
import { reportError } from '../lib/notices';
import { RepeatFilter } from '../lib/repeat-filter';
import { describeResult, type ScanSnapshot } from '../lib/status-text';

const SCAN_REPEAT_INTERVAL_MS = 1_000;
const NO_PREVIEW: LabelPreview = { result: { status: 'invalid', reason: 'INVALID_FORMAT' }, html: null };

export interface ScanState extends ScanSnapshot {
  /** 递增序号：旧扫描的异步结果不能覆盖新扫描的界面。 */
  seq: number;
  source: RendererPrintSource;
}

interface StationOptions {
  printerName: string | null;
  autoPrint: boolean;
  onJobRecorded: () => void;
}

interface LoadMode {
  source: RendererPrintSource;
  printNow: boolean;
}

export function useScanStation({ printerName, autoPrint, onJobRecorded }: StationOptions) {
  const repeatFilter = useRef(new RepeatFilter(SCAN_REPEAT_INTERVAL_MS));
  const latestSeq = useRef(0);
  const [scan, setScan] = useState<ScanState | null>(null);

  const patchIfCurrent = useCallback((seq: number, patch: Partial<ScanState>) => {
    setScan((current) => (current && current.seq === seq ? { ...current, ...patch } : current));
  }, []);

  const print = useCallback(
    async (seq: number, raw: string, source: RendererPrintSource, force: boolean) => {
      if (!printerName) {
        playFeedback('warning');
        return;
      }
      patchIfCurrent(seq, { isPrinting: true, print: null, hasIpcError: false });
      let result: PrintResult;
      try {
        result = await window.api.print(raw, printerName, { source, force });
      } catch (error) {
        reportError('打印', error);
        patchIfCurrent(seq, { isPrinting: false, hasIpcError: true });
        playFeedback('error');
        return;
      }
      patchIfCurrent(seq, { isPrinting: false, print: result });
      // 即使界面已切到更新的扫描，也要让操作员听到这一张的结果。
      playFeedback(describeResult(result, Date.now()).tone);
      onJobRecorded();
    },
    [printerName, patchIfCurrent, onJobRecorded],
  );

  const load = useCallback(
    async (raw: string, mode: LoadMode) => {
      latestSeq.current += 1;
      const seq = latestSeq.current;
      let preview = NO_PREVIEW;
      let hasIpcError = false;
      try {
        preview = await window.api.preview(raw);
      } catch (error) {
        reportError('生成预览', error);
        hasIpcError = true;
      }
      const isValid = !hasIpcError && preview.result.status === 'ok';
      const willPrint = mode.printNow && isValid && printerName !== null;
      if (seq === latestSeq.current) {
        setScan({ seq, raw, preview, source: mode.source, print: null, isPrinting: willPrint, hasIpcError });
      }
      if (!isValid) {
        playFeedback('error');
        return;
      }
      if (mode.printNow) {
        // 自动模式下每一次扫码都要打印，哪怕界面已被更新的扫描取代；没选打印机时 print 会发出警告音。
        await print(seq, raw, mode.source, false);
      }
    },
    [printerName, print],
  );

  const scanCode = useCallback(
    (input: string) => {
      const raw = input.trim();
      if (raw === '' || !repeatFilter.current.shouldAccept(raw)) {
        return;
      }
      void load(raw, { source: 'desktop', printNow: autoPrint });
    },
    [autoPrint, load],
  );

  const review = useCallback((raw: string) => void load(raw, { source: 'history', printNow: false }), [load]);
  const reprint = useCallback((raw: string) => void load(raw, { source: 'history', printNow: true }), [load]);

  const printCurrent = useCallback(
    (force: boolean) => {
      if (scan) {
        void print(scan.seq, scan.raw, scan.source, force);
      }
    },
    [scan, print],
  );

  /** 切换或保存模板后，按新模板重新生成当前标签的预览。 */
  const refreshPreview = useCallback(async () => {
    if (!scan) {
      return;
    }
    try {
      patchIfCurrent(scan.seq, { preview: await window.api.preview(scan.raw) });
    } catch (error) {
      reportError('刷新预览', error);
    }
  }, [scan, patchIfCurrent]);

  return { scan, scanCode, review, reprint, printCurrent, refreshPreview };
}
```

- [ ] **Step 7: 创建 `src/renderer/src/view-models/use-templates.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import type { AppSettings } from '../../../shared/settings';
import { notices, reportError } from '../lib/notices';

interface TemplatesOptions {
  activeTemplateId: string | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  replaceSettings: (settings: AppSettings) => void;
  onActiveTemplateChanged: () => void;
}

/** 模板列表、启用、复制、编辑（草稿）、保存、删除。草稿只用于预览，保存后才用于打印。 */
export function useTemplates({
  activeTemplateId,
  updateSettings,
  replaceSettings,
  onActiveTemplateChanged,
}: TemplatesOptions) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [draft, setDraft] = useState<LabelTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await window.api.listTemplates());
    } catch (error) {
      reportError('读取模板', error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) ?? templates[0] ?? null,
    [templates, activeTemplateId],
  );
  const stored = useMemo(() => templates.find((template) => template.id === draft?.id) ?? null, [templates, draft]);
  const isDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);

  const activate = useCallback(
    async (id: string) => {
      if (await updateSettings({ activeTemplateId: id })) {
        onActiveTemplateChanged();
      }
    },
    [updateSettings, onActiveTemplateChanged],
  );

  const duplicate = useCallback(
    async (sourceId: string) => {
      try {
        const copy = await window.api.duplicateTemplate(sourceId);
        await load();
        setDraft(structuredClone(copy));
      } catch (error) {
        reportError('复制模板', error);
      }
    },
    [load],
  );

  const startEdit = useCallback(
    (id: string) => {
      const template = templates.find((candidate) => candidate.id === id);
      if (template && !isBuiltInTemplateId(id)) {
        setDraft(structuredClone(template));
      }
    },
    [templates],
  );

  const saveDraft = useCallback(async () => {
    if (!draft) {
      return;
    }
    try {
      const saved = await window.api.saveTemplate(draft);
      await load();
      setDraft(null);
      notices.push('info', `模板「${saved.name}」已保存`);
      if (saved.id === activeTemplateId) {
        onActiveTemplateChanged();
      }
    } catch (error) {
      reportError('保存模板', error);
    }
  }, [draft, load, activeTemplateId, onActiveTemplateChanged]);

  const remove = useCallback(
    async (id: string) => {
      try {
        replaceSettings(await window.api.deleteTemplate(id));
        await load();
        setDraft((current) => (current?.id === id ? null : current));
        if (id === activeTemplateId) {
          onActiveTemplateChanged();
        }
      } catch (error) {
        reportError('删除模板', error);
      }
    },
    [load, replaceSettings, activeTemplateId, onActiveTemplateChanged],
  );

  return {
    templates,
    active,
    draft,
    isDirty,
    activate,
    duplicate,
    startEdit,
    changeDraft: setDraft,
    saveDraft,
    cancelEdit: () => setDraft(null),
    remove,
  };
}
```

- [ ] **Step 8: 创建 `src/renderer/src/view-models/use-preview-html.ts`**

```ts
import { useEffect, useState } from 'react';
import type { LabelTemplate } from '../../../core/templates/template-model';
import { reportError } from '../lib/notices';

const PREVIEW_DEBOUNCE_MS = 150;

/**
 * 用指定模板渲染 raw，返回标签 HTML：用于没有扫码时的示例标签，以及编辑模板时的草稿效果。
 * template 需要是稳定引用（useMemo），变化时才重新生成。
 */
export function usePreviewHtml(raw: string, template: LabelTemplate | null): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!template) {
      setHtml(null);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const preview = await window.api.previewTemplate(raw, template);
        if (isActive) {
          setHtml(preview.html);
        }
      } catch (error) {
        reportError('生成预览', error);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [raw, template]);

  return html;
}
```

- [ ] **Step 9: 创建 `src/renderer/src/view-models/use-fit-scale.ts`**

```ts
import { type RefObject, useEffect, useState } from 'react';

const PX_PER_MM = 96 / 25.4;

/** 让 widthMm × heightMm 的内容在容器里按实物比例尽量放大显示（不超过 maxScale）。 */
export function useFitScale(
  containerRef: RefObject<HTMLElement | null>,
  widthMm: number,
  heightMm: number,
  maxScale: number,
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      const fit = Math.min(width / (widthMm * PX_PER_MM), height / (heightMm * PX_PER_MM), maxScale);
      setScale(Math.max(fit, 0.5));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, widthMm, heightMm, maxScale]);

  return scale;
}
```

- [ ] **Step 10: 创建 `src/renderer/src/view-models/use-window-controls.ts`**

```ts
import { useEffect, useState } from 'react';

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => window.windowControls.onMaximizedChange(setIsMaximized), []);

  return {
    isMaximized,
    minimize: () => window.windowControls.minimize(),
    toggleMaximize: () => window.windowControls.toggleMaximize(),
    close: () => window.windowControls.close(),
  };
}
```

- [ ] **Step 11: 创建 `src/renderer/src/view-models/use-hotkey.ts`**

```ts
import { useEffect, useRef } from 'react';

/** 全局快捷键；handler 始终取最新闭包，不需要重复注册。 */
export function useHotkey(key: string, handler: () => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === key && !event.repeat) {
        event.preventDefault();
        handlerRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key]);
}
```

- [ ] **Step 12: 创建 `src/renderer/src/view-models/use-app-info.ts`**

```ts
import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc-contract';
import { reportError } from '../lib/notices';

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.api.getAppInfo().then(setInfo, (error: unknown) => reportError('读取版本信息', error));
  }, []);

  return info;
}
```

- [ ] **Step 13: 执行**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 全部零错误、测试全部通过。hook 在 Task 13 通过运行界面验证。

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/view-models/use-notices.ts src/renderer/src/view-models/use-settings.ts src/renderer/src/view-models/use-printers.ts src/renderer/src/view-models/use-printer-status.ts src/renderer/src/view-models/use-job-log.ts src/renderer/src/view-models/use-scan-station.ts src/renderer/src/view-models/use-templates.ts src/renderer/src/view-models/use-preview-html.ts src/renderer/src/view-models/use-fit-scale.ts src/renderer/src/view-models/use-window-controls.ts src/renderer/src/view-models/use-hotkey.ts src/renderer/src/view-models/use-app-info.ts
git commit -m "feat(ui): view-models for scan station, templates, printers, history and settings"
```

---

### Task 13: 界面组件 + App（按 frontend-design 方向实现）

**REQUIRED SUB-SKILL：先加载 `frontend-design:frontend-design`。** 视觉方向已在 spec §9 定稿：软尺框住实物比例的标签预览是标志元素，热敏纸出纸式滑入是唯一动效；只用 `tokens.css` 里的 token。

**Files:**
- Create: `src/renderer/src/components/TitleBar.tsx`, `src/renderer/src/components/ScanBar.tsx`, `src/renderer/src/components/ConfirmButton.tsx`, `src/renderer/src/components/Ruler.tsx`, `src/renderer/src/components/PreviewStage.tsx`, `src/renderer/src/components/SidePanel.tsx`, `src/renderer/src/components/PrinterList.tsx`, `src/renderer/src/components/JobLog.tsx`, `src/renderer/src/components/form-controls.tsx`, `src/renderer/src/components/TemplateEditor.tsx`, `src/renderer/src/components/TemplatePanel.tsx`, `src/renderer/src/components/SettingsForm.tsx`, `src/renderer/src/components/NoticeBar.tsx`, `src/renderer/src/components/ErrorBoundary.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles/app.css`, `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes：Task 10–12
- Produces：`TitleBar`、`ScanBar`、`ConfirmButton`、`Ruler`、`PreviewStage`、`SidePanel`、`PrinterList`、`JobLog`、`form-controls`、`TemplateEditor`、`TemplatePanel`、`SettingsForm`、`NoticeBar`、`ErrorBoundary`、`App`

- [ ] **Step 1: 创建 `src/renderer/src/components/TitleBar.tsx`**

```tsx
import { BRAND } from '../../../shared/brand';
import type { PrinterChipView } from '../lib/printer-chip';
import { useWindowControls } from '../view-models/use-window-controls';

interface TitleBarProps {
  printerChip: PrinterChipView;
}

export function TitleBar({ printerChip }: TitleBarProps) {
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <header className="title-bar">
      <div className="title-bar__brand">
        <span className="brand-mark">{BRAND.mark}</span>
        <span className="title-bar__name">{BRAND.productName.replace(`${BRAND.mark}-`, '')}</span>
      </div>
      <div className={`printer-chip printer-chip--${printerChip.tone}`} title="当前打印机">
        <span className="printer-chip__dot" aria-hidden="true" />
        <span className="printer-chip__name">{printerChip.text}</span>
      </div>
      <div className="window-controls">
        <button type="button" className="window-button" aria-label="最小化" onClick={minimize}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          className="window-button"
          aria-label={isMaximized ? '还原' : '最大化'}
          onClick={toggleMaximize}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            {isMaximized ? <path d="M2.5 .5h7v7M.5 2.5h7v7h-7z" /> : <path d="M.5 .5h9v9h-9z" />}
          </svg>
        </button>
        <button type="button" className="window-button window-button--close" aria-label="关闭到托盘" onClick={close}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 创建 `src/renderer/src/components/ScanBar.tsx`**

```tsx
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { NoteOption } from '../lib/note-options';

const REFOCUS_DELAY_MS = 300;
/** 焦点停在搜索框等文本框里、且这么久没有输入时，自动回到扫码框，避免扫码被别的输入框吃掉。 */
const TEXT_FIELD_IDLE_RETURN_MS = 8_000;
/** 在这些区域（模板编辑、设置）里的文本框可以长时间保留焦点。 */
const KEEP_FOCUS_SELECTOR = '[data-keep-focus]';
const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'number']);

function isTextEntry(element: Element | null): boolean {
  if (element instanceof HTMLInputElement) {
    return TEXT_ENTRY_TYPES.has(element.type);
  }
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

export interface NoteControl {
  options: NoteOption[];
  selected: string;
  onSelect: (value: string) => void;
}

interface ScanBarProps {
  autoPrint: boolean;
  note: NoteControl;
  onAutoPrintChange: (autoPrint: boolean) => void;
  onScan: (raw: string) => void;
}

export function ScanBar({ autoPrint, note, onAutoPrintChange, onScan }: ScanBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const focusScanInput = () => inputRef.current?.focus();
    let idleTimer: number | undefined;

    const scheduleIdleReturn = () => {
      window.clearTimeout(idleTimer);
      const active = document.activeElement;
      if (active === inputRef.current || !isTextEntry(active) || active?.closest(KEEP_FOCUS_SELECTOR)) {
        return;
      }
      idleTimer = window.setTimeout(() => {
        if (document.activeElement === active) {
          focusScanInput();
        }
      }, TEXT_FIELD_IDLE_RETURN_MS);
    };

    // 焦点落到按钮、开关、空白处时拉回扫码框：否则扫码枪的回车会「点击」刚才的按钮。
    const onFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active === inputRef.current) {
          return;
        }
        if (isTextEntry(active)) {
          scheduleIdleReturn();
          return;
        }
        focusScanInput();
      }, REFOCUS_DELAY_MS);
    };

    focusScanInput();
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', scheduleIdleReturn, true);
    return () => {
      window.clearTimeout(idleTimer);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', scheduleIdleReturn, true);
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    const raw = event.currentTarget.value;
    setValue('');
    if (raw.trim() !== '') {
      onScan(raw);
    }
  };

  return (
    <section className="scan-bar" aria-label="扫码">
      <label className="scan-bar__field">
        <span className="scan-bar__label">扫码</span>
        <input
          ref={inputRef}
          className="scan-bar__input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="用扫码枪扫标签二维码，或手动输入后回车"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="note-picker">
        <span className="note-picker__label">备注</span>
        <select
          className="note-picker__select"
          value={note.selected}
          onChange={(event) => {
            note.onSelect(event.target.value);
            // 选完立刻把焦点还给扫码框，避免下一次扫码的回车落在下拉框上。
            inputRef.current?.focus();
          }}
        >
          {note.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={autoPrint}
          checked={autoPrint}
          onChange={(event) => onAutoPrintChange(event.target.checked)}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span className="switch__text">{autoPrint ? '自动打印' : '手动打印'}</span>
      </label>
    </section>
  );
}
```

- [ ] **Step 3: 创建 `src/renderer/src/components/ConfirmButton.tsx`**

```tsx
import { useEffect, useState } from 'react';

const CONFIRM_WINDOW_MS = 3_000;

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}

/** 界面内两步确认：第一次点击进入待确认状态，3 秒内再点才执行；超时自动复原。不弹系统对话框。 */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'button' }: ConfirmButtonProps) {
  const [isArmed, setIsArmed] = useState(false);

  useEffect(() => {
    if (!isArmed) {
      return;
    }
    const timer = window.setTimeout(() => setIsArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [isArmed]);

  const handleClick = () => {
    if (isArmed) {
      setIsArmed(false);
      onConfirm();
    } else {
      setIsArmed(true);
    }
  };

  return (
    <button type="button" className={`${className}${isArmed ? ' button--armed' : ''}`} onClick={handleClick}>
      {isArmed ? confirmLabel : label}
    </button>
  );
}
```

- [ ] **Step 4: 创建 `src/renderer/src/components/Ruler.tsx`**

```tsx
export const RULER_DEPTH_MM = 4;
const MAJOR_TICK_EVERY_MM = 10;
const MID_TICK_EVERY_MM = 5;
const TICK_LENGTH_MM = { major: 2.6, mid: 1.8, minor: 1 } as const;
const LABEL_OFFSET_MM = 0.5;
const LABEL_BASELINE_MM = 1.9;

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  lengthMm: number;
}

/** 以毫米为 SVG 用户单位，跟随 --mm 缩放，与预览的标签实物比例一致。 */
export function Ruler({ orientation, lengthMm }: RulerProps) {
  const isHorizontal = orientation === 'horizontal';
  const marks = Array.from({ length: lengthMm + 1 }, (_, mm) => mm);
  const numbered = marks.filter((mm) => mm % MAJOR_TICK_EVERY_MM === 0 && mm > 0 && mm < lengthMm);
  const viewBox = isHorizontal ? `0 0 ${lengthMm} ${RULER_DEPTH_MM}` : `0 0 ${RULER_DEPTH_MM} ${lengthMm}`;

  return (
    <svg className={`ruler ruler--${orientation}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
      {marks.map((mm) => {
        const length =
          mm % MAJOR_TICK_EVERY_MM === 0
            ? TICK_LENGTH_MM.major
            : mm % MID_TICK_EVERY_MM === 0
              ? TICK_LENGTH_MM.mid
              : TICK_LENGTH_MM.minor;
        return isHorizontal ? (
          <line key={mm} x1={mm} x2={mm} y1={RULER_DEPTH_MM} y2={RULER_DEPTH_MM - length} />
        ) : (
          <line key={mm} y1={mm} y2={mm} x1={RULER_DEPTH_MM} x2={RULER_DEPTH_MM - length} />
        );
      })}
      {numbered.map((mm) =>
        isHorizontal ? (
          <text key={`n${mm}`} x={mm + LABEL_OFFSET_MM} y={LABEL_BASELINE_MM}>
            {mm}
          </text>
        ) : (
          <text key={`n${mm}`} x={LABEL_OFFSET_MM} y={mm - LABEL_OFFSET_MM}>
            {mm}
          </text>
        ),
      )}
    </svg>
  );
}
```

- [ ] **Step 5: 创建 `src/renderer/src/components/PreviewStage.tsx`**

```tsx
import { type CSSProperties, useRef } from 'react';
import { LABEL_PAPER_MM } from '../../../shared/label-paper';
import type { ScanView } from '../lib/status-text';
import { useFitScale } from '../view-models/use-fit-scale';
import type { ScanState } from '../view-models/use-scan-station';
import { ConfirmButton } from './ConfirmButton';
import { RULER_DEPTH_MM, Ruler } from './Ruler';

const MAX_PREVIEW_SCALE = 2.8;

export interface PreviewOverride {
  html: string | null;
  /** 显示在预览角上的说明，例如「模板编辑中」「示例」。 */
  badge: string;
}

interface PreviewStageProps {
  scan: ScanState | null;
  view: ScanView;
  override: PreviewOverride | null;
  onPrint: () => void;
  onForceReprint: () => void;
}

export function PreviewStage({ scan, view, override, onPrint, onForceReprint }: PreviewStageProps) {
  const benchRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(
    benchRef,
    LABEL_PAPER_MM.width + RULER_DEPTH_MM,
    LABEL_PAPER_MM.height + RULER_DEPTH_MM,
    MAX_PREVIEW_SCALE,
  );
  const html = override ? override.html : (scan?.preview.html ?? null);
  const feedKey = override ? `override-${override.badge}` : `scan-${scan?.seq ?? 0}`;

  return (
    <section className={`preview-stage tone--${view.status.tone}`} aria-label="标签预览">
      <div ref={benchRef} className="preview-stage__bench" style={{ '--preview-scale': scale } as CSSProperties}>
        <div className="tape">
          <div className="tape__corner" aria-hidden="true">
            mm
          </div>
          <Ruler orientation="horizontal" lengthMm={LABEL_PAPER_MM.width} />
          <Ruler orientation="vertical" lengthMm={LABEL_PAPER_MM.height} />
          <div className="label-slot">
            {override && <span className="label-badge">{override.badge}</span>}
            {html ? (
              <div key={feedKey} className="label-feed">
                <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
              </div>
            ) : (
              <p className="label-placeholder">
                {scan
                  ? '这个二维码无法生成标签'
                  : `扫码后在这里预览 ${LABEL_PAPER_MM.width}×${LABEL_PAPER_MM.height} 标签`}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="status-strip" role="status" aria-live="polite">
        <div className="status-strip__text">
          <strong className="status-strip__title">{view.status.title}</strong>
          <span className="status-strip__detail">{view.status.detail}</span>
        </div>
        <div className="status-strip__actions">
          {view.actions.forceReprint && (
            <ConfirmButton
              key={scan?.seq}
              label="强制补打"
              confirmLabel="再点一次确认补打"
              onConfirm={onForceReprint}
            />
          )}
          {view.actions.print && (
            <button type="button" className="button button--primary" onClick={onPrint}>
              {view.actions.print === 'retry' ? '重试打印' : '打印'}
              <kbd>F2</kbd>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: 创建 `src/renderer/src/components/SidePanel.tsx`**

```tsx
import type { ReactNode } from 'react';

export type SideTab = 'printers' | 'templates' | 'history' | 'settings';

const TABS: ReadonlyArray<{ id: SideTab; label: string }> = [
  { id: 'printers', label: '打印机' },
  { id: 'templates', label: '模板' },
  { id: 'history', label: '打印记录' },
  { id: 'settings', label: '设置' },
];

interface SidePanelProps {
  active: SideTab;
  onActiveChange: (tab: SideTab) => void;
  panels: Record<SideTab, ReactNode>;
}

/** 非当前标签页只隐藏不卸载：搜索词、滚动位置、编辑中的模板都会保留。 */
export function SidePanel({ active, onActiveChange, panels }: SidePanelProps) {
  return (
    <aside className="side">
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            className="tab"
            onClick={() => onActiveChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          className="tab-panel"
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {panels[tab.id]}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 7: 创建 `src/renderer/src/components/PrinterList.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';
import { filterPrinters } from '../lib/list-filters';
import { describeResult } from '../lib/status-text';

interface PrinterListProps {
  printers: PrinterInfo[];
  selected: string | null;
  isLoading: boolean;
  onSelect: (printerName: string) => void;
  onRefresh: () => void;
  onTestPrint: (printerName: string) => Promise<PrintResult | null>;
}

export function PrinterList({ printers, selected, isLoading, onSelect, onRefresh, onTestPrint }: PrinterListProps) {
  const [query, setQuery] = useState('');
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const visible = useMemo(() => filterPrinters(printers, query), [printers, query]);
  const isSelectedMissing = selected !== null && !isLoading && !printers.some((printer) => printer.name === selected);

  const runTest = async (printerName: string) => {
    setTestMessages((messages) => ({ ...messages, [printerName]: '正在发送测试页…' }));
    const result = await onTestPrint(printerName);
    const message =
      result === null
        ? '发送失败：程序内部错误'
        : result.status === 'printed'
          ? '测试页已发送'
          : describeResult(result, Date.now()).detail;
    setTestMessages((messages) => ({ ...messages, [printerName]: message }));
  };

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <input
          type="search"
          className="text-field"
          placeholder={`搜索 ${printers.length} 台打印机`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="button button--small" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? '刷新中…' : '刷新'}
        </button>
      </div>
      {isSelectedMissing && <p className="notice-inline">已保存的打印机「{selected}」现在不在系统里，请重新选择</p>}
      <ul className="scroll-list">
        {visible.map((printer) => {
          const isSelected = printer.name === selected;
          return (
            <li key={printer.name} className={`printer-row${isSelected ? ' printer-row--selected' : ''}`}>
              <button
                type="button"
                className="printer-row__select"
                aria-pressed={isSelected}
                onClick={() => onSelect(printer.name)}
              >
                <span className="printer-row__name">{printer.displayName}</span>
                {isSelected && <span className="badge">当前</span>}
              </button>
              <button
                type="button"
                className="button button--small button--quiet"
                onClick={() => void runTest(printer.name)}
              >
                测试页
              </button>
              {testMessages[printer.name] && <p className="printer-row__message">{testMessages[printer.name]}</p>}
            </li>
          );
        })}
      </ul>
      {!isLoading && visible.length === 0 && (
        <p className="empty">
          {printers.length === 0
            ? '系统里没有打印机。先在 Windows「设置 › 打印机和扫描仪」里添加，再点刷新'
            : `没有名称包含「${query}」的打印机`}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 8: 创建 `src/renderer/src/components/JobLog.tsx`**

```tsx
import type { JobRecord } from '../../../core/types';
import { describeJobStatus, describeSource, formatDateTime } from '../lib/status-text';

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

interface JobLogProps {
  jobs: JobRecord[];
  total: number;
  historyLimit: number;
  search: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onSearchChange: (search: string) => void;
  onLoadMore: () => void;
  onReview: (raw: string) => void;
  onReprint: (raw: string) => void;
}

export function JobLog({
  jobs,
  total,
  historyLimit,
  search,
  hasMore,
  isLoadingMore,
  onSearchChange,
  onLoadMore,
  onReview,
  onReprint,
}: JobLogProps) {
  const isSearching = search.trim() !== '';

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <input
          type="search"
          className="text-field"
          placeholder="按编码、颜色、尺码搜索全部记录"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <span className="job-log__count" title="超出上限后自动删除最早的记录">
          {NUMBER_FORMAT.format(total)} / {NUMBER_FORMAT.format(historyLimit)}
        </span>
      </div>
      <ol className="scroll-list">
        {jobs.map((job) => {
          const status = describeJobStatus(job);
          return (
            <li key={job.id} className="job-row">
              <div className="job-row__main">
                <span className={`job-row__status tone--${status.tone}`}>{status.text}</span>
                <span className="job-row__raw">{job.raw}</span>
              </div>
              <div className="job-row__meta">
                {formatDateTime(job.createdAt)} · {describeSource(job.source)} · {job.printerName}
              </div>
              {job.status !== 'invalid' && (
                <div className="job-row__actions">
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    onClick={() => onReview(job.raw)}
                  >
                    预览
                  </button>
                  <button type="button" className="button button--small" onClick={() => onReprint(job.raw)}>
                    重打
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {hasMore && (
          <li className="job-log__more">
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? '加载中…' : '加载更早的记录'}
            </button>
          </li>
        )}
      </ol>
      {jobs.length === 0 && (
        <p className="empty">{isSearching ? `没有包含「${search.trim()}」的记录` : '还没有打印记录。扫一张标签试试'}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 9: 创建 `src/renderer/src/components/form-controls.tsx`**

```tsx
import { useEffect, useId, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

/** 输入过程中只提交范围内的合法数字；失焦时把非法输入恢复成当前值。 */
export function NumberField({ label, value, min, max, step, unit = 'mm', onChange }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <span className="form-row__control">
        <input
          id={id}
          type="number"
          className="text-field text-field--number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
              onChange(parsed);
            }
          }}
          onBlur={() => setDraft(String(value))}
        />
        <span className="form-row__unit">{unit}</span>
      </span>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="form-row">
      <span className="form-row__label">{label}</span>
      <span className="switch switch--bare">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </span>
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="form-row">
      <span className="form-row__label">{label}</span>
      <fieldset className="segmented" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="segmented__option"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

interface TextInputProps {
  label: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  onChange: (value: string) => void;
}

export function TextInput({ label, value, maxLength, placeholder, onChange }: TextInputProps) {
  const id = useId();
  return (
    <div className="form-row">
      <label className="form-row__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="text-field"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
```

- [ ] **Step 10: 创建 `src/renderer/src/components/TemplateEditor.tsx`**

```tsx
import { useId } from 'react';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';
import {
  type FieldConfig,
  type FieldKey,
  type LabelTemplate,
  maxQrSizeMm,
  type NoteConfig,
  type NotePlacement,
  type QrErrorLevel,
  type QrLayout,
  TEMPLATE_LIMITS,
  type TextAlign,
} from '../../../core/templates/template-model';
import { NumberField, Segmented, TextInput, Toggle } from './form-controls';

const FONT_STEP_MM = 0.1;
const PADDING_STEP_MM = 0.5;
const QR_STEP_MM = 1;

const FIELD_LABELS: ReadonlyArray<{ key: FieldKey; label: string }> = [
  { key: 'code', label: '编码' },
  { key: 'color', label: '颜色' },
  { key: 'size', label: '尺码' },
  { key: 'raw', label: '完整编码（底部）' },
];

const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

const LAYOUT_OPTIONS: ReadonlyArray<{ value: QrLayout; label: string }> = [
  { value: 'qr-left', label: '二维码在左' },
  { value: 'qr-right', label: '二维码在右' },
];

const ERROR_LEVEL_OPTIONS: ReadonlyArray<{ value: QrErrorLevel; label: string }> = [
  { value: 'L', label: 'L 7%' },
  { value: 'M', label: 'M 15%' },
  { value: 'Q', label: 'Q 25%' },
  { value: 'H', label: 'H 30%' },
];

const NOTE_PLACEMENT_OPTIONS: ReadonlyArray<{ value: NotePlacement; label: string }> = [
  { value: 'beside-qr', label: '二维码旁空白处' },
  { value: 'bottom', label: '底部整行' },
];

interface TemplateEditorProps {
  draft: LabelTemplate;
  isDirty: boolean;
  onChange: (draft: LabelTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** 编辑自定义模板：改动实时反映在左侧预览，点「保存模板」后才用于打印。 */
export function TemplateEditor({ draft, isDirty, onChange, onSave, onCancel }: TemplateEditorProps) {
  const noteId = useId();
  const { fontSizeMm } = TEMPLATE_LIMITS;
  const setField = (key: FieldKey, patch: Partial<FieldConfig>) =>
    onChange({ ...draft, fields: { ...draft.fields, [key]: { ...draft.fields[key], ...patch } } });
  const setNote = (patch: Partial<NoteConfig>) => onChange({ ...draft, note: { ...draft.note, ...patch } });

  return (
    <div className="template-editor" data-keep-focus>
      <div className="template-editor__scroll">
        <section className="form-section">
          <h3 className="form-section__title">基本</h3>
          <TextInput
            label="模板名称"
            value={draft.name}
            maxLength={TEMPLATE_LIMITS.nameLength}
            onChange={(name) => onChange({ ...draft, name })}
          />
          <Segmented
            label="布局"
            value={draft.layout}
            options={LAYOUT_OPTIONS}
            onChange={(layout) => onChange({ ...draft, layout })}
          />
          <Segmented
            label="旁侧文字"
            value={draft.sideAlign}
            options={ALIGN_OPTIONS}
            onChange={(sideAlign) => onChange({ ...draft, sideAlign })}
          />
          <Segmented
            label="底部文字"
            value={draft.bottomAlign}
            options={ALIGN_OPTIONS}
            onChange={(bottomAlign) => onChange({ ...draft, bottomAlign })}
          />
          <p className="form-hint">
            对齐按区域统一设置：二维码旁的编码、颜色、尺码（和旁边的备注）共用一种对齐，前缀与值分两列，值永远对齐。
          </p>
          <NumberField
            label="页边距"
            value={draft.paddingMm}
            min={TEMPLATE_LIMITS.paddingMm.min}
            max={TEMPLATE_LIMITS.paddingMm.max}
            step={PADDING_STEP_MM}
            onChange={(paddingMm) =>
              onChange({
                ...draft,
                paddingMm,
                qr: { ...draft.qr, sizeMm: Math.min(draft.qr.sizeMm, maxQrSizeMm(paddingMm)) },
              })
            }
          />
        </section>

        <section className="form-section">
          <h3 className="form-section__title">二维码</h3>
          <Toggle
            label="显示二维码"
            checked={draft.qr.visible}
            onChange={(visible) => onChange({ ...draft, qr: { ...draft.qr, visible } })}
          />
          <NumberField
            label="边长"
            value={draft.qr.sizeMm}
            min={TEMPLATE_LIMITS.qrSizeMm.min}
            max={maxQrSizeMm(draft.paddingMm)}
            step={QR_STEP_MM}
            onChange={(sizeMm) => onChange({ ...draft, qr: { ...draft.qr, sizeMm } })}
          />
          <Segmented
            label="容错等级"
            value={draft.qr.errorCorrection}
            options={ERROR_LEVEL_OPTIONS}
            onChange={(errorCorrection) => onChange({ ...draft, qr: { ...draft.qr, errorCorrection } })}
          />
          <p className="form-hint">容错越高，二维码被磨损后越容易识别，但图案更密；热敏标签建议 M 或 Q。</p>
        </section>

        {FIELD_LABELS.map(({ key, label }) => {
          const field = draft.fields[key];
          return (
            <section key={key} className="form-section">
              <h3 className="form-section__title">{label}</h3>
              <Toggle label="显示" checked={field.visible} onChange={(visible) => setField(key, { visible })} />
              <TextInput
                label="前缀文字"
                value={field.prefix}
                maxLength={TEMPLATE_LIMITS.prefixLength}
                placeholder="例如 编码："
                onChange={(prefix) => setField(key, { prefix })}
              />
              <NumberField
                label="字号"
                value={field.fontSizeMm}
                min={fontSizeMm.min}
                max={fontSizeMm.max}
                step={FONT_STEP_MM}
                onChange={(size) => setField(key, { fontSizeMm: size })}
              />
              <Toggle label="加粗" checked={field.bold} onChange={(bold) => setField(key, { bold })} />
            </section>
          );
        })}

        <section className="form-section">
          <h3 className="form-section__title">备注</h3>
          <Toggle label="显示备注" checked={draft.note.visible} onChange={(visible) => setNote({ visible })} />
          <div className="form-row form-row--stacked">
            <label className="form-row__label" htmlFor={noteId}>
              备注内容
            </label>
            <textarea
              id={noteId}
              className="text-field text-area"
              rows={3}
              maxLength={TEMPLATE_LIMITS.noteLength}
              value={draft.note.text}
              placeholder="例如：样衣间 {日期}"
              onChange={(event) => setNote({ text: event.target.value })}
            />
            <fieldset className="variable-chips" aria-label="插入变量">
              {NOTE_VARIABLES.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  className="chip"
                  onClick={() =>
                    setNote({ text: `${draft.note.text}${variable}`.slice(0, TEMPLATE_LIMITS.noteLength) })
                  }
                >
                  {variable}
                </button>
              ))}
            </fieldset>
          </div>
          <Segmented
            label="位置"
            value={draft.note.placement}
            options={NOTE_PLACEMENT_OPTIONS}
            onChange={(placement) => setNote({ placement })}
          />
          <NumberField
            label="字号"
            value={draft.note.fontSizeMm}
            min={fontSizeMm.min}
            max={fontSizeMm.max}
            step={FONT_STEP_MM}
            onChange={(size) => setNote({ fontSizeMm: size })}
          />
          <Toggle label="加粗" checked={draft.note.bold} onChange={(bold) => setNote({ bold })} />
        </section>
      </div>
      <div className="template-editor__footer">
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {isDirty ? '放弃修改' : '返回列表'}
        </button>
        <button type="button" className="button button--primary" onClick={onSave} disabled={!isDirty}>
          保存模板
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: 创建 `src/renderer/src/components/TemplatePanel.tsx`**

```tsx
import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import { ConfirmButton } from './ConfirmButton';
import { TemplateEditor } from './TemplateEditor';

interface TemplatePanelProps {
  templates: LabelTemplate[];
  activeId: string | null;
  draft: LabelTemplate | null;
  isDirty: boolean;
  onActivate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDraftChange: (draft: LabelTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function TemplatePanel(props: TemplatePanelProps) {
  const { templates, activeId, draft } = props;
  if (draft) {
    return (
      <TemplateEditor
        draft={draft}
        isDirty={props.isDirty}
        onChange={props.onDraftChange}
        onSave={props.onSave}
        onCancel={props.onCancel}
      />
    );
  }
  return (
    <div className="panel-body">
      <p className="panel-intro">纸张固定 60×40mm。内置模板不能修改，点「复制」生成自定义模板后再编辑。</p>
      <ul className="scroll-list">
        {templates.map((template) => {
          const isActive = template.id === activeId;
          const isBuiltIn = isBuiltInTemplateId(template.id);
          return (
            <li key={template.id} className={`template-row${isActive ? ' template-row--active' : ''}`}>
              <div className="template-row__head">
                <span className="template-row__name">{template.name}</span>
                <span className="badge badge--quiet">{isBuiltIn ? '内置' : '自定义'}</span>
                {isActive && <span className="badge">使用中</span>}
              </div>
              <div className="template-row__actions">
                {!isActive && (
                  <button type="button" className="button button--small" onClick={() => props.onActivate(template.id)}>
                    使用
                  </button>
                )}
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => props.onDuplicate(template.id)}
                >
                  复制
                </button>
                {!isBuiltIn && (
                  <>
                    <button
                      type="button"
                      className="button button--small button--quiet"
                      onClick={() => props.onEdit(template.id)}
                    >
                      编辑
                    </button>
                    <ConfirmButton
                      className="button button--small button--quiet"
                      label="删除"
                      confirmLabel="确认删除"
                      onConfirm={() => props.onRemove(template.id)}
                    />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 12: 创建 `src/renderer/src/components/SettingsForm.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';
import type { AppInfo } from '../../../shared/ipc-contract';
import {
  type AppSettings,
  HISTORY_LIMIT_RANGE,
  MAX_DEDUP_WINDOW_MINUTES,
  MAX_NOTE_PRESETS,
  sanitizeNoteText,
} from '../../../shared/settings';
import { ConfirmButton } from './ConfirmButton';

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

interface SettingsFormProps {
  settings: AppSettings;
  jobTotal: number;
  appInfo: AppInfo | null;
  onChange: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  onOpenLogFolder: () => void;
}

export function SettingsForm({ settings, jobTotal, appInfo, onChange, onOpenLogFolder }: SettingsFormProps) {
  const [pendingHistoryLimit, setPendingHistoryLimit] = useState<number | null>(null);
  const [newNote, setNewNote] = useState('');
  const newNoteText = sanitizeNoteText(newNote);
  const canAddNote =
    newNoteText !== null &&
    !settings.notePresets.includes(newNoteText) &&
    settings.notePresets.length < MAX_NOTE_PRESETS;

  const addNote = async () => {
    if (newNoteText && canAddNote && (await onChange({ notePresets: [...settings.notePresets, newNoteText] }))) {
      setNewNote('');
    }
  };

  const commitHistoryLimit = async (historyLimit: number): Promise<number | null> => {
    // 调小到当前记录数以下会永久删除旧记录：先确认。
    if (historyLimit < jobTotal) {
      setPendingHistoryLimit(historyLimit);
      return null;
    }
    return (await onChange({ historyLimit }))?.historyLimit ?? null;
  };

  return (
    <div className="settings" data-keep-focus>
      <NumberSetting
        label="防重复打印"
        unit="分钟"
        hint="同一标签在这段时间内只打一次；填 0 表示不拦截"
        value={settings.dedupWindowMinutes}
        min={0}
        max={MAX_DEDUP_WINDOW_MINUTES}
        onCommit={async (dedupWindowMinutes) => (await onChange({ dedupWindowMinutes }))?.dedupWindowMinutes ?? null}
      />
      <NumberSetting
        label="打印记录保留"
        unit="条"
        hint={`超出后自动删除最早的记录；当前 ${NUMBER_FORMAT.format(jobTotal)} 条，10 万条约占 20 MB`}
        value={settings.historyLimit}
        min={HISTORY_LIMIT_RANGE.min}
        max={HISTORY_LIMIT_RANGE.max}
        onCommit={commitHistoryLimit}
      />
      {pendingHistoryLimit !== null && (
        <div className="confirm-row" role="alert">
          <p>
            调到 {NUMBER_FORMAT.format(pendingHistoryLimit)} 条会删除最早的{' '}
            {NUMBER_FORMAT.format(jobTotal - pendingHistoryLimit)} 条记录，删除后无法恢复。
          </p>
          <div className="confirm-row__actions">
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => setPendingHistoryLimit(null)}
            >
              取消
            </button>
            <ConfirmButton
              className="button button--small"
              label="删除旧记录"
              confirmLabel="再点一次确认删除"
              onConfirm={() => {
                const historyLimit = pendingHistoryLimit;
                setPendingHistoryLimit(null);
                void onChange({ historyLimit });
              }}
            />
          </div>
        </div>
      )}
      <label className="setting">
        <span className="setting__label">开机自动启动</span>
        <span className="switch switch--bare">
          <input
            type="checkbox"
            role="switch"
            aria-checked={settings.launchAtLogin}
            checked={settings.launchAtLogin}
            onChange={(event) => void onChange({ launchAtLogin: event.target.checked })}
          />
          <span className="switch__track" aria-hidden="true">
            <span className="switch__thumb" />
          </span>
        </span>
        <span className="setting__hint">登录 Windows 后自动打开窗口，可以直接扫码</span>
      </label>

      <section className="note-presets" aria-label="常用备注">
        <h3 className="about__title">常用备注</h3>
        <p className="setting__hint">
          在扫码框旁的「备注」下拉框里一键切换，会替换当前模板的备注文字（位置和字号仍按模板）。支持变量：
          {NOTE_VARIABLES.join(' ')}
        </p>
        <ul className="note-presets__list">
          {settings.notePresets.map((text) => (
            <li key={text} className="note-presets__item">
              <span className="note-presets__text">{text}</span>
              <button
                type="button"
                className="button button--small button--quiet"
                onClick={() => void onChange({ notePresets: settings.notePresets.filter((preset) => preset !== text) })}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        {settings.notePresets.length === 0 && <p className="setting__hint">还没有常用备注。</p>}
        <textarea
          className="text-field text-area"
          rows={2}
          value={newNote}
          placeholder="例如：样衣间 {日期}"
          onChange={(event) => setNewNote(event.target.value)}
        />
        <button type="button" className="button button--small" disabled={!canAddNote} onClick={() => void addNote()}>
          添加常用备注（{settings.notePresets.length}/{MAX_NOTE_PRESETS}）
        </button>
      </section>

      <section className="about" aria-label="关于">
        <h3 className="about__title">关于</h3>
        {appInfo ? (
          <dl className="about__list">
            <dt>软件</dt>
            <dd>
              {appInfo.productName} v{appInfo.version}
            </dd>
            <dt>出品</dt>
            <dd>{appInfo.brandOwner}（CDL）</dd>
            <dt>数据目录</dt>
            <dd className="about__path">{appInfo.dataPath}</dd>
          </dl>
        ) : (
          <p className="setting__hint">正在读取版本信息…</p>
        )}
        <button type="button" className="button button--small button--quiet" onClick={onOpenLogFolder}>
          打开日志目录
        </button>
      </section>
    </div>
  );
}

interface NumberSettingProps {
  label: string;
  unit: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  /** 返回主进程校验后的值（可能被纠正）；null 表示未保存。 */
  onCommit: (value: number) => Promise<number | null>;
}

function NumberSetting({ label, unit, hint, value, min, max, onCommit }: NumberSettingProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = async () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed === value) {
      setDraft(String(value));
      return;
    }
    const saved = await onCommit(parsed);
    // 用主进程纠正后的值回显（例如超出上限被夹回）。
    setDraft(String(saved ?? value));
  };

  return (
    <label className="setting">
      <span className="setting__label">{label}</span>
      <span className="setting__control">
        <input
          type="number"
          className="text-field text-field--number"
          min={min}
          max={max}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="setting__unit">{unit}</span>
      </span>
      <span className="setting__hint">{hint}</span>
    </label>
  );
}
```

- [ ] **Step 13: 创建 `src/renderer/src/components/NoticeBar.tsx`**

```tsx
import { useEffect } from 'react';
import type { Notice } from '../lib/notices';

const AUTO_DISMISS_MS = 8_000;

interface NoticeBarProps {
  notices: readonly Notice[];
  onDismiss: (id: number) => void;
}

export function NoticeBar({ notices, onDismiss }: NoticeBarProps) {
  useEffect(() => {
    const timers = notices.map((notice) => window.setTimeout(() => onDismiss(notice.id), AUTO_DISMISS_MS));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [notices, onDismiss]);

  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="notice-bar" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice notice--${notice.tone}`}>
          <span>{notice.message}</span>
          <button type="button" className="notice__close" aria-label="关闭提示" onClick={() => onDismiss(notice.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 14: 创建 `src/renderer/src/components/ErrorBoundary.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** 渲染异常时给出可恢复的界面，而不是整窗白屏；错误会被主进程日志收集。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] UI crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="crash-screen" role="alert">
        <h1>界面出错了</h1>
        <p>错误已写入日志。打印记录和设置不受影响。</p>
        <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
          重新加载界面
        </button>
      </div>
    );
  }
}
```

- [ ] **Step 15: 创建 `src/renderer/src/App.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { applyNoteOverride } from '../../core/templates/note-override';
import { SAMPLE_LABEL_RAW } from '../../shared/sample-label';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { JobLog } from './components/JobLog';
import { NoticeBar } from './components/NoticeBar';
import { type PreviewOverride, PreviewStage } from './components/PreviewStage';
import { PrinterList } from './components/PrinterList';
import { ScanBar } from './components/ScanBar';
import { SettingsForm } from './components/SettingsForm';
import { SidePanel, type SideTab } from './components/SidePanel';
import { TemplatePanel } from './components/TemplatePanel';
import { TitleBar } from './components/TitleBar';
import { buildNoteOptions, resolveNoteSelection } from './lib/note-options';
import { reportError } from './lib/notices';
import { describePrinterChip } from './lib/printer-chip';
import { describeScan } from './lib/status-text';
import { useAppInfo } from './view-models/use-app-info';
import { useHotkey } from './view-models/use-hotkey';
import { useJobLog } from './view-models/use-job-log';
import { useNotices } from './view-models/use-notices';
import { usePreviewHtml } from './view-models/use-preview-html';
import { usePrinterStatus } from './view-models/use-printer-status';
import { usePrinters } from './view-models/use-printers';
import { useScanStation } from './view-models/use-scan-station';
import { useSettings } from './view-models/use-settings';
import { useTemplates } from './view-models/use-templates';

export function App() {
  const { settings, hasLoadError, reload, update, replace } = useSettings();
  const printers = usePrinters();
  const jobLog = useJobLog();
  const appInfo = useAppInfo();
  const { notices, dismiss } = useNotices();
  const [sideTab, setSideTab] = useState<SideTab>('printers');

  const printerName = settings?.selectedPrinter ?? null;
  const autoPrint = settings?.autoPrint ?? DEFAULT_SETTINGS.autoPrint;
  const historyLimit = settings?.historyLimit ?? DEFAULT_SETTINGS.historyLimit;
  const readiness = usePrinterStatus(printerName);
  const printerChip = describePrinterChip({
    printerName,
    isLoading: printers.isLoading,
    isListed: printers.printers.some((printer) => printer.name === printerName),
    readiness,
  });

  // 是否能打印由主进程最终判断（找不到打印机会返回 PRINTER_NOT_FOUND），界面只要求选过打印机。
  const station = useScanStation({ printerName, autoPrint, onJobRecorded: jobLog.refresh });
  const templates = useTemplates({
    activeTemplateId: settings?.activeTemplateId ?? null,
    updateSettings: update,
    replaceSettings: replace,
    onActiveTemplateChanged: () => void station.refreshPreview(),
  });

  // 编辑模板时预览草稿；没有扫码时用示例标签展示当前生效的模板（含备注下拉框的选择）。
  const noteOverride = settings?.noteOverride ?? DEFAULT_SETTINGS.noteOverride;
  const effectiveTemplate = useMemo(
    () => (templates.active ? applyNoteOverride(templates.active, noteOverride) : null),
    [templates.active, noteOverride],
  );
  const previewTemplate = templates.draft ?? (station.scan ? null : effectiveTemplate);
  const previewRaw = station.scan?.preview.result.status === 'ok' ? station.scan.raw : SAMPLE_LABEL_RAW;
  const overrideHtml = usePreviewHtml(previewRaw, previewTemplate);
  const override: PreviewOverride | null = templates.draft
    ? { html: overrideHtml, badge: '模板编辑中 · 未保存不会用于打印' }
    : previewTemplate && templates.active
      ? { html: overrideHtml, badge: `示例 · ${templates.active.name}` }
      : null;

  const noteOptions = buildNoteOptions(settings?.notePresets ?? [], noteOverride);
  const selectNote = async (value: string) => {
    const selection = resolveNoteSelection(value, settings?.notePresets ?? []);
    if (selection === 'manage') {
      setSideTab('settings');
      return;
    }
    if (selection && (await update({ noteOverride: selection }))) {
      void station.refreshPreview();
    }
  };

  const view = describeScan(station.scan, { autoPrint, hasPrinter: printerName !== null, now: Date.now() });

  useHotkey('F2', () => {
    if (view.actions.print) {
      station.printCurrent(false);
    }
  });

  const changeSettings = async (patch: Partial<AppSettings>) => {
    const next = await update(patch);
    if (next && patch.historyLimit !== undefined) {
      void jobLog.refresh();
    }
    return next;
  };

  const openLogFolder = () => {
    window.api.openLogFolder().catch((error: unknown) => reportError('打开日志目录', error));
  };

  return (
    <div className="app">
      <TitleBar printerChip={printerChip} />
      {settings === null ? (
        <div className="loading">
          {hasLoadError ? (
            <>
              <p>读取设置失败，详情已写入日志。</p>
              <button type="button" className="button button--primary" onClick={() => void reload()}>
                重试
              </button>
            </>
          ) : (
            <p>正在读取设置…</p>
          )}
        </div>
      ) : (
        <main className="workspace">
          <div className="station">
            <ScanBar
              autoPrint={autoPrint}
              note={{ ...noteOptions, onSelect: (value) => void selectNote(value) }}
              onAutoPrintChange={(next) => void update({ autoPrint: next })}
              onScan={station.scanCode}
            />
            <PreviewStage
              scan={station.scan}
              view={view}
              override={override}
              onPrint={() => station.printCurrent(false)}
              onForceReprint={() => station.printCurrent(true)}
            />
          </div>
          <SidePanel
            active={sideTab}
            onActiveChange={setSideTab}
            panels={{
              printers: (
                <PrinterList
                  printers={printers.printers}
                  selected={printerName}
                  isLoading={printers.isLoading}
                  onSelect={(name) => void update({ selectedPrinter: name })}
                  onRefresh={() => void printers.refresh()}
                  onTestPrint={printers.printTest}
                />
              ),
              templates: (
                <TemplatePanel
                  templates={templates.templates}
                  activeId={templates.active?.id ?? null}
                  draft={templates.draft}
                  isDirty={templates.isDirty}
                  onActivate={(id) => void templates.activate(id)}
                  onDuplicate={(id) => void templates.duplicate(id)}
                  onEdit={templates.startEdit}
                  onRemove={(id) => void templates.remove(id)}
                  onDraftChange={templates.changeDraft}
                  onSave={() => void templates.saveDraft()}
                  onCancel={templates.cancelEdit}
                />
              ),
              history: (
                <JobLog
                  jobs={jobLog.jobs}
                  total={jobLog.total}
                  historyLimit={historyLimit}
                  search={jobLog.search}
                  hasMore={jobLog.hasMore}
                  isLoadingMore={jobLog.isLoadingMore}
                  onSearchChange={jobLog.setSearch}
                  onLoadMore={() => void jobLog.loadMore()}
                  onReview={station.review}
                  onReprint={station.reprint}
                />
              ),
              settings: (
                <SettingsForm
                  settings={settings}
                  jobTotal={jobLog.total}
                  appInfo={appInfo}
                  onChange={changeSettings}
                  onOpenLogFolder={openLogFolder}
                />
              ),
            }}
          />
        </main>
      )}
      <NoticeBar notices={notices} onDismiss={dismiss} />
    </div>
  );
}
```

- [ ] **Step 16: 创建 `src/renderer/src/styles/app.css`**

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  overflow: hidden;
  background: var(--color-housing);
  color: var(--color-ink);
  font: 14px / 1.5 var(--font-body);
  user-select: none;
}

button,
input {
  font: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}

.app {
  display: grid;
  grid-template-rows: var(--title-bar-height) minmax(0, 1fr);
  height: 100%;
}

.loading {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-3);
  font-family: var(--font-display);
  font-size: 20px;
}

.loading p {
  margin: 0;
}

/* ── 自绘标题栏 ── */
.title-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding-left: var(--space-4);
  background: var(--color-ink);
  color: var(--color-paper);
  -webkit-app-region: drag;
}

.title-bar__brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.brand-mark {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-tape);
  color: var(--color-ink);
  font: 700 13px / 1.4 var(--font-data);
  letter-spacing: 0.08em;
}

.title-bar__name {
  font-family: var(--font-display);
  font-size: 18px;
  letter-spacing: 0.06em;
}

.printer-chip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 420px;
  margin-left: auto;
  padding: 2px var(--space-3);
  border: 1px solid rgb(251 251 248 / 0.25);
  border-radius: 999px;
  font-size: 12px;
}

.printer-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.printer-chip__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success);
}

.printer-chip--unknown .printer-chip__dot {
  background: var(--color-rule);
}

.printer-chip--muted .printer-chip__dot {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgb(251 251 248 / 0.6);
}

.printer-chip--error {
  border-color: var(--color-error);
}

.printer-chip--error .printer-chip__dot {
  background: var(--color-error);
}

.window-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.window-button {
  display: grid;
  place-items: center;
  width: 46px;
  height: 100%;
  border: 0;
  background: transparent;
}

.window-button:hover {
  background: rgb(251 251 248 / 0.12);
}

.window-button--close:hover {
  background: var(--color-error);
}

.window-button svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
}

/* ── 工作区 ── */
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--side-width);
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
}

.station {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
}

/* ── 扫码条 ── */
.scan-bar {
  display: flex;
  gap: var(--space-3);
}

.scan-bar__field {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
  height: 64px;
  padding: 0 var(--space-4);
  border: 2px solid var(--color-ink);
  border-radius: var(--radius);
  background: var(--color-paper);
}

.scan-bar__field:focus-within {
  box-shadow: 0 0 0 4px var(--color-tape);
}

.scan-bar__label {
  font-family: var(--font-display);
  font-size: 20px;
}

.scan-bar__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: var(--font-data);
  font-size: 22px;
  user-select: text;
}

.scan-bar__input::placeholder {
  color: var(--color-ink-soft);
  font-family: var(--font-body);
  font-size: 15px;
}

/* ── 开关 ── */
.switch {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-paper);
  cursor: pointer;
}

.switch--bare {
  padding: 0;
  border: 0;
  background: transparent;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch__track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-rule);
  transition: background 120ms;
}

.switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-paper);
  transition: transform 120ms;
}

.switch input:checked + .switch__track {
  background: var(--color-ink);
}

.switch input:checked + .switch__track .switch__thumb {
  transform: translateX(18px);
  background: var(--color-tape);
}

.switch input:focus-visible + .switch__track {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}

.switch__text {
  min-width: 4em;
  font-weight: 600;
}

/* ── 状态色：由 tone--* 设置 --tone，供各组件取用 ── */
.tone--idle {
  --tone: var(--color-rule);
}

.tone--pending {
  --tone: var(--color-ink);
}

.tone--success {
  --tone: var(--color-success);
}

.tone--warning {
  --tone: var(--color-warning);
}

.tone--error {
  --tone: var(--color-error);
}

/* ── 预览台：软尺框住实物比例的标签 ── */
.preview-stage {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-top: 6px solid var(--tone);
  border-radius: var(--radius);
  background: var(--color-paper);
}

.preview-stage__bench {
  --preview-scale: 2;
  --mm: calc(3.7795px * var(--preview-scale));
  --ruler-depth: calc(4 * var(--mm));
  display: grid;
  flex: 1;
  place-items: center;
  min-height: 0;
  padding: var(--space-4);
  overflow: hidden;
}

.tape {
  display: grid;
  grid-template-areas:
    "corner top"
    "side label";
  grid-template-columns: var(--ruler-depth) calc(60 * var(--mm));
  grid-template-rows: var(--ruler-depth) calc(40 * var(--mm));
  filter: drop-shadow(0 2px 6px rgb(24 33 30 / 0.12));
}

.tape__corner {
  display: grid;
  grid-area: corner;
  place-items: center;
  border-radius: var(--radius) 0 0 0;
  background: var(--color-tape);
  font: 700 11px var(--font-data);
}

.ruler {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--color-tape);
}

.ruler--horizontal {
  grid-area: top;
  border-radius: 0 var(--radius) 0 0;
}

.ruler--vertical {
  grid-area: side;
  border-radius: 0 0 0 var(--radius);
}

.ruler line {
  stroke: var(--color-ink);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.ruler text {
  fill: var(--color-ink);
  font: 700 1.6px var(--font-data);
}

.label-slot {
  position: relative;
  grid-area: label;
  overflow: hidden;
  background: #fff;
}

.label-badge {
  position: absolute;
  z-index: 1;
  top: 6px;
  right: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-ink);
  color: var(--color-tape);
  font-size: 12px;
  pointer-events: none;
}

.label-feed {
  animation: label-feed var(--feed-duration) ease-out;
}

@keyframes label-feed {
  from {
    transform: translateY(-100%);
  }

  to {
    transform: translateY(0);
  }
}

.label-frame {
  display: block;
  width: 60mm;
  height: 40mm;
  border: 0;
  background: #fff;
  pointer-events: none;
  transform: scale(var(--preview-scale));
  transform-origin: 0 0;
}

.label-placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  margin: 0;
  padding: var(--space-4);
  color: var(--color-ink-soft);
  text-align: center;
}

/* ── 状态条 ── */
.status-strip {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 88px;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-rule);
}

.status-strip__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.status-strip__title {
  color: var(--tone);
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: normal;
  line-height: 1.15;
}

.tone--idle .status-strip__title {
  color: var(--color-ink);
}

.status-strip__detail {
  overflow: hidden;
  color: var(--color-ink-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-strip__actions {
  display: flex;
  gap: var(--space-2);
}

/* ── 按钮 ── */
.button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-ink);
  border-radius: var(--radius);
  background: var(--color-paper);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.button:hover {
  background: var(--color-housing);
}

.button:disabled {
  opacity: 0.5;
  cursor: default;
}

.button--primary {
  height: 44px;
  padding: 0 var(--space-5);
  background: var(--color-ink);
  color: var(--color-paper);
  font-size: 16px;
}

.button--primary:hover {
  background: #2a3531;
}

.button--small {
  height: 28px;
  padding: 0 var(--space-3);
  font-size: 12px;
}

.button--quiet {
  border-color: var(--color-rule);
}

.button--armed,
.button--armed:hover {
  border-color: var(--color-warning);
  background: var(--color-warning);
  color: var(--color-paper);
}

.button kbd {
  padding: 0 4px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font: 11px var(--font-data);
  opacity: 0.7;
}

/* ── 侧栏 ── */
.side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--color-paper);
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--color-rule);
}

.tab {
  flex: 1;
  height: 44px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--color-ink-soft);
  font-weight: 600;
  cursor: pointer;
}

.tab[aria-selected="true"] {
  border-bottom-color: var(--color-tape);
  color: var(--color-ink);
}

.tab-panel[hidden] {
  display: none;
}

.tab-panel,
.panel-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-rule);
}

.text-field {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: #fff;
  user-select: text;
}

.text-field:focus {
  outline: 2px solid var(--color-ink);
  outline-offset: -1px;
}

.text-field--number {
  flex: none;
  width: 112px;
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}

.scroll-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.notice-inline {
  margin: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--color-warning-wash);
  color: var(--color-ink);
  font-size: 13px;
}

.empty {
  margin: 0;
  padding: var(--space-5);
  color: var(--color-ink-soft);
  text-align: center;
}

/* 打印机列表 */
.printer-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0 var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-bottom: 1px solid var(--color-housing);
}

.printer-row--selected {
  background: linear-gradient(90deg, var(--color-tape) 0 4px, var(--color-tape-wash) 4px);
}

.printer-row__select {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.printer-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.printer-row__message {
  grid-column: 1 / -1;
  margin: 0 0 var(--space-1);
  color: var(--color-ink-soft);
  font-size: 12px;
}

.badge--quiet {
  background: var(--color-housing);
  color: var(--color-ink-soft);
}

.badge {
  flex: none;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--color-ink);
  color: var(--color-tape);
  font-size: 11px;
}

/* 打印记录 */
.job-log__more {
  padding: var(--space-3);
  text-align: center;
}

.job-log__count {
  color: var(--color-ink-soft);
  font: 12px var(--font-data);
}

.job-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-housing);
}

.job-row__main {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.job-row__status {
  flex: none;
  color: var(--tone);
  font-size: 12px;
  font-weight: 700;
}

.job-row__raw {
  overflow: hidden;
  font-family: var(--font-data);
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.job-row__meta {
  grid-column: 1;
  overflow: hidden;
  color: var(--color-ink-soft);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-row__actions {
  display: flex;
  grid-column: 2;
  grid-row: 1 / span 2;
  align-items: center;
  gap: var(--space-1);
}

/* 设置 */
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-4);
  overflow-y: auto;
}

.setting {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-1) var(--space-3);
}

.setting__label {
  font-weight: 600;
}

.setting__control {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.setting__unit {
  color: var(--color-ink-soft);
}

.setting__hint {
  grid-column: 1 / -1;
  color: var(--color-ink-soft);
  font-size: 12px;
}

.panel-intro {
  margin: 0;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-rule);
  color: var(--color-ink-soft);
  font-size: 12px;
}

/* 模板列表 */
.template-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-housing);
}

.template-row--active {
  background: linear-gradient(90deg, var(--color-tape) 0 4px, var(--color-tape-wash) 4px);
}

.template-row__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.template-row__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* 模板编辑器 */
.template-editor {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.template-editor__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.template-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3);
  border-top: 1px solid var(--color-rule);
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-housing);
}

.form-section__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: normal;
}

.form-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);
}

.form-row--stacked {
  grid-template-columns: minmax(0, 1fr);
}

.form-row__label {
  color: var(--color-ink-soft);
  font-size: 13px;
}

.form-row__control {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.form-row__unit {
  color: var(--color-ink-soft);
  font-size: 12px;
}

.form-row .switch--bare {
  justify-self: start;
}

.form-hint {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 12px;
}

.segmented {
  display: flex;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  overflow: hidden;
}

.segmented__option {
  flex: 1;
  height: 30px;
  border: 0;
  border-left: 1px solid var(--color-rule);
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.segmented__option:first-child {
  border-left: 0;
}

.segmented__option[aria-pressed="true"] {
  background: var(--color-ink);
  color: var(--color-tape);
}

.text-area {
  height: auto;
  padding: var(--space-2) var(--space-3);
  resize: vertical;
  line-height: 1.5;
}

.variable-chips {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.chip {
  padding: 2px 8px;
  border: 1px dashed var(--color-rule);
  border-radius: 999px;
  background: #fff;
  font: 12px var(--font-body);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--color-ink);
}

/* 设置：调小记录上限的确认、关于 */
.confirm-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--color-warning-wash);
}

.confirm-row p {
  margin: 0;
  font-size: 13px;
}

.confirm-row__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.about {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-rule);
}

.about__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: normal;
}

.about__list {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: 13px;
}

.about__list dt {
  color: var(--color-ink-soft);
}

.about__list dd {
  margin: 0;
}

.about__path {
  font-family: var(--font-data);
  font-size: 12px;
  word-break: break-all;
  user-select: text;
}

/* 通知 */
.notice-bar {
  position: fixed;
  z-index: 10;
  right: var(--space-5);
  bottom: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 420px;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-left: 4px solid var(--color-ink);
  border-radius: var(--radius);
  background: var(--color-paper);
  box-shadow: 0 6px 20px rgb(24 33 30 / 0.18);
  font-size: 13px;
}

.notice--error {
  border-left-color: var(--color-error);
}

.notice--warning {
  border-left-color: var(--color-warning);
}

.notice--info {
  border-left-color: var(--color-success);
}

.notice__close {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--color-ink-soft);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.crash-screen {
  display: grid;
  place-content: center;
  gap: var(--space-3);
  height: 100vh;
  text-align: center;
}

.crash-screen h1 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: normal;
}

/* 扫码条：备注快速切换 */
.note-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-paper);
}

.note-picker__label {
  font-weight: 600;
  white-space: nowrap;
}

.note-picker__select {
  max-width: 200px;
  height: 36px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: #fff;
  font: inherit;
  cursor: pointer;
}

/* 设置：常用备注 */
.note-presets {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-rule);
}

.note-presets__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.note-presets__item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--color-housing);
}

.note-presets__text {
  flex: 1;
  min-width: 0;
  white-space: pre-line;
  word-break: break-all;
}

.note-presets .button {
  align-self: flex-start;
}
```

- [ ] **Step 17: 创建 `src/renderer/src/main.tsx`**

> 替换 Task 10 的占位界面。

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reportError } from './lib/notices';
import './styles/tokens.css';
import './styles/app.css';

window.addEventListener('unhandledrejection', (event) => reportError('后台操作', event.reason));

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
```

- [ ] **Step 18: 执行**

Run: `bun run lint && bun run typecheck && bun test && bun run build`
Expected: 全部零错误、测试全部通过、构建成功。

- [ ] **Step 19: 界面验证（开发版）**

在开发机上验证界面。用 `bunx electron-vite dev -- --remote-debugging-port=9333` 启动，可以通过 CDP（`http://127.0.0.1:9333/json/list`）执行点击、截图；也可以手动操作。逐项检查并截图：

1. 标题栏：墨黑底，左侧是黄底「CDL」标识和得意黑「云签速印」；可以拖动窗口、双击最大化；三个窗口按钮有效；关闭后隐藏到托盘，点托盘恢复。
2. 没有扫码时，预览区用示例码展示当前模板，右上角标「示例 · 标准（二维码在左）」；缩放窗口时，预览按比例缩放。
3. 打印机页：列出本机打印机，搜索即时过滤；点选后标题栏胶囊显示该打印机（Windows 上还会显示「就绪」或离线原因）；重启后选择仍然保留。
4. 模板页：5 套内置模板带「内置」标签。点「复制」进入编辑器，改名称、开启备注，填入 `样衣间 {日期}` 并换行 `质检：陈大露`，「旁侧文字」对齐改成右：预览实时变化，角标显示「模板编辑中 · 未保存不会用于打印」。保存后右下角提示「模板「…」已保存」；点「使用」后，它显示「使用中」。
5. 扫码框：始终有焦点；点完开关、按钮、标签页后，300ms 内焦点回到扫码框；在记录搜索框输入后停 8 秒，焦点也会回来；在模板编辑器里输入不会被抢焦点。
6. 备注下拉框：
   - 在设置页「常用备注」里添加 `返修 {日期}`、`质检：陈大露`。
   - 扫码条「备注」下拉框依次列出：模板备注 / 不打印备注 / 返修 {日期} / 质检：陈大露 / 管理常用备注…
   - 选「返修 {日期}」：示例预览的备注变成「返修 2026-…」，位置和字号仍按模板；选完后焦点回到扫码框。
   - 切到「不打印备注」和有备注两种状态：编码、颜色、尺码的值在同一列上对齐，位置不变。
   - 在模板编辑器里把「旁侧文字」设为右对齐：前缀靠左成一列，值统一靠右。
   - 选「管理常用备注…」：侧栏切到设置页，下拉框保持原来的选择。
   - 重启后，选择仍然保留。
7. 输入 `CL5640-TK-图片色-XXL` 回车：预览从上方滑入，并使用刚启用的模板。
   - 没选打印机时，状态条是橙色「还没选打印机」，并有警告音。
   - 手动模式下，状态条显示「待打印」，按 F2 提交。
8. 输入 `hello` 回车：红色「二维码格式不对」，伴随长低音。
9. 打印记录页：显示记录和「n / 100,000」；超过 100 条后出现「加载更早的记录」；搜索 `XXL`、`图片色` 都能命中；「重打」在窗口期内显示「重复扫码，已拦截」，并提供「强制补打」（第一次点击变橙色「再点一次确认补打」，3 秒后复原）。
10. 设置页：
   - 把记录上限改成 50 并回车：输入框回显 1000。
   - 在记录数大于新上限时调小上限：出现删除确认条。
   - 「关于」显示 CDL-云签速印、版本号、陈大露（CDL）和数据目录。
   - 「打开日志目录」能打开 `logs/`。
11. 在 DevTools 执行 `console.error('x')`：`logs/main.log` 出现 `[renderer] x`。
12. 系统开启「减少动态效果」后，预览不再有滑入动画。

- [ ] **Step 20: Commit**

```bash
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/components/ScanBar.tsx src/renderer/src/components/ConfirmButton.tsx src/renderer/src/components/Ruler.tsx src/renderer/src/components/PreviewStage.tsx src/renderer/src/components/SidePanel.tsx src/renderer/src/components/PrinterList.tsx src/renderer/src/components/JobLog.tsx src/renderer/src/components/form-controls.tsx src/renderer/src/components/TemplateEditor.tsx src/renderer/src/components/TemplatePanel.tsx src/renderer/src/components/SettingsForm.tsx src/renderer/src/components/NoticeBar.tsx src/renderer/src/components/ErrorBoundary.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css src/renderer/src/main.tsx
git commit -m "feat(ui): frameless scan station with ruler preview, template editor, printers and history"
```

---

### Task 13A: 安全加固：app:// 协议、全局 webContents 加固、主 frame 校验

**Files:**
- Create: `src/main/bundle-path.ts`, `src/main/bundle-path.test.ts`, `src/main/app-protocol.ts`, `src/main/security.ts`
- Modify: `src/main/window.ts`（安装版加载 `APP_ENTRY_URL`；窗口级 open/navigate 处理移到 security.ts），`src/main/ipc.ts`（`isTrusted`），`src/main/index.ts`（ready 前注册协议、`app.enableSandbox()`、`hardenAllWebContents()`；bootstrap 中 `denyAllPermissions()`、`handleAppScheme(join(__dirname, '../renderer'))`）

**Interfaces:**
- Produces: `APP_SCHEME = 'app'`、`APP_HOST = 'bundle'`、`APP_ENTRY_URL = 'app://bundle/index.html'`；`resolveBundlePath(rootDir: string, requestUrl: string): string | null`；`registerAppScheme(): void`（ready 前）；`handleAppScheme(rootDir: string): void`；`hardenAllWebContents(): void`（ready 前）；`denyAllPermissions(): void`。
- 纯函数 `bundle-path.ts` 与引用 `electron` 的 `app-protocol.ts` 分开：`bun test` 里无法导入 `electron` 的 `net`。

- [ ] **Step 1: 写失败的测试 `src/main/bundle-path.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { APP_ENTRY_URL, resolveBundlePath } from './bundle-path';

const ROOT = join('/opt', 'cdl', 'out', 'renderer');

describe('resolveBundlePath', () => {
  test('maps the entry page and assets inside the renderer bundle', () => {
    expect(resolveBundlePath(ROOT, APP_ENTRY_URL)).toBe(join(ROOT, 'index.html'));
    expect(resolveBundlePath(ROOT, 'app://bundle/assets/index-abc.js')).toBe(join(ROOT, 'assets', 'index-abc.js'));
    expect(resolveBundlePath(ROOT, 'app://bundle/assets/%E5%BE%97%E6%84%8F%E9%BB%91.woff2')).toBe(
      join(ROOT, 'assets', '得意黑.woff2'),
    );
  });

  test('rejects path traversal that survives URL parsing (encoded slashes)', () => {
    expect(resolveBundlePath(ROOT, 'app://bundle/..%2F..%2Fsecrets.txt')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/assets/..%2F..%2F..%2Fsecrets.txt')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/')).toBeNull();
  });

  test('dot segments are normalized by the URL parser and stay inside the bundle', () => {
    expect(resolveBundlePath(ROOT, 'app://bundle/%2e%2e/%2e%2e/secrets.txt')).toBe(join(ROOT, 'secrets.txt'));
    expect(resolveBundlePath(ROOT, 'app://bundle/../../secrets.txt')).toBe(join(ROOT, 'secrets.txt'));
  });

  test('rejects other hosts, schemes and malformed URLs', () => {
    expect(resolveBundlePath(ROOT, 'app://evil/index.html')).toBeNull();
    expect(resolveBundlePath(ROOT, 'file:///etc/passwd')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/%E0%A4%A')).toBeNull();
    expect(resolveBundlePath(ROOT, 'not a url')).toBeNull();
  });
});
```

Run: `bun test src/main/bundle-path.test.ts` → FAIL（模块不存在）。

- [ ] **Step 2: 实现 `src/main/bundle-path.ts`**

```ts
import { isAbsolute, join, normalize, relative } from 'node:path';

/**
 * 安装版的界面通过自定义协议 app://bundle/ 提供，而不是 file://（Electron 安全清单第 18 条）：
 * 页面拿不到 file:// 的额外特权，也只能读到渲染进程构建目录里的文件。
 */
export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** 把 app://bundle/<路径> 映射到 rootDir 内的文件；主机不对、路径越界或编码非法都返回 null。 */
export function resolveBundlePath(rootDir: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
      return null;
    }
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const target = normalize(join(rootDir, pathname));
  const relativePath = relative(rootDir, target);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }
  return target;
}
```

Run: `bun test src/main/bundle-path.test.ts` → PASS（4 个）。

- [ ] **Step 3: 实现 `src/main/app-protocol.ts` 与 `src/main/security.ts`**

```ts
// src/main/app-protocol.ts
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { APP_SCHEME, resolveBundlePath } from './bundle-path';

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** app ready 之后调用：只服务 rootDir（渲染进程构建目录）里的文件。 */
export function handleAppScheme(rootDir: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveBundlePath(rootDir, request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
```

```ts
// src/main/security.ts
import { app, session } from 'electron';

/**
 * 对所有 webContents（主窗口、打印窗口，以及将来新增的任何窗口）统一收紧：
 * 禁止打开新窗口、禁止页面内导航、禁止挂载 <webview>。必须在 app ready 之前调用。
 */
export function hardenAllWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** 本应用不需要任何网页权限（摄像头、通知、剪贴板读取……）：请求和检查一律拒绝。 */
export function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}
```

- [ ] **Step 4: 接入 window / ipc / index**

- `window.ts`：`loadURL(!app.isPackaged && devServerUrl ? devServerUrl : APP_ENTRY_URL)`，删除窗口级的 `setWindowOpenHandler` / `will-navigate`。
- `ipc.ts`：
  ```ts
  const isTrusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    event.sender === deps.getWindow()?.webContents && event.senderFrame === event.sender.mainFrame;
  ```
- `index.ts`：在 `app.setPath('userData', …)` 之后、ready 之前依次调用 `registerAppScheme()`、`app.enableSandbox()`、`hardenAllWebContents()`，并在安装版中 `Menu.setApplicationMenu(null)`；`bootstrap()` 开头调用 `denyAllPermissions()` 和 `handleAppScheme(join(__dirname, '../renderer'))`。
- `electron-builder.yml` 的 fuses 增加 `grantFileProtocolExtraPrivileges: false`（Task 14）。

- [ ] **Step 5: 验证并提交**

Run: `bun run check && bun run build` → 全部通过。
```bash
git add src/main
git commit -m "security: serve UI over app:// and harden every webContents"
```

---

### Task 13B: 自动更新（electron-updater + GitHub Releases）

**Files:**
- Create: `src/shared/update-status.ts`, `src/main/updater.ts`, `src/renderer/src/lib/update-text.ts`, `src/renderer/src/lib/update-text.test.ts`, `src/renderer/src/view-models/use-update-status.ts`
- Modify: `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/renderer/src/App.tsx`, `TitleBar.tsx`, `SettingsForm.tsx`, `app.css`, `package.json`（依赖 `electron-updater`）

**Interfaces:**
- `UpdateStatus = { state: 'disabled' } | { state: 'idle' } | { state: 'checking' } | { state: 'up-to-date'; checkedAt: number } | { state: 'downloading'; version: string; percent: number } | { state: 'ready'; version: string } | { state: 'error'; message: string }`
- `class AppUpdater({ onStatus(status), onBeforeInstall() })`：`start()`（只在安装版启用；`autoDownload`、`autoInstallOnAppQuit`；启动 15 秒后检查，之后每 4 小时一次）、`check()`、`install()`（先 `onBeforeInstall()` 把 `isQuitting` 置真，否则关窗会被拦成隐藏到托盘，再 `quitAndInstall()`）、`current`。
- IPC：`update:status`（invoke）、`update:check`（invoke）、`update:install`（invoke）、`update:status-changed`（主进程推送）。preload 用 `subscribe<T>(channel, listener)`，不把 `IpcRendererEvent` 暴露给页面。
- `describeUpdate(status): { text: string; canCheck: boolean; isReady: boolean }`。
- 界面：标题栏在 `ready` 时出现「重启更新 vX」胶囊（ConfirmButton，二次确认）；设置页「关于」显示更新状态和「检查更新」。

- [ ] **Step 1: 写失败的测试 `update-text.test.ts`**（3 个）：开发版（disabled）永远不检查；只有 idle、up-to-date、error 允许手动检查；显示下载进度和 ready 的版本号。
- [ ] **Step 2: 实现 `update-status.ts`、`update-text.ts`**，测试通过。
- [ ] **Step 3: 实现 `updater.ts` 并接入 IPC、preload、`index.ts`、TitleBar、SettingsForm。**
- [ ] **Step 4: 验证并提交**

Run: `bun run check && bun run build`
```bash
git add package.json bun.lock src
git commit -m "feat: background auto-update from GitHub Releases"
```

---

### Task 13C: 语音确认播报（msedge-tts + 本地缓存 + 可调语速）

**Files:**
- Create: `src/shared/voice.ts`, `src/main/voice/voice-clips.ts`, `src/main/voice/voice-clips.test.ts`, `src/main/voice/edge-synthesizer.ts`, `src/renderer/src/lib/feedback-cues.ts`, `src/renderer/src/lib/voice-player.ts`, `src/renderer/src/lib/voice.test.ts`, `src/renderer/src/view-models/use-feedback.ts`, `src/renderer/src/components/VoiceSettingsSection.tsx`
- Modify: `src/shared/settings.ts`（+ 测试）、`src/main/ipc-validators.ts`（+ 测试）、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/main/ipc.ts`、`src/main/index.ts`、`use-scan-station.ts`、`App.tsx`、`SettingsForm.tsx`、`app.css`、`index.html`（CSP `media-src 'self' blob:`）、`package.json`（依赖 `msedge-tts`）

**Interfaces:**
- `VOICE_CUES = ['printed','duplicate','failed','invalid','noPrinter','scanned']`，文本依次为 打印成功 / 重复扫码 / 打印失败 / 格式错误 / 请选择打印机 / 已扫描。
- `VOICE_NAMES`：`zh-CN-XiaoxiaoNeural`（默认）、`zh-CN-YunxiNeural`、`zh-CN-XiaoyiNeural`；`VOICE_RATE_RANGE = { min: -50, max: 100, step: 10 }`；`VoiceSettings { enabled; name; ratePercent }`；`isVoiceName`、`isVoiceCue`、`toProsodyRate(20) === '+20%'`。
- `Settings.voice` 默认 `{ enabled: true, name: 'zh-CN-XiaoxiaoNeural', ratePercent: 0 }`；`sanitizeVoice` 把语速夹到范围内并吸附到 10% 步长。
- `class VoiceClips(cacheDir, synthesize: (text, voice, ratePercent) => Promise<Uint8Array>)`：
  - `get(cue, { voice, ratePercent }): Promise<Uint8Array | null>`：文件名 `sha256(voice|rate|text).mp3`；先写临时文件再 rename；同一 key 并发只合成一次；失败返回 null（界面退回提示音）。
  - `warm(key)`：后台合成全部短语。启动时和语音设置变化时调用。
- `synthesizeWithEdge(text, voice, ratePercent)`：`OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3`，20 秒超时，结束后 `close()`。
- IPC `voice:clip`（invoke，参数经 `requireVoiceCue` 校验；音色和语速取主进程当前设置，不信任页面传入）。
- 渲染层：`describeFeedback(event) → { cue, tone }`；`VoicePlayer({ fetchClip, createUrl, play }).play(cue, settings): Promise<boolean>`，按 `音色|语速|cue` 缓存 Blob URL；`useFeedback(voice) → { announce(event), preview() }`，语音失败时 `playFeedback(tone)`。

- [ ] **Step 1: 写失败的测试**
  - `voice-clips.test.ts`（5 个）：只合成一次，之后离线也能从缓存文件播放；每种音色和语速各有一份缓存；同一段的并发请求合并；离线且无缓存时返回 null，也不写入缓存；`warm` 对每个短语只合成一次。
  - `voice.test.ts`（4 个）：每种结果映射到固定短语和兜底提示音；同一音色、语速、短语只取一次，之后从内存重放；取不到时返回 false，调用方退回提示音；之前取不到的短语下次会重试。
  - `settings.test.ts`：语速吸附与夹取、非法音色回退默认。
  - `ipc-validators.test.ts`：`requireVoiceCue` 拒绝未知 cue。
- [ ] **Step 2: 实现 shared / main / renderer 代码**，测试通过。
- [ ] **Step 3: 接入扫码流程**：`useScanStation({ announce })`，事件 no-printer、internal-error、result、invalid，以及手动模式下的 scanned。
- [ ] **Step 4: 设置页 `VoiceSettingsSection`**：开关、音色下拉（类名 `voice-settings__select`，避免与备注下拉冲突）、语速滑块（标签「正常 / 快 20% / 慢 10%」）、「试听」按钮。
- [ ] **Step 5: 验证并提交**

Run: `bun run check && bun run build`；再用 `bun run dev` 启动一次，确认 `<userData>/voice-cache/` 下生成 6 个 mp3（msedge-tts 在 Bun 的 WebSocket 下 TLS 握手失败，所以真实合成只在 Electron 里验证，单元测试注入假合成器）。
```bash
git add package.json bun.lock src
git commit -m "feat: cached voice confirmation after scan and print"
```

---

### Task 13D: 打印机异常系统通知

**Files:**
- Create: `src/main/printing/alert-throttle.ts`, `src/main/printing/alert-throttle.test.ts`, `src/main/printing/printer-alerts.ts`
- Modify: `src/main/printing/printer-status.ts`（+ 测试），`src/main/index.ts`

**Interfaces:**
- `ALERT_COOLDOWN_MS = 30 * 60_000`，`MAX_ALERTS_PER_KIND_PER_DAY = 2`；`AlertThrottle(clock).shouldNotify(kind: string): boolean`（按本地日期计数）。
- `type NotReadyListener = (printerName: string, detail: string) => void`；`new PrinterStatusMonitor(probe, onNotReady = () => {}, intervalMs)`：打印机从「可用 / 未知」变为不能打印，或者原因变化时触发。
- `createPrinterAlertNotifier(throttle, onClick): NotReadyListener`：系统通知「打印机需要处理：{原因}」，点击后回到主窗口。

- [ ] **Step 1: 写失败的测试**
  - `alert-throttle.test.ts`：30 分钟内同类只提醒一次；不同类互不影响；每天最多 2 次；跨天重新计数。
  - `printer-status.test.ts`：连续轮询 就绪 → 缺纸 → 缺纸 → 卡纸 → 就绪 → 缺纸，通知序列为 `['A:缺纸', 'A:卡纸', 'A:缺纸']`。
- [ ] **Step 2: 实现并接入 `index.ts`**：`new PrinterStatusMonitor(queryPrinterReadiness, createPrinterAlertNotifier(new AlertThrottle(systemClock), showMainWindow))`。
- [ ] **Step 3: 验证并提交**

Run: `bun run check`
```bash
git add src/main
git commit -m "feat: throttled system notification when the printer needs attention"
```

---

### Task 13E: 端到端测试（Playwright + Electron）

**Files:**
- Create: `playwright.config.ts`, `e2e/tsconfig.json`, `e2e/app.e2e.ts`
- Modify: `package.json`（devDependency `@playwright/test`；`typecheck` 加 `e2e/tsconfig.json`；`"test:e2e": "electron-vite build && playwright test"`），`biome.json`（如需），`.gitignore`（`test-results/`、`playwright-report/`），`src/main/index.ts`（未打包时允许 `CDL_LABELFLASH_USER_DATA` 覆盖数据目录，安装版忽略）

**Interfaces:**
- `playwright.config.ts`：`testDir: 'e2e'`，`testMatch: '**/*.e2e.ts'`，`timeout: 60_000`，`workers: 1`，reporter `list`。
- 启动辅助：`_electron.launch({ args: [out/main/index.js], env })`。env 取 `process.env` 中非 `undefined` 的值，去掉 `ELECTRON_RENDERER_URL`（界面必须走 `app://`），再加上指向临时目录的 `CDL_LABELFLASH_USER_DATA`；每个用例前后创建、删除这个临时目录。

- [ ] **Step 1: 写 3 个用例**
  1. 界面从 `app://bundle/index.html` 加载，标题为「CDL-云签速印」。扫 `CL5640-TK-图片色-XXL` 后状态条显示「还没选打印机」，预览的编码为 `CL5640-TK`、尺码为 `XXL`。扫 `hello` 显示「二维码格式不对」。
  2. 复制模板，命名为「E2E 模板」，保存并使用；添加常用备注「E2E 备注 {日期}」，在备注下拉框（`getByRole('combobox', { name: '备注' })`）选中它，焦点回到扫码框。重启后模板仍是「使用中」，下拉框仍选中该备注，预览里出现备注。
  3. 页面中 `require`、`process` 都是 `undefined`，只有 `api`；`window.open` 返回 null，窗口数仍为 1。
- [ ] **Step 2: 运行**

Run: `bun run test:e2e` → 3 passed。

- [ ] **Step 3: 提交**

```bash
git add playwright.config.ts e2e package.json bun.lock tsconfig.json .gitignore src/main/index.ts
git commit -m "test: Playwright end-to-end tests against the built Electron app"
```

---

### Task 14: 打包、CI、README、Windows 验收、推送与 PR

**Files:**
- Create: `electron-builder.yml`, `resources/installer.nsh`, `.github/workflows/ci.yml`, `README.md`, `docs/windows-acceptance.md`

- [ ] **Step 1: 创建 `electron-builder.yml`**

已在 macOS 上用 `--mac dir` 验证过：Bun 的依赖收集能正确打包全部运行时依赖；fuses 生效；字体许可证进入 `resources/licenses/`。

```yaml
appId: com.cdl.labelflash
productName: CDL-云签速印
copyright: Copyright © 2026 CDL
directories:
  buildResources: resources
  output: dist
files:
  - out/**
  - resources/**
  - "!resources/*.svg"
  - "!resources/installer.nsh"
  - package.json
asarUnpack:
  - resources/**
extraResources:
  - from: src/renderer/src/assets/fonts/SmileySans-OFL.txt
    to: licenses/SmileySans-OFL.txt
# 只保留中文和英文的 Chromium 语言包，安装包更小。
electronLanguages:
  - zh-CN
  - en-US
# 没有第三方原生模块（SQLite 是 Electron 内置的 node:sqlite），不需要重新编译。
npmRebuild: false
electronFuses:
  runAsNode: false
  enableCookieEncryption: true
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
  # 界面通过 app:// 自定义协议加载，不需要 file:// 的额外特权。
  grantFileProtocolExtraPrivileges: false
# 自动更新：electron-updater 从 GitHub Releases 读取 latest.yml。只有 CI 在打 v* 标签时才发布（--publish always）。
publish:
  provider: github
  owner: HeiSir2014
  repo: LabelFlash
  releaseType: release
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: resources/icon.png
  executableName: CDL-LabelFlash
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
  shortcutName: CDL-云签速印
  uninstallDisplayName: CDL-云签速印
  artifactName: CDL-LabelFlash-Setup-${version}.${ext}
  installerLanguages:
    - zh_CN
  include: resources/installer.nsh
```

- [ ] **Step 2: 创建 `resources/installer.nsh`**（卸载时删除开机自启项）

```nsis
; 卸载时删除开机自启项（值名与 app.setLoginItemSettings 的 name 一致：appId）。
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cdl.labelflash"
!macroend
```

- [ ] **Step 3: 创建 `.github/workflows/ci.yml`**

在 Windows 上执行 lint + 类型检查 + 单元测试 + E2E。非标签构建打包并上传安装包；推送 `v*` 标签时，由 electron-builder 把安装包、`latest.yml` 和 blockmap 发布到 Release，供 electron-updater 自动更新。

```yaml
name: CI

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run check
      - name: End-to-end tests (Playwright + Electron)
        run: bun run test:e2e

  package:
    needs: check
    if: ${{ !startsWith(github.ref, 'refs/tags/v') }}
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run dist:win
      - uses: actions/upload-artifact@v4
        with:
          name: CDL-LabelFlash-windows
          path: dist/*.exe
          if-no-files-found: error

  # 打 v* 标签时发布：electron-builder 上传安装包、latest.yml 和 blockmap，electron-updater 据此自动更新。
  release:
    needs: check
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run release:win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: 创建 `README.md`**

````markdown
# CDL-云签速印（LabelFlash）

CDL 出品的样衣标签重打工具。用扫码枪扫描样衣标签上的二维码（`编码-颜色-尺码`，例如 `CL5640-TK-图片色-XL`），软件会立即按模板生成 60×40mm 标签的预览，并在选中的本机打印机上打印。

## 功能

- **扫码即打**：扫码后自动预览、自动打印；也可以切换成手动模式，预览确认后按 F2 打印。
- **防重复打印**：同一张标签在设定时间内（默认 10 分钟）只打印一次。重启软件后这个时间窗口依然有效。需要再打一张时，可以用"强制补打"。
- **打印模板**：
  - 内置 5 套 60×40mm 模板。
  - 可以复制成自定义模板后自由调整：二维码的位置、尺寸和容错等级，每个字段的显示、前缀、字号和加粗，按区域统一的对齐方式，以及备注文字。
  - 备注可以放在二维码旁的空白处或底部，支持 `{日期}`、`{时间}`、`{编码}` 等变量。
  - 扫码框旁的「备注」下拉框可以一键切换常用备注。
- **打印记录**：
  - 可以回看任意一条记录的预览，也可以重打。
  - 记录按环形方式保留，默认最多 10 万条，超出后自动删除最早的记录。
  - 支持按编码、颜色、尺码全文搜索。
- **打印机**：本机打印机再多，也可以搜索后选择。选择会保存下来。软件会检测打印机是否离线、缺纸或卡纸。
- **无边框窗口**：关闭窗口时最小化到托盘，并支持开机自启。
- **语音确认**：扫码、打印后播报固定短语（打印成功、重复扫码……），音色和语速可调；音频缓存在本机，播放无延迟。
- **打印机异常提醒**：离线、缺纸、卡纸时弹出系统通知；同类问题 30 分钟内不重复，每天最多 2 次。
- **自动更新**：从 GitHub Releases 后台下载新版本，标题栏提示后重启即可更新；也可以在设置页手动检查。

## 数据与日志

所有数据都保存在 `%LOCALAPPDATA%\CDL-LabelFlash\`：

| 路径 | 内容 |
|---|---|
| `labelflash.db` | SQLite 数据库（Electron 内置 `node:sqlite`），包含设置、自定义模板和打印记录 |
| `logs\main.log` | 运行日志，超过 5MB 自动轮转。遇到问题时，把这个文件发给维护人员 |
| `voice-cache\` | 语音播报的 mp3 缓存，可随时删除，下次会重新生成 |

## 扫码枪设置

扫码枪需要能输出中文（二维码里有"图片色"之类的中文）。请按扫码枪说明书扫描"中文输出 / Windows Unicode"设置码，并把 Windows 输入法切换到英文状态。

## 开发

需要 [Bun](https://bun.sh) 1.4 或更高版本。

```bash
bun install
bun run dev        # 启动开发版
bun run check      # lint + 类型检查 + 单元测试
bun run test:e2e   # 构建后用 Playwright 启动 Electron 跑端到端测试
bun run icons      # 修改 resources/*.svg 后重新生成图标
bun run dist:win   # 在 Windows 上打 NSIS 安装包，输出到 dist/
```

GitHub Actions 在 Windows 上运行：

- 推送到 `main` 或提交 PR：执行检查和 E2E 测试，并上传安装包产物。
- 推送 `v*` 标签：electron-builder 把安装包和 `latest.yml` 发布到 GitHub Release，已安装的客户端会自动更新。

发布新版本：

1. 修改 `package.json` 里的 `version`。
2. 提交后打标签，例如 `git tag v0.2.0 && git push --tags`。

## 目录结构

```
src/core       业务层（纯 TypeScript，不依赖 Electron）：解析、防重门限、打印队列、模板、PrintService
src/shared     主进程与界面共用：IPC 契约、设置、常量
src/main       Electron 主进程：app:// 协议、安全加固、SQLite 存储、打印适配器、打印机状态与异常通知、语音缓存、IPC、窗口、托盘、日志、自动更新
src/preload    contextBridge
src/renderer   界面（React，MVVM：view-models + components）
e2e/           Playwright 端到端测试
docs/          设计文档、实施计划与路线图
```
````

- [ ] **Step 5: 本地全量检查**

Run: `bun run check && bun run test:e2e`
Expected: Biome 无问题，三个 tsconfig 零错误，186 个单元测试和 3 个 E2E 全部通过，构建成功。

- [ ] **Step 6: Commit 并推送，确认 CI 通过**

```bash
git add electron-builder.yml resources/installer.nsh .github/workflows/ci.yml README.md
git commit -m "build: NSIS packaging, Windows CI and README"
git push -u origin feature/phase1-desktop-client
gh run watch --exit-status
```
Expected: `check`（含 E2E）和 `package` 两个 job 都成功，产物 `CDL-LabelFlash-windows` 里有 `CDL-LabelFlash-Setup-0.1.0.exe`；`release` job 只在 `v*` 标签时运行。

- [ ] **Step 7: Windows 真机验收**

从 CI 产物下载安装包，或者在 Windows 上执行 `bun install && bun run dist:win`。可以用 xremote 远程操作。把每一项的结果（通过 / 未通过，以及具体现象）记到 `docs/windows-acceptance.md`：

1. **安装**：安装包未签名，SmartScreen 需要点「仍要运行」。可以选择安装目录；桌面快捷方式名是「CDL-云签速印」。启动后，`%LOCALAPPDATA%\CDL-LabelFlash\labelflash.db` 和 `logs\main.log` 都会被创建。
2. **打印机**：列表显示本机全部打印机。用搜索框能按名称过滤到目标热敏标签机；选中后，胶囊显示「就绪」。
3. **持久化**：选择打印机、切换模板、关闭自动打印，然后从托盘退出，再重新启动，所有选择都保留。
4. **测试页与版面**：打测试页，量一下是不是 60×40mm、有没有缩放或分页。如果有缩放，在「打印机属性 › 首选项」里把纸张设成 60×40mm，并把设置步骤写进记录。
5. **扫码枪中文**：扫原标签（`CL5640-TK-图片色-36`）。如果出现乱码或格式错误，按说明书扫「中文输出 / Windows Unicode」设置码，并确认输入法是英文状态。把最终需要的设置写进记录。
6. **字母尺码**：用手动输入测试 `CL5640-TK-图片色-XL`、`…-XXL`、`…-均码`，都能正确解析并打印。
7. **自动打印**：扫码后预览出现并且出纸，状态条变绿「已发送打印」，有短高音；扫码到出纸不超过 2 秒。
8. **门限**：10 分钟内再扫同一张 → 橙色「重复扫码，已拦截」，不出纸。「强制补打」需要点两次才出纸，记录里显示「已补打」。
9. **重启后门限仍然有效**：打印一张 → 退出 → 重启 → 再扫同一张，依然被拦截。
10. **手动模式**：扫码只预览，按 F2 才出纸。窗口期内的码按 F2 会被拦截并提示。
11. **模板**：
    - 复制一套模板，改成二维码在右，加上备注 `样衣间 {日期}`，保存并使用。
    - 实际出纸和预览一致，备注在空白区，日期正确。
    - 删除这个正在使用的模板后，自动回到标准模板。
12. **快速切换备注**：在下拉框里切换常用备注，出纸的备注随之改变；选「不打印备注」时不出现备注。
13. **长编码**：打印一个接近 128 字符的码，底部完整编码被缩小，但没有被裁掉。
14. **打印机故障**：
    - 标签机缺纸、打开机盖或断开 USB 后扫码，记录状态条的实际表现：「打印机未就绪：…」，或者 30 秒后「打印机没有响应…可能已出纸」。
    - 恢复后用「重试打印」或「强制补打」能正常出纸。
15. **记录回溯**：「预览」「重打」都有效；搜索能找到第一页以外的记录；把上限调小时，先出现确认，确认后记录数下降。
16. **托盘与单实例**：关闭窗口后程序仍在托盘，第一次还会弹气泡提示；再次双击桌面图标，会唤起已经打开的窗口。
17. **快捷键**：Ctrl+R、Ctrl+Shift+I、Ctrl+加减号都不起作用，预览比例不变。
18. **开机自启**：打开开关，注销后重新登录，窗口自动打开并且可以直接扫码。
19. **关机不阻塞**：程序运行时关机或注销，不会出现「此应用阻止关机」。
20. **高 DPI**：在 125% 和 150% 缩放下，界面和托盘图标都清晰，预览比例正确。
21. **日志**：「打开日志目录」能打开 `logs\`，`main.log` 里有启动记录和打印失败记录。
22. **卸载**：卸载后，`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 里没有残留的 `com.cdl.labelflash`。
23. **语音**：联网首次启动后，`voice-cache\` 下生成 6 个 mp3。扫码、打印后播报对应短语；调节语速后「试听」生效。断网后已缓存的短语照常播报；没有缓存时退回提示音。
24. **异常通知**：标签机缺纸或断开后，弹出系统通知「打印机需要处理：…」，点击回到主窗口；30 分钟内同类问题不重复弹。
25. **自动更新**：发布一个更高版本的 `v*` 标签后，已安装的客户端在 15 秒到 4 小时内下载完成，标题栏出现「重启更新」，确认后完成升级，数据保留。
26. **驱动纸张**：
    - 先把驱动默认纸张设成非 60×40（例如出厂默认），打一张，记录是否缩放、跳纸或出空白；再设成 60×40、纸张类型设为间隙纸，打一张对比。结论决定路线图里「驱动纸张检测」的优先级。
    - 用 `Get-CimInstance Win32_PrinterConfiguration` 读出 `PaperWidth`、`PaperLength`（单位 0.1mm，期望 600、400）和 `HorizontalResolution`（203 或 300），并确认读到的是当前用户的默认值还是全局默认值。
27. **连续出纸**：驱动纸张为 60×40 时连续打印 20 张，没有累计偏移、空白或跳张；内容不旋转、不裁切。
28. **浓度与速度**：在驱动首选项里试几组浓度和速度组合，找出二维码清晰、不糊，手机和扫码枪在 5–20cm 距离内都能一次扫出的组合，写进记录。
29. **状态读数**：分别在缺纸、开盖、拔 USB 线时，记录 `Get-Printer`、`Get-PrintJob`、`Get-PnpDevice` 实际返回什么，作为路线图里任务跟踪和 USB 在位检测的依据。
30. **USB 与开机**：换一个 USB 口后是否生成新端口、打印机是否变成离线；打印机开机时是否先空走一张白纸。

- [ ] **Step 8: 修复验收问题**

验收中发现的问题，按 `superpowers:systematic-debugging` 定位修复，每个修复单独提交，并同步更新 `docs/windows-acceptance.md`。

- [ ] **Step 9: 提交验收记录并创建 PR**

```bash
git add docs/windows-acceptance.md
git commit -m "docs: Windows acceptance record for phase 1"
git push
gh pr create --base main --head feature/phase1-desktop-client \
  --title "CDL-云签速印 Phase 1：Windows 桌面客户端" \
  --body-file docs/windows-acceptance.md
```
PR 描述要写清楚：做了什么、为什么这样做、验收结论，以及未签名等已知限制。按 squash 方式合并。
