import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { LookupTableData, LookupTableInfo } from '../../core/lookup/lookup-model';
import type { Clock } from '../../core/types';
import { runInTransaction } from './database';
import { readInteger, readString, readStringArray } from './row-readers';

/** 查找表的存取。整表导入、整表替换，没有逐行编辑（改表格请改 CSV 再导入）。 */
export class SqliteLookupStore {
  private readonly selectAll: StatementSync;
  private readonly selectOne: StatementSync;
  private readonly selectRows: StatementSync;
  private readonly selectFirstRows: StatementSync;
  private readonly insertTable: StatementSync;
  private readonly updateTable: StatementSync;
  private readonly insertRow: StatementSync;
  private readonly deleteRows: StatementSync;
  private readonly deleteTable: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    const info = 'id, name, columns, row_count, updated_at';
    this.selectAll = db.prepare(`SELECT ${info} FROM lookup_tables ORDER BY created_at, rowid`);
    this.selectOne = db.prepare(`SELECT ${info} FROM lookup_tables WHERE id = :id`);
    this.selectRows = db.prepare('SELECT cells FROM lookup_rows WHERE table_id = :id ORDER BY row_index');
    this.selectFirstRows = db.prepare(
      'SELECT cells FROM lookup_rows WHERE table_id = :id ORDER BY row_index LIMIT :limit',
    );
    this.insertTable = db.prepare(`
      INSERT INTO lookup_tables (id, name, columns, row_count, created_at, updated_at)
      VALUES (:id, :name, :columns, :rowCount, :now, :now)`);
    this.updateTable = db.prepare(`
      UPDATE lookup_tables SET columns = :columns, row_count = :rowCount, updated_at = :now WHERE id = :id`);
    this.insertRow = db.prepare('INSERT INTO lookup_rows (table_id, row_index, cells) VALUES (:id, :index, :cells)');
    this.deleteRows = db.prepare('DELETE FROM lookup_rows WHERE table_id = :id');
    this.deleteTable = db.prepare('DELETE FROM lookup_tables WHERE id = :id');
  }

  list(): LookupTableInfo[] {
    return this.selectAll.all().map(toInfo);
  }

  get(id: string): LookupTableInfo | null {
    const row = this.selectOne.get({ id });
    return row ? toInfo(row) : null;
  }

  create(id: string, name: string, data: LookupTableData): LookupTableInfo {
    runInTransaction(this.db, () => {
      this.insertTable.run({ id, name, ...this.shapeOf(data) });
      this.writeRows(id, data.rows);
    });
    return this.require(id);
  }

  /** 用新文件的内容替换整张表，id 和名称不变（规则里引用的仍然是这张表）。 */
  replace(id: string, data: LookupTableData): LookupTableInfo {
    runInTransaction(this.db, () => {
      this.updateTable.run({ id, ...this.shapeOf(data) });
      this.deleteRows.run({ id });
      this.writeRows(id, data.rows);
    });
    return this.require(id);
  }

  remove(id: string): void {
    this.deleteTable.run({ id });
  }

  /** 整张表的数据（建索引用）；表不存在时返回 null。 */
  load(id: string): LookupTableData | null {
    const info = this.get(id);
    if (!info) {
      return null;
    }
    const rows = this.selectRows.all({ id }).map((row) => readStringArray(row, 'cells'));
    return { columns: info.columns, rows };
  }

  /** 表格的前 limit 行（界面预览用）；表不存在时返回 null。 */
  loadRows(id: string, limit: number): LookupTableData | null {
    const info = this.get(id);
    if (!info) {
      return null;
    }
    const rows = this.selectFirstRows.all({ id, limit }).map((row) => readStringArray(row, 'cells'));
    return { columns: info.columns, rows };
  }

  private shapeOf(data: LookupTableData) {
    return { columns: JSON.stringify(data.columns), rowCount: data.rows.length, now: this.clock.now() };
  }

  private writeRows(id: string, rows: readonly string[][]): void {
    for (const [index, cells] of rows.entries()) {
      this.insertRow.run({ id, index, cells: JSON.stringify(cells) });
    }
  }

  private require(id: string): LookupTableInfo {
    const info = this.get(id);
    if (!info) {
      throw new Error(`Lookup table ${id} was not saved`);
    }
    return info;
  }
}

function toInfo(row: Record<string, unknown>): LookupTableInfo {
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    columns: readStringArray(row, 'columns'),
    rowCount: readInteger(row, 'row_count'),
    updatedAt: readInteger(row, 'updated_at'),
  };
}
