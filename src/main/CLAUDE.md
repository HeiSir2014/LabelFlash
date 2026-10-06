# src/main — Electron 主进程

主进程只做接线：Electron API、SQLite、系统命令、网络。业务规则留在 `src/core`。

## 可测试的写法

- **逻辑和接线分开**：能不依赖 Electron 的逻辑，单独放进不 import `electron` 的文件，用 `bun test` 测试。现成的例子：
  - `window-state.ts`、`window-bounds.ts`、`gpu-fallback.ts`、`context-menu.ts`
  - `log-files.ts`、`ipc-errors.ts`、`ipc-validators.ts`、`update-settings.ts`
  - `printing/printer-status.ts`、`printing/printer-profiles.ts`、`printing/page-size.ts`、`printing/fake-printers.ts`
  - `mobile/` 整个目录
  - `diagnosis/` 除了 `create-diagnosis-system.ts`（接上真实进程和文件）都不 import electron
- **接线文件保持薄**：`window.ts`、`window-placement.ts`、`updater.ts`、`index.ts` 这类只负责接线，不写业务判断。
- **依赖注入**：外部依赖由构造参数传入，测试时换成假的，例如 `PrinterProbeHost` 的进程工厂。

## IPC

- **新增一个通道**，按这个顺序改：
  1. 在 `src/shared/ipc-contract.ts` 的 `IpcChannel` 里加通道名（`领域:动作`），并在 API 类型里声明。
  2. 在 `ipc.ts` 里用 `handle` / `on` 注册处理函数。
  3. 每个参数都用 `ipc-validators.ts` 的 `require*` 校验。缺少合适的校验函数就新增一个，并补测试。
  4. 在 `src/preload/index.ts` 里暴露给界面。
- **只信任主 frame**：`registerIpc` 只接受主窗口主 frame 发来的消息，其他来源一律拒绝并记日志。
- **错误处理**：处理函数里的错误由 `logFailures` 带通道名写进日志，再原样抛回给界面。
- **向界面推送**：用 `index.ts` 里的 `sendToMainWindow`。退出过程中窗口可能已经销毁，它会先检查。

## 存储（`storage/`）

- **一个表一个仓储**：每个表对应一个 `sqlite-*-store.ts` / `*-repository.ts`，实现 core 里定义的接口。
- **读出的行也要校验**：从数据库读出的行经过 `row-readers.ts` 校验，不信任库里的数据。
- **连接参数**：`database.ts` 统一设置 WAL、`busy_timeout`、外键。
- **迁移规则**：见根目录 CLAUDE.md（1.0.1 发布前直接改初始 schema，发布后只能追加）。
- **测试的临时目录**：用 `storage/testing/temp-dir.ts` 创建和删除，它处理了 Bun on Windows 关闭连接后仍占用文件的问题。

## 打印（`printing/`）

- **打印适配器** `electron-driver-adapter.ts`：隐藏的 `BrowserWindow`（sandbox，禁用 JS）加载标签 HTML，再调用 `webContents.print` 静默打印。超时时由 `AbortSignal` 销毁这个窗口。
- **打印机探测** `printer-probe-host.ts`（只在 Windows 上）：常驻一个 PowerShell 进程，用行协议查询打印机状态、驱动纸张、驱动名，并原样发送标签机指令。
  - 打印机名和数据都用 base64 编码后传入（「命令 名字 [数据]」），名字转义通配符。
  - 原样发送：第一次用时 `Add-Type` 编译一小段 C#（只用 C# 5 语法），P/Invoke winspool 的 W 版函数，数据类型 RAW；Win32 错误写成 `err win32:<错误码> …`。整段脚本经 `-EncodedCommand` 传入，测试核对命令行不超过 32767 字符。
  - 不要改成每次查询都新启动一个 PowerShell：启动一次约耗 1 秒 CPU。
- **状态判定** `printer-status.ts`：检测所有被分配到的打印机（纸张分配和模板指定里出现的），每轮重新取名单；只有驱动明确报告问题（离线、缺纸、卡纸……）才判定为不能打印；查询失败按「未知」处理，不阻止打印。异常通知按「打印机 + 问题」限频。
- **面单** `waybill-html.ts`：按 core 的 `layoutWaybill` 结果画绝对定位的格子和线；条码 `code128.ts`（自己实现，B / C 子集、校验位），每个模块取整数个点、两侧留 10 个模块空白，放不下或内容不能编码时不印并在 `RenderWarnings` 里说明。`label-html.ts` 的 `renderLabelHtml` 按模板的 `kind` 分派，标签、面单、自由设计共用打印、预览、PDF 的入口。
- **条码** `barcode.ts`：面单和自由设计共用的画法和限制，编码交给 bwip-js 的 `raw()`（只取条空宽度或点阵，不用它画图）；每个模块取整数个打印点（`moduleDotsFor` 用 `ceil` 取下限，不用 `round`，否则换算回毫米会比最小模块宽窄）；一维码两侧留 10 个模块静区，二维码制按各自标准留 1–3 个模块（PDF417、汉信码、DotCode 另有规定）；邮政四态码给小数条宽、取不了整点，不进码制清单。内容不合码制（位数、校验位、字符、GS1 格式……）时按 bwip-js 的错误码给出中文原因，原始英文错误留在 `detail` 里写日志，不给用户看；空内容、超长、一维码里的非 ASCII 字符（中文会走扩展模式，扫出来是乱码）在编码前就拦下。面单的 Code128 仍用自己的编码器（`code128.ts`），只共用这里的画法和限制，输出逐字不变。
- **自由设计** `canvas-html.ts`：元素绝对定位在整点上，直角旋转绕左上角转再整点平移；条码、二维码画成按点对齐的 SVG，图片转成 1 位 BMP（`core/templates/mono-image.ts`，抖动照片画成 SVG 路径会到几 MB，BMP 只随点数线性增长）；条码二维码放不下、内容不合码制、图片数据坏了，都在本元素不印，原因写进 `RenderWarnings.issues`（格式统一是「种类「名字」不印：原因」），条码库的原始错误另写进 `diagnostics`，每次打印、生成 PDF 各记一次日志，预览不显示。
- **二维码** `qr-code.ts`：每个模块取整数个打印点（按打印机的分辨率，读不到按 203dpi），边缘才清晰；模块的最小、最大尺寸按毫米定，分辨率高的打印机不会把二维码打得更小。
- **打印机资料** `printer-profiles.ts`：每台打印机的驱动纸张和分辨率，缓存 1 分钟；打印时最多等 1 秒，等不到按 203dpi；打开「打印首选项」后丢掉那一台的缓存。
- **页面尺寸** `page-size.ts`：按模板的纸张算 `webContents.print` 的 pageSize。
- **决定打印机**：规则在 core 的 `printing/resolve-printer.ts`，主进程只提供本机打印机列表（`PrinterDriver.knownPrinterNames`）。读打印机列表要用主窗口，启动时窗口还没建好，检测和预读在窗口建好之后再做。
- **假打印机** `fake-printers.ts`：环境变量 `CDL_LABELFLASH_FAKE_PRINTERS`（只对未打包的程序生效）换掉适配器、驱动纸张查询和状态探测，E2E 和视觉验收用。
- **模板库** `library-previews.ts`：按每个模板的示例数据排出缩略图 HTML（`renderLabelHtml`，203dpi），`templates:library` 每次现排、不缓存；`library-html.test.ts` 核对每个模板在 203、300dpi 都印得出并做 HTML 快照。预览、试打带模板库编号时，`ipc.ts` 的 `librarySampleOf` 按编号取示例数据（页面不能交字段）。
- **标签机指令** `printer-commands-station.ts`：核对打印机在系统列表里 → 认指令集（手动 / 在线驱动清单 / 驱动名）→ 按范围把关 → 保存（设置的 `printerCommands`）→ 经 `raw-sender.ts` 发送一次。发送方式：Windows 探测进程、macOS `lp -o raw`（参数数组，字节走标准输入）、其他平台「不支持」。驱动名在 `printer-identity.ts`（macOS 取 `printer-make-and-model`）。不经 `PrintService`、不写打印记录，每次发送写日志。假打印机记下收到的指令文字（`rawJobs`）。

## 其他子系统

| 目录 / 文件 | 要点 |
|---|---|
| `scan/sandboxed-regex.ts` | 用户写的正则只在隔离上下文里执行，单条 20ms 超时 |
| `scan/http-step.ts` | HTTP 查询：`net.fetch`，结果短时缓存，请求头里的 `{密钥:名称}` 在这里替换成明文 |
| `secrets/` | `safeStorage` 加密（Windows 上是 DPAPI，macOS 上是钥匙串）。密钥明文不写日志、不导出、不回传给界面 |
| `notify/` | 打印结果通知：先写进本机队列（`webhook-outbox.ts`），后台发送并按退避策略重试，签名用 HMAC-SHA256 |
| `voice/` | 语音用 msedge-tts 合成，mp3 按「文本 + 音色 + 语速」缓存；断网时退回提示音 |
| `logging.ts` | 日志在数据目录的 `logs/labelflash-YYYY-MM-DD.log`，纯文本，时间带时区，保留 14 天；`console.*` 和界面的 console 都会写进去 |
| `updater.ts` + `update-settings.ts` | 自动更新，只有打包好的 Windows 版（macOS 的 pkg 没有开发者签名，装不了更新）。是否检查（`initialUpdateStatus`）和所有更新行为都在 `update-settings.ts` 里显式设置，不依赖库的默认值。「重启更新」点一次就静默安装（`INSTALL_OPTIONS`），装完由安装程序带 `--updated` 启动新版本；新版本的窗口去哪（到最前，或关在托盘里静默更新的留在托盘）由旧版本写下的 `relaunch-intent.ts` 决定。窗口关到托盘超过 1 分钟、打印队列和本机接口队列都空、手机扫码没开时静默更新（`background-update.ts`） |
| `window-activation.ts` | 窗口到最前并拿到焦点：启动、更新后重启、托盘、双击快捷方式、点通知都经过它。Windows 有前台锁，后台进程拉起的窗口 `show()`/`focus()` 会留在后面（任务栏闪），先最小化再还原才能到前台；Electron 的 `isFocused()` 这时也会说有焦点，不能拿它判断（2026-09-30 实测） |
| `window-placement.ts` | 按显示器记忆窗口位置。保存时扣掉 Windows 小数缩放下创建窗口的尺寸误差，否则窗口每次启动都会变大一点 |
| `security.ts`、`app-protocol.ts` | 拒绝导航、新窗口、重定向和 webview；只经 `app://bundle/` 提供界面文件 |
| `mobile/` | 手机扫码的电脑端，见下一节 |

## 诊断（`diagnosis/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.2 节。

- **分层**：系统命令的输出由 `windows-facts.ts`、`mac-facts.ts` 解析成 core 的「事实」，结论在 core 的 `verdicts.ts`；`windows-diagnosis.ts`、`mac-diagnosis.ts`、`fake-diagnosis.ts` 实现同一个 `DiagnosisSystem`，依赖由构造参数传入；样本在 `testing/fixtures/{windows,mac}/`，按原样保存。
- **`diagnosis-station.ts`**：打印机名不在系统列表里的，检查只说「已经没有这台了」，修复直接拒绝；修复按 core 的管理员策略核对，同一时间只做一个；检查和修复都写日志，「查不到」的英文原因也写。
- **Windows**：查询走常驻探测进程（`spooler`、`printer`、`usb`、`jobs`、`paper-options`，回答一行 JSON，长度有上限）；取消本程序的任务用一次性 PowerShell；要管理员的用 `windows-powershell.ts`（防火墙的做法：外层 `Start-Process -Verb RunAs`，内层 Base64，确认框没成退出 1223），提权脚本第一行把 `PSModulePath` 收紧到 `$PSHOME`，只用 .NET 系统程序集和 `[Environment]::SystemDirectory` 下的 `sc.exe`，结果靠退出码带回（`windows-scripts.ts` 的 `SCRIPT_EXIT`）。
- **macOS**：`command-runner.ts` 跑命令（参数数组、英文环境、关 stdin、独立会话——CUPS 要密码时不会去终端上等）；改 CUPS 的先以当前用户做，`Forbidden` 时返回 needs-admin，操作员点管理员按钮后经 `osascript … with administrator privileges`（命令、提示经 argv，`shellCommand` 逐个单引号转义）。Get-Jobs 用自己的 ipptool 测试文件（`CUPS_GET_JOBS_TEST`），用时写进临时目录、用完删掉。
- **账本**：`ElectronDriverAdapter` 和 5a 的 RAW 下发在任务进了系统队列后 `SubmittedJobs.record`，只在内存里。
- **接缝**：5a（指令集、走纸、校准）和 5c（重装驱动）只经 `seams.ts` 的两个接口，`index.ts` 里接上；5c 合并前 `drivers` 是 null，按钮不出现。

## 批量打印（`batch/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 5 节。

- **读表格在子进程里**（Chromium 两条法则）：`table-reader-host.ts` 每读一个文件 `utilityProcess.fork` 一个子进程（入口 `reader-worker.ts`，由 `index.ts` 以 `?modulePath` 引入、单独打包），30 秒超时、512MB 堆上限，读完就结束；子进程只收字节（不给路径），只回文字的二维数组，主进程再核对形状和上限（`readReply`），表头规则走 core 的 `tableFromRecords`。读取逻辑在 `table-file.ts`（不 import electron，用 `bun test` 测，`testing/minimal-xlsx.ts` 生成测试用的 .xlsx）。`.xls` 按扩展名和文件头拒绝。
- **`batch-station.ts`**：只留最近一张表；预览、检查（把每行排一遍找出条码印不了的，分段让出主线程，新的检查开始时放弃旧的）和打印用同一份 HTML；同一时间只有一批在打；进度最多 0.25 秒推一次（`batch:status-changed`），状态变化立即推，同时推 `jobs:changed`。
- **拖进窗口的文件**：界面读成字节经 `batch:read-dropped` 交来，主进程不接受任何路径（打开对话框选的文件由主进程自己读）。
- **静默更新**：批量打印还有没打的（含暂停中的）时不静默更新。

## 驱动安装（`drivers/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.3 节，给出品方的说明在 `docs/driver-catalog.md`。

- **清单**：`catalog-signature.ts`（Ed25519 信封，不依赖 electron，签名脚本也用）、`catalog-client.ts`（`net.fetch`、2MB 上限、15 秒超时、验签 → `sanitizeCatalog` → 过期和防回滚、退回同一地址上次的清单）、`catalog-state-store.ts`（最高版本和上次的清单存在 settings 表的独立键里，界面改不到）。地址：设置 `driverCatalogUrl` 优先，构建时注入的默认值（`build-defaults.ts`）兜底；代码里不写域名。内置公钥表是空的（开源 / 自己构建没填）时，清单直接按 `no-keys` 处理，不下载、也不提示填地址。
- **下载**：`installer-downloader.ts`：只要 https（跳转后也是），按清单的大小截断，边写边算 SHA-256，空闲 60 秒 / 总共 30 分钟超时，只删自己建的临时目录；启动时 `cleanupOldDownloads` 清一遍上次没清干净的临时目录。
- **平台**：`windows-devices.ts`（一次性 PowerShell 查 `Win32_PnPEntity`，不放进常驻探测进程）、`windows-signature.ts`（Authenticode，查询失败是 `unverifiable`，不等同「签名无效」）、`windows-install.ts`（一次 UAC；提权脚本只用 .NET 类型，在管理员专属目录复核哈希后运行，安装程序的 TEMP/TMP 也指到这个目录）、`mac-devices.ts`、`mac-install.ts`（`osascript … with administrator privileges` 运行固定脚本）；解析都是纯函数，按平台测试。平台选择只在 `driver-ports.ts`。共用的 `runPowerShell`（`run-command.ts`）会去掉子进程环境里的 `PSModulePath`，避免另外装的 PowerShell（例如 7）的模块路径抢在 Windows PowerShell 5.1 自己的模块路径前面。
- **编排**：`driver-station.ts`：同一时间一个安装；界面只能按设备编号装、打开清单里的 https 下载页；进度最多 0.25 秒推一次（`drivers:status-changed`）；装驱动时不静默更新、不能「重启更新」。`hints()` 给 5a、5b 按驱动名查；`reinstall(driverName)` 是 5b 用的接口，等真正装完（成功或失败）才返回，和 IPC 的 `drivers:reinstall-for-printer`（立即返回、进度照推）是两条路。按驱动名重装（`deviceKey` 为 null）跳过「找新打印机」，装完说「驱动已重新安装」。
- **假环境**：`fake-drivers.ts`（`CDL_LABELFLASH_FAKE_DRIVERS`、`CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY`，只对未打包的程序生效），一律走 Windows 流程；清单照样真实下载、真实验签。

## 本机接口（`api/`）

设计见 `docs/superpowers/specs/2026-09-30-local-api-design.md`，给第三方的说明在 `docs/local-api.md`。

- **分层**：除了 `pdf-render.ts`（隐藏窗口 + `printToPDF`），都不 import electron，用 `bun test` 测试，`http-server.test.ts` 和 `local-api.test.ts` 真的启动服务。
  - `local-api.ts`：组装（任务服务、密钥、授权、网站询问、HTTP 服务、防火墙），跟随设置启停，启停排成一队；防火墙没放行时（安装版）只监听本机；`index.ts` 只把 Electron 的能力传进来；
  - `http-server.ts`：`node:http`，依次试端口（`apiPortOrder`：指定的 → 上次用成功的 → 17631–17640 → 系统分配），监听后从 `127.0.0.1` 和 `::1` 自检；先认证再读请求体、请求体上限、预检、限速；
  - `origin-prompts.ts`：等操作员确认的网站（最多 3 个、10 分钟收起、拒绝后 10 分钟冷却），界面顶部显示询问条，同时发系统通知；
  - `authenticator.ts`：先认程序密钥（不核对 Host），再认本机来的网站（核对 Host、只认 http/https 的 Origin），其余一律要密钥；
  - `router.ts` + `resources.ts` + `request-schema.ts`：AIP 风格的路由、资源和校验；`openapi.ts` 和路由表由测试核对一致。
- **密钥**：只存 SHA-256 摘要。原文只在生成的那次 IPC 返回值里出现，另在内存里留 10 分钟给「复制」按钮，不写库、不写日志。
- **打印**：经 `PrintService.printFields`（来源 `api`），不播报；写了打印记录后推送 `jobs:changed`（合并成最多 0.5 秒一次）。
- **防火墙**：`firewall.ts` 执行 `src/shared/firewall-rule.ts` 生成的 PowerShell 脚本（系统目录里的 powershell.exe，整段 Base64 交给 `-EncodedCommand`，不经过命令行转义）；只动本程序路径下的规则。安装包用同一份脚本（见 `resources/installer/firewall.nsh`）。

## PDF 打印（`pdf/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 6 节。

- **分层**：除了 `pdf-render-window.ts`（隐藏窗口、会话），都不 import electron，用 `bun test` 测试。
  - `pdf-render-host.ts`：请求带编号、各自限时；回复用 `shared/pdf-render-protocol.ts` 的 `readRenderReply` 核对（位图宽高等于主进程自己算的），格式不对或超时就关掉渲染页；
  - `pdf-station.ts`：打开文件（先看大小和 `%PDF-` 文件头）、识别第一页、按设置出块（换设置时上一次作废，它存的块删掉，打过的留着）、预览一块、按顺序打印（`BatchRun`，来源 `pdf`）；
  - `piece-cache.ts`：每块一个 `<UUID>.lfm`，在数据目录的 `pdf-cache/`；预览、重打时续期，启动时删 7 天没用过的。编号拼进路径前先核对格式。
- **渲染页**：`src/renderer/pdf-render.html` + `src/renderer/src/pdf-render/main.ts`（第二个页面入口）、`src/preload/pdf-render.ts`（第二个 preload）。会话是内存里的独立分区，`app://` 协议另挂一份（`handleAppScheme` 的 `target`），权限一律拒绝，`render-session-policy.ts` 决定放行哪些请求。pdf.js 的运行时文件由 `scripts/pdfjs-assets.ts` 在构建时放进 `out/renderer/pdfjs/`。
- **打印记录**：PDF 打的记录带 `pdf`（文件、页码、第几张、位图编号，迁移 7）；`jobs:preview`、`jobs:reprint` 按位图编号读回、包成临时模板；预览不显示「靠近纸边」（一块本来就铺满纸）。

## 局域网共享（`ipp/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 8.1 节，操作说明和真机验证清单在 `docs/lan-sharing.md`。

- **分层**：都不 import electron，用 `bun test` 测试；HTTP 服务和组装用 `testing/ipp-client.ts` 真的发 IPP 请求测（只绑 127.0.0.1）。
  - `ipp-sharing.ts`：组装、跟随设置启停（默认关）、共享打印机 = 已分配且装着的纸、防火墙没放行时先不监听、关掉时中止没打完的任务、改名后重新广播；
  - `ipp-http-server.ts`：只监听 IPv4（复用 `net/http-listener.ts` 的端口回退和自检），connection 事件里按地址过滤，先认证再读正文（没认证最多 64KB），100-continue 先看认证，同时在收的正文总量有上限，密码错多了按地址锁一会儿；
  - `ipp-job-processor.ts`：新电脑先等确认（不占队列），再一次一个任务；PDF、图片和光栅都交给 IPP 专用的 `PdfRenderHost`（光栅也在 sandbox 渲染页里用 core 解，按纸张和打印机分辨率限制页大小、按 `MAX_RASTER_JOB_PIXELS` 限制整个任务；主进程不解行程编码），复用 PDF 打印的裁切、位图缓存和临时模板，经 `printFields`（来源 `ipp`）；
  - `client-approvals.ts`：新电脑等确认（2 分钟、最多 3 台），决定存 `ipp_clients`；`share-password.ts`：scrypt 摘要；
  - `mdns-advertiser.ts`：UDP 5353（`reuseAddr`），每块局域网网卡加入组播组、用自己的地址回答，只理局域网地址来的包；测试换成本机回环上的收包口，不发组播；
  - `ipp-quit.ts`：退出确认的文字、拒绝「重启更新」的说明、停共享最多等多久。
- **退出**：`index.ts` 的同一个 before-quit 里处理（模板 → 共享 → 批量和 PDF → 删缓存、停共享），不在 will-quit 里等；will-quit 只再 `void stop()` 一次兜底（「重启更新」、关机不经过 before-quit 的收尾）。
- **网段**：连接（和 mDNS 的包）只接受和 `lanIPv4Interfaces()` 某块网卡同一子网的（`isOnLanSubnet`），本机回环只在开发开关下；仍监听 0.0.0.0，不逐块网卡绑（地址会变）。
- **防火墙**：本机接口那条规则按程序放行 TCP（覆盖 IPP 端口，不限网段），UDP 5353 一条只在共享打开时加、只限 LocalSubnet（`firewallScript` 的 `discovery`；两个按钮加规则时都按共享开没开传，免得删掉它）；`check` 只看 TCP（旧安装不回退），`check-discovery` 看 UDP。任一边加了规则，两边都重新检查。
- **net/**：`http-listener.ts` 是本机接口和局域网共享共用的监听（端口回退、回环自检、重启时收尾）。

## 本地文字识别（`ocr/`）

设计见 `docs/superpowers/specs/2026-09-30-ocr-engine-design.md`（引擎）和 `2026-09-30-shelf-number-design.md`（货架号）。

- **读图**：`image-text-reader.ts` 不 import electron：JPEG 由 `nativeImage` 解成 BGRA（index.ts 注入），引擎第一次用到时创建、之后复用，有启用的「图中文字识别」步骤时启动后在后台预热。引擎加载失败就不再读（换档后重新试），并通知手机别再截图。ONNX Runtime 不用 CPU 内存池（arena）：每张图大小不同，内存池只涨不还。
- **加载扩展**：`ocr-engine.ts` 用 `process.dlopen` 按绝对路径加载，bundle 里不留对 `.node` 的 require；类型取自 `native/ocr/node`。
- **文件**：`ocr-files.ts`：安装版在 `resources/ocr/`（扩展、`models/<small|medium>/`），源码运行用 `native/ocr/node/bin` 的扩展和仓库的 `models/`（`bun run ocr:build`、`ocr:models`）。每档用哪两个模型见 `OCR_TIER_MODELS`（极速 small + small，精准 small 检测 + medium 识别）。缺文件时按「不能识别」处理，不报错。
- **换档**：设置项 `ocrModelTier` 变了时 `ImageTextReader.reset()` 放掉旧引擎（原生引擎的 `close()` 只放掉这边的引用，正在跑的识别各自持有，跑完才释放），再预热、告诉手机。
- **假 OCR**：`fake-ocr.ts`，环境变量 `CDL_LABELFLASH_FAKE_OCR`（字符串数组，只对未打包的程序生效），E2E 用。
- **要不要手机截图**：`mobile/image-request.ts`：有启用的这类步骤、这台电脑能识别时才要；规则改了、引擎坏了由 `MobileStation.rulesChanged` 重新告诉手机（没变不打扰）。

## 手机扫码（`mobile/`）

设计见 `docs/superpowers/specs/2026-09-29-mobile-scan-relay-design.md`，中转服务和扫码页在 `relay/`（见 `relay/CLAUDE.md`）。

- **分层**：都不 import electron，用 `bun test` 测试；`index.ts` 只负责创建 `MobileStation` 并接上设置变化、定时器和退出。
  - `mobile-session.ts`：会话规则（手机加入与移除、暂停加入、防重放、打印队列、任务去重、背压、到期），纯逻辑；
  - `mobile-host.ts`：编排（连接、加解密、按顺序执行任务），每条 Promise 链都接住异常；
  - `mobile-station.ts`：选中转地址、经 `PrintService` 打印（来源 `mobile`）、跟随设置变化；
  - `mobile-replies.ts`：发给手机的结果有长度上限，保证放得进一帧。
- **中转地址**：设置 `mobileRelayUrl` 优先，构建时注入的默认值（`build-defaults.ts`）兜底；规则在 `src/shared/relay-url.ts`。代码、测试里不写官方域名。
- **协议只有一份**：改消息时同时改 `src/shared/mobile-protocol.ts`、这里、`relay/web/src/phone-session.ts` 和设计文档第 5 节。
- **不播报手机的结果**：结果显示在手机上；电脑只刷新打印记录。

## 平台差异（Windows / macOS）

平台分支集中在少数几个文件里。新增平台相关的能力时，按下面的方式处理：

| 位置 | Windows | macOS |
|---|---|---|
| `index.ts` | 创建常驻探测进程，打印机状态轮询和异常通知都依赖它 | 不创建探测进程，状态按「未知」处理；开发版设置程序坞图标 |
| `printing/driver-paper.ts` | 读纸张：CIM（`parseCimPaper`）；打开设置：`rundll32 printui.dll` | 读纸张：`ipptool`（`parseIppPaper`）；打开设置：系统设置「打印机与扫描仪」 |
| `printing/raw-sender.ts` + `printer-identity.ts` | 原样发送：探测进程里 winspool RAW；驱动名：`Get-Printer` 的 DriverName | 原样发送：`lp -o raw`；驱动名：ipptool 的 `printer-make-and-model` |
| `window.ts` + `src/shared/window-chrome.ts` | 无边框窗口，按钮由界面自绘 | `titleBarStyle: 'hidden'`，保留系统红绿灯 |
| `tray.ts` | 第一次隐藏到托盘时弹气泡提示 | 不弹 |
| `secrets/` | DPAPI | 钥匙串 |
| `diagnosis/` | 探测进程的诊断查询；提权 PowerShell（UAC） | `lpstat`、`ipptool`、`system_profiler`；`osascript` 要管理员密码 |

- **解析和调用分开**：解析系统命令输出的函数写成纯函数，每个平台单独测试；调用系统命令的代码保持很薄。
- **不经过 shell**：系统命令一律用参数数组调用，打印机名只经参数或环境变量传入，并且必须是系统打印机列表里存在的打印机。
- **每个平台都有明确行为**：Windows 和 macOS 都要给出实现，或者明确返回「未知」且不阻止打印；其他平台返回 `null` 或拒绝。
- **状态检测**：macOS 的打印机状态检测计划改用 CUPS 的 `printer-state-reasons`，见 `docs/roadmap.md`。

## 打包相关

- **bundle 自包含**：`electron.vite.config.ts` 用 `externalizeDeps: false`，把依赖打进 bundle。
- **可选原生模块**：`bufferutil`、`utf-8-validate` 必须保持 external。如果被 Vite 换成空对象，WebSocket 发大于 48 字节的帧时会报错，语音合成就坏了。
- **检查**：新增依赖后跑 `bun run verify:bundle`。它确认 bundle 只引用 Electron 内置模块和这两个可选模块。
- **子进程入口**：读表格的子进程用 `?modulePath` 引入（electron-vite 单独打包），产物也在 `out/main/` 下，`verify:bundle` 一并检查。
