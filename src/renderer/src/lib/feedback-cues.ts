import type { PrintResult } from '../../../core/types';
import type { VoiceCue } from '../../../shared/voice';
import type { FeedbackTone } from './status-text';

/** 需要给操作员反馈（语音或提示音）的时刻。 */
export type FeedbackEvent =
  | { kind: 'result'; result: PrintResult }
  | { kind: 'invalid' }
  | { kind: 'no-printer' }
  /** 手动模式下扫码成功、预览已出来（等待按 F2）。 */
  | { kind: 'scanned' }
  | { kind: 'internal-error' };

export interface FeedbackCue {
  cue: VoiceCue;
  /** 语音不可用时退回的提示音。 */
  tone: FeedbackTone;
}

export function describeFeedback(event: FeedbackEvent): FeedbackCue {
  switch (event.kind) {
    case 'result':
      return describeResultFeedback(event.result);
    case 'invalid':
      return { cue: 'invalid', tone: 'error' };
    case 'no-printer':
      return { cue: 'noPrinter', tone: 'warning' };
    case 'scanned':
      return { cue: 'scanned', tone: 'success' };
    case 'internal-error':
      return { cue: 'failed', tone: 'error' };
  }
}

function describeResultFeedback(result: PrintResult): FeedbackCue {
  switch (result.status) {
    case 'printed':
      return { cue: 'printed', tone: 'success' };
    case 'duplicate':
      return { cue: 'duplicate', tone: 'warning' };
    case 'invalid':
      return { cue: 'invalid', tone: 'error' };
    case 'failed':
      return { cue: 'failed', tone: 'error' };
  }
}
