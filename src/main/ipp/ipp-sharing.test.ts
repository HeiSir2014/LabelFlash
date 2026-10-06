import { afterEach, describe, expect, test } from 'bun:test';
import { nameAttr } from '../../core/ipp/ipp-attributes';
import { GROUP_TAGS, OPERATIONS } from '../../core/ipp/ipp-constants';
import { attributeIn, ippRequest, MINIMAL_PDF } from '../../core/ipp/testing/ipp-requests';
import type { FieldsPrint } from '../../core/print-service';
import { FakeClock } from '../../core/testing/fake-clock';
import type { IppSharingStatus } from '../../shared/ipp-sharing';
import type { FirewallStatus } from '../../shared/local-api';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../storage/database';
import { SqliteIppStore } from '../storage/sqlite-ipp-store';
import type { PendingClient } from './client-approvals';
import {
  IppSharing,
  type IppSharingDeps,
  ippBindHost,
  ippCandidatePorts,
  isDiscoveryEnabled,
  printerUuid,
} from './ipp-sharing';
import { FakeRenderer, MemoryPieces, PRINTED } from './testing/fakes';
import { sendIpp } from './testing/ipp-client';

const sharings: IppSharing[] = [];

afterEach(async () => {
  await Promise.all(sharings.splice(0).map((sharing) => sharing.stop()));
});

function createSharing(patch: Partial<AppSettings> = {}, overrides: Partial<IppSharingDeps> = {}) {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ippSharingEnabled: true,
    paperPrinters: { '60x40': '标签机A', '100x150': '没装的打印机' },
    ...patch,
  };
  const statuses: IppSharingStatus[] = [];
  const printed: FieldsPrint[] = [];
  const notified: PendingClient[] = [];
  const firewall: { state: FirewallStatus } = { state: 'unknown' };
  const sharing = new IppSharing({
    clock: new FakeClock(),
    settings: () => settings,
    updateSettings: (next) => {
      settings = { ...settings, ...next };
      return settings;
    },
    store: new SqliteIppStore(openDatabase(':memory:')),
    computerName: () => '前台',
    productNameAscii: 'CDL-LabelFlash',
    makeAndModel: 'CDL-云签速印 共享热敏标签机',
    installedPrinters: async () => ['标签机A'],
    readinessOf: () => null,
    dpiOf: async () => 203,
    firewall: {
      check: async () => firewall.state,
      checkDiscovery: async () => firewall.state,
      add: async () => {
        firewall.state = 'allowed';
        return firewall.state;
      },
    },
    holdUntilFirewallAllows: false,
    candidatePorts: [0],
    // 测试只在本机回环上开端口，不往局域网广播。
    ipv4Host: '127.0.0.1',
    discoveryEnabled: false,
    lanInterfaces: () => [],
    render: {
      renderer: new FakeRenderer(),
      pieces: new MemoryPieces(),
      printFields: async (input) => {
        printed.push(input);
        return PRINTED;
      },
    },
    findPortOwner: async () => null,
    notifyClientRequest: (client) => notified.push(client),
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    sleep: async () => undefined,
    log: () => undefined,
    ...overrides,
  });
  sharings.push(sharing);
  return {
    sharing,
    statuses,
    printed,
    notified,
    firewall,
    settings: () => settings,
    /** 像操作员保存设置那样改：之后再调 settingsChanged。 */
    update: (next: Partial<AppSettings>) => {
      settings = { ...settings, ...next };
    },
  };
}

function urlOf(status: IppSharingStatus): string {
  if (status.server.state !== 'listening') {
    throw new Error(`not listening: ${JSON.stringify(status.server)}`);
  }
  return `http://127.0.0.1:${status.server.port}/printers/60x40`;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

describe('IppSharing', () => {
  test('stays off until sharing is turned on', async () => {
    const { sharing } = createSharing({ ippSharingEnabled: false });
    await sharing.start();
    expect(sharing.status().server).toEqual({ state: 'off' });
  });

  test('shares only papers whose printer is installed and remembers the port', async () => {
    const { sharing, settings } = createSharing();
    await sharing.start();
    const status = sharing.status();
    expect(status.server.state).toBe('listening');
    expect(status.printers).toEqual([{ key: '60x40', name: '60×40 标签', printerName: '标签机A' }]);
    expect(settings().ippLastPort).toBe(status.server.state === 'listening' ? status.server.port : -1);
    expect(settings().ippInstanceId).not.toBeNull();
  });

  test('waits for the Windows firewall in the installed app', async () => {
    const { sharing, firewall } = createSharing({}, { holdUntilFirewallAllows: true });
    firewall.state = 'missing';
    await sharing.start();
    expect(sharing.status().server).toEqual({ state: 'held' });
    await sharing.addFirewallRule();
    expect(sharing.status().server.state).toBe('listening');
  });

  test('asks the operator about a new computer, then prints its job as a LAN share record', async () => {
    const { sharing, printed, notified } = createSharing();
    await sharing.start();
    const reply = await sendIpp(
      urlOf(sharing.status()),
      ippRequest(OPERATIONS.printJob, { operation: [nameAttr('requesting-user-name', 'zhang')] }),
      MINIMAL_PDF,
    );
    expect(attributeIn(reply.message ?? ippRequest(0), GROUP_TAGS.job, 'job-state')?.values).toEqual([
      { kind: 'enum', value: 4 },
    ]);
    await waitUntil(() => sharing.status().pendingClients.length === 1);
    expect(notified).toMatchObject([{ address: '127.0.0.1', user: 'zhang', printerName: '60×40 标签' }]);
    expect(sharing.pendingJobs).toBe(1);
    sharing.decideClient('127.0.0.1', true);
    await waitUntil(() => printed.length === 1);
    expect(printed[0]).toMatchObject({ source: 'ipp', ipp: { client: '127.0.0.1', user: 'zhang' } });
    expect(sharing.status().clients).toMatchObject([{ address: '127.0.0.1', decision: 'allow', lastUser: 'zhang' }]);
    await waitUntil(() => sharing.pendingJobs === 0);
  });

  test('aborts open jobs when sharing is turned off', async () => {
    const { sharing, settings, update } = createSharing();
    await sharing.start();
    await sendIpp(urlOf(sharing.status()), ippRequest(OPERATIONS.printJob), MINIMAL_PDF);
    await waitUntil(() => sharing.status().pendingClients.length === 1);
    const before = settings();
    update({ ippSharingEnabled: false });
    await sharing.settingsChanged(settings(), before);
    expect(sharing.pendingJobs).toBe(0);
    expect(sharing.status().pendingClients).toEqual([]);
  });

  test('asks for the share password once it is set', async () => {
    const { sharing } = createSharing();
    await sharing.start();
    await sharing.setPassword('1234');
    expect(sharing.status().passwordSet).toBe(true);
    expect((await sendIpp(urlOf(sharing.status()), ippRequest(OPERATIONS.printJob), MINIMAL_PDF)).httpStatus).toBe(401);
    await sharing.clearPassword();
    expect(sharing.status().passwordSet).toBe(false);
  });

  test('moves to a chosen port and stops when sharing is turned off', async () => {
    const { sharing, settings, update } = createSharing();
    await sharing.start();
    const first = settings();
    update({ ippPort: null, ippLastPort: null });
    await sharing.settingsChanged(settings(), { ...first, ippPort: 1 });
    expect(sharing.status().server.state).toBe('listening');
    const before = settings();
    update({ ippSharingEnabled: false });
    await sharing.settingsChanged(settings(), before);
    expect(sharing.status().server).toEqual({ state: 'off' });
  });
});

describe('printerUuid', () => {
  test('is stable for an instance and a paper and shaped like a version 5 UUID', () => {
    const uuid = printerUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '60x40');
    expect(uuid).toBe(printerUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '60x40'));
    expect(uuid).not.toBe(printerUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '100x150'));
    expect(uuid).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('development switches', () => {
  test('take a port, loopback-only binding and no discovery only in the unpackaged app', () => {
    const env = { CDL_LABELFLASH_IPP_PORT: '0', CDL_LABELFLASH_IPP_DISCOVERY: '0', CDL_LABELFLASH_IPP_LOOPBACK: '1' };
    expect(ippBindHost(env, false)).toBe('127.0.0.1');
    expect(ippBindHost(env, true)).toBeUndefined();
    expect(ippBindHost({}, false)).toBeUndefined();
    expect(ippCandidatePorts(env, false)).toEqual([0]);
    expect(ippCandidatePorts(env, true)).toHaveLength(10);
    expect(isDiscoveryEnabled(env, false)).toBe(false);
    expect(isDiscoveryEnabled(env, true)).toBe(true);
  });
});
