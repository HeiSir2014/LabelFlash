# 通用识别规则与通用模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把固定的「编码-颜色-尺码」识别，改成可配置、可分享的识别规则；模板支持显示任意字段，二维码内容可配置；支持多行扫码。

**Architecture:**
- **识别**：放在 `src/core/scan/`，纯 TypeScript，依赖注入的正则执行器。结果为有序字段列表。
- **规则存储**：规则定义与模板一样，内置的写在代码里，自定义的存 SQLite；本机的顺序、启用、绑定模板存在设置里。
- **模板**：字段区分为「全部字段 / 指定字段」两种模式。
- **打印入口不变**：`PrintService` 仍是唯一的打印入口，模板按规则绑定来解析。
- **多行扫码**：渲染层用纯逻辑的 `ScanAssembler`，按按键之间的停顿把多行内容拼成一次扫码。

**Tech Stack:** 沿用 Phase 1：Bun 1.4、Electron 44（`node:sqlite`、`node:vm`）、React 19、TypeScript 5.9 strict、Biome 2、Playwright。无新增依赖。

**执行方式:**
- 由本会话在分支 `feature/generic-scan-rules` 上内联执行，每个任务先写失败的测试，再写实现。
- 每个任务的完整代码以对应提交为准，计划里列出接口、测试用例和关键算法。
- 提交哈希在完成后回填到每个任务末尾。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md`。
- 原始内容：换行统一为 `\n`，去掉首尾空白，最长 1000 字符；除换行、制表符外不允许控制字符和不可见字符。
- 规则类型：`delimited` / `keyValue` / `whole` / `regex`。
  - 正则不超过 300 字符，至少一个命名分组，标志只允许 `imsu`，在 `node:vm` 中执行，超时 20ms。
- 规则数量：自定义规则最多 50 条；导入文件不超过 256KB；字段名 1–20 字符，不含 `{}`、换行、控制字符。
- 多行扫码等待时间：默认 80ms，范围 20–500ms。
- 字段区：指定字段最多 8 个；全部字段模式最多显示 6 行。
- 默认当前模板改为 `builtin:generic`；内置规则「横杠三段」默认绑定 `builtin:standard`。
- 质量门槛：每个任务结束时，`bun run check`（lint + 三份 typecheck + 单元测试）零问题；涉及界面的任务再跑 `bun run test:e2e`。
- 只用 Edit/Write 改文件；仓库和提交信息里不出现参考产品、竞品或打印机品牌。

---

### Task 1: 原始内容规范化、规则模型、规则校验、内置规则

**Files:**
- Create: `src/core/scan/scan-result.ts`, `src/core/scan/normalize-raw.ts`, `src/core/scan/rule-model.ts`, `src/core/scan/sanitize-rule.ts`, `src/core/scan/builtin-rules.ts`
- Test: `src/core/scan/normalize-raw.test.ts`, `src/core/scan/sanitize-rule.test.ts`

**Interfaces（Produces）:**
- `ScanField { name; value }`；`ScanResult { raw; ruleId; ruleName; fields: ScanField[] }`；`fieldValue(scan, name): string | undefined`。
- `MAX_RAW_LENGTH = 1000`；`normalizeRaw(input): string | null`：
  - 统一换行，去掉首尾空白。
  - 空内容、超长、含不允许的字符时返回 null。
- `ScanRule` 联合类型，公共字段 `{ id; name }`：
  - `delimited`：`{ delimiter; fields: string[]; overflowIndex }`
  - `keyValue`：`{ separators: string[]; fields: { name; aliases: string[] }[]; required: string[]; keepUnknown }`
  - `whole`：`{ field; charset: 'digits' | 'alphanumeric' | 'any'; minLength; maxLength }`
  - `regex`：`{ pattern; flags }`
- `RULE_KINDS`、`RULE_LIMITS`、`BUILT_IN_RULE_PREFIX = 'builtin:'`、`CUSTOM_RULE_PREFIX = 'custom:'`、`RULE_ID_PATTERN`、`isBuiltInRuleId`、`isValidFieldName`、`namedGroups(pattern): string[]`。
- `sanitizeRule(value, id): ScanRule | RuleIssue`：严格校验，不合法时返回 `{ issue: string }`（中文原因），不做静默修正。
- `BUILT_IN_RULES`：依次为 `dash-three`、`digits-order`、`key-value`、`raw`；`DEFAULT_RULE_BINDINGS`（横杠三段 → `builtin:standard`）。

**测试要点:**
- `normalizeRaw`：
  - 统一 CRLF 和 CR；去首尾空白；保留中间的换行和制表符。
  - 拒绝零宽字符、BOM、其他 C0/C1 控制字符。
  - 1000 字符以内通过，1001 字符拒绝。
- `sanitizeRule`：
  - 四种类型各有一个合法样例。
  - 字段名非法（含 `{`、空、超长）时给出原因。
  - `delimited` 的字段少于 2 个或多于 10 个、分隔符为空、`overflowIndex` 越界都被拒绝。
  - `keyValue` 的 `required` 引用了不存在的字段时被拒绝。
  - `whole` 的长度范围颠倒时被拒绝。
  - `regex`：语法错误、没有命名分组、标志非法、超过 300 字符、命名分组不是合法字段名，都被拒绝。
- 内置规则全部能通过 `sanitizeRule` 校验。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(scan): raw normalisation, rule model and validation`（fab39e3）

### Task 2: 识别器与带超时的正则执行

**Files:**
- Create: `src/core/scan/recognize.ts`, `src/main/scan/sandboxed-regex.ts`
- Test: `src/core/scan/recognize.test.ts`, `src/main/scan/sandboxed-regex.test.ts`

**Interfaces:**
- `type RegexRunner = (pattern: string, flags: string, input: string) => Record<string, string> | null`：返回命名分组；不匹配或超时返回 null。
- `recognize(raw: string, rules: readonly ScanRule[], runRegex: RegexRunner): ScanResult | null`：
  - 先调用 `normalizeRaw`，再按顺序逐条尝试，返回第一条匹配。
  - 字段值去掉首尾空白，空值不算匹配；字段名在同一结果里唯一。
- `createSandboxedRegexRunner(timeoutMs = 20, warn): RegexRunner`：用 `vm.Script` 在独立上下文里执行，按「正则 + 标志」缓存编译结果；捕获 `ERR_SCRIPT_EXECUTION_TIMEOUT` 后 `warn` 一次，返回 null。

**关键算法:**
- **delimited**：
  - 按分隔符拆开；段数少于字段数时不匹配。
  - 段数多了，多出来的段并入 `overflowIndex` 所指字段（用原分隔符连回去）。
  - 分隔符不是换行时，含换行的内容不匹配。
- **keyValue**：
  - 按行拆开；每行找第一个出现的分隔符（在 `separators` 里取最靠左的那个位置）。
  - 键名去掉首尾空白后对照「字段名 + 别名」，不区分大小写。
  - 同一字段出现多次，取第一次。
  - `keepUnknown` 时保留未登记的键（键名必须是合法字段名，否则忽略）。
  - `required` 全部识别到才算匹配；`required` 为空时，至少要识别到一个已登记的键。
  - 输出顺序：先按规则里登记的字段顺序，再按未登记字段出现的顺序。
- **whole**：
  - 字符集：`digits` 只允许数字；`alphanumeric` 允许字母和数字；`any` 不限，只有 `any` 允许多行。
  - 长度必须在 `[minLength, maxLength]` 内。

**测试要点:**
- 横杠三段：编码带「-」时、字母尺码时都能正确拆分。
- 下划线分隔：两段、三段都能拆。
- 换行分隔的固定顺序格式能识别。
- 多行键值：
  - 中英文冒号混用、别名、大小写都能识别。
  - 未登记的键会被保留。
  - 缺少必填字段时不匹配。
- 纯数字订单号：8–30 位匹配；位数不在范围内、夹带字母时不匹配。
- 原样打印：多行内容也能匹配。
- 规则顺序：前一条不匹配时交给下一条；停用的规则不会出现在传入的列表里。
- 正则：命名分组对应到字段。
- 正则超时：`^(a+)+$` 配 40 个 a 加一个 `!`，返回 null，并调用了 `warn`。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(scan): rule recognisers with a sandboxed regex runner`（1fadaa5）

### Task 3: 规则目录、本机规则设置、规则表

**Files:**
- Create: `src/core/scan/rule-catalog.ts`, `src/core/scan/rule-settings.ts`, `src/main/storage/sqlite-scan-rule-repository.ts`
- Modify: `src/main/storage/migrations.ts`（`scan_rules` 写进初始 schema，不追加迁移）、`src/shared/settings.ts`（新增 `ruleSettings`、`scanLineGapMs`，`activeTemplateId` 默认值改为 `builtin:generic`）
- Test: `src/core/scan/rule-catalog.test.ts`, `src/core/scan/rule-settings.test.ts`, `src/main/storage/sqlite-scan-rule-repository.test.ts`, `src/shared/settings.test.ts`

**Interfaces:**
- `RuleRepository { listCustom(): ScanRule[]; save(rule); remove(id) }`。
- `RuleCatalog(repository, createId)`：
  - `list()`：内置规则 + 自定义规则。
  - `get(id)`。
  - `create(kind)`：生成一条可编辑的初始规则。
  - `duplicate(id)`。
  - `save(id, value)`：校验失败抛 `RuleError('INVALID', 原因)`。
  - `remove(id)`：内置规则抛 `BUILT_IN_READ_ONLY`。
  - `importRules(values)`：返回 `{ imported: ScanRule[]; skipped: { index; issue }[] }`；超过上限的部分跳过。
- `RuleSetting { id; enabled; templateId: string | null }`：
  - `mergeRuleSettings(saved, knownIds, defaults)`：丢掉已不存在的规则；缺少的内置规则按默认顺序补上；新导入的自定义规则插到「原样打印」之前。
  - `orderedEnabledRules(settings, catalog)`。
  - `templateIdFor(settings, ruleId)`。
- 设置：
  - `sanitizeSettings` 里校验 `ruleSettings` 的每一项，要求 id 符合格式、不重复，最多 60 项。
  - `scanLineGapMs` 夹到 20–500。
- 初始 schema 里加上（1.0.1 前没有发布过，不做迁移，开发机删掉旧数据库即可）：`CREATE TABLE scan_rules (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;`

**测试要点:**
- 目录：
  - 内置规则只读；复制后得到新的 `custom:` id。
  - 保存非法规则抛错，并带上中文原因。
  - 导入：部分有效时逐条返回跳过原因；超过 50 条的部分被截断。
- 合并规则设置：
  - 新增内置规则会被补上。
  - 已删除的规则被丢弃。
  - 保留用户排好的顺序和启用状态。
  - 导入的规则插在「原样打印」之前。
- 仓库：重新打开数据库后规则仍在；数据库版本变为 2。
- 设置：默认值、夹取、非法项被丢弃。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(scan): rule catalog, per-machine rule settings and scan_rules table`（afb2903）

### Task 4: 通用模板

> 执行说明：模板模型一改，`LabelJob`、打印服务和状态文案必须同时改才能编译，Task 4 与 Task 5 合并为一次提交；模板编辑器的字段区、二维码内容来源也随之提前完成（Task 8 只剩「识别规则」页）。执行中按需求追加了字段排列（横向 / 垂直）、可配置分隔符、按点阵对齐的二维码排布和新的文字排版算法，见规格 §4。

**Files:**
- Modify: `src/core/templates/template-model.ts`, `sanitize-template.ts`, `builtin-templates.ts`, `note-text.ts`, `note-override.ts`（如需）, `src/main/printing/label-html.ts`
- Test: `src/core/templates/templates.test.ts`, `src/main/printing/label-html.test.ts`

**Interfaces:**
- `FieldSlot { field; prefix; fontSizeMm; bold }`；`FieldsArea { mode: 'all' | 'pick'; all: TextStyle & { showNames: boolean }; slots: FieldSlot[] }`。
- `BottomLine { visible } & TextStyle`。
- `QrContent = { kind: 'raw' } | { kind: 'field'; field } | { kind: 'text'; text }`。
- `LabelTemplate` 的 `fields` 改为 `fieldsArea` + `bottom`，`qr` 增加 `content`。
- `resolveFieldRows(template, scan): { label: string; value: string }[]`：
  - 「指定字段」模式下，一个字段都没识别到时，退回「全部字段」。
  - 「全部字段」模式最多 6 行，超出的部分合成一行「…等 N 项」。
- `resolveQrText(template, scan, printedAt): string`：取不到内容时退回 `scan.raw`。
- `bottomText(scan): string | null`：多行内容用「 / 」连起来；只有一个字段且值等于原始内容时返回 null。
- `expandNoteText(text, scan, printedAt)`：支持 `{字段名}`、`{完整内容}`、`{规则}`、`{日期}`、`{时间}`；识别不到的变量原样保留。
- `renderLabelHtml(job)`：`job.scan` 取代 `job.label`。
- 二维码放不下时，逐级降低容错等级；到 L 仍放不下就不画二维码，并在返回结果里带上 `qrOmitted: true`。

**测试要点:**
- 内置模板：通用模板显示全部字段；样衣模板只显示指定的编码、颜色、尺码。
- 指定字段都没识别到时，退回显示全部字段。
- 全部字段模式最多 6 行，超出部分合并为「…等 N 项」。
- 二维码内容取字段、取文本、取不到时退回原始内容。
- 底部整行：多行内容用「 / 」连接；单字段且与原始内容相同时隐藏。
- 备注变量：字段、完整内容、规则名能展开，未知变量原样保留。
- 标签 HTML：全部转义；多行的值带 `white-space: pre-line`。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 与 Task 5 合并提交 `feat(templates): generic templates and printing from recognised scans`（0f0f4b0）

### Task 5: 打印服务、IPC 预览与界面状态文案切换到 ScanResult

**Files:**
- Modify:
  - 核心：`src/core/types.ts`（删除 `LabelData`，全部改用 `ScanResult`）、`src/core/print-service.ts`（注入 `recognize: (raw) => ScanResult | null` 与 `resolveTemplate: (scan) => LabelTemplate`，测试页也按规则识别）、`src/core/testing/*`。
  - 主进程：`src/main/print-template.ts`（`resolvePrintTemplate(templates, settings, scan)`）、`src/main/index.ts`、`src/main/ipc.ts`（预览返回 `templateName`）、`src/shared/ipc-contract.ts`、`src/shared/sample-label.ts`。
  - 渲染层：`src/renderer/src/lib/status-text.ts`（已打印时的详情取前 3 个字段值；格式错误改为「没有匹配的识别规则」）、`feedback-cues.ts`、`JobLog.tsx`（多行只显示第一行）、`PreviewStage.tsx`（角标显示「规则 · 模板」）。
  - 删除：`src/core/label-parser.ts` 及其测试（由 `recognize` 取代）。
- Test: `print-service.test.ts`, `status-text.test.ts`, `voice.test.ts`, `ipc` 相关测试

**测试要点:**
- 纯数字订单号用通用模板打印。
- 横杠三段打印时用绑定的样衣标准模板。
- 规则绑定的模板已被删除时，退回当前模板。
- 多行内容同样按规范化后的原始内容去重。
- 全部规则都不匹配时，结果为 invalid。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check && bun run test:e2e` → 与 Task 4 合并提交（0f0f4b0）

### Task 5A: 加工步骤核心（文本拼接、正则替换）与打印服务接入

**Files:**
- Create: `src/core/scan/enrich-model.ts`（步骤类型、上限）、`src/core/scan/sanitize-steps.ts`、`src/core/scan/enrich.ts`（执行器）
- Modify: `rule-model.ts`（每条规则加 `steps`）、`sanitize-rule.ts`、`print-service.ts`（识别后 `await enrich`）、`label-content.ts`（空值字段不显示）、`src/main/index.ts`
- Test: `enrich.test.ts`、`sanitize-steps.test.ts`、`print-service.test.ts`

**Interfaces:**
- `EnrichStep = TemplateStep | RegexReplaceStep | LookupStep | HttpStep`，公共字段 `{ kind; output… }`；`RULE_LIMITS.steps = 10`。
- `EnrichDeps { runRegex: RegexRunner; lookup(tableId, column, key, ignoreCase): Record<string,string> | null; http(request): Promise<HttpOutcome> }`。
- `enrich(scan, steps, deps, printedAt): Promise<EnrichResult>`，`EnrichResult = { ok: true; scan } | { ok: false; scan; failure: { stepIndex; detail } }`（只有 `onError: 'block'` 的 HTTP 步骤会让结果失败）。
- `PrintServiceDeps.enrich(scan): Promise<EnrichResult>`；拦下时 `PrintResult` 为 `failed` / `LOOKUP_FAILED`。

**测试要点:** 步骤按顺序执行、后一步能用前一步的输出；同名覆盖保持位置；正则替换不匹配输出原值、超时输出原值；非法步骤逐项报中文原因；拦下时不打印、记录失败；预览同样执行加工。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(scan): processing steps that derive new fields from a scan`（b92a380）

### Task 5B: 查找表

**Files:**
- Create: `src/core/lookup/csv.ts`（RFC 4180 解析，含引号、换行、BOM）、`src/core/lookup/lookup-model.ts`、`src/main/storage/sqlite-lookup-store.ts`
- Modify: `migrations.ts`（初始 schema 加两张表）、`enrich.ts`（`lookup` 步骤）、IPC（列出、导入 CSV 文件、删除）
- Test: `csv.test.ts`、`sqlite-lookup-store.test.ts`、`enrich.test.ts`

**测试要点:** 引号与转义、字段内换行、BOM、空行；列名重复或为空拒绝；超过行数 / 列数 / 大小拒绝；精确匹配、去空白、忽略大小写；替换表格保留 id。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(lookup): local lookup tables imported from CSV`（ed576f4）

### Task 5C: HTTP 查询与密钥

**Files:**
- Create: `src/core/scan/json-path.ts`、`src/main/scan/http-step.ts`（`fetch` + `AbortSignal.timeout`、大小限制、缓存）、`src/main/storage/secret-store.ts`（`safeStorage`）
- Modify: `enrich.ts`（`http` 步骤、变量按 URL / JSON 转义）、`settings.ts`（`secrets`）、IPC（密钥名称列表、设置、删除）
- Test: `json-path.test.ts`、`http-step.test.ts`（本地 `Bun.serve` 测试服务器）、`enrich.test.ts`

**测试要点:** 超时、非 2xx、非 JSON、超过 256KB、取不到值 → 按 `onError` 处理；缓存命中不再请求；只允许 http/https；密钥替换进请求头但不进日志和错误信息；URL 变量编码、JSON 请求体变量转义。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(scan): HTTP lookups with cached results and encrypted secrets`（6c9b5fb）

### Task 5D: 打印结果通知（webhook）

**Files:**
- Create: `src/core/notify/webhook-model.ts`（接口配置、事件、上限、退避表）、`src/core/notify/webhook-event.ts`（由打印结果生成请求体）、`src/core/notify/delivery-schedule.ts`（下次重试时间、是否放弃）、`src/main/notify/webhook-sender.ts`（签名、发送、超时）、`src/main/notify/webhook-outbox.ts`（后台发送循环）、`src/main/storage/sqlite-webhook-store.ts`
- Modify: `migrations.ts`（初始 schema 加 `webhook_deliveries`）、`settings.ts`（`webhooks`）、`print-service.ts`（`onRecorded` 回调，记录写入后触发）、IPC（测试、发送记录、立即重试；接口本身经 `settings:update` 保存）
- 设置页界面并入 Task 8，和「识别规则」页、查找表、密钥的界面一起做。
- Test: `webhook-event.test.ts`、`delivery-schedule.test.ts`、`webhook-sender.test.ts`（`Bun.serve` 验证签名）、`sqlite-webhook-store.test.ts`、`webhook-outbox.test.ts`（假时钟）

**测试要点:** 只为勾选的事件入队；测试页不入队；签名可被接收方验证；2xx 成功、5xx/429/超时重试、其他 4xx 不重试；退避时间表；24 小时放弃；重启后继续；同一接口按顺序；密钥不进日志；发送记录上限。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(notify): signed print result webhooks with a durable retry queue`（e19d0fc）

### Task 6: 规则 IPC 与导入导出文件

**Files:**
- Create: `src/core/scan/rule-file.ts`（导出文件的生成和解析）
- Modify: `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/ipc-validators.ts`
- Test: `src/core/scan/rule-file.test.ts`, `src/main/ipc-validators.test.ts`

**Interfaces:**
- `RULE_FILE_FORMAT = 'cdl-labelflash-rules'`，`version: 1`；`serializeRules(rules): string`；`parseRuleFile(text): { rules: unknown[] } | { error: string }`（不超过 256KB）。
- IPC 通道：
  - `rules:list`：返回 `{ rules: ScanRule[]; settings: RuleSetting[] }`。
  - `rules:create`（参数为规则类型）、`rules:duplicate`、`rules:save`、`rules:delete`。
  - `rules:test`：参数为原始内容，返回识别结果和每个加工步骤的结果（耗时、错误原因），识别不了时为 null。
  - `rules:export`：参数为规则 id 列表，主进程弹保存对话框，返回 `{ saved: boolean; count }`。
  - `rules:import`：主进程弹打开对话框，返回 `{ imported: number; skipped: { index; issue }[]; httpHosts: string[] }`；含 HTTP 步骤的规则导入后默认停用。
- 规则的顺序、启用和模板绑定，经 `settings:update` 的 `ruleSettings` 保存，由主进程校验。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check` → 提交 `feat(scan): rule IPC with JSON import and export`（ccb4a38）

### Task 7: 多行扫码

**Files:**
- Create: `src/renderer/src/lib/scan-assembler.ts`, `scan-assembler.test.ts`
- Modify: `src/renderer/src/components/ScanBar.tsx`（改成 `textarea`，单行显示）、`use-scan-focus.ts`（`textarea` 也算输入框）、`SettingsForm.tsx`（多行扫码等待时间）、`app.css`

**Interfaces:**
- `ScanAssembler(gapMs, onSubmit, timers)`：
  - `breakKey(kind: 'enter' | 'tab')`：先挂起，不提交。
  - `character()`：在挂起状态下，返回要插入的分隔字符（`\n` 或 `\t`），并取消计时。
    - 由扫码框的 `onChange`（内容在末尾变长）触发，而不是 keydown：中文往往不经过 keydown 送达（Windows 扫码枪的 Alt+小键盘码、输入法上屏、自动化测试的 insertText）。
  - 计时到期后，调用 `onSubmit` 提交当前内容。
  - `setGap(ms)`。

**测试要点:**
- 回车后停顿，提交一次。
- 回车后 80ms 内又有字符，插入换行，不提交。
- Tab 同理，插入制表符。
- 连续两个回车，保留一个空行。
- 修改等待时间后立即生效。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check && bun run test:e2e` → 提交 `feat(scan): assemble multi-line scans from the scanner's keystroke bursts`（c0b8a34）

### Task 8: 「识别规则」页与模板编辑器

**Files:**
- Create: `src/renderer/src/components/RulePanel.tsx`, `RuleEditor.tsx`, `StepEditor.tsx`（四种加工步骤的表单）, `RuleTester.tsx`, `LookupTables.tsx`, `SecretList.tsx`, `WebhookSettings.tsx`（接口列表、编辑、发送测试、发送记录、立即重试）, `src/renderer/src/view-models/use-rules.ts`, `src/renderer/src/lib/rule-text.ts`（+ test）
- Modify: `SidePanel.tsx`（新增第 5 个标签页「识别规则」）、`App.tsx`、`app.css`（模板编辑器的字段区与二维码内容来源已在 Task 4 完成）

**测试要点:**
- `rule-text`：规则类型的中文名、规则摘要（例如「分隔符 - · 编码 / 颜色 / 尺码」）、识别结果的字段摘要。

- [x] 写测试 → 失败 → 实现 → 通过 → `bun run check && bun run test:e2e` → 截图检查 → 提交 `feat(ui): scan rules panel, processing steps, lookup tables, secrets and webhooks`（9b21749，修正 1df4705）

### Task 9: E2E、文档与真机验证

**Files:**
- Modify: `e2e/app.e2e.ts`, `README.md`, `docs/roadmap.md`, `docs/superpowers/specs/2026-09-28-label-flash-design.md`（指向新规格）

**E2E 用例:**
1. 扫纯数字订单号 `202609281234567`：预览角标为「纯数字订单号 · 通用（二维码在左）」，标签上有「订单号」。
2. 用键盘一次打出 `订单号:A100`、回车、`尺码:M`、回车，最后停顿：只识别为一次扫码，得到订单号和尺码两个字段。
3. 在「识别规则」页的「试一试」里输入 `CL1_红_M`，结果为「原样打印」；新建一条下划线分隔的规则后再试，命中新规则。
4. 把「纯数字订单号」绑定到「通用 · 大字」模板后扫码，预览换成该模板。

**真机:** 在 Mac 上用 EPSON 真打一张：多行键值标签和纯数字订单号标签各一张，检查排版和二维码内容。

- [x] `bun run check && bun run test:e2e`：E2E 7 个用例覆盖以上 4 点（1df4705）。
- [x] Mac 真机：
  - 集成：真实 Electron 里 HTTP 查询走 net.fetch、密钥存 macOS 钥匙串，查询结果进入字段；打印结果通知签名可被接收方验证，后台送达。
  - 打印：EPSON 真打多行键值、纯数字订单号各一张，CUPS 任务均为 completed。
- [x] 文档：README、路线图、Phase 1 规格指向本规格。
