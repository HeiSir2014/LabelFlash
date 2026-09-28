import { useMemo, useState } from 'react';
import { applyNoteOverride } from '../../core/templates/note-override';
import { SAMPLE_LABEL_RAW } from '../../shared/sample-label';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { ConfigCenter } from './components/config/ConfigCenter';
import { ConfigPages } from './components/config/ConfigPages';
import { ConfirmDialog } from './components/config/ConfirmDialog';
import { JobLog } from './components/JobLog';
import { NoticeBar } from './components/NoticeBar';
import { type PreviewOverride, PreviewStage } from './components/PreviewStage';
import { PrinterList } from './components/PrinterList';
import { RulePanel } from './components/RulePanel';
import { ScanBar } from './components/ScanBar';
import { SidePanel, type SideTab } from './components/SidePanel';
import { TemplatePanel } from './components/TemplatePanel';
import { TitleBar } from './components/TitleBar';
import { PreviewToolbar } from './components/workbench/PreviewToolbar';
import { configShortcutLabel, platformForChrome } from './lib/app-view';
import { buildNoteOptions, resolveNoteSelection } from './lib/note-options';
import { reportError } from './lib/notices';
import { describePaperCheck } from './lib/paper-text';
import { describePreviewUsage, type PreviewUsage } from './lib/preview-usage';
import { describePrinterChip } from './lib/printer-chip';
import { isWorkbenchActive } from './lib/scan-routing';
import { describeScan } from './lib/status-text';
import { describeUpdate } from './lib/update-text';
import { useAppInfo } from './view-models/use-app-info';
import { NO_EDITOR, useAppView } from './view-models/use-app-view';
import { useDriverPaper } from './view-models/use-driver-paper';
import { useFeedback } from './view-models/use-feedback';
import { useHotkey } from './view-models/use-hotkey';
import { useJobLog } from './view-models/use-job-log';
import { useNotices } from './view-models/use-notices';
import { usePrinterStatus } from './view-models/use-printer-status';
import { usePrinters } from './view-models/use-printers';
import { useRules } from './view-models/use-rules';
import { useScanStation } from './view-models/use-scan-station';
import { useSettings } from './view-models/use-settings';
import { useTemplatePreview } from './view-models/use-template-preview';
import { useTemplates } from './view-models/use-templates';
import { useUpdateStatus } from './view-models/use-update-status';

export function App() {
  const { settings, hasLoadError, reload, update, replace } = useSettings();
  const printers = usePrinters();
  const jobLog = useJobLog();
  const appInfo = useAppInfo();
  const { notices, dismiss } = useNotices();
  const updates = useUpdateStatus();
  const updateView = describeUpdate(updates.status);
  const [sideTab, setSideTab] = useState<SideTab>('printers');
  const platform = platformForChrome(window.windowControls.chrome);
  // 模板和规则的编辑器在后续步骤迁进配置中心后接入未保存确认。
  const appView = useAppView({ platform, editor: () => NO_EDITOR });
  const isWorkbench = isWorkbenchActive(appView.view);

  const printerName = settings?.selectedPrinter ?? null;
  const autoPrint = settings?.autoPrint ?? DEFAULT_SETTINGS.autoPrint;
  const historyLimit = settings?.historyLimit ?? DEFAULT_SETTINGS.historyLimit;
  const readiness = usePrinterStatus(printerName);
  const isPrinterListed = printers.printers.some((printer) => printer.name === printerName);
  const printerChip = describePrinterChip({
    printerName,
    isLoading: printers.isLoading,
    isListed: isPrinterListed,
    readiness,
  });
  const driverPaper = useDriverPaper(printerName, isPrinterListed);

  // 是否能打印由主进程最终判断（找不到打印机会返回 PRINTER_NOT_FOUND），界面只要求选过打印机。
  const feedback = useFeedback(settings?.voice ?? DEFAULT_SETTINGS.voice);
  const station = useScanStation({
    printerName,
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
  // 规则、顺序、模板绑定变了：当前扫码的识别结果和用的模板都可能变，重新预览。
  const rules = useRules({ onRulesChanged: () => void station.refreshPreview() });

  // 编辑模板时预览草稿；悬停在其他模板上时预览它；没有扫码时用示例标签展示当前生效的模板。
  // 三种情况都套用备注下拉框的选择，看到的就是打出来的样子。
  const noteOverride = settings?.noteOverride ?? DEFAULT_SETTINGS.noteOverride;
  const effectiveTemplate = useMemo(
    () => (templates.active ? applyNoteOverride(templates.active, noteOverride) : null),
    [templates.active, noteOverride],
  );
  const [hoverTemplateId, setHoverTemplateId] = useState<string | null>(null);
  const hoverTemplate = useMemo(() => {
    const template = templates.templates.find((item) => item.id === hoverTemplateId);
    return template && template.id !== templates.active?.id ? applyNoteOverride(template, noteOverride) : null;
  }, [templates.templates, templates.active, hoverTemplateId, noteOverride]);
  const previewTemplate = templates.draft ?? hoverTemplate ?? (station.scan ? null : effectiveTemplate);
  const previewRaw = station.scan?.preview.result.status === 'ok' ? station.scan.raw : SAMPLE_LABEL_RAW;
  const overridePreview = useTemplatePreview(previewRaw, previewTemplate);
  const override: PreviewOverride | null = previewTemplate
    ? {
        html: overridePreview?.html ?? null,
        qrOmitted: overridePreview?.qrOmitted ?? false,
        feedKey: previewTemplate.id,
      }
    : null;
  const previewUsage: PreviewUsage | null = templates.draft
    ? { source: '模板编辑中', template: '未保存不会用于打印' }
    : hoverTemplate
      ? { source: `预览 · ${hoverTemplate.name}`, template: '点「使用」后才会用于打印' }
      : describePreviewUsage(station.scan?.preview ?? null, templates.active?.name ?? null);

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

  const view = describeScan(station.scan, {
    autoPrint,
    hasPrinter: printerName !== null,
    now: Date.now(),
    queryingRaw: station.queryingRaw,
  });

  // F2 监听在 window 上，工作台的 inert 拦不住：配置中心打开时显式停用，配置中永远不打印。
  useHotkey(
    'F2',
    () => {
      if (view.actions.print) {
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
  const printTest = async (name: string) => {
    const result = await printers.printTest(name);
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
          isOpen: !isWorkbench && !appView.isLeaving,
          shortcutLabel: configShortcutLabel(platform),
          onToggle: appView.toggle,
        }}
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
        <main className="workspace" inert={!isWorkbench}>
          <div className="station">
            <ScanBar
              isActive={isWorkbench}
              autoPrint={autoPrint}
              lineGapMs={settings?.scanLineGapMs ?? DEFAULT_SETTINGS.scanLineGapMs}
              note={{ ...noteOptions, onSelect: (value) => void selectNote(value) }}
              onAutoPrintChange={(next) => void update({ autoPrint: next })}
              onScan={station.scanCode}
            />
            <PreviewStage
              toolbar={
                <PreviewToolbar
                  templates={templates.templates}
                  activeTemplateId={templates.active?.id ?? null}
                  usage={previewUsage}
                  onActivate={(id) => void templates.activate(id)}
                />
              }
              scan={station.scan}
              view={view}
              override={override}
              onPrint={() => station.printCurrent(false)}
              onForceReprint={() => station.printCurrent(true)}
            />
          </div>
          <SidePanel
            active={sideTab}
            onActiveChange={setSideTab}
            panels={{
              printers: (
                <PrinterList
                  printers={printers.printers}
                  selected={printerName}
                  isLoading={printers.isLoading}
                  paper={{
                    view: describePaperCheck(driverPaper.check),
                    isOpening: driverPaper.isOpening,
                    onOpenPreferences: () => void driverPaper.openPreferences(),
                  }}
                  onSelect={(name) => void update({ selectedPrinter: name })}
                  onRefresh={() => void printers.refresh()}
                  onTestPrint={printTest}
                />
              ),
              templates: (
                <TemplatePanel
                  templates={templates.templates}
                  activeId={templates.active?.id ?? null}
                  previewId={hoverTemplate?.id ?? null}
                  draft={templates.draft}
                  isDirty={templates.isDirty}
                  onPreviewChange={setHoverTemplateId}
                  onActivate={(id) => void templates.activate(id)}
                  onDuplicate={(id) => void templates.duplicate(id)}
                  onEdit={templates.startEdit}
                  onRemove={(id) => void templates.remove(id)}
                  onDraftChange={templates.changeDraft}
                  onSave={() => void templates.saveDraft()}
                  onCancel={templates.cancelEdit}
                />
              ),
              history: (
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
              ),
              rules: <RulePanel rules={rules} templates={templates.templates} />,
            }}
          />
        </main>
      )}
      {settings !== null && appView.view.kind === 'config' && (
        <ConfigCenter
          page={appView.view.page}
          isLeaving={appView.isLeaving}
          breadcrumb={null}
          onNavigate={appView.open}
          onClose={appView.close}
        >
          <ConfigPages
            page={appView.view.page}
            settings={settings}
            jobTotal={jobLog.total}
            appInfo={appInfo}
            update={updateView}
            secretNames={rules.secretNames}
            onChange={changeSettings}
            onCheckForUpdates={updates.check}
            onOpenLogFolder={openLogFolder}
            onOpenShop={openShop}
            onPreviewVoice={feedback.preview}
          />
        </ConfigCenter>
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
