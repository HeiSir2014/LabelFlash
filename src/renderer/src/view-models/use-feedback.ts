import { useCallback, useEffect, useRef } from 'react';
import { VOICE_CUE_LEVEL, type VoiceCue, type VoiceSettings } from '../../../shared/voice';
import { cueFeedback, describeFeedback, type FeedbackCue, type FeedbackEvent } from '../lib/feedback-cues';
import { playFeedback } from '../lib/feedback-sound';
import { VoicePlayer } from '../lib/voice-player';
import { type Playback, VoiceScheduler } from '../lib/voice-scheduler';

/** 播放一段音频；返回可随时停止的句柄（播完、出错或被停止时 finished 完成）。 */
async function playAudio(url: string): Promise<Playback> {
  const audio = new Audio(url);
  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  audio.addEventListener('ended', () => settle(), { once: true });
  audio.addEventListener('error', () => settle(), { once: true });
  await audio.play();
  return {
    stop: () => {
      audio.pause();
      settle();
    },
    finished,
  };
}

function createScheduler(getVoice: () => VoiceSettings): VoiceScheduler<FeedbackCue> {
  const player = new VoicePlayer({
    fetchClip: (cue) => window.api.getVoiceClip(cue),
    createUrl: (audio) => URL.createObjectURL(new Blob([audio.slice()], { type: 'audio/mpeg' })),
    play: playAudio,
  });
  return new VoiceScheduler<FeedbackCue>(async ({ cue, tone }) => {
    let playback: Playback | null = null;
    try {
      playback = await player.play(cue, getVoice());
    } catch (error) {
      // 向主进程取语音失败：记下来，但操作员仍然要听到提示音。
      console.error('[renderer] voice playback failed', error);
    }
    if (!playback) {
      playFeedback(tone);
    }
    return playback;
  });
}

/** 扫码 / 打印后的反馈：按级别调度语音播报，语音不可用时退回提示音。 */
export function useFeedback(voice: VoiceSettings) {
  const voiceRef = useRef(voice);
  const scheduler = useRef<VoiceScheduler<FeedbackCue> | null>(null);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const speak = useCallback((feedback: FeedbackCue) => {
    scheduler.current ??= createScheduler(() => voiceRef.current);
    scheduler.current.announce(feedback, VOICE_CUE_LEVEL[feedback.cue]);
  }, []);

  const announce = useCallback((event: FeedbackEvent) => speak(describeFeedback(event)), [speak]);

  /** 设置页试听：默认播「已发送打印」，也可以指定任意一句。 */
  const preview = useCallback((cue: VoiceCue = 'printed') => speak(cueFeedback(cue)), [speak]);

  return { announce, preview };
}
