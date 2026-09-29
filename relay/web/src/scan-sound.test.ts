import { describe, expect, test } from 'bun:test';
import {
  ALERT_FREQUENCY_HZ,
  readSoundSetting,
  SCANNED_DURATION_MS,
  SCANNED_FREQUENCY_HZ,
  scheduleTones,
  TONES,
  writeSoundSetting,
} from './scan-sound';

const MS_PER_SECOND = 1_000;

describe('TONES', () => {
  test('beeps once, high and short, when a code is scanned, like a scanner', () => {
    expect(TONES.scanned).toEqual([{ frequencyHz: SCANNED_FREQUENCY_HZ, durationMs: SCANNED_DURATION_MS, gapMs: 0 }]);
    expect(SCANNED_FREQUENCY_HZ).toBeGreaterThanOrEqual(1_800);
    expect(SCANNED_DURATION_MS).toBeLessThanOrEqual(80);
  });

  test('sounds two low tones for a printer fault, clearly unlike the scan beep', () => {
    expect(TONES.alert).toHaveLength(2);
    for (const tone of TONES.alert) {
      expect(tone.frequencyHz).toBe(ALERT_FREQUENCY_HZ);
    }
    expect(ALERT_FREQUENCY_HZ).toBeLessThan(SCANNED_FREQUENCY_HZ / 3);
  });
});

describe('scheduleTones', () => {
  test('plays the tones one after another from the start time', () => {
    const steps = scheduleTones(
      [
        { frequencyHz: 440, durationMs: 150, gapMs: 100 },
        { frequencyHz: 440, durationMs: 150, gapMs: 0 },
      ],
      10,
    );
    expect(steps).toEqual([
      { frequencyHz: 440, start: 10, end: 10 + 150 / MS_PER_SECOND },
      { frequencyHz: 440, start: 10 + 250 / MS_PER_SECOND, end: 10 + 400 / MS_PER_SECOND },
    ]);
  });
});

class MemoryStorage {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const blocked = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

describe('the sound setting', () => {
  test('is on until someone turns it off', () => {
    expect(readSoundSetting(new MemoryStorage())).toBe(true);
    expect(readSoundSetting(null)).toBe(true);
  });

  test('remembers being turned off and on again', () => {
    const storage = new MemoryStorage();
    writeSoundSetting(storage, false);
    expect(readSoundSetting(storage)).toBe(false);
    writeSoundSetting(storage, true);
    expect(readSoundSetting(storage)).toBe(true);
  });

  test('stays on and never throws when storage is blocked', () => {
    expect(readSoundSetting(blocked)).toBe(true);
    expect(() => writeSoundSetting(blocked, false)).not.toThrow();
  });
});
