import { describe, expect, test } from 'bun:test';
import { desktopSocketUrl, resolveRelayBase } from './relay-endpoint';

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
