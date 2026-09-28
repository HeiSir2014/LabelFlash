import { describe, expect, test } from 'bun:test';
import { MAX_RELAY_URL_LENGTH, sanitizeRelayUrl } from './relay-url';

describe('sanitizeRelayUrl', () => {
  test('accepts an https address and adds the trailing slash', () => {
    expect(sanitizeRelayUrl('https://relay.example.com/labelflash')).toBe('https://relay.example.com/labelflash/');
    expect(sanitizeRelayUrl(' https://relay.example.com/ ')).toBe('https://relay.example.com/');
  });

  test('accepts plain http only on this machine, for development', () => {
    expect(sanitizeRelayUrl('http://localhost:3180')).toBe('http://localhost:3180/');
    expect(sanitizeRelayUrl('http://127.0.0.1:3180/')).toBe('http://127.0.0.1:3180/');
    expect(sanitizeRelayUrl('http://relay.example.com/')).toBeNull();
  });

  test('rejects anything that is not an address without credentials, query or fragment', () => {
    for (const value of [
      '',
      'relay.example.com',
      'ftp://relay.example.com/',
      'https://relay.example.com/?a=1',
      'https://relay.example.com/#x',
      'https://user:pass@relay.example.com/',
      `https://relay.example.com/${'x'.repeat(MAX_RELAY_URL_LENGTH)}`,
      42,
      null,
    ]) {
      expect(sanitizeRelayUrl(value)).toBeNull();
    }
  });
});
