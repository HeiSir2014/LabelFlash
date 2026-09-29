import { describe, expect, test } from 'bun:test';
import { API_KEY_NAME_LENGTH, normalizeApiKeyName } from './local-api';

describe('normalizeApiKeyName', () => {
  test('trims a name', () => {
    expect(normalizeApiKeyName('  ERP 服务器 ')).toBe('ERP 服务器');
  });

  test('rejects empty, overlong and control-character names', () => {
    expect(normalizeApiKeyName('   ')).toBeNull();
    expect(normalizeApiKeyName('x'.repeat(API_KEY_NAME_LENGTH + 1))).toBeNull();
    expect(normalizeApiKeyName('a\nb')).toBeNull();
    expect(normalizeApiKeyName(7)).toBeNull();
  });
});
