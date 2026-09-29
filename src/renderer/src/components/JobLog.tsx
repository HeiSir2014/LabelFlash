import type { JobRecord } from '../../../core/types';
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
  onSearchChange: (search: string) => void;
  onLoadMore: () => void;
  onReview: (raw: string) => void;
  onReprint: (raw: string) => void;
}

export function JobLog({
  jobs,
  total,
  historyLimit,
  search,
  hasMore,
  isLoadingMore,
  onSearchChange,
  onLoadMore,
  onReview,
  onReprint,
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
      <ol className="scroll-list">
        {jobs.map((job) => {
          const status = describeJobStatus(job);
          const meta = describeJobMeta(job);
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
              {job.status !== 'invalid' && (
                <div className="job-row__actions">
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    onClick={() => onReview(job.raw)}
                  >
                    预览
                  </button>
                  <button type="button" className="button button--small" onClick={() => onReprint(job.raw)}>
                    重打
                  </button>
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
        <p className="empty">{isSearching ? `没有包含「${search.trim()}」的记录` : '还没有打印记录。扫一张标签试试'}</p>
      )}
    </div>
  );
}
