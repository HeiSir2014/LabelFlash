import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { type TemplateFields, templateFields } from '../../core/api/template-fields';
import { type LabelPlanInput, labelForRow, planLabels } from '../../core/batch/batch-labels';
import {
  BATCH_LIMITS,
  type BatchLabel,
  type BatchPlan,
  type BatchTable,
  FILE_TOO_LARGE_ISSUE,
  type RowProblem,
} from '../../core/batch/batch-model';
import { type BatchFailure, type BatchProgress, BatchRun, type BatchState } from '../../core/batch/batch-runner';
import { mappableVariables } from '../../core/batch/column-mapping';
import { splitCsvRecords, tableFromRecords } from '../../core/lookup/csv';
import type { FieldsPrint } from '../../core/print-service';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { JobRecord, PrintFailureReason, PrintResult } from '../../core/types';
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
/**
 * 打印记录变了（JobsChanged）最快多久推一次：状态没变的合并推送本来就已经按 PROGRESS_INTERVAL_MS 节流了，
 * 但打印记录列表比批量打印的状态条重得多（界面会重新拉一页），没必要跟着每一次合并推送都刷新；
 * 状态变化（开始、暂停、打完）仍然立即推，操作员切到打印记录页能马上看到。
 */
const JOBS_CHANGED_MIN_INTERVAL_MS = 1_000;
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
  /** 写了打印记录：界面刷新打印记录（和进度一起合并推送，但节流得更松：见 JOBS_CHANGED_MIN_INTERVAL_MS）。 */
  onJobsChanged: () => void;
  /** 当前时间（毫秒）：只用来给 onJobsChanged 的节流计时，测试里换成可控的假时钟。 */
  now: () => number;
}

interface CurrentBatch {
  run: BatchRun;
  template: LabelTemplate;
  templateName: string;
  finished: Promise<void>;
}

/** 一个还没解决的失败：重打成功就从 BatchStation 的名单里删掉，不管是哪一次尝试打的。 */
interface OpenFailure {
  label: BatchLabel;
  reason: PrintFailureReason;
}

type Prepared = { ok: true; template: LabelTemplate; input: LabelPlanInput } | { ok: false; issue: string };

/**
 * 主进程的批量打印：读表格（子进程）、保存最近一张表、按界面交来的设置预览和检查、开打和重打失败的。
 * 同一时间只有一批在打；表格只留最近一张（一万行的表不小，换了文件旧的就没用了）。不 import electron。
 */
export class BatchStation {
  private table: BatchTable | null = null;
  /** 还在读一张表（最新的一次导入的编号）：慢的那次读完之后，发现有更新的导入已经开始，结果就作废。 */
  private loadGeneration = 0;
  private current: CurrentBatch | null = null;
  private lastState: BatchState | null = null;
  private cancelFlush: (() => void) | null = null;
  private checkGeneration = 0;
  private lastJobsChangedAt = 0;
  /** 每一批（这次会话里打过的）还没解决的失败：(row, copy) → 失败时的标签和原因。重打成功就删掉，
   *  不管是整批第几次重打、哪一次打的。「整批重打失败的」永远用这份合并后的名单，不会因为只重打了
   *  一部分就忘记其余还没解决的。 */
  private readonly openFailures = new Map<string, Map<string, OpenFailure>>();
  /** 这次会话里打过的每一批用的模板：重打时要用，不依赖 this.current（可能已经是后来另一批了）。 */
  private readonly templatesByBatch = new Map<string, LabelTemplate>();

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

  /**
   * 拖进窗口的文件（界面读成字节传来）或 loadPath 读到的内容。读表格要去子进程跑一趟，比较慢：
   * 这次导入期间如果又开始了更新的一次（甚至已经导入完）， generation 和开始时记的不一样，
   * 这次读出来的结果就作废（按「取消」处理），不会用旧结果覆盖更新的导入。
   */
  async loadBytes(fileName: string, bytes: Uint8Array): Promise<BatchTableResult> {
    if (bytes.length > BATCH_LIMITS.fileBytes) {
      return { status: 'invalid', issue: FILE_TOO_LARGE_ISSUE };
    }
    const kind = tableFileKind(fileName, bytes);
    if (!kind.ok) {
      return { status: 'invalid', issue: kind.issue };
    }
    const generation = ++this.loadGeneration;
    const reply = await this.deps.readTable({ kind: kind.kind, bytes });
    if (!reply.ok) {
      return { status: 'invalid', issue: reply.issue };
    }
    return this.keep(fileName, reply.records, generation);
  }

  /** 从 Excel 复制、粘贴进来的表格（Tab 分隔）：自己的解析器、TypeScript 内存安全，在主进程里解析。 */
  paste(text: string): BatchTableResult {
    const records = splitCsvRecords(text, '\t');
    const generation = ++this.loadGeneration;
    return records.ok
      ? this.keep(PASTED_TABLE_NAME, records.rows, generation)
      : { status: 'invalid', issue: records.issue };
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
    if (!prepared.ok) {
      return { problems: [], issue: prepared.issue };
    }
    const planned = planLabels(prepared.input);
    if (!planned.ok) {
      return { problems: [], issue: planned.issue };
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

  /**
   * 重打一批里失败的标签（row 不为 null 时只重打那一行）：同一个批次号、行号、份号，当时的模板和字段。
   * 这一批如果是这次会话里打过的（哪怕后来又开始了别的批），用 BatchStation 合并了每一次尝试之后
   * 还没解决的失败名单——打印记录按容量环形保留，条数可能比一批的张数（最多 2 万）小，
   * 查出来的会少于实际失败的；只重打过一部分时，没重打到的那些也不会因为换了一次 BatchRun 就丢掉。
   * 换了别的批、或跨了重启，内存里已经没有了，退回查打印记录（受保留条数限制）。
   */
  retryFailed(batchId: string, row: number | null): BatchStartResult {
    if (this.current?.run.isActive === true) {
      return { status: 'invalid', issue: BUSY };
    }
    const open = this.openFailures.get(batchId);
    if (open !== undefined) {
      const labels = [...open.values()]
        .filter((failure) => row === null || failure.label.row === row)
        .map((failure) => failure.label);
      if (labels.length === 0) {
        return { status: 'invalid', issue: NO_FAILURES };
      }
      const template = this.templatesByBatch.get(batchId);
      // 模板对象还在，但这个编号的模板可能已经被删掉了（或者改存了别的模板）：重打前再核对一遍。
      if (template === undefined || this.deps.findTemplate(template.id) === null) {
        return { status: 'invalid', issue: RETRY_TEMPLATE_GONE };
      }
      return this.begin(batchId, template, labels);
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

  /**
   * 当前（或最近一次）这一批的进度；还没打过时为 null。失败数和失败名单来自合并了每一次尝试之后
   * 还没解决的失败（见 openFailures），不是这一次 BatchRun 自己的——重打过一部分之后，这里看到的
   * 还是整批真正剩下的失败，不会因为只重打了一部分就把其余的漏掉。
   */
  status(): BatchStatus | null {
    if (this.current === null) {
      return null;
    }
    const snapshot = this.current.run.snapshot();
    const open = [...(this.openFailures.get(this.current.run.batchId)?.values() ?? [])];
    const failures: BatchFailure[] = open
      .slice(0, BATCH_STATUS_FAILURES)
      .map(({ label, reason }) => ({ row: label.row, copy: label.copy, reason }));
    return {
      ...snapshot,
      failed: open.length,
      failures,
      templateName: this.current.templateName,
    };
  }

  /** 测试用：等这一批结束。 */
  whenIdle(): Promise<void> {
    return this.current?.finished ?? Promise.resolve();
  }

  /**
   * 退出程序前要确认的：当前这一批还没轮到的标签（不含正在打的那一张——它已经交给了打印机，
   * 可能已经出纸，不能当成「没打」）。没有正在打的批次，或者已经没有剩下的，返回 null，
   * 调用方（主进程的退出确认）直接照常退出，不用再多判断一次。
   */
  pendingQuit(): { batchId: string; template: LabelTemplate; labels: readonly BatchLabel[] } | null {
    if (this.current === null) {
      return null;
    }
    const labels = this.current.run.unattemptedLabels();
    return labels.length === 0 ? null : { batchId: this.current.run.batchId, template: this.current.template, labels };
  }

  private keep(fileName: string, records: readonly (readonly string[])[], generation: number): BatchTableResult {
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
    if (generation !== this.loadGeneration) {
      // 这次读完之前，已经开始了更新的一次导入（甚至已经导入完）：这次的结果作废，不能覆盖更新的那次。
      return { status: 'canceled' };
    }
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
    const fields = templateFields(template);
    if (table !== null) {
      const stale = staleColumns(plan, fields, table.columns);
      if (stale.length > 0) {
        return { ok: false, issue: `对的列已经不在表里，需要重新对列：${stale.join('、')}` };
      }
    }
    return { ok: true, template, input: { table, plan, fields } };
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
    this.current = { run, template, templateName: template.name, finished };
    this.templatesByBatch.set(batchId, template);
    this.lastState = null;
    // run() 本身不该 reject（onChange 抛错已经在 BatchRun 内部兜住，print() 的异常也转成失败），
    // 但这里仍然 .catch：防止版本以外的意外把这个 Promise 的 rejection 落地成未处理异常，带崩主进程。
    void run
      .run()
      .catch((error: unknown) => {
        console.error(`[batch] batch ${batchId} stopped unexpectedly`, error);
      })
      .finally(() => {
        this.reconcileOpenFailures(batchId, labels, run);
        markFinished();
      });
    const status = this.status();
    if (status === null) {
      throw new Error(`Batch ${batchId} has no status right after it started`);
    }
    return { status: 'started', batch: status };
  }

  private changed(progress: BatchProgress): void {
    if (progress.state !== this.lastState) {
      this.lastState = progress.state;
      this.flush(true);
      return;
    }
    this.cancelFlush ??= this.deps.schedule(() => {
      this.cancelFlush = null;
      this.flush(false);
    }, PROGRESS_INTERVAL_MS);
  }

  /**
   * 状态条随每一次合并推送更新（至多每 PROGRESS_INTERVAL_MS 一次）；打印记录的刷新通知更贵
   * （界面会重新拉一页），状态变化时立即推，其余时候至多每 JOBS_CHANGED_MIN_INTERVAL_MS 推一次。
   */
  private flush(isStateChange: boolean): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.deps.onStatus(this.status());
    const now = this.deps.now();
    if (isStateChange || now - this.lastJobsChangedAt >= JOBS_CHANGED_MIN_INTERVAL_MS) {
      this.lastJobsChangedAt = now;
      this.deps.onJobsChanged();
    }
  }

  /**
   * 这一批打完一次之后，把这次尝试的结果合并进 openFailures：这次失败的（不管是不是之前也失败过）
   * 记下标签和原因；这次成功的（哪怕之前失败过，这次重打成功了）从名单里删掉。
   * 用 BatchRun 自己不截断的 failedLabels/failedReasons，不是 snapshot()（那个按展示用途截断了）。
   */
  private reconcileOpenFailures(batchId: string, labels: readonly BatchLabel[], run: BatchRun): void {
    const failedLabels = run.failedLabels(null);
    const reasonByKey = new Map(run.failedReasons(null).map((failure) => [rowCopyKey(failure), failure.reason]));
    const open = this.openFailures.get(batchId) ?? new Map<string, OpenFailure>();
    for (const label of labels) {
      const key = rowCopyKey(label);
      // 先删再写：重新失败的这一条挪到 Map 的末尾，配合 status() 的「最近失败的在前」顺序。
      open.delete(key);
    }
    for (const label of failedLabels) {
      const reason = reasonByKey.get(rowCopyKey(label));
      if (reason !== undefined) {
        open.set(rowCopyKey(label), { label, reason });
      }
    }
    if (open.size === 0) {
      this.openFailures.delete(batchId);
    } else {
      this.openFailures.set(batchId, open);
    }
  }
}

/** 对列、份数列、序号列里引用到的列名，筛出这张表里已经没有的那些（去重）。
 *  对列只看模板现在还会用到的变量（模板换了之后，旧设置里残留的变量不算数）；序号列只在序号确实会印时才算。 */
function staleColumns(plan: BatchPlan, fields: TemplateFields, columns: readonly string[]): string[] {
  const referenced = new Set<string>();
  const relevantVariables = new Set(mappableVariables(fields));
  for (const [variable, source] of Object.entries(plan.mapping)) {
    if (source.kind === 'column' && relevantVariables.has(variable)) {
      referenced.add(source.column);
    }
  }
  if (plan.copies.kind === 'column') {
    referenced.add(plan.copies.column);
  }
  if (plan.serial.enabled && plan.serial.column !== null) {
    referenced.add(plan.serial.column);
  }
  return [...referenced].filter((column) => !columns.includes(column));
}

/** 行号、份号拼成的键：和 batch-runner.ts 的 key() 同样的用途，这里单独定义一份（不跨模块暴露内部细节）。 */
function rowCopyKey(labelOrFailure: { row: number; copy: number }): string {
  return `${labelOrFailure.row}:${labelOrFailure.copy}`;
}
