import type { SerialSettings } from './batch-model';

/** 第 position 张（从 0 数，按要打的行的顺序）的序号文字；位数只补零、不截断。 */
export function serialText(settings: SerialSettings, position: number): string {
  const value = settings.start + position * settings.step;
  return `${settings.prefix}${String(value).padStart(settings.digits, '0')}${settings.suffix}`;
}
