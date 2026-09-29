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
import type { PrintService } from '../core/print-service';
import { SECRET_LIMITS, secretReference } from '../core/scan/enrich-model';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { sanitizeTemplate } from '../core/templates/sanitize-template';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import { CUSTOM_TEMPLATE_PREFIX } from '../core/templates/template-model';
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
import type { AppSettings } from '../shared/settings';
import { logFailures } from './ipc-errors';
import {
  requireBoolean,
  requireJobQuery,
  requireLookupTableId,
  requireMobilePhoneId,
  requirePositiveInteger,
  requirePrintOptions,
  requireRaw,
  requireRecord,
  requireSecretName,
  requireString,
  requireTemplateId,
  requireVoiceCue,
  requireWebhookId,
} from './ipc-validators';
import type { LookupTables } from './lookup/lookup-tables';
import type { MobileStation } from './mobile/mobile-station';
import type { WebhookOutbox } from './notify/webhook-outbox';
import { type PrintTemplate, resolvePrintTemplate } from './print-template';
import { openPrinterPreferences } from './printing/driver-paper';
import type { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { renderLabelHtml } from './printing/label-html';
import type { PrinterProfiles } from './printing/printer-profiles';
import type { PrinterStatusMonitor } from './printing/printer-status';
import { registerRuleIpc } from './scan/rule-ipc';
import type { RuleService } from './scan/rule-service';
import type { SqliteJobStore } from './storage/sqlite-job-store';
import { SecretError, type SqliteSecretStore } from './storage/sqlite-secret-store';
import type { SqliteSettingsStore } from './storage/sqlite-settings-store';
import type { AppUpdater } from './updater';
import type { VoiceClips } from './voice/voice-clips';

const DRAFT_TEMPLATE_ID = `${CUSTOM_TEMPLATE_PREFIX}draft`;

export interface IpcDeps {
  service: PrintService;
  adapter: ElectronDriverAdapter;
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
  /** 每台打印机的驱动纸张和分辨率（短时缓存）。 */
  profiles: PrinterProfiles;
  getWindow: () => BrowserWindow | null;
  onSettingsChanged: (next: AppSettings, previous: AppSettings) => Promise<void>;
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
  const scanOf = (result: PreviewResult) => (result.status === 'ok' ? result.scan : null);
  const printTemplateFor = (result: PreviewResult) =>
    resolvePrintTemplate(deps.templates, deps.settings.current, scanOf(result));
  const updateSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const previous = deps.settings.current;
    const next = deps.settings.update(patch);
    await deps.onSettingsChanged(next, previous);
    return next;
  };

  handle(IpcChannel.Preview, async (raw) => {
    const result = await deps.service.preview(requireRaw(raw));
    return renderPreview(result, printTemplateFor(result));
  });
  handle(IpcChannel.PreviewTemplate, async (raw, template) => {
    const result = await deps.service.preview(requireRaw(raw));
    const fallback = printTemplateFor(result).template;
    const draft = sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, fallback);
    // 模板页指定了要看的模板，不是规则选的。
    return renderPreview(result, { template: draft, isBound: false });
  });
  handle(IpcChannel.Print, (raw, printerName, options) =>
    deps.service.submit({
      raw: requireRaw(raw),
      printerName: requireString(printerName, 'printerName'),
      ...requirePrintOptions(options),
    }),
  );
  handle(IpcChannel.PrintTest, (printerName) => deps.service.printTest(requireString(printerName, 'printerName')));
  handle(IpcChannel.ListPrinters, () => deps.adapter.listPrinters());
  handle(IpcChannel.PrinterStatus, (printerName) => deps.status.get(requireString(printerName, 'printerName')));
  handle(IpcChannel.CheckDriverPaper, async (printerName) =>
    checkDriverPaper(await deps.profiles.get(await requireKnownPrinter(printerName))),
  );
  handle(IpcChannel.OpenPrinterPreferences, async (printerName) => {
    const name = await requireKnownPrinter(printerName);
    await openPrinterPreferences(name);
    // 操作员可能刚改了纸张：界面随后重新检查时要读到新的设置。
    deps.profiles.forget(name);
  });
  handle(IpcChannel.ListJobs, (query) => deps.jobs.listPage(requireJobQuery(query)));
  handle(IpcChannel.GetSettings, () => deps.settings.current);
  handle(IpcChannel.UpdateSettings, (patch) => updateSettings(requireRecord(patch, 'settings patch')));
  handle(IpcChannel.ListTemplates, () => deps.templates.list());
  handle(IpcChannel.DuplicateTemplate, (sourceId) => deps.templates.duplicate(requireTemplateId(sourceId)));
  handle(IpcChannel.SaveTemplate, (template) => {
    const record = requireRecord(template, 'template');
    return deps.templates.save(requireTemplateId(record['id']), record);
  });
  handle(IpcChannel.DeleteTemplate, (id) => {
    const templateId = requireTemplateId(id);
    deps.templates.remove(templateId);
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

function renderPreview(result: PreviewResult, { template, isBound }: PrintTemplate): LabelPreview {
  if (result.status !== 'ok') {
    return { result, html: null, templateName: null, isTemplateBound: false, qrOmitted: false };
  }
  const { html, qrOmitted } = renderLabelHtml({ scan: result.scan, template, printedAt: Date.now() });
  return { result, html, templateName: template.name, isTemplateBound: isBound, qrOmitted };
}
