import type { VoiceCue, VoiceSettings } from '../../../shared/voice';
import type { Playback } from './voice-scheduler';

export interface VoicePlayerDeps {
  /** 向主进程取当前音色、语速下的 mp3；离线且没有缓存时为 null。 */
  fetchClip: (cue: VoiceCue) => Promise<Uint8Array | null>;
  createUrl: (audio: Uint8Array) => string;
  /** 开始播放；播放被拒绝时抛错。 */
  play: (url: string) => Promise<Playback>;
}

/**
 * 播放语音播报。同一句话（音色 + 语速 + 播报语）只向主进程取一次，之后直接播放内存里的 Blob URL。
 * 返回 null 表示没有播出语音（关闭、离线无缓存、播放被拒绝），调用方应退回提示音。
 */
export class VoicePlayer {
  private readonly urls = new Map<string, string>();

  constructor(private readonly deps: VoicePlayerDeps) {}

  async play(cue: VoiceCue, settings: VoiceSettings): Promise<Playback | null> {
    if (!settings.enabled) {
      return null;
    }
    const key = `${settings.name}|${settings.ratePercent}|${cue}`;
    let url = this.urls.get(key);
    if (!url) {
      const audio = await this.deps.fetchClip(cue);
      if (!audio) {
        return null;
      }
      url = this.deps.createUrl(audio);
      this.urls.set(key, url);
    }
    try {
      return await this.deps.play(url);
    } catch {
      // 自动播放策略或音频设备问题：退回提示音即可，不算程序错误。
      return null;
    }
  }
}
