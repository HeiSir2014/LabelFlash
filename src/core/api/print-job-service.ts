import type { FieldsPrint } from '../print-service';
import { SerialQueue } from '../serial-queue';
import type { LabelTemplate } from '../templates/template-model';
import type { Clock, PrintResult } from '../types';
import type { ApiJobPage, ApiJobStore } from './api-job-store';
import { contentOf, type PrintJob, type PrintJobFailure, type PrintJobInput } from './api-model';

/** AIP-155：同一调用方的同一 requestId 在这段时间内只处理一次（调用方超时重试一般在几分钟内，留足余量）。 */
export const REQUEST_ID_WINDOW_MS = 24 * 60 * 60_000;
/** 任务状态保留 7 天，给调用方查询；标签内容长期留在打印记录里。 */
export const JOB_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type PrintJobErrorCode = 'TEMPLATE_NOT_FOUND' | 'PRINTER_NOT_FOUND' | 'QUEUE_FULL' | 'PRINTERS_UNAVAILABLE';

/** 提交时就能判断的错误：整批一张都不收。index 是批量请求里的第几个（和整批有关的错误为 null）。 */
export class PrintJobError extends Error {
  constructor(
    readonly code: PrintJobErrorCode,
    message: string,
    readonly index: number | null = null,
  ) {
    super(message);
    this.name = 'PrintJobError';
  }
}

export interface PrintJobServiceDeps {
  store: ApiJobStore;
  clock: Clock;
  createId: () => string;
  /** 按编号精确查找（找不到为 null，不退回别的模板），不叠加工作台的备注选择。 */
  findTemplate: (templateId: string) => LabelTemplate | null;
  installedPrinters: () => Promise<string[]>;
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 排队中的标签总数上限：调用方程序出错反复提交时，不至于把打印机刷爆。 */
  queueLimit: number;
}

/** 批量里的一项：已有的任务（以前提交过的 requestId）、同一批里前面那个（index）、或新收下的任务。 */
type BatchItem = { existing: PrintJob } | { sameAs: number } | { job: PrintJob };

const FAILURE_MESSAGES: Record<PrintJobFailure['reason'], string> = {
  NO_PRINTER: '这种纸还没有打印机：请在电脑上为这种纸指定打印机',
  PRINTER_NOT_FOUND: '打印机不在这台电脑上：请检查打印机是否连接',
  PRINTER_NOT_READY: '打印机现在不能打印（缺纸、离线或卡纸）',
  PRINT_TIMEOUT: '打印超时：可能已经出纸，请到打印机旁确认',
  PRINT_ERROR: '打印机驱动报告错误',
  INTERRUPTED: '程序在打完之前退出了：已发送的份数见 sentCopies，其余没有打印',
};

/**
 * 本机接口的打印任务：先整批核对再收下，收下的任务排成一队，按提交顺序一个接一个打，
 * 一个任务的所有份数连续打完再打下一个（服装标签要按顺序出纸）。代价是一台打印机卡住时，
 * 后面打到别的打印机的任务也要等；实际使用中一种纸一台打印机，按顺序出纸更重要。
 */
export class PrintJobService {
  private readonly queue = new SerialQueue();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PrintJobServiceDeps) {}

  async create(caller: string, input: PrintJobInput): Promise<PrintJob> {
    const [job] = await this.createBatch(caller, [input]);
    if (!job) {
      throw new Error('createBatch returned no job for one request');
    }
    return job;
  }

  /**
   * 整批先核对模板、打印机、排队上限，有一个不行就一张都不收；重复的 requestId 返回已有的任务。
   * 整批一起存进库，存好了才开始打印：存到一半出错时，前面的也不会已经在打。
   */
  async createBatch(caller: string, inputs: readonly PrintJobInput[]): Promise<PrintJob[]> {
    const installed = await this.installedPrinters(inputs);
    // 核对和收下之间不能有 await：否则两个并发的请求可能都通过了排队上限。
    const now = this.deps.clock.now();
    // 同一批里重复的 requestId 是同一个任务：只核对、只计数第一次出现的。
    const firstOfRequest = new Map<string, number>();
    let newLabels = 0;
    const plans = inputs.map((input, index): BatchItem => {
      const existing = this.findExisting(caller, input, now);
      if (existing !== null) {
        return { existing };
      }
      if (input.requestId !== null) {
        const first = firstOfRequest.get(input.requestId);
        if (first !== undefined) {
          return { sameAs: first };
        }
        firstOfRequest.set(input.requestId, index);
      }
      if (this.deps.findTemplate(input.templateId) === null) {
        throw new PrintJobError('TEMPLATE_NOT_FOUND', `找不到模板 ${input.templateId}`, index);
      }
      if (input.printer !== null && !installed.includes(input.printer)) {
        throw new PrintJobError('PRINTER_NOT_FOUND', `这台电脑上没有打印机「${input.printer}」`, index);
      }
      newLabels += input.copies;
      return { job: this.newJob(caller, input, now) };
    });
    if (this.deps.store.pendingLabels() + newLabels > this.deps.queueLimit) {
      throw new PrintJobError(
        'QUEUE_FULL',
        `排队中的标签太多（上限 ${this.deps.queueLimit} 张）：请等前面的打完再提交`,
      );
    }
    const created = plans.flatMap((plan) => ('job' in plan ? [plan.job] : []));
    this.deps.store.insertMany(created);
    for (const job of created) {
      this.tail = this.queue
        .run(() => this.run(job))
        .catch((error: unknown) => {
          console.error(`[PrintJobService] job ${job.id} could not be finished`, error);
        });
    }
    const jobs: PrintJob[] = [];
    for (const plan of plans) {
      jobs.push('existing' in plan ? plan.existing : 'job' in plan ? plan.job : (jobs[plan.sameAs] as PrintJob));
    }
    return jobs;
  }

  /** 请求里指定了打印机才读打印机列表：打印服务卡住时读列表会一直等，没必要让所有提交都跟着等。 */
  private async installedPrinters(inputs: readonly PrintJobInput[]): Promise<string[]> {
    if (inputs.every((input) => input.printer === null)) {
      return [];
    }
    try {
      return await this.deps.installedPrinters();
    } catch (error) {
      console.warn('[PrintJobService] cannot list printers', error);
      throw new PrintJobError('PRINTERS_UNAVAILABLE', '读不到这台电脑的打印机列表：请稍后再试');
    }
  }

  get(id: string): PrintJob | null {
    return this.deps.store.get(id);
  }

  /** 这个调用方的任务，新的在前；cursor 取上一页的 nextCursor。 */
  list(caller: string, limit: number, cursor: number | null): ApiJobPage {
    return this.deps.store.list(caller, limit, cursor);
  }

  /** 收下还没打完的任务数（排着的和正在打的）：关到托盘后的静默更新要等它们打完。 */
  get pending(): number {
    return this.queue.pending;
  }

  /** 等队列里的任务都结束（测试和退出时用）。 */
  async idle(): Promise<void> {
    let seen: Promise<void> | null = null;
    while (seen !== this.tail) {
      seen = this.tail;
      await seen;
    }
  }

  /** 删掉超过保留期的已结束任务。 */
  purge(): void {
    this.deps.store.deleteFinishedBefore(this.deps.clock.now() - JOB_RETENTION_MS + 1);
  }

  /** 启动时、收新任务之前调用：上次没打完的任务标成失败，不自动续打（免得一启动突然出纸）。 */
  recoverInterrupted(): void {
    for (const job of this.deps.store.listUnfinished()) {
      this.save(job, { state: 'FAILED', failure: { reason: 'INTERRUPTED', message: FAILURE_MESSAGES.INTERRUPTED } });
    }
  }

  private findExisting(caller: string, input: PrintJobInput, now: number): PrintJob | null {
    if (input.requestId === null) {
      return null;
    }
    return this.deps.store.findByRequestId(caller, input.requestId, now - REQUEST_ID_WINDOW_MS + 1);
  }

  private newJob(caller: string, input: PrintJobInput, now: number): PrintJob {
    return {
      ...input,
      id: this.deps.createId(),
      caller,
      state: 'QUEUED',
      sentCopies: 0,
      failure: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 逐份打印：某一份失败就停，后面的份数不再打。任何意外都落到 FAILED，不让任务卡在打印中。 */
  private async run(queued: PrintJob): Promise<void> {
    let job = queued;
    try {
      job = this.save(queued, { state: 'PRINTING' });
      const template = this.deps.findTemplate(job.templateId);
      if (template === null) {
        this.save(job, { state: 'FAILED', failure: { reason: 'PRINT_ERROR', message: '模板在打印前被删除了' } });
        return;
      }
      const content = contentOf(job);
      while (job.sentCopies < job.copies) {
        const result = await this.deps.printFields({
          template,
          fields: job.fields,
          content,
          source: 'api',
          caller: job.caller,
          printerName: job.printer,
        });
        const failure = failureOf(result);
        if (failure) {
          this.save(job, { state: 'FAILED', failure });
          return;
        }
        job = this.save(job, { sentCopies: job.sentCopies + 1 });
      }
      this.save(job, { state: 'SENT' });
    } catch (error) {
      console.error(`[PrintJobService] job ${job.id} failed unexpectedly`, error);
      try {
        this.save(job, { state: 'FAILED', failure: { reason: 'PRINT_ERROR', message: FAILURE_MESSAGES.PRINT_ERROR } });
      } catch (saveError) {
        // 数据库也出错了（例如程序正在退出）：下次启动时 recoverInterrupted 会把它标成 INTERRUPTED。
        console.error(`[PrintJobService] cannot record the failure of job ${job.id}`, saveError);
      }
    }
  }

  private save(job: PrintJob, patch: Partial<PrintJob>): PrintJob {
    const next = { ...job, ...patch, updatedAt: this.deps.clock.now() };
    this.deps.store.update(next);
    return next;
  }
}

function failureOf(result: PrintResult): PrintJobFailure | null {
  switch (result.status) {
    case 'printed':
      return null;
    case 'no-printer':
      return { reason: 'NO_PRINTER', message: FAILURE_MESSAGES.NO_PRINTER };
    case 'failed': {
      // LOOKUP_FAILED / TEXT_NOT_FOUND 只出现在加工步骤里、CANCELED 只出现在批量打印退出时：
      // 本机接口都不会走到这几种，按驱动错误处理，映射只为穷尽。
      const reason =
        result.reason === 'LOOKUP_FAILED' || result.reason === 'TEXT_NOT_FOUND' || result.reason === 'CANCELED'
          ? 'PRINT_ERROR'
          : result.reason;
      return { reason, message: result.detail ?? FAILURE_MESSAGES[reason] };
    }
    // 本机接口不用扫码防重复、不走识别规则：这两种不会出现，按驱动错误处理，不让任务卡住。
    case 'duplicate':
    case 'invalid':
      return { reason: 'PRINT_ERROR', message: FAILURE_MESSAGES.PRINT_ERROR };
  }
}
