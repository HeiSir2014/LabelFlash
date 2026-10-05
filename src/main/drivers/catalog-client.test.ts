import { beforeEach, describe, expect, test } from 'bun:test';
import { EXAMPLE_VERSION, exampleCatalogSource } from '../../core/testing/driver-catalog-fixtures';
import { FakeClock } from '../../core/testing/fake-clock';
import { CATALOG_REFRESH_MS, CatalogClient, type CatalogStateStore, type FetchFunction } from './catalog-client';
import { MAX_CATALOG_ENVELOPE_BYTES } from './catalog-signature';
import type { StoredCatalog } from './catalog-state-store';
import { createTestCatalogKeys, signedCatalogText } from './testing/catalog-keys';

const URL_A = 'https://catalog.example.com/driver-catalog.json';
const URL_B = 'https://other.example.com/driver-catalog.json';
const keys = createTestCatalogKeys();
const GOOD = signedCatalogText(exampleCatalogSource(), keys);

class MemoryStore implements CatalogStateStore {
  state: StoredCatalog | null = null;
  load(): StoredCatalog | null {
    return this.state;
  }
  save(state: StoredCatalog): void {
    this.state = state;
  }
}

let clock: FakeClock;
let store: MemoryStore;
let url: string | null;
let requests: string[];

function serving(respond: () => Response | Promise<Response>): FetchFunction {
  return async (target) => {
    requests.push(target);
    return respond();
  };
}

function client(fetch: FetchFunction): CatalogClient {
  return new CatalogClient({
    url: () => url,
    fetch,
    keys: keys.trusted,
    store,
    clock,
    userAgent: 'test',
    log: () => undefined,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  store = new MemoryStore();
  url = URL_A;
  requests = [];
});

describe('CatalogClient', () => {
  test('says the address is not configured', async () => {
    url = null;
    expect(await client(serving(() => new Response(GOOD))).load(false)).toEqual({ kind: 'unconfigured' });
    expect(requests).toEqual([]);
  });

  test('downloads, verifies and remembers the version', async () => {
    const load = await client(serving(() => new Response(GOOD))).load(false);
    expect(load).toMatchObject({
      kind: 'ready',
      source: 'network',
      staleIssue: null,
      catalog: { version: EXAMPLE_VERSION },
    });
    expect(store.state).toMatchObject({ highestVersion: EXAMPLE_VERSION, url: URL_A, envelope: GOOD });
  });

  test('does not download again within the refresh window unless forced', async () => {
    const catalogs = client(serving(() => new Response(GOOD)));
    await catalogs.load(false);
    clock.advance(CATALOG_REFRESH_MS - 1);
    await catalogs.load(false);
    expect(requests).toHaveLength(1);
    await catalogs.load(true);
    expect(requests).toHaveLength(2);
  });

  test('refuses a catalog with a bad signature', async () => {
    const other = createTestCatalogKeys('test');
    const load = await client(serving(() => new Response(signedCatalogText(exampleCatalogSource(), other)))).load(
      false,
    );
    expect(load).toEqual({ kind: 'failed', issue: '驱动清单的签名不对，可能被改过，不使用' });
  });

  test('refuses a catalog older than the newest one used here', async () => {
    store.state = { highestVersion: EXAMPLE_VERSION + 1, url: URL_B, envelope: '{}', fetchedAt: 0 };
    const load = await client(serving(() => new Response(GOOD))).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('比这台电脑上次用的旧');
  });

  test('refuses an expired catalog', async () => {
    clock.advance(365 * 86_400_000);
    const load = await client(serving(() => new Response(GOOD))).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('过期');
  });

  test('falls back to the last catalog from the same address when offline', async () => {
    await client(serving(() => new Response(GOOD))).load(false);
    const load = await client(serving(() => Promise.reject(new TypeError('fetch failed')))).load(true);
    expect(load).toMatchObject({
      kind: 'ready',
      source: 'cache',
      staleIssue: '连不上驱动清单地址：检查网络后点「重新检测」',
    });
  });

  test('does not use the last catalog after the address changed', async () => {
    await client(serving(() => new Response(GOOD))).load(false);
    url = URL_B;
    const load = await client(serving(() => new Response('nope', { status: 404 }))).load(false);
    expect(load).toEqual({ kind: 'failed', issue: '驱动清单地址返回 404：检查地址是否正确' });
  });

  test('stops reading a body larger than any catalog', async () => {
    const load = await client(serving(() => new Response(new Uint8Array(MAX_CATALOG_ENVELOPE_BYTES + 1)))).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('太大');
  });

  test('refuses a redirect to a plain http address', async () => {
    const load = await client(
      serving(() => {
        const response = new Response(GOOD);
        Object.defineProperty(response, 'url', { value: 'http://catalog.example.com/c.json' });
        return response;
      }),
    ).load(false);
    expect(load.kind === 'failed' ? load.issue : '').toContain('跳转');
  });
});
