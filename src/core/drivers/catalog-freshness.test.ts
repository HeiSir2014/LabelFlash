import { expect, test } from 'bun:test';
import { exampleCatalog } from '../testing/driver-catalog-fixtures';
import { checkCatalogFreshness } from './catalog-freshness';
import { MAX_CATALOG_VALIDITY_MS } from './catalog-model';

const catalog = exampleCatalog();

test('accepts a catalog within its validity and not older than the last one used', () => {
  expect(checkCatalogFreshness(catalog, catalog.version, catalog.issuedAt)).toEqual({ ok: true });
  expect(checkCatalogFreshness(catalog, null, catalog.expiresAt - 1)).toEqual({ ok: true });
});

test('refuses a catalog older than the newest one this computer has used', () => {
  expect(checkCatalogFreshness(catalog, catalog.version + 1, catalog.issuedAt)).toMatchObject({
    ok: false,
    reason: 'rolled-back',
  });
});

test('refuses an expired catalog and shows both the expiry and the computer clock', () => {
  const result = checkCatalogFreshness(catalog, null, catalog.expiresAt);
  expect(result).toMatchObject({ ok: false, reason: 'expired' });
  expect(result.ok ? '' : result.issue).toContain('2027-03-01');
});

test('refuses a catalog whose validity window is longer than 400 days, even though it is signed', () => {
  const tooLong = { ...catalog, expiresAt: catalog.issuedAt + MAX_CATALOG_VALIDITY_MS + 1 };
  expect(checkCatalogFreshness(tooLong, null, tooLong.issuedAt + 1)).toMatchObject({
    ok: false,
    reason: 'too-long-lived',
  });
});

test('accepts a catalog whose validity window is exactly 400 days', () => {
  const atLimit = { ...catalog, expiresAt: catalog.issuedAt + MAX_CATALOG_VALIDITY_MS };
  expect(checkCatalogFreshness(atLimit, null, atLimit.issuedAt + 1)).toEqual({ ok: true });
});
