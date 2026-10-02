/** 模板校验共用的小工具：输入一律不可信，类型不对就取 fallback，数值夹到范围内。 */

/** 宽松读取的输入对象：每一项都要再校验。 */
export type Loose = Record<string, unknown>;

/** 只接受普通对象；数组、null、其他类型当作空对象，后面每一项都会取默认值。 */
export function asLoose(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}

/** 不是布尔值就取 fallback。 */
export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 不是有限数字就取 fallback，再夹到 [min, max]。 */
export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

/** 只认列表里的值（字符串或数字，例如旋转角度 0 / 90 / 180 / 270）。 */
export function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  // 这里转两次类型是安全的：allowed 里只会放 T，真正做窄化判断的是 includes()。
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（保留换行）
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** 去掉控制字符（保留换行，文字可以多行）并截断长度。 */
export function sanitizeText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.replace(CONTROL_CHARACTERS, '').slice(0, maxLength);
}
