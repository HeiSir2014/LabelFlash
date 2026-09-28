/**
 * 实时取景的防抖：镜头一直对着同一张标签时只打一次。
 *
 * 取景每秒解出好几次同一个码。电脑的防重复窗口（默认 3 秒）过了之后会再打一张，所以手机这边也要挡：
 * 同一个码离开画面 SAME_CODE_REARM_MS 之后再扫到，才算新的一次；换一个码立即生效。
 */

/** 同一个码离开画面这么久之后再扫到才算新的一次：比「移开、换一张、再移回来」的正常操作短，比解码偶尔失手的间隔长。 */
export const SAME_CODE_REARM_MS = 3_000;

export class ScanGate {
  private last: string | null = null;
  private lastSeenAt = 0;

  /** 取景中解出一个码：是新的一次就返回 true 并记住它。 */
  accept(text: string, now: number): boolean {
    const isRepeat = text === this.last && now - this.lastSeenAt < SAME_CODE_REARM_MS;
    this.remember(text, now);
    return !isRepeat;
  }

  /** 打印中、结果显示期间解出的码：只刷新「还在画面里」的时间，不当作新的扫码，也不记住别的码。 */
  observe(text: string, now: number): void {
    if (text === this.last) {
      this.lastSeenAt = now;
    }
  }

  /** 拍照识别、手动输入是明确要打的，不经过防抖，但要记住，免得镜头里的同一张再打一次。 */
  remember(text: string, now: number): void {
    this.last = text;
    this.lastSeenAt = now;
  }
}
