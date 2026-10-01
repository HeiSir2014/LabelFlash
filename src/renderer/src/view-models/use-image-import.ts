import { useCallback } from 'react';
import { CANVAS_LIMITS, type CanvasElement, type CanvasImage } from '../../../core/templates/canvas-model';
import {
  bytesToBase64,
  fitPixelBudget,
  fitsTemplateBudget,
  MAX_IMAGE_FILE_BYTES,
  megabytes,
  rgbaToGray,
} from '../lib/gray-image';
import { notices, reportError } from '../lib/notices';

/** 选一个图片文件放进这个图片元素：成功返回换了像素的元素；不行时已经提示过，返回 null。 */
export type ImageImporter = (
  file: File,
  image: CanvasImage,
  elements: readonly CanvasElement[],
) => Promise<CanvasImage | null>;

async function readImage(
  file: File,
  image: CanvasImage,
  elements: readonly CanvasElement[],
): Promise<CanvasImage | null> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    notices.push('warning', `图片文件超过 ${megabytes(MAX_IMAGE_FILE_BYTES)}MB：换一张小一点的`);
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    console.warn('[renderer] cannot decode the picked image', file.type, error);
    notices.push('warning', '这个文件不是能识别的图片：请选 PNG、JPEG、BMP、GIF 或 WebP');
    return null;
  }
  try {
    const size = fitPixelBudget(bitmap.width, bitmap.height, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels);
    if (!fitsTemplateBudget(elements, image.id, size.width * size.height)) {
      notices.push(
        'warning',
        `一个模板里的图片加起来最多 ${megabytes(CANVAS_LIMITS.templateImageBytes)}MB：先删掉一张图，或换一张小一点的`,
      );
      return null;
    }
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('OffscreenCanvas has no 2d context');
    }
    // 缩小用高质量插值：照片缩到像素预算以内时不出锯齿和摩尔纹。
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const { data } = context.getImageData(0, 0, size.width, size.height);
    return {
      ...image,
      pixels: bytesToBase64(rgbaToGray(data, size.width, size.height)),
      pixelWidth: size.width,
      pixelHeight: size.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * 「选择图片」：在这个页面里（sandbox 的渲染进程）把图片文件解码成灰度像素，存进模板。
 * 主进程从不解码图片文件（Chromium 的两条法则：不可信的输入不进高权限进程里的 C++ 解码器），只拿到校验过的灰度像素。
 * 解码交给浏览器：createImageBitmap 解码，OffscreenCanvas 缩到要存的尺寸并取出 RGBA。
 */
export function useImageImport(): ImageImporter {
  return useCallback(async (file, image, elements) => {
    try {
      return await readImage(file, image, elements);
    } catch (error) {
      reportError('读取图片', error);
      return null;
    }
  }, []);
}
