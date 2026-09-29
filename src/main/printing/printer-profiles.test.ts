import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { FAILED_READ_TTL_MS, PRINTER_PROFILE_TTL_MS, PrinterProfiles } from './printer-profiles';

const LABEL = { widthMm: 60, heightMm: 40, dpi: 300 };
const never = () => new Promise<void>(() => {});
const immediately = () => Promise.resolve();

describe('PrinterProfiles', () => {
  test('reads a printer once and reuses it for a while', async () => {
    const clock = new FakeClock();
    let reads = 0;
    const read = async () => {
      reads += 1;
      return LABEL;
    };
    const profiles = new PrinterProfiles(read, clock, never);
    expect(await profiles.get('标签机A')).toEqual(LABEL);
    await profiles.get('标签机A');
    expect(reads).toBe(1);
    clock.advance(PRINTER_PROFILE_TTL_MS);
    await profiles.get('标签机A');
    expect(reads).toBe(2);
  });

  test('reads again after being told the driver settings changed', async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return LABEL;
    };
    const profiles = new PrinterProfiles(read, new FakeClock(), never);
    await profiles.get('标签机A');
    profiles.forget('标签机A');
    await profiles.get('标签机A');
    expect(reads).toBe(2);
  });

  test('uses the resolution the driver reports', async () => {
    const profiles = new PrinterProfiles(async () => LABEL, new FakeClock(), never);
    expect(await profiles.dpiOf('标签机A')).toBe(300);
  });

  test('gives 203dpi when the driver does not report a resolution', async () => {
    const profiles = new PrinterProfiles(async () => null, new FakeClock(), never);
    expect(await profiles.dpiOf('标签机A')).toBe(203);
  });

  // 打印时不能等冷查询（Windows 上最长约 10 秒）：等不到就按 203dpi 打，查询照常在后台完成并缓存。
  test('does not hold up printing while the driver is slow to answer', async () => {
    const profiles = new PrinterProfiles(() => new Promise(() => {}), new FakeClock(), immediately);
    expect(await profiles.dpiOf('标签机A')).toBe(203);
  });

  test('treats a failed read as unknown', async () => {
    const read = async () => {
      throw new Error('probe crashed');
    };
    const profiles = new PrinterProfiles(read, new FakeClock(), never);
    expect(await profiles.get('标签机A')).toBeNull();
  });

  // 缓存过期后重新读取期间，打印仍用上次读到的分辨率：不因为一次慢查询退回 203dpi。
  test('keeps using the last known resolution while a refresh is slow', async () => {
    const clock = new FakeClock();
    let slow = false;
    const read = () => (slow ? new Promise<null>(() => {}) : Promise.resolve(LABEL));
    const profiles = new PrinterProfiles(read, clock, immediately);
    expect(await profiles.dpiOf('标签机A')).toBe(300);
    clock.advance(PRINTER_PROFILE_TTL_MS);
    slow = true;
    expect(await profiles.dpiOf('标签机A')).toBe(300);
  });

  test('retries a failed read soon instead of keeping it for the full minute', async () => {
    const clock = new FakeClock();
    let reads = 0;
    const read = async () => {
      reads += 1;
      return null;
    };
    const profiles = new PrinterProfiles(read, clock, never);
    await profiles.get('标签机A');
    clock.advance(FAILED_READ_TTL_MS);
    await profiles.get('标签机A');
    expect(reads).toBe(2);
  });

  // 界面上核对驱动纸张时要读到现在的设置（操作员可能刚在系统设置里改过）。
  test('reads the driver again when asked for a fresh answer', async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return LABEL;
    };
    const profiles = new PrinterProfiles(read, new FakeClock(), never);
    await profiles.get('标签机A');
    await profiles.fresh('标签机A');
    expect(reads).toBe(2);
  });
});
