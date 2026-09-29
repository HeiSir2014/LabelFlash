import { describe, expect, test } from 'bun:test';
import { API_KEY_NAME_LENGTH, isWebOrigin, normalizeApiKeyName } from './local-api';

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

describe('isWebOrigin', () => {
  // 只有 http/https 的网站能按网站记住授权；file:// 页面和沙盒 iframe 的 Origin 是 null。
  test('accepts only http and https origins', () => {
    expect(isWebOrigin('https://erp.example.com')).toBe(true);
    expect(isWebOrigin('http://localhost:8080')).toBe(true);
    expect(isWebOrigin('null')).toBe(false);
    expect(isWebOrigin('file://')).toBe(false);
    expect(isWebOrigin('chrome-extension://abc')).toBe(false);
    expect(isWebOrigin('https://erp.example.com/path')).toBe(false);
  });
});
