import type { KeyObject } from 'node:crypto';
import { CATALOG_SCHEMA } from '../../src/core/drivers/catalog-model';
import { sanitizeCatalog } from '../../src/core/drivers/sanitize-catalog';
import {
  type CatalogEnvelope,
  MAX_CATALOG_PAYLOAD_BYTES,
  signCatalogPayload,
} from '../../src/main/drivers/catalog-signature';

const MS_PER_SECOND = 1_000;
const MS_PER_DAY = 86_400_000;
/** 有效期默认 180 天：程序不用过期清单（防止拿旧清单回滚），半年重签一次不算麻烦。 */
export const DEFAULT_VALID_DAYS = 180;
/** 最长 400 天：有效期越长，撤下的条目（例如厂家撤回的驱动）能被重放的时间越长。 */
export const MAX_VALID_DAYS = 400;

export interface SignOptions {
  keyId: string;
  privateKey: KeyObject;
  now: number;
  validDays: number;
}

export type SignResult =
  | { ok: true; envelope: CatalogEnvelope; version: number; expiresAt: string; modelCount: number }
  | { ok: false; issues: string[] };

/**
 * 给出品方写的清单（只有 models）签名。schema、version、issuedAt、expiresAt 由脚本填：
 * 版本号取签名时刻的 Unix 秒数——不靠手工递增，也就不会忘了递增。
 * 按程序同一套 sanitizeCatalog 检查，任何一个型号不合格就不签：错在签名时暴露，不等装到用户电脑上。
 */
export function signCatalog(source: unknown, options: SignOptions): SignResult {
  if (!Number.isInteger(options.validDays) || options.validDays < 1 || options.validDays > MAX_VALID_DAYS) {
    return { ok: false, issues: [`有效期要在 1–${MAX_VALID_DAYS} 天之间`] };
  }
  const models =
    typeof source === 'object' && source !== null ? (source as Record<string, unknown>)['models'] : undefined;
  const payload = {
    schema: CATALOG_SCHEMA,
    version: Math.floor(options.now / MS_PER_SECOND),
    issuedAt: new Date(options.now).toISOString(),
    expiresAt: new Date(options.now + options.validDays * MS_PER_DAY).toISOString(),
    models,
  };
  const parsed = sanitizeCatalog(payload);
  if (!parsed.ok) {
    return { ok: false, issues: [parsed.issue] };
  }
  if (parsed.dropped.length > 0) {
    return { ok: false, issues: parsed.dropped };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length > MAX_CATALOG_PAYLOAD_BYTES) {
    return { ok: false, issues: [`清单超过 ${MAX_CATALOG_PAYLOAD_BYTES} 字节，程序不会接受`] };
  }
  return {
    ok: true,
    envelope: signCatalogPayload(bytes, options.keyId, options.privateKey),
    version: payload.version,
    expiresAt: payload.expiresAt,
    modelCount: parsed.catalog.models.length,
  };
}
