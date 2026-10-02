# 驱动安装（子项目 5c，在线签名清单）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配置中心「打印机」页加「驱动」一节：发现这台电脑上没有可用驱动的 USB 打印设备，按 USB 厂商号 / 产品号在**在线驱动清单**里找到型号，下载厂家官方安装包，核对大小、SHA-256 和数字签名者，弹一次管理员权限静默安装，再重新列打印机、提示给新打印机分配纸张。清单本身用 Ed25519 签名，程序内置公钥核对；清单地址是设置项，官方安装包构建时注入默认值（和中转地址一样），开源 / 自己构建的版本没有默认值时显示「未配置驱动清单地址」。清单里没有的型号给出「用系统自带的通用驱动」或「到厂家官网下载」的指引。同时给 5a（指令集「自动」）和 5b（诊断里的「重新安装驱动」）提供按驱动名查清单的接口。

**Architecture:** core 放纯逻辑：USB 编号解析、清单模型和严格校验（`sanitizeCatalog`）、防回滚和过期判断、按平台选安装方式、安装流程状态机 `runDriverInstall`（下载 → 核对 → 提权安装 → 找新打印机，下载器、签名核对、提权安装、列打印机都经接口注入）。主进程 `drivers/`：清单信封的签名核对（`node:crypto` 的 Ed25519）、清单下载与本机记录（最高版本号和上次的清单存在 settings 表的独立键里，界面改不到）、安装包下载（`net.fetch` 流式写临时文件、边下边算 SHA-256、大小上限、空闲和总超时）、各平台的设备检测 / 签名核对 / 提权安装（系统命令的解析都是纯函数），`DriverStation` 编排并把状态推给界面；E2E 用 `CDL_LABELFLASH_FAKE_DRIVERS` 换掉设备检测、安装包下载、签名核对和提权安装（只对未打包的程序生效），清单仍从本机 HTTP 服务真实下载、真实验签（测试公钥经 `CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY` 注入，同样只对未打包的程序生效）。界面在打印机页加一张「驱动」卡片，清单地址的设置也在这里。脚本 `scripts/driver-catalog/` 生成密钥、签清单、读安装包信息。

**Tech Stack:** TypeScript、Bun test、Electron 主进程（`net.fetch`、`node:crypto` Ed25519、`child_process.execFile`）、PowerShell（CIM、Authenticode、`Start-Process -Verb RunAs`）、macOS `system_profiler` / `lpstat` / `pkgutil` / `osascript`、React 19、Playwright E2E。**不新增依赖**。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.3 节（本计划的范围），7.1 / 7.2（5a、5b 的接入点），第 9–11 节（出错和安全、测试、工程规范）。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- **分支**：实施顺序 1 → 3 批量 → 2 模板库 → 4 PDF → 5a 指令 → 5b 诊断 → **5c 本计划** → 6a IPP → 6b 远程。5b 合进 master 之后从 master 拉 `feature/driver-install`。视觉验收项固定用 **V87–V89**，追加在 `e2e/visual/acceptance.visual.ts` 当时最后一项之后。
- **不需要数据库迁移**：清单的本机记录和窗口位置一样存在 `settings` 表的独立键里（`SqliteSettingsStore` 只读写已知的设置字段，界面的 `updateSettings` 改不到它）。如果实施时发现必须加表，迁移号用「实施时的下一个空号」，只在末尾追加。
- **命名限制**：仓库里不写任何打印机品牌、型号、厂家网址和清单服务器的域名。测试和文档的示例一律用「示例品牌」「示例型号 X1」和 `https://example.invalid/…`；界面和文档里打印机只说「热敏标签机」。
- **名词**：界面说「驱动已装好」（安装程序退出码表示成功），不说「打印机可以用了」（要等系统建好打印机、操作员分配纸张）。
- **删除**：安装包是本程序自己在系统临时目录下建的临时文件，装完（成功或失败）都删掉；项目「删除前先征得同意」的规则针对用户数据、安装目录和更新缓存，不包括这里。

## 关键决定（实施前请留意）

| 决定 | 取舍 |
|---|---|
| **签名格式：信封（一个文件）** `{ format, keyId, payload: base64(清单 JSON 原文), signature: base64(Ed25519) }`，签名覆盖「用途前缀 `CDL-LabelFlash driver catalog v1\n` + payload 原始字节」 | 一个文件上传是原子的，不会出现 CDN 上清单和 `.sig` 不是同一版；签的是原始字节，不用规范化 JSON；用途前缀让同一把私钥签的别的东西不能被挪用成清单；`keyId` 让换密钥时新旧公钥可以并存 |
| **公钥在仓库里**（`src/shared/driver-catalog-keys.ts`，可以有多把） | 公钥不是秘密、不是域名，放仓库可审计；fork 用自己的清单就换成自己的公钥。私钥只在出品方手里，离线保存 |
| **防回滚**：版本号 = 签名时刻的 Unix 秒数（脚本自动填，不靠手工递增），程序记住用过的最高版本，低于它的不用；`expiresAt`（默认签发后 180 天，最长 400 天）过期不用 | 防止拿旧清单（可能含已撤下的驱动）重放；电脑时间错时提示里同时给出电脑时间和有效期 |
| **清单在程序里的处理**：先只解析信封（大小上限 2MB）→ 验签 → 再解析清单 → 严格校验；单个型号不合格就跳过并写日志，`schema` 比程序新则整份不用并提示更新 | 主进程里解析（TypeScript，内存安全）、处处有上限，符合 Rule of 2；旧版程序遇到新增字段的型号只跳过那一条，不至于整份清单都用不了 |
| **签名脚本严格**：任何一个型号不合格就不签 | 出错在出品方签名时暴露，而不是装到用户电脑上才发现 |
| **托管：中转服务所在服务器的 nginx 直接放静态文件**，不经中转服务 | 中转服务只转发、不写磁盘、不做业务判断（`relay/CLAUDE.md`）；静态文件由 nginx 原样提供，更新清单只是上传一个文件，不用重新部署中转服务。具体服务器配置不进仓库，文档只写通用做法 |
| **Windows 检测**：一次性 PowerShell 查 `Win32_PnPEntity`（`ConfigManagerErrorCode <> 0` 且是 `USB\VID_*` / `USBPRINT\*`），`USBPRINT` 子设备经 `Get-PnpDeviceProperty DEVPKEY_Device_Parent` 找到 USB 父设备取 VID/PID | `Get-PnpDevice` 本身就是 `Win32_PnPEntity` 的包装，CIM 能在服务端按问题代码过滤；只在操作员打开「驱动」一节或点「重新检测」时跑，不放进常驻探测进程（一次要 1–3 秒，会拖住打印机状态轮询） |
| **列哪些设备**：系统认得出是打印设备的（`PNPClass = Printer`、`USBPRINT\`、兼容 ID 含 `USB\Class_07`），加上清单里有的 VID/PID（厂商自定义类的标签机） | 没装驱动的标签机常是厂商自定义类（`FF`），只能靠清单认；不认识的其他 USB 设备不列，免得把 U 盘、扫码枪当成打印机 |
| **执行的字节 = 清单钉住的字节**：普通权限下先核对大小、SHA-256 和 Authenticode（状态 Valid 且签名者 Subject 与清单逐字相同）；提权脚本把文件复制进只有 Administrators / SYSTEM 能写的新目录（创建时就带 ACL），在那里**再算一次 SHA-256**，一致才运行 | 普通权限下核对完到提权运行之间，同一用户的其他程序可能换掉临时文件；在管理员专属目录里复核哈希，保证运行的就是清单签过的那份。Authenticode 是纵深防御（防清单作者填错哈希）。提权脚本只用 .NET 类型（`[IO.File]`、`[Security.Cryptography.SHA256]`、`[Diagnostics.Process]`、`[Environment]::SystemDirectory`），不调用可能被用户目录里的同名模块冒充的 cmdlet |
| **Windows 提权**：和防火墙一样，外层 PowerShell `Start-Process <系统 PowerShell> -Verb RunAs -Wait -PassThru -EncodedCommand <提权脚本>`；提权脚本自己的退出码取 `0x4C46xxxx`（不和安装程序、msiexec 的退出码撞）；用户点「否」由外层识别 Win32 错误 1223 | 一次 UAC；不经过命令行转义（整段 Base64）；超时 15 分钟后提权进程收不回来，只提示等它装完再「重新检测」 |
| **静默参数白名单**：每个参数 `^[A-Za-z0-9_./:=+-]{1,64}$`，最多 8 个 | 参数不能带空格、引号、`&|;<>%^` 和反斜杠，拼进命令行也不会变成别的命令；需要路径的写法（例如 NSIS 的 `/D=`）不支持，用安装程序的默认目录 |
| **macOS 安装**：清单有 pkg 就下载、核对 SHA-256 和 `pkgutil --check-signature`（Apple 签发的开发者证书、叶证书名与清单逐字相同），再用 `osascript … do shell script … with administrator privileges` 运行固定的 sh 脚本：以 root 在 `mktemp -d` 新目录（root 专属）里复制、复核 SHA-256、`/usr/sbin/installer -pkg … -target /`；没有 pkg 就 `shell.openExternal` 打开清单里的 https 下载页 | Electron 没有提权执行的接口；`AuthorizationExecuteWithPrivileges` 已废弃，`SMJobBless` 要正式签名的辅助程序（我们是 ad-hoc 签名）；`osascript` 弹的是系统标准的管理员密码框。路径和哈希经 `on run argv` 传入、`quoted form of` 转义，不拼进 AppleScript 字符串 |
| **macOS 检测**：`system_profiler -json SPUSBDataType SPUSBHostDataType` 列 USB 设备，`lpstat -v` 列 CUPS 的 `usb://` 队列；只列「清单里有、但按序列号 / 型号名找不到队列」的设备 | macOS 没有「问题代码」；没装驱动的标签机不会有队列。清单里没有的型号在 macOS 上认不出来，界面写明 |
| **装完怎么分配纸张**：重新列打印机（每 2 秒一次、最多 30 秒）找出新打印机，提示「到上面「纸张 → 打印机」给它分配纸张」；打印机页刷新后，驱动纸张和某种纸一致时已有的「建议：…」按钮会出现 | 设计文档写「自动按纸张建议分配」；打印机页现有规则是「只建议，不自动分配（驱动纸张可能只是出厂默认值）」，这里沿用现有规则。**需要用户确认**是否要改成自动分配 |

## 给 5a、5b 的接口约定

5a、5b 在本计划之前实施。为了不让它们等本计划，接口文件 `src/core/drivers/driver-hints.ts` 的内容固定如下（原文在 Task 1 Step 3）：5a、5b 先实施时**原样建这个文件**，主进程先传 `NO_DRIVER_HINTS`；本计划 Task 1 / Task 2 发现文件已存在时只核对内容一致。

- `CATALOG_COMMAND_SETS` / `CatalogCommandSet`：`'tspl' | 'zpl' | 'epl'`。
- `DriverHints.modelForDriverName(driverName)`：按系统里的驱动名（Windows 的 `Get-Printer` `DriverName`、macOS 的 `printer-make-and-model`，不分大小写、忽略多余空白）查清单，返回 `{ modelId, brand, model, commandSet, canInstall } | null`。清单没配置、下载不到、过期时一律 `null`。
- **5a**：「自动」猜指令集的函数收一个 `() => DriverHints`，先用 `hints().modelForDriverName(驱动名)?.commandSet`，为 `null` 再按驱动名关键字猜。
- **5b**：诊断结果的「重新安装驱动」修复按 `hints().modelForDriverName(驱动名)?.canInstall` 决定显不显示（先恒为 `false`）；按钮调用 IPC `drivers:reinstall-for-printer`（本计划 Task 17 加，`window.api.reinstallPrinterDriver(printerName)`），进度显示在同一页的「驱动」一节。
- 5a 若已有按打印机读驱动名的函数（它的「按驱动名猜」需要），Task 17 直接复用；没有就按 Task 17 加。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `src/core/drivers/usb-id.ts` | 新建 | `UsbId`、Windows 实例路径和十六进制解析、显示格式 |
| `src/core/drivers/driver-hints.ts` | 新建（5a/5b 可能已建） | 给 5a、5b 的接口：`DriverHints`、`NO_DRIVER_HINTS`、指令集 |
| `src/core/drivers/catalog-model.ts` | 新建 | 清单模型、`CATALOG_LIMITS`、静默参数白名单 |
| `src/core/drivers/sanitize-catalog.ts` | 新建 | 清单严格校验（跳过不合格的型号并说明原因） |
| `src/core/drivers/catalog-freshness.ts` | 新建 | 过期、回滚判断 |
| `src/core/drivers/install-plan.ts` | 新建 | 按 USB 编号 / 编号找型号，按平台决定安装、打开下载页或给指引 |
| `src/core/drivers/catalog-hints.ts` | 新建 | `catalogDriverHints`：按驱动名查清单 |
| `src/core/drivers/detected-device.ts` | 新建 | 检测到的设备、稳定的设备编号 |
| `src/core/drivers/driver-install-flow.ts` | 新建 | 安装流程状态机和它的端口（下载、核对签名、提权安装） |
| `src/core/testing/driver-catalog-fixtures.ts`、`fake-driver-ports.ts` | 新建 | 示例清单（示例品牌、example.invalid）、流程端口的假实现 |
| `src/shared/driver-catalog-url.ts` | 新建 | 清单地址规则（https，或本机的 http） |
| `src/shared/driver-catalog-keys.ts` | 新建 | 内置的清单公钥（先为空，用户生成密钥后填） |
| `src/shared/drivers.ts` | 新建 | IPC 用的「驱动」状态类型 |
| `src/shared/settings.ts`、`settings.test.ts` | 修改 | 设置 `driverCatalogUrl` |
| `src/shared/ipc-contract.ts` | 修改 | 新通道、`AppInfo.defaultDriverCatalogUrl` |
| `src/main/drivers/catalog-signature.ts` | 新建 | 信封签名与核对（Ed25519） |
| `src/main/drivers/testing/catalog-keys.ts` | 新建 | 测试用密钥和签好的清单 |
| `src/main/drivers/build-defaults.ts` | 新建 | 构建时注入的默认清单地址 |
| `src/main/drivers/catalog-state-store.ts` | 新建 | 最高版本号和上次的清单（settings 表的独立键） |
| `src/main/drivers/catalog-client.ts` | 新建 | 下载、验签、校验、防回滚、缓存回退 |
| `src/main/drivers/installer-downloader.ts` | 新建 | 安装包流式下载到临时目录、SHA-256、上限、超时、删除 |
| `src/main/drivers/run-command.ts` | 新建 | 不经 shell 运行系统命令、PowerShell `-EncodedCommand` |
| `src/main/drivers/windows-devices.ts` | 新建 | Windows：查询脚本、解析、按 USB 设备归并 |
| `src/main/drivers/windows-signature.ts` | 新建 | Windows：Authenticode 查询和解析 |
| `src/main/drivers/windows-install.ts` | 新建 | Windows：提权脚本、启动脚本、退出码 |
| `src/main/drivers/mac-devices.ts` | 新建 | macOS：USB 设备、CUPS 队列、没有队列的设备 |
| `src/main/drivers/mac-install.ts` | 新建 | macOS：pkg 签名解析、`osascript` 提权安装、退出码 |
| `src/main/drivers/driver-station.ts` | 新建 | 编排：清单、检测、安装、进度推送、给 5a/5b 的查询 |
| `src/main/drivers/fake-drivers.ts` | 新建 | E2E 的假设备、假下载、假签名、假安装 |
| `src/main/printing/fake-printers.ts` | 修改 | 假打印机能在「装好驱动」后出现；可设驱动名 |
| `src/main/printing/printer-probe-host.ts`、`driver-paper.ts`、新建 `driver-name.ts` | 修改 / 新建 | 按打印机读驱动名（Task 17，5a 已有就复用） |
| `src/main/drivers/driver-ports.ts`、`fake-drivers.ts` | 新建 | 按平台选检测 / 签名核对 / 提权安装；E2E 的假环境 |
| `src/main/ipc.ts`、`ipc-validators.ts`、`src/preload/index.ts`、`src/main/index.ts` | 修改 | 通道、校验、接线 |
| `electron.vite.config.ts`、`.github/workflows/ci.yml` | 修改 | 构建时注入默认清单地址；发布前检查 |
| `scripts/driver-catalog/catalog-signing.ts`、`keygen.ts`、`sign.ts`、`describe.ts` | 新建 | 生成密钥、签清单、读安装包信息 |
| `package.json`、`.gitignore` | 修改 | 脚本命令；清单源文件和私钥不进仓库 |
| `src/renderer/src/lib/driver-text.ts` | 新建 | 「驱动」一节的文字（有测试） |
| `src/renderer/src/view-models/use-drivers.ts` | 新建 | 状态、检测、安装、取消、装好后刷新打印机 |
| `src/renderer/src/components/config/UrlSetting.tsx` | 新建 | 从 `RelayUrlSetting` 抽出的地址设置行（两处共用） |
| `src/renderer/src/components/config/RelayUrlSetting.tsx` | 修改 | 改用 `UrlSetting`，外观不变 |
| `src/renderer/src/components/DriverSection.tsx` | 新建 | 「驱动」卡片 |
| `src/renderer/src/components/config/ConfigPages.tsx`、`App.tsx`、`styles/app.css` | 修改 | 接线和样式 |
| `e2e/support/electron-app.ts`、新建 `e2e/support/driver-catalog.ts`、`e2e/drivers.e2e.ts` | 修改 / 新建 | E2E |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V87–V89 |
| `docs/driver-catalog.md` | 新建 | 给出品方：生成密钥、写清单、签名、上传、续签、换密钥 |
| `README.md`、`docs/roadmap.md`、设计文档第 7.3 节、`CLAUDE.md`、`src/*/CLAUDE.md` | 修改 | 文档 |

---

### Task 1: USB 编号、清单模型和严格校验（core）

**Files:**
- Create: `src/core/drivers/usb-id.ts`、`src/core/drivers/usb-id.test.ts`
- Create: `src/core/drivers/driver-hints.ts`（Task 2 才用到实现，这里先建接口，因为 `catalog-model.ts` 要用指令集类型）
- Create: `src/core/drivers/catalog-model.ts`
- Create: `src/core/drivers/sanitize-catalog.ts`、`src/core/drivers/sanitize-catalog.test.ts`
- Create: `src/core/testing/driver-catalog-fixtures.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/drivers/usb-id.test.ts
import { describe, expect, test } from 'bun:test';
import { formatUsbId, isSameUsbId, parseHexUsbId, parseWindowsUsbInstanceId } from './usb-id';

describe('parseWindowsUsbInstanceId', () => {
  test('reads the vendor and product id of a USB device', () => {
    expect(parseWindowsUsbInstanceId('USB\\VID_0A5F&PID_0120\\ABC123')).toEqual({ vendorId: 0x0a5f, productId: 0x0120 });
  });

  test('reads one interface of a composite device', () => {
    expect(parseWindowsUsbInstanceId('USB\\VID_1234&PID_abcd&MI_00\\7&1A2B3C&0&0000')).toEqual({
      vendorId: 0x1234,
      productId: 0xabcd,
    });
  });

  test('ignores paths that are not USB devices or have malformed ids', () => {
    expect(parseWindowsUsbInstanceId('USBPRINT\\EXAMPLEX1\\7&2&0&USB001')).toBeNull();
    expect(parseWindowsUsbInstanceId('USB\\VID_12&PID_ABCD\\1')).toBeNull();
    expect(parseWindowsUsbInstanceId('USB\\VID_12345&PID_ABCD\\1')).toBeNull();
  });
});

describe('parseHexUsbId', () => {
  test('accepts exactly four hex digits for each part', () => {
    expect(parseHexUsbId('1234', 'ABCD')).toEqual({ vendorId: 0x1234, productId: 0xabcd });
    expect(parseHexUsbId('123', 'ABCD')).toBeNull();
    expect(parseHexUsbId('12G4', 'ABCD')).toBeNull();
  });
});

describe('formatUsbId', () => {
  test('pads and upper-cases like Device Manager', () => {
    expect(formatUsbId({ vendorId: 0xa5f, productId: 0x12 })).toBe('0A5F:0012');
  });

  test('compares both parts', () => {
    expect(isSameUsbId({ vendorId: 1, productId: 2 }, { vendorId: 1, productId: 2 })).toBe(true);
    expect(isSameUsbId({ vendorId: 1, productId: 2 }, { vendorId: 1, productId: 3 })).toBe(false);
  });
});
```

```ts
// src/core/drivers/sanitize-catalog.test.ts
import { describe, expect, test } from 'bun:test';
import { EXAMPLE_SHA256, exampleCatalogSource, exampleModelSource } from '../testing/driver-catalog-fixtures';
import { CATALOG_LIMITS } from './catalog-model';
import { sanitizeCatalog } from './sanitize-catalog';

function windowsOf(model: Record<string, unknown>): Record<string, unknown> {
  return model['windows'] as Record<string, unknown>;
}

describe('sanitizeCatalog', () => {
  test('keeps a valid model and normalizes its fields', () => {
    const model = exampleModelSource();
    windowsOf(model)['sha256'] = EXAMPLE_SHA256.toUpperCase();
    const result = sanitizeCatalog(exampleCatalogSource([model]));
    if (!result.ok) {
      throw new Error(result.issue);
    }
    expect(result.dropped).toEqual([]);
    expect(result.catalog.models).toEqual([
      {
        id: 'example-x1',
        brand: '示例品牌',
        model: '示例型号 X1',
        usb: [{ vendorId: 0x1234, productId: 0xabcd }],
        driverNames: ['示例品牌 X1'],
        commandSet: 'tspl',
        windows: {
          url: 'https://example.invalid/drivers/x1-setup.exe',
          sizeBytes: 1_048_576,
          sha256: EXAMPLE_SHA256,
          kind: 'exe',
          silentArgs: ['/S'],
          signer: 'CN=示例品牌有限公司, O=示例品牌有限公司, C=CN',
          successExitCodes: [0],
        },
        macos: { pkg: null, downloadPage: 'https://example.invalid/drivers/x1-mac' },
      },
    ]);
  });

  test('tells the operator to update the app when the catalog uses a newer schema', () => {
    expect(sanitizeCatalog(exampleCatalogSource(undefined, { schema: 2 }))).toEqual({
      ok: false,
      issue: '驱动清单的格式比这个版本的程序新：请更新程序',
    });
  });

  test('refuses a catalog that expires before it was issued', () => {
    expect(sanitizeCatalog(exampleCatalogSource(undefined, { expiresAt: '2026-08-01T00:00:00Z' }))).toMatchObject({
      ok: false,
    });
  });

  test('drops a model whose installer is not downloaded over https', () => {
    const model = exampleModelSource();
    windowsOf(model)['url'] = 'http://example.invalid/x1.exe';
    const result = sanitizeCatalog(exampleCatalogSource([model]));
    expect(result).toMatchObject({ ok: true, catalog: { models: [] } });
    expect(result.ok ? result.dropped[0] : '').toContain('Windows 驱动');
  });

  test('drops a model whose silent arguments could carry another command', () => {
    const model = exampleModelSource();
    windowsOf(model)['silentArgs'] = ['/S', '& calc.exe'];
    expect(sanitizeCatalog(exampleCatalogSource([model]))).toMatchObject({ ok: true, catalog: { models: [] } });
  });

  test('drops the second model with the same id', () => {
    const result = sanitizeCatalog(
      exampleCatalogSource([exampleModelSource(), exampleModelSource({ model: '示例型号 X2' })]),
    );
    expect(result).toMatchObject({
      ok: true,
      catalog: { models: [{ model: '示例型号 X1' }] },
      dropped: ['第 2 个型号：编号「example-x1」重复'],
    });
  });

  test('keeps a model without packages so its command set can still be looked up', () => {
    const result = sanitizeCatalog(exampleCatalogSource([exampleModelSource({ windows: null, macos: undefined })]));
    expect(result).toMatchObject({ ok: true, catalog: { models: [{ windows: null, macos: null, commandSet: 'tspl' }] } });
  });

  test('drops a macOS entry that has neither a pkg nor a download page', () => {
    const result = sanitizeCatalog(exampleCatalogSource([exampleModelSource({ macos: {} })]));
    expect(result).toMatchObject({ ok: true, catalog: { models: [] } });
  });

  test('refuses more models than the limit', () => {
    const models = Array.from({ length: CATALOG_LIMITS.models + 1 }, (_, index) =>
      exampleModelSource({ id: `model-${index}` }),
    );
    expect(sanitizeCatalog(exampleCatalogSource(models))).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/drivers`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/core/drivers/usb-id.ts
/** USB 设备的厂商号（VID）和产品号（PID），各 16 位。驱动清单按它认型号。 */
export interface UsbId {
  vendorId: number;
  productId: number;
}

/** 厂商号、产品号写成 4 位十六进制（USB 规范里各 16 位）。 */
const USB_ID_HEX_DIGITS = 4;
const HEX_RADIX = 16;
const HEX_ID_PATTERN = /^[0-9A-F]{4}$/i;
/**
 * Windows 设备实例路径：USB\VID_xxxx&PID_xxxx\序列号；复合设备的一个接口是 USB\VID_xxxx&PID_xxxx&MI_00\…。
 * 只认开头这一段，接口号、序列号不影响型号。
 */
const WINDOWS_USB_INSTANCE_PATTERN = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?=[&\\]|$)/i;

/** 两段 4 位十六进制 → UsbId；格式不对返回 null。 */
export function parseHexUsbId(vendor: string, product: string): UsbId | null {
  if (!HEX_ID_PATTERN.test(vendor) || !HEX_ID_PATTERN.test(product)) {
    return null;
  }
  return { vendorId: Number.parseInt(vendor, HEX_RADIX), productId: Number.parseInt(product, HEX_RADIX) };
}

/** 从 Windows 的设备实例路径里取厂商号和产品号；不是 USB 设备的路径返回 null。 */
export function parseWindowsUsbInstanceId(instanceId: string): UsbId | null {
  const match = WINDOWS_USB_INSTANCE_PATTERN.exec(instanceId);
  if (!match) {
    return null;
  }
  const [, vendor = '', product = ''] = match;
  return parseHexUsbId(vendor, product);
}

/** 界面和日志里的写法：0A5F:0120（和设备管理器里一样大写）。 */
export function formatUsbId(id: UsbId): string {
  return `${hex(id.vendorId)}:${hex(id.productId)}`;
}

export function isSameUsbId(a: UsbId, b: UsbId): boolean {
  return a.vendorId === b.vendorId && a.productId === b.productId;
}

function hex(value: number): string {
  return value.toString(HEX_RADIX).toUpperCase().padStart(USB_ID_HEX_DIGITS, '0');
}
```

```ts
// src/core/drivers/driver-hints.ts
/**
 * 给 5a（指令集「自动」）和 5b（诊断里的「重新安装驱动」）用的接口：按系统里的驱动名查在线驱动清单。
 * 这个文件是和 5a、5b 约定好的，改动要同时改它们的调用处（见 docs/superpowers/plans/2026-10-02-driver-install.md）。
 */

/** 清单里写的标签机指令集。 */
export const CATALOG_COMMAND_SETS = ['tspl', 'zpl', 'epl'] as const;
export type CatalogCommandSet = (typeof CATALOG_COMMAND_SETS)[number];

/** 清单里的一个型号。 */
export interface CatalogModelHint {
  modelId: string;
  brand: string;
  model: string;
  /** 清单没写时为 null，由 5a 按驱动名关键字猜。 */
  commandSet: CatalogCommandSet | null;
  /** 清单里有这台电脑的系统能静默安装的安装包（Windows 的 exe / msi、macOS 的 pkg）。 */
  canInstall: boolean;
}

/** 清单没配置、下载不到、过期时什么都查不到（返回 null），调用方按「没有清单」处理。 */
export interface DriverHints {
  /**
   * driverName：Windows 的驱动名（Get-Printer 的 DriverName）、macOS 的 printer-make-and-model；
   * 不分大小写，忽略首尾和重复的空白。
   */
  modelForDriverName(driverName: string): CatalogModelHint | null;
}

export const NO_DRIVER_HINTS: DriverHints = { modelForDriverName: () => null };
```

```ts
// src/core/drivers/catalog-model.ts
import type { CatalogCommandSet } from './driver-hints';
import type { UsbId } from './usb-id';

/** 这个版本的程序认得的清单格式。不兼容的改动加 1，旧程序据此提示更新。 */
export const CATALOG_SCHEMA = 1;

const BYTES_PER_MB = 1024 * 1024;

export const CATALOG_LIMITS = {
  /** 型号数：一家出品方用到的标签机是几十种，留两个数量级的余量；也限住清单的解析量。 */
  models: 2_000,
  /** 同一型号的 USB 编号：换过主板、不同批次的产品号，十几个足够。 */
  usbIdsPerModel: 16,
  /** 装完以后系统里的驱动名（不同语言、不同版本的驱动名不同）。 */
  driverNamesPerModel: 8,
  brandLength: 40,
  modelLength: 80,
  driverNameLength: 128,
  urlLength: 2_048,
  /** 证书 Subject 一般一两百个字符。 */
  signerLength: 512,
  silentArgs: 8,
  successExitCodes: 8,
  /** 安装包最大 512MB：标签机驱动通常 5–100MB，带全套语言的也不到 300MB。下载时按清单写的大小截断。 */
  installerBytes: 512 * BYTES_PER_MB,
} as const;

/** 型号编号：日志、5b 的重装、界面都用它。只用小写字母、数字和横杠。 */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/**
 * 静默安装参数：每个参数只能有字母、数字和 _ . / : = + -。不能有空格、引号、& | ; < > % ^ 和反斜杠，
 * 拼进命令行也不会变成别的命令或别的参数；要写路径的参数（例如 NSIS 的 /D=）不支持，用安装程序的默认目录。
 */
export const SILENT_ARG_PATTERN = /^[A-Za-z0-9_./:=+-]{1,64}$/;

export const WINDOWS_PACKAGE_KINDS = ['exe', 'msi'] as const;
export type WindowsPackageKind = (typeof WINDOWS_PACKAGE_KINDS)[number];

/** 没写 successExitCodes 时只有 0 算成功（3010、1641 另按「装好了、要重启」处理）。 */
export const DEFAULT_SUCCESS_EXIT_CODES: readonly number[] = [0];

/** 要下载的文件：地址只能是 https，大小和 SHA-256 都钉死。 */
export interface DownloadSpec {
  url: string;
  sizeBytes: number;
  /** 64 位小写十六进制。 */
  sha256: string;
}

export interface WindowsPackage extends DownloadSpec {
  kind: WindowsPackageKind;
  /** exe 的静默参数；msi 由程序加 /qn /norestart，这里写额外的属性（例如 ALLUSERS=1）。 */
  silentArgs: string[];
  /** Authenticode 签名证书的 Subject，必须逐字相同（用 bun run driver-catalog:describe 读出来）。 */
  signer: string;
  successExitCodes: number[];
}

export interface MacPkg extends DownloadSpec {
  /** pkgutil --check-signature 证书链第一行的名字（Developer ID Installer: …），必须逐字相同。 */
  signer: string;
}

export interface MacDriver {
  pkg: MacPkg | null;
  /** 没有 pkg 时打开的官方下载页（https）。 */
  downloadPage: string | null;
}

export interface CatalogModel {
  id: string;
  brand: string;
  model: string;
  usb: UsbId[];
  driverNames: string[];
  commandSet: CatalogCommandSet | null;
  windows: WindowsPackage | null;
  macos: MacDriver | null;
}

/** 校验过的清单；时间都是毫秒。 */
export interface DriverCatalog {
  schema: number;
  /** 签名时刻的 Unix 秒数：越新越大，程序不用比见过的最高版本低的清单。 */
  version: number;
  issuedAt: number;
  expiresAt: number;
  models: CatalogModel[];
}
```

```ts
// src/core/drivers/sanitize-catalog.ts
import {
  CATALOG_LIMITS,
  CATALOG_SCHEMA,
  type CatalogModel,
  DEFAULT_SUCCESS_EXIT_CODES,
  type DownloadSpec,
  type DriverCatalog,
  type MacDriver,
  type MacPkg,
  MODEL_ID_PATTERN,
  SILENT_ARG_PATTERN,
  WINDOWS_PACKAGE_KINDS,
  type WindowsPackage,
  type WindowsPackageKind,
} from './catalog-model';
import { CATALOG_COMMAND_SETS, type CatalogCommandSet } from './driver-hints';
import { parseHexUsbId, type UsbId } from './usb-id';

/** dropped：跳过的型号和原因（写日志；签名脚本见到任何一条就不签）。 */
export type CatalogParse = { ok: true; catalog: DriverCatalog; dropped: string[] } | { ok: false; issue: string };

type Field<T> = { ok: true; value: T } | { ok: false; reason: string };

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
/** 退出码是 32 位有符号整数；负数只有出错的程序才会用，不作为成功的退出码。 */
const MAX_EXIT_CODE = 2 ** 31 - 1;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 清单里的文字不许有控制字符（会弄乱界面和日志）
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * 清单来自网络：验签之后仍然逐项校验。结构不对、格式比程序新时整份不用；
 * 单个型号不合格时跳过它（旧版程序遇到新增写法的型号不至于整份清单都用不了），原因放进 dropped。
 */
export function sanitizeCatalog(value: unknown): CatalogParse {
  const input = asRecord(value);
  if (input === null) {
    return { ok: false, issue: '驱动清单的内容不对' };
  }
  const schema = input['schema'];
  if (typeof schema === 'number' && schema > CATALOG_SCHEMA) {
    return { ok: false, issue: '驱动清单的格式比这个版本的程序新：请更新程序' };
  }
  if (schema !== CATALOG_SCHEMA) {
    return { ok: false, issue: '驱动清单的格式不对' };
  }
  const version = input['version'];
  if (!isPositiveInteger(version)) {
    return { ok: false, issue: '驱动清单没有合法的版本号' };
  }
  const issuedAt = parseUtc(input['issuedAt']);
  const expiresAt = parseUtc(input['expiresAt']);
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt) {
    return { ok: false, issue: '驱动清单的签发时间或有效期不对' };
  }
  const rawModels = input['models'];
  if (!Array.isArray(rawModels)) {
    return { ok: false, issue: '驱动清单里没有型号列表' };
  }
  if (rawModels.length > CATALOG_LIMITS.models) {
    return { ok: false, issue: `驱动清单最多 ${CATALOG_LIMITS.models} 个型号` };
  }
  const models: CatalogModel[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawModels.entries()) {
    const label = `第 ${index + 1} 个型号`;
    const parsed = sanitizeModel(raw);
    if (!parsed.ok) {
      dropped.push(`${label}：${parsed.reason}`);
    } else if (seen.has(parsed.value.id)) {
      dropped.push(`${label}：编号「${parsed.value.id}」重复`);
    } else {
      seen.add(parsed.value.id);
      models.push(parsed.value);
    }
  }
  return { ok: true, catalog: { schema: CATALOG_SCHEMA, version, issuedAt, expiresAt, models }, dropped };
}

function sanitizeModel(value: unknown): Field<CatalogModel> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const id = input['id'];
  if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id)) {
    return fail('编号只能用小写字母、数字和横杠，最长 64 个字符');
  }
  const brand = text(input['brand'], CATALOG_LIMITS.brandLength);
  const model = text(input['model'], CATALOG_LIMITS.modelLength);
  if (brand === null || model === null) {
    return fail('品牌或型号为空、太长或有控制字符');
  }
  const usb = usbIds(input['usb']);
  if (usb === null) {
    return fail(`USB 编号要有 1–${CATALOG_LIMITS.usbIdsPerModel} 个，每个是 4 位十六进制的 vendorId 和 productId`);
  }
  const driverNames = optionalTexts(
    input['driverNames'],
    CATALOG_LIMITS.driverNamesPerModel,
    CATALOG_LIMITS.driverNameLength,
  );
  if (driverNames === null) {
    return fail(`驱动名最多 ${CATALOG_LIMITS.driverNamesPerModel} 个，每个不超过 ${CATALOG_LIMITS.driverNameLength} 字`);
  }
  const commandSet = optionalCommandSet(input['commandSet']);
  if (commandSet === undefined) {
    return fail('指令集只能是 tspl、zpl、epl');
  }
  const windows = isAbsent(input['windows']) ? ok(null) : windowsPackage(input['windows']);
  if (!windows.ok) {
    return fail(`Windows 驱动：${windows.reason}`);
  }
  const macos = isAbsent(input['macos']) ? ok(null) : macDriver(input['macos']);
  if (!macos.ok) {
    return fail(`macOS 驱动：${macos.reason}`);
  }
  return ok({ id, brand, model, usb, driverNames, commandSet, windows: windows.value, macos: macos.value });
}

function windowsPackage(value: unknown): Field<WindowsPackage> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const download = downloadSpec(input);
  if (!download.ok) {
    return download;
  }
  const kind = input['kind'];
  if (!isWindowsKind(kind)) {
    return fail('kind 只能是 exe 或 msi');
  }
  const silentArgs = stringList(input['silentArgs'] ?? [], CATALOG_LIMITS.silentArgs, (arg) =>
    SILENT_ARG_PATTERN.test(arg),
  );
  if (silentArgs === null) {
    return fail(`静默安装参数最多 ${CATALOG_LIMITS.silentArgs} 个，每个只能有字母、数字和 _ . / : = + -`);
  }
  const signer = text(input['signer'], CATALOG_LIMITS.signerLength);
  if (signer === null) {
    return fail('没写要求的签名者（signer）');
  }
  const successExitCodes = exitCodes(input['successExitCodes']);
  if (successExitCodes === null) {
    return fail(`successExitCodes 最多 ${CATALOG_LIMITS.successExitCodes} 个非负整数`);
  }
  return ok({ ...download.value, kind, silentArgs, signer, successExitCodes });
}

function macDriver(value: unknown): Field<MacDriver> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const pkg = isAbsent(input['pkg']) ? ok(null) : macPkg(input['pkg']);
  if (!pkg.ok) {
    return fail(`pkg：${pkg.reason}`);
  }
  const rawPage = input['downloadPage'];
  const downloadPage = isAbsent(rawPage) ? null : httpsUrl(rawPage);
  if (!isAbsent(rawPage) && downloadPage === null) {
    return fail('下载页只能是 https 地址');
  }
  if (pkg.value === null && downloadPage === null) {
    return fail('要有 pkg 或 downloadPage');
  }
  return ok({ pkg: pkg.value, downloadPage });
}

function macPkg(value: unknown): Field<MacPkg> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const download = downloadSpec(input);
  if (!download.ok) {
    return download;
  }
  const signer = text(input['signer'], CATALOG_LIMITS.signerLength);
  return signer === null ? fail('没写要求的签名者（signer）') : ok({ ...download.value, signer });
}

function downloadSpec(input: Record<string, unknown>): Field<DownloadSpec> {
  const url = httpsUrl(input['url']);
  if (url === null) {
    return fail('下载地址只能是 https，不能带账号密码');
  }
  const sizeBytes = input['sizeBytes'];
  if (!isPositiveInteger(sizeBytes) || sizeBytes > CATALOG_LIMITS.installerBytes) {
    return fail(`文件大小（sizeBytes）要是 1 到 ${CATALOG_LIMITS.installerBytes} 之间的整数`);
  }
  const sha256 = input['sha256'];
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    return fail('SHA-256 要是 64 位十六进制');
  }
  return ok({ url, sizeBytes, sha256: sha256.toLowerCase() });
}

function usbIds(value: unknown): UsbId[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CATALOG_LIMITS.usbIdsPerModel) {
    return null;
  }
  const ids: UsbId[] = [];
  for (const item of value) {
    const input = asRecord(item);
    const vendor = input?.['vendorId'];
    const product = input?.['productId'];
    const id = typeof vendor === 'string' && typeof product === 'string' ? parseHexUsbId(vendor, product) : null;
    if (id === null) {
      return null;
    }
    ids.push(id);
  }
  return ids;
}

function exitCodes(value: unknown): number[] | null {
  if (isAbsent(value)) {
    return [...DEFAULT_SUCCESS_EXIT_CODES];
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > CATALOG_LIMITS.successExitCodes) {
    return null;
  }
  return value.every((code) => Number.isInteger(code) && code >= 0 && code <= MAX_EXIT_CODE)
    ? (value as number[])
    : null;
}

function optionalCommandSet(value: unknown): CatalogCommandSet | null | undefined {
  if (isAbsent(value)) {
    return null;
  }
  return (CATALOG_COMMAND_SETS as readonly unknown[]).includes(value) ? (value as CatalogCommandSet) : undefined;
}

function optionalTexts(value: unknown, maxCount: number, maxLength: number): string[] | null {
  if (isAbsent(value)) {
    return [];
  }
  const items = stringList(value, maxCount, (item) => text(item, maxLength) === item);
  return items;
}

function stringList(value: unknown, maxCount: number, isValid: (item: string) => boolean): string[] | null {
  if (!Array.isArray(value) || value.length > maxCount) {
    return null;
  }
  return value.every((item): item is string => typeof item === 'string' && isValid(item)) ? value : null;
}

function isWindowsKind(value: unknown): value is WindowsPackageKind {
  return (WINDOWS_PACKAGE_KINDS as readonly unknown[]).includes(value);
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > CATALOG_LIMITS.urlLength) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= maxLength && !CONTROL_CHARACTERS.test(trimmed) ? trimmed : null;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ok<T>(value: T): Field<T> {
  return { ok: true, value };
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
```

（`optionalTexts` 里 `text(item, maxLength) === item` 同时挡住首尾空白和控制字符：清单里的驱动名要和系统报告的逐字比较，不悄悄改写。）

```ts
// src/core/testing/driver-catalog-fixtures.ts
import type { DriverCatalog } from '../drivers/catalog-model';
import { sanitizeCatalog } from '../drivers/sanitize-catalog';

/**
 * 测试用的清单：品牌、型号、地址都是假的（仓库里不写真实品牌和厂家网址）。
 * 有效期覆盖 FakeClock 的起点（2026-09-28）。
 */
export const EXAMPLE_SHA256 = '0123456789abcdef'.repeat(4);
export const EXAMPLE_SIGNER = 'CN=示例品牌有限公司, O=示例品牌有限公司, C=CN';
export const EXAMPLE_ISSUED_AT = '2026-09-01T00:00:00Z';
export const EXAMPLE_EXPIRES_AT = '2027-03-01T00:00:00Z';
/** 签名时刻 2026-09-01 的 Unix 秒数。 */
export const EXAMPLE_VERSION = 1_788_220_800;

export function exampleModelSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example-x1',
    brand: '示例品牌',
    model: '示例型号 X1',
    usb: [{ vendorId: '1234', productId: 'ABCD' }],
    driverNames: ['示例品牌 X1'],
    commandSet: 'tspl',
    windows: {
      url: 'https://example.invalid/drivers/x1-setup.exe',
      sizeBytes: 1_048_576,
      sha256: EXAMPLE_SHA256,
      kind: 'exe',
      silentArgs: ['/S'],
      signer: EXAMPLE_SIGNER,
    },
    macos: { downloadPage: 'https://example.invalid/drivers/x1-mac' },
    ...overrides,
  };
}

export function exampleCatalogSource(
  models: unknown[] = [exampleModelSource()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: 1,
    version: EXAMPLE_VERSION,
    issuedAt: EXAMPLE_ISSUED_AT,
    expiresAt: EXAMPLE_EXPIRES_AT,
    models,
    ...overrides,
  };
}

export function exampleCatalog(models?: unknown[]): DriverCatalog {
  const parsed = sanitizeCatalog(exampleCatalogSource(models));
  if (!parsed.ok) {
    throw new Error(`example catalog is invalid: ${parsed.issue}`);
  }
  return parsed.catalog;
}
```

（`exampleWindowsTarget` 依赖 Task 2 的 `install-plan.ts`，在 Task 2 Step 3 加进这个文件。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/drivers`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/core/drivers src/core/testing/driver-catalog-fixtures.ts
git commit -m "feat(core): driver catalog model and strict validation" -m "The online driver catalog maps USB vendor and product ids to official installers. It comes from the network, so after the signature check every field is still validated: https only, pinned size and SHA-256, a whitelist for silent arguments that cannot smuggle in another command, and limits on every list. A model that fails is skipped with a reason; a newer schema asks the operator to update." -m "$TRAILER"
```

---

### Task 2: 过期与回滚、按平台的安装方式、按驱动名查型号（core）

**Files:**
- Create: `src/core/drivers/catalog-freshness.ts`、`catalog-freshness.test.ts`
- Create: `src/core/drivers/install-plan.ts`、`install-plan.test.ts`
- Create: `src/core/drivers/catalog-hints.ts`、`catalog-hints.test.ts`
- Modify: `src/core/testing/driver-catalog-fixtures.ts`（`exampleWindowsTarget`）
- Check: `src/core/drivers/driver-hints.ts`（5a/5b 已建时核对和 Task 1 的原文一致；不一致以 Task 1 为准，并改它们的调用处）

- [ ] **Step 1: 写测试**

```ts
// src/core/drivers/catalog-freshness.test.ts
import { expect, test } from 'bun:test';
import { exampleCatalog } from '../testing/driver-catalog-fixtures';
import { checkCatalogFreshness } from './catalog-freshness';

const catalog = exampleCatalog();

test('accepts a catalog within its validity and not older than the last one used', () => {
  expect(checkCatalogFreshness(catalog, catalog.version, catalog.issuedAt)).toEqual({ ok: true });
  expect(checkCatalogFreshness(catalog, null, catalog.expiresAt - 1)).toEqual({ ok: true });
});

test('refuses a catalog older than the newest one this computer has used', () => {
  expect(checkCatalogFreshness(catalog, catalog.version + 1, catalog.issuedAt)).toMatchObject({
    ok: false,
    reason: 'rolled-back',
  });
});

test('refuses an expired catalog and shows both the expiry and the computer clock', () => {
  const result = checkCatalogFreshness(catalog, null, catalog.expiresAt);
  expect(result).toMatchObject({ ok: false, reason: 'expired' });
  expect(result.ok ? '' : result.issue).toContain('2027-03-01');
});
```

```ts
// src/core/drivers/install-plan.test.ts
import { describe, expect, test } from 'bun:test';
import { exampleCatalog, exampleModelSource } from '../testing/driver-catalog-fixtures';
import { actionFor, findModelById, findModelByUsbId, installerFileName } from './install-plan';

const catalog = exampleCatalog([
  exampleModelSource(),
  exampleModelSource({
    id: 'example-x2',
    usb: [{ vendorId: '1234', productId: 'ABCE' }],
    windows: null,
    macos: {
      pkg: {
        url: 'https://example.invalid/drivers/x2.pkg',
        sizeBytes: 2_048,
        sha256: 'f'.repeat(64),
        signer: 'Developer ID Installer: 示例品牌 (EXAMPLE123)',
      },
    },
  }),
]);

describe('findModelByUsbId', () => {
  test('finds the model that lists the vendor and product id', () => {
    expect(findModelByUsbId(catalog, { vendorId: 0x1234, productId: 0xabce })?.id).toBe('example-x2');
    expect(findModelByUsbId(catalog, { vendorId: 0x1234, productId: 0x0001 })).toBeNull();
    expect(findModelById(catalog, 'example-x1')?.model).toBe('示例型号 X1');
  });
});

describe('actionFor', () => {
  const [x1, x2] = catalog.models;

  test('installs the Windows package on Windows', () => {
    expect(actionFor(x1 ?? null, 'windows')).toMatchObject({ kind: 'install', target: { platform: 'windows' } });
  });

  test('opens the download page on macOS when there is no pkg', () => {
    expect(actionFor(x1 ?? null, 'mac')).toEqual({
      kind: 'open-page',
      model: x1,
      url: 'https://example.invalid/drivers/x1-mac',
    });
  });

  test('installs the pkg on macOS and has nothing to install on Windows for a mac-only model', () => {
    expect(actionFor(x2 ?? null, 'mac')).toMatchObject({ kind: 'install', target: { platform: 'mac' } });
    expect(actionFor(x2 ?? null, 'windows')).toEqual({ kind: 'no-package', model: x2 });
  });

  test('says the model is not in the catalog', () => {
    expect(actionFor(null, 'windows')).toEqual({ kind: 'not-in-catalog' });
  });

  test('names the installer after its kind so Windows runs it the right way', () => {
    const action = actionFor(x1 ?? null, 'windows');
    expect(action.kind === 'install' ? installerFileName(action.target) : '').toBe('driver-installer.exe');
  });
});
```

```ts
// src/core/drivers/catalog-hints.test.ts
import { expect, test } from 'bun:test';
import { exampleCatalog, exampleModelSource } from '../testing/driver-catalog-fixtures';
import { catalogDriverHints } from './catalog-hints';
import { NO_DRIVER_HINTS } from './driver-hints';

const catalog = exampleCatalog([exampleModelSource({ driverNames: ['示例品牌 X1', 'Example X1 Driver'] })]);

test('finds a model by the driver name the system reports, ignoring case and extra spaces', () => {
  expect(catalogDriverHints(catalog, 'windows').modelForDriverName('  example x1   driver')).toEqual({
    modelId: 'example-x1',
    brand: '示例品牌',
    model: '示例型号 X1',
    commandSet: 'tspl',
    canInstall: true,
  });
});

test('says whether this platform can install it', () => {
  expect(catalogDriverHints(catalog, 'mac').modelForDriverName('Example X1 Driver')?.canInstall).toBe(false);
});

test('finds nothing for unknown drivers or without a catalog', () => {
  expect(catalogDriverHints(catalog, 'windows').modelForDriverName('Generic / Text Only')).toBeNull();
  expect(NO_DRIVER_HINTS.modelForDriverName('Example X1 Driver')).toBeNull();
});
```

（清单里的驱动名经 Task 1 的严格校验不能带首尾空白；系统报告的驱动名的空白和大小写差异在查询时归一化。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/drivers`
Expected: FAIL，三个模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/core/drivers/catalog-freshness.ts
import type { DriverCatalog } from './catalog-model';

export type CatalogFreshness = { ok: true } | { ok: false; reason: 'expired' | 'rolled-back'; issue: string };

/** ISO 时间的前 10 个字符是日期（YYYY-MM-DD）。 */
const ISO_DATE_LENGTH = 10;

/**
 * 这份清单能不能用：
 * - 版本比这台电脑用过的最高版本低：不用（防止有人拿旧清单换掉新清单，旧清单里可能有已经撤下的驱动）；
 * - 过了有效期：不用（同一个理由，签过的旧清单不能无限期被重放）。同一版本可以反复用（缓存、重新下载）。
 */
export function checkCatalogFreshness(
  catalog: DriverCatalog,
  highestSeenVersion: number | null,
  now: number,
): CatalogFreshness {
  if (highestSeenVersion !== null && catalog.version < highestSeenVersion) {
    return {
      ok: false,
      reason: 'rolled-back',
      issue: '下载到的驱动清单比这台电脑上次用的旧，可能被换过，不使用：稍后再试，一直这样请联系出品方',
    };
  }
  if (now >= catalog.expiresAt) {
    return {
      ok: false,
      reason: 'expired',
      issue: `驱动清单已在 ${utcDate(catalog.expiresAt)} 过期（电脑时间是 ${utcDate(now)}）：电脑时间不对的话先校准时间，否则请等出品方更新清单`,
    };
  }
  return { ok: true };
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH);
}
```

```ts
// src/core/drivers/install-plan.ts
import type { CatalogModel, DriverCatalog, MacPkg, WindowsPackage } from './catalog-model';
import { isSameUsbId, type UsbId } from './usb-id';

/** 能自动装驱动的平台；其他平台不显示安装。 */
export type DriverPlatform = 'windows' | 'mac';

/** 要装的东西：哪个型号、哪个安装包。 */
export type InstallTarget =
  | { platform: 'windows'; model: CatalogModel; package: WindowsPackage }
  | { platform: 'mac'; model: CatalogModel; package: MacPkg };

/** 这台设备在这个平台上能做什么。 */
export type DeviceAction =
  | { kind: 'install'; target: InstallTarget }
  | { kind: 'open-page'; model: CatalogModel; url: string }
  | { kind: 'no-package'; model: CatalogModel }
  | { kind: 'not-in-catalog' };

export function findModelByUsbId(catalog: DriverCatalog, id: UsbId): CatalogModel | null {
  return catalog.models.find((model) => model.usb.some((item) => isSameUsbId(item, id))) ?? null;
}

export function findModelById(catalog: DriverCatalog, modelId: string): CatalogModel | null {
  return catalog.models.find((model) => model.id === modelId) ?? null;
}

/** Windows：清单里有安装包就装；macOS：有 pkg 就装，没有就打开官方下载页；都没有说明这个平台没有驱动。 */
export function actionFor(model: CatalogModel | null, platform: DriverPlatform): DeviceAction {
  if (model === null) {
    return { kind: 'not-in-catalog' };
  }
  if (platform === 'windows') {
    return model.windows ? { kind: 'install', target: { platform, model, package: model.windows } } : { kind: 'no-package', model };
  }
  if (model.macos?.pkg) {
    return { kind: 'install', target: { platform, model, package: model.macos.pkg } };
  }
  if (model.macos?.downloadPage) {
    return { kind: 'open-page', model, url: model.macos.downloadPage };
  }
  return { kind: 'no-package', model };
}

/** 临时文件名：Windows 按扩展名决定怎么运行（msi 交给 msiexec），macOS 的 installer 要 .pkg。 */
export function installerFileName(target: InstallTarget): string {
  return target.platform === 'windows' ? `driver-installer.${target.package.kind}` : 'driver-installer.pkg';
}
```

```ts
// src/core/drivers/catalog-hints.ts
import type { CatalogModel, DriverCatalog } from './catalog-model';
import type { CatalogModelHint, DriverHints } from './driver-hints';
import { actionFor, type DriverPlatform } from './install-plan';

/** 按驱动名查清单（给 5a、5b）：驱动名不分大小写、忽略首尾和重复的空白。 */
export function catalogDriverHints(catalog: DriverCatalog, platform: DriverPlatform): DriverHints {
  const byName = new Map<string, CatalogModel>();
  for (const model of catalog.models) {
    for (const name of model.driverNames) {
      // 两个型号写了同一个驱动名时用前面那个：出品方的清单里不该这样写，签名脚本照样放行，这里不报错。
      if (!byName.has(normalize(name))) {
        byName.set(normalize(name), model);
      }
    }
  }
  return {
    modelForDriverName: (driverName) => {
      const model = byName.get(normalize(driverName));
      return model ? hintOf(model, platform) : null;
    },
  };
}

function hintOf(model: CatalogModel, platform: DriverPlatform): CatalogModelHint {
  return {
    modelId: model.id,
    brand: model.brand,
    model: model.model,
    commandSet: model.commandSet,
    canInstall: actionFor(model, platform).kind === 'install',
  };
}

function normalize(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
```

`src/core/testing/driver-catalog-fixtures.ts`：顶部加 `import type { InstallTarget } from '../drivers/install-plan';`，文件末尾加：

```ts
/** 示例清单第一个型号的 Windows 安装包。 */
export function exampleWindowsTarget(): InstallTarget {
  const model = exampleCatalog().models[0];
  if (!model?.windows) {
    throw new Error('example model has no Windows package');
  }
  return { platform: 'windows', model, package: model.windows };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/drivers`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/core/drivers src/core/testing/driver-catalog-fixtures.ts
git commit -m "feat(core): catalog freshness, install choice per platform and driver name hints" -m "An old or expired catalog is refused so a withdrawn driver cannot be replayed. Each device maps to install, open the download page, no package for this platform, or not in the catalog. Commands (5a) and diagnosis (5b) look models up by driver name through the agreed DriverHints interface." -m "$TRAILER"
```

---

### Task 3: 清单的签名信封、内置公钥、清单地址规则

**Files:**
- Create: `src/main/drivers/catalog-signature.ts`、`catalog-signature.test.ts`
- Create: `src/main/drivers/testing/catalog-keys.ts`
- Create: `src/shared/driver-catalog-keys.ts`
- Create: `src/shared/driver-catalog-url.ts`、`driver-catalog-url.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/catalog-signature.test.ts
import { sign } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { exampleCatalogSource } from '../../core/testing/driver-catalog-fixtures';
import { DRIVER_CATALOG_PUBLIC_KEYS } from '../../shared/driver-catalog-keys';
import {
  KEY_ID_PATTERN,
  MAX_CATALOG_PAYLOAD_BYTES,
  openCatalogEnvelope,
  publicKeyFromRaw,
  rawPublicKey,
  signCatalogPayload,
} from './catalog-signature';
import { createTestCatalogKeys, signedCatalogText } from './testing/catalog-keys';

const keys = createTestCatalogKeys();

describe('openCatalogEnvelope', () => {
  test('opens an envelope signed by a trusted key', () => {
    expect(openCatalogEnvelope(signedCatalogText(exampleCatalogSource(), keys), keys.trusted)).toEqual({
      ok: true,
      keyId: 'test',
      payload: exampleCatalogSource(),
    });
  });

  test('refuses a payload changed after signing', () => {
    const envelope = JSON.parse(signedCatalogText(exampleCatalogSource(), keys)) as Record<string, string>;
    const changed = JSON.stringify({ ...exampleCatalogSource(), version: 1 });
    envelope['payload'] = Buffer.from(changed).toString('base64');
    expect(openCatalogEnvelope(JSON.stringify(envelope), keys.trusted)).toEqual({
      ok: false,
      issue: '驱动清单的签名不对，可能被改过，不使用',
    });
  });

  test('refuses a signature made without the signing context', () => {
    const payload = Buffer.from(JSON.stringify(exampleCatalogSource()));
    const envelope = {
      format: 1,
      keyId: keys.keyId,
      payload: payload.toString('base64'),
      signature: sign(null, payload, keys.privateKey).toString('base64'),
    };
    expect(openCatalogEnvelope(JSON.stringify(envelope), keys.trusted)).toMatchObject({ ok: false });
  });

  test('asks for an update when the key id is unknown', () => {
    const other = createTestCatalogKeys('other');
    expect(openCatalogEnvelope(signedCatalogText(exampleCatalogSource(), other), keys.trusted)).toEqual({
      ok: false,
      issue: '驱动清单用的签名密钥（other）这个版本的程序不认识：请更新程序',
    });
  });

  test('refuses non-canonical base64, non-JSON text and oversized payloads', () => {
    const envelope = JSON.parse(signedCatalogText(exampleCatalogSource(), keys)) as Record<string, string>;
    expect(
      openCatalogEnvelope(JSON.stringify({ ...envelope, payload: `${envelope['payload']}\n` }), keys.trusted),
    ).toMatchObject({ ok: false });
    expect(openCatalogEnvelope('<html>', keys.trusted)).toMatchObject({ ok: false });
    const big = signCatalogPayload(new Uint8Array(MAX_CATALOG_PAYLOAD_BYTES + 1), keys.keyId, keys.privateKey);
    expect(openCatalogEnvelope(JSON.stringify(big), keys.trusted)).toMatchObject({ ok: false });
  });
});

describe('raw public keys', () => {
  test('round-trip through base64', () => {
    expect(rawPublicKey(publicKeyFromRaw(keys.publicKey))).toBe(keys.publicKey);
  });

  test('every embedded key is a valid Ed25519 public key with a valid id', () => {
    for (const [keyId, publicKey] of Object.entries(DRIVER_CATALOG_PUBLIC_KEYS)) {
      expect(keyId).toMatch(KEY_ID_PATTERN);
      expect(() => publicKeyFromRaw(publicKey)).not.toThrow();
    }
  });
});
```

```ts
// src/shared/driver-catalog-url.test.ts
import { expect, test } from 'bun:test';
import { sanitizeCatalogUrl } from './driver-catalog-url';

test('accepts https addresses and keeps the query', () => {
  expect(sanitizeCatalogUrl(' https://catalog.example.com/labelflash/driver-catalog.json?v=1 ')).toBe(
    'https://catalog.example.com/labelflash/driver-catalog.json?v=1',
  );
});

test('accepts plain http only on this computer (development and E2E)', () => {
  expect(sanitizeCatalogUrl('http://127.0.0.1:8080/driver-catalog.json')).toBe(
    'http://127.0.0.1:8080/driver-catalog.json',
  );
  expect(sanitizeCatalogUrl('http://catalog.example.com/driver-catalog.json')).toBeNull();
});

test('refuses credentials, fragments, other schemes and junk', () => {
  expect(sanitizeCatalogUrl('https://user:pass@catalog.example.com/c.json')).toBeNull();
  expect(sanitizeCatalogUrl('https://catalog.example.com/c.json#x')).toBeNull();
  expect(sanitizeCatalogUrl('file:///C:/c.json')).toBeNull();
  expect(sanitizeCatalogUrl('')).toBeNull();
  expect(sanitizeCatalogUrl(42)).toBeNull();
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers src/shared/driver-catalog-url.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/drivers/catalog-signature.ts
import { createPublicKey, type KeyObject, sign, verify } from 'node:crypto';

/**
 * 驱动清单的签名信封：一个 JSON 文件 { format, keyId, payload, signature }。
 * - payload 是清单 JSON 原文的 base64：签的是原始字节，不用规范化 JSON；
 * - 签名覆盖「用途前缀 + payload 原始字节」：同一把私钥哪天签了别的东西，也不能被挪用成驱动清单；
 * - keyId 指明用哪把公钥核对：换密钥时新旧公钥可以同时内置。
 * 不依赖 electron：签名脚本（scripts/driver-catalog/）和测试直接用。
 */
export const CATALOG_SIGNING_CONTEXT = 'CDL-LabelFlash driver catalog v1\n';
export const CATALOG_ENVELOPE_FORMAT = 1;
/** 密钥编号：小写字母、数字和横杠，例如 2026a。 */
export const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BYTES_PER_MB = 1024 * 1024;
/** 清单原文最多 1MB：两千个型号每个约 400 字节，留足余量。 */
export const MAX_CATALOG_PAYLOAD_BYTES = BYTES_PER_MB;
/** 整个信封最多 2MB（base64 多三分之一，加上签名和字段名）；下载时超过就停。 */
export const MAX_CATALOG_ENVELOPE_BYTES = 2 * BYTES_PER_MB;
/** Ed25519 的公钥 32 字节、签名 64 字节（RFC 8032）。 */
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
/** 32 字节原始公钥包成 SPKI（DER）的固定前缀：SEQUENCE { AlgorithmIdentifier { id-Ed25519 }, BIT STRING }（RFC 8410）。 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_BLOCK = 4;

export interface CatalogEnvelope {
  format: typeof CATALOG_ENVELOPE_FORMAT;
  keyId: string;
  payload: string;
  signature: string;
}

export type EnvelopeOpen = { ok: true; keyId: string; payload: unknown } | { ok: false; issue: string };

/** base64 的 32 字节原始公钥 → KeyObject；格式不对时抛错（内置公钥写错应当在测试里就暴露）。 */
export function publicKeyFromRaw(base64: string): KeyObject {
  const raw = decodeBase64(base64);
  if (raw === null || raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error('An Ed25519 public key must be 32 bytes of canonical base64');
  }
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** KeyObject（公钥或私钥）→ base64 的 32 字节原始公钥：生成密钥时打印、签名前核对用。 */
export function rawPublicKey(key: KeyObject): string {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX.length).toString('base64');
}

/** 内置公钥表 → 编号到 KeyObject 的映射。 */
export function trustedKeys(record: Readonly<Record<string, string>>): ReadonlyMap<string, KeyObject> {
  return new Map(Object.entries(record).map(([keyId, base64]) => [keyId, publicKeyFromRaw(base64)]));
}

/** 签名（签名脚本和测试用）。 */
export function signCatalogPayload(payload: Uint8Array, keyId: string, privateKey: KeyObject): CatalogEnvelope {
  const signature = sign(null, signedBytes(payload), privateKey);
  return {
    format: CATALOG_ENVELOPE_FORMAT,
    keyId,
    payload: Buffer.from(payload).toString('base64'),
    signature: signature.toString('base64'),
  };
}

/**
 * 打开信封：先核对签名，再把 payload 解析成 JSON（还没校验，交给 sanitizeCatalog）。
 * 验签之前只解析信封这一层，清单内容在验签通过之前不当 JSON 解析。
 */
export function openCatalogEnvelope(text: string, keys: ReadonlyMap<string, KeyObject>): EnvelopeOpen {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issue: '驱动清单地址返回的不是驱动清单' };
  }
  const envelope = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const { format, keyId, payload, signature } = envelope;
  if (format !== CATALOG_ENVELOPE_FORMAT || typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) {
    return { ok: false, issue: '驱动清单地址返回的不是驱动清单' };
  }
  const key = keys.get(keyId);
  if (!key) {
    return { ok: false, issue: `驱动清单用的签名密钥（${keyId}）这个版本的程序不认识：请更新程序` };
  }
  const payloadBytes = typeof payload === 'string' ? decodeBase64(payload) : null;
  const signatureBytes = typeof signature === 'string' ? decodeBase64(signature) : null;
  if (
    payloadBytes === null ||
    signatureBytes === null ||
    payloadBytes.length > MAX_CATALOG_PAYLOAD_BYTES ||
    signatureBytes.length !== ED25519_SIGNATURE_BYTES
  ) {
    return { ok: false, issue: '驱动清单的格式不对' };
  }
  if (!verify(null, signedBytes(payloadBytes), key, signatureBytes)) {
    return { ok: false, issue: '驱动清单的签名不对，可能被改过，不使用' };
  }
  try {
    return { ok: true, keyId, payload: JSON.parse(payloadBytes.toString('utf8')) as unknown };
  } catch {
    return { ok: false, issue: '驱动清单的内容不是 JSON' };
  }
}

function signedBytes(payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(CATALOG_SIGNING_CONTEXT, 'utf8'), payload]);
}

/** 严格的 base64：Buffer.from 会悄悄跳过非法字符，这里要求重新编码后逐字相同。 */
function decodeBase64(text: string): Buffer | null {
  if (!BASE64_PATTERN.test(text) || text.length % BASE64_BLOCK !== 0) {
    return null;
  }
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? bytes : null;
}
```

```ts
// src/main/drivers/testing/catalog-keys.ts
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { rawPublicKey, signCatalogPayload, trustedKeys } from '../catalog-signature';

export interface TestCatalogKeys {
  keyId: string;
  privateKey: KeyObject;
  /** base64 的 32 字节原始公钥（E2E 经环境变量交给程序）。 */
  publicKey: string;
  trusted: ReadonlyMap<string, KeyObject>;
}

/** 测试现场生成一对密钥：仓库里不放任何私钥。 */
export function createTestCatalogKeys(keyId = 'test'): TestCatalogKeys {
  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKey = rawPublicKey(privateKey);
  return { keyId, privateKey, publicKey, trusted: trustedKeys({ [keyId]: publicKey }) };
}

/** 把清单内容签成信封原文（测试、E2E 用；正式清单用 scripts/driver-catalog/sign.ts）。 */
export function signedCatalogText(payload: unknown, keys: TestCatalogKeys): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return JSON.stringify(signCatalogPayload(bytes, keys.keyId, keys.privateKey));
}
```

```ts
// src/shared/driver-catalog-keys.ts
/**
 * 驱动清单的签名公钥（Ed25519，32 字节原始公钥的 base64），键是密钥编号。
 * - 私钥只在出品方手里（离线保存，不进仓库）；生成、签名、换密钥见 docs/driver-catalog.md。
 * - 换密钥：先把新公钥加进来、发一版程序，等大家都更新了再用新私钥签清单，最后删掉旧公钥。
 * - 自己构建、用自己的清单：换成自己的公钥。
 * 空表时任何清单都核对不过，「驱动」一节显示清单的密钥这个版本不认识。
 */
export const DRIVER_CATALOG_PUBLIC_KEYS: Readonly<Record<string, string>> = {};
```

```ts
// src/shared/driver-catalog-url.ts
/**
 * 驱动清单的地址。项目开源，代码里不写域名：地址来自设置，没填时用构建时注入的默认值
 * （官方安装包由 CI 注入，见 src/main/drivers/build-defaults.ts）。清单必须带内置公钥能核对的签名才会用，
 * 地址只决定从哪里下载。
 */

/** 开发和 E2E 可以用本机的 http（清单照样要验签）。 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
/** 正常的地址不到 200 个字符，挡住塞进设置里的超长字符串。 */
export const MAX_CATALOG_URL_LENGTH = 2_048;

/** 合法的清单地址：https（或本机的 http），没有账号和片段；查询串可以有（有的静态存储要带版本参数）。不合法返回 null。 */
export function sanitizeCatalogUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_CATALOG_URL_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname));
  if (!isSecure || url.hash !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  return url.href;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers src/shared/driver-catalog-url.test.ts`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 核对 Electron 主进程的 Ed25519**（写计划时已在 Electron 44.4.5 / Node 24.21 上实测 `sign` / `verify` / SPKI 导入可用；版本升级过的话再跑一次）

Run（Git Bash）: `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe -e "const c=require('node:crypto');const {privateKey:k,publicKey:p}=c.generateKeyPairSync('ed25519');console.log(c.verify(null,Buffer.from('m'),p,c.sign(null,Buffer.from('m'),k)))"`（macOS 上换成 `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`）
Expected: `true`。不是 `true` 时改用 WebCrypto（`crypto.subtle.importKey('raw', …, 'Ed25519')` + `crypto.subtle.verify('Ed25519', …)`），接口不变。

- [ ] **Step 6: 提交**

```bash
git add src/main/drivers src/shared/driver-catalog-keys.ts src/shared/driver-catalog-url.ts src/shared/driver-catalog-url.test.ts
git commit -m "feat(main): Ed25519 signed envelope for the driver catalog" -m "One file holds the catalog bytes, the key id and the signature, so an upload is atomic and no JSON canonicalization is needed. The signature covers a fixed purpose prefix, the key id allows rotation, and the payload is only parsed as JSON after the signature checks out. Public keys live in the repository; the private key stays offline with the publisher." -m "$TRAILER"
```

---

### Task 4: 生成密钥、签名清单的脚本

**Files:**
- Create: `scripts/driver-catalog/catalog-signing.ts`、`catalog-signing.test.ts`
- Create: `scripts/driver-catalog/keygen.ts`、`scripts/driver-catalog/sign.ts`
- Modify: `package.json`（`scripts`）、`.gitignore`

- [ ] **Step 1: 写测试**

```ts
// scripts/driver-catalog/catalog-signing.test.ts
import { expect, test } from 'bun:test';
import { exampleModelSource } from '../../src/core/testing/driver-catalog-fixtures';
import { sanitizeCatalog } from '../../src/core/drivers/sanitize-catalog';
import { openCatalogEnvelope } from '../../src/main/drivers/catalog-signature';
import { createTestCatalogKeys } from '../../src/main/drivers/testing/catalog-keys';
import { DEFAULT_VALID_DAYS, MAX_VALID_DAYS, signCatalog } from './catalog-signing';

const keys = createTestCatalogKeys();
const NOW = Date.UTC(2026, 9, 2, 8, 0, 0);
const MS_PER_DAY = 86_400_000;
const options = { keyId: keys.keyId, privateKey: keys.privateKey, now: NOW, validDays: DEFAULT_VALID_DAYS };

test('fills in schema, version and validity and signs the models', () => {
  const result = signCatalog({ models: [exampleModelSource()] }, options);
  if (!result.ok) {
    throw new Error(result.issues.join('; '));
  }
  expect(result.version).toBe(NOW / 1000);
  const opened = openCatalogEnvelope(JSON.stringify(result.envelope), keys.trusted);
  const parsed = sanitizeCatalog(opened.ok ? opened.payload : null);
  expect(parsed).toMatchObject({
    ok: true,
    catalog: { version: NOW / 1000, issuedAt: NOW, expiresAt: NOW + DEFAULT_VALID_DAYS * MS_PER_DAY },
  });
});

test('refuses to sign when any model is invalid', () => {
  const broken = exampleModelSource({ id: 'Bad Id' });
  expect(signCatalog({ models: [exampleModelSource(), broken] }, options)).toEqual({
    ok: false,
    issues: ['第 2 个型号：编号只能用小写字母、数字和横杠，最长 64 个字符'],
  });
});

test('refuses a validity longer than the limit', () => {
  expect(signCatalog({ models: [] }, { ...options, validDays: MAX_VALID_DAYS + 1 })).toMatchObject({ ok: false });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test scripts/driver-catalog`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// scripts/driver-catalog/catalog-signing.ts
import type { KeyObject } from 'node:crypto';
import { CATALOG_SCHEMA } from '../../src/core/drivers/catalog-model';
import { sanitizeCatalog } from '../../src/core/drivers/sanitize-catalog';
import {
  type CatalogEnvelope,
  MAX_CATALOG_PAYLOAD_BYTES,
  signCatalogPayload,
} from '../../src/main/drivers/catalog-signature';

const MS_PER_SECOND = 1_000;
const MS_PER_DAY = 86_400_000;
/** 有效期默认 180 天：程序不用过期清单（防止拿旧清单回滚），半年重签一次不算麻烦。 */
export const DEFAULT_VALID_DAYS = 180;
/** 最长 400 天：有效期越长，撤下的条目（例如厂家撤回的驱动）能被重放的时间越长。 */
export const MAX_VALID_DAYS = 400;

export interface SignOptions {
  keyId: string;
  privateKey: KeyObject;
  now: number;
  validDays: number;
}

export type SignResult =
  | { ok: true; envelope: CatalogEnvelope; version: number; expiresAt: string; modelCount: number }
  | { ok: false; issues: string[] };

/**
 * 给出品方写的清单（只有 models）签名。schema、version、issuedAt、expiresAt 由脚本填：
 * 版本号取签名时刻的 Unix 秒数——不靠手工递增，也就不会忘了递增。
 * 按程序同一套 sanitizeCatalog 检查，任何一个型号不合格就不签：错在签名时暴露，不等装到用户电脑上。
 */
export function signCatalog(source: unknown, options: SignOptions): SignResult {
  if (!Number.isInteger(options.validDays) || options.validDays < 1 || options.validDays > MAX_VALID_DAYS) {
    return { ok: false, issues: [`有效期要在 1–${MAX_VALID_DAYS} 天之间`] };
  }
  const models =
    typeof source === 'object' && source !== null ? (source as Record<string, unknown>)['models'] : undefined;
  const payload = {
    schema: CATALOG_SCHEMA,
    version: Math.floor(options.now / MS_PER_SECOND),
    issuedAt: new Date(options.now).toISOString(),
    expiresAt: new Date(options.now + options.validDays * MS_PER_DAY).toISOString(),
    models,
  };
  const parsed = sanitizeCatalog(payload);
  if (!parsed.ok) {
    return { ok: false, issues: [parsed.issue] };
  }
  if (parsed.dropped.length > 0) {
    return { ok: false, issues: parsed.dropped };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length > MAX_CATALOG_PAYLOAD_BYTES) {
    return { ok: false, issues: [`清单超过 ${MAX_CATALOG_PAYLOAD_BYTES} 字节，程序不会接受`] };
  }
  return {
    ok: true,
    envelope: signCatalogPayload(bytes, options.keyId, options.privateKey),
    version: payload.version,
    expiresAt: payload.expiresAt,
    modelCount: parsed.catalog.models.length,
  };
}
```

```ts
// scripts/driver-catalog/keygen.ts
/**
 * 生成驱动清单的签名密钥：私钥写到指定文件（不覆盖已有文件），打印公钥和下一步。
 * 用法：bun run driver-catalog:keygen --out <私钥文件> --key-id <编号，例如 2026a>
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { KEY_ID_PATTERN, rawPublicKey } from '../../src/main/drivers/catalog-signature';

/** 只有自己能读写（Windows 上不生效，靠放在离线的加密盘里）。 */
const PRIVATE_KEY_FILE_MODE = 0o600;

const { values } = parseArgs({ options: { out: { type: 'string' }, 'key-id': { type: 'string' } } });
const out = values.out;
const keyId = values['key-id'];
if (out === undefined || keyId === undefined || !KEY_ID_PATTERN.test(keyId)) {
  console.error('用法：bun run driver-catalog:keygen --out <私钥文件> --key-id <编号：小写字母、数字、横杠，例如 2026a>');
  process.exit(1);
}
const { privateKey } = generateKeyPairSync('ed25519');
// wx：文件已存在就失败，不会覆盖已有的私钥。
await writeFile(out, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: PRIVATE_KEY_FILE_MODE });
console.log(`私钥已写到 ${out}：离线保存（例如加密的 U 盘），不要提交、不要上传、不要发给别人。`);
console.log(`密钥编号：${keyId}`);
console.log(`公钥：${rawPublicKey(privateKey)}`);
console.log(`下一步：把 '${keyId}': '${rawPublicKey(privateKey)}' 加进 src/shared/driver-catalog-keys.ts，提交并发布程序。`);
```

```ts
// scripts/driver-catalog/sign.ts
/**
 * 签驱动清单。
 * 用法：bun run driver-catalog:sign --in <清单源文件> --out <签好的清单> --key-id <编号> [--key <私钥文件>] [--valid-days 180]
 * 私钥文件也可以用环境变量 LABELFLASH_DRIVER_CATALOG_KEY_FILE 指定。源文件只写 models，见 docs/driver-catalog.md。
 */
import { createPrivateKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { rawPublicKey } from '../../src/main/drivers/catalog-signature';
import { DRIVER_CATALOG_PUBLIC_KEYS } from '../../src/shared/driver-catalog-keys';
import { DEFAULT_VALID_DAYS, signCatalog } from './catalog-signing';

const KEY_FILE_ENV = 'LABELFLASH_DRIVER_CATALOG_KEY_FILE';

const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    'key-id': { type: 'string' },
    key: { type: 'string' },
    'valid-days': { type: 'string' },
  },
});
const keyPath = values.key ?? process.env[KEY_FILE_ENV];
const keyId = values['key-id'];
if (values.in === undefined || values.out === undefined || keyId === undefined || keyPath === undefined) {
  console.error(`用法：bun run driver-catalog:sign --in <清单源文件> --out <签好的清单> --key-id <编号> [--key <私钥文件>]（或设 ${KEY_FILE_ENV}）[--valid-days ${DEFAULT_VALID_DAYS}]`);
  process.exit(1);
}
const privateKey = createPrivateKey(await readFile(keyPath, 'utf8'));
// 程序只认内置的公钥：签之前先核对，免得签出一份所有用户都用不了的清单。
if (DRIVER_CATALOG_PUBLIC_KEYS[keyId] !== rawPublicKey(privateKey)) {
  console.error(`这把私钥的公钥不在 src/shared/driver-catalog-keys.ts 的「${keyId}」下：程序会拒绝它签的清单。先把公钥加进去并发布程序。`);
  process.exit(1);
}
const validDays = values['valid-days'] === undefined ? DEFAULT_VALID_DAYS : Number(values['valid-days']);
const source: unknown = JSON.parse(await readFile(values.in, 'utf8'));
const result = signCatalog(source, { keyId, privateKey, now: Date.now(), validDays });
if (!result.ok) {
  console.error('清单有问题，没有签：');
  for (const issue of result.issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}
await writeFile(values.out, `${JSON.stringify(result.envelope, null, 2)}\n`);
console.log(`已签好：${result.modelCount} 个型号，版本 ${result.version}，有效期到 ${result.expiresAt}。`);
console.log('上传到清单地址即可（见 docs/driver-catalog.md）；到期前记得重新签一次。');
```

`package.json` 的 `scripts` 里 `ocr:models` 一行之前加：

```json
    "driver-catalog:keygen": "bun scripts/driver-catalog/keygen.ts",
    "driver-catalog:sign": "bun scripts/driver-catalog/sign.ts",
    "driver-catalog:describe": "bun scripts/driver-catalog/describe.ts",
```

（`describe.ts` 在 Task 11 加；这一步先加命令，Task 11 之前不要运行它。）

`.gitignore` 末尾加：

```
# 驱动清单：源文件、签好的清单和私钥都不进仓库（品牌和厂家网址只在线上清单里，见 docs/driver-catalog.md）
driver-catalog*.json
*.pem
```

- [ ] **Step 4: 跑测试，试一次脚本**

Run: `bun test scripts/driver-catalog`
Expected: PASS。

Run（临时目录里，用完删掉这个临时文件）: `bun run driver-catalog:keygen --out "$TEMP/test-key.pem" --key-id test` 后再执行一次同一命令
Expected: 第一次打印公钥；第二次因文件已存在失败（不覆盖）。再 `bun run driver-catalog:sign --in x --out y --key-id test --key "$TEMP/test-key.pem"` → 提示公钥不在 `driver-catalog-keys.ts`。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add scripts/driver-catalog package.json .gitignore
git commit -m "feat(scripts): generate keys and sign the driver catalog" -m "Signing fills in the schema, a version taken from the signing time and the validity, checks every model with the same validator as the app and refuses to sign on any problem. It also refuses a private key whose public key is not embedded in the app, so the publisher cannot ship a catalog nobody can use. Catalog sources and keys are git-ignored." -m "$TRAILER"
```

---

### Task 5: 设置 `driverCatalogUrl` 和构建时注入的默认地址

**Files:**
- Modify: `src/shared/settings.ts`、`src/shared/settings.test.ts`
- Create: `src/main/drivers/build-defaults.ts`
- Modify: `electron.vite.config.ts`、`.github/workflows/ci.yml`
- Modify: `src/shared/ipc-contract.ts`（`AppInfo`）、`src/main/index.ts`（`appInfo`）

- [ ] **Step 1: 写测试**（`settings.test.ts` 末尾加；文件里如有把整个默认设置逐字段写出来的用例，同时在里面加 `driverCatalogUrl: null`）

```ts
describe('driverCatalogUrl', () => {
  test('defaults to the address built into the installer', () => {
    expect(DEFAULT_SETTINGS.driverCatalogUrl).toBeNull();
  });

  test('keeps https addresses and drops anything else', () => {
    expect(sanitizeSettings({ driverCatalogUrl: 'https://catalog.example.com/driver-catalog.json' }).driverCatalogUrl).toBe(
      'https://catalog.example.com/driver-catalog.json',
    );
    expect(sanitizeSettings({ driverCatalogUrl: 'http://catalog.example.com/c.json' }).driverCatalogUrl).toBeNull();
    expect(sanitizeSettings({ driverCatalogUrl: 7 }).driverCatalogUrl).toBeNull();
  });
});
```

（`describe` 已从 `bun:test` 导入时不重复导入。）

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/shared/settings.test.ts`
Expected: FAIL，类型上没有 `driverCatalogUrl`。

- [ ] **Step 3: 实现**

`src/shared/settings.ts`：import 区加 `import { sanitizeCatalogUrl } from './driver-catalog-url';`（按字母顺序放在 `./driver-paper` 之类的 import 之间，Biome 报再调）。`AppSettings` 里 `mobileRelayUrl` 之后加：

```ts
  /**
   * 驱动清单的地址；null 表示用安装包自带的地址（官方安装包构建时注入，自己构建的没有）。
   * 规则见 src/shared/driver-catalog-url.ts。清单必须带内置公钥能核对的签名才会用，地址只决定从哪里下载。
   */
  driverCatalogUrl: string | null;
```

`DEFAULT_SETTINGS` 里 `mobileRelayUrl: null,` 之后加 `driverCatalogUrl: null,`；`sanitizeSettings` 里 `mobileRelayUrl` 那一行之后加：

```ts
    // 不合法的地址当作没填，回到安装包自带的地址。
    driverCatalogUrl: sanitizeCatalogUrl(input['driverCatalogUrl']),
```

```ts
// src/main/drivers/build-defaults.ts
/**
 * 构建时注入的默认驱动清单地址（electron.vite.config.ts 的 define）：官方安装包由 CI 从 Actions 变量
 * LABELFLASH_DEFAULT_DRIVER_CATALOG_URL 传入，代码里不写域名。用 bun test 直接运行源码时没有注入，按「没有默认值」处理。
 */
import { sanitizeCatalogUrl } from '../../shared/driver-catalog-url';

declare const CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL: string | undefined;

/** 安装包自带的清单地址；自己构建、没设环境变量时为 null（界面显示「未配置驱动清单地址」）。 */
export const BUILD_DEFAULT_DRIVER_CATALOG_URL: string | null = sanitizeCatalogUrl(
  typeof CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL === 'string' ? CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL : null,
);
```

`electron.vite.config.ts`：`DEFAULT_RELAY_URL_ENV` 之后加

```ts
/**
 * 驱动清单的默认地址，和中转地址一样构建时注入（代码里不写域名）。见 src/main/drivers/build-defaults.ts。
 */
const DEFAULT_DRIVER_CATALOG_URL_ENV = 'CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL';
```

`main.define` 里加一行 `[DEFAULT_DRIVER_CATALOG_URL_ENV]: JSON.stringify(process.env[DEFAULT_DRIVER_CATALOG_URL_ENV] ?? ''),`。

`.github/workflows/ci.yml`：
- `package`、`package-macos`、`release-windows`、`release-macos` 四个作业里有 `CDL_LABELFLASH_DEFAULT_RELAY_URL: ${{ vars.LABELFLASH_DEFAULT_RELAY_URL }}` 的 `env` 下各加一行 `CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL: ${{ vars.LABELFLASH_DEFAULT_DRIVER_CATALOG_URL }}`；`package` 作业上方的注释「手机扫码的默认中转地址…」改为「手机扫码的默认中转地址、驱动清单的默认地址：代码里不写域名，官方安装包从仓库的 Actions 变量注入（见 electron.vite.config.ts）。check 作业不注入：E2E 要验证「没有默认地址」时的提示。」
- `release-draft` 作业的 `env` 加同一行；「Check the tag, the version and the build settings」脚本在中转地址的检查之后加：

```bash
          if [ -z "$CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL" ]; then
            echo "::error::仓库的 Actions 变量 LABELFLASH_DEFAULT_DRIVER_CATALOG_URL 没有设置，官方安装包会没有驱动清单地址。"
            exit 1
          fi
```

- `release-draft` 里 `oven-sh/setup-bun` 之后、「Release notes from CHANGELOG.md」之前加一步：

```yaml
      # 官方安装包必须内置驱动清单的公钥，否则任何清单都核对不过（生成和填写见 docs/driver-catalog.md）。
      - name: Check the embedded driver catalog key
        shell: bash
        run: |
          if ! bun -e "import { DRIVER_CATALOG_PUBLIC_KEYS as keys } from './src/shared/driver-catalog-keys.ts'; process.exit(Object.keys(keys).length > 0 ? 0 : 1)"; then
            echo "::error::src/shared/driver-catalog-keys.ts 里没有公钥：官方安装包装不了驱动。"
            exit 1
          fi
```

`src/shared/ipc-contract.ts` 的 `AppInfo` 在 `defaultRelayUrl` 之后加：

```ts
  /** 安装包自带的驱动清单地址（设置里没填时用它）；自己构建、没有注入时为 null。 */
  defaultDriverCatalogUrl: string | null;
```

`src/main/index.ts`：import `BUILD_DEFAULT_DRIVER_CATALOG_URL`（`./drivers/build-defaults`），`appInfo` 里 `defaultRelayUrl` 之后加 `defaultDriverCatalogUrl: BUILD_DEFAULT_DRIVER_CATALOG_URL,`。

- [ ] **Step 4: 跑测试**

Run: `bun test src/shared/settings.test.ts`
Expected: PASS。再跑 `bun run check`（类型检查会找出别处构造 `AppInfo` 的地方，例如 E2E 或界面的默认值，一并补上 `defaultDriverCatalogUrl: null`）。

- [ ] **Step 5: 提交**

```bash
git add src/shared/settings.ts src/shared/settings.test.ts src/main/drivers/build-defaults.ts electron.vite.config.ts .github/workflows/ci.yml src/shared/ipc-contract.ts src/main/index.ts
git commit -m "feat(settings): driver catalog address with a build-time default" -m "Like the relay address, the official catalog address is injected at build time from an Actions variable and never written in the code. The release job refuses to publish without it or without an embedded public key, since either would leave official installers unable to install drivers." -m "$TRAILER"
```

（类型检查补的其他文件也一起 `git add`。）

---

### Task 6: 清单下载、本机记录和缓存回退

**Files:**
- Create: `src/main/drivers/catalog-state-store.ts`、`catalog-state-store.test.ts`
- Create: `src/main/drivers/catalog-client.ts`、`catalog-client.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/catalog-state-store.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openDatabase } from '../storage/database';
import { SqliteSettingsStore } from '../storage/sqlite-settings-store';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { parseStoredCatalog, SqliteCatalogStateStore } from './catalog-state-store';

let dir: string;
let db: DatabaseSync;

beforeEach(async () => {
  dir = await createTempDir('catalog-state-');
  db = openDatabase(join(dir, 'test.db'));
});

afterEach(async () => {
  db.close();
  await removeTempDir(dir);
});

test('remembers the highest version and the last catalog next to the settings', () => {
  const store = new SqliteCatalogStateStore(db);
  expect(store.load()).toBeNull();
  const state = { highestVersion: 1_790_000_000, url: 'https://catalog.example.com/c.json', envelope: '{}', fetchedAt: 1 };
  store.save(state);
  expect(new SqliteCatalogStateStore(db).load()).toEqual(state);
});

test('is not part of the settings the renderer can change', () => {
  new SqliteCatalogStateStore(db).save({ highestVersion: 9, url: 'https://c.example.com/c.json', envelope: '{}', fetchedAt: 1 });
  const settings = new SqliteSettingsStore(db);
  settings.update({ driverCatalogUrl: null });
  expect(new SqliteCatalogStateStore(db).load()?.highestVersion).toBe(9);
  expect(Object.keys(settings.current)).not.toContain('driverCatalog.state');
});

test('treats a damaged record as no record', () => {
  expect(parseStoredCatalog({ highestVersion: 'x' })).toBeNull();
  expect(parseStoredCatalog(null)).toBeNull();
});
```

```ts
// src/main/drivers/catalog-client.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { EXAMPLE_VERSION, exampleCatalogSource } from '../../core/testing/driver-catalog-fixtures';
import { CATALOG_REFRESH_MS, CatalogClient, type CatalogStateStore, type FetchFunction } from './catalog-client';
import { MAX_CATALOG_ENVELOPE_BYTES } from './catalog-signature';
import type { StoredCatalog } from './catalog-state-store';
import { createTestCatalogKeys, signedCatalogText } from './testing/catalog-keys';

const URL_A = 'https://catalog.example.com/driver-catalog.json';
const URL_B = 'https://other.example.com/driver-catalog.json';
const keys = createTestCatalogKeys();
const GOOD = signedCatalogText(exampleCatalogSource(), keys);

class MemoryStore implements CatalogStateStore {
  state: StoredCatalog | null = null;
  load(): StoredCatalog | null {
    return this.state;
  }
  save(state: StoredCatalog): void {
    this.state = state;
  }
}

let clock: FakeClock;
let store: MemoryStore;
let url: string | null;
let requests: string[];

function serving(respond: () => Response | Promise<Response>): FetchFunction {
  return async (target) => {
    requests.push(target);
    return respond();
  };
}

function client(fetch: FetchFunction): CatalogClient {
  return new CatalogClient({ url: () => url, fetch, keys: keys.trusted, store, clock, userAgent: 'test', log: () => undefined });
}

beforeEach(() => {
  clock = new FakeClock();
  store = new MemoryStore();
  url = URL_A;
  requests = [];
});

describe('CatalogClient', () => {
  test('says the address is not configured', async () => {
    url = null;
    expect(await client(serving(() => new Response(GOOD))).load(false)).toEqual({ kind: 'unconfigured' });
    expect(requests).toEqual([]);
  });

  test('downloads, verifies and remembers the version', async () => {
    const load = await client(serving(() => new Response(GOOD))).load(false);
    expect(load).toMatchObject({ kind: 'ready', source: 'network', staleIssue: null, catalog: { version: EXAMPLE_VERSION } });
    expect(store.state).toMatchObject({ highestVersion: EXAMPLE_VERSION, url: URL_A, envelope: GOOD });
  });

  test('does not download again within the refresh window unless forced', async () => {
    const catalogs = client(serving(() => new Response(GOOD)));
    await catalogs.load(false);
    clock.advance(CATALOG_REFRESH_MS - 1);
    await catalogs.load(false);
    expect(requests).toHaveLength(1);
    await catalogs.load(true);
    expect(requests).toHaveLength(2);
  });

  test('refuses a catalog with a bad signature', async () => {
    const other = createTestCatalogKeys('test');
    const load = await client(serving(() => new Response(signedCatalogText(exampleCatalogSource(), other)))).load(false);
    expect(load).toEqual({ kind: 'failed', issue: '驱动清单的签名不对，可能被改过，不使用' });
  });

  test('refuses a catalog older than the newest one used here', async () => {
    store.state = { highestVersion: EXAMPLE_VERSION + 1, url: URL_B, envelope: '{}', fetchedAt: 0 };
    const load = await client(serving(() => new Response(GOOD))).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('比这台电脑上次用的旧');
  });

  test('refuses an expired catalog', async () => {
    clock.advance(365 * 86_400_000);
    const load = await client(serving(() => new Response(GOOD))).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('过期');
  });

  test('falls back to the last catalog from the same address when offline', async () => {
    await client(serving(() => new Response(GOOD))).load(false);
    const load = await client(serving(() => Promise.reject(new TypeError('fetch failed')))).load(true);
    expect(load).toMatchObject({ kind: 'ready', source: 'cache', staleIssue: '连不上驱动清单地址：检查网络后点「重新检测」' });
  });

  test('does not use the last catalog after the address changed', async () => {
    await client(serving(() => new Response(GOOD))).load(false);
    url = URL_B;
    const load = await client(serving(() => new Response('nope', { status: 404 }))).load(false);
    expect(load).toEqual({ kind: 'failed', issue: '驱动清单地址返回 404：检查地址是否正确' });
  });

  test('stops reading a body larger than any catalog', async () => {
    const load = await client(serving(() => new Response(new Uint8Array(MAX_CATALOG_ENVELOPE_BYTES + 1)))).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('太大');
  });

  test('refuses a redirect to a plain http address', async () => {
    const load = await client(
      serving(() => {
        const response = new Response(GOOD);
        Object.defineProperty(response, 'url', { value: 'http://catalog.example.com/c.json' });
        return response;
      }),
    ).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('跳转');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/drivers/catalog-state-store.ts
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { readString } from '../storage/row-readers';

/**
 * 驱动清单的本机记录存在 settings 表的独立键里（和窗口位置一样）：它不是用户设置，
 * SqliteSettingsStore 只读写已知的设置字段，界面的 updateSettings 改不到它（降低防回滚的版本号就要改到它）。
 */
const CATALOG_STATE_KEY = 'driverCatalog.state';

export interface StoredCatalog {
  /** 这台电脑用过的最高清单版本：比它低的清单不再用。 */
  highestVersion: number;
  /** 上次下载成功的清单原文（签名信封）和它的地址：连不上时用它；地址换了就不用。 */
  url: string;
  envelope: string;
  fetchedAt: number;
}

export function parseStoredCatalog(value: unknown): StoredCatalog | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { highestVersion, url, envelope, fetchedAt } = value as Record<string, unknown>;
  return Number.isSafeInteger(highestVersion) &&
    typeof url === 'string' &&
    typeof envelope === 'string' &&
    Number.isFinite(fetchedAt)
    ? { highestVersion: highestVersion as number, url, envelope, fetchedAt: fetchedAt as number }
    : null;
}

export class SqliteCatalogStateStore {
  private readonly select: StatementSync;
  private readonly upsert: StatementSync;

  constructor(db: DatabaseSync) {
    this.select = db.prepare('SELECT value FROM settings WHERE key = :key');
    this.upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (:key, :value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  }

  load(): StoredCatalog | null {
    const row = this.select.get({ key: CATALOG_STATE_KEY });
    if (!row) {
      return null;
    }
    try {
      return parseStoredCatalog(JSON.parse(readString(row, 'value')));
    } catch (error) {
      console.warn('[drivers] the saved catalog record is unreadable, starting over', error);
      return null;
    }
  }

  save(state: StoredCatalog): void {
    this.upsert.run({ key: CATALOG_STATE_KEY, value: JSON.stringify(state) });
  }
}
```

```ts
// src/main/drivers/catalog-client.ts
import type { KeyObject } from 'node:crypto';
import { checkCatalogFreshness } from '../../core/drivers/catalog-freshness';
import type { DriverCatalog } from '../../core/drivers/catalog-model';
import { sanitizeCatalog } from '../../core/drivers/sanitize-catalog';
import type { Clock } from '../../core/types';
import { sanitizeCatalogUrl } from '../../shared/driver-catalog-url';
import { MAX_CATALOG_ENVELOPE_BYTES, openCatalogEnvelope } from './catalog-signature';
import type { StoredCatalog } from './catalog-state-store';

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export interface CatalogStateStore {
  load(): StoredCatalog | null;
  save(state: StoredCatalog): void;
}

export interface CatalogClientDeps {
  /** 设置里的地址，没填时是构建时注入的默认地址；都没有为 null。 */
  url: () => string | null;
  /** 生产环境是 Electron 的 net.fetch（走系统代理）。 */
  fetch: FetchFunction;
  keys: ReadonlyMap<string, KeyObject>;
  store: CatalogStateStore;
  clock: Clock;
  userAgent: string;
  log: (line: string) => void;
}

/** 下载清单最多等 15 秒：清单只有几十 KB。 */
export const CATALOG_FETCH_TIMEOUT_MS = 15_000;
/** 10 分钟内自动的加载（打开「驱动」一节、5a/5b 查询）不重复下载；点「重新检测」时强制下载。 */
export const CATALOG_REFRESH_MS = 10 * 60_000;

export type CatalogLoad =
  | { kind: 'unconfigured' }
  | { kind: 'ready'; catalog: DriverCatalog; source: 'network' | 'cache'; fetchedAt: number; staleIssue: string | null }
  | { kind: 'failed'; issue: string };

type Verified = { ok: true; catalog: DriverCatalog } | { ok: false; issue: string };

/** 给操作员看的下载失败原因。 */
class CatalogFetchError extends Error {}

/**
 * 下载并核对驱动清单：验签 → 严格校验 → 过期和防回滚 → 记下最高版本和原文。
 * 新下载的不能用（连不上、签名不对、过期……）时退回同一地址上次的清单（同样重新核对），并说明原因。
 */
export class CatalogClient {
  private last: { url: string; load: CatalogLoad; at: number } | null = null;

  constructor(private readonly deps: CatalogClientDeps) {}

  /** 最近一次可用的清单（给 5a、5b 的查询；不触发下载）。 */
  current(): DriverCatalog | null {
    return this.last?.load.kind === 'ready' ? this.last.load.catalog : null;
  }

  async load(force: boolean): Promise<CatalogLoad> {
    const url = this.deps.url();
    if (url === null) {
      this.last = null;
      return { kind: 'unconfigured' };
    }
    const now = this.deps.clock.now();
    const last = this.last;
    if (!force && last && last.url === url && last.load.kind === 'ready' && now - last.at < CATALOG_REFRESH_MS) {
      return last.load;
    }
    const load = await this.fetchAndVerify(url, now);
    this.last = { url, load, at: now };
    return load;
  }

  private async fetchAndVerify(url: string, now: number): Promise<CatalogLoad> {
    const stored = this.deps.store.load();
    let issue: string;
    try {
      const text = await this.download(url);
      const verified = this.verify(text, stored?.highestVersion ?? null, now);
      if (verified.ok) {
        const highestVersion = Math.max(verified.catalog.version, stored?.highestVersion ?? 0);
        this.deps.store.save({ highestVersion, url, envelope: text, fetchedAt: now });
        this.deps.log(
          `[drivers] catalog version ${verified.catalog.version} loaded from ${url} (${verified.catalog.models.length} models)`,
        );
        return { kind: 'ready', catalog: verified.catalog, source: 'network', fetchedAt: now, staleIssue: null };
      }
      issue = verified.issue;
    } catch (error) {
      issue = describeFetchError(error);
      if (!(error instanceof CatalogFetchError)) {
        this.deps.log(`[drivers] catalog download from ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.deps.log(`[drivers] catalog from ${url} not used: ${issue}`);
    return this.fromCache(stored, url, now, issue);
  }

  private fromCache(stored: StoredCatalog | null, url: string, now: number, issue: string): CatalogLoad {
    if (stored === null || stored.url !== url) {
      return { kind: 'failed', issue };
    }
    const verified = this.verify(stored.envelope, stored.highestVersion, now);
    if (!verified.ok) {
      return { kind: 'failed', issue: `${issue}；上次下载的清单也不能用：${verified.issue}` };
    }
    return { kind: 'ready', catalog: verified.catalog, source: 'cache', fetchedAt: stored.fetchedAt, staleIssue: issue };
  }

  private verify(text: string, highestVersion: number | null, now: number): Verified {
    const opened = openCatalogEnvelope(text, this.deps.keys);
    if (!opened.ok) {
      return opened;
    }
    const parsed = sanitizeCatalog(opened.payload);
    if (!parsed.ok) {
      return parsed;
    }
    for (const dropped of parsed.dropped) {
      this.deps.log(`[drivers] catalog entry skipped: ${dropped}`);
    }
    const freshness = checkCatalogFreshness(parsed.catalog, highestVersion, now);
    return freshness.ok ? { ok: true, catalog: parsed.catalog } : { ok: false, issue: freshness.issue };
  }

  private async download(url: string): Promise<string> {
    const response = await this.deps.fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': this.deps.userAgent },
    });
    if (sanitizeCatalogUrl(response.url || url) === null) {
      await response.body?.cancel();
      throw new CatalogFetchError('驱动清单地址跳转到了不安全的地址，不使用');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CatalogFetchError(`驱动清单地址返回 ${response.status}：检查地址是否正确`);
    }
    return readLimited(response);
  }
}

/** 边读边数，超过上限立即停：不把异常大的返回内容读进内存。 */
async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_CATALOG_ENVELOPE_BYTES) {
      await reader.cancel();
      throw new CatalogFetchError('驱动清单地址返回的内容太大，不是驱动清单');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function describeFetchError(error: unknown): string {
  if (error instanceof CatalogFetchError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return '下载驱动清单超时：检查网络后点「重新检测」';
  }
  return '连不上驱动清单地址：检查网络后点「重新检测」';
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/main/drivers/catalog-state-store.ts src/main/drivers/catalog-state-store.test.ts src/main/drivers/catalog-client.ts src/main/drivers/catalog-client.test.ts
git commit -m "feat(main): download, verify and remember the driver catalog" -m "The catalog is fetched with a size cap and timeout, refused on a non-https redirect, verified, validated and checked for expiry and rollback. The highest version seen and the last good catalog are kept next to the settings where the renderer cannot change them; when offline the last catalog from the same address is used again after the same checks." -m "$TRAILER"
```

---

### Task 7: 安装流程状态机（core）

下载 → 核对（大小、SHA-256、签名者）→ 提权安装 → 找新打印机。下载器、签名核对、提权安装、列打印机、等待都经接口注入；不论成功失败，下载下来的文件都交给下载器删掉。

**Files:**
- Create: `src/core/drivers/detected-device.ts`、`detected-device.test.ts`
- Create: `src/core/drivers/driver-install-flow.ts`、`driver-install-flow.test.ts`
- Create: `src/core/testing/fake-driver-ports.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/drivers/detected-device.test.ts
import { expect, test } from 'bun:test';
import { DEVICE_KEY_PATTERN, deviceKey } from './detected-device';

test('gives the same device the same key and different devices different keys', () => {
  const id = { vendorId: 0x1234, productId: 0xabcd };
  const first = deviceKey(id, 'USB\\VID_1234&PID_ABCD\\SN0001');
  expect(first).toMatch(DEVICE_KEY_PATTERN);
  expect(first.startsWith('usb-1234-abcd-')).toBe(true);
  expect(deviceKey(id, 'usb\\vid_1234&pid_abcd\\sn0001')).toBe(first);
  expect(deviceKey(id, 'USB\\VID_1234&PID_ABCD\\SN0002')).not.toBe(first);
});
```

```ts
// src/core/drivers/driver-install-flow.test.ts
import { describe, expect, test } from 'bun:test';
import { EXAMPLE_SIGNER, exampleWindowsTarget } from '../testing/driver-catalog-fixtures';
import { FakeClock } from '../testing/fake-clock';
import {
  FAKE_DOWNLOAD,
  FakeDownloader,
  FakeInstaller,
  FakePrinterList,
  FakeVerifier,
} from '../testing/fake-driver-ports';
import {
  DownloadError,
  FIND_PRINTER_TIMEOUT_MS,
  type InstallFlowDeps,
  type InstallState,
  runDriverInstall,
} from './driver-install-flow';

interface Setup {
  deps: InstallFlowDeps;
  downloader: FakeDownloader;
  verifier: FakeVerifier;
  installer: FakeInstaller;
  clock: FakeClock;
}

function setup(overrides: Partial<Omit<Setup, 'deps' | 'clock'>> & { printers?: FakePrinterList } = {}): Setup {
  const clock = new FakeClock();
  const downloader = overrides.downloader ?? new FakeDownloader(FAKE_DOWNLOAD, [524_288]);
  const verifier = overrides.verifier ?? new FakeVerifier({ status: 'valid', signer: EXAMPLE_SIGNER });
  const installer = overrides.installer ?? new FakeInstaller({ kind: 'installed', needsRestart: false });
  const printers = overrides.printers ?? new FakePrinterList([['旧打印机'], ['旧打印机', '示例标签机']]);
  return {
    clock,
    downloader,
    verifier,
    installer,
    deps: {
      downloader,
      verifier,
      installer,
      listPrinters: printers.list,
      sleep: async (ms) => clock.advance(ms),
      clock,
      log: () => undefined,
    },
  };
}

async function run(context: Setup, signal = new AbortController().signal): Promise<{ result: InstallState; steps: string[] }> {
  const states: InstallState[] = [];
  const result = await runDriverInstall(exampleWindowsTarget(), context.deps, (state) => states.push(state), signal);
  return { result, steps: states.map((state) => (state.phase === 'running' ? state.step : state.phase)) };
}

describe('runDriverInstall', () => {
  test('downloads, verifies, installs and finds the new printer, then deletes the download', async () => {
    const context = setup({ printers: new FakePrinterList([['旧打印机'], ['旧打印机'], ['旧打印机', '示例标签机']]) });
    const { result, steps } = await run(context);
    expect(result).toEqual({ phase: 'done', newPrinters: ['示例标签机'], needsRestart: false });
    expect(steps).toEqual(['downloading', 'downloading', 'verifying', 'installing', 'finding-printer', 'done']);
    expect(context.installer.installed).toEqual([FAKE_DOWNLOAD.path]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('never runs a download whose SHA-256 differs from the catalog', async () => {
    const context = setup({ downloader: new FakeDownloader({ ...FAKE_DOWNLOAD, sha256: 'e'.repeat(64) }) });
    expect((await run(context)).result).toEqual({ phase: 'failed', failure: 'hash-mismatch', exitCode: null });
    expect(context.verifier.checked).toEqual([]);
    expect(context.installer.installed).toEqual([]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('never runs a download of the wrong size', async () => {
    const context = setup({ downloader: new FakeDownloader({ ...FAKE_DOWNLOAD, sizeBytes: 1 }) });
    expect((await run(context)).result).toMatchObject({ failure: 'size-mismatch' });
    expect(context.installer.installed).toEqual([]);
  });

  test('never runs an installer signed by someone else or not validly signed', async () => {
    const other = setup({ verifier: new FakeVerifier({ status: 'valid', signer: 'CN=别人' }) });
    expect((await run(other)).result).toMatchObject({ failure: 'signer-mismatch' });
    expect(other.installer.installed).toEqual([]);
    const invalid = setup({ verifier: new FakeVerifier({ status: 'invalid', detail: 'HashMismatch' }) });
    expect((await run(invalid)).result).toMatchObject({ failure: 'signature-invalid' });
    expect(invalid.installer.installed).toEqual([]);
  });

  test('reports a declined admin prompt and an installer error with its exit code', async () => {
    expect((await run(setup({ installer: new FakeInstaller({ kind: 'declined' }) }))).result).toMatchObject({
      failure: 'admin-declined',
    });
    const failed = setup({ installer: new FakeInstaller({ kind: 'failed', exitCode: 1603 }) });
    expect((await run(failed)).result).toEqual({ phase: 'failed', failure: 'installer-failed', exitCode: 1603 });
    expect(failed.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('reports a download error without anything to delete', async () => {
    const context = setup({ downloader: new FakeDownloader(new DownloadError('too-large', 'larger than the catalog')) });
    expect((await run(context)).result).toMatchObject({ failure: 'too-large' });
    expect(context.downloader.discarded).toEqual([]);
  });

  test('stops before verifying when the operator cancels right after the download', async () => {
    const controller = new AbortController();
    const context = setup({ downloader: new FakeDownloader(FAKE_DOWNLOAD, [], () => controller.abort()) });
    expect((await run(context, controller.signal)).result).toMatchObject({ failure: 'canceled' });
    expect(context.installer.installed).toEqual([]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('finishes without a new printer when none shows up in time', async () => {
    const context = setup({ printers: new FakePrinterList([['旧打印机']]) });
    expect((await run(context)).result).toEqual({ phase: 'done', newPrinters: [], needsRestart: false });
    expect(context.clock.now() - new FakeClock().now()).toBeGreaterThanOrEqual(FIND_PRINTER_TIMEOUT_MS);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/drivers`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/core/drivers/detected-device.ts
import type { UsbId } from './usb-id';

/** no-driver：没装驱动；driver-error：装了但起不来或要重装；no-queue：macOS 上没有对应的打印队列。 */
export type DeviceProblem = 'no-driver' | 'driver-error' | 'no-queue';

/** 检测到的、还没有可用驱动的 USB 设备。 */
export interface DetectedDevice {
  /** 稳定的编号（界面按它点「安装」）：usb-<厂商号>-<产品号>-<实例路径的摘要>。 */
  key: string;
  usbId: UsbId;
  /** 系统给的名字（可能只是「未知设备」）。 */
  name: string;
  problem: DeviceProblem;
  /** Windows 设备管理器的问题代码（28 = 没装驱动）；macOS 为 null。 */
  problemCode: number | null;
  /** 系统认得出它是打印设备；不是的只在清单里有它时才列出（免得把 U 盘、扫码枪当成打印机）。 */
  isPrinterClass: boolean;
}

export const DEVICE_KEY_PATTERN = /^usb-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8}$/;

const HEX_RADIX = 16;
const USB_ID_HEX_DIGITS = 4;
const HASH_HEX_DIGITS = 8;
/** 32 位 FNV-1a（只用来区分同一台电脑上的几台设备，不是安全用途）。 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 设备编号：厂商号、产品号加上实例路径（不分大小写）的摘要；同一台设备重新检测编号不变。 */
export function deviceKey(id: UsbId, instancePath: string): string {
  const hex = (value: number) => value.toString(HEX_RADIX).padStart(USB_ID_HEX_DIGITS, '0');
  return `usb-${hex(id.vendorId)}-${hex(id.productId)}-${fnv1a(instancePath.toUpperCase())}`;
}

function fnv1a(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(HEX_RADIX).padStart(HASH_HEX_DIGITS, '0');
}
```

```ts
// src/core/drivers/driver-install-flow.ts
import type { Clock } from '../types';
import { installerFileName, type InstallTarget } from './install-plan';

export const INSTALL_STEPS = ['downloading', 'verifying', 'installing', 'finding-printer'] as const;
export type InstallStep = (typeof INSTALL_STEPS)[number];

export type InstallFailure =
  | 'download-failed'
  | 'download-timeout'
  | 'too-large'
  | 'canceled'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'signature-invalid'
  | 'signer-mismatch'
  | 'admin-declined'
  | 'installer-failed'
  | 'install-timeout'
  | 'internal';

export type InstallState =
  | { phase: 'running'; step: InstallStep; receivedBytes: number; totalBytes: number }
  | { phase: 'done'; newPrinters: string[]; needsRestart: boolean }
  /** exitCode：安装程序的退出码（只有 installer-failed 才有，提权脚本自己出错时为 null）。 */
  | { phase: 'failed'; failure: InstallFailure; exitCode: number | null };

/** 下载好的文件：大小和 SHA-256 是边下边算的。 */
export interface DownloadedFile {
  path: string;
  sizeBytes: number;
  /** 64 位小写十六进制。 */
  sha256: string;
}

export type DownloadFailure = 'download-failed' | 'download-timeout' | 'too-large' | 'canceled';

/** 下载失败：kind 决定给操作员看的原因，message 写日志。下载器失败时自己删掉已下的部分。 */
export class DownloadError extends Error {
  constructor(
    readonly kind: DownloadFailure,
    message: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface InstallerDownloader {
  /** 下载到本程序自己的临时目录；超过 expectedBytes 立即停。失败抛 DownloadError。 */
  download(
    url: string,
    expectedBytes: number,
    fileName: string,
    onProgress: (receivedBytes: number) => void,
    signal: AbortSignal,
  ): Promise<DownloadedFile>;
  /** 删掉下载的文件和它的临时目录。 */
  discard(file: DownloadedFile): Promise<void>;
}

/** valid：签名有效，signer 是签名证书的名字（Windows 的 Subject、macOS 证书链第一行）。 */
export type SignatureCheck = { status: 'valid'; signer: string } | { status: 'invalid'; detail: string };

export interface InstallerVerifier {
  check(file: DownloadedFile, target: InstallTarget): Promise<SignatureCheck>;
}

/** 提权安装的结果；hash-mismatch：提权后在管理员专属目录里复核哈希不一致（文件在核对之后被换过）。 */
export type PrivilegedOutcome =
  | { kind: 'installed'; needsRestart: boolean }
  | { kind: 'declined' }
  | { kind: 'failed'; exitCode: number | null }
  | { kind: 'timeout' }
  | { kind: 'hash-mismatch' };

export interface PrivilegedInstaller {
  install(file: DownloadedFile, target: InstallTarget): Promise<PrivilegedOutcome>;
}

export interface InstallFlowDeps {
  downloader: InstallerDownloader;
  verifier: InstallerVerifier;
  installer: PrivilegedInstaller;
  /** 系统打印机名单（装完比较前后，找出新打印机）。 */
  listPrinters: () => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
  log: (line: string) => void;
}

/** 装完驱动后系统建打印机要几秒（重新枚举 USB 设备）；30 秒还没有就提示重新插拔。 */
export const FIND_PRINTER_TIMEOUT_MS = 30_000;
export const FIND_PRINTER_INTERVAL_MS = 2_000;

/**
 * 装一个驱动。不可信的下载在核对完大小、SHA-256（清单签过的值）和签名者之前绝不运行；
 * 运行由提权安装器负责，它在管理员专属目录里再核对一次哈希。下载的文件在任何结局下都删掉。
 * 每一步写日志（地址、大小、哈希、签名者、退出码，都不是秘密）。返回最终状态，也经 onState 推出。
 */
export async function runDriverInstall(
  target: InstallTarget,
  deps: InstallFlowDeps,
  onState: (state: InstallState) => void,
  signal: AbortSignal,
): Promise<InstallState> {
  const pkg = target.package;
  const label = `[drivers] ${target.model.id}`;
  const finish = (state: InstallState): InstallState => {
    onState(state);
    return state;
  };
  const fail = (failure: InstallFailure, exitCode: number | null = null): InstallState => {
    deps.log(`${label}: not installed (${failure}${exitCode === null ? '' : `, exit code ${exitCode}`})`);
    return finish({ phase: 'failed', failure, exitCode });
  };
  const running = (step: InstallStep, receivedBytes: number): void =>
    onState({ phase: 'running', step, receivedBytes, totalBytes: pkg.sizeBytes });

  const before = await listOrNull(deps);
  running('downloading', 0);
  deps.log(`${label}: downloading ${pkg.url} (${pkg.sizeBytes} bytes)`);
  let file: DownloadedFile;
  try {
    file = await deps.downloader.download(
      pkg.url,
      pkg.sizeBytes,
      installerFileName(target),
      (received) => running('downloading', received),
      signal,
    );
  } catch (error) {
    if (error instanceof DownloadError) {
      deps.log(`${label}: download stopped: ${error.message}`);
      return fail(error.kind);
    }
    deps.log(`${label}: download failed unexpectedly: ${describeError(error)}`);
    return fail('internal');
  }

  let needsRestart = false;
  try {
    if (signal.aborted) {
      return fail('canceled');
    }
    running('verifying', file.sizeBytes);
    deps.log(`${label}: downloaded ${file.sizeBytes} bytes, sha256 ${file.sha256}`);
    if (file.sizeBytes !== pkg.sizeBytes) {
      return fail('size-mismatch');
    }
    if (file.sha256 !== pkg.sha256) {
      return fail('hash-mismatch');
    }
    const signature = await deps.verifier.check(file, target);
    deps.log(
      `${label}: signature ${signature.status === 'valid' ? `valid, signed by ${signature.signer}` : `invalid (${signature.detail})`}`,
    );
    if (signature.status !== 'valid') {
      return fail('signature-invalid');
    }
    if (signature.signer !== pkg.signer) {
      return fail('signer-mismatch');
    }
    if (signal.aborted) {
      return fail('canceled');
    }
    running('installing', file.sizeBytes);
    const outcome = await deps.installer.install(file, target);
    switch (outcome.kind) {
      case 'declined':
        return fail('admin-declined');
      case 'timeout':
        return fail('install-timeout');
      case 'hash-mismatch':
        return fail('hash-mismatch');
      case 'failed':
        return fail('installer-failed', outcome.exitCode);
      case 'installed':
        needsRestart = outcome.needsRestart;
        break;
    }
  } catch (error) {
    deps.log(`${label}: ${describeError(error)}`);
    return fail('internal');
  } finally {
    await deps.downloader
      .discard(file)
      .catch((error: unknown) => deps.log(`${label}: could not delete ${file.path}: ${describeError(error)}`));
  }

  running('finding-printer', pkg.sizeBytes);
  const newPrinters = before === null ? [] : await findNewPrinters(before, deps);
  deps.log(`${label}: installed${needsRestart ? ' (restart needed)' : ''}; new printers: ${newPrinters.join(', ') || 'none yet'}`);
  return finish({ phase: 'done', newPrinters, needsRestart });
}

/** 装之前读不到打印机名单时不找新打印机（没法比较），只说驱动装好了。 */
async function findNewPrinters(before: ReadonlySet<string>, deps: InstallFlowDeps): Promise<string[]> {
  const startedAt = deps.clock.now();
  for (;;) {
    const added = [...((await listOrNull(deps)) ?? [])].filter((name) => !before.has(name));
    if (added.length > 0 || deps.clock.now() - startedAt >= FIND_PRINTER_TIMEOUT_MS) {
      return added;
    }
    await deps.sleep(FIND_PRINTER_INTERVAL_MS);
  }
}

async function listOrNull(deps: InstallFlowDeps): Promise<Set<string> | null> {
  try {
    return new Set(await deps.listPrinters());
  } catch (error) {
    deps.log(`[drivers] cannot list printers: ${describeError(error)}`);
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

```ts
// src/core/testing/fake-driver-ports.ts
import {
  DownloadError,
  type DownloadedFile,
  type InstallerDownloader,
  type InstallerVerifier,
  type PrivilegedInstaller,
  type PrivilegedOutcome,
  type SignatureCheck,
} from '../drivers/driver-install-flow';
import { EXAMPLE_SHA256 } from './driver-catalog-fixtures';

/** 和示例清单的 Windows 安装包一致（大小、SHA-256）。 */
export const FAKE_DOWNLOAD: DownloadedFile = {
  path: '/tmp/cdl-labelflash-driver-test/driver-installer.exe',
  sizeBytes: 1_048_576,
  sha256: EXAMPLE_SHA256,
};

/** 假下载：先报几次进度，再返回结果或抛出 DownloadError；afterDownload 用来模拟下载完的那一刻操作员点了取消。 */
export class FakeDownloader implements InstallerDownloader {
  readonly discarded: string[] = [];

  constructor(
    private readonly result: DownloadedFile | DownloadError,
    private readonly progress: readonly number[] = [],
    private readonly afterDownload: () => void = () => undefined,
  ) {}

  async download(
    _url: string,
    _expectedBytes: number,
    _fileName: string,
    onProgress: (receivedBytes: number) => void,
  ): Promise<DownloadedFile> {
    for (const received of this.progress) {
      onProgress(received);
    }
    if (this.result instanceof DownloadError) {
      throw this.result;
    }
    this.afterDownload();
    return this.result;
  }

  async discard(file: DownloadedFile): Promise<void> {
    this.discarded.push(file.path);
  }
}

export class FakeVerifier implements InstallerVerifier {
  readonly checked: string[] = [];

  constructor(private readonly result: SignatureCheck) {}

  async check(file: DownloadedFile): Promise<SignatureCheck> {
    this.checked.push(file.path);
    return this.result;
  }
}

export class FakeInstaller implements PrivilegedInstaller {
  readonly installed: string[] = [];

  constructor(private readonly outcome: PrivilegedOutcome) {}

  async install(file: DownloadedFile): Promise<PrivilegedOutcome> {
    this.installed.push(file.path);
    return this.outcome;
  }
}

/** 依次返回这几份打印机名单，最后一份一直返回。 */
export class FakePrinterList {
  constructor(private readonly sequence: string[][]) {}

  readonly list = async (): Promise<string[]> =>
    (this.sequence.length > 1 ? this.sequence.shift() : this.sequence[0]) ?? [];
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/drivers`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/core/drivers src/core/testing/fake-driver-ports.ts
git commit -m "feat(core): driver install flow from download to the new printer" -m "An untrusted download is never handed to the installer until its size and SHA-256 match the signed catalog and its signer matches; the download is deleted whatever the outcome. After a successful install the printer list is polled for up to 30 seconds to name the new printer. All system access goes through injected ports so the flow is unit tested." -m "$TRAILER"
```

---

### Task 8: 安装包下载器（主进程）

**Files:**
- Create: `src/main/drivers/installer-downloader.ts`、`installer-downloader.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/installer-downloader.test.ts
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DownloadError } from '../../core/drivers/driver-install-flow';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import type { FetchFunction } from './catalog-client';
import { createInstallerDownloader } from './installer-downloader';

const INSTALLER_URL = 'https://example.invalid/drivers/x1-setup.exe';
const BYTES = new TextEncoder().encode('MZ 示例安装包'.repeat(200));
const CHUNK_BYTES = 256;
let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempDir('driver-download-');
});

afterEach(async () => {
  await removeTempDir(tempRoot);
});

function chunked(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

/** 像真的 fetch 一样：请求被取消时，正在读的响应体报错。第一块之后就不再有数据。 */
function stalled(first: Uint8Array): FetchFunction {
  return async (_url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return new Response(body);
  };
}

function downloader(fetch: FetchFunction, idleTimeoutMs?: number) {
  return createInstallerDownloader({ fetch, tempRoot, userAgent: 'test', idleTimeoutMs });
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DownloadError) {
      return error.kind;
    }
    throw error;
  }
  throw new Error('expected the download to fail');
}

const never = new AbortController().signal;

describe('createInstallerDownloader', () => {
  test('streams the file into its own temporary folder and hashes it on the way', async () => {
    const progress: number[] = [];
    const file = await downloader(async () => new Response(chunked(BYTES))).download(
      INSTALLER_URL,
      BYTES.length,
      'driver-installer.exe',
      (received) => progress.push(received),
      never,
    );
    expect(file.sizeBytes).toBe(BYTES.length);
    expect(file.sha256).toBe(createHash('sha256').update(BYTES).digest('hex'));
    expect(new Uint8Array(await readFile(file.path))).toEqual(BYTES);
    expect(progress.at(-1)).toBe(BYTES.length);
    await downloader(async () => new Response('')).discard(file);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('stops as soon as the server announces a larger file than the catalog', async () => {
    const fetch: FetchFunction = async () => new Response(BYTES, { headers: { 'Content-Length': String(BYTES.length) } });
    expect(await failureOf(downloader(fetch).download(INSTALLER_URL, BYTES.length - 1, 'a.exe', () => undefined, never))).toBe('too-large');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('stops when the body runs past the expected size without a length header', async () => {
    const fetch: FetchFunction = async () => new Response(chunked(BYTES));
    expect(await failureOf(downloader(fetch).download(INSTALLER_URL, CHUNK_BYTES, 'a.exe', () => undefined, never))).toBe('too-large');
  });

  test('refuses a download redirected to plain http', async () => {
    const fetch: FetchFunction = async () => {
      const response = new Response(BYTES);
      Object.defineProperty(response, 'url', { value: 'http://example.invalid/x1-setup.exe' });
      return response;
    };
    expect(await failureOf(downloader(fetch).download(INSTALLER_URL, BYTES.length, 'a.exe', () => undefined, never))).toBe('download-failed');
  });

  test('stops and cleans up when the operator cancels', async () => {
    const controller = new AbortController();
    const download = downloader(stalled(BYTES.slice(0, CHUNK_BYTES))).download(
      INSTALLER_URL,
      BYTES.length,
      'a.exe',
      () => controller.abort(),
      controller.signal,
    );
    expect(await failureOf(download)).toBe('canceled');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('gives up when no data arrives for a while', async () => {
    const download = downloader(stalled(BYTES.slice(0, CHUNK_BYTES)), 50).download(
      INSTALLER_URL,
      BYTES.length,
      'a.exe',
      () => undefined,
      never,
    );
    expect(await failureOf(download)).toBe('download-timeout');
  });

  test('refuses to delete anything outside its own temporary folders', async () => {
    const file = { path: `${tempRoot}/elsewhere/a.exe`, sizeBytes: 1, sha256: '' };
    await expect(downloader(async () => new Response('')).discard(file)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers/installer-downloader.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/drivers/installer-downloader.ts
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  DownloadError,
  type DownloadedFile,
  type DownloadFailure,
  type InstallerDownloader,
} from '../../core/drivers/driver-install-flow';
import type { FetchFunction } from './catalog-client';

/** 整个下载最多 30 分钟：最大 512MB，按 4Mbps 的店铺宽带约 17 分钟，留出余量。 */
export const DOWNLOAD_TOTAL_TIMEOUT_MS = 30 * 60_000;
/** 60 秒没有收到任何数据就当断线：网络慢时数据会一直来，只是慢。 */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
/** 每次下载一个新的临时目录；discard 只删这个前缀的目录。 */
const TEMP_DIR_PREFIX = 'cdl-labelflash-driver-';

export interface DownloaderDeps {
  /** 生产环境是 Electron 的 net.fetch（走系统代理）；E2E 换成内存里的假文件。 */
  fetch: FetchFunction;
  /** 系统临时目录（app.getPath('temp')）。 */
  tempRoot: string;
  userAgent: string;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/**
 * 安装包下载：只接受 https（跳转后也是）；服务器声明的大小或实际收到的字节超过清单写的大小立即停；
 * 边写文件边算 SHA-256（不把整个安装包读进内存）；失败或取消时删掉这次的临时目录。
 */
export function createInstallerDownloader(deps: DownloaderDeps): InstallerDownloader {
  return {
    async download(url, expectedBytes, fileName, onProgress, signal) {
      if (!isHttps(url)) {
        throw new DownloadError('download-failed', `not an https address: ${url}`);
      }
      const dir = await mkdtemp(join(deps.tempRoot, TEMP_DIR_PREFIX));
      const path = join(dir, fileName);
      try {
        const { sizeBytes, sha256 } = await fetchToFile(url, expectedBytes, path, onProgress, signal, deps);
        return { path, sizeBytes, sha256 };
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    },
    async discard(file) {
      const dir = dirname(file.path);
      // 只删自己建的临时目录：路径来自内部，但删除是不可逆的，多核对一下。
      if (dirname(dir) !== deps.tempRoot || !basename(dir).startsWith(TEMP_DIR_PREFIX)) {
        throw new Error(`Refusing to delete ${dir}: not a driver download folder`);
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function fetchToFile(
  url: string,
  expectedBytes: number,
  path: string,
  onProgress: (receivedBytes: number) => void,
  signal: AbortSignal,
  deps: DownloaderDeps,
): Promise<{ sizeBytes: number; sha256: string }> {
  const controller = new AbortController();
  let stopReason: DownloadFailure | null = null;
  const stop = (reason: DownloadFailure) => {
    stopReason ??= reason;
    controller.abort();
  };
  const onCancel = () => stop('canceled');
  signal.addEventListener('abort', onCancel, { once: true });
  const total = setTimeout(() => stop('download-timeout'), deps.totalTimeoutMs ?? DOWNLOAD_TOTAL_TIMEOUT_MS);
  const idleMs = deps.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS;
  let idle = setTimeout(() => stop('download-timeout'), idleMs);
  // wx：文件已存在就失败（新建的临时目录里不该有）。
  const handle = await open(path, 'wx');
  const hash = createHash('sha256');
  let received = 0;
  try {
    const response = await deps.fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': deps.userAgent },
    });
    if (!isHttps(response.url || url)) {
      throw new DownloadError('download-failed', `redirected to a non-https address: ${response.url}`);
    }
    if (!response.ok) {
      throw new DownloadError('download-failed', `HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > expectedBytes) {
      throw new DownloadError('too-large', `the server announced ${declared} bytes, the catalog says ${expectedBytes}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new DownloadError('download-failed', 'empty response');
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > expectedBytes) {
        await reader.cancel();
        throw new DownloadError('too-large', `received more than the ${expectedBytes} bytes in the catalog`);
      }
      hash.update(value);
      await handle.write(value);
      clearTimeout(idle);
      idle = setTimeout(() => stop('download-timeout'), idleMs);
      onProgress(received);
    }
  } catch (error) {
    if (error instanceof DownloadError) {
      throw error;
    }
    if (stopReason !== null) {
      throw new DownloadError(stopReason, `stopped after ${received} bytes (${stopReason})`);
    }
    throw new DownloadError('download-failed', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    signal.removeEventListener('abort', onCancel);
    await handle.close();
  }
  return { sizeBytes: received, sha256: hash.digest('hex') };
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
```

（下载器不写日志：开始、结果和失败原因（`DownloadError.message`）由流程统一写，同一件事不写两行。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers/installer-downloader.test.ts`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/main/drivers/installer-downloader.ts src/main/drivers/installer-downloader.test.ts
git commit -m "feat(main): stream driver installers to a private temp folder" -m "Only https (also after redirects); stops at once when the announced or received size exceeds the catalog; hashes while writing so a large installer never sits in memory; idle and total timeouts; cancel and failure remove the partial download, and discard only deletes folders this downloader created." -m "$TRAILER"
```

---

### Task 9: Windows 上发现缺驱动的 USB 设备

**Files:**
- Create: `src/main/drivers/run-command.ts`
- Create: `src/main/drivers/windows-devices.ts`、`windows-devices.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/windows-devices.test.ts
import { describe, expect, test } from 'bun:test';
import { parsePnpRecords, type PnpRecord, windowsDriverlessDevices } from './windows-devices';

const PRINTER_CLASS = ['USB\\Class_07&SubClass_01&Prot_02', 'USB\\Class_07&SubClass_01', 'USB\\Class_07'];

function record(overrides: Partial<PnpRecord>): PnpRecord {
  return {
    instanceId: 'USB\\VID_1234&PID_ABCD\\SN0001',
    name: '未知设备',
    pnpClass: '',
    problemCode: 28,
    compatibleIds: PRINTER_CLASS,
    parentId: '',
    ...overrides,
  };
}

describe('parsePnpRecords', () => {
  test('reads an empty answer, one object or an array', () => {
    expect(parsePnpRecords('')).toEqual([]);
    expect(parsePnpRecords('[]')).toEqual([]);
    expect(parsePnpRecords(JSON.stringify(record({})))).toEqual([record({})]);
    expect(parsePnpRecords(JSON.stringify([record({}), record({ instanceId: 'USB\\VID_1234&PID_ABCD\\SN0002' })]))).toHaveLength(2);
  });

  test('skips malformed entries and fails loudly on garbage', () => {
    expect(parsePnpRecords(JSON.stringify([{ instanceId: 7 }, record({})]))).toEqual([record({})]);
    expect(() => parsePnpRecords('Get-CimInstance : Access denied')).toThrow();
  });
});

describe('windowsDriverlessDevices', () => {
  test('lists a printer-class USB device without a driver', () => {
    expect(windowsDriverlessDevices([record({})])).toEqual([
      {
        key: expect.stringMatching(/^usb-1234-abcd-[0-9a-f]{8}$/),
        usbId: { vendorId: 0x1234, productId: 0xabcd },
        name: '未知设备',
        problem: 'no-driver',
        problemCode: 28,
        isPrinterClass: true,
      },
    ]);
  });

  test('merges the USB device and its USB printing child into one device named after the child', () => {
    const devices = windowsDriverlessDevices([
      record({ problemCode: 10 }),
      record({
        instanceId: 'USBPRINT\\EXAMPLEX1\\7&2A&0&USB001',
        name: '示例 X1',
        pnpClass: 'Printer',
        compatibleIds: [],
        parentId: 'USB\\VID_1234&PID_ABCD\\SN0001',
      }),
    ]);
    expect(devices).toEqual([expect.objectContaining({ name: '示例 X1', problem: 'no-driver', isPrinterClass: true })]);
  });

  test('keeps devices of a vendor-specific class for the catalog to recognise', () => {
    expect(windowsDriverlessDevices([record({ compatibleIds: ['USB\\Class_FF&SubClass_00', 'USB\\Class_FF'] })])).toEqual([
      expect.objectContaining({ isPrinterClass: false }),
    ]);
  });

  test('reports a driver that does not start, and ignores disabled devices', () => {
    expect(windowsDriverlessDevices([record({ problemCode: 10 })])).toEqual([
      expect.objectContaining({ problem: 'driver-error', problemCode: 10 }),
    ]);
    expect(windowsDriverlessDevices([record({ problemCode: 22 })])).toEqual([]);
  });

  test('reads one interface of a composite device', () => {
    expect(windowsDriverlessDevices([record({ instanceId: 'USB\\VID_1234&PID_ABCD&MI_00\\7&1&0&0000' })])).toEqual([
      expect.objectContaining({ usbId: { vendorId: 0x1234, productId: 0xabcd } }),
    ]);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers/windows-devices.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/drivers/run-command.ts
import { execFile } from 'node:child_process';
import { powerShellPath } from '../firewall';

export interface CommandResult {
  /** 进程的退出码；没能启动、被信号结束时为 null。 */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 命令输出最多 4MB：设备列表、签名信息都只有几 KB，system_profiler 的 USB 树也不到 1MB。 */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** 运行系统命令：参数按数组传，不经过 shell；失败不抛错，交给调用方按退出码判断。 */
export function runFile(
  file: string,
  args: readonly string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: options.timeoutMs, windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', env: options.env },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr, timedOut: false });
          return;
        }
        resolve({
          exitCode: typeof error.code === 'number' ? error.code : null,
          stdout,
          stderr,
          timedOut: error.killed === true && error.signal === 'SIGTERM',
        });
      },
    );
  });
}

/** -EncodedCommand 要 UTF-16LE 的 base64：多行脚本原样传入，不受命令行引号转义影响，中文也不乱码。 */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** 系统目录下的 PowerShell（不按名字在搜索路径里找），整段脚本 Base64 传入。 */
export function runPowerShell(script: string, timeoutMs: number): Promise<CommandResult> {
  return runFile(
    powerShellPath(process.env),
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodePowerShell(script)],
    { timeoutMs },
  );
}
```

```ts
// src/main/drivers/windows-devices.ts
import { type DetectedDevice, type DeviceProblem, deviceKey } from '../../core/drivers/detected-device';
import { parseWindowsUsbInstanceId } from '../../core/drivers/usb-id';
import { runPowerShell } from './run-command';

/** Win32_PnPEntity 里我们关心的字段（查询脚本输出的形状）。 */
export interface PnpRecord {
  instanceId: string;
  name: string;
  pnpClass: string;
  /** ConfigManagerErrorCode（设备管理器的问题代码，CM_PROB_*）。 */
  problemCode: number;
  compatibleIds: string[];
  /** USBPRINT 子设备的父设备（USB\VID_…）；其他为空。 */
  parentId: string;
}

/** 一次最多看这么多个有问题的 USB 设备：一台电脑接的 USB 设备不会超过几十个，挡住异常的输出量。 */
const MAX_DEVICE_RECORDS = 64;
/** 查询最多等 30 秒：第一次加载 CIM 和 PnpDevice 模块要几秒。 */
const DETECT_TIMEOUT_MS = 30_000;
const MAX_STDERR_LOG_LENGTH = 500;
/** 1 没配置、28 没装驱动；22 是被停用（操作员自己停的，不是驱动问题），不列出。其余是驱动装了但起不来或要重装。 */
const NO_DRIVER_CODES: ReadonlySet<number> = new Set([1, 28]);
const DISABLED_CODE = 22;
/** USB 打印机类（接口类 07），兼容 ID 里写成 USB\Class_07。 */
const PRINTER_CLASS_ID = /^USB\\Class_07(?:&|$)/i;
const USB_PRINT_PREFIX = /^USBPRINT\\/i;

/**
 * 有问题的 USB 设备和 USB 打印子设备（usbprint.sys 为打印机类设备建的 USBPRINT\…）：
 * - CIM 在服务端按问题代码过滤，不拉全部设备；
 * - USBPRINT 子设备本身没有 VID/PID，经 DEVPKEY_Device_Parent 找到 USB 父设备；
 * - 输出一行 JSON（-InputObject 保住数组，空的时候是 [] 或空串）。
 * 不需要管理员权限；只在操作员打开「驱动」一节或点「重新检测」时运行。
 */
export const WINDOWS_DEVICES_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$records = @(
  Get-CimInstance -ClassName Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' |
    Where-Object { $_.PNPDeviceID -like 'USB\VID_*' -or $_.PNPDeviceID -like 'USBPRINT\*' } |
    Select-Object -First ${MAX_DEVICE_RECORDS} |
    ForEach-Object {
      $parent = ''
      if ($_.PNPDeviceID -like 'USBPRINT\*') {
        $property = Get-PnpDeviceProperty -InstanceId $_.PNPDeviceID -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue
        if ($property) { $parent = [string]$property.Data }
      }
      [pscustomobject]@{
        instanceId = [string]$_.PNPDeviceID
        name = [string]$_.Name
        pnpClass = [string]$_.PNPClass
        problemCode = [int]$_.ConfigManagerErrorCode
        compatibleIds = @($_.CompatibleID | Select-Object -First 16)
        parentId = $parent
      }
    }
)
ConvertTo-Json -InputObject $records -Compress -Depth 3
`;

/** 解析查询输出；不是 JSON 时抛错（查询本身出了问题，交给调用方提示「检测失败」）。 */
export function parsePnpRecords(output: string): PnpRecord[] {
  const text = output.trim();
  if (text === '') {
    return [];
  }
  const parsed: unknown = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((item) => {
    const record = toRecord(item);
    return record === null ? [] : [record];
  });
}

/**
 * 按 USB 设备归并：USB 设备和它的 USBPRINT 子设备是同一台打印机。名字优先用子设备的（来自打印机自报的型号），
 * 只要有一条是「没装驱动」就算没装驱动；被停用的不列出。
 */
export function windowsDriverlessDevices(records: readonly PnpRecord[]): DetectedDevice[] {
  const groups = new Map<string, PnpRecord[]>();
  for (const record of records) {
    const usbInstance = usbInstanceOf(record);
    if (usbInstance !== null && record.problemCode !== DISABLED_CODE) {
      const key = usbInstance.toUpperCase();
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
  }
  const devices: DetectedDevice[] = [];
  for (const [instance, group] of groups) {
    const usbId = parseWindowsUsbInstanceId(instance);
    const first = group[0];
    if (usbId === null || first === undefined) {
      continue;
    }
    const child = group.find((record) => USB_PRINT_PREFIX.test(record.instanceId));
    const missing = group.find((record) => NO_DRIVER_CODES.has(record.problemCode));
    const problem: DeviceProblem = missing ? 'no-driver' : 'driver-error';
    devices.push({
      key: deviceKey(usbId, instance),
      usbId,
      name: child?.name || first.name,
      problem,
      problemCode: (missing ?? first).problemCode,
      isPrinterClass: group.some(isPrinterClass),
    });
  }
  return devices.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/** 查询这台电脑上缺驱动的 USB 设备；查询失败时抛错（带退出码和 stderr 摘要，写日志用）。 */
export async function detectWindowsDevices(): Promise<DetectedDevice[]> {
  const result = await runPowerShell(WINDOWS_DEVICES_SCRIPT, DETECT_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    throw new Error(
      `USB device query failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}): ${result.stderr.trim().slice(0, MAX_STDERR_LOG_LENGTH)}`,
    );
  }
  return windowsDriverlessDevices(parsePnpRecords(result.stdout));
}

function usbInstanceOf(record: PnpRecord): string | null {
  if (parseWindowsUsbInstanceId(record.instanceId) !== null) {
    return record.instanceId;
  }
  return parseWindowsUsbInstanceId(record.parentId) !== null ? record.parentId : null;
}

function isPrinterClass(record: PnpRecord): boolean {
  return (
    record.pnpClass === 'Printer' ||
    USB_PRINT_PREFIX.test(record.instanceId) ||
    record.compatibleIds.some((id) => PRINTER_CLASS_ID.test(id))
  );
}

function toRecord(value: unknown): PnpRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { instanceId, name, pnpClass, problemCode, compatibleIds, parentId } = value as Record<string, unknown>;
  if (typeof instanceId !== 'string' || !Number.isInteger(problemCode)) {
    return null;
  }
  return {
    instanceId,
    name: typeof name === 'string' ? name : '',
    pnpClass: typeof pnpClass === 'string' ? pnpClass : '',
    problemCode: problemCode as number,
    compatibleIds: Array.isArray(compatibleIds) ? compatibleIds.filter((id): id is string => typeof id === 'string') : [],
    parentId: typeof parentId === 'string' ? parentId : '',
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers/windows-devices.test.ts`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 在本机跑一次真实查询**（Windows，看脚本能运行、输出能解析；没接缺驱动的设备时是 `[]`）

Run: `bun -e "import('./src/main/drivers/windows-devices.ts').then(async (m) => console.log(await m.detectWindowsDevices()))"`
Expected: 打印数组，不报错。接一台没装驱动的热敏标签机时能看到它（结果记进 `docs/windows-acceptance.md`）。

- [ ] **Step 6: 提交**

```bash
git add src/main/drivers/run-command.ts src/main/drivers/windows-devices.ts src/main/drivers/windows-devices.test.ts
git commit -m "feat(main): find USB printing devices without a working driver on Windows" -m "Queries Win32_PnPEntity for USB devices with a problem code, follows USB printing children to their USB parent for the vendor and product id, and merges both into one device. Printer-class devices are always listed; vendor-specific ones only when the catalog knows them. Runs on demand in a one-off PowerShell so the resident status probe is not held up." -m "$TRAILER"
```

---

### Task 10: Windows 的签名核对和提权静默安装

**Files:**
- Create: `src/main/drivers/windows-signature.ts`、`windows-signature.test.ts`
- Create: `src/main/drivers/windows-install.ts`、`windows-install.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/windows-signature.test.ts
import { expect, test } from 'bun:test';
import { authenticodeScript, parseAuthenticode } from './windows-signature';

test('passes the path as a PowerShell literal', () => {
  expect(authenticodeScript("C:\\Users\\O'Brien\\a.exe")).toContain("$Path = 'C:\\Users\\O''Brien\\a.exe'");
});

test('reads a valid signature and its signer', () => {
  expect(parseAuthenticode('{"status":"Valid","subject":"CN=示例品牌有限公司, C=CN"}')).toEqual({
    status: 'valid',
    signer: 'CN=示例品牌有限公司, C=CN',
  });
});

test('treats every other status and unreadable output as invalid', () => {
  expect(parseAuthenticode('{"status":"NotSigned","subject":""}')).toEqual({ status: 'invalid', detail: 'NotSigned' });
  expect(parseAuthenticode('{"status":"HashMismatch","subject":"CN=x"}')).toEqual({ status: 'invalid', detail: 'HashMismatch' });
  expect(parseAuthenticode('oops')).toEqual({ status: 'invalid', detail: 'unreadable' });
});
```

```ts
// src/main/drivers/windows-install.test.ts
import { describe, expect, test } from 'bun:test';
import { EXAMPLE_SHA256, exampleWindowsTarget } from '../../core/testing/driver-catalog-fixtures';
import { encodePowerShell } from './run-command';
import { ELEVATED_EXIT, elevatedInstallScript, interpretInstallExit, launcherScript } from './windows-install';

const PATH = "C:\\Users\\O'Brien\\AppData\\Local\\Temp\\cdl-labelflash-driver-1\\driver-installer.exe";
const pkg = exampleWindowsTarget().package;
/** Windows 命令行最长 32767 个字符。 */
const MAX_COMMAND_LINE_CHARS = 32_767;

describe('elevatedInstallScript', () => {
  test('copies the verified file, re-hashes it and runs it with the silent arguments', () => {
    const script = elevatedInstallScript(PATH, pkg);
    expect(script).toContain("$Source = 'C:\\Users\\O''Brien\\AppData\\Local\\Temp\\cdl-labelflash-driver-1\\driver-installer.exe'");
    expect(script).toContain(`$Sha256 = '${EXAMPLE_SHA256}'`);
    expect(script).toContain("$Kind = 'exe'");
    expect(script).toContain("$Arguments = '/S'");
    expect(script).toContain('$SuccessCodes = @(0, 3010, 1641)');
  });

  test('runs an msi through msiexec quietly', () => {
    const script = elevatedInstallScript(PATH, { ...pkg, kind: 'msi', silentArgs: ['ALLUSERS=1'] });
    expect(script).toContain("$Kind = 'msi'");
    expect(script).toContain("$Arguments = 'ALLUSERS=1'");
    expect(script).toContain('/qn /norestart');
  });

  test('fits on one Windows command line even with the longest inputs', () => {
    const longest = { ...pkg, silentArgs: Array.from({ length: 8 }, () => 'A'.repeat(64)) };
    const launcher = launcherScript(elevatedInstallScript('C:\\'.padEnd(260, 'a'), longest), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(encodePowerShell(launcher).length).toBeLessThan(MAX_COMMAND_LINE_CHARS - 1_000);
  });
});

describe('launcherScript', () => {
  test('elevates the encoded install script once and maps a declined prompt', () => {
    const elevated = elevatedInstallScript(PATH, pkg);
    const launcher = launcherScript(elevated, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(launcher).toContain('-Verb RunAs');
    expect(launcher).toContain(encodePowerShell(elevated));
    expect(launcher).toContain(String(ELEVATED_EXIT.declined));
  });
});

describe('interpretInstallExit', () => {
  test.each([
    [{ exitCode: 0, timedOut: false }, { kind: 'installed', needsRestart: false }],
    [{ exitCode: 3010, timedOut: false }, { kind: 'installed', needsRestart: true }],
    [{ exitCode: 1641, timedOut: false }, { kind: 'installed', needsRestart: true }],
    [{ exitCode: ELEVATED_EXIT.declined, timedOut: false }, { kind: 'declined' }],
    [{ exitCode: ELEVATED_EXIT.hashMismatch, timedOut: false }, { kind: 'hash-mismatch' }],
    [{ exitCode: ELEVATED_EXIT.prepareFailed, timedOut: false }, { kind: 'failed', exitCode: null }],
    [{ exitCode: 1603, timedOut: false }, { kind: 'failed', exitCode: 1603 }],
    [{ exitCode: null, timedOut: true }, { kind: 'timeout' }],
  ] as const)('%o → %o', (result, outcome) => {
    expect(interpretInstallExit(result, [0])).toEqual(outcome);
  });

  test('accepts the extra success codes from the catalog', () => {
    expect(interpretInstallExit({ exitCode: 1, timedOut: false }, [0, 1])).toEqual({ kind: 'installed', needsRestart: false });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers/windows-signature.test.ts src/main/drivers/windows-install.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/drivers/windows-signature.ts
import type { SignatureCheck } from '../../core/drivers/driver-install-flow';
import { powerShellLiteral } from '../../shared/firewall-rule';
import { runPowerShell } from './run-command';

/** 核对签名最多等 60 秒：要联网查证书吊销列表，网络慢时要十几秒。 */
const SIGNATURE_TIMEOUT_MS = 60_000;
const VALID_STATUS = 'Valid';

/**
 * 读安装包的 Authenticode 签名：状态（Valid 才算有效：证书链可信、没被吊销、文件没被改过）和签名证书的 Subject。
 * 普通权限运行；路径写成 PowerShell 单引号字符串，整段脚本经 -EncodedCommand 传入，不经命令行转义。
 */
export function authenticodeScript(path: string): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    `$Path = ${powerShellLiteral(path)}`,
    '$sig = Get-AuthenticodeSignature -LiteralPath $Path',
    "$subject = ''",
    'if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }',
    'ConvertTo-Json -Compress -InputObject @{ status = $sig.Status.ToString(); subject = $subject }',
  ].join('\n');
}

export function parseAuthenticode(output: string): SignatureCheck {
  try {
    const parsed = JSON.parse(output.trim()) as { status?: unknown; subject?: unknown };
    if (typeof parsed.status !== 'string') {
      return { status: 'invalid', detail: 'unreadable' };
    }
    return parsed.status === VALID_STATUS && typeof parsed.subject === 'string' && parsed.subject !== ''
      ? { status: 'valid', signer: parsed.subject }
      : { status: 'invalid', detail: parsed.status };
  } catch {
    return { status: 'invalid', detail: 'unreadable' };
  }
}

export async function checkWindowsSignature(path: string): Promise<SignatureCheck> {
  const result = await runPowerShell(authenticodeScript(path), SIGNATURE_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return { status: 'invalid', detail: `query failed (exit ${result.exitCode})` };
  }
  return parseAuthenticode(result.stdout);
}
```

```ts
// src/main/drivers/windows-install.ts
import type { WindowsPackage } from '../../core/drivers/catalog-model';
import type { PrivilegedInstaller, PrivilegedOutcome } from '../../core/drivers/driver-install-flow';
import { powerShellLiteral } from '../../shared/firewall-rule';
import { powerShellPath } from '../firewall';
import { encodePowerShell, runPowerShell } from './run-command';

/**
 * 提权脚本自己的退出码。安装程序、msiexec 用的都是小数（msiexec 的错误码在 1600–1700 一带），
 * 这里取 0x4C46（"LF"）开头的大数，不会和它们撞。
 */
export const ELEVATED_EXIT = {
  /** 操作员在 UAC 框里点了「否」（外层脚本识别 Win32 错误 1223）。 */
  declined: 0x4c460001,
  /** 复制到管理员专属目录后复核 SHA-256 不一致：文件在核对之后被换过。 */
  hashMismatch: 0x4c460002,
  /** 建目录、复制、启动安装程序时出错。 */
  prepareFailed: 0x4c460003,
  /** 外层没能启动提权进程（不是操作员拒绝）。 */
  launchFailed: 0x4c460004,
} as const;
/** Windows Installer 和多数安装程序的约定：3010 = 装好了、重启后生效；1641 = 装好了、已经发起重启。 */
const REBOOT_REQUIRED_EXIT = 3010;
const REBOOT_INITIATED_EXIT = 1641;
/** UAC 被取消时 Start-Process 报的 Win32 错误（ERROR_CANCELLED）。 */
const ERROR_CANCELLED = 1223;
/**
 * 安装最多等 15 分钟：驱动安装程序一般一两分钟，加上操作员看 UAC 框的时间。
 * 超时后提权的安装进程收不回来（普通权限结束不了它），只提示操作员等它装完再「重新检测」。
 */
export const INSTALL_TIMEOUT_MS = 15 * 60_000;

/**
 * 以管理员身份运行的脚本。核对过的文件在用户自己的临时目录里，同一用户的其他程序能改它，所以：
 * 1. 在 Windows\Temp 下新建一个随机名字的目录，创建时就只给 Administrators 和 SYSTEM 完全控制（不继承，
 *    没有「先建后改权限」的空档，别人放不进同名 DLL）；
 * 2. 把文件复制进去，在那里再算一次 SHA-256，和清单一致才运行（运行的就是清单签过的那份字节）；
 * 3. exe 带静默参数直接运行；msi 交给 msiexec /i … /qn /norestart；成功后让系统重新扫描设备；
 * 4. 删掉这个目录，用退出码报告结果。
 * 只用 .NET 类型，不调用 cmdlet：提权的 PowerShell 也会先到用户的「文档」里找模块，同一用户的程序能放同名的假模块。
 * 系统目录取 [Environment]::SystemDirectory（来自系统 API），不读环境变量。
 */
export function elevatedInstallScript(source: string, pkg: WindowsPackage): string {
  const successCodes = [...new Set([...pkg.successExitCodes, REBOOT_REQUIRED_EXIT, REBOOT_INITIATED_EXIT])];
  return String.raw`
$ErrorActionPreference = 'Stop'
$Source = ${powerShellLiteral(source)}
$Sha256 = ${powerShellLiteral(pkg.sha256)}
$Kind = ${powerShellLiteral(pkg.kind)}
$Arguments = ${powerShellLiteral(pkg.silentArgs.join(' '))}
$SuccessCodes = @(${successCodes.join(', ')})
$code = ${ELEVATED_EXIT.prepareFailed}
$system = [Environment]::SystemDirectory
$dir = [IO.Path]::Combine([IO.Path]::GetDirectoryName($system), 'Temp', 'cdl-labelflash-driver-' + [Guid]::NewGuid().ToString('N'))
try {
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in 'S-1-5-32-544', 'S-1-5-18') {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $security.AddAccessRule($rule)
  }
  $null = [IO.Directory]::CreateDirectory($dir, $security)
  if ([IO.Directory]::GetFileSystemEntries($dir).Length -ne 0) { throw 'the new folder is not empty' }
  $file = [IO.Path]::Combine($dir, 'driver-installer.' + $Kind)
  [IO.File]::Copy($Source, $file)
  $stream = [IO.File]::OpenRead($file)
  try {
    $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
  }
  if ($hash -ne $Sha256) {
    $code = ${ELEVATED_EXIT.hashMismatch}
  } else {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.UseShellExecute = $false
    if ($Kind -eq 'msi') {
      $start.FileName = [IO.Path]::Combine($system, 'msiexec.exe')
      $start.Arguments = '/i "' + $file + '" /qn /norestart ' + $Arguments
    } else {
      $start.FileName = $file
      $start.Arguments = $Arguments
    }
    $process = [Diagnostics.Process]::Start($start)
    $process.WaitForExit()
    $code = $process.ExitCode
    if ($SuccessCodes -contains $code) {
      $scan = [Diagnostics.ProcessStartInfo]::new([IO.Path]::Combine($system, 'pnputil.exe'), '/scan-devices')
      $scan.UseShellExecute = $false
      $scan.CreateNoWindow = $true
      try { [Diagnostics.Process]::Start($scan).WaitForExit() } catch { }
    }
  }
} catch {
  $code = ${ELEVATED_EXIT.prepareFailed}
} finally {
  try { [IO.Directory]::Delete($dir, $true) } catch { }
}
exit $code
`;
}

/**
 * 普通权限的外层脚本：弹一次 UAC，以管理员身份运行系统目录里的 PowerShell 和整段 Base64 的提权脚本，
 * 等它结束并带回退出码。操作员点「否」时 Start-Process 抛出 Win32 错误 1223，换成 ELEVATED_EXIT.declined。
 * 和防火墙规则（src/main/firewall.ts）是同一个做法。
 */
export function launcherScript(elevated: string, powerShell: string): string {
  return String.raw`
try {
  $p = Start-Process -FilePath ${powerShellLiteral(powerShell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShell(elevated)}'
  exit $p.ExitCode
} catch {
  $e = $_.Exception
  while ($e) {
    if ($e -is [ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq ${ERROR_CANCELLED}) { exit ${ELEVATED_EXIT.declined} }
    $e = $e.InnerException
  }
  exit ${ELEVATED_EXIT.launchFailed}
}
`;
}

/** 外层进程的结果 → 安装结果。successCodes 是清单写的成功退出码（默认只有 0）。 */
export function interpretInstallExit(
  result: { exitCode: number | null; timedOut: boolean },
  successCodes: readonly number[],
): PrivilegedOutcome {
  if (result.timedOut) {
    return { kind: 'timeout' };
  }
  switch (result.exitCode) {
    case null:
      return { kind: 'failed', exitCode: null };
    case ELEVATED_EXIT.declined:
      return { kind: 'declined' };
    case ELEVATED_EXIT.hashMismatch:
      return { kind: 'hash-mismatch' };
    case ELEVATED_EXIT.prepareFailed:
    case ELEVATED_EXIT.launchFailed:
      return { kind: 'failed', exitCode: null };
    case REBOOT_REQUIRED_EXIT:
    case REBOOT_INITIATED_EXIT:
      return { kind: 'installed', needsRestart: true };
    default:
      return successCodes.includes(result.exitCode)
        ? { kind: 'installed', needsRestart: false }
        : { kind: 'failed', exitCode: result.exitCode };
  }
}

/** Windows 的提权安装器：每次安装弹一次 UAC。 */
export function createWindowsInstaller(log: (line: string) => void): PrivilegedInstaller {
  return {
    async install(file, target) {
      if (target.platform !== 'windows') {
        throw new Error(`The Windows installer cannot install a ${target.platform} package`);
      }
      const elevated = elevatedInstallScript(file.path, target.package);
      const result = await runPowerShell(launcherScript(elevated, powerShellPath(process.env)), INSTALL_TIMEOUT_MS);
      log(`[drivers] ${target.model.id}: elevated install finished with exit ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
      return interpretInstallExit(result, target.package.successExitCodes);
    },
  };
}
```

（`test.each` 的标题用 `%o` 打印对象；Bun 不支持时改成 `test.each(...)('exit %#', …)`。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers/windows-signature.test.ts src/main/drivers/windows-install.test.ts`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 在本机核对脚本能运行**（Windows；用一个系统自带的已签名程序当「安装包」核对签名脚本，不提权）

Run: `bun -e "import('./src/main/drivers/windows-signature.ts').then(async (m) => console.log(await m.checkWindowsSignature(process.env.SystemRoot + '\\\\System32\\\\notepad.exe')))"`
Expected: `{ status: 'valid', signer: 'CN=Microsoft Windows, …' }`（系统文件是目录签名的，个别版本可能报 `NotSigned`，换 `C:\Program Files\` 下任一带签名的程序）。提权安装留到真机验收（一台没装驱动的热敏标签机，见 Task 19）。

- [ ] **Step 6: 提交**

```bash
git add src/main/drivers/windows-signature.ts src/main/drivers/windows-signature.test.ts src/main/drivers/windows-install.ts src/main/drivers/windows-install.test.ts
git commit -m "feat(main): verify Authenticode and install drivers silently with one UAC prompt" -m "The elevated script copies the verified installer into a fresh folder that only Administrators and SYSTEM can write, created with that ACL, re-hashes it there and only then runs it, so the bytes executed are the bytes the signed catalog pinned even if the user temp file was swapped after verification. It uses .NET types instead of cmdlets so a fake module in the user profile cannot ride the elevation. Exit codes distinguish a declined prompt, a hash mismatch, reboot required and installer errors." -m "$TRAILER"
```

---

### Task 11: macOS 的检测、签名核对和安装；安装包信息脚本

**Files:**
- Create: `src/main/drivers/mac-devices.ts`、`mac-devices.test.ts`
- Create: `src/main/drivers/mac-install.ts`、`mac-install.test.ts`
- Create: `scripts/driver-catalog/describe.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/mac-devices.test.ts
import { describe, expect, test } from 'bun:test';
import { macDevicesWithoutQueue, parseLpstatDevices, parseSystemProfilerUsb } from './mac-devices';

/** 两种写法都要认：较早的 SPUSBDataType 和较新系统的 SPUSBHostDataType（字段名不同）。 */
const PROFILER = JSON.stringify({
  SPUSBDataType: [
    {
      _name: 'USB31Bus',
      _items: [
        { _name: '示例 X1', vendor_id: '0x1234  (示例品牌)', product_id: '0xabcd', serial_num: 'SN0001', location_id: '0x01100000 / 1' },
        { _name: 'USB Keyboard', vendor_id: '0x05ac  (Apple Inc.)', product_id: '0x0250' },
      ],
    },
  ],
  SPUSBHostDataType: [
    { _name: 'USB', _items: [{ _name: '示例 X2', USBDeviceKeyVendorID: '0x1234', USBDeviceKeyProductID: '0xabce' }] },
  ],
});

describe('parseSystemProfilerUsb', () => {
  test('walks the device tree in both formats', () => {
    expect(parseSystemProfilerUsb(PROFILER)).toEqual([
      { name: '示例 X1', serial: 'SN0001', location: '0x01100000 / 1', usbId: { vendorId: 0x1234, productId: 0xabcd } },
      { name: 'USB Keyboard', serial: null, location: null, usbId: { vendorId: 0x05ac, productId: 0x0250 } },
      { name: '示例 X2', serial: null, location: null, usbId: { vendorId: 0x1234, productId: 0xabce } },
    ]);
  });
});

describe('parseLpstatDevices', () => {
  test('reads USB queues with their model and serial', () => {
    const output = [
      'device for Office: ipp://192.168.1.20/ipp/print',
      'device for Label_X1: usb://Example/X1%20Label?serial=SN0001',
    ].join('\n');
    expect(parseLpstatDevices(output)).toEqual([{ queue: 'Label_X1', model: 'X1 Label', serial: 'SN0001' }]);
  });
});

describe('macDevicesWithoutQueue', () => {
  const devices = parseSystemProfilerUsb(PROFILER);
  const known = (id: { vendorId: number }) => id.vendorId === 0x1234;

  test('lists catalog devices that have no CUPS queue yet', () => {
    expect(macDevicesWithoutQueue(devices, [], known).map((device) => device.name)).toEqual(['示例 X1', '示例 X2']);
  });

  test('matches a queue by serial number or by model name', () => {
    const queues = [
      { queue: 'Label_X1', model: 'Whatever', serial: 'SN0001' },
      { queue: 'Label_X2', model: '示例  x2', serial: null },
    ];
    expect(macDevicesWithoutQueue(devices, queues, known)).toEqual([]);
  });
});
```

```ts
// src/main/drivers/mac-install.test.ts
import { describe, expect, test } from 'bun:test';
import { interpretOsascript, MAC_HASH_MISMATCH_EXIT, osascriptArgs, parsePkgSignature } from './mac-install';

const SIGNED = `Package "driver-installer.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Notarization: trusted by the Apple notary service
   Signed with a trusted timestamp on: 2026-09-01 08:00:00 +0000
   Certificate Chain:
    1. Developer ID Installer: 示例品牌 (EXAMPLE123)
       Expires: 2030-01-01 00:00:00 +0000
       SHA256 Fingerprint:
           00 11 22
       ------------------------------------------------------------------------
    2. Developer ID Certification Authority
`;

describe('parsePkgSignature', () => {
  test('reads the leaf certificate of an Apple-issued developer signature', () => {
    expect(parsePkgSignature(SIGNED)).toEqual({ status: 'valid', signer: 'Developer ID Installer: 示例品牌 (EXAMPLE123)' });
  });

  test('treats unsigned or self-signed packages as invalid', () => {
    expect(parsePkgSignature('Package "a.pkg":\n   Status: no signature\n')).toEqual({ status: 'invalid', detail: 'no signature' });
    expect(parsePkgSignature('Package "a.pkg":\n   Status: signed by untrusted certificate\n')).toMatchObject({ status: 'invalid' });
  });
});

describe('osascriptArgs', () => {
  test('passes the script, path and hash as arguments instead of building an AppleScript string', () => {
    const args = osascriptArgs('/tmp/x/driver-installer.pkg', 'f'.repeat(64));
    expect(args.slice(-3)).toEqual([expect.stringContaining('/usr/sbin/installer -pkg'), '/tmp/x/driver-installer.pkg', 'f'.repeat(64)]);
    expect(args.join(' ')).toContain('with administrator privileges');
  });
});

describe('interpretOsascript', () => {
  test('maps the dialog and script outcomes', () => {
    expect(interpretOsascript({ exitCode: 0, stdout: '', stderr: '', timedOut: false })).toEqual({ kind: 'installed', needsRestart: false });
    expect(interpretOsascript({ exitCode: 1, stdout: '', stderr: '0:200: execution error: User canceled. (-128)\n', timedOut: false })).toEqual({ kind: 'declined' });
    expect(interpretOsascript({ exitCode: 1, stdout: '', stderr: `execution error: (${MAC_HASH_MISMATCH_EXIT})`, timedOut: false })).toEqual({ kind: 'hash-mismatch' });
    expect(interpretOsascript({ exitCode: 1, stdout: '', stderr: 'execution error: installer: Error - The package is broken. (1)', timedOut: false })).toEqual({ kind: 'failed', exitCode: 1 });
    expect(interpretOsascript({ exitCode: null, stdout: '', stderr: '', timedOut: true })).toEqual({ kind: 'timeout' });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers/mac-devices.test.ts src/main/drivers/mac-install.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/main/drivers/mac-devices.ts
import type { DetectedDevice } from '../../core/drivers/detected-device';
import { deviceKey } from '../../core/drivers/detected-device';
import type { UsbId } from '../../core/drivers/usb-id';
import { runFile } from './run-command';

export interface MacUsbDevice {
  name: string;
  serial: string | null;
  location: string | null;
  usbId: UsbId;
}

/** CUPS 里的 USB 队列：usb://厂家/型号?serial=序列号。 */
export interface CupsUsbQueue {
  queue: string;
  model: string;
  serial: string | null;
}

const PROFILER_TIMEOUT_MS = 20_000;
const LPSTAT_TIMEOUT_MS = 10_000;
/** system_profiler 和 lpstat 的输出随系统语言变，固定成英文再解析。 */
const C_LOCALE_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const HEX_ID_PATTERN = /^0x([0-9a-f]{1,4})\b/i;
const HEX_RADIX = 16;
/** USB 厂商号、产品号各 16 位。 */
const MAX_USB_ID = 0xffff;
const MAX_STDERR_LOG_LENGTH = 500;
const LPSTAT_USB_LINE = /^device for (.+?): (usb:\/\/\S+)$/;

/**
 * 解析 `system_profiler -json SPUSBDataType SPUSBHostDataType`：递归走设备树，有厂商号和产品号的就是设备。
 * 较早的系统用 vendor_id / product_id / serial_num，较新的用 USBDeviceKey* 字段，两种都认。
 */
export function parseSystemProfilerUsb(output: string): MacUsbDevice[] {
  const devices: MacUsbDevice[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    const vendorId = hexId(record['vendor_id'] ?? record['USBDeviceKeyVendorID']);
    const productId = hexId(record['product_id'] ?? record['USBDeviceKeyProductID']);
    if (vendorId !== null && productId !== null) {
      devices.push({
        name: stringOr(record['_name'], ''),
        serial: stringOrNull(record['serial_num'] ?? record['USBDeviceKeySerialNumber']),
        location: stringOrNull(record['location_id'] ?? record['USBDeviceKeyLocationID']),
        usbId: { vendorId, productId },
      });
    }
    for (const value of Object.values(record)) {
      if (typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(JSON.parse(output) as unknown);
  return devices;
}

/** 解析 `lpstat -v`（LC_ALL=C）：只要 usb:// 队列。 */
export function parseLpstatDevices(output: string): CupsUsbQueue[] {
  return output.split('\n').flatMap((line) => {
    const match = LPSTAT_USB_LINE.exec(line.trim());
    if (!match) {
      return [];
    }
    const [, queue = '', uri = ''] = match;
    try {
      const url = new URL(uri);
      return [{ queue, model: decodeURIComponent(url.pathname.replace(/^\//, '')), serial: url.searchParams.get('serial') }];
    } catch {
      return [];
    }
  });
}

/**
 * macOS 没有「问题代码」：没装驱动的标签机就是没有 CUPS 队列。只看清单里有的型号（认不出别的设备是不是打印机），
 * 有序列号的按序列号对，没有的按型号名对（不分大小写、忽略空白）。
 */
export function macDevicesWithoutQueue(
  devices: readonly MacUsbDevice[],
  queues: readonly CupsUsbQueue[],
  isKnown: (id: UsbId) => boolean,
): DetectedDevice[] {
  return devices
    .filter((device) => isKnown(device.usbId))
    .filter(
      (device) =>
        !queues.some((queue) =>
          device.serial !== null && queue.serial !== null
            ? device.serial === queue.serial
            : normalize(device.name) === normalize(queue.model),
        ),
    )
    .map((device) => ({
      key: deviceKey(device.usbId, device.serial ?? device.location ?? device.name),
      usbId: device.usbId,
      name: device.name,
      problem: 'no-queue' as const,
      problemCode: null,
      isPrinterClass: false,
    }));
}

/** 这台 Mac 上清单里有、还没有打印队列的 USB 设备；system_profiler 失败时抛错。lpstat 失败按「没有队列」处理。 */
export async function detectMacDevices(isKnown: (id: UsbId) => boolean): Promise<DetectedDevice[]> {
  const profiler = await runFile('/usr/sbin/system_profiler', ['-json', 'SPUSBDataType', 'SPUSBHostDataType'], {
    timeoutMs: PROFILER_TIMEOUT_MS,
    env: C_LOCALE_ENV,
  });
  if (profiler.exitCode !== 0) {
    throw new Error(
      `system_profiler failed (exit ${profiler.exitCode}): ${profiler.stderr.trim().slice(0, MAX_STDERR_LOG_LENGTH)}`,
    );
  }
  const lpstat = await runFile('/usr/bin/lpstat', ['-v'], { timeoutMs: LPSTAT_TIMEOUT_MS, env: C_LOCALE_ENV });
  return macDevicesWithoutQueue(parseSystemProfilerUsb(profiler.stdout), parseLpstatDevices(lpstat.stdout), isKnown);
}

function hexId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_USB_ID) {
    return value;
  }
  const match = typeof value === 'string' ? HEX_ID_PATTERN.exec(value.trim()) : null;
  return match?.[1] === undefined ? null : Number.parseInt(match[1], HEX_RADIX);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalize(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}
```

```ts
// src/main/drivers/mac-install.ts
import type { PrivilegedInstaller, PrivilegedOutcome, SignatureCheck } from '../../core/drivers/driver-install-flow';
import { type CommandResult, runFile } from './run-command';
import { INSTALL_TIMEOUT_MS } from './windows-install';

const SIGNATURE_TIMEOUT_MS = 30_000;
const C_LOCALE_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
/** pkgutil 认为是 Apple 签发的开发者证书（或 Apple 自己）签的；自签名、不受信任的都不算。 */
const TRUSTED_STATUS = /^\s*Status: signed (?:by a (?:developer )?certificate issued by Apple|Apple Software)/m;
const STATUS_LINE = /^\s*Status: (.+)$/m;
const LEAF_CERTIFICATE = /^\s*1\. (.+)$/m;
/** 提权脚本复核哈希不一致时的退出码（和 installer 的退出码 0 / 1 分开）。 */
export const MAC_HASH_MISMATCH_EXIT = 90;
/** 操作员在系统的管理员密码框里点了「取消」（AppleScript 的 userCanceledErr）。 */
const USER_CANCELED_ERROR = -128;
const TRAILING_ERROR_NUMBER = /\((-?\d+)\)\s*$/;

/**
 * 以 root 运行的固定脚本（$1 = 核对过的 pkg，$2 = 清单里的 SHA-256）：在 root 专属的新目录（mktemp -d，权限 700）
 * 里复制、复核哈希，一致才交给系统的 installer；结束时删掉目录。和 Windows 一样，保证装的就是清单签过的那份字节。
 */
export const MAC_INSTALL_SCRIPT = [
  'set -eu',
  'dir=$(/usr/bin/mktemp -d /private/tmp/cdl-labelflash-driver.XXXXXXXX)',
  `trap '/bin/rm -rf "$dir"' EXIT`,
  '/bin/cp "$1" "$dir/driver-installer.pkg"',
  'actual=$(/usr/bin/shasum -a 256 "$dir/driver-installer.pkg" | /usr/bin/cut -d " " -f 1)',
  `[ "$actual" = "$2" ] || exit ${MAC_HASH_MISMATCH_EXIT}`,
  '/usr/sbin/installer -pkg "$dir/driver-installer.pkg" -target /',
].join('\n');

/** 解析 `pkgutil --check-signature`：可信的签名 + 证书链第一行（叶证书）的名字。 */
export function parsePkgSignature(output: string): SignatureCheck {
  const status = STATUS_LINE.exec(output)?.[1]?.trim() ?? 'unreadable';
  const leaf = LEAF_CERTIFICATE.exec(output)?.[1]?.trim();
  return TRUSTED_STATUS.test(output) && leaf !== undefined
    ? { status: 'valid', signer: leaf }
    : { status: 'invalid', detail: status };
}

export async function checkMacSignature(path: string): Promise<SignatureCheck> {
  // 没签名时 pkgutil 退出码不为 0，输出照样有 Status 行，一律按输出判断。
  const result = await runFile('/usr/sbin/pkgutil', ['--check-signature', path], {
    timeoutMs: SIGNATURE_TIMEOUT_MS,
    env: C_LOCALE_ENV,
  });
  return parsePkgSignature(result.stdout);
}

/**
 * osascript 的参数：AppleScript 用 `on run argv` 收下脚本、pkg 路径和哈希，经 `quoted form of` 转义后交给
 * `do shell script … with administrator privileges`（系统标准的管理员密码框）。路径和哈希不拼进 AppleScript 字符串。
 * 为什么用 osascript：Electron 没有提权执行的接口；AuthorizationExecuteWithPrivileges 已废弃；
 * SMJobBless 要正式签名的辅助程序，我们的程序是 ad-hoc 签名。
 */
export function osascriptArgs(pkgPath: string, sha256: string): string[] {
  return [
    '-e',
    'on run argv',
    '-e',
    'do shell script "/bin/sh -c " & quoted form of (item 1 of argv) & " sh " & quoted form of (item 2 of argv) & " " & quoted form of (item 3 of argv) with administrator privileges',
    '-e',
    'end run',
    MAC_INSTALL_SCRIPT,
    pkgPath,
    sha256,
  ];
}

/** osascript 失败时错误号在 stderr 末尾的括号里：-128 是取消，其余是脚本的退出码。 */
export function interpretOsascript(result: CommandResult): PrivilegedOutcome {
  if (result.timedOut) {
    return { kind: 'timeout' };
  }
  if (result.exitCode === 0) {
    return { kind: 'installed', needsRestart: false };
  }
  const code = Number(TRAILING_ERROR_NUMBER.exec(result.stderr.trim())?.[1]);
  if (code === USER_CANCELED_ERROR) {
    return { kind: 'declined' };
  }
  if (code === MAC_HASH_MISMATCH_EXIT) {
    return { kind: 'hash-mismatch' };
  }
  return { kind: 'failed', exitCode: Number.isInteger(code) ? code : null };
}

export function createMacInstaller(log: (line: string) => void): PrivilegedInstaller {
  return {
    async install(file, target) {
      if (target.platform !== 'mac') {
        throw new Error(`The macOS installer cannot install a ${target.platform} package`);
      }
      const result = await runFile('/usr/bin/osascript', osascriptArgs(file.path, target.package.sha256), {
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      log(`[drivers] ${target.model.id}: osascript finished with exit ${result.exitCode}: ${result.stderr.trim()}`);
      return interpretOsascript(result);
    },
  };
}
```

```ts
// scripts/driver-catalog/describe.ts
/**
 * 读安装包的信息，填清单用：大小、SHA-256、签名者（Windows 读 Authenticode，macOS 读 pkg 的签名）。
 * 用法：bun run driver-catalog:describe <安装包文件>
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { checkMacSignature } from '../../src/main/drivers/mac-install';
import { checkWindowsSignature } from '../../src/main/drivers/windows-signature';

const path = process.argv[2];
if (path === undefined) {
  console.error('用法：bun run driver-catalog:describe <安装包文件>');
  process.exit(1);
}
const bytes = await readFile(path);
const signature =
  process.platform === 'win32'
    ? await checkWindowsSignature(path)
    : process.platform === 'darwin'
      ? await checkMacSignature(path)
      : null;
console.log(
  JSON.stringify(
    {
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      signer: signature?.status === 'valid' ? signature.signer : null,
    },
    null,
    2,
  ),
);
if (signature === null) {
  console.error('这个系统读不了签名：Windows 安装包在 Windows 上读，pkg 在 Mac 上读。');
} else if (signature.status !== 'valid') {
  console.error(`签名无效（${signature.detail}）：程序不会安装它。`);
  process.exit(1);
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers/mac-devices.test.ts src/main/drivers/mac-install.test.ts`
Expected: PASS。再跑 `bun run check`。Windows 上试一次 `bun run driver-catalog:describe "C:\Program Files\<任一带签名的程序>.exe"`，看到大小、SHA-256 和签名者。

- [ ] **Step 5: 提交**

```bash
git add src/main/drivers/mac-devices.ts src/main/drivers/mac-devices.test.ts src/main/drivers/mac-install.ts src/main/drivers/mac-install.test.ts scripts/driver-catalog/describe.ts
git commit -m "feat(main): detect, verify and install catalog drivers on macOS" -m "USB devices come from system_profiler in both the old and the new format and are matched against CUPS usb queues by serial or model. A pkg must carry an Apple-issued developer signature from the signer in the catalog; it is installed by a fixed shell script run through osascript with administrator privileges, which re-hashes a root-only copy before calling installer. Paths go in as arguments, never into the AppleScript text. Also adds a script that prints size, SHA-256 and signer of an installer for the catalog. Not verified on a Mac yet." -m "$TRAILER"
```

---

### Task 12: DriverStation（主进程编排）和状态类型

**Files:**
- Create: `src/shared/drivers.ts`
- Create: `src/main/drivers/driver-station.ts`、`driver-station.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/driver-station.test.ts
import { beforeEach, describe, expect, test } from 'bun:test';
import type { DriverCatalog } from '../../core/drivers/catalog-model';
import type { DetectedDevice } from '../../core/drivers/detected-device';
import { exampleCatalog, EXAMPLE_SIGNER } from '../../core/testing/driver-catalog-fixtures';
import { FakeClock } from '../../core/testing/fake-clock';
import { FAKE_DOWNLOAD, FakeDownloader, FakeInstaller, FakePrinterList, FakeVerifier } from '../../core/testing/fake-driver-ports';
import type { DriverStatus } from '../../shared/drivers';
import type { CatalogLoad } from './catalog-client';
import { DriverStation } from './driver-station';

const KNOWN: DetectedDevice = {
  key: 'usb-1234-abcd-00000001',
  usbId: { vendorId: 0x1234, productId: 0xabcd },
  name: '未知设备',
  problem: 'no-driver',
  problemCode: 28,
  isPrinterClass: false,
};
const UNKNOWN_PRINTER: DetectedDevice = { ...KNOWN, key: 'usb-9999-0001-00000002', usbId: { vendorId: 0x9999, productId: 1 }, isPrinterClass: true };
const UNKNOWN_GADGET: DetectedDevice = { ...KNOWN, key: 'usb-9999-0002-00000003', usbId: { vendorId: 0x9999, productId: 2 } };

let clock: FakeClock;
let pushed: DriverStatus[];
let opened: string[];
let installer: FakeInstaller;
let load: CatalogLoad;

function station(platform: 'windows' | 'mac' | null = 'windows'): DriverStation {
  const catalog = (): DriverCatalog | null => (load.kind === 'ready' ? load.catalog : null);
  return new DriverStation({
    platform,
    catalog: { load: async () => load, current: catalog },
    devices: { detect: async () => [KNOWN, UNKNOWN_PRINTER, UNKNOWN_GADGET] },
    flow: {
      downloader: new FakeDownloader(FAKE_DOWNLOAD),
      verifier: new FakeVerifier({ status: 'valid', signer: EXAMPLE_SIGNER }),
      installer,
      listPrinters: new FakePrinterList([[], ['示例标签机']]).list,
      sleep: async (ms) => clock.advance(ms),
      clock,
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    onStatus: (status) => pushed.push(status),
    clock,
    log: () => undefined,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  pushed = [];
  opened = [];
  installer = new FakeInstaller({ kind: 'installed', needsRestart: false });
  load = { kind: 'ready', catalog: exampleCatalog(), source: 'network', fetchedAt: clock.now(), staleIssue: null };
});

describe('DriverStation', () => {
  test('lists printer devices and catalog devices with what can be done for each', async () => {
    const status = await station().detect(false);
    expect(status.devices?.map((device) => [device.usbId, device.action.kind])).toEqual([
      ['1234:ABCD', 'install'],
      ['9999:0001', 'not-in-catalog'],
    ]);
    expect(status.catalog).toMatchObject({ state: 'ready', modelCount: 1, staleIssue: null });
  });

  test('says the catalog is not configured and still lists printer devices', async () => {
    load = { kind: 'unconfigured' };
    const status = await station().detect(false);
    expect(status.catalog).toEqual({ state: 'unconfigured' });
    expect(status.devices?.map((device) => device.action.kind)).toEqual(['no-catalog']);
  });

  test('installs, pushes progress, finds the new printer and refreshes the devices', async () => {
    const drivers = station();
    await drivers.detect(false);
    drivers.install(KNOWN.key);
    await drivers.settled();
    expect(installer.installed).toEqual([FAKE_DOWNLOAD.path]);
    expect(drivers.status().install).toMatchObject({
      id: 1,
      modelId: 'example-x1',
      deviceKey: KNOWN.key,
      state: { phase: 'done', newPrinters: ['示例标签机'] },
    });
    expect(pushed.some((status) => status.install?.state.phase === 'running')).toBe(true);
  });

  test('refuses a second install while one is running and unknown devices', async () => {
    const drivers = station();
    await drivers.detect(false);
    drivers.install(KNOWN.key);
    expect(() => drivers.install(KNOWN.key)).toThrow();
    await drivers.settled();
    expect(() => drivers.install('usb-0000-0000-00000000')).toThrow();
    expect(() => drivers.install(UNKNOWN_PRINTER.key)).toThrow();
  });

  test('opens only the https download page from the catalog', async () => {
    const drivers = station('mac');
    await drivers.detect(false);
    await drivers.openDownloadPage(KNOWN.key);
    expect(opened).toEqual(['https://example.invalid/drivers/x1-mac']);
    await expect(drivers.openDownloadPage(UNKNOWN_PRINTER.key)).rejects.toThrow();
  });

  test('does nothing on an unsupported platform', async () => {
    const status = await station(null).detect(false);
    expect(status).toMatchObject({ platform: 'unsupported', devices: null });
  });

  test('answers driver name questions from the current catalog', async () => {
    const drivers = station();
    expect(drivers.hints().modelForDriverName('示例品牌 X1')).toMatchObject({ modelId: 'example-x1', canInstall: true });
    load = { kind: 'unconfigured' };
    expect(drivers.hints().modelForDriverName('示例品牌 X1')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers/driver-station.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/shared/drivers.ts
import type { DeviceProblem } from '../core/drivers/detected-device';
import type { InstallState } from '../core/drivers/driver-install-flow';

export { DEVICE_KEY_PATTERN } from '../core/drivers/detected-device';

export type DriverPlatformView = 'windows' | 'mac' | 'unsupported';

/** staleIssue 不为 null：新清单用不了，用的是上次下载的（原因写在里面）。 */
export type CatalogView =
  | { state: 'unconfigured' }
  | { state: 'loading' }
  | { state: 'ready'; issuedAt: number; expiresAt: number; modelCount: number; staleIssue: string | null }
  | { state: 'failed'; issue: string };

export type DeviceActionView =
  | { kind: 'install'; brand: string; model: string; sizeBytes: number }
  | { kind: 'open-page'; brand: string; model: string }
  | { kind: 'no-package'; brand: string; model: string }
  | { kind: 'not-in-catalog' }
  | { kind: 'no-catalog' };

export interface DriverDeviceView {
  key: string;
  /** 系统给的名字。 */
  name: string;
  /** 0A5F:0120。 */
  usbId: string;
  problem: DeviceProblem;
  problemCode: number | null;
  action: DeviceActionView;
}

export interface DriverInstallView {
  /** 每次安装一个新编号：界面据此只在一次安装完成时刷新一次打印机列表。 */
  id: number;
  modelId: string;
  /** 从「驱动」一节的设备点的；从 5b 的「重新安装驱动」来的为 null。 */
  deviceKey: string | null;
  brand: string;
  model: string;
  state: InstallState;
}

export interface DriverStatus {
  platform: DriverPlatformView;
  catalog: CatalogView;
  /** null = 还没检测过。 */
  devices: DriverDeviceView[] | null;
  isDetecting: boolean;
  /** 检测 USB 设备失败时的说明。 */
  detectIssue: string | null;
  /** 最近一次安装（进行中或已结束）；没装过为 null。 */
  install: DriverInstallView | null;
}
```

```ts
// src/main/drivers/driver-station.ts
import { catalogDriverHints } from '../../core/drivers/catalog-hints';
import type { CatalogModel, DriverCatalog } from '../../core/drivers/catalog-model';
import type { DetectedDevice } from '../../core/drivers/detected-device';
import { type DriverHints, NO_DRIVER_HINTS } from '../../core/drivers/driver-hints';
import { type InstallFlowDeps, type InstallState, runDriverInstall } from '../../core/drivers/driver-install-flow';
import {
  actionFor,
  type DriverPlatform,
  findModelById,
  findModelByUsbId,
  type InstallTarget,
} from '../../core/drivers/install-plan';
import { formatUsbId } from '../../core/drivers/usb-id';
import type { Clock } from '../../core/types';
import type { CatalogView, DeviceActionView, DriverDeviceView, DriverInstallView, DriverStatus } from '../../shared/drivers';
import type { CatalogLoad } from './catalog-client';

export interface DeviceSource {
  /** 这台电脑上缺驱动的 USB 设备；macOS 要靠清单认型号，所以传入当前清单。检测失败时抛错。 */
  detect(catalog: DriverCatalog | null): Promise<DetectedDevice[]>;
}

export interface CatalogSource {
  load(force: boolean): Promise<CatalogLoad>;
  current(): DriverCatalog | null;
}

export interface DriverStationDeps {
  /** null = 这个平台不支持自动装驱动。 */
  platform: DriverPlatform | null;
  catalog: CatalogSource;
  devices: DeviceSource;
  flow: Omit<InstallFlowDeps, 'log'>;
  openExternal: (url: string) => Promise<void>;
  onStatus: (status: DriverStatus) => void;
  clock: Clock;
  log: (line: string) => void;
}

/** 下载进度最多 0.25 秒推一次（和批量打印的进度一样）；换步骤、结束立即推。 */
export const PROGRESS_PUSH_INTERVAL_MS = 250;

/**
 * 「驱动」一节在主进程的一侧：清单、检测到的设备、同一时间只有一个的安装。
 * 界面只能按设备编号（或 5b 按打印机）发起安装，不能指定地址或安装包。
 */
export class DriverStation {
  private catalogLoad: CatalogLoad | null = null;
  private devices: DetectedDevice[] | null = null;
  private detectIssue: string | null = null;
  private detecting: Promise<DriverStatus> | null = null;
  private isDetecting = false;
  private install: DriverInstallView | null = null;
  private installCount = 0;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private lastPushAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: DriverStationDeps) {}

  /** 正在装驱动（后台静默更新要等它）。 */
  get isInstalling(): boolean {
    return this.install?.state.phase === 'running';
  }

  status(): DriverStatus {
    const catalog = this.currentCatalog();
    return {
      platform: this.deps.platform ?? 'unsupported',
      catalog: catalogView(this.catalogLoad),
      devices: this.devices === null ? null : this.devices.flatMap((device) => this.deviceView(device, catalog)),
      isDetecting: this.isDetecting,
      detectIssue: this.detectIssue,
      install: this.install,
    };
  }

  /** 读清单（force：不管刷新间隔，重新下载）并检测设备；同时只跑一次，重复调用拿到同一个结果。 */
  detect(force: boolean): Promise<DriverStatus> {
    if (this.deps.platform === null) {
      return Promise.resolve(this.status());
    }
    if (this.detecting === null) {
      // 先标记再推送：界面立即看到「检测中…」（runDetect 里的第一个 await 之前，detecting 还没赋值）。
      this.isDetecting = true;
      this.push(true);
      this.detecting = this.runDetect(force).finally(() => {
        this.detecting = null;
        this.isDetecting = false;
        this.push(true);
      });
    }
    return this.detecting;
  }

  /** 给「驱动」一节里列出的一台设备装驱动；进度经 onStatus 推送。已有安装在进行、设备不认识或没有安装包时抛错。 */
  install(deviceKey: string): DriverStatus {
    const device = this.devices?.find((item) => item.key === deviceKey);
    const catalog = this.currentCatalog();
    if (!device || catalog === null) {
      throw new Error(`Unknown driver device: ${deviceKey}`);
    }
    this.start(this.requireTarget(findModelByUsbId(catalog, device.usbId)), deviceKey);
    return this.status();
  }

  /** 按型号编号装（5b 的「重新安装驱动」经驱动名找到型号后调用）。 */
  async installModel(modelId: string): Promise<DriverStatus> {
    await this.ensureCatalog();
    const catalog = this.currentCatalog();
    this.start(this.requireTarget(catalog === null ? null : findModelById(catalog, modelId)), null);
    return this.status();
  }

  cancelInstall(): void {
    this.controller?.abort();
  }

  /** 等正在进行的安装（含之后的重新检测）结束：测试和退出时用。 */
  async settled(): Promise<void> {
    await this.running;
  }

  /** 打开清单里这台设备的官方下载页（只有 open-page 的设备；地址来自签过名的清单，再核对一次是 https）。 */
  async openDownloadPage(deviceKey: string): Promise<void> {
    const device = this.devices?.find((item) => item.key === deviceKey);
    const catalog = this.currentCatalog();
    const model = device && catalog ? findModelByUsbId(catalog, device.usbId) : null;
    const action = this.deps.platform === null ? null : actionFor(model, this.deps.platform);
    if (action?.kind !== 'open-page' || new URL(action.url).protocol !== 'https:') {
      throw new Error(`No download page for driver device: ${deviceKey}`);
    }
    this.deps.log(`[drivers] opening the download page of ${action.model.id}: ${action.url}`);
    await this.deps.openExternal(action.url);
  }

  /** 给 5a、5b：按驱动名查当前清单（不触发下载；清单不可用时什么都查不到）。 */
  hints(): DriverHints {
    const catalog = this.currentCatalog();
    return catalog === null || this.deps.platform === null
      ? NO_DRIVER_HINTS
      : catalogDriverHints(catalog, this.deps.platform);
  }

  /** 设置里的清单地址变了：检测过的话立即按新地址重新检测。 */
  catalogUrlChanged(): void {
    if (this.devices !== null || this.catalogLoad !== null) {
      void this.detect(true);
    }
  }

  private currentCatalog(): DriverCatalog | null {
    return this.deps.catalog.current();
  }

  private async ensureCatalog(): Promise<void> {
    this.catalogLoad = await this.deps.catalog.load(false);
  }

  private async runDetect(force: boolean): Promise<DriverStatus> {
    this.catalogLoad = await this.deps.catalog.load(force);
    try {
      this.devices = await this.deps.devices.detect(this.currentCatalog());
      this.detectIssue = null;
    } catch (error) {
      this.deps.log(`[drivers] USB device detection failed: ${error instanceof Error ? error.message : String(error)}`);
      this.detectIssue = '检测 USB 设备失败，详情见日志：稍后点「重新检测」';
    }
    return this.status();
  }

  private requireTarget(model: CatalogModel | null): InstallTarget {
    if (this.deps.platform === null) {
      throw new Error('Driver install is not supported on this platform');
    }
    if (this.isInstalling) {
      throw new Error('A driver install is already running');
    }
    const action = actionFor(model, this.deps.platform);
    if (action.kind !== 'install') {
      throw new Error(`Nothing to install for ${model?.id ?? 'an unknown model'} (${action.kind})`);
    }
    return action.target;
  }

  private start(target: InstallTarget, deviceKey: string | null): void {
    const controller = new AbortController();
    this.controller = controller;
    this.installCount += 1;
    this.install = {
      id: this.installCount,
      modelId: target.model.id,
      deviceKey,
      brand: target.model.brand,
      model: target.model.model,
      state: { phase: 'running', step: 'downloading', receivedBytes: 0, totalBytes: target.package.sizeBytes },
    };
    this.push(true);
    this.running = this.run(target, controller.signal);
  }

  private async run(target: InstallTarget, signal: AbortSignal): Promise<void> {
    try {
      await runDriverInstall(target, { ...this.deps.flow, log: this.deps.log }, (state) => this.setState(state), signal);
    } catch (error) {
      this.deps.log(`[drivers] install of ${target.model.id} stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      this.setState({ phase: 'failed', failure: 'internal', exitCode: null });
    } finally {
      this.controller = null;
    }
    // 装好的设备不再缺驱动：重新检测一次，列表跟着变。
    await this.detect(false);
  }

  private setState(state: InstallState): void {
    const current = this.install;
    if (current === null) {
      return;
    }
    const isSameStep = current.state.phase === 'running' && state.phase === 'running' && current.state.step === state.step;
    this.install = { ...current, state };
    this.push(!isSameStep);
  }

  private push(immediately: boolean): void {
    const now = this.deps.clock.now();
    if (!immediately && now - this.lastPushAt < PROGRESS_PUSH_INTERVAL_MS) {
      return;
    }
    this.lastPushAt = now;
    this.deps.onStatus(this.status());
  }

  private deviceView(device: DetectedDevice, catalog: DriverCatalog | null): DriverDeviceView[] {
    const model = catalog === null ? null : findModelByUsbId(catalog, device.usbId);
    if (model === null && !device.isPrinterClass) {
      return [];
    }
    return [
      {
        key: device.key,
        name: device.name,
        usbId: formatUsbId(device.usbId),
        problem: device.problem,
        problemCode: device.problemCode,
        action: this.actionView(catalog, model),
      },
    ];
  }

  private actionView(catalog: DriverCatalog | null, model: CatalogModel | null): DeviceActionView {
    if (catalog === null || this.deps.platform === null) {
      return { kind: 'no-catalog' };
    }
    const action = actionFor(model, this.deps.platform);
    switch (action.kind) {
      case 'install':
        return { kind: 'install', brand: action.target.model.brand, model: action.target.model.model, sizeBytes: action.target.package.sizeBytes };
      case 'open-page':
      case 'no-package':
        return { kind: action.kind, brand: action.model.brand, model: action.model.model };
      case 'not-in-catalog':
        return { kind: 'not-in-catalog' };
    }
  }
}

function catalogView(load: CatalogLoad | null): CatalogView {
  if (load === null) {
    return { state: 'loading' };
  }
  switch (load.kind) {
    case 'unconfigured':
      return { state: 'unconfigured' };
    case 'failed':
      return { state: 'failed', issue: load.issue };
    case 'ready':
      return {
        state: 'ready',
        issuedAt: load.catalog.issuedAt,
        expiresAt: load.catalog.expiresAt,
        modelCount: load.catalog.models.length,
        staleIssue: load.staleIssue,
      };
  }
}
```

（`runDetect` 返回的状态里 `isDetecting` 还是 true；`detect` 的 `finally` 再推一次 false 的状态，界面以推送为准。测试里 `install` 后 `settled()` 等的是 `run`，`run` 末尾的 `detect` 也在里面。）

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/drivers/driver-station.test.ts`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/shared/drivers.ts src/main/drivers/driver-station.ts src/main/drivers/driver-station.test.ts
git commit -m "feat(main): DriverStation orchestrates catalog, detection and one install at a time" -m "Lists printer-class devices and devices the catalog knows, with what can be done for each on this platform. The renderer can only start an install by device key and only open a download page taken from the signed catalog, never pass an address. Progress is merged to at most four pushes a second; after an install the devices are detected again. Commands and diagnosis get driver name hints from the current catalog." -m "$TRAILER"
```

---

### Task 13: 假驱动环境、IPC 和接线

**Files:**
- Create: `src/main/drivers/fake-drivers.ts`、`fake-drivers.test.ts`
- Create: `src/main/drivers/driver-ports.ts`
- Modify: `src/main/printing/fake-printers.ts`、`fake-printers.test.ts`（`add`）
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc-validators.ts`、`ipc-validators.test.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/drivers/fake-drivers.test.ts
import { expect, test } from 'bun:test';
import { exampleWindowsTarget } from '../../core/testing/driver-catalog-fixtures';
import { FakePrinters } from '../printing/fake-printers';
import { FakeDrivers, parseFakeDrivers, testCatalogKey } from './fake-drivers';

const DEVICE = {
  instanceId: 'USB\\VID_1234&PID_ABCD\\E2E0001',
  name: '未知设备',
  pnpClass: '',
  problemCode: 28,
  compatibleIds: ['USB\\Class_07'],
  parentId: '',
};
const SPEC = {
  devices: [DEVICE],
  files: { 'https://example.invalid/drivers/x1-setup.exe': Buffer.from('MZ').toString('base64') },
  authenticode: { status: 'Valid', subject: 'CN=示例品牌有限公司' },
  installExitCode: 0,
  printerAfterInstall: { name: '示例标签机', paper: null, readiness: null },
};

test('is only read by unpackaged builds', () => {
  const env = { CDL_LABELFLASH_FAKE_DRIVERS: JSON.stringify(SPEC), CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY: 'AAAA' };
  expect(parseFakeDrivers(env, true)).toBeNull();
  expect(testCatalogKey(env, true)).toEqual({});
  expect(parseFakeDrivers(env, false)).toEqual(SPEC);
  expect(testCatalogKey(env, false)).toEqual({ e2e: 'AAAA' });
});

test('serves fake installers, then removes the device and adds the printer after a successful install', async () => {
  const printers = new FakePrinters([]);
  const drivers = new FakeDrivers(SPEC, printers);
  const response = await drivers.fetch()('https://example.invalid/drivers/x1-setup.exe', {});
  expect(await response.text()).toBe('MZ');
  expect((await drivers.fetch()('https://example.invalid/other.exe', {})).status).toBe(404);
  expect(await drivers.deviceSource().detect(null)).toHaveLength(1);
  const file = { path: 'C:\\temp\\driver-installer.exe', sizeBytes: 2, sha256: '' };
  expect(await drivers.installer().install(file, exampleWindowsTarget())).toEqual({ kind: 'installed', needsRestart: false });
  expect(drivers.installs).toEqual([file.path]);
  expect(await drivers.deviceSource().detect(null)).toEqual([]);
  expect((await printers.listPrinters()).map((printer) => printer.name)).toEqual(['示例标签机']);
});
```

`fake-printers.test.ts` 的 `describe('FakePrinters')` 里加：

```ts
  test('adds a printer, as if a driver had just been installed', async () => {
    const printers = new FakePrinters([]);
    printers.add({ name: '示例标签机', paper: null, readiness: null });
    expect((await printers.listPrinters()).map((printer) => printer.name)).toEqual(['示例标签机']);
  });
```

`ipc-validators.test.ts` 加（import 列表里按字母顺序加上 `requireDriverDeviceKey`）：

```ts
describe('requireDriverDeviceKey', () => {
  test('accepts device keys and rejects anything else', () => {
    expect(requireDriverDeviceKey('usb-1234-abcd-0a1b2c3d')).toBe('usb-1234-abcd-0a1b2c3d');
    expect(() => requireDriverDeviceKey('https://example.invalid/x.exe')).toThrow();
    expect(() => requireDriverDeviceKey(7)).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/drivers/fake-drivers.test.ts src/main/printing/fake-printers.test.ts src/main/ipc-validators.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/main/printing/fake-printers.ts`：`FakePrinters` 改为持有一份可变的名单，加 `add`：

```ts
export class FakePrinters {
  readonly printed: FakePrint[] = [];
  private readonly specs: FakePrinterSpec[];

  constructor(specs: readonly FakePrinterSpec[]) {
    this.specs = [...specs];
  }

  /** 假驱动装好以后系统里多出一台打印机（E2E 的驱动安装用，见 drivers/fake-drivers.ts）。 */
  add(spec: FakePrinterSpec): void {
    this.specs.push(spec);
  }
```

（类里其余方法不变。）

```ts
// src/main/drivers/fake-drivers.ts
import { setTimeout as sleep } from 'node:timers/promises';
import type { CatalogModel } from '../../core/drivers/catalog-model';
import type { InstallerVerifier, PrivilegedInstaller } from '../../core/drivers/driver-install-flow';
import { isSameUsbId, parseWindowsUsbInstanceId } from '../../core/drivers/usb-id';
import type { FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import type { FetchFunction } from './catalog-client';
import type { DeviceSource } from './driver-station';
import { type PnpRecord, windowsDriverlessDevices } from './windows-devices';
import { interpretInstallExit } from './windows-install';
import { parseAuthenticode } from './windows-signature';

/**
 * 仅开发 / E2E：假的缺驱动设备、安装包下载、签名核对和提权安装（和 CDL_LABELFLASH_FAKE_PRINTERS 一样，安装版忽略）。
 * 清单照样从本机的 HTTP 服务真实下载、真实验签；测试公钥经 DRIVER_CATALOG_TEST_KEY_ENV 传入。
 * 假模式一律走 Windows 的流程（macOS 的 CI 上也能跑）。
 */
export const FAKE_DRIVERS_ENV = 'CDL_LABELFLASH_FAKE_DRIVERS';
export const DRIVER_CATALOG_TEST_KEY_ENV = 'CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY';
export const TEST_CATALOG_KEY_ID = 'e2e';

export interface FakeDriverSpec {
  /** 和 Windows 查询脚本输出一样的记录。 */
  devices: PnpRecord[];
  /** 下载地址 → 文件内容（base64）。 */
  files: Record<string, string>;
  /** 假的 Get-AuthenticodeSignature 结果。 */
  authenticode: { status: string; subject: string };
  /** 假的提权安装的退出码（按 interpretInstallExit 解释，可以用 ELEVATED_EXIT 模拟拒绝）。 */
  installExitCode: number;
  /** 提权安装要花多久（视觉验收截「正在安装」用）。 */
  installDelayMs?: number;
  /** 装好之后系统里多出的打印机；要和 CDL_LABELFLASH_FAKE_PRINTERS 一起用。 */
  printerAfterInstall: FakePrinterSpec | null;
}

export function parseFakeDrivers(env: Record<string, string | undefined>, isPackaged: boolean): FakeDriverSpec | null {
  const value = env[FAKE_DRIVERS_ENV];
  if (isPackaged || value === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { devices?: unknown }).devices)) {
    throw new Error(`${FAKE_DRIVERS_ENV} must be a JSON object of { devices, files, authenticode, installExitCode, printerAfterInstall }`);
  }
  return parsed as FakeDriverSpec;
}

/** 额外信任的测试公钥（只对未打包的程序生效）。 */
export function testCatalogKey(env: Record<string, string | undefined>, isPackaged: boolean): Record<string, string> {
  const value = env[DRIVER_CATALOG_TEST_KEY_ENV];
  return isPackaged || value === undefined ? {} : { [TEST_CATALOG_KEY_ID]: value };
}

export class FakeDrivers {
  /** 交给假提权安装的文件（E2E 据此确认核对不过的安装包没有被运行）。 */
  readonly installs: string[] = [];
  private devices: PnpRecord[];

  constructor(
    private readonly spec: FakeDriverSpec,
    private readonly printers: FakePrinters | null,
  ) {
    this.devices = [...spec.devices];
  }

  deviceSource(): DeviceSource {
    return { detect: async () => windowsDriverlessDevices(this.devices) };
  }

  fetch(): FetchFunction {
    return async (url) => {
      const base64 = this.spec.files[url];
      if (base64 === undefined) {
        return new Response('not found', { status: 404 });
      }
      const bytes = Buffer.from(base64, 'base64');
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
    };
  }

  verifier(): InstallerVerifier {
    return { check: async () => parseAuthenticode(JSON.stringify(this.spec.authenticode)) };
  }

  installer(): PrivilegedInstaller {
    return {
      install: async (file, target) => {
        if (this.spec.installDelayMs !== undefined) {
          await sleep(this.spec.installDelayMs);
        }
        this.installs.push(file.path);
        const successCodes = target.platform === 'windows' ? target.package.successExitCodes : [0];
        const outcome = interpretInstallExit({ exitCode: this.spec.installExitCode, timedOut: false }, successCodes);
        if (outcome.kind === 'installed') {
          this.devices = this.devices.filter((record) => !isFor(record, target.model));
          if (this.spec.printerAfterInstall && this.printers) {
            this.printers.add(this.spec.printerAfterInstall);
          }
        }
        return outcome;
      },
    };
  }
}

function isFor(record: PnpRecord, model: CatalogModel): boolean {
  const id = parseWindowsUsbInstanceId(record.instanceId) ?? parseWindowsUsbInstanceId(record.parentId);
  return id !== null && model.usb.some((item) => isSameUsbId(item, id));
}
```

```ts
// src/main/drivers/driver-ports.ts
import type { InstallerVerifier, PrivilegedInstaller } from '../../core/drivers/driver-install-flow';
import { type DriverPlatform, findModelByUsbId } from '../../core/drivers/install-plan';
import type { DeviceSource } from './driver-station';
import { detectMacDevices } from './mac-devices';
import { checkMacSignature, createMacInstaller } from './mac-install';
import { detectWindowsDevices } from './windows-devices';
import { createWindowsInstaller } from './windows-install';
import { checkWindowsSignature } from './windows-signature';

export interface SystemDriverPorts {
  devices: DeviceSource;
  verifier: InstallerVerifier;
  installer: PrivilegedInstaller;
}

/** 按平台选设备检测、签名核对和提权安装；平台分支只在这里（index.ts 只管接线）。 */
export function systemDriverPorts(platform: DriverPlatform | null, log: (line: string) => void): SystemDriverPorts {
  switch (platform) {
    case 'windows':
      return {
        devices: { detect: () => detectWindowsDevices() },
        verifier: { check: (file) => checkWindowsSignature(file.path) },
        installer: createWindowsInstaller(log),
      };
    case 'mac':
      return {
        devices: { detect: (catalog) => detectMacDevices((id) => catalog !== null && findModelByUsbId(catalog, id) !== null) },
        verifier: { check: (file) => checkMacSignature(file.path) },
        installer: createMacInstaller(log),
      };
    case null:
      return {
        devices: { detect: async () => [] },
        verifier: { check: async () => ({ status: 'invalid', detail: 'unsupported platform' }) },
        installer: { install: async () => ({ kind: 'failed', exitCode: null }) },
      };
  }
}
```

`src/shared/ipc-contract.ts`：
- import 加 `import type { DriverStatus } from './drivers';`；
- `IpcChannel` 在 `AddFirewallRule` 之后加：

```ts
  GetDriverStatus: 'drivers:status',
  DetectDrivers: 'drivers:detect',
  InstallDriver: 'drivers:install',
  CancelDriverInstall: 'drivers:cancel-install',
  OpenDriverDownloadPage: 'drivers:open-download-page',
  DriverStatusChanged: 'drivers:status-changed',
```

- `LabelFlashApi` 末尾加：

```ts
  getDriverStatus(): Promise<DriverStatus>;
  /** 读驱动清单（force：重新下载）并检测缺驱动的 USB 设备。 */
  detectDrivers(force: boolean): Promise<DriverStatus>;
  /** 给「驱动」一节列出的一台设备装驱动（只能按设备编号，不能指定地址）；进度经 onDriverStatus 推送。 */
  installDriver(deviceKey: string): Promise<DriverStatus>;
  /** 取消下载（开始提权安装之后取消不了）。 */
  cancelDriverInstall(): Promise<void>;
  /** 用系统浏览器打开清单里这台设备的官方下载页（地址来自签过名的清单）。 */
  openDriverDownloadPage(deviceKey: string): Promise<void>;
  onDriverStatus(listener: (status: DriverStatus) => void): () => void;
```

`src/main/ipc-validators.ts`：import `DEVICE_KEY_PATTERN`（`../core/drivers/detected-device`），加：

```ts
/** 设备编号来自主进程的检测结果（usb-厂商号-产品号-摘要）；界面传不进地址或路径。 */
export function requireDriverDeviceKey(value: unknown): string {
  if (typeof value !== 'string' || !DEVICE_KEY_PATTERN.test(value)) {
    throw new TypeError('Invalid driver device key');
  }
  return value;
}
```

`src/main/ipc.ts`：`IpcDeps` 加 `drivers: DriverStation;`（import type `./drivers/driver-station`）；import `requireDriverDeviceKey`；在防火墙两个通道之后加：

```ts
  handle(IpcChannel.GetDriverStatus, () => deps.drivers.status());
  handle(IpcChannel.DetectDrivers, (force) => deps.drivers.detect(requireBoolean(force, 'force')));
  handle(IpcChannel.InstallDriver, (deviceKey) => deps.drivers.install(requireDriverDeviceKey(deviceKey)));
  handle(IpcChannel.CancelDriverInstall, () => deps.drivers.cancelInstall());
  handle(IpcChannel.OpenDriverDownloadPage, (deviceKey) =>
    deps.drivers.openDownloadPage(requireDriverDeviceKey(deviceKey)),
  );
```

`src/preload/index.ts` 的 `api` 末尾加：

```ts
  getDriverStatus: () => ipcRenderer.invoke(IpcChannel.GetDriverStatus),
  detectDrivers: (force) => ipcRenderer.invoke(IpcChannel.DetectDrivers, force),
  installDriver: (deviceKey) => ipcRenderer.invoke(IpcChannel.InstallDriver, deviceKey),
  cancelDriverInstall: () => ipcRenderer.invoke(IpcChannel.CancelDriverInstall),
  openDriverDownloadPage: (deviceKey) => ipcRenderer.invoke(IpcChannel.OpenDriverDownloadPage, deviceKey),
  onDriverStatus: (listener) => subscribe(IpcChannel.DriverStatusChanged, listener),
```

`src/main/index.ts`：
- electron 的 import 加 `shell`；新增 import：`CatalogClient`（`./drivers/catalog-client`）、`trustedKeys`（`./drivers/catalog-signature`）、`SqliteCatalogStateStore`（`./drivers/catalog-state-store`）、`DriverStation`（`./drivers/driver-station`）、`systemDriverPorts`（`./drivers/driver-ports`）、`FakeDrivers, parseFakeDrivers, testCatalogKey`（`./drivers/fake-drivers`）、`createInstallerDownloader`（`./drivers/installer-downloader`）、`type DriverPlatform`（`../core/drivers/install-plan`）、`DRIVER_CATALOG_PUBLIC_KEYS`（`../shared/driver-catalog-keys`）。
- 在 `localApi` 创建之后、`registerIpc` 之前加：

```ts
  // 驱动安装（打印机页的「驱动」一节）。E2E 换掉设备检测、安装包下载、签名核对和提权安装（见 drivers/fake-drivers.ts），
  // 清单照样真实下载、真实验签。安装版不读这些环境变量。
  const fakeDriverSpec = parseFakeDrivers(process.env, app.isPackaged);
  const fakeDrivers = fakeDriverSpec ? new FakeDrivers(fakeDriverSpec, fakePrinters) : null;
  if (fakeDrivers) {
    console.info('[drivers] using fake devices and installers');
    (globalThis as { e2eFakeDrivers?: FakeDrivers }).e2eFakeDrivers = fakeDrivers;
  }
  const driverPlatform: DriverPlatform | null =
    fakeDrivers !== null || process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : null;
  const driverLog = (line: string) => console.info(line);
  const systemPorts = systemDriverPorts(driverPlatform, driverLog);
  const drivers = new DriverStation({
    platform: driverPlatform,
    catalog: new CatalogClient({
      url: () => settings.current.driverCatalogUrl ?? BUILD_DEFAULT_DRIVER_CATALOG_URL,
      fetch: (url, init) => net.fetch(url, init),
      keys: trustedKeys({ ...DRIVER_CATALOG_PUBLIC_KEYS, ...testCatalogKey(process.env, app.isPackaged) }),
      store: new SqliteCatalogStateStore(database),
      clock: systemClock,
      userAgent,
      log: driverLog,
    }),
    devices: fakeDrivers?.deviceSource() ?? systemPorts.devices,
    flow: {
      downloader: createInstallerDownloader({
        fetch: fakeDrivers?.fetch() ?? ((url, init) => net.fetch(url, init)),
        tempRoot: app.getPath('temp'),
        userAgent,
      }),
      verifier: fakeDrivers?.verifier() ?? systemPorts.verifier,
      installer: fakeDrivers?.installer() ?? systemPorts.installer,
      listPrinters: () => adapter.knownPrinterNames(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      clock: systemClock,
    },
    openExternal: (url) => shell.openExternal(url),
    onStatus: (status) => sendToMainWindow(IpcChannel.DriverStatusChanged, status),
    clock: systemClock,
    log: driverLog,
  });
```

- `registerIpc({ … })` 加 `drivers,`；`onSettingsChanged` 里 `mobile.settingsChanged` 之前加：

```ts
      if (next.driverCatalogUrl !== previous.driverCatalogUrl) {
        drivers.catalogUrlChanged();
      }
```

- 静默更新的空闲判断：`pendingPrints: printQueue.pending + localApi.pendingJobs,` 改为

```ts
      // 正在装驱动也算有事没做完：静默更新会结束本程序，装到一半的提权安装就没人等了。
      pendingPrints: printQueue.pending + localApi.pendingJobs + (drivers.isInstalling ? 1 : 0),
```

- `will-quit` 里加 `drivers.cancelInstall();`（只停得住下载，提权安装由系统继续）。

- [ ] **Step 4: 跑测试和构建**

Run: `bun test src/main && bun run check`
Expected: PASS。再 `bun run test:e2e`，已有用例不受影响。

- [ ] **Step 5: 提交**

```bash
git add src/main/drivers/fake-drivers.ts src/main/drivers/fake-drivers.test.ts src/main/drivers/driver-ports.ts src/main/printing/fake-printers.ts src/main/printing/fake-printers.test.ts src/shared/ipc-contract.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(main): wire driver install into IPC, with a fake mode for E2E" -m "New channels only take a device key from the last detection, never an address or a file. Unpackaged builds can replace device detection, installer download, signature check and elevation with fakes and trust an extra test key, while the catalog itself is still downloaded and verified for real. A running install holds back the silent background update." -m "$TRAILER"
```

---

### Task 14: 界面的文字（纯逻辑）

**Files:**
- Create: `src/renderer/src/lib/driver-text.ts`、`driver-text.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/driver-text.test.ts
import { describe, expect, test } from 'bun:test';
import type { DriverDeviceView, DriverInstallView } from '../../../shared/drivers';
import {
  actionText,
  catalogText,
  deviceDetail,
  deviceTitle,
  emptyDevicesText,
  formatMegabytes,
  installText,
  stepProgress,
} from './driver-text';

/** 取 UTC 正午：任何时区下都是同一天。 */
const ISSUED = Date.UTC(2026, 8, 1, 12);
const EXPIRES = Date.UTC(2027, 2, 1, 12);

const DEVICE: DriverDeviceView = {
  key: 'usb-1234-abcd-00000001',
  name: '未知设备',
  usbId: '1234:ABCD',
  problem: 'no-driver',
  problemCode: 28,
  action: { kind: 'install', brand: '示例品牌', model: '示例型号 X1', sizeBytes: 12_900_000 },
};

function install(state: DriverInstallView['state']): DriverInstallView {
  return { id: 1, modelId: 'example-x1', deviceKey: DEVICE.key, brand: '示例品牌', model: '示例型号 X1', state };
}

describe('catalogText', () => {
  test('describes each catalog state', () => {
    expect(catalogText({ state: 'unconfigured' })).toMatchObject({ tone: 'warning', text: expect.stringContaining('未配置驱动清单地址') });
    expect(catalogText({ state: 'ready', issuedAt: ISSUED, expiresAt: EXPIRES, modelCount: 3, staleIssue: null })).toEqual({
      tone: 'ok',
      text: '驱动清单：2026-09-01 签发，3 个型号，有效期到 2027-03-01',
    });
    expect(catalogText({ state: 'ready', issuedAt: ISSUED, expiresAt: EXPIRES, modelCount: 3, staleIssue: '连不上' }).tone).toBe('warning');
    expect(catalogText({ state: 'failed', issue: '驱动清单的签名不对，可能被改过，不使用' })).toEqual({
      tone: 'error',
      text: '驱动清单不能用：驱动清单的签名不对，可能被改过，不使用',
    });
  });
});

describe('devices', () => {
  test('names the device after the catalog model and shows the USB id and problem', () => {
    expect(deviceTitle(DEVICE)).toBe('示例品牌 示例型号 X1');
    expect(deviceTitle({ ...DEVICE, action: { kind: 'not-in-catalog' } })).toBe('未知设备');
    expect(deviceDetail(DEVICE)).toBe('USB 1234:ABCD · 没装驱动');
    expect(deviceDetail({ ...DEVICE, problem: 'driver-error', problemCode: 10 })).toBe('USB 1234:ABCD · 驱动有问题（设备管理器代码 10）');
  });

  test('offers an install button or guidance', () => {
    expect(actionText(DEVICE.action, 'windows')).toEqual({ button: '安装驱动（12.3 MB）', guide: null });
    expect(actionText({ kind: 'not-in-catalog' }, 'windows').guide).toContain('通用驱动');
    expect(actionText({ kind: 'no-catalog' }, 'mac').guide).toContain('厂家官网');
    expect(actionText({ kind: 'open-page', brand: '示例品牌', model: '示例型号 X1' }, 'mac').button).toBe('打开官方下载页');
  });

  test('says what an empty list means on each platform', () => {
    expect(emptyDevicesText('windows')).toBe('没有发现缺驱动的 USB 打印设备');
    expect(emptyDevicesText('mac')).toContain('清单里有的型号');
  });
});

describe('install progress', () => {
  test('shows download progress and the admin prompt hint', () => {
    expect(installText(install({ phase: 'running', step: 'downloading', receivedBytes: 1_048_576, totalBytes: 12_900_000 }), 'windows')).toEqual({
      tone: 'running',
      text: '正在下载示例品牌 示例型号 X1 的驱动：1.0 MB / 12.3 MB',
    });
    expect(installText(install({ phase: 'running', step: 'installing', receivedBytes: 0, totalBytes: 1 }), 'windows').text).toContain('点「是」');
    expect(installText(install({ phase: 'running', step: 'installing', receivedBytes: 0, totalBytes: 1 }), 'mac').text).toContain('密码');
  });

  test('names the new printer or says how to find it', () => {
    expect(installText(install({ phase: 'done', newPrinters: ['示例标签机'], needsRestart: false }), 'windows')).toEqual({
      tone: 'ok',
      text: '驱动已装好，新打印机：示例标签机。到上面「纸张 → 打印机」给它分配纸张',
    });
    expect(installText(install({ phase: 'done', newPrinters: [], needsRestart: true }), 'windows').text).toContain('重启电脑');
  });

  test('explains each failure with a next step', () => {
    expect(installText(install({ phase: 'failed', failure: 'hash-mismatch', exitCode: null }), 'windows')).toMatchObject({
      tone: 'error',
      text: expect.stringContaining('SHA-256'),
    });
    expect(installText(install({ phase: 'failed', failure: 'installer-failed', exitCode: 1603 }), 'windows').text).toContain('1603');
    expect(installText(install({ phase: 'failed', failure: 'admin-declined', exitCode: null }), 'windows').text).toContain('再点一次');
  });

  test('marks the steps before, at and after the current one', () => {
    expect(stepProgress('downloading', 'installing')).toBe('done');
    expect(stepProgress('installing', 'installing')).toBe('current');
    expect(stepProgress('finding-printer', 'installing')).toBe('todo');
  });

  test('formats sizes in megabytes', () => {
    expect(formatMegabytes(524_288)).toBe('0.5 MB');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib/driver-text.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/lib/driver-text.ts
import { INSTALL_STEPS, type InstallFailure, type InstallStep } from '../../../core/drivers/driver-install-flow';
import type {
  CatalogView,
  DeviceActionView,
  DriverDeviceView,
  DriverInstallView,
  DriverPlatformView,
} from '../../../shared/drivers';

/** 「驱动」一节的文字。用词：驱动回调成功只代表安装程序说装好了，所以说「驱动已装好」，不说「打印机可以用了」。 */

export type TextTone = 'ok' | 'warning' | 'error' | 'running';

export interface ToneText {
  text: string;
  tone: TextTone;
}

const BYTES_PER_MB = 1024 * 1024;
const DATE_PART_DIGITS = 2;
const WINDOWS_GENERIC_DRIVER =
  '可以先试 Windows 自带的通用驱动（设置 › 蓝牙和其他设备 › 打印机和扫描仪 › 添加设备），或到厂家官网下载驱动';
const MAC_GENERIC_DRIVER = '到厂家官网下载 macOS 驱动';

export const INSTALL_STEP_LABELS: Readonly<Record<InstallStep, string>> = {
  downloading: '下载',
  verifying: '核对',
  installing: '安装',
  'finding-printer': '找打印机',
};

export function formatMegabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/** 本地日期 YYYY-MM-DD。 */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(DATE_PART_DIGITS, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function catalogText(view: CatalogView): ToneText {
  switch (view.state) {
    case 'unconfigured':
      return {
        tone: 'warning',
        text: '未配置驱动清单地址：清单里有的型号才能自动下载安装官方驱动。在下面「驱动清单地址」里填写出品方提供的地址',
      };
    case 'loading':
      return { tone: 'running', text: '正在读取驱动清单…' };
    case 'failed':
      return { tone: 'error', text: `驱动清单不能用：${view.issue}` };
    case 'ready': {
      const text = `驱动清单：${formatDate(view.issuedAt)} 签发，${view.modelCount} 个型号，有效期到 ${formatDate(view.expiresAt)}`;
      return view.staleIssue === null
        ? { tone: 'ok', text }
        : { tone: 'warning', text: `${text}（用的是上次下载的清单：${view.staleIssue}）` };
    }
  }
}

export function deviceTitle(device: DriverDeviceView): string {
  const { action } = device;
  if (action.kind === 'install' || action.kind === 'open-page' || action.kind === 'no-package') {
    return `${action.brand} ${action.model}`;
  }
  return device.name || '未知 USB 设备';
}

export function deviceDetail(device: DriverDeviceView): string {
  const problem =
    device.problem === 'no-driver'
      ? '没装驱动'
      : device.problem === 'no-queue'
        ? '还没有打印机'
        : `驱动有问题（设备管理器代码 ${device.problemCode ?? '未知'}）`;
  return `USB ${device.usbId} · ${problem}`;
}

/** 设备那一行的按钮（null = 没有按钮）和说明。 */
export function actionText(
  action: DeviceActionView,
  platform: DriverPlatformView,
): { button: string | null; guide: string | null } {
  const generic = platform === 'mac' ? MAC_GENERIC_DRIVER : WINDOWS_GENERIC_DRIVER;
  switch (action.kind) {
    case 'install':
      return { button: `安装驱动（${formatMegabytes(action.sizeBytes)}）`, guide: null };
    case 'open-page':
      return { button: '打开官方下载页', guide: '这个型号的 macOS 驱动要到厂家官网下载安装' };
    case 'no-package':
      return { button: null, guide: `清单里没有这个型号的${platform === 'mac' ? ' macOS ' : ' Windows '}驱动：${generic}` };
    case 'not-in-catalog':
      return { button: null, guide: `清单里没有这个型号：${generic}` };
    case 'no-catalog':
      return { button: null, guide: `驱动清单不可用，不能自动安装：${generic}` };
  }
}

export function emptyDevicesText(platform: DriverPlatformView): string {
  return platform === 'mac'
    ? '没有发现清单里有、还没装驱动的 USB 设备（macOS 上只能认出清单里有的型号）'
    : '没有发现缺驱动的 USB 打印设备';
}

export function stepProgress(step: InstallStep, current: InstallStep): 'done' | 'current' | 'todo' {
  const index = INSTALL_STEPS.indexOf(step);
  const currentIndex = INSTALL_STEPS.indexOf(current);
  return index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
}

export function installText(view: DriverInstallView, platform: DriverPlatformView): ToneText {
  const name = `${view.brand} ${view.model}`;
  const { state } = view;
  switch (state.phase) {
    case 'running':
      return { tone: 'running', text: runningText(name, state.step, state.receivedBytes, state.totalBytes, platform) };
    case 'done': {
      const restart = state.needsRestart ? '（重启电脑后生效）' : '';
      return state.newPrinters.length > 0
        ? { tone: 'ok', text: `驱动已装好${restart}，新打印机：${state.newPrinters.join('、')}。到上面「纸张 → 打印机」给它分配纸张` }
        : { tone: 'ok', text: `驱动已装好${restart}，但还没看到新打印机：重新插拔 USB 线后点「重新检测」` };
    }
    case 'failed':
      return { tone: 'error', text: failureText(state.failure, state.exitCode, platform) };
  }
}

function runningText(name: string, step: InstallStep, received: number, total: number, platform: DriverPlatformView): string {
  switch (step) {
    case 'downloading':
      return `正在下载${name} 的驱动：${formatMegabytes(received)} / ${formatMegabytes(total)}`;
    case 'verifying':
      return '正在核对安装包（大小、SHA-256、数字签名）…';
    case 'installing':
      return platform === 'mac'
        ? '请在弹出的窗口里输入这台 Mac 的登录密码，然后等安装完成（可能要几分钟）'
        : '请在 Windows 弹出的窗口里点「是」（允许 Windows PowerShell 安装核对过的驱动），然后等安装完成（可能要几分钟）';
    case 'finding-printer':
      return '驱动已装好，正在等系统建好新打印机…';
  }
}

function failureText(failure: InstallFailure, exitCode: number | null, platform: DriverPlatformView): string {
  switch (failure) {
    case 'download-failed':
      return '下载驱动失败：检查网络后再试';
    case 'download-timeout':
      return '下载驱动超时：网络太慢或断了，稍后再试';
    case 'too-large':
      return '下载到的文件比清单里写的大，已停止并删除：请联系出品方核对驱动清单';
    case 'canceled':
      return '已取消下载';
    case 'size-mismatch':
      return '下载到的文件大小和清单不一致，没有安装：稍后再试，一直这样请联系出品方';
    case 'hash-mismatch':
      return '下载到的文件和清单里的 SHA-256 不一致，可能被替换过，没有安装';
    case 'signature-invalid':
      return '安装包的数字签名无效，没有安装：请联系出品方';
    case 'signer-mismatch':
      return '安装包不是清单要求的厂家签名的，没有安装：请联系出品方';
    case 'admin-declined':
      return platform === 'mac'
        ? '没有安装：没有输入管理员密码。要安装请再点一次'
        : '没有安装：管理员确认被取消了。要安装请再点一次，在弹出的窗口里点「是」';
    case 'installer-failed':
      return exitCode === null
        ? '安装程序没能运行，详情见日志：可以到厂家官网下载驱动手动安装'
        : `安装程序报错（退出码 ${exitCode}）：可以到厂家官网下载驱动手动安装`;
    case 'install-timeout':
      return '安装超过 15 分钟还没结束：等它装完后点「重新检测」';
    case 'internal':
      return '安装驱动时出错，详情见日志';
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib/driver-text.test.ts`
Expected: PASS。再跑 `bun run check`。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/lib/driver-text.ts src/renderer/src/lib/driver-text.test.ts
git commit -m "feat(renderer): wording for the driver section" -m "Catalog state, device rows, install progress and every failure get a Chinese sentence with the next step; the admin prompt hint says which window to expect on each platform. Kept as pure functions with tests." -m "$TRAILER"
```

---

### Task 15: 「驱动」卡片（视图模型、组件、样式）

**Files:**
- Create: `src/renderer/src/components/config/UrlSetting.tsx`
- Modify: `src/renderer/src/components/config/RelayUrlSetting.tsx`
- Create: `src/renderer/src/view-models/use-drivers.ts`
- Create: `src/renderer/src/components/DriverSection.tsx`
- Modify: `src/renderer/src/components/config/ConfigPages.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 抽出地址设置行**（中转地址和清单地址共用；外观、行为和原来逐字一致）

```tsx
// src/renderer/src/components/config/UrlSetting.tsx
import { type ReactNode, useEffect, useId, useState } from 'react';
import { SettingRow } from './SettingRow';

export interface UrlSettingProps {
  label: string;
  hint: ReactNode;
  /** 设置里填的地址；null 表示用安装包自带的默认地址。 */
  value: string | null;
  /** 安装包自带的默认地址；自己构建的安装包可能没有。 */
  defaultValue: string | null;
  /** 地址规则（和主进程同一个函数）；不合法返回 null。 */
  sanitize: (text: string) => string | null;
  invalidText: string;
  /** 保存地址（null = 恢复默认）；返回是否已保存。 */
  onChange: (url: string | null) => Promise<boolean>;
}

/** 一行地址设置：离开输入框或按回车时保存，清空等于恢复默认。 */
export function UrlSetting({ label, hint, value, defaultValue, sanitize, invalidText, onChange }: UrlSettingProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value ?? '');
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value ?? '');
    setIssue(null);
  }, [value]);

  const commit = async () => {
    const text = draft.trim();
    if (text === (value ?? '')) {
      setIssue(null);
      return;
    }
    if (text === '') {
      await onChange(null);
      return;
    }
    const url = sanitize(text);
    if (url === null) {
      setIssue(invalidText);
      return;
    }
    setIssue(null);
    if (await onChange(url)) {
      setDraft(url);
    }
  };

  return (
    <>
      <SettingRow label={label} htmlFor={inputId} hint={hint}>
        <input
          id={inputId}
          type="url"
          className="text-field"
          spellCheck={false}
          placeholder={defaultValue ?? 'https://…/'}
          value={draft}
          aria-invalid={issue !== null}
          aria-describedby={issue ? `${inputId}-issue` : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <button type="button" className="button button--small" disabled={value === null} onClick={() => void onChange(null)}>
          恢复默认
        </button>
      </SettingRow>
      {issue && (
        <p id={`${inputId}-issue`} className="setting-row__issue" role="alert">
          {issue}
        </p>
      )}
    </>
  );
}
```

`RelayUrlSetting.tsx` 的函数体换成（props 接口和文件头注释不变；import 改为 `sanitizeRelayUrl` 和 `UrlSetting`，去掉 `useEffect`、`useId`、`useState`、`SettingRow`）：

```tsx
export function RelayUrlSetting({ relayUrl, defaultRelayUrl, onChangeRelayUrl }: RelayUrlSettingProps) {
  const defaultHint = defaultRelayUrl
    ? `不填就用安装包自带的地址：${defaultRelayUrl}`
    : '这个安装包没有自带地址，要填写自己部署的中转服务。';
  return (
    <UrlSetting
      label="手机扫码中转地址"
      hint={
        <>
          手机和这台电脑经它通信，内容端到端加密，它看不到扫码内容。{defaultHint}
          改了地址后，正在进行的手机扫码会结束。电脑要能直接访问这个地址（不支持系统代理）。
        </>
      }
      value={relayUrl}
      defaultValue={defaultRelayUrl}
      sanitize={sanitizeRelayUrl}
      invalidText="地址要以 https:// 开头，不带 ? 和 # 后面的部分（在本机测试可以用 http://localhost）。"
      onChange={onChangeRelayUrl}
    />
  );
}
```

Run: `bun run check && bun run test:e2e -- e2e/app.e2e.ts`
Expected: 通过；中转地址的已有 E2E 不受影响。（视觉验收里含中转地址设置的项在 Task 18 一起复核。）

- [ ] **Step 2: 视图模型**

```ts
// src/renderer/src/view-models/use-drivers.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriverStatus } from '../../../shared/drivers';
import { reportError } from '../lib/notices';

export interface DriversModel {
  /** 还没读到时为 null。 */
  status: DriverStatus | null;
  /** force：重新下载清单（「重新检测」按钮）。 */
  detect: (force: boolean) => Promise<void>;
  install: (deviceKey: string) => Promise<void>;
  cancel: () => Promise<void>;
  openPage: (deviceKey: string) => Promise<void>;
}

/**
 * 「驱动」一节：打印机页打开时检测一次；状态跟随主进程推送。一次安装完成（done）时调用 onInstalled 一次
 * （按安装编号记，推送多次也只调一次），让打印机列表立即刷新。
 */
export function useDrivers(isActive: boolean, onInstalled: () => void): DriversModel {
  const [status, setStatus] = useState<DriverStatus | null>(null);
  const onInstalledRef = useRef(onInstalled);
  const handledInstallRef = useRef<number | null>(null);

  useEffect(() => {
    onInstalledRef.current = onInstalled;
  }, [onInstalled]);

  useEffect(() => window.api.onDriverStatus(setStatus), []);

  const detect = useCallback(async (force: boolean) => {
    try {
      setStatus(await window.api.detectDrivers(force));
    } catch (error) {
      reportError('检测驱动', error);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void detect(false);
    }
  }, [isActive, detect]);

  useEffect(() => {
    const install = status?.install;
    if (install && install.state.phase === 'done' && handledInstallRef.current !== install.id) {
      handledInstallRef.current = install.id;
      onInstalledRef.current();
    }
  }, [status]);

  const install = useCallback(async (deviceKey: string) => {
    try {
      setStatus(await window.api.installDriver(deviceKey));
    } catch (error) {
      reportError('安装驱动', error);
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      await window.api.cancelDriverInstall();
    } catch (error) {
      reportError('取消下载驱动', error);
    }
  }, []);

  const openPage = useCallback(async (deviceKey: string) => {
    try {
      await window.api.openDriverDownloadPage(deviceKey);
    } catch (error) {
      reportError('打开驱动下载页', error);
    }
  }, []);

  return { status, detect, install, cancel, openPage };
}
```

- [ ] **Step 3: 组件**

```tsx
// src/renderer/src/components/DriverSection.tsx
import { INSTALL_STEPS } from '../../../core/drivers/driver-install-flow';
import { sanitizeCatalogUrl } from '../../../shared/driver-catalog-url';
import type { DriverInstallView, DriverPlatformView, DriverStatus } from '../../../shared/drivers';
import {
  actionText,
  catalogText,
  deviceDetail,
  deviceTitle,
  emptyDevicesText,
  INSTALL_STEP_LABELS,
  installText,
  stepProgress,
} from '../lib/driver-text';
import { UrlSetting } from './config/UrlSetting';

interface DriverSectionProps {
  status: DriverStatus | null;
  catalogUrl: string | null;
  defaultCatalogUrl: string | null;
  onChangeCatalogUrl: (url: string | null) => Promise<boolean>;
  onDetect: () => void;
  onInstall: (deviceKey: string) => void;
  onCancel: () => void;
  onOpenPage: (deviceKey: string) => void;
}

/** 打印机页的「驱动」卡片：清单状态、缺驱动的 USB 设备、安装进度、清单地址。 */
export function DriverSection({
  status,
  catalogUrl,
  defaultCatalogUrl,
  onChangeCatalogUrl,
  onDetect,
  onInstall,
  onCancel,
  onOpenPage,
}: DriverSectionProps) {
  const platform = status?.platform ?? 'windows';
  const isInstalling = status?.install?.state.phase === 'running';
  const isBusy = isInstalling || status?.isDetecting === true;
  const catalog = status ? catalogText(status.catalog) : null;

  return (
    <div className="driver-section">
      <header className="driver-section__header">
        <h3 className="driver-section__title">驱动</h3>
        {platform !== 'unsupported' && (
          <button type="button" className="button button--small" onClick={onDetect} disabled={isBusy}>
            {status?.isDetecting ? '检测中…' : '重新检测'}
          </button>
        )}
      </header>
      {platform === 'unsupported' ? (
        <p className="driver-section__note">这台电脑的系统不支持自动安装驱动</p>
      ) : (
        <>
          {catalog && <p className={`driver-section__catalog driver-section__catalog--${catalog.tone}`}>{catalog.text}</p>}
          {status?.install && <InstallProgress install={status.install} platform={platform} onCancel={onCancel} />}
          {status?.detectIssue && (
            <p className="driver-section__catalog driver-section__catalog--error" role="alert">
              {status.detectIssue}
            </p>
          )}
          {status?.devices && status.devices.length === 0 && <p className="driver-section__note">{emptyDevicesText(platform)}</p>}
          {status?.devices && status.devices.length > 0 && (
            <ul className="driver-devices">
              {status.devices.map((device) => {
                const { button, guide } = actionText(device.action, platform);
                return (
                  <li key={device.key} className="driver-device">
                    <span className="driver-device__title">{deviceTitle(device)}</span>
                    {button && (
                      <button
                        type="button"
                        className="button button--small"
                        disabled={isBusy}
                        onClick={() => (device.action.kind === 'open-page' ? onOpenPage(device.key) : onInstall(device.key))}
                      >
                        {button}
                      </button>
                    )}
                    <p className="driver-device__detail">{deviceDetail(device)}</p>
                    {guide && <p className="driver-device__guide">{guide}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <details className="driver-section__source" open={status?.catalog.state === 'unconfigured' ? true : undefined}>
            <summary>驱动清单地址</summary>
            <UrlSetting
              label="驱动清单地址"
              hint={
                <>
                  从这个地址下载驱动清单（型号、官方驱动的下载地址和校验值）。清单必须带出品方的签名，程序核对通过才用，
                  填错地址也装不上来路不明的驱动。
                  {defaultCatalogUrl ? `不填就用安装包自带的地址：${defaultCatalogUrl}` : '这个安装包没有自带地址：要自动安装驱动，填写出品方提供的地址。'}
                </>
              }
              value={catalogUrl}
              defaultValue={defaultCatalogUrl}
              sanitize={sanitizeCatalogUrl}
              invalidText="地址要以 https:// 开头，不带 # 后面的部分（在本机测试可以用 http://localhost）。"
              onChange={onChangeCatalogUrl}
            />
          </details>
        </>
      )}
    </div>
  );
}

function InstallProgress({
  install,
  platform,
  onCancel,
}: {
  install: DriverInstallView;
  platform: DriverPlatformView;
  onCancel: () => void;
}) {
  const { state } = install;
  const message = installText(install, platform);
  return (
    <div className={`driver-install driver-install--${message.tone}`}>
      {state.phase === 'running' && (
        <ol className="driver-steps" aria-label="安装步骤">
          {INSTALL_STEPS.map((step) => (
            <li key={step} className={`driver-steps__item driver-steps__item--${stepProgress(step, state.step)}`}>
              {INSTALL_STEP_LABELS[step]}
            </li>
          ))}
        </ol>
      )}
      <p className="driver-install__text" role={message.tone === 'error' ? 'alert' : 'status'}>
        {message.text}
      </p>
      {state.phase === 'running' && state.step === 'downloading' && (
        <div className="driver-install__actions">
          <progress className="driver-install__progress" max={state.totalBytes} value={state.receivedBytes} aria-label="下载进度" />
          <button type="button" className="button button--small button--quiet" onClick={onCancel}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}
```

（`<details open={…}>`：清单地址没配置时默认展开，用户一眼看到要填哪里；配置了就收起。React 对 `open` 的受控行为：传 `undefined` 时不强制收起，操作员自己展开的保持展开。）

- [ ] **Step 4: 接线**

`ConfigPages.tsx`：`ConfigPagesProps` 在 `printers` 之后加

```ts
  /** 打印机页下面的「驱动」卡片（components/DriverSection）。 */
  drivers: ReactNode;
```

解构里加 `drivers`；`case 'printers':` 改为：

```tsx
    case 'printers':
      // 和其他配置页一样放在白底卡片上：打印机清单原来在工作台右侧的白底栏里，缺打印机的红字在灰底上对比度不够。
      return (
        <div className="config-page">
          <section className="config-card printers-card" aria-label="打印机">
            {printers}
          </section>
          <section className="config-card driver-card" aria-label="驱动">
            {drivers}
          </section>
        </div>
      );
```

`App.tsx`：import `useDrivers`（`./view-models/use-drivers`）和 `DriverSection`（`./components/DriverSection`）。在 `const { appView } = config;` 之后加：

```ts
  // 打印机页打开时检测缺驱动的设备；装好之后立即刷新打印机列表（新打印机出现、驱动纸张的「建议」跟着出现）。
  const refreshPrinters = useCallback(() => void printers.refresh(), [printers.refresh]);
  const drivers = useDrivers(appView.view.kind === 'config' && appView.view.page === 'printers', refreshPrinters);
```

`<ConfigPages … printers={…}` 之后加：

```tsx
            drivers={
              <DriverSection
                status={drivers.status}
                catalogUrl={settings?.driverCatalogUrl ?? null}
                defaultCatalogUrl={appInfo?.defaultDriverCatalogUrl ?? null}
                onChangeCatalogUrl={async (driverCatalogUrl) => (await update({ driverCatalogUrl })) !== null}
                onDetect={() => void drivers.detect(true)}
                onInstall={(key) => void drivers.install(key)}
                onCancel={() => void drivers.cancel()}
                onOpenPage={(key) => void drivers.openPage(key)}
              />
            }
```

`app.css`：在 `.printer-row__message` 规则之后加（只用 tokens 里的变量）：

```css
/* ── 打印机页的「驱动」卡片 ── */
.driver-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.driver-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.driver-section__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}

.driver-section__catalog,
.driver-section__note {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 12px;
}

.driver-section__catalog--warning {
  color: var(--color-warning);
}

.driver-section__catalog--error {
  color: var(--color-error);
}

.driver-devices {
  margin: 0;
  padding: 0;
  list-style: none;
}

.driver-device {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0 var(--space-2);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--color-rule);
}

.driver-device__title {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.driver-device__detail,
.driver-device__guide {
  grid-column: 1 / -1;
  margin: var(--space-1) 0 0;
  color: var(--color-ink-soft);
  font-size: 12px;
}

.driver-install {
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--color-tape-wash);
}

.driver-install--ok {
  background: var(--color-housing);
}

.driver-install--error {
  background: var(--color-error-wash);
}

.driver-install__text {
  margin: 0;
}

.driver-install__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.driver-install__progress {
  flex: 1;
}

.driver-steps {
  display: flex;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
  padding: 0;
  list-style: none;
  font-size: 12px;
}

.driver-steps__item--done {
  color: var(--color-success);
}

.driver-steps__item--current {
  font-weight: 700;
}

.driver-steps__item--todo {
  color: var(--color-ink-soft);
}

.driver-section__source summary {
  cursor: pointer;
  color: var(--color-ink-soft);
  font-size: 12px;
}
```

- [ ] **Step 5: 检查和 E2E**

Run: `bun run check && bun run test:e2e`
Expected: 全部通过（这一步还没有驱动的 E2E；打印机页能打开、卡片在、没有报错）。开发版里手工看一眼：`bun run dev`，配置中心 › 打印机，下面是「驱动」卡片，未配置时显示「未配置驱动清单地址」并展开「驱动清单地址」。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/config/UrlSetting.tsx src/renderer/src/components/config/RelayUrlSetting.tsx src/renderer/src/view-models/use-drivers.ts src/renderer/src/components/DriverSection.tsx src/renderer/src/components/config/ConfigPages.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(renderer): driver card on the printers page" -m "Shows the catalog state, USB devices without a working driver with an install button or guidance, step-by-step progress with download cancel, and the result naming the new printer. The catalog address setting lives in the same card and shares one URL setting row with the relay address. The printer list refreshes once when an install finishes." -m "$TRAILER"
```

---

### Task 16: E2E

**Files:**
- Modify: `e2e/support/electron-app.ts`（启动选项）
- Create: `e2e/support/driver-catalog.ts`
- Create: `e2e/drivers.e2e.ts`

- [ ] **Step 1: 启动选项**

`e2e/support/electron-app.ts`：import `DRIVER_CATALOG_TEST_KEY_ENV, FAKE_DRIVERS_ENV, type FakeDriverSpec`（`../../src/main/drivers/fake-drivers`）。`LaunchOptions` 加：

```ts
  /** 假的驱动环境（见 src/main/drivers/fake-drivers.ts）：缺驱动的设备、安装包下载、签名核对和提权安装都是假的。 */
  fakeDrivers?: FakeDriverSpec;
  /** 额外信任的驱动清单公钥（编号 e2e）：E2E 用现场生成的密钥签清单。 */
  driverCatalogKey?: string;
```

`launchApp` 里 `fakeOcr` 之后加：

```ts
  if (options.fakeDrivers) {
    env[FAKE_DRIVERS_ENV] = JSON.stringify(options.fakeDrivers);
  }
  if (options.driverCatalogKey) {
    env[DRIVER_CATALOG_TEST_KEY_ENV] = options.driverCatalogKey;
  }
```

- [ ] **Step 2: 测试用的清单和服务**

```ts
// e2e/support/driver-catalog.ts
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type FakeDriverSpec, TEST_CATALOG_KEY_ID } from '../../src/main/drivers/fake-drivers';
import { createTestCatalogKeys, signedCatalogText, type TestCatalogKeys } from '../../src/main/drivers/testing/catalog-keys';
import type { PnpRecord } from '../../src/main/drivers/windows-devices';
import type { FakePrinterSpec } from '../../src/main/printing/fake-printers';

/** 品牌、地址都是假的（仓库里不写真实品牌和厂家网址）；example.invalid 的下载由假驱动环境从内存提供。 */
export const INSTALLER_URL = 'https://example.invalid/drivers/x1-setup.exe';
export const INSTALLER_BYTES = Buffer.from('MZ 示例安装包（E2E）');
export const SIGNER = 'CN=示例品牌有限公司, O=示例品牌有限公司, C=CN';
export const NEW_PRINTER: FakePrinterSpec = { name: '示例标签机', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } };
const MS_PER_SECOND = 1_000;
const MS_PER_DAY = 86_400_000;
/** 测试清单的有效期：够一次测试用，过期的另造。 */
const VALID_DAYS = 30;
const PRINTER_CLASS = ['USB\\Class_07&SubClass_01&Prot_02', 'USB\\Class_07'];

/** 清单里有的型号（1234:ABCD）。 */
export const CATALOG_DEVICE: PnpRecord = {
  instanceId: 'USB\\VID_1234&PID_ABCD\\E2E0001',
  name: '未知设备',
  pnpClass: '',
  problemCode: 28,
  compatibleIds: PRINTER_CLASS,
  parentId: '',
};
/** 清单里没有、但系统认得是打印机的设备（9999:0001）。 */
export const UNKNOWN_PRINTER_DEVICE: PnpRecord = {
  ...CATALOG_DEVICE,
  instanceId: 'USB\\VID_9999&PID_0001\\E2E0002',
  name: 'USB 打印支持',
};

export function e2eCatalogKeys(): TestCatalogKeys {
  return createTestCatalogKeys(TEST_CATALOG_KEY_ID);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function catalogModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example-x1',
    brand: '示例品牌',
    model: '示例型号 X1',
    usb: [{ vendorId: '1234', productId: 'ABCD' }],
    driverNames: ['示例品牌 X1'],
    commandSet: 'tspl',
    windows: {
      url: INSTALLER_URL,
      sizeBytes: INSTALLER_BYTES.length,
      sha256: sha256Hex(INSTALLER_BYTES),
      kind: 'exe',
      silentArgs: ['/S'],
      signer: SIGNER,
    },
    ...overrides,
  };
}

/** 签好的清单原文；signedAt 往前挪可以造出过期的清单。 */
export function catalogText(keys: TestCatalogKeys, models: unknown[], signedAt = Date.now()): string {
  return signedCatalogText(
    {
      schema: 1,
      version: Math.floor(signedAt / MS_PER_SECOND),
      issuedAt: new Date(signedAt).toISOString(),
      expiresAt: new Date(signedAt + VALID_DAYS * MS_PER_DAY).toISOString(),
      models,
    },
    keys,
  );
}

export function fakeDrivers(overrides: Partial<FakeDriverSpec> = {}): FakeDriverSpec {
  return {
    devices: [CATALOG_DEVICE, UNKNOWN_PRINTER_DEVICE],
    files: { [INSTALLER_URL]: INSTALLER_BYTES.toString('base64') },
    authenticode: { status: 'Valid', subject: SIGNER },
    installExitCode: 0,
    printerAfterInstall: NEW_PRINTER,
    ...overrides,
  };
}

/** 本机 HTTP 服务提供清单（清单地址允许本机的 http；内容照样验签）。 */
export async function serveCatalog(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/driver-catalog.json`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
```

- [ ] **Step 3: 写 E2E**

```ts
// e2e/drivers.e2e.ts
import type { ElectronApplication, Page } from '@playwright/test';
import { callApi, openConfig } from './support/app-helpers';
import {
  catalogModel,
  catalogText,
  e2eCatalogKeys,
  fakeDrivers,
  INSTALLER_BYTES,
  INSTALLER_URL,
  serveCatalog,
} from './support/driver-catalog';
import { expect, test } from './support/fixtures';

const keys = e2eCatalogKeys();

function driverCard(page: Page) {
  return page.getByRole('region', { name: '驱动' });
}

function fakeInstalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { e2eFakeDrivers?: { installs: string[] } }).e2eFakeDrivers?.installs ?? []);
}

test('says the catalog address is not configured and still lists the printer devices', async ({ electronApp }) => {
  const { page } = await electronApp.launch({ fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: keys.publicKey });
  await openConfig(page, '打印机');
  const card = driverCard(page);
  await expect(card).toContainText('未配置驱动清单地址');
  await expect(card).toContainText('USB 1234:ABCD · 没装驱动');
  await expect(card).toContainText('驱动清单不可用，不能自动安装');
  await expect(card.getByRole('button', { name: /安装驱动/ })).toHaveCount(0);
});

test('installs the driver from the signed catalog and shows the new printer', async ({ electronApp }) => {
  const server = await serveCatalog(catalogText(keys, [catalogModel()]));
  try {
    const { app, page } = await electronApp.launch({ fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: keys.publicKey });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    const card = driverCard(page);
    await expect(card).toContainText('1 个型号');
    await expect(card).toContainText('清单里没有这个型号');
    await card.getByRole('button', { name: /安装驱动/ }).click();
    await expect(card.getByRole('status')).toContainText('驱动已装好，新打印机：示例标签机');
    await expect(page.locator('.printer-row__name', { hasText: '示例标签机' })).toBeVisible();
    await expect(card).not.toContainText('1234:ABCD');
    expect(await fakeInstalls(app)).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test('refuses a catalog whose signature does not match', async ({ electronApp }) => {
  const envelope = JSON.parse(catalogText(keys, [catalogModel()])) as Record<string, string>;
  const forged = JSON.stringify([catalogModel({ id: 'forged' })]);
  envelope['payload'] = Buffer.from(forged).toString('base64');
  const server = await serveCatalog(JSON.stringify(envelope));
  try {
    const { page } = await electronApp.launch({ fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: keys.publicKey });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    await expect(driverCard(page)).toContainText('驱动清单的签名不对');
    await expect(driverCard(page).getByRole('button', { name: /安装驱动/ })).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test('never runs a download whose SHA-256 differs from the catalog', async ({ electronApp }) => {
  const server = await serveCatalog(catalogText(keys, [catalogModel()]));
  const swapped = Buffer.alloc(INSTALLER_BYTES.length, 0x41).toString('base64');
  try {
    const { app, page } = await electronApp.launch({
      fakePrinters: [],
      fakeDrivers: fakeDrivers({ files: { [INSTALLER_URL]: swapped } }),
      driverCatalogKey: keys.publicKey,
    });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    await driverCard(page).getByRole('button', { name: /安装驱动/ }).click();
    await expect(driverCard(page).getByRole('alert')).toContainText('SHA-256 不一致');
    expect(await fakeInstalls(app)).toEqual([]);
    // 没装上：那台设备还在列表里。
    await expect(driverCard(page)).toContainText('USB 1234:ABCD · 没装驱动');
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 4: 跑 E2E**

Run: `bun run test:e2e -- e2e/drivers.e2e.ts`
Expected: 4 个用例通过。这同时证明构建版主进程的 Ed25519 验签、清单下载（`net.fetch` 到本机 http）、下载器写临时文件、哈希核对都能工作。再跑一次全部 `bun run test:e2e`。

- [ ] **Step 5: 提交**

```bash
git add e2e/support/electron-app.ts e2e/support/driver-catalog.ts e2e/drivers.e2e.ts
git commit -m "test(e2e): driver install from a signed catalog with fake devices" -m "A catalog signed with a key generated in the test is served from localhost and verified by the built app. Covers the missing address, a full install that names the new printer, a forged catalog and a download whose SHA-256 differs, which must never reach the installer." -m "$TRAILER"
```

---

### Task 17: 接上 5a 的「自动」和 5b 的「重新安装驱动」

**Files:**
- Modify: `src/main/printing/printer-probe-host.ts`（Windows 读驱动名）、`src/main/printing/driver-paper.ts`（macOS 解析）、`driver-paper.test.ts`
- Create: `src/main/printing/driver-name.ts`
- Modify: `src/main/printing/fake-printers.ts`（`driverName`）
- Modify: `src/main/drivers/driver-station.ts`、`driver-station.test.ts`（按驱动名装）
- Modify: `src/shared/ipc-contract.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts`
- Modify: 5a 的「自动」猜测处、5b 的诊断修复处（按下面的 grep 找）
- Modify: `e2e/drivers.e2e.ts`

- [ ] **Step 1: 看 5a 是否已经能按打印机读驱动名**

Run: `git grep -n "DriverName\|make-and-model" -- src/main`
- 已经有（5a 的「按驱动名猜」需要它）：记下函数名，Step 2 跳过，后面用它代替 `queryDriverName`。
- 没有：做 Step 2。

- [ ] **Step 2: 按打印机读驱动名**（5a 没有时）

`printer-probe-host.ts`：`ProbeCommand` 改为 `'status' | 'paper' | 'driver'`；`PROBE_SCRIPT` 的 `switch` 里 `'paper'` 分支之后加：

```
      'driver' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + ($printer.DriverName -replace '\s+', ' ')
      }
```

（脚本在 TS 模板字符串里，`\s` 写成 `\\s`，和现有 `err` 分支一样。）

`driver-paper.ts` 加（和 `parseIppPaper` 读同一份 ipptool 输出）：

```ts
const IPP_MAKE_AND_MODEL_PATTERN = /printer-make-and-model \(textWithoutLanguage\) = (.+)$/m;

/** macOS：驱动的型号名（PPD 的 make-and-model），给驱动清单按驱动名查型号用。 */
export function parseIppMakeAndModel(output: string): string | null {
  return IPP_MAKE_AND_MODEL_PATTERN.exec(output)?.[1]?.trim() || null;
}
```

并把 `queryIppPaper` 里调用 ipptool 的部分抽成 `export function runIppAttributes(printerName: string): Promise<string | null>`（失败写日志、返回 null），`queryIppPaper` 改为 `runIppAttributes(name).then((output) => (output === null ? null : parseIppPaper(output)))`。`driver-paper.test.ts` 加：

```ts
test('reads the driver model name from ipptool output', () => {
  expect(parseIppMakeAndModel('printer-make-and-model (textWithoutLanguage) = 示例品牌 X1\n')).toBe('示例品牌 X1');
  expect(parseIppMakeAndModel('printer-name (nameWithoutLanguage) = x\n')).toBeNull();
});
```

```ts
// src/main/printing/driver-name.ts
import { runIppAttributes, parseIppMakeAndModel } from './driver-paper';
import type { PrinterProbeHost } from './printer-probe-host';

/**
 * 打印机的驱动名（Windows 的 DriverName、macOS 的 make-and-model）：按驱动名查驱动清单（5a、5b）。
 * 打印机名必须先经过「系统里有这台」的核对；读不到返回 null。
 */
export async function queryDriverName(printerName: string, host: PrinterProbeHost | null): Promise<string | null> {
  switch (process.platform) {
    case 'win32': {
      const output = host ? await host.query('driver', printerName) : null;
      return output === null || output === '' ? null : output;
    }
    case 'darwin': {
      const output = await runIppAttributes(printerName);
      return output === null ? null : parseIppMakeAndModel(output);
    }
    default:
      return null;
  }
}
```

`fake-printers.ts`：`FakePrinterSpec` 加 `/** 驱动名（E2E 测按驱动名重装驱动）。 */ driverName?: string;`，`FakePrinters` 加 `async driverName(name: string): Promise<string | null> { return this.find(name)?.driverName ?? null; }`。

- [ ] **Step 3: DriverStation 按驱动名装**（`driver-station.test.ts` 先加测试）

```ts
  test('reinstalls by driver name for the diagnosis', async () => {
    const drivers = station();
    await drivers.installForDriverName(' 示例品牌  x1 ');
    await drivers.settled();
    expect(drivers.status().install).toMatchObject({ modelId: 'example-x1', deviceKey: null, state: { phase: 'done' } });
    await expect(drivers.installForDriverName('Generic / Text Only')).rejects.toThrow();
  });
```

`driver-station.ts` 加方法：

```ts
  /** 5b 的「重新安装驱动」：按驱动名找清单里的型号来装；找不到或这个平台没有安装包时抛错。 */
  async installForDriverName(driverName: string): Promise<DriverStatus> {
    await this.ensureCatalog();
    const hint = this.hints().modelForDriverName(driverName);
    if (hint === null || !hint.canInstall) {
      throw new Error(`No installable driver in the catalog for "${driverName}"`);
    }
    return this.installModel(hint.modelId);
  }
```

Run: `bun test src/main/drivers/driver-station.test.ts`
Expected: PASS。

- [ ] **Step 4: IPC**

`ipc-contract.ts`：`IpcChannel` 加 `ReinstallPrinterDriver: 'drivers:reinstall-for-printer',`；`LabelFlashApi` 加

```ts
  /** 5b 诊断里的「重新安装驱动」：按这台打印机的驱动名在清单里找型号，走同一套下载、核对、提权安装；进度经 onDriverStatus 推送。 */
  reinstallPrinterDriver(printerName: string): Promise<DriverStatus>;
```

`ipc.ts`：`IpcDeps` 加 `/** 打印机的驱动名（按驱动名查清单）。 */ driverNameOf: (printerName: string) => Promise<string | null>;`，加处理函数：

```ts
  handle(IpcChannel.ReinstallPrinterDriver, async (printerName) => {
    const name = await requireKnownPrinter(printerName);
    const driverName = await deps.driverNameOf(name);
    if (driverName === null) {
      throw new Error(`Cannot read the driver name of ${name}`);
    }
    return deps.drivers.installForDriverName(driverName);
  });
```

`preload/index.ts` 加 `reinstallPrinterDriver: (printerName) => ipcRenderer.invoke(IpcChannel.ReinstallPrinterDriver, printerName),`。

`index.ts` 的 `registerIpc` 加：

```ts
    driverNameOf: (name) => (fakePrinters ? fakePrinters.driverName(name) : queryDriverName(name, probeHost)),
```

- [ ] **Step 5: 接 5a 和 5b**

Run: `git grep -n "NO_DRIVER_HINTS\|DriverHints" -- src`
- **5a**（指令集「自动」）：按约定，主进程把 `() => NO_DRIVER_HINTS` 传给 5a 的猜测函数。把 `index.ts` 里这一处换成 `() => drivers.hints()`（`drivers` 在它之前创建；顺序不对就把 `DriverStation` 的创建挪到 5a 的指令服务之前，`DriverStation` 只依赖 settings、adapter 和 database）。
  - 5a 没按约定留入口时：在它「按驱动名关键字猜」之前加一步 `const fromCatalog = hints().modelForDriverName(driverName)?.commandSet; if (fromCatalog) { return fromCatalog; }`，按 5a 的指令集类型做映射（`'tspl' | 'zpl' | 'epl'` 和 5a 的 TSPL / ZPL / EPL 一一对应），并在 5a 的测试文件里补一条「清单写了指令集就用清单的」。
- **5b**（诊断）：诊断「驱动报告的状态」那一项的修复「重新安装驱动」，显示条件换成 `drivers.hints().modelForDriverName(驱动名)?.canInstall === true`，按钮调用 `window.api.reinstallPrinterDriver(printerName)`，点完提示「进度见下面的「驱动」」并把页面滚到「驱动」卡片（`document.querySelector('[aria-label="驱动"]')?.scrollIntoView()` 写在 5b 的视图模型里）。
  - 5b 若把这一项写成了恒不显示的占位，按上面改；补测试：清单里有这个驱动名时显示，没有时不显示。

Run: `bun run check`
Expected: 通过。

- [ ] **Step 6: E2E 加一条**（`e2e/drivers.e2e.ts` 末尾）

```ts
test('reinstalls the driver of an installed printer by its driver name', async ({ electronApp }) => {
  const server = await serveCatalog(catalogText(keys, [catalogModel()]));
  try {
    const { app, page } = await electronApp.launch({
      fakePrinters: [{ ...NEW_PRINTER, driverName: '示例品牌 X1' }],
      fakeDrivers: fakeDrivers({ devices: [], printerAfterInstall: null }),
      driverCatalogKey: keys.publicKey,
    });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    await callApi(page, 'reinstallPrinterDriver', NEW_PRINTER.name);
    await expect(driverCard(page).getByRole('status')).toContainText('驱动已装好');
    expect(await fakeInstalls(app)).toHaveLength(1);
  } finally {
    await server.close();
  }
});
```

（import 列表加 `NEW_PRINTER`。装完没有「新」打印机——它本来就在——提示的是「还没看到新打印机」那一句，同样以「驱动已装好」开头。）

Run: `bun run test:e2e -- e2e/drivers.e2e.ts`
Expected: 5 个用例通过；再跑全部 `bun run test:e2e`（5a、5b 的 E2E 不受影响）。

- [ ] **Step 7: 提交**

```bash
git add src/main/printing src/main/drivers src/shared/ipc-contract.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts e2e/drivers.e2e.ts
git add -u src
git commit -m "feat: catalog hints for automatic command sets and driver reinstall" -m "The automatic command set (5a) now asks the online catalog by driver name before guessing from keywords, and the diagnosis (5b) offers to reinstall the driver when the catalog has a package for this platform. Reinstall goes through the same download, verification and single elevation, keyed by the printer's driver name read from the system." -m "$TRAILER"
```

---

### Task 18: 视觉验收 V87–V89

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（第 8.2 节的表）

- [ ] **Step 1: 加验收项**

文件顶部 import 加：

```ts
import {
  catalogModel,
  catalogText,
  e2eCatalogKeys,
  fakeDrivers,
} from '../support/driver-catalog';
```

（`openConfig`、`callApi`、`startServer` 已经导入时不重复；没导入 `openConfig` 就在 `../support/app-helpers` 的列表里按字母顺序加上。）在常量区加：

```ts
/** V87–V89：测试现场生成的清单密钥（公钥经启动选项交给程序）。 */
const DRIVER_KEYS = e2eCatalogKeys();
/** V88：假的提权安装停在「安装」这一步，够截图。 */
const DRIVER_INSTALL_HOLD_MS = 600_000;
/** V89：60 天前签的清单（有效期 30 天），已过期。 */
const EXPIRED_CATALOG_AGE_MS = 60 * 86_400_000;

async function openDriverCard(ctx: Context, catalog: string): Promise<void> {
  const server = await startServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(catalog);
  });
  ctx.cleanups.push(server.close);
  await callApi(ctx.page, 'updateSettings', { driverCatalogUrl: `${server.origin}/driver-catalog.json` });
  await openConfig(ctx.page, '打印机');
  await ctx.page.getByRole('region', { name: '驱动' }).scrollIntoViewIfNeeded();
}
```

在 `ITEMS` 数组里当时最后一项之后加：

```ts
  {
    id: 'V87',
    title: '打印机 · 驱动（发现缺驱动的设备）',
    points:
      '「驱动」卡片在打印机卡片下面，标题和「重新检测」同一行；清单那一行「驱动清单：… 签发，1 个型号，有效期到 …」是普通灰字；两台设备各一行：「示例品牌 示例型号 X1」右侧「安装驱动（0.0 MB）」按钮、下面「USB 1234:ABCD · 没装驱动」；另一台「USB 打印支持」没有按钮，下面是通用驱动的指引；长名字省略不撑宽；「驱动清单地址」收起；1024 宽时按钮不换到下一行',
    launch: { fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: DRIVER_KEYS.publicKey },
    setup: async (ctx) => {
      await openDriverCard(ctx, catalogText(DRIVER_KEYS, [catalogModel()]));
      await expect(ctx.page.getByRole('region', { name: '驱动' })).toContainText('1 个型号');
    },
  },
  {
    id: 'V88',
    title: '打印机 · 驱动（正在安装）',
    points:
      '安装区淡黄底：步骤「下载 核对 安装 找打印机」前两步绿色、「安装」加粗、最后一步灰；下面一句「请在 Windows 弹出的窗口里点「是」…」完整换行不溢出；没有取消按钮（提权之后取消不了）；设备行的按钮和「重新检测」都灰掉',
    launch: {
      fakePrinters: [],
      fakeDrivers: fakeDrivers({ installDelayMs: DRIVER_INSTALL_HOLD_MS }),
      driverCatalogKey: DRIVER_KEYS.publicKey,
    },
    setup: async (ctx) => {
      await openDriverCard(ctx, catalogText(DRIVER_KEYS, [catalogModel()]));
      const card = ctx.page.getByRole('region', { name: '驱动' });
      await card.getByRole('button', { name: /安装驱动/ }).click();
      await expect(card.getByRole('status')).toContainText('点「是」');
    },
  },
  {
    id: 'V89',
    title: '打印机 · 驱动（清单不能用）',
    points:
      '清单那一行红字「驱动清单不能用：驱动清单已在 … 过期（电脑时间是 …）…」完整换行；设备行都没有按钮，指引「驱动清单不可用，不能自动安装：…」；展开「驱动清单地址」后是一行地址设置（输入框、「恢复默认」），和「通用」页的中转地址那一行对齐方式一致',
    launch: { fakePrinters: [], fakeDrivers: fakeDrivers(), driverCatalogKey: DRIVER_KEYS.publicKey },
    setup: async (ctx) => {
      await openDriverCard(ctx, catalogText(DRIVER_KEYS, [catalogModel()], Date.now() - EXPIRED_CATALOG_AGE_MS));
      const card = ctx.page.getByRole('region', { name: '驱动' });
      await expect(card).toContainText('过期');
      await card.getByText('驱动清单地址', { exact: true }).first().click();
    },
  },
```

文件开头说明注释里列验收项编号的地方加上「驱动安装是 V87–V89」。

- [ ] **Step 2: 设计文档的验收表**（第 8.2 节表格最后一行之后）

```
| V87 | 打印机 · 驱动（发现缺驱动的设备） | 卡片在打印机卡片下；清单一行灰字；清单里有的设备有「安装驱动（…MB）」，没有的给通用驱动指引；长名字省略；1024 宽按钮不换行 |
| V88 | 打印机 · 驱动（正在安装） | 步骤条（完成绿、当前加粗、未到灰）；「点「是」」的说明完整换行；提权后没有取消；其他按钮灰掉 |
| V89 | 打印机 · 驱动（清单不能用） | 红字说明过期和电脑时间；设备只有指引；展开的清单地址行和中转地址行一致 |
```

- [ ] **Step 3: 跑视觉验收并逐张核对**

Run: `bunx playwright test --config e2e/visual/playwright.config.ts -g "V8[789]"`
Expected: 三项在 1280 / 1024 / 1920 下通过自动检查；打开 `test-results/visual-acceptance/` 的截图逐项核对 points。再跑一次全部视觉验收，确认中转地址那一行（`UrlSetting` 抽出后）的截图和原来一样：`bunx playwright test --config e2e/visual/playwright.config.ts`。

- [ ] **Step 4: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items for the driver card" -m "V87 to V89 cover found devices with and without a catalog model, an install waiting for the admin prompt, and an expired catalog with the address setting open, at 1280, 1024 and 1920 wide." -m "$TRAILER"
```

（如果 Step 3 改了 `app.css`，一起 `git add`。）

---

### Task 19: 文档、真机验收清单、PR

**Files:**
- Create: `docs/driver-catalog.md`
- Modify: `README.md`、`docs/roadmap.md`、`docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 7.3 节）、`docs/windows-acceptance.md`
- Modify: `CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`

- [ ] **Step 1: 给出品方的说明 `docs/driver-catalog.md`**

````markdown
# 驱动清单：生成密钥、写清单、签名、上传

「打印机」页的「驱动」一节按 USB 厂商号 / 产品号在**驱动清单**里找到型号，下载厂家官方安装包，核对大小、SHA-256 和数字签名者后静默安装。清单里有品牌和厂家网址，所以**不进仓库**，放在网上；程序只认带出品方签名的清单。

## 怎么保证安全

- 清单用 Ed25519 签名，公钥内置在程序里（`src/shared/driver-catalog-keys.ts`），私钥只在出品方手里、离线保存。清单被改过、被换成别人签的，程序都不用。
- 清单有版本号（签名时刻）和有效期（默认 180 天）。程序记住用过的最高版本，更旧的清单和过期的清单都不用——撤下的驱动不会被旧清单「复活」。
- 安装包只从清单写的 https 地址下载；大小、SHA-256 必须和清单一致，Windows 上 Authenticode 签名必须有效且签名者与清单逐字相同，macOS 上 pkg 必须是 Apple 签发的开发者证书签的、签名者逐字相同。任何一项不对就不装。
- 真正运行的是复制到管理员专属目录、再核对一次 SHA-256 的那份文件。

## 第一次：生成密钥并内置公钥

1. 在一台可信的电脑上：

   ```
   bun run driver-catalog:keygen --out <私钥文件，例如 E:\keys\labelflash-catalog-2026a.pem> --key-id 2026a
   ```

   私钥放在加密的 U 盘或密码管理器里，不提交、不上传、不发给别人。命令会打印公钥。
2. 把打印出的 `'2026a': '<公钥>'` 加进 `src/shared/driver-catalog-keys.ts`，经 PR 合进 master。**发布的程序里有这把公钥之后**，它签的清单才会被接受（发布作业也会检查这里不为空）。

## 写清单

清单源文件（例如 `driver-catalog.source.json`，文件名以 `driver-catalog` 开头的 JSON 已被 `.gitignore` 忽略，**不要放进仓库**）只写 `models`，其余由签名脚本填：

```json
{
  "models": [
    {
      "id": "example-x1",
      "brand": "示例品牌",
      "model": "示例型号 X1",
      "usb": [{ "vendorId": "1234", "productId": "ABCD" }],
      "driverNames": ["示例品牌 X1"],
      "commandSet": "tspl",
      "windows": {
        "url": "https://example.invalid/drivers/x1-setup.exe",
        "sizeBytes": 12900000,
        "sha256": "<64 位十六进制>",
        "kind": "exe",
        "silentArgs": ["/S"],
        "signer": "CN=示例品牌有限公司, O=示例品牌有限公司, L=…, C=CN"
      },
      "macos": { "downloadPage": "https://example.invalid/drivers/x1-mac" }
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 型号编号：小写字母、数字、横杠，清单里唯一 |
| `brand`、`model` | 界面上显示的品牌和型号（品牌 ≤ 40 字、型号 ≤ 80 字） |
| `usb` | 1–16 个 `{vendorId, productId}`，各 4 位十六进制。Windows「设备管理器」→ 设备 → 属性 → 详细信息 → 硬件 ID 里的 `VID_xxxx&PID_xxxx` |
| `driverNames` | 装好后系统里的驱动名（Windows「打印机属性 → 高级 → 驱动程序」；macOS 的打印机型号名），最多 8 个。指令集「自动」和诊断的「重新安装驱动」靠它认型号 |
| `commandSet` | `tspl`、`zpl`、`epl` 或不写 |
| `windows.url` | 官方安装包的 https 地址（厂家官网或你自己镜像的副本） |
| `windows.sizeBytes`、`sha256`、`signer` | 用 `bun run driver-catalog:describe <安装包>` 在 Windows 上读出来，原样复制 |
| `windows.kind` | `exe` 或 `msi` |
| `windows.silentArgs` | 静默安装参数，最多 8 个，每个只能有字母、数字和 `_ . / : = + -`（不能带空格、引号和路径）。常见写法：NSIS `/S`；Inno Setup `/VERYSILENT` `/SUPPRESSMSGBOXES` `/NORESTART`；InstallShield `/s`；msi 不用写 `/qn`（程序会加），可以写属性如 `ALLUSERS=1`。**先在一台电脑上手工跑一次确认真的不弹窗** |
| `windows.successExitCodes` | 可选：哪些退出码算成功（默认只有 0；3010、1641 总是按「装好了、要重启」处理） |
| `macos.pkg` | 可选：`{url, sizeBytes, sha256, signer}`，`signer` 是 `pkgutil --check-signature` 证书链第一行（`Developer ID Installer: …`），在 Mac 上用 `describe` 读 |
| `macos.downloadPage` | 没有 pkg 时打开的官方下载页（https） |

## 签名

```
bun run driver-catalog:sign --in driver-catalog.source.json --out driver-catalog.json --key-id 2026a --key <私钥文件>
```

- 也可以用环境变量 `LABELFLASH_DRIVER_CATALOG_KEY_FILE` 指定私钥文件。
- 有效期默认 180 天，`--valid-days` 可改（最长 400）。
- 任何一个型号不合格都不会签，并列出原因；私钥对应的公钥不在程序里也不会签。

## 上传

清单和中转服务放在同一台服务器上，由 nginx 直接提供静态文件（不经过中转服务）：

```nginx
# 放在中转服务那个 server 里；路径按自己的服务器改。
location = /labelflash/driver-catalog.json {
    alias /srv/labelflash/driver-catalog.json;
    default_type application/json;
    add_header Cache-Control "no-cache";
}
```

- nginx 跑在容器里时，把放清单的目录挂进容器（只读）。
- 上传时先传成临时文件再改名，避免程序下载到写了一半的文件：

  ```
  scp driver-catalog.json <服务器>:/srv/labelflash/driver-catalog.json.tmp
  ssh <服务器> mv /srv/labelflash/driver-catalog.json.tmp /srv/labelflash/driver-catalog.json
  ```
- 用浏览器打开清单地址，能看到 `{"format":1,"keyId":…}` 就对了。

## 让官方安装包带上清单地址

在 GitHub 仓库的 Settings → Secrets and variables → Actions → Variables 里加 `LABELFLASH_DEFAULT_DRIVER_CATALOG_URL`，值是上面的完整地址。CI 构建安装包时注入（代码里不写域名）；没设这个变量发布作业会失败。自己构建时可以用环境变量 `CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL` 指定；都没有时界面显示「未配置驱动清单地址」，用户可以在「驱动清单地址」里自己填。

## 续签、更新、换密钥

- **续签**：到期前（建议每 3–4 个月）重新签一次、上传。过期后程序不再用它，「驱动」一节显示过期日期。
- **加型号、改安装包**：改源文件、重新签名、上传。版本号自动变大，用户下次检测时拿到新清单。
- **换密钥**：生成新密钥 → 新公钥加进 `driver-catalog-keys.ts`（旧的保留）→ 发布程序 → 大家更新后用新私钥签清单 → 再发一版删掉旧公钥。
- **私钥泄露**：立即按「换密钥」做，并在新版程序里删掉旧公钥；旧版程序在更新之前仍信任旧公钥，所以同时尽快让用户更新。泄露期间别人签的清单仍要过「https 下载 + 厂家签名者核对」这一关。
````

- [ ] **Step 2: README、路线图、设计文档、验收记录**

`README.md`「功能」列表里「**本机接口**」那一条之前加：

```
- **驱动安装**：配置中心「打印机」页的「驱动」一节列出没有可用驱动的 USB 打印设备。驱动清单里有的型号，点「安装驱动」就会下载厂家官方安装包，核对大小、SHA-256 和数字签名者后，弹一次管理员确认静默安装，再提示给新打印机分配纸张；macOS 上清单只有下载页的型号打开官方下载页。清单里没有的型号给出用系统通用驱动或到厂家官网下载的指引。驱动清单是在线的、带出品方签名（品牌和厂家网址不进仓库），地址是设置项；官方安装包自带地址，自己构建的要在「驱动清单地址」里填写。出品方怎么生成密钥、签名、上传见 [docs/driver-catalog.md](docs/driver-catalog.md)。
```

README 里说明中转默认地址那一行（「安装包的默认中转地址来自仓库的 Actions 变量…」）之后加：「驱动清单的默认地址同理来自 Actions 变量 `LABELFLASH_DEFAULT_DRIVER_CATALOG_URL`，自己构建时用环境变量 `CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL`。」

`docs/roadmap.md` 状态表加一行：

```
| 驱动安装（在线签名清单）：发现缺驱动的 USB 打印设备，按 VID/PID 查清单，下载官方安装包，核对大小、SHA-256、签名者后一次提权静默安装；macOS 装 pkg 或打开下载页；给 5a 的「自动」和 5b 的「重新安装驱动」按驱动名查清单 | 必须 | 开发完成（`feature/driver-install`），随 2.0.0 发布；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.3 节。E2E 和视觉验收 V87–V89 在 Windows 上通过；真机（一台没装驱动的热敏标签机）安装、macOS 全部待人工验收 |
```

设计文档第 7.3 节末尾加：

```
- **实现时定下的细节**（2026-10-02，见 `docs/superpowers/plans/2026-10-02-driver-install.md`）：
  - 清单是一个签名信封文件（`format`、`keyId`、`payload` = 清单原文 base64、`signature` = Ed25519），签名覆盖固定的用途前缀加原文；公钥内置（可多把），私钥离线。
  - 版本号 = 签名时刻的 Unix 秒数，程序记住用过的最高版本（settings 表的独立键，界面改不到）；默认有效期 180 天，最长 400 天。连不上时用同一地址上次的清单（重新核对）。
  - 单个型号不合格时跳过；`schema` 比程序新时整份不用并提示更新。签名脚本对任何不合格都拒签。
  - Windows 检测：`Win32_PnPEntity` 里有问题代码的 `USB\VID_*` / `USBPRINT\*`，后者经父设备取 VID/PID；列出打印机类的设备和清单里有的设备。
  - Windows 安装：普通权限核对大小、SHA-256、Authenticode（Valid + Subject 逐字相同）→ 一次 UAC → 提权脚本复制到只有 Administrators / SYSTEM 能写的新目录、复核 SHA-256 后运行（exe 带静默参数、msi 用 msiexec /qn /norestart）→ `pnputil /scan-devices` → 每 2 秒列一次打印机、最多 30 秒找新打印机。超时 15 分钟。
  - macOS：USB 设备来自 system_profiler，按序列号 / 型号名和 CUPS 的 usb 队列对，只列清单里有、没有队列的；pkg 用 `osascript … with administrator privileges` 运行固定脚本（root 专属目录里复核 SHA-256 再 `installer`）。
  - 装完只提示给新打印机分配纸张，不自动分配（沿用打印机页「只建议」的规则）。
  - 清单放在中转服务那台服务器的 nginx 静态文件里，不经中转服务。
```

`docs/windows-acceptance.md` 末尾加「驱动安装（待验收）」一节，列出 Step 4 的真机清单，每项留「结果 / 日期」两栏。

- [ ] **Step 3: CLAUDE.md**

根目录 `CLAUDE.md`：
- 「平台」表在「打印机状态检测与异常通知」之前加一行：`| 驱动安装（在线签名清单） | ✅ PnP 检测、Authenticode、一次 UAC 静默安装 | ✅（未在 Mac 上验证）只认清单里有的型号；pkg + 管理员密码，或打开官方下载页 |`
- 「命令」表在 `bun run ocr:models` 之前加：`| bun run driver-catalog:keygen` / `driver-catalog:sign` / `driver-catalog:describe` | 驱动清单的密钥、签名、读安装包的大小 / SHA-256 / 签名者（见 docs/driver-catalog.md） |`
- 「数据与环境」的「假打印机」之后加一条：`- **假驱动环境**：E2E 和视觉验收用 CDL_LABELFLASH_FAKE_DRIVERS（缺驱动的设备、安装包下载、签名核对、提权安装）和 CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY（额外信任的清单公钥），同样只对未打包的程序生效，见 src/main/drivers/fake-drivers.ts。`
- 「发版步骤」第 3 条的检查改为「…；设置了仓库的 Actions 变量 `LABELFLASH_DEFAULT_RELAY_URL` 和 `LABELFLASH_DEFAULT_DRIVER_CATALOG_URL`；`src/shared/driver-catalog-keys.ts` 里至少有一把公钥」。
- 「安全底线」加一条：`- 下载的驱动安装包在核对大小、SHA-256（签名清单里的值）和签名者之前绝不运行；运行的是复制到管理员专属目录、复核过哈希的那份。驱动清单只用内置公钥核对通过、没过期、不比用过的旧的。`
- 「文档」表加 `| docs/driver-catalog.md | 给出品方：驱动清单的密钥、格式、签名、上传、续签 |`。

`src/core/CLAUDE.md` 模块表加：

```
| `drivers/` | 驱动安装的纯逻辑：`usb-id.ts`、`catalog-model.ts` + `sanitize-catalog.ts`（在线清单的模型和严格校验，不合格的型号跳过）、`catalog-freshness.ts`（过期、防回滚）、`install-plan.ts`（按平台：安装 / 打开下载页 / 没有安装包 / 不在清单）、`driver-hints.ts`（和 5a、5b 约定的按驱动名查清单的接口）+ `catalog-hints.ts`、`detected-device.ts`、`driver-install-flow.ts`（下载 → 核对 → 提权安装 → 找新打印机，端口注入，假实现在 `testing/fake-driver-ports.ts`） |
```

`src/main/CLAUDE.md`「其他子系统」表之后加一节：

```
## 驱动安装（`drivers/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 7.3 节，给出品方的说明在 `docs/driver-catalog.md`。

- **清单**：`catalog-signature.ts`（Ed25519 信封，不依赖 electron，签名脚本也用）、`catalog-client.ts`（`net.fetch`、2MB 上限、15 秒超时、验签 → `sanitizeCatalog` → 过期和防回滚、退回同一地址上次的清单）、`catalog-state-store.ts`（最高版本和上次的清单存在 settings 表的独立键里，界面改不到）。地址：设置 `driverCatalogUrl` 优先，构建时注入的默认值（`build-defaults.ts`）兜底；代码里不写域名。
- **下载**：`installer-downloader.ts`：只要 https（跳转后也是），按清单的大小截断，边写边算 SHA-256，空闲 60 秒 / 总共 30 分钟超时，只删自己建的临时目录。
- **平台**：`windows-devices.ts`（一次性 PowerShell 查 `Win32_PnPEntity`，不放进常驻探测进程）、`windows-signature.ts`（Authenticode）、`windows-install.ts`（一次 UAC；提权脚本只用 .NET 类型，在管理员专属目录复核哈希后运行）、`mac-devices.ts`、`mac-install.ts`（`osascript … with administrator privileges` 运行固定脚本）；解析都是纯函数，按平台测试。平台选择只在 `driver-ports.ts`。
- **编排**：`driver-station.ts`：同一时间一个安装；界面只能按设备编号装、打开清单里的 https 下载页；进度最多 0.25 秒推一次（`drivers:status-changed`）；装驱动时不静默更新。`hints()` 给 5a、5b 按驱动名查。
- **假环境**：`fake-drivers.ts`（`CDL_LABELFLASH_FAKE_DRIVERS`、`CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY`，只对未打包的程序生效），一律走 Windows 流程；清单照样真实下载、真实验签。
```

`src/renderer/CLAUDE.md`「测试与验收」的 E2E 一条括号里加「，驱动安装在 `drivers.e2e.ts`」。

- [ ] **Step 4: 真机验收清单**（写进 `docs/windows-acceptance.md` 的「驱动安装（待验收）」一节，PR 合并前在 Windows 上做前四项）

1. 用真实私钥签一份只含一个型号的清单，上传，安装版里「驱动清单地址」填它：显示签发日期、型号数。
2. 一台没装驱动的热敏标签机（插上后设备管理器里是问题代码 28 的「未知设备」或「USB 打印支持」下的打印机）：「驱动」一节列出它；点「安装驱动」→ 下载、核对 → UAC（显示的是 Windows PowerShell）→ 静默安装不弹安装程序窗口 → 30 秒内出现新打印机 → 「纸张 → 打印机」出现「建议」→ 分配后打一张测试页。日志里每一步都有记录、没有秘密。
3. UAC 点「否」：提示「管理员确认被取消了」，临时目录（`%TEMP%\cdl-labelflash-driver-*`）已删除。
4. 把清单里的 SHA-256 改一位重签：提示「SHA-256 不一致」，没有弹 UAC。
5. Windows 防火墙 / 杀毒软件开着时安装过程不被拦截（被拦截时记录现象）。
6. macOS（Apple 芯片和 Intel 各一次）：清单里有 pkg 的型号输管理员密码安装、只有下载页的型号打开浏览器；`system_profiler` 新旧两种输出都能认出设备。

- [ ] **Step 5: `bun run check` 后提交，推送，开 PR**

```bash
git add docs/driver-catalog.md README.md docs/roadmap.md docs/superpowers/specs/2026-10-01-feature-parity-design.md docs/windows-acceptance.md CLAUDE.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs: driver install and how to publish the signed catalog" -m "A guide for the publisher on generating keys, the catalog format, signing, uploading next to the relay and renewing; README, roadmap, the decisions made while building it, the real-machine checklist, and where the code lives in each layer." -m "$TRAILER"
git push -u origin feature/driver-install
gh pr create --base master --title "feat: driver install from a signed online catalog (sub-project 5c)" --body "<中文说明：做了什么、为什么、安全设计（签名清单、防回滚、哈希钉死、管理员专属目录复核）、验证（单元测试、E2E、视觉验收 V87–V89、Windows 真机第 1–4 项）；macOS 未在真机验证要写明；需要用户做的事（生成密钥、填公钥、上传清单、设 Actions 变量）；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并。

---

## Self-Review 记录

- **设计覆盖（第 7.3 节）**：
  - 在线清单（不进仓库、地址是设置项、官方安装包构建时注入、开源构建显示「未配置驱动清单地址」）→ Task 5、6、14、15；字段（VID/PID → 品牌、型号、指令集、Windows 下载地址、大小、SHA-256、静默参数、签名者；macOS pkg 或下载页）→ Task 1；清单签名、内置公钥、私钥离线、`sign.ts` / `keygen.ts`、严格校验、大小上限、版本号 + 有效期防回滚 → Task 1、3、4、6。
  - Windows 流程：发现没有驱动的 USB 打印设备 → Task 9；查清单 → Task 2、12；下载（`net.fetch`、上限、流式 SHA-256、超时）→ Task 8；核对大小、SHA-256、Authenticode → Task 7、10；一次 UAC 静默安装（提权方式、退出码、超时）→ Task 10；重新列打印机、提示分配纸张 → Task 7、15；删除下载 → Task 7、8。
  - macOS：pkg 下载、SHA-256、`pkgutil` 签名者、`installer` + 管理员密码（`osascript` 的理由）→ Task 11；没有 pkg 打开 https 下载页 → Task 12、13。
  - 清单里没有的型号的指引 → Task 14。UI（「驱动」一节、进度、中文）→ Task 14、15；E2E 假模式（仅未打包）→ Task 13、16；视觉 V87–V89 → Task 18；出品方文档 → Task 19。
  - 5a「自动」、5b「重新安装驱动」的接口 → 「给 5a、5b 的接口约定」、Task 1（`driver-hints.ts`）、Task 17。
  - 第 9 节（不可信输入有上限、管理员权限只在点按钮时弹并说明、SHA-256 和签名者不对就不装、中文提示和日志）、第 11 节（Rule of 2：清单在主进程里用内存安全的 TS 解析、处处有上限；安装包在核对之前是不可信的、核对之后才进高权限；IPC 只收设备编号；快速失败）→ 各任务。
- **没有占位**：每个代码步骤给出完整代码。条件分支只有两处，改法都写全：Task 17 Step 1（5a 已有读驱动名的函数就复用）和 Step 5（5a、5b 没按约定留入口时怎么接）；Task 3 Step 5（Electron 的 Ed25519 不可用时换 WebCrypto，写计划时已实测可用）。
- **类型一致**：`UsbId`（Task 1）贯穿 `CatalogModel.usb`、`DetectedDevice.usbId`、`findModelByUsbId`；`InstallTarget`（Task 2）是 `runDriverInstall`、`PrivilegedInstaller.install`、`InstallerVerifier.check` 的参数；`DownloadedFile`、`SignatureCheck`、`PrivilegedOutcome`（Task 7）由 Task 8、10、11、13 实现；`CatalogLoad`（Task 6）进 `DriverStation`（Task 12）再变成 `CatalogView`（`src/shared/drivers.ts`）；`DriverStatus` / `DriverInstallView.id`（Task 12）被 `use-drivers` 用来只刷新一次打印机；`DEVICE_KEY_PATTERN`（Task 7）同时用于 `deviceKey` 和 `requireDriverDeviceKey`（Task 13）；`PnpRecord`（Task 9）是假环境和 E2E 夹具的设备形状；`FetchFunction` 只在 `catalog-client.ts` 定义一次，下载器和假环境复用。
- **需要用户确认的取舍**：装完是否要**自动**分配纸张（现在沿用打印机页「只建议」的规则）；清单默认有效期 180 天是否合适；Windows 的 UAC 框显示的是 Windows PowerShell（和防火墙按钮一样），不是厂家名字，界面说明里已写明。
- **已知限制（写进文档）**：macOS 只认清单里有的型号；不支持只有 INF 的驱动包（只支持 exe / msi / pkg）；不支持要写安装路径的静默参数；安装超时后提权进程收不回来；厂家安装程序自己解压到用户临时目录时的安全性取决于厂家。
