/**
 * 打印结果 → 播报句。界面的状态栏和语音、手机扫码页的结果标题都按它取 VOICE_CUE_TEXT，
 * 同一件事在电脑上听到的、看到的和手机上看到的是同一句话。
 */
import type { PrintFailureReason, RecentPrint } from '../core/types';
import type { PrinterIssue } from './printer-readiness';
import type { VoiceCue } from './voice';

/** 这次打印是怎么发起的：扫码、强制补打、从打印记录重打、打测试页。 */
export type PrintMode = 'scan' | 'force' | 'history' | 'test';

/** PrintResult 和手机收到的精简结果都满足这个结构；no-printer 只出现在手机收到的结果里。 */
export type PrintOutcome =
  | { status: 'printed' }
  | { status: 'duplicate'; recent: RecentPrint }
  | { status: 'invalid' }
  | { status: 'failed'; reason: PrintFailureReason; issue?: PrinterIssue | null }
  | { status: 'no-printer' };

const PRINTED_CUE: Record<PrintMode, VoiceCue> = {
  scan: 'printed',
  force: 'forced',
  history: 'reprinted',
  test: 'testPrinted',
};

const ISSUE_CUE: Record<PrinterIssue, VoiceCue> = {
  paperOut: 'paperOut',
  paperJam: 'paperJam',
  doorOpen: 'doorOpen',
  offline: 'printerOffline',
  other: 'printerNotReady',
};

export function printResultCue(result: PrintOutcome, mode: PrintMode): VoiceCue {
  switch (result.status) {
    case 'printed':
      return PRINTED_CUE[mode];
    case 'duplicate':
      return result.recent.state === 'printing' ? 'stillPrinting' : 'duplicate';
    case 'invalid':
      return 'invalid';
    case 'failed':
      return failureCue(result.reason, result.issue ?? null);
    case 'no-printer':
      return 'noPrinter';
  }
}

function failureCue(reason: PrintFailureReason, issue: PrinterIssue | null): VoiceCue {
  switch (reason) {
    case 'PRINTER_NOT_READY':
      // 没有分类（例如结果不是来自状态查询）时按「需要处理」播报。
      return ISSUE_CUE[issue ?? 'other'];
    case 'PRINTER_NOT_FOUND':
      return 'printerNotFound';
    case 'PRINT_TIMEOUT':
      return 'timeout';
    case 'PRINT_ERROR':
      return 'failed';
    case 'LOOKUP_FAILED':
      return 'lookupFailed';
  }
}
