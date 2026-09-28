import { useCallback, useEffect, useRef } from 'react';
import type { VoiceCue, VoiceSettings } from '../../../shared/voice';
import { describeFeedback, type FeedbackEvent } from '../lib/feedback-cues';
import { playFeedback } from '../lib/feedback-sound';
import { VoicePlayer } from '../lib/voice-player';

function createPlayer(): VoicePlayer {
  return new VoicePlayer({
    fetchClip: (cue) => window.api.getVoiceClip(cue),
    createUrl: (audio) => URL.createObjectURL(new Blob([audio.slice()], { type: 'audio/mpeg' })),
    play: (url) => new Audio(url).play(),
  });
}

/** 扫码 / 打印后的反馈：优先播语音确认，语音不可用时退回提示音。 */
export function useFeedback(voice: VoiceSettings) {
  const player = useRef<VoicePlayer | null>(null);
  const voiceRef = useRef(voice);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const speak = useCallback((cue: VoiceCue, fallbackTone: Parameters<typeof playFeedback>[0]) => {
    player.current ??= createPlayer();
    player.current.play(cue, voiceRef.current).then(
      (played) => {
        if (!played) {
          playFeedback(fallbackTone);
        }
      },
      (error: unknown) => {
        console.error('[renderer] voice playback failed', error);
        playFeedback(fallbackTone);
      },
    );
  }, []);

  const announce = useCallback(
    (event: FeedbackEvent) => {
      const { cue, tone } = describeFeedback(event);
      speak(cue, tone);
    },
    [speak],
  );

  /** 设置页「试听」：用当前音色、语速播一句「打印成功」。 */
  const preview = useCallback(() => speak('printed', 'success'), [speak]);

  return { announce, preview };
}
