import { useCallback, useEffect, useState } from 'react';
import type { LookupTableData, LookupTableInfo } from '../../../core/lookup/lookup-model';
import { reportError } from '../lib/notices';

/**
 * 查找表页：点开一张表时读出前 20 行，核对导入得对不对。
 * 这张表被替换（更新时间变了）时重新读取；被删除时自动收起。
 */
export function useLookupPreview(tables: readonly LookupTableInfo[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<LookupTableData | null>(null);
  const open = tables.find((table) => table.id === selectedId) ?? null;
  const openId = open?.id ?? null;
  const openVersion = open?.updatedAt ?? null;

  useEffect(() => {
    setRows(null);
    if (openId === null || openVersion === null) {
      return;
    }
    let isCurrent = true;
    window.api
      .listLookupRows(openId)
      .then((data) => {
        if (isCurrent) {
          setRows(data);
        }
      })
      .catch((error: unknown) => reportError('读取表格内容', error));
    return () => {
      isCurrent = false;
    };
  }, [openId, openVersion]);

  const toggle = useCallback((id: string) => setSelectedId((current) => (current === id ? null : id)), []);

  return { openId, rows, toggle };
}
