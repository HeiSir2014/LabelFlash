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
import { storedTemplateIssue } from '../core/api/template-fields';
import { BATCH_LIMITS } from '../core/batch/batch-model';
import { PDF_LIMITS, PDF_PIECE_RETENTION_MS } from '../core/pdf/pdf-model';
import { pieceTemplate } from '../core/pdf/piece-template';
import { fieldsRuleFor, fieldsScan, type PrintService } from '../core/print-service';
import type { PrinterChoice } from '../core/printing/resolve-printer';
import { SECRET_LIMITS, secretReference } from '../core/scan/enrich-model';
import type { ScanResult } from '../core/scan/scan-result';
import { DEFAULT_TEMPLATE_ID, GENERIC_TEMPLATE } from '../core/templates/builtin-templates';
import { WAYBILL_SAMPLE_FIELDS } from '../core/templates/builtin-waybills';
import { type LibrarySample, librarySampleScan } from '../core/templates/library/library-model';
import { findLibraryEntry, TEMPLATE_LIBRARY } from '../core/templates/library/template-library';
import { sanitizeTemplate } from '../core/templates/sanitize-template';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import { CUSTOM_TEMPLATE_PREFIX, type LabelTemplate } from '../core/templates/template-model';
import type { JobRecord, PdfRef, PreviewResult } from '../core/types';
import type { BatchTableResult } from '../shared/batch';
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
import type { PdfOpenResult } from '../shared/pdf';
import { NO_RENDER_WARNINGS } from '../shared/render-warnings';
import type { AppSettings } from '../shared/settings';
import type { LocalApi } from './api/local-api';
import { BATCH_BLOCKS_UPDATE_ISSUE } from './batch/batch-quit';
import type { BatchStation } from './batch/batch-station';
import type { DiagnosisStation } from './diagnosis/diagnosis-station';
import type { DriverStation } from './drivers/driver-station';
import { logFailures } from './ipc-errors';
import {
  driverInstallBlocksUpdate,
  requireApiKeyId,
  requireApiKeyName,
  requireBatchId,
  requireBatchPlan,
  requireBoolean,
  requireBytes,
  requireDiagnosisCheck,
  requireDiagnosisFixRequest,
  requireDriverDeviceKey,
  requireIndex,
  requireIPv4Address,
  requireJobQuery,
  requireLibraryTemplateId,
  requireLookupTableId,
  requireMobilePhoneId,
  requireNullablePrinterName,
  requirePaperKey,
  requirePdfLayout,
  requirePdfPrintRequest,
  requirePieceId,
  requirePositiveInteger,
  requirePrinterAction,
  requirePrinterCommandConfig,
  requirePrintOptions,
  requireRaw,
  requireRecord,
  requireRunId,
  requireSecretName,
  requireSettingsPatch,
  requireSharePassword,
  requireString,
  requireTemplateId,
  requireUnsavedTemplateName,
  requireVoiceCue,
  requireWebhookId,
  requireWebOrigin,
} from './ipc-validators';
import { ippBlocksUpdate } from './ipp/ipp-quit';
import type { IppSharing } from './ipp/ipp-sharing';
import type { LookupTables } from './lookup/lookup-tables';
import type { MobileStation } from './mobile/mobile-station';
import type { WebhookOutbox } from './notify/webhook-outbox';
import { PDF_BLOCKS_UPDATE_ISSUE } from './pdf/pdf-quit';
import type { PdfStation } from './pdf/pdf-station';
import { type PrintTemplate, resolvePrintTemplate } from './print-template';
import { openPrinterPreferences } from './printing/driver-paper';
import { renderLabelHtml } from './printing/label-html';
import { renderLibraryPreviews } from './printing/library-previews';
import type { PrinterCommands } from './printing/printer-commands-station';
import type { PrinterDriver } from './printing/printer-driver';
import type { PrinterProfiles } from './printing/printer-profiles';
import type { PrinterStatusMonitor } from './printing/printer-status';
import { DEFAULT_PRINTER_DPI } from './printing/qr-code';
import { registerRuleIpc } from './scan/rule-ipc';
import type { RuleService } from './scan/rule-service';
import type { SqliteJobStore } from './storage/sqlite-job-store';
import { SecretError, type SqliteSecretStore } from './storage/sqlite-secret-store';
import type { SqliteSettingsStore } from './storage/sqlite-settings-store';
import type { TemplateQuitGuard } from './template-quit';
import type { AppUpdater } from './updater';
import type { VoiceClips } from './voice/voice-clips';

const DRAFT_TEMPLATE_ID = `${CUSTOM_TEMPLATE_PREFIX}draft`;

/** 预览面单模板用的示例数据（内容就叫「示例面单」，打印记录里不会出现：预览不打印）。 */
function waybillSampleScan(): ScanResult {
  return fieldsScan('示例面单', [...WAYBILL_SAMPLE_FIELDS]);
}
/** 打印记录编号是 UUID（36 个字符）；留出余量，挡住异常长的参数。 */
const MAX_JOB_ID_LENGTH = 64;
/** 拖进来的文件名：Windows 的路径上限是 260，文件名只会更短。 */
const MAX_FILE_NAME_LENGTH = 260;

/** 已校验的纸张键 → 纸张（requirePaperKey 保证能解析，兜底只为类型）。 */
function paperOf(key: string): PaperSize {
  return parsePaperKey(key) ?? DEFAULT_PAPER;
}

export interface IpcDeps {
  service: PrintService;
  adapter: PrinterDriver;
  /** 批量打印：读表格、预览、检查、开打。 */
  batch: BatchStation;
  /** PDF 打印：打开、出块、预览、打印；打印记录的预览、重打读它缓存的位图。 */
  pdf: PdfStation;
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
  /** 局域网共享（IPP）。 */
  ippSharing: IppSharing;
  /** 驱动安装（打印机页的「驱动」一节）。 */
  drivers: DriverStation;
  /** 打印机的驱动名（按驱动名查清单）。 */
  driverNameOf: (printerName: string) => Promise<string | null>;
  /** 每台打印机的驱动纸张和分辨率（短时缓存）。 */
  profiles: PrinterProfiles;
  /** 打印机页的「诊断」。 */
  diagnosis: DiagnosisStation;
  /** 标签机指令（printing/printer-commands-station.ts）。 */
  printerCommands: PrinterCommands;
  getWindow: () => BrowserWindow | null;
  onSettingsChanged: (next: AppSettings, previous: AppSettings) => Promise<void>;
  /** 模板保存或删除之后：模板指定的打印机可能变了，要检测的打印机跟着变。 */
  onTemplatesChanged: () => void;
  /** 这个模板用哪台打印机（和打印时同一个规则）：模板页预览草稿时用。 */
  choosePrinter: (template: LabelTemplate) => Promise<PrinterChoice>;
  /** 退出时没保存的模板：界面报告的状态、保存的往返。 */
  templateQuit: TemplateQuitGuard;
  /** 「重启更新」之前：有没保存的模板就先问；返回 false 表示操作员选了取消，不装。 */
  confirmBeforeInstall: () => Promise<boolean>;
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
  const on = (channel: string, listener: (...args: unknown[]) => void) => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      if (!isTrusted(event)) {
        console.warn(`[ipc] ignored ${channel} from an untrusted sender: ${event.senderFrame?.url ?? 'unknown frame'}`);
        return;
      }
      // 单向消息没有返回值可以把错误带回界面：参数校验不过就写日志，不抛到 ipcMain 里。
      try {
        listener(...args);
      } catch (error) {
        console.error(`[ipc] ${channel} failed`, error);
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
  const jobOf = (value: unknown): JobRecord => {
    const jobId = requireString(value, 'jobId', MAX_JOB_ID_LENGTH);
    const job = deps.jobs.get(jobId);
    if (job === null) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return job;
  };
  /**
   * 按原样重打要用的模板和字段（本机接口、批量打印的记录）。界面按 reprintMode 只对能重打的记录显示按钮，
   * 这里再遇到缺东西（刚好被环形保留删掉、模板刚被删）就报错，由界面提示。
   */
  const storedLabelOf = (job: JobRecord) => {
    if (job.templateId === undefined || job.fields === undefined) {
      throw new Error(`Job ${job.id} has no stored template or fields`);
    }
    const template = deps.templates.get(job.templateId);
    if (template === null) {
      throw new Error(`Template of job ${job.id} was deleted: ${job.templateId}`);
    }
    // 编号没变、字段或纸张改过的模板，不能拿来按旧样子重打（界面按同一个判断不显示按钮）。
    const issue = storedTemplateIssue(template, job.templateFingerprint);
    if (issue !== null) {
      throw new Error(`${issue}（记录 ${job.id}，模板 ${job.templateId}）`);
    }
    return { template, fields: job.fields };
  };
  /**
   * PDF 打印的记录：模板用缓存的黑白位图临时包出来。界面只对保留期内的记录显示按钮；
   * 位图已被清理（刚好过期）就报错，由界面提示。
   */
  const pdfLabelOf = async (job: JobRecord, pdf: PdfRef) => {
    const paper = job.paper === undefined ? null : parsePaperKey(job.paper);
    if (paper === null) {
      throw new Error(`PDF job ${job.id} has no paper`);
    }
    const bitmap = await deps.pdf.storedPiece(pdf.bitmap);
    if (bitmap === null) {
      throw new Error(`The bitmap of PDF job ${job.id} is gone (kept ${PDF_PIECE_RETENTION_MS}ms): ${pdf.bitmap}`);
    }
    return { template: pieceTemplate(bitmap, paper), fields: job.fields ?? [] };
  };
  const labelOf = (job: JobRecord) =>
    job.pdf === undefined ? Promise.resolve(storedLabelOf(job)) : pdfLabelOf(job, job.pdf);
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
  /**
   * 预览、试打用模板库的示例数据：页面只交模板库的编号（不能交任意字段），示例数据由主进程按编号取。
   * 没交（null / undefined）就按预览内容识别；编号不对就报错。
   */
  const librarySampleOf = (value: unknown): LibrarySample | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const id = requireLibraryTemplateId(value);
    const entry = findLibraryEntry(id);
    if (entry === null) {
      throw new Error(`Library template not found: ${id}`);
    }
    return entry.sample;
  };
  handle(IpcChannel.PreviewTemplate, async (raw, template, librarySampleId) => {
    const content = requireRaw(raw);
    const input = requireRecord(template, 'template');
    const librarySample = librarySampleOf(librarySampleId);
    // 面单设计时看的是排版：用示例面单数据预览，不识别、不加工预览内容（加工步骤可能要发 HTTP 查询，结果也用不上）；
    // 从模板库复制出的模板同理，先看它自己的示例数据。模板页指定了要看的模板，不是规则选的；打印机也按这个模板重新决定。
    if (input['kind'] === 'waybill' || librarySample !== null) {
      const draft = sanitizeTemplate(input, DRAFT_TEMPLATE_ID, GENERIC_TEMPLATE);
      const printer = await deps.choosePrinter(draft);
      const sample: PreviewResult = {
        status: 'ok',
        scan: librarySample === null ? waybillSampleScan() : librarySampleScan(librarySample),
        recent: null,
        lookupFailure: null,
        printer,
      };
      return renderPreview(sample, { template: draft, isBound: false }, await dpiFor(sample));
    }
    const result = await deps.service.preview(content);
    const draft = sanitizeTemplate(input, DRAFT_TEMPLATE_ID, printTemplateFor(result).template);
    const printer = await deps.choosePrinter(draft);
    const forDraft: PreviewResult = result.status === 'ok' ? { ...result, printer } : result;
    return renderPreview(forDraft, { template: draft, isBound: false }, await dpiFor(forDraft));
  });
  handle(IpcChannel.Print, (raw, options) =>
    deps.service.submit({ raw: requireRaw(raw), ...requirePrintOptions(options) }),
  );
  // 「打印一张试试」：草稿和预览一样先校验（不可信的输入）；按钮只在设计器里有，只接受自由设计模板（最小权限）。
  handle(IpcChannel.PrintSample, (raw, template, librarySampleId) => {
    const draft = sanitizeTemplate(requireRecord(template, 'template'), DRAFT_TEMPLATE_ID, GENERIC_TEMPLATE);
    if (draft.kind !== 'canvas') {
      throw new Error(`label:print-sample only accepts canvas templates, got kind "${draft.kind}"`);
    }
    return deps.service.printSample(requireRaw(raw), draft, librarySampleOf(librarySampleId));
  });
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
  // 打印机名在 DiagnosisStation 里核对（不在系统列表里的不交给系统命令）；这里只核对形状。
  handle(IpcChannel.DiagnosisCheck, (printerName, check) =>
    deps.diagnosis.check(requireNullablePrinterName(printerName), requireDiagnosisCheck(check)),
  );
  handle(IpcChannel.DiagnosisFix, (request) => deps.diagnosis.fix(requireDiagnosisFixRequest(request)));
  // 先做不用等系统的校验，再核对打印机在系统列表里（只发给系统里有的打印机）。
  handle(IpcChannel.PrinterCommands, async (printerName) =>
    deps.printerCommands.describe(await requireKnownPrinter(printerName)),
  );
  handle(IpcChannel.ApplyPrinterCommands, async (printerName, config) => {
    const parsed = requirePrinterCommandConfig(config);
    return deps.printerCommands.apply(await requireKnownPrinter(printerName), parsed);
  });
  handle(IpcChannel.RunPrinterAction, async (printerName, action) => {
    const parsed = requirePrinterAction(action);
    return deps.printerCommands.run(await requireKnownPrinter(printerName), parsed);
  });
  handle(IpcChannel.ListJobs, (query) => deps.jobs.listPage(requireJobQuery(query)));
  handle(IpcChannel.PreviewJob, async (jobId) => {
    const job = jobOf(jobId);
    const { template, fields } = await labelOf(job);
    const result: PreviewResult = {
      status: 'ok',
      scan: fieldsScan(job.raw, fields, fieldsRuleFor(job)),
      recent: null,
      lookupFailure: null,
      printer: await deps.choosePrinter(template),
    };
    const preview = renderPreview(result, { template, isBound: false }, await dpiFor(result));
    // PDF 的一块铺满整张纸：自由设计的「靠近纸边」检查对它没有意义，预览上不显示。
    return job.pdf === undefined ? preview : { ...preview, warnings: NO_RENDER_WARNINGS };
  });
  handle(IpcChannel.ReprintJob, async (jobId) => {
    const job = jobOf(jobId);
    const { template, fields } = await labelOf(job);
    return deps.service.printFields({
      template,
      fields,
      content: job.raw,
      source: 'history',
      caller: job.caller ?? null,
      printerName: null,
      // 批量打的重打后还算这一批的这一行这一份（重打成功的不再算失败）；PDF 的重打指着同一张位图；
      // 局域网共享打来的重打后仍记着原来的电脑和用户（显示为「原提交」）。
      ...(job.batch === undefined ? {} : { batch: job.batch }),
      ...(job.pdf === undefined ? {} : { pdf: job.pdf }),
      ...(job.ipp === undefined ? {} : { ipp: job.ipp }),
    });
  });
  handle(IpcChannel.GetSettings, () => deps.settings.current);
  handle(IpcChannel.UpdateSettings, (patch) => updateSettings(requireSettingsPatch(patch)));
  handle(IpcChannel.ListTemplates, () => deps.templates.list());
  handle(IpcChannel.DuplicateTemplate, (sourceId) => deps.templates.duplicate(requireTemplateId(sourceId)));
  // 没有参数：主进程自己建空白模板，页面传不进任何内容（新通道只给最小能力）。
  handle(IpcChannel.CreateCanvasTemplate, () => deps.templates.createCanvas());
  // 模板库的缩略图：主进程按示例数据现排（和打印同一份 HTML），页面只拿到结果。
  handle(IpcChannel.ListTemplateLibrary, () => renderLibraryPreviews(TEMPLATE_LIBRARY, Date.now()));
  // 只收模板库的编号：复制什么由主进程决定，页面交不进模板内容（新通道只给最小能力）。
  handle(IpcChannel.CreateTemplateFromLibrary, (libraryId) =>
    deps.templates.createFromLibrary(requireLibraryTemplateId(libraryId)),
  );
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
  handle(IpcChannel.InstallUpdate, async () => {
    // quitAndInstall 会在任何确认之前就把安装程序拉起来：不像正常退出能先弹确认框，批量打印、PDF
    // 还在打或暂停中、或者正在装驱动时只能直接拒绝，让操作员自己先打完 / 取消，或者等驱动装完。
    const driverIssue = driverInstallBlocksUpdate(deps.drivers.isInstalling);
    if (driverIssue !== null) {
      return { status: 'refused', issue: driverIssue } as const;
    }
    if (deps.batch.pendingQuit() !== null) {
      return { status: 'refused', issue: BATCH_BLOCKS_UPDATE_ISSUE } as const;
    }
    if (deps.pdf.pendingQuit() !== null) {
      return { status: 'refused', issue: PDF_BLOCKS_UPDATE_ISSUE } as const;
    }
    // 局域网共享还有别的电脑交来、没打完的任务：重启会丢掉它们，同样先拒绝。
    const ippIssue = ippBlocksUpdate(deps.ippSharing.pendingJobs);
    if (ippIssue !== null) {
      return { status: 'refused', issue: ippIssue } as const;
    }
    // 没保存的模板：同样因为安装程序先于退出确认，得在装之前问；选了取消就什么也不做，程序照常用。
    if (!(await deps.confirmBeforeInstall())) {
      return { status: 'canceled' } as const;
    }
    deps.updater.install('front');
    return { status: 'ok' } as const;
  });
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
  // 界面不能写剪贴板：刚生成的密钥由主进程复制，原文不经过界面再传一次。
  handle(IpcChannel.CopyNewApiKey, (id) => {
    const secret = deps.localApi.freshSecret(requireApiKeyId(id));
    if (secret === null) {
      return false;
    }
    clipboard.writeText(secret);
    return true;
  });
  handle(IpcChannel.RevokeApiOrigin, (origin) => deps.localApi.revokeOrigin(requireWebOrigin(origin)));
  handle(IpcChannel.DecideApiOrigin, (origin, allow) =>
    deps.localApi.decideOrigin(requireWebOrigin(origin), requireBoolean(allow, 'allow')),
  );
  handle(IpcChannel.FirewallStatus, () => deps.localApi.checkFirewall());
  handle(IpcChannel.AddFirewallRule, () => deps.localApi.addFirewallRule());
  // 局域网共享：只给状态、共享密码、允许 / 拒绝、撤销和防火墙按钮（最小能力）；密码原文不写日志（logFailures 只记错误）。
  handle(IpcChannel.IppStatus, () => deps.ippSharing.status());
  handle(IpcChannel.IppSetPassword, (password) => deps.ippSharing.setPassword(requireSharePassword(password)));
  handle(IpcChannel.IppClearPassword, () => deps.ippSharing.clearPassword());
  handle(IpcChannel.IppDecideClient, (address, allow) =>
    deps.ippSharing.decideClient(requireIPv4Address(address), requireBoolean(allow, 'allow')),
  );
  handle(IpcChannel.IppForgetClient, (address) => deps.ippSharing.forgetClient(requireIPv4Address(address)));
  handle(IpcChannel.IppAddFirewallRule, () => deps.ippSharing.addFirewallRule());
  handle(IpcChannel.GetDriverStatus, () => deps.drivers.status());
  handle(IpcChannel.DetectDrivers, (force) => deps.drivers.detect(requireBoolean(force, 'force')));
  handle(IpcChannel.InstallDriver, (deviceKey) => deps.drivers.install(requireDriverDeviceKey(deviceKey)));
  handle(IpcChannel.CancelDriverInstall, () => deps.drivers.cancelInstall());
  handle(IpcChannel.OpenDriverDownloadPage, (deviceKey) =>
    deps.drivers.openDownloadPage(requireDriverDeviceKey(deviceKey)),
  );
  handle(IpcChannel.ReinstallPrinterDriver, async (printerName) => {
    const name = await requireKnownPrinter(printerName);
    const driverName = await deps.driverNameOf(name);
    if (driverName === null) {
      throw new Error(`Cannot read the driver name of ${name}`);
    }
    return deps.drivers.installForDriverName(driverName);
  });

  handle(IpcChannel.BatchOpenFile, async (): Promise<BatchTableResult> => {
    const window = deps.getWindow();
    const options: OpenDialogOptions = {
      title: '导入要批量打印的表格',
      // 列出 .xls：选了它会得到「另存为 .xlsx 或 CSV」的提示，比在对话框里找不到文件更好懂。
      filters: [{ name: 'Excel 或 CSV 表格', extensions: ['xlsx', 'csv', 'xls'] }],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) {
      return { status: 'canceled' };
    }
    return deps.batch.loadPath(path);
  });
  handle(IpcChannel.BatchReadDropped, (name, bytes) =>
    deps.batch.loadBytes(
      requireString(name, 'file name', MAX_FILE_NAME_LENGTH),
      requireBytes(bytes, 'file', BATCH_LIMITS.fileBytes),
    ),
  );
  handle(IpcChannel.BatchPaste, (text) =>
    deps.batch.paste(requireString(text, 'pasted table', BATCH_LIMITS.pasteChars)),
  );
  handle(IpcChannel.BatchPreview, (plan, rowIndex) =>
    deps.batch.preview(requireBatchPlan(plan), requireIndex(rowIndex, 'row index')),
  );
  handle(IpcChannel.BatchCheck, (plan) => deps.batch.check(requireBatchPlan(plan)));
  handle(IpcChannel.BatchStart, (plan) => deps.batch.start(requireBatchPlan(plan)));
  handle(IpcChannel.BatchPause, () => deps.batch.pause());
  handle(IpcChannel.BatchResume, () => deps.batch.resume());
  handle(IpcChannel.BatchCancel, () => deps.batch.cancel());
  handle(IpcChannel.BatchRetryFailed, (batchId, row) =>
    deps.batch.retryFailed(requireBatchId(batchId), row === null ? null : requirePositiveInteger(row, 'row')),
  );
  handle(IpcChannel.BatchStatus, () => deps.batch.status());

  handle(IpcChannel.PdfOpenFile, async (): Promise<PdfOpenResult> => {
    const window = deps.getWindow();
    const options: OpenDialogOptions = {
      title: '选择要打印的 PDF',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) {
      return { status: 'canceled' };
    }
    return deps.pdf.loadPath(path);
  });
  // 拖进来的文件只收字节，不收路径：页面给不了主进程任何路径。超过上限的界面会先拦下并说明，这里只兜底。
  handle(IpcChannel.PdfReadDropped, (name, bytes) =>
    deps.pdf.loadBytes(
      requireString(name, 'file name', MAX_FILE_NAME_LENGTH),
      requireBytes(bytes, 'PDF file', PDF_LIMITS.fileBytes),
    ),
  );
  handle(IpcChannel.PdfLayout, (layout) => deps.pdf.layout(requirePdfLayout(layout)));
  handle(IpcChannel.PdfPreviewPiece, (runId, pieceId) =>
    deps.pdf.previewPiece(requireRunId(runId), requirePieceId(pieceId)),
  );
  handle(IpcChannel.PdfPrint, (request) => deps.pdf.print(requirePdfPrintRequest(request)));
  handle(IpcChannel.PdfPause, () => deps.pdf.pause());
  handle(IpcChannel.PdfResume, () => deps.pdf.resume());
  handle(IpcChannel.PdfCancel, () => deps.pdf.cancel());
  handle(IpcChannel.PdfClose, () => deps.pdf.closeDocument());
  handle(IpcChannel.PdfStatus, () => deps.pdf.status());

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
  // 退出时没保存的模板（template-quit.ts）：界面报告有没有、回答保存结果。
  on(IpcChannel.TemplateUnsavedChanged, (name) => deps.templateQuit.setUnsaved(requireUnsavedTemplateName(name)));
  on(IpcChannel.TemplateSavedForQuit, (saved) => deps.templateQuit.saved(requireBoolean(saved, 'saved')));
}

/** 预览和实际打印用同一份 HTML：二维码按这张要打到的打印机的分辨率对齐。 */
function renderPreview(result: PreviewResult, { template, isBound }: PrintTemplate, dpi: number): LabelPreview {
  if (result.status !== 'ok') {
    return {
      result,
      html: null,
      templateId: null,
      templateName: null,
      isTemplateBound: false,
      warnings: NO_RENDER_WARNINGS,
      paper: null,
    };
  }
  // diagnostics 是条码库的原始英文错误，写打印日志用；预览每次扫码、每次改模板都会重新渲染一次，
  // 这里只取界面要显示的 warnings，diagnostics 留在原地不传给界面（渲染器收不到，也就不会在预览上露出来）。
  const {
    html,
    diagnostics: _diagnostics,
    ...warnings
  } = renderLabelHtml({ scan: result.scan, template, printedAt: Date.now() }, dpi);
  return {
    result,
    html,
    templateId: template.id,
    templateName: template.name,
    isTemplateBound: isBound,
    warnings,
    paper: template.paper,
  };
}
