/**
 * 确认页和结果页的文字与按钮。
 * 标题一律取 VOICE_CUE_TEXT（经 print-cues 对应），和电脑的状态栏、语音同一句话；说明写手机上该怎么做。
 */
import type { InvalidReason, PrintFailureReason } from '../../../src/core/types';
import { formatWindow } from '../../../src/shared/duration-text';
import type { PhonePreview } from '../../../src/shared/mobile-protocol';
import { printResultCue } from '../../../src/shared/print-cues';
import { PRINT_TIMEOUT_SECONDS } from '../../../src/shared/print-timing';
import { VOICE_CUE_LEVEL, VOICE_CUE_TEXT, type VoiceCue, type VoiceLevel } from '../../../src/shared/voice';
import type { ResultContent } from './phone-state';

export type Tone = 'success' | 'warning' | 'error';
/** rescan = 继续扫码；retry = 同一张再打一次；force = 强制补打。 */
export type ResultAction = 'rescan' | 'retry' | 'force';

export interface ResultView {
  tone: Tone;
  title: string;
  detail: string;
  actions: ResultAction[];
}

export interface ConfirmView {
  /** 主按钮：打印、强制补打，或不能打印（null）。 */
  action: 'print' | 'force' | null;
  notice: string | null;
}

const LEVEL_TONE: Record<VoiceLevel, Tone> = { confirm: 'success', notice: 'warning', alert: 'error' };

const INVALID_DETAILS: Record<InvalidReason, string> = {
  INVALID_CONTENT: '内容为空、太长或含有不可见字符，换个角度再扫一次',
  NO_MATCHING_RULE: '电脑上没有能识别这种内容的规则。请在电脑的「识别规则」里启用「原样打印」或新建一条规则',
};

/** 确定没有出纸的失败可以直接重试；超时结果不确定，只能确认没出纸后强制补打。 */
const FAILURE_DETAILS: Record<PrintFailureReason, (detail: string | null) => string> = {
  PRINTER_NOT_READY: (detail) => `${detail ?? '打印机当前无法打印'}，处理好后点「重试」`,
  PRINTER_NOT_FOUND: () => '电脑上选的打印机找不到了，请在电脑上重新选择打印机后点「重试」',
  PRINT_TIMEOUT: () =>
    `${PRINT_TIMEOUT_SECONDS} 秒内没有响应，可能已出纸或仍在排队；到打印机旁确认没有出纸，再点「强制补打」`,
  PRINT_ERROR: () => '打印机驱动报错，检查打印机后点「重试」',
  LOOKUP_FAILED: (detail) => `${detail ?? '数据查询失败'}，处理好后点「重试」`,
};

export function resultView(content: ResultContent): ResultView {
  if (content.kind === 'invalid') {
    return { ...cueView('invalid'), detail: INVALID_DETAILS[content.reason], actions: ['rescan'] };
  }
  const { result, forced } = content;
  switch (result.status) {
    case 'printed':
      return { ...cueView(printResultCue(result, forced ? 'force' : 'scan')), detail: '', actions: ['rescan'] };
    case 'duplicate': {
      const cue = printResultCue(result, 'scan');
      if (result.recent.state === 'printing') {
        return { ...cueView(cue), detail: '同一标签正在打印，稍等片刻', actions: ['rescan'] };
      }
      return {
        ...cueView(cue),
        detail: `${formatWindow(result.windowMs)}内同一标签只打一次；确实要再打一张就点「强制补打」`,
        actions: ['force', 'rescan'],
      };
    }
    case 'invalid':
      return { ...cueView('invalid'), detail: INVALID_DETAILS[result.reason], actions: ['rescan'] };
    case 'failed':
      return {
        ...cueView(printResultCue(result, 'scan')),
        detail: FAILURE_DETAILS[result.reason](result.detail),
        actions: result.reason === 'PRINT_TIMEOUT' ? ['force', 'rescan'] : ['retry', 'rescan'],
      };
    case 'no-printer':
      return { ...cueView('noPrinter'), detail: '在电脑上选择打印机后点「重试」', actions: ['retry', 'rescan'] };
  }
}

export function confirmView(preview: Extract<PhonePreview, { status: 'ok' }>): ConfirmView {
  if (preview.lookupFailure !== null) {
    return { action: null, notice: `数据查询失败，这张不会打印：${preview.lookupFailure}` };
  }
  if (preview.recent?.state === 'printing') {
    return { action: null, notice: '同一标签正在打印，稍等片刻再扫' };
  }
  if (preview.recent?.state === 'printed') {
    return {
      action: 'force',
      notice: `${formatWindow(preview.windowMs)}内已打印过这张；确实要再打一张就点「强制补打」`,
    };
  }
  return { action: 'print', notice: null };
}

function cueView(cue: VoiceCue): Pick<ResultView, 'tone' | 'title'> {
  return { tone: LEVEL_TONE[VOICE_CUE_LEVEL[cue]], title: VOICE_CUE_TEXT[cue] };
}
