const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * 防重复窗口用能整除的最大单位显示：3 秒、90 秒、10 分钟、2 小时。
 * 电脑界面和手机扫码页共用，同一个窗口两边说法一致。
 */
export function formatWindow(windowMs: number): string {
  const seconds = Math.round(windowMs / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE || seconds % SECONDS_PER_MINUTE !== 0) {
    return `${seconds} 秒`;
  }
  const minutes = seconds / SECONDS_PER_MINUTE;
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
    return `${minutes / MINUTES_PER_HOUR} 小时`;
  }
  return `${minutes} 分钟`;
}
