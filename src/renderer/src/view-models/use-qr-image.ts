import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** 二维码边长（CSS 像素）：手机在正常距离能一次扫出，又不占用太多「关于」的空间。 */
export const QR_IMAGE_SIZE_PX = 132;
/** 按两倍像素生成，高分屏上边缘也清晰。 */
const QR_PIXEL_RATIO = 2;

/**
 * 在本机把文本生成二维码图片（data URL），不请求任何在线服务；生成前或没有文本时为 null。
 * sizePx 是显示的边长（CSS 像素）。
 */
export function useQrImage(text: string | null, sizePx = QR_IMAGE_SIZE_PX): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setDataUrl(null);
    if (text === null) {
      return;
    }
    let isActive = true;
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: sizePx * QR_PIXEL_RATIO }).then(
      (url) => {
        if (isActive) {
          setDataUrl(url);
        }
      },
      (error: unknown) => console.error('[renderer] failed to draw the QR code', error),
    );
    return () => {
      isActive = false;
    };
  }, [text, sizePx]);

  return dataUrl;
}
