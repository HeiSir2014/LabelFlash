import { beforeEach, describe, expect, test } from 'bun:test';
import type { DriverCatalog } from '../../core/drivers/catalog-model';
import type { DetectedDevice } from '../../core/drivers/detected-device';
import { EXAMPLE_SIGNER, exampleCatalog } from '../../core/testing/driver-catalog-fixtures';
import { FakeClock } from '../../core/testing/fake-clock';
import {
  FAKE_DOWNLOAD,
  FakeDownloader,
  FakeInstaller,
  FakePrinterList,
  FakeVerifier,
} from '../../core/testing/fake-driver-ports';
import type { DriverStatus } from '../../shared/drivers';
import type { CatalogLoad } from './catalog-client';
import { DriverStation } from './driver-station';

const KNOWN: DetectedDevice = {
  key: 'usb-1234-abcd-00000001',
  usbId: { vendorId: 0x1234, productId: 0xabcd },
  name: '未知设备',
  problem: 'no-driver',
  problemCode: 28,
  isPrinterClass: false,
};
const UNKNOWN_PRINTER: DetectedDevice = {
  ...KNOWN,
  key: 'usb-9999-0001-00000002',
  usbId: { vendorId: 0x9999, productId: 1 },
  isPrinterClass: true,
};
const UNKNOWN_GADGET: DetectedDevice = {
  ...KNOWN,
  key: 'usb-9999-0002-00000003',
  usbId: { vendorId: 0x9999, productId: 2 },
};

let clock: FakeClock;
let pushed: DriverStatus[];
let opened: string[];
let installer: FakeInstaller;
let load: CatalogLoad;

function station(platform: 'windows' | 'mac' | null = 'windows'): DriverStation {
  const catalog = (): DriverCatalog | null => (load.kind === 'ready' ? load.catalog : null);
  return new DriverStation({
    platform,
    catalog: { load: async () => load, current: catalog },
    devices: { detect: async () => [KNOWN, UNKNOWN_PRINTER, UNKNOWN_GADGET] },
    flow: {
      downloader: new FakeDownloader(FAKE_DOWNLOAD),
      verifier: new FakeVerifier({ status: 'valid', signer: EXAMPLE_SIGNER }),
      installer,
      listPrinters: new FakePrinterList([[], ['示例标签机']]).list,
      sleep: async (ms) => clock.advance(ms),
      clock,
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    onStatus: (status) => pushed.push(status),
    clock,
    log: () => undefined,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  pushed = [];
  opened = [];
  installer = new FakeInstaller({ kind: 'installed', needsRestart: false });
  load = { kind: 'ready', catalog: exampleCatalog(), source: 'network', fetchedAt: clock.now(), staleIssue: null };
});

describe('DriverStation', () => {
  test('lists printer devices and catalog devices with what can be done for each', async () => {
    const status = await station().detect(false);
    expect(status.devices?.map((device) => [device.usbId, device.action.kind])).toEqual([
      ['1234:ABCD', 'install'],
      ['9999:0001', 'not-in-catalog'],
    ]);
    expect(status.catalog).toMatchObject({ state: 'ready', modelCount: 1, staleIssue: null });
  });

  test('says the catalog is not configured and still lists printer devices', async () => {
    load = { kind: 'unconfigured' };
    const status = await station().detect(false);
    expect(status.catalog).toEqual({ state: 'unconfigured' });
    expect(status.devices?.map((device) => device.action.kind)).toEqual(['no-catalog']);
  });

  test('installs, pushes progress, finds the new printer and refreshes the devices', async () => {
    const drivers = station();
    await drivers.detect(false);
    drivers.install(KNOWN.key);
    await drivers.settled();
    expect(installer.installed).toEqual([FAKE_DOWNLOAD.path]);
    expect(drivers.status().install).toMatchObject({
      id: 1,
      modelId: 'example-x1',
      deviceKey: KNOWN.key,
      state: { phase: 'done', newPrinters: ['示例标签机'] },
    });
    expect(pushed.some((status) => status.install?.state.phase === 'running')).toBe(true);
  });

  test('refuses a second install while one is running and unknown devices', async () => {
    const drivers = station();
    await drivers.detect(false);
    drivers.install(KNOWN.key);
    expect(() => drivers.install(KNOWN.key)).toThrow();
    await drivers.settled();
    expect(() => drivers.install('usb-0000-0000-00000000')).toThrow();
    expect(() => drivers.install(UNKNOWN_PRINTER.key)).toThrow();
  });

  test('opens only the https download page from the catalog', async () => {
    const drivers = station('mac');
    await drivers.detect(false);
    await drivers.openDownloadPage(KNOWN.key);
    expect(opened).toEqual(['https://example.invalid/drivers/x1-mac']);
    await expect(drivers.openDownloadPage(UNKNOWN_PRINTER.key)).rejects.toThrow();
  });

  test('does nothing on an unsupported platform', async () => {
    const status = await station(null).detect(false);
    expect(status).toMatchObject({ platform: 'unsupported', devices: null });
  });

  test('answers driver name questions from the current catalog', async () => {
    const drivers = station();
    expect(drivers.hints().modelForDriverName('示例品牌 X1')).toMatchObject({
      modelId: 'example-x1',
      canInstall: true,
    });
    load = { kind: 'unconfigured' };
    expect(drivers.hints().modelForDriverName('示例品牌 X1')).toBeNull();
  });

  test('reinstalls by driver name for the diagnosis', async () => {
    const drivers = station();
    await drivers.installForDriverName(' 示例品牌  x1 ');
    await drivers.settled();
    expect(drivers.status().install).toMatchObject({
      modelId: 'example-x1',
      deviceKey: null,
      state: { phase: 'done' },
    });
    await expect(drivers.installForDriverName('Generic / Text Only')).rejects.toThrow();
  });
});
