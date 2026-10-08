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
| `print-service.ts` | 打印的完整流程：识别 → 门限 → 加工 → 选模板（规则的「按字段换模板」在 `scan/rule-settings.ts`，所以模板在加工之后才定）→ 决定打印机（没有时放开门限）→ 排队打印 → 记录。界面和主进程都只调它；本机接口、批量打印、打印 PDF、局域网共享和按字段重打走 `printFields`：不识别、不加工、不用扫码的防重复窗口，其余（决定打印机、排队、记录）一样。每条有模板的记录都记下模板指纹（`api/template-fields.ts` 的 `templateFingerprint`），按记录原样重打前用 `storedTemplateIssue` 核对模板没改过 |
| `job-reprint.ts` | 打印记录的「预览」「重打」怎么做：本机接口、批量、PDF、局域网共享的按存下的模板和字段（`reprintsStoredLabel`，界面和主进程共用）；扫码打的按现在的规则重新识别，记录里的字段当手动字段带上（`recordedFieldValues`），图中文字识别用当时读到的值（手机拍的图不存） |
| `printing/resolve-printer.ts` | 决定打印机：模板指定的（本机有）→ 纸张分配的 → 没有；没有时不打印、不写记录 |
| `printer-commands/` | 标签机指令：`command-model.ts`（指令集、每种的范围）、`command-set.ts`（按驱动名认，写着两种的不猜，按型号认交给 `drivers/driver-hints.ts` 的 `DriverHints`）、`sanitize-command-config.ts`（存储宽松、IPC 严格）、`tspl.ts` / `zpl.ts` / `epl.ts`（每种一个生成器，输出 ASCII，对照手册的写法测试）、`printer-commands.ts`（分派、范围把关）。每一项为 null 表示不改，不发 |
| `drivers/` | 驱动安装的纯逻辑：`usb-id.ts`、`catalog-model.ts` + `sanitize-catalog.ts`（在线清单的模型和严格校验，不合格的型号跳过）、`catalog-freshness.ts`（过期、防回滚）、`install-plan.ts`（按平台：安装 / 打开下载页 / 没有安装包 / 不在清单）、`driver-hints.ts`（和 5a、5b 约定的按驱动名查清单的接口）+ `catalog-hints.ts`、`detected-device.ts`、`driver-install-flow.ts`（下载 → 核对 → 提权安装 → 找新打印机，端口注入，假实现在 `testing/fake-driver-ports.ts`） |
| `dedup-guard.ts` | 防重门限。「检查并占位」是同步的：成功和超时记为已打印（超时说明结果不确定），确定没出纸的失败释放占位；`force` 能跳过已打印，但不能跳过正在打印的同一个码 |
| `print-queue.ts`、`serial-queue.ts` | 每台打印机一个串行队列（同一台先扫先打，不同打印机并行），单张超时后通过 `AbortSignal` 通知适配器放弃 |
| `errors.ts` | `PrintError`：失败原因和给用户看的补充说明（打印机问题分类） |
| `scan/` | 识别规则（`RULE_KINDS`：delimited / keyValue / whole / regex）、加工步骤（`STEP_KINDS`：template / regexReplace / lookup / http / imageText）；图中文字的查找规则在 `image-text.ts`、内置规则、每台电脑的规则设置、规则文件导入导出 |
| `templates/` | 模板模型（`kind`：`label` 标签 / `waybill` 面单 / `canvas` 自由设计）、内置模板、标签内容组装、按宽度缩小字号、备注变量；面单的格子版式在 `waybill-model.ts`（分割树）、`waybill-layout.ts`（切格子、取整到打印点、折行和缩小字号，字宽表按实测取上限）、`sanitize-waybill.ts`、`builtin-waybills.ts`（五套内置面单和示例数据）；字宽表在 `text-fit.ts`（逐字符实测，标签和面单共用）；自由设计模板：`canvas-model.ts`（元素、限制、码制清单）、`sanitize-canvas.ts`、`canvas-layout.ts`（取整到打印点、排文字、表格、打印前检查）、`mono-image.ts`（灰度 → 黑白点，纯 TS，不解码图片文件）、`builtin-canvas.ts`；模板库在 `templates/library/`：`library-model.ts`（分类、`library:` 编号、示例数据、统一字段表 `LIBRARY_FIELD_NAMES`）、`library-elements.ts`（写模板的小工具）、每类一个文件、`template-library.ts`（`TEMPLATE_LIBRARY`、`findLibraryEntry`）。模板库的模板不进 `TemplateCatalog.list()`，经 `createFromLibrary` 复制后使用；加模板时 `template-library.test.ts` 逐个核对校验器不变、示例数据、字段名、两种分辨率下排版 |
| `lookup/` | CSV 解析（含 GBK 编码的中文 Excel；上限和分隔符可传入，Excel 读出的行也走 `tableFromRecords`）和查找索引 |
| `batch/` | 批量打印的纯逻辑：`batch-model.ts`（类型、`BATCH_LIMITS`、序号字段名、批次号）、`column-mapping.ts`（按列名自动对列）、`serial.ts`、`batch-labels.ts`（行 → 标签：字段、份数、问题行；单行预览）、`parse-batch-plan.ts`（界面交来的设置严格校验）、`batch-runner.ts`（`BatchRun`：按顺序逐张经 `printFields` 打，暂停 / 继续 / 取消，打印机不能用时自动暂停、那一张继续时重打） |
| `notify/` | 打印结果通知的事件、投递状态和重试时间表；每个接口选来源（`WEBHOOK_SOURCES`，默认不含批量、PDF），等待队列的上限在 `WEBHOOK_LIMITS` |
| `api/` | 本机接口的任务：`PrintJobService`（整批核对、`requestId` 防重复、排队上限、按提交顺序逐个打印、重启后把没打完的标成 `INTERRUPTED`）、模板名换算、模板用到的字段。存储接口 `ApiJobStore` 的内存版和 SQLite 版共用 `testing/api-job-store-contract.ts` 这套测试 |
| `pdf/` | PDF 打印的纯逻辑：限制和类型（`pdf-model.ts`）、黑白位图的缓存格式（`mono-pack.ts`）、内容外框（`content-box.ts`）、一页多张的切分和裁切方式识别（`page-split.ts`，先按缝切，整页没有缝才认等分位置上的分割线）、放到纸上（`piece-fit.ts`：转 90°、等比居中、转黑白、缩略图）、一块 → 临时自由设计模板（`piece-template.ts`）、界面交来的设置的校验（`parse-pdf-request.ts`）；测试用合成页面 `testing/synthetic-page.ts` |
| `ipp/` | 局域网共享：IPP 编解码（`ipp-codec.ts`，RFC 8010，带上限）、建 / 读属性（`ipp-attributes.ts`）、共享打印机和状态（`shared-printer.ts`）、完整属性集（`printer-attributes.ts`，RFC 8011 + IPP/2.0 + IPP Everywhere + urf-supported）、文档格式（`document-format.ts`，按文件头认）、PWG / URF 光栅解码（`raster.ts`，限制按纸张算，在渲染页里跑）、任务表（`ipp-job-book.ts`）、六个操作（`ipp-operations.ts`，每台电脑只看得到自己的任务）、整页还是去白边和记录字段（`ipp-print.ts`）、DNS-SD 广告（`ipp-advert.ts`）；测试用的请求和光栅编码器在 `testing/` |
| `mdns/` | DNS 报文编解码（`dns-message.ts`，名字压缩只许往前指）、DNS-SD 记录（`dns-sd.ts`）、mDNS 应答（`mdns-responder.ts`：只答自己的记录，回答、宣告、告别、探测、冲突） |
| `diagnosis/` | 打印机诊断的纯逻辑：`diagnosis-model.ts`（两个平台统一的「事实」、动作结果、上限）、`submitted-jobs.ts`（本程序交给打印队列的时间段，认「本程序的任务」）、`queue-summary.ts`（卡住的任务）、`paper-choice.ts`（挑驱动纸张选项 / PWG 纸张名）、`fixes.ts`（每个平台每个修复要不要管理员、按钮和结果文字）、`verdicts.ts`（事实 → 结论、下一步、按钮） |

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
