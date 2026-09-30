/**
 * 本地 OCR 用到的文件在哪：安装版在 resources/ocr/（扩展，和 models/<档位>/ 下的模型，由安装包带上）；
 * 开发版和 E2E 用仓库里编译好的扩展（bun run ocr:build）和下载好的模型（bun run ocr:models，放在 models/<档位>/）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { addonFileName } from '../../../native/ocr/node/src/addon-name';
import type { OcrModelTier } from '../../shared/ocr-model';

export interface OcrFiles {
  addon: string;
  detectionModel: string;
  recognitionModel: string;
  dictionary: string;
}

/** 安装包里 resources 下的目录名（和 electron-builder.yml 的 extraResources 一致）。 */
export const PACKAGED_OCR_DIR = 'ocr';
/** 安装包里的扩展文件名：只带本平台的一个，不用按平台区分。 */
export const PACKAGED_ADDON_NAME = 'ocr-addon.node';
/** 模型放在这个目录下，按 PP-OCRv6 的档位分子目录（small、medium）。 */
export const MODELS_DIR = 'models';

export type ModelSize = 'small' | 'medium';

/**
 * 每一档用的检测、识别模型。依据是货架号识别设计第 10 节的模拟评估（1200 张）：
 * - 极速：small + small，读对 92.0%，每张约 0.2 秒，识别时内存峰值约 180 MB。tiny 识别会把热敏纸上的 A 读成 4，不用。
 * - 精准：检测仍用 small，识别换 medium，读对 93.5%（模糊、倾斜、远距离时多读对 2–3.5 个百分点），约 0.42 秒、240 MB。
 *   medium 检测没有带来提升，还慢一倍多，所以不用。
 */
export const OCR_TIER_MODELS: Record<OcrModelTier, { detection: ModelSize; recognition: ModelSize }> = {
  fast: { detection: 'small', recognition: 'small' },
  accurate: { detection: 'small', recognition: 'medium' },
};

export function ocrFiles(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
  platform: string;
  arch: string;
  tier: OcrModelTier;
}): OcrFiles {
  const root = options.isPackaged ? join(options.resourcesPath, PACKAGED_OCR_DIR) : options.appRoot;
  const addon = options.isPackaged
    ? join(root, PACKAGED_ADDON_NAME)
    : join(root, 'native', 'ocr', 'node', 'bin', addonFileName(options.platform, options.arch));
  const models = OCR_TIER_MODELS[options.tier];
  return {
    addon,
    detectionModel: join(root, MODELS_DIR, models.detection, 'det.onnx'),
    recognitionModel: join(root, MODELS_DIR, models.recognition, 'rec.onnx'),
    // 字典跟识别模型走：不同档位的识别模型各带自己的字典。
    dictionary: join(root, MODELS_DIR, models.recognition, 'dict.txt'),
  };
}

/** 缺了哪些文件（没有就是空数组）。 */
export function missingOcrFiles(files: OcrFiles, exists: (path: string) => boolean = existsSync): string[] {
  return Object.values(files).filter((path) => !exists(path));
}
