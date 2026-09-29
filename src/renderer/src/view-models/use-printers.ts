import { useCallback, useEffect, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';
import { reportError } from '../lib/notices';

export function usePrinters() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** 第一次读完之前不知道系统里有哪些打印机：这时不说「系统里找不到」。窗口每次回到前台都会重读，那时列表是已知的。 */
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPrinters(await window.api.listPrinters());
    } catch (error) {
      reportError('读取打印机列表', error);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }, []);

  /** paperKey 是这台打印机负责的纸：测试页按它的尺寸打印。 */
  const printTest = useCallback(async (printerName: string, paperKey: string): Promise<PrintResult | null> => {
    try {
      return await window.api.printTest(printerName, paperKey);
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

  return { printers, isLoading, hasLoaded, refresh, printTest };
}
