import { useCallback } from 'react';
import { CANVAS_LIMITS, type CanvasElement } from '../../../core/templates/canvas-model';
import {
  bytesToBase64,
  fitPixelBudget,
  fitsTemplateBudget,
  IMAGE_HEADER_PEEK_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_SOURCE_PIXELS,
  megabytes,
  readImagePixelSize,
  rgbaToGray,
} from '../lib/gray-image';
import { notices, reportError } from '../lib/notices';

/**
 * 解码出来的像素，只有这三项：调用方把它们并进「当前」的图片元素（`{ ...currentImage, ...result }`），
 * 不要整个元素都由这里返回——解码这几百毫秒里，这个元素的其它属性（转角、黑白模式、阈值……）
 * 可能已经在属性栏被改过；这里如果带着调用这一刻的旧元素整个覆盖回去，会把那些改动悄悄吞掉。
 */
export interface ImportedImagePixels {
  pixels: string;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * 选一个图片文件存成灰度像素：成功返回要并入元素的三个字段；不行时已经提示过，返回 null。
 * exceptId 是这张图片元素自己的 id（算模板图片总量时不算它当前已经占的那部分，换图不等于多占空间）；
 * elements 是调用这一刻的当前元素列表，由调用方每次传入当下最新的草稿，这里不缓存、不跨调用复用。
 */
export type ImageImporter = (
  file: File,
  exceptId: string,
  elements: readonly CanvasElement[],
) => Promise<ImportedImagePixels | null>;

/** 这个文件不是能认出的图片格式，或者太大导致这里拒绝解码：两种情况用同一句话，操作员不用分辨原因。 */
const UNREADABLE_IMAGE_NOTICE = '这个文件不是能识别的图片：请选 PNG、JPEG、BMP、GIF 或 WebP';

async function readImage(
  file: File,
  exceptId: string,
  elements: readonly CanvasElement[],
): Promise<ImportedImagePixels | null> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    notices.push('warning', `图片文件超过 ${megabytes(MAX_IMAGE_FILE_BYTES)}MB：换一张小一点的`);
    return null;
  }
  // 解码前先从文件头看一眼像素尺寸（不用真正解码）：巨大的图片一旦交给 createImageBitmap 真解码，
  // 光是解出来的位图就可能占几百 MB 到几 GB 内存，页面会卡死甚至崩溃，必须在这之前拦住。
  const header = new Uint8Array(await file.slice(0, IMAGE_HEADER_PEEK_BYTES).arrayBuffer());
  const sourceSize = readImagePixelSize(header);
  if (sourceSize === null) {
    notices.push('warning', UNREADABLE_IMAGE_NOTICE);
    return null;
  }
  if (sourceSize.width * sourceSize.height > MAX_IMAGE_SOURCE_PIXELS) {
    notices.push(
      'warning',
      `图片太大（${sourceSize.width}×${sourceSize.height} 像素），请先缩小到 ${MAX_IMAGE_SOURCE_PIXELS} 像素以内再导入`,
    );
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    console.warn('[renderer] cannot decode the picked image', file.type, error);
    notices.push('warning', UNREADABLE_IMAGE_NOTICE);
    return null;
  }
  try {
    const target = fitPixelBudget(bitmap.width, bitmap.height, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels);
    if (!fitsTemplateBudget(elements, exceptId, target.width * target.height)) {
      notices.push(
        'warning',
        `一个模板里的图片加起来最多 ${megabytes(CANVAS_LIMITS.templateImageBytes)}MB：先删掉一张图，或换一张小一点的`,
      );
      return null;
    }
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('OffscreenCanvas has no 2d context');
    }
    // 缩小用高质量插值：照片缩到像素预算以内时不出锯齿和摩尔纹。
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const { data } = context.getImageData(0, 0, target.width, target.height);
    return {
      pixels: bytesToBase64(rgbaToGray(data, target.width, target.height)),
      pixelWidth: target.width,
      pixelHeight: target.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * 「选择图片」：在这个页面里（sandbox 的渲染进程）把图片文件解码成灰度像素。
 * 主进程从不解码图片文件（Chromium 的两条法则：不可信的输入不进高权限进程里的 C++ 解码器），只拿到校验过的灰度像素。
 * 解码交给浏览器：createImageBitmap 解码，OffscreenCanvas 缩到要存的尺寸并取出 RGBA。
 */
export function useImageImport(): ImageImporter {
  return useCallback(async (file, exceptId, elements) => {
    try {
      return await readImage(file, exceptId, elements);
    } catch (error) {
      reportError('读取图片', error);
      return null;
    }
  }, []);
}
