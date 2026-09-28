import { useEffect, useState } from 'react';
import { PRINTER_STATUS_POLL_MS } from '../../../shared/print-timing';
import type { PrinterReadiness } from '../../../shared/printer-readiness';

/** 当前打印机的就绪状态（主进程后台检测的缓存结果）；null = 未知。 */
export function usePrinterStatus(printerName: string | null): PrinterReadiness | null {
  const [readiness, setReadiness] = useState<PrinterReadiness | null>(null);

  useEffect(() => {
    setReadiness(null);
    if (!printerName) {
      return;
    }
    let isActive = true;
    const poll = async () => {
      try {
        const next = await window.api.printerStatus(printerName);
        if (isActive) {
          setReadiness(next);
        }
      } catch (error) {
        console.error('[renderer] printer status failed', error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), PRINTER_STATUS_POLL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [printerName]);

  return readiness;
}
