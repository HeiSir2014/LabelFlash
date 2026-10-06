import { PDF_LIMITS } from '../pdf/pdf-model';
import type { Clock } from '../types';
import { enumAttr, integerAttr, keywordAttr, nameAttr, outOfBandAttr, textAttr, uriAttr } from './ipp-attributes';
import type { IppAttribute } from './ipp-codec';
import { JOB_STATE, VALUE_TAGS } from './ipp-constants';

export const IPP_JOB_LIMITS = {
  /** 收下还没结束、已经允许的任务最多 4 个：每个文档最多 50MB 在内存里，4 个是 200MB；几台电脑同时打标签够用。 */
  active: 4,
  /** 每台电脑最多 2 个：一台电脑出错反复提交时，别的电脑照样能打。 */
  activePerClient: 2,
  /**
   * 等操作员允许的任务另算：一共最多 2 个、每台电脑 1 个，文档加起来最多 50MB（一个最大的文档）。
   * 没被允许的电脑占不满正式的名额，也撑不大内存。
   */
  held: 2,
  heldPerClient: 1,
  heldBytes: PDF_LIMITS.fileBytes,
  /** 结束的任务留 100 个、最多 1 小时给对方查结果：打印队列看到结束就不再查了。 */
  finished: 100,
  finishedMs: 60 * 60_000,
} as const;

/** 等这台电脑上的操作员允许（IANA 注册的 job-state-reasons 关键字）。 */
export const HELD_REASON = 'job-held-for-authorization';
/** job-id 是 1–2^31-1 的整数（RFC 8011 §5.3.2），用到头就回到 1。 */
export const MAX_JOB_ID = 2_147_483_647;
const MS_PER_SECOND = 1_000;
const BYTES_PER_KB = 1024;
const NO_REASON = 'none';
const QUEUED_MESSAGE = '排队中';
const HELD_MESSAGE = '等那台电脑上的操作员点「允许」';
const PRINTING_MESSAGE = '正在打印';
const CANCELED_MESSAGE = '已取消';

export type IppJobState = keyof typeof JOB_STATE;
type FinishedState = 'completed' | 'aborted' | 'canceled';
const FINISHED_STATES: ReadonlySet<IppJobState> = new Set<IppJobState>(['completed', 'aborted', 'canceled']);

/** 局域网共享收下的一个任务。 */
export interface IppJob {
  id: number;
  /** 哪台共享打印机（纸张键）。 */
  printerKey: string;
  /** job-name（已去掉控制字符、截短）。 */
  name: string;
  /** requesting-user-name；对方没给时为空。 */
  user: string;
  /** 对方的 IPv4 地址。 */
  client: string;
  sizeBytes: number;
  state: IppJobState;
  reasons: string[];
  message: string;
  createdAt: number;
  processingAt: number | null;
  completedAt: number | null;
  /** 已交给打印队列的张数（job-impressions-completed）。 */
  impressions: number;
  /** 处理中被取消：处理的一方看到就停下，把状态记为 canceled。 */
  cancelRequested: boolean;
}

/** 建任务时给的内容。 */
export interface NewIppJob {
  printerKey: string;
  name: string;
  user: string;
  client: string;
  sizeBytes: number;
  /** 新电脑第一次打印：先停着等操作员允许。 */
  held: boolean;
}

export type CreateResult = { status: 'created'; job: IppJob } | { status: 'busy' } | { status: 'client-busy' };
export type CancelResult = 'canceled' | 'requested' | 'not-found' | 'not-owner' | 'finished';

/**
 * 局域网共享收下的任务。只在内存里：程序重启后对方的打印队列查不到旧任务，会按「任务没了」处理；
 * 打印记录才是长期留存的。拿出去的都是副本，状态只经这里的方法改。
 */
export class IppJobBook {
  private readonly jobs = new Map<number, IppJob>();
  private nextId = 1;

  constructor(private readonly clock: Clock) {}

  /** 收下一个任务；同时开着的太多时返回 busy（全部）或 client-busy（这台电脑）。 */
  create(input: NewIppJob): CreateResult {
    this.prune();
    const limit = this.limitFor(input);
    if (limit !== null) {
      return { status: limit };
    }
    // held 只是建任务时的参数，不留在任务上。
    const { held, ...fields } = input;
    const job: IppJob = {
      ...fields,
      id: this.nextId,
      state: held ? 'pending-held' : 'pending',
      reasons: [held ? HELD_REASON : NO_REASON],
      message: held ? HELD_MESSAGE : QUEUED_MESSAGE,
      createdAt: this.clock.now(),
      processingAt: null,
      completedAt: null,
      impressions: 0,
      cancelRequested: false,
    };
    this.nextId = this.nextId >= MAX_JOB_ID ? 1 : this.nextId + 1;
    this.jobs.set(job.id, job);
    return { status: 'created', job: copy(job) };
  }

  /** 收下这个任务会不会超过名额：等确认的和已允许的分开算。 */
  private limitFor(input: NewIppJob): 'busy' | 'client-busy' | null {
    if (input.held) {
      const held = [...this.jobs.values()].filter(isHeld);
      const heldBytes = held.reduce((sum, job) => sum + job.sizeBytes, 0);
      if (held.length >= IPP_JOB_LIMITS.held || heldBytes + input.sizeBytes > IPP_JOB_LIMITS.heldBytes) {
        return 'busy';
      }
      return held.some((job) => job.client === input.client) ? 'client-busy' : null;
    }
    const active = [...this.jobs.values()].filter(isWorking);
    if (active.length >= IPP_JOB_LIMITS.active) {
      return 'busy';
    }
    return active.filter((job) => job.client === input.client).length >= IPP_JOB_LIMITS.activePerClient
      ? 'client-busy'
      : null;
  }

  get(id: number): IppJob | null {
    const job = this.jobs.get(id);
    return job === undefined ? null : copy(job);
  }

  /** not-completed：排着的和处理中的，先来的在前；completed：结束的，最近结束的在前。limit 为 null 不限。 */
  list(printerKey: string, which: 'completed' | 'not-completed', limit: number | null): IppJob[] {
    this.prune();
    const jobs = [...this.jobs.values()].filter(
      (job) => job.printerKey === printerKey && (which === 'completed' ? !isActive(job) : isActive(job)),
    );
    jobs.sort((a, b) => (which === 'completed' ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : a.id - b.id));
    return jobs.slice(0, limit ?? jobs.length).map(copy);
  }

  /** 操作员允许了：从 pending-held 回到 pending。 */
  release(id: number): void {
    const job = this.jobs.get(id);
    if (job?.state === 'pending-held') {
      job.state = 'pending';
      job.reasons = [NO_REASON];
      job.message = QUEUED_MESSAGE;
    }
  }

  /** 开始处理；任务不在 pending（等确认时被取消了、还在等确认）返回 false。 */
  start(id: number): boolean {
    const job = this.jobs.get(id);
    if (job?.state !== 'pending') {
      return false;
    }
    job.state = 'processing';
    job.reasons = ['job-printing'];
    job.message = PRINTING_MESSAGE;
    job.processingAt = this.clock.now();
    return true;
  }

  progress(id: number, impressions: number): void {
    const job = this.jobs.get(id);
    if (job !== undefined) {
      job.impressions = impressions;
    }
  }

  /** 结束一个任务；已经结束的不再改。 */
  finish(id: number, state: FinishedState, reasons: string[], message: string): void {
    const job = this.jobs.get(id);
    if (job === undefined || FINISHED_STATES.has(job.state)) {
      return;
    }
    job.state = state;
    job.reasons = reasons.length > 0 ? reasons : [NO_REASON];
    job.message = message;
    job.completedAt = this.clock.now();
  }

  /** 只有交任务的那台电脑能取消（RFC 8011 §4.3.3：只有提交者或操作员）。 */
  cancel(id: number, client: string): CancelResult {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return 'not-found';
    }
    if (job.client !== client) {
      return 'not-owner';
    }
    if (FINISHED_STATES.has(job.state)) {
      return 'finished';
    }
    if (job.state === 'processing') {
      job.cancelRequested = true;
      return 'requested';
    }
    this.finish(id, 'canceled', ['job-canceled-by-user'], CANCELED_MESSAGE);
    return 'canceled';
  }

  /** 关掉共享：排着的、等确认的任务都中止；正在处理的请它停下（处理的一方看到后记为取消）。 */
  abortAll(message: string): void {
    for (const job of this.jobs.values()) {
      if (job.state === 'processing') {
        job.cancelRequested = true;
      } else if (isActive(job)) {
        this.finish(job.id, 'aborted', ['aborted-by-system'], message);
      }
    }
  }

  isCancelRequested(id: number): boolean {
    return this.jobs.get(id)?.cancelRequested ?? false;
  }

  /**
   * 已经允许、还没结束的任务数（排着的和正在打的）：不含等确认的。退出前要不要问、能不能更新按它：
   * 没被允许的电脑交来的任务挡不住操作员退出、更新。
   */
  activeCount(): number {
    return [...this.jobs.values()].filter(isWorking).length;
  }

  /** 等操作员允许的任务数。 */
  heldCount(): number {
    return [...this.jobs.values()].filter(isHeld).length;
  }

  /** 某台共享打印机上还没结束的任务数。 */
  activeFor(printerKey: string): number {
    return [...this.jobs.values()].filter((job) => job.printerKey === printerKey && isActive(job)).length;
  }

  private prune(): void {
    const oldest = this.clock.now() - IPP_JOB_LIMITS.finishedMs;
    const finished = [...this.jobs.values()]
      .filter((job) => !isActive(job))
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    for (const [index, job] of finished.entries()) {
      if (index >= IPP_JOB_LIMITS.finished || (job.completedAt ?? 0) < oldest) {
        this.jobs.delete(job.id);
      }
    }
  }
}

function isActive(job: IppJob): boolean {
  return !FINISHED_STATES.has(job.state);
}

function isHeld(job: IppJob): boolean {
  return job.state === 'pending-held';
}

/** 已经允许、还没结束的。 */
function isWorking(job: IppJob): boolean {
  return isActive(job) && !isHeld(job);
}

function copy(job: IppJob): IppJob {
  return { ...job, reasons: [...job.reasons] };
}

/** 拼任务网址、算时间用的。 */
export interface JobContext {
  printerUri: string;
  /** 共享服务启动的时刻：IPP 的时间都按「启动以来的秒数」算（RFC 8011 §5.3.14）。 */
  startedAt: number;
  nowMs: number;
}

/** 任务网址：打印机网址 + /jobs/编号。 */
export function jobUri(printerUri: string, id: number): string {
  return `${printerUri}/jobs/${id}`;
}

const JOB_URI_ID = /\/jobs\/([1-9]\d{0,9})$/;

/** 任务网址末尾的编号；不是任务网址返回 null。 */
export function jobIdFromUri(uri: string | null): number | null {
  const match = uri === null ? null : JOB_URI_ID.exec(uri);
  const id = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(id) && id <= MAX_JOB_ID ? id : null;
}

/** 一个任务的全部属性（RFC 8011 §5.3）。 */
export function jobAttributes(job: IppJob, context: JobContext): IppAttribute[] {
  const seconds = (at: number) => Math.max(0, Math.floor((at - context.startedAt) / MS_PER_SECOND));
  const time = (name: string, at: number | null) =>
    at === null ? outOfBandAttr(name, VALUE_TAGS.noValue) : integerAttr(name, seconds(at));
  return [
    integerAttr('job-id', job.id),
    uriAttr('job-uri', jobUri(context.printerUri, job.id)),
    uriAttr('job-printer-uri', context.printerUri),
    nameAttr('job-name', job.name),
    nameAttr('job-originating-user-name', job.user === '' ? '—' : job.user),
    enumAttr('job-state', JOB_STATE[job.state]),
    keywordAttr('job-state-reasons', ...job.reasons),
    textAttr('job-state-message', job.message),
    integerAttr('job-impressions-completed', job.impressions),
    integerAttr('job-k-octets', Math.ceil(job.sizeBytes / BYTES_PER_KB)),
    integerAttr('time-at-creation', seconds(job.createdAt)),
    time('time-at-processing', job.processingAt),
    time('time-at-completed', job.completedAt),
    integerAttr('job-printer-up-time', seconds(context.nowMs)),
  ];
}
