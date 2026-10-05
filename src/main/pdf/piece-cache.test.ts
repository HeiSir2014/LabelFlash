import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { PDF_PIECE_RETENTION_MS } from '../../core/pdf/pdf-model';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { PieceCache } from './piece-cache';

const BITMAP: MonoBitmap = { width: 3, height: 2, bits: Uint8Array.of(1, 0, 1, 0, 1, 0) };
const NOW = 1_800_000_000_000;
const KEYS = ['0f8fad5b-d9cb-469f-a165-70867728950e', '7c9e6679-7425-40de-944b-e07fc1f90ae7'];

let dir: string;

beforeEach(async () => {
  dir = await createTempDir('piece-cache-');
});

afterEach(async () => {
  await removeTempDir(dir);
});

function cacheDir(): string {
  return join(dir, 'pdf-cache');
}

function createCache(): PieceCache {
  const keys = [...KEYS];
  return new PieceCache({ dir: cacheDir(), createKey: () => keys.shift() ?? 'no-more-keys', now: () => NOW });
}

/** 把文件的修改时间设到某个时刻（毫秒）。 */
async function setAge(key: string, at: number): Promise<void> {
  await utimes(join(cacheDir(), `${key}.lfm`), new Date(at), new Date(at));
}

describe('PieceCache', () => {
  test('saves a bitmap under a new key and reads it back', async () => {
    const cache = createCache();
    const key = await cache.save(BITMAP);
    expect(key).toBe(KEYS[0] ?? '');
    expect(await cache.load(key)).toEqual(BITMAP);
  });

  test('returns null for a missing piece or a key that is not ours', async () => {
    const cache = createCache();
    expect(await cache.load(KEYS[1] ?? '')).toBeNull();
    expect(await cache.load('../labelflash.db')).toBeNull();
  });

  test('removes pieces that will not be printed', async () => {
    const cache = createCache();
    const key = await cache.save(BITMAP);
    await cache.remove([key, '../labelflash.db']);
    expect(await cache.load(key)).toBeNull();
  });

  test('prunes pieces not used for a week and leaves other files alone', async () => {
    const cache = createCache();
    const old = await cache.save(BITMAP);
    const fresh = await cache.save(BITMAP);
    await setAge(old, NOW - PDF_PIECE_RETENTION_MS - 1);
    await setAge(fresh, NOW);
    await writeFile(join(cacheDir(), 'notes.txt'), 'keep');
    expect(await cache.prune(PDF_PIECE_RETENTION_MS)).toBe(1);
    expect((await readdir(cacheDir())).sort()).toEqual([`${fresh}.lfm`, 'notes.txt'].sort());
  });

  test('touching a piece keeps it for another week', async () => {
    const cache = createCache();
    const key = await cache.save(BITMAP);
    await setAge(key, NOW - PDF_PIECE_RETENTION_MS - 1);
    await cache.touch(key);
    expect((await stat(join(cacheDir(), `${key}.lfm`))).mtimeMs).toBe(NOW);
    expect(await cache.prune(PDF_PIECE_RETENTION_MS)).toBe(0);
  });

  test('prunes nothing when the folder does not exist yet', async () => {
    expect(await createCache().prune(PDF_PIECE_RETENTION_MS)).toBe(0);
  });
});
