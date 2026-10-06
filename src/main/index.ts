import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  app,
  type BrowserWindow,
  dialog,
  Menu,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  shell,
  utilityProcess,
} from 'electron';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';
import { batchIdFor } from '../core/batch/batch-model';
import { DedupGuard } from '../core/dedup-guard';
import { SubmittedJobs } from '../core/diagnosis/submitted-jobs';
import type { DriverPlatform } from '../core/drivers/install-plan';
import { PDF_PIECE_RETENTION_MS } from '../core/pdf/pdf-model';
import { PrintQueue } from '../core/print-queue';
import { BATCH_RULE, fieldsScan, PDF_RULE, PrintService } from '../core/print-service';
import { effectiveCommandSet } from '../core/printer-commands/command-set';
import { type PrinterChoice, resolvePrinter, responsiblePaper } from '../core/printing/resolve-printer';
import { type EnrichDeps, enrich } from '../core/scan/enrich';
import { recognize } from '../core/scan/recognize';
import { RuleCatalog } from '../core/scan/rule-catalog';
import { GENERIC_TEMPLATE } from '../core/templates/builtin-templates';
import { TemplateCatalog } from '../core/templates/template-catalog';
import { type LabelTemplate, withPaper } from '../core/templates/template-model';
import { type PrinterInfo, systemClock } from '../core/types';
import { BRAND } from '../shared/brand';
import { DRIVER_CATALOG_PUBLIC_KEYS } from '../shared/driver-catalog-keys';
import { IpcChannel } from '../shared/ipc-contract';
import { PRINT_TIMEOUT_MS } from '../shared/print-timing';
import { notSentText, rawSendFailureText } from '../shared/printer-commands';
import { phonePrinterLabel } from '../shared/printer-summary';
import type { SocketLike } from '../shared/relay-socket';
import { secondsToMs } from '../shared/settings';
import { apiPrinters } from './api/api-printers';
import { apiCandidatePorts, LocalApi } from './api/local-api';
import { lanIPv4Addresses, lanIPv4Interfaces } from './api/network';
import { renderLabelPdf } from './api/pdf-render';
import { findPortOwner } from './api/port-owner';
import { handleAppScheme, registerAppScheme } from './app-protocol';
import { BACKGROUND_UPDATE_CHECK_MS, canUpdateInBackground } from './background-update';
import { canceledJobRecords, quitStep, shouldConfirmBatchQuit, waitForBatchIdle } from './batch/batch-quit';
import { BatchStation } from './batch/batch-station';
import batchReaderPath from './batch/reader-worker?modulePath';
import { TableReaderHost } from './batch/table-reader-host';
import { BUILD_NUMBER } from './build-info';
import { createDiagnosisSystem } from './diagnosis/create-diagnosis-system';
import { DiagnosisStation } from './diagnosis/diagnosis-station';
import { diagnosisPlatformOf } from './diagnosis/diagnosis-system';
import { FakeDiagnosis, FakeLabelCommands } from './diagnosis/fake-diagnosis';
import type { LabelCommandsSeam } from './diagnosis/seams';
import { BUILD_DEFAULT_DRIVER_CATALOG_URL } from './drivers/build-defaults';
import { CatalogClient } from './drivers/catalog-client';
import { trustedKeys } from './drivers/catalog-signature';
import { SqliteCatalogStateStore } from './drivers/catalog-state-store';
import { createDriverReinstallSeam } from './drivers/diagnosis-seam';
import { systemDriverPorts } from './drivers/driver-ports';
import { DriverStation } from './drivers/driver-station';
import { FakeDrivers, parseFakeDrivers, testCatalogKey } from './drivers/fake-drivers';
import { cleanupOldDownloads, createInstallerDownloader } from './drivers/installer-downloader';
import { addFirewallRule, discoveryFirewallStatus, firewallStatus } from './firewall';
import { createGpuCrashHandler, PendingRelaunch, SOFTWARE_RENDERING_SWITCH } from './gpu-fallback';
import { registerIpc } from './ipc';
import type { PendingClient } from './ipp/client-approvals';
import { IPP_STOP_ON_QUIT_TIMEOUT_MS, ippQuitDialogText, settleWithin } from './ipp/ipp-quit';
import { IppSharing, ippBindHost, ippCandidatePorts, isDiscoveryEnabled } from './ipp/ipp-sharing';
import { LOGS_DIR_NAME } from './log-files';
import { setupLogging } from './logging';
import { LookupTables } from './lookup/lookup-tables';
import { BUILD_DEFAULT_RELAY_URL } from './mobile/build-defaults';
import { phoneImageRequest } from './mobile/image-request';
import { MobileHost } from './mobile/mobile-host';
import { MOBILE_TICK_INTERVAL_MS, MobileStation } from './mobile/mobile-station';
import { WebhookOutbox } from './notify/webhook-outbox';
import { createWebhookSender } from './notify/webhook-sender';
import { fakeImageTextSource, parseFakeOcr } from './ocr/fake-ocr';
import { ImageTextReader, type ImageTextSource } from './ocr/image-text-reader';
import { createOcrEngine } from './ocr/ocr-engine';
import { missingOcrFiles, ocrFiles } from './ocr/ocr-files';
import { OCR_SAMPLES_DIR_NAME, OCR_SAMPLES_KEPT, OcrSamples } from './ocr/ocr-samples';
import { canceledPdfJobRecords, quitDialogText } from './pdf/pdf-quit';
import { PdfRenderHost } from './pdf/pdf-render-host';
import { openRenderWindow } from './pdf/pdf-render-window';
import { PdfStation } from './pdf/pdf-station';
import { PieceCache } from './pdf/piece-cache';
import { activeRules, resolvePrintTemplate } from './print-template';
import { AlertThrottle } from './printing/alert-throttle';
import { openPrinterPreferences, queryDriverPaper } from './printing/driver-paper';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { FakeDriverAdapter, FakePrinters, parseFakePrinters } from './printing/fake-printers';
import { renderLabelHtml } from './printing/label-html';
import { createPrinterAlertNotifier } from './printing/printer-alerts';
import { PrinterCommands } from './printing/printer-commands-station';
import type { PrinterDriver } from './printing/printer-driver';
import { queryDriverName } from './printing/printer-identity';
import { PROBE_QUERY_TIMEOUT_MS, PrinterProbeHost, spawnPowerShellProbe } from './printing/printer-probe-host';
import { PrinterProfiles } from './printing/printer-profiles';
import { createReadinessProbe, type PrinterReadiness, PrinterStatusMonitor } from './printing/printer-status';
import { DEFAULT_PRINTER_DPI } from './printing/qr-code';
import { createRawSender } from './printing/raw-sender';
import { RelaunchIntents, UPDATED_ARG } from './relaunch-intent';
import { createHttpStepRunner } from './scan/http-step';
import { RuleService } from './scan/rule-service';
import { createSandboxedRegexReplacer, createSandboxedRegexRunner } from './scan/sandboxed-regex';
import { safeStorageCipher } from './secrets/safe-storage-cipher';
import { denyAllPermissions, hardenAllWebContents } from './security';
import { openDatabase } from './storage/database';
import { SqliteIppStore } from './storage/sqlite-ipp-store';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteLookupStore } from './storage/sqlite-lookup-store';
import { SqliteScanRuleRepository } from './storage/sqlite-scan-rule-repository';
import { SqliteSecretStore } from './storage/sqlite-secret-store';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { SqliteTemplateRepository } from './storage/sqlite-template-repository';
import { SqliteWebhookStore } from './storage/sqlite-webhook-store';
import { SqliteWindowStateStore } from './storage/sqlite-window-state-store';
import {
  SAVE_FOR_QUIT_TIMEOUT_MS,
  TEMPLATE_QUIT_BUTTONS,
  TemplateQuitGuard,
  templateQuitChoice,
  templateQuitDialogText,
  templateSaveFailedText,
  UNSAVED_TEMPLATE_FALLBACK_NAME,
} from './template-quit';
import { type AppTray, createTray } from './tray';
import { AppUpdater } from './updater';
import { synthesizeWithEdge } from './voice/edge-synthesizer';
import { VoiceClips } from './voice/voice-clips';
import { createMainWindow } from './window';
import { bringToFront } from './window-activation';
import { planInitialPlacement, trackWindowPlacement } from './window-placement';

/** 本地 OCR 的线程数和识别批大小（OCR 引擎设计第 8 节的默认值）。 */
const OCR_INTRA_THREADS = 4;
const OCR_RECOGNITION_BATCH_SIZE = 8;
const DATABASE_FILE_NAME = 'labelflash.db';
const VOICE_CACHE_DIR_NAME = 'voice-cache';
/** 读一个表格最多等这么久：20MB 的 .xlsx 在普通办公电脑上几秒读完，30 秒还没完多半是压缩炸弹或坏文件。 */
const TABLE_READ_TIMEOUT_MS = 30_000;
/** 读表格子进程的堆上限：一万行的表格解开后几十 MB；超过 512MB 只可能是压缩炸弹，V8 结束进程，按「读不出」处理。 */
const TABLE_READER_HEAP_MB = 512;
/** 任务管理器、进程列表里显示的子进程名。 */
const TABLE_READER_SERVICE_NAME = `${BRAND.productNameAscii} table reader`;
/** 退出确认之后，取消批次时最多等正在打的那一张结束多久：打印机正常的话一张几秒钟就打完，
 *  等这么久还没结束多半是驱动卡住了，不能让退出程序跟着一起卡住。 */
const BATCH_CANCEL_SETTLE_TIMEOUT_MS = 5_000;
/** PDF 每一块的黑白位图缓存（数据目录下）：打印记录的预览、重打用，保留 7 天。 */
const PDF_CACHE_DIR_NAME = 'pdf-cache';
/** 打开一个 PDF（读出页数和每页大小、建渲染页）最多等 20 秒：200 页的 PDF 在普通电脑上几秒内打开，更久多半是坏文件。 */
const PDF_OPEN_TIMEOUT_MS = 20_000;
/** 渲染一页最多等 30 秒：最复杂的矢量页在 1600 万像素上也只要几秒。 */
const PDF_PAGE_TIMEOUT_MS = 30_000;
/** 共享打印机的型号（printer-make-and-model、DNS-SD 的 ty）：对方的「打印机」列表里显示它。 */
const IPP_MAKE_AND_MODEL = `${BRAND.productName} 共享热敏标签机`;

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let database: DatabaseSync | null = null;
let isQuitting = false;
// 操作系统正在关机、注销（而不是操作员自己退出程序）：批量打印还有没打的也不弹确认，不能挡着关机。
// Windows 走 session-end（before-quit 根本不会触发，见下面的处理），这里主要是给 macOS/Linux 用。
let isSystemShutdown = false;
// GPU 进程崩溃后排着的「用软件渲染重启」：退出确定要发生时才交给 app.relaunch（见 gpu-fallback.ts）。
const pendingRelaunch = new PendingRelaunch();

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

/** 托盘、双击桌面快捷方式（second-instance）、点系统通知：窗口到最前并拿到焦点（前台锁见 window-activation.ts）。 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  bringToFront(mainWindow, process.platform);
}

/**
 * 托盘菜单「退出」：只触发 app.quit()，isQuitting 由 before-quit 的处理器在退出真的要发生时才设置
 * ——批量打印还有没打的会先弹确认，选了「取消」的话退出不会真的发生，这时不能已经把 isQuitting
 * 设成了 true（会导致关窗口不再藏进托盘，退出明明被取消了，托盘行为却已经坏掉）。
 */
function quit(): void {
  app.quit();
}

/**
 * 有网站在等授权：发一条系统通知，点通知回到主窗口。「允许 / 拒绝」在程序里用鼠标点，
 * 不弹模态对话框：它会抢焦点，扫码枪敲的 Tab、回车可能正好点中「允许」。
 */
function notifyOriginRequest(origin: string): void {
  if (!Notification.isSupported()) {
    return;
  }
  const notification = new Notification({
    title: '网站想使用打印服务',
    body: `${origin}。请在程序顶部点「允许」或「拒绝」。`,
  });
  notification.on('click', showMainWindow);
  notification.show();
}

/**
 * 局域网里一台新电脑要打印：发系统通知，点通知回到主窗口。「允许 / 拒绝」在程序顶部用鼠标点，
 * 不弹模态框（理由同 notifyOriginRequest）。
 */
function notifyIppClientRequest(client: PendingClient): void {
  if (!Notification.isSupported()) {
    return;
  }
  // 用户名是对方自己报的（谁都能冒充）：标明「自称」，让操作员按地址认电脑。
  const user = client.user === '' ? '' : `（自称用户 ${client.user}）`;
  const notification = new Notification({
    title: '局域网里的电脑想用共享打印机',
    body: `${client.address}${user} 要打印到「${client.printerName}」。请在程序顶部点「允许」或「拒绝」。`,
  });
  notification.on('click', showMainWindow);
  notification.show();
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
  console.info(`[app] ${BRAND.productName} ${app.getVersion()} (build ${BUILD_NUMBER ?? 'local'}) starting`);
  console.info(`[gpu] rendering mode: ${isSoftwareRendering ? 'software' : 'hardware'}`);
  const onGpuGone = createGpuCrashHandler({
    isSoftwareRendering,
    args: process.argv.slice(1),
    canRelaunch: () => !isQuitting,
    relaunch: (args) => pendingRelaunch.request(args),
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
  // 更新后重启的新版本窗口去哪（旧版本装更新前写下）：每次启动都读掉，过期的不会留到下次。
  const relaunch = new RelaunchIntents(dataPath, () => Date.now());
  const relaunchWindow = relaunch.consume();
  database = openDatabase(join(dataPath, DATABASE_FILE_NAME));
  const settings = new SqliteSettingsStore(database);
  const jobs = new SqliteJobStore(database, settings.current.historyLimit);
  await jobs.initialize();
  const templates = new TemplateCatalog(new SqliteTemplateRepository(database, systemClock), randomUUID);
  const rules = new RuleCatalog(new SqliteScanRuleRepository(database, systemClock), randomUUID);
  const runRegex = createSandboxedRegexRunner();
  const lookupTables = new LookupTables(new SqliteLookupStore(database, systemClock), randomUUID);
  const secrets = new SqliteSecretStore(database, safeStorageCipher, systemClock);
  const userAgent = `CDL-LabelFlash/${app.getVersion()}`;
  // 标签图上的字（加工步骤「图中文字识别」）：本地 OCR 引擎，第一次用到时加载；E2E 用假的。
  const fakeOcr = parseFakeOcr(process.env, app.isPackaged);
  // 模型档位（极速 / 精准）是设置项，可以随时换：每次都按当前档位找文件。
  const currentOcrFiles = () =>
    ocrFiles({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
      tier: settings.current.ocrModelTier,
    });
  const reportMissingOcr = (): void => {
    const missing = missingOcrFiles(currentOcrFiles());
    if (fakeOcr === null && missing.length > 0) {
      console.info(`[ocr] text recognition is not available here, missing: ${missing.join(', ')}`);
    }
  };
  reportMissingOcr();
  const ocrSamples = new OcrSamples(join(dataPath, OCR_SAMPLES_DIR_NAME), OCR_SAMPLES_KEPT, () => Date.now());
  const imageText: ImageTextSource = fakeOcr
    ? fakeImageTextSource(fakeOcr)
    : new ImageTextReader({
        hasFiles: () => missingOcrFiles(currentOcrFiles()).length === 0,
        createEngine: () => {
          const files = currentOcrFiles();
          console.info(`[ocr] loading the ${settings.current.ocrModelTier} models: ${files.recognitionModel}`);
          return createOcrEngine(files.addon, {
            detModelPath: files.detectionModel,
            recModelPath: files.recognitionModel,
            dictionaryPath: files.dictionary,
            intraThreads: OCR_INTRA_THREADS,
            recognitionBatchSize: OCR_RECOGNITION_BATCH_SIZE,
          });
        },
        decodeJpeg: (jpeg) => {
          const image = nativeImage.createFromBuffer(Buffer.from(jpeg));
          if (image.isEmpty()) {
            return null;
          }
          const { width, height } = image.getSize();
          return { data: image.toBitmap(), width, height };
        },
        // 引擎加载失败：告诉在线的手机别再截图。
        onUnavailable: () => mobile.rulesChanged(),
        now: () => performance.now(),
        log: (line) => console.warn(line),
        record: (image, regions) => ocrSamples.save(image, regions),
      });
  // 这台电脑能不能识别标签上的字：不能时不向手机要图，这一步跳过。
  const canReadImages = (): boolean => imageText.canRead();
  const enrichDeps: EnrichDeps = {
    replace: createSandboxedRegexReplacer(),
    lookup: (tableId, keyColumn, key, ignoreCase) => lookupTables.find(tableId, keyColumn, key, ignoreCase),
    http: createHttpStepRunner({
      fetch: (url, init) => net.fetch(url, init),
      secret: (name) => secrets.get(name),
      now: () => systemClock.now(),
      userAgent,
    }),
    match: runRegex,
    readImageText: (image) => imageText.read(image),
    now: () => performance.now(),
  };
  const guard = new DedupGuard(systemClock, secondsToMs(settings.current.dedupWindowSeconds));
  // 仅开发 / E2E：用假打印机代替系统打印机（见 printing/fake-printers.ts），安装版不读这个变量。
  const fakeSpecs = parseFakePrinters(process.env, app.isPackaged);
  const fakePrinters = fakeSpecs ? new FakePrinters(fakeSpecs) : null;
  if (fakeSpecs && fakePrinters) {
    console.info(`[print] using ${fakeSpecs.length} fake printers`);
    (globalThis as { e2eFakePrinters?: FakePrinters }).e2eFakePrinters = fakePrinters;
  }
  // 打印机状态和驱动纸张都经这一个常驻 PowerShell 查询（只在 Windows 上有）。
  const probeHost =
    process.platform === 'win32' && fakePrinters === null
      ? new PrinterProbeHost(spawnPowerShellProbe, PROBE_QUERY_TIMEOUT_MS, (message) => console.warn(message))
      : null;
  /**
   * 诊断的查询（USB、队列、驱动纸张选项）单独开一个常驻探测进程，不跟打印共用 `probeHost`：
   * 诊断查的东西比打印状态慢得多（枚举整条 USB 总线、读驱动的全部纸张选项、列队列），
   * 超时或出错时只重启这一个进程，不会连累正在排队的 RAW 发送和打印机状态轮询。
   */
  const diagnosisProbeHost =
    process.platform === 'win32' && fakePrinters === null
      ? new PrinterProbeHost(spawnPowerShellProbe, PROBE_QUERY_TIMEOUT_MS, (message) => console.warn(message))
      : null;
  /**
   * 系统里有没有这台打印机。读打印机列表要用主窗口，启动时窗口还没建好会抛错：这时按「没有」处理，
   * 下一轮状态检测（窗口建好之后）再查。
   */
  const isInstalled = async (name: string): Promise<boolean> => {
    // 窗口还没建好时直接按「没有」：不去碰适配器（否则共享的打印机列表查询会以失败收场），窗口建好后会再检测。
    if (fakePrinters === null && (!mainWindow || mainWindow.isDestroyed())) {
      return false;
    }
    try {
      return await adapter.hasPrinter(name);
    } catch (error) {
      console.warn(`[print] cannot check whether printer ${name} is installed`, error);
      return false;
    }
  };
  // 本程序交给打印队列的任务（只在内存里）：诊断「队列里有卡住的任务」时据此认出哪些是本程序发的。
  const submittedJobs = new SubmittedJobs(systemClock);
  const profiles = new PrinterProfiles(
    (name) => (fakePrinters ? fakePrinters.driverPaper(name) : queryDriverPaper(name, probeHost)),
    systemClock,
  );
  const adapter: PrinterDriver = fakePrinters
    ? new FakeDriverAdapter(fakePrinters)
    : new ElectronDriverAdapter(
        requireWebContents,
        (name): PrinterReadiness | null => status.get(name),
        systemClock,
        profiles,
        submittedJobs,
      );
  const probeReadiness = fakePrinters
    ? (name: string) => fakePrinters.readiness(name)
    : createReadinessProbe(probeHost);
  const status = new PrinterStatusMonitor(
    // 打印机名来自设置和模板：交给探测进程之前先核对系统里有这台打印机。
    async (name): Promise<PrinterReadiness | null> => ((await isInstalled(name)) ? probeReadiness(name) : null),
    createPrinterAlertNotifier(new AlertThrottle(systemClock), showMainWindow),
  );
  // 打印机的驱动名（Windows 的 DriverName、macOS 的 printer-make-and-model）：5a「自动」猜指令集、
  // 5c 的在线清单都按它查型号。假打印机直接给，真机经驻留探测进程查。
  const driverNameOf = (name: string): Promise<string | null> =>
    fakePrinters ? fakePrinters.driverName(name) : queryDriverName(name, probeHost);
  // 标签机指令：只发给系统打印机列表里有的打印机；设置存在设置表的 printerCommands 里。
  // Windows 经常驻探测进程（winspool RAW），macOS 用 lp -o raw；E2E 用假打印机记下来。
  const printerCommands = new PrinterCommands({
    configs: () => settings.current.printerCommands,
    // 只改这一项：不影响别的设置，不需要走 onSettingsChanged。
    saveConfigs: (next) => {
      settings.update({ printerCommands: next });
    },
    driverNameOf,
    driverDpi: async (name) => (await profiles.get(name))?.dpi ?? null,
    // 取值函数：清单下载完、装好驱动之后才会有内容，不能在构造时取一次就定住，每次用到都要重新取。
    // drivers（DriverStation）在本函数后面才建：这里只是存一个会在调用时才执行的箭头函数，调用发生在
    // drivers 已经赋值之后（操作员点「自动」的时候），JS 闭包按引用捕获变量，声明顺序不影响这一点。
    hints: () => drivers.hints(),
    sender: fakePrinters
      ? { send: (name, data) => fakePrinters.sendRaw(name, data) }
      : createRawSender(process.platform, probeHost),
    hasPrinter: (name) => adapter.hasPrinter(name),
    log: (message) => console.info(message),
    warn: (message) => console.warn(message),
    clock: systemClock,
    submitted: submittedJobs,
  });
  // 仅开发 / E2E：假打印机也能诊断（见 diagnosis/fake-diagnosis.ts），安装版不会走到这里。
  const fakeDiagnosis =
    fakeSpecs && fakePrinters
      ? new FakeDiagnosis(diagnosisPlatformOf(process.platform), fakeSpecs, fakePrinters, submittedJobs, systemClock)
      : null;
  if (fakeDiagnosis) {
    (globalThis as { e2eFakeDiagnosis?: FakeDiagnosis }).e2eFakeDiagnosis = fakeDiagnosis;
  }
  // 5a（标签机指令）的发送入口：诊断的「指令集」「走一张纸」「纸张校准」都经这个接缝，不直接碰 PrinterCommands。
  const labelCommands: LabelCommandsSeam = fakeSpecs
    ? new FakeLabelCommands(fakeSpecs)
    : {
        effectiveCommandSet: async (name) => {
          const view = await printerCommands.describe(name);
          return effectiveCommandSet(view.config.commandSet, view.detected) ?? 'none';
        },
        send: async (name, action) => {
          const result = await printerCommands.run(name, action);
          switch (result.status) {
            case 'sent':
              return { kind: 'done' };
            case 'not-sent':
              return { kind: 'failed', detail: notSentText(result.reason) };
            case 'invalid':
              return { kind: 'failed', detail: result.issue };
            case 'failed':
              // rawSendFailureText 把 uncertain 说成「不确定有没有发出去」，不是「没做成」：
              // 排到的请求因为探测进程没有及时回应而说不清结果，打印机可能已经收到了。
              return { kind: 'failed', detail: rawSendFailureText(result.reason, result.detail) };
          }
        },
      };
  const diagnosis = new DiagnosisStation({
    system: fakeDiagnosis ?? createDiagnosisSystem(process.platform, diagnosisProbeHost),
    // 系统打印机列表（读它要用主窗口；诊断由界面触发，那时窗口一定在）。
    isKnownPrinter: (name) => adapter.hasPrinter(name),
    driverPaper: (name) => profiles.fresh(name),
    // M2：这台打印机负责的纸由主进程按设置和模板自己查，不收渲染进程报来的纸张键。
    responsiblePaper: (name) => responsiblePaper(name, settings.current.paperPrinters, templates.list()),
    forgetProfile: (name) => profiles.forget(name),
    openPreferences: fakeDiagnosis ? (name) => fakeDiagnosis.openPreferences(name) : openPrinterPreferences,
    submitted: submittedJobs,
    commands: labelCommands,
    // getDrivers 是取值函数：DriverStation 在这之后才构造（和上面 printerCommands 的 hints 同一个道理，
    // 闭包按引用捕获，调用时 drivers 已经赋值）。
    drivers: createDriverReinstallSeam(() => drivers, driverNameOf),
    clock: systemClock,
    log: (message) => console.info(message),
  });
  /** 要检测状态的打印机：纸张分配和模板指定里出现的（交给探测进程前再核对系统里有）。 */
  const assignedPrinterNames = (): string[] => [
    ...new Set([
      ...Object.values(settings.current.paperPrinters),
      ...templates.list().flatMap((template) => (template.printer ? [template.printer] : [])),
    ]),
  ];
  // 预先读好分配到的打印机的驱动资料：第一张打印就能用上驱动的分辨率，不用等冷查询。
  const warmProfiles = async () => {
    for (const name of assignedPrinterNames()) {
      if (await isInstalled(name)) {
        void profiles.get(name);
      }
    }
  };
  const choosePrinter = async (template: LabelTemplate): Promise<PrinterChoice> => {
    let installed: string[];
    try {
      installed = await adapter.knownPrinterNames();
    } catch (error) {
      // 读不到打印机列表时不能让打印抛错：当作模板指定的在（交给适配器去报找不到），不悄悄换打印机。
      console.error('[print] cannot list printers', error);
      installed = template.printer ? [template.printer] : [];
    }
    return resolvePrinter(template, settings.current.paperPrinters, installed);
  };
  status.start();
  // 这时主窗口还没建好（读不到打印机列表）：只登记要检测哪些打印机，窗口建好后再立即检测。
  void status.watchPrinters(assignedPrinterNames);
  const outbox = new WebhookOutbox({
    store: new SqliteWebhookStore(database),
    send: createWebhookSender({
      fetch: (url, init) => net.fetch(url, init),
      secret: (name) => secrets.get(name),
      now: () => systemClock.now(),
      userAgent,
    }),
    endpoints: () => settings.current.webhooks,
    clock: systemClock,
    station: { name: hostname(), app: app.getVersion() },
    createId: randomUUID,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
  });
  // 桌面扫码、手机扫码、本机接口都经这一个打印队列：关到托盘后的静默更新看它是否空闲。
  const printQueue = new PrintQueue(PRINT_TIMEOUT_MS);
  const service = new PrintService({
    adapter,
    store: jobs,
    guard,
    clock: systemClock,
    queue: printQueue,
    createId: randomUUID,
    recognize: (raw) => recognize(raw, activeRules(rules, settings.current), runRegex),
    enrich: (scan, context) => enrich(scan, rules.get(scan.ruleId)?.steps ?? [], enrichDeps, new Date(), context),
    resolveTemplate: (scan) => resolvePrintTemplate(templates, settings.current, scan).template,
    choosePrinter,
    onRecorded: (job, scan) => outbox.enqueueResult(job, scan),
  });
  service.restore();
  // 批量打印：表格在隔离的子进程里读（不可信的文件 + 第三方解析库，见 batch/table-reader-host.ts）。
  const tableReader = new TableReaderHost({
    fork: () => {
      const child = utilityProcess.fork(batchReaderPath, [], {
        serviceName: TABLE_READER_SERVICE_NAME,
        execArgv: [`--max-old-space-size=${TABLE_READER_HEAP_MB}`],
      });
      return {
        postMessage: (request) => child.postMessage(request),
        onMessage: (listener) => {
          child.on('message', listener);
        },
        onExit: (listener) => {
          child.on('exit', listener);
        },
        kill: () => {
          child.kill();
        },
      };
    },
    timeoutMs: TABLE_READ_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const batch = new BatchStation({
    readTable: (request) => tableReader.read(request),
    findTemplate: (id) => templates.get(id),
    printFields: (input) => service.printFields(input),
    dpiFor: async (template) => {
      const { printerName } = await choosePrinter(template);
      return printerName !== null && (await isInstalled(printerName))
        ? profiles.dpiOf(printerName)
        : DEFAULT_PRINTER_DPI;
    },
    render: (template, label, dpi) => {
      // diagnostics 是条码库的原始英文错误：预览和检查不用（打印时适配器另写日志）。
      const {
        html,
        diagnostics: _diagnostics,
        ...warnings
      } = renderLabelHtml(
        { scan: fieldsScan(label.content, label.fields, BATCH_RULE), template, printedAt: Date.now() },
        dpi,
      );
      return { html, warnings, paper: template.paper };
    },
    failedJobs: (batchId, row) => jobs.listBatchFailures(batchId, row),
    createTableId: randomUUID,
    createBatchId: () => batchIdFor(new Date(), randomUUID().slice(0, 4)),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    onStatus: (status) => sendToMainWindow(IpcChannel.BatchStatusChanged, status),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    now: () => Date.now(),
  });
  // PDF 打印：PDF 只在隐藏的 sandbox 渲染页里解析（见 pdf/pdf-render-window.ts），这里只收核对过的灰度位图。
  const pdfCache = new PieceCache({
    dir: join(dataPath, PDF_CACHE_DIR_NAME),
    createKey: randomUUID,
    now: () => Date.now(),
  });
  // 程序自己的缓存，和日志一样按天数保留：启动时删掉 7 天没用过的，不打扰用户。
  pdfCache
    .prune(PDF_PIECE_RETENTION_MS)
    .then((removed) => {
      if (removed > 0) {
        console.log(`[pdf] pruned ${removed} cached pieces older than the retention`);
      }
    })
    .catch((error: unknown) => console.error('[pdf] failed to prune the piece cache', error));
  const pdfRenderer = new PdfRenderHost({
    openPort: () => openRenderWindow(join(__dirname, '../renderer'), 'pdf'),
    openTimeoutMs: PDF_OPEN_TIMEOUT_MS,
    pageTimeoutMs: PDF_PAGE_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const pdf = new PdfStation({
    renderer: pdfRenderer,
    pieces: pdfCache,
    readFile: async (path) => new Uint8Array(await readFile(path)),
    fileSize: async (path) => (await stat(path)).size,
    // 按纸张决定打印机（和打印时同一个规则），用那台的分辨率出块；只为选打印机，借通用模板换上这种纸。
    dpiFor: async (paper) => {
      const { printerName } = await choosePrinter(withPaper(GENERIC_TEMPLATE, paper));
      return printerName !== null && (await isInstalled(printerName))
        ? profiles.dpiOf(printerName)
        : DEFAULT_PRINTER_DPI;
    },
    printFields: (input) => service.printFields(input),
    renderHtml: (template, content, fields, dpi) =>
      renderLabelHtml({ scan: fieldsScan(content, fields, PDF_RULE), template, printedAt: Date.now() }, dpi).html,
    createRunId: randomUUID,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    onStatus: (status) => sendToMainWindow(IpcChannel.PdfStatusChanged, status),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    log: (line) => console.warn(line),
  });
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
    onBeforeInstall: (window) => {
      // 要问的（没保存的模板、批量打印）都在装之前问过或挡下了：安装引起的退出不再问第二遍。
      readyToQuit = true;
      isQuitting = true;
      // 安装程序装完会自己带 --updated 启动新版本：不再另外重启一次。
      pendingRelaunch.cancel();
      relaunch.write(window);
    },
  });
  // 有启用的「图中文字识别」步骤时，后台先把模型加载好：手机扫的第一张不用等。
  const warmImageText = (): void => {
    if (
      phoneImageRequest(
        activeRules(rules, settings.current).map((rule) => rule.steps),
        canReadImages(),
      ) !== null
    ) {
      imageText.warm();
    }
  };
  warmImageText();
  const mobile = new MobileStation({
    settings: () => settings.current,
    buildDefaultRelayUrl: BUILD_DEFAULT_RELAY_URL,
    printerLabel: async () => {
      const known = await adapter.listPrinters().catch((error: unknown): PrinterInfo[] => {
        console.warn('[mobile] cannot list printers for the phone header', error);
        return [];
      });
      // 手机上显示界面里的名字（macOS 上系统名是打印队列名）。
      return phonePrinterLabel(
        assignedPrinterNames().map((name) => {
          const printer = known.find((item) => item.name === name);
          return { name: printer?.displayName ?? name, isListed: printer !== undefined, readiness: status.get(name) };
        }),
      );
    },
    submit: (request) => service.submit(request),
    imageRequest: () =>
      phoneImageRequest(
        activeRules(rules, settings.current).map((rule) => rule.steps),
        canReadImages(),
      ),
    createHost: (hostDeps) =>
      new MobileHost({
        ...hostDeps,
        clock: systemClock,
        timers: {
          setTimeout: (callback, ms) => setTimeout(callback, ms),
          clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        // 主进程（Node 24）自带 WebSocket，不需要额外的依赖；它不走系统代理（README 里写明）。
        createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        // 日志行自带「mobile:」前缀。
        log: (line) => console.info(line),
      }),
    onStatus: (status) => sendToMainWindow(IpcChannel.MobileStatusChanged, status),
    log: (line) => console.info(line),
  });
  const mobileTicker = setInterval(() => mobile.tick(), MOBILE_TICK_INTERVAL_MS);
  const localApi = new LocalApi({
    db: database,
    clock: systemClock,
    appVersion: app.getVersion(),
    settings: () => settings.current,
    // 只改授权网站：不影响别的设置，不需要走 onSettingsChanged。
    updateSettings: (patch) => settings.update(patch),
    notifyOriginRequest,
    firewall: {
      check: () => firewallStatus(app.getPath('exe')),
      add: async () => {
        // 脚本会先删掉本程序同名的旧规则：共享开着时要连 mDNS 那条一起重新加上。
        const result = await addFirewallRule(app.getPath('exe'), { discovery: settings.current.ippSharingEnabled });
        // 同一条脚本也放行了局域网共享的 TCP（和开着时的 UDP 5353）：共享重新看要不要监听、广播。
        // ippSharing 在下面才建：这个回调要等操作员点按钮才会跑，那时已经有了。
        void ippSharing.firewallChanged();
        return result;
      },
    },
    holdLanUntilFirewallAllows: app.isPackaged,
    findTemplate: (id) => templates.get(id),
    listTemplates: () => templates.list(),
    installedPrinters: () => adapter.knownPrinterNames(),
    listPrinters: async () =>
      apiPrinters({
        installed: await adapter.listPrinters(),
        paperPrinters: settings.current.paperPrinters,
        templates: templates.list(),
        readinessOf: (name) => status.get(name),
      }),
    printFields: (input) => service.printFields(input),
    renderPdf: renderLabelPdf,
    candidatePorts: apiCandidatePorts(process.env, app.isPackaged),
    findPortOwner,
    lanAddresses: () => lanIPv4Addresses(networkInterfaces()),
    onStatus: (apiStatus) => sendToMainWindow(IpcChannel.LocalApiStatusChanged, apiStatus),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
  });
  // 局域网共享：IPP 专用一个渲染窗口和会话（和「打印 PDF」页互不干扰、不同进程），收到的文档只在它里面解析。
  const ippRenderer = new PdfRenderHost({
    openPort: () => openRenderWindow(join(__dirname, '../renderer'), 'ipp'),
    openTimeoutMs: PDF_OPEN_TIMEOUT_MS,
    pageTimeoutMs: PDF_PAGE_TIMEOUT_MS,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    log: (line) => console.warn(line),
  });
  const ippSharing = new IppSharing({
    clock: systemClock,
    settings: () => settings.current,
    // 只改共享自己记的几项（上次的端口、实例编号）：不影响别的设置，不需要走 onSettingsChanged。
    updateSettings: (patch) => settings.update(patch),
    store: new SqliteIppStore(database),
    // macOS 的 hostname 带 .local：去掉，实例名里只要电脑名。
    computerName: () => hostname().replace(/\.local$/i, ''),
    productNameAscii: BRAND.productNameAscii,
    makeAndModel: IPP_MAKE_AND_MODEL,
    installedPrinters: () => adapter.knownPrinterNames(),
    readinessOf: (name) => status.get(name),
    dpiOf: (name) => profiles.dpiOf(name),
    firewall: {
      check: () => firewallStatus(app.getPath('exe')),
      checkDiscovery: () => discoveryFirewallStatus(app.getPath('exe')),
      add: async () => {
        const result = await addFirewallRule(app.getPath('exe'), { discovery: true });
        // 本机接口用的是同一条规则：它也重新检查。
        await localApi.checkFirewall();
        return result;
      },
    },
    holdUntilFirewallAllows: app.isPackaged,
    candidatePorts: ippCandidatePorts(process.env, app.isPackaged),
    ipv4Host: ippBindHost(process.env, app.isPackaged),
    // 只在开发 / E2E 把共享限制在本机回环时才接受回环来的连接。
    allowLoopback: ippBindHost(process.env, app.isPackaged) !== undefined,
    discoveryEnabled: isDiscoveryEnabled(process.env, app.isPackaged),
    lanInterfaces: () => lanIPv4Interfaces(networkInterfaces()),
    render: { renderer: ippRenderer, pieces: pdfCache, printFields: (input) => service.printFields(input) },
    findPortOwner,
    notifyClientRequest: notifyIppClientRequest,
    onStatus: (sharingStatus) => sendToMainWindow(IpcChannel.IppStatusChanged, sharingStatus),
    onJobsChanged: () => sendToMainWindow(IpcChannel.JobsChanged, null),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.info(line),
  });
  /** 退出前停共享（告别广播、对方的请求收尾、没打完的任务中止）；最多等一会儿，不让退出卡住。 */
  const stopSharingForQuit = async (): Promise<void> => {
    if (!(await settleWithin(ippSharing.stop(), IPP_STOP_ON_QUIT_TIMEOUT_MS))) {
      console.warn('[ipp] LAN sharing did not stop in time, quitting anyway');
    }
  };
  // macOS/Linux 关机、注销时 before-quit 也会触发（Windows 不会，走的是下面的 session-end）：
  // 这种情况下不弹确认，不能挡着系统关机。powerMonitor 没有「关机被取消」的事件，收到这个信号
  // 之后就不再复位——真被取消的情况很少见，顶多是这之后一次正常退出也跳过了确认，不是大问题。
  // macOS 上 shutdown 和 before-quit 谁先触发尚未在真机上验证过，上线前要用真的 Mac 测一次。
  powerMonitor.on('shutdown', () => {
    isSystemShutdown = true;
  });

  // 退出的副作用（告诉手机「已退出」、isQuitting 影响关窗口是不是藏进托盘）必须等退出真的要发生了
  // 才做：都归到这一个 before-quit 处理器里，不能分散在几个各管各的处理器里——那样的话，批量打印的
  // 确认框选了「取消」之后，其他处理器仍然会在同一次 before-quit 里各自跑一遍，副作用照样发生，
  // 退出明明被取消了，托盘行为却已经坏掉。
  // 模板页有没保存的修改：界面经 IPC 报告，退出时据此确认（template-quit.ts）。
  const templateQuit = new TemplateQuitGuard();
  let readyToQuit = false;
  // 确认框开着时又来一次 before-quit（托盘连点两次「退出」）：不再弹第二个，等第一个的结果。
  let isConfirmingQuit = false;
  // 退出前的异步收尾（删缓存、停共享）正在做：这期间再来的 before-quit 只拦住、不重复做。
  let isFinishingQuit = false;
  // 用异步版本：确认框开着的这段时间，打印和 IPC 照常响应（同步版本会冻住整个主进程）。
  const showQuitDialog = (options: Electron.MessageBoxOptions) =>
    mainWindow && !mainWindow.isDestroyed()
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options);

  /**
   * 模板页有没保存的修改：问「保存并退出 / 不保存退出 / 取消」。保存经界面平常的保存流程往返一次
   * （template-quit.ts）；没存上就不退出，并说明。返回 true 表示可以接着退出。
   */
  const confirmTemplateQuit = async (): Promise<boolean> => {
    const name = templateQuit.unsaved || UNSAVED_TEMPLATE_FALLBACK_NAME;
    const { message, detail } = templateQuitDialogText(name);
    const { response } = await showQuitDialog({
      type: 'warning',
      buttons: [...TEMPLATE_QUIT_BUTTONS],
      defaultId: TEMPLATE_QUIT_BUTTONS.indexOf('保存并退出'),
      cancelId: TEMPLATE_QUIT_BUTTONS.indexOf('取消'),
      message,
      detail,
    });
    const choice = templateQuitChoice(response);
    if (choice !== 'save') {
      return choice === 'discard';
    }
    const isSaved = await templateQuit.requestSave(
      () => sendToMainWindow(IpcChannel.TemplateSaveForQuit, null),
      SAVE_FOR_QUIT_TIMEOUT_MS,
    );
    if (!isSaved) {
      console.warn('[quit] the unsaved template was not saved, staying open');
      await showQuitDialog({ type: 'warning', buttons: ['好'], ...templateSaveFailedText(name) });
    }
    return isSaved;
  };

  /**
   * 「重启更新」之前：有没保存的模板就先问。和退出确认共用 isConfirmingQuit，免得两个确认框叠在一起。
   * 选了取消就不装，也不动 isQuitting（它只在 onBeforeInstall 里、真的要装时才设）。
   */
  const confirmBeforeInstall = async (): Promise<boolean> => {
    if (isConfirmingQuit) {
      return false;
    }
    isConfirmingQuit = true;
    try {
      showMainWindow();
      return await templateQuit.confirmBeforeInstall(confirmTemplateQuit);
    } finally {
      isConfirmingQuit = false;
    }
  };

  /**
   * 批量打印、PDF 还有没打的：一起问（同一个确认框，和批量打印单独一个弹框分开，因为按钮文字一样、
   * 都是「取消」没副作用 / 「仍要退出」会取消）。退出就把两边都取消，等它们真的停下来再把没打的
   * 记成「退出时未打」。返回 true 表示可以接着退出。
   */
  const confirmBatchAndPdfQuit = async (): Promise<boolean> => {
    const pendingBatch = batch.pendingQuit();
    const pendingPdf = pdf.pendingQuit();
    const { message, detail } = quitDialogText(pendingBatch?.labels.length ?? 0, pendingPdf?.labels.length ?? 0);
    const { response } = await showQuitDialog({
      type: 'warning',
      buttons: ['取消', '仍要退出'],
      defaultId: 0,
      cancelId: 0,
      message,
      detail,
    });
    if (response !== 1) {
      return false;
    }
    // 弹确认框的这段时间批次、PDF 可能还在打：重新查一遍，只记下这一刻真的还没轮到的——
    // 不能用弹框之前的旧名单，那时候「没打」的几张可能这期间已经打完或者失败了。confirmQuit
    // （不是 pendingQuit）钉住 PDF 这几块的位图：从这一刻起要把它们记成「退出时未打」。
    const stillPendingBatch = batch.pendingQuit();
    const stillPendingPdf = pdf.confirmQuit();
    // 两边先都取消，再一起等它们真的停下来：各自最多等 BATCH_CANCEL_SETTLE_TIMEOUT_MS，
    // 一前一后做的话最坏要等两份超时，一起等最坏只等一份。
    if (stillPendingBatch !== null) {
      batch.cancel();
    }
    if (stillPendingPdf !== null) {
      pdf.cancel();
    }
    await Promise.all([
      stillPendingBatch !== null ? waitForBatchIdle(() => batch.whenIdle(), BATCH_CANCEL_SETTLE_TIMEOUT_MS) : null,
      stillPendingPdf !== null ? waitForBatchIdle(() => pdf.whenIdle(), BATCH_CANCEL_SETTLE_TIMEOUT_MS) : null,
    ]);
    // 正在打的那一张结束之后（它自己的打印结果已经有记录了）才记 CANCELED、最后才退出：
    // 不然要么这一张会在被标成「没打」之后又打出来，要么退出时它还没打完。
    if (stillPendingBatch !== null) {
      for (const record of canceledJobRecords(
        stillPendingBatch.batchId,
        stillPendingBatch.template,
        stillPendingBatch.labels,
        randomUUID,
        Date.now,
      )) {
        jobs.append(record);
      }
    }
    if (stillPendingPdf !== null) {
      for (const record of canceledPdfJobRecords(stillPendingPdf.labels, randomUUID, Date.now)) {
        jobs.append(record);
      }
    }
    return true;
  };

  /**
   * 局域网共享还有别的电脑交来、没打完的任务：问一下。选「取消」没有副作用；选「仍要退出」也先不动它们，
   * 等后面几步都确认了，最后停共享时一起中止（不然后面再选「取消」，对方的任务已经白白中止了）。
   */
  const confirmIppQuit = async (): Promise<boolean> => {
    const { message, detail } = ippQuitDialogText(Math.max(1, ippSharing.pendingJobs));
    const { response } = await showQuitDialog({
      type: 'warning',
      buttons: ['取消', '仍要退出'],
      defaultId: 0,
      cancelId: 0,
      message,
      detail,
    });
    return response === 1;
  };

  /** 退出前的异步收尾：删掉没打过的缓存位图、停局域网共享。两件一起做。 */
  const finishBeforeQuit = (): Promise<unknown> =>
    Promise.all([
      pdf
        .discardUnprintedCache()
        .catch((error: unknown) => console.error('[pdf] failed to discard the unprinted cache on quit', error)),
      stopSharingForQuit(),
    ]);

  app.on('before-quit', (event) => {
    if (readyToQuit) {
      // 这一次放行，退出确定要发生：GPU 崩溃排着的重启现在才交出去。
      isQuitting = true;
      pendingRelaunch.commit((args) => app.relaunch({ args }));
      mobile.quit();
      return;
    }
    const pendingBatch = batch.pendingQuit();
    const pendingPdf = pdf.pendingQuit();
    const needsBatchOrPdf = shouldConfirmBatchQuit(
      (pendingBatch?.labels.length ?? 0) + (pendingPdf?.labels.length ?? 0),
      isSystemShutdown,
    );
    const needsTemplate = templateQuit.shouldConfirm(isSystemShutdown);
    const needsIpp = shouldConfirmBatchQuit(ippSharing.pendingJobs, isSystemShutdown);
    const step = quitStep({ isSystemShutdown, needsConfirm: needsBatchOrPdf || needsTemplate || needsIpp });
    if (step === 'quit-now') {
      // 系统在关机、注销：不拦这次退出去删缓存、停局域网共享（见 quitStep），进程退出时端口自然关掉。
      // macOS 上 powerMonitor 的 shutdown 和 before-quit 谁先到还没在真 Mac 上核对过（见上面 shutdown 处的说明）：
      // before-quit 先到的话这里还认不出是关机，照常先收尾再退出。
      readyToQuit = true;
      isQuitting = true;
      pendingRelaunch.cancel();
      mobile.quit();
      return;
    }
    if (step === 'discard-cache-then-quit') {
      // 没有要确认的，但还要删掉这次出块里没打过的缓存位图（见 discardUnprintedCache）、停局域网共享（告别广播）：
      // 这是异步的，不能让退出真的发生之后才做——进程可能在做完之前就已经退出了。先拦住这一次，做完再调用
      // app.quit() 重新触发：这时 readyToQuit 已经是 true，下一次进这个处理器会直接放行，不会再拦一次。
      event.preventDefault();
      // 收尾还没做完又来一次 before-quit（托盘连点两次「退出」）：等这一次做完，不再收尾第二遍。
      if (isFinishingQuit) {
        return;
      }
      isFinishingQuit = true;
      void finishBeforeQuit().finally(() => {
        readyToQuit = true;
        isQuitting = true;
        mobile.quit();
        app.quit();
      });
      return;
    }
    event.preventDefault();
    if (isConfirmingQuit || isFinishingQuit) {
      return;
    }
    isConfirmingQuit = true;
    // 先问模板（选「取消」没有任何副作用），再问局域网共享（选「仍要退出」也只是记下，最后才停），
    // 最后问批量打印和 PDF（选「仍要退出」会取消它们）：反过来的话，已经取消的批次、PDF 块再也回不去，
    // 前面那一步再选「取消」也没意义了。
    // 从置位起的每一步都在 try 里：哪一步抛了，finally 都会复位 isConfirmingQuit，下一次退出还能再问。
    void (async () => {
      try {
        showMainWindow();
        if (needsTemplate && !(await confirmTemplateQuit())) {
          return;
        }
        if (needsIpp && !(await confirmIppQuit())) {
          return;
        }
        if (needsBatchOrPdf && !(await confirmBatchAndPdfQuit())) {
          return;
        }
        // 这次出块里没打过的缓存位图（打过的、confirmQuit 钉住的除外）现在删掉，不然要等 7 天
        // 的保留期才会被清理（1000 张约 260MB）；局域网共享这时才停，没打完的任务中止。
        await finishBeforeQuit();
        readyToQuit = true;
        isQuitting = true;
        mobile.quit();
        app.quit();
      } catch (error) {
        console.error('[quit] the quit confirmation failed, staying open', error);
      } finally {
        isConfirmingQuit = false;
        // 确认框取消了（或出错没退出）：程序接着用，GPU 崩溃排着的重启作废，下一次退出不能被它变成重启。
        if (!readyToQuit) {
          pendingRelaunch.cancel();
        }
      }
    })();
  });

  // 驱动安装（打印机页的「驱动」一节）。E2E 换掉设备检测、安装包下载、签名核对和提权安装（见 drivers/fake-drivers.ts），
  // 清单照样真实下载、真实验签。安装版不读这些环境变量。
  const fakeDriverSpec = parseFakeDrivers(process.env, app.isPackaged);
  const fakeDrivers = fakeDriverSpec ? new FakeDrivers(fakeDriverSpec, fakePrinters) : null;
  if (fakeDrivers) {
    console.info('[drivers] using fake devices and installers');
    (globalThis as { e2eFakeDrivers?: FakeDrivers }).e2eFakeDrivers = fakeDrivers;
  }
  const driverPlatform: DriverPlatform | null =
    fakeDrivers !== null || process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : null;
  const driverLog = (line: string) => console.info(line);
  // 上次没来得及关掉程序（崩溃、被杀、断电）时，下载到一半的临时目录可能没删干净：启动时清一遍。
  void cleanupOldDownloads(app.getPath('temp'), driverLog);
  const systemPorts = systemDriverPorts(driverPlatform, driverLog);
  const drivers = new DriverStation({
    platform: driverPlatform,
    catalog: new CatalogClient({
      url: () => settings.current.driverCatalogUrl ?? BUILD_DEFAULT_DRIVER_CATALOG_URL,
      fetch: (url, init) => net.fetch(url, init),
      keys: trustedKeys({ ...DRIVER_CATALOG_PUBLIC_KEYS, ...testCatalogKey(process.env, app.isPackaged) }),
      store: new SqliteCatalogStateStore(database),
      clock: systemClock,
      userAgent,
      log: driverLog,
    }),
    devices: fakeDrivers?.deviceSource() ?? systemPorts.devices,
    flow: {
      downloader: createInstallerDownloader({
        fetch: fakeDrivers?.fetch() ?? ((url, init) => net.fetch(url, init)),
        tempRoot: app.getPath('temp'),
        userAgent,
      }),
      verifier: fakeDrivers?.verifier() ?? systemPorts.verifier,
      installer: fakeDrivers?.installer() ?? systemPorts.installer,
      listPrinters: () => adapter.knownPrinterNames(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      clock: systemClock,
    },
    openExternal: (url) => shell.openExternal(url),
    onStatus: (status) => sendToMainWindow(IpcChannel.DriverStatusChanged, status),
    clock: systemClock,
    log: driverLog,
  });

  registerIpc({
    templateQuit,
    confirmBeforeInstall,
    service,
    adapter,
    batch,
    pdf,
    jobs,
    settings,
    templates,
    lookupTables,
    secrets,
    outbox,
    rules: new RuleService({
      catalog: rules,
      settings,
      runRegex,
      enrich: (scan, steps) => enrich(scan, steps, enrichDeps, new Date()),
      clock: systemClock,
      // 规则的加工步骤决定要不要手机截标签图。
      onChanged: () => {
        mobile.rulesChanged();
        warmImageText();
      },
    }),
    status,
    diagnosis,
    appInfo: {
      productName: BRAND.productName,
      brandOwner: BRAND.owner,
      version: app.getVersion(),
      buildNumber: BUILD_NUMBER,
      dataPath,
      logsDir,
      defaultRelayUrl: BUILD_DEFAULT_RELAY_URL,
      defaultDriverCatalogUrl: BUILD_DEFAULT_DRIVER_CATALOG_URL,
      canReadImageText: canReadImages(),
    },
    updater,
    voice,
    mobile,
    localApi,
    ippSharing,
    drivers,
    driverNameOf,
    profiles,
    printerCommands,
    getWindow: () => mainWindow,
    choosePrinter,
    onTemplatesChanged: () => {
      void status.poll();
      void warmProfiles();
      // 模板指定的打印机可能变了：手机顶部的打印机汇总跟着变。
      mobile.printersChanged();
    },
    onSettingsChanged: async (next, previous) => {
      guard.setWindowMs(secondsToMs(next.dedupWindowSeconds));
      // sanitizeSettings 每次都建新对象：按内容比较。
      if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) {
        void status.poll();
        void warmProfiles();
      }
      if (next.launchAtLogin !== previous.launchAtLogin) {
        applyLaunchAtLogin(next.launchAtLogin);
      }
      if (JSON.stringify(next.voice) !== JSON.stringify(previous.voice)) {
        warmVoice();
      }
      if (next.ocrModelTier !== previous.ocrModelTier) {
        // 换了模型档位：放掉旧模型、按新档位加载；能不能识别可能跟着变了，再告诉在线的手机要不要截图。
        imageText.reset();
        reportMissingOcr();
        mobile.rulesChanged();
        warmImageText();
      }
      if (next.historyLimit !== previous.historyLimit) {
        await jobs.setCapacity(next.historyLimit);
      }
      if (JSON.stringify(next.webhooks) !== JSON.stringify(previous.webhooks)) {
        outbox.endpointsChanged();
      }
      if (next.driverCatalogUrl !== previous.driverCatalogUrl) {
        drivers.catalogUrlChanged();
      }
      mobile.settingsChanged(next, previous);
      await localApi.settingsChanged(next, previous);
      await ippSharing.settingsChanged(next, previous);
    },
  });
  outbox.start();
  applyLaunchAtLogin(settings.current.launchAtLogin);

  // 未打包运行（开发、E2E）时 macOS 程序坞默认显示 Electron 图标；安装版的图标由打包配置决定。
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }
  const windowStates = new SqliteWindowStateStore(database);
  const placement = planInitialPlacement(windowStates);
  // 关在托盘里静默更新的，安装程序带 --updated 启动新版本：它也待在托盘里。其余都到最前（前台锁见 window-activation.ts）。
  const startup = process.argv.includes(UPDATED_ARG) && relaunchWindow === 'tray' ? 'tray' : 'front';
  mainWindow = createMainWindow({
    icon: appIcon,
    placement,
    // 没有托盘图标时不藏（藏起来之后就再也叫不回窗口了），关窗先走退出确认。
    closeState: () => ({ hasTray: tray !== null, isQuitting }),
    onHidden: () => tray?.notifyHiddenOnce(),
    startup,
  });
  // 主窗口真的被关掉（不是藏进托盘）时放掉隐藏的 PDF 渲染窗口：它是另一个 BrowserWindow，不跟着主窗口
  // 一起关的话，Electron 不会判定「所有窗口都关了」，没有托盘时关闭主窗口就退不出程序，一直在后台挂着。
  mainWindow.on('closed', () => {
    pdfRenderer.close();
    ippRenderer.close();
    // 已经销毁的窗口不能再拿来弹确认框、到最前（会抛 Object has been destroyed）。
    mainWindow = null;
  });
  // 窗口关在托盘里的起始时间：关到托盘后的静默更新要等一会儿（background-update.ts）。
  let hiddenSince: number | null = startup === 'tray' ? Date.now() : null;
  mainWindow.on('hide', () => {
    hiddenSince = Date.now();
  });
  mainWindow.on('show', () => {
    hiddenSince = null;
  });
  // 界面进程崩了：没保存的模板修改随它没了，别再拿它挡退出和静默更新（重新加载后界面会重新报告）。
  mainWindow.webContents.on('render-process-gone', () => templateQuit.rendererGone());
  // 必须先于下面的 session-end 处理注册：关机时先保存窗口位置，再关闭数据库。
  trackWindowPlacement(mainWindow, windowStates, placement.bounds);
  // 读打印机列表要用主窗口：窗口建好后立即检测一次状态、预读驱动资料，不等下一轮轮询。
  void status.poll();
  void warmProfiles();
  // 打印机列表要用主窗口：窗口建好之后才开始接收接口请求。
  localApi.start().catch((error: unknown) => console.error('[api] local api failed to start', error));
  // 局域网共享同样要等主窗口建好（读打印机列表要用它）；默认关着，start 只按设置决定要不要监听。
  ippSharing.start().catch((error: unknown) => console.error('[ipp] LAN sharing failed to start', error));
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
  const backgroundUpdateTimer = setInterval(() => {
    const state = {
      isUpdateReady: updater.current.state === 'ready',
      // 托盘建不起来时关窗就是退出，不会有「关在托盘里」。
      hiddenSince: tray === null ? null : hiddenSince,
      // 批量打印、PDF 还有没打的（暂停中的也算）时不静默更新：重启会丢掉剩下的。
      // 正在装驱动也算有事没做完：静默更新会结束本程序，装到一半的提权安装就没人等了。
      // 局域网共享还有别的电脑交来、没打完（含等确认）的任务时也不静默更新。
      pendingPrints:
        printQueue.pending +
        localApi.pendingJobs +
        ippSharing.pendingJobs +
        batch.pendingLabels +
        pdf.pendingLabels +
        (drivers.isInstalling ? 1 : 0),
      isMobileOn: mobile.status().state !== 'off',
      hasUnsavedTemplate: templateQuit.unsaved !== null,
      now: Date.now(),
    };
    if (canUpdateInBackground(state)) {
      console.info('[updater] installing in the background: the window is in the tray and nothing is in use');
      updater.install('tray');
    }
  }, BACKGROUND_UPDATE_CHECK_MS);
  warmVoice();
  // 纯同步：will-quit 是退出前最后一个事件，这里 preventDefault 之后再异步收尾、重新调用
  // app.quit() 不会正确重启退出流程（它不是 before-quit，Electron 不会重新走一遍这个事件链，
  // 进程会一直挂着）。会写文件的收尾（PDF 缓存清理）放在 before-quit 里用那边已经在用的
  // 「preventDefault → 异步 → 置位 → app.quit()」来做，这里只做不需要等待、不能阻塞关机的收尾。
  app.on('will-quit', () => {
    clearInterval(mobileTicker);
    clearInterval(backgroundUpdateTimer);
    void localApi.stop();
    // 正常退出时 before-quit 已经停过共享；「重启更新」、Windows 关机不经过那里，这里再停一次（不等）。
    void ippSharing.stop();
    outbox.stop();
    status.stop();
    drivers.cancelInstall();
    probeHost?.dispose();
    diagnosisProbeHost?.dispose();
    pdfRenderer.close();
    ippRenderer.close();
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
