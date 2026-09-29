import { afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { FieldsPrint } from '../../core/print-service';
import { BUILT_IN_TEMPLATES } from '../../core/templates/builtin-templates';
import { FakeClock } from '../../core/testing/fake-clock';
import type { PrintResult } from '../../core/types';
import type { LocalApiStatus } from '../../shared/local-api';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../storage/database';
import { SqliteApiJobStore } from '../storage/sqlite-api-job-store';
import { DEFAULT_PORTS } from './http-server';
import { API_PORT_ENV, apiCandidatePorts, FRESH_SECRET_MS, LocalApi } from './local-api';

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

function createLocalApi(options: { askOrigin?: (origin: string) => Promise<boolean> } = {}) {
  const db: DatabaseSync = openDatabase(':memory:');
  let settings: AppSettings = { ...DEFAULT_SETTINGS, apiLanEnabled: false };
  const printed: FieldsPrint[] = [];
  const statuses: LocalApiStatus[] = [];
  let jobsChanged = 0;
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
    askOrigin: options.askOrigin ?? (async () => false),
    findTemplate: (id) => BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null,
    listTemplates: () => [...BUILT_IN_TEMPLATES],
    installedPrinters: async () => ['P1'],
    listPrinters: async () => [],
    printFields: async (input) => {
      printed.push(input);
      return SENT;
    },
    renderPdf: async () => new TextEncoder().encode('%PDF-1.7'),
    candidatePorts: [0],
    findPortOwner: async () => null,
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
    const harness = createLocalApi({ askOrigin: async () => true });
    await harness.api.start();
    const denied = await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } });
    expect(denied.status).toBe(403);
    await poll(
      async () => harness.settings().apiAuthorizedOrigins,
      (origins) => origins.includes(SITE),
    );
    expect(harness.statuses.at(-1)?.authorizedOrigins).toEqual([SITE]);
    const allowed = await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } });
    expect(allowed.status).toBe(200);
    harness.api.revokeOrigin(SITE);
    expect(harness.settings().apiAuthorizedOrigins).toEqual([]);
    expect((await fetch(`${harness.baseUrl()}/v1/templates`, { headers: { origin: SITE } })).status).toBe(403);
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
