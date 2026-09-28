import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VOICE_CUE_TEXT, VOICE_CUES, type VoiceName } from '../../shared/voice';
import { type Synthesize, VoiceClips } from './voice-clips';

const KEY = { voice: 'zh-CN-XiaoxiaoNeural' as VoiceName, ratePercent: 20 };

function fakeSynthesizer() {
  const calls: string[] = [];
  let failing = false;
  const synthesize: Synthesize = async (text, voice, ratePercent) => {
    calls.push(`${voice}|${ratePercent}|${text}`);
    if (failing) {
      throw new Error('offline');
    }
    return new TextEncoder().encode(`mp3:${text}:${ratePercent}`);
  };
  return {
    calls,
    synthesize,
    goOffline: () => {
      failing = true;
    },
  };
}

describe('VoiceClips', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cdl-voice-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('synthesizes once, then serves the cached file even when offline', async () => {
    const fake = fakeSynthesizer();
    const clips = new VoiceClips(dir, fake.synthesize);
    const first = await clips.get('printed', KEY);
    fake.goOffline();
    const again = await new VoiceClips(dir, fake.synthesize).get('printed', KEY);
    expect(new TextDecoder().decode(again ?? new Uint8Array())).toBe(`mp3:${VOICE_CUE_TEXT.printed}:20`);
    expect(again).toEqual(first);
    expect(fake.calls).toHaveLength(1);
  });

  test('uses a separate clip per voice and rate', async () => {
    const fake = fakeSynthesizer();
    const clips = new VoiceClips(dir, fake.synthesize);
    await clips.get('printed', KEY);
    await clips.get('printed', { ...KEY, ratePercent: 30 });
    await clips.get('printed', { ...KEY, voice: 'zh-CN-YunxiNeural' });
    expect(fake.calls).toHaveLength(3);
    expect(await readdir(dir)).toHaveLength(3);
  });

  test('merges concurrent requests for the same clip', async () => {
    const fake = fakeSynthesizer();
    const clips = new VoiceClips(dir, fake.synthesize);
    await Promise.all([clips.get('duplicate', KEY), clips.get('duplicate', KEY)]);
    expect(fake.calls).toHaveLength(1);
  });

  test('returns null when offline with nothing cached, and caches nothing', async () => {
    const fake = fakeSynthesizer();
    fake.goOffline();
    const clips = new VoiceClips(dir, fake.synthesize);
    expect(await clips.get('failed', KEY)).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  test('warm prepares every cue exactly once', async () => {
    const fake = fakeSynthesizer();
    const clips = new VoiceClips(dir, fake.synthesize);
    await clips.warm(KEY);
    await clips.warm(KEY);
    expect(fake.calls).toHaveLength(VOICE_CUES.length);
  });
});
