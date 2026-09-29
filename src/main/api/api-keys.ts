import { createHash, randomBytes } from 'node:crypto';

/** 32 字节随机数（256 位），base64url 后 43 个字符。 */
const KEY_BYTES = 32;
/** 前缀方便在调用方的配置、日志里认出这是本程序的密钥。 */
export const API_KEY_PREFIX = 'lf_';

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
}

/** 只保存摘要：数据库泄露也拿不到能用的密钥。密钥本身是高熵随机数，不需要加盐和慢哈希。 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
