# src/main — Electron 主进程

主进程只做接线：Electron API、SQLite、系统命令、网络。业务规则留在 `src/core`。

## 可测试的写法

- **逻辑和接线分开**：能不依赖 Electron 的逻辑，单独放进不 import `electron` 的文件，用 `bun test` 测试。现成的例子：
  - `window-state.ts`、`window-bounds.ts`、`gpu-fallback.ts`、`context-menu.ts`
  - `log-files.ts`、`ipc-errors.ts`、`ipc-validators.ts`、`update-settings.ts`
  - `printing/printer-status.ts`、`printing/printer-profiles.ts`、`printing/page-size.ts`、`printing/fake-printers.ts`
  - `mobile/` 整个目录
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
- **打印机探测** `printer-probe-host.ts`（只在 Windows 上）：常驻一个 PowerShell 进程，用行协议查询打印机状态和驱动纸张。
  - 打印机名用 base64 编码后传入，并转义通配符。
  - 不要改成每次查询都新启动一个 PowerShell：启动一次约耗 1 秒 CPU。
- **状态判定** `printer-status.ts`：检测所有被分配到的打印机（纸张分配和模板指定里出现的），每轮重新取名单；只有驱动明确报告问题（离线、缺纸、卡纸……）才判定为不能打印；查询失败按「未知」处理，不阻止打印。异常通知按「打印机 + 问题」限频。
- **面单** `waybill-html.ts`：按 core 的 `layoutWaybill` 结果画绝对定位的格子和线；条码 `code128.ts`（自己实现，B / C 子集、校验位），每个模块取整数个点、两侧留 10 个模块空白，放不下或内容不能编码时不印并在 `RenderWarnings` 里说明。`label-html.ts` 的 `renderLabelHtml` 按模板的 `kind` 分派，标签和面单共用打印、预览、PDF 的入口。
- **二维码** `qr-code.ts`：每个模块取整数个打印点（按打印机的分辨率，读不到按 203dpi），边缘才清晰；模块的最小、最大尺寸按毫米定，分辨率高的打印机不会把二维码打得更小。
- **打印机资料** `printer-profiles.ts`：每台打印机的驱动纸张和分辨率，缓存 1 分钟；打印时最多等 1 秒，等不到按 203dpi；打开「打印首选项」后丢掉那一台的缓存。
- **页面尺寸** `page-size.ts`：按模板的纸张算 `webContents.print` 的 pageSize。
- **决定打印机**：规则在 core 的 `printing/resolve-printer.ts`，主进程只提供本机打印机列表（`PrinterDriver.knownPrinterNames`）。读打印机列表要用主窗口，启动时窗口还没建好，检测和预读在窗口建好之后再做。
- **假打印机** `fake-printers.ts`：环境变量 `CDL_LABELFLASH_FAKE_PRINTERS`（只对未打包的程序生效）换掉适配器、驱动纸张查询和状态探测，E2E 和视觉验收用。

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
| `window.ts` + `src/shared/window-chrome.ts` | 无边框窗口，按钮由界面自绘 | `titleBarStyle: 'hidden'`，保留系统红绿灯 |
| `tray.ts` | 第一次隐藏到托盘时弹气泡提示 | 不弹 |
| `secrets/` | DPAPI | 钥匙串 |

- **解析和调用分开**：解析系统命令输出的函数写成纯函数，每个平台单独测试；调用系统命令的代码保持很薄。
- **不经过 shell**：系统命令一律用参数数组调用，打印机名只经参数或环境变量传入，并且必须是系统打印机列表里存在的打印机。
- **每个平台都有明确行为**：Windows 和 macOS 都要给出实现，或者明确返回「未知」且不阻止打印；其他平台返回 `null` 或拒绝。
- **状态检测**：macOS 的打印机状态检测计划改用 CUPS 的 `printer-state-reasons`，见 `docs/roadmap.md`。

## 打包相关

- **bundle 自包含**：`electron.vite.config.ts` 用 `externalizeDeps: false`，把依赖打进 bundle。
- **可选原生模块**：`bufferutil`、`utf-8-validate` 必须保持 external。如果被 Vite 换成空对象，WebSocket 发大于 48 字节的帧时会报错，语音合成就坏了。
- **检查**：新增依赖后跑 `bun run verify:bundle`。它确认 bundle 只引用 Electron 内置模块和这两个可选模块。
