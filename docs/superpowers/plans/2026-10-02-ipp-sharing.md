# 局域网共享（IPP，子项目 6a）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置里打开「局域网共享」后，这台电脑起一个 IPP/2.0 打印服务（默认端口 8631，被占用时自动换，和本机接口一样）：每种已分配打印机的纸张是一台共享打印机（`/printers/60x40`，中文名「60×40 标签」），经 mDNS / DNS-SD 广播 `_ipp._tcp`（含 AirPrint 的 `_universal` 子类型）。局域网里的 Windows 电脑用系统自带的「Microsoft IPP Class Driver」按地址添加或自动发现，macOS 在「打印机与扫描仪」里自动发现（AirPrint），不装驱动就能把 PDF、图片、Word 等打到这台电脑的热敏标签机上。收到的任务走 PDF 打印的那套流程（整页 / 去白边，缩放到这张纸、转黑白），按纸张找打印机，每张一条打印记录（来源「局域网共享」，记下对方电脑的地址和用户名，7 天内能预览、重打）。只接受局域网的连接；可选「共享密码」（HTTP 基本认证）；一台新电脑第一次打印时，程序顶部询问「允许 / 拒绝」（和本机接口的网站询问条同一个样式），决定会被记住。

**Architecture:** IPP 的二进制编解码、请求校验、共享打印机的属性集、任务表、操作分派、PWG Raster / Apple Raster 解码、DNS 报文和 mDNS 应答都是 `src/core/` 里的纯 TypeScript（`core/ipp/`、`core/mdns/`），用 RFC 8010 附录 A 的报文和合成的光栅、DNS 报文做单元测试。主进程 `src/main/ipp/` 只做接线：`IppHttpServer`（`node:http`，复用从本机接口抽出来的端口回退和自检 `net/http-listener.ts`；连接一建立就按地址过滤；先认证再读正文；大小、速率、超时都有上限）、`ClientApprovals`（新电脑询问，决定存进 SQLite）、`SharePassword`（scrypt 摘要）、`IppJobProcessor`（PDF 和 JPEG / PNG 交给 PDF 打印那个 sandbox 渲染页——IPP 有自己的一个渲染窗口；光栅在主进程里用 core 的纯 TS 解码；之后复用 `core/pdf` 的裁切、放到纸上、`pieceTemplate`，经 `PrintService.printFields` 打印，来源 `ipp`）、`MdnsAdvertiser`（`node:dgram` 绑 UDP 5353）、`IppSharing`（跟随设置启停、拼共享打印机、防火墙、状态推送）。全部不 import electron，用 `bun test` 测试，HTTP 服务和组装都用真的 HTTP 客户端发 IPP 请求测。打印记录追加一条迁移：`ipp_client`、`ipp_user` 两列，和 `ipp_clients`（记住的允许 / 拒绝）、`ipp_share_password`（密码摘要）两张表；来源 `ipp` 在迁移 6 里已经加好。

**Tech Stack:** TypeScript、Bun test、`node:http`、`node:dgram`、`node:crypto`（scrypt）、Electron 主进程（只在 `index.ts` 接线）、PDF 打印的 sandbox 渲染页（`createImageBitmap` 解 JPEG / PNG）、React 19、Playwright E2E。**不新增依赖。**

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 2、8.1、9、10、11 节；复用的 PDF 流程见 `docs/superpowers/plans/2026-10-02-pdf-printing.md`。

## 关键决定（写计划时定的，实施前请协调者确认第 1、2、6 条）

1. **mDNS 不引入 `bonjour-service`，自己写最小的应答器。**
   - `bonjour-service` 1.4.x 本身合格：MIT，约 74KB，依赖 `multicast-dns` 7.2.5（→ `dns-packet`、`thunky`），全是纯 JS，能打进自包含的主进程 bundle、过 `verify:bundle`。不用它是因为行为：它把 `os.networkInterfaces()` 里所有非内部地址都写进 A / AAAA 记录（Hyper-V、WSL、VMware、VPN 的虚拟网卡全在内），没法过滤，Windows 客户端解析到虚拟网卡的地址就连不上；`multicast-dns` 只从默认网卡发组播，多网卡电脑上宣告可能走错网卡；`multicast-dns` 最后一次发布在 2022 年；我们用不到的浏览（browse）功能也一起进来。
   - 我们只要应答器的一小部分：回答 `_services._dns-sd._udp`、`_ipp._tcp` 和两个子类型的 PTR，实例的 SRV / TXT，自己主机名的 A；启动时探测、宣告，停止时告别（TTL 0），听到别人用了同一个名字就改名。核心是 DNS 报文的编码和解码（含名字压缩）约 400 行纯 TS，放 `core/mdns/`，用合成的报文测；网卡用本机接口现成的 `lanIPv4Addresses` 过滤规则（去掉虚拟网卡），每块网卡用自己的地址回答，按对方所在的子网选网卡。
   - 不经系统的响应器：Windows 的 `DnsServiceRegister` 要原生调用（带回调指针），PowerShell 里做不干净；macOS 的 `dns-sd -R` 可以，但两个平台会成两套代码。我们自己绑 UDP 5353（`reuseAddr`，和系统的响应器共用这个端口；libuv 在 macOS 上用 SO_REUSEPORT）。代价是 Windows 防火墙要多放行 UDP 5353（Task 18），而这条规则没加上时共享照常可用，只是不能自动发现。
   - 设计文档第 2 节依赖表里 `bonjour-service` 一行改成「不引入」并写原因（Task 25）。
2. **免驱添加要的最小属性集和文档格式。**
   - Windows 10 21H2 起和 Windows 11 的「Microsoft IPP Class Driver」按 IPP Everywhere（PWG 5100.14）认打印机，把文档转成打印机列出的格式再发：公开资料和社区实测里它主要发 PWG Raster（`image/pwg-raster`），PDF 不是每个版本都直接发；要启用新的 PWG Raster 驱动路径，打印机得给出 `ipp-features-supported = ipp-everywhere`、`pwg-raster-document-resolution-supported`、`pwg-raster-document-type-supported`、`pwg-raster-document-sheet-back`、`media-col-*`、`print-color-mode-supported` 等。所以**必须收 PWG Raster**。
   - macOS / iOS（AirPrint）：Bonjour 里要有 `_universal._sub._ipp._tcp` 子类型，TXT 里有 `URF=`、`pdl` 含 `image/urf`，系统才把它当成免驱的 AirPrint 打印机（macOS「使用：AirPrint」；iOS 只认这种）。所以**也收 Apple Raster（`image/urf`）**，`urf-supported = V1.4,CP1,W8,SRGB24,RS<dpi>`。macOS 的 CUPS 2.3+ 在打印机支持 PDF 时也会直接发 PDF。
   - 两种光栅都是简单的行程编码，解码器纯 TS 放 core（内存安全：只占「不可信输入」「高权限进程」两样，Rule of 2 允许）；JPEG / PNG 要 Chromium 的 C++ 解码器，放进 PDF 打印的 sandbox 渲染页里解（Task 15）。
   - 属性逐条列在 Task 4：RFC 8011 §5.4 要求的全部 + PWG 5100.12（IPP/2.0）的 `printer-current-time` 等 + PWG 5100.14 的 IPP Everywhere 一组 + PWG 5100.7 的 `media-col`。纸张只有一种（这台共享打印机就是这种纸），四边边距 0，`media` 用 PWG 5101.1 的自描述名 `om_label-60x40_60x40mm`。
   - 不做 Identify-Printer、Create-Job / Send-Document、IPPS（TLS）。真机验证（Task 25 的清单）发现客户端非要不可时再补。
3. **网址用纸张键**：`/printers/<纸张键>`，就是纸张分配表的键（`60x40`、`76.5x130`：只有数字、点和 x，本来就 URL 安全、稳定、唯一）。中文名放在 `printer-name`（「60×40 标签」）、`printer-info`、DNS-SD 实例名（「60×40 标签 @ 前台」）里。
4. **端口**：默认 8631（macOS 的 631 是 CUPS 的），依次试 指定的（`ippPort`）→ 上次成功的（`ippLastPort`）→ 8631–8640 → 系统分配。端口回退、回环自检、重启时等请求收尾的逻辑从本机接口的 `ApiHttpServer` 抽成 `main/net/http-listener.ts` 共用（Task 12，行为不变，本机接口原有的测试把关）。只监听 IPv4（`0.0.0.0`）：mDNS 只广播 A 记录，Windows 按地址添加也用 IPv4。
5. **只对局域网**：在 `connection` 事件里看对方地址，不是私有网段（RFC 1918）、链路本地（169.254/16）或本机回环就直接断开，一个字节都不读。防火墙规则沿用本机接口那一条（它按程序放行 TCP 的所有端口，8631 天然覆盖），另加 UDP 5353。
6. **共享密码存摘要，不存密文**（和设计文档写的 safeStorage 不同）：校验 HTTP 基本认证只需要比对，不需要取回原文；按最小权限存 scrypt（N = 2^14，随机盐）摘要，和本机接口的程序密钥只存 SHA-256 摘要是一个思路。原文只在设置时经过一次 IPC，不进日志、不回传界面；忘了就重设。也不放进现有的「密钥」表：那张表的名字界面会列出来、HTTP 查询步骤能用 `{密钥:名称}` 引用，共享密码不能被别的功能读到。明文 HTTP 上的基本认证在局域网里能被抓包看到，界面和文档照实说明：它挡住随手添加，不防抓包。
7. **新电脑第一次打印**：Print-Job 立即回 `successful-ok`，任务停在 `pending-held`（原因 `job-held-for-authorization`），电脑上顶部询问「允许 / 拒绝」（本机接口的询问条抽成通用组件）并发系统通知；允许后开始处理，拒绝或 2 分钟没人点就中止（`aborted`，带中文原因）。不让 HTTP 请求挂着等：Windows 的后台打印服务和 CUPS 都有请求超时，挂两分钟会被当成打印机坏了。决定按对方的 IPv4 地址记住（表 `ipp_clients`），在「局域网共享」页可以撤销。同时等确认的电脑最多 3 台。
8. **处理任务**：IPP 专用一个 `PdfRenderHost`（自己的隐藏渲染窗口，和操作员的「打印 PDF」页互不干扰），任务逐个处理。页面和纸差不多大（±3mm，正着或转 90°）就整页缩放（客户端已经按这张纸排好了），否则（A4 上的一张面单、截图、照片）去白边再缩放；照片（JPEG）用抖动，其余用阈值 128。每张一条打印记录，带 PDF 那套「文件、页、第几张、位图编号」（预览、重打 7 天）和新的「电脑地址、用户名」。多份按整份文档依次打（1、2、1、2）。
9. **默认关闭**（第 11.2 节最小权限）：设置里打开才监听、才广播。

## 上限（每条的取值依据写在代码的常量注释里）

| 项 | 值 | 位置 |
|---|---|---|
| IPP 属性部分 | 64KB、500 个属性、每个属性 100 个值、集合 4 层 | `core/ipp/ipp-codec.ts` |
| 一个请求 | 文档 50MB（= PDF 打印的上限）+ 64KB；没带对密码时 64KB | `main/ipp/ipp-http-server.ts` |
| 请求时长 | 2 分钟（含上传） | 同上 |
| 同时的连接 | 64 | 同上 |
| 速率 | 每个地址每秒 20 个请求、突发 40；密码错 5 次之后每错一次锁 10 秒 | 同上 |
| 同时收下的任务 | 4 个（含等确认的），每台电脑 2 个 | `core/ipp/ipp-job-book.ts` |
| 结束的任务留给查询 | 100 个、1 小时 | 同上 |
| 光栅 | 边长 8192 点、每页 1600 万像素、200 页 | `core/ipp/raster.ts` |
| 等操作员确认 | 2 分钟，最多 3 台电脑同时等 | `main/ipp/client-approvals.ts` |
| 记住的电脑 | 200 台 | 同上 |
| 渲染 | 沿用 PDF 打印：打开 20 秒、每页 30 秒 | `main/index.ts` |
| DNS 报文 | 每部分 64 条，名字压缩最多跳 16 次、只许往前指 | `core/mdns/dns-message.ts` |

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言；`for...of` 代替 `forEach`。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **分支**：子项目顺序是 1 → 3 批量 → 2 模板库 → 4 PDF → 5a / 5b / 5c 打印机管理 → 6a 本计划。5c 合进 master 之后，从 master 拉 `feature/ipp-sharing`。本计划用到 PDF 打印留下的：`PdfRenderHost`、`PdfRenderError`、`PDF_ISSUES`、`OpenedPdf`、`RenderedPage`（`main/pdf/pdf-render-host.ts`）、`openRenderWindow`（`main/pdf/pdf-render-window.ts`）、`PieceStore`（`main/pdf/pdf-station.ts`）、`PieceCache`、`core/pdf/` 的 `inkMask`、`cropRects`、`splitOptionsFor`、`paperDots`、`renderPiece`、`pieceTemplate`、`pieceContent`、`pieceFields`、`PDF_PIECE_TEMPLATE_ID`、`PDF_LIMITS`、`MAX_MONO_SIDE`、测试用的 `blankPage` / `fill`，`core/types.ts` 的 `PdfRef`，`core/print-service.ts` 的 `fieldsRuleFor`、`PDF_RULE`、`FieldsPrint.pdf`，`shared/pdf-render-protocol.ts`，`e2e/support/pdf-files.ts`。
- **迁移**：协调决定迁移 6 一次加上 `batch`、`pdf`、`ipp`、`remote` 四个来源，PDF 打印加了迁移 7，打印机管理可能再加。本计划追加**下一个空着的序号**（Task 1 核对，下文叫「迁移 N」）；只追加，不重建 jobs 表。测试里用 `MIGRATIONS.slice(0, -1)` 表示「本条之前的全部」，不写死序号。
- **视觉验收编号**：局域网共享固定用 **V90–V93**，追加在 `ITEMS` 当时最后一项之后。
- **用词**：界面上「已发送」，不说「打印成功」；打印机只写「热敏标签机」；不出现参考产品的名字；代码和测试里不写域名（mDNS 的 `.local` 是协议的一部分，不算域名）。
- **两个平台**：Windows、macOS 的行为每处都写明；macOS 的打印机状态是「未知」（不阻止打印），共享照常。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/core/ipp/ipp-constants.ts` | 新建 | 组标记、值类型、操作、状态码、打印机和任务状态的编号 |
| `src/core/ipp/ipp-codec.ts` | 新建 | IPP 报文 ↔ 字节（RFC 8010），带上限 |
| `src/core/ipp/ipp-attributes.ts` | 新建 | 建属性、读属性的小工具；dateTime 编码 |
| `src/core/ipp/shared-printer.ts` | 新建 | `SharedPrinter`、打印机状态 → IPP 状态、纸张的 PWG 名字 |
| `src/core/ipp/printer-attributes.ts` | 新建 | 共享打印机的完整属性集、按 requested-attributes 挑选 |
| `src/core/ipp/document-format.ts` | 新建 | 支持的格式、按文件头识别 |
| `src/core/ipp/raster.ts` | 新建 | PWG Raster、Apple Raster（URF）→ 灰度页 |
| `src/core/ipp/ipp-job-book.ts` | 新建 | 任务表：建、等确认、开始、进度、结束、取消、查询；任务属性 |
| `src/core/ipp/ipp-operations.ts` | 新建 | 六个操作的校验和回复，收下的文档 |
| `src/core/ipp/ipp-print.ts` | 新建 | 整页还是去白边、记录的字段 |
| `src/core/ipp/ipp-advert.ts` | 新建 | 共享打印机 → DNS-SD 服务（实例名、子类型、TXT） |
| `src/core/ipp/testing/ipp-requests.ts`、`testing/raster-fixtures.ts` | 新建 | 测试用的请求、样例打印机、光栅编码器 |
| `src/core/mdns/dns-message.ts` | 新建 | DNS 报文编解码（名字压缩、A / PTR / SRV / TXT） |
| `src/core/mdns/dns-sd.ts` | 新建 | 服务、区域、记录、TXT、实例名 |
| `src/core/mdns/mdns-responder.ts` | 新建 | 回答查询、宣告、告别、探测、名字冲突 |
| `src/core/types.ts`、`src/core/print-service.ts` | 修改 | `IppRef`；`IPP_RULE`；`FieldsPrint.ipp` |
| `src/main/storage/migrations.ts`、`sqlite-job-store.ts`、`sqlite-ipp-store.ts` | 修改 / 新建 | 迁移 N；两列读写；记住的电脑和密码摘要 |
| `src/main/net/http-listener.ts` | 新建 | 从 `api/http-server.ts` 抽出的端口回退、回环自检、收尾 |
| `src/main/api/http-server.ts`、`api/local-api.ts`、`api/network.ts` | 修改 | 改用 `HttpListener`、`portOrder`；局域网地址、网卡和子网 |
| `src/shared/ipp-sharing.ts` | 新建 | 共享密码规则、IPC 用的状态类型 |
| `src/main/ipp/share-password.ts` | 新建 | scrypt 摘要、基本认证解析 |
| `src/main/ipp/client-approvals.ts` | 新建 | 新电脑等确认、记住决定 |
| `src/main/ipp/ipp-pages.ts` | 新建 | 浏览器打开打印机网址时的说明页 |
| `src/main/ipp/ipp-http-server.ts` | 新建 | IPP over HTTP |
| `src/main/ipp/ipp-job-processor.ts` | 新建 | 收到的任务 → 黑白位图 → `printFields` |
| `src/main/ipp/mdns-advertiser.ts` | 新建 | UDP 5353 的收发 |
| `src/main/ipp/ipp-sharing.ts` | 新建 | 组装、跟随设置、状态 |
| `src/main/ipp/testing/ipp-client.ts`、`testing/fakes.ts` | 新建 | 测试和 E2E 用的 IPP 客户端；假渲染页、内存缓存 |
| `src/shared/pdf-render-protocol.ts`、`src/main/pdf/pdf-render-host.ts`、`src/renderer/src/pdf-render/main.ts` | 修改 | 渲染页也解 JPEG / PNG |
| `src/shared/firewall-rule.ts`、`src/main/firewall.ts` | 修改 | 放行 UDP 5353、查询这条规则 |
| `src/shared/settings.ts` | 修改 | `ippSharingEnabled`、`ippPort`、`ippLastPort`、`ippInstanceId` |
| `src/shared/ipc-contract.ts`、`src/main/ipc-validators.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts` | 修改 | 通道、校验、接线 |
| `src/renderer/src/lib/ipp-sharing-text.ts`、`lib/app-view.ts`、`lib/status-text.ts` | 新建 / 修改 | 页面文字；新页面；记录里的电脑和用户 |
| `src/renderer/src/view-models/use-ipp-sharing.ts` | 新建 | 状态、密码、允许 / 拒绝、防火墙 |
| `src/renderer/src/components/RequestBar.tsx`、`OriginRequests.tsx`、`IppClientRequests.tsx`、`config/pages/SharingPage.tsx`、`config/ConfigPages.tsx`、`App.tsx`、`styles/app.css` | 新建 / 修改 | 通用询问条、共享页 |
| `e2e/support/electron-app.ts`、`e2e/support/pdf-files.ts`、`e2e/ipp.e2e.ts` | 修改 / 新建 | 端口和发现的环境变量、60×40 的 PDF、E2E |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | V90–V93 |
| `docs/lan-sharing.md`、`README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`、设计文档、`CLAUDE.md`、`src/*/CLAUDE.md`、`resources/installer/CLAUDE.md` | 新建 / 修改 | 文档和真机验证清单 |

---

### Task 1: 核对前提，拉分支

**Files:** 无改动。

- [ ] **Step 1: 拉分支**

Run（Git Bash）:

```bash
cd /d/project/LabelFlash && git switch master && git pull && git switch -c feature/ipp-sharing
```

- [ ] **Step 2: 核对前面子项目留下的东西**（用 Grep / Glob，不用 shell 搜）

1. `src/main/storage/migrations.ts` 里第 6 条迁移的 `source` CHECK 含 `'ipp'`；`src/core/types.ts` 的 `PRINT_SOURCES` 含 `'ipp'`；`src/renderer/src/lib/status-text.ts` 的 `SOURCE_LABELS` 有没有 `ipp` 一项（没有就在 Task 8 加 `ipp: '局域网共享',`）。
2. PDF 打印：「约定」里列的导出都在；`src/main/pdf/pdf-render-host.ts` 的 `open` 发 `{ kind: 'open', data }`；`src/renderer/src/pdf-render/main.ts` 里有 `handle`、`open`、`render`、`failure` 四个函数（Task 15 改它们）。
3. 记下 `MIGRATIONS` 现在有几条（K 条）：本计划的迁移是第 K + 1 条，下文叫「迁移 N」。
4. `src/shared/firewall-rule.ts` 的 `MUTATE_BODY` 仍只有一行 `New-NetFirewallRule ... -Protocol TCP ...`（打印机管理改过的话，Task 18 按改后的样子加 UDP 那一行）。
5. `src/shared/ipc-contract.ts` 有 `listJobs(query: JobQuery): Promise<JobPage>`；`src/main/storage/database.ts` 导出 `openDatabase`、`migrate`；`row-readers.ts` 导出 `readString`、`readInteger`、`readEnum`。

Expected: 全部都在。第 1 条缺 `'ipp'` 时**停下来**问协调者（不要再写一条重建 jobs 表的迁移）；第 2 条的函数名不同就按实际的名字改 Task 15、16。

- [ ] **Step 3: 基线**

Run: `bun run check`
Expected: 通过。不通过先问协调者，不在本分支上修别人的问题。

---

### Task 2: IPP 报文的编解码

IPP 请求来自局域网里的任何电脑，是不可信的输入。编解码自己写（格式简单，见 RFC 8010 §3）：每一处长度都核对，属性部分的总字节数、属性数、每个属性的值数、集合层数都有上限，不对就抛 `IppDecodeError`，由 HTTP 层回「请求有误」。用 RFC 8010 附录 A.1（Print-Job 请求）和 A.2（Print-Job 回复）的报文逐字节测。

**Files:**
- Create: `src/core/ipp/ipp-constants.ts`
- Create: `src/core/ipp/ipp-codec.ts`、`src/core/ipp/ipp-codec.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/ipp/ipp-codec.test.ts
import { describe, expect, test } from 'bun:test';
import { decodeIppMessage, encodeIppMessage, IppDecodeError, type IppMessage } from './ipp-codec';
import { GROUP_TAGS, VALUE_TAGS } from './ipp-constants';

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [...u16(Math.floor(value / 0x10000)), ...u16(value & 0xffff)];
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/** 一个属性（RFC 8010 §3.1.4）：值标记、名字长度、名字、值长度、值。名字为空就是上一个属性的又一个值。 */
function attribute(tag: number, name: string, value: readonly number[]): number[] {
  const nameBytes = ascii(name);
  return [tag, ...u16(nameBytes.length), ...nameBytes, ...u16(value.length), ...value];
}

/** 集合里的成员名（RFC 8010 §3.1.6）：memberAttrName，名字长度 0，值是成员名。 */
const member = (name: string): number[] => attribute(VALUE_TAGS.memberAttrName, '', ascii(name));
const END_COLLECTION = [VALUE_TAGS.endCollection, ...u16(0), ...u16(0)];

/** RFC 8010 附录 A.1：Print-Job 请求，后面跟着文档。 */
const PRINT_JOB_REQUEST = Uint8Array.from([
  0x01, 0x01, // version-number 1.1
  ...u16(0x0002), // operation-id Print-Job
  ...u32(1), // request-id
  0x01, // operation-attributes-tag
  ...attribute(0x47, 'attributes-charset', ascii('utf-8')),
  ...attribute(0x48, 'attributes-natural-language', ascii('en-us')),
  ...attribute(0x45, 'printer-uri', ascii('ipp://printer.example.com/ipp/print/pinetree')),
  ...attribute(0x42, 'job-name', ascii('foobar')),
  ...attribute(0x22, 'ipp-attribute-fidelity', [0x01]),
  0x02, // job-attributes-tag
  ...attribute(0x21, 'copies', u32(20)),
  ...attribute(0x44, 'sides', ascii('two-sided-long-edge')),
  0x03, // end-of-attributes-tag
  ...ascii('%!PS...'),
]);

/** RFC 8010 附录 A.2：Print-Job 成功的回复。 */
const PRINT_JOB_RESPONSE = Uint8Array.from([
  0x01, 0x01,
  ...u16(0x0000), // successful-ok
  ...u32(1),
  0x01,
  ...attribute(0x47, 'attributes-charset', ascii('utf-8')),
  ...attribute(0x48, 'attributes-natural-language', ascii('en-us')),
  ...attribute(0x41, 'status-message', ascii('successful-ok')),
  0x02,
  ...attribute(0x21, 'job-id', u32(147)),
  ...attribute(0x45, 'job-uri', ascii('ipp://printer.example.com/ipp/print/pinetree/147')),
  ...attribute(0x23, 'job-state', u32(3)),
  0x03,
]);

/** 只有操作属性组的请求：版本 2.0、Get-Printer-Attributes。 */
function request(...attributes: number[][]): Uint8Array {
  return Uint8Array.from([0x02, 0x00, ...u16(0x000b), ...u32(7), 0x01, ...attributes.flat(), 0x03]);
}

describe('decodeIppMessage', () => {
  // 测试里的小工具按 RFC 8010 的布局拼字节：先和规范里的前几个字节逐个对上。
  test('lays out bytes exactly as the RFC example', () => {
    expect(PRINT_JOB_REQUEST.slice(0, 12)).toEqual(
      Uint8Array.of(0x01, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x01, 0x47, 0x00, 0x12),
    );
  });

  test('decodes the Print-Job request of RFC 8010 A.1', () => {
    const { message, dataOffset } = decodeIppMessage(PRINT_JOB_REQUEST);
    expect(message.version).toEqual({ major: 1, minor: 1 });
    expect(message.code).toBe(0x0002);
    expect(message.requestId).toBe(1);
    expect(message.groups.map((group) => group.tag)).toEqual([GROUP_TAGS.operation, GROUP_TAGS.job]);
    expect(message.groups[0]?.attributes.map((item) => item.name)).toEqual([
      'attributes-charset',
      'attributes-natural-language',
      'printer-uri',
      'job-name',
      'ipp-attribute-fidelity',
    ]);
    expect(message.groups[0]?.attributes[4]?.values).toEqual([{ kind: 'boolean', value: true }]);
    expect(message.groups[1]?.attributes).toEqual([
      { name: 'copies', values: [{ kind: 'integer', value: 20 }] },
      { name: 'sides', values: [{ kind: 'string', tag: VALUE_TAGS.keyword, value: 'two-sided-long-edge' }] },
    ]);
    expect(new TextDecoder().decode(PRINT_JOB_REQUEST.subarray(dataOffset))).toBe('%!PS...');
  });

  test('encodes decoded attributes back to the same bytes', () => {
    const { message, dataOffset } = decodeIppMessage(PRINT_JOB_REQUEST);
    expect(encodeIppMessage(message)).toEqual(PRINT_JOB_REQUEST.subarray(0, dataOffset));
  });

  test('reads additional values as one attribute with several values', () => {
    const bytes = request(
      attribute(0x47, 'attributes-charset', ascii('utf-8')),
      attribute(0x44, 'requested-attributes', ascii('printer-name')),
      attribute(0x44, '', ascii('printer-state')),
    );
    expect(decodeIppMessage(bytes).message.groups[0]?.attributes[1]).toEqual({
      name: 'requested-attributes',
      values: [
        { kind: 'string', tag: VALUE_TAGS.keyword, value: 'printer-name' },
        { kind: 'string', tag: VALUE_TAGS.keyword, value: 'printer-state' },
      ],
    });
  });

  test('decodes and re-encodes a collection inside a collection', () => {
    const mediaCol = [
      ...attribute(VALUE_TAGS.begCollection, 'media-col', []),
      ...member('media-size'),
      ...attribute(VALUE_TAGS.begCollection, '', []),
      ...member('x-dimension'),
      ...attribute(VALUE_TAGS.integer, '', u32(6000)),
      ...member('y-dimension'),
      ...attribute(VALUE_TAGS.integer, '', u32(4000)),
      ...END_COLLECTION,
      ...END_COLLECTION,
    ];
    const bytes = request(mediaCol);
    const { message } = decodeIppMessage(bytes);
    expect(message.groups[0]?.attributes[0]).toEqual({
      name: 'media-col',
      values: [
        {
          kind: 'collection',
          members: [
            {
              name: 'media-size',
              values: [
                {
                  kind: 'collection',
                  members: [
                    { name: 'x-dimension', values: [{ kind: 'integer', value: 6000 }] },
                    { name: 'y-dimension', values: [{ kind: 'integer', value: 4000 }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(encodeIppMessage(message)).toEqual(bytes);
  });

  test('keeps resolutions, ranges, dates, localized text and out-of-band values', () => {
    const date = [0x07, 0xea, 10, 2, 3, 4, 5, 6, 0x2b, 0, 0];
    const localized = [...u16(5), ...ascii('zh-cn'), ...u16(6), ...new TextEncoder().encode('你好')];
    const bytes = request(
      attribute(VALUE_TAGS.resolution, 'printer-resolution-default', [...u32(203), ...u32(203), 3]),
      attribute(VALUE_TAGS.rangeOfInteger, 'copies-supported', [...u32(1), ...u32(99)]),
      attribute(VALUE_TAGS.dateTime, 'printer-current-time', date),
      attribute(VALUE_TAGS.textWithLanguage, 'printer-info', localized),
      attribute(VALUE_TAGS.noValue, 'printer-geo-location', []),
    );
    const { message } = decodeIppMessage(bytes);
    expect(message.groups[0]?.attributes.map((item) => item.values[0])).toEqual([
      { kind: 'resolution', x: 203, y: 203, units: 3 },
      { kind: 'range', lower: 1, upper: 99 },
      { kind: 'octets', tag: VALUE_TAGS.dateTime, value: Uint8Array.from(date) },
      { kind: 'localized', tag: VALUE_TAGS.textWithLanguage, language: 'zh-cn', value: '你好' },
      { kind: 'out-of-band', tag: VALUE_TAGS.noValue },
    ]);
    expect(encodeIppMessage(message)).toEqual(bytes);
  });

  test('refuses malformed requests', () => {
    const charset = attribute(0x47, 'attributes-charset', ascii('utf-8'));
    const cases: Uint8Array[] = [
      // 头不完整
      Uint8Array.of(0x02, 0x00, 0x00),
      // 没有结束标记
      request(charset).subarray(0, -1),
      // 名字长度超出数据
      Uint8Array.from([0x02, 0x00, ...u16(0x000b), ...u32(7), 0x01, 0x47, ...u16(500), ...ascii('x')]),
      // 开头就是「又一个值」
      request(attribute(0x44, '', ascii('x'))),
      // 集合里没有成员名就给值
      request([...attribute(VALUE_TAGS.begCollection, 'media-col', []), ...attribute(0x21, '', u32(1)), ...END_COLLECTION]),
      // 集合没有关上
      request([...attribute(VALUE_TAGS.begCollection, 'media-col', []), ...member('x')]),
      // 集合外出现成员名
      request(member('x')),
      // 不是 UTF-8
      request(attribute(0x41, 'job-name', [0xff, 0xfe])),
      // 整数只有 3 字节
      request(attribute(0x21, 'copies', [0, 0, 1])),
      // 布尔值不是 0 或 1
      request(attribute(0x22, 'ipp-attribute-fidelity', [2])),
      // 扩展标记
      request(attribute(0x7f, 'x', u32(0x40000000))),
      // 关键字超过 255 字节
      request(attribute(0x44, 'sides', ascii('x'.repeat(256)))),
      // 组标记 0
      Uint8Array.from([0x02, 0x00, ...u16(0x000b), ...u32(7), 0x00, 0x03]),
    ];
    for (const bytes of cases) {
      expect(() => decodeIppMessage(bytes)).toThrow(IppDecodeError);
    }
  });

  test('refuses collections nested deeper than four levels', () => {
    const open = (name: string) => [...attribute(VALUE_TAGS.begCollection, name, []), ...member('m')];
    const nested = [
      ...open('a'),
      ...open(''),
      ...open(''),
      ...open(''),
      ...open(''),
      ...attribute(0x21, '', u32(1)),
      ...END_COLLECTION,
      ...END_COLLECTION,
      ...END_COLLECTION,
      ...END_COLLECTION,
      ...END_COLLECTION,
    ];
    expect(() => decodeIppMessage(request(nested))).toThrow(IppDecodeError);
  });

  test('refuses too many attributes and attribute sections over 64KB', () => {
    const many = Array.from({ length: 501 }, (_, index) => attribute(0x44, `a${index}`, ascii('x')));
    expect(() => decodeIppMessage(request(...many))).toThrow(IppDecodeError);
    const long = Array.from({ length: 70 }, (_, index) => attribute(0x41, `t${index}`, ascii('x'.repeat(1000))));
    expect(() => decodeIppMessage(request(...long))).toThrow(IppDecodeError);
  });
});

describe('encodeIppMessage', () => {
  test('encodes the Print-Job response of RFC 8010 A.2', () => {
    const text = (tag: number, name: string, value: string) => ({ name, values: [{ kind: 'string' as const, tag, value }] });
    const message: IppMessage = {
      version: { major: 1, minor: 1 },
      code: 0,
      requestId: 1,
      groups: [
        {
          tag: GROUP_TAGS.operation,
          attributes: [
            text(VALUE_TAGS.charset, 'attributes-charset', 'utf-8'),
            text(VALUE_TAGS.naturalLanguage, 'attributes-natural-language', 'en-us'),
            text(VALUE_TAGS.textWithoutLanguage, 'status-message', 'successful-ok'),
          ],
        },
        {
          tag: GROUP_TAGS.job,
          attributes: [
            { name: 'job-id', values: [{ kind: 'integer', value: 147 }] },
            text(VALUE_TAGS.uri, 'job-uri', 'ipp://printer.example.com/ipp/print/pinetree/147'),
            { name: 'job-state', values: [{ kind: 'enum', value: 3 }] },
          ],
        },
      ],
    };
    expect(encodeIppMessage(message)).toEqual(PRINT_JOB_RESPONSE);
  });

  test('refuses an attribute without values', () => {
    const message: IppMessage = {
      version: { major: 2, minor: 0 },
      code: 0,
      requestId: 1,
      groups: [{ tag: GROUP_TAGS.operation, attributes: [{ name: 'x', values: [] }] }],
    };
    expect(() => encodeIppMessage(message)).toThrow('has no value');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/ipp/ipp-codec.test.ts`
Expected: FAIL，`Cannot find module './ipp-codec'`。

- [ ] **Step 3: 实现**

```ts
// src/core/ipp/ipp-constants.ts
/**
 * IPP 的编号：RFC 8010（编码）、RFC 8011（语义）和 IANA 的 IPP 注册表。只列本程序用到的。
 * 局域网共享的设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 8.1 节。
 */

/** 属性组的开始标记（RFC 8010 §3.5.1）。 */
export const GROUP_TAGS = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  unsupported: 0x05,
} as const;

/** 不小于它的标记是值的类型，小于它的是属性组标记（RFC 8010 §3.5）。 */
export const FIRST_VALUE_TAG = 0x10;
/** 0x10–0x1F 是「带外」值：没有值本身，只说明「不支持」「未知」「没有值」。 */
export const LAST_OUT_OF_BAND_TAG = 0x1f;
/** 扩展标记：后面跟 4 字节的真正标记（RFC 8010 §3.5.2）。没见过客户端用它，见到就拒绝。 */
export const EXTENSION_TAG = 0x7f;

/** 值的类型（RFC 8010 §3.5.2）。 */
export const VALUE_TAGS = {
  unsupported: 0x10,
  unknown: 0x12,
  noValue: 0x13,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  textWithoutLanguage: 0x41,
  nameWithoutLanguage: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

/** 支持的操作（RFC 8011 §4.2、§4.3）。 */
export const OPERATIONS = {
  printJob: 0x0002,
  validateJob: 0x0004,
  cancelJob: 0x0008,
  getJobAttributes: 0x0009,
  getJobs: 0x000a,
  getPrinterAttributes: 0x000b,
} as const;

/** 状态码（RFC 8011 §B）。 */
export const STATUS = {
  ok: 0x0000,
  okIgnoredOrSubstituted: 0x0001,
  badRequest: 0x0400,
  forbidden: 0x0401,
  notAuthorized: 0x0403,
  notPossible: 0x0404,
  notFound: 0x0406,
  documentFormatNotSupported: 0x040a,
  attributesOrValuesNotSupported: 0x040b,
  charsetNotSupported: 0x040d,
  compressionNotSupported: 0x040f,
  documentFormatError: 0x0411,
  operationNotSupported: 0x0501,
  versionNotSupported: 0x0503,
  busy: 0x0507,
} as const;

/** printer-state（RFC 8011 §5.4.11）。 */
export const PRINTER_STATE = { idle: 3, processing: 4, stopped: 5 } as const;
/** job-state（RFC 8011 §5.3.7）。 */
export const JOB_STATE = {
  pending: 3,
  'pending-held': 4,
  processing: 5,
  canceled: 7,
  aborted: 8,
  completed: 9,
} as const;
/** orientation-requested：3 = 竖、4 = 横。 */
export const ORIENTATION = { portrait: 3, landscape: 4 } as const;
/** print-quality：4 = 普通。 */
export const PRINT_QUALITY_NORMAL = 4;
/** finishings：3 = 不做后处理。 */
export const FINISHINGS_NONE = 3;
/** 分辨率的单位：3 = 每英寸点数（RFC 8011 §5.1.16）。 */
export const RESOLUTION_DPI = 3;
/** 回复用的字符集和语言：程序只说 UTF-8 的中文。 */
export const IPP_CHARSET = 'utf-8';
export const IPP_LANGUAGE = 'zh-cn';
```

```ts
// src/core/ipp/ipp-codec.ts
import { EXTENSION_TAG, FIRST_VALUE_TAG, GROUP_TAGS, LAST_OUT_OF_BAND_TAG, VALUE_TAGS } from './ipp-constants';

/**
 * IPP 报文的二进制编解码（RFC 8010 §3）。请求来自局域网里的任何电脑，不可信：
 * 每一处长度都核对，属性数、值数、集合层数、属性部分的总字节数都有上限，不对就抛 IppDecodeError。
 */

/** 一个属性值。字符串类（文字、名字、关键字、网址、字符集、语言、MIME 类型）按 UTF-8 解成字符串，tag 记原来的类型。 */
export type IppValue =
  | { kind: 'integer'; value: number }
  | { kind: 'enum'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; tag: number; value: string }
  /** textWithLanguage、nameWithLanguage：带语言的文字。 */
  | { kind: 'localized'; tag: number; language: string; value: string }
  /** octetString、dateTime，以及本程序不认识的类型：原样保留字节。 */
  | { kind: 'octets'; tag: number; value: Uint8Array }
  /** units：3 = 每英寸点数，4 = 每厘米点数。 */
  | { kind: 'resolution'; x: number; y: number; units: number }
  | { kind: 'range'; lower: number; upper: number }
  | { kind: 'collection'; members: IppAttribute[] }
  /** unsupported、unknown、no-value 这类没有值本身的。 */
  | { kind: 'out-of-band'; tag: number };

export interface IppAttribute {
  name: string;
  /** 至少一个值；多个值就是 1setOf。 */
  values: IppValue[];
}

export interface IppGroup {
  /** GROUP_TAGS 里的一个（也可能是别的 0x01–0x0F，例如文档组）。 */
  tag: number;
  attributes: IppAttribute[];
}

export interface IppVersion {
  major: number;
  minor: number;
}

export interface IppMessage {
  version: IppVersion;
  /** 请求里是操作编号，回复里是状态码。 */
  code: number;
  requestId: number;
  groups: IppGroup[];
}

export interface DecodedIpp {
  message: IppMessage;
  /** 属性部分之后、文档数据开始的位置。 */
  dataOffset: number;
}

export const IPP_DECODE_LIMITS = {
  /** 属性部分最多 64KB：Get-Printer-Attributes 的请求只有几百字节，Print-Job 的属性也就一两 KB。 */
  headerBytes: 64 * 1024,
  /** 一个请求最多 500 个属性（含集合里的成员）：实测客户端的请求不到 50 个。 */
  attributes: 500,
  /** 一个属性最多 100 个值：requested-attributes 列全也只有几十个。 */
  values: 100,
  /** 集合最多套 4 层：media-col 里的 media-size 才 2 层。 */
  collectionDepth: 4,
} as const;

/** 字符串类的值和它们的长度上限（字节，RFC 8011 §5.1）。 */
const STRING_LIMITS: ReadonlyMap<number, number> = new Map<number, number>([
  [VALUE_TAGS.textWithoutLanguage, 1023],
  [VALUE_TAGS.nameWithoutLanguage, 255],
  [VALUE_TAGS.keyword, 255],
  [VALUE_TAGS.uri, 1023],
  [VALUE_TAGS.uriScheme, 63],
  [VALUE_TAGS.charset, 63],
  [VALUE_TAGS.naturalLanguage, 63],
  [VALUE_TAGS.mimeMediaType, 255],
]);
/** 属性名、成员名最长 255 字节。 */
const MAX_NAME_BYTES = 255;
/** octetString 和不认识的类型最长 1023 字节（RFC 8011 §5.1.11）。 */
const MAX_OCTETS = 1023;
/** 带语言的文字：语言最长 63 字节，文字最长 1023 字节。 */
const MAX_LANGUAGE_BYTES = 63;
const MAX_LOCALIZED_TEXT_BYTES = 1023;
const INTEGER_BYTES = 4;
const RESOLUTION_BYTES = 9;
const RANGE_BYTES = 8;
/** dateTime 固定 11 字节（RFC 2579 DateAndTime）。 */
export const DATE_TIME_BYTES = 11;
const LENGTH_FIELD_BYTES = 2;
const UINT16_MAX = 0xffff;
/** 一般的回复 1–4KB：写缓冲从 1KB 起，不够就翻倍。 */
const INITIAL_WRITER_BYTES = 1024;

/** 报文不合规格：HTTP 层据此回「请求有误」。 */
export class IppDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IppDecodeError';
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

/** 按顺序读字节，越过 end 就抛错（属性部分不许越过 64KB）。 */
class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly end: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  u8(): number {
    this.need(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  i32(): number {
    this.need(INTEGER_BYTES);
    const value = this.view.getInt32(this.offset);
    this.offset += INTEGER_BYTES;
    return value;
  }

  take(length: number): Uint8Array {
    this.need(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  private need(count: number): void {
    if (this.offset + count > this.end) {
      throw new IppDecodeError(`the attributes end early or are longer than allowed (at byte ${this.offset})`);
    }
  }
}

interface Counter {
  attributes: number;
}

/**
 * 解出 IPP 报文的属性部分；dataOffset 之后是文档数据（PDF、图片、光栅），这里不碰。
 * 属性部分超过 IPP_DECODE_LIMITS.headerBytes 还没结束就当作坏请求。
 * @throws IppDecodeError 任何一处不合规格
 */
export function decodeIppMessage(bytes: Uint8Array): DecodedIpp {
  const reader = new Reader(bytes, Math.min(bytes.length, IPP_DECODE_LIMITS.headerBytes));
  const version = { major: reader.u8(), minor: reader.u8() };
  const code = reader.u16();
  const requestId = reader.i32();
  const counter: Counter = { attributes: 0 };
  const groups: IppGroup[] = [];
  let tag = reader.u8();
  while (tag !== GROUP_TAGS.end) {
    if (tag === 0 || tag >= FIRST_VALUE_TAG) {
      throw new IppDecodeError(`expected a group tag, got 0x${tag.toString(16)}`);
    }
    const group: IppGroup = { tag, attributes: [] };
    groups.push(group);
    tag = readGroup(reader, group.attributes, counter);
  }
  return { message: { version, code, requestId, groups }, dataOffset: reader.position };
}

/** 读一组属性，返回读到的下一个组标记。 */
function readGroup(reader: Reader, attributes: IppAttribute[], counter: Counter): number {
  for (;;) {
    const tag = reader.u8();
    if (tag < FIRST_VALUE_TAG) {
      return tag;
    }
    const name = readText(reader, MAX_NAME_BYTES);
    const value = readValue(reader, tag, counter, 0);
    if (name !== '') {
      countAttribute(counter);
      attributes.push({ name, values: [value] });
      continue;
    }
    // 名字长度为 0：上一个属性的又一个值（1setOf）。
    const previous = attributes.at(-1);
    if (previous === undefined) {
      throw new IppDecodeError('an additional value has no attribute');
    }
    addValue(previous, value);
  }
}

function readValue(reader: Reader, tag: number, counter: Counter, depth: number): IppValue {
  if (tag === EXTENSION_TAG) {
    throw new IppDecodeError('extension tags are not supported');
  }
  if (tag === VALUE_TAGS.memberAttrName || tag === VALUE_TAGS.endCollection) {
    throw new IppDecodeError('collection syntax outside a collection');
  }
  const length = reader.u16();
  if (tag === VALUE_TAGS.begCollection) {
    // 规范要求长度为 0；个别客户端填了别的，跳过不看。
    reader.take(length);
    if (depth + 1 > IPP_DECODE_LIMITS.collectionDepth) {
      throw new IppDecodeError(`collections nested deeper than ${IPP_DECODE_LIMITS.collectionDepth}`);
    }
    return { kind: 'collection', members: readCollection(reader, counter, depth + 1) };
  }
  return valueOf(tag, reader.take(length));
}

/** 集合（RFC 8010 §3.1.6）：成员名（memberAttrName）后面跟它的值，直到 endCollection。 */
function readCollection(reader: Reader, counter: Counter, depth: number): IppAttribute[] {
  const members: IppAttribute[] = [];
  for (;;) {
    const tag = reader.u8();
    if (tag < FIRST_VALUE_TAG) {
      throw new IppDecodeError('a collection is not closed');
    }
    if (reader.u16() !== 0) {
      throw new IppDecodeError('collection members must not have a name field');
    }
    if (tag === VALUE_TAGS.endCollection) {
      reader.take(reader.u16());
      if (members.some((member) => member.values.length === 0)) {
        throw new IppDecodeError('a collection member has no value');
      }
      return members;
    }
    if (tag === VALUE_TAGS.memberAttrName) {
      const name = readText(reader, MAX_NAME_BYTES);
      if (name === '') {
        throw new IppDecodeError('a collection member has an empty name');
      }
      countAttribute(counter);
      members.push({ name, values: [] });
      continue;
    }
    const member = members.at(-1);
    if (member === undefined) {
      throw new IppDecodeError('a collection value has no member name');
    }
    addValue(member, readValue(reader, tag, counter, depth));
  }
}

function valueOf(tag: number, bytes: Uint8Array): IppValue {
  if (tag >= FIRST_VALUE_TAG && tag <= LAST_OUT_OF_BAND_TAG) {
    return { kind: 'out-of-band', tag };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (tag) {
    case VALUE_TAGS.integer:
      expectLength(bytes, INTEGER_BYTES);
      return { kind: 'integer', value: view.getInt32(0) };
    case VALUE_TAGS.enum:
      expectLength(bytes, INTEGER_BYTES);
      return { kind: 'enum', value: view.getInt32(0) };
    case VALUE_TAGS.boolean: {
      expectLength(bytes, 1);
      const byte = view.getUint8(0);
      if (byte > 1) {
        throw new IppDecodeError(`boolean value ${byte}`);
      }
      return { kind: 'boolean', value: byte === 1 };
    }
    case VALUE_TAGS.resolution:
      expectLength(bytes, RESOLUTION_BYTES);
      return { kind: 'resolution', x: view.getInt32(0), y: view.getInt32(4), units: view.getInt8(8) };
    case VALUE_TAGS.rangeOfInteger:
      expectLength(bytes, RANGE_BYTES);
      return { kind: 'range', lower: view.getInt32(0), upper: view.getInt32(4) };
    case VALUE_TAGS.textWithLanguage:
    case VALUE_TAGS.nameWithLanguage:
      return readLocalized(tag, bytes);
    default: {
      const limit = STRING_LIMITS.get(tag);
      if (limit !== undefined) {
        checkLength(bytes.length, limit);
        return { kind: 'string', tag, value: decodeUtf8(bytes) };
      }
      if (tag === VALUE_TAGS.dateTime) {
        expectLength(bytes, DATE_TIME_BYTES);
      } else {
        checkLength(bytes.length, MAX_OCTETS);
      }
      // 复制一份：不留着整个请求的缓冲区（后面可能跟着 50MB 的文档）。
      return { kind: 'octets', tag, value: bytes.slice() };
    }
  }
}

function readLocalized(tag: number, bytes: Uint8Array): IppValue {
  const reader = new Reader(bytes, bytes.length);
  const language = readText(reader, MAX_LANGUAGE_BYTES);
  const value = readText(reader, MAX_LOCALIZED_TEXT_BYTES);
  if (reader.position !== bytes.length) {
    throw new IppDecodeError('a localized value has trailing bytes');
  }
  return { kind: 'localized', tag, language, value };
}

/** 2 字节长度 + UTF-8 文字。 */
function readText(reader: Reader, maxBytes: number): string {
  const length = reader.u16();
  checkLength(length, maxBytes);
  return decodeUtf8(reader.take(length));
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new IppDecodeError('text is not valid UTF-8');
  }
}

function checkLength(length: number, maxBytes: number): void {
  if (length > maxBytes) {
    throw new IppDecodeError(`a name or value of ${length} bytes is over ${maxBytes}`);
  }
}

function expectLength(bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) {
    throw new IppDecodeError(`expected ${length} value bytes, got ${bytes.length}`);
  }
}

function countAttribute(counter: Counter): void {
  counter.attributes += 1;
  if (counter.attributes > IPP_DECODE_LIMITS.attributes) {
    throw new IppDecodeError(`more than ${IPP_DECODE_LIMITS.attributes} attributes`);
  }
}

function addValue(attribute: IppAttribute, value: IppValue): void {
  if (attribute.values.length >= IPP_DECODE_LIMITS.values) {
    throw new IppDecodeError(`attribute ${attribute.name} has more than ${IPP_DECODE_LIMITS.values} values`);
  }
  attribute.values.push(value);
}

/** 按顺序写字节，空间不够时翻倍。 */
class Writer {
  private buffer = new Uint8Array(INITIAL_WRITER_BYTES);
  private length = 0;

  u8(value: number): void {
    this.reserve(1);
    this.buffer[this.length] = value & 0xff;
    this.length += 1;
  }

  u16(value: number): void {
    this.u8(value >> 8);
    this.u8(value);
  }

  i32(value: number): void {
    this.reserve(INTEGER_BYTES);
    new DataView(this.buffer.buffer).setInt32(this.length, value);
    this.length += INTEGER_BYTES;
  }

  bytes(value: Uint8Array): void {
    this.reserve(value.length);
    this.buffer.set(value, this.length);
    this.length += value.length;
  }

  /** 2 字节长度 + 内容。 */
  sized(value: Uint8Array): void {
    if (value.length > UINT16_MAX) {
      throw new Error(`IPP value of ${value.length} bytes does not fit a 2-byte length`);
    }
    this.u16(value.length);
    this.bytes(value);
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  private reserve(count: number): void {
    if (this.length + count <= this.buffer.length) {
      return;
    }
    let size = this.buffer.length * 2;
    while (size < this.length + count) {
      size *= 2;
    }
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }
}

/**
 * 把 IPP 报文编成字节（只有属性部分，文档数据由调用方接在后面）。
 * @throws Error 属性没有值、值超长：是程序自己拼错了回复，快速失败
 */
export function encodeIppMessage(message: IppMessage): Uint8Array {
  const writer = new Writer();
  writer.u8(message.version.major);
  writer.u8(message.version.minor);
  writer.u16(message.code);
  writer.i32(message.requestId);
  for (const group of message.groups) {
    writer.u8(group.tag);
    for (const attribute of group.attributes) {
      writeAttribute(writer, attribute);
    }
  }
  writer.u8(GROUP_TAGS.end);
  return writer.result();
}

function writeAttribute(writer: Writer, attribute: IppAttribute): void {
  if (attribute.values.length === 0) {
    throw new Error(`IPP attribute ${attribute.name} has no value`);
  }
  for (const [index, value] of attribute.values.entries()) {
    writeValue(writer, index === 0 ? attribute.name : '', value);
  }
}

function writeValue(writer: Writer, name: string, value: IppValue): void {
  writer.u8(tagOf(value));
  writer.sized(UTF8_ENCODER.encode(name));
  switch (value.kind) {
    case 'integer':
    case 'enum':
      writer.u16(INTEGER_BYTES);
      writer.i32(value.value);
      return;
    case 'boolean':
      writer.u16(1);
      writer.u8(value.value ? 1 : 0);
      return;
    case 'string':
      writer.sized(UTF8_ENCODER.encode(value.value));
      return;
    case 'localized': {
      const language = UTF8_ENCODER.encode(value.language);
      const text = UTF8_ENCODER.encode(value.value);
      writer.u16(LENGTH_FIELD_BYTES * 2 + language.length + text.length);
      writer.sized(language);
      writer.sized(text);
      return;
    }
    case 'octets':
      writer.sized(value.value);
      return;
    case 'resolution':
      writer.u16(RESOLUTION_BYTES);
      writer.i32(value.x);
      writer.i32(value.y);
      writer.u8(value.units);
      return;
    case 'range':
      writer.u16(RANGE_BYTES);
      writer.i32(value.lower);
      writer.i32(value.upper);
      return;
    case 'out-of-band':
      writer.u16(0);
      return;
    case 'collection':
      writer.u16(0);
      for (const member of value.members) {
        if (member.values.length === 0) {
          throw new Error(`IPP collection member ${member.name} has no value`);
        }
        writer.u8(VALUE_TAGS.memberAttrName);
        writer.u16(0);
        writer.sized(UTF8_ENCODER.encode(member.name));
        for (const memberValue of member.values) {
          writeValue(writer, '', memberValue);
        }
      }
      writer.u8(VALUE_TAGS.endCollection);
      writer.u16(0);
      writer.u16(0);
      return;
  }
}

function tagOf(value: IppValue): number {
  switch (value.kind) {
    case 'integer':
      return VALUE_TAGS.integer;
    case 'enum':
      return VALUE_TAGS.enum;
    case 'boolean':
      return VALUE_TAGS.boolean;
    case 'resolution':
      return VALUE_TAGS.resolution;
    case 'range':
      return VALUE_TAGS.rangeOfInteger;
    case 'collection':
      return VALUE_TAGS.begCollection;
    case 'string':
    case 'localized':
    case 'octets':
    case 'out-of-band':
      return value.tag;
  }
}
```

（测试文件里数组字面量按 RFC 的表格一行一个字段写，`biome check` 若要求改格式，用 Edit 照它的意见调整，必要时在数组前加 `// biome-ignore format: 按 RFC 8010 附录 A 的表格逐行对照`。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/ipp`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/ipp/ipp-constants.ts src/core/ipp/ipp-codec.ts src/core/ipp/ipp-codec.test.ts
git commit -m "feat(ipp): encode and decode IPP messages" -m "LAN sharing speaks IPP to any computer on the network, so its binary format is decoded in pure core code with a length check at every step and caps on header size, attribute count, values and collection depth. Tests follow the Print-Job request and response of RFC 8010 appendix A byte for byte." -m "$TRAILER"
```

---

### Task 3: 建属性、读属性的小工具

**Files:**
- Create: `src/core/ipp/ipp-attributes.ts`、`src/core/ipp/ipp-attributes.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/ipp/ipp-attributes.test.ts
import { describe, expect, test } from 'bun:test';
import {
  booleanValue,
  collectionAttr,
  dateTimeAttr,
  encodeDateTime,
  enumAttr,
  findAttribute,
  integerAttr,
  integerValue,
  keywordAttr,
  rangeAttr,
  resolutionAttr,
  stringValue,
  stringValues,
  textAttr,
} from './ipp-attributes';
import { VALUE_TAGS } from './ipp-constants';

describe('attribute builders', () => {
  test('build typed values', () => {
    expect(keywordAttr('sides-supported', 'one-sided')).toEqual({
      name: 'sides-supported',
      values: [{ kind: 'string', tag: VALUE_TAGS.keyword, value: 'one-sided' }],
    });
    expect(integerAttr('copies-default', 1).values).toEqual([{ kind: 'integer', value: 1 }]);
    expect(enumAttr('printer-state', 3).values).toEqual([{ kind: 'enum', value: 3 }]);
    expect(resolutionAttr('printer-resolution-default', 203).values).toEqual([
      { kind: 'resolution', x: 203, y: 203, units: 3 },
    ]);
    expect(rangeAttr('copies-supported', 1, 99).values).toEqual([{ kind: 'range', lower: 1, upper: 99 }]);
    expect(collectionAttr('media-size', [integerAttr('x-dimension', 6000)]).values).toEqual([
      { kind: 'collection', members: [{ name: 'x-dimension', values: [{ kind: 'integer', value: 6000 }] }] },
    ]);
  });

  test('encodes a dateTime in UTC with deciseconds', () => {
    const at = Date.UTC(2026, 9, 2, 3, 4, 5, 678);
    expect(encodeDateTime(at)).toEqual(Uint8Array.of(0x07, 0xea, 10, 2, 3, 4, 5, 6, 0x2b, 0, 0));
    expect(dateTimeAttr('printer-current-time', at).values[0]).toMatchObject({ kind: 'octets', tag: VALUE_TAGS.dateTime });
  });
});

describe('attribute readers', () => {
  const attributes = [
    textAttr('job-name', '面单'),
    keywordAttr('requested-attributes', 'printer-name', 'printer-state'),
    enumAttr('job-state', 9),
    { name: 'ipp-attribute-fidelity', values: [{ kind: 'boolean' as const, value: true }] },
    { name: 'mixed', values: [{ kind: 'integer' as const, value: 1 }, { kind: 'string' as const, tag: 0x44, value: 'x' }] },
  ];

  test('find attributes and read their first value', () => {
    expect(stringValue(findAttribute(attributes, 'job-name'))).toBe('面单');
    expect(integerValue(findAttribute(attributes, 'job-state'))).toBe(9);
    expect(booleanValue(findAttribute(attributes, 'ipp-attribute-fidelity'))).toBe(true);
    expect(stringValue(findAttribute(attributes, 'missing'))).toBeNull();
    expect(integerValue(findAttribute(attributes, 'job-name'))).toBeNull();
  });

  test('read every value only when all are strings', () => {
    expect(stringValues(findAttribute(attributes, 'requested-attributes'))).toEqual(['printer-name', 'printer-state']);
    expect(stringValues(findAttribute(attributes, 'mixed'))).toBeNull();
    expect(stringValues(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/ipp/ipp-attributes.test.ts`
Expected: FAIL，`Cannot find module './ipp-attributes'`。

- [ ] **Step 3: 实现**

```ts
// src/core/ipp/ipp-attributes.ts
import { DATE_TIME_BYTES, type IppAttribute, type IppValue } from './ipp-codec';
import { RESOLUTION_DPI, VALUE_TAGS } from './ipp-constants';

/** 建属性、读属性的小工具：拼回复、读请求时不用到处写 { kind, tag, value }。 */

/** dateTime 的时区方向：程序一律写 UTC（+00:00）。 */
const PLUS_SIGN = 0x2b;
const MS_PER_DECISECOND = 100;

function strings(tag: number, name: string, values: readonly string[]): IppAttribute {
  return { name, values: values.map((value): IppValue => ({ kind: 'string', tag, value })) };
}

export function keywordAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.keyword, name, values);
}

export function textAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.textWithoutLanguage, name, values);
}

export function nameAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.nameWithoutLanguage, name, values);
}

export function uriAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.uri, name, values);
}

export function charsetAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.charset, name, values);
}

export function languageAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.naturalLanguage, name, values);
}

export function mimeTypeAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.mimeMediaType, name, values);
}

export function integerAttr(name: string, ...values: number[]): IppAttribute {
  return { name, values: values.map((value): IppValue => ({ kind: 'integer', value })) };
}

export function enumAttr(name: string, ...values: number[]): IppAttribute {
  return { name, values: values.map((value): IppValue => ({ kind: 'enum', value })) };
}

export function booleanAttr(name: string, value: boolean): IppAttribute {
  return { name, values: [{ kind: 'boolean', value }] };
}

/** 横竖相同的分辨率（每英寸点数）。 */
export function resolutionAttr(name: string, ...dpis: number[]): IppAttribute {
  return { name, values: dpis.map((dpi): IppValue => ({ kind: 'resolution', x: dpi, y: dpi, units: RESOLUTION_DPI })) };
}

export function rangeAttr(name: string, lower: number, upper: number): IppAttribute {
  return { name, values: [{ kind: 'range', lower, upper }] };
}

/** 每个参数是一个集合（它的成员）；多个就是 1setOf collection。 */
export function collectionAttr(name: string, ...collections: IppAttribute[][]): IppAttribute {
  return { name, values: collections.map((members): IppValue => ({ kind: 'collection', members })) };
}

export function dateTimeAttr(name: string, epochMs: number): IppAttribute {
  return { name, values: [{ kind: 'octets', tag: VALUE_TAGS.dateTime, value: encodeDateTime(epochMs) }] };
}

/** 没有值本身的属性（例如 printer-geo-location 未知）。 */
export function outOfBandAttr(name: string, tag: number): IppAttribute {
  return { name, values: [{ kind: 'out-of-band', tag }] };
}

/** RFC 2579 DateAndTime：年（2 字节）、月、日、时、分、秒、十分之一秒、时区方向、时、分。写 UTC。 */
export function encodeDateTime(epochMs: number): Uint8Array {
  const date = new Date(epochMs);
  const bytes = new Uint8Array(DATE_TIME_BYTES);
  new DataView(bytes.buffer).setUint16(0, date.getUTCFullYear());
  bytes.set(
    [
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      Math.floor(date.getUTCMilliseconds() / MS_PER_DECISECOND),
      PLUS_SIGN,
      0,
      0,
    ],
    2,
  );
  return bytes;
}

/** 按名字找属性（同名的只认第一个）。 */
export function findAttribute(attributes: readonly IppAttribute[], name: string): IppAttribute | undefined {
  return attributes.find((attribute) => attribute.name === name);
}

/** 第一个值是文字（带不带语言都行）就返回它；没有或不是文字返回 null。 */
export function stringValue(attribute: IppAttribute | undefined): string | null {
  const value = attribute?.values[0];
  return value?.kind === 'string' || value?.kind === 'localized' ? value.value : null;
}

/** 全部值都是文字才返回；有一个不是就返回 null（调用方按「格式不对」处理）。 */
export function stringValues(attribute: IppAttribute | undefined): string[] | null {
  if (attribute === undefined) {
    return null;
  }
  const values: string[] = [];
  for (const value of attribute.values) {
    if (value.kind !== 'string' && value.kind !== 'localized') {
      return null;
    }
    values.push(value.value);
  }
  return values;
}

/** 第一个值是 integer 或 enum 就返回它。 */
export function integerValue(attribute: IppAttribute | undefined): number | null {
  const value = attribute?.values[0];
  return value?.kind === 'integer' || value?.kind === 'enum' ? value.value : null;
}

export function booleanValue(attribute: IppAttribute | undefined): boolean | null {
  const value = attribute?.values[0];
  return value?.kind === 'boolean' ? value.value : null;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/ipp`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/ipp/ipp-attributes.ts src/core/ipp/ipp-attributes.test.ts
git commit -m "feat(ipp): helpers to build and read IPP attributes" -m "Replies are long lists of typed attributes and requests are read by name; small builders and readers keep the operation code readable and treat a value of the wrong type as missing instead of trusting it." -m "$TRAILER"
```

---

### Task 4: 共享打印机和它的属性集

免驱添加靠这一组属性。按来源分（全部列出，后面的实现一条不少）：

- **RFC 8011 §5.4 要求的**：`charset-configured`、`charset-supported`、`compression-supported`、`document-format-default`、`document-format-supported`、`generated-natural-language-supported`、`ipp-versions-supported`、`natural-language-configured`、`operations-supported`、`pdl-override-supported`、`printer-is-accepting-jobs`、`printer-name`、`printer-state`、`printer-state-reasons`、`printer-up-time`、`printer-uri-supported`、`queued-job-count`、`uri-authentication-supported`、`uri-security-supported`。
- **PWG 5100.12（IPP/2.0）**：`printer-current-time`、`printer-info`、`printer-location`、`printer-make-and-model`、`printer-more-info`、`job-ids-supported`、`which-jobs-supported`、`job-creation-attributes-supported`。
- **PWG 5100.14（IPP Everywhere，Windows 的类驱动按它认）**：`ipp-features-supported`（`ipp-everywhere`）、`color-supported`、`copies-default` / `-supported`、`finishings-default` / `-supported`、`media-default` / `-ready` / `-supported`、`media-col-default` / `-ready` / `-database` / `-supported`、`media-size-supported`、四边 `media-*-margin-supported`、`media-source-supported`、`media-type-supported`、`orientation-requested-default` / `-supported`、`output-bin-default` / `-supported`、`print-color-mode-default` / `-supported`、`print-quality-default` / `-supported`、`printer-device-id`、`printer-geo-location`、`printer-resolution-default` / `-supported`、`printer-uuid`、`pwg-raster-document-resolution-supported`、`pwg-raster-document-sheet-back`、`pwg-raster-document-type-supported`、`sides-default` / `-supported`。
- **AirPrint**：`urf-supported`；`printer-kind`（`labels`）。

`media-col-database` 只在明确要时才给（PWG 5100.7：`all` 不含它）。

**Files:**
- Create: `src/core/ipp/shared-printer.ts`、`src/core/ipp/shared-printer.test.ts`
- Create: `src/core/ipp/document-format.ts`（这里只放格式清单，识别在 Task 5 补上）
- Create: `src/core/ipp/printer-attributes.ts`、`src/core/ipp/printer-attributes.test.ts`
- Create: `src/core/ipp/testing/ipp-requests.ts`

- [ ] **Step 1: 测试用的样例**

```ts
// src/core/ipp/testing/ipp-requests.ts
import { charsetAttr, languageAttr, uriAttr } from '../ipp-attributes';
import type { IppAttribute, IppGroup, IppMessage, IppVersion } from '../ipp-codec';
import { GROUP_TAGS } from '../ipp-constants';
import type { SharedPrinter } from '../shared-printer';

/** 测试里的共享打印机网址（按 192.168.1.10 这台电脑、默认端口拼）。 */
export const TEST_PRINTER_URI = 'ipp://192.168.1.10:8631/printers/60x40';
export const TEST_MORE_INFO_URI = 'http://192.168.1.10:8631/printers/60x40';
/** 最小的「PDF」：只有文件头，够 sniffFormat 认出来；渲染交给假的渲染页。 */
export const MINIMAL_PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');

/** 60×40 标签纸的共享打印机，203dpi，空闲。 */
export function testPrinter(overrides: Partial<SharedPrinter> = {}): SharedPrinter {
  return {
    key: '60x40',
    paper: { widthMm: 60, heightMm: 40 },
    name: '60×40 标签',
    info: '60×40 标签（前台上的热敏标签机）',
    makeAndModel: 'CDL-云签速印 共享热敏标签机',
    deviceId: 'MFG:CDL-LabelFlash;MDL:Label 60x40;CMD:PDF,PWGRaster,URF,JPEG,PNG;CLS:PRINTER;',
    location: '前台',
    dpi: 203,
    uuid: 'urn:uuid:3f2504e0-4f89-51d3-9a0c-0305e82c3301',
    state: { state: 'idle', reasons: ['none'], message: '可以打印' },
    queuedJobCount: 0,
    ...overrides,
  };
}

export interface RequestOptions {
  /** null = 不带 printer-uri。 */
  printerUri?: string | null;
  operation?: IppAttribute[];
  job?: IppAttribute[];
  requestId?: number;
  version?: IppVersion;
}

/** 一个合规的 IPP 请求：字符集、语言打头，再加 printer-uri 和给的属性。 */
export function ippRequest(code: number, options: RequestOptions = {}): IppMessage {
  const printerUri = options.printerUri === undefined ? TEST_PRINTER_URI : options.printerUri;
  const operation: IppAttribute[] = [
    charsetAttr('attributes-charset', 'utf-8'),
    languageAttr('attributes-natural-language', 'en'),
    ...(printerUri === null ? [] : [uriAttr('printer-uri', printerUri)]),
    ...(options.operation ?? []),
  ];
  const groups: IppGroup[] = [{ tag: GROUP_TAGS.operation, attributes: operation }];
  if (options.job !== undefined) {
    groups.push({ tag: GROUP_TAGS.job, attributes: options.job });
  }
  return { version: options.version ?? { major: 2, minor: 0 }, code, requestId: options.requestId ?? 1, groups };
}

/** 回复里某一组（第一个这种组）的某个属性。 */
export function attributeIn(message: IppMessage, groupTag: number, name: string): IppAttribute | undefined {
  return message.groups.find((group) => group.tag === groupTag)?.attributes.find((item) => item.name === name);
}
```

- [ ] **Step 2: 写测试**

```ts
// src/core/ipp/shared-printer.test.ts
import { describe, expect, test } from 'bun:test';
import { mediaName, sharedPrinterState } from './shared-printer';

describe('sharedPrinterState', () => {
  // 读不到状态（null，例如 macOS）按能打印算：和本机打印一样，不因为不知道就拒绝。
  test('is idle when the printer is ready or unknown and nothing is queued', () => {
    expect(sharedPrinterState(null, 0)).toEqual({ state: 'idle', reasons: ['none'], message: '可以打印' });
    expect(sharedPrinterState({ ready: true }, 0).state).toBe('idle');
  });

  test('is processing while jobs are queued', () => {
    expect(sharedPrinterState(null, 2)).toEqual({ state: 'processing', reasons: ['none'], message: '正在打印' });
  });

  test('is stopped with the reason the driver reported', () => {
    expect(sharedPrinterState({ ready: false, issue: 'paperOut', detail: '缺纸：装好标签纸' }, 1)).toEqual({
      state: 'stopped',
      reasons: ['media-empty-error'],
      message: '缺纸：装好标签纸',
    });
    expect(sharedPrinterState({ ready: false, issue: 'offline', detail: '离线' }, 0).reasons).toEqual(['offline-report']);
  });
});

describe('mediaName', () => {
  test('names the paper the PWG 5101.1 way', () => {
    expect(mediaName('60x40')).toBe('om_label-60x40_60x40mm');
    expect(mediaName('76.5x130')).toBe('om_label-76.5x130_76.5x130mm');
  });
});
```

```ts
// src/core/ipp/printer-attributes.test.ts
import { describe, expect, test } from 'bun:test';
import { findAttribute, integerValue, stringValue, stringValues } from './ipp-attributes';
import { OPERATIONS } from './ipp-constants';
import { type PrinterContext, printerAttributes, selectAttributes, urfSupported } from './printer-attributes';
import { TEST_MORE_INFO_URI, TEST_PRINTER_URI, testPrinter } from './testing/ipp-requests';

const CONTEXT: PrinterContext = {
  printerUri: TEST_PRINTER_URI,
  moreInfoUri: TEST_MORE_INFO_URI,
  authentication: 'none',
  upTimeSeconds: 42,
  nowMs: Date.UTC(2026, 9, 2),
};

/** RFC 8011 §5.4 要求每台打印机都有的属性。 */
const RFC_8011_REQUIRED = [
  'charset-configured',
  'charset-supported',
  'compression-supported',
  'document-format-default',
  'document-format-supported',
  'generated-natural-language-supported',
  'ipp-versions-supported',
  'natural-language-configured',
  'operations-supported',
  'pdl-override-supported',
  'printer-is-accepting-jobs',
  'printer-name',
  'printer-state',
  'printer-state-reasons',
  'printer-up-time',
  'printer-uri-supported',
  'queued-job-count',
  'uri-authentication-supported',
  'uri-security-supported',
];

/** 免驱添加（Windows 的 IPP 类驱动、AirPrint）要看的。 */
const DRIVERLESS = [
  'ipp-features-supported',
  'media-col-default',
  'media-col-ready',
  'media-size-supported',
  'printer-device-id',
  'printer-uuid',
  'pwg-raster-document-resolution-supported',
  'pwg-raster-document-sheet-back',
  'pwg-raster-document-type-supported',
  'urf-supported',
  'print-color-mode-supported',
  'sides-supported',
];

describe('printerAttributes', () => {
  const all = printerAttributes(testPrinter(), CONTEXT);

  test('has every attribute RFC 8011 requires and those driverless clients look for', () => {
    const names = all.map((attribute) => attribute.name);
    for (const name of [...RFC_8011_REQUIRED, ...DRIVERLESS]) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test('describes the shared paper, formats and operations', () => {
    expect(stringValue(findAttribute(all, 'printer-name'))).toBe('60×40 标签');
    expect(stringValue(findAttribute(all, 'media-default'))).toBe('om_label-60x40_60x40mm');
    expect(stringValues(findAttribute(all, 'document-format-supported'))).toEqual([
      'application/octet-stream',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/pwg-raster',
      'image/urf',
    ]);
    expect(findAttribute(all, 'operations-supported')?.values).toHaveLength(Object.keys(OPERATIONS).length);
    expect(stringValues(findAttribute(all, 'urf-supported'))).toEqual(urfSupported(203));
    expect(stringValue(findAttribute(all, 'printer-uri-supported'))).toBe(TEST_PRINTER_URI);
    expect(integerValue(findAttribute(all, 'printer-up-time'))).toBe(42);
  });

  test('describes the paper size in hundredths of a millimetre with no margins', () => {
    const [mediaCol] = findAttribute(all, 'media-col-default')?.values ?? [];
    expect(mediaCol?.kind === 'collection' ? mediaCol.members.map((member) => member.name) : []).toEqual([
      'media-size',
      'media-bottom-margin',
      'media-left-margin',
      'media-right-margin',
      'media-top-margin',
      'media-source',
      'media-type',
    ]);
    const [size] = findAttribute(all, 'media-size-supported')?.values ?? [];
    expect(size).toEqual({
      kind: 'collection',
      members: [
        { name: 'x-dimension', values: [{ kind: 'integer', value: 6000 }] },
        { name: 'y-dimension', values: [{ kind: 'integer', value: 4000 }] },
      ],
    });
  });

  test('asks for the share password once one is set', () => {
    const basic = printerAttributes(testPrinter(), { ...CONTEXT, authentication: 'basic' });
    expect(stringValue(findAttribute(basic, 'uri-authentication-supported'))).toBe('basic');
  });

  test('reports a stopped printer and its reasons', () => {
    const stopped = printerAttributes(
      testPrinter({ state: { state: 'stopped', reasons: ['media-empty-error'], message: '缺纸' } }),
      CONTEXT,
    );
    expect(integerValue(findAttribute(stopped, 'printer-state'))).toBe(5);
    expect(stringValues(findAttribute(stopped, 'printer-state-reasons'))).toEqual(['media-empty-error']);
  });
});

describe('selectAttributes', () => {
  const all = printerAttributes(testPrinter(), CONTEXT);
  const names = (requested: string[] | null) => selectAttributes(all, requested).map((attribute) => attribute.name);

  test('returns everything but the media database by default', () => {
    expect(names(null)).not.toContain('media-col-database');
    expect(names(null)).toHaveLength(all.length - 1);
    expect(names(['all', 'media-col-database'])).toHaveLength(all.length);
  });

  test('returns only job template attributes for job-template', () => {
    const template = names(['job-template']);
    expect(template).toContain('copies-supported');
    expect(template).toContain('media-col-default');
    expect(template).not.toContain('printer-name');
  });

  test('returns named attributes', () => {
    expect(names(['printer-name', 'printer-state'])).toEqual(['printer-name', 'printer-state']);
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/ipp`
Expected: FAIL，`Cannot find module './shared-printer'`、`'./printer-attributes'`。

- [ ] **Step 4: 实现**

```ts
// src/core/ipp/shared-printer.ts
import type { PaperSize } from '../../shared/paper-sizes';
import type { PrinterIssue, PrinterReadiness } from '../../shared/printer-readiness';

export type SharedPrinterStateName = 'idle' | 'processing' | 'stopped';

export interface SharedPrinterState {
  state: SharedPrinterStateName;
  /** printer-state-reasons 的关键字；没有问题时是 none。 */
  reasons: string[];
  /** printer-state-message：给对方电脑的人看的中文。 */
  message: string;
}

/** 一台共享打印机 = 一种已分配打印机的纸张。主进程按纸张分配表、打印机资料和状态拼出来。 */
export interface SharedPrinter {
  /** 纸张键（60x40），也是网址里的名字：/printers/60x40。 */
  key: string;
  paper: PaperSize;
  /** printer-name：「60×40 标签」。 */
  name: string;
  /** printer-info：「60×40 标签（前台上的热敏标签机）」。 */
  info: string;
  makeAndModel: string;
  /** printer-device-id（IEEE 1284，只用 ASCII）：Windows 按它给打印机认驱动。 */
  deviceId: string;
  /** printer-location：这台电脑的名字。 */
  location: string;
  /** 打印机的分辨率（点 / 英寸）：光栅按它请对方渲染，标签按它出点。 */
  dpi: number;
  /** urn:uuid:…，按程序实例和纸张算出来，重启、换端口都不变。 */
  uuid: string;
  state: SharedPrinterState;
  /** 排着的和正在处理的任务数。 */
  queuedJobCount: number;
}

/** 打印机问题 → IPP 的 printer-state-reasons（PWG 5100.9 的关键字）。 */
const ISSUE_REASONS: Record<PrinterIssue, string> = {
  paperOut: 'media-empty-error',
  paperJam: 'media-jam-error',
  doorOpen: 'door-open-error',
  offline: 'offline-report',
  other: 'other-error',
};
const READY_MESSAGE = '可以打印';
const BUSY_MESSAGE = '正在打印';
const NO_REASON = 'none';

/**
 * 打印机状态 → printer-state：驱动明确报告问题才是 stopped；查不到（null，例如 macOS）按能打印算，
 * 和本机打印的规则一样（printer-status.ts），不因为不知道就拒绝。
 */
export function sharedPrinterState(readiness: PrinterReadiness | null, activeJobs: number): SharedPrinterState {
  if (readiness !== null && !readiness.ready) {
    return { state: 'stopped', reasons: [ISSUE_REASONS[readiness.issue]], message: readiness.detail };
  }
  return activeJobs > 0
    ? { state: 'processing', reasons: [NO_REASON], message: BUSY_MESSAGE }
    : { state: 'idle', reasons: [NO_REASON], message: READY_MESSAGE };
}

/** PWG 5101.1 的自描述纸张名：om（其他公制）_名字_尺寸。纸张键本来就是「宽x高」，正好当尺寸。 */
export function mediaName(key: string): string {
  return `om_label-${key}_${key}mm`;
}
```

```ts
// src/core/ipp/document-format.ts
/** 局域网共享收的文档格式。 */
export const DOCUMENT_FORMATS = ['application/pdf', 'image/jpeg', 'image/png', 'image/pwg-raster', 'image/urf'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
/** 「按内容自己认」：客户端不知道或不说格式时用它（也是 document-format-default）。 */
export const AUTO_FORMAT = 'application/octet-stream';
/** document-format-supported：自动 + 五种格式。 */
export const SUPPORTED_FORMATS: readonly string[] = [AUTO_FORMAT, ...DOCUMENT_FORMATS];

/** 客户端声明的格式是否支持（MIME 类型不分大小写）。 */
export function isSupportedFormat(value: string): boolean {
  return SUPPORTED_FORMATS.includes(value.toLowerCase());
}
```

```ts
// src/core/ipp/printer-attributes.ts
import { PDF_LIMITS } from '../pdf/pdf-model';
import { SUPPORTED_FORMATS, AUTO_FORMAT } from './document-format';
import {
  booleanAttr,
  charsetAttr,
  collectionAttr,
  dateTimeAttr,
  enumAttr,
  integerAttr,
  keywordAttr,
  languageAttr,
  mimeTypeAttr,
  nameAttr,
  outOfBandAttr,
  rangeAttr,
  resolutionAttr,
  textAttr,
  uriAttr,
} from './ipp-attributes';
import type { IppAttribute } from './ipp-codec';
import {
  FINISHINGS_NONE,
  IPP_CHARSET,
  IPP_LANGUAGE,
  OPERATIONS,
  ORIENTATION,
  PRINT_QUALITY_NORMAL,
  PRINTER_STATE,
  VALUE_TAGS,
} from './ipp-constants';
import { mediaName, type SharedPrinter } from './shared-printer';
import type { PaperSize } from '../../shared/paper-sizes';

/** 每张最多 99 份：和 PDF 打印的份数上限一致。 */
export const IPP_COPIES_MAX = PDF_LIMITS.copies;
/** 纸的尺寸按 1/100 毫米写（PWG 5100.7 的 media-size）。 */
const HUNDREDTHS_PER_MM = 100;
/** 标签纸铺满打印：四边边距 0。 */
const NO_MARGIN = 0;
/** 只在明确要时才给（PWG 5100.7：requested-attributes 为 all 时不含它）。 */
const EXPLICIT_ONLY: ReadonlySet<string> = new Set(['media-col-database']);
/** 这些前缀的属性属于 job-template 组（RFC 8011 §5.2 的 xxx-default、xxx-supported、xxx-ready）。 */
const JOB_TEMPLATE_PREFIXES = [
  'copies-',
  'finishings-',
  'media-',
  'orientation-requested-',
  'output-bin-',
  'print-color-mode-',
  'print-quality-',
  'printer-resolution-',
  'sides-',
] as const;

/** 回复 Get-Printer-Attributes 时按这次请求算的部分。 */
export interface PrinterContext {
  /** 按对方请求时用的主机拼的 ipp:// 网址。 */
  printerUri: string;
  /** 浏览器能打开的说明页（http://）。 */
  moreInfoUri: string;
  /** basic = 设了共享密码。 */
  authentication: 'none' | 'basic';
  upTimeSeconds: number;
  nowMs: number;
}

/** AirPrint 的 urf-supported（Bonjour 的 URF= 同一份）：版本 1.4、份数由打印机做、8 位灰度和 24 位 sRGB、这台打印机的分辨率。 */
export function urfSupported(dpi: number): string[] {
  return ['V1.4', 'CP1', 'W8', 'SRGB24', `RS${dpi}`];
}

/** 一种纸的 media-col（PWG 5100.7）：尺寸、四边边距 0、主纸盒、标签纸。 */
export function mediaCollection(paper: PaperSize): IppAttribute[] {
  return [
    collectionAttr('media-size', mediaSize(paper)),
    integerAttr('media-bottom-margin', NO_MARGIN),
    integerAttr('media-left-margin', NO_MARGIN),
    integerAttr('media-right-margin', NO_MARGIN),
    integerAttr('media-top-margin', NO_MARGIN),
    keywordAttr('media-source', 'main'),
    keywordAttr('media-type', 'labels'),
  ];
}

function mediaSize(paper: PaperSize): IppAttribute[] {
  return [
    integerAttr('x-dimension', Math.round(paper.widthMm * HUNDREDTHS_PER_MM)),
    integerAttr('y-dimension', Math.round(paper.heightMm * HUNDREDTHS_PER_MM)),
  ];
}

/** 一台共享打印机的全部属性（RFC 8011 + PWG 5100.12 / 5100.14 / 5100.7 + AirPrint），按名字排好。 */
export function printerAttributes(printer: SharedPrinter, context: PrinterContext): IppAttribute[] {
  const media = mediaName(printer.key);
  const mediaCol = mediaCollection(printer.paper);
  const reasons = printer.state.reasons.length > 0 ? printer.state.reasons : ['none'];
  return [
    charsetAttr('charset-configured', IPP_CHARSET),
    charsetAttr('charset-supported', IPP_CHARSET),
    booleanAttr('color-supported', false),
    keywordAttr('compression-supported', 'none'),
    integerAttr('copies-default', 1),
    rangeAttr('copies-supported', 1, IPP_COPIES_MAX),
    mimeTypeAttr('document-format-default', AUTO_FORMAT),
    mimeTypeAttr('document-format-supported', ...SUPPORTED_FORMATS),
    enumAttr('finishings-default', FINISHINGS_NONE),
    enumAttr('finishings-supported', FINISHINGS_NONE),
    languageAttr('generated-natural-language-supported', IPP_LANGUAGE),
    keywordAttr('ipp-features-supported', 'ipp-everywhere'),
    keywordAttr('ipp-versions-supported', '1.1', '2.0'),
    keywordAttr(
      'job-creation-attributes-supported',
      'copies',
      'media',
      'media-col',
      'orientation-requested',
      'print-color-mode',
      'print-quality',
      'printer-resolution',
      'sides',
    ),
    booleanAttr('job-ids-supported', true),
    integerAttr('media-bottom-margin-supported', NO_MARGIN),
    collectionAttr('media-col-database', mediaCol),
    collectionAttr('media-col-default', mediaCol),
    collectionAttr('media-col-ready', mediaCol),
    keywordAttr(
      'media-col-supported',
      'media-size',
      'media-bottom-margin',
      'media-left-margin',
      'media-right-margin',
      'media-top-margin',
      'media-source',
      'media-type',
    ),
    keywordAttr('media-default', media),
    integerAttr('media-left-margin-supported', NO_MARGIN),
    keywordAttr('media-ready', media),
    integerAttr('media-right-margin-supported', NO_MARGIN),
    collectionAttr('media-size-supported', mediaSize(printer.paper)),
    keywordAttr('media-source-supported', 'main'),
    keywordAttr('media-supported', media),
    integerAttr('media-top-margin-supported', NO_MARGIN),
    keywordAttr('media-type-supported', 'labels'),
    languageAttr('natural-language-configured', IPP_LANGUAGE),
    enumAttr('operations-supported', ...Object.values(OPERATIONS)),
    enumAttr('orientation-requested-default', ORIENTATION.portrait),
    enumAttr('orientation-requested-supported', ORIENTATION.portrait, ORIENTATION.landscape),
    keywordAttr('output-bin-default', 'face-up'),
    keywordAttr('output-bin-supported', 'face-up'),
    keywordAttr('pdl-override-supported', 'attempted'),
    keywordAttr('print-color-mode-default', 'monochrome'),
    keywordAttr('print-color-mode-supported', 'auto', 'monochrome'),
    enumAttr('print-quality-default', PRINT_QUALITY_NORMAL),
    enumAttr('print-quality-supported', PRINT_QUALITY_NORMAL),
    dateTimeAttr('printer-current-time', context.nowMs),
    textAttr('printer-device-id', printer.deviceId),
    outOfBandAttr('printer-geo-location', VALUE_TAGS.unknown),
    textAttr('printer-info', printer.info),
    booleanAttr('printer-is-accepting-jobs', true),
    keywordAttr('printer-kind', 'labels'),
    textAttr('printer-location', printer.location),
    textAttr('printer-make-and-model', printer.makeAndModel),
    uriAttr('printer-more-info', context.moreInfoUri),
    nameAttr('printer-name', printer.name),
    resolutionAttr('printer-resolution-default', printer.dpi),
    resolutionAttr('printer-resolution-supported', printer.dpi),
    enumAttr('printer-state', PRINTER_STATE[printer.state.state]),
    textAttr('printer-state-message', printer.state.message),
    keywordAttr('printer-state-reasons', ...reasons),
    integerAttr('printer-up-time', context.upTimeSeconds),
    uriAttr('printer-uri-supported', context.printerUri),
    uriAttr('printer-uuid', printer.uuid),
    resolutionAttr('pwg-raster-document-resolution-supported', printer.dpi),
    keywordAttr('pwg-raster-document-sheet-back', 'normal'),
    keywordAttr('pwg-raster-document-type-supported', 'sgray_8', 'srgb_8'),
    integerAttr('queued-job-count', printer.queuedJobCount),
    keywordAttr('sides-default', 'one-sided'),
    keywordAttr('sides-supported', 'one-sided'),
    keywordAttr('uri-authentication-supported', context.authentication),
    keywordAttr('uri-security-supported', 'none'),
    keywordAttr('urf-supported', ...urfSupported(printer.dpi)),
    keywordAttr('which-jobs-supported', 'completed', 'not-completed'),
  ];
}

function isJobTemplate(name: string): boolean {
  return JOB_TEMPLATE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * 按 requested-attributes 挑（RFC 8011 §4.2.5.1）：没给或 all = 全部（media-col-database 除外）；
 * printer-description、job-template 是两组；其余按名字。不认识的名字忽略。
 */
export function selectAttributes(attributes: readonly IppAttribute[], requested: readonly string[] | null): IppAttribute[] {
  const names = requested ?? ['all'];
  const wantsAll = names.includes('all');
  const wantsDescription = wantsAll || names.includes('printer-description');
  const wantsTemplate = wantsAll || names.includes('job-template');
  return attributes.filter(
    ({ name }) =>
      names.includes(name) ||
      (!EXPLICIT_ONLY.has(name) && (isJobTemplate(name) ? wantsTemplate : wantsDescription)),
  );
}
```

（Biome 要求 import 按字母排序：把 `../../shared/paper-sizes` 那一行移到最前面。）

- [ ] **Step 5: 跑测试**

Run: `bun test src/core/ipp`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/ipp/shared-printer.ts src/core/ipp/shared-printer.test.ts src/core/ipp/document-format.ts src/core/ipp/printer-attributes.ts src/core/ipp/printer-attributes.test.ts src/core/ipp/testing/ipp-requests.ts
git commit -m "feat(ipp): describe each shared paper as a driverless printer" -m "Every paper with a printer becomes an IPP printer whose attributes cover RFC 8011, IPP/2.0, IPP Everywhere and AirPrint, so Windows' IPP class driver and macOS can add it without a vendor driver. The paper is the only medium, with zero margins and a PWG self-describing media name; the printer state follows the driver and treats unknown as ready." -m "$TRAILER"
```

---

### Task 5: 认文档格式；PWG Raster 和 Apple Raster 解码

Windows 的类驱动主要发 PWG Raster，macOS / iOS 的 AirPrint 发 Apple Raster（URF）。两种都是「每页一个头 + 按行的行程编码」，编码完全相同（CUPS `raster-stream.c` 的解压就是一份代码）：每行先一个字节「这一行重复几次（减 1）」，然后一串包：控制字节 0–127 = 下一个像素重复（n + 1）次；129–255 = 后面跟着（257 − n）个原样的像素；128 = 这一行剩下的全填白。PWG 的页头是 1796 字节的 CUPS 页头（大端），Apple Raster 的文件头 12 字节、页头 32 字节。

解码是纯 TS 的循环（内存安全），但输入不可信：页数、每页边长和像素数都有上限；输出的大小由页头决定（行程编码再怎么写也只能填满已知大小的缓冲区）；行程越过一行的末尾、数据提前结束都算坏文件。只认程序在属性里声明过的类型：8 位灰度（sgray_8 / W8）和 24 位 sRGB（srgb_8 / SRGB24），彩色按人眼的权重转灰度（和 PDF 渲染页的 `rgbaToGray` 一样，BT.601）。

**Files:**
- Modify: `src/core/ipp/document-format.ts`
- Create: `src/core/ipp/document-format.test.ts`
- Create: `src/core/ipp/raster.ts`、`src/core/ipp/raster.test.ts`
- Create: `src/core/ipp/testing/raster-fixtures.ts`

- [ ] **Step 1: 测试用的光栅编码器**

```ts
// src/core/ipp/testing/raster-fixtures.ts
/**
 * 测试用：按 PWG 5102.4 和 Apple Raster 的格式写出光栅文件（行程编码和 CUPS 的解压互为逆过程）。
 * 只在测试里用，主程序只解不编。
 */

/** 一页：每个像素 bytesPerPixel 个字节，逐行。 */
export interface FixturePage {
  width: number;
  height: number;
  dpi: number;
  bytesPerPixel: 1 | 3;
  pixels: Uint8Array;
}

export const PWG_HEADER_BYTES = 1796;
/** CUPS 的颜色空间编号：18 = sGray，19 = sRGB；3 = K（黑，本程序不收）。 */
export const CUPS_SGRAY = 18;
export const CUPS_SRGB = 19;
/** 一个包最多 128 个像素。 */
const MAX_PACKET_PIXELS = 128;
const LITERAL_BASE = 257;

export interface PwgHeaderFields {
  width: number;
  height: number;
  dpi: number;
  /** 不给时等于 dpi；给了就是横竖不同的分辨率。 */
  dpiY?: number;
  bitsPerPixel: number;
  colorSpace: number;
  bytesPerLine?: number;
  bitsPerColor?: number;
  colorOrder?: number;
}

/** 1796 字节的 CUPS v2 页头，只填解码要看的几项（偏移见 raster.ts）。 */
export function pwgHeader(fields: PwgHeaderFields): Uint8Array {
  const header = new Uint8Array(PWG_HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('PwgRaster'), 0);
  view.setUint32(276, fields.dpi);
  view.setUint32(280, fields.dpiY ?? fields.dpi);
  view.setUint32(372, fields.width);
  view.setUint32(376, fields.height);
  view.setUint32(384, fields.bitsPerColor ?? 8);
  view.setUint32(388, fields.bitsPerPixel);
  view.setUint32(392, fields.bytesPerLine ?? (fields.width * fields.bitsPerPixel) / 8);
  view.setUint32(396, fields.colorOrder ?? 0);
  view.setUint32(400, fields.colorSpace);
  return header;
}

/** Apple Raster 的 32 字节页头：位深、颜色空间（0 = sGray，1 = sRGB）、单面、普通质量、宽、高、分辨率。 */
export function urfHeader(fields: { width: number; height: number; dpi: number; bitsPerPixel: number; colorSpace: number }): Uint8Array {
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  header[0] = fields.bitsPerPixel;
  header[1] = fields.colorSpace;
  header[2] = 1;
  header[3] = 4;
  view.setUint32(12, fields.width);
  view.setUint32(16, fields.height);
  view.setUint32(20, fields.dpi);
  return header;
}

/** 一行的行程编码：相同的像素合成一段，其余原样写；每行只出现一次（行重复字节为 0）。 */
export function encodeLine(line: Uint8Array, bytesPerPixel: number): number[] {
  const width = line.length / bytesPerPixel;
  const pixelAt = (x: number) => line.subarray(x * bytesPerPixel, (x + 1) * bytesPerPixel);
  const same = (a: number, b: number) => pixelAt(a).every((value, index) => value === pixelAt(b)[index]);
  const out: number[] = [0];
  let x = 0;
  while (x < width) {
    let run = 1;
    while (x + run < width && run < MAX_PACKET_PIXELS && same(x, x + run)) {
      run += 1;
    }
    if (run >= 2 || x + 1 === width) {
      out.push(run - 1, ...pixelAt(x));
      x += run;
      continue;
    }
    let literal = 1;
    while (x + literal < width && literal < MAX_PACKET_PIXELS && !(x + literal + 1 < width && same(x + literal, x + literal + 1))) {
      literal += 1;
    }
    if (literal === 1) {
      out.push(0, ...pixelAt(x));
    } else {
      out.push(LITERAL_BASE - literal, ...line.subarray(x * bytesPerPixel, (x + literal) * bytesPerPixel));
    }
    x += literal;
  }
  return out;
}

function encodePage(page: FixturePage): number[] {
  const lineBytes = page.width * page.bytesPerPixel;
  const out: number[] = [];
  for (let y = 0; y < page.height; y += 1) {
    out.push(...encodeLine(page.pixels.subarray(y * lineBytes, (y + 1) * lineBytes), page.bytesPerPixel));
  }
  return out;
}

/** 'RaS2' + 每页（页头 + 数据）。 */
export function pwgRaster(pages: readonly FixturePage[]): Uint8Array {
  const parts: number[] = [...new TextEncoder().encode('RaS2')];
  for (const page of pages) {
    const header = pwgHeader({
      width: page.width,
      height: page.height,
      dpi: page.dpi,
      bitsPerPixel: page.bytesPerPixel * 8,
      colorSpace: page.bytesPerPixel === 1 ? CUPS_SGRAY : CUPS_SRGB,
    });
    for (const byte of header) {
      parts.push(byte);
    }
    parts.push(...encodePage(page));
  }
  return Uint8Array.from(parts);
}

/** 'UNIRAST\0' + 页数 + 每页（页头 + 数据）。 */
export function urfRaster(pages: readonly FixturePage[]): Uint8Array {
  const parts: number[] = [...new TextEncoder().encode('UNIRAST\0'), 0, 0, 0, pages.length];
  for (const page of pages) {
    const header = urfHeader({
      width: page.width,
      height: page.height,
      dpi: page.dpi,
      bitsPerPixel: page.bytesPerPixel * 8,
      colorSpace: page.bytesPerPixel === 1 ? 0 : 1,
    });
    parts.push(...header, ...encodePage(page));
  }
  return Uint8Array.from(parts);
}

/** 一页灰度：左半黑、右半白，最后一行全灰（测试能看出行、列有没有错位）。 */
export function grayPage(width: number, height: number, dpi = 203): FixturePage {
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (y === height - 1) {
        pixels[y * width + x] = 128;
      } else if (x < width / 2) {
        pixels[y * width + x] = 0;
      }
    }
  }
  return { width, height, dpi, bytesPerPixel: 1, pixels };
}
```

- [ ] **Step 2: 写测试**

```ts
// src/core/ipp/document-format.test.ts
import { describe, expect, test } from 'bun:test';
import { isSupportedFormat, sniffFormat } from './document-format';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffFormat', () => {
  test('recognises each supported format by its first bytes', () => {
    expect(sniffFormat(text('%PDF-1.7\n'))).toBe('application/pdf');
    // 有的导出工具在 %PDF- 前面加几个字节：规范允许它出现在前 1024 字节里。
    expect(sniffFormat(text('\n\n%PDF-1.4\n'))).toBe('application/pdf');
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('image/jpeg');
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('image/png');
    expect(sniffFormat(text('RaS2xxxx'))).toBe('image/pwg-raster');
    expect(sniffFormat(text('UNIRAST\0xxxx'))).toBe('image/urf');
  });

  test('returns null for anything else', () => {
    expect(sniffFormat(text('%!PS-Adobe-3.0'))).toBeNull();
    expect(sniffFormat(new Uint8Array(0))).toBeNull();
  });
});

describe('isSupportedFormat', () => {
  test('accepts the declared formats in any case', () => {
    expect(isSupportedFormat('application/octet-stream')).toBe(true);
    expect(isSupportedFormat('Image/PWG-Raster')).toBe(true);
    expect(isSupportedFormat('application/postscript')).toBe(false);
  });
});
```

```ts
// src/core/ipp/raster.test.ts
import { describe, expect, test } from 'bun:test';
import { RasterError, readPwgRaster, readUrf } from './raster';
import {
  CUPS_SGRAY,
  CUPS_SRGB,
  type FixturePage,
  grayPage,
  pwgHeader,
  pwgRaster,
  urfHeader,
  urfRaster,
} from './testing/raster-fixtures';

const SYNC = [...new TextEncoder().encode('RaS2')];

/** 页头 + 手写的数据。 */
function pwgWith(header: Uint8Array, data: readonly number[]): Uint8Array {
  return Uint8Array.from([...SYNC, ...header, ...data]);
}

describe('readPwgRaster', () => {
  test('decodes gray pages at their resolution', () => {
    const page = grayPage(7, 4);
    const pages = [...readPwgRaster(pwgRaster([page, grayPage(3, 2, 300)]))];
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ image: { width: 7, height: 4, pixels: page.pixels }, dpi: 203 });
    expect(pages[1]?.dpi).toBe(300);
  });

  test('turns sRGB pixels into gray the way the eye weighs them', () => {
    const page: FixturePage = { width: 3, height: 1, dpi: 203, bytesPerPixel: 3, pixels: Uint8Array.of(255, 0, 0, 0, 0, 0, 255, 255, 255) };
    const [decoded] = [...readPwgRaster(pwgRaster([page]))];
    expect([...(decoded?.image.pixels ?? [])]).toEqual([76, 0, 255]);
  });

  test('repeats lines and clears the rest of a line to white', () => {
    const header = pwgHeader({ width: 4, height: 3, dpi: 203, bitsPerPixel: 8, colorSpace: CUPS_SGRAY });
    // 第 1 行出现 2 次、整行填白；第 3 行：两个黑点，其余填白。
    const [page] = [...readPwgRaster(pwgWith(header, [1, 128, 0, 1, 0, 128]))];
    expect([...(page?.image.pixels ?? [])]).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255]);
  });

  test('refuses broken or unsupported raster', () => {
    const gray = (fields: Partial<Parameters<typeof pwgHeader>[0]> = {}) =>
      pwgHeader({ width: 4, height: 1, dpi: 203, bitsPerPixel: 8, colorSpace: CUPS_SGRAY, ...fields });
    const cases: Uint8Array[] = [
      // 不是 PWG
      new TextEncoder().encode('RaS3'),
      // 行程越过行尾（6 个像素放进 4 个）
      pwgWith(gray(), [0, 5, 0]),
      // 原样像素越过行尾
      pwgWith(gray(), [0, 251, 1, 2, 3, 4, 5, 6]),
      // 数据提前结束
      pwgWith(gray(), [0, 1]),
      // 页头不完整
      Uint8Array.from([...SYNC, 0, 0]),
      // 黑白 1 位（K），程序没声明
      pwgWith(gray({ bitsPerPixel: 1, bitsPerColor: 1, colorSpace: 3, bytesPerLine: 1 }), [0, 128]),
      // 每行字节数对不上
      pwgWith(gray({ bytesPerLine: 5 }), [0, 128]),
      // 颜色分平面存放
      pwgWith(gray({ colorOrder: 2 }), [0, 128]),
      // 横竖分辨率不同
      pwgWith(gray({ dpiY: 300 }), [0, 128]),
      // 页面太大
      pwgWith(gray({ width: 9000, bytesPerLine: 9000 }), [0, 128]),
      // 分辨率不合理
      pwgWith(gray({ dpi: 1 }), [0, 128]),
      // 一页也没有
      Uint8Array.from(SYNC),
      // sRGB 的颜色空间配 8 位
      pwgWith(gray({ colorSpace: CUPS_SRGB }), [0, 128]),
    ];
    for (const data of cases) {
      expect(() => [...readPwgRaster(data)]).toThrow(RasterError);
    }
  });

  test('refuses more than 200 pages', () => {
    const tiny = grayPage(1, 1);
    expect(() => [...readPwgRaster(pwgRaster(Array.from({ length: 201 }, () => tiny)))]).toThrow(RasterError);
  });
});

describe('readUrf', () => {
  test('decodes gray and sRGB pages', () => {
    const gray = grayPage(5, 3, 300);
    const rgb: FixturePage = { width: 2, height: 1, dpi: 300, bytesPerPixel: 3, pixels: Uint8Array.of(0, 0, 255, 255, 255, 255) };
    const pages = [...readUrf(urfRaster([gray, rgb]))];
    expect(pages[0]).toEqual({ image: { width: 5, height: 3, pixels: gray.pixels }, dpi: 300 });
    expect([...(pages[1]?.image.pixels ?? [])]).toEqual([29, 255]);
  });

  test('refuses a wrong magic, unknown color spaces and truncated pages', () => {
    const head = [...new TextEncoder().encode('UNIRAST\0'), 0, 0, 0, 1];
    const header = (colorSpace: number, bitsPerPixel = 8) => [...urfHeader({ width: 2, height: 1, dpi: 300, bitsPerPixel, colorSpace })];
    const cases: Uint8Array[] = [
      new TextEncoder().encode('UNIRAS\0\0'),
      Uint8Array.from([...head, ...header(6, 32), 0, 128]),
      Uint8Array.from([...head, ...header(0), 0]),
      Uint8Array.from([...head, ...header(0).slice(0, 10)]),
    ];
    for (const data of cases) {
      expect(() => [...readUrf(data)]).toThrow(RasterError);
    }
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/core/ipp/document-format.test.ts src/core/ipp/raster.test.ts`
Expected: FAIL，`sniffFormat` 没有导出、`Cannot find module './raster'`。

- [ ] **Step 4: 实现**

`src/core/ipp/document-format.ts` 末尾加：

```ts
/** PDF 文件头：规范允许它出现在前 1024 字节里的任何位置（有的导出工具在前面加几个字节）。 */
const PDF_HEADER = '%PDF-';
const PDF_HEADER_WINDOW_BYTES = 1024;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** PWG 5102.4 的同步字 'RaS2'；Apple Raster 的文件头 'UNIRAST\0'。 */
const PWG_SYNC = [0x52, 0x61, 0x53, 0x32] as const;
const URF_MAGIC = [0x55, 0x4e, 0x49, 0x52, 0x41, 0x53, 0x54, 0x00] as const;

function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  return data.length >= magic.length && magic.every((value, index) => data[index] === value);
}

/**
 * 按文件头认格式（不信客户端声明的 document-format：它可能说错，也可能故意说错）；认不出返回 null。
 */
export function sniffFormat(data: Uint8Array): DocumentFormat | null {
  if (startsWith(data, PWG_SYNC)) {
    return 'image/pwg-raster';
  }
  if (startsWith(data, URF_MAGIC)) {
    return 'image/urf';
  }
  if (startsWith(data, JPEG_MAGIC)) {
    return 'image/jpeg';
  }
  if (startsWith(data, PNG_MAGIC)) {
    return 'image/png';
  }
  const head = new TextDecoder('latin1').decode(data.subarray(0, PDF_HEADER_WINDOW_BYTES));
  return head.includes(PDF_HEADER) ? 'application/pdf' : null;
}
```

```ts
// src/core/ipp/raster.ts
import { MAX_MONO_SIDE } from '../pdf/mono-pack';
import { PDF_LIMITS } from '../pdf/pdf-model';
import type { GrayImage } from '../templates/mono-image';

/**
 * PWG Raster（PWG 5102.4，Windows 的 IPP 类驱动发它）和 Apple Raster（URF，AirPrint 发它）→ 一页页灰度图。
 * 输入来自局域网，不可信：页数、边长、像素数都有上限；输出大小由页头决定，行程编码越界、数据不完整都抛 RasterError。
 * 用生成器一页一页给出，同一时刻只占一页的内存。
 */

export const RASTER_LIMITS = {
  /** 边长 8192 点：和 PDF 打印的黑白位图一样（120×220mm 在 600dpi 下也只有 5197 点）。 */
  side: MAX_MONO_SIDE,
  /** 一页 1600 万像素：和 PDF 渲染的上限一致。 */
  pagePixels: PDF_LIMITS.pagePixels,
  /** 200 页：和 PDF 打印一致。 */
  pages: PDF_LIMITS.pages,
  /** 分辨率 72–2400dpi：打印机常见 203、300、600；这个范围外的多半是坏数据。 */
  minDpi: 72,
  maxDpi: 2400,
} as const;

/** 一页：灰度（0 黑 – 255 白）和它的分辨率。 */
export interface RasterPage {
  image: GrayImage;
  dpi: number;
}

/** 光栅数据坏了或用了程序没声明的类型。 */
export class RasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RasterError';
  }
}

/** 'RaS2'：PWG Raster 的同步字（大端）。 */
const PWG_SYNC = [0x52, 0x61, 0x53, 0x32] as const;
/** CUPS v2 页头的大小和要看的几项的偏移（cups_page_header2_t，大端 32 位整数）。 */
const PWG_HEADER_BYTES = 1796;
const PWG_OFFSETS = {
  resolutionX: 276,
  resolutionY: 280,
  width: 372,
  height: 376,
  bitsPerColor: 384,
  bitsPerPixel: 388,
  bytesPerLine: 392,
  colorOrder: 396,
  colorSpace: 400,
} as const;
/** CUPS 的颜色空间：18 = sGray，19 = sRGB；颜色顺序 0 = 每个像素的各色挨着放（chunky）。 */
const CUPS_SGRAY = 18;
const CUPS_SRGB = 19;
const CUPS_ORDER_CHUNKED = 0;
const BITS_PER_COLOR = 8;
/** 'UNIRAST\0' + 4 字节页数；每页 32 字节页头。 */
const URF_MAGIC = [0x55, 0x4e, 0x49, 0x52, 0x41, 0x53, 0x54, 0x00] as const;
const URF_FILE_HEADER_BYTES = 12;
const URF_PAGE_HEADER_BYTES = 32;
const URF_OFFSETS = { bitsPerPixel: 0, colorSpace: 1, width: 12, height: 16, dpi: 20 } as const;
/** Apple Raster 的颜色空间编号（CUPS 的 rawcspace 表）：0 = sGray、4 = W（灰度），1 = sRGB、5 = RGB。 */
const URF_GRAY_SPACES: ReadonlySet<number> = new Set([0, 4]);
const URF_RGB_SPACES: ReadonlySet<number> = new Set([1, 5]);
const GRAY_BITS = 8;
const RGB_BITS = 24;
/** 行程编码的控制字节：0–127 重复下一个像素 n+1 次；128 这一行剩下的填白；129–255 跟着 257−n 个原样像素。 */
const MAX_REPEAT_CODE = 127;
const CLEAR_TO_END = 128;
const LITERAL_BASE = 257;
const WHITE = 0xff;
/** BT.601 的亮度权重（千分之）：和 PDF 渲染页的 rgbaToGray 一致。 */
const LUMA = { red: 299, green: 587, blue: 114, total: 1000 } as const;

interface PageFormat {
  width: number;
  height: number;
  dpi: number;
  bytesPerPixel: 1 | 3;
}

/** 顺序读字节；越过末尾说明数据不完整。 */
class Cursor {
  constructor(
    private readonly data: Uint8Array,
    private offset: number,
  ) {}

  get remaining(): number {
    return this.data.length - this.offset;
  }

  u8(): number {
    if (this.offset >= this.data.length) {
      throw new RasterError('the raster data ends early');
    }
    const value = this.data[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.data.length) {
      throw new RasterError('the raster data ends early');
    }
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  return data.length >= magic.length && magic.every((value, index) => data[index] === value);
}

function checkPage(format: PageFormat): void {
  const { width, height, dpi } = format;
  if (width < 1 || height < 1 || width > RASTER_LIMITS.side || height > RASTER_LIMITS.side) {
    throw new RasterError(`a page of ${width}×${height} dots is out of range`);
  }
  if (width * height > RASTER_LIMITS.pagePixels) {
    throw new RasterError(`a page of ${width}×${height} dots has too many pixels`);
  }
  if (dpi < RASTER_LIMITS.minDpi || dpi > RASTER_LIMITS.maxDpi) {
    throw new RasterError(`a resolution of ${dpi}dpi is out of range`);
  }
}

/** PWG 5102.4：'RaS2'，然后每页一个 1796 字节的页头和压缩数据，直到文件末尾。 */
export function* readPwgRaster(data: Uint8Array): Generator<RasterPage> {
  if (!startsWith(data, PWG_SYNC)) {
    throw new RasterError('not a PWG raster stream');
  }
  const cursor = new Cursor(data, PWG_SYNC.length);
  let pages = 0;
  while (cursor.remaining > 0) {
    if (pages >= RASTER_LIMITS.pages) {
      throw new RasterError(`more than ${RASTER_LIMITS.pages} pages`);
    }
    const format = pwgFormat(cursor.take(PWG_HEADER_BYTES));
    pages += 1;
    yield { image: decodePage(cursor, format), dpi: format.dpi };
  }
  if (pages === 0) {
    throw new RasterError('the raster has no pages');
  }
}

function pwgFormat(header: Uint8Array): PageFormat {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const field = (offset: number) => view.getUint32(offset);
  const bitsPerPixel = field(PWG_OFFSETS.bitsPerPixel);
  const colorSpace = field(PWG_OFFSETS.colorSpace);
  const isGray = bitsPerPixel === GRAY_BITS && colorSpace === CUPS_SGRAY;
  const isRgb = bitsPerPixel === RGB_BITS && colorSpace === CUPS_SRGB;
  if (field(PWG_OFFSETS.bitsPerColor) !== BITS_PER_COLOR || !(isGray || isRgb)) {
    throw new RasterError(`unsupported PWG color space ${colorSpace} at ${bitsPerPixel} bits per pixel`);
  }
  if (field(PWG_OFFSETS.colorOrder) !== CUPS_ORDER_CHUNKED) {
    throw new RasterError('only chunky color order is supported');
  }
  const format: PageFormat = {
    width: field(PWG_OFFSETS.width),
    height: field(PWG_OFFSETS.height),
    dpi: field(PWG_OFFSETS.resolutionX),
    bytesPerPixel: isGray ? 1 : 3,
  };
  if (field(PWG_OFFSETS.resolutionY) !== format.dpi) {
    throw new RasterError('the horizontal and vertical resolutions differ');
  }
  if (field(PWG_OFFSETS.bytesPerLine) !== format.width * format.bytesPerPixel) {
    throw new RasterError('bytes per line do not match the width');
  }
  checkPage(format);
  return format;
}

/** Apple Raster：'UNIRAST\0' + 页数，然后每页一个 32 字节的页头和压缩数据。 */
export function* readUrf(data: Uint8Array): Generator<RasterPage> {
  if (!startsWith(data, URF_MAGIC) || data.length < URF_FILE_HEADER_BYTES) {
    throw new RasterError('not an Apple raster stream');
  }
  const declared = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(URF_MAGIC.length);
  if (declared > RASTER_LIMITS.pages) {
    throw new RasterError(`the raster declares ${declared} pages`);
  }
  const cursor = new Cursor(data, URF_FILE_HEADER_BYTES);
  let pages = 0;
  while (cursor.remaining > 0) {
    if (pages >= RASTER_LIMITS.pages) {
      throw new RasterError(`more than ${RASTER_LIMITS.pages} pages`);
    }
    const format = urfFormat(cursor.take(URF_PAGE_HEADER_BYTES));
    pages += 1;
    yield { image: decodePage(cursor, format), dpi: format.dpi };
  }
  if (pages === 0) {
    throw new RasterError('the raster has no pages');
  }
}

function urfFormat(header: Uint8Array): PageFormat {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const bitsPerPixel = header[URF_OFFSETS.bitsPerPixel] ?? 0;
  const colorSpace = header[URF_OFFSETS.colorSpace] ?? 0;
  const isGray = bitsPerPixel === GRAY_BITS && URF_GRAY_SPACES.has(colorSpace);
  const isRgb = bitsPerPixel === RGB_BITS && URF_RGB_SPACES.has(colorSpace);
  if (!(isGray || isRgb)) {
    throw new RasterError(`unsupported Apple raster color space ${colorSpace} at ${bitsPerPixel} bits per pixel`);
  }
  const format: PageFormat = {
    width: view.getUint32(URF_OFFSETS.width),
    height: view.getUint32(URF_OFFSETS.height),
    dpi: view.getUint32(URF_OFFSETS.dpi),
    bytesPerPixel: isGray ? 1 : 3,
  };
  checkPage(format);
  return format;
}

/** 解一页：每行先读重复次数，再解一行，转灰度后按次数写进去（不超过页高）。 */
function decodePage(cursor: Cursor, format: PageFormat): GrayImage {
  const { width, height, bytesPerPixel } = format;
  const line = new Uint8Array(width * bytesPerPixel);
  const grayLine = new Uint8Array(width);
  const pixels = new Uint8Array(width * height);
  let y = 0;
  while (y < height) {
    const repeat = cursor.u8() + 1;
    decodeLine(cursor, line, bytesPerPixel);
    toGray(line, grayLine, bytesPerPixel);
    for (let copy = 0; copy < repeat && y < height; copy += 1) {
      pixels.set(grayLine, y * width);
      y += 1;
    }
  }
  return { width, height, pixels };
}

function decodeLine(cursor: Cursor, line: Uint8Array, bytesPerPixel: number): void {
  let at = 0;
  while (at < line.length) {
    const code = cursor.u8();
    if (code === CLEAR_TO_END) {
      line.fill(WHITE, at);
      return;
    }
    const count = (code <= MAX_REPEAT_CODE ? code + 1 : LITERAL_BASE - code) * bytesPerPixel;
    if (at + count > line.length) {
      throw new RasterError('a run goes past the end of a line');
    }
    if (code <= MAX_REPEAT_CODE) {
      const pixel = cursor.take(bytesPerPixel);
      for (let offset = 0; offset < count; offset += bytesPerPixel) {
        line.set(pixel, at + offset);
      }
    } else {
      line.set(cursor.take(count), at);
    }
    at += count;
  }
}

function toGray(line: Uint8Array, gray: Uint8Array, bytesPerPixel: number): void {
  if (bytesPerPixel === 1) {
    gray.set(line);
    return;
  }
  for (let x = 0; x < gray.length; x += 1) {
    const at = x * bytesPerPixel;
    const red = line[at] ?? WHITE;
    const green = line[at + 1] ?? WHITE;
    const blue = line[at + 2] ?? WHITE;
    gray[x] = Math.round((red * LUMA.red + green * LUMA.green + blue * LUMA.blue) / LUMA.total);
  }
}
```

（几个数字的来历：sRGB 红 (255, 0, 0) → 255 × 299 / 1000 = 76.2 → 76；蓝 (0, 0, 255) → 29.07 → 29。）

- [ ] **Step 5: 跑测试**

Run: `bun test src/core/ipp`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/core/ipp/document-format.ts src/core/ipp/document-format.test.ts src/core/ipp/raster.ts src/core/ipp/raster.test.ts src/core/ipp/testing/raster-fixtures.ts
git commit -m "feat(ipp): sniff document formats and decode PWG and Apple raster" -m "Windows' IPP class driver sends PWG Raster and AirPrint clients send Apple Raster. Both are run-length coded lines, decoded here in pure TypeScript with page, size and pixel caps; a run past the end of a line or a truncated page is refused. Formats are recognised by their first bytes, not by what the client declares." -m "$TRAILER"
```

---

### Task 6: 任务表

收下的任务（含等确认的）、它们的状态和给 Get-Jobs 查的历史。纯逻辑，时间从注入的 `Clock` 取。

**Files:**
- Create: `src/core/ipp/ipp-job-book.ts`、`src/core/ipp/ipp-job-book.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/ipp/ipp-job-book.test.ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../testing/fake-clock';
import { findAttribute, integerValue, stringValue } from './ipp-attributes';
import { VALUE_TAGS } from './ipp-constants';
import { HELD_REASON, IPP_JOB_LIMITS, IppJobBook, jobAttributes, jobIdFromUri, type NewIppJob } from './ipp-job-book';

const NEW_JOB: NewIppJob = {
  printerKey: '60x40',
  name: '面单',
  user: 'zhang',
  client: '192.168.1.23',
  sizeBytes: 3000,
  held: false,
};

function created(book: IppJobBook, overrides: Partial<NewIppJob> = {}) {
  const result = book.create({ ...NEW_JOB, ...overrides });
  if (result.status !== 'created') {
    throw new Error(`not created: ${result.status}`);
  }
  return result.job;
}

describe('IppJobBook', () => {
  test('creates pending or held jobs with increasing ids', () => {
    const book = new IppJobBook(new FakeClock());
    expect(created(book)).toMatchObject({ id: 1, state: 'pending', reasons: ['none'] });
    expect(created(book, { held: true, client: '192.168.1.24' })).toMatchObject({
      id: 2,
      state: 'pending-held',
      reasons: [HELD_REASON],
    });
  });

  test('refuses new jobs when too many are open, in total and per computer', () => {
    const book = new IppJobBook(new FakeClock());
    created(book);
    created(book);
    expect(book.create(NEW_JOB).status).toBe('client-busy');
    created(book, { client: '192.168.1.24' });
    created(book, { client: '192.168.1.25' });
    expect(book.create({ ...NEW_JOB, client: '192.168.1.26' }).status).toBe('busy');
    expect(book.activeCount()).toBe(IPP_JOB_LIMITS.active);
  });

  test('moves a job from held to completed', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const job = created(book, { held: true });
    expect(book.start(job.id)).toBe(false);
    book.release(job.id);
    clock.advance(1_000);
    expect(book.start(job.id)).toBe(true);
    book.progress(job.id, 2);
    book.finish(job.id, 'completed', ['job-completed-successfully'], '已发送到打印机');
    expect(book.get(job.id)).toMatchObject({ state: 'completed', impressions: 2, processingAt: job.createdAt + 1_000 });
    expect(book.activeCount()).toBe(0);
  });

  test('cancels waiting jobs at once and asks running ones to stop', () => {
    const book = new IppJobBook(new FakeClock());
    const waiting = created(book);
    const running = created(book, { client: '192.168.1.24' });
    book.start(running.id);
    expect(book.cancel(waiting.id, '192.168.1.99')).toBe('not-owner');
    expect(book.cancel(waiting.id, NEW_JOB.client)).toBe('canceled');
    expect(book.get(waiting.id)?.state).toBe('canceled');
    expect(book.cancel(running.id, '192.168.1.24')).toBe('requested');
    expect(book.get(running.id)).toMatchObject({ state: 'processing', cancelRequested: true });
    expect(book.cancel(waiting.id, NEW_JOB.client)).toBe('finished');
    expect(book.cancel(99, NEW_JOB.client)).toBe('not-found');
  });

  test('lists open jobs oldest first and finished jobs newest first', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const first = created(book);
    const second = created(book, { client: '192.168.1.24' });
    created(book, { printerKey: '100x150', client: '192.168.1.25' });
    expect(book.list('60x40', 'not-completed', null).map((job) => job.id)).toEqual([first.id, second.id]);
    book.finish(first.id, 'completed', ['job-completed-successfully'], '');
    clock.advance(1);
    book.finish(second.id, 'aborted', ['aborted-by-system'], '');
    expect(book.list('60x40', 'completed', null).map((job) => job.id)).toEqual([second.id, first.id]);
    expect(book.list('60x40', 'completed', 1).map((job) => job.id)).toEqual([second.id]);
  });

  test('forgets finished jobs after an hour', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const job = created(book);
    book.finish(job.id, 'completed', [], '');
    clock.advance(IPP_JOB_LIMITS.finishedMs + 1);
    created(book, { client: '192.168.1.24' });
    expect(book.get(job.id)).toBeNull();
  });

  test('hands out copies that callers cannot change', () => {
    const book = new IppJobBook(new FakeClock());
    const job = created(book);
    job.state = 'completed';
    expect(book.get(job.id)?.state).toBe('pending');
  });
});

describe('jobAttributes', () => {
  test('describes a job with times counted from when sharing started', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const startedAt = clock.now();
    clock.advance(5_000);
    const job = created(book);
    const attributes = jobAttributes(job, {
      printerUri: 'ipp://192.168.1.10:8631/printers/60x40',
      startedAt,
      nowMs: startedAt + 7_000,
    });
    expect(integerValue(findAttribute(attributes, 'job-id'))).toBe(1);
    expect(stringValue(findAttribute(attributes, 'job-uri'))).toBe('ipp://192.168.1.10:8631/printers/60x40/jobs/1');
    expect(integerValue(findAttribute(attributes, 'job-state'))).toBe(3);
    expect(integerValue(findAttribute(attributes, 'time-at-creation'))).toBe(5);
    expect(integerValue(findAttribute(attributes, 'job-printer-up-time'))).toBe(7);
    expect(findAttribute(attributes, 'time-at-processing')?.values).toEqual([{ kind: 'out-of-band', tag: VALUE_TAGS.noValue }]);
  });
});

describe('jobIdFromUri', () => {
  test('reads the id at the end of a job URI', () => {
    expect(jobIdFromUri('ipp://h:8631/printers/60x40/jobs/12')).toBe(12);
    expect(jobIdFromUri('ipp://h:8631/printers/60x40')).toBeNull();
    expect(jobIdFromUri(null)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/ipp/ipp-job-book.test.ts`
Expected: FAIL，`Cannot find module './ipp-job-book'`。

- [ ] **Step 3: 实现**

```ts
// src/core/ipp/ipp-job-book.ts
import type { Clock } from '../types';
import { enumAttr, integerAttr, keywordAttr, nameAttr, outOfBandAttr, textAttr, uriAttr } from './ipp-attributes';
import type { IppAttribute } from './ipp-codec';
import { JOB_STATE, VALUE_TAGS } from './ipp-constants';

export const IPP_JOB_LIMITS = {
  /** 收下还没结束的任务（含等确认的）最多 4 个：每个文档最多 50MB 在内存里，4 个是 200MB；几台电脑同时打标签够用。 */
  active: 4,
  /** 每台电脑最多 2 个：一台电脑出错反复提交时，别的电脑照样能打。 */
  activePerClient: 2,
  /** 结束的任务留 100 个、最多 1 小时给对方查结果：打印队列看到结束就不再查了。 */
  finished: 100,
  finishedMs: 60 * 60_000,
} as const;

/** 等这台电脑上的操作员允许（IANA 注册的 job-state-reasons 关键字）。 */
export const HELD_REASON = 'job-held-for-authorization';
/** job-id 是 1–2^31-1 的整数（RFC 8011 §5.3.2），用到头就回到 1。 */
export const MAX_JOB_ID = 2_147_483_647;
const MS_PER_SECOND = 1_000;
const BYTES_PER_KB = 1024;
const NO_REASON = 'none';
const QUEUED_MESSAGE = '排队中';
const HELD_MESSAGE = '等那台电脑上的操作员点「允许」';

export type IppJobState = keyof typeof JOB_STATE;
type FinishedState = 'completed' | 'aborted' | 'canceled';
const FINISHED_STATES: ReadonlySet<IppJobState> = new Set<IppJobState>(['completed', 'aborted', 'canceled']);

export interface IppJob {
  id: number;
  /** 哪台共享打印机（纸张键）。 */
  printerKey: string;
  /** job-name（已去掉控制字符、截短）。 */
  name: string;
  /** requesting-user-name；对方没给时为空。 */
  user: string;
  /** 对方的 IPv4 地址。 */
  client: string;
  sizeBytes: number;
  state: IppJobState;
  reasons: string[];
  message: string;
  createdAt: number;
  processingAt: number | null;
  completedAt: number | null;
  /** 已交给打印队列的张数（job-impressions-completed）。 */
  impressions: number;
  /** 处理中被取消：处理的一方看到就停下，把状态记为 canceled。 */
  cancelRequested: boolean;
}

export interface NewIppJob {
  printerKey: string;
  name: string;
  user: string;
  client: string;
  sizeBytes: number;
  /** 新电脑第一次打印：先停着等操作员允许。 */
  held: boolean;
}

export type CreateResult = { status: 'created'; job: IppJob } | { status: 'busy' } | { status: 'client-busy' };
export type CancelResult = 'canceled' | 'requested' | 'not-found' | 'not-owner' | 'finished';

/**
 * 局域网共享收下的任务。只在内存里：程序重启后对方的打印队列查不到旧任务，会按「任务没了」处理；
 * 打印记录才是长期留存的。拿出去的都是副本，状态只经这里的方法改。
 */
export class IppJobBook {
  private readonly jobs = new Map<number, IppJob>();
  private nextId = 1;

  constructor(private readonly clock: Clock) {}

  create(input: NewIppJob): CreateResult {
    this.prune();
    const active = [...this.jobs.values()].filter(isActive);
    if (active.length >= IPP_JOB_LIMITS.active) {
      return { status: 'busy' };
    }
    if (active.filter((job) => job.client === input.client).length >= IPP_JOB_LIMITS.activePerClient) {
      return { status: 'client-busy' };
    }
    // held 只是建任务时的参数，不留在任务上。
    const { held, ...fields } = input;
    const job: IppJob = {
      ...fields,
      id: this.nextId,
      state: held ? 'pending-held' : 'pending',
      reasons: [held ? HELD_REASON : NO_REASON],
      message: held ? HELD_MESSAGE : QUEUED_MESSAGE,
      createdAt: this.clock.now(),
      processingAt: null,
      completedAt: null,
      impressions: 0,
      cancelRequested: false,
    };
    this.nextId = this.nextId >= MAX_JOB_ID ? 1 : this.nextId + 1;
    this.jobs.set(job.id, job);
    return { status: 'created', job: copy(job) };
  }

  get(id: number): IppJob | null {
    const job = this.jobs.get(id);
    return job === undefined ? null : copy(job);
  }

  /** not-completed：排着的和处理中的，先来的在前；completed：结束的，最近结束的在前。limit 为 null 不限。 */
  list(printerKey: string, which: 'completed' | 'not-completed', limit: number | null): IppJob[] {
    this.prune();
    const jobs = [...this.jobs.values()].filter(
      (job) => job.printerKey === printerKey && (which === 'completed' ? !isActive(job) : isActive(job)),
    );
    jobs.sort((a, b) => (which === 'completed' ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : a.id - b.id));
    return jobs.slice(0, limit ?? jobs.length).map(copy);
  }

  /** 操作员允许了：从 pending-held 回到 pending。 */
  release(id: number): void {
    const job = this.jobs.get(id);
    if (job?.state === 'pending-held') {
      job.state = 'pending';
      job.reasons = [NO_REASON];
      job.message = QUEUED_MESSAGE;
    }
  }

  /** 开始处理；任务不在 pending（等确认时被取消了、还在等确认）返回 false。 */
  start(id: number): boolean {
    const job = this.jobs.get(id);
    if (job?.state !== 'pending') {
      return false;
    }
    job.state = 'processing';
    job.reasons = ['job-printing'];
    job.message = '正在打印';
    job.processingAt = this.clock.now();
    return true;
  }

  progress(id: number, impressions: number): void {
    const job = this.jobs.get(id);
    if (job !== undefined) {
      job.impressions = impressions;
    }
  }

  finish(id: number, state: FinishedState, reasons: string[], message: string): void {
    const job = this.jobs.get(id);
    if (job === undefined || FINISHED_STATES.has(job.state)) {
      return;
    }
    job.state = state;
    job.reasons = reasons.length > 0 ? reasons : [NO_REASON];
    job.message = message;
    job.completedAt = this.clock.now();
  }

  /** 只有交任务的那台电脑能取消（RFC 8011 §4.3.3：只有提交者或操作员）。 */
  cancel(id: number, client: string): CancelResult {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return 'not-found';
    }
    if (job.client !== client) {
      return 'not-owner';
    }
    if (FINISHED_STATES.has(job.state)) {
      return 'finished';
    }
    if (job.state === 'processing') {
      job.cancelRequested = true;
      return 'requested';
    }
    this.finish(id, 'canceled', ['job-canceled-by-user'], '已取消');
    return 'canceled';
  }

  isCancelRequested(id: number): boolean {
    return this.jobs.get(id)?.cancelRequested ?? false;
  }

  activeCount(): number {
    return [...this.jobs.values()].filter(isActive).length;
  }

  activeFor(printerKey: string): number {
    return [...this.jobs.values()].filter((job) => job.printerKey === printerKey && isActive(job)).length;
  }

  private prune(): void {
    const oldest = this.clock.now() - IPP_JOB_LIMITS.finishedMs;
    const finished = [...this.jobs.values()]
      .filter((job) => !isActive(job))
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    for (const [index, job] of finished.entries()) {
      if (index >= IPP_JOB_LIMITS.finished || (job.completedAt ?? 0) < oldest) {
        this.jobs.delete(job.id);
      }
    }
  }
}

function isActive(job: IppJob): boolean {
  return !FINISHED_STATES.has(job.state);
}

function copy(job: IppJob): IppJob {
  return { ...job, reasons: [...job.reasons] };
}

/** 拼任务网址、算时间用的。 */
export interface JobContext {
  printerUri: string;
  /** 共享服务启动的时刻：IPP 的时间都按「启动以来的秒数」算（RFC 8011 §5.3.14）。 */
  startedAt: number;
  nowMs: number;
}

export function jobUri(printerUri: string, id: number): string {
  return `${printerUri}/jobs/${id}`;
}

const JOB_URI_ID = /\/jobs\/([1-9]\d{0,9})$/;

/** 任务网址末尾的编号；不是任务网址返回 null。 */
export function jobIdFromUri(uri: string | null): number | null {
  const match = uri === null ? null : JOB_URI_ID.exec(uri);
  const id = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(id) && id <= MAX_JOB_ID ? id : null;
}

/** 一个任务的全部属性（RFC 8011 §5.3）。 */
export function jobAttributes(job: IppJob, context: JobContext): IppAttribute[] {
  const seconds = (at: number) => Math.max(0, Math.floor((at - context.startedAt) / MS_PER_SECOND));
  const time = (name: string, at: number | null) =>
    at === null ? outOfBandAttr(name, VALUE_TAGS.noValue) : integerAttr(name, seconds(at));
  return [
    integerAttr('job-id', job.id),
    uriAttr('job-uri', jobUri(context.printerUri, job.id)),
    uriAttr('job-printer-uri', context.printerUri),
    nameAttr('job-name', job.name),
    nameAttr('job-originating-user-name', job.user === '' ? '—' : job.user),
    enumAttr('job-state', JOB_STATE[job.state]),
    keywordAttr('job-state-reasons', ...job.reasons),
    textAttr('job-state-message', job.message),
    integerAttr('job-impressions-completed', job.impressions),
    integerAttr('job-k-octets', Math.ceil(job.sizeBytes / BYTES_PER_KB)),
    integerAttr('time-at-creation', seconds(job.createdAt)),
    time('time-at-processing', job.processingAt),
    time('time-at-completed', job.completedAt),
    integerAttr('job-printer-up-time', seconds(context.nowMs)),
  ];
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/ipp`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/ipp/ipp-job-book.ts src/core/ipp/ipp-job-book.test.ts
git commit -m "feat(ipp): keep shared print jobs and their states" -m "Jobs from LAN clients are held in memory with caps on open jobs in total and per computer; finished jobs stay an hour for clients to query. Only the submitting computer may cancel, a running job is asked to stop, and callers always get copies." -m "$TRAILER"
```

---

### Task 7: 六个操作

**Files:**
- Create: `src/core/ipp/ipp-operations.ts`、`src/core/ipp/ipp-operations.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/ipp/ipp-operations.test.ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../testing/fake-clock';
import {
  booleanAttr,
  integerAttr,
  integerValue,
  keywordAttr,
  mimeTypeAttr,
  nameAttr,
  stringValue,
  stringValues,
  uriAttr,
} from './ipp-attributes';
import { GROUP_TAGS, OPERATIONS, STATUS } from './ipp-constants';
import { IppJobBook } from './ipp-job-book';
import { handleIppRequest, IPP_MESSAGES, type IppRequestContext, UNTITLED_JOB } from './ipp-operations';
import {
  attributeIn,
  ippRequest,
  MINIMAL_PDF,
  TEST_MORE_INFO_URI,
  TEST_PRINTER_URI,
  testPrinter,
} from './testing/ipp-requests';

function createContext(overrides: Partial<IppRequestContext> = {}): IppRequestContext {
  const clock = new FakeClock();
  return {
    printer: testPrinter(),
    printerUri: TEST_PRINTER_URI,
    moreInfoUri: TEST_MORE_INFO_URI,
    authentication: 'none',
    client: '192.168.1.23',
    decision: 'allowed',
    book: new IppJobBook(clock),
    pathJobId: null,
    startedAt: clock.now(),
    nowMs: clock.now(),
    ...overrides,
  };
}

const printJob = (options: Parameters<typeof ippRequest>[1] = {}) => ippRequest(OPERATIONS.printJob, options);

describe('handleIppRequest envelope', () => {
  test('answers IPP 1.x with 1.1 and 2.x with 2.0', () => {
    const context = createContext();
    const v1 = handleIppRequest(ippRequest(OPERATIONS.getPrinterAttributes, { version: { major: 1, minor: 0 } }), new Uint8Array(), context);
    expect(v1.response.version).toEqual({ major: 1, minor: 1 });
    const v2 = handleIppRequest(ippRequest(OPERATIONS.getPrinterAttributes, { version: { major: 2, minor: 2 } }), new Uint8Array(), context);
    expect(v2.response.version).toEqual({ major: 2, minor: 0 });
  });

  test('refuses other versions, a bad envelope, other charsets and unknown operations', () => {
    const context = createContext();
    const code = (message: Parameters<typeof handleIppRequest>[0]) =>
      handleIppRequest(message, new Uint8Array(), context).response.code;
    expect(code(ippRequest(OPERATIONS.getPrinterAttributes, { version: { major: 3, minor: 0 } }))).toBe(STATUS.versionNotSupported);
    expect(code(ippRequest(OPERATIONS.getPrinterAttributes, { requestId: 0 }))).toBe(STATUS.badRequest);
    const noCharset = ippRequest(OPERATIONS.getPrinterAttributes);
    noCharset.groups[0]?.attributes.shift();
    expect(code(noCharset)).toBe(STATUS.badRequest);
    const latin1 = ippRequest(OPERATIONS.getPrinterAttributes);
    const charset = latin1.groups[0]?.attributes[0];
    if (charset !== undefined) {
      charset.values = [{ kind: 'string', tag: 0x47, value: 'iso-8859-1' }];
    }
    expect(code(latin1)).toBe(STATUS.charsetNotSupported);
    expect(code(ippRequest(0x0005))).toBe(STATUS.operationNotSupported);
  });

  test('echoes the request id and answers in Chinese UTF-8', () => {
    const { response } = handleIppRequest(ippRequest(OPERATIONS.getPrinterAttributes, { requestId: 42 }), new Uint8Array(), createContext());
    expect(response.requestId).toBe(42);
    expect(stringValue(attributeIn(response, GROUP_TAGS.operation, 'attributes-charset'))).toBe('utf-8');
    expect(stringValue(attributeIn(response, GROUP_TAGS.operation, 'attributes-natural-language'))).toBe('zh-cn');
  });
});

describe('Get-Printer-Attributes', () => {
  test('returns the requested printer attributes', () => {
    const { response } = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes, { operation: [keywordAttr('requested-attributes', 'printer-name', 'media-default')] }),
      new Uint8Array(),
      createContext(),
    );
    expect(response.code).toBe(STATUS.ok);
    const printer = response.groups.find((group) => group.tag === GROUP_TAGS.printer);
    expect(printer?.attributes.map((item) => item.name)).toEqual(['media-default', 'printer-name']);
  });

  test('says the printer is gone when its paper is no longer shared', () => {
    const { response } = handleIppRequest(ippRequest(OPERATIONS.getPrinterAttributes), new Uint8Array(), createContext({ printer: null }));
    expect(response.code).toBe(STATUS.notFound);
  });

  test('needs a printer-uri', () => {
    const { response } = handleIppRequest(ippRequest(OPERATIONS.getPrinterAttributes, { printerUri: null }), new Uint8Array(), createContext());
    expect(response.code).toBe(STATUS.badRequest);
  });
});

describe('Print-Job', () => {
  test('accepts a document from an allowed computer', () => {
    const context = createContext();
    const outcome = handleIppRequest(
      printJob({ operation: [nameAttr('job-name', '面单'), nameAttr('requesting-user-name', 'zhang')], job: [integerAttr('copies', 2)] }),
      MINIMAL_PDF,
      context,
    );
    expect(outcome.response.code).toBe(STATUS.ok);
    expect(integerValue(attributeIn(outcome.response, GROUP_TAGS.job, 'job-state'))).toBe(3);
    expect(stringValue(attributeIn(outcome.response, GROUP_TAGS.job, 'job-uri'))).toBe(`${TEST_PRINTER_URI}/jobs/1`);
    expect(outcome.accepted).toMatchObject({
      job: { id: 1, name: '面单', user: 'zhang', client: '192.168.1.23', state: 'pending' },
      document: { format: 'application/pdf', copies: 2 },
      needsApproval: false,
    });
  });

  test('holds a job from a new computer until the operator answers', () => {
    const outcome = handleIppRequest(printJob(), MINIMAL_PDF, createContext({ decision: 'ask' }));
    expect(integerValue(attributeIn(outcome.response, GROUP_TAGS.job, 'job-state'))).toBe(4);
    expect(stringValues(attributeIn(outcome.response, GROUP_TAGS.job, 'job-state-reasons'))).toEqual(['job-held-for-authorization']);
    expect(outcome.accepted?.needsApproval).toBe(true);
    expect(outcome.accepted?.job.name).toBe(UNTITLED_JOB);
  });

  test('refuses a computer the operator turned down', () => {
    const outcome = handleIppRequest(printJob(), MINIMAL_PDF, createContext({ decision: 'denied' }));
    expect(outcome.response.code).toBe(STATUS.forbidden);
    expect(stringValue(attributeIn(outcome.response, GROUP_TAGS.operation, 'status-message'))).toBe(IPP_MESSAGES.denied);
    expect(outcome.accepted).toBeNull();
  });

  test('checks the document', () => {
    const context = createContext();
    const code = (message: Parameters<typeof handleIppRequest>[0], data: Uint8Array) =>
      handleIppRequest(message, data, context).response.code;
    expect(code(printJob(), new Uint8Array())).toBe(STATUS.badRequest);
    expect(code(printJob(), new TextEncoder().encode('%!PS'))).toBe(STATUS.documentFormatNotSupported);
    expect(code(printJob({ operation: [mimeTypeAttr('document-format', 'application/postscript')] }), MINIMAL_PDF)).toBe(
      STATUS.documentFormatNotSupported,
    );
    expect(code(printJob({ operation: [mimeTypeAttr('document-format', 'image/jpeg')] }), MINIMAL_PDF)).toBe(
      STATUS.documentFormatError,
    );
    expect(code(printJob({ operation: [keywordAttr('compression', 'gzip')] }), MINIMAL_PDF)).toBe(STATUS.compressionNotSupported);
  });

  test('substitutes unsupported settings unless fidelity is asked for', () => {
    const lenient = handleIppRequest(
      printJob({ job: [integerAttr('copies', 150), keywordAttr('sides', 'two-sided-long-edge'), keywordAttr('job-sheets', 'standard')] }),
      MINIMAL_PDF,
      createContext(),
    );
    expect(lenient.response.code).toBe(STATUS.okIgnoredOrSubstituted);
    expect(lenient.accepted?.document.copies).toBe(99);
    const unsupported = lenient.response.groups.find((group) => group.tag === GROUP_TAGS.unsupported);
    expect(unsupported?.attributes.map((item) => item.name)).toEqual(['copies', 'sides', 'job-sheets']);
    const strict = handleIppRequest(
      printJob({ operation: [booleanAttr('ipp-attribute-fidelity', true)], job: [keywordAttr('sides', 'two-sided-long-edge')] }),
      MINIMAL_PDF,
      createContext(),
    );
    expect(strict.response.code).toBe(STATUS.attributesOrValuesNotSupported);
    expect(strict.accepted).toBeNull();
  });

  test('says busy when too many jobs are open', () => {
    const context = createContext();
    for (const client of ['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.4']) {
      handleIppRequest(printJob(), MINIMAL_PDF, { ...context, client });
    }
    expect(handleIppRequest(printJob(), MINIMAL_PDF, { ...context, client: '192.168.1.5' }).response.code).toBe(STATUS.busy);
  });
});

describe('Validate-Job', () => {
  test('checks the settings without creating a job', () => {
    const context = createContext();
    const outcome = handleIppRequest(ippRequest(OPERATIONS.validateJob), new Uint8Array(), context);
    expect(outcome.response.code).toBe(STATUS.ok);
    expect(outcome.accepted).toBeNull();
    expect(context.book.activeCount()).toBe(0);
    expect(handleIppRequest(ippRequest(OPERATIONS.validateJob), new Uint8Array(), { ...context, decision: 'denied' }).response.code).toBe(
      STATUS.forbidden,
    );
  });
});

describe('Get-Jobs, Get-Job-Attributes and Cancel-Job', () => {
  function withJob() {
    const context = createContext();
    const outcome = handleIppRequest(printJob(), MINIMAL_PDF, context);
    const id = outcome.accepted?.job.id ?? 0;
    return { context, id };
  }

  test('lists open jobs with their ids and URIs by default', () => {
    const { context } = withJob();
    const { response } = handleIppRequest(ippRequest(OPERATIONS.getJobs), new Uint8Array(), context);
    const jobs = response.groups.filter((group) => group.tag === GROUP_TAGS.job);
    expect(jobs.map((group) => group.attributes.map((item) => item.name))).toEqual([['job-id', 'job-uri']]);
    const completed = handleIppRequest(ippRequest(OPERATIONS.getJobs, { operation: [keywordAttr('which-jobs', 'completed')] }), new Uint8Array(), context);
    expect(completed.response.groups.filter((group) => group.tag === GROUP_TAGS.job)).toHaveLength(0);
    const bad = handleIppRequest(ippRequest(OPERATIONS.getJobs, { operation: [keywordAttr('which-jobs', 'fetchable')] }), new Uint8Array(), context);
    expect(bad.response.code).toBe(STATUS.attributesOrValuesNotSupported);
  });

  test('describes one job found by id or by URI', () => {
    const { context, id } = withJob();
    const byId = handleIppRequest(ippRequest(OPERATIONS.getJobAttributes, { operation: [integerAttr('job-id', id)] }), new Uint8Array(), context);
    expect(stringValue(attributeIn(byId.response, GROUP_TAGS.job, 'job-name'))).toBe(UNTITLED_JOB);
    const byUri = handleIppRequest(
      ippRequest(OPERATIONS.getJobAttributes, { printerUri: null, operation: [uriAttr('job-uri', `${TEST_PRINTER_URI}/jobs/${id}`)] }),
      new Uint8Array(),
      context,
    );
    expect(byUri.response.code).toBe(STATUS.ok);
    const missing = handleIppRequest(ippRequest(OPERATIONS.getJobAttributes, { operation: [integerAttr('job-id', 99)] }), new Uint8Array(), context);
    expect(missing.response.code).toBe(STATUS.notFound);
  });

  test('cancels only jobs from the same computer', () => {
    const { context, id } = withJob();
    const cancel = ippRequest(OPERATIONS.cancelJob, { operation: [integerAttr('job-id', id)] });
    expect(handleIppRequest(cancel, new Uint8Array(), { ...context, client: '192.168.1.99' }).response.code).toBe(STATUS.notAuthorized);
    expect(handleIppRequest(cancel, new Uint8Array(), context).response.code).toBe(STATUS.ok);
    expect(context.book.get(id)?.state).toBe('canceled');
    expect(handleIppRequest(cancel, new Uint8Array(), context).response.code).toBe(STATUS.notPossible);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/ipp/ipp-operations.test.ts`
Expected: FAIL，`Cannot find module './ipp-operations'`。

- [ ] **Step 3: 实现**

```ts
// src/core/ipp/ipp-operations.ts
import { PDF_LIMITS } from '../pdf/pdf-model';
import { AUTO_FORMAT, type DocumentFormat, isSupportedFormat, sniffFormat } from './document-format';
import {
  booleanValue,
  charsetAttr,
  findAttribute,
  integerValue,
  keywordAttr,
  languageAttr,
  mimeTypeAttr,
  stringValue,
  stringValues,
  textAttr,
} from './ipp-attributes';
import type { IppAttribute, IppGroup, IppMessage, IppVersion } from './ipp-codec';
import { GROUP_TAGS, IPP_CHARSET, IPP_LANGUAGE, OPERATIONS, STATUS } from './ipp-constants';
import { type IppJob, type IppJobBook, type JobContext, jobAttributes, jobIdFromUri } from './ipp-job-book';
import { IPP_COPIES_MAX, type PrinterContext, printerAttributes, selectAttributes } from './printer-attributes';
import type { SharedPrinter } from './shared-printer';

/** 这台电脑对来请求的电脑的态度：allowed = 记住了允许；denied = 记住了拒绝；ask = 第一次来，打印前要问操作员。 */
export type ClientDecision = 'allowed' | 'denied' | 'ask';

export interface IppRequestContext {
  /** 网址指向的共享打印机；没有这台（纸张不再分配打印机）时为 null。 */
  printer: SharedPrinter | null;
  /** 按对方请求时用的主机拼的网址。 */
  printerUri: string;
  moreInfoUri: string;
  /** basic = 设了共享密码。 */
  authentication: 'none' | 'basic';
  /** 对方的 IPv4 地址。 */
  client: string;
  decision: ClientDecision;
  book: IppJobBook;
  /** POST 到任务网址（/printers/60x40/jobs/12）时网址里的编号。 */
  pathJobId: number | null;
  /** 共享服务启动的时刻和现在（毫秒）。 */
  startedAt: number;
  nowMs: number;
}

/** 收下的文档：认出来的格式、字节、份数（1–99）。 */
export interface AcceptedDocument {
  format: DocumentFormat;
  data: Uint8Array;
  copies: number;
}

export interface AcceptedPrint {
  job: IppJob;
  document: AcceptedDocument;
  /** 新电脑：处理之前先等操作员允许。 */
  needsApproval: boolean;
}

export interface IppOutcome {
  response: IppMessage;
  /** Print-Job 收下了文档；其余为 null。 */
  accepted: AcceptedPrint | null;
}

/** 任务名最多 100 个字（和 PDF 打印的文件名一样，打印记录里要放下）；用户名 64 个字，一行放得下。 */
const JOB_NAME_CHARS = PDF_LIMITS.fileNameChars;
const USER_NAME_CHARS = 64;
/** 对方没给任务名时，打印记录里显示的名字。 */
export const UNTITLED_JOB = '未命名文档';
const SUPPORTED_CHARSETS: ReadonlySet<string> = new Set(['utf-8', 'us-ascii']);
const VERSION_1: IppVersion = { major: 1, minor: 1 };
const VERSION_2: IppVersion = { major: 2, minor: 0 };
/**
 * 收下不报错的任务属性：纸就是这台共享打印机的纸，方向、颜色、质量、分辨率、缩放由程序按纸和打印机决定，
 * 客户端照例都会带这些，一律接受。份数和单双面另外核对。
 */
const ACCEPTED_JOB_ATTRIBUTES: ReadonlySet<string> = new Set([
  'media',
  'media-col',
  'orientation-requested',
  'print-color-mode',
  'print-quality',
  'printer-resolution',
  'print-scaling',
  'print-content-optimize',
  'print-rendering-intent',
  'output-bin',
  'finishings',
  'multiple-document-handling',
  'job-priority',
]);
/** Get-Jobs 默认只给这两项（RFC 8011 §4.2.6.1）。 */
const DEFAULT_JOB_LIST_ATTRIBUTES = ['job-id', 'job-uri'];
/** Print-Job 回复里的任务属性（RFC 8011 §4.2.1.2）。 */
const PRINT_JOB_REPLY_ATTRIBUTES = ['job-id', 'job-uri', 'job-state', 'job-state-reasons', 'job-state-message'];
// biome-ignore lint/suspicious/noControlCharactersInRegex: 名字里去掉一切控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** 给对方电脑看的原因（status-message 最长 255 字节：每句不超过 80 个字）。 */
export const IPP_MESSAGES = {
  badRequest: '请求格式不对',
  version: '只支持 IPP 1.1 和 2.0',
  charset: '只支持 UTF-8',
  operation: '不支持这个操作',
  noPrinter: '没有这台共享打印机：它的纸张可能已经不再分配打印机',
  noPrinterUri: '请求里缺少 printer-uri',
  format: '只能打印 PDF、JPEG、PNG 和 PWG / Apple 光栅',
  formatMismatch: '文档的内容和声明的格式不一致',
  compression: '不支持压缩的文档',
  noDocument: '没有收到文档',
  denied: '这台电脑没有被允许使用共享打印机：请那台电脑上的操作员在「局域网共享」页撤销拒绝',
  busy: '共享打印机正忙：稍后再试',
  clientBusy: '这台电脑交来的任务还没处理完：稍后再试',
  attributes: '有不支持的打印设置',
  noJob: '没有这个任务',
  notOwner: '只能取消自己电脑交来的任务',
  finished: '任务已经结束',
  whichJobs: 'which-jobs 只支持 completed 和 not-completed',
} as const;

interface Call {
  request: IppMessage;
  operation: readonly IppAttribute[];
  version: IppVersion;
  context: IppRequestContext;
}

interface JobRequest {
  name: string;
  user: string;
  declaredFormat: string;
  copies: number;
  unsupported: IppAttribute[];
}

/**
 * 处理一个 IPP 请求：Get-Printer-Attributes、Validate-Job、Print-Job、Get-Jobs、Get-Job-Attributes、Cancel-Job。
 * data 是属性之后的文档字节（只有 Print-Job 用）。请求不可信：每一项都核对，不对就回对应的状态码和中文原因。
 */
export function handleIppRequest(request: IppMessage, data: Uint8Array, context: IppRequestContext): IppOutcome {
  const version = request.version.major === 1 ? VERSION_1 : request.version.major === 2 ? VERSION_2 : null;
  if (version === null) {
    return reply(failure(VERSION_2, request.requestId, STATUS.versionNotSupported, IPP_MESSAGES.version));
  }
  const envelope = checkEnvelope(request);
  if (envelope !== null) {
    return reply(failure(version, request.requestId, envelope.status, envelope.message));
  }
  const call: Call = { request, operation: request.groups[0]?.attributes ?? [], version, context };
  switch (request.code) {
    case OPERATIONS.getPrinterAttributes:
      return reply(getPrinterAttributes(call));
    case OPERATIONS.validateJob:
      return reply(validateJob(call));
    case OPERATIONS.printJob:
      return printJob(call, data);
    case OPERATIONS.getJobs:
      return reply(getJobs(call));
    case OPERATIONS.getJobAttributes:
      return reply(getJobAttributes(call));
    case OPERATIONS.cancelJob:
      return reply(cancelJob(call));
    default:
      return reply(failure(version, request.requestId, STATUS.operationNotSupported, IPP_MESSAGES.operation));
  }
}

function reply(response: IppMessage): IppOutcome {
  return { response, accepted: null };
}

/** RFC 8011 §4.1.4：第一组是操作属性，前两个依次是 attributes-charset、attributes-natural-language；请求编号 1–2^31-1。 */
function checkEnvelope(request: IppMessage): { status: number; message: string } | null {
  const first = request.groups[0];
  const charset = first?.attributes[0];
  const language = first?.attributes[1];
  if (
    request.requestId < 1 ||
    first?.tag !== GROUP_TAGS.operation ||
    charset?.name !== 'attributes-charset' ||
    language?.name !== 'attributes-natural-language'
  ) {
    return { status: STATUS.badRequest, message: IPP_MESSAGES.badRequest };
  }
  const charsetName = stringValue(charset)?.toLowerCase();
  if (charsetName === undefined || !SUPPORTED_CHARSETS.has(charsetName)) {
    return { status: STATUS.charsetNotSupported, message: IPP_MESSAGES.charset };
  }
  return null;
}

function response(
  version: IppVersion,
  requestId: number,
  status: number,
  message: string | null,
  groups: IppGroup[] = [],
): IppMessage {
  const operation = [
    charsetAttr('attributes-charset', IPP_CHARSET),
    languageAttr('attributes-natural-language', IPP_LANGUAGE),
  ];
  if (message !== null) {
    operation.push(textAttr('status-message', message));
  }
  return { version, code: status, requestId, groups: [{ tag: GROUP_TAGS.operation, attributes: operation }, ...groups] };
}

function failure(
  version: IppVersion,
  requestId: number,
  status: number,
  message: string,
  unsupported: IppAttribute[] = [],
): IppMessage {
  return response(version, requestId, status, message, unsupportedGroups(unsupported));
}

function unsupportedGroups(unsupported: IppAttribute[]): IppGroup[] {
  return unsupported.length > 0 ? [{ tag: GROUP_TAGS.unsupported, attributes: unsupported }] : [];
}

function fail(call: Call, status: number, message: string, unsupported: IppAttribute[] = []): { failure: IppMessage } {
  return { failure: failure(call.version, call.request.requestId, status, message, unsupported) };
}

/** 要找打印机的操作先核对：请求里有 printer-uri（或 job-uri），网址指向的共享打印机在。 */
function targetPrinter(call: Call): { printer: SharedPrinter } | { failure: IppMessage } {
  if (findAttribute(call.operation, 'printer-uri') === undefined && findAttribute(call.operation, 'job-uri') === undefined) {
    return fail(call, STATUS.badRequest, IPP_MESSAGES.noPrinterUri);
  }
  if (call.context.printer === null) {
    return fail(call, STATUS.notFound, IPP_MESSAGES.noPrinter);
  }
  return { printer: call.context.printer };
}

function printerContextOf(context: IppRequestContext): PrinterContext {
  return {
    printerUri: context.printerUri,
    moreInfoUri: context.moreInfoUri,
    authentication: context.authentication,
    upTimeSeconds: Math.max(0, Math.floor((context.nowMs - context.startedAt) / 1_000)),
    nowMs: context.nowMs,
  };
}

function jobContextOf(context: IppRequestContext): JobContext {
  return { printerUri: context.printerUri, startedAt: context.startedAt, nowMs: context.nowMs };
}

function getPrinterAttributes(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const all = printerAttributes(target.printer, printerContextOf(call.context));
  const requested = stringValues(findAttribute(call.operation, 'requested-attributes'));
  return response(call.version, call.request.requestId, STATUS.ok, null, [
    { tag: GROUP_TAGS.printer, attributes: selectAttributes(all, requested) },
  ]);
}

/** 名字：去掉控制字符和首尾空白，按字符数截短。 */
function cleanName(value: string | null, maxChars: number): string {
  return [...(value ?? '').replace(CONTROL_CHARACTERS, '').trim()].slice(0, maxChars).join('');
}

/** Print-Job、Validate-Job 共用的核对（RFC 8011 §4.2.1.1、§4.2.3）。 */
function readJobRequest(call: Call): { job: JobRequest } | { failure: IppMessage } {
  const { operation, request } = call;
  const declaredFormat = (stringValue(findAttribute(operation, 'document-format')) ?? AUTO_FORMAT).toLowerCase();
  if (!isSupportedFormat(declaredFormat)) {
    return fail(call, STATUS.documentFormatNotSupported, IPP_MESSAGES.format, [mimeTypeAttr('document-format', declaredFormat)]);
  }
  const compression = stringValue(findAttribute(operation, 'compression'));
  if (compression !== null && compression !== 'none') {
    return fail(call, STATUS.compressionNotSupported, IPP_MESSAGES.compression, [keywordAttr('compression', compression)]);
  }
  const unsupported: IppAttribute[] = [];
  let copies = 1;
  const jobGroup = request.groups.find((group) => group.tag === GROUP_TAGS.job)?.attributes ?? [];
  for (const attribute of jobGroup) {
    if (attribute.name === 'copies') {
      const requested = integerValue(attribute);
      copies = Math.min(IPP_COPIES_MAX, Math.max(1, requested ?? 1));
      if (requested !== copies) {
        unsupported.push(attribute);
      }
    } else if (attribute.name === 'sides') {
      if (stringValue(attribute) !== 'one-sided') {
        unsupported.push(attribute);
      }
    } else if (!ACCEPTED_JOB_ATTRIBUTES.has(attribute.name)) {
      unsupported.push(attribute);
    }
  }
  if (unsupported.length > 0 && booleanValue(findAttribute(operation, 'ipp-attribute-fidelity')) === true) {
    return fail(call, STATUS.attributesOrValuesNotSupported, IPP_MESSAGES.attributes, unsupported);
  }
  const name = cleanName(stringValue(findAttribute(operation, 'job-name')), JOB_NAME_CHARS);
  return {
    job: {
      name: name === '' ? UNTITLED_JOB : name,
      user: cleanName(stringValue(findAttribute(operation, 'requesting-user-name')), USER_NAME_CHARS),
      declaredFormat,
      copies,
      unsupported,
    },
  };
}

/** 有被替换掉的设置时状态是 successful-ok-ignored-or-substituted-attributes，并列出它们。 */
function accepted(call: Call, unsupported: IppAttribute[], groups: IppGroup[]): IppMessage {
  const status = unsupported.length > 0 ? STATUS.okIgnoredOrSubstituted : STATUS.ok;
  return response(call.version, call.request.requestId, status, null, [...unsupportedGroups(unsupported), ...groups]);
}

function validateJob(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const parsed = readJobRequest(call);
  if ('failure' in parsed) {
    return parsed.failure;
  }
  if (call.context.decision === 'denied') {
    return failure(call.version, call.request.requestId, STATUS.forbidden, IPP_MESSAGES.denied);
  }
  return accepted(call, parsed.job.unsupported, []);
}

function printJob(call: Call, data: Uint8Array): IppOutcome {
  const { context } = call;
  const target = targetPrinter(call);
  if ('failure' in target) {
    return reply(target.failure);
  }
  const parsed = readJobRequest(call);
  if ('failure' in parsed) {
    return reply(parsed.failure);
  }
  if (context.decision === 'denied') {
    return reply(fail(call, STATUS.forbidden, IPP_MESSAGES.denied).failure);
  }
  if (data.length === 0) {
    return reply(fail(call, STATUS.badRequest, IPP_MESSAGES.noDocument).failure);
  }
  // 按文件头认格式；客户端声明了具体格式却对不上，按坏文档拒绝（不猜它想打什么）。
  const format = sniffFormat(data);
  if (format === null) {
    return reply(fail(call, STATUS.documentFormatNotSupported, IPP_MESSAGES.format).failure);
  }
  if (parsed.job.declaredFormat !== AUTO_FORMAT && parsed.job.declaredFormat !== format) {
    return reply(fail(call, STATUS.documentFormatError, IPP_MESSAGES.formatMismatch).failure);
  }
  const created = context.book.create({
    printerKey: target.printer.key,
    name: parsed.job.name,
    user: parsed.job.user,
    client: context.client,
    sizeBytes: data.length,
    held: context.decision === 'ask',
  });
  if (created.status !== 'created') {
    const message = created.status === 'busy' ? IPP_MESSAGES.busy : IPP_MESSAGES.clientBusy;
    return reply(fail(call, STATUS.busy, message).failure);
  }
  const jobGroup: IppGroup = {
    tag: GROUP_TAGS.job,
    attributes: selectJobAttributes(jobAttributes(created.job, jobContextOf(context)), PRINT_JOB_REPLY_ATTRIBUTES),
  };
  return {
    response: accepted(call, parsed.job.unsupported, [jobGroup]),
    accepted: {
      job: created.job,
      document: { format, data, copies: parsed.job.copies },
      needsApproval: context.decision === 'ask',
    },
  };
}

/** 任务属性按 requested-attributes 挑：all、job-description、job-template 都给全部，其余按名字。 */
export function selectJobAttributes(all: readonly IppAttribute[], requested: readonly string[]): IppAttribute[] {
  if (requested.some((name) => name === 'all' || name === 'job-description' || name === 'job-template')) {
    return [...all];
  }
  return all.filter((attribute) => requested.includes(attribute.name));
}

function getJobs(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const which = stringValue(findAttribute(call.operation, 'which-jobs')) ?? 'not-completed';
  if (which !== 'not-completed' && which !== 'completed') {
    return failure(call.version, call.request.requestId, STATUS.attributesOrValuesNotSupported, IPP_MESSAGES.whichJobs, [
      keywordAttr('which-jobs', which),
    ]);
  }
  const limit = integerValue(findAttribute(call.operation, 'limit'));
  const requested = stringValues(findAttribute(call.operation, 'requested-attributes')) ?? DEFAULT_JOB_LIST_ATTRIBUTES;
  const jobs = call.context.book.list(target.printer.key, which, limit !== null && limit > 0 ? limit : null);
  const groups = jobs.map(
    (job): IppGroup => ({
      tag: GROUP_TAGS.job,
      attributes: selectJobAttributes(jobAttributes(job, jobContextOf(call.context)), requested),
    }),
  );
  return response(call.version, call.request.requestId, STATUS.ok, null, groups);
}

/** 要操作的任务：job-id，或 job-uri 末尾的编号，或 POST 的网址里的编号；只认这台共享打印机的任务。 */
function targetJob(call: Call, printer: SharedPrinter): { job: IppJob } | { failure: IppMessage } {
  const id =
    integerValue(findAttribute(call.operation, 'job-id')) ??
    jobIdFromUri(stringValue(findAttribute(call.operation, 'job-uri'))) ??
    call.context.pathJobId;
  if (id === null) {
    return fail(call, STATUS.badRequest, IPP_MESSAGES.badRequest);
  }
  const job = call.context.book.get(id);
  if (job === null || job.printerKey !== printer.key) {
    return fail(call, STATUS.notFound, IPP_MESSAGES.noJob);
  }
  return { job };
}

function getJobAttributes(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const found = targetJob(call, target.printer);
  if ('failure' in found) {
    return found.failure;
  }
  const requested = stringValues(findAttribute(call.operation, 'requested-attributes')) ?? ['all'];
  return response(call.version, call.request.requestId, STATUS.ok, null, [
    { tag: GROUP_TAGS.job, attributes: selectJobAttributes(jobAttributes(found.job, jobContextOf(call.context)), requested) },
  ]);
}

function cancelJob(call: Call): IppMessage {
  const target = targetPrinter(call);
  if ('failure' in target) {
    return target.failure;
  }
  const found = targetJob(call, target.printer);
  if ('failure' in found) {
    return found.failure;
  }
  const { version, request } = call;
  switch (call.context.book.cancel(found.job.id, call.context.client)) {
    case 'canceled':
    case 'requested':
      return response(version, request.requestId, STATUS.ok, null);
    case 'not-owner':
      return failure(version, request.requestId, STATUS.notAuthorized, IPP_MESSAGES.notOwner);
    case 'finished':
      return failure(version, request.requestId, STATUS.notPossible, IPP_MESSAGES.finished);
    case 'not-found':
      return failure(version, request.requestId, STATUS.notFound, IPP_MESSAGES.noJob);
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/ipp`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/ipp/ipp-operations.ts src/core/ipp/ipp-operations.test.ts
git commit -m "feat(ipp): handle the six operations of a shared label printer" -m "Get-Printer-Attributes, Validate-Job, Print-Job, Get-Jobs, Get-Job-Attributes and Cancel-Job are checked against RFC 8011: version, charset, printer, format by content, compression, copies and fidelity. A job from a computer the operator has not answered yet is accepted but held, a refused computer gets forbidden, and every refusal carries a short Chinese reason." -m "$TRAILER"
```

---

### Task 8: 打印记录：来源「局域网共享」的电脑和用户（迁移 N）

一张 IPP 打来的标签带三样东西：PDF 那套 `PdfRef`（文件 = 任务名、页、第几张、缓存的位图编号——预览和重打直接用 PDF 打印的路径）、新的 `IppRef`（对方电脑的地址、用户名），以及规则名「局域网共享」。迁移 N 只加列、建两张新表（记住的电脑、共享密码摘要；存储类在 Task 13），不重建 jobs 表。

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/print-service.ts`、`src/core/print-service.test.ts`
- Create: `src/core/ipp/ipp-print.ts`、`src/core/ipp/ipp-print.test.ts`
- Modify: `src/main/storage/migrations.ts`、`src/main/storage/database.test.ts`
- Modify: `src/main/storage/sqlite-job-store.ts`、`src/main/storage/sqlite-job-store.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`、`src/renderer/src/lib/status-text.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/ipp/ipp-print.test.ts
import { describe, expect, test } from 'bun:test';
import { chooseIppCrop, ippFields } from './ipp-print';

const LABEL = { widthMm: 60, heightMm: 40 };

describe('chooseIppCrop', () => {
  test('prints the whole page when the client already laid it out on this paper', () => {
    expect(chooseIppCrop({ widthMm: 60.2, heightMm: 39.8 }, LABEL)).toBe('page');
    expect(chooseIppCrop({ widthMm: 40, heightMm: 60 }, LABEL)).toBe('page');
  });

  test('trims white space from other pages and from images', () => {
    expect(chooseIppCrop({ widthMm: 210, heightMm: 297 }, LABEL)).toBe('trim');
    expect(chooseIppCrop({ widthMm: 64, heightMm: 40 }, LABEL)).toBe('trim');
    expect(chooseIppCrop(null, LABEL)).toBe('trim');
  });
});

describe('ippFields', () => {
  test('adds the computer and the user to the PDF fields', () => {
    expect(ippFields('面单', 2, 1, { client: '192.168.1.23', user: 'zhang' })).toEqual([
      { name: '文件', value: '面单' },
      { name: '页码', value: '2' },
      { name: '第几张', value: '1' },
      { name: '电脑', value: '192.168.1.23' },
      { name: '用户', value: 'zhang' },
    ]);
    expect(ippFields('面单', 1, 1, { client: '192.168.1.23', user: '' }).map((field) => field.name)).not.toContain('用户');
  });
});
```

`print-service.test.ts` 末尾加（import 加 `IPP_RULE`）：

```ts
describe('PrintService.printFields for a LAN share', () => {
  const ipp = { client: '192.168.1.23', user: 'zhang' };
  const pdf = { file: '面单', page: 1, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' };

  test('records the computer and user and names the rule after LAN sharing', async () => {
    const { service, store, recorded } = createHarness();
    const result = await service.printFields({
      template: PICK_TEMPLATE,
      fields: [{ name: '文件', value: '面单' }],
      content: '面单 第 1 页第 1 张',
      source: 'ipp',
      caller: null,
      printerName: null,
      pdf,
      ipp,
    });
    expect(result.status).toBe('printed');
    expect(store.listRecent(1)[0]).toMatchObject({ source: 'ipp', pdf, ipp });
    expect(recorded.at(-1)?.scan).toMatchObject({ ruleId: IPP_RULE.id, ruleName: '局域网共享' });
  });

  test('names the rule after LAN sharing before PDF', () => {
    expect(fieldsRuleFor({ pdf, ipp })).toBe(IPP_RULE);
  });
});
```

（`createHarness`、`PICK_TEMPLATE`、`fieldsRuleFor` 是 PDF 打印计划留下的；名字不同就用文件里现成的那个。）

`database.test.ts` 末尾加：

```ts
describe('LAN sharing migration', () => {
  test('adds the computer and user columns and keeps every row', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, -1));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('a', 1, 'CL5640', 'P', 'desktop', 'printed', 0)",
    ).run();
    migrate(db);
    expect({ ...db.prepare("SELECT seq, ipp_client, ipp_user FROM jobs WHERE id = 'a'").get() }).toEqual({
      seq: 1,
      ipp_client: null,
      ipp_user: null,
    });
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, ipp_client, ipp_user) VALUES ('b', 2, '面单 第 1 页第 1 张', 'P', 'ipp', 'printed', 0, '192.168.1.23', 'zhang')",
    ).run();
    expect({ ...db.prepare("SELECT ipp_client FROM jobs WHERE id = 'b'").get() }).toEqual({ ipp_client: '192.168.1.23' });
    db.close();
  });

  test('keeps one decision per computer and at most one password', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO ipp_clients (address, decision, last_user, decided_at) VALUES ('192.168.1.23', 'allow', '', 1)").run();
    expect(() =>
      db.prepare("INSERT INTO ipp_clients (address, decision, last_user, decided_at) VALUES ('192.168.1.24', 'maybe', '', 1)").run(),
    ).toThrow();
    db.prepare("INSERT INTO ipp_share_password (id, salt, hash, updated_at) VALUES (1, x'00', x'00', 1)").run();
    expect(() => db.prepare("INSERT INTO ipp_share_password (id, salt, hash, updated_at) VALUES (2, x'00', x'00', 1)").run()).toThrow();
    db.close();
  });
});
```

`sqlite-job-store.test.ts` 的 `describe('SqliteJobStore')` 里加：

```ts
  test('keeps the computer and user of a LAN share job', () => {
    const store = new SqliteJobStore(db, 100);
    const ipp = { client: '192.168.1.23', user: '' };
    store.append(job(1, { source: 'ipp', ipp }));
    store.append(job(2));
    expect(store.listPage({ limit: 10 }).jobs.map((record) => record.ipp)).toEqual([undefined, ipp]);
  });
```

`status-text.test.ts` 的 `describe('describeJobMeta')` 加：

```ts
  test('shows the computer and user of a LAN share job', () => {
    const shared = { ...job, source: 'ipp' as const, printerName: 'P', forced: false, ipp: { client: '192.168.1.23', user: 'zhang' } };
    expect(describeJobMeta(shared)).toContain('局域网共享（192.168.1.23 zhang）');
    expect(describeJobMeta({ ...shared, ipp: { client: '192.168.1.23', user: '' } })).toContain('局域网共享（192.168.1.23）');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core src/main/storage src/renderer/src/lib/status-text.test.ts`
Expected: FAIL（`ipp-print` 不存在、`IPP_RULE` 没有导出、`ipp_client` 列不存在、记录里没有电脑和用户）。

- [ ] **Step 3: 实现**

`src/core/types.ts` 在 `PdfRef` 之后加：

```ts
/** 局域网共享（IPP）打来的一张：对方电脑的 IPv4 地址，和它报的用户名（requesting-user-name，可能为空）。 */
export interface IppRef {
  client: string;
  user: string;
}
```

`PrintRequest` 末尾加：

```ts
  /** 局域网共享打来的；其他入口没有。 */
  ipp?: IppRef;
```

`JobRecord` 末尾加：

```ts
  /** 局域网共享打来的：对方电脑的地址和用户名；其他来源没有。 */
  ipp?: IppRef;
```

```ts
// src/core/ipp/ipp-print.ts
import type { PaperSize } from '../../shared/paper-sizes';
import type { CropMode } from '../pdf/pdf-model';
import { pieceFields } from '../pdf/piece-template';
import type { ScanField } from '../scan/scan-result';
import type { IppRef } from '../types';

/**
 * 页面和纸的长、宽都差在 3mm 以内（正着或转 90°）就算「客户端已经按这张纸排好了」：
 * 驱动纸张按 0.1mm 存、PDF 的点换算成毫米有零点几毫米的误差，3mm 足够吸收，又远小于标签和 A4 的差别。
 */
export const SAME_PAPER_TOLERANCE_MM = 3;

/**
 * 收到的一页怎么放到纸上：已经是这张纸的大小就整页缩放（保留客户端的排版）；
 * 不是（A4 上的一张面单、截图、照片，page 为 null 表示不知道实际尺寸）就去掉四周空白再缩放。
 */
export function chooseIppCrop(page: PaperSize | null, paper: PaperSize): Extract<CropMode, 'page' | 'trim'> {
  if (page === null) {
    return 'trim';
  }
  const isClose = (a: number, b: number) => Math.abs(a - b) <= SAME_PAPER_TOLERANCE_MM;
  const straight = isClose(page.widthMm, paper.widthMm) && isClose(page.heightMm, paper.heightMm);
  const turned = isClose(page.widthMm, paper.heightMm) && isClose(page.heightMm, paper.widthMm);
  return straight || turned ? 'page' : 'trim';
}

/** 打印记录和打印结果通知里的字段：PDF 那三项（文件、页码、第几张），加上电脑和用户。 */
export function ippFields(jobName: string, page: number, piece: number, share: IppRef): ScanField[] {
  const fields = [...pieceFields(jobName, page, piece), { name: '电脑', value: share.client }];
  return share.user === '' ? fields : [...fields, { name: '用户', value: share.user }];
}
```

`src/core/print-service.ts`：

1. import 里加 `IppRef`（放进 `./types` 那一组）。
2. `PDF_RULE` 之后加：

```ts
/** 局域网共享的「规则」：备注变量 {规则} 和打印结果通知里显示为「局域网共享」。 */
export const IPP_RULE = { id: 'ipp', name: '局域网共享' } as const;
```

3. `fieldsRuleFor` 的参数类型加 `ipp?: unknown`，函数体最前面加（IPP 打来的也带着 PDF 的位图编号，先认它）：

```ts
  if (origin.ipp !== undefined) {
    return IPP_RULE;
  }
```

4. `FieldsPrint` 末尾加：

```ts
  /** 局域网共享打来的：写进打印记录；规则名记为「局域网共享」。 */
  ipp?: IppRef;
```

5. `printFields` 里 `pdf` 那段之后加 `if (input.ipp !== undefined) { request.ipp = input.ipp; }`；`finish` 里 `pdf` 那段之后加 `if (request.ipp !== undefined) { job.ipp = request.ipp; }`。

`src/main/storage/migrations.ts`：在最后一条之后、`];` 之前追加（注释开头写实际序号 N）：

```ts
  // N：局域网共享（IPP）。来源 ipp 在第 6 条已经加进 CHECK，这里不重建 jobs 表：
  // - jobs 加对方电脑的地址和用户名（两列要么都有、要么都没有，由 sqlite-job-store 的 toJobRecord 读出时核对）；
  // - ipp_clients：操作员对每台电脑的决定（允许 / 拒绝），按 IPv4 地址记；
  // - ipp_share_password：共享密码的 scrypt 摘要和盐（只一行），不存原文。
  `
  ALTER TABLE jobs ADD COLUMN ipp_client TEXT;
  ALTER TABLE jobs ADD COLUMN ipp_user TEXT;
  CREATE TABLE ipp_clients (
    address TEXT PRIMARY KEY,
    decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    last_user TEXT NOT NULL,
    decided_at INTEGER NOT NULL
  );
  CREATE TABLE ipp_share_password (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt BLOB NOT NULL,
    hash BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
```

`src/main/storage/sqlite-job-store.ts`：

1. `JOB_COLUMNS` 末尾（PDF 四列之后）加 `,\n  jobs.ipp_client AS ippClient, jobs.ipp_user AS ippUser`。
2. `insertJob` 的列表末尾加 `, ipp_client, ipp_user`，`VALUES` 末尾加 `, :ippClient, :ippUser`。
3. `append` 的参数对象末尾加：

```ts
        ippClient: job.ipp?.client ?? null,
        ippUser: job.ipp?.user ?? null,
```

4. `toJobRecord` 在 PDF 那段之后加：

```ts
  // 有电脑地址就必须有用户名（可以是空字符串）：readString 遇到 NULL 抛错，坏行不当成合法记录。
  if (row['ippClient'] !== null) {
    job.ipp = { client: readString(row, 'ippClient'), user: readString(row, 'ippUser') };
  }
```

（IPP 打来的记录都带 PDF 的位图编号，`listLastPrinted` 里 `pdf_bitmap IS NULL` 已经把它们排除在扫码防重复窗口之外，不用再改。若 `readString` 不接受空字符串，用 `typeof row['ippUser'] === 'string'` 核对后直接取。）

`src/renderer/src/lib/status-text.ts`：`SOURCE_LABELS` 没有 `ipp` 时加 `ipp: '局域网共享',`；在 `describeJobMeta` 之前加：

```ts
/** 局域网共享打来的：对方电脑的地址和用户名（括号里显示）；其他来源没有。 */
function ippSubmitter(job: JobRecord): string | null {
  return job.ipp === undefined ? null : [job.ipp.client, job.ipp.user].filter((part) => part !== '').join(' ');
}
```

`describeJobMeta` 开头加 `const submitterName = caller ?? ippSubmitter(job);`，把函数里原来用 `caller` 拼「来源（提交者）」的两处换成 `submitterName`（例如 `const submitter = job.source === 'history' ? \`原提交：${submitterName}\` : submitterName;` 和 `submitterName === null ? source : \`${source}（${submitter}）\``）。PDF 打印加的 `positionOf` 那段不动。

- [ ] **Step 4: 跑测试**

Run: `bun test src/core src/main/storage src/renderer/src/lib`
Expected: PASS。

- [ ] **Step 5: 检查后提交**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（已有来源的记录显示不变）。

```bash
git add src/core/types.ts src/core/print-service.ts src/core/print-service.test.ts src/core/ipp/ipp-print.ts src/core/ipp/ipp-print.test.ts src/main/storage src/renderer/src/lib/status-text.ts src/renderer/src/lib/status-text.test.ts
git commit -m "feat(records): record LAN share prints with the computer and user" -m "LAN share prints reuse the PDF piece reference for preview and reprint and add the client's address and user name; the rule is named LAN sharing. The migration only adds columns and creates the tables for remembered computers and the share password digest; the ipp source was already allowed. A page already laid out for the paper prints whole, anything else is trimmed first." -m "$TRAILER"
```

---

### Task 9: DNS 报文

mDNS 用的是普通的 DNS 报文（RFC 1035 §4），加两处变化（RFC 6762）：回答里类别字段的最高位是「缓存刷新」，问题里同一位是「要单播回答」。收到的报文来自局域网里的任何设备：名字压缩指针只许往前指、最多跳 16 次，每部分最多 64 条，长度不对整包丢掉（返回 null，不抛错：mDNS 上到处是别的设备的报文，坏一包不值得记日志）。编码不做名字压缩（报文小，最多十几台打印机），名字按段存（实例名里可以有空格和中文）。

**Files:**
- Create: `src/core/mdns/dns-message.ts`、`src/core/mdns/dns-message.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/mdns/dns-message.test.ts
import { describe, expect, test } from 'bun:test';
import { DNS_TYPES, type DnsMessage, decodeDnsMessage, encodeDnsMessage, sameName } from './dns-message';

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const label = (text: string): number[] => {
  const bytes = [...new TextEncoder().encode(text)];
  return [bytes.length, ...bytes];
};
/** 12 字节的头：编号、标志、四部分的条数。 */
const header = (questions: number, flags = 0): number[] => [...u16(0), ...u16(flags), ...u16(questions), 0, 0, 0, 0, 0, 0];

const RESPONSE: DnsMessage = {
  id: 0,
  isResponse: true,
  questions: [],
  answers: [
    { type: 'PTR', name: ['_ipp', '_tcp', 'local'], ttl: 4500, target: ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'] },
    {
      type: 'SRV',
      name: ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'],
      ttl: 120,
      cacheFlush: true,
      port: 8631,
      target: ['labelflash-1a2b3c4d', 'local'],
    },
    {
      type: 'TXT',
      name: ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'],
      ttl: 4500,
      cacheFlush: true,
      entries: [new TextEncoder().encode('txtvers=1'), new TextEncoder().encode('rp=printers/60x40')],
    },
  ],
  authorities: [],
  additionals: [{ type: 'A', name: ['labelflash-1a2b3c4d', 'local'], ttl: 120, cacheFlush: true, address: '192.168.1.10' }],
};

describe('encodeDnsMessage and decodeDnsMessage', () => {
  test('round-trip a response with PTR, SRV, TXT and A records', () => {
    expect(decodeDnsMessage(encodeDnsMessage(RESPONSE))).toEqual(RESPONSE);
  });

  test('write the response and authoritative flags and the cache-flush bit', () => {
    const bytes = encodeDnsMessage(RESPONSE);
    expect([bytes[2], bytes[3]]).toEqual([0x84, 0x00]);
    expect([bytes[6], bytes[7], bytes[10], bytes[11]]).toEqual([0, 3, 0, 1]);
  });

  test('refuse to encode a label over 63 bytes', () => {
    const message: DnsMessage = { ...RESPONSE, answers: [], additionals: [{ type: 'A', name: ['x'.repeat(64), 'local'], ttl: 1, cacheFlush: false, address: '1.2.3.4' }] };
    expect(() => encodeDnsMessage(message)).toThrow('bytes');
  });
});

describe('decodeDnsMessage', () => {
  test('reads questions with compressed names and the unicast bit', () => {
    // 第 1 个问题从第 12 字节开始；第 2 个问题的名字末尾用指针指回第 12 字节（_ipp._tcp.local）。
    const bytes = Uint8Array.from([
      ...header(2),
      ...label('_ipp'),
      ...label('_tcp'),
      ...label('local'),
      0,
      ...u16(DNS_TYPES.PTR),
      ...u16(0x8001),
      ...label('_universal'),
      ...label('_sub'),
      0xc0,
      12,
      ...u16(DNS_TYPES.PTR),
      ...u16(0x0001),
    ]);
    expect(decodeDnsMessage(bytes)?.questions).toEqual([
      { name: ['_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: true },
      { name: ['_universal', '_sub', '_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false },
    ]);
  });

  test('drops packets with pointer loops, forward pointers, long labels or missing bytes', () => {
    const question = (name: number[]) => Uint8Array.from([...header(1), ...name, ...u16(DNS_TYPES.PTR), ...u16(1)]);
    expect(decodeDnsMessage(question([0xc0, 12]))).toBeNull();
    expect(decodeDnsMessage(question([0xc0, 40]))).toBeNull();
    expect(decodeDnsMessage(question([64, ...new Array(64).fill(0x61), 0]))).toBeNull();
    expect(decodeDnsMessage(Uint8Array.from([...header(1), ...label('_ipp')]))).toBeNull();
    expect(decodeDnsMessage(Uint8Array.of(0, 1, 2))).toBeNull();
    expect(decodeDnsMessage(Uint8Array.from([...u16(0), ...u16(0), ...u16(65), 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  test('keeps records of other types only by name and type', () => {
    const bytes = Uint8Array.from([
      ...u16(0),
      ...u16(0x8400),
      0, 0, 0, 1, 0, 0, 0, 0,
      ...label('host'),
      ...label('local'),
      0,
      ...u16(47),
      ...u16(1),
      0, 0, 0, 120,
      ...u16(2),
      0, 0,
    ]);
    expect(decodeDnsMessage(bytes)?.answers).toEqual([{ type: 'OTHER', name: ['host', 'local'], ttl: 120, code: 47 }]);
  });
});

describe('sameName', () => {
  test('compares ASCII letters without case and everything else exactly', () => {
    expect(sameName(['_IPP', '_tcp', 'LOCAL'], ['_ipp', '_tcp', 'local'])).toBe(true);
    expect(sameName(['标签'], ['标签'])).toBe(true);
    expect(sameName(['_ipp', 'local'], ['_ipp', '_tcp', 'local'])).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/mdns`
Expected: FAIL，`Cannot find module './dns-message'`。

- [ ] **Step 3: 实现**

```ts
// src/core/mdns/dns-message.ts
/**
 * mDNS 用的 DNS 报文（RFC 1035 §4、RFC 6762）：只编解局域网共享要用的几种记录。
 * 收到的报文来自局域网里的任何设备，不可信：名字压缩只许往前指、跳转次数有上限，长度不对就整包丢掉（返回 null）。
 */

export const DNS_TYPES = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 } as const;
const CLASS_IN = 1;
/** 回答里类别字段的最高位是「缓存刷新」（RFC 6762 §10.2），问题里同一位是「要单播回答」（§5.4）。 */
const CLASS_TOP_BIT = 0x8000;
/** 标志位：这是回答（QR）、权威回答（AA）。 */
const FLAG_RESPONSE = 0x8000;
const FLAG_AUTHORITATIVE = 0x0400;
const HEADER_BYTES = 12;
/** 一段最长 63 字节、整个名字最长 255 字节（RFC 1035 §2.3.4）。 */
const MAX_LABEL_BYTES = 63;
const MAX_NAME_BYTES = 255;
/** 长度字节的高两位都是 1：压缩指针（RFC 1035 §4.1.4）。 */
const POINTER_FLAGS = 0xc0;
const POINTER_HIGH_MASK = 0x3f;
const IPV4_BYTES = 4;
/** 类型、类别各 2 字节，TTL 4 字节，数据长度 2 字节。 */
const RECORD_FIXED_BYTES = 10;
const QUESTION_FIXED_BYTES = 4;
/** SRV 的优先级、权重、端口各 2 字节。 */
const SRV_FIXED_BYTES = 6;
const MAX_TXT_ENTRY_BYTES = 255;

export const DNS_LIMITS = {
  /** 每一部分最多 64 条：局域网里正常的查询只有几条问题、十几条已知回答。 */
  records: 64,
  /** 一个名字最多跳 16 次压缩指针。 */
  pointerJumps: 16,
} as const;

/** 名字按段存：「60×40 标签 @ 前台」是一段，里面可以有空格、中文。 */
export type DnsName = readonly string[];

export interface DnsQuestion {
  name: DnsName;
  type: number;
  /** 对方要单播回答（QU 位）。 */
  unicastResponse: boolean;
}

interface RecordBase {
  name: DnsName;
  ttl: number;
}

export type DnsRecord =
  | (RecordBase & { type: 'A'; cacheFlush: boolean; address: string })
  | (RecordBase & { type: 'PTR'; target: DnsName })
  /** 优先级、权重都写 0。 */
  | (RecordBase & { type: 'SRV'; cacheFlush: boolean; port: number; target: DnsName })
  | (RecordBase & { type: 'TXT'; cacheFlush: boolean; entries: readonly Uint8Array[] })
  /** 本程序不用的类型：只留名字和类型（判断名字冲突用）。 */
  | (RecordBase & { type: 'OTHER'; code: number });

export interface DnsMessage {
  id: number;
  isResponse: boolean;
  questions: DnsQuestion[];
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** DNS 名字比较只对 ASCII 字母不分大小写（RFC 1035 §2.3.3、RFC 6762 §16）。 */
export function sameName(a: DnsName, b: DnsName): boolean {
  return a.length === b.length && a.every((part, index) => asciiLower(part) === asciiLower(b[index] ?? ''));
}

export function nameText(name: DnsName): string {
  return name.join('.');
}

export function typeCode(record: DnsRecord): number {
  switch (record.type) {
    case 'A':
      return DNS_TYPES.A;
    case 'PTR':
      return DNS_TYPES.PTR;
    case 'SRV':
      return DNS_TYPES.SRV;
    case 'TXT':
      return DNS_TYPES.TXT;
    case 'OTHER':
      return record.code;
  }
}

function pushU16(out: number[], value: number): void {
  out.push((value >> 8) & 0xff, value & 0xff);
}

function pushU32(out: number[], value: number): void {
  pushU16(out, Math.floor(value / 0x10000));
  pushU16(out, value & 0xffff);
}

function nameBytes(name: DnsName): number[] {
  const out: number[] = [];
  for (const part of name) {
    const bytes = UTF8_ENCODER.encode(part);
    if (bytes.length === 0 || bytes.length > MAX_LABEL_BYTES) {
      throw new Error(`DNS label "${part}" has ${bytes.length} bytes`);
    }
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  if (out.length > MAX_NAME_BYTES) {
    throw new Error(`DNS name ${nameText(name)} is longer than ${MAX_NAME_BYTES} bytes`);
  }
  return out;
}

function recordData(record: DnsRecord): number[] {
  switch (record.type) {
    case 'A':
      return record.address.split('.').map(Number);
    case 'PTR':
      return nameBytes(record.target);
    case 'SRV': {
      const out = [0, 0, 0, 0];
      pushU16(out, record.port);
      return [...out, ...nameBytes(record.target)];
    }
    case 'TXT': {
      // 空的 TXT 也要有一个零长度的字符串（RFC 6763 §6.1）。
      if (record.entries.length === 0) {
        return [0];
      }
      const out: number[] = [];
      for (const entry of record.entries) {
        if (entry.length > MAX_TXT_ENTRY_BYTES) {
          throw new Error(`TXT entry of ${entry.length} bytes`);
        }
        out.push(entry.length, ...entry);
      }
      return out;
    }
    case 'OTHER':
      throw new Error(`cannot encode a DNS record of type ${record.code}`);
  }
}

/**
 * 编一个 mDNS 报文（不压缩名字）。
 * @throws Error 名字、TXT 超长：是程序自己拼错了，快速失败
 */
export function encodeDnsMessage(message: DnsMessage): Uint8Array {
  const out: number[] = [];
  pushU16(out, message.id);
  pushU16(out, message.isResponse ? FLAG_RESPONSE | FLAG_AUTHORITATIVE : 0);
  for (const count of [message.questions.length, message.answers.length, message.authorities.length, message.additionals.length]) {
    pushU16(out, count);
  }
  for (const question of message.questions) {
    out.push(...nameBytes(question.name));
    pushU16(out, question.type);
    pushU16(out, CLASS_IN | (question.unicastResponse ? CLASS_TOP_BIT : 0));
  }
  for (const record of [...message.answers, ...message.authorities, ...message.additionals]) {
    out.push(...nameBytes(record.name));
    pushU16(out, typeCode(record));
    const cacheFlush = 'cacheFlush' in record && record.cacheFlush;
    pushU16(out, CLASS_IN | (cacheFlush ? CLASS_TOP_BIT : 0));
    pushU32(out, record.ttl);
    const data = recordData(record);
    pushU16(out, data.length);
    out.push(...data);
  }
  return Uint8Array.from(out);
}

/** 读一个（可能压缩的）名字；next 是名字之后的位置（遇到指针就是指针之后）。 */
function readName(bytes: Uint8Array, start: number): { labels: string[]; next: number } | null {
  const labels: string[] = [];
  let at = start;
  let next = -1;
  let jumps = 0;
  let total = 0;
  for (;;) {
    if (at >= bytes.length) {
      return null;
    }
    const length = bytes[at] ?? 0;
    if (length === 0) {
      return { labels, next: next < 0 ? at + 1 : next };
    }
    if ((length & POINTER_FLAGS) === POINTER_FLAGS) {
      if (at + 1 >= bytes.length) {
        return null;
      }
      const target = ((length & POINTER_HIGH_MASK) << 8) | (bytes[at + 1] ?? 0);
      if (next < 0) {
        next = at + 2;
      }
      // 只许往前指、跳的次数有上限：挡住指来指去的死循环。
      if (target >= at || jumps >= DNS_LIMITS.pointerJumps) {
        return null;
      }
      jumps += 1;
      at = target;
      continue;
    }
    if ((length & POINTER_FLAGS) !== 0 || length > MAX_LABEL_BYTES || at + 1 + length > bytes.length) {
      return null;
    }
    total += length + 1;
    if (total > MAX_NAME_BYTES) {
      return null;
    }
    try {
      labels.push(UTF8.decode(bytes.subarray(at + 1, at + 1 + length)));
    } catch {
      return null;
    }
    at += 1 + length;
  }
}

function readTxt(data: Uint8Array): Uint8Array[] | null {
  const entries: Uint8Array[] = [];
  let at = 0;
  while (at < data.length) {
    const length = data[at] ?? 0;
    if (at + 1 + length > data.length) {
      return null;
    }
    if (length > 0) {
      entries.push(data.slice(at + 1, at + 1 + length));
    }
    at += 1 + length;
  }
  return entries;
}

function readRecord(bytes: Uint8Array, view: DataView, start: number): { record: DnsRecord; next: number } | null {
  const name = readName(bytes, start);
  if (name === null || name.next + RECORD_FIXED_BYTES > bytes.length) {
    return null;
  }
  const fixed = name.next;
  const code = view.getUint16(fixed);
  const cacheFlush = (view.getUint16(fixed + 2) & CLASS_TOP_BIT) !== 0;
  const ttl = view.getUint32(fixed + 4);
  const dataStart = fixed + RECORD_FIXED_BYTES;
  const next = dataStart + view.getUint16(fixed + 8);
  if (next > bytes.length) {
    return null;
  }
  switch (code) {
    case DNS_TYPES.A:
      return next - dataStart === IPV4_BYTES
        ? { record: { type: 'A', name: name.labels, ttl, cacheFlush, address: [...bytes.subarray(dataStart, next)].join('.') }, next }
        : null;
    case DNS_TYPES.PTR: {
      const target = readName(bytes, dataStart);
      return target === null || target.next > next ? null : { record: { type: 'PTR', name: name.labels, ttl, target: target.labels }, next };
    }
    case DNS_TYPES.SRV: {
      if (next - dataStart <= SRV_FIXED_BYTES) {
        return null;
      }
      const target = readName(bytes, dataStart + SRV_FIXED_BYTES);
      return target === null || target.next > next
        ? null
        : {
            record: { type: 'SRV', name: name.labels, ttl, cacheFlush, port: view.getUint16(dataStart + 4), target: target.labels },
            next,
          };
    }
    case DNS_TYPES.TXT: {
      const entries = readTxt(bytes.subarray(dataStart, next));
      return entries === null ? null : { record: { type: 'TXT', name: name.labels, ttl, cacheFlush, entries }, next };
    }
    default:
      return { record: { type: 'OTHER', name: name.labels, ttl, code }, next };
  }
}

/** 解一个 mDNS 报文；格式不对、超过上限都返回 null（整包丢掉）。 */
export function decodeDnsMessage(bytes: Uint8Array): DnsMessage | null {
  if (bytes.length < HEADER_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const counts = [view.getUint16(4), view.getUint16(6), view.getUint16(8), view.getUint16(10)];
  if (counts.some((count) => count > DNS_LIMITS.records)) {
    return null;
  }
  const [questionCount = 0, ...recordCounts] = counts;
  let at = HEADER_BYTES;
  const questions: DnsQuestion[] = [];
  for (let index = 0; index < questionCount; index += 1) {
    const name = readName(bytes, at);
    if (name === null || name.next + QUESTION_FIXED_BYTES > bytes.length) {
      return null;
    }
    questions.push({
      name: name.labels,
      type: view.getUint16(name.next),
      unicastResponse: (view.getUint16(name.next + 2) & CLASS_TOP_BIT) !== 0,
    });
    at = name.next + QUESTION_FIXED_BYTES;
  }
  const sections: DnsRecord[][] = [];
  for (const count of recordCounts) {
    const records: DnsRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      const read = readRecord(bytes, view, at);
      if (read === null) {
        return null;
      }
      records.push(read.record);
      at = read.next;
    }
    sections.push(records);
  }
  return {
    id: view.getUint16(0),
    isResponse: (view.getUint16(2) & FLAG_RESPONSE) !== 0,
    questions,
    answers: sections[0] ?? [],
    authorities: sections[1] ?? [],
    additionals: sections[2] ?? [],
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/mdns`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/mdns/dns-message.ts src/core/mdns/dns-message.test.ts
git commit -m "feat(mdns): encode and decode the DNS messages mDNS uses" -m "LAN sharing answers mDNS itself instead of pulling in a responder library. Only PTR, SRV, TXT and A records are understood; packets from the network are bounded, compression pointers may only point backwards a limited number of times, and anything malformed is dropped." -m "$TRAILER"
```

---

### Task 10: DNS-SD 记录和 mDNS 应答

一块网卡上要回答的是一个「区域」：自己的主机名、这块网卡的地址、所有共享打印机的服务。应答器是纯函数：收到的查询 → 要发的回答（或什么都不发）；另有宣告、告别（TTL 0）、探测和「别人在用我们的名字」的判断。回答按 RFC 6762 / 6763：PTR 回答附上实例的 SRV、TXT 和主机地址；对方已知且还新鲜的 PTR 不再答（§7.1）；源端口不是 5353 的传统查询按普通 DNS 单播回答（带上问题和编号、TTL 不超过 10 秒、不带缓存刷新位，§6.7）。

**Files:**
- Create: `src/core/mdns/dns-sd.ts`、`src/core/mdns/dns-sd.test.ts`
- Create: `src/core/mdns/mdns-responder.ts`、`src/core/mdns/mdns-responder.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/mdns/dns-sd.test.ts
import { describe, expect, test } from 'bun:test';
import { encodeTxt, instanceLabel, type MdnsZone, SERVICE_ENUMERATION, zoneRecords } from './dns-sd';

const ZONE: MdnsZone = {
  host: ['labelflash-1a2b3c4d', 'local'],
  address: '192.168.1.10',
  services: [
    {
      instance: '60×40 标签 @ 前台',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal', '_print'],
      port: 8631,
      txt: [
        ['txtvers', '1'],
        ['rp', 'printers/60x40'],
      ],
    },
  ],
};

describe('instanceLabel', () => {
  test('keeps short names and cuts long ones at 63 bytes without splitting a character', () => {
    expect(instanceLabel('60×40 标签 @ 前台')).toBe('60×40 标签 @ 前台');
    const cut = instanceLabel('标'.repeat(30));
    expect(new TextEncoder().encode(cut).length).toBe(63);
    expect(instanceLabel('a\u0000b')).toBe('ab');
    expect(new TextEncoder().encode(instanceLabel('标'.repeat(30), 60)).length).toBe(60);
  });
});

describe('encodeTxt', () => {
  test('writes key=value entries and refuses entries over 255 bytes', () => {
    expect(encodeTxt([['rp', 'printers/60x40']]).map((entry) => new TextDecoder().decode(entry))).toEqual(['rp=printers/60x40']);
    expect(() => encodeTxt([['note', 'x'.repeat(260)]])).toThrow('255');
  });
});

describe('zoneRecords', () => {
  test('lists the service type, the instance under the type and each subtype, its SRV, TXT and the host address', () => {
    const records = zoneRecords(ZONE);
    expect(records.map((record) => `${record.type} ${record.name.join('.')}`)).toEqual([
      `PTR ${SERVICE_ENUMERATION.join('.')}`,
      'PTR _ipp._tcp.local',
      'PTR _universal._sub._ipp._tcp.local',
      'PTR _print._sub._ipp._tcp.local',
      'SRV 60×40 标签 @ 前台._ipp._tcp.local',
      'TXT 60×40 标签 @ 前台._ipp._tcp.local',
      'A labelflash-1a2b3c4d.local',
    ]);
    expect(records.at(-1)).toMatchObject({ type: 'A', address: '192.168.1.10', ttl: 120, cacheFlush: true });
  });
});
```

```ts
// src/core/mdns/mdns-responder.test.ts
import { describe, expect, test } from 'bun:test';
import { DNS_TYPES, type DnsMessage, type DnsQuestion } from './dns-message';
import type { MdnsZone } from './dns-sd';
import { announcement, answerQuery, conflictingNames, goodbye, probeQuery } from './mdns-responder';

const ZONE: MdnsZone = {
  host: ['labelflash-1a2b3c4d', 'local'],
  address: '192.168.1.10',
  services: [
    {
      instance: '60×40 标签 @ 前台',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal', '_print'],
      port: 8631,
      txt: [['rp', 'printers/60x40']],
    },
  ],
};
const INSTANCE = ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'];

function query(questions: DnsQuestion[], answers: DnsMessage['answers'] = []): DnsMessage {
  return { id: 77, isResponse: false, questions, answers, authorities: [], additionals: [] };
}

const kinds = (records: DnsMessage['answers']) => records.map((record) => `${record.type} ${record.name.join('.')}`);

describe('answerQuery', () => {
  test('answers a browse for IPP printers with the instance and adds SRV, TXT and the address', () => {
    const reply = answerQuery(query([{ name: ['_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false }]), ZONE, false);
    expect(reply).toMatchObject({ id: 0, isResponse: true, questions: [] });
    expect(kinds(reply?.answers ?? [])).toEqual(['PTR _ipp._tcp.local']);
    expect(kinds(reply?.additionals ?? [])).toEqual([
      `SRV ${INSTANCE.join('.')}`,
      `TXT ${INSTANCE.join('.')}`,
      'A labelflash-1a2b3c4d.local',
    ]);
  });

  test('answers the AirPrint subtype and the host name', () => {
    const subtype = answerQuery(query([{ name: ['_universal', '_sub', '_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false }]), ZONE, false);
    expect(subtype?.answers).toHaveLength(1);
    const host = answerQuery(query([{ name: ['LabelFlash-1A2B3C4D', 'local'], type: DNS_TYPES.ANY, unicastResponse: false }]), ZONE, false);
    expect(host?.answers).toEqual([{ type: 'A', name: ZONE.host, ttl: 120, cacheFlush: true, address: '192.168.1.10' }]);
  });

  test('stays quiet about names it does not have', () => {
    expect(answerQuery(query([{ name: ['_http', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false }]), ZONE, false)).toBeNull();
  });

  test('skips a PTR the asker already knows and still holds for long', () => {
    const known = [{ type: 'PTR' as const, name: ['_ipp', '_tcp', 'local'], ttl: 4000, target: INSTANCE }];
    expect(answerQuery(query([{ name: ['_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false }], known), ZONE, false)).toBeNull();
    const stale = [{ type: 'PTR' as const, name: ['_ipp', '_tcp', 'local'], ttl: 100, target: INSTANCE }];
    expect(answerQuery(query([{ name: ['_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false }], stale), ZONE, false)).not.toBeNull();
  });

  test('answers a legacy unicast query like plain DNS', () => {
    const question = { name: INSTANCE, type: DNS_TYPES.SRV, unicastResponse: false };
    const reply = answerQuery(query([question]), ZONE, true);
    expect(reply).toMatchObject({ id: 77, questions: [question] });
    expect(reply?.answers[0]).toMatchObject({ type: 'SRV', ttl: 10, cacheFlush: false });
  });
});

describe('announcement, goodbye and probe', () => {
  test('announce every record and say goodbye with a zero TTL', () => {
    expect(announcement(ZONE).answers).toHaveLength(7);
    expect(goodbye(ZONE).answers.every((record) => record.ttl === 0)).toBe(true);
  });

  test('probe the unique names and propose their records', () => {
    const probe = probeQuery(ZONE);
    expect(probe.questions).toEqual([
      { name: INSTANCE, type: DNS_TYPES.ANY, unicastResponse: true },
      { name: ZONE.host, type: DNS_TYPES.ANY, unicastResponse: true },
    ]);
    expect(kinds(probe.authorities)).toEqual([`SRV ${INSTANCE.join('.')}`, 'A labelflash-1a2b3c4d.local']);
  });
});

describe('conflictingNames', () => {
  test('notices another device answering with our names and different data', () => {
    const theirs: DnsMessage = {
      ...announcement(ZONE),
      answers: [{ type: 'SRV', name: INSTANCE, ttl: 120, cacheFlush: true, port: 631, target: ['other', 'local'] }],
    };
    expect(conflictingNames(theirs, ZONE)).toEqual([INSTANCE]);
  });

  test('ignores the same data and other names', () => {
    expect(conflictingNames(announcement(ZONE), ZONE)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/mdns`
Expected: FAIL，`Cannot find module './dns-sd'`、`'./mdns-responder'`。

- [ ] **Step 3: 实现**

```ts
// src/core/mdns/dns-sd.ts
import type { DnsName, DnsRecord } from './dns-message';

/** DNS-SD（RFC 6763）的一个服务实例：例如「60×40 标签 @ 前台」这台 _ipp._tcp 打印机。 */
export interface ServiceAdvert {
  /** 实例名（一段，最多 63 字节，见 instanceLabel）。 */
  instance: string;
  /** 服务类型，例如 ['_ipp', '_tcp', 'local']。 */
  serviceType: DnsName;
  /** 子类型（不带 _sub），例如 ['_universal', '_print']。 */
  subtypes: readonly string[];
  port: number;
  /** TXT 里的键值，按顺序。 */
  txt: ReadonlyArray<readonly [string, string]>;
}

/** 一块网卡上要回答的全部：程序在 mDNS 里的主机名、这块网卡的地址、所有服务。 */
export interface MdnsZone {
  host: DnsName;
  address: string;
  services: readonly ServiceAdvert[];
}

/** RFC 6762 §10：主机地址、SRV 这类会随地址变的记录 120 秒，其余 75 分钟。 */
export const MDNS_TTL_SECONDS = { host: 120, other: 4500 } as const;
/** 「这台电脑有哪些服务类型」的元查询（RFC 6763 §9）。 */
export const SERVICE_ENUMERATION: DnsName = ['_services', '_dns-sd', '_udp', 'local'];
/** 实例名是一段 DNS 名字：最多 63 字节（RFC 6763 §4.1.1）。 */
export const MAX_INSTANCE_BYTES = 63;
const MAX_TXT_ENTRY_BYTES = 255;
const SUBTYPE_LABEL = '_sub';
// biome-ignore lint/suspicious/noControlCharactersInRegex: 实例名里去掉一切控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const UTF8_ENCODER = new TextEncoder();

/** 实例名：去掉控制字符，按 UTF-8 截到 maxBytes 以内（不切开一个汉字）。 */
export function instanceLabel(text: string, maxBytes: number = MAX_INSTANCE_BYTES): string {
  let bytes = 0;
  let label = '';
  for (const char of text.replace(CONTROL_CHARACTERS, '')) {
    const size = UTF8_ENCODER.encode(char).length;
    if (bytes + size > maxBytes) {
      break;
    }
    bytes += size;
    label += char;
  }
  return label.trim();
}

export function instanceName(service: ServiceAdvert): DnsName {
  return [service.instance, ...service.serviceType];
}

/**
 * TXT 的每一项是「键=值」（RFC 6763 §6）。
 * @throws Error 一项超过 255 字节：是程序拼的 TXT 太长，快速失败
 */
export function encodeTxt(entries: ReadonlyArray<readonly [string, string]>): Uint8Array[] {
  return entries.map(([key, value]) => {
    const bytes = UTF8_ENCODER.encode(`${key}=${value}`);
    if (bytes.length > MAX_TXT_ENTRY_BYTES) {
      throw new Error(`TXT entry ${key} has ${bytes.length} bytes, over ${MAX_TXT_ENTRY_BYTES}`);
    }
    return bytes;
  });
}

/** 一块网卡上的全部记录：服务类型的 PTR、每个实例（含子类型）的 PTR、SRV、TXT，最后是主机地址。 */
export function zoneRecords(zone: MdnsZone): DnsRecord[] {
  const records: DnsRecord[] = [];
  const types: DnsName[] = [];
  for (const service of zone.services) {
    if (!types.some((type) => type.join('.') === service.serviceType.join('.'))) {
      types.push(service.serviceType);
    }
  }
  for (const type of types) {
    records.push({ type: 'PTR', name: SERVICE_ENUMERATION, ttl: MDNS_TTL_SECONDS.other, target: type });
  }
  for (const service of zone.services) {
    const name = instanceName(service);
    records.push({ type: 'PTR', name: service.serviceType, ttl: MDNS_TTL_SECONDS.other, target: name });
    for (const subtype of service.subtypes) {
      records.push({
        type: 'PTR',
        name: [subtype, SUBTYPE_LABEL, ...service.serviceType],
        ttl: MDNS_TTL_SECONDS.other,
        target: name,
      });
    }
    records.push({ type: 'SRV', name, ttl: MDNS_TTL_SECONDS.host, cacheFlush: true, port: service.port, target: zone.host });
    records.push({ type: 'TXT', name, ttl: MDNS_TTL_SECONDS.other, cacheFlush: true, entries: encodeTxt(service.txt) });
  }
  records.push({ type: 'A', name: zone.host, ttl: MDNS_TTL_SECONDS.host, cacheFlush: true, address: zone.address });
  return records;
}
```

（`zoneRecords` 的测试里服务类型只有一种，所以元查询的 PTR 只有一条。）

```ts
// src/core/mdns/mdns-responder.ts
import { DNS_TYPES, type DnsMessage, type DnsName, type DnsQuestion, type DnsRecord, sameName, typeCode } from './dns-message';
import { instanceName, type MdnsZone, zoneRecords } from './dns-sd';

/** 传统单播查询（源端口不是 5353）的回答 TTL 上限（RFC 6762 §6.7）。 */
const LEGACY_UNICAST_TTL_SECONDS = 10;
/** 对方已知的回答剩余 TTL 不少于我们的一半，才省掉这一条（RFC 6762 §7.1）。 */
const KNOWN_ANSWER_TTL_FRACTION = 0.5;

function matches(question: DnsQuestion, record: DnsRecord): boolean {
  return sameName(question.name, record.name) && (question.type === DNS_TYPES.ANY || question.type === typeCode(record));
}

function isKnown(known: readonly DnsRecord[], record: DnsRecord): boolean {
  return (
    record.type === 'PTR' &&
    known.some(
      (item) =>
        item.type === 'PTR' &&
        sameName(item.name, record.name) &&
        sameName(item.target, record.target) &&
        item.ttl >= record.ttl * KNOWN_ANSWER_TTL_FRACTION,
    )
  );
}

/** 附加记录（RFC 6763 §12）：答了实例的 PTR 就附上它的 SRV、TXT；有 SRV 就附上主机地址。 */
function additionalsFor(answers: readonly DnsRecord[], records: readonly DnsRecord[]): DnsRecord[] {
  const extra: DnsRecord[] = [];
  const add = (record: DnsRecord) => {
    if (!answers.includes(record) && !extra.includes(record)) {
      extra.push(record);
    }
  };
  for (const answer of answers) {
    if (answer.type !== 'PTR') {
      continue;
    }
    for (const record of records) {
      if ((record.type === 'SRV' || record.type === 'TXT') && sameName(record.name, answer.target)) {
        add(record);
      }
    }
  }
  if ([...answers, ...extra].some((record) => record.type === 'SRV')) {
    for (const record of records) {
      if (record.type === 'A') {
        add(record);
      }
    }
  }
  return extra;
}

function legacyRecord(record: DnsRecord): DnsRecord {
  const ttl = Math.min(record.ttl, LEGACY_UNICAST_TTL_SECONDS);
  return 'cacheFlush' in record ? { ...record, ttl, cacheFlush: false } : { ...record, ttl };
}

/**
 * 回答一条查询；没有要答的返回 null。legacy：对方不是 mDNS 响应器（源端口不是 5353），
 * 按普通 DNS 单播回答：带上问题和编号，TTL 不超过 10 秒，不带缓存刷新位。
 */
export function answerQuery(query: DnsMessage, zone: MdnsZone, legacy: boolean): DnsMessage | null {
  if (query.isResponse) {
    return null;
  }
  const records = zoneRecords(zone);
  const answers: DnsRecord[] = [];
  for (const question of query.questions) {
    for (const record of records) {
      if (matches(question, record) && !answers.includes(record) && !isKnown(query.answers, record)) {
        answers.push(record);
      }
    }
  }
  if (answers.length === 0) {
    return null;
  }
  const additionals = additionalsFor(answers, records);
  const shape = (record: DnsRecord): DnsRecord => (legacy ? legacyRecord(record) : record);
  return {
    id: legacy ? query.id : 0,
    isResponse: true,
    questions: legacy ? query.questions : [],
    answers: answers.map(shape),
    authorities: [],
    additionals: additionals.map(shape),
  };
}

/** 宣告（RFC 6762 §8.3）：把全部记录主动发出去。 */
export function announcement(zone: MdnsZone): DnsMessage {
  return { id: 0, isResponse: true, questions: [], answers: zoneRecords(zone), authorities: [], additionals: [] };
}

/** 告别（RFC 6762 §10.1）：同样的记录，TTL 0，别的设备马上把它们从缓存里删掉。 */
export function goodbye(zone: MdnsZone): DnsMessage {
  return { ...announcement(zone), answers: zoneRecords(zone).map((record) => ({ ...record, ttl: 0 })) };
}

/** 只属于这台电脑的名字：每个实例名和主机名。 */
function uniqueNames(zone: MdnsZone): DnsName[] {
  return [...zone.services.map(instanceName), zone.host];
}

/** 探测（RFC 6762 §8.1）：问一问这些名字有没有人用，权威部分写上我们打算用的 SRV 和 A。 */
export function probeQuery(zone: MdnsZone): DnsMessage {
  const records = zoneRecords(zone);
  return {
    id: 0,
    isResponse: false,
    questions: uniqueNames(zone).map((name) => ({ name, type: DNS_TYPES.ANY, unicastResponse: true })),
    answers: [],
    authorities: records.filter((record) => record.type === 'SRV' || record.type === 'A'),
    additionals: [],
  };
}

function sameData(a: DnsRecord, b: DnsRecord): boolean {
  if (a.type === 'SRV' && b.type === 'SRV') {
    return a.port === b.port && sameName(a.target, b.target);
  }
  if (a.type === 'A' && b.type === 'A') {
    return a.address === b.address;
  }
  return false;
}

/** 别的设备（调用方已经排除了自己发的包）用我们的实例名或主机名回答、探测，而且内容不同：这些名字冲突了。 */
export function conflictingNames(message: DnsMessage, zone: MdnsZone): DnsName[] {
  const ours = zoneRecords(zone).filter((record) => record.type === 'SRV' || record.type === 'A');
  const theirs = [...message.answers, ...message.authorities, ...message.additionals].filter(
    (record) => record.type === 'SRV' || record.type === 'A',
  );
  const names: DnsName[] = [];
  for (const record of ours) {
    const clashes = theirs.some((other) => sameName(other.name, record.name) && !sameData(other, record));
    if (clashes && !names.some((name) => sameName(name, record.name))) {
      names.push(record.name);
    }
  }
  return names;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/mdns`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/mdns/dns-sd.ts src/core/mdns/dns-sd.test.ts src/core/mdns/mdns-responder.ts src/core/mdns/mdns-responder.test.ts
git commit -m "feat(mdns): answer DNS-SD queries for shared printers" -m "A zone is what one network card answers: the app's own host name, that card's address and every shared printer. Answers follow RFC 6762 and 6763 with SRV, TXT and address as additional records, known-answer suppression and plain DNS replies to legacy queries; announcing, goodbyes, probing and name conflicts are pure functions too." -m "$TRAILER"
```

---

### Task 11: 共享打印机的 Bonjour 广告

把一台共享打印机变成 DNS-SD 服务：`_ipp._tcp`，子类型 `_universal`（AirPrint：iOS / macOS 只认带它的）和 `_print`（IPP Everywhere，PWG 5100.14 §4.2.2），TXT 按 Bonjour 打印规范 1.2.1 和 PWG 5100.14 §4.2.2.1。

| TXT 键 | 值 | 作用 |
|---|---|---|
| `txtvers` | `1` | 规范版本 |
| `qtotal` | `1` | 一个队列 |
| `rp` | `printers/60x40` | 打印机的路径（客户端拼 `ipp://主机:端口/rp`） |
| `ty` | `CDL-云签速印 共享热敏标签机` | 型号（make-and-model） |
| `product` | `(CDL-LabelFlash)` | 产品名（规范要求带括号） |
| `note` | 电脑名 | 位置 |
| `adminurl` | `http://labelflash-xxxx.local:8631/printers/60x40` | 说明页 |
| `priority` | `50` | 同类打印机的排序（默认值） |
| `pdl` | `application/pdf,image/jpeg,image/png,image/pwg-raster,image/urf` | 收的格式 |
| `URF` | `V1.4,CP1,W8,SRGB24,RS203` | AirPrint 必需 |
| `UUID` | 不带 `urn:uuid:` 的 UUID | 同一台打印机的标识 |
| `Color`、`Duplex` | `F` | 黑白、单面 |
| `kind` | `label` | 标签机 |
| `PaperMax` | `<legal-A4` | 纸比 A4 小 |
| `air` | `none` 或 `username,password` | 设了共享密码时让客户端先问用户 |

**Files:**
- Create: `src/core/ipp/ipp-advert.ts`、`src/core/ipp/ipp-advert.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/ipp/ipp-advert.test.ts
import { describe, expect, test } from 'bun:test';
import { MAX_INSTANCE_BYTES } from '../mdns/dns-sd';
import { type AdvertContext, ippAdvert } from './ipp-advert';
import { testPrinter } from './testing/ipp-requests';

const CONTEXT: AdvertContext = {
  port: 8631,
  hostName: 'labelflash-1a2b3c4d.local',
  computerName: '前台',
  productNameAscii: 'CDL-LabelFlash',
  authentication: 'none',
  serial: 1,
};

describe('ippAdvert', () => {
  test('advertises an AirPrint and IPP Everywhere printer', () => {
    const advert = ippAdvert(testPrinter(), CONTEXT);
    expect(advert).toMatchObject({
      instance: '60×40 标签 @ 前台',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal', '_print'],
      port: 8631,
    });
    const txt = new Map(advert.txt);
    expect(txt.get('rp')).toBe('printers/60x40');
    expect(txt.get('URF')).toBe('V1.4,CP1,W8,SRGB24,RS203');
    expect(txt.get('pdl')).toBe('application/pdf,image/jpeg,image/png,image/pwg-raster,image/urf');
    expect(txt.get('UUID')).toBe('3f2504e0-4f89-51d3-9a0c-0305e82c3301');
    expect(txt.get('adminurl')).toBe('http://labelflash-1a2b3c4d.local:8631/printers/60x40');
    expect(txt.get('air')).toBe('none');
    expect(txt.get('kind')).toBe('label');
  });

  test('asks for a user name and password once the share password is set', () => {
    expect(new Map(ippAdvert(testPrinter(), { ...CONTEXT, authentication: 'basic' }).txt).get('air')).toBe('username,password');
  });

  test('adds a number after a name conflict and keeps within 63 bytes', () => {
    expect(ippAdvert(testPrinter(), { ...CONTEXT, serial: 2 }).instance).toBe('60×40 标签 @ 前台 (2)');
    const long = ippAdvert(testPrinter(), { ...CONTEXT, computerName: '仓'.repeat(30), serial: 3 }).instance;
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(MAX_INSTANCE_BYTES);
    expect(long.endsWith(' (3)')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/ipp/ipp-advert.test.ts`
Expected: FAIL，`Cannot find module './ipp-advert'`。

- [ ] **Step 3: 实现**

```ts
// src/core/ipp/ipp-advert.ts
import { instanceLabel, MAX_INSTANCE_BYTES, type ServiceAdvert } from '../mdns/dns-sd';
import { DOCUMENT_FORMATS } from './document-format';
import { urfSupported } from './printer-attributes';
import type { SharedPrinter } from './shared-printer';

export const IPP_SERVICE_TYPE = ['_ipp', '_tcp', 'local'] as const;
/** _universal：iOS / macOS 只把带它的当成 AirPrint 打印机；_print：IPP Everywhere（PWG 5100.14 §4.2.2）。 */
export const IPP_SUBTYPES = ['_universal', '_print'] as const;
/** Bonjour 打印规范 1.2.1 的默认优先级（0 最优先）。 */
const PRIORITY = '50';
/** 标签纸都比 A4 小（Bonjour 打印规范的 PaperMax 取值）。 */
const PAPER_MAX = '<legal-A4';
const UUID_PREFIX = 'urn:uuid:';
const UTF8_ENCODER = new TextEncoder();

export interface AdvertContext {
  port: number;
  /** 程序在 mDNS 里的主机名，例如 labelflash-1a2b3c4d.local。 */
  hostName: string;
  computerName: string;
  productNameAscii: string;
  authentication: 'none' | 'basic';
  /** 名字冲突后加在实例名后面的序号；1 = 不加。 */
  serial: number;
}

/** 一台共享打印机的 DNS-SD 服务：实例名「60×40 标签 @ 电脑名」，冲突后加「 (2)」，整体不超过 63 字节。 */
export function ippAdvert(printer: SharedPrinter, context: AdvertContext): ServiceAdvert {
  const suffix = context.serial > 1 ? ` (${context.serial})` : '';
  const base = instanceLabel(`${printer.name} @ ${context.computerName}`, MAX_INSTANCE_BYTES - UTF8_ENCODER.encode(suffix).length);
  return {
    instance: `${base}${suffix}`,
    serviceType: [...IPP_SERVICE_TYPE],
    subtypes: [...IPP_SUBTYPES],
    port: context.port,
    txt: [
      ['txtvers', '1'],
      ['qtotal', '1'],
      ['rp', `printers/${printer.key}`],
      ['ty', printer.makeAndModel],
      ['product', `(${context.productNameAscii})`],
      ['note', printer.location],
      ['adminurl', `http://${context.hostName}:${context.port}/printers/${printer.key}`],
      ['priority', PRIORITY],
      ['pdl', DOCUMENT_FORMATS.join(',')],
      ['URF', urfSupported(printer.dpi).join(',')],
      ['UUID', printer.uuid.startsWith(UUID_PREFIX) ? printer.uuid.slice(UUID_PREFIX.length) : printer.uuid],
      ['Color', 'F'],
      ['Duplex', 'F'],
      ['kind', 'label'],
      ['PaperMax', PAPER_MAX],
      ['air', context.authentication === 'basic' ? 'username,password' : 'none'],
    ],
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/ipp src/core/mdns`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/ipp/ipp-advert.ts src/core/ipp/ipp-advert.test.ts
git commit -m "feat(ipp): advertise shared printers for AirPrint and IPP Everywhere" -m "Each shared paper is an _ipp._tcp service with the _universal and _print subtypes and the TXT keys of the Bonjour printing spec and PWG 5100.14, including URF, so macOS and iOS treat it as an AirPrint printer. The instance name stays within 63 bytes and takes a number after a conflict." -m "$TRAILER"
```

---

### Task 12: 局域网地址；把端口回退和自检抽成共用的 `HttpListener`

本机接口的 `ApiHttpServer` 里有一段和接口本身无关的逻辑：依次试端口、被占用（含 Windows 上 Hyper-V 保留的端口段）就换、监听后从回环地址请求自己一次确认没被别的程序截走、重启时等正在处理的请求收尾。IPP 服务要一模一样的东西，抽成 `main/net/http-listener.ts` 共用，`ApiHttpServer` 改为用它（**行为不变**：`http-server.test.ts`、`local-api.test.ts` 一个字不改，照样通过）。新增一种监听范围 `ipv4`（只 `0.0.0.0`）给 IPP 用。

另外在 `api/network.ts` 加：局域网来的连接（共享只接受这些）、带子网掩码的网卡列表（mDNS 按对方所在的子网选网卡）、子网判断。

**Files:**
- Create: `src/main/net/http-listener.ts`、`src/main/net/http-listener.test.ts`
- Modify: `src/main/api/http-server.ts`
- Modify: `src/main/api/local-api.ts`
- Modify: `src/main/api/network.ts`、`src/main/api/network.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/net/http-listener.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import { HttpListener, type ListenStatus, portOrder } from './http-listener';

const listeners: HttpListener[] = [];

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.stop()));
});

function createListener(configure?: (server: Server) => void) {
  const handled: string[] = [];
  const listener = new HttpListener({
    logTag: '[test]',
    requestTimeoutMs: 5_000,
    maxConnections: 8,
    onRequest: (request, response) => {
      handled.push(request.url ?? '');
      response.end('ok');
    },
    configure,
  });
  listeners.push(listener);
  return { listener, handled };
}

function portOf(status: ListenStatus): number {
  if (status.state !== 'listening') {
    throw new Error(`not listening: ${JSON.stringify(status)}`);
  }
  return status.port;
}

describe('HttpListener', () => {
  test('listens on IPv4 only for the ipv4 scope', async () => {
    const { listener, handled } = createListener();
    const status = await listener.start('ipv4', [0]);
    expect(status).toMatchObject({ state: 'listening', scope: 'ipv4', skippedPorts: [] });
    expect(await (await fetch(`http://127.0.0.1:${portOf(status)}/x`)).text()).toBe('ok');
    // 自检请求不交给处理函数。
    expect(handled).toEqual(['/x']);
  });

  test('lets the owner attach its own events to every server it creates', async () => {
    let connections = 0;
    const { listener } = createListener((server) => {
      server.on('connection', () => {
        connections += 1;
      });
    });
    const port = portOf(await listener.start('loopback', [0]));
    await fetch(`http://127.0.0.1:${port}/x`);
    expect(connections).toBeGreaterThan(0);
  });

  test('stops listening', async () => {
    const { listener } = createListener();
    const port = portOf(await listener.start('ipv4', [0]));
    await listener.stop();
    expect(listener.status).toEqual({ state: 'off' });
    expect(listener.port()).toBeNull();
    await expect(fetch(`http://127.0.0.1:${port}/x`)).rejects.toThrow();
  });
});

describe('portOrder', () => {
  test('tries the chosen port, the last good one, the defaults, then any free port', () => {
    expect(portOrder(9000, 8632, [8631, 8632])).toEqual([9000, 8632, 8631, 0]);
    expect(portOrder(null, null, [8631])).toEqual([8631, 0]);
  });
});
```

`network.test.ts` 末尾加（import 加 `isLanClientAddress`、`isSameSubnet`、`lanIPv4Interfaces`、`plainAddress`；文件里已有的网卡样例如果没有 `netmask`，每条补上 `netmask: '255.255.255.0'`）：

```ts
describe('isLanClientAddress', () => {
  test('accepts private, link-local and loopback IPv4 addresses, mapped or not', () => {
    for (const address of ['192.168.1.23', '10.0.0.5', '172.16.3.4', '172.31.255.1', '169.254.10.2', '127.0.0.1', '::ffff:192.168.1.23']) {
      expect(isLanClientAddress(address)).toBe(true);
    }
  });

  test('refuses public addresses, carrier NAT, IPv6 and nothing', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '198.18.0.1', '::1', 'fe80::1', '', undefined]) {
      expect(isLanClientAddress(address)).toBe(false);
    }
  });
});

describe('lanIPv4Interfaces and isSameSubnet', () => {
  test('keep the netmask of each physical LAN card', () => {
    const interfaces = {
      'Wi-Fi': [{ address: '192.168.1.10', family: 'IPv4', internal: false, mac: 'a4:5e:60:00:00:01', netmask: '255.255.255.0' }],
      'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false, mac: '00:15:5d:00:00:01', netmask: '255.255.240.0' }],
    };
    expect(lanIPv4Interfaces(interfaces)).toEqual([{ name: 'Wi-Fi', address: '192.168.1.10', netmask: '255.255.255.0' }]);
  });

  test('compare addresses under a netmask', () => {
    expect(isSameSubnet('192.168.1.10', '192.168.1.200', '255.255.255.0')).toBe(true);
    expect(isSameSubnet('192.168.1.10', '192.168.2.10', '255.255.255.0')).toBe(false);
    expect(isSameSubnet('10.1.2.3', '10.200.0.1', '255.0.0.0')).toBe(true);
  });

  test('strip the IPv4-mapped prefix', () => {
    expect(plainAddress('::ffff:192.168.1.23')).toBe('192.168.1.23');
    expect(plainAddress('192.168.1.23')).toBe('192.168.1.23');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/net src/main/api/network.test.ts`
Expected: FAIL，`Cannot find module './http-listener'`；`isLanClientAddress` 等没有导出。

- [ ] **Step 3: 抽出 `HttpListener`**

```ts
// src/main/net/http-listener.ts
import { randomUUID } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { SerialQueue } from '../../core/serial-queue';

/** 重启服务时，正在处理的请求最多再等这么久：收下的任务要把回应发出去，不然调用方重试会重复打印。 */
const DRAIN_GRACE_MS = 5_000;
/** 这些错误按「端口不能用」处理，换下一个端口：EACCES 是 Windows 上 Hyper-V 等保留的端口段。 */
const PORT_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['EADDRINUSE', 'EACCES']);
/** 这些错误说明这台电脑没有 IPv6：只用 IPv4 就行。 */
const NO_IPV6_CODES: ReadonlySet<string> = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);
/** 自检请求带的请求头：值是这个服务自己的随机口令，只有自己认得。 */
const PROBE_HEADER = 'x-labelflash-probe';
/** 自检最多等这么久：本机回环地址上的请求通常几毫秒就回来。 */
const PROBE_TIMEOUT_MS = 2_000;
const NO_CONTENT = 204;
/** 端口候选的最后一个：0 = 由系统分配一个空闲端口，保证服务总能起来。 */
export const ANY_FREE_PORT = 0;

/** 监听哪些地址：loopback = 只本机（127.0.0.1 和 ::1）；all = 所有网卡（::，没有 IPv6 时 0.0.0.0）；ipv4 = 所有 IPv4 网卡（0.0.0.0）。 */
export type ListenScope = 'loopback' | 'all' | 'ipv4';

export type ListenStatus =
  | { state: 'off' }
  /** skippedPorts：想用却被占用、自动跳过的端口（按尝试的顺序）；为空表示用上了首选的端口。 */
  | { state: 'listening'; port: number; scope: ListenScope; skippedPorts: number[] }
  | { state: 'failed'; reason: 'PORT_IN_USE'; ports: number[] };

export interface HttpListenerOptions {
  /** 日志前缀，例如 [api]、[ipp]。 */
  logTag: string;
  requestTimeoutMs: number;
  maxConnections: number;
  /** 每个请求（自检请求除外）。 */
  onRequest: (request: IncomingMessage, response: ServerResponse) => void;
  /** 每新建一个 node:http 服务调用一次：挂上额外的事件（例如 connection、checkContinue）。 */
  configure?: ((server: Server) => void) | undefined;
}

class PortUnavailableError extends Error {}

interface Listening {
  servers: [Server, ...Server[]];
  /** 在 IPv6 回环地址 ::1 上也能收到请求：自检时两个回环地址都要查。 */
  hasIpv6: boolean;
}

/** 依次尝试的端口：指定的 → 上次用成功的 → 默认的几个 → 系统分配的空闲端口（去重）。 */
export function portOrder(preferred: number | null, last: number | null, candidates: readonly number[]): number[] {
  const ports = [preferred, last, ...candidates, ANY_FREE_PORT];
  return [...new Set(ports.filter((port): port is number => port !== null))];
}

/**
 * 一组 node:http 服务的监听：依次试端口，被占用就换；监听后从回环地址请求自己一次，回应不是自己的也换；
 * 启动、停止一次只做一件（两次启动交错时，先起来的那组服务会被后一次覆盖，再也关不掉）。
 * 本机接口和局域网共享共用。
 */
export class HttpListener {
  private servers: Server[] = [];
  private current: ListenStatus = { state: 'off' };
  private readonly lifecycle = new SerialQueue();
  /** 自检口令：每个服务一个，别的程序不可能回应它。 */
  private readonly probeToken = randomUUID();

  constructor(private readonly options: HttpListenerOptions) {}

  get status(): ListenStatus {
    return this.current;
  }

  /** 正在监听的端口；没有监听时为 null。 */
  port(): number | null {
    return this.current.state === 'listening' ? this.current.port : null;
  }

  start(scope: ListenScope, ports: readonly number[]): Promise<ListenStatus> {
    return this.lifecycle.run(() => this.startNow(scope, ports));
  }

  stop(): Promise<void> {
    return this.lifecycle.run(async () => {
      this.current = { state: 'off' };
      await drain(this.take());
    });
  }

  private async startNow(scope: ListenScope, ports: readonly number[]): Promise<ListenStatus> {
    this.current = { state: 'off' };
    await drain(this.take());
    const skippedPorts: number[] = [];
    for (const port of ports) {
      try {
        // 新起的服务先放在局部变量里，自检通过才交给 this.servers。
        const listening = await this.listen(port, scope);
        const bound = addressPort(listening.servers[0]);
        if (!(await this.answersOnLoopback(bound, listening.hasIpv6))) {
          await drain(listening.servers);
          throw new PortUnavailableError(`port ${bound} is answered by another program on a loopback address`);
        }
        this.servers = listening.servers;
        this.current = { state: 'listening', port: bound, scope, skippedPorts };
        return this.current;
      } catch (error) {
        if (!(error instanceof PortUnavailableError)) {
          throw error;
        }
        console.warn(`${this.options.logTag} port ${port} is unavailable`, error.message);
        skippedPorts.push(port);
      }
    }
    this.current = { state: 'failed', reason: 'PORT_IN_USE', ports: [...ports] };
    return this.current;
  }

  private take(): Server[] {
    const servers = this.servers;
    this.servers = [];
    return servers;
  }

  private async listen(port: number, scope: ListenScope): Promise<Listening> {
    switch (scope) {
      case 'ipv4':
        return { servers: [await this.listenOn(port, '0.0.0.0')], hasIpv6: false };
      case 'all':
        try {
          return { servers: [await this.listenOn(port, '::')], hasIpv6: true };
        } catch (error) {
          if (!isNoIpv6(error)) {
            throw error;
          }
          console.warn(`${this.options.logTag} no IPv6, listening on 0.0.0.0`, error);
          return { servers: [await this.listenOn(port, '0.0.0.0')], hasIpv6: false };
        }
      case 'loopback': {
        const primary = await this.listenOn(port, '127.0.0.1');
        const bound = addressPort(primary);
        try {
          return { servers: [primary, await this.listenOn(bound, '::1')], hasIpv6: true };
        } catch (error) {
          if (!isNoIpv6(error)) {
            // ::1 上这个端口被别的程序占着：用 localhost 访问的调用方会连到那个程序，这个端口不能用。
            await drain([primary]);
            throw error;
          }
          console.warn(`${this.options.logTag} no IPv6 loopback, listening on 127.0.0.1:${bound} only`);
          return { servers: [primary], hasIpv6: false };
        }
      }
    }
  }

  private listenOn(port: number, host: string): Promise<Server> {
    const server = createServer((request, response) => this.dispatch(request, response));
    server.requestTimeout = this.options.requestTimeoutMs;
    server.maxConnections = this.options.maxConnections;
    this.options.configure?.(server);
    return new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.close();
        reject(
          error.code !== undefined && PORT_UNAVAILABLE_CODES.has(error.code)
            ? new PortUnavailableError(`${host}:${port} ${error.code}`)
            : error,
        );
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        server.on('error', (error) => console.error(`${this.options.logTag} server error`, error));
        resolve(server);
      });
    });
  }

  private dispatch(request: IncomingMessage, response: ServerResponse): void {
    if (request.headers[PROBE_HEADER] === this.probeToken) {
      response.writeHead(NO_CONTENT, { [PROBE_HEADER]: this.probeToken });
      response.end();
      return;
    }
    this.options.onRequest(request, response);
  }

  /**
   * Windows 上别的程序占着 127.0.0.1（或 ::1）的这个端口时，监听 :: 照样成功，本机的请求却会到那个程序：
   * 从两个回环地址各请求自己一次，回应不是自己的就当作端口不能用。
   */
  private async answersOnLoopback(port: number, hasIpv6: boolean): Promise<boolean> {
    const hosts = hasIpv6 ? ['127.0.0.1', '::1'] : ['127.0.0.1'];
    for (const host of hosts) {
      if (!(await this.answersOn(host, port))) {
        return false;
      }
    }
    return true;
  }

  private answersOn(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = httpRequest(
        {
          host,
          port,
          path: '/',
          headers: { [PROBE_HEADER]: this.probeToken },
          timeout: PROBE_TIMEOUT_MS,
          // 每次都开新连接：默认的连接池会复用上一次自检的连接，重启后那条连接已经被关掉了。
          agent: false,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode === NO_CONTENT && response.headers[PROBE_HEADER] === this.probeToken);
        },
      );
      probe.on('timeout', () => probe.destroy(new Error('probe timed out')));
      probe.on('error', (error) => {
        console.warn(`${this.options.logTag} self-check on ${host}:${port} failed: ${error.message}`);
        resolve(false);
      });
      probe.end();
    });
  }
}

/**
 * 关掉服务：先关空闲的保持连接，正在处理的请求给一点时间把回应发出去，到时间还没完就强行断开。
 */
function drain(servers: readonly Server[]): Promise<void> {
  return Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => server.closeAllConnections(), DRAIN_GRACE_MS);
          server.close(() => {
            clearTimeout(timer);
            resolve();
          });
          server.closeIdleConnections();
        }),
    ),
  ).then(() => undefined);
}

function isNoIpv6(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && NO_IPV6_CODES.has(code);
}

function addressPort(server: Server | undefined): number {
  const address = server?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Server has no TCP address');
  }
  return address.port;
}
```

（这些代码是从 `api/http-server.ts` 原样搬过来的，只把 `lanEnabled` 换成 `scope`、日志前缀换成 `logTag`、自检请求的判断挪进 `dispatch`。）

- [ ] **Step 4: `ApiHttpServer` 改用它**

`src/main/api/http-server.ts`：

1. 删掉 `DRAIN_GRACE_MS`、`PORT_UNAVAILABLE_CODES`、`NO_IPV6_CODES`、`PROBE_HEADER`、`PROBE_TIMEOUT_MS` 五个常量，`PortUnavailableError`、`Listening`，类里的 `servers`、`current`、`lifecycle`、`probeToken`、`startNow`、`take`、`listen`、`listenOn`、`answersOnLoopback`、`answersOn`，文件末尾的 `drain`、`isNoIpv6`、`addressPort`（都已搬走）。`NO_CONTENT` 预检还要用，留着。import 去掉 `randomUUID`、`createServer`、`request as httpRequest`、`Server`、`SerialQueue`，加 `import { HttpListener, type ListenStatus } from '../net/http-listener';`。
2. 类的字段和构造改为：

```ts
  private readonly listener: HttpListener;

  constructor(private readonly deps: ApiHttpServerDeps) {
    this.listener = new HttpListener({
      logTag: '[api]',
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxConnections: MAX_CONNECTIONS,
      onRequest: (request, response) => void this.serve(request, response),
    });
  }

  get status(): ApiServerStatus {
    return toApiStatus(this.listener.status);
  }

  /** 正在监听的端口；没有监听时为 null。 */
  port(): number | null {
    return this.listener.port();
  }

  async start(options: StartOptions): Promise<ApiServerStatus> {
    return toApiStatus(await this.listener.start(options.lanEnabled ? 'all' : 'loopback', options.ports));
  }

  stop(): Promise<void> {
    return this.listener.stop();
  }
```

3. `serve` 开头删掉自检那一段（`if (headers[PROBE_HEADER] === this.probeToken) { ... }`，已在 `HttpListener.dispatch` 里）。
4. 文件末尾加：

```ts
/** 共用监听的状态 → 本机接口的状态（界面按 lanEnabled 显示地址）。 */
function toApiStatus(status: ListenStatus): ApiServerStatus {
  return status.state === 'listening'
    ? { state: 'listening', port: status.port, lanEnabled: status.scope !== 'loopback', skippedPorts: status.skippedPorts }
    : status;
}
```

`src/main/api/local-api.ts`：删掉本文件的 `ANY_FREE_PORT` 常量，改从 `../net/http-listener` 导入 `ANY_FREE_PORT`、`portOrder`；`apiPortOrder` 的函数体换成 `return portOrder(settings.apiPort, settings.apiLastPort, candidatePorts);`。

- [ ] **Step 5: 局域网地址和网卡**

`src/main/api/network.ts`：

1. `InterfaceAddress` 加 `netmask: string;`。
2. 把 `lanIPv4Addresses` 换成下面三个函数（规则不变，只是保留网卡名和掩码）：

```ts
/** 一块局域网网卡（IPv4）。 */
export interface LanInterface {
  name: string;
  address: string;
  netmask: string;
}

/**
 * 这台电脑在局域网里的 IPv4 网卡：按网卡的特征去掉虚拟机、容器、代理和 VPN 的虚拟网卡，只留私有网段的；
 * 规则判断不了、全被去掉时退回列出所有对外的：宁可多列，也不能一个都不给。
 */
export function lanIPv4Interfaces(interfaces: NodeJS.Dict<readonly InterfaceAddress[]>): LanInterface[] {
  const external = Object.entries(interfaces).flatMap(([name, items]) =>
    (items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal && !item.address.startsWith(LINK_LOCAL_PREFIX))
      .map((item) => ({ name, ...item })),
  );
  const physical = external.filter(
    (item) =>
      isPrivateIPv4(item.address) &&
      item.mac.toLowerCase() !== NO_HARDWARE_MAC &&
      !VIRTUAL_MAC_PREFIXES.some((prefix) => item.mac.toLowerCase().startsWith(prefix)) &&
      !VIRTUAL_NAME_PATTERN.test(item.name),
  );
  return (physical.length > 0 ? physical : external).map(({ name, address, netmask }) => ({ name, address, netmask }));
}

/** 这台电脑在局域网里的 IPv4 地址（给配置中心显示，让操作员填到别的电脑上）。 */
export function lanIPv4Addresses(interfaces: NodeJS.Dict<readonly InterfaceAddress[]>): string[] {
  return lanIPv4Interfaces(interfaces).map((item) => item.address);
}
```

3. 文件末尾加：

```ts
/** 去掉 IPv4 映射前缀（::ffff:192.168.1.23 → 192.168.1.23）：监听 :: 时 IPv4 连接显示成这种形式。 */
export function plainAddress(address: string): string {
  return address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX) ? address.slice(IPV4_MAPPED_PREFIX.length) : address;
}

/**
 * 局域网里来的连接（局域网共享只接受这些）：私有网段（RFC 1918）、链路本地（169.254/16，两台电脑直连时用）、本机回环。
 * 共享只监听 IPv4，IPv6 一律不算；代理的 198.18/15、运营商级 NAT 和 Tailscale 的 100.64/10 都不算局域网。
 */
export function isLanClientAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const plain = plainAddress(address);
  return (
    isIP(plain) === 4 &&
    (isPrivateIPv4(plain) || plain.startsWith(LINK_LOCAL_PREFIX) || plain.startsWith(IPV4_LOOPBACK_PREFIX))
  );
}

const BITS_PER_OCTET = 8;

function ipv4Number(address: string): number {
  return address.split('.').reduce((sum, part) => sum * 2 ** BITS_PER_OCTET + Number(part), 0);
}

/** 两个 IPv4 地址在不在掩码划出的同一个子网里（mDNS 按对方的地址选从哪块网卡回答）。 */
export function isSameSubnet(a: string, b: string, netmask: string): boolean {
  const mask = ipv4Number(netmask);
  return ((ipv4Number(a) & mask) >>> 0) === ((ipv4Number(b) & mask) >>> 0);
}
```

（`LINK_LOCAL_PREFIX` 现在定义在 `isLoopbackHost` 之后，为了好读把它挪到文件开头和 `IPV4_MAPPED_PREFIX`、`IPV4_LOOPBACK_PREFIX` 放在一起。）

- [ ] **Step 6: 跑测试**

Run: `bun test src/main/net src/main/api`
Expected: PASS——`http-server.test.ts`、`local-api.test.ts` 一字未改照样通过，说明抽取没有改变本机接口的行为。

- [ ] **Step 7: `bun run check && bun run test:e2e` 后提交**

```bash
git add src/main/net src/main/api/http-server.ts src/main/api/local-api.ts src/main/api/network.ts src/main/api/network.test.ts
git commit -m "refactor(api): share port fallback and self-check through HttpListener" -m "LAN sharing needs the same port fallback, loopback self-check and graceful restart as the local API, so that part moves to net/http-listener.ts unchanged, with an IPv4-only scope added. The local API tests pass untouched. network.ts gains LAN client address checks and network cards with netmasks for mDNS." -m "$TRAILER"
```

---

### Task 13: 共享密码、电脑的允许 / 拒绝

- **共享密码**：存 scrypt 摘要和随机盐（见「关键决定」第 6 条），校验在 libuv 线程池里做（`crypto.scrypt` 异步），不卡主进程。
- **新电脑**：第一次打印时等操作员点「允许 / 拒绝」；同一台电脑后来的任务排进同一个询问；2 分钟没人点就按超时处理；最多 3 台同时等；决定按地址记进 `ipp_clients`（最多 200 台，满了删最早的）。没在等的地址来的「允许」不理（和网站询问一样，防伪造）。

**Files:**
- Create: `src/shared/ipp-sharing.ts`、`src/shared/ipp-sharing.test.ts`
- Create: `src/main/ipp/share-password.ts`、`src/main/ipp/share-password.test.ts`
- Create: `src/main/ipp/client-approvals.ts`、`src/main/ipp/client-approvals.test.ts`
- Create: `src/main/storage/sqlite-ipp-store.ts`、`src/main/storage/sqlite-ipp-store.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/shared/ipp-sharing.test.ts
import { describe, expect, test } from 'bun:test';
import { isValidSharePassword } from './ipp-sharing';

describe('isValidSharePassword', () => {
  test('takes 4 to 64 characters without control characters', () => {
    expect(isValidSharePassword('1234')).toBe(true);
    expect(isValidSharePassword('前台:打印 2026')).toBe(true);
    expect(isValidSharePassword('123')).toBe(false);
    expect(isValidSharePassword('x'.repeat(65))).toBe(false);
    expect(isValidSharePassword('12\n34')).toBe(false);
    expect(isValidSharePassword(1234)).toBe(false);
  });
});
```

```ts
// src/main/ipp/share-password.test.ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { parseBasicAuth, SharePassword, type SharePasswordStore, type StoredPassword } from './share-password';

class MemoryStore implements SharePasswordStore {
  stored: StoredPassword | null = null;

  readPassword(): StoredPassword | null {
    return this.stored;
  }

  writePassword(password: StoredPassword): void {
    this.stored = password;
  }

  clearPassword(): void {
    this.stored = null;
  }
}

describe('SharePassword', () => {
  test('keeps only a salted digest and checks passwords against it', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    expect(password.isSet()).toBe(false);
    await password.set('前台1234');
    expect(password.isSet()).toBe(true);
    expect(new TextDecoder().decode(store.stored?.hash)).not.toContain('前台1234');
    expect(await password.verify('前台1234')).toBe(true);
    expect(await password.verify('前台12345')).toBe(false);
  });

  test('uses a new salt every time', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    await password.set('1234');
    const first = store.stored;
    await password.set('1234');
    expect(store.stored?.salt).not.toEqual(first?.salt);
  });

  test('refuses an invalid password and forgets a cleared one', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    await expect(password.set('12')).rejects.toThrow('Invalid share password');
    await password.set('1234');
    password.clear();
    expect(password.isSet()).toBe(false);
    expect(await password.verify('1234')).toBe(false);
  });
});

describe('parseBasicAuth', () => {
  test('reads the user and the password after the first colon', () => {
    const header = `Basic ${Buffer.from('zhang:a:b').toString('base64')}`;
    expect(parseBasicAuth(header)).toEqual({ user: 'zhang', password: 'a:b' });
    expect(parseBasicAuth(`basic ${Buffer.from(':1234').toString('base64')}`)).toEqual({ user: '', password: '1234' });
  });

  test('returns null for other schemes or malformed values', () => {
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth('Bearer x')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('no-colon').toString('base64')}`)).toBeNull();
  });
});
```

```ts
// src/main/ipp/client-approvals.test.ts
import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { type ClientDecisionStore, ClientApprovals, IPP_APPROVAL, type PendingClient, type RememberedClient } from './client-approvals';

class MemoryDecisions implements ClientDecisionStore {
  readonly clients = new Map<string, RememberedClient>();

  decisionOf(address: string): 'allow' | 'deny' | null {
    return this.clients.get(address)?.decision ?? null;
  }

  saveDecision(client: RememberedClient): void {
    this.clients.set(client.address, client);
  }

  removeDecision(address: string): void {
    this.clients.delete(address);
  }

  listDecisions(): RememberedClient[] {
    return [...this.clients.values()];
  }
}

function createApprovals() {
  const store = new MemoryDecisions();
  const timers: Array<{ run: () => void; delayMs: number }> = [];
  const notified: PendingClient[] = [];
  let changes = 0;
  const approvals = new ClientApprovals({
    store,
    clock: new FakeClock(),
    schedule: (run, delayMs) => {
      const timer = { run, delayMs };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    notify: (client) => notified.push(client),
    onChange: () => {
      changes += 1;
    },
  });
  return { approvals, store, timers, notified, changes: () => changes };
}

describe('ClientApprovals', () => {
  test('asks about a new computer once and remembers the answer', async () => {
    const { approvals, store, notified } = createApprovals();
    expect(approvals.decisionFor('192.168.1.23')).toBe('ask');
    const first = approvals.waitFor('192.168.1.23', 'zhang', '60×40 标签');
    const second = approvals.waitFor('192.168.1.23', 'zhang', '60×40 标签');
    expect(notified).toHaveLength(1);
    expect(approvals.pending()).toMatchObject([{ address: '192.168.1.23', user: 'zhang', jobs: 2 }]);
    approvals.decide('192.168.1.23', true);
    expect(await first).toBe('allowed');
    expect(await second).toBe('allowed');
    expect(store.decisionOf('192.168.1.23')).toBe('allow');
    expect(approvals.decisionFor('192.168.1.23')).toBe('allowed');
    expect(await approvals.waitFor('192.168.1.23', 'zhang', '60×40 标签')).toBe('allowed');
  });

  test('remembers a refusal', async () => {
    const { approvals } = createApprovals();
    const waiting = approvals.waitFor('192.168.1.23', '', '60×40 标签');
    approvals.decide('192.168.1.23', false);
    expect(await waiting).toBe('denied');
    expect(approvals.decisionFor('192.168.1.23')).toBe('denied');
  });

  test('gives up after two minutes without remembering anything', async () => {
    const { approvals, timers } = createApprovals();
    const waiting = approvals.waitFor('192.168.1.23', '', '60×40 标签');
    expect(timers[0]?.delayMs).toBe(IPP_APPROVAL.timeoutMs);
    timers[0]?.run();
    expect(await waiting).toBe('timeout');
    expect(approvals.pending()).toEqual([]);
    expect(approvals.decisionFor('192.168.1.23')).toBe('ask');
  });

  test('lets at most three computers wait at once', async () => {
    const { approvals } = createApprovals();
    for (const address of ['192.168.1.1', '192.168.1.2', '192.168.1.3']) {
      void approvals.waitFor(address, '', 'P');
    }
    expect(await approvals.waitFor('192.168.1.4', '', 'P')).toBe('busy');
  });

  test('ignores answers for computers that are not waiting', () => {
    const { approvals, store } = createApprovals();
    approvals.decide('192.168.1.23', true);
    expect(store.decisionOf('192.168.1.23')).toBeNull();
  });

  test('forgets a decision and settles everyone waiting when sharing stops', async () => {
    const { approvals } = createApprovals();
    const waiting = approvals.waitFor('192.168.1.23', '', 'P');
    approvals.dispose();
    expect(await waiting).toBe('timeout');
    void approvals.waitFor('192.168.1.24', '', 'P');
    approvals.decide('192.168.1.24', false);
    approvals.forget('192.168.1.24');
    expect(approvals.decisionFor('192.168.1.24')).toBe('ask');
  });
});
```

```ts
// src/main/storage/sqlite-ipp-store.test.ts
import { describe, expect, test } from 'bun:test';
import { MAX_REMEMBERED_CLIENTS } from '../ipp/client-approvals';
import { openDatabase } from './database';
import { SqliteIppStore } from './sqlite-ipp-store';

describe('SqliteIppStore', () => {
  test('remembers one decision per computer, newest first', () => {
    const store = new SqliteIppStore(openDatabase(':memory:'));
    store.saveDecision({ address: '192.168.1.23', decision: 'allow', lastUser: 'zhang', decidedAt: 1 });
    store.saveDecision({ address: '192.168.1.24', decision: 'deny', lastUser: '', decidedAt: 2 });
    store.saveDecision({ address: '192.168.1.23', decision: 'deny', lastUser: 'li', decidedAt: 3 });
    expect(store.decisionOf('192.168.1.23')).toBe('deny');
    expect(store.listDecisions().map((client) => client.address)).toEqual(['192.168.1.23', '192.168.1.24']);
    store.removeDecision('192.168.1.23');
    expect(store.decisionOf('192.168.1.23')).toBeNull();
  });

  test('keeps at most the newest remembered computers', () => {
    const store = new SqliteIppStore(openDatabase(':memory:'));
    for (let index = 0; index <= MAX_REMEMBERED_CLIENTS; index += 1) {
      store.saveDecision({ address: `10.0.${Math.floor(index / 256)}.${index % 256}`, decision: 'allow', lastUser: '', decidedAt: index });
    }
    expect(store.listDecisions()).toHaveLength(MAX_REMEMBERED_CLIENTS);
    expect(store.decisionOf('10.0.0.0')).toBeNull();
  });

  test('stores one password digest', () => {
    const store = new SqliteIppStore(openDatabase(':memory:'));
    expect(store.readPassword()).toBeNull();
    store.writePassword({ salt: Uint8Array.of(1, 2), hash: Uint8Array.of(3, 4) }, 10);
    store.writePassword({ salt: Uint8Array.of(5), hash: Uint8Array.of(6) }, 11);
    expect(store.readPassword()).toEqual({ salt: Uint8Array.of(5), hash: Uint8Array.of(6) });
    store.clearPassword();
    expect(store.readPassword()).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/ipp-sharing.test.ts src/main/ipp src/main/storage/sqlite-ipp-store.test.ts`
Expected: FAIL，几个模块都不存在。

- [ ] **Step 3: 实现**

```ts
// src/shared/ipp-sharing.ts
/** 局域网共享里主进程和界面共用的规则和类型。设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 8.1 节。 */

/** 默认端口 8631：macOS 的 631 是 CUPS 的（主进程依次试 8631–8640，界面上的说明也按它写）。 */
export const DEFAULT_IPP_PORT = 8631;

/** 共享密码 4–64 个字：短于 4 个字随手就能试出来；再长没有意义（明文 HTTP 上本来就能被抓包）。 */
export const SHARE_PASSWORD_LENGTH = { min: 4, max: 64 } as const;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 密码里不允许任何控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function isValidSharePassword(value: unknown): value is string {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) {
    return false;
  }
  const length = [...value].length;
  return length >= SHARE_PASSWORD_LENGTH.min && length <= SHARE_PASSWORD_LENGTH.max;
}
```

```ts
// src/main/ipp/share-password.ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../core/types';
import { isValidSharePassword } from '../../shared/ipp-sharing';

/** scrypt 的代价参数 N = 2^14（Node 的默认值）：一次约 50ms，添加打印机感觉不到，局域网里猜密码猜不快。 */
const SCRYPT_COST = 16_384;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const BASIC_PREFIX = 'basic ';

/** 存下来的只有盐和摘要，没有原文。 */
export interface StoredPassword {
  salt: Uint8Array;
  hash: Uint8Array;
}

export interface SharePasswordStore {
  readPassword(): StoredPassword | null;
  writePassword(password: StoredPassword, at: number): void;
  clearPassword(): void;
}

function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, { N: SCRYPT_COST }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

/**
 * 共享密码：只存 scrypt 摘要（校验只需要比对，不需要取回原文）。原文只在设置时经过一次，不写日志。
 * 局域网里的电脑按 HTTP 基本认证交来，用户名不核对（共享只有一个密码）。
 */
export class SharePassword {
  constructor(
    private readonly store: SharePasswordStore,
    private readonly clock: Clock,
  ) {}

  isSet(): boolean {
    return this.store.readPassword() !== null;
  }

  /** @throws Error 密码不合规则（界面会先拦下，到这里说明页面出了问题） */
  async set(password: string): Promise<void> {
    if (!isValidSharePassword(password)) {
      throw new Error('Invalid share password');
    }
    const salt = randomBytes(SALT_BYTES);
    this.store.writePassword({ salt, hash: await derive(password, salt) }, this.clock.now());
  }

  clear(): void {
    this.store.clearPassword();
  }

  /** 没设密码时返回 false（调用方只在设了密码时才校验）。比较用 timingSafeEqual，不按耗时泄露信息。 */
  async verify(password: string): Promise<boolean> {
    const stored = this.store.readPassword();
    if (stored === null) {
      return false;
    }
    const key = await derive(password, stored.salt);
    return key.length === stored.hash.length && timingSafeEqual(key, stored.hash);
  }
}

/** Authorization: Basic base64(用户名:密码)；不是基本认证或格式不对返回 null。 */
export function parseBasicAuth(header: string | undefined): { user: string; password: string } | null {
  if (header === undefined || header.slice(0, BASIC_PREFIX.length).toLowerCase() !== BASIC_PREFIX) {
    return null;
  }
  const decoded = Buffer.from(header.slice(BASIC_PREFIX.length).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon < 0 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
```

```ts
// src/main/ipp/client-approvals.ts
import type { ClientDecision } from '../../core/ipp/ipp-operations';
import type { Clock } from '../../core/types';

export const IPP_APPROVAL = {
  /** 等操作员点「允许」最多 2 分钟：再久对方的打印队列早就报错了，操作员多半也不在电脑前。 */
  timeoutMs: 2 * 60_000,
  /** 同时等确认的电脑最多 3 台：和网站询问一样，不让询问条刷满屏。 */
  maxPending: 3,
} as const;
/** 记住的电脑最多 200 台：一个店、一个仓库的电脑远到不了，挡住换着地址刷出来的记录。 */
export const MAX_REMEMBERED_CLIENTS = 200;

export type ApprovalResult = 'allowed' | 'denied' | 'timeout' | 'busy';

/** 记住的一台电脑：按 IPv4 地址。 */
export interface RememberedClient {
  address: string;
  decision: 'allow' | 'deny';
  /** 做决定时它报的用户名（界面上帮操作员认是哪台）。 */
  lastUser: string;
  decidedAt: number;
}

export interface ClientDecisionStore {
  decisionOf(address: string): 'allow' | 'deny' | null;
  saveDecision(client: RememberedClient): void;
  removeDecision(address: string): void;
  /** 最近决定的在前。 */
  listDecisions(): RememberedClient[];
}

/** 正在等确认的一台电脑。 */
export interface PendingClient {
  address: string;
  user: string;
  /** 它要打到哪台共享打印机（第一个任务的）。 */
  printerName: string;
  /** 在等的任务数。 */
  jobs: number;
  since: number;
}

export interface ClientApprovalsDeps {
  store: ClientDecisionStore;
  clock: Clock;
  schedule: (run: () => void, delayMs: number) => () => void;
  /** 有新电脑在等确认：发系统通知，提醒操作员到程序里处理。 */
  notify: (client: PendingClient) => void;
  /** 等确认的列表或记住的电脑变了：推给界面。 */
  onChange: () => void;
}

interface Waiting {
  client: PendingClient;
  resolvers: Array<(result: ApprovalResult) => void>;
  cancelTimer: () => void;
}

/**
 * 新电脑第一次打印：先问操作员。不弹系统对话框（模态框会抢走焦点，扫码枪敲的回车可能正好点中「允许」），
 * 而是在程序顶部的询问条里用鼠标点，同时发系统通知。决定按地址记住，在「局域网共享」页可以撤销。
 */
export class ClientApprovals {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly deps: ClientApprovalsDeps) {}

  decisionFor(address: string): ClientDecision {
    switch (this.deps.store.decisionOf(address)) {
      case 'allow':
        return 'allowed';
      case 'deny':
        return 'denied';
      case null:
        return 'ask';
    }
  }

  /** 一个任务要等这台电脑的确认；已经有决定的直接返回。同一台电脑的任务排进同一个询问。 */
  waitFor(address: string, user: string, printerName: string): Promise<ApprovalResult> {
    const decided = this.decisionFor(address);
    if (decided !== 'ask') {
      return Promise.resolve(decided);
    }
    const existing = this.waiting.get(address);
    if (existing === undefined && this.waiting.size >= IPP_APPROVAL.maxPending) {
      return Promise.resolve('busy');
    }
    return new Promise((resolve) => {
      if (existing !== undefined) {
        existing.client.jobs += 1;
        existing.resolvers.push(resolve);
        this.deps.onChange();
        return;
      }
      const client: PendingClient = { address, user, printerName, jobs: 1, since: this.deps.clock.now() };
      const cancelTimer = this.deps.schedule(() => this.settle(address, 'timeout'), IPP_APPROVAL.timeoutMs);
      this.waiting.set(address, { client, resolvers: [resolve], cancelTimer });
      this.deps.notify({ ...client });
      this.deps.onChange();
    });
  }

  /** 操作员点了「允许」或「拒绝」。不在等的地址（已超时作废、伪造的请求）不理。 */
  decide(address: string, allow: boolean): void {
    const waiting = this.waiting.get(address);
    if (waiting === undefined) {
      return;
    }
    this.deps.store.saveDecision({
      address,
      decision: allow ? 'allow' : 'deny',
      lastUser: waiting.client.user,
      decidedAt: this.deps.clock.now(),
    });
    this.settle(address, allow ? 'allowed' : 'denied');
  }

  /** 撤销对一台电脑的决定：它下次打印时重新问。 */
  forget(address: string): void {
    this.deps.store.removeDecision(address);
    this.deps.onChange();
  }

  /** 正在等确认的电脑，先来的在前。 */
  pending(): PendingClient[] {
    return [...this.waiting.values()].map(({ client }) => ({ ...client }));
  }

  remembered(): RememberedClient[] {
    return this.deps.store.listDecisions();
  }

  /** 关掉共享：还在等的任务都按超时处理（对方会看到任务中止）。 */
  dispose(): void {
    for (const address of [...this.waiting.keys()]) {
      this.settle(address, 'timeout');
    }
  }

  private settle(address: string, result: ApprovalResult): void {
    const waiting = this.waiting.get(address);
    if (waiting === undefined) {
      return;
    }
    this.waiting.delete(address);
    waiting.cancelTimer();
    for (const resolve of waiting.resolvers) {
      resolve(result);
    }
    this.deps.onChange();
  }
}
```

```ts
// src/main/storage/sqlite-ipp-store.ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type ClientDecisionStore, MAX_REMEMBERED_CLIENTS, type RememberedClient } from '../ipp/client-approvals';
import type { SharePasswordStore, StoredPassword } from '../ipp/share-password';
import { readEnum, readInteger, readString } from './row-readers';

const DECISIONS = ['allow', 'deny'] as const;

/** 局域网共享的两张表：记住的电脑（ipp_clients）、共享密码的摘要（ipp_share_password，只一行）。 */
export class SqliteIppStore implements ClientDecisionStore, SharePasswordStore {
  private readonly selectDecision: StatementSync;
  private readonly upsertDecision: StatementSync;
  private readonly trimDecisions: StatementSync;
  private readonly deleteDecision: StatementSync;
  private readonly selectDecisions: StatementSync;
  private readonly selectPassword: StatementSync;
  private readonly upsertPassword: StatementSync;
  private readonly deletePassword: StatementSync;

  constructor(db: DatabaseSync) {
    this.selectDecision = db.prepare('SELECT decision FROM ipp_clients WHERE address = :address');
    this.upsertDecision = db.prepare(`
      INSERT INTO ipp_clients (address, decision, last_user, decided_at) VALUES (:address, :decision, :lastUser, :decidedAt)
      ON CONFLICT (address) DO UPDATE SET decision = excluded.decision, last_user = excluded.last_user, decided_at = excluded.decided_at`);
    this.trimDecisions = db.prepare(`
      DELETE FROM ipp_clients WHERE address NOT IN (SELECT address FROM ipp_clients ORDER BY decided_at DESC LIMIT :keep)`);
    this.deleteDecision = db.prepare('DELETE FROM ipp_clients WHERE address = :address');
    this.selectDecisions = db.prepare(
      'SELECT address, decision, last_user AS lastUser, decided_at AS decidedAt FROM ipp_clients ORDER BY decided_at DESC',
    );
    this.selectPassword = db.prepare('SELECT salt, hash FROM ipp_share_password WHERE id = 1');
    this.upsertPassword = db.prepare(`
      INSERT INTO ipp_share_password (id, salt, hash, updated_at) VALUES (1, :salt, :hash, :at)
      ON CONFLICT (id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, updated_at = excluded.updated_at`);
    this.deletePassword = db.prepare('DELETE FROM ipp_share_password');
  }

  decisionOf(address: string): 'allow' | 'deny' | null {
    const row = this.selectDecision.get({ address });
    return row === undefined ? null : readEnum(row, 'decision', DECISIONS);
  }

  saveDecision(client: RememberedClient): void {
    this.upsertDecision.run({
      address: client.address,
      decision: client.decision,
      lastUser: client.lastUser,
      decidedAt: client.decidedAt,
    });
    this.trimDecisions.run({ keep: MAX_REMEMBERED_CLIENTS });
  }

  removeDecision(address: string): void {
    this.deleteDecision.run({ address });
  }

  listDecisions(): RememberedClient[] {
    return this.selectDecisions.all().map((row) => ({
      address: readString(row, 'address'),
      decision: readEnum(row, 'decision', DECISIONS),
      lastUser: readString(row, 'lastUser'),
      decidedAt: readInteger(row, 'decidedAt'),
    }));
  }

  /** 读出的行也不全信：盐和摘要必须是字节。 */
  readPassword(): StoredPassword | null {
    const row = this.selectPassword.get();
    if (row === undefined) {
      return null;
    }
    const salt = row['salt'];
    const hash = row['hash'];
    if (!(salt instanceof Uint8Array) || !(hash instanceof Uint8Array)) {
      throw new Error('ipp_share_password has a malformed row');
    }
    return { salt, hash };
  }

  writePassword(password: StoredPassword, at: number): void {
    this.upsertPassword.run({ salt: password.salt, hash: password.hash, at });
  }

  clearPassword(): void {
    this.deletePassword.run();
  }
}
```

（`readEnum` 的签名是 `readEnum<T extends string>(row, column, allowed: readonly T[]): T`；如果 `readString` 不接受空字符串（`last_user` 可以是空的），`lastUser` 改为先核对 `typeof row['lastUser'] === 'string'` 再取。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/ipp-sharing.test.ts src/main/ipp src/main/storage/sqlite-ipp-store.test.ts`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/shared/ipp-sharing.ts src/shared/ipp-sharing.test.ts src/main/ipp/share-password.ts src/main/ipp/share-password.test.ts src/main/ipp/client-approvals.ts src/main/ipp/client-approvals.test.ts src/main/storage/sqlite-ipp-store.ts src/main/storage/sqlite-ipp-store.test.ts
git commit -m "feat(ipp): share password digest and per-computer approvals" -m "The optional share password is kept as a salted scrypt digest because checking Basic credentials never needs the plain text; it stays out of the secrets table that HTTP lookup steps can reference. A new computer waits for the operator for two minutes at most, its later jobs join the same question, and the decision is remembered by address and can be revoked." -m "$TRAILER"
```

---

### Task 14: IPP over HTTP

IPP 跑在 HTTP 的 POST 上（RFC 8010 §4），`Content-Type: application/ipp`。顺序是：连接一建立就按地址过滤（不是局域网就断开）→ 按地址限速 → 路由（只有 `/printers/<纸张键>` 和它下面的 `/jobs/<编号>`；GET 给一个说明页）→ **先认证再读正文**：设了共享密码而请求没带对的，最多只读 64KB（够 Get-Printer-Attributes，挡住没认证的大文档），要打印、校验、取消的操作回 401 让对方弹出输密码；带 `Expect: 100-continue` 的大请求在看过认证和大小之后才让对方发正文 → 正文上限（50MB + 64KB）→ 解码 → 交给 core 的 `handleIppRequest` → 回 200。网址里的主机用对方请求时的 `Host`（对方就是用它连上来的），不合规时用这台电脑的局域网地址。

**Files:**
- Create: `src/main/ipp/ipp-pages.ts`、`src/main/ipp/ipp-pages.test.ts`
- Create: `src/main/ipp/ipp-http-server.ts`、`src/main/ipp/ipp-http-server.test.ts`
- Create: `src/main/ipp/testing/ipp-client.ts`

- [ ] **Step 1: 测试用的 IPP 客户端**（E2E 也用它）

```ts
// src/main/ipp/testing/ipp-client.ts
import { decodeIppMessage, encodeIppMessage, type IppMessage } from '../../../core/ipp/ipp-codec';

export interface IppReply {
  httpStatus: number;
  headers: Headers;
  /** 回复是 application/ipp 时解出来的报文；HTTP 层就拒绝了（401、404……）时为 null。 */
  message: IppMessage | null;
}

/** 测试和 E2E 用的 IPP 客户端：把报文和文档 POST 过去，解出回复。 */
export async function sendIpp(
  url: string,
  message: IppMessage,
  data: Uint8Array = new Uint8Array(0),
  headers: Record<string, string> = {},
): Promise<IppReply> {
  const head = encodeIppMessage(message);
  const body = new Uint8Array(head.length + data.length);
  body.set(head, 0);
  body.set(data, head.length);
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/ipp', ...headers }, body });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isIpp = (response.headers.get('content-type') ?? '').startsWith('application/ipp');
  return { httpStatus: response.status, headers: response.headers, message: isIpp ? decodeIppMessage(bytes).message : null };
}

/** HTTP 基本认证的请求头。 */
export function basicAuth(user: string, password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}
```

- [ ] **Step 2: 写测试**

```ts
// src/main/ipp/ipp-pages.test.ts
import { describe, expect, test } from 'bun:test';
import { testPrinter } from '../../core/ipp/testing/ipp-requests';
import { escapeHtml, printerListPage, printerPage } from './ipp-pages';

describe('ipp pages', () => {
  test('escape everything that comes from names', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(printerPage(testPrinter({ location: '<script>' }))).not.toContain('<script>');
  });

  test('list the shared printers with links', () => {
    const page = printerListPage([testPrinter()]);
    expect(page).toContain('href="/printers/60x40"');
    expect(page).toContain('60×40 标签');
  });
});
```

```ts
// src/main/ipp/ipp-http-server.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { integerAttr, nameAttr, stringValue } from '../../core/ipp/ipp-attributes';
import { GROUP_TAGS, OPERATIONS, STATUS } from '../../core/ipp/ipp-constants';
import { IppJobBook } from '../../core/ipp/ipp-job-book';
import type { ClientDecision } from '../../core/ipp/ipp-operations';
import { attributeIn, ippRequest, MINIMAL_PDF, testPrinter } from '../../core/ipp/testing/ipp-requests';
import { FakeClock } from '../../core/testing/fake-clock';
import { type AcceptedJob, IPP_HTTP_LIMITS, IppHttpServer } from './ipp-http-server';
import { basicAuth, sendIpp } from './testing/ipp-client';

const PRINTER = testPrinter();
const servers: IppHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

interface Options {
  password?: string;
  decision?: ClientDecision;
  limits?: Partial<typeof IPP_HTTP_LIMITS>;
}

function createServer(options: Options = {}) {
  const clock = new FakeClock();
  const book = new IppJobBook(clock);
  const accepted: AcceptedJob[] = [];
  let isAllowed = true;
  const server = new IppHttpServer({
    clock,
    printers: () => new Map([[PRINTER.key, PRINTER]]),
    book,
    password: {
      isSet: () => options.password !== undefined,
      verify: async (value) => value === options.password,
    },
    decisionFor: () => options.decision ?? 'allowed',
    onAccepted: (job) => accepted.push(job),
    fallbackHost: () => '192.168.1.10',
    isAllowedAddress: () => isAllowed,
    limits: options.limits,
  });
  servers.push(server);
  return {
    server,
    book,
    accepted,
    refuseEveryone: () => {
      isAllowed = false;
    },
  };
}

async function start(server: IppHttpServer): Promise<{ base: string; url: string }> {
  const status = await server.start([0]);
  if (status.state !== 'listening') {
    throw new Error(`not listening: ${JSON.stringify(status)}`);
  }
  const base = `http://127.0.0.1:${status.port}`;
  return { base, url: `${base}/printers/60x40` };
}

describe('IppHttpServer', () => {
  test('answers Get-Printer-Attributes with URIs built from the Host the client used', async () => {
    const { server } = createServer();
    const { url, base } = await start(server);
    const reply = await sendIpp(url, ippRequest(OPERATIONS.getPrinterAttributes));
    expect(reply.httpStatus).toBe(200);
    expect(reply.message?.code).toBe(STATUS.ok);
    expect(stringValue(attributeIn(reply.message ?? ippRequest(0), GROUP_TAGS.printer, 'printer-name'))).toBe('60×40 标签');
    expect(stringValue(attributeIn(reply.message ?? ippRequest(0), GROUP_TAGS.printer, 'printer-uri-supported'))).toBe(
      `${base.replace('http:', 'ipp:')}/printers/60x40`,
    );
  });

  test('accepts a print job and hands the document over', async () => {
    const { server, accepted } = createServer();
    const { url } = await start(server);
    const reply = await sendIpp(url, ippRequest(OPERATIONS.printJob, { operation: [nameAttr('job-name', '面单')] }), MINIMAL_PDF);
    expect(reply.message?.code).toBe(STATUS.ok);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ printer: { key: '60x40' }, job: { name: '面单', client: '127.0.0.1' }, needsApproval: false });
    expect(accepted[0]?.document.data).toEqual(MINIMAL_PDF);
  });

  test('answers 404 for a paper that is not shared and 400 for what is not IPP', async () => {
    const { server } = createServer();
    const { base, url } = await start(server);
    expect((await sendIpp(`${base}/printers/100x150`, ippRequest(OPERATIONS.getPrinterAttributes))).httpStatus).toBe(404);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/ipp' }, body: 'xx' })).status).toBe(400);
    expect((await fetch(url, { method: 'PUT' })).status).toBe(405);
  });

  test('asks for the share password before taking or cancelling jobs, but not to describe the printer', async () => {
    const { server, accepted } = createServer({ password: '1234' });
    const { url } = await start(server);
    expect((await sendIpp(url, ippRequest(OPERATIONS.getPrinterAttributes))).httpStatus).toBe(200);
    const anonymous = await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF);
    expect(anonymous.httpStatus).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain('Basic realm=');
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF, basicAuth('zhang', 'wrong'))).httpStatus).toBe(401);
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF, basicAuth('zhang', '1234'))).message?.code).toBe(STATUS.ok);
    expect((await sendIpp(url, ippRequest(OPERATIONS.cancelJob, { operation: [integerAttr('job-id', 1)] }))).httpStatus).toBe(401);
    expect(accepted).toHaveLength(1);
  });

  test('refuses a large upload without the password before reading it', async () => {
    const { server, accepted } = createServer({ password: '1234' });
    const { url } = await start(server);
    const big = new Uint8Array(IPP_HTTP_LIMITS.unauthenticatedBytes + 1);
    big.set(MINIMAL_PDF);
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), big)).httpStatus).toBe(401);
    expect(accepted).toEqual([]);
  });

  test('refuses a document over the limit', async () => {
    const { server, accepted } = createServer({ limits: { requestBytes: 2048 } });
    const { url } = await start(server);
    const big = new Uint8Array(4096);
    big.set(MINIMAL_PDF);
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), big)).httpStatus).toBe(413);
    expect(accepted).toEqual([]);
  });

  test('serves a plain status page to browsers', async () => {
    const { server } = createServer();
    const { url } = await start(server);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await response.text()).toContain('60×40 标签');
  });

  test('drops connections from addresses outside the LAN', async () => {
    const { server, refuseEveryone } = createServer();
    const { url } = await start(server);
    refuseEveryone();
    await expect(fetch(url)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/ipp`
Expected: FAIL，`Cannot find module './ipp-pages'`、`'./ipp-http-server'`。

- [ ] **Step 4: 实现**

```ts
// src/main/ipp/ipp-pages.ts
import type { SharedPrinter } from '../../core/ipp/shared-printer';

/** 浏览器打开打印机网址（printer-more-info、Bonjour 的 adminurl）时看到的说明页：纯文字，没有脚本。 */

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;margin:2em;line-height:1.6">${body}</body></html>`;
}

/** 一台共享打印机：名字、在哪台电脑上、现在的状态，和怎么添加。 */
export function printerPage(printer: SharedPrinter): string {
  return page(
    printer.name,
    [
      `<h1>${escapeHtml(printer.name)}</h1>`,
      `<p>${escapeHtml(printer.location)} 上共享的热敏标签机，打印到「${escapeHtml(printer.name)}」这种纸。</p>`,
      `<p>状态：${escapeHtml(printer.state.message)}</p>`,
      '<p>在 Windows 的「添加打印机」里选「按名称选择共享打印机」，填这一页的网址；macOS 在「打印机与扫描仪」里会自动找到它。</p>',
    ].join(''),
  );
}

/** 这台电脑共享的全部打印机。 */
export function printerListPage(printers: readonly SharedPrinter[]): string {
  const items = printers
    .map((printer) => `<li><a href="/printers/${escapeHtml(printer.key)}">${escapeHtml(printer.name)}</a></li>`)
    .join('');
  return page('共享的热敏标签机', `<h1>共享的热敏标签机</h1><ul>${items}</ul>`);
}
```

```ts
// src/main/ipp/ipp-http-server.ts
import { createHash } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { type DecodedIpp, decodeIppMessage, encodeIppMessage, IPP_DECODE_LIMITS, IppDecodeError } from '../../core/ipp/ipp-codec';
import { OPERATIONS } from '../../core/ipp/ipp-constants';
import type { IppJobBook } from '../../core/ipp/ipp-job-book';
import { type AcceptedPrint, type ClientDecision, handleIppRequest } from '../../core/ipp/ipp-operations';
import type { SharedPrinter } from '../../core/ipp/shared-printer';
import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import type { Clock } from '../../core/types';
import { BRAND } from '../../shared/brand';
import { DEFAULT_IPP_PORT } from '../../shared/ipp-sharing';
import { isLanClientAddress, plainAddress } from '../api/network';
import { RateLimiter } from '../api/rate-limiter';
import { HttpListener, type ListenStatus } from '../net/http-listener';
import { printerListPage, printerPage } from './ipp-pages';
import { parseBasicAuth } from './share-password';

export const IPP_HTTP_LIMITS = {
  /** 没带（或带错）共享密码时最多收 64KB：够 Get-Printer-Attributes 这类查询，挡住没认证的大文档。 */
  unauthenticatedBytes: IPP_DECODE_LIMITS.headerBytes,
  /** 一个请求最多 = 文档上限（和 PDF 打印一样 50MB）+ 属性部分 64KB。 */
  requestBytes: PDF_LIMITS.fileBytes + IPP_DECODE_LIMITS.headerBytes,
} as const;
/** 默认端口被占用时依次试 10 个：8631–8640。 */
const FALLBACK_PORT_COUNT = 10;
export const DEFAULT_IPP_PORTS: readonly number[] = Array.from({ length: FALLBACK_PORT_COUNT }, (_, index) => DEFAULT_IPP_PORT + index);
/** 一个请求最长 2 分钟（含上传）：50MB 在慢的 Wi-Fi（约 3MB/s）上也要 20 秒上下，留足余量；挡住慢速连接一直占着。 */
const REQUEST_TIMEOUT_MS = 120_000;
/** 同时最多 64 条连接：几台电脑的打印队列每台只开一两条。 */
const MAX_CONNECTIONS = 64;
/** 每个地址每秒 20 个请求、突发 40 个：打印队列每秒查一两次任务状态，加上查打印机，远用不到。 */
const ADDRESS_LIMITS = { perSecond: 20, burst: 40 };
/** 密码错 5 次之后，每错一次锁 10 秒：正常输错几次不受影响，挡住逐个猜。 */
const AUTH_FAILURE_LIMITS = { perSecond: 0.1, burst: 5 };
const LOCKOUT_MS = 10_000;
/** 密码对了按「地址 + 认证头的摘要」记 10 分钟：打印队列每个请求都带认证头，不必每次都算 scrypt。 */
const VERIFIED_AUTH_MS = 10 * 60_000;
/** 记住的认证超过这么多条就清掉过期的。 */
const VERIFIED_PRUNE_SIZE = 256;
const BYTES_PER_MB = 1024 * 1024;
/** 被限速时让对方 5 秒后再来。 */
const RETRY_AFTER_SECONDS = 5;
const PRINTER_PATH = /^\/printers\/(\d{1,3}(?:\.\d)?x\d{1,3}(?:\.\d)?)(?:\/jobs\/([1-9]\d{0,9}))?\/?$/;
const HOST_PATTERN = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
const HOST_WITH_PORT = /:\d{1,5}$/;
const IPP_CONTENT_TYPE = 'application/ipp';
const OPERATIONS_NEEDING_PASSWORD: ReadonlySet<number> = new Set([
  OPERATIONS.printJob,
  OPERATIONS.validateJob,
  OPERATIONS.cancelJob,
]);
const HTTP = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  methodNotAllowed: 405,
  tooLarge: 413,
  internal: 500,
  unavailable: 503,
} as const;
const PAGE_HEADERS = {
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  'x-content-type-options': 'nosniff',
} as const;

/** 收下的打印任务和它要打到的共享打印机。 */
export interface AcceptedJob extends AcceptedPrint {
  printer: SharedPrinter;
}

export interface IppHttpServerDeps {
  clock: Clock;
  /** 现在共享着的打印机（按纸张键），状态是实时的。 */
  printers: () => ReadonlyMap<string, SharedPrinter>;
  book: IppJobBook;
  password: { isSet(): boolean; verify(password: string): Promise<boolean> };
  decisionFor: (address: string) => ClientDecision;
  onAccepted: (job: AcceptedJob) => void;
  /** 请求没带合规的 Host 时网址里用的主机（这台电脑的第一个局域网地址）。 */
  fallbackHost: () => string;
  /** 只接受这些地址来的连接；默认只接受局域网。测试里换掉。 */
  isAllowedAddress?: ((address: string | undefined) => boolean) | undefined;
  /** 测试里调小。 */
  limits?: Partial<typeof IPP_HTTP_LIMITS> | undefined;
}

type AuthState = 'not-required' | 'ok' | 'missing' | 'wrong' | 'locked';

/** 对方中途断开：不当作程序出错写日志。 */
class ClientGoneError extends Error {}

/**
 * 网址里的主机：用对方请求时的 Host（它就是用这个地址连上来的）；没带端口补上实际端口；
 * 不合规（可能是伪造的）时用这台电脑的局域网地址。
 */
export function requestHost(host: string | undefined, localPort: number, fallback: string): string {
  if (host === undefined || !HOST_PATTERN.test(host)) {
    return `${fallback}:${localPort}`;
  }
  return HOST_WITH_PORT.test(host) && !host.endsWith(']') ? host : `${host}:${localPort}`;
}

/**
 * 局域网共享的 IPP 服务（RFC 8010 §4：IPP over HTTP）。只监听 IPv4；连接一建立就按地址过滤；
 * 先认证再读正文；属性部分、文档大小、速率、时长都有上限。业务都在 core 的 handleIppRequest 里。
 */
export class IppHttpServer {
  private readonly listener: HttpListener;
  private readonly limits: typeof IPP_HTTP_LIMITS;
  private readonly addressLimiter: RateLimiter;
  private readonly authFailures: RateLimiter;
  private readonly lockedUntil = new Map<string, number>();
  private readonly verified = new Map<string, number>();
  private startedAt = 0;

  constructor(private readonly deps: IppHttpServerDeps) {
    this.limits = { ...IPP_HTTP_LIMITS, ...deps.limits };
    this.addressLimiter = new RateLimiter(deps.clock, ADDRESS_LIMITS);
    this.authFailures = new RateLimiter(deps.clock, AUTH_FAILURE_LIMITS);
    this.listener = new HttpListener({
      logTag: '[ipp]',
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxConnections: MAX_CONNECTIONS,
      onRequest: (request, response) => void this.serve(request, response, false),
      configure: (server) => this.configure(server),
    });
  }

  get status(): ListenStatus {
    return this.listener.status;
  }

  port(): number | null {
    return this.listener.port();
  }

  /** 只监听 IPv4（0.0.0.0）：mDNS 只广播 A 记录，Windows 按地址添加也用 IPv4。 */
  start(ports: readonly number[]): Promise<ListenStatus> {
    this.startedAt = this.deps.clock.now();
    return this.listener.start('ipv4', ports);
  }

  async stop(): Promise<void> {
    this.forgetCredentials();
    await this.listener.stop();
  }

  /** 共享密码改了：记住的认证全部作废。 */
  forgetCredentials(): void {
    this.verified.clear();
    this.lockedUntil.clear();
  }

  private configure(server: Server): void {
    const isAllowed = this.deps.isAllowedAddress ?? isLanClientAddress;
    // 不是局域网来的连接一个字节都不读：防火墙没拦住的公网、VPN 地址到这里为止。
    server.on('connection', (socket) => {
      if (!isAllowed(socket.remoteAddress)) {
        socket.destroy();
      }
    });
    // 带 Expect: 100-continue 的请求（大文档）：先看过认证和大小，再让对方发正文。
    server.on('checkContinue', (request, response) => void this.serve(request, response, true));
  }

  private async serve(request: IncomingMessage, response: ServerResponse, expectsContinue: boolean): Promise<void> {
    const address = plainAddress(request.socket.remoteAddress ?? '');
    try {
      if (!this.addressLimiter.take(address)) {
        sendText(request, response, HTTP.unavailable, '请求太快，请稍后再试', {
          'retry-after': String(RETRY_AFTER_SECONDS),
        });
        return;
      }
      const route = PRINTER_PATH.exec((request.url ?? '/').split('?')[0] ?? '/');
      if (request.method === 'GET' || request.method === 'HEAD') {
        this.servePage(request, response, route?.[1] ?? null);
        return;
      }
      if (request.method !== 'POST') {
        sendText(request, response, HTTP.methodNotAllowed, '这里只接受 IPP 打印请求', { allow: 'GET, HEAD, POST' });
        return;
      }
      const key = route?.[1];
      const printer = key === undefined ? undefined : this.deps.printers().get(key);
      if (key === undefined || printer === undefined) {
        sendText(request, response, HTTP.notFound, '没有这台共享打印机');
        return;
      }
      if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith(IPP_CONTENT_TYPE)) {
        sendText(request, response, HTTP.badRequest, '只接受 application/ipp');
        return;
      }
      const auth = await this.authenticate(request, address);
      if (auth === 'locked') {
        sendText(request, response, HTTP.unavailable, '共享密码输错太多次：稍后再试', {
          'retry-after': String(LOCKOUT_MS / 1_000),
        });
        return;
      }
      const isTrusted = auth === 'ok' || auth === 'not-required';
      const limit = isTrusted ? this.limits.requestBytes : this.limits.unauthenticatedBytes;
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) {
        this.refuseLarge(request, response, isTrusted);
        return;
      }
      if (expectsContinue) {
        response.writeContinue();
      }
      const body = await readBody(request, limit);
      if (body === null) {
        this.refuseLarge(request, response, isTrusted);
        return;
      }
      let decoded: DecodedIpp;
      try {
        decoded = decodeIppMessage(body);
      } catch (error) {
        if (error instanceof IppDecodeError) {
          sendText(request, response, HTTP.badRequest, '请求不是合规的 IPP');
          return;
        }
        throw error;
      }
      if (this.deps.password.isSet() && OPERATIONS_NEEDING_PASSWORD.has(decoded.message.code) && auth !== 'ok') {
        this.challenge(request, response);
        return;
      }
      const host = requestHost(request.headers.host, request.socket.localPort ?? 0, this.deps.fallbackHost());
      const outcome = handleIppRequest(decoded.message, body.subarray(decoded.dataOffset), {
        printer,
        printerUri: `ipp://${host}/printers/${key}`,
        moreInfoUri: `http://${host}/printers/${key}`,
        authentication: this.deps.password.isSet() ? 'basic' : 'none',
        client: address,
        decision: this.deps.decisionFor(address),
        book: this.deps.book,
        pathJobId: route?.[2] === undefined ? null : Number(route[2]),
        startedAt: this.startedAt,
        nowMs: this.deps.clock.now(),
      });
      send(request, response, HTTP.ok, IPP_CONTENT_TYPE, encodeIppMessage(outcome.response));
      if (outcome.accepted !== null) {
        this.deps.onAccepted({ ...outcome.accepted, printer });
      }
    } catch (error) {
      if (error instanceof ClientGoneError) {
        return;
      }
      console.error(`[ipp] ${request.method ?? '?'} ${request.url ?? '?'} from ${address} failed`, error);
      sendText(request, response, HTTP.internal, '程序内部错误，已写入共享打印机那台电脑的日志');
    }
  }

  private servePage(request: IncomingMessage, response: ServerResponse, key: string | null): void {
    const printers = this.deps.printers();
    const path = (request.url ?? '/').split('?')[0];
    const printer = key === null ? undefined : printers.get(key);
    const html = path === '/' ? printerListPage([...printers.values()]) : printer === undefined ? null : printerPage(printer);
    if (html === null) {
      sendText(request, response, HTTP.notFound, '没有这台共享打印机');
      return;
    }
    send(request, response, HTTP.ok, 'text/html; charset=utf-8', new TextEncoder().encode(html), PAGE_HEADERS);
  }

  /** 认证头：没设密码不用认；对了按「地址 + 认证头摘要」记 10 分钟；错多了锁一会儿。 */
  private async authenticate(request: IncomingMessage, address: string): Promise<AuthState> {
    if (!this.deps.password.isSet()) {
      return 'not-required';
    }
    const header = request.headers.authorization;
    const credentials = parseBasicAuth(header);
    if (header === undefined || credentials === null) {
      return 'missing';
    }
    const now = this.deps.clock.now();
    const cacheKey = `${address}\n${createHash('sha256').update(header).digest('hex')}`;
    if ((this.verified.get(cacheKey) ?? 0) > now) {
      return 'ok';
    }
    if ((this.lockedUntil.get(address) ?? 0) > now) {
      return 'locked';
    }
    if (await this.deps.password.verify(credentials.password)) {
      this.rememberVerified(cacheKey, now);
      return 'ok';
    }
    if (!this.authFailures.take(address)) {
      this.lockedUntil.set(address, now + LOCKOUT_MS);
    }
    return 'wrong';
  }

  private rememberVerified(cacheKey: string, now: number): void {
    if (this.verified.size >= VERIFIED_PRUNE_SIZE) {
      for (const [key, until] of this.verified) {
        if (until <= now) {
          this.verified.delete(key);
        }
      }
    }
    this.verified.set(cacheKey, now + VERIFIED_AUTH_MS);
  }

  private challenge(request: IncomingMessage, response: ServerResponse): void {
    sendText(request, response, HTTP.unauthorized, '需要共享密码', {
      'www-authenticate': `Basic realm="${BRAND.productNameAscii}", charset="UTF-8"`,
    });
  }

  /** 没认证的大请求先要密码；认证过的说明文档太大。 */
  private refuseLarge(request: IncomingMessage, response: ServerResponse, isTrusted: boolean): void {
    if (!isTrusted) {
      this.challenge(request, response);
      return;
    }
    sendText(request, response, HTTP.tooLarge, `文档超过 ${PDF_LIMITS.fileBytes / BYTES_PER_MB}MB：拆成几个小一点的再打`);
  }
}

/** 读正文：超过 limit 就停下返回 null（不再收剩下的）；对方中途断开抛 ClientGoneError。 */
function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let isOver = false;
    request.on('data', (chunk: Buffer) => {
      if (isOver) {
        return;
      }
      size += chunk.length;
      if (size > limit) {
        isOver = true;
        request.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new ClientGoneError('the client disconnected before sending the whole request')));
    request.once('end', () => {
      if (!isOver) {
        const joined = Buffer.concat(chunks);
        resolve(new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength));
      }
    });
  });
}

/**
 * 发回复。正文没读完（拒绝在读之前）时带 connection: close 并在发完后断开，不再收剩下的数据。
 * HEAD 只发头。
 */
function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Uint8Array,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.destroyed || response.headersSent) {
    return;
  }
  const isComplete = request.complete;
  response.writeHead(status, {
    ...headers,
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
    ...(isComplete ? {} : { connection: 'close' }),
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  if (!isComplete) {
    response.once('finish', () => request.destroy());
  }
}

function sendText(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  text: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  send(request, response, status, 'text/plain; charset=utf-8', new TextEncoder().encode(text), headers);
}
```

（`request.complete` 是 node:http 的「正文已经全部收到」。`DecodedIpp` 已在 Task 2 导出。）

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/ipp`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/ipp/ipp-pages.ts src/main/ipp/ipp-pages.test.ts src/main/ipp/ipp-http-server.ts src/main/ipp/ipp-http-server.test.ts src/main/ipp/testing/ipp-client.ts
git commit -m "feat(ipp): serve IPP over HTTP to computers on the LAN" -m "Connections from outside private, link-local and loopback ranges are dropped before any byte is read. Credentials are checked before the body: without the share password only 64KB is read and printing asks for it, 100-continue uploads wait for that check, wrong passwords lock the address briefly. Bodies are capped at the PDF limit, URIs follow the Host the client used, and browsers get a plain page." -m "$TRAILER"
```

---

### Task 15: 渲染页也解 JPEG / PNG

JPEG / PNG 的解码器（Chromium 的 libjpeg-turbo、libpng，C++）不能在主进程里跑不可信的图片（Rule of 2：不可信输入 + 不安全实现 + 高权限进程三样都占了）。PDF 打印已经有一个 sandbox 的隐藏渲染页，让它也解图片：新请求 `open-image`，渲染页用 `createImageBitmap` 解码，回答「1 页、大小 = 图片的像素」，之后照常 `render`（按 72dpi 渲染就是原图大小）。主进程照旧逐字节核对回来的位图大小。EXIF 方向由 `createImageBitmap` 默认按图片里的方向转正。

**Files:**
- Modify: `src/shared/pdf-render-protocol.ts`、`src/shared/pdf-render-protocol.test.ts`
- Modify: `src/main/pdf/pdf-render-host.ts`、`src/main/pdf/pdf-render-host.test.ts`
- Modify: `src/renderer/src/pdf-render/main.ts`

- [ ] **Step 1: 写测试**

`pdf-render-host.test.ts` 的 `describe('PdfRenderHost')` 里加：

```ts
  test('opens a JPEG or PNG as a one-page document in the render page', async () => {
    const { host, ports } = createHost();
    const opening = host.openImage(Uint8Array.of(0xff, 0xd8, 0xff), 'image/jpeg');
    await settle();
    const request = ports[0]?.sent[0];
    expect(request).toMatchObject({ kind: 'open-image', type: 'image/jpeg', data: Uint8Array.of(0xff, 0xd8, 0xff) });
    ports[0]?.reply({ id: request?.id, kind: 'opened', pageCount: 1, pages: [{ width: 640, height: 480 }] });
    expect(await opening).toEqual({ pageCount: 1, pages: [{ width: 640, height: 480 }] });
  });

  test('renders an opened image at its own size', async () => {
    const { host, ports } = createHost();
    const opening = host.openImage(Uint8Array.of(0x89), 'image/png');
    await settle();
    const port = ports[0];
    port?.reply({ id: port.sent[0]?.id, kind: 'opened', pageCount: 1, pages: [{ width: 4, height: 2 }] });
    await opening;
    const rendering = host.render(1, { width: 4, height: 2 }, 72);
    expect(port?.sent[1]).toMatchObject({ kind: 'render', page: 1, scale: 1 });
    port?.reply({ id: port.sent[1]?.id, kind: 'rendered', width: 4, height: 2, gray: new Uint8Array(8) });
    expect((await rendering).image).toMatchObject({ width: 4, height: 2 });
  });
```

`pdf-render-protocol.test.ts` 末尾加（import 加 `RENDER_IMAGE_TYPES`）：

```ts
describe('RENDER_IMAGE_TYPES', () => {
  test('lists only the image types the render page decodes', () => {
    expect([...RENDER_IMAGE_TYPES]).toEqual(['image/jpeg', 'image/png']);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/pdf-render-protocol.test.ts src/main/pdf/pdf-render-host.test.ts`
Expected: FAIL（`openImage` 不存在、`RENDER_IMAGE_TYPES` 没有导出）。

- [ ] **Step 3: 实现**

`src/shared/pdf-render-protocol.ts`：

1. `RENDER_ERRORS` 之前加：

```ts
/** 渲染页还能解码的图片（局域网共享收到的 JPEG / PNG 也只在这个 sandbox 页里解码）。 */
export const RENDER_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type RenderImageType = (typeof RENDER_IMAGE_TYPES)[number];
```

2. `RenderRequest` 改为：

```ts
export type RenderRequest =
  | { id: number; kind: 'open'; data: Uint8Array }
  /** 一张图片当作只有一页的文档：页面大小 = 图片的像素，按 72dpi 渲染就是原图大小。 */
  | { id: number; kind: 'open-image'; data: Uint8Array; type: RenderImageType }
  /** page 从 1 数；scale = 每点多少像素。 */
  | { id: number; kind: 'render'; page: number; scale: number };
```

`src/main/pdf/pdf-render-host.ts`：import 加 `type RenderImageType`；把 `open` 的方法体挪进新的私有方法 `openWith`，`open` 和新的 `openImage` 都调它：

```ts
  /** 打开一个 PDF（关掉上一个）。打不开时抛 PdfRenderError。 */
  open(data: Uint8Array): Promise<OpenedPdf> {
    return this.openWith((id) => ({ id, kind: 'open', data }));
  }

  /** 打开一张 JPEG / PNG（关掉上一个文档）：解码只在渲染页里做。打不开时抛 PdfRenderError。 */
  openImage(data: Uint8Array, type: RenderImageType): Promise<OpenedPdf> {
    return this.openWith((id) => ({ id, kind: 'open-image', data, type }));
  }

  private async openWith(build: (id: number) => RenderRequest): Promise<OpenedPdf> {
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
      build,
      (id) => ({ id, kind: 'opened', maxPages: PDF_LIMITS.pages }),
      this.deps.openTimeoutMs,
    );
    if (reply.kind !== 'opened') {
      throw new PdfRenderError(PDF_ISSUES.failed, `unexpected ${reply.kind} reply to open`);
    }
    return { pageCount: reply.pageCount, pages: reply.pages };
  }
```

`src/renderer/src/pdf-render/main.ts`（PDF 打印 Task 11 写的那个文件）：

1. import 里加 `MAX_PAGE_POINTS`、`type RenderImageType`（从 `../../../shared/pdf-render-protocol`）。
2. `let current: PDFDocumentProxy | null = null;` 换成：

```ts
/** 打开着的文档：PDF，或者一张已解码的图片（只有一页）。 */
type OpenDocument = { kind: 'pdf'; pdf: PDFDocumentProxy } | { kind: 'image'; bitmap: ImageBitmap };

let current: OpenDocument | null = null;

/** 图片太大（任一边超过 PDF 的页面上限）或解不开：按「打不开」回给主进程。 */
class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

async function closeCurrent(): Promise<void> {
  const opened = current;
  current = null;
  if (opened?.kind === 'pdf') {
    await opened.pdf.destroy();
  } else if (opened?.kind === 'image') {
    opened.bitmap.close();
  }
}
```

3. `handle` 改为：

```ts
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
```

4. `open` 开头的 `await current?.destroy(); current = null;` 换成 `await closeCurrent();`，`current = pdf;` 换成 `current = { kind: 'pdf', pdf };`。
5. 加 `openImage`：

```ts
async function openImage(id: number, data: Uint8Array, type: RenderImageType): Promise<RenderReply> {
  await closeCurrent();
  // 复制一份成 ArrayBuffer 支撑的数组：Blob 不收共享内存上的视图。
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
  if (bitmap.width > MAX_PAGE_POINTS || bitmap.height > MAX_PAGE_POINTS) {
    bitmap.close();
    throw new InvalidImageError(`image is ${bitmap.width}×${bitmap.height}`);
  }
  current = { kind: 'image', bitmap };
  return { id, kind: 'opened', pageCount: 1, pages: [{ width: bitmap.width, height: bitmap.height }] };
}
```

6. `render` 改为按文档种类画（铺白纸、转灰度、放掉画布这几步两种共用）：

```ts
async function render(id: number, number: number, scale: number): Promise<RenderReply> {
  const opened = current;
  if (opened === null) {
    throw new Error('no document is open');
  }
  if (opened.kind === 'image') {
    const { bitmap } = opened;
    const size = renderedSize({ width: bitmap.width, height: bitmap.height }, scale);
    return drawGray(id, size, (context) => {
      context.drawImage(bitmap, 0, 0, size.width, size.height);
    });
  }
  const page = await opened.pdf.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const size = renderedSize({ width: base.width, height: base.height }, scale);
  const reply = await drawGray(id, size, async (context, canvas) => {
    // intent: 'print' 和打印 PDF 一样画表单里填的内容、不画只在屏幕上显示的批注。
    await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), intent: 'print' }).promise;
  });
  page.cleanup();
  return reply;
}

/** 开一块画布、铺白纸（透明的地方按白纸打）、画、转灰度，然后马上放掉画布（1600 万像素的 RGBA 就是 64MB）。 */
async function drawGray(
  id: number,
  size: { width: number; height: number },
  draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void | Promise<void>,
): Promise<RenderReply> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (context === null) {
    throw new Error('2d canvas is not available');
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  await draw(context, canvas);
  const gray = new Uint8Array(size.width * size.height);
  rgbaToGray(context.getImageData(0, 0, size.width, size.height).data, gray);
  canvas.width = 0;
  canvas.height = 0;
  return { id, kind: 'rendered', width: size.width, height: size.height, gray };
}
```

（局部变量叫 `opened`，不叫 `document`：`drawGray` 要用浏览器的 `document`。PDF 打印计划里 `page.render` 的参数按那时核对的 pdf.js 版本写，这里原样保留。）

7. `failure` 里认出图片打不开：

```ts
/** pdf.js 的异常名：PasswordException（要密码）、InvalidPDFException（不是 PDF 或坏了）；图片解不开是 InvalidStateError / EncodingError。 */
const INVALID_ERROR_NAMES: ReadonlySet<string> = new Set(['InvalidPDFException', 'InvalidImageError', 'InvalidStateError', 'EncodingError']);

function failure(id: number, error: unknown): RenderReply {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  const kind: RenderError = name === 'PasswordException' ? 'password' : INVALID_ERROR_NAMES.has(name) ? 'invalid' : 'failed';
  const detail = error instanceof Error || error instanceof DOMException ? `${error.name}: ${error.message}` : String(error);
  return { id, kind: 'error', error: kind, detail };
}
```

- [ ] **Step 4: 跑测试、构建**

Run: `bun test src/shared src/main/pdf && bun run build && bun run verify:bundle`
Expected: PASS；构建通过（渲染页是 `tsc -p src/renderer/tsconfig.json` 检查的，`bun run check` 会覆盖）。图片在真窗口里的解码由 Task 23 的 E2E 覆盖（打一张 PNG）。

- [ ] **Step 5: `bun run check && bun run test:e2e` 后提交**

```bash
git add src/shared/pdf-render-protocol.ts src/shared/pdf-render-protocol.test.ts src/main/pdf/pdf-render-host.ts src/main/pdf/pdf-render-host.test.ts src/renderer/src/pdf-render/main.ts
git commit -m "feat(pdf): decode JPEG and PNG in the sandboxed render page" -m "Images from LAN clients must not be decoded by native code in the main process. The PDF render page now opens an image as a one-page document with createImageBitmap and renders it like a PDF page, so the main process still only receives grayscale pixels of the exact size it asked for." -m "$TRAILER"
```

---

### Task 16: 收到的任务 → 打印

`IppJobProcessor` 一次处理一个任务（IPP 专用的一个渲染窗口）：等确认（新电脑）→ 开始 → 一页页取灰度（PDF、图片交给渲染页；PWG / Apple 光栅在这里用 core 解）→ 每页按 `chooseIppCrop` 整页或去白边 → `renderPiece` 放到纸上、转黑白（照片抖动，其余阈值）→ 存进 PDF 打印的位图缓存 → 按整份依次打（1、2、1、2）经 `printFields`（来源 `ipp`、带 `PdfRef` 和 `IppRef`）→ 结束。任何一张没打成就中止并说明原因；被取消就停下；没打的位图删掉（打过的留给打印记录，7 天后由启动时的清理删）。

**Files:**
- Create: `src/main/ipp/testing/fakes.ts`
- Create: `src/main/ipp/ipp-job-processor.ts`、`src/main/ipp/ipp-job-processor.test.ts`

- [ ] **Step 1: 测试用的假渲染页和缓存**

```ts
// src/main/ipp/testing/fakes.ts
import type { MonoBitmap } from '../../../core/pdf/mono-pack';
import { blankPage, fill } from '../../../core/pdf/testing/synthetic-page';
import type { GrayImage } from '../../../core/templates/mono-image';
import type { PrintResult } from '../../../core/types';
import type { PageSize, RenderImageType } from '../../../shared/pdf-render-protocol';
import type { OpenedPdf, RenderedPage } from '../../pdf/pdf-render-host';
import type { IppDocumentRenderer, IppPieceStore } from '../ipp-job-processor';

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;
/** 60×40mm 的 PDF 页（点）。 */
export const LABEL_PAGE: PageSize = { width: (60 / MM_PER_INCH) * POINTS_PER_INCH, height: (40 / MM_PER_INCH) * POINTS_PER_INCH };
export const A4_PAGE: PageSize = { width: 595, height: 842 };
export const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'ipp', ruleName: '局域网共享', fields: [] },
};

/** 假的渲染页：每页都是 image（默认白纸上一块黑），pages 是 PDF 的页面大小。 */
export class FakeRenderer implements IppDocumentRenderer {
  readonly calls: string[] = [];
  pages: PageSize[] = [LABEL_PAGE];
  image: GrayImage = fill(blankPage(120, 80), { x: 10, y: 10, width: 60, height: 40 });
  failure: Error | null = null;

  async open(_data: Uint8Array): Promise<OpenedPdf> {
    this.calls.push('open');
    this.throwIfFailing();
    return { pageCount: this.pages.length, pages: this.pages };
  }

  async openImage(_data: Uint8Array, type: RenderImageType): Promise<OpenedPdf> {
    this.calls.push(`open-image ${type}`);
    this.throwIfFailing();
    return { pageCount: 1, pages: [{ width: this.image.width, height: this.image.height }] };
  }

  async render(page: number, _size: PageSize, dpi: number): Promise<RenderedPage> {
    this.calls.push(`render ${page} ${dpi}`);
    this.throwIfFailing();
    return { image: this.image, dpi };
  }

  close(): void {
    this.calls.push('close');
  }

  private throwIfFailing(): void {
    if (this.failure !== null) {
      throw this.failure;
    }
  }
}

/** 内存里的位图缓存。 */
export class MemoryPieces implements IppPieceStore {
  readonly stored = new Map<string, MonoBitmap>();
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

  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.stored.delete(key);
    }
  }
}
```

- [ ] **Step 2: 写测试**

```ts
// src/main/ipp/ipp-job-processor.test.ts
import { describe, expect, test } from 'bun:test';
import type { AcceptedDocument } from '../../core/ipp/ipp-operations';
import { IppJobBook } from '../../core/ipp/ipp-job-book';
import { MINIMAL_PDF, testPrinter } from '../../core/ipp/testing/ipp-requests';
import { grayPage, pwgRaster } from '../../core/ipp/testing/raster-fixtures';
import { blankPage, fill } from '../../core/pdf/testing/synthetic-page';
import { PDF_PIECE_TEMPLATE_ID } from '../../core/pdf/piece-template';
import type { FieldsPrint } from '../../core/print-service';
import { FakeClock } from '../../core/testing/fake-clock';
import type { PrintResult } from '../../core/types';
import { PDF_ISSUES, PdfRenderError } from '../pdf/pdf-render-host';
import type { ApprovalResult } from './client-approvals';
import type { AcceptedJob } from './ipp-http-server';
import { IPP_JOB_MESSAGES, IppJobProcessor, type IppJobProcessorDeps } from './ipp-job-processor';
import { A4_PAGE, FakeRenderer, LABEL_PAGE, MemoryPieces, PRINTED } from './testing/fakes';

function createProcessor(overrides: Partial<IppJobProcessorDeps> = {}) {
  const book = new IppJobBook(new FakeClock());
  const renderer = new FakeRenderer();
  const pieces = new MemoryPieces();
  const printed: FieldsPrint[] = [];
  const approval: { result: ApprovalResult } = { result: 'allowed' };
  const processor = new IppJobProcessor({
    renderer,
    pieces,
    book,
    dpiFor: async () => 203,
    waitForApproval: async () => approval.result,
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    onJobsChanged: () => undefined,
    onChange: () => undefined,
    log: () => undefined,
    ...overrides,
  });
  return { processor, book, renderer, pieces, printed, approval };
}

function acceptJob(book: IppJobBook, document: Partial<AcceptedDocument> = {}, needsApproval = false): AcceptedJob {
  const created = book.create({
    printerKey: '60x40',
    name: '面单',
    user: 'zhang',
    client: '192.168.1.23',
    sizeBytes: 100,
    held: needsApproval,
  });
  if (created.status !== 'created') {
    throw new Error(`not created: ${created.status}`);
  }
  return {
    job: created.job,
    printer: testPrinter(),
    document: { format: 'application/pdf', data: MINIMAL_PDF, copies: 1, ...document },
    needsApproval,
  };
}

describe('IppJobProcessor', () => {
  test('prints every page on the paper with collated copies as LAN share records', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    renderer.pages = [LABEL_PAGE, LABEL_PAGE];
    const accepted = acceptJob(book, { copies: 2 });
    await processor.enqueue(accepted);
    expect(printed.map((input) => input.content)).toEqual([
      '面单 第 1 页第 1 张',
      '面单 第 2 页第 1 张',
      '面单 第 1 页第 1 张',
      '面单 第 2 页第 1 张',
    ]);
    expect(printed[0]).toMatchObject({
      source: 'ipp',
      caller: null,
      printerName: null,
      ipp: { client: '192.168.1.23', user: 'zhang' },
      pdf: { file: '面单', page: 1, piece: 1 },
      template: { id: PDF_PIECE_TEMPLATE_ID, paper: { widthMm: 60, heightMm: 40 } },
    });
    expect(renderer.calls).toEqual(['open', 'render 1 203', 'render 2 203', 'close']);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'completed', impressions: 4 });
  });

  test('trims an A4 page down to its content before fitting it on the label', async () => {
    const { processor, book, renderer, pieces } = createProcessor();
    renderer.pages = [A4_PAGE];
    renderer.image = fill(blankPage(400, 560), { x: 180, y: 260, width: 40, height: 28 });
    await processor.enqueue(acceptJob(book));
    const [bitmap] = [...pieces.stored.values()];
    const ink = bitmap === undefined ? 0 : bitmap.bits.filter((bit) => bit === 1).length / bitmap.bits.length;
    expect(ink).toBeGreaterThan(0.8);
  });

  test('waits for the operator and drops a refused job without opening it', async () => {
    const { processor, book, renderer, printed, approval } = createProcessor();
    approval.result = 'denied';
    const accepted = acceptJob(book, {}, true);
    await processor.enqueue(accepted);
    expect(printed).toEqual([]);
    expect(renderer.calls).toEqual([]);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.denied });
  });

  test('prints a held job once the operator allows it', async () => {
    const { processor, book, printed } = createProcessor();
    const accepted = acceptJob(book, {}, true);
    await processor.enqueue(accepted);
    expect(printed).toHaveLength(1);
    expect(book.get(accepted.job.id)?.state).toBe('completed');
  });

  test('decodes PWG raster without the render page', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    await processor.enqueue(acceptJob(book, { format: 'image/pwg-raster', data: pwgRaster([grayPage(479, 319)]) }));
    expect(printed).toHaveLength(1);
    expect(renderer.calls).toEqual(['close']);
  });

  test('dithers photos and opens images in the render page at their own size', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    await processor.enqueue(acceptJob(book, { format: 'image/jpeg', data: Uint8Array.of(0xff, 0xd8, 0xff) }));
    expect(renderer.calls).toEqual(['open-image image/jpeg', 'render 1 72', 'close']);
    expect(printed).toHaveLength(1);
  });

  test('stops a job canceled while printing and drops the pieces it did not print', async () => {
    const holder: { book: IppJobBook | null; id: number } = { book: null, id: 0 };
    const { processor, book, renderer, pieces, printed } = createProcessor({
      printFields: async (input) => {
        printed.push(input);
        holder.book?.cancel(holder.id, '192.168.1.23');
        return PRINTED;
      },
    });
    renderer.pages = [LABEL_PAGE, LABEL_PAGE];
    const accepted = acceptJob(book);
    holder.book = book;
    holder.id = accepted.job.id;
    await processor.enqueue(accepted);
    expect(printed).toHaveLength(1);
    expect(book.get(accepted.job.id)?.state).toBe('canceled');
    expect(pieces.stored.size).toBe(1);
  });

  test('aborts with the reason when the label printer cannot print', async () => {
    const failed: PrintResult = { status: 'failed', reason: 'PRINTER_NOT_READY' };
    const { processor, book } = createProcessor({ printFields: async () => failed });
    const accepted = acceptJob(book);
    await processor.enqueue(accepted);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.notReady });
  });

  test('finishes a blank document with a warning and prints nothing', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    renderer.image = blankPage(120, 80);
    const accepted = acceptJob(book);
    await processor.enqueue(accepted);
    expect(printed).toEqual([]);
    expect(book.get(accepted.job.id)).toMatchObject({
      state: 'completed',
      reasons: ['job-completed-with-warnings'],
      message: IPP_JOB_MESSAGES.blank,
    });
  });

  test('aborts and closes the render page when the document cannot be opened', async () => {
    const { processor, book, renderer } = createProcessor();
    renderer.failure = new PdfRenderError(PDF_ISSUES.invalid, 'InvalidPDFException');
    const accepted = acceptJob(book);
    await processor.enqueue(accepted);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: PDF_ISSUES.invalid });
    expect(renderer.calls.at(-1)).toBe('close');
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/ipp/ipp-job-processor.test.ts`
Expected: FAIL，`Cannot find module './ipp-job-processor'`。

- [ ] **Step 4: 实现**

```ts
// src/main/ipp/ipp-job-processor.ts
import type { DocumentFormat } from '../../core/ipp/document-format';
import type { IppJobBook } from '../../core/ipp/ipp-job-book';
import type { AcceptedDocument } from '../../core/ipp/ipp-operations';
import { chooseIppCrop, ippFields } from '../../core/ipp/ipp-print';
import { RasterError, type RasterPage, readPwgRaster, readUrf } from '../../core/ipp/raster';
import { inkMask } from '../../core/pdf/content-box';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { cropRects, splitOptionsFor } from '../../core/pdf/page-split';
import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import { paperDots, renderPiece } from '../../core/pdf/piece-fit';
import { pieceContent, pieceTemplate } from '../../core/pdf/piece-template';
import type { FieldsPrint } from '../../core/print-service';
import { SerialQueue } from '../../core/serial-queue';
import type { ImageMode } from '../../core/templates/canvas-model';
import type { GrayImage } from '../../core/templates/mono-image';
import type { PrintResult } from '../../core/types';
import type { PaperSize } from '../../shared/paper-sizes';
import { type PageSize, POINTS_PER_INCH, type RenderImageType } from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PdfRenderError, type RenderedPage } from '../pdf/pdf-render-host';
import type { ApprovalResult } from './client-approvals';
import type { AcceptedJob } from './ipp-http-server';

const MM_PER_INCH = 25.4;
/** 转黑白的阈值：和 PDF 打印的默认值一样。 */
const MONO_THRESHOLD = 128;

/** 渲染 PDF、解图片的那一端（IPP 专用的一个 PdfRenderHost）。 */
export interface IppDocumentRenderer {
  open(data: Uint8Array): Promise<OpenedPdf>;
  openImage(data: Uint8Array, type: RenderImageType): Promise<OpenedPdf>;
  render(page: number, size: PageSize, dpi: number): Promise<RenderedPage>;
  close(): void;
}

/** 黑白位图缓存（PDF 打印的 PieceCache）用到的部分。 */
export interface IppPieceStore {
  save(bitmap: MonoBitmap): Promise<string>;
  load(key: string): Promise<MonoBitmap | null>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface IppJobProcessorDeps {
  renderer: IppDocumentRenderer;
  pieces: IppPieceStore;
  book: IppJobBook;
  /** 这种纸会打到的那台打印机的分辨率。 */
  dpiFor: (paper: PaperSize) => Promise<number>;
  waitForApproval: (address: string, user: string, printerName: string) => Promise<ApprovalResult>;
  /** PrintService.printFields：决定打印机、排队、写记录。 */
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 写了打印记录：界面刷新记录。 */
  onJobsChanged: () => void;
  /** 任务状态变了：刷新共享页的状态。 */
  onChange: () => void;
  log: (line: string) => void;
}

/** job-state-message：给交任务的那台电脑看的（打印队列里会显示）。 */
export const IPP_JOB_MESSAGES = {
  done: '已发送到打印机',
  canceled: '已取消',
  denied: '那台电脑上的操作员拒绝了这次打印',
  timeout: '等了 2 分钟没人允许：请那台电脑上的操作员点「允许」后再打',
  busy: '那台电脑上已经有几台电脑在等确认：稍后再打',
  blank: '文档是空白的，没有打印',
  tooManyPages: `文档超过 ${PDF_LIMITS.pages} 页：拆开再打`,
  badImage: '图片打不开：文件不完整或不是 JPEG / PNG',
  badRaster: '收到的光栅数据不完整或格式不支持：在打印对话框里换一种打印方式再试',
  notReady: '热敏标签机现在不能打印（缺纸、卡纸、开盖或离线）：处理好再打',
  printerTimeout: '热敏标签机没有响应：检查连接后再打',
  noPrinter: '这种纸已经没有分配打印机',
  printFailed: '打印失败：详细原因已写入那台电脑的日志',
  failed: '处理文档时出错：详细原因已写入那台电脑的日志',
} as const;

interface Outcome {
  state: 'completed' | 'aborted' | 'canceled';
  reasons: string[];
  message: string;
}

const CANCELED: Outcome = { state: 'canceled', reasons: ['job-canceled-by-user'], message: IPP_JOB_MESSAGES.canceled };

/** 处理中遇到的、要原样告诉对方的问题。 */
class IppJobError extends Error {}

/** 一页：灰度、渲染用的分辨率、实际大小（毫米；图片不知道实际大小，为 null）。 */
interface SourcePage {
  image: GrayImage;
  dpi: number;
  sizeMm: PaperSize | null;
}

interface SavedPiece {
  page: number;
  piece: number;
  key: string;
}

/**
 * 局域网共享收到的任务 → 标签：一次处理一个（IPP 专用的一个渲染窗口）。复用 PDF 打印的裁切、放到纸上、
 * 临时模板和位图缓存，经 PrintService.printFields 照常决定打印机（按纸张）、排队、写记录。
 */
export class IppJobProcessor {
  private readonly queue = new SerialQueue();

  constructor(private readonly deps: IppJobProcessorDeps) {}

  /** 排着和正在处理的任务数：有的时候不静默更新。 */
  get pending(): number {
    return this.queue.pending;
  }

  /** 排进队列；返回的 Promise 在这个任务处理完时结束，不会失败（错误记进任务和日志）。 */
  enqueue(accepted: AcceptedJob): Promise<void> {
    return this.queue
      .run(() => this.process(accepted))
      .catch((error: unknown) => this.deps.log(`[ipp] job ${accepted.job.id} stopped: ${describe(error)}`));
  }

  private async process(accepted: AcceptedJob): Promise<void> {
    const { job, printer, document } = accepted;
    const { book } = this.deps;
    if (accepted.needsApproval) {
      const decision = await this.deps.waitForApproval(job.client, job.user, printer.name);
      if (decision !== 'allowed') {
        const reason = decision === 'denied' ? 'job-canceled-by-operator' : 'aborted-by-system';
        book.finish(job.id, 'aborted', [reason], IPP_JOB_MESSAGES[decision]);
        this.deps.onChange();
        return;
      }
      book.release(job.id);
    }
    // 等确认的时候对方取消了：不再处理。
    if (!book.start(job.id)) {
      this.deps.onChange();
      return;
    }
    this.deps.onChange();
    const saved: SavedPiece[] = [];
    const printed = new Set<string>();
    try {
      const outcome = await this.printDocument(accepted, saved, printed);
      book.finish(job.id, outcome.state, outcome.reasons, outcome.message);
    } catch (error) {
      book.finish(job.id, 'aborted', ['aborted-by-system'], this.messageOf(error, document.format));
    } finally {
      this.deps.renderer.close();
      // 打过的位图打印记录还指着（7 天后由启动时的清理删）；没打的现在就删。
      await this.deps.pieces.remove(saved.map((piece) => piece.key).filter((key) => !printed.has(key)));
      this.deps.onChange();
    }
  }

  private async printDocument(accepted: AcceptedJob, saved: SavedPiece[], printed: Set<string>): Promise<Outcome> {
    const { job, printer, document } = accepted;
    const { book } = this.deps;
    const dpi = await this.deps.dpiFor(printer.paper);
    const dots = paperDots(printer.paper, dpi);
    // 照片用抖动（灰度层次）；文档、光栅里多是文字和条码，用阈值，边缘干净。
    const mono: ImageMode = document.format === 'image/jpeg' ? 'dither' : 'threshold';
    let pageNumber = 0;
    for await (const source of this.pages(document, dpi)) {
      pageNumber += 1;
      if (book.isCancelRequested(job.id)) {
        return CANCELED;
      }
      const crop = chooseIppCrop(source.sizeMm, printer.paper);
      // 空白页切不出块：不打白纸。
      const rects = cropRects(crop, inkMask(source.image), splitOptionsFor(source.dpi), []);
      for (const [index, rect] of rects.entries()) {
        const bitmap = renderPiece(source.image, rect, { dots, mono, threshold: MONO_THRESHOLD });
        saved.push({ page: pageNumber, piece: index + 1, key: await this.deps.pieces.save(bitmap) });
      }
    }
    if (saved.length === 0) {
      return { state: 'completed', reasons: ['job-completed-with-warnings'], message: IPP_JOB_MESSAGES.blank };
    }
    const share = { client: job.client, user: job.user };
    let impressions = 0;
    // 多份按整份文档依次打（1、2、1、2）：和办公打印机「逐份打印」一样。
    for (let copy = 0; copy < document.copies; copy += 1) {
      for (const piece of saved) {
        if (book.isCancelRequested(job.id)) {
          return CANCELED;
        }
        const bitmap = await this.deps.pieces.load(piece.key);
        if (bitmap === null) {
          throw new Error(`IPP piece ${piece.key} is missing from the cache`);
        }
        // 打印记录会指着这张位图：从现在起不删它。
        printed.add(piece.key);
        const result = await this.deps.printFields({
          template: pieceTemplate(bitmap, printer.paper),
          fields: ippFields(job.name, piece.page, piece.piece, share),
          content: pieceContent(job.name, piece.page, piece.piece),
          source: 'ipp',
          caller: null,
          printerName: null,
          pdf: { file: job.name, page: piece.page, piece: piece.piece, bitmap: piece.key },
          ipp: share,
        });
        this.deps.onJobsChanged();
        if (result.status !== 'printed') {
          return { state: 'aborted', reasons: ['aborted-by-system'], message: failureMessage(result) };
        }
        impressions += 1;
        book.progress(job.id, impressions);
      }
    }
    return { state: 'completed', reasons: ['job-completed-successfully'], message: IPP_JOB_MESSAGES.done };
  }

  /** 一页页的灰度：光栅在这里解；PDF 按打印机的分辨率渲染；图片按原图大小渲染（不知道实际尺寸，按去白边处理）。 */
  private async *pages(document: AcceptedDocument, dpi: number): AsyncGenerator<SourcePage> {
    const { renderer } = this.deps;
    switch (document.format) {
      case 'image/pwg-raster':
        yield* rasterPages(readPwgRaster(document.data));
        return;
      case 'image/urf':
        yield* rasterPages(readUrf(document.data));
        return;
      case 'image/jpeg':
      case 'image/png': {
        const opened = await renderer.openImage(document.data, document.format);
        const size = opened.pages[0];
        if (size === undefined) {
          throw new IppJobError(IPP_JOB_MESSAGES.badImage);
        }
        const rendered = await renderer.render(1, size, POINTS_PER_INCH);
        yield { image: rendered.image, dpi: rendered.dpi, sizeMm: null };
        return;
      }
      case 'application/pdf': {
        const opened = await renderer.open(document.data);
        if (opened.pageCount > PDF_LIMITS.pages) {
          throw new IppJobError(IPP_JOB_MESSAGES.tooManyPages);
        }
        for (const [index, size] of opened.pages.entries()) {
          const rendered = await renderer.render(index + 1, size, dpi);
          yield {
            image: rendered.image,
            dpi: rendered.dpi,
            sizeMm: { widthMm: (size.width / POINTS_PER_INCH) * MM_PER_INCH, heightMm: (size.height / POINTS_PER_INCH) * MM_PER_INCH },
          };
        }
        return;
      }
    }
  }

  private messageOf(error: unknown, format: DocumentFormat): string {
    if (error instanceof IppJobError) {
      return error.message;
    }
    if (error instanceof RasterError) {
      this.deps.log(`[ipp] bad raster: ${error.message}`);
      return IPP_JOB_MESSAGES.badRaster;
    }
    if (error instanceof PdfRenderError) {
      // 渲染页的原始原因 PdfRenderHost 已经写过日志。
      return format === 'application/pdf' ? error.issue : IPP_JOB_MESSAGES.badImage;
    }
    this.deps.log(`[ipp] processing failed: ${describe(error)}`);
    return IPP_JOB_MESSAGES.failed;
  }
}

function* rasterPages(pages: Iterable<RasterPage>): Generator<SourcePage> {
  for (const page of pages) {
    yield {
      image: page.image,
      dpi: page.dpi,
      sizeMm: { widthMm: (page.image.width / page.dpi) * MM_PER_INCH, heightMm: (page.image.height / page.dpi) * MM_PER_INCH },
    };
  }
}

function failureMessage(result: PrintResult): string {
  if (result.status === 'no-printer') {
    return IPP_JOB_MESSAGES.noPrinter;
  }
  if (result.status === 'failed') {
    switch (result.reason) {
      case 'PRINTER_NOT_READY':
        return IPP_JOB_MESSAGES.notReady;
      case 'PRINT_TIMEOUT':
        return IPP_JOB_MESSAGES.printerTimeout;
      default:
        return IPP_JOB_MESSAGES.printFailed;
    }
  }
  return IPP_JOB_MESSAGES.printFailed;
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
```

（`fakes.ts` 里的 `MemoryPieces` 实现的是这里的 `IppPieceStore`；PDF 打印的 `PieceCache` 有同样的三个方法，接线时直接传进来。）

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/ipp`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/ipp/ipp-job-processor.ts src/main/ipp/ipp-job-processor.test.ts src/main/ipp/testing/fakes.ts
git commit -m "feat(ipp): turn received jobs into labels through the PDF pipeline" -m "Jobs run one at a time: a new computer waits for the operator first, PDFs and images go to the sandboxed render page and raster is decoded in core. Pages already sized for the paper print whole, others are trimmed; each piece is fitted to the paper as printer dots, cached and printed through printFields as a LAN share record, collated by copy. Cancel stops between labels, a failed label aborts with a Chinese reason, and unprinted pieces are dropped." -m "$TRAILER"
```

---

### Task 17: mDNS 的收发

`MdnsAdvertiser` 是很薄的接线：一个 `udp4` 套接字绑 5353（`reuseAddr`，和系统的 mDNS 响应器共用端口），在每块局域网网卡上加入 224.0.0.251；启动后探测 3 次（每次隔 250ms）、宣告 2 次（隔 1 秒）；收到查询按对方所在的子网选网卡、用那块网卡的地址回答（传统单播查询、要求单播的回给对方，其余组播）；收到别人用我们名字的回答交给 `IppSharing` 改名；停止时告别。自己发出又回环收到的（来源是自己网卡的地址和端口）不理——同一台电脑上系统的响应器也是这个地址，它的查询同样不理，这台电脑自己不需要发现自己共享的打印机。

**Files:**
- Create: `src/main/ipp/mdns-advertiser.ts`、`src/main/ipp/mdns-advertiser.test.ts`

- [ ] **Step 1: 写测试**（真的 UDP 套接字，随机端口、单播，不依赖组播能不能用）

```ts
// src/main/ipp/mdns-advertiser.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { createSocket, type Socket } from 'node:dgram';
import { DNS_TYPES, type DnsMessage, type DnsName, decodeDnsMessage, encodeDnsMessage } from '../../core/mdns/dns-message';
import type { MdnsZone } from '../../core/mdns/dns-sd';
import type { LanInterface } from '../api/network';
import { MdnsAdvertiser } from './mdns-advertiser';

const LOOPBACK: LanInterface = { name: 'lo', address: '127.0.0.1', netmask: '255.0.0.0' };
const INSTANCE = ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'];
/** 等回答最多 1 秒：本机回环上几毫秒就到。 */
const REPLY_TIMEOUT_MS = 1_000;

const zoneFor = (iface: LanInterface): MdnsZone => ({
  host: ['labelflash-1a2b3c4d', 'local'],
  address: iface.address,
  services: [
    { instance: INSTANCE[0] ?? '', serviceType: ['_ipp', '_tcp', 'local'], subtypes: ['_universal'], port: 8631, txt: [['rp', 'printers/60x40']] },
  ],
});

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function startAdvertiser() {
  const conflicts: DnsName[] = [];
  const advertiser = new MdnsAdvertiser({
    interfaces: () => [LOOPBACK],
    zoneFor,
    onConflict: (names) => conflicts.push(...names),
    bindPort: 0,
    sleep: async () => undefined,
    log: () => undefined,
  });
  expect(await advertiser.start()).toBe(true);
  cleanups.push(() => advertiser.stop());
  const port = advertiser.boundPort();
  if (port === null) {
    throw new Error('not bound');
  }
  return { advertiser, port, conflicts };
}

function clientSocket(): Socket {
  const socket = createSocket('udp4');
  cleanups.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
  return socket;
}

/** 从一个普通端口发查询（传统单播），等第一条回答。 */
function ask(port: number, message: DnsMessage): Promise<DnsMessage | null> {
  const socket = clientSocket();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
    socket.on('message', (bytes) => {
      clearTimeout(timer);
      resolve(decodeDnsMessage(bytes));
    });
    socket.send(encodeDnsMessage(message), port, '127.0.0.1');
  });
}

const query = (name: DnsName, type: number): DnsMessage => ({
  id: 9,
  isResponse: false,
  questions: [{ name, type, unicastResponse: false }],
  answers: [],
  authorities: [],
  additionals: [],
});

describe('MdnsAdvertiser', () => {
  test('answers a legacy unicast query for shared printers', async () => {
    const { port } = await startAdvertiser();
    const reply = await ask(port, query(['_ipp', '_tcp', 'local'], DNS_TYPES.PTR));
    expect(reply).toMatchObject({ id: 9, isResponse: true });
    expect(reply?.answers[0]).toMatchObject({ type: 'PTR', target: INSTANCE, ttl: 10 });
    expect(reply?.additionals.find((record) => record.type === 'A')).toMatchObject({ address: '127.0.0.1' });
  });

  test('stays quiet about services it does not have', async () => {
    const { port } = await startAdvertiser();
    expect(await ask(port, query(['_http', '_tcp', 'local'], DNS_TYPES.PTR))).toBeNull();
  });

  test('reports another device answering with its name', async () => {
    const { port, conflicts } = await startAdvertiser();
    const theirs: DnsMessage = {
      id: 0,
      isResponse: true,
      questions: [],
      answers: [{ type: 'SRV', name: INSTANCE, ttl: 120, cacheFlush: true, port: 631, target: ['other', 'local'] }],
      authorities: [],
      additionals: [],
    };
    clientSocket().send(encodeDnsMessage(theirs), port, '127.0.0.1');
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    while (conflicts.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(conflicts).toEqual([INSTANCE]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipp/mdns-advertiser.test.ts`
Expected: FAIL，`Cannot find module './mdns-advertiser'`。

- [ ] **Step 3: 实现**

```ts
// src/main/ipp/mdns-advertiser.ts
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { type DnsMessage, type DnsName, decodeDnsMessage, encodeDnsMessage, nameText } from '../../core/mdns/dns-message';
import type { MdnsZone } from '../../core/mdns/dns-sd';
import { announcement, answerQuery, conflictingNames, goodbye, probeQuery } from '../../core/mdns/mdns-responder';
import { isSameSubnet, type LanInterface } from '../api/network';

/** mDNS 的端口和 IPv4 组播地址（RFC 6762 §3）。 */
export const MDNS_PORT = 5353;
export const MDNS_GROUP = '224.0.0.251';
/** RFC 6762 §8.1：探测 3 次、每次隔 250ms；§8.3：宣告 2 次、隔 1 秒。 */
const PROBE_COUNT = 3;
const PROBE_INTERVAL_MS = 250;
const ANNOUNCE_COUNT = 2;
const ANNOUNCE_INTERVAL_MS = 1_000;
/** 组播的 TTL 必须是 255（RFC 6762 §11）。 */
const MULTICAST_TTL = 255;

export interface MdnsAdvertiserDeps {
  interfaces: () => LanInterface[];
  /** 一块网卡上要回答的区域（用那块网卡的地址）。 */
  zoneFor: (iface: LanInterface) => MdnsZone;
  /** 别的设备在用我们的名字：IppSharing 换个名字重新广播。 */
  onConflict: (names: DnsName[]) => void;
  /** 绑定的端口；测试里用 0（系统随便给），默认 5353。 */
  bindPort?: number | undefined;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

function bind(socket: Socket, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once('error', onError);
    socket.bind(port, '0.0.0.0', () => {
      socket.off('error', onError);
      resolve();
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * mDNS 的收发（node:dgram）。报文的内容都由 core 的 mdns-responder 决定，这里只管套接字、网卡和时机。
 * 绑定 0.0.0.0:5353 时带 reuseAddr：Windows 的 DNS 客户端服务、macOS 的 mDNSResponder 都占着这个端口，大家共用。
 */
export class MdnsAdvertiser {
  private socket: Socket | null = null;
  private interfaces: LanInterface[] = [];
  /** 最近一次宣告的区域（按网卡地址）：告别时要用当时宣告的内容，不是改过之后的。 */
  private readonly announced = new Map<string, MdnsZone>();
  private isProbing = false;
  /** 每次启动、刷新加一：上一轮还没宣告完就又刷新了，旧的那一轮停下。 */
  private round = 0;

  constructor(private readonly deps: MdnsAdvertiserDeps) {}

  /** 绑定并开始探测、宣告（在后台进行）。端口绑不上返回 false：共享照常，只是不能自动发现。 */
  async start(): Promise<boolean> {
    await this.stop();
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    try {
      await bind(socket, this.deps.bindPort ?? MDNS_PORT);
    } catch (error) {
      socket.close();
      this.deps.log(`[ipp] mDNS could not bind: ${describe(error)}`);
      return false;
    }
    this.socket = socket;
    socket.on('error', (error) => this.deps.log(`[ipp] mDNS socket error: ${describe(error)}`));
    socket.on('message', (bytes, remote) => this.receive(bytes, remote));
    try {
      socket.setMulticastTTL(MULTICAST_TTL);
      socket.setMulticastLoopback(true);
    } catch (error) {
      this.deps.log(`[ipp] mDNS multicast options failed: ${describe(error)}`);
    }
    this.interfaces = this.deps.interfaces();
    for (const iface of this.interfaces) {
      try {
        socket.addMembership(MDNS_GROUP, iface.address);
      } catch (error) {
        this.deps.log(`[ipp] mDNS cannot join the group on ${iface.name} ${iface.address}: ${describe(error)}`);
      }
    }
    void this.probeAndAnnounce();
    return true;
  }

  /** 服务变了（纸张分配、端口、名字、密码）：告别旧的，再探测、宣告新的。 */
  async refresh(): Promise<void> {
    if (this.socket === null) {
      return;
    }
    this.sendGoodbyes();
    await this.probeAndAnnounce();
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    this.round += 1;
    this.sendGoodbyes();
    this.socket = null;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  /** 实际绑定的端口（测试用）。 */
  boundPort(): number | null {
    return this.socket === null ? null : this.socket.address().port;
  }

  private async probeAndAnnounce(): Promise<void> {
    this.round += 1;
    const round = this.round;
    this.isProbing = true;
    for (let index = 0; index < PROBE_COUNT; index += 1) {
      this.multicastEach((zone) => probeQuery(zone), false);
      await this.deps.sleep(PROBE_INTERVAL_MS);
      if (round !== this.round) {
        return;
      }
    }
    this.isProbing = false;
    for (let index = 0; index < ANNOUNCE_COUNT; index += 1) {
      this.multicastEach((zone) => announcement(zone), true);
      if (index + 1 < ANNOUNCE_COUNT) {
        await this.deps.sleep(ANNOUNCE_INTERVAL_MS);
        if (round !== this.round) {
          return;
        }
      }
    }
  }

  private multicastEach(build: (zone: MdnsZone) => DnsMessage, remember: boolean): void {
    for (const iface of this.interfaces) {
      const zone = this.deps.zoneFor(iface);
      if (remember) {
        this.announced.set(iface.address, zone);
      }
      this.multicast(iface, build(zone));
    }
  }

  private multicast(iface: LanInterface, message: DnsMessage): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    try {
      // 从这块网卡发出去：多网卡的电脑上，默认网卡不一定是对方所在的那块。
      socket.setMulticastInterface(iface.address);
      socket.send(encodeDnsMessage(message), MDNS_PORT, MDNS_GROUP);
    } catch (error) {
      this.deps.log(`[ipp] mDNS send on ${iface.address} failed: ${describe(error)}`);
    }
  }

  private sendGoodbyes(): void {
    for (const iface of this.interfaces) {
      const zone = this.announced.get(iface.address);
      if (zone !== undefined) {
        this.multicast(iface, goodbye(zone));
      }
    }
    this.announced.clear();
  }

  private receive(bytes: Buffer, remote: RemoteInfo): void {
    const ownPort = this.boundPort();
    if (remote.port === ownPort && this.interfaces.some((iface) => iface.address === remote.address)) {
      return;
    }
    const message = decodeDnsMessage(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (message === null) {
      return;
    }
    const iface = this.interfaces.find((item) => isSameSubnet(item.address, remote.address, item.netmask)) ?? this.interfaces[0];
    if (iface === undefined) {
      return;
    }
    const zone = this.deps.zoneFor(iface);
    // 别人的回答、或者探测时别人也在探测同样的名字：看有没有冲突。
    if (message.isResponse || (this.isProbing && message.authorities.length > 0)) {
      const names = conflictingNames(message, zone);
      if (names.length > 0) {
        this.deps.log(`[ipp] mDNS name conflict: ${names.map(nameText).join(', ')}`);
        this.deps.onConflict(names);
      }
      if (message.isResponse) {
        return;
      }
    }
    const isLegacy = remote.port !== MDNS_PORT;
    const reply = answerQuery(message, zone, isLegacy);
    if (reply === null) {
      return;
    }
    if (isLegacy || message.questions.some((question) => question.unicastResponse)) {
      this.socket?.send(encodeDnsMessage(reply), remote.port, remote.address);
    } else {
      this.multicast(iface, reply);
    }
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/ipp`
Expected: PASS（三台 CI 机器上组播可能不通，测试只用单播，不受影响；组播相关的日志是 warn，不算失败）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/ipp/mdns-advertiser.ts src/main/ipp/mdns-advertiser.test.ts
git commit -m "feat(ipp): announce shared printers over mDNS" -m "A UDP socket shares port 5353 with the system responder, joins the mDNS group on every physical LAN card, probes, announces and says goodbye, and answers each query with the address of the card on the asker's subnet. Legacy and unicast questions get unicast replies; another device claiming our names is reported so the instance can be renamed." -m "$TRAILER"
```

---

### Task 18: 防火墙放行 mDNS

本机接口那条规则按程序放行 TCP 的所有端口，8631 天然在内；mDNS 要收别的电脑发来的 UDP 5353，再加一条：同名、同程序、UDP、本地端口 5353、所有网络类型。两条一起加、一起删（卸载时按程序和名字删，两条都在内）。查询分开：原来的 `check` 只看 TCP 那条是否放行（**不变**：已经装了 1.x、只有 TCP 规则的电脑上，本机接口照旧算「已放行」，不回退）；新的 `check-discovery` 看 UDP 5353 那条。安装包用同一份脚本（`firewallInstallerScript` 里的 `MUTATE_BODY`），所以新装、覆盖装都会两条都加——要在 Windows 上实际装一次、更新一次、卸载一次验证（Task 25）。

**Files:**
- Modify: `src/shared/firewall-rule.ts`、`src/shared/firewall-rule.test.ts`
- Modify: `src/main/firewall.ts`、`src/main/firewall.test.ts`

- [ ] **Step 1: 写测试**

`firewall-rule.test.ts` 的 `describe` 里加：

```ts
  // 局域网共享的自动发现要收 UDP 5353：和 TCP 那条一起加，安装包用同一份脚本。
  test('allows mDNS on UDP 5353 for the same program alongside TCP', () => {
    for (const script of [firewallScript('add', 'C:\\a.exe'), firewallInstallerScript()]) {
      expect(script).toContain('-Protocol TCP');
      expect(script).toContain(`-Protocol UDP -LocalPort ${MDNS_UDP_PORT}`);
    }
  });

  // 原来的查询只看 TCP 那条：只有旧规则的电脑上本机接口照旧算放行。
  test('checks the mDNS rule separately', () => {
    expect(firewallScript('check', 'C:\\a.exe')).not.toContain('UDP');
    const script = firewallScript('check-discovery', 'C:\\a.exe');
    expect(script).toContain('Get-NetFirewallPortFilter');
    expect(script).toContain(`'${MDNS_UDP_PORT}'`);
    for (const word of ["'allowed'", "'missing'", "'unknown'"]) {
      expect(script).toContain(word);
    }
  });
```

（import 加 `MDNS_UDP_PORT`。第一个用例「loads the firewall module」的循环里加上 `'check-discovery'`。）

`firewall.test.ts` 里如果有按动作逐个核对 `firewallScript` 的用例，加上 `discoveryFirewallStatus` 在非 Windows 上返回 `unknown` 的一条（照着 `firewallStatus` 那条写）。

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/firewall-rule.test.ts src/main/firewall.test.ts`
Expected: FAIL（`MDNS_UDP_PORT` 没有导出；脚本里没有 UDP）。

- [ ] **Step 3: 实现**

`src/shared/firewall-rule.ts`：

1. 文件开头的说明改为「Windows 防火墙规则：允许局域网里的电脑连到本机接口和局域网共享（TCP，按程序放行），以及局域网共享的自动发现（mDNS，UDP 5353）。程序（配置中心的按钮）和安装包用同一份脚本。」；`FIREWALL_RULE_NAME` 不改（改名会让已有的规则对不上）。
2. 加常量和动作：

```ts
/** mDNS 的端口（RFC 6762）：局域网共享自动发现要收别的电脑发来的查询。 */
export const MDNS_UDP_PORT = 5353;

export type FirewallAction = 'add' | 'remove' | 'check' | 'check-discovery';
```

3. `MUTATE_BODY` 里 `New-NetFirewallRule ... -Protocol TCP ...` 那一行之后、同一个 `if` 里加一行：

```
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${MDNS_UDP_PORT} -Program $Program -Profile Any | Out-Null
```

并把它上面的注释改成「只放行 TCP（本机接口、局域网共享）和 UDP 5353（mDNS）；所有网络类型都生效……」。`MUTATE_BODY` 是模板字符串，`${MDNS_UDP_PORT}` 要求常量定义在它之前。

4. 加查询脚本：

```ts
/**
 * 查 mDNS（UDP 5353）那条规则，输出一个词：allowed / missing / unknown（含义同 CHECK_BODY）。
 * 和 CHECK_BODY 分开：只装过旧版、只有 TCP 规则的电脑上，本机接口照旧算放行，只是局域网共享不能自动发现。
 */
const CHECK_DISCOVERY_BODY = `
$ProgressPreference = 'SilentlyContinue'
try {
  ${IMPORT_MODULE}
  if (-not @(Get-NetFirewallProfile -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' }).Count) { 'allowed'; exit 0 }
  $rules = @(Get-NetFirewallApplicationFilter -Program $Program -ErrorAction SilentlyContinue |
    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
  $mdns = @($rules | Where-Object { $_.DisplayName -eq $Name -and $_.Action -eq 'Allow' } |
    Where-Object { @($_ | Get-NetFirewallPortFilter | Where-Object { $_.Protocol -eq 'UDP' -and $_.LocalPort -eq '${MDNS_UDP_PORT}' }).Count -gt 0 })
  $blocked = @($rules | Where-Object { $_.Action -eq 'Block' })
  if ($mdns.Count -eq 0 -or $blocked.Count -gt 0) { 'missing' } else { 'allowed' }
} catch {
  'unknown'
}
`;
```

5. `firewallScript` 里 `check` 那个分支之后加：

```ts
  if (action === 'check-discovery') {
    return [...variables, CHECK_DISCOVERY_BODY].join('\n');
  }
```

`src/main/firewall.ts` 加：

```ts
/** mDNS（UDP 5353）那条规则放行没有（局域网共享的自动发现）。只有 Windows 查；其他平台为 unknown。 */
export async function discoveryFirewallStatus(program: string): Promise<FirewallStatus> {
  if (process.platform !== 'win32') {
    return 'unknown';
  }
  const { ok, stdout } = await runPowerShell(
    ['-EncodedCommand', encode(firewallScript('check-discovery', program))],
    CHECK_TIMEOUT_MS,
  );
  return ok ? parseFirewallCheck(stdout) : 'unknown';
}
```

`addFirewallRule` 的文档注释改为「弹管理员确认，加两条只放行这个程序的入站规则（TCP 所有端口、UDP 5353）」。

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/firewall-rule.test.ts src/main/firewall.test.ts`
Expected: PASS。

- [ ] **Step 5: 在 Windows 上手动核对一次脚本**（在仓库目录以管理员身份打开 PowerShell；`LF_EXE` 换成本机安装版主程序的完整路径）

```powershell
$env:LF_EXE = "$env:LOCALAPPDATA\Programs\CDL-LabelFlash\CDL-云签速印.exe"
# 加 BOM：Windows PowerShell 5.1 不带 BOM 时按 ANSI 读脚本，路径里的中文会读错。
bun -e "import { firewallScript } from './src/shared/firewall-rule'; for (const a of ['add', 'check-discovery']) await Bun.write(process.env.TEMP + '/fw-' + a + '.ps1', '﻿' + firewallScript(a, process.env.LF_EXE ?? ''))"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\fw-add.ps1"
Get-NetFirewallRule -DisplayName 'CDL-LabelFlash local API' | Get-NetFirewallPortFilter | Format-Table Protocol, LocalPort
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\fw-check-discovery.ps1"
```

Expected: 端口表两行：`TCP Any`、`UDP 5353`；最后一条输出 `allowed`。记进 `docs/windows-acceptance.md`（Task 25）。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/shared/firewall-rule.ts src/shared/firewall-rule.test.ts src/main/firewall.ts src/main/firewall.test.ts
git commit -m "feat(firewall): allow mDNS for LAN sharing discovery" -m "The program rule already covers every TCP port, including the IPP port. Discovery also needs inbound UDP 5353, so adding the rule now creates a second rule with the same name and program, and the installer gets it through the same script. Its check is separate so machines with only the old TCP rule keep the local API open on the LAN." -m "$TRAILER"
```

---

### Task 19: 设置项和 `IppSharing`（组装、跟随设置、状态）

设置加四项：`ippSharingEnabled`（默认关，最小权限）、`ippPort`（指定的端口，null = 不指定）、`ippLastPort`（上次用成功的，程序自己记）、`ippInstanceId`（第一次打开共享时生成的 UUID：打印机的 UUID 和 mDNS 主机名由它算，重启不变）。

`IppSharing` 把任务表、密码、询问、处理、HTTP 服务、mDNS 组装起来，和 `LocalApi` 同一个写法：启停排成一队，每次按那时最新的设置来；没打开就全部关掉；安装版的 Windows 防火墙还没放行时先不监听（监听了 Windows 会弹它自己的防火墙警告，普通用户点不了「允许」，点取消还会留下阻止规则）；首选端口被占用时查是谁占的。共享的打印机 = 纸张分配表里、打印机这台电脑上装着的那些纸；状态（缺纸、离线……）每次请求时实时算。纸张分配变了只刷新打印机和广播，不重启服务。

**Files:**
- Modify: `src/shared/settings.ts`、`src/shared/settings.test.ts`
- Modify: `src/shared/ipp-sharing.ts`
- Create: `src/main/ipp/ipp-sharing.ts`、`src/main/ipp/ipp-sharing.test.ts`

- [ ] **Step 1: 写测试**

`settings.test.ts` 加：

```ts
  test('keeps LAN sharing off by default and drops invalid ports and ids', () => {
    expect(DEFAULT_SETTINGS.ippSharingEnabled).toBe(false);
    const settings = sanitizeSettings({
      ippSharingEnabled: true,
      ippPort: 8700,
      ippLastPort: 80,
      ippInstanceId: 'not-a-uuid',
    });
    expect(settings).toMatchObject({ ippSharingEnabled: true, ippPort: 8700, ippLastPort: null, ippInstanceId: null });
  });
```

```ts
// src/main/ipp/ipp-sharing.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { nameAttr } from '../../core/ipp/ipp-attributes';
import { GROUP_TAGS, OPERATIONS } from '../../core/ipp/ipp-constants';
import { attributeIn, ippRequest, MINIMAL_PDF } from '../../core/ipp/testing/ipp-requests';
import type { FieldsPrint } from '../../core/print-service';
import { FakeClock } from '../../core/testing/fake-clock';
import type { IppSharingStatus } from '../../shared/ipp-sharing';
import type { FirewallStatus } from '../../shared/local-api';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../storage/database';
import { SqliteIppStore } from '../storage/sqlite-ipp-store';
import type { PendingClient } from './client-approvals';
import { IppSharing, type IppSharingDeps, printerUuid } from './ipp-sharing';
import { FakeRenderer, MemoryPieces, PRINTED } from './testing/fakes';
import { sendIpp } from './testing/ipp-client';

const sharings: IppSharing[] = [];

afterEach(async () => {
  await Promise.all(sharings.splice(0).map((sharing) => sharing.stop()));
});

function createSharing(patch: Partial<AppSettings> = {}, overrides: Partial<IppSharingDeps> = {}) {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ippSharingEnabled: true,
    paperPrinters: { '60x40': '标签机A', '100x150': '没装的打印机' },
    ...patch,
  };
  const statuses: IppSharingStatus[] = [];
  const printed: FieldsPrint[] = [];
  const notified: PendingClient[] = [];
  const firewall: { state: FirewallStatus } = { state: 'unknown' };
  const sharing = new IppSharing({
    clock: new FakeClock(),
    settings: () => settings,
    updateSettings: (next) => {
      settings = { ...settings, ...next };
      return settings;
    },
    store: new SqliteIppStore(openDatabase(':memory:')),
    computerName: () => '前台',
    productNameAscii: 'CDL-LabelFlash',
    makeAndModel: 'CDL-云签速印 共享热敏标签机',
    installedPrinters: async () => ['标签机A'],
    readinessOf: () => null,
    dpiOf: async () => 203,
    firewall: {
      check: async () => firewall.state,
      checkDiscovery: async () => firewall.state,
      add: async () => {
        firewall.state = 'allowed';
        return firewall.state;
      },
    },
    holdUntilFirewallAllows: false,
    candidatePorts: [0],
    discoveryEnabled: false,
    lanInterfaces: () => [],
    render: {
      renderer: new FakeRenderer(),
      pieces: new MemoryPieces(),
      printFields: async (input) => {
        printed.push(input);
        return PRINTED;
      },
    },
    findPortOwner: async () => null,
    notifyClientRequest: (client) => notified.push(client),
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    sleep: async () => undefined,
    log: () => undefined,
    ...overrides,
  });
  sharings.push(sharing);
  return {
    sharing,
    statuses,
    printed,
    notified,
    firewall,
    settings: () => settings,
    /** 像操作员保存设置那样改：之后再调 settingsChanged。 */
    update: (next: Partial<AppSettings>) => {
      settings = { ...settings, ...next };
    },
  };
}

function urlOf(status: IppSharingStatus): string {
  if (status.server.state !== 'listening') {
    throw new Error(`not listening: ${JSON.stringify(status.server)}`);
  }
  return `http://127.0.0.1:${status.server.port}/printers/60x40`;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

describe('IppSharing', () => {
  test('stays off until sharing is turned on', async () => {
    const { sharing } = createSharing({ ippSharingEnabled: false });
    await sharing.start();
    expect(sharing.status().server).toEqual({ state: 'off' });
  });

  test('shares only papers whose printer is installed and remembers the port', async () => {
    const { sharing, settings } = createSharing();
    await sharing.start();
    const status = sharing.status();
    expect(status.server.state).toBe('listening');
    expect(status.printers).toEqual([{ key: '60x40', name: '60×40 标签', printerName: '标签机A' }]);
    expect(settings().ippLastPort).toBe(status.server.state === 'listening' ? status.server.port : -1);
    expect(settings().ippInstanceId).not.toBeNull();
  });

  test('waits for the Windows firewall in the installed app', async () => {
    const { sharing, firewall } = createSharing({}, { holdUntilFirewallAllows: true });
    firewall.state = 'missing';
    await sharing.start();
    expect(sharing.status().server).toEqual({ state: 'held' });
    await sharing.addFirewallRule();
    expect(sharing.status().server.state).toBe('listening');
  });

  test('asks the operator about a new computer, then prints its job as a LAN share record', async () => {
    const { sharing, printed, notified } = createSharing();
    await sharing.start();
    const reply = await sendIpp(
      urlOf(sharing.status()),
      ippRequest(OPERATIONS.printJob, { operation: [nameAttr('requesting-user-name', 'zhang')] }),
      MINIMAL_PDF,
    );
    expect(attributeIn(reply.message ?? ippRequest(0), GROUP_TAGS.job, 'job-state')?.values).toEqual([{ kind: 'enum', value: 4 }]);
    await waitUntil(() => sharing.status().pendingClients.length === 1);
    expect(notified).toMatchObject([{ address: '127.0.0.1', user: 'zhang', printerName: '60×40 标签' }]);
    sharing.decideClient('127.0.0.1', true);
    await waitUntil(() => printed.length === 1);
    expect(printed[0]).toMatchObject({ source: 'ipp', ipp: { client: '127.0.0.1', user: 'zhang' } });
    expect(sharing.status().clients).toMatchObject([{ address: '127.0.0.1', decision: 'allow', lastUser: 'zhang' }]);
  });

  test('asks for the share password once it is set', async () => {
    const { sharing } = createSharing();
    await sharing.start();
    await sharing.setPassword('1234');
    expect(sharing.status().passwordSet).toBe(true);
    expect((await sendIpp(urlOf(sharing.status()), ippRequest(OPERATIONS.printJob), MINIMAL_PDF)).httpStatus).toBe(401);
    await sharing.clearPassword();
    expect(sharing.status().passwordSet).toBe(false);
  });

  test('moves to a chosen port and stops when sharing is turned off', async () => {
    const { sharing, settings, update } = createSharing();
    await sharing.start();
    const first = settings();
    update({ ippPort: null, ippLastPort: null });
    await sharing.settingsChanged(settings(), { ...first, ippPort: 1 });
    expect(sharing.status().server.state).toBe('listening');
    const before = settings();
    update({ ippSharingEnabled: false });
    await sharing.settingsChanged(settings(), before);
    expect(sharing.status().server).toEqual({ state: 'off' });
  });
});

describe('printerUuid', () => {
  test('is stable for an instance and a paper and shaped like a version 5 UUID', () => {
    const uuid = printerUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '60x40');
    expect(uuid).toBe(printerUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '60x40'));
    expect(uuid).not.toBe(printerUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '100x150'));
    expect(uuid).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

（`IppSharing` 每次按 `deps.settings()` 读最新的设置，所以最后一个用例先用 `update` 改设置，再像主进程那样调 `settingsChanged(新, 旧)`；端口那一步的「旧」故意给一个不同的 `ippPort`，触发重新监听。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/settings.test.ts src/main/ipp/ipp-sharing.test.ts`
Expected: FAIL（设置里没有这几项；`./ipp-sharing` 不存在）。

- [ ] **Step 3: 设置项**

`src/shared/settings.ts`：

1. `AppSettings` 末尾加：

```ts
  /** 局域网共享（IPP）：打开后局域网里的电脑能把这台电脑的热敏标签机当打印机用。默认关（最小权限：网络监听由用户明确打开）。 */
  ippSharingEnabled: boolean;
  /** 操作员指定的共享端口；null = 不指定（默认 8631，被占用时自动换）。 */
  ippPort: number | null;
  /** 共享上次用成功的端口（程序自己记）：重启后端口不变，按地址添加过的电脑不会忽然连不上。 */
  ippLastPort: number | null;
  /** 共享的实例编号（第一次打开共享时生成）：每台共享打印机的 UUID 和 mDNS 主机名由它算，重启不变。 */
  ippInstanceId: string | null;
```

2. `DEFAULT_SETTINGS` 末尾加 `ippSharingEnabled: false, ippPort: null, ippLastPort: null, ippInstanceId: null,`。
3. `sanitizeSettings` 末尾加：

```ts
    ippSharingEnabled: sanitizeBoolean(input['ippSharingEnabled'], DEFAULT_SETTINGS.ippSharingEnabled),
    ippPort: sanitizeApiPort(input['ippPort']),
    ippLastPort: sanitizeApiPort(input['ippLastPort']),
    ippInstanceId: sanitizeInstanceId(input['ippInstanceId']),
```

（端口规则和本机接口一样：1024–65535，不合法回到「不指定」。）

- [ ] **Step 4: 状态类型**（`src/shared/ipp-sharing.ts` 末尾加）

```ts
import type { FirewallStatus } from './local-api';

/** 共享服务的状态。 */
export type IppServerState =
  | { state: 'off' }
  /** 安装版上 Windows 防火墙还没放行：先不监听，等操作员点「添加防火墙规则」。 */
  | { state: 'held' }
  /** skippedPorts：想用却被占用、自动跳过的端口。 */
  | { state: 'listening'; port: number; skippedPorts: number[] }
  | { state: 'failed'; reason: 'PORT_IN_USE'; ports: number[] }
  /** 不是端口的问题：详情在日志里。 */
  | { state: 'failed'; reason: 'START_ERROR' };

/** 自动发现（mDNS）：on = 正在广播；off = 没开（共享没开，或开发版关掉了）；blocked = 防火墙没放行 UDP 5353；failed = 绑不上端口或名字冲突太多。 */
export type DiscoveryState = 'off' | 'on' | 'blocked' | 'failed';

/** 一台共享打印机（一种纸）。 */
export interface SharedPrinterView {
  /** 纸张键，也是网址里的名字。 */
  key: string;
  /** 「60×40 标签」。 */
  name: string;
  /** 实际打到的本机打印机。 */
  printerName: string;
}

/** 正在等确认的一台电脑（程序顶部的询问条）。 */
export interface PendingClientView {
  address: string;
  user: string;
  printerName: string;
  jobs: number;
}

/** 记住的一台电脑（共享页里可以撤销）。 */
export interface RememberedClientView {
  address: string;
  decision: 'allow' | 'deny';
  lastUser: string;
  decidedAt: number;
}

/** 配置中心「局域网共享」页和顶部询问条要的全部状态（主进程在变化时推送）。 */
export interface IppSharingStatus {
  server: IppServerState;
  discovery: DiscoveryState;
  /** 本程序在 mDNS 里的主机名（labelflash-xxxx.local）；没在共享时为 null。 */
  hostName: string | null;
  /** 这台电脑的局域网地址：按地址添加时用。 */
  lanAddresses: string[];
  printers: SharedPrinterView[];
  /** 首选端口被占用时，占用它的程序名。 */
  portOwner: string | null;
  firewall: FirewallStatus;
  passwordSet: boolean;
  pendingClients: PendingClientView[];
  clients: RememberedClientView[];
  /** 收下还没结束的任务数。 */
  activeJobs: number;
}
```

（`import` 放到文件开头。）

- [ ] **Step 5: 组装**

```ts
// src/main/ipp/ipp-sharing.ts
import { createHash, randomUUID } from 'node:crypto';
import { ippAdvert } from '../../core/ipp/ipp-advert';
import { IppJobBook } from '../../core/ipp/ipp-job-book';
import { type SharedPrinter, sharedPrinterState } from '../../core/ipp/shared-printer';
import type { DnsName } from '../../core/mdns/dns-message';
import type { MdnsZone } from '../../core/mdns/dns-sd';
import { SerialQueue } from '../../core/serial-queue';
import type { Clock } from '../../core/types';
import type { DiscoveryState, IppServerState, IppSharingStatus } from '../../shared/ipp-sharing';
import type { FirewallStatus } from '../../shared/local-api';
import { formatPaperName, type PaperSize, paperKey, parsePaperKey } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';
import type { AppSettings } from '../../shared/settings';
import type { LanInterface } from '../api/network';
import { ANY_FREE_PORT, portOrder } from '../net/http-listener';
import type { SqliteIppStore } from '../storage/sqlite-ipp-store';
import { ClientApprovals, type PendingClient } from './client-approvals';
import { DEFAULT_IPP_PORTS, IppHttpServer } from './ipp-http-server';
import { IppJobProcessor, type IppJobProcessorDeps } from './ipp-job-processor';
import { MdnsAdvertiser } from './mdns-advertiser';
import { SharePassword } from './share-password';

/** 仅开发 / E2E：共享用这个端口（0 = 系统随便给一个），不和本机上跑着的安装版抢 8631。安装版忽略它。 */
export const IPP_PORT_ENV = 'CDL_LABELFLASH_IPP_PORT';
/** 仅开发 / E2E：设为 0 时不开 mDNS（并行的用例、CI 机器上不往局域网广播）。安装版忽略它。 */
export const IPP_DISCOVERY_ENV = 'CDL_LABELFLASH_IPP_DISCOVERY';
const MAX_PORT = 65_535;
/** mDNS 主机名：labelflash-<实例编号前 8 位>.local。和电脑自己的名字分开，不和系统的响应器抢名字。 */
const HOST_PREFIX = 'labelflash-';
const HOST_ID_CHARS = 8;
const MDNS_DOMAIN = 'local';
/** 名字冲突时最多换到「 (9)」：再冲突就不广播了，按地址添加照样能用。 */
const MAX_NAME_SERIAL = 9;
/** 打印机资料读不到分辨率时按 203dpi：热敏标签机最常见的分辨率（和打印时的兜底一致）。 */
const FALLBACK_DPI = 203;
/** UUID 第 13 位写版本号 5（按名字算出来的），第 17 位的高两位写 10（RFC 4122 变体）。 */
const UUID_VERSION = '5';
const UUID_VARIANT_MASK = 0x3;
const UUID_VARIANT_BITS = 0x8;
const HEX = 16;

/** 没指定端口时依次尝试的端口（默认 8631–8640；开发版和 E2E 可以用环境变量换成别的）。 */
export function ippCandidatePorts(env: NodeJS.ProcessEnv, isPackaged: boolean): readonly number[] {
  const override = isPackaged ? undefined : env[IPP_PORT_ENV];
  const port = override === undefined || override === '' ? Number.NaN : Number(override);
  return Number.isInteger(port) && port >= 0 && port <= MAX_PORT ? [port] : DEFAULT_IPP_PORTS;
}

export function isDiscoveryEnabled(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return isPackaged || env[IPP_DISCOVERY_ENV] !== '0';
}

/** 每台共享打印机的 UUID：按程序实例和纸张键算（SHA-256 截成 UUID 的样子），重启、换端口都不变。 */
export function printerUuid(instanceId: string, key: string): string {
  const hex = createHash('sha256').update(`${instanceId}:${key}`).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), HEX) & UUID_VARIANT_MASK) | UUID_VARIANT_BITS).toString(HEX);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${UUID_VERSION}${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface IppSharingDeps {
  clock: Clock;
  settings: () => AppSettings;
  /** 只改共享自己记的几项（上次的端口、实例编号）：不走 onSettingsChanged。 */
  updateSettings: (patch: Partial<AppSettings>) => AppSettings;
  store: SqliteIppStore;
  computerName: () => string;
  productNameAscii: string;
  makeAndModel: string;
  installedPrinters: () => Promise<string[]>;
  /** 打印机状态（驱动报告的）；查不到为 null。 */
  readinessOf: (printerName: string) => PrinterReadiness | null;
  dpiOf: (printerName: string) => Promise<number>;
  /** Windows 防火墙：TCP（服务）、UDP 5353（自动发现）、弹管理员确认加规则。其他平台都是 unknown。 */
  firewall: {
    check: () => Promise<FirewallStatus>;
    checkDiscovery: () => Promise<FirewallStatus>;
    add: () => Promise<FirewallStatus>;
  };
  /** 防火墙还没放行时先不监听（安装版为 true）。 */
  holdUntilFirewallAllows: boolean;
  candidatePorts: readonly number[];
  discoveryEnabled: boolean;
  lanInterfaces: () => LanInterface[];
  /** 渲染页、位图缓存、打印（PrintService.printFields）。 */
  render: Pick<IppJobProcessorDeps, 'renderer' | 'pieces' | 'printFields'>;
  findPortOwner: (port: number) => Promise<string | null>;
  notifyClientRequest: (client: PendingClient) => void;
  onStatus: (status: IppSharingStatus) => void;
  onJobsChanged: () => void;
  schedule: (run: () => void, delayMs: number) => () => void;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

interface PrinterEntry {
  printer: Omit<SharedPrinter, 'state' | 'queuedJobCount'>;
  printerName: string;
}

/**
 * 局域网共享：把任务表、共享密码、新电脑询问、任务处理、IPP 服务和 mDNS 组装起来，跟随设置启停。
 * 不 import electron：渲染窗口、打印、防火墙、通知都由主进程传入，可以用 bun test 整体测试。
 */
export class IppSharing {
  private readonly book: IppJobBook;
  private readonly password: SharePassword;
  private readonly approvals: ClientApprovals;
  private readonly processor: IppJobProcessor;
  private readonly server: IppHttpServer;
  private readonly advertiser: MdnsAdvertiser;
  /** 启停、刷新一次只做一件：每次都按那时最新的设置来。 */
  private readonly restarts = new SerialQueue();
  private entries = new Map<string, PrinterEntry>();
  private serverState: IppServerState = { state: 'off' };
  private discovery: DiscoveryState = 'off';
  private firewall: FirewallStatus = 'unknown';
  private portOwner: string | null = null;
  /** 每次启动加一：查占用程序是后台做的，查到时如果已经又重启过，结果就作废。 */
  private generation = 0;
  /** 名字冲突后加在实例名后面的序号。 */
  private nameSerial = 1;

  constructor(private readonly deps: IppSharingDeps) {
    this.book = new IppJobBook(deps.clock);
    this.password = new SharePassword(deps.store, deps.clock);
    this.approvals = new ClientApprovals({
      store: deps.store,
      clock: deps.clock,
      schedule: deps.schedule,
      notify: deps.notifyClientRequest,
      onChange: () => this.publish(),
    });
    this.processor = new IppJobProcessor({
      ...deps.render,
      book: this.book,
      dpiFor: async (paper) => this.dpiFor(paper),
      waitForApproval: (address, user, printerName) => this.approvals.waitFor(address, user, printerName),
      onJobsChanged: deps.onJobsChanged,
      onChange: () => this.publish(),
      log: deps.log,
    });
    this.server = new IppHttpServer({
      clock: deps.clock,
      printers: () => this.sharedPrinters(),
      book: this.book,
      password: this.password,
      decisionFor: (address) => this.approvals.decisionFor(address),
      onAccepted: (job) => {
        // 记下对方实际发来的格式：真机验证时据此判断 Windows、macOS 走的是 PDF 还是光栅。
        deps.log(
          `[ipp] job ${job.job.id} from ${job.job.client} for ${job.printer.key}: format ${job.document.format}, ${job.document.data.length} bytes, ${job.document.copies} copies`,
        );
        void this.processor.enqueue(job);
        this.publish();
      },
      fallbackHost: () => deps.lanInterfaces()[0]?.address ?? '127.0.0.1',
    });
    this.advertiser = new MdnsAdvertiser({
      interfaces: deps.lanInterfaces,
      zoneFor: (iface) => this.zoneFor(iface),
      onConflict: (names) => void this.renameAfterConflict(names),
      sleep: deps.sleep,
      log: deps.log,
    });
  }

  /** 收下还没结束的任务数：有的时候不静默更新（重启会丢掉它们）。 */
  get pendingJobs(): number {
    return this.book.activeCount();
  }

  start(): Promise<void> {
    return this.listen();
  }

  stop(): Promise<void> {
    return this.restarts.run(async () => {
      this.generation += 1;
      await this.shutDown();
    });
  }

  async settingsChanged(next: AppSettings, previous: AppSettings): Promise<void> {
    if (next.ippPort === null && previous.ippPort !== null) {
      // 清空指定的端口就是回到默认端口：忘掉记住的那个（它多半就是刚才指定的）。
      this.deps.updateSettings({ ippLastPort: null });
    }
    if (next.ippSharingEnabled !== previous.ippSharingEnabled || next.ippPort !== previous.ippPort) {
      await this.listen();
    } else if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) {
      await this.refresh();
    }
  }

  /** 打印机列表变了（插拔、重装驱动）：重新拼共享打印机，刷新广播；不重启服务。 */
  refresh(): Promise<void> {
    return this.restarts.run(async () => {
      if (this.serverState.state !== 'listening') {
        return;
      }
      await this.loadPrinters();
      await this.advertiser.refresh();
      this.publish();
    });
  }

  status(): IppSharingStatus {
    const isListening = this.serverState.state === 'listening';
    return {
      server: this.serverState,
      discovery: this.discovery,
      hostName: isListening ? `${this.hostLabel()}.${MDNS_DOMAIN}` : null,
      lanAddresses: this.deps.lanInterfaces().map((iface) => iface.address),
      printers: [...this.entries.values()].map(({ printer, printerName }) => ({ key: printer.key, name: printer.name, printerName })),
      portOwner: this.portOwner,
      firewall: this.firewall,
      passwordSet: this.password.isSet(),
      pendingClients: this.approvals.pending().map(({ address, user, printerName, jobs }) => ({ address, user, printerName, jobs })),
      clients: this.approvals.remembered(),
      activeJobs: this.book.activeCount(),
    };
  }

  async setPassword(password: string): Promise<void> {
    await this.password.set(password);
    await this.passwordChanged();
  }

  async clearPassword(): Promise<void> {
    this.password.clear();
    await this.passwordChanged();
  }

  /** 操作员在询问条上点了「允许」或「拒绝」。 */
  decideClient(address: string, allow: boolean): void {
    this.approvals.decide(address, allow);
  }

  /** 撤销对一台电脑的决定：它下次打印时重新问。 */
  forgetClient(address: string): void {
    this.approvals.forget(address);
  }

  /** 弹管理员确认加防火墙规则（TCP 和 UDP 5353），然后按新的情况重新监听。 */
  async addFirewallRule(): Promise<FirewallStatus> {
    await this.deps.firewall.add();
    await this.listen();
    return this.firewall;
  }

  /** 本机接口那边加了防火墙规则：重新看要不要监听、广播。 */
  firewallChanged(): Promise<void> {
    return this.deps.settings().ippSharingEnabled ? this.listen() : Promise.resolve();
  }

  private async passwordChanged(): Promise<void> {
    // 密码变了：记住的认证全部作废；广播里的 air（要不要问用户名密码）也跟着变。
    this.server.forgetCredentials();
    await this.restarts.run(() => this.advertiser.refresh());
    this.publish();
  }

  private listen(): Promise<void> {
    return this.restarts.run(() => this.listenNow());
  }

  /** 按现在的设置（重新）监听。出错也只发布状态、写日志，不抛给保存设置的调用方：设置已经存下了。 */
  private async listenNow(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.portOwner = null;
    const settings = this.deps.settings();
    if (!settings.ippSharingEnabled) {
      await this.shutDown();
      this.publish();
      return;
    }
    if (settings.ippInstanceId === null) {
      this.deps.updateSettings({ ippInstanceId: randomUUID() });
    }
    await this.loadPrinters();
    this.firewall = await this.deps.firewall.check();
    if (this.deps.holdUntilFirewallAllows && this.firewall === 'missing') {
      await this.shutDown();
      this.serverState = { state: 'held' };
      this.publish();
      return;
    }
    const ports = portOrder(settings.ippPort, settings.ippLastPort, this.deps.candidatePorts);
    try {
      const status = await this.server.start(ports);
      this.serverState =
        status.state === 'listening' ? { state: 'listening', port: status.port, skippedPorts: status.skippedPorts } : status;
    } catch (error) {
      this.deps.log(`[ipp] sharing failed to start: ${error instanceof Error ? error.message : String(error)}`);
      this.serverState = { state: 'failed', reason: 'START_ERROR' };
      this.publish();
      return;
    }
    if (this.serverState.state === 'listening') {
      if (this.serverState.port !== settings.ippLastPort) {
        this.deps.updateSettings({ ippLastPort: this.serverState.port });
      }
      this.deps.log(`[ipp] sharing ${this.entries.size} papers on port ${this.serverState.port}`);
      await this.startDiscovery();
    } else {
      await this.advertiser.stop();
      this.discovery = 'off';
    }
    this.publish();
    // 首选的端口被占用时查一下是谁：界面上说清楚「被某某占用，已改用某端口」。
    const [preferred] =
      this.serverState.state === 'listening'
        ? this.serverState.skippedPorts
        : this.serverState.state === 'failed' && this.serverState.reason === 'PORT_IN_USE'
          ? this.serverState.ports
          : [];
    if (preferred !== undefined && preferred !== ANY_FREE_PORT) {
      void this.lookUpPortOwner(preferred, generation);
    }
  }

  private async startDiscovery(): Promise<void> {
    if (!this.deps.discoveryEnabled) {
      await this.advertiser.stop();
      this.discovery = 'off';
      return;
    }
    // 绑 UDP 5353 也会让 Windows 弹防火墙警告：没放行时先不绑，等操作员加规则。
    if (this.deps.holdUntilFirewallAllows && (await this.deps.firewall.checkDiscovery()) === 'missing') {
      await this.advertiser.stop();
      this.discovery = 'blocked';
      return;
    }
    this.discovery = (await this.advertiser.start()) ? 'on' : 'failed';
  }

  private async shutDown(): Promise<void> {
    await this.advertiser.stop();
    await this.server.stop();
    // 还在等确认的任务按超时中止（对方会看到任务中止）。
    this.approvals.dispose();
    this.serverState = { state: 'off' };
    this.discovery = 'off';
  }

  private async lookUpPortOwner(port: number, generation: number): Promise<void> {
    const owner = await this.deps.findPortOwner(port).catch((error: unknown) => {
      this.deps.log(`[ipp] cannot find the owner of port ${port}: ${String(error)}`);
      return null;
    });
    if (generation === this.generation && owner !== null) {
      this.portOwner = owner;
      this.publish();
    }
  }

  /** 纸张分配表里、打印机这台电脑上装着的那些纸。 */
  private async loadPrinters(): Promise<void> {
    const settings = this.deps.settings();
    const installed = new Set(await this.deps.installedPrinters());
    const instanceId = settings.ippInstanceId ?? '';
    const location = this.deps.computerName();
    const entries = new Map<string, PrinterEntry>();
    for (const [key, printerName] of Object.entries(settings.paperPrinters)) {
      const paper = parsePaperKey(key);
      if (paper === null || !installed.has(printerName)) {
        continue;
      }
      const name = formatPaperName(paper);
      entries.set(key, {
        printerName,
        printer: {
          key,
          paper,
          name,
          info: `${name}（${location} 上的热敏标签机）`,
          makeAndModel: this.deps.makeAndModel,
          deviceId: `MFG:${this.deps.productNameAscii};MDL:Label ${key};CMD:PDF,PWGRaster,URF,JPEG,PNG;CLS:PRINTER;`,
          location,
          dpi: await this.deps.dpiOf(printerName),
          uuid: printerUuid(instanceId, key),
        },
      });
    }
    this.entries = entries;
  }

  /** 共享打印机，状态（缺纸、离线、正在打印）每次实时算。 */
  private sharedPrinters(): ReadonlyMap<string, SharedPrinter> {
    const printers = new Map<string, SharedPrinter>();
    for (const [key, entry] of this.entries) {
      const active = this.book.activeFor(key);
      printers.set(key, {
        ...entry.printer,
        state: sharedPrinterState(this.deps.readinessOf(entry.printerName), active),
        queuedJobCount: active,
      });
    }
    return printers;
  }

  private dpiFor(paper: PaperSize): number {
    return this.entries.get(paperKey(paper))?.printer.dpi ?? FALLBACK_DPI;
  }

  private hostLabel(): string {
    const id = (this.deps.settings().ippInstanceId ?? '').replaceAll('-', '').slice(0, HOST_ID_CHARS);
    return `${HOST_PREFIX}${id}`;
  }

  private zoneFor(iface: LanInterface): MdnsZone {
    const host = this.hostLabel();
    const context = {
      port: this.server.port() ?? 0,
      hostName: `${host}.${MDNS_DOMAIN}`,
      computerName: this.deps.computerName(),
      productNameAscii: this.deps.productNameAscii,
      authentication: this.password.isSet() ? ('basic' as const) : ('none' as const),
      serial: this.nameSerial,
    };
    return {
      host: [host, MDNS_DOMAIN],
      address: iface.address,
      services: [...this.sharedPrinters().values()].map((printer) => ippAdvert(printer, context)),
    };
  }

  /** 别的设备在用我们的名字：实例名后面加个序号重新探测、宣告；换到 9 还冲突就不广播了。 */
  private async renameAfterConflict(names: DnsName[]): Promise<void> {
    this.deps.log(`[ipp] renaming after a conflict on ${names.map((name) => name.join('.')).join(', ')}`);
    if (this.nameSerial >= MAX_NAME_SERIAL) {
      await this.restarts.run(() => this.advertiser.stop());
      this.discovery = 'failed';
      this.publish();
      return;
    }
    this.nameSerial += 1;
    await this.restarts.run(() => this.advertiser.refresh());
  }

  private publish(): void {
    this.deps.onStatus(this.status());
  }
}
```

（`DnsName` 只在类型里用：`import type`。）

- [ ] **Step 6: 跑测试**

Run: `bun test src/shared src/main/ipp`
Expected: PASS。

- [ ] **Step 7: `bun run check` 后提交**

```bash
git add src/shared/settings.ts src/shared/settings.test.ts src/shared/ipp-sharing.ts src/main/ipp/ipp-sharing.ts src/main/ipp/ipp-sharing.test.ts
git commit -m "feat(ipp): assemble LAN sharing and follow its settings" -m "Sharing is off by default and starts only when turned on. It shares every assigned paper whose printer is installed, keeps the last good port, holds back on Windows until the firewall allows it, reports who holds a taken port, refreshes printers and announcements when assignments change, and renames itself after an mDNS conflict. Printer UUIDs and the mDNS host name come from an instance id so they survive restarts." -m "$TRAILER"
```

---

### Task 20: IPC 和接线

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `e2e/support/electron-app.ts`

- [ ] **Step 1: 写测试**（`ipc-validators.test.ts`：import 加 `requireIPv4Address`、`requireSharePassword`，`describe` 里加）

```ts
  test('LAN sharing passwords and computer addresses are checked', () => {
    expect(requireSharePassword('前台1234')).toBe('前台1234');
    expect(() => requireSharePassword('12')).toThrow('Invalid share password');
    expect(() => requireSharePassword(1234)).toThrow('Invalid share password');
    expect(requireIPv4Address('192.168.1.23')).toBe('192.168.1.23');
    expect(() => requireIPv4Address('::1')).toThrow('Invalid IPv4 address');
    expect(() => requireIPv4Address('192.168.1.256')).toThrow('Invalid IPv4 address');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL，两个校验函数没有导出。

- [ ] **Step 3: 校验函数**（`src/main/ipc-validators.ts` 末尾加；`isIP` 从 `node:net` 导入，`isValidSharePassword` 从 `../shared/ipp-sharing` 导入）

```ts
/** 共享密码：规则和界面一致（shared/ipp-sharing.ts）。错误信息里不带密码本身。 */
export function requireSharePassword(value: unknown): string {
  if (!isValidSharePassword(value)) {
    throw new Error('Invalid share password');
  }
  return value;
}

/** 局域网里一台电脑的 IPv4 地址（等确认、记住的电脑都按它）。 */
export function requireIPv4Address(value: unknown): string {
  if (typeof value !== 'string' || isIP(value) !== 4) {
    throw new Error(`Invalid IPv4 address: ${String(value).slice(0, MAX_LOGGED_VALUE_LENGTH)}`);
  }
  return value;
}
```

（文件里如果没有 `MAX_LOGGED_VALUE_LENGTH`，用现有校验函数截断日志值的同一个常量；都没有就加一个 `/** 写进错误信息的值最多 64 个字：坏值可能很长。 */ const MAX_LOGGED_VALUE_LENGTH = 64;`。）

- [ ] **Step 4: 通道和 API 类型**（`src/shared/ipc-contract.ts`）

import 加 `import type { IppSharingStatus } from './ipp-sharing';`；`IpcChannel` 的本机接口通道之后加：

```ts
  IppStatus: 'ipp:status',
  IppStatusChanged: 'ipp:status-changed',
  IppSetPassword: 'ipp:password:set',
  IppClearPassword: 'ipp:password:clear',
  IppDecideClient: 'ipp:clients:decide',
  IppForgetClient: 'ipp:clients:forget',
  IppAddFirewallRule: 'ipp:firewall:add',
```

`LabelFlashApi` 的本机接口方法之后加：

```ts
  getIppSharingStatus(): Promise<IppSharingStatus>;
  onIppSharingStatus(listener: (status: IppSharingStatus) => void): () => void;
  /** 设共享密码（原文只经过这一次，主进程只存摘要）。 */
  setSharePassword(password: string): Promise<void>;
  clearSharePassword(): Promise<void>;
  /** 操作员对等确认的电脑点了「允许」或「拒绝」。 */
  decideIppClient(address: string, allow: boolean): Promise<void>;
  /** 撤销对一台电脑的决定：它下次打印时重新问。 */
  forgetIppClient(address: string): Promise<void>;
  /** 弹管理员确认，加防火墙规则（TCP 和 UDP 5353）；返回之后查到的状态。 */
  addIppFirewallRule(): Promise<FirewallStatus>;
```

- [ ] **Step 5: 主进程处理函数**（`src/main/ipc.ts`）

`IpcDeps` 加 `ippSharing: IppSharing;`（`import type { IppSharing } from './ipp/ipp-sharing';`），validators 的 import 加 `requireIPv4Address`、`requireSharePassword`；在本机接口的处理函数之后加：

```ts
  handle(IpcChannel.IppStatus, () => deps.ippSharing.status());
  handle(IpcChannel.IppSetPassword, (password) => deps.ippSharing.setPassword(requireSharePassword(password)));
  handle(IpcChannel.IppClearPassword, () => deps.ippSharing.clearPassword());
  handle(IpcChannel.IppDecideClient, (address, allow) =>
    deps.ippSharing.decideClient(requireIPv4Address(address), requireBoolean(allow, 'allow')),
  );
  handle(IpcChannel.IppForgetClient, (address) => deps.ippSharing.forgetClient(requireIPv4Address(address)));
  handle(IpcChannel.IppAddFirewallRule, () => deps.ippSharing.addFirewallRule());
```

`logFailures` 会把出错的通道名和错误写日志：`setPassword` 抛出的只有「Invalid share password」，不含密码。

- [ ] **Step 6: preload**（`src/preload/index.ts` 的 `api` 对象末尾加）

```ts
  getIppSharingStatus: () => ipcRenderer.invoke(IpcChannel.IppStatus),
  onIppSharingStatus: (listener) => subscribe(IpcChannel.IppStatusChanged, listener),
  setSharePassword: (password) => ipcRenderer.invoke(IpcChannel.IppSetPassword, password),
  clearSharePassword: () => ipcRenderer.invoke(IpcChannel.IppClearPassword),
  decideIppClient: (address, allow) => ipcRenderer.invoke(IpcChannel.IppDecideClient, address, allow),
  forgetIppClient: (address) => ipcRenderer.invoke(IpcChannel.IppForgetClient, address),
  addIppFirewallRule: () => ipcRenderer.invoke(IpcChannel.IppAddFirewallRule),
```

- [ ] **Step 7: 接线**（`src/main/index.ts`）

import 加（按 Biome 的顺序放；`hostname` 并进已有的 `node:os` import）：

```ts
import { lanIPv4Interfaces } from './api/network';
import { addFirewallRule, discoveryFirewallStatus, firewallStatus } from './firewall';
import type { PendingClient } from './ipp/client-approvals';
import { IppSharing, ippCandidatePorts, isDiscoveryEnabled } from './ipp/ipp-sharing';
import { SqliteIppStore } from './storage/sqlite-ipp-store';
```

常量区加：

```ts
/** 共享打印机的型号（printer-make-and-model、Bonjour 的 ty）：对方的「打印机」列表里显示它。 */
const IPP_MAKE_AND_MODEL = `${BRAND.productName} 共享热敏标签机`;
```

`notifyOriginRequest` 之后加：

```ts
/**
 * 局域网里一台新电脑要打印：发系统通知，点通知回到主窗口。「允许 / 拒绝」在程序顶部用鼠标点，
 * 不弹模态框（理由同 notifyOriginRequest）。
 */
function notifyIppClientRequest(client: PendingClient): void {
  if (!Notification.isSupported()) {
    return;
  }
  const notification = new Notification({
    title: '局域网里的电脑想用共享打印机',
    body: `${client.address}${client.user === '' ? '' : `（${client.user}）`} 要打印到「${client.printerName}」。请在程序顶部点「允许」或「拒绝」。`,
  });
  notification.on('click', showMainWindow);
  notification.show();
}
```

`LocalApi` 的 `firewall.add` 改为（本机接口那边加了规则，共享也要知道；`ippSharing` 在后面创建，调用时已经有了）：

```ts
      add: async () => {
        const result = await addFirewallRule(app.getPath('exe'));
        void ippSharing.firewallChanged();
        return result;
      },
```

在 PDF 打印的 `PdfStation` 之后加：

```ts
  // 局域网共享：IPP 专用一个渲染窗口（和「打印 PDF」页互不干扰），收到的 PDF、图片只在它里面解析。
  const ippRenderer = new PdfRenderHost({
    openPort: () => openRenderWindow(join(__dirname, '../renderer')),
    openTimeoutMs: PDF_OPEN_TIMEOUT_MS,
    pageTimeoutMs: PDF_PAGE_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const ippSharing = new IppSharing({
    clock: systemClock,
    settings: () => settings.current,
    updateSettings: (patch) => settings.update(patch),
    store: new SqliteIppStore(database),
    // macOS 的 hostname 带 .local：去掉，实例名里只要电脑名。
    computerName: () => hostname().replace(/\.local$/i, ''),
    productNameAscii: BRAND.productNameAscii,
    makeAndModel: IPP_MAKE_AND_MODEL,
    installedPrinters: () => adapter.knownPrinterNames(),
    readinessOf: (name) => status.get(name),
    dpiOf: (name) => profiles.dpiOf(name),
    firewall: {
      check: () => firewallStatus(app.getPath('exe')),
      checkDiscovery: () => discoveryFirewallStatus(app.getPath('exe')),
      add: async () => {
        const result = await addFirewallRule(app.getPath('exe'));
        await localApi.checkFirewall();
        return result;
      },
    },
    holdUntilFirewallAllows: app.isPackaged,
    candidatePorts: ippCandidatePorts(process.env, app.isPackaged),
    discoveryEnabled: isDiscoveryEnabled(process.env, app.isPackaged),
    lanInterfaces: () => lanIPv4Interfaces(networkInterfaces()),
    render: { renderer: ippRenderer, pieces: pdfCache, printFields: (input) => service.printFields(input) },
    findPortOwner,
    notifyClientRequest: notifyIppClientRequest,
    onStatus: (sharingStatus) => sendToMainWindow(IpcChannel.IppStatusChanged, sharingStatus),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.info(line),
  });
```

其余几处：

1. `registerIpc({` 的参数里加 `ippSharing,`。
2. `onSettingsChanged` 的末尾（`await localApi.settingsChanged(next, previous);` 之后）加 `await ippSharing.settingsChanged(next, previous);`。
3. `localApi.start()` 那一行之后加（同样要等主窗口建好：读打印机列表要用它）：

```ts
  ippSharing.start().catch((error: unknown) => console.error('[ipp] LAN sharing failed to start', error));
```

4. `backgroundUpdateTimer` 里的 `pendingPrints` 末尾加 ` + ippSharing.pendingJobs`（注释补一句「局域网共享还有没打完的任务时也不静默更新」）。
5. `will-quit` 里 `void localApi.stop();` 之后加 `void ippSharing.stop();` 和 `ippRenderer.close();`。
6. `status`（打印机状态检测）每轮结束时如果有回调钩子（`onChange` 之类）可以接 `void ippSharing.refresh()`；没有就不接——共享打印机的状态每次请求时实时读，不需要推。

`e2e/support/electron-app.ts`：`env[API_PORT_ENV] = '0';` 之后加：

```ts
  // 局域网共享同样用系统随便给的端口，并且不往局域网广播（并行的用例、CI 机器上不发 mDNS）。
  env[IPP_PORT_ENV] = '0';
  env[IPP_DISCOVERY_ENV] = '0';
```

（import 加 `import { IPP_DISCOVERY_ENV, IPP_PORT_ENV } from '../../src/main/ipp/ipp-sharing';`，和 `API_PORT_ENV` 的 import 写法一致。）

- [ ] **Step 8: 构建、检查、手动试一次**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（共享默认关，不影响已有用例）。

再 `bun run dev`，在主窗口的开发者工具里：

```js
await window.api.updateSettings({ ippSharingEnabled: true });
await window.api.getIppSharingStatus();
```

应看到 `server.state` 为 `listening`、端口 8631（或跳过的端口）、`printers` 是分配了打印机的纸张；浏览器打开 `http://127.0.0.1:8631/printers/<纸张键>` 能看到说明页。日志里有 `[ipp] sharing N papers on port 8631`。

- [ ] **Step 9: 提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts e2e/support/electron-app.ts
git commit -m "feat(ipp): wire LAN sharing to IPC, the render window and app lifecycle" -m "LAN sharing gets its own render window and the PDF piece cache, starts after the main window like the local API, stops on quit and keeps silent updates waiting while jobs are open. Both firewall buttons refresh both services. New ipp channels expose only status, the share password, approvals and the firewall button, with every argument validated." -m "$TRAILER"
```

---

### Task 21: 界面的纯逻辑

**Files:**
- Create: `src/renderer/src/lib/ipp-sharing-text.ts`、`src/renderer/src/lib/ipp-sharing-text.test.ts`
- Modify: `src/renderer/src/lib/app-view.ts`、`src/renderer/src/lib/app-view.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/ipp-sharing-text.test.ts
import { describe, expect, test } from 'bun:test';
import type { IppSharingStatus } from '../../../shared/ipp-sharing';
import {
  describeClientRequest,
  describeDiscovery,
  describeRememberedClient,
  describeSharingStatus,
  printerAddresses,
} from './ipp-sharing-text';

const LISTENING: IppSharingStatus = {
  server: { state: 'listening', port: 8631, skippedPorts: [] },
  discovery: 'on',
  hostName: 'labelflash-1a2b3c4d.local',
  lanAddresses: ['192.168.1.10'],
  printers: [{ key: '60x40', name: '60×40 标签', printerName: '标签机A' }],
  portOwner: null,
  firewall: 'allowed',
  passwordSet: false,
  pendingClients: [],
  clients: [],
  activeJobs: 0,
};

describe('describeSharingStatus', () => {
  test('says off, sharing, or what is missing', () => {
    expect(describeSharingStatus(LISTENING, false)).toMatchObject({ tone: 'idle', title: '没有开' });
    expect(describeSharingStatus(LISTENING, true)).toMatchObject({ tone: 'success', title: '正在共享' });
    expect(describeSharingStatus({ ...LISTENING, printers: [] }, true)).toMatchObject({ tone: 'warning', title: '没有可共享的纸张' });
    expect(describeSharingStatus({ ...LISTENING, server: { state: 'held' } }, true)).toMatchObject({ tone: 'warning', title: '等防火墙放行' });
  });

  test('explains a moved port and who took the old one', () => {
    const moved = { ...LISTENING, server: { state: 'listening' as const, port: 8632, skippedPorts: [8631] }, portOwner: 'cupsd' };
    const view = describeSharingStatus(moved, true);
    expect(view.title).toBe('正在共享（已自动换端口）');
    expect(view.detail).toContain('端口 8631 被别的程序（cupsd）占用，已改用 8632');
  });

  test('explains a failure', () => {
    expect(describeSharingStatus({ ...LISTENING, server: { state: 'failed', reason: 'PORT_IN_USE', ports: [8631, 0] } }, true).tone).toBe('error');
    expect(describeSharingStatus({ ...LISTENING, server: { state: 'failed', reason: 'START_ERROR' } }, true).detail).toContain('日志');
  });
});

describe('printerAddresses', () => {
  test('gives the http address Windows takes and the ipp address for other systems', () => {
    expect(printerAddresses(LISTENING, '60x40')).toEqual({
      windows: ['http://192.168.1.10:8631/printers/60x40'],
      ipp: ['ipp://192.168.1.10:8631/printers/60x40'],
    });
    expect(printerAddresses({ ...LISTENING, server: { state: 'off' } }, '60x40')).toEqual({ windows: [], ipp: [] });
  });
});

describe('describeDiscovery', () => {
  test('says whether other computers can find the printers by themselves', () => {
    expect(describeDiscovery(LISTENING)).toContain('自动发现');
    expect(describeDiscovery({ ...LISTENING, discovery: 'blocked' })).toContain('UDP 5353');
    expect(describeDiscovery({ ...LISTENING, server: { state: 'off' }, discovery: 'off' })).toBeNull();
  });
});

describe('client texts', () => {
  test('describe a waiting computer and a remembered one', () => {
    expect(describeClientRequest({ address: '192.168.1.23', user: 'zhang', printerName: '60×40 标签', jobs: 2 })).toBe(
      '用户 zhang 要打印到「60×40 标签」（2 个任务在等）。不认识这台电脑就点「拒绝」。',
    );
    expect(describeClientRequest({ address: '192.168.1.23', user: '', printerName: '60×40 标签', jobs: 1 })).toBe(
      '要打印到「60×40 标签」。不认识这台电脑就点「拒绝」。',
    );
    expect(describeRememberedClient({ address: '192.168.1.23', decision: 'deny', lastUser: 'zhang', decidedAt: 0 })).toContain('已拒绝');
  });
});
```

`app-view.test.ts` 加：

```ts
  test('lists LAN sharing after the local API', () => {
    expect(pageLabel('sharing')).toBe('局域网共享');
    expect(CONFIG_PAGES.indexOf('sharing')).toBe(CONFIG_PAGES.indexOf('localApi') + 1);
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/ipp-sharing-text.test.ts src/renderer/src/lib/app-view.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/renderer/src/lib/app-view.ts`：`CONFIG_PAGES` 里 `'localApi'` 之后加 `'sharing'`；`CONFIG_NAV` 的「集成」组里 `{ page: 'localApi', label: '本机接口' }` 之后加 `{ page: 'sharing', label: '局域网共享' },`。

```ts
// src/renderer/src/lib/ipp-sharing-text.ts
import type {
  IppSharingStatus,
  PendingClientView,
  RememberedClientView,
} from '../../../shared/ipp-sharing';
import { formatDateTime, type StatusTone } from './status-text';

/** 0 是「由系统分配」，不是一个被占用的端口。 */
const ANY_FREE_PORT = 0;

export interface SharingStatusView {
  tone: StatusTone;
  title: string;
  detail: string;
}

function ownerText(owner: string | null): string {
  return owner === null ? '' : `（${owner}）`;
}

/** 「局域网共享」页顶部的状态。 */
export function describeSharingStatus(status: IppSharingStatus, enabled: boolean): SharingStatusView {
  if (!enabled) {
    return {
      tone: 'idle',
      title: '没有开',
      detail: '打开后，局域网里的电脑可以把这台电脑上的热敏标签机添加为打印机，从任何程序打印（PDF、图片、Word……）。',
    };
  }
  const { server } = status;
  switch (server.state) {
    case 'off':
      return { tone: 'pending', title: '正在启动…', detail: '' };
    case 'held':
      return {
        tone: 'warning',
        title: '等防火墙放行',
        detail: 'Windows 防火墙还没有放行本程序：点下面的「添加防火墙规则」（需要管理员确认）后开始共享。',
      };
    case 'listening': {
      if (status.printers.length === 0) {
        return {
          tone: 'warning',
          title: '没有可共享的纸张',
          detail: '先在「打印机」页给纸张分配打印机：每种分配了打印机的纸张就是一台共享打印机。',
        };
      }
      const scope = '传输是明文 HTTP，只在可信的局域网里使用。';
      if (server.skippedPorts.length > 0) {
        return {
          tone: 'warning',
          title: '正在共享（已自动换端口）',
          detail: `端口 ${server.skippedPorts.join('、')} 被别的程序${ownerText(status.portOwner)}占用，已改用 ${server.port}。按旧地址添加过的电脑要重新添加。${scope}`,
        };
      }
      return { tone: 'success', title: '正在共享', detail: `局域网里的电脑可以添加下面的打印机。${scope}` };
    }
    case 'failed': {
      if (server.reason === 'START_ERROR') {
        return {
          tone: 'error',
          title: '没有运行',
          detail: '共享启动出错，详情已写入日志（配置中心「通用」页可以打开日志文件夹）。',
        };
      }
      const taken = server.ports.filter((port) => port !== ANY_FREE_PORT);
      return {
        tone: 'error',
        title: '端口被占用',
        detail: `端口 ${taken.join('、')} 被别的程序${ownerText(status.portOwner)}占用了：可以在下面换一个端口，或重启电脑后再试。`,
      };
    }
  }
}

/** 一台共享打印机的地址：Windows「按名称选择共享打印机」要 http://，其他系统、手动填写用 ipp://。没在共享时为空。 */
export function printerAddresses(status: IppSharingStatus, key: string): { windows: string[]; ipp: string[] } {
  if (status.server.state !== 'listening') {
    return { windows: [], ipp: [] };
  }
  const { port } = status.server;
  return {
    windows: status.lanAddresses.map((address) => `http://${address}:${port}/printers/${key}`),
    ipp: status.lanAddresses.map((address) => `ipp://${address}:${port}/printers/${key}`),
  };
}

/** 自动发现（mDNS）的说明；没在共享时为 null。 */
export function describeDiscovery(status: IppSharingStatus): string | null {
  if (status.server.state !== 'listening') {
    return null;
  }
  switch (status.discovery) {
    case 'on':
      return '已在局域网里广播：macOS、iPhone 和较新的 Windows 会自动发现这些打印机。';
    case 'off':
      return '没有广播：别的电脑只能按地址添加。';
    case 'blocked':
      return 'Windows 防火墙还没放行自动发现（UDP 5353）：点「添加防火墙规则」后别的电脑才能自动找到；按地址添加不受影响。';
    case 'failed':
      return '自动发现没能开启（端口 5353 被占用，或局域网里重名太多）：按地址添加不受影响，详情见日志。';
  }
}

/** 询问条上的说明（电脑地址另起一行用等宽字体显示）。 */
export function describeClientRequest(client: PendingClientView): string {
  const who = client.user === '' ? '' : `用户 ${client.user} `;
  const waiting = client.jobs > 1 ? `（${client.jobs} 个任务在等）` : '';
  return `${who}要打印到「${client.printerName}」${waiting}。不认识这台电脑就点「拒绝」。`;
}

/** 共享页里记住的一台电脑。 */
export function describeRememberedClient(client: RememberedClientView): string {
  const decision = client.decision === 'allow' ? '已允许' : '已拒绝';
  const user = client.lastUser === '' ? '' : `，用户 ${client.lastUser}`;
  return `${decision}${user}，${formatDateTime(client.decidedAt)}`;
}
```

（`formatDateTime` 是 `status-text.ts` 里已有的导出（本机接口页在用）。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib`
Expected: PASS。`ConfigPages.tsx` 的 `switch` 少了 `'sharing'` 分支，类型检查要到 Task 22 才过：这一步先只跑单元测试，**和 Task 22 一起提交**（一个提交必须能过 `bun run check`）。

---

### Task 22: 「局域网共享」页和询问条

页面（配置中心「集成」组，「本机接口」下面）自上而下：

1. **状态**卡：开关「局域网共享」；状态（正在共享 / 没有开 / 等防火墙放行 / 端口被占用……）；防火墙一行（没放行时「添加防火墙规则（需要管理员确认）」按钮，TCP 或 UDP 5353 有一条没放行都显示）；自动发现一行；端口输入框和「恢复默认」（和本机接口同一个写法）。
2. **共享的打印机**卡：每种纸一行：名字、实际的打印机；下面两组地址（等宽、可选中）：「Windows 添加时填」`http://…`、「其他系统」`ipp://…`；底部一段怎么添加的说明（Windows：设置 → 蓝牙和其他设备 → 打印机和扫描仪 → 添加设备 → 「我需要的打印机不在列表中」→「按名称选择共享打印机」→ 填 http:// 地址 → 驱动选「Microsoft IPP Class Driver」；macOS：系统设置 → 打印机与扫描仪 → 添加打印机 → 在列表里选「60×40 标签 @ 电脑名」，「使用」选 AirPrint）。
3. **共享密码**卡：状态（已设置 / 没有设置）；密码输入框（`type="password"`，4–64 个字）、「保存密码」、「不用密码」（`ConfirmButton`）；说明「设了密码后，别的电脑添加打印机或打印时要输入它（用户名随便填）。明文 HTTP 上的密码在局域网里能被抓包看到：它挡住随手添加，不防有心人。」
4. **电脑**卡：记住的电脑（地址等宽、`describeRememberedClient`、「撤销」`ConfirmButton`）；空的时候说明「新电脑第一次打印时，程序顶部会出现询问，同时弹出系统通知；点过「允许」或「拒绝」的电脑列在这里，撤销后它下次打印时重新问。」

**询问条**：本机接口的网站询问条抽成通用的 `RequestList`（一组「主体 + 说明 + 拒绝 / 允许」）；程序顶部一个固定位置的容器 `.request-bar` 里先放网站、再放电脑，两组各自是一个带名字的区域（「等待确认的网站」不变，E2E 照旧找得到；新的是「等待确认的电脑」）。按钮照旧不进 Tab 顺序（`tabIndex=-1`）：扫码枪敲的 Tab、回车不能落到「允许」上。

**Files:**
- Create: `src/renderer/src/view-models/use-ipp-sharing.ts`
- Create: `src/renderer/src/components/RequestList.tsx`、`src/renderer/src/components/IppClientRequests.tsx`
- Modify: `src/renderer/src/components/OriginRequests.tsx`
- Create: `src/renderer/src/components/config/pages/SharingPage.tsx`
- Modify: `src/renderer/src/components/config/ConfigPages.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 视图模型**

```ts
// src/renderer/src/view-models/use-ipp-sharing.ts
import { useCallback, useEffect, useState } from 'react';
import type { IppSharingStatus } from '../../../shared/ipp-sharing';
import { reportError } from '../lib/notices';

export interface IppSharingModel {
  /** 还没读到时为 null。 */
  status: IppSharingStatus | null;
  /** 返回是否保存了。 */
  setPassword: (password: string) => Promise<boolean>;
  clearPassword: () => Promise<void>;
  decideClient: (address: string, allow: boolean) => Promise<void>;
  forgetClient: (address: string) => Promise<void>;
  /** 正在等操作员在管理员确认框里点选。 */
  isAddingFirewall: boolean;
  addFirewall: () => Promise<void>;
}

/** 局域网共享：状态跟随主进程推送（等确认的电脑、记住的电脑都在里面）；操作经 window.api。 */
export function useIppSharing(): IppSharingModel {
  const [status, setStatus] = useState<IppSharingStatus | null>(null);
  const [isAddingFirewall, setIsAddingFirewall] = useState(false);

  useEffect(() => {
    let isActive = true;
    window.api.getIppSharingStatus().then(
      (current) => {
        if (isActive) {
          setStatus(current);
        }
      },
      (error: unknown) => reportError('读取局域网共享状态', error),
    );
    const unsubscribe = window.api.onIppSharingStatus(setStatus);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const setPassword = useCallback(async (password: string) => {
    try {
      await window.api.setSharePassword(password);
      return true;
    } catch (error) {
      reportError('保存共享密码', error);
      return false;
    }
  }, []);

  const clearPassword = useCallback(async () => {
    try {
      await window.api.clearSharePassword();
    } catch (error) {
      reportError('取消共享密码', error);
    }
  }, []);

  const decideClient = useCallback(async (address: string, allow: boolean) => {
    try {
      await window.api.decideIppClient(address, allow);
    } catch (error) {
      reportError(allow ? '允许电脑' : '拒绝电脑', error);
    }
  }, []);

  const forgetClient = useCallback(async (address: string) => {
    try {
      await window.api.forgetIppClient(address);
    } catch (error) {
      reportError('撤销电脑的决定', error);
    }
  }, []);

  const addFirewall = useCallback(async () => {
    setIsAddingFirewall(true);
    try {
      await window.api.addIppFirewallRule();
    } catch (error) {
      reportError('添加防火墙规则', error);
    } finally {
      setIsAddingFirewall(false);
    }
  }, []);

  return { status, setPassword, clearPassword, decideClient, forgetClient, isAddingFirewall, addFirewall };
}
```

- [ ] **Step 2: 通用的询问列表，网站和电脑两组**

```tsx
// src/renderer/src/components/RequestList.tsx
export interface RequestItem {
  /** 唯一键，也是回调里交回的值（网站、电脑地址）。 */
  key: string;
  /** 等宽字体单独一行：一眼看清是哪个网站、哪台电脑。 */
  subject: string;
  text: string;
}

interface RequestListProps {
  /** 区域的名字（读屏、E2E 按它找）。 */
  label: string;
  items: readonly RequestItem[];
  onDecide: (key: string, allow: boolean) => void;
}

/**
 * 程序顶部请操作员用鼠标点「允许」或「拒绝」的一组请求（网站想用本机接口、局域网里的电脑想用共享打印机）。
 * 两个按钮都不进 Tab 顺序（tabIndex=-1）：扫码枪敲的 Tab、回车不能把焦点带到「允许」上再按下去。
 * 不标 data-keep-focus：点完之后焦点照常回到扫码框。
 */
export function RequestList({ label, items, onDecide }: RequestListProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="request-list" aria-label={label}>
      {items.map((item) => (
        <div key={item.key} className="request">
          <p className="request__text">
            <strong className="request__subject">{item.subject}</strong>
            {item.text}
          </p>
          <div className="request__actions">
            <button type="button" tabIndex={-1} className="button button--small" onClick={() => onDecide(item.key, false)}>
              拒绝
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="button button--small button--primary"
              onClick={() => onDecide(item.key, true)}
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

`src/renderer/src/components/OriginRequests.tsx` 整个换成：

```tsx
import { RequestList } from './RequestList';

interface OriginRequestsProps {
  /** 正在等确认的网站，先来的在前。 */
  origins: readonly string[];
  onDecide: (origin: string, allow: boolean) => void;
}

/** 网站想使用本机接口：程序顶部请操作员点「允许」或「拒绝」。 */
export function OriginRequests({ origins, onDecide }: OriginRequestsProps) {
  return (
    <RequestList
      label="等待确认的网站"
      items={origins.map((origin) => ({
        key: origin,
        subject: origin,
        text: '想使用这台电脑的打印服务：提交打印、读取模板和打印机列表。不认识这个网站就点「拒绝」。',
      }))}
      onDecide={onDecide}
    />
  );
}
```

```tsx
// src/renderer/src/components/IppClientRequests.tsx
import type { PendingClientView } from '../../../shared/ipp-sharing';
import { describeClientRequest } from '../lib/ipp-sharing-text';
import { RequestList } from './RequestList';

interface IppClientRequestsProps {
  clients: readonly PendingClientView[];
  onDecide: (address: string, allow: boolean) => void;
}

/** 局域网里的新电脑第一次打印：程序顶部请操作员点「允许」或「拒绝」（2 分钟没人点就作废）。 */
export function IppClientRequests({ clients, onDecide }: IppClientRequestsProps) {
  return (
    <RequestList
      label="等待确认的电脑"
      items={clients.map((client) => ({
        key: client.address,
        subject: `局域网里的电脑 ${client.address}`,
        text: describeClientRequest(client),
      }))}
      onDecide={onDecide}
    />
  );
}
```

`src/renderer/src/styles/app.css`：把「网站授权请求」那一段（`.origin-requests` 到 `.origin-request__actions`）换成：

```css
/* ── 等待确认的请求（网站、局域网里的电脑）：程序顶部，只能用鼠标点 ── */
.request-bar {
  position: fixed;
  z-index: var(--layer-notice);
  top: calc(var(--title-bar-height) + var(--space-2));
  left: 50%;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(560px, calc(100% - var(--space-5) * 2));
  transform: translateX(-50%);
}

.request-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.request {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-left: 4px solid var(--color-warning);
  border-radius: var(--radius);
  background: var(--color-paper);
  box-shadow: 0 6px 20px rgb(24 33 30 / 0.18);
  font-size: 13px;
}

.request__text {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

/* 网站、电脑地址单独一行、用等宽字体：一眼看清是哪个，不被「127.0.0.1.某某.com」这种名字骗到 */
.request__subject {
  display: block;
  font-family: var(--font-data);
}

.request__actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
}
```

（用 Grep 在 `src/renderer`、`e2e` 里确认没有别处再用 `origin-request` 这几个类名；有的话一起换成新类名。）

- [ ] **Step 3: 共享页**

```tsx
// src/renderer/src/components/config/pages/SharingPage.tsx
import { useEffect, useId, useState } from 'react';
import { DEFAULT_IPP_PORT, SHARE_PASSWORD_LENGTH, isValidSharePassword } from '../../../../../shared/ipp-sharing';
import { API_PORT_RANGE } from '../../../../../shared/settings';
import { describeFirewall } from '../../../lib/local-api-text';
import {
  describeDiscovery,
  describeRememberedClient,
  describeSharingStatus,
  printerAddresses,
} from '../../../lib/ipp-sharing-text';
import type { IppSharingModel } from '../../../view-models/use-ipp-sharing';
import { ConfirmButton } from '../../ConfirmButton';
import { Switch } from '../../form-controls';
import { SettingRow } from '../SettingRow';

/** 端口怎么选：和主进程的 portOrder 一致。 */
const PORT_HINT = `一般不用填：程序一直用上次成功的端口；它被占用时依次试 ${DEFAULT_IPP_PORT}–${DEFAULT_IPP_PORT + 9}，都被占用时由系统分配。换了端口，按地址添加过的电脑要重新添加。`;
const ADD_HELP_WINDOWS =
  'Windows：设置 → 蓝牙和其他设备 → 打印机和扫描仪 → 添加设备 →「我需要的打印机不在列表中」→「按名称选择共享打印机」，填上面的 http:// 地址，驱动选「Microsoft IPP Class Driver」。';
const ADD_HELP_MAC = 'macOS：系统设置 → 打印机与扫描仪 → 添加打印机，在列表里选「纸张名 @ 这台电脑的名字」，「使用」选 AirPrint。';

export interface SharingPageProps {
  sharing: IppSharingModel;
  enabled: boolean;
  port: number | null;
  onChangeEnabled: (enabled: boolean) => void;
  /** 返回是否已保存。 */
  onChangePort: (port: number | null) => Promise<boolean>;
}

/** 局域网共享：开关和状态、共享的打印机和地址、共享密码、记住的电脑。 */
export function SharingPage(props: SharingPageProps) {
  const { sharing, enabled } = props;
  const status = sharing.status;
  return (
    <div className="config-page">
      <p className="config-page__intro">
        局域网里的电脑可以把这台电脑上的热敏标签机当成普通打印机用：每种分配了打印机的纸张是一台共享打印机，从任何程序打印的内容都按这张纸缩放、转黑白后打出来。
      </p>
      <StatusCard {...props} />
      {enabled && status !== null && status.server.state === 'listening' && <PrintersCard sharing={sharing} />}
      <PasswordCard sharing={sharing} />
      <ClientsCard sharing={sharing} />
      <p className="config-page__intro">
        收到的每一张都记进打印记录（来源「局域网共享」，记下对方电脑的地址和它报的用户名），7 天内能预览、重打。
      </p>
    </div>
  );
}

function StatusCard({ sharing, enabled, port, onChangeEnabled, onChangePort }: SharingPageProps) {
  const portId = useId();
  const [draft, setDraft] = useState(port === null ? '' : String(port));
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    setDraft(port === null ? '' : String(port));
    setIssue(null);
  }, [port]);

  const commit = async () => {
    const text = draft.trim();
    if (text === (port === null ? '' : String(port))) {
      setIssue(null);
      return;
    }
    const next = text === '' ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < API_PORT_RANGE.min || next > API_PORT_RANGE.max)) {
      setIssue(`端口要是 ${API_PORT_RANGE.min}–${API_PORT_RANGE.max} 的整数。`);
      return;
    }
    setIssue(null);
    await onChangePort(next);
  };

  const status = sharing.status;
  const view = status === null ? null : describeSharingStatus(status, enabled);
  const discovery = status === null ? null : describeDiscovery(status);
  const needsFirewall =
    status !== null && (status.server.state === 'held' || status.discovery === 'blocked' || status.firewall === 'missing');
  const firewall = status === null ? null : describeFirewall(needsFirewall ? 'missing' : status.firewall, status.server.state === 'held');
  return (
    <section className="config-card" aria-label="共享状态">
      <SettingRow label="局域网共享" hint="打开后才监听网络、在局域网里广播；关掉后别的电脑就连不上了。">
        <Switch isBare ariaLabel="局域网共享" checked={enabled} text={enabled ? '开启' : '关闭'} onChange={onChangeEnabled} />
      </SettingRow>
      <SettingRow label="状态" hint={view?.detail}>
        <strong className={`api-status tone--${view?.tone ?? 'idle'}`} role="status">
          {view?.title ?? '读取中…'}
        </strong>
      </SettingRow>
      {enabled && firewall !== null && (
        <SettingRow label="防火墙" hint={firewall.text}>
          {firewall.canAdd ? (
            <button
              type="button"
              className="button button--small"
              disabled={sharing.isAddingFirewall}
              onClick={() => void sharing.addFirewall()}
            >
              {sharing.isAddingFirewall ? '等待管理员确认…' : '添加防火墙规则（需要管理员确认）'}
            </button>
          ) : (
            <strong className="api-status tone--success">已放行</strong>
          )}
        </SettingRow>
      )}
      {enabled && discovery !== null && (
        <SettingRow label="自动发现">
          <span className="config-card__text">{discovery}</span>
        </SettingRow>
      )}
      <SettingRow label="端口" htmlFor={portId} hint={PORT_HINT}>
        <input
          id={portId}
          type="text"
          inputMode="numeric"
          className="text-field text-field--number"
          placeholder={String(DEFAULT_IPP_PORT)}
          value={draft}
          aria-invalid={issue !== null}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <button type="button" className="button button--small" disabled={port === null} onClick={() => void onChangePort(null)}>
          恢复默认
        </button>
      </SettingRow>
      {issue && (
        <p className="setting-row__issue" role="alert">
          {issue}
        </p>
      )}
    </section>
  );
}

function PrintersCard({ sharing }: { sharing: IppSharingModel }) {
  const titleId = useId();
  const status = sharing.status;
  if (status === null) {
    return null;
  }
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        共享的打印机
      </h2>
      {status.printers.length === 0 ? (
        <p className="config-empty">还没有分配了打印机的纸张：在「打印机」页给纸张分配打印机后，它就出现在这里。</p>
      ) : (
        <ul className="config-list">
          {status.printers.map((printer) => {
            const addresses = printerAddresses(status, printer.key);
            return (
              <li key={printer.key} className="config-card sharing-printer">
                <strong className="sharing-printer__name">{printer.name}</strong>
                <span className="sharing-printer__target">打到 {printer.printerName}</span>
                <span className="sharing-printer__label">Windows 添加时填</span>
                <ul className="api-addresses">
                  {addresses.windows.map((address) => (
                    <li key={address}>
                      <code className="api-address">{address}</code>
                    </li>
                  ))}
                </ul>
                <span className="sharing-printer__label">其他系统</span>
                <ul className="api-addresses">
                  {addresses.ipp.map((address) => (
                    <li key={address}>
                      <code className="api-address">{address}</code>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      <p className="config-card__text">{ADD_HELP_WINDOWS}</p>
      <p className="config-card__text">{ADD_HELP_MAC}</p>
    </section>
  );
}

function PasswordCard({ sharing }: { sharing: IppSharingModel }) {
  const titleId = useId();
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSet = sharing.status?.passwordSet ?? false;
  const canSave = isValidSharePassword(draft) && !isSaving;

  const save = async () => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    try {
      if (await sharing.setPassword(draft)) {
        setDraft('');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        共享密码
      </h2>
      <p className="config-card__text">
        {isSet ? '已设置。' : '没有设置：局域网里的电脑不用密码就能添加、打印（新电脑第一次打印时仍会先问你）。'}
        设了密码后，别的电脑添加打印机或打印时要输入它（用户名随便填）。传输是明文 HTTP，密码在局域网里能被抓包看到：它挡住随手添加，不防有心人。
      </p>
      <div className="api-key-form">
        <label className="api-key-form__label" htmlFor={inputId}>
          {isSet ? '新密码' : '密码'}
        </label>
        <input
          id={inputId}
          type="password"
          className="text-field"
          autoComplete="new-password"
          placeholder={`${SHARE_PASSWORD_LENGTH.min}–${SHARE_PASSWORD_LENGTH.max} 个字`}
          maxLength={SHARE_PASSWORD_LENGTH.max}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void save();
            }
          }}
        />
        <button type="button" className="button button--primary" disabled={!canSave} onClick={() => void save()}>
          {isSaving ? '保存中…' : '保存密码'}
        </button>
      </div>
      {isSet && (
        <ConfirmButton
          className="button button--small button--quiet"
          label="不用密码"
          confirmLabel="确认不用密码"
          onConfirm={() => void sharing.clearPassword()}
        />
      )}
    </section>
  );
}

function ClientsCard({ sharing }: { sharing: IppSharingModel }) {
  const titleId = useId();
  const clients = sharing.status?.clients ?? [];
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        电脑
      </h2>
      {clients.length === 0 ? (
        <p className="config-empty">
          新电脑第一次打印时，程序顶部会出现询问，同时弹出系统通知；点过「允许」或「拒绝」的电脑列在这里，撤销后它下次打印时重新问。
        </p>
      ) : (
        <ul className="config-list">
          {clients.map((client) => (
            <li key={client.address} className="config-card api-key-card">
              <div className="api-key-card__text">
                <code className="api-address">{client.address}</code>
                <span className="api-key-card__usage">{describeRememberedClient(client)}</span>
              </div>
              <ConfirmButton
                className="button button--small button--quiet"
                label="撤销"
                confirmLabel="确认撤销"
                onConfirm={() => void sharing.forgetClient(client.address)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`app.css` 在本机接口那几段之后加：

```css
/* 局域网共享页：每种纸一张小卡，名字、打到哪台、两组地址自上而下 */
.sharing-printer {
  display: grid;
  gap: var(--space-1);
}

.sharing-printer__name {
  font-weight: 600;
}

.sharing-printer__target,
.sharing-printer__label {
  color: var(--color-ink-soft);
  font-size: 12px;
}
```

- [ ] **Step 4: 接到配置中心和 App**

`src/renderer/src/components/config/ConfigPages.tsx`：import 加 `SharingPage` 和 `type IppSharingModel`；`ConfigPagesProps` 加 `sharing: IppSharingModel;`，解构里加 `sharing`；`switch` 里 `'localApi'` 之后加：

```tsx
    case 'sharing':
      return (
        <SharingPage
          sharing={sharing}
          enabled={settings.ippSharingEnabled}
          port={settings.ippPort}
          onChangeEnabled={(ippSharingEnabled) => void onChange({ ippSharingEnabled })}
          onChangePort={async (ippPort) => (await onChange({ ippPort })) !== null}
        />
      );
```

`src/renderer/src/App.tsx`：`const localApi = useLocalApi();` 之后加 `const ippSharing = useIppSharing();`；`<ConfigPages` 的参数里加 `sharing={ippSharing}`；把底部的 `<OriginRequests ... />` 换成：

```tsx
      <div className="request-bar">
        <OriginRequests
          origins={localApi.status?.pendingOrigins ?? []}
          onDecide={(origin, allow) => void localApi.decideOrigin(origin, allow)}
        />
        <IppClientRequests
          clients={ippSharing.status?.pendingClients ?? []}
          onDecide={(address, allow) => void ippSharing.decideClient(address, allow)}
        />
      </div>
```

- [ ] **Step 5: 检查、手动看一次**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（`local-api.e2e.ts` 里找「等待确认的网站」的用例照旧通过）。

`bun run dev`，打开配置中心「局域网共享」：打开开关 → 状态「正在共享」，列出分配了打印机的纸张和地址；用另一个终端发一个 Print-Job（Task 23 的 E2E 客户端，或 `ipptool`）→ 顶部出现「局域网里的电脑 127.0.0.1」的询问条，按 Tab 焦点不会落到按钮上。

- [ ] **Step 6: 提交**（连同 Task 21 的文件）

```bash
git add src/renderer/src/lib/ipp-sharing-text.ts src/renderer/src/lib/ipp-sharing-text.test.ts src/renderer/src/lib/app-view.ts src/renderer/src/lib/app-view.test.ts src/renderer/src/view-models/use-ipp-sharing.ts src/renderer/src/components/RequestList.tsx src/renderer/src/components/OriginRequests.tsx src/renderer/src/components/IppClientRequests.tsx src/renderer/src/components/config/pages/SharingPage.tsx src/renderer/src/components/config/ConfigPages.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(renderer): LAN sharing page and the computer approval bar" -m "The config center gets a LAN sharing page under the local API: the switch, status, firewall and discovery, the port, each shared paper with the addresses Windows and other systems take, the share password and remembered computers. The website ask bar becomes a generic request list, so a new computer's first print asks in the same mouse-only bar, in its own named region." -m "$TRAILER"
```

---

### Task 23: E2E

在构建好的程序上走一遍主流程（假打印机，打印只记下来）：打开共享 → 用测试里的 IPP 客户端查打印机 → 发一个 60×40 的 PDF → 顶部询问条点「允许」→ 任务完成、假打印机收到、打印记录是「局域网共享」带电脑和用户；同一台电脑再发一张 PNG 不再问；设了共享密码后不带密码被拒。

**Files:**
- Modify: `e2e/support/pdf-files.ts`
- Create: `e2e/ipp.e2e.ts`

- [ ] **Step 1: 生成一张 60×40 的 PDF**（`e2e/support/pdf-files.ts` 末尾加，照 `gridPdfBytes` 的写法）

```ts
/** 一张 60×40mm 的标签 PDF（中间一行粗体字），用被测程序自己的 printToPDF 生成。 */
export async function labelPdfBytes(app: ElectronApplication, text: string): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 60mm 40mm; margin: 0; }
body { margin: 0; }
.label { width: 60mm; height: 40mm; display: flex; align-items: center; justify-content: center; font: bold 12mm sans-serif; }
</style></head><body><div class="label">${text}</div></body></html>`;
  const base64 = await app.evaluate(async ({ BrowserWindow }, page) => {
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      return pdf.toString('base64');
    } finally {
      window.destroy();
    }
  }, html);
  return Buffer.from(base64, 'base64');
}
```

- [ ] **Step 2: 写 E2E**

```ts
// e2e/ipp.e2e.ts
import type { Page } from '@playwright/test';
import { integerAttr, integerValue, nameAttr, stringValue, stringValues } from '../src/core/ipp/ipp-attributes';
import type { IppMessage } from '../src/core/ipp/ipp-codec';
import { GROUP_TAGS, OPERATIONS, STATUS } from '../src/core/ipp/ipp-constants';
import { attributeIn, ippRequest } from '../src/core/ipp/testing/ipp-requests';
import { basicAuth, sendIpp } from '../src/main/ipp/testing/ipp-client';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints } from './support/app-helpers';
import { expect, test } from './support/fixtures';
import { labelPdfBytes } from './support/pdf-files';

/** 一台 60×40 的假标签机（打印只记下来）。 */
const PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
];
/** 任务从收下到打完：渲染一页、出块、交给假打印机，几秒内完成；CI 机器慢，给足 30 秒。 */
const JOB_TIMEOUT_MS = 30_000;

/** 给 60×40 分配打印机、打开共享，等它开始监听；返回这台共享打印机的 http 地址和 ipp 地址。 */
async function shareLabelPaper(page: Page): Promise<{ url: string; printerUri: string }> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' }, ippSharingEnabled: true });
  await expect
    .poll(async () => (await callApi(page, 'getIppSharingStatus')).server.state, { timeout: 10_000 })
    .toBe('listening');
  const { server } = await callApi(page, 'getIppSharingStatus');
  if (server.state !== 'listening') {
    throw new Error('LAN sharing is not listening');
  }
  const url = `http://127.0.0.1:${server.port}/printers/60x40`;
  return { url, printerUri: url.replace('http:', 'ipp:') };
}

function jobState(message: IppMessage | null): number | null {
  return message === null ? null : integerValue(attributeIn(message, GROUP_TAGS.job, 'job-state'));
}

async function waitForJobState(url: string, printerUri: string, jobId: number, state: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const reply = await sendIpp(url, ippRequest(OPERATIONS.getJobAttributes, { printerUri, operation: [integerAttr('job-id', jobId)] }));
        return jobState(reply.message);
      },
      { timeout: JOB_TIMEOUT_MS },
    )
    .toBe(state);
}

test('shares each paper that has a printer as a driverless IPP printer', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const { url, printerUri } = await shareLabelPaper(page);
  const reply = await sendIpp(url, ippRequest(OPERATIONS.getPrinterAttributes, { printerUri }));
  expect(reply.message?.code).toBe(STATUS.ok);
  const message = reply.message ?? ippRequest(0);
  expect(stringValue(attributeIn(message, GROUP_TAGS.printer, 'printer-name'))).toBe('60×40 标签');
  expect(stringValue(attributeIn(message, GROUP_TAGS.printer, 'media-default'))).toBe('om_label-60x40_60x40mm');
  expect(stringValues(attributeIn(message, GROUP_TAGS.printer, 'document-format-supported'))).toContain('image/pwg-raster');
  // 浏览器打开同一个地址是一页说明。
  expect(await (await fetch(url)).text()).toContain('60×40 标签');
});

test('asks before a new computer prints, then prints to the paper printer and records it', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const { url, printerUri } = await shareLabelPaper(page);
  const pdf = await labelPdfBytes(app, 'CL5640');
  const first = await sendIpp(
    url,
    ippRequest(OPERATIONS.printJob, {
      printerUri,
      operation: [nameAttr('job-name', 'e2e 标签'), nameAttr('requesting-user-name', 'e2e')],
    }),
    pdf,
  );
  expect(first.message?.code).toBe(STATUS.ok);
  expect(jobState(first.message)).toBe(4);
  const firstId = integerValue(attributeIn(first.message ?? ippRequest(0), GROUP_TAGS.job, 'job-id')) ?? 0;

  const requests = page.getByRole('region', { name: '等待确认的电脑' });
  await expect(requests).toContainText('局域网里的电脑 127.0.0.1');
  await expect(requests).toContainText('用户 e2e 要打印到「60×40 标签」');
  await requests.getByRole('button', { name: '允许' }).click();
  await expect(requests).toHaveCount(0);
  await waitForJobState(url, printerUri, firstId, 9);

  expect((await fakePrints(app)).map((print) => print.printerName)).toEqual(['标签机A']);
  const { jobs } = await callApi(page, 'listJobs', { limit: 5 });
  expect(jobs[0]).toMatchObject({
    source: 'ipp',
    status: 'printed',
    printerName: '标签机A',
    paper: '60x40',
    raw: 'e2e 标签 第 1 页第 1 张',
    ipp: { client: '127.0.0.1', user: 'e2e' },
  });

  // 同一台电脑再打（一张 PNG）：记住了允许，不再问；图片在渲染页里解码。
  const png = await page.screenshot();
  const second = await sendIpp(url, ippRequest(OPERATIONS.printJob, { printerUri }), new Uint8Array(png));
  expect(jobState(second.message)).toBe(3);
  const secondId = integerValue(attributeIn(second.message ?? ippRequest(0), GROUP_TAGS.job, 'job-id')) ?? 0;
  await waitForJobState(url, printerUri, secondId, 9);
  expect(await fakePrints(app)).toHaveLength(2);
  expect((await callApi(page, 'getIppSharingStatus')).clients).toMatchObject([{ address: '127.0.0.1', decision: 'allow' }]);
});

test('asks for the share password once it is set', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: PRINTERS });
  const { url, printerUri } = await shareLabelPaper(page);
  await callApi(page, 'setSharePassword', '前台1234');
  const pdf = await labelPdfBytes(app, 'X');
  expect((await sendIpp(url, ippRequest(OPERATIONS.printJob, { printerUri }), pdf)).httpStatus).toBe(401);
  const allowed = await sendIpp(url, ippRequest(OPERATIONS.printJob, { printerUri }), pdf, basicAuth('anyone', '前台1234'));
  expect(allowed.message?.code).toBe(STATUS.ok);
});
```

（询问条按角色和区域名定位；打印记录的显示（「局域网共享（127.0.0.1 e2e）」）由 Task 8 的 `status-text` 单元测试覆盖，这里只核对记录本身。）

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e`
Expected: 全部通过，包括新的 `ipp.e2e.ts` 三个用例。CI 的 Windows 和 macOS 上都跑（共享只监听 IPv4、不开 mDNS，不受 CI 机器网络影响）。

- [ ] **Step 4: 提交**

```bash
git add e2e/support/pdf-files.ts e2e/ipp.e2e.ts
git commit -m "test(e2e): print to a shared label printer over IPP" -m "The built app shares the 60x40 paper; an in-test IPP client reads the printer attributes, sends a PDF that waits for the operator's click in the request bar, and finds the job completed, the fake printer called and a LAN share record with the computer and user. A PNG from the same computer prints without asking, and a share password turns away jobs without it." -m "$TRAILER"
```

---

### Task 24: 视觉验收 V90–V93

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`

- [ ] **Step 1: 加验收项**

`e2e/visual/acceptance.visual.ts`：import 加 `import { nameAttr } from '../../src/core/ipp/ipp-attributes';`、`import { OPERATIONS } from '../../src/core/ipp/ipp-constants';`、`import { ippRequest, MINIMAL_PDF } from '../../src/core/ipp/testing/ipp-requests';`、`import { sendIpp } from '../../src/main/ipp/testing/ipp-client';`、`import { createServer, type Server } from 'node:net';`（已有的不重复）。在 PDF 打印的 `PDF_PRINTERS` 之后加：

```ts
/** V90–V93：两种纸各一台假打印机。 */
const SHARING_PRINTERS: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 150, dpi: 203 }, readiness: { ready: true } },
];

/** 分配两种纸、打开共享，等它开始监听；返回端口。 */
async function startSharing(page: Page, patch: Record<string, unknown> = {}): Promise<number> {
  await callApi(page, 'updateSettings', {
    paperPrinters: { '60x40': '标签机A', '100x150': '面单机B' },
    ippSharingEnabled: true,
    ...patch,
  });
  await expect
    .poll(async () => (await callApi(page, 'getIppSharingStatus')).server.state, { timeout: 10_000 })
    .toBe('listening');
  const { server } = await callApi(page, 'getIppSharingStatus');
  return server.state === 'listening' ? server.port : 0;
}

/** 占住一个端口（所有 IPv4 地址），让共享自动换到下一个。 */
async function occupyAnyPort(): Promise<{ port: number; server: Server }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the blocker has no port');
  }
  return { port: address.port, server };
}

async function openSharingPage(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await openConfig(page, '局域网共享');
}
```

`ITEMS` 里、当时最后一项之后加：

```ts
  {
    id: 'V90',
    title: '配置中心 · 局域网共享 · 没有开',
    points:
      '导航「集成」组里「本机接口」下面是「局域网共享」；页头一段说明；状态卡：开关「关闭」、状态「没有开」和说明、端口输入框（占位 8631）和灰掉的「恢复默认」，没有防火墙和自动发现两行；没有「共享的打印机」卡；共享密码卡写「没有设置」、密码框和灰掉的「保存密码」；电脑卡是空的说明；最后一段打印记录的说明',
    launch: { fakePrinters: SHARING_PRINTERS },
    setup: async ({ page }) => {
      await openSharingPage(page);
    },
  },
  {
    id: 'V91',
    title: '配置中心 · 局域网共享 · 正在共享',
    points:
      '状态「正在共享」和明文 HTTP 的提醒；自动发现一行（开发版是「没有广播」）；共享的打印机两张小卡：「60×40 标签」打到标签机A、「100×150 二联面单」打到面单机B，各两组等宽地址（http:// 和 ipp://）可以选中、不溢出卡片；下面 Windows、macOS 怎么添加两段说明；共享密码「已设置」和「不用密码」；电脑卡里一台「已拒绝，用户 仓库」带「撤销」；1024 宽时地址折行不出横向滚动条',
    launch: { fakePrinters: SHARING_PRINTERS },
    setup: async ({ page }) => {
      const port = await startSharing(page);
      await callApi(page, 'setSharePassword', '前台1234');
      // 从本机发一个任务，在询问条上点「拒绝」：电脑卡里就有一台「已拒绝」。
      const url = `http://127.0.0.1:${port}/printers/60x40`;
      await sendIpp(
        url,
        ippRequest(OPERATIONS.printJob, { printerUri: url.replace('http:', 'ipp:'), operation: [nameAttr('requesting-user-name', '仓库')] }),
        MINIMAL_PDF,
        { authorization: `Basic ${Buffer.from('x:前台1234').toString('base64')}` },
      );
      await page.getByRole('region', { name: '等待确认的电脑' }).getByRole('button', { name: '拒绝' }).click();
      await openSharingPage(page);
    },
  },
  {
    id: 'V92',
    title: '配置中心 · 局域网共享 · 端口被占用、已自动换端口',
    points:
      '状态「正在共享（已自动换端口）」、橙色；说明里写出被占用的端口、占用它的程序（查得到时）和新端口，并提醒按旧地址添加过的电脑要重新添加；端口输入框里是被占用的那个端口，「恢复默认」可点；地址里的端口是新端口',
    launch: { fakePrinters: SHARING_PRINTERS },
    setup: async ({ page }) => {
      const blocker = await occupyAnyPort();
      await startSharing(page, { ippPort: blocker.port });
      await openSharingPage(page);
      await expect(page.getByRole('status').filter({ hasText: '已自动换端口' })).toBeVisible();
    },
  },
  {
    id: 'V93',
    title: '工作台 · 局域网里的新电脑第一次打印',
    points:
      '程序顶部居中一条询问：第一行等宽「局域网里的电脑 127.0.0.1」，下面「用户 仓库 要打印到「60×40 标签」。不认识这台电脑就点「拒绝」。」，右边「拒绝」「允许」；左边橙色竖条；不遮住标题栏；按 Tab 焦点不落到两个按钮上（扫码框保持焦点）；1024 宽时文字折行、按钮不被挤出',
    launch: { fakePrinters: SHARING_PRINTERS },
    setup: async ({ page }) => {
      const port = await startSharing(page);
      await page.reload();
      await expect(page.locator('.scan-bar__input')).toBeFocused();
      const url = `http://127.0.0.1:${port}/printers/60x40`;
      await sendIpp(
        url,
        ippRequest(OPERATIONS.printJob, { printerUri: url.replace('http:', 'ipp:'), operation: [nameAttr('requesting-user-name', '仓库')] }),
        MINIMAL_PDF,
      );
      await expect(page.getByRole('region', { name: '等待确认的电脑' })).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.locator('.scan-bar__input')).toBeFocused();
    },
  },
```

（V92 里占端口的 `blocker.server` 在测试进程退出时释放；视觉验收的框架如果有每项之后的清理钩子，在钩子里 `server.close()`。）

文件开头的说明注释里「打印 PDF 是 V70–V72」后面加「，局域网共享是 V90–V93」。

`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 第 8.2 节表格最后一行之后加：

```
| V90 | 配置中心 · 局域网共享 · 没有开 | 导航位置；开关关闭、「没有开」；没有防火墙、自动发现两行和打印机卡；密码「没有设置」；电脑卡空说明 |
| V91 | 配置中心 · 局域网共享 · 正在共享 | 「正在共享」；两台共享打印机各两组等宽地址、不溢出；添加说明；密码「已设置」；一台「已拒绝」的电脑和「撤销」；1024 宽不横向滚动 |
| V92 | 配置中心 · 局域网共享 · 已自动换端口 | 橙色「已自动换端口」，说明里有旧端口、占用的程序、新端口和「重新添加」的提醒；地址用新端口 |
| V93 | 工作台 · 新电脑第一次打印 | 顶部询问条：等宽的电脑地址、用户和纸张、拒绝 / 允许；不遮标题栏；Tab 不落到按钮上；1024 宽折行 |
```

- [ ] **Step 2: 跑视觉验收并逐张核对**

Run: `bunx playwright test --config e2e/visual/playwright.config.ts -g "V9"`
Expected: V90–V93 在各尺寸下通过自动检查；打开 `test-results/visual-acceptance/` 的截图逐项核对 points（地址不溢出、询问条不遮标题栏、深浅色）。再全量跑一次，确认 V38（本机接口的询问）等没有被询问条的改动影响：`bunx playwright test --config e2e/visual/playwright.config.ts`。macOS 上看红绿灯区域和全屏。

- [ ] **Step 3: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items V90-V93 for LAN sharing" -m "Screenshots of the sharing page when off, sharing two papers with a password and a refused computer, after moving to another port, and the request bar for a new computer's first print on the workbench." -m "$TRAILER"
```

---

### Task 25: 文档、真机验证清单、PR

**Files:**
- Create: `docs/lan-sharing.md`
- Modify: `README.md`、`docs/roadmap.md`、`docs/windows-acceptance.md`
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 2 节依赖表、第 8.1 节实现说明）
- Modify: `docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md`（打印结果通知的来源）
- Modify: `CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`、`resources/installer/CLAUDE.md`

- [ ] **Step 1: `docs/lan-sharing.md`**（给操作员和验收的人看）

```markdown
# 局域网共享（IPP）

打开配置中心「局域网共享」后，这台电脑的每种「分配了打印机的纸张」就是局域网里的一台共享打印机（例如「60×40 标签 @ 前台」）。别的电脑不装驱动就能添加它，从任何程序打印：内容按这张纸缩放、转黑白后由这台电脑的热敏标签机打出来，每张都记进打印记录（来源「局域网共享」）。

## 怎么添加

- **Windows 10 / 11**：设置 → 蓝牙和其他设备 → 打印机和扫描仪 → 添加设备。列表里出现「60×40 标签 @ 前台」就直接添加；没出现就点「我需要的打印机不在列表中」→「按名称选择共享打印机」，填共享页上的 `http://` 地址（例如 `http://192.168.1.10:8631/printers/60x40`），驱动选「Microsoft IPP Class Driver」。
- **macOS**：系统设置 → 打印机与扫描仪 → 添加打印机，在列表里选「60×40 标签 @ 前台」，「使用」选 AirPrint。
- **iPhone / iPad**：打印时在「打印机」里直接选它（AirPrint）。
- 新电脑第一次打印时，这台电脑顶部会问「允许 / 拒绝」；决定会被记住，在共享页可以撤销。

## 要知道的

- 只接受局域网（私有网段、直连）来的连接；传输是明文 HTTP。设了「共享密码」后别的电脑要输入它（用户名随便填），但密码在局域网里能被抓包看到：它挡住随手添加，不防有心人。
- 端口默认 8631，被占用时自动换（共享页会说换成了哪个）；换了端口，按地址添加过的电脑要重新添加，自动发现添加的不受影响。
- Windows 安装版第一次打开共享时要点「添加防火墙规则」（管理员确认）：放行本程序的 TCP 连接和自动发现用的 UDP 5353。
- 页面和纸差不多大的文档整页打；A4 上的一张面单、截图、照片会先去掉四周空白再放到纸上。照片用抖动，其余按阈值转黑白。

## 真机验证清单

每一项写进 `docs/windows-acceptance.md`（Windows）或 `docs/roadmap.md` 的 macOS 进度（macOS），记下系统版本、结果和程序日志里 `[ipp] job … format …` 那一行（看对方实际发来的格式）。

### 一致性（在 macOS 或装了 CUPS 的 Linux 上）

- [ ] `ipptool -tv ipp://<地址>:8631/printers/60x40 get-printer-attributes.test`、`ipp-2.0.test`：全部 PASS；没过的记下属性名。
- [ ] `ipptool -tv -f <一个 60×40 的 PDF> ipp://<地址>:8631/printers/60x40 print-job.test`：任务完成，出纸。

### Windows 客户端（Windows 11 24H2、Windows 10 22H2 各一台）

- [ ] 「添加设备」的自动搜索里出现「60×40 标签 @ 电脑名」，添加后驱动是「Microsoft IPP Class Driver」。
- [ ] 按地址添加（`http://…`）成功；打印测试页出纸。
- [ ] 记事本、Edge 里的 PDF、Word 各打一张：出纸正确；日志里记下格式（预期 `image/pwg-raster`，也可能是 `application/pdf`）。
- [ ] Word 打 2 份：出 2 张、按份排序（已知旧的类驱动会丢掉份数：记下实际结果）。
- [ ] 打印对话框的纸张列表只有这一种纸，名字可读。
- [ ] 打开「Windows 受保护的打印模式」（24H2）后仍能添加、打印。
- [ ] 设了共享密码：Windows 弹出凭据框，输入后能打；输错被拒。（如果 Windows 对 http:// 上的基本认证不弹框，记下来：文档里改成「Windows 上建议不设密码，只靠电脑询问」。）
- [ ] 标签机缺纸时打一张：Windows 的打印队列显示错误；放好纸后程序这边重打或对方重发。
- [ ] 第一次打印：本机顶部出现询问和系统通知；点「拒绝」后对方任务显示错误；在共享页撤销后再打，重新询问。

### macOS 客户端（macOS 15 一台）

- [ ] 「打印机与扫描仪」自动列出，「使用」自动是 AirPrint；预览里打 PDF 出纸；日志里的格式（预期 `application/pdf` 或 `image/urf`）。
- [ ] 设了共享密码：macOS 要求输入并存进钥匙串。
- [ ] iPhone 的「照片」「文件」打印能找到并打出（照片是抖动）。

### 这台电脑是 macOS（共享的一端）

- [ ] 开共享后别的 Mac、Windows 能自动发现（和系统的 mDNSResponder 共用 5353）；端口 8631 可用。
- [ ] pkg 安装版：系统防火墙不弹框（安装时已放行本程序）。

### Windows 安装包

- [ ] 新装：安装时的防火墙确认点「是」后，`Get-NetFirewallRule -DisplayName 'CDL-LabelFlash local API' | Get-NetFirewallPortFilter` 有 TCP 和 UDP 5353 两条。
- [ ] 从上一个版本覆盖安装：两条规则都在；本机接口照常对局域网开放。
- [ ] 卸载：两条规则都删掉。
```

- [ ] **Step 2: 其他文档**

`README.md` 的功能列表加一条「**局域网共享**：每种纸是一台共享打印机，局域网里的 Windows、macOS、iPhone 不装驱动就能打印（IPP / AirPrint），新电脑第一次打印要在这台电脑上点允许」，并链接 `docs/lan-sharing.md`。

`docs/roadmap.md`：子项目 6a 标为已完成（待真机验收的项链接到 `docs/lan-sharing.md` 的清单）；macOS 进度表加「局域网共享：CI 通过，真机待验证」；遗留项加「Identify-Printer、IPPS（TLS）、Create-Job / Send-Document：真机验证需要时再做」。

`docs/windows-acceptance.md` 末尾加「## 局域网共享（待做）」，把 `docs/lan-sharing.md` 里 Windows 客户端和 Windows 安装包两段的清单抄过来（每项留结果栏）。

`docs/superpowers/specs/2026-10-01-feature-parity-design.md`：

1. 第 2 节依赖表 `bonjour-service` 那一行改为：`| ~~bonjour-service~~ | — | 不引入（实施时改） | 它把所有网卡（含虚拟机、VPN）的地址都广播出去、只从默认网卡发组播；自己写的应答器只回答自己的几条记录，按局域网网卡过滤，见第 8.1 节 |`。
2. 第 8.1 节末尾加：

```
- **实现说明**（实施计划 `docs/superpowers/plans/2026-10-02-ipp-sharing.md`）：
  - IPP 编解码、属性集、任务表、六个操作、PWG / Apple 光栅解码、DNS 报文和 mDNS 应答都在 `src/core/ipp/`、`src/core/mdns/`（纯 TS，用 RFC 8010 附录 A 的报文测）；主进程 `src/main/ipp/` 只接线。
  - 免驱：Windows 的 IPP 类驱动按 IPP Everywhere 认、主要发 PWG Raster；AirPrint 要 `_universal` 子类型和 URF。所以文档格式除了 PDF、JPEG、PNG，还收 `image/pwg-raster` 和 `image/urf`；JPEG / PNG 在 PDF 打印的 sandbox 渲染页里解码。
  - 网址 `/printers/<纸张键>`；实例名「60×40 标签 @ 电脑名」；mDNS 主机名 `labelflash-<实例编号前 8 位>.local`。
  - 只监听 IPv4，连接一建立就按地址过滤（私有网段、链路本地、本机）；先认证再读正文；文档上限和 PDF 打印一样 50MB。
  - 共享密码只存 scrypt 摘要（不需要取回原文），不放进「密钥」表。
  - 新电脑第一次打印：任务先收下、停在 pending-held，顶部询问，允许后处理，拒绝或 2 分钟没人点就中止；决定按地址记住。
  - 页面和纸差不多大（±3mm）整页打，否则去白边；多份按整份依次打；每张一条记录（来源 ipp，带 PDF 的位图编号和电脑、用户）。
  - 防火墙：原来那条按程序放行 TCP 的规则覆盖 IPP 端口；另加 UDP 5353 一条，查询分开，只有旧规则的电脑上本机接口不受影响。
```

`docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md` 打印结果通知的 `source` 说明里补上 `ipp`（局域网共享）：`rule` 固定为 `{ "id": "ipp", "name": "局域网共享" }`，`fields` 是「文件」「页码」「第几张」「电脑」，对方给了用户名时还有「用户」。

`CLAUDE.md`（根目录）：

1. 平台表加一行：`| 局域网共享（IPP 打印服务、mDNS 自动发现） | ✅ 防火墙规则（TCP + UDP 5353）和本机接口共用 | ✅（未在 Mac 上验证） |`。
2. 「数据与环境」的「隔离数据」那几条之后加：`- **局域网共享的端口和广播**：E2E 用 CDL_LABELFLASH_IPP_PORT=0（系统分配）、CDL_LABELFLASH_IPP_DISCOVERY=0（不发 mDNS）。同样只对未打包的程序生效。`
3. 「安全底线」加一条：`- 局域网共享只接受私有网段、链路本地和本机的连接（在 connection 事件里就断开别的），先认证再读正文，文档有大小上限；收到的 PDF、图片只在 sandbox 的渲染页里解析，光栅由 core 的纯 TS 解码。共享密码只存摘要。`
4. 「架构」代码块里 `src/main` 那一行的括号里加 `局域网共享（ipp/）`。

`src/core/CLAUDE.md` 模块表加两行：

```
| `ipp/` | 局域网共享：IPP 编解码（`ipp-codec.ts`，RFC 8010，带上限）、建 / 读属性（`ipp-attributes.ts`）、共享打印机和状态（`shared-printer.ts`）、完整属性集（`printer-attributes.ts`，RFC 8011 + IPP/2.0 + IPP Everywhere + AirPrint）、文档格式（`document-format.ts`，按文件头认）、PWG / Apple 光栅解码（`raster.ts`）、任务表（`ipp-job-book.ts`）、六个操作（`ipp-operations.ts`）、整页还是去白边和记录字段（`ipp-print.ts`）、Bonjour 广告（`ipp-advert.ts`）；测试用的请求和光栅编码器在 `testing/` |
| `mdns/` | DNS 报文编解码（`dns-message.ts`，名字压缩只许往前指）、DNS-SD 记录（`dns-sd.ts`）、mDNS 应答（`mdns-responder.ts`：回答、宣告、告别、探测、冲突） |
```

`src/main/CLAUDE.md` 在「PDF 打印」一节之后加：

```
## 局域网共享（`ipp/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 8.1 节，操作说明和真机验证清单在 `docs/lan-sharing.md`。

- **分层**：都不 import electron，用 `bun test` 测试；HTTP 服务和组装用 `testing/ipp-client.ts` 真的发 IPP 请求测。
  - `ipp-sharing.ts`：组装、跟随设置启停（默认关）、共享打印机 = 已分配且装着的纸、防火墙没放行时先不监听、改名后重新广播；
  - `ipp-http-server.ts`：只监听 IPv4（复用 `net/http-listener.ts` 的端口回退和自检），connection 事件里按地址过滤，先认证再读正文（没认证最多 64KB），100-continue 先看认证；
  - `ipp-job-processor.ts`：一次一个任务，PDF / 图片交给 IPP 专用的 `PdfRenderHost`，光栅用 core 解，复用 PDF 打印的裁切、位图缓存和临时模板，经 `printFields`（来源 `ipp`）；
  - `client-approvals.ts`：新电脑等确认（2 分钟、最多 3 台），决定存 `ipp_clients`；`share-password.ts`：scrypt 摘要；
  - `mdns-advertiser.ts`：UDP 5353（`reuseAddr`），每块局域网网卡加入组播组、用自己的地址回答。
- **防火墙**：本机接口那条规则按程序放行 TCP（覆盖 IPP 端口），另有 UDP 5353 一条；`check` 只看 TCP（旧安装不回退），`check-discovery` 看 UDP。任一边加了规则，两边都重新检查。
- **net/**：`http-listener.ts` 是本机接口和局域网共享共用的监听（端口回退、回环自检、重启时收尾）。
```

`src/renderer/CLAUDE.md` 的「手机扫码」一节之前加：

```
## 询问条

- 网站想用本机接口、局域网里的新电脑第一次打印，都在程序顶部的 `.request-bar` 里询问（`components/RequestList.tsx`，两组各是一个带名字的区域：「等待确认的网站」「等待确认的电脑」）。按钮不进 Tab 顺序，扫码枪的 Tab、回车落不到「允许」上；不弹模态框。
```

`resources/installer/CLAUDE.md` 讲防火墙的地方补一句：`firewall.ps1` 现在加、删两条同名规则（TCP 所有端口、UDP 5353），改了以后要实际装一次、覆盖装一次、卸载一次，用 `Get-NetFirewallRule -DisplayName 'CDL-LabelFlash local API' | Get-NetFirewallPortFilter` 核对。

- [ ] **Step 3: 安装包验证**（改了防火墙脚本，按根目录 CLAUDE.md 必须做）

Run: `bun run dist:win`，在 Windows 上：装一次（安装时的防火墙确认点「是」）→ 核对两条规则 → 打开共享，用另一台电脑按地址添加、打一张 → 从上一个安装包覆盖安装 → 两条规则都在、本机接口仍对局域网开放 → 卸载 → 两条规则都没了。结果写进 `docs/windows-acceptance.md`。macOS 的 pkg 没有改动，CI 的 `dist:mac` 通过即可；如果手边有 Mac，按 `docs/lan-sharing.md` 的 macOS 两段各做一次。

- [ ] **Step 4: `bun run check` 后提交，推送，开 PR**

```bash
git add docs/lan-sharing.md README.md docs/roadmap.md docs/windows-acceptance.md docs/superpowers/specs/2026-10-01-feature-parity-design.md docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md CLAUDE.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md resources/installer/CLAUDE.md
git commit -m "docs: describe LAN sharing and how to verify it on real clients" -m "An operator guide with the real-machine checklist for Windows' IPP class driver, macOS and iOS AirPrint, ipptool conformance and the installer's firewall rules; the design records why no mDNS library was added and how driverless clients are served; the CLAUDE.md files point at the new core and main modules." -m "$TRAILER"
git push -u origin feature/ipp-sharing
gh pr create --base master --title "feat: LAN sharing over IPP (sub-project 6a)" --body "<中文说明：做了什么、为什么不引入 bonjour-service、免驱的属性集和格式、安全措施（只对局域网、先认证再读正文、sandbox 解析、密码只存摘要）、验证（单元测试、E2E、视觉验收 V90–V93、dist:win 装 / 覆盖装 / 卸载、已做和待做的真机验证）；只在 Windows 上验证过的写明；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并（中间不发版）。真机验证清单里没做的项留在 `docs/windows-acceptance.md`、`docs/roadmap.md`，PR 说明里列出来。

---

## Self-Review 记录

- **设计覆盖（第 8.1 节和任务说明）**：
  - 设置「局域网共享」、IPP/2.0 服务、默认 8631、被占用自动换 → Task 12（共用的端口回退）、19（设置、组装）、20（接线）、22（页面）。
  - 每种已分配打印机的纸张是一台共享打印机、`/printers/<纸张键>`、中文名（printer-name / printer-info / make-and-model）→ Task 4、19；网址命名的取舍见「关键决定」第 3 条。
  - mDNS / DNS-SD `_ipp._tcp` + `_universal`（+ `_print`）→ Task 9–11、17；`bonjour-service` 的评估和不引入的理由 → 「关键决定」第 1 条、Task 25 改设计文档。
  - 六个操作 → Task 7；文档格式 PDF / JPEG / PNG + PWG Raster / URF，以及为什么需要后两者、最小属性集 → 「关键决定」第 2 条、Task 4、5、15。
  - IPP 编解码自己写、纯 core、RFC 8010 样例测试 → Task 2、3。
  - 上限：请求大小、文档大小（= PDF 打印）、并发任务、超时 → 「上限」表；Task 2、5、6、9、13、14。
  - 收到的任务走 PDF 流程（整页 / 去白边、缩放到纸）、图片同路、按纸张找打印机、来源 `ipp`、记电脑地址和用户名 → Task 8、15、16。
  - 只对局域网（非私有地址拒绝、监听 0.0.0.0 再过滤）、防火墙规则和本机接口一起加 → Task 12、14、18；共享密码（基本认证）→ Task 13、14（存法的取舍见「关键决定」第 6 条，请确认）；新电脑询问（复用询问条、记住决定、等确认有超时）→ Task 13、16、22。
  - Windows「按地址添加 / 自动发现」、macOS「打印机与扫描仪」的用法和真机验证 → Task 22（页面说明）、25（`docs/lan-sharing.md` 清单）。
  - 测试：编解码单元测试 → Task 2、5、9；用真的 HTTP 客户端测服务 → Task 14、19；E2E（开共享、发小 PDF、假打印机、记录）→ Task 23；视觉验收 V90–V93 → Task 24。
  - 第 9–11 节：不可信输入有上限、解析失败一律拒绝（Task 2、5、9、14）；Rule of 2：JPEG / PNG 进 sandbox 渲染页，光栅是内存安全的 TS（Task 15、16）；最小权限：默认关、管理员权限只在点按钮时弹（Task 19、22）；快速失败：编码器遇到程序自己的错误直接抛（Task 2、9、10）；IPC 只给最小能力并逐个校验（Task 20）；小步提交（每个任务一个提交，Task 21 与 22 合并提交是为了每个提交都能过类型检查）。
- **没有占位**：每个代码步骤给出完整代码。几处「如果 … 就 …」是按合并时的实际情况调整的分支，改法都写明了：Task 1（缺前提时停下）、Task 8（`describeJobMeta` 按合并后的样子改、`readString` 是否接受空字符串）、Task 13（同上）、Task 15（`page.render` 参数沿用 PDF 打印核对过的写法）、Task 20（打印机状态检测有没有回调钩子）。「迁移 N」是 Task 1 Step 2 第 3 条核对出的实际序号，测试里用 `MIGRATIONS.slice(0, -1)` 不依赖它。
- **类型一致**：`IppMessage` / `IppAttribute` / `IppValue`（Task 2）贯穿 3、4、6、7、14；`SharedPrinter`（Task 4）在 7、11、14、16、19 用，`testPrinter()` 是它的样例；`IppJob`、`IppJobBook`（Task 6）在 7、14、16、19；`ClientDecision`（Task 7）在 13、14；`AcceptedPrint`（Task 7）→ `AcceptedJob`（Task 14，加 `printer`）→ `IppJobProcessor.enqueue`（Task 16）；`IppRef`（Task 8）在 `FieldsPrint.ipp`、`JobRecord.ipp`、Task 16 的 `printFields` 调用；`MdnsZone` / `ServiceAdvert`（Task 10）在 11、17、19；`LanInterface`（Task 12）在 17、19、20；`IppSharingStatus` 等（Task 19 的 `shared/ipp-sharing.ts`）在 20、21、22；`DEFAULT_IPP_PORT`、`SHARE_PASSWORD_LENGTH`、`isValidSharePassword` 只定义在 `shared/ipp-sharing.ts`（Task 13），主进程和界面都从这里取。
- **迁移**：只追加一条（加两列、建两张表），不重建 jobs 表；来源 `ipp` 早在迁移 6；IPP 记录带 PDF 的位图编号，自动排除在扫码防重复窗口之外。
- **不回退**：本机接口的监听逻辑原样搬进 `HttpListener`，原有测试一字不改；防火墙原来的 `check` 只看 TCP，只有旧规则的电脑上本机接口照旧对局域网开放；网站询问条换成通用组件后区域名「等待确认的网站」不变，`local-api.e2e.ts` 照旧通过；共享默认关，已有的 E2E 不受影响。
- **两个平台**：Windows（防火墙两条规则、安装版先等防火墙、类驱动发 PWG Raster）、macOS（端口避开 CUPS 的 631、和 mDNSResponder 共用 5353、AirPrint 发 PDF / URF、打印机状态未知时按能打印算）都写明；只在 CI 上验证、没有真机结果的项列在 `docs/lan-sharing.md` 和 PR 说明里。
- **已知风险（真机验证时重点看）**：Windows 类驱动在 http:// 上会不会弹基本认证的凭据框；旧的类驱动会不会丢份数；Windows 的自动发现是否要求 Mopria 认证类属性；`job-held-for-authorization` 在 Windows 打印队列里怎么显示；未实现 Identify-Printer 时 macOS / Windows 是否仍然当它是 IPP Everywhere 打印机。
