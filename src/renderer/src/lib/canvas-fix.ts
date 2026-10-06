/**
 * 「放大到能印」：条码按这次排版算出的最小尺寸（主进程按打印机分辨率、和画条码同一套取整规则算的，
 * 见 shared/render-warnings 的 ElementWarning）放大。纯函数，结果交给设计器的 commit。
 */
import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import { BARCODE_TIGHT_RATIO, type ElementWarning } from '../../../shared/render-warnings';
import { replaceElement } from './canvas-edit';

export type GrowResult =
  | { status: 'grown'; template: CanvasTemplate }
  /** 最小尺寸比纸还大：放大也印不出，要换短一点的内容或换码制。 */
  | { status: 'paper-too-small' }
  /** 没有最小尺寸可依、元素已经不在了，或者已经够大。 */
  | { status: 'nothing-to-grow' };

/** 放大后的尺寸取到 0.1mm（往上取）：和数字框的步长一致。 */
const SIZE_STEP_MM = 0.1;
/** 往上取整前去掉浮点误差。 */
const ROUNDING_EPSILON = 1e-9;

/**
 * 放大到多少：最小尺寸再多留到 BARCODE_TIGHT_RATIO 倍（不然刚放大完就冒出「只比最小宽度宽一点」的黄色提醒）；
 * 纸放不下这么多时就只放大到最小尺寸。
 */
function comfortableSize(minimum: number | null, paperSize: number): number {
  if (minimum === null) {
    return 0;
  }
  // 减去一点点：45 × 1.1 在浮点里是 49.500000000000004，不该因此进到 49.6。
  const roomy = Math.ceil((minimum * BARCODE_TIGHT_RATIO) / SIZE_STEP_MM - ROUNDING_EPSILON) * SIZE_STEP_MM;
  return roomy <= paperSize ? Number(roomy.toFixed(1)) : minimum;
}

/** 只放大不缩小，位置不变；放大后超出纸边时整个框挪回纸内（replaceElement 收边）。 */
export function growToPrint(template: CanvasTemplate, warning: ElementWarning): GrowResult {
  const element = template.elements.find((candidate) => candidate.id === warning.elementId);
  if (element === undefined) {
    return { status: 'nothing-to-grow' };
  }
  const width = Math.max(element.width, comfortableSize(warning.minWidthMm, template.paper.widthMm));
  const height = Math.max(element.height, comfortableSize(warning.minHeightMm, template.paper.heightMm));
  if (width === element.width && height === element.height) {
    return { status: 'nothing-to-grow' };
  }
  if (width > template.paper.widthMm || height > template.paper.heightMm) {
    return { status: 'paper-too-small' };
  }
  return { status: 'grown', template: replaceElement(template, { ...element, width, height }) };
}
