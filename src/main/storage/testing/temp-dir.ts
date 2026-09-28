import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REMOVE_ATTEMPTS = 20;
const REMOVE_RETRY_DELAY_MS = 25;

export function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * 只供测试使用，产品代码不得引用：生产环境运行的是 Electron 自带的 node:sqlite，没有这个问题。
 *
 * 删除测试用的临时目录。Bun on Windows 的 node:sqlite 在 close() 后不释放预编译过语句的数据库文件，
 * 删除目录会 EBUSY（https://github.com/oven-sh/bun/issues/40001）。强制 GC 能回收这些语句，
 * 但 GC 是保守式的，一次不一定回收干净，所以回收后重试几次。
 */
export async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    Bun.gc(true);
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt >= REMOVE_ATTEMPTS) {
        throw error;
      }
      await Bun.sleep(REMOVE_RETRY_DELAY_MS);
    }
  }
}
