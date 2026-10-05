import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type MonoBitmap, packMono, unpackMono } from '../../core/pdf/mono-pack';

/** 缓存的编号是 UUID：从打印记录读回来的编号拼进路径之前先核对格式，挡住 ../ 这类内容。 */
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_SUFFIX = '.lfm';

export interface PieceCacheDeps {
  /** 数据目录下的 pdf-cache。 */
  dir: string;
  createKey: () => string;
  now: () => number;
}

/**
 * PDF 每一块的黑白位图（mono-pack 格式）：出块时存下，打印、从打印记录预览和重打时读回。
 * 按「最后一次用到」的时间（文件的修改时间）保留，启动时清理过期的；只碰本目录里本程序命名的文件。
 */
export class PieceCache {
  constructor(private readonly deps: PieceCacheDeps) {}

  async save(bitmap: MonoBitmap): Promise<string> {
    const key = this.deps.createKey();
    await mkdir(this.deps.dir, { recursive: true });
    await writeFile(this.pathOf(key), packMono(bitmap));
    return key;
  }

  /** 读回一块；编号不合格式、文件不在（已清理）或内容不对时返回 null。 */
  async load(key: string): Promise<MonoBitmap | null> {
    if (!KEY_PATTERN.test(key)) {
      return null;
    }
    try {
      return unpackMono(new Uint8Array(await readFile(this.pathOf(key))));
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  /** 又用到了（从打印记录预览、重打）：从现在起再留一个保留期。 */
  async touch(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) {
      return;
    }
    const at = new Date(this.deps.now());
    try {
      await utimes(this.pathOf(key), at, at);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  /** 删掉不会再打的块（换了设置、关了文件，而且没打过的）。 */
  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      if (KEY_PATTERN.test(key)) {
        await rm(this.pathOf(key), { force: true });
      }
    }
  }

  /** 删掉超过 maxAgeMs 没用过的块，返回删了几个。目录还不存在时什么也不做。 */
  async prune(maxAgeMs: number): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.deps.dir);
    } catch (error) {
      if (isMissing(error)) {
        return 0;
      }
      throw error;
    }
    const oldest = this.deps.now() - maxAgeMs;
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(FILE_SUFFIX) || !KEY_PATTERN.test(name.slice(0, -FILE_SUFFIX.length))) {
        continue;
      }
      const path = join(this.deps.dir, name);
      if ((await stat(path)).mtimeMs < oldest) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  private pathOf(key: string): string {
    return join(this.deps.dir, `${key}${FILE_SUFFIX}`);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
