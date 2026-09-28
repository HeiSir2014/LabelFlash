export type Row = Record<string, unknown>;

/** 数据库行进入领域层前的类型校验：列类型不符说明数据损坏，直接抛错。 */
export function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`Column "${column}" is not TEXT`);
  }
  return value;
}

export function readInteger(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`Column "${column}" is not INTEGER`);
  }
  return value;
}

export function readEnum<T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = readString(row, column);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`Column "${column}" has unexpected value "${value}"`);
  }
  return value as T;
}
