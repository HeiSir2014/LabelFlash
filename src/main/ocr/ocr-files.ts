/**
 * 本地 OCR 用到的文件在哪：安装版在 resources/ocr/（扩展和模型，由安装包带上）；
 * 开发版和 E2E 用仓库里编译好的扩展（bun run ocr:build）和下载好的模型（bun run ocr:models）。
 * 模型用 small 检测 + small 识别：tiny 识别会把热敏纸上的 A 读成 4（见 OCR 引擎设计第 10 节）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { addonFileName } from '../../../native/ocr/node/src/addon-name';

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
const DEV_MODEL_TIER = 'small';

export function ocrFiles(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
  platform: string;
  arch: string;
}): OcrFiles {
  if (options.isPackaged) {
    const dir = join(options.resourcesPath, PACKAGED_OCR_DIR);
    return {
      addon: join(dir, PACKAGED_ADDON_NAME),
      detectionModel: join(dir, 'det.onnx'),
      recognitionModel: join(dir, 'rec.onnx'),
      dictionary: join(dir, 'dict.txt'),
    };
  }
  const models = join(options.appRoot, 'models', DEV_MODEL_TIER);
  return {
    addon: join(options.appRoot, 'native', 'ocr', 'node', 'bin', addonFileName(options.platform, options.arch)),
    detectionModel: join(models, 'det.onnx'),
    recognitionModel: join(models, 'rec.onnx'),
    dictionary: join(models, 'dict.txt'),
  };
}

/** 缺了哪些文件（没有就是空数组）。 */
export function missingOcrFiles(files: OcrFiles, exists: (path: string) => boolean = existsSync): string[] {
  return Object.values(files).filter((path) => !exists(path));
}
