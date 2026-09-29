/**
 * 仅开发 / E2E：假的文字识别。环境变量 CDL_LABELFLASH_FAKE_OCR 给一个字符串数组（JSON），
 * 每张标签图都「读出」这几段字（放在二维码外面，不会被当成码上的字）。安装版不读这个变量。
 */
import type { ImageTextRegion } from '../../core/scan/image-text';
import type { ImageTextSource } from './image-text-reader';

export const FAKE_OCR_ENV = 'CDL_LABELFLASH_FAKE_OCR';
/** 每段字的高度和间隔（像素）：一行一段，从截图左上角往下排。 */
const LINE_HEIGHT_PX = 30;
const LINE_WIDTH_PX = 120;

export function parseFakeOcr(env: NodeJS.ProcessEnv, isPackaged: boolean): string[] | null {
  const value = env[FAKE_OCR_ENV];
  if (isPackaged || value === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${FAKE_OCR_ENV} 要是字符串数组`);
  }
  return parsed as string[];
}

export function fakeImageTextSource(texts: readonly string[]): ImageTextSource {
  const regions: ImageTextRegion[] = texts.map((text, index) => {
    const top = index * LINE_HEIGHT_PX;
    return {
      box: [
        { x: 0, y: top },
        { x: LINE_WIDTH_PX, y: top },
        { x: LINE_WIDTH_PX, y: top + LINE_HEIGHT_PX },
        { x: 0, y: top + LINE_HEIGHT_PX },
      ],
      text,
      score: 1,
    };
  });
  return { canRead: () => true, read: async () => regions, warm: () => {} };
}
