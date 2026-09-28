import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND } from '../../src/shared/brand';
import { buildRelay } from './build';

let outDir: string;
let assets: string[];
let html: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'relay-build-'));
  await buildRelay({ outDir, version: '9.9.9-test' });
  assets = await readdir(join(outDir, 'web', 'assets'));
  html = await readFile(join(outDir, 'web', 'index.html'), 'utf8');
}, 60_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe('buildRelay', () => {
  test('emits the server bundle with its version', async () => {
    const server = await readFile(join(outDir, 'server.js'), 'utf8');
    expect(server).toContain('9.9.9-test');
  });

  test('emits content-hashed page assets', () => {
    for (const pattern of [/^main-\w+\.js$/, /^decode-worker-\w+\.js$/, /^reader-\w+\.wasm$/, /^styles-\w+\.css$/]) {
      expect(assets.some((name) => pattern.test(name))).toBe(true);
    }
  });

  test('points the page at the hashed files that exist', () => {
    const references = [...html.matchAll(/(?:href|src)="assets\/([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(references).toHaveLength(2);
    for (const reference of references) {
      expect(assets).toContain(reference);
    }
  });

  test('names the product from the brand and has no inline script', () => {
    expect(html).toContain(BRAND.productName);
    expect(html).not.toContain('{{');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  test('loads the decoder from the relay itself', async () => {
    // zxing-wasm 自带的默认下载地址是国外 CDN；worker 用 locateFile 改指本站，CSP 的 connect-src 也只允许本站。
    const worker = assets.find((name) => name.startsWith('decode-worker-')) ?? '';
    const wasm = assets.find((name) => name.endsWith('.wasm')) ?? '';
    expect(await readFile(join(outDir, 'web', 'assets', worker), 'utf8')).toContain(`"${wasm}"`);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
