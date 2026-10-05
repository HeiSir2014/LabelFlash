import { describe, expect, test } from 'bun:test';
import {
  COMMAND_SET_LIMITS,
  configFor,
  DEFAULT_COMMAND_CONFIG,
  isPrinterAction,
  mmToDots,
  WIDEST_LIMITS,
  withPrinterConfig,
} from './command-model';

describe('mmToDots', () => {
  test('rounds millimetres to whole printer dots', () => {
    expect(mmToDots(60, 203)).toBe(480);
    expect(mmToDots(40, 203)).toBe(320);
    expect(mmToDots(2, 203)).toBe(16);
    expect(mmToDots(60, 300)).toBe(709);
  });
});

describe('WIDEST_LIMITS', () => {
  // 「自动」下保存的设置按最宽的范围校验：任何一种指令集能用的值都不能被它挡掉。
  test('covers every command set', () => {
    for (const limits of Object.values(COMMAND_SET_LIMITS)) {
      expect(WIDEST_LIMITS.density.min).toBeLessThanOrEqual(limits.density.min);
      expect(WIDEST_LIMITS.density.max).toBeGreaterThanOrEqual(limits.density.max);
      expect(limits.speeds.every((speed) => WIDEST_LIMITS.speeds.includes(speed))).toBe(true);
    }
  });
});

describe('per-printer configs', () => {
  test('reads only own entries and falls back to the default', () => {
    const configs = withPrinterConfig({}, '标签机A', { ...DEFAULT_COMMAND_CONFIG, commandSet: 'tspl' });
    expect(configFor(configs, '标签机A').commandSet).toBe('tspl');
    expect(configFor(configs, '__proto__')).toBe(DEFAULT_COMMAND_CONFIG);
  });

  test('replaces the entry of the same printer and keeps the others', () => {
    const first = withPrinterConfig({}, 'A', { ...DEFAULT_COMMAND_CONFIG, density: 1 });
    const second = withPrinterConfig(withPrinterConfig(first, 'B', DEFAULT_COMMAND_CONFIG), 'A', {
      ...DEFAULT_COMMAND_CONFIG,
      density: 2,
    });
    expect(Object.keys(second).sort()).toEqual(['A', 'B']);
    expect(second['A']?.density).toBe(2);
  });

  // 打印机名来自系统，可能是任何字：名为 __proto__ 的打印机只是一个普通的键，不能改到原型。
  test('keeps a printer named __proto__ as a plain own key', () => {
    const configs = withPrinterConfig({}, '__proto__', DEFAULT_COMMAND_CONFIG);
    expect(Object.getPrototypeOf(configs)).toBe(Object.prototype);
    expect(Object.hasOwn(configs, '__proto__')).toBe(true);
  });
});

describe('isPrinterAction', () => {
  test('accepts the four actions only', () => {
    expect(['calibrate', 'feed', 'selfTest', 'factoryReset'].every(isPrinterAction)).toBe(true);
    expect(isPrinterAction('raw')).toBe(false);
    expect(isPrinterAction(null)).toBe(false);
  });
});
