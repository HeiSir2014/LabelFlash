/**
 * 把截下来的标签图压成 JPEG（原始字节，协议是二进制帧，不用 base64），随扫码发给电脑。
 * 从高到低试画质，直到不超过上限；都超过时返回 null，这一张就不带图（电脑那一步跳过或按设置处理）。
 */
import type { PixelImage } from './label-crop';

/**
 * 依次试的画质：先用 0.95。模拟评估里从 0.85 提到 0.95，读对从 92.0% 到 92.8%、读错从 1.3% 到 1.0%；
 * 整张标签约 100 KB，最大约 310 KB，远在 MAX_IMAGE_BYTES（512 KB）以内。越往后越小、越糊，超过上限才用。
 */
const JPEG_QUALITIES = [0.95, 0.85, 0.7, 0.55, 0.4] as const;
export async function encodeJpeg(image: PixelImage, maxBytes: number): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  for (const quality of JPEG_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  return null;
}
