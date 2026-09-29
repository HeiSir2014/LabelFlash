# CLAUDE.md — CDL-云签速印（LabelFlash）

在这个仓库里工作的约定，写给 AI 助手，也写给开发者。通用的工作方式（测试先行、分阶段、同一问题三次不成就停下来重新想）以用户的全局 CLAUDE.md 为准，这里只写本项目特有的内容。各目录另有 CLAUDE.md，写各自的细节：

- `src/core/CLAUDE.md`：业务层
- `src/main/CLAUDE.md`：主进程
- `src/renderer/CLAUDE.md`：界面
- `resources/installer/CLAUDE.md`：安装包
- `relay/CLAUDE.md`：手机扫码的中转服务和扫码页

## 项目

样衣间「扫一张打一张」的桌面程序（Electron），支持 Windows 和 macOS。流程是：扫码枪扫二维码或条码 → 按识别规则拆出字段 → 加工步骤补字段 → 按模板生成 60×40mm 标签预览 → 静默打印到本机热敏标签机。

- **名称**：产品名「CDL-云签速印」，ASCII 名 `CDL-LabelFlash`，appId `com.cdl.labelflash`。品牌、出品方、店铺信息只从 `src/shared/brand.ts` 的 `BRAND` 取，不在别处硬编码。
- **版本**：第一个正式版本是 1.0.1。
- **语言**：界面、文档、注释用中文；代码标识符、测试名、提交信息用英文。

## 平台

| 能力 | Windows 10/11 x64 | macOS |
|---|---|---|
| 扫码、识别、预览、模板、打印记录、语音、通知、密钥 | ✅ | ✅ |
| 打印到本机打印机 | ✅ | ✅（家用打印机已实测出纸；热敏标签机待真机验证） |
| 驱动纸张检测、打开打印机设置 | ✅ 常驻 PowerShell 查询 CIM；驱动「打印首选项」 | ✅ `ipptool`；系统设置「打印机与扫描仪」 |
| 打印机状态检测与异常通知 | ✅ | 未做：状态按「未知」处理，不阻止打印；计划改用 CUPS 的 `printer-state-reasons` |
| 窗口按钮 | 自绘最小化 / 最大化 / 关闭 | 系统红绿灯；快捷键显示 ⌘ |
| 密钥加密 | DPAPI | 钥匙串 |
| 安装包与自动更新 | ✅ 自绘 NSIS 安装包、差分更新 | pkg 安装包（universal，ad-hoc 签名，未公证）；不自动更新，新版本到发布页下载 |

- **两个平台都要考虑**：写平台相关的代码时，Windows 和 macOS 都要给出行为，其他平台返回「不支持 / 未知」。
- **验证**：只在一个平台上验证过的改动，在提交说明或验收记录里写明。CI 在 Windows 和 macOS 上都跑 check 和 E2E；真机打印、系统缩放、扫码枪只能人工验证。

## 命令

| 命令 | 用途 |
|---|---|
| `bun install` | 安装依赖，同时下载 Electron 二进制 |
| `bun run dev` | 开发版（热更新） |
| `bun run check` | Biome + 五份 tsconfig（主进程与脚本、界面、E2E、中转服务、扫码页）的类型检查 + 全部单元测试 |
| `bun test <路径>` | 只跑某个单元测试文件 |
| `bun run test:e2e` | 构建 → 检查 bundle → Playwright 驱动构建版 Electron |
| `bun run dist:win` | Windows 安装包（两段构建，见 `resources/installer/CLAUDE.md`），输出到 `dist/` |
| `bun run dist:mac` | macOS 的 pkg 安装包（只能在 macOS 上打），输出到 `dist/` |
| `bun run installer:skin` | 只生成安装界面的皮肤，调界面时用 |
| `bun run icons` | 改了 `resources/*.svg` 后重新生成 PNG 图标 |
| `bun run relay:dev` | 本机构建并启动手机扫码的中转服务（http://localhost:3180） |
| `bun run test:relay-browser` | 用 Edge 的假摄像头跑一遍扫码页（需要本机有 Edge） |
| `bun run relay:deploy` | 发布中转服务，目标服务器从环境变量读取（见 `relay/README.md`） |

## 提交前必须通过

- 任何改动：`bun run check`。Biome 零问题，类型检查零错误，单元测试全过。
- 改了界面或主进程：再跑 `bun run test:e2e`。
- 改了打包或安装界面：`bun run dist:win`，并在 Windows 上实际装一次、更新一次、卸载一次；改了 macOS 打包：`bun run dist:mac`，在 Mac 上实际装一次、覆盖装一次。
- 改了扫码页或手机扫码协议：再跑 `bun run test:relay-browser`。
- 改了平台相关的代码（打印、窗口、托盘、快捷键、系统命令）：在 Windows 和 macOS 上各跑一次。

CI（GitHub Actions）会在 PR 和 `master` 上跑：windows-latest 上 check、E2E 和 `dist:win`；macos-latest 上 check、E2E 和 `dist:mac`。发布作业要求两个平台的检查都通过。

## 架构

```
src/core      业务层：纯 TypeScript，不依赖 Electron / Node / SQLite
src/shared    主进程和界面共用：IPC 契约、设置的校验、品牌、常量
src/main      Electron 主进程：窗口、app:// 协议、IPC、SQLite、打印、语音、密钥、通知、更新
src/preload   contextBridge，只暴露类型化 API
src/renderer  界面：React 19，MVVM（lib → view-models → components）
scripts       构建脚本（bundle 检查、图标、安装包、中转服务的构建与发布）
resources     图标、托盘图标、安装包资源
e2e           Playwright 端到端测试
relay         手机扫码：云端中转服务（Bun）和手机扫码页，单独部署，不进安装包
```

依赖方向：renderer → preload → main → core。shared 可以被任何一层引用，它自己只依赖 core。

- 界面只通过 `window.api` 调主进程。
- 主进程的业务都经过 core 的服务（`PrintService`、`TemplateCatalog`、`RuleCatalog` 等）。
- core 需要外部能力时定义接口，由主进程实现，测试里用 `src/core/testing` 的假实现。
- 手机扫码：电脑（`src/main/mobile/`）、中转服务（`relay/src/`）、扫码页（`relay/web/`）三方共用 `src/shared/` 里的协议、加密和重连代码；中转地址是设置项，代码里不写域名。

## 编码约定

- **注释**：写中文，解释为什么这样做、不这样会怎样，不复述代码。
- **常量**：不写魔法数字。数值起名成常量，名字带单位（`_MS`、`_SECONDS`、`_MM`），并写一句注释说明取值依据。
- **测试**：新功能、修 bug 都先写失败的测试。测试名用英文描述行为；纯逻辑放进可测的模块（core、`lib/`、主进程里不依赖 Electron 的文件）。
- **用词**：界面文字和播报用词保持一致，只说程序确知的事。例如驱动回调成功只代表任务进了打印队列，所以写「已发送打印」，不写「打印成功」。
- **出错**：不吞异常。主进程把错误和上下文写进日志，界面给出中文提示和下一步该怎么做。
- **依赖**：不随意引入新依赖，先用现有的：运行时有 electron-log、electron-updater、msedge-tts、qrcode；开发时有 sharp、Playwright、Biome，以及只打进手机扫码页的 zxing-wasm。

## 命名与措辞限制

- 仓库、代码、文档、提交信息里不出现任何参考产品或竞品的名称，统一写「参考产品」，也不写参考过哪些项目的代码。
- 打印机只写「热敏标签机」，不写品牌和型号。

## 数据与环境

| 位置 | 内容 |
|---|---|
| Windows：`%LOCALAPPDATA%\CDL-LabelFlash\`<br>macOS：`~/Library/Application Support/CDL-LabelFlash/` | 数据库 `labelflash.db`、日志 `logs/`、语音缓存 `voice-cache/` |
| Windows：`%LOCALAPPDATA%\Programs\CDL-LabelFlash\`<br>macOS：`/Applications/CDL-云签速印.app` | 安装目录（Windows 按当前用户安装，不需要管理员权限；macOS 的 pkg 装进「应用程序」，要输入管理员密码） |
| Windows：`%LOCALAPPDATA%\cdl-labelflash-updater\` | 自动更新缓存：本机安装包的副本（差分下载的底）和待安装的更新 |

数据目录的位置由 `src/main/index.ts` 决定：Windows 放 `LOCALAPPDATA`（本机目录，不进漫游配置），其他平台放系统的 `appData`。

- **隔离数据**：开发版和 E2E 用环境变量 `CDL_LABELFLASH_USER_DATA` 指向单独的数据目录。这个变量只对未打包的程序生效。
- **数据库迁移**：1.0.1 发布之前，表结构直接改在 `src/main/storage/migrations.ts` 的初始 schema 里，开发机删掉旧库即可。发布之后，已发布的迁移不能改，只能在末尾追加。
- **删除确认**：删除用户数据、安装目录或更新缓存之前，先征得用户同意。

## 安全底线

改动时不能破坏以下几条：

- 界面只经 `app://bundle/` 加载。开启 sandbox 和 contextIsolation，拒绝页面导航和新窗口，保留 CSP，所有权限请求一律拒绝。
- IPC 只接受主窗口主 frame 发来的消息，参数全部经过 `src/main/ipc-validators.ts` 校验。
- 密钥用 Electron `safeStorage` 加密保存，不写进日志，不随规则导出，也不回传给界面。
- 用户写的正则只在隔离上下文里执行，有超时。HTTP 查询和打印结果通知用 `net.fetch`。
- `electron-builder.yml` 里的 fuses 不放开。
- 主进程和 preload 的 bundle 必须自包含，安装包里没有 `node_modules`，由 `bun run verify:bundle` 把关。

## 打包、更新与发布

- **Windows 安装包**：自绘的圆形安装界面（nsNiuniuSkin 插件），由 `bun run dist:win` 分两段构建。不要直接运行 `electron-builder` 打 Windows 包，那样得到的是默认界面，也没有卸载程序。
- **macOS 安装包**：`bun run dist:mac` 打 pkg，装进「应用程序」，Apple 芯片和 Intel 共用（universal）。配置和取舍写在 `electron-builder.yml` 的 `mac`、`pkg` 两段。打完由 `scripts/mac/verify-package.ts` 核对签名完好且是 ad-hoc、程序同时有 x86_64 和 arm64、pkg 装进 `/Applications`，不通过就算打包失败。
  - 还没有 Apple 开发者证书：程序是 ad-hoc 签名，安装包没有签名、没有公证，下载后第一次打开要在「系统设置 → 隐私与安全性」里点「仍要打开」。
  - 不能自动更新（Squirrel.Mac 要校验签名），程序里不检查更新，「关于」提示到发布页下载。有了证书之后再做签名、公证和自动更新。
- **自动更新**：只有 Windows 版。electron-updater 从 GitHub Releases 下载，支持 blockmap 差分下载。启动时是否检查、所有更新行为都在 `src/main/update-settings.ts` 里显式设置。
- **发版步骤**：
  1. 改 `package.json` 的 `version`，经 PR 合进 `master`。
  2. 在 `master` 的提交上打同名标签（例如 `v1.0.1`）并推送，CI 的 release 作业负责发布。
  3. release 作业先检查三件事，不符合就不发布：标签所在的提交在 `master` 上；标签和 `version` 一致（客户端按版本号比较，并按文件名里的版本号去找旧版的 blockmap）；设置了仓库的 Actions 变量 `LABELFLASH_DEFAULT_RELAY_URL`（官方安装包的默认中转地址，构建时注入，代码里不写域名）。
  4. Release 先建成草稿，Windows 和 macOS 各自上传，核对 Windows 安装包、blockmap、`latest.yml` 和 macOS 的 pkg 四个文件都在，才公开。
- **标签要等确认**：打版本标签前先得到用户确认。

## Windows 上开发的坑

- **Git Bash 改写参数**：Git Bash 会把以 `/` 开头的参数改写成路径（例如 `/S`、`/D=…`）。调用 Windows 程序时加上 `MSYS_NO_PATHCONV=1`。
- **SQLite 文件占用**：Bun on Windows 的 `node:sqlite` 在关闭连接后仍占用文件（oven-sh/bun#40001）。测试的临时目录用 `src/main/storage/testing/temp-dir.ts` 创建和删除。
- **E2E 启动方式**：E2E 从项目根目录启动 Electron（它按 `package.json` 的 `main` 找入口）。直接传 `out/main/index.js` 的话，`app.getVersion()` 拿到的是 Electron 自己的版本。
- **界面调试**：开发版用 `npx electron-vite dev --remoteDebuggingPort 9333` 启动，再用 CDP 连接 `http://127.0.0.1:9333` 检查界面。安装版也可以加 `--remote-debugging-port=<端口>` 启动，fuses 只禁了 Node 调试。
- **自动化点击**：同一位置叠着几个窗口时，截图和点击会落到最上面那个。自动化测试前先关掉上一轮留下的程序和安装窗口。

## macOS 上开发

- **命令**：和 Windows 相同：`bun install`、`bun run dev`、`bun run check`、`bun run test:e2e`。`dist:win` 只能在 Windows 上跑，`dist:mac` 只能在 macOS 上跑。
- **程序坞图标**：开发版里用 `app.dock.setIcon` 显示应用图标；安装版的图标由打包配置决定。
- **窗口按钮**：标题栏左侧留给系统红绿灯（`--traffic-light-inset`）。改标题栏时，macOS 上要核对红绿灯区域和全屏状态。
- **打印验证**：打印功能可以先用家用打印机验证出纸。接上热敏标签机后，要查看 CUPS 任务的纸张是不是 60×40。

## 文档

| 文档 | 内容 |
|---|---|
| `docs/superpowers/specs/` | 设计：总设计、通用识别规则、工作台与配置中心、手机扫码打印 |
| `docs/superpowers/plans/` | 实施计划 |
| `docs/roadmap.md` | 路线图 |
| `docs/windows-acceptance.md` | Windows 验收记录 |

- 设计变了，同步改对应的设计文档。
- 在 Windows 上实测的结果写进 `docs/windows-acceptance.md`。
- macOS 的适配进度记在 `docs/roadmap.md`。

## Git

- 在功能分支上开发，通过 PR 合并到 `master`，不直接推 `master`。
- 提交信息用英文 Conventional Commits：`type(scope): 摘要`，正文写为什么改。
- 一个提交只做一件事，每个提交都能通过 `bun run check`。
- 不用 `--no-verify` 跳过钩子。
