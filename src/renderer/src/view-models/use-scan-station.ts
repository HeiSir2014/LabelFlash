import { useCallback, useState } from 'react';
import type { PrintResult } from '../../../core/types';
import type { LabelPreview, RendererPrintSource } from '../../../shared/ipc-contract';
import type { FeedbackEvent, PrintMode } from '../lib/feedback-cues';
import { reportError } from '../lib/notices';
import { QueryIndicator } from '../lib/query-indicator';
import type { ScanSnapshot } from '../lib/status-text';
import { WINDOW_TIMERS } from '../lib/timers';

const NO_PREVIEW: LabelPreview = {
  result: { status: 'invalid', reason: 'INVALID_CONTENT' },
  html: null,
  templateId: null,
  templateName: null,
  isTemplateBound: false,
  qrOmitted: false,
  paper: null,
};
/** 识别超过这么久（通常是查找表或接口查询）才显示「正在查询」，快的扫码不闪一下。 */
const QUERYING_DELAY_MS = 200;

export interface ScanState extends ScanSnapshot {
  /** 递增序号：旧扫描的异步结果不能覆盖新扫描的界面。 */
  seq: number;
  source: RendererPrintSource;
  /** 按这条打印记录里的模板和字段预览、打印（本机接口的记录，见 lib/reprint.ts）；null = 按内容识别。 */
  jobId: string | null;
}

/** 从打印记录预览或重打的一条：jobId 不为 null 时按记录里的模板和字段，不重新识别。 */
export interface HistoryTarget {
  raw: string;
  jobId: string | null;
}

interface StationOptions {
  autoPrint: boolean;
  onJobRecorded: () => void;
  /** 语音确认 / 提示音。 */
  announce: (event: FeedbackEvent) => void;
}

interface LoadMode {
  source: RendererPrintSource;
  printNow: boolean;
  jobId: string | null;
}

/** 播报要说清这张是怎么打出来的：补打、从记录重打，还是正常扫码。 */
function printMode(source: RendererPrintSource, force: boolean): PrintMode {
  if (force) {
    return 'force';
  }
  return source === 'history' ? 'history' : 'scan';
}

export function useScanStation({ autoPrint, onJobRecorded, announce }: StationOptions) {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [queryingRaw, setQueryingRaw] = useState<string | null>(null);
  // 查询慢时先说「正在查询」，上一张的预览留着，不清空成白板。
  const [querying] = useState(() => new QueryIndicator(QUERYING_DELAY_MS, setQueryingRaw, WINDOW_TIMERS));

  const patchIfCurrent = useCallback((seq: number, patch: Partial<ScanState>) => {
    setScan((current) => (current && current.seq === seq ? { ...current, ...patch } : current));
  }, []);

  const print = useCallback(
    // 打到哪台由主进程按模板决定；这种纸没有打印机时返回 no-printer，照常显示和播报。
    async (seq: number, raw: string, source: RendererPrintSource, force: boolean, jobId: string | null) => {
      patchIfCurrent(seq, { isPrinting: true, print: null, hasIpcError: false });
      let result: PrintResult;
      try {
        // 按记录重打不经过防重复窗口，force 对它没有意义。
        result = jobId === null ? await window.api.print(raw, { source, force }) : await window.api.reprintJob(jobId);
      } catch (error) {
        reportError('打印', error);
        patchIfCurrent(seq, { isPrinting: false, hasIpcError: true });
        announce({ kind: 'internal-error' });
        return;
      }
      patchIfCurrent(seq, { isPrinting: false, print: result });
      // 即使界面已切到更新的扫描，也要让操作员听到这一张的结果。
      announce({ kind: 'result', result, mode: printMode(source, force) });
      onJobRecorded();
    },
    [patchIfCurrent, onJobRecorded, announce],
  );

  const load = useCallback(
    async (raw: string, mode: LoadMode) => {
      const seq = querying.start(raw);
      let preview = NO_PREVIEW;
      let hasIpcError = false;
      try {
        preview = mode.jobId === null ? await window.api.preview(raw) : await window.api.previewJob(mode.jobId);
      } catch (error) {
        reportError('生成预览', error);
        hasIpcError = true;
      } finally {
        querying.finish(seq);
      }
      const isValid = !hasIpcError && preview.result.status === 'ok';
      // 这种纸没有打印机时照样交给主进程（它返回 no-printer），但不先说「正在打印…」：只说程序确知的事。
      const hasPrinter = preview.result.status === 'ok' && preview.result.printer.printerName !== null;
      const willPrint = mode.printNow && isValid && hasPrinter;
      if (querying.isLatest(seq)) {
        setScan({
          seq,
          raw,
          preview,
          source: mode.source,
          jobId: mode.jobId,
          print: null,
          isPrinting: willPrint,
          hasIpcError,
        });
      }
      if (!isValid) {
        announce(hasIpcError ? { kind: 'internal-error' } : { kind: 'invalid' });
        return;
      }
      if (mode.printNow) {
        // 自动模式下每一次扫码都要打印，哪怕界面已被更新的扫描取代；没有打印机时主进程返回 no-printer。
        await print(seq, raw, mode.source, false, mode.jobId);
      } else {
        // 手动模式：确认扫到了，等操作员核对预览后按 F2。
        announce({ kind: 'scanned' });
      }
    },
    [print, announce, querying],
  );

  // 扫码枪连按由主进程的防重复窗口统一拦截（设置里可调，默认 3 秒），拦截结果会显示、播报并记入打印记录。
  const scanCode = useCallback(
    (input: string) => {
      const raw = input.trim();
      if (raw === '') {
        return;
      }
      void load(raw, { source: 'desktop', printNow: autoPrint, jobId: null });
    },
    [autoPrint, load],
  );

  const review = useCallback(
    ({ raw, jobId }: HistoryTarget) => void load(raw, { source: 'history', printNow: false, jobId }),
    [load],
  );
  const reprint = useCallback(
    ({ raw, jobId }: HistoryTarget) => void load(raw, { source: 'history', printNow: true, jobId }),
    [load],
  );

  const printCurrent = useCallback(
    (force: boolean) => {
      if (scan) {
        void print(scan.seq, scan.raw, scan.source, force, scan.jobId);
      }
    },
    [scan, print],
  );

  /** 切换或保存模板后，按新模板重新生成当前标签的预览。 */
  const refreshPreview = useCallback(async () => {
    if (!scan) {
      return;
    }
    try {
      const preview =
        scan.jobId === null ? await window.api.preview(scan.raw) : await window.api.previewJob(scan.jobId);
      patchIfCurrent(scan.seq, { preview });
    } catch (error) {
      reportError('刷新预览', error);
    }
  }, [scan, patchIfCurrent]);

  return { scan, queryingRaw, scanCode, review, reprint, printCurrent, refreshPreview };
}
