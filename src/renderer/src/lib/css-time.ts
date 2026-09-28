const MS_PER_SECOND = 1_000;

/**
 * 把 CSS 的时长（`160ms`、`0.16s`）换成毫秒；写法不认识时返回 null。
 * 动画时长只在 tokens.css 里写一份，脚本里要等动画结束时从这里读。
 */
export function parseCssTime(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)(ms|s)\s*$/.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  return match[2] === 's' ? amount * MS_PER_SECOND : amount;
}
