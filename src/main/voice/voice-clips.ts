import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VOICE_CUE_TEXT, VOICE_CUES, type VoiceCue, type VoiceName } from '../../shared/voice';

export type Synthesize = (text: string, voice: VoiceName, ratePercent: number) => Promise<Uint8Array>;

export interface ClipKey {
  voice: VoiceName;
  ratePercent: number;
}

/**
 * 播报音频缓存：每句固定确认语按「音色 + 语速 + 文本」的哈希存成 mp3。
 * 在线合成要好几秒，所以启动和改设置后先预热，扫码时直接读缓存，播放零延迟。
 * 缓存上限约为 音色数 × 语速档位 × 播报语 条（几 MB），不需要清理。
 */
export class VoiceClips {
  private readonly inFlight = new Map<string, Promise<Uint8Array | null>>();

  constructor(
    private readonly cacheDir: string,
    private readonly synthesize: Synthesize,
  ) {}

  /** 取播报音频：先读缓存，没有就在线合成并写入缓存；离线且没有缓存时返回 null（界面退回提示音）。 */
  get(cue: VoiceCue, key: ClipKey): Promise<Uint8Array | null> {
    const text = VOICE_CUE_TEXT[cue];
    const hash = createHash('sha256').update(`${key.voice}|${key.ratePercent}|${text}`).digest('hex');
    const pending = this.inFlight.get(hash);
    if (pending) {
      return pending;
    }
    const task = this.load(hash, text, key).finally(() => this.inFlight.delete(hash));
    this.inFlight.set(hash, task);
    return task;
  }

  /** 依次准备好全部播报语（逐句合成，避免同时打开多个连接）。 */
  async warm(key: ClipKey): Promise<void> {
    for (const cue of VOICE_CUES) {
      await this.get(cue, key);
    }
  }

  private async load(hash: string, text: string, key: ClipKey): Promise<Uint8Array | null> {
    const filePath = join(this.cacheDir, `${hash}.mp3`);
    try {
      return new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[voice] cached clip is unreadable: ${filePath}`, error);
      }
    }
    try {
      const audio = await this.synthesize(text, key.voice, key.ratePercent);
      if (audio.byteLength === 0) {
        throw new Error('synthesizer returned empty audio');
      }
      await mkdir(this.cacheDir, { recursive: true });
      const tempPath = `${filePath}.tmp`;
      await writeFile(tempPath, audio);
      await rename(tempPath, filePath);
      return audio;
    } catch (error) {
      console.warn(`[voice] synthesis failed for "${text}"`, error);
      return null;
    }
  }
}
