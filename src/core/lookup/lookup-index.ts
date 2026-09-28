import { type LookupTableData, normalizeKey } from './lookup-model';

type Row = Readonly<Record<string, string>>;
/** null = 表不存在或没有这一列（也缓存，避免每次扫码都读库）。 */
type ColumnIndex = Map<string, Row> | null;

/**
 * 查找表的内存索引：第一次按某一列查时把整张表读进来建一个「键 → 行」的 Map，之后都是 O(1)。
 * 同一个键出现多次时取第一行。表格替换或删除后调用 invalidate。
 */
export class LookupIndex {
  /** 表 id → （匹配列 + 是否忽略大小写）→ 索引。 */
  private readonly tables = new Map<string, Map<string, ColumnIndex>>();

  constructor(private readonly load: (tableId: string) => LookupTableData | null) {}

  find(tableId: string, keyColumn: string, key: string, ignoreCase: boolean): Row | null {
    let columns = this.tables.get(tableId);
    if (!columns) {
      columns = new Map();
      this.tables.set(tableId, columns);
    }
    const columnKey = `${ignoreCase ? 'i' : 'c'}:${keyColumn}`;
    let index = columns.get(columnKey);
    if (index === undefined) {
      index = this.build(tableId, keyColumn, ignoreCase);
      columns.set(columnKey, index);
    }
    return index?.get(normalizeKey(key, ignoreCase)) ?? null;
  }

  invalidate(tableId: string): void {
    this.tables.delete(tableId);
  }

  private build(tableId: string, keyColumn: string, ignoreCase: boolean): ColumnIndex {
    const data = this.load(tableId);
    const keyPosition = data?.columns.indexOf(keyColumn) ?? -1;
    if (!data || keyPosition === -1) {
      return null;
    }
    const index = new Map<string, Row>();
    for (const cells of data.rows) {
      const key = normalizeKey(cells[keyPosition] ?? '', ignoreCase);
      if (key !== '' && !index.has(key)) {
        index.set(key, Object.fromEntries(data.columns.map((column, position) => [column, cells[position] ?? ''])));
      }
    }
    return index;
  }
}
