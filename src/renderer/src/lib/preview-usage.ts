import type { PrinterChoice } from '../../../core/printing/resolve-printer';
import type { LabelPreview } from '../../../shared/ipc-contract';

/** 预览工具条右侧的说明，分几段：放不下时先省略内容来源，模板（决定打出来的样子）尽量完整显示。 */
export interface PreviewUsage {
  /** 「规则：横杠三段（编码-颜色-尺码）」或「示例内容」。 */
  source: string;
  /** 「模板：样衣标准（二维码在左）（规则指定）」。 */
  template: string;
  /** 「打印机：面单机B」；还不知道时为 null。 */
  printer: string | null;
}

/**
 * 这张标签是哪条规则识别的、用哪个模板、打到哪台打印机，方便核对规则指定的模板和纸张分配是否生效。
 * 没扫码时说明预览的是示例内容（samplePrinter 是示例标签会打到的打印机）；识别不了时没有说明。
 */
export function describePreviewUsage(
  preview: LabelPreview | null,
  activeTemplateName: string | null,
  samplePrinter: PrinterChoice | null = null,
  /** 系统打印机名 → 界面上显示的名字（macOS 上系统名是打印队列名）。 */
  displayName: (printerName: string) => string = (printerName) => printerName,
): PreviewUsage | null {
  if (preview === null) {
    return activeTemplateName === null
      ? null
      : {
          source: '示例内容',
          template: `模板：${activeTemplateName}`,
          printer: samplePrinter && describePreviewPrinter(samplePrinter, displayName),
        };
  }
  if (preview.result.status !== 'ok' || preview.templateName === null) {
    return null;
  }
  const bound = preview.isTemplateBound ? '（规则指定）' : '';
  return {
    source: `规则：${preview.result.scan.ruleName}`,
    template: `模板：${preview.templateName}${bound}`,
    printer: describePreviewPrinter(preview.result.printer, displayName),
  };
}

/** 这张会打到哪台：模板指定的打印机不在时说明已退回纸张分配。 */
export function describePreviewPrinter(
  choice: PrinterChoice,
  displayName: (printerName: string) => string = (printerName) => printerName,
): string {
  if (choice.printerName === null) {
    return '打印机：还没有';
  }
  const name = displayName(choice.printerName);
  return choice.reason === 'template-missing'
    ? `打印机：${name}（模板指定的 ${choice.missingPrinter} 不在这台电脑上）`
    : `打印机：${name}`;
}

export function usageText(usage: PreviewUsage): string {
  return [usage.source, usage.template, usage.printer].filter((part) => part !== null).join(' · ');
}
