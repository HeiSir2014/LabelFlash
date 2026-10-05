import { describe, expect, test } from 'bun:test';
import {
  macUsbFacts,
  parseDeviceUri,
  parseIppJobs,
  parseIppPrinterState,
  parseSchedulerStatus,
  parseSystemProfilerUsb,
  readinessFromReasons,
} from './mac-facts';
import { fixture } from './testing/fixtures';

const sample = (name: string) => fixture('mac', name);

describe('parseSchedulerStatus', () => {
  test('reads whether cupsd runs', () => {
    expect(parseSchedulerStatus(sample('lpstat-r-running.txt'))).toBe(true);
    expect(parseSchedulerStatus(sample('lpstat-r-stopped.txt'))).toBe(false);
    expect(parseSchedulerStatus('调度程序正在运行')).toBeNull();
    expect(parseSchedulerStatus(null)).toBeNull();
  });
});

describe('parseIppPrinterState', () => {
  test('reads state, reasons, accepting and media from ipptool', () => {
    expect(parseIppPrinterState(sample('ipp-printer-stopped.txt'))).toEqual({
      state: 'stopped',
      reasons: ['paused', 'media-empty-error'],
      acceptingJobs: true,
      makeAndModel: 'Label Printer 203dpi',
      mediaDefault: 'oe_4x6-label_4x6in',
      mediaSupported: ['oe_4x6-label_4x6in', 'om_60x40mm_60x40mm', 'custom_min_25.4x12.7mm', 'custom_max_104x990mm'],
    });
    expect(parseIppPrinterState(sample('ipp-printer-idle.txt'))).toMatchObject({ state: 'idle', reasons: [] });
  });
});

describe('readinessFromReasons', () => {
  test('maps CUPS state reasons to the same issues as Windows', () => {
    expect(readinessFromReasons(['paused', 'media-empty-error'])).toEqual({
      ready: false,
      detail: '缺纸',
      issue: 'paperOut',
    });
    expect(readinessFromReasons(['offline-report', 'cover-open-error'])).toEqual({
      ready: false,
      detail: '打印机离线、机盖未关',
      issue: 'doorOpen',
    });
    expect(readinessFromReasons(['none'])).toEqual({ ready: true });
  });
});

describe('USB on macOS', () => {
  test('matches the CUPS usb:// device by serial number on both system_profiler layouts', () => {
    const uri = parseDeviceUri(sample('lpstat-v-usb.txt'));
    expect(uri).toBe('usb://Label%20Maker/Label%20Printer%20203?serial=LBL0001');
    expect(macUsbFacts(uri, parseSystemProfilerUsb(sample('system-profiler-usb.txt')))).toEqual({
      kind: 'present',
      deviceName: 'Label Printer 203',
    });
    expect(macUsbFacts(uri, parseSystemProfilerUsb(sample('system-profiler-usb-host.txt')))).toEqual({
      kind: 'present',
      deviceName: 'Label Printer 203',
    });
  });

  test('reports a USB printer missing from the USB tree and skips network printers', () => {
    const uri = parseDeviceUri(sample('lpstat-v-usb.txt'));
    expect(macUsbFacts(uri, [])).toEqual({ kind: 'not-found', port: 'usb://Label Maker/Label Printer 203' });
    expect(macUsbFacts(parseDeviceUri(sample('lpstat-v-network.txt')), [])).toEqual({
      kind: 'not-usb',
      port: 'dnssd',
    });
    expect(macUsbFacts(null, [])).toMatchObject({ kind: 'unknown' });
  });
});

describe('parseIppJobs', () => {
  test('splits jobs where an attribute repeats and converts seconds to milliseconds', () => {
    expect(parseIppJobs(sample('ipp-jobs.txt'), 'shop')).toEqual({
      kind: 'listed',
      currentUser: 'shop',
      total: 2,
      jobs: [
        { id: 41, document: 'CL5640-TK-图片色-XL', user: 'shop', submittedAtMs: 1_790_000_000_000, flags: ['stopped'] },
        { id: 42, document: 'report.pdf', user: 'boss', submittedAtMs: 1_789_990_000_000, flags: ['held'] },
      ],
    });
  });

  test('an empty queue has no jobs; no output means it could not be read', () => {
    expect(parseIppJobs('    LabelFlash Get-Jobs [PASS]\n', 'shop')).toMatchObject({ kind: 'listed', total: 0 });
    expect(parseIppJobs(null, 'shop')).toMatchObject({ kind: 'unknown' });
  });
});
