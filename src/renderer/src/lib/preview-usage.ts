import type { LabelPreview } from '../../../shared/ipc-contract';

/** 预览工具条右侧的说明，分两段：放不下时先省略内容来源，模板（决定打出来的样子）尽量完整显示。 */
export interface PreviewUsage {
  /** 「规则：横杠三段（编码-颜色-尺码）」或「示例内容」。 */
  source: string;
  /** 「模板：样衣标准（二维码在左）（规则指定）」。 */
  template: string;
}

/**
 * 这张标签是哪条规则识别的、用哪个模板打印，方便核对规则指定的模板是否生效。
 * 没扫码时说明预览的是示例内容；识别不了时没有说明。
 */
export function describePreviewUsage(
  preview: LabelPreview | null,
  activeTemplateName: string | null,
): PreviewUsage | null {
  if (preview === null) {
    return activeTemplateName === null ? null : { source: '示例内容', template: `模板：${activeTemplateName}` };
  }
  if (preview.result.status !== 'ok' || preview.templateName === null) {
    return null;
  }
  const bound = preview.isTemplateBound ? '（规则指定）' : '';
  return { source: `规则：${preview.result.scan.ruleName}`, template: `模板：${preview.templateName}${bound}` };
}

export function usageText(usage: PreviewUsage): string {
  return `${usage.source} · ${usage.template}`;
}
