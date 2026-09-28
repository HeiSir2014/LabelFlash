import { describe, expect, test } from 'bun:test';
import { desktopSocketUrl, resolveRelayBase, sanitizeRelayUrl } from './relay-endpoint';

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

  test('rejects anything that is not an address without query or fragment', () => {
    for (const value of [
      '',
      'relay.example.com',
      'ftp://relay.example.com/',
      'https://relay.example.com/?a=1',
      42,
      null,
    ]) {
      expect(sanitizeRelayUrl(value)).toBeNull();
    }
  });
});

describe('resolveRelayBase', () => {
  const setting = 'https://mine.example.com/relay/';
  const buildDefault = 'https://official.example.com/labelflash/';

  test('prefers the address set on this computer', () => {
    expect(resolveRelayBase({ setting, buildDefault })?.href).toBe(setting);
  });

  test('falls back to the default the package was built with', () => {
    expect(resolveRelayBase({ setting: null, buildDefault })?.href).toBe(buildDefault);
  });

  test('has no address when neither is set or valid', () => {
    expect(resolveRelayBase({ setting: null, buildDefault: '' })).toBeNull();
    expect(resolveRelayBase({ setting: null, buildDefault: 'not a url' })).toBeNull();
  });
});

describe('desktopSocketUrl', () => {
  test('uses wss for https and ws for local http', () => {
    expect(desktopSocketUrl(new URL('https://relay.example.com/labelflash/'))).toBe(
      'wss://relay.example.com/labelflash/ws/desktop',
    );
    expect(desktopSocketUrl(new URL('http://localhost:3180/'))).toBe('ws://localhost:3180/ws/desktop');
  });
});
