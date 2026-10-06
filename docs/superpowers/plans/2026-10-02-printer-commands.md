# 标签机指令（子项目 5a：TSPL / ZPL / EPL）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配置中心「打印机」页每台打印机加「标签机指令」：选指令集（自动 / TSPL / ZPL / EPL / 不发指令；自动按驱动名认，5c 的在线识别表接进来后先查表），设浓度、速度、纸张（宽、高、间隙 / 黑标）、打印方向、出纸方式（撕纸 / 剥离），点「保存并发送」时把设置发给打印机一次（之后每次打印前不再发）；另有四个动作：纸张校准、走一张纸、打印自检页、恢复出厂设置（两次确认）。指令是单向的，界面只说「已发送到打印机」。

**Architecture:** core 里放纯逻辑：模型和每种指令集的范围（`printer-commands/command-model.ts`）、认指令集（`command-set.ts`：驱动名里写着的指令集字样 + 给 5c 留的 `CommandSetCatalog` 接口）、设置的校验（`sanitize-command-config.ts`：存储用宽松版，IPC 用严格版）、三种指令集各一个生成器（`tspl.ts`、`zpl.ts`、`epl.ts`，输出 ASCII 文字），和按指令集分派、按范围把关的 `printer-commands.ts`。主进程 `printing/raw-sender.ts` 把字节原样发给系统打印机：Windows 经已有的常驻 PowerShell 探测进程，第一次用时 `Add-Type` 编译一小段 C#，P/Invoke winspool（`OpenPrinterW` → `StartDocPrinterW`（数据类型 `RAW`）→ `StartPagePrinter` → `WritePrinter` → `EndPagePrinter` → `EndDocPrinter` → `ClosePrinter`），字节以 base64 走现有的行协议，单次 ≤ 4KB，Win32 错误码按「找不到 / 没权限 / 驱动不收 RAW / 其他」分类；macOS 用 `lp -d <队列> -o raw -t <任务名>`，字节写进标准输入（参数数组，不经过 shell）；其他平台返回「不支持」。驱动名：Windows 探测进程加 `driver` 查询（`Get-Printer` 的 `DriverName`），macOS 取 `ipptool` 输出里的 `printer-make-and-model`。`printing/printer-commands-station.ts`（不 import electron）编排：核对打印机在系统列表里 → 认指令集 → 生成 → 保存（设置表 `printerCommands` 这一项，**不加数据库迁移**）→ 发送。三个新 IPC 通道只给最小能力：读面板数据、保存并发送一份经严格校验的设置、执行四个动作之一；界面永远传不进任意字节。假打印机记下收到的指令文字，E2E 直接比对。

**Tech Stack:** TypeScript、Bun test、Electron 主进程、Windows PowerShell 5.1 + `Add-Type`（C# 5，P/Invoke winspool.drv）、macOS CUPS `lp`、React 19、Playwright E2E。不新增依赖，不新增原生模块。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.1 节（7.2 诊断、7.3 驱动安装是 5b、5c，另有计划），第 9、10、11 节。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **分支**：实施顺序是 1 设计器 → 3 批量 → 2 模板库 → 4 PDF → **5a 本计划** → 5b 诊断 → 5c 驱动 → 6a IPP。PDF（子项目 4）合进 master 之后，从 master 拉 `feature/printer-commands`。批量、PDF 都改过 `fake-printers.ts`（`printDelayMs` 等）：本计划对它的修改都是追加字段和方法，开工前先读当时的文件，按当时的样子加。
- **不加数据库迁移**：每台打印机的设置和纸张分配一样存在设置表（`settings`，key → JSON，`SqliteSettingsStore`），新的一项 `printerCommands`，读写都经 `sanitizeSettings`。开工时先核对设置仍是这种存法；如果已经变了，停下来问协调者。
- **视觉验收编号**：固定用 **V80–V83**，追加在 `ITEMS` 当时最后一项之后（批量 V60–V62、PDF V70–V72 之后）。
- **命名限制**：仓库里不写打印机品牌、型号、厂家网址；指令手册只按书名称呼（《TSPL/TSPL2 编程手册》《ZPL II 编程指南》《EPL2 编程手册》），不写出处网址。测试和假打印机的驱动名用通用写法（`Label Printer TSPL`、`Office Inkjet`）。打印机只叫「热敏标签机」。
- **用词**：指令是单向的：成功只说「已发送到打印机」（Windows 是进了后台打印队列，macOS 是交给了 CUPS），不说「设置成功」「已生效」。
- **不写打印记录**：指令不是标签，不经 `PrintService`、不进打印记录；每次发送（成功、失败）写一行日志。
- **安全底线**：只发给系统打印机列表里有的打印机（IPC 层 `requireKnownPrinter` 核对一次，station 发送前再核对一次）；字节只能是我们生成的 ASCII 指令（`asciiBytes` 把关），单次 ≤ `RAW_COMMAND_MAX_BYTES`（4KB，探测进程里再查一次）；打印机名和字节都只作为 base64 数据进 PowerShell，不拼进脚本；macOS 的 `lp` 用参数数组。

## 依据的指令（实现前逐条核对手册）

生成器只用下面这些指令。Task 3–5 的 Step 1 拿手册逐条核对「手册里的写法」和「取值」两列；手册和这里不一致时，以手册为准，先改这张表、常量和测试，再写实现。「核对重点」一列是写计划时把握不足、必须看原文的地方。

| 指令集 | 用途 | 我们发的 | 手册里的写法与取值 | 核对重点 |
|---|---|---|---|---|
| TSPL | 纸张大小 | `SIZE 60 mm,40 mm` | `SIZE m mm,n mm`（公制写法） | — |
| TSPL | 间隙纸 | `GAP 2 mm,0 mm` | `GAP m mm,n mm`，0 ≤ m ≤ 25.4mm；n 是偏移 | — |
| TSPL | 黑标纸 | `BLINE 3 mm,0 mm` | `BLINE m mm,n mm`，0 ≤ m ≤ 25.4mm；n 是黑标后多走的长度 | — |
| TSPL | 浓度 | `DENSITY 8` | `DENSITY n`，0–15 | — |
| TSPL | 速度 | `SPEED 4` | `SPEED n`，英寸/秒，可用值随机型（手册机型表） | 2–5 是否是桌面机普遍都有的值 |
| TSPL | 方向 | `DIRECTION 0` / `DIRECTION 1` | `DIRECTION n[,m]`，n 为 0 或 1（相差 180°） | 哪个是出厂方向：真机验收 |
| TSPL | 撕纸 / 剥离 | `SET PEEL OFF` + `SET TEAR ON`；`SET TEAR OFF` + `SET PEEL ON` | `SET TEAR ON/OFF`、`SET PEEL ON/OFF` | 剥离时关 TEAR 是否合适：真机验收 |
| TSPL | 校准 | `GAPDETECT` / `BLINEDETECT` | 不带参数时自动测 | — |
| TSPL | 走纸、自检、出厂 | `FORMFEED`、`SELFTEST`、`INITIALPRINTER` | 无参数 | `INITIALPRINTER` 是否所有 TSPL2 机型都有 |
| TSPL | 行尾 | CR LF | 手册约定 | — |
| ZPL | 浓度 | `~SD08` | `~SD##`，两位数 00–30（绝对值；`^MD` 是在当前值上加减 -30–30，不用） | — |
| ZPL | 纸宽、纸长 | `^PW480`、`^LL320` | `^PWa` 点数 ≥ 2；`^LLy` 1–32000 点 | — |
| ZPL | 纸型 | `^MNY` / `^MNM` | `^MNa`：Y 间隙（web sensing）、M 黑标（mark sensing） | — |
| ZPL | 速度 | `^PR4` | `^PRp`：1–14 英寸/秒随机型 | 桌面机 2–6 是否都有 |
| ZPL | 方向 | `^PON` / `^POI` | N 正常、I 旋转 180° | `^PO` 是否随 `^JUS` 保存（不保存则只对这一次格式有效）：真机验收 |
| ZPL | 出纸 | `^MMT` / `^MMP` | T 撕纸、P 剥离 | — |
| ZPL | 保存 | `^JUS` | 存当前设置；`^JUF` 载入出厂设置；`^JUN` 恢复网络设置（**不发**） | `^JUF` 之后是否需要 `^JUS` 才持久 |
| ZPL | 校准、走纸、自检 | `~JC`、`~PH`、`~WC` | `~JC` 测纸张并调传感器；`~PH` 走一张空白标签；`~WC` 打印配置标签 | — |
| ZPL | 分隔 | 一条一行（LF） | 指南示例都是一条一行 | — |
| EPL | 纸宽 | `q480` | `q p1`，点数 | — |
| EPL | 纸长和间隙 | `Q320,16` / `Q320,B24` | `Q p1,p2`：p2 间隙或黑标高度，203dpi 16–240 点、300dpi 18–240 点；黑标在 p2 前加 B | 范围原文 |
| EPL | 浓度 | `D8` | `D p1`，0–15 | — |
| EPL | 速度 | `S2` | `S p1`，档位，每档多快看机型表 | 1–4 是否各机型都有 |
| EPL | 方向 | `ZT` / `ZB` | ZT 从缓冲区顶部打（默认），ZB 从底部（旋转 180°） | — |
| EPL | 出纸 | （不发） | `O` 命令同时管切刀、热敏 / 热转印、剥离传感器 | — |
| EPL | 校准、走纸、自检 | `xa`、`N` + `P1`、`U` | `xa` 自动测纸（AutoSense）；`N` 清缓冲区、`P1` 打一张（空白）；`U` 打印配置 | `U` 的确切含义 |
| EPL | 出厂 | `^default` | 恢复出厂设置 | 手册里有没有；没有就把 `COMMAND_SET_LIMITS.epl.canFactoryReset` 改成 false，测试跟着改 |
| EPL | 行尾 | LF | 手册约定 | — |
| macOS | 原样发送 | `lp -d <队列> -o raw -t CDL-LabelFlash`，字节走标准输入 | CUPS 的 `-o raw` 不经过滤器 | 当前 macOS 的 CUPS 是否仍接受 `-o raw`：真机验收 |

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/core/printer-commands/command-model.ts` | 新建 | 类型、`COMMAND_SET_LIMITS`、`GAP_RANGE_MM`、`RAW_COMMAND_MAX_BYTES`、`mmToDots`、按打印机读写设置、`CommandSetCatalog` |
| `src/core/printer-commands/command-set.ts` | 新建 | 按驱动名猜、`detectCommandSet`（先查在线表）、`effectiveCommandSet` |
| `src/core/printer-commands/sanitize-command-config.ts` | 新建 | `sanitizeCommandConfig`（存储，宽松）、`parseCommandConfig`（IPC，严格） |
| `src/core/printer-commands/tspl.ts`、`zpl.ts`、`epl.ts` | 新建 | 每种指令集的设置和动作指令 |
| `src/core/printer-commands/printer-commands.ts` | 新建 | 按指令集分派；范围把关，给中文原因 |
| `src/shared/printer-commands.ts` | 新建 | IPC 用的结果和面板数据类型、发送失败的种类 |
| `src/shared/settings.ts` | 修改 | `printerCommands` 一项及其校验 |
| `src/main/printing/printer-probe-host.ts` | 修改 | 行协议加第三段；`driver`、`raw` 两个请求；C# RAW 辅助类；`sendRaw` |
| `src/main/printing/raw-sender.ts` | 新建 | `RawSender` 接口；Windows（探测进程）、macOS（`lp`）、不支持；错误码分类；`asciiBytes` |
| `src/main/printing/driver-paper.ts` | 修改 | 抽出 `readIppAttributes`，驱动名也用它 |
| `src/main/printing/printer-identity.ts` | 新建 | 驱动名：Windows 探测进程、macOS `printer-make-and-model` |
| `src/main/printing/fake-printers.ts` | 修改 | 驱动名、指令发送失败、记下收到的指令 |
| `src/main/printing/printer-commands-station.ts` | 新建 | `PrinterCommands`：面板数据、保存并发送、动作 |
| `src/shared/ipc-contract.ts`、`src/main/ipc-validators.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts` | 修改 | 三个新通道和接线 |
| `src/renderer/src/lib/printer-commands-view.ts` | 新建 | 面板的纯逻辑：表单、选项、文字 |
| `src/renderer/src/view-models/use-printer-commands.ts` | 新建 | 面板状态，调用 `window.api` |
| `src/renderer/src/components/PrinterCommandsPanel.tsx` | 新建 | 面板 |
| `src/renderer/src/components/PrinterList.tsx`、`App.tsx`、`styles/app.css` | 修改 | 每台打印机的「标签机指令」按钮、接线、样式 |
| `e2e/support/app-helpers.ts`、`e2e/printer-commands.e2e.ts` | 修改 / 新建 | `fakeRawJobs`、`clickSwitch`；E2E |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V80–V83 |
| `README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`、设计文档第 7.1 节、`CLAUDE.md`、`src/*/CLAUDE.md` | 修改 | 文档 |

---

### Task 1: 指令模型和认指令集

**Files:**
- Create: `src/core/printer-commands/command-model.ts`、`src/core/printer-commands/command-model.test.ts`
- Create: `src/core/printer-commands/command-set.ts`、`src/core/printer-commands/command-set.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/printer-commands/command-model.test.ts
import { describe, expect, test } from 'bun:test';
import {
  COMMAND_SET_LIMITS,
  configFor,
  DEFAULT_COMMAND_CONFIG,
  isPrinterAction,
  mmToDots,
  WIDEST_LIMITS,
  withPrinterConfig,
} from './command-model';

describe('mmToDots', () => {
  test('rounds millimetres to whole printer dots', () => {
    expect(mmToDots(60, 203)).toBe(480);
    expect(mmToDots(40, 203)).toBe(320);
    expect(mmToDots(2, 203)).toBe(16);
    expect(mmToDots(60, 300)).toBe(709);
  });
});

describe('WIDEST_LIMITS', () => {
  // 「自动」下保存的设置按最宽的范围校验：任何一种指令集能用的值都不能被它挡掉。
  test('covers every command set', () => {
    for (const limits of Object.values(COMMAND_SET_LIMITS)) {
      expect(WIDEST_LIMITS.density.min).toBeLessThanOrEqual(limits.density.min);
      expect(WIDEST_LIMITS.density.max).toBeGreaterThanOrEqual(limits.density.max);
      expect(limits.speeds.every((speed) => WIDEST_LIMITS.speeds.includes(speed))).toBe(true);
    }
  });
});

describe('per-printer configs', () => {
  test('reads only own entries and falls back to the default', () => {
    const configs = withPrinterConfig({}, '标签机A', { ...DEFAULT_COMMAND_CONFIG, commandSet: 'tspl' });
    expect(configFor(configs, '标签机A').commandSet).toBe('tspl');
    expect(configFor(configs, '__proto__')).toBe(DEFAULT_COMMAND_CONFIG);
  });

  test('replaces the entry of the same printer and keeps the others', () => {
    const first = withPrinterConfig({}, 'A', { ...DEFAULT_COMMAND_CONFIG, density: 1 });
    const second = withPrinterConfig(withPrinterConfig(first, 'B', DEFAULT_COMMAND_CONFIG), 'A', {
      ...DEFAULT_COMMAND_CONFIG,
      density: 2,
    });
    expect(Object.keys(second).sort()).toEqual(['A', 'B']);
    expect(second['A']?.density).toBe(2);
  });

  // 打印机名来自系统，可能是任何字：名为 __proto__ 的打印机只是一个普通的键，不能改到原型。
  test('keeps a printer named __proto__ as a plain own key', () => {
    const configs = withPrinterConfig({}, '__proto__', DEFAULT_COMMAND_CONFIG);
    expect(Object.getPrototypeOf(configs)).toBe(Object.prototype);
    expect(Object.hasOwn(configs, '__proto__')).toBe(true);
  });
});

describe('isPrinterAction', () => {
  test('accepts the four actions only', () => {
    expect(['calibrate', 'feed', 'selfTest', 'factoryReset'].every(isPrinterAction)).toBe(true);
    expect(isPrinterAction('raw')).toBe(false);
    expect(isPrinterAction(null)).toBe(false);
  });
});
```

```ts
// src/core/printer-commands/command-set.test.ts
import { describe, expect, test } from 'bun:test';
import { type CommandSetCatalog, NO_COMMAND_SET_CATALOG } from './command-model';
import { detectCommandSet, effectiveCommandSet, guessFromDriverName } from './command-set';

describe('guessFromDriverName', () => {
  test('finds the command set written in the driver name', () => {
    expect(guessFromDriverName('Label Printer TSPL')).toBe('tspl');
    expect(guessFromDriverName('Thermal 203dpi (TSPL2)')).toBe('tspl');
    expect(guessFromDriverName('Label ZPL II')).toBe('zpl');
    expect(guessFromDriverName('Label ZPL2')).toBe('zpl');
    expect(guessFromDriverName('label epl2 driver')).toBe('epl');
  });

  test('does not guess from names without a command set or with several', () => {
    expect(guessFromDriverName('Office Inkjet')).toBeNull();
    expect(guessFromDriverName('Generic / Text Only')).toBeNull();
    expect(guessFromDriverName('Label EPL/ZPL')).toBeNull();
    // 指令集的字样必须单独成词：型号里碰巧连着这几个字母不算。
    expect(guessFromDriverName('XZPL300')).toBeNull();
  });
});

describe('detectCommandSet', () => {
  test('prefers the online catalog over the driver name', async () => {
    const catalog: CommandSetCatalog = { commandSetFor: async () => 'zpl' };
    expect(await detectCommandSet({ driverName: 'Label TSPL', usb: null }, catalog)).toEqual({
      commandSet: 'zpl',
      source: 'catalog',
    });
  });

  test('falls back to the driver name, then to nothing', async () => {
    expect(await detectCommandSet({ driverName: 'Label TSPL', usb: null }, NO_COMMAND_SET_CATALOG)).toEqual({
      commandSet: 'tspl',
      source: 'driver-name',
    });
    expect(await detectCommandSet({ driverName: 'Office Inkjet', usb: null }, NO_COMMAND_SET_CATALOG)).toBeNull();
    expect(await detectCommandSet({ driverName: null, usb: null }, NO_COMMAND_SET_CATALOG)).toBeNull();
  });
});

describe('effectiveCommandSet', () => {
  test('uses the manual choice, the detected set for 自动, and nothing for 不发指令', () => {
    const detected = { commandSet: 'tspl', source: 'driver-name' } as const;
    expect(effectiveCommandSet('epl', detected)).toBe('epl');
    expect(effectiveCommandSet('auto', detected)).toBe('tspl');
    expect(effectiveCommandSet('auto', null)).toBeNull();
    expect(effectiveCommandSet('none', detected)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/printer-commands`
Expected: FAIL，`Cannot find module './command-model'`。

- [ ] **Step 3: 实现**

```ts
// src/core/printer-commands/command-model.ts

/**
 * 标签机指令的模型。程序只发自己生成的设置和动作（浓度、速度、纸张、校准……），标签内容仍经驱动打印。
 * 指令是单向的：发出去以后程序不知道打印机有没有照做，界面只说「已发送到打印机」。
 */

/** 热敏标签机常见的三种指令集。 */
export const COMMAND_SETS = ['tspl', 'zpl', 'epl'] as const;
export type CommandSet = (typeof COMMAND_SETS)[number];

/** 界面和提示里的名字。 */
export const COMMAND_SET_NAMES: Readonly<Record<CommandSet, string>> = { tspl: 'TSPL', zpl: 'ZPL', epl: 'EPL' };

/** 每台打印机选的指令集：自动（默认）、指定一种，或不发指令（只经驱动打印）。 */
export const COMMAND_SET_CHOICES = ['auto', 'tspl', 'zpl', 'epl', 'none'] as const;
export type CommandSetChoice = (typeof COMMAND_SET_CHOICES)[number];

/** 打印机动作：纸张校准（自动测间隙或黑标）、走一张纸、打印自检页、恢复出厂设置。 */
export const PRINTER_ACTIONS = ['calibrate', 'feed', 'selfTest', 'factoryReset'] as const;
export type PrinterAction = (typeof PRINTER_ACTIONS)[number];

/** 纸张怎么分张：间隙纸（两张之间有空隙）或黑标纸（背面印黑条）。 */
export const MEDIA_SENSINGS = ['gap', 'mark'] as const;
export type MediaSensing = (typeof MEDIA_SENSINGS)[number];

/** 打印方向：正常，或旋转 180°。 */
export const PRINT_ORIENTATIONS = ['normal', 'rotated'] as const;
export type PrintOrientation = (typeof PRINT_ORIENTATIONS)[number];

/** 出纸方式：撕纸（停在撕纸口）或剥离（剥好底纸再递出，打印机要装剥离器）。 */
export const FINISH_MODES = ['tear', 'peel'] as const;
export type FinishMode = (typeof FINISH_MODES)[number];

/** 纸张：宽高（mm，和模板纸张同一范围）、分张方式、间隙或黑标的高度（mm）。 */
export interface MediaSetup {
  widthMm: number;
  heightMm: number;
  sensing: MediaSensing;
  gapMm: number;
}

/**
 * 一台打印机的指令设置。每一项为 null 都表示「不改」：这一项不发，打印机保持原来的设置；
 * 只发操作员明确设了的项，不会把没碰过的设置改成程序的默认值。
 */
export interface PrinterCommandConfig {
  commandSet: CommandSetChoice;
  density: number | null;
  speed: number | null;
  media: MediaSetup | null;
  orientation: PrintOrientation | null;
  finish: FinishMode | null;
  /** ZPL、EPL 按打印点下发宽高：用这个分辨率换算；null = 按驱动报告的（读不到按 203dpi）。 */
  dpi: number | null;
}

export const DEFAULT_COMMAND_CONFIG: PrinterCommandConfig = {
  commandSet: 'auto',
  density: null,
  speed: null,
  media: null,
  orientation: null,
  finish: null,
  dpi: null,
};

/** 一种指令集能设的范围。 */
export interface CommandSetLimits {
  density: { min: number; max: number };
  /** 能选的速度：TSPL、ZPL 是英寸/秒，EPL 是档位。 */
  speeds: readonly number[];
  canSetFinish: boolean;
  canFactoryReset: boolean;
  /** 宽高按打印点下发（要分辨率）。 */
  usesDots: boolean;
}

/** 取值依据见计划「依据的指令」一节；手册的机型表里不是所有机型都有的速度不列。 */
export const COMMAND_SET_LIMITS: Readonly<Record<CommandSet, CommandSetLimits>> = {
  // DENSITY 0–15；SPEED 是英寸/秒，桌面机普遍有 2–5。纸张用毫米写，不要分辨率。
  tspl: {
    density: { min: 0, max: 15 },
    speeds: [2, 3, 4, 5],
    canSetFinish: true,
    canFactoryReset: true,
    usesDots: false,
  },
  // ~SD 00–30；^PR 是英寸/秒，桌面机 2–6。
  zpl: {
    density: { min: 0, max: 30 },
    speeds: [2, 3, 4, 5, 6],
    canSetFinish: true,
    canFactoryReset: true,
    usesDots: true,
  },
  // D 0–15；S 是档位，每档多快随机型，各机型都有 1–4。出纸方式不设：O 命令同一条里还管切刀和热敏 / 热转印模式。
  epl: {
    density: { min: 0, max: 15 },
    speeds: [1, 2, 3, 4],
    canSetFinish: false,
    canFactoryReset: true,
    usesDots: true,
  },
};

/** 「自动」和「不发指令」下保存的设置按它校验：几种指令集的并集，真正发送前再按认出的指令集把关。 */
export const WIDEST_LIMITS: CommandSetLimits = {
  density: {
    min: Math.min(...COMMAND_SETS.map((set) => COMMAND_SET_LIMITS[set].density.min)),
    max: Math.max(...COMMAND_SETS.map((set) => COMMAND_SET_LIMITS[set].density.max)),
  },
  speeds: [...new Set(COMMAND_SETS.flatMap((set) => COMMAND_SET_LIMITS[set].speeds))].sort((a, b) => a - b),
  canSetFinish: true,
  canFactoryReset: true,
  usesDots: true,
};

/**
 * 间隙 / 黑标的高度（mm）。市面上的标签纸是 2–5mm（纸卷外包装上会写）；下限 2mm 是 EPL 的 Q 命令下限
 * （16 点 @203dpi）；上限 10mm 在 TSPL（≤ 25.4mm）、EPL（≤ 240 点，600dpi 下约 10.2mm）里都放得下。
 */
export const GAP_RANGE_MM = { min: 2, max: 10 } as const;

/** 表单里间隙的默认值：最常见的标签纸间隙。 */
export const DEFAULT_GAP_MM = 2;

/** 能手动选的分辨率：热敏标签机只有这三档。 */
export const COMMAND_DPI_CHOICES = [203, 300, 600] as const;

/**
 * 一次发给打印机的指令上限 4KB：最长的一组（设置）不到 200 字节，留足余量；
 * 这条路只发我们生成的指令，不是通用的原始打印通道，上限也挡住编程错误。
 */
export const RAW_COMMAND_MAX_BYTES = 4_096;

const MM_PER_INCH = 25.4;

/** 毫米 → 整数个打印点（四舍五入）。 */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / MM_PER_INCH);
}

export function isPrinterAction(value: unknown): value is PrinterAction {
  return PRINTER_ACTIONS.some((action) => action === value);
}

/** 这台打印机保存的设置；没保存过是默认（自动、各项不改）。只读自己的键：打印机名可能是 __proto__ 这样的字。 */
export function configFor(
  configs: Readonly<Record<string, PrinterCommandConfig>>,
  printerName: string,
): PrinterCommandConfig {
  return Object.hasOwn(configs, printerName)
    ? (configs[printerName] ?? DEFAULT_COMMAND_CONFIG)
    : DEFAULT_COMMAND_CONFIG;
}

/** 换掉一台打印机的设置。fromEntries 按「定义自己的属性」写入：名为 __proto__ 的打印机也不会改到原型。 */
export function withPrinterConfig(
  configs: Readonly<Record<string, PrinterCommandConfig>>,
  printerName: string,
  config: PrinterCommandConfig,
): Record<string, PrinterCommandConfig> {
  return Object.fromEntries([...Object.entries(configs).filter(([name]) => name !== printerName), [printerName, config]]);
}

/** 认指令集用到的打印机身份。 */
export interface PrinterIdentity {
  /** 驱动名（Windows 的 DriverName；macOS 是 CUPS 的 printer-make-and-model）；读不到为 null。 */
  driverName: string | null;
  /** USB 的厂商、产品编号：5c（驱动安装）读 PnP 设备时填，这一期一直是 null。 */
  usb: { vendorId: number; productId: number } | null;
}

/** 「自动」认出的指令集和依据。 */
export interface DetectedCommandSet {
  commandSet: CommandSet;
  source: 'catalog' | 'driver-name';
}

/**
 * 按型号认指令集的在线识别表，由 5c 实现（清单里有品牌和型号，不进仓库）。
 * 认不出、查询失败都返回 null：不挡住按驱动名猜。
 */
export interface CommandSetCatalog {
  commandSetFor(identity: PrinterIdentity): Promise<CommandSet | null>;
}

/** 5c 接进来之前用它：谁都不认识。 */
export const NO_COMMAND_SET_CATALOG: CommandSetCatalog = {
  commandSetFor: async () => null,
};
```

```ts
// src/core/printer-commands/command-set.ts
import type {
  CommandSet,
  CommandSetCatalog,
  CommandSetChoice,
  DetectedCommandSet,
  PrinterIdentity,
} from './command-model';

/**
 * 驱动名里写着的指令集字样（必须单独成词）。只认指令集本身的名字，不认品牌和型号：
 * 仓库里不写品牌型号，按型号认的表在 5c 的在线清单里（CommandSetCatalog）。
 */
const DRIVER_NAME_HINTS: readonly { commandSet: CommandSet; pattern: RegExp }[] = [
  { commandSet: 'tspl', pattern: /\bTSPL2?\b/i },
  { commandSet: 'zpl', pattern: /\bZPL(?:\s*II|2)?\b/i },
  { commandSet: 'epl', pattern: /\bEPL2?\b/i },
];

/** 驱动名里只写着一种指令集时返回它。写着两种的（例如双指令集的驱动）不猜：猜错了打印机不认这些指令。 */
export function guessFromDriverName(driverName: string): CommandSet | null {
  const matches = DRIVER_NAME_HINTS.filter((hint) => hint.pattern.test(driverName));
  return matches.length === 1 ? (matches[0]?.commandSet ?? null) : null;
}

/** 「自动」认出的指令集：先查在线识别表（按型号，最可靠），再看驱动名；都认不出为 null。 */
export async function detectCommandSet(
  identity: PrinterIdentity,
  catalog: CommandSetCatalog,
): Promise<DetectedCommandSet | null> {
  const fromCatalog = await catalog.commandSetFor(identity);
  if (fromCatalog !== null) {
    return { commandSet: fromCatalog, source: 'catalog' };
  }
  const fromName = identity.driverName === null ? null : guessFromDriverName(identity.driverName);
  return fromName === null ? null : { commandSet: fromName, source: 'driver-name' };
}

/** 实际用的指令集：手动选的；「自动」用认出的；「不发指令」和认不出时为 null（不发）。 */
export function effectiveCommandSet(choice: CommandSetChoice, detected: DetectedCommandSet | null): CommandSet | null {
  if (choice === 'none') {
    return null;
  }
  if (choice === 'auto') {
    return detected?.commandSet ?? null;
  }
  return choice;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/printer-commands`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/printer-commands
git commit -m "feat(printer-commands): command set model and detection from driver names" -m "Label printer commands are optional per printer: auto, TSPL, ZPL, EPL or none. Auto only trusts a command set name written as a word in the driver name; model-based detection comes from the online catalog in 5c through CommandSetCatalog, so no brand or model names live in the repository." -m "$TRAILER"
```

---

### Task 2: 设置的校验（存储宽松、IPC 严格）

**Files:**
- Create: `src/core/printer-commands/sanitize-command-config.ts`、`src/core/printer-commands/sanitize-command-config.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/printer-commands/sanitize-command-config.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { parseCommandConfig, sanitizeCommandConfig } from './sanitize-command-config';

const MEDIA: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const VALID: PrinterCommandConfig = {
  commandSet: 'tspl',
  density: 8,
  speed: 4,
  media: MEDIA,
  orientation: 'normal',
  finish: 'tear',
  dpi: null,
};

describe('sanitizeCommandConfig', () => {
  test('keeps a valid config', () => {
    expect(sanitizeCommandConfig(structuredClone(VALID))).toEqual(VALID);
  });

  // 不用 test.each：Bun 会把 undefined 那一行的参数当成 done 回调。
  test('falls back to 自动 with nothing changed for junk', () => {
    for (const value of [undefined, null, 'tspl', [VALID]]) {
      expect(sanitizeCommandConfig(value)).toEqual(DEFAULT_COMMAND_CONFIG);
    }
  });

  test('turns values the chosen command set does not have into 不改', () => {
    expect(sanitizeCommandConfig({ ...VALID, density: 20, speed: 6 })).toMatchObject({ density: null, speed: null });
    expect(sanitizeCommandConfig({ ...VALID, commandSet: 'epl', finish: 'tear' }).finish).toBeNull();
  });

  test('checks values saved under 自动 against the widest range', () => {
    expect(sanitizeCommandConfig({ ...VALID, commandSet: 'auto', density: 30, speed: 6 })).toMatchObject({
      density: 30,
      speed: 6,
    });
  });

  test('drops paper outside the paper limits and rounds to 0.1mm', () => {
    expect(sanitizeCommandConfig({ ...VALID, media: { ...MEDIA, widthMm: 500 } }).media).toBeNull();
    expect(
      sanitizeCommandConfig({ ...VALID, media: { widthMm: 60.04, heightMm: 40, sensing: 'mark', gapMm: 3.06 } }).media,
    ).toEqual({ widthMm: 60, heightMm: 40, sensing: 'mark', gapMm: 3.1 });
  });
});

describe('parseCommandConfig', () => {
  test('accepts a complete, valid config', () => {
    expect(parseCommandConfig(structuredClone(VALID))).toEqual(VALID);
    expect(parseCommandConfig({ ...DEFAULT_COMMAND_CONFIG })).toEqual(DEFAULT_COMMAND_CONFIG);
  });

  test.each([
    ['command set', { commandSet: 'cpcl' }],
    ['density for the set', { density: 16 }],
    ['speed for the set', { speed: 1 }],
    ['paper', { media: { widthMm: 60 } }],
    ['gap', { media: { ...MEDIA, gapMm: 0.5 } }],
    ['orientation', { orientation: 'left' }],
    ['finish for EPL', { commandSet: 'epl', finish: 'peel' }],
    ['resolution', { dpi: 96 }],
    ['missing field', { dpi: undefined }],
  ])('rejects a bad %s', (_name, patch) => {
    expect(parseCommandConfig({ ...VALID, ...patch })).toBeNull();
  });

  test('rejects anything that is not an object', () => {
    expect(parseCommandConfig(null)).toBeNull();
    expect(parseCommandConfig([VALID])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/printer-commands/sanitize-command-config.test.ts`
Expected: FAIL，`Cannot find module './sanitize-command-config'`。

- [ ] **Step 3: 实现**

```ts
// src/core/printer-commands/sanitize-command-config.ts
import { PAPER_LIMITS_MM } from '../../shared/paper-sizes';
import {
  COMMAND_DPI_CHOICES,
  COMMAND_SET_CHOICES,
  COMMAND_SET_LIMITS,
  COMMAND_SETS,
  type CommandSetChoice,
  type CommandSetLimits,
  DEFAULT_COMMAND_CONFIG,
  FINISH_MODES,
  type FinishMode,
  GAP_RANGE_MM,
  MEDIA_SENSINGS,
  type MediaSetup,
  PRINT_ORIENTATIONS,
  type PrinterCommandConfig,
  WIDEST_LIMITS,
} from './command-model';

type Loose = Record<string, unknown>;

/** 每一项读出来的值：undefined = 不合法（缺了、类型不对、超出范围）；null = 不改。 */
type ReadFields = { [K in keyof PrinterCommandConfig]: PrinterCommandConfig[K] | undefined };

/** 毫米数保留一位小数：和纸张键的精度一致。 */
const TENTHS_PER_MM = 10;

function asLoose(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null;
}

/** 手动选了指令集就按它的范围；「自动」「不发指令」按最宽的范围（发送前再按认出的指令集把关）。 */
function limitsFor(choice: CommandSetChoice | undefined): CommandSetLimits {
  const set = COMMAND_SETS.find((item) => item === choice);
  return set === undefined ? WIDEST_LIMITS : COMMAND_SET_LIMITS[set];
}

function readOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  return value === null ? null : allowed.find((item) => item === value);
}

function readNumberOf(value: unknown, allowed: readonly number[]): number | null | undefined {
  return value === null ? null : allowed.find((item) => item === value);
}

function readInteger(value: unknown, range: { min: number; max: number }): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
    ? value
    : undefined;
}

function readMm(value: unknown, range: { readonly min: number; readonly max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value * TENTHS_PER_MM) / TENTHS_PER_MM;
  return rounded >= range.min && rounded <= range.max ? rounded : undefined;
}

function readMedia(value: unknown): MediaSetup | null | undefined {
  if (value === null) {
    return null;
  }
  const media = asLoose(value);
  if (media === null) {
    return undefined;
  }
  const widthMm = readMm(media['widthMm'], PAPER_LIMITS_MM.width);
  const heightMm = readMm(media['heightMm'], PAPER_LIMITS_MM.height);
  const sensing = MEDIA_SENSINGS.find((item) => item === media['sensing']);
  const gapMm = readMm(media['gapMm'], GAP_RANGE_MM);
  if (widthMm === undefined || heightMm === undefined || sensing === undefined || gapMm === undefined) {
    return undefined;
  }
  return { widthMm, heightMm, sensing, gapMm };
}

function readFields(input: Loose): ReadFields {
  const commandSet = COMMAND_SET_CHOICES.find((choice) => choice === input['commandSet']);
  const limits = limitsFor(commandSet);
  return {
    commandSet,
    density: readInteger(input['density'], limits.density),
    speed: readNumberOf(input['speed'], limits.speeds),
    media: readMedia(input['media']),
    orientation: readOneOf(input['orientation'], PRINT_ORIENTATIONS),
    finish: readOneOf<FinishMode>(input['finish'], limits.canSetFinish ? FINISH_MODES : []),
    dpi: readNumberOf(input['dpi'], COMMAND_DPI_CHOICES),
  };
}

/** 设置表里读出来的（不可信）：不合法的项回到「不改」，指令集回到「自动」，不报错。 */
export function sanitizeCommandConfig(value: unknown): PrinterCommandConfig {
  const fields = readFields(asLoose(value) ?? {});
  return {
    commandSet: fields.commandSet ?? DEFAULT_COMMAND_CONFIG.commandSet,
    density: fields.density ?? null,
    speed: fields.speed ?? null,
    media: fields.media ?? null,
    orientation: fields.orientation ?? null,
    finish: fields.finish ?? null,
    dpi: fields.dpi ?? null,
  };
}

/**
 * 渲染进程交来的（IPC 信任边界）：每一项都要有、都合法，有一项不对就整个不收（返回 null，由 IPC 报错）。
 * 不纠正、不兜底：界面自己负责交合法的设置。
 */
export function parseCommandConfig(value: unknown): PrinterCommandConfig | null {
  const input = asLoose(value);
  if (input === null) {
    return null;
  }
  const { commandSet, density, speed, media, orientation, finish, dpi } = readFields(input);
  if (
    commandSet === undefined ||
    density === undefined ||
    speed === undefined ||
    media === undefined ||
    orientation === undefined ||
    finish === undefined ||
    dpi === undefined
  ) {
    return null;
  }
  return { commandSet, density, speed, media, orientation, finish, dpi };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/printer-commands`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/printer-commands
git commit -m "feat(printer-commands): sanitize stored configs and strictly parse configs from the renderer" -m "Stored settings fall back to 'unchanged' field by field. Configs from the renderer cross the IPC trust boundary, so any missing or out-of-range field rejects the whole config. Values saved under auto are checked against the union of all command sets and again against the detected set before sending." -m "$TRAILER"
```

---

### Task 3: TSPL 生成器

**Files:**
- Create: `src/core/printer-commands/tspl.ts`、`src/core/printer-commands/tspl.test.ts`

- [ ] **Step 1: 核对手册**

打开《TSPL/TSPL2 编程手册》，逐条核对「依据的指令」表里 TSPL 的各行：`SIZE`、`GAP`、`BLINE` 的公制写法（`m mm,n mm`）和 `GAP`/`BLINE` 的 0–25.4mm；`DENSITY` 0–15；`SPEED` 的机型表（确认 2、3、4、5 英寸/秒在桌面机上普遍可用，不是就从 `COMMAND_SET_LIMITS.tspl.speeds` 删掉并改 Task 1 的测试）；`DIRECTION` 的两个值；`SET TEAR`、`SET PEEL` 的写法；`GAPDETECT`、`BLINEDETECT` 不带参数；`FORMFEED`、`SELFTEST`、`INITIALPRINTER`；行尾 CR LF。核对结果（页码、和计划的差异）写进提交说明。

- [ ] **Step 2: 写测试**

```ts
// src/core/printer-commands/tspl.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { tsplAction, tsplSetup } from './tspl';

const BASE: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'tspl' };
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };

function crlf(...lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join('');
}

describe('tsplSetup', () => {
  test('writes nothing when every setting is left unchanged', () => {
    expect(tsplSetup(BASE)).toBe('');
  });

  // 手册的公制写法：SIZE m mm,n mm；GAP m mm,n mm。
  test('sets the paper size and gap in millimetres', () => {
    expect(tsplSetup({ ...BASE, media: LABEL })).toBe(crlf('SIZE 60 mm,40 mm', 'GAP 2 mm,0 mm'));
  });

  test('uses BLINE for black-mark paper and keeps one decimal', () => {
    const media: MediaSetup = { widthMm: 76.5, heightMm: 130, sensing: 'mark', gapMm: 3.5 };
    expect(tsplSetup({ ...BASE, media })).toBe(crlf('SIZE 76.5 mm,130 mm', 'BLINE 3.5 mm,0 mm'));
  });

  test('sends density, speed, direction and tear-off in a fixed order', () => {
    const config: PrinterCommandConfig = {
      ...BASE,
      media: LABEL,
      density: 8,
      speed: 4,
      orientation: 'rotated',
      finish: 'tear',
    };
    expect(tsplSetup(config)).toBe(
      crlf('SIZE 60 mm,40 mm', 'GAP 2 mm,0 mm', 'DENSITY 8', 'SPEED 4', 'DIRECTION 1', 'SET PEEL OFF', 'SET TEAR ON'),
    );
  });

  test('switches tear-off off for peel mode', () => {
    expect(tsplSetup({ ...BASE, finish: 'peel', orientation: 'normal' })).toBe(
      crlf('DIRECTION 0', 'SET TEAR OFF', 'SET PEEL ON'),
    );
  });
});

describe('tsplAction', () => {
  test('calibrates with the saved paper type, gap paper by default', () => {
    expect(tsplAction('calibrate', BASE)).toBe(crlf('GAPDETECT'));
    expect(tsplAction('calibrate', { ...BASE, media: { ...LABEL, sensing: 'mark' } })).toBe(crlf('BLINEDETECT'));
  });

  test('feeds a label, prints the self-test page and restores factory settings', () => {
    expect(tsplAction('feed', BASE)).toBe(crlf('FORMFEED'));
    expect(tsplAction('selfTest', BASE)).toBe(crlf('SELFTEST'));
    expect(tsplAction('factoryReset', BASE)).toBe(crlf('INITIALPRINTER'));
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/printer-commands/tspl.test.ts`
Expected: FAIL，`Cannot find module './tspl'`。

- [ ] **Step 4: 实现**

```ts
// src/core/printer-commands/tspl.ts
import type { MediaSetup, PrinterAction, PrinterCommandConfig } from './command-model';

/**
 * TSPL / TSPL2 指令（依据《TSPL/TSPL2 编程手册》）。每条指令以 CR LF 结尾。
 * 纸张用手册的公制写法（SIZE m mm,n mm；GAP m mm,n mm；BLINE m mm,n mm）：不换算打印点，也就不需要分辨率。
 */
const LINE_END = '\r\n';
/** 毫米数保留一位小数：和纸张键的精度一致（0.1mm）。 */
const TENTHS_PER_MM = 10;
/** DIRECTION 的 0 和 1 相差 180°；0 当「正常」，哪个是出厂方向要真机核对（计划的真机验收）。 */
const DIRECTION_NORMAL = 0;
const DIRECTION_ROTATED = 1;

function mm(value: number): string {
  return `${Math.round(value * TENTHS_PER_MM) / TENTHS_PER_MM} mm`;
}

function lines(commands: readonly string[]): string {
  return commands.map((command) => `${command}${LINE_END}`).join('');
}

function mediaCommands(media: MediaSetup): string[] {
  // 第二个参数：GAP 是间隙的偏移，BLINE 是黑标之后多走的长度；标准标签纸都是 0。
  const mark = media.sensing === 'gap' ? 'GAP' : 'BLINE';
  return [`SIZE ${mm(media.widthMm)},${mm(media.heightMm)}`, `${mark} ${mm(media.gapMm)},0 mm`];
}

/** 保存时发一次的设置；各项都不改时返回空字符串。顺序固定：纸张 → 浓度 → 速度 → 方向 → 出纸方式。 */
export function tsplSetup(config: PrinterCommandConfig): string {
  const commands: string[] = [];
  if (config.media !== null) {
    commands.push(...mediaCommands(config.media));
  }
  if (config.density !== null) {
    commands.push(`DENSITY ${config.density}`);
  }
  if (config.speed !== null) {
    commands.push(`SPEED ${config.speed}`);
  }
  if (config.orientation !== null) {
    commands.push(`DIRECTION ${config.orientation === 'normal' ? DIRECTION_NORMAL : DIRECTION_ROTATED}`);
  }
  // 两种出纸方式只开一个：开一个就先关另一个，不留在两种模式都开着的状态。
  if (config.finish === 'tear') {
    commands.push('SET PEEL OFF', 'SET TEAR ON');
  } else if (config.finish === 'peel') {
    commands.push('SET TEAR OFF', 'SET PEEL ON');
  }
  return lines(commands);
}

/** 动作指令。纸张校准按保存的纸型：黑标纸 BLINEDETECT，其余（含没设纸张）GAPDETECT。 */
export function tsplAction(action: PrinterAction, config: PrinterCommandConfig): string {
  switch (action) {
    case 'calibrate':
      return lines([config.media?.sensing === 'mark' ? 'BLINEDETECT' : 'GAPDETECT']);
    case 'feed':
      return lines(['FORMFEED']);
    case 'selfTest':
      return lines(['SELFTEST']);
    case 'factoryReset':
      return lines(['INITIALPRINTER']);
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/core/printer-commands/tspl.test.ts`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/printer-commands/tspl.ts src/core/printer-commands/tspl.test.ts
git commit -m "feat(printer-commands): TSPL settings and actions" -m "Paper uses the metric SIZE/GAP/BLINE syntax of the TSPL manual, so no resolution is needed. Only settings the operator changed are sent. <核对手册的结果：页码、差异>" -m "$TRAILER"
```

---

### Task 4: ZPL 生成器

**Files:**
- Create: `src/core/printer-commands/zpl.ts`、`src/core/printer-commands/zpl.test.ts`

- [ ] **Step 1: 核对手册**

打开《ZPL II 编程指南》，核对：`~SD##` 两位数 00–30；`^PW`、`^LL`（1–32000）；`^MN` 的 Y、M；`^PR` 的取值表（确认 2–6 英寸/秒在桌面机上可用）；`^PO` 的 N、I；`^MM` 的 T、P；`^JU` 的 F、N、S（`^JUF` 之后是否还要 `^JUS`）；`~JC`、`~PH`、`~WC` 的作用。`^PO`、`^PR` 是否随 `^JUS` 保存写进提交说明（不保存的话，这一项只对这次发的空格式有效，要在真机验收里确认，必要时在界面上去掉这一项）。

- [ ] **Step 2: 写测试**

```ts
// src/core/printer-commands/zpl.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { zplAction, zplSetup } from './zpl';

const BASE: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'zpl' };
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DPI_203 = 203;
const DPI_300 = 300;

function lf(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

describe('zplSetup', () => {
  test('writes nothing when every setting is left unchanged', () => {
    expect(zplSetup(BASE, DPI_203)).toBe('');
  });

  test('converts the paper to dots, picks gap sensing and saves it (^PW ^LL ^MN ^JUS)', () => {
    expect(zplSetup({ ...BASE, media: LABEL }, DPI_203)).toBe(lf('^XA', '^PW480', '^LL320', '^MNY', '^JUS', '^XZ'));
    expect(zplSetup({ ...BASE, media: LABEL }, DPI_300)).toBe(lf('^XA', '^PW709', '^LL472', '^MNY', '^JUS', '^XZ'));
  });

  test('uses mark sensing for black-mark paper', () => {
    expect(zplSetup({ ...BASE, media: { ...LABEL, sensing: 'mark' } }, DPI_203)).toContain('^MNM\n');
  });

  // ~SD 是绝对浓度，固定两位；它也要 ^JUS 才存下来。
  test('sets darkness with a two-digit ~SD before the format', () => {
    expect(zplSetup({ ...BASE, density: 5 }, DPI_203)).toBe(lf('~SD05', '^XA', '^JUS', '^XZ'));
  });

  test('sends speed, orientation and print mode (^PR ^PO ^MM)', () => {
    expect(zplSetup({ ...BASE, speed: 4, orientation: 'rotated', finish: 'peel' }, DPI_203)).toBe(
      lf('^XA', '^PR4', '^POI', '^MMP', '^JUS', '^XZ'),
    );
    expect(zplSetup({ ...BASE, orientation: 'normal', finish: 'tear' }, DPI_203)).toBe(
      lf('^XA', '^PON', '^MMT', '^JUS', '^XZ'),
    );
  });
});

describe('zplAction', () => {
  test('calibrates, feeds one blank label and prints the configuration label', () => {
    expect(zplAction('calibrate')).toBe(lf('~JC'));
    expect(zplAction('feed')).toBe(lf('~PH'));
    expect(zplAction('selfTest')).toBe(lf('~WC'));
  });

  // ^JUN 恢复网络设置：联网的打印机会失联，恢复出厂设置不发它。
  test('restores and saves factory settings without touching the network settings', () => {
    expect(zplAction('factoryReset')).toBe(lf('^XA', '^JUF', '^JUS', '^XZ'));
    expect(zplAction('factoryReset')).not.toContain('^JUN');
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/printer-commands/zpl.test.ts`
Expected: FAIL，`Cannot find module './zpl'`。

- [ ] **Step 4: 实现**

```ts
// src/core/printer-commands/zpl.ts
import { mmToDots, type PrinterAction, type PrinterCommandConfig } from './command-model';

/**
 * ZPL II 指令（依据《ZPL II 编程指南》）。~ 开头的控制指令收到就执行；^ 开头的格式指令放在 ^XA … ^XZ 之间。
 * 一条一行：指南的示例都这样写，换行不影响解析，日志和测试也好读。设置最后用 ^JUS 存进打印机，关机后仍在。
 */
const LINE_END = '\n';
/** ~SD 的参数固定两位（00–30）。 */
const DARKNESS_DIGITS = 2;

function lines(commands: readonly string[]): string {
  return commands.map((command) => `${command}${LINE_END}`).join('');
}

/** 保存时发一次的设置；各项都不改时返回空字符串。纸宽、纸长按 dpi 换成打印点。 */
export function zplSetup(config: PrinterCommandConfig, dpi: number): string {
  const control: string[] = [];
  const format: string[] = [];
  if (config.density !== null) {
    // ~SD 是绝对浓度（和面板上的设置一样）；^MD 是在当前浓度上加减，结果取决于打印机原来的值，所以不用它。
    control.push(`~SD${String(config.density).padStart(DARKNESS_DIGITS, '0')}`);
  }
  if (config.media !== null) {
    format.push(
      `^PW${mmToDots(config.media.widthMm, dpi)}`,
      `^LL${mmToDots(config.media.heightMm, dpi)}`,
      // Y：间隙纸（web sensing）；M：黑标纸（mark sensing）。
      config.media.sensing === 'gap' ? '^MNY' : '^MNM',
    );
  }
  if (config.speed !== null) {
    format.push(`^PR${config.speed}`);
  }
  if (config.orientation !== null) {
    format.push(config.orientation === 'normal' ? '^PON' : '^POI');
  }
  if (config.finish !== null) {
    format.push(config.finish === 'tear' ? '^MMT' : '^MMP');
  }
  if (control.length === 0 && format.length === 0) {
    return '';
  }
  // 只改浓度时也发一个只有 ^JUS 的格式：~SD 同样要 ^JUS 才存下来。
  return lines([...control, '^XA', ...format, '^JUS', '^XZ']);
}

/** 动作指令；不需要设置和分辨率。 */
export function zplAction(action: PrinterAction): string {
  switch (action) {
    case 'calibrate':
      // ~JC：测纸张长度并调整纸张传感器。
      return lines(['~JC']);
    case 'feed':
      // ~PH：走一张空白标签。
      return lines(['~PH']);
    case 'selfTest':
      // ~WC：打印配置标签。
      return lines(['~WC']);
    case 'factoryReset':
      // ^JUF 载入出厂设置，^JUS 存下来（不然关机后回到原来的设置）。不发 ^JUN：它恢复网络设置，联网的打印机会失联。
      return lines(['^XA', '^JUF', '^JUS', '^XZ']);
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/core/printer-commands/zpl.test.ts`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/printer-commands/zpl.ts src/core/printer-commands/zpl.test.ts
git commit -m "feat(printer-commands): ZPL settings and actions" -m "Darkness uses the absolute ~SD instead of the relative ^MD, settings are saved with ^JUS, and factory reset never sends ^JUN so networked printers keep their address. <核对手册的结果：页码、^PO/^PR 是否随 ^JUS 保存>" -m "$TRAILER"
```

---

### Task 5: EPL 生成器

**Files:**
- Create: `src/core/printer-commands/epl.ts`、`src/core/printer-commands/epl.test.ts`

- [ ] **Step 1: 核对手册**

打开《EPL2 编程手册》，核对：`q`（点数）；`Q p1,p2` 的 p2 范围（203dpi 16–240、300dpi 18–240）和黑标的 `B` 前缀；`D` 0–15；`S` 的机型表（确认 1–4 档各机型都有）；`ZT`、`ZB`；`O` 命令的选项（确认不单独发它的理由成立）；`xa`；`N`、`P1`；`U` 的作用（打印配置）；`^default` 是否存在。`^default` 不存在时：`COMMAND_SET_LIMITS.epl.canFactoryReset` 改成 false，删掉下面 `eplAction` 的 `factoryReset` 分支返回值改为抛错（`buildAction` 已经先按 `canFactoryReset` 拦下），对应测试改成「EPL 没有恢复出厂设置」。

- [ ] **Step 2: 写测试**

```ts
// src/core/printer-commands/epl.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { eplAction, eplGapIssue, eplSetup } from './epl';

const BASE: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'epl' };
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DPI_203 = 203;
/** 比热敏标签机常见的分辨率都低：2mm 的间隙不到 16 个点。 */
const LOW_DPI = 150;

function lf(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

describe('eplSetup', () => {
  test('writes nothing when every setting is left unchanged', () => {
    expect(eplSetup(BASE, DPI_203)).toBe('');
  });

  test('sets width and length in dots with the gap (q, Q p1,p2)', () => {
    expect(eplSetup({ ...BASE, media: LABEL }, DPI_203)).toBe(lf('q480', 'Q320,16'));
  });

  test('marks black-line paper with B (Q p1,Bp2)', () => {
    expect(eplSetup({ ...BASE, media: { ...LABEL, sensing: 'mark', gapMm: 3 } }, DPI_203)).toBe(lf('q480', 'Q320,B24'));
  });

  test('sends density, speed step and orientation (D, S, ZT/ZB)', () => {
    expect(eplSetup({ ...BASE, density: 10, speed: 2, orientation: 'normal' }, DPI_203)).toBe(lf('D10', 'S2', 'ZT'));
    expect(eplSetup({ ...BASE, orientation: 'rotated' }, DPI_203)).toBe(lf('ZB'));
  });
});

describe('eplGapIssue', () => {
  test('accepts gaps within 16–240 dots and explains the rest', () => {
    expect(eplGapIssue(LABEL, DPI_203)).toBeNull();
    expect(eplGapIssue(LABEL, LOW_DPI)).toBe(
      'EPL 的间隙 / 黑标要在 16–240 个打印点之间，2mm 在 150dpi 下是 12 点：请改间隙或分辨率',
    );
  });
});

describe('eplAction', () => {
  test('auto-senses, prints one blank label, prints the configuration and restores defaults', () => {
    expect(eplAction('calibrate')).toBe(lf('xa'));
    expect(eplAction('feed')).toBe(lf('N', 'P1'));
    expect(eplAction('selfTest')).toBe(lf('U'));
    expect(eplAction('factoryReset')).toBe(lf('^default'));
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/printer-commands/epl.test.ts`
Expected: FAIL，`Cannot find module './epl'`。

- [ ] **Step 4: 实现**

```ts
// src/core/printer-commands/epl.ts
import { type MediaSetup, mmToDots, type PrinterAction, type PrinterCommandConfig } from './command-model';

/**
 * EPL2 指令（依据《EPL2 编程手册》）。每条指令以换行（LF）结尾；宽高、间隙按打印点：q 纸宽，Q 纸长和间隙 / 黑标。
 * 出纸方式不发（COMMAND_SET_LIMITS.epl.canSetFinish 为 false）：EPL 用 O 命令选，同一条命令还管切刀和热敏 / 热转印模式。
 */
const LINE_END = '\n';
/**
 * Q 命令第二个参数（间隙或黑标高度）的范围：手册写 203dpi 16–240 点、300dpi 18–240 点。
 * GAP_RANGE_MM 的下限 2mm 在 300dpi 下是 24 点，所以统一按 16 查就够。
 */
export const EPL_GAP_DOTS = { min: 16, max: 240 } as const;
/** 黑标纸在 Q 命令的第二个参数前加 B。 */
const BLACK_LINE_PREFIX = 'B';

function lines(commands: readonly string[]): string {
  return commands.map((command) => `${command}${LINE_END}`).join('');
}

/** 间隙换成打印点后不在 EPL 的范围里时，给操作员的说明；在范围里返回 null。 */
export function eplGapIssue(media: MediaSetup, dpi: number): string | null {
  const dots = mmToDots(media.gapMm, dpi);
  if (dots >= EPL_GAP_DOTS.min && dots <= EPL_GAP_DOTS.max) {
    return null;
  }
  return `EPL 的间隙 / 黑标要在 ${EPL_GAP_DOTS.min}–${EPL_GAP_DOTS.max} 个打印点之间，${media.gapMm}mm 在 ${dpi}dpi 下是 ${dots} 点：请改间隙或分辨率`;
}

/** 保存时发一次的设置；各项都不改时返回空字符串。范围由 printer-commands.ts 先查过。 */
export function eplSetup(config: PrinterCommandConfig, dpi: number): string {
  const commands: string[] = [];
  if (config.media !== null) {
    const prefix = config.media.sensing === 'mark' ? BLACK_LINE_PREFIX : '';
    commands.push(
      `q${mmToDots(config.media.widthMm, dpi)}`,
      `Q${mmToDots(config.media.heightMm, dpi)},${prefix}${mmToDots(config.media.gapMm, dpi)}`,
    );
  }
  if (config.density !== null) {
    commands.push(`D${config.density}`);
  }
  if (config.speed !== null) {
    commands.push(`S${config.speed}`);
  }
  if (config.orientation !== null) {
    // ZT：从图像缓冲区顶部开始打（默认）；ZB：从底部开始，即旋转 180°。
    commands.push(config.orientation === 'normal' ? 'ZT' : 'ZB');
  }
  return lines(commands);
}

/** 动作指令；不需要设置和分辨率。 */
export function eplAction(action: PrinterAction): string {
  switch (action) {
    case 'calibrate':
      // xa：自动测纸（AutoSense），量标签长度、定间隙传感器的门限。
      return lines(['xa']);
    case 'feed':
      // N 清空图像缓冲区，P1 打一张：打出一张空白标签，就是走一张纸。
      return lines(['N', 'P1']);
    case 'selfTest':
      // U：打印配置。
      return lines(['U']);
    case 'factoryReset':
      return lines(['^default']);
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/core/printer-commands/epl.test.ts`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/printer-commands/epl.ts src/core/printer-commands/epl.test.ts
git commit -m "feat(printer-commands): EPL settings and actions" -m "Paper is sent in dots with q and Q, with the B prefix for black-line paper and the manual's 16-240 dot gap range. The print mode is not sent because the O command also switches the cutter and thermal mode. <核对手册的结果：页码、S 档位、U、^default>" -m "$TRAILER"
```

---

### Task 6: 按指令集分派、按范围把关

**Files:**
- Create: `src/core/printer-commands/printer-commands.ts`、`src/core/printer-commands/printer-commands.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/printer-commands/printer-commands.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { buildAction, buildSetup } from './printer-commands';

const BASE: PrinterCommandConfig = DEFAULT_COMMAND_CONFIG;
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DPI_203 = 203;

describe('buildSetup', () => {
  test('builds the commands of the given command set', () => {
    expect(buildSetup('tspl', { ...BASE, density: 8 }, DPI_203)).toEqual({ ok: true, text: 'DENSITY 8\r\n' });
    expect(buildSetup('zpl', { ...BASE, density: 20 }, DPI_203)).toEqual({ ok: true, text: '~SD20\n^XA\n^JUS\n^XZ\n' });
    expect(buildSetup('epl', { ...BASE, media: LABEL }, DPI_203)).toEqual({ ok: true, text: 'q480\nQ320,16\n' });
  });

  test('returns an empty text when nothing changes', () => {
    expect(buildSetup('tspl', BASE, DPI_203)).toEqual({ ok: true, text: '' });
  });

  // 「自动」下按最宽的范围保存：认出的指令集没有这个值时不发，说清楚哪一项要改。
  test('explains values the command set does not have', () => {
    expect(buildSetup('tspl', { ...BASE, density: 20 }, DPI_203)).toEqual({
      ok: false,
      issue: 'TSPL 的浓度是 0–15，现在是 20：请重新选浓度',
    });
    expect(buildSetup('epl', { ...BASE, speed: 5 }, DPI_203)).toEqual({
      ok: false,
      issue: 'EPL 没有这个速度（5）：请重新选速度',
    });
    expect(buildSetup('epl', { ...BASE, finish: 'tear' }, DPI_203)).toEqual({
      ok: false,
      issue: 'EPL 不能设出纸方式（撕纸 / 剥离）：请改成「不改」',
    });
  });
});

describe('buildAction', () => {
  test('builds the action of the given command set', () => {
    expect(buildAction('zpl', 'feed', BASE)).toEqual({ ok: true, text: '~PH\n' });
    expect(buildAction('tspl', 'calibrate', { ...BASE, media: { ...LABEL, sensing: 'mark' } })).toEqual({
      ok: true,
      text: 'BLINEDETECT\r\n',
    });
    expect(buildAction('epl', 'selfTest', BASE)).toEqual({ ok: true, text: 'U\n' });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/printer-commands/printer-commands.test.ts`
Expected: FAIL，`Cannot find module './printer-commands'`。

- [ ] **Step 3: 实现**

```ts
// src/core/printer-commands/printer-commands.ts
import {
  COMMAND_SET_LIMITS,
  COMMAND_SET_NAMES,
  type CommandSet,
  type PrinterAction,
  type PrinterCommandConfig,
} from './command-model';
import { eplAction, eplGapIssue, eplSetup } from './epl';
import { tsplAction, tsplSetup } from './tspl';
import { zplAction, zplSetup } from './zpl';

/** 生成的指令（ASCII 文字，空字符串 = 没有要发的）；ok 为 false 时 issue 是给操作员看的中文原因。 */
export type CommandBuild = { ok: true; text: string } | { ok: false; issue: string };

/** 设置里有这种指令集没有的值时，给操作员的说明；都合适返回 null。 */
export function checkForCommandSet(set: CommandSet, config: PrinterCommandConfig, dpi: number): string | null {
  const limits = COMMAND_SET_LIMITS[set];
  const name = COMMAND_SET_NAMES[set];
  const { density, speed, finish, media } = config;
  if (density !== null && (density < limits.density.min || density > limits.density.max)) {
    return `${name} 的浓度是 ${limits.density.min}–${limits.density.max}，现在是 ${density}：请重新选浓度`;
  }
  if (speed !== null && !limits.speeds.includes(speed)) {
    return `${name} 没有这个速度（${speed}）：请重新选速度`;
  }
  if (finish !== null && !limits.canSetFinish) {
    return `${name} 不能设出纸方式（撕纸 / 剥离）：请改成「不改」`;
  }
  if (set === 'epl' && media !== null) {
    return eplGapIssue(media, dpi);
  }
  return null;
}

/** 保存时发一次的设置。dpi 只有 ZPL、EPL 用（宽高按打印点）。 */
export function buildSetup(set: CommandSet, config: PrinterCommandConfig, dpi: number): CommandBuild {
  const issue = checkForCommandSet(set, config, dpi);
  if (issue !== null) {
    return { ok: false, issue };
  }
  switch (set) {
    case 'tspl':
      return { ok: true, text: tsplSetup(config) };
    case 'zpl':
      return { ok: true, text: zplSetup(config, dpi) };
    case 'epl':
      return { ok: true, text: eplSetup(config, dpi) };
  }
}

/** 动作指令；这种指令集没有恢复出厂设置时说明原因。 */
export function buildAction(set: CommandSet, action: PrinterAction, config: PrinterCommandConfig): CommandBuild {
  if (action === 'factoryReset' && !COMMAND_SET_LIMITS[set].canFactoryReset) {
    return { ok: false, issue: `${COMMAND_SET_NAMES[set]} 没有恢复出厂设置的指令` };
  }
  switch (set) {
    case 'tspl':
      return { ok: true, text: tsplAction(action, config) };
    case 'zpl':
      return { ok: true, text: zplAction(action) };
    case 'epl':
      return { ok: true, text: eplAction(action) };
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/printer-commands`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/printer-commands/printer-commands.ts src/core/printer-commands/printer-commands.test.ts
git commit -m "feat(printer-commands): dispatch by command set and check ranges before sending" -m "Configs saved under auto may hold values the detected command set does not have; they are refused with a message naming the field instead of being clamped silently." -m "$TRAILER"
```

---

### Task 7: 设置里的 printerCommands 和共用类型

**Files:**
- Create: `src/shared/printer-commands.ts`
- Modify: `src/shared/settings.ts`、`src/shared/settings.test.ts`

- [ ] **Step 1: 写测试**

`settings.test.ts` 的 import 列表里按字母顺序加上 `MAX_PRINTER_COMMAND_ENTRIES`。已有的「keeps valid values」测试拼的是完整的 `AppSettings`：在 `apiAuthorizedOrigins` 那一项后面加

```ts
      printerCommands: {
        标签机A: { commandSet: 'tspl', density: 8, speed: 4, media: null, orientation: null, finish: 'tear', dpi: null },
      },
```

文件末尾追加：

```ts
describe('printerCommands', () => {
  test('keeps each printer config and turns bad values into 不改', () => {
    const settings = sanitizeSettings({
      printerCommands: {
        标签机A: { commandSet: 'tspl', density: 99, speed: 4, media: null, orientation: 'sideways', finish: 'tear' },
        '': { commandSet: 'zpl' },
      },
    });
    expect(settings.printerCommands).toEqual({
      标签机A: { commandSet: 'tspl', density: null, speed: 4, media: null, orientation: null, finish: 'tear', dpi: null },
    });
  });

  test('keeps at most MAX_PRINTER_COMMAND_ENTRIES printers', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PRINTER_COMMAND_ENTRIES + 1 }, (_, index) => [`打印机${index}`, { commandSet: 'none' }]),
    );
    expect(Object.keys(sanitizeSettings({ printerCommands: many }).printerCommands)).toHaveLength(
      MAX_PRINTER_COMMAND_ENTRIES,
    );
  });

  // 打印机名来自系统：名为 __proto__ 的打印机只是普通的键，不能改到原型。
  test('stores a printer named __proto__ as a plain own key', () => {
    const settings = sanitizeSettings(JSON.parse('{"printerCommands":{"__proto__":{"commandSet":"epl"}}}'));
    expect(Object.getPrototypeOf(settings.printerCommands)).toBe(Object.prototype);
    expect(Object.hasOwn(settings.printerCommands, '__proto__')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/settings.test.ts`
Expected: FAIL，`MAX_PRINTER_COMMAND_ENTRIES` 没有导出、`printerCommands` 不在结果里。

- [ ] **Step 3: 共用类型**

```ts
// src/shared/printer-commands.ts
import type { CommandSet, DetectedCommandSet, PrinterCommandConfig } from '../core/printer-commands/command-model';

/**
 * 发不出去的原因。Windows 按 winspool 的错误码分：找不到打印机、没有权限、驱动不收 RAW；
 * uncertain = 系统的打印服务没有及时回应，不知道发没发出去；unsupported = 这个平台不能直接发；其余为 error。
 */
export const RAW_SEND_FAILURES = [
  'not-found',
  'access-denied',
  'raw-rejected',
  'uncertain',
  'unsupported',
  'error',
] as const;
export type RawSendFailureKind = (typeof RAW_SEND_FAILURES)[number];

/** 没有发送的原因：设为不发指令、「自动」认不出、各项都是「不改」。 */
export type NotSentReason = 'no-command-set' | 'unknown-command-set' | 'nothing-to-send';

/** 保存设置、执行动作的结果。sent 只表示交给了系统的打印服务，打印机有没有照做程序不知道。 */
export type PrinterCommandResult =
  | { status: 'sent'; commandSet: CommandSet }
  | { status: 'not-sent'; reason: NotSentReason }
  | { status: 'invalid'; issue: string }
  | { status: 'failed'; reason: RawSendFailureKind; detail: string };

/** 「标签机指令」面板要的：保存的设置、「自动」认出的指令集、驱动名、驱动报告的分辨率。 */
export interface PrinterCommandsView {
  config: PrinterCommandConfig;
  /** 「自动」会用的指令集（和当前选的是什么无关）；认不出为 null。 */
  detected: DetectedCommandSet | null;
  driverName: string | null;
  /** 驱动报告的分辨率；读不到为 null（ZPL、EPL 换算时按 203dpi）。 */
  driverDpi: number | null;
}
```

- [ ] **Step 4: 设置**

`src/shared/settings.ts`：

1. import 区按字母顺序加：

```ts
import type { PrinterCommandConfig } from '../core/printer-commands/command-model';
import { sanitizeCommandConfig } from '../core/printer-commands/sanitize-command-config';
```

2. `AppSettings` 的 `apiAuthorizedOrigins` 之后加：

```ts
  /**
   * 每台打印机的标签机指令设置（指令集、浓度、速度、纸张……）：键是系统打印机名。
   * 只在操作员点「保存并发送」时经 printer:commands-apply 写入并发给打印机一次，打印前不再发。
   */
  printerCommands: Record<string, PrinterCommandConfig>;
```

3. `MAX_AUTHORIZED_ORIGINS` 之后加：

```ts
/** 最多为这么多台打印机保存指令设置：和纸张分配一样，一台电脑用不到这么多；防止异常数据撑大设置。 */
export const MAX_PRINTER_COMMAND_ENTRIES = 32;
```

4. `DEFAULT_SETTINGS` 末尾加 `printerCommands: {},`；`sanitizeSettings` 返回值末尾加 `printerCommands: sanitizePrinterCommands(input['printerCommands']),`。

5. `sanitizePrinterName` 之后加：

```ts
function sanitizePrinterCommands(value: unknown): Record<string, PrinterCommandConfig> {
  if (!isRecord(value)) {
    return {};
  }
  const entries: [string, PrinterCommandConfig][] = [];
  for (const [name, config] of Object.entries(value)) {
    if (sanitizePrinterName(name) !== null && entries.length < MAX_PRINTER_COMMAND_ENTRIES) {
      entries.push([name, sanitizeCommandConfig(config)]);
    }
  }
  // fromEntries 按「定义自己的属性」写入：名为 __proto__ 的打印机也只是一个普通的键。
  return Object.fromEntries(entries);
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/shared src/core/printer-commands`
Expected: PASS。`bun run check` 的类型检查会找出其他拼完整 `AppSettings` 的地方（写计划时只有 `settings.test.ts`），照上面补上。

- [ ] **Step 6: 提交**

```bash
git add src/shared/printer-commands.ts src/shared/settings.ts src/shared/settings.test.ts
git commit -m "feat(settings): store label printer commands per printer" -m "Printer command settings live in the settings table like the paper assignment, so no database migration is needed. Each entry goes through the command config sanitizer and printer names such as __proto__ stay plain keys." -m "$TRAILER"
```

---

### Task 8: 探测进程：驱动名和原样发送（winspool RAW）

现在的行协议是「命令 空格 打印机名的 base64」。改成最多三段：「命令 名字的 base64 [数据的 base64]」；新增 `driver`（`Get-Printer` 的 `DriverName`）和 `raw`（P/Invoke winspool）。回答仍是一行；Win32 错误写成 `err win32:<错误码> <说明>`，上层按错误码分类。C# 第一次收到 `raw` 时才 `Add-Type` 编译（约 1 秒 CPU），状态、纸张查询不受影响。

**Files:**
- Modify: `src/main/printing/printer-probe-host.ts`、`src/main/printing/printer-probe-host.test.ts`

- [ ] **Step 1: 写测试**（`printer-probe-host.test.ts` 的 import 改为下面两行，在 `describe('PrinterProbeHost')` 末尾追加用例）

```ts
import { RAW_COMMAND_MAX_BYTES } from '../../core/printer-commands/command-model';
import {
  PROBE_QUERY_TIMEOUT_MS,
  PrinterProbeHost,
  type ProbeProcess,
  probeArguments,
  spawnPowerShellProbe,
} from './printer-probe-host';
```

```ts
  test('asks for the driver name with its own command', async () => {
    const { host, spawned } = harness();
    const answer = host.query('driver', '标签机A');
    const probe = spawned[0] as FakeProbe;
    expect(await nextRequests(probe, 1)).toEqual([`driver ${base64('标签机A')}`]);
    probe.reply('ok Label Printer TSPL');
    expect(await answer).toBe('Label Printer TSPL');
  });

  test('sends raw bytes and the printer name as base64 data on one line', async () => {
    const { host, spawned } = harness();
    const bytes = Buffer.from('FORMFEED\r\n');
    const answer = host.sendRaw('热敏标签机', bytes);
    const probe = spawned[0] as FakeProbe;
    expect(await nextRequests(probe, 1)).toEqual([`raw ${base64('热敏标签机')} ${bytes.toString('base64')}`]);
    probe.reply('ok 17');
    expect(await answer).toEqual({ ok: true, payload: '17' });
  });

  test('passes the winspool error of a failed raw send to the caller', async () => {
    const { host, spawned } = harness();
    const answer = host.sendRaw('A', Buffer.from('FORMFEED\r\n'));
    const probe = spawned[0] as FakeProbe;
    await nextRequests(probe, 1);
    probe.reply('err win32:1804 StartDocPrinter failed: 数据类型无效。');
    expect(await answer).toEqual({ ok: false, error: 'win32:1804 StartDocPrinter failed: 数据类型无效。' });
  });

  // 超时、进程退出：不知道打印机收没收到，上层按「不确定」处理。
  test('cannot tell whether a raw send happened when the probe stops answering', async () => {
    const { host } = harness();
    expect(await host.sendRaw('A', Buffer.from('FORMFEED\r\n'))).toEqual({ ok: false, error: null });
  });

  test('refuses an empty or oversized raw payload before writing anything', () => {
    const { host, spawned } = harness();
    expect(() => host.sendRaw('A', new Uint8Array(0))).toThrow(RangeError);
    expect(() => host.sendRaw('A', new Uint8Array(RAW_COMMAND_MAX_BYTES + 1))).toThrow(RangeError);
    expect(spawned).toHaveLength(0);
  });

  // 脚本整段经 -EncodedCommand 传入：加了 C# 之后整条命令行仍要在 CreateProcess 的 32767 字符以内。
  test('keeps the encoded probe script inside the Windows command line limit', () => {
    const commandLine = ['powershell.exe', ...probeArguments()].join(' ');
    expect(commandLine.length).toBeLessThan(WINDOWS_COMMAND_LINE_MAX_CHARS);
  });

  // 只在 Windows 上：真的启动 PowerShell、编译 C#、调用 winspool。向一台不存在的打印机发送，
  // 应当拿到带错误码的 Win32 错误（后台打印服务在跑是 1801，没跑可能是 1722），证明编译和 P/Invoke 都通了。
  test.skipIf(process.platform !== 'win32')(
    'compiles the raw helper and reports winspool errors with their code',
    async () => {
      const host = new PrinterProbeHost(spawnPowerShellProbe, REAL_PROBE_TIMEOUT_MS, () => {});
      try {
        const reply = await host.sendRaw('LabelFlash 测试用的不存在的打印机', Buffer.from('\r\n'));
        expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/^win32:\d+ OpenPrinter failed/) });
      } finally {
        host.dispose();
      }
    },
    REAL_PROBE_TEST_TIMEOUT_MS,
  );
```

文件顶部 `TIMEOUT_MS` 之后加：

```ts
/** Windows 命令行的长度上限（CreateProcess）。 */
const WINDOWS_COMMAND_LINE_MAX_CHARS = 32_767;
/** 真 PowerShell 第一次要加载模块、编译 C#：给足时间。 */
const REAL_PROBE_TIMEOUT_MS = PROBE_QUERY_TIMEOUT_MS * 2;
const REAL_PROBE_TEST_TIMEOUT_MS = REAL_PROBE_TIMEOUT_MS + 5_000;
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/printer-probe-host.test.ts`
Expected: FAIL，`sendRaw`、`probeArguments` 不存在（类型检查同样报错）。

- [ ] **Step 3: 实现**（整个文件换成下面的内容）

```ts
// src/main/printing/printer-probe-host.ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { RAW_COMMAND_MAX_BYTES } from '../../core/printer-commands/command-model';
import { BRAND } from '../../shared/brand';

export type ProbeCommand = 'status' | 'paper' | 'driver';

/**
 * 一次请求的回答：ok 带内容；否则 error 是探测进程报的原因（Win32 错误写成「win32:<错误码> <说明>」）。
 * error 为 null 表示进程超时或退出了：不知道这次请求做到了哪一步。
 */
export type ProbeReply = { ok: true; payload: string } | { ok: false; error: string | null };

/** 常驻探测进程需要的最小接口（便于测试替换成假进程）。 */
export interface ProbeProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** 首次查询包含 PowerShell 启动和模块加载（约 1–2 秒），之后每次约十几毫秒。 */
export const PROBE_QUERY_TIMEOUT_MS = 10_000;
const MAX_STDERR_LOG_LENGTH = 500;

/**
 * 原样发送字节（RAW）的 C# 辅助类，探测进程第一次收到 raw 请求时用 Add-Type 编译，之后复用。
 * - 用 Unicode 版的 winspool 函数（OpenPrinterW、StartDocPrinterW）：中文打印机名不受系统代码页影响。
 * - 数据类型 RAW：打印处理器不加工，字节原样交给端口；驱动不收 RAW 时 StartDocPrinter 报 ERROR_INVALID_DATATYPE（1804）。
 * - 只用 C# 5 的语法：Windows PowerShell 5.1 的 Add-Type 用 .NET Framework 自带的编译器。
 * - 每一步失败都抛 Win32Exception，带 GetLastWin32Error 的错误码；EndPagePrinter 会改掉错误码，所以先取再收尾。
 */
const RAW_PRINTER_CSHARP = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace LabelFlash {
  public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class DocInfo1 {
      public string pDocName;
      public string pOutputFile;
      public string pDatatype;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr printer, int level, [In] DocInfo1 docInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);

    public static int Send(string printerName, string documentName, byte[] data) {
      IntPtr printer;
      if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) {
        throw Failure("OpenPrinter");
      }
      try {
        DocInfo1 info = new DocInfo1();
        info.pDocName = documentName;
        info.pOutputFile = null;
        info.pDatatype = "RAW";
        int jobId = StartDocPrinter(printer, 1, info);
        if (jobId == 0) {
          throw Failure("StartDocPrinter");
        }
        try {
          if (!StartPagePrinter(printer)) {
            throw Failure("StartPagePrinter");
          }
          int written;
          bool isWritten = WritePrinter(printer, data, data.Length, out written);
          int writeError = Marshal.GetLastWin32Error();
          EndPagePrinter(printer);
          if (!isWritten) {
            throw new Win32Exception(writeError, "WritePrinter failed: " + new Win32Exception(writeError).Message);
          }
          if (written != data.Length) {
            throw new InvalidOperationException("WritePrinter wrote " + written + " of " + data.Length + " bytes");
          }
        } finally {
          EndDocPrinter(printer);
        }
        return jobId;
      } finally {
        ClosePrinter(printer);
      }
    }

    private static Win32Exception Failure(string step) {
      int code = Marshal.GetLastWin32Error();
      return new Win32Exception(code, step + " failed: " + new Win32Exception(code).Message);
    }
  }
}
`;

/**
 * 常驻的 PowerShell 循环：每读一行请求就回答一行。
 * - 请求：「命令 空格 打印机名的 UTF-8 base64 [空格 数据的 base64]」。名字和数据只作为数据解码，永远不会被拼进脚本执行；
 *   base64 也绕开了控制台代码页（中文打印机名不会乱码）。
 * - 回答：「ok 内容」或「err 原因」，内容保证只有一行；Win32 错误写成「err win32:<错误码> <说明>」。
 * - Get-Printer -Name 支持通配符，名字要先转义；纸张用 Where-Object 精确匹配，不拼进 WQL。
 * - raw：数据 1–RAW_COMMAND_MAX_BYTES 字节（主进程查过，这里再查一次）；C# 第一次用到时才编译。
 * - 输出被重定向时，PowerShell 会把加载模块的进度条序列化成 CLIXML 写到 stderr，所以关掉进度输出。
 */
const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$rawPrinterSource = @'
${RAW_PRINTER_CSHARP}
'@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $reply = ''
  try {
    $command, $encoded, $payload = $line.Split(' ', 3)
    $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    switch ($command) {
      'status' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + $printer.PrinterStatus.ToString()
      }
      'paper' {
        $config = Get-CimInstance -ClassName Win32_PrinterConfiguration | Where-Object Name -eq $name | Select-Object -First 1
        $reply = 'ok '
        if ($config) {
          $reply += ($config | Select-Object PaperWidth, PaperLength, HorizontalResolution | ConvertTo-Json -Compress)
        }
      }
      'driver' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + ($printer.DriverName -replace '\\s+', ' ')
      }
      'raw' {
        $data = [Convert]::FromBase64String($payload)
        if ($data.Length -lt 1 -or $data.Length -gt ${RAW_COMMAND_MAX_BYTES}) {
          throw ('raw payload has ' + $data.Length + ' bytes')
        }
        if ($null -eq ('LabelFlash.RawPrinter' -as [type])) {
          Add-Type -TypeDefinition $rawPrinterSource
        }
        $reply = 'ok ' + [LabelFlash.RawPrinter]::Send($name, '${BRAND.productNameAscii}', $data)
      }
      default { $reply = 'err unknown command ' + $command }
    }
  } catch {
    $win32 = $_.Exception.InnerException -as [ComponentModel.Win32Exception]
    if ($null -ne $win32) {
      $reply = 'err win32:' + $win32.NativeErrorCode + ' ' + ($win32.Message -replace '\\s+', ' ')
    } else {
      $reply = 'err ' + ($_.Exception.Message -replace '\\s+', ' ')
    }
  }
  [Console]::Out.WriteLine($reply)
  [Console]::Out.Flush()
}
`;

/** powershell.exe 的参数。-EncodedCommand（UTF-16LE base64）：多行脚本原样传入，不受命令行引号转义规则影响。 */
export function probeArguments(): string[] {
  const encoded = Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded];
}

export function spawnPowerShellProbe(): ProbeProcess {
  return spawn('powershell.exe', probeArguments(), { windowsHide: true });
}

interface PendingQuery {
  resolve: (reply: ProbeReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

function encodeName(printerName: string): string {
  return Buffer.from(printerName, 'utf8').toString('base64');
}

/**
 * 打印机状态、驱动纸张、驱动名的查询和标签机指令的发送都经过这一个常驻进程。每次都新起 powershell.exe 要约 1 秒 CPU，
 * 按 5 秒一次轮询相当于长期占掉四分之一个核；常驻之后每次查询只要十几毫秒。
 * 请求按顺序排队，回答也按顺序到达；进程退出、出错或卡住时，所有未完成的请求按「不知道」返回，
 * 下一次请求自动重新启动进程。
 */
export class PrinterProbeHost {
  private process: ProbeProcess | null = null;
  private readonly pending: PendingQuery[] = [];

  constructor(
    private readonly spawnProcess: () => ProbeProcess,
    private readonly timeoutMs: number,
    private readonly warn: (message: string) => void,
  ) {}

  /** 返回回答内容；查询失败、超时或进程异常时返回 null（按未知处理，不阻止打印）。 */
  async query(command: ProbeCommand, printerName: string): Promise<string | null> {
    const reply = await this.request(command, encodeName(printerName));
    return reply.ok ? reply.payload : null;
  }

  /**
   * 把字节原样发给打印机（winspool，数据类型 RAW），回答里是后台打印队列的任务号。
   * 长度不在 1–RAW_COMMAND_MAX_BYTES 是调用方的错：立即抛 RangeError，不写给进程。
   */
  sendRaw(printerName: string, data: Uint8Array): Promise<ProbeReply> {
    if (data.length === 0 || data.length > RAW_COMMAND_MAX_BYTES) {
      throw new RangeError(`Raw printer commands must be 1-${RAW_COMMAND_MAX_BYTES} bytes, got ${data.length}`);
    }
    return this.request('raw', `${encodeName(printerName)} ${Buffer.from(data).toString('base64')}`);
  }

  dispose(): void {
    if (this.process) {
      this.stop(this.process);
    }
  }

  private request(command: string, args: string): Promise<ProbeReply> {
    const child = this.ensureProcess();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.warn(`[printer-probe] ${command} query timed out after ${this.timeoutMs}ms, restarting the probe`);
        this.stop(child);
      }, this.timeoutMs);
      this.pending.push({ resolve, timer });
      child.stdin.write(`${command} ${args}\n`);
    });
  }

  private ensureProcess(): ProbeProcess {
    if (this.process) {
      return this.process;
    }
    const child = this.spawnProcess();
    this.process = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.onReply(line));
    child.stderr.on('data', (chunk: Buffer) => {
      this.warn(`[printer-probe] stderr: ${chunk.toString('utf8').slice(0, MAX_STDERR_LOG_LENGTH)}`);
    });
    child.stdin.on('error', (error) => {
      this.warn(`[printer-probe] could not send a query: ${error.message}`);
      this.stop(child);
    });
    child.once('error', (error) => {
      this.warn(`[printer-probe] could not start PowerShell: ${error.message}`);
      this.stop(child);
    });
    child.once('exit', (code) => {
      if (this.process === child) {
        this.warn(`[printer-probe] PowerShell exited with code ${code}`);
      }
      this.stop(child);
    });
    return child;
  }

  private onReply(line: string): void {
    const query = this.pending.shift();
    if (!query) {
      this.warn(`[printer-probe] unexpected output: ${line}`);
      return;
    }
    clearTimeout(query.timer);
    if (line.startsWith('ok')) {
      query.resolve({ ok: true, payload: line.slice('ok'.length).trim() });
    } else {
      const error = line.replace(/^err\s*/, '');
      this.warn(`[printer-probe] query failed: ${error}`);
      query.resolve({ ok: false, error });
    }
  }

  /** 丢弃这个进程：未完成的请求全部按「不知道」返回，下次请求重新启动。 */
  private stop(child: ProbeProcess): void {
    if (this.process !== child) {
      return;
    }
    this.process = null;
    for (const query of this.pending.splice(0)) {
      clearTimeout(query.timer);
      query.resolve({ ok: false, error: null });
    }
    child.kill();
  }
}
```

注意：`PROBE_SCRIPT` 是 JS 模板字符串，`${RAW_PRINTER_CSHARP}`、`${RAW_COMMAND_MAX_BYTES}`、`${BRAND.productNameAscii}` 三处是有意的插值；C# 源码里不能出现反引号和 `${`。here-string 的结束标记 `'@` 必须在行首。

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/printing/printer-probe-host.test.ts`
Expected: PASS；在 Windows 上最后一个用例真的启动 PowerShell（约 2–5 秒），macOS 上跳过。再跑 `bun test src/main/printing` 确认状态和纸张查询的测试不受影响。

- [ ] **Step 5（Windows，可选，真机前）: 不接标签机核对字节**

用管理员身份在「设置 › 打印机和扫描仪」添加一台打印机：本地端口选「新端口 › Local Port」，端口名填一个文件路径（例如 `C:\labelflash-raw\out.prn`），驱动选「Generic / Text Only」，名字「RAW 文件」。然后在 Git Bash 里：

```bash
cd /d/project/LabelFlash && bun -e "import { PrinterProbeHost, spawnPowerShellProbe } from './src/main/printing/printer-probe-host'; const host = new PrinterProbeHost(spawnPowerShellProbe, 20000, console.warn); console.log(await host.sendRaw('RAW 文件', Buffer.from('FORMFEED\r\n'))); host.dispose();"
```

Expected: `{ ok: true, payload: '<任务号>' }`，`C:\labelflash-raw\out.prn` 的内容逐字节是 `FORMFEED\r\n`（用 `Format-Hex` 看）。结果写进 `docs/windows-acceptance.md`（Task 18）。试完删掉这台打印机（删除前先问用户）。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/printing/printer-probe-host.ts src/main/printing/printer-probe-host.test.ts
git commit -m "feat(printing): send raw commands and read driver names through the resident probe" -m "The resident PowerShell probe gets a third line field for base64 data, a driver query and a raw command that P/Invokes winspool with the RAW datatype. The C# helper is compiled on first use only, so status and paper polling keep their cost. Win32 errors come back with their code so the caller can tell a missing printer, a permission problem and a driver that refuses RAW apart. No native module is added." -m "$TRAILER"
```

---

### Task 9: RawSender：Windows、macOS、不支持

**Files:**
- Create: `src/main/printing/raw-sender.ts`、`src/main/printing/raw-sender.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/printing/raw-sender.test.ts
import { describe, expect, test } from 'bun:test';
import {
  asciiBytes,
  createRawSender,
  LP_TIMEOUT_MS,
  MacRawSender,
  type ProcessOutcome,
  type RunWithInput,
  rawResultFromProbe,
  runWithInput,
  WindowsRawSender,
} from './raw-sender';

const TITLE = 'CDL-LabelFlash';
const FEED = Buffer.from('FORMFEED\r\n');
/** 子进程测试的时限：起一个 Bun 进程不到 1 秒。 */
const CHILD_TIMEOUT_MS = 5_000;
/** 「超时」用例：子进程会一直等，这么久就结束它。 */
const SHORT_TIMEOUT_MS = 200;

describe('rawResultFromProbe', () => {
  test('treats an answer from the spooler as sent', () => {
    expect(rawResultFromProbe({ ok: true, payload: '17' })).toEqual({ ok: true });
  });

  test('maps winspool error codes to what the operator can do', () => {
    const cases = [
      ['win32:1801 OpenPrinter failed: 打印机名无效。', 'not-found'],
      ['win32:5 OpenPrinter failed: 拒绝访问。', 'access-denied'],
      ['win32:1804 StartDocPrinter failed: 数据类型无效。', 'raw-rejected'],
      ['win32:31 WritePrinter failed: 连到系统上的设备没有发挥作用。', 'error'],
      ['raw payload has 0 bytes', 'error'],
    ] as const;
    for (const [error, kind] of cases) {
      expect(rawResultFromProbe({ ok: false, error })).toEqual({ ok: false, failure: { kind, detail: error } });
    }
  });

  test('cannot tell whether it was sent when the probe stopped answering', () => {
    expect(rawResultFromProbe({ ok: false, error: null })).toMatchObject({ ok: false, failure: { kind: 'uncertain' } });
  });
});

describe('WindowsRawSender', () => {
  test('sends through the probe and maps its answer', async () => {
    const calls: string[] = [];
    const sender = new WindowsRawSender({
      sendRaw: async (printerName, data) => {
        calls.push(`${printerName}:${Buffer.from(data).toString('latin1')}`);
        return { ok: true, payload: '3' };
      },
    });
    expect(await sender.send('标签机A', FEED)).toEqual({ ok: true });
    expect(calls).toEqual(['标签机A:FORMFEED\r\n']);
  });
});

describe('MacRawSender', () => {
  function senderWith(outcome: ProcessOutcome) {
    const calls: { file: string; args: string[]; input: string; timeoutMs: number }[] = [];
    const run: RunWithInput = async (file, args, input, timeoutMs) => {
      calls.push({ file, args: [...args], input: Buffer.from(input).toString('latin1'), timeoutMs });
      return outcome;
    };
    return { sender: new MacRawSender(run, TITLE), calls };
  }

  test('pipes the bytes to lp with the raw option, without a shell', async () => {
    const { sender, calls } = senderWith({
      code: 0,
      stdout: 'request id is Label-12 (1 file(s))\n',
      stderr: '',
      timedOut: false,
    });
    expect(await sender.send('Label_Printer', FEED)).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        file: '/usr/bin/lp',
        args: ['-d', 'Label_Printer', '-o', 'raw', '-t', TITLE],
        input: 'FORMFEED\r\n',
        timeoutMs: LP_TIMEOUT_MS,
      },
    ]);
  });

  test('reports what lp printed when it fails', async () => {
    const { sender } = senderWith({
      code: 1,
      stdout: '',
      stderr: 'lp: The printer or class does not exist.\n',
      timedOut: false,
    });
    expect(await sender.send('Gone', FEED)).toEqual({
      ok: false,
      failure: { kind: 'error', detail: 'lp: The printer or class does not exist.' },
    });
  });

  test('treats an lp that does not finish as uncertain', async () => {
    const { sender } = senderWith({ code: null, stdout: '', stderr: '', timedOut: true });
    expect(await sender.send('Busy', FEED)).toMatchObject({ ok: false, failure: { kind: 'uncertain' } });
  });
});

describe('createRawSender', () => {
  test('refuses platforms without a raw path', async () => {
    expect(await createRawSender('linux', null).send('A', FEED)).toMatchObject({
      ok: false,
      failure: { kind: 'unsupported' },
    });
    // 探测进程没起来（例如用着假打印机）时 Windows 也发不了。
    expect(await createRawSender('win32', null).send('A', FEED)).toMatchObject({
      ok: false,
      failure: { kind: 'unsupported' },
    });
  });
});

describe('runWithInput', () => {
  // 用正在跑测试的 Bun 自己当子进程：两个平台都有，把标准输入原样写回标准输出。
  test('pipes the input to the program and collects its output', async () => {
    const echo = 'Bun.stdin.text().then((text) => process.stdout.write(text))';
    expect(await runWithInput(process.execPath, ['-e', echo], FEED, CHILD_TIMEOUT_MS)).toEqual({
      code: 0,
      stdout: 'FORMFEED\r\n',
      stderr: '',
      timedOut: false,
    });
  });

  test('ends a program that runs too long', async () => {
    const outcome = await runWithInput(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], FEED, SHORT_TIMEOUT_MS);
    expect(outcome.timedOut).toBe(true);
  });
});

describe('asciiBytes', () => {
  test('encodes command text byte for byte', () => {
    expect([...asciiBytes('~PH\n')]).toEqual([0x7e, 0x50, 0x48, 0x0a]);
  });

  test('fails fast on anything that is not ASCII', () => {
    expect(() => asciiBytes('SIZE 60 mm,40 mm\r\n纸')).toThrow('ASCII');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/raw-sender.test.ts`
Expected: FAIL，`Cannot find module './raw-sender'`。

- [ ] **Step 3: 实现**

```ts
// src/main/printing/raw-sender.ts
import { spawn } from 'node:child_process';
import { BRAND } from '../../shared/brand';
import type { RawSendFailureKind } from '../../shared/printer-commands';
import type { PrinterProbeHost, ProbeReply } from './printer-probe-host';

/**
 * 发送结果：ok 只表示系统的打印服务收下了（Windows 进了后台打印队列，macOS 交给了 CUPS），
 * 打印机有没有照做程序不知道。
 */
export type RawSendResult = { ok: true } | { ok: false; failure: RawSendFailure };

export interface RawSendFailure {
  kind: RawSendFailureKind;
  /** 原始说明：写日志；界面只在 kind 为 error 时摘一段显示。 */
  detail: string;
}

/** 把字节原样发给一台系统打印机。调用方保证打印机在系统列表里、字节是我们生成的指令。 */
export interface RawSender {
  send(printerName: string, data: Uint8Array): Promise<RawSendResult>;
}

/** winspool 的错误码 → 操作员能做什么。 */
const WIN32_FAILURES: Readonly<Record<number, RawSendFailureKind>> = {
  /** ERROR_ACCESS_DENIED */
  5: 'access-denied',
  /** ERROR_INVALID_PRINTER_NAME */
  1801: 'not-found',
  /** ERROR_INVALID_DATATYPE：这台打印机的打印处理器不收 RAW 数据。 */
  1804: 'raw-rejected',
};
const WIN32_ERROR_PATTERN = /^win32:(\d+) /;

/** 探测进程的回答 → 发送结果。 */
export function rawResultFromProbe(reply: ProbeReply): RawSendResult {
  if (reply.ok) {
    return { ok: true };
  }
  if (reply.error === null) {
    return { ok: false, failure: { kind: 'uncertain', detail: 'the printer probe stopped answering' } };
  }
  const code = Number(WIN32_ERROR_PATTERN.exec(reply.error)?.[1]);
  return { ok: false, failure: { kind: WIN32_FAILURES[code] ?? 'error', detail: reply.error } };
}

/** Windows：经常驻探测进程调用 winspool（见 printer-probe-host.ts）。 */
export class WindowsRawSender implements RawSender {
  constructor(private readonly host: Pick<PrinterProbeHost, 'sendRaw'>) {}

  async send(printerName: string, data: Uint8Array): Promise<RawSendResult> {
    return rawResultFromProbe(await this.host.sendRaw(printerName, data));
  }
}

/** lp 只把任务交给 CUPS 排队，正常不到 1 秒；和探测进程一样等 10 秒，还没结束说明 CUPS 卡住了。 */
export const LP_TIMEOUT_MS = 10_000;
const LP_PATH = '/usr/bin/lp';
/** 子进程的输出只留这么多字：lp 正常只回一行。 */
const MAX_OUTPUT_CHARS = 2_000;
const ASCII_MAX = 0x7f;

export interface ProcessOutcome {
  /** 退出码；没起来或被结束时为 null。 */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 起一个子进程，把 input 写进它的标准输入（测试里换成假的）。 */
export type RunWithInput = (
  file: string,
  args: readonly string[],
  input: Uint8Array,
  timeoutMs: number,
) => Promise<ProcessOutcome>;

/**
 * lp 的参数：-d 队列名（参数数组传入，不经过 shell）；-o raw 不经 CUPS 的过滤器，字节原样交给后端；
 * -t 任务名；不给文件名时 lp 从标准输入读。
 */
export function lpArguments(printerName: string, title: string): string[] {
  return ['-d', printerName, '-o', 'raw', '-t', title];
}

/** macOS：`lp -o raw`，字节走标准输入。 */
export class MacRawSender implements RawSender {
  constructor(
    private readonly run: RunWithInput,
    private readonly title: string,
  ) {}

  async send(printerName: string, data: Uint8Array): Promise<RawSendResult> {
    const outcome = await this.run(LP_PATH, lpArguments(printerName, this.title), data, LP_TIMEOUT_MS);
    if (outcome.timedOut) {
      return { ok: false, failure: { kind: 'uncertain', detail: `lp did not finish within ${LP_TIMEOUT_MS}ms` } };
    }
    if (outcome.code !== 0) {
      const detail = (outcome.stderr || outcome.stdout).trim() || `lp exited with code ${outcome.code}`;
      return { ok: false, failure: { kind: 'error', detail } };
    }
    return { ok: true };
  }
}

/** 不经过 shell 起子进程，把 input 写进标准输入；超时就结束它。 */
export const runWithInput: RunWithInput = (file, args, input, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let isSettled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const settle = (outcome: ProcessOutcome) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve(outcome);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(0, MAX_OUTPUT_CHARS);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, MAX_OUTPUT_CHARS);
    });
    // 子进程提前退出时写标准输入会出错：原因记进 stderr，结果由退出码说明。
    child.stdin.on('error', (error) => {
      stderr = `${stderr}${error.message}`.slice(0, MAX_OUTPUT_CHARS);
    });
    child.once('error', (error) => settle({ code: null, stdout, stderr: error.message, timedOut: false }));
    child.once('close', (code) => settle({ code, stdout, stderr, timedOut }));
    child.stdin.end(Buffer.from(input));
  });

function unsupportedSender(detail: string): RawSender {
  return { send: async () => ({ ok: false, failure: { kind: 'unsupported', detail } }) };
}

/** 按平台选发送方式：Windows 要有探测进程；macOS 用 lp；其他平台不支持。 */
export function createRawSender(platform: NodeJS.Platform, host: PrinterProbeHost | null): RawSender {
  switch (platform) {
    case 'win32':
      return host === null ? unsupportedSender('the printer probe is not running') : new WindowsRawSender(host);
    case 'darwin':
      return new MacRawSender(runWithInput, BRAND.productNameAscii);
    default:
      return unsupportedSender(`raw printer commands are not supported on ${platform}`);
  }
}

/** 指令都是 ASCII：生成的文字里有别的字符说明生成器错了，立即抛出，不把乱码发给打印机。 */
export function asciiBytes(text: string): Uint8Array {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > ASCII_MAX) {
      throw new Error(`Printer commands must be ASCII, got code ${text.charCodeAt(index)} at ${index}`);
    }
  }
  return Buffer.from(text, 'ascii');
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/printing/raw-sender.test.ts`
Expected: PASS（两个平台都跑得了：子进程用的是 Bun 自己）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/printing/raw-sender.ts src/main/printing/raw-sender.test.ts
git commit -m "feat(printing): raw command senders for Windows and macOS" -m "Windows sends through the resident probe and classifies winspool error codes; macOS pipes the bytes to lp -o raw without a shell; other platforms report unsupported. A probe that stops answering or an lp that hangs is reported as uncertain, because the commands may or may not have reached the printer." -m "$TRAILER"
```

---

### Task 10: 驱动名（「自动」认指令集用）

**Files:**
- Modify: `src/main/printing/driver-paper.ts`
- Create: `src/main/printing/printer-identity.ts`、`src/main/printing/printer-identity.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/printing/printer-identity.test.ts
import { describe, expect, test } from 'bun:test';
import { parseDriverName, parseIppMakeAndModel } from './printer-identity';

describe('parseDriverName (Windows)', () => {
  test('trims the driver name and treats an empty answer as unknown', () => {
    expect(parseDriverName(' Label Printer TSPL \r\n')).toBe('Label Printer TSPL');
    expect(parseDriverName('')).toBeNull();
    expect(parseDriverName(null)).toBeNull();
  });
});

describe('parseIppMakeAndModel (macOS)', () => {
  test('reads the make and model CUPS reports', () => {
    const output = [
      '        printer-state (enum) = idle',
      '        printer-make-and-model (textWithoutLanguage) = Label Printer TSPL',
      '        printer-resolution-default (resolution) = 203dpi',
    ].join('\n');
    expect(parseIppMakeAndModel(output)).toBe('Label Printer TSPL');
  });

  test('returns null without the attribute', () => {
    expect(parseIppMakeAndModel('printer-state (enum) = idle')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/printer-identity.test.ts`
Expected: FAIL，`Cannot find module './printer-identity'`。

- [ ] **Step 3: driver-paper.ts 抽出 ipptool 调用**

把 `queryIppPaper` 换成下面两段（纸张和驱动名都从同一份 ipptool 输出解析；其余不变）：

```ts
/** 用 ipptool 取这台打印机的全部属性（文字输出）；失败返回 null 并写日志。纸张、驱动名都从这里解析。 */
export function readIppAttributes(printerName: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/ipptool',
      ['-tv', cupsPrinterUri(printerName), IPP_ATTRIBUTES_TEST],
      { timeout: IPP_PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
      (error, stdout) => {
        if (error) {
          console.warn(`[driver-paper] ipptool failed for "${printerName}": ${error.message}`);
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function queryIppPaper(printerName: string): Promise<DriverPaper | null> {
  const output = await readIppAttributes(printerName);
  return output === null ? null : parseIppPaper(output);
}
```

- [ ] **Step 4: 实现**

```ts
// src/main/printing/printer-identity.ts
import type { PrinterIdentity } from '../../core/printer-commands/command-model';
import { readIppAttributes } from './driver-paper';
import type { PrinterProbeHost } from './printer-probe-host';

const IPP_MAKE_AND_MODEL_PATTERN = /printer-make-and-model \((?:textWithoutLanguage|text)\) = (.+)/;

/** 探测进程回答的驱动名；空的、查不到为 null。 */
export function parseDriverName(output: string | null): string | null {
  const text = output?.trim() ?? '';
  return text === '' ? null : text;
}

/** macOS：ipptool 输出里的 printer-make-and-model（CUPS 队列用的驱动的名字）。 */
export function parseIppMakeAndModel(output: string): string | null {
  return parseDriverName(IPP_MAKE_AND_MODEL_PATTERN.exec(output)?.[1] ?? null);
}

/**
 * 认指令集用的打印机身份。Windows 经常驻探测进程（host 为 null 时读不到）；macOS 用 ipptool；其他平台读不到。
 * USB 编号这一期不读（5c 读 PnP 设备时补上）。调用方保证打印机在系统列表里。
 */
export async function queryPrinterIdentity(
  printerName: string,
  host: PrinterProbeHost | null,
): Promise<PrinterIdentity> {
  switch (process.platform) {
    case 'win32':
      return { driverName: parseDriverName(host === null ? null : await host.query('driver', printerName)), usb: null };
    case 'darwin': {
      const output = await readIppAttributes(printerName);
      return { driverName: output === null ? null : parseIppMakeAndModel(output), usb: null };
    }
    default:
      return { driverName: null, usb: null };
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/printing`
Expected: PASS（`driver-paper.test.ts` 不变）。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/printing/driver-paper.ts src/main/printing/printer-identity.ts src/main/printing/printer-identity.test.ts
git commit -m "feat(printing): read the driver name of a printer on Windows and macOS" -m "Auto detection of the command set needs the driver name: the resident probe answers it on Windows and the printer-make-and-model attribute from the same ipptool output used for the paper answers it on macOS." -m "$TRAILER"
```

---

### Task 11: 假打印机：驱动名、发送失败、记下收到的指令

**Files:**
- Modify: `src/main/printing/fake-printers.ts`、`src/main/printing/fake-printers.test.ts`

- [ ] **Step 1: 写测试**（`fake-printers.test.ts` 的 `describe('FakePrinters')` 末尾追加）

```ts
  test('reports the driver name and records raw commands as text', async () => {
    const printers = new FakePrinters([{ ...SPEC[0], name: '标签机A', driverName: 'Label Printer TSPL' } as FakePrinterSpec]);
    expect(await printers.identity('标签机A')).toEqual({ driverName: 'Label Printer TSPL', usb: null });
    expect(await printers.identity('没有这台')).toEqual({ driverName: null, usb: null });
    expect(await printers.sendRaw('标签机A', Buffer.from('FORMFEED\r\n'))).toEqual({ ok: true });
    expect(printers.rawJobs).toEqual([{ printerName: '标签机A', text: 'FORMFEED\r\n' }]);
  });

  test('fails raw commands the way the spec says and records nothing', async () => {
    const printers = new FakePrinters([{ ...SPEC[0], name: '面单机B', rawFailure: 'raw-rejected' } as FakePrinterSpec]);
    expect(await printers.sendRaw('面单机B', Buffer.from('~PH\n'))).toMatchObject({
      ok: false,
      failure: { kind: 'raw-rejected' },
    });
    expect(await printers.sendRaw('没有这台', Buffer.from('~PH\n'))).toMatchObject({
      ok: false,
      failure: { kind: 'not-found' },
    });
    expect(printers.rawJobs).toEqual([]);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/fake-printers.test.ts`
Expected: FAIL，`identity` / `sendRaw` 不存在。

- [ ] **Step 3: 实现**

`fake-printers.ts` 的 import 区按字母顺序加：

```ts
import type { PrinterIdentity } from '../../core/printer-commands/command-model';
import type { RawSendFailureKind } from '../../shared/printer-commands';
import type { RawSendResult } from './raw-sender';
```

`FakePrinterSpec` 末尾加：

```ts
  /** 驱动名：「自动」按它认指令集；不设 = 读不到。 */
  driverName?: string;
  /** 设了就让标签机指令按这个原因发送失败（E2E、视觉验收看失败提示）。 */
  rawFailure?: RawSendFailureKind;
```

`FakePrint` 之后加：

```ts
/** 假打印机收到的一次标签机指令：字节按 latin1 转成文字（指令都是 ASCII，E2E 直接比对文字）。 */
export interface FakeRawJob {
  printerName: string;
  text: string;
}
```

`FakePrinters` 类里 `readonly printed` 之后加 `readonly rawJobs: FakeRawJob[] = [];`，`readiness` 方法之后加：

```ts
  async identity(name: string): Promise<PrinterIdentity> {
    return { driverName: this.find(name)?.driverName ?? null, usb: null };
  }

  /** 和真的发送方式一样回答：找不到、按 spec 失败，或记下来。 */
  async sendRaw(printerName: string, data: Uint8Array): Promise<RawSendResult> {
    const spec = this.find(printerName);
    if (!spec) {
      return { ok: false, failure: { kind: 'not-found', detail: `Printer not found: ${printerName}` } };
    }
    if (spec.rawFailure !== undefined) {
      return { ok: false, failure: { kind: spec.rawFailure, detail: `fake ${spec.rawFailure}` } };
    }
    this.rawJobs.push({ printerName, text: Buffer.from(data).toString('latin1') });
    return { ok: true };
  }
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/printing/fake-printers.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/printing/fake-printers.ts src/main/printing/fake-printers.test.ts
git commit -m "test(printing): fake printers report driver names and record raw commands" -m "E2E and visual acceptance need a printer that auto detection recognises, one it does not, one whose driver refuses raw data, and the exact command text that was sent." -m "$TRAILER"
```

---

### Task 12: PrinterCommands（主进程的编排）

**Files:**
- Create: `src/main/printing/printer-commands-station.ts`、`src/main/printing/printer-commands-station.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/printing/printer-commands-station.test.ts
import { describe, expect, test } from 'bun:test';
import {
  type CommandSetCatalog,
  DEFAULT_COMMAND_CONFIG,
  type MediaSetup,
  NO_COMMAND_SET_CATALOG,
  type PrinterCommandConfig,
} from '../../core/printer-commands/command-model';
import { MAX_PRINTER_COMMAND_ENTRIES } from '../../shared/settings';
import { PrinterCommands } from './printer-commands-station';
import type { RawSendResult } from './raw-sender';

const LABEL_PRINTER = '标签机A';
const OFFICE_PRINTER = '家用打印机';
const DRIVER_NAMES = new Map([
  [LABEL_PRINTER, 'Label Printer TSPL'],
  [OFFICE_PRINTER, 'Office Inkjet'],
]);
const MEDIA: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DRIVER_DPI = 203;

interface HarnessOptions {
  catalog?: CommandSetCatalog;
  sendResult?: RawSendResult;
  driverDpi?: number | null;
}

function harness(options: HarnessOptions = {}) {
  const state: { configs: Record<string, PrinterCommandConfig> } = { configs: {} };
  const sent: { printerName: string; text: string }[] = [];
  const logs: string[] = [];
  const station = new PrinterCommands({
    configs: () => state.configs,
    saveConfigs: (next) => {
      state.configs = next;
    },
    identityOf: async (name) => ({ driverName: DRIVER_NAMES.get(name) ?? null, usb: null }),
    driverDpi: async () => (options.driverDpi === undefined ? DRIVER_DPI : options.driverDpi),
    catalog: options.catalog ?? NO_COMMAND_SET_CATALOG,
    sender: {
      send: async (printerName, data) => {
        sent.push({ printerName, text: Buffer.from(data).toString('latin1') });
        return options.sendResult ?? { ok: true };
      },
    },
    hasPrinter: async (name) => DRIVER_NAMES.has(name),
    log: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  });
  return { station, state, sent, logs };
}

describe('PrinterCommands.describe', () => {
  test('shows the saved config, what 自动 detects and the driver resolution', async () => {
    expect(await harness().station.describe(LABEL_PRINTER)).toEqual({
      config: DEFAULT_COMMAND_CONFIG,
      detected: { commandSet: 'tspl', source: 'driver-name' },
      driverName: 'Label Printer TSPL',
      driverDpi: DRIVER_DPI,
    });
  });

  test('refuses a printer that is not in the system list', async () => {
    await expect(harness().station.describe('没有这台')).rejects.toThrow('Printer not found');
  });
});

describe('PrinterCommands.apply', () => {
  test('saves the config and sends the settings once', async () => {
    const { station, state, sent } = harness();
    const config: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, density: 8, media: MEDIA };
    expect(await station.apply(LABEL_PRINTER, config)).toEqual({ status: 'sent', commandSet: 'tspl' });
    expect(state.configs[LABEL_PRINTER]).toEqual(config);
    expect(sent).toEqual([{ printerName: LABEL_PRINTER, text: 'SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nDENSITY 8\r\n' }]);
  });

  test('saves without sending when the printer is set to send no commands', async () => {
    const { station, state, sent } = harness();
    const config: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'none', density: 8 };
    expect(await station.apply(LABEL_PRINTER, config)).toEqual({ status: 'not-sent', reason: 'no-command-set' });
    expect(state.configs[LABEL_PRINTER]).toEqual(config);
    expect(sent).toEqual([]);
  });

  test('saves without sending when 自动 cannot tell the command set', async () => {
    const { station, sent } = harness();
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'not-sent',
      reason: 'unknown-command-set',
    });
    expect(sent).toEqual([]);
  });

  test('reports nothing to send when every setting is left unchanged', async () => {
    const { station, state, sent } = harness();
    expect(await station.apply(LABEL_PRINTER, DEFAULT_COMMAND_CONFIG)).toEqual({
      status: 'not-sent',
      reason: 'nothing-to-send',
    });
    expect(Object.keys(state.configs)).toEqual([LABEL_PRINTER]);
    expect(sent).toEqual([]);
  });

  test('refuses a value the detected command set does not have, without saving', async () => {
    const { station, state, sent } = harness();
    expect(await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 20 })).toEqual({
      status: 'invalid',
      issue: 'TSPL 的浓度是 0–15，现在是 20：请重新选浓度',
    });
    expect(state.configs).toEqual({});
    expect(sent).toEqual([]);
  });

  test('converts to dots with the chosen resolution before the driver one', async () => {
    const { station, sent } = harness();
    await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, commandSet: 'zpl', media: MEDIA, dpi: 300 });
    expect(sent[0]?.text).toBe('^XA\n^PW709\n^LL472\n^MNY\n^JUS\n^XZ\n');
  });

  test('falls back to 203dpi when the driver reports no resolution', async () => {
    const { station, sent } = harness({ driverDpi: null });
    await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, commandSet: 'epl', media: MEDIA });
    expect(sent[0]?.text).toBe('q480\nQ320,16\n');
  });

  test('uses the online catalog for 自动 when it knows the printer', async () => {
    const { station } = harness({ catalog: { commandSetFor: async () => 'epl' } });
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'sent',
      commandSet: 'epl',
    });
  });

  test('passes on why the system could not take the commands', async () => {
    const failure = { kind: 'raw-rejected', detail: 'win32:1804 StartDocPrinter failed' } as const;
    const { station, logs } = harness({ sendResult: { ok: false, failure } });
    expect(await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'failed',
      reason: 'raw-rejected',
      detail: 'win32:1804 StartDocPrinter failed',
    });
    expect(logs.some((line) => line.includes('raw-rejected'))).toBe(true);
  });

  test('refuses to save commands for more printers than the settings hold', async () => {
    const { station, state } = harness();
    state.configs = Object.fromEntries(
      Array.from({ length: MAX_PRINTER_COMMAND_ENTRIES }, (_, index) => [`打印机${index}`, DEFAULT_COMMAND_CONFIG]),
    );
    expect(await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'invalid',
      issue: `最多为 ${MAX_PRINTER_COMMAND_ENTRIES} 台打印机保存指令设置`,
    });
  });
});

describe('PrinterCommands.run', () => {
  test('calibrates with the saved paper type', async () => {
    const { station, state, sent } = harness();
    state.configs = { [LABEL_PRINTER]: { ...DEFAULT_COMMAND_CONFIG, media: { ...MEDIA, sensing: 'mark' } } };
    expect(await station.run(LABEL_PRINTER, 'calibrate')).toEqual({ status: 'sent', commandSet: 'tspl' });
    expect(sent).toEqual([{ printerName: LABEL_PRINTER, text: 'BLINEDETECT\r\n' }]);
  });

  test('sends nothing when 自动 cannot tell the command set', async () => {
    const { station, sent } = harness();
    expect(await station.run(OFFICE_PRINTER, 'feed')).toEqual({ status: 'not-sent', reason: 'unknown-command-set' });
    expect(sent).toEqual([]);
  });

  test('logs every command it sends', async () => {
    const { station, logs } = harness();
    await station.run(LABEL_PRINTER, 'feed');
    expect(logs).toContain('[printer-commands] sent feed (tspl, 10 bytes) to "标签机A"');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/printing/printer-commands-station.test.ts`
Expected: FAIL，`Cannot find module './printer-commands-station'`。

- [ ] **Step 3: 实现**

```ts
// src/main/printing/printer-commands-station.ts
import {
  type CommandSet,
  type CommandSetCatalog,
  configFor,
  type PrinterAction,
  type PrinterCommandConfig,
  type PrinterIdentity,
  RAW_COMMAND_MAX_BYTES,
  withPrinterConfig,
} from '../../core/printer-commands/command-model';
import { detectCommandSet, effectiveCommandSet } from '../../core/printer-commands/command-set';
import { buildAction, buildSetup } from '../../core/printer-commands/printer-commands';
import type { NotSentReason, PrinterCommandResult, PrinterCommandsView } from '../../shared/printer-commands';
import { MAX_PRINTER_COMMAND_ENTRIES } from '../../shared/settings';
import { DEFAULT_PRINTER_DPI } from './qr-code';
import { asciiBytes, type RawSender } from './raw-sender';

export interface PrinterCommandsDeps {
  /** 设置里的 printerCommands（每台打印机的指令设置）。 */
  configs(): Readonly<Record<string, PrinterCommandConfig>>;
  saveConfigs(next: Record<string, PrinterCommandConfig>): void;
  identityOf(printerName: string): Promise<PrinterIdentity>;
  /** 驱动报告的分辨率；读不到为 null。 */
  driverDpi(printerName: string): Promise<number | null>;
  /** 按型号认指令集的在线识别表（5c 之前是 NO_COMMAND_SET_CATALOG）。 */
  catalog: CommandSetCatalog;
  sender: RawSender;
  /** 系统打印机列表里有这台（安全底线：只发给它们）。 */
  hasPrinter(printerName: string): Promise<boolean>;
  log(message: string): void;
  warn(message: string): void;
}

type Target = { commandSet: CommandSet; dpi: number } | { commandSet: null; reason: NotSentReason };

/**
 * 标签机指令：面板数据、保存并发送设置、四个动作。指令只在操作员点按钮时发一次，打印前不发；
 * 不经 PrintService、不写打印记录（指令不是标签），每次发送写一行日志。5b（诊断）用 run 做「走一张纸」这类检查。
 */
export class PrinterCommands {
  constructor(private readonly deps: PrinterCommandsDeps) {}

  /** 面板要的：保存的设置、「自动」认出的指令集、驱动名和分辨率。 */
  async describe(printerName: string): Promise<PrinterCommandsView> {
    await this.requirePrinter(printerName);
    const [identity, driverDpi] = await Promise.all([
      this.deps.identityOf(printerName),
      this.deps.driverDpi(printerName),
    ]);
    return {
      config: configFor(this.deps.configs(), printerName),
      detected: await detectCommandSet(identity, this.deps.catalog),
      driverName: identity.driverName,
      driverDpi,
    };
  }

  /**
   * 保存这台打印机的设置并发一次。认出了指令集就先按它的范围把关，不合适时不保存、返回原因；
   * 「不发指令」或认不出时照样保存（选择本身要记住），只是不发。
   */
  async apply(printerName: string, config: PrinterCommandConfig): Promise<PrinterCommandResult> {
    await this.requirePrinter(printerName);
    const saved = this.deps.configs();
    if (!Object.hasOwn(saved, printerName) && Object.keys(saved).length >= MAX_PRINTER_COMMAND_ENTRIES) {
      return { status: 'invalid', issue: `最多为 ${MAX_PRINTER_COMMAND_ENTRIES} 台打印机保存指令设置` };
    }
    const target = await this.target(printerName, config);
    if (target.commandSet === null) {
      this.deps.saveConfigs(withPrinterConfig(saved, printerName, config));
      return { status: 'not-sent', reason: target.reason };
    }
    const build = buildSetup(target.commandSet, config, target.dpi);
    if (!build.ok) {
      return { status: 'invalid', issue: build.issue };
    }
    this.deps.saveConfigs(withPrinterConfig(saved, printerName, config));
    if (build.text === '') {
      return { status: 'not-sent', reason: 'nothing-to-send' };
    }
    return this.send(printerName, target.commandSet, 'setup', build.text);
  }

  /** 按保存的设置（指令集、纸型）执行一个动作。 */
  async run(printerName: string, action: PrinterAction): Promise<PrinterCommandResult> {
    await this.requirePrinter(printerName);
    const config = configFor(this.deps.configs(), printerName);
    const target = await this.target(printerName, config);
    if (target.commandSet === null) {
      return { status: 'not-sent', reason: target.reason };
    }
    const build = buildAction(target.commandSet, action, config);
    if (!build.ok) {
      return { status: 'invalid', issue: build.issue };
    }
    return this.send(printerName, target.commandSet, action, build.text);
  }

  /** IPC 已经核对过一次；这里再核对，因为 5b 等别的调用方也走这里，打印机也可能刚被拔掉。 */
  private async requirePrinter(printerName: string): Promise<void> {
    if (!(await this.deps.hasPrinter(printerName))) {
      throw new Error(`Printer not found: ${printerName}`);
    }
  }

  private async target(printerName: string, config: PrinterCommandConfig): Promise<Target> {
    if (config.commandSet === 'none') {
      return { commandSet: null, reason: 'no-command-set' };
    }
    const detected =
      config.commandSet === 'auto'
        ? await detectCommandSet(await this.deps.identityOf(printerName), this.deps.catalog)
        : null;
    const commandSet = effectiveCommandSet(config.commandSet, detected);
    if (commandSet === null) {
      return { commandSet: null, reason: 'unknown-command-set' };
    }
    const dpi = config.dpi ?? (await this.deps.driverDpi(printerName)) ?? DEFAULT_PRINTER_DPI;
    return { commandSet, dpi };
  }

  private async send(
    printerName: string,
    commandSet: CommandSet,
    what: string,
    text: string,
  ): Promise<PrinterCommandResult> {
    const data = asciiBytes(text);
    if (data.length > RAW_COMMAND_MAX_BYTES) {
      throw new Error(`Generated ${what} for ${commandSet} is ${data.length} bytes, over ${RAW_COMMAND_MAX_BYTES}`);
    }
    const result = await this.deps.sender.send(printerName, data);
    if (!result.ok) {
      this.deps.warn(
        `[printer-commands] ${what} (${commandSet}) to "${printerName}" failed: ${result.failure.kind} ${result.failure.detail}`,
      );
      return { status: 'failed', reason: result.failure.kind, detail: result.failure.detail };
    }
    this.deps.log(`[printer-commands] sent ${what} (${commandSet}, ${data.length} bytes) to "${printerName}"`);
    return { status: 'sent', commandSet };
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/printing`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/printing/printer-commands-station.ts src/main/printing/printer-commands-station.test.ts
git commit -m "feat(printing): save and send label printer commands per printer" -m "The station checks the printer is installed, resolves the command set (manual, online catalog, driver name), validates against that set, saves the choice and sends once. Commands are not labels, so they skip PrintService and the job history but every send is logged." -m "$TRAILER"
```

---

### Task 13: IPC 和接线

三个新通道只给最小能力（Chromium 的 IPC 信任边界）：读面板数据、保存并发送一份经严格校验的设置、执行四个动作之一。界面传不进任何字节。

**Files:**
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts`

- [ ] **Step 1: 写测试**（`ipc-validators.test.ts` 的 import 列表按字母顺序加上 `requirePrinterAction`、`requirePrinterCommandConfig`，在 `describe('ipc validators')` 末尾加）

```ts
  test('requirePrinterCommandConfig accepts only a complete, valid config', () => {
    const config = {
      commandSet: 'zpl',
      density: 30,
      speed: 6,
      media: null,
      orientation: 'normal',
      finish: 'peel',
      dpi: 300,
    };
    expect(requirePrinterCommandConfig(config)).toEqual(config);
    expect(() => requirePrinterCommandConfig({ ...config, density: 31 })).toThrow('Invalid printer command config');
    expect(() => requirePrinterCommandConfig({ commandSet: 'zpl' })).toThrow('Invalid printer command config');
    expect(() => requirePrinterCommandConfig('zpl')).toThrow('Invalid printer command config');
  });

  test('requirePrinterAction accepts the four actions only', () => {
    expect(requirePrinterAction('factoryReset')).toBe('factoryReset');
    expect(() => requirePrinterAction('raw')).toThrow('Invalid printer action');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL，两个函数没有导出。

- [ ] **Step 3: 校验函数**（`ipc-validators.ts`，import 区按字母顺序加两行，文件末尾加两个函数）

```ts
import { isPrinterAction, type PrinterAction, type PrinterCommandConfig } from '../core/printer-commands/command-model';
import { parseCommandConfig } from '../core/printer-commands/sanitize-command-config';
```

```ts
/** 标签机指令的设置：每一项都要有、都合法（core 的严格校验），不纠正。 */
export function requirePrinterCommandConfig(value: unknown): PrinterCommandConfig {
  const config = parseCommandConfig(value);
  if (config === null) {
    throw new TypeError('Invalid printer command config');
  }
  return config;
}

export function requirePrinterAction(value: unknown): PrinterAction {
  if (!isPrinterAction(value)) {
    throw new TypeError('Invalid printer action');
  }
  return value;
}
```

Run: `bun test src/main/ipc-validators.test.ts`
Expected: PASS。

- [ ] **Step 4: 契约**（`src/shared/ipc-contract.ts`）

import 区按字母顺序加：

```ts
import type { PrinterAction, PrinterCommandConfig } from '../core/printer-commands/command-model';
import type { PrinterCommandResult, PrinterCommandsView } from './printer-commands';
```

`IpcChannel` 里 `OpenPrinterPreferences` 之后加：

```ts
  PrinterCommands: 'printer:commands',
  ApplyPrinterCommands: 'printer:commands-apply',
  RunPrinterAction: 'printer:commands-action',
```

`LabelFlashApi` 里 `openPrinterPreferences` 之后加：

```ts
  /** 「标签机指令」面板：保存的设置、「自动」认出的指令集、驱动名和驱动报告的分辨率。只接受系统里有的打印机。 */
  printerCommands(printerName: string): Promise<PrinterCommandsView>;
  /** 保存这台打印机的指令设置并发给打印机一次（以后打印前不再发）；不合这种指令集时不保存，返回原因。 */
  applyPrinterCommands(printerName: string, config: PrinterCommandConfig): Promise<PrinterCommandResult>;
  /** 纸张校准、走一张纸、打印自检页、恢复出厂设置：按保存的指令集发一次。 */
  runPrinterAction(printerName: string, action: PrinterAction): Promise<PrinterCommandResult>;
```

- [ ] **Step 5: 处理函数**（`src/main/ipc.ts`）

import 区：`requirePrinterAction`、`requirePrinterCommandConfig` 按字母顺序加进 `./ipc-validators` 的列表；加 `import type { PrinterCommands } from './printing/printer-commands-station';`。`IpcDeps` 的 `profiles` 之后加：

```ts
  /** 标签机指令（printing/printer-commands-station.ts）。 */
  printerCommands: PrinterCommands;
```

`handle(IpcChannel.OpenPrinterPreferences, …)` 之后加：

```ts
  // 先做不用等系统的校验，再核对打印机在系统列表里（只发给系统里有的打印机）。
  handle(IpcChannel.PrinterCommands, async (printerName) =>
    deps.printerCommands.describe(await requireKnownPrinter(printerName)),
  );
  handle(IpcChannel.ApplyPrinterCommands, async (printerName, config) => {
    const parsed = requirePrinterCommandConfig(config);
    return deps.printerCommands.apply(await requireKnownPrinter(printerName), parsed);
  });
  handle(IpcChannel.RunPrinterAction, async (printerName, action) => {
    const parsed = requirePrinterAction(action);
    return deps.printerCommands.run(await requireKnownPrinter(printerName), parsed);
  });
```

- [ ] **Step 6: preload**（`src/preload/index.ts`，`openPrinterPreferences` 之后）

```ts
  printerCommands: (printerName) => ipcRenderer.invoke(IpcChannel.PrinterCommands, printerName),
  applyPrinterCommands: (printerName, config) =>
    ipcRenderer.invoke(IpcChannel.ApplyPrinterCommands, printerName, config),
  runPrinterAction: (printerName, action) => ipcRenderer.invoke(IpcChannel.RunPrinterAction, printerName, action),
```

- [ ] **Step 7: 主进程接线**（`src/main/index.ts`）

import 区按字母顺序加：

```ts
import { NO_COMMAND_SET_CATALOG } from '../core/printer-commands/command-model';
import { PrinterCommands } from './printing/printer-commands-station';
import { queryPrinterIdentity } from './printing/printer-identity';
import { createRawSender } from './printing/raw-sender';
```

在 `const status = new PrinterStatusMonitor(…)` 之后加：

```ts
  // 标签机指令：只发给系统打印机列表里有的打印机；设置存在设置表的 printerCommands 里。
  // Windows 经常驻探测进程（winspool RAW），macOS 用 lp -o raw；E2E 用假打印机记下来。
  const printerCommands = new PrinterCommands({
    configs: () => settings.current.printerCommands,
    // 只改这一项：不影响别的设置，不需要走 onSettingsChanged。
    saveConfigs: (next) => {
      settings.update({ printerCommands: next });
    },
    identityOf: (name) => (fakePrinters ? fakePrinters.identity(name) : queryPrinterIdentity(name, probeHost)),
    driverDpi: async (name) => (await profiles.get(name))?.dpi ?? null,
    // 5c（驱动安装）的在线识别表接进来之前，「自动」只按驱动名认。
    catalog: NO_COMMAND_SET_CATALOG,
    sender: fakePrinters
      ? { send: (name, data) => fakePrinters.sendRaw(name, data) }
      : createRawSender(process.platform, probeHost),
    hasPrinter: (name) => adapter.hasPrinter(name),
    log: (message) => console.info(message),
    warn: (message) => console.warn(message),
  });
```

`registerIpc({ … })` 里 `profiles,` 之后加 `printerCommands,`。

- [ ] **Step 8: 检查**

Run: `bun run check`
Expected: 通过。再跑 `bun run test:e2e -- e2e/printers.e2e.ts`，确认打印机页原有的用例不受影响（探测进程的脚本变了，但 E2E 用假打印机，不起它）。

- [ ] **Step 9: 提交**

```bash
git add src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(ipc): channels for label printer commands" -m "Three channels with the least capability: read the panel data, save and send a strictly validated config, or run one of four actions. The renderer can never pass bytes, and every printer name is checked against the system printer list first." -m "$TRAILER"
```

---

### Task 14: 界面的纯逻辑

**Files:**
- Create: `src/renderer/src/lib/printer-commands-view.ts`、`src/renderer/src/lib/printer-commands-view.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/printer-commands-view.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, DEFAULT_GAP_MM } from '../../../core/printer-commands/command-model';
import type { PrinterCommandsView } from '../../../shared/printer-commands';
import {
  actionsHint,
  type CommandForm,
  commandSetOptions,
  configFromForm,
  densityOptions,
  describeCommandResult,
  describeDetection,
  dpiOptions,
  formFromConfig,
  isFormDirty,
  speedOptions,
  withCommandSet,
} from './printer-commands-view';

const PAPER = { widthMm: 60, heightMm: 40 };
const TSPL_DETECTED = { commandSet: 'tspl', source: 'driver-name' } as const;

function view(overrides: Partial<PrinterCommandsView> = {}): PrinterCommandsView {
  return {
    config: DEFAULT_COMMAND_CONFIG,
    detected: TSPL_DETECTED,
    driverName: 'Label Printer TSPL',
    driverDpi: 203,
    ...overrides,
  };
}

describe('form', () => {
  test('prefills the paper the printer holds and leaves it switched off', () => {
    const form = formFromConfig(DEFAULT_COMMAND_CONFIG, PAPER);
    expect(form.mediaEnabled).toBe(false);
    expect(form.media).toEqual({ widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: DEFAULT_GAP_MM });
    expect(configFromForm(form)).toEqual(DEFAULT_COMMAND_CONFIG);
  });

  test('round-trips a saved config', () => {
    const config = {
      ...DEFAULT_COMMAND_CONFIG,
      commandSet: 'zpl',
      density: 20,
      media: { widthMm: 100, heightMm: 150, sensing: 'mark', gapMm: 3 },
      dpi: 300,
    } as const;
    expect(configFromForm(formFromConfig(config, PAPER))).toEqual(config);
  });

  test('notices unsaved changes', () => {
    const saved = formFromConfig(DEFAULT_COMMAND_CONFIG, PAPER);
    expect(isFormDirty(saved, saved)).toBe(false);
    expect(isFormDirty({ ...saved, density: 3 }, saved)).toBe(true);
  });

  test('drops values the new command set does not have', () => {
    const form: CommandForm = {
      ...formFromConfig(DEFAULT_COMMAND_CONFIG, PAPER),
      commandSet: 'zpl',
      density: 25,
      speed: 6,
      finish: 'tear',
    };
    const next = withCommandSet(form, 'epl', TSPL_DETECTED);
    expect([next.commandSet, next.density, next.speed, next.finish]).toEqual(['epl', null, null, null]);
    // 「自动」认出 TSPL：12 在 0–15 里，保留。
    expect(withCommandSet({ ...form, density: 12 }, 'auto', TSPL_DETECTED).density).toBe(12);
  });
});

describe('options', () => {
  test('labels 自动 with what it detected', () => {
    expect(commandSetOptions(TSPL_DETECTED)[0]).toEqual({ value: 'auto', label: '自动（TSPL）' });
    expect(commandSetOptions(null)[0]).toEqual({ value: 'auto', label: '自动（认不出）' });
    expect(commandSetOptions(null).map((option) => option.value)).toEqual(['auto', 'tspl', 'zpl', 'epl', 'none']);
  });

  test('offers the density range and speeds of each command set', () => {
    expect(densityOptions('tspl').map((option) => option.value)).toEqual([
      '',
      ...Array.from({ length: 16 }, (_, index) => String(index)),
    ]);
    expect(densityOptions('zpl').at(-1)).toEqual({ value: '30', label: '30' });
    expect(speedOptions('tspl')[1]).toEqual({ value: '2', label: '2 英寸/秒' });
    expect(speedOptions('epl')[1]).toEqual({ value: '1', label: '第 1 档' });
  });

  test('names the driver resolution in the default choice', () => {
    expect(dpiOptions(300)[0]).toEqual({ value: '', label: '按驱动（300dpi）' });
    expect(dpiOptions(null)[0]).toEqual({ value: '', label: '按驱动（读不到，按 203dpi）' });
  });
});

describe('describeDetection', () => {
  test('says where the command set came from', () => {
    expect(describeDetection(view())).toBe('驱动名「Label Printer TSPL」里写着 TSPL');
    expect(describeDetection(view({ detected: { commandSet: 'zpl', source: 'catalog' } }))).toBe(
      '按在线识别表，这台用 ZPL',
    );
  });

  test('asks the operator to choose when it cannot tell', () => {
    expect(describeDetection(view({ detected: null, driverName: 'Office Inkjet' }))).toBe(
      '从驱动名「Office Inkjet」认不出用哪种指令：请手动选择；不确定就选「不发指令」，打印照常经驱动',
    );
    expect(describeDetection(view({ detected: null, driverName: null }))).toBe(
      '读不到驱动名：请手动选择；不确定就选「不发指令」，打印照常经驱动',
    );
  });
});

describe('describeCommandResult', () => {
  test('says the settings were sent, not that they took effect', () => {
    expect(describeCommandResult({ status: 'sent', commandSet: 'tspl' }, 'save')).toEqual({
      tone: 'ok',
      text: '设置已发送到打印机（TSPL）。指令是单向的：打一张看看效果',
    });
    expect(describeCommandResult({ status: 'sent', commandSet: 'zpl' }, 'calibrate')).toEqual({
      tone: 'ok',
      text: '纸张校准指令已发送到打印机',
    });
  });

  test('explains why nothing was sent', () => {
    expect(describeCommandResult({ status: 'not-sent', reason: 'unknown-command-set' }, 'save').text).toBe(
      '已保存。认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
    );
    expect(describeCommandResult({ status: 'not-sent', reason: 'no-command-set' }, 'feed').text).toBe(
      '这台打印机设为「不发指令」，没有发送',
    );
    expect(describeCommandResult({ status: 'not-sent', reason: 'nothing-to-send' }, 'save').text).toBe(
      '已保存。各项都是「不改」，没有要发送的设置',
    );
  });

  test('gives the next step for each failure', () => {
    const failed = (reason: 'raw-rejected' | 'uncertain' | 'error', detail = 'x') =>
      describeCommandResult({ status: 'failed', reason, detail }, 'save');
    expect(failed('raw-rejected')).toMatchObject({ tone: 'error' });
    expect(failed('raw-rejected').text).toContain('驱动不接受直接发送的指令');
    expect(failed('uncertain').text.startsWith('不确定有没有发出去')).toBe(true);
    expect(failed('error', 'lp: busy').text).toBe('发送失败：lp: busy。检查打印机是否开着、连好，再试一次');
  });
});

describe('actionsHint', () => {
  test('explains why the action buttons are off', () => {
    expect(actionsHint('tspl', false)).toBeNull();
    expect(actionsHint('tspl', true)).toBe('有没保存的修改：下面的按钮按已保存的设置发送，先点「保存并发送」');
    expect(actionsHint(null, false)).toBe('没有可用的指令集，下面的按钮不能用：先在「指令集」里选一种并保存');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/printer-commands-view.test.ts`
Expected: FAIL，`Cannot find module './printer-commands-view'`。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/printer-commands-view.ts
import {
  COMMAND_DPI_CHOICES,
  COMMAND_SET_CHOICES,
  COMMAND_SET_LIMITS,
  COMMAND_SET_NAMES,
  type CommandSet,
  type CommandSetChoice,
  DEFAULT_GAP_MM,
  type DetectedCommandSet,
  FINISH_MODES,
  type FinishMode,
  type MediaSensing,
  type MediaSetup,
  PRINT_ORIENTATIONS,
  type PrintOrientation,
  type PrinterAction,
  type PrinterCommandConfig,
} from '../../../core/printer-commands/command-model';
import { effectiveCommandSet } from '../../../core/printer-commands/command-set';
import type { PaperSize } from '../../../shared/paper-sizes';
import type {
  NotSentReason,
  PrinterCommandResult,
  PrinterCommandsView,
  RawSendFailureKind,
} from '../../../shared/printer-commands';

/** 下拉框里「不改」对应的值。 */
export const UNCHANGED = '';
/** 读不到驱动分辨率时按 203dpi：和打印、主进程换算时一样。 */
const FALLBACK_DPI = 203;
/** 失败时系统给的说明最多显示这么多字，完整的在日志里。 */
const MAX_DETAIL_CHARS = 80;

export interface SelectOption {
  value: string;
  label: string;
}

/** 面板的表单：纸张总是有值（预填这台打印机负责的纸），mediaEnabled 决定发不发。 */
export interface CommandForm {
  commandSet: CommandSetChoice;
  density: number | null;
  speed: number | null;
  mediaEnabled: boolean;
  media: MediaSetup;
  orientation: PrintOrientation | null;
  finish: FinishMode | null;
  dpi: number | null;
}

export interface CommandMessage {
  tone: 'ok' | 'info' | 'error';
  text: string;
}

/** 正在做的事：保存并发送，或四个动作之一。 */
export type CommandRequest = 'save' | PrinterAction;

export const ACTION_LABELS: Readonly<Record<PrinterAction, string>> = {
  calibrate: '纸张校准',
  feed: '走一张纸',
  selfTest: '打印自检页',
  factoryReset: '恢复出厂设置',
};

/** 结果里说「××指令已发送」时用的名字。 */
const ACTION_NAMES: Readonly<Record<PrinterAction, string>> = {
  calibrate: '纸张校准',
  feed: '走纸',
  selfTest: '自检页',
  factoryReset: '恢复出厂设置',
};

export const ONE_WAY_HINT =
  '指令是单向的：程序只知道已经发出去，打印机有没有照做要看出纸。经驱动打印时，驱动「打印首选项」里的同名设置可能盖过这里的设置。';

export const SENSING_OPTIONS: ReadonlyArray<{ value: MediaSensing; label: string }> = [
  { value: 'gap', label: '间隙纸' },
  { value: 'mark', label: '黑标纸' },
];

export const ORIENTATION_OPTIONS: readonly SelectOption[] = [
  { value: UNCHANGED, label: '不改' },
  { value: 'normal', label: '正常' },
  { value: 'rotated', label: '旋转 180°' },
];

export const FINISH_OPTIONS: readonly SelectOption[] = [
  { value: UNCHANGED, label: '不改' },
  { value: 'tear', label: '撕纸' },
  { value: 'peel', label: '剥离（要装剥离器）' },
];

export function formFromConfig(config: PrinterCommandConfig, paper: PaperSize): CommandForm {
  return {
    commandSet: config.commandSet,
    density: config.density,
    speed: config.speed,
    mediaEnabled: config.media !== null,
    media: config.media ?? { widthMm: paper.widthMm, heightMm: paper.heightMm, sensing: 'gap', gapMm: DEFAULT_GAP_MM },
    orientation: config.orientation,
    finish: config.finish,
    dpi: config.dpi,
  };
}

export function configFromForm(form: CommandForm): PrinterCommandConfig {
  return {
    commandSet: form.commandSet,
    density: form.density,
    speed: form.speed,
    media: form.mediaEnabled ? form.media : null,
    orientation: form.orientation,
    finish: form.finish,
    dpi: form.dpi,
  };
}

/** 两份表单都由 formFromConfig / 展开生成，键的顺序相同，按 JSON 比较即可。 */
export function isFormDirty(form: CommandForm, saved: CommandForm): boolean {
  return JSON.stringify(form) !== JSON.stringify(saved);
}

/** 换指令集：新的指令集没有的浓度、速度、出纸方式回到「不改」（不悄悄换成别的值）。 */
export function withCommandSet(
  form: CommandForm,
  choice: CommandSetChoice,
  detected: DetectedCommandSet | null,
): CommandForm {
  const set = effectiveCommandSet(choice, detected);
  if (set === null) {
    return { ...form, commandSet: choice };
  }
  const limits = COMMAND_SET_LIMITS[set];
  const { density, speed } = form;
  return {
    ...form,
    commandSet: choice,
    density: density !== null && density >= limits.density.min && density <= limits.density.max ? density : null,
    speed: speed !== null && limits.speeds.includes(speed) ? speed : null,
    finish: limits.canSetFinish ? form.finish : null,
  };
}

export function commandSetOptions(detected: DetectedCommandSet | null): SelectOption[] {
  return COMMAND_SET_CHOICES.map((choice) => {
    switch (choice) {
      case 'auto':
        return {
          value: choice,
          label: `自动（${detected === null ? '认不出' : COMMAND_SET_NAMES[detected.commandSet]}）`,
        };
      case 'none':
        return { value: choice, label: '不发指令' };
      default:
        return { value: choice, label: COMMAND_SET_NAMES[choice] };
    }
  });
}

export function densityOptions(set: CommandSet): SelectOption[] {
  const { min, max } = COMMAND_SET_LIMITS[set].density;
  const values = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
  return [{ value: UNCHANGED, label: '不改' }, ...values.map((value) => ({ value, label: value }))];
}

/** TSPL、ZPL 的速度是英寸/秒；EPL 是档位（每档多快随机型不同，不写成英寸/秒）。 */
export function speedOptions(set: CommandSet): SelectOption[] {
  const label = (speed: number) => (set === 'epl' ? `第 ${speed} 档` : `${speed} 英寸/秒`);
  return [
    { value: UNCHANGED, label: '不改' },
    ...COMMAND_SET_LIMITS[set].speeds.map((speed) => ({ value: String(speed), label: label(speed) })),
  ];
}

export function dpiOptions(driverDpi: number | null): SelectOption[] {
  const fallback = driverDpi === null ? `读不到，按 ${FALLBACK_DPI}dpi` : `${driverDpi}dpi`;
  return [
    { value: UNCHANGED, label: `按驱动（${fallback}）` },
    ...COMMAND_DPI_CHOICES.map((dpi) => ({ value: String(dpi), label: `${dpi}dpi` })),
  ];
}

export function optionValue(value: number | null): string {
  return value === null ? UNCHANGED : String(value);
}

export function parseOption(value: string): number | null {
  return value === UNCHANGED ? null : Number(value);
}

export function orientationOf(value: string): PrintOrientation | null {
  return PRINT_ORIENTATIONS.find((item) => item === value) ?? null;
}

export function finishOf(value: string): FinishMode | null {
  return FINISH_MODES.find((item) => item === value) ?? null;
}

/** 「自动」下面那句：认出了说依据，认不出请操作员选。 */
export function describeDetection(view: Pick<PrinterCommandsView, 'detected' | 'driverName'>): string {
  const { detected, driverName } = view;
  if (detected === null) {
    const from = driverName === null ? '读不到驱动名' : `从驱动名「${driverName}」认不出用哪种指令`;
    return `${from}：请手动选择；不确定就选「不发指令」，打印照常经驱动`;
  }
  const name = COMMAND_SET_NAMES[detected.commandSet];
  return detected.source === 'catalog' ? `按在线识别表，这台用 ${name}` : `驱动名「${driverName ?? ''}」里写着 ${name}`;
}

export function canRunAction(set: CommandSet, action: PrinterAction): boolean {
  return action !== 'factoryReset' || COMMAND_SET_LIMITS[set].canFactoryReset;
}

/** 动作按钮灰掉的原因；能用时为 null。 */
export function actionsHint(savedSet: CommandSet | null, isDirty: boolean): string | null {
  if (isDirty) {
    return '有没保存的修改：下面的按钮按已保存的设置发送，先点「保存并发送」';
  }
  if (savedSet === null) {
    return '没有可用的指令集，下面的按钮不能用：先在「指令集」里选一种并保存';
  }
  return null;
}

const NOT_SENT_TEXTS: Readonly<Record<NotSentReason, string>> = {
  'no-command-set': '这台打印机设为「不发指令」，没有发送',
  'unknown-command-set': '认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
  'nothing-to-send': '各项都是「不改」，没有要发送的设置',
};

function failureText(reason: RawSendFailureKind, detail: string): string {
  switch (reason) {
    case 'not-found':
      return '发送失败：系统里找不到这台打印机。点「刷新」看看它还在不在';
    case 'access-denied':
      return '发送失败：没有向这台打印机发送的权限。在 Windows 打印机属性的「安全」里给当前用户「打印」权限后再试';
    case 'raw-rejected':
      return '发送失败：这台打印机的驱动不接受直接发送的指令。装热敏标签机厂家的驱动后再试；只想正常打印的话，把指令集改成「不发指令」';
    case 'uncertain':
      return '不确定有没有发出去：系统的打印服务没有及时回应。看看打印机有没有动作，再决定要不要重发';
    case 'unsupported':
      return '这个系统上不能直接向打印机发送指令';
    case 'error':
      return `发送失败：${detail.slice(0, MAX_DETAIL_CHARS)}。检查打印机是否开着、连好，再试一次`;
  }
}

/** 结果 → 面板上的一句话。只说程序知道的：发出去了，不说生效了。 */
export function describeCommandResult(result: PrinterCommandResult, request: CommandRequest): CommandMessage {
  switch (result.status) {
    case 'sent':
      return {
        tone: 'ok',
        text:
          request === 'save'
            ? `设置已发送到打印机（${COMMAND_SET_NAMES[result.commandSet]}）。指令是单向的：打一张看看效果`
            : `${ACTION_NAMES[request]}指令已发送到打印机`,
      };
    case 'not-sent':
      return { tone: 'info', text: `${request === 'save' ? '已保存。' : ''}${NOT_SENT_TEXTS[result.reason]}` };
    case 'invalid':
      return { tone: 'error', text: result.issue };
    case 'failed':
      return { tone: 'error', text: failureText(result.reason, result.detail) };
  }
}

export function factoryResetMessage(displayName: string): string {
  return `将向「${displayName}」发送恢复出厂设置：浓度、速度、纸张等设置回到出厂值，之后要重新做纸张校准。程序里保存的指令设置不变，需要时再点「保存并发送」。`;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib/printer-commands-view.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib/printer-commands-view.ts src/renderer/src/lib/printer-commands-view.test.ts
git commit -m "feat(renderer): view logic for the label printer commands panel" -m "Form conversion, options per command set, where auto detection came from, and result texts that only claim what the program knows: commands were handed to the system, not that the printer applied them." -m "$TRAILER"
```

---

### Task 15: 面板、视图模型、打印机页

**Files:**
- Create: `src/renderer/src/view-models/use-printer-commands.ts`
- Create: `src/renderer/src/components/PrinterCommandsPanel.tsx`
- Modify: `src/renderer/src/components/PrinterList.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 视图模型**

```ts
// src/renderer/src/view-models/use-printer-commands.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandSetChoice, PrinterAction } from '../../../core/printer-commands/command-model';
import type { PaperSize } from '../../../shared/paper-sizes';
import type { PrinterCommandResult, PrinterCommandsView } from '../../../shared/printer-commands';
import { reportError } from '../lib/notices';
import {
  type CommandForm,
  type CommandMessage,
  type CommandRequest,
  configFromForm,
  describeCommandResult,
  formFromConfig,
  isFormDirty,
  withCommandSet,
} from '../lib/printer-commands-view';

/** 「标签机指令」面板的状态和操作（同一时间只展开一台打印机）。 */
export interface PrinterCommandsModel {
  openName: string | null;
  view: PrinterCommandsView | null;
  form: CommandForm | null;
  isDirty: boolean;
  busy: CommandRequest | null;
  message: CommandMessage | null;
  isConfirmingReset: boolean;
  toggle(printerName: string): void;
  change(patch: Partial<CommandForm>): void;
  changeCommandSet(choice: CommandSetChoice): void;
  save(): void;
  run(action: PrinterAction): void;
  /** 「恢复出厂设置」的第一次确认（按钮两步）之后：打开第二次确认的对话框。 */
  requestReset(): void;
  confirmReset(): void;
  cancelReset(): void;
}

/** paperOf：这台打印机负责的纸，纸张那一组按它预填。 */
export function usePrinterCommands(paperOf: (printerName: string) => PaperSize): PrinterCommandsModel {
  const [openName, setOpenName] = useState<string | null>(null);
  const [view, setView] = useState<PrinterCommandsView | null>(null);
  const [form, setForm] = useState<CommandForm | null>(null);
  const [savedForm, setSavedForm] = useState<CommandForm | null>(null);
  const [busy, setBusy] = useState<CommandRequest | null>(null);
  const [message, setMessage] = useState<CommandMessage | null>(null);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  // 最新的值给异步回调用；在 effect 里更新，不在渲染过程中改 ref。
  const paperOfRef = useRef(paperOf);
  const openNameRef = useRef<string | null>(null);
  useEffect(() => {
    paperOfRef.current = paperOf;
  }, [paperOf]);
  useEffect(() => {
    openNameRef.current = openName;
  }, [openName]);

  const load = useCallback(async (name: string): Promise<void> => {
    try {
      const next = await window.api.printerCommands(name);
      // 读的过程中换了打印机或收起了面板：丢掉这次的结果。
      if (openNameRef.current !== name) {
        return;
      }
      const loaded = formFromConfig(next.config, paperOfRef.current(name));
      setView(next);
      setForm(loaded);
      setSavedForm(loaded);
    } catch (error) {
      reportError('读取标签机指令设置', error);
      if (openNameRef.current === name) {
        setOpenName(null);
      }
    }
  }, []);

  useEffect(() => {
    setView(null);
    setForm(null);
    setSavedForm(null);
    setMessage(null);
    setIsConfirmingReset(false);
    if (openName !== null) {
      void load(openName);
    }
  }, [openName, load]);

  const toggle = useCallback((name: string) => {
    setOpenName((current) => (current === name ? null : name));
  }, []);

  const change = useCallback((patch: Partial<CommandForm>) => {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const changeCommandSet = useCallback(
    (choice: CommandSetChoice) => {
      setForm((current) => (current === null ? current : withCommandSet(current, choice, view?.detected ?? null)));
    },
    [view],
  );

  const send = async (request: CommandRequest, call: () => Promise<PrinterCommandResult>): Promise<void> => {
    setBusy(request);
    setMessage(null);
    try {
      const result = await call();
      setMessage(describeCommandResult(result, request));
      // 没通过把关的设置没有保存：留着操作员改到一半的表单；其余情况重新读，表单回到保存的样子。
      if (request === 'save' && result.status !== 'invalid' && openName !== null) {
        await load(openName);
      }
    } catch (error) {
      reportError(request === 'save' ? '保存标签机指令设置' : '发送打印机指令', error);
    } finally {
      setBusy(null);
    }
  };

  const run = (action: PrinterAction) => {
    if (openName !== null) {
      void send(action, () => window.api.runPrinterAction(openName, action));
    }
  };

  return {
    openName,
    view,
    form,
    isDirty: form !== null && savedForm !== null && isFormDirty(form, savedForm),
    busy,
    message,
    isConfirmingReset,
    toggle,
    change,
    changeCommandSet,
    save: () => {
      if (openName !== null && form !== null) {
        void send('save', () => window.api.applyPrinterCommands(openName, configFromForm(form)));
      }
    },
    run,
    requestReset: () => setIsConfirmingReset(true),
    confirmReset: () => {
      setIsConfirmingReset(false);
      run('factoryReset');
    },
    cancelReset: () => setIsConfirmingReset(false),
  };
}
```

- [ ] **Step 2: 面板**

```tsx
// src/renderer/src/components/PrinterCommandsPanel.tsx
import {
  COMMAND_SET_LIMITS,
  COMMAND_SET_NAMES,
  type CommandSet,
  GAP_RANGE_MM,
} from '../../../core/printer-commands/command-model';
import { effectiveCommandSet } from '../../../core/printer-commands/command-set';
import { PAPER_LIMITS_MM } from '../../../shared/paper-sizes';
import {
  ACTION_LABELS,
  actionsHint,
  type CommandForm,
  canRunAction,
  commandSetOptions,
  densityOptions,
  describeDetection,
  dpiOptions,
  FINISH_OPTIONS,
  factoryResetMessage,
  finishOf,
  ONE_WAY_HINT,
  ORIENTATION_OPTIONS,
  optionValue,
  orientationOf,
  parseOption,
  SENSING_OPTIONS,
  speedOptions,
  UNCHANGED,
} from '../lib/printer-commands-view';
import type { PrinterCommandsModel } from '../view-models/use-printer-commands';
import { ConfirmButton } from './ConfirmButton';
import { ConfirmDialog } from './config/ConfirmDialog';
import { NumberField, Segmented, SelectField, Toggle } from './form-controls';

/** 不用二次确认的三个动作。 */
const ROUTINE_ACTIONS = ['calibrate', 'feed', 'selfTest'] as const;
/** 纸张尺寸的步长：和纸张键的精度一致。 */
const MM_STEP = 0.1;

interface PrinterCommandsPanelProps {
  model: PrinterCommandsModel;
  /** 界面上显示的打印机名。 */
  displayName: string;
}

/** 打印机页每台打印机下面展开的「标签机指令」：指令集、设置、保存并发送，和四个动作。 */
export function PrinterCommandsPanel({ model, displayName }: PrinterCommandsPanelProps) {
  const label = `${displayName} 的标签机指令`;
  const { view, form } = model;
  if (view === null || form === null) {
    return (
      <section className="printer-commands" aria-label={label} aria-busy="true">
        <p className="printer-commands__hint">正在读取打印机的驱动…</p>
      </section>
    );
  }
  const formSet = effectiveCommandSet(form.commandSet, view.detected);
  const savedSet = effectiveCommandSet(view.config.commandSet, view.detected);
  const isBusy = model.busy !== null;
  const canAct = savedSet !== null && !model.isDirty && !isBusy;
  const hint = actionsHint(savedSet, model.isDirty);
  return (
    <section className="printer-commands" aria-label={label}>
      <SelectField
        label="指令集"
        value={form.commandSet}
        options={commandSetOptions(view.detected)}
        onChange={(value) => model.changeCommandSet(value)}
      />
      {form.commandSet === 'auto' && <p className="printer-commands__hint">{describeDetection(view)}</p>}
      {formSet !== null && (
        <CommandSettings set={formSet} form={form} driverDpi={view.driverDpi} onChange={model.change} />
      )}
      <p className="printer-commands__hint">{ONE_WAY_HINT}</p>
      <div className="printer-commands__actions">
        <button type="button" className="button button--primary button--small" disabled={isBusy} onClick={model.save}>
          {model.busy === 'save' ? '正在发送…' : '保存并发送'}
        </button>
      </div>
      <div className="printer-commands__actions" role="group" aria-label="打印机动作">
        {ROUTINE_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            className="button button--small"
            disabled={!canAct}
            onClick={() => model.run(action)}
          >
            {model.busy === action ? '正在发送…' : ACTION_LABELS[action]}
          </button>
        ))}
        {canAct && savedSet !== null && canRunAction(savedSet, 'factoryReset') ? (
          <ConfirmButton
            className="button button--small button--quiet"
            label={ACTION_LABELS.factoryReset}
            confirmLabel="确认恢复出厂？"
            onConfirm={model.requestReset}
          />
        ) : (
          <button type="button" className="button button--small button--quiet" disabled>
            {ACTION_LABELS.factoryReset}
          </button>
        )}
      </div>
      {hint !== null && <p className="printer-commands__hint">{hint}</p>}
      {model.message !== null && (
        <p
          className={`printer-commands__message printer-commands__message--${model.message.tone}`}
          role={model.message.tone === 'error' ? 'alert' : 'status'}
        >
          {model.message.text}
        </p>
      )}
      {model.isConfirmingReset && (
        <ConfirmDialog
          title={ACTION_LABELS.factoryReset}
          message={factoryResetMessage(displayName)}
          confirmLabel={ACTION_LABELS.factoryReset}
          cancelLabel="不恢复"
          onConfirm={model.confirmReset}
          onCancel={model.cancelReset}
        />
      )}
    </section>
  );
}

interface CommandSettingsProps {
  set: CommandSet;
  form: CommandForm;
  driverDpi: number | null;
  onChange: (patch: Partial<CommandForm>) => void;
}

/** 这种指令集能设的项；每一项都可以「不改」。 */
function CommandSettings({ set, form, driverDpi, onChange }: CommandSettingsProps) {
  const limits = COMMAND_SET_LIMITS[set];
  const { media } = form;
  const changeMedia = (patch: Partial<CommandForm['media']>) => onChange({ media: { ...media, ...patch } });
  return (
    <>
      <SelectField
        label="浓度"
        value={optionValue(form.density)}
        options={densityOptions(set)}
        onChange={(value) => onChange({ density: parseOption(value) })}
      />
      <SelectField
        label={set === 'epl' ? '速度档位' : '速度'}
        value={optionValue(form.speed)}
        options={speedOptions(set)}
        onChange={(value) => onChange({ speed: parseOption(value) })}
      />
      <Toggle label="设置纸张" checked={form.mediaEnabled} onChange={(mediaEnabled) => onChange({ mediaEnabled })} />
      {form.mediaEnabled && (
        <>
          <NumberField
            label="纸宽"
            value={media.widthMm}
            min={PAPER_LIMITS_MM.width.min}
            max={PAPER_LIMITS_MM.width.max}
            step={MM_STEP}
            onChange={(widthMm) => changeMedia({ widthMm })}
          />
          <NumberField
            label="纸高"
            value={media.heightMm}
            min={PAPER_LIMITS_MM.height.min}
            max={PAPER_LIMITS_MM.height.max}
            step={MM_STEP}
            onChange={(heightMm) => changeMedia({ heightMm })}
          />
          <Segmented
            label="纸张类型"
            value={media.sensing}
            options={SENSING_OPTIONS}
            onChange={(sensing) => changeMedia({ sensing })}
          />
          <NumberField
            label={media.sensing === 'gap' ? '间隙' : '黑标高度'}
            value={media.gapMm}
            min={GAP_RANGE_MM.min}
            max={GAP_RANGE_MM.max}
            step={MM_STEP}
            onChange={(gapMm) => changeMedia({ gapMm })}
          />
        </>
      )}
      <SelectField
        label="打印方向"
        value={form.orientation ?? UNCHANGED}
        options={ORIENTATION_OPTIONS}
        onChange={(value) => onChange({ orientation: orientationOf(value) })}
      />
      {limits.canSetFinish ? (
        <SelectField
          label="出纸方式"
          value={form.finish ?? UNCHANGED}
          options={FINISH_OPTIONS}
          onChange={(value) => onChange({ finish: finishOf(value) })}
        />
      ) : (
        <p className="printer-commands__hint">
          {COMMAND_SET_NAMES[set]} 不设出纸方式（撕纸 / 剥离）：它和切刀、热敏模式在同一条指令里，单独改容易改错，请在打印机上设置
        </p>
      )}
      {limits.usesDots && (
        <SelectField
          label="分辨率"
          value={optionValue(form.dpi)}
          options={dpiOptions(driverDpi)}
          onChange={(value) => onChange({ dpi: parseOption(value) })}
        />
      )}
    </>
  );
}
```

`SelectField` 的 `onChange` 收到的是字符串：`指令集` 那一个的选项值都来自 `COMMAND_SET_CHOICES`，类型参数推成 `CommandSetChoice`；如果类型检查推不出来，把 `commandSetOptions` 的返回类型改成 `ReadonlyArray<{ value: CommandSetChoice; label: string }>`。

- [ ] **Step 3: 打印机页**（`PrinterList.tsx`）

1. import 加 `import type { PrinterCommandsModel } from '../view-models/use-printer-commands';` 和 `import { PrinterCommandsPanel } from './PrinterCommandsPanel';`。
2. `PrinterListProps` 末尾加：

```ts
  /** 每台打印机下面展开的「标签机指令」。 */
  commands: PrinterCommandsModel;
```

并在解构参数里加 `commands`。

3. 每一行原来的「测试页」按钮换成一组按钮：

```tsx
              <span className="printer-row__actions">
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => void runTest(printer.name, expectedKey ?? LABEL_PAPER_KEY)}
                >
                  测试页
                </button>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-expanded={commands.openName === printer.name}
                  onClick={() => commands.toggle(printer.name)}
                >
                  标签机指令
                </button>
              </span>
```

4. `{testMessages[printer.name] && …}` 那一行之后加：

```tsx
              {commands.openName === printer.name && (
                <PrinterCommandsPanel model={commands} displayName={printer.displayName} />
              )}
```

- [ ] **Step 4: App 接线**（`App.tsx`）

import 区按字母顺序加 `import { DEFAULT_PAPER } from '../../shared/label-paper';`、`import { parsePaperKey } from '../../shared/paper-sizes';`（已有就不加）、`import { usePrinterCommands } from './view-models/use-printer-commands';`。在 `const printerProfiles = usePrinterProfiles(…)` 之后加：

```ts
  /** 这台打印机负责的纸：标签机指令的纸张按它预填；没负责纸张时按 60×40。 */
  const paperForPrinter = useCallback(
    (name: string) => parsePaperKey(expectedPapers[name] ?? '') ?? DEFAULT_PAPER,
    [expectedPapers],
  );
  const printerCommands = usePrinterCommands(paperForPrinter);
```

`<PrinterList … />` 加 `commands={printerCommands}`。

- [ ] **Step 5: 样式**（`styles/app.css`，`.paper-warning__text` 规则之后）

```css
/* 打印机一行右侧的按钮：测试页、标签机指令 */
.printer-row__actions {
  display: flex;
  gap: var(--space-1);
}

/* 标签机指令：打印机页每台打印机下面展开的面板 */
.printer-commands {
  display: flex;
  grid-column: 1 / -1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0 0 var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-housing);
  border-radius: var(--radius);
  background: var(--color-paper);
}

.printer-commands__hint,
.printer-commands__message {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.printer-commands__hint {
  color: var(--color-ink-soft);
}

.printer-commands__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.printer-commands__message--ok {
  color: var(--color-success);
}

.printer-commands__message--info {
  color: var(--color-ink);
}

.printer-commands__message--error {
  color: var(--color-error);
}
```

- [ ] **Step 6: 检查**

Run: `bun run check`，再 `bun run test:e2e -- e2e/printers.e2e.ts`
Expected: 通过（打印机页原有的用例照常：「测试页」按钮的名字没变）。用 `bun run dev` 带假打印机（`CDL_LABELFLASH_FAKE_PRINTERS='[{"name":"标签机A","paper":{"widthMm":60,"heightMm":40,"dpi":203},"readiness":{"ready":true},"driverName":"Label Printer TSPL"}]'`）打开配置中心「打印机」页看一遍面板。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/view-models/use-printer-commands.ts src/renderer/src/components/PrinterCommandsPanel.tsx src/renderer/src/components/PrinterList.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(renderer): label printer commands panel on the printers page" -m "Each printer row opens a panel with the command set, the settings the set supports (each can stay unchanged), save-and-send, and the four actions. Actions use the saved settings, so they are disabled while edits are unsaved; factory reset asks twice." -m "$TRAILER"
```

---

### Task 16: E2E

**Files:**
- Modify: `e2e/support/app-helpers.ts`
- Create: `e2e/printer-commands.e2e.ts`

- [ ] **Step 1: 辅助函数**（`app-helpers.ts`）

第一行的 import 加上 `type Locator`；`FakePrint` 的 import 改为 `import type { FakePrint, FakeRawJob } from '../../src/main/printing/fake-printers';`。`fakePrints` 之后加：

```ts
/** 假打印机收到的标签机指令（字节按 latin1 转成的文字）。 */
export function fakeRawJobs(app: ElectronApplication): Promise<FakeRawJob[]> {
  return app.evaluate(
    () => (globalThis as { e2eFakePrinters?: { rawJobs: FakeRawJob[] } }).e2eFakePrinters?.rawJobs ?? [],
  );
}

/** 点一个开关：原生复选框被画出来的滑轨盖着，像用户一样点开关本身。 */
export async function clickSwitch(scope: Locator, name: string): Promise<void> {
  await scope
    .locator('label.switch')
    .filter({ has: scope.getByRole('switch', { name }) })
    .click();
}
```

- [ ] **Step 2: 写 E2E**

```ts
// e2e/printer-commands.e2e.ts
import type { Locator, Page } from '@playwright/test';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, clickSwitch, fakePrints, fakeRawJobs, openConfig, scan } from './support/app-helpers';
import { expect, test } from './support/fixtures';

const TSPL_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
  driverName: 'Label Printer TSPL',
};
const OFFICE_PRINTER: FakePrinterSpec = {
  name: '家用打印机',
  paper: { widthMm: 210, heightMm: 297, dpi: 600 },
  readiness: null,
  driverName: 'Office Inkjet',
};
/** 横杠三段：用当前模板「通用」（60×40）。 */
const LABEL_CODE = 'CL5640-TK-图片色-XL';

async function openCommands(page: Page, printerName: string): Promise<Locator> {
  await openConfig(page, '打印机');
  await page.locator('.printer-row', { hasText: printerName }).getByRole('button', { name: '标签机指令' }).click();
  const panel = page.getByRole('region', { name: `${printerName} 的标签机指令` });
  await expect(panel.getByLabel('指令集')).toBeVisible();
  return panel;
}

test('sends TSPL settings once on save, actions on demand, and nothing before each print', async ({
  electronApp,
}) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [TSPL_PRINTER] });
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': TSPL_PRINTER.name }, autoPrint: true });
  await page.reload();
  const panel = await openCommands(page, TSPL_PRINTER.name);
  await expect(panel.getByLabel('指令集').locator('option:checked')).toHaveText('自动（TSPL）');
  await expect(panel.getByText('驱动名「Label Printer TSPL」里写着 TSPL')).toBeVisible();

  await panel.getByLabel('浓度').selectOption('8');
  await panel.getByLabel('速度').selectOption('4');
  await clickSwitch(panel, '设置纸张');
  await expect(panel.getByLabel('纸宽')).toHaveValue('60');
  await panel.getByLabel('出纸方式').selectOption('tear');
  await panel.getByRole('button', { name: '保存并发送' }).click();
  await expect(panel.getByRole('status')).toHaveText('设置已发送到打印机（TSPL）。指令是单向的：打一张看看效果');
  expect(await fakeRawJobs(app)).toEqual([
    {
      printerName: TSPL_PRINTER.name,
      text: 'SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nDENSITY 8\r\nSPEED 4\r\nSET PEEL OFF\r\nSET TEAR ON\r\n',
    },
  ]);

  await panel.getByRole('button', { name: '纸张校准' }).click();
  await expect(panel.getByRole('status')).toHaveText('纸张校准指令已发送到打印机');
  expect((await fakeRawJobs(app)).at(-1)?.text).toBe('GAPDETECT\r\n');

  // 设置只在保存时发：回到工作台打一张，不再带指令。
  await page.getByRole('button', { name: '返回工作台' }).click();
  await scan(page, LABEL_CODE);
  await expect.poll(async () => (await fakePrints(app)).length).toBe(1);
  expect(await fakeRawJobs(app)).toHaveLength(2);
});

test('asks twice before restoring factory settings', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [TSPL_PRINTER] });
  const panel = await openCommands(page, TSPL_PRINTER.name);
  const dialog = page.getByRole('alertdialog', { name: '恢复出厂设置' });

  await panel.getByRole('button', { name: '恢复出厂设置' }).click();
  await panel.getByRole('button', { name: '确认恢复出厂？' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '不恢复' }).click();
  await expect(dialog).toBeHidden();
  expect(await fakeRawJobs(app)).toEqual([]);

  await panel.getByRole('button', { name: '恢复出厂设置' }).click();
  await panel.getByRole('button', { name: '确认恢复出厂？' }).click();
  await dialog.getByRole('button', { name: '恢复出厂设置' }).click();
  await expect(panel.getByRole('status')).toHaveText('恢复出厂设置指令已发送到打印机');
  expect(await fakeRawJobs(app)).toEqual([{ printerName: TSPL_PRINTER.name, text: 'INITIALPRINTER\r\n' }]);
});

test('does not guess a command set it cannot recognise, and sends ZPL once chosen', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [OFFICE_PRINTER] });
  const panel = await openCommands(page, OFFICE_PRINTER.name);
  await expect(panel.getByText('从驱动名「Office Inkjet」认不出用哪种指令')).toBeVisible();
  await expect(panel.getByRole('button', { name: '纸张校准' })).toBeDisabled();

  await panel.getByRole('button', { name: '保存并发送' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    '已保存。认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
  );
  expect(await fakeRawJobs(app)).toEqual([]);

  await panel.getByLabel('指令集').selectOption('zpl');
  await panel.getByLabel('浓度').selectOption('15');
  await expect(panel.getByLabel('分辨率').locator('option:checked')).toHaveText('按驱动（600dpi）');
  await panel.getByRole('button', { name: '保存并发送' }).click();
  await expect(panel.getByRole('status')).toHaveText('设置已发送到打印机（ZPL）。指令是单向的：打一张看看效果');
  expect(await fakeRawJobs(app)).toEqual([{ printerName: OFFICE_PRINTER.name, text: '~SD15\n^XA\n^JUS\n^XZ\n' }]);

  // 主进程只发给系统打印机列表里有的打印机。
  await expect(callApi(page, 'runPrinterAction', '没有这台', 'feed')).rejects.toThrow('Printer not found');
});

test('explains a driver that does not take raw commands', async ({ electronApp }) => {
  const printer: FakePrinterSpec = { ...TSPL_PRINTER, rawFailure: 'raw-rejected' };
  const { page } = await electronApp.launch({ fakePrinters: [printer] });
  const panel = await openCommands(page, printer.name);
  await panel.getByRole('button', { name: '走一张纸' }).click();
  await expect(panel.getByRole('alert')).toContainText('驱动不接受直接发送的指令');
});
```

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e -- e2e/printer-commands.e2e.ts`
Expected: 4 个用例通过。再跑一次全部 `bun run test:e2e`。

- [ ] **Step 4: 提交**

```bash
git add e2e/support/app-helpers.ts e2e/printer-commands.e2e.ts
git commit -m "test(e2e): label printer commands on fake printers" -m "Asserts the exact TSPL bytes sent on save, that a later print sends no commands, the calibration and factory reset bytes behind the double confirmation, that an unrecognised driver sends nothing until a command set is chosen, the ZPL bytes then, and the hint for a driver that refuses raw data." -m "$TRAILER"
```

---

### Task 17: 视觉验收 V80–V83

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（第 8.2 节的表）

- [ ] **Step 1: 加验收项**

文件顶部 `import type { ElectronApplication, Page } from '@playwright/test';` 改为 `import type { ElectronApplication, Locator, Page } from '@playwright/test';`；`../support/app-helpers` 的 import 列表按字母顺序加上 `clickSwitch`。在 PDF 的 `PDF_PRINTERS`（没有就在 `PAPER_PRINTERS`）之后加：

```ts
/** V80–V83：认得出指令集的标签机、驱动不收 RAW 的面单机、认不出的家用打印机。 */
const COMMAND_PRINTERS: FakePrinterSpec[] = [
  {
    name: '标签机A',
    paper: { widthMm: 60, heightMm: 40, dpi: 203 },
    readiness: { ready: true },
    driverName: 'Label Printer TSPL',
  },
  {
    name: '面单机B',
    paper: { widthMm: 100, heightMm: 150, dpi: 203 },
    readiness: { ready: true },
    driverName: 'Label Printer ZPL',
    rawFailure: 'raw-rejected',
  },
  {
    name: '家用打印机',
    paper: { widthMm: 210, heightMm: 297, dpi: 600 },
    readiness: null,
    driverName: 'Office Inkjet',
  },
];

/** 分配好纸张、打开打印机页，展开这台打印机的「标签机指令」。 */
async function openPrinterCommands(page: Page, printerName: string): Promise<Locator> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A', '100x150': '面单机B' } });
  await page.reload();
  await openConfig(page, '打印机');
  await page.locator('.printer-row', { hasText: printerName }).getByRole('button', { name: '标签机指令' }).click();
  const panel = page.getByRole('region', { name: `${printerName} 的标签机指令` });
  await expect(panel.getByLabel('指令集')).toBeVisible();
  return panel;
}
```

在 `ITEMS` 数组里、当时最后一项之后加：

```ts
  {
    id: 'V80',
    title: '打印机 · 标签机指令（认出 TSPL，已发送）',
    points:
      '「标签机A」一行右侧「测试页」「标签机指令」两个按钮同高，后者按下；下面展开浅底面板：指令集「自动（TSPL）」和一句认出的依据；浓度、速度、设置纸张（纸宽、纸高、纸张类型、间隙）、打印方向、出纸方式逐行对齐，TSPL 不显示分辨率；单向提示完整换行；「保存并发送」主按钮；四个动作按钮一行（窄时换行，不溢出）；绿色「设置已发送到打印机（TSPL）…」；1024 宽时面板不撑宽页面、没有横向滚动',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '标签机A');
      await panel.getByLabel('浓度').selectOption('8');
      await panel.getByLabel('速度').selectOption('4');
      await clickSwitch(panel, '设置纸张');
      await panel.getByLabel('出纸方式').selectOption('tear');
      await panel.getByRole('button', { name: '保存并发送' }).click();
      await expect(panel.getByRole('status')).toContainText('设置已发送到打印机（TSPL）');
    },
  },
  {
    id: 'V81',
    title: '打印机 · 标签机指令（认不出）',
    points:
      '指令集「自动（认不出）」，下面一句说明从驱动名认不出、请手动选择或选「不发指令」；没有设置项；四个动作按钮灰掉，下面说明原因；面板高度随内容收拢，不留大块空白',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '家用打印机');
      await expect(panel.getByRole('button', { name: '纸张校准' })).toBeDisabled();
    },
  },
  {
    id: 'V82',
    title: '打印机 · 标签机指令（发送失败）',
    points:
      '指令集「自动（ZPL）」；浓度选项到 30；「分辨率」一行显示「按驱动（203dpi）」；红色提示说明驱动不接受直接发送的指令和下一步，完整换行、不被按钮遮住',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '面单机B');
      await panel.getByLabel('浓度').selectOption('10');
      await panel.getByRole('button', { name: '保存并发送' }).click();
      await expect(panel.getByRole('alert')).toContainText('驱动不接受直接发送的指令');
    },
  },
  {
    id: 'V83',
    title: '打印机 · 恢复出厂设置的二次确认',
    points:
      '模态对话框：标题「恢复出厂设置」、说明会回到出厂值、要重新校准、程序里保存的设置不变；「不恢复」是默认焦点的主按钮，「恢复出厂设置」是次要按钮；背后的页面变暗、不可操作',
    launch: { fakePrinters: COMMAND_PRINTERS },
    setup: async ({ page }) => {
      const panel = await openPrinterCommands(page, '标签机A');
      await panel.getByRole('button', { name: '恢复出厂设置' }).click();
      await panel.getByRole('button', { name: '确认恢复出厂？' }).click();
      await expect(page.getByRole('alertdialog', { name: '恢复出厂设置' })).toBeVisible();
    },
  },
```

文件开头的说明注释里，验收项编号那一句末尾加「，标签机指令是 V80–V83」。

- [ ] **Step 2: 设计文档的验收表**

`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 第 8.2 节表格的最后一行之后加：

```
| V80 | 打印机 · 标签机指令（认出 TSPL，已发送） | 「测试页」「标签机指令」同高；面板里指令集和认出的依据、各项设置逐行对齐、TSPL 不显示分辨率；单向提示；「保存并发送」；四个动作一行、窄时换行；成功提示；1024 宽时不撑宽 |
| V81 | 打印机 · 标签机指令（认不出） | 「自动（认不出）」和说明；没有设置项；动作按钮灰掉并说明原因 |
| V82 | 打印机 · 标签机指令（发送失败） | 「自动（ZPL）」、分辨率一行；红色失败提示和下一步，完整显示 |
| V83 | 打印机 · 恢复出厂设置的二次确认 | 模态对话框的标题、说明；「不恢复」默认焦点；背后不可操作 |
```

- [ ] **Step 3: 跑视觉验收并逐张核对**

Run: `bunx playwright test --config e2e/visual/playwright.config.ts -g "V8"`
Expected: V80–V83 在 1280 / 1024 / 1920 三种尺寸下通过自动检查；打开 `test-results/visual-acceptance/` 里的截图逐项核对 points。打印机一行加了按钮，再跑一次 V35（`-g "V35"`）确认原来的打印机页没有挤坏。Windows 上看 100% 和 150% 缩放；macOS 上核对红绿灯区域不受影响。

- [ ] **Step 4: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items for label printer commands" -m "V80 to V83 cover a recognised TSPL printer after sending, an unrecognised printer, a driver that refuses raw data, and the factory reset confirmation, at 1280, 1024 and 1920 wide. Numbered from V80 so they do not collide with batch and PDF items." -m "$TRAILER"
```

（Step 3 若为了版面改了 `app.css`，一起 `git add`。）

---

### Task 18: 文档

**Files:**
- Modify: `README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 7.1 节）
- Modify: `CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`

- [ ] **Step 1: README**（「功能」列表里「**打印机**」那一条之后加）

```
- **标签机指令**（TSPL / ZPL / EPL）：配置中心「打印机」页每台打印机有「标签机指令」，可以直接给热敏标签机发设置：
  - 指令集默认「自动」：驱动名里写着 TSPL、ZPL 或 EPL 时自动认出；认不出时请手动选，不确定就选「不发指令」，打印照常经驱动。
  - 能设浓度、速度、纸张（宽、高、间隙纸或黑标纸）、打印方向、出纸方式（撕纸 / 剥离，EPL 不设）；每一项都可以「不改」。点「保存并发送」时发一次，之后打印不再重复发。
  - 动作：纸张校准、走一张纸、打印自检页、恢复出厂设置（要确认两次）。
  - 指令是单向的：程序只知道已经发出去，打印机有没有照做要看出纸。经驱动打印时，驱动「打印首选项」里的同名设置可能盖过这里的设置。
  - Windows 经系统的后台打印服务直接发送（RAW）；macOS 用系统自带的 `lp`。驱动不接受直接发送时会说明怎么办。
```

- [ ] **Step 2: 路线图**

`docs/roadmap.md` 状态表里「RAW 指令直连（TSPL）」那一行改为：

```
| 标签机指令（TSPL / ZPL / EPL）：每台打印机选指令集（自动按驱动名认，5c 的在线识别表接进来后先查表），设浓度、速度、纸张、方向、出纸方式，保存时发一次；纸张校准、走纸、自检页、恢复出厂设置。标签内容仍经驱动打印 | 必须 | 开发完成（`feature/printer-commands`），随 2.0.0 发布；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.1 节。Windows 上单元测试（含真 PowerShell 编译 RAW 辅助类）、E2E、视觉验收 V80–V83 通过；热敏标签机真机（三种指令集各一台）、macOS `lp -o raw` 待人工验收。整张标签都用指令打（中文画成位图）、读打印机自身状态仍是以后的事 |
```

- [ ] **Step 3: Windows 验收记录**（`docs/windows-acceptance.md` 末尾加一节，真机验收时逐项填结果）

```
## 标签机指令（子项目 5a，待真机）

| 项 | 怎么验 | 结果 |
|---|---|---|
| RAW 发送通路 | 「Generic / Text Only」驱动 + 本地文件端口的打印机，发「走一张纸」，文件内容逐字节是 `FORMFEED\r\n`（计划 Task 8 Step 5） | |
| TSPL 设置生效 | 一台 TSPL 热敏标签机：浓度 0 和 15 各打一张对比；纸张 60×40、间隙 2mm 后连续打 3 张不跳纸 | |
| TSPL 方向 | 「正常」「旋转 180°」各打一张，确认「正常」是出厂方向（DIRECTION 0）；不是就把 `tspl.ts` 的两个常量对调 | |
| TSPL 撕纸 / 剥离 | 撕纸：打完停在撕纸口；剥离（有剥离器的机器）：底纸剥开 | |
| 校准、走纸、自检、出厂 | 三种指令集各一台，四个动作各做一次；恢复出厂后重新校准能正常打 | |
| ZPL 设置保存 | 发设置后关机再开，浓度、纸张仍在；方向（^PO）、速度（^PR）是否也在（不在就从 ZPL 的设置里去掉这两项） | |
| EPL 档位 | S 的 1–4 档各打一张，速度依次变化 | |
| 驱动覆盖 | 经驱动打一张：驱动「打印首选项」的浓度和这里不同时，以哪个为准（写进 README 的提示） | |
| 驱动不收 RAW | 一台只收 XPS 的驱动（如有）：提示「驱动不接受直接发送的指令」 | |
| 安全软件 | Windows 安全中心开着时第一次发送不被拦（PowerShell 里 Add-Type + P/Invoke） | |
| 打印中发设置 | 批量打印进行中点「保存并发送」：指令排在两张之间，之后的标签按新设置出 | |
```

- [ ] **Step 4: 设计文档第 7.1 节**（在「指令生成是纯函数……」之后加）

```
- **实现时定下的细节**（2026-10-02）：
  - 每一项都可以「不改」：只发操作员设了的项，不把没碰过的设置改成程序的默认值。设置存在设置表的 `printerCommands`（不加迁移），最多 32 台。
  - 「自动」：先查 5c 的在线识别表（`CommandSetCatalog`，按型号），再看驱动名里是否单独写着 TSPL、ZPL 或 EPL（写着两种的不猜）；都认不出就不发，请操作员选。
  - 各指令集的范围：TSPL 浓度 0–15、速度 2–5 英寸/秒；ZPL 浓度 0–30（`~SD`，绝对值）、速度 2–6；EPL 浓度 0–15、速度 1–4 档。间隙 / 黑标 2–10mm。ZPL、EPL 按打印点下发，分辨率默认按驱动报告的（读不到按 203dpi），可以手动选 203 / 300 / 600。
  - EPL 不设出纸方式：它的 `O` 命令同时管切刀和热敏 / 热转印模式。ZPL 恢复出厂只发 `^JUF` + `^JUS`，不发 `^JUN`（会清掉网络设置）。
  - Windows 的发送在常驻 PowerShell 探测进程里：第一次用时 `Add-Type` 编译一小段 C#，P/Invoke winspool（数据类型 RAW），字节 base64 走行协议，单次 ≤ 4KB；错误码 1801 / 5 / 1804 分别提示找不到、没权限、驱动不收 RAW。macOS 用 `lp -d <队列> -o raw`，字节走标准输入。其他平台「不支持」。
  - 指令不是标签：不经 `PrintService`、不写打印记录，每次发送写日志。动作按已保存的设置发送，表单有没保存的修改时动作按钮灰掉。
```

- [ ] **Step 5: CLAUDE.md**

根目录 `CLAUDE.md`「平台」表格在「打印到本机打印机」一行之后加：

```
| 标签机指令（TSPL / ZPL / EPL，原样发送） | ✅ 常驻 PowerShell 探测进程里 P/Invoke winspool（RAW） | ✅ `lp -o raw`（未在真机验证） |
```

「架构」代码块里 `src/main` 一行末尾的括号内加 `、标签机指令（printing/printer-commands-station.ts）`。

`src/core/CLAUDE.md` 模块表在 `printing/resolve-printer.ts` 一行之后加：

```
| `printer-commands/` | 标签机指令：`command-model.ts`（指令集、每种的范围、`CommandSetCatalog` 给 5c 的在线识别表）、`command-set.ts`（按驱动名认，写着两种的不猜）、`sanitize-command-config.ts`（存储宽松、IPC 严格）、`tspl.ts` / `zpl.ts` / `epl.ts`（每种一个生成器，输出 ASCII，对照手册的写法测试）、`printer-commands.ts`（分派、范围把关）。每一项为 null 表示不改，不发 |
```

`src/main/CLAUDE.md`「打印（`printing/`）」一节的「打印机探测」一条改为：

```
- **打印机探测** `printer-probe-host.ts`（只在 Windows 上）：常驻一个 PowerShell 进程，用行协议查询打印机状态、驱动纸张、驱动名，并原样发送标签机指令。
  - 打印机名和数据都用 base64 编码后传入（「命令 名字 [数据]」），名字转义通配符。
  - 原样发送：第一次用时 `Add-Type` 编译一小段 C#（只用 C# 5 语法），P/Invoke winspool 的 W 版函数，数据类型 RAW；Win32 错误写成 `err win32:<错误码> …`。整段脚本经 `-EncodedCommand` 传入，测试核对命令行不超过 32767 字符。
  - 不要改成每次查询都新启动一个 PowerShell：启动一次约耗 1 秒 CPU。
```

并在这一节末尾加：

```
- **标签机指令** `printer-commands-station.ts`：核对打印机在系统列表里 → 认指令集（手动 / 在线识别表 / 驱动名）→ 按范围把关 → 保存（设置的 `printerCommands`）→ 经 `raw-sender.ts` 发送一次。发送方式：Windows 探测进程、macOS `lp -o raw`（参数数组，字节走标准输入）、其他平台「不支持」。驱动名在 `printer-identity.ts`（macOS 取 `printer-make-and-model`）。不经 `PrintService`、不写打印记录，每次发送写日志。假打印机记下收到的指令文字（`rawJobs`）。
```

「平台差异」表加一行：

```
| `printing/raw-sender.ts` + `printer-identity.ts` | 原样发送：探测进程里 winspool RAW；驱动名：`Get-Printer` 的 DriverName | 原样发送：`lp -o raw`；驱动名：ipptool 的 `printer-make-and-model` |
```

`src/renderer/CLAUDE.md`「测试与验收」的 E2E 一条括号里加「，标签机指令在 `printer-commands.e2e.ts`」。

- [ ] **Step 6: `bun run check` 后提交，推送，开 PR**

```bash
git add README.md docs/roadmap.md docs/windows-acceptance.md docs/superpowers/specs/2026-10-01-feature-parity-design.md CLAUDE.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs: describe label printer commands" -m "README, roadmap, the real-printer checklist, the decisions made while building it and where the command generators, the raw senders and the panel live." -m "$TRAILER"
git push -u origin feature/printer-commands
gh pr create --base master --title "feat: label printer commands (sub-project 5a)" --body "<中文说明：做了什么、为什么；安全上怎么限制（只发生成的 ASCII 指令、只发给系统里有的打印机、IPC 只给三种最小能力）；验证（单元测试含 Windows 上真 PowerShell 编译 RAW 辅助类、E2E、视觉验收 V80–V83、待真机验收的项）；只在 Windows 上验证过的写明；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并。合并前在 Windows 上 `bun run dist:win` 装一次，对「Generic / Text Only」+ 文件端口的打印机发一次「走一张纸」，确认安装版里探测进程能编译 C# 并发送（打包后的 PowerShell 调用和开发版相同）；有热敏标签机时按 `docs/windows-acceptance.md` 新加的表逐项验。

---

## 给 5b、5c 留的接口

- **5b（一键诊断）**：「指令集能通信」一项调用 `PrinterCommands.run(printerName, 'feed')`（主进程里直接用同一个实例），按 `PrinterCommandResult` 给结论：`sent` = 已交给系统（打印机有没有走纸请操作员看）；`not-sent` 的 `unknown-command-set` = 提示去选指令集；`failed` 按 `reason` 给修复建议（`raw-rejected` → 重新安装驱动，即 5c）。「纸张校准」修复按钮调用 `run(printerName, 'calibrate')`。5b 不需要新的发送通道。
- **5c（驱动安装）**：实现 `CommandSetCatalog`（`src/core/printer-commands/command-model.ts`）：按 `PrinterIdentity` 查在线清单里的指令集，查不到或清单没下载好返回 `null`；读 PnP 设备时把 USB 的 `vendorId`、`productId` 填进 `PrinterIdentity.usb`（`printer-identity.ts` 的 `queryPrinterIdentity` 和假打印机的 `identity`）。然后在 `src/main/index.ts` 把 `catalog: NO_COMMAND_SET_CATALOG` 换成 5c 的实现。面板里「自动」的说明会自动变成「按在线识别表，这台用 …」。

## 真机验收（人工，写进 `docs/windows-acceptance.md`）

见 Task 18 Step 3 的表。必须有热敏标签机才能确认的：三种指令集的设置是否生效、TSPL 的 `DIRECTION` 哪个是出厂方向、`SET TEAR` / `SET PEEL` 的组合、ZPL 的 `^PO` / `^PR` 是否随 `^JUS` 保存、EPL 的 `S` 档位和 `^default`、各指令集的速度取值在实际机型上是否都有、经驱动打印时驱动设置是否覆盖这里的设置、恢复出厂之后的状态。不用标签机也能做的：Windows 上「Generic / Text Only」+ 文件端口核对字节；安全软件是否拦 `Add-Type`；macOS 上对任意 CUPS 队列 `lp -o raw` 是否还被接受（当前 macOS 的 CUPS 版本）。

---

## Self-Review 记录

- **设计覆盖（第 7.1 节）**：每台打印机「指令集」（自动 / TSPL / ZPL / EPL / 不发指令；自动按在线识别表 + 驱动名）→ Task 1（`detectCommandSet`、`CommandSetCatalog`）、Task 10（驱动名）、Task 15（选择框）；下发：Windows 经常驻 PowerShell 探测进程调用 winspool（`OpenPrinter`、`StartDocPrinter` RAW、`WritePrinter`），不新增原生模块 → Task 8、9；macOS `lp -o raw` → Task 9；只发到系统打印机列表里存在的打印机 → Task 12（station 再核对）、Task 13（IPC 核对）；能设的（浓度、速度、纸张宽高间隙 / 黑标、方向、撕纸 / 剥离）→ Task 3–6、15；动作（校准、走纸、自检、出厂两次确认）→ Task 3–5、12、15；设置保存时发一次、之后打印前不发 → Task 12（只有 `apply` 发设置，`PrintService` 没改）、Task 16（打印后断言没有新指令）；指令单向、状态仍来自驱动 → 用词「已发送到打印机」（Task 14）、`ONE_WAY_HINT`；指令生成是纯函数、每种一个文件、对照手册 → Task 3–5（Step 1 核对手册，测试按手册写法）。第 9 节（不可信输入、上限）→ Task 2（严格 / 宽松两种校验）、Task 8（4KB 上限两处查）、Task 9（`asciiBytes`）；第 11 节（IPC 最小能力、快速失败、依赖注入、小步提交）→ Task 13、`RangeError` / `asciiBytes` 抛错、station 和 sender 都由构造参数注入；两个平台都有明确行为、其他平台「不支持」→ Task 9 `createRawSender`、Task 10 `queryPrinterIdentity`。
- **没有占位**：每个代码步骤给出完整代码；提交说明里的 `<核对手册的结果…>` 是要求实施者填写核对记录（不是代码占位）；Task 5 Step 1 给出 `^default` 不存在时的改法；Task 15 Step 2 给出类型推不出时的改法。
- **类型一致**：`PrinterCommandConfig`、`MediaSetup`、`CommandSet`、`CommandSetChoice`、`PrinterAction`（Task 1）贯穿 Task 2–6、12–15；`DetectedCommandSet`、`PrinterIdentity`、`CommandSetCatalog`（Task 1）用于 Task 10、11、12、14；`RawSendFailureKind`、`NotSentReason`、`PrinterCommandResult`、`PrinterCommandsView`（Task 7）用于 Task 9、11、12、13、14；`ProbeReply`（Task 8）用于 Task 9 的 `rawResultFromProbe`；`RawSendResult`（Task 9）用于 Task 11、12；`CommandForm`、`CommandMessage`、`CommandRequest`（Task 14）用于 Task 15。各处的期望文字一致：E2E、视觉验收用到的「设置已发送到打印机（TSPL）。指令是单向的：打一张看看效果」「纸张校准指令已发送到打印机」「恢复出厂设置指令已发送到打印机」「已保存。认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种」「驱动不接受直接发送的指令」都来自 Task 14 的 `describeCommandResult`；字节期望（`SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\n…`、`~SD15\n^XA\n^JUS\n^XZ\n`、`q480\nQ320,16\n`、`^PW709 ^LL472`）在 Task 3–6、12、16 之间一致。
- **迁移**：不加。设置表是 key → JSON，`printerCommands` 是新的一项，读写都经 `sanitizeSettings`。
- **要再确认的决定**：
  1. 每一项可以「不改」（null），只发设了的项；默认全是「不改」，纸张开关默认关。
  2. 「自动」只认驱动名里单独成词的 TSPL / ZPL / EPL，写着两种的不猜；按型号认交给 5c 的在线清单（仓库里不写型号）。
  3. EPL 不提供撕纸 / 剥离；ZPL 恢复出厂不发 `^JUN`；ZPL 浓度用 `~SD`（绝对）不用 `^MD`（相对）。
  4. 速度只给各机型普遍有的几档（TSPL 2–5、ZPL 2–6、EPL 1–4 档），以手册核对结果为准。
  5. 动作按**已保存**的设置发送，表单有改动时灰掉；「不发指令」和认不出时照样保存选择。
  6. 指令不写打印记录、不经打印队列；批量打印进行中也允许发（会排在两张之间），真机验收里确认。
  7. Windows 的 C# 用 `Add-Type` 在探测进程里第一次用到时编译：不算原生模块，但安全软件可能拦，列入真机验收。
- **风险**：经驱动打印时驱动每次可能带上自己的浓度、纸张设置，盖过这里发的（界面已提示，真机验收确认）；某些驱动不收 RAW（1804，给出改装厂家驱动或选「不发指令」的指引）；macOS 的 `-o raw` 在当前 CUPS 上的行为未验证。
