/** 查找表：从 CSV 导入的本机表格，加工步骤按一列精确匹配、取出其他列。 */
export interface LookupTableInfo {
  id: string;
  name: string;
  columns: string[];
  rowCount: number;
  updatedAt: number;
}

export const LOOKUP_LIMITS = {
  /** 文件大小：20MB。 */
  fileBytes: 20 * 1024 * 1024,
  rows: 100_000,
  columns: 20,
  columnNameLength: 50,
  cellLength: 1_000,
  nameLength: 40,
  tables: 20,
} as const;

/** 解析好的表格：rows 的每一行长度都等于 columns。 */
export interface LookupTableData {
  columns: string[];
  rows: string[][];
}

/** 匹配用的键：去掉首尾空白，忽略大小写时统一成小写。 */
export function normalizeKey(value: string, ignoreCase: boolean): string {
  const trimmed = value.trim();
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}
