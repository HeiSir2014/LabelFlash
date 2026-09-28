import { describe, expect, test } from 'bun:test';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  HISTORY_LIMIT_RANGE,
  MAX_DEDUP_WINDOW_SECONDS,
  MAX_NOTE_PRESETS,
  sanitizeSettings,
  secondsToMs,
} from './settings';

describe('sanitizeSettings', () => {
  // 不用 test.each：Bun 会把 undefined 那一行的参数当成 done 回调，导致超时。
  test('falls back to defaults for non-object input', () => {
    for (const value of [undefined, null, 42, 'x', []]) {
      expect(sanitizeSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test('keeps valid values', () => {
    const settings: AppSettings = {
      selectedPrinter: '标签',
      activeTemplateId: 'custom:3f2c-9a',
      noteOverride: { kind: 'text', text: '返修' },
      notePresets: ['返修', '样衣间 {日期}'],
      autoPrint: false,
      dedupWindowSeconds: 30,
      historyLimit: 20_000,
      launchAtLogin: true,
      voice: { enabled: false, name: 'zh-CN-YunxiNeural', ratePercent: 30 },
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  test('sanitizes voice settings and snaps the rate to 10% steps', () => {
    expect(sanitizeSettings({ voice: { ratePercent: 24 } }).voice.ratePercent).toBe(20);
    expect(sanitizeSettings({ voice: { ratePercent: 999 } }).voice.ratePercent).toBe(100);
    expect(sanitizeSettings({ voice: { ratePercent: -999 } }).voice.ratePercent).toBe(-50);
    expect(sanitizeSettings({ voice: { name: 'en-US-GuyNeural', enabled: 'yes' } }).voice).toEqual(
      DEFAULT_SETTINGS.voice,
    );
  });

  test('defaults the dedup window to 3 seconds, enough to absorb a double trigger of the scanner', () => {
    expect(DEFAULT_SETTINGS.dedupWindowSeconds).toBe(3);
    expect(secondsToMs(DEFAULT_SETTINGS.dedupWindowSeconds)).toBe(3_000);
  });

  test('clamps and rounds numbers', () => {
    expect(sanitizeSettings({ dedupWindowSeconds: -5 }).dedupWindowSeconds).toBe(0);
    expect(sanitizeSettings({ dedupWindowSeconds: 999_999 }).dedupWindowSeconds).toBe(MAX_DEDUP_WINDOW_SECONDS);
    expect(sanitizeSettings({ dedupWindowSeconds: 2.6 }).dedupWindowSeconds).toBe(3);
    expect(sanitizeSettings({ historyLimit: 1 }).historyLimit).toBe(HISTORY_LIMIT_RANGE.min);
    expect(sanitizeSettings({ historyLimit: 1e9 }).historyLimit).toBe(HISTORY_LIMIT_RANGE.max);
  });

  test('sanitizes the note selection', () => {
    expect(sanitizeSettings({ noteOverride: { kind: 'none' } }).noteOverride).toEqual({ kind: 'none' });
    expect(sanitizeSettings({ noteOverride: { kind: 'text', text: '  返修 \u0007 ' } }).noteOverride).toEqual({
      kind: 'text',
      text: '返修',
    });
    expect(sanitizeSettings({ noteOverride: { kind: 'text', text: '   ' } }).noteOverride).toEqual({
      kind: 'template',
    });
    expect(sanitizeSettings({ noteOverride: { kind: 'evil' } }).noteOverride).toEqual({ kind: 'template' });
  });

  test('cleans, de-duplicates and caps note presets', () => {
    const presets = sanitizeSettings({ notePresets: ['样衣间', ' 样衣间 ', '', 3, 'x'.repeat(500)] }).notePresets;
    expect(presets).toEqual(['样衣间', 'x'.repeat(200)]);
    const many = Array.from({ length: 30 }, (_, i) => `备注${i}`);
    expect(sanitizeSettings({ notePresets: many }).notePresets).toHaveLength(MAX_NOTE_PRESETS);
  });

  test('rejects malformed template ids', () => {
    expect(sanitizeSettings({ activeTemplateId: '../etc' }).activeTemplateId).toBe(DEFAULT_SETTINGS.activeTemplateId);
  });

  test('replaces wrong types with defaults', () => {
    expect(
      sanitizeSettings({ selectedPrinter: '', autoPrint: 'yes', dedupWindowSeconds: Number.NaN, launchAtLogin: 1 }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});
