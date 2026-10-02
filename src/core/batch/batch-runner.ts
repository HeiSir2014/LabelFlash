import type { PrintFailureReason, PrintResult } from '../types';
import type { BatchLabel } from './batch-model';

export type BatchState = 'running' | 'paused' | 'done' | 'canceled';

/**
 * 为什么暂停：operator = 操作员点的；no-printer / PRINTER_NOT_READY / PRINTER_NOT_FOUND 是打印机的问题
 * （那一张没打成，继续时重打它）；consecutive-failures 见 CONSECUTIVE_FAILURE_PAUSE_LIMIT 的说明。
 */
export type BatchPauseReason =
  | 'operator'
  | 'no-printer'
  | 'PRINTER_NOT_READY'
  | 'PRINTER_NOT_FOUND'
  | 'consecutive-failures';

export interface BatchFailure {
  row: number;
  copy: number;
  reason: PrintFailureReason;
}

/**
 * 一批的进度：每打完一张、每次状态变化都推一次。已发送 = 驱动收下了（进了打印队列），不等于已出纸。
 * 不带失败名单：onChange 在整批期间会被调用很多次（最多 2 万次），每次都复制一份不断变长的数组
 * 既浪费 CPU（整批下来是 O(张数²)），也会让经过 IPC 的消息越变越大；要看失败名单用 snapshot()。
 */
export interface BatchProgress {
  batchId: string;
  state: BatchState;
  total: number;
  sent: number;
  failed: number;
  pauseReason: BatchPauseReason | null;
}

/** 按需查询用的完整快照：比 BatchProgress 多一份失败名单（截断，见 MAX_SNAPSHOT_FAILURES）。 */
export interface BatchSnapshot extends BatchProgress {
  failures: BatchFailure[];
}

export interface BatchRunDeps {
  /** 打一张：经 PrintService.printFields（来源 batch），等它进了打印队列或失败才返回。 */
  print: (label: BatchLabel) => Promise<PrintResult>;
  /** 每打完一张、每次状态变化都调用；这里已经兜底了调用方抛错的情况，调用方不需要自己 try/catch。 */
  onChange: (progress: BatchProgress) => void;
}

/**
 * 连续失败几次就自动暂停：macOS 上打印机状态一直是「未知」，拔了纸、卡纸这些问题不会被识别成
 * no-printer / PRINTER_NOT_READY，每一张都会按驱动报错（PRINT_ERROR / PRINT_TIMEOUT）失败。
 * 不暂停的话一批最多 2 万张会原样刷出 2 万条失败记录。3 次足够滤掉偶发的单次失败，
 * 又不会让操作员等太久才发现打印机真的出问题了。
 */
const CONSECUTIVE_FAILURE_PAUSE_LIMIT = 3;

/** snapshot() 的失败名单最多给几条：界面做即时反馈用，不需要一次看完；完整名单按批次查打印记录表。 */
const MAX_SNAPSHOT_FAILURES = 500;

/**
 * 一批标签：按顺序一张一张打，上一张进了打印队列才交下一张。这样出纸顺序和表格一致，
 * 暂停、取消在两张之间生效（已经交出去的那一张收不回来）。
 * 打印机不能用、或连续失败太多次时自动暂停：这一张不前进，继续时重打它。
 *
 * run() 只能调用一次；理论上不会 reject（onChange 抛错已经在内部兜住，driver 的异常也在 print() 里转成失败），
 * 但调用方仍然应该 .catch 它——不留一个没人处理的 rejection 把主进程带崩。
 */
export class BatchRun {
  private started = false;
  private state: BatchState = 'running';
  private next = 0;
  private sent = 0;
  private readonly failures: BatchFailure[] = [];
  private pauseReason: BatchPauseReason | null = null;
  private wake: (() => void) | null = null;
  /** 正在等 deps.print 的结果：cancel() 之后状态已经是 canceled，但这一张还没真正打完。 */
  private inFlight = false;
  /** 连续失败的张数（不同标签各算一次失败）；遇到打印机问题或打印成功都清零。 */
  private consecutiveFailures = 0;

  constructor(
    readonly batchId: string,
    private readonly labels: readonly BatchLabel[],
    private readonly deps: BatchRunDeps,
  ) {}

  /** 还在打、暂停中，或者还有一张正在打（即使已经被取消）。 */
  get isActive(): boolean {
    return this.state === 'running' || this.state === 'paused' || this.inFlight;
  }

  /** 还没打完的张数（关到托盘后的静默更新要等它为 0）：取消之后最多还剩正在打的这一张。 */
  get pendingLabels(): number {
    if (this.state === 'running' || this.state === 'paused') {
      return this.labels.length - this.next;
    }
    return this.inFlight ? 1 : 0;
  }

  /** 从第一张打到最后一张（或被取消）；只调用一次，再调用会报错。 */
  async run(): Promise<void> {
    if (this.started) {
      throw new Error('BatchRun.run() was already called once');
    }
    this.started = true;
    this.emit();
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
      this.inFlight = true;
      const result = await this.print(label);
      this.inFlight = false;
      const problem = printerProblem(result);
      if (problem !== null) {
        this.consecutiveFailures = 0;
        if (!this.is('canceled')) {
          this.setState('paused', problem);
        }
        continue;
      }
      if (result.status === 'printed') {
        this.sent += 1;
        this.consecutiveFailures = 0;
        this.next += 1;
        this.emit();
        continue;
      }
      // 不是 printed、也不是打印机问题：按失败处理（哪怕是 duplicate / invalid 这类批量打印本来不会走到的状态）。
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= CONSECUTIVE_FAILURE_PAUSE_LIMIT) {
        this.consecutiveFailures = 0;
        if (!this.is('canceled')) {
          this.setState('paused', 'consecutive-failures');
        }
        continue; // 这一张不算失败、也不前进：继续时重打它。
      }
      this.failures.push({ row: label.row, copy: label.copy, reason: failureReasonOf(result) });
      this.next += 1;
      this.emit();
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

  /** 给 onChange 用的轻量进度：不含失败名单，复制开销是常数。 */
  private progress(): BatchProgress {
    return {
      batchId: this.batchId,
      state: this.state,
      total: this.labels.length,
      sent: this.sent,
      failed: this.failures.length,
      pauseReason: this.pauseReason,
    };
  }

  /** 查询用的完整快照：按需调用，失败名单最多给最近 MAX_SNAPSHOT_FAILURES 条。 */
  snapshot(): BatchSnapshot {
    return { ...this.progress(), failures: this.failures.slice(-MAX_SNAPSHOT_FAILURES) };
  }

  /** 用方法读状态：循环里隔着 await 读 this.state，TypeScript 的收窄会误以为它没变。 */
  private is(state: BatchState): boolean {
    return this.state === state;
  }

  private setState(state: BatchState, reason: BatchPauseReason | null): void {
    this.state = state;
    this.pauseReason = reason;
    this.emit();
  }

  /** onChange 是调用方（界面层）的回调，不受我们控制：抛错只记日志，不能让它把整批打印的循环炸掉。 */
  private emit(): void {
    try {
      this.deps.onChange(this.progress());
    } catch (error) {
      console.error('[BatchRun] onChange threw; the batch keeps running', error);
    }
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

/** 批量打印不走识别和防重复，理论上只会是 printed 或 failed；万一出现别的状态，按驱动报错处理。 */
function failureReasonOf(result: PrintResult): PrintFailureReason {
  return result.status === 'failed' ? result.reason : 'PRINT_ERROR';
}
