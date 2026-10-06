import type { Clock } from '../types';

/** 本程序交给打印队列的一张：从调用驱动到驱动回调的时间段。 */
export interface SubmittedWindow {
  printerName: string;
  startedAtMs: number;
  finishedAtMs: number;
}

/** 记多少张：一台电脑一天打几百张，500 张够覆盖「刚才卡住的那几张」。 */
export const SUBMITTED_JOBS_KEPT = 500;
/** 记多久：卡了一天以上的任务不再认作本程序的（时间对得上也可能是巧合），交给「清除全部任务」。 */
export const SUBMITTED_JOBS_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * 本程序发出的打印任务的账本，只在内存里，重启清空（重启前卡住的任务由「清除全部任务」处理）。
 * 打印队列里的任务只有提交人和提交时间，认不出是哪个程序发的：按「提交人是当前用户 +
 * 提交时间落在本程序某次交任务的时间段里」认（queue-summary.ts 的 isOwnJob）。
 */
export class SubmittedJobs {
  private readonly windows: SubmittedWindow[] = [];

  constructor(private readonly clock: Clock) {}

  /** 驱动回调成功（任务进了系统的打印队列）后调用；startedAtMs 是调用驱动之前取的时间。 */
  record(printerName: string, startedAtMs: number): void {
    this.windows.push({ printerName, startedAtMs, finishedAtMs: this.clock.now() });
    if (this.windows.length > SUBMITTED_JOBS_KEPT) {
      this.windows.splice(0, this.windows.length - SUBMITTED_JOBS_KEPT);
    }
  }

  /** 这台打印机一天内的时间段。 */
  windowsFor(printerName: string): SubmittedWindow[] {
    const oldest = this.clock.now() - SUBMITTED_JOBS_TTL_MS;
    return this.windows.filter((window) => window.printerName === printerName && window.finishedAtMs >= oldest);
  }
}
