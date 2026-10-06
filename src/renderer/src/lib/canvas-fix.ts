/**
 * 「放大到能印」：条码按这次排版算出的最小尺寸（主进程按打印机分辨率、和画条码同一套取整规则算的，
 * 见 shared/render-warnings 的 ElementWarning）放大。纯函数，结果交给设计器的 commit。
 */
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import type { ElementWarning } from '../../../shared/render-warnings';
import { replaceElement } from './canvas-edit';

export type GrowResult =
  | { status: 'grown'; template: CanvasTemplate }
  /** 最小尺寸比纸还大：放大也印不出，要换短一点的内容或换码制。 */
  | { status: 'paper-too-small' }
  /** 没有最小尺寸可依、元素已经不在了，或者已经够大。 */
  | { status: 'nothing-to-grow' };

/** 只放大不缩小，位置不变；放大后超出纸边时整个框挪回纸内（replaceElement 收边）。 */
export function growToPrint(template: CanvasTemplate, warning: ElementWarning): GrowResult {
  const element = template.elements.find((candidate) => candidate.id === warning.elementId);
  if (element === undefined) {
    return { status: 'nothing-to-grow' };
  }
  const width = Math.max(element.width, warning.minWidthMm ?? 0);
  const height = Math.max(element.height, warning.minHeightMm ?? 0);
  if (width === element.width && height === element.height) {
    return { status: 'nothing-to-grow' };
  }
  if (width > template.paper.widthMm || height > template.paper.heightMm) {
    return { status: 'paper-too-small' };
  }
  return { status: 'grown', template: replaceElement(template, { ...element, width, height }) };
}
