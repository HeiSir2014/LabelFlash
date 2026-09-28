import type { LookupTableInfo } from '../../../core/lookup/lookup-model';
import { formatDateTime } from '../lib/status-text';
import { ConfirmButton } from './ConfirmButton';

interface LookupTablesProps {
  tables: readonly LookupTableInfo[];
  onImport: (replaceId: string | null) => void;
  onDelete: (id: string) => void;
}

/** 查找表：从 CSV 导入的本机表格（例如 编码 → 货架号），供加工步骤「查找表」使用。 */
export function LookupTables({ tables, onImport, onDelete }: LookupTablesProps) {
  return (
    <section className="form-section">
      <h3 className="form-section__title">查找表</h3>
      <p className="form-hint">
        从 Excel 另存为 CSV 导入（UTF-8 或中文 Excel 默认的 GBK 都可以），第一行是列名。表格只保存在这台电脑，
        改了表格重新「替换」即可，规则里引用的仍是同一张表。
      </p>
      <ul className="plain-list">
        {tables.map((table) => (
          <li key={table.id} className="plain-list__item">
            <div className="plain-list__text">
              <strong>{table.name}</strong>
              <span className="plain-list__meta">
                {table.rowCount} 行 · 列：{table.columns.join('、')} · 更新于 {formatDateTime(table.updatedAt)}
              </span>
            </div>
            <div className="plain-list__actions">
              <button type="button" className="button button--small button--quiet" onClick={() => onImport(table.id)}>
                替换
              </button>
              <ConfirmButton
                className="button button--small button--quiet"
                label="删除"
                confirmLabel="确认删除"
                onConfirm={() => onDelete(table.id)}
              />
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="button button--small" onClick={() => onImport(null)}>
        导入 CSV 表格
      </button>
    </section>
  );
}
