# resources/installer — 改安装包前先读

整体说明见同目录的 `README.md`。这里记录改动时必须遵守的约束，以及实际踩过的坑。

## 约束

- **文案只在一处**：全部写在 `scripts/installer/skin-design.ts` 的 `SKIN_TEXT`。XML 里的静态文字和 NSIS 用的常量都从这里生成，不要在 `.nsi` / `.nsh` 里写中文文案。
- **控件名要登记**：安装脚本读写的控件列在 `SKIN_CONTROLS`，测试会核对每种缩放的 XML 里都有这些控件。新增控件时两边一起改。
- **布局用逻辑像素**：所有坐标写在 `LAYOUT` 里，按 100% 缩放的逻辑像素写，生成时按比例换算。插件本身不会随系统缩放放大界面（`EnableDpi` 在这个版本里无效），所以每种缩放各生成一份皮肤，安装时按系统 DPI 挑最接近的那份。
- **`skin-ui.nsh` 要自给自足**：自己 include 用到的头文件（`LogicLib`、`FileFunc`、`WinMessages`），不依赖 `installer.nsi` 的 include 顺序。这样换个简单的脚本也能引用它来预览界面。
- **插件 DLL 必须和登记的一致**：哈希登记在 `NOTICE.md` 和 `scripts/installer/plugin.ts`。构建时逐字节校验，`.gitattributes` 把 `*.dll` 标为 binary。
- **防火墙规则**：安装和卸载都经 `firewall.nsh` 运行 `firewall.ps1`（由 `build-skin.ts` 从 `src/shared/firewall-rule.ts` 生成，和程序里的按钮同一份脚本），只动本程序路径下的规则。PowerShell 写系统目录的绝对路径，用 `-Command` 把脚本当作代码块运行（组策略规定了执行策略时 `-File` 会被拦下）；路径按 PowerShell 单引号字符串转义（用户名里可以有单引号）。
- **卸载程序只来自第一段**：它由 electron-builder 自带脚本加上 `resources/installer.nsh` 生成。卸载时的行为改在 `installer.nsh` 的 `customUnInstall` 里；覆盖安装和更新都会带 `--updated` 运行旧版的卸载程序，这时不能删开机自启项。

## NSIS 的坑（都实际遇到过）

- **比较运算符**：LogicLib 的 `==` 是字符串比较，`=` 才是整数比较。拿系统调用的返回值（例如 `WAIT_TIMEOUT` = 258）做比较时，要么用 `=`，要么把常量写成十进制字符串。写成 `$0 == 0x102` 时，字符串 "258" 永远不等于 "0x102"。
- **行尾反斜杠**：注释最后一个字符是 `\` 时，NSIS 把下一行也并进注释，下一行的语句就被悄悄吃掉了。编译时会出现 warning 6050。
- **警告即错误**：electron-builder 把 NSIS 警告当成错误。多用户支持里声明了却没用到的变量（`$hasPerUserInstallation`、`$perMachineInstallationFolder` 等）要显式赋值，否则报 warning 6001。
- **编码**：makensis 以 `-INPUTCHARSET UTF8` 读所有文件，`.nsi` / `.nsh` 保持 UTF-8。
- **插件函数名**：官方这个版本的函数名是 `SetWindowTile`（插件自己拼错了，不是 `SetWindowTitle`）。`InitSkinPage "$PLUGINSDIR\" ""` 从 `$PLUGINSDIR` 读 `skin.zip` 和 `logo.ico`。
- **安装进程**：用 `ShellExecuteExW` 加 `SEE_MASK_NOCLOSEPROCESS` 启动，拿到进程句柄，再轮询 `WaitForSingleObject` 和 `GetExitCodeProcess` 得到结果。子进程中途出错也能按退出码判断。
- **子进程的单实例检查**：子进程（`/skin-child`）要跳过「只允许一个安装程序」的检查，因为界面进程还在运行。
- **`/D=` 参数**：必须放在命令行最后，而且不能加引号。

## 测试

- **单元测试**：`bun test scripts/installer`，覆盖圆弧几何、DPI 选择（与 NSIS 宏逐一对照）、XML 与控件清单、zip 格式、插件哈希、构建参数。
- **Windows 实测**（改动后必须做）：
  - 双击安装：等它自动启动程序；
  - 模拟失败：看是否回到配置页并显示错误码；
  - 静默更新：`--updated /S`，确认没有任何窗口；
  - 界面更新：`--updated --force-run`；
  - 静默卸载：检查开机自启项、快捷方式、安装目录都删掉了，用户数据还在。
  - 从 Git Bash 调用时加 `MSYS_NO_PATHCONV=1`，否则 `/S` 会被改写成路径。
- **只调界面**：用 electron-builder 缓存里的 makensis（`%LOCALAPPDATA%\electron-builder\Cache\nsis\…\Bin\makensis.exe -INPUTCHARSET UTF8`），编译一个只 include `skins.nsh` 和 `skin-ui.nsh` 的小脚本。在这个脚本里用 `ping` 之类的命令代替真正的安装，不用每次都跑完整的两段构建。
- **截图和点击前**：先关掉上一轮留下的安装窗口。几轮窗口的位置完全相同，截到、点到的会是旧窗口。
