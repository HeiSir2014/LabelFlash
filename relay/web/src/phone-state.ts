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

export type Screen = 'no-link' | 'connecting' | 'scanning' | 'ended' | 'not-found' | 'denied';

/** reconnecting = 正在连中转服务；desktop-offline = 中转服务在，电脑暂时断线。 */
export type LinkState = 'online' | 'reconnecting' | 'desktop-offline';
export type CameraState = 'pending' | 'live' | 'unavailable';

/**
 * sending = 还没送达电脑（包括断线时留在发件箱里）；queued = 电脑已收到，在排队；printing = 正在打印；
 * done / refused = 有了结果（refused 表示没有执行）。
 */
export type JobStatus = 'sending' | 'queued' | 'printing' | 'done' | 'refused';

export interface JobEntry {
  id: string;
  raw: string;
  force: boolean;
  status: JobStatus;
  /** 排队时前面还有几个任务（所有手机合计）；不在排队时为 null。 */
  ahead: number | null;
  result: PhonePrintResult | null;
  refusal: RefusalReason | null;
}

export interface PhoneState {
  screen: Screen;
  link: LinkState;
  camera: CameraState;
  printer: string | null;
  /** 最近的任务，新的在前。 */
  jobs: JobEntry[];
  endReason: EndReason | null;
  denial: DenialReason | null;
}

export type PhoneEvent =
  | { type: 'link'; link: Exclude<LinkState, 'online'> }
  | { type: 'welcomed'; printer: string | null }
  | { type: 'printer'; printer: string | null }
  | { type: 'camera'; camera: Exclude<CameraState, 'pending'> }
  | { type: 'submitted'; job: string; raw: string; force: boolean }
  | { type: 'accepted'; job: string; ahead: number }
  | { type: 'started'; job: string }
  | { type: 'result'; job: string; result: PhonePrintResult }
  | { type: 'refused'; job: string; reason: RefusalReason }
  | { type: 'ended'; reason: EndReason }
  | { type: 'not-found' }
  | { type: 'denied'; reason: DenialReason };

/** 页面上保留的任务条数：够看清最近扫的一批，列表又不会拉得太长。 */
export const JOB_HISTORY = 20;

const TERMINAL_SCREENS: ReadonlySet<Screen> = new Set(['no-link', 'ended', 'not-found', 'denied']);
const WAITING_STATUSES: ReadonlySet<JobStatus> = new Set(['sending', 'queued', 'printing']);

export function initialPhoneState(hasLink: boolean): PhoneState {
  return {
    screen: hasLink ? 'connecting' : 'no-link',
    link: 'reconnecting',
    camera: 'pending',
    printer: null,
    jobs: [],
    endReason: null,
    denial: null,
  };
}

/** 能不能再扫一张：会话进行中，而且等结果的任务没有到上限（断线时也能扫，任务先留在手机上）。 */
export function canSubmit(state: PhoneState): boolean {
  return state.screen === 'scanning' && pendingCount(state) < MAX_PENDING_JOBS;
}

export function pendingCount(state: PhoneState): number {
  return state.jobs.filter((job) => WAITING_STATUSES.has(job.status)).length;
}

export function reducePhone(state: PhoneState, event: PhoneEvent): PhoneState {
  if (TERMINAL_SCREENS.has(state.screen)) {
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
        screen: state.screen === 'connecting' ? 'scanning' : state.screen,
      };
    case 'printer':
      return { ...state, printer: event.printer };
    case 'camera':
      return { ...state, camera: event.camera };
    case 'submitted': {
      const job: JobEntry = {
        id: event.job,
        raw: event.raw,
        force: event.force,
        status: 'sending',
        ahead: null,
        result: null,
        refusal: null,
      };
      return { ...state, jobs: [job, ...state.jobs].slice(0, JOB_HISTORY) };
    }
    case 'accepted':
      // 排队位置会随队伍前进多次更新；已经开始打印或有了结果的，不退回「排队中」。
      return updateJob(state, event.job, (job) =>
        job.status === 'sending' || job.status === 'queued' ? { ...job, status: 'queued', ahead: event.ahead } : job,
      );
    case 'started':
      return updateJob(state, event.job, (job) =>
        WAITING_STATUSES.has(job.status) ? { ...job, status: 'printing', ahead: null } : job,
      );
    case 'result':
      return updateJob(state, event.job, (job) => ({ ...job, status: 'done', ahead: null, result: event.result }));
    case 'refused':
      return updateJob(state, event.job, (job) => ({ ...job, status: 'refused', ahead: null, refusal: event.reason }));
    case 'ended':
      return { ...state, screen: 'ended', endReason: event.reason };
    case 'not-found':
      return { ...state, screen: 'not-found' };
    case 'denied':
      return { ...state, screen: 'denied', denial: event.reason };
  }
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
