import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog, Menu, Notification, nativeImage, net } from 'electron';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';
import { DedupGuard } from '../core/dedup-guard';
import { SubmittedJobs } from '../core/diagnosis/submitted-jobs';
import { NO_DRIVER_HINTS } from '../core/drivers/driver-hints';
import { PrintQueue } from '../core/print-queue';
import { PrintService } from '../core/print-service';
import { effectiveCommandSet } from '../core/printer-commands/command-set';
import { type PrinterChoice, resolvePrinter } from '../core/printing/resolve-printer';
import { type EnrichDeps, enrich } from '../core/scan/enrich';
import { recognize } from '../core/scan/recognize';
import { RuleCatalog } from '../core/scan/rule-catalog';
import { TemplateCatalog } from '../core/templates/template-catalog';
import type { LabelTemplate } from '../core/templates/template-model';
import { type PrinterInfo, systemClock } from '../core/types';
import { BRAND } from '../shared/brand';
import { IpcChannel } from '../shared/ipc-contract';
import { PRINT_TIMEOUT_MS } from '../shared/print-timing';
import { phonePrinterLabel } from '../shared/printer-summary';
import type { SocketLike } from '../shared/relay-socket';
import { secondsToMs } from '../shared/settings';
import { apiPrinters } from './api/api-printers';
import { apiCandidatePorts, LocalApi } from './api/local-api';
import { lanIPv4Addresses } from './api/network';
import { renderLabelPdf } from './api/pdf-render';
import { findPortOwner } from './api/port-owner';
import { handleAppScheme, registerAppScheme } from './app-protocol';
import { BACKGROUND_UPDATE_CHECK_MS, canUpdateInBackground } from './background-update';
import { BUILD_NUMBER } from './build-info';
import { createDiagnosisSystem } from './diagnosis/create-diagnosis-system';
import { DiagnosisStation } from './diagnosis/diagnosis-station';
import { diagnosisPlatformOf } from './diagnosis/diagnosis-system';
import { FakeDiagnosis, FakeLabelCommands } from './diagnosis/fake-diagnosis';
import type { LabelCommandsSeam } from './diagnosis/seams';
import { addFirewallRule, firewallStatus } from './firewall';
import { createGpuCrashHandler, SOFTWARE_RENDERING_SWITCH } from './gpu-fallback';
import { registerIpc } from './ipc';
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
import { activeRules, resolvePrintTemplate } from './print-template';
import { AlertThrottle } from './printing/alert-throttle';
import { openPrinterPreferences, queryDriverPaper } from './printing/driver-paper';
import { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { FakeDriverAdapter, FakePrinters, parseFakePrinters } from './printing/fake-printers';
import { createPrinterAlertNotifier } from './printing/printer-alerts';
import { PrinterCommands } from './printing/printer-commands-station';
import type { PrinterDriver } from './printing/printer-driver';
import { queryDriverName } from './printing/printer-identity';
import { PROBE_QUERY_TIMEOUT_MS, PrinterProbeHost, spawnPowerShellProbe } from './printing/printer-probe-host';
import { PrinterProfiles } from './printing/printer-profiles';
import { createReadinessProbe, type PrinterReadiness, PrinterStatusMonitor } from './printing/printer-status';
import { createRawSender } from './printing/raw-sender';
import { RelaunchIntents, UPDATED_ARG } from './relaunch-intent';
import { createHttpStepRunner } from './scan/http-step';
import { RuleService } from './scan/rule-service';
import { createSandboxedRegexReplacer, createSandboxedRegexRunner } from './scan/sandboxed-regex';
import { safeStorageCipher } from './secrets/safe-storage-cipher';
import { denyAllPermissions, hardenAllWebContents } from './security';
import { openDatabase } from './storage/database';
import { SqliteJobStore } from './storage/sqlite-job-store';
import { SqliteLookupStore } from './storage/sqlite-lookup-store';
import { SqliteScanRuleRepository } from './storage/sqlite-scan-rule-repository';
import { SqliteSecretStore } from './storage/sqlite-secret-store';
import { SqliteSettingsStore } from './storage/sqlite-settings-store';
import { SqliteTemplateRepository } from './storage/sqlite-template-repository';
import { SqliteWebhookStore } from './storage/sqlite-webhook-store';
import { SqliteWindowStateStore } from './storage/sqlite-window-state-store';
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

/** 托盘、双击桌面快捷方式（second-instance）、点系统通知：窗口到最前并拿到焦点（前台锁见 window-activation.ts）。 */
function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  bringToFront(mainWindow, process.platform);
}

function quit(): void {
  isQuitting = true;
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
  // 标签机指令：只发给系统打印机列表里有的打印机；设置存在设置表的 printerCommands 里。
  // Windows 经常驻探测进程（winspool RAW），macOS 用 lp -o raw；E2E 用假打印机记下来。
  const printerCommands = new PrinterCommands({
    configs: () => settings.current.printerCommands,
    // 只改这一项：不影响别的设置，不需要走 onSettingsChanged。
    saveConfigs: (next) => {
      settings.update({ printerCommands: next });
    },
    driverNameOf: (name) => (fakePrinters ? fakePrinters.driverName(name) : queryDriverName(name, probeHost)),
    driverDpi: async (name) => (await profiles.get(name))?.dpi ?? null,
    // 5c（驱动安装）的在线驱动清单接进来之前，「自动」只按驱动名认。
    // 取值函数：5c 的在线驱动清单接进来后替换这里，不用重启主进程或重建 PrinterCommands 就能生效。
    hints: () => NO_DRIVER_HINTS,
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
              return { kind: 'failed', detail: result.reason };
            case 'invalid':
              return { kind: 'failed', detail: result.issue };
            case 'failed':
              return { kind: 'failed', detail: result.detail };
          }
        },
      };
  const diagnosis = new DiagnosisStation({
    system: fakeDiagnosis ?? createDiagnosisSystem(process.platform, probeHost),
    // 系统打印机列表（读它要用主窗口；诊断由界面触发，那时窗口一定在）。
    isKnownPrinter: (name) => adapter.hasPrinter(name),
    driverPaper: (name) => profiles.fresh(name),
    forgetProfile: (name) => profiles.forget(name),
    openPreferences: fakeDiagnosis ? (name) => fakeDiagnosis.openPreferences(name) : openPrinterPreferences,
    submitted: submittedJobs,
    commands: labelCommands,
    // 5c（驱动安装）的计划把这里换成它的实现；在那之前「重新安装驱动」不出现。
    drivers: null,
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
      isQuitting = true;
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
      add: () => addFirewallRule(app.getPath('exe')),
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
  // 在 before-quit 就告诉手机「程序已退出」：到 will-quit 时进程马上结束，消息可能来不及发出。
  app.on('before-quit', () => mobile.quit());

  registerIpc({
    service,
    adapter,
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
      canReadImageText: canReadImages(),
    },
    updater,
    voice,
    mobile,
    localApi,
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
      mobile.settingsChanged(next, previous);
      await localApi.settingsChanged(next, previous);
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
    // 没有托盘图标时照常关闭：藏起来之后就再也叫不回窗口了。
    shouldHideOnClose: () => !isQuitting && tray !== null,
    onHidden: () => tray?.notifyHiddenOnce(),
    startup,
  });
  // 窗口关在托盘里的起始时间：关到托盘后的静默更新要等一会儿（background-update.ts）。
  let hiddenSince: number | null = startup === 'tray' ? Date.now() : null;
  mainWindow.on('hide', () => {
    hiddenSince = Date.now();
  });
  mainWindow.on('show', () => {
    hiddenSince = null;
  });
  // 必须先于下面的 session-end 处理注册：关机时先保存窗口位置，再关闭数据库。
  trackWindowPlacement(mainWindow, windowStates, placement.bounds);
  // 读打印机列表要用主窗口：窗口建好后立即检测一次状态、预读驱动资料，不等下一轮轮询。
  void status.poll();
  void warmProfiles();
  // 打印机列表要用主窗口：窗口建好之后才开始接收接口请求。
  localApi.start().catch((error: unknown) => console.error('[api] local api failed to start', error));
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
      pendingPrints: printQueue.pending + localApi.pendingJobs,
      isMobileOn: mobile.status().state !== 'off',
      now: Date.now(),
    };
    if (canUpdateInBackground(state)) {
      console.info('[updater] installing in the background: the window is in the tray and nothing is in use');
      updater.install('tray');
    }
  }, BACKGROUND_UPDATE_CHECK_MS);
  warmVoice();
  app.on('will-quit', () => {
    clearInterval(mobileTicker);
    clearInterval(backgroundUpdateTimer);
    void localApi.stop();
    outbox.stop();
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
