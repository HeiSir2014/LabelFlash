import { useCallback, useRef, useState } from 'react';
import type { PrintResult } from '../../../core/types';
import type { LabelPreview, RendererPrintSource } from '../../../shared/ipc-contract';
import { playFeedback } from '../lib/feedback-sound';
import { reportError } from '../lib/notices';
import { RepeatFilter } from '../lib/repeat-filter';
import { describeResult, type ScanSnapshot } from '../lib/status-text';

const SCAN_REPEAT_INTERVAL_MS = 1_000;
const NO_PREVIEW: LabelPreview = { result: { status: 'invalid', reason: 'INVALID_FORMAT' }, html: null };

export interface ScanState extends ScanSnapshot {
  /** 递增序号：旧扫描的异步结果不能覆盖新扫描的界面。 */
  seq: number;
  source: RendererPrintSource;
}

interface StationOptions {
  printerName: string | null;
  autoPrint: boolean;
  onJobRecorded: () => void;
}

interface LoadMode {
  source: RendererPrintSource;
  printNow: boolean;
}

export function useScanStation({ printerName, autoPrint, onJobRecorded }: StationOptions) {
  const repeatFilter = useRef(new RepeatFilter(SCAN_REPEAT_INTERVAL_MS));
  const latestSeq = useRef(0);
  const [scan, setScan] = useState<ScanState | null>(null);

  const patchIfCurrent = useCallback((seq: number, patch: Partial<ScanState>) => {
    setScan((current) => (current && current.seq === seq ? { ...current, ...patch } : current));
  }, []);

  const print = useCallback(
    async (seq: number, raw: string, source: RendererPrintSource, force: boolean) => {
      if (!printerName) {
        playFeedback('warning');
        return;
      }
      patchIfCurrent(seq, { isPrinting: true, print: null, hasIpcError: false });
      let result: PrintResult;
      try {
        result = await window.api.print(raw, printerName, { source, force });
      } catch (error) {
        reportError('打印', error);
        patchIfCurrent(seq, { isPrinting: false, hasIpcError: true });
        playFeedback('error');
        return;
      }
      patchIfCurrent(seq, { isPrinting: false, print: result });
      // 即使界面已切到更新的扫描，也要让操作员听到这一张的结果。
      playFeedback(describeResult(result, Date.now()).tone);
      onJobRecorded();
    },
    [printerName, patchIfCurrent, onJobRecorded],
  );

  const load = useCallback(
    async (raw: string, mode: LoadMode) => {
      latestSeq.current += 1;
      const seq = latestSeq.current;
      let preview = NO_PREVIEW;
      let hasIpcError = false;
      try {
        preview = await window.api.preview(raw);
      } catch (error) {
        reportError('生成预览', error);
        hasIpcError = true;
      }
      const isValid = !hasIpcError && preview.result.status === 'ok';
      const willPrint = mode.printNow && isValid && printerName !== null;
      if (seq === latestSeq.current) {
        setScan({ seq, raw, preview, source: mode.source, print: null, isPrinting: willPrint, hasIpcError });
      }
      if (!isValid) {
        playFeedback('error');
        return;
      }
      if (mode.printNow) {
        // 自动模式下每一次扫码都要打印，哪怕界面已被更新的扫描取代；没选打印机时 print 会发出警告音。
        await print(seq, raw, mode.source, false);
      }
    },
    [printerName, print],
  );

  const scanCode = useCallback(
    (input: string) => {
      const raw = input.trim();
      if (raw === '' || !repeatFilter.current.shouldAccept(raw)) {
        return;
      }
      void load(raw, { source: 'desktop', printNow: autoPrint });
    },
    [autoPrint, load],
  );

  const review = useCallback((raw: string) => void load(raw, { source: 'history', printNow: false }), [load]);
  const reprint = useCallback((raw: string) => void load(raw, { source: 'history', printNow: true }), [load]);

  const printCurrent = useCallback(
    (force: boolean) => {
      if (scan) {
        void print(scan.seq, scan.raw, scan.source, force);
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
      patchIfCurrent(scan.seq, { preview: await window.api.preview(scan.raw) });
    } catch (error) {
      reportError('刷新预览', error);
    }
  }, [scan, patchIfCurrent]);

  return { scan, scanCode, review, reprint, printCurrent, refreshPreview };
}
