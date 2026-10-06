/** 局域网共享里主进程和界面共用的规则和类型。设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 8.1 节。 */

/** 默认端口 8631：macOS 的 631 是 CUPS 的（主进程依次试 8631–8640，界面上的说明也按它写）。 */
export const DEFAULT_IPP_PORT = 8631;

/** 共享密码 4–64 个字：短于 4 个字随手就能试出来；再长没有意义（明文 HTTP 上本来就能被抓包）。 */
export const SHARE_PASSWORD_LENGTH = { min: 4, max: 64 } as const;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 密码里不允许任何控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** 共享密码合不合规则（界面和主进程用同一条）。 */
export function isValidSharePassword(value: unknown): value is string {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) {
    return false;
  }
  const length = [...value].length;
  return length >= SHARE_PASSWORD_LENGTH.min && length <= SHARE_PASSWORD_LENGTH.max;
}
