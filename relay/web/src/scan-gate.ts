/**
 * 实时取景的防抖：镜头一直对着同一张标签时只打一次。
 *
 * 取景每秒解出好几次同一个码。电脑的防重复窗口（默认 3 秒）过了之后会再打一张，所以手机这边也要挡：
 * 同一个码离开画面 SAME_CODE_REARM_MS 之后再扫到，才算新的一次；换一个码立即生效。
 * 每个码分开记：画面里同时有两张标签、解码轮流读到它们时，两张都只打一次；
 * 手动输入、拍照识别一张别的，也不会让镜头里那张再打一次。
 */

/** 同一个码离开画面这么久之后再扫到才算新的一次：比「移开、换一张、再移回来」的正常操作短，比解码偶尔失手的间隔长。 */
export const SAME_CODE_REARM_MS = 3_000;

export class ScanGate {
  /** 码 → 最近一次在画面里看到它的时间。超过 SAME_CODE_REARM_MS 没再看到的会被清掉。 */
  private readonly lastSeen = new Map<string, number>();

  /** 取景中解出一个码：是新的一次就返回 true。无论是否放行，都记下这次看到了它。 */
  accept(text: string, now: number): boolean {
    this.forgetStale(now);
    const isRepeat = this.lastSeen.has(text);
    this.lastSeen.set(text, now);
    return !isRepeat;
  }

  /**
   * 暂时不能提交时（等结果的太多）解出的码：已经打过的只刷新「还在画面里」的时间；
   * 没打过的不记，等能提交了再扫到它就会放行。
   */
  observe(text: string, now: number): void {
    this.forgetStale(now);
    if (this.lastSeen.has(text)) {
      this.lastSeen.set(text, now);
    }
  }

  /** 拍照识别、手动输入、重试、补打是明确要打的，不经过防抖，但要记住，免得镜头里的同一张再打一次。 */
  remember(text: string, now: number): void {
    this.lastSeen.set(text, now);
  }

  private forgetStale(now: number): void {
    for (const [text, seenAt] of this.lastSeen) {
      if (now - seenAt >= SAME_CODE_REARM_MS) {
        this.lastSeen.delete(text);
      }
    }
  }
}
