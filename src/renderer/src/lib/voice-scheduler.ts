import type { VoiceLevel } from '../../../shared/voice';

/** 一次正在进行的播放。stop() 立即停止，并让 finished 完成。 */
export interface Playback {
  stop(): void;
  finished: Promise<void>;
}

/** 开始播放一条播报；返回 null 表示没有播出语音（调用方已改用提示音），视为立即结束。 */
export type StartPlayback<T> = (item: T) => Promise<Playback | null>;

const LEVEL_RANK: Record<VoiceLevel, number> = { confirm: 0, notice: 1, alert: 2 };

interface Current {
  token: number;
  level: VoiceLevel;
  playback: Playback | null;
}

/**
 * 播报调度：不排长队，也不一律打断。
 * - 新播报级别不低于正在播的：停掉旧的，立刻播新的（连续扫码时总是听到最新结果）。
 * - 级别更低：等当前这句播完再播；等待中的只保留最新一条，不积压过时的播报。
 * 这样故障提示不会被随后的确认音盖掉，确认音也不会在几秒后才姗姗来迟。
 */
export class VoiceScheduler<T> {
  private current: Current | null = null;
  private pending: { item: T; level: VoiceLevel } | null = null;
  private nextToken = 0;

  constructor(private readonly start: StartPlayback<T>) {}

  announce(item: T, level: VoiceLevel): void {
    if (this.current && LEVEL_RANK[level] < LEVEL_RANK[this.current.level]) {
      this.pending = { item, level };
      return;
    }
    this.pending = null;
    this.current?.playback?.stop();
    void this.run(item, level);
  }

  private async run(item: T, level: VoiceLevel): Promise<void> {
    this.nextToken += 1;
    const token = this.nextToken;
    const current: Current = { token, level, playback: null };
    // 同步设置：同一轮里紧接着的 announce 能看到这一句正在播。
    this.current = current;
    let playback: Playback | null = null;
    try {
      playback = await this.start(item);
    } catch (error) {
      console.error('[voice] playback failed to start', error);
    }
    if (this.current?.token !== token) {
      // 加载期间已被更新的播报取代：这一句不再播。
      playback?.stop();
      return;
    }
    current.playback = playback;
    await playback?.finished;
    if (this.current?.token !== token) {
      return;
    }
    this.current = null;
    const next = this.pending;
    this.pending = null;
    if (next) {
      void this.run(next.item, next.level);
    }
  }
}
