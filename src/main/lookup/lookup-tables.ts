import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { parseCsv } from '../../core/lookup/csv';
import { decodeCsvBytes } from '../../core/lookup/decode-text';
import { LookupIndex } from '../../core/lookup/lookup-index';
import { LOOKUP_LIMITS, type LookupTableInfo } from '../../core/lookup/lookup-model';
import type { LookupImportResult } from '../../shared/ipc-contract';
import type { SqliteLookupStore } from '../storage/sqlite-lookup-store';

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** 查找表：导入 CSV、替换、删除，以及加工步骤用的查询（带内存索引）。 */
export class LookupTables {
  private readonly index: LookupIndex;

  constructor(
    private readonly store: SqliteLookupStore,
    private readonly createId: () => string,
  ) {
    this.index = new LookupIndex((tableId) => store.load(tableId));
  }

  list(): LookupTableInfo[] {
    return this.store.list();
  }

  find(tableId: string, keyColumn: string, key: string, ignoreCase: boolean): Readonly<Record<string, string>> | null {
    return this.index.find(tableId, keyColumn, key, ignoreCase);
  }

  /** 导入新表；replaceId 不为 null 时替换那张表的内容（id 和名称不变）。 */
  async importFile(path: string, replaceId: string | null): Promise<LookupImportResult> {
    if (replaceId !== null && !this.store.get(replaceId)) {
      return { status: 'invalid', issue: '要替换的表格已经不存在' };
    }
    if (replaceId === null && this.store.list().length >= LOOKUP_LIMITS.tables) {
      return { status: 'invalid', issue: `查找表最多 ${LOOKUP_LIMITS.tables} 张，请先删除不用的表` };
    }
    const { size } = await stat(path);
    if (size > LOOKUP_LIMITS.fileBytes) {
      return { status: 'invalid', issue: `文件不能超过 ${LOOKUP_LIMITS.fileBytes / BYTES_PER_MEGABYTE}MB` };
    }
    const parsed = parseCsv(decodeCsvBytes(await readFile(path)));
    if (!parsed.ok) {
      return { status: 'invalid', issue: parsed.issue };
    }
    const table =
      replaceId === null
        ? this.store.create(this.createId(), tableName(path), parsed.table)
        : this.store.replace(replaceId, parsed.table);
    this.index.invalidate(table.id);
    return { status: 'imported', table };
  }

  remove(id: string): void {
    this.store.remove(id);
    this.index.invalidate(id);
  }
}

/** 表名取文件名（不含扩展名）。 */
function tableName(path: string): string {
  const name = basename(path, extname(path)).trim();
  return (name || '查找表').slice(0, LOOKUP_LIMITS.nameLength);
}
