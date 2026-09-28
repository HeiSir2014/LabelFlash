/**
 * 扫码页上的文字与按钮（纯函数，bun test 测试）。
 * 任务结果的标题一律取 VOICE_CUE_TEXT（经 print-cues 对应），和电脑的状态栏、语音同一句话；说明写手机上该怎么做。
 */
import type { InvalidReason, PrintFailureReason } from '../../../src/core/types';
import { formatWindow } from '../../../src/shared/duration-text';
import {
  DESKTOP_GRACE_MS,
  type DenialReason,
  type EndReason,
  IDLE_END_MS,
  MAX_PENDING_JOBS,
  MAX_PHONES_PER_SESSION,
  MAX_REQUEST_RAW_LENGTH,
  type PhonePrintResult,
  type RefusalReason,
} from '../../../src/shared/mobile-protocol';
import { printResultCue } from '../../../src/shared/print-cues';
import { PRINT_TIMEOUT_SECONDS } from '../../../src/shared/print-timing';
import { VOICE_CUE_LEVEL, VOICE_CUE_TEXT, type VoiceCue, type VoiceLevel } from '../../../src/shared/voice';
import type { CameraState, JobEntry, LinkState, PhoneState } from './phone-state';

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
  /** 整页提示下方的按钮：目前只有「刷新页面」。 */
  action: 'reload' | null;
}

/** 取景框上盖着的提示：还没开始、打不开摄像头、识别组件坏了时显示；按钮点了就（重新）打开摄像头。 */
export interface ViewfinderCover {
  text: string;
  button: string | null;
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
    action: null,
  },
  removed: {
    title: '这部手机已被移除',
    text: '电脑上把这部手机移除了。需要继续用的话，请电脑那边允许新手机加入后，重新扫电脑屏幕上的二维码。',
    action: null,
  },
  locked: {
    title: '暂停加入新手机',
    text: '电脑上暂停了新手机加入。需要加入的话，请在电脑的「手机扫码」里允许新手机加入后再扫。',
    action: null,
  },
};

const END_TEXTS: Record<EndReason, string> = {
  stopped: `电脑上已结束手机扫码。${RESTART_HINT}`,
  idle: `超过 ${formatWindow(IDLE_END_MS)}没有扫码，已自动结束。${RESTART_HINT}`,
  quit: `电脑上的程序已退出。${RESTART_HINT}`,
  'desktop-gone': `电脑断线超过 ${formatWindow(DESKTOP_GRACE_MS)}，已结束。${RESTART_HINT}`,
};

const CAMERA_HINTS: Record<CameraState, string> = {
  idle: '点「开始扫码」打开摄像头',
  starting: '正在打开摄像头…',
  live: '对准条码或二维码，扫到就打印',
  paused: '正在打开摄像头…',
  unavailable: '摄像头没有打开。可以重新打开，或者拍照识别、手动输入。',
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
      return { tone: 'pending', title: queueTitle(job.ahead), detail: job.raw, actions: [] };
    case 'printing':
      return { tone: 'pending', title: '正在打印…', detail: job.raw, actions: [] };
    case 'refused':
      return { tone: 'warning', title: REFUSAL_TITLES[job.reason], detail: job.raw, actions: ['retry'] };
    case 'done':
      return resultView(job.result, job.force, job.raw);
  }
}

/** 结果的级别（和电脑语音的级别一致）：故障级的要振动提醒。 */
export function resultLevel(result: PhonePrintResult): VoiceLevel {
  return VOICE_CUE_LEVEL[printResultCue(result, 'scan')];
}

function resultView(result: PhonePrintResult, forced: boolean, raw: string): JobView {
  const cue = printResultCue(result, forced ? 'force' : 'scan');
  switch (result.status) {
    case 'printed': {
      const summary = result.fields
        .slice(0, SUMMARY_FIELDS)
        .map((field) => field.value)
        .join(' · ');
      return { ...cueView(cue), detail: summary || raw, actions: [] };
    }
    case 'duplicate':
      if (result.recent.state === 'printing') {
        return { ...cueView(cue), detail: '同一标签正在打印', actions: [] };
      }
      return {
        ...cueView(cue),
        detail: `${formatWindow(result.windowMs)}内同一标签只打一次；确实要再打一张就点「强制补打」`,
        actions: ['force'],
      };
    case 'invalid':
      return { ...cueView(cue), detail: INVALID_DETAILS[result.reason], actions: [] };
    case 'failed':
      return {
        ...cueView(cue),
        detail: FAILURE_DETAILS[result.reason](result.detail),
        actions: result.reason === 'PRINT_TIMEOUT' ? ['force'] : ['retry'],
      };
    case 'no-printer':
      return { ...cueView(cue), detail: '在电脑上选择打印机后点「重试」', actions: ['retry'] };
  }
}

/** 占满整页的提示：没有链接、正在连接、已结束、链接失效、没被接纳、页面过旧；扫码中返回 null。 */
export function messageView(state: PhoneState): MessageView | null {
  const { screen } = state;
  switch (screen.name) {
    case 'no-link':
      return {
        title: '请从电脑上打开',
        text: '在电脑上点「手机扫码」，再用手机相机或微信扫电脑屏幕上的二维码。',
        action: null,
      };
    case 'connecting':
      return { title: '正在连接电脑…', text: '', action: null };
    case 'ended':
      return { title: '手机扫码已结束', text: END_TEXTS[screen.reason], action: null };
    case 'not-found':
      return { title: '链接已失效', text: `这个二维码已经过期或已结束。${RESTART_HINT}`, action: null };
    case 'denied':
      return DENIAL_VIEWS[screen.reason];
    case 'outdated':
      return {
        title: '页面需要更新',
        text: '手机扫码的服务已经升级，这个页面是旧的。刷新后就能继续，还没打印的会接着发送。',
        action: 'reload',
      };
    case 'scanning':
      return null;
  }
}

/** 顶栏的打印机：只在扫码时显示，连上之前和结束之后都不显示。 */
export function printerLine(state: PhoneState): string | null {
  if (state.screen.name !== 'scanning') {
    return null;
  }
  return state.printer ? `打印机：${state.printer}` : '电脑上还没选打印机';
}

/** 取景下方的一行提示。识别组件坏了时摄像头开着也没用，优先说它。 */
export function scanHint(state: PhoneState): string {
  return state.decoder === 'failed' ? '识别组件没能加载，可以在下面手动输入' : CAMERA_HINTS[state.camera];
}

/** 取景框上盖着的提示；取景正常时为 null。识别组件坏了时摄像头开了也没用，优先说它。 */
export function viewfinderCover(state: PhoneState): ViewfinderCover | null {
  if (state.decoder === 'failed') {
    return { text: '识别组件没能加载。刷新页面再试；也可以在下面手动输入。', button: null };
  }
  switch (state.camera) {
    case 'idle':
      return { text: '扫到条码或二维码就发送到电脑打印', button: '开始扫码' };
    case 'unavailable':
      return {
        text: '摄像头没有打开（没有授权、被别的应用占用或被中断）',
        button: '重新打开摄像头',
      };
    case 'starting':
    case 'live':
    case 'paused':
      return null;
  }
}

/** 连接断开时顶部的提示条；在线时不显示。 */
export function linkBanner(link: LinkState): string | null {
  switch (link) {
    case 'online':
      return null;
    case 'reconnecting':
      return '网络断了，正在重新连接…扫到的会先存在手机上，连上后自动发送';
    case 'desktop-offline':
      return '电脑暂时断线，正在等它回来…扫到的会先存在手机上，连上后自动发送';
  }
}

/** 等结果的太多时的提示。 */
export const TOO_MANY_PENDING_HINT = `还有 ${MAX_PENDING_JOBS} 张在等结果，稍等再扫`;
export const TOO_LONG_HINT = `内容超过 ${MAX_REQUEST_RAW_LENGTH} 个字，不能打印`;
export const PHOTO_EMPTY_HINT = '照片里没有找到条码或二维码。靠近一点、对准后再拍。';
export const PHOTO_FAILED_HINT = '这张照片读不出来，换一张再试。';

/** 所有手机的任务共用一个队列：告诉拿手机的人还要等几张。 */
function queueTitle(ahead: number): string {
  return ahead === 0 ? '排队中，下一张就是它' : `排队中，前面还有 ${ahead} 张`;
}

function cueView(cue: VoiceCue): Pick<JobView, 'tone' | 'title'> {
  return { tone: LEVEL_TONE[VOICE_CUE_LEVEL[cue]], title: VOICE_CUE_TEXT[cue] };
}
