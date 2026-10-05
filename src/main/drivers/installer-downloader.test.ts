import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { DownloadError } from '../../core/drivers/driver-install-flow';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import type { FetchFunction } from './catalog-client';
import { createInstallerDownloader } from './installer-downloader';

const INSTALLER_URL = 'https://example.invalid/drivers/x1-setup.exe';
const BYTES = new TextEncoder().encode('MZ 示例安装包'.repeat(200));
const CHUNK_BYTES = 256;
let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempDir('driver-download-');
});

afterEach(async () => {
  await removeTempDir(tempRoot);
});

function chunked(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

/** 像真的 fetch 一样：请求被取消时，正在读的响应体报错。第一块之后就不再有数据。 */
function stalled(first: Uint8Array): FetchFunction {
  return async (_url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return new Response(body);
  };
}

function downloader(fetch: FetchFunction, idleTimeoutMs?: number) {
  return createInstallerDownloader({ fetch, tempRoot, userAgent: 'test', idleTimeoutMs });
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DownloadError) {
      return error.kind;
    }
    throw error;
  }
  throw new Error('expected the download to fail');
}

const never = new AbortController().signal;

describe('createInstallerDownloader', () => {
  test('streams the file into its own temporary folder and hashes it on the way', async () => {
    const progress: number[] = [];
    const file = await downloader(async () => new Response(chunked(BYTES))).download(
      INSTALLER_URL,
      BYTES.length,
      'driver-installer.exe',
      (received) => progress.push(received),
      never,
    );
    expect(file.sizeBytes).toBe(BYTES.length);
    expect(file.sha256).toBe(createHash('sha256').update(BYTES).digest('hex'));
    expect(new Uint8Array(await readFile(file.path))).toEqual(BYTES);
    expect(progress.at(-1)).toBe(BYTES.length);
    await downloader(async () => new Response('')).discard(file);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('stops as soon as the server announces a larger file than the catalog', async () => {
    const fetch: FetchFunction = async () =>
      new Response(BYTES, { headers: { 'Content-Length': String(BYTES.length) } });
    expect(
      await failureOf(downloader(fetch).download(INSTALLER_URL, BYTES.length - 1, 'a.exe', () => undefined, never)),
    ).toBe('too-large');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('stops when the body runs past the expected size without a length header', async () => {
    const fetch: FetchFunction = async () => new Response(chunked(BYTES));
    expect(
      await failureOf(downloader(fetch).download(INSTALLER_URL, CHUNK_BYTES, 'a.exe', () => undefined, never)),
    ).toBe('too-large');
  });

  test('refuses a download redirected to plain http', async () => {
    const fetch: FetchFunction = async () => {
      const response = new Response(BYTES);
      Object.defineProperty(response, 'url', { value: 'http://example.invalid/x1-setup.exe' });
      return response;
    };
    expect(
      await failureOf(downloader(fetch).download(INSTALLER_URL, BYTES.length, 'a.exe', () => undefined, never)),
    ).toBe('download-failed');
  });

  test('stops and cleans up when the operator cancels', async () => {
    const controller = new AbortController();
    const download = downloader(stalled(BYTES.slice(0, CHUNK_BYTES))).download(
      INSTALLER_URL,
      BYTES.length,
      'a.exe',
      () => controller.abort(),
      controller.signal,
    );
    expect(await failureOf(download)).toBe('canceled');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('gives up when no data arrives for a while', async () => {
    const download = downloader(stalled(BYTES.slice(0, CHUNK_BYTES)), 50).download(
      INSTALLER_URL,
      BYTES.length,
      'a.exe',
      () => undefined,
      never,
    );
    expect(await failureOf(download)).toBe('download-timeout');
  });

  test('refuses to delete anything outside its own temporary folders', async () => {
    const file = { path: `${tempRoot}/elsewhere/a.exe`, sizeBytes: 1, sha256: '' };
    await expect(downloader(async () => new Response('')).discard(file)).rejects.toThrow();
  });
});
