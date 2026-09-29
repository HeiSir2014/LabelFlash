import type { Clock } from '../../core/types';

/** 用户拒绝某网站后这么久直接答复「已拒绝」：网页多半会自动重试，不能一直打扰操作员。 */
export const DENIAL_COOLDOWN_MS = 10 * 60_000;
/** 同时等确认的网站最多这么多个：一个网页可以换着子域名请求，不能让确认条刷满屏。 */
export const MAX_PENDING_ORIGINS = 3;
/** 这么久没人处理的请求作废：网页早就不等了，也不占着名额。 */
export const PENDING_EXPIRY_MS = 10 * 60_000;
/** 拒绝记录最多留这么多条（过了冷却期的随时清掉）：记录以网站为键，由网页决定，不能无限增长。 */
const MAX_DENIALS = 100;

export type OriginRequestState = 'pending' | 'denied' | 'busy';

export interface OriginPromptsDeps {
  clock: Clock;
  /** 有网站在等确认：发一条系统通知，提醒操作员到程序里点「允许」或「拒绝」。 */
  notify: (origin: string) => void;
  /** 允许：记进设置。 */
  grant: (origin: string) => void;
  /** 等确认的列表变了：推给界面。 */
  onChange: () => void;
}

/**
 * 网站授权：没授权过的网站先列进「等确认」，由操作员在程序里用鼠标点「允许」或「拒绝」。
 * 不弹系统对话框：模态框会抢走焦点，扫码枪敲的 Tab、回车可能正好点中「允许」；也不能让网页连着弹一堆框。
 */
export class OriginPrompts {
  /** 网站 → 开始等确认的时间。 */
  private readonly waiting = new Map<string, number>();
  private readonly deniedAt = new Map<string, number>();

  constructor(private readonly deps: OriginPromptsDeps) {}

  /** 网页来请求时调用；返回这个网站现在的状态。 */
  request(origin: string): OriginRequestState {
    this.prune();
    if (this.deniedAt.has(origin)) {
      return 'denied';
    }
    if (this.waiting.has(origin)) {
      return 'pending';
    }
    if (this.waiting.size >= MAX_PENDING_ORIGINS) {
      return 'busy';
    }
    this.waiting.set(origin, this.deps.clock.now());
    this.deps.notify(origin);
    this.deps.onChange();
    return 'pending';
  }

  /** 操作员点了「允许」或「拒绝」。不在等确认列表里的（已经作废、或伪造的请求）不理。 */
  decide(origin: string, allow: boolean): void {
    this.prune();
    if (!this.waiting.delete(origin)) {
      return;
    }
    if (allow) {
      this.deps.grant(origin);
    } else {
      this.deniedAt.set(origin, this.deps.clock.now());
      if (this.deniedAt.size > MAX_DENIALS) {
        const [oldest] = this.deniedAt.keys();
        if (oldest !== undefined) {
          this.deniedAt.delete(oldest);
        }
      }
    }
    this.deps.onChange();
  }

  /** 正在等确认的网站，先来的在前。 */
  pending(): string[] {
    this.prune();
    return [...this.waiting.keys()];
  }

  private prune(): void {
    const now = this.deps.clock.now();
    let changed = false;
    for (const [origin, since] of this.waiting) {
      if (now - since >= PENDING_EXPIRY_MS) {
        this.waiting.delete(origin);
        changed = true;
      }
    }
    for (const [origin, at] of this.deniedAt) {
      if (now - at >= DENIAL_COOLDOWN_MS) {
        this.deniedAt.delete(origin);
      }
    }
    if (changed) {
      this.deps.onChange();
    }
  }
}
