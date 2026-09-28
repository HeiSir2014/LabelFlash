import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, parse } from 'node:path';

/**
 * 日志文件命名与保留：<应用名>-<本地日期>.log，每天一个文件，按天保留。
 * - 文件名带应用名：日志被拷走、和别的程序的日志放在一起时仍能认出来。
 * - 按天分文件：排查「某天几点出的问题」直接打开那一天，不用在一个大文件里翻。
 * - 同一天超过大小上限时滚动为 <名>.1.log、.2.log…，避免单个文件过大打不开。
 */
export const LOG_FILE_PREFIX = 'labelflash';
/** 数据目录下的日志子目录。 */
export const LOGS_DIR_NAME = 'logs';
/** 保留最近这么多天（含今天）的日志。 */
export const LOG_RETENTION_DAYS = 14;
/** 同一天内因超过大小上限而滚动出的文件最多保留几份。 */
export const LOG_ROLLS_PER_DAY = 3;

const DAILY_LOG_PATTERN = new RegExp(`^${LOG_FILE_PREFIX}-(\\d{4})-(\\d{2})-(\\d{2})(?:\\.\\d+)?\\.log$`);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地日期：操作员说的「今天上午」是本地时间，日志按本地日期分文件才对得上。 */
export function dailyLogFileName(date: Date): string {
  return `${LOG_FILE_PREFIX}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
}

/** 返回超出保留天数的日志文件名；不是本应用日志命名格式的文件一律不动。 */
export function findExpiredLogFiles(fileNames: readonly string[], now: Date, retentionDays: number): string[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (retentionDays - 1));
  return fileNames.filter((fileName) => {
    const match = DAILY_LOG_PATTERN.exec(fileName);
    if (!match) {
      return false;
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const fileDate = new Date(year, month - 1, day);
    // 月、日越界时 Date 会进位（例如 13 月），说明不是真实日期，不当成本应用的文件。
    const isRealDate = fileDate.getMonth() === month - 1 && fileDate.getDate() === day;
    return isRealDate && fileDate < cutoff;
  });
}

/** 当天文件超过大小上限：<名>.log → <名>.1.log，已有的 <名>.N.log 依次后移，超出份数的最旧一份删除。 */
export function rollOverLogFile(filePath: string, rolls: number = LOG_ROLLS_PER_DAY): void {
  const { dir, name, ext } = parse(filePath);
  const rolled = (index: number) => join(dir, `${name}.${index}${ext}`);
  rmSync(rolled(rolls), { force: true });
  for (let index = rolls - 1; index >= 1; index -= 1) {
    if (existsSync(rolled(index))) {
      renameSync(rolled(index), rolled(index + 1));
    }
  }
  renameSync(filePath, rolled(1));
}
