import { PRINT_TIMEOUT_MS } from '../../shared/print-timing';
import type { JobFlag, QueueFacts, QueueJob } from './diagnosis-model';
import type { SubmittedWindow } from './submitted-jobs';

/** 任务在队列里超过这么久算卡住：单张打印的超时是 30 秒（PRINT_TIMEOUT_MS），再等一倍还没打完，不会是正常排队。 */
export const STUCK_JOB_AGE_MS = 2 * PRINT_TIMEOUT_MS;
/** 认「是不是本程序发的」时提交时间的误差：CUPS 的提交时间只到秒，系统记时间的时刻也和我们记的不完全一样。 */
export const SUBMIT_TIME_SKEW_MS = 2_000;

/** 这些状态说明任务停住了，不用等到超时。 */
const STOPPED_FLAGS: ReadonlySet<JobFlag> = new Set<JobFlag>([
  'error',
  'paused',
  'offline',
  'paper-out',
  'blocked',
  'user-intervention',
  'held',
  'stopped',
]);

export function isStuck(job: QueueJob, nowMs: number): boolean {
  return job.flags.some((flag) => STOPPED_FLAGS.has(flag)) || nowMs - job.submittedAtMs > STUCK_JOB_AGE_MS;
}

/** 用户名不分大小写，去掉 Windows 可能带的「域名\」前缀。 */
function userKey(name: string): string {
  return (name.split('\\').at(-1) ?? name).toLowerCase();
}

/** 提交人是当前用户，且提交时间落在本程序某次交任务的时间段里（前后各放 SUBMIT_TIME_SKEW_MS）。 */
export function isOwnJob(job: QueueJob, currentUser: string, windows: readonly SubmittedWindow[]): boolean {
  if (userKey(job.user) !== userKey(currentUser)) {
    return false;
  }
  return windows.some(
    (window) =>
      job.submittedAtMs >= window.startedAtMs - SUBMIT_TIME_SKEW_MS &&
      job.submittedAtMs <= window.finishedAtMs + SUBMIT_TIME_SKEW_MS,
  );
}

/** 队列汇总：stuck、ownStuck 只数列出来的任务；own 是本程序的全部任务（卡没卡都算，清的时候一起清）。 */
export interface QueueSummary {
  total: number;
  listed: number;
  stuck: number;
  ownStuck: number;
  own: QueueJob[];
  /** 卡住的任务里最早的等了多久；没有卡住的为 null。 */
  oldestStuckAgeMs: number | null;
}

export function summarizeQueue(
  facts: Extract<QueueFacts, { kind: 'listed' }>,
  windows: readonly SubmittedWindow[],
  nowMs: number,
): QueueSummary {
  const stuck = facts.jobs.filter((job) => isStuck(job, nowMs));
  const own = facts.jobs.filter((job) => isOwnJob(job, facts.currentUser, windows));
  const oldest = stuck.reduce<number | null>(
    (earliest, job) => (earliest === null || job.submittedAtMs < earliest ? job.submittedAtMs : earliest),
    null,
  );
  return {
    total: facts.total,
    listed: facts.jobs.length,
    stuck: stuck.length,
    ownStuck: stuck.filter((job) => own.includes(job)).length,
    own,
    oldestStuckAgeMs: oldest === null ? null : nowMs - oldest,
  };
}
