# 云签速印 (LabelFlash) — 设计文档

- 日期：2026-09-28
- 状态：待评审
- 包名：`label-flash`，appId：`com.labelflash.app`

## 1. 目标

Windows PC 上运行的 Electron 桌面程序。它把本机已安装的标签打印机共享到局域网，支持两种入口扫描样衣标签上的二维码，按原样重新生成标签并自动打印：

1. **PC 本地**：用扫码枪在主界面的输入框里扫码，扫码枪自动回车后立即打印。
2. **手机**：扫描 PC 上显示的二维码，或手动输入局域网地址，打开网页后用摄像头连续扫码打印。

两个入口共享同一套**防重门限**，防止同一张二维码被重复打印。

### 分期

| 阶段 | 范围 |
|---|---|
| **Phase 1（当前）** | Windows 本地客户端：扫码枪输入 → 解析 → 门限 → 静默打印；打印机管理、门限设置、打印日志、托盘常驻、NSIS 安装包。涉及 §2–§5、§8（不含手机访问区）、§9（不含防火墙规则）、§11 |
| Phase 2 | 手机端：HTTPS 服务、自签证书、token/PIN 认证、手机扫码 SPA。涉及 §6 手机部分、§7、§12 的 iOS spike |

Phase 1 仍然按 `PrintService` 边界来设计，Phase 2 只需要新增 `server/`、`net/`、`mobile/`，不改 `core/`。

### 非目标（YAGNI）

- 库位字段（原标签上的 `A-1-2-3`）不打印
- 可视化模板编辑器、多模板
- 账号体系、云同步
- RAW TSPL/ZPL 指令打印（只预留接口，不实现）
- 普通办公打印机的 A4 排版

## 2. 输入数据

二维码内容示例：`CL5640-TK-图片色-36`（已从样例图片解码确认）。

- 格式：`<编码>-<颜色>-<尺码>`。编码本身可能包含 `-`，所以**从右往左拆**。
- 解析正则：`^(.+)-([^-]+)-([^-]+)$` → `{ code: "CL5640-TK", color: "图片色", size: "36" }`
- 校验：先 trim；总长 1–128；三个字段都不能为空；不能包含控制字符。不通过则拒绝打印，并返回 `INVALID_FORMAT`。
- 去重 key：trim 之后的原始字符串（区分大小写）。

## 3. 打印方案

**采用：打印机驱动 + HTML 渲染。**

隐藏的 `BrowserWindow` 加载标签 HTML（二维码由 `qrcode` 库生成 SVG），然后调用：

```ts
webContents.print({
  silent: true,
  deviceName,
  pageSize: { width: 60_000, height: 40_000 }, // 单位为微米
  margins: { marginType: 'none' },
  printBackground: true,
});
```

- 理由：中文字体不用额外处理；任何装了 Windows 驱动的热敏标签机都能用；模板就是 HTML/CSS，方便修改。
- 扩展：通过 `PrinterAdapter` 接口隔离，以后可以加 `TsplRawAdapter`。
- 打印机列表来自 `webContents.getPrintersAsync()`。

### 标签模板（60×40mm）

复刻原标签，但去掉库位：

```
┌──────────────────────────────────┐
│ ┌────────┐  编码：CL5640-TK       │
│ │ QR 码  │  颜色：图片色           │
│ │ ~30mm  │  尺码：36              │
│ └────────┘                        │
│ CL5640-TK-图片色-36               │
└──────────────────────────────────┘
```

- 二维码内容 = 原始字符串，纠错级别 M。
- 字体用粗体黑体（`Microsoft YaHei` Bold / `SimHei`），针对 203dpi 热敏打印；只用纯黑，不用灰阶。
- 所有文本都经过 HTML 转义后再插入模板。

## 4. 架构

```
src/
├── core/                  业务层：纯 TS，不依赖 Electron 和 UI，可以直接 bun test
│   ├── types.ts             LabelData / PrintRequest / PrintResult / PrinterAdapter / Clock …
│   ├── errors.ts            PrintError（带失败原因）
│   ├── label-parser.ts      解析和校验二维码内容
│   ├── dedup-guard.ts       时间窗口门限：peek / 检查并占位 / 提交 / 释放
│   ├── serial-queue.ts      Promise 串行队列
│   ├── print-queue.ts       每台打印机一个串行队列，单任务超时 30s
│   ├── job-store.ts         JobStore 接口 + 内存实现
│   └── print-service.ts     对外唯一入口：preview(raw) / submit(request) / printTest(printer)
├── shared/                主进程与界面共用：IPC 契约、设置类型与校验
├── main/                  Electron 主进程
│   ├── printing/
│   │   ├── label-template.ts           生成标签 HTML（打印和预览共用）
│   │   └── electron-driver-adapter.ts  隐藏窗口渲染并静默打印
│   ├── storage/jsonl-job-store.ts      JSONL 追加写（无原生模块）
│   ├── settings-store.ts               %APPDATA%\LabelFlash\settings.json
│   ├── window.ts / tray.ts / ipc.ts / index.ts
│   ├── server/ net/                    （Phase 2）HTTPS 服务、局域网地址、自签证书
├── preload/index.ts       contextBridge 暴露类型化 API
├── renderer/              PC 界面（React，MVVM：view-model hooks + 纯视图）
└── mobile/                （Phase 2）手机 SPA
```

**依赖方向**：`renderer`、`mobile` 和 `server` 只通过 `PrintService` 使用业务功能；`core` 不引用 Electron、Fastify 或 Node 文件系统。

### 核心接口

```ts
type PrintSource = 'desktop' | 'mobile';

interface PrintRequest {
  raw: string;          // 二维码原文
  printerName: string;
  source: PrintSource;
  force?: boolean;      // 强制补打，跳过门限
}

type PrintResult =
  | { status: 'printed'; jobId: string; label: LabelData }
  | { status: 'duplicate'; lastPrintedAt: number; windowMs: number }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' }
  | { status: 'failed'; reason: 'PRINTER_NOT_FOUND' | 'PRINT_TIMEOUT' | 'PRINT_ERROR' };

type PreviewResult =
  | { status: 'ok'; label: LabelData; lastPrintedAt: number | null } // lastPrintedAt 非空表示在门限窗口内
  | { status: 'invalid'; reason: 'INVALID_FORMAT' };

interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  print(printerName: string, label: LabelData): Promise<void>;
}
```

## 5. 防重门限

**两层：**

1. **客户端去抖**（只为体验，不作为判定依据）
   - 手机摄像头：同一个码 3 秒内只提交一次（每帧都可能重复识别）。
   - PC 输入框：同一个码 1 秒内只提交一次（扫码枪可能连击）。
2. **服务端门限**（权威判定，位于 `DedupGuard`）
   - 默认窗口 **10 分钟**，在 PC 设置里可调（范围 0–1440 分钟，0 表示关闭）。
   - `submit` 按以下顺序**同步执行**：解析 → `tryReserve(key)` → 入队。Node 单线程，所以多台设备同时扫同一个码时只有一个能占位成功，其余都返回 `duplicate`。
   - key 已占位（正在打印）或上次成功打印距今不到窗口时长，都返回 `duplicate`。
   - 打印成功：`commit(key, now)` 并持久化。
   - 打印失败：`release(key)`，允许立即重试。
   - `force: true`：跳过检查，打印成功后刷新时间戳；日志里标记为强制补打。
   - 启动时从打印记录（JSONL）回放最近 24 小时的成功打印，重启后窗口仍然有效。时钟通过 `Clock` 接口注入，方便测试。
   - `peek(key)` 只读查询，供预览显示"窗口内已打印过"的提示，不占位。

## 6. 数据流

**PC 扫码枪：**
输入框（常驻焦点，焦点落到空白处 300ms 后自动拉回）→ 回车 → 清空输入框 → `window.api.preview(raw)` → **立即显示标签预览**（与实际打印同一份 HTML）：
- **自动打印（勾选）**：预览出来的同时调用 `window.api.print(raw, printer)`，结果以状态条 + 提示音反馈（成功 / 重复 / 失败三种声音）。
- **手动打印（不勾选）**：只预览；如果门限窗口内已经打印过，预览上会显示"x 分钟前已打印"。操作员点"打印"按钮（或按 F2）才提交；提交时仍然经过门限。
- 两种模式下，`duplicate` 结果都提供"强制补打"（需二次确认）。
- 自动/手动的选择持久化到设置。

**手机：**
打开页面 → 用 token 认证 → 选择打印机（记在 localStorage）→ 摄像头连续扫码（`barcode-detector` polyfill：Android Chrome 走原生 API，iOS 走 zxing-wasm），或在手动输入框提交 → `POST /api/print` → 结果以全屏色块 + 振动 + 声音反馈；如果是 `duplicate`，显示上次打印时间和"强制补打"按钮（需二次确认）。

### HTTP API（仅 HTTPS，默认端口 8443）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth` | `{ pin }` → 设置 HttpOnly cookie |
| GET | `/api/printers` | 返回 PC 端已启用的打印机 |
| POST | `/api/print` | `{ raw, printerName, force? }` → `PrintResult` |
| GET | `/api/jobs?limit=20` | 本设备最近的打印记录 |

- 所有请求体都用 JSON Schema 校验（Fastify 内置），`raw` 最长 128。
- 错误响应不暴露堆栈和内部路径。

## 7. 安全

- 服务监听 `0.0.0.0:8443`，只接受来源为私有网段（RFC1918 + 链路本地地址）的请求。
- **访问令牌**：启动时生成一个随机 token，嵌入 PC 界面上的二维码 URL（`?t=`），扫码访问会自动认证；手动输入地址的，需要输入 PC 界面上显示的 6 位 PIN。认证成功后写入 HttpOnly + Secure + SameSite=Strict 的 cookie。PC 端可以一键重置 token 和 PIN，让所有已连接设备失效。
- PIN 连续错误 5 次，锁定该 IP 1 分钟。
- Electron：`contextIsolation: true`，`nodeIntegration: false`，`sandbox: true`；打印窗口不加载任何远程内容。

## 8. PC 界面

- **窗口**：无系统边框（`frame: false`），自绘标题栏：可拖拽区域、应用名、当前打印机胶囊、最小化 / 最大化 / 关闭按钮。关闭 = 隐藏到托盘；最小尺寸 960×640。
- **扫码区**：大号扫码输入框 + "自动打印"开关。
- **预览区**：标签按实物比例渲染（60×40mm），状态条显示本次结果；手动模式下有"打印"按钮。
- **打印机列表**：本机打印机可能很多（申通、标签、德邦、Qirui QR-488、HPRT N31C …）。列表支持搜索过滤、滚动；点选即设为当前打印机；每项有"打印测试页"；当前打印机不在系统里时显示警示。
- **设置**：门限窗口（分钟）、开机自启。（Phase 2 再加：端口、重置 token/PIN、手机访问二维码）
- **打印记录**：最近 200 条（时间、来源、内容、打印机、结果），可以按内容搜索。

### 持久化

`userData` 显式设为 `%APPDATA%\LabelFlash`（英文路径，避开中文目录问题）：
- `settings.json`：`selectedPrinter`、`autoPrint`、`dedupWindowMinutes`、`launchAtLogin`
- `jobs.jsonl`：打印记录

### 视觉方向

主题取自样衣间的**软尺**和**热敏标签**：
- **配色**：
  - 机壳灰 `#E4E7E2`（背景）
  - 纸白 `#FBFBF8`（面板和标签）
  - 墨黑 `#18211E`（文字、标题栏）
  - 软尺黄 `#F2C12E`（品牌强调、刻度）
  - 状态色三种：成功绿 `#1F8A5B`、重复橙 `#E0752D`、失败红 `#C8372D`
- **字体**：
  - 标题和大字状态：得意黑 Smiley Sans（OFL，随包内置）
  - 正文：`Microsoft YaHei UI`
  - 编码等数据：`Cascadia Mono` / `Consolas`
- **标志元素**：预览区是一段"软尺"。标签四周是黄底毫米刻度尺（上边 60mm、左边 40mm，每 10mm 标数字），直观表明这是实物尺寸的 60×40 标签。
- **唯一动效**：每次新的预览像热敏纸出纸一样，从上方滑入（180ms）；系统开启"减少动态效果"时关闭。
- 其余元素保持克制：键盘焦点清晰可见；状态靠颜色 + 文字 + 声音三重反馈，远处也能看清。

## 9. 部署（Windows）

- 用 electron-builder 打 NSIS 安装包（x64）。安装时执行 `netsh advfirewall firewall add rule` 放行 8443 入站，卸载时删除。
- 窗口关闭时最小化到托盘，服务继续运行。
- 无原生模块依赖，不需要 electron-rebuild。

## 10. 技术栈

| 用途 | 选型 |
|---|---|
| 包管理 / 测试 | Bun（`bun install`、`bun test`） |
| 构建 | electron-vite |
| 打包 | electron-builder（NSIS） |
| 语言 | TypeScript strict |
| 服务端 | Fastify + @fastify/static + @fastify/cookie |
| 存储 | JSONL 文件（超过 5000 行时压缩为最近 2000 行） |
| 二维码生成 | qrcode |
| 手机扫码 | barcode-detector（zxing-wasm polyfill） |
| 自签证书 | selfsigned |
| PC 界面 | React 19 + 纯 CSS（设计 token） |

## 11. 测试

- **单元测试（bun test，`core/`）**：
  - 解析：正常值、编码含多个 `-`、缺少字段、超长、控制字符、首尾空白
  - 门限：窗口内拦截、窗口外放行、并发占位只成功一次、失败后释放、force 跳过、窗口为 0 时关闭门限
  - 打印队列：串行执行、超时、单任务失败不影响后续任务
- **集成测试**：Fastify `inject` 测路由（认证、参数校验、结果映射），打印部分用 FakePrinterAdapter。
- **真机验证（Windows + 标签机）**：60×40mm 版面对齐、字迹清晰度、手机扫码到出纸的端到端耗时（目标 < 2s）。

## 12. 风险与首个 Spike

| 风险 | 应对 |
|---|---|
| iOS Safari 接受自签证书后，`getUserMedia` 可能仍被禁用 | **第一步做 spike 验证**；如果不行，改为提供"安装本地 CA 描述文件"的引导 |
| 标签机驱动的默认纸张与 60×40 不一致，导致缩放或分页 | 打印测试页 + 引导用户在驱动里设置纸张；`pageSize` 显式传入 |
| Windows 防火墙拦截入站 | 安装包自动添加防火墙规则；PC 界面检测到无法访问时给出提示 |
| 多网卡、虚拟网卡导致二维码地址不对 | 过滤虚拟网卡，并列出全部地址供用户选择 |
