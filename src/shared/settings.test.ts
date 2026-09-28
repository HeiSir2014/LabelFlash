import { describe, expect, test } from 'bun:test';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  HISTORY_LIMIT_RANGE,
  MAX_DEDUP_WINDOW_MINUTES,
  MAX_NOTE_PRESETS,
  sanitizeSettings,
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
      dedupWindowMinutes: 30,
      historyLimit: 20_000,
      launchAtLogin: true,
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  test('clamps and rounds numbers', () => {
    expect(sanitizeSettings({ dedupWindowMinutes: -5 }).dedupWindowMinutes).toBe(0);
    expect(sanitizeSettings({ dedupWindowMinutes: 99_999 }).dedupWindowMinutes).toBe(MAX_DEDUP_WINDOW_MINUTES);
    expect(sanitizeSettings({ dedupWindowMinutes: 12.6 }).dedupWindowMinutes).toBe(13);
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
      sanitizeSettings({ selectedPrinter: '', autoPrint: 'yes', dedupWindowMinutes: Number.NaN, launchAtLogin: 1 }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});
