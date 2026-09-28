/**
 * 扫码页上的文字与按钮。
 * 任务结果的标题一律取 VOICE_CUE_TEXT（经 print-cues 对应），和电脑的状态栏、语音同一句话；说明写手机上该怎么做。
 */
import type { InvalidReason, PrintFailureReason } from '../../../src/core/types';
import { formatWindow } from '../../../src/shared/duration-text';
import {
  type DenialReason,
  type EndReason,
  MAX_PHONES_PER_SESSION,
  type PhonePrintResult,
  type RefusalReason,
} from '../../../src/shared/mobile-protocol';
import { printResultCue } from '../../../src/shared/print-cues';
import { PRINT_TIMEOUT_SECONDS } from '../../../src/shared/print-timing';
import { VOICE_CUE_LEVEL, VOICE_CUE_TEXT, type VoiceCue, type VoiceLevel } from '../../../src/shared/voice';
import type { JobEntry, LinkState, PhoneState } from './phone-state';

export type Tone = 'pending' | 'success' | 'warning' | 'error';
/** retry = 同一内容再提交一次；force = 强制补打。两者都是新的任务。 */
export type JobAction = 'retry' | 'force';

export interface JobView {
  tone: Tone;
  title: string;
  detail: string;
  actions: JobAction[];
}

export interface MessageView {
  title: string;
  text: string;
}

/** 打印成功时列出的字段值个数：一行放得下，又认得出是哪一张。 */
const SUMMARY_FIELDS = 4;

const LEVEL_TONE: Record<VoiceLevel, Tone> = { confirm: 'success', notice: 'warning', alert: 'error' };

const INVALID_DETAILS: Record<InvalidReason, string> = {
  INVALID_CONTENT: '内容为空、太长或含有不可见字符',
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

const REFUSAL_TITLES: Record<RefusalReason, string> = {
  'rate-limited': '打印太频繁，这张没有打印',
  'too-many-pending': '电脑上排队的太多，这张没有打印',
};

const RESTART_HINT = '需要时在电脑上重新点「手机扫码」。';

const DENIAL_VIEWS: Record<DenialReason, MessageView> = {
  full: {
    title: '手机已满',
    text: `这个二维码已经有 ${MAX_PHONES_PER_SESSION} 部手机在用。请在电脑上移除不用的手机后再扫。`,
  },
  removed: {
    title: '这部手机已被移除',
    text: '电脑上把这部手机移除了。需要继续用的话，重新扫电脑屏幕上的二维码。',
  },
};

const END_TEXTS: Record<EndReason, string> = {
  stopped: `电脑上已结束手机扫码。${RESTART_HINT}`,
  idle: `超过 30 分钟没有扫码，已自动结束。${RESTART_HINT}`,
  quit: `电脑上的程序已退出。${RESTART_HINT}`,
  'desktop-gone': `电脑断线超过 2 分钟，已结束。${RESTART_HINT}`,
};

export function jobView(job: JobEntry, link: LinkState): JobView {
  switch (job.status) {
    case 'sending':
      return {
        tone: 'pending',
        title: link === 'online' ? '正在发送…' : '等电脑连上后自动发送',
        detail: job.raw,
        actions: [],
      };
    case 'queued':
      return { tone: 'pending', title: queueTitle(job.ahead ?? 0), detail: job.raw, actions: [] };
    case 'printing':
      return { tone: 'pending', title: '正在打印…', detail: job.raw, actions: [] };
    case 'refused':
      return {
        tone: 'warning',
        title: REFUSAL_TITLES[job.refusal ?? 'rate-limited'],
        detail: job.raw,
        actions: ['retry'],
      };
    case 'done':
      return job.result
        ? resultView(job.result, job.force, job.raw)
        : { tone: 'pending', title: '', detail: job.raw, actions: [] };
  }
}

function resultView(result: PhonePrintResult, forced: boolean, raw: string): JobView {
  switch (result.status) {
    case 'printed': {
      const summary = result.fields
        .slice(0, SUMMARY_FIELDS)
        .map((field) => field.value)
        .join(' · ');
      return { ...cueView(printResultCue(result, forced ? 'force' : 'scan')), detail: summary || raw, actions: [] };
    }
    case 'duplicate': {
      const cue = printResultCue(result, 'scan');
      if (result.recent.state === 'printing') {
        return { ...cueView(cue), detail: '同一标签正在打印', actions: [] };
      }
      return {
        ...cueView(cue),
        detail: `${formatWindow(result.windowMs)}内同一标签只打一次；确实要再打一张就点「强制补打」`,
        actions: ['force'],
      };
    }
    case 'invalid':
      return { ...cueView('invalid'), detail: INVALID_DETAILS[result.reason], actions: [] };
    case 'failed':
      return {
        ...cueView(printResultCue(result, 'scan')),
        detail: FAILURE_DETAILS[result.reason](result.detail),
        actions: result.reason === 'PRINT_TIMEOUT' ? ['force'] : ['retry'],
      };
    case 'no-printer':
      return { ...cueView('noPrinter'), detail: '在电脑上选择打印机后点「重试」', actions: ['retry'] };
  }
}

/** 占满整页的提示：没有链接、正在连接、已结束、链接失效、没被接纳；扫码中返回 null。 */
export function messageView(state: PhoneState): MessageView | null {
  switch (state.screen) {
    case 'no-link':
      return { title: '请从电脑上打开', text: '在电脑上点「手机扫码」，再用手机相机或微信扫电脑屏幕上的二维码。' };
    case 'connecting':
      return { title: '正在连接电脑…', text: '' };
    case 'ended':
      return { title: '手机扫码已结束', text: END_TEXTS[state.endReason ?? 'stopped'] };
    case 'not-found':
      return { title: '链接已失效', text: `这个二维码已经过期或已结束。${RESTART_HINT}` };
    case 'denied':
      return DENIAL_VIEWS[state.denial ?? 'removed'];
    case 'scanning':
      return null;
  }
}

/** 连接断开时顶部的提示条；在线时不显示。 */
export function linkBanner(link: LinkState): string | null {
  switch (link) {
    case 'online':
      return null;
    case 'reconnecting':
      return '网络断了，正在重新连接…扫到的会先存在手机上';
    case 'desktop-offline':
      return '电脑暂时断线，正在等它回来…扫到的会先存在手机上';
  }
}

/** 所有手机的任务共用一个队列：告诉拿手机的人还要等几张。 */
function queueTitle(ahead: number): string {
  return ahead === 0 ? '排队中，下一张就是它' : `排队中，前面还有 ${ahead} 张`;
}

function cueView(cue: VoiceCue): Pick<JobView, 'tone' | 'title'> {
  return { tone: LEVEL_TONE[VOICE_CUE_LEVEL[cue]], title: VOICE_CUE_TEXT[cue] };
}
