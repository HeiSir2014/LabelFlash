/** 单张打印的超时时间：主进程的打印队列和界面文案共用。 */
export const PRINT_TIMEOUT_MS = 30_000;
export const PRINT_TIMEOUT_SECONDS = PRINT_TIMEOUT_MS / 1_000;

/** 当前打印机状态的轮询间隔：主进程后台检测和界面刷新共用。 */
export const PRINTER_STATUS_POLL_MS = 5_000;
