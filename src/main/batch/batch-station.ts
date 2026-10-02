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
    const snapshot = this.current.run.snapshot();
    return {
      ...snapshot,
      failures: snapshot.failures.slice(0, BATCH_STATUS_FAILURES),
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

  /**
   * 模板、表格都对得上之后，再核对对列、份数列、序号列有没有指着一个已经不在表里的列
   * （表格重新导入过、或对列设置没跟着改）：一次性说清楚，不要留到 planLabels 把同一个问题在每一行都报一遍。
   */
  private prepare(plan: BatchPlan): Prepared {
    const template = this.deps.findTemplate(plan.templateId);
    if (template === null) {
      return { ok: false, issue: TEMPLATE_GONE };
    }
    if (plan.data.kind === 'table' && this.table?.id !== plan.data.tableId) {
      return { ok: false, issue: TABLE_GONE };
    }
    const table = plan.data.kind === 'table' ? this.table : null;
    if (table !== null) {
      const stale = staleColumns(plan, table.columns);
      if (stale.length > 0) {
        return { ok: false, issue: `对的列已经不在表里，需要重新对列：${stale.join('、')}` };
      }
    }
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
    // run() 本身不该 reject（onChange 抛错已经在 BatchRun 内部兜住，print() 的异常也转成失败），
    // 但这里仍然 .catch：防止版本以外的意外把这个 Promise 的 rejection 落地成未处理异常，带崩主进程。
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

/** 对列、份数列、序号列里引用到的列名，筛出这张表里已经没有的那些（去重）。 */
function staleColumns(plan: BatchPlan, columns: readonly string[]): string[] {
  const referenced = new Set<string>();
  for (const source of Object.values(plan.mapping)) {
    if (source.kind === 'column') {
      referenced.add(source.column);
    }
  }
  if (plan.copies.kind === 'column') {
    referenced.add(plan.copies.column);
  }
  if (plan.serial.column !== null) {
    referenced.add(plan.serial.column);
  }
  return [...referenced].filter((column) => !columns.includes(column));
}
