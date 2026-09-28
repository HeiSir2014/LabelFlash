/**
 * 语音播报：每种结果播一句固定的话（内容不变，所以可以缓存成音频文件，播放零延迟）。
 * 用词和界面状态栏一致：同一件事，看到的和听到的是同一个说法。
 */
export const VOICE_CUES = [
  // 确认：一切正常。
  'printed',
  'forced',
  'reprinted',
  'testPrinted',
  'scanned',
  // 提醒：操作员自己能处理。
  'duplicate',
  'stillPrinting',
  'invalid',
  'noPrinter',
  // 故障：需要去看打印机或程序。
  'paperOut',
  'paperJam',
  'doorOpen',
  'printerOffline',
  'printerNotReady',
  'printerNotFound',
  'timeout',
  'failed',
  'internalError',
] as const;
export type VoiceCue = (typeof VOICE_CUES)[number];

export const VOICE_CUE_TEXT: Record<VoiceCue, string> = {
  printed: '已发送打印',
  forced: '已补打',
  reprinted: '已重打',
  testPrinted: '测试页已发送',
  scanned: '已扫描，按 F2 打印',
  duplicate: '重复扫码，已拦截',
  stillPrinting: '正在打印，请稍候',
  invalid: '二维码格式不对',
  noPrinter: '请先选择打印机',
  paperOut: '打印机缺纸',
  paperJam: '打印机卡纸',
  doorOpen: '打印机盖没关好',
  printerOffline: '打印机离线',
  printerNotReady: '打印机需要处理',
  printerNotFound: '找不到打印机',
  timeout: '打印机没有响应，请检查是否出纸',
  failed: '打印失败',
  internalError: '程序出错，请重试',
};

/**
 * 播报级别：故障 > 提醒 > 确认。
 * 新播报级别不低于正在播的就打断它；更低的等当前这句播完（只保留最新一条，不积压）。
 */
export const VOICE_LEVELS = ['confirm', 'notice', 'alert'] as const;
export type VoiceLevel = (typeof VOICE_LEVELS)[number];

export const VOICE_CUE_LEVEL: Record<VoiceCue, VoiceLevel> = {
  printed: 'confirm',
  forced: 'confirm',
  reprinted: 'confirm',
  testPrinted: 'confirm',
  scanned: 'confirm',
  duplicate: 'notice',
  stillPrinting: 'notice',
  invalid: 'notice',
  noPrinter: 'notice',
  paperOut: 'alert',
  paperJam: 'alert',
  doorOpen: 'alert',
  printerOffline: 'alert',
  printerNotReady: 'alert',
  printerNotFound: 'alert',
  timeout: 'alert',
  failed: 'alert',
  internalError: 'alert',
};

export const VOICE_LEVEL_LABEL: Record<VoiceLevel, string> = {
  confirm: '确认',
  notice: '提醒',
  alert: '故障',
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
