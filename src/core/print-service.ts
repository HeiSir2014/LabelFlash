import { type PaperSize, paperKey } from '../shared/paper-sizes';
import { type DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { type PrintFailure, toPrintFailure } from './errors';
import type { JobStore } from './job-store';
import type { PrintQueue } from './print-queue';
import type { PrinterChoice } from './printing/resolve-printer';
import { type EnrichContext, type EnrichResult, NO_ENRICH_CONTEXT } from './scan/enrich';
import { MAX_RAW_LENGTH, normalizeRaw } from './scan/normalize-raw';
import type { ScanField, ScanResult } from './scan/scan-result';
import { type LabelTemplate, withPaper } from './templates/template-model';
import type {
  Clock,
  JobRecord,
  LabelJob,
  PreviewResult,
  PrinterAdapter,
  PrintRequest,
  PrintResult,
  PrintSource,
  RecordedResult,
} from './types';

export const TEST_RAW = 'TEST-0001-测试色-XL';

/** 所有识别规则都关掉时，测试页仍然要能打：整段内容作为一个字段。 */
const TEST_FALLBACK_SCAN: ScanResult = {
  raw: TEST_RAW,
  ruleId: 'builtin:test',
  ruleName: '测试页',
  fields: [{ name: '内容', value: TEST_RAW }],
};

export interface PrintServiceDeps {
  adapter: PrinterAdapter;
  store: JobStore;
  guard: DedupGuard;
  queue: PrintQueue;
  clock: Clock;
  createId: () => string;
  /** 按本机当前启用的规则识别；每次调用都读取最新规则，改规则立即生效。 */
  recognize: (raw: string) => ScanResult | null;
  /** 执行命中规则的加工步骤。 */
  enrich: (scan: ScanResult, context: EnrichContext) => Promise<EnrichResult>;
  /** 本次识别结果用的模板（规则绑定的模板或当前模板）；每次打印时读取，切换模板立即生效。 */
  resolveTemplate: (scan: ScanResult) => LabelTemplate;
  /**
   * 这个模板用哪台打印机（模板指定 → 纸张分配，见 printing/resolve-printer.ts）；每次打印都重新决定，
   * 改了分配立即生效。实现不能抛错：读不到打印机列表时自己兜底。
   */
  choosePrinter: (template: LabelTemplate) => Promise<PrinterChoice>;
  /** 每条打印记录写入后调用（打印结果通知在这里入队）；实现不能抛错、不能阻塞。测试页不调用。 */
  onRecorded?: (job: JobRecord, scan: ScanResult | null) => void;
}

/** 这一张打到哪、用什么纸和模板；识别不了的记录没有这些。 */
interface JobTarget {
  printerName: string;
  paper: string | null;
  templateId: string | null;
}

const NO_TARGET: JobTarget = { printerName: '', paper: null, templateId: null };

/** 按模板打印的几种入口在这几处不同。 */
interface LabelOptions {
  /** 扫码内容的防重复窗口：扫码枪、手机要；本机接口靠调用方的 requestId，不用它。 */
  dedup: boolean;
  /** 执行识别规则的加工步骤：扫码要；本机接口的字段由调用方给出，不执行。 */
  enrich: boolean;
  /** 调用方指定的打印机（接口已核对过在系统里）；null = 按模板决定。 */
  printerName: string | null;
}

const SCAN_OPTIONS: LabelOptions = { dedup: true, enrich: true, printerName: null };

/** 本机接口的识别结果里的「规则」：备注变量 {规则} 和打印结果通知里显示为「本机接口」。 */
export const API_RULE = { id: 'api', name: '本机接口' } as const;

/** 不经过识别规则的一张的识别结果（预览按记录重打时也用它，和打印时一致）。 */
export function fieldsScan(content: string, fields: ScanField[]): ScanResult {
  return { raw: content, ruleId: API_RULE.id, ruleName: API_RULE.name, fields };
}

/** 不经过识别规则的一张：本机接口提交的，或从打印记录按当时的模板和字段重打的。 */
export interface FieldsPrint {
  template: LabelTemplate;
  fields: ScanField[];
  /** 完整内容：二维码的「完整内容」、底部整行、{完整内容}；也是打印记录的 raw。 */
  content: string;
  source: PrintSource;
  caller: string | null;
  printerName: string | null;
}

type Recognition = { ok: true; scan: ScanResult } | { ok: false; result: Extract<PrintResult, { status: 'invalid' }> };

/** 所有入口（扫码枪、记录重打、手机扫码、本机接口）的唯一业务入口。 */
export class PrintService {
  constructor(private readonly deps: PrintServiceDeps) {}

  /** 启动时从打印记录回放门限状态，重启后窗口仍然有效。 */
  restore(): void {
    const since = this.deps.clock.now() - MAX_DEDUP_WINDOW_MS;
    for (const { raw, printedAt } of this.deps.store.listLastPrinted(since)) {
      this.deps.guard.restore(raw, printedAt);
    }
  }

  /** 预览同样执行加工步骤（HTTP 查询的结果会被缓存，紧接着打印时直接用）。 */
  async preview(raw: string): Promise<PreviewResult> {
    const recognition = this.recognize(raw);
    if (!recognition.ok) {
      return recognition.result;
    }
    const template = this.deps.resolveTemplate(recognition.scan);
    const enriched = await this.enrich(recognition.scan, NO_ENRICH_CONTEXT);
    const { scan } = enriched;
    return {
      status: 'ok',
      scan,
      recent: this.deps.guard.peek(scan.raw),
      lookupFailure: enriched.blocked?.detail ?? null,
      printer: await this.deps.choosePrinter(template),
    };
  }

  async submit(request: PrintRequest): Promise<PrintResult> {
    const id = this.deps.createId();
    const recognition = this.recognize(request.raw);
    if (!recognition.ok) {
      const truncated = request.raw.trim().slice(0, MAX_RAW_LENGTH);
      return this.finish(id, request, NO_TARGET, truncated, recognition.result, null);
    }
    // 模板只看命中的规则，和加工步骤补的字段无关：在加工之前就能决定打印机。
    return this.printLabel(id, request, recognition.scan, this.deps.resolveTemplate(recognition.scan), SCAN_OPTIONS);
  }

  /** 按给定的模板和字段打印一张：不识别、不加工、不用扫码的防重复窗口。 */
  async printFields(input: FieldsPrint): Promise<PrintResult> {
    const scan = fieldsScan(input.content, input.fields);
    const request: PrintRequest = { raw: input.content, source: input.source };
    if (input.caller !== null) {
      request.caller = input.caller;
    }
    return this.printLabel(this.deps.createId(), request, scan, input.template, {
      dedup: false,
      enrich: false,
      printerName: input.printerName,
    });
  }

  /** 按模板决定打印机 → 防重复 → 加工 → 排队打印 → 写记录（后两步之外的由 options 决定）。 */
  private async printLabel(
    id: string,
    request: PrintRequest,
    recognized: ScanResult,
    template: LabelTemplate,
    options: LabelOptions,
  ): Promise<PrintResult> {
    const choice: PrinterChoice =
      options.printerName === null
        ? await this.deps.choosePrinter(template)
        : { printerName: options.printerName, reason: 'template' };
    // 没有打印机时和 1.0.x 没选打印机一样：不打印、不写记录、不占防重复窗口，指定好打印机后可以直接重打。
    if (choice.printerName === null) {
      return { status: 'no-printer', paperKey: choice.paperKey, missingPrinter: choice.missingPrinter };
    }
    const target: JobTarget = {
      printerName: choice.printerName,
      paper: paperKey(template.paper),
      templateId: template.id,
    };
    const { raw } = recognized;
    // 先占住防重复窗口再加工：HTTP 查询要花时间，扫码枪连按的第二下必须在这里就被拦下。
    const reservation = options.dedup
      ? this.deps.guard.tryReserve(raw, request.force === true)
      : ({ ok: true } as const);
    if (!reservation.ok) {
      const duplicate: RecordedResult = {
        status: 'duplicate',
        recent: reservation.recent,
        windowMs: this.deps.guard.windowMs,
      };
      return this.finish(id, request, target, raw, duplicate, recognized);
    }
    const context: EnrichContext = { images: request.images ?? [], manualFields: request.manualFields ?? {} };
    const enriched = options.enrich
      ? await this.enrich(recognized, context)
      : { scan: recognized, traces: [], blocked: null };
    if (enriched.blocked) {
      this.deps.guard.release(raw);
      const { reason, detail, field } = enriched.blocked;
      const blocked: RecordedResult = { status: 'failed', reason, detail, ...(field === null ? {} : { field }) };
      return this.finish(id, request, target, raw, blocked, enriched.scan);
    }
    const { scan } = enriched;
    try {
      await this.deps.queue.enqueue(target.printerName, (signal) =>
        this.deps.adapter.print(target.printerName, this.createJob(scan, template), signal),
      );
    } catch (error) {
      console.error('[PrintService] print failed', error);
      const failure = toPrintFailure(error);
      if (options.dedup) {
        this.settleFailedReservation(scan.raw, failure);
      }
      return this.finish(id, request, target, scan.raw, failed(failure), scan);
    }
    if (options.dedup) {
      this.deps.guard.commit(scan.raw);
    }
    return this.finish(id, request, target, scan.raw, { status: 'printed', jobId: id, scan }, scan);
  }

  /**
   * 测试页按规则识别、按规则绑定的模板打印，但不执行加工步骤：
   * 测试页是检查打印机的，不应该因为 HTTP 接口不通而打不出来，也不该拿测试内容去查接口。
   * paper 是这台打印机负责的纸：测试页按它的尺寸打，看到的就是这台打印机实际出纸的样子。
   */
  async printTest(printerName: string, paper: PaperSize): Promise<PrintResult> {
    const scan = this.deps.recognize(TEST_RAW) ?? TEST_FALLBACK_SCAN;
    const template = withPaper(this.deps.resolveTemplate(scan), paper);
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(scan, template), signal),
      );
      return { status: 'printed', jobId: 'test', scan };
    } catch (error) {
      console.error('[PrintService] test print failed', error);
      return failed(toPrintFailure(error));
    }
  }

  /** 超时说明结果不确定（可能已出纸或仍在排队）：按已打印处理，避免重扫出第二张；确认没出纸再强制补打。 */
  private settleFailedReservation(raw: string, failure: PrintFailure): void {
    if (failure.reason === 'PRINT_TIMEOUT') {
      this.deps.guard.commit(raw);
    } else {
      this.deps.guard.release(raw);
    }
  }

  private recognize(raw: string): Recognition {
    if (normalizeRaw(raw) === null) {
      return { ok: false, result: { status: 'invalid', reason: 'INVALID_CONTENT' } };
    }
    const scan = this.deps.recognize(raw);
    return scan ? { ok: true, scan } : { ok: false, result: { status: 'invalid', reason: 'NO_MATCHING_RULE' } };
  }

  /** 加工步骤里意外的异常（不是查询失败）不能拦住打印：记日志，按没有加工处理。 */
  private async enrich(scan: ScanResult, context: EnrichContext): Promise<EnrichResult> {
    try {
      return await this.deps.enrich(scan, context);
    } catch (error) {
      console.error('[PrintService] processing steps failed', error);
      return { scan, traces: [], blocked: null };
    }
  }

  /** 打印用的模板和决定打印机用的是同一个：不在这里重新选模板。 */
  private createJob(scan: ScanResult, template: LabelTemplate): LabelJob {
    return { scan, template, printedAt: this.deps.clock.now() };
  }

  /** 写打印记录，并通知订阅者（打印结果通知）；scan 是当时的识别结果，识别不了时为 null。 */
  private finish(
    id: string,
    request: PrintRequest,
    target: JobTarget,
    raw: string,
    result: RecordedResult,
    scan: ScanResult | null,
  ): PrintResult {
    const job: JobRecord = {
      id,
      createdAt: this.deps.clock.now(),
      raw,
      printerName: target.printerName,
      source: request.source,
      status: result.status,
      forced: request.force === true,
    };
    if (result.status === 'failed') {
      job.failureReason = result.reason;
    }
    if (target.paper !== null) {
      job.paper = target.paper;
    }
    if (target.templateId !== null) {
      job.templateId = target.templateId;
    }
    if (scan !== null) {
      job.fields = scan.fields;
    }
    if (request.caller !== undefined) {
      job.caller = request.caller;
    }
    try {
      this.deps.store.append(job);
    } catch (error) {
      // 以打印机为准：记录写失败不能把已出纸的任务报成失败，否则操作员会重复打印。
      console.error('[PrintService] failed to record job', error);
    }
    this.deps.onRecorded?.(job, scan);
    return result;
  }
}

function failed(failure: PrintFailure): Extract<PrintResult, { status: 'failed' }> {
  return { status: 'failed', ...failure };
}
