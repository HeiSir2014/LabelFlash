/**
 * 图中文字识别（货架号）用哪一档模型，由用户在「通用」里选。两档都装在安装包里，切换不用下载。
 * 每一档具体用哪两个模型文件由主进程决定（src/main/ocr/ocr-files.ts）；这里只有给界面和设置用的名字。
 */
export const OCR_MODEL_TIERS = [
  { id: 'fast', label: '极速', description: '识别一张约 0.2 秒，占内存少，大多数标签够用' },
  { id: 'accurate', label: '精准', description: '模型更大，模糊、光线差时更稳，识别慢一些、多占内存' },
] as const;
export type OcrModelTier = (typeof OCR_MODEL_TIERS)[number]['id'];
export const DEFAULT_OCR_MODEL_TIER: OcrModelTier = 'fast';

export function isOcrModelTier(value: unknown): value is OcrModelTier {
  return OCR_MODEL_TIERS.some((tier) => tier.id === value);
}
