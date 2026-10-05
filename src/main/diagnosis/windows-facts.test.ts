import { describe, expect, test } from 'bun:test';
import { fixture } from './testing/fixtures';
import {
  parseJobsReply,
  parsePaperOptionsReply,
  parsePrinterReply,
  parseSpoolerReply,
  parseUsbReply,
} from './windows-facts';

const sample = (name: string) => fixture('windows', name);

describe('parseSpoolerReply', () => {
  test('reads the service state and start type', () => {
    expect(parseSpoolerReply(sample('spooler-running.txt'))).toEqual({
      kind: 'windows',
      state: 'running',
      startType: 'automatic',
    });
    expect(parseSpoolerReply(sample('spooler-disabled.txt'))).toEqual({
      kind: 'windows',
      state: 'stopped',
      startType: 'disabled',
    });
  });

  test('is unknown when the probe failed or answered nonsense', () => {
    expect(parseSpoolerReply(null)).toMatchObject({ kind: 'unknown' });
    expect(parseSpoolerReply('Get-Service : Access denied')).toMatchObject({ kind: 'unknown' });
    expect(parseSpoolerReply('[]')).toMatchObject({ kind: 'unknown' });
  });
});

describe('parsePrinterReply', () => {
  test('reuses the status rules of the background monitor', () => {
    expect(parsePrinterReply(sample('printer-paper-out.txt'))).toEqual({
      kind: 'known',
      readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
      paused: false,
      driverName: '热敏标签机驱动',
    });
    expect(parsePrinterReply(sample('printer-paused.txt'))).toMatchObject({ paused: true });
  });
});

describe('parseUsbReply', () => {
  test('finds the present device whose instance id ends with the port', () => {
    expect(parseUsbReply(sample('usb-present.txt'))).toEqual({ kind: 'present', deviceName: '热敏标签机' });
    expect(parseUsbReply(sample('usb-disconnected.txt'))).toEqual({ kind: 'disconnected', deviceName: '热敏标签机' });
  });

  test('reports a device problem code and a USB port without a device', () => {
    expect(
      parseUsbReply(
        '{"port":"USB003","devices":[{"instanceId":"USBPRINT\\\\X\\\\7&1&0&USB003","name":"热敏标签机","present":true,"problem":28}]}',
      ),
    ).toEqual({ kind: 'problem', deviceName: '热敏标签机', code: 28 });
    expect(parseUsbReply('{"port":"USB009","devices":[]}')).toEqual({ kind: 'not-found', port: 'USB009' });
  });

  test('does not apply to printers on other ports', () => {
    expect(parseUsbReply(sample('usb-network.txt'))).toEqual({ kind: 'not-usb', port: 'WSD-6c2f4e1a-0001' });
  });
});

describe('parseJobsReply', () => {
  test('reads jobs with their flags, user and submit time', () => {
    const facts = parseJobsReply(sample('jobs-stuck.txt'));
    expect(facts).toMatchObject({ kind: 'listed', currentUser: 'shop', total: 3 });
    expect(facts.kind === 'listed' ? facts.jobs.map((job) => [job.id, job.flags]) : []).toEqual([
      [11, ['error', 'printing']],
      [12, []],
      [13, ['paused']],
    ]);
    expect(parseJobsReply(sample('jobs-one.txt'))).toMatchObject({ total: 1, jobs: [{ id: 7 }] });
  });

  test('drops malformed jobs and never takes flags from the prototype', () => {
    const facts = parseJobsReply(
      '{"user":"shop","total":2,"jobs":[{"id":"x"},{"id":5,"document":"a","user":"shop","status":"__proto__, constructor","submittedMs":1}]}',
    );
    expect(facts).toMatchObject({ kind: 'listed', total: 2, jobs: [{ id: 5, flags: [] }] });
  });
});

describe('parsePaperOptionsReply', () => {
  test('keeps options with a valid XML name and microns, and the custom-size flag', () => {
    expect(parsePaperOptionsReply(sample('paper-options.txt'))).toEqual({
      options: [
        {
          namespace: 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords',
          localName: 'ISOA4',
          widthMicrons: 210_000,
          heightMicrons: 297_000,
        },
        {
          namespace: 'urn:labelflash-test:label-driver',
          localName: 'User0000000257',
          widthMicrons: 60_000,
          heightMicrons: 40_000,
        },
        {
          namespace: 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords',
          localName: 'CustomMediaSize',
          widthMicrons: null,
          heightMicrons: null,
        },
      ],
      supportsCustom: true,
    });
    expect(parsePaperOptionsReply(null)).toBeNull();
  });
});
