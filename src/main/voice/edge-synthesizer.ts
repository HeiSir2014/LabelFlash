import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { toProsodyRate, type VoiceName } from '../../shared/voice';

/** 首次连接要几秒；超过这个时间就放弃（界面退回提示音，下次再试）。 */
const SYNTHESIS_TIMEOUT_MS = 20_000;

/** 用微软 Edge 在线语音合成一句话，返回 mp3 字节。需要联网；结果由 VoiceClips 缓存。 */
export async function synthesizeWithEdge(text: string, voice: VoiceName, ratePercent: number): Promise<Uint8Array> {
  const tts = new MsEdgeTTS();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TTS timed out after ${SYNTHESIS_TIMEOUT_MS}ms`)), SYNTHESIS_TIMEOUT_MS);
  });
  const synthesis = (async () => {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: toProsodyRate(ratePercent) });
    const chunks: Uint8Array[] = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk as Uint8Array);
    }
    return Buffer.concat(chunks);
  })();
  // 超时先返回时，close() 会让仍在进行的合成随后失败：这个结果已经没人等了，接住它以免成为未处理的 rejection。
  synthesis.catch(() => undefined);
  try {
    return await Promise.race([synthesis, timeout]);
  } finally {
    clearTimeout(timer);
    tts.close();
  }
}
