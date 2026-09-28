import type { Timers } from './timers';

export type BreakKind = 'enter' | 'tab';

const SEPARATOR: Record<BreakKind, string> = { enter: '\n', tab: '\t' };

/**
 * 把扫码枪的一连串按键拼成一次扫码。扫码枪把二维码里的换行和制表符当成回车键、Tab 键发出来，
 * 和「扫完一次按回车」分不开；区别只在时间：码里的换行后面几毫秒内紧跟着下一个字符，扫完之后则是停顿。
 *
 * - 回车 / Tab：先挂起，不提交；停顿满 gapMs 才提交。
 * - 挂起期间又来了字符（或又一个回车 / Tab）：刚才的回车 / Tab 是内容的一部分，返回要补上的分隔符。
 */
export class ScanAssembler {
  private pending: BreakKind | null = null;
  private timer: number | null = null;

  constructor(
    private gapMs: number,
    private readonly submit: () => void,
    private readonly timers: Timers,
  ) {}

  /** 按下回车或 Tab。返回要先补进内容的分隔符（上一个挂起的回车 / Tab），没有则为空串。 */
  breakKey(kind: BreakKind): string {
    const carried = this.takePending();
    this.pending = kind;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.pending = null;
      this.submit();
    }, this.gapMs);
    return carried;
  }

  /** 输入了一个普通字符。返回要先补在它前面的分隔符（挂起的回车 / Tab），没有则为空串。 */
  character(): string {
    return this.takePending();
  }

  /** 有没有挂起的回车 / Tab（界面上可以提示「正在接收…」）。 */
  get isPending(): boolean {
    return this.pending !== null;
  }

  setGap(ms: number): void {
    this.gapMs = ms;
  }

  dispose(): void {
    this.takePending();
  }

  private takePending(): string {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    const carried = this.pending === null ? '' : SEPARATOR[this.pending];
    this.pending = null;
    return carried;
  }
}
