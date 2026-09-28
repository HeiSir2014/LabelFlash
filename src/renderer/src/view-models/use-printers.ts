import { useCallback, useEffect, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';
import { reportError } from '../lib/notices';

export function usePrinters() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPrinters(await window.api.listPrinters());
    } catch (error) {
      reportError('读取打印机列表', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const printTest = useCallback(async (printerName: string): Promise<PrintResult | null> => {
    try {
      return await window.api.printTest(printerName);
    } catch (error) {
      reportError('打印测试页', error);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 窗口重新获得焦点时刷新：新接上的打印机不用手动点刷新。
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return { printers, isLoading, refresh, printTest };
}
