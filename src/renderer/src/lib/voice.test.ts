import { describe, expect, test } from 'bun:test';
import type { VoiceCue, VoiceSettings } from '../../../shared/voice';
import { describeFeedback } from './feedback-cues';
import { VoicePlayer } from './voice-player';

const LABEL = { raw: 'CL5640-TK-图片色-XL', code: 'CL5640-TK', color: '图片色', size: 'XL' };
const VOICE: VoiceSettings = { enabled: true, name: 'zh-CN-XiaoxiaoNeural', ratePercent: 20 };

function fakePlayer(clip: Uint8Array | null = new Uint8Array([1, 2, 3])) {
  const fetched: VoiceCue[] = [];
  const played: string[] = [];
  let playFails = false;
  const player = new VoicePlayer({
    fetchClip: async (cue) => {
      fetched.push(cue);
      return clip;
    },
    createUrl: (audio) => `blob:${audio.length}:${fetched.length}`,
    play: async (url) => {
      if (playFails) {
        throw new Error('autoplay blocked');
      }
      played.push(url);
    },
  });
  return {
    player,
    fetched,
    played,
    failPlayback: () => {
      playFails = true;
    },
  };
}

describe('describeFeedback', () => {
  test('maps every outcome to a fixed cue and a fallback tone', () => {
    expect(describeFeedback({ kind: 'result', result: { status: 'printed', jobId: 'j', label: LABEL } })).toEqual({
      cue: 'printed',
      tone: 'success',
    });
    expect(
      describeFeedback({
        kind: 'result',
        result: { status: 'duplicate', recent: { state: 'printed', at: 0 }, windowMs: 1 },
      }),
    ).toEqual({ cue: 'duplicate', tone: 'warning' });
    expect(describeFeedback({ kind: 'result', result: { status: 'failed', reason: 'PRINT_TIMEOUT' } }).cue).toBe(
      'failed',
    );
    expect(describeFeedback({ kind: 'invalid' })).toEqual({ cue: 'invalid', tone: 'error' });
    expect(describeFeedback({ kind: 'no-printer' })).toEqual({ cue: 'noPrinter', tone: 'warning' });
    expect(describeFeedback({ kind: 'scanned' })).toEqual({ cue: 'scanned', tone: 'success' });
    expect(describeFeedback({ kind: 'internal-error' })).toEqual({ cue: 'failed', tone: 'error' });
  });
});

describe('VoicePlayer', () => {
  test('fetches a clip once per voice, rate and cue, then replays it from memory', async () => {
    const { player, fetched, played } = fakePlayer();
    expect(await player.play('printed', VOICE)).toBe(true);
    expect(await player.play('printed', VOICE)).toBe(true);
    expect(await player.play('printed', { ...VOICE, ratePercent: 30 })).toBe(true);
    expect(fetched).toEqual(['printed', 'printed']);
    expect(played).toHaveLength(3);
  });

  test('reports false so the caller can fall back to a beep', async () => {
    expect(await fakePlayer().player.play('printed', { ...VOICE, enabled: false })).toBe(false);
    expect(await fakePlayer(null).player.play('printed', VOICE)).toBe(false);
    const blocked = fakePlayer();
    blocked.failPlayback();
    expect(await blocked.player.play('printed', VOICE)).toBe(false);
  });

  test('retries a clip that was unavailable earlier', async () => {
    const offline = fakePlayer(null);
    await offline.player.play('failed', VOICE);
    await offline.player.play('failed', VOICE);
    expect(offline.fetched).toEqual(['failed', 'failed']);
  });
});
