/**
 * 语音播报：扫码 / 打印后播报固定的确认语（每次内容相同，所以可以缓存成音频文件，播放零延迟）。
 */
export const VOICE_CUES = ['printed', 'duplicate', 'failed', 'invalid', 'noPrinter', 'scanned'] as const;
export type VoiceCue = (typeof VOICE_CUES)[number];

export const VOICE_CUE_TEXT: Record<VoiceCue, string> = {
  printed: '打印成功',
  duplicate: '重复扫码',
  failed: '打印失败',
  invalid: '格式错误',
  noPrinter: '请选择打印机',
  scanned: '已扫描',
};

/** 可选音色（微软 Edge 在线神经网络语音）。 */
export const VOICE_NAMES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（男声）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女声）' },
] as const;
export type VoiceName = (typeof VOICE_NAMES)[number]['id'];
export const DEFAULT_VOICE_NAME: VoiceName = 'zh-CN-XiaoxiaoNeural';

/** 语速：相对正常语速的百分比。 */
export const VOICE_RATE_RANGE = { min: -50, max: 100, step: 10 } as const;

export interface VoiceSettings {
  enabled: boolean;
  name: VoiceName;
  ratePercent: number;
}

export function isVoiceName(value: unknown): value is VoiceName {
  return VOICE_NAMES.some((voice) => voice.id === value);
}

export function isVoiceCue(value: unknown): value is VoiceCue {
  return typeof value === 'string' && (VOICE_CUES as readonly string[]).includes(value);
}

/** SSML 的 prosody rate 写法，例如 +20%、-10%、+0%。 */
export function toProsodyRate(ratePercent: number): string {
  return `${ratePercent >= 0 ? '+' : ''}${ratePercent}%`;
}
