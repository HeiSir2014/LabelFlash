# src/main — Electron 主进程

主进程只做接线：Electron API、SQLite、系统命令、网络。业务规则留在 `src/core`。

## 可测试的写法

- **逻辑和接线分开**：能不依赖 Electron 的逻辑，单独放进不 import `electron` 的文件，用 `bun test` 测试。现成的例子：
  - `window-state.ts`、`window-bounds.ts`、`gpu-fallback.ts`、`context-menu.ts`
  - `log-files.ts`、`ipc-errors.ts`、`ipc-validators.ts`、`update-settings.ts`
  - `printing/printer-status.ts`
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
- **状态判定** `printer-status.ts`：只有驱动明确报告问题（离线、缺纸、卡纸……）才判定为不能打印；查询失败按「未知」处理，不阻止打印。
- **二维码** `qr-code.ts`：每个模块取整数个打印点（203dpi），边缘才清晰。

## 其他子系统

| 目录 / 文件 | 要点 |
|---|---|
| `scan/sandboxed-regex.ts` | 用户写的正则只在隔离上下文里执行，单条 20ms 超时 |
| `scan/http-step.ts` | HTTP 查询：`net.fetch`，结果短时缓存，请求头里的 `{密钥:名称}` 在这里替换成明文 |
| `secrets/` | `safeStorage` 加密（Windows 上是 DPAPI，macOS 上是钥匙串）。密钥明文不写日志、不导出、不回传给界面 |
| `notify/` | 打印结果通知：先写进本机队列（`webhook-outbox.ts`），后台发送并按退避策略重试，签名用 HMAC-SHA256 |
| `voice/` | 语音用 msedge-tts 合成，mp3 按「文本 + 音色 + 语速」缓存；断网时退回提示音 |
| `logging.ts` | 日志在数据目录的 `logs/labelflash-YYYY-MM-DD.log`，纯文本，时间带时区，保留 14 天；`console.*` 和界面的 console 都会写进去 |
| `updater.ts` + `update-settings.ts` | 自动更新，只有打包好的 Windows 版（macOS 的 pkg 没有开发者签名，装不了更新）。是否检查（`initialUpdateStatus`）和所有更新行为都在 `update-settings.ts` 里显式设置，不依赖库的默认值 |
| `window-placement.ts` | 按显示器记忆窗口位置。保存时扣掉 Windows 小数缩放下创建窗口的尺寸误差，否则窗口每次启动都会变大一点 |
| `security.ts`、`app-protocol.ts` | 拒绝导航、新窗口、重定向和 webview；只经 `app://bundle/` 提供界面文件 |
| `mobile/` | 手机扫码的电脑端，见下一节 |

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
