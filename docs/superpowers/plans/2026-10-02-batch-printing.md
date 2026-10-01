# 批量打印（子项目 3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台标题栏加「批量打印」，打开和配置中心同级的全窗口页面：选模板（标签 / 面单 / 自由设计都行）→ 导入 `.xlsx` / `.csv`（选文件、拖进窗口）或粘贴从 Excel 复制的表格、或不用数据只按序号打 → 模板变量对列 → 序号 `{序号}` → 份数 → 逐行预览（问题行标黄）→ 按顺序打印，可暂停、继续、取消，失败的行单独重打；每张一条打印记录（来源「批量」，带批次号、行号、份号），打印记录能按批次筛选、整批重打失败的。

**Architecture:** core 放纯逻辑：列名自动对列、序号、份数展开、逐行组装字段和问题（`batch/batch-labels.ts`），批次运行器 `BatchRun`（按顺序逐张调用 `PrintService.printFields`，暂停 / 继续 / 取消，打印机不能用时自动暂停、这一张留到继续时重打）。表格文件来自外部、不可信，按 Chromium 两条法则放进 Electron `utilityProcess` 子进程里解析（`read-excel-file` 读 `.xlsx`、现有 CSV 解析器读 `.csv`），主进程限时、限堆，只收字符串二维数组再按同一套上限校验一遍；`.xls` 直接拒绝。主进程 `batch/BatchStation` 保存最近读进来的一张表，按界面交来的「打印设置」（模板 id、表格 id、对列、序号、份数、勾选的行，经 `parseBatchPlan` 严格校验）预览、检查、开打，进度合并成最多 0.25 秒一次推给界面。`{序号}` 不是新的固定变量：批量打印把它作为名为「序号」的字段交给模板，三类模板展开变量时本来就按字段取值，渲染代码不用改。打印记录表追加迁移 6：来源加 `batch`，新增 `batch_id`、`batch_row`、`batch_copy` 三列；批量打的不参与扫码防重复窗口的恢复。

**Tech Stack:** TypeScript、Bun test、Electron 主进程 + `utilityProcess`、`read-excel-file`（新依赖，MIT）、React 19、Playwright E2E。

设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 2、5、9、10、11 节。

## 约定（每个任务都适用）

- **只用 Edit / Write 改文件**（用户要求），不用 sed、脚本、`biome --write` 改文件；Biome 报 import 顺序时用 Edit 调整。
- **Google TypeScript Style Guide**：只用具名导出；不用 `any`；对象形状用 `interface`；导出的符号写文档注释；模块级常量 `CONSTANT_CASE`；不用 `!` 非空断言。注释中文，写为什么；数值常量起名、带单位、写取值依据。
- **每个任务**：先写失败的测试 → 跑一次看它失败 → 实现 → 跑通过 → `bun run check` 通过（改了界面或主进程再跑 `bun run test:e2e`）→ 提交。提交信息英文 Conventional Commits，正文写为什么，末尾带两行署名。下面的提交命令里 `$TRAILER` 就是这两行，在 Git Bash 里先设好：

```bash
TRAILER=$'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LgHoPxpB2ZvtVDHDUepJjK'
```

- 分支：在 `feature/canvas-designer` 合进 master 之后，从 master 拉 `feature/batch-printing`（批量打印依赖 1a 的自由设计模板和 `templateFields` 对 canvas 的支持）。设计器 1b 的计划在另一份文件里同时进行，两边都改 `e2e/visual/acceptance.visual.ts` 和配置中心布局文档的验收表：批量打印的验收项固定用 **V60–V62**，追加在文件里当时最后一项之后，不和设计器的 V45+ 抢编号。
- 名词：界面上「已发送」，不说「打印成功」（驱动回调成功只代表进了打印队列）；行号从 1 数、不含表头。

## 文件结构

| 文件 | 新建 / 修改 | 职责 |
|---|---|---|
| `package.json`、`bun.lock` | 修改 | 加 `read-excel-file` |
| `src/core/lookup/csv.ts` | 修改 | 上限和分隔符可传入；拆出 `splitCsvRecords`、`tableFromRecords`，Excel 读出的行和 CSV 共用一套表头、上限规则 |
| `src/core/batch/batch-model.ts` | 新建 | 类型、`BATCH_LIMITS`、`SERIAL_FIELD`、批次号、表格编号格式 |
| `src/core/batch/column-mapping.ts` | 新建 | 按列名自动对列、要对列的变量、没对上的变量 |
| `src/core/batch/serial.ts` | 新建 | 序号文字（前缀、起始、步长、补零、后缀） |
| `src/core/batch/batch-labels.ts` | 新建 | 行 → 标签：字段、内容、份数、问题；要打的行；单行预览 |
| `src/core/batch/parse-batch-plan.ts` | 新建 | 渲染进程交来的打印设置 → 严格校验后的 `BatchPlan` |
| `src/core/batch/batch-runner.ts` | 新建 | `BatchRun`：按顺序逐张打，暂停 / 继续 / 取消，打印机问题自动暂停 |
| `src/core/types.ts` | 修改 | 来源加 `batch`；`BatchRef`；`PrintRequest.batch`、`JobRecord.batch` |
| `src/core/print-service.ts` | 修改 | `printFields` 带批次；`BATCH_RULE`；`fieldsScan` 可指定规则名 |
| `src/core/testing/in-memory-job-store.ts` | 修改 | 批量打的不参与防重复恢复 |
| `src/main/storage/migrations.ts` | 修改 | 追加迁移 6 |
| `src/main/storage/sqlite-job-store.ts` | 修改 | 批次三列；按批次翻页；每行每份最新一次失败的记录 |
| `src/shared/job-history.ts` | 修改 | `JobQuery.batchId` |
| `src/shared/batch.ts` | 新建 | IPC 用的批量打印类型 |
| `src/main/batch/table-file.ts` | 新建 | 认文件类型（拒 `.xls`）、单元格转文字、子进程里读字节 → 行 |
| `src/main/batch/testing/minimal-xlsx.ts` | 新建 | 测试用：生成只有文字和数字的最小 `.xlsx` |
| `src/main/batch/table-reader-host.ts` | 新建 | 起子进程读表格：超时、崩溃、回复校验 |
| `src/main/batch/reader-worker.ts` | 新建 | `utilityProcess` 入口 |
| `src/main/batch/batch-station.ts` | 新建 | 读表、粘贴、预览、检查、开打、重打失败的、进度推送 |
| `src/main/ipc-validators.ts`、`src/main/ipc.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/main/index.ts` | 修改 | 新通道和接线 |
| `src/main/printing/fake-printers.ts` | 修改 | 假打印机可设每张耗时（E2E 测暂停、取消） |
| `src/renderer/src/lib/batch-view.ts` | 新建 | 批量打印页的纯逻辑（文字、勾选、虚拟滚动、组装设置） |
| `src/renderer/src/lib/app-view.ts`、`scan-routing.ts`、`status-text.ts`、`reprint.ts` | 修改 | 视图加 `batch`；来源文字；批量记录按原样重打 |
| `src/renderer/src/view-models/use-batch.ts`、`use-file-drop.ts`、`use-app-view.ts`、`use-job-log.ts` | 新建 / 修改 | 页面状态、拖文件、打开批量页、按批次筛选 |
| `src/renderer/src/components/batch/BatchPage.tsx`、`BatchSetup.tsx`、`BatchRows.tsx` | 新建 | 页面 |
| `src/renderer/src/components/TitleBar.tsx`、`JobLog.tsx`、`App.tsx`、`styles/app.css`、`styles/tokens.css` | 修改 | 入口、记录筛选、样式 |
| `e2e/batch.e2e.ts` | 新建 | CSV 按顺序带序号、xlsx、粘贴、`.xls` 拒绝、拖文件、暂停 / 取消 |
| `e2e/visual/acceptance.visual.ts`、`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` | 修改 | 视觉验收 V60–V62 |
| `README.md`、`docs/roadmap.md`、设计文档第 5 节、`docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md`、`CLAUDE.md`、`src/*/CLAUDE.md` | 修改 | 文档 |

---

### Task 1: 加入 read-excel-file

**Files:**
- Modify: `package.json`（`dependencies`）、`bun.lock`

- [ ] **Step 1: 安装**

Run: `cd /d/project/LabelFlash && bun add read-excel-file`
Expected: `package.json` 的 `dependencies` 多一行 `"read-excel-file": "^9.x.x"`（写计划时最新是 9.3.10，MIT），`bun.lock` 更新。

- [ ] **Step 2: 核对 Node 入口的 API**

Read `node_modules/read-excel-file/package.json`（`exports` 里有 `./node`）和 `node_modules/read-excel-file/node/index.d.ts`。确认：

1. 有具名导出 `readSheet(input, options?)`，`input` 接受 `Buffer`，返回 `Promise<SheetData>`（`(CellValue | null)[][]`，`CellValue` 是 `string | number | boolean | Date`），默认读第一个工作表（context7 文档：`import { readSheet } from 'read-excel-file/node'`；`readXlsxFile` 在 v9 改成返回全部工作表 `{ sheet, data }[]`，不用它）。
2. 记下 `node/index.cjs` 顶部 `require` 了哪些包（写计划时的依赖是 `fflate`、`saxen`、`unzipper-esm`、`worker-f`）。Task 11 跑 `verify:bundle` 时这些都必须被打进子进程的 bundle。

如果第 1 条不成立（没有 `readSheet`），Task 8 的测试和 Task 9 的 `reader-worker.ts` 里的 `readSheet(bytes)` 改成 `import readXlsxFile from 'read-excel-file/node'`，`(bytes) => readXlsxFile(bytes).then((sheets) => sheets[0]?.data ?? [])`，其余代码不变。

- [ ] **Step 3: 提交**

```bash
git add package.json bun.lock
git commit -m "build(deps): add read-excel-file for batch printing" -m "Batch printing imports .xlsx files. read-excel-file is MIT, read-only and small; it runs only inside the isolated table reader process. CSV keeps using our own parser." -m "$TRAILER"
```

---

### Task 2: CSV 解析器的上限和分隔符可传入

查找表的上限（20 列、10 万行）和批量打印的不同（100 列、1 万行、总字数），从 Excel 复制出来的表格用 Tab 分隔；Excel 读出来的行也要过同一套表头规则。

**Files:**
- Modify: `src/core/lookup/csv.ts`
- Modify: `src/core/lookup/csv.test.ts`

- [ ] **Step 1: 写测试**（文件顶部的 import 改为 `import { parseCsv, splitCsvRecords, type TableLimits, tableFromRecords } from './csv';`，在文件末尾追加下面三个 `describe`）

```ts
describe('parseCsv options', () => {
  test('splits tab-separated text copied from Excel', () => {
    expect(parseCsv('编码\t备注\nCL1\t"有\t制表符"\n', { delimiter: '\t' })).toEqual({
      ok: true,
      table: { columns: ['编码', '备注'], rows: [['CL1', '有\t制表符']] },
    });
  });

  test('applies the limits it is given', () => {
    const limits: TableLimits = { rows: 1, columns: 2, columnNameLength: 10, cellLength: 5, totalChars: 8 };
    expect(parseCsv('a,b,c\n1,2,3', { limits })).toMatchObject({ ok: false, issue: '最多 2 列，这个文件有 3 列' });
    expect(parseCsv('a\n1\n2', { limits })).toMatchObject({ ok: false, issue: expect.stringContaining('最多 1 行') });
    expect(parseCsv('a,b\n12345,1234', { limits })).toMatchObject({
      ok: false,
      issue: expect.stringContaining('表格内容太多'),
    });
  });
});

describe('tableFromRecords', () => {
  test('uses the first non-blank record as the header and pads short rows', () => {
    expect(tableFromRecords([[''], ['编码', '颜色'], ['CL1']], LOOKUP_LIMITS)).toEqual({
      ok: true,
      table: { columns: ['编码', '颜色'], rows: [['CL1', '']] },
    });
  });
});

describe('splitCsvRecords', () => {
  test('keeps blank records and strips a leading BOM', () => {
    expect(splitCsvRecords('﻿a,b\n\n1,2', ',')).toEqual({ ok: true, rows: [['a', 'b'], [''], ['1', '2']] });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/lookup/csv.test.ts`
Expected: FAIL，`splitCsvRecords` / `tableFromRecords` 没有导出。

- [ ] **Step 3: 实现**（整个文件换成下面的内容）

```ts
// src/core/lookup/csv.ts
import { LOOKUP_LIMITS, type LookupTableData } from './lookup-model';

export type CsvResult = { ok: true; table: LookupTableData } | { ok: false; issue: string };

/** 一张表的上限：查找表用 LOOKUP_LIMITS，批量打印用 BATCH_LIMITS。 */
export interface TableLimits {
  rows: number;
  columns: number;
  columnNameLength: number;
  cellLength: number;
  /** 整张表的字符总数；不设就不限（查找表靠文件大小限住）。 */
  totalChars?: number;
}

/** 分隔符：CSV 文件是逗号；从 Excel 复制出来的表格是 Tab。 */
export type CsvDelimiter = ',' | '\t';

export interface CsvOptions {
  delimiter?: CsvDelimiter;
  limits?: TableLimits;
}

/** 拆好的记录（还没认表头）；引号没闭合时说明原因。 */
export type CsvRecords = { ok: true; rows: string[][] } | { ok: false; issue: string };

const BOM = '﻿';

/**
 * 解析 CSV（RFC 4180）：带引号的单元格里可以有分隔符、换行和 "" 转义的引号；
 * 行尾 CRLF / LF 都可以；开头的 BOM 去掉。表头和上限的规则见 tableFromRecords。
 */
export function parseCsv(input: string, options: CsvOptions = {}): CsvResult {
  const records = splitCsvRecords(input, options.delimiter ?? ',');
  if (!records.ok) {
    return records;
  }
  return tableFromRecords(records.rows, options.limits ?? LOOKUP_LIMITS);
}

/** 表格内容超过总字数上限时的说明（读 Excel 的子进程提前拦下时用同一句）。 */
export function totalCharsIssue(limit: number): string {
  return `表格内容太多（超过 ${limit} 字）：请分成几个文件`;
}

/**
 * 记录 → 表格：完全空白的记录跳过；第一条是列名，不能为空、不能重复；数据行比列名少的补空，
 * 多的报错（多半是分隔符不对或表头不全）。CSV 拆出来的和 Excel 读出来的都走这里，规则只有一份。
 */
export function tableFromRecords(records: readonly (readonly string[])[], limits: TableLimits): CsvResult {
  const [header, ...body] = records.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (!header) {
    return { ok: false, issue: '文件是空的，第一行应该是列名' };
  }
  const columns = header.map((name) => name.trim());
  const columnIssue = checkColumns(columns, limits);
  if (columnIssue) {
    return { ok: false, issue: columnIssue };
  }
  if (body.length > limits.rows) {
    return { ok: false, issue: `最多 ${limits.rows} 行数据，这个文件有 ${body.length} 行` };
  }
  const rows: string[][] = [];
  let totalChars = 0;
  for (const [index, row] of body.entries()) {
    if (row.length > columns.length) {
      return {
        ok: false,
        issue: `第 ${index + 2} 行有 ${row.length} 列，比列名多（${columns.length} 列）：请检查表头是否完整、分隔符是否正确`,
      };
    }
    if (row.some((cell) => cell.length > limits.cellLength)) {
      return { ok: false, issue: `第 ${index + 2} 行有单元格超过 ${limits.cellLength} 个字符` };
    }
    for (const cell of row) {
      totalChars += cell.length;
    }
    if (limits.totalChars !== undefined && totalChars > limits.totalChars) {
      return { ok: false, issue: totalCharsIssue(limits.totalChars) };
    }
    rows.push(columns.map((_, column) => row[column] ?? ''));
  }
  return { ok: true, table: { columns, rows } };
}

function checkColumns(columns: readonly string[], limits: TableLimits): string | null {
  if (columns.length > limits.columns) {
    return `最多 ${limits.columns} 列，这个文件有 ${columns.length} 列`;
  }
  const seen = new Set<string>();
  for (const [index, name] of columns.entries()) {
    if (name === '') {
      return `第 ${index + 1} 列没有列名`;
    }
    if (name.length > limits.columnNameLength) {
      return `列名「${name.slice(0, 10)}…」超过 ${limits.columnNameLength} 个字符`;
    }
    if (seen.has(name)) {
      return `列名重复：「${name}」`;
    }
    seen.add(name);
  }
  return null;
}

/** 逐字符扫描，按引号状态切分单元格和记录；开头的 BOM 去掉，空白记录原样保留（由 tableFromRecords 跳过）。 */
export function splitCsvRecords(input: string, delimiter: CsvDelimiter): CsvRecords {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let isQuoted = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (isQuoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        isQuoted = false;
      } else {
        cell += char;
      }
      index += 1;
      continue;
    }
    if (char === '"' && cell === '') {
      isQuoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
    } else {
      cell += char;
    }
    index += 1;
  }
  if (isQuoted) {
    return { ok: false, issue: '有引号没有闭合，文件可能不完整' };
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { ok: true, rows };
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/lookup src/main/lookup`
Expected: PASS（查找表行为不变：`第 2 行有 3 列` 仍在提示开头）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/lookup/csv.ts src/core/lookup/csv.test.ts
git commit -m "refactor(lookup): let the csv parser take limits and a delimiter" -m "Batch printing needs other limits (100 columns, 10,000 rows, a total size) and tab-separated text pasted from Excel. Rows read from .xlsx go through the same header rules, so tableFromRecords is shared." -m "$TRAILER"
```

---

### Task 3: 批量打印的模型、自动对列、序号

**Files:**
- Create: `src/core/batch/batch-model.ts`、`src/core/batch/batch-model.test.ts`
- Create: `src/core/batch/column-mapping.ts`、`src/core/batch/column-mapping.test.ts`
- Create: `src/core/batch/serial.ts`、`src/core/batch/serial.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/batch/batch-model.test.ts
import { describe, expect, test } from 'bun:test';
import { BATCH_ID_PATTERN, batchIdFor, NO_SOURCE, sourceOf } from './batch-model';

describe('batchIdFor', () => {
  test('stamps the local start time to the second and adds four random hex digits', () => {
    const id = batchIdFor(new Date(2026, 9, 2, 14, 35, 1), 'a1b2');
    expect(id).toBe('20261002-143501-a1b2');
    expect(BATCH_ID_PATTERN.test(id)).toBe(true);
  });

  test('fails fast on a suffix that is not four hex digits', () => {
    expect(() => batchIdFor(new Date(2026, 9, 2), 'xyz')).toThrow('batch id suffix');
  });
});

describe('sourceOf', () => {
  test('reads only own entries, so names like __proto__ are not taken from the prototype', () => {
    expect(sourceOf({ 编码: { kind: 'column', column: '编码' } }, '编码')).toEqual({ kind: 'column', column: '编码' });
    expect(sourceOf({}, '__proto__')).toBe(NO_SOURCE);
  });
});
```

```ts
// src/core/batch/column-mapping.test.ts
import { describe, expect, test } from 'bun:test';
import { autoMapping, mappableVariables, unmappedVariables, usesSerial } from './column-mapping';

describe('autoMapping', () => {
  test('maps a variable to the column with the same name', () => {
    expect(autoMapping(['编码', '颜色'], ['颜色', '编码'])).toEqual({
      编码: { kind: 'column', column: '编码' },
      颜色: { kind: 'column', column: '颜色' },
    });
  });

  test('ignores spaces, full-width letters and case when there is no exact match', () => {
    expect(autoMapping(['编码', 'sku'], ['编 码', 'ＳＫＵ'])).toEqual({
      编码: { kind: 'column', column: '编 码' },
      sku: { kind: 'column', column: 'ＳＫＵ' },
    });
  });

  test('leaves a variable without a matching column unmapped', () => {
    expect(autoMapping(['货架号'], ['编码'])).toEqual({ 货架号: { kind: 'none' } });
  });
});

describe('template variables', () => {
  test('maps every variable except the serial, which has its own settings', () => {
    expect(mappableVariables({ mode: 'PICKED', names: ['编码', '序号', '颜色'] })).toEqual(['编码', '颜色']);
    expect(usesSerial({ mode: 'PICKED', names: ['编码', '序号'] })).toBe(true);
    expect(usesSerial({ mode: 'ALL', names: [] })).toBe(false);
  });

  test('lists variables that are not mapped or whose column is gone', () => {
    const mapping = {
      编码: { kind: 'column', column: '编码' },
      颜色: { kind: 'column', column: '旧列' },
      尺码: { kind: 'none' },
      备注: { kind: 'fixed', value: '' },
    } as const;
    expect(unmappedVariables(mapping, ['编码', '颜色', '尺码', '备注'], ['编码'])).toEqual(['颜色', '尺码']);
  });
});
```

```ts
// src/core/batch/serial.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_SERIAL } from './batch-model';
import { serialText } from './serial';

describe('serialText', () => {
  test('counts from the start by the step, zero-padded, with prefix and suffix', () => {
    const settings = { ...DEFAULT_SERIAL, prefix: 'A', start: 8, step: 2, digits: 3, suffix: '号' };
    expect([0, 1, 2].map((position) => serialText(settings, position))).toEqual(['A008号', 'A010号', 'A012号']);
  });

  test('does not pad when digits is 0 and never cuts a longer number', () => {
    expect(serialText({ ...DEFAULT_SERIAL, start: 1, digits: 0 }, 9)).toBe('10');
    expect(serialText({ ...DEFAULT_SERIAL, start: 1000, digits: 2 }, 0)).toBe('1000');
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/batch`
Expected: FAIL，`Cannot find module './batch-model'`。

- [ ] **Step 3: 实现**

```ts
// src/core/batch/batch-model.ts
import type { ScanField } from '../scan/scan-result';

/**
 * 序号变量的名字：模板里写 {序号}。它不是 {日期} 那样的固定变量：批量打印把序号作为名为「序号」的字段交给模板，
 * 标签、面单、自由设计展开变量时本来就按字段取值（note-text.ts 的 expandVariables），渲染代码不用改。
 */
export const SERIAL_FIELD = '序号';

/** 模板变量名的长度上限：和 note-text.ts 里变量的写法（花括号里 1–20 个字符）一致。 */
export const VARIABLE_NAME_MAX_LENGTH = 20;

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** 批量打印的上限，每项写取值依据。 */
export const BATCH_LIMITS = {
  /** 文件大小 20MB：和查找表一致；一万行的表格远小于它。 */
  fileBytes: 20 * BYTES_PER_MEGABYTE,
  /** 数据行数：一万行（设计第 5 节）。 */
  rows: 10_000,
  /** 列数：Excel 导出的宽表一般几十列，100 列留足余量。 */
  columns: 100,
  /** 列名长度：和查找表一致。 */
  columnNameLength: 50,
  /** 单元格长度：和查找表一致，标签上放不下更长的字。 */
  cellLength: 1_000,
  /**
   * 整张表的字符总数：一万行 × 100 列 × 1000 字理论上有 10 亿字，进程之间、界面里都放不下；
   * 500 万字（内存里约 10MB）够一万行 × 25 列 × 20 字。
   */
  totalChars: 5_000_000,
  /** 粘贴的文字：和整张表的总字数一致。 */
  pasteChars: 5_000_000,
  /** 每行最多几份：一行要打 100 张以上应该拆开或分批。 */
  copiesPerRow: 100,
  /** 一批最多几张：热敏标签机每秒 1–2 张，2 万张要 3–6 小时，再多应该分批。 */
  labels: 20_000,
  /** 「只按序号打」最多几张：和数据行数一致。 */
  serialOnlyCount: 10_000,
  /** 序号起始值：12 位，够箱号、流水号。 */
  serialStart: 999_999_999_999,
  /** 序号步长上限：再大就不像序号了。 */
  serialStep: 1_000_000,
  /** 序号补零的位数：和起始值的 12 位一致。 */
  serialDigits: 12,
  /** 序号前缀、后缀的长度。 */
  serialAffixLength: 20,
  /** 固定值长度：和单元格一致。 */
  fixedValueLength: 1_000,
  /** 一个模板最多有几个变量要对列：自由设计最多 100 个元素，表格每格都能有变量，200 足够。 */
  variables: 200,
} as const;

/** 文件太大时的说明（界面拖进来时先查一次，主进程再查一次）。 */
export const FILE_TOO_LARGE_ISSUE = `文件不能超过 ${BATCH_LIMITS.fileBytes / BYTES_PER_MEGABYTE}MB：可以拆成几个文件分批打`;

/** 批次号：开始时间（本地时间到秒）+ 4 位十六进制，例如 20261002-143501-a1b2。 */
export const BATCH_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
/** 主进程给读进来的表格的编号（UUID）。 */
export const TABLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 读进来的一张表：rows 的每一行长度都等于 columns。 */
export interface BatchTable {
  /** 主进程给的编号：开始打印时按它找回这张表，界面不用把整张表传回去。 */
  id: string;
  /** 文件名；粘贴的是「粘贴的数据」。 */
  name: string;
  columns: string[];
  rows: string[][];
}

/** 一个模板变量从哪取值：表格的一列、固定值，或不填（这一项不印）。 */
export type FieldSource = { kind: 'column'; column: string } | { kind: 'fixed'; value: string } | { kind: 'none' };

export const NO_SOURCE: FieldSource = { kind: 'none' };

/** 序号 {序号}：按规则生成，或取表格的一列（column 不为 null 时，前面几项不用）。 */
export interface SerialSettings {
  enabled: boolean;
  prefix: string;
  start: number;
  step: number;
  /** 补零到几位；0 = 不补。 */
  digits: number;
  suffix: string;
  column: string | null;
}

export const DEFAULT_SERIAL: SerialSettings = {
  enabled: false,
  prefix: '',
  start: 1,
  step: 1,
  digits: 0,
  suffix: '',
  column: null,
};

/** 份数：每行固定几份，或取表格的一列。 */
export type CopiesSettings = { kind: 'fixed'; count: number } | { kind: 'column'; column: string };

export const DEFAULT_COPIES: CopiesSettings = { kind: 'fixed', count: 1 };

/** 数据：主进程里存着的一张表，或不用数据、只按序号打几张。 */
export type BatchData = { kind: 'table'; tableId: string } | { kind: 'serial-only'; count: number };

/** 一次批量打印的全部设置（界面交给主进程，经 parseBatchPlan 校验）。 */
export interface BatchPlan {
  templateId: string;
  data: BatchData;
  /** 模板变量名 → 取值方式；序号不在这里（见 serial）。 */
  mapping: Record<string, FieldSource>;
  serial: SerialSettings;
  copies: CopiesSettings;
  /** 要打的行（0 起的下标）；null = 全部。 */
  rows: number[] | null;
}

/** 一张标签：row 是数据的第几行（从 1 数、不含表头；只按序号打时是第几张），copy 是这一行的第几份。 */
export interface BatchLabel {
  row: number;
  copy: number;
  fields: ScanField[];
  /** 完整内容：打印记录的 raw、二维码的「完整内容」、{完整内容}。 */
  content: string;
}

/** 有问题的一行（缺字段、份数不对、条码印不了……）：界面标黄，问题写在悬停提示和预览旁。 */
export interface RowProblem {
  /** 从 1 数，不含表头。 */
  row: number;
  texts: string[];
}

/** 只读自己的键：变量名可能是 __proto__ 这样的字，不能从原型上取到东西。 */
export function sourceOf(mapping: Readonly<Record<string, FieldSource>>, variable: string): FieldSource {
  return Object.hasOwn(mapping, variable) ? (mapping[variable] ?? NO_SOURCE) : NO_SOURCE;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 批次号：开始时间（本地时间到秒）加 4 位随机十六进制。界面和打印记录里显示它，比 UUID 好认；
 * 同一秒开两批（例如打完马上重打失败的）也不会撞。
 */
export function batchIdFor(date: Date, randomHex: string): string {
  if (!/^[0-9a-f]{4}$/.test(randomHex)) {
    throw new Error(`Invalid batch id suffix: ${randomHex}`);
  }
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${day}-${time}-${randomHex}`;
}
```

```ts
// src/core/batch/column-mapping.ts
import type { TemplateFields } from '../api/template-fields';
import { type FieldSource, SERIAL_FIELD, sourceOf } from './batch-model';

/** 比较列名时忽略空白、全角半角和大小写：Excel 表头常有「编 码」「ＳＫＵ」这样的写法。 */
function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 按列名对上模板变量：先找完全相同的列，再找忽略空白、全角半角、大小写后相同的；对不上的不填。 */
export function autoMapping(variables: readonly string[], columns: readonly string[]): Record<string, FieldSource> {
  const entries = variables.map((variable): [string, FieldSource] => {
    const column =
      columns.find((name) => name === variable) ??
      columns.find((name) => normalizeName(name) === normalizeName(variable));
    return [variable, column === undefined ? { kind: 'none' } : { kind: 'column', column }];
  });
  // fromEntries 按「定义自己的属性」写入：变量名是 __proto__ 时也不会改到原型。
  return Object.fromEntries(entries);
}

/** 要对列的模板变量：模板用到的字段，不含序号（序号单独设置）。 */
export function mappableVariables(fields: TemplateFields): string[] {
  return fields.names.filter((name) => name !== SERIAL_FIELD);
}

/** 模板用到了 {序号}。 */
export function usesSerial(fields: TemplateFields): boolean {
  return fields.names.includes(SERIAL_FIELD);
}

/** 没对上的变量（不填，或对的列已经不在表里）：界面标红。固定值算对上了，空的固定值就是有意不印。 */
export function unmappedVariables(
  mapping: Readonly<Record<string, FieldSource>>,
  variables: readonly string[],
  columns: readonly string[],
): string[] {
  return variables.filter((variable) => {
    const source = sourceOf(mapping, variable);
    return source.kind === 'none' || (source.kind === 'column' && !columns.includes(source.column));
  });
}
```

```ts
// src/core/batch/serial.ts
import type { SerialSettings } from './batch-model';

/** 第 position 张（从 0 数，按要打的行的顺序）的序号文字；位数只补零、不截断。 */
export function serialText(settings: SerialSettings, position: number): string {
  const value = settings.start + position * settings.step;
  return `${settings.prefix}${String(value).padStart(settings.digits, '0')}${settings.suffix}`;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/batch`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/batch
git commit -m "feat(batch): batch model, column auto-mapping and serial numbers" -m "Pure logic for batch printing. {序号} is handed to templates as a field named 序号, so labels, waybills and canvas templates expand it without renderer changes." -m "$TRAILER"
```

---

### Task 4: 行 → 标签，以及打印设置的校验

**Files:**
- Create: `src/core/batch/batch-labels.ts`、`src/core/batch/batch-labels.test.ts`
- Create: `src/core/batch/parse-batch-plan.ts`、`src/core/batch/parse-batch-plan.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/batch/batch-labels.test.ts
import { describe, expect, test } from 'bun:test';
import type { TemplateFields } from '../api/template-fields';
import { labelForRow, planLabels } from './batch-labels';
import { BATCH_LIMITS, type BatchPlan, type BatchTable, DEFAULT_COPIES, DEFAULT_SERIAL } from './batch-model';

const TABLE_ID = '00000000-0000-4000-8000-000000000001';
const PICKED: TemplateFields = { mode: 'PICKED', names: ['编码', '颜色', '序号'] };
const ALL: TemplateFields = { mode: 'ALL', names: [] };
const TABLE: BatchTable = {
  id: TABLE_ID,
  name: 'rows.csv',
  columns: ['编码', '颜色', '份数'],
  rows: [
    ['CL1', '红', '2'],
    ['CL2', '', ''],
    ['CL3', '黑', 'x'],
  ],
};

function plan(overrides: Partial<BatchPlan> = {}): BatchPlan {
  return {
    templateId: 'builtin:canvas-tag',
    data: { kind: 'table', tableId: TABLE_ID },
    mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '颜色' } },
    serial: { ...DEFAULT_SERIAL, enabled: true, prefix: 'A', digits: 3 },
    copies: DEFAULT_COPIES,
    rows: null,
    ...overrides,
  };
}

function okPlan(result: ReturnType<typeof planLabels>) {
  if (!result.ok) {
    throw new Error(result.issue);
  }
  return result;
}

describe('planLabels', () => {
  test('makes one label per row with the mapped fields and a serial', () => {
    const { labels, rowCount } = okPlan(planLabels({ table: TABLE, plan: plan(), fields: PICKED }));
    expect(rowCount).toBe(3);
    expect(labels.map((label) => [label.row, label.copy, label.fields])).toEqual([
      [1, 1, [{ name: '编码', value: 'CL1' }, { name: '颜色', value: '红' }, { name: '序号', value: 'A001' }]],
      [2, 1, [{ name: '编码', value: 'CL2' }, { name: '序号', value: 'A002' }]],
      [3, 1, [{ name: '编码', value: 'CL3' }, { name: '颜色', value: '黑' }, { name: '序号', value: 'A003' }]],
    ]);
    expect(labels[0]?.content).toBe('编码：CL1\n颜色：红\n序号：A001');
  });

  // 缺字段的行照样打（这一项空着），只是标黄提醒。
  test('flags an empty mapped cell but still prints the row', () => {
    const { labels, problems } = okPlan(planLabels({ table: TABLE, plan: plan(), fields: PICKED }));
    expect(labels).toHaveLength(3);
    expect(problems).toEqual([{ row: 2, texts: ['缺：颜色'] }]);
  });

  test('numbers serials in the order of the rows to print', () => {
    const { labels } = okPlan(planLabels({ table: TABLE, plan: plan({ rows: [2, 0] }), fields: PICKED }));
    expect(labels.map((label) => [label.row, label.fields.at(-1)?.value])).toEqual([
      [1, 'A001'],
      [3, 'A002'],
    ]);
  });

  test('uses fixed values and leaves an empty fixed value out without a problem', () => {
    const mapping = { 编码: { kind: 'fixed', value: '固定' }, 颜色: { kind: 'fixed', value: '' } } as const;
    const { labels, problems } = okPlan(planLabels({ table: TABLE, plan: plan({ mapping }), fields: PICKED }));
    expect(labels[0]?.fields).toEqual([
      { name: '编码', value: '固定' },
      { name: '序号', value: 'A001' },
    ]);
    expect(problems).toEqual([]);
  });

  test('prints every non-empty column for templates that show all fields', () => {
    const { labels } = okPlan(planLabels({ table: TABLE, plan: plan({ mapping: {} }), fields: ALL }));
    expect(labels[1]?.fields).toEqual([
      { name: '编码', value: 'CL2' },
      { name: '序号', value: 'A002' },
    ]);
  });

  test('takes copies from a column: blank is one, zero and junk skip the row', () => {
    const { labels, problems } = okPlan(
      planLabels({ table: TABLE, plan: plan({ copies: { kind: 'column', column: '份数' } }), fields: PICKED }),
    );
    expect(labels.map((label) => [label.row, label.copy])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    expect(problems).toContainEqual({
      row: 3,
      texts: [`份数「x」不对：应为 0–${BATCH_LIMITS.copiesPerRow} 的整数，这一行不打`],
    });
  });

  test('takes the serial from a column and flags an empty one', () => {
    const serial = { ...DEFAULT_SERIAL, enabled: true, column: '颜色' };
    const { labels, problems } = okPlan(planLabels({ table: TABLE, plan: plan({ serial }), fields: PICKED }));
    expect(labels[0]?.fields.at(-1)).toEqual({ name: '序号', value: '红' });
    expect(problems).toEqual([{ row: 2, texts: ['缺：颜色', '序号为空'] }]);
  });

  test('prints N serial-only labels without a table', () => {
    const serialOnly = plan({ data: { kind: 'serial-only', count: 3 }, mapping: {} });
    const { labels } = okPlan(planLabels({ table: null, plan: serialOnly, fields: PICKED }));
    expect(labels.map((label) => label.fields)).toEqual([
      [{ name: '序号', value: 'A001' }],
      [{ name: '序号', value: 'A002' }],
      [{ name: '序号', value: 'A003' }],
    ]);
  });

  test('refuses more labels than one batch may hold', () => {
    const rowsNeeded = BATCH_LIMITS.labels / BATCH_LIMITS.copiesPerRow + 1;
    const big: BatchTable = { ...TABLE, rows: Array.from({ length: rowsNeeded }, (_, i) => [`CL${i}`, '红', '1']) };
    const copies = { kind: 'fixed', count: BATCH_LIMITS.copiesPerRow } as const;
    expect(planLabels({ table: big, plan: plan({ copies }), fields: PICKED })).toEqual({
      ok: false,
      issue: `一批最多 ${BATCH_LIMITS.labels} 张：请减少份数或分几批打`,
    });
  });
});

describe('labelForRow', () => {
  test('numbers a row after the selected rows before it, selected or not', () => {
    const input = { table: TABLE, plan: plan({ rows: [0, 2] }), fields: PICKED };
    expect(labelForRow(input, 2)?.fields.at(-1)?.value).toBe('A002');
    expect(labelForRow(input, 1)?.fields.at(-1)?.value).toBe('A002');
    expect(labelForRow(input, 3)).toBeNull();
  });
});
```

```ts
// src/core/batch/parse-batch-plan.test.ts
import { describe, expect, test } from 'bun:test';
import { BATCH_LIMITS, type BatchPlan, DEFAULT_COPIES, DEFAULT_SERIAL } from './batch-model';
import { parseBatchPlan } from './parse-batch-plan';

const VALID: BatchPlan = {
  templateId: 'custom:tag',
  data: { kind: 'table', tableId: '00000000-0000-4000-8000-000000000001' },
  mapping: { 编码: { kind: 'column', column: '编码' }, 备注: { kind: 'fixed', value: '' }, 尺码: { kind: 'none' } },
  serial: { ...DEFAULT_SERIAL, enabled: true, digits: 3, column: null },
  copies: DEFAULT_COPIES,
  rows: [0, 2],
};

describe('parseBatchPlan', () => {
  test('accepts a well-formed plan', () => {
    expect(parseBatchPlan(structuredClone(VALID))).toEqual(VALID);
    expect(parseBatchPlan({ ...VALID, data: { kind: 'serial-only', count: 5 }, rows: null })).toMatchObject({
      data: { kind: 'serial-only', count: 5 },
      rows: null,
    });
  });

  test.each([
    ['template id', { templateId: 'evil' }],
    ['table id', { data: { kind: 'table', tableId: 'x' } }],
    ['serial-only count', { data: { kind: 'serial-only', count: BATCH_LIMITS.serialOnlyCount + 1 } }],
    ['mapping key', { mapping: { ['x'.repeat(21)]: { kind: 'none' } } }],
    ['mapping source', { mapping: { 编码: { kind: 'column', column: '' } } }],
    ['serial digits', { serial: { ...VALID.serial, digits: BATCH_LIMITS.serialDigits + 1 } }],
    ['serial step', { serial: { ...VALID.serial, step: 0 } }],
    ['copies', { copies: { kind: 'fixed', count: 0 } }],
    ['rows', { rows: [BATCH_LIMITS.rows] }],
    ['rows type', { rows: 'all' }],
  ])('rejects a bad %s', (_name, patch) => {
    expect(parseBatchPlan({ ...VALID, ...patch })).toBeNull();
  });

  test('rejects anything that is not an object', () => {
    expect(parseBatchPlan(null)).toBeNull();
    expect(parseBatchPlan([VALID])).toBeNull();
  });

  // 结构化克隆过来的对象可以带名为 __proto__ 的自有键：只当普通变量名，不能改到原型。
  test('keeps a __proto__ variable as a plain own key', () => {
    const mapping: unknown = JSON.parse('{"__proto__":{"kind":"none"}}');
    const parsed = parseBatchPlan({ ...VALID, mapping });
    expect(parsed === null ? null : Object.getPrototypeOf(parsed.mapping)).toBe(Object.prototype);
    expect(parsed === null ? false : Object.hasOwn(parsed.mapping, '__proto__')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/batch`
Expected: FAIL，`Cannot find module './batch-labels'`。

- [ ] **Step 3: 实现**

```ts
// src/core/batch/batch-labels.ts
import { contentOf } from '../api/api-model';
import type { TemplateFields } from '../api/template-fields';
import type { ScanField } from '../scan/scan-result';
import {
  BATCH_LIMITS,
  type BatchLabel,
  type BatchPlan,
  type BatchTable,
  type RowProblem,
  SERIAL_FIELD,
  sourceOf,
} from './batch-model';
import { mappableVariables } from './column-mapping';
import { serialText } from './serial';

export interface LabelPlanInput {
  /** 只按序号打时为 null。 */
  table: BatchTable | null;
  plan: BatchPlan;
  /** 模板用到的字段（templateFields）：决定要对哪些变量、是不是每一列都印。 */
  fields: TemplateFields;
}

export type LabelPlan =
  | { ok: true; labels: BatchLabel[]; problems: RowProblem[]; rowCount: number }
  | { ok: false; issue: string };

/** 一共几行：表格的数据行数，或只按序号打的张数。 */
export function rowCountOf(input: LabelPlanInput): number {
  return input.plan.data.kind === 'serial-only' ? input.plan.data.count : (input.table?.rows.length ?? 0);
}

/** 要打的行（0 起，按表格顺序、不重复、在范围内）。 */
export function selectedRows(plan: BatchPlan, rowCount: number): number[] {
  if (plan.rows === null) {
    return Array.from({ length: rowCount }, (_, index) => index);
  }
  return [...new Set(plan.rows)].filter((index) => index >= 0 && index < rowCount).sort((a, b) => a - b);
}

/**
 * 按设置把要打的行展开成一张张标签（每行按份数重复），同时列出有问题的行。
 * 序号按要打的行的顺序数（第一行要打的是起始值），同一行的几份序号相同。
 */
export function planLabels(input: LabelPlanInput): LabelPlan {
  const labels: BatchLabel[] = [];
  const problems: RowProblem[] = [];
  const rowCount = rowCountOf(input);
  for (const [position, index] of selectedRows(input.plan, rowCount).entries()) {
    const row = buildRow(input, index, position);
    if (row.problems.length > 0) {
      problems.push({ row: index + 1, texts: row.problems });
    }
    for (let copy = 1; copy <= row.copies; copy += 1) {
      if (labels.length >= BATCH_LIMITS.labels) {
        return { ok: false, issue: `一批最多 ${BATCH_LIMITS.labels} 张：请减少份数或分几批打` };
      }
      labels.push({ row: index + 1, copy, fields: row.fields, content: row.content });
    }
  }
  return { ok: true, labels, problems, rowCount };
}

/** 某一行（勾没勾都行）打出来的第一份：预览用。序号按它前面要打的行数算，和真正打的时候一样。 */
export function labelForRow(input: LabelPlanInput, index: number): BatchLabel | null {
  const rowCount = rowCountOf(input);
  if (!Number.isInteger(index) || index < 0 || index >= rowCount) {
    return null;
  }
  const position = selectedRows(input.plan, rowCount).filter((selected) => selected < index).length;
  const row = buildRow(input, index, position);
  return { row: index + 1, copy: 1, fields: row.fields, content: row.content };
}

interface BuiltRow {
  fields: ScanField[];
  content: string;
  copies: number;
  problems: string[];
}

function buildRow({ table, plan, fields: templateFields }: LabelPlanInput, index: number, position: number): BuiltRow {
  const columns = table?.columns ?? [];
  const cells = table?.rows[index] ?? [];
  /** 这一行某一列的值；这张表里没有这一列时为 null。 */
  const cell = (column: string): string | null => {
    const at = columns.indexOf(column);
    return at < 0 ? null : (cells[at] ?? '');
  };
  const fields: ScanField[] = [];
  const put = (name: string, value: string) => {
    const existing = fields.find((field) => field.name === name);
    if (existing) {
      existing.value = value;
    } else {
      fields.push({ name, value });
    }
  };
  // 「显示全部字段」的模板：每一列都是一个字段（列名就是字段名），和扫码识别出的字段一样逐行印出；空格子不印。
  if (templateFields.mode === 'ALL') {
    for (const [at, column] of columns.entries()) {
      const value = cells[at] ?? '';
      if (value.trim() !== '') {
        put(column, value);
      }
    }
  }
  const problems: string[] = [];
  const missing: string[] = [];
  for (const variable of mappableVariables(templateFields)) {
    const source = sourceOf(plan.mapping, variable);
    if (source.kind === 'fixed' && source.value !== '') {
      put(variable, source.value);
    }
    if (source.kind !== 'column') {
      continue;
    }
    const value = cell(source.column);
    // 对的列不在这张表里：对列那里已经标红，不逐行重复说。
    if (value === null) {
      continue;
    }
    if (value.trim() === '') {
      missing.push(variable);
    } else {
      put(variable, value);
    }
  }
  if (missing.length > 0) {
    problems.push(`缺：${missing.join('、')}`);
  }
  if (plan.serial.enabled) {
    const serial = plan.serial.column === null ? serialText(plan.serial, position) : (cell(plan.serial.column) ?? '');
    if (serial.trim() === '') {
      problems.push('序号为空');
    } else {
      put(SERIAL_FIELD, serial);
    }
  }
  const copies = copiesOf(plan, cell, problems);
  return { fields, content: contentOf({ fields, content: null }), copies, problems };
}

function copiesOf(plan: BatchPlan, cell: (column: string) => string | null, problems: string[]): number {
  if (plan.copies.kind === 'fixed') {
    return plan.copies.count;
  }
  const text = (cell(plan.copies.column) ?? '').trim();
  // 份数列空着按 1 份：表格里常常只给要多打的行填份数。
  if (text === '') {
    return 1;
  }
  const count = Number(text);
  if (!Number.isInteger(count) || count < 0 || count > BATCH_LIMITS.copiesPerRow) {
    problems.push(`份数「${text.slice(0, 10)}」不对：应为 0–${BATCH_LIMITS.copiesPerRow} 的整数，这一行不打`);
    return 0;
  }
  if (count === 0) {
    problems.push('份数为 0，这一行不打');
  }
  return count;
}
```

```ts
// src/core/batch/parse-batch-plan.ts
import { TEMPLATE_ID_PATTERN } from '../templates/template-model';
import {
  BATCH_LIMITS,
  type BatchData,
  type BatchPlan,
  type CopiesSettings,
  type FieldSource,
  type SerialSettings,
  TABLE_ID_PATTERN,
  VARIABLE_NAME_MAX_LENGTH,
} from './batch-model';

type Loose = Record<string, unknown>;

/**
 * 渲染进程交来的批量打印设置：逐项核对类型和范围，有一项不对就整个不收（返回 null，由 IPC 报错）。
 * 渲染进程不可信（Chromium 的 IPC 信任边界）：这里不纠正、不兜底，界面自己负责交合法的设置。
 */
export function parseBatchPlan(value: unknown): BatchPlan | null {
  const plan = asObject(value);
  if (plan === null) {
    return null;
  }
  const templateId = plan['templateId'];
  const data = parseData(plan['data']);
  const mapping = parseMapping(plan['mapping']);
  const serial = parseSerial(plan['serial']);
  const copies = parseCopies(plan['copies']);
  const rows = parseRows(plan['rows']);
  if (
    typeof templateId !== 'string' ||
    !TEMPLATE_ID_PATTERN.test(templateId) ||
    data === null ||
    mapping === null ||
    serial === null ||
    copies === null ||
    rows === undefined
  ) {
    return null;
  }
  return { templateId, data, mapping, serial, copies, rows };
}

function asObject(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null;
}

function isText(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isColumnName(value: unknown): value is string {
  return isText(value, 1, BATCH_LIMITS.columnNameLength);
}

function parseData(value: unknown): BatchData | null {
  const data = asObject(value);
  if (data === null) {
    return null;
  }
  const kind = data['kind'];
  const tableId = data['tableId'];
  const count = data['count'];
  if (kind === 'table' && typeof tableId === 'string' && TABLE_ID_PATTERN.test(tableId)) {
    return { kind: 'table', tableId };
  }
  if (kind === 'serial-only' && isInteger(count, 1, BATCH_LIMITS.serialOnlyCount)) {
    return { kind: 'serial-only', count };
  }
  return null;
}

function parseMapping(value: unknown): Record<string, FieldSource> | null {
  const mapping = asObject(value);
  if (mapping === null) {
    return null;
  }
  const entries = Object.entries(mapping);
  if (entries.length > BATCH_LIMITS.variables) {
    return null;
  }
  const parsed: [string, FieldSource][] = [];
  for (const [name, source] of entries) {
    const field = parseSource(source);
    if (!isText(name, 1, VARIABLE_NAME_MAX_LENGTH) || field === null) {
      return null;
    }
    parsed.push([name, field]);
  }
  // fromEntries 按「定义自己的属性」写入：名为 __proto__ 的变量也只是一个普通的键。
  return Object.fromEntries(parsed);
}

function parseSource(value: unknown): FieldSource | null {
  const source = asObject(value);
  if (source === null) {
    return null;
  }
  const kind = source['kind'];
  const column = source['column'];
  const fixed = source['value'];
  if (kind === 'none') {
    return { kind: 'none' };
  }
  if (kind === 'column' && isColumnName(column)) {
    return { kind: 'column', column };
  }
  if (kind === 'fixed' && isText(fixed, 0, BATCH_LIMITS.fixedValueLength)) {
    return { kind: 'fixed', value: fixed };
  }
  return null;
}

function parseSerial(value: unknown): SerialSettings | null {
  const serial = asObject(value);
  if (serial === null) {
    return null;
  }
  const { enabled, prefix, start, step, digits, suffix, column } = serial;
  if (
    typeof enabled !== 'boolean' ||
    !isText(prefix, 0, BATCH_LIMITS.serialAffixLength) ||
    !isText(suffix, 0, BATCH_LIMITS.serialAffixLength) ||
    !isInteger(start, 0, BATCH_LIMITS.serialStart) ||
    !isInteger(step, 1, BATCH_LIMITS.serialStep) ||
    !isInteger(digits, 0, BATCH_LIMITS.serialDigits)
  ) {
    return null;
  }
  if (column !== null && !isColumnName(column)) {
    return null;
  }
  return { enabled, prefix, start, step, digits, suffix, column };
}

function parseCopies(value: unknown): CopiesSettings | null {
  const copies = asObject(value);
  if (copies === null) {
    return null;
  }
  const kind = copies['kind'];
  const count = copies['count'];
  const column = copies['column'];
  if (kind === 'fixed' && isInteger(count, 1, BATCH_LIMITS.copiesPerRow)) {
    return { kind: 'fixed', count };
  }
  if (kind === 'column' && isColumnName(column)) {
    return { kind: 'column', column };
  }
  return null;
}

/** null = 全部行；数组 = 勾选的行；undefined = 不合法。 */
function parseRows(value: unknown): number[] | null | undefined {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length > BATCH_LIMITS.rows) {
    return undefined;
  }
  const rows: number[] = [];
  for (const row of value) {
    if (!isInteger(row, 0, BATCH_LIMITS.rows - 1)) {
      return undefined;
    }
    rows.push(row);
  }
  return rows;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/batch`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/batch
git commit -m "feat(batch): expand rows into labels and validate batch plans" -m "Rows become labels with fields, serials and copies, and rows with empty mapped cells or bad copy counts are reported so the page can highlight them. The plan from the renderer is parsed strictly: the IPC is a trust boundary." -m "$TRAILER"
```

---

### Task 5: 批次运行器 BatchRun

按顺序一张一张打（等上一张进了打印队列再交下一张：顺序有保证，暂停、取消在两张之间生效）。打印机不能用（没有分配打印机、找不到、缺纸离线）时自动暂停，这一张不算打过，继续时重打它；其他失败（驱动报错、超时）记下来、接着打。

**Files:**
- Create: `src/core/batch/batch-runner.ts`、`src/core/batch/batch-runner.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/core/batch/batch-runner.test.ts
import { describe, expect, test } from 'bun:test';
import type { PrintResult } from '../types';
import type { BatchLabel } from './batch-model';
import { type BatchProgress, BatchRun } from './batch-runner';

const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'batch', ruleName: '批量打印', fields: [] },
};
const NOT_READY: PrintResult = { status: 'failed', reason: 'PRINTER_NOT_READY' };

function labels(count: number): BatchLabel[] {
  return Array.from({ length: count }, (_, index) => ({ row: index + 1, copy: 1, fields: [], content: `${index}` }));
}

/** 等排在后面的微任务和定时器都跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 每张都等测试放行：pending 里是每张的放行函数，按顺序。 */
function gatedRun(count: number) {
  const printed: number[] = [];
  const pending: ((result: PrintResult) => void)[] = [];
  const changes: BatchProgress[] = [];
  const run = new BatchRun('20261002-143501-a1b2', labels(count), {
    print: (label) =>
      new Promise((resolve) => {
        printed.push(label.row);
        pending.push(resolve);
      }),
    onChange: (progress) => changes.push(progress),
  });
  const release = async (result: PrintResult = PRINTED) => {
    pending.shift()?.(result);
    await settle();
  };
  return { run, printed, changes, release, finished: run.run() };
}

describe('BatchRun', () => {
  test('prints every label in order and ends as done', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    await settle();
    await release();
    await release();
    await release();
    await finished;
    expect(printed).toEqual([1, 2, 3]);
    expect(run.snapshot()).toMatchObject({ state: 'done', total: 3, sent: 3, failed: 0 });
  });

  test('records other failures and keeps going', async () => {
    const { run, release, finished } = gatedRun(2);
    await settle();
    await release({ status: 'failed', reason: 'PRINT_ERROR' });
    await release();
    await finished;
    expect(run.snapshot()).toMatchObject({
      state: 'done',
      sent: 1,
      failed: 1,
      failures: [{ row: 1, copy: 1, reason: 'PRINT_ERROR' }],
    });
  });

  // 已经交给打印队列的那一张收不回来：暂停在它打完之后生效。
  test('pauses after the label in flight and resumes with the next one', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    await settle();
    run.pause();
    await release();
    expect(printed).toEqual([1]);
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'operator', sent: 1 });
    run.resume();
    await settle();
    expect(printed).toEqual([1, 2]);
    await release();
    await release();
    await finished;
    expect(run.snapshot().state).toBe('done');
  });

  test('cancels after the label in flight and prints nothing more', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    await settle();
    run.cancel();
    await release();
    await finished;
    expect(printed).toEqual([1]);
    expect(run.snapshot()).toMatchObject({ state: 'canceled', sent: 1 });
  });

  test('cancels while paused', async () => {
    const { run, release, finished } = gatedRun(3);
    await settle();
    run.pause();
    await release();
    run.cancel();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'canceled', sent: 1 });
  });

  // 缺纸时后面的每一张都会失败：停下来等人处理，这一张继续时重打，不记成失败。
  test('pauses itself when the printer cannot print and retries that label on resume', async () => {
    const { run, printed, release, finished } = gatedRun(2);
    await settle();
    await release(NOT_READY);
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'PRINTER_NOT_READY', sent: 0, failed: 0 });
    run.resume();
    await settle();
    expect(printed).toEqual([1, 1]);
    await release();
    await release();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'done', sent: 2, failed: 0 });
  });

  test('pauses itself when the paper has no printer', async () => {
    const { run, release } = gatedRun(1);
    await settle();
    await release({ status: 'no-printer', paperKey: '60x40', missingPrinter: null });
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'no-printer' });
  });

  test('counts an unexpected error as a driver error and reports every change', async () => {
    const changes: BatchProgress[] = [];
    const run = new BatchRun('20261002-143501-a1b2', labels(1), {
      print: async () => {
        throw new Error('boom');
      },
      onChange: (progress) => changes.push(progress),
    });
    await run.run();
    expect(run.snapshot()).toMatchObject({ state: 'done', failed: 1, failures: [{ row: 1, reason: 'PRINT_ERROR' }] });
    // 开始一次、这一张打完一次、结束一次。
    expect(changes.map((change) => change.state)).toEqual(['running', 'running', 'done']);
    expect(run.pendingLabels).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/batch/batch-runner.test.ts`
Expected: FAIL，`Cannot find module './batch-runner'`。

- [ ] **Step 3: 实现**

```ts
// src/core/batch/batch-runner.ts
import type { PrintFailureReason, PrintResult } from '../types';
import type { BatchLabel } from './batch-model';

export type BatchState = 'running' | 'paused' | 'done' | 'canceled';

/** 为什么暂停：operator = 操作员点的；其余是打印机的问题（那一张没打成，继续时重打它）。 */
export type BatchPauseReason = 'operator' | 'no-printer' | 'PRINTER_NOT_READY' | 'PRINTER_NOT_FOUND';

export interface BatchFailure {
  row: number;
  copy: number;
  reason: PrintFailureReason;
}

/** 一批的进度：已发送 = 驱动收下了（进了打印队列），不等于已出纸。 */
export interface BatchProgress {
  batchId: string;
  state: BatchState;
  total: number;
  sent: number;
  failed: number;
  pauseReason: BatchPauseReason | null;
  failures: BatchFailure[];
}

export interface BatchRunDeps {
  /** 打一张：经 PrintService.printFields（来源 batch），等它进了打印队列或失败才返回。 */
  print: (label: BatchLabel) => Promise<PrintResult>;
  /** 每打完一张、每次状态变化都调用；实现不能抛错。 */
  onChange: (progress: BatchProgress) => void;
}

/**
 * 一批标签：按顺序一张一张打，上一张进了打印队列才交下一张。这样出纸顺序和表格一致，
 * 暂停、取消在两张之间生效（已经交出去的那一张收不回来）。
 * 打印机不能用时自动暂停，这一张不前进：缺纸时后面每一张都会失败，停下来等人处理比刷出几千条失败记录好。
 */
export class BatchRun {
  private state: BatchState = 'running';
  private next = 0;
  private sent = 0;
  private readonly failures: BatchFailure[] = [];
  private pauseReason: BatchPauseReason | null = null;
  private wake: (() => void) | null = null;

  constructor(
    readonly batchId: string,
    private readonly labels: readonly BatchLabel[],
    private readonly deps: BatchRunDeps,
  ) {}

  /** 还在打或暂停中。 */
  get isActive(): boolean {
    return this.state === 'running' || this.state === 'paused';
  }

  /** 还没打的张数（关到托盘后的静默更新要等它为 0）。 */
  get pendingLabels(): number {
    return this.isActive ? this.labels.length - this.next : 0;
  }

  /** 从第一张打到最后一张（或被取消）；只调用一次。 */
  async run(): Promise<void> {
    this.deps.onChange(this.snapshot());
    for (;;) {
      const label = this.labels[this.next];
      if (label === undefined || this.is('canceled')) {
        break;
      }
      if (this.is('paused')) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      const result = await this.print(label);
      const problem = printerProblem(result);
      if (problem !== null) {
        if (!this.is('canceled')) {
          this.setState('paused', problem);
        }
        continue;
      }
      if (result.status === 'failed') {
        this.failures.push({ row: label.row, copy: label.copy, reason: result.reason });
      } else {
        this.sent += 1;
      }
      this.next += 1;
      this.deps.onChange(this.snapshot());
    }
    if (!this.is('canceled')) {
      this.setState('done', null);
    }
  }

  /** 打完正在打的这一张后停下。 */
  pause(): void {
    if (this.is('running')) {
      this.setState('paused', 'operator');
    }
  }

  resume(): void {
    if (this.is('paused')) {
      this.setState('running', null);
      this.wakeUp();
    }
  }

  /** 不再交新的标签；正在打的这一张照常打完。 */
  cancel(): void {
    if (this.isActive) {
      this.setState('canceled', null);
      this.wakeUp();
    }
  }

  snapshot(): BatchProgress {
    return {
      batchId: this.batchId,
      state: this.state,
      total: this.labels.length,
      sent: this.sent,
      failed: this.failures.length,
      pauseReason: this.pauseReason,
      failures: [...this.failures],
    };
  }

  /** 用方法读状态：循环里隔着 await 读 this.state，TypeScript 的收窄会误以为它没变。 */
  private is(state: BatchState): boolean {
    return this.state === state;
  }

  private setState(state: BatchState, reason: BatchPauseReason | null): void {
    this.state = state;
    this.pauseReason = reason;
    this.deps.onChange(this.snapshot());
  }

  private wakeUp(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** printFields 不该抛错；万一抛了，这一张按驱动报错记下，不让整批停在半路。 */
  private async print(label: BatchLabel): Promise<PrintResult> {
    try {
      return await this.deps.print(label);
    } catch (error) {
      console.error(`[BatchRun] row ${label.row} copy ${label.copy} could not be printed`, error);
      return { status: 'failed', reason: 'PRINT_ERROR' };
    }
  }
}

function printerProblem(result: PrintResult): BatchPauseReason | null {
  if (result.status === 'no-printer') {
    return 'no-printer';
  }
  if (result.status === 'failed' && (result.reason === 'PRINTER_NOT_READY' || result.reason === 'PRINTER_NOT_FOUND')) {
    return result.reason;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core/batch/batch-runner.test.ts`
Expected: PASS（8 个用例）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/batch/batch-runner.ts src/core/batch/batch-runner.test.ts
git commit -m "feat(batch): run a batch in order with pause, resume and cancel" -m "Each label is handed to the print queue only after the previous one was accepted, so labels come out in table order and pause or cancel take effect between labels. A printer that cannot print pauses the batch and the label is retried on resume, instead of failing thousands of labels." -m "$TRAILER"
```

---

### Task 6: 打印记录：来源「批量」和批次三列（迁移 6）

`jobs.source` 有 CHECK 约束，加取值要像迁移 3、5 一样重建表（1.0.1 已发布，只能追加）。批量打的记录不参与扫码防重复窗口的恢复：它们没有 `caller`，不排除的话重启后扫到同样内容会被当成重复。

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/testing/in-memory-job-store.ts`
- Modify: `src/main/storage/migrations.ts`、`src/main/storage/database.test.ts`
- Modify: `src/main/storage/sqlite-job-store.ts`、`src/main/storage/sqlite-job-store.test.ts`
- Modify: `src/shared/job-history.ts`
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`（`SOURCE_LABELS` 加 `batch`，否则类型检查不过）

- [ ] **Step 1: 写测试**

`database.test.ts` 末尾加：

```ts
describe('migration 6', () => {
  test('keeps every row and accepts batch jobs with their batch, row and copy', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 5));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, fields, caller) VALUES ('a', 1, 'CL5640', 'P', 'api', 'printed', 0, '[]', 'key:k1')",
    ).run();
    migrate(db);
    expect({ ...db.prepare("SELECT seq, source, caller, batch_id FROM jobs WHERE id = 'a'").get() }).toEqual({
      seq: 1,
      source: 'api',
      caller: 'key:k1',
      batch_id: null,
    });
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, batch_id, batch_row, batch_copy) VALUES ('b', 2, 'CL5887', 'P', 'batch', 'printed', 0, '20261002-143501-a1b2', 3, 1)",
    ).run();
    expect(db.prepare("SELECT seq FROM jobs WHERE id = 'b'").get()?.['seq']).toBe(2);
    const hits = db.prepare('SELECT rowid FROM jobs_search WHERE jobs_search MATCH \'"5887"\'').all();
    expect(hits.map((row) => row['rowid'])).toEqual([2]);
    db.close();
  });

  test('refuses a batch id without its row and copy', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, batch_id) VALUES ('c', 3, 'X', 'P', 'batch', 'printed', 0, '20261002-143501-a1b2')",
    );
    expect(() => insert.run()).toThrow();
    db.close();
  });
});
```

`sqlite-job-store.test.ts` 的 `describe('SqliteJobStore')` 里加（文件顶部常量区加 `const BATCH = '20261002-143501-a1b2';`、`const OTHER_BATCH = '20261002-150000-0000';`）：

```ts
  test('keeps the batch of a job and pages through one batch', () => {
    const store = new SqliteJobStore(db, 100);
    store.append(job(1, { source: 'batch', batch: { id: BATCH, row: 1, copy: 1 } }));
    store.append(job(2));
    store.append(job(3, { source: 'batch', batch: { id: BATCH, row: 2, copy: 1 } }));
    store.append(job(4, { source: 'batch', batch: { id: OTHER_BATCH, row: 1, copy: 1 } }));
    const page = store.listPage({ limit: 10, batchId: BATCH });
    expect(ids(page.jobs)).toEqual(['job-3', 'job-1']);
    expect(page.jobs[0]?.batch).toEqual({ id: BATCH, row: 2, copy: 1 });
    expect(ids(store.listPage({ limit: 10, batchId: BATCH, search: 'CL3' }).jobs)).toEqual(['job-3']);
  });

  test('leaves batch prints out of the recent prints', () => {
    const store = new SqliteJobStore(db, 100);
    store.append(job(1, { source: 'batch', batch: { id: BATCH, row: 1, copy: 1 } }));
    expect(store.listLastPrinted(0)).toEqual([]);
  });

  test('lists the latest failed label of each row and copy in a batch', () => {
    const store = new SqliteJobStore(db, 100);
    const label = (row: number, copy: number) => ({ id: BATCH, row, copy });
    const failedAs = { source: 'batch', status: 'failed', failureReason: 'PRINT_ERROR' } as const;
    store.append(job(1, { ...failedAs, batch: label(1, 1) }));
    store.append(job(2, { ...failedAs, batch: label(1, 2) }));
    store.append(job(3, { source: 'batch', batch: label(2, 1) }));
    // 第 1 行第 1 份重打成功了：不再算失败。
    store.append(job(4, { source: 'batch', batch: label(1, 1) }));
    store.append(job(5, { ...failedAs, failureReason: 'PRINT_TIMEOUT', batch: label(3, 1) }));
    expect(ids(store.listBatchFailures(BATCH, null))).toEqual(['job-2', 'job-5']);
    expect(ids(store.listBatchFailures(BATCH, 3))).toEqual(['job-5']);
  });
```

`ipc-validators.test.ts` 的 `requireJobQuery` 用例末尾加两行：

```ts
    expect(requireJobQuery({ limit: 10, batchId: '20261002-143501-a1b2' }).batchId).toBe('20261002-143501-a1b2');
    expect(() => requireJobQuery({ limit: 10, batchId: 'x' })).toThrow('Invalid job query batch');
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/storage src/main/ipc-validators.test.ts`
Expected: FAIL（`batch_id` 列不存在；`listBatchFailures` 不存在；`batchId` 类型错误）。

- [ ] **Step 3: 实现**

`src/core/types.ts`：

```ts
/** desktop = 扫码枪，history = 从打印记录重打，mobile = 手机，api = 本机接口，batch = 批量打印。 */
export const PRINT_SOURCES = ['desktop', 'history', 'mobile', 'api', 'batch'] as const;
```

在 `PrintRequest` 前加：

```ts
/** 批量打印的一张：哪一批、第几行（从 1 数，不含表头）、这一行的第几份。 */
export interface BatchRef {
  id: string;
  row: number;
  copy: number;
}
```

`PrintRequest` 末尾加字段：

```ts
  /** 批量打印的一张（含从打印记录重打批量打的）；其他入口没有。 */
  batch?: BatchRef;
```

`JobRecord` 末尾加字段：

```ts
  /** 批量打印的一张：批次号、行号、份号；其他来源没有。 */
  batch?: BatchRef;
```

`src/core/testing/in-memory-job-store.ts` 的 `listLastPrinted` 条件改为：

```ts
      if (job.status === 'printed' && job.createdAt >= since && job.caller === undefined && job.batch === undefined) {
```

`src/main/storage/migrations.ts`：在第 5 条之后、`];` 之前追加：

```ts
  // 6：来源加 batch（批量打印），新增 batch_id、batch_row、batch_copy（批次号、第几行、第几份）。和第 3、5 条一样重建 jobs 表，
  // 序号和全文索引不变。三列要么都有、要么都没有。按批次翻页和找失败的标签走 jobs_batch 索引。
  `
  CREATE TABLE jobs_new (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    id             TEXT    NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL,
    raw            TEXT    NOT NULL,
    printer_name   TEXT    NOT NULL,
    source         TEXT    NOT NULL CHECK (source IN ('desktop', 'history', 'mobile', 'api', 'batch')),
    status         TEXT    NOT NULL CHECK (status IN ('printed', 'duplicate', 'invalid', 'failed')),
    forced         INTEGER NOT NULL CHECK (forced IN (0, 1)),
    failure_reason TEXT             CHECK (failure_reason IN
      ('PRINTER_NOT_FOUND', 'PRINTER_NOT_READY', 'PRINT_TIMEOUT', 'PRINT_ERROR', 'LOOKUP_FAILED', 'TEXT_NOT_FOUND')),
    paper          TEXT,
    template_id    TEXT,
    fields         TEXT,
    caller         TEXT,
    batch_id       TEXT,
    batch_row      INTEGER,
    batch_copy     INTEGER,
    CHECK ((batch_id IS NULL) = (batch_row IS NULL) AND (batch_id IS NULL) = (batch_copy IS NULL))
  ) STRICT;
  INSERT INTO jobs_new (seq, id, created_at, raw, printer_name, source, status, forced, failure_reason, paper, template_id, fields, caller)
    SELECT seq, id, created_at, raw, printer_name, source, status, forced, failure_reason, paper, template_id, fields, caller FROM jobs;
  INSERT INTO sqlite_sequence (name, seq)
    SELECT 'jobs_new', 0 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'jobs_new');
  UPDATE sqlite_sequence
    SET seq = MAX(seq, IFNULL((SELECT seq FROM sqlite_sequence WHERE name = 'jobs'), 0))
    WHERE name = 'jobs_new';
  DROP TRIGGER jobs_search_insert;
  DROP TRIGGER jobs_search_delete;
  DROP INDEX jobs_printed_at;
  DROP TABLE jobs;
  ALTER TABLE jobs_new RENAME TO jobs;
  CREATE INDEX jobs_printed_at ON jobs (created_at) WHERE status = 'printed';
  CREATE INDEX jobs_batch ON jobs (batch_id, seq) WHERE batch_id IS NOT NULL;
  CREATE TRIGGER jobs_search_insert AFTER INSERT ON jobs BEGIN
    INSERT INTO jobs_search (rowid, raw) VALUES (new.seq, new.raw);
  END;
  CREATE TRIGGER jobs_search_delete AFTER DELETE ON jobs BEGIN
    INSERT INTO jobs_search (jobs_search, rowid, raw) VALUES ('delete', old.seq, old.raw);
  END;
  `,
```

`src/shared/job-history.ts` 的 `JobQuery` 加：

```ts
  /** 只看这一批（批量打印的批次号）。 */
  batchId?: string;
```

`src/main/storage/sqlite-job-store.ts`：

1. `JOB_COLUMNS` 改为：

```ts
const JOB_COLUMNS = `
  jobs.seq, jobs.id, jobs.created_at AS createdAt, jobs.raw, jobs.printer_name AS printerName,
  jobs.source, jobs.status, jobs.forced, jobs.failure_reason AS failureReason, jobs.paper,
  jobs.template_id AS templateId, jobs.fields, jobs.caller,
  jobs.batch_id AS batchId, jobs.batch_row AS batchRow, jobs.batch_copy AS batchCopy`;
```

2. 字段声明里加 `private readonly selectBatchPage: StatementSync;` 和 `private readonly selectBatchFailures: StatementSync;`。

3. 构造函数里 `insertJob` 改为：

```ts
    this.insertJob = db.prepare(`
      INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, failure_reason, paper, template_id, fields, caller,
        batch_id, batch_row, batch_copy)
      VALUES (:id, :createdAt, :raw, :printerName, :source, :status, :forced, :failureReason, :paper, :templateId, :fields, :caller,
        :batchId, :batchRow, :batchCopy)`);
```

在 `selectById` 之后加：

```ts
    // 按批次翻页：搜索只在这一批里用 LIKE（一批最多 2 万张，不需要全文索引）。
    this.selectBatchPage = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE jobs.batch_id = :batchId
        AND (:pattern IS NULL OR jobs.raw LIKE :pattern ESCAPE '\\')
        AND (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    // 每行每份最新的一条是失败的：重打成功过的不再算（重打和原来的记录同一个批次、行号、份号）。
    this.selectBatchFailures = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE jobs.seq IN (
          SELECT MAX(seq) FROM jobs
          WHERE batch_id = :batchId AND (:row IS NULL OR batch_row = :row)
          GROUP BY batch_row, batch_copy)
        AND jobs.status = 'failed'
      ORDER BY jobs.batch_row, jobs.batch_copy`);
```

`selectLastPrinted` 的条件改为 `WHERE status = 'printed' AND created_at >= :since AND caller IS NULL AND batch_id IS NULL`，上面的注释改为「扫码防重复窗口的恢复：只算扫码打的；本机接口、按字段重打（带调用方）和批量打印（带批次号）都不用这个窗口」（写在 `listLastPrinted` 方法的文档注释上）。

4. `append` 的参数对象末尾加：

```ts
        batchId: job.batch?.id ?? null,
        batchRow: job.batch?.row ?? null,
        batchCopy: job.batch?.copy ?? null,
```

5. `listPage` 换成：

```ts
  listPage(query: JobQuery): JobPage {
    const search = query.search?.trim() ?? '';
    const before = query.before ?? null;
    const rows =
      query.batchId === undefined
        ? this.selectRows(search, before, query.limit + 1)
        : this.selectBatchPage.all({
            batchId: query.batchId,
            pattern: search === '' ? null : `%${escapeLike(search)}%`,
            before,
            limit: query.limit + 1,
          });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      jobs: pageRows.map(toJobRecord),
      nextCursor: hasMore && lastRow ? readInteger(lastRow, 'seq') : null,
      total: this.total,
    };
  }

  /** 这一批里（只看某一行时传行号）每行每份最新一次是失败的记录，按行号、份号排：整批重打失败的用它。 */
  listBatchFailures(batchId: string, row: number | null): JobRecord[] {
    return this.selectBatchFailures.all({ batchId, row }).map(toJobRecord);
  }
```

6. `toJobRecord` 在 `caller` 之后加：

```ts
  if (row['batchId'] !== null) {
    job.batch = { id: readString(row, 'batchId'), row: readInteger(row, 'batchRow'), copy: readInteger(row, 'batchCopy') };
  }
```

`src/main/ipc-validators.ts`：顶部 import 加 `import { BATCH_ID_PATTERN } from '../core/batch/batch-model';`；`requireJobQuery` 改为：

```ts
export function requireJobQuery(value: unknown): JobQuery {
  const query = requireRecord(value, 'job query');
  const limit = query['limit'];
  const search = query['search'];
  const before = query['before'];
  const batchId = query['batchId'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_PAGE_SIZE) {
    throw new TypeError('Invalid job query limit');
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > MAX_IPC_STRING_LENGTH)) {
    throw new TypeError('Invalid job query search');
  }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    throw new TypeError('Invalid job query cursor');
  }
  if (batchId !== undefined && (typeof batchId !== 'string' || !BATCH_ID_PATTERN.test(batchId))) {
    throw new TypeError('Invalid job query batch');
  }
  return { limit, search, before, batchId };
}
```

`src/renderer/src/lib/status-text.ts` 的 `SOURCE_LABELS` 加一项 `batch: '批量',`。

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/storage src/main/ipc-validators.test.ts src/core`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/types.ts src/core/testing/in-memory-job-store.ts src/main/storage src/shared/job-history.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/renderer/src/lib/status-text.ts
git commit -m "feat(records): record batch prints with their batch, row and copy" -m "Migration 6 rebuilds jobs (the source CHECK cannot be altered) to add the batch source and three batch columns. Records can be paged by batch, the latest failure of each row and copy can be listed for a reprint, and batch prints stay out of the scan dedup window on restart." -m "$TRAILER"
```

---

### Task 7: PrintService 记下批次；记录重打、预览按原样

**Files:**
- Modify: `src/core/print-service.ts`、`src/core/print-service.test.ts`
- Modify: `src/main/ipc.ts`（`PreviewJob`、`ReprintJob`）
- Modify: `src/renderer/src/lib/reprint.ts`、`reprint.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`、`status-text.test.ts`

- [ ] **Step 1: 写测试**

`print-service.test.ts` 末尾加：

```ts
describe('PrintService.printFields for a batch', () => {
  const fields = [{ name: '编码', value: 'CL1' }];
  const batchInput = {
    template: PICK_TEMPLATE,
    fields,
    content: RAW,
    source: 'batch',
    caller: null,
    printerName: null,
    batch: { id: '20261002-143501-a1b2', row: 3, copy: 2 },
  } as const;

  test('records the batch, row and copy and names batch printing as the rule', async () => {
    const { service, store, recorded } = createHarness();
    expect((await service.printFields(batchInput)).status).toBe('printed');
    expect(store.listRecent(1)[0]).toMatchObject({ source: 'batch', batch: batchInput.batch, fields });
    expect(recorded.at(-1)?.scan).toMatchObject({ ruleId: 'batch', ruleName: '批量打印' });
  });

  // 批量打的内容和扫码一样时，重启后扫码不能被当成重复。
  test('stays out of the scan dedup window after a restart', async () => {
    const { service } = createHarness();
    await service.printFields(batchInput);
    service.restore();
    expect((await service.submit(request())).status).toBe('printed');
  });
});
```

（`request()` 是文件里现成的扫码请求工厂，内容是 `RAW`；如果它的名字不同，用文件里构造 `{ raw: RAW, source: 'desktop' }` 的那个。）

`reprint.test.ts` 加：

```ts
  // 批量打的记录没有识别规则可用，和本机接口一样按当时的模板和字段。
  test('uses the stored template and fields for batch jobs', () => {
    const batchJob: JobRecord = {
      ...API_JOB,
      source: 'batch',
      batch: { id: '20261002-143501-a1b2', row: 1, copy: 1 },
    };
    expect(reprintMode(batchJob, allTemplates)).toBe('stored');
    expect(reprintMode({ ...batchJob, source: 'history' }, allTemplates)).toBe('stored');
  });
```

`status-text.test.ts` 的 `describe('describeJobMeta')` 加：

```ts
  test('shows the row and copy of a batch job', () => {
    const batchJob = { ...job, source: 'batch' as const, printerName: 'P', forced: false };
    expect(describeJobMeta({ ...batchJob, batch: { id: '20261002-143501-a1b2', row: 3, copy: 2 } })).toContain(
      '批量（第 3 行第 2 份）',
    );
    expect(describeJobMeta({ ...batchJob, batch: { id: '20261002-143501-a1b2', row: 3, copy: 1 } })).toContain(
      '批量（第 3 行）',
    );
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/core/print-service.test.ts src/renderer/src/lib/reprint.test.ts src/renderer/src/lib/status-text.test.ts`
Expected: FAIL（`batch` 不是 `FieldsPrint` 的字段；记录里没有 batch；reprint 是 rescan）。

- [ ] **Step 3: 实现**

`src/core/print-service.ts`：

1. import 里加 `BatchRef`：`import type { BatchRef, Clock, JobRecord, ... } from './types';`（按字母顺序放）。
2. `API_RULE` 之后加：

```ts
/** 批量打印的「规则」：备注变量 {规则} 和打印结果通知里显示为「批量打印」。 */
export const BATCH_RULE = { id: 'batch', name: '批量打印' } as const;

/** 不经过识别规则的一张算在哪条「规则」名下。 */
export interface FieldsRule {
  id: string;
  name: string;
}
```

3. `fieldsScan` 改为：

```ts
/** 不经过识别规则的一张的识别结果（预览按记录重打时也用它，和打印时一致）。 */
export function fieldsScan(content: string, fields: ScanField[], rule: FieldsRule = API_RULE): ScanResult {
  return { raw: content, ruleId: rule.id, ruleName: rule.name, fields };
}
```

4. `FieldsPrint` 末尾加：

```ts
  /** 批量打印的一张（含从打印记录重打批量打的）：写进打印记录；规则名记为「批量打印」。 */
  batch?: BatchRef;
```

5. `printFields` 改为：

```ts
  async printFields(input: FieldsPrint): Promise<PrintResult> {
    const scan = fieldsScan(input.content, input.fields, input.batch === undefined ? API_RULE : BATCH_RULE);
    const request: PrintRequest = { raw: input.content, source: input.source };
    if (input.caller !== null) {
      request.caller = input.caller;
    }
    if (input.batch !== undefined) {
      request.batch = input.batch;
    }
    return this.printLabel(this.deps.createId(), request, scan, () => input.template, {
      dedup: false,
      enrich: false,
      printerName: input.printerName,
    });
  }
```

6. `finish` 里 `caller` 之后加：

```ts
    if (request.batch !== undefined) {
      job.batch = request.batch;
    }
```

`src/main/ipc.ts`：import 改为 `import { API_RULE, BATCH_RULE, fieldsScan, type PrintService } from '../core/print-service';`；`PreviewJob` 里 `scan: fieldsScan(job.raw, fields),` 改为 `scan: fieldsScan(job.raw, fields, job.batch === undefined ? API_RULE : BATCH_RULE),`；`ReprintJob` 的 `printFields` 参数对象末尾加 `...(job.batch === undefined ? {} : { batch: job.batch }),`，上面加注释「批量打的重打后还算这一批的这一行这一份：整批重打失败的时，重打成功的不再算失败」。

`src/renderer/src/lib/reprint.ts`：

```ts
/**
 * 本机接口打的记录都带调用方，批量打的都带批次；从它们重打出来的那一张来源是「记录重打」，也带着调用方或批次，
 * 同样按字段重打。hasTemplate 查模板是否还在：删掉了就不能按原样重打。
 */
export function reprintMode(job: JobRecord, hasTemplate: (templateId: string) => boolean): ReprintMode {
  if (job.status === 'invalid') {
    return 'unavailable';
  }
  if (job.source !== 'api' && job.source !== 'batch' && job.caller === undefined && job.batch === undefined) {
    return 'rescan';
  }
  return job.templateId !== undefined && job.fields !== undefined && hasTemplate(job.templateId)
    ? 'stored'
    : 'unavailable';
}
```

（同时把文件顶部类型说明里 `stored：本机接口来的` 改为 `stored：本机接口、批量打印来的`。）

`src/renderer/src/lib/status-text.ts` 的 `describeJobMeta` 改为：

```ts
export function describeJobMeta(job: JobRecord, caller: string | null = null): string {
  const paper = job.paper === undefined ? null : parsePaperKey(job.paper);
  const source = describeSource(job.source);
  const submitter = job.source === 'history' ? `原提交：${caller}` : caller;
  const position =
    job.batch === undefined ? '' : `（第 ${job.batch.row} 行${job.batch.copy > 1 ? `第 ${job.batch.copy} 份` : ''}）`;
  return [
    formatDateTime(job.createdAt),
    caller === null ? `${source}${position}` : `${source}（${submitter}）`,
    job.printerName === '' ? null : job.printerName,
    paper === null ? '—' : formatPaperName(paper),
  ]
    .filter((part) => part !== null)
    .join(' · ');
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/core src/renderer/src/lib`
Expected: PASS。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/core/print-service.ts src/core/print-service.test.ts src/main/ipc.ts src/renderer/src/lib/reprint.ts src/renderer/src/lib/reprint.test.ts src/renderer/src/lib/status-text.ts src/renderer/src/lib/status-text.test.ts
git commit -m "feat(print): carry the batch through printFields and record reprints" -m "Batch labels are recorded with their batch, row and copy and show 批量打印 as the rule. Reprinting a batch record keeps its batch so a successful reprint clears that label from the batch's failures, and batch records preview and reprint with their stored fields." -m "$TRAILER"
```

---

### Task 8: 读表格的字节 → 行（子进程里跑的那部分）

**Files:**
- Create: `src/main/batch/table-file.ts`、`src/main/batch/table-file.test.ts`
- Create: `src/main/batch/testing/minimal-xlsx.ts`

- [ ] **Step 1: 写测试用的最小 xlsx 生成器**

```ts
// src/main/batch/testing/minimal-xlsx.ts
/**
 * 测试用：生成只有一个工作表的最小 .xlsx（ZIP 不压缩）。看起来是数字的格子写成数字单元格，其余写成共享字符串，
 * 覆盖 Excel 文件最常见的两种单元格。真实文件由 Excel 生成，这里只用来走通读取路径，不追求完整。
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01：ZIP 的 DOS 日期从 1980 年起，取最早的那天。 */
const DOS_DATE_1980 = 0x21;
const ZIP_VERSION = 20;

function zipStore(files: ReadonlyArray<{ name: string; text: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, ZIP_VERSION, true);
    lv.setUint16(12, DOS_DATE_1980, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, ZIP_VERSION, true);
    cv.setUint16(6, ZIP_VERSION, true);
    cv.setUint16(14, DOS_DATE_1980, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, central) => sum + central.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...centrals, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 第 index 列（从 0 数）的列名：A、B……Z、AA。 */
function columnName(index: number): string {
  let name = '';
  let rest = index + 1;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** 一个工作表的 .xlsx 文件内容；rows[0] 一般是表头。 */
export function minimalXlsx(rows: readonly (readonly string[])[]): Uint8Array {
  const strings: string[] = [];
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      if (NUMBER_PATTERN.test(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    });
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipStore([
    {
      name: '[Content_Types].xml',
      text: `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      text: `${header}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `${header}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `${header}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: `${header}<styleSheet xmlns="${MAIN_NS}"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      text: `${header}<sst xmlns="${MAIN_NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('')}</sst>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: `${header}<worksheet xmlns="${MAIN_NS}"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
    },
  ]);
}
```

- [ ] **Step 2: 写测试**

```ts
// src/main/batch/table-file.test.ts
import { describe, expect, test } from 'bun:test';
import { readSheet } from 'read-excel-file/node';
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import { cellText, readTableBytes, tableFileKind, XLS_ISSUE } from './table-file';
import { minimalXlsx } from './testing/minimal-xlsx';

const OLE_HEADER = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const encode = (text: string) => new TextEncoder().encode(text);
const sheetReader = (bytes: Buffer) => readSheet(bytes);

describe('tableFileKind', () => {
  test('accepts .xlsx (a zip) and .csv', () => {
    expect(tableFileKind('货号.XLSX', minimalXlsx([['a']]))).toEqual({ ok: true, kind: 'xlsx' });
    expect(tableFileKind('rows.csv', encode('a\n1'))).toEqual({ ok: true, kind: 'csv' });
  });

  // .xls 是 97-2003 的复合文档格式，read-excel-file 读不了；改了扩展名的也按文件头认出来。
  test('refuses .xls, also when it was renamed', () => {
    expect(tableFileKind('old.xls', OLE_HEADER)).toEqual({ ok: false, issue: XLS_ISSUE });
    expect(tableFileKind('renamed.xlsx', OLE_HEADER)).toEqual({ ok: false, issue: XLS_ISSUE });
  });

  test('explains a broken .xlsx and an unsupported type', () => {
    expect(tableFileKind('broken.xlsx', encode('not a zip'))).toMatchObject({ ok: false });
    expect(tableFileKind('notes.txt', encode('a'))).toEqual({ ok: false, issue: '只能导入 .xlsx 或 .csv 文件' });
  });
});

describe('cellText', () => {
  test('turns Excel values into the text people see', () => {
    expect(cellText('CL1')).toBe('CL1');
    expect(cellText(6901234567890)).toBe('6901234567890');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(null)).toBe('');
    // read-excel-file 把日期格子解成 UTC 零点：按 UTC 取年月日，西边的时区不会差一天。
    expect(cellText(new Date(Date.UTC(2026, 9, 2)))).toBe('2026-10-02');
    expect(cellText(new Date(Date.UTC(2026, 9, 2, 14, 5)))).toBe('2026-10-02 14:05');
  });
});

describe('readTableBytes', () => {
  test('reads the first sheet of an xlsx file as text, without trailing empty cells', async () => {
    const bytes = minimalXlsx([
      ['编码', '数量', ''],
      ['CL1', '2', ''],
    ]);
    expect(await readTableBytes({ kind: 'xlsx', bytes }, sheetReader)).toEqual({
      ok: true,
      records: [
        ['编码', '数量'],
        ['CL1', '2'],
      ],
    });
  });

  test('reads a GBK csv saved by Chinese Excel', async () => {
    // 「编码,货架\nCL1,A」的 GBK 编码。
    const gbk = new Uint8Array([0xb1, 0xe0, 0xc2, 0xeb, 0x2c, 0xbb, 0xf5, 0xbc, 0xdc, 0x0a, 0x43, 0x4c, 0x31, 0x2c, 0x41]);
    expect(await readTableBytes({ kind: 'csv', bytes: gbk }, sheetReader)).toEqual({
      ok: true,
      records: [
        ['编码', '货架'],
        ['CL1', 'A'],
      ],
    });
  });

  test('stops at the row limit before handing anything back', async () => {
    const text = `编码\n${'x\n'.repeat(BATCH_LIMITS.rows + 1)}`;
    expect(await readTableBytes({ kind: 'csv', bytes: encode(text) }, sheetReader)).toMatchObject({
      ok: false,
      issue: expect.stringContaining(`最多 ${BATCH_LIMITS.rows} 行`),
    });
  });

  test('explains a file the library cannot read, with the library error as detail', async () => {
    const result = await readTableBytes({ kind: 'xlsx', bytes: encode('PK\u0003\u0004 broken') }, sheetReader);
    expect(result).toMatchObject({ ok: false, issue: expect.stringContaining('读不出这个文件') });
    expect(result.ok ? '' : (result.detail ?? '')).not.toBe('');
  });

  test('rejects a malformed request', async () => {
    expect(await readTableBytes({ kind: 'pdf' }, sheetReader)).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/batch/table-file.test.ts`
Expected: FAIL，`Cannot find module './table-file'`。

- [ ] **Step 4: 实现**

```ts
// src/main/batch/table-file.ts
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import { splitCsvRecords, totalCharsIssue } from '../../core/lookup/csv';
import { decodeCsvBytes } from '../../core/lookup/decode-text';

/**
 * 读表格：认文件类型（主进程）、把字节读成一行行文字（子进程，见 reader-worker.ts）。
 * 不 import electron：读取逻辑用 bun test 直接测，子进程入口只是把它接到 parentPort 上。
 */

export type TableFileKind = 'xlsx' | 'csv';

/** 交给子进程的：文件类型和全部字节（不给路径：子进程只读这一份内容）。 */
export interface TableReadRequest {
  kind: TableFileKind;
  bytes: Uint8Array;
}

/** 子进程的回复：每行是文字的数组（还没认表头）；读不了时给中文原因，detail 是库的原始错误（写日志，不给用户看）。 */
export type TableReadReply = { ok: true; records: string[][] } | { ok: false; issue: string; detail?: string };

/** 读 .xlsx 第一个工作表的函数（read-excel-file 的 readSheet；测试里也用真的）。 */
export type SheetReader = (bytes: Buffer) => Promise<readonly (readonly unknown[])[]>;

export const XLS_ISSUE = '不支持 .xls（Excel 97-2003）格式：请在 Excel 里「另存为」.xlsx 或 CSV 后再导入';
const BROKEN_XLSX_ISSUE = '这个 .xlsx 文件已损坏，或不是 Excel 保存的：请在 Excel 里「另存为」.xlsx 或 CSV 再试';
const UNREADABLE_ISSUE = '读不出这个文件：可能已损坏或有密码保护。可以在 Excel 里「另存为」.xlsx 或 CSV 再试';
const UNSUPPORTED_ISSUE = '只能导入 .xlsx 或 .csv 文件';
/** 97-2003 复合文档（.xls）的文件头。 */
const OLE_MAGIC: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0];
/** ZIP（.xlsx）的文件头。 */
const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/** 按扩展名和文件头认类型：.xls（含改了扩展名的）直接拒绝，说明怎么另存。 */
export function tableFileKind(
  name: string,
  bytes: Uint8Array,
): { ok: true; kind: TableFileKind } | { ok: false; issue: string } {
  const extension = extensionOf(name);
  if (extension === '.xls' || startsWith(bytes, OLE_MAGIC)) {
    return { ok: false, issue: XLS_ISSUE };
  }
  if (extension === '.xlsx') {
    return startsWith(bytes, ZIP_MAGIC) ? { ok: true, kind: 'xlsx' } : { ok: false, issue: BROKEN_XLSX_ISSUE };
  }
  if (extension === '.csv') {
    return { ok: true, kind: 'csv' };
  }
  return { ok: false, issue: UNSUPPORTED_ISSUE };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Excel 的值 → 表格里看到的文字。日期按 UTC 取：read-excel-file 把日期格子解成 UTC 零点的 Date。 */
export function cellText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    const hasTime = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0;
    return hasTime ? `${day} ${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}` : day;
  }
  return '';
}

function isRequest(value: unknown): value is TableReadRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (request['kind'] === 'xlsx' || request['kind'] === 'csv') && request['bytes'] instanceof Uint8Array;
}

/** Excel 的行末常有一串空格子（格式刷过的列）：去掉，免得比表头多。 */
function trimTrailingEmpty(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === '') {
    end -= 1;
  }
  return cells.slice(0, end);
}

/**
 * 在子进程里提前按上限截住：一万行以上、一行一百列以上、总字数超限的文件不用整个传回主进程。
 * 表头、重复列名这些规则由主进程的 tableFromRecords 判断（规则只有一份）。
 */
function limitRecords(records: string[][]): TableReadReply {
  const kept = records.filter((record) => record.some((cell) => cell.trim() !== ''));
  if (kept.length > BATCH_LIMITS.rows + 1) {
    return { ok: false, issue: `最多 ${BATCH_LIMITS.rows} 行数据，这个文件有 ${kept.length - 1} 行：请分成几个文件` };
  }
  let chars = 0;
  for (const record of kept) {
    if (record.length > BATCH_LIMITS.columns) {
      return { ok: false, issue: `最多 ${BATCH_LIMITS.columns} 列，这个文件有一行有 ${record.length} 列` };
    }
    for (const cell of record) {
      chars += cell.length;
    }
    if (chars > BATCH_LIMITS.totalChars) {
      return { ok: false, issue: totalCharsIssue(BATCH_LIMITS.totalChars) };
    }
  }
  return { ok: true, records: kept };
}

/** 子进程里读一个文件：xlsx 交给 readSheet（第一个工作表），csv 用自己的解析器（UTF-8 / GBK）。 */
export async function readTableBytes(request: unknown, readSheet: SheetReader): Promise<TableReadReply> {
  if (!isRequest(request)) {
    return { ok: false, issue: UNREADABLE_ISSUE, detail: 'malformed table read request' };
  }
  try {
    if (request.kind === 'csv') {
      const records = splitCsvRecords(decodeCsvBytes(request.bytes), ',');
      return records.ok ? limitRecords(records.rows) : { ok: false, issue: records.issue };
    }
    const sheet = await readSheet(Buffer.from(request.bytes));
    return limitRecords(sheet.map((row) => trimTrailingEmpty(row.map(cellText))));
  } catch (error) {
    return { ok: false, issue: UNREADABLE_ISSUE, detail: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/batch/table-file.test.ts`
Expected: PASS。如果 `readSheet` 读不了 `minimalXlsx` 的输出，先看错误信息：缺了库要求的部件（例如 `docProps/app.xml`）就在生成器里补上，这一步的目标是生成器产出合法的 .xlsx。如果查明是 Bun 运行 read-excel-file 的兼容问题（同一个文件在 Node 里 `node -e` 读得出），把 `reads the first sheet of an xlsx file` 这个用例的 `sheetReader` 换成返回固定二维数组 `[['编码', '数量', null], ['CL1', 2, null]]` 的假 `SheetReader`（仍然测数字转文字、去掉行末空格子），真实的 .xlsx 读取由 Task 16 的 E2E 在 Electron 里覆盖；不要跳过或删掉用例。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/main/batch/table-file.ts src/main/batch/table-file.test.ts src/main/batch/testing/minimal-xlsx.ts
git commit -m "feat(batch): read xlsx and csv bytes into rows, refusing .xls" -m "This is the code the isolated reader process runs. .xls (also renamed) is refused with a hint to save as .xlsx or CSV; Excel values become the text people see, dates in UTC as read-excel-file returns them; size limits are applied before anything is sent back." -m "$TRAILER"
```

---

### Task 9: 读表格的子进程和主进程这一侧

Excel 是外部来的、不可信的输入，解析它的又是第三方库（解压、XML）：按 Chromium 的两条法则放在 Electron `utilityProcess` 里跑。主进程每读一个文件起一个子进程，限时 30 秒、限堆 512MB，只收字符串二维数组，回复的形状和大小再核对一遍；子进程卡住、崩溃、回复不对都按「读不出」处理。

**Files:**
- Create: `src/main/batch/table-reader-host.ts`、`src/main/batch/table-reader-host.test.ts`
- Create: `src/main/batch/reader-worker.ts`

- [ ] **Step 1: 写测试**

```ts
// src/main/batch/table-reader-host.test.ts
import { describe, expect, test } from 'bun:test';
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import type { TableReadRequest } from './table-file';
import { READ_TIMEOUT_ISSUE, READER_FAILED_ISSUE, type ReaderProcess, readReply, TableReaderHost } from './table-reader-host';

const REQUEST: TableReadRequest = { kind: 'csv', bytes: new Uint8Array([0x61]) };
const TIMEOUT_MS = 30_000;

class FakeProcess implements ReaderProcess {
  readonly posted: TableReadRequest[] = [];
  killed = false;
  private messageListener: ((message: unknown) => void) | null = null;
  private exitListener: ((code: number) => void) | null = null;

  postMessage(request: TableReadRequest): void {
    this.posted.push(request);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  onExit(listener: (code: number) => void): void {
    this.exitListener = listener;
  }

  kill(): void {
    this.killed = true;
  }

  reply(message: unknown): void {
    this.messageListener?.(message);
  }

  exit(code: number): void {
    this.exitListener?.(code);
  }
}

function createHost() {
  const child = new FakeProcess();
  const timers: (() => void)[] = [];
  const logs: string[] = [];
  const host = new TableReaderHost({
    fork: () => child,
    timeoutMs: TIMEOUT_MS,
    schedule: (run) => {
      timers.push(run);
      return () => {
        timers.splice(timers.indexOf(run), 1);
      };
    },
    log: (line) => logs.push(line),
  });
  return { host, child, timers, logs };
}

describe('TableReaderHost', () => {
  test('hands the bytes to a new process, returns its rows and ends the process', async () => {
    const { host, child, timers } = createHost();
    const reading = host.read(REQUEST);
    expect(child.posted).toEqual([REQUEST]);
    child.reply({ ok: true, records: [['编码'], ['CL1']] });
    expect(await reading).toEqual({ ok: true, records: [['编码'], ['CL1']] });
    expect(child.killed).toBe(true);
    expect(timers).toEqual([]);
  });

  test('kills a process that does not answer in time', async () => {
    const { host, child, timers, logs } = createHost();
    const reading = host.read(REQUEST);
    timers[0]?.();
    expect(await reading).toEqual({ ok: false, issue: READ_TIMEOUT_ISSUE });
    expect(child.killed).toBe(true);
    expect(logs.join('\n')).toContain('timed out');
  });

  // 堆超了 512MB 时 V8 直接结束子进程：不会有回复，只有退出。
  test('reports a process that died without answering', async () => {
    const { host, child, logs } = createHost();
    const reading = host.read(REQUEST);
    child.exit(134);
    expect(await reading).toEqual({ ok: false, issue: READER_FAILED_ISSUE });
    expect(logs.join('\n')).toContain('exited with code 134');
  });

  test('passes on the reason a file was refused and logs the library error', async () => {
    const { host, child, logs } = createHost();
    const reading = host.read(REQUEST);
    child.reply({ ok: false, issue: '读不出这个文件', detail: 'bad zip' });
    expect(await reading).toEqual({ ok: false, issue: '读不出这个文件' });
    expect(logs.join('\n')).toContain('bad zip');
  });
});

describe('readReply', () => {
  test('refuses replies with the wrong shape or beyond the limits', () => {
    expect(readReply({ ok: true, records: [[1]] }).ok).toBe(false);
    expect(readReply({ ok: true, records: 'x' }).ok).toBe(false);
    expect(readReply({ ok: true, records: [Array(BATCH_LIMITS.columns + 1).fill('')] }).ok).toBe(false);
    expect(readReply('x').ok).toBe(false);
    expect(readReply({ ok: false, issue: 'x'.repeat(1_000) })).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/batch/table-reader-host.test.ts`
Expected: FAIL，`Cannot find module './table-reader-host'`。

- [ ] **Step 3: 实现**

```ts
// src/main/batch/table-reader-host.ts
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import type { TableReadReply, TableReadRequest } from './table-file';

/** 读表格的子进程：index.ts 用 utilityProcess.fork 实现，测试里换成假的。 */
export interface ReaderProcess {
  postMessage(request: TableReadRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface TableReaderHostDeps {
  fork: () => ReaderProcess;
  timeoutMs: number;
  schedule: (run: () => void, delayMs: number) => () => void;
  log: (line: string) => void;
}

export const READ_TIMEOUT_ISSUE = '读表格超时：文件太大或已损坏。可以在 Excel 里「另存为」CSV 再试';
export const READER_FAILED_ISSUE = '读表格时出错：文件太大或已损坏。可以在 Excel 里「另存为」CSV 再试';
/** 子进程给的原因的长度上限：只显示一句话，更长的说明子进程出了问题。 */
const MAX_ISSUE_LENGTH = 200;

/**
 * 每读一个文件起一个子进程（Chromium 两条法则：不可信的输入 + 第三方解析库，不放在高权限的主进程里）。
 * 读完、超时、出错都结束它，不复用：坏文件把子进程弄坏了也不影响下一次。
 */
export class TableReaderHost {
  constructor(private readonly deps: TableReaderHostDeps) {}

  read(request: TableReadRequest): Promise<TableReadReply> {
    return new Promise((resolve) => {
      let isSettled = false;
      let child: ReaderProcess | null = null;
      let cancelTimer: () => void = () => undefined;
      const finish = (reply: TableReadReply) => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        cancelTimer();
        child?.kill();
        resolve(reply);
      };
      cancelTimer = this.deps.schedule(() => {
        this.deps.log(`[batch] table reader timed out after ${this.deps.timeoutMs}ms`);
        finish({ ok: false, issue: READ_TIMEOUT_ISSUE });
      }, this.deps.timeoutMs);
      try {
        child = this.deps.fork();
      } catch (error) {
        this.deps.log(`[batch] cannot start the table reader: ${String(error)}`);
        finish({ ok: false, issue: READER_FAILED_ISSUE });
        return;
      }
      child.onMessage((message) => {
        const reply = readReply(message);
        if (!reply.ok && reply.detail !== undefined) {
          this.deps.log(`[batch] table reader refused the file: ${reply.detail}`);
        }
        finish(reply.ok ? reply : { ok: false, issue: reply.issue });
      });
      child.onExit((code) => {
        if (!isSettled) {
          this.deps.log(`[batch] table reader exited with code ${code} before answering`);
        }
        finish({ ok: false, issue: READER_FAILED_ISSUE });
      });
      child.postMessage(request);
    });
  }
}

/** 子进程的回复也不全信：形状、类型、行数、列数、总字数都再核对一遍，不对就按读不出处理。 */
export function readReply(message: unknown): TableReadReply {
  if (typeof message !== 'object' || message === null) {
    return { ok: false, issue: READER_FAILED_ISSUE, detail: 'reply is not an object' };
  }
  const reply = message as Record<string, unknown>;
  const issue = reply['issue'];
  const detail = reply['detail'];
  if (reply['ok'] === false && typeof issue === 'string' && issue.length <= MAX_ISSUE_LENGTH) {
    return typeof detail === 'string' ? { ok: false, issue, detail } : { ok: false, issue };
  }
  const records = reply['records'];
  if (reply['ok'] !== true || !Array.isArray(records) || records.length > BATCH_LIMITS.rows + 1) {
    return { ok: false, issue: READER_FAILED_ISSUE, detail: 'reply has no valid records' };
  }
  let chars = 0;
  for (const record of records) {
    if (!Array.isArray(record) || record.length > BATCH_LIMITS.columns) {
      return { ok: false, issue: READER_FAILED_ISSUE, detail: 'record is not a bounded array' };
    }
    for (const cell of record) {
      if (typeof cell !== 'string') {
        return { ok: false, issue: READER_FAILED_ISSUE, detail: 'cell is not text' };
      }
      chars += cell.length;
    }
    if (chars > BATCH_LIMITS.totalChars) {
      return { ok: false, issue: READER_FAILED_ISSUE, detail: 'records exceed the size limit' };
    }
  }
  return { ok: true, records: records as string[][] };
}
```

```ts
// src/main/batch/reader-worker.ts
import { readSheet } from 'read-excel-file/node';
import { readTableBytes } from './table-file';

/**
 * 读表格的子进程（Electron utilityProcess）入口，由 index.ts 按 `?modulePath` 打包、fork。
 * 收一条消息（文件类型 + 字节）、回一条消息（文字的二维数组或原因），之后由主进程结束这个进程。
 * readTableBytes 不会抛错：库的错误放在回复的 detail 里，由主进程写日志（子进程的 console 不进日志文件）。
 */
process.parentPort.once('message', (event) => {
  void readTableBytes(event.data, (bytes) => readSheet(bytes)).then((reply) => process.parentPort.postMessage(reply));
});
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/main/batch`
Expected: PASS。`bun run typecheck` 也要过（`process.parentPort` 的类型来自 electron 的全局声明；如果主进程的 tsconfig 里看不到，就在 `reader-worker.ts` 顶部加 `import type {} from 'electron';` 把声明带进来）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/main/batch/table-reader-host.ts src/main/batch/table-reader-host.test.ts src/main/batch/reader-worker.ts
git commit -m "feat(batch): parse spreadsheets in an isolated utility process" -m "Spreadsheets are untrusted and parsed by a third-party library, so each file is read in its own utility process with a timeout and a heap cap. The main process only accepts arrays of strings and checks their shape and size again; hangs and crashes become a Chinese hint." -m "$TRAILER"
```

---

### Task 10: BatchStation（主进程的批量打印）

**Files:**
- Create: `src/shared/batch.ts`
- Create: `src/main/batch/batch-station.ts`、`src/main/batch/batch-station.test.ts`

- [ ] **Step 1: IPC 用的类型**

```ts
// src/shared/batch.ts
import type { BatchTable, RowProblem } from '../core/batch/batch-model';
import type { BatchProgress } from '../core/batch/batch-runner';
import type { PaperSize } from './paper-sizes';
import type { RenderWarnings } from './render-warnings';

/** 导入表格的结果（选文件、拖进窗口、粘贴）。 */
export type BatchTableResult =
  | { status: 'loaded'; table: BatchTable }
  | { status: 'canceled' }
  | { status: 'invalid'; issue: string };

/** 一行打出来的样子：和实际打印同一份 HTML。 */
export interface BatchRowPreview {
  html: string;
  warnings: RenderWarnings;
  paper: PaperSize;
}

export type BatchPreviewResult = { status: 'ok'; preview: BatchRowPreview } | { status: 'invalid'; issue: string };

/** 把每一行排一遍才看得出的问题（条码不合码制、二维码放不下、文字被截断）。 */
export interface BatchCheckResult {
  problems: RowProblem[];
}

/** 界面看到的一批的进度：失败只带前 BATCH_STATUS_FAILURES 条。 */
export interface BatchStatus extends BatchProgress {
  templateName: string;
}

export type BatchStartResult = { status: 'started'; batch: BatchStatus } | { status: 'invalid'; issue: string };

/** 状态里最多带几条失败：界面逐行列出、可以单独重打；更多的从打印记录按批次「重打失败的」。 */
export const BATCH_STATUS_FAILURES = 200;
```

- [ ] **Step 2: 写测试**

```ts
// src/main/batch/batch-station.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BatchPlan, DEFAULT_COPIES, DEFAULT_SERIAL } from '../../core/batch/batch-model';
import type { FieldsPrint } from '../../core/print-service';
import { CANVAS_TAG } from '../../core/templates/builtin-canvas';
import type { JobRecord, PrintResult } from '../../core/types';
import type { BatchStatus } from '../../shared/batch';
import { DEFAULT_PAPER } from '../../shared/label-paper';
import { NO_RENDER_WARNINGS } from '../../shared/render-warnings';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { BatchStation, type BatchStationDeps } from './batch-station';
import { XLS_ISSUE } from './table-file';
import { minimalXlsx } from './testing/minimal-xlsx';

const BATCH_ID = '20261002-143501-a1b2';
const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'batch', ruleName: '批量打印', fields: [] },
};

function createStation(overrides: Partial<BatchStationDeps> = {}) {
  const printed: FieldsPrint[] = [];
  const statuses: (BatchStatus | null)[] = [];
  const scheduled: (() => void)[] = [];
  let tables = 0;
  const deps: BatchStationDeps = {
    readTable: async () => ({
      ok: true,
      records: [
        ['编码', '颜色'],
        ['CL1', '红'],
        ['BAD', ''],
      ],
    }),
    findTemplate: (id) => (id === CANVAS_TAG.id ? CANVAS_TAG : null),
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    dpiFor: async () => 203,
    render: (_template, label) => ({
      html: `<p>${label.content}</p>`,
      warnings: label.fields.some((field) => field.value === 'BAD')
        ? { ...NO_RENDER_WARNINGS, issues: ['条码「商品码」不印：位数不对'] }
        : NO_RENDER_WARNINGS,
      paper: DEFAULT_PAPER,
    }),
    failedJobs: () => [],
    createTableId: () => `00000000-0000-4000-8000-00000000000${++tables}`,
    createBatchId: () => BATCH_ID,
    schedule: (run) => {
      scheduled.push(run);
      return () => {
        scheduled.splice(scheduled.indexOf(run), 1);
      };
    },
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    ...overrides,
  };
  return { station: new BatchStation(deps), printed, statuses, scheduled };
}

function planFor(tableId: string, overrides: Partial<BatchPlan> = {}): BatchPlan {
  return {
    templateId: CANVAS_TAG.id,
    data: { kind: 'table', tableId },
    mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '颜色' } },
    serial: DEFAULT_SERIAL,
    copies: DEFAULT_COPIES,
    rows: null,
    ...overrides,
  };
}

async function loaded(station: BatchStation): Promise<string> {
  const result = await station.loadBytes('rows.csv', new TextEncoder().encode('ignored by the fake reader'));
  if (result.status !== 'loaded') {
    throw new Error(`table not loaded: ${JSON.stringify(result)}`);
  }
  return result.table.id;
}

describe('BatchStation tables', () => {
  test('reads a file through the reader and keeps the table', async () => {
    const { station } = createStation();
    expect(await station.loadBytes('rows.csv', new Uint8Array([0x61]))).toEqual({
      status: 'loaded',
      table: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'rows.csv',
        columns: ['编码', '颜色'],
        rows: [
          ['CL1', '红'],
          ['BAD', ''],
        ],
      },
    });
  });

  test('refuses .xls before starting a reader', async () => {
    let reads = 0;
    const { station } = createStation({
      readTable: async () => {
        reads += 1;
        return { ok: true, records: [] };
      },
    });
    expect(await station.loadBytes('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({
      status: 'invalid',
      issue: XLS_ISSUE,
    });
    expect(reads).toBe(0);
  });

  test('checks the header of what the reader returns', async () => {
    const { station } = createStation({ readTable: async () => ({ ok: true, records: [['编码', '编码']] }) });
    expect(await station.loadBytes('rows.csv', new Uint8Array([0x61]))).toEqual({
      status: 'invalid',
      issue: '列名重复：「编码」',
    });
  });

  test('parses a table pasted from Excel', () => {
    const { station } = createStation();
    expect(station.paste('编码\t颜色\nCL9\t灰\n')).toMatchObject({
      status: 'loaded',
      table: { name: '粘贴的数据', columns: ['编码', '颜色'], rows: [['CL9', '灰']] },
    });
  });

  describe('from a path', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await createTempDir('labelflash-batch-');
    });

    afterEach(async () => {
      await removeTempDir(dir);
    });

    test('reads the file at the path with its name', async () => {
      const { station } = createStation({ readTable: async (request) => ({ ok: true, records: [['种类'], [request.kind]] }) });
      const path = join(dir, '货号.xlsx');
      await writeFile(path, minimalXlsx([['a']]));
      expect(await station.loadPath(path)).toMatchObject({
        status: 'loaded',
        table: { name: '货号.xlsx', rows: [['xlsx']] },
      });
    });
  });
});

describe('BatchStation printing', () => {
  test('prints every label in order with its batch, row and copy', async () => {
    const { station, printed } = createStation();
    const tableId = await loaded(station);
    expect(station.start(planFor(tableId))).toMatchObject({ status: 'started', batch: { batchId: BATCH_ID, total: 2 } });
    await station.whenIdle();
    expect(printed.map((input) => [input.source, input.batch, input.content])).toEqual([
      ['batch', { id: BATCH_ID, row: 1, copy: 1 }, '编码：CL1\n颜色：红'],
      ['batch', { id: BATCH_ID, row: 2, copy: 1 }, '编码：BAD'],
    ]);
    expect(station.status()).toMatchObject({ state: 'done', sent: 2, templateName: CANVAS_TAG.name });
  });

  test('refuses to start a second batch, an unknown table or a deleted template', async () => {
    const { station } = createStation({ printFields: () => new Promise(() => undefined) });
    const tableId = await loaded(station);
    expect(station.start(planFor('00000000-0000-4000-8000-000000000009'))).toEqual({
      status: 'invalid',
      issue: '表格已经换过了：请重新导入',
    });
    expect(station.start({ ...planFor(tableId), templateId: 'custom:gone' })).toEqual({
      status: 'invalid',
      issue: '模板已经不在了：请重新选择模板',
    });
    expect(station.start(planFor(tableId)).status).toBe('started');
    expect(station.start(planFor(tableId))).toEqual({ status: 'invalid', issue: '上一批还没打完：等它打完，或者先取消' });
    expect(station.pendingLabels).toBe(2);
  });

  // 每张都推会让界面一直重排：进度合并推送，状态变化（开始、暂停、打完）立即推。
  test('sends state changes at once and merges progress', async () => {
    const { station, statuses, scheduled } = createStation();
    const tableId = await loaded(station);
    station.start(planFor(tableId));
    await station.whenIdle();
    expect(statuses.map((status) => status?.state)).toEqual(['running', 'done']);
    expect(scheduled).toEqual([]);
  });

  test('retries the failed labels of a batch with their stored fields', async () => {
    const failed: JobRecord = {
      id: 'j1',
      createdAt: 1,
      raw: '编码：CL7',
      printerName: 'P',
      source: 'batch',
      status: 'failed',
      forced: false,
      failureReason: 'PRINT_ERROR',
      templateId: CANVAS_TAG.id,
      fields: [{ name: '编码', value: 'CL7' }],
      batch: { id: BATCH_ID, row: 7, copy: 2 },
    };
    const { station, printed } = createStation({ failedJobs: (batchId, row) => (batchId === BATCH_ID && row === null ? [failed] : []) });
    expect(station.retryFailed(BATCH_ID, null).status).toBe('started');
    await station.whenIdle();
    expect(printed.map((input) => [input.batch, input.content, input.fields])).toEqual([
      [{ id: BATCH_ID, row: 7, copy: 2 }, '编码：CL7', [{ name: '编码', value: 'CL7' }]],
    ]);
    expect(station.retryFailed(BATCH_ID, 3)).toEqual({ status: 'invalid', issue: '这一批没有要重打的失败标签' });
  });
});

describe('BatchStation preview and check', () => {
  test('previews one row as it will print', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    const serial = { ...DEFAULT_SERIAL, enabled: true, digits: 2 };
    expect(await station.preview(planFor(tableId, { serial }), 1)).toMatchObject({
      status: 'ok',
      preview: { html: '<p>编码：BAD\n序号：02</p>' },
    });
  });

  test('lists the rows whose label cannot be printed in full', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    expect(await station.check(planFor(tableId))).toEqual({
      problems: [{ row: 2, texts: ['条码「商品码」不印：位数不对'] }],
    });
  });

  test('gives up an older check when a newer one starts', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    const older = station.check(planFor(tableId));
    const newer = station.check(planFor(tableId));
    expect(await older).toBeNull();
    expect(await newer).not.toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试看它失败**

Run: `bun test src/main/batch/batch-station.test.ts`
Expected: FAIL，`Cannot find module './batch-station'`。

- [ ] **Step 4: 实现**

```ts
// src/main/batch/batch-station.ts
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { templateFields } from '../../core/api/template-fields';
import { type LabelPlanInput, labelForRow, planLabels } from '../../core/batch/batch-labels';
import {
  BATCH_LIMITS,
  type BatchLabel,
  type BatchPlan,
  type BatchTable,
  FILE_TOO_LARGE_ISSUE,
  type RowProblem,
} from '../../core/batch/batch-model';
import { type BatchProgress, BatchRun, type BatchState } from '../../core/batch/batch-runner';
import { splitCsvRecords, tableFromRecords } from '../../core/lookup/csv';
import type { FieldsPrint } from '../../core/print-service';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { JobRecord, PrintResult } from '../../core/types';
import {
  BATCH_STATUS_FAILURES,
  type BatchCheckResult,
  type BatchPreviewResult,
  type BatchRowPreview,
  type BatchStartResult,
  type BatchStatus,
  type BatchTableResult,
} from '../../shared/batch';
import { renderWarningTexts } from '../../shared/render-warnings';
import { type TableReadReply, type TableReadRequest, tableFileKind } from './table-file';

/** 进度推给界面的最短间隔：每秒一两张时每张都推会让界面一直重排；状态变化（开始、暂停、打完）立即推。 */
const PROGRESS_INTERVAL_MS = 250;
/** 检查全部标签时每排这么多张让出一次主线程：一万张要排好几秒，期间打印和 IPC 照常响应。 */
const CHECK_CHUNK_LABELS = 20;
const PASTED_TABLE_NAME = '粘贴的数据';
/** 表格名（文件名）只用来显示：截到 100 个字符。 */
const MAX_TABLE_NAME_LENGTH = 100;
const TABLE_GONE = '表格已经换过了：请重新导入';
const TEMPLATE_GONE = '模板已经不在了：请重新选择模板';
const BUSY = '上一批还没打完：等它打完，或者先取消';
const NOTHING_TO_PRINT = '没有要打的标签：勾选要打的行，或检查份数';
const NO_FAILURES = '这一批没有要重打的失败标签';
const RETRY_TEMPLATE_GONE = '这一批用的模板已经删掉了，不能按原样重打';

export interface BatchStationDeps {
  /** 在子进程里读表格（TableReaderHost）。 */
  readTable: (request: TableReadRequest) => Promise<TableReadReply>;
  /** 按编号精确找模板（不退回别的模板）。 */
  findTemplate: (id: string) => LabelTemplate | null;
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 这个模板要打到的打印机的分辨率（预览、检查和实际打印一致）。 */
  dpiFor: (template: LabelTemplate) => Promise<number>;
  /** 排一张标签：和实际打印同一份 HTML（renderLabelHtml）。 */
  render: (template: LabelTemplate, label: BatchLabel, dpi: number) => BatchRowPreview;
  /** 打印记录里这一批（只看某一行时传行号）每行每份最新一次失败的记录。 */
  failedJobs: (batchId: string, row: number | null) => JobRecord[];
  createTableId: () => string;
  createBatchId: () => string;
  schedule: (run: () => void, delayMs: number) => () => void;
  /** 进度推给界面（合并推送）。 */
  onStatus: (status: BatchStatus | null) => void;
  /** 写了打印记录：界面刷新打印记录（和进度一起合并推送）。 */
  onJobsChanged: () => void;
}

interface CurrentBatch {
  run: BatchRun;
  templateName: string;
  finished: Promise<void>;
}

type Prepared = { ok: true; template: LabelTemplate; input: LabelPlanInput } | { ok: false; issue: string };

/**
 * 主进程的批量打印：读表格（子进程）、保存最近一张表、按界面交来的设置预览和检查、开打和重打失败的。
 * 同一时间只有一批在打；表格只留最近一张（一万行的表不小，换了文件旧的就没用了）。不 import electron。
 */
export class BatchStation {
  private table: BatchTable | null = null;
  private current: CurrentBatch | null = null;
  private lastState: BatchState | null = null;
  private cancelFlush: (() => void) | null = null;
  private checkGeneration = 0;

  constructor(private readonly deps: BatchStationDeps) {}

  /** 还没打的张数（暂停中的也算）：关到托盘后的静默更新要等它为 0。 */
  get pendingLabels(): number {
    return this.current?.run.pendingLabels ?? 0;
  }

  /** 打开对话框选的文件：先看大小再读，超限的不读进内存。 */
  async loadPath(path: string): Promise<BatchTableResult> {
    const { size } = await stat(path);
    if (size > BATCH_LIMITS.fileBytes) {
      return { status: 'invalid', issue: FILE_TOO_LARGE_ISSUE };
    }
    return this.loadBytes(basename(path), await readFile(path));
  }

  /** 拖进窗口的文件（界面读成字节传来）或 loadPath 读到的内容。 */
  async loadBytes(fileName: string, bytes: Uint8Array): Promise<BatchTableResult> {
    if (bytes.length > BATCH_LIMITS.fileBytes) {
      return { status: 'invalid', issue: FILE_TOO_LARGE_ISSUE };
    }
    const kind = tableFileKind(fileName, bytes);
    if (!kind.ok) {
      return { status: 'invalid', issue: kind.issue };
    }
    const reply = await this.deps.readTable({ kind: kind.kind, bytes });
    if (!reply.ok) {
      return { status: 'invalid', issue: reply.issue };
    }
    return this.keep(fileName, reply.records);
  }

  /** 从 Excel 复制、粘贴进来的表格（Tab 分隔）：自己的解析器、TypeScript 内存安全，在主进程里解析。 */
  paste(text: string): BatchTableResult {
    const records = splitCsvRecords(text, '\t');
    return records.ok ? this.keep(PASTED_TABLE_NAME, records.rows) : { status: 'invalid', issue: records.issue };
  }

  async preview(plan: BatchPlan, rowIndex: number): Promise<BatchPreviewResult> {
    const prepared = this.prepare(plan);
    if (!prepared.ok) {
      return { status: 'invalid', issue: prepared.issue };
    }
    const label = labelForRow(prepared.input, rowIndex);
    if (label === null) {
      return { status: 'invalid', issue: '没有这一行' };
    }
    const dpi = await this.deps.dpiFor(prepared.template);
    return { status: 'ok', preview: this.deps.render(prepared.template, label, dpi) };
  }

  /**
   * 把要打的每一行排一遍，列出打不全的行（条码不合码制、二维码放不下、文字截断）。
   * 一万张要排几秒：分段让出主线程；又来了一次检查时放弃这一次（返回 null）。
   */
  async check(plan: BatchPlan): Promise<BatchCheckResult | null> {
    this.checkGeneration += 1;
    const generation = this.checkGeneration;
    const prepared = this.prepare(plan);
    const planned = prepared.ok ? planLabels(prepared.input) : null;
    if (!prepared.ok || planned === null || !planned.ok) {
      return { problems: [] };
    }
    const dpi = await this.deps.dpiFor(prepared.template);
    const problems: RowProblem[] = [];
    // 同一行的几份一模一样：只排第一份。
    for (const [position, label] of planned.labels.filter((item) => item.copy === 1).entries()) {
      if (position % CHECK_CHUNK_LABELS === 0) {
        await yieldToEventLoop();
        if (generation !== this.checkGeneration) {
          return null;
        }
      }
      const texts = renderWarningTexts(this.deps.render(prepared.template, label, dpi).warnings);
      if (texts.length > 0) {
        problems.push({ row: label.row, texts });
      }
    }
    return generation === this.checkGeneration ? { problems } : null;
  }

  start(plan: BatchPlan): BatchStartResult {
    if (this.current?.run.isActive === true) {
      return { status: 'invalid', issue: BUSY };
    }
    const prepared = this.prepare(plan);
    if (!prepared.ok) {
      return { status: 'invalid', issue: prepared.issue };
    }
    const planned = planLabels(prepared.input);
    if (!planned.ok) {
      return { status: 'invalid', issue: planned.issue };
    }
    if (planned.labels.length === 0) {
      return { status: 'invalid', issue: NOTHING_TO_PRINT };
    }
    return this.begin(this.deps.createBatchId(), prepared.template, planned.labels);
  }

  /** 按打印记录重打一批里失败的标签（row 不为 null 时只重打那一行）：同一个批次号、行号、份号，当时的模板和字段。 */
  retryFailed(batchId: string, row: number | null): BatchStartResult {
    if (this.current?.run.isActive === true) {
      return { status: 'invalid', issue: BUSY };
    }
    const jobs = this.deps.failedJobs(batchId, row);
    const labels = jobs.flatMap((job): BatchLabel[] =>
      job.batch !== undefined && job.fields !== undefined
        ? [{ row: job.batch.row, copy: job.batch.copy, fields: job.fields, content: job.raw }]
        : [],
    );
    if (labels.length === 0) {
      return { status: 'invalid', issue: NO_FAILURES };
    }
    const templateId = jobs[0]?.templateId;
    const template = templateId === undefined ? null : this.deps.findTemplate(templateId);
    if (template === null) {
      return { status: 'invalid', issue: RETRY_TEMPLATE_GONE };
    }
    return this.begin(batchId, template, labels);
  }

  pause(): void {
    this.current?.run.pause();
  }

  resume(): void {
    this.current?.run.resume();
  }

  cancel(): void {
    this.current?.run.cancel();
  }

  /** 当前（或最近一次）这一批的进度；还没打过时为 null。 */
  status(): BatchStatus | null {
    if (this.current === null) {
      return null;
    }
    const progress = this.current.run.snapshot();
    return {
      ...progress,
      failures: progress.failures.slice(0, BATCH_STATUS_FAILURES),
      templateName: this.current.templateName,
    };
  }

  /** 测试用：等这一批结束。 */
  whenIdle(): Promise<void> {
    return this.current?.finished ?? Promise.resolve();
  }

  private keep(fileName: string, records: readonly (readonly string[])[]): BatchTableResult {
    const parsed = tableFromRecords(records, BATCH_LIMITS);
    if (!parsed.ok) {
      return { status: 'invalid', issue: parsed.issue };
    }
    const table: BatchTable = {
      id: this.deps.createTableId(),
      name: fileName.slice(0, MAX_TABLE_NAME_LENGTH),
      columns: parsed.table.columns,
      rows: parsed.table.rows,
    };
    this.table = table;
    return { status: 'loaded', table };
  }

  private prepare(plan: BatchPlan): Prepared {
    const template = this.deps.findTemplate(plan.templateId);
    if (template === null) {
      return { ok: false, issue: TEMPLATE_GONE };
    }
    if (plan.data.kind === 'table' && this.table?.id !== plan.data.tableId) {
      return { ok: false, issue: TABLE_GONE };
    }
    const table = plan.data.kind === 'table' ? this.table : null;
    return { ok: true, template, input: { table, plan, fields: templateFields(template) } };
  }

  private begin(batchId: string, template: LabelTemplate, labels: readonly BatchLabel[]): BatchStartResult {
    const run = new BatchRun(batchId, labels, {
      print: (label) =>
        this.deps.printFields({
          template,
          fields: label.fields,
          content: label.content,
          source: 'batch',
          caller: null,
          printerName: null,
          batch: { id: batchId, row: label.row, copy: label.copy },
        }),
      onChange: (progress) => this.changed(progress),
    });
    // 先登记成当前这一批再开跑：run() 一开始就同步报一次 running，那次推送读到的必须是这一批。
    let markFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      markFinished = resolve;
    });
    this.current = { run, templateName: template.name, finished };
    this.lastState = null;
    void run
      .run()
      .catch((error: unknown) => {
        console.error(`[batch] batch ${batchId} stopped unexpectedly`, error);
      })
      .finally(() => markFinished());
    const status = this.status();
    if (status === null) {
      throw new Error(`Batch ${batchId} has no status right after it started`);
    }
    return { status: 'started', batch: status };
  }

  private changed(progress: BatchProgress): void {
    if (progress.state !== this.lastState) {
      this.lastState = progress.state;
      this.flush();
      return;
    }
    this.cancelFlush ??= this.deps.schedule(() => {
      this.cancelFlush = null;
      this.flush();
    }, PROGRESS_INTERVAL_MS);
  }

  private flush(): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.deps.onStatus(this.status());
    this.deps.onJobsChanged();
  }
}
```

推送的顺序：`run()` 开头同步报一次 running（`lastState` 从 null 变成 running → 立即推）；之后每打完一张报一次（状态没变 → 合并，0.25 秒后推）；结束时报 done（状态变了 → 取消合并中的那次、立即推）。所以测试里看到的推送正好是 `['running', 'done']`，排着的合并推送被取消（`scheduled` 为空）。

- [ ] **Step 5: 跑测试**

Run: `bun test src/main/batch`
Expected: PASS。

- [ ] **Step 6: `bun run check` 后提交**

```bash
git add src/shared/batch.ts src/main/batch/batch-station.ts src/main/batch/batch-station.test.ts
git commit -m "feat(batch): batch station that loads tables, previews, checks and prints" -m "The main process keeps the last table it read, previews and checks rows with the same HTML used for printing, runs one batch at a time through printFields and merges progress pushes to at most four a second. Failed labels can be reprinted from the job records with their stored fields." -m "$TRAILER"
```

---

### Task 11: IPC 和接线（子进程、通道、preload）

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc-validators.ts`、`src/main/ipc-validators.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 写测试**（`ipc-validators.test.ts`：import 加 `requireBatchId`、`requireBatchPlan`、`requireBytes`、`requireIndex`，`describe` 里加）

```ts
  test('batch plans, ids, byte arrays and row indexes are checked', () => {
    const plan = {
      templateId: 'builtin:generic',
      data: { kind: 'serial-only', count: 3 },
      mapping: {},
      serial: { enabled: true, prefix: '', start: 1, step: 1, digits: 0, suffix: '', column: null },
      copies: { kind: 'fixed', count: 1 },
      rows: null,
    };
    expect(requireBatchPlan(plan)).toEqual(plan);
    expect(() => requireBatchPlan({ ...plan, templateId: 'x' })).toThrow('Invalid batch plan');
    expect(requireBatchId('20261002-143501-a1b2')).toBe('20261002-143501-a1b2');
    expect(() => requireBatchId('20261002')).toThrow('Invalid batch id');
    expect(requireBytes(new Uint8Array(2), 'file', 2)).toHaveLength(2);
    expect(() => requireBytes(new Uint8Array(3), 'file', 2)).toThrow('Invalid file');
    expect(() => requireBytes('abc', 'file', 2)).toThrow('Invalid file');
    expect(requireIndex(0, 'row index')).toBe(0);
    expect(() => requireIndex(-1, 'row index')).toThrow('Invalid row index');
    expect(() => requireIndex(1.5, 'row index')).toThrow('Invalid row index');
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/main/ipc-validators.test.ts`
Expected: FAIL，四个函数没有导出。

- [ ] **Step 3: 校验函数**（`src/main/ipc-validators.ts`，import 加 `import type { BatchPlan } from '../core/batch/batch-model';` 和 `import { parseBatchPlan } from '../core/batch/parse-batch-plan';`，`BATCH_ID_PATTERN` 在 Task 6 已导入）

```ts
/** 批量打印的设置：逐项核对（见 core/batch/parse-batch-plan.ts）。 */
export function requireBatchPlan(value: unknown): BatchPlan {
  const plan = parseBatchPlan(value);
  if (plan === null) {
    throw new TypeError('Invalid batch plan');
  }
  return plan;
}

export function requireBatchId(value: unknown): string {
  if (typeof value !== 'string' || !BATCH_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid batch id');
  }
  return value;
}

/** 界面读出来的文件字节（拖进窗口的文件）：只收 Uint8Array，长度有上限。 */
export function requireBytes(value: unknown, name: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length > maxBytes) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

/** 从 0 数的下标（行号等）。 */
export function requireIndex(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}
```

- [ ] **Step 4: 通道和 API 类型**（`src/shared/ipc-contract.ts`）

import 加：

```ts
import type { BatchPlan } from '../core/batch/batch-model';
import type {
  BatchCheckResult,
  BatchPreviewResult,
  BatchStartResult,
  BatchStatus,
  BatchTableResult,
} from './batch';
```

`IpcChannel` 的 `AddFirewallRule` 之后加：

```ts
  BatchOpenFile: 'batch:open-file',
  BatchReadDropped: 'batch:read-dropped',
  BatchPaste: 'batch:paste',
  BatchPreview: 'batch:preview',
  BatchCheck: 'batch:check',
  BatchStart: 'batch:start',
  BatchPause: 'batch:pause',
  BatchResume: 'batch:resume',
  BatchCancel: 'batch:cancel',
  BatchRetryFailed: 'batch:retry-failed',
  BatchStatus: 'batch:status',
  BatchStatusChanged: 'batch:status-changed',
```

`LabelFlashApi` 末尾（`addFirewallRule` 之后）加：

```ts
  /** 主进程弹出打开对话框选 .xlsx / .csv，在隔离的子进程里读；.xls 给出另存为的提示。 */
  openBatchFile(): Promise<BatchTableResult>;
  /** 拖进窗口的文件：界面读成字节交来（不传路径），主进程认类型、在子进程里读。 */
  readDroppedBatchFile(name: string, bytes: Uint8Array): Promise<BatchTableResult>;
  /** 粘贴从 Excel 复制的表格（Tab 分隔，第一行是列名）。 */
  pasteBatchTable(text: string): Promise<BatchTableResult>;
  /** 第 rowIndex 行（从 0 数）打出来的样子，序号按勾选的行算。 */
  previewBatchRow(plan: BatchPlan, rowIndex: number): Promise<BatchPreviewResult>;
  /** 把要打的每一行排一遍，列出打不全的行；又开始了一次检查时这一次返回 null。 */
  checkBatch(plan: BatchPlan): Promise<BatchCheckResult | null>;
  startBatch(plan: BatchPlan): Promise<BatchStartResult>;
  /** 打完正在打的这一张后暂停。 */
  pauseBatch(): Promise<void>;
  resumeBatch(): Promise<void>;
  /** 不再交新的标签；正在打的这一张照常打完。 */
  cancelBatch(): Promise<void>;
  /** 按打印记录重打这一批失败的标签；row 不为 null 时只重打那一行（从 1 数）。 */
  retryBatchFailures(batchId: string, row: number | null): Promise<BatchStartResult>;
  getBatchStatus(): Promise<BatchStatus | null>;
  /** 批量打印的进度（合并推送，状态变化立即推）。 */
  onBatchStatus(listener: (status: BatchStatus | null) => void): () => void;
```

- [ ] **Step 5: 主进程处理函数**（`src/main/ipc.ts`）

import 加（按字母顺序放）：

```ts
import { BATCH_LIMITS } from '../core/batch/batch-model';
import type { BatchTableResult } from '../shared/batch';
import type { BatchStation } from './batch/batch-station';
```

`ipc-validators` 的 import 加 `requireBatchId`、`requireBatchPlan`、`requireBytes`、`requireIndex`。

`IpcDeps` 加：

```ts
  /** 批量打印：读表格、预览、检查、开打。 */
  batch: BatchStation;
```

在 `const MAX_JOB_ID_LENGTH = 64;` 之后加：

```ts
/** 拖进来的文件名：Windows 的路径上限是 260，文件名只会更短。 */
const MAX_FILE_NAME_LENGTH = 260;
```

在 `handle(IpcChannel.AddFirewallRule, ...)` 之后加：

```ts
  handle(IpcChannel.BatchOpenFile, async (): Promise<BatchTableResult> => {
    const window = deps.getWindow();
    const options: OpenDialogOptions = {
      title: '导入要批量打印的表格',
      // 列出 .xls：选了它会得到「另存为 .xlsx 或 CSV」的提示，比在对话框里找不到文件更好懂。
      filters: [{ name: 'Excel 或 CSV 表格', extensions: ['xlsx', 'csv', 'xls'] }],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) {
      return { status: 'canceled' };
    }
    return deps.batch.loadPath(path);
  });
  handle(IpcChannel.BatchReadDropped, (name, bytes) =>
    deps.batch.loadBytes(
      requireString(name, 'file name', MAX_FILE_NAME_LENGTH),
      requireBytes(bytes, 'file', BATCH_LIMITS.fileBytes),
    ),
  );
  handle(IpcChannel.BatchPaste, (text) => deps.batch.paste(requireString(text, 'pasted table', BATCH_LIMITS.pasteChars)));
  handle(IpcChannel.BatchPreview, (plan, rowIndex) =>
    deps.batch.preview(requireBatchPlan(plan), requireIndex(rowIndex, 'row index')),
  );
  handle(IpcChannel.BatchCheck, (plan) => deps.batch.check(requireBatchPlan(plan)));
  handle(IpcChannel.BatchStart, (plan) => deps.batch.start(requireBatchPlan(plan)));
  handle(IpcChannel.BatchPause, () => deps.batch.pause());
  handle(IpcChannel.BatchResume, () => deps.batch.resume());
  handle(IpcChannel.BatchCancel, () => deps.batch.cancel());
  handle(IpcChannel.BatchRetryFailed, (batchId, row) =>
    deps.batch.retryFailed(requireBatchId(batchId), row === null ? null : requirePositiveInteger(row, 'row')),
  );
  handle(IpcChannel.BatchStatus, () => deps.batch.status());
```

- [ ] **Step 6: preload**（`src/preload/index.ts` 的 `api` 对象末尾加）

```ts
  openBatchFile: () => ipcRenderer.invoke(IpcChannel.BatchOpenFile),
  readDroppedBatchFile: (name, bytes) => ipcRenderer.invoke(IpcChannel.BatchReadDropped, name, bytes),
  pasteBatchTable: (text) => ipcRenderer.invoke(IpcChannel.BatchPaste, text),
  previewBatchRow: (plan, rowIndex) => ipcRenderer.invoke(IpcChannel.BatchPreview, plan, rowIndex),
  checkBatch: (plan) => ipcRenderer.invoke(IpcChannel.BatchCheck, plan),
  startBatch: (plan) => ipcRenderer.invoke(IpcChannel.BatchStart, plan),
  pauseBatch: () => ipcRenderer.invoke(IpcChannel.BatchPause),
  resumeBatch: () => ipcRenderer.invoke(IpcChannel.BatchResume),
  cancelBatch: () => ipcRenderer.invoke(IpcChannel.BatchCancel),
  retryBatchFailures: (batchId, row) => ipcRenderer.invoke(IpcChannel.BatchRetryFailed, batchId, row),
  getBatchStatus: () => ipcRenderer.invoke(IpcChannel.BatchStatus),
  onBatchStatus: (listener) => subscribe(IpcChannel.BatchStatusChanged, listener),
```

- [ ] **Step 7: 接线**（`src/main/index.ts`）

import 调整（按 Biome 的顺序放）：

```ts
import { app, type BrowserWindow, dialog, Menu, Notification, nativeImage, net, utilityProcess } from 'electron';
import { batchIdFor } from '../core/batch/batch-model';
import { BATCH_RULE, fieldsScan, PrintService } from '../core/print-service';
import { BatchStation } from './batch/batch-station';
import batchReaderPath from './batch/reader-worker?modulePath';
import { TableReaderHost } from './batch/table-reader-host';
import { renderLabelHtml } from './printing/label-html';
import { DEFAULT_PRINTER_DPI } from './printing/qr-code';
```

（第一行替换原来的 electron import，第三行替换原来的 `import { PrintService } from '../core/print-service';`。）

在 `VOICE_CACHE_DIR_NAME` 常量之后加：

```ts
/** 读一个表格最多等这么久：20MB 的 .xlsx 在普通办公电脑上几秒读完，30 秒还没完多半是压缩炸弹或坏文件。 */
const TABLE_READ_TIMEOUT_MS = 30_000;
/** 读表格子进程的堆上限：一万行的表格解开后几十 MB；超过 512MB 只可能是压缩炸弹，V8 结束进程，按「读不出」处理。 */
const TABLE_READER_HEAP_MB = 512;
/** 任务管理器、进程列表里显示的子进程名。 */
const TABLE_READER_SERVICE_NAME = `${BRAND.productNameAscii} table reader`;
```

在 `service.restore();` 之后加：

```ts
  // 批量打印：表格在隔离的子进程里读（不可信的文件 + 第三方解析库，见 batch/table-reader-host.ts）。
  const tableReader = new TableReaderHost({
    fork: () => {
      const child = utilityProcess.fork(batchReaderPath, [], {
        serviceName: TABLE_READER_SERVICE_NAME,
        execArgv: [`--max-old-space-size=${TABLE_READER_HEAP_MB}`],
      });
      return {
        postMessage: (request) => child.postMessage(request),
        onMessage: (listener) => {
          child.on('message', listener);
        },
        onExit: (listener) => {
          child.on('exit', listener);
        },
        kill: () => {
          child.kill();
        },
      };
    },
    timeoutMs: TABLE_READ_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const batch = new BatchStation({
    readTable: (request) => tableReader.read(request),
    findTemplate: (id) => templates.get(id),
    printFields: (input) => service.printFields(input),
    dpiFor: async (template) => {
      const { printerName } = await choosePrinter(template);
      return printerName !== null && (await isInstalled(printerName))
        ? profiles.dpiOf(printerName)
        : DEFAULT_PRINTER_DPI;
    },
    render: (template, label, dpi) => {
      // diagnostics 是条码库的原始英文错误：预览和检查不用（打印时适配器另写日志）。
      const { html, diagnostics: _diagnostics, ...warnings } = renderLabelHtml(
        { scan: fieldsScan(label.content, label.fields, BATCH_RULE), template, printedAt: Date.now() },
        dpi,
      );
      return { html, warnings, paper: template.paper };
    },
    failedJobs: (batchId, row) => jobs.listBatchFailures(batchId, row),
    createTableId: randomUUID,
    createBatchId: () => batchIdFor(new Date(), randomUUID().slice(0, 4)),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    onStatus: (status) => sendToMainWindow(IpcChannel.BatchStatusChanged, status),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
  });
```

`registerIpc({` 的参数里加 `batch,`；`backgroundUpdateTimer` 里 `pendingPrints: printQueue.pending + localApi.pendingJobs,` 改为 `pendingPrints: printQueue.pending + localApi.pendingJobs + batch.pendingLabels,`（注释：「批量打印还有没打的（暂停中的也算）时不静默更新：重启会丢掉这一批剩下的」）。

- [ ] **Step 8: 构建并核对 bundle**

Run: `bun run build && bun run verify:bundle`
Expected: `out/main/` 下除了 `index.js` 还有子进程的文件（electron-vite 5 对 `?modulePath` 默认单独打包，文件名形如 `reader-worker-<hash>.js` 或在子目录里），`verify:bundle` 每个文件都是 `ok`。

如果 `verify:bundle` 报子进程文件引用了 `read-excel-file`、`fflate`、`unzipper-esm` 等包（说明单独打包时没继承 `externalizeDeps: false`），改用显式的第二个入口：

`electron.vite.config.ts` 的 `main.build` 改为：

```ts
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: [...OPTIONAL_NATIVE_MODULES],
        // 读表格的子进程是第二个入口（batch/reader-worker.ts）：和主进程一样把依赖全部打进来。
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'batch-reader': resolve(__dirname, 'src/main/batch/reader-worker.ts'),
        },
        output: { format: 'cjs' },
      },
    },
```

（文件顶部加 `import { resolve } from 'node:path';`），`index.ts` 里删掉 `?modulePath` 的 import，改用 `const batchReaderPath = join(__dirname, 'batch-reader.js');`（`join` 已经导入），再跑一次本步骤。

- [ ] **Step 9: 全部检查**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（现有的 E2E 不受影响；批量打印的 E2E 在 Task 16）。

- [ ] **Step 10: 提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc-validators.ts src/main/ipc-validators.test.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(batch): wire the batch station to IPC and the table reader process" -m "New batch channels expose only what the page needs: open, drop or paste a table, preview a row, check, start, pause, resume, cancel and retry failures. Every argument is validated; dropped files arrive as bytes, never as paths. The reader process is built from its own entry so the bundle stays self-contained." -m "$TRAILER"
```

（如果 Step 8 改了 `electron.vite.config.ts`，一起 `git add`。）

---

### Task 12: 界面的纯逻辑

**Files:**
- Create: `src/renderer/src/lib/batch-view.ts`、`src/renderer/src/lib/batch-view.test.ts`
- Modify: `src/renderer/src/lib/app-view.ts`、`app-view.test.ts`
- Modify: `src/renderer/src/lib/scan-routing.ts`、`scan-routing.test.ts`
- Modify: `src/renderer/src/lib/status-text.ts`（导出 `describeFailureShort`）

- [ ] **Step 1: 写测试**

```ts
// src/renderer/src/lib/batch-view.test.ts
import { describe, expect, test } from 'bun:test';
import type { TemplateFields } from '../../../core/api/template-fields';
import { type BatchTable, DEFAULT_COPIES, DEFAULT_SERIAL } from '../../../core/batch/batch-model';
import type { BatchStatus } from '../../../shared/batch';
import {
  BATCH_ROW_HEIGHT_PX,
  batchButtonProgress,
  buildPlan,
  describeProgress,
  describeSummary,
  describeTable,
  failuresByRow,
  filterRows,
  isSerialEnabled,
  type PlanInput,
  problemsByRow,
  serialExample,
  sourceFromKey,
  sourceKey,
  stepRowIndex,
  toggledSelection,
  visibleRange,
  withRowsChecked,
} from './batch-view';

const TABLE: BatchTable = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'rows.csv',
  columns: ['编码', '颜色'],
  rows: [
    ['CL1', '红'],
    ['CL2', '蓝'],
    ['XY3', '红'],
  ],
};
const PICKED: TemplateFields = { mode: 'PICKED', names: ['编码', '序号'] };
const ALL: TemplateFields = { mode: 'ALL', names: [] };

function status(overrides: Partial<BatchStatus> = {}): BatchStatus {
  return {
    batchId: '20261002-143501-a1b2',
    state: 'running',
    total: 120,
    sent: 35,
    failed: 0,
    pauseReason: null,
    failures: [],
    templateName: '吊牌',
    ...overrides,
  };
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    templateId: 'builtin:canvas-tag',
    fields: PICKED,
    dataKind: 'table',
    table: TABLE,
    serialOnlyCount: 10,
    mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '旧列' } },
    serial: { ...DEFAULT_SERIAL, column: '旧列' },
    wantsSerial: false,
    copies: { kind: 'column', column: '旧列' },
    selected: new Set([2, 0]),
    ...overrides,
  };
}

describe('buildPlan', () => {
  // 换了表格之后，旧表的列名不能交给主进程：主进程严格核对，会把整个设置退回。
  test('drops columns that are not in the current table and sorts the chosen rows', () => {
    expect(buildPlan(input())).toEqual({
      templateId: 'builtin:canvas-tag',
      data: { kind: 'table', tableId: TABLE.id },
      mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'none' } },
      serial: { ...DEFAULT_SERIAL, enabled: true, column: null },
      copies: DEFAULT_COPIES,
      rows: [0, 2],
    });
  });

  test('prints serials only without a table, and nothing before a table is loaded', () => {
    expect(buildPlan(input({ dataKind: 'serial-only' }))).toMatchObject({
      data: { kind: 'serial-only', count: 10 },
      rows: null,
    });
    expect(buildPlan(input({ table: null }))).toBeNull();
  });
});

describe('isSerialEnabled', () => {
  test('follows the template, the switch for all-field templates, and serial-only printing', () => {
    expect(isSerialEnabled(PICKED, false, true)).toBe(true);
    expect(isSerialEnabled({ mode: 'PICKED', names: ['编码'] }, true, true)).toBe(false);
    expect(isSerialEnabled(ALL, false, true)).toBe(false);
    expect(isSerialEnabled(ALL, true, true)).toBe(true);
    expect(isSerialEnabled(ALL, false, false)).toBe(true);
  });
});

describe('rows', () => {
  test('filters rows by any cell, ignoring case', () => {
    expect(filterRows(TABLE, 3, ' xy ')).toEqual([2]);
    expect(filterRows(TABLE, 3, '红')).toEqual([0, 2]);
    expect(filterRows(null, 2, 'x')).toEqual([0, 1]);
  });

  test('draws only the rows in view, with some spare rows around them', () => {
    expect(visibleRange(0, BATCH_ROW_HEIGHT_PX * 10, 1_000)).toEqual({ start: 0, end: 20 });
    expect(visibleRange(BATCH_ROW_HEIGHT_PX * 100, BATCH_ROW_HEIGHT_PX * 10, 1_000)).toEqual({ start: 90, end: 120 });
    expect(visibleRange(0, BATCH_ROW_HEIGHT_PX * 10, 5)).toEqual({ start: 0, end: 5 });
  });

  test('keeps "all rows" as null and switches rows on and off', () => {
    const one = toggledSelection(null, 1, 3);
    expect(one === null ? null : [...one]).toEqual([0, 2]);
    expect(toggledSelection(one, 1, 3)).toBeNull();
    const none = withRowsChecked(null, [0, 1, 2], false, 3);
    expect(none === null ? null : [...none]).toEqual([]);
  });

  test('steps through the rows in view', () => {
    expect(stepRowIndex([0, 2, 5], 2, 1)).toBe(5);
    expect(stepRowIndex([0, 2, 5], 5, 1)).toBe(5);
    expect(stepRowIndex([0, 2, 5], 2, -1)).toBe(0);
    expect(stepRowIndex([0, 2, 5], 3, 1)).toBe(0);
  });
});

describe('texts', () => {
  test('summarizes the table, the selection and the problems', () => {
    expect(describeTable(TABLE)).toBe('rows.csv · 3 行 · 2 列');
    expect(describeTable(null)).toBe('还没有导入数据');
    expect(describeSummary({ rowCount: 120, selectedCount: 118, labelCount: 236, problemRows: 3 })).toBe(
      '共 120 行 · 选中 118 行 · 打 236 张 · 3 行有问题（标黄）',
    );
    expect(describeSummary({ rowCount: 3, selectedCount: 3, labelCount: 3, problemRows: 0 })).toBe('共 3 行 · 打 3 张');
  });

  test('describes the progress of a batch in every state', () => {
    expect(describeProgress(status())).toEqual({ text: '正在打印 · 已发送 35 / 120 张', percent: 29 });
    expect(describeProgress(status({ state: 'paused', pauseReason: 'PRINTER_NOT_READY' })).text).toBe(
      '已暂停（打印机现在不能打印：缺纸、离线或卡纸，处理好后点继续）· 已发送 35 / 120 张',
    );
    expect(describeProgress(status({ state: 'canceled', failed: 2 })).text).toBe('已取消 · 已发送 35 / 120 张 · 失败 2 张');
    expect(describeProgress(status({ state: 'done', sent: 120 })).text).toBe('全部已发送 · 已发送 120 / 120 张');
    expect(describeProgress(status({ state: 'done', sent: 118, failed: 2 })).text).toBe(
      '已结束 · 已发送 118 / 120 张 · 失败 2 张',
    );
  });

  test('shows progress on the title bar button only while a batch runs or waits', () => {
    expect(batchButtonProgress(status({ failed: 1 }))).toBe('36/120');
    expect(batchButtonProgress(status({ state: 'done' }))).toBeNull();
    expect(batchButtonProgress(null)).toBeNull();
  });

  test('shows the first serials as an example', () => {
    expect(serialExample({ ...DEFAULT_SERIAL, prefix: 'A', digits: 3 })).toBe('A001、A002、A003');
  });
});

describe('maps', () => {
  test('merges problems of the same row', () => {
    const merged = problemsByRow([{ row: 2, texts: ['缺：颜色'] }], [{ row: 2, texts: ['条码不印'] }]);
    expect(merged.get(2)).toEqual(['缺：颜色', '条码不印']);
  });

  test('groups failures by row', () => {
    const failures = [
      { row: 3, copy: 1, reason: 'PRINT_ERROR' as const },
      { row: 3, copy: 2, reason: 'PRINT_TIMEOUT' as const },
    ];
    expect(failuresByRow(status({ failures })).get(3)).toHaveLength(2);
    expect(failuresByRow(null).size).toBe(0);
  });

  test('turns mapping choices into option keys and back', () => {
    expect(sourceKey({ kind: 'column', column: '编码' })).toBe('column:编码');
    expect(sourceFromKey('column:编码', { kind: 'none' })).toEqual({ kind: 'column', column: '编码' });
    expect(sourceFromKey('fixed', { kind: 'fixed', value: 'x' })).toEqual({ kind: 'fixed', value: 'x' });
    expect(sourceFromKey('fixed', { kind: 'none' })).toEqual({ kind: 'fixed', value: '' });
    expect(sourceFromKey('none', { kind: 'fixed', value: 'x' })).toEqual({ kind: 'none' });
  });
});
```

`app-view.test.ts` 的 `describe('backStep')` 里加一行（import 加 `BATCH_VIEW`）：

```ts
    expect(backStep(BATCH_VIEW, false)).toBe('close-batch');
```

`scan-routing.test.ts`（import 加 `BATCH_VIEW`）：`scanTargetFor` 的第二个用例加 `expect(scanTargetFor(BATCH_VIEW)).toBe('sink');`；`isWorkbenchActive` 用例加 `expect(isWorkbenchActive(BATCH_VIEW)).toBe(false);`。

- [ ] **Step 2: 跑测试看它失败**

Run: `bun test src/renderer/src/lib`
Expected: FAIL，`Cannot find module './batch-view'`、`BATCH_VIEW` 没有导出。

- [ ] **Step 3: 实现**

`src/renderer/src/lib/status-text.ts` 在 `FAILURE_SHORT` 之后加：

```ts
/** 失败原因的简短说法（打印记录、批量打印的失败行共用）。 */
export function describeFailureShort(reason: PrintFailureReason): string {
  return FAILURE_SHORT[reason];
}
```

`src/renderer/src/lib/app-view.ts`：

```ts
/** 整个窗口有三种视图：工作台、配置中心的某一页、批量打印页（和配置中心同级）。 */
export type AppView = { kind: 'workbench' } | { kind: 'config'; page: ConfigPage } | { kind: 'batch' };

export const WORKBENCH: AppView = { kind: 'workbench' };
export const BATCH_VIEW: AppView = { kind: 'batch' };

export type BackStep = 'close-editor' | 'close-config' | 'close-batch' | 'none';

/** Esc 和「返回」：编辑器开着就先回到列表，否则关掉配置中心（或批量打印页）回工作台。 */
export function backStep(view: AppView, isEditing: boolean): BackStep {
  if (view.kind === 'workbench') {
    return 'none';
  }
  if (view.kind === 'batch') {
    return 'close-batch';
  }
  return isEditing ? 'close-editor' : 'close-config';
}
```

（替换原来的 `AppView`、`WORKBENCH`、`BackStep`、`backStep` 四处定义。）

`src/renderer/src/lib/scan-routing.ts`：

```ts
/** 焦点不在输入框时，扫码枪打出的字符送到哪里（配置中心、批量打印页里永远不打印）。 */
export function scanTargetFor(view: AppView): ScanTarget {
  if (view.kind === 'workbench') {
    return 'scan-box';
  }
  if (view.kind === 'batch') {
    return 'sink';
  }
  return TEST_BOXES.get(view.page) ?? 'sink';
}
```

```ts
// src/renderer/src/lib/batch-view.ts
import type { TemplateFields } from '../../../core/api/template-fields';
import {
  type BatchPlan,
  type BatchTable,
  type CopiesSettings,
  DEFAULT_COPIES,
  type FieldSource,
  NO_SOURCE,
  type RowProblem,
  type SerialSettings,
} from '../../../core/batch/batch-model';
import type { BatchFailure, BatchPauseReason } from '../../../core/batch/batch-runner';
import { usesSerial } from '../../../core/batch/column-mapping';
import { serialText } from '../../../core/batch/serial';
import type { BatchStatus } from '../../../shared/batch';

/** 数据表一行的高度：和 tokens.css 的 --batch-row-height 一致，虚拟滚动按它算哪些行在视野里。 */
export const BATCH_ROW_HEIGHT_PX = 28;
/** 视野上下多画几行：滚得快时不露白。 */
const OVERSCAN_ROWS = 10;
const COLUMN_KEY_PREFIX = 'column:';
/** 序号示例显示前几张。 */
const SERIAL_EXAMPLE_COUNT = 3;

export type DataKind = 'table' | 'serial-only';

/** 界面里的设置（还没整理成交给主进程的 BatchPlan）。 */
export interface PlanInput {
  templateId: string;
  fields: TemplateFields;
  dataKind: DataKind;
  table: BatchTable | null;
  serialOnlyCount: number;
  mapping: Readonly<Record<string, FieldSource>>;
  serial: SerialSettings;
  /** 「显示全部字段」的模板：操作员要不要把序号也印出来。 */
  wantsSerial: boolean;
  copies: CopiesSettings;
  /** null = 全部行。 */
  selected: ReadonlySet<number> | null;
}

/** 序号印不印：模板用了 {序号} 就印；「显示全部字段」的模板由操作员决定，只按序号打时必须印（不然标签是空的）。 */
export function isSerialEnabled(fields: TemplateFields, wantsSerial: boolean, hasTable: boolean): boolean {
  if (usesSerial(fields)) {
    return true;
  }
  return fields.mode === 'ALL' && (wantsSerial || !hasTable);
}

/**
 * 界面的设置 → 交给主进程的 BatchPlan。对的列不在当前表里的（换了表格、只按序号打）一律去掉：
 * 主进程按 parseBatchPlan 严格核对，不能把无效的列名交过去。还没导入表格时为 null（不能打、不预览）。
 */
export function buildPlan(input: PlanInput): BatchPlan | null {
  const table = input.dataKind === 'table' ? input.table : null;
  if (input.dataKind === 'table' && table === null) {
    return null;
  }
  const columns = table?.columns ?? [];
  const hasColumn = (column: string) => columns.includes(column);
  const mapping = Object.fromEntries(
    Object.entries(input.mapping).map(([variable, source]): [string, FieldSource] => [
      variable,
      source.kind === 'column' && !hasColumn(source.column) ? NO_SOURCE : source,
    ]),
  );
  const serialColumn = input.serial.column !== null && hasColumn(input.serial.column) ? input.serial.column : null;
  return {
    templateId: input.templateId,
    data: table === null ? { kind: 'serial-only', count: input.serialOnlyCount } : { kind: 'table', tableId: table.id },
    mapping,
    serial: { ...input.serial, column: serialColumn, enabled: isSerialEnabled(input.fields, input.wantsSerial, table !== null) },
    copies: input.copies.kind === 'column' && !hasColumn(input.copies.column) ? DEFAULT_COPIES : input.copies,
    rows: table === null || input.selected === null ? null : [...input.selected].sort((a, b) => a - b),
  };
}

/** 搜索：任意一格包含关键字（不区分大小写）的行，返回 0 起的下标；没有表格时（只按序号打）全部。 */
export function filterRows(table: BatchTable | null, rowCount: number, search: string): number[] {
  const all = Array.from({ length: rowCount }, (_, index) => index);
  const needle = search.trim().toLowerCase();
  if (needle === '' || table === null) {
    return all;
  }
  return all.filter((index) => (table.rows[index] ?? []).some((cell) => cell.toLowerCase().includes(needle)));
}

/** 虚拟滚动：只画视野里的行（加上下各几行），一万行的表也不卡。 */
export function visibleRange(scrollTop: number, viewportHeight: number, total: number): { start: number; end: number } {
  const first = Math.floor(scrollTop / BATCH_ROW_HEIGHT_PX);
  const count = Math.ceil(viewportHeight / BATCH_ROW_HEIGHT_PX);
  return { start: Math.max(0, first - OVERSCAN_ROWS), end: Math.min(total, first + count + OVERSCAN_ROWS) };
}

/** 把一组行勾上或取消；全部勾上时回到 null（之后表格行数变了也还是全选）。 */
export function withRowsChecked(
  selected: ReadonlySet<number> | null,
  indexes: readonly number[],
  checked: boolean,
  rowCount: number,
): ReadonlySet<number> | null {
  const next = new Set(selected ?? Array.from({ length: rowCount }, (_, index) => index));
  for (const index of indexes) {
    if (checked) {
      next.add(index);
    } else {
      next.delete(index);
    }
  }
  return next.size === rowCount ? null : next;
}

export function toggledSelection(
  selected: ReadonlySet<number> | null,
  index: number,
  rowCount: number,
): ReadonlySet<number> | null {
  const isChecked = selected === null || selected.has(index);
  return withRowsChecked(selected, [index], !isChecked, rowCount);
}

/** 上一张 / 下一张：在搜索结果里走；当前行不在结果里时跳到结果的第一行。 */
export function stepRowIndex(rows: readonly number[], current: number, delta: number): number {
  const position = rows.indexOf(current);
  if (position < 0) {
    return rows[0] ?? current;
  }
  const next = Math.min(rows.length - 1, Math.max(0, position + delta));
  return rows[next] ?? current;
}

/** 同一行的问题合在一起（数据的问题在前，排版的问题在后）；键是从 1 数的行号。 */
export function problemsByRow(...lists: ReadonlyArray<readonly RowProblem[]>): Map<number, string[]> {
  const merged = new Map<number, string[]>();
  for (const list of lists) {
    for (const problem of list) {
      merged.set(problem.row, [...(merged.get(problem.row) ?? []), ...problem.texts]);
    }
  }
  return merged;
}

/** 这一批每行的失败（状态里带着的那些）；键是从 1 数的行号。 */
export function failuresByRow(status: BatchStatus | null): Map<number, BatchFailure[]> {
  const byRow = new Map<number, BatchFailure[]>();
  for (const failure of status?.failures ?? []) {
    byRow.set(failure.row, [...(byRow.get(failure.row) ?? []), failure]);
  }
  return byRow;
}

export function describeTable(table: BatchTable | null): string {
  return table === null ? '还没有导入数据' : `${table.name} · ${table.rows.length} 行 · ${table.columns.length} 列`;
}

export interface SummaryInput {
  rowCount: number;
  selectedCount: number;
  labelCount: number;
  problemRows: number;
}

export function describeSummary({ rowCount, selectedCount, labelCount, problemRows }: SummaryInput): string {
  return [
    `共 ${rowCount} 行`,
    selectedCount < rowCount ? `选中 ${selectedCount} 行` : null,
    `打 ${labelCount} 张`,
    problemRows > 0 ? `${problemRows} 行有问题（标黄）` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

export interface ProgressView {
  text: string;
  /** 0–100。 */
  percent: number;
}

const PERCENT = 100;

/** 底部操作条的进度文字：用「已发送」（驱动收下了），不说「打印成功」。 */
export function describeProgress(status: BatchStatus): ProgressView {
  const done = status.sent + status.failed;
  const percent = status.total === 0 ? 0 : Math.round((done / status.total) * PERCENT);
  const counts = `已发送 ${status.sent} / ${status.total} 张${status.failed > 0 ? ` · 失败 ${status.failed} 张` : ''}`;
  switch (status.state) {
    case 'running':
      return { text: `正在打印 · ${counts}`, percent };
    case 'paused':
      return { text: `已暂停（${describePauseReason(status.pauseReason)}）· ${counts}`, percent };
    case 'canceled':
      return { text: `已取消 · ${counts}`, percent };
    case 'done':
      return { text: `${status.failed > 0 ? '已结束' : '全部已发送'} · ${counts}`, percent };
  }
}

export function describePauseReason(reason: BatchPauseReason | null): string {
  switch (reason) {
    case 'no-printer':
      return '这种纸还没有打印机：到「打印机」页分配后点继续';
    case 'PRINTER_NOT_READY':
      return '打印机现在不能打印：缺纸、离线或卡纸，处理好后点继续';
    case 'PRINTER_NOT_FOUND':
      return '找不到打印机：检查连接后点继续';
    case 'operator':
    case null:
      return '点继续接着打';
  }
}

/** 标题栏「批量打印」按钮上的进度：正在打或暂停时显示「36/120」，其余不显示。 */
export function batchButtonProgress(status: BatchStatus | null): string | null {
  if (status === null || (status.state !== 'running' && status.state !== 'paused')) {
    return null;
  }
  return `${status.sent + status.failed}/${status.total}`;
}

export function serialExample(settings: SerialSettings): string {
  return Array.from({ length: SERIAL_EXAMPLE_COUNT }, (_, position) => serialText(settings, position)).join('、');
}

/** 对列下拉框的选项值。 */
export function sourceKey(source: FieldSource): string {
  switch (source.kind) {
    case 'none':
      return 'none';
    case 'fixed':
      return 'fixed';
    case 'column':
      return `${COLUMN_KEY_PREFIX}${source.column}`;
  }
}

/** 下拉框选了某项 → 取值方式；切到「固定值」时保留原来填的值。 */
export function sourceFromKey(key: string, previous: FieldSource): FieldSource {
  if (key.startsWith(COLUMN_KEY_PREFIX)) {
    return { kind: 'column', column: key.slice(COLUMN_KEY_PREFIX.length) };
  }
  if (key === 'fixed') {
    return previous.kind === 'fixed' ? previous : { kind: 'fixed', value: '' };
  }
  return NO_SOURCE;
}
```

- [ ] **Step 4: 跑测试**

Run: `bun test src/renderer/src/lib`
Expected: PASS。`bun run typecheck` 会指出用到 `view.page` 而没先排除 `batch` 的地方（只有 `use-app-view.ts` 的 `shownPage`，它已经按 `view.kind === 'config'` 取，没有问题）。

- [ ] **Step 5: `bun run check` 后提交**

```bash
git add src/renderer/src/lib
git commit -m "feat(renderer): pure logic for the batch printing page" -m "Plans sent to the main process drop columns that are not in the current table, rows are drawn with a virtual window, and progress texts say 已发送 because the driver only accepted the label. The app view gains a batch page beside the config center, where scans never print." -m "$TRAILER"
```

---

### Task 13: 批量打印页（视图模型、组件、样式）

**Files:**
- Create: `src/renderer/src/view-models/use-batch.ts`
- Create: `src/renderer/src/components/batch/BatchPage.tsx`、`BatchSetup.tsx`、`BatchRows.tsx`
- Modify: `src/renderer/src/styles/tokens.css`、`src/renderer/src/styles/app.css`

- [ ] **Step 1: 视图模型**

```ts
// src/renderer/src/view-models/use-batch.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type TemplateFields, templateFields } from '../../../core/api/template-fields';
import { planLabels } from '../../../core/batch/batch-labels';
import {
  BATCH_LIMITS,
  type BatchTable,
  type CopiesSettings,
  DEFAULT_COPIES,
  DEFAULT_SERIAL,
  FILE_TOO_LARGE_ISSUE,
  type FieldSource,
  type RowProblem,
  type SerialSettings,
} from '../../../core/batch/batch-model';
import { autoMapping, mappableVariables, unmappedVariables } from '../../../core/batch/column-mapping';
import type { LabelTemplate } from '../../../core/templates/template-model';
import type { BatchPreviewResult, BatchStartResult, BatchStatus, BatchTableResult } from '../../../shared/batch';
import {
  buildPlan,
  type DataKind,
  failuresByRow,
  filterRows,
  problemsByRow,
  stepRowIndex,
  toggledSelection,
  withRowsChecked,
} from '../lib/batch-view';
import { reportError } from '../lib/notices';

/** 「只按序号打」默认几张。 */
const DEFAULT_SERIAL_ONLY_COUNT = 10;
/** 改了设置后等这么久再检查全部标签：连着打字时不每个字都把一万张重排一遍。 */
const CHECK_DEBOUNCE_MS = 400;
/** 当前行预览的防抖：和模板页的预览一致。 */
const PREVIEW_DEBOUNCE_MS = 150;
const EMPTY_FIELDS: TemplateFields = { mode: 'PICKED', names: [] };
const NO_COLUMNS: readonly string[] = [];

export type BatchControl = 'pause' | 'resume' | 'cancel';

interface BatchOptions {
  templates: readonly LabelTemplate[];
  activeTemplateId: string | null;
  /** 批量打印页开着：只在开着时预览和检查（关着时不占主进程）。 */
  isOpen: boolean;
}

/**
 * 批量打印页的状态：模板、数据、对列、序号、份数、勾选、当前行都在这里。表格本身由主进程读和保存，
 * 这里拿的是一份副本（显示、本地算缺字段的行）；开始打印时只交回设置和表格编号。
 * 页面关掉再打开设置都还在；正在打的那一批在主进程里继续，进度经推送更新。
 */
export function useBatch({ templates, activeTemplateId, isOpen }: BatchOptions) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [table, setTable] = useState<BatchTable | null>(null);
  const [dataKind, setDataKind] = useState<DataKind>('table');
  const [serialOnlyCount, setSerialOnlyCount] = useState(DEFAULT_SERIAL_ONLY_COUNT);
  const [isLoading, setIsLoading] = useState(false);
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, FieldSource>>({});
  const [serial, setSerialState] = useState<SerialSettings>(DEFAULT_SERIAL);
  const [wantsSerial, setWantsSerial] = useState(false);
  const [copies, setCopies] = useState<CopiesSettings>(DEFAULT_COPIES);
  const [selected, setSelected] = useState<ReadonlySet<number> | null>(null);
  const [search, setSearch] = useState('');
  const [currentRow, setCurrentRow] = useState(0);
  const [renderProblems, setRenderProblems] = useState<readonly RowProblem[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [preview, setPreview] = useState<BatchPreviewResult | null>(null);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [startIssue, setStartIssue] = useState<string | null>(null);

  const template = templates.find((item) => item.id === (templateId ?? activeTemplateId)) ?? templates[0] ?? null;
  const fields = useMemo(() => (template === null ? EMPTY_FIELDS : templateFields(template)), [template]);
  const variables = useMemo(() => mappableVariables(fields), [fields]);
  const dataTable = dataKind === 'table' ? table : null;
  const columns = dataTable?.columns ?? NO_COLUMNS;
  const rowCount = dataKind === 'table' ? (table?.rows.length ?? 0) : serialOnlyCount;
  const current = Math.min(currentRow, Math.max(0, rowCount - 1));

  // 换了模板或表格：按列名重新自动对列（变量和列都可能变了，原来手动对的不一定还成立）。
  useEffect(() => {
    setMapping(autoMapping(variables, columns));
  }, [variables, columns]);

  const plan = useMemo(
    () =>
      template === null
        ? null
        : buildPlan({
            templateId: template.id,
            fields,
            dataKind,
            table,
            serialOnlyCount,
            mapping,
            serial,
            wantsSerial,
            copies,
            selected,
          }),
    [template, fields, dataKind, table, serialOnlyCount, mapping, serial, wantsSerial, copies, selected],
  );
  const labelPlan = useMemo(
    () => (plan === null ? null : planLabels({ table: dataTable, plan, fields })),
    [plan, dataTable, fields],
  );
  const dataProblems = useMemo(() => problemsByRow(labelPlan?.ok ? labelPlan.problems : []), [labelPlan]);
  const problems = useMemo(
    () => problemsByRow(labelPlan?.ok ? labelPlan.problems : [], renderProblems),
    [labelPlan, renderProblems],
  );
  const visibleRows = useMemo(() => filterRows(dataTable, rowCount, search), [dataTable, rowCount, search]);
  const isRunning = status !== null && (status.state === 'running' || status.state === 'paused');

  // 排版的问题（条码印不了、二维码放不下）要把每一行排一遍：交给主进程，改设置后稍等再查。
  useEffect(() => {
    if (!isOpen || plan === null) {
      setRenderProblems([]);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      setIsChecking(true);
      try {
        const result = await window.api.checkBatch(plan);
        if (isActive && result !== null) {
          setRenderProblems(result.problems);
        }
      } catch (error) {
        reportError('检查标签', error);
      } finally {
        if (isActive) {
          setIsChecking(false);
        }
      }
    }, CHECK_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
      setIsChecking(false);
    };
  }, [isOpen, plan]);

  useEffect(() => {
    if (!isOpen || plan === null || rowCount === 0) {
      setPreview(null);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await window.api.previewBatchRow(plan, current);
        if (isActive) {
          setPreview(next);
        }
      } catch (error) {
        reportError('生成预览', error);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, plan, current, rowCount]);

  // 进度来自主进程：打开程序时读一次（上一批可能还在打），之后跟着推送。
  useEffect(() => {
    let isActive = true;
    window.api.getBatchStatus().then(
      (next) => {
        if (isActive) {
          setStatus(next);
        }
      },
      (error: unknown) => reportError('读取批量打印进度', error),
    );
    const unsubscribe = window.api.onBatchStatus(setStatus);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async (read: () => Promise<BatchTableResult>): Promise<boolean> => {
    setIsLoading(true);
    setLoadIssue(null);
    try {
      const result = await read();
      if (result.status === 'invalid') {
        setLoadIssue(result.issue);
        return false;
      }
      if (result.status === 'canceled') {
        return false;
      }
      setTable(result.table);
      setDataKind('table');
      setSelected(null);
      setCurrentRow(0);
      setSearch('');
      return true;
    } catch (error) {
      reportError('导入表格', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const accept = (result: BatchStartResult): void => {
    if (result.status === 'started') {
      setStatus(result.batch);
      setStartIssue(null);
    } else {
      setStartIssue(result.issue);
    }
  };

  return {
    template,
    fields,
    variables,
    columns,
    hasTable: dataTable !== null,
    setTemplateId,
    table,
    dataKind,
    /** 「只按序号打」和表格之间切换（已导入的表格留着，切回来不用重新导入）。 */
    toggleSerialOnly: () => {
      setDataKind((kind) => (kind === 'serial-only' ? 'table' : 'serial-only'));
      setCurrentRow(0);
    },
    serialOnlyCount,
    setSerialOnlyCount,
    isLoading,
    loadIssue,
    openFile: () => void load(() => window.api.openBatchFile()),
    /** 拖进窗口的文件：先看大小（超限的不读进内存），再读成字节交给主进程。 */
    dropFile: (file: File) => {
      if (file.size > BATCH_LIMITS.fileBytes) {
        setLoadIssue(FILE_TOO_LARGE_ISSUE);
        return;
      }
      void load(async () => window.api.readDroppedBatchFile(file.name, new Uint8Array(await file.arrayBuffer())));
    },
    pasteTable: (text: string) => load(() => window.api.pasteBatchTable(text)),
    mapping,
    unmapped: unmappedVariables(mapping, variables, columns),
    setSource: (variable: string, source: FieldSource) =>
      setMapping((previous) => ({ ...previous, [variable]: source })),
    serial,
    setSerial: (patch: Partial<SerialSettings>) => setSerialState((previous) => ({ ...previous, ...patch })),
    wantsSerial,
    setWantsSerial,
    copies,
    setCopies,
    plan,
    planIssue: labelPlan !== null && !labelPlan.ok ? labelPlan.issue : null,
    labelCount: labelPlan?.ok ? labelPlan.labels.length : 0,
    rowCount,
    selectedCount: selected === null ? rowCount : selected.size,
    search,
    setSearch,
    visibleRows,
    isSelected: (index: number) => selected === null || selected.has(index),
    isAllVisibleChecked: visibleRows.length > 0 && visibleRows.every((index) => selected === null || selected.has(index)),
    toggleRow: (index: number) => setSelected((previous) => toggledSelection(previous, index, rowCount)),
    setVisibleChecked: (checked: boolean) =>
      setSelected((previous) => withRowsChecked(previous, visibleRows, checked, rowCount)),
    problems,
    dataProblems,
    isChecking,
    currentRow: current,
    setCurrentRow,
    stepRow: (delta: number) => setCurrentRow(stepRowIndex(visibleRows, current, delta)),
    preview,
    status,
    isRunning,
    failures: failuresByRow(status),
    startIssue,
    start: async () => {
      if (plan === null) {
        return;
      }
      try {
        accept(await window.api.startBatch(plan));
      } catch (error) {
        reportError('开始批量打印', error);
      }
    },
    control: (action: BatchControl) => {
      const call = { pause: window.api.pauseBatch, resume: window.api.resumeBatch, cancel: window.api.cancelBatch }[
        action
      ];
      call().catch((error: unknown) => reportError('批量打印', error));
    },
    /** 重打这一批失败的标签（row 为 null 时整批）：按打印记录里当时的模板和字段。 */
    retryFailed: async (batchId: string, row: number | null) => {
      try {
        accept(await window.api.retryBatchFailures(batchId, row));
      } catch (error) {
        reportError('重打失败的标签', error);
      }
    },
  };
}

export type BatchViewModel = ReturnType<typeof useBatch>;
```

- [ ] **Step 2: 组件**

```tsx
// src/renderer/src/components/batch/BatchRows.tsx
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { BatchTable } from '../../../../core/batch/batch-model';
import type { BatchFailure } from '../../../../core/batch/batch-runner';
import { BATCH_ROW_HEIGHT_PX, visibleRange } from '../../lib/batch-view';
import { describeFailureShort } from '../../lib/status-text';

interface BatchRowsProps {
  columns: readonly string[];
  table: BatchTable | null;
  /** 要显示的行（搜索结果，0 起的下标）。 */
  rows: readonly number[];
  /** 有问题的行（键是从 1 数的行号）：标黄，问题写在悬停提示里。 */
  problems: ReadonlyMap<number, readonly string[]>;
  failures: ReadonlyMap<number, readonly BatchFailure[]>;
  currentRow: number;
  isSelected: (index: number) => boolean;
  isAllChecked: boolean;
  /** 现在能不能单独重打一行（有一批在打时不能）。 */
  canRetry: boolean;
  onToggleRow: (index: number) => void;
  onToggleAll: (checked: boolean) => void;
  onSelectRow: (index: number) => void;
  onRetryRow: (row: number) => void;
}

/** 要打的数据：表头固定，只画视野里的行（一万行也不卡），勾选要打的行，点行号看这一行的预览。 */
export function BatchRows({
  columns,
  table,
  rows,
  problems,
  failures,
  currentRow,
  isSelected,
  isAllChecked,
  canRetry,
  onToggleRow,
  onToggleAll,
  onSelectRow,
  onRetryRow,
}: BatchRowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { start, end } = visibleRange(scrollTop, viewportHeight, rows.length);
  const style = { '--batch-columns': columns.length } as CSSProperties;

  return (
    <div
      ref={scrollRef}
      className="batch-rows"
      role="table"
      aria-label="要打的数据"
      aria-rowcount={rows.length + 1}
      style={style}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="batch-rows__row batch-rows__row--head" role="row">
        <span role="columnheader">
          <input
            type="checkbox"
            aria-label="全选（搜索结果）"
            checked={isAllChecked}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
        </span>
        <span role="columnheader">行</span>
        {columns.map((column) => (
          <span key={column} role="columnheader" title={column}>
            {column}
          </span>
        ))}
        <span role="columnheader">结果</span>
      </div>
      <div className="batch-rows__body" style={{ height: rows.length * BATCH_ROW_HEIGHT_PX }}>
        {rows.slice(start, end).map((index, offset) => {
          const row = index + 1;
          const rowProblems = problems.get(row);
          const firstFailure = failures.get(row)?.[0];
          const classes = [
            'batch-rows__row',
            rowProblems === undefined ? null : 'batch-rows__row--problem',
            index === currentRow ? 'batch-rows__row--current' : null,
            isSelected(index) ? null : 'batch-rows__row--skipped',
          ]
            .filter((name) => name !== null)
            .join(' ');
          return (
            <div
              key={index}
              className={classes}
              role="row"
              aria-rowindex={start + offset + 2}
              aria-current={index === currentRow ? 'true' : undefined}
              title={rowProblems?.join('；')}
              style={{ top: (start + offset) * BATCH_ROW_HEIGHT_PX }}
            >
              <span role="cell">
                <input
                  type="checkbox"
                  aria-label={`打印第 ${row} 行`}
                  checked={isSelected(index)}
                  onChange={() => onToggleRow(index)}
                />
              </span>
              <span role="cell">
                <button
                  type="button"
                  className="link-button"
                  aria-label={`预览第 ${row} 行`}
                  onClick={() => onSelectRow(index)}
                >
                  {row}
                </button>
              </span>
              {columns.map((column, at) => {
                const cell = table?.rows[index]?.[at] ?? '';
                return (
                  <span key={column} role="cell" className="batch-rows__cell" title={cell}>
                    {cell}
                  </span>
                );
              })}
              <span role="cell">
                {firstFailure !== undefined && (
                  <span className="batch-rows__failed">
                    失败：{describeFailureShort(firstFailure.reason)}
                    {canRetry && (
                      <button type="button" className="link-button" onClick={() => onRetryRow(row)}>
                        重打
                      </button>
                    )}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

```tsx
// src/renderer/src/components/batch/BatchSetup.tsx
import { useId, useState } from 'react';
import {
  BATCH_LIMITS,
  type CopiesSettings,
  DEFAULT_COPIES,
  type FieldSource,
  sourceOf,
} from '../../../../core/batch/batch-model';
import { usesSerial } from '../../../../core/batch/column-mapping';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import { describeTable, serialExample, sourceFromKey, sourceKey } from '../../lib/batch-view';
import type { BatchViewModel } from '../../view-models/use-batch';
import { NumberField, Segmented, SelectField, TextAreaField, TextInput, Toggle } from '../form-controls';

const COPIES_OPTIONS: ReadonlyArray<{ value: CopiesSettings['kind']; label: string }> = [
  { value: 'fixed', label: '每行固定' },
  { value: 'column', label: '取一列' },
];
const SERIAL_SOURCE_OPTIONS = [
  { value: 'generate', label: '按规则生成' },
  { value: 'column', label: '取一列' },
] as const;
const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

interface SectionProps {
  batch: BatchViewModel;
}

/** 批量打印的前四段：模板、数据、对列、序号与份数。 */
export function BatchSetup({ batch, templates }: SectionProps & { templates: readonly LabelTemplate[] }) {
  const titleId = useId();
  return (
    <>
      <section className="config-card" aria-labelledby={titleId}>
        <h2 id={titleId} className="config-card__title">
          1 模板
        </h2>
        <SelectField
          label="模板"
          value={batch.template?.id ?? ''}
          options={templates.map((template) => ({ value: template.id, label: template.name }))}
          onChange={batch.setTemplateId}
        />
      </section>
      <DataSection batch={batch} />
      <MappingSection batch={batch} />
      <SerialSection batch={batch} />
    </>
  );
}

function DataSection({ batch }: SectionProps) {
  const titleId = useId();
  const [isPasting, setIsPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const applyPaste = async () => {
    if (await batch.pasteTable(pasted)) {
      setIsPasting(false);
      setPasted('');
    }
  };
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        2 数据
      </h2>
      <p className="config-card__text">
        导入 .xlsx 或 .csv（也可以直接把文件拖进窗口），或者粘贴从 Excel 复制的表格。第一行是列名，最多{' '}
        {NUMBER_FORMAT.format(BATCH_LIMITS.rows)} 行。
      </p>
      <div className="batch-data__actions">
        <button type="button" className="button" disabled={batch.isLoading} onClick={batch.openFile}>
          选择文件…
        </button>
        <button
          type="button"
          className="button"
          aria-expanded={isPasting}
          onClick={() => setIsPasting((open) => !open)}
        >
          粘贴表格
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={batch.dataKind === 'serial-only'}
          onClick={batch.toggleSerialOnly}
        >
          只按序号打
        </button>
      </div>
      {isPasting && (
        <div className="batch-data__paste">
          <TextAreaField
            label="粘贴从 Excel 复制的表格（第一行是列名）"
            value={pasted}
            maxLength={BATCH_LIMITS.pasteChars}
            rows={6}
            onChange={setPasted}
          />
          <div className="batch-data__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={pasted.trim() === '' || batch.isLoading}
              onClick={() => void applyPaste()}
            >
              用这些数据
            </button>
            <button type="button" className="button button--quiet" onClick={() => setIsPasting(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      {batch.dataKind === 'serial-only' ? (
        <NumberField
          label="张数"
          value={batch.serialOnlyCount}
          min={1}
          max={BATCH_LIMITS.serialOnlyCount}
          step={1}
          unit="张"
          onChange={batch.setSerialOnlyCount}
        />
      ) : (
        <p className="batch-data__status">{batch.isLoading ? '正在读取…' : describeTable(batch.table)}</p>
      )}
      {batch.loadIssue !== null && (
        <p className="batch-data__issue" role="alert">
          {batch.loadIssue}
        </p>
      )}
    </section>
  );
}

function MappingSection({ batch }: SectionProps) {
  const titleId = useId();
  const { variables, columns, fields } = batch;
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        3 对列
      </h2>
      {fields.mode === 'ALL' && (
        <p className="config-card__text">这个模板显示全部字段：表格的每一列都会印出来，列名就是字段名。</p>
      )}
      {variables.length === 0 && fields.mode === 'PICKED' && (
        <p className="config-card__text">这个模板没有用到字段，不用对列。</p>
      )}
      {variables.length > 0 && (
        <table className="batch-mapping">
          <thead>
            <tr>
              <th scope="col">模板里的字段</th>
              <th scope="col">取值</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((variable) => (
              <MappingRow
                key={variable}
                variable={variable}
                source={sourceOf(batch.mapping, variable)}
                columns={columns}
                isMissing={batch.unmapped.includes(variable)}
                onChange={(source) => batch.setSource(variable, source)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface MappingRowProps {
  variable: string;
  source: FieldSource;
  columns: readonly string[];
  isMissing: boolean;
  onChange: (source: FieldSource) => void;
}

function MappingRow({ variable, source, columns, isMissing, onChange }: MappingRowProps) {
  const name = `{${variable}}`;
  return (
    <tr className={isMissing ? 'batch-mapping__row--missing' : undefined}>
      <th scope="row">{name}</th>
      <td>
        <select
          className="select-field"
          aria-label={`${name} 的取值`}
          value={sourceKey(source)}
          onChange={(event) => onChange(sourceFromKey(event.target.value, source))}
        >
          <option value="none">不填</option>
          {columns.map((column) => (
            <option key={column} value={`column:${column}`}>
              列：{column}
            </option>
          ))}
          <option value="fixed">固定值…</option>
        </select>
        {source.kind === 'fixed' && (
          <input
            type="text"
            className="text-field"
            aria-label={`${name} 的固定值`}
            value={source.value}
            maxLength={BATCH_LIMITS.fixedValueLength}
            onChange={(event) => onChange({ kind: 'fixed', value: event.target.value })}
          />
        )}
        {isMissing && <span className="batch-mapping__hint">没有对上的列：选一列、填固定值，或者不填（这一项不印）</span>}
      </td>
    </tr>
  );
}

function SerialSection({ batch }: SectionProps) {
  const titleId = useId();
  const { fields, serial, copies, columns, hasTable } = batch;
  const isEnabled = batch.plan?.serial.enabled ?? false;
  const columnOptions = columns.map((column) => ({ value: column, label: column }));
  const serialFromColumn = hasTable && serial.column !== null ? serial.column : null;
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        4 序号与份数
      </h2>
      {fields.mode === 'PICKED' && !usesSerial(fields) && (
        <p className="config-card__text">这个模板没有用到 {'{序号}'}：要印序号，先在模板里插入 {'{序号}'}。</p>
      )}
      {fields.mode === 'ALL' && !usesSerial(fields) && hasTable && (
        <Toggle label="印序号" checked={batch.wantsSerial} onChange={batch.setWantsSerial} />
      )}
      {isEnabled && hasTable && (
        <Segmented
          label="序号"
          value={serialFromColumn === null ? 'generate' : 'column'}
          options={SERIAL_SOURCE_OPTIONS}
          onChange={(mode) => batch.setSerial({ column: mode === 'column' ? (columns[0] ?? null) : null })}
        />
      )}
      {isEnabled && serialFromColumn !== null && (
        <SelectField
          label="序号列"
          value={serialFromColumn}
          options={columnOptions}
          onChange={(column) => batch.setSerial({ column })}
        />
      )}
      {isEnabled && serialFromColumn === null && (
        <>
          <TextInput
            label="前缀"
            value={serial.prefix}
            maxLength={BATCH_LIMITS.serialAffixLength}
            onChange={(prefix) => batch.setSerial({ prefix })}
          />
          <NumberField
            label="起始"
            value={serial.start}
            min={0}
            max={BATCH_LIMITS.serialStart}
            step={1}
            unit=""
            onChange={(start) => batch.setSerial({ start })}
          />
          <NumberField
            label="步长"
            value={serial.step}
            min={1}
            max={BATCH_LIMITS.serialStep}
            step={1}
            unit=""
            onChange={(step) => batch.setSerial({ step })}
          />
          <NumberField
            label="位数"
            value={serial.digits}
            min={0}
            max={BATCH_LIMITS.serialDigits}
            step={1}
            unit="位"
            onChange={(digits) => batch.setSerial({ digits })}
          />
          <TextInput
            label="后缀"
            value={serial.suffix}
            maxLength={BATCH_LIMITS.serialAffixLength}
            onChange={(suffix) => batch.setSerial({ suffix })}
          />
          <p className="config-card__text">例：{serialExample(serial)}（位数为 0 时不补零）</p>
        </>
      )}
      <Segmented
        label="份数"
        value={copies.kind}
        options={hasTable ? COPIES_OPTIONS : COPIES_OPTIONS.slice(0, 1)}
        onChange={(kind) =>
          batch.setCopies(kind === 'column' && columns[0] !== undefined ? { kind, column: columns[0] } : DEFAULT_COPIES)
        }
      />
      {copies.kind === 'fixed' ? (
        <NumberField
          label="每行几份"
          value={copies.count}
          min={1}
          max={BATCH_LIMITS.copiesPerRow}
          step={1}
          unit="份"
          onChange={(count) => batch.setCopies({ kind: 'fixed', count })}
        />
      ) : (
        <SelectField
          label="份数列"
          value={copies.column}
          options={columnOptions}
          onChange={(column) => batch.setCopies({ kind: 'column', column })}
        />
      )}
    </section>
  );
}
```

```tsx
// src/renderer/src/components/batch/BatchPage.tsx
import { useCallback, useId } from 'react';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import { DEFAULT_PAPER } from '../../../../shared/label-paper';
import { NO_RENDER_WARNINGS } from '../../../../shared/render-warnings';
import { describeProgress, describeSummary } from '../../lib/batch-view';
import type { BatchViewModel } from '../../view-models/use-batch';
import { LabelPreview } from '../LabelPreview';
import { BatchRows } from './BatchRows';
import { BatchSetup } from './BatchSetup';

/** 预览的放大倍数上限：右栏不宽，60×40 的标签放大到 3 倍条码已经看得清。 */
const BATCH_PREVIEW_MAX_SCALE = 3;

interface BatchPageProps {
  batch: BatchViewModel;
  templates: readonly LabelTemplate[];
  onClose: () => void;
}

/** 批量打印页：和配置中心同级，铺满标题栏以下；自上而下五段设置，底部是打印按钮和进度。 */
export function BatchPage({ batch, templates, onClose }: BatchPageProps) {
  const previewTitleId = useId();
  // 打开时焦点落到标题：读屏软件读出所在位置，Tab 从页面内容开始（和配置中心一样）。
  const focusTitle = useCallback((title: HTMLHeadingElement | null) => title?.focus(), []);
  const { status, preview } = batch;
  const progress = status === null ? null : describeProgress(status);
  const issue = batch.startIssue ?? (progress === null ? batch.planIssue : null);
  const statusText = issue ?? progress?.text ?? '';
  const canRetryAll = !batch.isRunning && status !== null && status.failed > 0;
  const currentProblems = batch.dataProblems.get(batch.currentRow + 1) ?? [];

  return (
    <div className="batch-page">
      <div className="config-center__back">
        <button type="button" className="button button--quiet" onClick={onClose}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
      </div>
      <div className="config-header">
        <h1 ref={focusTitle} className="config-header__title" tabIndex={-1}>
          批量打印
        </h1>
      </div>
      <div className="config-content">
        <div className="config-content__inner batch-page__inner">
          <BatchSetup batch={batch} templates={templates} />
          <section className="config-card" aria-labelledby={previewTitleId}>
            <h2 id={previewTitleId} className="config-card__title">
              5 预览
            </h2>
            {batch.rowCount === 0 ? (
              <p className="config-card__text">
                导入表格、粘贴数据或选「只按序号打」之后，这里逐行列出要打的内容，右边是这一行打出来的样子。
              </p>
            ) : (
              <>
                <p className="batch-preview__summary">
                  {describeSummary({
                    rowCount: batch.rowCount,
                    selectedCount: batch.selectedCount,
                    labelCount: batch.labelCount,
                    problemRows: batch.problems.size,
                  })}
                  {batch.isChecking ? ' · 正在检查条码和排版…' : ''}
                </p>
                <div className="batch-preview__body">
                  <div className="batch-preview__list">
                    <input
                      type="search"
                      className="text-field"
                      aria-label="搜索数据"
                      placeholder="搜索任意一格"
                      value={batch.search}
                      onChange={(event) => batch.setSearch(event.target.value)}
                    />
                    <BatchRows
                      columns={batch.columns}
                      table={batch.hasTable ? batch.table : null}
                      rows={batch.visibleRows}
                      problems={batch.problems}
                      failures={batch.failures}
                      currentRow={batch.currentRow}
                      isSelected={batch.isSelected}
                      isAllChecked={batch.isAllVisibleChecked}
                      canRetry={!batch.isRunning && status !== null}
                      onToggleRow={batch.toggleRow}
                      onToggleAll={batch.setVisibleChecked}
                      onSelectRow={batch.setCurrentRow}
                      onRetryRow={(row) => {
                        if (status !== null) {
                          void batch.retryFailed(status.batchId, row);
                        }
                      }}
                    />
                  </div>
                  <div className="batch-preview__label">
                    <div className="batch-preview__nav">
                      <button type="button" className="button button--small" onClick={() => batch.stepRow(-1)}>
                        上一张
                      </button>
                      <span>第 {batch.currentRow + 1} 行</span>
                      <button type="button" className="button button--small" onClick={() => batch.stepRow(1)}>
                        下一张
                      </button>
                    </div>
                    <LabelPreview
                      html={preview?.status === 'ok' ? preview.preview.html : null}
                      warnings={preview?.status === 'ok' ? preview.preview.warnings : NO_RENDER_WARNINGS}
                      feedKey={String(batch.currentRow)}
                      maxScale={BATCH_PREVIEW_MAX_SCALE}
                      placeholder={preview?.status === 'invalid' ? preview.issue : '正在生成预览…'}
                      paper={preview?.status === 'ok' ? preview.preview.paper : (batch.template?.paper ?? DEFAULT_PAPER)}
                    />
                    {currentProblems.length > 0 && (
                      <ul className="batch-preview__problems">
                        {currentProblems.map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
      <div className="config-actions batch-actions">
        <p
          className={`config-actions__status${issue === null ? '' : ' config-actions__status--error'}`}
          role="status"
        >
          {statusText}
        </p>
        {progress !== null && (
          <progress className="batch-progress" max={100} value={progress.percent} aria-label="批量打印进度" />
        )}
        {batch.isRunning ? (
          <>
            {status?.state === 'paused' ? (
              <button type="button" className="button button--primary" onClick={() => batch.control('resume')}>
                继续
              </button>
            ) : (
              <button type="button" className="button" onClick={() => batch.control('pause')}>
                暂停
              </button>
            )}
            <button type="button" className="button" onClick={() => batch.control('cancel')}>
              取消
            </button>
          </>
        ) : (
          <>
            {canRetryAll && status !== null && (
              <button type="button" className="button" onClick={() => void batch.retryFailed(status.batchId, null)}>
                重打失败的（{status.failed}）
              </button>
            )}
            <button
              type="button"
              className="button button--primary"
              disabled={batch.labelCount === 0}
              onClick={() => void batch.start()}
            >
              打印 {batch.labelCount} 张
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 样式**

`src/renderer/src/styles/tokens.css` 在 `--config-actions-height` 那一组之后加：

```css
  /* 批量打印的数据表：一行 28px（和 lib/batch-view.ts 的 BATCH_ROW_HEIGHT_PX 一致，虚拟滚动按它算）；
     预览区高 480px（约 15 行），右栏放标签预览。 */
  --batch-row-height: 28px;
  --batch-preview-height: 480px;
  --batch-label-pane-width: 360px;
```

`src/renderer/src/styles/app.css` 末尾加：

```css
/* ── 批量打印页：和配置中心同级，铺满标题栏以下；页头、内容、底部操作条，复用配置中心的这几块 ── */
.batch-page {
  position: absolute;
  z-index: var(--layer-config);
  inset: var(--title-bar-height) 0 0 0;
  display: grid;
  grid-template-areas:
    "back header"
    "content content"
    "actions actions";
  grid-template-columns: var(--config-nav-width) minmax(0, 1fr);
  grid-template-rows: var(--config-header-height) minmax(0, 1fr) var(--config-actions-height);
  background: var(--color-housing);
  animation: config-enter var(--config-duration) ease-out;
}

/* 提示条抬到底部操作条上方：不盖住「打印」「暂停」 */
.batch-page ~ .notice-bar {
  bottom: calc(var(--config-actions-height) + var(--space-5));
}

.batch-page__inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.batch-data__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.batch-data__paste {
  margin-top: var(--space-3);
}

.batch-data__status {
  margin: var(--space-2) 0 0;
  font-family: var(--font-data);
  font-size: 13px;
}

.batch-data__issue {
  margin: var(--space-2) 0 0;
  color: var(--color-error);
  font-size: 13px;
}

.batch-mapping {
  border-collapse: collapse;
  font-size: 13px;
}

.batch-mapping th,
.batch-mapping td {
  padding: var(--space-1) var(--space-3);
  text-align: left;
  vertical-align: middle;
}

.batch-mapping thead th {
  color: var(--color-ink-soft);
  font-weight: 600;
}

.batch-mapping tbody th {
  font-family: var(--font-data);
  font-weight: 400;
  white-space: nowrap;
}

.batch-mapping td {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.batch-mapping__row--missing th,
.batch-mapping__hint {
  color: var(--color-error);
}

.batch-mapping__hint {
  font-size: 12px;
}

.batch-preview__summary {
  margin: 0 0 var(--space-3);
  font-size: 13px;
}

.batch-preview__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--batch-label-pane-width);
  gap: var(--space-4);
  height: var(--batch-preview-height);
}

.batch-preview__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
}

/* 数据表自己滚动（纵向、横向），页面不跟着变宽 */
.batch-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius);
  background: var(--color-field);
  font-size: 12px;
}

/* 勾选 32px、行号 56px、每列至少 120px、结果 160px */
.batch-rows__row {
  display: grid;
  grid-template-columns: 32px 56px repeat(var(--batch-columns), minmax(120px, 1fr)) 160px;
  align-items: center;
  min-width: calc(248px + var(--batch-columns) * 120px);
  height: var(--batch-row-height);
  border-bottom: 1px solid var(--color-housing);
}

.batch-rows__row > * {
  overflow: hidden;
  padding: 0 var(--space-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-rows__row--head {
  position: sticky;
  z-index: 1;
  top: 0;
  background: var(--color-paper);
  color: var(--color-ink-soft);
  font-weight: 600;
}

.batch-rows__body {
  position: relative;
  min-width: calc(248px + var(--batch-columns) * 120px);
}

.batch-rows__body > .batch-rows__row {
  position: absolute;
  right: 0;
  left: 0;
}

.batch-rows__cell {
  font-family: var(--font-data);
  user-select: text;
}

.batch-rows__row--problem {
  background: var(--color-warning-wash);
}

/* 当前预览的这一行：左侧 4px 胶带色竖条，和配置中心当前页的标记一致 */
.batch-rows__row--current {
  box-shadow: inset 4px 0 0 var(--color-tape);
}

.batch-rows__row--skipped {
  color: var(--color-ink-soft);
}

.batch-rows__failed {
  display: inline-flex;
  gap: var(--space-2);
  color: var(--color-error);
}

.batch-preview__label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.batch-preview__label .label-preview {
  flex: 1;
  min-height: 0;
}

.batch-preview__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: 13px;
}

.batch-preview__problems {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--color-warning);
  font-size: 12px;
}

.batch-progress {
  flex: none;
  width: 200px;
  accent-color: var(--color-tape);
}

/* 窄窗口（1024）：预览区改成上下排列，数据表固定高度 */
@media (max-width: 1099px) {
  .batch-preview__body {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }

  .batch-rows {
    flex: none;
    height: var(--batch-preview-height);
  }

  .batch-preview__label {
    height: var(--batch-preview-height);
  }
}
```

- [ ] **Step 4: 检查**

Run: `bun run check`
Expected: 通过（组件还没挂到 App 上，下一个任务接）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/view-models/use-batch.ts src/renderer/src/components/batch src/renderer/src/styles/tokens.css src/renderer/src/styles/app.css
git commit -m "feat(renderer): batch printing page" -m "One page from top to bottom: template, data (file, paste or serials only), column mapping with unmatched variables in red, serial and copies, then a virtual-scrolling data table with problem rows in yellow beside the real preview of the current row. The action bar prints, pauses, resumes, cancels and retries failures." -m "$TRAILER"
```

---

### Task 14: 标题栏入口、打开批量页、拖文件进窗口

**Files:**
- Create: `src/renderer/src/view-models/use-file-drop.ts`
- Modify: `src/renderer/src/view-models/use-app-view.ts`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/app.css`

- [ ] **Step 1: 拖文件**

```ts
// src/renderer/src/view-models/use-file-drop.ts
import { useEffect, useRef } from 'react';

/** 只认带文件的拖放：拖文字、拖页面里的元素不管。 */
function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/**
 * 把文件拖进窗口：交给 onFile（打开批量打印页并读这个文件）。必须拦下默认行为，
 * 否则 Chromium 会去打开这个文件（导航被 security.ts 拒绝，文件也就丢了）。
 */
export function useFileDrop(onFile: (file: File) => void, isEnabled: boolean): void {
  const onFileRef = useRef(onFile);

  useEffect(() => {
    onFileRef.current = onFile;
  });

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        onFileRef.current(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [isEnabled]);
}
```

- [ ] **Step 2: 视图切换**（`src/renderer/src/view-models/use-app-view.ts`）

import 改为 `import { type AppView, BATCH_VIEW, backStep, type ConfigPage, isConfigShortcut, type Platform, WORKBENCH } from '../lib/app-view';`。

把 `close` 的定义换成下面三段（`fadeOutConfig`、`close`、`openBatch`）：

```ts
  const isConfigShown = view.kind === 'config';
  /** 离开配置中心：它在上面淡出，淡出期间 leavingPage 仍是那一页。不在配置中心时只清掉上一次的淡出。 */
  const fadeOutConfig = useCallback(() => {
    cancelLeaving();
    if (!isConfigShown) {
      return;
    }
    setLeavingPage(lastPage.current);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setLeavingPage(null);
    }, transitionMs());
  }, [cancelLeaving, isConfigShown]);

  const close = useCallback(
    () =>
      requestLeave(() => {
        fadeOutConfig();
        setView(WORKBENCH);
        onClosedRef.current();
      }),
    [requestLeave, fadeOutConfig],
  );

  /** 打开批量打印页（标题栏按钮、拖进文件、打印记录里重打一批）；配置中心里有未保存的修改时先确认。 */
  const openBatch = useCallback(() => {
    if (canOpen) {
      requestLeave(() => {
        fadeOutConfig();
        setView(BATCH_VIEW);
      });
    }
  }, [canOpen, requestLeave, fadeOutConfig]);
```

`back` 里的 switch 改为：

```ts
    switch (backStep(view, editorRef.current(shownPage).isEditing)) {
      case 'close-editor':
        requestLeave(() => undefined);
        break;
      case 'close-config':
      case 'close-batch':
        close();
        break;
      case 'none':
        break;
    }
```

键盘处理里 `if (isEscape && isOpen && !isDropdown(event.target)) {` 改为 `if (isEscape && view.kind !== 'workbench' && !isDropdown(event.target)) {`（批量打印页按 Esc 也回工作台）。

最后的 `return` 加 `openBatch`：`return { view, leavingPage, open, close, toggle, requestLeave, leaveConfirm, openBatch };`。文档注释第一行改为「整个窗口的视图：工作台、配置中心的某一页，或批量打印页。」

- [ ] **Step 3: 标题栏按钮**（`src/renderer/src/components/TitleBar.tsx`）

`MobileButtonProps` 之后加：

```ts
export interface BatchButtonProps {
  isOpen: boolean;
  /** 正在打或暂停时的进度（「36/120」）；其余为 null。 */
  progress: string | null;
  onToggle: () => void;
}
```

`TitleBarProps` 加 `batch: BatchButtonProps;`，函数参数解构加 `batch,`。在「配置」按钮之前加：

```tsx
        {/* 批量打印页和配置中心同级：按下状态表示正在看它；在打的时候按钮上带进度，关掉页面也看得到。 */}
        <button
          type="button"
          className="config-button batch-button"
          aria-pressed={batch.isOpen}
          title={batch.isOpen ? '返回工作台' : '批量打印：导入 Excel / CSV，一行打一张'}
          onClick={batch.onToggle}
        >
          批量打印
          {batch.progress !== null && <span className="batch-button__progress">{batch.progress}</span>}
        </button>
```

`app.css` 在 `.mobile-button__dot` 那一段之前加：

```css
.batch-button__progress {
  font-family: var(--font-data);
  font-weight: 400;
}
```

（`.batch-button` 用 `.config-button` 的胶囊样式，不另写。）

- [ ] **Step 4: App 接线**（`src/renderer/src/App.tsx`）

import 加（按顺序放）：

```ts
import { BatchPage } from './components/batch/BatchPage';
import { batchButtonProgress } from './lib/batch-view';
import { useBatch } from './view-models/use-batch';
import { useFileDrop } from './view-models/use-file-drop';
```

在 `const isWorkbench = isWorkbenchActive(appView.view);` 之后加：

```ts
  // 批量打印：设置留在这里（关掉页面再打开都还在），批次本身在主进程里跑。
  const isBatchOpen = appView.view.kind === 'batch';
  const batch = useBatch({
    templates: templates.templates,
    activeTemplateId: settings?.activeTemplateId ?? null,
    isOpen: isBatchOpen,
  });
  // 把 .xlsx / .csv 拖进窗口：打开批量打印页并读这个文件（.xls 等由主进程说明为什么不行）。
  useFileDrop(
    (file) => {
      appView.openBatch();
      batch.dropFile(file);
    },
    settings !== null,
  );
```

`<TitleBar` 的 `config={{ isOpen: !isWorkbench, ...` 改为 `config={{ isOpen: appView.view.kind === 'config', ...`，并加：

```tsx
        batch={{
          isOpen: isBatchOpen,
          progress: batchButtonProgress(batch.status),
          onToggle: isBatchOpen ? appView.close : appView.openBatch,
        }}
```

在 `{settings !== null && config.page !== null && (` 那一段（ConfigCenter）之后加：

```tsx
      {settings !== null && isBatchOpen && (
        <BatchPage batch={batch} templates={templates.templates} onClose={appView.close} />
      )}
```

- [ ] **Step 5: 检查**

Run: `bun run check && bun run test:e2e`
Expected: 都通过（现有用例里「配置」按钮的按下状态只在配置中心打开时出现，行为不变）。再用 `bun run dev` 手动点一遍：标题栏「批量打印」→ 页面出现，Esc 回工作台；把一个 CSV 拖进窗口 → 批量页打开并显示表格。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/view-models/use-file-drop.ts src/renderer/src/view-models/use-app-view.ts src/renderer/src/components/TitleBar.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(renderer): open batch printing from the title bar or by dropping a file" -m "The batch page sits beside the config center: the title bar button toggles it and shows progress while a batch runs, Esc returns to the workbench, and dropping an .xlsx or .csv anywhere opens it with that file. Leaving an unsaved editor still asks first." -m "$TRAILER"
```

---

### Task 15: 打印记录按批次筛选、整批重打失败的

**Files:**
- Modify: `src/renderer/src/view-models/use-job-log.ts`
- Modify: `src/renderer/src/components/JobLog.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/app.css`

- [ ] **Step 1: 视图模型**（`use-job-log.ts`）

1. `useState` 区加 `const [batchId, setBatchId] = useState<string | null>(null);` 和 `const batchRef = useRef(batchId);`。
2. `loadFirstPage` 改为接收批次：

```ts
  const loadFirstPage = useCallback(async (query: string, batch: string | null) => {
    requestId.current += 1;
    const id = requestId.current;
    try {
      const first = await window.api.listJobs({
        limit: JOB_PAGE_SIZE,
        search: query,
        ...(batch === null ? {} : { batchId: batch }),
      });
      if (id === requestId.current) {
        setPage(first);
        setHasNewJobs(false);
      }
    } catch (error) {
      reportError('读取打印记录', error);
    }
  }, []);
```

3. 搜索的 effect 改为：

```ts
  useEffect(() => {
    searchRef.current = search;
    batchRef.current = batchId;
    const timer = window.setTimeout(() => void loadFirstPage(search, batchId), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, batchId, loadFirstPage]);

  const refresh = useCallback(() => loadFirstPage(searchRef.current, batchRef.current), [loadFirstPage]);
```

4. `loadMore` 的 `listJobs` 参数加 `...(batchRef.current === null ? {} : { batchId: batchRef.current }),`。
5. 返回值加 `batchId, setBatchId,`。

- [ ] **Step 2: 组件**（`JobLog.tsx`）

`JobLogProps` 加：

```ts
  /** 只看这一批（批次号）；null = 全部。 */
  batchFilter: string | null;
  onFilterBatch: (batchId: string | null) => void;
  /** 重打这一批失败的标签（打开批量打印页看进度）。 */
  onRetryBatch: (batchId: string) => void;
```

参数解构加这三个。在 `{hasNewJobs && (` 之前加：

```tsx
      {batchFilter !== null && (
        <div className="job-log__batch">
          <span className="job-log__batch-name">批次 {batchFilter}</span>
          <button type="button" className="button button--small" onClick={() => onRetryBatch(batchFilter)}>
            重打失败的
          </button>
          <button type="button" className="button button--small button--quiet" onClick={() => onFilterBatch(null)}>
            显示全部
          </button>
        </div>
      )}
```

每条记录里，把 `{reprintModeOf(job) !== 'unavailable' && (` 那一段换成：

```tsx
              {(reprintModeOf(job) !== 'unavailable' || (batchId !== undefined && batchFilter === null)) && (
                <div className="job-row__actions">
                  {batchId !== undefined && batchFilter === null && (
                    <button
                      type="button"
                      className="button button--small button--quiet"
                      onClick={() => onFilterBatch(batchId)}
                    >
                      这一批
                    </button>
                  )}
                  {reprintModeOf(job) !== 'unavailable' && (
                    <>
                      <button
                        type="button"
                        className="button button--small button--quiet"
                        onClick={() => onReview(job)}
                      >
                        预览
                      </button>
                      <button type="button" className="button button--small" onClick={() => onReprint(job)}>
                        重打
                      </button>
                    </>
                  )}
                </div>
              )}
```

并在 `const meta = describeJobMeta(job, callerOf(job));` 之后加 `const batchId = job.batch?.id;`。空列表的文字改为：

```tsx
        <p className="empty">
          {batchFilter !== null
            ? '这一批还没有打印记录'
            : isSearching
              ? `没有包含「${search.trim()}」的记录`
              : '还没有打印记录。扫一张标签试试'}
        </p>
```

`app.css` 在 `.job-log__new` 之后加：

```css
/* 按批次筛选时的提示行：批次号（等宽）、重打失败的、显示全部 */
.job-log__batch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-3) var(--space-2);
  font-size: 12px;
}

.job-log__batch-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: App 接线**（`<JobLog` 加三个属性）

```tsx
              batchFilter={jobLog.batchId}
              onFilterBatch={jobLog.setBatchId}
              onRetryBatch={(batchId) => {
                // 打开批量打印页：进度、失败的原因（例如模板删了不能重打）都在那里看。
                appView.openBatch();
                void batch.retryFailed(batchId, null);
              }}
```

- [ ] **Step 4: 检查**

Run: `bun run check && bun run test:e2e`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/view-models/use-job-log.ts src/renderer/src/components/JobLog.tsx src/renderer/src/App.tsx src/renderer/src/styles/app.css
git commit -m "feat(records): filter job records by batch and reprint its failures" -m "Each batch record offers 这一批 to show only that batch; the filter bar reprints the batch's failed labels with their stored template and fields and opens the batch page to show progress." -m "$TRAILER"
```

---

### Task 16: E2E

**Files:**
- Modify: `src/main/printing/fake-printers.ts`、`src/main/printing/fake-printers.test.ts`（每张耗时，测暂停和取消用）
- Create: `e2e/batch.e2e.ts`

- [ ] **Step 1: 假打印机可以慢一点**

`fake-printers.test.ts` 的 `describe('FakePrinters')` 里加：

```ts
  // E2E 测暂停、取消：每张要花一点时间，按钮才点得到正在打的批次。
  test('takes the configured time for each print', async () => {
    const printers = new FakePrinters([{ ...SPEC[0], name: '慢标签机', printDelayMs: 50 } as FakePrinterSpec]);
    const started = performance.now();
    await printers.print('慢标签机', JOB, new AbortController().signal);
    expect(performance.now() - started).toBeGreaterThanOrEqual(45);
    expect(printers.printed).toHaveLength(1);
  });
```

`fake-printers.ts`：文件顶部加 `import { setTimeout as sleep } from 'node:timers/promises';`；`FakePrinterSpec` 加：

```ts
  /** 每张打多久（毫秒）；不设就立即打完。E2E 测暂停、取消用。 */
  printDelayMs?: number;
```

`FakePrinters.print` 改为：

```ts
  async print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void> {
    const spec = this.find(printerName);
    if (!spec) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    if (spec.printDelayMs !== undefined) {
      await sleep(spec.printDelayMs, undefined, { signal });
    }
    this.printed.push({
      printerName,
      raw: job.scan.raw,
      paper: paperKey(job.template.paper),
      templateId: job.template.id,
    });
  }
```

Run: `bun test src/main/printing/fake-printers.test.ts`
Expected: PASS。

- [ ] **Step 2: 写 E2E**

```ts
// e2e/batch.e2e.ts
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { minimalXlsx } from '../src/main/batch/testing/minimal-xlsx';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, fakePrints, stubOpenDialog } from './support/app-helpers';
import { expect, test } from './support/fixtures';

const LABEL_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
};
/** 暂停、取消的用例里每张打 300ms：按钮要在打完之前点到。 */
const SLOW_PRINT_MS = 300;
/** 暂停、取消后等正在打的那一张打完：它已经交出去了，收不回来。 */
const IN_FLIGHT_SETTLE_MS = SLOW_PRINT_MS * 2;

/** 60×40 分给标签机A（当前模板「通用」就是 60×40）。 */
async function assignLabelPrinter(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': LABEL_PRINTER.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function openBatch(page: Page): Promise<void> {
  await page.getByRole('button', { name: '批量打印' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '批量打印' })).toBeVisible();
}

function batchStatus(page: Page) {
  return page.locator('.batch-actions').getByRole('status');
}

test('prints the rows of a csv file in order with serials and finds them by batch', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER] });
  await assignLabelPrinter(page);
  const path = join(userData, 'rows.csv');
  await writeFile(path, '编码,颜色,尺码\nCL1,红,S\nCL2,蓝,M\nCL3,黑,L\n', 'utf8');
  await stubOpenDialog(app, path);
  await openBatch(page);
  await page.getByRole('button', { name: '选择文件…' }).click();
  await expect(page.getByText('rows.csv · 3 行 · 3 列')).toBeVisible();
  // 「通用」显示全部字段：每一列都印，再打开序号、补到 3 位。
  await page.getByLabel('印序号').check();
  await page.getByLabel('位数').fill('3');
  await page.getByRole('button', { name: '打印 3 张' }).click();
  await expect(batchStatus(page)).toContainText('全部已发送 · 已发送 3 / 3 张');
  expect((await fakePrints(app)).map((print) => print.raw)).toEqual([
    '编码：CL1\n颜色：红\n尺码：S\n序号：001',
    '编码：CL2\n颜色：蓝\n尺码：M\n序号：002',
    '编码：CL3\n颜色：黑\n尺码：L\n序号：003',
  ]);

  await page.getByRole('button', { name: '返回工作台' }).click();
  const records = page.locator('.job-row');
  await expect(records).toHaveCount(3);
  await expect(records.first()).toContainText('批量（第 3 行）');
  await records.first().getByRole('button', { name: '这一批' }).click();
  await expect(page.getByText(/^批次 \d{8}-\d{6}-[0-9a-f]{4}$/)).toBeVisible();
  await expect(records).toHaveCount(3);
});

test('reads an xlsx file in the reader process and takes copies from a column', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch({ fakePrinters: [LABEL_PRINTER] });
  const path = join(userData, 'rows.xlsx');
  await writeFile(
    path,
    minimalXlsx([
      ['编码', '数量'],
      ['CL1', '2'],
      ['CL2', '3'],
    ]),
  );
  await stubOpenDialog(app, path);
  await openBatch(page);
  await page.getByRole('button', { name: '选择文件…' }).click();
  await expect(page.getByText('rows.xlsx · 2 行 · 2 列')).toBeVisible();
  await page.getByRole('group', { name: '份数' }).getByRole('button', { name: '取一列' }).click();
  await page.getByLabel('份数列').selectOption('数量');
  await expect(page.getByRole('button', { name: '打印 5 张' })).toBeEnabled();
});

test('refuses an .xls file with a hint to save it as .xlsx or csv', async ({ electronApp }) => {
  const { app, page, userData } = await electronApp.launch();
  const path = join(userData, 'old.xls');
  await writeFile(path, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  await stubOpenDialog(app, path);
  await openBatch(page);
  await page.getByRole('button', { name: '选择文件…' }).click();
  await expect(page.getByRole('alert')).toContainText('另存为');
});

test('uses a table pasted from Excel', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await openBatch(page);
  await page.getByRole('button', { name: '粘贴表格' }).click();
  await page.getByLabel('粘贴从 Excel 复制的表格（第一行是列名）').fill('编码\t颜色\nCL9\t灰\n');
  await page.getByRole('button', { name: '用这些数据' }).click();
  await expect(page.getByText('粘贴的数据 · 1 行 · 2 列')).toBeVisible();
});

test('opens the batch page with a file dropped on the window', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['编码\nCL1\nCL2\n'], 'drop.csv', { type: 'text/csv' }));
    for (const type of ['dragover', 'drop']) {
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  });
  await expect(page.getByRole('heading', { level: 1, name: '批量打印' })).toBeVisible();
  await expect(page.getByText('drop.csv · 2 行 · 1 列')).toBeVisible();
});

test('pauses, resumes and cancels a running batch between labels', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [{ ...LABEL_PRINTER, printDelayMs: SLOW_PRINT_MS }] });
  await assignLabelPrinter(page);
  await openBatch(page);
  await page.getByRole('button', { name: '只按序号打' }).click();
  await page.getByLabel('张数').fill('20');
  await page.getByRole('button', { name: '打印 20 张' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(batchStatus(page)).toContainText('已暂停');
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  const pausedAt = (await fakePrints(app)).length;
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  expect((await fakePrints(app)).length).toBe(pausedAt);

  await page.getByRole('button', { name: '继续' }).click();
  await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThan(pausedAt);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(batchStatus(page)).toContainText('已取消');
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  const canceledAt = (await fakePrints(app)).length;
  await page.waitForTimeout(IN_FLIGHT_SETTLE_MS);
  expect((await fakePrints(app)).length).toBe(canceledAt);
  expect(canceledAt).toBeLessThan(20);
});
```

- [ ] **Step 3: 跑 E2E**

Run: `bun run test:e2e -- e2e/batch.e2e.ts`
Expected: 6 个用例通过。xlsx 那个用例同时证明构建版里 `utilityProcess` 子进程能启动、bundle 里带着 read-excel-file。再跑一次全部 `bun run test:e2e`。

- [ ] **Step 4: 提交**

```bash
git add src/main/printing/fake-printers.ts src/main/printing/fake-printers.test.ts e2e/batch.e2e.ts
git commit -m "test(e2e): batch printing from csv, xlsx, paste and drop, with pause and cancel" -m "Covers the reader process in the built app, serials and order of printed labels, records filtered by batch, the .xls hint, and pause or cancel taking effect between labels on a slow fake printer." -m "$TRAILER"
```

---

### Task 17: 视觉验收 V60–V62

**Files:**
- Modify: `e2e/visual/acceptance.visual.ts`
- Modify: `docs/superpowers/specs/2026-09-29-config-center-layout-design.md`（第 8.2 节的表）

- [ ] **Step 1: 加验收项**

文件顶部 import：`writeFile`（`node:fs/promises`）、`join`、`stubOpenDialog` 已经导入；在 `../support/app-helpers` 的 import 列表里按字母顺序加上 `fakePrints`。在 `PAPER_PRINTERS` 之后加：

```ts
/** V60–V62：一台 60×40 的假标签机，每张打 300ms（V62 要在打完之前暂停）。 */
const BATCH_PRINTERS: FakePrinterSpec[] = [
  {
    name: '标签机A',
    paper: { widthMm: 60, heightMm: 40, dpi: 203 },
    readiness: { ready: true },
    printDelayMs: 300,
  },
];
/** V61：12 行，第 5 行缺颜色（标黄）；表里没有「货架号」（对列标红）。 */
const BATCH_CSV = [
  '编码,颜色,尺码,备注',
  ...Array.from({ length: 12 }, (_, index) => `CL${5640 + index},${index === 4 ? '' : '图片色'},XL,第 ${index + 1} 箱`),
].join('\n');
/** V62：只按序号打这么多张，暂停时还剩很多。 */
const BATCH_SERIAL_COUNT = 30;

async function openBatchPage(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { paperPrinters: { '60x40': '标签机A' } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
  await page.getByRole('button', { name: '批量打印' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '批量打印' })).toBeVisible();
}
```

在 `ITEMS` 数组里、当时最后一项之后（写计划时是 V44；设计器 1b 可能已加了 V45+）加：

```ts
  {
    id: 'V60',
    title: '批量打印 · 刚打开',
    points:
      '页头「← 返回工作台」和标题「批量打印」；五段（模板、数据、对列、序号与份数、预览）自上而下，没有数据时预览段只有一句说明；底部操作条「打印 0 张」灰掉；标题栏「批量打印」是按下状态，「配置」不是；1024 宽时标题栏不换行、不溢出',
    launch: { fakePrinters: BATCH_PRINTERS },
    setup: async ({ page }) => {
      await openBatchPage(page);
    },
  },
  {
    id: 'V61',
    title: '批量打印 · 导入后的对列和预览',
    points:
      '数据行「batch.csv · 12 行 · 4 列」；对列表里 {货架号} 标红并说明可以不填；第 5 行（缺颜色）整行标黄、悬停能看到「缺：颜色」；表头固定，列多时表格自己横向滚动、页面不变宽；右侧是当前行的真实预览（吊牌），上方「上一张 / 下一张」；预览段顶部「共 12 行 · 打 12 张 · 1 行有问题（标黄）」；1024 宽时表格和预览上下排列',
    launch: { fakePrinters: BATCH_PRINTERS },
    setup: async ({ app, page, userData }) => {
      const path = join(userData, 'batch.csv');
      await writeFile(path, BATCH_CSV, 'utf8');
      await stubOpenDialog(app, path);
      await openBatchPage(page);
      await page.getByLabel('模板').selectOption({ label: '吊牌（自由设计示例）' });
      await page.getByRole('button', { name: '选择文件…' }).click();
      await expect(page.getByText('batch.csv · 12 行 · 4 列')).toBeVisible();
      // 检查条码和排版期间汇总后面带着「正在检查…」：等它查完再截图。
      await expect(page.locator('.batch-preview__summary')).toHaveText('共 12 行 · 打 12 张 · 1 行有问题（标黄）');
      await page.getByRole('heading', { level: 2, name: '5 预览' }).scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'V62',
    title: '批量打印 · 暂停中',
    points:
      '底部操作条：「已暂停（点继续接着打）· 已发送 n / 30 张」、进度条、「继续」（主按钮）「取消」；标题栏「批量打印」按钮上的进度「n/30」用等宽数字；提示条不盖住操作条',
    launch: { fakePrinters: BATCH_PRINTERS },
    setup: async ({ app, page }) => {
      await openBatchPage(page);
      await page.getByRole('button', { name: '只按序号打' }).click();
      await page.getByLabel('张数').fill(String(BATCH_SERIAL_COUNT));
      await page.getByRole('button', { name: `打印 ${BATCH_SERIAL_COUNT} 张` }).click();
      // 进度是合并推送的，文字可能跳过某个数：按假打印机实际收到的张数等。
      await expect.poll(async () => (await fakePrints(app)).length).toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: '暂停' }).click();
      await expect(page.locator('.batch-actions').getByRole('status')).toContainText('已暂停');
    },
  },
```

文件开头的说明注释「设计文档 §8.2 的 V01–V44」改为「设计文档 §8.2 的验收项（V01 起；批量打印是 V60–V62）」。

- [ ] **Step 2: 设计文档的验收表**

`docs/superpowers/specs/2026-09-29-config-center-layout-design.md` 第 8.2 节表格的最后一行之后加：

```
| V60 | 批量打印 · 刚打开 | 页头「← 返回工作台」和标题；五段自上而下，没有数据时预览段只有一句说明；「打印 0 张」灰掉；标题栏「批量打印」按下、「配置」没按下；1024 宽时标题栏不溢出 |
| V61 | 批量打印 · 导入后的对列和预览 | 对列里没对上的标红；缺字段的行整行标黄、悬停看到原因；表头固定、表格自己横向滚动；右侧当前行的真实预览和上一张 / 下一张；顶部汇总；1024 宽时上下排列 |
| V62 | 批量打印 · 暂停中 | 「已暂停（…）· 已发送 n / 30 张」、进度条、「继续」「取消」；标题栏按钮上的进度；提示条不盖住操作条 |
```

- [ ] **Step 3: 跑视觉验收并逐张核对**

Run: `bunx playwright test --config e2e/visual/playwright.config.ts -g "V6"`
Expected: V60–V62 在 1280 / 1024 / 1920 三种尺寸下通过自动检查；打开 `test-results/visual-acceptance/` 里的截图逐项核对 points。如果 V60 在 1024 宽时标题栏溢出（自动检查会报），在 `app.css` 已有的 `@media (max-width: 1279px)` 规则里加一条让出店铺名：

```css
  .title-bar:has(.batch-button) .title-bar__shop-name {
    display: none;
  }
```

再跑一次。全部视觉验收跑一遍确认没有别的项受影响：`bunx playwright test --config e2e/visual/playwright.config.ts`。

- [ ] **Step 4: 提交**

```bash
git add e2e/visual/acceptance.visual.ts docs/superpowers/specs/2026-09-29-config-center-layout-design.md
git commit -m "test(visual): acceptance items for the batch printing page" -m "V60 to V62 cover the empty page, the imported table with unmatched variables and problem rows beside the live preview, and a paused batch, at 1280, 1024 and 1920 wide. Numbered from V60 so they do not collide with the designer's items." -m "$TRAILER"
```

（如果 Step 3 改了 `app.css`，一起 `git add`。）

---

### Task 18: 文档

**Files:**
- Modify: `README.md`、`docs/roadmap.md`
- Modify: `docs/superpowers/specs/2026-10-01-feature-parity-design.md`（第 5 节）
- Modify: `docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md`（打印结果通知的 `source`）
- Modify: `CLAUDE.md`、`src/core/CLAUDE.md`、`src/main/CLAUDE.md`、`src/renderer/CLAUDE.md`

- [ ] **Step 1: README**

「功能」列表里「**本机接口**」那一条之前加：

```
- **批量打印**：点标题栏「批量打印」（或把 .xlsx / .csv 拖进窗口），一页里自上而下设置：
  - 选模板（标签、面单、自由设计都行）；导入 Excel（.xlsx）或 CSV（支持中文 Excel 默认的 GBK 编码），或粘贴从 Excel 复制的表格，或不用数据、只按序号打几张。第一行是列名，最多 1 万行。.xls（97-2003）请先另存为 .xlsx 或 CSV。
  - 模板用到的每个字段按列名自动对上，对不上的标红，可以手动选一列或填固定值；序号 `{序号}` 可设前缀、起始、步长、位数（补零）、后缀，也可以取表里的一列；每行固定几份，或取「份数」列。
  - 左边是数据（可勾选要打的行、搜索），右边是当前行打出来的真实样子；缺字段、条码印不了的行标黄，汇总在顶部。
  - 按表格顺序一张一张打，可暂停、继续、取消；缺纸、没分配打印机时自动暂停，处理好后点继续接着打那一张；失败的行可以单独重打。不受防重复打印的时间窗口影响。
  - 每张一条打印记录（来源「批量」，带批次号、行号），打印记录里点「这一批」只看这一批，可以整批重打失败的。
  - Excel 文件在单独的子进程里读取（限时、限内存），坏文件不会影响程序本身。
```

- [ ] **Step 2: 路线图**

`docs/roadmap.md` 状态表里「多台打印机、多种纸张」那一行之后加：

```
| 批量打印：导入 .xlsx / .csv 或粘贴表格，模板变量对列、序号、份数，逐行预览（问题行标黄），按顺序打印、暂停 / 继续 / 取消、失败的单独重打；记录按批次筛选、整批重打失败的；Excel 在隔离的子进程里读 | 必须 | 开发完成（`feature/batch-printing`），随 2.0.0 发布；设计：`docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 5 节。Windows 上 E2E 和视觉验收 V60–V62 通过；真机批量打 100 张、macOS 待人工验收 |
```

- [ ] **Step 3: 设计文档第 5 节**（把实现时定下的细节写回去，在「**本机接口**：已有的批量提交不变。」之后加）

```
- **实现时定下的细节**（2026-10-02）：
  - 行号从 1 数，不含表头；序号按「要打的行」的顺序数（第一行要打的是起始值，跳过的行不占号），同一行的几份序号相同。
  - `{序号}` 不是新的固定变量：批量打印把它作为名为「序号」的字段交给模板，三类模板都按字段展开。「显示全部字段」的标签模板没有写 `{序号}`，由操作员勾「印序号」决定（只按序号打时一定印）。
  - 「显示全部字段」的模板：表格的每一列都是一个字段（空格子不印）。
  - 份数列空着按 1 份；0 或不是 0–100 的整数时这一行不打并标黄。一批最多 2 万张。
  - 有问题的行照样打（缺的那一项空着），只是标黄提醒；要跳过就取消勾选。
  - 打印机不能用（没分配、找不到、缺纸离线）时整批自动暂停，那一张不算失败，继续时重打它；驱动报错、超时记为失败、接着打。
  - 重打失败的（单行或整批）用同一个批次号、行号、份号和当时的模板、字段；打印记录按「每行每份最新一条」判断还失败着的。
  - 表格只在主进程里留最近一张；程序退出时没打完的部分不保留（已发送和失败的都在打印记录里）。
  - Excel 在 `utilityProcess` 里读：一个文件一个子进程，30 秒超时、512MB 堆上限；文件 ≤ 20MB、≤ 1 万行、≤ 100 列、单元格 ≤ 1000 字、整表 ≤ 500 万字。
```

- [ ] **Step 4: 打印结果通知的来源**（`2026-09-28-generic-scan-rules-design.md`）

把「`source` 是 `desktop`（扫码枪）、`history`（记录重打）、`mobile`（手机）或 `api`（本机接口）；本机接口打的不经过识别规则，`rule` 固定为 `{ "id": "api", "name": "本机接口" }`，`fields` 是调用方给的字段。」改为：

```
`source` 是 `desktop`（扫码枪）、`history`（记录重打）、`mobile`（手机）、`api`（本机接口）或 `batch`（批量打印）；本机接口打的不经过识别规则，`rule` 固定为 `{ "id": "api", "name": "本机接口" }`，`fields` 是调用方给的字段；批量打印的 `rule` 固定为 `{ "id": "batch", "name": "批量打印" }`，`fields` 是这一行对出来的字段（含序号）。
```

- [ ] **Step 5: CLAUDE.md**

根目录 `CLAUDE.md`「编码约定」的「依赖」一条里，`bwip-js（自由设计模板的条码编码）` 之后加 `、read-excel-file（批量打印读 .xlsx，只在读表格的子进程里用）`。「架构」代码块里 `src/main` 一行末尾的括号内加 `、批量打印（batch/）`。

`src/core/CLAUDE.md` 模块表在 `lookup/` 一行之后加：

```
| `batch/` | 批量打印的纯逻辑：`batch-model.ts`（类型、`BATCH_LIMITS`、序号字段名、批次号）、`column-mapping.ts`（按列名自动对列）、`serial.ts`、`batch-labels.ts`（行 → 标签：字段、份数、问题行；单行预览）、`parse-batch-plan.ts`（界面交来的设置严格校验）、`batch-runner.ts`（`BatchRun`：按顺序逐张经 `printFields` 打，暂停 / 继续 / 取消，打印机不能用时自动暂停、那一张继续时重打） |
```

并把 `lookup/` 一行改为「CSV 解析（含 GBK 编码的中文 Excel；上限和分隔符可传入，Excel 读出的行也走 `tableFromRecords`）和查找索引」。

`src/main/CLAUDE.md`「其他子系统」表之后加一节：

```
## 批量打印（`batch/`）

设计见 `docs/superpowers/specs/2026-10-01-feature-parity-design.md` 第 5 节。

- **读表格在子进程里**（Chromium 两条法则）：`table-reader-host.ts` 每读一个文件 `utilityProcess.fork` 一个子进程（入口 `reader-worker.ts`，由 `index.ts` 以 `?modulePath` 引入、单独打包），30 秒超时、512MB 堆上限，读完就结束；子进程只收字节（不给路径），只回文字的二维数组，主进程再核对形状和上限（`readReply`），表头规则走 core 的 `tableFromRecords`。读取逻辑在 `table-file.ts`（不 import electron，用 `bun test` 测，`testing/minimal-xlsx.ts` 生成测试用的 .xlsx）。`.xls` 按扩展名和文件头拒绝。
- **`batch-station.ts`**：只留最近一张表；预览、检查（把每行排一遍找出条码印不了的，分段让出主线程，新的检查开始时放弃旧的）和打印用同一份 HTML；同一时间只有一批在打；进度最多 0.25 秒推一次（`batch:status-changed`），状态变化立即推，同时推 `jobs:changed`。
- **拖进窗口的文件**：界面读成字节经 `batch:read-dropped` 交来，主进程不接受任何路径（打开对话框选的文件由主进程自己读）。
- **静默更新**：批量打印还有没打的（含暂停中的）时不静默更新。
```

`src/main/CLAUDE.md`「打包相关」加一条：

```
- **子进程入口**：读表格的子进程用 `?modulePath` 引入（electron-vite 单独打包），产物也在 `out/main/` 下，`verify:bundle` 一并检查。
```

`src/renderer/CLAUDE.md`：第一段「页面结构（工作台 + 全窗口的配置中心）」改为「页面结构（工作台 + 全窗口的配置中心；批量打印页和配置中心同级）」；「测试与验收」的 E2E 一条括号里加「，批量打印在 `batch.e2e.ts`」；「扫码相关」的「不能打印的界面」一条改为「配置中心和批量打印页里扫码永远不打印（F2 也不行）；……」。

- [ ] **Step 6: `bun run check` 后提交，推送，开 PR**

```bash
git add README.md docs/roadmap.md docs/superpowers/specs/2026-10-01-feature-parity-design.md docs/superpowers/specs/2026-09-28-generic-scan-rules-design.md CLAUDE.md src/core/CLAUDE.md src/main/CLAUDE.md src/renderer/CLAUDE.md
git commit -m "docs: describe batch printing" -m "README, roadmap, the decisions made while building it, the batch source in result notifications, and where the batch code lives in each layer." -m "$TRAILER"
git push -u origin feature/batch-printing
gh pr create --base master --title "feat: batch printing (sub-project 3)" --body "<中文说明：做了什么、为什么、验证（单元测试、E2E、视觉验收 V60–V62、dist:win 装一次读 .xlsx）；只在 Windows 上验证过的写明；结尾带 Claude Code 署名>"
```

Expected: CI 在 Windows 和 macOS 上都通过后合并。合并前在 Windows 上 `bun run dist:win`，装一次，导入一个真 Excel 保存的 .xlsx（含日期、数字、中文）打几张到真打印机，确认安装版里子进程能启动（asar 里的入口、fuses 不影响 `utilityProcess`）。

---

## Self-Review 记录

- **设计覆盖（第 5 节）**：入口（标题栏、拖文件、和配置中心同级、配置中心不打印不变）→ Task 12、14；步骤 1 选模板 → Task 13；2 数据（.xlsx / .csv、拖、粘贴、只按序号、表头、1 万行）→ Task 2、8、9、10、13、14；3 对列（按列名自动、标红、手动或固定值）→ Task 3、13；4 序号（前缀、起始、步长、位数、后缀、取一列）→ Task 3、4、13；5 份数（固定或一列）→ Task 4、13；6 预览（勾选、搜索、真实预览、上一张 / 下一张、问题行标黄、顶部汇总）→ Task 10（检查）、12、13；7 打印（进度、暂停、继续、取消、失败单独重打、不受防重复窗口影响）→ Task 5、7、10、13；实现（主进程 `batch/`、`printFields` 来源 batch、按行依次入队、进度经 IPC）→ Task 9–11；记录（来源「批量」、批次号和行号、按批次筛选、整批重打失败的）→ Task 6、7、15。第 9 节（不可信输入、上限）→ Task 2、4、8、9、11；第 11 节（Rule of 2、IPC 信任边界、最小能力、快速失败）→ Task 4（严格校验）、9（子进程）、11（字节不传路径）。
- **没有占位**：每个代码步骤给出完整代码；Task 8 Step 5、Task 11 Step 8 和 Task 17 Step 3 是「如果检查不过就这样改」的分支，改法也完整给出。
- **类型一致**：`BatchLabel { row, copy, fields, content }`（Task 3）在 Task 4、5、10 用到；`BatchRef { id, row, copy }`（Task 6）在 Task 7 的 `FieldsPrint.batch`、Task 10 的 `printFields` 调用里用；`BatchProgress`（Task 5）是 `BatchStatus`（Task 10）的基础；`TableReadRequest / TableReadReply`（Task 8）在 Task 9、10 用；`BatchPlan`（Task 3）经 `parseBatchPlan`（Task 4）进 `requireBatchPlan`（Task 11），界面由 `buildPlan`（Task 12）生成；`RowProblem.row` 和 `BatchFailure.row` 都从 1 数，界面的 `problemsByRow`、`failuresByRow` 按从 1 数的行号作键，`BatchRows` 用 `index + 1` 查。
- **迁移**：只追加第 6 条，照第 3、5 条的重建写法；`jobs_batch` 是部分索引，`batch_id = ?` 的查询能用上。
