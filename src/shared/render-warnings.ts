/**
 * 生成标签时发现的问题：预览上贴在标签底边提示，打印照常进行（只是少印了这一部分）。
 * 主进程排版时得出，界面按 renderWarningTexts 显示。
 */
export interface RenderWarnings {
  /** 内容太长、容错降到 L 仍然放不下能扫的二维码：这张不印二维码。 */
  qrOmitted: boolean;
  /** 面单：条码太长放不下、或内容不能编码（例如有中文），这张不印条码。 */
  barcodeOmitted: boolean;
  /** 面单：缩到最小字号仍放不下、被截断的格子数。 */
  overflowCells: number;
}

export const NO_RENDER_WARNINGS: RenderWarnings = { qrOmitted: false, barcodeOmitted: false, overflowCells: 0 };

/** 给操作员看的提示，每条说清楚少了什么、怎么办。 */
export function renderWarningTexts(warnings: RenderWarnings): string[] {
  const texts: string[] = [];
  if (warnings.qrOmitted) {
    texts.push('内容太长，二维码放不下，这张标签不印二维码');
  }
  if (warnings.barcodeOmitted) {
    texts.push('条码放不下，或内容里有条码印不了的字（例如中文），这张不印条码');
  }
  if (warnings.overflowCells > 0) {
    texts.push(`有 ${warnings.overflowCells} 格内容放不下，已截断：加大这一格或调小字号`);
  }
  return texts;
}
