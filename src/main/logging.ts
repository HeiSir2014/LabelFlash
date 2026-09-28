import { join } from 'node:path';
import { app, crashReporter, type WebContents } from 'electron';
import log from 'electron-log/main';

const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 安装版没有控制台：主进程的 console 输出和未捕获异常都写进
 * <userData>/logs/main.log（超过 5MB 自动轮转）。必须在设置 userData 之后、创建窗口之前调用。
 */
export function setupLogging(): string {
  log.initialize();
  // 默认路径因平台而异（Windows 在漫游目录）；固定到数据目录，和「打开日志目录」、启动失败提示一致。
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log');
  log.transports.file.maxSize = LOG_MAX_BYTES;
  log.transports.file.level = 'info';
  log.transports.console.level = app.isPackaged ? false : 'debug';
  Object.assign(console, log.functions);
  log.errorHandler.startCatching({ showDialog: false });
  crashReporter.start({ uploadToServer: false });
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
}
