# 一键诊断修复（子项目 5b）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配置中心「打印机」页每台打印机加「诊断」：按顺序检查六项（后台打印服务 → 打印机和驱动状态 → USB 连接 → 打印队列 → 驱动纸张 → 指令集），每项给出结论（只说程序确知的事）、下一步和修复按钮；修复包括打开打印首选项、重新安装驱动（5c 的接缝，5c 合并前不出现）、重启后台打印服务（管理员）、恢复被暂停的打印机（macOS）、打开打印队列（Windows）、清除本程序的任务、清除全部任务（管理员）、自动设置驱动纸张（管理员，失败回滚）、走一张纸 / 纸张校准（5a 的接缝）；面板底部还有「打测试页」。系统里一台打印机都列不出来时（后台打印服务停了），打印机页给一个「检查后台打印服务」。

**Architecture:** 检查是纯逻辑：主进程把系统命令的输出解析成和平台无关的「事实」（`core/diagnosis/diagnosis-model.ts` 里的 `SpoolerFacts`、`PrinterFacts`、`UsbFacts`、`QueueFacts`），core 的 `verdicts.ts` 把事实变成带中文结论、下一步和按钮的 `CheckVerdict`；修复的权限策略、按钮文字、结果文字在 `core/diagnosis/fixes.ts`。解析器（`main/diagnosis/windows-facts.ts`、`mac-facts.ts`）不 import electron，每个平台用真实格式的样本（`main/diagnosis/testing/fixtures/{windows,mac}/`）测。Windows 的查询走现有的常驻 PowerShell 探测进程（加 `spooler`、`printer`、`usb`、`jobs`、`paper-options` 五个命令，每个都回一行有上限的 JSON）；非管理员的动作是一次性的 PowerShell（`-EncodedCommand`）；管理员动作沿用防火墙的做法（外层 `Start-Process -Verb RunAs`，内层脚本整段 Base64，打印机名只作为 PowerShell 字面量写进内层脚本），内层只用 .NET 的 `System.Printing` / `System.ServiceProcess` 和系统目录下的 `sc.exe`，并把 `PSModulePath` 收紧到 `$PSHOME`。macOS 用 `lpstat`、`ipptool`、`system_profiler`、`cancel`、`cupsenable`、`cupsaccept`、`lpadmin`（参数数组、绝对路径、英文环境、独立会话、限时限输出），要管理员的动作经 `osascript` 的 `do shell script … with administrator privileges`（命令和提示经 argv 传入、单引号转义）。「本程序的任务」靠内存里的账本 `SubmittedJobs` 认：提交人是当前用户、提交时间落在本程序某次交任务的时间段里。主进程的 `DiagnosisStation` 核对打印机在系统列表里、核对管理员策略、同一时间只做一个修复、写日志；界面按顺序一项一项调 `printer:diagnosis-check`，修复调 `printer:diagnosis-fix`，修完只重查受影响的几项。指令集一项是半手动的：指令是单向的（设计 7.1），程序只能「走一张纸」再问操作员有没有出纸。不改数据库。

**Tech Stack:** TypeScript、Bun test、Electron 主进程、PowerShell 5.1（.NET `System.Printing`、`System.ServiceProcess`、CIM、PnP）、macOS CUPS 命令行和 `osascript`、React 19、Playwright E2E。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.2、9、10、11 节。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`（外部输入 `unknown` 再收窄）；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **顺序和分支**：实施顺序 1 → 3 批量 → 2 模板库 → 4 PDF → 5a 指令 → **5b 本计划** → 5c 驱动 → 6a IPP。5a 合并进 master 之后，从 master 拉 `feature/printer-diagnosis`。
- **迁移**：本计划不改数据库（账本只在内存里，没有新设置项）。实施中如果发现要落库，用「实施时的下一个空号」追加迁移，并先和用户确认。
- **视觉验收编号**：本计划固定用 **V84–V86**，追加在 `ITEMS` 当时最后一项之后。
- **用词**：只说程序确知的事。驱动没报问题写「驱动没有报告问题」，不写「打印机正常」；取消任务写「已请求取消」，是否真的清掉由随后的重新检查说；走纸写「走纸指令已发送（进了打印队列）」。要管理员权限的按钮两个平台都写「（需要管理员权限）」。
- **安全底线**：打印机名只来自系统打印机列表（`DiagnosisStation` 先用 `PrinterDriver.hasPrinter` 核对）；系统命令一律参数数组、绝对路径，不经过 shell（macOS 管理员动作经 `do shell script` 时，命令由 `shellCommand` 逐个单引号转义拼出，见 Task 8）；管理员权限只在操作员点了写着「（需要管理员权限）」的按钮时弹，从不自动弹。
- **两个平台**：每一项检查、每一个修复在 Windows 和 macOS 上都有明确行为；没有的修复（macOS 的「打开打印队列」、Windows 的「恢复这台打印机」）不给按钮；其他平台每项都是「查不到：这个系统不支持这一项检查」。
- **命名**：不写参考产品和打印机品牌型号；样本里的打印机叫「热敏标签机」「Label Printer」。代码里出现的 `http://schemas.microsoft.com/...`、`http://www.w3.org/...` 是 Print Schema / XML Schema 的命名空间名（PrintTicket 规定必须这样写），不是网络地址，不会被访问。

## 和 5a、5c 的接缝

5a、5c 的计划和本计划同时写，名字以合并后的代码为准。本计划只通过 `src/main/diagnosis/seams.ts` 里的两个接口用它们，接到真实实现的代码只有 `src/main/index.ts` 里的几行（Task 13 Step 5）：

| 接缝 | 谁实现 | 本计划里用来做什么 | 没有时 |
|---|---|---|---|
| `LabelCommandsSeam.effectiveCommandSet(printerName)` | 5a（每台打印机的「指令集」设置，自动识别后的结果） | 「指令集」一项的结论 | 这一项「跳过：这一版还不能给标签机发指令」 |
| `LabelCommandsSeam.send(printerName, 'feed' \| 'calibrate')` | 5a（RAW 下发：Windows 经探测进程调 winspool，macOS `lp -o raw`） | 「走一张纸」「纸张校准」 | 同上，没有按钮 |
| 指令集下拉（界面） | 5a 在打印机行里的「指令集」控件 | 「改指令集」 | 不出现「改指令集」按钮的下拉（按钮仍在，点了没有东西出来——5a 已先合并，不会发生） |
| `DriverReinstallSeam.canReinstall / reinstall` | 5c（在线清单 + 静默安装） | 「重新安装驱动」 | `null`：按钮不出现。5c 的计划负责在 `index.ts` 把 `drivers: null` 换成它的实现 |

5a 的发送入口成功后也要记一笔账（Task 12 Step 3），RAW 任务才会被认作「本程序的任务」。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/shared/diagnosis.ts` | 新建 | 检查项、修复项、结论、修复请求和结果（IPC 类型）、检查项标题、修完重查哪几项 |
| `src/core/diagnosis/diagnosis-model.ts` | 新建 | 平台、事实（服务、打印机、USB、队列）、动作结果、`DIAGNOSIS_LIMITS` |
| `src/core/diagnosis/submitted-jobs.ts` | 新建 | 账本 `SubmittedJobs`：本程序交给打印队列的时间段 |
| `src/core/diagnosis/queue-summary.ts` | 新建 | 卡住的任务、本程序的任务、汇总 |
| `src/core/diagnosis/paper-choice.ts` | 新建 | 驱动纸张选项里挑一种（PrintTicket / CUPS 的 PWG 纸张名、自定义尺寸） |
| `src/core/diagnosis/fixes.ts` | 新建 | 每个平台每个修复要不要管理员、按钮文字、结果文字 |
| `src/core/diagnosis/verdicts.ts` | 新建 | 事实 → 结论（六项 + 打印机已不在列表） |
| `src/main/printing/printer-probe-host.ts` | 修改 | 五个诊断查询；回答长度上限 |
| `src/main/diagnosis/windows-facts.ts` | 新建 | 探测进程回答 → 事实 |
| `src/main/windows-powershell.ts` | 新建 | 跑一次性 PowerShell、管理员 PowerShell（防火墙的做法，拒绝时退出码 1223） |
| `src/main/diagnosis/windows-scripts.ts` | 新建 | 重启服务、清空队列、取消任务、设置驱动纸张的脚本；PrintTicket 增量 |
| `src/main/diagnosis/mac-commands.ts` | 新建 | 工具路径、英文环境、单引号转义、`osascript` 参数、CUPS 的 Get-Jobs 测试文件 |
| `src/main/diagnosis/mac-facts.ts` | 新建 | `lpstat`、`ipptool`、`system_profiler` 输出 → 事实 |
| `src/main/diagnosis/command-runner.ts` | 新建 | 不经 shell 跑命令：限时、限输出、关 stdin、独立会话 |
| `src/main/printing/driver-paper.ts` | 修改 | 导出 `queryIppAttributes`（打印机属性原文，诊断和纸张共用） |
| `src/main/diagnosis/diagnosis-system.ts` | 新建 | `DiagnosisSystem` 接口、`diagnosisPlatformOf`、`UnsupportedDiagnosis` |
| `src/main/diagnosis/windows-diagnosis.ts`、`mac-diagnosis.ts` | 新建 | 两个平台的实现（薄，依赖注入） |
| `src/main/diagnosis/create-diagnosis-system.ts` | 新建 | 按平台接上真实的进程、临时文件、打开队列窗口 |
| `src/main/diagnosis/seams.ts` | 新建 | 5a、5c 的接缝 |
| `src/main/printing/fake-printers.ts` | 修改 | `FakeDiagnosisSpec`；驱动纸张可被改写 |
| `src/main/diagnosis/fake-diagnosis.ts` | 新建 | 假打印机的诊断和假指令（E2E、视觉验收） |
| `src/main/diagnosis/diagnosis-station.ts` | 新建 | 核对、按项检查、按策略修复、一次一个、日志 |
| `src/main/diagnosis/testing/fixtures.ts`、`testing/fixtures/windows/*.txt`、`testing/fixtures/mac/*.txt` | 新建 | 系统命令输出样本 |
| `src/main/printing/electron-driver-adapter.ts` | 修改 | 交给队列后记账 |
| `src/main/ipc-validators.ts`、`src/main/ipc.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/main/index.ts` | 修改 | 两个通道和接线 |
| `src/renderer/src/lib/diagnosis-view.ts` | 新建 | 面板状态的纯逻辑（顺序、重查、管理员重试、走纸确认、汇总、标记） |
| `src/renderer/src/view-models/use-diagnosis.ts` | 新建 | 按顺序调检查、修复、重查 |
| `src/renderer/src/components/DiagnosisPanel.tsx` | 新建 | 面板 |
| `src/renderer/src/components/PrinterList.tsx`、`App.tsx`、`styles/app.css` | 修改 | 「诊断」按钮、空列表时的「检查后台打印服务」、样式 |
| `e2e/diagnosis.e2e.ts`、`e2e/support/app-helpers.ts` | 新建 / 修改 | E2E；`fakeAdminPrompts` |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V84–V86 |
| `README.md`、`docs/roadmap.md`、设计文档第 7.2 节、`CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`、`docs/windows-acceptance.md` | 修改 | 文档和真机验收记录 |

---

### Task 1: 共用类型

**Files:**
- Create: `src/shared/diagnosis.ts`、`src/shared/diagnosis.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/shared/diagnosis.test.ts
import { describe, expect, test } from 'bun:test';
import {
  DIAGNOSIS_CHECKS,
  DIAGNOSIS_FIXES,
  isDiagnosisCheckId,
  isDiagnosisFixId,
  RECHECK_AFTER,
} from './diagnosis';

describe('diagnosis ids', () => {
  // 后台打印服务停了，系统列不出打印机、读不到队列：先查它，后面几项的「查不到」才说得清原因。
  test('checks the print service first', () => {
    expect(DIAGNOSIS_CHECKS[0]).toBe('spooler');
  });

  test('accepts only known checks and fixes', () => {
    expect(isDiagnosisCheckId('queue')).toBe(true);
    expect(isDiagnosisCheckId('__proto__')).toBe(false);
    expect(isDiagnosisFixId('cancel-all-jobs')).toBe(true);
    // 「改指令集」只在界面里发生，主进程的修复通道不收它。
    expect(isDiagnosisFixId('change-command-set')).toBe(false);
    expect(isDiagnosisFixId(1)).toBe(false);
  });

  test('rechecks only existing checks after a fix', () => {
    for (const fix of DIAGNOSIS_FIXES) {
      for (const check of RECHECK_AFTER[fix]) {
        expect(DIAGNOSIS_CHECKS).toContain(check);
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/diagnosis.test.ts`
Expected: FAIL，`Cannot find module './diagnosis'`。

- [ ] **Step 3: 实现**

```ts
// src/shared/diagnosis.ts
/**
 * 一键诊断修复（设计第 7.2 节）：界面和主进程共用的检查项、修复项和结果。
 * 结论和按钮上的字都由主进程给（按平台说具体的系统名词），界面只负责展示、按顺序调用。
 */

/** 检查项，按执行顺序：后台打印服务排第一，它停了，后面几项都查不到。 */
export const DIAGNOSIS_CHECKS = ['spooler', 'printer', 'usb', 'queue', 'paper', 'commands'] as const;
export type DiagnosisCheckId = (typeof DIAGNOSIS_CHECKS)[number];

/** 主进程能执行的修复：界面经 IPC 请求，主进程再按平台、管理员策略和这台打印机核对一遍。 */
export const DIAGNOSIS_FIXES = [
  'open-preferences',
  'reinstall-driver',
  'restart-spooler',
  'enable-printer',
  'open-queue',
  'cancel-own-jobs',
  'cancel-all-jobs',
  'set-driver-paper',
  'feed',
  'calibrate',
] as const;
export type DiagnosisFixId = (typeof DIAGNOSIS_FIXES)[number];

/** 只在界面里发生的「修复」：改指令集用打印机页已有的指令集下拉（5a），不经过诊断的通道。 */
export const CHANGE_COMMAND_SET = 'change-command-set';
export type DiagnosisOfferId = DiagnosisFixId | typeof CHANGE_COMMAND_SET;

/**
 * pass：查到了，没问题；fail：查到了问题；warn：可能有问题；unknown：查不到；
 * skipped：这一项对这台不适用；action：要操作员动手确认（指令集：走一张纸看有没有出纸）。
 */
export type VerdictStatus = 'pass' | 'fail' | 'warn' | 'unknown' | 'skipped' | 'action';

/** 结论下面的一个按钮。 */
export interface FixOffer {
  id: DiagnosisOfferId;
  /** 按钮上的字；要管理员权限的以「（需要管理员权限）」结尾。 */
  label: string;
  /** 点了会弹系统的管理员确认（Windows 的 UAC、macOS 的管理员密码框）。 */
  admin: boolean;
}

/** 一项检查的结论。 */
export interface CheckVerdict {
  check: DiagnosisCheckId;
  status: VerdictStatus;
  /** 一句话结论，只说程序确知的事。 */
  detail: string;
  /** 下一步怎么做；没有时为 null。 */
  nextStep: string | null;
  fixes: FixOffer[];
}

/** 界面交给主进程的修复请求（主进程逐项校验，见 ipc-validators.ts 的 requireDiagnosisFixRequest）。 */
export interface FixRequest {
  /** null 只用于「重启后台打印服务」：系统列不出打印机的时候。 */
  printerName: string | null;
  fix: DiagnosisFixId;
  /** 点的是不是「（需要管理员权限）」的按钮。 */
  admin: boolean;
  /** 这台打印机负责的纸（纸张键，例如 60x40）；只有「自动设置驱动纸张」用，其余为 null。 */
  paperKey: string | null;
}

/**
 * 修复做了什么（不是「解决了没有」：解决没有由随后的重新检查说）。
 * needs-admin：以当前用户做被系统拒绝（macOS 的 CUPS），retry 是换上的管理员按钮。
 */
export type FixOutcome =
  | { status: 'done'; message: string }
  | { status: 'declined'; message: string }
  | { status: 'needs-admin'; message: string; retry: FixOffer }
  | { status: 'failed'; message: string }
  | { status: 'rolled-back'; message: string };

export const CHECK_TITLES: Readonly<Record<DiagnosisCheckId, string>> = {
  spooler: '后台打印服务',
  printer: '打印机和驱动状态',
  usb: 'USB 连接',
  queue: '打印队列',
  paper: '驱动纸张',
  commands: '指令集',
};

/** 修复做完（或回滚）后重查哪几项：只重查受影响的，其余结论留着。 */
export const RECHECK_AFTER: Readonly<Record<DiagnosisFixId, readonly DiagnosisCheckId[]>> = {
  'open-preferences': ['printer', 'paper'],
  'reinstall-driver': ['printer', 'usb', 'paper'],
  'restart-spooler': DIAGNOSIS_CHECKS,
  'enable-printer': ['spooler', 'printer'],
  'open-queue': ['printer', 'queue'],
  'cancel-own-jobs': ['queue'],
  'cancel-all-jobs': ['queue'],
  'set-driver-paper': ['paper'],
  // 走纸、校准的结果程序读不到：不重查，改问操作员（lib/diagnosis-view.ts）。
  feed: [],
  calibrate: [],
};

/** 只认自己的值：渲染进程传来的字符串可能是任何东西（包括 __proto__）。 */
export function isDiagnosisCheckId(value: unknown): value is DiagnosisCheckId {
  return typeof value === 'string' && (DIAGNOSIS_CHECKS as readonly string[]).includes(value);
}

export function isDiagnosisFixId(value: unknown): value is DiagnosisFixId {
  return typeof value === 'string' && (DIAGNOSIS_FIXES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/diagnosis.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/diagnosis.ts src/shared/diagnosis.test.ts
git commit -m "feat(diagnosis): shared check, fix and verdict types" -m "One-click printer diagnosis runs six checks in a fixed order, print service first because nothing else can be read without it. Verdict text and button labels come from the main process; the renderer only shows them." -m "$TRAILER"
```

---

### Task 2: 事实模型、账本和队列归类

队列里的任务只有提交人和提交时间，认不出是哪个程序发的。本程序每交一张给驱动就记一个时间段；「本程序的任务」= 提交人是当前用户 + 提交时间落在某个时间段里（前后各放 2 秒）。

**Files:**
- Create: `src/core/diagnosis/diagnosis-model.ts`
- Create: `src/core/diagnosis/submitted-jobs.ts`、`src/core/diagnosis/submitted-jobs.test.ts`
- Create: `src/core/diagnosis/queue-summary.ts`、`src/core/diagnosis/queue-summary.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/diagnosis/submitted-jobs.test.ts
import { describe, expect, test } from 'bun:test';
import { FAKE_CLOCK_START, FakeClock } from '../testing/fake-clock';
import { SUBMITTED_JOBS_KEPT, SUBMITTED_JOBS_TTL_MS, SubmittedJobs } from './submitted-jobs';

describe('SubmittedJobs', () => {
  test('records from the call into the driver until the driver answered', () => {
    const clock = new FakeClock();
    const jobs = new SubmittedJobs(clock);
    clock.advance(1_500);
    jobs.record('标签机A', FAKE_CLOCK_START);
    expect(jobs.windowsFor('标签机A')).toEqual([
      { printerName: '标签机A', startedAtMs: FAKE_CLOCK_START, finishedAtMs: FAKE_CLOCK_START + 1_500 },
    ]);
    expect(jobs.windowsFor('面单机B')).toEqual([]);
  });

  test('forgets entries older than a day and keeps only the latest ones', () => {
    const clock = new FakeClock();
    const jobs = new SubmittedJobs(clock);
    jobs.record('标签机A', clock.now());
    clock.advance(SUBMITTED_JOBS_TTL_MS + 1);
    expect(jobs.windowsFor('标签机A')).toEqual([]);
    for (let index = 0; index <= SUBMITTED_JOBS_KEPT; index += 1) {
      jobs.record('标签机A', clock.now());
    }
    expect(jobs.windowsFor('标签机A')).toHaveLength(SUBMITTED_JOBS_KEPT);
  });
});
```

```ts
// src/core/diagnosis/queue-summary.test.ts
import { describe, expect, test } from 'bun:test';
import type { QueueJob } from './diagnosis-model';
import { isOwnJob, isStuck, STUCK_JOB_AGE_MS, SUBMIT_TIME_SKEW_MS, summarizeQueue } from './queue-summary';

const NOW = 1_790_000_000_000;
const WINDOW = { printerName: '标签机A', startedAtMs: NOW - 10_000, finishedAtMs: NOW - 9_000 };

function job(overrides: Partial<QueueJob> = {}): QueueJob {
  return { id: 1, document: 'CL5640', user: 'shop', submittedAtMs: NOW - 9_500, flags: [], ...overrides };
}

describe('isStuck', () => {
  test('is stuck when the driver reports an error or the job waited too long', () => {
    expect(isStuck(job({ flags: ['printing'] }), NOW)).toBe(false);
    expect(isStuck(job({ flags: ['paper-out'] }), NOW)).toBe(true);
    expect(isStuck(job({ submittedAtMs: NOW - STUCK_JOB_AGE_MS - 1 }), NOW)).toBe(true);
  });
});

describe('isOwnJob', () => {
  test('matches the current user and a submit time inside a window we recorded', () => {
    expect(isOwnJob(job(), 'shop', [WINDOW])).toBe(true);
    expect(isOwnJob(job({ user: 'SHOP' }), 'shop', [WINDOW])).toBe(true);
    // Windows 有时带域名：DOMAIN\shop。
    expect(isOwnJob(job({ user: 'SHOPPC\\shop' }), 'shop', [WINDOW])).toBe(true);
    expect(isOwnJob(job({ user: 'someone' }), 'shop', [WINDOW])).toBe(false);
  });

  test('allows a small clock skew around the window, not more', () => {
    expect(isOwnJob(job({ submittedAtMs: WINDOW.finishedAtMs + SUBMIT_TIME_SKEW_MS }), 'shop', [WINDOW])).toBe(true);
    expect(isOwnJob(job({ submittedAtMs: WINDOW.finishedAtMs + SUBMIT_TIME_SKEW_MS + 1 }), 'shop', [WINDOW])).toBe(
      false,
    );
  });
});

describe('summarizeQueue', () => {
  test('counts stuck jobs, ours among them and how long the oldest waited', () => {
    const facts = {
      kind: 'listed' as const,
      currentUser: 'shop',
      total: 3,
      jobs: [
        job({ id: 1, flags: ['error'] }),
        job({ id: 2, user: 'someone', submittedAtMs: NOW - 300_000, flags: ['error'] }),
        job({ id: 3, flags: ['printing'], submittedAtMs: NOW - 1_000 }),
      ],
    };
    const summary = summarizeQueue(facts, [WINDOW], NOW);
    expect(summary.stuck).toBe(2);
    expect(summary.ownStuck).toBe(1);
    expect(summary.own.map((item) => item.id)).toEqual([1]);
    expect(summary.oldestStuckAgeMs).toBe(300_000);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/diagnosis`
Expected: FAIL，`Cannot find module './submitted-jobs'`。

- [ ] **Step 3: 实现**

```ts
// src/core/diagnosis/diagnosis-model.ts
import type { DiagnosisFixId } from '../../shared/diagnosis';
import type { PaperSize } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';

/** 诊断按哪个系统说话：命令、名词、能做的修复都不一样。other = 这个系统不支持诊断。 */
export type DiagnosisPlatform = 'windows' | 'mac' | 'other';

/** 查不到：reason 是英文，写日志给开发者看；界面统一说「查不到」。 */
export interface UnknownFacts {
  kind: 'unknown';
  reason: string;
}

/** macOS 上这台打印机在 CUPS 里是否启用、是否接收任务。 */
export interface MacQueueState {
  enabled: boolean;
  acceptingJobs: boolean;
}

/** 后台打印服务：Windows 的 Spooler 服务；macOS 的 CUPS 调度程序（和这台打印机在 CUPS 里的启用状态）。 */
export type SpoolerFacts =
  | {
      kind: 'windows';
      state: 'running' | 'stopped' | 'pending' | 'other';
      startType: 'automatic' | 'manual' | 'disabled' | 'other';
    }
  | { kind: 'mac'; schedulerRunning: boolean; queue: MacQueueState | null }
  | UnknownFacts;

/** 驱动（或 CUPS）报告的这台打印机的状态。paused：Windows 上打印机被设成「暂停打印」。 */
export type PrinterFacts =
  | { kind: 'known'; readiness: PrinterReadiness; paused: boolean; driverName: string | null }
  | UnknownFacts;

/**
 * USB：present 系统能看到它的 USB 设备；disconnected 系统记得这个设备但现在没连上；
 * problem 设备在但系统报告问题（Windows 设备管理器的问题代码）；not-found 是 USB 端口但找不到对应设备；
 * not-usb 不是 USB 连接（网络、蓝牙或厂家自己的端口），这一项不适用。
 */
export type UsbFacts =
  | { kind: 'present'; deviceName: string }
  | { kind: 'disconnected'; deviceName: string }
  | { kind: 'problem'; deviceName: string; code: number }
  | { kind: 'not-found'; port: string }
  | { kind: 'not-usb'; port: string }
  | UnknownFacts;

export const JOB_FLAGS = [
  'error',
  'paused',
  'offline',
  'paper-out',
  'blocked',
  'user-intervention',
  'held',
  'stopped',
  'printing',
] as const;
/** 任务状态，两个平台统一成这几种（Windows 的 JobStatus、CUPS 的 job-state / job-state-reasons）。 */
export type JobFlag = (typeof JOB_FLAGS)[number];

/** 队列里的一个任务。 */
export interface QueueJob {
  id: number;
  /** 文档名（本程序发的是标签内容），只用来写日志。 */
  document: string;
  user: string;
  submittedAtMs: number;
  flags: JobFlag[];
}

/** total 是队列里的总数；jobs 最多 DIAGNOSIS_LIMITS.jobs 个。 */
export type QueueFacts = { kind: 'listed'; currentUser: string; total: number; jobs: QueueJob[] } | UnknownFacts;

/** 5a 的三种指令集。 */
export type CommandSetName = 'tspl' | 'zpl' | 'epl';

/**
 * 一个修复动作的结果。done 只说明系统命令做完了；needs-admin：以当前用户做被系统拒绝；
 * no-matching-paper：驱动里没有这种纸，也不能自定义（没有弹管理员确认）；rolled-back：改了但回读不对，已恢复。
 */
export type ActionResult =
  | { kind: 'done'; count?: number }
  | { kind: 'declined' }
  | { kind: 'needs-admin' }
  | { kind: 'rolled-back' }
  | { kind: 'no-matching-paper' }
  | { kind: 'failed'; detail: string };

/** 主进程校验过的修复请求（paperKey 已换成纸张）。 */
export interface DiagnosisFixRequest {
  printerName: string | null;
  fix: DiagnosisFixId;
  admin: boolean;
  paper: PaperSize | null;
}

/** 系统命令输出的上限：输出不可信（打印机名、文档名来自别的程序），条数和字数都限住。 */
export const DIAGNOSIS_LIMITS = {
  /** 队列里最多看 100 个任务：标签机的队列正常时是空的，100 个足够说明「堵住了」。 */
  jobs: 100,
  /** USB 打印设备最多看 50 个：一台电脑接过的打印机不会更多。 */
  usbDevices: 50,
  /** 驱动纸张选项最多看 200 种：热敏标签机驱动常带几十到一百多种预设。 */
  paperOptions: 200,
  /** 文字字段（文档名、设备名、驱动名）最多 200 个字符：只用来显示和写日志。 */
  textLength: 200,
} as const;
```

```ts
// src/core/diagnosis/submitted-jobs.ts
import type { Clock } from '../types';

/** 本程序交给打印队列的一张：从调用驱动到驱动回调的时间段。 */
export interface SubmittedWindow {
  printerName: string;
  startedAtMs: number;
  finishedAtMs: number;
}

/** 记多少张：一台电脑一天打几百张，500 张够覆盖「刚才卡住的那几张」。 */
export const SUBMITTED_JOBS_KEPT = 500;
/** 记多久：卡了一天以上的任务不再认作本程序的（时间对得上也可能是巧合），交给「清除全部任务」。 */
export const SUBMITTED_JOBS_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * 本程序发出的打印任务的账本，只在内存里，重启清空（重启前卡住的任务由「清除全部任务」处理）。
 * 打印队列里的任务只有提交人和提交时间，认不出是哪个程序发的：按「提交人是当前用户 +
 * 提交时间落在本程序某次交任务的时间段里」认（queue-summary.ts 的 isOwnJob）。
 */
export class SubmittedJobs {
  private readonly windows: SubmittedWindow[] = [];

  constructor(private readonly clock: Clock) {}

  /** 驱动回调成功（任务进了系统的打印队列）后调用；startedAtMs 是调用驱动之前取的时间。 */
  record(printerName: string, startedAtMs: number): void {
    this.windows.push({ printerName, startedAtMs, finishedAtMs: this.clock.now() });
    if (this.windows.length > SUBMITTED_JOBS_KEPT) {
      this.windows.splice(0, this.windows.length - SUBMITTED_JOBS_KEPT);
    }
  }

  /** 这台打印机一天内的时间段。 */
  windowsFor(printerName: string): SubmittedWindow[] {
    const oldest = this.clock.now() - SUBMITTED_JOBS_TTL_MS;
    return this.windows.filter((window) => window.printerName === printerName && window.finishedAtMs >= oldest);
  }
}
```

```ts
// src/core/diagnosis/queue-summary.ts
import { PRINT_TIMEOUT_MS } from '../../shared/print-timing';
import type { JobFlag, QueueFacts, QueueJob } from './diagnosis-model';
import type { SubmittedWindow } from './submitted-jobs';

/** 任务在队列里超过这么久算卡住：单张打印的超时是 30 秒（PRINT_TIMEOUT_MS），再等一倍还没打完，不会是正常排队。 */
export const STUCK_JOB_AGE_MS = 2 * PRINT_TIMEOUT_MS;
/** 认「是不是本程序发的」时提交时间的误差：CUPS 的提交时间只到秒，系统记时间的时刻也和我们记的不完全一样。 */
export const SUBMIT_TIME_SKEW_MS = 2_000;

/** 这些状态说明任务停住了，不用等到超时。 */
const STOPPED_FLAGS: ReadonlySet<JobFlag> = new Set<JobFlag>([
  'error',
  'paused',
  'offline',
  'paper-out',
  'blocked',
  'user-intervention',
  'held',
  'stopped',
]);

export function isStuck(job: QueueJob, nowMs: number): boolean {
  return job.flags.some((flag) => STOPPED_FLAGS.has(flag)) || nowMs - job.submittedAtMs > STUCK_JOB_AGE_MS;
}

/** 用户名不分大小写，去掉 Windows 可能带的「域名\」前缀。 */
function userKey(name: string): string {
  return (name.split('\\').at(-1) ?? name).toLowerCase();
}

/** 提交人是当前用户，且提交时间落在本程序某次交任务的时间段里（前后各放 SUBMIT_TIME_SKEW_MS）。 */
export function isOwnJob(job: QueueJob, currentUser: string, windows: readonly SubmittedWindow[]): boolean {
  if (userKey(job.user) !== userKey(currentUser)) {
    return false;
  }
  return windows.some(
    (window) =>
      job.submittedAtMs >= window.startedAtMs - SUBMIT_TIME_SKEW_MS &&
      job.submittedAtMs <= window.finishedAtMs + SUBMIT_TIME_SKEW_MS,
  );
}

/** 队列汇总：stuck、ownStuck 只数列出来的任务；own 是本程序的全部任务（卡没卡都算，清的时候一起清）。 */
export interface QueueSummary {
  total: number;
  listed: number;
  stuck: number;
  ownStuck: number;
  own: QueueJob[];
  /** 卡住的任务里最早的等了多久；没有卡住的为 null。 */
  oldestStuckAgeMs: number | null;
}

export function summarizeQueue(
  facts: Extract<QueueFacts, { kind: 'listed' }>,
  windows: readonly SubmittedWindow[],
  nowMs: number,
): QueueSummary {
  const stuck = facts.jobs.filter((job) => isStuck(job, nowMs));
  const own = facts.jobs.filter((job) => isOwnJob(job, facts.currentUser, windows));
  const oldest = stuck.reduce<number | null>(
    (earliest, job) => (earliest === null || job.submittedAtMs < earliest ? job.submittedAtMs : earliest),
    null,
  );
  return {
    total: facts.total,
    listed: facts.jobs.length,
    stuck: stuck.length,
    ownStuck: stuck.filter((job) => own.includes(job)).length,
    own,
    oldestStuckAgeMs: oldest === null ? null : nowMs - oldest,
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/diagnosis`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/diagnosis
git commit -m "feat(diagnosis): facts model, submitted-job ledger and queue summary" -m "Print queues only know who submitted a job and when, not which program did. The app records each hand-off to the driver, so a job by the current user inside one of those windows is ours and can be cleared without admin rights." -m "$TRAILER"
```

---

### Task 3: 驱动纸张怎么选

Windows：在驱动的 PrintCapabilities 里找尺寸一致（差 1mm 以内，和 `isSamePaper` 一样）的纸张选项，找不到但驱动支持自定义尺寸就用自定义；macOS：在 CUPS 的 `media-supported`（PWG 自描述纸张名，最后一段是尺寸）里找，找不到但有 `custom_min_` / `custom_max_` 范围就用 PWG 自定义名。都没有就返回 null（不弹管理员确认，直接说明）。

**Files:**
- Create: `src/core/diagnosis/paper-choice.ts`、`src/core/diagnosis/paper-choice.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/diagnosis/paper-choice.test.ts
import { describe, expect, test } from 'bun:test';
import { chooseCupsMedia, choosePrintTicketPaper, pwgMediaSize } from './paper-choice';

const LABEL = { widthMm: 60, heightMm: 40 };
const DRIVER_NS = 'urn:labelflash-test:label-driver';

describe('choosePrintTicketPaper', () => {
  test('picks the driver option of the same size, the closest one when several fit', () => {
    const options = {
      options: [
        { namespace: DRIVER_NS, localName: 'ISOA4', widthMicrons: 210_000, heightMicrons: 297_000 },
        { namespace: DRIVER_NS, localName: 'Label60x40a', widthMicrons: 60_800, heightMicrons: 40_000 },
        { namespace: DRIVER_NS, localName: 'Label60x40', widthMicrons: 60_000, heightMicrons: 40_100 },
      ],
      supportsCustom: true,
    };
    expect(choosePrintTicketPaper(options, LABEL)).toEqual({
      kind: 'option',
      namespace: DRIVER_NS,
      localName: 'Label60x40',
    });
  });

  test('falls back to a custom size, or gives up when the driver has neither', () => {
    const none = { options: [{ namespace: DRIVER_NS, localName: 'ISOA4', widthMicrons: 210_000, heightMicrons: 297_000 }] };
    expect(choosePrintTicketPaper({ ...none, supportsCustom: true }, LABEL)).toEqual({
      kind: 'custom',
      widthMicrons: 60_000,
      heightMicrons: 40_000,
    });
    expect(choosePrintTicketPaper({ ...none, supportsCustom: false }, LABEL)).toBeNull();
  });

  // 宽高要和模板的方向一致（和 checkDriverPaper 一样），40×60 的选项不算。
  test('does not take a rotated size', () => {
    const rotated = {
      options: [{ namespace: DRIVER_NS, localName: 'Label40x60', widthMicrons: 40_000, heightMicrons: 60_000 }],
      supportsCustom: false,
    };
    expect(choosePrintTicketPaper(rotated, LABEL)).toBeNull();
  });
});

describe('pwgMediaSize', () => {
  test('reads the size at the end of a PWG self-describing name', () => {
    expect(pwgMediaSize('om_60x40mm_60x40mm')).toEqual({ widthMm: 60, heightMm: 40 });
    expect(pwgMediaSize('oe_4x6-label_4x6in')).toEqual({ widthMm: 101.6, heightMm: 152.4 });
    expect(pwgMediaSize('Letter')).toBeNull();
  });
});

describe('chooseCupsMedia', () => {
  test('picks a supported media of the same size', () => {
    expect(chooseCupsMedia(['iso_a4_210x297mm', 'om_60x40mm_60x40mm'], LABEL)).toBe('om_60x40mm_60x40mm');
  });

  test('uses a custom size inside the supported range, nothing outside it', () => {
    const ranged = ['oe_4x6-label_4x6in', 'custom_min_25.4x12.7mm', 'custom_max_104x990mm'];
    expect(chooseCupsMedia(ranged, LABEL)).toBe('custom_60x40mm_60x40mm');
    expect(chooseCupsMedia(ranged, { widthMm: 120, heightMm: 40 })).toBeNull();
    expect(chooseCupsMedia(['iso_a4_210x297mm'], LABEL)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/diagnosis/paper-choice.test.ts`
Expected: FAIL，`Cannot find module './paper-choice'`。

- [ ] **Step 3: 实现**

```ts
// src/core/diagnosis/paper-choice.ts
import { isSamePaper, type PaperSize } from '../../shared/paper-sizes';

const MICRONS_PER_MM = 1_000;
const MM_PER_INCH = 25.4;
/** 毫米保留两位小数写进纸张名：PWG 名字里的尺寸就是这个精度。 */
const HUNDREDTHS_PER_MM = 100;

/** 写进 PrintTicket 的选项名（XML 的 NCName，只收 ASCII）。 */
export const PRINT_TICKET_LOCAL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
/** 选项的命名空间（URI / URN）：只收不会破坏 XML 属性的 ASCII 字符。 */
export const PRINT_TICKET_NAMESPACE_PATTERN = /^[A-Za-z0-9:/._~%#?=+-]{1,256}$/;
/** CUPS 的纸张名（PWG 5101.1 的自描述名都是小写）。 */
export const CUPS_MEDIA_KEYWORD_PATTERN = /^[a-z0-9_.-]{1,64}$/;

/** 驱动 PrintCapabilities 里 PageMediaSize 的一个选项；尺寸以微米计，自定义尺寸那一项没有尺寸。 */
export interface PrintTicketPaperOption {
  namespace: string;
  localName: string;
  widthMicrons: number | null;
  heightMicrons: number | null;
}

export interface PrintTicketPaperOptions {
  options: PrintTicketPaperOption[];
  /** 驱动声明了 PageMediaSizeMediaSizeWidth 参数：能用 psk:CustomMediaSize。 */
  supportsCustom: boolean;
}

/** 要写进 PrintTicket 的纸张：驱动的一个选项，或自定义尺寸。 */
export type PrintTicketPaper =
  | { kind: 'option'; namespace: string; localName: string }
  | { kind: 'custom'; widthMicrons: number; heightMicrons: number };

function sizeError(size: PaperSize, target: PaperSize): number {
  return Math.abs(size.widthMm - target.widthMm) + Math.abs(size.heightMm - target.heightMm);
}

/**
 * 挑驱动里尺寸一致（isSamePaper，差 1mm 以内）的选项，几种都合适时取最接近的；
 * 没有就看驱动能不能自定义尺寸；都不行返回 null（这时不弹管理员确认，直接说明）。
 */
export function choosePrintTicketPaper(available: PrintTicketPaperOptions, target: PaperSize): PrintTicketPaper | null {
  let best: { option: PrintTicketPaperOption; error: number } | null = null;
  for (const option of available.options) {
    if (option.widthMicrons === null || option.heightMicrons === null) {
      continue;
    }
    const size = { widthMm: option.widthMicrons / MICRONS_PER_MM, heightMm: option.heightMicrons / MICRONS_PER_MM };
    if (!isSamePaper(size, target)) {
      continue;
    }
    const error = sizeError(size, target);
    if (best === null || error < best.error) {
      best = { option, error };
    }
  }
  if (best !== null) {
    return { kind: 'option', namespace: best.option.namespace, localName: best.option.localName };
  }
  if (available.supportsCustom) {
    return {
      kind: 'custom',
      widthMicrons: Math.round(target.widthMm * MICRONS_PER_MM),
      heightMicrons: Math.round(target.heightMm * MICRONS_PER_MM),
    };
  }
  return null;
}

const PWG_SIZE_PATTERN = /_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$/;
const CUSTOM_MIN_PREFIX = 'custom_min_';
const CUSTOM_MAX_PREFIX = 'custom_max_';

/** PWG 自描述纸张名最后一段是尺寸（例如 om_60x40mm_60x40mm、oe_4x6-label_4x6in）。 */
export function pwgMediaSize(keyword: string): PaperSize | null {
  const match = PWG_SIZE_PATTERN.exec(keyword);
  if (match === null) {
    return null;
  }
  const scale = match[3] === 'in' ? MM_PER_INCH : 1;
  return {
    widthMm: Math.round(Number(match[1]) * scale * HUNDREDTHS_PER_MM) / HUNDREDTHS_PER_MM,
    heightMm: Math.round(Number(match[2]) * scale * HUNDREDTHS_PER_MM) / HUNDREDTHS_PER_MM,
  };
}

function formatMm(mm: number): string {
  return String(Math.round(mm * HUNDREDTHS_PER_MM) / HUNDREDTHS_PER_MM);
}

/**
 * 在 CUPS 的 media-supported 里挑尺寸一致的纸张名；没有时，若打印机声明了自定义尺寸范围
 * （custom_min_… / custom_max_…）且目标在范围内，用 PWG 的自定义名 custom_<名字>_<宽>x<高>mm。
 */
export function chooseCupsMedia(supported: readonly string[], target: PaperSize): string | null {
  let best: { keyword: string; error: number } | null = null;
  for (const keyword of supported) {
    if (keyword.startsWith(CUSTOM_MIN_PREFIX) || keyword.startsWith(CUSTOM_MAX_PREFIX)) {
      continue;
    }
    const size = pwgMediaSize(keyword);
    if (size === null || !isSamePaper(size, target) || !CUPS_MEDIA_KEYWORD_PATTERN.test(keyword)) {
      continue;
    }
    const error = sizeError(size, target);
    if (best === null || error < best.error) {
      best = { keyword, error };
    }
  }
  if (best !== null) {
    return best.keyword;
  }
  const min = supported.find((keyword) => keyword.startsWith(CUSTOM_MIN_PREFIX));
  const max = supported.find((keyword) => keyword.startsWith(CUSTOM_MAX_PREFIX));
  const minSize = min === undefined ? null : pwgMediaSize(min);
  const maxSize = max === undefined ? null : pwgMediaSize(max);
  if (minSize === null || maxSize === null) {
    return null;
  }
  const fits =
    target.widthMm >= minSize.widthMm &&
    target.widthMm <= maxSize.widthMm &&
    target.heightMm >= minSize.heightMm &&
    target.heightMm <= maxSize.heightMm;
  const dimensions = `${formatMm(target.widthMm)}x${formatMm(target.heightMm)}mm`;
  return fits ? `custom_${dimensions}_${dimensions}` : null;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/diagnosis/paper-choice.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/diagnosis/paper-choice.ts src/core/diagnosis/paper-choice.test.ts
git commit -m "feat(diagnosis): choose the driver paper that matches the assigned paper" -m "Picks a driver PrintTicket option or a CUPS PWG media name of the same size, and falls back to a custom size only when the driver declares one. When nothing fits we say so instead of asking for admin rights." -m "$TRAILER"
```

---

### Task 4: 修复的管理员策略、按钮和结果文字

**Files:**
- Create: `src/core/diagnosis/fixes.ts`、`src/core/diagnosis/fixes.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/diagnosis/fixes.test.ts
import { describe, expect, test } from 'bun:test';
import { DIAGNOSIS_FIXES } from '../../shared/diagnosis';
import type { DiagnosisFixRequest } from './diagnosis-model';
import { adminPolicy, fixOutcome, offerFor } from './fixes';

const REQUEST: DiagnosisFixRequest = { printerName: '标签机A', fix: 'cancel-all-jobs', admin: true, paper: null };

describe('adminPolicy', () => {
  test('asks for admin rights exactly where the system requires them', () => {
    expect(adminPolicy('windows', 'restart-spooler')).toBe('always');
    expect(adminPolicy('windows', 'cancel-own-jobs')).toBe('never');
    expect(adminPolicy('mac', 'enable-printer')).toBe('optional');
    expect(adminPolicy('mac', 'set-driver-paper')).toBe('optional');
  });

  test('offers no fix the platform cannot do', () => {
    expect(adminPolicy('windows', 'enable-printer')).toBe('unsupported');
    expect(adminPolicy('mac', 'open-queue')).toBe('unsupported');
    for (const fix of DIAGNOSIS_FIXES) {
      expect(adminPolicy('other', fix)).toBe('unsupported');
    }
  });
});

describe('offerFor', () => {
  test('marks every admin button the same way on both platforms', () => {
    expect(offerFor('windows', 'cancel-all-jobs')).toEqual({
      id: 'cancel-all-jobs',
      label: '清除全部任务（需要管理员权限）',
      admin: true,
    });
    expect(offerFor('mac', 'cancel-all-jobs')?.label).toBe('清除全部任务（需要管理员权限）');
    expect(offerFor('mac', 'set-driver-paper')).toEqual({ id: 'set-driver-paper', label: '自动设置驱动纸张', admin: false });
    expect(offerFor('mac', 'set-driver-paper', true)?.label).toBe('自动设置驱动纸张（需要管理员权限）');
    expect(offerFor('mac', 'open-queue')).toBeNull();
    expect(offerFor('windows', 'change-command-set')).toEqual({ id: 'change-command-set', label: '改指令集', admin: false });
  });
});

describe('fixOutcome', () => {
  test('says what was done, not that the problem is solved', () => {
    expect(fixOutcome('windows', { ...REQUEST, fix: 'cancel-own-jobs', admin: false }, { kind: 'done', count: 2 })).toEqual({
      status: 'done',
      message: '已请求取消本程序的 2 个任务',
    });
    expect(
      fixOutcome('windows', { ...REQUEST, fix: 'set-driver-paper', paper: { widthMm: 60, heightMm: 40 } }, { kind: 'done' })
        .message,
    ).toBe('驱动默认纸张已设为 60×40mm');
  });

  test('turns a refusal into an admin button to retry with', () => {
    const outcome = fixOutcome('mac', { ...REQUEST, fix: 'enable-printer', admin: false }, { kind: 'needs-admin' });
    expect(outcome).toMatchObject({
      status: 'needs-admin',
      retry: { id: 'enable-printer', label: '恢复这台打印机（需要管理员权限）', admin: true },
    });
  });

  test('explains a declined prompt and a missing paper size without technical detail', () => {
    expect(fixOutcome('windows', REQUEST, { kind: 'declined' }).message).toContain('没有拿到管理员权限');
    expect(
      fixOutcome('windows', { ...REQUEST, fix: 'set-driver-paper', paper: { widthMm: 60, heightMm: 40 } }, {
        kind: 'no-matching-paper',
      }),
    ).toEqual({
      status: 'failed',
      message: '驱动里没有 60×40mm 这种纸，也不能自定义尺寸：打开打印首选项，新建这种纸再选上',
    });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/diagnosis/fixes.test.ts`
Expected: FAIL，`Cannot find module './fixes'`。

- [ ] **Step 3: 实现**

```ts
// src/core/diagnosis/fixes.ts
import {
  CHANGE_COMMAND_SET,
  type DiagnosisFixId,
  type DiagnosisOfferId,
  type FixOffer,
  type FixOutcome,
} from '../../shared/diagnosis';
import { formatPaperSize } from '../../shared/driver-paper';
import type { PaperSize } from '../../shared/paper-sizes';
import type { ActionResult, DiagnosisFixRequest, DiagnosisPlatform } from './diagnosis-model';

/**
 * always：一定弹管理员确认；optional：先以当前用户做，系统拒绝时再换成管理员按钮（macOS 的 CUPS：
 * 管理员组的用户本来就能改，普通用户才要密码）；never：不要管理员；unsupported：这个系统上没有这个修复。
 */
export type AdminPolicy = 'always' | 'optional' | 'never' | 'unsupported';

const WINDOWS_POLICY: Readonly<Record<DiagnosisFixId, AdminPolicy>> = {
  'open-preferences': 'never',
  'reinstall-driver': 'always',
  'restart-spooler': 'always',
  'enable-printer': 'unsupported',
  'open-queue': 'never',
  'cancel-own-jobs': 'never',
  // 别人的任务（包括别的账户的）要「管理文档」权限；一律按管理员做，不猜队列里是谁的。
  'cancel-all-jobs': 'always',
  // 改的是打印机的默认设置（DefaultPrintTicket），要「管理打印机」权限。
  'set-driver-paper': 'always',
  feed: 'never',
  calibrate: 'never',
};

const MAC_POLICY: Readonly<Record<DiagnosisFixId, AdminPolicy>> = {
  'open-preferences': 'never',
  'reinstall-driver': 'always',
  // cupsd 由 launchd 管，重启要 root。
  'restart-spooler': 'always',
  'enable-printer': 'optional',
  'open-queue': 'unsupported',
  'cancel-own-jobs': 'never',
  'cancel-all-jobs': 'always',
  'set-driver-paper': 'optional',
  feed: 'never',
  calibrate: 'never',
};

export function adminPolicy(platform: DiagnosisPlatform, fix: DiagnosisFixId): AdminPolicy {
  switch (platform) {
    case 'windows':
      return WINDOWS_POLICY[fix];
    case 'mac':
      return MAC_POLICY[fix];
    case 'other':
      return 'unsupported';
  }
}

/** 要管理员权限的按钮统一加这一句：Windows 弹 UAC、macOS 弹管理员密码框，两边都是「管理员权限」。 */
const ADMIN_SUFFIX = '（需要管理员权限）';

const LABELS: Readonly<Record<DiagnosisOfferId, string>> = {
  'open-preferences': '打开打印首选项',
  'reinstall-driver': '重新安装驱动',
  'restart-spooler': '重启后台打印服务',
  'enable-printer': '恢复这台打印机',
  'open-queue': '打开打印队列',
  'cancel-own-jobs': '清除本程序的任务',
  'cancel-all-jobs': '清除全部任务',
  'set-driver-paper': '自动设置驱动纸张',
  feed: '走一张纸',
  calibrate: '纸张校准',
  [CHANGE_COMMAND_SET]: '改指令集',
};

function labelOf(platform: DiagnosisPlatform, id: DiagnosisOfferId): string {
  // macOS 没有叫「后台打印服务」的东西：说它真正的名字。
  return platform === 'mac' && id === 'restart-spooler' ? '重启打印系统' : LABELS[id];
}

/**
 * 结论下面的按钮；这个系统上没有的修复返回 null。
 * admin 只对 optional 的修复有意义：false 是先以当前用户做的按钮，true 是系统拒绝后换上的管理员按钮。
 */
export function offerFor(platform: DiagnosisPlatform, id: DiagnosisOfferId, admin = false): FixOffer | null {
  if (id === CHANGE_COMMAND_SET) {
    return { id, label: LABELS[id], admin: false };
  }
  const policy = adminPolicy(platform, id);
  if (policy === 'unsupported') {
    return null;
  }
  const isAdmin = policy === 'always' || (policy === 'optional' && admin);
  return { id, label: `${labelOf(platform, id)}${isAdmin ? ADMIN_SUFFIX : ''}`, admin: isAdmin };
}

const DECLINED_MESSAGE = '没有拿到管理员权限（确认框里选了「否」或关掉了），什么都没改';
const NEEDS_ADMIN_MESSAGE = '系统要求管理员权限才能做这一步：点下面换上的按钮，按提示确认';
const ROLLED_BACK_MESSAGE = '设置之后回读的纸张不对，已恢复原来的设置：打开打印首选项手动改';

function paperText(paper: PaperSize | null): string {
  return paper === null ? '这种纸' : formatPaperSize(paper);
}

function doneMessage(platform: DiagnosisPlatform, request: DiagnosisFixRequest, count: number | null): string {
  switch (request.fix) {
    case 'open-preferences':
      // Windows 的「打印首选项」关掉才返回；macOS 打开系统设置就返回，改完要操作员自己回来重查。
      return platform === 'mac'
        ? '已打开「打印机与扫描仪」：改完回到程序，点「重新检查」'
        : '打印首选项已关闭，正在重新检查';
    case 'reinstall-driver':
      return '驱动已重新安装，正在重新检查';
    case 'restart-spooler':
      return platform === 'mac' ? '已请求重启打印系统' : '后台打印服务已重新启动';
    case 'enable-printer':
      return '已请求恢复这台打印机';
    case 'open-queue':
      return '打印队列窗口已关闭，正在重新检查';
    case 'cancel-own-jobs':
      return count === null || count === 0 ? '队列里已经没有本程序的任务' : `已请求取消本程序的 ${count} 个任务`;
    case 'cancel-all-jobs':
      return '已请求清空这台打印机的队列';
    case 'set-driver-paper':
      return `驱动默认纸张已设为 ${paperText(request.paper)}`;
    case 'feed':
      return '走纸指令已发送（进了打印队列）';
    case 'calibrate':
      return '校准指令已发送（进了打印队列）';
  }
}

/** 动作结果 → 给操作员看的话。needs-admin 附上换上的管理员按钮；这个修复没有管理员版本时是程序错误，直接抛。 */
export function fixOutcome(platform: DiagnosisPlatform, request: DiagnosisFixRequest, result: ActionResult): FixOutcome {
  switch (result.kind) {
    case 'done':
      return { status: 'done', message: doneMessage(platform, request, result.count ?? null) };
    case 'declined':
      return { status: 'declined', message: DECLINED_MESSAGE };
    case 'needs-admin': {
      const retry = offerFor(platform, request.fix, true);
      if (retry === null || !retry.admin) {
        throw new Error(`Fix "${request.fix}" has no admin variant on ${platform}`);
      }
      return { status: 'needs-admin', message: NEEDS_ADMIN_MESSAGE, retry };
    }
    case 'rolled-back':
      return { status: 'rolled-back', message: ROLLED_BACK_MESSAGE };
    case 'no-matching-paper':
      return {
        status: 'failed',
        message: `驱动里没有 ${paperText(request.paper)} 这种纸，也不能自定义尺寸：打开打印首选项，新建这种纸再选上`,
      };
    case 'failed':
      return { status: 'failed', message: `没做成：${result.detail}` };
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/diagnosis/fixes.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/diagnosis/fixes.ts src/core/diagnosis/fixes.test.ts
git commit -m "feat(diagnosis): admin policy, labels and outcome text for fixes" -m "Admin rights are asked for only where the system requires them, and every such button says so in the same words on Windows and macOS. Outcomes say what was done; whether it helped is left to the recheck." -m "$TRAILER"
```

---

### Task 5: 检查结论

**Files:**
- Create: `src/core/diagnosis/verdicts.ts`、`src/core/diagnosis/verdicts.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/diagnosis/verdicts.test.ts
import { describe, expect, test } from 'bun:test';
import type { QueueJob } from './diagnosis-model';
import {
  commandsVerdict,
  formatAge,
  missingPrinterVerdict,
  paperVerdict,
  printerVerdict,
  queueVerdict,
  spoolerVerdict,
  usbVerdict,
} from './verdicts';

const NOW = 1_790_000_000_000;
const LABEL = { widthMm: 60, heightMm: 40 };
const ids = (fixes: { id: string }[]) => fixes.map((fix) => fix.id);

describe('spoolerVerdict', () => {
  test('Windows: running passes, stopped or disabled offers an admin restart', () => {
    expect(spoolerVerdict({ kind: 'windows', state: 'running', startType: 'automatic' }, 'windows')).toMatchObject({
      status: 'pass',
      detail: '后台打印服务（Print Spooler）在运行',
    });
    const disabled = spoolerVerdict({ kind: 'windows', state: 'stopped', startType: 'disabled' }, 'windows');
    expect(disabled).toMatchObject({ status: 'fail', detail: '后台打印服务被禁用了：所有打印都发不出去' });
    expect(disabled.fixes).toEqual([{ id: 'restart-spooler', label: '重启后台打印服务（需要管理员权限）', admin: true }]);
  });

  test('macOS: a paused printer is restored as the current user first', () => {
    const paused = spoolerVerdict({ kind: 'mac', schedulerRunning: true, queue: { enabled: false, acceptingJobs: true } }, 'mac');
    expect(paused).toMatchObject({ status: 'fail', detail: '这台打印机在系统里被暂停了：任务只进队列、不打印' });
    expect(paused.fixes).toEqual([{ id: 'enable-printer', label: '恢复这台打印机', admin: false }]);
    expect(spoolerVerdict({ kind: 'mac', schedulerRunning: false, queue: null }, 'mac').fixes[0]?.label).toBe(
      '重启打印系统（需要管理员权限）',
    );
  });

  test('says it cannot tell instead of guessing', () => {
    expect(spoolerVerdict({ kind: 'unknown', reason: 'probe failed' }, 'windows')).toMatchObject({
      status: 'unknown',
      detail: '查不到后台打印服务的状态',
    });
    expect(spoolerVerdict({ kind: 'unknown', reason: 'linux' }, 'other').detail).toBe('这个系统不支持这一项检查');
  });
});

describe('printerVerdict', () => {
  test('only says the driver reported no problem', () => {
    expect(
      printerVerdict({ kind: 'known', readiness: { ready: true }, paused: false, driverName: '热敏标签机驱动' }, 'windows', false),
    ).toMatchObject({ status: 'pass', detail: '驱动没有报告问题（驱动：热敏标签机驱动）' });
  });

  test('tells the operator what to do for the reported problem', () => {
    const paperOut = printerVerdict(
      { kind: 'known', readiness: { ready: false, detail: '缺纸', issue: 'paperOut' }, paused: false, driverName: null },
      'windows',
      false,
    );
    expect(paperOut).toMatchObject({ status: 'fail', detail: '驱动报告：缺纸' });
    expect(paperOut.nextStep).toContain('装好标签纸');
    expect(ids(paperOut.fixes)).toEqual(['open-preferences']);
  });

  test('offers a driver reinstall only when 5c can do it', () => {
    const facts = {
      kind: 'known' as const,
      readiness: { ready: false as const, detail: '打印机报错', issue: 'other' as const },
      paused: false,
      driverName: null,
    };
    expect(ids(printerVerdict(facts, 'windows', true).fixes)).toEqual(['open-preferences', 'reinstall-driver']);
    expect(ids(printerVerdict(facts, 'windows', false).fixes)).toEqual(['open-preferences']);
  });

  test('a paused Windows printer is resumed from the queue window', () => {
    const paused = printerVerdict(
      { kind: 'known', readiness: { ready: false, detail: '打印机已暂停', issue: 'other' }, paused: true, driverName: null },
      'windows',
      false,
    );
    expect(ids(paused.fixes)).toEqual(['open-queue']);
  });
});

describe('usbVerdict', () => {
  test('passes when the system sees the device and advises the cable when it does not', () => {
    expect(usbVerdict({ kind: 'present', deviceName: '热敏标签机' }, 'windows', false)).toMatchObject({
      status: 'pass',
      detail: '系统能看到它的 USB 设备（热敏标签机）',
    });
    const gone = usbVerdict({ kind: 'disconnected', deviceName: '热敏标签机' }, 'windows', false);
    expect(gone.status).toBe('fail');
    expect(gone.nextStep).toContain('换一个 USB 口');
  });

  test('a device without a driver is a reinstall when 5c is there', () => {
    const noDriver = usbVerdict({ kind: 'problem', deviceName: '热敏标签机', code: 28 }, 'windows', true);
    expect(noDriver.detail).toBe('它的 USB 设备（热敏标签机）没有装驱动');
    expect(ids(noDriver.fixes)).toEqual(['reinstall-driver']);
  });

  test('skips printers that are not on a system USB port', () => {
    expect(usbVerdict({ kind: 'not-usb', port: 'WSD-1' }, 'windows', false)).toMatchObject({ status: 'skipped' });
  });
});

describe('queueVerdict', () => {
  const job = (overrides: Partial<QueueJob>): QueueJob => ({
    id: 1,
    document: 'CL5640',
    user: 'shop',
    submittedAtMs: NOW - 300_000,
    flags: ['error'],
    ...overrides,
  });
  const window = { printerName: '标签机A', startedAtMs: NOW - 301_000, finishedAtMs: NOW - 299_000 };

  test('an empty queue passes', () => {
    expect(queueVerdict({ kind: 'listed', currentUser: 'shop', total: 0, jobs: [] }, 'windows', [], NOW)).toMatchObject({
      status: 'pass',
      detail: '队列是空的',
    });
  });

  test('counts stuck jobs and offers to clear ours, all of them, or open the queue', () => {
    const facts = {
      kind: 'listed' as const,
      currentUser: 'shop',
      total: 3,
      jobs: [job({ id: 1 }), job({ id: 2 }), job({ id: 3, user: 'someone' })],
    };
    const verdict = queueVerdict(facts, 'windows', [window], NOW);
    expect(verdict).toMatchObject({
      status: 'fail',
      detail: '有 3 个任务卡在队列里（最早的已经等了 5 分钟），其中 2 个是本程序发的',
    });
    expect(ids(verdict.fixes)).toEqual(['cancel-own-jobs', 'cancel-all-jobs', 'open-queue']);
    expect(ids(queueVerdict(facts, 'mac', [window], NOW).fixes)).toEqual(['cancel-own-jobs', 'cancel-all-jobs']);
  });

  test('does not offer to clear our jobs when none are ours', () => {
    const facts = { kind: 'listed' as const, currentUser: 'shop', total: 1, jobs: [job({ user: 'someone' })] };
    const verdict = queueVerdict(facts, 'windows', [window], NOW);
    expect(verdict.detail).toBe('有 1 个任务卡在队列里（最早的已经等了 5 分钟），都不是本程序发的');
    expect(ids(verdict.fixes)).toEqual(['cancel-all-jobs', 'open-queue']);
  });
});

describe('paperVerdict', () => {
  test('compares the driver paper with the paper the printer holds', () => {
    expect(paperVerdict({ widthMm: 60, heightMm: 40, dpi: 203 }, LABEL, 'windows')).toMatchObject({
      status: 'pass',
      detail: '驱动纸张 60×40mm，和它负责的 60×40mm 一致',
    });
    const wrong = paperVerdict({ widthMm: 100, heightMm: 150, dpi: 203 }, LABEL, 'windows');
    expect(wrong.detail).toBe('驱动纸张是 100×150mm，它负责的是 60×40mm：打出来可能缩放、跳纸或出空白标签');
    expect(ids(wrong.fixes)).toEqual(['set-driver-paper', 'open-preferences']);
  });

  test('skips a printer that holds no paper', () => {
    expect(paperVerdict(null, null, 'windows')).toMatchObject({ status: 'skipped' });
  });
});

describe('commandsVerdict', () => {
  test('asks the operator to feed one label, because commands are one-way', () => {
    const verdict = commandsVerdict('tspl', 'windows');
    expect(verdict).toMatchObject({ status: 'action', detail: '指令集：TSPL。指令是单向的，程序读不到标签机的回答' });
    expect(ids(verdict.fixes)).toEqual(['feed', 'calibrate', 'change-command-set']);
  });

  test('skips when no commands are sent or this build cannot send them', () => {
    expect(ids(commandsVerdict('none', 'windows').fixes)).toEqual(['change-command-set']);
    expect(commandsVerdict(null, 'windows')).toMatchObject({ status: 'skipped', fixes: [] });
  });
});

describe('missingPrinterVerdict and formatAge', () => {
  test('a printer that left the system list is reported for every check', () => {
    expect(missingPrinterVerdict('queue')).toMatchObject({ check: 'queue', status: 'fail' });
  });

  test('formats waiting time in the largest whole unit', () => {
    expect(formatAge(45_000)).toBe('45 秒');
    expect(formatAge(5 * 60_000 + 30_000)).toBe('5 分钟');
    expect(formatAge(3 * 3_600_000)).toBe('3 小时');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/diagnosis/verdicts.test.ts`
Expected: FAIL，`Cannot find module './verdicts'`。

- [ ] **Step 3: 实现**

```ts
// src/core/diagnosis/verdicts.ts
import {
  CHANGE_COMMAND_SET,
  type CheckVerdict,
  type DiagnosisCheckId,
  type DiagnosisOfferId,
  type FixOffer,
  type VerdictStatus,
} from '../../shared/diagnosis';
import { type DriverPaper, formatPaperSize } from '../../shared/driver-paper';
import { isSamePaper, type PaperSize } from '../../shared/paper-sizes';
import type { PrinterIssue } from '../../shared/printer-readiness';
import type {
  CommandSetName,
  DiagnosisPlatform,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from './diagnosis-model';
import { offerFor } from './fixes';
import { STUCK_JOB_AGE_MS, summarizeQueue } from './queue-summary';
import type { SubmittedWindow } from './submitted-jobs';

const UNSUPPORTED_DETAIL = '这个系统不支持这一项检查';
/** 设备管理器里「没有安装驱动」的问题代码（CM_PROB_FAILED_INSTALL）。 */
const CM_PROB_FAILED_INSTALL = 28;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

const ISSUE_NEXT_STEPS: Readonly<Record<PrinterIssue, string>> = {
  paperOut: '装好标签纸、合上机盖；换了纸的话做一次纸张校准（最后一项）',
  paperJam: '打开机盖，取出卡住的标签，重新装好纸',
  doorOpen: '把机盖合上（听到咔哒一声）',
  offline: '检查标签机电源和数据线；USB 连接的看下一项',
  other: '按标签机面板上的指示灯处理；还不行就重新安装驱动',
};

const USB_NEXT_STEPS: Readonly<Record<'windows' | 'mac', string>> = {
  windows:
    '确认标签机开着；拔掉 USB 线等几秒再插上，或换一个 USB 口、换一根线。换口后 Windows 可能把它当成新的打印机（端口变成 USB002 这样），回来点「重新检查」',
  mac: '确认标签机开着；拔掉 USB 线等几秒再插上，或换一个 USB 口、换一根线，再点「重新检查」',
};

function verdict(
  check: DiagnosisCheckId,
  status: VerdictStatus,
  detail: string,
  nextStep: string | null,
  fixes: FixOffer[],
): CheckVerdict {
  return { check, status, detail, nextStep, fixes };
}

/** 这个系统上有的修复才给按钮（例如 macOS 没有「打开打印队列」）。 */
function offers(platform: DiagnosisPlatform, ...ids: DiagnosisOfferId[]): FixOffer[] {
  return ids.flatMap((id) => {
    const offer = offerFor(platform, id);
    return offer === null ? [] : [offer];
  });
}

function unknownVerdict(
  check: DiagnosisCheckId,
  platform: DiagnosisPlatform,
  detail: string,
  fixes: FixOffer[] = [],
): CheckVerdict {
  return platform === 'other'
    ? verdict(check, 'unknown', UNSUPPORTED_DETAIL, null, [])
    : verdict(check, 'unknown', detail, null, fixes);
}

/** 等了多久：取能放下的最大整单位（不足一分钟说秒）。 */
export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return minutes < MINUTES_PER_HOUR ? `${minutes} 分钟` : `${Math.floor(minutes / MINUTES_PER_HOUR)} 小时`;
}

/** 后台打印服务：Windows 的 Spooler；macOS 的 CUPS 和这台打印机在 CUPS 里的启用状态。 */
export function spoolerVerdict(facts: SpoolerFacts, platform: DiagnosisPlatform): CheckVerdict {
  const restart = offers(platform, 'restart-spooler');
  switch (facts.kind) {
    case 'unknown':
      return unknownVerdict('spooler', platform, '查不到后台打印服务的状态');
    case 'windows':
      if (facts.state === 'running') {
        return verdict('spooler', 'pass', '后台打印服务（Print Spooler）在运行', null, []);
      }
      if (facts.startType === 'disabled') {
        return verdict(
          'spooler',
          'fail',
          '后台打印服务被禁用了：所有打印都发不出去',
          '点「重启后台打印服务」，会把它设为自动并启动；公司电脑上如果是管理员有意禁用的，先问管理员',
          restart,
        );
      }
      if (facts.state === 'stopped') {
        return verdict(
          'spooler',
          'fail',
          '后台打印服务没有运行：所有打印都发不出去',
          '点「重启后台打印服务」，Windows 会弹一次管理员确认',
          restart,
        );
      }
      return verdict(
        'spooler',
        'warn',
        facts.state === 'pending' ? '后台打印服务正在启动或停止' : '后台打印服务处在不常见的状态',
        '等几秒点「重新检查」；一直这样就重启它',
        restart,
      );
    case 'mac':
      if (!facts.schedulerRunning) {
        return verdict(
          'spooler',
          'fail',
          '打印系统（CUPS）没有在运行：所有打印都发不出去',
          '点「重启打印系统」，按提示输入管理员密码',
          restart,
        );
      }
      if (facts.queue === null) {
        return verdict('spooler', 'pass', '打印系统（CUPS）在运行', null, []);
      }
      if (!facts.queue.enabled) {
        return verdict(
          'spooler',
          'fail',
          '这台打印机在系统里被暂停了：任务只进队列、不打印',
          '点「恢复这台打印机」',
          offers(platform, 'enable-printer'),
        );
      }
      if (!facts.queue.acceptingJobs) {
        return verdict(
          'spooler',
          'fail',
          '这台打印机在系统里设成了「拒收任务」：新任务发不进去',
          '点「恢复这台打印机」',
          offers(platform, 'enable-printer'),
        );
      }
      return verdict('spooler', 'pass', '打印系统（CUPS）在运行，这台打印机已启用、接收任务', null, []);
  }
}

/** 驱动（或 CUPS）报告的状态。canReinstallDriver：5c 的接缝说能重装这台的驱动。 */
export function printerVerdict(
  facts: PrinterFacts,
  platform: DiagnosisPlatform,
  canReinstallDriver: boolean,
): CheckVerdict {
  if (facts.kind === 'unknown') {
    return unknownVerdict('printer', platform, '查不到驱动报告的状态', offers(platform, 'open-preferences'));
  }
  if (facts.paused) {
    return verdict(
      'printer',
      'fail',
      '打印机在系统里被暂停了：任务只进队列、不打印',
      '点「打开打印队列」，在「打印机」菜单里取消勾选「暂停打印」',
      offers(platform, 'open-queue'),
    );
  }
  const { readiness } = facts;
  if (readiness.ready) {
    const driver = facts.driverName === null ? '' : `（驱动：${facts.driverName}）`;
    return verdict('printer', 'pass', `驱动没有报告问题${driver}`, null, []);
  }
  const mayNeedDriver = canReinstallDriver && (readiness.issue === 'other' || readiness.issue === 'offline');
  return verdict(
    'printer',
    'fail',
    `驱动报告：${readiness.detail}`,
    ISSUE_NEXT_STEPS[readiness.issue],
    offers(platform, 'open-preferences', ...(mayNeedDriver ? (['reinstall-driver'] as const) : [])),
  );
}

export function usbVerdict(facts: UsbFacts, platform: DiagnosisPlatform, canReinstallDriver: boolean): CheckVerdict {
  const cable = platform === 'other' ? null : USB_NEXT_STEPS[platform];
  switch (facts.kind) {
    case 'unknown':
      return unknownVerdict('usb', platform, '查不到 USB 设备');
    case 'not-usb':
      return verdict(
        'usb',
        'skipped',
        `这台打印机的连接方式是 ${facts.port}，不是系统的 USB 端口，这一项不适用`,
        null,
        [],
      );
    case 'present':
      return verdict('usb', 'pass', `系统能看到它的 USB 设备（${facts.deviceName}）`, null, []);
    case 'disconnected':
      return verdict('usb', 'fail', `系统记得它的 USB 设备（${facts.deviceName}），但现在没连上`, cable, []);
    case 'not-found':
      return verdict('usb', 'warn', `没找到端口 ${facts.port} 对应的 USB 设备`, cable, []);
    case 'problem':
      if (facts.code === CM_PROB_FAILED_INSTALL) {
        return verdict(
          'usb',
          'fail',
          `它的 USB 设备（${facts.deviceName}）没有装驱动`,
          canReinstallDriver ? '点「重新安装驱动」' : '到标签机厂家的官网下载驱动装上，或在「设备管理器」里更新这个设备的驱动',
          canReinstallDriver ? offers(platform, 'reinstall-driver') : [],
        );
      }
      return verdict('usb', 'fail', `系统报告它的 USB 设备（${facts.deviceName}）有问题（代码 ${facts.code}）`, cable, []);
  }
}

export function queueVerdict(
  facts: QueueFacts,
  platform: DiagnosisPlatform,
  windows: readonly SubmittedWindow[],
  nowMs: number,
): CheckVerdict {
  if (facts.kind === 'unknown') {
    return unknownVerdict('queue', platform, '查不到打印队列');
  }
  const summary = summarizeQueue(facts, windows, nowMs);
  if (summary.total === 0) {
    return verdict('queue', 'pass', '队列是空的', null, []);
  }
  const partial = summary.total > summary.listed ? `（只看了前 ${summary.listed} 个）` : '';
  if (summary.stuck === 0) {
    return verdict(
      'queue',
      'pass',
      `队列里有 ${summary.total} 个任务，都还不到 ${formatAge(STUCK_JOB_AGE_MS)}，驱动也没有报错${partial}`,
      null,
      [],
    );
  }
  const own =
    summary.ownStuck === summary.stuck
      ? '都是本程序发的'
      : summary.ownStuck === 0
        ? '都不是本程序发的'
        : `其中 ${summary.ownStuck} 个是本程序发的`;
  const waited = formatAge(summary.oldestStuckAgeMs ?? 0);
  return verdict(
    'queue',
    'fail',
    `有 ${summary.stuck} 个任务卡在队列里（最早的已经等了 ${waited}），${own}${partial}`,
    '卡住的任务会挡住后面的标签：先处理上面几项的问题（缺纸、离线），再清掉卡住的任务',
    offers(
      platform,
      ...(summary.own.length > 0 ? (['cancel-own-jobs'] as const) : []),
      'cancel-all-jobs',
      'open-queue',
    ),
  );
}

/** expected 为 null：这台打印机没有负责的纸张（没被分配），不核对。 */
export function paperVerdict(
  paper: DriverPaper | null,
  expected: PaperSize | null,
  platform: DiagnosisPlatform,
): CheckVerdict {
  if (expected === null) {
    return verdict('paper', 'skipped', '这台打印机没有负责的纸张，不用核对', null, []);
  }
  if (paper === null) {
    return unknownVerdict('paper', platform, '读不到驱动的默认纸张', offers(platform, 'open-preferences'));
  }
  if (isSamePaper(paper, expected)) {
    return verdict(
      'paper',
      'pass',
      `驱动纸张 ${formatPaperSize(paper)}，和它负责的 ${formatPaperSize(expected)} 一致`,
      null,
      [],
    );
  }
  return verdict(
    'paper',
    'fail',
    `驱动纸张是 ${formatPaperSize(paper)}，它负责的是 ${formatPaperSize(expected)}：打出来可能缩放、跳纸或出空白标签`,
    '点「自动设置驱动纸张」；不行就打开打印首选项手动改',
    offers(platform, 'set-driver-paper', 'open-preferences'),
  );
}

/** commandSet 为 null：这一版没有 5a 的接缝。 */
export function commandsVerdict(commandSet: CommandSetName | 'none' | null, platform: DiagnosisPlatform): CheckVerdict {
  if (commandSet === null) {
    return verdict('commands', 'skipped', '这一版还不能给标签机发指令', null, []);
  }
  if (commandSet === 'none') {
    return verdict(
      'commands',
      'skipped',
      '指令集设成了「不发指令」，或认不出这台的指令集：程序不给它发指令',
      null,
      offers(platform, CHANGE_COMMAND_SET),
    );
  }
  return verdict(
    'commands',
    'action',
    `指令集：${commandSet.toUpperCase()}。指令是单向的，程序读不到标签机的回答`,
    '点「走一张纸」，看标签机有没有走出一张空白标签',
    offers(platform, 'feed', 'calibrate', CHANGE_COMMAND_SET),
  );
}

/** 打印机在点「诊断」之后离开了系统列表（拔掉、被删）：不交给任何系统命令，只说清楚。 */
export function missingPrinterVerdict(check: DiagnosisCheckId): CheckVerdict {
  return verdict(
    check,
    'fail',
    '系统打印机列表里已经没有这台了',
    '确认标签机开着、线插好，在系统设置里看它还在不在，再回来点「刷新」',
    [],
  );
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/diagnosis`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/diagnosis/verdicts.ts src/core/diagnosis/verdicts.test.ts
git commit -m "feat(diagnosis): verdicts for the six checks on each platform" -m "Facts parsed from system commands become a Chinese verdict, a next step and only the fixes this platform can do. Wording stays with what the program knows: the driver reported no problem, jobs were asked to cancel, commands went into the queue." -m "$TRAILER"
```

---

### Task 6: Windows：探测进程的诊断查询和解析

查询走现有的常驻 PowerShell（`printer-probe-host.ts`），不每次新起进程。加五个命令，每个回一行 JSON（`ConvertTo-Json -Compress`），条数在脚本里就截断（`Select-Object -First`），主进程再限回答长度、逐字段核对类型。打印机名照旧以 base64 传入、只当数据用，`Get-Printer` 前转义通配符。

**Files:**
- Modify: `src/main/printing/printer-probe-host.ts`、`src/main/printing/printer-probe-host.test.ts`
- Create: `src/main/diagnosis/windows-facts.ts`、`src/main/diagnosis/windows-facts.test.ts`
- Create: `src/main/diagnosis/testing/fixtures.ts`、`src/main/diagnosis/testing/fixtures/windows/*.txt`

- [ ] **Step 1: 样本**

每个文件是探测进程回答里 `ok ` 之后的那一段（`PrinterProbeHost.query` 返回的内容），一行，按原样保存（`.txt`，Biome 不碰）。字段和命令在 Step 4 的脚本里一一对应；Task 18 在真机上用同样的命令抓真实输出替换它们，解析测试必须照样通过。

`src/main/diagnosis/testing/fixtures/windows/spooler-running.txt`：

```
{"status":"Running","startType":"Automatic"}
```

`spooler-disabled.txt`：

```
{"status":"Stopped","startType":"Disabled"}
```

`printer-paper-out.txt`：

```
{"status":"PaperOut","portName":"USB001","driverName":"热敏标签机驱动"}
```

`printer-paused.txt`：

```
{"status":"Paused","portName":"USB001","driverName":"热敏标签机驱动"}
```

`usb-present.txt`（同一端口上有一条旧的、已不在的记录，和现在接着的那一台）：

```
{"port":"USB001","devices":[{"instanceId":"USBPRINT\\LABELPRINTER\\7&11111111&0&USB001","name":"热敏标签机（旧）","present":false,"problem":45},{"instanceId":"USBPRINT\\LABELPRINTER\\7&2A1B3C4D&0&USB001","name":"热敏标签机","present":true,"problem":0},{"instanceId":"USBPRINT\\OFFICEPRINTER\\7&5E6F7A8B&0&USB002","name":"办公室打印机","present":true,"problem":0}]}
```

`usb-disconnected.txt`：

```
{"port":"USB001","devices":[{"instanceId":"USBPRINT\\LABELPRINTER\\7&2A1B3C4D&0&USB001","name":"热敏标签机","present":false,"problem":45}]}
```

`usb-network.txt`：

```
{"port":"WSD-6c2f4e1a-0001","devices":[]}
```

`jobs-stuck.txt`（`submittedMs` 是 Unix 毫秒）：

```
{"user":"shop","total":3,"jobs":[{"id":11,"document":"CL5640-TK-图片色-XL","user":"shop","status":"Error, Printing","submittedMs":1790000000000},{"id":12,"document":"CL5641-TK-黑色-L","user":"shop","status":"Normal","submittedMs":1790000001000},{"id":13,"document":"月报.pdf","user":"SHOPPC\\boss","status":"Paused","submittedMs":1789999000000}]}
```

`jobs-one.txt`（只有一个任务时 `@()` 仍序列化成数组，确认脚本里用了 `-InputObject`）：

```
{"user":"shop","total":1,"jobs":[{"id":7,"document":"CL5640-TK-图片色-XL","user":"shop","status":"Printing","submittedMs":1790000000000}]}
```

`paper-options.txt`（自定义尺寸那一项没有宽高）：

```
{"options":[{"namespace":"http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords","localName":"ISOA4","width":210000,"height":297000},{"namespace":"urn:labelflash-test:label-driver","localName":"User0000000257","width":60000,"height":40000},{"namespace":"http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords","localName":"CustomMediaSize","width":null,"height":null},{"namespace":"urn:labelflash-test:label-driver","localName":"bad name","width":1,"height":1}],"custom":true}
```

```ts
// src/main/diagnosis/testing/fixtures.ts
import { readFileSync } from 'node:fs';

/**
 * 读一份系统命令输出的样本（`fixtures/<平台>/<名字>`）。按原样保存，不经过格式化工具；
 * git 在 Windows 上可能换成 CRLF，解析器都按 \r?\n 分行、去掉首尾空白。
 */
export function fixture(platform: 'windows' | 'mac', name: string): string {
  return readFileSync(new URL(`fixtures/${platform}/${name}`, import.meta.url), 'utf8');
}
```

- [ ] **Step 2: 写测试**

`printer-probe-host.test.ts` 的 import 改为 `import { MAX_PROBE_REPLY_LENGTH, PROBE_COMMANDS, PROBE_SCRIPT, PrinterProbeHost, type ProbeProcess } from './printer-probe-host';`，在 `describe('PrinterProbeHost')` 里加：

```ts
  // 系统级的查询（后台打印服务）没有打印机名：请求行的数据部分是空的 base64。
  test('sends a query without a printer name', async () => {
    const { host, spawned } = harness();
    const answer = host.query('spooler', '');
    const [probe] = spawned;
    expect(await nextRequests(probe as FakeProbe, 1)).toEqual(['spooler ']);
    probe?.reply('ok {"status":"Running","startType":"Automatic"}');
    expect(await answer).toBe('{"status":"Running","startType":"Automatic"}');
  });

  // 回答不可信（文档名来自别的程序）：超长的整行丢掉，按「查不到」处理。
  test('drops an answer longer than the limit', async () => {
    const { host, spawned, warnings } = harness();
    const answer = host.query('jobs', '标签机A');
    spawned[0]?.reply(`ok ${'x'.repeat(MAX_PROBE_REPLY_LENGTH)}`);
    expect(await answer).toBeNull();
    expect(warnings.some((message) => message.includes('dropped'))).toBe(true);
  });

  test('the resident script answers every command the host can send', () => {
    for (const command of PROBE_COMMANDS) {
      expect(PROBE_SCRIPT).toContain(`'${command}' {`);
    }
  });
```

```ts
// src/main/diagnosis/windows-facts.test.ts
import { describe, expect, test } from 'bun:test';
import { fixture } from './testing/fixtures';
import {
  parseJobsReply,
  parsePaperOptionsReply,
  parsePrinterReply,
  parseSpoolerReply,
  parseUsbReply,
} from './windows-facts';

const sample = (name: string) => fixture('windows', name);

describe('parseSpoolerReply', () => {
  test('reads the service state and start type', () => {
    expect(parseSpoolerReply(sample('spooler-running.txt'))).toEqual({
      kind: 'windows',
      state: 'running',
      startType: 'automatic',
    });
    expect(parseSpoolerReply(sample('spooler-disabled.txt'))).toEqual({
      kind: 'windows',
      state: 'stopped',
      startType: 'disabled',
    });
  });

  test('is unknown when the probe failed or answered nonsense', () => {
    expect(parseSpoolerReply(null)).toMatchObject({ kind: 'unknown' });
    expect(parseSpoolerReply('Get-Service : Access denied')).toMatchObject({ kind: 'unknown' });
    expect(parseSpoolerReply('[]')).toMatchObject({ kind: 'unknown' });
  });
});

describe('parsePrinterReply', () => {
  test('reuses the status rules of the background monitor', () => {
    expect(parsePrinterReply(sample('printer-paper-out.txt'))).toEqual({
      kind: 'known',
      readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
      paused: false,
      driverName: '热敏标签机驱动',
    });
    expect(parsePrinterReply(sample('printer-paused.txt'))).toMatchObject({ paused: true });
  });
});

describe('parseUsbReply', () => {
  test('finds the present device whose instance id ends with the port', () => {
    expect(parseUsbReply(sample('usb-present.txt'))).toEqual({ kind: 'present', deviceName: '热敏标签机' });
    expect(parseUsbReply(sample('usb-disconnected.txt'))).toEqual({ kind: 'disconnected', deviceName: '热敏标签机' });
  });

  test('reports a device problem code and a USB port without a device', () => {
    expect(
      parseUsbReply(
        '{"port":"USB003","devices":[{"instanceId":"USBPRINT\\\\X\\\\7&1&0&USB003","name":"热敏标签机","present":true,"problem":28}]}',
      ),
    ).toEqual({ kind: 'problem', deviceName: '热敏标签机', code: 28 });
    expect(parseUsbReply('{"port":"USB009","devices":[]}')).toEqual({ kind: 'not-found', port: 'USB009' });
  });

  test('does not apply to printers on other ports', () => {
    expect(parseUsbReply(sample('usb-network.txt'))).toEqual({ kind: 'not-usb', port: 'WSD-6c2f4e1a-0001' });
  });
});

describe('parseJobsReply', () => {
  test('reads jobs with their flags, user and submit time', () => {
    const facts = parseJobsReply(sample('jobs-stuck.txt'));
    expect(facts).toMatchObject({ kind: 'listed', currentUser: 'shop', total: 3 });
    expect(facts.kind === 'listed' ? facts.jobs.map((job) => [job.id, job.flags]) : []).toEqual([
      [11, ['error', 'printing']],
      [12, []],
      [13, ['paused']],
    ]);
    expect(parseJobsReply(sample('jobs-one.txt'))).toMatchObject({ total: 1, jobs: [{ id: 7 }] });
  });

  test('drops malformed jobs and never takes flags from the prototype', () => {
    const facts = parseJobsReply(
      '{"user":"shop","total":2,"jobs":[{"id":"x"},{"id":5,"document":"a","user":"shop","status":"__proto__, constructor","submittedMs":1}]}',
    );
    expect(facts).toMatchObject({ kind: 'listed', total: 2, jobs: [{ id: 5, flags: [] }] });
  });
});

describe('parsePaperOptionsReply', () => {
  test('keeps options with a valid XML name and microns, and the custom-size flag', () => {
    expect(parsePaperOptionsReply(sample('paper-options.txt'))).toEqual({
      options: [
        {
          namespace: 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords',
          localName: 'ISOA4',
          widthMicrons: 210_000,
          heightMicrons: 297_000,
        },
        {
          namespace: 'urn:labelflash-test:label-driver',
          localName: 'User0000000257',
          widthMicrons: 60_000,
          heightMicrons: 40_000,
        },
        {
          namespace: 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords',
          localName: 'CustomMediaSize',
          widthMicrons: null,
          heightMicrons: null,
        },
      ],
      supportsCustom: true,
    });
    expect(parsePaperOptionsReply(null)).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/printing/printer-probe-host.test.ts src/main/diagnosis/windows-facts.test.ts`
Expected: FAIL，`PROBE_COMMANDS` 没有导出、`Cannot find module './windows-facts'`。

- [ ] **Step 4: 探测进程加查询**

`printer-probe-host.ts`：

1. 文件顶部加 `import { DIAGNOSIS_LIMITS } from '../../core/diagnosis/diagnosis-model';`。
2. `export type ProbeCommand = 'status' | 'paper';` 换成下面两行（5a 已经加了它自己的命令的话，保留它们，一起放进数组）：

```ts
/** 常驻探测进程能回答的问题：状态、驱动纸张（打印时用），以及诊断用的几项（打印机页点「诊断」时才问）。 */
export const PROBE_COMMANDS = ['status', 'paper', 'spooler', 'printer', 'usb', 'jobs', 'paper-options'] as const;
export type ProbeCommand = (typeof PROBE_COMMANDS)[number];
```

3. `MAX_STDERR_LOG_LENGTH` 之后加：

```ts
/**
 * 一行回答的长度上限（字符）：最长的是队列（100 个任务 × 约 300 字）和纸张选项（200 种 × 约 150 字），
 * 都在 4 万字以内；512K 是给异常输出的硬上限，超过的整行丢掉、按「查不到」处理。
 */
export const MAX_PROBE_REPLY_LENGTH = 512 * 1024;
/** Print Schema 的命名空间名（不是网络地址）：读驱动的 PrintCapabilities 要用它定位节点。 */
const PRINT_SCHEMA_FRAMEWORK = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework';
```

4. `const PROBE_SCRIPT = \`` 改成 `export const PROBE_SCRIPT = \``，在 `'paper' { … }` 这一段之后、`default` 之前插入：

```ts
      'spooler' {
        $service = Get-Service -Name 'Spooler'
        $reply = 'ok ' + (ConvertTo-Json -Compress -InputObject ([ordered]@{
          status = $service.Status.ToString(); startType = $service.StartType.ToString() }))
      }
      'printer' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + (ConvertTo-Json -Compress -InputObject ([ordered]@{
          status = $printer.PrinterStatus.ToString(); portName = [string]$printer.PortName; driverName = [string]$printer.DriverName }))
      }
      'usb' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $devices = @(Get-PnpDevice -InstanceId 'USBPRINT\\*' -ErrorAction SilentlyContinue |
          Select-Object -First ${DIAGNOSIS_LIMITS.usbDevices} | ForEach-Object {
            [ordered]@{ instanceId = [string]$_.InstanceId; name = [string]$_.FriendlyName; present = [bool]$_.Present; problem = [int]$_.ConfigManagerErrorCode }
          })
        $reply = 'ok ' + (ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ port = [string]$printer.PortName; devices = $devices }))
      }
      'jobs' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $all = @(Get-PrintJob -PrinterObject $printer)
        $jobs = @($all | Select-Object -First ${DIAGNOSIS_LIMITS.jobs} | ForEach-Object {
          $document = [string]$_.DocumentName
          [ordered]@{
            id = [int]$_.Id
            document = $document.Substring(0, [Math]::Min($document.Length, ${DIAGNOSIS_LIMITS.textLength}))
            user = [string]$_.UserName
            status = $_.JobStatus.ToString()
            submittedMs = ([DateTimeOffset]$_.SubmittedTime).ToUnixTimeMilliseconds()
          }
        })
        $reply = 'ok ' + (ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ user = [Environment]::UserName; total = $all.Count; jobs = $jobs }))
      }
      'paper-options' {
        Add-Type -AssemblyName System.Printing
        $queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($name)
        $xml = New-Object System.Xml.XmlDocument
        $xml.XmlResolver = $null
        $xml.Load($queue.GetPrintCapabilitiesAsXml())
        $ns = New-Object System.Xml.XmlNamespaceManager $xml.NameTable
        $ns.AddNamespace('psf', '${PRINT_SCHEMA_FRAMEWORK}')
        $options = @($xml.SelectNodes("//psf:Feature[substring-after(@name, ':') = 'PageMediaSize']/psf:Option", $ns) |
          Select-Object -First ${DIAGNOSIS_LIMITS.paperOptions} | ForEach-Object {
            $qname = [string]$_.GetAttribute('name')
            $prefix = if ($qname.Contains(':')) { $qname.Split(':')[0] } else { '' }
            $width = $_.SelectSingleNode("psf:ScoredProperty[substring-after(@name, ':') = 'MediaSizeWidth']/psf:Value", $ns)
            $height = $_.SelectSingleNode("psf:ScoredProperty[substring-after(@name, ':') = 'MediaSizeHeight']/psf:Value", $ns)
            [ordered]@{
              namespace = [string]$_.GetNamespaceOfPrefix($prefix)
              localName = $qname.Substring($qname.IndexOf(':') + 1)
              width = if ($width) { [int]$width.InnerText } else { $null }
              height = if ($height) { [int]$height.InnerText } else { $null }
            }
          })
        $custom = $null -ne $xml.SelectSingleNode("//psf:ParameterDef[substring-after(@name, ':') = 'PageMediaSizeMediaSizeWidth']", $ns)
        $reply = 'ok ' + (ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ options = $options; custom = $custom }))
      }
```

说明（写进代码注释，放在 `PROBE_SCRIPT` 上面的文档注释里追加一段）：
- `-InputObject`：只有一个元素的数组用管道传给 `ConvertTo-Json` 会被拆开，变成对象而不是数组。
- `Get-PnpDevice -InstanceId 'USBPRINT\*'` 包括现在不在的设备（`Present = $false`），所以能说「系统记得它，但现在没连上」；问题代码用 Win32_PnPEntity 自带的 `ConfigManagerErrorCode`。
- `paper-options` 用 .NET 的 `System.Printing`（全局程序集缓存里的系统程序集，不是编译出来的代码）读驱动的 PrintCapabilities；`XmlResolver = $null` 不解析外部实体。
- 所有新命令都在已有的 `try` 里：出错回 `err …`，主进程按「查不到」处理。

5. `onReply` 里 `clearTimeout(query.timer);` 之后加：

```ts
    if (line.length > MAX_PROBE_REPLY_LENGTH) {
      this.warn(`[printer-probe] dropped a ${line.length}-character answer (limit ${MAX_PROBE_REPLY_LENGTH})`);
      query.resolve(null);
      return;
    }
```

- [ ] **Step 5: 解析**

```ts
// src/main/diagnosis/windows-facts.ts
import {
  DIAGNOSIS_LIMITS,
  type JobFlag,
  type PrinterFacts,
  type QueueFacts,
  type QueueJob,
  type SpoolerFacts,
  type UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import {
  PRINT_TICKET_LOCAL_NAME_PATTERN,
  PRINT_TICKET_NAMESPACE_PATTERN,
  type PrintTicketPaperOption,
  type PrintTicketPaperOptions,
} from '../../core/diagnosis/paper-choice';
import { isRecord } from '../../shared/settings';
import { parsePrinterStatus } from '../printing/printer-status';

/**
 * Windows 探测进程的诊断回答（printer-probe-host.ts 的 spooler / printer / usb / jobs / paper-options）→ 事实。
 * 回答不可信：逐字段核对类型，文字截断，不认识的值按「其他」或丢掉；整体读不懂就是「查不到」，原因写进 reason。
 */

type JsonObject = Record<string, unknown>;
type Read = { ok: true; value: JsonObject } | { ok: false; reason: string };

/** 系统 USB 打印端口的名字：USB001、USB002…… */
const USB_PORT_PATTERN = /^USB\d+$/i;
/** 驱动报告的纸张尺寸上限（微米）：10 米，再大是坏数据。 */
const MAX_PAPER_MICRONS = 10_000_000;
/** 写进 reason 的原文长度。 */
const REASON_SAMPLE_LENGTH = 80;

const SERVICE_STATES: ReadonlyMap<string, Extract<SpoolerFacts, { kind: 'windows' }>['state']> = new Map([
  ['Running', 'running'],
  ['Stopped', 'stopped'],
  ['StartPending', 'pending'],
  ['StopPending', 'pending'],
  ['ContinuePending', 'pending'],
  ['PausePending', 'pending'],
]);

const START_TYPES: ReadonlyMap<string, Extract<SpoolerFacts, { kind: 'windows' }>['startType']> = new Map([
  ['Automatic', 'automatic'],
  ['Manual', 'manual'],
  ['Disabled', 'disabled'],
]);

/** Get-PrintJob 的 JobStatus（[Flags] 枚举，ToString 后是「Error, Printing」这样）里我们关心的几种。 */
const JOB_FLAGS: ReadonlyMap<string, JobFlag> = new Map([
  ['Error', 'error'],
  ['Paused', 'paused'],
  ['Offline', 'offline'],
  ['PaperOut', 'paper-out'],
  ['Blocked', 'blocked'],
  ['UserIntervention', 'user-intervention'],
  ['Printing', 'printing'],
]);

function readObject(reply: string | null): Read {
  if (reply === null) {
    return { ok: false, reason: 'probe query failed or timed out' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, reason: `not JSON: ${reply.slice(0, REASON_SAMPLE_LENGTH)}` };
  }
  return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false, reason: 'not a JSON object' };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, DIAGNOSIS_LIMITS.textLength) : '';
}

function list(value: unknown, limit: number): JsonObject[] {
  return Array.isArray(value) ? value.slice(0, limit).filter(isRecord) : [];
}

export function parseSpoolerReply(reply: string | null): SpoolerFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  return {
    kind: 'windows',
    state: SERVICE_STATES.get(text(read.value['status'])) ?? 'other',
    startType: START_TYPES.get(text(read.value['startType'])) ?? 'other',
  };
}

export function parsePrinterReply(reply: string | null): PrinterFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  const status = text(read.value['status']);
  const driverName = text(read.value['driverName']);
  return {
    kind: 'known',
    readiness: parsePrinterStatus(status),
    paused: status.split(/[\s,]+/).includes('Paused'),
    driverName: driverName === '' ? null : driverName,
  };
}

/**
 * USB 打印设备的实例 ID 以「&端口名」结尾（USBPRINT\型号\7&2A1B3C4D&0&USB001）。
 * 同一端口可能留着旧设备的记录：先取现在在的那一个。
 */
export function parseUsbReply(reply: string | null): UsbFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  const port = text(read.value['port']);
  if (!USB_PORT_PATTERN.test(port)) {
    return { kind: 'not-usb', port };
  }
  const suffix = `&${port}`.toUpperCase();
  const matches = list(read.value['devices'], DIAGNOSIS_LIMITS.usbDevices).filter((device) =>
    text(device['instanceId']).toUpperCase().endsWith(suffix),
  );
  const device = matches.find((item) => item['present'] === true) ?? matches[0];
  if (device === undefined) {
    return { kind: 'not-found', port };
  }
  const deviceName = text(device['name']) || port;
  const problem = device['problem'];
  const code = typeof problem === 'number' && Number.isInteger(problem) ? problem : 0;
  if (device['present'] !== true) {
    return { kind: 'disconnected', deviceName };
  }
  return code === 0 ? { kind: 'present', deviceName } : { kind: 'problem', deviceName, code };
}

function readJob(entry: JsonObject): QueueJob | null {
  const id = entry['id'];
  const submitted = entry['submittedMs'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  if (typeof submitted !== 'number' || !Number.isFinite(submitted)) {
    return null;
  }
  const flags = text(entry['status'])
    .split(/[\s,]+/)
    .flatMap((name) => {
      const flag = JOB_FLAGS.get(name);
      return flag === undefined ? [] : [flag];
    });
  return { id, document: text(entry['document']), user: text(entry['user']), submittedAtMs: submitted, flags };
}

export function parseJobsReply(reply: string | null): QueueFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  const jobs = list(read.value['jobs'], DIAGNOSIS_LIMITS.jobs).flatMap((entry) => {
    const job = readJob(entry);
    return job === null ? [] : [job];
  });
  const total = read.value['total'];
  return {
    kind: 'listed',
    currentUser: text(read.value['user']),
    total: typeof total === 'number' && Number.isSafeInteger(total) && total >= jobs.length ? total : jobs.length,
    jobs,
  };
}

function microns(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PAPER_MICRONS ? value : null;
}

/** 驱动的纸张选项；名字不是合法 XML 名、命名空间带奇怪字符的丢掉（它们要写进 PrintTicket）。读不懂整体返回 null。 */
export function parsePaperOptionsReply(reply: string | null): PrintTicketPaperOptions | null {
  const read = readObject(reply);
  if (!read.ok) {
    return null;
  }
  const options = list(read.value['options'], DIAGNOSIS_LIMITS.paperOptions).flatMap(
    (entry): PrintTicketPaperOption[] => {
      const namespace = entry['namespace'];
      const localName = entry['localName'];
      if (
        typeof namespace !== 'string' ||
        !PRINT_TICKET_NAMESPACE_PATTERN.test(namespace) ||
        typeof localName !== 'string' ||
        !PRINT_TICKET_LOCAL_NAME_PATTERN.test(localName)
      ) {
        return [];
      }
      return [{ namespace, localName, widthMicrons: microns(entry['width']), heightMicrons: microns(entry['height']) }];
    },
  );
  return { options, supportsCustom: read.value['custom'] === true };
}
```

- [ ] **Step 6: 跑测试**

Run: `bun test src/main/printing/printer-probe-host.test.ts src/main/diagnosis/windows-facts.test.ts`
Expected: PASS。

- [ ] **Step 7: `bun run check` 后提交**

```bash
git add src/main/printing/printer-probe-host.ts src/main/printing/printer-probe-host.test.ts src/main/diagnosis/windows-facts.ts src/main/diagnosis/windows-facts.test.ts src/main/diagnosis/testing
git commit -m "feat(diagnosis): Windows probe queries for service, printer, USB, queue and paper options" -m "Diagnosis questions go through the resident PowerShell probe so they cost milliseconds, not a PowerShell start each. Every answer is one bounded JSON line; the parsers check each field and treat anything unreadable as unknown." -m "$TRAILER"
```

---

### Task 7: Windows：一次性脚本和管理员脚本

非管理员的动作（取消本程序的任务）用一次性 PowerShell；管理员动作沿用 `firewall.ts` 的做法：外层 `Start-Process -Verb RunAs` 弹 UAC，内层脚本整段 Base64，打印机名只作为 PowerShell 单引号字面量写进内层脚本。外层接住 `Start-Process` 的异常，用 1223（Windows 的 ERROR_CANCELLED）退出，界面说「没有拿到管理员权限」。内层脚本：

- 第一行把 `PSModulePath` 收紧到 `$PSHOME\Modules`（`firewall-rule.ts` 已说明：以管理员身份运行时 PowerShell 仍先到用户自己的「文档」里找模块，同一用户下的恶意程序能借确认框提权）；
- 只用 .NET 的系统程序集（`System.Printing`、`System.ServiceProcess`）和 `[Environment]::SystemDirectory` 下的 `sc.exe`，不按名字找程序、不读环境变量拼路径；
- 退出码表示结果（0 做完、3 驱动不接受、4 已回滚、1 失败）——提权后的进程窗口隐藏，输出拿不回来。

**Files:**
- Create: `src/main/windows-powershell.ts`、`src/main/windows-powershell.test.ts`
- Create: `src/main/diagnosis/windows-scripts.ts`、`src/main/diagnosis/windows-scripts.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/windows-powershell.test.ts
import { describe, expect, test } from 'bun:test';
import {
  ELEVATION_DECLINED_EXIT_CODE,
  elevatedPowerShellCommand,
  encodePowerShell,
  MAX_ELEVATED_COMMAND_LENGTH,
} from './windows-powershell';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

describe('elevatedPowerShellCommand', () => {
  test('elevates a Base64 script and maps a failed prompt to ERROR_CANCELLED', () => {
    const command = elevatedPowerShellCommand("$Name = 'O''Neil 标签机'", POWERSHELL);
    expect(command).toStartWith(`try { $p = Start-Process '${POWERSHELL}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden `);
    expect(command).toContain(`'-EncodedCommand','${encodePowerShell("$Name = 'O''Neil 标签机'")}'`);
    expect(command).toContain(`} catch { exit ${ELEVATION_DECLINED_EXIT_CODE} }`);
    expect(command.endsWith('exit $p.ExitCode')).toBe(true);
    expect(command).not.toContain('标签机');
  });

  // Windows 命令行最长 32767 个字符：超了就是脚本写得太大，立刻报错，不让它在系统里被截断。
  test('fails fast on a script too long for a command line', () => {
    expect(() => elevatedPowerShellCommand('x'.repeat(MAX_ELEVATED_COMMAND_LENGTH), POWERSHELL)).toThrow(
      'too long',
    );
  });
});
```

```ts
// src/main/diagnosis/windows-scripts.test.ts
import { describe, expect, test } from 'bun:test';
import {
  cancelJobsScript,
  paperDeltaTicket,
  purgeQueueScript,
  restartSpoolerScript,
  SCRIPT_EXIT,
  setDriverPaperScript,
} from './windows-scripts';

const LABEL = { widthMm: 60, heightMm: 40 };
const OPTION = { kind: 'option', namespace: 'urn:labelflash-test:label-driver', localName: 'User0000000257' } as const;

describe('windows scripts', () => {
  test('every script trusts only the modules in the PowerShell home', () => {
    for (const script of [
      restartSpoolerScript(),
      purgeQueueScript('标签机A'),
      cancelJobsScript('标签机A', [1]),
      setDriverPaperScript('标签机A', OPTION, LABEL),
    ]) {
      expect(script.split('\n')).toContain("$env:PSModulePath = Join-Path $PSHOME 'Modules'");
    }
  });

  test('passes the printer name only as a PowerShell literal', () => {
    expect(purgeQueueScript("O'Neil 标签机")).toContain("$Name = 'O''Neil 标签机'");
  });

  test('runs sc.exe from the system directory, not from a name or an environment variable', () => {
    const script = restartSpoolerScript();
    expect(script).toContain("Join-Path ([Environment]::SystemDirectory) 'sc.exe'");
    expect(script).not.toContain('$env:SystemRoot');
  });

  test('cancels only whole job ids', () => {
    expect(cancelJobsScript('标签机A', [11, 12])).toContain('$Ids = @(11, 12)');
    expect(() => cancelJobsScript('标签机A', [1.5])).toThrow('job id');
    expect(() => cancelJobsScript('标签机A', [])).toThrow('job id');
  });

  test('sets the paper through a PrintTicket delta and rolls back on a bad read-back', () => {
    const script = setDriverPaperScript('标签机A', OPTION, LABEL);
    expect(script).toContain('$WidthMicrons = 60000');
    expect(script).toContain('$HeightMicrons = 40000');
    expect(script).toContain(`exit ${SCRIPT_EXIT.driverRefused}`);
    expect(script).toContain(`exit ${SCRIPT_EXIT.rolledBack}`);
    const delta = /\$Delta = '([A-Za-z0-9+/=]+)'/.exec(script)?.[1] ?? '';
    expect(Buffer.from(delta, 'base64').toString('utf8')).toBe(paperDeltaTicket(OPTION));
  });
});

describe('paperDeltaTicket', () => {
  test('names a driver option in its own namespace', () => {
    const ticket = paperDeltaTicket(OPTION);
    expect(ticket).toContain('xmlns:lf="urn:labelflash-test:label-driver"');
    expect(ticket).toContain('<psf:Feature name="psk:PageMediaSize"><psf:Option name="lf:User0000000257"/></psf:Feature>');
  });

  test('writes a custom size in microns', () => {
    const ticket = paperDeltaTicket({ kind: 'custom', widthMicrons: 60_000, heightMicrons: 40_000 });
    expect(ticket).toContain('<psf:Option name="psk:CustomMediaSize">');
    expect(ticket).toContain('<psf:Value xsi:type="xsd:integer">60000</psf:Value>');
    expect(ticket).toContain('<psf:Value xsi:type="xsd:integer">40000</psf:Value>');
  });

  test('refuses names that could break the XML', () => {
    expect(() => paperDeltaTicket({ ...OPTION, localName: 'a"b' })).toThrow('option name');
    expect(() => paperDeltaTicket({ ...OPTION, namespace: 'urn:x"><' })).toThrow('namespace');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/windows-powershell.test.ts src/main/diagnosis/windows-scripts.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/windows-powershell.ts
import { execFile } from 'node:child_process';
import { powerShellLiteral } from '../shared/firewall-rule';
import { powerShellPath } from './firewall';

/**
 * 管理员确认没有成：外层脚本接住 Start-Process 的异常，用 Windows 的 ERROR_CANCELLED 退出。
 * 操作员点「否」是最常见的原因；系统没能弹出确认框也走这里，提示里两种都说到。
 */
export const ELEVATION_DECLINED_EXIT_CODE = 1223;
/** Windows 命令行的长度上限（32767 个字符）留出余量：外层命令超过它就是内层脚本写得太大。 */
export const MAX_ELEVATED_COMMAND_LENGTH = 30_000;
/** 诊断脚本的输出很短（一个数字或一行英文错误）；1MB 是硬上限。 */
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_LOGGED_STDERR = 500;

/** 一次 PowerShell 的结果。exitCode 为 null：没启动起来或被超时杀掉。 */
export interface PowerShellRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** -EncodedCommand 要 UTF-16LE 的 Base64：多行脚本、中文打印机名原样传入，不经过命令行转义。 */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * 以管理员身份运行一段脚本（和 firewall.ts 同样的做法）：外层用 Start-Process -Verb RunAs 弹 UAC，
 * 内层只拿到 Base64；外层把内层的退出码原样带回来，确认框没成时退出 1223。
 */
export function elevatedPowerShellCommand(innerScript: string, powerShell: string): string {
  const command = [
    `try { $p = Start-Process ${powerShellLiteral(powerShell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShell(innerScript)}' } catch { exit ${ELEVATION_DECLINED_EXIT_CODE} }`,
    'exit $p.ExitCode',
  ].join('; ');
  if (command.length > MAX_ELEVATED_COMMAND_LENGTH) {
    throw new Error(`Elevated PowerShell command is too long: ${command.length} characters`);
  }
  return command;
}

/** 跑系统目录下的 powershell.exe（不按名字在搜索路径里找）；出错写日志，结果原样交回。 */
export function runPowerShell(args: readonly string[], timeoutMs: number): Promise<PowerShellRun> {
  return new Promise((resolve) => {
    execFile(
      powerShellPath(process.env),
      ['-NoProfile', '-NonInteractive', ...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(`[powershell] ${error.message} ${String(stderr).trim().slice(0, MAX_LOGGED_STDERR)}`);
        }
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
        resolve({ exitCode: code, stdout: String(stdout), stderr: String(stderr), timedOut: error?.killed === true });
      },
    );
  });
}

export function runPowerShellScript(script: string, timeoutMs: number): Promise<PowerShellRun> {
  return runPowerShell(['-EncodedCommand', encodePowerShell(script)], timeoutMs);
}

export function runElevatedPowerShellScript(script: string, timeoutMs: number): Promise<PowerShellRun> {
  return runPowerShell(['-Command', elevatedPowerShellCommand(script, powerShellPath(process.env))], timeoutMs);
}
```

```ts
// src/main/diagnosis/windows-scripts.ts
import {
  PRINT_TICKET_LOCAL_NAME_PATTERN,
  PRINT_TICKET_NAMESPACE_PATTERN,
  type PrintTicketPaper,
} from '../../core/diagnosis/paper-choice';
import { powerShellLiteral } from '../../shared/firewall-rule';
import { PAPER_TOLERANCE_MM, type PaperSize } from '../../shared/paper-sizes';

/** 脚本的退出码：提权后的窗口是隐藏的，输出拿不回来，结果只能靠退出码带回。 */
export const SCRIPT_EXIT = { done: 0, failed: 1, driverRefused: 3, rolledBack: 4 } as const;

const MICRONS_PER_MM = 1_000;
/** 等服务停下、启动的最长时间：Spooler 正常几秒内就好，30 秒还没好就是卡住了。 */
const SERVICE_WAIT_SECONDS = 30;

/** Print Schema / XML Schema 的命名空间名（PrintTicket 规定必须这样写，不是网络地址）。 */
const PSF = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework';
const PSK = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XSD = 'http://www.w3.org/2001/XMLSchema';

/**
 * 每个脚本的开头：出错就停；不显示进度条；模块只从 PowerShell 自己的目录找
 * （以管理员身份运行时，用户「文档」里的同名模块可以借确认框提权，见 firewall-rule.ts）。
 */
const PREAMBLE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$env:PSModulePath = Join-Path $PSHOME 'Modules'",
].join('\n');

/** 打开这台打印机的队列，要「管理打印机」权限（清空、改默认设置都要）。 */
const OPEN_QUEUE_AS_ADMIN = `Add-Type -AssemblyName System.Printing
  $queue = New-Object System.Printing.PrintQueue -ArgumentList (New-Object System.Printing.PrintServer), $Name, ([System.Printing.PrintSystemDesiredAccess]::AdministratePrinter)`;

const RESTART_SPOOLER_BODY = `
try {
  Add-Type -AssemblyName System.ServiceProcess
  $service = New-Object System.ServiceProcess.ServiceController -ArgumentList 'Spooler'
  if ($service.StartType -eq [System.ServiceProcess.ServiceStartMode]::Disabled) {
    & (Join-Path ([Environment]::SystemDirectory) 'sc.exe') config Spooler start= auto | Out-Null
    if ($LASTEXITCODE -ne 0) { exit ${SCRIPT_EXIT.failed} }
  }
  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    $service.Stop()
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(${SERVICE_WAIT_SECONDS}))
  }
  $service.Start()
  $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(${SERVICE_WAIT_SECONDS}))
  exit ${SCRIPT_EXIT.done}
} catch {
  exit ${SCRIPT_EXIT.failed}
}`;

/**
 * 重启后台打印服务（管理员）：被禁用的先设为自动；ServiceController.Stop 会先停依赖它的服务（例如传真），
 * 不会替它们重新启动——它们本来也只在用到时启动。
 */
export function restartSpoolerScript(): string {
  return [PREAMBLE, RESTART_SPOOLER_BODY].join('\n');
}

/** 清空这台打印机的队列（管理员）：PrintQueue.Purge 取消全部任务，不管是谁的。 */
export function purgeQueueScript(printerName: string): string {
  return [
    PREAMBLE,
    `$Name = ${powerShellLiteral(printerName)}`,
    `try {
  ${OPEN_QUEUE_AS_ADMIN}
  $queue.Purge()
  exit ${SCRIPT_EXIT.done}
} catch {
  exit ${SCRIPT_EXIT.failed}
}`,
  ].join('\n');
}

/**
 * 取消本程序的几个任务（当前用户，不要管理员：任务的提交人可以取消自己的任务）。
 * 某个任务刚好打完了不算错：写一行到 stderr（进日志），接着取消下一个。输出取消成功的个数。
 */
export function cancelJobsScript(printerName: string, ids: readonly number[]): string {
  if (ids.length === 0 || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new Error(`Invalid job ids to cancel: ${ids.join(', ')}`);
  }
  return [
    PREAMBLE,
    `$Name = ${powerShellLiteral(printerName)}`,
    `$Ids = @(${ids.join(', ')})`,
    `$canceled = 0
try {
  Add-Type -AssemblyName System.Printing
  $queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($Name)
  foreach ($id in $Ids) {
    try { $queue.GetJob($id).Cancel(); $canceled++ } catch { [Console]::Error.WriteLine("job $id: " + $_.Exception.Message) }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit ${SCRIPT_EXIT.failed}
}
[Console]::Out.WriteLine($canceled)
exit ${SCRIPT_EXIT.done}`,
  ].join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * 只含纸张这一项的 PrintTicket 增量，交给 PrintQueue.MergeAndValidatePrintTicket 合进现有设置：
 * 驱动的选项写成它自己命名空间里的名字；自定义尺寸写 psk:CustomMediaSize 和两个以微米计的参数。
 */
export function paperDeltaTicket(paper: PrintTicketPaper): string {
  const head = `<?xml version="1.0" encoding="UTF-8"?>`;
  const namespaces = `xmlns:psf="${PSF}" xmlns:psk="${PSK}" xmlns:xsi="${XSI}" xmlns:xsd="${XSD}"`;
  if (paper.kind === 'option') {
    if (!PRINT_TICKET_NAMESPACE_PATTERN.test(paper.namespace)) {
      throw new Error(`Invalid PrintTicket namespace: ${paper.namespace}`);
    }
    if (!PRINT_TICKET_LOCAL_NAME_PATTERN.test(paper.localName)) {
      throw new Error(`Invalid PrintTicket option name: ${paper.localName}`);
    }
    return `${head}<psf:PrintTicket ${namespaces} xmlns:lf="${escapeXmlAttribute(paper.namespace)}" version="1"><psf:Feature name="psk:PageMediaSize"><psf:Option name="lf:${paper.localName}"/></psf:Feature></psf:PrintTicket>`;
  }
  const integer = (value: number) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid custom paper size in microns: ${value}`);
    }
    return `<psf:Value xsi:type="xsd:integer">${value}</psf:Value>`;
  };
  return `${head}<psf:PrintTicket ${namespaces} version="1"><psf:Feature name="psk:PageMediaSize"><psf:Option name="psk:CustomMediaSize"><psf:ScoredProperty name="psk:MediaSizeWidth"><psf:ParameterRef name="psk:PageMediaSizeMediaSizeWidth"/></psf:ScoredProperty><psf:ScoredProperty name="psk:MediaSizeHeight"><psf:ParameterRef name="psk:PageMediaSizeMediaSizeHeight"/></psf:ScoredProperty></psf:Option></psf:Feature><psf:ParameterInit name="psk:PageMediaSizeMediaSizeWidth">${integer(paper.widthMicrons)}</psf:ParameterInit><psf:ParameterInit name="psk:PageMediaSizeMediaSizeHeight">${integer(paper.heightMicrons)}</psf:ParameterInit></psf:PrintTicket>`;
}

/**
 * 设置驱动的默认纸张（管理员），失败回滚：
 * 1. 记下原来的 DefaultPrintTicket；
 * 2. 把增量合进去、让驱动校验，校验后的尺寸不对就说明驱动不接受（什么都没改，退出 3）；
 * 3. 写回、重读，重读的尺寸不对就恢复原来的（退出 4）；
 * 4. 同一账户的 UserPrintTicket（打印首选项里的个人设置，Chromium 打印时用它）也合进同样的增量。
 * PageMediaSize 的宽高以 1/96 英寸计。
 */
const SET_PAPER_BODY = `
$MicronsPerDip = 25400 / 96
function Test-Paper($ticket) {
  $size = $ticket.PageMediaSize
  if ($null -eq $size -or $null -eq $size.Width -or $null -eq $size.Height) { return $false }
  return ([Math]::Abs($size.Width * $MicronsPerDip - $WidthMicrons) -le $ToleranceMicrons) -and ([Math]::Abs($size.Height * $MicronsPerDip - $HeightMicrons) -le $ToleranceMicrons)
}
$queue = $null
$before = $null
try {
  ${OPEN_QUEUE_AS_ADMIN}
  $before = $queue.DefaultPrintTicket.GetXmlStream().ToArray()
  $delta = New-Object System.Printing.PrintTicket -ArgumentList (,(New-Object System.IO.MemoryStream -ArgumentList (,[Convert]::FromBase64String($Delta))))
  $merged = $queue.MergeAndValidatePrintTicket($queue.DefaultPrintTicket, $delta).ValidatedPrintTicket
  if (-not (Test-Paper $merged)) { exit ${SCRIPT_EXIT.driverRefused} }
  $queue.DefaultPrintTicket = $merged
  $queue.Commit()
  $queue.Refresh()
  if (-not (Test-Paper $queue.DefaultPrintTicket)) { throw 'read-back mismatch' }
  if ($null -ne $queue.UserPrintTicket) {
    $queue.UserPrintTicket = $queue.MergeAndValidatePrintTicket($queue.UserPrintTicket, $delta).ValidatedPrintTicket
    $queue.Commit()
  }
  exit ${SCRIPT_EXIT.done}
} catch {
  if ($null -ne $queue -and $null -ne $before) {
    try {
      $queue.DefaultPrintTicket = New-Object System.Printing.PrintTicket -ArgumentList (,(New-Object System.IO.MemoryStream -ArgumentList (,$before)))
      $queue.Commit()
      exit ${SCRIPT_EXIT.rolledBack}
    } catch {
      exit ${SCRIPT_EXIT.failed}
    }
  }
  exit ${SCRIPT_EXIT.failed}
}`;

export function setDriverPaperScript(printerName: string, paper: PrintTicketPaper, target: PaperSize): string {
  return [
    PREAMBLE,
    `$Name = ${powerShellLiteral(printerName)}`,
    `$Delta = '${Buffer.from(paperDeltaTicket(paper), 'utf8').toString('base64')}'`,
    `$WidthMicrons = ${Math.round(target.widthMm * MICRONS_PER_MM)}`,
    `$HeightMicrons = ${Math.round(target.heightMm * MICRONS_PER_MM)}`,
    `$ToleranceMicrons = ${PAPER_TOLERANCE_MM * MICRONS_PER_MM}`,
    SET_PAPER_BODY,
  ].join('\n');
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/windows-powershell.test.ts src/main/diagnosis/windows-scripts.test.ts src/main/firewall.test.ts`
Expected: PASS（防火墙的测试不受影响）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/windows-powershell.ts src/main/windows-powershell.test.ts src/main/diagnosis/windows-scripts.ts src/main/diagnosis/windows-scripts.test.ts
git commit -m "feat(diagnosis): Windows scripts for restarting the spooler, clearing queues and setting the driver paper" -m "Admin scripts follow the firewall pattern: UAC through Start-Process, the inner script as Base64, the printer name only as a PowerShell literal. Inside they trust only modules under PSHOME, .NET system assemblies and sc.exe from the system directory, and report results by exit code. The driver paper is set through a PrintTicket delta that the driver validates, read back, and rolled back on mismatch, without a new native module." -m "$TRAILER"
```

---

### Task 8: macOS：命令、解析和运行器

- 查询：`/usr/bin/lpstat -r`（调度程序）、现有的 `ipptool -tv … get-printer-attributes.test`（状态、原因、是否接收、纸张）、`/usr/bin/lpstat -v <队列>`（设备地址）、`/usr/sbin/system_profiler -json SPUSBDataType SPUSBHostDataType`（USB 设备；macOS 15 起 USB 信息在后一个类型里，两个都要，旧系统不认识的类型输出为空）、`ipptool -tv <地址> <临时测试文件>`（Get-Jobs，见 `CUPS_GET_JOBS_TEST`）。
- 环境：`LANG=en_US.UTF-8`、`LC_ALL=en_US.UTF-8`——中文系统下 `lpstat` 说中文，解析按英文写。
- 运行器：`spawn` 参数数组、不经 shell，stdin 关掉、`detached: true`（独立会话，没有控制终端）：CUPS 命令要密码时会去终端上问，开发版从终端启动时会卡住；没有终端就直接失败，我们据此换成管理员按钮。限时、限输出，超出的输出不要、按失败处理。
- 管理员：`/usr/bin/osascript -e 'on run argv' -e 'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges' -e 'end run' <命令> <提示>`。为什么用它：系统自带、弹的是系统自己的管理员密码框、提示文字能写清要做什么；不用 `sudo`（要终端）、`AuthorizationExecuteWithPrivileges`（已弃用、要原生代码）、特权助手 `SMJobBless`（要 Developer ID 签名，我们还没有）。命令和提示都经 argv 传入，AppleScript 里没有拼接；`do shell script` 会交给 `/bin/sh`，所以命令由 `shellCommand` 把可执行文件（绝对路径）和每个参数单引号转义后拼成。操作员点「取消」时 osascript 报 `(-128)`，按「没有拿到管理员权限」处理。

**Files:**
- Create: `src/main/diagnosis/mac-commands.ts`、`src/main/diagnosis/mac-commands.test.ts`
- Create: `src/main/diagnosis/mac-facts.ts`、`src/main/diagnosis/mac-facts.test.ts`
- Create: `src/main/diagnosis/command-runner.ts`、`src/main/diagnosis/command-runner.test.ts`
- Create: `src/main/diagnosis/testing/fixtures/mac/*.txt`
- Modify: `src/main/printing/driver-paper.ts`

- [ ] **Step 1: 样本**

`src/main/diagnosis/testing/fixtures/mac/lpstat-r-running.txt`：

```
scheduler is running
```

`lpstat-r-stopped.txt`：

```
scheduler is not running
```

`ipp-printer-stopped.txt`（暂停 + 缺纸、默认纸张 4×6 英寸）：

```
"/usr/share/cups/ipptool/get-printer-attributes.test":
    Get-Printer-Attributes                                               [PASS]
        RECEIVED: 3164 bytes in response
        status-code = successful-ok (successful-ok)
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        printer-make-and-model (textWithoutLanguage) = Label Printer 203dpi
        printer-state (enum) = stopped
        printer-state-reasons (1setOf keyword) = paused,media-empty-error
        printer-is-accepting-jobs (boolean) = true
        media-default (keyword) = oe_4x6-label_4x6in
        media-supported (1setOf keyword) = oe_4x6-label_4x6in,om_60x40mm_60x40mm,custom_min_25.4x12.7mm,custom_max_104x990mm
        media-col-default (collection) = {media-size={x-dimension=10160 y-dimension=15240} media-top-margin=0}
        printer-resolution-default (resolution) = 203dpi
```

`ipp-printer-idle.txt`：

```
        printer-make-and-model (textWithoutLanguage) = Label Printer 203dpi
        printer-state (enum) = idle
        printer-state-reasons (keyword) = none
        printer-is-accepting-jobs (boolean) = true
        media-default (keyword) = om_60x40mm_60x40mm
        media-supported (1setOf keyword) = om_60x40mm_60x40mm
        media-col-default (collection) = {media-size={x-dimension=6000 y-dimension=4000} media-top-margin=0}
```

`lpstat-v-usb.txt`：

```
device for Label_Printer: usb://Label%20Maker/Label%20Printer%20203?serial=LBL0001
```

`lpstat-v-network.txt`：

```
device for Office: dnssd://Office%20Printer._ipp._tcp.local./?uuid=4509a320-00a0-008f-00b6-002507510eca
```

`system-profiler-usb.txt`（macOS 14 的 `SPUSBDataType`，标签机在一个集线器下面）：

```
{
  "SPUSBDataType" : [
    {
      "_items" : [
        {
          "_items" : [
            {
              "_name" : "Label Printer 203",
              "manufacturer" : "Label Maker",
              "product_id" : "0x0123",
              "serial_num" : "LBL0001",
              "vendor_id" : "0x1234  (Label Maker)"
            }
          ],
          "_name" : "USB2.0 Hub"
        }
      ],
      "_name" : "USB31Bus"
    }
  ]
}
```

`system-profiler-usb-host.txt`（macOS 15 的 `SPUSBHostDataType`，键名不同；Task 18 用真机输出核对键名）：

```
{
  "SPUSBDataType" : [],
  "SPUSBHostDataType" : [
    {
      "_items" : [
        {
          "_name" : "Label Printer 203",
          "USBDeviceKeyProductName" : "Label Printer 203",
          "USBDeviceKeySerialNumber" : "LBL0001",
          "USBDeviceKeyVendorName" : "Label Maker"
        }
      ],
      "_name" : "USB30Bus"
    }
  ]
}
```

`ipp-jobs.txt`（两个任务：一个停住的本用户任务、一个别人的；请求里的属性不在我们关心的六个里）：

```
"/var/folders/xy/T/labelflash-ipp-a1/labelflash-get-jobs.test":
    LabelFlash Get-Jobs                                                  [PASS]
        RECEIVED: 412 bytes in response
        status-code = successful-ok (successful-ok)
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        job-id (integer) = 41
        job-name (nameWithoutLanguage) = CL5640-TK-图片色-XL
        job-originating-user-name (nameWithoutLanguage) = shop
        job-state (enum) = processing-stopped
        job-state-reasons (1setOf keyword) = printer-stopped
        time-at-creation (integer) = 1790000000
        job-id (integer) = 42
        job-name (nameWithoutLanguage) = report.pdf
        job-originating-user-name (nameWithoutLanguage) = boss
        job-state (enum) = pending-held
        job-state-reasons (keyword) = job-hold-until-specified
        time-at-creation (integer) = 1789990000
```

- [ ] **Step 2: 写测试**

```ts
// src/main/diagnosis/mac-commands.test.ts
import { describe, expect, test } from 'bun:test';
import {
  adminOsascriptArgs,
  assertQueueName,
  CUPS_FORBIDDEN_PATTERN,
  enablePrinterCommand,
  setMediaArgs,
  shellCommand,
  shellQuote,
  USER_CANCELED_PATTERN,
} from './mac-commands';

describe('shell quoting for do shell script', () => {
  test('single-quotes every argument, including quotes and $ inside it', () => {
    expect(shellQuote("O'Neil $HOME")).toBe(`'O'\\''Neil $HOME'`);
    expect(shellCommand('/usr/bin/cancel', ['-a', 'Label Printer'])).toBe("'/usr/bin/cancel' '-a' 'Label Printer'");
    expect(enablePrinterCommand('Label_Printer')).toBe(
      "'/usr/sbin/cupsenable' 'Label_Printer' && '/usr/sbin/cupsaccept' 'Label_Printer'",
    );
  });
});

describe('adminOsascriptArgs', () => {
  test('passes the command and the prompt as argv, never inside the AppleScript', () => {
    const args = adminOsascriptArgs("'/usr/bin/cancel' '-a' 'Q'", 'CDL-云签速印 要清空打印机「Q」的队列。');
    expect(args.slice(0, 6)).toEqual([
      '-e',
      'on run argv',
      '-e',
      'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
      '-e',
      'end run',
    ]);
    expect(args.slice(6)).toEqual(["'/usr/bin/cancel' '-a' 'Q'", 'CDL-云签速印 要清空打印机「Q」的队列。']);
  });
});

describe('guards', () => {
  test('rejects queue names that a command would read as an option', () => {
    expect(() => assertQueueName('-a')).toThrow('queue name');
    expect(() => assertQueueName('')).toThrow('queue name');
    expect(() => assertQueueName('Label_Printer')).not.toThrow();
  });

  test('only sets media names that look like PWG keywords', () => {
    expect(setMediaArgs('Label_Printer', 'om_60x40mm_60x40mm')).toEqual([
      '-p',
      'Label_Printer',
      '-o',
      'media-default=om_60x40mm_60x40mm',
    ]);
    expect(() => setMediaArgs('Label_Printer', 'a b')).toThrow('media');
  });

  test('recognizes a refused CUPS request and a canceled password prompt', () => {
    expect(CUPS_FORBIDDEN_PATTERN.test('lpadmin: Forbidden')).toBe(true);
    expect(CUPS_FORBIDDEN_PATTERN.test('cupsenable: Unauthorized')).toBe(true);
    expect(USER_CANCELED_PATTERN.test('execution error: User canceled. (-128)')).toBe(true);
  });
});
```

```ts
// src/main/diagnosis/mac-facts.test.ts
import { describe, expect, test } from 'bun:test';
import {
  macUsbFacts,
  parseDeviceUri,
  parseIppJobs,
  parseIppPrinterState,
  parseSchedulerStatus,
  parseSystemProfilerUsb,
  readinessFromReasons,
} from './mac-facts';
import { fixture } from './testing/fixtures';

const sample = (name: string) => fixture('mac', name);

describe('parseSchedulerStatus', () => {
  test('reads whether cupsd runs', () => {
    expect(parseSchedulerStatus(sample('lpstat-r-running.txt'))).toBe(true);
    expect(parseSchedulerStatus(sample('lpstat-r-stopped.txt'))).toBe(false);
    expect(parseSchedulerStatus('调度程序正在运行')).toBeNull();
    expect(parseSchedulerStatus(null)).toBeNull();
  });
});

describe('parseIppPrinterState', () => {
  test('reads state, reasons, accepting and media from ipptool', () => {
    expect(parseIppPrinterState(sample('ipp-printer-stopped.txt'))).toEqual({
      state: 'stopped',
      reasons: ['paused', 'media-empty-error'],
      acceptingJobs: true,
      makeAndModel: 'Label Printer 203dpi',
      mediaDefault: 'oe_4x6-label_4x6in',
      mediaSupported: [
        'oe_4x6-label_4x6in',
        'om_60x40mm_60x40mm',
        'custom_min_25.4x12.7mm',
        'custom_max_104x990mm',
      ],
    });
    expect(parseIppPrinterState(sample('ipp-printer-idle.txt'))).toMatchObject({ state: 'idle', reasons: [] });
  });
});

describe('readinessFromReasons', () => {
  test('maps CUPS state reasons to the same issues as Windows', () => {
    expect(readinessFromReasons(['paused', 'media-empty-error'])).toEqual({
      ready: false,
      detail: '缺纸',
      issue: 'paperOut',
    });
    expect(readinessFromReasons(['offline-report', 'cover-open-error'])).toEqual({
      ready: false,
      detail: '打印机离线、机盖未关',
      issue: 'doorOpen',
    });
    expect(readinessFromReasons(['none'])).toEqual({ ready: true });
  });
});

describe('USB on macOS', () => {
  test('matches the CUPS usb:// device by serial number on both system_profiler layouts', () => {
    const uri = parseDeviceUri(sample('lpstat-v-usb.txt'));
    expect(uri).toBe('usb://Label%20Maker/Label%20Printer%20203?serial=LBL0001');
    expect(macUsbFacts(uri, parseSystemProfilerUsb(sample('system-profiler-usb.txt')))).toEqual({
      kind: 'present',
      deviceName: 'Label Printer 203',
    });
    expect(macUsbFacts(uri, parseSystemProfilerUsb(sample('system-profiler-usb-host.txt')))).toEqual({
      kind: 'present',
      deviceName: 'Label Printer 203',
    });
  });

  test('reports a USB printer missing from the USB tree and skips network printers', () => {
    const uri = parseDeviceUri(sample('lpstat-v-usb.txt'));
    expect(macUsbFacts(uri, [])).toEqual({ kind: 'not-found', port: 'usb://Label Maker/Label Printer 203' });
    expect(macUsbFacts(parseDeviceUri(sample('lpstat-v-network.txt')), [])).toEqual({ kind: 'not-usb', port: 'dnssd' });
    expect(macUsbFacts(null, [])).toMatchObject({ kind: 'unknown' });
  });
});

describe('parseIppJobs', () => {
  test('splits jobs where an attribute repeats and converts seconds to milliseconds', () => {
    expect(parseIppJobs(sample('ipp-jobs.txt'), 'shop')).toEqual({
      kind: 'listed',
      currentUser: 'shop',
      total: 2,
      jobs: [
        { id: 41, document: 'CL5640-TK-图片色-XL', user: 'shop', submittedAtMs: 1_790_000_000_000, flags: ['stopped'] },
        { id: 42, document: 'report.pdf', user: 'boss', submittedAtMs: 1_789_990_000_000, flags: ['held'] },
      ],
    });
  });

  test('an empty queue has no jobs; no output means it could not be read', () => {
    expect(parseIppJobs('    LabelFlash Get-Jobs [PASS]\n', 'shop')).toMatchObject({ kind: 'listed', total: 0 });
    expect(parseIppJobs(null, 'shop')).toMatchObject({ kind: 'unknown' });
  });
});
```

```ts
// src/main/diagnosis/command-runner.test.ts
import { describe, expect, test } from 'bun:test';
import { runCommand } from './command-runner';

// 用 Bun 自己当被调用的程序：两个平台的 CI 上都有。
const BUN = process.execPath;
const OPTIONS = { timeoutMs: 5_000, maxOutputBytes: 1_024 };

describe('runCommand', () => {
  test('returns the exit code and output without a shell', async () => {
    const run = await runCommand(BUN, ['-e', 'console.log("$HOME;x"); process.exit(3)'], OPTIONS, process.env);
    expect(run).toMatchObject({ exitCode: 3, stdout: '$HOME;x\n', timedOut: false });
  });

  test('kills a command that runs too long', async () => {
    const run = await runCommand(BUN, ['-e', 'setTimeout(() => {}, 10_000)'], { ...OPTIONS, timeoutMs: 100 }, process.env);
    expect(run.timedOut).toBe(true);
  });

  test('drops output beyond the limit and reports it', async () => {
    const run = await runCommand(BUN, ['-e', 'process.stdout.write("x".repeat(5000))'], OPTIONS, process.env);
    expect(run).toMatchObject({ exitCode: null, stdout: '' });
    expect(run.stderr).toContain('exceeded');
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/diagnosis/mac-commands.test.ts src/main/diagnosis/mac-facts.test.ts src/main/diagnosis/command-runner.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现**

```ts
// src/main/diagnosis/mac-commands.ts
import { CUPS_MEDIA_KEYWORD_PATTERN } from '../../core/diagnosis/paper-choice';
import { BRAND } from '../../shared/brand';

/** macOS 自带的命令，一律绝对路径：不按名字在搜索路径里找。 */
export const MAC_TOOLS = {
  lpstat: '/usr/bin/lpstat',
  ipptool: '/usr/bin/ipptool',
  cancel: '/usr/bin/cancel',
  cupsenable: '/usr/sbin/cupsenable',
  cupsaccept: '/usr/sbin/cupsaccept',
  lpadmin: '/usr/sbin/lpadmin',
  systemProfiler: '/usr/sbin/system_profiler',
  osascript: '/usr/bin/osascript',
  launchctl: '/bin/launchctl',
} as const;

/** CUPS 命令的输出按英文解析：中文系统下 lpstat 会说中文。 */
export const MAC_COMMAND_ENV: Readonly<Record<string, string>> = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

/** CUPS 因为权限拒绝时的说法（lpadmin、cupsenable 都是「程序名: Forbidden」这样）。 */
export const CUPS_FORBIDDEN_PATTERN = /forbidden|not authori[sz]ed|unauthori[sz]ed/i;
/** osascript 里操作员点了「取消」：AppleScript 的错误 -128。 */
export const USER_CANCELED_PATTERN = /\(-128\)/;
/** CUPS 队列名的长度上限（CUPS 自己限制 127 个字符）。 */
const MAX_QUEUE_NAME_LENGTH = 127;

/** 打印机名来自系统列表，这里再挡一次会被命令当成选项（-a）、或带控制字符的名字。 */
export function assertQueueName(name: string): void {
  if (name === '' || name.length > MAX_QUEUE_NAME_LENGTH || name.startsWith('-') || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(`Invalid CUPS queue name: ${JSON.stringify(name)}`);
  }
}

/** /bin/sh 的单引号字面量：里面只有单引号要处理（结束、转义、再开始）。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** 给 do shell script 的命令：可执行文件（绝对路径）和每个参数都单引号转义，不留任何 shell 能展开的东西。 */
export function shellCommand(file: string, args: readonly string[]): string {
  return [file, ...args].map(shellQuote).join(' ');
}

const ADMIN_APPLESCRIPT = [
  'on run argv',
  'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
  'end run',
];

/** osascript 的参数：AppleScript 是固定的三行，命令和提示经 argv 传入。 */
export function adminOsascriptArgs(command: string, prompt: string): string[] {
  return [...ADMIN_APPLESCRIPT.flatMap((line) => ['-e', line]), command, prompt];
}

/** 管理员密码框上的话：说清是哪个程序、要做什么。 */
export function adminPrompt(action: string): string {
  return `${BRAND.productName} 要${action}。`;
}

/** 恢复一台被暂停或拒收的打印机：启用 + 接收任务。 */
export function enablePrinterCommand(queue: string): string {
  assertQueueName(queue);
  return `${shellCommand(MAC_TOOLS.cupsenable, [queue])} && ${shellCommand(MAC_TOOLS.cupsaccept, [queue])}`;
}

export function cancelAllJobsCommand(queue: string): string {
  assertQueueName(queue);
  return shellCommand(MAC_TOOLS.cancel, ['-a', queue]);
}

/** cupsd 由 launchd 管：kickstart -k 先停再起。 */
export function restartCupsCommand(): string {
  return shellCommand(MAC_TOOLS.launchctl, ['kickstart', '-k', 'system/org.cups.cupsd']);
}

/** lpadmin 设默认纸张的参数（job template 属性 media-default）。 */
export function setMediaArgs(queue: string, keyword: string): string[] {
  assertQueueName(queue);
  if (!CUPS_MEDIA_KEYWORD_PATTERN.test(keyword)) {
    throw new Error(`Invalid CUPS media keyword: ${keyword}`);
  }
  return ['-p', queue, '-o', `media-default=${keyword}`];
}

/** 临时测试文件名。 */
export const JOBS_TEST_FILE_NAME = 'labelflash-get-jobs.test';

/**
 * ipptool 的 Get-Jobs 测试：只要没完成的任务、只要六个属性。$uri、$user 由 ipptool 替换成命令行给的地址和当前用户。
 * 系统自带的 get-jobs.test 不一定在、要的属性也不一定够，所以自己写一份，用时写进临时目录。
 */
export const CUPS_GET_JOBS_TEST = `{
  NAME "LabelFlash Get-Jobs"
  OPERATION Get-Jobs
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  ATTR name requesting-user-name $user
  ATTR keyword which-jobs not-completed
  ATTR keyword requested-attributes job-id,job-name,job-originating-user-name,job-state,job-state-reasons,time-at-creation
  STATUS successful-ok
}
`;
```

```ts
// src/main/diagnosis/mac-facts.ts
import {
  DIAGNOSIS_LIMITS,
  type JobFlag,
  type QueueFacts,
  type QueueJob,
  type UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import { PRINTER_ISSUES, type PrinterIssue, type PrinterReadiness } from '../../shared/printer-readiness';
import { isRecord } from '../../shared/settings';

/** ipptool -tv 输出的一行属性：「名字 (类型) = 值」。 */
const IPP_ATTRIBUTE_LINE = /^\s*([a-z0-9-]+) \(([^)]*)\) = (.*)$/;
const MS_PER_SECOND = 1_000;
/** system_profiler 的 USB 树最多走这么深、收这么多个设备：真实的树三四层、几十个设备。 */
const MAX_USB_TREE_DEPTH = 12;
const MAX_USB_DEVICES = 200;
const USB_URI_PATTERN = /^usb:\/\/([^/?]*)\/([^?]*)(?:\?(.*))?$/;

function lines(output: string): string[] {
  return output.split(/\r?\n/);
}

/** 每个属性第一次出现的值（打印机属性的回答里每个属性只出现一次）。 */
function ippAttributes(output: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const line of lines(output)) {
    const match = IPP_ATTRIBUTE_LINE.exec(line);
    const name = match?.[1];
    const value = match?.[3];
    if (name !== undefined && value !== undefined && !attributes.has(name)) {
      attributes.set(name, value.trim());
    }
  }
  return attributes;
}

function keywords(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '' && item !== 'none');
}

/** lpstat -r：调度程序在不在跑；读不懂（例如没按英文输出）为 null。 */
export function parseSchedulerStatus(output: string | null): boolean | null {
  if (output === null) {
    return null;
  }
  if (/scheduler is not running/.test(output)) {
    return false;
  }
  return /scheduler is running/.test(output) ? true : null;
}

/** 打印机属性里诊断用到的几项。 */
export interface IppPrinterState {
  state: 'idle' | 'processing' | 'stopped' | null;
  reasons: string[];
  acceptingJobs: boolean | null;
  makeAndModel: string | null;
  mediaDefault: string | null;
  mediaSupported: string[];
}

export function parseIppPrinterState(output: string): IppPrinterState {
  const attributes = ippAttributes(output);
  const state = attributes.get('printer-state');
  const accepting = attributes.get('printer-is-accepting-jobs');
  const media = attributes.get('media-default');
  return {
    state: state === 'idle' || state === 'processing' || state === 'stopped' ? state : null,
    reasons: keywords(attributes.get('printer-state-reasons')),
    acceptingJobs: accepting === 'true' ? true : accepting === 'false' ? false : null,
    makeAndModel: attributes.get('printer-make-and-model')?.slice(0, DIAGNOSIS_LIMITS.textLength) ?? null,
    mediaDefault: media === undefined || media === 'none' ? null : media,
    mediaSupported: keywords(attributes.get('media-supported')),
  };
}

interface ReasonStatus {
  detail: string;
  issue: PrinterIssue;
}

/** CUPS 的 printer-state-reasons（去掉 -error / -warning / -report 后缀）里表示「打不了」的几种。paused 在后台打印服务一项说。 */
const REASON_STATUS: ReadonlyMap<string, ReasonStatus> = new Map([
  ['media-empty', { detail: '缺纸', issue: 'paperOut' }],
  ['media-needed', { detail: '缺纸', issue: 'paperOut' }],
  ['input-tray-missing', { detail: '纸盒没装好', issue: 'paperOut' }],
  ['media-jam', { detail: '卡纸', issue: 'paperJam' }],
  ['door-open', { detail: '机盖未关', issue: 'doorOpen' }],
  ['cover-open', { detail: '机盖未关', issue: 'doorOpen' }],
  ['offline', { detail: '打印机离线', issue: 'offline' }],
  ['connecting-to-device', { detail: '连不上打印机', issue: 'offline' }],
  ['marker-supply-empty', { detail: '碳带或墨粉耗尽', issue: 'other' }],
  ['toner-empty', { detail: '碳带或墨粉耗尽', issue: 'other' }],
]);

/** 和 Windows 的 parsePrinterStatus 同样的规则：同时有几个问题时，按 PRINTER_ISSUES 的顺序取最需要人动手的那个。 */
export function readinessFromReasons(reasons: readonly string[]): PrinterReadiness {
  const problems = reasons.flatMap((reason) => {
    const status = REASON_STATUS.get(reason.replace(/-(error|warning|report)$/, ''));
    return status === undefined ? [] : [status];
  });
  if (problems.length === 0) {
    return { ready: true };
  }
  const issue = PRINTER_ISSUES.find((candidate) => problems.some((status) => status.issue === candidate)) ?? 'other';
  return { ready: false, detail: [...new Set(problems.map((status) => status.detail))].join('、'), issue };
}

/** lpstat -v <队列>：设备地址；读不懂为 null。 */
export function parseDeviceUri(output: string | null): string | null {
  if (output === null) {
    return null;
  }
  const match = /^device for .+?: (\S+)\s*$/m.exec(output);
  return match?.[1] ?? null;
}

/** USB 树里的一个设备（含集线器，不影响按序列号、名字匹配）。 */
export interface UsbDevice {
  name: string;
  serial: string | null;
}

function collectDevices(node: unknown, depth: number, devices: UsbDevice[]): void {
  if (depth > MAX_USB_TREE_DEPTH || devices.length >= MAX_USB_DEVICES) {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectDevices(child, depth + 1, devices);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const name = node['_name'];
  const serial = node['serial_num'] ?? node['USBDeviceKeySerialNumber'];
  if (typeof name === 'string' && name !== '') {
    devices.push({
      name: name.slice(0, DIAGNOSIS_LIMITS.textLength),
      serial: typeof serial === 'string' && serial !== '' ? serial : null,
    });
  }
  collectDevices(node['_items'], depth + 1, devices);
}

/** system_profiler -json SPUSBDataType SPUSBHostDataType：两种布局都收（macOS 15 起 USB 信息在后一个里）。 */
export function parseSystemProfilerUsb(output: string | null): UsbDevice[] | null {
  if (output === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const devices: UsbDevice[] = [];
  collectDevices(parsed['SPUSBDataType'], 0, devices);
  collectDevices(parsed['SPUSBHostDataType'], 0, devices);
  return devices;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function normalized(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/**
 * CUPS 的 USB 设备地址是 usb://厂家/型号?serial=序列号：有序列号按序列号找，没有按型号名字找。
 * 不是 usb:// 的（dnssd、ipp、socket……）这一项不适用，只显示协议名（地址里可能有局域网 IP，不显示）。
 */
export function macUsbFacts(uri: string | null, devices: readonly UsbDevice[] | null): UsbFacts {
  if (uri === null) {
    return { kind: 'unknown', reason: 'lpstat -v gave no device uri' };
  }
  const scheme = uri.split(':')[0] ?? '';
  const match = USB_URI_PATTERN.exec(uri);
  if (match === null) {
    return scheme === 'usb'
      ? { kind: 'unknown', reason: `unreadable usb uri: ${uri.slice(0, DIAGNOSIS_LIMITS.textLength)}` }
      : { kind: 'not-usb', port: scheme };
  }
  if (devices === null) {
    return { kind: 'unknown', reason: 'system_profiler gave no usb devices' };
  }
  const make = decode(match[1] ?? '');
  const model = decode(match[2] ?? '');
  const serial = new URLSearchParams(match[3] ?? '').get('serial');
  const found =
    serial === null
      ? devices.find(
          (device) =>
            model !== '' &&
            (normalized(device.name).includes(normalized(model)) || normalized(model).includes(normalized(device.name))),
        )
      : devices.find((device) => device.serial === serial);
  return found === undefined
    ? { kind: 'not-found', port: `usb://${make}/${model}` }
    : { kind: 'present', deviceName: found.name };
}

const JOB_ATTRIBUTES: ReadonlySet<string> = new Set([
  'job-id',
  'job-name',
  'job-originating-user-name',
  'job-state',
  'job-state-reasons',
  'time-at-creation',
]);

const JOB_STATE_FLAGS: ReadonlyMap<string, JobFlag> = new Map([
  ['pending-held', 'held'],
  ['processing-stopped', 'stopped'],
  ['processing', 'printing'],
]);

const JOB_REASON_FLAGS: ReadonlyMap<string, JobFlag> = new Map([
  ['printer-stopped', 'stopped'],
  ['job-hold-until-specified', 'held'],
]);

function readIppJob(attributes: ReadonlyMap<string, string>): QueueJob | null {
  const id = Number(attributes.get('job-id'));
  const created = Number(attributes.get('time-at-creation'));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(created)) {
    return null;
  }
  const flags = new Set<JobFlag>();
  const stateFlag = JOB_STATE_FLAGS.get(attributes.get('job-state') ?? '');
  if (stateFlag !== undefined) {
    flags.add(stateFlag);
  }
  for (const reason of keywords(attributes.get('job-state-reasons'))) {
    const flag = JOB_REASON_FLAGS.get(reason);
    if (flag !== undefined) {
      flags.add(flag);
    }
  }
  return {
    id,
    document: (attributes.get('job-name') ?? '').slice(0, DIAGNOSIS_LIMITS.textLength),
    user: (attributes.get('job-originating-user-name') ?? '').slice(0, DIAGNOSIS_LIMITS.textLength),
    submittedAtMs: created * MS_PER_SECOND,
    flags: [...flags],
  };
}

/** ipptool -tv 的 Get-Jobs 输出：任务一个接一个列出来，某个属性第二次出现就是下一个任务。null = ipptool 没跑成。 */
export function parseIppJobs(output: string | null, currentUser: string): QueueFacts {
  if (output === null) {
    return { kind: 'unknown', reason: 'ipptool Get-Jobs failed' };
  }
  const groups: Map<string, string>[] = [];
  let current: Map<string, string> | null = null;
  for (const line of lines(output)) {
    const match = IPP_ATTRIBUTE_LINE.exec(line);
    const name = match?.[1];
    const value = match?.[3];
    if (name === undefined || value === undefined || !JOB_ATTRIBUTES.has(name)) {
      continue;
    }
    if (current === null || current.has(name)) {
      current = new Map();
      groups.push(current);
    }
    current.set(name, value.trim());
  }
  const jobs = groups.flatMap((group) => {
    const job = readIppJob(group);
    return job === null ? [] : [job];
  });
  return { kind: 'listed', currentUser, total: jobs.length, jobs: jobs.slice(0, DIAGNOSIS_LIMITS.jobs) };
}
```

```ts
// src/main/diagnosis/command-runner.ts
import { spawn } from 'node:child_process';

/** 一次命令的结果。exitCode 为 null：没启动起来、被超时杀掉或输出超限。 */
export interface CommandRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs: number;
  /** stdout 和 stderr 加起来的上限：命令输出不可信，超过就杀掉、整个不要。 */
  maxOutputBytes: number;
}

/**
 * 跑一个系统命令：参数数组、不经过 shell；stdin 关掉、独立会话（detached）——CUPS 命令要密码时会去控制终端上问，
 * 开发版从终端启动时会一直等；没有终端就直接失败，我们据此换成管理员按钮。
 */
export function runCommand(
  file: string,
  args: readonly string[],
  { timeoutMs, maxOutputBytes }: RunOptions,
  env: NodeJS.ProcessEnv,
): Promise<CommandRun> {
  return new Promise((resolve) => {
    const child = spawn(file, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let isOverflow = false;
    let timedOut = false;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutputBytes) {
        isOverflow = true;
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: '', stderr: error.message, timedOut: false });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (isOverflow) {
        resolve({ exitCode: null, stdout: '', stderr: `output exceeded ${maxOutputBytes} bytes`, timedOut });
        return;
      }
      resolve({
        exitCode: timedOut ? null : code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
      });
    });
  });
}
```

`src/main/printing/driver-paper.ts`：把 `queryIppPaper` 拆成「取属性原文」和「解析纸张」，导出前者给诊断用：

```ts
/** CUPS 里这台打印机的全部属性（ipptool -tv 的输出原文）；查不到为 null。诊断和驱动纸张共用。 */
export function queryIppAttributes(printerName: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/ipptool',
      ['-tv', cupsPrinterUri(printerName), IPP_ATTRIBUTES_TEST],
      { timeout: IPP_PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
      (error, stdout) => {
        if (error) {
          console.warn(`[driver-paper] probe failed for "${printerName}": ${error.message}`);
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function queryIppPaper(printerName: string): Promise<DriverPaper | null> {
  const output = await queryIppAttributes(printerName);
  return output === null ? null : parseIppPaper(output);
}
```

（`IPP_PROBE_TIMEOUT_MS` 的注释顺带改成「ipptool 要连 CUPS 取全部属性，给足时间；诊断的 Get-Jobs 也用它」，并改为 `export`。）

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/diagnosis src/main/printing/driver-paper.test.ts`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/diagnosis/mac-commands.ts src/main/diagnosis/mac-commands.test.ts src/main/diagnosis/mac-facts.ts src/main/diagnosis/mac-facts.test.ts src/main/diagnosis/command-runner.ts src/main/diagnosis/command-runner.test.ts src/main/diagnosis/testing/fixtures/mac src/main/printing/driver-paper.ts
git commit -m "feat(diagnosis): macOS commands, parsers and a bounded command runner" -m "CUPS state reasons, the USB tree on both system_profiler layouts and Get-Jobs output become the same facts as on Windows. Commands run without a shell, in English, without a terminal so CUPS cannot block on a password, and with time and output limits. Admin actions go through osascript with the command and prompt passed as argv and every argument single-quoted." -m "$TRAILER"
```

---

### Task 9: 两个平台的实现

**Files:**
- Create: `src/main/diagnosis/diagnosis-system.ts`
- Create: `src/main/diagnosis/windows-diagnosis.ts`、`src/main/diagnosis/windows-diagnosis.test.ts`
- Create: `src/main/diagnosis/mac-diagnosis.ts`、`src/main/diagnosis/mac-diagnosis.test.ts`
- Create: `src/main/diagnosis/create-diagnosis-system.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/diagnosis/windows-diagnosis.test.ts
import { describe, expect, test } from 'bun:test';
import type { ProbeCommand } from '../printing/printer-probe-host';
import { ELEVATION_DECLINED_EXIT_CODE, type PowerShellRun } from '../windows-powershell';
import { fixture } from './testing/fixtures';
import { WindowsDiagnosis } from './windows-diagnosis';
import { SCRIPT_EXIT } from './windows-scripts';

const LABEL = { widthMm: 60, heightMm: 40 };
const run = (exitCode: number | null, stdout = ''): PowerShellRun => ({ exitCode, stdout, stderr: '', timedOut: false });

function harness(answers: Partial<Record<ProbeCommand, string | null>>, elevated: PowerShellRun = run(0)) {
  const queries: [ProbeCommand, string][] = [];
  const scripts: string[] = [];
  const elevatedScripts: string[] = [];
  const system = new WindowsDiagnosis({
    query: async (command, name) => {
      queries.push([command, name]);
      return answers[command] ?? null;
    },
    runScript: async (script) => {
      scripts.push(script);
      return run(0, '2\r\n');
    },
    runElevated: async (script) => {
      elevatedScripts.push(script);
      return elevated;
    },
    openQueueWindow: async () => {},
  });
  return { system, queries, scripts, elevatedScripts };
}

describe('WindowsDiagnosis', () => {
  test('asks the resident probe and parses the answer', async () => {
    const { system, queries } = harness({ jobs: fixture('windows', 'jobs-stuck.txt') });
    expect(await system.jobs('标签机A')).toMatchObject({ kind: 'listed', total: 3 });
    expect(queries).toEqual([['jobs', '标签机A']]);
  });

  test('cancels our jobs without admin rights and reports how many', async () => {
    const { system, scripts, elevatedScripts } = harness({});
    expect(await system.cancelJobs('标签机A', [11, 12])).toEqual({ kind: 'done', count: 2 });
    expect(scripts).toHaveLength(1);
    expect(elevatedScripts).toHaveLength(0);
  });

  test('maps the exit codes of admin scripts', async () => {
    expect(await harness({}, run(ELEVATION_DECLINED_EXIT_CODE)).system.restartSpooler()).toEqual({ kind: 'declined' });
    expect(await harness({}, run(SCRIPT_EXIT.failed)).system.cancelAllJobs('标签机A')).toMatchObject({ kind: 'failed' });
    expect(
      await harness({ 'paper-options': fixture('windows', 'paper-options.txt') }, run(SCRIPT_EXIT.rolledBack)).system.setDriverPaper(
        '标签机A',
        LABEL,
        true,
      ),
    ).toEqual({ kind: 'rolled-back' });
  });

  // 驱动里没有这种纸、也不能自定义：不弹管理员确认就说明，弹了也做不成。
  test('does not ask for admin rights when the driver has no matching paper', async () => {
    const { system, elevatedScripts } = harness({
      'paper-options': '{"options":[{"namespace":"urn:x","localName":"A4","width":210000,"height":297000}],"custom":false}',
    });
    expect(await system.setDriverPaper('标签机A', LABEL, true)).toEqual({ kind: 'no-matching-paper' });
    expect(elevatedScripts).toEqual([]);
  });
});
```

```ts
// src/main/diagnosis/mac-diagnosis.test.ts
import { describe, expect, test } from 'bun:test';
import type { CommandRun, RunOptions } from './command-runner';
import { MacDiagnosis } from './mac-diagnosis';
import { MAC_TOOLS } from './mac-commands';
import { fixture } from './testing/fixtures';

const ok = (stdout = ''): CommandRun => ({ exitCode: 0, stdout, stderr: '', timedOut: false });
const fail = (stderr: string): CommandRun => ({ exitCode: 1, stdout: '', stderr, timedOut: false });
const LABEL = { widthMm: 60, heightMm: 40 };

function harness(answer: (file: string, args: readonly string[]) => CommandRun, attributes: (string | null)[] = []) {
  const calls: [string, readonly string[]][] = [];
  const system = new MacDiagnosis({
    run: async (file: string, args: readonly string[], _options: RunOptions) => {
      calls.push([file, args]);
      return answer(file, args);
    },
    ippAttributes: async () => attributes.shift() ?? null,
    currentUser: 'shop',
    withJobsTest: (use) => use('/tmp/labelflash-ipp-test/labelflash-get-jobs.test'),
  });
  return { system, calls };
}

describe('MacDiagnosis', () => {
  test('reports a stopped scheduler without asking about the printer', async () => {
    const { system } = harness(() => ok(fixture('mac', 'lpstat-r-stopped.txt')));
    expect(await system.spooler('Label_Printer')).toEqual({ kind: 'mac', schedulerRunning: false, queue: null });
  });

  test('reads whether the printer is paused from its CUPS attributes', async () => {
    const { system } = harness(() => ok(fixture('mac', 'lpstat-r-running.txt')), [fixture('mac', 'ipp-printer-stopped.txt')]);
    expect(await system.spooler('Label_Printer')).toEqual({
      kind: 'mac',
      schedulerRunning: true,
      queue: { enabled: false, acceptingJobs: true },
    });
  });

  test('turns a refused CUPS request into needs-admin and runs the admin version through osascript', async () => {
    const refused = harness(() => fail('cupsenable: Forbidden'));
    expect(await refused.system.enablePrinter('Label_Printer', false)).toEqual({ kind: 'needs-admin' });
    const admin = harness(() => ok());
    expect(await admin.system.enablePrinter('Label_Printer', true)).toEqual({ kind: 'done' });
    expect(admin.calls[0]?.[0]).toBe(MAC_TOOLS.osascript);
    expect(admin.calls[0]?.[1].at(-2)).toBe(
      "'/usr/sbin/cupsenable' 'Label_Printer' && '/usr/sbin/cupsaccept' 'Label_Printer'",
    );
  });

  test('reports a canceled password prompt as declined', async () => {
    const { system } = harness(() => fail('execution error: User canceled. (-128)'));
    expect(await system.cancelAllJobs('Label_Printer')).toEqual({ kind: 'declined' });
  });

  test('sets the default media, and restores the old one when the read-back is wrong', async () => {
    const stopped = fixture('mac', 'ipp-printer-stopped.txt');
    const good = harness(() => ok(), [stopped, fixture('mac', 'ipp-printer-idle.txt')]);
    expect(await good.system.setDriverPaper('Label_Printer', LABEL, false)).toEqual({ kind: 'done' });
    expect(good.calls[0]).toEqual([MAC_TOOLS.lpadmin, ['-p', 'Label_Printer', '-o', 'media-default=om_60x40mm_60x40mm']]);

    const ignored = harness(() => ok(), [stopped, stopped]);
    expect(await ignored.system.setDriverPaper('Label_Printer', LABEL, false)).toEqual({ kind: 'rolled-back' });
    expect(ignored.calls[1]).toEqual([MAC_TOOLS.lpadmin, ['-p', 'Label_Printer', '-o', 'media-default=oe_4x6-label_4x6in']]);
  });

  test('reads the queue through the temporary Get-Jobs test', async () => {
    const { system, calls } = harness(() => ok(fixture('mac', 'ipp-jobs.txt')));
    expect(await system.jobs('Label_Printer')).toMatchObject({ kind: 'listed', total: 2 });
    expect(calls[0]).toEqual([
      MAC_TOOLS.ipptool,
      ['-tv', 'ipp://localhost/printers/Label_Printer', '/tmp/labelflash-ipp-test/labelflash-get-jobs.test'],
    ]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/diagnosis/windows-diagnosis.test.ts src/main/diagnosis/mac-diagnosis.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/diagnosis/diagnosis-system.ts
import type {
  ActionResult,
  DiagnosisPlatform,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import type { PaperSize } from '../../shared/paper-sizes';

/**
 * 诊断要问系统的事和能做的修复；Windows、macOS、假打印机各一份实现。
 * 打印机名在交进来之前已经由 DiagnosisStation 核对过在系统列表里。
 */
export interface DiagnosisSystem {
  readonly platform: DiagnosisPlatform;
  /** printerName 为 null 时只看服务本身（macOS 不看这台打印机在 CUPS 里的状态）。 */
  spooler(printerName: string | null): Promise<SpoolerFacts>;
  printer(printerName: string): Promise<PrinterFacts>;
  usb(printerName: string): Promise<UsbFacts>;
  jobs(printerName: string): Promise<QueueFacts>;
  restartSpooler(): Promise<ActionResult>;
  /** macOS：启用 + 接收任务；admin 为 false 时以当前用户做，被拒返回 needs-admin。 */
  enablePrinter(printerName: string, admin: boolean): Promise<ActionResult>;
  /** Windows：打开系统的打印队列窗口，关掉后才完成。 */
  openQueue(printerName: string): Promise<ActionResult>;
  cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult>;
  cancelAllJobs(printerName: string): Promise<ActionResult>;
  setDriverPaper(printerName: string, target: PaperSize, admin: boolean): Promise<ActionResult>;
}

export function diagnosisPlatformOf(platform: NodeJS.Platform): DiagnosisPlatform {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'mac';
    default:
      return 'other';
  }
}

const UNSUPPORTED: ActionResult = { kind: 'failed', detail: '这个系统不支持' };
const UNKNOWN = { kind: 'unknown', reason: 'diagnosis is not supported on this platform' } as const;

/** 其他系统：每项都查不到；修复按管理员策略本来就不会给按钮，这里只兜底。 */
export class UnsupportedDiagnosis implements DiagnosisSystem {
  readonly platform = 'other' as const;
  async spooler(): Promise<SpoolerFacts> {
    return UNKNOWN;
  }
  async printer(): Promise<PrinterFacts> {
    return UNKNOWN;
  }
  async usb(): Promise<UsbFacts> {
    return UNKNOWN;
  }
  async jobs(): Promise<QueueFacts> {
    return UNKNOWN;
  }
  async restartSpooler(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async enablePrinter(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async openQueue(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async cancelJobs(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async cancelAllJobs(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async setDriverPaper(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
}
```

```ts
// src/main/diagnosis/windows-diagnosis.ts
import type {
  ActionResult,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import { choosePrintTicketPaper } from '../../core/diagnosis/paper-choice';
import type { PaperSize } from '../../shared/paper-sizes';
import type { ProbeCommand } from '../printing/printer-probe-host';
import { ELEVATION_DECLINED_EXIT_CODE, type PowerShellRun } from '../windows-powershell';
import type { DiagnosisSystem } from './diagnosis-system';
import {
  parseJobsReply,
  parsePaperOptionsReply,
  parsePrinterReply,
  parseSpoolerReply,
  parseUsbReply,
} from './windows-facts';
import {
  cancelJobsScript,
  purgeQueueScript,
  restartSpoolerScript,
  SCRIPT_EXIT,
  setDriverPaperScript,
} from './windows-scripts';

/** 等操作员在管理员确认框里点选，再加上脚本本身（服务停、启各最多 30 秒）：和防火墙一样给 2 分钟。 */
const ELEVATED_TIMEOUT_MS = 120_000;
/** 一次性 PowerShell：冷启动一两秒，加载 System.Printing 再一两秒。 */
const SCRIPT_TIMEOUT_MS = 15_000;

export interface WindowsDiagnosisDeps {
  /** 常驻探测进程（PrinterProbeHost.query）；查询失败为 null。 */
  query(command: ProbeCommand, printerName: string): Promise<string | null>;
  runScript(script: string, timeoutMs: number): Promise<PowerShellRun>;
  runElevated(script: string, timeoutMs: number): Promise<PowerShellRun>;
  openQueueWindow(printerName: string): Promise<void>;
}

function describeRun(run: PowerShellRun): string {
  return run.timedOut ? '系统命令超时了' : `系统命令出错（退出码 ${run.exitCode ?? '无'}，详情在日志里）`;
}

/** 管理员脚本的退出码 → 结果（提权后的窗口是隐藏的，只有退出码能带回来）。 */
export function elevatedResult(run: PowerShellRun): ActionResult {
  if (run.timedOut) {
    return { kind: 'failed', detail: '等管理员确认超时了' };
  }
  switch (run.exitCode) {
    case SCRIPT_EXIT.done:
      return { kind: 'done' };
    case ELEVATION_DECLINED_EXIT_CODE:
      return { kind: 'declined' };
    case SCRIPT_EXIT.driverRefused:
      return { kind: 'failed', detail: '驱动不接受这个尺寸，什么都没改' };
    case SCRIPT_EXIT.rolledBack:
      return { kind: 'rolled-back' };
    default:
      return { kind: 'failed', detail: describeRun(run) };
  }
}

/** Windows：查询经常驻探测进程，动作经一次性或管理员 PowerShell。 */
export class WindowsDiagnosis implements DiagnosisSystem {
  readonly platform = 'windows' as const;

  constructor(private readonly deps: WindowsDiagnosisDeps) {}

  async spooler(): Promise<SpoolerFacts> {
    return parseSpoolerReply(await this.deps.query('spooler', ''));
  }

  async printer(printerName: string): Promise<PrinterFacts> {
    return parsePrinterReply(await this.deps.query('printer', printerName));
  }

  async usb(printerName: string): Promise<UsbFacts> {
    return parseUsbReply(await this.deps.query('usb', printerName));
  }

  async jobs(printerName: string): Promise<QueueFacts> {
    return parseJobsReply(await this.deps.query('jobs', printerName));
  }

  async restartSpooler(): Promise<ActionResult> {
    return elevatedResult(await this.deps.runElevated(restartSpoolerScript(), ELEVATED_TIMEOUT_MS));
  }

  async enablePrinter(): Promise<ActionResult> {
    // 管理员策略里 Windows 没有这个修复（暂停的打印机经「打开打印队列」恢复）：走到这里是程序错误。
    throw new Error('enable-printer is a macOS fix');
  }

  async openQueue(printerName: string): Promise<ActionResult> {
    await this.deps.openQueueWindow(printerName);
    return { kind: 'done' };
  }

  async cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult> {
    const run = await this.deps.runScript(cancelJobsScript(printerName, ids), SCRIPT_TIMEOUT_MS);
    const count = Number(run.stdout.trim());
    if (run.exitCode !== SCRIPT_EXIT.done || !Number.isSafeInteger(count)) {
      return { kind: 'failed', detail: describeRun(run) };
    }
    return { kind: 'done', count };
  }

  async cancelAllJobs(printerName: string): Promise<ActionResult> {
    return elevatedResult(await this.deps.runElevated(purgeQueueScript(printerName), ELEVATED_TIMEOUT_MS));
  }

  /** 先不提权读驱动支持的纸张、挑好，挑不出来就不弹管理员确认。 */
  async setDriverPaper(printerName: string, target: PaperSize): Promise<ActionResult> {
    const options = parsePaperOptionsReply(await this.deps.query('paper-options', printerName));
    if (options === null) {
      return { kind: 'failed', detail: '读不到驱动支持的纸张' };
    }
    const paper = choosePrintTicketPaper(options, target);
    if (paper === null) {
      return { kind: 'no-matching-paper' };
    }
    return elevatedResult(
      await this.deps.runElevated(setDriverPaperScript(printerName, paper, target), ELEVATED_TIMEOUT_MS),
    );
  }
}
```

```ts
// src/main/diagnosis/mac-diagnosis.ts
import type {
  ActionResult,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import { chooseCupsMedia, CUPS_MEDIA_KEYWORD_PATTERN } from '../../core/diagnosis/paper-choice';
import { isSamePaper, type PaperSize } from '../../shared/paper-sizes';
import { cupsPrinterUri, IPP_PROBE_TIMEOUT_MS, parseIppPaper } from '../printing/driver-paper';
import type { CommandRun, RunOptions } from './command-runner';
import type { DiagnosisSystem } from './diagnosis-system';
import {
  adminOsascriptArgs,
  adminPrompt,
  assertQueueName,
  CUPS_FORBIDDEN_PATTERN,
  cancelAllJobsCommand,
  enablePrinterCommand,
  MAC_TOOLS,
  restartCupsCommand,
  setMediaArgs,
  shellCommand,
  USER_CANCELED_PATTERN,
} from './mac-commands';
import {
  macUsbFacts,
  parseDeviceUri,
  parseIppJobs,
  parseIppPrinterState,
  parseSchedulerStatus,
  parseSystemProfilerUsb,
  readinessFromReasons,
} from './mac-facts';

/** lpstat、cancel、cupsenable 这类本机命令：连的是本机的 CUPS，几百毫秒内回答。 */
const QUERY: RunOptions = { timeoutMs: 5_000, maxOutputBytes: 256 * 1024 };
/** 改设置的命令（lpadmin 要改 PPD 并通知 cupsd）：多给一点时间。 */
const ACTION: RunOptions = { timeoutMs: 15_000, maxOutputBytes: 256 * 1024 };
/** system_profiler 要枚举整棵 USB 树，慢的机器上要几秒；JSON 有几十 KB。 */
const PROFILER: RunOptions = { timeoutMs: 20_000, maxOutputBytes: 4 * 1024 * 1024 };
/** Get-Jobs：和读打印机属性的 ipptool 同样的超时。 */
const JOBS: RunOptions = { timeoutMs: IPP_PROBE_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 };
/** 等操作员输入管理员密码：和 Windows 的管理员确认一样给 2 分钟。 */
const ADMIN: RunOptions = { timeoutMs: 120_000, maxOutputBytes: 64 * 1024 };

export interface MacDiagnosisDeps {
  run(file: string, args: readonly string[], options: RunOptions): Promise<CommandRun>;
  /** driver-paper.ts 的 queryIppAttributes。 */
  ippAttributes(printerName: string): Promise<string | null>;
  currentUser: string;
  /** 把 CUPS_GET_JOBS_TEST 写进一个临时文件，用完删掉。 */
  withJobsTest<T>(use: (path: string) => Promise<T>): Promise<T>;
}

function describeRun(run: CommandRun): string {
  return run.timedOut ? '系统命令超时了' : `系统命令出错（退出码 ${run.exitCode ?? '无'}，详情在日志里）`;
}

/** macOS：CUPS 命令行；改 CUPS 的动作先以当前用户做，被拒再由操作员点管理员按钮经 osascript 做。 */
export class MacDiagnosis implements DiagnosisSystem {
  readonly platform = 'mac' as const;

  constructor(private readonly deps: MacDiagnosisDeps) {}

  async spooler(printerName: string | null): Promise<SpoolerFacts> {
    const lpstat = await this.deps.run(MAC_TOOLS.lpstat, ['-r'], QUERY);
    const isRunning = parseSchedulerStatus(lpstat.timedOut ? null : lpstat.stdout);
    if (isRunning === null) {
      return { kind: 'unknown', reason: `lpstat -r: ${lpstat.stdout.slice(0, 80)} ${lpstat.stderr.slice(0, 80)}` };
    }
    if (!isRunning || printerName === null) {
      return { kind: 'mac', schedulerRunning: isRunning, queue: null };
    }
    const attributes = await this.deps.ippAttributes(printerName);
    const state = attributes === null ? null : parseIppPrinterState(attributes);
    const queue =
      state === null || state.state === null || state.acceptingJobs === null
        ? null
        : { enabled: state.state !== 'stopped', acceptingJobs: state.acceptingJobs };
    return { kind: 'mac', schedulerRunning: true, queue };
  }

  async printer(printerName: string): Promise<PrinterFacts> {
    const attributes = await this.deps.ippAttributes(printerName);
    if (attributes === null) {
      return { kind: 'unknown', reason: 'ipptool get-printer-attributes failed' };
    }
    const state = parseIppPrinterState(attributes);
    // paused 在后台打印服务一项说（cupsenable 恢复），这里不重复。
    return {
      kind: 'known',
      readiness: readinessFromReasons(state.reasons),
      paused: false,
      driverName: state.makeAndModel,
    };
  }

  async usb(printerName: string): Promise<UsbFacts> {
    assertQueueName(printerName);
    const lpstat = await this.deps.run(MAC_TOOLS.lpstat, ['-v', printerName], QUERY);
    const uri = parseDeviceUri(lpstat.exitCode === 0 ? lpstat.stdout : null);
    if (uri === null || !uri.startsWith('usb:')) {
      return macUsbFacts(uri, []);
    }
    const profiler = await this.deps.run(
      MAC_TOOLS.systemProfiler,
      ['-json', 'SPUSBDataType', 'SPUSBHostDataType'],
      PROFILER,
    );
    return macUsbFacts(uri, parseSystemProfilerUsb(profiler.exitCode === 0 ? profiler.stdout : null));
  }

  async jobs(printerName: string): Promise<QueueFacts> {
    const run = await this.deps.withJobsTest((path) =>
      this.deps.run(MAC_TOOLS.ipptool, ['-tv', cupsPrinterUri(printerName), path], JOBS),
    );
    return parseIppJobs(run.exitCode === 0 ? run.stdout : null, this.deps.currentUser);
  }

  async restartSpooler(): Promise<ActionResult> {
    return this.asAdmin(restartCupsCommand(), adminPrompt('重启打印系统（CUPS）'));
  }

  async enablePrinter(printerName: string, admin: boolean): Promise<ActionResult> {
    if (admin) {
      return this.asAdmin(enablePrinterCommand(printerName), adminPrompt(`恢复打印机「${printerName}」`));
    }
    assertQueueName(printerName);
    const enabled = await this.asUser(MAC_TOOLS.cupsenable, [printerName]);
    return enabled.kind === 'done' ? this.asUser(MAC_TOOLS.cupsaccept, [printerName]) : enabled;
  }

  async openQueue(): Promise<ActionResult> {
    // 管理员策略里 macOS 没有这个修复：走到这里是程序错误。
    throw new Error('open-queue is a Windows fix');
  }

  async cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult> {
    assertQueueName(printerName);
    let count = 0;
    for (const id of ids) {
      const run = await this.deps.run(MAC_TOOLS.cancel, [String(id)], QUERY);
      if (run.exitCode === 0) {
        count += 1;
      } else {
        // 任务刚好打完了不算错：写日志，接着取消下一个。
        console.warn(`[diagnosis] cancel ${id} on ${printerName}: ${run.stderr.trim()}`);
      }
    }
    return { kind: 'done', count };
  }

  async cancelAllJobs(printerName: string): Promise<ActionResult> {
    return this.asAdmin(cancelAllJobsCommand(printerName), adminPrompt(`清空打印机「${printerName}」的队列`));
  }

  /** 挑纸张名 → 设默认 → 回读；回读不对就设回原来的（同样的权限方式）。 */
  async setDriverPaper(printerName: string, target: PaperSize, admin: boolean): Promise<ActionResult> {
    const before = await this.deps.ippAttributes(printerName);
    if (before === null) {
      return { kind: 'failed', detail: '读不到打印机的纸张设置' };
    }
    const state = parseIppPrinterState(before);
    const keyword = chooseCupsMedia(state.mediaSupported, target);
    if (keyword === null) {
      return { kind: 'no-matching-paper' };
    }
    const applied = await this.cups(setMediaArgs(printerName, keyword), admin, `把打印机「${printerName}」的默认纸张设为 ${keyword}`);
    if (applied.kind !== 'done') {
      return applied;
    }
    const after = await this.deps.ippAttributes(printerName);
    const paper = after === null ? null : parseIppPaper(after);
    if (paper !== null && isSamePaper(paper, target)) {
      return { kind: 'done' };
    }
    const previous = state.mediaDefault;
    if (previous === null || !CUPS_MEDIA_KEYWORD_PATTERN.test(previous)) {
      return { kind: 'failed', detail: '设置之后回读的纸张不对，原来的设置读不到，没法恢复：打开打印首选项手动改' };
    }
    const restored = await this.cups(setMediaArgs(printerName, previous), admin, `把打印机「${printerName}」的默认纸张恢复成 ${previous}`);
    return restored.kind === 'done'
      ? { kind: 'rolled-back' }
      : { kind: 'failed', detail: '设置之后回读的纸张不对，恢复原来的设置也没成：打开打印首选项手动改' };
  }

  private cups(args: readonly string[], admin: boolean, action: string): Promise<ActionResult> {
    return admin
      ? this.asAdmin(shellCommand(MAC_TOOLS.lpadmin, args), adminPrompt(action))
      : this.asUser(MAC_TOOLS.lpadmin, args);
  }

  private async asUser(file: string, args: readonly string[]): Promise<ActionResult> {
    const run = await this.deps.run(file, args, ACTION);
    if (run.exitCode === 0) {
      return { kind: 'done' };
    }
    if (CUPS_FORBIDDEN_PATTERN.test(run.stderr)) {
      return { kind: 'needs-admin' };
    }
    console.warn(`[diagnosis] ${file} ${args.join(' ')} failed: ${run.stderr.trim()}`);
    return { kind: 'failed', detail: describeRun(run) };
  }

  private async asAdmin(command: string, prompt: string): Promise<ActionResult> {
    const run = await this.deps.run(MAC_TOOLS.osascript, adminOsascriptArgs(command, prompt), ADMIN);
    if (run.exitCode === 0) {
      return { kind: 'done' };
    }
    if (USER_CANCELED_PATTERN.test(run.stderr)) {
      return { kind: 'declined' };
    }
    console.warn(`[diagnosis] admin command failed: ${run.stderr.trim()}`);
    return { kind: 'failed', detail: describeRun(run) };
  }
}
```

```ts
// src/main/diagnosis/create-diagnosis-system.ts
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { queryIppAttributes } from '../printing/driver-paper';
import type { PrinterProbeHost } from '../printing/printer-probe-host';
import { runElevatedPowerShellScript, runPowerShellScript } from '../windows-powershell';
import { runCommand } from './command-runner';
import { type DiagnosisSystem, UnsupportedDiagnosis } from './diagnosis-system';
import { MacDiagnosis } from './mac-diagnosis';
import { CUPS_GET_JOBS_TEST, JOBS_TEST_FILE_NAME, MAC_COMMAND_ENV } from './mac-commands';
import { WindowsDiagnosis } from './windows-diagnosis';

const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

/** 按平台接上真实的进程和文件。Windows 必须有常驻探测进程（假打印机模式下没有，那时用 FakeDiagnosis）。 */
export function createDiagnosisSystem(platform: NodeJS.Platform, probeHost: PrinterProbeHost | null): DiagnosisSystem {
  if (platform === 'win32' && probeHost !== null) {
    return new WindowsDiagnosis({
      query: (command, name) => probeHost.query(command, name),
      runScript: runPowerShellScript,
      runElevated: runElevatedPowerShellScript,
      openQueueWindow,
    });
  }
  if (platform === 'darwin') {
    const env = { ...process.env, ...MAC_COMMAND_ENV };
    return new MacDiagnosis({
      run: (file, args, options) => runCommand(file, args, options, env),
      ippAttributes: queryIppAttributes,
      currentUser: userInfo().username,
      withJobsTest,
    });
  }
  return new UnsupportedDiagnosis();
}

/** Get-Jobs 的测试文件写进新建的临时目录，用完连目录一起删（只删我们自己刚建的目录）。 */
async function withJobsTest<T>(use: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'labelflash-ipp-'));
  try {
    const path = join(dir, JOBS_TEST_FILE_NAME);
    await writeFile(path, CUPS_GET_JOBS_TEST, 'utf8');
    return await use(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 系统的打印队列窗口（printui /o）；窗口关掉后完成，界面随后重查队列。参数按数组传入，不经过 shell。 */
function openQueueWindow(printerName: string): Promise<void> {
  const rundll32 = join(process.env['SystemRoot'] ?? DEFAULT_SYSTEM_ROOT, 'System32', 'rundll32.exe');
  return new Promise((resolve, reject) => {
    execFile(rundll32, ['printui.dll,PrintUIEntry', '/o', '/n', printerName], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/diagnosis`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/diagnosis/diagnosis-system.ts src/main/diagnosis/windows-diagnosis.ts src/main/diagnosis/windows-diagnosis.test.ts src/main/diagnosis/mac-diagnosis.ts src/main/diagnosis/mac-diagnosis.test.ts src/main/diagnosis/create-diagnosis-system.ts
git commit -m "feat(diagnosis): Windows and macOS implementations behind one interface" -m "Both platforms answer the same questions and offer the same kinds of fixes. Admin prompts appear only for actions that need them; on macOS CUPS changes are tried as the current user first. A missing paper size is reported before any prompt, and a wrong read-back restores the previous setting." -m "$TRAILER"
```

---

### Task 10: 假打印机的诊断

E2E 和视觉验收没有真打印机：`FakePrinterSpec` 加一段 `diagnosis`，`FakeDiagnosis` 按它回答、按修复改状态（取消任务真的从假队列里删、设纸张真的改掉假驱动纸张），并记下弹过几次「管理员确认」。按当前系统说话（Windows 上是 Spooler，macOS 上是 CUPS），两个平台的 CI 都能跑同一套 E2E。

**Files:**
- Modify: `src/main/printing/fake-printers.ts`、`src/main/printing/fake-printers.test.ts`
- Create: `src/main/diagnosis/fake-diagnosis.ts`、`src/main/diagnosis/fake-diagnosis.test.ts`
- Create: `src/main/diagnosis/seams.ts`

- [ ] **Step 1: 写测试**

`fake-printers.test.ts` 的 `describe('FakePrinters')` 里加：

```ts
  // 诊断的「自动设置驱动纸张」改的是假驱动纸张：之后读到的是新纸张。
  test('lets the driver paper be changed', async () => {
    const printers = new FakePrinters(SPEC);
    printers.setDriverPaper('面单机B', { widthMm: 60, heightMm: 40, dpi: 203 });
    expect(await printers.driverPaper('面单机B')).toEqual({ widthMm: 60, heightMm: 40, dpi: 203 });
    expect(await printers.driverPaper('标签机A')).toEqual({ widthMm: 60, heightMm: 40, dpi: 203 });
  });
```

```ts
// src/main/diagnosis/fake-diagnosis.test.ts
import { describe, expect, test } from 'bun:test';
import { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import { FakeClock } from '../../core/testing/fake-clock';
import { type FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import { FAKE_CURRENT_USER, FakeDiagnosis, FakeLabelCommands } from './fake-diagnosis';

const LABEL = { widthMm: 60, heightMm: 40 };

function setup(spec: Partial<FakePrinterSpec> = {}, platform: 'windows' | 'mac' = 'windows') {
  const clock = new FakeClock();
  const specs: FakePrinterSpec[] = [
    { name: '标签机A', paper: { widthMm: 100, heightMm: 150, dpi: 203 }, readiness: { ready: true }, ...spec },
  ];
  const printers = new FakePrinters(specs);
  const submitted = new SubmittedJobs(clock);
  return { diagnosis: new FakeDiagnosis(platform, specs, printers, submitted, clock), printers, submitted };
}

describe('FakeDiagnosis', () => {
  test('puts stuck jobs in the queue, ours recorded in the ledger', async () => {
    const { diagnosis, submitted } = setup({ diagnosis: { stuckJobs: { ours: 2, others: 1 } } });
    const facts = await diagnosis.jobs('标签机A');
    expect(facts).toMatchObject({ kind: 'listed', currentUser: FAKE_CURRENT_USER, total: 3 });
    expect(submitted.windowsFor('标签机A')).toHaveLength(1);
  });

  test('cancels the jobs it is asked to and clears the rest after an admin prompt', async () => {
    const { diagnosis } = setup({ diagnosis: { stuckJobs: { ours: 1, others: 1 } } });
    expect(await diagnosis.cancelJobs('标签机A', [1])).toEqual({ kind: 'done', count: 1 });
    expect(await diagnosis.jobs('标签机A')).toMatchObject({ total: 1 });
    expect(await diagnosis.cancelAllJobs('标签机A')).toEqual({ kind: 'done' });
    expect(await diagnosis.jobs('标签机A')).toMatchObject({ total: 0 });
    expect(diagnosis.adminPrompts).toHaveLength(1);
  });

  test('a declined prompt changes nothing', async () => {
    const { diagnosis } = setup({ diagnosis: { stuckJobs: { ours: 0, others: 1 }, adminPrompt: 'decline' } });
    expect(await diagnosis.cancelAllJobs('标签机A')).toEqual({ kind: 'declined' });
    expect(await diagnosis.jobs('标签机A')).toMatchObject({ total: 1 });
  });

  test('sets the fake driver paper, behind an admin prompt on Windows only', async () => {
    const windows = setup();
    expect(await windows.diagnosis.setDriverPaper('标签机A', LABEL, true)).toEqual({ kind: 'done' });
    expect(await windows.printers.driverPaper('标签机A')).toEqual({ ...LABEL, dpi: 203 });
    expect(windows.diagnosis.adminPrompts).toHaveLength(1);
    const mac = setup({}, 'mac');
    expect(await mac.diagnosis.setDriverPaper('标签机A', LABEL, false)).toEqual({ kind: 'done' });
    expect(mac.diagnosis.adminPrompts).toHaveLength(0);
    expect(await setup({ diagnosis: { paperSettable: false } }).diagnosis.setDriverPaper('标签机A', LABEL, true)).toEqual({
      kind: 'no-matching-paper',
    });
  });

  test('speaks the platform: a stopped print service is the Spooler or a paused CUPS queue', async () => {
    expect(await setup({ diagnosis: { spooler: 'stopped' } }).diagnosis.spooler('标签机A')).toEqual({
      kind: 'windows',
      state: 'stopped',
      startType: 'automatic',
    });
    expect(await setup({ diagnosis: { spooler: 'stopped' } }, 'mac').diagnosis.spooler('标签机A')).toEqual({
      kind: 'mac',
      schedulerRunning: true,
      queue: { enabled: false, acceptingJobs: true },
    });
  });
});

describe('FakeLabelCommands', () => {
  test('reports the configured command set and records what was sent', async () => {
    const commands = new FakeLabelCommands([
      { name: '标签机A', paper: null, readiness: null, diagnosis: { commandSet: 'zpl' } },
      { name: '家用打印机', paper: null, readiness: null },
    ]);
    expect(await commands.effectiveCommandSet('标签机A')).toBe('zpl');
    expect(await commands.effectiveCommandSet('家用打印机')).toBe('tspl');
    expect(await commands.send('标签机A', 'feed')).toEqual({ kind: 'done' });
    expect(commands.sent).toEqual([{ printerName: '标签机A', action: 'feed' }]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/fake-printers.test.ts src/main/diagnosis/fake-diagnosis.test.ts`
Expected: FAIL，`setDriverPaper` 不存在、`Cannot find module './fake-diagnosis'`。

- [ ] **Step 3: 接缝**

```ts
// src/main/diagnosis/seams.ts
import type { ActionResult, CommandSetName } from '../../core/diagnosis/diagnosis-model';

/**
 * 5a（标签机指令）给诊断用的能力。只在 index.ts 里接到 5a 的实现；5a 的名字变了只改那几行。
 * 指令是单向的（设计 7.1）：send 的 done 只说明指令进了打印队列。
 */
export interface LabelCommandsSeam {
  /** 这台打印机实际用的指令集（自动识别的结果或操作员选的）；none = 选了「不发指令」或认不出来。 */
  effectiveCommandSet(printerName: string): Promise<CommandSetName | 'none'>;
  send(printerName: string, action: 'feed' | 'calibrate'): Promise<ActionResult>;
}

/** 5c（驱动安装）给诊断用的能力；5c 合并之前在 index.ts 里是 null，「重新安装驱动」不出现。 */
export interface DriverReinstallSeam {
  /** 在线清单里有这台的型号、能下载核对后静默安装。 */
  canReinstall(printerName: string): Promise<boolean>;
  /** 弹一次管理员确认后重装；结果和其他修复一样用 ActionResult 说。 */
  reinstall(printerName: string): Promise<ActionResult>;
}
```

- [ ] **Step 4: 假打印机**

`fake-printers.ts`：

1. import 加 `import type { CommandSetName } from '../../core/diagnosis/diagnosis-model';`。
2. `FakePrinterSpec` 之前加：

```ts
/** 假打印机在诊断里的样子（都可以不填，不填就是「一切正常」）。 */
export interface FakeDiagnosisSpec {
  /** 后台打印服务：Windows 上是 Spooler 停了；macOS 上是这台在 CUPS 里被暂停了。任何一台写 stopped 都算。 */
  spooler?: 'running' | 'stopped';
  usb?: 'present' | 'disconnected' | 'not-found' | 'not-usb';
  /** 队列里卡住的任务：本程序的（记进账本）和别人的。 */
  stuckJobs?: { ours: number; others: number };
  /** false：驱动里没有这种纸，也不能自定义。 */
  paperSettable?: boolean;
  /** 假的管理员确认框：allow 点了「是」，decline 点了「否」。 */
  adminPrompt?: 'allow' | 'decline';
  /** 5a 的指令集；不填是 tspl。 */
  commandSet?: CommandSetName | 'none';
}
```

3. `FakePrinterSpec` 里加：

```ts
  /** 诊断用（见 FakeDiagnosisSpec）。 */
  diagnosis?: FakeDiagnosisSpec;
```

4. `FakePrinters` 里加一个字段和一个方法，`driverPaper` 先看改写过的：

```ts
  /** 诊断「自动设置驱动纸张」改过的驱动纸张。 */
  private readonly paperOverrides = new Map<string, DriverPaper>();

  async driverPaper(name: string): Promise<DriverPaper | null> {
    return this.paperOverrides.get(name) ?? this.find(name)?.paper ?? null;
  }

  setDriverPaper(name: string, paper: DriverPaper): void {
    this.paperOverrides.set(name, paper);
  }
```

```ts
// src/main/diagnosis/fake-diagnosis.ts
import type {
  ActionResult,
  CommandSetName,
  DiagnosisPlatform,
  PrinterFacts,
  QueueFacts,
  QueueJob,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import type { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import type { Clock } from '../../core/types';
import type { PaperSize } from '../../shared/paper-sizes';
import type { FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import type { DiagnosisSystem } from './diagnosis-system';
import type { LabelCommandsSeam } from './seams';

/** 假队列里的任务提交于多久以前：远超卡住的门槛（1 分钟），断言和截图里的「等了 5 分钟」稳定。 */
const FAKE_JOB_AGE_MS = 5 * 60_000;
/** 假的当前用户和「别人」。 */
export const FAKE_CURRENT_USER = 'operator';
const FAKE_OTHER_USER = 'someone-else';
const DEFAULT_COMMAND_SET: CommandSetName = 'tspl';
/** 不是 USB 的假端口名（网络打印机的 WSD 端口长这样）。 */
const FAKE_NETWORK_PORT = 'WSD-1';
const FAKE_USB_PORT = 'USB001';

/**
 * 仅开发 / E2E：按 FakePrinterSpec.diagnosis 回答诊断，按修复改状态，不碰真的系统。
 * 「管理员确认」只记下来（adminPrompts），按 adminPrompt 决定点了「是」还是「否」。
 */
export class FakeDiagnosis implements DiagnosisSystem {
  /** 弹过的管理员确认（要做的事）：E2E 核对只在点了管理员按钮时才弹。 */
  readonly adminPrompts: string[] = [];
  /** 自动设置驱动纸张、打开打印首选项这类「打开系统窗口」的动作也只记下来。 */
  readonly openedWindows: string[] = [];
  private isSpoolerRunning: boolean;
  private readonly queues = new Map<string, QueueJob[]>();

  constructor(
    readonly platform: DiagnosisPlatform,
    private readonly specs: readonly FakePrinterSpec[],
    private readonly printers: FakePrinters,
    submitted: SubmittedJobs,
    clock: Clock,
  ) {
    this.isSpoolerRunning = !specs.some((spec) => spec.diagnosis?.spooler === 'stopped');
    const submittedAtMs = clock.now() - FAKE_JOB_AGE_MS;
    let nextId = 1;
    for (const spec of specs) {
      const { ours, others } = spec.diagnosis?.stuckJobs ?? { ours: 0, others: 0 };
      const jobs: QueueJob[] = [];
      for (let index = 0; index < ours + others; index += 1) {
        jobs.push({
          id: nextId,
          document: `假任务 ${nextId}`,
          user: index < ours ? FAKE_CURRENT_USER : FAKE_OTHER_USER,
          submittedAtMs,
          flags: ['error'],
        });
        nextId += 1;
      }
      this.queues.set(spec.name, jobs);
      if (ours > 0) {
        // 本程序的任务：账本里记一个盖住它们提交时间的时间段（和真的适配器交任务时一样）。
        submitted.record(spec.name, submittedAtMs);
      }
    }
  }

  async spooler(printerName: string | null): Promise<SpoolerFacts> {
    if (this.platform === 'windows') {
      return { kind: 'windows', state: this.isSpoolerRunning ? 'running' : 'stopped', startType: 'automatic' };
    }
    return {
      kind: 'mac',
      schedulerRunning: true,
      queue: printerName === null ? null : { enabled: this.isSpoolerRunning, acceptingJobs: true },
    };
  }

  async printer(printerName: string): Promise<PrinterFacts> {
    const readiness = this.spec(printerName)?.readiness ?? null;
    return readiness === null
      ? { kind: 'unknown', reason: 'the fake printer reports no status' }
      : { kind: 'known', readiness, paused: false, driverName: '假驱动' };
  }

  async usb(printerName: string): Promise<UsbFacts> {
    switch (this.spec(printerName)?.diagnosis?.usb ?? 'present') {
      case 'present':
        return { kind: 'present', deviceName: printerName };
      case 'disconnected':
        return { kind: 'disconnected', deviceName: printerName };
      case 'not-found':
        return { kind: 'not-found', port: FAKE_USB_PORT };
      case 'not-usb':
        return { kind: 'not-usb', port: FAKE_NETWORK_PORT };
    }
  }

  async jobs(printerName: string): Promise<QueueFacts> {
    const jobs = this.queues.get(printerName) ?? [];
    return { kind: 'listed', currentUser: FAKE_CURRENT_USER, total: jobs.length, jobs: [...jobs] };
  }

  async restartSpooler(): Promise<ActionResult> {
    if (!this.confirmAdmin(null, '重启后台打印服务')) {
      return { kind: 'declined' };
    }
    this.isSpoolerRunning = true;
    return { kind: 'done' };
  }

  async enablePrinter(printerName: string, admin: boolean): Promise<ActionResult> {
    if (admin && !this.confirmAdmin(printerName, '恢复这台打印机')) {
      return { kind: 'declined' };
    }
    this.isSpoolerRunning = true;
    return { kind: 'done' };
  }

  async openQueue(printerName: string): Promise<ActionResult> {
    this.openedWindows.push(`打印队列：${printerName}`);
    return { kind: 'done' };
  }

  /** 假的「打开打印首选项」：只记下来（DiagnosisStation 在假打印机模式下用它代替 rundll32）。 */
  async openPreferences(printerName: string): Promise<void> {
    this.openedWindows.push(`打印首选项：${printerName}`);
  }

  async cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult> {
    const jobs = this.queues.get(printerName) ?? [];
    const kept = jobs.filter((job) => !ids.includes(job.id));
    this.queues.set(printerName, kept);
    return { kind: 'done', count: jobs.length - kept.length };
  }

  async cancelAllJobs(printerName: string): Promise<ActionResult> {
    if (!this.confirmAdmin(printerName, '清空队列')) {
      return { kind: 'declined' };
    }
    this.queues.set(printerName, []);
    return { kind: 'done' };
  }

  async setDriverPaper(printerName: string, target: PaperSize, admin: boolean): Promise<ActionResult> {
    // 和真的一样：先看驱动有没有这种纸，没有就不弹确认。
    if (this.spec(printerName)?.diagnosis?.paperSettable === false) {
      return { kind: 'no-matching-paper' };
    }
    // Windows 一定要管理员；macOS 先以当前用户做（假打印机直接成功）。
    if ((this.platform === 'windows' || admin) && !this.confirmAdmin(printerName, '设置驱动纸张')) {
      return { kind: 'declined' };
    }
    const dpi = (await this.printers.driverPaper(printerName))?.dpi ?? null;
    this.printers.setDriverPaper(printerName, { widthMm: target.widthMm, heightMm: target.heightMm, dpi });
    return { kind: 'done' };
  }

  private spec(printerName: string): FakePrinterSpec | undefined {
    return this.specs.find((spec) => spec.name === printerName);
  }

  private confirmAdmin(printerName: string | null, action: string): boolean {
    this.adminPrompts.push(action);
    const spec = printerName === null ? this.specs.find((item) => item.diagnosis?.adminPrompt) : this.spec(printerName);
    return spec?.diagnosis?.adminPrompt !== 'decline';
  }
}

/** 假打印机模式下的 5a 接缝：指令集按 FakeDiagnosisSpec.commandSet，发出的动作只记下来。 */
export class FakeLabelCommands implements LabelCommandsSeam {
  readonly sent: { printerName: string; action: 'feed' | 'calibrate' }[] = [];

  constructor(private readonly specs: readonly FakePrinterSpec[]) {}

  async effectiveCommandSet(printerName: string): Promise<CommandSetName | 'none'> {
    return this.specs.find((spec) => spec.name === printerName)?.diagnosis?.commandSet ?? DEFAULT_COMMAND_SET;
  }

  async send(printerName: string, action: 'feed' | 'calibrate'): Promise<ActionResult> {
    this.sent.push({ printerName, action });
    return { kind: 'done' };
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/printing/fake-printers.test.ts src/main/diagnosis/fake-diagnosis.test.ts`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/printing/fake-printers.ts src/main/printing/fake-printers.test.ts src/main/diagnosis/fake-diagnosis.ts src/main/diagnosis/fake-diagnosis.test.ts src/main/diagnosis/seams.ts
git commit -m "test(diagnosis): fake printers that can be diagnosed and repaired" -m "E2E and visual acceptance need stuck queues, wrong driver paper and admin prompts without real printers. The fake follows the current platform's wording, records every admin prompt, and changes its state when a fix runs. Also adds the seams through which 5a and 5c plug in." -m "$TRAILER"
```

---

### Task 11: DiagnosisStation

主进程里诊断的入口：核对打印机在系统列表里（不在的不交给任何系统命令）、按管理员策略核对请求、同一时间只做一个修复、每次检查和修复都写日志。

**Files:**
- Create: `src/main/diagnosis/diagnosis-station.ts`、`src/main/diagnosis/diagnosis-station.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/diagnosis/diagnosis-station.test.ts
import { describe, expect, test } from 'bun:test';
import type { ActionResult, DiagnosisFixRequest } from '../../core/diagnosis/diagnosis-model';
import { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import { FakeClock } from '../../core/testing/fake-clock';
import { type FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import { DiagnosisStation } from './diagnosis-station';
import { FakeDiagnosis, FakeLabelCommands } from './fake-diagnosis';
import type { DriverReinstallSeam } from './seams';

const LABEL = { widthMm: 60, heightMm: 40 };

function setup(spec: Partial<FakePrinterSpec> = {}, drivers: DriverReinstallSeam | null = null) {
  const clock = new FakeClock();
  const specs: FakePrinterSpec[] = [
    { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true }, ...spec },
  ];
  const printers = new FakePrinters(specs);
  const submitted = new SubmittedJobs(clock);
  const system = new FakeDiagnosis('windows', specs, printers, submitted, clock);
  const forgotten: string[] = [];
  const logs: string[] = [];
  const station = new DiagnosisStation({
    system,
    isKnownPrinter: async (name) => specs.some((item) => item.name === name),
    driverPaper: (name) => printers.driverPaper(name),
    forgetProfile: (name) => forgotten.push(name),
    openPreferences: (name) => system.openPreferences(name),
    submitted,
    commands: new FakeLabelCommands(specs),
    drivers,
    clock,
    log: (message) => logs.push(message),
  });
  return { station, system, forgotten, logs };
}

function request(overrides: Partial<DiagnosisFixRequest>): DiagnosisFixRequest {
  return { printerName: '标签机A', fix: 'cancel-own-jobs', admin: false, paper: null, ...overrides };
}

describe('DiagnosisStation.check', () => {
  test('runs each check against the system and logs the verdict', async () => {
    const { station, logs } = setup({ diagnosis: { stuckJobs: { ours: 1, others: 0 } } });
    expect(await station.check('标签机A', 'queue', null)).toMatchObject({
      status: 'fail',
      detail: '有 1 个任务卡在队列里（最早的已经等了 5 分钟），都是本程序发的',
    });
    expect(logs.some((line) => line.includes('[diagnosis] 标签机A queue: fail'))).toBe(true);
  });

  // 安全底线：打印机名来自界面，不在系统列表里的不交给任何系统命令。
  test('does not touch the system for a printer that is not listed', async () => {
    const { station } = setup();
    expect(await station.check('别的打印机', 'queue', null)).toMatchObject({
      status: 'fail',
      detail: '系统打印机列表里已经没有这台了',
    });
  });

  test('checks only the print service when no printer is given', async () => {
    const { station } = setup({ diagnosis: { spooler: 'stopped' } });
    expect(await station.check(null, 'spooler', null)).toMatchObject({ status: 'fail' });
    await expect(station.check(null, 'queue', null)).rejects.toThrow('needs a printer');
  });

  test('offers a driver reinstall only through the 5c seam', async () => {
    const notReady = { readiness: { ready: false as const, detail: '打印机报错', issue: 'other' as const } };
    const without = await setup(notReady).station.check('标签机A', 'printer', null);
    expect(without.fixes.map((fix) => fix.id)).toEqual(['open-preferences']);
    const drivers: DriverReinstallSeam = {
      canReinstall: async () => true,
      reinstall: async (): Promise<ActionResult> => ({ kind: 'done' }),
    };
    const withSeam = await setup(notReady, drivers).station.check('标签机A', 'printer', null);
    expect(withSeam.fixes.map((fix) => fix.id)).toEqual(['open-preferences', 'reinstall-driver']);
  });

  test('skips the paper check for a printer that holds no paper', async () => {
    expect(await setup().station.check('标签机A', 'paper', null)).toMatchObject({ status: 'skipped' });
  });
});

describe('DiagnosisStation.fix', () => {
  test('cancels only our jobs, found again at the time of the fix', async () => {
    const { station } = setup({ diagnosis: { stuckJobs: { ours: 2, others: 1 } } });
    expect(await station.fix(request({}))).toEqual({ status: 'done', message: '已请求取消本程序的 2 个任务' });
    expect(await station.check('标签机A', 'queue', null)).toMatchObject({
      detail: '有 1 个任务卡在队列里（最早的已经等了 5 分钟），都不是本程序发的',
    });
  });

  test('sets the driver paper and forgets the cached profile', async () => {
    const { station, forgotten } = setup({ paper: { widthMm: 100, heightMm: 150, dpi: 203 } });
    expect(await station.fix(request({ fix: 'set-driver-paper', admin: true, paper: LABEL }))).toMatchObject({
      status: 'done',
    });
    expect(forgotten).toEqual(['标签机A']);
    expect(await station.check('标签机A', 'paper', LABEL)).toMatchObject({ status: 'pass' });
  });

  test('reports a declined admin prompt', async () => {
    const { station, system } = setup({ diagnosis: { adminPrompt: 'decline' } });
    expect(await station.fix(request({ fix: 'cancel-all-jobs', admin: true }))).toMatchObject({ status: 'declined' });
    expect(system.adminPrompts).toEqual(['清空队列']);
  });

  // 渲染进程不可信：管理员按钮必须是管理员按钮，反过来也一样；这个系统没有的修复直接拒绝。
  test('rejects requests that do not match the admin policy of the platform', async () => {
    const { station, system } = setup();
    await expect(station.fix(request({ fix: 'cancel-all-jobs', admin: false }))).rejects.toThrow('not allowed');
    await expect(station.fix(request({ fix: 'cancel-own-jobs', admin: true }))).rejects.toThrow('not allowed');
    await expect(station.fix(request({ fix: 'enable-printer' }))).rejects.toThrow('not allowed');
    expect(system.adminPrompts).toEqual([]);
  });

  test('rejects fixes for printers outside the system list and missing paper', async () => {
    const { station } = setup();
    await expect(station.fix(request({ printerName: '别的打印机' }))).rejects.toThrow('system list');
    await expect(station.fix(request({ printerName: null }))).rejects.toThrow('system list');
    await expect(station.fix(request({ fix: 'set-driver-paper', admin: true }))).rejects.toThrow('paper');
  });

  test('restarts the print service without a printer', async () => {
    const { station } = setup({ diagnosis: { spooler: 'stopped' } });
    expect(await station.fix(request({ printerName: null, fix: 'restart-spooler', admin: true }))).toMatchObject({
      status: 'done',
    });
    expect(await station.check(null, 'spooler', null)).toMatchObject({ status: 'pass' });
  });

  test('runs one fix at a time', async () => {
    const { station } = setup({ diagnosis: { stuckJobs: { ours: 1, others: 0 } } });
    const first = station.fix(request({}));
    await expect(station.fix(request({}))).rejects.toThrow('still running');
    await first;
  });

  test('sends the feed command through the 5a seam', async () => {
    const { station } = setup();
    expect(await station.fix(request({ fix: 'feed' }))).toEqual({
      status: 'done',
      message: '走纸指令已发送（进了打印队列）',
    });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/diagnosis/diagnosis-station.test.ts`
Expected: FAIL，`Cannot find module './diagnosis-station'`。

- [ ] **Step 3: 实现**

```ts
// src/main/diagnosis/diagnosis-station.ts
import type { ActionResult, DiagnosisFixRequest } from '../../core/diagnosis/diagnosis-model';
import { adminPolicy, fixOutcome } from '../../core/diagnosis/fixes';
import { summarizeQueue } from '../../core/diagnosis/queue-summary';
import type { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import {
  commandsVerdict,
  missingPrinterVerdict,
  paperVerdict,
  printerVerdict,
  queueVerdict,
  spoolerVerdict,
  usbVerdict,
} from '../../core/diagnosis/verdicts';
import type { Clock } from '../../core/types';
import type { CheckVerdict, DiagnosisCheckId, FixOutcome } from '../../shared/diagnosis';
import type { DriverPaper } from '../../shared/driver-paper';
import type { PaperSize } from '../../shared/paper-sizes';
import type { DiagnosisSystem } from './diagnosis-system';
import type { DriverReinstallSeam, LabelCommandsSeam } from './seams';

export interface DiagnosisStationDeps {
  system: DiagnosisSystem;
  /** 系统打印机列表里有没有这台（PrinterDriver.hasPrinter）。 */
  isKnownPrinter(printerName: string): Promise<boolean>;
  /** 现读驱动纸张（PrinterProfiles.fresh）。 */
  driverPaper(printerName: string): Promise<DriverPaper | null>;
  /** 改了驱动设置之后丢掉缓存（PrinterProfiles.forget）。 */
  forgetProfile(printerName: string): void;
  /** 打开打印首选项（driver-paper.ts 的 openPrinterPreferences；假打印机模式下只记下来）。 */
  openPreferences(printerName: string): Promise<void>;
  submitted: SubmittedJobs;
  /** 5a；没有时「指令集」一项跳过。 */
  commands: LabelCommandsSeam | null;
  /** 5c；没有时不出现「重新安装驱动」。 */
  drivers: DriverReinstallSeam | null;
  clock: Clock;
  log(message: string): void;
}

/**
 * 诊断的主进程入口（界面经 printer:diagnosis-check / printer:diagnosis-fix 调它）：
 * - 打印机名不在系统列表里：检查说「已经没有这台了」，修复直接拒绝——都不交给系统命令（安全底线）；
 * - 修复按平台的管理员策略核对（管理员按钮必须是管理员按钮，反过来也一样），同一时间只做一个；
 * - 每次检查、修复都写日志（打印机、项目、结论或结果）。
 */
export class DiagnosisStation {
  private isFixing = false;

  constructor(private readonly deps: DiagnosisStationDeps) {}

  /** 查一项。printerName 为 null 时只能查后台打印服务；expected 是这台打印机负责的纸。 */
  async check(printerName: string | null, check: DiagnosisCheckId, expected: PaperSize | null): Promise<CheckVerdict> {
    const { system } = this.deps;
    if (printerName === null) {
      if (check !== 'spooler') {
        throw new Error(`Diagnosis check "${check}" needs a printer`);
      }
      return this.logged('(system)', spoolerVerdict(await system.spooler(null), system.platform));
    }
    if (!(await this.deps.isKnownPrinter(printerName))) {
      // 点「诊断」之后打印机被拔掉或删了：这不是程序错误，说清楚就行。
      return this.logged(printerName, missingPrinterVerdict(check));
    }
    return this.logged(printerName, await this.checkListed(printerName, check, expected));
  }

  /** 做一个修复。请求不合策略、打印机不在列表里、缺纸张：程序错误，直接抛（IPC 会写日志并告诉界面）。 */
  async fix(request: DiagnosisFixRequest): Promise<FixOutcome> {
    const { system } = this.deps;
    const policy = adminPolicy(system.platform, request.fix);
    const isAllowed =
      policy === 'optional' || (policy === 'always' && request.admin) || (policy === 'never' && !request.admin);
    if (!isAllowed) {
      throw new Error(`Fix "${request.fix}" with admin=${request.admin} is not allowed on ${system.platform}`);
    }
    const isSystemFix = request.fix === 'restart-spooler';
    const isListed =
      request.printerName === null ? isSystemFix : await this.deps.isKnownPrinter(request.printerName);
    if (!isListed) {
      throw new Error(`Fix "${request.fix}" needs a printer that is in the system list`);
    }
    if (this.isFixing) {
      throw new Error('Another diagnosis fix is still running');
    }
    this.isFixing = true;
    try {
      const result = await this.run(request);
      const detail = result.kind === 'failed' ? ` ${result.detail}` : '';
      this.deps.log(
        `[diagnosis] fix ${request.fix} on ${request.printerName ?? '(system)'} admin=${request.admin}: ${result.kind}${detail}`,
      );
      return fixOutcome(system.platform, request, result);
    } finally {
      this.isFixing = false;
    }
  }

  private async checkListed(
    printerName: string,
    check: DiagnosisCheckId,
    expected: PaperSize | null,
  ): Promise<CheckVerdict> {
    const { system, commands } = this.deps;
    const noted = <T extends { kind: string }>(facts: T): T => this.noteUnknown(printerName, check, facts);
    switch (check) {
      case 'spooler':
        return spoolerVerdict(noted(await system.spooler(printerName)), system.platform);
      case 'printer':
        return printerVerdict(
          noted(await system.printer(printerName)),
          system.platform,
          await this.canReinstall(printerName),
        );
      case 'usb':
        return usbVerdict(noted(await system.usb(printerName)), system.platform, await this.canReinstall(printerName));
      case 'queue':
        return queueVerdict(
          noted(await system.jobs(printerName)),
          system.platform,
          this.deps.submitted.windowsFor(printerName),
          this.deps.clock.now(),
        );
      case 'paper':
        return paperVerdict(
          expected === null ? null : await this.deps.driverPaper(printerName),
          expected,
          system.platform,
        );
      case 'commands':
        return commandsVerdict(
          commands === null ? null : await commands.effectiveCommandSet(printerName),
          system.platform,
        );
    }
  }

  private async run(request: DiagnosisFixRequest): Promise<ActionResult> {
    const { system } = this.deps;
    const { printerName, fix, admin } = request;
    if (fix === 'restart-spooler') {
      return system.restartSpooler();
    }
    if (printerName === null) {
      throw new Error(`Fix "${fix}" needs a printer`);
    }
    switch (fix) {
      case 'open-preferences':
        await this.deps.openPreferences(printerName);
        this.deps.forgetProfile(printerName);
        return { kind: 'done' };
      case 'reinstall-driver':
        if (this.deps.drivers === null) {
          throw new Error('Driver reinstall is not available in this build');
        }
        return this.deps.drivers.reinstall(printerName);
      case 'enable-printer':
        return system.enablePrinter(printerName, admin);
      case 'open-queue':
        return system.openQueue(printerName);
      case 'cancel-own-jobs':
        return this.cancelOwnJobs(printerName);
      case 'cancel-all-jobs':
        return system.cancelAllJobs(printerName);
      case 'set-driver-paper': {
        if (request.paper === null) {
          throw new Error('set-driver-paper needs the paper the printer is responsible for');
        }
        const result = await system.setDriverPaper(printerName, request.paper, admin);
        // 改没改成都重读：回滚了也可能和之前缓存的不一样。
        this.deps.forgetProfile(printerName);
        return result;
      }
      case 'feed':
      case 'calibrate':
        if (this.deps.commands === null) {
          throw new Error('Label commands are not available in this build');
        }
        return this.deps.commands.send(printerName, fix);
    }
  }

  /** 修的时候重新查队列、重新认哪些是本程序的：不信界面传来的任务编号（界面根本不传）。 */
  private async cancelOwnJobs(printerName: string): Promise<ActionResult> {
    const facts = await this.deps.system.jobs(printerName);
    if (facts.kind === 'unknown') {
      return { kind: 'failed', detail: '查不到打印队列' };
    }
    const { own } = summarizeQueue(facts, this.deps.submitted.windowsFor(printerName), this.deps.clock.now());
    if (own.length === 0) {
      return { kind: 'done', count: 0 };
    }
    return this.deps.system.cancelJobs(
      printerName,
      own.map((job) => job.id),
    );
  }

  /** 5c 说能不能重装；它出错按「不能」处理并写日志（只是少一个按钮，不影响检查本身）。 */
  private async canReinstall(printerName: string): Promise<boolean> {
    if (this.deps.drivers === null) {
      return false;
    }
    try {
      return await this.deps.drivers.canReinstall(printerName);
    } catch (error) {
      this.deps.log(`[diagnosis] cannot ask whether the driver of ${printerName} can be reinstalled: ${String(error)}`);
      return false;
    }
  }

  private logged(printerName: string, verdict: CheckVerdict): CheckVerdict {
    this.deps.log(`[diagnosis] ${printerName} ${verdict.check}: ${verdict.status} ${verdict.detail}`);
    return verdict;
  }

  /** 「查不到」的原因（英文）只在事实里、不进结论：写进日志，排查时能看到是超时、命令出错还是输出读不懂。 */
  private noteUnknown<T extends { kind: string }>(printerName: string, check: DiagnosisCheckId, facts: T): T {
    if (facts.kind === 'unknown' && 'reason' in facts) {
      this.deps.log(`[diagnosis] ${printerName} ${check} unknown: ${String(facts.reason)}`);
    }
    return facts;
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/diagnosis`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/diagnosis/diagnosis-station.ts src/main/diagnosis/diagnosis-station.test.ts
git commit -m "feat(diagnosis): DiagnosisStation checks printers and applies fixes safely" -m "Printer names from the renderer reach system commands only when the printer is in the system list. Every fix request is checked against the platform's admin policy, runs one at a time and is logged; our jobs are found again at fix time instead of trusting ids from the page." -m "$TRAILER"
```

---

### Task 12: 记下本程序交出去的任务

**Files:**
- Modify: `src/main/printing/electron-driver-adapter.ts`
- Modify: 5a 的 RAW 发送入口（名字以 5a 合并后的为准，例如 `src/main/commands/raw-sender.ts`）

- [ ] **Step 1: 适配器记账**

`electron-driver-adapter.ts`：import 加 `import type { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';`；构造参数在 `profiles` 之后加：

```ts
    /** 交给打印队列的任务的账本：诊断时据此认出队列里哪些是本程序发的。 */
    private readonly submitted: SubmittedJobs,
```

`print` 里把 `await withLabelWindow(...)` 那一句换成：

```ts
    const startedAt = this.clock.now();
    // 超时（PrintQueue 触发 abort）时立刻销毁打印窗口，避免隐藏窗口堆积。
    await withLabelWindow(html, signal, (contents) =>
      printSilently(contents, printerName, pageSizeMicrons(job.template.paper)),
    );
    // 驱动回调成功 = 任务进了系统的打印队列：记下这个时间段。
    this.submitted.record(printerName, startedAt);
```

（原来的那行注释保留在 `withLabelWindow` 上面。）这个文件依赖 Electron 的打印窗口，没有单元测试；账本的规则在 `submitted-jobs.test.ts` 和 `queue-summary.test.ts` 里测，接线由 Task 16 的 E2E 和 Task 18 的真机验收覆盖。

- [ ] **Step 2: index.ts 建账本**

`src/main/index.ts`：import 加 `import { SubmittedJobs } from '../core/diagnosis/submitted-jobs';`；在 `const profiles = new PrinterProfiles(` 之前加：

```ts
  // 本程序交给打印队列的任务（只在内存里）：诊断「队列里有卡住的任务」时据此认出哪些是本程序发的。
  const submittedJobs = new SubmittedJobs(systemClock);
```

`new ElectronDriverAdapter(requireWebContents, …, systemClock, profiles)` 的参数末尾加 `submittedJobs`。

- [ ] **Step 3: 5a 的 RAW 任务也记账**

5a 的 RAW 下发（Windows 经探测进程调 winspool 的 `StartDocPrinter` / `WritePrinter`，macOS `lp -o raw`）同样进系统打印队列。在 5a 的发送入口里，发送前取 `const startedAt = clock.now();`，系统报告发送成功后调 `submittedJobs.record(printerName, startedAt)`（`submittedJobs` 由 `index.ts` 传进它的构造参数）。5a 的发送有单元测试的话，在它的测试里加一条：「成功发送后账本里有这台打印机的一个时间段，失败时没有」。

- [ ] **Step 4: `bun run check` 后提交**

```bash
git add src/main/printing/electron-driver-adapter.ts src/main/index.ts <5a 的发送入口及其测试>
git commit -m "feat(diagnosis): record every hand-off to the print queue" -m "Labels printed through the driver and raw commands sent by the label command feature both land in the system queue. Recording when each was handed over lets diagnosis tell our stuck jobs from other programs' and clear ours without admin rights." -m "$TRAILER"
```

---

### Task 13: IPC 和接线

两个通道，只给最小能力：检查一项（检查项是枚举）、做一个修复（修复项是枚举，要取消哪些任务、写什么纸张都由主进程自己查、自己算，界面传不进来）。

**Files:**
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts`

- [ ] **Step 1: 写测试**（`ipc-validators.test.ts` 末尾追加；import 加 `requireDiagnosisCheck`、`requireDiagnosisFixRequest`）

```ts
describe('diagnosis validators', () => {
  test('accepts only known checks', () => {
    expect(requireDiagnosisCheck('queue')).toBe('queue');
    expect(() => requireDiagnosisCheck('rm -rf')).toThrow('Invalid diagnosis check');
  });

  test('parses a fix request into a paper size and rejects anything else', () => {
    expect(
      requireDiagnosisFixRequest({ printerName: '标签机A', fix: 'set-driver-paper', admin: true, paperKey: '60x40' }),
    ).toEqual({ printerName: '标签机A', fix: 'set-driver-paper', admin: true, paper: { widthMm: 60, heightMm: 40 } });
    expect(requireDiagnosisFixRequest({ printerName: null, fix: 'restart-spooler', admin: true, paperKey: null })).toEqual(
      { printerName: null, fix: 'restart-spooler', admin: true, paper: null },
    );
    expect(() => requireDiagnosisFixRequest({ printerName: 'A', fix: 'change-command-set', admin: false, paperKey: null })).toThrow(
      'Invalid diagnosis fix',
    );
    expect(() => requireDiagnosisFixRequest({ printerName: 'A', fix: 'feed', admin: 'yes', paperKey: null })).toThrow();
    expect(() => requireDiagnosisFixRequest({ printerName: 'A', fix: 'feed', admin: false, paperKey: 'big' })).toThrow();
    expect(() => requireDiagnosisFixRequest([])).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL，`requireDiagnosisCheck` 没有导出。

- [ ] **Step 3: 校验**

`ipc-validators.ts`：import 加

```ts
import type { DiagnosisFixRequest } from '../core/diagnosis/diagnosis-model';
import { type DiagnosisCheckId, isDiagnosisCheckId, isDiagnosisFixId } from '../shared/diagnosis';
```

文件末尾加：

```ts
export function requireDiagnosisCheck(value: unknown): DiagnosisCheckId {
  if (!isDiagnosisCheckId(value)) {
    throw new TypeError('Invalid diagnosis check');
  }
  return value;
}

/** 打印机名可以为 null（只查、只修后台打印服务时）。 */
export function requireNullablePrinterName(value: unknown): string | null {
  return value === null ? null : requireString(value, 'printerName');
}

/** 纸张键可以为 null；不为 null 时换成纸张。 */
export function requireNullablePaper(value: unknown): PaperSize | null {
  if (value === null) {
    return null;
  }
  const paper = parsePaperKey(requirePaperKey(value));
  if (paper === null) {
    throw new TypeError('Invalid paper key');
  }
  return paper;
}

/** 修复请求：修复项是枚举，管理员是布尔；要取消哪些任务、写什么纸张都由主进程自己查，请求里没有。 */
export function requireDiagnosisFixRequest(value: unknown): DiagnosisFixRequest {
  const record = requireRecord(value, 'diagnosis fix request');
  const fix = record['fix'];
  if (!isDiagnosisFixId(fix)) {
    throw new TypeError('Invalid diagnosis fix');
  }
  return {
    printerName: requireNullablePrinterName(record['printerName']),
    fix,
    admin: requireBoolean(record['admin'], 'admin'),
    paper: requireNullablePaper(record['paperKey']),
  };
}
```

（`paper-sizes` 的 import 改为 `import { type PaperSize, paperKey, parsePaperKey } from '../shared/paper-sizes';`。）

- [ ] **Step 4: 通道和 preload**

`ipc-contract.ts`：import 加 `import type { CheckVerdict, DiagnosisCheckId, FixOutcome, FixRequest } from './diagnosis';`；`IpcChannel` 里 `OpenPrinterPreferences` 之后加：

```ts
  DiagnosisCheck: 'printer:diagnosis-check',
  DiagnosisFix: 'printer:diagnosis-fix',
```

`LabelFlashApi` 里 `openPrinterPreferences` 之后加：

```ts
  /**
   * 诊断一项。printerName 为 null 时只能查后台打印服务（系统列不出打印机的时候）；
   * paperKey 是这台打印机负责的纸，没有负责的纸为 null（驱动纸张一项跳过）。
   */
  runDiagnosisCheck(printerName: string | null, check: DiagnosisCheckId, paperKey: string | null): Promise<CheckVerdict>;
  /** 做一个修复；要管理员权限的会弹系统的确认框。返回做了什么，是否解决由随后的重新检查说。 */
  applyDiagnosisFix(request: FixRequest): Promise<FixOutcome>;
```

`src/preload/index.ts` 在 `openPrinterPreferences` 之后加：

```ts
  runDiagnosisCheck: (printerName, check, paperKey) =>
    ipcRenderer.invoke(IpcChannel.DiagnosisCheck, printerName, check, paperKey),
  applyDiagnosisFix: (request) => ipcRenderer.invoke(IpcChannel.DiagnosisFix, request),
```

`src/main/ipc.ts`：import 加 `import type { DiagnosisStation } from './diagnosis/diagnosis-station';`，校验函数的 import 列表按字母顺序加 `requireDiagnosisCheck`、`requireDiagnosisFixRequest`、`requireNullablePaper`、`requireNullablePrinterName`；`IpcDeps` 里 `profiles` 之后加：

```ts
  /** 打印机页的「诊断」。 */
  diagnosis: DiagnosisStation;
```

`OpenPrinterPreferences` 的处理函数之后加：

```ts
  // 打印机名在 DiagnosisStation 里核对（不在系统列表里的不交给系统命令）；这里只核对形状。
  handle(IpcChannel.DiagnosisCheck, (printerName, check, key) =>
    deps.diagnosis.check(
      requireNullablePrinterName(printerName),
      requireDiagnosisCheck(check),
      requireNullablePaper(key),
    ),
  );
  handle(IpcChannel.DiagnosisFix, (request) => deps.diagnosis.fix(requireDiagnosisFixRequest(request)));
```

- [ ] **Step 5: index.ts 接线**

import 加：

```ts
import { DiagnosisStation } from './diagnosis/diagnosis-station';
import { createDiagnosisSystem } from './diagnosis/create-diagnosis-system';
import { diagnosisPlatformOf } from './diagnosis/diagnosis-system';
import { FakeDiagnosis, FakeLabelCommands } from './diagnosis/fake-diagnosis';
import type { LabelCommandsSeam } from './diagnosis/seams';
```

（`openPrinterPreferences` 从 `./printing/driver-paper` 和 `queryDriverPaper` 一起导入。）在 `const status = new PrinterStatusMonitor(` 那一段之后加：

```ts
  // 仅开发 / E2E：假打印机也能诊断（见 diagnosis/fake-diagnosis.ts），安装版不会走到这里。
  const fakeDiagnosis =
    fakeSpecs && fakePrinters
      ? new FakeDiagnosis(diagnosisPlatformOf(process.platform), fakeSpecs, fakePrinters, submittedJobs, systemClock)
      : null;
  if (fakeDiagnosis) {
    (globalThis as { e2eFakeDiagnosis?: FakeDiagnosis }).e2eFakeDiagnosis = fakeDiagnosis;
  }
  // 5a（标签机指令）的发送入口。下面两行按 5a 合并后的名字接（计划里叫 labelCommandStation），只有这里碰 5a。
  const labelCommands: LabelCommandsSeam = fakeSpecs
    ? new FakeLabelCommands(fakeSpecs)
    : {
        effectiveCommandSet: (name) => labelCommandStation.effectiveCommandSet(name),
        send: (name, action) => labelCommandStation.runAction(name, action),
      };
  const diagnosis = new DiagnosisStation({
    system: fakeDiagnosis ?? createDiagnosisSystem(process.platform, probeHost),
    // 系统打印机列表（读它要用主窗口；诊断由界面触发，那时窗口一定在）。
    isKnownPrinter: (name) => adapter.hasPrinter(name),
    driverPaper: (name) => profiles.fresh(name),
    forgetProfile: (name) => profiles.forget(name),
    openPreferences: fakeDiagnosis ? (name) => fakeDiagnosis.openPreferences(name) : openPrinterPreferences,
    submitted: submittedJobs,
    commands: labelCommands,
    // 5c（驱动安装）的计划把这里换成它的实现；在那之前「重新安装驱动」不出现。
    drivers: null,
    clock: systemClock,
    log: (message) => console.info(message),
  });
```

5a 的 `runAction` 返回值形状和 `ActionResult` 不一样时，在这里转换（例如 `{ ok: true }` → `{ kind: 'done' }`、`{ ok: false, detail }` → `{ kind: 'failed', detail }`）。`registerIpc({ … })` 的参数里在 `status,` 之后加 `diagnosis,`。

- [ ] **Step 6: 跑测试和 E2E**

Run: `bun test src/main` 然后 `bun run test:e2e`
Expected: 全部通过（还没有界面，E2E 证明接线没有弄坏启动和打印）。

- [ ] **Step 7: `bun run check` 后提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(diagnosis): IPC channels for running checks and applying fixes" -m "The renderer can ask for one check or one fix by name, nothing more: which jobs to cancel and which paper to write are worked out in the main process. Fake printers get a fake diagnosis so E2E runs the same code paths on Windows and macOS." -m "$TRAILER"
```

---

### Task 14: 界面的纯逻辑

面板的状态变化全是纯函数：开始一轮、正在查哪一项、拿到结论、修复开始 / 结束、系统要管理员时换按钮、走纸后问操作员、修完重查哪几项、顶部的汇总、每项的标记。

**Files:**
- Create: `src/renderer/src/lib/diagnosis-view.ts`、`src/renderer/src/lib/diagnosis-view.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/diagnosis-view.test.ts
import { describe, expect, test } from 'bun:test';
import type { CheckVerdict, DiagnosisCheckId, FixOutcome } from '../../../shared/diagnosis';
import {
  checksAfterFix,
  diagnosisSummary,
  itemBadge,
  shownOffers,
  shownVerdict,
  startDiagnosis,
  withChecking,
  withCommandSetPicker,
  withFeedAnswer,
  withFixOutcome,
  withFixStarted,
  withRequeued,
  withVerdict,
} from './diagnosis-view';

const pass = (check: DiagnosisCheckId): CheckVerdict => ({ check, status: 'pass', detail: '没问题', nextStep: null, fixes: [] });
const QUEUE: CheckVerdict = {
  check: 'queue',
  status: 'fail',
  detail: '有 1 个任务卡在队列里',
  nextStep: null,
  fixes: [{ id: 'cancel-all-jobs', label: '清除全部任务（需要管理员权限）', admin: true }],
};
const SPOOLER_MAC: CheckVerdict = {
  check: 'spooler',
  status: 'fail',
  detail: '这台打印机在系统里被暂停了',
  nextStep: null,
  fixes: [{ id: 'enable-printer', label: '恢复这台打印机', admin: false }],
};
const COMMANDS: CheckVerdict = {
  check: 'commands',
  status: 'action',
  detail: '指令集：TSPL。指令是单向的，程序读不到标签机的回答',
  nextStep: '点「走一张纸」，看标签机有没有走出一张空白标签',
  fixes: [
    { id: 'feed', label: '走一张纸', admin: false },
    { id: 'calibrate', label: '纸张校准', admin: false },
    { id: 'change-command-set', label: '改指令集', admin: false },
  ],
};
const DONE: FixOutcome = { status: 'done', message: '走纸指令已发送（进了打印队列）' };

function finished(...verdicts: CheckVerdict[]) {
  let view = startDiagnosis('标签机A', '60x40');
  for (const verdict of verdicts) {
    view = withVerdict(view, verdict);
  }
  return view;
}

describe('startDiagnosis', () => {
  test('lists all six checks for a printer and only the print service without one', () => {
    expect(startDiagnosis('标签机A', '60x40').items.map((item) => item.check)).toEqual([
      'spooler',
      'printer',
      'usb',
      'queue',
      'paper',
      'commands',
    ]);
    expect(startDiagnosis(null, null).items.map((item) => item.check)).toEqual(['spooler']);
  });
});

describe('diagnosisSummary', () => {
  test('shows progress, then problems, unknowns and what waits for the operator', () => {
    const started = withChecking(startDiagnosis('标签机A', '60x40'), 'spooler');
    expect(diagnosisSummary(started)).toBe('正在检查（0/6）…');
    const done = finished(pass('spooler'), pass('printer'), pass('usb'), QUEUE, { ...pass('paper'), status: 'unknown' }, COMMANDS);
    expect(diagnosisSummary(done)).toBe('查完了：1 项有问题，1 项查不到，1 项待确认');
    expect(diagnosisSummary(finished(pass('spooler'), pass('printer'), pass('usb'), pass('queue'), pass('paper'), pass('commands')))).toBe(
      '查完了：没发现问题',
    );
  });
});

describe('fixes', () => {
  test('swaps in the admin button the system asked for', () => {
    let view = finished(SPOOLER_MAC);
    view = withFixStarted(view, 'enable-printer');
    expect(view.busyFix).toBe('enable-printer');
    view = withFixOutcome(view, 'spooler', 'enable-printer', {
      status: 'needs-admin',
      message: '系统要求管理员权限才能做这一步',
      retry: { id: 'enable-printer', label: '恢复这台打印机（需要管理员权限）', admin: true },
    });
    expect(view.busyFix).toBeNull();
    const spooler = view.items[0];
    expect(spooler === undefined ? [] : shownOffers(spooler)).toEqual([
      { id: 'enable-printer', label: '恢复这台打印机（需要管理员权限）', admin: true },
    ]);
  });

  test('rechecks only the affected checks that this panel has', () => {
    expect(checksAfterFix(startDiagnosis('标签机A', null), 'cancel-own-jobs')).toEqual(['queue']);
    expect(checksAfterFix(startDiagnosis(null, null), 'restart-spooler')).toEqual(['spooler']);
    expect(checksAfterFix(startDiagnosis('标签机A', null), 'feed')).toEqual([]);
  });

  test('a requeued check loses its old verdict but keeps the outcome message', () => {
    let view = finished(QUEUE);
    view = withFixOutcome(view, 'queue', 'cancel-all-jobs', { status: 'done', message: '已请求清空这台打印机的队列' });
    view = withRequeued(view, ['queue']);
    const queue = view.items.find((item) => item.check === 'queue');
    expect(queue).toMatchObject({ phase: 'waiting', verdict: null, outcome: { message: '已请求清空这台打印机的队列' } });
  });
});

describe('feed confirmation', () => {
  const commandsOf = (view: ReturnType<typeof finished>) => view.items.find((item) => item.check === 'commands');

  test('asks the operator after the feed command was sent', () => {
    const view = withFixOutcome(finished(COMMANDS), 'commands', 'feed', DONE);
    expect(commandsOf(view)?.feed).toBe('asking');
  });

  test('a label came out: the command set works', () => {
    const view = withFeedAnswer(withFixOutcome(finished(COMMANDS), 'commands', 'feed', DONE), true);
    const item = commandsOf(view);
    expect(item === undefined ? null : shownVerdict(item)).toMatchObject({
      status: 'pass',
      detail: '操作员确认：标签机走出了空白标签，指令集能通信',
    });
    expect(item === undefined ? '' : itemBadge(item).text).toBe('通过');
  });

  test('nothing came out: suggest another command set and open the picker', () => {
    const view = withFeedAnswer(withFixOutcome(finished(COMMANDS), 'commands', 'feed', DONE), false);
    const item = commandsOf(view);
    expect(item === undefined ? null : shownVerdict(item)?.status).toBe('fail');
    expect(item === undefined ? [] : shownOffers(item).map((offer) => offer.id)).toEqual(['feed', 'change-command-set']);
    expect(item?.isPickingCommandSet).toBe(true);
  });

  test('the change button opens the picker without asking the main process', () => {
    expect(commandsOf(withCommandSetPicker(finished(COMMANDS)))?.isPickingCommandSet).toBe(true);
  });
});

describe('itemBadge', () => {
  test('shows waiting and checking before a verdict arrives', () => {
    const view = withChecking(startDiagnosis('标签机A', null), 'spooler');
    expect(view.items.map((item) => itemBadge(item).text).slice(0, 2)).toEqual(['正在查…', '等待']);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/diagnosis-view.test.ts`
Expected: FAIL，`Cannot find module './diagnosis-view'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/diagnosis-view.ts
import {
  CHANGE_COMMAND_SET,
  type CheckVerdict,
  DIAGNOSIS_CHECKS,
  type DiagnosisCheckId,
  type DiagnosisFixId,
  type FixOffer,
  type FixOutcome,
  RECHECK_AFTER,
  type VerdictStatus,
} from '../../../shared/diagnosis';

/** 指令集一项：走纸之后问操作员（none 还没走纸；asking 在问；works 出了纸；silent 没反应）。 */
export type FeedAnswer = 'none' | 'asking' | 'works' | 'silent';

/** 一项检查在面板上的样子。 */
export interface DiagnosisItem {
  check: DiagnosisCheckId;
  phase: 'waiting' | 'checking' | 'done';
  verdict: CheckVerdict | null;
  /** 最近一次修复的结果（「已请求取消 2 个任务」「没有拿到管理员权限」）。 */
  outcome: FixOutcome | null;
  /** 系统要求管理员时换上的按钮（needs-admin 的 retry）。 */
  adminRetry: FixOffer | null;
  feed: FeedAnswer;
  /** 在这一项下面显示指令集下拉。 */
  isPickingCommandSet: boolean;
}

export interface DiagnosisView {
  /** null = 只查后台打印服务（系统列不出打印机的时候）。 */
  printerName: string | null;
  /** 这台打印机负责的纸；没有时为 null。 */
  paperKey: string | null;
  items: DiagnosisItem[];
  /** 正在做的修复（同一时间只做一个）。 */
  busyFix: DiagnosisFixId | null;
}

export type BadgeTone = 'ok' | 'warning' | 'error' | 'quiet';

export const STATUS_BADGES: Readonly<Record<VerdictStatus, { text: string; tone: BadgeTone }>> = {
  pass: { text: '通过', tone: 'ok' },
  fail: { text: '有问题', tone: 'error' },
  warn: { text: '注意', tone: 'warning' },
  unknown: { text: '查不到', tone: 'quiet' },
  skipped: { text: '跳过', tone: 'quiet' },
  action: { text: '待确认', tone: 'warning' },
};

const WORKS_DETAIL = '操作员确认：标签机走出了空白标签，指令集能通信';
const SILENT_DETAIL = '标签机没有反应：指令集可能不对，或者标签机没收到指令';
const SILENT_NEXT_STEP = '换一个指令集，再点「走一张纸」；还不行就看上面几项（驱动状态、USB、队列）';

function newItem(check: DiagnosisCheckId): DiagnosisItem {
  return { check, phase: 'waiting', verdict: null, outcome: null, adminRetry: null, feed: 'none', isPickingCommandSet: false };
}

function mapItem(view: DiagnosisView, check: DiagnosisCheckId, change: (item: DiagnosisItem) => DiagnosisItem): DiagnosisView {
  return { ...view, items: view.items.map((item) => (item.check === check ? change(item) : item)) };
}

/** 新的一轮：打印机的六项；只查后台打印服务时只有一项。 */
export function startDiagnosis(printerName: string | null, paperKey: string | null): DiagnosisView {
  const checks: readonly DiagnosisCheckId[] = printerName === null ? ['spooler'] : DIAGNOSIS_CHECKS;
  return { printerName, paperKey, items: checks.map(newItem), busyFix: null };
}

export function withChecking(view: DiagnosisView, check: DiagnosisCheckId): DiagnosisView {
  return mapItem(view, check, (item) => ({ ...item, phase: 'checking' }));
}

/** 拿到结论。指令集重查之后，之前问过的「出纸了吗」作废。 */
export function withVerdict(view: DiagnosisView, verdict: CheckVerdict): DiagnosisView {
  return mapItem(view, verdict.check, (item) => ({
    ...item,
    phase: 'done',
    verdict,
    adminRetry: null,
    feed: verdict.check === 'commands' ? 'none' : item.feed,
  }));
}

/** 修复做完要重查的几项：排回「等待」，旧结论去掉（修复的结果留着）。 */
export function withRequeued(view: DiagnosisView, checks: readonly DiagnosisCheckId[]): DiagnosisView {
  return {
    ...view,
    items: view.items.map((item) => (checks.includes(item.check) ? { ...item, phase: 'waiting', verdict: null } : item)),
  };
}

export function withFixStarted(view: DiagnosisView, fix: DiagnosisFixId): DiagnosisView {
  return { ...view, busyFix: fix };
}

/** 修复结束：结果写在那一项下面；系统要管理员时换按钮；走纸发出去了就问操作员。 */
export function withFixOutcome(
  view: DiagnosisView,
  check: DiagnosisCheckId,
  fix: DiagnosisFixId,
  outcome: FixOutcome,
): DiagnosisView {
  const next = mapItem(view, check, (item) => ({
    ...item,
    outcome,
    adminRetry: outcome.status === 'needs-admin' ? outcome.retry : null,
    feed: fix === 'feed' && outcome.status === 'done' ? 'asking' : item.feed,
  }));
  return { ...next, busyFix: null };
}

/** 操作员回答走纸后有没有出纸；没出纸就直接打开指令集下拉。 */
export function withFeedAnswer(view: DiagnosisView, works: boolean): DiagnosisView {
  return mapItem(view, 'commands', (item) => ({
    ...item,
    feed: works ? 'works' : 'silent',
    isPickingCommandSet: !works,
  }));
}

export function withCommandSetPicker(view: DiagnosisView): DiagnosisView {
  return mapItem(view, 'commands', (item) => ({ ...item, isPickingCommandSet: true }));
}

/** 修复之后重查哪几项（只取这个面板里有的）。 */
export function checksAfterFix(view: DiagnosisView, fix: DiagnosisFixId): DiagnosisCheckId[] {
  return RECHECK_AFTER[fix].filter((check) => view.items.some((item) => item.check === check));
}

/** 显示的结论：指令集一项按操作员的回答改写（程序自己读不到标签机的回答）。 */
export function shownVerdict(item: DiagnosisItem): CheckVerdict | null {
  const { verdict } = item;
  if (verdict === null || item.check !== 'commands') {
    return verdict;
  }
  if (item.feed === 'works') {
    return { ...verdict, status: 'pass', detail: WORKS_DETAIL, nextStep: null, fixes: verdict.fixes.filter((fix) => fix.id === 'calibrate') };
  }
  if (item.feed === 'silent') {
    return {
      ...verdict,
      status: 'fail',
      detail: SILENT_DETAIL,
      nextStep: SILENT_NEXT_STEP,
      fixes: verdict.fixes.filter((fix) => fix.id === 'feed' || fix.id === CHANGE_COMMAND_SET),
    };
  }
  return verdict;
}

/** 显示的按钮：系统要管理员时，同一个修复换成管理员按钮。 */
export function shownOffers(item: DiagnosisItem): FixOffer[] {
  const offers = shownVerdict(item)?.fixes ?? [];
  const retry = item.adminRetry;
  return retry === null ? offers : offers.map((offer) => (offer.id === retry.id ? retry : offer));
}

export function itemBadge(item: DiagnosisItem): { text: string; tone: BadgeTone } {
  if (item.phase === 'checking') {
    return { text: '正在查…', tone: 'quiet' };
  }
  const verdict = shownVerdict(item);
  return verdict === null ? { text: '等待', tone: 'quiet' } : STATUS_BADGES[verdict.status];
}

/** 面板顶部的一句话：进度，或查完后有几项有问题、查不到、待确认。 */
export function diagnosisSummary(view: DiagnosisView): string {
  const total = view.items.length;
  const done = view.items.filter((item) => item.phase === 'done').length;
  if (done < total) {
    return `正在检查（${done}/${total}）…`;
  }
  const statuses = view.items.map((item) => shownVerdict(item)?.status);
  const count = (wanted: readonly VerdictStatus[]) =>
    statuses.filter((status) => status !== undefined && wanted.includes(status)).length;
  const problems = count(['fail', 'warn']);
  const parts = [problems === 0 ? '查完了：没发现问题' : `查完了：${problems} 项有问题`];
  const unknown = count(['unknown']);
  const waiting = count(['action']);
  if (unknown > 0) {
    parts.push(`${unknown} 项查不到`);
  }
  if (waiting > 0) {
    parts.push(`${waiting} 项待确认`);
  }
  return parts.join('，');
}
```

（汇总在「没发现问题」时也会接「1 项待确认」：指令集要操作员走纸确认，这是实情。上面第二个断言里六项全 pass，所以没有后缀。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib/diagnosis-view.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/diagnosis-view.ts src/renderer/src/lib/diagnosis-view.test.ts
git commit -m "feat(renderer): pure state for the diagnosis panel" -m "Order of checks, rechecks after a fix, the admin button swapped in when the system asks for it, and the operator's answer after a feed are plain functions with tests. Commands are one-way, so the panel asks whether a label came out instead of claiming it did." -m "$TRAILER"
```

---

### Task 15: 诊断面板和打印机页

**Files:**
- Create: `src/renderer/src/view-models/use-diagnosis.ts`
- Create: `src/renderer/src/components/DiagnosisPanel.tsx`
- Modify: `src/renderer/src/components/PrinterList.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 视图模型**

```ts
// src/renderer/src/view-models/use-diagnosis.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHANGE_COMMAND_SET,
  type CheckVerdict,
  type DiagnosisCheckId,
  type DiagnosisFixId,
  type FixOffer,
  type FixOutcome,
} from '../../../shared/diagnosis';
import {
  checksAfterFix,
  type DiagnosisView,
  startDiagnosis,
  withChecking,
  withCommandSetPicker,
  withFeedAnswer,
  withFixOutcome,
  withFixStarted,
  withRequeued,
  withVerdict,
} from '../lib/diagnosis-view';
import { reportError } from '../lib/notices';

/** 打印机页用到的诊断状态和操作。 */
export interface DiagnosisControls {
  view: DiagnosisView | null;
  /** 开始诊断一台打印机（printerName 为 null：只查后台打印服务）。 */
  open(printerName: string | null, paperKey: string | null): void;
  close(): void;
  rerun(): void;
  applyFix(check: DiagnosisCheckId, offer: FixOffer): void;
  answerFeed(works: boolean): void;
}

const INTERNAL_ERROR = '程序内部出错，详情在日志里';

function failedCheck(check: DiagnosisCheckId): CheckVerdict {
  return { check, status: 'unknown', detail: `这一项没查成：${INTERNAL_ERROR}`, nextStep: null, fixes: [] };
}

/**
 * 按顺序一项一项调主进程（一项查完再查下一项，面板上逐项出结果）。
 * 每次开始、关闭加一轮：旧的一轮还在路上时，回来的结果不写进新的一轮。
 */
export function useDiagnosis(): DiagnosisControls {
  const [view, setView] = useState<DiagnosisView | null>(null);
  const runRef = useRef(0);
  // 最新的面板状态：修复时要用它的打印机和纸张。在 effect 里更新，不在渲染过程中改 ref。
  const viewRef = useRef<DiagnosisView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const update = useCallback((change: (current: DiagnosisView) => DiagnosisView) => {
    setView((current) => (current === null ? null : change(current)));
  }, []);

  const runChecks = useCallback(
    async (run: number, printerName: string | null, paperKey: string | null, checks: readonly DiagnosisCheckId[]) => {
      for (const check of checks) {
        if (runRef.current !== run) {
          return;
        }
        update((current) => withChecking(current, check));
        let verdict: CheckVerdict;
        try {
          verdict = await window.api.runDiagnosisCheck(printerName, check, paperKey);
        } catch (error) {
          reportError('诊断打印机', error);
          verdict = failedCheck(check);
        }
        if (runRef.current !== run) {
          return;
        }
        update((current) => withVerdict(current, verdict));
      }
    },
    [update],
  );

  const open = useCallback(
    (printerName: string | null, paperKey: string | null) => {
      runRef.current += 1;
      const next = startDiagnosis(printerName, paperKey);
      setView(next);
      void runChecks(
        runRef.current,
        printerName,
        paperKey,
        next.items.map((item) => item.check),
      );
    },
    [runChecks],
  );

  const close = useCallback(() => {
    runRef.current += 1;
    setView(null);
  }, []);

  const rerun = useCallback(() => {
    const current = viewRef.current;
    if (current !== null) {
      open(current.printerName, current.paperKey);
    }
  }, [open]);

  const runFix = useCallback(
    async (current: DiagnosisView, check: DiagnosisCheckId, fix: DiagnosisFixId, admin: boolean) => {
      const run = runRef.current;
      update((latest) => withFixStarted(latest, fix));
      let outcome: FixOutcome;
      try {
        outcome = await window.api.applyDiagnosisFix({
          printerName: current.printerName,
          fix,
          admin,
          paperKey: current.paperKey,
        });
      } catch (error) {
        reportError('修复打印机问题', error);
        outcome = { status: 'failed', message: `没做成：${INTERNAL_ERROR}` };
      }
      if (runRef.current !== run) {
        return;
      }
      update((latest) => withFixOutcome(latest, check, fix, outcome));
      if (outcome.status === 'done' || outcome.status === 'rolled-back') {
        const checks = checksAfterFix(current, fix);
        update((latest) => withRequeued(latest, checks));
        await runChecks(run, current.printerName, current.paperKey, checks);
      }
    },
    [runChecks, update],
  );

  const applyFix = useCallback(
    (check: DiagnosisCheckId, offer: FixOffer) => {
      const current = viewRef.current;
      if (current === null || current.busyFix !== null) {
        return;
      }
      if (offer.id === CHANGE_COMMAND_SET) {
        update(withCommandSetPicker);
        return;
      }
      void runFix(current, check, offer.id, offer.admin);
    },
    [runFix, update],
  );

  const answerFeed = useCallback((works: boolean) => update((current) => withFeedAnswer(current, works)), [update]);

  return { view, open, close, rerun, applyFix, answerFeed };
}
```

- [ ] **Step 2: 面板**

```tsx
// src/renderer/src/components/DiagnosisPanel.tsx
import type { ReactNode } from 'react';
import { CHECK_TITLES, type DiagnosisCheckId, type DiagnosisFixId, type FixOffer } from '../../../shared/diagnosis';
import {
  type DiagnosisItem,
  type DiagnosisView,
  diagnosisSummary,
  itemBadge,
  shownOffers,
  shownVerdict,
} from '../lib/diagnosis-view';

interface DiagnosisPanelProps {
  view: DiagnosisView;
  /** 面板名字里的打印机显示名，或「后台打印服务」。 */
  title: string;
  onRerun: () => void;
  onClose: () => void;
  onFix: (check: DiagnosisCheckId, offer: FixOffer) => void;
  onAnswerFeed: (works: boolean) => void;
  /** 「打测试页」；只查后台打印服务时没有打印机，为 null。 */
  onTestPrint: (() => void) | null;
  /** 「改指令集」时显示的指令集下拉（5a 的控件）；没有时为 null。 */
  commandSetPicker: ReactNode;
}

/** 一台打印机的诊断：逐项结论、下一步、修复按钮。只管展示，操作经回调交给视图模型。 */
export function DiagnosisPanel({
  view,
  title,
  onRerun,
  onClose,
  onFix,
  onAnswerFeed,
  onTestPrint,
  commandSetPicker,
}: DiagnosisPanelProps) {
  return (
    <section className="diagnosis" aria-label={`诊断：${title}`}>
      <div className="diagnosis__header">
        <p className="diagnosis__summary" role="status">
          {diagnosisSummary(view)}
        </p>
        <button type="button" className="button button--small" onClick={onRerun} disabled={view.busyFix !== null}>
          重新检查
        </button>
        {onTestPrint && (
          <button type="button" className="button button--small" onClick={onTestPrint}>
            打测试页
          </button>
        )}
        <button type="button" className="button button--small button--quiet" onClick={onClose}>
          收起
        </button>
      </div>
      <ol className="diagnosis__list">
        {view.items.map((item) => (
          <DiagnosisRow
            key={item.check}
            item={item}
            busyFix={view.busyFix}
            onFix={onFix}
            onAnswerFeed={onAnswerFeed}
            commandSetPicker={commandSetPicker}
          />
        ))}
      </ol>
    </section>
  );
}

interface DiagnosisRowProps {
  item: DiagnosisItem;
  busyFix: DiagnosisFixId | null;
  onFix: (check: DiagnosisCheckId, offer: FixOffer) => void;
  onAnswerFeed: (works: boolean) => void;
  commandSetPicker: ReactNode;
}

function DiagnosisRow({ item, busyFix, onFix, onAnswerFeed, commandSetPicker }: DiagnosisRowProps) {
  const verdict = shownVerdict(item);
  const badge = itemBadge(item);
  const offers = shownOffers(item);
  const { outcome } = item;
  const isBadOutcome = outcome !== null && outcome.status !== 'done';
  return (
    <li className="diagnosis-item">
      <div className="diagnosis-item__head">
        <h4 className="diagnosis-item__title">{CHECK_TITLES[item.check]}</h4>
        <span className={`badge badge--${badge.tone}`}>{badge.text}</span>
      </div>
      {verdict && <p className="diagnosis-item__detail">{verdict.detail}</p>}
      {verdict?.nextStep && <p className="diagnosis-item__next">{verdict.nextStep}</p>}
      {item.feed === 'asking' && (
        <div className="diagnosis-item__question" role="group" aria-label="标签机走出空白标签了吗？">
          <span>标签机走出一张空白标签了吗？</span>
          <button type="button" className="button button--small" onClick={() => onAnswerFeed(true)}>
            走出来了
          </button>
          <button type="button" className="button button--small" onClick={() => onAnswerFeed(false)}>
            没反应
          </button>
        </div>
      )}
      {offers.length > 0 && (
        <div className="diagnosis-item__fixes">
          {offers.map((offer) => (
            <button
              key={offer.id}
              type="button"
              className="button button--small"
              disabled={busyFix !== null}
              onClick={() => onFix(item.check, offer)}
            >
              {busyFix === offer.id ? '正在处理…' : offer.label}
            </button>
          ))}
        </div>
      )}
      {item.isPickingCommandSet && commandSetPicker}
      {outcome && (
        <p
          className={`diagnosis-item__outcome${isBadOutcome ? ' diagnosis-item__outcome--error' : ''}`}
          role={isBadOutcome ? 'alert' : 'status'}
        >
          {outcome.message}
        </p>
      )}
    </li>
  );
}
```

- [ ] **Step 3: 打印机页**

`PrinterList.tsx`：

1. import 加 `import type { ReactNode } from 'react';`（和现有的 `useMemo, useState` 合成一行 `import { type ReactNode, useMemo, useState } from 'react';`）、`import { DiagnosisPanel } from './DiagnosisPanel';`、`import type { DiagnosisControls } from '../view-models/use-diagnosis';`。
2. `PrinterListProps` 末尾加：

```ts
  /** 「诊断」的状态和操作（view-models/use-diagnosis.ts）。 */
  diagnosis: DiagnosisControls;
  /** 「改指令集」时在诊断面板里显示的指令集下拉（5a 的控件）；没有时为 null。 */
  commandSetPicker: ((printerName: string) => ReactNode) | null;
```

并在函数参数的解构里加 `diagnosis, commandSetPicker`。

3. 打印机行里把单独的「测试页」按钮换成两个按钮放在一起（行是两列的网格，按钮占第二列）：

```tsx
              <span className="printer-row__actions">
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-expanded={diagnosis.view?.printerName === printer.name}
                  onClick={() => diagnosis.open(printer.name, expectedKey)}
                >
                  诊断
                </button>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => void runTest(printer.name, expectedKey ?? LABEL_PAPER_KEY)}
                >
                  测试页
                </button>
              </span>
```

4. 行里 `{testMessages[printer.name] && …}` 之前加：

```tsx
              {diagnosis.view?.printerName === printer.name && (
                <DiagnosisPanel
                  view={diagnosis.view}
                  title={printer.displayName}
                  onRerun={diagnosis.rerun}
                  onClose={diagnosis.close}
                  onFix={diagnosis.applyFix}
                  onAnswerFeed={diagnosis.answerFeed}
                  onTestPrint={() => void runTest(printer.name, expectedKey ?? LABEL_PAPER_KEY)}
                  commandSetPicker={commandSetPicker?.(printer.name) ?? null}
                />
              )}
```

5. 空列表那一段（`系统里没有打印机。…`）换成——后台打印服务停了时系统一台打印机都列不出来，这时给一个只查服务的入口：

```tsx
      {!isLoading && visible.length === 0 && (
        <p className="empty">
          {printers.length === 0
            ? '系统里没有打印机。先在 Windows「设置 › 打印机和扫描仪」里添加，再点刷新'
            : `没有名称包含「${query}」的打印机`}
        </p>
      )}
      {!isLoading && printers.length === 0 && (
        <div className="printer-empty-actions">
          <button type="button" className="button button--small" onClick={() => diagnosis.open(null, null)}>
            检查后台打印服务
          </button>
        </div>
      )}
      {diagnosis.view !== null && diagnosis.view.printerName === null && (
        <DiagnosisPanel
          view={diagnosis.view}
          title="后台打印服务"
          onRerun={diagnosis.rerun}
          onClose={diagnosis.close}
          onFix={diagnosis.applyFix}
          onAnswerFeed={diagnosis.answerFeed}
          onTestPrint={null}
          commandSetPicker={null}
        />
      )}
```

（空列表的说明里写死了 Windows 的菜单名，这是原有文字；macOS 上的说法按 `src/renderer/CLAUDE.md` 的平台约定由那里统一处理，不在本计划里改。）

6. `App.tsx`：import 加 `import { useDiagnosis } from './view-models/use-diagnosis';`；在 `const printerProfiles = usePrinterProfiles(…)` 之后加 `const diagnosis = useDiagnosis();`；`<PrinterList …>` 加两个属性：

```tsx
                diagnosis={diagnosis}
                commandSetPicker={commandSetPickerFor}
```

`commandSetPickerFor` 是 5a 打印机行里「指令集」下拉的同一个控件，按打印机名渲染：5a 把它做成独立组件（计划里叫 `CommandSetSelect`）时，在 App 里写 `const commandSetPickerFor = (name: string) => <CommandSetSelect printerName={name} … />;`，属性照 5a 在打印机行里的用法传；5a 把它直接写在 `PrinterList` 的行里时，把那段 JSX 抽成 `PrinterList` 内部的函数 `renderCommandSet(printerName)`，`commandSetPicker` 这个属性就不用加，面板直接用 `renderCommandSet(printer.name)`。两种都只是复用 5a 的控件，不新写指令集的逻辑。

7. `styles/app.css`：`.badge--error` 之后加两种标记，`.printer-row__message` 之后加面板样式：

```css
/* 诊断：通过 / 要注意 */
.badge--ok {
  background: var(--color-success);
  color: var(--color-paper);
}

.badge--warning {
  background: var(--color-warning);
  color: var(--color-paper);
}
```

```css
.printer-row__actions {
  display: flex;
  gap: var(--space-1);
}

.printer-empty-actions {
  padding: 0 var(--space-3) var(--space-2);
}

/* 诊断面板：打印机行下面展开，占满两列 */
.diagnosis {
  grid-column: 1 / -1;
  margin: 0 0 var(--space-2);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-paper);
}

.diagnosis__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-housing);
}

.diagnosis__summary {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--color-ink);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.diagnosis__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.diagnosis-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-housing);
}

.diagnosis-item:last-child {
  border-bottom: none;
}

.diagnosis-item__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.diagnosis-item__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.diagnosis-item__detail,
.diagnosis-item__next,
.diagnosis-item__outcome {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.diagnosis-item__next {
  color: var(--color-ink-soft);
}

.diagnosis-item__fixes,
.diagnosis-item__question {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}

.diagnosis-item__outcome--error {
  color: var(--color-error);
}
```

- [ ] **Step 4: 跑检查和现有 E2E**

Run: `bun run check` 然后 `bun run test:e2e -- e2e/printers.e2e.ts`
Expected: 通过（打印机行多了「诊断」按钮，现有用例按名字找「测试页」不受影响）。

- [ ] **Step 5: 开发版里看一眼**

Run: 在 Git Bash 里 `CDL_LABELFLASH_USER_DATA="$TEMP/lf-diag" CDL_LABELFLASH_FAKE_PRINTERS='[{"name":"标签机A","paper":{"widthMm":100,"heightMm":150,"dpi":203},"readiness":{"ready":true},"diagnosis":{"stuckJobs":{"ours":1,"others":1}}}]' bun run dev`
Expected: 配置中心「打印机」里把 60×40 分给标签机A，点「诊断」：六项依次出结果；队列一项有「清除本程序的任务」「清除全部任务（需要管理员权限）」「打开打印队列」（Windows）；驱动纸张一项能自动设置。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/view-models/use-diagnosis.ts src/renderer/src/components/DiagnosisPanel.tsx src/renderer/src/components/PrinterList.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(renderer): diagnosis panel on the printers page" -m "Each printer gets a Diagnose button that runs the checks one by one and shows each verdict with its next step and fix buttons; fixes recheck only what they touch. When the system lists no printers at all, a single button checks the print service." -m "$TRAILER"
```

---

### Task 16: E2E

**Files:**
- Modify: `e2e/support/app-helpers.ts`
- Create: `e2e/diagnosis.e2e.ts`

- [ ] **Step 1: 辅助函数**（`app-helpers.ts` 里 `fakePrints` 之后加）

```ts
/** 假打印机诊断弹过的「管理员确认」（见 src/main/diagnosis/fake-diagnosis.ts）。 */
export function fakeAdminPrompts(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as { e2eFakeDiagnosis?: { adminPrompts: string[] } }).e2eFakeDiagnosis?.adminPrompts ?? [],
  );
}
```

- [ ] **Step 2: 写 E2E**

```ts
// e2e/diagnosis.e2e.ts
import type { Locator, Page } from '@playwright/test';
import type { FakeDiagnosisSpec, FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakeAdminPrompts, openConfig } from './support/app-helpers';
import { expect, test } from './support/fixtures';

const PRINTER = '标签机A';

function labelPrinter(diagnosis: FakeDiagnosisSpec, overrides: Partial<FakePrinterSpec> = {}): FakePrinterSpec {
  return {
    name: PRINTER,
    paper: { widthMm: 60, heightMm: 40, dpi: 203 },
    readiness: { ready: true },
    diagnosis,
    ...overrides,
  };
}

/** 把 60×40 分给标签机A，打开配置中心「打印机」，点它的「诊断」，等六项查完。 */
async function openDiagnosis(page: Page): Promise<Locator> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': PRINTER } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await openConfig(page, '打印机');
  await page.locator('.printer-row', { hasText: PRINTER }).getByRole('button', { name: '诊断', exact: true }).click();
  const panel = page.getByRole('region', { name: `诊断：${PRINTER}` });
  await expect(panel.locator('.diagnosis__summary')).toContainText('查完了');
  return panel;
}

function item(panel: Locator, title: string): Locator {
  return panel.locator('.diagnosis-item', { hasText: title });
}

test('finds stuck jobs, clears ours first and the rest after the admin prompt', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [labelPrinter({ stuckJobs: { ours: 2, others: 1 } })] });
  const queue = item(await openDiagnosis(page), '打印队列');
  await expect(queue).toContainText(/有 3 个任务卡在队列里（最早的已经等了 \d+ 分钟），其中 2 个是本程序发的/);

  await queue.getByRole('button', { name: '清除本程序的任务' }).click();
  await expect(queue).toContainText('已请求取消本程序的 2 个任务');
  await expect(queue).toContainText('都不是本程序发的');
  expect(await fakeAdminPrompts(app)).toEqual([]);

  await queue.getByRole('button', { name: '清除全部任务（需要管理员权限）' }).click();
  await expect(queue).toContainText('队列是空的');
  expect(await fakeAdminPrompts(app)).toHaveLength(1);
});

test('changes nothing when the admin prompt is declined', async ({ electronApp }) => {
  const { page } = await electronApp.launch({
    fakePrinters: [labelPrinter({ stuckJobs: { ours: 0, others: 1 }, adminPrompt: 'decline' })],
  });
  const queue = item(await openDiagnosis(page), '打印队列');
  await queue.getByRole('button', { name: '清除全部任务（需要管理员权限）' }).click();
  await expect(queue.getByRole('alert')).toContainText('没有拿到管理员权限');
  await expect(queue).toContainText('有 1 个任务卡在队列里');
});

test('sets the driver paper to the paper the printer holds', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({
    fakePrinters: [labelPrinter({}, { paper: { widthMm: 100, heightMm: 150, dpi: 203 } })],
  });
  const paper = item(await openDiagnosis(page), '驱动纸张');
  await expect(paper).toContainText('驱动纸张是 100×150mm，它负责的是 60×40mm');
  await paper.getByRole('button', { name: /^自动设置驱动纸张/ }).click();
  await expect(paper).toContainText('驱动纸张 60×40mm，和它负责的 60×40mm 一致');
  // Windows 改驱动默认设置一定要管理员；macOS 先以当前用户改（假打印机直接改成）。
  expect(await fakeAdminPrompts(app)).toHaveLength(process.platform === 'win32' ? 1 : 0);
});

test('asks the operator whether a label came out after a feed', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [labelPrinter({})] });
  const commands = item(await openDiagnosis(page), '指令集');
  await expect(commands).toContainText('待确认');
  await commands.getByRole('button', { name: '走一张纸' }).click();
  const question = commands.getByRole('group', { name: '标签机走出空白标签了吗？' });
  await question.getByRole('button', { name: '没反应' }).click();
  await expect(commands).toContainText('标签机没有反应');
  await expect(commands).toContainText('有问题');
});

test('checks the print service when the system lists no printers', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [] });
  await openConfig(page, '打印机');
  await page.getByRole('button', { name: '检查后台打印服务' }).click();
  const panel = page.getByRole('region', { name: '诊断：后台打印服务' });
  await expect(panel.locator('.diagnosis-item')).toHaveCount(1);
  await expect(panel.locator('.diagnosis-item')).toContainText('通过');
});
```

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e -- e2e/diagnosis.e2e.ts`
Expected: 5 个用例通过（构建版里诊断的 IPC、假打印机诊断、面板都接上了）。再跑一次全部 `bun run test:e2e`。

- [ ] **Step 4: 提交**

```bash
git add e2e/support/app-helpers.ts e2e/diagnosis.e2e.ts
git commit -m "test(e2e): diagnose a fake printer and apply fixes" -m "Covers clearing our stuck jobs without admin rights and the rest behind an admin prompt, a declined prompt that changes nothing, setting the driver paper, the feed question for the one-way command check, and the print-service check when no printer is listed." -m "$TRAILER"
```

---

### Task 17: 视觉验收 V84–V86

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（第 8.2 节的表）

- [ ] **Step 1: 加验收项**

文件顶部 `import type { ElectronApplication, Page } from '@playwright/test';` 改为 `import type { ElectronApplication, Locator, Page } from '@playwright/test';`；`FakePrinterSpec` 的 import 改为 `import type { FakeDiagnosisSpec, FakePrinterSpec } from '../../src/main/printing/fake-printers';`。在 `PAPER_PRINTERS` 之后加：

```ts
/** V84–V86：一台 60×40 的假标签机，诊断的各项按需要设成好的或坏的。 */
const DIAGNOSIS_PRINTER = '标签机A';

function diagnosisPrinters(diagnosis: FakeDiagnosisSpec, overrides: Partial<FakePrinterSpec> = {}): FakePrinterSpec[] {
  return [
    {
      name: DIAGNOSIS_PRINTER,
      paper: { widthMm: 60, heightMm: 40, dpi: 203 },
      readiness: { ready: true },
      diagnosis,
      ...overrides,
    },
  ];
}

/** 把 60×40 分给标签机A，打开「打印机」页，点「诊断」，等全部查完。 */
async function openDiagnosisPanel(page: Page): Promise<Locator> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': DIAGNOSIS_PRINTER } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await openConfig(page, '打印机');
  await page
    .locator('.printer-row', { hasText: DIAGNOSIS_PRINTER })
    .getByRole('button', { name: '诊断', exact: true })
    .click();
  const panel = page.getByRole('region', { name: `诊断：${DIAGNOSIS_PRINTER}` });
  await expect(panel.locator('.diagnosis__summary')).toContainText('查完了');
  return panel;
}
```

在 `ITEMS` 数组里、当时最后一项之后加：

```ts
  {
    id: 'V84',
    title: '打印机 · 诊断 · 全部通过',
    points:
      '打印机行右侧「诊断」「测试页」并排、不换行；面板在行下面展开、占满整行；顶部「查完了：没发现问题，1 项待确认」和「重新检查」「打测试页」「收起」一行排开；六项依次是后台打印服务、打印机和驱动状态、USB 连接、打印队列、驱动纸张、指令集，标记分别是绿「通过」和橙「待确认」；指令集一项有「走一张纸」「纸张校准」「改指令集」；1024 宽时文字折行、不溢出',
    launch: { fakePrinters: diagnosisPrinters({}) },
    setup: async ({ page }) => {
      await openDiagnosisPanel(page);
    },
  },
  {
    id: 'V85',
    title: '打印机 · 诊断 · 发现问题',
    points:
      '红「有问题」的几项：驱动报告缺纸（下一步「装好标签纸…」、按钮「打开打印首选项」）、USB 没连上（下一步说换线换口）、队列卡住 3 个任务其中 1 个是本程序发的（「清除本程序的任务」「清除全部任务（需要管理员权限）」，Windows 上还有「打开打印队列」）、驱动纸张 100×150mm 不是 60×40mm（「自动设置驱动纸张（需要管理员权限）」，macOS 上没有括号）；按钮多时换行、和文字左对齐；顶部「查完了：4 项有问题，1 项待确认」',
    launch: {
      fakePrinters: diagnosisPrinters(
        { usb: 'disconnected', stuckJobs: { ours: 1, others: 2 } },
        { paper: { widthMm: 100, heightMm: 150, dpi: 203 }, readiness: { ready: false, detail: '缺纸', issue: 'paperOut' } },
      ),
    },
    setup: async ({ page }) => {
      await openDiagnosisPanel(page);
    },
  },
  {
    id: 'V86',
    title: '打印机 · 诊断 · 修复之后',
    points:
      '队列一项下面绿色说明「已请求取消本程序的 1 个任务」，随后结论变成「…都不是本程序发的」；点了管理员按钮又拒绝后，红色提示「没有拿到管理员权限…」（读屏按 alert 念）；指令集一项问「标签机走出一张空白标签了吗？」并点了「没反应」：变红「有问题」，下面出现指令集下拉（5a 的控件）；提示不遮挡按钮',
    launch: { fakePrinters: diagnosisPrinters({ stuckJobs: { ours: 1, others: 1 }, adminPrompt: 'decline' }) },
    setup: async ({ page }) => {
      const panel = await openDiagnosisPanel(page);
      const queue = panel.locator('.diagnosis-item', { hasText: '打印队列' });
      await queue.getByRole('button', { name: '清除本程序的任务' }).click();
      await expect(queue).toContainText('都不是本程序发的');
      await queue.getByRole('button', { name: '清除全部任务（需要管理员权限）' }).click();
      await expect(queue.getByRole('alert')).toContainText('没有拿到管理员权限');
      const commands = panel.locator('.diagnosis-item', { hasText: '指令集' });
      await commands.getByRole('button', { name: '走一张纸' }).click();
      await commands.getByRole('button', { name: '没反应' }).click();
      await expect(commands).toContainText('标签机没有反应');
    },
  },
```

文件开头的说明注释里列编号段的那句加上「诊断是 V84–V86」。

（V86 第二步「清除全部任务」被拒，界面上那一项先显示「已请求取消…」后被新的结果替换成拒绝提示——每项只显示最近一次修复的结果，这是设计，截图里看到的是拒绝提示。）

- [ ] **Step 2: 设计文档的验收表**

`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 第 8.2 节表格的最后一行之后加：

```
| V84 | 打印机 · 诊断 · 全部通过 | 「诊断」「测试页」并排；面板在行下面占满整行；顶部汇总和三个按钮一行；六项的标记（通过 / 待确认）；指令集的三个按钮；1024 宽不溢出 |
| V85 | 打印机 · 诊断 · 发现问题 | 缺纸、USB 没连上、队列卡住、驱动纸张不对四项标红，各有下一步和按钮；管理员按钮写「（需要管理员权限）」；按钮多时换行对齐 |
| V86 | 打印机 · 诊断 · 修复之后 | 修复结果写在那一项下面（成功灰色、拒绝红色）；走纸之后的问题和「没反应」之后出现的指令集下拉；提示不遮挡按钮 |
```

- [ ] **Step 3: 跑视觉验收并逐张核对**

Run: `bunx playwright test --config e2e/visual/playwright.config.ts -g "V8[4-6]"`
Expected: V84–V86 在 1280 / 1024 / 1920 三种尺寸下通过自动检查；打开 `test-results/visual-acceptance/` 里的截图逐项核对 points（Windows 上再看 150% 缩放）。全部视觉验收跑一遍确认没有别的项受影响：`bunx playwright test --config e2e/visual/playwright.config.ts`。

- [ ] **Step 4: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items for printer diagnosis" -m "V84 to V86 cover a clean diagnosis, a printer with four problems and their fix buttons, and the panel after fixes, a declined admin prompt and the feed question, at 1280, 1024 and 1920 wide." -m "$TRAILER"
```

（如果 Step 3 为了对齐改了 `app.css`，一起 `git add`。）

---

### Task 18: 文档、真机验收、PR

**Files:**
- Modify: `README.md`、`docs/roadmap.md`、`docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 7.2 节）
- Modify: `CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`
- Modify: `docs/windows-acceptance.md`；`src/main/diagnosis/testing/fixtures/**`（换成真机输出）

- [ ] **Step 1: README**

「功能」列表里「打印测试页」相关那一条之后（没有就在「多台打印机」之后）加：

```
- **一键诊断修复**：配置中心「打印机」页每台打印机都有「诊断」，按顺序检查后台打印服务、打印机和驱动状态、USB 连接、打印队列、驱动纸张、指令集，每项说明查到了什么、下一步怎么做，并给出修复按钮：
  - 打开打印首选项；恢复被暂停的打印机（macOS）；打开打印队列（Windows）；
  - 清除本程序卡在队列里的任务（不用管理员权限）、清除全部任务；
  - 重启后台打印服务、自动把驱动纸张设成这台打印机负责的纸（设置后回读，不对就恢复原来的）；
  - 走一张纸确认指令集能通信、纸张校准、打测试页。
  - 要管理员权限的按钮都写着「（需要管理员权限）」，只有点了才会弹系统的确认框（Windows 的 UAC、macOS 的管理员密码框）。
  - 系统里一台打印机都列不出来时，打印机页有「检查后台打印服务」。
```

- [ ] **Step 2: 路线图**

`docs/roadmap.md` 状态表：

- 「打印任务跟踪：发出任务后用 `Get-PrintJob` 跟踪…」一行状态改为：「部分完成：诊断里读队列、认出本程序卡住的任务（`feature/printer-diagnosis`）；发出后自动跟踪仍待确认」。
- 「USB 在位检测…」一行状态改为：「诊断里按端口找 USB 设备（Windows `Get-PnpDevice`、macOS `system_profiler`），给出换线换口指引（`feature/printer-diagnosis`）；后台持续检测仍待确认」。
- 「自动设置驱动纸张…」一行改为：「自动设置驱动纸张：按这台打印机负责的纸挑驱动的纸张选项（没有就用自定义尺寸），管理员权限下写进默认设置、回读校验，失败回滚。Windows 用 PrintTicket（.NET `System.Printing`，提权的 PowerShell），macOS 用 `lpadmin -o media-default`；没有新增原生模块」，状态「开发完成（`feature/printer-diagnosis`），随 2.0.0 发布；真机验收见 `docs/windows-acceptance.md`」。
- 「离线原因指引…」「系统打印队列：查看、暂停、清空…」「一键修复：清队列、打测试页、确认出纸（重启 spooler 需要管理员权限，不做）」三行合并为一行：

```
| 一键诊断修复：后台打印服务、驱动状态（按问题给出处理步骤）、USB 连接、打印队列（清本程序的 / 清全部）、驱动纸张（自动设置）、指令集（走纸确认），外加纸张校准、测试页；管理员权限只在点了按钮时弹（2026-10-01 设计改为可以重启后台打印服务） | 建议 | 开发完成（`feature/printer-diagnosis`），随 2.0.0 发布；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.2 节。Windows / macOS 上 E2E 和视觉验收 V84–V86 通过；真机验收待做（见计划 Task 18 Step 6） |
```

- 「原生能力的实现方式」一节第二段改为：「需要调用系统 API 写设置时，先用系统自带的托管接口：自动设置驱动纸张用 .NET 的 `System.Printing`（PrintTicket，在提权的 PowerShell 里），RAW 指令（5a）经常驻探测进程调 winspool，都不新增原生模块。确实没有托管接口可用时，再用 **C++ Node-API 原生模块**：」，后面的列表保留。

- [ ] **Step 3: 设计文档第 7.2 节**（表格之后加）

```
- **实现时定下的细节**（2026-10-02）：
  - 检查顺序把「后台打印服务」放第一：它停了，系统列不出打印机、读不到队列，后面几项的「查不到」才说得清原因。系统一台打印机都列不出来时，打印机页只给「检查后台打印服务」。
  - 结论只说程序确知的事：驱动没报问题写「驱动没有报告问题」；取消任务写「已请求取消」，是否清掉由随后的重新检查说。
  - 「本程序的任务」：提交人是当前用户，且提交时间落在本程序某次把任务交给驱动（或 5a 的 RAW 下发）的时间段里（前后各 2 秒）；账本只在内存里，最多 500 条、保留一天。任务超过 1 分钟没打完、或驱动报错 / 暂停 / 缺纸，算卡住。
  - 管理员权限：Windows 上重启服务、清除全部任务、设置驱动纸张一定要；macOS 上重启打印系统、清除全部任务一定要，恢复打印机、设置纸张先以当前用户做，CUPS 拒绝时按钮换成「…（需要管理员权限）」。Windows 沿用防火墙的提权方式（提权脚本只信 `$PSHOME` 的模块、只用 .NET 系统程序集和系统目录的 `sc.exe`）；macOS 用 `osascript` 的 `do shell script … with administrator privileges`（命令和提示经 argv 传入、每个参数单引号转义），因为没有开发者签名用不了特权助手。
  - 自动设置驱动纸张：先不提权读驱动支持的纸张，挑不出来（没有这种纸、也不能自定义）就不弹确认、直接说明。Windows 把 PrintTicket 增量合进默认设置和当前账户的设置，驱动校验后的尺寸不对就不改，写进去回读不对就恢复；macOS `lpadmin -o media-default=`，回读不对就设回原来的。
  - 指令集一项是半手动的：指令单向，程序点「走一张纸」后问操作员「走出一张空白标签了吗」，没反应就打开指令集下拉。
  - 「重新安装驱动」等 7.3（5c）合并后才出现。
```

- [ ] **Step 4: CLAUDE.md**

根目录 `CLAUDE.md` 平台表在「打印机状态检测与异常通知」一行之后加：

```
| 打印机诊断修复 | ✅ 探测进程查服务、状态、USB（PnP）、队列；修复经一次性 / 提权的 PowerShell（UAC） | ✅（未在 Mac 上验证）`lpstat`、`ipptool`、`system_profiler`；改 CUPS 先以当前用户，被拒再经 `osascript` 要管理员密码 |
```

`src/core/CLAUDE.md` 模块表在 `api/` 一行之后加：

```
| `diagnosis/` | 打印机诊断的纯逻辑：`diagnosis-model.ts`（两个平台统一的「事实」、动作结果、上限）、`submitted-jobs.ts`（本程序交给打印队列的时间段，认「本程序的任务」）、`queue-summary.ts`（卡住的任务）、`paper-choice.ts`（挑驱动纸张选项 / PWG 纸张名）、`fixes.ts`（每个平台每个修复要不要管理员、按钮和结果文字）、`verdicts.ts`（事实 → 结论、下一步、按钮） |
```

`src/main/CLAUDE.md`：

1. 「可测试的写法」的例子列表加一行：`- \`diagnosis/\` 除了 \`create-diagnosis-system.ts\`（接上真实进程和文件）都不 import electron`。
2. 「其他子系统」表之后加一节：

```
## 诊断（`diagnosis/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.2 节。

- **分层**：系统命令的输出由 `windows-facts.ts`、`mac-facts.ts` 解析成 core 的「事实」，结论在 core 的 `verdicts.ts`；`windows-diagnosis.ts`、`mac-diagnosis.ts`、`fake-diagnosis.ts` 实现同一个 `DiagnosisSystem`，依赖由构造参数传入；样本在 `testing/fixtures/{windows,mac}/`，按原样保存。
- **`diagnosis-station.ts`**：打印机名不在系统列表里的，检查只说「已经没有这台了」，修复直接拒绝；修复按 core 的管理员策略核对，同一时间只做一个；检查和修复都写日志，「查不到」的英文原因也写。
- **Windows**：查询走常驻探测进程（`spooler`、`printer`、`usb`、`jobs`、`paper-options`，回答一行 JSON，长度有上限）；取消本程序的任务用一次性 PowerShell；要管理员的用 `windows-powershell.ts`（防火墙的做法：外层 `Start-Process -Verb RunAs`，内层 Base64，确认框没成退出 1223），提权脚本第一行把 `PSModulePath` 收紧到 `$PSHOME`，只用 .NET 系统程序集和 `[Environment]::SystemDirectory` 下的 `sc.exe`，结果靠退出码带回（`windows-scripts.ts` 的 `SCRIPT_EXIT`）。
- **macOS**：`command-runner.ts` 跑命令（参数数组、英文环境、关 stdin、独立会话——CUPS 要密码时不会去终端上等）；改 CUPS 的先以当前用户做，`Forbidden` 时返回 needs-admin，操作员点管理员按钮后经 `osascript … with administrator privileges`（命令、提示经 argv，`shellCommand` 逐个单引号转义）。Get-Jobs 用自己的 ipptool 测试文件（`CUPS_GET_JOBS_TEST`），用时写进临时目录、用完删掉。
- **账本**：`ElectronDriverAdapter` 和 5a 的 RAW 下发在任务进了系统队列后 `SubmittedJobs.record`，只在内存里。
- **接缝**：5a（指令集、走纸、校准）和 5c（重装驱动）只经 `seams.ts` 的两个接口，`index.ts` 里接上；5c 合并前 `drivers` 是 null，按钮不出现。
```

3. 「平台差异」表加一行：

```
| `diagnosis/` | 探测进程的诊断查询；提权 PowerShell（UAC） | `lpstat`、`ipptool`、`system_profiler`；`osascript` 要管理员密码 |
```

`src/renderer/CLAUDE.md`「测试与验收」的 E2E 一条括号里加「，打印机诊断在 `diagnosis.e2e.ts`」；「扫码相关」的「不能打印的界面」一条末尾加「诊断面板的「走一张纸」「打测试页」也是操作员明确点的按钮」。

- [ ] **Step 5: `bun run check` 后提交文档**

```bash
git add README.md docs/roadmap.md docs/superpowers/specs/2026-10-01-feature-parity-design.md CLAUDE.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs: describe one-click printer diagnosis" -m "README, roadmap rows for queue tracking, USB presence, driver paper and repair merged into the diagnosis feature, the decisions made while building it, and where the diagnosis code lives in each layer." -m "$TRAILER"
```

- [ ] **Step 6: 真机验收（合并前，人工）**

Windows（接一台热敏标签机，USB）：

1. 用开发版（`bun run dev`）诊断一次，打开日志里 `[diagnosis]` 的几行；在 PowerShell 里照 `PROBE_SCRIPT` 的五段手工跑一遍（打印机名换成真的），把输出替换进 `src/main/diagnosis/testing/fixtures/windows/` 对应的样本（保留文件名；装了多台打印机的电脑多抓一份），`bun test src/main/diagnosis` 必须仍然通过——不通过就改解析，不改样本迁就解析。重点核对：`USBPRINT\…` 的实例 ID 确实以 `&USB001` 这样的端口名结尾；`Get-PnpDevice` 的对象有 `Present`；`SubmittedTime` 换算的毫秒和日志时间对得上；`paper-options` 能列出驱动的标签纸张和 `custom`。
2. 拔掉 USB 打几张，再诊断：USB 一项「没连上」，队列一项认出这几张是本程序的；「清除本程序的任务」不弹确认就清掉；再用 Word 往这台发一份，「清除全部任务」弹一次 UAC，点「否」什么都不变，点「是」清空。
3. 在「服务」里停掉 Print Spooler：打印机页变空、出现「检查后台打印服务」，点它再点「重启后台打印服务」，UAC 之后服务起来、打印机回来。再把它设成「禁用」重复一次。
4. 把驱动默认纸张改成 100×150，诊断后点「自动设置驱动纸张」：UAC 之后驱动纸张一项变成一致；打开「打印首选项」看纸张确实改了；打一张 60×40 标签确认不再缩放、跳纸。再找一种驱动不接受的尺寸，确认显示「驱动不接受这个尺寸」或「已恢复原来的设置」且设置没变。
5. 指令集：TSPL 机型点「走一张纸」出一张空白标签；故意改成 ZPL 再点，标签机没反应，按「没反应」后出现指令集下拉。
6. 150% 缩放下看面板（V84–V86 的样子）。
7. 结果写进 `docs/windows-acceptance.md`（新一节「打印机诊断修复」：机型只写「热敏标签机」，写清哪一步通过、哪一步有出入）。

macOS（接一台热敏标签机，USB；一个管理员账户、一个普通账户各试一次）：

1. 抓 `lpstat -r`、`lpstat -v <队列>`、`ipptool -tv ipp://localhost/printers/<队列> get-printer-attributes.test`、`system_profiler -json SPUSBDataType SPUSBHostDataType`、自己的 Get-Jobs 测试的输出，替换 `fixtures/mac/` 的样本（尤其是 macOS 15 的 `SPUSBHostDataType` 键名、`printer-state-reasons` 在暂停 / 缺纸 / 拔线时的值、`lpstat` 在中文系统加了 `LANG=en_US.UTF-8` 后是不是英文），`bun test src/main/diagnosis` 必须仍然通过。
2. 在「打印机与扫描仪」里暂停这台：后台打印服务一项「被暂停了」；管理员账户点「恢复这台打印机」不要密码就恢复；普通账户点了之后换成「恢复这台打印机（需要管理员权限）」，再点弹管理员密码框，取消时提示「没有拿到管理员权限」。
3. 「清除全部任务」「重启打印系统」都弹密码框、提示文字写着「CDL-云签速印 要…」。
4. 默认纸张改成 4×6 英寸后点「自动设置驱动纸张」：`lpadmin -o media-default=` 之后 `media-col-default` 是否跟着变成 60×40（`ipptool` 回读）。**如果不跟着变**：改用 PPD 的 `PageSize`——`lpoptions -p <队列> -l` 列出 `PageSize/…: w170h113 *w288h432 …`，在 `paper-choice.ts` 加 `choosePpdPageSize`（按 `w<宽点>h<高点>`，1 点 = 1/72 英寸，差 1mm 内）、`mac-diagnosis.ts` 的 `setDriverPaper` 改设 `-o PageSize=<名字>`，回读和回滚的流程不变，样本和测试照 Task 3、Task 9 的写法补上；同时改设计文档第 7.2 节那一条。
5. 结果记进 `docs/roadmap.md` 的 macOS 适配一行（「诊断修复已在 Mac 上验证」或写明哪一步没过）。

替换样本、按真机改了解析或文档的，单独提交：

```bash
git add src/main/diagnosis docs/windows-acceptance.md docs/roadmap.md
git commit -m "test(diagnosis): replace samples with output captured on real machines" -m "Parsers now run against what PowerShell, CUPS and system_profiler actually print with a thermal label printer attached; acceptance results are recorded." -m "$TRAILER"
```

- [ ] **Step 7: 推送，开 PR**

```bash
git push -u origin feature/printer-diagnosis
gh pr create --base master --title "feat: one-click printer diagnosis (sub-project 5b)" --body "<中文说明：做了什么、为什么；管理员权限只在点按钮时弹；验证（单元测试、E2E、视觉验收 V84–V86、Windows / macOS 真机验收各做了哪几步）；只在一个平台上验证过的写明；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并。

---

## Self-Review 记录

- **设计覆盖（第 7.2 节）**：系统里有这台打印机、驱动报告的状态 → Task 5（`printerVerdict`）、6、8、11（不在列表里的说「已经没有这台了」）；修复「打开驱动设置」→ `open-preferences`，「重新安装驱动（7.3）」→ `DriverReinstallSeam`（5c 前为 null，按钮不出现）。USB 在位（`Get-PnpDevice`、`system_profiler`）→ Task 6、8，修复「换线、换 USB 口」→ `usbVerdict` 的下一步。后台打印服务 → Task 5、6、7、8，重启（Windows 一次 UAC；macOS 暂停的打印机 `cupsenable` + `cupsaccept`，先当前用户、被拒才要管理员；cupsd 没跑时 `launchctl kickstart` 要管理员）。卡住的任务 → Task 2（账本、归类）、6、8，清除本程序的（不要管理员）/ 全部（管理员）→ Task 7、9、11。驱动纸张一致 → Task 3、5，自动设置（路线图里的那项；管理员；失败回滚）→ Task 7、9，真机步骤 Task 18。指令集能通信 → Task 5、14（走纸后问操作员）、Task 15（改指令集用 5a 的下拉）。纸张校准、打测试页 → `calibrate` 修复和面板的「打测试页」。检查是纯逻辑、每个平台分别测 → Task 2–8 的单元测试和两个平台的样本。第 9 节（不可信输入有上限、管理员只在点按钮时弹、失败给中文和下一步、错误进日志）→ Task 6（回答长度、条数）、8（输出上限、超时）、4 和 11（管理员策略在主进程核对）、11（日志）。第 11 节（具名导出、interface、无 `!`、最小权限 IPC、快速失败、小步提交）→ 全部任务；IPC 只收检查项和修复项的枚举（Task 13）。
- **和用户要求逐条核对**：只对系统列表里的打印机执行（Task 11 `isKnownPrinter`，测试覆盖）；管理员动作必须明确点击（策略在主进程核对，`always` 的修复按钮文字带「（需要管理员权限）」，假打印机记录弹窗次数、E2E 断言没点就没弹）；只说程序确知的事（结论和结果文字的测试）；E2E 的假模式（Task 10）；E2E 运行诊断、有失败项、执行修复（Task 16）；视觉验收 V84–V86（Task 17）；macOS 管理员用法和理由（Task 8 开头）；路线图里那一项的处理（Task 18 Step 2：从「C++ 原生模块」改为 PrintTicket，写明原因）。
- **没有占位**：5a 的名字（`labelCommandStation.effectiveCommandSet / runAction`、指令集下拉组件）是并行计划里的，Task 13 Step 5 和 Task 15 Step 3 给出两种接法和返回值转换，只碰这几行；Task 18 Step 6 第 4 条是「真机上 `media-default` 不生效时」的分支，改法写明（PPD `PageSize`）。其余每一步给出完整代码和命令。
- **类型一致**：`DiagnosisCheckId` / `DiagnosisFixId` / `FixOffer` / `CheckVerdict` / `FixRequest` / `FixOutcome`（Task 1）贯穿 core、main、renderer；`DiagnosisFixRequest`（Task 2，`paper: PaperSize | null`）由 `requireDiagnosisFixRequest`（Task 13）从 `FixRequest`（`paperKey`）转换；`ActionResult`（Task 2）由 `DiagnosisSystem`（Task 9）、两个接缝（Task 10）返回，经 `fixOutcome`（Task 4）变成 `FixOutcome`；`PrintTicketPaper`（Task 3）由 `parsePaperOptionsReply`（Task 6）→ `choosePrintTicketPaper` → `setDriverPaperScript`（Task 7）；`ProbeCommand`（Task 6）用于 `WindowsDiagnosisDeps.query`（Task 9）；`SubmittedJobs`（Task 2）在 `FakeDiagnosis`（Task 10）、`DiagnosisStation`（Task 11）、`ElectronDriverAdapter`（Task 12）共用一个实例（`index.ts`）。
- **迁移**：不改数据库，没有新设置项。
- **命名限制**：样本和代码里没有品牌、型号、参考产品；`schemas.microsoft.com`、`www.w3.org` 是 PrintTicket / XML Schema 规定的命名空间名，写在常量注释里说明不是网络地址，不会访问；没有本项目的域名。
