import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BRAND } from '../../src/shared/brand';
import { MAX_REQUEST_RAW_LENGTH } from '../../src/shared/mobile-protocol';
import { assertSafeOutDir, buildRelay } from './build';

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

  test('limits the manual input to what a request may carry', () => {
    expect(html).toContain(`maxlength="${MAX_REQUEST_RAW_LENGTH}"`);
  });

  test('loads the decoder from the relay itself', async () => {
    // zxing-wasm 自带的默认下载地址是国外 CDN；worker 用 locateFile 改指本站，CSP 的 connect-src 也只允许本站。
    const worker = assets.find((name) => name.startsWith('decode-worker-')) ?? '';
    const wasm = assets.find((name) => name.endsWith('.wasm')) ?? '';
    expect(await readFile(join(outDir, 'web', 'assets', worker), 'utf8')).toContain(`"${wasm}"`);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('assertSafeOutDir', () => {
  const root = resolve(import.meta.dir, '../..');

  test('allows the default output directory and a previous build', async () => {
    await expect(assertSafeOutDir(join(root, 'relay', 'dist'))).resolves.toBeUndefined();
    await expect(assertSafeOutDir(outDir)).resolves.toBeUndefined();
  });

  test('refuses source directories, the repository and its parents', async () => {
    await expect(assertSafeOutDir(join(root, 'src'))).rejects.toThrow('relay/dist');
    await expect(assertSafeOutDir(root)).rejects.toThrow();
    await expect(assertSafeOutDir(resolve(root, '..'))).rejects.toThrow();
  });

  test('refuses a directory outside the repository that holds something else', async () => {
    const other = await mkdtemp(join(tmpdir(), 'relay-other-'));
    try {
      await writeFile(join(other, 'notes.txt'), 'keep me');
      await expect(assertSafeOutDir(other)).rejects.toThrow('不会清空');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
