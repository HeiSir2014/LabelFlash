# 安装包

本目录只用于 Windows 安装包，macOS 目前还没有安装包，见 `docs/roadmap.md`。

Windows 安装包由 electron-builder 的 NSIS 目标生成，界面是自绘的圆形窗口（nsNiuniuSkin 插件）：

- 窗口是一个圆，圆以外全透明，只有一个关闭按钮；
- 配置页：图标和名称横排、一句简介、「立即安装」、安装位置；
- 安装中：刻度盘上的进度，外沿一段发光的弧不停绕行；
- 装完整圈变绿打勾，随即启动程序并关闭窗口，不需要用户再点。

## 文件

| 文件 | 作用 |
|---|---|
| `installer.nsi` | 自定义安装脚本（electron-builder 的 `nsis.script`） |
| `skin-ui.nsh` | 界面流程：配置页 → 安装中 → 完成，以及启动、轮询安装进程 |
| `plugins/x86-unicode/nsNiuniuSkin.dll` | 界面插件 |
| `plugins/NOTICE.md` | 插件的来源、版本、许可和 SHA-256 |
| `../installer.nsh` | 两段构建都会包含的片段：卸载时删除开机自启项（覆盖安装和更新时不删） |
| `../../scripts/installer/skin-design.ts` | 界面的图片（SVG）、页面（XML）和全部文案 |
| `../../scripts/installer/build-skin.ts` | 按 100%–300% 七种缩放生成皮肤包，输出到 `dist/.installer/` |
| `../../scripts/installer/build-installer.ts` | 两段构建 |

## 构建

```bash
bun run dist:win        # 完整安装包，输出到 dist/
bun run installer:skin  # 只生成皮肤包，调界面时用
```

`dist:win` 在 `electron-vite build` 和 bundle 检查之后调用 `build-installer.ts`，依次做这几件事：

1. 校验插件 DLL 的 SHA-256，不对就中止。
2. 生成七份皮肤包，以及安装脚本要用的 `skins.nsh`（文案、动画参数、按 DPI 选皮肤的宏）。
3. **第一段**：用 electron-builder 自带的脚本打一次（不压缩）。electron-builder 遇到自定义脚本时不会生成卸载程序，所以借这一段取得卸载程序，由签名钩子 `capture-uninstaller.cjs` 复制出来。
4. **第二段**：复用第一段打好的程序目录，用 `installer.nsi` 打出发布的安装包、blockmap 和 `latest.yml`。

不要直接运行 `electron-builder`：那样得到的是默认界面，也没有卸载程序。

## 运行方式

| 场景 | 参数 | 表现 |
|---|---|---|
| 双击安装 | 无 | 显示配置页；点「立即安装」后，界面进程以静默子进程（`/skin-child /S`）执行真正的安装，按子进程的退出码显示结果 |
| 点「重启更新」 | `--updated --force-run` | 跳过配置页，直接显示「正在更新」，装完启动新版本 |
| 退出程序时安装更新 | `--updated /S` | 不显示任何窗口，装完不启动程序 |
| 静默安装 | `/S`，可加 `/D=目录`（必须放在最后） | 不显示任何窗口 |

- 只按当前用户安装，不需要管理员权限，默认目录是 `%LOCALAPPDATA%\Programs\CDL-LabelFlash`。
- 用户选的目录最后一级如果不是程序目录名，会自动补上：卸载会删除整个安装目录，不能直接装进用户自己的文件夹。
- 卸载会删除安装目录、快捷方式和开机自启项，保留 `%LOCALAPPDATA%\CDL-LabelFlash` 里的用户数据。

## 更换插件版本

1. 从作者的官方仓库取新的 DLL，放到 `plugins/x86-unicode/`。
2. 更新 `plugins/NOTICE.md`（来源提交、版本、SHA-256）和 `scripts/installer/plugin.ts` 里的哈希。
3. 跑 `bun run dist:win`，然后在 100% 和 150% 缩放下各实际装一次。
