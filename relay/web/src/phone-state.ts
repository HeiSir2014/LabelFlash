/**
 * 扫码页的状态机。页面只按状态渲染、把浏览器和连接的事件送进来，状态转换都在这里，用 bun test 测试。
 *
 * 扫到就打：取景一直开着，每扫到一个码就是一个打印任务，列在下面，从「发送中」「排队中」「打印中」走到结果。
 * 几部手机共用电脑上的一个打印队列，排队时显示前面还有几张。
 * 连接状态（link）和任务分开：断线时任务留在手机的发件箱里，重新连上后自动补发（见 phone-session.ts）。
 */
import {
  type DenialReason,
  type EndReason,
  MAX_PENDING_JOBS,
  type PhonePrintResult,
  type RefusalReason,
} from '../../../src/shared/mobile-protocol';
import type { SessionEvent } from './phone-session';

export type Screen =
  | { name: 'no-link' }
  | { name: 'connecting' }
  | { name: 'scanning' }
  | { name: 'ended'; reason: EndReason }
  | { name: 'not-found' }
  | { name: 'denied'; reason: DenialReason }
  /** 中转服务升级了协议，这个页面是旧的：刷新页面。 */
  | { name: 'outdated' };

/** reconnecting = 正在连中转服务；desktop-offline = 中转服务在，电脑暂时断线。 */
export type LinkState = 'online' | 'reconnecting' | 'desktop-offline';

/**
 * idle = 还没打开（等拿手机的人点「开始扫码」：振动和摄像头授权都要在点按之后）；starting = 正在打开；
 * live = 取景中；paused = 页面切到后台时关掉了，回到前台自动再开；unavailable = 打不开或被中断，可以点按重试。
 */
export type CameraState = 'idle' | 'starting' | 'live' | 'paused' | 'unavailable';

/** 识别组件（WebAssembly）：loading = 正在下载；ready = 可以用；failed = 加载失败，只能手动输入。 */
export type DecoderState = 'loading' | 'ready' | 'failed';

/**
 * sending = 还没送达电脑（包括断线时留在发件箱里）；queued = 电脑已收到，在排队；printing = 正在打印；
 * done = 有了结果；refused = 电脑没有接受，没有执行。
 */
export type JobProgress =
  | { status: 'sending' }
  | { status: 'queued'; ahead: number }
  | { status: 'printing' }
  | { status: 'done'; result: PhonePrintResult }
  | { status: 'refused'; reason: RefusalReason };

export type JobEntry = { id: string; raw: string; force: boolean } & JobProgress;

export interface PhoneState {
  screen: Screen;
  link: LinkState;
  camera: CameraState;
  decoder: DecoderState;
  /** 电脑上选的打印机（显示名）；没选时为 null。 */
  printer: string | null;
  /** 最近的任务，新的在前。 */
  jobs: JobEntry[];
}

export type PhoneEvent =
  | SessionEvent
  | { type: 'camera'; camera: Exclude<CameraState, 'idle'> }
  | { type: 'decoder'; decoder: Exclude<DecoderState, 'loading'> };

/** 页面上保留的已结束任务条数：够看清最近扫的一批，列表又不会拉得太长。还在等结果的任务一直保留。 */
export const JOB_HISTORY = 20;

const WAITING_STATUSES: ReadonlySet<JobEntry['status']> = new Set(['sending', 'queued', 'printing']);

export function initialPhoneState(hasLink: boolean): PhoneState {
  return {
    screen: hasLink ? { name: 'connecting' } : { name: 'no-link' },
    link: 'reconnecting',
    camera: 'idle',
    decoder: 'loading',
    printer: null,
    jobs: [],
  };
}

/** 会话对这部手机已经结束（或者根本没有会话）：页面不再变化。 */
export function isFinished(state: PhoneState): boolean {
  return state.screen.name !== 'connecting' && state.screen.name !== 'scanning';
}

export function isWaiting(job: JobEntry): boolean {
  return WAITING_STATUSES.has(job.status);
}

/** 能不能再扫一张：会话进行中，而且等结果的任务没有到上限（断线时也能扫，任务先存在手机上）。 */
export function canSubmit(state: PhoneState): boolean {
  return state.screen.name === 'scanning' && pendingCount(state) < MAX_PENDING_JOBS;
}

export function pendingCount(state: PhoneState): number {
  return state.jobs.filter(isWaiting).length;
}

export function reducePhone(state: PhoneState, event: PhoneEvent): PhoneState {
  if (isFinished(state)) {
    return state;
  }
  switch (event.type) {
    case 'link':
      return { ...state, link: event.link };
    case 'welcomed':
      return {
        ...state,
        link: 'online',
        printer: event.printer,
        screen: state.screen.name === 'connecting' ? { name: 'scanning' } : state.screen,
      };
    case 'printer':
      return { ...state, printer: event.printer };
    case 'camera':
      return { ...state, camera: event.camera };
    case 'decoder':
      return { ...state, decoder: event.decoder };
    case 'submitted': {
      if (state.jobs.some((job) => job.id === event.job)) {
        return state;
      }
      const job: JobEntry = { id: event.job, raw: event.raw, force: event.force, status: 'sending' };
      return { ...state, jobs: trimHistory([job, ...state.jobs]) };
    }
    case 'queued': {
      let next = state;
      for (const { job: id, ahead } of event.positions) {
        // 排队位置会随队伍前进多次更新；已经开始打印或有了结果的，不退回「排队中」。
        next = updateJob(next, id, (job) =>
          job.status === 'sending' || job.status === 'queued' ? { ...job, status: 'queued', ahead } : job,
        );
      }
      return next;
    }
    case 'started':
      return updateJob(state, event.job, (job) =>
        job.status === 'sending' || job.status === 'queued' ? { ...base(job), status: 'printing' } : job,
      );
    case 'result':
      return updateJob(state, event.job, (job) =>
        isWaiting(job) ? { ...base(job), status: 'done', result: event.result } : job,
      );
    case 'refused':
      return updateJob(state, event.job, (job) =>
        isWaiting(job) ? { ...base(job), status: 'refused', reason: event.reason } : job,
      );
    case 'ended':
      return { ...state, screen: { name: 'ended', reason: event.reason } };
    case 'not-found':
      return { ...state, screen: { name: 'not-found' } };
    case 'denied':
      return { ...state, screen: { name: 'denied', reason: event.reason } };
    case 'outdated':
      return { ...state, screen: { name: 'outdated' } };
  }
}

/** 只留任务本身，去掉上一个进度的字段（例如排队位置）。 */
function base(job: JobEntry): Pick<JobEntry, 'id' | 'raw' | 'force'> {
  return { id: job.id, raw: job.raw, force: job.force };
}

/** 超出 JOB_HISTORY 的已结束任务不再显示；还在等结果的一直留着，免得「等结果的张数」算少了。 */
function trimHistory(jobs: JobEntry[]): JobEntry[] {
  return jobs.filter((job, index) => index < JOB_HISTORY || isWaiting(job));
}

function updateJob(state: PhoneState, id: string, update: (job: JobEntry) => JobEntry): PhoneState {
  const index = state.jobs.findIndex((job) => job.id === id);
  const current = state.jobs[index];
  if (!current) {
    return state;
  }
  const next = update(current);
  if (next === current) {
    return state;
  }
  const jobs = [...state.jobs];
  jobs[index] = next;
  return { ...state, jobs };
}
