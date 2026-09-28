# 手机扫码打印（云端中转）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机网页扫码，经云端中转服务，在店里电脑的热敏标签机上打印；电脑只在会话进行中连接中转服务，内容端到端加密。中转地址是设置项，代码里不写域名（官方安装包的默认值在构建时注入）。

**Architecture:**
- 中转服务是一个无状态的 Bun 程序：按会话号在电脑和手机的 WebSocket 之间转发加密消息，同时提供扫码页的静态文件。
- 会话的认领、校验、限流和打印都在电脑主进程里，打印经 `PrintService`。
- 三方共用 `src/shared/` 里的协议、加密和重连模块。

**Tech Stack:**
- 已有：Bun 1.4.2（`Bun.serve` WebSocket、`bun build`、`bun test`）、WebCrypto AES-GCM、TypeScript、Biome、Playwright（本机 Edge）、`qrcode`（测试里生成二维码）。
- 新增依赖：zxing-wasm 3.1.x，只打进扫码页，不进 Electron 的 bundle。

**设计文档:** `docs/superpowers/specs/2026-09-29-mobile-scan-relay-design.md`（下称「设计」）。

## 变更记录

- **2026-09-29 中转地址不写进代码**：项目开源，中转地址改为设置项，官方安装包的默认值在构建时注入；中转服务的 `PUBLIC_ORIGIN` 必填、没有默认值。
- **2026-09-29 扫码即打 + 幂等任务**：需求方要求界面上扫到就打，协议按正规做法设计。
  - 内层消息改为 `hello` / `submit`（手机 → 电脑）和 `welcome` / `denied` / `printer` / `accepted` / `queue` / `started` / `result` / `refused`（电脑 → 手机），去掉 `preview`、`busy` 和请求超时。
  - 任务号是幂等键；手机的发件箱在重连后原样重发；排队执行，超出上限明确拒绝（设计 4.3、4.4、5.2）。
- **2026-09-29 摄像头对焦**：显式设置持续对焦、点按对焦、适度变焦（设计 6.2），见 Task 10a。
- **2026-09-29 几个人同时用**：一个二维码最多 5 部手机，各有令牌，可以移除；所有手机的任务共用一个队列（设计 4.3、4.4）。
- **2026-09-29 完整审查后的修复**：
  - 协议：排队位置改为每部手机一条 `queue`，只发给位置变了的手机；已接受的任务长时间没进展就再问一次；消息大小上限和最坏情况测试；移除手机后暂停加入（`denied: locked`）；关闭码集中到 `CLOSE_CODES`；连接超时；被对端接纳后才重置退避。
  - 中转服务：生产模式和错误处理；满了在升级前回 503；单调时钟；限速按手机和任务上限算。
  - 电脑端：每条链都接住异常；电脑重连后手机列表对得上；二维码有效期从显示时算起；告诉手机的是打印机的显示名。
  - 扫码页：点「开始扫码」才开摄像头；发件箱存进 `localStorage`；按码分开防抖；只解码看得见的区域；识别组件的加载、超时和失败；控制器可测；无障碍和对比度。
  - 发布脚本：不发有未提交改动或正在运行的版本；构建脚本不会清空错误的目录。
- **2026-09-29 目标版本改为 1.0.1**：需求方决定手机扫码随 1.0.1 发布。阶段 5 基于配置中心的分支做。
- **下面各任务里的契约是当时的版本**：实现过程中已多次调整，以代码和设计文档为准（`src/shared/mobile-protocol.ts`、`src/shared/mobile-status.ts`、`src/main/mobile/`、`relay/web/src/`）。
- **进度**：Task 1–14 已完成并提交，审查修复已完成；Task 15（真手机）待需求方；阶段 5 进行中。

---

## 全局约束

- **阶段 1–4 的冻结**：当时配置中心在另一个分支上重构，这四个阶段不改 `src/renderer/`、`e2e/` 和 `src/main/` 里已有的文件，只新增文件。阶段 5 基于 `feature/config-center` 做。
- **提交前**：每个提交都通过 `bun run check`（Biome、类型检查、全部单元测试）。
- **提交信息**：英文 Conventional Commits，正文写为什么改。
- **写法**：
  - 注释写中文，解释为什么。
  - 常量带单位后缀，并注明取值依据。
  - 测试先行：先写失败的测试，再实现。
- **命名**：文档和代码里不出现参考产品的名称，打印机只写「热敏标签机」。
- **不写域名**：代码、测试、脚本里不出现官方中转服务的域名，测试用 `relay.example.com`。官方地址只在文档里说明「官方安装包默认用 yterm.cn」，具体服务器的配置不进仓库。

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/shared/mobile-protocol.ts` | 常量、外层信封与内层消息的类型、解析与校验、私有链接的拼装与解析 |
| `src/shared/mobile-crypto.ts` | base64url、随机 ID、AES-256-GCM 的加密（seal）和解密（open） |
| `src/shared/print-cues.ts` | 打印结果 → 播报句 |
| `src/shared/relay-socket.ts` | 通用的重连 WebSocket：心跳、退避重连；电脑和手机共用 |
| `relay/src/token-bucket.ts` | 令牌桶限流 |
| `relay/src/hub.ts` | 中转核心：会话表、路由、所有权、宽限期、容量、限流（纯逻辑，假连接可测） |
| `relay/src/config.ts` | 从环境变量读配置 |
| `relay/src/static-files.ts` | 扫码页静态文件、安全响应头、缓存头 |
| `relay/src/server.ts` | `Bun.serve` 接线：HTTP 路由、WebSocket → hub |
| `relay/src/main.ts` | 入口：读配置、启动、处理 SIGTERM |
| `relay/web/index.html`、`relay/web/styles.css` | 扫码页外壳和样式 |
| `relay/web/src/phone-state.ts` | 页面状态机（reducer），状态用可辨识联合 |
| `relay/web/src/result-view.ts` | 任务、整页提示、取景提示的文字和按钮（纯函数） |
| `relay/web/src/device-label.ts` | UA → 「iPhone · 微信」 |
| `relay/web/src/phone-session.ts` | 手机端协议：join、hello、nonce 与 seq、发件箱、重发与进度查询、not-found 宽限期 |
| `relay/web/src/session-store.ts` | 按会话保存令牌和发件箱（`localStorage`，异常时降级为内存，过期记录自动清掉） |
| `relay/web/src/scan-gate.ts` | 取景防抖，按码分开记 |
| `relay/web/src/barcode-text.ts`、`reader-options.ts` | 没有 ECI 时判断 UTF-8 / GBK；zxing 的码制和选项（worker 和测试共用） |
| `relay/web/src/decode-worker.ts`、`decoder.ts` | worker 里解码；主线程侧一次只送一帧，管加载、超时和失败 |
| `relay/web/src/camera-features.ts`、`camera.ts` | 对焦、变焦、可见区域的计算（纯函数）；摄像头、取帧、手电筒、屏幕常亮 |
| `relay/web/src/phone-controller.ts` | 编排：状态机、会话、摄像头、解码、页面；浏览器能力经接口注入 |
| `relay/web/src/view.ts`、`main.ts` | 渲染；创建真实的浏览器对象 |
| `relay/tsconfig.json`、`relay/web/tsconfig.json` | 服务端（Bun）和页面（DOM）的类型检查 |
| `scripts/relay/build.ts` | 构建 `relay/dist/`：`server.js` 和带哈希的 `web/` |
| `scripts/relay/deploy.ts` | 上传、`docker build`、替换容器、健康检查；目标服务器从环境变量读取 |
| `scripts/relay/demo-desktop.ts` | 命令行电脑端：终端里显示二维码，打出收到的请求，不真的打印；给真手机试用 |
| `relay/Dockerfile`、`relay/deploy/nginx-location.conf` | 镜像；nginx 示例片段（域名用占位符） |
| `relay/README.md`、`relay/CLAUDE.md` | 运行、部署、约束 |
| `src/main/mobile/relay-endpoint.ts` | 中转地址：设置优先、构建默认值兜底，校验并拼出各地址 |
| `src/main/mobile/mobile-session.ts` | 电脑端会话状态 |
| `src/main/mobile/mobile-replies.ts` | `PrintService` 结果 → 手机精简结果 |
| `src/main/mobile/mobile-host.ts` | 电脑端编排：socket + 加密 + 会话 + 注入的打印函数和当前打印机 |
| `src/shared/mobile-status.ts` | 推给界面的会话状态类型（阶段 5 的 IPC 用） |
| `src/shared/duration-text.ts` | 时长的说法（防重复窗口、到期时间），界面和扫码页共用 |
| `relay/test/fake-camera.ts`、`relay/test/phone-page.browser.ts` | 二维码 → Y4M 假摄像头视频；Edge 驱动扫码页的浏览器测试（`bun run test:relay-browser`） |

---

## 阶段 1：协议与中转服务

### Task 1: 协议常量、类型与解析

**Files:**
- Create: `src/shared/mobile-protocol.ts`
- Test: `src/shared/mobile-protocol.test.ts`

- [ ] **Step 1: 写失败的测试**，覆盖以下用例，每个用例一个 `test`：
  - `parseDesktopFrame`：
    - 接受 `{"t":"open","v":1,"session":<22位>,"secret":<22位>}`；
    - 拒绝 `session` 长度不对、含非法字符、缺 `secret`、`v` 不是整数；
    - 接受 `send`（`phone` 为非空字符串，`body` 为 `{iv, ct}`）、`kick`、`close`（`reason` 属于 `CLOSE_REASONS`）、`ping`；
    - 拒绝未知的 `t`、非 JSON、JSON 数组、`null`。
  - `parsePhoneFrame`：接受 `join` / `send` / `ping`；`body.iv` 不是 base64url 时拒绝。
  - `parseRelayToDesktop`、`parseRelayToPhone`：每种消息接受一例；`error.code` 不在 `RELAY_ERROR_CODES` 里时拒绝。
  - `parsePhoneMessage`：
    - `hello` 的 `device` 超过 `MAX_DEVICE_LENGTH` 时截断（不拒绝）；`token` 为 null 或 22 位；
    - `preview` / `print` 的 `id` 必须是正的安全整数；`raw` 必须是字符串且不超过 `MAX_RAW_LENGTH * 4`，更细的校验交给 `PrintService`；`force` 必须是布尔值。
  - `parseDesktopMessage`：`welcome`、`rejected`、`preview`（`ok` 与 `invalid`）、`print`（五种状态）、`busy`、`rate-limited` 各一例；`failed.reason` 不在 `PRINT_FAILURE_REASONS` 里时拒绝。
  - `buildPhoneUrl('https://relay.example.com/labelflash/', s, k)` 得到 `https://relay.example.com/labelflash/m/#s.k`；`parsePhoneFragment('#s.k')` 还原出 `{ session: s, key: k }`；空串、缺点号、长度不对时返回 null。

- [ ] **Step 2: 运行测试，确认失败**：`bun test src/shared/mobile-protocol.test.ts`。预期失败：找不到模块。

- [ ] **Step 3: 实现。** 契约如下（类型必须和这里一致，后续任务都依赖它）：

```ts
export const MOBILE_PROTOCOL_VERSION = 1;
/** 会话号、所有权密钥、手机令牌、nonce：16 字节随机数（128 位，不可猜），base64url 后 22 个字符。 */
export const ID_BYTES = 16;
/** 内容密钥：AES-256，32 字节，base64url 后 43 个字符。 */
export const KEY_BYTES = 32;
/** 单帧上限：最长的内容是 30 个字段的预览，远小于这个值；中转服务按它设置 maxPayloadLength。 */
export const MAX_FRAME_BYTES = 64 * 1024;
/** 心跳间隔：远小于 nginx 的 proxy_read_timeout（120 秒）和移动网络 NAT 常见的 60 秒空闲回收。 */
export const HEARTBEAT_INTERVAL_MS = 25_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const FIRST_FRAME_TIMEOUT_MS = 10_000;
/** 电脑断线后中转服务保留会话的时间：够电脑换网络或重启中转服务后重连。 */
export const DESKTOP_GRACE_MS = 120_000;
/** 被接纳过的手机收到 not-found 后继续重试的时间：中转服务重启时手机可能比电脑先连上。 */
export const RESUME_RETRY_MS = 30_000;
export const MAX_DEVICE_LENGTH = 40;

export const CLOSE_REASONS = ['stopped', 'idle', 'quit'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const END_REASONS = [...CLOSE_REASONS, 'desktop-gone'] as const;
export type EndReason = (typeof END_REASONS)[number];
export const RELAY_ERROR_CODES = ['version', 'session-taken', 'bad-frame', 'rate-limited', 'server-busy'] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export interface SealedBody { iv: string; ct: string }

export type DesktopFrame =
  | { t: 'open'; v: number; session: string; secret: string }
  | { t: 'send'; phone: string; body: SealedBody }
  | { t: 'kick'; phone: string }
  | { t: 'close'; reason: CloseReason }
  | { t: 'ping' };
export type RelayToDesktop =
  | { t: 'opened' }
  | { t: 'joined'; phone: string }
  | { t: 'left'; phone: string }
  | { t: 'recv'; phone: string; body: SealedBody }
  | { t: 'pong' }
  | { t: 'error'; code: RelayErrorCode };
export type PhoneFrame = { t: 'join'; v: number; session: string } | { t: 'send'; body: SealedBody } | { t: 'ping' };
export type RelayToPhone =
  | { t: 'online' }
  | { t: 'waiting' }
  | { t: 'recv'; body: SealedBody }
  | { t: 'ended'; reason: EndReason }
  | { t: 'not-found' }
  | { t: 'kicked' }
  | { t: 'pong' }
  | { t: 'error'; code: RelayErrorCode };

export type PhoneMessage =
  | { type: 'hello'; token: string | null; device: string }
  | { type: 'preview'; nonce: string; id: number; raw: string }
  | { type: 'print'; nonce: string; id: number; raw: string; force: boolean };

export interface PhoneField { name: string; value: string }
export type PhonePreview =
  | {
      status: 'ok';
      ruleName: string;
      templateName: string;
      fields: PhoneField[];
      /** 字段数或字段值超过上限被截断了。 */
      truncated: boolean;
      recent: RecentPrint | null;
      windowMs: number;
      lookupFailure: string | null;
    }
  | { status: 'invalid'; reason: InvalidReason };
export type PhonePrintResult =
  | { status: 'printed' }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'failed'; reason: PrintFailureReason; detail: string | null; issue: PrinterIssue | null }
  | { status: 'no-printer' };
export type DesktopMessage =
  | { type: 'welcome'; token: string; nonce: string; printer: string | null }
  | { type: 'rejected' }
  | { type: 'preview'; id: number; result: PhonePreview }
  | { type: 'print'; id: number; result: PhonePrintResult }
  | { type: 'busy'; id: number }
  | { type: 'rate-limited'; id: number };

export function parseDesktopFrame(text: string): DesktopFrame | null;
export function parseRelayToDesktop(text: string): RelayToDesktop | null;
export function parsePhoneFrame(text: string): PhoneFrame | null;
export function parseRelayToPhone(text: string): RelayToPhone | null;
export function parsePhoneMessage(value: unknown): PhoneMessage | null;
export function parseDesktopMessage(value: unknown): DesktopMessage | null;
export function isRandomId(value: unknown): value is string;
export function isSessionKey(value: unknown): value is string;
export function buildPhoneUrl(baseUrl: string, session: string, key: string): string;
export function parsePhoneFragment(hash: string): { session: string; key: string } | null;
```

  - 解析函数先 `JSON.parse`（出错返回 null），再逐字段检查，只返回白名单里的字段，多余字段丢掉。
  - 枚举值用 `includes` 检查，类型来自 `core/types.ts`（`PRINT_FAILURE_REASONS`）和 `shared/printer-readiness.ts`（`PRINTER_ISSUES`）。

- [ ] **Step 4: 运行测试，确认通过**：`bun test src/shared/mobile-protocol.test.ts`。
- [ ] **Step 5: 提交**：`feat(mobile): relay protocol types and validators`。

### Task 2: 端到端加密

**Files:**
- Create: `src/shared/mobile-crypto.ts`
- Test: `src/shared/mobile-crypto.test.ts`

- [ ] **Step 1: 写失败的测试：**
  - `randomId()` 满足 `isRandomId`，连续 100 个互不相同；`randomKey()` 满足 `isSessionKey`。
  - `toBase64Url` / `fromBase64Url` 往返任意字节（0–255 全部取值）；输出不含 `+`、`/`、`=`。
  - `sealMessage(key, 'p2d', session, msg)` 后用 `openMessage(key, 'p2d', session, body)` 还原出相同对象（含中文）。
  - `openMessage` 在以下情况返回 null：方向不同（`d2p`）、会话号不同、密钥不同、`ct` 改了一个字符、`iv` 长度不对。
  - 同一条消息 seal 两次，`iv` 不同。

- [ ] **Step 2: 运行，确认失败。**

- [ ] **Step 3: 实现**，接口如下：

```ts
export type Direction = 'p2d' | 'd2p';
export function toBase64Url(bytes: Uint8Array): string;
export function fromBase64Url(text: string): Uint8Array | null;
export function randomId(): string;   // ID_BYTES
export function randomKey(): string;  // KEY_BYTES
export function importSessionKey(key: string): Promise<CryptoKey>;  // AES-GCM, 不可导出，只能 encrypt/decrypt
export function sealMessage(key: CryptoKey, direction: Direction, session: string, message: unknown): Promise<SealedBody>;
export function openMessage(key: CryptoKey, direction: Direction, session: string, body: SealedBody): Promise<unknown | null>;
```

  - 附加数据是 `labelflash/${MOBILE_PROTOCOL_VERSION}/${direction}/${session}` 的 UTF-8 字节；IV 12 字节。
  - `openMessage` 捕获解密或 `JSON.parse` 的异常，返回 null。调用方记日志，这里不记。
  - 只用 `globalThis.crypto`，不 import `node:crypto`：浏览器也要用这个文件。

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(mobile): end-to-end encryption for relay messages`。

### Task 3: 打印结果 → 播报句

**Files:**
- Create: `src/shared/print-cues.ts`
- Test: `src/shared/print-cues.test.ts`

- [ ] **Step 1: 写失败的测试**。和 `src/renderer/src/lib/feedback-cues.ts` 现有行为逐条一致：
  - `printed`：`scan` → `printed`、`force` → `forced`、`history` → `reprinted`、`test` → `testPrinted`；
  - `duplicate`：`printing` → `stillPrinting`，`printed` → `duplicate`；
  - `invalid` → `invalid`；
  - `failed`：
    - `PRINTER_NOT_READY` 按 `issue` 对应：`paperOut`、`paperJam`、`doorOpen`、`printerOffline`、`printerNotReady`，没有 `issue` 时为 `printerNotReady`；
    - `PRINTER_NOT_FOUND` → `printerNotFound`、`PRINT_TIMEOUT` → `timeout`、`PRINT_ERROR` → `failed`、`LOOKUP_FAILED` → `lookupFailed`。
  - 另测一条：`PhonePrintResult` 的 `failed`（`issue: null`）也能直接传入。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**

```ts
export type PrintMode = 'scan' | 'force' | 'history' | 'test';
/** PrintResult 和手机收到的精简结果都满足这个结构。 */
export type PrintOutcome =
  | { status: 'printed' }
  | { status: 'duplicate'; recent: RecentPrint }
  | { status: 'invalid' }
  | { status: 'failed'; reason: PrintFailureReason; issue?: PrinterIssue | null };
export function printResultCue(result: PrintOutcome, mode: PrintMode): VoiceCue;
```

  阶段 5 让 `feedback-cues.ts` 改用它，并删除界面里重复的对应关系。

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(mobile): share print result cues outside the renderer`。

### Task 4: 可重连的 socket

**Files:**
- Create: `src/shared/relay-socket.ts`
- Test: `src/shared/relay-socket.test.ts`（用假 socket 和假计时器）

- [ ] **Step 1: 写失败的测试：**
  - `start()` 用 `url` 调一次 `createSocket`；socket `open` 时调用 `onOpen`。
  - `open` 之后每 `HEARTBEAT_INTERVAL_MS` 发一次 `{"t":"ping"}`。发出后 `HEARTBEAT_TIMEOUT_MS` 内收到任何一帧都算活着；收不到就 `close()` 并按退避重连。
  - 断线后按 `RECONNECT_DELAYS_MS` 依次等待 1、2、5、10、30、30 秒再连；连上后计数归零。
  - 每次断线调用一次 `onDown`（同一次断线不重复调用）。
  - `send()` 在未连接时返回 false，不抛错。
  - `stop()` 之后不再重连、不再调用回调，并关闭当前 socket（code 1000）。
  - 收到的非字符串帧（二进制）丢弃。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**

```ts
/** 浏览器 WebSocket 和 Node 24 的全局 WebSocket 都满足的最小接口。 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
export interface SocketTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface RelaySocketOptions {
  url: string;
  createSocket: (url: string) => SocketLike;
  timers: SocketTimers;
  onOpen: () => void;
  onFrame: (text: string) => void;
  onDown: () => void;
}
export class RelaySocket {
  constructor(options: RelaySocketOptions);
  start(): void;
  stop(): void;
  send(frame: object): boolean;
  get isOpen(): boolean;
}
```

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(mobile): reconnecting relay socket with heartbeat`。

### Task 5: 中转核心 hub

**Files:**
- Create: `relay/src/token-bucket.ts`、`relay/src/hub.ts`、`relay/tsconfig.json`
- Modify: `package.json`（`typecheck` 加上 `tsc --noEmit -p relay/tsconfig.json`）
- Test: `relay/src/token-bucket.test.ts`、`relay/src/hub.test.ts`（假 `Peer` 记录收到的帧和关闭码，时钟用 `src/core/testing/fake-clock.ts`）

- [ ] **Step 1: 写失败的测试：**
  - 令牌桶：
    - 突发额度用完后 `take()` 为 false；
    - 按速率随时间恢复，但不超过突发额度。
  - hub：
    - **登记**：电脑 `open` 后收到 `opened`，`stats().sessions` 为 1。`v` 不是当前版本时回复 `error: version` 并以 1008 关闭。
    - **接管**：同一 `session`、同一 `secret` 的第二个电脑连接接管会话；旧连接以 4001 关闭；新连接收到 `opened`，并对已在的每部手机各收到一条 `joined`。
    - **冲突**：同一 `session`、不同 `secret` 时回复 `error: session-taken` 并关闭。
    - **加入**：
      - 手机 `join` 已有会话：手机收到 `online`，电脑收到 `joined`（连接号就是手机的 `peer.id`）；
      - `join` 不存在的会话：收到 `not-found` 并关闭；
      - 电脑断线期间 `join`：收到 `waiting`。
    - **转发**：
      - 手机的 `send` 变成给电脑的 `{t:'recv', phone, body}`；
      - 电脑的 `send` 只送到指定的手机；`phone` 不在这个会话时丢弃。
    - **踢出**：电脑 `kick` 后，手机收到 `kicked` 并被关闭，电脑收到 `left`。
    - **结束**：电脑 `close: stopped` 后，每部手机收到 `ended: stopped` 并被关闭，会话被删除，电脑连接以 1000 关闭。
    - **宽限期**：
      - 电脑断线：手机收到 `waiting`；
      - `DESKTOP_GRACE_MS` 内电脑重新 `open`：手机收到 `online`；
      - 超过宽限期后 `tick()`：手机收到 `ended: desktop-gone`，会话被删除。
    - **第一帧超时**：连接后 `FIRST_FRAME_TIMEOUT_MS` 内没发第一帧，`tick()` 以 1008 关闭它。
    - **顺序**：第一帧不是 `open` / `join` 时回复 `bad-frame` 并关闭。
    - **容量**：
      - 会话满 → `server-busy`；
      - 每个会话的手机满 → `server-busy`；
      - 同一 IP 连接满 → `attach` 返回 false。
    - **限流**：超出令牌桶的帧被丢弃并回复 `rate-limited`；累计 50 次后关闭。
    - **日志**：不含 `body`，会话号只出现前 6 个字符（断言日志里不出现完整会话号）。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**

```ts
export interface Peer {
  readonly id: string;
  readonly ip: string;
  send(text: string): void;
  close(code: number, reason: string): void;
}
export type PeerRole = 'desktop' | 'phone';
export interface HubLimits {
  maxSessions: number;          // 500
  maxConnections: number;       // 2000
  maxPhonesPerSession: number;  // MAX_PHONES_PER_SESSION × 2
  maxConnectionsPerIp: number;  // 20
}
export interface HubDeps { clock: Clock; log: (line: string) => void; limits?: Partial<HubLimits> }
export class RelayHub {
  constructor(deps: HubDeps);
  /** 超出容量时返回 false，由调用方以 1013 关闭。 */
  attach(peer: Peer, role: PeerRole): boolean;
  receive(peer: Peer, text: string): void;
  detach(peer: Peer): void;
  /** 每秒调用：第一帧超时、宽限期到期。 */
  tick(): void;
  stats(): { sessions: number; connections: number };
}
```

  - 所有权：`node:crypto` 的 `createHash('sha256')` 算出 `secret` 的哈希，再用 `timingSafeEqual` 比较。
  - 关闭码用协议里的 `CLOSE_CODES`（`normal` 1000、`policy` 1008、`tryLater` 1013、`replaced` 4001），三方共用一份。
  - 另有 `hasRoom(ip)`：`server.ts` 在升级成 WebSocket 之前先问，满了回 503。

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(relay): stateless session hub with ownership, grace and limits`。

### Task 6: 配置、静态文件与服务接线

**Files:**
- Create: `relay/src/config.ts`、`relay/src/static-files.ts`、`relay/src/server.ts`、`relay/src/main.ts`
- Test: `relay/src/config.test.ts`、`relay/src/static-files.test.ts`、`relay/src/server.test.ts`

- [ ] **Step 1: 写失败的测试：**
  - `readConfig(env)`：
    - 默认值：主机 `0.0.0.0`、端口 3180、`webRoot` 为 `<入口所在目录>/web`；
    - `PUBLIC_ORIGIN` 必填，没有默认值；必须是 https 的 origin（不含路径），`http://localhost` / `http://127.0.0.1` 只给开发用；
    - `PORT` 不是 1–65535 的整数时抛出带变量名的错误。
  - `serveStatic(root, pathname, origin)`：
    - `/m/` 返回 `index.html`，带设计 4.6 的 CSP（含 `wss://<origin 的 host>`）、`Permissions-Policy`、`Referrer-Policy`、`nosniff`、`no-cache`；
    - `/m/assets/app-abc123.js` 返回 `max-age=31536000, immutable` 和正确的 `Content-Type`（`.js`、`.css`、`.wasm` → `application/wasm`）；
    - `/m/../server.js`、`/m/%2e%2e/x`、绝对路径都返回 404；
    - 不存在的文件返回 404。
  - 服务集成测试（`Bun.serve` 用 0 端口，真实 WebSocket 客户端）：
    - `/healthz` 返回 `{ok:true, version, sessions:0, connections:0}`；
    - `/` 302 到 `m/`；
    - 电脑 `open` → 手机 `join`（带 `Origin` 为配置的 `PUBLIC_ORIGIN`）→ 双向转发 → 电脑 `close` → 手机收到 `ended`；
    - 手机连接的 `Origin` 不对时，升级请求返回 403；
    - 超过 `MAX_FRAME_BYTES` 的帧导致连接关闭。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**

```ts
export interface RelayConfig { host: string; port: number; publicOrigin: string; webRoot: string; version: string }
export function readConfig(env: Record<string, string | undefined>, entryDir: string, version: string): RelayConfig;
export function serveStatic(root: string, pathname: string, origin: string): Promise<Response>;
export interface RunningRelay { url: URL; hub: RelayHub; stop(): Promise<void> }
export function startRelay(config: RelayConfig, log: (line: string) => void): RunningRelay;
```

  - WebSocket 选项：`maxPayloadLength: MAX_FRAME_BYTES`，`idleTimeout: 120`（秒，兜底；应用层心跳是 25 秒），`sendPings: true`，`perMessageDeflate: false`（帧很小，而且压缩加密内容没有意义）。
  - 来源 IP 取 `X-Real-IP`（服务只监听 127.0.0.1，这个头只可能来自 nginx），没有时用 `server.requestIP(req)`。
  - `setInterval(() => hub.tick(), 1_000)`。
  - `main.ts` 收到 SIGTERM 时，先停止接受新连接再退出。
  - `version` 由构建时的 `define` 注入 `RELAY_VERSION`（取 `package.json` 版本加 git 短哈希）。

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(relay): http routes, static page headers and websocket wiring`。

---

## 阶段 2：扫码页

### Task 7: 纯逻辑（状态机、结果文字、设备描述、令牌存储）

**Files:**
- Create: `relay/web/src/phone-state.ts`、`result-view.ts`、`device-label.ts`、`token-store.ts`、`relay/web/tsconfig.json`
- Modify: `package.json`（`typecheck` 加上 `relay/web/tsconfig.json`）
- Test: 同名 `*.test.ts`

- [ ] **Step 1: 写失败的测试：**
  - `reducePhone`，按设计 6.1 的状态走一遍：
    - `no-link`：没有链接时的初始状态；
    - 连接：`connecting` → `online` → `welcome` → `scanning`；
    - 预览：`decoded` → `checking` → `preview ok` → `confirm`；
    - 打印：`print` → `printing` → `printed` → `result`，1.5 秒自动继续由页面计时，reducer 只负责 `continue` 事件 → `scanning`；
    - 其他终止状态：`preview invalid` → `result`；`waiting` → `waiting-desktop`；`ended` → `ended`（带原因）；`not-found` → `not-found`；`rejected` / `kicked` → `taken`；
    - `camera-unavailable` 之后，`scanning` 显示为降级模式（拍照 / 手动输入）；
    - `busy` / 请求超时回到 `confirm`，并带一条提示；
    - 在 `printing` 期间收到的 `decoded` 被忽略。
  - `resultView`：
    - `printed` → `{tone:'success', title:'已发送打印'}`；
    - `duplicate` → 提醒，带「N 秒内已打印过」，动作是「强制补打」；
    - `failed` + `paperOut` → 故障，标题「打印机缺纸」；
    - `no-printer` → 标题「请先选择打印机」，说明「在电脑上选择打印机后重试」；
    - 预览的 `lookupFailure` 不为 null 时，没有打印按钮。
  - `deviceLabel(ua)`：
    - iPhone Safari → `iPhone · Safari`；iPhone 微信（UA 含 `MicroMessenger`）→ `iPhone · 微信`；
    - 安卓 Chrome → `安卓 · Chrome`；iPad → `iPad · Safari`；
    - 未知 → `手机浏览器`；
    - 结果不超过 `MAX_DEVICE_LENGTH`。
  - `createTokenStore(storage)`：按会话读写；`storage` 抛异常时退回内存，不抛错。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现。** `result-view.ts` 的标题一律取 `VOICE_CUE_TEXT[printResultCue(...)]`；说明文字写手机上的操作指引，例如「处理好打印机后点「重试」」。
- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(phone): page state machine and result wording`。

### Task 8: 手机端协议

**Files:**
- Create: `relay/web/src/phone-session.ts`
- Test: `relay/web/src/phone-session.test.ts`（用真实加密，socket 和计时器用假的）

- [ ] **Step 1: 写失败的测试：**
  - 连上后先发 `join`（带会话号和版本），收到 `online` 后发加密的 `hello`（带令牌和设备描述）。
  - 收到 `welcome`：保存令牌，记住 `nonce`，发出 `welcome` 事件（带打印机名）。
  - `preview(raw)` 和 `print(raw, force)` 带上 `nonce` 和递增的 `id`，结果按 `id` 对应回调用方。
  - 60 秒没有回复时，以 `timeout` 结束该请求。
  - 重连后重新 `join` / `hello`，旧的未完成请求以 `timeout` 结束。
  - 被接纳过的会话收到 `not-found`：在 `RESUME_RETRY_MS` 内继续重连，超时后发出 `not-found` 事件；从没被接纳过的会话收到 `not-found`，立即发出事件。
  - 解密失败的 `recv` 被丢弃，不抛错。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现**，基于 `RelaySocket` 和 `mobile-crypto`。事件通过构造参数里的 `onEvent(event: PhoneEvent)` 传给页面，`PhoneEvent` 与 `phone-state.ts` 的事件类型一致。
- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(phone): phone-side relay session`。

### Task 9: 解码（zxing-wasm）

**Files:**
- Modify: `package.json`（devDependencies 加 `zxing-wasm`：只在构建扫码页时用到）
- Create: `relay/web/src/reader-options.ts`、`relay/web/src/decode-worker.ts`、`relay/web/src/decoder.ts`
- Test: `relay/web/src/reader-options.test.ts`（在 Bun 里直接调用 zxing-wasm）

- [ ] **Step 1: 写失败的测试。** 用 `qrcode` 生成二维码的模块矩阵，按每个模块 8 像素、四周留 4 个模块的白边画成 RGBA 的 `ImageData` 结构：
  - UTF-8 的 `CL5640-TK-图片色-XL` 解出原文；
  - 多行键值 `订单号：123\n款号：CL5640` 解出原文，换行保留；
  - GBK 编码的 `CL5640-TK-图片色-XL`（`qrcode` 的字节模式段，数据是 GBK 字节）解出原文。如果 ZXing 自动识别不了，就在 `reader-options.ts` 里记下结论和处理方式，并把测试改成断言实际行为；
  - Code 128 由测试里的最小编码器生成（只用 Code B），能解出 `20260929001`；
  - `READER_OPTIONS.formats` 不含 `ITF`。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**

```ts
export const READER_OPTIONS = {
  formats: ['QRCode', 'DataMatrix', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA'],
  textMode: 'Plain',
  maxNumberOfSymbols: 1,
  tryHarder: true,
} as const satisfies ReaderOptions;
```

  - worker 里先用 `prepareZXingModule({ overrides: { locateFile } })` 把 `.wasm` 指向本站：路径由构建脚本经 `define` 注入 `READER_WASM_URL`。
  - 收到 `{ id, image: ImageData }` 后回复 `{ id, text | null }`。
  - `decoder.ts` 保证同一时间只有一帧在解码，忙时直接丢弃新帧。

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(phone): barcode decoding with zxing-wasm in a worker`。

### Task 10: 摄像头、页面与构建

**Files:**
- Create: `relay/web/index.html`、`relay/web/styles.css`、`relay/web/src/camera.ts`、`relay/web/src/view.ts`、`relay/web/src/main.ts`、`scripts/relay/build.ts`
- Modify: `package.json`（脚本 `relay:build`、`relay:dev`）、`.gitignore`（`relay/dist/`）
- Test: `scripts/relay/build.test.ts`

- [ ] **Step 1: 写失败的测试。** `build.test.ts` 在临时目录里跑一次构建，断言：
  - 产出 `server.js`、`web/index.html`、`web/assets/` 下带哈希的 `app-*.js`、`decode-worker-*.js`、`reader-*.wasm`、`styles-*.css`；
  - `index.html` 引用的文件都存在；
  - `index.html` 里没有内联脚本；
  - 产物里不含 `jsdelivr`、`unpkg` 这类外部地址。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**
  - `camera.ts`：
    - `getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })`；
    - 按 `SCAN_FRAME_INTERVAL_MS = 160`（约每秒 6 帧）取帧：画到 canvas 后 `getImageData`，送给 decoder；
    - 手电筒：`getCapabilities().torch` 为真时才显示开关；
    - 屏幕常亮：申请 `navigator.wakeLock`，`visibilitychange` 时停掉或恢复摄像头和常亮；
    - 拍照识别：`createImageBitmap` → canvas → decoder。
  - `view.ts`：
    - 按状态切换区块，文字一律用 `textContent`；
    - 按钮的点击区域不小于 44×44 像素；
    - 适配刘海屏（`env(safe-area-inset-*)`）；
    - 颜色和间距用 CSS 变量；深色模式跟随系统。
  - `main.ts`：读 `location.hash` → 创建 `phone-session`、`camera`、`decoder` → 事件送进 reducer → 渲染。成功结果 1.5 秒后自动发出 `continue`。
  - `build.ts`：
    1. 用 `Bun.build` 分别构建 worker、主脚本（`naming: '[name]-[hash].[ext]'`，`minify`，`target: 'browser'`，通过 `define` 注入 `READER_WASM_URL`、`DECODE_WORKER_URL`）和 `server.js`（`target: 'bun'`，注入 `RELAY_VERSION`）；
    2. 复制 wasm 和 CSS，文件名按内容哈希；
    3. 改写 `index.html` 里的引用。
  - `relay:dev`：构建后在本机 3180 端口启动，`PUBLIC_ORIGIN=http://localhost:3180`。

- [ ] **Step 4: 运行测试，确认通过**；再运行 `bun run relay:dev`，用电脑的 Edge 打开 `http://localhost:3180/m/`，确认显示「在电脑上点「手机扫码」…」。
- [ ] **Step 5: 提交**：`feat(phone): camera page and relay build`。

### Task 10a: 摄像头对焦与变焦

**Files:**
- Create: `relay/web/src/camera-features.ts`
- Modify: `relay/web/src/camera.ts`、`relay/web/src/main.ts`、`relay/web/src/view.ts`、`relay/web/index.html`、`relay/web/styles.css`
- Test: `relay/web/src/camera-features.test.ts`

- [ ] **Step 1: 写失败的测试：**
  - `startupConstraints(capabilities)`：
    - 支持 `continuous` 对焦时包含 `focusMode: 'continuous'`；
    - 支持变焦且上限不小于 1.5 时包含 `zoom: 1.5`，并按 `step` 对齐、不超出 `min` / `max`；上限小于 1.5 时用上限；
    - 什么都不支持（iPhone）时返回空数组。
  - `focusAtConstraints(capabilities, point)`：
    - 支持对焦点和持续对焦时，保持持续对焦并设对焦点；
    - 只支持单次对焦时，用单次对焦；
    - 不支持对焦点时返回 null。
  - `tapToVideoPoint(tap, element, video)`：
    - 元素和视频比例相同时，就是简单的比例换算；
    - 视频比元素宽（`object-fit: cover` 裁掉左右）时，横坐标按可见部分换算；
    - 视频比元素高（裁掉上下）时，纵坐标同理；
    - 结果限制在 0–1。
- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现。**
  - `camera.ts` 打开摄像头后读取 `getCapabilities()`，依次应用 `startupConstraints` 的每一项。一项失败不影响其他项，只记日志。
  - 取景画面上的点按调用 `focusAt`，并在点按处显示对焦圈（CSS 动画，减少动态效果时不动）。
  - 手电筒的能力判断也移到 `camera-features.ts`。
- [ ] **Step 4: 运行，确认通过；`bun run relay:dev` 后用安卓 Chrome 真机确认持续对焦、点按对焦生效（记入验收）。**
- [ ] **Step 5: 提交**：`feat(phone): continuous focus, tap to focus and a moderate zoom`。

---

## 阶段 3：电脑端模块（先不接线）

### Task 11: 中转地址、会话状态、精简结果

> 这里写的是最初「一部手机认领」的版本。多部手机、`denied`、暂停加入、`queue`、字段上限 10 × 200 字符和 `MobileStatus` 的现行定义见设计 4.3–4.4、7.3 和代码。

**Files:**
- Create: `src/main/mobile/relay-endpoint.ts`、`src/main/mobile/mobile-session.ts`、`src/main/mobile/mobile-replies.ts`、`src/shared/mobile-status.ts`
- Test: 同名 `*.test.ts`

- [ ] **Step 1: 写失败的测试：**
  - `resolveRelayBase({ setting, buildDefault })`：
    - 设置不为 null 时用设置，否则用构建时的默认值；都没有时返回 null；
    - 自动补结尾的 `/`；
    - `sanitizeRelayUrl(value)`：只接受 https 地址，http 只接受 `localhost` / `127.0.0.1`；不合法时返回 null（设置的清洗函数在阶段 5 调用它）。
  - `desktopSocketUrl(base)`：`https` → `wss://…/ws/desktop`，`http` → `ws://…`。
  - `MobileSession`（假时钟）：
    - 第一部手机 `hello(null)` 得到 `welcome`，令牌为 22 位，`status().phone.device` 为它的描述；
    - 同一部手机带正确令牌再 `hello`，得到新的 `nonce`，令牌不变；
    - 第二部手机 → `taken` + 需要踢出；
    - 认领前的 `submit` 被忽略；
    - `nonce` 不对或 `seq` 不严格递增时被忽略；
    - 新任务号 → 回复 `accepted` 并交给执行；同一个任务号再来：还没结果时再回 `accepted`，已有结果时回同一个 `result`，都不再执行；
    - 等结果的任务达到 10 个时，新任务回复 `refused: too-many-pending`；一分钟内第 61 个新任务回复 `refused: rate-limited`；被拒绝的任务号以后还能重新提交；
    - 任务结果最多保留 1000 个，最早的先删；
    - `expiry()`：未认领满 10 分钟返回 `idle`；认领后 30 分钟没有任务返回 `idle`；有任务就顺延。
  - `toPhonePrintResult(result)`：
    - `printed` 换成规则名加字段摘要：最多 30 个字段，每个值最多 300 字符；
    - `failed` 的 `detail` / `issue` 缺失时为 null；
    - `duplicate`、`invalid` 原样带上需要的字段。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现。** 常量：`UNCLAIMED_TTL_MS = 10 * 60_000`、`IDLE_END_MS = 30 * 60_000`、`MAX_JOBS_PER_MINUTE = 60`、`JOB_MEMORY = 1_000`、`PHONE_FIELD_LIMIT = 30`、`PHONE_VALUE_LIMIT = 300`，各带一句取值依据；`MAX_PENDING_JOBS` 用协议里的。`MobileStatus`：

```ts
export type MobileStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | {
      state: 'active';
      url: string;
      /** 未认领时二维码的失效时间；已认领时为 null。 */
      expiresAt: number | null;
      relayOnline: boolean;
      phone: { device: string; online: boolean } | null;
      printed: number;
    }
  | { state: 'failed'; error: 'not-configured' | 'unreachable' | 'version' | 'server-busy' | 'session-taken' };
```

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(mobile): desktop session state with idempotent jobs`。

### Task 12: 电脑端编排 + 经真实中转服务的集成测试

> 现行接口：`print(raw, force, printerName)`、`selectedPrinter(): Promise<PrinterInfo | null>`（系统名和显示名），另有 `removePhone(id)`、`setJoinLocked(locked)`。集成测试还覆盖多部手机排队、移除后暂停加入、中转服务重启后手机列表对得上。

**Files:**
- Create: `src/main/mobile/mobile-host.ts`
- Test: `src/main/mobile/mobile-host.test.ts`（真实 `startRelay` + 全局 `WebSocket` + 脚本手机）

- [ ] **Step 1: 写失败的测试：**
  - `start()` 连上中转服务后，状态为 `active`，`url` 能被 `parsePhoneFragment` 解析。
  - 真实的 `PhoneSession`（手机端代码本身）join + hello → 状态里有手机。
  - `submit` → 注入的 `print(raw, force)` 被调用，手机先后收到 `accepted` 和 `result`，`printed` 计数加 1。
  - 连续提交三张 → 注入的 `print` 按提交顺序依次执行（上一张完成才开始下一张）。
  - 同一个任务号重发（模拟网络重传）→ `print` 只被调用一次，手机拿到同一个结果。
  - 没选打印机（注入的 `printerName()` 返回 null）→ 结果是 `no-printer`，`print` 不被调用。
  - 打印机变了（调用 `printerChanged()`）→ 手机收到 `printer`。
  - 第二部手机被拒绝，并被中转服务断开。
  - 中转服务重启（`stop()` 后在同一端口 `startRelay`）：电脑自动重新 `open`，手机重连后仍被接纳；重启期间提交的任务在重连后执行一次。
  - `stop('stopped')`：手机收到 `ended: stopped`，状态为 `off`。
  - 中转服务不可达：状态变为 `failed: unreachable`，并继续按退避重试。

- [ ] **Step 2: 运行，确认失败。**
- [ ] **Step 3: 实现：**

```ts
export interface MobileHostDeps {
  relayBase: URL;
  clock: Clock;
  timers: SocketTimers;
  createSocket: (url: string) => SocketLike;
  /** 执行一个打印任务：PrintService.submit 加结果换算（阶段 5 由 mobile-station 提供）。 */
  print: (raw: string, force: boolean) => Promise<PhonePrintResult>;
  printerName: () => string | null;
  log: (line: string) => void;
}
export class MobileHost {
  constructor(deps: MobileHostDeps);
  start(): MobileStatus;   // 已在进行中时返回当前状态
  stop(reason: CloseReason): void;
  status(): MobileStatus;
  onStatus(listener: (status: MobileStatus) => void): () => void;
  /** 设置里的打印机变了：推给已连接的手机。 */
  printerChanged(): void;
  /** 每 5 秒调用：检查 10 / 30 分钟到期。 */
  tick(): void;
}
```

  - 加密和解密各串成一条链：按收到的顺序处理，按顺序发出。
  - 任务按收到的顺序串行执行，执行中抛出的异常记日志并回复 `failed: PRINT_ERROR`，不让任务卡住。

- [ ] **Step 4: 运行，确认通过。**
- [ ] **Step 5: 提交**：`feat(mobile): desktop mobile host over the relay`。

---

## 阶段 4：部署与浏览器验证

### Task 13: 浏览器测试（假摄像头）

**Files:**
- Create: `relay/test/fake-camera.ts`（二维码 → Y4M 视频）、`relay/test/phone-page.browser.ts`（`bun test` 直接驱动 Playwright，不需要单独的 Playwright 配置）
- Modify: `package.json`（脚本 `test:relay-browser`）

- [ ] **Step 1: 写测试：**
  - 生成 640×480、30 帧的 Y4M：白底，中间是 `CL5640-TK-图片色-XL` 的二维码。Y 平面按像素灰度，U、V 平面填 128。
  - 用 `channel: 'msedge'` 启动，参数为 `--use-fake-ui-for-media-stream`、`--use-fake-device-for-media-stream`、`--use-file-for-fake-video-capture=<y4m>`。
  - 本机启动中转服务（`PUBLIC_ORIGIN=http://localhost:<端口>`），用 `MobileHost` 当电脑端（中转地址填本机，注入假的打印），打开它给出的 `url`。
  - 点「开始扫码」后，断言：假摄像头画面里的码被自动扫到，任务列表里出现「已发送打印」和字段摘要，朗读区读出同一句；注入的 `print` 只被调用一次（画面一直是同一张，防抖生效）。
- [ ] **Step 2: 运行 `bun run test:relay-browser`，确认通过。**
- [ ] **Step 3: 提交**：`test(phone): camera scan through a fake video device`。

### Task 14: Docker、nginx 与发布脚本

**Files:**
- Create: `relay/Dockerfile`、`relay/deploy/nginx-location.conf`、`scripts/relay/deploy.ts`、`relay/README.md`、`relay/CLAUDE.md`
- Modify: `package.json`（脚本 `relay:deploy`）、根目录 `CLAUDE.md`（架构、命令、文档表加上 `relay/`）
- Test: `scripts/relay/deploy.test.ts`（只测纯函数：`docker run` 参数、容器名、健康检查判定）

- [ ] **Step 1: 写失败的测试。** `dockerRunArgs(version)` 包含以下参数：
  - `--name labelflash-relay`
  - `--restart unless-stopped`
  - `-p 127.0.0.1:3180:3180`
  - `--memory 128m`
  - `--read-only`
  - `--user bun`
  - `--log-opt max-size=5m`
  - `--log-opt max-file=2`
  - `-e PUBLIC_ORIGIN=<参数传入>`
  - 镜像为 `labelflash-relay:<version>`。
  - `readDeployTarget(env)`：`RELAY_DEPLOY_SSH`、`RELAY_PUBLIC_ORIGIN`、`RELAY_HEALTH_URL` 缺一个就抛出带变量名的错误。
- [ ] **Step 2: 实现：**
  - `Dockerfile`：`FROM oven/bun:1.4.2-alpine`，`COPY dist/ /app/`，`USER bun`，`EXPOSE 3180`，`CMD ["bun", "/app/server.js"]`。
  - `deploy.ts` 依次做这几件事：
    1. `relay:build`；
    2. 把 `relay/dist` 和 `Dockerfile` 打成 tar，经 `ssh $RELAY_DEPLOY_SSH` 解到 `~/labelflash-relay/<version>/`；
    3. `docker build`；
    4. 停掉并删除旧容器，用新镜像 `docker run`；
    5. 轮询服务器本机的 `curl -fsS http://127.0.0.1:3180/healthz`，再请求对外的 `$RELAY_HEALTH_URL`，版本号都对上才算成功；失败时用上一个镜像恢复；
    6. 只保留最近 2 个版本的镜像和目录。
- [ ] **Step 3: 反向代理（官方中转服务只做一次，线上操作，具体步骤不写进仓库）：**
  1. 备份站点配置；
  2. 在 https 站点的 `location /` 之前加入 `relay/deploy/nginx-location.conf` 的内容（把占位域名换成实际域名）；
  3. `nginx -t` 通过后再 reload；
  4. 请求 `<中转地址>healthz` 验证。
  - 示例片段直接写 `Connection "upgrade"`，不依赖站点里是否定义了 `map $http_upgrade`。
- [ ] **Step 4: 发布官方中转服务。** 设置好三个环境变量后运行 `bun run relay:deploy`，确认：
  - `<中转地址>m/` 能打开，响应头符合设计 4.6；
  - 用 `demo-desktop.ts` 当电脑端连上去走通一次。
- [ ] **Step 5: 提交**：`feat(relay): docker image, nginx location and deploy script`。

### Task 15: 真手机试用（需求方）

- [ ] 在本机运行 `bun scripts/relay/demo-desktop.ts <中转地址>`：一个用 `MobileHost` 的命令行电脑端，在终端里显示二维码，把收到的打印任务打出来，不真的打印。
- [ ] 请需求方用 iPhone Safari、iPhone 微信、安卓 Chrome、安卓微信各扫一次，记录：
  - 能否实时取景、识别速度、对焦；
  - 中文（UTF-8 和 GBK）是否正确；
  - 拍照降级是否可用；
  - 两部手机同时扫，是否排队、各自看到自己的结果；第 6 部手机是否被拒绝；
  - 刷新页面、切到后台再回来，没出结果的任务是否接着发。
- [ ] 结果写进 `docs/windows-acceptance.md` 的「手机扫码」一节，每项注明「通过」「部分」或「待验收」。
- [ ] 提交：`docs: phone scan acceptance on real devices`。

---

## 阶段 5：接入电脑（基于配置中心的分支）

在 `feature/mobile-desktop` 上做：它从 `feature/config-center` 拉出，合入 `feature/phase1-desktop-client` 上的手机扫码提交。做完合回，随 1.0.1 发布。每个任务一个提交，都通过 `bun run check`；改了界面或主进程的再跑 `bun run test:e2e`。

### Task 16: 用词和时长共用一份

- 界面的 `lib/feedback-cues.ts` 改用 `src/shared/print-cues.ts` 的 `printResultCue` 和 `PrintMode`，删掉重复的对应关系；
- `lib/status-text.ts` 的 `formatWindow` 改用 `src/shared/duration-text.ts`；
- 测试：现有的 `voice.test.ts`、`status-text.test.ts` 不改断言，照样通过。

### Task 17: 中转地址设置与构建默认值

- `sanitizeRelayUrl` 移到 `src/shared/relay-url.ts`（设置和主进程共用），`relay-endpoint.ts` 引用它；
- 设置项 `mobileRelayUrl: string | null`，默认 null，按 `sanitizeRelayUrl` 清洗；
- `electron.vite.config.ts` 给主进程 `define` 构建默认值 `CDL_LABELFLASH_DEFAULT_RELAY_URL`（环境变量没设时为空）；`AppInfo` 加 `defaultRelayUrl`，界面据此显示「恢复默认」；
- 测试：设置清洗（合法、非法、去掉查询串、补结尾 `/`）。

### Task 18: 主进程接线（mobile-station）

- `src/main/mobile/mobile-station.ts`（不 import electron，依赖注入，`bun test`）：
  - `start()`：地址（设置优先、构建默认值兜底）没有时返回 `failed: not-configured`；否则按当前地址创建 `MobileHost` 并开始；
  - 打印：`PrintService.submit({ raw, printerName, source: 'mobile', force })` → `toPhonePrintResult`；
  - 当前打印机：设置里的 `selectedPrinter` 在打印机列表里的显示名，不在列表里时显示名就是系统名；
  - 设置变化：打印机变了 → `printerChanged()`；中转地址变了 → 结束当前会话（下次开始连新地址）；
  - 每 5 秒 `tick()`；退出时 `stop('quit')`；状态变化推给界面。
- `index.ts` 创建它并接到设置变化和退出流程。
- 测试：没有地址、地址切换、打印机显示名、打印结果换算、退出时结束。

### Task 19: IPC

- `mobile:start` / `mobile:stop` / `mobile:status` / `mobile:remove-phone` / `mobile:set-join-locked`，推送 `mobile:status-changed`；都加在 `ipc-contract.ts`、`ipc.ts`、preload 的末尾；
- `ipc-validators.ts` 加 `requireMobilePhoneId`（16 字节随机数格式）和 `requireBoolean`，补测试；
- 二维码在界面里用现有的 `useQrImage` 本机生成（和「关于」页的店铺二维码同一个做法），主进程不生成图片。

### Task 20: 界面

- `lib/mobile-text.ts`（纯函数，测试）：状态 → 按钮的状态点、浮层的标题和说明、有效期倒计时的文字、手机列表的文字、去配置的链接；
- `lib/scan-focus.ts`：浮层标记 `data-keep-focus`，焦点在里面时不自动拉回扫码框（扫码枪的字符照样进扫码框）；`returnFocusToScanBox()` 让关闭浮层后焦点立即回到扫码框；补测试；
- `view-models/use-mobile-station.ts`：在 App 里创建，跟随主进程推送；手机打印有结果时刷新打印记录；
- 组件：标题栏「配置」和打印机之间的「手机扫码」按钮（状态点）；非模态浮层 `MobileOverlay`（不用 `showModal`，Esc 关闭）；配置中心「集成」分组的「手机扫码」页 `MobilePage`（中转地址失焦或回车保存、恢复默认、当前状态）；
- 1024×680 和 1280×800 各截图核对。

### Task 21: E2E

- 构建中转服务，子进程启动 `relay/dist/server.js`（本机端口），设置里填本机地址；
- 用手机端的 `PhoneSession`（Node 自带 WebSocket 和 WebCrypto）加入、提交；打印用 `stubPrinting`；
- 断言：浮层显示二维码和手机；打印记录出现来源「手机」的一条；Esc 关闭浮层后焦点回到扫码框；配置中心「手机扫码」页能改地址和恢复默认。

### Task 22: CI 与文档

- CI：`dist:win` 和 `release:win` 从 Actions 变量 `LABELFLASH_DEFAULT_RELAY_URL` 注入默认地址；release 作业先确认标签所在的提交在 `master` 上，不在就失败（需求方已同意）；
- README：功能、中转地址（官方安装包默认用 yterm.cn 上的中转服务，可以换成自己部署的）、「电脑要能直接访问中转服务的 443 端口，不支持系统代理」、内容端到端加密；
- `src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`（顺带改掉配置中心会话指出的几处过时说法）、设计文档同步。

### Task 23: 验收

- Windows 150% 缩放和 macOS 各走一遍；真手机经官方中转服务在热敏标签机上出纸；安装包的默认地址能连上。结果写进 `docs/windows-acceptance.md`。版本号保持 1.0.1。

## 自查

- **设计覆盖**：
  - 第 2 节流程：Task 7、10、11、12；
  - 4.1–4.3：Task 1、2、11；4.4：Task 11、12；4.5：Task 5、6；4.6：Task 6；
  - 第 5 节协议：Task 1、4、5、8、12；
  - 第 6 节扫码页：Task 7–10、13；
  - 第 7 节电脑端：Task 11、12 和阶段 5；
  - 第 8 节部署：Task 14；
  - 第 11 节测试：各任务的测试，以及 Task 13、15；
  - 第 12 节分阶段：本计划的五个阶段。
- **类型一致**：`PhonePrintResult`、`RefusalReason`、`CloseReason`、`MobileStatus`、`SocketLike`、`SocketTimers` 只在 Task 1、4、11 定义，后续任务直接引用。
