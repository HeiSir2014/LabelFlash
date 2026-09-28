import type { JobRecord } from './types';

export interface LastPrinted {
  raw: string;
  printedAt: number;
}

/** PrintService 需要的打印记录能力（同步，与 DatabaseSync 一致）。 */
export interface JobStore {
  append(job: JobRecord): void;
  /** since 之后每个码最后一次成功打印的时间，用于重启后恢复门限。 */
  listLastPrinted(since: number): LastPrinted[];
}
