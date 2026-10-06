# 自由设计设计器的易用性（实施计划）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 3.3 节（本计划完成后同步更新）。
起因：一次实际操作的走查发现，画满纸的边框矩形会吞掉画布上所有的点击和框选；条码不印时画布上看不出是哪一个、要多宽；
图层全叫「文字 / 文字 2」；没有右键菜单、就地改字、全选、图层锁定和隐藏；退出时没保存的模板直接丢掉。

原则：画布仍是「真实打印 HTML + 透明覆盖层」，所有修改只经 `commit`（带合并键）；纯逻辑先写 `bun test`，组件只做展示；
不拦字母和数字（扫码）；样式只用 `tokens.css` 的变量；不加依赖。每个任务一个提交，每个提交 `bun run check` 通过。

不做：任意角度旋转、曲线和自由绘制、嵌套组合、颜色和灰度、层级数字框、样式库、母版、设计器里的数据表、字母快捷键、
跨程序剪贴板、用户拖出的参考线、Ctrl+G 组合。

## 任务（按顺序）

| # | 任务 | 文件 | 测试 |
|---|---|---|---|
| 1 | **点中测试**：`hitTest(elements, point, zoom)`：从上往下找；没填黑的矩形、线只在描边 ±4 屏幕像素内算点中；锁定的永远点不中（只能在图层里选）；`hitStack` 给 Alt+点击轮流选。手势改用它：按在锁定或空白处开始框选，Ctrl+拖动一定框选 | `lib/canvas-hit.ts`、`view-models/use-canvas-gesture.ts`、`CanvasStage.tsx` | `canvas-hit.test.ts` |
| 2 | **键盘命令**：Ctrl/⌘+A 全选（没锁定的）、Ctrl/⌘+D 复制一份、Ctrl/⌘+] / [ 上移下移一层、加 Shift 置顶置底、Ctrl/⌘+0 适合窗口、Ctrl/⌘+1 100%、F1 快捷键表；方向键步长不变（0.1mm / Shift 1mm） | `lib/canvas-view.ts`、`lib/canvas-edit.ts`（`bringForward`、`sendBackward`、`duplicateElements`）、`use-canvas-designer.ts` | `canvas-view.test.ts`、`canvas-edit.test.ts` |
| 3 | **图层名**：没改过名字的元素显示内容摘要（≤12 字）：「品名：{编码}」「¥199.00」「条码 {编码}」「二维码 {编码}」「图片」「矩形」「线」「表格 3×2」 | `lib/canvas-names.ts`、`LayerList.tsx` | `canvas-names.test.ts` |
| 4 | **新元素错开**：落点和上一个新加的元素完全重合时往右下错开 2mm（同粘贴），收在纸内；新条码默认 `{编码}` | `lib/canvas-edit.ts`、`core/templates/canvas-model.ts` | `canvas-edit.test.ts`、`canvas-model.test.ts` |
| 5 | **每个元素的问题**：`RenderWarnings.elements`（元素 id、级别、画布上的短原因、条码最小宽）；条码最小宽按渲染同一套点取整（模板的 dpi）；宽度离最小不到 10% 时提前提醒（黄）；「不印」的文字写出要多宽 | `shared/render-warnings.ts`、`core/templates/canvas-layout.ts`、`main/printing/barcode.ts`、`canvas-html.ts` | `render-warnings.test.ts`、`canvas-layout.test.ts`、`canvas-html.test.ts` |
| 6 | **看得见**：每个元素一圈 1px 浅色虚线（只在覆盖层，不打印）；不印的元素浅红底 + 框内短原因；属性栏「放大到能印」 | `CanvasStage.tsx`、`ElementProperties.tsx`、`lib/canvas-fix.ts` | `canvas-fix.test.ts` |
| 7 | **图层面板**：每行锁定、隐藏（只在设计器里隐藏，照常打印）按钮；双击改名；拖动排序；每次修改都经 commit | `LayerList.tsx`、`lib/canvas-edit.ts`（`moveLayer`）、`use-canvas-designer.ts` | `canvas-edit.test.ts` |
| 8 | **就地改字**：双击文字（表格双击某一格）盖一个同字体、字号、对齐的 textarea；Enter 换行，Ctrl/⌘+Enter 或点外面提交，Esc 取消；整段编辑一步撤销 | `components/canvas-editor/InlineTextEditor.tsx`、`lib/canvas-inline.ts`、`lib/canvas-table.ts`（`tableCellAt`） | `canvas-inline.test.ts`、`canvas-table.test.ts` |
| 9 | **右键菜单**：页面内菜单（键盘上下、Enter、Esc），复制、粘贴、复制一份、删除、四个叠放、锁定 / 解锁，选 2 个以上时有「对齐」子菜单；画布上不弹系统的输入框菜单 | `components/canvas-editor/ContextMenu.tsx`、`lib/canvas-menu.ts` | `canvas-menu.test.ts` |
| 10 | **缩放**：Ctrl+滚轮以指针为中心缩放；按钮改名「适合窗口」「100%」 | `lib/canvas-view.ts`（`scrollForZoom`）、`use-canvas-gesture.ts`、`DesignerToolbar.tsx` | `canvas-view.test.ts` |
| 11 | **标尺**：指针位置细线，选中元素的范围在标尺上标出 | `CanvasStage.tsx`、`app.css` | — |
| 12 | **吸附距离**：拖动吸到邻居时在参考线旁写出间距（mm），间距相等时标等距 | `lib/canvas-snap.ts`（`snapGaps`）、`CanvasStage.tsx` | `canvas-snap.test.ts` |
| 13 | **工具条**：对齐、等距、叠放换成内联 SVG 图标按钮，提示里写快捷键（按平台 Ctrl / ⌘）；单选时对齐提示写「对齐到安全区」；1366 宽一行放下，「预览内容」挪到画布上方 | `DesignerToolbar.tsx`、`components/canvas-editor/icons.tsx`、`lib/designer-shortcuts.ts` | `designer-shortcuts.test.ts` |
| 14 | **窄窗口**：右栏变成「属性 | 图层」两个标签页；「打印前检查」收成底部一条「⚠ N 项」，点开展开，点某一项选中它的元素 | `CanvasDesigner.tsx`、`DesignerChecks.tsx`、`app.css` | — |
| 15 | **退出时没保存的模板**：界面经校验过的 IPC 报告「有没保存的模板」；托盘退出、系统退出时问「保存并退出 / 不保存退出 / 取消」（保存经界面现有的保存流程往返一次，超时或失败就不退出并说明）；系统关机不问 | `shared/ipc-contract.ts`、`main/template-quit.ts`、`main/ipc.ts`、`main/ipc-validators.ts`、`main/index.ts`、`preload/index.ts`、`view-models/use-templates.ts`、`App.tsx` | `template-quit.test.ts`、`ipc-validators.test.ts` |
| 16 | **快捷键表**：「?」按钮和 F1 打开快捷键小表（平台正确的 Ctrl / ⌘），写出方向键步长 | `components/canvas-editor/ShortcutSheet.tsx`、`lib/designer-shortcuts.ts` | `designer-shortcuts.test.ts` |
| 17 | **插入字段**：选项写「编码 — CL5640-TK」（这段预览内容识别出的值），没有的写「（这段内容里没有）」 | `lib/insert-field-options.ts`、`InsertField.tsx` | `insert-field-options.test.ts` |
| 18 | **纸张下拉**：「60×40 标签 · 样衣标签」，不套括号 | `lib/paper-text.ts`、`TemplateBasics.tsx` | `paper-text.test.ts` |
| 19 | **空画布引导**：「从左边点一个元素加进来，或 从模板库新建」 | `CanvasStage.tsx`、`TemplatesPage.tsx` | — |
| 20 | **等比缩放**：缩放时按住 Shift 保持比例；图片和二维码默认保持（Shift 放开） | `lib/canvas-edit.ts`（`resizeBox` 的 `keepRatio`）、`use-canvas-gesture.ts` | `canvas-edit.test.ts` |
| 21 | **多选外框**：选中多个时画一个合起来的外框，可以整体拖动（不做整体缩放） | `CanvasStage.tsx`、`use-canvas-gesture.ts` | — |
| 22 | **E2E**：边框矩形点穿、Ctrl+A、就地改字和撤销、右键菜单、图层锁定 / 隐藏 / 改名 / 排序、「放大到能印」、退出时没保存的模板（换掉确认框） | `e2e/designer.e2e.ts`、`e2e/app.e2e.ts` | — |
| 23 | **视觉验收**：新界面的验收项（1280、1024、1366 @150%） | `e2e/visual/acceptance.visual.ts` | — |
| 24 | **文档**：`src/renderer/CLAUDE.md` 设计器一节、设计文档第 3.3 节 | — | — |

## 验收

- 每个提交 `bun run check`；最后跑完整的 `bun run test:e2e` 和视觉验收，逐张看截图。
- 用走查脚本重跑一遍原来的场景，对比前后截图。
- 只在 Windows 上验证：macOS 的 ⌘ 快捷键、真机打印待验证。
