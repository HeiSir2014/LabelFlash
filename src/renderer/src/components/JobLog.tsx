import { TEMPLATE_CHANGED_ISSUE } from '../../../core/api/template-fields';
import type { JobRecord } from '../../../core/types';
import { canReprint, type ReprintMode } from '../lib/reprint';
import { describeJobMeta, describeJobStatus } from '../lib/status-text';

/** 多行内容在列表里只显示第一行，完整内容放在悬停提示里。 */
function firstLine(raw: string): string {
  const [first = '', ...rest] = raw.split('\n');
  return rest.length > 0 ? `${first} …` : first;
}

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

interface JobLogProps {
  jobs: JobRecord[];
  total: number;
  historyLimit: number;
  search: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  /** 翻到后面几页时本机接口打了新标签：显示「有新记录」，点了回到第一页。 */
  hasNewJobs: boolean;
  onShowNewJobs: () => void;
  onSearchChange: (search: string) => void;
  onLoadMore: () => void;
  /** 本机接口记录的调用方（密钥名称或网站）；其他记录为 null。 */
  callerOf: (job: JobRecord) => string | null;
  /** 这条记录能不能、怎么预览和重打（见 lib/reprint.ts）；不能重打（unavailable、expired、template-changed）时不显示按钮。 */
  reprintModeOf: (job: JobRecord) => ReprintMode;
  onReview: (job: JobRecord) => void;
  onReprint: (job: JobRecord) => void;
  /** 只看这一批（批次号）；null = 全部。 */
  batchFilter: string | null;
  onFilterBatch: (batchId: string | null) => void;
  /** 重打这一批失败的标签（打开批量打印页看进度）。 */
  onRetryBatch: (batchId: string) => void;
}

export function JobLog({
  jobs,
  total,
  historyLimit,
  search,
  hasMore,
  isLoadingMore,
  hasNewJobs,
  onShowNewJobs,
  onSearchChange,
  onLoadMore,
  callerOf,
  reprintModeOf,
  onReview,
  onReprint,
  batchFilter,
  onFilterBatch,
  onRetryBatch,
}: JobLogProps) {
  const isSearching = search.trim() !== '';

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <input
          type="search"
          className="text-field"
          aria-label="搜索打印记录"
          placeholder="按扫码内容搜索"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <span className="job-log__count" title="超出上限后自动删除最早的记录">
          {NUMBER_FORMAT.format(total)} / {NUMBER_FORMAT.format(historyLimit)}
        </span>
      </div>
      {batchFilter !== null && (
        <div className="job-log__batch">
          <span className="job-log__batch-name">批次 {batchFilter}</span>
          <button type="button" className="button button--small" onClick={() => onRetryBatch(batchFilter)}>
            重打失败的
          </button>
          <button type="button" className="button button--small button--quiet" onClick={() => onFilterBatch(null)}>
            显示全部
          </button>
        </div>
      )}
      {hasNewJobs && (
        <button type="button" className="button button--small job-log__new" onClick={onShowNewJobs}>
          有新记录，回到最新
        </button>
      )}
      <ol className="scroll-list">
        {jobs.map((job) => {
          const status = describeJobStatus(job);
          const meta = describeJobMeta(job, callerOf(job));
          const batchId = job.batch?.id;
          const mode = reprintModeOf(job);
          return (
            <li key={job.id} className="job-row">
              <div className="job-row__main">
                <span className={`job-row__status tone--${status.tone}`}>{status.text}</span>
                <span className="job-row__raw" title={job.raw}>
                  {firstLine(job.raw)}
                </span>
              </div>
              {/* 打印机名可能很长，放不下时省略，完整内容在悬停提示里。 */}
              <div className="job-row__meta" title={meta}>
                {meta}
              </div>
              {mode === 'expired' && <p className="job-row__hint">PDF 的图只保留 7 天，已过期：重新打开 PDF 再打</p>}
              {mode === 'template-changed' && <p className="job-row__hint">{TEMPLATE_CHANGED_ISSUE}</p>}
              {(canReprint(mode) || (batchId !== undefined && batchFilter === null)) && (
                <div className="job-row__actions">
                  {batchId !== undefined && batchFilter === null && (
                    <button
                      type="button"
                      className="button button--small button--quiet"
                      onClick={() => onFilterBatch(batchId)}
                    >
                      这一批
                    </button>
                  )}
                  {canReprint(mode) && (
                    <>
                      <button
                        type="button"
                        className="button button--small button--quiet"
                        onClick={() => onReview(job)}
                      >
                        预览
                      </button>
                      <button type="button" className="button button--small" onClick={() => onReprint(job)}>
                        重打
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {hasMore && (
          <li className="job-log__more">
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? '加载中…' : '加载更早的记录'}
            </button>
          </li>
        )}
      </ol>
      {jobs.length === 0 && (
        <p className="empty">
          {batchFilter !== null
            ? '这一批还没有打印记录'
            : isSearching
              ? `没有包含「${search.trim()}」的记录`
              : '还没有打印记录。扫一张标签试试'}
        </p>
      )}
    </div>
  );
}
