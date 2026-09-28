import { beforeEach, describe, expect, test } from 'bun:test';
import type { PrinterInfo, PrintRequest, PrintResult } from '../../core/types';
import type { MobileStatus } from '../../shared/mobile-status';
import type { MobileHostDeps } from './mobile-host';
import { type MobileHostPort, MobileStation } from './mobile-station';

const OFFICIAL = 'https://official.example.com/labelflash/';
const MINE = 'https://mine.example.com/relay/';
const PRINTERS: PrinterInfo[] = [{ name: 'LABEL_PRINTER_01', displayName: '热敏标签机' }];

type HostDeps = Pick<MobileHostDeps, 'relayBase' | 'print' | 'selectedPrinter'>;

class FakeHost implements MobileHostPort {
  readonly calls: string[] = [];
  private listener: ((status: MobileStatus) => void) | null = null;
  current: MobileStatus = { state: 'off' };

  constructor(readonly deps: HostDeps) {}

  start(): MobileStatus {
    this.calls.push('start');
    this.current = { state: 'connecting' };
    this.listener?.(this.current);
    return this.current;
  }

  stop(reason: string): void {
    this.calls.push(`stop:${reason}`);
    this.current = { state: 'off' };
    this.listener?.(this.current);
  }

  status(): MobileStatus {
    return this.current;
  }

  onStatus(listener: (status: MobileStatus) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  printerChanged(): void {
    this.calls.push('printerChanged');
  }

  removePhone(id: string): void {
    this.calls.push(`remove:${id}`);
  }

  setJoinLocked(locked: boolean): void {
    this.calls.push(`locked:${locked}`);
  }

  tick(): void {
    this.calls.push('tick');
  }
}

let settings: { mobileRelayUrl: string | null; selectedPrinter: string | null };
let hosts: FakeHost[];
let statuses: MobileStatus[];
let submitted: PrintRequest[];
let printResult: PrintResult;

function createStation(buildDefaultRelayUrl: string | null = OFFICIAL): MobileStation {
  return new MobileStation({
    settings: () => settings,
    buildDefaultRelayUrl,
    listPrinters: async () => PRINTERS,
    submit: async (request) => {
      submitted.push(request);
      return printResult;
    },
    createHost: (deps) => {
      const host = new FakeHost(deps);
      hosts.push(host);
      return host;
    },
    onStatus: (status) => statuses.push(status),
    log: () => {},
  });
}

function onlyHost(): FakeHost {
  const [host, ...rest] = hosts;
  if (!host || rest.length > 0) {
    throw new Error(`expected one host, got ${hosts.length}`);
  }
  return host;
}

beforeEach(() => {
  settings = { mobileRelayUrl: null, selectedPrinter: 'LABEL_PRINTER_01' };
  hosts = [];
  statuses = [];
  submitted = [];
  printResult = {
    status: 'printed',
    jobId: 'j1',
    scan: { raw: 'CL5640', ruleId: 'builtin:raw', ruleName: '原样打印', fields: [{ name: '内容', value: 'CL5640' }] },
  };
});

describe('MobileStation', () => {
  test('asks for a relay address when neither the setting nor the package has one', () => {
    const station = createStation(null);
    expect(station.start()).toEqual({ state: 'failed', error: 'not-configured' });
    expect(hosts).toEqual([]);
    expect(statuses.at(-1)).toEqual({ state: 'failed', error: 'not-configured' });
    station.stop();
    expect(station.status()).toEqual({ state: 'off' });
  });

  test('connects to the address the package was built with', () => {
    createStation().start();
    expect(onlyHost().deps.relayBase.href).toBe(OFFICIAL);
    expect(onlyHost().calls).toEqual(['start']);
  });

  test('prefers the address set on this computer', () => {
    settings.mobileRelayUrl = MINE;
    createStation().start();
    expect(onlyHost().deps.relayBase.href).toBe(MINE);
  });

  test('keeps the same session when started again', () => {
    const station = createStation();
    station.start();
    station.start();
    expect(onlyHost().calls).toEqual(['start', 'start']);
  });

  test('ends the session when the relay address changes, and connects to the new one next time', () => {
    const station = createStation();
    station.start();
    const previous = { ...settings };
    settings.mobileRelayUrl = MINE;
    station.settingsChanged(settings, previous);
    expect(hosts[0]?.calls).toEqual(['start', 'stop:stopped']);
    expect(station.status()).toEqual({ state: 'off' });
    station.start();
    expect(hosts[1]?.deps.relayBase.href).toBe(MINE);
  });

  test('tells the phones when the printer changes', () => {
    const station = createStation();
    station.start();
    const previous = { ...settings };
    settings.selectedPrinter = 'OTHER';
    station.settingsChanged(settings, previous);
    expect(onlyHost().calls).toContain('printerChanged');
  });

  test('names the printer as the desktop shows it, or by its system name when it is gone', async () => {
    createStation().start();
    expect(await onlyHost().deps.selectedPrinter()).toEqual({ name: 'LABEL_PRINTER_01', displayName: '热敏标签机' });
    settings.selectedPrinter = 'UNPLUGGED';
    expect(await onlyHost().deps.selectedPrinter()).toEqual({ name: 'UNPLUGGED', displayName: 'UNPLUGGED' });
    settings.selectedPrinter = null;
    expect(await onlyHost().deps.selectedPrinter()).toBeNull();
  });

  test('prints a phone job as a mobile print and trims the result for the phone', async () => {
    createStation().start();
    const result = await onlyHost().deps.print('CL5640', true, 'LABEL_PRINTER_01');
    expect(submitted).toEqual([{ raw: 'CL5640', printerName: 'LABEL_PRINTER_01', source: 'mobile', force: true }]);
    expect(result).toEqual({ status: 'printed', ruleName: '原样打印', fields: [{ name: '内容', value: 'CL5640' }] });
  });

  test('passes removals, join locks and ticks to the session', () => {
    const station = createStation();
    station.start();
    station.removePhone('p1');
    station.setJoinLocked(false);
    station.tick();
    expect(onlyHost().calls).toEqual(['start', 'remove:p1', 'locked:false', 'tick']);
  });

  test('tells the phones the program quit', () => {
    const station = createStation();
    station.start();
    station.quit();
    expect(onlyHost().calls.at(-1)).toBe('stop:quit');
  });

  test('forwards status changes to the window', () => {
    createStation().start();
    expect(statuses.at(-1)).toEqual({ state: 'connecting' });
  });
});
