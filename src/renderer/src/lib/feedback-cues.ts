import type { PrintFailureReason, PrintResult } from '../../../core/types';
import type { PrinterIssue } from '../../../shared/printer-readiness';
import { VOICE_CUE_LEVEL, type VoiceCue, type VoiceLevel } from '../../../shared/voice';
import type { FeedbackTone } from './status-text';

/** 这次打印是怎么发起的：扫码、强制补打、从打印记录重打、打测试页。 */
export type PrintMode = 'scan' | 'force' | 'history' | 'test';

/** 需要给操作员反馈（语音或提示音）的时刻。 */
export type FeedbackEvent =
  | { kind: 'result'; result: PrintResult; mode: PrintMode }
  | { kind: 'invalid' }
  | { kind: 'no-printer' }
  /** 手动模式下扫码成功、预览已出来（等待按 F2）。 */
  | { kind: 'scanned' }
  | { kind: 'internal-error' };

export interface FeedbackCue {
  cue: VoiceCue;
  /** 语音不可用时退回的提示音：按播报级别选。 */
  tone: FeedbackTone;
}

const LEVEL_TONE: Record<VoiceLevel, FeedbackTone> = {
  confirm: 'success',
  notice: 'warning',
  alert: 'error',
};

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

export function describeFeedback(event: FeedbackEvent): FeedbackCue {
  return cueFeedback(cueFor(event));
}

/** 某一句播报及其兜底提示音（设置页逐句试听也用它）。 */
export function cueFeedback(cue: VoiceCue): FeedbackCue {
  return { cue, tone: LEVEL_TONE[VOICE_CUE_LEVEL[cue]] };
}

function cueFor(event: FeedbackEvent): VoiceCue {
  switch (event.kind) {
    case 'result':
      return resultCue(event.result, event.mode);
    case 'invalid':
      return 'invalid';
    case 'no-printer':
      return 'noPrinter';
    case 'scanned':
      return 'scanned';
    case 'internal-error':
      return 'internalError';
  }
}

function resultCue(result: PrintResult, mode: PrintMode): VoiceCue {
  switch (result.status) {
    case 'printed':
      return PRINTED_CUE[mode];
    case 'duplicate':
      return result.recent.state === 'printing' ? 'stillPrinting' : 'duplicate';
    case 'invalid':
      return 'invalid';
    case 'failed':
      return failureCue(result.reason, result.issue);
  }
}

function failureCue(reason: PrintFailureReason, issue: PrinterIssue | undefined): VoiceCue {
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
