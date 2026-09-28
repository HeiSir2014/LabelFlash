import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveStatic } from './static-files';

const ORIGIN = 'https://relay.example.com';
let root: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-static-'));
  root = join(base, 'web');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>扫码</title>');
  await writeFile(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'assets', 'reader-def456.wasm'), new Uint8Array([0, 97, 115, 109]));
  await writeFile(join(base, 'server.js'), 'secret');
});

afterAll(async () => {
  await rm(join(root, '..'), { recursive: true, force: true });
});

describe('serveStatic', () => {
  test('serves the page with strict security headers and no caching', async () => {
    const response = await serveStatic(root, '/m/', ORIGIN);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('扫码');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' wss://relay.example.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('permissions-policy')).toBe('camera=(self), microphone=(), geolocation=()');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('uses ws:// for a local development origin', async () => {
    const response = await serveStatic(root, '/m/', 'http://localhost:3180');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self' ws://localhost:3180");
  });

  test('caches hashed assets for good', async () => {
    const script = await serveStatic(root, '/m/assets/app-abc123.js', ORIGIN);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const wasm = await serveStatic(root, '/m/assets/reader-def456.wasm', ORIGIN);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
  });

  test('never leaves the web root', async () => {
    for (const pathname of [
      '/m/../server.js',
      '/m/%2e%2e/server.js',
      '/m/assets/..%2f..%2fserver.js',
      '/m//etc/passwd',
      '/m/%00',
      '/m/index.html%00.js',
      '/m/assets/%0a.js',
    ]) {
      expect((await serveStatic(root, pathname, ORIGIN)).status).toBe(404);
    }
  });

  test('answers 404 for missing files and unknown types', async () => {
    expect((await serveStatic(root, '/m/assets/missing.js', ORIGIN)).status).toBe(404);
    expect((await serveStatic(root, '/m/index.php', ORIGIN)).status).toBe(404);
    expect((await serveStatic(root, '/other', ORIGIN)).status).toBe(404);
  });
});
