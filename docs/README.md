# 文档

| 文档 | 内容 |
|---|---|
| [设计：总设计](superpowers/specs/2026-09-28-label-flash-design.md) | 整体设计：打印、模板、防重门限、存储、架构、安全、界面、构建与发布、测试 |
| [设计：通用识别规则](superpowers/specs/2026-09-28-generic-scan-rules-design.md) | 1.0.1 起的识别规则、加工步骤、通用模板、多行扫码、打印结果通知 |
| [设计：工作台与配置中心](superpowers/specs/2026-09-29-config-center-layout-design.md) | 界面信息架构：工作台只留扫码、预览、打印机、打印记录，其余配置进全窗口的配置中心 |
| [设计：手机扫码打印](superpowers/specs/2026-09-29-mobile-scan-relay-design.md) | 1.1.0：电脑按需连云端中转服务，手机网页扫码、确认后在电脑上打印；会话、端到端加密、协议、部署 |
| [计划：Phase 1 桌面端](superpowers/plans/2026-09-28-label-flash-phase1-desktop.md) | Phase 1 的实施计划（Task 1–14，含 13A–13J） |
| [计划：通用识别规则](superpowers/plans/2026-09-28-generic-scan-rules.md) | 通用识别规则的实施计划 |
| [计划：手机扫码打印](superpowers/plans/2026-09-29-mobile-scan-relay.md) | 中转服务、扫码页、电脑端模块、部署；接入电脑界面等配置中心重构合回后做 |
| [路线图](roadmap.md) | 功能评级与状态，包括 macOS 适配（打包、状态检测、标签机验证）的进度 |
| [Windows 验收记录](windows-acceptance.md) | 在 Windows 上的自动化检查和真机验收结果 |

## 维护

- **设计变更**：设计文档随代码一起更新。改了行为，就在同一个 PR 里改对应章节。
- **验收结果**：在 Windows 上实测的结果写进验收记录。每一项注明是「通过」「部分」还是「待验收」，并写清还缺什么（硬件、接口或人工确认）。
- **命名限制**：文档里不出现任何参考产品或竞品的名称，统一写「参考产品」；打印机只写「热敏标签机」。
