import type { ClientDecision } from '../../core/ipp/ipp-operations';
import type { Clock } from '../../core/types';

export const IPP_APPROVAL = {
  /** 等操作员点「允许」最多 2 分钟：再久对方的打印队列早就报错了，操作员多半也不在电脑前。 */
  timeoutMs: 2 * 60_000,
  /** 同时等确认的电脑最多 3 台：和网站询问一样，不让询问条刷满屏。 */
  maxPending: 3,
} as const;
/** 记住的电脑最多 200 台：一个店、一个仓库的电脑远到不了，挡住换着地址刷出来的记录。 */
export const MAX_REMEMBERED_CLIENTS = 200;

export type ApprovalResult = 'allowed' | 'denied' | 'timeout' | 'busy';

/** 记住的一台电脑：按 IPv4 地址。 */
export interface RememberedClient {
  address: string;
  decision: 'allow' | 'deny';
  /** 做决定时它报的用户名（界面上帮操作员认是哪台）。 */
  lastUser: string;
  decidedAt: number;
}

/** 记住的决定存在哪里（SqliteIppStore 实现）。 */
export interface ClientDecisionStore {
  decisionOf(address: string): 'allow' | 'deny' | null;
  saveDecision(client: RememberedClient): void;
  removeDecision(address: string): void;
  /** 最近决定的在前。 */
  listDecisions(): RememberedClient[];
}

/** 正在等确认的一台电脑。 */
export interface PendingClient {
  address: string;
  user: string;
  /** 它要打到哪台共享打印机（第一个任务的）。 */
  printerName: string;
  /** 在等的任务数。 */
  jobs: number;
  since: number;
}

/** ClientApprovals 的依赖。 */
export interface ClientApprovalsDeps {
  store: ClientDecisionStore;
  clock: Clock;
  schedule: (run: () => void, delayMs: number) => () => void;
  /** 有新电脑在等确认：发系统通知，提醒操作员到程序里处理。 */
  notify: (client: PendingClient) => void;
  /** 等确认的列表或记住的电脑变了：推给界面。 */
  onChange: () => void;
}

interface Waiting {
  client: PendingClient;
  resolvers: Array<(result: ApprovalResult) => void>;
  cancelTimer: () => void;
}

/**
 * 新电脑第一次打印：先问操作员。不弹系统对话框（模态框会抢走焦点，扫码枪敲的回车可能正好点中「允许」），
 * 而是在程序顶部的询问条里用鼠标点，同时发系统通知。决定按地址记住，在「局域网共享」页可以撤销。
 */
export class ClientApprovals {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly deps: ClientApprovalsDeps) {}

  /** 这台电脑现在的待遇：记住的允许 / 拒绝，或者要问。 */
  decisionFor(address: string): ClientDecision {
    switch (this.deps.store.decisionOf(address)) {
      case 'allow':
        return 'allowed';
      case 'deny':
        return 'denied';
      case null:
        return 'ask';
    }
  }

  /** 一个任务要等这台电脑的确认；已经有决定的直接返回。同一台电脑的任务排进同一个询问。 */
  waitFor(address: string, user: string, printerName: string): Promise<ApprovalResult> {
    const decided = this.decisionFor(address);
    if (decided !== 'ask') {
      return Promise.resolve(decided);
    }
    const existing = this.waiting.get(address);
    if (existing === undefined && this.waiting.size >= IPP_APPROVAL.maxPending) {
      return Promise.resolve('busy');
    }
    return new Promise((resolve) => {
      if (existing !== undefined) {
        existing.client.jobs += 1;
        existing.resolvers.push(resolve);
        this.deps.onChange();
        return;
      }
      const client: PendingClient = { address, user, printerName, jobs: 1, since: this.deps.clock.now() };
      const cancelTimer = this.deps.schedule(() => this.settle(address, 'timeout'), IPP_APPROVAL.timeoutMs);
      this.waiting.set(address, { client, resolvers: [resolve], cancelTimer });
      this.deps.notify({ ...client });
      this.deps.onChange();
    });
  }

  /** 操作员点了「允许」或「拒绝」。不在等的地址（已超时作废、伪造的请求）不理。 */
  decide(address: string, allow: boolean): void {
    const waiting = this.waiting.get(address);
    if (waiting === undefined) {
      return;
    }
    this.deps.store.saveDecision({
      address,
      decision: allow ? 'allow' : 'deny',
      lastUser: waiting.client.user,
      decidedAt: this.deps.clock.now(),
    });
    this.settle(address, allow ? 'allowed' : 'denied');
  }

  /** 撤销对一台电脑的决定：它下次打印时重新问。 */
  forget(address: string): void {
    this.deps.store.removeDecision(address);
    this.deps.onChange();
  }

  /** 正在等确认的电脑，先来的在前。 */
  pending(): PendingClient[] {
    return [...this.waiting.values()].map(({ client }) => ({ ...client }));
  }

  /** 记住的电脑，最近决定的在前。 */
  remembered(): RememberedClient[] {
    return this.deps.store.listDecisions();
  }

  /** 关掉共享：还在等的任务都按超时处理（对方会看到任务中止）。 */
  dispose(): void {
    for (const address of [...this.waiting.keys()]) {
      this.settle(address, 'timeout');
    }
  }

  private settle(address: string, result: ApprovalResult): void {
    const waiting = this.waiting.get(address);
    if (waiting === undefined) {
      return;
    }
    this.waiting.delete(address);
    waiting.cancelTimer();
    for (const resolve of waiting.resolvers) {
      resolve(result);
    }
    this.deps.onChange();
  }
}
