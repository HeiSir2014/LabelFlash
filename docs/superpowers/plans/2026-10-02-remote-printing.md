# 异地远程打印（子项目 6b）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配置中心「共享」页生成「异地远程打印」的私有链接（可设有效期，随时撤销，每个共享单独勾选要共享出去的模板，新设备可设为先经电脑确认）。对方用任何设备的浏览器打开链接（中转服务上的「远程打印」页）：上传 PDF / JPEG / PNG，或选一个共享出来的模板填字段；选纸张、份数；看到上传进度、排队位置、打印进度和结果。几个人可以同时连，任务在这台电脑上按打印机排队。每张一条打印记录（来源「远程」，记下对方的名字或设备），文件打印的记录能预览、重打。

**Architecture:** 在手机扫码的那一套上扩展，不另起炉灶。一个远程共享就是中转服务上一个**长期的会话**（`open` 帧新增 `kind: 'share'`），电脑在程序开着、共享有效时为每个共享保持一条连接；对方的页面经新路径 `/ws/remote`（角色 `viewer`）加入，中转服务给每个连接分配随机连接号，电脑按连接号区分同时在线的几个人——多路复用的方式和手机完全一样。内层消息复用 msgpack 帧、AES-256-GCM（方向 `v2d` / `d2v`）、`nonce` + 严格递增的 `seq`、幂等的任务号、明确的 `refused` 背压；新增的只有远程打印的消息（`src/shared/remote-protocol.ts`）和分块传输（`src/shared/remote-chunks.ts`：每块 256KB、发送窗口 4 块、逐块确认、按顺序收、整份文件核对 SHA-256、断线后按已收块数续传）。中转服务边收边转，不攒文件：转发前看目标连接的发送缓冲（`getBufferedAmount`），超过单连接 / 全局上限就丢帧并回 `busy`，再加每个连接、每个共享、每个来源 IP 的按字节限速（`quota`）。协议版本升到 3，老客户端收到 `version` 错误提示更新。电脑上 `src/main/remote/`（都不 import electron）：`RemoteSession`（设备、令牌、确认、防重放、任务表、上传重组、背压）、`RemoteQueue`（每台打印机一条队，跨共享）、`RemoteHost`（每个共享一条连接的编排）、`RemoteStation`（共享的增删、到期、撤销、设备确认、状态推送、执行任务）。收到的文件交给和局域网共享（6a）共用的 `DocumentJobService`（`src/main/documents/`）：独立的 sandbox 渲染页把 PDF / 图片渲染成灰度，按 PDF 打印的切块、放到纸上、转黑白，存进 PDF 打印的位图缓存，逐张经 `PrintService.printFields`（来源 `remote`）照常决定打印机、排队、写记录。模板任务的字段先经 `prepareRemoteFields` 清洗。共享和设备存进新表（迁移 N），会话密钥用 `safeStorage` 加密保存，设备令牌只存 SHA-256。

**Tech Stack:** TypeScript、Bun test、Electron 主进程、Bun 中转服务（`Bun.serve` WebSocket）、WebCrypto、@msgpack/msgpack（已有）、React 19、浏览器原生 DOM（远程打印页）、Playwright（Edge 浏览器测试、Electron E2E）。不新增依赖。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 2、6、8.2、9、10、11 节；手机扫码的设计 `docs/superpowers/specs/2026-09-29-mobile-scan-relay-design.md`（第 4、5 节是这里扩展的基础）。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言（Biome 也禁止）。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`；改了扫码页、远程打印页或中转协议再跑 `bun run test:relay-browser`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **分支**：实施顺序 1 → 3 批量 → 2 模板库 → 4 PDF → 5a/5b/5c → 6a 局域网共享（IPP）→ 6b 本计划。6a 合进 master 之后，从 master 拉 `feature/remote-printing`。
- **本计划用到前面留下的**（Task 1 逐项核对）：
  - 批量打印：迁移 6 的来源 CHECK 含 `'remote'`；`fieldsScan(content, fields, rule)`、`FieldsRule`、`BATCH_RULE`。
  - PDF 打印：`PdfRef`、`FieldsPrint.pdf`、`fieldsRuleFor`、`PDF_RULE`；`core/pdf/` 的 `inkMask`、`cropRects`、`splitOptionsFor`、`paperDots`、`renderPiece`、`pieceTemplate`、`pieceContent`、`pieceFields`、`shortFileName`、`PDF_LIMITS`；`main/pdf/` 的 `PdfRenderHost`、`PdfRenderError`、`PDF_ISSUES`、`OpenedPdf`、`RenderedPage`、`PieceCache`、`PieceStore`、`PdfDocumentRenderer`、`openRenderWindow`；`shared/pdf-render-protocol.ts`。
  - 6a 局域网共享：配置中心的「共享」页（`ConfigPage` 里的 `'sharing'`）、文档打印通道（本计划的 `DocumentJobService`，见下面「和 6a 共用的通道」）、图片文件头读取（`readImagePixelSize`）是否已挪到 `src/shared/`、设备询问条是否已经通用化。
- **迁移编号**：实施时的下一个空号（写计划时预计 PDF 是 7、6a 可能用了 8，本计划写作「迁移 N」）。只在末尾追加，不改已有的。
- **视觉验收编号**：远程打印固定用 **V94–V97**，追加在 `ITEMS` 当时最后一项之后。
- **用词**：界面上「已发送」，不说「打印成功」；「远程」是打印记录的来源名；打印机只写「热敏标签机」；代码、测试、文档里不写任何域名（测试用 `relay.example.com`）。
- **中转服务的部署**：`bun run relay:deploy` 用户已预先同意（每次改了中转服务的代码都要重新部署），Task 23 做；打标签、删除东西仍要先问。

## 设计决定（实施时按这些做；改了要同步改设计文档 8.2 节）

| 问题 | 决定 | 为什么 |
|---|---|---|
| 链接怎么带密钥 | `<中转地址>r/#<会话号>.<内容密钥>`，都是 base64url；会话号 16 字节、密钥 32 字节，和手机扫码同一个格式（`parsePhoneFragment`） | `#` 后面的部分浏览器不发给服务器，不进反向代理日志和 Referer；页面另设 `Referrer-Policy: no-referrer` |
| 一个共享在中转服务上是什么 | 一个 `kind: 'share'` 的会话，电脑为每个共享开一条 `/ws/desktop` 连接；程序开着、共享没过期就一直连着 | 中转服务的「一个会话 = 一条电脑连接」不用改，所有权、接管、宽限期原样复用；共享最多 5 个（`REMOTE_SHARE_LIMITS.shares`），一家店的电脑连接数仍远低于每个 IP 20 条的上限 |
| 几个人同时连怎么区分 | 中转服务给每个页面连接分配 16 字节随机连接号（和手机一样），电脑按连接号发、收；每个共享同时最多 10 台设备（`REMOTE_MAX_VIEWERS`），中转服务按两倍放行（刷新页面时新旧连接重叠） | 多路复用已经由手机扫码验证过；电脑不需要新的帧类型 |
| 中转服务怎么分流 | 手机只能加入 `scan` 会话，远程打印页只能加入 `share` 会话；对不上一律回 `not-found` | 不让扫码页混进远程共享，也不透露这个会话号存在 |
| 设备身份 | 第一次 `hello` 时电脑发 16 字节令牌，页面存在 `localStorage`；电脑只存令牌的 SHA-256（`remote_devices` 表），按常数时间比较 | 和程序密钥同一个做法：数据库被拷走也拿不到能用的令牌 |
| 新设备 | 每个共享可设「新设备要我确认」（默认开）：页面显示「等电脑上确认」，电脑顶部出询问条（和网站询问条同一个样子）并发系统通知；允许后才发令牌。同时等确认的最多 3 个，10 分钟没人点就作废 | 链接可能被转发；确认一次之后这台设备不再打扰 |
| 移除设备 | 令牌作废、断开、它排队中的任务取消（正在打的那张打完）；同时自动打开这个共享的「新设备要我确认」 | 被移除的人手里还有链接，换个浏览器就是「新设备」；和手机扫码「移除后暂停加入」同一个道理 |
| 撤销 | 删掉共享（连同密钥、设备），告诉中转服务结束会话（`close: revoked`），在线的页面收到「已撤销」；排队中的任务取消，正在打的那张打完；同一个链接永远不能再用 | 撤销要立即、彻底；会话号和密钥都删了，就算有人用同一个会话号再 `open`，也解不开、伪造不了消息 |
| 到期 | 和撤销同一条路（`close: expired`），共享从列表里去掉，「共享」页提示一次「已到期」 | 只有一种「结束」，少一种状态 |
| 电脑不在线 | 中转服务不存状态，分不清「电脑没开」和「已撤销」：页面收到 `not-found` 显示「电脑现在不在线，或者链接已失效」，按退避重连；10 分钟还不行就停下，给「重试」 | 只说程序确知的事 |
| 共享哪些模板 | 每个共享单独勾选（默认一个都不共享，只能上传文件），最多 20 个；模板改名、改字段后页面上的目录随之更新；删掉或取消勾选后，用它的任务按「模板已不再共享」结束 | 「明确同意」落在共享这一级：同一台电脑给分店和给客户的可以不一样 |
| 字段 | 只收这个模板点名要的字段（「全部字段」模式的模板收任意合法字段名），值去掉控制字符和格式字符（只留换行），每个最多 200 字、最多 20 个；至少要有一个非空值 | 外部输入都不可信；条码、二维码不合码制的内容由画法本身拦下（不印并写日志） |
| 大文件 | `offer`（文件名、种类、字节数、SHA-256、纸张、裁切、份数）→ 电脑回 `upload {received}` → 页面按窗口发 `chunk`（每块 256KB，最多 4 块没确认）→ 电脑按顺序收、每块回 `ack {received}` → 收齐核对 SHA-256 → `accepted`。乱序、重复、大小不对的块不收，回当前 `received`，页面从那里重发；重连后重发 `offer`，按 `received` 续传；60 秒没新块电脑丢掉这份上传 | 回退 N 帧最简单可靠；窗口 4 块（1MB）在 500ms 往返时也能跑满 2MB/s，又把每份上传在路上的数据限制在 1MB |
| 中转服务的限速和配额 | 每个页面连接：每秒 10 帧（突发 20）、每秒 1MB（突发 2MB）；每个共享（会话）：每秒 256KB、突发 60MB（三份最大的文件）；每个来源 IP 的页面流量：每秒 2MB、突发 40MB；页面帧最大 `MAX_REMOTE_FRAME_BYTES`（约 324KB）。字节配额用完只丢帧、回 `quota`，不算违规；帧数超限照旧计违规，累计 50 次断开 | 热敏标签机一小时打不完 900MB 的 PDF；正常用的人碰不到配额，刷流量的人很快被挡住；官方中转服务是共用的 |
| 中转服务的内存 | 只转发、不攒文件：转发前看目标连接已缓冲的字节，单个连接超过 `MAX_PEER_BUFFER_BYTES`（两个最大帧）或全部加起来超过 32MB 就丢帧、回 `busy`；Bun 的 `backpressureLimit` 设成单连接上限加一帧 | 容器内存上限 128MB；页面的窗口和重发保证丢掉的块会再来 |
| 电脑端的内存 | 上传中和排队中的文件合计最多 100MB（`REMOTE_DOCUMENT_BUDGET_BYTES`），超出回 `refused: busy`；单份 20MB | 主进程里要拼成整份文件交给渲染页；100MB 够 5 份最大的文件同时在路上 |
| 打印排队 | 每台打印机一条队（跨所有共享、所有人，先来先打），一份文件的所有标签连续打完再轮到下一份；不同打印机的队互不等待；每人同时最多 5 个没出结果的任务，每个共享每分钟最多接 30 个 | 「任务在这台电脑上按打印机排队」；一份面单 PDF 不该被别人的单张插在中间 |
| 渲染 | 文件进 `DocumentJobService`：自己的一个 sandbox 渲染页（和「打印 PDF」页的那个互不影响），一次渲染一份；图片也在渲染页里解码（`open-image`），主进程先读文件头拒绝超过 5000 万像素的图 | Chromium 两条法则：不可信的文件不在主进程里解码 |
| 记录 | 来源 `remote`；`caller` = `remote:<共享名> · <对方填的名字或设备描述>`；规则名「远程打印」；文件打印的记录带 `PdfRef`（文件名、页码、第几张、位图），7 天内能预览、重打 | 和本机接口、PDF 打印同一套记录字段，打印记录页不用新写法 |
| 结果回给页面 | `accepted`（排队位置）→ `queue`（位置变了）→ `started {done, total}`（每打一张更新，最多每秒一次）→ `result`（已发送 N 张 / 打了 N 张后停下 / 打印机问题 / 没有打印机 / 文件不能打的原因）| 和手机扫码一样只发给提交它的那台设备 |
| 电脑重启过 | 页面对已被接受、还没结果的任务只发 `status`（不再带文件）；电脑不认识的任务回 `unknown`，页面写「电脑重启过，不知道这个任务打没打，请到电脑上的打印记录核对」 | 不重发已被接受的任务：重启前可能已经打了，重发就是重打 |
| 协议版本 | `MOBILE_PROTOCOL_VERSION` 2 → 3，手机扫码和远程打印共用；中转服务对 2 版的 `open` / `join` 回 `version` 并断开 | 用户 2026-10-01：不兼容旧版本，旧客户端明确提示更新 |
| 换中转地址 | 所有共享按新地址重连，链接里的会话号、密钥不变，只是地址换了：「共享」页提示「已发出的链接要重新发给对方」 | 链接里写死了中转地址 |

### 和 6a 共用的通道

局域网共享（IPP）和远程打印都是「收到一份文件 → 按纸张打出来」。6a 的计划（`docs/superpowers/plans/2026-10-02-ipp-sharing.md`）已经定下了其中几块，本计划直接用、不重做：

- 渲染页解图片：`RenderRequest` 的 `open-image`、`PdfRenderHost.openImage(data, type: RenderImageType)`、`RENDER_IMAGE_TYPES`（6a 的 Task「渲染页也解 JPEG / PNG」）；
- 通用询问条 `RequestBar.tsx`、配置中心的「共享」页 `SharingPage.tsx`；
- `fieldsRuleFor` 按 `ipp` 先认、`IPP_RULE`。

6a 的任务处理是它自己的 `IppJobProcessor`（带 IPP 专有的东西：PWG / Apple 光栅、「页面和纸差不多大就整页」的判断、按整份文档的份数顺序），没有抽出通用的通道。远程打印需要的那部分（认种类、挡大图、一次渲染一份、切块、存缓存、逐张 `printFields`、可取消、报进度）放在本计划新建的 `src/main/documents/` 里；它的接口按两边都能用来设计，**本计划不改 `IppJobProcessor`**——要不要让 IPP 也改走它，留给协调者决定（见 Self-Review）。Task 1 核对时如果发现 6a 实际做成了通用的通道，就用 6a 的，缺什么补什么，不再新建一份：

```ts
// src/main/documents/document-job-service.ts（接口摘要，完整代码见 Task 8）
export interface DocumentPrintRequest {
  /** 文件名（只用于打印记录）和原始字节；种类按文件头认，不信对方报的。 */
  document: { name: string; bytes: Uint8Array };
  paperKey: string;
  crop: DocumentCrop; // 'page' | 'trim' | 'split'
  copies: number;
  /** 这一份最多打几张（块数 × 份数）；超过就整份不打，说明原因。 */
  maxLabels: number;
  source: PrintSource; // 'remote' | 'ipp'
  caller: string;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}
export class DocumentJobService {
  print(request: DocumentPrintRequest): Promise<DocumentOutcome>;
}
```

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/shared/mobile-protocol.ts`、`mobile-crypto.ts` | 修改 | 协议 3：会话种类、`revoked` / `expired`、`busy` / `quota`、导出几个校验小函数；方向 `v2d` / `d2v` |
| `src/main/mobile/mobile-host.ts`、`relay/web/src/result-view.ts` | 修改 | 手机会话的 `open` 带 `kind: 'scan'`；新的结束原因和错误码 |
| `src/shared/remote-protocol.ts` | 新建 | 远程打印的常量、内层消息、校验、链接 |
| `src/shared/remote-chunks.ts` | 新建 | 分块、发送窗口（页面）、按顺序重组（电脑） |
| `src/shared/remote-status.ts` | 新建 | 推给界面的远程共享状态 |
| `relay/src/hub.ts`、`token-bucket.ts`、`server.ts`、`config.ts`、`static-files.ts` | 修改 | 角色 `viewer`、会话种类、限速和配额、发送缓冲上限、`/ws/remote`、`/r/` 页面 |
| `scripts/relay/build.ts` | 修改 | 另外构建远程打印页到 `dist/remote/` |
| `relay/web/remote/index.html`、`relay/web/remote/styles.css` | 新建 | 远程打印页 |
| `relay/web/src/remote/remote-client.ts` | 新建 | 页面这边的协议：加入、确认、上传（窗口、重发、续传）、填模板、查进度 |
| `relay/web/src/remote/remote-store.ts`、`file-check.ts`、`remote-state.ts`、`remote-text.ts`、`remote-view.ts`、`remote-controller.ts`、`main.ts` | 新建 | 令牌和任务的存储、文件检查、状态机、文字、页面、编排、入口 |
| `relay/test/remote-page.browser.ts` | 新建 | Edge 打开远程打印页：分块上传、模板、结果、手机宽度 |
| `src/core/remote/share-model.ts`、`src/core/remote/remote-fields.ts` | 新建 | 共享的限制和校验；模板字段的清洗 |
| `src/core/print-service.ts` | 修改 | `REMOTE_RULE`；`fieldsRuleFor` 按来源 |
| `src/shared/image-header.ts` | 新建（从 `renderer/src/lib/gray-image.ts` 挪来） | 不解码读图片宽高 |
| `src/shared/pdf-render-protocol.ts`、`src/main/pdf/pdf-render-host.ts`、`src/renderer/src/pdf-render/main.ts` | 修改 | 渲染页能打开图片（`open-image`） |
| `src/main/documents/document-kind.ts`、`document-job-service.ts` | 新建 | 认文件种类；收到的文件 → 一张张打出来（和 6a 共用） |
| `src/main/storage/migrations.ts`、`sqlite-remote-share-store.ts` | 修改 / 新建 | 迁移 N；共享和设备的存取（密钥加密） |
| `src/main/remote/remote-session.ts`、`remote-queue.ts`、`remote-host.ts`、`remote-station.ts` | 新建 | 电脑端：会话规则、打印队列、连接编排、接线 |
| `src/main/ipc.ts`、`ipc-validators.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/main/index.ts`、`src/main/background-update.ts` | 修改 | 新通道、接线、系统通知、有远程任务时不静默更新 |
| `src/renderer/src/lib/remote-share-text.ts`、`status-text.ts`、`local-api-text.ts`、`app-view.ts` | 新建 / 修改 | 共享页的文字；来源「远程」；记录里的对方；「共享」页 |
| `src/renderer/src/view-models/use-remote-shares.ts` | 新建 | 状态、创建、修改、撤销、复制链接、移除设备、确认 |
| `src/renderer/src/components/sharing/RemoteShares.tsx`、`RemoteShareForm.tsx`、`RemoteShareCard.tsx`、`src/renderer/src/components/RemoteRequests.tsx`、`components/config/pages/SharingPage.tsx`、`App.tsx`、`styles/app.css` | 新建 / 修改 | 「共享」页的远程共享、询问条 |
| `e2e/support/relay-server.ts`、`e2e/remote.e2e.ts` | 修改 / 新建 | 测试用的远程打印页客户端；E2E |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V94–V97 |
| 设计文档 8.2 节、手机扫码设计第 5 节、`relay/README.md`、`relay/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`、`CLAUDE.md`、`README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md` | 修改 | 文档 |

---

### Task 1: 核对前提，拉分支

**Files:** 无（只读）

- [ ] **Step 1: 拉分支**

Run（Git Bash）:

```bash
cd /d/project/LabelFlash && git switch master && git pull && git switch -c feature/remote-printing
```

- [ ] **Step 2: 用 Grep / Read 逐项核对**

1. `src/core/types.ts` 的 `PRINT_SOURCES` 含 `'remote'`；`src/main/storage/migrations.ts` 里 jobs 表最新的 `source` CHECK 含 `'remote'`；`src/renderer/src/lib/status-text.ts` 的 `SOURCE_LABELS` 有没有 `remote` 一项（没有的话 Task 17 补）。
2. `src/core/print-service.ts` 导出 `fieldsScan(content, fields, rule)`、`FieldsRule`、`fieldsRuleFor`、`PDF_RULE`，`FieldsPrint` 有 `pdf?: PdfRef`；`src/core/types.ts` 导出 `PdfRef`。
3. `src/core/pdf/` 有 `content-box.ts`（`inkMask`）、`page-split.ts`（`cropRects`、`splitOptionsFor`）、`piece-fit.ts`（`paperDots`、`renderPiece`）、`piece-template.ts`（`pieceTemplate`、`pieceContent`、`pieceFields`、`shortFileName`）、`pdf-model.ts`（`PDF_LIMITS`）。
4. `src/main/pdf/pdf-render-host.ts` 导出 `PdfRenderHost`、`PdfRenderError`、`PDF_ISSUES`、`OpenedPdf`、`RenderedPage`；`src/main/pdf/pdf-station.ts` 导出 `PdfDocumentRenderer`、`PieceStore`；`src/main/pdf/piece-cache.ts` 导出 `PieceCache`；`src/main/pdf/pdf-render-window.ts` 导出 `openRenderWindow`。
5. 6a 留下的：
   - `src/renderer/src/lib/app-view.ts` 的 `CONFIG_PAGES` 有没有 `'sharing'`，有的话 `SharingPage.tsx` 在哪、是怎么分节的（Task 18 在它下面加一节，没有就新建这一页）；
   - `src/main/documents/` 是否已存在（6a 的计划里没有它；如果 6a 实施时抽出了通用的通道，读它的接口，和上面「和 6a 共用的通道」逐项对；名字或参数不同时以 6a 的为准，把本计划 Task 8、15、16 里的调用改成它的写法，只补缺的能力，例如 `maxLabels`、`signal`）；
   - `RenderRequest` 里有没有 `open-image`、`PdfRenderHost` 有没有 `openImage(data, type)`、`pdf-render-protocol.ts` 有没有 `RENDER_IMAGE_TYPES`（6a 的计划里有：有的话跳过 Task 7 的 Step 3–7）；
   - `src/renderer/src/components/RequestBar.tsx` 的属性（6a 的通用询问条，Task 18 的 `RemoteRequests` 用它）；
   - `readImagePixelSize` 是否已经在 `src/shared/` 下（有的话跳过 Task 7 的 Step 1–2）；
   - `fieldsRuleFor` 的参数里有没有 `ipp`（Task 9 只加 `remote` 这一项）。
6. `src/shared/mobile-protocol.ts` 的 `MOBILE_PROTOCOL_VERSION` 还是 `2`；`relay/src/hub.ts` 的 `PeerRole` 还是 `'desktop' | 'phone'`。

Expected: 1–4 全在。第 1 条缺 `'remote'` 时**停下来**问协调者（不要再写一条重建 jobs 表的迁移）；第 2–4 条缺的说明 PDF 打印没按计划合进来，也停下来问。

- [ ] **Step 3: 基线**

Run: `bun run check && bun test relay src/shared src/main/mobile`
Expected: 全过。记下 `bun test` 的用例数，之后每个任务只增不减。

---

### Task 2: 协议 3：会话种类、新的结束原因和错误码

手机扫码和远程打印共用一个协议版本。这一步只改共用的部分：`open` 帧多一个 `kind`、结束原因多 `revoked` / `expired`、中转服务的错误多 `busy` / `quota`、加密的方向多 `v2d` / `d2v`；中转服务按 `kind` 分流在 Task 5。

**Files:**
- Modify: `src/shared/mobile-protocol.ts`、`src/shared/mobile-protocol.test.ts`
- Modify: `src/shared/mobile-crypto.ts`、`src/shared/mobile-crypto.test.ts`
- Modify: `src/main/mobile/mobile-host.ts`
- Modify: `relay/web/src/result-view.ts`
- Modify: `relay/src/hub.test.ts`、`relay/src/server.test.ts`（测试里的 `open` 帧带上 `kind`）

- [ ] **Step 1: 写测试**

`src/shared/mobile-protocol.test.ts` 末尾加（import 里加 `MOBILE_PROTOCOL_VERSION`、`parseRelayToDesktop`、`SESSION_KINDS`，已有的就不重复加）：

```ts
describe('protocol 3', () => {
  test('is version 3: phones and remote viewers speak the same version', () => {
    expect(MOBILE_PROTOCOL_VERSION).toBe(3);
  });

  test('an open frame says whether the session is a phone scan or a remote share', () => {
    const open = { t: 'open', v: 3, session: randomId(), secret: randomId(), kind: 'share' };
    expect(parseDesktopFrame(open)).toEqual(open);
    expect(parseDesktopFrame({ ...open, kind: 'scan' })).toEqual({ ...open, kind: 'scan' });
    expect(parseDesktopFrame({ t: 'open', v: 3, session: open.session, secret: open.secret })).toBeNull();
    expect(parseDesktopFrame({ ...open, kind: 'other' })).toBeNull();
    expect(SESSION_KINDS).toEqual(['scan', 'share']);
  });

  test('a session can end because the share was revoked or ran out', () => {
    expect(parseDesktopFrame({ t: 'close', reason: 'revoked' })).toEqual({ t: 'close', reason: 'revoked' });
    expect(parseDesktopFrame({ t: 'close', reason: 'expired' })).toEqual({ t: 'close', reason: 'expired' });
    expect(parseRelayToPhone({ t: 'ended', reason: 'revoked' })).toEqual({ t: 'ended', reason: 'revoked' });
  });

  test('the relay can say it dropped a frame because the other side is busy or a quota ran out', () => {
    expect(parseRelayToPhone({ t: 'error', code: 'busy' })).toEqual({ t: 'error', code: 'busy' });
    expect(parseRelayToPhone({ t: 'error', code: 'quota' })).toEqual({ t: 'error', code: 'quota' });
    expect(parseRelayToDesktop({ t: 'error', code: 'busy' })).toEqual({ t: 'error', code: 'busy' });
  });
});
```

（`randomId` 从 `./mobile-crypto` 引入；文件里已有的话不重复。）

`src/shared/mobile-crypto.test.ts` 末尾加：

```ts
describe('remote viewer directions', () => {
  test('keeps what a viewer sends apart from what the desktop sends', async () => {
    const key = await importSessionKey(randomKey());
    const session = randomId();
    const sealed = await sealMessage(key, 'v2d', session, { type: 'hello' });
    expect(await openMessage(key, 'v2d', session, sealed)).toEqual({ type: 'hello' });
    expect(await openMessage(key, 'd2v', session, sealed)).toBeNull();
    expect(await openMessage(key, 'p2d', session, sealed)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/mobile-protocol.test.ts src/shared/mobile-crypto.test.ts`
Expected: FAIL（版本还是 2；`kind` 不认；`revoked`、`busy` 不认；`'v2d'` 不是 `Direction`）。

- [ ] **Step 3: 实现**

`src/shared/mobile-protocol.ts`：

1. 版本号和注释：

```ts
/**
 * 协议版本。2：两层都改成 msgpack 二进制帧、一次扫码带几帧标签图（2026-09-30）。
 * 3：会话分种类（手机扫码 / 远程共享），远程打印页经 /ws/remote 加入，文件分块传（2026-10，见 remote-protocol.ts）。
 * 不兼容旧版本：中转服务对旧版本回 version 错误就断开，老电脑和老页面提示更新。
 */
export const MOBILE_PROTOCOL_VERSION = 3;
```

2. `ENVELOPE_ALLOWANCE_BYTES` 前面加 `export`（远程协议算帧上限要用）。
3. `CLOSE_CODES` 之后加：

```ts
/**
 * 会话的种类：scan = 手机扫码（点「手机扫码」才有，用完就结束）；share = 远程共享（共享有效、程序开着就一直在）。
 * 中转服务按它分流：手机只能加入 scan，远程打印页只能加入 share。
 */
export const SESSION_KINDS = ['scan', 'share'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
```

4. 结束原因和错误码：

```ts
/** revoked = 电脑上撤销了远程共享；expired = 远程共享到期。 */
export const CLOSE_REASONS = ['stopped', 'idle', 'quit', 'revoked', 'expired'] as const;
```

```ts
/**
 * busy = 对方的连接还有太多没发出去的数据，这一帧丢了；quota = 这个会话或这个 IP 的流量用完了，这一帧丢了。
 * 两种都不断开：远程打印页按退避重发（见 remote-client.ts）。
 */
export const RELAY_ERROR_CODES = [
  'version',
  'session-taken',
  'bad-frame',
  'rate-limited',
  'server-busy',
  'busy',
  'quota',
] as const;
```

5. `DesktopFrame` 的 `open` 改为 `{ t: 'open'; v: number; session: string; secret: string; kind: SessionKind }`；`parseDesktopFrame` 的 `open` 分支改为：

```ts
    case 'open': {
      const { v, session, secret, kind } = frame;
      return isPositiveInteger(v) && isRandomId(session) && isRandomId(secret) && isOneOf(kind, SESSION_KINDS)
        ? { t: 'open', v, session, secret, kind }
        : null;
    }
```

6. 文件末尾的 `isRecord`、`isOneOf`、`isPositiveInteger`、`isNonNegativeInteger`、`isStringOrNull` 前面都加 `export`（远程协议的校验用同一套，不复制一份），各自的注释保留。

`src/shared/mobile-crypto.ts`：

```ts
/**
 * p2d = 手机发给电脑，d2p = 电脑发给手机；v2d = 远程打印页发给电脑，d2v = 电脑发给远程打印页。
 * 写进附加数据，一个方向的消息不能被反射回去，扫码页和远程打印页的消息也不能互相冒充。
 */
export type Direction = 'p2d' | 'd2p' | 'v2d' | 'd2v';
```

`src/main/mobile/mobile-host.ts`：

- `onOpen` 里改为 `run.socket.send({ t: 'open', v: MOBILE_PROTOCOL_VERSION, session: run.sessionId, secret: run.secret, kind: 'scan' });`
- `handleRelayError` 的 `switch` 里 `case 'rate-limited':` 前加 `case 'busy':`、`case 'quota':`（手机扫码不会遇到，遇到也只是丢了一帧，手机按任务号重发）。

`relay/web/src/result-view.ts` 的 `END_TEXTS` 加两项（扫码会话不会收到，类型要求写全）：

```ts
  revoked: `电脑上已撤销这个链接。${RESTART_HINT}`,
  expired: `这个链接已到期。${RESTART_HINT}`,
```

`relay/src/hub.test.ts` 的 `openDesktop` 和「refuses another protocol version」里的 `open` 帧加 `kind: 'scan'`；`relay/src/server.test.ts` 里所有 `t: 'open'` 的帧同样加 `kind: 'scan'`（Grep `t: 'open'` 逐个改）。

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared relay src/main/mobile`
Expected: PASS（`mobile-host.test.ts` 用真实中转服务和扫码页代码，两边都换成了 3 版）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/mobile-protocol.ts src/shared/mobile-protocol.test.ts src/shared/mobile-crypto.ts src/shared/mobile-crypto.test.ts src/main/mobile/mobile-host.ts relay/web/src/result-view.ts relay/src/hub.test.ts relay/src/server.test.ts
git commit -m "feat(relay)!: protocol 3 with session kinds for remote shares" -m "Remote printing reuses the phone relay, so both move to protocol 3 together: an open frame says whether the session is a phone scan or a long-lived remote share, sessions can end as revoked or expired, and the relay can report a dropped frame as busy or over quota. Viewer traffic is sealed with its own directions so it can never be reflected as phone traffic. Older clients get the version error and are told to update." -m "$TRAILER"
```

---

### Task 3: 远程打印的消息和校验

**Files:**
- Create: `src/shared/remote-protocol.ts`、`src/shared/remote-protocol.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/shared/remote-protocol.test.ts
import { describe, expect, test } from 'bun:test';
import { importSessionKey, randomId, randomKey, sealMessage } from './mobile-crypto';
import { MAX_FRAME_BYTES } from './mobile-protocol';
import {
  buildShareUrl,
  cleanFileName,
  MAX_REMOTE_CONTROL_BYTES,
  MAX_REMOTE_FRAME_BYTES,
  parseDesktopToViewer,
  parseShareFragment,
  parseViewerMessage,
  REMOTE_CHUNK_BYTES,
  REMOTE_MAX_CHUNKS,
  REMOTE_MAX_COPIES,
  REMOTE_MAX_DOCUMENT_BYTES,
  REMOTE_MAX_FIELD_VALUE_LENGTH,
  REMOTE_MAX_FIELDS,
  REMOTE_MAX_PAPERS,
  REMOTE_MAX_TEMPLATES,
  type RemoteCatalog,
} from './remote-protocol';
import { encodeWire } from './wire';

const SHA = new Uint8Array(32).fill(9);
const NONCE = randomId();
const JOB = randomId();
const DOCUMENT = { name: '面单.pdf', kind: 'pdf', bytes: 1_000, sha256: SHA } as const;
const OFFER = { type: 'offer', nonce: NONCE, seq: 1, job: JOB, document: DOCUMENT, paper: '100x150', crop: 'trim', copies: 1 };

describe('parseViewerMessage', () => {
  test('reads a hello and cleans the name the viewer typed', () => {
    expect(parseViewerMessage({ type: 'hello', token: null, device: '电脑 · Edge', name: ' 张三\u202e\n ' })).toEqual({
      type: 'hello',
      token: null,
      device: '电脑 · Edge',
      name: '张三',
    });
    expect(parseViewerMessage({ type: 'hello', token: 'short', device: 'x', name: '' })).toBeNull();
  });

  test('reads an offer of a document', () => {
    expect(parseViewerMessage(OFFER)).toEqual(OFFER);
  });

  test('refuses offers outside the limits', () => {
    const offer = (changes: object) => parseViewerMessage({ ...OFFER, ...changes });
    expect(offer({ document: { ...DOCUMENT, bytes: REMOTE_MAX_DOCUMENT_BYTES + 1 } })).toBeNull();
    expect(offer({ document: { ...DOCUMENT, bytes: 0 } })).toBeNull();
    expect(offer({ document: { ...DOCUMENT, kind: 'docx' } })).toBeNull();
    expect(offer({ document: { ...DOCUMENT, sha256: new Uint8Array(31) } })).toBeNull();
    expect(offer({ paper: '100 x 150' })).toBeNull();
    expect(offer({ crop: 'manual' })).toBeNull();
    expect(offer({ copies: 0 })).toBeNull();
    expect(offer({ copies: REMOTE_MAX_COPIES + 1 })).toBeNull();
    expect(offer({ seq: 0 })).toBeNull();
  });

  test('keeps only the last part of a file name and drops control characters', () => {
    expect(cleanFileName('C:\\Users\\a\\..\\面单\u0000.pdf')).toBe('面单.pdf');
    expect(cleanFileName('/tmp/x/y.png')).toBe('y.png');
    expect(cleanFileName('   ')).toBe('文件');
  });

  test('reads a chunk no bigger than one chunk and within the chunk count', () => {
    const chunk = { type: 'chunk', nonce: NONCE, seq: 2, job: JOB, index: 3, data: new Uint8Array(REMOTE_CHUNK_BYTES) };
    expect(parseViewerMessage(chunk)).toEqual(chunk);
    expect(parseViewerMessage({ ...chunk, data: new Uint8Array(REMOTE_CHUNK_BYTES + 1) })).toBeNull();
    expect(parseViewerMessage({ ...chunk, data: new Uint8Array(0) })).toBeNull();
    expect(parseViewerMessage({ ...chunk, index: REMOTE_MAX_CHUNKS })).toBeNull();
    expect(parseViewerMessage({ ...chunk, index: -1 })).toBeNull();
  });

  test('reads a filled template and refuses bad fields', () => {
    const fill = {
      type: 'fill',
      nonce: NONCE,
      seq: 3,
      job: JOB,
      template: 'custom:tag-1',
      fields: [{ name: '品名', value: '短袖\nT恤' }],
      copies: 2,
    };
    expect(parseViewerMessage(fill)).toEqual(fill);
    expect(parseViewerMessage({ ...fill, template: 'tag-1' })).toBeNull();
    expect(parseViewerMessage({ ...fill, fields: [{ name: '品{名}', value: 'x' }] })).toBeNull();
    expect(
      parseViewerMessage({ ...fill, fields: [{ name: '品名', value: 'x'.repeat(REMOTE_MAX_FIELD_VALUE_LENGTH + 1) }] }),
    ).toBeNull();
    expect(
      parseViewerMessage({
        ...fill,
        fields: [
          { name: '品名', value: 'a' },
          { name: '品名', value: 'b' },
        ],
      }),
    ).toBeNull();
    const many = Array.from({ length: REMOTE_MAX_FIELDS + 1 }, (_, index) => ({ name: `字段${index}`, value: 'x' }));
    expect(parseViewerMessage({ ...fill, fields: many })).toBeNull();
  });

  test('reads a status question about a few jobs', () => {
    expect(parseViewerMessage({ type: 'status', nonce: NONCE, seq: 4, jobs: [JOB] })).toEqual({
      type: 'status',
      nonce: NONCE,
      seq: 4,
      jobs: [JOB],
    });
    expect(parseViewerMessage({ type: 'status', nonce: NONCE, seq: 4, jobs: [] })).toBeNull();
  });
});

describe('parseDesktopToViewer', () => {
  test('reads progress and results', () => {
    const messages = [
      { type: 'pending' },
      { type: 'denied', reason: 'refused' },
      { type: 'upload', job: JOB, received: 0 },
      { type: 'ack', job: JOB, received: 2 },
      { type: 'accepted', job: JOB, ahead: 1 },
      { type: 'queue', jobs: [{ job: JOB, ahead: 0 }] },
      { type: 'started', job: JOB, done: 3, total: 8 },
      { type: 'result', job: JOB, result: { status: 'sent', labels: 8 } },
      { type: 'result', job: JOB, result: { status: 'partial', sent: 3, total: 8, reason: 'PRINTER_NOT_READY', issue: 'paperOut' } },
      { type: 'result', job: JOB, result: { status: 'invalid', detail: 'PDF 加了密码' } },
      { type: 'refused', job: JOB, reason: 'busy' },
      { type: 'unknown', jobs: [JOB] },
    ];
    for (const message of messages) {
      expect(parseDesktopToViewer(message)).toEqual(message);
    }
  });

  test('refuses a done count past the total', () => {
    expect(parseDesktopToViewer({ type: 'started', job: JOB, done: 9, total: 8 })).toBeNull();
  });
});

/** 字段最多、名字最长、每个字都要三个字节的目录：最坏情况下也要放得进一帧。 */
function worstCatalog(): RemoteCatalog {
  const wide = (count: number) => '囧'.repeat(count);
  return {
    // 纸宽上限 120mm（PAPER_LIMITS_MM）：80–111mm 的 32 种纸都合法。
    papers: Array.from({ length: REMOTE_MAX_PAPERS }, (_, index) => ({ key: `${80 + index}x150`, label: wide(40) })),
    templates: Array.from({ length: REMOTE_MAX_TEMPLATES }, (_, index) => ({
      id: `custom:${'t'.repeat(60)}${index}`,
      name: wide(40),
      paper: '100x150',
      fields: Array.from({ length: REMOTE_MAX_FIELDS }, (_, field) => `${wide(18)}${field}`),
    })),
  };
}

describe('sizes', () => {
  test('the largest welcome fits in the control allowance', () => {
    const welcome = {
      type: 'welcome',
      token: randomId(),
      nonce: randomId(),
      share: '囧'.repeat(20),
      expiresAt: Date.now(),
      catalog: worstCatalog(),
    };
    expect(parseDesktopToViewer(welcome)).toEqual(welcome);
    expect(encodeWire(welcome).length).toBeLessThanOrEqual(MAX_REMOTE_CONTROL_BYTES);
  });

  test('a full chunk sealed and put in an envelope fits in a remote frame', async () => {
    const key = await importSessionKey(randomKey());
    const session = randomId();
    const chunk = { type: 'chunk', nonce: NONCE, seq: Number.MAX_SAFE_INTEGER, job: JOB, index: 79, data: new Uint8Array(REMOTE_CHUNK_BYTES) };
    const body = await sealMessage(key, 'v2d', session, chunk);
    expect(encodeWire({ t: 'send', body }).length).toBeLessThanOrEqual(MAX_REMOTE_FRAME_BYTES);
    // 远程的帧比手机的标签图帧小：中转服务的 maxPayloadLength 仍按手机的上限。
    expect(MAX_REMOTE_FRAME_BYTES).toBeLessThan(MAX_FRAME_BYTES);
  });
});

describe('share link', () => {
  test('keeps the session and key after # so they never reach the server', () => {
    const session = randomId();
    const key = randomKey();
    const url = new URL(buildShareUrl('https://relay.example.com/labelflash/', session, key));
    expect(url.pathname).toBe('/labelflash/r/');
    expect(url.search).toBe('');
    expect(parseShareFragment(url.hash)).toEqual({ session, key });
    expect(parseShareFragment('#nope')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/remote-protocol.test.ts`
Expected: FAIL，`Cannot find module './remote-protocol'`。

- [ ] **Step 3: 实现**

```ts
// src/shared/remote-protocol.ts
/**
 * 异地远程打印的协议：电脑、中转服务、远程打印页三方共用。
 *
 * 外层信封和手机扫码共用（mobile-protocol.ts 的 PhoneFrame / RelayToPhone），页面走 /ws/remote；
 * 内层消息经 AES-GCM 加密（方向 v2d / d2v），只有远程打印页和电脑能解开。
 * 文件分块传：一帧最多一块（256KB），中转服务边收边转，不攒整个文件（见 remote-chunks.ts）。
 * 所有收到的消息都不可信：逐字段检查，只返回白名单里的字段，不合法返回 null。
 */
import { isValidFieldName } from '../core/scan/rule-model';
import { TEMPLATE_ID_PATTERN } from '../core/templates/template-model';
import { PRINT_FAILURE_REASONS, type PrintFailureReason } from '../core/types';
import {
  cleanDeviceLabel,
  clipText,
  ENVELOPE_ALLOWANCE_BYTES,
  isNonNegativeInteger,
  isOneOf,
  isPositiveInteger,
  isRandomId,
  isRecord,
  type PhoneField,
  parsePhoneFragment,
  type QueuePosition,
} from './mobile-protocol';
import { parsePaperKey } from './paper-sizes';
import { PRINTER_ISSUES, type PrinterIssue } from './printer-readiness';

/** 每块 256KB（总设计 8.2）：一帧远小于手机的标签图帧，中转服务转一块只占这么多内存。 */
export const REMOTE_CHUNK_BYTES = 256 * 1024;
/** 单个文件最多 20MB（总设计 8.2）：几百张面单的 PDF 也就几 MB；更大的多半是扫描件，拆开再打。 */
export const REMOTE_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** 一个文件最多几块。 */
export const REMOTE_MAX_CHUNKS = Math.ceil(REMOTE_MAX_DOCUMENT_BYTES / REMOTE_CHUNK_BYTES);
/**
 * 发送窗口：最多 4 块（1MB）发出去还没被确认。往返 500ms 时也能跑到 2MB/s（中转服务给每个页面每秒 1MB），
 * 又把每份上传在中转服务和电脑之间「在路上」的数据限制在 1MB。
 */
export const REMOTE_UPLOAD_WINDOW = 4;
/** 发出的块多久没被确认就从最后确认的地方重发：上行 100KB/s 时 4 块要 10 秒，留余量。 */
export const REMOTE_CHUNK_ACK_TIMEOUT_MS = 15_000;
/** 电脑上一份上传多久没有新块就丢掉（释放内存）；页面之后再 offer 会从头传。 */
export const REMOTE_UPLOAD_IDLE_MS = 60_000;
/** 每台设备同时没出结果的任务（上传中、排队中、打印中）最多 5 个：远程多是整份文件，排得太多没有意义。 */
export const REMOTE_MAX_PENDING_JOBS = 5;
/** 每个共享同时在线的设备最多 10 台：一家分店几个人够用。 */
export const REMOTE_MAX_VIEWERS = 10;
/** 份数 1–20：远程补打一般一两份，批量请用批量打印。 */
export const REMOTE_MAX_COPIES = 20;
/** 一个任务最多打 200 张（块数 × 份数）：200 页的 PDF 一页一张正好；更多拆成几次。 */
export const REMOTE_MAX_LABELS_PER_JOB = 200;
/** 模板任务的字段：最多 20 个，每个值最多 200 字（标签上的一行字远小于这个）。 */
export const REMOTE_MAX_FIELDS = 20;
export const REMOTE_MAX_FIELD_VALUE_LENGTH = 200;
/** 一个共享最多共享 20 个模板（共享页按这个限制勾选）。 */
export const REMOTE_MAX_TEMPLATES = 20;
/** 纸张选项最多 32 种：和设置里纸张分配的上限一样。 */
export const REMOTE_MAX_PAPERS = 32;
/** 文件名、模板名、纸张名在页面上最多显示这么多字。 */
export const REMOTE_MAX_FILE_NAME_LENGTH = 100;
export const REMOTE_MAX_TITLE_LENGTH = 40;
/** 对方在页面上填的名字（电脑上和打印记录里显示），共享的名字：最多 20 个字。 */
export const REMOTE_MAX_NAME_LENGTH = 20;
/** 结果里给对方看的说明最多 200 字。 */
export const REMOTE_MAX_DETAIL_LENGTH = 200;
/** SHA-256 是 32 字节。 */
export const SHA256_BYTES = 32;
/** 除一块文件以外，一条消息其余部分的上限：最大的是 welcome（目录），由测试保证放得下。 */
export const MAX_REMOTE_CONTROL_BYTES = 64 * 1024;
/** 页面发来的一帧最多这么大：中转服务按它拒收超大的帧（服务端的 maxPayloadLength 仍按手机的标签图帧）。 */
export const MAX_REMOTE_FRAME_BYTES = REMOTE_CHUNK_BYTES + MAX_REMOTE_CONTROL_BYTES + ENVELOPE_ALLOWANCE_BYTES;

export const REMOTE_DOCUMENT_KINDS = ['pdf', 'jpeg', 'png'] as const;
export type RemoteDocumentKind = (typeof REMOTE_DOCUMENT_KINDS)[number];
/** page = 整页缩放到纸上；trim = 去掉四周空白；split = 一页多张时按空白或分割线切开（和 PDF 打印一样）。 */
export const REMOTE_CROPS = ['page', 'trim', 'split'] as const;
export type RemoteCrop = (typeof REMOTE_CROPS)[number];
/** full = 在线的设备满了；removed = 这台设备被移除了；refused = 电脑上的人没有同意。 */
export const REMOTE_DENIALS = ['full', 'removed', 'refused'] as const;
export type RemoteDenial = (typeof REMOTE_DENIALS)[number];
/** 任务没被接受（也就没有执行），稍后用同一个任务号再来：busy = 电脑上同时收着的文件太多。 */
export const REMOTE_REFUSALS = ['rate-limited', 'too-many-pending', 'busy'] as const;
export type RemoteRefusal = (typeof REMOTE_REFUSALS)[number];

/** 要打的文件：名字（只用于显示和打印记录）、种类、字节数、整份的 SHA-256（电脑收齐后核对）。 */
export interface RemoteDocument {
  name: string;
  kind: RemoteDocumentKind;
  bytes: number;
  sha256: Uint8Array;
}

/** 能选的纸张：只有已经分配了打印机的纸。 */
export interface RemotePaper {
  key: string;
  label: string;
}

/** 共享出来的模板：名字、纸张和它要的字段（「全部字段」模式的模板 fields 为空，页面给一个自由填写的「名称：值」表）。 */
export interface RemoteTemplate {
  id: string;
  name: string;
  paper: string;
  fields: string[];
}

export interface RemoteCatalog {
  papers: RemotePaper[];
  templates: RemoteTemplate[];
}

/** 远程打印页 → 电脑。nonce、seq、job 的规则和手机扫码相同（见 mobile-protocol.ts 的 PhoneMessage）。 */
export type ViewerMessage =
  /** 加入或恢复；token 第一次为 null；name 是对方自己填的名字（可以为空）。 */
  | { type: 'hello'; token: string | null; device: string; name: string }
  /** 要上传一份文件：电脑回 upload（从第几块开始发）或 refused。同一个任务号再发一次就是问进度或续传。 */
  | {
      type: 'offer';
      nonce: string;
      seq: number;
      job: string;
      document: RemoteDocument;
      paper: string;
      crop: RemoteCrop;
      copies: number;
    }
  /** 文件的第 index 块（从 0 数）。 */
  | { type: 'chunk'; nonce: string; seq: number; job: string; index: number; data: Uint8Array }
  /** 按共享出来的模板打：字段和份数。 */
  | { type: 'fill'; nonce: string; seq: number; job: string; template: string; fields: PhoneField[]; copies: number }
  /** 问已被接受的任务现在怎样了（不带文件，不会重打）。 */
  | { type: 'status'; nonce: string; seq: number; jobs: string[] };

/** 一个任务的结果（只说电脑确知的事：驱动接了就是「已发送」）。 */
export type RemoteResult =
  | { status: 'sent'; labels: number }
  /** 打到一半停下：打印机出了问题（缺纸、离线……），后面的没打。 */
  | { status: 'partial'; sent: number; total: number; reason: PrintFailureReason; issue: PrinterIssue | null }
  | { status: 'failed'; reason: PrintFailureReason; issue: PrinterIssue | null }
  /** 这种纸在电脑上没有分配打印机。 */
  | { status: 'no-printer' }
  /** 文件或字段打不了，detail 是电脑给的中文原因（例如「PDF 加了密码」「模板已不再共享」）。 */
  | { status: 'invalid'; detail: string }
  /** 还没开始打就被取消：共享被撤销、设备被移除。 */
  | { status: 'canceled' };

/** 电脑 → 远程打印页。 */
export type DesktopToViewer =
  | { type: 'welcome'; token: string; nonce: string; share: string; expiresAt: number | null; catalog: RemoteCatalog }
  /** 在等电脑上的人确认这台新设备。 */
  | { type: 'pending' }
  | { type: 'denied'; reason: RemoteDenial }
  /** 共享的模板或纸张变了。 */
  | { type: 'catalog'; catalog: RemoteCatalog }
  /** 回复 offer：从第 received 块开始发（续传时不是 0）。 */
  | { type: 'upload'; job: string; received: number }
  /** 已按顺序收到 received 块。 */
  | { type: 'ack'; job: string; received: number }
  | { type: 'accepted'; job: string; ahead: number }
  | { type: 'queue'; jobs: QueuePosition[] }
  /** 开始打印，以及打印进度：打了 done 张，共 total 张。 */
  | { type: 'started'; job: string; done: number; total: number }
  | { type: 'result'; job: string; result: RemoteResult }
  | { type: 'refused'; job: string; reason: RemoteRefusal }
  /** status 里问到的、电脑不认识的任务（电脑重启过）。 */
  | { type: 'unknown'; jobs: string[] };

/** 不该出现在名字里的字符：控制字符、格式字符（含双向文字控制符）、行和段分隔符。 */
const UNSAFE_TEXT_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const PATH_SEPARATORS = /[\\/]/;
const FALLBACK_FILE_NAME = '文件';

/** 对方填的名字、共享名：去掉看不见的字符和首尾空白，最多 REMOTE_MAX_NAME_LENGTH 个字。 */
export function cleanRemoteName(text: string): string {
  return clipText(text.replace(UNSAFE_TEXT_CHARACTERS, '').trim(), REMOTE_MAX_NAME_LENGTH);
}

/** 文件名只留最后一段（不带路径）、去掉看不见的字符，最多 REMOTE_MAX_FILE_NAME_LENGTH 个字；什么都不剩时叫「文件」。 */
export function cleanFileName(text: string): string {
  const last = text.split(PATH_SEPARATORS).at(-1) ?? '';
  const cleaned = clipText(last.replace(UNSAFE_TEXT_CHARACTERS, '').trim(), REMOTE_MAX_FILE_NAME_LENGTH);
  return cleaned === '' ? FALLBACK_FILE_NAME : cleaned;
}

export function buildShareUrl(baseUrl: string, session: string, key: string): string {
  return `${new URL('r/', baseUrl).href}#${session}.${key}`;
}

/** 链接的 # 部分：格式和手机扫码的链接相同。 */
export function parseShareFragment(hash: string): { session: string; key: string } | null {
  return parsePhoneFragment(hash);
}

export function parseViewerMessage(value: unknown): ViewerMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['type']) {
    case 'hello': {
      const { token, device, name } = value;
      if ((token !== null && !isRandomId(token)) || typeof device !== 'string' || typeof name !== 'string') {
        return null;
      }
      return { type: 'hello', token, device: cleanDeviceLabel(device), name: cleanRemoteName(name) };
    }
    case 'offer': {
      const head = readJobHead(value);
      const document = readDocument(value['document']);
      const { paper, crop, copies } = value;
      if (
        head === null ||
        document === null ||
        typeof paper !== 'string' ||
        parsePaperKey(paper) === null ||
        !isOneOf(crop, REMOTE_CROPS) ||
        !isCopies(copies)
      ) {
        return null;
      }
      return { type: 'offer', ...head, document, paper, crop, copies };
    }
    case 'chunk': {
      const head = readJobHead(value);
      const { index, data } = value;
      if (
        head === null ||
        !isNonNegativeInteger(index) ||
        index >= REMOTE_MAX_CHUNKS ||
        !(data instanceof Uint8Array) ||
        data.length === 0 ||
        data.length > REMOTE_CHUNK_BYTES
      ) {
        return null;
      }
      return { type: 'chunk', ...head, index, data };
    }
    case 'fill': {
      const head = readJobHead(value);
      const { template, copies } = value;
      const fields = parseRemoteFields(value['fields']);
      if (
        head === null ||
        typeof template !== 'string' ||
        !TEMPLATE_ID_PATTERN.test(template) ||
        fields === null ||
        !isCopies(copies)
      ) {
        return null;
      }
      return { type: 'fill', ...head, template, fields, copies };
    }
    case 'status': {
      const { nonce, seq, jobs } = value;
      if (
        !isRandomId(nonce) ||
        !isPositiveInteger(seq) ||
        !Array.isArray(jobs) ||
        jobs.length === 0 ||
        jobs.length > REMOTE_MAX_PENDING_JOBS ||
        !jobs.every(isRandomId)
      ) {
        return null;
      }
      return { type: 'status', nonce, seq, jobs: [...jobs] };
    }
    default:
      return null;
  }
}

export function parseDesktopToViewer(value: unknown): DesktopToViewer | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['type']) {
    case 'welcome': {
      const { token, nonce, share, expiresAt } = value;
      const catalog = readCatalog(value['catalog']);
      if (
        !isRandomId(token) ||
        !isRandomId(nonce) ||
        typeof share !== 'string' ||
        (expiresAt !== null && !isNonNegativeInteger(expiresAt)) ||
        catalog === null
      ) {
        return null;
      }
      return { type: 'welcome', token, nonce, share: cleanRemoteName(share), expiresAt, catalog };
    }
    case 'pending':
      return { type: 'pending' };
    case 'denied':
      return isOneOf(value['reason'], REMOTE_DENIALS) ? { type: 'denied', reason: value['reason'] } : null;
    case 'catalog': {
      const catalog = readCatalog(value['catalog']);
      return catalog === null ? null : { type: 'catalog', catalog };
    }
    case 'upload':
    case 'ack': {
      const { job, received } = value;
      return isRandomId(job) && isNonNegativeInteger(received) && received <= REMOTE_MAX_CHUNKS
        ? { type: value['type'], job, received }
        : null;
    }
    case 'accepted': {
      const { job, ahead } = value;
      return isRandomId(job) && isNonNegativeInteger(ahead) ? { type: 'accepted', job, ahead } : null;
    }
    case 'queue': {
      const jobs = readPositions(value['jobs']);
      return jobs === null ? null : { type: 'queue', jobs };
    }
    case 'started': {
      const { job, done, total } = value;
      return isRandomId(job) && isNonNegativeInteger(done) && isPositiveInteger(total) && done <= total
        ? { type: 'started', job, done, total }
        : null;
    }
    case 'result': {
      const { job } = value;
      const result = readResult(value['result']);
      return isRandomId(job) && result !== null ? { type: 'result', job, result } : null;
    }
    case 'refused': {
      const { job, reason } = value;
      return isRandomId(job) && isOneOf(reason, REMOTE_REFUSALS) ? { type: 'refused', job, reason } : null;
    }
    case 'unknown': {
      const { jobs } = value;
      return Array.isArray(jobs) && jobs.length > 0 && jobs.length <= REMOTE_MAX_PENDING_JOBS && jobs.every(isRandomId)
        ? { type: 'unknown', jobs: [...jobs] }
        : null;
    }
    default:
      return null;
  }
}

/**
 * 模板任务的字段：名称按规则的字段名要求、不重复；值是字符串、最多 REMOTE_MAX_FIELD_VALUE_LENGTH 字（可以为空、可以换行）。
 * 能不能打、字段是不是这个模板的，由电脑上的 prepareRemoteFields 再判断。
 */
export function parseRemoteFields(value: unknown): PhoneField[] | null {
  if (!Array.isArray(value) || value.length > REMOTE_MAX_FIELDS) {
    return null;
  }
  const fields: PhoneField[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const { name } = item;
    const text = item['value'];
    if (
      typeof name !== 'string' ||
      !isValidFieldName(name) ||
      typeof text !== 'string' ||
      text.length > REMOTE_MAX_FIELD_VALUE_LENGTH ||
      fields.some((field) => field.name === name)
    ) {
      return null;
    }
    fields.push({ name, value: text });
  }
  return fields;
}

function readJobHead(value: Record<string, unknown>): { nonce: string; seq: number; job: string } | null {
  const { nonce, seq, job } = value;
  return isRandomId(nonce) && isPositiveInteger(seq) && isRandomId(job) ? { nonce, seq, job } : null;
}

function isCopies(value: unknown): value is number {
  return isPositiveInteger(value) && value <= REMOTE_MAX_COPIES;
}

function readDocument(value: unknown): RemoteDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  const { name, kind, bytes, sha256 } = value;
  if (
    typeof name !== 'string' ||
    !isOneOf(kind, REMOTE_DOCUMENT_KINDS) ||
    !isPositiveInteger(bytes) ||
    bytes > REMOTE_MAX_DOCUMENT_BYTES ||
    !(sha256 instanceof Uint8Array) ||
    sha256.length !== SHA256_BYTES
  ) {
    return null;
  }
  return { name: cleanFileName(name), kind, bytes, sha256 };
}

function readCatalog(value: unknown): RemoteCatalog | null {
  if (!isRecord(value)) {
    return null;
  }
  const { papers, templates } = value;
  if (
    !Array.isArray(papers) ||
    papers.length > REMOTE_MAX_PAPERS ||
    !Array.isArray(templates) ||
    templates.length > REMOTE_MAX_TEMPLATES
  ) {
    return null;
  }
  const readPapers: RemotePaper[] = [];
  for (const paper of papers) {
    if (!isRecord(paper) || typeof paper['key'] !== 'string' || parsePaperKey(paper['key']) === null) {
      return null;
    }
    const label = paper['label'];
    if (typeof label !== 'string') {
      return null;
    }
    readPapers.push({ key: paper['key'], label: clipText(label, REMOTE_MAX_TITLE_LENGTH) });
  }
  const readTemplates: RemoteTemplate[] = [];
  for (const template of templates) {
    const read = readTemplate(template);
    if (read === null) {
      return null;
    }
    readTemplates.push(read);
  }
  return { papers: readPapers, templates: readTemplates };
}

function readTemplate(value: unknown): RemoteTemplate | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name, paper, fields } = value;
  if (
    typeof id !== 'string' ||
    !TEMPLATE_ID_PATTERN.test(id) ||
    typeof name !== 'string' ||
    typeof paper !== 'string' ||
    parsePaperKey(paper) === null ||
    !Array.isArray(fields) ||
    fields.length > REMOTE_MAX_FIELDS ||
    !fields.every((field) => typeof field === 'string' && isValidFieldName(field))
  ) {
    return null;
  }
  return { id, name: clipText(name, REMOTE_MAX_TITLE_LENGTH), paper, fields: [...fields] };
}

function readPositions(value: unknown): QueuePosition[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > REMOTE_MAX_PENDING_JOBS) {
    return null;
  }
  const positions: QueuePosition[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRandomId(item['job']) || !isNonNegativeInteger(item['ahead'])) {
      return null;
    }
    positions.push({ job: item['job'], ahead: item['ahead'] });
  }
  return positions;
}

function readResult(value: unknown): RemoteResult | null {
  if (!isRecord(value)) {
    return null;
  }
  const issueOf = (issue: unknown): PrinterIssue | null | undefined =>
    issue === null ? null : isOneOf(issue, PRINTER_ISSUES) ? issue : undefined;
  switch (value['status']) {
    case 'sent':
      return isPositiveInteger(value['labels']) ? { status: 'sent', labels: value['labels'] } : null;
    case 'partial': {
      const { sent, total, reason } = value;
      const issue = issueOf(value['issue']);
      if (
        !isNonNegativeInteger(sent) ||
        !isPositiveInteger(total) ||
        sent >= total ||
        !isOneOf(reason, PRINT_FAILURE_REASONS) ||
        issue === undefined
      ) {
        return null;
      }
      return { status: 'partial', sent, total, reason, issue };
    }
    case 'failed': {
      const { reason } = value;
      const issue = issueOf(value['issue']);
      return isOneOf(reason, PRINT_FAILURE_REASONS) && issue !== undefined ? { status: 'failed', reason, issue } : null;
    }
    case 'no-printer':
      return { status: 'no-printer' };
    case 'invalid':
      return typeof value['detail'] === 'string'
        ? { status: 'invalid', detail: clipText(value['detail'], REMOTE_MAX_DETAIL_LENGTH) }
        : null;
    case 'canceled':
      return { status: 'canceled' };
    default:
      return null;
  }
}
```

注意：`welcome` 的测试里 `expiresAt` 用 `Date.now()`，是非负整数；`clipText` 按字符截断，所以 `worstCatalog` 的 40 字名字原样通过。

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/remote-protocol.test.ts`
Expected: PASS。如果「the largest welcome fits」失败，量出实际字节数，**不要放宽断言**：看是不是哪一项上限写大了（例如字段名按 `RULE_LIMITS.fieldNameLength` 是 20 个字）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/remote-protocol.ts src/shared/remote-protocol.test.ts
git commit -m "feat(remote): remote printing messages with strict parsing" -m "A viewer offers a document (name, kind, size, SHA-256, paper, crop, copies), sends it in 256KB chunks, fills a shared template or asks how accepted jobs are doing; the desktop answers with the catalog, upload offsets, acks, queue positions, print progress and results. Every field is checked against explicit limits, and tests prove the largest welcome and a full sealed chunk fit in one frame. The share link keeps the session and key after #, so they never reach the server." -m "$TRAILER"
```

---

### Task 4: 分块：发送窗口和按顺序重组

**Files:**
- Create: `src/shared/remote-chunks.ts`、`src/shared/remote-chunks.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/shared/remote-chunks.test.ts
import { describe, expect, test } from 'bun:test';
import { ChunkAssembler, chunkAt, chunkCount, chunkSize, UploadWindow } from './remote-chunks';
import { REMOTE_CHUNK_BYTES } from './remote-protocol';

/** 2.5 块的文件：最后一块只有半块。 */
const FILE = Uint8Array.from({ length: REMOTE_CHUNK_BYTES * 2.5 }, (_, index) => index % 251);

describe('chunking', () => {
  test('cuts a file into chunks with a short last one', () => {
    expect(chunkCount(FILE.length)).toBe(3);
    expect(chunkAt(FILE, 0)).toHaveLength(REMOTE_CHUNK_BYTES);
    expect(chunkAt(FILE, 2)).toHaveLength(REMOTE_CHUNK_BYTES / 2);
    expect(chunkSize(FILE.length, 2)).toBe(REMOTE_CHUNK_BYTES / 2);
    expect(chunkCount(1)).toBe(1);
  });
});

describe('ChunkAssembler', () => {
  test('puts the chunks back together in order', () => {
    const assembler = new ChunkAssembler(FILE.length);
    for (let index = 0; index < 3; index += 1) {
      expect(assembler.accept(index, chunkAt(FILE, index))).toBe(true);
    }
    expect(assembler.isComplete).toBe(true);
    expect(assembler.assemble()).toEqual(FILE);
  });

  test('takes only the next chunk: a gap, a repeat or a wrong size is dropped', () => {
    const assembler = new ChunkAssembler(FILE.length);
    expect(assembler.accept(1, chunkAt(FILE, 1))).toBe(false);
    expect(assembler.accept(0, chunkAt(FILE, 0))).toBe(true);
    expect(assembler.accept(0, chunkAt(FILE, 0))).toBe(false);
    expect(assembler.accept(1, chunkAt(FILE, 2))).toBe(false);
    expect(assembler.received).toBe(1);
    expect(assembler.isComplete).toBe(false);
  });

  test('copies each chunk so a reused buffer cannot change the file', () => {
    const assembler = new ChunkAssembler(3);
    const data = Uint8Array.of(1, 2, 3);
    assembler.accept(0, data);
    data.fill(0);
    expect(assembler.assemble()).toEqual(Uint8Array.of(1, 2, 3));
  });

  test('refuses to assemble before every chunk is in', () => {
    expect(() => new ChunkAssembler(FILE.length).assemble()).toThrow('Upload is not complete');
  });
});

describe('UploadWindow', () => {
  test('sends at most the window ahead of the last acknowledged chunk', () => {
    const window = new UploadWindow(6, 2);
    expect(window.takeSendable()).toEqual([0, 1]);
    expect(window.takeSendable()).toEqual([]);
    expect(window.acknowledge(1)).toBe(true);
    expect(window.takeSendable()).toEqual([2]);
    expect(window.acknowledge(3)).toBe(true);
    expect(window.takeSendable()).toEqual([3, 4]);
  });

  test('does not believe an acknowledgement of chunks it never sent, nor one that goes back', () => {
    const window = new UploadWindow(6, 2);
    window.takeSendable();
    expect(window.acknowledge(3)).toBe(false);
    expect(window.acknowledge(2)).toBe(true);
    expect(window.acknowledge(1)).toBe(false);
    expect(window.acknowledged).toBe(2);
  });

  test('a repeated acknowledgement means a gap: send again from there, once', () => {
    const window = new UploadWindow(6, 3);
    window.takeSendable();
    window.acknowledge(1);
    window.takeSendable();
    expect(window.repeated(1)).toBe(true);
    expect(window.takeSendable()).toEqual([1, 2, 3]);
    expect(window.repeated(1)).toBe(false);
  });

  test('resumes from where the desktop says it is, and is done when everything is acknowledged', () => {
    const window = new UploadWindow(3, 4);
    window.resume(2);
    expect(window.takeSendable()).toEqual([2]);
    expect(window.isDone).toBe(false);
    window.acknowledge(3);
    expect(window.isDone).toBe(true);
    expect(window.takeSendable()).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/remote-chunks.test.ts`
Expected: FAIL，`Cannot find module './remote-chunks'`。

- [ ] **Step 3: 实现**

```ts
// src/shared/remote-chunks.ts
/**
 * 远程打印的分块传输（纯逻辑，页面和电脑共用；计时器、发送都由调用方做）。
 *
 * 回退 N 帧：页面最多 window 块没被确认；电脑只按顺序收「下一块」，每收一块回告「收到几块了」；
 * 乱序、重复、大小不对的块不收，同样回告当前的数，页面从那里重发。中转服务丢帧、连接断开、电脑重启上传，
 * 都落到同一条路上：从电脑说的那一块接着发。
 */
import { REMOTE_CHUNK_BYTES, REMOTE_UPLOAD_WINDOW } from './remote-protocol';

/** 文件切成几块（最后一块可能不满一块）。 */
export function chunkCount(totalBytes: number): number {
  return Math.max(1, Math.ceil(totalBytes / REMOTE_CHUNK_BYTES));
}

/** 第 index 块应有的字节数。 */
export function chunkSize(totalBytes: number, index: number): number {
  return Math.max(0, Math.min(REMOTE_CHUNK_BYTES, totalBytes - index * REMOTE_CHUNK_BYTES));
}

/** 文件的第 index 块（不复制）。 */
export function chunkAt(file: Uint8Array, index: number): Uint8Array {
  const start = index * REMOTE_CHUNK_BYTES;
  return file.subarray(start, Math.min(file.length, start + REMOTE_CHUNK_BYTES));
}

/** 电脑这边：按顺序收块，收齐拼成整个文件。 */
export class ChunkAssembler {
  private readonly parts: Uint8Array[] = [];
  private receivedBytes = 0;

  constructor(readonly totalBytes: number) {}

  /** 已按顺序收到的块数（也是下一块的序号）。 */
  get received(): number {
    return this.parts.length;
  }

  get isComplete(): boolean {
    return this.receivedBytes === this.totalBytes;
  }

  /**
   * 收下一块：只有序号正好是下一块、大小正好是这一块该有的才收。
   * 复制一份：msgpack 解出来的字节是整条明文缓冲区里的一段，留着它会把整条消息一起留在内存里。
   */
  accept(index: number, data: Uint8Array): boolean {
    if (this.isComplete || index !== this.parts.length || data.length !== chunkSize(this.totalBytes, index)) {
      return false;
    }
    this.parts.push(data.slice());
    this.receivedBytes += data.length;
    return true;
  }

  /** 拼成整个文件；没收齐时抛错（调用方先看 isComplete）。 */
  assemble(): Uint8Array {
    if (!this.isComplete) {
      throw new Error(`Upload is not complete: ${this.receivedBytes} of ${this.totalBytes} bytes`);
    }
    const file = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const part of this.parts) {
      file.set(part, offset);
      offset += part.length;
    }
    return file;
  }
}

/** 页面这边：哪几块现在可以发、确认到了哪里、从哪里重发。 */
export class UploadWindow {
  /** 电脑确认按顺序收到的块数。 */
  private acked = 0;
  /** 下一块要发的序号。 */
  private next = 0;
  /** 已经因为「同一个确认又来了」重发过的位置：同一个缺口只重发一次（后面几块的确认都会是同一个数）。 */
  private rewoundAt = -1;

  constructor(
    readonly chunks: number,
    private readonly window: number = REMOTE_UPLOAD_WINDOW,
  ) {}

  get acknowledged(): number {
    return this.acked;
  }

  get isDone(): boolean {
    return this.acked >= this.chunks;
  }

  /** 现在可以发的块序号；取走就算发出去了。 */
  takeSendable(): number[] {
    const sendable: number[] = [];
    while (this.next < this.chunks && this.next < this.acked + this.window) {
      sendable.push(this.next);
      this.next += 1;
    }
    return sendable;
  }

  /** 电脑说收到了 received 块：只往前走；比发出去的还多说明对方不对，不信。返回窗口有没有往前走。 */
  acknowledge(received: number): boolean {
    if (received <= this.acked || received > this.next) {
      return false;
    }
    this.acked = received;
    return true;
  }

  /**
   * 电脑又说了一遍同一个数，而这之后已经发过块：中间丢了一块（中转服务丢帧），从那里重发。
   * 同一个位置只重发一次，返回要不要重发。
   */
  repeated(received: number): boolean {
    if (received !== this.acked || this.next <= this.acked || this.rewoundAt === this.acked) {
      return false;
    }
    this.rewoundAt = this.acked;
    this.next = this.acked;
    return true;
  }

  /** 从电脑说的位置接着发：确认超时、中转服务说太忙、重连后电脑回 upload 时。 */
  resume(received: number): void {
    this.acked = Math.min(Math.max(received, 0), this.chunks);
    this.next = this.acked;
    this.rewoundAt = -1;
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/remote-chunks.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/remote-chunks.ts src/shared/remote-chunks.test.ts
git commit -m "feat(remote): send documents in acknowledged chunks and reassemble them in order" -m "A go-back-N window keeps at most four 256KB chunks in flight per upload. The desktop takes only the next chunk and always answers with how many it has, so a dropped frame, a reconnect or a restarted upload all resume from the same number. Chunks are copied on arrival so a decoded message buffer is not kept alive." -m "$TRAILER"
```

---

### Task 5: 中转服务：远程打印页的连接、按会话种类分流、限速和配额、发送缓冲上限

**Files:**
- Modify: `relay/src/token-bucket.ts`、`relay/src/token-bucket.test.ts`
- Modify: `relay/src/hub.ts`、`relay/src/hub.test.ts`
- Modify: `relay/src/server.ts`、`relay/src/server.test.ts`

- [ ] **Step 1: 写测试**

`relay/src/token-bucket.test.ts` 末尾加：

```ts
describe('peek and isFull', () => {
  test('peek says whether a cost fits without taking it', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(10, 100, clock);
    expect(bucket.peek(100)).toBe(true);
    expect(bucket.peek(101)).toBe(false);
    expect(bucket.take(100)).toBe(true);
    expect(bucket.peek(1)).toBe(false);
    expect(bucket.isFull()).toBe(false);
    clock.advance(10_000);
    expect(bucket.isFull()).toBe(true);
  });
});
```

（文件里没有 `FakeClock` 的 import 时加 `import { FakeClock } from '../../src/core/testing/fake-clock';`。）

`relay/src/hub.test.ts`：

1. `FakePeer` 加一个可调的缓冲量：

```ts
  /** 假装还有这么多字节没发出去（server.ts 里是 Bun 的 getBufferedAmount）。 */
  buffered = 0;

  bufferedBytes(): number {
    return this.buffered;
  }
```

2. `openDesktop` 加第三个参数 `kind: 'scan' | 'share' = 'scan'`，帧里的 `kind: 'scan'` 改成 `kind`；加：

```ts
function joinViewer(session: string, ip?: string): FakePeer {
  const viewer = peer(ip);
  hub.attach(viewer, 'viewer');
  send(viewer, { t: 'join', v: MOBILE_PROTOCOL_VERSION, session });
  return viewer;
}

/** 密文有 size 字节的一帧：限速按整帧的字节数算。 */
function sizedBody(size: number): SealedBody {
  return { iv: new Uint8Array(12), ct: new Uint8Array(size) };
}
```

3. 末尾加：

```ts
describe('remote shares', () => {
  test('lets a viewer join only a share, and a phone only a phone scan', () => {
    const { session: share } = openDesktop(randomId(), randomId(), 'share');
    const { session: scan } = openDesktop();
    expect(joinViewer(share).types()).toEqual(['online']);
    expect(joinPhone(share).types()).toEqual(['not-found']);
    expect(joinViewer(scan).types()).toEqual(['not-found']);
  });

  test('keeps the kind of a session when its owner takes it over', () => {
    const { session, secret } = openDesktop(randomId(), randomId(), 'share');
    const { desktop } = openDesktop(session, secret, 'scan');
    expect(desktop.last()).toEqual({ t: 'error', code: 'bad-frame' });
  });

  test('relays a viewer to the desktop under its own connection id', () => {
    const { desktop, session } = openDesktop(randomId(), randomId(), 'share');
    const viewer = joinViewer(session);
    send(viewer, { t: 'send', body: BODY });
    expect(desktop.last()).toEqual({ t: 'recv', phone: viewer.id, body: BODY });
    send(desktop, { t: 'send', phone: viewer.id, body: BODY });
    expect(viewer.last()).toEqual({ t: 'recv', body: BODY });
  });

  test('closes a viewer that sends a frame bigger than a remote frame', () => {
    const { session } = openDesktop(randomId(), randomId(), 'share');
    const viewer = joinViewer(session);
    send(viewer, { t: 'send', body: sizedBody(MAX_REMOTE_FRAME_BYTES) });
    expect(viewer.closed?.code).toBe(1008);
  });

  test('drops a frame for a desktop that still has too much to send, and says busy', () => {
    const { desktop, session } = openDesktop(randomId(), randomId(), 'share');
    const viewer = joinViewer(session);
    desktop.buffered = PEER_BUFFER_BYTES;
    send(viewer, { t: 'send', body: BODY });
    expect(desktop.types()).not.toContain('recv');
    expect(viewer.last()).toEqual({ t: 'error', code: 'busy' });
    expect(viewer.closed).toBeNull();
    desktop.buffered = 0;
    hub.drained(desktop);
    send(viewer, { t: 'send', body: BODY });
    expect(desktop.last()).toMatchObject({ t: 'recv' });
  });

  test('caps what all connections together may have waiting', () => {
    hub = createHub({ maxRelayBufferedBytes: 1_000 });
    const first = openDesktop(randomId(), randomId(), 'share');
    const second = openDesktop(randomId(), randomId(), 'share');
    const viewer = joinViewer(second.session);
    first.desktop.buffered = 900;
    // 第一台电脑有积压：先往它那里转一帧，hub 才会记住它。
    send(joinViewer(first.session), { t: 'send', body: BODY });
    send(viewer, { t: 'send', body: sizedBody(200) });
    expect(viewer.last()).toEqual({ t: 'error', code: 'busy' });
  });

  test('drops frames past the byte quota of a share without closing the viewer, then lets them through again', () => {
    hub = createHub({}, { shareByteBurst: 1_000, shareBytesPerSecond: 1_000 });
    const { desktop, session } = openDesktop(randomId(), randomId(), 'share');
    const viewer = joinViewer(session);
    send(viewer, { t: 'send', body: sizedBody(600) });
    send(viewer, { t: 'send', body: sizedBody(600) });
    expect(desktop.types().filter((type) => type === 'recv')).toHaveLength(1);
    expect(viewer.last()).toEqual({ t: 'error', code: 'quota' });
    expect(viewer.closed).toBeNull();
    clock.advance(1_000);
    send(viewer, { t: 'send', body: sizedBody(600) });
    expect(desktop.types().filter((type) => type === 'recv')).toHaveLength(2);
  });

  test('shares one byte quota between viewers from the same address', () => {
    hub = createHub({}, { ipByteBurst: 1_000, ipBytesPerSecond: 1 });
    const one = openDesktop(randomId(), randomId(), 'share');
    const two = openDesktop(randomId(), randomId(), 'share');
    send(joinViewer(one.session, '198.51.100.7'), { t: 'send', body: sizedBody(600) });
    const other = joinViewer(two.session, '198.51.100.7');
    send(other, { t: 'send', body: sizedBody(600) });
    expect(other.last()).toEqual({ t: 'error', code: 'quota' });
    const elsewhere = joinViewer(two.session, '198.51.100.8');
    send(elsewhere, { t: 'send', body: sizedBody(600) });
    expect(two.desktop.last()).toMatchObject({ t: 'recv', phone: elsewhere.id });
  });

  test('admits twice as many viewer connections as the desktop accepts viewers', () => {
    const { session } = openDesktop(randomId(), randomId(), 'share');
    for (let index = 0; index < REMOTE_MAX_VIEWERS * 2; index += 1) {
      expect(joinViewer(session, `203.0.113.${index}`).types()).toEqual(['online']);
    }
    expect(joinViewer(session, '203.0.113.250').last()).toEqual({ t: 'error', code: 'server-busy' });
  });
});
```

import 里加 `PEER_BUFFER_BYTES`（从 `./hub`）、`MAX_REMOTE_FRAME_BYTES`、`REMOTE_MAX_VIEWERS`（从 `../../src/shared/remote-protocol`）；`createHub` 改为：

```ts
function createHub(limits = {}, quotas = {}): RelayHub {
  return new RelayHub({ clock, log: (line) => logs.push(line), limits, quotas });
}
```

`relay/src/server.test.ts`：

1. `beforeAll` 里再建一个远程打印页的目录，`config` 加 `remoteRoot`：

```ts
  remoteRoot = join(webRoot, '..', 'remote');
  await mkdir(remoteRoot, { recursive: true });
  await writeFile(join(remoteRoot, 'index.html'), '<!doctype html><title>远程打印</title>');
  const config: RelayConfig = {
    host: '127.0.0.1',
    port: 0,
    publicOrigin: ORIGIN,
    webRoot,
    remoteRoot,
    version: 'test-1',
  };
```

（顶部加 `let remoteRoot: string;`。`RelayConfig.remoteRoot` 在 Task 6 加，这一步先加字段，Task 6 再把静态文件接上；为了这一步能编译，Task 5 的实现里先给 `RelayConfig` 加上 `remoteRoot: string` 和 `readConfig` 里的 `remoteRoot: join(entryDir, 'remote')`。）

2. `describe('websockets')` 里加：

```ts
  test('relays a remote viewer of a share session', async () => {
    const desktop = await connect('/ws/desktop');
    const session = randomId();
    desktop.send({ t: 'open', v: MOBILE_PROTOCOL_VERSION, session, secret: randomId(), kind: 'share' });
    expect(await desktop.next()).toEqual({ t: 'opened' });
    const viewer = await connect('/ws/remote', ORIGIN);
    viewer.send({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session });
    expect(await viewer.next()).toEqual({ t: 'online' });
    const joined = (await desktop.next()) as { t: string; phone: string };
    expect(joined.t).toBe('joined');
    viewer.send({ t: 'send', body: BODY });
    expect(await desktop.next()).toEqual({ t: 'recv', phone: joined.phone, body: BODY });
  });

  test('refuses a remote viewer from another origin', async () => {
    const url = new URL('/ws/remote', relay.url).href.replace(/^http/, 'ws');
    const socket = new WebSocket(url, { headers: { Origin: 'https://evil.example.com' } });
    clients.push(socket);
    const code = await new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });
    expect(code).not.toBe(CLOSE_CODES.normal);
  });

  test('tells a protocol 2 desktop to update', async () => {
    const desktop = await connect('/ws/desktop');
    desktop.send({ t: 'open', v: 2, session: randomId(), secret: randomId(), kind: 'scan' });
    expect(await desktop.next()).toEqual({ t: 'error', code: 'version' });
    expect(await desktop.closed).toBe(CLOSE_CODES.policy);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test relay/src`
Expected: FAIL（没有 `peek`、`isFull`、`'viewer'` 角色、`drained`、`PEER_BUFFER_BYTES`、`quotas`、`/ws/remote`）。

- [ ] **Step 3: 实现**

`relay/src/token-bucket.ts` 加两个方法（`take` 里的补充令牌抽成 `refill()`，三个方法共用）：

```ts
  /** 现在够不够 cost 个令牌（不取）：几个桶都够才一起取，免得一个桶白白扣掉。 */
  peek(cost = 1): boolean {
    this.refill();
    return this.tokens >= cost;
  }

  /** 桶满了：这段时间没有用过，可以忘掉它（中转服务按来源 IP 记的桶靠它清理）。 */
  isFull(): boolean {
    this.refill();
    return this.tokens >= this.burst;
  }

  private refill(): void {
    const now = this.clock.now();
    // 时钟往回走（例如系统校时）时不能扣掉额度，否则这个连接要被拒很久。
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.ratePerSecond) / MS_PER_SECOND);
    this.updatedAt = now;
  }
```

`take` 改为先 `this.refill();` 再判断、扣减。

`relay/src/hub.ts`：

1. 文件头注释第二段末尾加一句：「远程共享（kind = share）是长期的会话，远程打印页经 /ws/remote 加入（角色 viewer）；它们传的是分块的文件，所以另有按字节的配额和发送缓冲上限：转发前看目标连接还有多少没发出去，太多就丢帧回 busy，中转服务不替任何一方攒数据。」
2. import 里加 `MAX_REMOTE_FRAME_BYTES`、`REMOTE_CHUNK_BYTES`、`REMOTE_MAX_DOCUMENT_BYTES`、`REMOTE_MAX_PENDING_JOBS`、`REMOTE_MAX_VIEWERS`、`REMOTE_UPLOAD_WINDOW`（`../../src/shared/remote-protocol`）和 `type SessionKind`（`mobile-protocol`）。
3. `Peer` 加：

```ts
  /** 已经交给这个连接、还没发出去的字节（Bun 的 getBufferedAmount）：转发大帧之前看一眼。 */
  bufferedBytes(): number;
```

4. `PeerRole` 改为 `'desktop' | 'phone' | 'viewer'`。
5. 限制和配额：

```ts
export interface HubLimits {
  maxSessions: number;
  maxConnections: number;
  maxPhonesPerSession: number;
  maxViewersPerSession: number;
  maxConnectionsPerIp: number;
  /** 单个连接最多积压这么多字节没发出去；再多就不往它那里转大帧。 */
  maxPeerBufferBytes: number;
  /** 所有连接加起来最多积压这么多字节。 */
  maxRelayBufferedBytes: number;
}

/** 远程打印页按字节的配额（每秒、突发）：单个页面连接、一个远程共享、一个来源 IP。 */
export interface HubQuotas {
  viewerBytesPerSecond: number;
  viewerByteBurst: number;
  shareBytesPerSecond: number;
  shareByteBurst: number;
  ipBytesPerSecond: number;
  ipByteBurst: number;
}

export interface HubDeps {
  clock: Clock;
  log: (line: string) => void;
  limits?: Partial<HubLimits>;
  quotas?: Partial<HubQuotas>;
}

/** 单个连接的积压上限：两个最大帧（手机的标签图帧）。一帧在路上、下一帧还能进来，再多说明对方读得太慢。 */
export const PEER_BUFFER_BYTES = 2 * MAX_FRAME_BYTES;
/** 全部连接的积压上限 32MB：容器内存上限 128MB，留出运行时和静态文件的余量。 */
export const RELAY_BUFFERED_BYTES = 32 * 1024 * 1024;
const BYTES_PER_MB = 1024 * 1024;

const DEFAULT_LIMITS: HubLimits = {
  // 远程共享是长期的会话（每台电脑最多 5 个），会话数比只有手机扫码时多。
  maxSessions: 1_000,
  maxConnections: 2_000,
  // 电脑最多接纳 MAX_PHONES_PER_SESSION 部手机；翻倍是给刷新页面、换网络时新旧连接短暂重叠，
  // 多出来的连接由电脑拒绝，中转服务只防刷爆。远程打印页同理。
  maxPhonesPerSession: MAX_PHONES_PER_SESSION * 2,
  maxViewersPerSession: REMOTE_MAX_VIEWERS * 2,
  // 一家店的所有设备通常共用一个出口 IP。
  maxConnectionsPerIp: 20,
  maxPeerBufferBytes: PEER_BUFFER_BYTES,
  maxRelayBufferedBytes: RELAY_BUFFERED_BYTES,
};

/**
 * 远程打印的配额：热敏标签机一小时打不完几百 MB 的文件，正常用碰不到；刷流量的很快被挡住（官方中转服务是共用的）。
 * - 页面连接：每秒 1MB，突发是两个窗口（发送窗口 4 块）；
 * - 一个共享：每秒 256KB，突发三份最大的文件（一次传几份大文件不受影响，之后按每小时约 900MB）；
 * - 一个来源 IP 的所有页面：每秒 2MB，突发两份最大的文件。
 */
const DEFAULT_QUOTAS: HubQuotas = {
  viewerBytesPerSecond: BYTES_PER_MB,
  viewerByteBurst: 2 * REMOTE_UPLOAD_WINDOW * REMOTE_CHUNK_BYTES,
  shareBytesPerSecond: 256 * 1024,
  shareByteBurst: 3 * REMOTE_MAX_DOCUMENT_BYTES,
  ipBytesPerSecond: 2 * BYTES_PER_MB,
  ipByteBurst: 2 * REMOTE_MAX_DOCUMENT_BYTES,
};

/** 远程打印页平均每秒最多 10 帧：一个窗口 4 块加确认、查询，留余量。 */
const VIEWER_FRAMES_PER_SECOND = 10;
/** 重新被接纳时一次发出：hello、几个 offer / status，加一个窗口的块；留一倍余量。 */
const VIEWER_FRAME_BURST = 2 * (1 + REMOTE_UPLOAD_WINDOW + REMOTE_MAX_PENDING_JOBS);
```

6. `Session` 加 `kind: SessionKind;` 和 `/** 远程共享的字节配额（手机扫码的会话也有一个，用不到）。 */ bytes: TokenBucket;`；`phones` 的注释改成「加入的手机或远程打印页（按会话种类只有一种）」。
7. `RelayHub` 加字段：

```ts
  private readonly quotas: HubQuotas;
  /** 来源 IP → 远程打印页的字节配额；IP 没有连接、桶又满了时在 tick 里忘掉。 */
  private readonly ipBytes = new Map<string, TokenBucket>();
  /** 最近一次转发后还有积压的连接：算全局积压时只看它们。 */
  private readonly backlogged = new Set<Connection>();
```

构造函数里加 `this.quotas = { ...DEFAULT_QUOTAS, ...deps.quotas };`。

8. `attach` 里建桶改为按角色：

```ts
    const frames = {
      desktop: [DESKTOP_FRAMES_PER_SECOND, DESKTOP_FRAME_BURST],
      phone: [PHONE_FRAMES_PER_SECOND, PHONE_FRAME_BURST],
      viewer: [VIEWER_FRAMES_PER_SECOND, VIEWER_FRAME_BURST],
    } as const satisfies Record<PeerRole, readonly [number, number]>;
    const [rate, burst] = frames[role];
    const bucket = new TokenBucket(rate, burst, this.deps.clock);
    // 电脑只转发结果和进度，帧都很小，不按字节限速。
    const bytes =
      role === 'phone'
        ? new TokenBucket(PHONE_BYTES_PER_SECOND, PHONE_BYTE_BURST, this.deps.clock)
        : role === 'viewer'
          ? new TokenBucket(this.quotas.viewerBytesPerSecond, this.quotas.viewerByteBurst, this.deps.clock)
          : null;
```

9. `receive` 改为：

```ts
  receive(peer: Peer, bytes: Uint8Array): void {
    const connection = this.connections.get(peer.id);
    if (!connection) {
      return;
    }
    // 服务端的 maxPayloadLength 按手机的标签图帧（更大）：远程打印页的帧另按自己的上限挡。
    if (connection.role === 'viewer' && bytes.length > MAX_REMOTE_FRAME_BYTES) {
      this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
      return;
    }
    if (!connection.bucket.take() || (connection.bytes !== null && !connection.bytes.take(bytes.length))) {
      this.throttle(connection);
      return;
    }
    const frame = decodeWire(bytes);
    if (connection.role === 'desktop') {
      this.receiveFromDesktop(connection, parseDesktopFrame(frame));
    } else {
      this.receiveFromMember(connection, parsePhoneFrame(frame), bytes.length);
    }
  }

  /** server.ts 在连接的发送缓冲排空（Bun 的 drain）时调用。 */
  drained(peer: Peer): void {
    const connection = this.connections.get(peer.id);
    if (connection && connection.peer.bufferedBytes() === 0) {
      this.backlogged.delete(connection);
    }
  }
```

10. `receiveFromPhone` 改名 `receiveFromMember(connection, frame, size)`，`send` 分支换成：

```ts
      case 'send': {
        const session = this.sessions.get(connection.session);
        const desktop = session?.desktop;
        // 电脑不在时丢弃：对方已经收到 waiting，不会在这时发请求。
        if (session && desktop) {
          this.forwardToDesktop(connection, session, desktop, frame.body, size);
        }
        return;
      }
```

并加：

```ts
  /**
   * 转给电脑：电脑那边积压太多就丢掉、回 busy（对方按退避重发）；远程打印页另按共享和来源 IP 的字节配额，
   * 超了丢掉、回 quota。都不算违规、不断开：正常用的页面也可能碰到，它会自己慢下来。
   */
  private forwardToDesktop(
    from: Connection,
    session: Session,
    desktop: Connection,
    body: SealedBody,
    size: number,
  ): void {
    const encoded = encodeWire({ t: 'recv', phone: from.peer.id, body } satisfies RelayToDesktop);
    if (!this.canBuffer(desktop, encoded.length)) {
      sendTo(from, { t: 'error', code: 'busy' });
      return;
    }
    if (from.role === 'viewer' && !this.takeQuota(session, from.peer.ip, size)) {
      sendTo(from, { t: 'error', code: 'quota' });
      return;
    }
    desktop.peer.send(encoded);
    if (desktop.peer.bufferedBytes() > 0) {
      this.backlogged.add(desktop);
    }
  }

  /** 目标连接自己、以及所有连接加起来，再放 size 字节还在上限之内。 */
  private canBuffer(target: Connection, size: number): boolean {
    if (target.peer.bufferedBytes() + size > this.limits.maxPeerBufferBytes) {
      return false;
    }
    let total = 0;
    for (const connection of this.backlogged) {
      const amount = this.connections.has(connection.peer.id) ? connection.peer.bufferedBytes() : 0;
      if (amount === 0) {
        this.backlogged.delete(connection);
      } else {
        total += amount;
      }
    }
    return total + size <= this.limits.maxRelayBufferedBytes;
  }

  /** 共享和来源 IP 两个桶都够才一起扣。 */
  private takeQuota(session: Session, ip: string, size: number): boolean {
    let perIp = this.ipBytes.get(ip);
    if (!perIp) {
      perIp = new TokenBucket(this.quotas.ipBytesPerSecond, this.quotas.ipByteBurst, this.deps.clock);
      this.ipBytes.set(ip, perIp);
    }
    if (!session.bytes.peek(size) || !perIp.peek(size)) {
      return false;
    }
    session.bytes.take(size);
    perIp.take(size);
    return true;
  }
```

（`SealedBody`、`RelayToDesktop` 已在 import 里；没有的话补上。）

11. `open`：

- 已有会话时，所有权核对通过后加：

```ts
      if (existing.kind !== frame.kind) {
        // 同一个会话号换了种类：不是正常的电脑，当作坏帧。
        this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
        return;
      }
```

- 新建会话时加 `kind: frame.kind,` 和 `bytes: new TokenBucket(this.quotas.shareBytesPerSecond, this.quotas.shareByteBurst, this.deps.clock),`；日志行末尾加 ` kind=${frame.kind}`。

12. `join`：

```ts
    const session = this.sessions.get(frame.session);
    // 手机只能加入手机扫码的会话，远程打印页只能加入远程共享：对不上和不存在一样回 not-found，不透露会话号存在。
    const wanted: SessionKind = connection.role === 'viewer' ? 'share' : 'scan';
    if (!session || session.kind !== wanted) {
      sendTo(connection, { t: 'not-found' });
      this.close(connection, CLOSE_CODES.normal, 'not found');
      return;
    }
    const capacity =
      connection.role === 'viewer' ? this.limits.maxViewersPerSession : this.limits.maxPhonesPerSession;
    if (session.phones.size >= capacity) {
```

（后面不变；日志里的 `phone joined` 改成 `${connection.role} joined`。）

13. `detach` 开头（`this.connections.delete` 之后）加 `this.backlogged.delete(connection);`；`connection.role === 'phone' && session.phones.delete(peer.id)` 改为 `connection.role !== 'desktop' && session.phones.delete(peer.id)`，日志 `phone left` 改成 `${connection.role} left`。
14. `tick` 末尾加：

```ts
    // 来源 IP 已经没有连接、配额也回满了：忘掉它（马上重连的不会因此多拿到额度）。
    for (const [ip, bucket] of this.ipBytes) {
      if (!this.connectionsPerIp.has(ip) && bucket.isFull()) {
        this.ipBytes.delete(ip);
      }
    }
```

`relay/src/server.ts`：

1. `SOCKET_PATHS` 加 `'/ws/remote': 'viewer',`。
2. `upgrade` 里的来源检查改为 `if (role !== 'desktop' && request.headers.get('origin') !== config.publicOrigin)`，注释改为「手机页面和远程打印页只能来自我们自己的站点；电脑端不是浏览器，没有 Origin。」
3. `websocket` 选项加：

```ts
      // 转发前 hub 已按积压上限挡过；这里是最后一道闸：超过一个积压上限加一帧（不该发生）就断开这个连接。
      backpressureLimit: PEER_BUFFER_BYTES + MAX_FRAME_BYTES,
      closeOnBackpressureLimit: true,
      drain(socket) {
        if (socket.data.peer) {
          hub.drained(socket.data.peer);
        }
      },
```

（import 里加 `PEER_BUFFER_BYTES`。）

4. `toPeer` 加 `bufferedBytes: () => socket.getBufferedAmount(),`。
5. `relay/src/config.ts`：`RelayConfig` 加

```ts
  /** 远程打印页的构建产物目录。 */
  remoteRoot: string;
```

`readConfig` 里加 `remoteRoot: join(entryDir, 'remote'),`（静态文件在 Task 6 接上）。`relay/src/config.test.ts` 里对 `readConfig` 结果的期望加上 `remoteRoot`。

- [ ] **Step 4: 跑测试**

Run: `bun test relay/src`
Expected: PASS。「caps what all connections together」里第一台电脑先收到一帧才会进 `backlogged`：这是有意的，hub 只在转发后才知道谁有积压，`drain` 再把它拿掉。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add relay/src
git commit -m "feat(relay): admit remote viewers to share sessions with quotas and bounded buffering" -m "Viewers join only share sessions and phones only scan sessions; a mismatch looks like a missing session. Before forwarding, the hub checks how much the desktop connection still has to send and how much all connections hold together, and drops the frame with busy instead of buffering a whole document. Viewer traffic also draws on per-connection, per-share and per-address byte buckets; running out drops the frame with quota and never closes a well-behaved page." -m "$TRAILER"
```

---

### Task 6: 中转服务：远程打印页的静态文件和构建

远程打印页和扫码页是同一套前端（原生 DOM、Bun 打包、带哈希的资源），单独构建、单独的路径 `/r/`，CSP 更紧：不用摄像头、不用 wasm、不用 worker。这一步先放一个最小的页面骨架（`main.ts` 只显示「正在打开…」），页面本身在 Task 19。

**Files:**
- Modify: `relay/src/static-files.ts`、`relay/src/static-files.test.ts`
- Modify: `relay/src/server.ts`、`relay/src/server.test.ts`
- Modify: `scripts/relay/build.ts`、`scripts/relay/build.test.ts`
- Create: `relay/web/remote/index.html`、`relay/web/remote/styles.css`、`relay/web/src/remote/main.ts`

- [ ] **Step 1: 写测试**

`relay/src/static-files.test.ts`（按文件里现有的写法，用临时目录和 `serveStatic`）加：

```ts
describe('remote page', () => {
  test('serves files under /r/ with a policy that allows no camera, wasm or workers', async () => {
    const response = await serveStatic(root, '/r/', '/r/', ORIGIN, 'remote');
    expect(response.status).toBe(200);
    const policy = response.headers.get('Content-Security-Policy') ?? '';
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toContain('wasm-unsafe-eval');
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain(`connect-src 'self' wss://relay.example.com`);
    expect(response.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  test('does not serve the scan page under /r/ or the remote page under /m/', async () => {
    expect((await serveStatic(root, '/r/', '/m/', ORIGIN, 'remote')).status).toBe(404);
    expect((await serveStatic(root, '/m/', '/r/', ORIGIN, 'scan')).status).toBe(404);
  });
});
```

（`root` 是测试里建好、放了 `index.html` 的临时目录；文件里现有的 `serveStatic(root, pathname, origin)` 调用都改成 `serveStatic(root, '/m/', pathname, origin, 'scan')`。）

`relay/src/server.test.ts` 的 `describe('http routes')` 加：

```ts
  test('serves the remote printing page', async () => {
    const response = await fetch(new URL('/r/', relay.url));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('远程打印');
  });
```

`scripts/relay/build.test.ts`（按现有用例的写法，构建到临时目录）加：

```ts
test('builds the remote printing page next to the scan page with its own hashed assets', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'relay-build-'));
  try {
    await buildRelay({ outDir, version: 'test' });
    const html = await readFile(join(outDir, 'remote', 'index.html'), 'utf8');
    expect(html).toMatch(/src="assets\/main-[a-z0-9]+\.js"/);
    expect(html).toMatch(/href="assets\/remote-[0-9a-f]{8}\.css"/);
    expect(html).not.toContain('{{');
    // 远程打印页不带解码器：没有 wasm，也没有 worker。
    const assets = await readdir(join(outDir, 'remote', 'assets'));
    expect(assets.some((name) => name.endsWith('.wasm'))).toBe(false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, BUILD_TIMEOUT_MS);
```

（`BUILD_TIMEOUT_MS`、import 按文件里已有的；没有就加 `const BUILD_TIMEOUT_MS = 60_000;` 和 `readdir`、`readFile`、`mkdtemp`、`rm`、`tmpdir`、`join` 的 import。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test relay/src scripts/relay`
Expected: FAIL（`serveStatic` 还是三个参数；没有 `/r/`；构建产物里没有 `remote/`）。

- [ ] **Step 3: 实现**

`relay/src/static-files.ts`：

```ts
/** 两个页面：scan = 手机扫码页（/m/，要摄像头和 wasm 解码器）；remote = 远程打印页（/r/，只传文件）。 */
export type PageKind = 'scan' | 'remote';

export async function serveStatic(
  root: string,
  prefix: string,
  pathname: string,
  origin: string,
  page: PageKind,
): Promise<Response> {
  const relative = toRelativePath(prefix, pathname);
```

（函数其余部分不变，`securityHeaders(origin)` 改为 `securityHeaders(origin, page)`；删掉 `PAGE_PREFIX` 常量，`toRelativePath` 第一个参数换成 `prefix`。）

```ts
export function securityHeaders(origin: string, page: PageKind): Record<string, string> {
  const socketOrigin = origin.replace(/^http/, 'ws');
  // 扫码页的 zxing 解码器是 WebAssembly、跑在 worker 里，需要 wasm-unsafe-eval（不放开 JS 的 eval）和 worker-src；
  // 远程打印页只读文件、算摘要、发 WebSocket，都不需要。
  const scripts = page === 'scan' ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'";
  const workers = page === 'scan' ? "worker-src 'self'" : "worker-src 'none'";
  const media = page === 'scan' ? "media-src 'self' blob:" : "media-src 'none'";
  const policy = [
    "default-src 'none'",
    scripts,
    workers,
    `connect-src 'self' ${socketOrigin}`,
    "img-src 'self' blob: data:",
    "style-src 'self'",
    media,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': policy,
    'Permissions-Policy': `camera=(${page === 'scan' ? 'self' : ''}), microphone=(), geolocation=()`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}
```

`relay/src/server.ts` 的 `route` 末尾改为：

```ts
  if (pathname.startsWith(REMOTE_PREFIX)) {
    return serveStatic(config.remoteRoot, REMOTE_PREFIX, pathname, config.publicOrigin, 'remote');
  }
  return serveStatic(config.webRoot, SCAN_PREFIX, pathname, config.publicOrigin, 'scan');
```

（常量区加 `/** 手机扫码页和远程打印页的路径前缀。 */ const SCAN_PREFIX = '/m/'; const REMOTE_PREFIX = '/r/';`。）

`scripts/relay/build.ts`：

1. 常量区加 `const REMOTE_SOURCE = join(ROOT, 'relay', 'web', 'remote');`。
2. `buildRelay` 里 `await writeFile(join(outDir, 'web', 'index.html'), html);` 之后加 `await buildRemotePage(outDir);`，并加：

```ts
/**
 * 远程打印页：和扫码页同一套写法（原生 DOM、Bun 打包、带哈希的资源），单独放在 remote/，由中转服务在 /r/ 提供。
 * 不带解码器：没有 wasm、没有 worker。
 */
async function buildRemotePage(outDir: string): Promise<void> {
  const assetsDir = join(outDir, 'remote', 'assets');
  await mkdir(assetsDir, { recursive: true });
  const styleName = await copyHashed(join(REMOTE_SOURCE, 'styles.css'), assetsDir, 'remote', '.css');
  const mainName = await bundleBrowser(join(WEB_SOURCE, 'src', 'remote', 'main.ts'), assetsDir, {});
  const template = await readFile(join(REMOTE_SOURCE, 'index.html'), 'utf8');
  const html = template
    .replaceAll('{{productName}}', escapeHtml(BRAND.productName))
    .replaceAll('{{brandMark}}', escapeHtml(BRAND.mark))
    .replace('href="styles.css"', `href="assets/${styleName}"`)
    .replace('src="app.js"', `src="assets/${mainName}"`);
  await writeFile(join(outDir, 'remote', 'index.html'), html);
}
```

3. `assertSafeOutDir` 的注释不变（上次的产物仍以 `server.js` 和 `web/` 认出）。

`relay/web/remote/index.html`（这一步只是骨架，Task 19 填满）：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#18211e" />
    <meta name="referrer" content="no-referrer" />
    <meta name="format-detection" content="telephone=no" />
    <title>{{productName}} · 远程打印</title>
    <link rel="stylesheet" href="styles.css" />
    <script type="module" src="app.js"></script>
  </head>
  <body>
    <header class="bar">
      <p class="brand"><span class="brand-mark">{{brandMark}}</span><span class="brand-name">{{productName}} · 远程打印</span></p>
    </header>
    <main>
      <section class="screen" id="screen-message">
        <h1 id="message-title">正在打开…</h1>
      </section>
    </main>
  </body>
</html>
```

`relay/web/remote/styles.css`：先放和 `relay/web/styles.css` 一样的基础部分（变量、`body`、`.bar`、`.brand`、`.button`、`.visually-hidden`），Task 19 再加页面自己的样式。

`relay/web/src/remote/main.ts`：

```ts
/** 远程打印页入口（Task 19 接上协议和页面）。 */
const title = document.getElementById('message-title');
if (title) {
  title.textContent = '正在打开…';
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test relay/src scripts/relay`
Expected: PASS。再 `bun run relay:dev`，浏览器打开 `http://localhost:3180/r/` 看到「正在打开…」，开发者工具的 Network 里响应头有上面的 CSP，Console 没有 CSP 报错。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add relay/src relay/web/remote relay/web/src/remote scripts/relay
git commit -m "feat(relay): serve the remote printing page under /r/ with a tighter policy" -m "The remote page is built like the scan page, with hashed assets in its own directory, but it needs no camera, WebAssembly or workers, so its Content-Security-Policy and Permissions-Policy allow none of them. Each page is served only under its own prefix." -m "$TRAILER"
```

---

### Task 7: 图片也在 sandbox 渲染页里解码

远程打印（和 6a 的局域网共享）收到的除了 PDF 还有 JPEG、PNG。图片同样是不可信的输入，按两条法则不在主进程里解码：主进程只读文件头（宽高），拒绝太大的图；真正的解码交给 PDF 打印的那个隐藏渲染页，它把一张图当成只有一页的文档。6a 的计划已经包含 `open-image`（写法和下面一致，带图片的 MIME 类型）：6a 合进来后 Step 3–7 跳过，只做 Step 1–2（6a 没有挪读文件头的函数）。下面的 Step 3–7 只在 6a 没做时用，签名和 6a 一致，免得两份写法。

**Files:**
- Create: `src/shared/image-header.ts`、`src/shared/image-header.test.ts`（从 `src/renderer/src/lib/gray-image.ts` 挪来）
- Modify: `src/renderer/src/lib/gray-image.ts`、`src/renderer/src/lib/gray-image.test.ts`、`src/renderer/src/view-models/use-image-import.ts`
- Modify: `src/shared/pdf-render-protocol.ts`、`src/shared/pdf-render-protocol.test.ts`
- Modify: `src/main/pdf/pdf-render-host.ts`、`src/main/pdf/pdf-render-host.test.ts`
- Modify: `src/renderer/src/pdf-render/main.ts`

- [ ] **Step 1: 把读文件头挪到 shared**

主进程不能 import 界面的代码（依赖方向 renderer → preload → main → core），读文件头是纯函数，挪到 `src/shared/`：

1. Read `src/renderer/src/lib/gray-image.ts`，把 `IMAGE_HEADER_PEEK_BYTES`、`MAX_IMAGE_SOURCE_PIXELS`、`PixelSize`、`readImagePixelSize` 和它们用到的私有函数、常量原样剪进新文件 `src/shared/image-header.ts`（文件头注释：「不解码，只从文件头读图片的宽高：PNG 的 IHDR、JPEG 的 SOFn、GIF、BMP、WebP。界面导入图片和主进程收到的文件（远程打印、局域网共享）都先用它挡住太大的图」）。
2. `gray-image.ts` 里改为从 `'../../../shared/image-header'` import 它还用到的符号；`use-image-import.ts` 里对这几个符号的 import 改到 `'../../../shared/image-header'`。
3. Read `gray-image.test.ts`，把 `readImagePixelSize` 那一组用例（连同它们用的样例字节构造函数）剪进 `src/shared/image-header.test.ts`，import 改为 `./image-header`。

- [ ] **Step 2: 跑测试**

Run: `bun test src/shared/image-header.test.ts src/renderer/src/lib/gray-image.test.ts`
Expected: PASS，用例总数和挪之前一样（只是换了文件）。`bun run check` 通过后提交：

```bash
git add src/shared/image-header.ts src/shared/image-header.test.ts src/renderer/src/lib/gray-image.ts src/renderer/src/lib/gray-image.test.ts src/renderer/src/view-models/use-image-import.ts
git commit -m "refactor(images): read image dimensions from a shared module" -m "The main process now also has to reject oversized images before anything decodes them (remote printing, LAN sharing), and it cannot import renderer code. The header reader is pure, so it moves to src/shared unchanged." -m "$TRAILER"
```

- [ ] **Step 3: 写测试（渲染页能打开图片）**

`src/shared/pdf-render-protocol.test.ts` 加：

```ts
test('accepts an opened image as a one-page document', () => {
  const reply = { id: 3, kind: 'opened', pageCount: 1, pages: [{ width: 4000, height: 3000 }] };
  expect(readRenderReply(reply, { id: 3, kind: 'opened', maxPages: 1 })).toEqual(reply);
  expect(readRenderReply({ ...reply, pageCount: 2, pages: [] }, { id: 3, kind: 'opened', maxPages: 1 })).toBeNull();
});
```

`src/main/pdf/pdf-render-host.test.ts` 加（`createHost`、假端口、`settle` 用文件里现成的；名字不同按文件里的）：

```ts
test('opens an image as a one-page document through its own request', async () => {
  const { host, port } = createHost();
  const opened = host.openImage(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), 'image/png');
  await settle();
  const request = port.sent.at(-1);
  expect(request).toMatchObject({ kind: 'open-image', type: 'image/png' });
  port.reply({ id: request?.id, kind: 'opened', pageCount: 1, pages: [{ width: 800, height: 600 }] });
  expect(await opened).toEqual({ pageCount: 1, pages: [{ width: 800, height: 600 }] });
});

test('treats an image that claims more than one page as a broken render page', async () => {
  const { host, port } = createHost();
  const opened = host.openImage(Uint8Array.of(0xff, 0xd8, 0xff), 'image/jpeg');
  await settle();
  port.reply({ id: port.sent.at(-1)?.id, kind: 'opened', pageCount: 2, pages: [] });
  await expect(opened).rejects.toThrow();
  expect(port.closed).toBe(true);
});
```

- [ ] **Step 4: 跑测试看它失败**

Run: `bun test src/shared/pdf-render-protocol.test.ts src/main/pdf/pdf-render-host.test.ts`
Expected: FAIL（`openImage` 不存在）。第一个协议用例可能已经通过（`readRenderReply` 不分 PDF 和图片），这是预期的。

- [ ] **Step 5: 实现**

`src/shared/pdf-render-protocol.ts`：

```ts
/** 渲染页能解的图片（和 6a 的写法一致）：类型交给 Blob，浏览器按它选解码器。 */
export const RENDER_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type RenderImageType = (typeof RENDER_IMAGE_TYPES)[number];
```

`RenderRequest` 加一种：

```ts
  /** 一张图片（JPEG / PNG）：渲染页当成只有一页的文档，这一页的大小按 1 像素 = 1 点报回。 */
  | { id: number; kind: 'open-image'; data: Uint8Array; type: RenderImageType }
```

`src/main/pdf/pdf-render-host.ts`：`open` 的主体抽成私有的 `openWith`，两个入口共用：

```ts
  /** 打开一个 PDF（关掉上一个）。打不开时抛 PdfRenderError。 */
  open(data: Uint8Array): Promise<OpenedPdf> {
    return this.openWith((id) => ({ id, kind: 'open', data }), PDF_LIMITS.pages);
  }

  /**
   * 打开一张图片（关掉上一个文档）：渲染页把它当成一页，大小是图片的像素数（1 像素 = 1 点），
   * 所以按 POINTS_PER_INCH 的「分辨率」渲染就是原图大小。调用方先用 readImagePixelSize 挡住太大的图。
   */
  openImage(data: Uint8Array, type: RenderImageType): Promise<OpenedPdf> {
    return this.openWith((id) => ({ id, kind: 'open-image', data, type }), 1);
  }

  private async openWith(build: (id: number) => RenderRequest, maxPages: number): Promise<OpenedPdf> {
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
    const reply = await this.request(build, (id) => ({ id, kind: 'opened', maxPages }), this.deps.openTimeoutMs);
    if (reply.kind !== 'opened') {
      throw new PdfRenderError(PDF_ISSUES.failed, `unexpected ${reply.kind} reply to open`);
    }
    return { pageCount: reply.pageCount, pages: reply.pages };
  }
```

（图片报回两页时 `readOpened` 要求 `pages.length === 0`，回复对不上，`receive` 当作坏回复关掉渲染页——测试第二条就是这个。）

`src/renderer/src/pdf-render/main.ts`：

```ts
/** 渲染页里开着的文档：一个 PDF，或者一张已经解码的图片。 */
type OpenDocument = { kind: 'pdf'; pdf: PDFDocumentProxy } | { kind: 'image'; bitmap: ImageBitmap };

let current: OpenDocument | null = null;

function handle(request: RenderRequest): Promise<RenderReply> {
  switch (request.kind) {
    case 'open':
      return open(request.id, request.data);
    case 'open-image':
      return openImage(request.id, request.data, request.type);
    case 'render':
      return render(request.id, request.page, request.scale);
  }
}

async function closeCurrent(): Promise<void> {
  const document = current;
  current = null;
  if (document?.kind === 'pdf') {
    await document.pdf.destroy();
  } else if (document?.kind === 'image') {
    document.bitmap.close();
  }
}

/** 图片在这个 sandbox 页里解码（不可信的输入不进主进程）；透明的地方在 render 里按白纸铺底。 */
async function openImage(id: number, data: Uint8Array, type: RenderImageType): Promise<RenderReply> {
  await closeCurrent();
  // 复制一份成 ArrayBuffer 支撑的数组：Blob 不收共享内存上的视图。
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
  current = { kind: 'image', bitmap };
  return { id, kind: 'opened', pageCount: 1, pages: [{ width: bitmap.width, height: bitmap.height }] };
}
```

`open` 开头的 `await current?.destroy(); current = null;` 换成 `await closeCurrent();`，结尾 `current = pdf;` 换成 `current = { kind: 'pdf', pdf };`。`render` 里：

```ts
  if (current === null) {
    throw new Error('no document is open');
  }
  const base =
    current.kind === 'pdf'
      ? (await current.pdf.getPage(number)).getViewport({ scale: 1 })
      : { width: current.bitmap.width, height: current.bitmap.height };
  const size = renderedSize({ width: base.width, height: base.height }, scale);
  // …建画布、铺白纸（原样）…
  if (current.kind === 'image') {
    context.drawImage(current.bitmap, 0, 0, size.width, size.height);
  } else {
    const page = await current.pdf.getPage(number);
    await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), intent: 'print' })
      .promise;
    page.cleanup();
  }
  // …转灰度、放掉画布（原样）…
```

`failure` 里认图片解码失败：

```ts
  // createImageBitmap 解不开的图报 InvalidStateError / EncodingError：和坏 PDF 一样按「文件坏了」说明。
  const kind: RenderError =
    name === 'PasswordException'
      ? 'password'
      : name === 'InvalidPDFException' || name === 'InvalidStateError' || name === 'EncodingError'
        ? 'invalid'
        : 'failed';
```

- [ ] **Step 6: 跑测试，手动试一次**

Run: `bun test src/shared src/main/pdf && bun run check`
Expected: PASS。再 `bun run dev`，主窗口控制台里没有入口能直接调到 `openImage`（Task 16 接线后由 E2E 覆盖），这一步只确认构建产物里渲染页能加载：`bun run build` 无报错。

- [ ] **Step 7: 提交**

```bash
git add src/shared/pdf-render-protocol.ts src/shared/pdf-render-protocol.test.ts src/main/pdf/pdf-render-host.ts src/main/pdf/pdf-render-host.test.ts src/renderer/src/pdf-render/main.ts
git commit -m "feat(pdf): decode received images in the sandboxed render page" -m "Remote printing and LAN sharing also receive JPEG and PNG files. They are decoded where PDFs are, in the hidden sandboxed page, which reports an image as a one-page document sized in pixels; the main process only reads headers. A reply that claims more than one page closes the render page like any malformed reply." -m "$TRAILER"
```

---

### Task 8: 文档打印通道 DocumentJobService（和 6a 共用）

收到的一份文件 → 认种类 → 在自己的渲染页里逐页渲染、按裁切方式切块、放到纸上、转黑白、存进 PDF 打印的位图缓存（一次只渲染一份）→ 逐张经 `printFields` 打印（不占着渲染页）。打印机出问题就停下，说明打了几张；被取消（撤销共享、移除设备）就在两张之间停。6a 已经建了这个文件时（Task 1 Step 2 第 5 条），只对照下面的测试补缺的行为（`maxLabels`、`signal`、`onProgress`、`partial`），不重写。

**Files:**
- Create: `src/main/documents/document-kind.ts`、`src/main/documents/document-kind.test.ts`
- Create: `src/main/documents/document-job-service.ts`、`src/main/documents/document-job-service.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/documents/document-kind.test.ts
import { describe, expect, test } from 'bun:test';
import { sniffDocumentKind } from './document-kind';

describe('sniffDocumentKind', () => {
  test('knows PDF, PNG and JPEG by their first bytes, not by their names', () => {
    expect(sniffDocumentKind(new TextEncoder().encode('%PDF-1.7\n'))).toBe('pdf');
    // 有的导出工具在文件头前面加几个字节：规范允许 %PDF- 出现在前 1024 字节里。
    expect(sniffDocumentKind(new TextEncoder().encode(`${' '.repeat(100)}%PDF-1.4`))).toBe('pdf');
    expect(sniffDocumentKind(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png');
    expect(sniffDocumentKind(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffDocumentKind(new TextEncoder().encode('PK\u0003\u0004 a docx'))).toBeNull();
    expect(sniffDocumentKind(new Uint8Array(0))).toBeNull();
  });
});
```

```ts
// src/main/documents/document-job-service.test.ts
import { describe, expect, test } from 'bun:test';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { PDF_PIECE_TEMPLATE_ID } from '../../core/pdf/piece-template';
import { blankPage, gridPage } from '../../core/pdf/testing/synthetic-page';
import type { FieldsPrint } from '../../core/print-service';
import type { PrintResult } from '../../core/types';
import type { PageSize, RenderImageType } from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PDF_ISSUES, PdfRenderError, type RenderedPage } from '../pdf/pdf-render-host';
import type { PieceStore } from '../pdf/pdf-station';
import {
  DOCUMENT_ISSUES,
  type DocumentJobServiceDeps,
  DocumentJobService,
  type DocumentPrintRequest,
  type DocumentRenderer,
  tooManyLabelsIssue,
} from './document-job-service';

const A4: PageSize = { width: 595, height: 842 };
const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');
const PRINTED: PrintResult = { status: 'printed', jobId: 'j', scan: { raw: '', ruleId: 'remote', ruleName: '远程打印', fields: [] } };
/** 合成页面约 0.5mm 一个像素：按 48dpi 报给切分（见 PDF 打印的测试）。 */
const SYNTHETIC_DPI = 48;

/** 只有文件头的 PNG：读宽高够用，真正的解码在假渲染页里（不解码）。 */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 2, 0, 0, 0], 24);
  return bytes;
}

class FakeRenderer implements DocumentRenderer {
  pageCount = 2;
  failure: Error | null = null;
  blank = false;
  gate: (() => void)[] | null = null;
  readonly calls: string[] = [];

  async open(_data: Uint8Array): Promise<OpenedPdf> {
    this.calls.push('open');
    if (this.failure !== null) {
      throw this.failure;
    }
    return { pageCount: this.pageCount, pages: Array.from({ length: Math.min(this.pageCount, 200) }, () => A4) };
  }

  async openImage(_data: Uint8Array, type: RenderImageType): Promise<OpenedPdf> {
    this.calls.push(`open-image ${type}`);
    return { pageCount: 1, pages: [{ width: 400, height: 560 }] };
  }

  async render(page: number, _size: PageSize, dpi: number): Promise<RenderedPage> {
    this.calls.push(`render ${page} @${dpi}`);
    const gate = this.gate;
    if (gate !== null) {
      await new Promise<void>((resolve) => gate.push(resolve));
    }
    return { image: this.blank ? blankPage(400, 560) : gridPage(), dpi: SYNTHETIC_DPI };
  }

  close(): void {
    this.calls.push('close');
  }
}

class MemoryPieces implements PieceStore {
  readonly stored = new Map<string, MonoBitmap>();
  private count = 0;

  async save(bitmap: MonoBitmap): Promise<string> {
    this.count += 1;
    this.stored.set(`k${this.count}`, bitmap);
    return `k${this.count}`;
  }

  async load(key: string): Promise<MonoBitmap | null> {
    return this.stored.get(key) ?? null;
  }

  async touch(): Promise<void> {}

  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.stored.delete(key);
    }
  }
}

function createService(overrides: Partial<DocumentJobServiceDeps> = {}) {
  const renderer = new FakeRenderer();
  const pieces = new MemoryPieces();
  const printed: FieldsPrint[] = [];
  const deps: DocumentJobServiceDeps = {
    renderer,
    pieces,
    dpiFor: async () => 203,
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    onJobsChanged: () => undefined,
    log: () => undefined,
    ...overrides,
  };
  return { service: new DocumentJobService(deps), renderer, pieces, printed };
}

function request(changes: Partial<DocumentPrintRequest> = {}): DocumentPrintRequest {
  return {
    document: { name: '面单.pdf', bytes: PDF },
    paperKey: '100x150',
    crop: 'split',
    copies: 1,
    maxLabels: 200,
    source: 'remote',
    caller: 'remote:北京仓 · 张三',
    signal: new AbortController().signal,
    onProgress: () => undefined,
    ...changes,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DocumentJobService', () => {
  test('prints every piece in order with copies as records of where it came from', async () => {
    const { service, printed, renderer } = createService();
    const progress: string[] = [];
    const outcome = await service.print(request({ copies: 2, onProgress: (done, total) => progress.push(`${done}/${total}`) }));
    expect(outcome).toEqual({ status: 'sent', labels: 16 });
    expect(printed).toHaveLength(16);
    expect(printed[0]).toMatchObject({
      source: 'remote',
      caller: 'remote:北京仓 · 张三',
      printerName: null,
      content: '面单.pdf 第 1 页第 1 张',
      pdf: { file: '面单.pdf', page: 1, piece: 1 },
      template: { id: PDF_PIECE_TEMPLATE_ID, paper: { widthMm: 100, heightMm: 150 } },
    });
    expect(printed.map((input) => input.content).slice(0, 3)).toEqual([
      '面单.pdf 第 1 页第 1 张',
      '面单.pdf 第 1 页第 1 张',
      '面单.pdf 第 1 页第 2 张',
    ]);
    expect(progress.at(0)).toBe('0/16');
    expect(progress.at(-1)).toBe('16/16');
    expect(renderer.calls).toEqual(['open', 'render 1 @203', 'render 2 @203', 'close']);
  });

  test('refuses a file that is not a PDF, JPEG or PNG without rendering it', async () => {
    const { service, renderer } = createService();
    const outcome = await service.print(request({ document: { name: 'a.docx', bytes: new TextEncoder().encode('PK') } }));
    expect(outcome).toEqual({ status: 'invalid', issue: DOCUMENT_ISSUES.notDocument });
    expect(renderer.calls).toEqual([]);
  });

  test('decodes an image in the render page at its own size', async () => {
    const { service, renderer } = createService();
    const outcome = await service.print(request({ document: { name: '照片.png', bytes: pngHeader(400, 560) }, crop: 'page' }));
    expect(outcome).toEqual({ status: 'sent', labels: 1 });
    expect(renderer.calls).toEqual(['open-image image/png', 'render 1 @72', 'close']);
  });

  test('refuses an image that is too large before anything decodes it', async () => {
    const { service, renderer } = createService();
    const outcome = await service.print(request({ document: { name: '大图.png', bytes: pngHeader(10_000, 10_000) } }));
    expect(outcome).toEqual({ status: 'invalid', issue: DOCUMENT_ISSUES.imageTooLarge });
    expect(renderer.calls).toEqual([]);
  });

  test('prints nothing when the labels would pass the limit, and keeps nothing it rendered', async () => {
    const { service, printed, pieces } = createService();
    expect(await service.print(request({ copies: 3, maxLabels: 20 }))).toEqual({
      status: 'invalid',
      issue: tooManyLabelsIssue(24, 20),
    });
    expect(printed).toEqual([]);
    expect(pieces.stored.size).toBe(0);
  });

  test('says when every page is blank', async () => {
    const { service, renderer } = createService();
    renderer.blank = true;
    expect(await service.print(request())).toEqual({ status: 'invalid', issue: DOCUMENT_ISSUES.empty });
  });

  test('stops at a printer problem, says how far it got and keeps only what was printed', async () => {
    let calls = 0;
    const { service, pieces } = createService({
      printFields: async () => {
        calls += 1;
        return calls <= 3 ? PRINTED : { status: 'failed', reason: 'PRINTER_NOT_READY', issue: 'paperOut' };
      },
    });
    expect(await service.print(request())).toEqual({
      status: 'partial',
      sent: 3,
      total: 8,
      failure: { reason: 'PRINTER_NOT_READY', issue: 'paperOut' },
    });
    expect(pieces.stored.size).toBe(3);
  });

  test('reports a paper without a printer before printing anything', async () => {
    const { service } = createService({
      printFields: async () => ({ status: 'no-printer', paperKey: '100x150', missingPrinter: null }),
    });
    expect(await service.print(request())).toEqual({ status: 'no-printer' });
  });

  test('stops between labels once canceled', async () => {
    const controller = new AbortController();
    const { service } = createService({
      printFields: async () => {
        controller.abort();
        return PRINTED;
      },
    });
    expect(await service.print(request({ signal: controller.signal }))).toEqual({ status: 'canceled', sent: 1 });
  });

  test('renders one document at a time but does not hold the render page while printing', async () => {
    const { service, renderer } = createService();
    const gate: (() => void)[] = [];
    renderer.gate = gate;
    const first = service.print(request());
    const second = service.print(request({ document: { name: 'b.pdf', bytes: PDF } }));
    await settle();
    // 第一份还在渲染第 1 页：第二份不能打开渲染页（一次只开一个文档）。
    expect(renderer.calls).toEqual(['open', 'render 1 @203']);
    // 后面的渲染不再等；已经在等的那一页用拿住的数组放行。
    renderer.gate = null;
    for (const release of gate.splice(0)) {
      release();
    }
    await Promise.all([first, second]);
    const opens = renderer.calls.flatMap((call, index) => (call === 'open' ? [index] : []));
    expect(opens).toHaveLength(2);
    // 第一份关掉渲染页之后第二份才打开。
    expect(renderer.calls.indexOf('close')).toBeLessThan(opens[1] ?? -1);
    expect(service.pendingLabels).toBe(0);
  });

  test('passes on why the render page could not open the file', async () => {
    const { service, renderer } = createService();
    renderer.failure = new PdfRenderError(PDF_ISSUES.password, 'PasswordException');
    expect(await service.print(request())).toEqual({ status: 'invalid', issue: PDF_ISSUES.password });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/documents`
Expected: FAIL，`Cannot find module './document-kind'`、`'./document-job-service'`。

- [ ] **Step 3: 实现**

```ts
// src/main/documents/document-kind.ts
/**
 * 收到的文件是什么：只按文件头认，不信文件名和对方报的种类（远程打印、局域网共享都用）。
 */
export const DOCUMENT_KINDS = ['pdf', 'jpeg', 'png'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** PDF 规范允许 %PDF- 出现在前 1024 字节里的任何位置（有的导出工具会在前面加几个字节）。 */
const PDF_HEADER = '%PDF-';
const PDF_HEADER_WINDOW_BYTES = 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

export function sniffDocumentKind(bytes: Uint8Array): DocumentKind | null {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return 'png';
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return 'jpeg';
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, PDF_HEADER_WINDOW_BYTES));
  return head.includes(PDF_HEADER) ? 'pdf' : null;
}
```

```ts
// src/main/documents/document-job-service.ts
import { inkMask } from '../../core/pdf/content-box';
import { cropRects, splitOptionsFor } from '../../core/pdf/page-split';
import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import { paperDots, renderPiece } from '../../core/pdf/piece-fit';
import { pieceContent, pieceFields, pieceTemplate, shortFileName } from '../../core/pdf/piece-template';
import type { FieldsPrint } from '../../core/print-service';
import type { PrintFailureReason, PrintResult, PrintSource } from '../../core/types';
import { readImagePixelSize } from '../../shared/image-header';
import { type PaperSize, parsePaperKey } from '../../shared/paper-sizes';
import { MAX_PAGE_POINTS, POINTS_PER_INCH, type RenderImageType } from '../../shared/pdf-render-protocol';
import type { PrinterIssue } from '../../shared/printer-readiness';
import { type OpenedPdf, PdfRenderError } from '../pdf/pdf-render-host';
import { type PdfDocumentRenderer, type PieceStore, tooManyPagesIssue } from '../pdf/pdf-station';
import { type DocumentKind, sniffDocumentKind } from './document-kind';

/**
 * 收到的文件 → 一张张打出来：远程打印（6b）和局域网共享（6a）共用的通道。
 *
 * 文件不可信：种类按文件头认，图片先读文件头挡住太大的，解码和渲染都在独立的 sandbox 渲染页里（一次一份）；
 * 切块、放到纸上、转黑白用 PDF 打印的纯函数，位图存进 PDF 打印的缓存（打印记录能预览、重打 7 天）。
 * 打印逐张经 PrintService.printFields：照常决定打印机、进打印队列、写打印记录。
 */

/** 裁切方式：整页 / 去白边 / 一页多张（PDF 打印的手动框选不开放给收到的文件）。 */
export const DOCUMENT_CROPS = ['page', 'trim', 'split'] as const;
export type DocumentCrop = (typeof DOCUMENT_CROPS)[number];

/** 图片最多 5000 万像素：主流手机 4800 万像素的照片能打；解码成 RGBA 约 200MB，sandbox 渲染页扛得住。 */
export const MAX_DOCUMENT_IMAGE_PIXELS = 50_000_000;
/** PDF 按阈值转黑白（文字、条码边缘干净）；照片按抖动（热敏纸没有灰色，抖动才看得出层次）。 */
const PDF_THRESHOLD = 128;
/** 中文按「万」说像素数。 */
const PIXELS_PER_WAN = 10_000;

export const DOCUMENT_ISSUES = {
  notDocument: '只能打印 PDF、JPEG、PNG 文件',
  badPaper: '电脑上没有这种纸：刷新页面重新选纸张',
  unreadableImage: '认不出这张图片：重新导出成 JPEG 或 PNG 再试',
  imageTooLarge: `图片太大（超过 ${MAX_DOCUMENT_IMAGE_PIXELS / PIXELS_PER_WAN} 万像素或边长超过 ${MAX_PAGE_POINTS} 像素）：缩小后再试`,
  empty: '这个文件里没有要打的内容（每页都是空白）',
  failed: '处理这个文件时出错：详细原因已写入电脑的日志',
} as const;

export function tooManyLabelsIssue(labels: number, max: number): string {
  return `这个文件要打 ${labels} 张，一次最多 ${max} 张：拆成几次再打`;
}

/** 渲染页这一端：PDF 打印的 PdfRenderHost（自己的一个实例；openImage 是 6a 加的，签名和它一致）。 */
export interface DocumentRenderer extends PdfDocumentRenderer {
  openImage(data: Uint8Array, type: RenderImageType): Promise<OpenedPdf>;
}

export interface DocumentPrintRequest {
  /** 文件名（只用于打印记录）和原始字节。 */
  document: { name: string; bytes: Uint8Array };
  paperKey: string;
  crop: DocumentCrop;
  copies: number;
  /** 这一份最多打几张（块数 × 份数）；超过就整份不打。 */
  maxLabels: number;
  source: PrintSource;
  /** 写进打印记录的提交方，例如 remote:北京仓 · 张三。 */
  caller: string;
  /** 取消（撤销共享、移除设备）：在两张之间停下。 */
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}

export interface LabelFailure {
  reason: PrintFailureReason;
  issue: PrinterIssue | null;
}

export type DocumentOutcome =
  | { status: 'sent'; labels: number }
  | { status: 'partial'; sent: number; total: number; failure: LabelFailure }
  | { status: 'failed'; failure: LabelFailure }
  | { status: 'no-printer' }
  | { status: 'invalid'; issue: string }
  | { status: 'canceled'; sent: number };

export interface DocumentJobServiceDeps {
  renderer: DocumentRenderer;
  pieces: PieceStore;
  /** 这种纸会打到的那台打印机的分辨率（没有打印机时按 203dpi）。 */
  dpiFor: (paper: PaperSize) => Promise<number>;
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 写了打印记录：界面刷新记录列表。 */
  onJobsChanged: () => void;
  log: (line: string) => void;
}

interface StoredPiece {
  page: number;
  piece: number;
  key: string;
}

type LayOut = { status: 'ok'; pieces: StoredPiece[] } | { status: 'invalid'; issue: string };

export class DocumentJobService {
  /** 渲染一次只做一份：渲染页一次只开一个文档。打印不在这条链上。 */
  private rendering: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(private readonly deps: DocumentJobServiceDeps) {}

  /** 还没打的张数：有的时候不静默更新。 */
  get pendingLabels(): number {
    return this.pending;
  }

  async print(request: DocumentPrintRequest): Promise<DocumentOutcome> {
    const { bytes } = request.document;
    const kind = sniffDocumentKind(bytes);
    if (kind === null) {
      return invalid(DOCUMENT_ISSUES.notDocument);
    }
    const paper = parsePaperKey(request.paperKey);
    if (paper === null) {
      return invalid(DOCUMENT_ISSUES.badPaper);
    }
    if (kind !== 'pdf') {
      const size = readImagePixelSize(bytes);
      if (size === null) {
        return invalid(DOCUMENT_ISSUES.unreadableImage);
      }
      if (
        size.width * size.height > MAX_DOCUMENT_IMAGE_PIXELS ||
        Math.max(size.width, size.height) > MAX_PAGE_POINTS
      ) {
        return invalid(DOCUMENT_ISSUES.imageTooLarge);
      }
    }
    let laidOut: LayOut;
    try {
      laidOut = await this.exclusive(() => this.layOut(kind, request, paper));
    } catch (error) {
      return invalid(this.issueOf(error));
    }
    if (laidOut.status === 'invalid') {
      return laidOut;
    }
    return this.printPieces(laidOut.pieces, request, paper);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.rendering.then(task, task);
    this.rendering = run.catch(() => undefined);
    return run;
  }

  /** 逐页渲染、切块、存缓存；算出总张数，超过上限就全删掉、整份不打。 */
  private async layOut(kind: DocumentKind, request: DocumentPrintRequest, paper: PaperSize): Promise<LayOut> {
    const { renderer, pieces: store } = this.deps;
    const pieces: StoredPiece[] = [];
    let count = 0;
    try {
      const { bytes } = request.document;
      const opened =
        kind === 'pdf'
          ? await renderer.open(bytes)
          : await renderer.openImage(bytes, kind === 'png' ? 'image/png' : 'image/jpeg');
      if (opened.pageCount > PDF_LIMITS.pages) {
        return invalid(tooManyPagesIssue(opened.pageCount));
      }
      const dpi = await this.deps.dpiFor(paper);
      const dots = paperDots(paper, dpi);
      const mono = kind === 'pdf' ? 'threshold' : 'dither';
      for (const [index, size] of opened.pages.entries()) {
        if (request.signal.aborted) {
          break;
        }
        const page = index + 1;
        // PDF 按打印机的分辨率渲染；图片按原像素（1 像素 = 1 点，见 PdfRenderHost.openImage），再按纸缩放。
        const rendered = await renderer.render(page, size, kind === 'pdf' ? dpi : POINTS_PER_INCH);
        const rects = cropRects(request.crop, inkMask(rendered.image), splitOptionsFor(rendered.dpi), []);
        for (const [rectIndex, rect] of rects.entries()) {
          count += 1;
          // 超过上限之后只数不存：要告诉对方一共多少张，又不能把几千块都写进缓存。
          if (count * request.copies <= request.maxLabels) {
            const bitmap = renderPiece(rendered.image, rect, { dots, mono, threshold: PDF_THRESHOLD });
            pieces.push({ page, piece: rectIndex + 1, key: await store.save(bitmap) });
          }
        }
      }
    } catch (error) {
      await store.remove(pieces.map((piece) => piece.key));
      throw error;
    } finally {
      renderer.close();
    }
    if (count * request.copies > request.maxLabels) {
      await store.remove(pieces.map((piece) => piece.key));
      return invalid(tooManyLabelsIssue(count * request.copies, request.maxLabels));
    }
    return pieces.length === 0 ? invalid(DOCUMENT_ISSUES.empty) : { status: 'ok', pieces };
  }

  /** 按顺序打，每块 copies 份；出问题就停下，没打过的块从缓存里删掉（打过的留着：打印记录指着它们）。 */
  private async printPieces(
    pieces: StoredPiece[],
    request: DocumentPrintRequest,
    paper: PaperSize,
  ): Promise<DocumentOutcome> {
    const total = pieces.length * request.copies;
    const fileName = shortFileName(request.document.name);
    const printedKeys = new Set<string>();
    let sent = 0;
    this.pending += total;
    const finish = async (outcome: DocumentOutcome): Promise<DocumentOutcome> => {
      this.pending -= total - sent;
      await this.deps.pieces.remove(pieces.map((piece) => piece.key).filter((key) => !printedKeys.has(key)));
      return outcome;
    };
    request.onProgress(0, total);
    for (const piece of pieces) {
      for (let copy = 0; copy < request.copies; copy += 1) {
        if (request.signal.aborted) {
          return finish({ status: 'canceled', sent });
        }
        const bitmap = await this.deps.pieces.load(piece.key);
        if (bitmap === null) {
          this.deps.log(`[documents] piece ${piece.key} is missing from the cache`);
          return finish(this.stopped(sent, total, { reason: 'PRINT_ERROR', issue: null }));
        }
        const result = await this.deps.printFields({
          template: pieceTemplate(bitmap, paper),
          fields: pieceFields(fileName, piece.page, piece.piece),
          content: pieceContent(fileName, piece.page, piece.piece),
          source: request.source,
          caller: request.caller,
          printerName: null,
          pdf: { file: fileName, page: piece.page, piece: piece.piece, bitmap: piece.key },
        });
        this.deps.onJobsChanged();
        if (result.status === 'no-printer') {
          return finish(sent === 0 ? { status: 'no-printer' } : this.stopped(sent, total, notFound()));
        }
        if (result.status !== 'printed') {
          const failure: LabelFailure =
            result.status === 'failed'
              ? { reason: result.reason, issue: result.issue ?? null }
              : { reason: 'PRINT_ERROR', issue: null };
          return finish(this.stopped(sent, total, failure));
        }
        printedKeys.add(piece.key);
        sent += 1;
        this.pending -= 1;
        request.onProgress(sent, total);
      }
    }
    return finish({ status: 'sent', labels: sent });
  }

  private stopped(sent: number, total: number, failure: LabelFailure): DocumentOutcome {
    return sent === 0 ? { status: 'failed', failure } : { status: 'partial', sent, total, failure };
  }

  /** 渲染页的错误已经有中文原因（并已写日志）；其他意外写日志，给一句通用的。 */
  private issueOf(error: unknown): string {
    if (error instanceof PdfRenderError) {
      return error.issue;
    }
    this.deps.log(`[documents] failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return DOCUMENT_ISSUES.failed;
  }
}

function invalid(issue: string): { status: 'invalid'; issue: string } {
  return { status: 'invalid', issue };
}

/** 打到一半纸张分配被改掉了：按「找不到打印机」说明后面的为什么没打。 */
function notFound(): LabelFailure {
  return { reason: 'PRINTER_NOT_FOUND', issue: null };
}
```

（`finish` 里 `this.pending -= total - sent` 只减还没减掉的部分：每打一张已经减过 1。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/documents`
Expected: PASS。`tooManyLabelsIssue(24, 20)`：两页各 4 块、每块 3 份。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/documents
git commit -m "feat(documents): print received PDFs and images through one checked path" -m "Remote printing and LAN sharing both turn a received file into labels. The kind is taken from the file header, oversized images are refused from their header alone, and rendering happens one document at a time in its own sandboxed render page. Pieces reuse the PDF printing cache and are printed one by one through printFields; a printer problem stops the job and says how far it got, and a canceled job stops between labels. Pieces that were never printed are dropped from the cache." -m "$TRAILER"
```

---

### Task 9: core：共享的限制、模板字段的清洗、规则名「远程打印」

**Files:**
- Create: `src/core/remote/share-model.ts`、`src/core/remote/share-model.test.ts`
- Create: `src/core/remote/remote-fields.ts`、`src/core/remote/remote-fields.test.ts`
- Modify: `src/core/print-service.ts`、`src/core/print-service.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/remote/share-model.test.ts
import { describe, expect, test } from 'bun:test';
import {
  MS_PER_DAY,
  normalizeShareName,
  parseShareDraft,
  parseSharePatch,
  REMOTE_SHARE_LIMITS,
  shareExpiresAt,
} from './share-model';

const DRAFT = { name: '北京仓', expiresInDays: 7, templateIds: ['custom:tag-1'], approveNewDevices: true };

describe('share drafts', () => {
  test('accepts a name, an expiry, the shared templates and whether new devices need approval', () => {
    expect(parseShareDraft(DRAFT)).toEqual(DRAFT);
    expect(parseShareDraft({ ...DRAFT, expiresInDays: null, templateIds: [] })).toEqual({
      ...DRAFT,
      expiresInDays: null,
      templateIds: [],
    });
  });

  test('refuses anything else', () => {
    expect(parseShareDraft({ ...DRAFT, expiresInDays: 3 })).toBeNull();
    expect(parseShareDraft({ ...DRAFT, name: '' })).toBeNull();
    expect(parseShareDraft({ ...DRAFT, name: '一'.repeat(REMOTE_SHARE_LIMITS.nameLength + 1) })).toBeNull();
    expect(parseShareDraft({ ...DRAFT, templateIds: ['tag-1'] })).toBeNull();
    expect(parseShareDraft({ ...DRAFT, templateIds: ['custom:a', 'custom:a'] })).toBeNull();
    const many = Array.from({ length: REMOTE_SHARE_LIMITS.templates + 1 }, (_, index) => `custom:t${index}`);
    expect(parseShareDraft({ ...DRAFT, templateIds: many })).toBeNull();
    expect(parseShareDraft({ ...DRAFT, approveNewDevices: 'yes' })).toBeNull();
  });

  test('cleans a name of invisible characters before checking it', () => {
    expect(normalizeShareName('  北京‮仓\n ')).toBe('北京仓');
    expect(normalizeShareName('​')).toBeNull();
    expect(normalizeShareName(42)).toBeNull();
  });

  test('a patch changes only what it names', () => {
    expect(parseSharePatch({ name: '上海仓' })).toEqual({ name: '上海仓' });
    expect(parseSharePatch({ approveNewDevices: false })).toEqual({ approveNewDevices: false });
    expect(parseSharePatch({})).toBeNull();
    expect(parseSharePatch({ expiresInDays: 1 })).toBeNull();
  });

  test('works out when a share expires', () => {
    expect(shareExpiresAt(1_000, 7)).toBe(1_000 + 7 * MS_PER_DAY);
    expect(shareExpiresAt(1_000, null)).toBeNull();
  });
});
```

```ts
// src/core/remote/remote-fields.test.ts
import { describe, expect, test } from 'bun:test';
import { builtInCanvasTemplate } from '../testing/templates';
import { cleanFieldValue, prepareRemoteFields, REMOTE_FIELD_ISSUES } from './remote-fields';

describe('cleanFieldValue', () => {
  test('keeps line breaks and drops other control and format characters', () => {
    expect(cleanFieldValue(' 短袖\r\nT恤\u0007‮ ')).toBe('短袖\nT恤');
    expect(cleanFieldValue('\u0000')).toBe('');
  });
});

describe('prepareRemoteFields', () => {
  test('takes only the fields the template asks for', () => {
    const template = builtInCanvasTemplate(['品名', '价格']);
    expect(prepareRemoteFields(template, [{ name: '品名', value: '短袖' }])).toEqual({
      ok: true,
      fields: [{ name: '品名', value: '短袖' }],
      content: '品名：短袖',
    });
    expect(prepareRemoteFields(template, [{ name: '货架号', value: 'A-1' }])).toEqual({
      ok: false,
      issue: REMOTE_FIELD_ISSUES.notInTemplate('货架号'),
    });
  });

  test('needs at least one value', () => {
    const template = builtInCanvasTemplate(['品名']);
    expect(prepareRemoteFields(template, [{ name: '品名', value: ' \u0007 ' }])).toEqual({
      ok: false,
      issue: REMOTE_FIELD_ISSUES.empty,
    });
  });
});
```

`builtInCanvasTemplate(names)`：在 `src/core/testing/templates.ts` 里加一个测试用的工厂（文件里已有类似的工厂就用它）：一张 60×40 的自由设计模板，每个字段名一个文字元素，内容 `{字段名}`。

```ts
/** 测试用：每个字段一个文字元素的自由设计模板（模板要的字段就是这几个）。 */
export function builtInCanvasTemplate(fieldNames: readonly string[]): CanvasTemplate {
  return {
    kind: 'canvas',
    id: 'custom:test-canvas',
    name: '测试',
    paper: { widthMm: 60, heightMm: 40 },
    printer: null,
    elements: fieldNames.map((name, index) => ({
      ...defaultCanvasElement('text', `t${index}`),
      text: `{${name}}`,
    })),
  };
}
```

（`defaultCanvasElement` 是 1a 在 `canvas-model.ts` 里给每类元素的默认值；名字不同时按 `canvas-model.ts` 里实际导出的那个写，或者照 `builtin-canvas.ts` 里文字元素的样子写全字段。）

`src/core/print-service.test.ts` 的 `describe('fieldsRuleFor')` 里加：

```ts
  test('names remote prints after remote printing, even for a piece of a received PDF', () => {
    const pdf = { file: 'a.pdf', page: 1, piece: 1, bitmap: 'k' };
    expect(fieldsRuleFor({ source: 'remote' })).toBe(REMOTE_RULE);
    expect(fieldsRuleFor({ source: 'remote', pdf })).toBe(REMOTE_RULE);
    expect(fieldsRuleFor({ source: 'pdf', pdf })).toBe(PDF_RULE);
  });
```

（import 加 `REMOTE_RULE`。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/remote src/core/print-service.test.ts`
Expected: FAIL（模块不存在；`REMOTE_RULE` 没有导出）。

- [ ] **Step 3: 实现**

```ts
// src/core/remote/share-model.ts
import { TEMPLATE_ID_PATTERN } from '../templates/template-model';

/**
 * 异地远程打印的共享：名字、有效期、共享出去的模板、新设备要不要先经电脑确认。
 * 界面交来的都经这里严格校验（IPC 是信任边界），任何一项不对整个拒绝。
 */
export const REMOTE_SHARE_LIMITS = {
  /** 每个共享在中转服务上是一条常连的连接：5 个够分给几家分店和客户，一家店的连接数也远低于中转服务每个 IP 的上限。 */
  shares: 5,
  /** 名字最多 20 个字：打印记录里写在对方名字前面。 */
  nameLength: 20,
  /** 每个共享最多共享 20 个模板（和远程协议的目录上限一致）。 */
  templates: 20,
} as const;

/** 有效期的选项（天）；null = 不过期（随时可以撤销）。 */
export const SHARE_EXPIRY_DAYS = [1, 7, 30] as const;
export type ShareExpiryDays = (typeof SHARE_EXPIRY_DAYS)[number];
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ShareDraft {
  name: string;
  expiresInDays: ShareExpiryDays | null;
  templateIds: string[];
  approveNewDevices: boolean;
}

/** 已有共享能改的：名字、共享的模板、要不要确认新设备（有效期不能改：要延期就新建一个）。 */
export interface SharePatch {
  name?: string;
  templateIds?: string[];
  approveNewDevices?: boolean;
}

const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** 去掉看不见的字符和首尾空白；空的、超长的不收（这是操作员自己填的，不替他截断）。 */
export function normalizeShareName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = value.replace(UNSAFE_NAME_CHARACTERS, '').trim();
  return name !== '' && Array.from(name).length <= REMOTE_SHARE_LIMITS.nameLength ? name : null;
}

export function parseShareDraft(value: unknown): ShareDraft | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = normalizeShareName(value['name']);
  const expiresInDays = value['expiresInDays'];
  const templateIds = parseTemplateIds(value['templateIds']);
  const approveNewDevices = value['approveNewDevices'];
  if (
    name === null ||
    !(expiresInDays === null || (SHARE_EXPIRY_DAYS as readonly unknown[]).includes(expiresInDays)) ||
    templateIds === null ||
    typeof approveNewDevices !== 'boolean'
  ) {
    return null;
  }
  return { name, expiresInDays: expiresInDays as ShareExpiryDays | null, templateIds, approveNewDevices };
}

export function parseSharePatch(value: unknown): SharePatch | null {
  if (!isRecord(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !['name', 'templateIds', 'approveNewDevices'].includes(key))) {
    return null;
  }
  const patch: SharePatch = {};
  if ('name' in value) {
    const name = normalizeShareName(value['name']);
    if (name === null) {
      return null;
    }
    patch.name = name;
  }
  if ('templateIds' in value) {
    const templateIds = parseTemplateIds(value['templateIds']);
    if (templateIds === null) {
      return null;
    }
    patch.templateIds = templateIds;
  }
  if ('approveNewDevices' in value) {
    if (typeof value['approveNewDevices'] !== 'boolean') {
      return null;
    }
    patch.approveNewDevices = value['approveNewDevices'];
  }
  return patch;
}

/** 从创建时间和有效期算到期时间；不过期为 null。 */
export function shareExpiresAt(createdAt: number, days: number | null): number | null {
  return days === null ? null : createdAt + days * MS_PER_DAY;
}

function parseTemplateIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > REMOTE_SHARE_LIMITS.templates) {
    return null;
  }
  const ids = value.filter((id): id is string => typeof id === 'string' && TEMPLATE_ID_PATTERN.test(id));
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

```ts
// src/core/remote/remote-fields.ts
import { templateFields } from '../api/template-fields';
import { contentOf } from '../api/api-model';
import type { ScanField } from '../scan/scan-result';
import type { LabelTemplate } from '../templates/template-model';

/**
 * 远程打印页填的模板字段：外部输入，打印前在电脑上再清洗一遍。
 * 只收这个模板点名要的字段（「全部字段」模式的模板收任意合法字段名，名字已由协议校验）；
 * 值去掉控制字符和格式字符（双向文字控制符会让显示被反转），只留换行。条码、二维码不合码制的内容由画法拦下（不印并写日志）。
 */
export const REMOTE_FIELD_ISSUES = {
  empty: '至少填一个字段',
  notInTemplate: (name: string) => `「${name}」不是这个模板的字段：刷新页面再填`,
} as const;

/** 换行以外的控制字符、格式字符、行和段分隔符。 */
const UNSAFE_VALUE_CHARACTERS = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const LINE_BREAKS = /\r\n?/g;

export function cleanFieldValue(value: string): string {
  return value.replace(LINE_BREAKS, '\n').replace(UNSAFE_VALUE_CHARACTERS, '').trim();
}

export type RemoteFieldsOutcome = { ok: true; fields: ScanField[]; content: string } | { ok: false; issue: string };

export function prepareRemoteFields(
  template: LabelTemplate,
  fields: readonly { name: string; value: string }[],
): RemoteFieldsOutcome {
  const wanted = templateFields(template);
  const cleaned: ScanField[] = [];
  for (const field of fields) {
    if (wanted.mode === 'PICKED' && !wanted.names.includes(field.name)) {
      return { ok: false, issue: REMOTE_FIELD_ISSUES.notInTemplate(field.name) };
    }
    const value = cleanFieldValue(field.value);
    if (value !== '') {
      cleaned.push({ name: field.name, value });
    }
  }
  if (cleaned.length === 0) {
    return { ok: false, issue: REMOTE_FIELD_ISSUES.empty };
  }
  return { ok: true, fields: cleaned, content: contentOf({ fields: cleaned, content: null }) };
}
```

`src/core/print-service.ts`：`PDF_RULE` 之后加 `REMOTE_RULE`，`fieldsRuleFor` 先看来源：

```ts
/** 远程打印的「规则」：远程打的文件和模板都显示为「远程打印」。 */
export const REMOTE_RULE = { id: 'remote', name: '远程打印' } as const;

/**
 * 不经过识别规则的一张算在哪条「规则」名下：来源是远程的都是远程打印（远程传来的 PDF 也带着 PDF 的位图编号，先认来源）；
 * 其次局域网共享、批量、PDF；其余是本机接口。
 */
export function fieldsRuleFor(origin: {
  source?: unknown;
  ipp?: unknown;
  batch?: unknown;
  pdf?: unknown;
}): FieldsRule {
  if (origin.source === 'remote') {
    return REMOTE_RULE;
  }
  if (origin.ipp !== undefined) {
    return IPP_RULE;
  }
  if (origin.batch !== undefined) {
    return BATCH_RULE;
  }
  if (origin.pdf !== undefined) {
    return PDF_RULE;
  }
  return API_RULE;
}
```

（上面是 6a 合进来之后的样子：参数里的 `ipp` 和 `IPP_RULE` 是 6a 加的，本任务只在最前面加 `source === 'remote'` 这一项和 `REMOTE_RULE`。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/core`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/remote src/core/print-service.ts src/core/print-service.test.ts src/core/testing/templates.ts
git commit -m "feat(remote): share limits, field cleaning and the remote printing rule name" -m "Share drafts and patches from the page are parsed strictly. Fields filled on the remote page are taken only if the shared template asks for them, and control and bidi format characters are stripped before printing. Remote prints, files and templates alike, are recorded under the rule name remote printing." -m "$TRAILER"
```

---

### Task 10: 存储：远程共享和设备（迁移 N）

共享的会话号、所有权密钥、内容密钥都是凭证：密钥部分用 `safeStorage` 加密成一个字段存；设备令牌只存 SHA-256。迁移只新建两张表，不动 jobs。

**Files:**
- Modify: `src/main/storage/migrations.ts`、`src/main/storage/database.test.ts`
- Create: `src/main/storage/sqlite-remote-share-store.ts`、`src/main/storage/sqlite-remote-share-store.test.ts`
- Create: `src/main/remote/device-registry.ts`、`src/main/remote/device-registry.test.ts`

- [ ] **Step 1: 写测试**

`database.test.ts` 末尾加（`N` 写成实施时的编号，例如 9；`MIGRATIONS.slice(0, N - 1)` 就是这一条之前的）：

```ts
describe('migration N', () => {
  test('adds remote shares and their devices, and drops the devices with their share', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "INSERT INTO remote_shares (id, name, session_id, secrets, templates, approve_new, created_at, expires_at) VALUES ('s', '北京仓', 'sess', x'00', '[]', 1, 1, NULL)",
    ).run();
    db.prepare(
      "INSERT INTO remote_devices (share_id, id, token_hash, label, approved_at, last_seen_at) VALUES ('s', 'd', 'h', '张三', 1, 1)",
    ).run();
    db.prepare("DELETE FROM remote_shares WHERE id = 's'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM remote_devices').get()?.['n']).toBe(0);
    db.close();
  });
});
```

```ts
// src/main/storage/sqlite-remote-share-store.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { FakeClock } from '../../core/testing/fake-clock';
import { openDatabase } from './database';
import { SecretError, type SecretCipher } from './sqlite-secret-store';
import { type StoredShare, SqliteRemoteShareStore } from './sqlite-remote-share-store';

/** 假的系统加密：加个前缀，看得出存进去的不是原文。 */
const CIPHER: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => new TextEncoder().encode(`enc:${plain}`),
  decrypt: (data) => {
    const text = new TextDecoder().decode(data);
    if (!text.startsWith('enc:')) {
      throw new Error('not ours');
    }
    return text.slice('enc:'.length);
  },
};

const SHARE: StoredShare = {
  id: 'share-1',
  name: '北京仓',
  sessionId: 'session-1',
  ownerSecret: 'owner-secret',
  key: 'content-key',
  templateIds: ['custom:tag-1'],
  approveNewDevices: true,
  createdAt: 1_000,
  expiresAt: null,
};

let db: DatabaseSync;
let clock: FakeClock;

beforeEach(() => {
  db = openDatabase(':memory:');
  clock = new FakeClock();
});

afterEach(() => db.close());

describe('SqliteRemoteShareStore', () => {
  test('keeps a share and reads it back, with its keys encrypted on disk', () => {
    const store = new SqliteRemoteShareStore(db, CIPHER, clock, () => undefined);
    store.insert(SHARE);
    expect(store.list()).toEqual([SHARE]);
    const raw = db.prepare('SELECT secrets FROM remote_shares').get()?.['secrets'];
    expect(new TextDecoder().decode(raw as Uint8Array)).not.toContain('"content-key"');
  });

  test('refuses to create a share when the system cannot encrypt', () => {
    const store = new SqliteRemoteShareStore(db, { ...CIPHER, isAvailable: () => false }, clock, () => undefined);
    expect(() => store.insert(SHARE)).toThrow(SecretError);
  });

  test('skips a share whose keys cannot be decrypted on this computer', () => {
    const logs: string[] = [];
    new SqliteRemoteShareStore(db, CIPHER, clock, () => undefined).insert(SHARE);
    const other = new SqliteRemoteShareStore(db, { ...CIPHER, decrypt: () => { throw new Error('other user'); } }, clock, (line) => logs.push(line));
    expect(other.list()).toEqual([]);
    expect(logs.join('\n')).toContain('share-1');
  });

  test('changes the name, templates and approval of a share', () => {
    const store = new SqliteRemoteShareStore(db, CIPHER, clock, () => undefined);
    store.insert(SHARE);
    store.update('share-1', { name: '上海仓', templateIds: [], approveNewDevices: false });
    expect(store.list()[0]).toMatchObject({ name: '上海仓', templateIds: [], approveNewDevices: false });
  });

  test('keeps devices per share and forgets them with the share', () => {
    const store = new SqliteRemoteShareStore(db, CIPHER, clock, () => undefined);
    store.insert(SHARE);
    store.addDevice({ shareId: 'share-1', id: 'd1', tokenHash: 'h1', label: '张三', approvedAt: 5, lastSeenAt: 5 });
    expect(store.devices('share-1')).toEqual([
      { shareId: 'share-1', id: 'd1', tokenHash: 'h1', label: '张三', approvedAt: 5, lastSeenAt: 5 },
    ]);
    store.remove('share-1');
    expect(store.devices('share-1')).toEqual([]);
  });

  test('writes when a device was last seen at most once a minute', () => {
    const store = new SqliteRemoteShareStore(db, CIPHER, clock, () => undefined);
    store.insert(SHARE);
    store.addDevice({ shareId: 'share-1', id: 'd1', tokenHash: 'h1', label: '张三', approvedAt: 5, lastSeenAt: 5 });
    store.touchDevice('share-1', 'd1', '张三 · 电脑');
    clock.advance(1_000);
    store.touchDevice('share-1', 'd1', '张三 · 手机');
    expect(store.devices('share-1')[0]).toMatchObject({ label: '张三 · 电脑', lastSeenAt: clock.now() - 1_000 });
  });
});
```

```ts
// src/main/remote/device-registry.test.ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import type { StoredDevice } from '../storage/sqlite-remote-share-store';
import { type DeviceStore, StoreDeviceRegistry } from './device-registry';

class MemoryDevices implements DeviceStore {
  readonly rows: StoredDevice[] = [];
  devices(shareId: string): StoredDevice[] {
    return this.rows.filter((row) => row.shareId === shareId);
  }
  addDevice(device: StoredDevice): void {
    this.rows.push(device);
  }
  touchDevice(): void {}
  removeDevice(shareId: string, id: string): void {
    const index = this.rows.findIndex((row) => row.shareId === shareId && row.id === id);
    this.rows.splice(index, 1);
  }
}

describe('StoreDeviceRegistry', () => {
  test('hands out a token, keeps only its digest and finds the device by it', () => {
    const store = new MemoryDevices();
    const registry = new StoreDeviceRegistry(store, 'share-1', new FakeClock());
    const { device, token } = registry.add('张三 · 电脑 · Edge');
    expect(store.rows[0]?.tokenHash).not.toContain(token);
    expect(registry.find(token)).toEqual(device);
    expect(registry.find(`${token.slice(0, -1)}A`)).toBeNull();
  });

  test('forgets a removed device: its token no longer works', () => {
    const registry = new StoreDeviceRegistry(new MemoryDevices(), 'share-1', new FakeClock());
    const { device, token } = registry.add('张三');
    registry.remove(device.id);
    expect(registry.find(token)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/storage src/main/remote/device-registry.test.ts`
Expected: FAIL（表不存在；模块不存在）。

- [ ] **Step 3: 实现**

`src/main/storage/migrations.ts` 末尾追加（`N` 是这一条的序号）：

```ts
  // N：异地远程打印的共享和设备。secrets 是 safeStorage 加密后的 JSON（所有权密钥、内容密钥），templates 是共享的模板编号（JSON 数组）；
  // 设备令牌只存 SHA-256。删掉共享时设备一起删（撤销、到期）。
  `
  CREATE TABLE remote_shares (
    id           TEXT    PRIMARY KEY,
    name         TEXT    NOT NULL,
    session_id   TEXT    NOT NULL UNIQUE,
    secrets      BLOB    NOT NULL,
    templates    TEXT    NOT NULL,
    approve_new  INTEGER NOT NULL CHECK (approve_new IN (0, 1)),
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER
  ) STRICT;

  CREATE TABLE remote_devices (
    share_id     TEXT    NOT NULL REFERENCES remote_shares (id) ON DELETE CASCADE,
    id           TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL,
    label        TEXT    NOT NULL,
    approved_at  INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (share_id, id)
  ) STRICT, WITHOUT ROWID;
  `,
```

```ts
// src/main/storage/sqlite-remote-share-store.ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { SharePatch } from '../../core/remote/share-model';
import { TEMPLATE_ID_PATTERN } from '../../core/templates/template-model';
import type { Clock } from '../../core/types';
import { type Row, readInteger, readString } from './row-readers';
import { type SecretCipher, SecretError } from './sqlite-secret-store';

/** 设备最后在线时间最多每分钟写一次：每次重连都会碰到，界面只要大概的时间。 */
export const DEVICE_TOUCH_INTERVAL_MS = 60_000;

/** 一个远程共享：会话号、所有权密钥、内容密钥是凭证（后两样加密存）。 */
export interface StoredShare {
  id: string;
  name: string;
  sessionId: string;
  ownerSecret: string;
  key: string;
  templateIds: string[];
  approveNewDevices: boolean;
  createdAt: number;
  expiresAt: number | null;
}

export interface StoredDevice {
  shareId: string;
  id: string;
  /** 令牌的 SHA-256（十六进制）。 */
  tokenHash: string;
  label: string;
  approvedAt: number;
  lastSeenAt: number;
}

/** remote_shares、remote_devices 两张表。读出的行照样校验，解不开的共享跳过并记日志（数据库被拷到别的电脑、别的用户）。 */
export class SqliteRemoteShareStore {
  private readonly selectShares: StatementSync;
  private readonly insertShare: StatementSync;
  private readonly deleteShare: StatementSync;
  private readonly selectDevices: StatementSync;
  private readonly insertDevice: StatementSync;
  private readonly updateDevice: StatementSync;
  private readonly deleteDevice: StatementSync;
  private readonly touchedAt = new Map<string, number>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly cipher: SecretCipher,
    private readonly clock: Clock,
    private readonly log: (line: string) => void,
  ) {
    this.selectShares = db.prepare(`
      SELECT id, name, session_id AS sessionId, secrets, templates, approve_new AS approveNew,
        created_at AS createdAt, expires_at AS expiresAt
      FROM remote_shares ORDER BY created_at, id`);
    this.insertShare = db.prepare(`
      INSERT INTO remote_shares (id, name, session_id, secrets, templates, approve_new, created_at, expires_at)
      VALUES (:id, :name, :sessionId, :secrets, :templates, :approveNew, :createdAt, :expiresAt)`);
    this.deleteShare = db.prepare('DELETE FROM remote_shares WHERE id = :id');
    this.selectDevices = db.prepare(`
      SELECT share_id AS shareId, id, token_hash AS tokenHash, label, approved_at AS approvedAt, last_seen_at AS lastSeenAt
      FROM remote_devices WHERE share_id = :shareId ORDER BY approved_at, id`);
    this.insertDevice = db.prepare(`
      INSERT INTO remote_devices (share_id, id, token_hash, label, approved_at, last_seen_at)
      VALUES (:shareId, :id, :tokenHash, :label, :approvedAt, :lastSeenAt)`);
    this.updateDevice = db.prepare(
      'UPDATE remote_devices SET label = :label, last_seen_at = :now WHERE share_id = :shareId AND id = :id',
    );
    this.deleteDevice = db.prepare('DELETE FROM remote_devices WHERE share_id = :shareId AND id = :id');
  }

  list(): StoredShare[] {
    return this.selectShares.all().flatMap((row) => {
      const share = this.toShare(row);
      return share === null ? [] : [share];
    });
  }

  insert(share: StoredShare): void {
    if (!this.cipher.isAvailable()) {
      throw new SecretError('这台电脑的系统加密不可用，不能创建远程共享');
    }
    this.insertShare.run({
      id: share.id,
      name: share.name,
      sessionId: share.sessionId,
      secrets: this.cipher.encrypt(JSON.stringify({ ownerSecret: share.ownerSecret, key: share.key })),
      templates: JSON.stringify(share.templateIds),
      approveNew: share.approveNewDevices ? 1 : 0,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    });
  }

  update(id: string, patch: SharePatch): void {
    // 三项分开写：改哪项写哪项，不覆盖别的。
    if (patch.name !== undefined) {
      this.db.prepare('UPDATE remote_shares SET name = :name WHERE id = :id').run({ id, name: patch.name });
    }
    if (patch.templateIds !== undefined) {
      this.db
        .prepare('UPDATE remote_shares SET templates = :templates WHERE id = :id')
        .run({ id, templates: JSON.stringify(patch.templateIds) });
    }
    if (patch.approveNewDevices !== undefined) {
      this.db
        .prepare('UPDATE remote_shares SET approve_new = :approveNew WHERE id = :id')
        .run({ id, approveNew: patch.approveNewDevices ? 1 : 0 });
    }
  }

  /** 撤销、到期：共享和它的设备一起删（外键 ON DELETE CASCADE）。 */
  remove(id: string): void {
    this.deleteShare.run({ id });
  }

  devices(shareId: string): StoredDevice[] {
    return this.selectDevices.all({ shareId }).map(toDevice);
  }

  addDevice(device: StoredDevice): void {
    this.insertDevice.run({ ...device });
  }

  touchDevice(shareId: string, id: string, label: string): void {
    const now = this.clock.now();
    const key = `${shareId}/${id}`;
    const last = this.touchedAt.get(key);
    if (last !== undefined && now - last < DEVICE_TOUCH_INTERVAL_MS) {
      return;
    }
    this.touchedAt.set(key, now);
    this.updateDevice.run({ shareId, id, label, now });
  }

  removeDevice(shareId: string, id: string): void {
    this.deleteDevice.run({ shareId, id });
    this.touchedAt.delete(`${shareId}/${id}`);
  }

  private toShare(row: Row): StoredShare | null {
    const id = readString(row, 'id');
    const secrets = row['secrets'];
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.cipher.decrypt(secrets instanceof Uint8Array ? secrets : new Uint8Array()));
    } catch (error) {
      this.log(`[remote] share ${id} cannot be decrypted on this computer, skipped: ${String(error)}`);
      return null;
    }
    const ownerSecret = (parsed as { ownerSecret?: unknown }).ownerSecret;
    const key = (parsed as { key?: unknown }).key;
    if (typeof ownerSecret !== 'string' || typeof key !== 'string') {
      this.log(`[remote] share ${id} has malformed keys, skipped`);
      return null;
    }
    let templates: unknown;
    try {
      templates = JSON.parse(readString(row, 'templates'));
    } catch {
      templates = [];
    }
    return {
      id,
      name: readString(row, 'name'),
      sessionId: readString(row, 'sessionId'),
      ownerSecret,
      key,
      templateIds: Array.isArray(templates)
        ? templates.filter((item): item is string => typeof item === 'string' && TEMPLATE_ID_PATTERN.test(item))
        : [],
      approveNewDevices: readInteger(row, 'approveNew') === 1,
      createdAt: readInteger(row, 'createdAt'),
      expiresAt: row['expiresAt'] === null ? null : readInteger(row, 'expiresAt'),
    };
  }
}

function toDevice(row: Row): StoredDevice {
  return {
    shareId: readString(row, 'shareId'),
    id: readString(row, 'id'),
    tokenHash: readString(row, 'tokenHash'),
    label: readString(row, 'label'),
    approvedAt: readInteger(row, 'approvedAt'),
    lastSeenAt: readInteger(row, 'lastSeenAt'),
  };
}
```

（`update` 里每次 `prepare` 是因为三条语句都很少用到；如果 Biome 或评审要求，挪进构造函数。）

```ts
// src/main/remote/device-registry.ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../core/types';
import { randomId } from '../../shared/mobile-crypto';
import type { StoredDevice } from '../storage/sqlite-remote-share-store';

/** 一台被接纳过的设备（远程打印页所在的浏览器）。 */
export interface RemoteDevice {
  id: string;
  label: string;
  approvedAt: number;
  lastSeenAt: number;
}

/** RemoteSession 用到的设备表（测试里换成内存的）。 */
export interface DeviceRegistry {
  /** 按令牌找设备：比较令牌的摘要，常数时间。 */
  find(token: string): RemoteDevice | null;
  /** 接纳一台新设备：发令牌（原文只在这里返回一次），只存摘要。 */
  add(label: string): { device: RemoteDevice; token: string };
  touch(id: string, label: string): void;
  remove(id: string): void;
  list(): RemoteDevice[];
}

/** SqliteRemoteShareStore 里设备表的那几个方法。 */
export interface DeviceStore {
  devices(shareId: string): StoredDevice[];
  addDevice(device: StoredDevice): void;
  touchDevice(shareId: string, id: string, label: string): void;
  removeDevice(shareId: string, id: string): void;
}

export class StoreDeviceRegistry implements DeviceRegistry {
  constructor(
    private readonly store: DeviceStore,
    private readonly shareId: string,
    private readonly clock: Clock,
  ) {}

  find(token: string): RemoteDevice | null {
    const digest = sha256(token);
    // 每台都比一遍，不在找到时提前返回：比较的次数和耗时不透露是第几台。
    let found: StoredDevice | null = null;
    for (const device of this.store.devices(this.shareId)) {
      const stored = Buffer.from(device.tokenHash, 'hex');
      if (stored.length === digest.length && timingSafeEqual(stored, digest)) {
        found = device;
      }
    }
    return found === null ? null : toDevice(found);
  }

  add(label: string): { device: RemoteDevice; token: string } {
    const token = randomId();
    const now = this.clock.now();
    const stored: StoredDevice = {
      shareId: this.shareId,
      id: randomId(),
      tokenHash: sha256(token).toString('hex'),
      label,
      approvedAt: now,
      lastSeenAt: now,
    };
    this.store.addDevice(stored);
    return { device: toDevice(stored), token };
  }

  touch(id: string, label: string): void {
    this.store.touchDevice(this.shareId, id, label);
  }

  remove(id: string): void {
    this.store.removeDevice(this.shareId, id);
  }

  list(): RemoteDevice[] {
    return this.store.devices(this.shareId).map(toDevice);
  }
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function toDevice(device: StoredDevice): RemoteDevice {
  return { id: device.id, label: device.label, approvedAt: device.approvedAt, lastSeenAt: device.lastSeenAt };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/storage src/main/remote`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/storage/migrations.ts src/main/storage/database.test.ts src/main/storage/sqlite-remote-share-store.ts src/main/storage/sqlite-remote-share-store.test.ts src/main/remote/device-registry.ts src/main/remote/device-registry.test.ts
git commit -m "feat(remote): store remote shares with encrypted keys and devices by token digest" -m "A migration adds two tables and leaves the job records alone. The owner secret and content key of a share are encrypted with safeStorage; a share that cannot be decrypted on this computer is skipped and logged. Device tokens are handed out once and only their SHA-256 is kept, compared in constant time; removing a share removes its devices." -m "$TRAILER"
```

---

### Task 11: 电脑端的会话规则 RemoteSession

一个共享一个 `RemoteSession`：设备加入（令牌、确认、在线上限）、防重放（`nonce` + `seq`）、任务表（按任务号去重、保存结果）、上传重组（`ChunkAssembler`、核 SHA-256、闲置丢弃）、背压（每台设备的未完成任务、每个共享每分钟的任务数、电脑上的文件内存预算）。纯逻辑，时间由 `Clock` 注入；排队位置由 Task 12 的队列算，这里只记下最近告诉对方的进度。

**Files:**
- Create: `src/main/remote/remote-session.ts`、`src/main/remote/remote-session.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/remote/remote-session.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { FakeClock } from '../../core/testing/fake-clock';
import { randomId } from '../../shared/mobile-crypto';
import { chunkAt, chunkCount } from '../../shared/remote-chunks';
import {
  REMOTE_CHUNK_BYTES,
  REMOTE_MAX_PENDING_JOBS,
  REMOTE_UPLOAD_IDLE_MS,
  type RemoteCatalog,
  type ViewerMessage,
} from '../../shared/remote-protocol';
import type { DeviceRegistry, RemoteDevice } from './device-registry';
import {
  ByteBudget,
  type HelloOutcome,
  MAX_PENDING_APPROVALS,
  REMOTE_JOBS_PER_MINUTE,
  RemoteSession,
} from './remote-session';

const CATALOG: RemoteCatalog = {
  papers: [{ key: '100x150', label: '100×150' }],
  templates: [{ id: 'custom:tag-1', name: '吊牌', paper: '60x40', fields: ['品名'] }],
};
const FILE = Uint8Array.from({ length: REMOTE_CHUNK_BYTES * 2.5 }, (_, index) => index % 253);

class MemoryRegistry implements DeviceRegistry {
  readonly devices = new Map<string, { device: RemoteDevice; token: string }>();
  find(token: string): RemoteDevice | null {
    return [...this.devices.values()].find((entry) => entry.token === token)?.device ?? null;
  }
  add(label: string) {
    const device = { id: randomId(), label, approvedAt: 0, lastSeenAt: 0 };
    const token = randomId();
    this.devices.set(device.id, { device, token });
    return { device, token };
  }
  touch(): void {}
  remove(id: string): void {
    this.devices.delete(id);
  }
  list(): RemoteDevice[] {
    return [...this.devices.values()].map((entry) => entry.device);
  }
}

let clock: FakeClock;
let registry: MemoryRegistry;
let budget: ByteBudget;
let approve: boolean;
let session: RemoteSession;

beforeEach(() => {
  clock = new FakeClock();
  registry = new MemoryRegistry();
  budget = new ByteBudget(REMOTE_CHUNK_BYTES * 10);
  approve = false;
  session = new RemoteSession({
    clock,
    devices: registry,
    budget,
    catalog: () => CATALOG,
    approveNewDevices: () => approve,
  });
  session.relayOpened();
});

/** 一个连上来并被接纳的页面：返回连接号、nonce 和下一个 seq。 */
function welcomed(name = '张三'): { connection: string; nonce: string; seq: () => number } {
  const connection = randomId();
  session.viewerJoined(connection);
  const outcome = session.hello(connection, { type: 'hello', token: null, device: '电脑 · Edge', name });
  if (outcome.kind !== 'welcome') {
    throw new Error(`not welcomed: ${outcome.kind}`);
  }
  let seq = 0;
  return {
    connection,
    nonce: outcome.nonce,
    seq: () => {
      seq += 1;
      return seq;
    },
  };
}

function offer(viewer: ReturnType<typeof welcomed>, job: string, file = FILE): Extract<ViewerMessage, { type: 'offer' }> {
  return {
    type: 'offer',
    nonce: viewer.nonce,
    seq: viewer.seq(),
    job,
    document: { name: '面单.pdf', kind: 'pdf', bytes: file.length, sha256: createHash('sha256').update(file).digest() },
    paper: '100x150',
    crop: 'trim',
    copies: 1,
  };
}

function chunk(viewer: ReturnType<typeof welcomed>, job: string, index: number, file = FILE) {
  return { type: 'chunk', nonce: viewer.nonce, seq: viewer.seq(), job, index, data: chunkAt(file, index) } as const;
}

describe('joining', () => {
  test('welcomes a new device and knows it again by its token', () => {
    const connection = randomId();
    session.viewerJoined(connection);
    const first = session.hello(connection, { type: 'hello', token: null, device: '电脑 · Edge', name: '张三' });
    expect(first).toMatchObject({ kind: 'welcome' });
    expect(registry.list()).toMatchObject([{ label: '张三 · 电脑 · Edge' }]);
    const token = (first as Extract<HelloOutcome, { kind: 'welcome' }>).token;
    const again = randomId();
    session.viewerJoined(again);
    expect(session.hello(again, { type: 'hello', token, device: '电脑 · Edge', name: '张三' })).toMatchObject({
      kind: 'welcome',
      token,
    });
    expect(registry.list()).toHaveLength(1);
  });

  test('asks before letting a new device in, when the share wants that', () => {
    approve = true;
    const yes = randomId();
    const no = randomId();
    session.viewerJoined(yes);
    session.viewerJoined(no);
    const asked = session.hello(yes, { type: 'hello', token: null, device: '手机 · 微信', name: '李四' });
    const refused = session.hello(no, { type: 'hello', token: null, device: '电脑 · Chrome', name: '' });
    expect(session.pendingApprovals().map((approval) => approval.label)).toEqual(['李四 · 手机 · 微信', '电脑 · Chrome']);
    if (asked.kind !== 'pending' || refused.kind !== 'pending') {
      throw new Error('expected pending');
    }
    expect(session.decide(asked.requestId, true)).toMatchObject({ connection: yes, outcome: { kind: 'welcome' } });
    expect(session.decide(refused.requestId, false)).toEqual({
      connection: no,
      outcome: { kind: 'denied', reason: 'refused' },
    });
    expect(session.pendingApprovals()).toEqual([]);
  });

  test('keeps at most a few devices waiting for approval', () => {
    approve = true;
    for (let index = 0; index < MAX_PENDING_APPROVALS; index += 1) {
      const connection = randomId();
      session.viewerJoined(connection);
      session.hello(connection, { type: 'hello', token: null, device: 'x', name: '' });
    }
    const late = randomId();
    session.viewerJoined(late);
    expect(session.hello(late, { type: 'hello', token: null, device: 'x', name: '' })).toEqual({
      kind: 'denied',
      reason: 'refused',
    });
  });

  test('turns away a token it does not know: that device was removed', () => {
    const connection = randomId();
    session.viewerJoined(connection);
    expect(session.hello(connection, { type: 'hello', token: randomId(), device: 'x', name: '' })).toEqual({
      kind: 'denied',
      reason: 'removed',
    });
  });

  test('ignores jobs from a connection that was not welcomed, with a wrong nonce or a replayed seq', () => {
    const viewer = welcomed();
    const stranger = randomId();
    session.viewerJoined(stranger);
    expect(session.receive(stranger, offer(viewer, randomId()))).toEqual({ kind: 'reply', messages: [] });
    expect(session.receive(viewer.connection, { ...offer(viewer, randomId()), nonce: randomId() })).toEqual({
      kind: 'reply',
      messages: [],
    });
    const message = offer(viewer, randomId());
    session.receive(viewer.connection, message);
    expect(session.receive(viewer.connection, message)).toEqual({ kind: 'reply', messages: [] });
  });
});

describe('uploads', () => {
  test('takes the chunks in order, acknowledges each and accepts the job when the digest matches', () => {
    const viewer = welcomed();
    const job = randomId();
    expect(session.receive(viewer.connection, offer(viewer, job))).toEqual({
      kind: 'reply',
      messages: [{ type: 'upload', job, received: 0 }],
    });
    expect(session.receive(viewer.connection, chunk(viewer, job, 1))).toEqual({
      kind: 'reply',
      messages: [{ type: 'ack', job, received: 0 }],
    });
    session.receive(viewer.connection, chunk(viewer, job, 0));
    session.receive(viewer.connection, chunk(viewer, job, 1));
    const last = session.receive(viewer.connection, chunk(viewer, job, 2));
    expect(last).toMatchObject({
      kind: 'accept',
      messages: [{ type: 'ack', job, received: chunkCount(FILE.length) }],
      accepted: { job, title: '面单.pdf', spec: { kind: 'document', paper: '100x150', crop: 'trim', copies: 1 } },
    });
    expect(last.kind === 'accept' && last.accepted.spec.kind === 'document' ? last.accepted.spec.bytes : null).toEqual(FILE);
  });

  test('refuses a file whose digest does not match and frees its memory', () => {
    const viewer = welcomed();
    const job = randomId();
    session.receive(viewer.connection, { ...offer(viewer, job), document: { ...offer(viewer, job).document, sha256: new Uint8Array(32) } });
    for (let index = 0; index < 3; index += 1) {
      const decision = session.receive(viewer.connection, chunk(viewer, job, index));
      if (index === 2) {
        expect(decision).toMatchObject({ kind: 'reply', messages: [{ type: 'ack' }, { type: 'result', result: { status: 'invalid' } }] });
      }
    }
    expect(budget.usedBytes).toBe(0);
  });

  test('answers a repeated offer with how far the upload got, so the page resumes there', () => {
    const viewer = welcomed();
    const job = randomId();
    session.receive(viewer.connection, offer(viewer, job));
    session.receive(viewer.connection, chunk(viewer, job, 0));
    expect(session.receive(viewer.connection, offer(viewer, job))).toEqual({
      kind: 'reply',
      messages: [{ type: 'upload', job, received: 1 }],
    });
  });

  test('says busy when the files held in memory would pass the budget, and frees it when a job finishes', () => {
    budget = new ByteBudget(FILE.length);
    session = new RemoteSession({ clock, devices: registry, budget, catalog: () => CATALOG, approveNewDevices: () => false });
    session.relayOpened();
    const viewer = welcomed();
    const first = randomId();
    session.receive(viewer.connection, offer(viewer, first));
    const second = randomId();
    expect(session.receive(viewer.connection, offer(viewer, second))).toEqual({
      kind: 'reply',
      messages: [{ type: 'refused', job: second, reason: 'busy' }],
    });
    for (let index = 0; index < 3; index += 1) {
      session.receive(viewer.connection, chunk(viewer, first, index));
    }
    session.finished(first, { status: 'sent', labels: 1 });
    expect(budget.usedBytes).toBe(0);
  });

  test('drops an upload that stopped for a minute and frees its memory', () => {
    const viewer = welcomed();
    const job = randomId();
    session.receive(viewer.connection, offer(viewer, job));
    clock.advance(REMOTE_UPLOAD_IDLE_MS);
    session.tick();
    expect(budget.usedBytes).toBe(0);
    expect(session.receive(viewer.connection, offer(viewer, job))).toEqual({
      kind: 'reply',
      messages: [{ type: 'upload', job, received: 0 }],
    });
  });
});

describe('back pressure', () => {
  test('lets each device have only a few unfinished jobs', () => {
    budget = new ByteBudget(Number.MAX_SAFE_INTEGER);
    session = new RemoteSession({ clock, devices: registry, budget, catalog: () => CATALOG, approveNewDevices: () => false });
    session.relayOpened();
    const viewer = welcomed();
    for (let index = 0; index < REMOTE_MAX_PENDING_JOBS; index += 1) {
      session.receive(viewer.connection, offer(viewer, randomId()));
    }
    const job = randomId();
    expect(session.receive(viewer.connection, offer(viewer, job))).toEqual({
      kind: 'reply',
      messages: [{ type: 'refused', job, reason: 'too-many-pending' }],
    });
  });

  test('takes only so many jobs a minute for one share', () => {
    budget = new ByteBudget(Number.MAX_SAFE_INTEGER);
    session = new RemoteSession({ clock, devices: registry, budget, catalog: () => CATALOG, approveNewDevices: () => false });
    session.relayOpened();
    let last: unknown = null;
    for (let index = 0; index <= REMOTE_JOBS_PER_MINUTE; index += 1) {
      // 每次一台新设备、提交完就离开：避开每台设备的未完成上限和同时在线的上限，只测共享的速率。
      const viewer = welcomed(`第${index}个`);
      last = session.receive(viewer.connection, offer(viewer, randomId()));
      session.viewerLeft(viewer.connection);
    }
    expect(last).toMatchObject({ messages: [{ type: 'refused', reason: 'rate-limited' }] });
  });
});

describe('templates and status', () => {
  test('accepts a filled template only if it is shared', () => {
    const viewer = welcomed();
    const fill = (template: string, job = randomId()) =>
      session.receive(viewer.connection, {
        type: 'fill',
        nonce: viewer.nonce,
        seq: viewer.seq(),
        job,
        template,
        fields: [{ name: '品名', value: '短袖' }],
        copies: 1,
      });
    expect(fill('custom:tag-1')).toMatchObject({ kind: 'accept', accepted: { title: '吊牌', spec: { kind: 'template' } } });
    expect(fill('custom:other')).toMatchObject({
      kind: 'reply',
      messages: [{ type: 'result', result: { status: 'invalid', detail: '这个模板已不再共享：刷新页面再选' } }],
    });
  });

  test('answers how its jobs are doing and names the ones it does not know', () => {
    const viewer = welcomed();
    const job = randomId();
    session.receive(viewer.connection, offer(viewer, job));
    const lost = randomId();
    expect(
      session.receive(viewer.connection, { type: 'status', nonce: viewer.nonce, seq: viewer.seq(), jobs: [job, lost] }),
    ).toEqual({
      kind: 'reply',
      messages: [
        { type: 'upload', job, received: 0 },
        { type: 'unknown', jobs: [lost] },
      ],
    });
  });

  test('tells the owner where its jobs moved in one message per device', () => {
    const viewer = welcomed();
    const fill = (job: string) =>
      session.receive(viewer.connection, {
        type: 'fill',
        nonce: viewer.nonce,
        seq: viewer.seq(),
        job,
        template: 'custom:tag-1',
        fields: [{ name: '品名', value: 'x' }],
        copies: 1,
      });
    const [a, b] = [randomId(), randomId()];
    fill(a);
    fill(b);
    expect(session.moved([{ job: a, ahead: 0 }, { job: b, ahead: 1 }])).toEqual([
      { connection: viewer.connection, message: { type: 'queue', jobs: [{ job: a, ahead: 0 }, { job: b, ahead: 1 }] } },
    ]);
  });
});

describe('removing a device', () => {
  test('kicks it, drops its uploads, lists its running jobs and forgets its token', () => {
    const viewer = welcomed();
    const upload = randomId();
    session.receive(viewer.connection, offer(viewer, upload));
    const running = randomId();
    session.receive(viewer.connection, {
      type: 'fill',
      nonce: viewer.nonce,
      seq: viewer.seq(),
      job: running,
      template: 'custom:tag-1',
      fields: [{ name: '品名', value: 'x' }],
      copies: 1,
    });
    const [device] = registry.list();
    expect(session.removeDevice(device?.id ?? '')).toEqual({ kick: viewer.connection, running: [running] });
    expect(budget.usedBytes).toBe(0);
    expect(registry.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/remote/remote-session.test.ts`
Expected: FAIL，`Cannot find module './remote-session'`。

- [ ] **Step 3: 实现**

```ts
// src/main/remote/remote-session.ts
/**
 * 一个远程共享在电脑上的会话规则（纯逻辑，时间由 Clock 注入）：设备加入与确认、防重放、任务表、上传重组、背压。
 *
 * - 设备凭令牌认人（DeviceRegistry 只存摘要）；没有令牌的是新设备，共享要求确认时先挂起，电脑上点了才接纳。
 * - 任务是幂等的：同一个任务号只执行一次，重发只回当前进度（上传到第几块、排队位置、打印进度）或已有结果。
 * - 文件按顺序一块块收，收齐核对 SHA-256 才交出去打印；上传中和排队中的文件占用电脑的内存预算，结束时释放。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../core/types';
import { randomId } from '../../shared/mobile-crypto';
import type { PhoneField, QueuePosition } from '../../shared/mobile-protocol';
import { ChunkAssembler } from '../../shared/remote-chunks';
import {
  type DesktopToViewer,
  REMOTE_MAX_PENDING_JOBS,
  REMOTE_MAX_VIEWERS,
  REMOTE_UPLOAD_IDLE_MS,
  type RemoteCatalog,
  type RemoteCrop,
  type RemoteDenial,
  type RemoteRefusal,
  type RemoteResult,
  type ViewerMessage,
} from '../../shared/remote-protocol';
import type { DeviceRegistry, RemoteDevice } from './device-registry';

/** 一个共享每分钟最多接 30 个任务：远程多是整份文件，再快热敏标签机也打不完。 */
export const REMOTE_JOBS_PER_MINUTE = 30;
/** 同时等电脑确认的新设备最多 3 台：再多就是有人拿着链接乱试。 */
export const MAX_PENDING_APPROVALS = 3;
/** 等确认最多 10 分钟（和本机接口的网站询问一样），没人点就作废。 */
export const APPROVAL_TTL_MS = 10 * 60_000;
/** 每个共享保留结果的任务数：远多于页面上显示的；更早的任务号被重放也先被 nonce / seq 挡住。 */
export const REMOTE_JOB_MEMORY = 200;
const RATE_WINDOW_MS = 60_000;
const ISSUES = {
  badPaper: '电脑上没有这种纸了：刷新页面重新选纸张',
  notShared: '这个模板已不再共享：刷新页面再选',
  corrupt: '文件传过来不完整：请重新上传',
} as const;

/** 电脑上同时收着、排着的文件占用的内存（所有共享合计）。 */
export interface UploadBudget {
  reserve(bytes: number): boolean;
  release(bytes: number): void;
}

export class ByteBudget implements UploadBudget {
  private used = 0;

  constructor(private readonly limit: number) {}

  get usedBytes(): number {
    return this.used;
  }

  reserve(bytes: number): boolean {
    if (this.used + bytes > this.limit) {
      return false;
    }
    this.used += bytes;
    return true;
  }

  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }
}

/** 要发给某个页面连接的消息。设备不在线时不发：结果已保存，它重连后问 status 就能拿到。 */
export interface Delivery {
  connection: string;
  message: DesktopToViewer;
}

/** 一个要执行的任务。 */
export type RemoteJobSpec =
  | { kind: 'document'; name: string; bytes: Uint8Array; paper: string; crop: RemoteCrop; copies: number }
  | { kind: 'template'; template: string; fields: PhoneField[]; copies: number };

export interface AcceptedJob {
  job: string;
  device: RemoteDevice;
  /** 页面和电脑上显示的任务名：文件名或模板名。 */
  title: string;
  spec: RemoteJobSpec;
}

export type HelloOutcome =
  | { kind: 'welcome'; token: string; nonce: string }
  | { kind: 'pending'; requestId: string }
  | { kind: 'denied'; reason: RemoteDenial };

export type IntakeDecision =
  /** 回复这几条（可以没有，就是不理会）。 */
  | { kind: 'reply'; messages: DesktopToViewer[] }
  /** 新任务可以开始：先回复 messages，再交给打印队列，排上之后由调用方回 accepted。 */
  | { kind: 'accept'; messages: DesktopToViewer[]; accepted: AcceptedJob };

export interface PendingApproval {
  requestId: string;
  label: string;
  at: number;
}

export interface RemoteSessionDeps {
  clock: Clock;
  devices: DeviceRegistry;
  budget: UploadBudget;
  /** 现在能选的纸张和这个共享的模板。 */
  catalog: () => RemoteCatalog;
  /** 新设备要不要先经电脑确认。 */
  approveNewDevices: () => boolean;
}

interface Viewer {
  device: RemoteDevice;
  nonce: string;
  lastSeq: number;
}

type Offer = Extract<ViewerMessage, { type: 'offer' }>;
type Fill = Extract<ViewerMessage, { type: 'fill' }>;

type Job =
  | { owner: string; title: string; state: 'uploading'; offer: Offer; assembler: ChunkAssembler; touchedAt: number }
  /** 交给打印队列了（排队或在打）：reserved 是还占着的内存；progress 是最近告诉对方的进度。 */
  | { owner: string; title: string; state: 'running'; reserved: number; progress: DesktopToViewer | null }
  | { owner: string; title: string; state: 'done'; result: RemoteResult };

const NOTHING: IntakeDecision = { kind: 'reply', messages: [] };

export class RemoteSession {
  /** 连接号 → 在线设备；连上了还没被接纳（或在等确认）的连接为 null。 */
  private readonly connections = new Map<string, Viewer | null>();
  private readonly approvals = new Map<string, { connection: string; label: string; at: number }>();
  private readonly jobs = new Map<string, Job>();
  private readonly acceptedAt: number[] = [];

  constructor(private readonly deps: RemoteSessionDeps) {}

  /** 中转服务确认了会话（第一次或重连后）：旧连接一律作废，等中转服务重新通知 joined、页面重新 hello。 */
  relayOpened(): void {
    this.connections.clear();
    this.approvals.clear();
  }

  viewerJoined(connection: string): void {
    this.connections.set(connection, null);
  }

  viewerLeft(connection: string): void {
    this.connections.delete(connection);
    this.dropApprovalOf(connection);
  }

  hello(connection: string, message: Extract<ViewerMessage, { type: 'hello' }>): HelloOutcome {
    if (!this.connections.has(connection)) {
      return { kind: 'denied', reason: 'removed' };
    }
    // 同一个连接又打招呼（电脑重连后）：先解开它原来代表的设备和等着的确认。
    this.connections.set(connection, null);
    this.dropApprovalOf(connection);
    const label = message.name === '' ? message.device : `${message.name} · ${message.device}`;
    if (message.token !== null) {
      const device = this.deps.devices.find(message.token);
      // 不认识的令牌只可能来自被移除的设备（或共享撤销后又建的同名共享）：不让它换个连接混进来。
      if (device === null) {
        return { kind: 'denied', reason: 'removed' };
      }
      for (const [other, viewer] of this.connections) {
        if (viewer?.device.id === device.id) {
          // 同一台设备换了连接（刷新页面、换网络）：旧连接不再代表它。
          this.connections.set(other, null);
        }
      }
      if (this.onlineCount() >= REMOTE_MAX_VIEWERS) {
        return { kind: 'denied', reason: 'full' };
      }
      this.deps.devices.touch(device.id, label);
      return this.bind(connection, { ...device, label }, message.token);
    }
    if (this.onlineCount() >= REMOTE_MAX_VIEWERS) {
      return { kind: 'denied', reason: 'full' };
    }
    if (this.deps.approveNewDevices()) {
      if (this.approvals.size >= MAX_PENDING_APPROVALS) {
        return { kind: 'denied', reason: 'refused' };
      }
      const requestId = randomId();
      this.approvals.set(requestId, { connection, label, at: this.deps.clock.now() });
      return { kind: 'pending', requestId };
    }
    const { device, token } = this.deps.devices.add(label);
    return this.bind(connection, device, token);
  }

  /** 电脑上点了「允许」或「拒绝」。那个连接已经走了（或请求已过期）时返回 null。 */
  decide(requestId: string, allow: boolean): { connection: string; outcome: HelloOutcome } | null {
    const approval = this.approvals.get(requestId);
    this.approvals.delete(requestId);
    if (!approval || !this.connections.has(approval.connection)) {
      return null;
    }
    const { connection, label } = approval;
    if (!allow) {
      return { connection, outcome: { kind: 'denied', reason: 'refused' } };
    }
    if (this.onlineCount() >= REMOTE_MAX_VIEWERS) {
      return { connection, outcome: { kind: 'denied', reason: 'full' } };
    }
    const { device, token } = this.deps.devices.add(label);
    return { connection, outcome: this.bind(connection, device, token) };
  }

  pendingApprovals(): PendingApproval[] {
    return [...this.approvals].map(([requestId, { label, at }]) => ({ requestId, label, at }));
  }

  receive(connection: string, message: Exclude<ViewerMessage, { type: 'hello' }>): IntakeDecision {
    const viewer = this.connections.get(connection);
    // 只接受已接纳的设备、nonce 对得上、seq 严格递增的消息：挡住没加入的连接和重放的旧消息。
    if (!viewer || !sameSecret(message.nonce, viewer.nonce) || message.seq <= viewer.lastSeq) {
      return NOTHING;
    }
    viewer.lastSeq = message.seq;
    switch (message.type) {
      case 'offer':
        return this.offer(viewer.device, message);
      case 'chunk':
        return this.chunk(viewer.device, message);
      case 'fill':
        return this.fill(viewer.device, message);
      case 'status':
        return this.status(viewer.device, message.jobs);
    }
  }

  /** 打印队列告诉对方的进度（accepted、started）：记下来，发给提交它的设备。 */
  progressed(jobId: string, message: DesktopToViewer): Delivery[] {
    const job = this.jobs.get(jobId);
    if (job?.state !== 'running') {
      return [];
    }
    job.progress = message;
    return this.deliver(job.owner, message);
  }

  /** 队伍往前走了：每台设备一条 queue，列出它这几个任务的新位置。 */
  moved(positions: readonly QueuePosition[]): Delivery[] {
    const byOwner = new Map<string, QueuePosition[]>();
    for (const position of positions) {
      const job = this.jobs.get(position.job);
      if (job?.state !== 'running') {
        continue;
      }
      job.progress = { type: 'accepted', job: position.job, ahead: position.ahead };
      byOwner.set(job.owner, [...(byOwner.get(job.owner) ?? []), position]);
    }
    return [...byOwner].flatMap(([owner, jobs]) => this.deliver(owner, { type: 'queue', jobs }));
  }

  /** 任务结束：记下结果、释放内存、发给提交它的设备。 */
  finished(jobId: string, result: RemoteResult): Delivery[] {
    const job = this.jobs.get(jobId);
    if (!job || job.state === 'done') {
      return [];
    }
    if (job.state === 'running') {
      this.deps.budget.release(job.reserved);
    } else {
      this.deps.budget.release(job.offer.document.bytes);
    }
    return this.deliver(job.owner, this.complete(jobId, job.owner, job.title, result));
  }

  /**
   * 移除一台设备：令牌作废、断开它，它上传中的文件丢掉（释放内存）；返回要断开的连接和它交给打印队列的任务
   * （调用方把还没开始打的取消，正在打的那张打完）。
   */
  removeDevice(deviceId: string): { kick: string | null; running: string[] } {
    this.deps.devices.remove(deviceId);
    let kick: string | null = null;
    for (const [connection, viewer] of this.connections) {
      if (viewer?.device.id === deviceId) {
        kick = connection;
        this.connections.set(connection, null);
      }
    }
    const running: string[] = [];
    for (const [jobId, job] of [...this.jobs]) {
      if (job.owner !== deviceId) {
        continue;
      }
      if (job.state === 'uploading') {
        this.deps.budget.release(job.offer.document.bytes);
        this.jobs.delete(jobId);
      } else if (job.state === 'running') {
        running.push(jobId);
      }
    }
    return { kick, running };
  }

  /** 共享被撤销或到期：丢掉所有上传，返回交给打印队列的任务。 */
  cancelAll(): string[] {
    const running: string[] = [];
    for (const [jobId, job] of [...this.jobs]) {
      if (job.state === 'uploading') {
        this.deps.budget.release(job.offer.document.bytes);
        this.jobs.delete(jobId);
      } else if (job.state === 'running') {
        running.push(jobId);
      }
    }
    return running;
  }

  /** 定时调用：丢掉闲置的上传，作废过期的确认（告诉那个页面被拒绝了）。返回要发的消息。 */
  tick(): Delivery[] {
    const now = this.deps.clock.now();
    for (const [jobId, job] of [...this.jobs]) {
      if (job.state === 'uploading' && now - job.touchedAt >= REMOTE_UPLOAD_IDLE_MS) {
        this.deps.budget.release(job.offer.document.bytes);
        this.jobs.delete(jobId);
      }
    }
    const deliveries: Delivery[] = [];
    for (const [requestId, approval] of [...this.approvals]) {
      if (now - approval.at >= APPROVAL_TTL_MS) {
        this.approvals.delete(requestId);
        deliveries.push({ connection: approval.connection, message: { type: 'denied', reason: 'refused' } });
      }
    }
    return deliveries;
  }

  onlineConnections(): string[] {
    return [...this.connections].flatMap(([connection, viewer]) => (viewer === null ? [] : [connection]));
  }

  /** 设备列表（按接纳先后）和每台在线与否、还没结果的任务数。 */
  devices(): { device: RemoteDevice; online: boolean; pending: number }[] {
    const online = new Set([...this.connections.values()].flatMap((viewer) => (viewer ? [viewer.device.id] : [])));
    return this.deps.devices.list().map((device) => ({
      device,
      online: online.has(device.id),
      pending: this.pendingOf(device.id),
    }));
  }

  private offer(device: RemoteDevice, message: Offer): IntakeDecision {
    const known = this.jobs.get(message.job);
    if (known) {
      return known.owner === device.id ? reply(this.progressOf(message.job, known)) : NOTHING;
    }
    const refusal = this.admit(device.id);
    if (refusal !== null) {
      return reply({ type: 'refused', job: message.job, reason: refusal });
    }
    const title = message.document.name;
    if (!this.deps.catalog().papers.some((paper) => paper.key === message.paper)) {
      return reply(this.complete(message.job, device.id, title, { status: 'invalid', detail: ISSUES.badPaper }));
    }
    if (!this.deps.budget.reserve(message.document.bytes)) {
      return reply({ type: 'refused', job: message.job, reason: 'busy' });
    }
    this.jobs.set(message.job, {
      owner: device.id,
      title,
      state: 'uploading',
      offer: message,
      assembler: new ChunkAssembler(message.document.bytes),
      touchedAt: this.deps.clock.now(),
    });
    return reply({ type: 'upload', job: message.job, received: 0 });
  }

  private chunk(device: RemoteDevice, message: Extract<ViewerMessage, { type: 'chunk' }>): IntakeDecision {
    const job = this.jobs.get(message.job);
    if (!job || job.owner !== device.id) {
      return NOTHING;
    }
    if (job.state !== 'uploading') {
      return reply(this.progressOf(message.job, job));
    }
    // 不是下一块（乱序、重复、大小不对）就不收：回告当前收到几块，页面从那里重发。
    job.assembler.accept(message.index, message.data);
    job.touchedAt = this.deps.clock.now();
    const ack: DesktopToViewer = { type: 'ack', job: message.job, received: job.assembler.received };
    if (!job.assembler.isComplete) {
      return reply(ack);
    }
    const { offer } = job;
    const bytes = job.assembler.assemble();
    if (!sameDigest(createHash('sha256').update(bytes).digest(), offer.document.sha256)) {
      this.deps.budget.release(offer.document.bytes);
      return reply(ack, this.complete(message.job, device.id, job.title, { status: 'invalid', detail: ISSUES.corrupt }));
    }
    this.jobs.set(message.job, {
      owner: device.id,
      title: job.title,
      state: 'running',
      reserved: offer.document.bytes,
      progress: null,
    });
    return {
      kind: 'accept',
      messages: [ack],
      accepted: {
        job: message.job,
        device,
        title: job.title,
        spec: {
          kind: 'document',
          name: offer.document.name,
          bytes,
          paper: offer.paper,
          crop: offer.crop,
          copies: offer.copies,
        },
      },
    };
  }

  private fill(device: RemoteDevice, message: Fill): IntakeDecision {
    const known = this.jobs.get(message.job);
    if (known) {
      return known.owner === device.id ? reply(this.progressOf(message.job, known)) : NOTHING;
    }
    const refusal = this.admit(device.id);
    if (refusal !== null) {
      return reply({ type: 'refused', job: message.job, reason: refusal });
    }
    const template = this.deps.catalog().templates.find((item) => item.id === message.template);
    if (template === undefined) {
      return reply(this.complete(message.job, device.id, '模板', { status: 'invalid', detail: ISSUES.notShared }));
    }
    this.jobs.set(message.job, { owner: device.id, title: template.name, state: 'running', reserved: 0, progress: null });
    return {
      kind: 'accept',
      messages: [],
      accepted: {
        job: message.job,
        device,
        title: template.name,
        spec: { kind: 'template', template: message.template, fields: message.fields, copies: message.copies },
      },
    };
  }

  private status(device: RemoteDevice, jobIds: readonly string[]): IntakeDecision {
    const messages: DesktopToViewer[] = [];
    const unknown: string[] = [];
    for (const jobId of jobIds) {
      const job = this.jobs.get(jobId);
      if (!job) {
        unknown.push(jobId);
      } else if (job.owner === device.id) {
        messages.push(this.progressOf(jobId, job));
      }
    }
    if (unknown.length > 0) {
      messages.push({ type: 'unknown', jobs: unknown });
    }
    return { kind: 'reply', messages };
  }

  /** 新任务能不能收：这台设备未完成的任务、这个共享每分钟的任务数。能收时记一笔。 */
  private admit(owner: string): RemoteRefusal | null {
    if (this.pendingOf(owner) >= REMOTE_MAX_PENDING_JOBS) {
      return 'too-many-pending';
    }
    const now = this.deps.clock.now();
    while (this.acceptedAt.length > 0 && now - (this.acceptedAt[0] ?? now) >= RATE_WINDOW_MS) {
      this.acceptedAt.shift();
    }
    if (this.acceptedAt.length >= REMOTE_JOBS_PER_MINUTE) {
      return 'rate-limited';
    }
    this.acceptedAt.push(now);
    return null;
  }

  private progressOf(jobId: string, job: Job): DesktopToViewer {
    switch (job.state) {
      case 'uploading':
        return { type: 'upload', job: jobId, received: job.assembler.received };
      case 'running':
        // 刚交给打印队列、位置还没回来：队列会马上告诉（progressed），这时按「排在最前」回答。
        return job.progress ?? { type: 'accepted', job: jobId, ahead: 0 };
      case 'done':
        return { type: 'result', job: jobId, result: job.result };
    }
  }

  private complete(jobId: string, owner: string, title: string, result: RemoteResult): DesktopToViewer {
    this.jobs.set(jobId, { owner, title, state: 'done', result });
    this.forgetOldJobs();
    return { type: 'result', job: jobId, result };
  }

  private bind(connection: string, device: RemoteDevice, token: string): HelloOutcome {
    const nonce = randomId();
    this.connections.set(connection, { device, nonce, lastSeq: 0 });
    return { kind: 'welcome', token, nonce };
  }

  private deliver(owner: string, message: DesktopToViewer): Delivery[] {
    return [...this.connections].flatMap(([connection, viewer]) =>
      viewer?.device.id === owner ? [{ connection, message }] : [],
    );
  }

  private onlineCount(): number {
    return [...this.connections.values()].filter((viewer) => viewer !== null).length;
  }

  private pendingOf(owner: string): number {
    return [...this.jobs.values()].filter((job) => job.owner === owner && job.state !== 'done').length;
  }

  private dropApprovalOf(connection: string): void {
    for (const [requestId, approval] of this.approvals) {
      if (approval.connection === connection) {
        this.approvals.delete(requestId);
      }
    }
  }

  private forgetOldJobs(): void {
    for (const [jobId, job] of this.jobs) {
      if (this.jobs.size <= REMOTE_JOB_MEMORY) {
        return;
      }
      // 只删已完成的：上传中、排队中、打印中的任务还要等它的结果。
      if (job.state === 'done') {
        this.jobs.delete(jobId);
      }
    }
  }
}

function reply(...messages: DesktopToViewer[]): IntakeDecision {
  return { kind: 'reply', messages };
}

/** 按常数时间比较 nonce，不让比较耗时泄露它有几位是对的。 */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameDigest(actual: Uint8Array, expected: Uint8Array): boolean {
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/remote/remote-session.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/remote/remote-session.ts src/main/remote/remote-session.test.ts
git commit -m "feat(remote): session rules for remote viewers, uploads and back pressure" -m "Each share admits devices by token, optionally after the operator approves a new one, and rejects messages with a stale nonce or a replayed seq. Uploads are taken chunk by chunk in order and become jobs only when the SHA-256 matches; an idle upload is dropped and its memory released. Jobs are idempotent, unknown job ids are named so the page can explain, and devices, shares and the computer as a whole each have their limit." -m "$TRAILER"
```

---

### Task 12: 每台打印机一条队 RemoteQueue

所有共享、所有人的远程任务按打印机排队：同一台先来先打，一份文件的标签连续打完才轮到下一份；不同打印机互不等待。队的键（lane）由 Task 15 的 `RemoteStation` 算：文件任务按选的纸张决定打印机，模板任务按模板（模板指定的打印机优先）。纯逻辑。

**Files:**
- Create: `src/main/remote/remote-queue.ts`、`src/main/remote/remote-queue.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/remote/remote-queue.test.ts
import { describe, expect, test } from 'bun:test';
import { RemoteQueue } from './remote-queue';

describe('RemoteQueue', () => {
  test('queues per printer and says how many are ahead', () => {
    const queue = new RemoteQueue();
    expect(queue.enqueue('a', '面单机')).toBe(0);
    expect(queue.enqueue('b', '面单机')).toBe(1);
    expect(queue.enqueue('c', '标签机')).toBe(0);
    expect(queue.size).toBe(3);
  });

  test('starts only the head of a lane, one at a time', () => {
    const queue = new RemoteQueue();
    queue.enqueue('a', '面单机');
    queue.enqueue('b', '面单机');
    expect(queue.next('面单机')).toBe('a');
    queue.start('a');
    expect(queue.next('面单机')).toBeNull();
    expect(queue.remove('a')).toEqual([{ key: 'b', ahead: 0 }]);
    expect(queue.next('面单机')).toBe('b');
  });

  test('moves only the jobs behind one that is canceled', () => {
    const queue = new RemoteQueue();
    for (const key of ['a', 'b', 'c', 'd']) {
      queue.enqueue(key, '面单机');
    }
    expect(queue.remove('b')).toEqual([
      { key: 'c', ahead: 1 },
      { key: 'd', ahead: 2 },
    ]);
    expect(queue.remove('missing')).toEqual([]);
  });

  test('forgets a lane once it is empty', () => {
    const queue = new RemoteQueue();
    queue.enqueue('a', '标签机');
    queue.remove('a');
    expect(queue.next('标签机')).toBeNull();
    expect(queue.size).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/remote/remote-queue.test.ts`
Expected: FAIL，`Cannot find module './remote-queue'`。

- [ ] **Step 3: 实现**

```ts
// src/main/remote/remote-queue.ts
/**
 * 远程任务的排队（纯逻辑）：每台打印机（lane）一条队，跨所有共享，先来先打，一次一个任务；
 * 队头的任务开始后整份打完（或停下）才移出，后面的才开始。位置变了的任务由调用方告诉它们的页面。
 */
export interface QueueMove {
  key: string;
  ahead: number;
}

export class RemoteQueue {
  private readonly lanes = new Map<string, string[]>();
  private readonly laneOf = new Map<string, string>();
  private readonly running = new Set<string>();

  /** 排队中和在打的任务数（所有打印机）。 */
  get size(): number {
    return this.laneOf.size;
  }

  /** 排到 lane 的队尾，返回前面还有几个（包括正在打的）。 */
  enqueue(key: string, lane: string): number {
    const list = this.lanes.get(lane) ?? [];
    list.push(key);
    this.lanes.set(lane, list);
    this.laneOf.set(key, lane);
    return list.length - 1;
  }

  /** 这条队里下一个该开始的：队头，并且还没开始。 */
  next(lane: string): string | null {
    const head = this.lanes.get(lane)?.[0];
    return head !== undefined && !this.running.has(head) ? head : null;
  }

  start(key: string): void {
    this.running.add(key);
  }

  /** 打完或取消：移出队列，返回排在它后面、位置变了的任务。 */
  remove(key: string): QueueMove[] {
    const lane = this.laneOf.get(key);
    const list = lane === undefined ? undefined : this.lanes.get(lane);
    if (lane === undefined || list === undefined) {
      return [];
    }
    const index = list.indexOf(key);
    list.splice(index, 1);
    this.laneOf.delete(key);
    this.running.delete(key);
    if (list.length === 0) {
      this.lanes.delete(lane);
    }
    return list.slice(index).map((behind, offset) => ({ key: behind, ahead: index + offset }));
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/remote/remote-queue.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/remote/remote-queue.ts src/main/remote/remote-queue.test.ts
git commit -m "feat(remote): one queue per printer for remote jobs" -m "Remote jobs from every share and viewer line up per printer and run one at a time, so the labels of a document print together; printers do not wait for each other. Removing a job reports only the jobs behind it, whose positions changed." -m "$TRAILER"
```

---

### Task 13: 远程打印页这边的协议 RemoteClient

页面的协议代码和扫码页的 `PhoneSession` 同一个写法：`RelaySocket` 连 `/ws/remote`，收发各串成一条链（`inbox`、`outgoing`），加解密用 `v2d` / `d2v`。另外管：上传（`UploadWindow`、确认超时、`busy` / `quota` 的退避、按电脑说的块数续传）、已被接受的任务只问 `status` 不重发、电脑不在线时的等待和放弃。令牌和已被接受的任务存在 `localStorage`（`remote-store.ts`）；文件本身不存（太大），上传中刷新页面就要重新选文件。

**Files:**
- Create: `relay/web/src/remote/remote-store.ts`、`relay/web/src/remote/remote-store.test.ts`
- Create: `relay/web/src/remote/remote-client.ts`、`relay/web/src/remote/remote-client.test.ts`

- [ ] **Step 1: 写测试**

```ts
// relay/web/src/remote/remote-store.test.ts
import { describe, expect, test } from 'bun:test';
import { randomId } from '../../../../src/shared/mobile-crypto';
import type { KeyValueStorage } from '../session-store';
import { openRemoteStore, REMOTE_RECORD_TTL_MS } from './remote-store';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe('openRemoteStore', () => {
  test('keeps the token and the accepted jobs of a share across reloads', () => {
    const storage = new MemoryStorage();
    const session = randomId();
    const token = randomId();
    const job = randomId();
    const store = openRemoteStore(storage, session, () => 0);
    store.saveToken(token);
    store.saveAccepted([{ job, title: '面单.pdf' }]);
    const reopened = openRemoteStore(storage, session, () => 1);
    expect(reopened.token).toBe(token);
    expect(reopened.accepted).toEqual([{ job, title: '面单.pdf' }]);
  });

  test('drops records it cannot read and records unused for a long time', () => {
    const storage = new MemoryStorage();
    storage.setItem('labelflash.remote.v1.broken', '{"token":"x"}');
    const old = randomId();
    openRemoteStore(storage, old, () => 0).saveToken(randomId());
    openRemoteStore(storage, randomId(), () => REMOTE_RECORD_TTL_MS);
    expect([...storage.items.keys()].some((key) => key.endsWith('broken') || key.endsWith(old))).toBe(false);
  });

  test('works in memory when storage is not available', () => {
    const store = openRemoteStore(null, randomId(), () => 0);
    store.saveToken(randomId());
    expect(store.token).not.toBeNull();
  });
});
```

```ts
// relay/web/src/remote/remote-client.test.ts
import { describe, expect, test } from 'bun:test';
import { importSessionKey, openMessage, randomId, randomKey, sealMessage } from '../../../../src/shared/mobile-crypto';
import { MOBILE_PROTOCOL_VERSION } from '../../../../src/shared/mobile-protocol';
import type { SocketLike, SocketTimers } from '../../../../src/shared/relay-socket';
import {
  type DesktopToViewer,
  parseViewerMessage,
  REMOTE_CHUNK_BYTES,
  type ViewerMessage,
} from '../../../../src/shared/remote-protocol';
import { decodeWire, encodeWire } from '../../../../src/shared/wire';
import { type ClientEvent, OFFLINE_GIVE_UP_MS, RemoteClient } from './remote-client';
import { openRemoteStore, type RemoteStore } from './remote-store';

const SESSION = randomId();
const KEY_TEXT = randomKey();
const CATALOG = { papers: [{ key: '100x150', label: '100×150' }], templates: [] };

/** 假计时器：advance 时按时间顺序触发到期的回调。 */
class FakeTimers implements SocketTimers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.pending].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) {
        break;
      }
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = target;
  }
}

class FakeSocket implements SocketLike {
  readyState = 0;
  binaryType = '';
  readonly sent: Record<string, unknown>[] = [];
  onopen: ((event: never) => void) | null = null;
  onmessage: ((event: never) => void) | null = null;
  onclose: ((event: never) => void) | null = null;
  onerror: ((event: never) => void) | null = null;

  send(data: Uint8Array): void {
    this.sent.push(decodeWire(data) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    (this.onopen as (() => void) | null)?.();
  }

  deliver(frame: object): void {
    (this.onmessage as ((event: { data: unknown }) => void) | null)?.({ data: encodeWire(frame).slice().buffer });
  }

  drop(): void {
    this.readyState = 3;
    (this.onclose as (() => void) | null)?.();
  }
}

/** 加解密是异步的：多等几轮，让收件链和发件链都跑完。 */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function setup(store: RemoteStore = openRemoteStore(null, SESSION, () => 0)) {
  const key = await importSessionKey(KEY_TEXT);
  const sockets: FakeSocket[] = [];
  const events: ClientEvent[] = [];
  const timers = new FakeTimers();
  const client = new RemoteClient({
    relayUrl: 'ws://relay.example.com/ws/remote',
    session: SESSION,
    key,
    device: '电脑 · Edge',
    name: () => '张三',
    store,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers,
    now: () => timers.now,
    onEvent: (event) => events.push(event),
  });
  const socket = (): FakeSocket => {
    const last = sockets.at(-1);
    if (last === undefined) {
      throw new Error('no socket yet');
    }
    return last;
  };
  const desktopSays = async (message: DesktopToViewer): Promise<void> => {
    socket().deliver({ t: 'recv', body: await sealMessage(key, 'd2v', SESSION, message) });
    await settle();
  };
  const viewerSent = async (): Promise<ViewerMessage[]> => {
    const messages: ViewerMessage[] = [];
    for (const frame of socket().sent) {
      if (frame['t'] === 'send') {
        const message = parseViewerMessage(
          await openMessage(key, 'v2d', SESSION, frame['body'] as { iv: Uint8Array; ct: Uint8Array }),
        );
        if (message !== null) {
          messages.push(message);
        }
      }
    }
    return messages;
  };
  /** 连上、被接纳：返回电脑给的 nonce。 */
  const welcome = async (): Promise<string> => {
    socket().open();
    socket().deliver({ t: 'online' });
    await settle();
    const nonce = randomId();
    await desktopSays({ type: 'welcome', token: randomId(), nonce, share: '北京仓', expiresAt: null, catalog: CATALOG });
    return nonce;
  };
  client.start();
  return { client, events, timers, socket, desktopSays, viewerSent, welcome };
}

function document(chunks: number) {
  return {
    name: '面单.pdf',
    kind: 'pdf' as const,
    bytes: new Uint8Array(REMOTE_CHUNK_BYTES * chunks),
    sha256: new Uint8Array(32),
  };
}

const OPTIONS = { paper: '100x150', crop: 'trim' as const, copies: 1 };

function chunkIndexes(messages: ViewerMessage[]): number[] {
  return messages.flatMap((message) => (message.type === 'chunk' ? [message.index] : []));
}

describe('RemoteClient', () => {
  test('joins with protocol 3 and says hello with the saved token and the typed name', async () => {
    const store = openRemoteStore(null, SESSION, () => 0);
    const token = randomId();
    store.saveToken(token);
    const { socket, viewerSent } = await setup(store);
    socket().open();
    expect(socket().sent[0]).toEqual({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: SESSION });
    socket().deliver({ t: 'online' });
    await settle();
    expect(await viewerSent()).toEqual([{ type: 'hello', token, device: '电脑 · Edge', name: '张三' }]);
  });

  test('uploads within the window and moves on with each acknowledgement', async () => {
    const { client, welcome, desktopSays, viewerSent } = await setup();
    await welcome();
    const job = client.uploadDocument(document(6), OPTIONS);
    await settle();
    expect((await viewerSent()).at(-1)).toMatchObject({ type: 'offer', job, document: { bytes: REMOTE_CHUNK_BYTES * 6 } });
    await desktopSays({ type: 'upload', job, received: 0 });
    expect(chunkIndexes(await viewerSent())).toEqual([0, 1, 2, 3]);
    await desktopSays({ type: 'ack', job, received: 1 });
    await desktopSays({ type: 'ack', job, received: 2 });
    expect(chunkIndexes(await viewerSent())).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('starts from the chunk the desktop names when it resumes an upload', async () => {
    const { client, welcome, desktopSays, viewerSent } = await setup();
    await welcome();
    const job = client.uploadDocument(document(6), OPTIONS);
    await desktopSays({ type: 'upload', job, received: 4 });
    expect(chunkIndexes(await viewerSent())).toEqual([4, 5]);
  });

  test('sends again from a gap when the same acknowledgement comes twice', async () => {
    const { client, welcome, desktopSays, viewerSent } = await setup();
    await welcome();
    const job = client.uploadDocument(document(6), OPTIONS);
    await desktopSays({ type: 'upload', job, received: 0 });
    await desktopSays({ type: 'ack', job, received: 1 });
    await desktopSays({ type: 'ack', job, received: 1 });
    expect(chunkIndexes(await viewerSent())).toEqual([0, 1, 2, 3, 4, 1, 2, 3, 4]);
  });

  test('waits after the relay says busy, then sends again from the last acknowledged chunk', async () => {
    const { client, welcome, desktopSays, viewerSent, socket, timers } = await setup();
    await welcome();
    const job = client.uploadDocument(document(6), OPTIONS);
    await desktopSays({ type: 'upload', job, received: 0 });
    await desktopSays({ type: 'ack', job, received: 2 });
    socket().deliver({ t: 'error', code: 'busy' });
    await settle();
    const before = chunkIndexes(await viewerSent()).length;
    timers.advance(1_000);
    await settle();
    expect(chunkIndexes(await viewerSent()).slice(before)).toEqual([2, 3, 4, 5]);
  });

  test('after a reconnect asks only how accepted jobs are doing and never offers them again', async () => {
    const { client, welcome, desktopSays, viewerSent, socket, events, timers } = await setup();
    await welcome();
    const job = client.uploadDocument(document(1), OPTIONS);
    await desktopSays({ type: 'upload', job, received: 0 });
    await desktopSays({ type: 'ack', job, received: 1 });
    await desktopSays({ type: 'accepted', job, ahead: 2 });
    expect(events).toContainEqual({ type: 'queued', positions: [{ job, ahead: 2 }] });
    socket().drop();
    await settle();
    // RelaySocket 断线后等 1 秒重连（RECONNECT_DELAYS_MS 的第一项），新建一个连接。
    timers.advance(1_000);
    await welcome();
    const afterReconnect = (await viewerSent()).filter((message) => message.type !== 'hello');
    expect(afterReconnect.map((message) => message.type)).toEqual(['status']);
    await desktopSays({ type: 'unknown', jobs: [job] });
    expect(events).toContainEqual({ type: 'unknown', jobs: [job] });
  });

  test('says the computer is offline while the share is not found, and gives up after ten minutes', async () => {
    const { events, socket, timers } = await setup();
    socket().open();
    socket().deliver({ t: 'not-found' });
    await settle();
    expect(events).toContainEqual({ type: 'link', link: 'desktop-offline' });
    timers.advance(OFFLINE_GIVE_UP_MS);
    socket().open();
    socket().deliver({ t: 'not-found' });
    await settle();
    expect(events.at(-1)).toEqual({ type: 'offline' });
  });

  test('stops for good when the share is revoked', async () => {
    const { events, socket, welcome } = await setup();
    await welcome();
    socket().deliver({ t: 'ended', reason: 'revoked' });
    await settle();
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'revoked' });
  });
});
```

（「gives up」那条：`not-found` 之后中转服务会关掉连接，`RelaySocket` 按退避重连；`timers.advance` 把重连的计时器也跑掉了，所以要对最新的那个假连接再 `open()`、再送一次 `not-found`。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test relay/web/src/remote`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// relay/web/src/remote/remote-store.ts
/**
 * 远程打印页按共享保存的东西（localStorage，每个共享一条记录）：
 * - 令牌：这台设备被电脑接纳过的凭证，下次打开链接不用再确认；
 * - 已被电脑接受、还没看到结果的任务：刷新页面后只问进度，不重发（重发可能重打）。
 * 文件本身不存：最大 20MB，localStorage 放不下；上传中刷新页面要重新选文件。
 * 存储不可用（无痕模式、被禁用）时退回内存。读出来的内容照样校验。
 */
import { isRandomId } from '../../../../src/shared/mobile-protocol';
import { REMOTE_MAX_PENDING_JOBS, REMOTE_MAX_TITLE_LENGTH } from '../../../../src/shared/remote-protocol';
import type { KeyValueStorage } from '../session-store';

export interface AcceptedRecord {
  job: string;
  title: string;
}

export interface RemoteStore {
  readonly token: string | null;
  readonly accepted: readonly AcceptedRecord[];
  saveToken(token: string): void;
  saveAccepted(jobs: readonly AcceptedRecord[]): void;
}

interface StoredRecord {
  token: string | null;
  accepted: AcceptedRecord[];
  savedAt: number;
}

const KEY_PREFIX = 'labelflash.remote.v1.';
/** 90 天没打开过的共享记录清掉：共享多半早已撤销或到期。 */
export const REMOTE_RECORD_TTL_MS = 90 * 24 * 60 * 60_000;

export function openRemoteStore(storage: KeyValueStorage | null, session: string, now: () => number): RemoteStore {
  const key = KEY_PREFIX + session;
  removeStale(storage, key, now());
  let record: StoredRecord = read(storage, key) ?? { token: null, accepted: [], savedAt: now() };
  const save = (changes: Partial<StoredRecord>): void => {
    record = { ...record, ...changes, savedAt: now() };
    try {
      storage?.setItem(key, JSON.stringify(record));
    } catch (error) {
      console.warn('[remote-store] cannot save', error);
    }
  };
  return {
    get token() {
      return record.token;
    },
    get accepted() {
      return record.accepted;
    },
    saveToken(token) {
      save({ token });
    },
    saveAccepted(jobs) {
      save({ accepted: jobs.slice(-REMOTE_MAX_PENDING_JOBS * 2) });
    },
  };
}

function read(storage: KeyValueStorage | null, key: string): StoredRecord | null {
  try {
    const text = storage?.getItem(key) ?? null;
    return text === null ? null : parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function parse(value: unknown): StoredRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { token, accepted, savedAt } = value as Record<string, unknown>;
  if ((token !== null && !isRandomId(token)) || !Array.isArray(accepted) || typeof savedAt !== 'number') {
    return null;
  }
  const jobs: AcceptedRecord[] = [];
  for (const item of accepted) {
    const { job, title } = (item ?? {}) as Record<string, unknown>;
    if (!isRandomId(job) || typeof title !== 'string') {
      return null;
    }
    jobs.push({ job, title: title.slice(0, REMOTE_MAX_TITLE_LENGTH) });
  }
  return { token, accepted: jobs, savedAt };
}

function removeStale(storage: KeyValueStorage | null, currentKey: string, now: number): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < (storage?.length ?? 0); index += 1) {
      const key = storage?.key(index);
      if (key?.startsWith(KEY_PREFIX) && key !== currentKey) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      const record = read(storage, key);
      if (record === null || now - record.savedAt >= REMOTE_RECORD_TTL_MS) {
        storage?.removeItem(key);
      }
    }
  } catch (error) {
    console.warn('[remote-store] cannot clean up old shares', error);
  }
}
```

```ts
// relay/web/src/remote/remote-client.ts
/**
 * 远程打印页的协议：加入共享、打招呼（等电脑确认）、上传文件或填模板、看进度和结果。
 *
 * 和扫码页的 PhoneSession 同一套做法：任务号是幂等键；收发各串成一条链（加解密是异步的）；
 * 已被电脑接受的任务只问 status，不重发（重启前可能已经打了）。上传按 UploadWindow 发块：
 * 电脑说收到几块就从那里接着发；确认超时、中转服务说太忙或配额用完时退一步再发。
 */
import { openMessage, randomId, sealMessage } from '../../../../src/shared/mobile-crypto';
import {
  type EndReason,
  JOB_ACK_TIMEOUT_MS,
  JOB_STATUS_POLL_MS,
  MOBILE_PROTOCOL_VERSION,
  type PhoneField,
  type PhoneFrame,
  parseRelayToPhone,
  type QueuePosition,
  type RelayToPhone,
} from '../../../../src/shared/mobile-protocol';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../../../src/shared/relay-socket';
import { chunkAt, chunkCount, UploadWindow } from '../../../../src/shared/remote-chunks';
import {
  type DesktopToViewer,
  parseDesktopToViewer,
  REMOTE_CHUNK_ACK_TIMEOUT_MS,
  REMOTE_MAX_PENDING_JOBS,
  type RemoteCatalog,
  type RemoteCrop,
  type RemoteDenial,
  type RemoteDocument,
  type RemoteRefusal,
  type RemoteResult,
  type RemoteTemplate,
  type ViewerMessage,
} from '../../../../src/shared/remote-protocol';
import type { RemoteStore } from './remote-store';

/** 中转服务说对方太忙：等 1 秒再发（电脑那边的积压一般一两秒就发完）。 */
const BUSY_BACKOFF_MS = 1_000;
/** 中转服务说配额用完：等 5 秒（共享每秒回补 256KB，5 秒够几块）。 */
const QUOTA_BACKOFF_MS = 5_000;
/** 一直找不到这个共享（电脑没开、或者链接已撤销）：10 分钟后不再自己重试，给「重试」按钮。 */
export const OFFLINE_GIVE_UP_MS = 10 * 60_000;

/** 页面选好的文件：内容、种类（按文件头认的）和整份的 SHA-256。 */
export interface DocumentFile {
  name: string;
  kind: RemoteDocument['kind'];
  bytes: Uint8Array;
  sha256: Uint8Array;
}

export interface DocumentOptions {
  paper: string;
  crop: RemoteCrop;
  copies: number;
}

export type ClientEvent =
  | { type: 'link'; link: 'connecting' | 'desktop-offline' }
  | { type: 'pending' }
  | { type: 'welcomed'; share: string; expiresAt: number | null; catalog: RemoteCatalog }
  | { type: 'catalog'; catalog: RemoteCatalog }
  /** 新提交的任务，以及打开页面时从存储里恢复的、已被接受的任务。 */
  | { type: 'submitted'; job: string; title: string }
  | { type: 'uploading'; job: string; sent: number; total: number }
  | { type: 'queued'; positions: QueuePosition[] }
  | { type: 'started'; job: string; done: number; total: number }
  | { type: 'result'; job: string; result: RemoteResult }
  | { type: 'refused'; job: string; reason: RemoteRefusal }
  | { type: 'unknown'; jobs: string[] }
  | { type: 'denied'; reason: RemoteDenial }
  | { type: 'ended'; reason: EndReason }
  /** 一直找不到这个共享，已停止重试。 */
  | { type: 'offline' }
  | { type: 'outdated' };

export interface RemoteClientOptions {
  relayUrl: string;
  session: string;
  key: CryptoKey;
  device: string;
  /** 对方在页面上填的名字（每次打招呼时取最新的）。 */
  name: () => string;
  store: RemoteStore;
  createSocket: (url: string) => SocketLike;
  timers: SocketTimers;
  now: () => number;
  onEvent: (event: ClientEvent) => void;
}

type Outgoing =
  | {
      kind: 'document';
      title: string;
      file: DocumentFile;
      options: DocumentOptions;
      window: UploadWindow | null;
      timer: unknown;
    }
  | { kind: 'template'; title: string; template: string; fields: PhoneField[]; copies: number; timer: unknown };

export class RemoteClient {
  private readonly socket: RelaySocket<PhoneFrame>;
  private nonce: string | null = null;
  private seq = 0;
  /** 还没被电脑接受的任务（上传中、等回复）：每次被接纳后重发。 */
  private readonly outbox = new Map<string, Outgoing>();
  /** 已被接受、还没结果的任务：只问 status。 */
  private readonly waiting = new Map<string, string>();
  private pollTimer: unknown = null;
  private backoffTimer: unknown = null;
  private missingSince: number | null = null;
  private inbox: Promise<void> = Promise.resolve();
  private outgoing: Promise<void> = Promise.resolve();
  private isStopped = false;

  constructor(private readonly options: RemoteClientOptions) {
    for (const { job, title } of options.store.accepted) {
      this.waiting.set(job, title);
    }
    this.socket = new RelaySocket<PhoneFrame>({
      url: options.relayUrl,
      createSocket: options.createSocket,
      timers: options.timers,
      onOpen: () => this.socket.send({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: options.session }),
      onFrame: (value) => {
        const frame = parseRelayToPhone(value);
        if (frame) {
          this.enqueue(() => this.handle(frame));
        } else {
          console.warn('[RemoteClient] dropped a malformed relay frame');
        }
      },
      onDown: () => this.enqueue(async () => this.handleDown()),
    });
  }

  start(): void {
    for (const [job, title] of this.waiting) {
      this.emit({ type: 'submitted', job, title });
    }
    this.socket.start();
  }

  stop(): void {
    this.isStopped = true;
    this.leaveChannel();
    this.socket.stop();
  }

  /** 放弃之后（offline）再试一次。 */
  retry(): void {
    this.isStopped = false;
    this.missingSince = null;
    this.emit({ type: 'link', link: 'connecting' });
    this.socket.start();
  }

  uploadDocument(file: DocumentFile, options: DocumentOptions): string {
    const job = randomId();
    this.outbox.set(job, { kind: 'document', title: file.name, file, options, window: null, timer: null });
    this.emit({ type: 'submitted', job, title: file.name });
    this.sendJob(job);
    return job;
  }

  fillTemplate(template: RemoteTemplate, fields: PhoneField[], copies: number): string {
    const job = randomId();
    this.outbox.set(job, { kind: 'template', title: template.name, template: template.id, fields, copies, timer: null });
    this.emit({ type: 'submitted', job, title: template.name });
    this.sendJob(job);
    return job;
  }

  private enqueue(task: () => Promise<void>): void {
    this.inbox = this.inbox.then(task).catch((error: unknown) => {
      console.error('[RemoteClient] cannot handle a relay frame', error);
    });
  }

  private async handle(frame: RelayToPhone): Promise<void> {
    switch (frame.t) {
      case 'online':
        this.socket.markReady();
        this.missingSince = null;
        await this.transmit({
          type: 'hello',
          token: this.options.store.token,
          device: this.options.device,
          name: this.options.name(),
        });
        return;
      case 'waiting':
        this.socket.markReady();
        this.leaveChannel();
        this.emit({ type: 'link', link: 'desktop-offline' });
        return;
      case 'recv': {
        const message = parseDesktopToViewer(
          await openMessage(this.options.key, 'd2v', this.options.session, frame.body),
        );
        if (message) {
          this.receive(message);
        } else {
          console.warn('[RemoteClient] dropped a message that could not be decrypted or parsed');
        }
        return;
      }
      case 'ended':
        if (frame.reason === 'revoked' || frame.reason === 'expired') {
          this.finish({ type: 'ended', reason: frame.reason });
        } else {
          // 电脑退出、断线太久：共享还在，等它回来（中转服务关掉连接后 RelaySocket 按退避重连）。
          this.leaveChannel();
          this.emit({ type: 'link', link: 'desktop-offline' });
        }
        return;
      case 'kicked':
        this.finish({ type: 'denied', reason: 'removed' });
        return;
      case 'not-found':
        this.handleMissing();
        return;
      case 'error':
        if (frame.code === 'version') {
          this.finish({ type: 'outdated' });
        } else if (frame.code === 'busy' || frame.code === 'quota') {
          this.backOff(frame.code === 'busy' ? BUSY_BACKOFF_MS : QUOTA_BACKOFF_MS);
        } else {
          console.warn(`[RemoteClient] relay error ${frame.code}`);
        }
        return;
      case 'pong':
        return;
    }
  }

  private receive(message: DesktopToViewer): void {
    switch (message.type) {
      case 'welcome':
        this.options.store.saveToken(message.token);
        this.nonce = message.nonce;
        this.seq = 0;
        this.emit({ type: 'welcomed', share: message.share, expiresAt: message.expiresAt, catalog: message.catalog });
        for (const job of this.outbox.keys()) {
          this.sendJob(job);
        }
        this.askStatus();
        return;
      case 'pending':
        this.emit({ type: 'pending' });
        return;
      case 'denied':
        this.finish({ type: 'denied', reason: message.reason });
        return;
      case 'catalog':
        this.emit({ type: 'catalog', catalog: message.catalog });
        return;
      case 'upload': {
        const job = this.outbox.get(message.job);
        if (job?.kind !== 'document') {
          return;
        }
        job.window ??= new UploadWindow(chunkCount(job.file.bytes.length));
        job.window.resume(message.received);
        this.emit({ type: 'uploading', job: message.job, sent: message.received, total: job.window.chunks });
        this.pump(message.job);
        return;
      }
      case 'ack': {
        const job = this.outbox.get(message.job);
        if (job?.kind !== 'document' || job.window === null) {
          return;
        }
        if (job.window.acknowledge(message.received)) {
          this.emit({ type: 'uploading', job: message.job, sent: message.received, total: job.window.chunks });
          this.pump(message.job);
        } else if (job.window.repeated(message.received)) {
          this.pump(message.job);
        }
        return;
      }
      case 'accepted':
        this.markAccepted(message.job);
        this.emit({ type: 'queued', positions: [{ job: message.job, ahead: message.ahead }] });
        return;
      case 'queue': {
        const known = message.jobs.filter((position) => this.waiting.has(position.job));
        if (known.length > 0) {
          this.emit({ type: 'queued', positions: known });
        }
        return;
      }
      case 'started':
        this.markAccepted(message.job);
        this.emit({ type: 'started', job: message.job, done: message.done, total: message.total });
        return;
      case 'result':
        if (this.forget(message.job)) {
          this.emit({ type: 'result', job: message.job, result: message.result });
        }
        return;
      case 'refused':
        if (this.forget(message.job)) {
          this.emit({ type: 'refused', job: message.job, reason: message.reason });
        }
        return;
      case 'unknown': {
        const known = message.jobs.filter((job) => this.forget(job));
        if (known.length > 0) {
          this.emit({ type: 'unknown', jobs: known });
        }
        return;
      }
    }
  }

  /** 发出（或重发）一个还没被接受的任务：文件发 offer（电脑回从第几块开始），模板发 fill。 */
  private sendJob(jobId: string): void {
    const job = this.outbox.get(jobId);
    if (!job || this.nonce === null) {
      return;
    }
    const head = { nonce: this.nonce, seq: this.nextSeq(), job: jobId };
    if (job.kind === 'document') {
      const { file, options } = job;
      void this.transmit({
        type: 'offer',
        ...head,
        document: { name: file.name, kind: file.kind, bytes: file.bytes.length, sha256: file.sha256 },
        paper: options.paper,
        crop: options.crop,
        copies: options.copies,
      });
    } else {
      void this.transmit({ type: 'fill', ...head, template: job.template, fields: job.fields, copies: job.copies });
    }
    this.scheduleRetry(jobId, JOB_ACK_TIMEOUT_MS);
  }

  /** 把窗口里能发的块都发出去；等确认超时就重发 offer，电脑回 upload 告诉从哪里接着发。 */
  private pump(jobId: string): void {
    const job = this.outbox.get(jobId);
    if (job?.kind !== 'document' || job.window === null || this.nonce === null) {
      return;
    }
    for (const index of job.window.takeSendable()) {
      void this.transmit({
        type: 'chunk',
        nonce: this.nonce,
        seq: this.nextSeq(),
        job: jobId,
        index,
        data: chunkAt(job.file.bytes, index),
      });
    }
    this.scheduleRetry(jobId, REMOTE_CHUNK_ACK_TIMEOUT_MS);
  }

  /** 中转服务丢了帧：等一会儿，从最后确认的块重发。 */
  private backOff(delayMs: number): void {
    if (this.backoffTimer !== null) {
      return;
    }
    this.backoffTimer = this.options.timers.setTimeout(() => {
      this.backoffTimer = null;
      for (const [jobId, job] of this.outbox) {
        if (job.kind === 'document' && job.window !== null) {
          job.window.resume(job.window.acknowledged);
          this.pump(jobId);
        }
      }
    }, delayMs);
  }

  private scheduleRetry(jobId: string, delayMs: number): void {
    const job = this.outbox.get(jobId);
    if (!job) {
      return;
    }
    this.clearTimer(job.timer);
    job.timer = this.options.timers.setTimeout(() => {
      job.timer = null;
      this.sendJob(jobId);
    }, delayMs);
  }

  /** 已被接受的任务：从发件箱移到「只问进度」，存起来（刷新页面后接着问）。 */
  private markAccepted(jobId: string): void {
    const job = this.outbox.get(jobId);
    if (!job) {
      return;
    }
    this.clearTimer(job.timer);
    this.outbox.delete(jobId);
    this.waiting.set(jobId, job.title);
    this.saveWaiting();
    this.schedulePoll();
  }

  private forget(jobId: string): boolean {
    const outgoing = this.outbox.get(jobId);
    if (outgoing) {
      this.clearTimer(outgoing.timer);
      this.outbox.delete(jobId);
      return true;
    }
    if (this.waiting.delete(jobId)) {
      this.saveWaiting();
      return true;
    }
    return false;
  }

  private askStatus(): void {
    if (this.nonce === null || this.waiting.size === 0) {
      return;
    }
    const jobs = [...this.waiting.keys()];
    for (let start = 0; start < jobs.length; start += REMOTE_MAX_PENDING_JOBS) {
      void this.transmit({
        type: 'status',
        nonce: this.nonce,
        seq: this.nextSeq(),
        jobs: jobs.slice(start, start + REMOTE_MAX_PENDING_JOBS),
      });
    }
    this.schedulePoll();
  }

  /** 已被接受的任务长时间没有消息也问一次：中转服务可能丢帧，端到端靠这个补上。 */
  private schedulePoll(): void {
    this.clearTimer(this.pollTimer);
    this.pollTimer = this.options.timers.setTimeout(() => {
      this.pollTimer = null;
      this.askStatus();
    }, JOB_STATUS_POLL_MS);
  }

  private handleDown(): void {
    this.leaveChannel();
    this.emit({ type: 'link', link: this.missingSince === null ? 'connecting' : 'desktop-offline' });
  }

  /** 中转服务不认识这个共享：电脑没开着程序，或者链接已撤销、到期。等一段时间，过了就不再自己试。 */
  private handleMissing(): void {
    const now = this.options.now();
    this.missingSince ??= now;
    if (now - this.missingSince >= OFFLINE_GIVE_UP_MS) {
      this.emit({ type: 'offline' });
      this.leaveChannel();
      this.socket.stop();
      return;
    }
    this.emit({ type: 'link', link: 'desktop-offline' });
  }

  /** 离开当前连接：nonce 作废，计时器停掉；发件箱和等着的任务都留着，下次被接纳后接着来。 */
  private leaveChannel(): void {
    this.nonce = null;
    for (const job of this.outbox.values()) {
      this.clearTimer(job.timer);
      job.timer = null;
    }
    this.clearTimer(this.pollTimer);
    this.pollTimer = null;
    this.clearTimer(this.backoffTimer);
    this.backoffTimer = null;
  }

  private transmit(message: ViewerMessage): Promise<void> {
    this.outgoing = this.outgoing
      .then(async () => {
        const body = await sealMessage(this.options.key, 'v2d', this.options.session, message);
        this.socket.send({ t: 'send', body });
      })
      .catch((error: unknown) => console.error('[RemoteClient] cannot send a message', error));
    return this.outgoing;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private saveWaiting(): void {
    this.options.store.saveAccepted([...this.waiting].map(([job, title]) => ({ job, title })));
  }

  private clearTimer(handle: unknown): void {
    if (handle !== null) {
      this.options.timers.clearTimeout(handle);
    }
  }

  /** 这台设备在这个共享里结束了（撤销、到期、被移除、被拒绝、页面要更新）。 */
  private finish(event: ClientEvent): void {
    this.emit(event);
    this.stop();
  }

  private emit(event: ClientEvent): void {
    if (!this.isStopped) {
      this.options.onEvent(event);
    }
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test relay/web/src/remote`
Expected: PASS。「sends again from a gap」：窗口 4、确认到 1 之后已经发到第 4 块；同一个确认再来一次，从第 1 块重发 1–4。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add relay/web/src/remote/remote-store.ts relay/web/src/remote/remote-store.test.ts relay/web/src/remote/remote-client.ts relay/web/src/remote/remote-client.test.ts
git commit -m "feat(remote): the remote page's side of the protocol" -m "The page joins a share, says hello with its saved token and name, uploads files in an acknowledged window, and resumes from the chunk the desktop names after a gap, a busy or quota drop, or a reconnect. Accepted jobs are remembered across reloads and only asked about, never resent, so a computer restart cannot cause a second print. A share that stays missing for ten minutes stops retrying until the user asks." -m "$TRAILER"
```

---

### Task 14: 一个共享的连接编排 RemoteHost

每个共享一个 `RemoteHost`：一条 `/ws/desktop` 连接（`kind: 'share'`，断线按退避重连，同一个所有权密钥接管）、收发两条加解密链、把消息交给 `RemoteSession`、把它的回复和打印队列的进度发回去。和 `MobileHost` 同一个写法，不 import electron。集成测试用真实的中转服务和 Task 13 的 `RemoteClient`。

**Files:**
- Create: `src/main/remote/remote-host.ts`、`src/main/remote/remote-host.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/remote/remote-host.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningRelay, startRelay } from '../../../relay/src/server';
import { type ClientEvent, RemoteClient } from '../../../relay/web/src/remote/remote-client';
import { openRemoteStore } from '../../../relay/web/src/remote/remote-store';
import { FakeClock } from '../../core/testing/fake-clock';
import { importSessionKey, randomId, randomKey } from '../../shared/mobile-crypto';
import type { SocketLike, SocketTimers } from '../../shared/relay-socket';
import { buildShareUrl, parseShareFragment, REMOTE_CHUNK_BYTES, type RemoteCatalog } from '../../shared/remote-protocol';
import type { StoredDevice } from '../storage/sqlite-remote-share-store';
import { StoreDeviceRegistry } from './device-registry';
import { RemoteHost } from './remote-host';
import { type AcceptedJob, ByteBudget, RemoteSession } from './remote-session';

const ORIGIN = 'https://relay.example.com';
const WAIT_LIMIT_MS = 10_000;
const CATALOG: RemoteCatalog = { papers: [{ key: '100x150', label: '100×150' }], templates: [] };
/** 2.3 块：三块，最后一块不满。 */
const FILE = Uint8Array.from({ length: Math.floor(REMOTE_CHUNK_BYTES * 2.3) }, (_, index) => (index * 7) % 256);

const timers: SocketTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let root: string;
let relay: RunningRelay;
let host: RemoteHost;
let session: RemoteSession;
let accepted: AcceptedJob[];
let approve: boolean;
let shareUrl: string;
const clients: RemoteClient[] = [];

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await Bun.sleep(10);
  }
}

/** 测试用的设备表：内存里。 */
function memoryDevices() {
  const rows: StoredDevice[] = [];
  return {
    devices: (shareId: string) => rows.filter((row) => row.shareId === shareId),
    addDevice: (device: StoredDevice) => rows.push(device),
    touchDevice: () => undefined,
    removeDevice: (shareId: string, id: string) => {
      rows.splice(rows.findIndex((row) => row.shareId === shareId && row.id === id), 1);
    },
  };
}

async function connectViewer(events: ClientEvent[]): Promise<RemoteClient> {
  const fragment = parseShareFragment(new URL(shareUrl).hash);
  if (!fragment) {
    throw new Error(`bad share url ${shareUrl}`);
  }
  const client = new RemoteClient({
    relayUrl: `ws://127.0.0.1:${relay.url.port}/ws/remote`,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device: '电脑 · 测试',
    name: () => '张三',
    store: openRemoteStore(null, fragment.session, () => Date.now()),
    createSocket: (url) => new WebSocket(url, { headers: { Origin: ORIGIN } }) as unknown as SocketLike,
    timers,
    now: () => Date.now(),
    onEvent: (event) => events.push(event),
  });
  clients.push(client);
  client.start();
  return client;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'remote-host-'));
  relay = startRelay(
    { host: '127.0.0.1', port: 0, publicOrigin: ORIGIN, webRoot: root, remoteRoot: root, version: 'test' },
    () => {},
  );
  accepted = [];
  approve = false;
  const sessionId = randomId();
  const key = randomKey();
  const base = new URL(`http://127.0.0.1:${relay.url.port}/`);
  shareUrl = buildShareUrl(base.href, sessionId, key);
  session = new RemoteSession({
    clock: new FakeClock(Date.now()),
    devices: new StoreDeviceRegistry(memoryDevices(), 'share-1', new FakeClock()),
    budget: new ByteBudget(FILE.length * 4),
    catalog: () => CATALOG,
    approveNewDevices: () => approve,
  });
  host = new RemoteHost({
    keys: { sessionId, ownerSecret: randomId(), key },
    relayBase: base,
    timers,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    session,
    shareName: () => '北京仓',
    expiresAt: null,
    catalog: () => CATALOG,
    submit: (job) => {
      accepted.push(job);
      return 0;
    },
    onChange: () => undefined,
    log: () => undefined,
  });
  host.start();
  await waitFor(() => host.state().link === 'online', 'the share session to open');
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.stop();
  }
  host.stop('quit');
  await relay.stop();
  await rm(root, { recursive: true, force: true });
});

describe('RemoteHost', () => {
  test('welcomes a viewer with the share name and the catalog', async () => {
    const events: ClientEvent[] = [];
    await connectViewer(events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    expect(events).toContainEqual({ type: 'welcomed', share: '北京仓', expiresAt: null, catalog: CATALOG });
  });

  test('takes a file in chunks through the relay and hands over exactly that file', async () => {
    const events: ClientEvent[] = [];
    const client = await connectViewer(events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    const job = client.uploadDocument(
      { name: '面单.pdf', kind: 'pdf', bytes: FILE, sha256: createHash('sha256').update(FILE).digest() },
      { paper: '100x150', crop: 'trim', copies: 2 },
    );
    await waitFor(() => accepted.length === 1, 'the accepted job');
    expect(accepted[0]).toMatchObject({ job, title: '面单.pdf', spec: { kind: 'document', copies: 2 } });
    expect(accepted[0]?.spec.kind === 'document' ? accepted[0].spec.bytes : null).toEqual(FILE);
    expect(events).toContainEqual({ type: 'uploading', job, sent: 3, total: 3 });
    await waitFor(() => events.some((event) => event.type === 'queued'), 'the queue position');

    host.deliver(session.progressed(job, { type: 'started', job, done: 1, total: 2 }));
    host.deliver(session.finished(job, { status: 'sent', labels: 2 }));
    await waitFor(() => events.some((event) => event.type === 'result'), 'the result');
    expect(events).toContainEqual({ type: 'started', job, done: 1, total: 2 });
    expect(events).toContainEqual({ type: 'result', job, result: { status: 'sent', labels: 2 } });
  });

  test('lets a new device in only after the operator allows it', async () => {
    approve = true;
    const events: ClientEvent[] = [];
    await connectViewer(events);
    await waitFor(() => events.some((event) => event.type === 'pending'), 'the pending notice');
    const [request] = session.pendingApprovals();
    expect(request?.label).toBe('张三 · 电脑 · 测试');
    host.decide(request?.requestId ?? '', true);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
  });

  test('turns a refused device away', async () => {
    approve = true;
    const events: ClientEvent[] = [];
    await connectViewer(events);
    await waitFor(() => session.pendingApprovals().length === 1, 'the approval request');
    host.decide(session.pendingApprovals()[0]?.requestId ?? '', false);
    await waitFor(() => events.some((event) => event.type === 'denied'), 'the denial');
    expect(events).toContainEqual({ type: 'denied', reason: 'refused' });
  });

  test('tells connected viewers that the share was revoked', async () => {
    const events: ClientEvent[] = [];
    await connectViewer(events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    host.stop('revoked');
    await waitFor(() => events.some((event) => event.type === 'ended'), 'the end');
    expect(events).toContainEqual({ type: 'ended', reason: 'revoked' });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/remote/remote-host.test.ts`
Expected: FAIL，`Cannot find module './remote-host'`。

- [ ] **Step 3: 实现**

```ts
// src/main/remote/remote-host.ts
/**
 * 一个远程共享和中转服务之间的连接：共享有效、程序开着就一直连着（kind = share），断线按退避重连，
 * 用同一个所有权密钥接管自己的会话。收发各串成一条链（加解密是异步的）；消息交给 RemoteSession，
 * 新任务交给打印队列（deps.submit），进度和结果由调用方经 deliver 发回。
 * 不依赖 Electron：WebSocket、计时器由参数注入，集成测试用真实的中转服务和远程打印页的协议代码。
 */
import { importSessionKey, openMessage, sealMessage } from '../../shared/mobile-crypto';
import {
  type CloseReason,
  type DesktopFrame,
  MOBILE_PROTOCOL_VERSION,
  parseRelayToDesktop,
  type RelayToDesktop,
  type SealedBody,
} from '../../shared/mobile-protocol';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../shared/relay-socket';
import { type DesktopToViewer, parseViewerMessage, type RemoteCatalog } from '../../shared/remote-protocol';
import { desktopSocketUrl } from '../mobile/relay-endpoint';
import type { AcceptedJob, Delivery, HelloOutcome, RemoteSession } from './remote-session';

/** 共享在中转服务上的凭证：会话号、所有权密钥（只给中转服务）、内容密钥（只在链接的 # 里）。 */
export interface RemoteShareKeys {
  sessionId: string;
  ownerSecret: string;
  key: string;
}

/** 和中转服务的连接：connecting = 还没连上；online = 会话已登记；offline = 断了、在重连；failed = 不会自己恢复。 */
export type RemoteLink = 'connecting' | 'online' | 'offline' | 'failed';
/** version = 中转服务不支持这个版本；session-taken = 会话号被别人占了（正常不会发生）；server-busy = 中转服务满了（还在重试）。 */
export type RemoteHostFailure = 'version' | 'session-taken' | 'server-busy';

export interface RemoteHostDeps {
  keys: RemoteShareKeys;
  relayBase: URL;
  timers: SocketTimers;
  createSocket: (url: string) => SocketLike;
  session: RemoteSession;
  /** 共享名（welcome 里给对方看，改名后下次打招呼就是新名字）。 */
  shareName: () => string;
  expiresAt: number | null;
  catalog: () => RemoteCatalog;
  /** 新任务交给打印队列，返回前面还有几个。 */
  submit: (job: AcceptedJob) => number;
  /** 连接、设备、等确认的列表变了：重新推状态给界面。 */
  onChange: () => void;
  log: (line: string) => void;
}

export class RemoteHost {
  private readonly key: Promise<CryptoKey>;
  private readonly socket: RelaySocket<DesktopFrame>;
  private link: RemoteLink = 'connecting';
  private failure: RemoteHostFailure | null = null;
  private inbox: Promise<void> = Promise.resolve();
  private outgoing: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RemoteHostDeps) {
    this.key = importSessionKey(deps.keys.key);
    this.socket = new RelaySocket<DesktopFrame>({
      url: desktopSocketUrl(deps.relayBase),
      createSocket: deps.createSocket,
      timers: deps.timers,
      onOpen: () => {
        this.socket.send({
          t: 'open',
          v: MOBILE_PROTOCOL_VERSION,
          session: deps.keys.sessionId,
          secret: deps.keys.ownerSecret,
          kind: 'share',
        });
      },
      onFrame: (value) => {
        const frame = parseRelayToDesktop(value);
        if (!frame) {
          deps.log('remote: dropped a malformed relay frame');
          return;
        }
        this.enqueue(() => this.handle(frame));
      },
      onDown: () => {
        if (this.link !== 'failed') {
          this.link = 'offline';
        }
        deps.log('remote: relay connection lost, reconnecting');
        deps.onChange();
      },
    });
  }

  start(): void {
    this.socket.start();
  }

  /** 结束：撤销、到期时让中转服务告诉在线的页面；程序退出时说 quit（共享还在，下次启动再连）。 */
  stop(reason: CloseReason): void {
    this.socket.send({ t: 'close', reason });
    this.socket.stop();
  }

  state(): { link: RemoteLink; failure: RemoteHostFailure | null } {
    return { link: this.link, failure: this.failure };
  }

  /** 电脑上点了「允许」或「拒绝」。 */
  decide(requestId: string, allow: boolean): void {
    const decision = this.deps.session.decide(requestId, allow);
    if (decision !== null) {
      this.answerHello(decision.connection, decision.outcome);
    }
    this.deps.onChange();
  }

  /** 移除一台设备：断开它，返回它交给打印队列的任务（调用方取消还没开始的）。 */
  removeDevice(deviceId: string): string[] {
    const { kick, running } = this.deps.session.removeDevice(deviceId);
    if (kick !== null) {
      this.send(kick, { type: 'denied', reason: 'removed' });
      this.sendFrame({ t: 'kick', phone: kick });
    }
    this.deps.onChange();
    return running;
  }

  /** 发出会话给的消息（进度、排队位置、结果）。 */
  deliver(deliveries: readonly Delivery[]): void {
    for (const { connection, message } of deliveries) {
      this.send(connection, message);
    }
  }

  /** 共享的模板、纸张变了：告诉在线的页面。 */
  catalogChanged(): void {
    const catalog = this.deps.catalog();
    for (const connection of this.deps.session.onlineConnections()) {
      this.send(connection, { type: 'catalog', catalog });
    }
  }

  /** 定时调用：闲置的上传、过期的确认。 */
  tick(): void {
    const deliveries = this.deps.session.tick();
    for (const { connection, message } of deliveries) {
      this.send(connection, message);
      this.sendFrame({ t: 'kick', phone: connection });
    }
    if (deliveries.length > 0) {
      this.deps.onChange();
    }
  }

  /** 排进收件链。一条处理出错只记日志，不能卡住后面的。 */
  private enqueue(task: () => Promise<void>): void {
    this.inbox = this.inbox
      .then(task)
      .catch((error: unknown) => this.deps.log(`remote: failed to handle a relay frame: ${String(error)}`));
  }

  private async handle(frame: RelayToDesktop): Promise<void> {
    switch (frame.t) {
      case 'opened':
        this.link = 'online';
        this.failure = null;
        this.deps.session.relayOpened();
        this.socket.markReady();
        this.deps.onChange();
        return;
      case 'joined':
        this.deps.session.viewerJoined(frame.phone);
        return;
      case 'left':
        this.deps.session.viewerLeft(frame.phone);
        this.deps.onChange();
        return;
      case 'recv':
        await this.receive(frame.phone, frame.body);
        return;
      case 'error':
        this.handleRelayError(frame.code);
        return;
      case 'pong':
        return;
    }
  }

  private async receive(connection: string, body: SealedBody): Promise<void> {
    const message = parseViewerMessage(await openMessage(await this.key, 'v2d', this.deps.keys.sessionId, body));
    if (!message) {
      this.deps.log('remote: dropped a viewer message that could not be decrypted or parsed');
      return;
    }
    if (message.type === 'hello') {
      this.answerHello(connection, this.deps.session.hello(connection, message));
      // 设备名来自对方，已去掉控制字符；写日志时仍加引号，看得出它是外来的文字。
      this.deps.log(`remote: hello from ${JSON.stringify(message.name || message.device)}`);
      this.deps.onChange();
      return;
    }
    const decision = this.deps.session.receive(connection, message);
    for (const reply of decision.messages) {
      this.send(connection, reply);
    }
    if (decision.kind === 'accept') {
      const { job } = decision.accepted;
      const ahead = this.deps.submit(decision.accepted);
      this.deliver(this.deps.session.progressed(job, { type: 'accepted', job, ahead }));
      this.deps.onChange();
    }
  }

  private answerHello(connection: string, outcome: HelloOutcome): void {
    switch (outcome.kind) {
      case 'welcome':
        this.send(connection, {
          type: 'welcome',
          token: outcome.token,
          nonce: outcome.nonce,
          share: this.deps.shareName(),
          expiresAt: this.deps.expiresAt,
          catalog: this.deps.catalog(),
        });
        return;
      case 'pending':
        this.send(connection, { type: 'pending' });
        return;
      case 'denied':
        this.send(connection, { type: 'denied', reason: outcome.reason });
        this.sendFrame({ t: 'kick', phone: connection });
        return;
    }
  }

  private handleRelayError(code: Extract<RelayToDesktop, { t: 'error' }>['code']): void {
    this.deps.log(`remote: relay error ${code}`);
    switch (code) {
      case 'version':
      case 'session-taken':
        // 重试也没用：停下，界面说明原因（版本：更新软件；会话号被占：检查中转地址）。会话号不换：链接已经发给别人了。
        this.link = 'failed';
        this.failure = code;
        this.socket.stop();
        this.deps.onChange();
        return;
      case 'server-busy':
        this.failure = 'server-busy';
        this.deps.onChange();
        return;
      case 'rate-limited':
      case 'bad-frame':
      case 'busy':
      case 'quota':
        return;
    }
  }

  private send(connection: string, message: DesktopToViewer): void {
    this.outgoing = this.outgoing
      .then(async () => {
        const body = await sealMessage(await this.key, 'd2v', this.deps.keys.sessionId, message);
        this.socket.send({ t: 'send', phone: connection, body });
      })
      .catch((error: unknown) => this.deps.log(`remote: failed to send to a viewer: ${String(error)}`));
  }

  /** 不加密的外层帧（踢出）也排进发送链，保证在它前面的消息先发出去。 */
  private sendFrame(frame: DesktopFrame): void {
    this.outgoing = this.outgoing
      .then(() => {
        this.socket.send(frame);
      })
      .catch((error: unknown) => this.deps.log(`remote: failed to send a relay frame: ${String(error)}`));
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/remote`
Expected: PASS。上传那条走真实的中转服务：页面按窗口发三块，电脑逐块确认，收齐核对 SHA-256 后交出，页面看到 `uploading 3/3` 和排队位置。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/remote/remote-host.ts src/main/remote/remote-host.test.ts
git commit -m "feat(remote): keep each share connected to the relay and route its viewers" -m "A share holds a long-lived share session on the relay and takes it over with its owner secret after a reconnect. Viewer messages are decrypted in order and handed to the session; replies, approvals, queue positions and results are sealed and sent back in order. An integration test uploads a file in chunks through a real relay with the page's own protocol code." -m "$TRAILER"
```

---

### Task 15: 远程共享在主进程里的接线 RemoteStation

管所有共享：启动时读出、按中转地址各开一个 `RemoteHost`；新建、改、撤销、到期；设备确认（询问条 + 系统通知）、移除设备；任务排进 `RemoteQueue`，按打印机一条队执行（文件交 `DocumentJobService`，模板清洗字段后逐份 `printFields`），进度最多每秒一次发回页面；状态合并后推给界面。不 import electron，依赖都由参数注入。

队的键：模板指定了打印机就是那台，否则按纸张查纸张分配（`paperPrinters`）里的打印机名，没分配就按纸张本身（结果会是 `no-printer`）。两种纸分配到同一台打印机时它们排同一条队。

**Files:**
- Create: `src/shared/remote-status.ts`
- Create: `src/main/remote/remote-station.ts`、`src/main/remote/remote-station.test.ts`

- [ ] **Step 1: 界面用的状态类型**

```ts
// src/shared/remote-status.ts
import type { RemoteResult } from './remote-protocol';

/** 主进程推给界面的远程共享状态（「共享」页、顶部的询问条）。 */
export interface RemoteStatus {
  /** 没有中转地址（设置里没填、安装包也没带）：共享都连不上。 */
  configured: boolean;
  shares: RemoteShareView[];
  /** 等电脑上确认的新设备，先来的在前。 */
  approvals: RemoteApprovalView[];
  /** 最近的远程任务（所有共享，新的在前，最多 RECENT_REMOTE_JOBS 条）。 */
  jobs: RemoteJobView[];
  /** 刚到期、已自动结束的共享名：「共享」页提示一次。 */
  expired: string[];
}

export interface RemoteShareView {
  id: string;
  name: string;
  /** 发给对方的链接（会话号和密钥在 # 后面）。 */
  url: string;
  createdAt: number;
  expiresAt: number | null;
  templateIds: string[];
  approveNewDevices: boolean;
  /** 和中转服务的连接：connecting / online / offline / failed。 */
  link: 'connecting' | 'online' | 'offline' | 'failed';
  /** 不会自己恢复（version、session-taken）或在重试中（server-busy）的原因。 */
  failure: 'version' | 'session-taken' | 'server-busy' | null;
  devices: RemoteDeviceView[];
}

export interface RemoteDeviceView {
  id: string;
  /** 对方填的名字和设备描述，例如「张三 · 电脑 · Edge」。 */
  label: string;
  online: boolean;
  /** 还没出结果的任务数。 */
  pending: number;
  lastSeenAt: number;
}

export interface RemoteApprovalView {
  requestId: string;
  shareId: string;
  shareName: string;
  device: string;
  at: number;
}

export interface RemoteJobView {
  /** 共享编号/任务号：界面列表的键。 */
  key: string;
  shareName: string;
  device: string;
  /** 文件名或模板名。 */
  title: string;
  state: 'queued' | 'printing' | 'done';
  ahead: number;
  done: number;
  total: number;
  result: RemoteResult | null;
  at: number;
}

/** 「共享」页显示的最近远程任务条数。 */
export const RECENT_REMOTE_JOBS = 20;

export type CreateShareResult = { ok: true; id: string } | { ok: false; issue: string };
```

- [ ] **Step 2: 写测试**

```ts
// src/main/remote/remote-station.test.ts
import { describe, expect, test } from 'bun:test';
import type { FieldsPrint } from '../../core/print-service';
import { REMOTE_SHARE_LIMITS, type ShareDraft } from '../../core/remote/share-model';
import { FakeClock } from '../../core/testing/fake-clock';
import { builtInCanvasTemplate } from '../../core/testing/templates';
import type { PrintResult } from '../../core/types';
import { randomId } from '../../shared/mobile-crypto';
import type { CloseReason } from '../../shared/mobile-protocol';
import type { RemoteStatus } from '../../shared/remote-status';
import type { DocumentOutcome, DocumentPrintRequest } from '../documents/document-job-service';
import { SecretError } from '../storage/sqlite-secret-store';
import type { StoredDevice, StoredShare } from '../storage/sqlite-remote-share-store';
import type { RemoteHostDeps } from './remote-host';
import type { AcceptedJob, Delivery } from './remote-session';
import { REMOTE_STATION_ISSUES, type RemoteHostPort, RemoteStation, type RemoteStationDeps } from './remote-station';

const PRINTED: PrintResult = { status: 'printed', jobId: 'j', scan: { raw: '', ruleId: 'remote', ruleName: '远程打印', fields: [] } };
const DRAFT: ShareDraft = { name: '北京仓', expiresInDays: 7, templateIds: ['custom:test-canvas'], approveNewDevices: false };
const RELAY = 'https://relay.example.com/labelflash/';

class MemoryStore {
  readonly shares: StoredShare[] = [];
  readonly deviceRows: StoredDevice[] = [];
  canEncrypt = true;
  list = () => [...this.shares];
  insert = (share: StoredShare) => {
    if (!this.canEncrypt) {
      throw new SecretError('这台电脑的系统加密不可用，不能创建远程共享');
    }
    this.shares.push(share);
  };
  update = (id: string, patch: Partial<StoredShare>) => {
    const index = this.shares.findIndex((share) => share.id === id);
    const share = this.shares[index];
    if (share) {
      this.shares[index] = { ...share, ...patch };
    }
  };
  remove = (id: string) => {
    this.shares.splice(this.shares.findIndex((share) => share.id === id), 1);
  };
  devices = (shareId: string) => this.deviceRows.filter((row) => row.shareId === shareId);
  addDevice = (device: StoredDevice) => {
    this.deviceRows.push(device);
  };
  touchDevice = () => undefined;
  removeDevice = (shareId: string, id: string) => {
    this.deviceRows.splice(this.deviceRows.findIndex((row) => row.shareId === shareId && row.id === id), 1);
  };
}

class FakeHost implements RemoteHostPort {
  readonly stops: CloseReason[] = [];
  readonly delivered: Delivery[] = [];
  readonly decisions: [string, boolean][] = [];
  catalogs = 0;
  started = false;
  constructor(readonly deps: Pick<RemoteHostDeps, 'keys' | 'relayBase' | 'session' | 'shareName' | 'expiresAt' | 'catalog' | 'submit' | 'onChange'>) {}
  start(): void {
    this.started = true;
  }
  stop(reason: CloseReason): void {
    this.stops.push(reason);
  }
  state() {
    return { link: 'online' as const, failure: null };
  }
  decide(requestId: string, allow: boolean): void {
    this.decisions.push([requestId, allow]);
  }
  removeDevice(deviceId: string): string[] {
    return this.deps.session.removeDevice(deviceId).running;
  }
  deliver(deliveries: readonly Delivery[]): void {
    this.delivered.push(...deliveries);
  }
  catalogChanged(): void {
    this.catalogs += 1;
  }
  tick(): void {}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function createStation(overrides: Partial<RemoteStationDeps> = {}) {
  const store = new MemoryStore();
  const clock = new FakeClock();
  const hosts: FakeHost[] = [];
  const statuses: RemoteStatus[] = [];
  const printed: FieldsPrint[] = [];
  const documents: DocumentPrintRequest[] = [];
  const approvals: string[] = [];
  const template = builtInCanvasTemplate(['品名', '价格']);
  let relay: string | null = RELAY;
  const deps: RemoteStationDeps = {
    store,
    clock,
    settings: () => ({ mobileRelayUrl: relay, paperPrinters: { '100x150': '面单机', '60x40': '标签机' } }),
    buildDefaultRelayUrl: null,
    findTemplate: (id) => (id === template.id ? template : null),
    documents: {
      print: async (request) => {
        documents.push(request);
        request.onProgress(1, 1);
        return { status: 'sent', labels: 1 } satisfies DocumentOutcome;
      },
    },
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    createHost: (hostDeps) => {
      const host = new FakeHost(hostDeps);
      hosts.push(host);
      return host;
    },
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    notifyApproval: (share, device) => approvals.push(`${share}：${device}`),
    schedule: (run) => {
      const timer = setTimeout(run, 0);
      return () => clearTimeout(timer);
    },
    log: () => undefined,
    ...overrides,
  };
  const station = new RemoteStation(deps);
  station.start();
  return {
    station,
    store,
    clock,
    hosts,
    statuses,
    printed,
    documents,
    approvals,
    template,
    setRelay: (value: string | null) => {
      relay = value;
    },
  };
}

/** 一台被接纳的设备，经 FakeHost 拿到的会话直接走 hello。 */
function welcomeDevice(host: FakeHost, name = '张三'): string {
  const connection = randomId();
  host.deps.session.viewerJoined(connection);
  host.deps.session.hello(connection, { type: 'hello', token: null, device: '电脑 · Edge', name });
  return connection;
}

function templateJob(host: FakeHost, fields = [{ name: '品名', value: '短袖' }], copies = 2): AcceptedJob {
  const [entry] = host.deps.session.devices();
  if (!entry) {
    throw new Error('no device');
  }
  return {
    job: randomId(),
    device: entry.device,
    title: '测试',
    spec: { kind: 'template', template: 'custom:test-canvas', fields, copies },
  };
}

describe('RemoteStation shares', () => {
  test('creates a share, connects it and lists it with a link that keeps its key after #', () => {
    const { station, hosts, store } = createStation();
    const result = station.create(DRAFT);
    expect(result.ok).toBe(true);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.started).toBe(true);
    const [share] = station.status().shares;
    expect(share).toMatchObject({ name: '北京仓', approveNewDevices: false, templateIds: ['custom:test-canvas'] });
    const url = new URL(share?.url ?? '');
    expect(url.href.startsWith(`${RELAY}r/#`)).toBe(true);
    expect(url.hash).toContain(store.shares[0]?.key ?? 'missing');
  });

  test('refuses more shares than the limit and explains when the system cannot encrypt', () => {
    const { station, store } = createStation();
    for (let index = 0; index < REMOTE_SHARE_LIMITS.shares; index += 1) {
      station.create({ ...DRAFT, name: `仓${index}` });
    }
    expect(station.create(DRAFT)).toEqual({ ok: false, issue: REMOTE_STATION_ISSUES.tooMany });
    const other = createStation();
    other.store.canEncrypt = false;
    expect(other.station.create(DRAFT)).toEqual({ ok: false, issue: '这台电脑的系统加密不可用，不能创建远程共享' });
    expect(store.shares).toHaveLength(REMOTE_SHARE_LIMITS.shares);
  });

  test('explains that there is no relay address', () => {
    const { station, setRelay } = createStation();
    setRelay(null);
    expect(station.create(DRAFT)).toEqual({ ok: false, issue: REMOTE_STATION_ISSUES.noRelay });
  });

  test('revokes a share: the relay is told, its jobs are canceled and the share is forgotten', async () => {
    const { station, hosts, store } = createStation({ printFields: () => new Promise(() => undefined) });
    const created = station.create(DRAFT);
    const host = hosts[0];
    if (!created.ok || !host) {
      throw new Error('not created');
    }
    welcomeDevice(host);
    host.deps.submit(templateJob(host));
    host.deps.submit(templateJob(host));
    await settle();
    station.revoke(created.id);
    expect(host.stops).toEqual(['revoked']);
    expect(store.shares).toEqual([]);
    expect(station.status().shares).toEqual([]);
    expect(station.pendingJobs).toBe(1);
  });

  test('ends a share when it expires and says so once', () => {
    const { station, hosts, clock } = createStation();
    station.create({ ...DRAFT, expiresInDays: 1 });
    clock.advance(24 * 60 * 60 * 1000);
    station.tick();
    expect(hosts[0]?.stops).toEqual(['expired']);
    expect(station.status().expired).toEqual(['北京仓']);
    station.dismissExpired();
    expect(station.status().expired).toEqual([]);
  });

  test('reconnects every share to a new relay address', () => {
    const { station, hosts, setRelay } = createStation();
    station.create(DRAFT);
    setRelay('https://other.example.com/');
    station.settingsChanged(
      { mobileRelayUrl: 'https://other.example.com/', paperPrinters: {} },
      { mobileRelayUrl: RELAY, paperPrinters: {} },
    );
    expect(hosts[0]?.stops).toEqual(['stopped']);
    expect(hosts[1]?.deps.relayBase.href).toBe('https://other.example.com/');
  });
});

describe('RemoteStation jobs', () => {
  test('prints a filled template with cleaned fields under the share and the device', async () => {
    const { station, hosts, printed } = createStation();
    station.create(DRAFT);
    const host = hosts[0];
    if (!host) {
      throw new Error('no host');
    }
    welcomeDevice(host);
    const job = templateJob(host, [{ name: '品名', value: '短袖‮' }]);
    expect(host.deps.submit(job)).toBe(0);
    await settle();
    await settle();
    expect(printed).toHaveLength(2);
    expect(printed[0]).toMatchObject({
      source: 'remote',
      caller: 'remote:北京仓 · 张三 · 电脑 · Edge',
      fields: [{ name: '品名', value: '短袖' }],
      printerName: null,
    });
    expect(host.delivered.map((delivery) => delivery.message)).toContainEqual({
      type: 'result',
      job: job.job,
      result: { status: 'sent', labels: 2 },
    });
  });

  test('says why a template job cannot print instead of printing it', async () => {
    const { station, hosts, printed } = createStation();
    station.create(DRAFT);
    const host = hosts[0];
    if (!host) {
      throw new Error('no host');
    }
    welcomeDevice(host);
    const job = templateJob(host, [{ name: '货架号', value: 'A-1' }]);
    host.deps.submit(job);
    await settle();
    await settle();
    expect(printed).toEqual([]);
    expect(host.delivered.at(-1)?.message).toMatchObject({ type: 'result', result: { status: 'invalid' } });
  });

  test('prints one job after another on the same printer and side by side on different printers', async () => {
    const releases: (() => void)[] = [];
    const { station, hosts, documents } = createStation({
      documents: {
        print: (request) =>
          new Promise<DocumentOutcome>((resolve) => {
            documents.push(request);
            releases.push(() => resolve({ status: 'sent', labels: 1 }));
          }),
      },
    });
    station.create(DRAFT);
    const host = hosts[0];
    if (!host) {
      throw new Error('no host');
    }
    welcomeDevice(host);
    const [entry] = host.deps.session.devices();
    const documentJob = (paper: string): AcceptedJob => ({
      job: randomId(),
      device: entry?.device ?? { id: '', label: '', approvedAt: 0, lastSeenAt: 0 },
      title: '面单.pdf',
      spec: { kind: 'document', name: '面单.pdf', bytes: new Uint8Array(4), paper, crop: 'trim', copies: 1 },
    });
    expect(host.deps.submit(documentJob('100x150'))).toBe(0);
    expect(host.deps.submit(documentJob('100x150'))).toBe(1);
    expect(host.deps.submit(documentJob('60x40'))).toBe(0);
    await settle();
    // 面单机上第一份在打、第二份等着；标签机上那份同时在打。
    expect(documents.map((request) => request.paperKey)).toEqual(['100x150', '60x40']);
    releases[0]?.();
    await settle();
    await settle();
    expect(documents.map((request) => request.paperKey)).toEqual(['100x150', '60x40', '100x150']);
    expect(host.delivered.map((delivery) => delivery.message)).toContainEqual(
      expect.objectContaining({ type: 'queue' }),
    );
  });
});

describe('RemoteStation devices', () => {
  test('asks the operator with a notification while a new device waits, and routes the answer', async () => {
    const { station, hosts, approvals } = createStation();
    station.create({ ...DRAFT, approveNewDevices: true });
    const host = hosts[0];
    if (!host) {
      throw new Error('no host');
    }
    const connection = randomId();
    host.deps.session.viewerJoined(connection);
    host.deps.session.hello(connection, { type: 'hello', token: null, device: '手机 · 微信', name: '李四' });
    host.deps.onChange();
    await settle();
    expect(approvals).toEqual(['北京仓：李四 · 手机 · 微信']);
    const [request] = station.status().approvals;
    station.decide(request?.requestId ?? '', true);
    expect(host.decisions).toEqual([[request?.requestId ?? '', true]]);
  });

  test('turns on approval for new devices after removing one', () => {
    const { station, hosts } = createStation();
    const created = station.create(DRAFT);
    const host = hosts[0];
    if (!created.ok || !host) {
      throw new Error('not created');
    }
    welcomeDevice(host);
    const [device] = station.status().shares[0]?.devices ?? [];
    station.removeDevice(created.id, device?.id ?? '');
    expect(station.status().shares[0]).toMatchObject({ approveNewDevices: true, devices: [] });
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/remote/remote-station.test.ts`
Expected: FAIL，`Cannot find module './remote-station'`。

- [ ] **Step 4: 实现**

```ts
// src/main/remote/remote-station.ts
/**
 * 「异地远程打印」在主进程里的接线：共享的增删改、到期、撤销；每个共享一个 RemoteHost；设备确认和移除；
 * 远程任务按打印机排队执行（文件交 DocumentJobService，模板清洗字段后逐份 printFields）；状态合并后推给界面。
 * 不 import electron：存储、打印、连接、计时都由参数注入，用 bun test 测试；index.ts 只负责创建它。
 */
import { prepareRemoteFields } from '../../core/remote/remote-fields';
import { REMOTE_SHARE_LIMITS, type ShareDraft, type SharePatch, shareExpiresAt } from '../../core/remote/share-model';
import type { FieldsPrint } from '../../core/print-service';
import { templateFields } from '../../core/api/template-fields';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { Clock, PrintResult } from '../../core/types';
import { randomId, randomKey } from '../../shared/mobile-crypto';
import type { CloseReason } from '../../shared/mobile-protocol';
import { formatPaperName, paperKey, parsePaperKey } from '../../shared/paper-sizes';
import {
  buildShareUrl,
  REMOTE_MAX_DOCUMENT_BYTES,
  REMOTE_MAX_LABELS_PER_JOB,
  REMOTE_MAX_TEMPLATES,
  type DesktopToViewer,
  type RemoteCatalog,
  type RemoteResult,
} from '../../shared/remote-protocol';
import {
  type CreateShareResult,
  RECENT_REMOTE_JOBS,
  type RemoteJobView,
  type RemoteStatus,
} from '../../shared/remote-status';
import type { AppSettings } from '../../shared/settings';
import type { DocumentJobService, DocumentOutcome } from '../documents/document-job-service';
import { resolveRelayBase } from '../mobile/relay-endpoint';
import { SecretError } from '../storage/sqlite-secret-store';
import type { SqliteRemoteShareStore, StoredShare } from '../storage/sqlite-remote-share-store';
import { type RemoteDevice, StoreDeviceRegistry } from './device-registry';
import type { RemoteHostDeps, RemoteHostFailure, RemoteLink } from './remote-host';
import { RemoteQueue } from './remote-queue';
import { type AcceptedJob, ByteBudget, type Delivery, RemoteSession, type RemoteJobSpec } from './remote-session';

/** 检查到期、闲置上传、过期确认的间隔：到期精确到几秒就够了。 */
export const REMOTE_TICK_INTERVAL_MS = 5_000;
/** 上传中和排队中的文件合计最多 100MB：够 5 份最大的文件同时在路上，主进程不会被撑大。 */
export const REMOTE_DOCUMENT_BUDGET_BYTES = 5 * REMOTE_MAX_DOCUMENT_BYTES;
/** 打印进度最多每秒告诉页面一次（最后一张和结果照常立即发）。 */
const PROGRESS_INTERVAL_MS = 1_000;
/** 状态最多每 0.25 秒推一次：上传一块、打一张都会变，逐个推会让界面一直重画。 */
const STATUS_INTERVAL_MS = 250;

export const REMOTE_STATION_ISSUES = {
  tooMany: `最多 ${REMOTE_SHARE_LIMITS.shares} 个远程共享：先撤销不用的`,
  noRelay: '还没有设置中转地址：先到「通用」里填写',
  notShared: '这个模板已不再共享：刷新页面再选',
} as const;

/** 共享的存储（SqliteRemoteShareStore 的这些方法）。 */
export type RemoteShareStore = Pick<
  SqliteRemoteShareStore,
  'list' | 'insert' | 'update' | 'remove' | 'devices' | 'addDevice' | 'touchDevice' | 'removeDevice'
>;

/** RemoteHost 里 station 用到的部分：测试里换成假的。 */
export interface RemoteHostPort {
  start(): void;
  stop(reason: CloseReason): void;
  state(): { link: RemoteLink; failure: RemoteHostFailure | null };
  decide(requestId: string, allow: boolean): void;
  removeDevice(deviceId: string): string[];
  deliver(deliveries: readonly Delivery[]): void;
  catalogChanged(): void;
  tick(): void;
}

type StationSettings = Pick<AppSettings, 'mobileRelayUrl' | 'paperPrinters'>;

export interface RemoteStationDeps {
  store: RemoteShareStore;
  clock: Clock;
  settings: () => StationSettings;
  /** 安装包自带的中转地址（设置里没填时用它；和手机扫码同一个）。 */
  buildDefaultRelayUrl: string | null;
  findTemplate: (id: string) => LabelTemplate | null;
  documents: Pick<DocumentJobService, 'print'>;
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  createHost: (
    deps: Pick<RemoteHostDeps, 'keys' | 'relayBase' | 'session' | 'shareName' | 'expiresAt' | 'catalog' | 'submit' | 'onChange'>,
  ) => RemoteHostPort;
  onStatus: (status: RemoteStatus) => void;
  /** 写了打印记录：界面刷新记录列表。 */
  onJobsChanged: () => void;
  /** 有新设备在等确认：系统通知（点通知回到主窗口，「允许」「拒绝」在程序顶部点）。 */
  notifyApproval: (shareName: string, device: string) => void;
  schedule: (run: () => void, delayMs: number) => () => void;
  log: (line: string) => void;
}

interface ShareRun {
  share: StoredShare;
  session: RemoteSession;
  host: RemoteHostPort;
}

interface RunningJob {
  shareId: string;
  job: string;
  device: RemoteDevice;
  title: string;
  spec: RemoteJobSpec;
  lane: string;
  controller: AbortController;
  view: RemoteJobView;
  lastProgressAt: number;
}

export class RemoteStation {
  private readonly runs = new Map<string, ShareRun>();
  private readonly queue = new RemoteQueue();
  private readonly budget = new ByteBudget(REMOTE_DOCUMENT_BUDGET_BYTES);
  private readonly jobs = new Map<string, RunningJob>();
  private readonly recent: RemoteJobView[] = [];
  private readonly expired: string[] = [];
  /** 已经发过系统通知的确认请求。 */
  private readonly notified = new Set<string>();
  private relayBase: URL | null = null;
  private cancelStatusTimer: (() => void) | null = null;

  constructor(private readonly deps: RemoteStationDeps) {}

  /** 还没打完的远程任务数（排队和在打的）：有的时候不静默更新。 */
  get pendingJobs(): number {
    return this.queue.size;
  }

  /** 程序启动：读出共享，过期的结束掉，其余按中转地址连上。 */
  start(): void {
    this.relayBase = this.resolveRelay();
    for (const share of this.deps.store.list()) {
      if (share.expiresAt !== null && share.expiresAt <= this.deps.clock.now()) {
        this.deps.store.remove(share.id);
        this.expired.push(share.name);
        continue;
      }
      this.open(share);
    }
    this.pushStatus();
  }

  create(draft: ShareDraft): CreateShareResult {
    if (this.relayBase === null) {
      return { ok: false, issue: REMOTE_STATION_ISSUES.noRelay };
    }
    if (this.deps.store.list().length >= REMOTE_SHARE_LIMITS.shares) {
      return { ok: false, issue: REMOTE_STATION_ISSUES.tooMany };
    }
    const now = this.deps.clock.now();
    const share: StoredShare = {
      id: randomId(),
      name: draft.name,
      sessionId: randomId(),
      ownerSecret: randomId(),
      key: randomKey(),
      templateIds: draft.templateIds,
      approveNewDevices: draft.approveNewDevices,
      createdAt: now,
      expiresAt: shareExpiresAt(now, draft.expiresInDays),
    };
    try {
      this.deps.store.insert(share);
    } catch (error) {
      if (error instanceof SecretError) {
        return { ok: false, issue: error.message };
      }
      throw error;
    }
    this.deps.log(`remote: share created (${share.id.slice(0, 6)}…)`);
    this.open(share);
    this.pushStatus();
    return { ok: true, id: share.id };
  }

  update(id: string, patch: SharePatch): void {
    const run = this.runs.get(id);
    if (!run) {
      return;
    }
    this.deps.store.update(id, patch);
    run.share = { ...run.share, ...patch };
    if (patch.templateIds !== undefined) {
      run.host.catalogChanged();
    }
    this.scheduleStatus();
  }

  /** 撤销：中转服务告诉在线的页面，排队中的任务取消（正在打的那张打完），共享和密钥删掉。 */
  revoke(id: string): void {
    this.end(id, 'revoked');
  }

  /** 复制链接用：只给已有共享的链接。 */
  linkOf(id: string): string | null {
    const run = this.runs.get(id);
    return run && this.relayBase ? buildShareUrl(this.relayBase.href, run.share.sessionId, run.share.key) : null;
  }

  /** 移除一台设备：令牌作废、断开，它还没开始打的任务取消；同时打开这个共享的「新设备要我确认」。 */
  removeDevice(shareId: string, deviceId: string): void {
    const run = this.runs.get(shareId);
    if (!run) {
      return;
    }
    for (const job of run.host.removeDevice(deviceId)) {
      this.cancel(`${shareId}/${job}`);
    }
    if (!run.share.approveNewDevices) {
      this.update(shareId, { approveNewDevices: true });
    }
    this.deps.log('remote: removed a device, new devices now need approval');
    this.scheduleStatus();
  }

  decide(requestId: string, allow: boolean): void {
    for (const run of this.runs.values()) {
      if (run.session.pendingApprovals().some((approval) => approval.requestId === requestId)) {
        run.host.decide(requestId, allow);
        this.notified.delete(requestId);
        this.scheduleStatus();
        return;
      }
    }
  }

  dismissExpired(): void {
    this.expired.splice(0);
    this.pushStatus();
  }

  tick(): void {
    const now = this.deps.clock.now();
    for (const run of [...this.runs.values()]) {
      if (run.share.expiresAt !== null && run.share.expiresAt <= now) {
        this.expired.push(run.share.name);
        this.end(run.share.id, 'expired');
        continue;
      }
      run.host.tick();
    }
  }

  /** 纸张分配变了：页面上的纸张选项变了。换了中转地址：所有共享按新地址重连（链接要重新发给对方）。 */
  settingsChanged(next: StationSettings, previous: StationSettings): void {
    if (next.mobileRelayUrl !== previous.mobileRelayUrl) {
      this.deps.log('remote: relay address changed, reconnecting every share');
      for (const run of [...this.runs.values()]) {
        run.host.stop('stopped');
        this.runs.delete(run.share.id);
      }
      this.relayBase = this.resolveRelay();
      for (const share of this.deps.store.list()) {
        this.open(share);
      }
    } else if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) {
      for (const run of this.runs.values()) {
        run.host.catalogChanged();
      }
    }
    this.pushStatus();
  }

  /** 模板改了（名字、字段、纸张，或被删掉）：告诉在线的页面新的目录。 */
  templatesChanged(): void {
    for (const run of this.runs.values()) {
      run.host.catalogChanged();
    }
  }

  /** 程序退出：共享还在，只是电脑不在了（页面显示「电脑不在线」，下次启动再连）。 */
  quit(): void {
    for (const run of this.runs.values()) {
      run.host.stop('quit');
    }
  }

  status(): RemoteStatus {
    const base = this.relayBase;
    return {
      configured: base !== null,
      shares: [...this.runs.values()].map(({ share, session, host }) => {
        const { link, failure } = host.state();
        return {
          id: share.id,
          name: share.name,
          url: base === null ? '' : buildShareUrl(base.href, share.sessionId, share.key),
          createdAt: share.createdAt,
          expiresAt: share.expiresAt,
          templateIds: share.templateIds,
          approveNewDevices: share.approveNewDevices,
          link,
          failure,
          devices: session.devices().map(({ device, online, pending }) => ({
            id: device.id,
            label: device.label,
            online,
            pending,
            lastSeenAt: device.lastSeenAt,
          })),
        };
      }),
      approvals: [...this.runs.values()].flatMap(({ share, session }) =>
        session.pendingApprovals().map((approval) => ({
          requestId: approval.requestId,
          shareId: share.id,
          shareName: share.name,
          device: approval.label,
          at: approval.at,
        })),
      ),
      jobs: [...this.recent],
      expired: [...this.expired],
    };
  }

  private resolveRelay(): URL | null {
    return resolveRelayBase({
      setting: this.deps.settings().mobileRelayUrl,
      buildDefault: this.deps.buildDefaultRelayUrl,
    });
  }

  private open(share: StoredShare): void {
    const base = this.relayBase;
    if (base === null) {
      return;
    }
    const session = new RemoteSession({
      clock: this.deps.clock,
      devices: new StoreDeviceRegistry(this.deps.store, share.id, this.deps.clock),
      budget: this.budget,
      catalog: () => this.catalogOf(share.id),
      approveNewDevices: () => this.runs.get(share.id)?.share.approveNewDevices ?? true,
    });
    const run: ShareRun = {
      share,
      session,
      host: this.deps.createHost({
        keys: { sessionId: share.sessionId, ownerSecret: share.ownerSecret, key: share.key },
        relayBase: base,
        session,
        shareName: () => this.runs.get(share.id)?.share.name ?? share.name,
        expiresAt: share.expiresAt,
        catalog: () => this.catalogOf(share.id),
        submit: (job) => this.submit(share.id, job),
        onChange: () => this.changed(),
      }),
    };
    this.runs.set(share.id, run);
    run.host.start();
  }

  private end(id: string, reason: CloseReason): void {
    const run = this.runs.get(id);
    if (!run) {
      return;
    }
    run.host.stop(reason);
    for (const job of run.session.cancelAll()) {
      this.cancel(`${id}/${job}`);
    }
    this.runs.delete(id);
    this.deps.store.remove(id);
    this.deps.log(`remote: share ${reason} (${id.slice(0, 6)}…)`);
    this.pushStatus();
  }

  /** 这个共享现在能给对方的目录：分配了打印机的纸张、勾选的模板里还在的那些。 */
  private catalogOf(shareId: string): RemoteCatalog {
    const share = this.runs.get(shareId)?.share;
    const papers = Object.keys(this.deps.settings().paperPrinters).flatMap((key) => {
      const paper = parsePaperKey(key);
      return paper === null ? [] : [{ key, label: formatPaperName(paper) }];
    });
    const templates = (share?.templateIds ?? []).slice(0, REMOTE_MAX_TEMPLATES).flatMap((id) => {
      const template = this.deps.findTemplate(id);
      if (template === null) {
        return [];
      }
      const fields = templateFields(template);
      return [
        {
          id,
          name: template.name,
          paper: paperKey(template.paper),
          // 「全部字段」模式的模板：页面给自由填写的「名称：值」。
          fields: fields.mode === 'PICKED' ? fields.names : [],
        },
      ];
    });
    return { papers, templates };
  }

  /** 新任务排进它的打印机的队；返回前面还有几个。真正开始在下一轮事件循环里，让 accepted 先发出去。 */
  private submit(shareId: string, accepted: AcceptedJob): number {
    const key = `${shareId}/${accepted.job}`;
    const template = accepted.spec.kind === 'template' ? this.deps.findTemplate(accepted.spec.template) : null;
    const lane = this.laneOf(accepted.spec, template);
    const ahead = this.queue.enqueue(key, lane);
    const view: RemoteJobView = {
      key,
      shareName: this.runs.get(shareId)?.share.name ?? '',
      device: accepted.device.label,
      title: accepted.title,
      state: 'queued',
      ahead,
      done: 0,
      total: 0,
      result: null,
      at: this.deps.clock.now(),
    };
    this.jobs.set(key, {
      shareId,
      job: accepted.job,
      device: accepted.device,
      title: accepted.title,
      spec: accepted.spec,
      lane,
      controller: new AbortController(),
      view,
      lastProgressAt: 0,
    });
    this.recent.unshift(view);
    this.recent.splice(RECENT_REMOTE_JOBS);
    this.deps.schedule(() => this.pump(lane), 0);
    this.scheduleStatus();
    return ahead;
  }

  /** 队的键：模板指定的打印机 → 纸张分配的打印机 → 纸张本身（没有打印机，结果会是 no-printer）。 */
  private laneOf(spec: RemoteJobSpec, template: LabelTemplate | null): string {
    const paper = spec.kind === 'document' ? spec.paper : template === null ? '' : paperKey(template.paper);
    return template?.printer ?? this.deps.settings().paperPrinters[paper] ?? `paper:${paper}`;
  }

  private pump(lane: string): void {
    const key = this.queue.next(lane);
    if (key === null) {
      return;
    }
    this.queue.start(key);
    void this.execute(key)
      .catch((error: unknown) => this.deps.log(`remote: a job failed unexpectedly: ${String(error)}`))
      .finally(() => {
        this.moved(this.queue.remove(key));
        this.jobs.delete(key);
        this.pump(lane);
      });
  }

  private async execute(key: string): Promise<void> {
    const job = this.jobs.get(key);
    const run = job ? this.runs.get(job.shareId) : undefined;
    if (!job || !run) {
      return;
    }
    job.view.state = 'printing';
    job.view.ahead = 0;
    const caller = `remote:${run.share.name} · ${job.device.label}`;
    const onProgress = (done: number, total: number) => this.progress(run, job, done, total);
    const result =
      job.spec.kind === 'document'
        ? toRemoteResult(
            await this.deps.documents.print({
              document: { name: job.spec.name, bytes: job.spec.bytes },
              paperKey: job.spec.paper,
              crop: job.spec.crop,
              copies: job.spec.copies,
              maxLabels: REMOTE_MAX_LABELS_PER_JOB,
              source: 'remote',
              caller,
              signal: job.controller.signal,
              onProgress,
            }),
          )
        : await this.printTemplate(run, job, caller, onProgress);
    job.view.state = 'done';
    job.view.result = result;
    run.host.deliver(run.session.finished(job.job, result));
    this.scheduleStatus();
  }

  private async printTemplate(
    run: ShareRun,
    job: RunningJob,
    caller: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<RemoteResult> {
    if (job.spec.kind !== 'template') {
      throw new Error('printTemplate needs a template job');
    }
    const template = run.share.templateIds.includes(job.spec.template)
      ? this.deps.findTemplate(job.spec.template)
      : null;
    if (template === null) {
      return { status: 'invalid', detail: REMOTE_STATION_ISSUES.notShared };
    }
    const prepared = prepareRemoteFields(template, job.spec.fields);
    if (!prepared.ok) {
      return { status: 'invalid', detail: prepared.issue };
    }
    const total = job.spec.copies;
    onProgress(0, total);
    for (let sent = 0; sent < total; sent += 1) {
      if (job.controller.signal.aborted) {
        return sent === 0 ? { status: 'canceled' } : { status: 'sent', labels: sent };
      }
      const result = await this.deps.printFields({
        template,
        fields: prepared.fields,
        content: prepared.content,
        source: 'remote',
        caller,
        printerName: null,
      });
      this.deps.onJobsChanged();
      if (result.status === 'no-printer') {
        return { status: 'no-printer' };
      }
      if (result.status !== 'printed') {
        const reason = result.status === 'failed' ? result.reason : 'PRINT_ERROR';
        const issue = result.status === 'failed' ? (result.issue ?? null) : null;
        return sent === 0 ? { status: 'failed', reason, issue } : { status: 'partial', sent, total, reason, issue };
      }
      onProgress(sent + 1, total);
    }
    return { status: 'sent', labels: total };
  }

  /** 打印进度：界面上的记录每张都更新；页面最多每秒一次，最后一张照常发。 */
  private progress(run: ShareRun, job: RunningJob, done: number, total: number): void {
    job.view.done = done;
    job.view.total = total;
    const now = this.deps.clock.now();
    if (done === 0 || done === total || now - job.lastProgressAt >= PROGRESS_INTERVAL_MS) {
      job.lastProgressAt = now;
      const message: DesktopToViewer = { type: 'started', job: job.job, done, total };
      run.host.deliver(run.session.progressed(job.job, message));
    }
    this.scheduleStatus();
  }

  /** 取消一个任务：还在排队的拿出队列、立即结束；正在打的通知它在两张之间停下，结果照常走 finished。 */
  private cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job) {
      return;
    }
    job.controller.abort();
    if (job.view.state !== 'queued') {
      return;
    }
    this.moved(this.queue.remove(key));
    this.jobs.delete(key);
    job.view.state = 'done';
    job.view.result = { status: 'canceled' };
    const run = this.runs.get(job.shareId);
    run?.host.deliver(run.session.finished(job.job, { status: 'canceled' }));
  }

  /** 队伍往前走了：按共享分组，每台设备一条 queue。 */
  private moved(moves: readonly { key: string; ahead: number }[]): void {
    const byShare = new Map<string, { job: string; ahead: number }[]>();
    for (const { key, ahead } of moves) {
      const job = this.jobs.get(key);
      if (!job) {
        continue;
      }
      job.view.ahead = ahead;
      byShare.set(job.shareId, [...(byShare.get(job.shareId) ?? []), { job: job.job, ahead }]);
    }
    for (const [shareId, positions] of byShare) {
      const run = this.runs.get(shareId);
      run?.host.deliver(run.session.moved(positions));
    }
  }

  /** 连接、设备、确认请求变了：新的确认请求发一次系统通知。 */
  private changed(): void {
    for (const approval of this.status().approvals) {
      if (!this.notified.has(approval.requestId)) {
        this.notified.add(approval.requestId);
        this.deps.notifyApproval(approval.shareName, approval.device);
      }
    }
    this.scheduleStatus();
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
}

/** 文件任务的结果 → 告诉页面的结果。 */
function toRemoteResult(outcome: DocumentOutcome): RemoteResult {
  switch (outcome.status) {
    case 'sent':
      return { status: 'sent', labels: outcome.labels };
    case 'partial':
      return {
        status: 'partial',
        sent: outcome.sent,
        total: outcome.total,
        reason: outcome.failure.reason,
        issue: outcome.failure.issue,
      };
    case 'failed':
      return { status: 'failed', reason: outcome.failure.reason, issue: outcome.failure.issue };
    case 'no-printer':
      return { status: 'no-printer' };
    case 'invalid':
      return { status: 'invalid', detail: outcome.issue };
    case 'canceled':
      return outcome.sent === 0 ? { status: 'canceled' } : { status: 'sent', labels: outcome.sent };
  }
}
```

撤销的测试里第一份任务已经开始打（`printFields` 永远不返回），它在两张之间才会停下，所以 `pendingJobs` 还是 1；排队中的第二份立即取消。

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/remote`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/shared/remote-status.ts src/main/remote/remote-station.ts src/main/remote/remote-station.test.ts
git commit -m "feat(remote): run remote shares and their jobs in the main process" -m "The station keeps one host per share, creates, renames, revokes and expires shares, routes approvals and device removal, and runs remote jobs one at a time per printer: files through the shared document path, templates through printFields after cleaning the fields. Records carry the share and the device as the caller, viewers get progress at most once a second, and a revoked or expired share cancels whatever has not started printing yet." -m "$TRAILER"
```

---

### Task 16: IPC、preload 和主进程接线

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 写测试**（`ipc-validators.test.ts`，import 加 `requireRemoteId`、`requireShareDraft`、`requireSharePatch`）

```ts
  test('remote share drafts, patches and ids are checked', () => {
    const draft = { name: '北京仓', expiresInDays: 7, templateIds: [], approveNewDevices: true };
    expect(requireShareDraft(draft)).toEqual(draft);
    expect(() => requireShareDraft({ ...draft, expiresInDays: 2 })).toThrow('Invalid remote share');
    expect(requireSharePatch({ approveNewDevices: false })).toEqual({ approveNewDevices: false });
    expect(() => requireSharePatch({})).toThrow('Invalid remote share patch');
    const id = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(requireRemoteId(id, 'shareId')).toBe(id);
    expect(() => requireRemoteId('../x', 'shareId')).toThrow('shareId');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 实现**

`src/main/ipc-validators.ts`：

```ts
/** 远程共享的新建参数：严格按 parseShareDraft，不合法整个拒绝（页面只会交合法的值）。 */
export function requireShareDraft(value: unknown): ShareDraft {
  const draft = parseShareDraft(value);
  if (draft === null) {
    throw new TypeError('Invalid remote share');
  }
  return draft;
}

export function requireSharePatch(value: unknown): SharePatch {
  const patch = parseSharePatch(value);
  if (patch === null) {
    throw new TypeError('Invalid remote share patch');
  }
  return patch;
}

/** 共享、设备、确认请求的编号：主进程生成的 16 字节随机数（base64url）。 */
export function requireRemoteId(value: unknown, name: string): string {
  if (!isRandomId(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}
```

（import：`parseShareDraft`、`parseSharePatch`、`ShareDraft`、`SharePatch` 从 `../core/remote/share-model`，`isRandomId` 从 `../shared/mobile-protocol`。）

`src/shared/ipc-contract.ts`：`IpcChannel` 末尾加

```ts
  RemoteStatus: 'remote:status',
  RemoteStatusChanged: 'remote:status-changed',
  CreateRemoteShare: 'remote:create',
  UpdateRemoteShare: 'remote:update',
  RevokeRemoteShare: 'remote:revoke',
  CopyRemoteLink: 'remote:copy-link',
  RemoveRemoteDevice: 'remote:remove-device',
  DecideRemoteDevice: 'remote:decide',
  DismissExpiredShares: 'remote:dismiss-expired',
```

`LabelFlashApi` 末尾加：

```ts
  getRemoteStatus(): Promise<RemoteStatus>;
  onRemoteStatus(listener: (status: RemoteStatus) => void): () => void;
  /** 新建远程共享；超过上限、没有中转地址、系统加密不可用时返回原因。 */
  createRemoteShare(draft: ShareDraft): Promise<CreateShareResult>;
  /** 改名、改共享的模板、改「新设备要我确认」。 */
  updateRemoteShare(id: string, patch: SharePatch): Promise<void>;
  /** 撤销：链接立即作废，在线的对方收到「已撤销」，没开始打的任务取消。 */
  revokeRemoteShare(id: string): Promise<void>;
  /** 把这个共享的链接复制到剪贴板（文字由主进程拼好，页面不能借它写任意内容）；共享不在了返回 false。 */
  copyRemoteLink(id: string): Promise<boolean>;
  /** 移除一台设备：令牌作废，同时打开「新设备要我确认」。 */
  removeRemoteDevice(shareId: string, deviceId: string): Promise<void>;
  /** 新设备的询问条上点了「允许」或「拒绝」。 */
  decideRemoteDevice(requestId: string, allow: boolean): Promise<void>;
  /** 「已到期」的提示看过了。 */
  dismissExpiredShares(): Promise<void>;
```

（import `RemoteStatus`、`CreateShareResult` 从 `./remote-status`，`ShareDraft`、`SharePatch` 从 `../core/remote/share-model`。）

`src/main/ipc.ts`：`IpcDeps` 加 `remote: RemoteStation;`，注册：

```ts
  handle(IpcChannel.RemoteStatus, () => deps.remote.status());
  handle(IpcChannel.CreateRemoteShare, (draft) => deps.remote.create(requireShareDraft(draft)));
  handle(IpcChannel.UpdateRemoteShare, (id, patch) =>
    deps.remote.update(requireRemoteId(id, 'shareId'), requireSharePatch(patch)),
  );
  handle(IpcChannel.RevokeRemoteShare, (id) => deps.remote.revoke(requireRemoteId(id, 'shareId')));
  handle(IpcChannel.CopyRemoteLink, (id) => {
    const link = deps.remote.linkOf(requireRemoteId(id, 'shareId'));
    if (link === null) {
      return false;
    }
    clipboard.writeText(link);
    return true;
  });
  handle(IpcChannel.RemoveRemoteDevice, (shareId, deviceId) =>
    deps.remote.removeDevice(requireRemoteId(shareId, 'shareId'), requireRemoteId(deviceId, 'deviceId')),
  );
  handle(IpcChannel.DecideRemoteDevice, (requestId, allow) =>
    deps.remote.decide(requireRemoteId(requestId, 'requestId'), requireBoolean(allow, 'allow')),
  );
  handle(IpcChannel.DismissExpiredShares, () => deps.remote.dismissExpired());
```

`SaveTemplate`、`DeleteTemplate`、`DuplicateTemplate` 的处理函数在保存 / 删除之后加 `deps.remote.templatesChanged();`（共享出去的模板改了名字、字段，或被删掉，在线的页面马上看到）。

`src/preload/index.ts`：照手机扫码那几项的写法加 9 个函数；`onRemoteStatus` 和 `onMobileStatus` 一样用 `ipcRenderer.on` 并返回取消订阅的函数。

`src/main/index.ts`：

1. `notifyOriginRequest` 之后加：

```ts
/** 有新设备想经远程共享打印：发一条系统通知，「允许 / 拒绝」在程序顶部点（不弹模态框，理由同网站询问）。 */
function notifyRemoteApproval(shareName: string, device: string): void {
  if (!Notification.isSupported()) {
    return;
  }
  const notification = new Notification({
    title: '有新设备想远程打印',
    body: `「${device}」想通过远程共享「${shareName}」打印。请在程序顶部点「允许」或「拒绝」。`,
  });
  notification.on('click', showMainWindow);
  notification.show();
}
```

2. PDF 打印的 `pdfRenderer`、`pdfCache` 之后（`PdfStation` 的 `dpiFor` 抽成局部函数 `dpiForPaper`，PDF 和这里共用；6a 已经建了 `DocumentJobService` 时只把它传给 `RemoteStation`，不再建第二个）：

```ts
  // 收到的文件（远程打印；局域网共享也用这一个）：自己的渲染页，和「打印 PDF」页互不打断。
  const documentRenderer = new PdfRenderHost({
    openPort: () => openRenderWindow(join(__dirname, '../renderer')),
    openTimeoutMs: PDF_OPEN_TIMEOUT_MS,
    pageTimeoutMs: PDF_PAGE_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const documents = new DocumentJobService({
    renderer: documentRenderer,
    pieces: pdfCache,
    dpiFor: dpiForPaper,
    printFields: (input) => service.printFields(input),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    log: (line) => console.warn(line),
  });
  const remote = new RemoteStation({
    store: new SqliteRemoteShareStore(database, safeStorageCipher, systemClock, (line) => console.warn(line)),
    clock: systemClock,
    settings: () => settings.current,
    buildDefaultRelayUrl: BUILD_DEFAULT_RELAY_URL,
    findTemplate: (id) => templates.get(id),
    documents,
    printFields: (input) => service.printFields(input),
    createHost: (hostDeps) =>
      new RemoteHost({
        ...hostDeps,
        timers: {
          setTimeout: (callback, ms) => setTimeout(callback, ms),
          clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        // 日志行自带「remote:」前缀。
        log: (line) => console.info(line),
      }),
    onStatus: (status) => sendToMainWindow(IpcChannel.RemoteStatusChanged, status),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    notifyApproval: notifyRemoteApproval,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.info(line),
  });
  remote.start();
  const remoteTicker = setInterval(() => remote.tick(), REMOTE_TICK_INTERVAL_MS);
```

3. `registerIpc({` 的参数里加 `remote,`；`onSettingsChanged` 里 `mobile.settingsChanged(next, previous);` 之后加 `remote.settingsChanged(next, previous);`。
4. `backgroundUpdateTimer` 的 `pendingPrints` 末尾加 ` + remote.pendingJobs + documents.pendingLabels`（注释：「远程任务还没打完时也不静默更新」）。远程共享一直连着中转服务，不算「手机扫码开着」：静默更新照常进行，更新后重启再连上，对方页面在这几秒里显示「电脑暂时不在线」。
5. 退出时的清理（`clearInterval(mobileTicker)` 那一处）加 `clearInterval(remoteTicker); remote.quit(); documentRenderer.close();`。

- [ ] **Step 4: 构建、检查、手动试一次**

Run: `bun run check && bun run build && bun run verify:bundle`
Expected: 都通过（新代码没有新依赖）。

再 `bun run dev`，在主窗口控制台：

```js
await window.api.updateSettings({ mobileRelayUrl: 'http://localhost:3180/' });
await window.api.createRemoteShare({ name: '试一下', expiresInDays: 1, templateIds: [], approveNewDevices: false });
(await window.api.getRemoteStatus()).shares[0]
```

（先在另一个终端 `bun run relay:dev`。）应返回一个 `link: 'online'` 的共享和 `http://localhost:3180/r/#…` 的链接；日志里有 `remote: share created`，没有密钥原文。最后 `await window.api.revokeRemoteShare(id)` 删掉它。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(remote): wire remote shares to IPC, notifications and the render window" -m "New remote channels expose only what the sharing page needs and validate every argument; the link is copied by the main process, never written by the page. Received files get their own sandboxed render page so they never interrupt the PDF printing page. New devices waiting for approval raise a system notification, and pending remote jobs hold off a silent update." -m "$TRAILER"
```

---

### Task 17: 界面的纯逻辑：结果用语、共享页的文字、来源「远程」

页面（中转服务上）和电脑界面说同一句话：远程任务的结果文字放在 `src/shared/remote-result-text.ts`，两边共用。

**Files:**
- Create: `src/shared/remote-result-text.ts`、`src/shared/remote-result-text.test.ts`
- Create: `src/renderer/src/lib/remote-share-text.ts`、`src/renderer/src/lib/remote-share-text.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`、`status-text.test.ts`（`SOURCE_LABELS` 缺 `remote` 时）
- Modify: `src/renderer/src/lib/local-api-text.ts`、`local-api-text.test.ts`
- Modify: `src/renderer/src/lib/app-view.ts`、`app-view.test.ts`（6a 没有加「共享」页时）

- [ ] **Step 1: 写测试**

```ts
// src/shared/remote-result-text.test.ts
import { describe, expect, test } from 'bun:test';
import { describeRemoteResult } from './remote-result-text';

describe('describeRemoteResult', () => {
  test('says only what the computer knows', () => {
    expect(describeRemoteResult({ status: 'sent', labels: 8 })).toEqual({ tone: 'ok', title: '已发送打印 8 张', detail: '' });
    expect(
      describeRemoteResult({ status: 'partial', sent: 3, total: 8, reason: 'PRINTER_NOT_READY', issue: 'paperOut' }),
    ).toEqual({ tone: 'error', title: '打了 3 张后停下（共 8 张）', detail: '打印机缺纸：请电脑那边装好纸，再把没打的重新提交' });
    expect(describeRemoteResult({ status: 'failed', reason: 'PRINTER_NOT_FOUND', issue: null })).toMatchObject({
      tone: 'error',
      title: '没有打印',
    });
    expect(describeRemoteResult({ status: 'no-printer' })).toMatchObject({ title: '没有打印', detail: '电脑上这种纸没有分配打印机' });
    // 文件和模板任务都可能是 invalid（文件打不开、字段不对）：标题不提是哪一种，原因在说明里。
    expect(describeRemoteResult({ status: 'invalid', detail: 'PDF 加了密码' })).toEqual({
      tone: 'warn',
      title: '不能打印',
      detail: 'PDF 加了密码',
    });
    expect(describeRemoteResult({ status: 'canceled' })).toMatchObject({ tone: 'warn', title: '已取消' });
  });
});
```

```ts
// src/renderer/src/lib/remote-share-text.test.ts
import { describe, expect, test } from 'bun:test';
import type { RemoteJobView, RemoteShareView } from '../../../shared/remote-status';
import {
  approvalText,
  describeDeviceSeen,
  describeExpiry,
  describeRemoteJob,
  describeShareLink,
  EXPIRY_CHOICES,
} from './remote-share-text';

const NOW = Date.UTC(2026, 9, 2, 6, 0, 0);
const HOUR_MS = 3_600_000;
const SHARE: RemoteShareView = {
  id: 's',
  name: '北京仓',
  url: 'https://relay.example.com/r/#a.b',
  createdAt: NOW,
  expiresAt: null,
  templateIds: [],
  approveNewDevices: true,
  link: 'online',
  failure: null,
  devices: [],
};

describe('share texts', () => {
  test('offers one day, a week, a month or no expiry', () => {
    expect(EXPIRY_CHOICES.map((choice) => choice.label)).toEqual(['1 天', '7 天', '30 天', '不过期']);
  });

  test('says when a share expires and how long is left', () => {
    expect(describeExpiry(null, NOW)).toBe('不过期，随时可以撤销');
    expect(describeExpiry(NOW + 50 * HOUR_MS, NOW)).toContain('还剩 2 天');
    expect(describeExpiry(NOW + 3 * HOUR_MS, NOW)).toContain('还剩 3 小时');
  });

  test('describes the connection to the relay and what to do', () => {
    expect(describeShareLink(SHARE)).toEqual({ tone: 'ok', text: '已连上中转服务，对方可以打开链接' });
    expect(describeShareLink({ ...SHARE, link: 'offline' })).toMatchObject({ tone: 'warn' });
    expect(describeShareLink({ ...SHARE, link: 'failed', failure: 'version' }).text).toContain('更新');
  });

  test('says where a remote job is', () => {
    const job: RemoteJobView = {
      key: 'k',
      shareName: '北京仓',
      device: '张三 · 电脑 · Edge',
      title: '面单.pdf',
      state: 'queued',
      ahead: 2,
      done: 0,
      total: 0,
      result: null,
      at: NOW,
    };
    expect(describeRemoteJob(job)).toBe('排队中，前面还有 2 个');
    expect(describeRemoteJob({ ...job, state: 'printing', done: 3, total: 8 })).toBe('正在打印 3/8');
    expect(describeRemoteJob({ ...job, state: 'done', result: { status: 'sent', labels: 8 } })).toBe('已发送打印 8 张');
  });

  test('asks about a new device in plain words', () => {
    expect(approvalText({ requestId: 'r', shareId: 's', shareName: '北京仓', device: '李四 · 手机 · 微信', at: NOW })).toBe(
      '「李四 · 手机 · 微信」想通过远程共享「北京仓」打印。不认识就点「拒绝」。',
    );
  });

  test('says when a device was last seen', () => {
    expect(describeDeviceSeen({ id: 'd', label: 'x', online: true, pending: 1, lastSeenAt: NOW }, NOW)).toBe(
      '在线 · 1 个任务',
    );
    expect(describeDeviceSeen({ id: 'd', label: 'x', online: false, pending: 0, lastSeenAt: NOW - HOUR_MS }, NOW)).toBe(
      '1 小时前来过',
    );
  });
});
```

`local-api-text.test.ts` 的 `describeCaller` 用例里加：

```ts
    expect(describeCaller('remote:北京仓 · 张三 · 电脑 · Edge', null)).toBe('北京仓 · 张三 · 电脑 · Edge');
```

`status-text.test.ts`（缺 `remote` 时）加 `expect(describeSource('remote')).toBe('远程');`。

`app-view.test.ts`（6a 没有加「共享」页时）加 `expect(pageLabel('sharing')).toBe('共享');`。

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/remote-result-text.test.ts src/renderer/src/lib`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/shared/remote-result-text.ts
import type { PrintFailureReason } from '../core/types';
import type { PrinterIssue } from './printer-readiness';
import type { RemoteResult } from './remote-protocol';

/**
 * 远程任务的结果怎么说：远程打印页（中转服务上）和电脑上的「共享」页共用，用词一致。
 * 只说电脑确知的事：驱动接了就是「已发送打印」，不说「打印成功」。
 */
export interface RemoteResultText {
  tone: 'ok' | 'warn' | 'error';
  title: string;
  detail: string;
}

const ISSUE_TEXT: Record<PrinterIssue, string> = {
  paperOut: '打印机缺纸',
  paperJam: '打印机卡纸',
  doorOpen: '打印机盖子没盖好',
  offline: '打印机离线',
  other: '打印机报告了问题',
};

const FAILURE_TEXT: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '电脑上找不到分配的打印机',
  PRINTER_NOT_READY: '打印机没有准备好',
  PRINT_TIMEOUT: '打印超时，可能已经出纸',
  PRINT_ERROR: '打印机驱动报错',
  LOOKUP_FAILED: '查询失败',
  TEXT_NOT_FOUND: '没认出要的文字',
};

function why(reason: PrintFailureReason, issue: PrinterIssue | null): string {
  return issue === null ? FAILURE_TEXT[reason] : ISSUE_TEXT[issue];
}

export function describeRemoteResult(result: RemoteResult): RemoteResultText {
  switch (result.status) {
    case 'sent':
      return { tone: 'ok', title: `已发送打印 ${result.labels} 张`, detail: '' };
    case 'partial':
      return {
        tone: 'error',
        title: `打了 ${result.sent} 张后停下（共 ${result.total} 张）`,
        detail: `${why(result.reason, result.issue)}：请电脑那边处理好，再把没打的重新提交`,
      };
    case 'failed':
      return { tone: 'error', title: '没有打印', detail: `${why(result.reason, result.issue)}：请电脑那边处理好再提交` };
    case 'no-printer':
      return { tone: 'error', title: '没有打印', detail: '电脑上这种纸没有分配打印机' };
    case 'invalid':
      return { tone: 'warn', title: '不能打印', detail: result.detail };
    case 'canceled':
      return { tone: 'warn', title: '已取消', detail: '电脑上撤销了共享或移除了这台设备，没有打印' };
  }
}
```

```ts
// src/renderer/src/lib/remote-share-text.ts
import type { ShareExpiryDays } from '../../../core/remote/share-model';
import { describeRemoteResult } from '../../../shared/remote-result-text';
import type {
  RemoteApprovalView,
  RemoteDeviceView,
  RemoteJobView,
  RemoteShareView,
} from '../../../shared/remote-status';
import { formatAgo, formatDateTime } from './status-text';

const HOUR_MS = 3_600_000;
const HOURS_PER_DAY = 24;

export const EXPIRY_CHOICES: readonly { days: ShareExpiryDays | null; label: string }[] = [
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: null, label: '不过期' },
];

export function describeExpiry(expiresAt: number | null, now: number): string {
  if (expiresAt === null) {
    return '不过期，随时可以撤销';
  }
  const hours = Math.max(1, Math.ceil((expiresAt - now) / HOUR_MS));
  const left = hours >= HOURS_PER_DAY ? `${Math.floor(hours / HOURS_PER_DAY)} 天` : `${hours} 小时`;
  return `${formatDateTime(expiresAt)} 到期（还剩 ${left}）`;
}

export function describeShareLink(share: RemoteShareView): { tone: 'ok' | 'warn' | 'error'; text: string } {
  if (share.failure === 'version') {
    return { tone: 'error', text: '中转服务的版本和这个程序不一致：请更新软件' };
  }
  if (share.failure === 'session-taken') {
    return { tone: 'error', text: '中转服务拒绝了这个共享：检查「通用」里的中转地址，或撤销后重新建一个' };
  }
  if (share.failure === 'server-busy') {
    return { tone: 'warn', text: '中转服务满了，正在自动重试' };
  }
  switch (share.link) {
    case 'online':
      return { tone: 'ok', text: '已连上中转服务，对方可以打开链接' };
    case 'connecting':
      return { tone: 'warn', text: '正在连接中转服务…' };
    case 'offline':
      return { tone: 'warn', text: '和中转服务断开了，正在重连；这段时间对方打不开' };
    case 'failed':
      return { tone: 'error', text: '连不上中转服务' };
  }
}

export function describeRemoteJob(job: RemoteJobView): string {
  switch (job.state) {
    case 'queued':
      return job.ahead > 0 ? `排队中，前面还有 ${job.ahead} 个` : '排队中';
    case 'printing':
      return job.total > 0 ? `正在打印 ${job.done}/${job.total}` : '正在准备';
    case 'done':
      return job.result === null ? '' : describeRemoteResult(job.result).title;
  }
}

export function approvalText(approval: RemoteApprovalView): string {
  return `「${approval.device}」想通过远程共享「${approval.shareName}」打印。不认识就点「拒绝」。`;
}

/** now 由视图模型传入（lib 里不取时间）。 */
export function describeDeviceSeen(device: RemoteDeviceView, now: number): string {
  if (device.online) {
    return device.pending > 0 ? `在线 · ${device.pending} 个任务` : '在线';
  }
  return `${formatAgo(device.lastSeenAt, now)}来过`;
}
```

`local-api-text.ts`：

```ts
const REMOTE_PREFIX = 'remote:';
```

`describeCaller` 末尾改为：

```ts
  if (caller.startsWith(REMOTE_PREFIX)) {
    // 远程打印：「共享名 · 对方的名字或设备」，主进程写记录时拼好。
    return caller.slice(REMOTE_PREFIX.length);
  }
  return caller.startsWith(ORIGIN_PREFIX) ? caller.slice(ORIGIN_PREFIX.length) : caller;
```

`status-text.ts` 的 `SOURCE_LABELS` 缺 `remote` 时加 `remote: '远程',`。

`app-view.ts`（6a 没有加时）：`CONFIG_PAGES` 在 `'localApi'` 之后加 `'sharing'`，`CONFIG_NAV` 的「集成」组加 `{ page: 'sharing', label: '共享' }`。

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared src/renderer/src/lib`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/remote-result-text.ts src/shared/remote-result-text.test.ts src/renderer/src/lib
git commit -m "feat(remote): wording for remote results, shares and records" -m "The remote page and the sharing page describe a remote job with the same words from one shared module, saying only what the computer knows. Records show the share and the remote device after the source, and the sharing page explains expiry, the relay connection and pending devices." -m "$TRAILER"
```

---

### Task 18: 界面：「共享」页的远程共享、新设备的询问条

「共享」页（配置中心「集成」组）在局域网共享（6a）下面加一节「异地远程打印」；6a 没有这一页时新建它，只有这一节。

- **列表**：每个共享一张卡片：名字、连接状态（`describeShareLink`）、有效期、链接（文字 + 本机生成的二维码，`useQrImage`）、「复制链接」、共享的模板（勾选，改了立即保存）、「新设备要我确认」开关、设备列表（名字、在线 / 几时来过、「移除」）、「撤销」（`ConfirmButton` 两步确认）。
- **新建**：「新建远程共享」打开表单：名称、有效期（1 天 / 7 天 / 30 天 / 不过期）、要共享的模板（列出所有模板，默认都不勾）、「新设备要我确认」（默认开），「创建」。失败时在表单里显示原因（没有中转地址时带「去填写中转地址」的 `PageLink`）。
- **最近的远程任务**：所有共享合在一起，最新的在上：共享 · 对方 · 文件或模板名 · 状态（`describeRemoteJob`）。
- **提示**：到期的共享提示一次（「知道了」）；换了中转地址后提示「已发出的链接要重新发给对方」。
- **询问条** `RemoteRequests`：和网站询问条、6a 的新电脑询问条同一个样子、同一个位置（程序顶部，工作台和配置中心都显示），按钮不进 Tab 顺序（扫码枪的 Tab、回车不能点中「允许」）。6a 把询问条抽成了通用的 `RequestBar.tsx`：`RemoteRequests` 只是把 `approvals` 换成它的每一条（文字用 `approvalText`，按钮回调 `decide`），**不复制下面的标记**；下面给出的组件代码是 `RequestBar` 不存在时的写法，样式类名和 `OriginRequests` 一致。

**Files:**
- Create: `src/renderer/src/view-models/use-remote-shares.ts`
- Create: `src/renderer/src/components/sharing/RemoteShares.tsx`、`RemoteShareForm.tsx`、`RemoteShareCard.tsx`
- Create: `src/renderer/src/components/RemoteRequests.tsx`
- Create / Modify: `src/renderer/src/components/config/pages/SharingPage.tsx`
- Modify: `src/renderer/src/components/config/ConfigPages.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 视图模型**

```ts
// src/renderer/src/view-models/use-remote-shares.ts
import { useCallback, useEffect, useState } from 'react';
import type { ShareDraft, SharePatch } from '../../../core/remote/share-model';
import type { CreateShareResult, RemoteStatus } from '../../../shared/remote-status';
import { notices, reportError } from '../lib/notices';

/** 有效期和「几时来过」的文字每分钟刷新一次就够。 */
const CLOCK_TICK_MS = 60_000;

/**
 * 异地远程打印：跟随主进程推送的状态；新建、修改、撤销共享，复制链接，移除设备，回答新设备的询问。
 * 在 App 里创建（询问条在程序顶部，「共享」页在配置中心），组件只拿到数据和回调。
 */
export function useRemoteShares() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let isActive = true;
    window.api.getRemoteStatus().then(
      (current) => {
        if (isActive) {
          setStatus(current);
        }
      },
      (error: unknown) => reportError('读取远程共享', error),
    );
    const unsubscribe = window.api.onRemoteStatus(setStatus);
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      isActive = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const create = useCallback(async (draft: ShareDraft): Promise<CreateShareResult | null> => {
    try {
      return await window.api.createRemoteShare(draft);
    } catch (error) {
      reportError('新建远程共享', error);
      return null;
    }
  }, []);

  const update = useCallback((id: string, patch: SharePatch) => {
    window.api.updateRemoteShare(id, patch).catch((error: unknown) => reportError('修改远程共享', error));
  }, []);

  const revoke = useCallback((id: string) => {
    window.api.revokeRemoteShare(id).catch((error: unknown) => reportError('撤销远程共享', error));
  }, []);

  const copyLink = useCallback((id: string) => {
    window.api.copyRemoteLink(id).then(
      (copied) => notices.push(copied ? 'info' : 'warning', copied ? '已复制链接' : '这个共享已经不在了'),
      (error: unknown) => reportError('复制链接', error),
    );
  }, []);

  const removeDevice = useCallback((shareId: string, deviceId: string) => {
    window.api.removeRemoteDevice(shareId, deviceId).catch((error: unknown) => reportError('移除设备', error));
  }, []);

  const decide = useCallback((requestId: string, allow: boolean) => {
    window.api.decideRemoteDevice(requestId, allow).catch((error: unknown) => reportError('回答新设备', error));
  }, []);

  const dismissExpired = useCallback(() => {
    window.api.dismissExpiredShares().catch((error: unknown) => reportError('关闭提示', error));
  }, []);

  return { status, now, create, update, revoke, copyLink, removeDevice, decide, dismissExpired };
}

export type RemoteSharesModel = ReturnType<typeof useRemoteShares>;
```

- [ ] **Step 2: 组件**

```tsx
// src/renderer/src/components/RemoteRequests.tsx
import type { RemoteApprovalView } from '../../../shared/remote-status';
import { approvalText } from '../lib/remote-share-text';

interface RemoteRequestsProps {
  approvals: readonly RemoteApprovalView[];
  onDecide: (requestId: string, allow: boolean) => void;
}

/**
 * 新设备想经远程共享打印：在程序顶部请操作员用鼠标点「允许」或「拒绝」（和网站询问条一样）。
 * 两个按钮都不进 Tab 顺序：扫码枪敲的 Tab、回车不能把焦点带到「允许」上再按下去。
 */
export function RemoteRequests({ approvals, onDecide }: RemoteRequestsProps) {
  if (approvals.length === 0) {
    return null;
  }
  return (
    <section className="origin-requests" aria-label="等待确认的远程设备">
      {approvals.map((approval) => (
        <div key={approval.requestId} className="origin-request">
          <p className="origin-request__text">{approvalText(approval)}</p>
          <div className="origin-request__actions">
            <button
              type="button"
              tabIndex={-1}
              className="button button--small"
              onClick={() => onDecide(approval.requestId, false)}
            >
              拒绝
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="button button--small button--primary"
              onClick={() => onDecide(approval.requestId, true)}
            >
              允许
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
```

```tsx
// src/renderer/src/components/sharing/RemoteShareForm.tsx
import { useId, useState } from 'react';
import { REMOTE_SHARE_LIMITS, type ShareDraft, type ShareExpiryDays } from '../../../../core/remote/share-model';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import { EXPIRY_CHOICES } from '../../lib/remote-share-text';

interface RemoteShareFormProps {
  templates: readonly LabelTemplate[];
  /** 创建；失败时返回原因（显示在表单里）。 */
  onCreate: (draft: ShareDraft) => Promise<string | null>;
  onCancel: () => void;
}

const DEFAULT_EXPIRY: ShareExpiryDays = 7;

/** 新建远程共享：名称、有效期、共享的模板（默认都不勾）、新设备要不要先确认（默认要）。 */
export function RemoteShareForm({ templates, onCreate, onCancel }: RemoteShareFormProps) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<ShareExpiryDays | null>(DEFAULT_EXPIRY);
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [approveNewDevices, setApproveNewDevices] = useState(true);
  const [issue, setIssue] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const toggleTemplate = (id: string) =>
    setTemplateIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const submit = async () => {
    setIsSaving(true);
    setIssue(await onCreate({ name: name.trim(), expiresInDays, templateIds, approveNewDevices }));
    setIsSaving(false);
  };

  return (
    <form
      className="remote-form"
      aria-label="新建远程共享"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={nameId}>共享名称</label>
      <input
        id={nameId}
        value={name}
        maxLength={REMOTE_SHARE_LIMITS.nameLength}
        placeholder="例如：北京仓"
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset>
        <legend>有效期</legend>
        {EXPIRY_CHOICES.map((choice) => (
          <label key={choice.label} className="remote-form__choice">
            <input
              type="radio"
              name="expiry"
              checked={expiresInDays === choice.days}
              onChange={() => setExpiresInDays(choice.days)}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>共享的模板（对方可以选它填字段打印；不勾就只能上传文件）</legend>
        {templates.map((template) => (
          <label key={template.id} className="remote-form__choice">
            <input
              type="checkbox"
              checked={templateIds.includes(template.id)}
              disabled={!templateIds.includes(template.id) && templateIds.length >= REMOTE_SHARE_LIMITS.templates}
              onChange={() => toggleTemplate(template.id)}
            />
            {template.name}
          </label>
        ))}
      </fieldset>
      <label className="remote-form__choice">
        <input
          type="checkbox"
          checked={approveNewDevices}
          onChange={(event) => setApproveNewDevices(event.target.checked)}
        />
        新设备要我确认
      </label>
      {issue !== null && (
        <p className="remote-form__issue" role="alert">
          {issue}
        </p>
      )}
      <div className="remote-form__actions">
        <button type="button" className="button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="button button--primary" disabled={isSaving || name.trim() === ''}>
          创建
        </button>
      </div>
    </form>
  );
}
```

```tsx
// src/renderer/src/components/sharing/RemoteShareCard.tsx
import type { SharePatch } from '../../../../core/remote/share-model';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import type { RemoteShareView } from '../../../../shared/remote-status';
import { describeDeviceSeen, describeExpiry, describeShareLink } from '../../lib/remote-share-text';
import { useQrImage } from '../../view-models/use-qr-image';
import { ConfirmButton } from '../ConfirmButton';

interface RemoteShareCardProps {
  share: RemoteShareView;
  templates: readonly LabelTemplate[];
  now: number;
  onUpdate: (patch: SharePatch) => void;
  onCopyLink: () => void;
  onRemoveDevice: (deviceId: string) => void;
  onRevoke: () => void;
}

export function RemoteShareCard({
  share,
  templates,
  now,
  onUpdate,
  onCopyLink,
  onRemoveDevice,
  onRevoke,
}: RemoteShareCardProps) {
  const qr = useQrImage(share.url === '' ? null : share.url);
  const link = describeShareLink(share);
  const toggleTemplate = (id: string) =>
    onUpdate({
      templateIds: share.templateIds.includes(id)
        ? share.templateIds.filter((item) => item !== id)
        : [...share.templateIds, id],
    });
  return (
    <article className="remote-share" aria-label={`远程共享 ${share.name}`}>
      <header className="remote-share__head">
        <h3>{share.name}</h3>
        <p className={`remote-share__link tone--${link.tone}`} role="status">
          {link.text}
        </p>
      </header>
      <p className="remote-share__expiry">{describeExpiry(share.expiresAt, now)}</p>
      <div className="remote-share__url">
        {qr !== null && <img src={qr} alt={`远程共享 ${share.name} 的链接二维码`} width={132} height={132} />}
        <p className="remote-share__url-text">{share.url}</p>
        <button type="button" className="button" onClick={onCopyLink}>
          复制链接
        </button>
      </div>
      <fieldset className="remote-share__templates">
        <legend>共享的模板</legend>
        {templates.map((template) => (
          <label key={template.id} className="remote-form__choice">
            <input
              type="checkbox"
              checked={share.templateIds.includes(template.id)}
              onChange={() => toggleTemplate(template.id)}
            />
            {template.name}
          </label>
        ))}
      </fieldset>
      <label className="remote-form__choice">
        <input
          type="checkbox"
          checked={share.approveNewDevices}
          onChange={(event) => onUpdate({ approveNewDevices: event.target.checked })}
        />
        新设备要我确认
      </label>
      <ul className="remote-share__devices" aria-label={`${share.name} 的设备`}>
        {share.devices.map((device) => (
          <li key={device.id} className="remote-device">
            <span className="remote-device__label">{device.label}</span>
            <span className="remote-device__seen">{describeDeviceSeen(device, now)}</span>
            <button type="button" className="button button--small" onClick={() => onRemoveDevice(device.id)}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <ConfirmButton label="撤销" confirmLabel="确认撤销：链接立即作废" onConfirm={onRevoke} />
    </article>
  );
}
```

```tsx
// src/renderer/src/components/sharing/RemoteShares.tsx
import { useState } from 'react';
import { REMOTE_SHARE_LIMITS } from '../../../../core/remote/share-model';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import { describeRemoteJob } from '../../lib/remote-share-text';
import type { RemoteSharesModel } from '../../view-models/use-remote-shares';
import { PageLink } from '../config/PageLink';
import { RemoteShareCard } from './RemoteShareCard';
import { RemoteShareForm } from './RemoteShareForm';

interface RemoteSharesProps {
  remote: RemoteSharesModel;
  templates: readonly LabelTemplate[];
}

/** 「共享」页的「异地远程打印」一节。 */
export function RemoteShares({ remote, templates }: RemoteSharesProps) {
  const [isCreating, setIsCreating] = useState(false);
  const { status } = remote;
  if (status === null) {
    return null;
  }
  return (
    <section className="remote-shares" aria-labelledby="remote-shares-title">
      <h2 id="remote-shares-title">异地远程打印</h2>
      <p className="hint">
        把链接发给不在店里的人：对方用浏览器打开，上传 PDF、图片，或选共享的模板填字段，标签从这台电脑的打印机出来。
        内容端到端加密，中转服务看不到。
      </p>
      {!status.configured && (
        <p className="notice notice--warning">
          还没有设置中转地址，远程共享连不上。<PageLink page="general">去填写中转地址</PageLink>
        </p>
      )}
      {status.expired.length > 0 && (
        <p className="notice notice--info" role="status">
          {`「${status.expired.join('」「')}」已到期，链接已失效。`}
          <button type="button" className="button button--small" onClick={remote.dismissExpired}>
            知道了
          </button>
        </p>
      )}
      {status.shares.map((share) => (
        <RemoteShareCard
          key={share.id}
          share={share}
          templates={templates}
          now={remote.now}
          onUpdate={(patch) => remote.update(share.id, patch)}
          onCopyLink={() => remote.copyLink(share.id)}
          onRemoveDevice={(deviceId) => remote.removeDevice(share.id, deviceId)}
          onRevoke={() => remote.revoke(share.id)}
        />
      ))}
      {isCreating ? (
        <RemoteShareForm
          templates={templates}
          onCancel={() => setIsCreating(false)}
          onCreate={async (draft) => {
            const result = await remote.create(draft);
            if (result?.ok) {
              setIsCreating(false);
              return null;
            }
            return result?.issue ?? '新建失败：程序内部错误，已写入日志';
          }}
        />
      ) : (
        <button
          type="button"
          className="button button--primary"
          disabled={status.shares.length >= REMOTE_SHARE_LIMITS.shares}
          onClick={() => setIsCreating(true)}
        >
          新建远程共享
        </button>
      )}
      <h3>最近的远程任务</h3>
      {status.jobs.length === 0 ? (
        <p className="hint">还没有远程任务。</p>
      ) : (
        <ol className="remote-jobs" aria-label="最近的远程任务">
          {status.jobs.map((job) => (
            <li key={job.key} className="remote-job">
              <span className="remote-job__who">{`${job.shareName} · ${job.device}`}</span>
              <span className="remote-job__title">{job.title}</span>
              <span className="remote-job__state">{describeRemoteJob(job)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

（`PageLink` 的属性名按 `components/config/PageLink.tsx` 里实际的写；手机扫码浮层里「去填写中转地址」就是用它。）

`SharingPage.tsx`：6a 已有时，在局域网共享那一节后面加 `<RemoteShares remote={remote} templates={templates} />`，页面的 props 加 `remote: RemoteSharesModel; templates: readonly LabelTemplate[];`；没有时新建：

```tsx
// src/renderer/src/components/config/pages/SharingPage.tsx
import type { LabelTemplate } from '../../../../../core/templates/template-model';
import type { RemoteSharesModel } from '../../../view-models/use-remote-shares';
import { RemoteShares } from '../../sharing/RemoteShares';

export interface SharingPageProps {
  remote: RemoteSharesModel;
  templates: readonly LabelTemplate[];
}

/** 配置中心「共享」：异地远程打印（局域网共享在 6a 里加在前面）。 */
export function SharingPage({ remote, templates }: SharingPageProps) {
  return (
    <div className="config-page sharing-page">
      <RemoteShares remote={remote} templates={templates} />
    </div>
  );
}
```

`ConfigPages.tsx`：`page === 'sharing'` 时渲染 `<SharingPage remote={remote} templates={templates} />`（props 从 App 传进来，和 `localApi` 一样）。

`App.tsx`：

- `const remote = useRemoteShares();`（和 `useLocalApi()` 放在一起）；
- `<OriginRequests …/>` 后面加 `<RemoteRequests approvals={remote.status?.approvals ?? []} onDecide={remote.decide} />`；
- 把 `remote` 和模板列表传给 `ConfigPages`。

`styles/app.css`：`.remote-shares`、`.remote-share`（卡片：边框、内边距、`display: grid` 两栏，窄窗口一栏）、`.remote-share__url`（二维码在左、链接文字可选中且 `word-break: break-all`）、`.remote-form`、`.remote-form__choice`、`.remote-device`、`.remote-jobs`、`.remote-job`。只用 `tokens.css` 里的变量（颜色、间距、字体），不写死色值。

- [ ] **Step 3: 跑检查**

Run: `bun run check && bun run test:e2e`
Expected: 通过（远程打印的 E2E 在 Task 21；这一步确认已有的 E2E 不受影响）。

再 `bun run dev` 走一遍：配置中心 →「共享」→「新建远程共享」→ 填名称、勾一个模板 →「创建」→ 卡片里有二维码、链接、「已连上中转服务」（先 `bun run relay:dev`，设置里填 `http://localhost:3180/`）→ 浏览器打开链接（远程打印页在 Task 19 才有内容）→ 电脑顶部出现询问条，点「允许」→ 设备列表里出现这台。最后「撤销」两步确认。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src
git commit -m "feat(remote): sharing page section and the new device prompt" -m "The sharing page lists remote shares with their link, QR code, expiry, relay status, shared templates, approval switch and devices, creates and revokes shares, and shows recent remote jobs. A new device waiting for approval appears in the same top bar as website requests, with buttons kept out of the tab order so a scanner can never press allow." -m "$TRAILER"
```

---

### Task 19: 远程打印页（中转服务上）

和扫码页同一个结构：`remote-state.ts`（状态机，纯函数）、`remote-text.ts`（文字，纯函数）、`file-check.ts`（文件检查，纯函数）、`remote-controller.ts`（编排，页面和协议经接口注入）、`remote-view.ts`（只碰 DOM，一律 `textContent`）、`main.ts`（只创建真实的浏览器对象）。

页面：顶栏（品牌、共享名、电脑在线与否）；「你的名字」（选填，存在 `localStorage`，电脑和打印记录里显示）；「上传文件」：选文件（`accept=".pdf,image/jpeg,image/png"`）、纸张、裁切（去白边 / 整页 / 一页多张，默认去白边）、份数（1–20）、「打印」；「按模板填写」（有共享的模板才显示）：选模板 → 每个字段一个输入框（「全部字段」的模板给「名称」「内容」两列、可加行）、份数、「打印」；任务列表（最新的在上，按任务号复用节点，最新结果由 `#announcer` 朗读）：上传中 N%、排队中前面还有 N 个、正在打印 n/m、结果。终止状态：等电脑确认、电脑不在线（可重试）、已撤销 / 已到期、被移除 / 被拒绝、页面要更新、链接不对。输入框字号不小于 16px（iPhone 聚焦不放大）；按钮不小于 48px。

**Files:**
- Create: `relay/web/src/remote/file-check.ts`、`file-check.test.ts`
- Create: `relay/web/src/remote/remote-state.ts`、`remote-state.test.ts`
- Create: `relay/web/src/remote/remote-text.ts`、`remote-text.test.ts`
- Create: `relay/web/src/remote/remote-controller.ts`、`remote-controller.test.ts`
- Create: `relay/web/src/remote/remote-view.ts`
- Modify: `relay/web/src/remote/main.ts`、`relay/web/remote/index.html`、`relay/web/remote/styles.css`

- [ ] **Step 1: 写测试**

```ts
// relay/web/src/remote/file-check.test.ts
import { describe, expect, test } from 'bun:test';
import { REMOTE_MAX_DOCUMENT_BYTES } from '../../../../src/shared/remote-protocol';
import { checkFile, FILE_ISSUES, sniffKind } from './file-check';

describe('file checks', () => {
  test('knows the kind by the first bytes', () => {
    expect(sniffKind(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(sniffKind(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffKind(Uint8Array.of(0xff, 0xd8, 0xff, 0xdb))).toBe('jpeg');
    expect(sniffKind(new TextEncoder().encode('hello'))).toBeNull();
  });

  test('refuses empty, oversized and unknown files before reading them all', () => {
    expect(checkFile({ size: 0 })).toBe(FILE_ISSUES.empty);
    expect(checkFile({ size: REMOTE_MAX_DOCUMENT_BYTES + 1 })).toBe(FILE_ISSUES.tooLarge);
    expect(checkFile({ size: 10 })).toBeNull();
  });
});
```

```ts
// relay/web/src/remote/remote-state.test.ts
import { describe, expect, test } from 'bun:test';
import { initialRemoteState, reduceRemote } from './remote-state';

const CATALOG = { papers: [{ key: '100x150', label: '100×150' }], templates: [] };

describe('reduceRemote', () => {
  test('goes from connecting to ready when welcomed', () => {
    const ready = reduceRemote(initialRemoteState(true), {
      type: 'welcomed',
      share: '北京仓',
      expiresAt: null,
      catalog: CATALOG,
    });
    expect(ready.screen).toEqual({ name: 'ready', share: '北京仓', catalog: CATALOG });
  });

  test('says there is no link when the page is opened without one', () => {
    expect(initialRemoteState(false).screen).toEqual({ name: 'no-link' });
  });

  test('keeps a job card from submit to result and lists the newest first', () => {
    let state = reduceRemote(initialRemoteState(true), { type: 'welcomed', share: 's', expiresAt: null, catalog: CATALOG });
    state = reduceRemote(state, { type: 'submitted', job: 'a', title: '一.pdf' });
    state = reduceRemote(state, { type: 'submitted', job: 'b', title: '二.pdf' });
    state = reduceRemote(state, { type: 'uploading', job: 'b', sent: 1, total: 4 });
    state = reduceRemote(state, { type: 'queued', positions: [{ job: 'a', ahead: 1 }] });
    state = reduceRemote(state, { type: 'started', job: 'a', done: 2, total: 8 });
    state = reduceRemote(state, { type: 'result', job: 'a', result: { status: 'sent', labels: 8 } });
    expect(state.jobs.map((job) => [job.id, job.stage.name])).toEqual([
      ['b', 'uploading'],
      ['a', 'done'],
    ]);
  });

  test('ends on a revoked share, a removed device or an outdated page', () => {
    const ready = reduceRemote(initialRemoteState(true), { type: 'welcomed', share: 's', expiresAt: null, catalog: CATALOG });
    expect(reduceRemote(ready, { type: 'ended', reason: 'revoked' }).screen).toEqual({ name: 'ended', reason: 'revoked' });
    expect(reduceRemote(ready, { type: 'denied', reason: 'removed' }).screen).toEqual({ name: 'denied', reason: 'removed' });
    expect(reduceRemote(ready, { type: 'outdated' }).screen).toEqual({ name: 'outdated' });
  });

  test('marks jobs the computer no longer knows', () => {
    let state = reduceRemote(initialRemoteState(true), { type: 'submitted', job: 'a', title: 'x' });
    state = reduceRemote(state, { type: 'unknown', jobs: ['a'] });
    expect(state.jobs[0]?.stage).toEqual({ name: 'unknown' });
  });
});
```

```ts
// relay/web/src/remote/remote-text.test.ts
import { describe, expect, test } from 'bun:test';
import { jobStageText, screenText } from './remote-text';

describe('remote page texts', () => {
  test('describes each stage of a job', () => {
    expect(jobStageText({ name: 'uploading', sent: 1, total: 4 })).toBe('上传中 25%');
    expect(jobStageText({ name: 'queued', ahead: 2 })).toBe('排队中，前面还有 2 个');
    expect(jobStageText({ name: 'printing', done: 3, total: 8 })).toBe('正在打印 3/8');
    expect(jobStageText({ name: 'unknown' })).toBe('电脑重启过，不知道这个任务打没打：请到电脑上的打印记录核对');
    expect(jobStageText({ name: 'done', result: { status: 'sent', labels: 2 } })).toBe('已发送打印 2 张');
  });

  test('explains the end of a share and what to do', () => {
    expect(screenText({ name: 'ended', reason: 'revoked' }).title).toBe('这个共享已被撤销');
    expect(screenText({ name: 'offline' }).title).toBe('电脑现在不在线');
    expect(screenText({ name: 'pending' }).title).toBe('等电脑上的人确认');
  });
});
```

`remote-controller.test.ts`：用假页面（记下调用）、假客户端（记下 `uploadDocument` 的参数）测两件事：

```ts
test('reads a chosen file, checks it, hashes it and uploads it with the chosen options', async () => {
  const { controller, client } = setup();
  const bytes = new TextEncoder().encode('%PDF-1.7\n...');
  await controller.uploadFile({ name: 'C:\\fakepath\\面单.pdf', size: bytes.length, read: async () => bytes }, {
    paper: '100x150',
    crop: 'trim',
    copies: 2,
  });
  expect(client.uploads).toHaveLength(1);
  expect(client.uploads[0]).toMatchObject({
    file: { name: '面单.pdf', kind: 'pdf', bytes },
    options: { paper: '100x150', crop: 'trim', copies: 2 },
  });
  expect(client.uploads[0]?.file.sha256).toHaveLength(32);
});

test('refuses a file that is not a PDF, JPEG or PNG without sending anything', async () => {
  const { controller, client, view } = setup();
  await controller.uploadFile({ name: 'a.docx', size: 4, read: async () => new TextEncoder().encode('PK..') }, {
    paper: '100x150',
    crop: 'trim',
    copies: 1,
  });
  expect(client.uploads).toEqual([]);
  expect(view.issues.at(-1)).toBe('只能打印 PDF、JPEG、PNG 文件');
});
```

（`setup()` 按这两条需要写：`RemoteController` 的依赖是 `{ client: Pick<RemoteClient, 'uploadDocument' | 'fillTemplate' | 'retry'>, view: { render(state): void; showIssue(text): void }, digest: (bytes) => Promise<Uint8Array> }`，测试里 `digest` 用 `crypto.subtle.digest('SHA-256', bytes)`。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test relay/web/src/remote`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// relay/web/src/remote/file-check.ts
/** 选中的文件能不能传：先看大小（不读内容），再按文件头认种类（不信扩展名）。 */
import { REMOTE_MAX_DOCUMENT_BYTES, type RemoteDocumentKind } from '../../../../src/shared/remote-protocol';

const BYTES_PER_MB = 1024 * 1024;
const PDF_HEADER_WINDOW_BYTES = 1024;

export const FILE_ISSUES = {
  empty: '这个文件是空的',
  tooLarge: `文件超过 ${REMOTE_MAX_DOCUMENT_BYTES / BYTES_PER_MB}MB：拆成几个小一点的再传`,
  unknown: '只能打印 PDF、JPEG、PNG 文件',
} as const;

export function checkFile(file: { size: number }): string | null {
  if (file.size === 0) {
    return FILE_ISSUES.empty;
  }
  return file.size > REMOTE_MAX_DOCUMENT_BYTES ? FILE_ISSUES.tooLarge : null;
}

export function sniffKind(bytes: Uint8Array): RemoteDocumentKind | null {
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) {
    return 'png';
  }
  if ([0xff, 0xd8, 0xff].every((byte, index) => bytes[index] === byte)) {
    return 'jpeg';
  }
  return new TextDecoder('latin1').decode(bytes.subarray(0, PDF_HEADER_WINDOW_BYTES)).includes('%PDF-') ? 'pdf' : null;
}
```

（电脑上还会按同样的规则再认一次（`document-kind.ts`）：页面这一步只为早点告诉对方，不能代替电脑的检查。）

```ts
// relay/web/src/remote/remote-state.ts
/**
 * 远程打印页的状态（纯函数 reducer）：一个屏幕（连接中、可以打印、等确认、各种结束）和一列任务卡片。
 * 状态用可辨识联合表示，「有结果却没有结果内容」这类不可能的状态写不出来。
 */
import type { EndReason } from '../../../../src/shared/mobile-protocol';
import type { RemoteCatalog, RemoteDenial, RemoteRefusal, RemoteResult } from '../../../../src/shared/remote-protocol';
import type { ClientEvent } from './remote-client';

/** 已结束的任务卡片最多留 20 张；还没结果的一直留着。 */
export const REMOTE_JOB_HISTORY = 20;

export type RemoteScreen =
  | { name: 'no-link' }
  | { name: 'connecting' }
  | { name: 'pending' }
  | { name: 'ready'; share: string; catalog: RemoteCatalog }
  | { name: 'desktop-offline'; share: string | null }
  | { name: 'offline' }
  | { name: 'ended'; reason: EndReason }
  | { name: 'denied'; reason: RemoteDenial }
  | { name: 'outdated' };

export type JobStage =
  | { name: 'sending' }
  | { name: 'uploading'; sent: number; total: number }
  | { name: 'queued'; ahead: number }
  | { name: 'printing'; done: number; total: number }
  | { name: 'done'; result: RemoteResult }
  | { name: 'refused'; reason: RemoteRefusal }
  | { name: 'unknown' };

export interface JobCard {
  id: string;
  title: string;
  stage: JobStage;
}

export interface RemoteState {
  screen: RemoteScreen;
  /** 最新的在前。 */
  jobs: JobCard[];
  /** 最近一次有结果的任务（朗读区念它）。 */
  announced: string | null;
}

export function initialRemoteState(hasLink: boolean): RemoteState {
  return { screen: hasLink ? { name: 'connecting' } : { name: 'no-link' }, jobs: [], announced: null };
}

export function reduceRemote(state: RemoteState, event: ClientEvent): RemoteState {
  switch (event.type) {
    case 'link':
      return isFinal(state.screen)
        ? state
        : {
            ...state,
            screen:
              event.link === 'connecting'
                ? { name: 'connecting' }
                : { name: 'desktop-offline', share: state.screen.name === 'ready' ? state.screen.share : null },
          };
    case 'pending':
      return { ...state, screen: { name: 'pending' } };
    case 'welcomed':
      return { ...state, screen: { name: 'ready', share: event.share, catalog: event.catalog } };
    case 'catalog':
      return state.screen.name === 'ready' ? { ...state, screen: { ...state.screen, catalog: event.catalog } } : state;
    case 'submitted':
      return state.jobs.some((job) => job.id === event.job)
        ? state
        : { ...state, jobs: trim([{ id: event.job, title: event.title, stage: { name: 'sending' } }, ...state.jobs]) };
    case 'uploading':
      return withStage(state, event.job, { name: 'uploading', sent: event.sent, total: event.total });
    case 'queued':
      return event.positions.reduce(
        (current, position) => withStage(current, position.job, { name: 'queued', ahead: position.ahead }),
        state,
      );
    case 'started':
      return withStage(state, event.job, { name: 'printing', done: event.done, total: event.total });
    case 'result':
      return { ...withStage(state, event.job, { name: 'done', result: event.result }), announced: event.job };
    case 'refused':
      return withStage(state, event.job, { name: 'refused', reason: event.reason });
    case 'unknown':
      return event.jobs.reduce((current, job) => withStage(current, job, { name: 'unknown' }), state);
    case 'denied':
      return { ...state, screen: { name: 'denied', reason: event.reason } };
    case 'ended':
      return { ...state, screen: { name: 'ended', reason: event.reason } };
    case 'offline':
      return { ...state, screen: { name: 'offline' } };
    case 'outdated':
      return { ...state, screen: { name: 'outdated' } };
  }
}

function isFinal(screen: RemoteScreen): boolean {
  return ['no-link', 'ended', 'denied', 'outdated', 'offline'].includes(screen.name);
}

function withStage(state: RemoteState, jobId: string, stage: JobStage): RemoteState {
  return { ...state, jobs: state.jobs.map((job) => (job.id === jobId ? { ...job, stage } : job)) };
}

/** 已结束的卡片超过 REMOTE_JOB_HISTORY 张时去掉最旧的；没结束的不去。 */
function trim(jobs: JobCard[]): JobCard[] {
  let finished = 0;
  return jobs.filter((job) => {
    const isFinished = ['done', 'refused', 'unknown'].includes(job.stage.name);
    finished += isFinished ? 1 : 0;
    return !isFinished || finished <= REMOTE_JOB_HISTORY;
  });
}
```

```ts
// relay/web/src/remote/remote-text.ts
/** 远程打印页的文字（纯函数）：结果的说法和电脑上的「共享」页同一份（src/shared/remote-result-text.ts）。 */
import { describeRemoteResult } from '../../../../src/shared/remote-result-text';
import type { JobStage, RemoteScreen } from './remote-state';

const PERCENT = 100;

export function jobStageText(stage: JobStage): string {
  switch (stage.name) {
    case 'sending':
      return '正在发送…';
    case 'uploading':
      return `上传中 ${Math.floor((stage.sent / stage.total) * PERCENT)}%`;
    case 'queued':
      return stage.ahead > 0 ? `排队中，前面还有 ${stage.ahead} 个` : '排队中，下一个就是它';
    case 'printing':
      return `正在打印 ${stage.done}/${stage.total}`;
    case 'done':
      return describeRemoteResult(stage.result).title;
    case 'refused':
      return stage.reason === 'too-many-pending'
        ? '你还有几个任务没打完：等它们出结果再提交'
        : '电脑那边正忙：稍后再提交';
    case 'unknown':
      return '电脑重启过，不知道这个任务打没打：请到电脑上的打印记录核对';
  }
}

export function screenText(screen: RemoteScreen): { title: string; text: string } {
  switch (screen.name) {
    case 'no-link':
      return { title: '链接不完整', text: '请向对方要远程打印的链接，完整地打开它（不要只复制前半段）。' };
    case 'connecting':
      return { title: '正在连接…', text: '' };
    case 'pending':
      return { title: '等电脑上的人确认', text: '第一次用这台设备打印，要电脑那边点一下「允许」。' };
    case 'ready':
      return { title: screen.share, text: '' };
    case 'desktop-offline':
      return { title: '电脑现在不在线', text: '电脑上的程序没开着，或者链接已失效。会自动重试，也可以稍后再打开。' };
    case 'offline':
      return { title: '电脑现在不在线', text: '一直连不上：电脑上的程序没开着，或者链接已撤销、到期。点「重试」再试一次。' };
    case 'ended':
      return screen.reason === 'expired'
        ? { title: '这个共享已到期', text: '请向对方要一个新的链接。' }
        : screen.reason === 'revoked'
          ? { title: '这个共享已被撤销', text: '请向对方要一个新的链接。' }
          : { title: '电脑现在不在线', text: '稍后再打开这个链接。' };
    case 'denied':
      return screen.reason === 'full'
        ? { title: '在用的设备太多了', text: '稍后再试。' }
        : { title: '电脑那边没有同意这台设备', text: '需要的话请联系对方。' };
    case 'outdated':
      return { title: '页面需要更新', text: '刷新页面拿到新版本。' };
  }
}
```

```ts
// relay/web/src/remote/remote-controller.ts
/**
 * 远程打印页的编排：选文件 → 检查大小 → 读内容 → 认种类 → 算 SHA-256 → 交给 RemoteClient；
 * 模板表单 → 交给 RemoteClient；协议事件 → reducer → 页面。浏览器能力都经接口注入，用 bun test 测试。
 */
import type { PhoneField } from '../../../../src/shared/mobile-protocol';
import { cleanFileName, type RemoteTemplate } from '../../../../src/shared/remote-protocol';
import { checkFile, FILE_ISSUES, sniffKind } from './file-check';
import type { ClientEvent, DocumentOptions, RemoteClient } from './remote-client';
import { initialRemoteState, type RemoteState, reduceRemote } from './remote-state';

/** 页面上选中的文件：大小先看（不读内容），确认能传才读。 */
export interface PickedFile {
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

export interface RemoteView {
  render(state: RemoteState): void;
  showIssue(text: string): void;
}

export interface RemoteControllerDeps {
  client: Pick<RemoteClient, 'uploadDocument' | 'fillTemplate' | 'retry'>;
  view: RemoteView;
  digest: (bytes: Uint8Array) => Promise<Uint8Array>;
}

export class RemoteController {
  private state: RemoteState;

  constructor(
    private readonly deps: RemoteControllerDeps,
    hasLink: boolean,
  ) {
    this.state = initialRemoteState(hasLink);
    deps.view.render(this.state);
  }

  dispatch(event: ClientEvent): void {
    this.state = reduceRemote(this.state, event);
    this.deps.view.render(this.state);
  }

  async uploadFile(picked: PickedFile, options: DocumentOptions): Promise<void> {
    const issue = checkFile(picked);
    if (issue !== null) {
      this.deps.view.showIssue(issue);
      return;
    }
    const bytes = await picked.read();
    const kind = sniffKind(bytes);
    if (kind === null) {
      this.deps.view.showIssue(FILE_ISSUES.unknown);
      return;
    }
    const sha256 = await this.deps.digest(bytes);
    this.deps.client.uploadDocument({ name: cleanFileName(picked.name), kind, bytes, sha256 }, options);
  }

  fillTemplate(template: RemoteTemplate, fields: PhoneField[], copies: number): void {
    this.deps.client.fillTemplate(template, fields, copies);
  }

  retry(): void {
    this.deps.client.retry();
  }
}
```

`remote-view.ts`：照 `relay/web/src/view.ts` 的写法，构造时按 id 拿到元素，`render(state)` 只改变了的部分：

- `#screen-message` / `#screen-ready` 按 `state.screen.name` 切换 `hidden`；标题、说明用 `screenText`；`offline` 时显示「重试」，`outdated` 时显示「刷新页面」。
- `#paper`（`<select>`）按 `catalog.papers` 重建选项（`option.textContent = label`），保持原来选中的那项；没有纸张时整块上传表单换成「电脑上还没有分配打印机，暂时不能打印」。
- `#template`（`<select>`）按 `catalog.templates` 重建；选中模板后 `#fields` 里每个字段一个 `<label>` + `<input>`（`textContent` 写字段名，`input.name` 不用字段名拼选择器）；模板 `fields` 为空（「全部字段」）时给一行「名称」「内容」两个输入框和「加一行」。没有共享的模板时整节隐藏。
- `#jobs`：按任务号复用 `<li>`（`dataset.job`），标题、状态文字（`jobStageText`）、结果的说明（`describeRemoteResult(...).detail`）；`data-tone` 给颜色。`state.announced` 变了时把那张的「标题：结果」写进 `#announcer`。
- `showIssue(text)`：写进 `#issue`（`role="alert"`）。
- 所有文字一律 `textContent`，不用 `innerHTML`。

`main.ts`：

```ts
/**
 * 远程打印页入口：读链接里的会话号和密钥，创建真实的协议客户端、页面和控制器。
 * 状态在 remote-state.ts，文字在 remote-text.ts，编排在 remote-controller.ts，这里只做接线。
 */
import { importSessionKey } from '../../../../src/shared/mobile-crypto';
import { parseShareFragment } from '../../../../src/shared/remote-protocol';
import { deviceLabel } from '../device-label';
import type { KeyValueStorage } from '../session-store';
import { RemoteClient } from './remote-client';
import { RemoteController } from './remote-controller';
import { openRemoteStore } from './remote-store';
import { RemoteView, readName, saveName } from './remote-view';

function safeLocalStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  const fragment = parseShareFragment(location.hash);
  const storage = safeLocalStorage();
  let controller: RemoteController | null = null;
  let client: RemoteClient | null = null;
  const view = new RemoteView(document, {
    onUpload: (picked, options) => void controller?.uploadFile(picked, options),
    onFill: (template, fields, copies) => controller?.fillTemplate(template, fields, copies),
    onRetry: () => controller?.retry(),
    onReload: () => location.reload(),
    onName: (name) => saveName(storage, name),
  });
  if (!fragment) {
    new RemoteController({ client: { uploadDocument: () => '', fillTemplate: () => '', retry: () => {} }, view, digest: sha256 }, false);
    return;
  }
  // 页面在 <中转地址>r/，WebSocket 在 <中转地址>ws/remote。
  const socketUrl = new URL('../ws/remote', location.href);
  socketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  client = new RemoteClient({
    relayUrl: socketUrl.href,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device: deviceLabel(navigator.userAgent),
    name: () => readName(storage),
    store: openRemoteStore(storage, fragment.session, () => Date.now()),
    createSocket: (url) => new WebSocket(url),
    timers: {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
    now: () => Date.now(),
    onEvent: (event) => controller?.dispatch(event),
  });
  controller = new RemoteController({ client, view, digest: sha256 }, true);
  client.start();
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

start().catch((error: unknown) => {
  console.error('[remote] the page could not start', error);
  const title = document.getElementById('message-title');
  if (title) {
    title.textContent = '这个浏览器打不开远程打印页，请换用新版的 Chrome、Edge 或 Safari 再试';
  }
});
```

（`deviceLabel` 对电脑浏览器给「电脑 · Edge」这样的描述，扫码页已有，直接复用。`readName` / `saveName` 在 `remote-view.ts` 里读写 `localStorage` 的 `labelflash.remote.name`，读出时同样经 `cleanRemoteName`，异常时返回空串。）

`relay/web/remote/index.html` 补上完整的结构（标签文字就是 Task 20–22 定位用的名字，改了要一起改）：

- `#screen-message`：`<h1 id="message-title">`、`#message-text`、`#message-action`（「重试」或「刷新页面」）；
- `#screen-ready`：`<h1 id="share-name">`；`<label for="name">你的名字（电脑上显示）</label><input id="name" maxlength="20">`；
- 上传表单 `<form id="upload" aria-label="上传文件">`：`<label for="file">选择文件</label><input type="file" id="file" accept=".pdf,image/jpeg,image/png">`、`<label for="paper">纸张</label><select id="paper">`、`<label for="crop">裁切</label><select id="crop">`（去白边 / 整页 / 一页多张）、`<label for="copies">份数</label><input id="copies" type="number" min="1" max="20" value="1">`、`<button type="submit">打印</button>`；
- 模板表单 `<form id="fill" aria-label="按模板填写">`：`<label for="template">模板</label><select id="template">`、`#fields`（每个字段一个 `<label>` 写字段名 + `<input>`）、`<label for="fill-copies">份数</label><input id="fill-copies" …>`、`<button type="submit">打印</button>`；
- `<p id="issue" role="alert">`、`<ol id="jobs" aria-label="打印任务">`、`<p id="announcer" class="visually-hidden" role="status" aria-live="polite">`。`styles.css` 加这些块的样式：单栏，最大宽 640px 居中；输入框 `font-size: 16px`；按钮 `min-height: 48px`；任务卡片按 `data-tone` 上色（变量和扫码页一致）。

- [ ] **Step 4: 跑测试，本机看一遍**

Run: `bun test relay/web && bun run check`
Expected: PASS。

再开三个终端：`bun run relay:dev`；`bun run dev`（设置里填 `http://localhost:3180/`，「共享」页新建一个共享，关掉「新设备要我确认」，勾一个模板）；浏览器打开共享链接：上传一个小 PDF、填一次模板，看到上传进度、排队、「已发送打印 N 张」；电脑的打印记录里有来源「远程」的记录。开发者工具 Console 没有 CSP 报错。

- [ ] **Step 5: 提交**

```bash
git add relay/web/src/remote relay/web/remote
git commit -m "feat(remote): the remote printing page" -m "Anyone with the link can upload a PDF or image, or fill a shared template, choose paper, crop and copies, and follow upload progress, queue position, printing progress and the result. Files are size-checked before they are read, recognised by their header, hashed and handed to the protocol client. Page state is a pure reducer, wording is shared with the desktop, and all text is set with textContent." -m "$TRAILER"
```

---

### Task 20: 浏览器测试：Edge 打开远程打印页

`bun run test:relay-browser` 现在只跑扫码页；加一个远程打印页的文件，同一条命令一起跑。电脑端用真实的 `RemoteHost` + `RemoteSession`，打印换成记下来、立即给结果。

**Files:**
- Create: `relay/test/remote-page.browser.ts`
- Modify: `package.json`（`test:relay-browser`）

- [ ] **Step 1: 写测试**

```ts
// relay/test/remote-page.browser.ts
/**
 * 浏览器测试：真实的 Edge 打开中转服务上的远程打印页，经真实的中转服务把文件分块传到电脑端（RemoteHost），
 * 填共享的模板，看到结果；撤销后页面说明。需要本机装有 Edge。运行：bun run test:relay-browser
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, devices } from '@playwright/test';
import { buildRelay } from '../../scripts/relay/build';
import { systemClock } from '../../src/core/types';
import type { StoredDevice } from '../../src/main/storage/sqlite-remote-share-store';
import { StoreDeviceRegistry } from '../../src/main/remote/device-registry';
import { RemoteHost } from '../../src/main/remote/remote-host';
import { type AcceptedJob, ByteBudget, RemoteSession } from '../../src/main/remote/remote-session';
import { randomId, randomKey } from '../../src/shared/mobile-crypto';
import type { SocketLike } from '../../src/shared/relay-socket';
import { buildShareUrl, REMOTE_CHUNK_BYTES, type RemoteCatalog } from '../../src/shared/remote-protocol';
import { type RunningRelay, startRelay } from '../src/server';

const CATALOG: RemoteCatalog = {
  papers: [
    { key: '100x150', label: '100×150 面单' },
    { key: '60x40', label: '60×40 标签' },
  ],
  templates: [{ id: 'custom:tag-1', name: '吊牌', paper: '60x40', fields: ['品名', '价格'] }],
};
/** 600KB 的「PDF」：三块（页面只认文件头，电脑端是假的，不渲染）。 */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(600 * 1024, 0x20)]);
const BUILD_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 30_000;

let workDir: string;
let relay: RunningRelay;
let host: RemoteHost;
let session: RemoteSession;
let shareUrl: string;
let browser: Browser;
const accepted: AcceptedJob[] = [];
const rows: StoredDevice[] = [];

function freePort(): number {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'remote-browser-'));
  await buildRelay({ outDir: join(workDir, 'dist'), version: 'browser-test' });
  const port = freePort();
  const origin = `http://localhost:${port}`;
  relay = startRelay(
    {
      host: '127.0.0.1',
      port,
      publicOrigin: origin,
      webRoot: join(workDir, 'dist', 'web'),
      remoteRoot: join(workDir, 'dist', 'remote'),
      version: 'browser-test',
    },
    () => {},
  );
  const keys = { sessionId: randomId(), ownerSecret: randomId(), key: randomKey() };
  shareUrl = buildShareUrl(`${origin}/`, keys.sessionId, keys.key);
  session = new RemoteSession({
    clock: systemClock,
    devices: new StoreDeviceRegistry(
      {
        devices: (shareId) => rows.filter((row) => row.shareId === shareId),
        addDevice: (device) => {
          rows.push(device);
        },
        touchDevice: () => undefined,
        removeDevice: () => undefined,
      },
      'share',
      systemClock,
    ),
    budget: new ByteBudget(PDF.length * 4),
    catalog: () => CATALOG,
    approveNewDevices: () => false,
  });
  host = new RemoteHost({
    keys,
    relayBase: new URL(`${origin}/`),
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    session,
    shareName: () => '北京仓',
    expiresAt: null,
    catalog: () => CATALOG,
    submit: (job) => {
      accepted.push(job);
      const copies = job.spec.copies;
      // 假装打印：下一轮事件循环里报进度和结果（accepted 先发出去）。
      setTimeout(() => {
        host.deliver(session.progressed(job.job, { type: 'started', job: job.job, done: copies, total: copies }));
        host.deliver(session.finished(job.job, { status: 'sent', labels: copies }));
      }, 0);
      return 0;
    },
    onChange: () => undefined,
    log: () => undefined,
  });
  host.start();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  host?.stop('quit');
  await relay?.stop();
  await rm(workDir, { recursive: true, force: true });
});

test(
  'uploads a PDF in chunks through the relay and shows the result',
  async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(shareUrl);
    await page.getByLabel('你的名字（电脑上显示）').fill('张三');
    await page.getByLabel('纸张').selectOption('100x150');
    await page.getByLabel('份数').first().fill('2');
    await page.getByLabel('选择文件').setInputFiles({ name: '面单.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByRole('button', { name: '打印', exact: true }).first().click();
    await page.locator('#jobs').getByText('已发送打印 2 张').waitFor({ timeout: STEP_TIMEOUT_MS });
    const [job] = accepted;
    expect(job?.spec.kind === 'document' ? Buffer.from(job.spec.bytes).equals(PDF) : false).toBe(true);
    expect(PDF.length).toBeGreaterThan(2 * REMOTE_CHUNK_BYTES);
    expect(job?.device.label).toBe('张三 · 电脑 · Edge');
    expect(await page.locator('#announcer').textContent()).toContain('已发送打印 2 张');
    expect(errors).toEqual([]);
  },
  STEP_TIMEOUT_MS * 2,
);

test(
  'fills a shared template and sends only its fields',
  async () => {
    const page = await browser.newPage();
    await page.goto(shareUrl);
    await page.getByLabel('模板').selectOption('custom:tag-1');
    await page.getByLabel('品名').fill('短袖T恤');
    await page.getByLabel('价格').fill('99');
    await page.locator('#fill').getByRole('button', { name: '打印' }).click();
    await page.locator('#jobs').getByText('已发送打印 1 张').waitFor({ timeout: STEP_TIMEOUT_MS });
    expect(accepted.at(-1)?.spec).toEqual({
      kind: 'template',
      template: 'custom:tag-1',
      fields: [
        { name: '品名', value: '短袖T恤' },
        { name: '价格', value: '99' },
      ],
      copies: 1,
    });
  },
  STEP_TIMEOUT_MS * 2,
);

test(
  'fits a phone screen without sideways scrolling or zooming inputs',
  async () => {
    const context = await browser.newContext({ ...devices['iPhone SE'] });
    try {
      const page = await context.newPage();
      await page.goto(shareUrl);
      await page.getByLabel('纸张').waitFor({ timeout: STEP_TIMEOUT_MS });
      const layout = await page.evaluate(() => {
        const scope = globalThis as unknown as {
          document: { documentElement: { scrollWidth: number; clientWidth: number }; querySelectorAll(s: string): ArrayLike<unknown> };
          getComputedStyle(element: unknown): { fontSize: string };
        };
        const inputs = Array.from(scope.document.querySelectorAll('input, select'));
        return {
          overflow: scope.document.documentElement.scrollWidth - scope.document.documentElement.clientWidth,
          smallest: Math.min(...inputs.map((input) => Number.parseFloat(scope.getComputedStyle(input).fontSize))),
        };
      });
      expect(layout.overflow).toBeLessThanOrEqual(0);
      expect(layout.smallest).toBeGreaterThanOrEqual(16);
    } finally {
      await context.close();
    }
  },
  STEP_TIMEOUT_MS * 2,
);

test(
  'tells the viewer that the share was revoked',
  async () => {
    const page = await browser.newPage();
    await page.goto(shareUrl);
    await page.getByLabel('纸张').waitFor({ timeout: STEP_TIMEOUT_MS });
    host.stop('revoked');
    await page.getByRole('heading', { name: '这个共享已被撤销' }).waitFor({ timeout: STEP_TIMEOUT_MS });
  },
  STEP_TIMEOUT_MS * 2,
);
```

（撤销那条放在最后：撤销后这个会话就没了。）

`package.json`：

```json
    "test:relay-browser": "bun test ./relay/test/phone-page.browser.ts ./relay/test/remote-page.browser.ts",
```

- [ ] **Step 2: 跑**

Run: `bun run test:relay-browser`
Expected: 扫码页原有的用例和这四条都过。不过时按失败的那一步查页面（`page.screenshot` 存到工作目录看），不改断言里的用语：它们和 `remote-text.ts`、`remote-result-text.ts` 是同一份。

- [ ] **Step 3: 提交**

```bash
git add relay/test/remote-page.browser.ts package.json
git commit -m "test(remote): drive the remote printing page in Edge through a real relay" -m "Edge uploads a 600KB file that crosses three chunks, fills a shared template, checks the phone layout and sees a revoked share, against the real relay and the real desktop host with printing replaced by a recorder." -m "$TRAILER"
```

---

### Task 21: E2E：远程上传的 PDF 从假打印机出来

**Files:**
- Modify: `e2e/support/relay-server.ts`
- Create: `e2e/remote.e2e.ts`

- [ ] **Step 1: 测试用的远程打印页客户端**

`e2e/support/relay-server.ts` 加（和 `connectTestPhone` 同一个写法）：

```ts
export interface TestViewer {
  client: RemoteClient;
  events: ClientEvent[];
}

/** 用远程打印页自己的协议代码（RemoteClient）当一台远程设备，打开共享链接。 */
export async function connectTestViewer(relay: LocalRelay, shareUrl: string, name: string): Promise<TestViewer> {
  const fragment = parseShareFragment(new URL(shareUrl).hash);
  if (!fragment) {
    throw new Error(`共享链接不对：${shareUrl}`);
  }
  const events: ClientEvent[] = [];
  const socketUrl = new URL('ws/remote', relay.baseUrl);
  socketUrl.protocol = 'ws:';
  const client = new RemoteClient({
    relayUrl: socketUrl.href,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device: 'E2E',
    name: () => name,
    store: openRemoteStore(null, fragment.session, () => Date.now()),
    createSocket: (url) =>
      new WebSocket(url, { headers: { Origin: relay.origin } } as unknown as string[]) as unknown as SocketLike,
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => Date.now(),
    onEvent: (event) => events.push(event),
  });
  client.start();
  return { client, events };
}
```

- [ ] **Step 2: 写 E2E**

```ts
// e2e/remote.e2e.ts
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import type { ClientEvent } from '../relay/web/src/remote/remote-client';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { REMOTE_CHUNK_BYTES } from '../src/shared/remote-protocol';
import { callApi, fakePrints, openConfig } from './support/app-helpers';
import { expect, test } from './support/fixtures';
import { gridPdfBytes } from './support/pdf-files';
import { connectTestViewer, type LocalRelay, startLocalRelay } from './support/relay-server';

const WAYBILL_PRINTER: FakePrinterSpec = {
  name: '面单机',
  paper: { widthMm: 100, heightMm: 150, dpi: 203 },
  readiness: { ready: true },
};
/** 构建中转服务（两个页面）要几秒。 */
const RELAY_SETUP_TIMEOUT_MS = 60_000;

let relay: LocalRelay;

test.beforeAll(async () => {
  test.setTimeout(RELAY_SETUP_TIMEOUT_MS);
  relay = await startLocalRelay();
});

test.afterAll(async () => {
  await relay?.stop();
});

async function useLocalRelay(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { mobileRelayUrl: relay.baseUrl, paperPrinters: { '100x150': WAYBILL_PRINTER.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

/** 在「共享」页新建一个共享，等它连上中转服务，返回链接。 */
async function createShare(page: Page, { approve }: { approve: boolean }): Promise<string> {
  await openConfig(page, '共享');
  await page.getByRole('button', { name: '新建远程共享' }).click();
  const form = page.getByRole('form', { name: '新建远程共享' });
  await form.getByLabel('共享名称').fill('北京仓');
  await form.getByLabel('新设备要我确认').setChecked(approve);
  await form.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('article', { name: '远程共享 北京仓' })).toContainText('已连上中转服务');
  const status = await callApi(page, 'getRemoteStatus');
  return status.shares[0]?.url ?? '';
}

function resultOf(events: ClientEvent[]) {
  const event = events.find((item) => item.type === 'result');
  return event?.type === 'result' ? event.result : null;
}

function hasEvent(events: ClientEvent[], type: ClientEvent['type']): boolean {
  return events.some((event) => event.type === type);
}

test('prints a PDF uploaded through a remote share and records it as remote', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await useLocalRelay(page);
  const viewer = await connectTestViewer(relay, await createShare(page, { approve: false }), '北京同事');
  try {
    await expect.poll(() => hasEvent(viewer.events, 'welcomed')).toBe(true);
    const bytes = new Uint8Array(await gridPdfBytes(app));
    viewer.client.uploadDocument(
      { name: '面单.pdf', kind: 'pdf', bytes, sha256: createHash('sha256').update(bytes).digest() },
      { paper: '100x150', crop: 'split', copies: 1 },
    );
    await expect.poll(() => resultOf(viewer.events), { timeout: 30_000 }).toEqual({ status: 'sent', labels: 8 });
    expect((await fakePrints(app)).map((print) => print.printerName)).toEqual(Array(8).fill('面单机'));
    const [record] = (await callApi(page, 'listJobs', { limit: 1 })).jobs;
    expect(record).toMatchObject({ source: 'remote', caller: 'remote:北京仓 · 北京同事 · E2E', status: 'printed' });
    // 「共享」页的最近任务里有它。
    await expect(page.getByRole('list', { name: '最近的远程任务' })).toContainText('已发送打印 8 张');
  } finally {
    viewer.client.stop();
  }
});

test('sends a large image in chunks and prints it', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await useLocalRelay(page);
  const viewer = await connectTestViewer(relay, await createShare(page, { approve: false }), '北京同事');
  try {
    await expect.poll(() => hasEvent(viewer.events, 'welcomed')).toBe(true);
    // 随机噪点压不小：PNG 有一 MB 多，要分好几块。
    const side = 700;
    const noise = Buffer.from(Array.from({ length: side * side * 3 }, () => Math.floor(Math.random() * 256)));
    const png = new Uint8Array(await sharp(noise, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer());
    expect(png.length).toBeGreaterThan(2 * REMOTE_CHUNK_BYTES);
    viewer.client.uploadDocument(
      { name: '照片.png', kind: 'png', bytes: png, sha256: createHash('sha256').update(png).digest() },
      { paper: '100x150', crop: 'page', copies: 1 },
    );
    await expect.poll(() => resultOf(viewer.events), { timeout: 30_000 }).toEqual({ status: 'sent', labels: 1 });
    expect(await fakePrints(app)).toHaveLength(1);
  } finally {
    viewer.client.stop();
  }
});

test('asks before a new device prints and forgets a removed device', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await useLocalRelay(page);
  const viewer = await connectTestViewer(relay, await createShare(page, { approve: true }), '李四');
  try {
    await expect.poll(() => hasEvent(viewer.events, 'pending')).toBe(true);
    const prompt = page.getByRole('region', { name: '等待确认的远程设备' });
    await expect(prompt).toContainText('「李四 · E2E」想通过远程共享「北京仓」打印');
    await prompt.getByRole('button', { name: '允许' }).click();
    await expect.poll(() => hasEvent(viewer.events, 'welcomed')).toBe(true);
    const devices = page.getByRole('list', { name: '北京仓 的设备' });
    await expect(devices).toContainText('李四 · E2E');
    await devices.getByRole('button', { name: '移除' }).click();
    await expect.poll(() => viewer.events.at(-1)).toEqual({ type: 'denied', reason: 'removed' });
    await expect(page.getByRole('article', { name: '远程共享 北京仓' }).getByLabel('新设备要我确认')).toBeChecked();
  } finally {
    viewer.client.stop();
  }
});

test('revokes a share: the viewer is told and the link stops working', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [WAYBILL_PRINTER] });
  await useLocalRelay(page);
  const url = await createShare(page, { approve: false });
  const viewer = await connectTestViewer(relay, url, '北京同事');
  try {
    await expect.poll(() => hasEvent(viewer.events, 'welcomed')).toBe(true);
    const card = page.getByRole('article', { name: '远程共享 北京仓' });
    await card.getByRole('button', { name: '撤销' }).click();
    await card.getByRole('button', { name: /确认撤销/ }).click();
    await expect.poll(() => viewer.events.at(-1)).toEqual({ type: 'ended', reason: 'revoked' });
    const late = await connectTestViewer(relay, url, '后来的人');
    try {
      await expect
        .poll(() => late.events.some((event) => event.type === 'link' && event.link === 'desktop-offline'))
        .toBe(true);
    } finally {
      late.client.stop();
    }
  } finally {
    viewer.client.stop();
  }
});
```

（`electronApp.launch` 返回的对象里有没有 `app`，按 `e2e/support/fixtures.ts` 实际的写法取；PDF 打印的 E2E 用的是同一个。`page.getByRole('region', …)`：`<section aria-label>` 在 Playwright 里是 region。）

- [ ] **Step 3: 跑**

Run: `bun run test:e2e`
Expected: 全过，含这四条。第一条的 8 张：2 页、每页 2×2，按「一页多张」切开（和 PDF 打印的 E2E 同一份 PDF）。

- [ ] **Step 4: 提交**

```bash
git add e2e/support/relay-server.ts e2e/remote.e2e.ts
git commit -m "test(remote): end-to-end remote printing through a local relay" -m "The app creates a share from the sharing page, a scripted remote viewer uploads a four-up waybill PDF and a multi-chunk PNG, and the labels come out of the fake printer as remote records. Approval of a new device, removing it and revoking the share are driven from the page and observed on the viewer." -m "$TRAILER"
```

---

### Task 22: 视觉验收 V94–V97，文档

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（验收表）
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（8.2 节）、`docs/superpowers/specs/2026-09-29-mobile-scan-relay-design.md`（第 4.5、5 节）
- Modify: `relay/README.md`、`relay/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`、`CLAUDE.md`、`README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`

- [ ] **Step 1: 视觉验收**

`ITEMS` 末尾（当时最后一项之后）加四项，写法照 V32（手机扫码浮层）、V38（本机接口）：

| 编号 | 标题 | 要点 | 准备 |
|---|---|---|---|
| V94 | 配置中心 · 共享 · 异地远程打印 | 两张卡片：一张在线（二维码、链接可选中不溢出、有效期、两台设备一在线一「几小时前来过」、勾了一个模板），一张「和中转服务断开了」；最近任务三条（排队中、正在打印 3/8、已发送）；到期提示和「知道了」；1024 宽度下卡片单栏，按钮不换行截断 | 本机中转服务（`startLocalRelay`）；经 `callApi` 建两个共享；用 `connectTestViewer` 连两台、传一份 PDF；第二个共享的状态靠改中转地址后再改回（截图在重连前） |
| V95 | 新建远程共享 | 表单：名称、有效期四个选项、模板勾选（20 个以上时可滚动）、「新设备要我确认」；没有中转地址时的原因和「去填写中转地址」；焦点框清晰，键盘能走完 | 清掉中转地址后点「创建」 |
| V96 | 工作台 · 新设备的询问条 | 顶部询问条：设备名、共享名、「拒绝」「允许」；同时有网站询问时两条叠放不遮挡扫码框；按钮不进 Tab 顺序 | 共享开着「新设备要我确认」，一台测试设备连上；另经本机接口制造一条网站询问 |
| V97 | 远程打印页 | Edge 打开链接（390×844、1280×800）：可以打印（上传表单、模板表单）、上传中 40%、等电脑确认、电脑不在线、已撤销五种屏幕；输入框 16px，按钮 ≥ 48px，没有横向滚动 | `custom` 里用 `@playwright/test` 的 `chromium.launch({ channel: 'msedge' })` 打开本机中转服务上的链接，截图交给 `record` |

`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 的验收表加同样的四行。

- [ ] **Step 2: 跑视觉验收、逐张看**

Run: `bunx playwright test -c e2e/visual/playwright.config.ts -g "V9[4-7]"`（按 `e2e/visual` 里现成的运行方式）
Expected: 生成截图；按要点逐张核对（Windows 100%、150% 缩放；macOS 看红绿灯区域）。有问题回到 Task 18 / 19 改样式，改完重跑。

- [ ] **Step 3: 文档**

1. **总设计 8.2 节**：把本计划开头「设计决定」表的结论写进去（链接格式、一个共享一个会话、设备确认、撤销和到期、模板按共享勾选、分块和续传、中转服务的配额和内存上限、电脑端的内存预算、按打印机排队、记录、协议 3），并写明「和 6a 共用 `DocumentJobService`」。
2. **手机扫码设计**：第 4.5 节加「远程打印页（`/ws/remote`）」的限速、配额、积压上限；第 5 节版本号改为 3，`open` 帧加 `kind`，关闭原因加 `revoked` / `expired`，错误码加 `busy` / `quota`，路径表加 `/ws/remote`，并指向 `remote-protocol.ts` 和总设计 8.2。
3. **`relay/README.md`**：「它做什么」加远程打印页（`/r/`）和 `/ws/remote`；目录表加 `web/remote/`、`web/src/remote/`；配额和内存上限一段；本机运行加「在电脑上新建远程共享，用浏览器打开链接」。
4. **`relay/CLAUDE.md`**：加「远程打印页的结构」（`remote-state`、`remote-text`、`file-check`、`remote-controller`、`remote-client`、`remote-store`、`remote-view`、`main`）；「中转服务只转发」后补「转发前看积压，宁可丢帧回 busy 也不攒数据」；测试一节加 `remote-page.browser.ts`；「协议只有一份」加 `remote-protocol.ts` 和 `remote-chunks.ts`，改协议时同时改 `src/main/remote/` 和 `web/src/remote/remote-client.ts`。
5. **`src/main/CLAUDE.md`**：加「远程打印（`remote/`）」一节（分层：`remote-session` 纯规则、`remote-queue` 纯逻辑、`remote-host` 编排、`remote-station` 接线、`device-registry` 令牌只存摘要；密钥用 `safeStorage`；记录的 `caller` 格式；按打印机排队；不播报）；「文档打印（`documents/`）」一节（和 6a 共用、自己的渲染页、图片在渲染页里解码）；本机接口一节旁边的「静默更新」条件补上远程任务。
6. **`src/renderer/CLAUDE.md`**：加「共享页和询问条」（状态来自主进程；询问条按钮不进 Tab 顺序；复制链接经主进程；结果用语来自 `src/shared/remote-result-text.ts`）。
7. **根 `CLAUDE.md`**：平台表加「异地远程打印」一行（两个平台都支持；渲染页在两个平台都可用）；命令表 `test:relay-browser` 的说明改成「用 Edge 跑一遍扫码页和远程打印页」；架构一节 `relay` 那行补「和远程打印页」；文档表补设计文档名。
8. **`README.md`**：功能列表加「异地远程打印」：怎么开、对方怎么用、安全说明（端到端加密、链接私有、可撤销、新设备确认）。
9. **`docs/roadmap.md`**：子项目 6b 标为完成；未做的写进去（例如模板的预览图、页面上取消排队中的任务）。
10. **`docs/windows-acceptance.md`**：加「异地远程打印」的真机验收表（见 Task 23 Step 3），先留空待填。

- [ ] **Step 4: `bun run check` 后提交**

```bash
git add e2e/visual/acceptance.visual.ts docs README.md CLAUDE.md relay/README.md relay/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs(remote): visual acceptance V94-V97 and remote printing documentation" -m "Adds the sharing page, the share form, the new device prompt and the remote page to visual acceptance, and records the design decisions, protocol 3, relay quotas and buffering limits, and the new main process modules in the design documents and the CLAUDE.md files." -m "$TRAILER"
```

---

### Task 23: 部署中转服务，真机验收

中转服务每次改了代码都要重新部署（用户已同意，不用再问）。协议 3 一上线，1.3.0 及更早的电脑、没刷新的老扫码页都会收到 `version` 错误、提示更新——这是总设计第 1 节「不兼容旧版本」的预期；**部署前确认一次：如果这时已经有在用 1.3.0 的外部用户，先问用户要不要等 2.0.0 发布时再部署。**

**Files:** 无（部署和验收）

- [ ] **Step 1: 合并后部署**

PR 合进 master、CI 两个平台都过之后，在 master 的干净工作区（`relay:deploy` 拒绝 `.dirty` 版本）：

```bash
cd /d/project/LabelFlash && git switch master && git pull
# 三个环境变量按 relay/README.md 设好（服务器信息不进仓库）：RELAY_DEPLOY_SSH、RELAY_PUBLIC_ORIGIN、RELAY_HEALTH_URL
bun run relay:deploy
```

Expected: 脚本依次构建（两个页面）、上传、`docker build`、换容器、本机和对外健康检查都通过，输出 `relay <版本> is live at …`；失败时它自己换回上一个版本，按输出查原因。

- [ ] **Step 2: 线上冒烟**

1. 浏览器打开 `<中转地址>r/`：显示「链接不完整」，开发者工具里响应头是远程页的 CSP（`script-src 'self'`、`worker-src 'none'`、`camera=()`），Console 没有报错。
2. 打开 `<中转地址>m/`：扫码页照常。
3. 开发版程序（`bun run dev`，设置里用官方中转地址）新建一个共享，手机和另一台电脑各打开一次链接，传一个 PDF、填一次模板。

- [ ] **Step 3: 真机验收（记进 `docs/windows-acceptance.md`）**

| 项 | 做法 | 预期 |
|---|---|---|
| 真打印机出纸 | 热敏标签机装 100×150 面单纸，异地（手机 4G）上传四联面单 PDF，「一页多张」 | 4 张逐张出纸，裁切正确；打印记录来源「远程」，写着共享名和对方名字 |
| 大文件 | 15MB 左右的多页 PDF、手机拍的 4800 万像素照片 | 上传进度走到 100%，打印正常；照片按抖动转黑白 |
| 弱网 | 上传中把手机切到飞行模式 10 秒再切回 | 页面显示重新连接，接着从断点传，不重新开始，不重复打印 |
| 电脑重启 | 任务排队时退出程序再打开 | 页面显示「电脑现在不在线」，回来后排队中的任务显示「电脑重启过，不知道打没打」，没有被重打 |
| 新设备确认 | 共享开着「新设备要我确认」，换一台手机打开 | 电脑顶部询问条和系统通知；拒绝后对方看到「没有同意」 |
| 撤销 | 对方页面开着时撤销 | 对方立即看到「已撤销」；再打开链接显示「电脑现在不在线，或者链接已失效」 |
| 浏览器 | iPhone Safari、iPhone 微信、安卓 Chrome、安卓微信、Windows Edge、macOS Safari | 都能选文件上传、填模板、看到结果 |
| macOS | 在 Mac 上跑同样的「真打印机出纸」「撤销」两项 | 同上（CUPS 任务的纸张是 100×150） |

---

## 远程打印验收（待做）

- [ ] 单元测试、`bun run check`、`bun run test:e2e`、`bun run test:relay-browser` 全过（Windows、macOS 的 CI 都过）。
- [ ] 视觉验收 V94–V97 逐张核对（Windows 100% / 150%，macOS）。
- [ ] 中转服务已部署（Task 23 Step 1、2）。
- [ ] Task 23 Step 3 的真机验收表填完。
- [ ] 回归：手机扫码（协议 3）照常扫码、补打、货架号识别；PDF 打印页和远程打印同时用时互不打断；本机接口、批量打印不受影响；从 1.3.0 的数据库升级（迁移 N）后打印记录、模板都在。

## Self-Review 记录

**对照总设计 8.2 和任务要求逐项检查：**

| 要求 | 落在哪里 |
|---|---|
| 「共享」页生成链接、私有、可设有效期、随时撤销 | Task 9（有效期）、10（存储）、15（创建、撤销、到期）、18（页面） |
| 复用手机扫码的会话、加密、背压、排队 | Task 2（协议 3 共用）、11（nonce/seq、任务号、refused）、14（RemoteHost 与 MobileHost 同构） |
| 对方用任何浏览器：上传 PDF / 图片，或选共享的模板填字段；选纸张、份数；看排队和结果 | Task 13（协议客户端）、19（页面）、20（Edge 测试） |
| 多人同时、按打印机排队 | Task 5（中转服务按连接号多路复用、每会话两倍上限）、11（每台设备的未完成上限）、12（每台打印机一条队）、15（跨共享执行） |
| 分块 256KB、单个 ≤ 20MB、协议版本加 1、旧客户端「请更新」 | Task 2、3、4；5 的 `tells a protocol 2 desktop to update` |
| 记录：来源「远程」、对方设备名、结果回给页面 | Task 8（PdfRef 记录）、9（规则名）、15（caller）、17（记录里显示对方） |
| 链接怎么带密钥 | 设计决定第一行；Task 3 `share link` 测试证明会话号和密钥不在路径和查询串里 |
| 多个远程页面怎么复用电脑的连接 | 设计决定第三行；Task 5、14 |
| 中转服务的限速、配额（每个共享、每个 IP） | Task 5（`HubQuotas`，三种桶都有测试） |
| 中转服务转发分块的内存上限 | Task 5（单连接、全局积压上限，`busy`；`backpressureLimit` 兜底） |
| 撤销的语义 | 设计决定；Task 15 `revokes a share`、Task 21 第四条 |
| 哪些模板共享出去 | 每个共享单独勾选，默认不共享（Task 9、15、18） |
| 电脑上的字段校验 | Task 3（协议层）、9（`prepareRemoteFields`）、15（执行前再查模板仍被共享） |
| 电脑端界面：共享列表、撤销、最近的远程任务、询问 / 通知 | Task 17、18；通知在 Task 16 |
| 部署 | Task 23 |
| 测试：协议、中转服务、主进程、浏览器、E2E、视觉 | Task 2–5、10–15、20、21、22 |

**刻意没做的（写进路线图）：** 模板的预览图（页面上只列字段；要在页面上画预览得把标签 HTML 交给页面，CSP 和不可信的 HTML 都是麻烦）；页面上取消已排队的任务；PDF 的手动框选；跨中转地址自动迁移链接。

**和其他计划的接口：**

- 迁移只新建两张表，不动 jobs（来源 `remote` 在迁移 6）。编号实施时取下一个空号。
- 和 6a 的计划（`2026-10-02-ipp-sharing.md`）对过：`open-image` / `openImage(data, type)` / `RENDER_IMAGE_TYPES`、`RequestBar`、`SharingPage`、`fieldsRuleFor` 的 `ipp` 都用 6a 的，本计划的对应步骤在 6a 合进来后跳过或只做增量（Task 1 Step 2 第 5 条逐项核对）。
- 6a 没有抽通用的文档通道（它有自己的 `IppJobProcessor`），所以 `src/main/documents/DocumentJobService` 是本计划新建的；本计划不改 `IppJobProcessor`。两者有一段相同的「渲染 → 切块 → 存缓存 → 逐张 printFields」，以后要不要让 IPP 也改走 `DocumentJobService`，由协调者决定（改的话是 6a 之后的一个小重构，IPP 的光栅和份数顺序留在它自己那边）。
- 6a 没有把 `readImagePixelSize` 挪到 `src/shared/`：本计划 Task 7 Step 1–2 做这一步（主进程要在解码之前挡住大图）。
- `fieldsRuleFor` 按来源判断，`remote` 最先（远程传来的 PDF 记作「远程打印」），然后才是 6a 的 `ipp`。

**占位符和一致性检查：** 全文没有「TBD」「以后再说」；类型名在任务之间一致（`RemoteSession` / `RemoteHost` / `RemoteStation` / `RemoteQueue` / `RemoteClient`、`AcceptedJob`、`Delivery`、`DesktopToViewer`、`ViewerMessage`、`RemoteResult`、`DocumentOutcome`）；`RemoteHostDeps` 的 `keys` 字段在 Task 14、15、20 用法一致；`describeRemoteResult` 只有一个参数，页面和电脑共用。

**要实施时留意的几处：**

- Task 5「caps what all connections together」依赖 hub 只在转发后记住有积压的连接；如果实施时改成在 `drain` 之外也主动扫描，测试要跟着改准备步骤，断言不变。
- Task 8 的 `pngHeader` 按 `readImagePixelSize` 读 IHDR 的位置写；挪到 `src/shared/` 后先跑一次它自己的测试再写这条。
- Task 15 的 `laneOf` 用纸张分配里的打印机名做队的键：两种纸分到同一台打印机就排同一条队，这是想要的；模板指定的打印机不在系统里时结果是 `PRINTER_NOT_FOUND`，和本机打印一致。
- Task 19 的页面结构（元素 id、标签文字）和 Task 20、21、22 的定位方式要一致：「你的名字（电脑上显示）」「纸张」「份数」「选择文件」「模板」「打印」。

