import { describe, expect, test } from 'bun:test';
import { generateApiKey, hashApiKey } from './api-keys';

describe('api keys', () => {
  test('generates a prefixed random key', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^lf_[A-Za-z0-9_-]{43}$/);
    expect(generateApiKey()).not.toBe(key);
  });

  test('hashes a key to a stable SHA-256 hex digest', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(`${key}x`)).not.toBe(hashApiKey(key));
  });
});
