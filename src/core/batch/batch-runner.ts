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
