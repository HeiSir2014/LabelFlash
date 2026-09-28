import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** 二维码边长（CSS 像素）：手机在正常距离能一次扫出，又不占用太多「关于」的空间。 */
export const QR_IMAGE_SIZE_PX = 132;

/** 在本机把文本生成二维码图片（data URL），不请求任何在线服务；生成前为 null。 */
export function useQrImage(text: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: QR_IMAGE_SIZE_PX * 2 }).then(
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
  }, [text]);

  return dataUrl;
}
