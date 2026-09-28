import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readConfig } from './config';

const ENTRY_DIR = join('/app');
const ORIGIN = 'https://relay.example.com';

describe('readConfig', () => {
  test('uses the defaults for everything but the public origin', () => {
    expect(readConfig({ PUBLIC_ORIGIN: ORIGIN }, ENTRY_DIR, '1.1.0')).toEqual({
      host: '0.0.0.0',
      port: 3180,
      publicOrigin: ORIGIN,
      webRoot: join(ENTRY_DIR, 'web'),
      version: '1.1.0',
    });
  });

  test('requires the public origin', () => {
    expect(() => readConfig({}, ENTRY_DIR, 'dev')).toThrow('PUBLIC_ORIGIN');
  });

  test('reads the port and host from the environment', () => {
    const config = readConfig({ PORT: '8080', HOST: '127.0.0.1', PUBLIC_ORIGIN: ORIGIN }, ENTRY_DIR, 'dev');
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8080 });
  });

  test('names the variable when the port is invalid', () => {
    for (const port of ['0', '65536', 'abc', '80.5']) {
      expect(() => readConfig({ PORT: port, PUBLIC_ORIGIN: ORIGIN }, ENTRY_DIR, 'dev')).toThrow('PORT');
    }
  });

  test('accepts only an https origin, or http on this machine for development', () => {
    expect(() => readConfig({ PUBLIC_ORIGIN: 'http://example.com' }, ENTRY_DIR, 'dev')).toThrow('PUBLIC_ORIGIN');
    expect(() => readConfig({ PUBLIC_ORIGIN: `${ORIGIN}/labelflash` }, ENTRY_DIR, 'dev')).toThrow('PUBLIC_ORIGIN');
    expect(readConfig({ PUBLIC_ORIGIN: 'http://127.0.0.1:3180' }, ENTRY_DIR, 'dev').publicOrigin).toBe(
      'http://127.0.0.1:3180',
    );
  });
});
