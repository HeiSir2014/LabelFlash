import {
  type BrowserWindow,
  clipboard,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  type OpenDialogOptions,
  shell,
} from 'electron';
import { fieldsScan, type PrintService } from '../core/print-service';
import type { PrinterChoice } from '../core/printing/resolve-printer';
import { SECRET_LIMITS, secretReference } from '../core/scan/enrich-model';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { sanitizeTemplate } from '../core/templates/sanitize-template';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import { CUSTOM_TEMPLATE_PREFIX, type LabelTemplate } from '../core/templates/template-model';
import type { PreviewResult } from '../core/types';
import { BRAND } from '../shared/brand';
import { checkDriverPaper } from '../shared/driver-paper';
import {
  type AppInfo,
  IpcChannel,
  type LabelPreview,
  type LookupImportResult,
  RECENT_DELIVERY_COUNT,
} from '../shared/ipc-contract';
import { DEFAULT_PAPER } from '../shared/label-paper';
import { type PaperSize, parsePaperKey } from '../shared/paper-sizes';
import type { AppSettings } from '../shared/settings';
import type { LocalApi } from './api/local-api';
import { logFailures } from './ipc-errors';
import {
  requireApiKeyId,
  requireApiKeyName,
  requireBoolean,
  requireJobQuery,
  requireLookupTableId,
  requireMobilePhoneId,
  requirePaperKey,
  requirePositiveInteger,
  requirePrintOptions,
  requireRaw,
  requireRecord,
  requireSecretName,
  requireString,
  requireTemplateId,
  requireVoiceCue,
  requireWebhookId,
  requireWebOrigin,
} from './ipc-validators';
import type { LookupTables } from './lookup/lookup-tables';
import type { MobileStation } from './mobile/mobile-station';
import type { WebhookOutbox } from './notify/webhook-outbox';
import { type PrintTemplate, resolvePrintTemplate } from './print-template';
import { openPrinterPreferences } from './printing/driver-paper';
import { renderLabelHtml } from './printing/label-html';
import type { PrinterDriver } from './printing/printer-driver';
import type { PrinterProfiles } from './printing/printer-profiles';
import type { PrinterStatusMonitor } from './printing/printer-status';
import { DEFAULT_PRINTER_DPI } from './printing/qr-code';
import { registerRuleIpc } from './scan/rule-ipc';
import type { RuleService } from './scan/rule-service';
import type { SqliteJobStore } from './storage/sqlite-job-store';
import { SecretError, type SqliteSecretStore } from './storage/sqlite-secret-store';
import type { SqliteSettingsStore } from './storage/sqlite-settings-store';
import type { AppUpdater } from './updater';
import type { VoiceClips } from './voice/voice-clips';

const DRAFT_TEMPLATE_ID = `${CUSTOM_TEMPLATE_PREFIX}draft`;
/** 打印记录编号是 UUID（36 个字符）；留出余量，挡住异常长的参数。 */
const MAX_JOB_ID_LENGTH = 64;

/** 已校验的纸张键 → 纸张（requirePaperKey 保证能解析，兜底只为类型）。 */
function paperOf(key: string): PaperSize {
  return parsePaperKey(key) ?? DEFAULT_PAPER;
}

export interface IpcDeps {
  service: PrintService;
  adapter: PrinterDriver;
  jobs: SqliteJobStore;
  settings: SqliteSettingsStore;
  templates: TemplateCatalog;
  lookupTables: LookupTables;
  secrets: SqliteSecretStore;
  outbox: WebhookOutbox;
  rules: RuleService;
  status: PrinterStatusMonitor;
  appInfo: AppInfo;
  updater: AppUpdater;
  voice: VoiceClips;
  mobile: MobileStation;
  localApi: LocalApi;
  /** 每台打印机的驱动纸张和分辨率（短时缓存）。 */
  profiles: PrinterProfiles;
  getWindow: () => BrowserWindow | null;
  onSettingsChanged: (next: AppSettings, previous: AppSettings) => Promise<void>;
  /** 模板保存或删除之后：模板指定的打印机可能变了，要检测的打印机跟着变。 */
  onTemplatesChanged: () => void;
  /** 这个模板用哪台打印机（和打印时同一个规则）：模板页预览草稿时用。 */
  choosePrinter: (template: LabelTemplate) => Promise<PrinterChoice>;
}

/**
 * 渲染进程不可信（Electron 安全清单第 17 条）：只接受主窗口主 frame 发来的消息，
 * 所有参数先校验再进入业务层。
 */
export function registerIpc(deps: IpcDeps): void {
  const isTrusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    event.sender === deps.getWindow()?.webContents && event.senderFrame === event.sender.mainFrame;
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    const logged = logFailures(channel, listener, (message, error) => console.error(message, error));
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrusted(event)) {
        console.warn(
          `[ipc] rejected ${channel} from an untrusted sender: ${event.senderFrame?.url ?? 'unknown frame'}`,
        );
        throw new Error(`Rejected IPC from untrusted sender on ${channel}`);
      }
      return logged(...args);
    });
  };
  const on = (channel: string, listener: () => void) => {
    ipcMain.on(channel, (event) => {
      if (isTrusted(event)) {
        listener();
      } else {
        console.warn(`[ipc] ignored ${channel} from an untrusted sender: ${event.senderFrame?.url ?? 'unknown frame'}`);
      }
    });
  };
  registerRuleIpc(handle, deps.rules, deps.getWindow);
  const requireKnownPrinter = async (value: unknown): Promise<string> => {
    const printerName = requireString(value, 'printerName');
    if (!(await deps.adapter.hasPrinter(printerName))) {
      throw new Error(`Printer not found: ${printerName}`);
    }
    return printerName;
  };
  /**
   * 按原样重打要用的记录、模板和字段。界面按 reprintMode 只对能重打的记录显示按钮，
   * 这里再遇到缺东西（刚好被环形保留删掉、模板刚被删）就报错，由界面提示。
   */
  const storedLabelOf = (value: unknown) => {
    const jobId = requireString(value, 'jobId', MAX_JOB_ID_LENGTH);
    const job = deps.jobs.get(jobId);
    if (job === null) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (job.templateId === undefined || job.fields === undefined) {
      throw new Error(`Job ${jobId} has no stored template or fields`);
    }
    const template = deps.templates.get(job.templateId);
    if (template === null) {
      throw new Error(`Template of job ${jobId} was deleted: ${job.templateId}`);
    }
    return { job, template, fields: job.fields };
  };
  const scanOf = (result: PreviewResult) => (result.status === 'ok' ? result.scan : null);
  const printTemplateFor = (result: PreviewResult) =>
    resolvePrintTemplate(deps.templates, deps.settings.current, scanOf(result));
  const updateSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const previous = deps.settings.current;
    const next = deps.settings.update(patch);
    await deps.onSettingsChanged(next, previous);
    return next;
  };

  /** 这张要打到的打印机的分辨率；没有打印机、或打印机不在系统里时按 203dpi（名字不在系统里就不交给系统命令）。 */
  const dpiFor = async (result: PreviewResult): Promise<number> => {
    const printerName = result.status === 'ok' ? result.printer.printerName : null;
    return printerName !== null && (await deps.adapter.hasPrinter(printerName))
      ? deps.profiles.dpiOf(printerName)
      : DEFAULT_PRINTER_DPI;
  };
  handle(IpcChannel.Preview, async (raw) => {
    const result = await deps.service.preview(requireRaw(raw));
    return renderPreview(result, printTemplateFor(result), await dpiFor(result));
  });
  handle(IpcChannel.PreviewTemplate, async (raw, template) => {
    const result = await deps.service.preview(requireRaw(raw));
    const fallback = printTemplateFor(result).template;
    const draft = sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, fallback);
    // 模板页指定了要看的模板，不是规则选的；打印机也按这个模板重新决定（示例内容本来绑的是别的模板）。
    const forDraft: PreviewResult =
      result.status === 'ok' ? { ...result, printer: await deps.choosePrinter(draft) } : result;
    return renderPreview(forDraft, { template: draft, isBound: false }, await dpiFor(forDraft));
  });
  handle(IpcChannel.Print, (raw, options) =>
    deps.service.submit({ raw: requireRaw(raw), ...requirePrintOptions(options) }),
  );
  // 打印机名不在这里核对：找不到时由适配器返回 PRINTER_NOT_FOUND，和正式打印一样显示在界面上。
  handle(IpcChannel.PrintTest, (printerName, key) =>
    deps.service.printTest(requireString(printerName, 'printerName'), paperOf(requirePaperKey(key))),
  );
  handle(IpcChannel.ListPrinters, () => deps.adapter.listPrinters());
  handle(IpcChannel.PrinterStatus, (printerName) => deps.status.get(requireString(printerName, 'printerName')));
  handle(IpcChannel.CheckDriverPaper, async (printerName, key) => {
    const expected = paperOf(requirePaperKey(key));
    // 现读：操作员可能刚在系统设置里改过纸张（macOS 的打印机设置不经过程序，改完回来才核对）。
    return checkDriverPaper(await deps.profiles.fresh(await requireKnownPrinter(printerName)), expected);
  });
  handle(IpcChannel.OpenPrinterPreferences, async (printerName) => {
    const name = await requireKnownPrinter(printerName);
    await openPrinterPreferences(name);
    // 操作员可能刚改了纸张：界面随后重新检查时要读到新的设置。
    deps.profiles.forget(name);
  });
  handle(IpcChannel.ListJobs, (query) => deps.jobs.listPage(requireJobQuery(query)));
  handle(IpcChannel.PreviewJob, async (jobId) => {
    const { job, template, fields } = storedLabelOf(jobId);
    const result: PreviewResult = {
      status: 'ok',
      scan: fieldsScan(job.raw, fields),
      recent: null,
      lookupFailure: null,
      printer: await deps.choosePrinter(template),
    };
    return renderPreview(result, { template, isBound: false }, await dpiFor(result));
  });
  handle(IpcChannel.ReprintJob, (jobId) => {
    const { job, template, fields } = storedLabelOf(jobId);
    return deps.service.printFields({
      template,
      fields,
      content: job.raw,
      source: 'history',
      caller: job.caller ?? null,
      printerName: null,
    });
  });
  handle(IpcChannel.GetSettings, () => deps.settings.current);
  handle(IpcChannel.UpdateSettings, (patch) => updateSettings(requireRecord(patch, 'settings patch')));
  handle(IpcChannel.ListTemplates, () => deps.templates.list());
  handle(IpcChannel.DuplicateTemplate, (sourceId) => deps.templates.duplicate(requireTemplateId(sourceId)));
  handle(IpcChannel.SaveTemplate, (template) => {
    const record = requireRecord(template, 'template');
    const saved = deps.templates.save(requireTemplateId(record['id']), record);
    deps.onTemplatesChanged();
    return saved;
  });
  handle(IpcChannel.DeleteTemplate, (id) => {
    const templateId = requireTemplateId(id);
    deps.templates.remove(templateId);
    deps.onTemplatesChanged();
    return deps.settings.current.activeTemplateId === templateId
      ? updateSettings({ activeTemplateId: DEFAULT_TEMPLATE_ID })
      : deps.settings.current;
  });
  handle(IpcChannel.ListLookupTables, () => deps.lookupTables.list());
  handle(IpcChannel.ImportLookupTable, async (replaceId): Promise<LookupImportResult> => {
    const tableId = replaceId === null ? null : requireLookupTableId(replaceId);
    const window = deps.getWindow();
    const options: OpenDialogOptions = {
      title: tableId === null ? '导入查找表' : '用新文件替换查找表',
      filters: [{ name: 'CSV 表格', extensions: ['csv', 'txt'] }],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) {
      return { status: 'canceled' };
    }
    return deps.lookupTables.importFile(path, tableId);
  });
  handle(IpcChannel.DeleteLookupTable, (id) => deps.lookupTables.remove(requireLookupTableId(id)));
  handle(IpcChannel.ListLookupRows, (id) => deps.lookupTables.rows(requireLookupTableId(id)));
  handle(IpcChannel.ListSecrets, () => deps.secrets.names());
  handle(IpcChannel.SetSecret, (name, value) => {
    try {
      const secretValue = requireString(value, 'secret value', SECRET_LIMITS.valueLength);
      deps.secrets.set(requireString(name, 'secret name'), secretValue);
      return { ok: true };
    } catch (error) {
      if (error instanceof SecretError) {
        return { ok: false, issue: error.message };
      }
      throw error;
    }
  });
  handle(IpcChannel.DeleteSecret, (name) => deps.secrets.remove(requireString(name, 'secret name')));
  // 页面的剪贴板权限一律拒绝（security.ts）。复制由主进程代写，而且只写已有密钥的引用：
  // 页面被攻破也不能借这里随时改掉操作员的剪贴板。
  handle(IpcChannel.CopySecretReference, (value) => {
    const name = requireSecretName(value);
    if (!deps.secrets.names().includes(name)) {
      throw new Error('Unknown secret');
    }
    return clipboard.writeText(secretReference(name));
  });
  handle(IpcChannel.ListWebhookDeliveries, () => deps.outbox.recent(RECENT_DELIVERY_COUNT));
  handle(IpcChannel.RetryWebhookDelivery, (id) => deps.outbox.retryNow(requirePositiveInteger(id, 'delivery id')));
  handle(IpcChannel.SendTestWebhook, (endpointId) => deps.outbox.sendTest(requireWebhookId(endpointId)));
  handle(IpcChannel.GetAppInfo, () => deps.appInfo);
  handle(IpcChannel.OpenLogFolder, async () => {
    const error = await shell.openPath(deps.appInfo.logsDir);
    if (error) {
      throw new Error(error);
    }
  });
  // 只打开固定的店铺地址：页面的新窗口和跳转一律被拦截（security.ts），外链只能走这里。
  handle(IpcChannel.OpenShop, () => shell.openExternal(BRAND.shop.url));
  handle(IpcChannel.GetUpdateStatus, () => deps.updater.current);
  handle(IpcChannel.CheckForUpdates, () => deps.updater.check());
  handle(IpcChannel.InstallUpdate, () => deps.updater.install());
  handle(IpcChannel.VoiceClip, (cue) => {
    // 音色和语速取主进程当前设置，不信任页面传入。
    const { name, ratePercent } = deps.settings.current.voice;
    return deps.voice.get(requireVoiceCue(cue), { voice: name, ratePercent });
  });
  handle(IpcChannel.MobileStart, () => deps.mobile.start());
  handle(IpcChannel.MobileStop, () => deps.mobile.stop());
  handle(IpcChannel.MobileStatus, () => deps.mobile.status());
  handle(IpcChannel.MobileRemovePhone, (id) => deps.mobile.removePhone(requireMobilePhoneId(id)));
  handle(IpcChannel.MobileSetJoinLocked, (locked) => deps.mobile.setJoinLocked(requireBoolean(locked, 'locked')));
  handle(IpcChannel.LocalApiStatus, () => deps.localApi.status());
  handle(IpcChannel.ListApiKeys, () => deps.localApi.listKeys());
  // 密钥原文只在这次返回值里出现：不写日志（logFailures 只记错误，不记返回值）。
  handle(IpcChannel.CreateApiKey, (name) => deps.localApi.createKey(requireApiKeyName(name)));
  handle(IpcChannel.RenameApiKey, (id, name) => deps.localApi.renameKey(requireApiKeyId(id), requireApiKeyName(name)));
  handle(IpcChannel.RemoveApiKey, (id) => deps.localApi.removeKey(requireApiKeyId(id)));
  handle(IpcChannel.RevokeApiOrigin, (origin) => deps.localApi.revokeOrigin(requireWebOrigin(origin)));

  on(IpcChannel.WindowMinimize, () => deps.getWindow()?.minimize());
  on(IpcChannel.WindowToggleMaximize, () => {
    const window = deps.getWindow();
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });
  on(IpcChannel.WindowClose, () => deps.getWindow()?.close());
}

/** 预览和实际打印用同一份 HTML：二维码按这张要打到的打印机的分辨率对齐。 */
function renderPreview(result: PreviewResult, { template, isBound }: PrintTemplate, dpi: number): LabelPreview {
  if (result.status !== 'ok') {
    return { result, html: null, templateName: null, isTemplateBound: false, qrOmitted: false, paper: null };
  }
  const { html, qrOmitted } = renderLabelHtml({ scan: result.scan, template, printedAt: Date.now() }, dpi);
  return { result, html, templateName: template.name, isTemplateBound: isBound, qrOmitted, paper: template.paper };
}
