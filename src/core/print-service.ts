import { type DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { type PrintFailure, toPrintFailure } from './errors';
import type { JobStore } from './job-store';
import { MAX_RAW_LENGTH, parseLabel } from './label-parser';
import type { PrintQueue } from './print-queue';
import type { LabelTemplate } from './templates/template-model';
import type {
  Clock,
  JobRecord,
  LabelData,
  LabelJob,
  PreviewResult,
  PrinterAdapter,
  PrintRequest,
  PrintResult,
} from './types';

export const TEST_LABEL: LabelData = {
  raw: 'TEST-0001-测试色-XL',
  code: 'TEST-0001',
  color: '测试色',
  size: 'XL',
};

export interface PrintServiceDeps {
  adapter: PrinterAdapter;
  store: JobStore;
  guard: DedupGuard;
  queue: PrintQueue;
  clock: Clock;
  createId: () => string;
  /** 当前启用的模板；每次打印时读取，切换模板立即生效。 */
  resolveTemplate: () => LabelTemplate;
}

/** 所有入口（扫码枪、记录重打、Phase 2 的手机）的唯一业务入口。 */
export class PrintService {
  constructor(private readonly deps: PrintServiceDeps) {}

  /** 启动时从打印记录回放门限状态，重启后窗口仍然有效。 */
  restore(): void {
    const since = this.deps.clock.now() - MAX_DEDUP_WINDOW_MS;
    for (const { raw, printedAt } of this.deps.store.listLastPrinted(since)) {
      this.deps.guard.restore(raw, printedAt);
    }
  }

  preview(raw: string): PreviewResult {
    const label = parseLabel(raw);
    if (!label) {
      return { status: 'invalid', reason: 'INVALID_FORMAT' };
    }
    return { status: 'ok', label, recent: this.deps.guard.peek(label.raw) };
  }

  async submit(request: PrintRequest): Promise<PrintResult> {
    const id = this.deps.createId();
    const label = parseLabel(request.raw);
    if (!label) {
      const truncated = request.raw.trim().slice(0, MAX_RAW_LENGTH);
      return this.finish(id, request, truncated, { status: 'invalid', reason: 'INVALID_FORMAT' });
    }
    const reservation = this.deps.guard.tryReserve(label.raw, request.force === true);
    if (!reservation.ok) {
      return this.finish(id, request, label.raw, {
        status: 'duplicate',
        recent: reservation.recent,
        windowMs: this.deps.guard.windowMs,
      });
    }
    try {
      await this.deps.queue.enqueue(request.printerName, (signal) =>
        this.deps.adapter.print(request.printerName, this.createJob(label), signal),
      );
    } catch (error) {
      console.error('[PrintService] print failed', error);
      const failure = toPrintFailure(error);
      if (failure.reason === 'PRINT_TIMEOUT') {
        // 超时说明结果不确定（可能已出纸或仍在排队）：按已打印处理，避免重扫出第二张；确认没出纸再强制补打。
        this.deps.guard.commit(label.raw);
      } else {
        this.deps.guard.release(label.raw);
      }
      return this.finish(id, request, label.raw, failed(failure));
    }
    this.deps.guard.commit(label.raw);
    return this.finish(id, request, label.raw, { status: 'printed', jobId: id, label });
  }

  async printTest(printerName: string): Promise<PrintResult> {
    try {
      await this.deps.queue.enqueue(printerName, (signal) =>
        this.deps.adapter.print(printerName, this.createJob(TEST_LABEL), signal),
      );
      return { status: 'printed', jobId: 'test', label: TEST_LABEL };
    } catch (error) {
      console.error('[PrintService] test print failed', error);
      return failed(toPrintFailure(error));
    }
  }

  private createJob(label: LabelData): LabelJob {
    return { label, template: this.deps.resolveTemplate(), printedAt: this.deps.clock.now() };
  }

  private finish(id: string, request: PrintRequest, raw: string, result: PrintResult): PrintResult {
    const job: JobRecord = {
      id,
      createdAt: this.deps.clock.now(),
      raw,
      printerName: request.printerName,
      source: request.source,
      status: result.status,
      forced: request.force === true,
    };
    if (result.status === 'failed') {
      job.failureReason = result.reason;
    }
    try {
      this.deps.store.append(job);
    } catch (error) {
      // 以打印机为准：记录写失败不能把已出纸的任务报成失败，否则操作员会重复打印。
      console.error('[PrintService] failed to record job', error);
    }
    return result;
  }
}

function failed(failure: PrintFailure): PrintResult {
  return { status: 'failed', ...failure };
}
