import type { JobRecord } from '../core/types';

export const JOB_PAGE_SIZE = 100;
export const MAX_JOB_PAGE_SIZE = 500;

export interface JobQuery {
  limit: number;
  /** 按二维码内容模糊搜索（不区分 ASCII 大小写）。 */
  search?: string;
  /** 分页游标：上一页返回的 nextCursor。 */
  before?: number;
  /** 只看这一批（批量打印的批次号）。 */
  batchId?: string;
}

export interface JobPage {
  /** 从新到旧。 */
  jobs: JobRecord[];
  nextCursor: number | null;
  /** 当前保留的记录总数（不受搜索影响）。 */
  total: number;
}
