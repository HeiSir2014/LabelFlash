import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog, Menu, session } from 'electron';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';
import { DedupGuard } from '../core/dedup-guard';
import { PrintQueue } from '../core/print-queue';
import { PrintService } from '../core/print-service';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { systemClock } from '../core/types';
import { BRAND } from '../shared/brand';
import { PRINT_TIMEOUT_MS } from '../shared/print-timing';
import { minutesToMs } from '../shared/settings';
import { registerIpc } from './ipc';
import { setupLogging } from './logging';
import { resolvePrintTemplate } from './print-template';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { PrinterStatusMonitor, queryPrinterReadiness } from './printing/printer-status';
import { openDatabase } from './storage/database';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { SqliteTemplateRepository } from './storage/sqlite-template-repository';
import { type AppTray, createTray } from './tray';
import { createMainWindow } from './window';

const DATABASE_FILE_NAME = 'labelflash.db';

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let database: DatabaseSync | null = null;
let isQuitting = false;

// 数据、日志、Chromium 缓存都放 %LOCALAPPDATA%\CDL-LabelFlash（本机目录，不进漫游配置）。
app.setPath('userData', join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), BRAND.productNameAscii));

if (app.isPackaged) {
  // 在 ready 之前去掉默认菜单：它的快捷键（刷新、开发者工具、缩放）在安装版里会破坏扫码状态和预览比例。
  Menu.setApplicationMenu(null);
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function quit(): void {
  isQuitting = true;
  app.quit();
}

function closeDatabase(): void {
  if (database?.isOpen) {
    database.close();
  }
}

function applyLaunchAtLogin(enabled: boolean): void {
  // 开发模式下注册的会是 electron.exe，所以只在安装版生效。卸载程序按同一个 name 删除启动项。
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled, name: BRAND.appId });
  }
}

function requireWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available');
  }
  return mainWindow.webContents;
}

async function bootstrap(): Promise<void> {
  const logPath = setupLogging();
  console.info(`[app] ${BRAND.productName} ${app.getVersion()} starting`);
  app.setAppUserModelId(BRAND.appId);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const dataPath = app.getPath('userData');
  database = openDatabase(join(dataPath, DATABASE_FILE_NAME));
  const settings = new SqliteSettingsStore(database);
  const jobs = new SqliteJobStore(database, settings.current.historyLimit);
  await jobs.initialize();
  const templates = new TemplateCatalog(new SqliteTemplateRepository(database, systemClock), randomUUID);
  const guard = new DedupGuard(systemClock, minutesToMs(settings.current.dedupWindowMinutes));
  const status = new PrinterStatusMonitor(queryPrinterReadiness);
  status.start();
  void status.watch(settings.current.selectedPrinter);
  const adapter = new ElectronDriverAdapter(requireWebContents, status, systemClock);
  const service = new PrintService({
    adapter,
    store: jobs,
    guard,
    clock: systemClock,
    queue: new PrintQueue(PRINT_TIMEOUT_MS),
    createId: randomUUID,
    resolveTemplate: () => resolvePrintTemplate(templates, settings.current),
  });
  service.restore();

  registerIpc({
    service,
    adapter,
    jobs,
    settings,
    templates,
    status,
    appInfo: {
      productName: BRAND.productName,
      brandOwner: BRAND.owner,
      version: app.getVersion(),
      dataPath,
      logPath,
    },
    getWindow: () => mainWindow,
    onSettingsChanged: async (next, previous) => {
      guard.setWindowMs(minutesToMs(next.dedupWindowMinutes));
      if (next.selectedPrinter !== previous.selectedPrinter) {
        void status.watch(next.selectedPrinter);
      }
      if (next.launchAtLogin !== previous.launchAtLogin) {
        applyLaunchAtLogin(next.launchAtLogin);
      }
      if (next.historyLimit !== previous.historyLimit) {
        await jobs.setCapacity(next.historyLimit);
      }
    },
  });
  applyLaunchAtLogin(settings.current.launchAtLogin);

  mainWindow = createMainWindow({
    icon: appIcon,
    shouldHideOnClose: () => !isQuitting,
    onHidden: () => tray?.notifyHiddenOnce(),
  });
  // Windows 关机、注销时不会触发 before-quit：放行窗口关闭并关闭数据库，不能阻塞关机。
  mainWindow.on('query-session-end', () => {
    isQuitting = true;
  });
  mainWindow.on('session-end', () => {
    isQuitting = true;
    closeDatabase();
  });
  tray = createTray(trayIcon, { show: showMainWindow, quit });
  app.on('will-quit', () => {
    status.stop();
    tray?.destroy();
    closeDatabase();
  });
}

function describeStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/newer than this app supports/.test(message)) {
    return '数据文件来自更新版本的程序，请安装最新版本后再打开。';
  }
  return `程序启动失败：${message}`;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('[app] startup failed', error);
      dialog.showErrorBox(
        `${BRAND.productName} 无法启动`,
        `${describeStartupError(error)}\n\n详细日志：${join(app.getPath('userData'), 'logs')}`,
      );
      app.quit();
    });
}
