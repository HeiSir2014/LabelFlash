import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHANGE_COMMAND_SET,
  type CheckVerdict,
  type DiagnosisCheckId,
  type DiagnosisFixId,
  type FixOffer,
  type FixOutcome,
} from '../../../shared/diagnosis';
import {
  checksAfterFix,
  type DiagnosisView,
  startDiagnosis,
  withChecking,
  withCommandSetPicker,
  withFeedAnswer,
  withFixOutcome,
  withFixStarted,
  withRequeued,
  withVerdict,
} from '../lib/diagnosis-view';
import { reportError } from '../lib/notices';

/** 打印机页用到的诊断状态和操作。 */
export interface DiagnosisControls {
  view: DiagnosisView | null;
  /** 开始诊断一台打印机（printerName 为 null：只查后台打印服务）。 */
  open(printerName: string | null): void;
  close(): void;
  rerun(): void;
  applyFix(check: DiagnosisCheckId, offer: FixOffer): void;
  answerFeed(works: boolean): void;
}

const INTERNAL_ERROR = '程序内部出错，详情在日志里';

function failedCheck(check: DiagnosisCheckId): CheckVerdict {
  return { check, status: 'unknown', detail: `这一项没查成：${INTERNAL_ERROR}`, nextStep: null, fixes: [] };
}

/**
 * 按顺序一项一项调主进程（一项查完再查下一项，面板上逐项出结果）。
 * 每次开始、关闭加一轮：旧的一轮还在路上时，回来的结果不写进新的一轮。
 * 这台打印机负责的纸由主进程自己按设置和模板查（M2），这里不算、也不传。
 */
export function useDiagnosis(): DiagnosisControls {
  const [view, setView] = useState<DiagnosisView | null>(null);
  const runRef = useRef(0);
  // 最新的面板状态：修复时要用它的打印机。在 effect 里更新，不在渲染过程中改 ref。
  const viewRef = useRef<DiagnosisView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const update = useCallback((change: (current: DiagnosisView) => DiagnosisView) => {
    setView((current) => (current === null ? null : change(current)));
  }, []);

  const runChecks = useCallback(
    async (run: number, printerName: string | null, checks: readonly DiagnosisCheckId[]) => {
      for (const check of checks) {
        if (runRef.current !== run) {
          return;
        }
        update((current) => withChecking(current, check));
        let verdict: CheckVerdict;
        try {
          verdict = await window.api.runDiagnosisCheck(printerName, check);
        } catch (error) {
          reportError('诊断打印机', error);
          verdict = failedCheck(check);
        }
        if (runRef.current !== run) {
          return;
        }
        update((current) => withVerdict(current, verdict));
      }
    },
    [update],
  );

  const open = useCallback(
    (printerName: string | null) => {
      runRef.current += 1;
      const next = startDiagnosis(printerName);
      setView(next);
      void runChecks(
        runRef.current,
        printerName,
        next.items.map((item) => item.check),
      );
    },
    [runChecks],
  );

  const close = useCallback(() => {
    runRef.current += 1;
    setView(null);
  }, []);

  const rerun = useCallback(() => {
    const current = viewRef.current;
    if (current !== null) {
      open(current.printerName);
    }
  }, [open]);

  const runFix = useCallback(
    async (current: DiagnosisView, check: DiagnosisCheckId, fix: DiagnosisFixId, admin: boolean) => {
      const run = runRef.current;
      update((latest) => withFixStarted(latest, fix));
      let outcome: FixOutcome;
      try {
        outcome = await window.api.applyDiagnosisFix({ printerName: current.printerName, fix, admin });
      } catch (error) {
        reportError('修复打印机问题', error);
        outcome = { status: 'failed', message: `没做成：${INTERNAL_ERROR}` };
      }
      if (runRef.current !== run) {
        return;
      }
      update((latest) => withFixOutcome(latest, check, fix, outcome));
      if (outcome.status === 'done' || outcome.status === 'rolled-back') {
        const checks = checksAfterFix(current, fix);
        update((latest) => withRequeued(latest, checks));
        await runChecks(run, current.printerName, checks);
      }
    },
    [runChecks, update],
  );

  const applyFix = useCallback(
    (check: DiagnosisCheckId, offer: FixOffer) => {
      const current = viewRef.current;
      if (current === null || current.busyFix !== null) {
        return;
      }
      if (offer.id === CHANGE_COMMAND_SET) {
        update(withCommandSetPicker);
        return;
      }
      void runFix(current, check, offer.id, offer.admin);
    },
    [runFix, update],
  );

  const answerFeed = useCallback((works: boolean) => update((current) => withFeedAnswer(current, works)), [update]);

  return { view, open, close, rerun, applyFix, answerFeed };
}
