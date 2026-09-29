import { describe, expect, test } from 'bun:test';
import {
  API_PORT_RANGE,
  type AppSettings,
  DEFAULT_SETTINGS,
  HISTORY_LIMIT_RANGE,
  MAX_AUTHORIZED_ORIGINS,
  MAX_DEDUP_WINDOW_SECONDS,
  MAX_NOTE_PRESETS,
  MAX_PAPER_ASSIGNMENTS,
  SCAN_LINE_GAP_RANGE,
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
      paperPrinters: { '60x40': '标签', '100x180': '面单' },
      activeTemplateId: 'custom:3f2c-9a',
      noteOverride: { kind: 'text', text: '返修' },
      notePresets: ['返修', '样衣间 {日期}'],
      autoPrint: false,
      dedupWindowSeconds: 30,
      historyLimit: 20_000,
      launchAtLogin: false,
      voice: { enabled: false, name: 'zh-CN-YunxiNeural', ratePercent: 30 },
      ruleSettings: [
        { id: 'custom:a1', enabled: true, templateId: 'custom:3f2c-9a' },
        { id: 'builtin:raw', enabled: false, templateId: null },
      ],
      scanLineGapMs: 120,
      webhooks: [
        {
          id: 'w1',
          name: 'ERP',
          url: 'https://erp.example.com/hooks',
          secretName: 'ERP 签名',
          events: ['printed'],
          enabled: true,
        },
      ],
      mobileRelayUrl: 'https://relay.example.com/labelflash/',
      apiPort: 18000,
      apiLastPort: 17632,
      apiLanEnabled: false,
      apiAuthorizedOrigins: ['https://erp.example.com', 'http://localhost:8080'],
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  test('uses the built-in relay unless a valid address is set', () => {
    expect(DEFAULT_SETTINGS.mobileRelayUrl).toBeNull();
    expect(sanitizeSettings({ mobileRelayUrl: 'https://relay.example.com/labelflash' }).mobileRelayUrl).toBe(
      'https://relay.example.com/labelflash/',
    );
    expect(sanitizeSettings({ mobileRelayUrl: 'http://relay.example.com/' }).mobileRelayUrl).toBeNull();
    expect(sanitizeSettings({ mobileRelayUrl: 42 }).mobileRelayUrl).toBeNull();
  });

  test('starts with every built-in scan rule enabled and an 80ms gap for multi-line scans', () => {
    expect(DEFAULT_SETTINGS.ruleSettings.map((setting) => setting.id)).toEqual([
      'builtin:dash-three',
      'builtin:digits-order',
      'builtin:key-value',
      'builtin:raw',
    ]);
    expect(DEFAULT_SETTINGS.scanLineGapMs).toBe(80);
    expect(sanitizeSettings({ scanLineGapMs: 1 }).scanLineGapMs).toBe(SCAN_LINE_GAP_RANGE.min);
    expect(sanitizeSettings({ scanLineGapMs: 99_999 }).scanLineGapMs).toBe(SCAN_LINE_GAP_RANGE.max);
  });

  test('starts with the computer by default, so a scan station is ready right after the installer finishes', () => {
    expect(DEFAULT_SETTINGS.launchAtLogin).toBe(true);
    expect(sanitizeSettings({}).launchAtLogin).toBe(true);
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

describe('paperPrinters', () => {
  test('keeps valid paper keys and printer names', () => {
    const settings = sanitizeSettings({ paperPrinters: { '60x40': '标签机A', '100x180': '面单机B', bad: 'x' } });
    expect(settings.paperPrinters).toEqual({ '60x40': '标签机A', '100x180': '面单机B' });
  });

  // 1.0.x 只有一台「选中的打印机」，打的都是 60×40：升级后不用重新设置。
  test('moves the old selected printer to 60x40', () => {
    expect(sanitizeSettings({ selectedPrinter: '标签机A' }).paperPrinters).toEqual({ '60x40': '标签机A' });
  });

  test('does not bring the old printer back once paper is assigned, even when cleared', () => {
    const assigned = sanitizeSettings({ selectedPrinter: '旧打印机', paperPrinters: { '100x180': '面单机B' } });
    expect(assigned.paperPrinters).toEqual({ '100x180': '面单机B' });
    expect(sanitizeSettings({ selectedPrinter: '旧打印机', paperPrinters: {} }).paperPrinters).toEqual({});
  });

  test('keeps at most MAX_PAPER_ASSIGNMENTS papers', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PAPER_ASSIGNMENTS + 5 }, (_, index) => [`${30 + index}x40`, 'P']),
    );
    expect(Object.keys(sanitizeSettings({ paperPrinters: many }).paperPrinters)).toHaveLength(MAX_PAPER_ASSIGNMENTS);
  });

  test('has no printer assigned by default', () => {
    expect(sanitizeSettings({}).paperPrinters).toEqual({});
  });

  // 只有设置里完全没有纸张分配（1.0.x 升级上来）才迁移；分配表坏了不能把旧打印机请回来。
  test('only migrates when there is no paper assignment at all', () => {
    expect(sanitizeSettings({ selectedPrinter: '旧打印机', paperPrinters: null }).paperPrinters).toEqual({});
  });
});

describe('local api settings', () => {
  // 局域网里的客户端软件是主要用法之一：默认开启（仍然要程序密钥才能调用）。
  test('uses the default ports and opens the LAN by default', () => {
    expect(DEFAULT_SETTINGS.apiPort).toBeNull();
    expect(DEFAULT_SETTINGS.apiLastPort).toBeNull();
    expect(DEFAULT_SETTINGS.apiLanEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.apiAuthorizedOrigins).toEqual([]);
  });

  test('accepts only unprivileged whole-number ports', () => {
    expect(sanitizeSettings({ apiPort: API_PORT_RANGE.min }).apiPort).toBe(API_PORT_RANGE.min);
    expect(sanitizeSettings({ apiPort: API_PORT_RANGE.max }).apiPort).toBe(API_PORT_RANGE.max);
    for (const port of [80, 70_000, 18_000.5, '18000', -1]) {
      expect(sanitizeSettings({ apiPort: port }).apiPort).toBeNull();
    }
    // 系统分配的空闲端口在 49152 以上，照样记得住。
    expect(sanitizeSettings({ apiLastPort: 51_234 }).apiLastPort).toBe(51_234);
    expect(sanitizeSettings({ apiLastPort: 80 }).apiLastPort).toBeNull();
  });

  test('keeps only distinct web origins, up to the limit', () => {
    const origins = [
      'https://erp.example.com',
      'https://erp.example.com',
      'https://erp.example.com/path',
      'null',
      'file://',
      7,
      ...Array.from({ length: MAX_AUTHORIZED_ORIGINS + 5 }, (_, index) => `https://site${index}.example.com`),
    ];
    const kept = sanitizeSettings({ apiAuthorizedOrigins: origins }).apiAuthorizedOrigins;
    expect(kept[0]).toBe('https://erp.example.com');
    expect(kept).toHaveLength(MAX_AUTHORIZED_ORIGINS);
    expect(new Set(kept).size).toBe(kept.length);
  });
});
