/**
 * 播放提示音：Web Audio 的振荡器加音量包络，现场合成（音色和节奏在 scan-sound.ts）。
 * 什么时候恢复、什么时候响由单元测试覆盖（注入假的 AudioContext）；真的出声由假摄像头的浏览器测试和真机验收覆盖。
 *
 * iPhone（Safari、微信）只允许在用户点按里第一次创建和恢复 AudioContext，所以 unlock() 在「开始扫码」和之后的每一次点按里调用；
 * 还没点过时 play() 什么都不做，不报错。点过之后，play() 遇到声音没在运行就先 resume() 再响，这覆盖两种情况：
 * - 刚点「开始扫码」就扫到码：点按里发起的 resume() 还没完成；
 * - 切到后台再回来：摄像头不用点按就自动重开，声音却被系统挂起了。
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
    private readonly createContext: () => AudioContext | null = createBrowserAudioContext,
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
      this.context ??= this.createContext();
      if (this.context && this.context.state !== 'running') {
        this.context.resume().catch((error: unknown) => console.warn('[SoundPlayer] cannot resume audio', error));
      }
    } catch (error) {
      console.warn('[SoundPlayer] audio unavailable', error);
    }
  }

  play(cue: SoundCue): void {
    const context = this.context;
    if (!this.isOn || !context) {
      return;
    }
    if (context.state === 'running') {
      playTones(context, cue);
      return;
    }
    context.resume().then(
      () => playTones(context, cue),
      (error: unknown) => console.warn('[SoundPlayer] cannot resume audio', error),
    );
  }
}

function playTones(context: AudioContext, cue: SoundCue): void {
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

/** 旧版 iOS（14.5 以前）只有带前缀的 webkitAudioContext；两个都没有就不响。 */
function createBrowserAudioContext(): AudioContext | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Constructor) {
    return null;
  }
  preferTransientAudioSession();
  return new Constructor();
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
