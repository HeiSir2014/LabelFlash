import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaperCheck } from '../../../shared/driver-paper';
import { reportError } from '../lib/notices';

/**
 * 当前打印机的驱动纸张检测。选中打印机时查一次；窗口重新获得焦点、打印首选项关闭后再查，
 * 操作员改完驱动设置回到程序，提示会自动消失。
 */
export function useDriverPaper(printerName: string | null, isListed: boolean) {
  const [check, setCheck] = useState<PaperCheck | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const target = printerName !== null && isListed ? printerName : null;
  // 切换打印机后，上一台打印机迟到的查询结果要丢掉。
  const currentTarget = useRef(target);
  currentTarget.current = target;

  const refresh = useCallback(async (): Promise<void> => {
    if (target === null) {
      return;
    }
    try {
      const next = await window.api.checkDriverPaper(target);
      if (currentTarget.current === target) {
        setCheck(next);
      }
    } catch (error) {
      console.error('[renderer] driver paper check failed', error);
    }
  }, [target]);

  useEffect(() => {
    setCheck(null);
    if (target === null) {
      return;
    }
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [target, refresh]);

  const openPreferences = useCallback(async (): Promise<void> => {
    if (target === null) {
      return;
    }
    setIsOpening(true);
    try {
      await window.api.openPrinterPreferences(target);
      await refresh();
    } catch (error) {
      reportError('打开打印首选项', error);
    } finally {
      setIsOpening(false);
    }
  }, [target, refresh]);

  return { check, isOpening, openPreferences };
}
