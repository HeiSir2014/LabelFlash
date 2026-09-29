import { useCallback, useEffect, useRef, useState } from 'react';
import { JOB_PAGE_SIZE, type JobPage } from '../../../shared/job-history';
import { reportError } from '../lib/notices';

const SEARCH_DEBOUNCE_MS = 200;
const EMPTY_PAGE: JobPage = { jobs: [], nextCursor: null, total: 0 };

/** 打印记录只按页加载（容量可达百万级），搜索交给数据库的全文索引。 */
export function useJobLog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<JobPage>(EMPTY_PAGE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const searchRef = useRef(search);
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async (query: string) => {
    requestId.current += 1;
    const id = requestId.current;
    try {
      const first = await window.api.listJobs({ limit: JOB_PAGE_SIZE, search: query });
      if (id === requestId.current) {
        setPage(first);
      }
    } catch (error) {
      reportError('读取打印记录', error);
    }
  }, []);

  useEffect(() => {
    searchRef.current = search;
    const timer = window.setTimeout(() => void loadFirstPage(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, loadFirstPage]);

  const refresh = useCallback(() => loadFirstPage(searchRef.current), [loadFirstPage]);

  // 本机接口打的标签不经过界面：主进程写了打印记录后推送，这里跟着刷新（不播报）。
  useEffect(() => window.api.onJobsChanged(() => void refresh()), [refresh]);

  const loadMore = useCallback(async () => {
    if (page.nextCursor === null || isLoadingMore) {
      return;
    }
    const id = requestId.current;
    setIsLoadingMore(true);
    try {
      const next = await window.api.listJobs({
        limit: JOB_PAGE_SIZE,
        search: searchRef.current,
        before: page.nextCursor,
      });
      if (id === requestId.current) {
        setPage((current) => ({
          jobs: [...current.jobs, ...next.jobs],
          nextCursor: next.nextCursor,
          total: next.total,
        }));
      }
    } catch (error) {
      reportError('读取更早的打印记录', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [page.nextCursor, isLoadingMore]);

  return {
    jobs: page.jobs,
    total: page.total,
    hasMore: page.nextCursor !== null,
    isLoadingMore,
    search,
    setSearch,
    refresh,
    loadMore,
  };
}
