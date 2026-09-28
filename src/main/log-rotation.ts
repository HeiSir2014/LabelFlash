import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, parse } from 'node:path';

/**
 * 保留的历史日志份数。默认只留一份 main.old.log，一天打几千张标签时，
 * 断续出现的打印机问题往往在排查前就被覆盖掉了。
 */
export const LOG_ARCHIVE_COUNT = 3;

/** main.log → main.1.log，已有的 main.N.log 依次后移，超出份数的最旧一份删除。 */
export function rotateLogFile(filePath: string, archiveCount: number = LOG_ARCHIVE_COUNT): void {
  const { dir, name, ext } = parse(filePath);
  const archive = (index: number) => join(dir, `${name}.${index}${ext}`);
  rmSync(archive(archiveCount), { force: true });
  for (let index = archiveCount - 1; index >= 1; index -= 1) {
    if (existsSync(archive(index))) {
      renameSync(archive(index), archive(index + 1));
    }
  }
  renameSync(filePath, archive(1));
}
