# src/renderer — 界面

React 19 + TypeScript，按 MVVM 分三层。页面结构（工作台 + 全窗口的配置中心；批量打印页和配置中心同级）见 `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`。

## 分层

| 层 | 目录 | 要求 |
|---|---|---|
| 纯逻辑 | `src/lib/` | 不碰 React、DOM 和 `window.api`，用 `bun test` 测试：状态文字、焦点规则、多行扫码拼接、播报调度、扫码去向、手机扫码的文字等 |
| 视图模型 | `src/view-models/` | `use-*` hooks：持有状态，调用 `window.api`，把 lib 的逻辑接到 React 上 |
| 视图 | `src/components/` | 只管展示：数据由 props 传入，操作通过回调传出，不直接调用 `window.api` |

- 能写成纯函数的逻辑都放进 `lib/` 并补测试，组件里只留渲染。
- **只经 preload 访问主进程**：唯一的入口是 `window.api`（类型见 `src/shared/ipc-contract.ts`）。界面不访问网络、不加载远程内容，CSP 也不允许。
- **剪贴板**：页面的权限请求（包括剪贴板）一律被拒绝。要复制时经主进程，而且只能复制已有密钥的引用（`copySecretReference`，通道 `secrets:copy-reference`），不能往剪贴板里写任意内容。
- **不在渲染过程中改 ref**：保存「最新回调」一类的 ref，放在 `useEffect` 里更新。
- **出错提示**：调用失败统一经 `lib/notices.ts` 的 `reportError` 提示用户，错误写进日志，不静默吞掉。

## 扫码相关（最容易改坏）

扫码枪只往当前焦点里「打字」。焦点不对，扫到的内容就丢了，或者被当成快捷键执行。

- **焦点规则**：规则写在 `lib/scan-focus.ts` 和 `view-models/use-scan-focus.ts` 里，改动前先读它们的测试。
  - 「输入框」按排除法判断：会接收文字的都算（包括密码框、网址框）；下拉框不算输入框（字母在里面只会跳选），但焦点在下拉框里时也不拉回；
  - 点按钮或空白处后，0.3 秒回到扫码框；标了 `data-keep-focus` 的区域（「手机扫码」浮层）除外，键盘要能在里面操作；
  - 焦点不在输入框时按下可打印字符，立即切到扫码框，这个字符也不丢（浮层里也一样，扫码枪照常能用）；
  - 10 秒无操作回到扫码框；
  - 浮层这类组件关闭时调用 `returnFocusToScanBox()`，焦点立即回到扫码框；
  - 自动回焦不改动内容和选区。
- **输入法**：扫码枪是逐键「打字」的键盘，中文输入法在中文模式下会截走按键——字母进拼写窗口、数字选了候选词、回车只用来上屏，页面收不到回车，一次扫码永远结束不了。网页没有关输入法的标准办法，Chromium 只在密码框里关掉输入法，所以 Windows 上两个扫码接收框（工作台扫码框、配置中心的隐藏接收框）都是密码框（`lib/scan-field.ts`）。
  - 密码框的字只能显示成圆点（浏览器样式带 `!important`），扫码框因此分两层：`.scan-bar__text` 显示内容，并按输入框的真实选区画出光标和选中的部分（`selectionParts`），透明的 `.scan-bar__input` 盖在上面接收按键、点击和焦点。码里的换行、Tab 显示成 ⏎、⇥。
  - 密码框带来的两处限制，已处理或接受：读屏会把它念成「密码」、内容念成圆点，所以用 `aria-describedby` 指向看得见的那层文字；单行框粘贴会删掉换行，所以 `onPaste` 自己插入（`pasteInto`，换行换成 ⏎）。密码框不能复制，这一条接受：扫码框里的内容扫完即清空。
  - **两种模式**（Windows，`lib/scan-mode.ts`）：默认是扫码模式（密码框）。鼠标点进扫码框进入手动编辑模式：换成普通输入框，能用输入法打中文、有真实光标和选区，虚线边框加「手动输入 · 回车提交 · Esc 返回扫码」。回车提交、Esc、焦点离开、10 秒没有操作都回到扫码模式。扫码模式下只有鼠标点击会切换，扫码枪的按键和自动回焦不会打开输入法。
  - **输入法开着时扫码**（macOS 的扫码框、Windows 的手动编辑模式）：按物理按键拼回扫码枪发出的内容（`lib/scanner-keys.ts`、`view-models/use-ime-scan-rescue.ts`）。输入法截住按键时 keydown 的 key 是 Process，但 code、Shift、Alt 照样准确；字母数字按美式键盘换算，扫码枪输出的中文是 Alt+小键盘的 GBK 码，按 GBK 换回汉字。只在「快得像扫码枪 + 输入法插了手 + 以回车或 Tab 结尾」时接管，丢掉输入法组出来的字，提交拼出来的内容并回到扫码模式；拼不出来的不提交，扫码条下方提醒。
  - macOS 还是普通输入框（密码框会打开系统的「安全输入」，对扫码枪输出中文的影响未验证），靠上面这一条应对输入法。
  - 不要把扫码框改回 textarea，也不要去掉「密码框」：Windows 上中文模式下扫码会立刻坏掉（已用微软拼音实测）。
- **多行扫码**：二维码里的换行会以回车发出，`lib/scan-assembler.ts` 按回车后的停顿区分「码里的换行」和「扫完了」。停顿时长是设置项 `scanLineGapMs`，默认 80 毫秒。
- **不能打印的界面**：配置中心和批量打印页里扫码永远不打印（F2 也不行）；「打印机」页的「测试页」是操作员明确点的按钮，照常打印。模板页设计器的「打印一张试试」同样是明确点的按钮，照常打印（不写打印记录）。诊断面板的「走一张纸」「打测试页」也是操作员明确点的按钮。
- **一件事只在一处说**：界面精简的取舍见 `docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 最后一节。加元素前先看有没有已经表达同一件事的地方。

## 手机扫码

- **状态来自主进程**：`view-models/use-mobile-station.ts` 在 App 里创建，跟随 `mobile:status-changed` 推送；标题栏按钮、浮层、配置页都从它取数据。文字都在 `lib/mobile-text.ts`（有测试）。
- **浮层非模态**：不用 `dialog.showModal`，扫码框和 F2 照常可用；只在工作台上显示，配置中心打开时隐藏。Esc 关闭。
- **二维码在本机生成**：用 `view-models/use-qr-image.ts`，不请求任何在线服务。
- **手机的打印结果不播报**：拿手机的人看手机；这边只刷新打印记录。

## 自由设计的设计器

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3.3 节。

- **分层**：纯逻辑在 `lib/`：`canvas-edit.ts`（移动、缩放和等比缩放、旋转、增删和新元素错开、对齐、等距、叠放和上下移一层、图层拖动排序、复制粘贴和复制一份）、`canvas-hit.ts`（点中测试、框选、Alt+点击轮流选）、`canvas-snap.ts`（吸附、和邻居的间距）、`canvas-gesture.ts`（手势的框、旋转手柄、拖动阈值、指针旁的标签）、`canvas-history.ts`、`canvas-table.ts`（含双击落在哪一格）、`canvas-view.ts`（缩放档位和以指针为中心的滚动、按键 → 命令、设计器里隐藏元素的样式）、`canvas-names.ts`（图层名的内容摘要）、`canvas-fix.ts`（「放大到能印」）、`canvas-inline.ts`（就地改字）、`canvas-menu.ts`（右键菜单的项）、`canvas-float.ts`（浮动工具条放哪）、`designer-shortcuts.ts`（快捷键的写法和快捷键表）、`insert-field-options.ts`、`gray-image.ts`；状态在 `view-models/use-canvas-designer.ts`（选中、撤销历史、剪贴板、缩放、开关、只在设计器里隐藏的元素）、`use-canvas-gesture.ts`（拖动、缩放、旋转、框选、平移、Ctrl+滚轮）、`use-image-import.ts`；组件在 `components/canvas-editor/`。
- **布局**（参考平板上的绘图、排版软件，画布优先）：上面一条窄栏（预览内容、网格、吸附、「?」）；左边竖排元素图标；中间画布，左上角撤销重做、右下角缩放胶囊；选中时选框上方一条浮动工具条（拖动时藏起来，画布有焦点时 Tab 能到）；右边检查器分段标签（元素「文字 / 排列 / 图层」，没选中「模板 / 图层」，多选「排列 / 图层」；在「图层」页点选时留在这一页）；下面打印前检查收成一条，点开是清单，点一项选中那个元素。
- **画布就是预览**：标签是模板页预览的同一份 HTML（`previewTemplate`），透明覆盖层只画框；拖动时只动覆盖层，松手才改草稿。不要在覆盖层上自己画元素内容。每个元素一圈浅色虚线；这一张不印的元素浅红底、框里写短原因（`RenderWarnings.elements`），条码宽度离最小不到 10% 时黄框。「隐藏」只在设计器里：往预览 HTML 里加一段按 `data-element-id` 藏起来的样式，不进模板。
- **点中测试**：按位置算（`lib/canvas-hit.ts`），不按覆盖层的 DOM 顺序；只有边框的矩形、线只在描边 ±4 屏幕像素内点中，框里面落到下面的元素上；锁定的点不中、框不中，只能在图层里选；Ctrl / ⌘ + 拖动一定框选。
- **输入设备**：支持鼠标、键盘、触控板和数位板（Wacom 一类）；不支持触摸屏，不写触摸专用的代码。数位板的笔是 `pointerType: 'pen'`，和鼠标同一条路，不按 pointerType 过滤；按下后挪不到 3px 不算拖动，笔尖落下的抖动不会挪动元素；笔杆按键走 `contextmenu`。中键或空格 + 拖动平移；Ctrl+滚轮、触控板捏合以指针为中心缩放。
- **扫码**：画布是可聚焦的 `div`，不是输入框；只处理方向键、Delete / Backspace、Esc、F1、菜单键 / Shift+F10、空格（平移）和 Ctrl / ⌘ 组合键（`designerCommand`，有测试）。不要拦字母、数字做快捷键，也不要给画布加 `data-keep-focus`（那只对工作台有意义）：配置中心要把扫码枪的字符送进「预览内容」。就地改字、图层改名是普通输入框，扫码枪的字会进去（正在打字，本来就该这样）。
- **右键菜单**是页面里的（`ContextMenu.tsx`，挂在 body 上），画布 `preventDefault` 掉浏览器的右键，主进程的系统菜单不会在画布上弹出。
- **改模板只经 `commit`**：先记撤销历史再交给草稿；同一个字段的连续输入用同一个合并键；就地改字改完才提交一次（一步撤销）；按住方向键合成一步。
- **剪贴板**在设计器的内存里；**图片**在页面里解码，模板只存灰度像素。
- **退出时没保存的模板**：`use-templates` 经 `templates:unsaved-changed` 告诉主进程；主进程问「保存并退出」时经 `templates:save-for-quit` 请界面按平常的流程保存，界面用 `templates:saved-for-quit` 回答。
- **模板库**：模板页的第三个视图（列表 / 编辑 / 模板库），算作模板页的「编辑器」（Esc、面包屑回到列表）。筛选和缩略图比例在 `lib/template-library.ts`，读取在 `view-models/use-template-library.ts`，组件 `components/TemplateLibrary.tsx`；缩略图是 `sandbox=""` 的 iframe，不要换成能跑脚本的方式。「用这个模板」之后预览内容绑着模板库示例（`use-sample-content.ts` 的 `library`，只对复制出的那个模板生效，`librarySampleIdFor`），改预览内容就解除。

## 播报与提示音

- **播报语**：定义在 `src/shared/voice.ts`，每句都有文字和级别（故障 > 提醒 > 确认），用词与状态栏一致。新增一句要同时加文字、级别和测试。
- **调度**：由 `lib/voice-scheduler.ts` 负责：同级或更高级别的播报打断当前这句；级别更低的等当前这句播完，并且只保留最新一条。
- **提示音兜底**：语音不可用时，按播报级别退回提示音。

## 两个平台

- **窗口按钮**：Windows 上最小化、最大化、关闭按钮由界面自绘；macOS 上用系统红绿灯，标题栏左侧留出 `--traffic-light-inset`。主进程通过 `window-chrome` 告诉界面是哪一种。
- **快捷键提示**：按平台显示，例如配置中心的快捷键在 Windows 上显示「Ctrl+,」，在 macOS 上显示「⌘,」。
- **截图核对**：改了标题栏、字体或布局，两个平台都截图核对。

## 样式

- **只用变量**：颜色、间距、字体都用 `styles/tokens.css` 里的变量，不在组件样式里写死色值。
- **字体**：用系统正体中文字体（Windows 是 Microsoft YaHei UI，macOS 是 PingFang SC），标题靠字重区分层级，不用倾斜字体。
- **预览**：标签预览用软尺框住，按模板的纸张（CSS 变量 `--paper-w`、`--paper-h`，毫米数）等比缩放，和实际打印共用同一份 HTML。

## 测试与验收

- **单元测试**：写在 `lib/*.test.ts`，只测行为，不测实现细节。
- **E2E**：在 `e2e/*.e2e.ts`（工作台和配置中心在 `app.e2e.ts`，自由设计的设计器在 `designer.e2e.ts`，手机扫码在 `mobile.e2e.ts`，批量打印在 `batch.e2e.ts`，标签机指令在 `printer-commands.e2e.ts`，打印机诊断在 `diagnosis.e2e.ts`，驱动安装在 `drivers.e2e.ts`）。
  - 用 `e2e/support/fixtures.ts` 的 `test`（`electronApp` 夹具：用例结束时关掉程序、删掉数据目录），共用的操作在 `e2e/support/app-helpers.ts`，本机中转服务和测试手机在 `e2e/support/relay-server.ts`。
  - 用角色和标签定位元素（`getByRole`、`getByLabel`），不依赖类名以外的实现细节。
- **视觉验收**：界面改完后截图核对对齐、裁切、焦点框和键盘操作。Windows 看 100% 和 150% 缩放，macOS 看红绿灯区域和全屏状态。验收项见配置中心设计文档第 8 节。
