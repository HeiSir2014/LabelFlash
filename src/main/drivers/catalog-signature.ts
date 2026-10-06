import { createPublicKey, type KeyObject, sign, verify } from 'node:crypto';

/**
 * 驱动清单的签名信封：一个 JSON 文件 { format, keyId, payload, signature }。
 * - payload 是清单 JSON 原文的 base64：签的是原始字节，不用规范化 JSON；
 * - 签名覆盖「用途前缀 + payload 原始字节」：同一把私钥哪天签了别的东西，也不能被挪用成驱动清单；
 * - keyId 指明用哪把公钥核对：换密钥时新旧公钥可以同时内置。
 * 不依赖 electron：签名脚本（scripts/driver-catalog/）和测试直接用。
 */
export const CATALOG_SIGNING_CONTEXT = 'CDL-LabelFlash driver catalog v1\n';
export const CATALOG_ENVELOPE_FORMAT = 1;
/** 密钥编号：小写字母、数字和横杠，例如 2026a。 */
export const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BYTES_PER_MB = 1024 * 1024;
/** 清单原文最多 1MB：两千个型号每个约 400 字节，留足余量。 */
export const MAX_CATALOG_PAYLOAD_BYTES = BYTES_PER_MB;
/** 整个信封最多 2MB（base64 多三分之一，加上签名和字段名）；下载时超过就停。 */
export const MAX_CATALOG_ENVELOPE_BYTES = 2 * BYTES_PER_MB;
/** Ed25519 的公钥 32 字节、签名 64 字节（RFC 8032）。 */
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
/** 32 字节原始公钥包成 SPKI（DER）的固定前缀：SEQUENCE { AlgorithmIdentifier { id-Ed25519 }, BIT STRING }（RFC 8410）。 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_BLOCK = 4;

export interface CatalogEnvelope {
  format: typeof CATALOG_ENVELOPE_FORMAT;
  keyId: string;
  payload: string;
  signature: string;
}

export type EnvelopeOpen = { ok: true; keyId: string; payload: unknown } | { ok: false; issue: string };

/** base64 的 32 字节原始公钥 → KeyObject；格式不对时抛错（内置公钥写错应当在测试里就暴露）。 */
export function publicKeyFromRaw(base64: string): KeyObject {
  const raw = decodeBase64(base64);
  if (raw === null || raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error('An Ed25519 public key must be 32 bytes of canonical base64');
  }
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** KeyObject（公钥或私钥）→ base64 的 32 字节原始公钥：生成密钥时打印、签名前核对用。 */
export function rawPublicKey(key: KeyObject): string {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX.length).toString('base64');
}

/** 内置公钥表 → 编号到 KeyObject 的映射。 */
export function trustedKeys(record: Readonly<Record<string, string>>): ReadonlyMap<string, KeyObject> {
  return new Map(Object.entries(record).map(([keyId, base64]) => [keyId, publicKeyFromRaw(base64)]));
}

/** 签名（签名脚本和测试用）。 */
export function signCatalogPayload(payload: Uint8Array, keyId: string, privateKey: KeyObject): CatalogEnvelope {
  const signature = sign(null, signedBytes(payload), privateKey);
  return {
    format: CATALOG_ENVELOPE_FORMAT,
    keyId,
    payload: Buffer.from(payload).toString('base64'),
    signature: signature.toString('base64'),
  };
}

/**
 * 打开信封：先核对签名，再把 payload 解析成 JSON（还没校验，交给 sanitizeCatalog）。
 * 验签之前只解析信封这一层，清单内容在验签通过之前不当 JSON 解析。
 */
export function openCatalogEnvelope(text: string, keys: ReadonlyMap<string, KeyObject>): EnvelopeOpen {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issue: '驱动清单地址返回的不是驱动清单' };
  }
  const envelope = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const { format, keyId, payload, signature } = envelope;
  if (format !== CATALOG_ENVELOPE_FORMAT || typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) {
    return { ok: false, issue: '驱动清单地址返回的不是驱动清单' };
  }
  const key = keys.get(keyId);
  if (!key) {
    return { ok: false, issue: `驱动清单用的签名密钥（${keyId}）这个版本的程序不认识：请更新程序` };
  }
  const payloadBytes = typeof payload === 'string' ? decodeBase64(payload) : null;
  const signatureBytes = typeof signature === 'string' ? decodeBase64(signature) : null;
  if (
    payloadBytes === null ||
    signatureBytes === null ||
    payloadBytes.length > MAX_CATALOG_PAYLOAD_BYTES ||
    signatureBytes.length !== ED25519_SIGNATURE_BYTES
  ) {
    return { ok: false, issue: '驱动清单的格式不对' };
  }
  if (!verify(null, signedBytes(payloadBytes), key, signatureBytes)) {
    return { ok: false, issue: '驱动清单的签名不对，可能被改过，不使用' };
  }
  try {
    return { ok: true, keyId, payload: JSON.parse(payloadBytes.toString('utf8')) as unknown };
  } catch {
    return { ok: false, issue: '驱动清单的内容不是 JSON' };
  }
}

function signedBytes(payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(CATALOG_SIGNING_CONTEXT, 'utf8'), payload]);
}

/** 严格的 base64：Buffer.from 会悄悄跳过非法字符，这里要求重新编码后逐字相同。 */
function decodeBase64(text: string): Buffer | null {
  if (!BASE64_PATTERN.test(text) || text.length % BASE64_BLOCK !== 0) {
    return null;
  }
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? bytes : null;
}
