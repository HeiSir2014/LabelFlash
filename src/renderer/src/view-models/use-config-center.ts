import { useMemo, useState } from 'react';
import { applyNoteOverride } from '../../../core/templates/note-override';
import { BRAND } from '../../../shared/brand';
import { type AppSettings, DEFAULT_SETTINGS } from '../../../shared/settings';
import type { ConfigPage, Platform } from '../lib/app-view';
import { editorForPage, type PageDraft } from '../lib/editor-guard';
import { fieldNameSuggestions } from '../lib/field-names';
import { scanTargetFor } from '../lib/scan-routing';
import { useAppView } from './use-app-view';
import { useConfigScan } from './use-config-scan';
import { useCopySecretReference } from './use-copy-secret-reference';
import { useEndpointEditor } from './use-endpoint-editor';
import { useLookupPreview } from './use-lookup-preview';
import { useQrImage } from './use-qr-image';
import type { RulesViewModel } from './use-rules';
import { useSampleContent } from './use-sample-content';
import { useTemplatePreview } from './use-template-preview';
import type { TemplatesViewModel } from './use-templates';
import { useWebhookDeliveries } from './use-webhook-deliveries';

interface ConfigCenterOptions {
  settings: AppSettings | null;
  platform: Platform;
  templates: TemplatesViewModel;
  rules: RulesViewModel;
  /** 工作台最近一次扫码的内容：模板页「预览内容」默认用它。 */
  latestScanRaw: string | null;
  /** 回到工作台之后：规则和模板可能改过，按新的配置重新预览工作台上这一张。 */
  onClosed: () => void;
  /** 在没有测试框的页面扫了码：提醒「正在配置，没有打印」。 */
  onScanIgnored: () => void;
}

/**
 * 配置中心的状态：视图和未保存确认、各页的编辑草稿、配置中心里的扫码、模板页的预览，
 * 以及只在某一页用到的数据（查找表内容、发送记录、店铺二维码）。App 只负责把它们接到界面上。
 */
export function useConfigCenter({
  settings,
  platform,
  templates,
  rules,
  latestScanRaw,
  onClosed,
  onScanIgnored,
}: ConfigCenterOptions) {
  const endpointEditor = useEndpointEditor();
  const drafts: Partial<Record<ConfigPage, PageDraft>> = {
    templates: { isEditing: templates.draft !== null, isDirty: templates.isDirty },
    rules: { isEditing: rules.draft !== null, isDirty: rules.isDirty },
    webhooks: { isEditing: endpointEditor.draft !== null, isDirty: endpointEditor.isDirty },
  };
  const closeAllDrafts = () => {
    templates.cancelEdit();
    rules.cancelEdit();
    endpointEditor.close();
  };
  const appView = useAppView({
    platform,
    canOpen: settings !== null,
    editor: (page) => editorForPage(page, drafts, closeAllDrafts),
    onClosed,
  });
  const { view } = appView;
  const isOpen = view.kind === 'config';
  // 配置中心显示的页面：打开时是当前页，关闭后淡出期间仍是刚才那一页。
  const page = isOpen ? view.page : appView.leavingPage;

  const editingName = page === 'templates' ? templates.draft?.name : page === 'rules' ? rules.draft?.name : undefined;
  const breadcrumb =
    editingName === undefined
      ? null
      : { current: `编辑：${editingName}`, onList: () => appView.requestLeave(() => undefined) };

  // 模板页预览选中的模板或草稿，套用备注下拉框的选择（草稿除外：正在编辑的就是备注本身）。
  const noteOverride = settings?.noteOverride ?? DEFAULT_SETTINGS.noteOverride;
  const sample = useSampleContent(latestScanRaw);
  const selectedTemplate = useMemo(
    () => (templates.selected ? applyNoteOverride(templates.selected, noteOverride) : null),
    [templates.selected, noteOverride],
  );
  const templatePreview = useTemplatePreview(
    sample.value,
    page === 'templates' ? (templates.draft ?? selectedTemplate) : null,
  );
  const fieldNames = useMemo(
    () =>
      fieldNameSuggestions(
        rules.ordered.map((item) => item.rule),
        templatePreview?.result.status === 'ok' ? templatePreview.result.scan : null,
      ),
    [rules.ordered, templatePreview],
  );

  // 配置中心里扫码：有测试框的页面填进测试框（替换原有内容），其他页面提醒「正在配置，没有打印」。永远不打印。
  const [testerRaw, setTesterRaw] = useState('');
  const [pillFlashes, setPillFlashes] = useState(0);
  const sink = useConfigScan({
    isEnabled: isOpen && appView.leaveConfirm === null,
    lineGapMs: settings?.scanLineGapMs ?? DEFAULT_SETTINGS.scanLineGapMs,
    onScan: (raw) => {
      // 停顿计时到点时配置中心可能已经关了：这次按键已经不属于配置中心，丢掉。
      if (view.kind !== 'config') {
        return;
      }
      switch (scanTargetFor(view)) {
        case 'rule-tester':
          setTesterRaw(raw);
          break;
        case 'template-sample':
          sample.onChange(raw);
          break;
        case 'sink':
          onScanIgnored();
          setPillFlashes((count) => count + 1);
          break;
        case 'scan-box':
          break;
      }
    },
  });

  const lookupPreview = useLookupPreview(rules.lookupTables);
  const deliveries = useWebhookDeliveries(isOpen && page === 'webhooks');
  const shopQr = useQrImage(BRAND.shop.url);
  const copySecretReference = useCopySecretReference();

  return {
    appView,
    page,
    breadcrumb,
    sink,
    pillFlashes,
    endpointEditor,
    templatePage: { sample, preview: templatePreview, fieldNames },
    tester: { raw: testerRaw, onRawChange: setTesterRaw },
    lookupPreview,
    deliveries,
    shopQr,
    copySecretReference,
  };
}
