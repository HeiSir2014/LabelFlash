import type { LabelPreview } from '../../../shared/ipc-contract';

/**
 * 预览工具条：模板只显示一处。下拉框显示这一张实际用的模板；规则指定了模板时锁住并标「规则指定」
 * （改当前模板对这一张不起作用，要改去识别规则里改）。旁边只说内容从哪来。
 * 原来下拉框写当前模板、旁边又写「模板：规则指定的那套」，两处对不上；打印机在标题栏和出错提示里，这里不再重复。
 */
export interface PreviewUsage {
  /** 「规则：横杠三段（编码-颜色-尺码）」或「示例内容」；识别不了时为 null。 */
  source: string | null;
  /** 下拉框显示的模板：规则指定的模板，否则当前模板。 */
  templateId: string | null;
  isRuleBound: boolean;
}

export function describePreviewUsage(preview: LabelPreview | null, activeTemplateId: string | null): PreviewUsage {
  if (preview === null) {
    return { source: '示例内容', templateId: activeTemplateId, isRuleBound: false };
  }
  if (preview.result.status !== 'ok') {
    return { source: null, templateId: activeTemplateId, isRuleBound: false };
  }
  const isRuleBound = preview.isTemplateBound && preview.templateId !== null;
  return {
    source: `规则：${preview.result.scan.ruleName}`,
    templateId: isRuleBound ? preview.templateId : activeTemplateId,
    isRuleBound,
  };
}
