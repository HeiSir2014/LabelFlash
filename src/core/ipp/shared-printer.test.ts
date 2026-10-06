import { describe, expect, test } from 'bun:test';
import { mediaName, sharedPrinterState } from './shared-printer';

describe('sharedPrinterState', () => {
  // 读不到状态（null，例如 macOS）按能打印算：和本机打印一样，不因为不知道就拒绝。
  test('is idle when the printer is ready or unknown and nothing is queued', () => {
    expect(sharedPrinterState(null, 0)).toEqual({ state: 'idle', reasons: ['none'], message: '可以打印' });
    expect(sharedPrinterState({ ready: true }, 0).state).toBe('idle');
  });

  test('is processing while jobs are queued', () => {
    expect(sharedPrinterState(null, 2)).toEqual({ state: 'processing', reasons: ['none'], message: '正在打印' });
  });

  test('is stopped with the reason the driver reported', () => {
    expect(sharedPrinterState({ ready: false, issue: 'paperOut', detail: '缺纸：装好标签纸' }, 1)).toEqual({
      state: 'stopped',
      reasons: ['media-empty-error'],
      message: '缺纸：装好标签纸',
    });
    expect(sharedPrinterState({ ready: false, issue: 'offline', detail: '离线' }, 0).reasons).toEqual([
      'offline-report',
    ]);
  });
});

describe('mediaName', () => {
  test('names the paper the PWG 5101.1 way', () => {
    expect(mediaName('60x40')).toBe('om_label-60x40_60x40mm');
    expect(mediaName('76.5x130')).toBe('om_label-76.5x130_76.5x130mm');
  });
});
