import { useCallback, useEffect, useState } from 'react';
import type { LookupTableData, LookupTableInfo } from '../../../core/lookup/lookup-model';
import { reportError } from '../lib/notices';

/** 点开的那张表的内容：读取中、读到了，或读取失败。 */
export type LookupRows = { state: 'loading' } | { state: 'loaded'; data: LookupTableData } | { state: 'failed' };

/**
 * 查找表页：点开一张表时读出前 LOOKUP_PREVIEW_ROWS 行，核对导入得对不对。
 * 这张表被替换（更新时间变了）时重新读取；被删除时自动收起。
 */
export function useLookupPreview(tables: readonly LookupTableInfo[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<LookupRows>({ state: 'loading' });
  const open = tables.find((table) => table.id === selectedId) ?? null;
  const openId = open?.id ?? null;
  const openVersion = open?.updatedAt ?? null;

  useEffect(() => {
    setRows({ state: 'loading' });
    if (openId === null || openVersion === null) {
      return;
    }
    let isCurrent = true;
    window.api
      .listLookupRows(openId)
      .then((data) => {
        if (isCurrent) {
          // 表刚被删掉时主进程返回 null：随后列表刷新，这张表自动收起。
          setRows(data ? { state: 'loaded', data } : { state: 'failed' });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setRows({ state: 'failed' });
        }
        reportError('读取表格内容', error);
      });
    return () => {
      isCurrent = false;
    };
  }, [openId, openVersion]);

  const toggle = useCallback((id: string) => setSelectedId((current) => (current === id ? null : id)), []);

  return { openId, rows, toggle };
}

export type LookupPreviewModel = ReturnType<typeof useLookupPreview>;
