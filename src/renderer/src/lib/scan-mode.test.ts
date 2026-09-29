import { describe, expect, test } from 'bun:test';
import { nextScanMode } from './scan-mode';

describe('nextScanMode', () => {
  test('enters manual editing when the operator clicks into the scan box', () => {
    expect(nextScanMode('scan', 'pointer-down')).toBe('manual');
  });

  test.each(['submitted', 'escape', 'blur', 'idle'] as const)('goes back to scanning on %s', (event) => {
    expect(nextScanMode('manual', event)).toBe('scan');
  });

  // 扫码模式下只有鼠标点进框里才切换：扫码枪的按键、自动回焦都不能把输入法打开。
  test('stays in scan mode for anything but a click', () => {
    for (const event of ['submitted', 'escape', 'blur', 'idle'] as const) {
      expect(nextScanMode('scan', event)).toBe('scan');
    }
  });

  test('stays in manual editing when clicked again', () => {
    expect(nextScanMode('manual', 'pointer-down')).toBe('manual');
  });
});
