import { Notification } from 'electron';
import type { AlertThrottle } from './alert-throttle';
import type { NotReadyListener } from './printer-status';

/**
 * 打印机变为不能打印（离线、缺纸、卡纸……）时弹出系统通知，点击回到主窗口。
 * 样衣间常常无人盯着屏幕：扫码后没出纸时，这是最直接的提醒。按问题类型节流，避免刷屏。
 */
export function createPrinterAlertNotifier(throttle: AlertThrottle, onClick: () => void): NotReadyListener {
  return (printerName, detail) => {
    if (!Notification.isSupported() || !throttle.shouldNotify(detail)) {
      return;
    }
    const notification = new Notification({
      title: `打印机需要处理：${detail}`,
      body: `${printerName}。处理好之前扫码不会出纸，恢复后会自动继续可用。`,
    });
    notification.on('click', onClick);
    notification.show();
  };
}
