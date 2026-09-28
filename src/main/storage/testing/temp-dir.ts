import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REMOVE_ATTEMPTS = 20;
const REMOVE_RETRY_DELAY_MS = 25;

export function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * 删除测试用的临时目录。Bun 的 node:sqlite 在 close() 后，未回收的预编译语句仍占着数据库文件，
 * Windows 上会 EBUSY；而 GC 是保守式的，一次回收不一定释放，所以回收后重试几次。
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
