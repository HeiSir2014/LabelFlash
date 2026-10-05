import { describe, expect, test } from 'bun:test';
import { sign } from 'node:crypto';
import { exampleCatalogSource } from '../../core/testing/driver-catalog-fixtures';
import { DRIVER_CATALOG_PUBLIC_KEYS } from '../../shared/driver-catalog-keys';
import {
  KEY_ID_PATTERN,
  MAX_CATALOG_PAYLOAD_BYTES,
  openCatalogEnvelope,
  publicKeyFromRaw,
  rawPublicKey,
  signCatalogPayload,
} from './catalog-signature';
import { createTestCatalogKeys, signedCatalogText } from './testing/catalog-keys';

const keys = createTestCatalogKeys();

describe('openCatalogEnvelope', () => {
  test('opens an envelope signed by a trusted key', () => {
    expect(openCatalogEnvelope(signedCatalogText(exampleCatalogSource(), keys), keys.trusted)).toEqual({
      ok: true,
      keyId: 'test',
      payload: exampleCatalogSource(),
    });
  });

  test('refuses a payload changed after signing', () => {
    const envelope = JSON.parse(signedCatalogText(exampleCatalogSource(), keys)) as Record<string, string>;
    const changed = JSON.stringify({ ...exampleCatalogSource(), version: 1 });
    envelope['payload'] = Buffer.from(changed).toString('base64');
    expect(openCatalogEnvelope(JSON.stringify(envelope), keys.trusted)).toEqual({
      ok: false,
      issue: '驱动清单的签名不对，可能被改过，不使用',
    });
  });

  test('refuses a signature made without the signing context', () => {
    const payload = Buffer.from(JSON.stringify(exampleCatalogSource()));
    const envelope = {
      format: 1,
      keyId: keys.keyId,
      payload: payload.toString('base64'),
      signature: sign(null, payload, keys.privateKey).toString('base64'),
    };
    expect(openCatalogEnvelope(JSON.stringify(envelope), keys.trusted)).toMatchObject({ ok: false });
  });

  test('asks for an update when the key id is unknown', () => {
    const other = createTestCatalogKeys('other');
    expect(openCatalogEnvelope(signedCatalogText(exampleCatalogSource(), other), keys.trusted)).toEqual({
      ok: false,
      issue: '驱动清单用的签名密钥（other）这个版本的程序不认识：请更新程序',
    });
  });

  test('refuses non-canonical base64, non-JSON text and oversized payloads', () => {
    const envelope = JSON.parse(signedCatalogText(exampleCatalogSource(), keys)) as Record<string, string>;
    expect(
      openCatalogEnvelope(JSON.stringify({ ...envelope, payload: `${envelope['payload']}\n` }), keys.trusted),
    ).toMatchObject({ ok: false });
    expect(openCatalogEnvelope('<html>', keys.trusted)).toMatchObject({ ok: false });
    const big = signCatalogPayload(new Uint8Array(MAX_CATALOG_PAYLOAD_BYTES + 1), keys.keyId, keys.privateKey);
    expect(openCatalogEnvelope(JSON.stringify(big), keys.trusted)).toMatchObject({ ok: false });
  });
});

describe('raw public keys', () => {
  test('round-trip through base64', () => {
    expect(rawPublicKey(publicKeyFromRaw(keys.publicKey))).toBe(keys.publicKey);
  });

  test('every embedded key is a valid Ed25519 public key with a valid id', () => {
    for (const [keyId, publicKey] of Object.entries(DRIVER_CATALOG_PUBLIC_KEYS)) {
      expect(keyId).toMatch(KEY_ID_PATTERN);
      expect(() => publicKeyFromRaw(publicKey)).not.toThrow();
    }
  });
});
