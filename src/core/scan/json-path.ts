/**
 * 从 JSON 里取值的简单路径：`data.shelf`、`items[0].name`、`[0]`。
 * 只支持属性名和数组下标，不支持通配符和表达式：够用、好懂、不会被写成代码。
 */
export type JsonPath = ReadonlyArray<string | number>;

const TOKEN = /\.?([^.[\]]+)|\[(\d+)\]/y;

export function parseJsonPath(path: string): JsonPath | null {
  if (path === '' || path.startsWith('.') || path.endsWith('.')) {
    return null;
  }
  const segments: Array<string | number> = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < path.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(path);
    if (!match) {
      return null;
    }
    const [, name, index] = match;
    if (name !== undefined) {
      // 第一个属性名前面不能有点，后面的属性名前面必须有点。
      const hasDot = path[start] === '.';
      if (hasDot === (segments.length === 0)) {
        return null;
      }
      segments.push(name);
    } else {
      segments.push(Number(index));
    }
  }
  return segments;
}

/** 取到字符串、数字或布尔值时转成文本；取不到、或取到的是对象 / 数组 / null 时返回 null。 */
export function readJsonPath(value: unknown, path: JsonPath): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        return null;
      }
      current = current[segment];
    } else {
      if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
        return null;
      }
      current = current[segment];
    }
  }
  if (typeof current === 'string') {
    return current;
  }
  if (typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
