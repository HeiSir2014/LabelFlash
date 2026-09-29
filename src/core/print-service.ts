import { type PaperSize, paperKey } from '../shared/paper-sizes';
import { type DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { type PrintFailure, toPrintFailure } from './errors';
import type { JobStore } from './job-store';
import type { PrintQueue } from './print-queue';
import type { PrinterChoice } from './printing/resolve-printer';
import type { EnrichResult } from './scan/enrich';
import { MAX_RAW_LENGTH, normalizeRaw } from './scan/normalize-raw';
import type { ScanResult } from './scan/scan-result';
import { type LabelTemplate, withPaper } from './templates/template-model';
import type {
  Clock,
  JobRecord,
  LabelJob,
  PreviewResult,
  PrinterAdapter,
  PrintRequest,
  PrintResult,
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
  enrich: (scan: ScanResult) => Promise<EnrichResult>;
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

type Recognition = { ok: true; scan: ScanResult } | { ok: false; result: Extract<PrintResult, { status: 'invalid' }> };

/** 所有入口（扫码枪、记录重打、手机扫码，以后的本机接口）的唯一业务入口。 */
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
    const enriched = await this.enrich(recognition.scan);
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
    return this.printLabel(id, request, recognition.scan, this.deps.resolveTemplate(recognition.scan));
  }

  /**
   * 按模板决定打印机 → 防重复 → 加工 → 排队打印 → 写记录。
   * 本机接口（第 2 个子项目）传来的是字段 + 模板，从这里进来，不经过识别规则。
   */
  private async printLabel(
    id: string,
    request: PrintRequest,
    recognized: ScanResult,
    template: LabelTemplate,
  ): Promise<PrintResult> {
    const choice = await this.deps.choosePrinter(template);
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
    const reservation = this.deps.guard.tryReserve(raw, request.force === true);
    if (!reservation.ok) {
      const duplicate: RecordedResult = {
        status: 'duplicate',
        recent: reservation.recent,
        windowMs: this.deps.guard.windowMs,
      };
      return this.finish(id, request, target, raw, duplicate, recognized);
    }
    const enriched = await this.enrich(recognized);
    if (enriched.blocked) {
      this.deps.guard.release(raw);
      const lookupFailed: RecordedResult = {
        status: 'failed',
        reason: 'LOOKUP_FAILED',
        detail: enriched.blocked.detail,
      };
      return this.finish(id, request, target, raw, lookupFailed, enriched.scan);
    }
    const { scan } = enriched;
    try {
      await this.deps.queue.enqueue(target.printerName, (signal) =>
        this.deps.adapter.print(target.printerName, this.createJob(scan, template), signal),
      );
    } catch (error) {
      console.error('[PrintService] print failed', error);
      const failure = toPrintFailure(error);
      if (failure.reason === 'PRINT_TIMEOUT') {
        // 超时说明结果不确定（可能已出纸或仍在排队）：按已打印处理，避免重扫出第二张；确认没出纸再强制补打。
        this.deps.guard.commit(scan.raw);
      } else {
        this.deps.guard.release(scan.raw);
      }
      return this.finish(id, request, target, scan.raw, failed(failure), scan);
    }
    this.deps.guard.commit(scan.raw);
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

  private recognize(raw: string): Recognition {
    if (normalizeRaw(raw) === null) {
      return { ok: false, result: { status: 'invalid', reason: 'INVALID_CONTENT' } };
    }
    const scan = this.deps.recognize(raw);
    return scan ? { ok: true, scan } : { ok: false, result: { status: 'invalid', reason: 'NO_MATCHING_RULE' } };
  }

  /** 加工步骤里意外的异常（不是查询失败）不能拦住打印：记日志，按没有加工处理。 */
  private async enrich(scan: ScanResult): Promise<EnrichResult> {
    try {
      return await this.deps.enrich(scan);
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
