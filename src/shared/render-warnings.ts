import type { CanvasElementIssue } from '../core/templates/canvas-layout';

/**
 * 条码宽度不到最小宽度的这么多倍就提前提醒（黄）：内容（例如编码）再长几位就印不出了。
 * 主进程画条码时按它提醒，设计器的「放大到能印」也放大到这么多，放大完不会马上又冒出一条提醒。
 */
export const BARCODE_TIGHT_RATIO = 1.1;

/**
 * 自由设计模板里一个元素的问题（见 core 的 CanvasElementIssue），再加上「放大到能印」要用的最小尺寸：
 * 条码按这次排版用的打印机分辨率、和画条码同一套取整到点的规则算出，已经留够元素框取整到点的余量，
 * 宽高填成这么多就一定印得出。按元素的框（转过之后）给，不是条码自己的方向。用不上时为 null。
 */
export interface ElementWarning extends CanvasElementIssue {
  minWidthMm: number | null;
  minHeightMm: number | null;
}

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
  /** 自由设计模板的打印前检查：每条写清楚是哪个元素、怎么了。标签和面单是空的。 */
  issues: readonly string[];
  /**
   * 自由设计模板：每个元素的问题（issues 的每一条都在这里，带元素 id），另有只在设计器里提醒的
   * （例如条码宽度离印不出只差一点）——那些不算打印问题，不进 issues、不写打印日志。标签和面单是空的。
   */
  elements: readonly ElementWarning[];
}

export const NO_RENDER_WARNINGS: RenderWarnings = {
  qrOmitted: false,
  barcodeOmitted: false,
  overflowCells: 0,
  issues: [],
  elements: [],
};

/**
 * 给操作员看的提示，每条说清楚少了什么、怎么办。
 * 标签、面单的 qrOmitted/barcodeOmitted/overflowCells 是笼统的「有没有」，issues 是空的，用通用文案；
 * 自由设计模板反过来：每个元素的问题已经在 issues 里写清楚是哪个、怎么了，这时通用文案反而是重复的噪音，
 * 而且笼统文案只会说「条码放不下」，可能是别的元素出的问题，对不上号——issues 非空时只显示 issues。
 */
export function renderWarningTexts(warnings: RenderWarnings): string[] {
  if (warnings.issues.length > 0) {
    return [...warnings.issues];
  }
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
