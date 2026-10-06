import type { JobRecord } from '../core/types';

export const JOB_PAGE_SIZE = 100;
export const MAX_JOB_PAGE_SIZE = 500;

export interface JobQuery {
  limit: number;
  /** 按打印内容（raw）模糊搜索（不区分 ASCII 大小写）；PDF 的记录内容里带着文件名，也能按文件名搜。 */
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
  /** 只看一批（带 batchId 查）时：这一批还有几张是失败的（每行每份最新一次）；没有时界面不显示「重打失败的」。 */
  batchFailed?: number;
}
