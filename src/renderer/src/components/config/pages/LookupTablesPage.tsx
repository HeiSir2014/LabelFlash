import type { LookupTableData, LookupTableInfo } from '../../../../../core/lookup/lookup-model';
import { formatDateTime } from '../../../lib/status-text';
import { useLookupPreview } from '../../../view-models/use-lookup-preview';
import { ConfirmButton } from '../../ConfirmButton';

interface LookupTablesPageProps {
  tables: readonly LookupTableInfo[];
  onImport: (replaceId: string | null) => void;
  onDelete: (id: string) => void;
}

/** 查找表：从 CSV 导入的本机表格（例如 编码 → 货架号），供加工步骤「查找表」使用。 */
export function LookupTablesPage({ tables, onImport, onDelete }: LookupTablesPageProps) {
  const { openId, rows, toggle } = useLookupPreview(tables);
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
            const isOpen = table.id === openId;
            return (
              <li key={table.id} className="config-card lookup-card">
                <div className="lookup-card__head">
                  <div className="lookup-card__text">
                    <strong className="lookup-card__name">{table.name}</strong>
                    <span className="lookup-card__meta">
                      {table.rowCount} 行 · 列：{table.columns.join('、')} · 更新于 {formatDateTime(table.updatedAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    aria-expanded={isOpen}
                    onClick={() => toggle(table.id)}
                  >
                    {isOpen ? '收起' : '查看前 20 行'}
                  </button>
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    onClick={() => onImport(table.id)}
                  >
                    替换
                  </button>
                  <ConfirmButton
                    className="button button--small button--quiet"
                    label="删除"
                    confirmLabel="确认删除"
                    onConfirm={() => onDelete(table.id)}
                  />
                </div>
                {isOpen && <RowsPreview name={table.name} rows={rows} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 前 20 行：表头固定；列多时表格自己横向滚动，页面不跟着变宽。 */
function RowsPreview({ name, rows }: { name: string; rows: LookupTableData | null }) {
  if (rows === null) {
    return <p className="config-empty">正在读取…</p>;
  }
  return (
    <div className="data-table">
      <table aria-label={`「${name}」前 20 行`}>
        <thead>
          <tr>
            {rows.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((cells, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 只读预览，行号就是身份
            <tr key={rowIndex}>
              {rows.columns.map((column, cellIndex) => (
                <td key={column}>{cells[cellIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
