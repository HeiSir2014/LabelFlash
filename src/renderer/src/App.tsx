import { useCallback, useMemo } from 'react';
import { applyNoteOverride } from '../../core/templates/note-override';
import { describePrintersSummary } from '../../shared/printer-summary';
import { SAMPLE_LABEL_RAW } from '../../shared/sample-label';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { ConfigCenter } from './components/config/ConfigCenter';
import { ConfigPages } from './components/config/ConfigPages';
import { ConfirmDialog } from './components/config/ConfirmDialog';
import { JobLog } from './components/JobLog';
import { MOBILE_QR_SIZE_PX, MobileOverlay } from './components/MobileOverlay';
import { NoticeBar } from './components/NoticeBar';
import type { PreviewOverride } from './components/PreviewStage';
import { PrinterList } from './components/PrinterList';
import { TitleBar } from './components/TitleBar';
import { PreviewToolbar } from './components/workbench/PreviewToolbar';
import { Workbench } from './components/workbench/Workbench';
import { configShortcutLabel, platformForChrome } from './lib/app-view';
import { describeMobileButton, describeMobileOverlay, describeMobileState } from './lib/mobile-text';
import { buildNoteOptions, resolveNoteSelection } from './lib/note-options';
import { reportError } from './lib/notices';
import { describePreviewUsage } from './lib/preview-usage';
import { expectedPaperKey, paperRows, responsibilitiesOf, withAssignment } from './lib/printer-assignment';
import { scanFieldType } from './lib/scan-field';
import { isWorkbenchActive } from './lib/scan-routing';
import { describeScan } from './lib/status-text';
import { describeUpdate } from './lib/update-text';
import { useAppInfo } from './view-models/use-app-info';
import { useConfigCenter } from './view-models/use-config-center';
import { useFeedback } from './view-models/use-feedback';
import { useHotkey } from './view-models/use-hotkey';
import { useJobLog } from './view-models/use-job-log';
import { useMediaQuery } from './view-models/use-media-query';
import { useMobileStation } from './view-models/use-mobile-station';
import { useNotices } from './view-models/use-notices';
import { usePrinterProfiles } from './view-models/use-printer-profiles';
import { usePrinters } from './view-models/use-printers';
import { useQrImage } from './view-models/use-qr-image';
import { useRules } from './view-models/use-rules';
import { useScanStation } from './view-models/use-scan-station';
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
  const paperRowsView = paperRows(
    templates.templates,
    paperPrinters,
    installedNames,
    Object.fromEntries(
      installedNames.map((name) => {
        const check = printerProfiles.profileOf(name).paper;
        return [name, check && check.status !== 'unknown' ? check.paper : null];
      }),
    ),
  );
  const printerChip = describePrintersSummary(
    assignedNames.map((name) => ({
      name,
      // 列表还在读取时不急着说「系统里找不到」。
      isListed: printers.isLoading || installedNames.includes(name),
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
  const samplePreview = useTemplatePreview(SAMPLE_LABEL_RAW, station.scan ? null : effectiveTemplate);
  const override: PreviewOverride | null =
    station.scan || !effectiveTemplate
      ? null
      : {
          html: samplePreview?.html ?? null,
          qrOmitted: samplePreview?.qrOmitted ?? false,
          feedKey: samplePreview?.templateId ?? effectiveTemplate.id,
          paper: effectiveTemplate.paper,
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
        readyUpdateVersion={updates.status.state === 'ready' ? updates.status.version : null}
        config={{
          isOpen: !isWorkbench,
          shortcutLabel: configShortcutLabel(platform),
          onToggle: appView.toggle,
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
                activeTemplateId={templates.active?.id ?? null}
                usage={describePreviewUsage(
                  station.scan?.preview ?? null,
                  templates.active?.name ?? null,
                  samplePreview?.result.status === 'ok' ? samplePreview.result.printer : null,
                )}
                onActivate={(id) => void templates.activate(id)}
              />
            ),
            scan: station.scan,
            view: scanView,
            override,
            onPrint: () => station.printCurrent(false),
            onForceReprint: () => station.printCurrent(true),
            onOpenPage: (page) => {
              // 打印机页在工作台右侧，不在配置中心。
              if (page !== 'printers') {
                appView.open(page);
              }
            },
          }}
          printers={
            <PrinterList
              printers={printers.printers}
              isLoading={printers.isLoading}
              rows={paperRowsView}
              profileOf={printerProfiles.profileOf}
              responsibilitiesOf={responsibilitiesByName}
              openingName={printerProfiles.openingName}
              onAssign={(key, name) => void update({ paperPrinters: withAssignment(paperPrinters, key, name) })}
              onOpenPreferences={(name) => void printerProfiles.openPreferences(name)}
              onRefresh={() => void printers.refresh()}
              onTestPrint={printTest}
            />
          }
          history={
            <JobLog
              jobs={jobLog.jobs}
              total={jobLog.total}
              historyLimit={historyLimit}
              search={jobLog.search}
              hasMore={jobLog.hasMore}
              isLoadingMore={jobLog.isLoadingMore}
              onSearchChange={jobLog.setSearch}
              onLoadMore={() => void jobLog.loadMore()}
              onReview={station.review}
              onReprint={station.reprint}
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
            }}
            rules={{ rules, templates: templates.templates, tester: config.tester, isNarrow }}
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
            mobile={{
              defaultRelayUrl: appInfo?.defaultRelayUrl ?? null,
              statusText: describeMobileState(mobile.status),
            }}
            general={{
              jobTotal: jobLog.total,
              update: updateView,
              onCheckForUpdates: updates.check,
              onOpenLogFolder: openLogFolder,
            }}
            about={{ appInfo, shopQr: config.shopQr, onOpenShop: openShop }}
            onChange={changeSettings}
            onPreviewVoice={feedback.preview}
            onOpenPage={appView.open}
          />
        </ConfigCenter>
      )}
      {isMobileOverlayShown && (
        <MobileOverlay
          view={describeMobileOverlay(mobile.status, {
            hasPrinter: Object.keys(settings?.paperPrinters ?? {}).length > 0,
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
      <NoticeBar notices={notices} onDismiss={dismiss} />
    </div>
  );
}
