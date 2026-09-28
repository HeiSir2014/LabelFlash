import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog, Menu } from 'electron';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';
import { DedupGuard } from '../core/dedup-guard';
import { PrintQueue } from '../core/print-queue';
import { PrintService } from '../core/print-service';
import { type EnrichDeps, enrich } from '../core/scan/enrich';
import { recognize } from '../core/scan/recognize';
import { RuleCatalog } from '../core/scan/rule-catalog';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { systemClock } from '../core/types';
import { BRAND } from '../shared/brand';
import { IpcChannel } from '../shared/ipc-contract';
import { PRINT_TIMEOUT_MS } from '../shared/print-timing';
import { secondsToMs } from '../shared/settings';
import { handleAppScheme, registerAppScheme } from './app-protocol';
import { createGpuCrashHandler, SOFTWARE_RENDERING_SWITCH } from './gpu-fallback';
import { registerIpc } from './ipc';
import { LOGS_DIR_NAME } from './log-files';
import { setupLogging } from './logging';
import { activeRules, resolvePrintTemplate } from './print-template';
import { AlertThrottle } from './printing/alert-throttle';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { createPrinterAlertNotifier } from './printing/printer-alerts';
import { PROBE_QUERY_TIMEOUT_MS, PrinterProbeHost, spawnPowerShellProbe } from './printing/printer-probe-host';
import { createReadinessProbe, PrinterStatusMonitor } from './printing/printer-status';
import { createSandboxedRegexReplacer, createSandboxedRegexRunner } from './scan/sandboxed-regex';
import { denyAllPermissions, hardenAllWebContents } from './security';
import { openDatabase } from './storage/database';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteScanRuleRepository } from './storage/sqlite-scan-rule-repository';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { SqliteTemplateRepository } from './storage/sqlite-template-repository';
import { SqliteWindowStateStore } from './storage/sqlite-window-state-store';
import { type AppTray, createTray } from './tray';
import { AppUpdater } from './updater';
import { synthesizeWithEdge } from './voice/edge-synthesizer';
import { VoiceClips } from './voice/voice-clips';
import { createMainWindow } from './window';
import { planInitialPlacement, trackWindowPlacement } from './window-placement';

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
// 上次 GPU 进程崩溃后会带着这个参数重启（见 gpu-fallback.ts），关闭硬件加速必须在 ready 之前。
const isSoftwareRendering = process.argv.includes(SOFTWARE_RENDERING_SWITCH);
if (isSoftwareRendering) {
  app.disableHardwareAcceleration();
}
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

/** 退出过程中窗口可能已经销毁，此时再推送会抛 Object has been destroyed。 */
function sendToMainWindow(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function requireWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available');
  }
  return mainWindow.webContents;
}

async function bootstrap(): Promise<void> {
  const logsDir = setupLogging();
  console.info(`[app] ${BRAND.productName} ${app.getVersion()} starting`);
  console.info(`[gpu] rendering mode: ${isSoftwareRendering ? 'software' : 'hardware'}`);
  const onGpuGone = createGpuCrashHandler({
    isSoftwareRendering,
    args: process.argv.slice(1),
    canRelaunch: () => !isQuitting,
    relaunch: (args) => app.relaunch({ args }),
    quit,
    warn: (message) => console.warn(message),
  });
  app.on('child-process-gone', (_event, details) => {
    const summary = `[process] ${details.type} process gone: ${details.reason} (exit ${details.exitCode})`;
    if (details.reason === 'clean-exit') {
      console.info(summary);
    } else {
      console.error(summary);
    }
    onGpuGone(details);
  });
  app.setAppUserModelId(BRAND.appId);
  denyAllPermissions();
  handleAppScheme(join(__dirname, '../renderer'));

  const dataPath = app.getPath('userData');
  database = openDatabase(join(dataPath, DATABASE_FILE_NAME));
  const settings = new SqliteSettingsStore(database);
  const jobs = new SqliteJobStore(database, settings.current.historyLimit);
  await jobs.initialize();
  const templates = new TemplateCatalog(new SqliteTemplateRepository(database, systemClock), randomUUID);
  const rules = new RuleCatalog(new SqliteScanRuleRepository(database, systemClock), randomUUID);
  const runRegex = createSandboxedRegexRunner();
  const enrichDeps: EnrichDeps = {
    replace: createSandboxedRegexReplacer(),
    // 查找表和 HTTP 查询分别在后续两个任务接入。
    lookup: () => null,
    http: async () => ({ ok: false, detail: 'HTTP 查询还没有接入' }),
    now: () => performance.now(),
  };
  const guard = new DedupGuard(systemClock, secondsToMs(settings.current.dedupWindowSeconds));
  // 打印机状态和驱动纸张都经这一个常驻 PowerShell 查询（只在 Windows 上有）。
  const probeHost =
    process.platform === 'win32'
      ? new PrinterProbeHost(spawnPowerShellProbe, PROBE_QUERY_TIMEOUT_MS, (message) => console.warn(message))
      : null;
  const status = new PrinterStatusMonitor(
    createReadinessProbe(probeHost),
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
    recognize: (raw) => recognize(raw, activeRules(rules, settings.current), runRegex),
    enrich: (scan) => enrich(scan, rules.get(scan.ruleId)?.steps ?? [], enrichDeps, new Date()),
    resolveTemplate: (scan) => resolvePrintTemplate(templates, settings.current, scan),
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
    onStatus: (status) => sendToMainWindow(IpcChannel.UpdateStatusChanged, status),
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
      logsDir,
    },
    updater,
    voice,
    probeHost,
    getWindow: () => mainWindow,
    onSettingsChanged: async (next, previous) => {
      guard.setWindowMs(secondsToMs(next.dedupWindowSeconds));
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

  // 未打包运行（开发、E2E）时 macOS 程序坞默认显示 Electron 图标；安装版的图标由打包配置决定。
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }
  const windowStates = new SqliteWindowStateStore(database);
  const placement = planInitialPlacement(windowStates);
  mainWindow = createMainWindow({
    icon: appIcon,
    placement,
    // 没有托盘图标时照常关闭：藏起来之后就再也叫不回窗口了。
    shouldHideOnClose: () => !isQuitting && tray !== null,
    onHidden: () => tray?.notifyHiddenOnce(),
  });
  // 必须先于下面的 session-end 处理注册：关机时先保存窗口位置，再关闭数据库。
  trackWindowPlacement(mainWindow, windowStates, placement.bounds);
  // Windows 关机、注销时不会触发 before-quit：放行窗口关闭并关闭数据库，不能阻塞关机。
  mainWindow.on('query-session-end', () => {
    isQuitting = true;
  });
  mainWindow.on('session-end', () => {
    isQuitting = true;
    closeDatabase();
  });
  try {
    tray = createTray(trayIcon, { show: showMainWindow, quit });
  } catch (error) {
    // 托盘只是附加入口：建不起来时照常运行（关窗即退出），不能让整个程序启动失败。
    console.error('[tray] could not create the tray icon, closing the window will quit', error);
  }
  updater.start();
  warmVoice();
  app.on('will-quit', () => {
    status.stop();
    probeHost?.dispose();
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
        `${describeStartupError(error)}\n\n详细日志：${join(app.getPath('userData'), LOGS_DIR_NAME)}`,
      );
      app.quit();
    });
}
