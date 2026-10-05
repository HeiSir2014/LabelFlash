import { expect, test } from 'bun:test';
import { sanitizeCatalog } from '../../src/core/drivers/sanitize-catalog';
import { exampleModelSource } from '../../src/core/testing/driver-catalog-fixtures';
import { openCatalogEnvelope } from '../../src/main/drivers/catalog-signature';
import { createTestCatalogKeys } from '../../src/main/drivers/testing/catalog-keys';
import { DEFAULT_VALID_DAYS, MAX_VALID_DAYS, signCatalog } from './catalog-signing';

const keys = createTestCatalogKeys();
const NOW = Date.UTC(2026, 9, 2, 8, 0, 0);
const MS_PER_DAY = 86_400_000;
const options = { keyId: keys.keyId, privateKey: keys.privateKey, now: NOW, validDays: DEFAULT_VALID_DAYS };

test('fills in schema, version and validity and signs the models', () => {
  const result = signCatalog({ models: [exampleModelSource()] }, options);
  if (!result.ok) {
    throw new Error(result.issues.join('; '));
  }
  expect(result.version).toBe(NOW / 1000);
  const opened = openCatalogEnvelope(JSON.stringify(result.envelope), keys.trusted);
  const parsed = sanitizeCatalog(opened.ok ? opened.payload : null);
  expect(parsed).toMatchObject({
    ok: true,
    catalog: { version: NOW / 1000, issuedAt: NOW, expiresAt: NOW + DEFAULT_VALID_DAYS * MS_PER_DAY },
  });
});

test('refuses to sign when any model is invalid', () => {
  const broken = exampleModelSource({ id: 'Bad Id' });
  expect(signCatalog({ models: [exampleModelSource(), broken] }, options)).toEqual({
    ok: false,
    issues: ['第 2 个型号：编号只能用小写字母、数字和横杠，最长 64 个字符'],
  });
});

test('refuses a validity longer than the limit', () => {
  expect(signCatalog({ models: [] }, { ...options, validDays: MAX_VALID_DAYS + 1 })).toMatchObject({ ok: false });
});
