import type { PrintResult } from '../../../core/types';
import { type PrintMode, printResultCue } from '../../../shared/print-cues';
import { VOICE_CUE_LEVEL, type VoiceCue, type VoiceLevel } from '../../../shared/voice';
import type { FeedbackTone } from './status-text';

export type { PrintMode };

/** 需要给操作员反馈（语音或提示音）的时刻。 */
export type FeedbackEvent =
  | { kind: 'result'; result: PrintResult; mode: PrintMode }
  | { kind: 'invalid' }
  /** 手动模式下扫码成功、预览已出来（等待按 F2）。 */
  | { kind: 'scanned' }
  /** 配置中心里扫了码：不打印，提醒操作员回工作台。 */
  | { kind: 'configuring' }
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
      // 打印结果对应哪句话和手机扫码页共用一份（src/shared/print-cues.ts），两边说法一致。
      return printResultCue(event.result, event.mode);
    case 'invalid':
      return 'invalid';
    case 'configuring':
      return 'configuring';
    case 'scanned':
      return 'scanned';
    case 'internal-error':
      return 'internalError';
  }
}
