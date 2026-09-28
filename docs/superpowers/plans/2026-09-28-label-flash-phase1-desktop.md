# 云签速印 (LabelFlash) Phase 1 — Windows 桌面客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 Windows 桌面程序：扫码枪扫样衣标签二维码 → 立即预览 60×40mm 标签 → 自动或手动打印到选中的本机标签打印机。带时间窗口防重门限、可回溯重打的环形打印记录，以及无边框自绘窗口。

**Architecture:**
- `src/core` 是纯 TypeScript 业务层（解析、门限、队列、PrintService），不依赖 Electron，用 `bun test` 全覆盖。
- Electron 主进程提供三样东西：打印适配器（隐藏窗口渲染 HTML + `webContents.print` 静默打印）、`node:sqlite` 存储（Electron 内置 Node 24 自带）、IPC。
- React 渲染进程按 MVVM 组织：view-model hooks 调 `window.api`，组件只负责渲染。
- 预览和打印共用同一份标签 HTML。

**Tech Stack:** Bun 1.4、Electron 44（Node 24.21 / `node:sqlite` / SQLite 3.53.4）、electron-vite 5、Vite 7、React 19、TypeScript 5.9 strict、qrcode、electron-builder 26（NSIS）

## Global Constraints

- Spec：`docs/superpowers/specs/2026-09-28-label-flash-design.md`（Phase 1 范围）。
- 包名 `label-flash`，productName `云签速印`，appId `com.labelflash.app`，安装包名 `LabelFlash-Setup-${version}.exe`。
- 数据目录固定为 `%APPDATA%\LabelFlash`（`app.setPath('userData', …)`），数据库文件 `labelflash.db`：`node:sqlite` 的 `DatabaseSync`，WAL，`PRAGMA user_version` 迁移（只追加），打印记录和设置都存在里面。
- 二维码格式为 `编码-颜色-尺码`，从右往左拆；`raw` trim 后长度 1–128，不能含控制字符。
- 标签 60×40mm，与原标签版面一致，只是去掉库位；预览和打印使用同一个 `renderLabelHtml`。
- 门限窗口默认 10 分钟，范围 0–1440（0 表示关闭）；force 可以跳过窗口，但不能跳过正在打印的同一个码。
- 打印记录环形保留：`jobs` 表只留最新 N 条（默认 100,000，范围 1,000–1,000,000），插入和裁剪在同一个事务里完成；界面按页（每页 100 条）加载，搜索在 SQL 中进行。
- 自动打印默认开启；手动模式下按 F2 或点"打印"才出纸。
- 窗口无系统边框（`frame: false`），标题栏自绘；关闭按钮 = 隐藏到托盘；最小尺寸 960×640。
- 视觉 token：机壳灰 `#E4E7E2`、纸白 `#FBFBF8`、墨黑 `#18211E`、软尺黄 `#F2C12E`、成功 `#1F8A5B`、重复 `#E0752D`、失败 `#C8372D`；标题和大字状态用得意黑 Smiley Sans，正文用 Microsoft YaHei UI，数据用 Cascadia Mono / Consolas。
- 安全：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；IPC 参数在主进程校验；标签 HTML 中的所有文本都要转义。
- 不引入第三方原生模块：SQLite 直接用 Electron 内置的 `node:sqlite`；运行时依赖只有 `qrcode`。存储层接口是同步的（与 `DatabaseSync` 一致）。
- 用 Bun 做包管理和测试；每个任务结束时 `bun test`、`bun run typecheck` 都必须零错误。
- 代码风格：TS 用 camelCase / PascalCase / UPPER_SNAKE_CASE；不写魔法数字；界面文案用中文。

---

## File Structure

```
package.json / bunfig.toml / tsconfig.json / .gitignore
electron.vite.config.ts / electron-builder.yml
scripts/generate-icon.ts            生成 resources/icon.png
resources/icon.png
src/core/                           纯业务层（bun test）
  types.ts  errors.ts  label-parser.ts  dedup-guard.ts  serial-queue.ts
  print-queue.ts  job-store.ts  print-service.ts
  testing/fake-clock.ts  testing/fake-printer-adapter.ts  testing/in-memory-job-store.ts
src/shared/                         主进程与界面共用
  settings.ts  label-size.ts  ipc-contract.ts
src/main/
  index.ts  window.ts  tray.ts  ipc.ts
  printing/label-template.ts  printing/electron-driver-adapter.ts
  storage/database.ts  storage/migrations.ts  storage/row-readers.ts
  storage/sqlite-job-store.ts  storage/sqlite-settings-store.ts
src/preload/index.ts
src/renderer/
  index.html  tsconfig.json
  src/main.tsx  src/env.d.ts  src/App.tsx
  src/styles/tokens.css  src/styles/app.css
  src/assets/fonts/SmileySans-Oblique.woff2  src/assets/fonts/SmileySans-OFL.txt
  src/lib/        repeat-filter.ts  status-text.ts  list-filters.ts  feedback-sound.ts
  src/view-models/ use-settings.ts  use-printers.ts  use-job-log.ts  use-scan-station.ts
                   use-window-controls.ts  use-hotkey.ts
  src/components/ TitleBar.tsx  ScanBar.tsx  PreviewStage.tsx  Ruler.tsx  SidePanel.tsx
                  PrinterList.tsx  JobLog.tsx  SettingsForm.tsx
```

测试文件都和被测文件放在同一目录（`*.test.ts`）。

---

### Task 1: 工具链 + 核心类型 + 标签解析

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.json`, `.gitignore`
- Create: `src/core/types.ts`, `src/core/errors.ts`, `src/core/label-parser.ts`
- Test: `src/core/label-parser.test.ts`

**Interfaces:**
- Produces: `PRINT_SOURCES`、`PRINT_STATUSES`、`PRINT_FAILURE_REASONS`（常量数组，供数据库行校验）、`LabelData`, `PrintSource`, `PrintRequest`, `PrintFailureReason`, `PrintResult`, `PrintStatus`, `PreviewResult`, `PrinterInfo`, `PrinterAdapter`, `JobRecord`, `Clock`, `systemClock`（`src/core/types.ts`）；`PrintError`、`toFailureReason(error: unknown): PrintFailureReason`（`src/core/errors.ts`）；`MAX_RAW_LENGTH = 128`、`parseLabel(input: string): LabelData | null`（`src/core/label-parser.ts`）

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "label-flash",
  "productName": "云签速印",
  "version": "0.1.0",
  "description": "样衣标签扫码重打",
  "author": "LabelFlash",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/renderer/tsconfig.json",
    "test": "bun test",
    "icon": "bun scripts/generate-icon.ts",
    "dist:win": "electron-vite build && electron-builder --win --x64"
  },
  "dependencies": {
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
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
    "typescript": "^5.9.3",
    "vite": "^7.3.6"
  }
}
```

> electron-vite 5 的 peer 依赖是 `vite ^5 || ^6 || ^7`，所以固定用 Vite 7 和 plugin-react 5。Electron 44 已经没有 postinstall，二进制在第一次运行 `electron` 时才下载，所以不需要 `trustedDependencies`。不要加 `"type": "module"`：sandbox 下的 preload 必须是 CommonJS。

- [ ] **Step 2: 创建 `bunfig.toml`、`tsconfig.json`、`.gitignore`**

`bunfig.toml`:
```toml
[test]
root = "src"
```

`tsconfig.json`（覆盖 core / shared / main / preload / scripts；renderer 有独立的 tsconfig）：
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
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

`.gitignore`:
```
node_modules/
out/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: 安装依赖**

Run: `bun install`
Expected: 安装成功，生成 `bun.lock`。Bun 会提示 `Blocked 1 postinstall`（electron-winstaller 的，NSIS 打包用不到），忽略即可。

- [ ] **Step 4: 创建 `src/core/types.ts`**

```ts
export interface LabelData {
  /** 二维码原文（已 trim），同时作为门限的去重 key。 */
  raw: string;
  code: string;
  color: string;
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

export const PRINT_FAILURE_REASONS = ['PRINTER_NOT_FOUND', 'PRINT_TIMEOUT', 'PRINT_ERROR'] as const;
export type PrintFailureReason = (typeof PRINT_FAILURE_REASONS)[number];

export type PrintResult =
  | { status: 'printed'; jobId: string; label: LabelData }
  | { status: 'duplicate'; lastPrintedAt: number; windowMs: number }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' }
  | { status: 'failed'; reason: PrintFailureReason };

export type PrintStatus = PrintResult['status'];
export const PRINT_STATUSES = ['printed', 'duplicate', 'invalid', 'failed'] as const satisfies readonly PrintStatus[];

export type PreviewResult =
  | { status: 'ok'; label: LabelData; lastPrintedAt: number | null }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' };

export interface PrinterInfo {
  name: string;
  displayName: string;
}

export interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  print(printerName: string, label: LabelData): Promise<void>;
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

- [ ] **Step 5: 创建 `src/core/errors.ts`**

```ts
import type { PrintFailureReason } from './types';

export class PrintError extends Error {
  readonly reason: PrintFailureReason;

  constructor(reason: PrintFailureReason, message: string = reason) {
    super(message);
    this.name = 'PrintError';
    this.reason = reason;
  }
}

export function toFailureReason(error: unknown): PrintFailureReason {
  return error instanceof PrintError ? error.reason : 'PRINT_ERROR';
}
```

- [ ] **Step 6: 写失败的测试 `src/core/label-parser.test.ts`**

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

- [ ] **Step 7: 运行测试，确认失败**

Run: `bun test src/core/label-parser.test.ts`
Expected: FAIL，报错 `Cannot find module './label-parser'`

- [ ] **Step 8: 实现 `src/core/label-parser.ts`**

```ts
import type { LabelData } from './types';

export const MAX_RAW_LENGTH = 128;

/** 编码本身可能含 "-"：贪婪匹配编码，最后两段固定为颜色和尺码。 */
const LABEL_PATTERN = /^(.+)-([^-]+)-([^-]+)$/;
// eslint-disable-next-line no-control-regex
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

- [ ] **Step 9: 运行测试和类型检查**

Run: `bun test src/core/label-parser.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: 所有测试 pass（14 pass, 0 fail），tsc 无输出。

> 这时 `src/renderer/tsconfig.json` 还没创建，所以本任务只跑根 tsconfig；`bun run typecheck` 从 Task 9 开始可用。

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock bunfig.toml tsconfig.json .gitignore src/core
git commit -m "feat(core): toolchain, domain types and label parser"
```

---

### Task 2: DedupGuard 时间窗口门限

**Files:**
- Create: `src/core/dedup-guard.ts`, `src/core/testing/fake-clock.ts`
- Test: `src/core/dedup-guard.test.ts`

**Interfaces:**
- Consumes: `Clock`（Task 1）
- Produces:
  - `MAX_DEDUP_WINDOW_MS = 86_400_000`
  - `type Reservation = { ok: true } | { ok: false; since: number }`
  - `class DedupGuard(clock: Clock, windowMs: number)`，成员如下：
    - `windowMs: number`（getter）
    - `setWindowMs(ms)`
    - `peek(key): number | null`
    - `tryReserve(key, force: boolean): Reservation`
    - `commit(key)`、`release(key)`、`restore(key, printedAt)`
  - `FakeClock`、`FAKE_CLOCK_START`

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
const KEY = 'CL5640-TK-图片色-36';

describe('DedupGuard', () => {
  let clock: FakeClock;
  let guard: DedupGuard;

  beforeEach(() => {
    clock = new FakeClock();
    guard = new DedupGuard(clock, WINDOW_MS);
  });

  test('allows the first reservation', () => {
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('blocks a second reservation while the first is still printing', () => {
    const reservedAt = clock.now();
    guard.tryReserve(KEY, false);
    clock.advance(500);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, since: reservedAt });
  });

  test('force does not bypass a print that is still in flight', () => {
    guard.tryReserve(KEY, false);
    expect(guard.tryReserve(KEY, true).ok).toBe(false);
  });

  test('blocks inside the window after a successful print', () => {
    guard.tryReserve(KEY, false);
    clock.advance(1_000);
    const printedAt = clock.now();
    guard.commit(KEY);
    clock.advance(WINDOW_MS - 1);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, since: printedAt });
  });

  test('allows again once the window has passed', () => {
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    clock.advance(WINDOW_MS);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('release after a failed print allows an immediate retry', () => {
    guard.tryReserve(KEY, false);
    guard.release(KEY);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('force bypasses the window after a successful print', () => {
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    expect(guard.tryReserve(KEY, true)).toEqual({ ok: true });
  });

  test('a zero window turns the threshold off', () => {
    guard.setWindowMs(0);
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('clamps the window to the supported range', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS * 2);
    expect(guard.windowMs).toBe(MAX_DEDUP_WINDOW_MS);
    guard.setWindowMs(-1);
    expect(guard.windowMs).toBe(0);
  });

  test('peek reports a print inside the window', () => {
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    const printedAt = clock.now();
    clock.advance(1_000);
    expect(guard.peek(KEY)).toBe(printedAt);
  });

  test('peek does not reserve', () => {
    expect(guard.peek(KEY)).toBeNull();
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('restore seeds the window after a restart', () => {
    const printedAt = clock.now() - 60_000;
    guard.restore(KEY, printedAt);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, since: printedAt });
  });

  test('restore keeps the latest timestamp', () => {
    const latest = clock.now() - 1_000;
    guard.restore(KEY, latest);
    guard.restore(KEY, latest - 5_000);
    expect(guard.peek(KEY)).toBe(latest);
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/core/dedup-guard.test.ts`
Expected: FAIL，`Cannot find module './dedup-guard'`

- [ ] **Step 4: 实现 `src/core/dedup-guard.ts`**

```ts
import type { Clock } from './types';

export const MAX_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type Reservation = { ok: true } | { ok: false; since: number };

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

  /** 只读：正在打印返回占位时间；窗口内打印过返回打印时间；否则返回 null。 */
  peek(key: string): number | null {
    const reserved = this.reservedAt.get(key);
    if (reserved !== undefined) {
      return reserved;
    }
    const printed = this.printedAt.get(key);
    if (printed !== undefined && this.clock.now() - printed < this.currentWindowMs) {
      return printed;
    }
    return null;
  }

  tryReserve(key: string, force: boolean): Reservation {
    const reserved = this.reservedAt.get(key);
    if (reserved !== undefined) {
      return { ok: false, since: reserved };
    }
    if (!force) {
      const since = this.peek(key);
      if (since !== null) {
        return { ok: false, since };
      }
    }
    this.reservedAt.set(key, this.clock.now());
    return { ok: true };
  }

  commit(key: string): void {
    this.reservedAt.delete(key);
    this.printedAt.set(key, this.clock.now());
    this.pruneExpired();
  }

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

- [ ] **Step 5: 运行测试**

Run: `bun test src/core/dedup-guard.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: 13 pass, 0 fail；tsc 无输出。

- [ ] **Step 6: Commit**

```bash
git add src/core/dedup-guard.ts src/core/dedup-guard.test.ts src/core/testing/fake-clock.ts
git commit -m "feat(core): time-window dedup guard for repeat scans"
```

---

### Task 3: SerialQueue + PrintQueue

**Files:**
- Create: `src/core/serial-queue.ts`, `src/core/print-queue.ts`
- Test: `src/core/print-queue.test.ts`

**Interfaces:**
- Consumes: `PrintError`（Task 1）
- Produces: `class SerialQueue { run<T>(task: () => Promise<T>): Promise<T> }`；`class PrintQueue(timeoutMs: number) { enqueue<T>(printerName: string, task: () => Promise<T>): Promise<T> }`（超时时 reject `PrintError('PRINT_TIMEOUT')`）

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

  test('rejects with PRINT_TIMEOUT when a job hangs', async () => {
    const queue = new PrintQueue(20);
    const error = await queue.enqueue('P1', () => new Promise<void>(() => {})).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrintError);
    expect((error as PrintError).reason).toBe('PRINT_TIMEOUT');
  });

  test('a failed or hung job does not block the next one', async () => {
    const queue = new PrintQueue(20);
    const hung = queue.enqueue('P1', () => new Promise<void>(() => {})).catch(() => 'hung');
    const failed = queue.enqueue('P1', async () => {
      throw new Error('paper jam');
    }).catch(() => 'failed');
    const next = queue.enqueue('P1', async () => 'ok');
    expect(await Promise.all([hung, failed, next])).toEqual(['hung', 'failed', 'ok']);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/core/print-queue.test.ts`
Expected: FAIL，`Cannot find module './print-queue'`

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

/** 每台打印机一个串行队列；不同打印机之间可以并行。 */
export class PrintQueue {
  private readonly queues = new Map<string, SerialQueue>();

  constructor(private readonly timeoutMs: number) {}

  enqueue<T>(printerName: string, task: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(printerName);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(printerName, queue);
    }
    return queue.run(() => withTimeout(task(), this.timeoutMs));
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrintError('PRINT_TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 5: 运行测试**

Run: `bun test src/core/print-queue.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: 4 pass, 0 fail；tsc 无输出。

- [ ] **Step 6: Commit**

```bash
git add src/core/serial-queue.ts src/core/print-queue.ts src/core/print-queue.test.ts
git commit -m "feat(core): per-printer serial print queue with timeout"
```

---

### Task 4: SQLite 数据库（node:sqlite + 迁移 + 事务）

**Files:**
- Create: `src/main/storage/database.ts`, `src/main/storage/migrations.ts`, `src/main/storage/row-readers.ts`
- Test: `src/main/storage/database.test.ts`

**Interfaces:**
- Produces：
  - `openDatabase(path: string): DatabaseSync`：自动建目录、设置 pragma、执行迁移；`':memory:'` 也可以用
  - `migrate(db, migrations?: readonly string[]): void`
  - `runInTransaction<T>(db, work: () => T): T`
  - `MIGRATIONS: readonly string[]`
  - `Row = Record<string, unknown>`
  - 行读取函数：`readString(row, column)`、`readInteger(row, column)`、`readEnum(row, column, allowed)`

> `node:sqlite` 是 Electron 44 内置 Node 24.21 自带的模块（SQLite 3.53.4）；Bun 1.4 也实现了它，两边行为一致（命名参数、STRICT、CHECK、`user_version` 都已验证）。所以存储层可以直接用 `bun test` 测，生产环境也是同一套 API。

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
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row['name']));
}

describe('openDatabase', () => {
  test('migrates a fresh database to the latest schema', () => {
    const db = openDatabase(':memory:');
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).toEqual(['jobs', 'settings']);
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
Expected: FAIL，`Cannot find module './database'`

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
    failure_reason TEXT             CHECK (failure_reason IN ('PRINTER_NOT_FOUND', 'PRINT_TIMEOUT', 'PRINT_ERROR'))
  ) STRICT;

  CREATE INDEX jobs_printed_at ON jobs (created_at) WHERE status = 'printed';

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

- [ ] **Step 6: 运行测试**

Run: `bun test src/main/storage && bunx tsc --noEmit -p tsconfig.json`
Expected: 5 pass, 0 fail；tsc 无输出。

- [ ] **Step 7: Commit**

```bash
git add src/main/storage
git commit -m "feat(storage): node:sqlite database with WAL, versioned migrations and transactions"
```

---

### Task 5: JobStore 接口 + PrintService

**Files:**
- Create: `src/core/job-store.ts`, `src/core/print-service.ts`
- Create: `src/core/testing/fake-printer-adapter.ts`, `src/core/testing/in-memory-job-store.ts`
- Test: `src/core/print-service.test.ts`

**Interfaces:**
- Consumes：
  - `parseLabel`、`MAX_RAW_LENGTH`（Task 1）
  - `DedupGuard`、`MAX_DEDUP_WINDOW_MS`（Task 2）
  - `PrintQueue`（Task 3）
  - `toFailureReason`（Task 1）
- Produces：
  - `interface JobStore`（同步，因为 `DatabaseSync` 是同步的）：
    - `append(job): void`
    - `listLastPrinted(since): LastPrinted[]`
    - `setCapacity(capacity): void`
  - `LastPrinted = { raw: string; printedAt: number }`
  - `TEST_LABEL`
  - `class PrintService(deps: PrintServiceDeps)`：
    - `restore(): void`
    - `preview(raw): PreviewResult`
    - `submit(request): Promise<PrintResult>`
    - `printTest(printerName): Promise<PrintResult>`
  - 测试替身：`FakePrinterAdapter`、`InMemoryJobStore`（额外提供 `listRecent(limit)` 供断言）

- [ ] **Step 1: 创建 `src/core/job-store.ts`**

```ts
import type { JobRecord } from './types';

export interface LastPrinted {
  raw: string;
  printedAt: number;
}

/** 打印记录。实现必须是环形保留：只保留最新的 capacity 条。 */
export interface JobStore {
  append(job: JobRecord): void;
  /** since 之后每个码最后一次成功打印的时间，用于重启后恢复门限。 */
  listLastPrinted(since: number): LastPrinted[];
  setCapacity(capacity: number): void;
}
```

- [ ] **Step 2: 创建测试替身**

`src/core/testing/in-memory-job-store.ts`:
```ts
import type { JobStore, LastPrinted } from '../job-store';
import type { JobRecord } from '../types';

const DEFAULT_CAPACITY = 100;

export class InMemoryJobStore implements JobStore {
  private jobs: JobRecord[] = [];

  constructor(private capacity: number = DEFAULT_CAPACITY) {}

  append(job: JobRecord): void {
    this.jobs = [...this.jobs, job].slice(-this.capacity);
  }

  listRecent(limit: number): JobRecord[] {
    return this.jobs.slice(-limit).reverse();
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

  setCapacity(capacity: number): void {
    this.capacity = capacity;
    this.jobs = this.jobs.slice(-capacity);
  }
}
```

`src/core/testing/fake-printer-adapter.ts`:
```ts
import type { LabelData, PrinterAdapter, PrinterInfo } from '../types';

export class FakePrinterAdapter implements PrinterAdapter {
  readonly printed: Array<{ printerName: string; raw: string }> = [];
  printers: PrinterInfo[] = [{ name: 'HPRT N31C', displayName: 'HPRT N31C' }];
  private nextError: unknown = null;
  private gate: Promise<void> | null = null;

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.printers;
  }

  async print(printerName: string, label: LabelData): Promise<void> {
    if (this.gate) {
      await this.gate;
    }
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    this.printed.push({ printerName, raw: label.raw });
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

- [ ] **Step 3: 写失败的测试 `src/core/print-service.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { DedupGuard } from './dedup-guard';
import { PrintError } from './errors';
import { PrintQueue } from './print-queue';
import { PrintService, TEST_LABEL } from './print-service';
import { FAKE_CLOCK_START, FakeClock } from './testing/fake-clock';
import { FakePrinterAdapter } from './testing/fake-printer-adapter';
import { InMemoryJobStore } from './testing/in-memory-job-store';
import type { PrintRequest } from './types';

const WINDOW_MS = 10 * 60_000;
const RAW = 'CL5640-TK-图片色-36';
const PRINTER = 'HPRT N31C';

function createHarness(store = new InMemoryJobStore()) {
  const clock = new FakeClock();
  const adapter = new FakePrinterAdapter();
  const guard = new DedupGuard(clock, WINDOW_MS);
  let nextId = 0;
  const service = new PrintService({
    adapter,
    store,
    guard,
    clock,
    queue: new PrintQueue(1_000),
    createId: () => `job-${++nextId}`,
  });
  return { clock, adapter, store, service };
}

function request(overrides: Partial<PrintRequest> = {}): PrintRequest {
  return { raw: RAW, printerName: PRINTER, source: 'desktop', ...overrides };
}

describe('PrintService.submit', () => {
  test('prints a valid label and records it', async () => {
    const { service, adapter, store } = createHarness();
    const result = await service.submit(request());
    expect(result).toEqual({
      status: 'printed',
      jobId: 'job-1',
      label: { raw: RAW, code: 'CL5640-TK', color: '图片色', size: '36' },
    });
    expect(adapter.printed).toEqual([{ printerName: PRINTER, raw: RAW }]);
    expect(store.listRecent(1)[0]).toMatchObject({
      id: 'job-1',
      raw: RAW,
      printerName: PRINTER,
      source: 'desktop',
      status: 'printed',
      forced: false,
    });
  });

  test('rejects malformed input without printing', async () => {
    const { service, adapter, store } = createHarness();
    expect(await service.submit(request({ raw: 'hello' }))).toEqual({ status: 'invalid', reason: 'INVALID_FORMAT' });
    expect(adapter.printed).toHaveLength(0);
    expect(store.listRecent(1)[0]?.status).toBe('invalid');
  });

  test('blocks a repeat scan inside the window', async () => {
    const { service, adapter, clock } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(60_000);
    expect(await service.submit(request())).toEqual({ status: 'duplicate', lastPrintedAt: printedAt, windowMs: WINDOW_MS });
    expect(adapter.printed).toHaveLength(1);
  });

  test('concurrent scans of the same code print once', async () => {
    const { service, adapter } = createHarness();
    const release = adapter.hold();
    const first = service.submit(request());
    const second = service.submit(request({ source: 'history' }));
    expect((await second).status).toBe('duplicate');
    release();
    expect((await first).status).toBe('printed');
    expect(adapter.printed).toHaveLength(1);
  });

  test('a failed print can be retried immediately', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_FOUND'));
    expect(await service.submit(request())).toEqual({ status: 'failed', reason: 'PRINTER_NOT_FOUND' });
    expect((await service.submit(request())).status).toBe('printed');
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
  test('parses the label and reports it has not been printed', () => {
    const { service } = createHarness();
    expect(service.preview(RAW)).toEqual({
      status: 'ok',
      label: { raw: RAW, code: 'CL5640-TK', color: '图片色', size: '36' },
      lastPrintedAt: null,
    });
  });

  test('reports the last print time inside the window', async () => {
    const { service, clock } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(30_000);
    const preview = service.preview(RAW);
    expect(preview.status === 'ok' && preview.lastPrintedAt).toBe(printedAt);
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
    store.append({ id: 'old', createdAt: printedAt, raw: RAW, printerName: PRINTER, source: 'desktop', status: 'printed', forced: false });
    const { service } = createHarness(store);
    service.restore();
    expect(await service.submit(request())).toEqual({ status: 'duplicate', lastPrintedAt: printedAt, windowMs: WINDOW_MS });
  });
});

describe('PrintService.printTest', () => {
  test('prints the test label without recording or dedup', async () => {
    const { service, adapter, store } = createHarness();
    expect((await service.printTest(PRINTER)).status).toBe('printed');
    expect((await service.printTest(PRINTER)).status).toBe('printed');
    expect(adapter.printed).toEqual([
      { printerName: PRINTER, raw: TEST_LABEL.raw },
      { printerName: PRINTER, raw: TEST_LABEL.raw },
    ]);
    expect(store.listRecent(10)).toEqual([]);
  });
});
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `bun test src/core/print-service.test.ts`
Expected: FAIL，`Cannot find module './print-service'`

- [ ] **Step 5: 实现 `src/core/print-service.ts`**

```ts
import { MAX_DEDUP_WINDOW_MS, type DedupGuard } from './dedup-guard';
import { toFailureReason } from './errors';
import type { JobStore } from './job-store';
import { MAX_RAW_LENGTH, parseLabel } from './label-parser';
import type { PrintQueue } from './print-queue';
import type {
  Clock,
  JobRecord,
  LabelData,
  PreviewResult,
  PrinterAdapter,
  PrintRequest,
  PrintResult,
} from './types';

export const TEST_LABEL: LabelData = {
  raw: 'TEST-0001-测试色-00',
  code: 'TEST-0001',
  color: '测试色',
  size: '00',
};

export interface PrintServiceDeps {
  adapter: PrinterAdapter;
  store: JobStore;
  guard: DedupGuard;
  queue: PrintQueue;
  clock: Clock;
  createId: () => string;
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
    return { status: 'ok', label, lastPrintedAt: this.deps.guard.peek(label.raw) };
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
        lastPrintedAt: reservation.since,
        windowMs: this.deps.guard.windowMs,
      });
    }
    try {
      await this.deps.queue.enqueue(request.printerName, () => this.deps.adapter.print(request.printerName, label));
    } catch (error) {
      this.deps.guard.release(label.raw);
      console.error('[PrintService] print failed', error);
      return this.finish(id, request, label.raw, { status: 'failed', reason: toFailureReason(error) });
    }
    this.deps.guard.commit(label.raw);
    return this.finish(id, request, label.raw, { status: 'printed', jobId: id, label });
  }

  async printTest(printerName: string): Promise<PrintResult> {
    try {
      await this.deps.queue.enqueue(printerName, () => this.deps.adapter.print(printerName, TEST_LABEL));
      return { status: 'printed', jobId: 'test', label: TEST_LABEL };
    } catch (error) {
      console.error('[PrintService] test print failed', error);
      return { status: 'failed', reason: toFailureReason(error) };
    }
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
```

- [ ] **Step 6: 运行全部 core 测试**

Run: `bun test src/core && bunx tsc --noEmit -p tsconfig.json`
Expected: 全部 pass（本任务新增 13 个），0 fail；tsc 无输出。测试会打印几条 `[PrintService] ...` 的 console.error，这是预期的。

- [ ] **Step 7: Commit**

```bash
git add src/core
git commit -m "feat(core): PrintService with preview, dedup-guarded submit and history"
```

---

### Task 6: SqliteJobStore（环形保留 + 分页查询的打印记录）

**Files:**
- Create: `src/shared/job-history.ts`, `src/main/storage/sqlite-job-store.ts`
- Test: `src/main/storage/sqlite-job-store.test.ts`

**Interfaces:**
- Consumes：`openDatabase`、`runInTransaction`、`readString`、`readInteger`、`readEnum`（Task 4）；`JobStore`、`LastPrinted`（Task 5）；`PRINT_SOURCES`、`PRINT_STATUSES`、`PRINT_FAILURE_REASONS`（Task 1）
- Produces：
  - `JobQuery = { limit: number; search?: string; before?: number }`：`before` 是分页游标
  - `JobPage = { jobs: JobRecord[]; nextCursor: number | null; total: number }`
  - 常量：`JOB_PAGE_SIZE = 100`、`MAX_JOB_PAGE_SIZE = 500`
  - `class SqliteJobStore(db: DatabaseSync, capacity: number) implements JobStore`，另有两个查询方法：
    - `listPage(query: JobQuery): JobPage`：从新到旧，SQL 搜索 + keyset 分页
    - `count(): number`

  容量不是 ≥1 的整数时抛 `RangeError`。

> 容量可以到 10 万甚至百万级：
> - **插入后裁剪**：用 `DELETE … WHERE seq <= :lastSeq - :capacity`，走主键索引，开销与容量无关。
> - **调整容量时**：用 `OFFSET` 精确裁剪；这个操作很少发生。
> - **界面**：只按页取数据，永远不会整表加载。

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
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRecord } from '../../core/types';
import { openDatabase } from './database';
import { SqliteJobStore } from './sqlite-job-store';

function job(n: number, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: `job-${n}`,
    createdAt: 1_000 + n,
    raw: `CL${n}-红-36`,
    printerName: 'HPRT N31C',
    source: 'desktop',
    status: 'printed',
    forced: false,
    ...overrides,
  };
}

function ids(jobs: JobRecord[]): string[] {
  return jobs.map((j) => j.id);
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
    const failed = job(2, { status: 'failed', failureReason: 'PRINT_TIMEOUT', source: 'history', forced: true });
    store.append(job(1));
    store.append(failed);
    expect(store.listPage({ limit: 10 }).jobs).toEqual([failed, job(1)]);
  });

  test('keeps only the newest jobs once capacity is reached (ring)', () => {
    const store = new SqliteJobStore(db, 3);
    for (let n = 1; n <= 5; n += 1) store.append(job(n));
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-5', 'job-4', 'job-3']);
    expect(store.count()).toBe(3);
  });

  test('setCapacity trims immediately', () => {
    const store = new SqliteJobStore(db, 5);
    for (let n = 1; n <= 5; n += 1) store.append(job(n));
    store.setCapacity(2);
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-5', 'job-4']);
  });

  test('trims on open when the stored history exceeds capacity', () => {
    const large = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 4; n += 1) large.append(job(n));
    expect(new SqliteJobStore(db, 2).count()).toBe(2);
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

  test('searches case-insensitively and treats LIKE wildcards literally', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'CL5640-TK-图片色-36' }));
    store.append(job(2, { raw: 'AB12-黑-40' }));
    store.append(job(3, { raw: 'X%Y-红-1' }));
    expect(ids(store.listPage({ limit: 10, search: 'cl5640' }).jobs)).toEqual(['job-1']);
    expect(ids(store.listPage({ limit: 10, search: '%' }).jobs)).toEqual(['job-3']);
    expect(store.listPage({ limit: 10, search: 'cl5640' }).total).toBe(3);
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

  test('keeps history across reopen', () => {
    const path = join(dir, 'LabelFlash', 'labelflash.db');
    const first = openDatabase(path);
    new SqliteJobStore(first, 10).append(job(1));
    first.close();
    const second = openDatabase(path);
    expect(ids(new SqliteJobStore(second, 10).listPage({ limit: 10 }).jobs)).toEqual(['job-1']);
    second.close();
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/main/storage/sqlite-job-store.test.ts`
Expected: FAIL，`Cannot find module './sqlite-job-store'`

- [ ] **Step 4: 实现 `src/main/storage/sqlite-job-store.ts`**

```ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { JobStore, LastPrinted } from '../../core/job-store';
import { PRINT_FAILURE_REASONS, PRINT_SOURCES, PRINT_STATUSES, type JobRecord } from '../../core/types';
import type { JobPage, JobQuery } from '../../shared/job-history';
import { runInTransaction } from './database';
import { readEnum, readInteger, readString, type Row } from './row-readers';

const JOB_COLUMNS = `
  seq, id, created_at AS createdAt, raw, printer_name AS printerName,
  source, status, forced, failure_reason AS failureReason`;

/**
 * 打印记录，环形保留：jobs 表只保留最新的 capacity 条。
 * seq 是 AUTOINCREMENT，单调递增且不复用。
 */
export class SqliteJobStore implements JobStore {
  private capacity: number;
  private readonly insertJob: StatementSync;
  private readonly trimBehind: StatementSync;
  private readonly trimToCapacity: StatementSync;
  private readonly selectPage: StatementSync;
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
    // 调整容量或启动时使用：精确裁剪到 capacity 条。
    this.trimToCapacity = db.prepare(`
      DELETE FROM jobs
      WHERE seq <= (SELECT seq FROM jobs ORDER BY seq DESC LIMIT 1 OFFSET :capacity)`);
    this.selectPage = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE (:before IS NULL OR seq < :before)
        AND (:pattern IS NULL OR raw LIKE :pattern ESCAPE '\\')
      ORDER BY seq DESC
      LIMIT :limit`);
    this.selectCount = db.prepare('SELECT COUNT(*) AS total FROM jobs');
    this.selectLastPrinted = db.prepare(`
      SELECT raw, MAX(created_at) AS printedAt
      FROM jobs
      WHERE status = 'printed' AND created_at >= :since
      GROUP BY raw`);
    this.trimToCapacity.run({ capacity: this.capacity });
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
      this.trimBehind.run({ lastSeq: lastInsertRowid, capacity: this.capacity });
    });
  }

  listPage(query: JobQuery): JobPage {
    const search = query.search?.trim() ?? '';
    const rows = this.selectPage.all({
      before: query.before ?? null,
      pattern: search === '' ? null : `%${escapeLike(search)}%`,
      limit: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      jobs: pageRows.map(toJobRecord),
      nextCursor: hasMore && lastRow ? readInteger(lastRow, 'seq') : null,
      total: this.count(),
    };
  }

  count(): number {
    const row = this.selectCount.get();
    if (!row) {
      throw new Error('COUNT query returned no row');
    }
    return readInteger(row, 'total');
  }

  listLastPrinted(since: number): LastPrinted[] {
    return this.selectLastPrinted.all({ since }).map((row) => ({
      raw: readString(row, 'raw'),
      printedAt: readInteger(row, 'printedAt'),
    }));
  }

  setCapacity(capacity: number): void {
    this.capacity = assertCapacity(capacity);
    this.trimToCapacity.run({ capacity: this.capacity });
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

- [ ] **Step 5: 运行测试**

Run: `bun test src/main/storage && bunx tsc --noEmit -p tsconfig.json`
Expected: 全部 pass（本任务新增 12 个），0 fail；tsc 无输出。

- [ ] **Step 6: Commit**

```bash
git add src/shared/job-history.ts src/main/storage/sqlite-job-store.ts src/main/storage/sqlite-job-store.test.ts
git commit -m "feat(storage): SQLite job history with ring retention, search and keyset paging"
```

---

### Task 7: 设置（校验 + SQLite 持久化）

**Files:**
- Create: `src/shared/settings.ts`, `src/main/storage/sqlite-settings-store.ts`
- Test: `src/shared/settings.test.ts`, `src/main/storage/sqlite-settings-store.test.ts`

**Interfaces:**
- Consumes：`MAX_DEDUP_WINDOW_MS`（Task 2）；`openDatabase`、`runInTransaction`、`readString`（Task 4）
- Produces：
  - `AppSettings = { selectedPrinter: string | null; autoPrint: boolean; dedupWindowMinutes: number; historyLimit: number; launchAtLogin: boolean }`
  - 常量：`DEFAULT_SETTINGS`、`MAX_DEDUP_WINDOW_MINUTES`、`HISTORY_LIMIT_RANGE`
  - 函数：`sanitizeSettings(value: unknown): AppSettings`、`minutesToMs(minutes)`、`isRecord(value)`
  - `class SqliteSettingsStore(db: DatabaseSync)`，成员：`current: AppSettings`、`update(patch: Partial<AppSettings>): AppSettings`

- [ ] **Step 1: 写失败的测试 `src/shared/settings.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, HISTORY_LIMIT_RANGE, MAX_DEDUP_WINDOW_MINUTES, sanitizeSettings } from './settings';

describe('sanitizeSettings', () => {
  // 不用 test.each：Bun 会把 undefined 那一行的参数当成 done 回调，导致超时。
  test('falls back to defaults for non-object input', () => {
    for (const value of [undefined, null, 42, 'x', []]) {
      expect(sanitizeSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test('keeps valid values', () => {
    const settings = { selectedPrinter: '标签', autoPrint: false, dedupWindowMinutes: 30, historyLimit: 20_000, launchAtLogin: true };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  test('clamps and rounds numbers', () => {
    expect(sanitizeSettings({ dedupWindowMinutes: -5 }).dedupWindowMinutes).toBe(0);
    expect(sanitizeSettings({ dedupWindowMinutes: 99_999 }).dedupWindowMinutes).toBe(MAX_DEDUP_WINDOW_MINUTES);
    expect(sanitizeSettings({ dedupWindowMinutes: 12.6 }).dedupWindowMinutes).toBe(13);
    expect(sanitizeSettings({ historyLimit: 1 }).historyLimit).toBe(HISTORY_LIMIT_RANGE.min);
    expect(sanitizeSettings({ historyLimit: 1e9 }).historyLimit).toBe(HISTORY_LIMIT_RANGE.max);
  });

  test('replaces wrong types with defaults', () => {
    expect(sanitizeSettings({ selectedPrinter: '', autoPrint: 'yes', dedupWindowMinutes: Number.NaN, launchAtLogin: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
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
    new SqliteSettingsStore(first).update({ selectedPrinter: 'Qirui QR-488', autoPrint: false });
    first.close();
    const second = openDatabase(path);
    expect(new SqliteSettingsStore(second).current).toMatchObject({ selectedPrinter: 'Qirui QR-488', autoPrint: false });
    second.close();
  });

  test('sanitizes updates', () => {
    const db = openDatabase(path);
    expect(new SqliteSettingsStore(db).update({ dedupWindowMinutes: 99_999 }).dedupWindowMinutes).toBe(MAX_DEDUP_WINDOW_MINUTES);
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

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/shared src/main/storage/sqlite-settings-store.test.ts`
Expected: FAIL，`Cannot find module './settings'` / `'./sqlite-settings-store'`

- [ ] **Step 4: 实现 `src/shared/settings.ts`**

```ts
import { MAX_DEDUP_WINDOW_MS } from '../core/dedup-guard';

export interface AppSettings {
  selectedPrinter: string | null;
  autoPrint: boolean;
  dedupWindowMinutes: number;
  historyLimit: number;
  launchAtLogin: boolean;
}

export const MS_PER_MINUTE = 60_000;
export const MAX_DEDUP_WINDOW_MINUTES = MAX_DEDUP_WINDOW_MS / MS_PER_MINUTE;
export const HISTORY_LIMIT_RANGE = { min: 1_000, max: 1_000_000 } as const;
const MAX_PRINTER_NAME_LENGTH = 256;

export const DEFAULT_SETTINGS: AppSettings = {
  selectedPrinter: null,
  autoPrint: true,
  dedupWindowMinutes: 10,
  historyLimit: 100_000,
  launchAtLogin: false,
};

export function sanitizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  return {
    selectedPrinter: sanitizePrinterName(input['selectedPrinter']),
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

- [ ] **Step 5: 实现 `src/main/storage/sqlite-settings-store.ts`**

```ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { sanitizeSettings, type AppSettings } from '../../shared/settings';
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

- [ ] **Step 6: 运行测试**

Run: `bun test src/shared src/main/storage && bunx tsc --noEmit -p tsconfig.json`
Expected: 全部 pass，0 fail；tsc 无输出。

- [ ] **Step 7: Commit**

```bash
git add src/shared/settings.ts src/shared/settings.test.ts src/main/storage/sqlite-settings-store.ts src/main/storage/sqlite-settings-store.test.ts
git commit -m "feat(settings): validated settings persisted in SQLite under AppData"
```

---

### Task 8: 标签模板 + Electron 驱动打印适配器

**Files:**
- Create: `src/shared/label-size.ts`, `src/main/printing/label-template.ts`, `src/main/printing/electron-driver-adapter.ts`
- Test: `src/main/printing/label-template.test.ts`

**Interfaces:**
- Consumes: `LabelData`、`PrinterAdapter`、`PrinterInfo`、`PrintError`（Task 1）
- Produces: `LABEL_SIZE_MM = { width: 60, height: 40 }`；`renderLabelHtml(label: LabelData): Promise<string>`；`escapeHtml(text: string): string`；`class ElectronDriverAdapter(getWebContents: () => WebContents) implements PrinterAdapter`

- [ ] **Step 1: 创建 `src/shared/label-size.ts`**

```ts
/** 标签纸实物尺寸：打印模板和界面上的软尺刻度共用。 */
export const LABEL_SIZE_MM = { width: 60, height: 40 } as const;
```

- [ ] **Step 2: 写失败的测试 `src/main/printing/label-template.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { escapeHtml, renderLabelHtml } from './label-template';

const LABEL = { raw: 'CL5640-TK-图片色-36', code: 'CL5640-TK', color: '图片色', size: '36' };

describe('renderLabelHtml', () => {
  test('renders the three fields and the full code line', async () => {
    const html = await renderLabelHtml(LABEL);
    expect(html).toContain('编码：CL5640-TK');
    expect(html).toContain('颜色：图片色');
    expect(html).toContain('尺码：36');
    expect(html).toContain('<p class="raw">CL5640-TK-图片色-36</p>');
  });

  test('sizes the page to the 60×40mm label', async () => {
    expect(await renderLabelHtml(LABEL)).toContain('size: 60mm 40mm');
  });

  test('embeds the QR code as inline SVG', async () => {
    expect(await renderLabelHtml(LABEL)).toContain('<svg');
  });

  test('escapes markup in label fields', async () => {
    const html = await renderLabelHtml({ raw: '<b>-"红"-&36', code: '<b>', color: '"红"', size: '&36' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('编码：&lt;b&gt;');
    expect(html).toContain('颜色：&quot;红&quot;');
    expect(html).toContain('尺码：&amp;36');
  });
});

describe('escapeHtml', () => {
  test('escapes all five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun test src/main/printing`
Expected: FAIL，`Cannot find module './label-template'`

- [ ] **Step 4: 实现 `src/main/printing/label-template.ts`**

```ts
import QRCode from 'qrcode';
import type { LabelData } from '../../core/types';
import { LABEL_SIZE_MM } from '../../shared/label-size';

const QR_SIZE_MM = 24;
const PADDING_MM = 2.5;
const GAP_MM = 2;
const FIELD_FONT_MM = 3.2;
const RAW_FONT_MM = 3;

/** 预览和打印共用的 60×40mm 标签：按原标签复刻，去掉库位。 */
export async function renderLabelHtml(label: LabelData): Promise<string> {
  const qrSvg = await QRCode.toString(label.raw, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
  const { width, height } = LABEL_SIZE_MM;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${width}mm ${height}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}mm; height: ${height}mm; overflow: hidden; background: #fff; color: #000; }
  body {
    display: flex; flex-direction: column; gap: ${GAP_MM}mm; padding: ${PADDING_MM}mm;
    font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif; font-weight: 700;
  }
  .top { display: flex; gap: ${PADDING_MM}mm; }
  .qr { flex: none; width: ${QR_SIZE_MM}mm; height: ${QR_SIZE_MM}mm; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .fields { display: flex; flex-direction: column; justify-content: space-around; min-width: 0; font-size: ${FIELD_FONT_MM}mm; line-height: 1.2; }
  .fields p, .raw { word-break: break-all; }
  .raw { font-size: ${RAW_FONT_MM}mm; line-height: 1.2; }
</style>
</head>
<body>
  <div class="top">
    <div class="qr">${qrSvg}</div>
    <div class="fields">
      <p>编码：${escapeHtml(label.code)}</p>
      <p>颜色：${escapeHtml(label.color)}</p>
      <p>尺码：${escapeHtml(label.size)}</p>
    </div>
  </div>
  <p class="raw">${escapeHtml(label.raw)}</p>
</body>
</html>`;
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

- [ ] **Step 5: 运行测试**

Run: `bun test src/main/printing`
Expected: 5 pass, 0 fail

- [ ] **Step 6: 实现 `src/main/printing/electron-driver-adapter.ts`**

这个文件依赖 Electron 运行时，没有单元测试；Task 13 在 Windows 上做真机验证。

```ts
import { BrowserWindow, type WebContents } from 'electron';
import { PrintError } from '../../core/errors';
import type { LabelData, PrinterAdapter, PrinterInfo } from '../../core/types';
import { LABEL_SIZE_MM } from '../../shared/label-size';
import { renderLabelHtml } from './label-template';

const MICRONS_PER_MM = 1_000;

/** 通过打印机驱动静默打印：隐藏窗口渲染标签 HTML，然后调用 webContents.print。 */
export class ElectronDriverAdapter implements PrinterAdapter {
  constructor(private readonly getWebContents: () => WebContents) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const printers = await this.getWebContents().getPrintersAsync();
    return printers
      .map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
  }

  async print(printerName: string, label: LabelData): Promise<void> {
    const printers = await this.listPrinters();
    if (!printers.some((printer) => printer.name === printerName)) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    const html = await renderLabelHtml(label);
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await printSilently(printWindow.webContents, printerName);
    } finally {
      printWindow.destroy();
    }
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
        pageSize: {
          width: LABEL_SIZE_MM.width * MICRONS_PER_MM,
          height: LABEL_SIZE_MM.height * MICRONS_PER_MM,
        },
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

- [ ] **Step 7: 类型检查**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: 无输出。

- [ ] **Step 8: Commit**

```bash
git add src/shared/label-size.ts src/main/printing
git commit -m "feat(printing): 60x40 label template and silent driver print adapter"
```

---

### Task 9: Electron 外壳（无边框窗口、托盘、IPC、preload）

**Files:**
- Create: `electron.vite.config.ts`, `scripts/generate-icon.ts`, `resources/icon.png`
- Create: `src/shared/ipc-contract.ts`
- Create: `src/main/window.ts`, `src/main/tray.ts`, `src/main/ipc.ts`, `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`, `src/renderer/tsconfig.json`, `src/renderer/src/env.d.ts`, `src/renderer/src/main.tsx`（占位界面）

**Interfaces:**
- Consumes：Task 1–8 的全部导出
- Produces：
  - `IpcChannel`（常量对象）
  - `RendererPrintSource = 'desktop' | 'history'`
  - `LabelPreview = { result: PreviewResult; html: string | null }`
  - `LabelFlashApi`：
    - `preview(raw)`
    - `print(raw, printerName, { source, force })`
    - `printTest(printerName)`
    - `listPrinters()`
    - `listJobs(query: JobQuery): Promise<JobPage>`
    - `getSettings()`
    - `updateSettings(patch)`
  - `WindowControlsApi`：
    - `minimize()`、`toggleMaximize()`、`close()`
    - `onMaximizedChange(listener): () => void`
  - 渲染进程全局对象：`window.api: LabelFlashApi`、`window.windowControls: WindowControlsApi`

- [ ] **Step 1: 创建 `electron.vite.config.ts`**

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

- [ ] **Step 2: 生成应用图标**

`scripts/generate-icon.ts`:
```ts
import { mkdir } from 'node:fs/promises';
import QRCode from 'qrcode';

const ICON_PATH = 'resources/icon.png';
const ICON_SIZE_PX = 512;

await mkdir('resources', { recursive: true });
await QRCode.toFile(ICON_PATH, 'LabelFlash', {
  width: ICON_SIZE_PX,
  margin: 2,
  color: { dark: '#18211E', light: '#F2C12E' },
});
console.log(`wrote ${ICON_PATH}`);
```

Run: `bun run icon`
Expected: 输出 `wrote resources/icon.png`；`file resources/icon.png` 显示 `PNG image data, 512 x 512`。

- [ ] **Step 3: 创建 `src/shared/ipc-contract.ts`**

```ts
import type { PreviewResult, PrinterInfo, PrintResult } from '../core/types';
import type { JobPage, JobQuery } from './job-history';
import type { AppSettings } from './settings';

export const IpcChannel = {
  Preview: 'label:preview',
  Print: 'label:print',
  PrintTest: 'printer:test',
  ListPrinters: 'printer:list',
  ListJobs: 'jobs:list',
  GetSettings: 'settings:get',
  UpdateSettings: 'settings:update',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowMaximizedChanged: 'window:maximized-changed',
} as const;

/** 渲染进程只能发起这两种来源；mobile 属于 Phase 2 的 HTTP 入口。 */
export type RendererPrintSource = 'desktop' | 'history';

export interface LabelPreview {
  result: PreviewResult;
  /** 与实际打印相同的标签 HTML；格式错误时为 null。 */
  html: string | null;
}

export interface PrintOptions {
  source: RendererPrintSource;
  force: boolean;
}

export interface LabelFlashApi {
  preview(raw: string): Promise<LabelPreview>;
  print(raw: string, printerName: string, options: PrintOptions): Promise<PrintResult>;
  printTest(printerName: string): Promise<PrintResult>;
  listPrinters(): Promise<PrinterInfo[]>;
  listJobs(query: JobQuery): Promise<JobPage>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export interface WindowControlsApi {
  minimize(): void;
  toggleMaximize(): void;
  /** 隐藏到托盘，不退出。 */
  close(): void;
  onMaximizedChange(listener: (isMaximized: boolean) => void): () => void;
}
```

- [ ] **Step 4: 创建 `src/main/window.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { IpcChannel } from '../shared/ipc-contract';

const WINDOW_BOUNDS = { width: 1180, height: 780, minWidth: 960, minHeight: 640 } as const;
const HOUSING_COLOR = '#E4E7E2';

export interface MainWindowOptions {
  icon: string;
  shouldHideOnClose: () => boolean;
}

/** 无系统边框窗口，标题栏由渲染进程自绘。 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_BOUNDS,
    frame: false,
    show: false,
    title: '云签速印',
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
    }
  });
  const sendMaximized = () => window.webContents.send(IpcChannel.WindowMaximizedChanged, window.isMaximized());
  window.on('maximize', sendMaximized);
  window.on('unmaximize', sendMaximized);

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}
```

- [ ] **Step 5: 创建 `src/main/tray.ts`**

```ts
import { Menu, nativeImage, Tray } from 'electron';

const TRAY_ICON_SIZE_PX = 16;

export interface TrayActions {
  show: () => void;
  quit: () => void;
}

export function createTray(iconPath: string, actions: TrayActions): Tray {
  const image = nativeImage.createFromPath(iconPath).resize({ width: TRAY_ICON_SIZE_PX, height: TRAY_ICON_SIZE_PX });
  const tray = new Tray(image);
  tray.setToolTip('云签速印');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: actions.show },
      { type: 'separator' },
      { label: '退出云签速印', click: actions.quit },
    ]),
  );
  tray.on('click', actions.show);
  return tray;
}
```

- [ ] **Step 6: 创建 `src/main/ipc.ts`**

```ts
import { ipcMain, type BrowserWindow } from 'electron';
import type { PrintService } from '../core/print-service';
import type { PrinterAdapter } from '../core/types';
import { IpcChannel, type LabelPreview, type PrintOptions, type RendererPrintSource } from '../shared/ipc-contract';
import { MAX_JOB_PAGE_SIZE, type JobQuery } from '../shared/job-history';
import { isRecord, type AppSettings } from '../shared/settings';
import { renderLabelHtml } from './printing/label-template';
import type { SqliteJobStore } from './storage/sqlite-job-store';
import type { SqliteSettingsStore } from './storage/sqlite-settings-store';

const MAX_IPC_STRING_LENGTH = 1_024;
const RENDERER_PRINT_SOURCES: ReadonlySet<string> = new Set<RendererPrintSource>(['desktop', 'history']);

export interface IpcDeps {
  service: PrintService;
  adapter: PrinterAdapter;
  store: SqliteJobStore;
  settings: SqliteSettingsStore;
  getWindow: () => BrowserWindow | null;
  onSettingsChanged: (next: AppSettings, previous: AppSettings) => void;
}

/** 渲染进程不可信：所有参数都在这里校验。 */
export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(IpcChannel.Preview, async (_event, raw: unknown): Promise<LabelPreview> => {
    const result = deps.service.preview(requireString(raw, 'raw'));
    return { result, html: result.status === 'ok' ? await renderLabelHtml(result.label) : null };
  });
  ipcMain.handle(IpcChannel.Print, (_event, raw: unknown, printerName: unknown, options: unknown) => {
    const { source, force } = requirePrintOptions(options);
    return deps.service.submit({
      raw: requireString(raw, 'raw'),
      printerName: requireString(printerName, 'printerName'),
      source,
      force,
    });
  });
  ipcMain.handle(IpcChannel.PrintTest, (_event, printerName: unknown) =>
    deps.service.printTest(requireString(printerName, 'printerName')),
  );
  ipcMain.handle(IpcChannel.ListPrinters, () => deps.adapter.listPrinters());
  ipcMain.handle(IpcChannel.ListJobs, (_event, query: unknown) => deps.store.listPage(requireJobQuery(query)));
  ipcMain.handle(IpcChannel.GetSettings, () => deps.settings.current);
  ipcMain.handle(IpcChannel.UpdateSettings, (_event, patch: unknown) => {
    if (!isRecord(patch)) {
      throw new Error('Invalid settings patch');
    }
    const previous = deps.settings.current;
    const next = deps.settings.update(patch as Partial<AppSettings>);
    deps.onSettingsChanged(next, previous);
    return next;
  });

  ipcMain.on(IpcChannel.WindowMinimize, () => deps.getWindow()?.minimize());
  ipcMain.on(IpcChannel.WindowToggleMaximize, () => {
    const window = deps.getWindow();
    if (!window) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });
  ipcMain.on(IpcChannel.WindowClose, () => deps.getWindow()?.hide());
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_IPC_STRING_LENGTH) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function requirePrintOptions(value: unknown): PrintOptions {
  if (
    !isRecord(value) ||
    typeof value['source'] !== 'string' ||
    !RENDERER_PRINT_SOURCES.has(value['source']) ||
    typeof value['force'] !== 'boolean'
  ) {
    throw new Error('Invalid print options');
  }
  return { source: value['source'] as RendererPrintSource, force: value['force'] };
}

function requireJobQuery(value: unknown): JobQuery {
  if (!isRecord(value)) {
    throw new Error('Invalid job query');
  }
  const { limit, search, before } = value;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_PAGE_SIZE) {
    throw new Error('Invalid job query limit');
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > MAX_IPC_STRING_LENGTH)) {
    throw new Error('Invalid job query search');
  }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    throw new Error('Invalid job query cursor');
  }
  return { limit, search, before };
}
```

- [ ] **Step 7: 创建 `src/main/index.ts`**

```ts
import { app, dialog, type BrowserWindow, type Tray } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import icon from '../../resources/icon.png?asset';
import { DedupGuard } from '../core/dedup-guard';
import { PrintQueue } from '../core/print-queue';
import { PrintService } from '../core/print-service';
import { systemClock } from '../core/types';
import { minutesToMs } from '../shared/settings';
import { registerIpc } from './ipc';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { openDatabase } from './storage/database';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { createTray } from './tray';
import { createMainWindow } from './window';

const APP_ID = 'com.labelflash.app';
const DATA_DIR_NAME = 'LabelFlash';
const DATABASE_FILE_NAME = 'labelflash.db';
const PRINT_TIMEOUT_MS = 30_000;

let mainWindow: BrowserWindow | null = null;
// 保持引用，防止托盘图标被 GC 回收。
let tray: Tray | null = null;
let isQuitting = false;

// productName 是中文；数据目录固定为英文 %APPDATA%\LabelFlash。
app.setPath('userData', join(app.getPath('appData'), DATA_DIR_NAME));

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

function applyLaunchAtLogin(enabled: boolean): void {
  // 开发模式下注册的会是 electron.exe，所以只在安装版生效。
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_ID);
  const db = openDatabase(join(app.getPath('userData'), DATABASE_FILE_NAME));
  app.on('will-quit', () => db.close());
  const settings = new SqliteSettingsStore(db);
  const store = new SqliteJobStore(db, settings.current.historyLimit);
  const guard = new DedupGuard(systemClock, minutesToMs(settings.current.dedupWindowMinutes));
  const adapter = new ElectronDriverAdapter(() => {
    if (!mainWindow) {
      throw new Error('Main window is not ready');
    }
    return mainWindow.webContents;
  });
  const service = new PrintService({
    adapter,
    store,
    guard,
    clock: systemClock,
    queue: new PrintQueue(PRINT_TIMEOUT_MS),
    createId: randomUUID,
  });
  service.restore();

  registerIpc({
    service,
    adapter,
    store,
    settings,
    getWindow: () => mainWindow,
    onSettingsChanged: (next, previous) => {
      guard.setWindowMs(minutesToMs(next.dedupWindowMinutes));
      if (next.historyLimit !== previous.historyLimit) {
        store.setCapacity(next.historyLimit);
      }
      if (next.launchAtLogin !== previous.launchAtLogin) {
        applyLaunchAtLogin(next.launchAtLogin);
      }
    },
  });
  applyLaunchAtLogin(settings.current.launchAtLogin);

  mainWindow = createMainWindow({ icon, shouldHideOnClose: () => !isQuitting });
  tray = createTray(icon, { show: showMainWindow, quit });
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
      dialog.showErrorBox('云签速印启动失败', error instanceof Error ? error.message : String(error));
      app.quit();
    });
}
```

> IPC 在窗口创建之前注册，保证渲染进程第一次调用时 handler 已经存在。`tray` 变量只用来持有引用。

- [ ] **Step 8: 创建 `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, type LabelFlashApi, type WindowControlsApi } from '../shared/ipc-contract';

const api: LabelFlashApi = {
  preview: (raw) => ipcRenderer.invoke(IpcChannel.Preview, raw),
  print: (raw, printerName, options) => ipcRenderer.invoke(IpcChannel.Print, raw, printerName, options),
  printTest: (printerName) => ipcRenderer.invoke(IpcChannel.PrintTest, printerName),
  listPrinters: () => ipcRenderer.invoke(IpcChannel.ListPrinters),
  listJobs: (query) => ipcRenderer.invoke(IpcChannel.ListJobs, query),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
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

- [ ] **Step 9: 创建渲染进程骨架**

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>云签速印</title>
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

`src/renderer/tsconfig.json`:
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

`src/renderer/src/env.d.ts`:
```ts
import type { LabelFlashApi, WindowControlsApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    api: LabelFlashApi;
    windowControls: WindowControlsApi;
  }
}

export {};
```

`src/renderer/src/main.tsx`（占位，Task 12 替换）：
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing');
}

createRoot(container).render(
  <StrictMode>
    <p style={{ padding: 24 }}>云签速印：外壳已就绪</p>
  </StrictMode>,
);
```

- [ ] **Step 10: 类型检查、测试、构建**

Run: `bun run typecheck && bun test && bun run build`
Expected: typecheck 无输出；测试全部 pass；build 输出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`。

- [ ] **Step 11: 启动开发版冒烟**

Run: `bun run dev`（后台运行，约 10 秒后检查）
Expected:
- 出现一个无系统边框的窗口，显示"云签速印：外壳已就绪"；
- 托盘里有黄底二维码图标；
- 终端没有 `Error` 输出；
- `~/Library/Application Support/LabelFlash/`（macOS 开发机）或 `%APPDATA%\LabelFlash\`（Windows）被创建。

占位界面没有自绘标题栏，从托盘选"退出云签速印"关闭。

- [ ] **Step 12: Commit**

```bash
git add electron.vite.config.ts scripts resources src/shared/ipc-contract.ts src/main src/preload src/renderer
git commit -m "feat(shell): frameless Electron window, tray, typed IPC and preload bridge"
```

---

### Task 10: 渲染层基础——设计 token、字体、纯逻辑库

**Files:**
- Create: `src/renderer/src/styles/tokens.css`
- Create: `src/renderer/src/assets/fonts/SmileySans-Oblique.woff2`, `src/renderer/src/assets/fonts/SmileySans-OFL.txt`
- Create: `src/renderer/src/lib/repeat-filter.ts`, `src/renderer/src/lib/status-text.ts`, `src/renderer/src/lib/list-filters.ts`, `src/renderer/src/lib/feedback-sound.ts`
- Test: `src/renderer/src/lib/repeat-filter.test.ts`, `src/renderer/src/lib/status-text.test.ts`, `src/renderer/src/lib/list-filters.test.ts`

**Interfaces:**
- Consumes：`PrintResult`、`JobRecord`、`PrinterInfo`、`PrintFailureReason`、`PrintSource`（Task 1）；`LabelPreview`（Task 9）
- Produces：
  - `class RepeatFilter(intervalMs, now?)`，成员 `shouldAccept(value): boolean`
  - 类型：`FeedbackTone`、`StatusTone`、`StatusView`、`FeedbackStatusView`、`ScanActions`、`ScanSnapshot`、`ScanContext`、`ScanView`
  - 描述函数：`describeResult(result, now): FeedbackStatusView`、`describeScan(scan, ctx): ScanView`、`describeJobStatus(job)`、`describeSource(source)`
  - 格式化函数：`formatAgo(at, now)`、`formatWindow(ms)`、`formatDateTime(ms)`
  - 过滤函数：`filterPrinters(printers, query)`（打印记录的搜索在 SQL 里做，见 Task 6）
  - 提示音：`playFeedback(tone: FeedbackTone)`

- [ ] **Step 1: 放入得意黑字体（OFL-1.1）**

Run:
```bash
mkdir -p src/renderer/src/assets/fonts
TMP_DIR=$(mktemp -d)
curl -fsSL -o "$TMP_DIR/smiley.zip" https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip
unzip -p "$TMP_DIR/smiley.zip" SmileySans-Oblique.otf.woff2 > src/renderer/src/assets/fonts/SmileySans-Oblique.woff2
curl -fsSL -o src/renderer/src/assets/fonts/SmileySans-OFL.txt https://raw.githubusercontent.com/atelier-anchor/smiley-sans/main/LICENSE
rm -rf "$TMP_DIR"
ls -l src/renderer/src/assets/fonts
```
Expected: `SmileySans-Oblique.woff2` 大约 1.36 MB（1361268 字节）；`SmileySans-OFL.txt` 包含 `SIL OPEN FONT LICENSE`。

- [ ] **Step 2: 创建 `src/renderer/src/styles/tokens.css`**

```css
@font-face {
  font-family: 'Smiley Sans';
  src: url('../assets/fonts/SmileySans-Oblique.woff2') format('woff2');
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

  --font-display: 'Smiley Sans', 'Microsoft YaHei UI', sans-serif;
  --font-body: 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
  --font-data: 'Cascadia Mono', Consolas, 'SF Mono', monospace;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --radius: 6px;

  --title-bar-height: 40px;
  --side-width: 340px;

  /* 预览按实物比例缩放：1mm = 3.7795px × 缩放倍数 */
  --preview-scale: 2.1;
  --mm: calc(3.7795px * var(--preview-scale));
  --ruler-depth: calc(4 * var(--mm));
  --feed-duration: 180ms;
}

@media (min-width: 1280px) and (min-height: 840px) {
  :root {
    --preview-scale: 2.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --feed-duration: 0ms;
  }
}
```

- [ ] **Step 3: 写失败的测试 `src/renderer/src/lib/repeat-filter.test.ts`**

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

- [ ] **Step 4: 写失败的测试 `src/renderer/src/lib/list-filters.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { filterPrinters } from './list-filters';

const PRINTERS = [
  { name: '申通', displayName: '申通' },
  { name: 'Qirui QR-488', displayName: 'Qirui QR-488' },
  { name: 'HPRT N31C', displayName: 'HPRT N31C' },
];

describe('filterPrinters', () => {
  test('returns everything for a blank query', () => {
    expect(filterPrinters(PRINTERS, '  ')).toEqual(PRINTERS);
  });

  test('matches case-insensitively', () => {
    expect(filterPrinters(PRINTERS, 'qr').map((p) => p.name)).toEqual(['Qirui QR-488']);
    expect(filterPrinters(PRINTERS, '申').map((p) => p.name)).toEqual(['申通']);
  });
});
```

- [ ] **Step 5: 写失败的测试 `src/renderer/src/lib/status-text.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import type { LabelPreview } from '../../../shared/ipc-contract';
import {
  describeJobStatus,
  describeResult,
  describeScan,
  formatAgo,
  formatWindow,
  type ScanContext,
  type ScanSnapshot,
} from './status-text';

const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);
const MINUTE = 60_000;
const LABEL = { raw: 'CL5640-TK-图片色-36', code: 'CL5640-TK', color: '图片色', size: '36' };
const OK_PREVIEW: LabelPreview = { result: { status: 'ok', label: LABEL, lastPrintedAt: null }, html: '<html></html>' };

const snapshot = (overrides: Partial<ScanSnapshot> = {}): ScanSnapshot => ({
  raw: LABEL.raw,
  preview: OK_PREVIEW,
  print: null,
  isPrinting: false,
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
  test('printed', () => {
    expect(describeResult({ status: 'printed', jobId: 'j', label: LABEL }, NOW)).toEqual({
      tone: 'success',
      title: '已打印',
      detail: 'CL5640-TK · 图片色 · 36',
    });
  });

  test('duplicate explains when and why', () => {
    const view = describeResult({ status: 'duplicate', lastPrintedAt: NOW - 3 * MINUTE, windowMs: 10 * MINUTE }, NOW);
    expect(view.tone).toBe('warning');
    expect(view.detail).toBe('3 分钟前已打印过，10 分钟内同一标签只打一次');
  });

  test('timeout tells the operator what to check', () => {
    const view = describeResult({ status: 'failed', reason: 'PRINT_TIMEOUT' }, NOW);
    expect(view.tone).toBe('error');
    expect(view.detail).toContain('30 秒');
  });
});

describe('describeScan', () => {
  test('waiting state mentions F2 in manual mode', () => {
    const view = describeScan(null, context());
    expect(view.status.tone).toBe('idle');
    expect(view.status.detail).toContain('F2');
    expect(view.actions).toEqual({ print: null, forceReprint: false });
  });

  test('invalid preview is an error with no actions', () => {
    const view = describeScan(snapshot({ preview: { result: { status: 'invalid', reason: 'INVALID_FORMAT' }, html: null } }), context());
    expect(view.status.tone).toBe('error');
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

  test('manual mode warns about a label printed inside the window', () => {
    const preview: LabelPreview = { result: { status: 'ok', label: LABEL, lastPrintedAt: NOW - 2 * MINUTE }, html: '' };
    const view = describeScan(snapshot({ preview }), context());
    expect(view.status).toMatchObject({ tone: 'warning', title: '2 分钟前已打印过' });
    expect(view.actions).toEqual({ print: null, forceReprint: true });
  });

  test('no printer selected blocks printing', () => {
    const view = describeScan(snapshot(), context({ hasPrinter: false }));
    expect(view.status.title).toBe('还没选打印机');
    expect(view.actions.print).toBeNull();
  });

  test('failure offers retry, duplicate offers force reprint', () => {
    expect(describeScan(snapshot({ print: { status: 'failed', reason: 'PRINT_ERROR' } }), context()).actions).toEqual({
      print: 'retry',
      forceReprint: false,
    });
    const duplicate = snapshot({ print: { status: 'duplicate', lastPrintedAt: NOW, windowMs: 10 * MINUTE } });
    expect(describeScan(duplicate, context()).actions).toEqual({ print: null, forceReprint: true });
  });
});

describe('describeJobStatus', () => {
  const base = { id: 'j', createdAt: NOW, raw: LABEL.raw, printerName: 'P', source: 'desktop' as const, forced: false };

  test('marks forced reprints', () => {
    expect(describeJobStatus({ ...base, status: 'printed', forced: true })).toEqual({ tone: 'success', text: '已补打' });
  });

  test('includes the failure reason', () => {
    expect(describeJobStatus({ ...base, status: 'failed', failureReason: 'PRINT_TIMEOUT' })).toEqual({
      tone: 'error',
      text: '失败：超时',
    });
  });
});
```

- [ ] **Step 6: 运行测试，确认失败**

Run: `bun test src/renderer`
Expected: FAIL，提示找不到 `./repeat-filter`、`./list-filters`、`./status-text` 模块

- [ ] **Step 7: 实现 `src/renderer/src/lib/repeat-filter.ts`**

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

- [ ] **Step 8: 实现 `src/renderer/src/lib/list-filters.ts`**

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

- [ ] **Step 9: 实现 `src/renderer/src/lib/status-text.ts`**

```ts
import type { JobRecord, PrintFailureReason, PrintResult, PrintSource } from '../../../core/types';
import type { LabelPreview } from '../../../shared/ipc-contract';

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

const FORMAT_HINT = '应为「编码-颜色-尺码」，例如 CL5640-TK-图片色-36。出现乱码时，检查扫码枪是否开启中文输出';

const FAILURE_DETAILS: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '系统里找不到这台打印机，刷新打印机列表后重新选择',
  PRINT_TIMEOUT: '打印机 30 秒内没有响应，检查是否开机、缺纸或卡纸',
  PRINT_ERROR: '打印机驱动报错，检查打印机状态后重试',
};

const FAILURE_SHORT: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINT_TIMEOUT: '超时',
  PRINT_ERROR: '驱动报错',
};

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

export function describeResult(result: PrintResult, now: number): FeedbackStatusView {
  switch (result.status) {
    case 'printed':
      return {
        tone: 'success',
        title: '已打印',
        detail: `${result.label.code} · ${result.label.color} · ${result.label.size}`,
      };
    case 'duplicate':
      return {
        tone: 'warning',
        title: '重复扫码，已拦截',
        detail: `${formatAgo(result.lastPrintedAt, now)}已打印过，${formatWindow(result.windowMs)}内同一标签只打一次`,
      };
    case 'invalid':
      return { tone: 'error', title: '二维码格式不对', detail: FORMAT_HINT };
    case 'failed':
      return { tone: 'error', title: '打印失败', detail: FAILURE_DETAILS[result.reason] };
  }
}

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
  const previewResult = scan.preview.result;
  if (previewResult.status === 'invalid') {
    return { status: describeResult(previewResult, context.now), actions: NO_ACTIONS };
  }
  if (scan.isPrinting) {
    return { status: { tone: 'pending', title: '正在打印…', detail: scan.raw }, actions: NO_ACTIONS };
  }
  if (scan.print) {
    return {
      status: describeResult(scan.print, context.now),
      actions: {
        print: scan.print.status === 'failed' && context.hasPrinter ? 'retry' : null,
        forceReprint: scan.print.status === 'duplicate' && context.hasPrinter,
      },
    };
  }
  if (!context.hasPrinter) {
    return {
      status: { tone: 'warning', title: '还没选打印机', detail: '在右侧「打印机」列表里点选一台' },
      actions: NO_ACTIONS,
    };
  }
  if (previewResult.lastPrintedAt !== null) {
    return {
      status: {
        tone: 'warning',
        title: `${formatAgo(previewResult.lastPrintedAt, context.now)}已打印过`,
        detail: '直接打印会被拦截；确实需要再打一张，请用「强制补打」',
      },
      actions: { print: null, forceReprint: true },
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
      return { tone: 'success', text: job.forced ? '已补打' : '已打印' };
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

- [ ] **Step 10: 实现 `src/renderer/src/lib/feedback-sound.ts`**

这个模块依赖 WebAudio，没有单元测试；Task 12 用耳朵验证。

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

- [ ] **Step 11: 运行测试和类型检查**

Run: `bun test src/renderer && bun run typecheck`
Expected: 全部 pass，0 fail；typecheck 无输出。

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/styles src/renderer/src/assets src/renderer/src/lib
git commit -m "feat(ui): design tokens, Smiley Sans font and pure status/filter logic"
```

---

### Task 11: View-models（MVVM 的 VM 层）

**Files:**
- Create: `src/renderer/src/view-models/use-settings.ts`, `use-printers.ts`, `use-job-log.ts`, `use-scan-station.ts`, `use-window-controls.ts`, `use-hotkey.ts`

**Interfaces:**
- Consumes：`window.api`、`window.windowControls`（Task 9）；`RepeatFilter`、`describeResult`、`playFeedback`、`ScanSnapshot`（Task 10）
- Produces：
  - `useSettings()` → `{ settings: AppSettings | null; update(patch): Promise<void> }`
  - `usePrinters()` → `{ printers; isLoading; refresh(); printTest(name) }`
  - `useJobLog()` → `{ jobs; total; hasMore; search; setSearch; refresh; loadMore }`
  - `useScanStation({ printerName, autoPrint, onJobRecorded })` → `{ scan: ScanState | null; scanCode(raw); review(raw); reprint(raw); printCurrent(force) }`
  - `ScanState = ScanSnapshot & { seq: number; source: RendererPrintSource }`
  - `useWindowControls()` → `{ isMaximized; minimize; toggleMaximize; close }`
  - `useHotkey(key, handler)`

这些 hook 薄薄地包一层 IPC，逻辑都已经下沉到 Task 10 的纯函数里（有测试）。hook 本身在 Task 12 通过运行界面来验证。

- [ ] **Step 1: 创建 `use-settings.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../../../shared/settings';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let isActive = true;
    void window.api.getSettings().then((loaded) => {
      if (isActive) {
        setSettings(loaded);
      }
    });
    return () => {
      isActive = false;
    };
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await window.api.updateSettings(patch));
  }, []);

  return { settings, update };
}
```

- [ ] **Step 2: 创建 `use-printers.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';

export function usePrinters() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPrinters(await window.api.listPrinters());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const printTest = useCallback((printerName: string): Promise<PrintResult> => window.api.printTest(printerName), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { printers, isLoading, refresh, printTest };
}
```

- [ ] **Step 3: 创建 `use-job-log.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { JOB_PAGE_SIZE, type JobPage } from '../../../shared/job-history';

const SEARCH_DEBOUNCE_MS = 200;
const EMPTY_PAGE: JobPage = { jobs: [], nextCursor: null, total: 0 };

/** 打印记录只按页加载（容量可达百万级），搜索交给 SQL。 */
export function useJobLog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<JobPage>(EMPTY_PAGE);
  const searchRef = useRef(search);
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async (query: string) => {
    requestId.current += 1;
    const id = requestId.current;
    const first = await window.api.listJobs({ limit: JOB_PAGE_SIZE, search: query });
    if (id === requestId.current) {
      setPage(first);
    }
  }, []);

  useEffect(() => {
    searchRef.current = search;
    const timer = window.setTimeout(() => void loadFirstPage(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, loadFirstPage]);

  const refresh = useCallback(() => loadFirstPage(searchRef.current), [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (page.nextCursor === null) {
      return;
    }
    const id = requestId.current;
    const next = await window.api.listJobs({ limit: JOB_PAGE_SIZE, search: searchRef.current, before: page.nextCursor });
    if (id === requestId.current) {
      setPage((current) => ({ jobs: [...current.jobs, ...next.jobs], nextCursor: next.nextCursor, total: next.total }));
    }
  }, [page.nextCursor]);

  return {
    jobs: page.jobs,
    total: page.total,
    hasMore: page.nextCursor !== null,
    search,
    setSearch,
    refresh,
    loadMore,
  };
}
```

- [ ] **Step 4: 创建 `use-scan-station.ts`**

```ts
import { useCallback, useRef, useState } from 'react';
import type { PrintResult } from '../../../core/types';
import type { LabelPreview, RendererPrintSource } from '../../../shared/ipc-contract';
import { playFeedback } from '../lib/feedback-sound';
import { RepeatFilter } from '../lib/repeat-filter';
import { describeResult, type ScanSnapshot } from '../lib/status-text';

const SCAN_REPEAT_INTERVAL_MS = 1_000;
const INVALID_PREVIEW: LabelPreview = { result: { status: 'invalid', reason: 'INVALID_FORMAT' }, html: null };

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
        return;
      }
      patchIfCurrent(seq, { isPrinting: true, print: null });
      let result: PrintResult;
      try {
        result = await window.api.print(raw, printerName, { source, force });
      } catch (error) {
        console.error('[scan] print failed', error);
        result = { status: 'failed', reason: 'PRINT_ERROR' };
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
      let preview: LabelPreview;
      try {
        preview = await window.api.preview(raw);
      } catch (error) {
        console.error('[scan] preview failed', error);
        preview = INVALID_PREVIEW;
      }
      const willPrint = mode.printNow && preview.result.status === 'ok' && printerName !== null;
      if (seq === latestSeq.current) {
        setScan({ seq, raw, preview, source: mode.source, print: null, isPrinting: willPrint });
      }
      if (preview.result.status === 'invalid') {
        playFeedback('error');
        return;
      }
      if (willPrint) {
        // 自动模式下每一次扫码都要打印，哪怕界面已被更新的扫描取代。
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

  return { scan, scanCode, review, reprint, printCurrent };
}
```

- [ ] **Step 5: 创建 `use-window-controls.ts` 和 `use-hotkey.ts`**

`use-window-controls.ts`:
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

`use-hotkey.ts`:
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

- [ ] **Step 6: 类型检查**

Run: `bun run typecheck && bun test`
Expected: typecheck 无输出；测试全部 pass。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/view-models
git commit -m "feat(ui): view-models for scan station, printers, history and window"
```

---

### Task 12: 界面组件 + App（按 frontend-design 方向实现）

**REQUIRED SUB-SKILL：** 开始前先加载 `frontend-design:frontend-design`。视觉方向已经在 spec §8 "视觉方向" 中定稿：
- 软尺刻度框住实物比例的标签预览，这是标志元素；
- 热敏纸出纸式的滑入动效，这是唯一动效；
- 其余元素保持克制。

实现时严格使用 `tokens.css` 里的 token，不要引入新颜色和字体。

**Files:**
- Create: `src/renderer/src/components/TitleBar.tsx`, `ScanBar.tsx`, `Ruler.tsx`, `ConfirmButton.tsx`, `PreviewStage.tsx`, `SidePanel.tsx`, `PrinterList.tsx`, `JobLog.tsx`, `SettingsForm.tsx`
- Create: `src/renderer/src/App.tsx`, `src/renderer/src/styles/app.css`
- Modify: `src/renderer/src/main.tsx`（替换占位界面）

**Interfaces:**
- Consumes：Task 10 的纯函数；Task 11 的 hooks；`LABEL_SIZE_MM`（Task 8）；`DEFAULT_SETTINGS`、`HISTORY_LIMIT_RANGE`、`MAX_DEDUP_WINDOW_MINUTES`（Task 7）

- [ ] **Step 1: `TitleBar.tsx`（自绘标题栏）**

```tsx
import { useWindowControls } from '../view-models/use-window-controls';

interface TitleBarProps {
  printerName: string | null;
  isPrinterAvailable: boolean;
}

export function TitleBar({ printerName, isPrinterAvailable }: TitleBarProps) {
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const chipText = printerName === null ? '未选择打印机' : isPrinterAvailable ? printerName : `${printerName}（不可用）`;

  return (
    <header className="title-bar">
      <div className="title-bar__brand">
        <TapeMark />
        <span className="title-bar__name">云签速印</span>
      </div>
      <div className={`printer-chip${isPrinterAvailable ? '' : ' printer-chip--missing'}`} title="当前打印机">
        <span className="printer-chip__dot" aria-hidden="true" />
        <span className="printer-chip__name">{chipText}</span>
      </div>
      <div className="window-controls">
        <button type="button" className="window-button" aria-label="最小化" onClick={minimize}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button type="button" className="window-button" aria-label={isMaximized ? '还原' : '最大化'} onClick={toggleMaximize}>
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

/** 品牌记号：一小段软尺。 */
function TapeMark() {
  const ticks = [2, 6, 10, 14, 18, 22, 26];
  return (
    <svg className="tape-mark" viewBox="0 0 28 12" aria-hidden="true">
      <rect width="28" height="12" rx="2" fill="var(--color-tape)" />
      {ticks.map((x, index) => (
        <line key={x} x1={x} x2={x} y1="0" y2={index % 2 === 0 ? 6 : 4} stroke="var(--color-ink)" strokeWidth="1" />
      ))}
    </svg>
  );
}
```

- [ ] **Step 2: `ScanBar.tsx`（常驻焦点的扫码框 + 自动打印开关）**

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

const REFOCUS_DELAY_MS = 300;
const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'number']);

interface ScanBarProps {
  autoPrint: boolean;
  onAutoPrintChange: (autoPrint: boolean) => void;
  onScan: (raw: string) => void;
}

/** 焦点只允许停在文本输入框里（搜索、设置）；点按钮或开关后，自动拉回扫码框。 */
function isTextEntry(element: Element | null): boolean {
  if (element instanceof HTMLInputElement) {
    return TEXT_ENTRY_TYPES.has(element.type);
  }
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

export function ScanBar({ autoPrint, onAutoPrintChange, onScan }: ScanBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
    const refocusWhenIdle = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active !== inputRef.current && !isTextEntry(active)) {
          inputRef.current?.focus();
        }
      }, REFOCUS_DELAY_MS);
    };
    document.addEventListener('focusout', refocusWhenIdle);
    return () => document.removeEventListener('focusout', refocusWhenIdle);
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const raw = value;
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
          data-scan-input
        />
      </label>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
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

> 扫码框本身也是 `type="text"`：`active !== inputRef.current` 这个判断让它在拿到焦点时不触发拉回。

- [ ] **Step 3: `Ruler.tsx`（软尺刻度）**

```tsx
const RULER_DEPTH_MM = 4;
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

- [ ] **Step 4: `ConfirmButton.tsx`（界面内两步确认，不弹系统对话框）**

```tsx
import { useEffect, useState } from 'react';

const CONFIRM_WINDOW_MS = 3_000;

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** 第一次点击进入待确认状态，3 秒内再点才执行；超时自动复原。 */
export function ConfirmButton({ label, confirmLabel, onConfirm }: ConfirmButtonProps) {
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
    <button type="button" className={`button${isArmed ? ' button--armed' : ''}`} onClick={handleClick}>
      {isArmed ? confirmLabel : label}
    </button>
  );
}
```

- [ ] **Step 4b: `PreviewStage.tsx`（软尺框住的标签预览 + 状态条）**


```tsx
import { LABEL_SIZE_MM } from '../../../shared/label-size';
import type { ScanView } from '../lib/status-text';
import type { ScanState } from '../view-models/use-scan-station';
import { ConfirmButton } from './ConfirmButton';
import { Ruler } from './Ruler';

interface PreviewStageProps {
  scan: ScanState | null;
  view: ScanView;
  onPrint: () => void;
  onForceReprint: () => void;
}

export function PreviewStage({ scan, view, onPrint, onForceReprint }: PreviewStageProps) {
  const html = scan?.preview.html ?? null;

  return (
    <section className={`preview-stage tone--${view.status.tone}`} aria-label="标签预览">
      <div className="preview-stage__bench">
        <div className="tape">
          <div className="tape__corner" aria-hidden="true">
            mm
          </div>
          <Ruler orientation="horizontal" lengthMm={LABEL_SIZE_MM.width} />
          <Ruler orientation="vertical" lengthMm={LABEL_SIZE_MM.height} />
          <div className="label-slot">
            {html ? (
              <div key={scan?.seq} className="label-feed">
                <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
              </div>
            ) : (
              <p className="label-placeholder">
                {scan ? '这个二维码无法生成标签' : `扫码后在这里预览 ${LABEL_SIZE_MM.width}×${LABEL_SIZE_MM.height} 标签`}
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
            <ConfirmButton key={scan?.seq} label="强制补打" confirmLabel="再点一次确认补打" onConfirm={onForceReprint} />
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

- [ ] **Step 5: `SidePanel.tsx`（打印机 / 打印记录 / 设置 三个标签页）**

```tsx
import { useState, type ReactNode } from 'react';

export type SideTab = 'printers' | 'history' | 'settings';

const TABS: ReadonlyArray<{ id: SideTab; label: string }> = [
  { id: 'printers', label: '打印机' },
  { id: 'history', label: '打印记录' },
  { id: 'settings', label: '设置' },
];

interface SidePanelProps {
  panels: Record<SideTab, ReactNode>;
}

export function SidePanel({ panels }: SidePanelProps) {
  const [active, setActive] = useState<SideTab>('printers');
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
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {panels[active]}
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: `PrinterList.tsx`（可搜索、可滚动的打印机列表）**

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
  onTestPrint: (printerName: string) => Promise<PrintResult>;
}

export function PrinterList({ printers, selected, isLoading, onSelect, onRefresh, onTestPrint }: PrinterListProps) {
  const [query, setQuery] = useState('');
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const visible = useMemo(() => filterPrinters(printers, query), [printers, query]);
  const isSelectedMissing = selected !== null && !isLoading && !printers.some((printer) => printer.name === selected);

  const runTest = async (printerName: string) => {
    setTestMessages((messages) => ({ ...messages, [printerName]: '正在发送测试页…' }));
    const result = await onTestPrint(printerName);
    const message = result.status === 'printed' ? '测试页已发送' : describeResult(result, Date.now()).detail;
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
      {isSelectedMissing && <p className="notice">已保存的打印机「{selected}」现在不在系统里，请重新选择</p>}
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
              <button type="button" className="button button--small button--quiet" onClick={() => void runTest(printer.name)}>
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

- [ ] **Step 7: `JobLog.tsx`（可回溯、可重打、分页加载的打印记录）**

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
          placeholder="按编码搜索全部记录"
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
                  <button type="button" className="button button--small button--quiet" onClick={() => onReview(job.raw)}>
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
            <button type="button" className="button button--small button--quiet" onClick={onLoadMore}>
              加载更早的记录
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

- [ ] **Step 8: `SettingsForm.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { HISTORY_LIMIT_RANGE, MAX_DEDUP_WINDOW_MINUTES, type AppSettings } from '../../../shared/settings';

interface SettingsFormProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function SettingsForm({ settings, onChange }: SettingsFormProps) {
  return (
    <div className="settings">
      <NumberSetting
        label="防重复打印"
        unit="分钟"
        hint="同一标签在这段时间内只打一次；填 0 表示不拦截"
        value={settings.dedupWindowMinutes}
        min={0}
        max={MAX_DEDUP_WINDOW_MINUTES}
        onCommit={(dedupWindowMinutes) => onChange({ dedupWindowMinutes })}
      />
      <NumberSetting
        label="打印记录保留"
        unit="条"
        hint="超出后自动删除最早的记录；10 万条约占 20 MB 磁盘"
        value={settings.historyLimit}
        min={HISTORY_LIMIT_RANGE.min}
        max={HISTORY_LIMIT_RANGE.max}
        onCommit={(historyLimit) => onChange({ historyLimit })}
      />
      <label className="setting">
        <span className="setting__label">开机自动启动</span>
        <span className="switch switch--bare">
          <input
            type="checkbox"
            role="switch"
            checked={settings.launchAtLogin}
            onChange={(event) => onChange({ launchAtLogin: event.target.checked })}
          />
          <span className="switch__track" aria-hidden="true">
            <span className="switch__thumb" />
          </span>
        </span>
        <span className="setting__hint">登录 Windows 后自动运行并最小化到托盘</span>
      </label>
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
  onCommit: (value: number) => void;
}

function NumberSetting({ label, unit, hint, value, min, max, onCommit }: NumberSettingProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed) && parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(String(value));
    }
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
          onBlur={commit}
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

- [ ] **Step 9: `App.tsx`（组装）**

```tsx
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { JobLog } from './components/JobLog';
import { PreviewStage } from './components/PreviewStage';
import { PrinterList } from './components/PrinterList';
import { ScanBar } from './components/ScanBar';
import { SettingsForm } from './components/SettingsForm';
import { SidePanel } from './components/SidePanel';
import { TitleBar } from './components/TitleBar';
import { describeScan } from './lib/status-text';
import { useHotkey } from './view-models/use-hotkey';
import { useJobLog } from './view-models/use-job-log';
import { usePrinters } from './view-models/use-printers';
import { useScanStation } from './view-models/use-scan-station';
import { useSettings } from './view-models/use-settings';

export function App() {
  const { settings, update } = useSettings();
  const printers = usePrinters();
  const historyLimit = settings?.historyLimit ?? DEFAULT_SETTINGS.historyLimit;
  const jobLog = useJobLog();

  const printerName = settings?.selectedPrinter ?? null;
  const isPrinterAvailable = printerName !== null && printers.printers.some((printer) => printer.name === printerName);
  const autoPrint = settings?.autoPrint ?? DEFAULT_SETTINGS.autoPrint;

  const station = useScanStation({
    printerName: isPrinterAvailable ? printerName : null,
    autoPrint,
    onJobRecorded: jobLog.refresh,
  });
  const view = describeScan(station.scan, { autoPrint, hasPrinter: isPrinterAvailable, now: Date.now() });

  useHotkey('F2', () => {
    if (view.actions.print) {
      station.printCurrent(false);
    }
  });

  return (
    <div className="app">
      <TitleBar printerName={printerName} isPrinterAvailable={isPrinterAvailable} />
      {settings === null ? (
        <p className="loading">正在读取设置…</p>
      ) : (
        <main className="workspace">
          <div className="station">
            <ScanBar
              autoPrint={autoPrint}
              onAutoPrintChange={(next) => void update({ autoPrint: next })}
              onScan={station.scanCode}
            />
            <PreviewStage
              scan={station.scan}
              view={view}
              onPrint={() => station.printCurrent(false)}
              onForceReprint={() => station.printCurrent(true)}
            />
          </div>
          <SidePanel
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
              history: (
                <JobLog
                  jobs={jobLog.jobs}
                  total={jobLog.total}
                  historyLimit={historyLimit}
                  search={jobLog.search}
                  hasMore={jobLog.hasMore}
                  onSearchChange={jobLog.setSearch}
                  onLoadMore={() => void jobLog.loadMore()}
                  onReview={station.review}
                  onReprint={station.reprint}
                />
              ),
              settings: <SettingsForm settings={settings} onChange={(patch) => void update(patch)} />,
            }}
          />
        </main>
      )}
    </div>
  );
}
```

> `jobLog.refresh` 是稳定引用（`useCallback`），直接传入，避免 `useScanStation` 的回调在每次渲染时重建。

- [ ] **Step 10: `styles/app.css`**

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
  font: 14px/1.5 var(--font-body);
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
  place-items: center;
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
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

.tape-mark {
  width: 28px;
  height: 12px;
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

.printer-chip--missing .printer-chip__dot {
  background: var(--color-warning);
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
  display: grid;
  flex: 1;
  place-items: center;
  min-height: 0;
  padding: var(--space-4);
}

.tape {
  display: grid;
  grid-template-areas:
    'corner top'
    'side label';
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

.tab[aria-selected='true'] {
  border-bottom-color: var(--color-tape);
  color: var(--color-ink);
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
  width: 88px;
  font-family: var(--font-data);
}

.scroll-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.notice {
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
```

- [ ] **Step 11: 替换 `src/renderer/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 12: 类型检查、测试、构建**

Run: `bun run typecheck && bun test && bun run build`
Expected: 全部零错误。

- [ ] **Step 13: 在开发机上验证界面（macOS 开发版）**

Run: `bun run dev`，然后逐项检查并截图（`screencapture -x` 或 Claude 截图工具）：

1. 标题栏：
   - 墨黑背景，左侧有软尺记号和得意黑字体的"云签速印"；
   - 拖动标题栏可以移动窗口，双击可以最大化；
   - 三个窗口按钮都有效，"关闭"后窗口隐藏到托盘，点托盘可以恢复。
2. 打印机列表：
   - 列出本机所有打印机；输入搜索词能即时过滤；
   - 点选后标题栏的胶囊显示该打印机；
   - 重启 dev 后选择仍然保留（数据库在 `~/Library/Application Support/LabelFlash/labelflash.db`）。
3. 扫码框：
   - 始终有焦点；
   - 点完开关、按钮、标签页后，300ms 内焦点回到扫码框；
   - 在搜索框里输入时，焦点不会被抢走。
4. 手动模式（关闭"自动打印"）：
   - 输入 `CL5640-TK-图片色-36` 回车 → 预览从上方滑入；
   - 预览上方和左边是黄底毫米刻度尺，与标签边缘对齐；
   - 状态条显示"待打印"，按 F2 触发打印。
5. 错误格式：输入 `hello` 回车 → 红色状态条"二维码格式不对"，同时播放长低音。
6. 打印记录标签页：
   - 能看到刚才的记录，显示条数 `n / 100,000`；
   - "预览"会把该标签加载回预览区；"重打"在窗口期内会显示"重复扫码，已拦截" + "强制补打"按钮；第一次点击变成橙色"再点一次确认补打"，3 秒不点自动复原。
7. 设置：
   - 把"打印记录保留"改成 50（回车）→ 被纠正为 1000，记录计数显示 `n / 1,000`；
   - 把防重复窗口改成 0 后，同一标签可以连续打印。
8. 系统开启"减少动态效果"后，预览不再有滑入动画。

如果开发机上有打印机（包括 PDF 虚拟打印机），用它验证"测试页"按钮能够发送。

- [ ] **Step 14: Commit**

```bash
git add src/renderer
git commit -m "feat(ui): frameless scan station with tape-ruler live preview, printer picker and history"
```

---

### Task 13: 打包 + Windows 真机验收

**Files:**
- Create: `electron-builder.yml`
- Create: `docs/windows-acceptance.md`（验收记录）

- [ ] **Step 1: 创建 `electron-builder.yml`**

```yaml
appId: com.labelflash.app
productName: 云签速印
directories:
  buildResources: resources
  output: dist
files:
  - out/**
  - resources/**
  - package.json
asarUnpack:
  - resources/**
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: resources/icon.png
  executableName: LabelFlash
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
  shortcutName: 云签速印
  artifactName: LabelFlash-Setup-${version}.${ext}
```

- [ ] **Step 2: 在 Windows 机器上构建安装包**

在 macOS 上交叉打 Windows 包时，设置 exe 图标和版本信息需要 wine，所以直接在 Windows 上构建。如果有 `xremote` MCP 设备，可以通过它远程执行。

Run（Windows PowerShell，项目目录）：
```powershell
bun install
bun test
bun run dist:win
```
Expected: 测试全部 pass；生成 `dist\LabelFlash-Setup-0.1.0.exe`。

- [ ] **Step 3: 安装并逐项验收**

把结果逐项记录到 `docs/windows-acceptance.md`，每项写"通过 / 未通过 + 现象"：

1. **安装**：安装向导可以选择目录；桌面快捷方式名为"云签速印"；启动后 `%APPDATA%\LabelFlash\labelflash.db`（以及 WAL 的 `-wal`、`-shm` 文件）被创建。
2. **打印机**：列表显示本机全部打印机（申通、标签、德邦、Qirui QR-488、HPRT N31C …）；搜索 `qr` 只剩 Qirui QR-488。
3. **持久化**：选中标签机 → 退出程序（托盘 › 退出）→ 重新启动，选择仍然保留。
4. **测试页**：对标签机打印测试页，量一下出纸版面是否为 60×40mm、有无缩放或分页。如果被缩放，在"打印机属性 › 首选项"里把纸张设为 60×40mm 后重试，并把驱动设置步骤记录下来。
5. **扫码枪中文输出**：
   - 扫原样标签（`CL5640-TK-图片色-36`）。如果预览提示格式不对或出现乱码，按扫码枪说明书扫"中文输出 / Windows Unicode（Alt 码）"设置码；
   - 确认 Windows 输入法处于英文状态；
   - 把最终需要的扫码枪设置写进验收记录。
6. **自动打印**：扫码 → 预览出现，同时出纸，状态条变绿"已打印"并播放短高音；从扫码到出纸 < 2 秒。
7. **门限**：10 分钟内再扫同一张 → 橙色"重复扫码，已拦截"，不出纸；点"强制补打"并确认 → 出纸，记录里显示"已补打"。
8. **重启后门限仍有效**：打印一张 → 退出并重启 → 再扫同一张 → 仍然被拦截。
9. **手动模式**：关闭自动打印 → 扫码只预览不出纸 → 按 F2 出纸。
10. **记录回溯**：在打印记录里点"预览"和"重打"都有效；超过 100 条后底部出现"加载更早的记录"并能继续翻页；搜索能找到第一页以外的旧记录。环形淘汰由单元测试覆盖（Task 6）。
11. **故障**：关闭标签机电源后扫码 → 30 秒内出现红色"打印失败"及具体提示；开机后点"重试打印"成功。
12. **托盘**：关闭窗口 → 程序仍在托盘；再次双击桌面图标 → 已有窗口被唤起（单实例）。
13. **开机自启**：打开开关 → 注销并重新登录 → 程序自动运行。

- [ ] **Step 4: 修正问题并提交**

对验收中发现的问题，按 `superpowers:systematic-debugging` 定位并修复，每个修复单独提交。全部通过后：

```bash
git add electron-builder.yml docs/windows-acceptance.md
git commit -m "build: NSIS packaging and Windows acceptance record for phase 1"
```
