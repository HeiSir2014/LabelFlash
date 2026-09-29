import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaperCheck } from '../../../shared/driver-paper';
import { DEFAULT_PAPER } from '../../../shared/label-paper';
import { paperKey } from '../../../shared/paper-sizes';
import { PRINTER_STATUS_POLL_MS } from '../../../shared/print-timing';
import type { PrinterReadiness } from '../../../shared/printer-readiness';
import { reportError } from '../lib/notices';

export interface PrinterProfile {
  /** 驱动纸张和这台应该装的纸比较的结果；还没读到时为 null。 */
  paper: PaperCheck | null;
  /** 主进程后台检测的状态；null = 未知（没有被分配、尚未查询或 macOS）。 */
  readiness: PrinterReadiness | null;
}

const LABEL_PAPER_KEY = paperKey(DEFAULT_PAPER);
/** 名字列表按内容比较时的分隔符：打印机名里不会有换行。 */
const NAME_SEPARATOR = '\n';

function splitNames(key: string): string[] {
  return key === '' ? [] : key.split(NAME_SEPARATOR);
}

/** 读一台打印机的驱动纸张，和 expectedKey（它应该装的纸，没有时按 60×40）比较；出错按「读不到」。 */
async function checkPaper(name: string, expectedKey: string | undefined): Promise<[string, PaperCheck | null]> {
  try {
    return [name, await window.api.checkDriverPaper(name, expectedKey ?? LABEL_PAPER_KEY)];
  } catch (error) {
    console.error('[renderer] driver paper check failed', error);
    return [name, null];
  }
}

async function readReadiness(name: string): Promise<[string, PrinterReadiness | null]> {
  try {
    return [name, await window.api.printerStatus(name)];
  } catch (error) {
    console.error('[renderer] printer status failed', error);
    return [name, null];
  }
}

/**
 * 打印机页和标题栏用到的每台打印机的资料：
 * - 驱动纸张：系统里的每台打印机都读一次（主进程有短时缓存），和它负责的纸（expected，没有时按 60×40）比较；
 * - 状态：只轮询被分配到的打印机（主进程只检测它们），其余为未知。
 * 依赖按名字的内容比较：打印机列表每次窗口获得焦点都会刷新成新数组，不能因此把所有打印机重查一遍。
 */
export function usePrinterProfiles(
  installed: readonly string[],
  watched: readonly string[],
  expected: Readonly<Record<string, string>>,
) {
  const [papers, setPapers] = useState<Record<string, PaperCheck | null>>({});
  const [readiness, setReadiness] = useState<Record<string, PrinterReadiness | null>>({});
  const [openingName, setOpeningName] = useState<string | null>(null);
  const installedKey = installed.join(NAME_SEPARATOR);
  const watchedKey = watched.join(NAME_SEPARATOR);
  const expectedKey = JSON.stringify(expected);
  // 最新的期望纸张：打印首选项关闭后重查那一台时用。在 effect 里更新，不在渲染过程中改 ref。
  const expectedRef = useRef(expected);
  useEffect(() => {
    expectedRef.current = expected;
  }, [expected]);

  useEffect(() => {
    // 分配改了也要重新比较：同一台打印机要核对的纸可能换了。
    const wanted = JSON.parse(expectedKey) as Record<string, string>;
    let isActive = true;
    void Promise.all(splitNames(installedKey).map((name) => checkPaper(name, wanted[name]))).then((entries) => {
      if (isActive) {
        setPapers(Object.fromEntries(entries));
      }
    });
    return () => {
      isActive = false;
    };
  }, [installedKey, expectedKey]);

  useEffect(() => {
    let isActive = true;
    const poll = async () => {
      const entries = await Promise.all(splitNames(watchedKey).map(readReadiness));
      if (isActive) {
        setReadiness(Object.fromEntries(entries));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), PRINTER_STATUS_POLL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [watchedKey]);

  /** 打开这台打印机的「打印首选项」；窗口关闭后重查它的驱动纸张（主进程已丢掉这台的缓存）。 */
  const openPreferences = useCallback(async (name: string): Promise<void> => {
    setOpeningName(name);
    try {
      await window.api.openPrinterPreferences(name);
      const [, check] = await checkPaper(name, expectedRef.current[name]);
      setPapers((current) => ({ ...current, [name]: check }));
    } catch (error) {
      reportError('打开打印首选项', error);
    } finally {
      setOpeningName(null);
    }
  }, []);

  const profileOf = useCallback(
    (name: string): PrinterProfile => ({ paper: papers[name] ?? null, readiness: readiness[name] ?? null }),
    [papers, readiness],
  );

  return { profileOf, openingName, openPreferences };
}
