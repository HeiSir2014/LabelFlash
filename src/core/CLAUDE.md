# src/core — 业务层

纯 TypeScript，所有业务规则都在这里，直接用 `bun test` 测试。

## 规则

- **只写纯业务**：不 import `electron`、`node:*`、SQLite 或任何 DOM API。
- **外部能力走接口**：需要外部能力时在这里定义接口，由 `src/main` 实现：
  - 打印：`PrinterAdapter`；
  - 存储：`JobStore`、`TemplateRepository`、`RuleRepository` 等；
  - 时间：`Clock`；
  - 正则执行：`RegexRunner`。
- **时间只从注入的 `Clock` 取**：不直接调用 `Date.now()`（只有 `types.ts` 里的 `systemClock` 例外），测试里用 `testing/fake-clock.ts` 控制时间。
- **外部输入都不可信**：设置、模板、规则、加工步骤、导入的规则文件，都要先经过对应的 `sanitize-*`，得到合法对象再用。非法字段回到默认值，不抛给用户。
- **测试替身**：用 `testing/` 里现成的假实现（`fake-printer-adapter`、`in-memory-job-store`、`in-memory-repositories`），不在测试里临时拼 mock。

## 模块

| 模块 | 作用 |
|---|---|
| `print-service.ts` | 打印的完整流程：识别 → 门限 → 加工 → 选模板（规则的「按字段换模板」在 `scan/rule-settings.ts`，所以模板在加工之后才定）→ 决定打印机（没有时放开门限）→ 排队打印 → 记录。界面和主进程都只调它；本机接口和按字段重打走 `printFields`：不识别、不加工、不用扫码的防重复窗口，其余（决定打印机、排队、记录）一样 |
| `printing/resolve-printer.ts` | 决定打印机：模板指定的（本机有）→ 纸张分配的 → 没有；没有时不打印、不写记录 |
| `dedup-guard.ts` | 防重门限。「检查并占位」是同步的：成功和超时记为已打印（超时说明结果不确定），确定没出纸的失败释放占位；`force` 能跳过已打印，但不能跳过正在打印的同一个码 |
| `print-queue.ts`、`serial-queue.ts` | 每台打印机一个串行队列（同一台先扫先打，不同打印机并行），单张超时后通过 `AbortSignal` 通知适配器放弃 |
| `errors.ts` | `PrintError`：失败原因和给用户看的补充说明（打印机问题分类） |
| `scan/` | 识别规则（`RULE_KINDS`：delimited / keyValue / whole / regex）、加工步骤（`STEP_KINDS`：template / regexReplace / lookup / http / imageText）；图中文字的查找规则在 `image-text.ts`、内置规则、每台电脑的规则设置、规则文件导入导出 |
| `templates/` | 模板模型（`kind`：`label` 标签 / `waybill` 面单）、内置模板、标签内容组装、按宽度缩小字号、备注变量；面单的格子版式在 `waybill-model.ts`（分割树）、`waybill-layout.ts`（切格子、取整到打印点、折行和缩小字号，字宽表按实测取上限）、`sanitize-waybill.ts`、`builtin-waybills.ts`（五套内置面单和示例数据）；字宽表在 `text-fit.ts`（逐字符实测，标签和面单共用） |
| `lookup/` | CSV 解析（含 GBK 编码的中文 Excel）和查找索引 |
| `notify/` | 打印结果通知的事件、投递状态和重试时间表 |
| `api/` | 本机接口的任务：`PrintJobService`（整批核对、`requestId` 防重复、排队上限、按提交顺序逐个打印、重启后把没打完的标成 `INTERRUPTED`）、模板名换算、模板用到的字段。存储接口 `ApiJobStore` 的内存版和 SQLite 版共用 `testing/api-job-store-contract.ts` 这套测试 |

## 扩展时

- **新的识别规则类型**，按顺序改这几处，每一步都先写测试：
  1. `scan/rule-model.ts`（类型）
  2. `scan/sanitize-rule.ts`（校验）
  3. `scan/recognize.ts`（识别）
  4. `scan/rule-file.ts`（导入导出）
  5. 界面表单
- **新的加工步骤**：同样的顺序，改 `enrich-model.ts` → `sanitize-steps.ts` → `enrich.ts`。
- **访问外部资源的步骤**（例如 HTTP 查询）：只在这里定义接口和结果语义，真正的请求在 `src/main` 实现。
- **打印失败的新原因**：`types.ts` 的 `PRINT_FAILURE_REASONS` 同时是数据库里 CHECK 约束的取值，要一起改 `src/main/storage/migrations.ts`（迁移规则见根目录 CLAUDE.md）。
