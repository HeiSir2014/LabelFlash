import { readFileSync } from 'node:fs';

/**
 * 读一份系统命令输出的样本（`fixtures/<平台>/<名字>`）。按原样保存，不经过格式化工具；
 * git 在 Windows 上可能换成 CRLF，解析器都按 \r?\n 分行、去掉首尾空白。
 */
export function fixture(platform: 'windows' | 'mac', name: string): string {
  return readFileSync(new URL(`fixtures/${platform}/${name}`, import.meta.url), 'utf8');
}
