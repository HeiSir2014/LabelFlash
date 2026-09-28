import type { HttpOutcome, HttpRequest } from '../../core/scan/enrich';
import { SECRET_REFERENCE_PATTERN } from '../../core/scan/enrich-model';

const BYTES_PER_KB = 1024;
/** 返回内容最大 256KB：查询接口只该返回几个字段，过大多半是地址配错了。 */
export const MAX_RESPONSE_BYTES = 256 * BYTES_PER_KB;
/** 缓存最多这么多条（先进先出淘汰），防止长时间运行内存增长。 */
const MAX_CACHE_ENTRIES = 500;
const MS_PER_SECOND = 1_000;
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpStepDeps {
  /** 生产环境用 Electron 的 net.fetch：走 Chromium 网络栈，自动使用系统代理。 */
  fetch: FetchFunction;
  secret: (name: string) => string | null;
  now: () => number;
  userAgent: string;
  warn?: (message: string) => void;
}

class StepFailure extends Error {}

/**
 * 执行加工步骤里的 HTTP 查询：替换 {密钥:名称}、超时、限制大小、要求返回 JSON，成功的结果按设置缓存。
 * 失败原因是给操作员看的中文；不会包含密钥和请求头。
 */
export function createHttpStepRunner(deps: HttpStepDeps): (request: HttpRequest) => Promise<HttpOutcome> {
  const cache = new Map<string, { json: unknown; expiresAt: number }>();
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  return async (request) => {
    // 缓存键用替换密钥之前的请求：内存里不留明文密钥。
    const cacheKey = JSON.stringify([request.method, request.url, request.headers, request.body]);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > deps.now()) {
      return { ok: true, json: cached.json };
    }
    try {
      const json = await send(request, deps);
      if (request.cacheSeconds > 0) {
        remember(cache, cacheKey, { json, expiresAt: deps.now() + request.cacheSeconds * MS_PER_SECOND });
      }
      return { ok: true, json };
    } catch (error) {
      const detail = error instanceof StepFailure ? error.message : describeNetworkError(error, request.timeoutMs);
      warn(`[scan] HTTP ${request.method} ${originOf(request.url)} failed: ${detail}`);
      return { ok: false, detail };
    }
  };
}

async function send(request: HttpRequest, deps: HttpStepDeps): Promise<unknown> {
  const url = parseUrl(request.url);
  const headers = new Headers({ Accept: 'application/json', 'User-Agent': deps.userAgent });
  if (request.body !== null) {
    headers.set('Content-Type', 'application/json');
  }
  for (const header of request.headers) {
    headers.set(header.name, withSecrets(header.value, deps.secret));
  }
  const response = await deps.fetch(url.href, {
    method: request.method,
    headers,
    body: request.body ?? undefined,
    redirect: 'follow',
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!ALLOWED_PROTOCOLS.has(new URL(response.url || url.href).protocol)) {
    throw new StepFailure('接口跳转到了不支持的地址');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new StepFailure(`接口返回 ${response.status}`);
  }
  const text = await readLimited(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StepFailure('接口返回的不是 JSON');
  }
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StepFailure('地址写法不对');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new StepFailure('只支持 http 和 https 地址');
  }
  return url;
}

function withSecrets(value: string, secret: (name: string) => string | null): string {
  return value.replace(SECRET_REFERENCE_PATTERN, (_, name: string) => {
    const resolved = secret(name);
    if (resolved === null) {
      throw new StepFailure(`没有设置密钥「${name}」`);
    }
    return resolved;
  });
}

/** 边读边数字节，超过上限立即停止，不把超大的返回内容读进内存。 */
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
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new StepFailure(`接口返回的内容超过 ${MAX_RESPONSE_BYTES / BYTES_PER_KB}KB`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function describeNetworkError(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `查询超时（${timeoutMs} 毫秒没有返回）`;
  }
  return '网络错误，连不上接口';
}

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

/** 日志里只写协议和主机：路径和参数里可能有扫码内容。 */
function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '(invalid url)';
  }
}
