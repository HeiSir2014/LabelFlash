/**
 * 播放提示音：Web Audio 的振荡器加音量包络，现场合成（音色和节奏在 scan-sound.ts）。
 * 浏览器 API 的薄封装，由假摄像头的浏览器测试和真机验收覆盖。
 *
 * iPhone（Safari、微信）只允许在用户点按里创建或恢复 AudioContext；切到后台再回来，声音又会被挂起。
 * 所以 unlock() 在「开始扫码」和之后的每一次点按里调用；还没解锁时 play() 什么都不做，不报错。
 * 静音开关打开时 iPhone 可能不出声，这没关系：画面和振动（安卓）照样提示。
 */
import type { SoundPort } from './phone-controller';
import { type SoundCue, scheduleTones, TONES } from './scan-sound';

/** 音量峰值（0–1）：在车间里听得见，又不至于吓人。 */
const PEAK_GAIN = 0.2;
/** 每一声开头和结尾的渐变：没有它，振荡器突然起停会有「啪」的爆音。 */
const RAMP_SECONDS = 0.005;
const SILENT_GAIN = 0;

interface AudioSessionLike {
  type: string;
}

type AudioContextConstructor = new () => AudioContext;

export class SoundPlayer implements SoundPort {
  private context: AudioContext | null = null;

  constructor(
    private isOn: boolean,
    private readonly save: (isOn: boolean) => void,
  ) {}

  get isEnabled(): boolean {
    return this.isOn;
  }

  setEnabled(on: boolean): void {
    this.isOn = on;
    this.save(on);
  }

  unlock(): void {
    try {
      if (!this.context) {
        const Constructor = audioContextConstructor();
        if (!Constructor) {
          return;
        }
        preferTransientAudioSession();
        this.context = new Constructor();
      }
      if (this.context.state !== 'running') {
        this.context.resume().catch((error: unknown) => console.warn('[SoundPlayer] cannot resume audio', error));
      }
    } catch (error) {
      console.warn('[SoundPlayer] audio unavailable', error);
    }
  }

  play(cue: SoundCue): void {
    const context = this.context;
    if (!this.isOn || !context || context.state !== 'running') {
      return;
    }
    for (const tone of scheduleTones(TONES[cue], context.currentTime)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = tone.frequencyHz;
      gain.gain.setValueAtTime(SILENT_GAIN, tone.start);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, tone.start + RAMP_SECONDS);
      gain.gain.setValueAtTime(PEAK_GAIN, tone.end - RAMP_SECONDS);
      gain.gain.linearRampToValueAtTime(SILENT_GAIN, tone.end);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(tone.start);
      oscillator.stop(tone.end);
    }
  }
}

function audioContextConstructor(): AudioContextConstructor | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Safari 16.4 起支持 navigator.audioSession：设成 transient，提示音只是短暂压低正在放的音乐，不把它停掉。
 * 其他浏览器没有这个属性，跳过即可。
 */
function preferTransientAudioSession(): void {
  const session = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
  if (session) {
    session.type = 'transient';
  }
}
