import type { EnrichStep } from '../../core/scan/enrich-model';
import { LABEL_AREA } from '../../core/scan/image-text';
import type { ImageRequest } from '../../shared/mobile-protocol';

/**
 * 每个二维码边长截多少像素：60×40 标签上货架号的字高约为二维码边长的八分之一，170 像素时字约 21 像素高。
 * 模拟评估（scripts/ocr/eval-shelf-number.ts，1200 张，JPEG 先试质量 95）：130 像素读对 92.8%、读错 1.0%；
 * 170 像素 93.3%、0.8%，每张多约 90 毫秒；220 像素 93.2%、0.7%，每张要 0.45 秒，不再有提升。
 * 整张标签约 1020×680，JPEG 平均约 100 KB、最大约 310 KB（上限 MAX_IMAGE_BYTES）。改这里不用更新手机页面。
 */
export const PIXELS_PER_CODE = 170;

/**
 * 每次扫码要几帧：货架号的横杠在有的帧里淡到读不出（真手机试扫，单帧 6 张读出 4 张，读漏的读成 A-123、A123）。
 * 同一张标签连续的几帧依次识别，第一帧认出就停；手机多等约两次取帧（0.3–0.5 秒）。上限见 MAX_LABEL_FRAMES。
 */
export const LABEL_FRAMES = 3;

/**
 * 要不要手机随扫码截标签图：有启用的规则带「图中文字识别」步骤、这台电脑能识别时才要，
 * 要的是整张标签（货架号印在哪都能找到，见 core/scan/image-text.ts）。不需要时不截，手机省流量、省电。
 */
export function phoneImageRequest(
  enabledRuleSteps: ReadonlyArray<readonly EnrichStep[]>,
  canReadImages: boolean,
): ImageRequest | null {
  const needed = enabledRuleSteps.some((steps) => steps.some((step) => step.kind === 'imageText'));
  return needed && canReadImages ? { area: LABEL_AREA, pixelsPerCode: PIXELS_PER_CODE, frames: LABEL_FRAMES } : null;
}
