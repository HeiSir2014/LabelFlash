import { expect, test } from 'bun:test';
import { exampleCatalog } from '../testing/driver-catalog-fixtures';
import { checkCatalogFreshness } from './catalog-freshness';

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
