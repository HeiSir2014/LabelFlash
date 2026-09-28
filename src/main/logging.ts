import { release } from 'node:os';
import { join } from 'node:path';
import { app, crashReporter, type WebContents } from 'electron';
import log from 'electron-log/main';
import { LOG_ARCHIVE_COUNT, rotateLogFile } from './log-rotation';

const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 安装版没有控制台：主进程的 console 输出和未捕获异常都写进
 * <userData>/logs/main.log（超过 5MB 轮转，保留最近几份）。必须在设置 userData 之后、创建窗口之前调用。
 */
export function setupLogging(): string {
  log.initialize();
  // 默认路径因平台而异（Windows 在漫游目录）；固定到数据目录，和「打开日志目录」、启动失败提示一致。
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log');
  log.transports.file.maxSize = LOG_MAX_BYTES;
  log.transports.file.archiveLogFn = (file) => {
    try {
      rotateLogFile(file.toString(), LOG_ARCHIVE_COUNT);
    } catch (error) {
      // 轮转失败（例如文件被杀毒软件锁住）时清空当前文件：丢掉这一份，也不能让日志无限增长。
      console.error('[logging] could not rotate the log, clearing it instead', error);
      file.clear();
    }
  };
  log.transports.file.level = 'info';
  log.transports.console.level = app.isPackaged ? false : 'debug';
  Object.assign(console, log.functions);
  log.errorHandler.startCatching({ showDialog: false });
  crashReporter.start({ uploadToServer: false });
  // 排查现场问题时第一件事是确认版本和系统：每次启动都记一行。
  log.info(
    `[app] electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}` +
      ` os=${process.platform} ${release()} ${process.arch} packaged=${app.isPackaged}`,
  );
  return log.transports.file.getFile().path;
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
