# 货架号识别实施计划

设计：`docs/superpowers/specs/2026-09-30-shelf-number-design.md`。每个阶段单独提交，都要通过 `bun run check`；改了主进程、界面的再跑 E2E；改了扫码页、协议的再跑 `test:relay-browser`。

## 阶段 1：业务层的步骤和失败原因
**目标**：`imageText` 步骤（模型、校验、执行）、`PrintRequest.image / manualFields`、`EnrichDeps.readImageText`、失败原因 `TEXT_NOT_FOUND`（类型、迁移 5、界面文字、语音、本机接口映射）。
**成功标准**：步骤在有图、没图、手动值、识别不到、OCR 不可用时的行为和设计一致；迁移 5 不丢旧记录。
**测试**：`image-text.test.ts`、`enrich.test.ts`、`sanitize-steps.test.ts`、`print-service.test.ts`、迁移测试。
**状态**：完成

## 阶段 2：协议和电脑端的手机扫码
**目标**：`welcome.image`、`submit.image / fields`、`result.field`，大小上限；`src/main/mobile/` 把图和手动字段交给打印，按启用的步骤决定要不要图。
**成功标准**：老消息照常解析；新字段校验严格；电脑只在需要时要图。
**测试**：`mobile-protocol.test.ts`、`mobile-session` / `mobile-host` / `mobile-station` 的测试。
**状态**：完成

## 阶段 3：手机扫码页
**目标**：worker 送回角点；按角点截图、压 JPEG；结果卡片的「没认出」和手动输入。
**成功标准**：纯逻辑有测试；`test:relay-browser` 通过（假摄像头画面带货架号）。
**状态**：完成

## 阶段 4：主进程的 OCR 和配置界面
**目标**：`src/main/ocr/`（加载扩展和模型、nativeImage 解码、引擎复用、假 OCR）；配置中心的步骤表单、摘要、字段名提示、OCR 不可用的提示；E2E。
**成功标准**：E2E 走通「手机带图 → 货架号打进标签」「识别不到 → 手动补 → 打印」；主进程里用真实 OCR 识别样张。
**状态**：完成

## 阶段 5：打包、部署和文档
**目标**：安装包带 OCR（扩展、VC++ 运行库、模型）；CI；部署中转服务；README、CLAUDE.md、验收记录、路线图。
**成功标准**：`dist:win` 打出的安装版里能识别；中转服务部署后手机页面带新功能。
**状态**：完成
