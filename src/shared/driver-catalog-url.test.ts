import { expect, test } from 'bun:test';
import { sanitizeCatalogUrl } from './driver-catalog-url';

test('accepts https addresses and keeps the query', () => {
  expect(sanitizeCatalogUrl(' https://catalog.example.com/labelflash/driver-catalog.json?v=1 ')).toBe(
    'https://catalog.example.com/labelflash/driver-catalog.json?v=1',
  );
});

test('accepts plain http only on this computer (development and E2E)', () => {
  expect(sanitizeCatalogUrl('http://127.0.0.1:8080/driver-catalog.json')).toBe(
    'http://127.0.0.1:8080/driver-catalog.json',
  );
  expect(sanitizeCatalogUrl('http://catalog.example.com/driver-catalog.json')).toBeNull();
});

test('refuses credentials, fragments, other schemes and junk', () => {
  expect(sanitizeCatalogUrl('https://user:pass@catalog.example.com/c.json')).toBeNull();
  expect(sanitizeCatalogUrl('https://catalog.example.com/c.json#x')).toBeNull();
  expect(sanitizeCatalogUrl('file:///C:/c.json')).toBeNull();
  expect(sanitizeCatalogUrl('')).toBeNull();
  expect(sanitizeCatalogUrl(42)).toBeNull();
});
