import { useCallback, useEffect, useMemo, useRef } from 'react';
import { applyNoteOverride } from '../../core/templates/note-override';
import type { JobRecord } from '../../core/types';
import { DEFAULT_PAPER } from '../../shared/label-paper';
import { parsePaperKey } from '../../shared/paper-sizes';
import { describePrintersSummary } from '../../shared/printer-summary';
import { NO_RENDER_WARNINGS } from '../../shared/render-warnings';
import { SAMPLE_LABEL_RAW } from '../../shared/sample-label';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { BatchPage } from './components/batch/BatchPage';
import { ConfigCenter } from './components/config/ConfigCenter';
import { ConfigPages } from './components/config/ConfigPages';
import { ConfirmDialog } from './components/config/ConfirmDialog';
import { JobLog } from './components/JobLog';
import { MOBILE_QR_SIZE_PX, MobileOverlay } from './components/MobileOverlay';
import { NoticeBar } from './components/NoticeBar';
import { OriginRequests } from './components/OriginRequests';
import type { PreviewOverride } from './components/PreviewStage';
import { PrinterList } from './components/PrinterList';
import { PdfPage } from './components/pdf/PdfPage';
import { TitleBar } from './components/TitleBar';
import { PreviewToolbar } from './components/workbench/PreviewToolbar';
import { Workbench } from './components/workbench/Workbench';
import { configShortcutLabel, platformForChrome } from './lib/app-view';
import { batchButtonProgress } from './lib/batch-view';
import { describeCaller } from './lib/local-api-text';
import { describeMobileButton, describeMobileOverlay } from './lib/mobile-text';
import { buildNoteOptions, resolveNoteSelection } from './lib/note-options';
import { reportError } from './lib/notices';
import { isPdfFileName, paperOptions, pdfButtonProgress } from './lib/pdf-view';
import { describePreviewUsage } from './lib/preview-usage';
import {
  expectedPaperKey,
  paperRows,
  responsibilitiesOf,
  templateUses,
  withAssignment,
} from './lib/printer-assignment';
import { reprintMode } from './lib/reprint';
import { scanFieldType } from './lib/scan-field';
import { isWorkbenchActive } from './lib/scan-routing';
import { describeScan } from './lib/status-text';
import { describeUpdate } from './lib/update-text';
import { useAppInfo } from './view-models/use-app-info';
import { useBatch } from './view-models/use-batch';
import { useConfigCenter } from './view-models/use-config-center';
import { useFeedback } from './view-models/use-feedback';
import { useFileDrop } from './view-models/use-file-drop';
import { useHotkey } from './view-models/use-hotkey';
import { useJobLog } from './view-models/use-job-log';
import { useLocalApi } from './view-models/use-local-api';
import { useMediaQuery } from './view-models/use-media-query';
import { useMobileStation } from './view-models/use-mobile-station';
import { useNotices } from './view-models/use-notices';
import { usePdf } from './view-models/use-pdf';
import { usePrinterCommands } from './view-models/use-printer-commands';
import { usePrinterProfiles } from './view-models/use-printer-profiles';
import { usePrinters } from './view-models/use-printers';
import { useQrImage } from './view-models/use-qr-image';
import { useRules } from './view-models/use-rules';
import { type HistoryTarget, useScanStation } from './view-models/use-scan-station';
import { useSettings } from './view-models/use-settings';
import { useTemplatePreview } from './view-models/use-template-preview';
import { useTemplates } from './view-models/use-templates';
import { useUpdateStatus } from './view-models/use-update-status';
import { windowChrome } from './view-models/use-window-controls';

/** 与 app.css 里编辑视图改成上下排列的断点一致。 */
const NARROW_QUERY = '(max-width: 1099px)';

export function App() {
  const { settings, hasLoadError, reload, update, replace } = useSettings();
  const printers = usePrinters();
  const jobLog = useJobLog();
  const localApi = useLocalApi();
  const appInfo = useAppInfo();
  const { notices, dismiss } = useNotices();
  const updates = useUpdateStatus();
  const updateView = describeUpdate(updates.status);
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const platform = platformForChrome(windowChrome());
  const fieldType = scanFieldType(platform);

  const autoPrint = settings?.autoPrint ?? DEFAULT_SETTINGS.autoPrint;
  const historyLimit = settings?.historyLimit ?? DEFAULT_SETTINGS.historyLimit;

  // 打到哪台、能不能打由主进程按模板决定（没有打印机时返回 no-printer，找不到打印机返回 PRINTER_NOT_FOUND）。
  const feedback = useFeedback(settings?.voice ?? DEFAULT_SETTINGS.voice);
  const station = useScanStation({
    autoPrint,
    onJobRecorded: jobLog.refresh,
    announce: feedback.announce,
  });
  const templates = useTemplates({
    activeTemplateId: settings?.activeTemplateId ?? null,
    updateSettings: update,
    replaceSettings: replace,
    onActiveTemplateChanged: () => void station.refreshPreview(),
  });
  // 打印记录的预览、重打：本机接口的记录按当时的模板和字段（模板删了就不能按原样重打）。
  const reprintModeOf = useCallback(
    (job: JobRecord) =>
      reprintMode(job, (id) => templates.templates.some((template) => template.id === id), Date.now()),
    [templates.templates],
  );
  const historyTarget = useCallback(
    (job: JobRecord): HistoryTarget => ({ raw: job.raw, jobId: reprintModeOf(job) === 'stored' ? job.id : null }),
    [reprintModeOf],
  );
  // 打印机：按纸张分配，模板也可以自己指定（规则见 src/core/printing/resolve-printer.ts）。
  const paperPrinters = settings?.paperPrinters ?? DEFAULT_SETTINGS.paperPrinters;
  const installedNames = useMemo(() => printers.printers.map((printer) => printer.name), [printers.printers]);
  /** 被分配到的打印机（纸张分配和模板指定里出现的）：标题栏汇总它们，主进程检测它们的状态。 */
  const assignedNames = useMemo(
    () => [
      ...new Set([
        ...Object.values(paperPrinters),
        ...templates.templates.flatMap((template) => (template.printer ? [template.printer] : [])),
      ]),
    ],
    [paperPrinters, templates.templates],
  );
  const responsibilitiesByName = useCallback(
    (name: string) => responsibilitiesOf(name, templates.templates, paperPrinters),
    [templates.templates, paperPrinters],
  );
  const expectedPapers = useMemo(
    () =>
      Object.fromEntries(
        installedNames.flatMap((name) => {
          const key = expectedPaperKey(responsibilitiesByName(name));
          return key === null ? [] : [[name, key]];
        }),
      ),
    [installedNames, responsibilitiesByName],
  );
  const printerProfiles = usePrinterProfiles(installedNames, assignedNames, expectedPapers);
  /** 这台打印机负责的纸：标签机指令的纸张按它预填；没负责纸张时按 60×40。 */
  const paperForPrinter = useCallback(
    (name: string) => parsePaperKey(expectedPapers[name] ?? '') ?? DEFAULT_PAPER,
    [expectedPapers],
  );
  const printerCommands = usePrinterCommands(paperForPrinter);
  // 第一次读完打印机列表之前，不把分配到的打印机说成「这台电脑上没有」。
  const knownNames = printers.hasLoaded ? installedNames : [...installedNames, ...assignedNames];
  /** 系统打印机名 → 界面上显示的名字（macOS 上系统名是打印队列名）。 */
  const displayNameOf = useCallback(
    (name: string) => printers.printers.find((printer) => printer.name === name)?.displayName ?? name,
    [printers.printers],
  );
  /** 打印机设置变了（纸张分配、本机打印机）：预览里的「打印机：…」要跟着变。 */
  const printerSetupKey = `${JSON.stringify(paperPrinters)}${installedNames.join('|')}`;
  // 连着点两个「建议」时，第二次要在第一次的基础上改：按最新的分配合并，不按这一帧渲染时的。
  const latestPaperPrinters = useRef(paperPrinters);
  useEffect(() => {
    latestPaperPrinters.current = paperPrinters;
  }, [paperPrinters]);
  const assignPaper = async (key: string, name: string | null) => {
    const next = withAssignment(latestPaperPrinters.current, key, name);
    latestPaperPrinters.current = next;
    if (await update({ paperPrinters: next })) {
      // 这一张会打到哪台可能变了：按新的分配重新预览。
      void station.refreshPreview();
    }
  };
  const paperRowsView = paperRows(
    templateUses(templates.templates, settings?.activeTemplateId ?? null, settings?.ruleSettings ?? []),
    paperPrinters,
    knownNames,
    Object.fromEntries(
      installedNames.map((name) => {
        const check = printerProfiles.profileOf(name).paper;
        return [name, check && check.status !== 'unknown' ? check.paper : null];
      }),
    ),
  );
  const printerChip = describePrintersSummary(
    assignedNames.map((name) => ({
      name: displayNameOf(name),
      isListed: knownNames.includes(name),
      readiness: printerProfiles.profileOf(name).readiness,
    })),
  );

  // 规则、顺序、模板绑定变了：当前扫码的识别结果和用的模板都可能变，重新预览。
  const rules = useRules({ onRulesChanged: () => void station.refreshPreview() });
  const config = useConfigCenter({
    settings,
    platform,
    templates,
    rules,
    latestScanRaw: station.scan?.raw ?? null,
    // 查找表、密钥、规则指定的模板改了都会影响这一张：回到工作台时统一按新配置刷新一次。
    onClosed: () => void station.refreshPreview(),
    onScanIgnored: () => feedback.announce({ kind: 'configuring' }),
  });
  const { appView } = config;
  const isWorkbench = isWorkbenchActive(appView.view);

  // 批量打印：设置留在这里（关掉页面再打开都还在），批次本身在主进程里跑。
  const isBatchOpen = appView.view.kind === 'batch';
  const batch = useBatch({
    templates: templates.templates,
    activeTemplateId: settings?.activeTemplateId ?? null,
    isOpen: isBatchOpen,
    historyLimit,
  });
  // 打印 PDF：设置留在这里，文件、出块、打印在主进程。
  const isPdfOpen = appView.view.kind === 'pdf';
  const pdf = usePdf({ paperPrinters });
  const pdfPaperOptions = useMemo(() => paperOptions(paperPrinters), [paperPrinters]);

  // 把文件拖进窗口：PDF 打开打印 PDF 页，其余（.xlsx / .csv / .xls）打开批量打印页，由那边说明认不认。
  // 读文件放进 openBatch / openPdf 的回调里：操作员在编辑器里取消了「离开」，或者设置还没读到，就不读这个文件。
  useFileDrop((file) => {
    if (isPdfFileName(file.name)) {
      appView.openPdf(() => pdf.dropFile(file));
      return;
    }
    appView.openBatch(() => batch.dropFile(file));
  }, settings !== null);

  // 手机扫码：浮层只在工作台上显示；在配置中心里点按钮会先回到工作台（经过未保存修改的确认）。
  const mobile = useMobileStation({ onJobsChanged: () => void jobLog.refresh() });
  const mobileQr = useQrImage(mobile.status.state === 'active' ? mobile.status.url : null, MOBILE_QR_SIZE_PX);
  const isMobileOverlayShown = mobile.isOpen && isWorkbench;
  const toggleMobile = () => {
    if (isMobileOverlayShown) {
      mobile.close();
      return;
    }
    if (!isWorkbench) {
      appView.close();
    }
    mobile.open();
  };

  // 没有扫码时用示例标签展示当前模板，套用备注下拉框的选择：看到的就是打出来的样子。
  const noteOverride = settings?.noteOverride ?? DEFAULT_SETTINGS.noteOverride;
  const effectiveTemplate = useMemo(
    () => (templates.active ? applyNoteOverride(templates.active, noteOverride) : null),
    [templates.active, noteOverride],
  );
  const samplePreview = useTemplatePreview(SAMPLE_LABEL_RAW, station.scan ? null : effectiveTemplate, printerSetupKey);
  const override: PreviewOverride | null =
    station.scan || !effectiveTemplate
      ? null
      : {
          html: samplePreview?.html ?? null,
          warnings: samplePreview?.warnings ?? NO_RENDER_WARNINGS,
          feedKey: samplePreview?.templateId ?? effectiveTemplate.id,
          // 和正在显示的标签内容用同一份结果的纸张，换模板时框和内容一起变。
          paper: samplePreview?.paper ?? effectiveTemplate.paper,
        };

  const noteOptions = buildNoteOptions(settings?.notePresets ?? [], noteOverride);
  const selectNote = async (value: string) => {
    const selection = resolveNoteSelection(value, settings?.notePresets ?? []);
    if (selection === 'manage') {
      appView.open('notes');
      return;
    }
    if (selection && (await update({ noteOverride: selection }))) {
      void station.refreshPreview();
    }
  };

  const scanView = describeScan(station.scan, {
    autoPrint,
    now: Date.now(),
    queryingRaw: station.queryingRaw,
  });

  // F2 监听在 window 上，工作台的 inert 拦不住：配置中心打开时显式停用，配置中永远不打印。
  useHotkey(
    'F2',
    () => {
      if (scanView.actions.print) {
        station.printCurrent(false);
      }
    },
    { enabled: isWorkbench },
  );

  const changeSettings = async (patch: Partial<AppSettings>) => {
    const next = await update(patch);
    if (next && patch.historyLimit !== undefined) {
      void jobLog.refresh();
    }
    return next;
  };

  /** 测试页的结果也要播报：操作员通常站在打印机旁边，不看屏幕。 */
  const printTest = async (name: string, key: string) => {
    const result = await printers.printTest(name, key);
    feedback.announce(result ? { kind: 'result', result, mode: 'test' } : { kind: 'internal-error' });
    return result;
  };

  const openShop = () => {
    window.api.openShop().catch((error: unknown) => reportError('打开店铺', error));
  };

  const openLogFolder = () => {
    window.api.openLogFolder().catch((error: unknown) => reportError('打开日志目录', error));
  };

  return (
    <div className="app">
      <TitleBar
        version={appInfo?.version ?? null}
        printerChip={printerChip}
        onOpenPrinters={() => appView.open('printers')}
        readyUpdateVersion={updates.status.state === 'ready' ? updates.status.version : null}
        config={{
          isOpen: appView.view.kind === 'config',
          shortcutLabel: configShortcutLabel(platform),
          onToggle: appView.toggle,
        }}
        batch={{
          isOpen: isBatchOpen,
          progress: batchButtonProgress(batch.status),
          onToggle: isBatchOpen ? appView.close : appView.openBatch,
        }}
        pdf={{
          isOpen: isPdfOpen,
          progress: pdfButtonProgress(pdf.status),
          onToggle: isPdfOpen ? appView.close : appView.openPdf,
        }}
        mobile={{ view: describeMobileButton(mobile.status), isOpen: isMobileOverlayShown, onToggle: toggleMobile }}
        onInstallUpdate={updates.install}
        onOpenShop={openShop}
      />
      {settings === null ? (
        <div className="loading">
          {hasLoadError ? (
            <>
              <p>读取设置失败，详情已写入日志。</p>
              <button type="button" className="button button--primary button--large" onClick={() => void reload()}>
                重试
              </button>
            </>
          ) : (
            <p>正在读取设置…</p>
          )}
        </div>
      ) : (
        <Workbench
          isActive={isWorkbench}
          scanBar={{
            autoPrint,
            lineGapMs: settings.scanLineGapMs,
            fieldType,
            note: { ...noteOptions, onSelect: (value) => void selectNote(value) },
            onAutoPrintChange: (next) => void update({ autoPrint: next }),
            onScan: station.scanCode,
          }}
          preview={{
            toolbar: (
              <PreviewToolbar
                templates={templates.templates}
                usage={describePreviewUsage(station.scan?.preview ?? null, templates.active?.id ?? null)}
                onActivate={(id) => void templates.activate(id)}
              />
            ),
            scan: station.scan,
            view: scanView,
            override,
            onPrint: () => station.printCurrent(false),
            onForceReprint: () => station.printCurrent(true),
            onOpenPage: appView.open,
          }}
          history={
            <JobLog
              jobs={jobLog.jobs}
              total={jobLog.total}
              historyLimit={historyLimit}
              search={jobLog.search}
              hasMore={jobLog.hasMore}
              isLoadingMore={jobLog.isLoadingMore}
              hasNewJobs={jobLog.hasNewJobs}
              onShowNewJobs={() => void jobLog.refresh()}
              onSearchChange={jobLog.setSearch}
              onLoadMore={() => void jobLog.loadMore()}
              callerOf={(job) => describeCaller(job.caller, localApi.hasLoadedKeys ? localApi.keys : null)}
              reprintModeOf={reprintModeOf}
              onReview={(job) => station.review(historyTarget(job))}
              onReprint={(job) => station.reprint(historyTarget(job))}
              batchFilter={jobLog.batchId}
              onFilterBatch={jobLog.setBatchId}
              onRetryBatch={(batchId) => {
                // 打开批量打印页：进度、失败的原因（例如模板删了不能重打）都在那里看。重打放进回调里：
                // 和拖文件一样，操作员取消了「离开」就不重打。
                appView.openBatch(() => void batch.retryFailed(batchId, null));
              }}
            />
          }
        />
      )}
      {settings !== null && config.page !== null && (
        <ConfigCenter
          page={config.page}
          isLeaving={isWorkbench}
          breadcrumb={config.breadcrumb}
          sink={config.sink}
          scanFieldType={fieldType}
          pillFlashes={config.pillFlashes}
          onNavigate={appView.open}
          onClose={appView.close}
        >
          <ConfigPages
            page={config.page}
            settings={settings}
            templates={{
              templates: templates.templates,
              activeId: templates.active?.id ?? null,
              selected: templates.selected,
              draft: templates.draft,
              isDirty: templates.isDirty,
              ...config.templatePage,
              onSelect: templates.select,
              onActivate: (id) => void templates.activate(id),
              onDuplicate: (id) => void templates.duplicate(id),
              onEdit: templates.startEdit,
              onRemove: (id) => void templates.remove(id),
              onDraftChange: templates.changeDraft,
              onSave: () => void templates.saveDraft(),
              onCancel: templates.cancelEdit,
              onCreateCanvas: () => void templates.createCanvas(),
              isCreatingCanvas: templates.isCreatingCanvas,
              onPrintSample: () => void templates.printSample(config.templatePage.sample.value),
              isPrintingSample: templates.isPrintingSample,
              printers: printers.printers,
              paperPrinters,
              platform,
            }}
            rules={{
              rules,
              templates: templates.templates,
              tester: config.tester,
              isNarrow,
              // 还没读到时按能识别处理，不先闪一下「没有文字识别」。
              canReadImageText: appInfo?.canReadImageText ?? true,
            }}
            lookup={{
              tables: rules.lookupTables,
              preview: config.lookupPreview,
              onImport: rules.importLookupTable,
              onDelete: rules.deleteLookupTable,
            }}
            secrets={{
              names: rules.secretNames,
              onSave: rules.setSecret,
              onDelete: rules.deleteSecret,
              onCopyReference: (name) => void config.copySecretReference(name),
            }}
            webhooks={{
              secretNames: rules.secretNames,
              editor: config.endpointEditor,
              deliveries: config.deliveries,
              onEdit: (endpoint) =>
                appView.requestLeave(() =>
                  endpoint ? config.endpointEditor.start(endpoint) : config.endpointEditor.startNew(),
                ),
            }}
            printers={
              <PrinterList
                printers={printers.printers}
                isLoading={printers.isLoading}
                rows={paperRowsView}
                profileOf={printerProfiles.profileOf}
                responsibilitiesOf={responsibilitiesByName}
                openingName={printerProfiles.openingName}
                displayName={displayNameOf}
                onAssign={(key, name) => void assignPaper(key, name)}
                onOpenPreferences={(name) => void printerProfiles.openPreferences(name)}
                onRefresh={() => void printers.refresh()}
                onTestPrint={printTest}
                commands={printerCommands}
              />
            }
            localApi={localApi}
            general={{
              jobTotal: jobLog.total,
              canReadImageText: appInfo?.canReadImageText ?? true,
              defaultRelayUrl: appInfo?.defaultRelayUrl ?? null,
            }}
            about={{
              appInfo,
              shopQr: config.shopQr,
              update: updateView,
              onOpenShop: openShop,
              onCheckForUpdates: updates.check,
              onOpenLogFolder: openLogFolder,
            }}
            onChange={changeSettings}
            onPreviewVoice={feedback.preview}
            onOpenPage={appView.open}
          />
        </ConfigCenter>
      )}
      {settings !== null && isBatchOpen && (
        <BatchPage batch={batch} templates={templates.templates} onClose={appView.close} />
      )}
      {settings !== null && isPdfOpen && <PdfPage pdf={pdf} paperOptions={pdfPaperOptions} onClose={appView.close} />}
      {isMobileOverlayShown && (
        <MobileOverlay
          view={describeMobileOverlay(mobile.status, {
            // 至少有一台被分配到的打印机在这台电脑上（纸张分配或模板指定）。
            hasPrinter: assignedNames.some((name) => installedNames.includes(name)),
            now: mobile.now,
          })}
          qrImage={mobileQr}
          onStart={mobile.start}
          onStop={mobile.stop}
          onRegenerate={mobile.regenerate}
          onRemovePhone={mobile.removePhone}
          onAllowNewPhones={mobile.allowNewPhones}
          onOpenPage={(page) => {
            mobile.close();
            appView.open(page);
          }}
          onClose={mobile.close}
        />
      )}
      {appView.leaveConfirm && (
        <ConfirmDialog
          title="有未保存的修改"
          message="离开后这些修改会丢失。"
          confirmLabel="放弃修改"
          cancelLabel="继续编辑"
          onConfirm={appView.leaveConfirm.onDiscard}
          onCancel={appView.leaveConfirm.onContinue}
        />
      )}
      <OriginRequests
        origins={localApi.status?.pendingOrigins ?? []}
        onDecide={(origin, allow) => void localApi.decideOrigin(origin, allow)}
      />
      <NoticeBar notices={notices} onDismiss={dismiss} />
    </div>
  );
}
