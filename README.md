# CDL-云签速印（LabelFlash）

CDL 出品的样衣标签重打工具。用扫码枪扫描样衣标签上的二维码（`编码-颜色-尺码`，例如 `CL5640-TK-图片色-XL`），软件会立即按模板生成 60×40mm 标签的预览，并在选中的本机打印机上打印。

## 功能

- **扫码即打**：扫码后自动预览、自动打印；也可以切换成手动模式，预览确认后按 F2 打印。
- **防重复打印**：同一张标签在设定时间内只打印一次，默认 3 秒，主要用来挡住扫码枪连按。每次拦截都会显示、播报并记入打印记录。时间可以在设置里按秒调整，填 0 表示不拦截。重启软件后这个时间窗口依然有效。需要再打一张时，可以用"强制补打"。
- **打印模板**：
  - 内置 5 套 60×40mm 模板。
  - 可以复制成自定义模板后自由调整：二维码的位置、尺寸和容错等级，每个字段的显示、前缀、字号和加粗，按区域统一的对齐方式，以及备注文字。
  - 备注可以放在二维码旁的空白处或底部，支持 `{日期}`、`{时间}`、`{编码}` 等变量。
  - 扫码框旁的「备注」下拉框可以一键切换常用备注。
- **打印记录**：
  - 可以回看任意一条记录的预览，也可以重打。
  - 记录按环形方式保留，默认最多 10 万条，超出后自动删除最早的记录。
  - 支持按编码、颜色、尺码全文搜索。
- **打印机**：本机打印机再多，也可以搜索后选择。选择会保存下来。软件会检测打印机是否离线、缺纸或卡纸，并检查驱动默认纸张是否为 60×40mm。
- **无边框窗口**：关闭窗口时最小化到托盘，并支持开机自启。
- **语音播报**：每种结果播一句固定的话，共 18 句，用词和状态栏一致，例如「已发送打印」「重复扫码，已拦截」「打印机缺纸」。播报按「故障 > 提醒 > 确认」分级，故障提示不会被随后的确认打断。设置页可以调整音色和语速，并逐句试听。音频缓存在本机，播放无延迟。
- **打印机异常提醒**：离线、缺纸、卡纸时弹出系统通知；同类问题 30 分钟内不重复，每天最多 2 次。
- **自动更新**：从 GitHub Releases 后台下载新版本，标题栏提示后重启即可更新；也可以在设置页手动检查。

## 数据与日志

所有数据都保存在 `%LOCALAPPDATA%\CDL-LabelFlash\`：

| 路径 | 内容 |
|---|---|
| `labelflash.db` | SQLite 数据库（Electron 内置 `node:sqlite`），包含设置、自定义模板和打印记录 |
| `logs\labelflash-YYYY-MM-DD.log` | 运行日志，每天一个文件（纯文本、UTF-8，时间带时区），保留最近 14 天；同一天超过 5MB 时滚动为 `.1.log`、`.2.log`。遇到问题时，把出问题那天的文件发给维护人员 |
| `voice-cache\` | 语音播报的 mp3 缓存，可随时删除，下次会重新生成 |

## 扫码枪设置

扫码枪需要能输出中文（二维码里有"图片色"之类的中文）。请按扫码枪说明书扫描"中文输出 / Windows Unicode"设置码，并把 Windows 输入法切换到英文状态。

## 开发

需要 [Bun](https://bun.sh) 1.4 或更高版本。

```bash
bun install
bun run dev        # 启动开发版
bun run check      # lint + 类型检查 + 单元测试
bun run test:e2e   # 构建后用 Playwright 启动 Electron 跑端到端测试
bun run icons      # 修改 resources/*.svg 后重新生成图标
bun run installer:skin  # 只生成安装界面的皮肤（调界面时用），输出到 dist/.installer/
bun run dist:win   # 在 Windows 上打安装包，输出到 dist/
```

安装包的界面是自绘的圆形窗口（nsNiuniuSkin 插件，来源和许可见 `resources/installer/plugins/NOTICE.md`）：

- 界面的图片和布局由 `scripts/installer/skin-design.ts` 生成，文案也都在那里。
- 安装脚本是 `resources/installer/`。
- `dist:win` 分两段调用 electron-builder。不要直接运行 `electron-builder` 出安装包，那样得到的是默认界面。

GitHub Actions 在 Windows 上运行：

- 推送到 `master` 或提交 PR：执行检查和 E2E 测试，并上传安装包产物。
- 推送 `v*` 标签：electron-builder 把安装包和 `latest.yml` 发布到 GitHub Release，已安装的客户端会自动更新。

发布新版本：

1. 修改 `package.json` 里的 `version`。
2. 提交后打标签，例如 `git tag v0.2.0 && git push --tags`。

## 目录结构

```
src/core       业务层（纯 TypeScript，不依赖 Electron）：解析、防重门限、打印队列、模板、PrintService
src/shared     主进程与界面共用：IPC 契约、设置、常量
src/main       Electron 主进程：app:// 协议、安全加固、SQLite 存储、打印适配器、打印机状态与异常通知、驱动纸张检测、语音缓存、IPC、窗口、托盘、日志、自动更新
src/preload    contextBridge
src/renderer   界面（React，MVVM：view-models + components）
e2e/           Playwright 端到端测试
docs/          设计文档、实施计划与路线图
```
