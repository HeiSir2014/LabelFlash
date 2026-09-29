import type { PrintJob } from './api-model';

export interface ApiJobPage {
  jobs: PrintJob[];
  /** 下一页从哪里开始（不透明）；没有更多时为 null。 */
  nextCursor: number | null;
}

/** 本机接口的任务存储：主进程用 SQLite 实现，测试用 testing/in-memory-api-job-store.ts。 */
export interface ApiJobStore {
  insert(job: PrintJob): void;
  /** 一批任务一起存：有一条存不进去，整批都不留下（一批要么全收、要么全不收）。 */
  insertMany(jobs: readonly PrintJob[]): void;
  update(job: PrintJob): void;
  get(id: string): PrintJob | null;
  /** 同一调用方在 since 之后提交的、带这个 requestId 的任务（最新的一个）。 */
  findByRequestId(caller: string, requestId: string, since: number): PrintJob | null;
  /** 这个调用方的任务，新的在前；cursor 取上一页的 nextCursor。 */
  list(caller: string, limit: number, cursor: number | null): ApiJobPage;
  /** 还没打的份数之和（QUEUED、PRINTING 的 copies − sentCopies）。 */
  pendingLabels(): number;
  /** 状态为 QUEUED 或 PRINTING 的任务，按提交顺序。 */
  listUnfinished(): PrintJob[];
  /** 删掉 createdAt 早于 time 的已结束任务。 */
  deleteFinishedBefore(time: number): void;
}
