import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog, Menu } from 'electron';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';
import { DedupGuard } from '../core/dedup-guard';
import { PrintQueue } from '../core/print-queue';
import { PrintService } from '../core/print-service';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { systemClock } from '../core/types';
import { BRAND } from '../shared/brand';
import { IpcChannel } from '../shared/ipc-contract';
import { PRINT_TIMEOUT_MS } from '../shared/print-timing';
import { minutesToMs } from '../shared/settings';
import { handleAppScheme, registerAppScheme } from './app-protocol';
import { registerIpc } from './ipc';
import { setupLogging } from './logging';
import { resolvePrintTemplate } from './print-template';
import { AlertThrottle } from './printing/alert-throttle';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { createPrinterAlertNotifier } from './printing/printer-alerts';
import { PrinterStatusMonitor, queryPrinterReadiness } from './printing/printer-status';
import { denyAllPermissions, hardenAllWebContents } from './security';
import { openDatabase } from './storage/database';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { SqliteTemplateRepository } from './storage/sqlite-template-repository';
import { type AppTray, createTray } from './tray';
import { AppUpdater } from './updater';
import { synthesizeWithEdge } from './voice/edge-synthesizer';
import { VoiceClips } from './voice/voice-clips';
import { createMainWindow } from './window';

const DATABASE_FILE_NAME = 'labelflash.db';
const VOICE_CACHE_DIR_NAME = 'voice-cache';

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let database: DatabaseSync | null = null;
let isQuitting = false;

/** 仅开发 / E2E 测试可用：把数据目录指到临时目录，测试之间互不干扰。安装版忽略它。 */
const USER_DATA_OVERRIDE_ENV = 'CDL_LABELFLASH_USER_DATA';

// 数据、日志、Chromium 缓存都放 %LOCALAPPDATA%\CDL-LabelFlash（本机目录，不进漫游配置）。
const userDataOverride = app.isPackaged ? undefined : process.env[USER_DATA_OVERRIDE_ENV];
app.setPath(
  'userData',
  userDataOverride ?? join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), BRAND.productNameAscii),
);

// 以下都必须在 app ready 之前完成。
registerAppScheme();
// 所有渲染进程（主窗口、打印窗口）一律进沙箱。
app.enableSandbox();
hardenAllWebContents();
if (app.isPackaged) {
  // 去掉默认菜单：它的快捷键（刷新、开发者工具、缩放）在安装版里会破坏扫码状态和预览比例。
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
  denyAllPermissions();
  handleAppScheme(join(__dirname, '../renderer'));

  const dataPath = app.getPath('userData');
  database = openDatabase(join(dataPath, DATABASE_FILE_NAME));
  const settings = new SqliteSettingsStore(database);
  const jobs = new SqliteJobStore(database, settings.current.historyLimit);
  await jobs.initialize();
  const templates = new TemplateCatalog(new SqliteTemplateRepository(database, systemClock), randomUUID);
  const guard = new DedupGuard(systemClock, minutesToMs(settings.current.dedupWindowMinutes));
  const status = new PrinterStatusMonitor(
    queryPrinterReadiness,
    createPrinterAlertNotifier(new AlertThrottle(systemClock), showMainWindow),
  );
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
  const voice = new VoiceClips(join(dataPath, VOICE_CACHE_DIR_NAME), synthesizeWithEdge);
  // 后台预热全部播报语：之后扫码时直接播缓存，不等在线合成。
  const warmVoice = () => {
    const { enabled, name, ratePercent } = settings.current.voice;
    if (enabled) {
      void voice.warm({ voice: name, ratePercent });
    }
  };
  const updater = new AppUpdater({
    onStatus: (status) => mainWindow?.webContents.send(IpcChannel.UpdateStatusChanged, status),
    onBeforeInstall: () => {
      isQuitting = true;
    },
  });

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
    updater,
    voice,
    getWindow: () => mainWindow,
    onSettingsChanged: async (next, previous) => {
      guard.setWindowMs(minutesToMs(next.dedupWindowMinutes));
      if (next.selectedPrinter !== previous.selectedPrinter) {
        void status.watch(next.selectedPrinter);
      }
      if (next.launchAtLogin !== previous.launchAtLogin) {
        applyLaunchAtLogin(next.launchAtLogin);
      }
      if (JSON.stringify(next.voice) !== JSON.stringify(previous.voice)) {
        warmVoice();
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
  updater.start();
  warmVoice();
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
