import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { rawPublicKey, signCatalogPayload, trustedKeys } from '../catalog-signature';

export interface TestCatalogKeys {
  keyId: string;
  privateKey: KeyObject;
  /** base64 的 32 字节原始公钥（E2E 经环境变量交给程序）。 */
  publicKey: string;
  trusted: ReadonlyMap<string, KeyObject>;
}

/** 测试现场生成一对密钥：仓库里不放任何私钥。 */
export function createTestCatalogKeys(keyId = 'test'): TestCatalogKeys {
  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKey = rawPublicKey(privateKey);
  return { keyId, privateKey, publicKey, trusted: trustedKeys({ [keyId]: publicKey }) };
}

/** 把清单内容签成信封原文（测试、E2E 用；正式清单用 scripts/driver-catalog/sign.ts）。 */
export function signedCatalogText(payload: unknown, keys: TestCatalogKeys): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return JSON.stringify(signCatalogPayload(bytes, keys.keyId, keys.privateKey));
}
