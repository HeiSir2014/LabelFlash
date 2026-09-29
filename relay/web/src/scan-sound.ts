/**
 * 扫码页的提示音：用 Web Audio 在页面里合成，不下载音频文件（CSP 也只允许本站资源）。
 * 这里是纯数据和纯函数（bun test 测试）；播放在 sound-player.ts。
 *
 * iPhone 的浏览器（Safari、微信）不支持振动，扫到码时只能靠声音确认，所以每次扫到都响一声，
 * 和扫码枪的「嘀」一样。电脑回报「已发送打印」不再响：它比扫到晚一秒左右，接连两声反而吵。
 */

/** scanned = 扫到码、任务已发出；alert = 故障级结果（缺纸、卡纸、离线……），和电脑语音的「故障」级别一致。 */
export type SoundCue = 'scanned' | 'alert';

export interface Tone {
  frequencyHz: number;
  durationMs: number;
  /** 这一声结束后到下一声开始的间隔。 */
  gapMs: number;
}

/** 扫到码的「嘀」：扫码枪蜂鸣器常见的 2 kHz 左右，人耳在这一段最灵敏，车间有噪音也听得见。 */
export const SCANNED_FREQUENCY_HZ = 2_000;
/** 短促一声，和扫码枪的感觉一致；再长就像报警。 */
export const SCANNED_DURATION_MS = 70;
/** 故障提示：低音，一听就和「嘀」不同。 */
export const ALERT_FREQUENCY_HZ = 440;
/** 两声各这么长，中间隔一小段，节奏和两下振动（80–60–80ms）呼应，但长到能听清是两声。 */
export const ALERT_DURATION_MS = 150;
export const ALERT_GAP_MS = 100;

export const TONES: Record<SoundCue, readonly Tone[]> = {
  scanned: [{ frequencyHz: SCANNED_FREQUENCY_HZ, durationMs: SCANNED_DURATION_MS, gapMs: 0 }],
  alert: [
    { frequencyHz: ALERT_FREQUENCY_HZ, durationMs: ALERT_DURATION_MS, gapMs: ALERT_GAP_MS },
    { frequencyHz: ALERT_FREQUENCY_HZ, durationMs: ALERT_DURATION_MS, gapMs: 0 },
  ],
};

export interface ScheduledTone {
  frequencyHz: number;
  /** AudioContext 时间轴上的开始、结束时刻（秒）。 */
  start: number;
  end: number;
}

const MS_PER_SECOND = 1_000;

/** 把几声排到 AudioContext 的时间轴上，从 startTime（秒）开始，一声接一声。 */
export function scheduleTones(tones: readonly Tone[], startTime: number): ScheduledTone[] {
  let at = startTime;
  return tones.map((tone) => {
    const start = at;
    const end = start + tone.durationMs / MS_PER_SECOND;
    at = end + tone.gapMs / MS_PER_SECOND;
    return { frequencyHz: tone.frequencyHz, start, end };
  });
}

export interface SoundSettingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SOUND_SETTING_KEY = 'labelflash.sound';
const SOUND_OFF = 'off';
const SOUND_ON = 'on';

/** 声音开关（默认开）。仓库、车间里有人需要静音；存储不可用时按开处理。 */
export function readSoundSetting(storage: SoundSettingStorage | null): boolean {
  try {
    return storage?.getItem(SOUND_SETTING_KEY) !== SOUND_OFF;
  } catch {
    return true;
  }
}

export function writeSoundSetting(storage: SoundSettingStorage | null, isOn: boolean): void {
  try {
    storage?.setItem(SOUND_SETTING_KEY, isOn ? SOUND_ON : SOUND_OFF);
  } catch (error) {
    // 记不住也不影响本页：开关照样生效，只是刷新后回到默认。
    console.warn('[scan-sound] cannot save the sound setting', error);
  }
}
