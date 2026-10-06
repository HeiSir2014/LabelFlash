# 文档

| 文档 | 内容 |
|---|---|
| [设计：总设计](superpowers/specs/2026-09-28-label-flash-design.md) | 整体设计：打印、模板、防重门限、存储、架构、安全、界面、构建与发布、测试 |
| [设计：通用识别规则](superpowers/specs/2026-09-28-generic-scan-rules-design.md) | 1.0.1 起的识别规则、加工步骤、通用模板、多行扫码、打印结果通知 |
| [设计：工作台与配置中心](superpowers/specs/2026-09-29-config-center-layout-design.md) | 界面信息架构：工作台只留扫码、预览、打印机、打印记录，其余配置进全窗口的配置中心 |
| [设计：手机扫码打印](superpowers/specs/2026-09-29-mobile-scan-relay-design.md) | 1.0.1：电脑按需连云端中转服务，几部手机网页实时扫码、扫到就在电脑上排队打印；会话、端到端加密、幂等任务、协议、部署 |
| [设计：多台打印机与多种纸张](superpowers/specs/2026-09-29-multi-printer-paper-design.md) | 1.1.0：模板带纸张，按纸张分配打印机，模板可以单独指定 |
| [设计：本机接口](superpowers/specs/2026-09-30-local-api-design.md) | 1.1.0：HTTP 接口、授权、任务、防火墙 |
| [设计：本地文字识别引擎](superpowers/specs/2026-09-30-ocr-engine-design.md) | 1.1.0：Rust + ONNX Runtime 的 Node-API 扩展 |
| [设计：货架号识别](superpowers/specs/2026-09-30-shelf-number-design.md) | 1.1.0：手机截图、电脑读出货架号 |
| [设计：快递面单模板](superpowers/specs/2026-10-01-waybill-templates-design.md) | 1.3.0：格子版式的面单、按字段换模板 |
| [设计：功能补齐](superpowers/specs/2026-10-01-feature-parity-design.md) | 2.0.0：自由设计、模板库、批量打印、打印 PDF、标签机指令、诊断、驱动、局域网共享 |
| [计划：Phase 1 桌面端](superpowers/plans/2026-09-28-label-flash-phase1-desktop.md) | Phase 1 的实施计划（Task 1–14，含 13A–13J） |
| [计划：通用识别规则](superpowers/plans/2026-09-28-generic-scan-rules.md) | 通用识别规则的实施计划 |
| [计划：配置中心](superpowers/plans/2026-09-29-config-center.md) | 工作台与配置中心的实施计划 |
| [计划：手机扫码打印](superpowers/plans/2026-09-29-mobile-scan-relay.md) | 中转服务、扫码页、电脑端模块、部署；接入电脑界面基于配置中心的分支做 |
| [计划：多台打印机与多种纸张](superpowers/plans/2026-09-29-multi-printer-paper.md) | 多台打印机的实施计划 |
| [计划：本机接口](superpowers/plans/2026-09-30-local-api.md) | 本机接口的实施计划 |
| [计划：文字识别引擎](superpowers/plans/2026-09-30-ocr-engine.md)、[货架号](superpowers/plans/2026-09-30-shelf-number.md) | 本地 OCR 和货架号识别的实施计划 |
| 计划：自由设计 [1a 模型与渲染](superpowers/plans/2026-10-01-canvas-designer-1a-model-render.md)、[1b 编辑器](superpowers/plans/2026-10-02-canvas-designer-1b-editor.md)、[易用性](superpowers/plans/2026-10-06-designer-usability.md) | 设计器的实施计划 |
| 计划：[模板库](superpowers/plans/2026-10-02-template-library.md)、[批量打印](superpowers/plans/2026-10-02-batch-printing.md)、[打印 PDF](superpowers/plans/2026-10-02-pdf-printing.md) | 2.0.0 子项目 2–4 的实施计划 |
| 计划：[标签机指令](superpowers/plans/2026-10-02-printer-commands.md)、[打印机诊断](superpowers/plans/2026-10-02-printer-diagnosis.md)、[驱动安装](superpowers/plans/2026-10-02-driver-install.md) | 2.0.0 子项目 5a–5c 的实施计划 |
| [计划：局域网共享](superpowers/plans/2026-10-02-ipp-sharing.md) | 2.0.0 子项目 6 的实施计划 |
| [本机接口接入说明](local-api.md) | 给第三方：接口、授权、错误、示例、打印结果通知 |
| [局域网共享](lan-sharing.md) | 用法和真机验证清单 |
| [驱动清单](driver-catalog.md) | 给出品方：驱动清单的密钥、签名、发布 |
| [路线图](roadmap.md) | 功能评级与状态，包括 macOS 适配（打包、状态检测、标签机验证）的进度 |
| [Windows 验收记录](windows-acceptance.md) | 在 Windows 上的自动化检查和真机验收结果 |

## 维护

- **设计变更**：设计文档随代码一起更新。改了行为，就在同一个 PR 里改对应章节。
- **验收结果**：在 Windows 上实测的结果写进验收记录。每一项注明是「通过」「部分」还是「待验收」，并写清还缺什么（硬件、接口或人工确认）。
- **命名限制**：文档里不出现任何参考产品或竞品的名称，统一写「参考产品」；打印机只写「热敏标签机」。
