import { readdirSync, rmSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { app, crashReporter, type WebContents } from 'electron';
import log from 'electron-log/main';
import {
  dailyLogFileName,
  findExpiredLogFiles,
  LOG_RETENTION_DAYS,
  LOG_ROLLS_PER_DAY,
  LOGS_DIR_NAME,
  rollOverLogFile,
} from './log-files';

const LOG_MAX_BYTES = 5 * 1024 * 1024;
/**
 * 纯文本、一行一条，UTF-8：日志是给维护人员直接打开看的，不进日志平台，所以不用 JSON。
 * 时间用 ISO 8601 并带时区偏移（例如 2026-09-28T09:05:12.345+08:00），跨时区对照、排序都不会歧义；
 * 级别补齐到同一宽度，[模块] 标签写在正文开头，方便按级别或模块 grep。
 */
const LOG_LINE_FORMAT = '{y}-{m}-{d}T{h}:{i}:{s}.{ms}{z} [{level}] {text}';

/**
 * 安装版没有控制台：主进程的 console 输出、渲染进程的警告和错误、未捕获异常都写进
 * <userData>/logs/labelflash-<本地日期>.log（命名与保留规则见 log-files.ts）。
 * 必须在设置 userData 之后、创建窗口之前调用。返回日志目录。
 */
export function setupLogging(): string {
  const logsDir = join(app.getPath('userData'), LOGS_DIR_NAME);
  let currentFileName = '';
  log.initialize();
  // 每写一条都按这条日志的时间取文件名：程序常驻托盘跨过零点时，自动写进新一天的文件。
  log.transports.file.resolvePathFn = (_variables, message) => {
    const fileName = dailyLogFileName(message?.date ?? new Date());
    if (fileName !== currentFileName) {
      const isDayChange = currentFileName !== '';
      currentFileName = fileName;
      if (isDayChange) {
        // 不在写日志的过程中做文件清理：放到下一轮事件循环，清理出错时记日志也不会重入这里。
        setImmediate(() => removeExpiredLogs(logsDir));
      }
    }
    return join(logsDir, fileName);
  };
  log.transports.file.format = LOG_LINE_FORMAT;
  log.transports.file.maxSize = LOG_MAX_BYTES;
  log.transports.file.archiveLogFn = (file) => {
    try {
      rollOverLogFile(file.toString(), LOG_ROLLS_PER_DAY);
    } catch (error) {
      // 滚动失败（例如文件被杀毒软件锁住）时清空当前文件：丢掉这一份，也不能让日志无限增长。
      console.error('[logging] could not roll over the log, clearing it instead', error);
      file.clear();
    }
  };
  log.transports.file.level = 'info';
  log.transports.console.level = app.isPackaged ? false : 'debug';
  Object.assign(console, log.functions);
  log.errorHandler.startCatching({ showDialog: false });
  crashReporter.start({ uploadToServer: false });
  removeExpiredLogs(logsDir);
  // 排查现场问题时第一件事是确认版本和系统：每次启动都记一行。
  log.info(
    `[app] electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}` +
      ` os=${process.platform} ${release()} ${process.arch} packaged=${app.isPackaged}`,
  );
  return logsDir;
}

function removeExpiredLogs(logsDir: string): void {
  let fileNames: string[];
  try {
    fileNames = readdirSync(logsDir);
  } catch {
    // 目录还不存在（第一次启动、还没写过日志）时没有东西要清理。
    return;
  }
  for (const fileName of findExpiredLogFiles(fileNames, new Date(), LOG_RETENTION_DAYS)) {
    try {
      rmSync(join(logsDir, fileName), { force: true });
    } catch (error) {
      console.warn(`[logging] could not remove expired log ${fileName}`, error);
    }
  }
}

/** 渲染进程的警告和错误也写进同一个日志文件（使用 Electron 44 的 console-message 事件对象）。 */
export function forwardRendererConsole(webContents: WebContents): void {
  webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      log.error(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    } else if (event.level === 'warning') {
      log.warn(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });
  // preload 出错时页面拿不到 window.api，界面只会表现为「程序内部错误」：原因必须进日志。
  webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error(`[preload] ${preloadPath} failed`, error);
  });
}
