import { dirname } from 'node:path';
import { type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, shell } from 'electron';
import type { PrintService } from '../core/print-service';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { sanitizeTemplate } from '../core/templates/sanitize-template';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import { CUSTOM_TEMPLATE_PREFIX, type LabelTemplate } from '../core/templates/template-model';
import type { PreviewResult } from '../core/types';
import { checkDriverPaper } from '../shared/driver-paper';
import { type AppInfo, IpcChannel, type LabelPreview } from '../shared/ipc-contract';
import type { AppSettings } from '../shared/settings';
import { logFailures } from './ipc-errors';
import {
  requireJobQuery,
  requirePrintOptions,
  requireRecord,
  requireString,
  requireTemplateId,
  requireVoiceCue,
} from './ipc-validators';
import { resolvePrintTemplate } from './print-template';
import { openPrinterPreferences, queryDriverPaper } from './printing/driver-paper';
import type { ElectronDriverAdapter } from './printing/electron-driver-adapter';
import { renderLabelHtml } from './printing/label-html';
import type { PrinterStatusMonitor } from './printing/printer-status';
import type { SqliteJobStore } from './storage/sqlite-job-store';
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
  status: PrinterStatusMonitor;
  appInfo: AppInfo;
  updater: AppUpdater;
  voice: VoiceClips;
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
  const requireKnownPrinter = async (value: unknown): Promise<string> => {
    const printerName = requireString(value, 'printerName');
    if (!(await deps.adapter.hasPrinter(printerName))) {
      throw new Error(`Printer not found: ${printerName}`);
    }
    return printerName;
  };
  const activeTemplate = () => resolvePrintTemplate(deps.templates, deps.settings.current);
  const updateSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const previous = deps.settings.current;
    const next = deps.settings.update(patch);
    await deps.onSettingsChanged(next, previous);
    return next;
  };

  handle(IpcChannel.Preview, (raw) => renderPreview(deps.service.preview(requireString(raw, 'raw')), activeTemplate()));
  handle(IpcChannel.PreviewTemplate, (raw, template) => {
    const draft = sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, activeTemplate());
    return renderPreview(deps.service.preview(requireString(raw, 'raw')), draft);
  });
  handle(IpcChannel.Print, (raw, printerName, options) =>
    deps.service.submit({
      raw: requireString(raw, 'raw'),
      printerName: requireString(printerName, 'printerName'),
      ...requirePrintOptions(options),
    }),
  );
  handle(IpcChannel.PrintTest, (printerName) => deps.service.printTest(requireString(printerName, 'printerName')));
  handle(IpcChannel.ListPrinters, () => deps.adapter.listPrinters());
  handle(IpcChannel.PrinterStatus, (printerName) => deps.status.get(requireString(printerName, 'printerName')));
  handle(IpcChannel.CheckDriverPaper, async (printerName) =>
    checkDriverPaper(await queryDriverPaper(await requireKnownPrinter(printerName))),
  );
  handle(IpcChannel.OpenPrinterPreferences, async (printerName) =>
    openPrinterPreferences(await requireKnownPrinter(printerName)),
  );
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
  handle(IpcChannel.GetAppInfo, () => deps.appInfo);
  handle(IpcChannel.OpenLogFolder, async () => {
    const error = await shell.openPath(dirname(deps.appInfo.logPath));
    if (error) {
      throw new Error(error);
    }
  });
  handle(IpcChannel.GetUpdateStatus, () => deps.updater.current);
  handle(IpcChannel.CheckForUpdates, () => deps.updater.check());
  handle(IpcChannel.InstallUpdate, () => deps.updater.install());
  handle(IpcChannel.VoiceClip, (cue) => {
    // 音色和语速取主进程当前设置，不信任页面传入。
    const { name, ratePercent } = deps.settings.current.voice;
    return deps.voice.get(requireVoiceCue(cue), { voice: name, ratePercent });
  });

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

async function renderPreview(result: PreviewResult, template: LabelTemplate): Promise<LabelPreview> {
  if (result.status !== 'ok') {
    return { result, html: null };
  }
  return { result, html: await renderLabelHtml({ label: result.label, template, printedAt: Date.now() }) };
}
