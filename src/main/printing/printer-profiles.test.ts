import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { PRINTER_PROFILE_TTL_MS, PrinterProfiles } from './printer-profiles';

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
});
