import type { FeedbackTone } from './status-text';

interface Beep {
  frequencyHz: number;
  durationMs: number;
}

/** 三种声音一听就能区分：成功短高音，重复两声中音，失败长低音。 */
const PATTERNS: Record<FeedbackTone, Beep[]> = {
  success: [{ frequencyHz: 1320, durationMs: 110 }],
  warning: [
    { frequencyHz: 880, durationMs: 110 },
    { frequencyHz: 880, durationMs: 110 },
  ],
  error: [{ frequencyHz: 220, durationMs: 450 }],
};
const GAP_MS = 80;
const VOLUME = 0.15;
const MS_PER_SECOND = 1_000;

let context: AudioContext | null = null;

export function playFeedback(tone: FeedbackTone): void {
  context ??= new AudioContext();
  let startAt = context.currentTime;
  for (const beep of PATTERNS[tone]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = beep.frequencyHz;
    gain.gain.value = VOLUME;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + beep.durationMs / MS_PER_SECOND);
    startAt += (beep.durationMs + GAP_MS) / MS_PER_SECOND;
  }
}
