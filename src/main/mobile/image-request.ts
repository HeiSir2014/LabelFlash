import type { EnrichStep } from '../../core/scan/enrich-model';
import { LABEL_AREA } from '../../core/scan/image-text';
import type { ImageRequest } from '../../shared/mobile-protocol';

/**
 * 每个二维码边长截多少像素：60×40 标签上货架号的字高约为二维码边长的八分之一，
 * 130 像素时字约 16 像素高，OCR 读得清楚；整张标签约 780×520，JPEG 几十 KB。
 */
export const PIXELS_PER_CODE = 130;

/**
 * 要不要手机随扫码截标签图：有启用的规则带「图中文字识别」步骤、这台电脑能识别时才要，
 * 要的是整张标签（货架号印在哪都能找到，见 core/scan/image-text.ts）。不需要时不截，手机省流量、省电。
 */
export function phoneImageRequest(
  enabledRuleSteps: ReadonlyArray<readonly EnrichStep[]>,
  canReadImages: boolean,
): ImageRequest | null {
  const needed = enabledRuleSteps.some((steps) => steps.some((step) => step.kind === 'imageText'));
  return needed && canReadImages ? { area: LABEL_AREA, pixelsPerCode: PIXELS_PER_CODE } : null;
}
