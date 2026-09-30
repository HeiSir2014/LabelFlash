import { beforeEach, describe, expect, test } from 'bun:test';
import type { PrintRequest, PrintResult } from '../../core/types';
import type { ImageRequest } from '../../shared/mobile-protocol';
import type { MobileStatus } from '../../shared/mobile-status';
import type { MobileHostDeps } from './mobile-host';
import { type MobileHostPort, MobileStation } from './mobile-station';

const OFFICIAL = 'https://official.example.com/labelflash/';
const MINE = 'https://mine.example.com/relay/';

type HostDeps = Pick<MobileHostDeps, 'relayBase' | 'print' | 'printerLabel' | 'imageRequest'>;

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

let settings: { mobileRelayUrl: string | null; paperPrinters: Record<string, string> };
let printerLabel: string | null;
let hosts: FakeHost[];
let statuses: MobileStatus[];
let submitted: PrintRequest[];
let printResult: PrintResult;
let imageRequest: ImageRequest | null;

function createStation(buildDefaultRelayUrl: string | null = OFFICIAL): MobileStation {
  return new MobileStation({
    settings: () => settings,
    buildDefaultRelayUrl,
    printerLabel: async () => printerLabel,
    submit: async (request) => {
      submitted.push(request);
      return printResult;
    },
    imageRequest: () => imageRequest,
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
  settings = { mobileRelayUrl: null, paperPrinters: { '60x40': 'LABEL_PRINTER_01' } };
  imageRequest = null;
  printerLabel = '热敏标签机';
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
    settings = { ...settings, paperPrinters: { '60x40': 'OTHER' } };
    station.settingsChanged(settings, previous);
    expect(onlyHost().calls).toContain('printerChanged');
  });

  test('tells the phones when a template changes which printers are used', () => {
    const station = createStation();
    station.start();
    station.printersChanged();
    expect(onlyHost().calls).toContain('printerChanged');
  });

  // 设置每次保存都是新对象：分配没变时不打扰手机。
  test('does not tell the phones anything when the assignment is saved unchanged', () => {
    const station = createStation();
    station.start();
    const previous = { ...settings };
    settings = { ...settings, paperPrinters: { ...settings.paperPrinters } };
    station.settingsChanged(settings, previous);
    expect(onlyHost().calls).not.toContain('printerChanged');
  });

  test('names the printers as the desktop summarises them', async () => {
    createStation().start();
    expect(await onlyHost().deps.printerLabel()).toBe('热敏标签机');
    printerLabel = null;
    expect(await onlyHost().deps.printerLabel()).toBeNull();
  });

  test('prints a phone job as a mobile print and trims the result for the phone', async () => {
    createStation().start();
    const result = await onlyHost().deps.print({ raw: 'CL5640', force: true, images: [], fields: [] });
    expect(submitted).toEqual([{ raw: 'CL5640', source: 'mobile', force: true }]);
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

  test('hands the label frames and typed fields to the print service', async () => {
    createStation().start();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    await onlyHost().deps.print({
      raw: 'CL5640',
      force: false,
      images: [{ jpeg, code: { x: 1, y: 2, size: 3 } }],
      fields: [{ name: '货架号', value: 'A-1-2-3' }],
    });
    expect(submitted).toEqual([
      {
        raw: 'CL5640',
        source: 'mobile',
        force: false,
        images: [{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), code: { x: 1, y: 2, size: 3 } }],
        manualFields: { 货架号: 'A-1-2-3' },
      },
    ]);
  });

  test('tells the phones only when the image request actually changed', () => {
    const station = createStation();
    station.start();
    station.rulesChanged();
    expect(onlyHost().calls).not.toContain('printerChanged');
    imageRequest = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130, frames: 3 };
    station.rulesChanged();
    station.rulesChanged();
    expect(onlyHost().calls.filter((call) => call === 'printerChanged')).toHaveLength(1);
  });

  test('passes the image request to the host for welcomes', () => {
    imageRequest = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130, frames: 3 };
    createStation().start();
    expect(onlyHost().deps.imageRequest()).toEqual(imageRequest);
  });
});
