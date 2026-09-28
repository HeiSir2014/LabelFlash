import { LOOKUP_PREVIEW_ROWS, type LookupTableInfo } from '../../../../../core/lookup/lookup-model';
import { formatDateTime } from '../../../lib/status-text';
import type { LookupPreviewModel, LookupRows } from '../../../view-models/use-lookup-preview';
import { DeleteButton } from '../../ConfirmButton';

export interface LookupTablesPageProps {
  tables: readonly LookupTableInfo[];
  /** 点开的那张表和它的前几行。 */
  preview: LookupPreviewModel;
  onImport: (replaceId: string | null) => void;
  onDelete: (id: string) => void;
}

/** 查找表：从 CSV 导入的本机表格（例如 编码 → 货架号），供加工步骤「查找表」使用。 */
export function LookupTablesPage({ tables, preview, onImport, onDelete }: LookupTablesPageProps) {
  return (
    <div className="config-page">
      <div className="config-page__head">
        <p className="config-page__intro">
          从 Excel 另存为 CSV 导入（UTF-8 或中文 Excel 默认的 GBK
          都可以），第一行是列名。表格只保存在这台电脑；表格改了就点「替换」重新导入，规则里引用的仍是同一张表。
        </p>
        <button type="button" className="button button--primary" onClick={() => onImport(null)}>
          导入 CSV 表格
        </button>
      </div>
      {tables.length === 0 ? (
        <p className="config-empty">还没有查找表。</p>
      ) : (
        <ul className="config-list">
          {tables.map((table) => {
            const isOpen = table.id === preview.openId;
            // 列多时放不下，省略后完整内容在悬停提示里。
            const meta = `${table.rowCount} 行 · 列：${table.columns.join('、')} · 更新于 ${formatDateTime(table.updatedAt)}`;
            return (
              <li key={table.id} className="config-card lookup-card">
                <div className="lookup-card__head">
                  <div className="lookup-card__text">
                    <strong className="lookup-card__name">{table.name}</strong>
                    <span className="lookup-card__meta" title={meta}>
                      {meta}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    aria-expanded={isOpen}
                    onClick={() => preview.toggle(table.id)}
                  >
                    {isOpen ? '收起' : `查看前 ${LOOKUP_PREVIEW_ROWS} 行`}
                  </button>
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    onClick={() => onImport(table.id)}
                  >
                    替换
                  </button>
                  <DeleteButton onConfirm={() => onDelete(table.id)} />
                </div>
                {isOpen && <RowsPreview name={table.name} rows={preview.rows} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 前几行：表头固定；列多时表格自己横向滚动，页面不跟着变宽。 */
function RowsPreview({ name, rows }: { name: string; rows: LookupRows }) {
  if (rows.state === 'loading') {
    return <p className="config-empty">正在读取…</p>;
  }
  if (rows.state === 'failed') {
    return <p className="config-empty">读取表格内容失败，详情已写入日志。可以收起后再点开重试。</p>;
  }
  const { columns, rows: cells } = rows.data;
  return (
    <div className="data-table" data-allow-x-scroll>
      <table aria-label={`「${name}」前 ${LOOKUP_PREVIEW_ROWS} 行`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 只读预览，行号就是身份
            <tr key={rowIndex}>
              {columns.map((column, cellIndex) => (
                <td key={column}>{row[cellIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
