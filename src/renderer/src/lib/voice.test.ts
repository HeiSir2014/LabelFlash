import { describe, expect, test } from 'bun:test';
import type { PrintFailureReason, PrintResult } from '../../../core/types';
import type { PrinterIssue } from '../../../shared/printer-readiness';
import { VOICE_CUE_LEVEL, VOICE_CUE_TEXT, VOICE_CUES, type VoiceCue, type VoiceSettings } from '../../../shared/voice';
import { cueFeedback, describeFeedback, type PrintMode } from './feedback-cues';
import { VoicePlayer } from './voice-player';

const SCAN = {
  raw: '202609280001',
  ruleId: 'builtin:digits-order',
  ruleName: '纯数字订单号',
  fields: [{ name: '订单号', value: '202609280001' }],
};
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
      return { stop: () => {}, finished: Promise.resolve() };
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
  const printed: PrintResult = { status: 'printed', jobId: 'j', scan: SCAN };
  const failed = (reason: PrintFailureReason, issue?: PrinterIssue): PrintResult =>
    issue ? { status: 'failed', reason, detail: '…', issue } : { status: 'failed', reason };
  const cueOf = (result: PrintResult, mode: PrintMode = 'scan') =>
    describeFeedback({ kind: 'result', result, mode }).cue;

  test('names how the label was printed', () => {
    expect(describeFeedback({ kind: 'result', result: printed, mode: 'scan' })).toEqual({
      cue: 'printed',
      tone: 'success',
    });
    expect(cueOf(printed, 'force')).toBe('forced');
    expect(cueOf(printed, 'history')).toBe('reprinted');
    expect(cueOf(printed, 'test')).toBe('testPrinted');
  });

  test('tells a blocked duplicate from a label that is still printing', () => {
    expect(cueOf({ status: 'duplicate', recent: { state: 'printed', at: 0 }, windowMs: 3_000 })).toBe('duplicate');
    expect(cueOf({ status: 'duplicate', recent: { state: 'printing', at: 0 }, windowMs: 3_000 })).toBe('stillPrinting');
  });

  test('says what is wrong with the printer', () => {
    expect(cueOf(failed('PRINTER_NOT_READY', 'paperOut'))).toBe('paperOut');
    expect(cueOf(failed('PRINTER_NOT_READY', 'paperJam'))).toBe('paperJam');
    expect(cueOf(failed('PRINTER_NOT_READY', 'doorOpen'))).toBe('doorOpen');
    expect(cueOf(failed('PRINTER_NOT_READY', 'offline'))).toBe('printerOffline');
    expect(cueOf(failed('PRINTER_NOT_READY', 'other'))).toBe('printerNotReady');
    expect(cueOf(failed('PRINTER_NOT_READY'))).toBe('printerNotReady');
    expect(cueOf(failed('PRINTER_NOT_FOUND'))).toBe('printerNotFound');
    expect(cueOf(failed('PRINT_TIMEOUT'))).toBe('timeout');
    expect(cueOf(failed('PRINT_ERROR'), 'test')).toBe('failed');
  });

  test('covers events that are not print results, with a fallback tone per level', () => {
    expect(describeFeedback({ kind: 'invalid' })).toEqual({ cue: 'invalid', tone: 'warning' });
    expect(describeFeedback({ kind: 'no-printer' })).toEqual({ cue: 'noPrinter', tone: 'warning' });
    expect(describeFeedback({ kind: 'scanned' })).toEqual({ cue: 'scanned', tone: 'success' });
    expect(describeFeedback({ kind: 'internal-error' })).toEqual({ cue: 'internalError', tone: 'error' });
    expect(describeFeedback({ kind: 'result', result: failed('PRINT_ERROR'), mode: 'scan' }).tone).toBe('error');
  });

  test('previews any single cue with the tone of its level', () => {
    expect(cueFeedback('paperJam')).toEqual({ cue: 'paperJam', tone: 'error' });
    expect(cueFeedback('stillPrinting')).toEqual({ cue: 'stillPrinting', tone: 'warning' });
  });

  test('every cue has text and a level', () => {
    expect(VOICE_CUES).toHaveLength(18);
    for (const cue of VOICE_CUES) {
      expect(VOICE_CUE_TEXT[cue].length).toBeGreaterThan(0);
      expect(VOICE_CUE_LEVEL[cue]).toBeDefined();
    }
  });
});

describe('VoicePlayer', () => {
  test('fetches a clip once per voice, rate and cue, then replays it from memory', async () => {
    const { player, fetched, played } = fakePlayer();
    expect(await player.play('printed', VOICE)).not.toBeNull();
    expect(await player.play('printed', VOICE)).not.toBeNull();
    expect(await player.play('printed', { ...VOICE, ratePercent: 30 })).not.toBeNull();
    expect(fetched).toEqual(['printed', 'printed']);
    expect(played).toHaveLength(3);
  });

  test('returns null so the caller can fall back to a beep', async () => {
    expect(await fakePlayer().player.play('printed', { ...VOICE, enabled: false })).toBeNull();
    expect(await fakePlayer(null).player.play('printed', VOICE)).toBeNull();
    const blocked = fakePlayer();
    blocked.failPlayback();
    expect(await blocked.player.play('printed', VOICE)).toBeNull();
  });

  test('retries a clip that was unavailable earlier', async () => {
    const offline = fakePlayer(null);
    await offline.player.play('failed', VOICE);
    await offline.player.play('failed', VOICE);
    expect(offline.fetched).toEqual(['failed', 'failed']);
  });
});
