import type { KeyObject } from 'node:crypto';
import { checkCatalogFreshness } from '../../core/drivers/catalog-freshness';
import type { DriverCatalog } from '../../core/drivers/catalog-model';
import { sanitizeCatalog } from '../../core/drivers/sanitize-catalog';
import type { Clock } from '../../core/types';
import { sanitizeCatalogUrl } from '../../shared/driver-catalog-url';
import { MAX_CATALOG_ENVELOPE_BYTES, openCatalogEnvelope } from './catalog-signature';
import type { StoredCatalog } from './catalog-state-store';

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export interface CatalogStateStore {
  load(): StoredCatalog | null;
  save(state: StoredCatalog): void;
}

export interface CatalogClientDeps {
  /** 设置里的地址，没填时是构建时注入的默认地址；都没有为 null。 */
  url: () => string | null;
  /** 生产环境是 Electron 的 net.fetch（走系统代理）。 */
  fetch: FetchFunction;
  keys: ReadonlyMap<string, KeyObject>;
  store: CatalogStateStore;
  clock: Clock;
  userAgent: string;
  log: (line: string) => void;
}

/** 下载清单最多等 15 秒：清单只有几十 KB。 */
export const CATALOG_FETCH_TIMEOUT_MS = 15_000;
/** 10 分钟内自动的加载（打开「驱动」一节、5a/5b 查询）不重复下载；点「重新检测」时强制下载。 */
export const CATALOG_REFRESH_MS = 10 * 60_000;

export type CatalogLoad =
  | { kind: 'unconfigured' }
  /** 这个版本的程序没有内置任何公钥（开源 / 自己构建、没填密钥）：填了地址也验不了签，不下载。 */
  | { kind: 'no-keys' }
  | { kind: 'ready'; catalog: DriverCatalog; source: 'network' | 'cache'; fetchedAt: number; staleIssue: string | null }
  | { kind: 'failed'; issue: string };

type Verified = { ok: true; catalog: DriverCatalog } | { ok: false; issue: string };

/** 给操作员看的下载失败原因。 */
class CatalogFetchError extends Error {}

/**
 * 下载并核对驱动清单：验签 → 严格校验 → 过期和防回滚 → 记下最高版本和原文。
 * 新下载的不能用（连不上、签名不对、过期……）时退回同一地址上次的清单（同样重新核对），并说明原因。
 */
export class CatalogClient {
  private last: { url: string; load: CatalogLoad; at: number } | null = null;

  constructor(private readonly deps: CatalogClientDeps) {}

  /** 最近一次可用的清单（给 5a、5b 的查询；不触发下载）。 */
  current(): DriverCatalog | null {
    return this.last?.load.kind === 'ready' ? this.last.load.catalog : null;
  }

  async load(force: boolean): Promise<CatalogLoad> {
    // 内置公钥表是空的：不管地址填没填，任何清单都验不了签，不值得发请求，也不能说「未配置地址」
    // （那会让操作员以为填个地址就好了）。
    if (this.deps.keys.size === 0) {
      this.last = null;
      return { kind: 'no-keys' };
    }
    const url = this.deps.url();
    if (url === null) {
      this.last = null;
      return { kind: 'unconfigured' };
    }
    const now = this.deps.clock.now();
    const last = this.last;
    if (!force && last && last.url === url && last.load.kind === 'ready' && now - last.at < CATALOG_REFRESH_MS) {
      return last.load;
    }
    const load = await this.fetchAndVerify(url, now);
    this.last = { url, load, at: now };
    return load;
  }

  private async fetchAndVerify(url: string, now: number): Promise<CatalogLoad> {
    const stored = this.deps.store.load();
    let issue: string;
    try {
      const text = await this.download(url);
      const verified = this.verify(text, stored?.highestVersion ?? null, now);
      if (verified.ok) {
        const highestVersion = Math.max(verified.catalog.version, stored?.highestVersion ?? 0);
        this.deps.store.save({ highestVersion, url, envelope: text, fetchedAt: now });
        this.deps.log(
          `[drivers] catalog version ${verified.catalog.version} loaded from ${url} (${verified.catalog.models.length} models)`,
        );
        return { kind: 'ready', catalog: verified.catalog, source: 'network', fetchedAt: now, staleIssue: null };
      }
      issue = verified.issue;
    } catch (error) {
      issue = describeFetchError(error);
      if (!(error instanceof CatalogFetchError)) {
        this.deps.log(
          `[drivers] catalog download from ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.deps.log(`[drivers] catalog from ${url} not used: ${issue}`);
    return this.fromCache(stored, url, now, issue);
  }

  private fromCache(stored: StoredCatalog | null, url: string, now: number, issue: string): CatalogLoad {
    if (stored === null || stored.url !== url) {
      return { kind: 'failed', issue };
    }
    const verified = this.verify(stored.envelope, stored.highestVersion, now);
    if (!verified.ok) {
      return { kind: 'failed', issue: `${issue}；上次下载的清单也不能用：${verified.issue}` };
    }
    return {
      kind: 'ready',
      catalog: verified.catalog,
      source: 'cache',
      fetchedAt: stored.fetchedAt,
      staleIssue: issue,
    };
  }

  private verify(text: string, highestVersion: number | null, now: number): Verified {
    const opened = openCatalogEnvelope(text, this.deps.keys);
    if (!opened.ok) {
      return opened;
    }
    const parsed = sanitizeCatalog(opened.payload);
    if (!parsed.ok) {
      return parsed;
    }
    for (const dropped of parsed.dropped) {
      this.deps.log(`[drivers] catalog entry skipped: ${dropped}`);
    }
    const freshness = checkCatalogFreshness(parsed.catalog, highestVersion, now);
    return freshness.ok ? { ok: true, catalog: parsed.catalog } : { ok: false, issue: freshness.issue };
  }

  private async download(url: string): Promise<string> {
    const response = await this.deps.fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': this.deps.userAgent },
    });
    if (sanitizeCatalogUrl(response.url || url) === null) {
      await response.body?.cancel();
      throw new CatalogFetchError('驱动清单地址跳转到了不安全的地址，不使用');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CatalogFetchError(`驱动清单地址返回 ${response.status}：检查地址是否正确`);
    }
    return readLimited(response);
  }
}

/** 边读边数，超过上限立即停：不把异常大的返回内容读进内存。 */
async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_CATALOG_ENVELOPE_BYTES) {
      await reader.cancel();
      throw new CatalogFetchError('驱动清单地址返回的内容太大，不是驱动清单');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function describeFetchError(error: unknown): string {
  if (error instanceof CatalogFetchError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return '下载驱动清单超时：检查网络后点「重新检测」';
  }
  return '连不上驱动清单地址：检查网络后点「重新检测」';
}
