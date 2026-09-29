import type { Clock } from '../../core/types';

/** 用户拒绝某网站后这么久不再弹框：网页多半会自动重试，不能一直打扰操作员。 */
export const DENIAL_COOLDOWN_MS = 10 * 60_000;

export interface OriginPromptsDeps {
  clock: Clock;
  /** 弹系统对话框，返回是否允许。 */
  ask: (origin: string) => Promise<boolean>;
  /** 允许：记进设置。 */
  grant: (origin: string) => void;
}

/** 网站授权的弹框：同一网站同时只弹一个，拒绝后一段时间内不再弹。 */
export class OriginPrompts {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly deniedAt = new Map<string, number>();

  constructor(private readonly deps: OriginPromptsDeps) {}

  request(origin: string): void {
    if (this.pending.has(origin)) {
      return;
    }
    const denied = this.deniedAt.get(origin);
    if (denied !== undefined && this.deps.clock.now() - denied < DENIAL_COOLDOWN_MS) {
      return;
    }
    const prompt = this.deps
      .ask(origin)
      .then((allowed) => {
        if (allowed) {
          this.deniedAt.delete(origin);
          this.deps.grant(origin);
        } else {
          this.deniedAt.set(origin, this.deps.clock.now());
        }
      })
      .catch((error: unknown) => console.error(`[api] authorization prompt for ${origin} failed`, error))
      .finally(() => this.pending.delete(origin));
    this.pending.set(origin, prompt);
  }

  /** 等所有弹框都有结果（测试用）。 */
  async idle(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}
