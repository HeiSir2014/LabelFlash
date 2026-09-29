import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type { FieldsPrint } from '../../core/print-service';
import { BUILT_IN_TEMPLATES } from '../../core/templates/builtin-templates';
import { FakeClock } from '../../core/testing/fake-clock';
import type { PrintResult } from '../../core/types';
import type { LocalApiStatus } from '../../shared/local-api';
import { FRESH_SECRET_MS } from '../../shared/local-api';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../storage/database';
import { SqliteApiJobStore } from '../storage/sqlite-api-job-store';
import { DEFAULT_PORTS } from './http-server';
import { API_PORT_ENV, apiCandidatePorts, apiPortOrder, LocalApi } from './local-api';

const SITE = 'https://erp.example.com';
const SENT: PrintResult = {
  status: 'printed',
  jobId: 'r',
  scan: { raw: 'x', ruleId: 'api', ruleName: '本机接口', fields: [] },
};

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

interface HarnessOptions {
  firewall?: { status: 'allowed' | 'missing' | 'unknown'; gate: boolean };
  findPortOwner?: (port: number) => Promise<string | null>;
  settings?: Partial<AppSettings>;
  candidatePorts?: readonly number[];
}

function createLocalApi(options: HarnessOptions = {}) {
  const db: DatabaseSync = openDatabase(':memory:');
  let settings: AppSettings = { ...DEFAULT_SETTINGS, apiLanEnabled: false, ...options.settings };
  const printed: FieldsPrint[] = [];
  const statuses: LocalApiStatus[] = [];
  let jobsChanged = 0;
  let firewall = options.firewall?.status ?? 'unknown';
  const clock = new FakeClock();
  const api = new LocalApi({
    db,
    clock,
    appVersion: '1.1.0',
    settings: () => settings,
    updateSettings: (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },
    notifyOriginRequest: () => {},
    firewall: {
      check: async () => firewall,
      add: async () => {
        firewall = 'allowed';
        return firewall;
      },
    },
    holdLanUntilFirewallAllows: options.firewall?.gate ?? false,
    findTemplate: (id) => BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null,
    listTemplates: () => [...BUILT_IN_TEMPLATES],
    installedPrinters: async () => ['P1'],
    listPrinters: async () => [],
    printFields: async (input) => {
      printed.push(input);
      return SENT;
    },
    renderPdf: async () => new TextEncoder().encode('%PDF-1.7'),
    candidatePorts: options.candidatePorts ?? [0],
    findPortOwner: options.findPortOwner ?? (async () => 'nginx'),
    lanAddresses: () => ['192.168.1.20'],
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => {
      jobsChanged += 1;
    },
  });
  cleanups.push(() => db.close());
  cleanups.push(() => api.stop());
  const baseUrl = () => {
    const { server } = api.status();
    if (server.state !== 'listening') {
      throw new Error('local api is not listening');
    }
    return `http://127.0.0.1:${server.port}`;
  };
  return {
    api,
    db,
    clock,
    printed,
    statuses,
    baseUrl,
    jobsChanged: () => jobsChanged,
    settings: () => settings,
    setSettings: (next: AppSettings) => {
      const previous = settings;
      settings = next;
      return api.settingsChanged(next, previous);
    },
  };
}

async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (done(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
}

describe('LocalApi', () => {
  test('prints a job submitted with a program key and reports its state', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    const { secret } = harness.api.createKey('ERP');
    const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
    const created = await fetch(`${harness.baseUrl()}/v1/printJobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        template: 'templates/builtin-standard',
        fields: [{ name: '订单号', value: 'A001' }],
        copies: 2,
      }),
    });
    expect(created.status).toBe(200);
    const { name } = (await created.json()) as { name: string };
    const job = await poll(
      async () => (await (await fetch(`${harness.baseUrl()}/v1/${name}`, { headers })).json()) as { state: string },
      (value) => value.state === 'SENT',
    );
    expect(job).toMatchObject({ state: 'SENT', sentCopies: 2 });
    expect(harness.printed).toHaveLength(2);
    expect(harness.printed[0]?.caller).toMatch(/^key:/);
    // 界面刷新打印记录的通知合并发出：等它到。
    await poll(
      async () => harness.jobsChanged(),
      (count) => count > 0,
    );
  });

  test('reports the addresses it listens on', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    expect(harness.statuses.at(-1)).toMatchObject({
      server: { state: 'listening', lanEnabled: false },
      lanAddresses: ['192.168.1.20'],
      authorizedOrigins: [],
    });
  });

  test('restarts on the LAN when the switch is turned on, and stops the old listener', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    await harness.setSettings({ ...harness.settings(), apiLanEnabled: true });
    expect(harness.api.status().server).toMatchObject({ state: 'listening', lanEnabled: true });
  });

  test('remembers a website the operator allows and tells the page to retry', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    const denied = await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } });
    expect(denied.status).toBe(403);
    expect(harness.statuses.at(-1)?.pendingOrigins).toEqual([SITE]);
    harness.api.decideOrigin(SITE, true);
    expect(harness.settings().apiAuthorizedOrigins).toEqual([SITE]);
    expect(harness.statuses.at(-1)?.authorizedOrigins).toEqual([SITE]);
    const allowed = await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } });
    expect(allowed.status).toBe(200);
    harness.api.revokeOrigin(SITE);
    expect(harness.settings().apiAuthorizedOrigins).toEqual([]);
    expect((await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } })).status).toBe(403);
  });

  test('tells a website the operator refused that it was refused', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } });
    harness.api.decideOrigin(SITE, false);
    const response = await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } });
    expect(JSON.stringify(await response.json())).toContain('ORIGIN_DENIED');
    expect(harness.statuses.at(-1)?.pendingOrigins).toEqual([]);
  });

  test('marks jobs left unfinished by the last run as interrupted on start', async () => {
    const harness = createLocalApi();
    new SqliteApiJobStore(harness.db).insert({
      id: 'old',
      caller: 'key:k1',
      templateId: 'builtin:standard',
      fields: [{ name: 'a', value: '1' }],
      content: null,
      copies: 2,
      printer: null,
      requestId: null,
      state: 'PRINTING',
      sentCopies: 1,
      failure: null,
      createdAt: new FakeClock().now(),
      updatedAt: new FakeClock().now(),
    });
    await harness.api.start();
    expect(harness.api.jobs.get('old')).toMatchObject({ state: 'FAILED', failure: { reason: 'INTERRUPTED' } });
    expect(harness.printed).toEqual([]);
  });

  // 密钥原文只在生成后的一小段时间里留在内存里，给「复制」按钮用；不写库、不写日志。
  test('keeps a new secret for copying only for a short while', () => {
    const harness = createLocalApi();
    const { key, secret } = harness.api.createKey('ERP');
    expect(harness.api.freshSecret(key.id)).toBe(secret);
    harness.clock.advance(FRESH_SECRET_MS);
    expect(harness.api.freshSecret(key.id)).toBeNull();
  });

  test('forgets a new secret when its key is removed', () => {
    const harness = createLocalApi();
    const { key } = harness.api.createKey('ERP');
    harness.api.removeKey(key.id);
    expect(harness.api.freshSecret(key.id)).toBeNull();
  });

  test('stops accepting a key once it is removed', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    const { key, secret } = harness.api.createKey('ERP');
    const headers = { authorization: `Bearer ${secret}` };
    expect((await fetch(`${harness.baseUrl()}/v1/templates`, { headers })).status).toBe(200);
    harness.api.removeKey(key.id);
    expect((await fetch(`${harness.baseUrl()}/v1/templates`, { headers })).status).toBe(401);
  });
});

async function occupyPort(): Promise<number> {
  const blocker: Server = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
  const address = blocker.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

describe('LocalApi ports', () => {
  // 端口被占用时自动换，不要操作员手工填；换了就在状态里说清楚，并记住新端口。
  test('moves to a free port when the preferred ones are taken, and remembers it', async () => {
    const taken = await occupyPort();
    const harness = createLocalApi({ candidatePorts: [taken] });
    await harness.api.start();
    const { server, portOwner } = harness.api.status();
    expect(server).toMatchObject({ state: 'listening', skippedPorts: [taken] });
    expect(portOwner).toBe('nginx');
    expect(harness.settings().apiLastPort).toBe(server.state === 'listening' ? server.port : -1);
  });

  test('moves on from a taken port the user chose, too', async () => {
    const taken = await occupyPort();
    const harness = createLocalApi({ settings: { apiPort: taken } });
    await harness.api.start();
    expect(harness.api.status().server).toMatchObject({ state: 'listening', skippedPorts: [taken] });
  });

  // 清空指定的端口就是回到默认端口：不能被上次记住的（指定的）端口留住。
  test('forgets the remembered port when the user clears a chosen port', async () => {
    const harness = createLocalApi({ settings: { apiPort: 18_123, apiLastPort: 18_123 } });
    await harness.setSettings({ ...harness.settings(), apiPort: null });
    expect(harness.settings().apiLastPort).not.toBe(18_123);
  });
});

describe('LocalApi firewall', () => {
  // 安装版：防火墙还没放行时先不对局域网监听，Windows 就不会弹自己的防火墙警告（普通用户点取消会留下阻止规则）。
  test('keeps to this computer until the firewall lets the program through', async () => {
    const harness = createLocalApi({ settings: { apiLanEnabled: true }, firewall: { status: 'missing', gate: true } });
    await harness.api.start();
    expect(harness.api.status()).toMatchObject({
      server: { state: 'listening', lanEnabled: false },
      firewall: 'missing',
      lanHeldBack: true,
    });
    expect(await harness.api.addFirewallRule()).toBe('allowed');
    expect(harness.api.status()).toMatchObject({
      server: { state: 'listening', lanEnabled: true },
      firewall: 'allowed',
      lanHeldBack: false,
    });
  });

  test('opens the LAN when the firewall state cannot be read', async () => {
    const harness = createLocalApi({ settings: { apiLanEnabled: true }, firewall: { status: 'unknown', gate: true } });
    await harness.api.start();
    expect(harness.api.status()).toMatchObject({ server: { lanEnabled: true }, lanHeldBack: false });
  });

  // 开发版和 E2E 不受本机防火墙影响。
  test('does not hold the LAN back when told not to', async () => {
    const harness = createLocalApi({ settings: { apiLanEnabled: true }, firewall: { status: 'missing', gate: false } });
    await harness.api.start();
    expect(harness.api.status()).toMatchObject({ server: { lanEnabled: true }, lanHeldBack: false });
  });
});

describe('LocalApi service identity', () => {
  // 局域网里的程序靠它确认找到的还是原来那台电脑：生成一次，之后不变。
  test('creates an instance id once and reports it in /v1/service', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    const id = harness.settings().apiInstanceId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const service = (await (await fetch(`${harness.baseUrl()}/v1/service`)).json()) as { instanceId: string };
    expect(service.instanceId).toBe(id ?? '');
    await harness.setSettings({ ...harness.settings(), apiLanEnabled: true });
    expect(harness.settings().apiInstanceId).toBe(id);
  });
});

describe('LocalApi restarts', () => {
  // 查占用端口的程序要启动 PowerShell，最多几秒：先把状态发出去，查到了再补上，不拖慢保存设置。
  test('publishes the new port before the owner of the skipped port is known', async () => {
    const taken = await occupyPort();
    let answer: (owner: string) => void = () => {};
    const harness = createLocalApi({
      candidatePorts: [taken],
      findPortOwner: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await harness.api.start();
    expect(harness.statuses.at(-1)).toMatchObject({ server: { state: 'listening' }, portOwner: null });
    answer('nginx');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.statuses.at(-1)?.portOwner).toBe('nginx');
  });

  test('applies the latest settings when changes arrive together', async () => {
    const harness = createLocalApi();
    await harness.api.start();
    const base = harness.settings();
    await Promise.all([
      harness.setSettings({ ...base, apiLanEnabled: true }),
      harness.setSettings({ ...base, apiLanEnabled: true, apiPort: 18_431 }),
    ]);
    expect(harness.api.status().server).toMatchObject({ state: 'listening', lanEnabled: true, port: 18_431 });
  });
});

describe('apiPortOrder', () => {
  test('tries the chosen port, then the last one that worked, then the defaults, then any free port', () => {
    expect(apiPortOrder({ apiPort: 18_000, apiLastPort: 17_632 }, [17_631, 17_632, 17_633])).toEqual([
      18_000, 17_632, 17_631, 17_633, 0,
    ]);
    expect(apiPortOrder({ apiPort: null, apiLastPort: null }, [17_631, 17_632, 17_633])).toEqual([
      17_631, 17_632, 17_633, 0,
    ]);
  });
});

describe('apiCandidatePorts', () => {
  test('uses the default ports in the installed app', () => {
    expect(apiCandidatePorts({ [API_PORT_ENV]: '0' }, true)).toEqual(DEFAULT_PORTS);
    expect(apiCandidatePorts({}, false)).toEqual(DEFAULT_PORTS);
  });

  // E2E、开发版用单独的端口（0 = 系统随便给一个），不和本机上跑着的安装版抢端口。
  test('lets unpackaged runs pick their own port', () => {
    expect(apiCandidatePorts({ [API_PORT_ENV]: '0' }, false)).toEqual([0]);
    expect(apiCandidatePorts({ [API_PORT_ENV]: '18080' }, false)).toEqual([18080]);
    expect(apiCandidatePorts({ [API_PORT_ENV]: 'x' }, false)).toEqual(DEFAULT_PORTS);
  });
});
