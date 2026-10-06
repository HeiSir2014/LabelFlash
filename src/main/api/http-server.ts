import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ApiServerStatus, isWebOrigin } from '../../shared/local-api';
import { HttpListener, type ListenStatus } from '../net/http-listener';
import { ApiError, errorBody } from './api-error';
import type { Authenticator, Caller } from './authenticator';
import { corsHeaders } from './cors';
import { isLoopbackAddress, isLoopbackHost } from './network';
import type { RateLimiter } from './rate-limiter';
import type { ApiRequest, ApiResponse } from './router';

/** 请求体上限 4MB：1000 张标签、每张十来个字段的批量大约 1MB，留出余量。 */
export const BODY_LIMIT_BYTES = 4 * 1024 * 1024;
/**
 * 固定的备用端口段：首选端口被占用时在这一段里找空的。写进接入文档，
 * 找不到服务的调用方在这一段里依次用 /v1/service 探一下就能找到。
 */
export const DEFAULT_PORTS: readonly number[] = Array.from({ length: 10 }, (_, index) => 17631 + index);
/** 一个请求最长 30 秒（含上传请求体）：挡住慢速连接一直占着服务。 */
const REQUEST_TIMEOUT_MS = 30_000;
/** 同时最多这么多条连接：正常使用（几个程序、几个网页）远用不到，挡住开几百条连接耗内存。 */
const MAX_CONNECTIONS = 256;
const NO_CONTENT = 204;
/** 授权相关的错误：没授权的网站也要能读到它们，才知道该去电脑上点「允许」，或者知道已被拒绝。 */
const AUTHORIZATION_REASONS: ReadonlySet<string> = new Set(['ORIGIN_NOT_AUTHORIZED', 'ORIGIN_DENIED']);

export interface StartOptions {
  lanEnabled: boolean;
  /** 依次尝试的端口，第一个是首选；0 表示由系统分配一个空闲端口。 */
  ports: readonly number[];
}

export interface ApiHttpServerDeps {
  authenticator: Authenticator;
  rateLimiter: RateLimiter;
  isOriginAuthorized: (origin: string) => boolean;
  /** 这个请求要不要先授权（router.ts 的 requiresCaller）。 */
  requiresCaller: (method: string, url: string) => boolean;
  /** 分发已授权的请求（router.ts 的 route）。接口错误由它转成响应；抛出的都当作程序内部错误。 */
  handle: (request: ApiRequest) => Promise<ApiResponse>;
  bodyLimitBytes?: number | undefined;
  /**
   * 认证之前按来源地址限速：局域网里不带密钥的机器反复请求，挡住的是它，不影响别的调用方，也不刷日志。
   * 本机来的请求默认不限（本机的程序本来就能直接操作这台电脑）；limitLoopback 只给测试用。
   */
  addressLimiter?: RateLimiter | undefined;
  limitLoopback?: boolean | undefined;
}

type Headers = Record<string, string | undefined>;

/**
 * 本机接口的 HTTP 服务（node:http，不加依赖）。
 * 局域网开启时监听所有网卡（::，同时收 IPv4 和 IPv6）；关闭时只监听 127.0.0.1 和 ::1。
 * 端口回退、回环自检、启停排队都在共用的 HttpListener 里。
 */
export class ApiHttpServer {
  private readonly listener: HttpListener;

  constructor(private readonly deps: ApiHttpServerDeps) {
    this.listener = new HttpListener({
      logTag: '[api]',
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxConnections: MAX_CONNECTIONS,
      onRequest: (request, response) => void this.serve(request, response),
    });
  }

  get status(): ApiServerStatus {
    return toApiStatus(this.listener.status);
  }

  /** 正在监听的端口；没有监听时为 null。 */
  port(): number | null {
    return this.listener.port();
  }

  async start(options: StartOptions): Promise<ApiServerStatus> {
    return toApiStatus(await this.listener.start(options.lanEnabled ? 'all' : 'loopback', options.ports));
  }

  stop(): Promise<void> {
    return this.listener.stop();
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers = flattenHeaders(request);
    const method = request.method ?? 'GET';
    const url = request.url ?? '/';
    const localPort = request.socket.localPort ?? 0;
    const remoteAddress = request.socket.remoteAddress;
    const origin = headers['origin'];
    const webOrigin =
      origin !== undefined &&
      isWebOrigin(origin) &&
      isLoopbackAddress(remoteAddress) &&
      isLoopbackHost(headers['host'], localPort)
        ? origin
        : null;
    const isAuthorizedSite = webOrigin !== null && this.deps.isOriginAuthorized(webOrigin);
    const cors = (allow: boolean) =>
      origin === undefined
        ? {}
        : corsHeaders(origin, allow, {
            privateNetworkRequested: headers['access-control-request-private-network'] === 'true',
          });
    let isBodyRead = method !== 'POST';
    try {
      this.limitAddress(remoteAddress);
      if (method === 'OPTIONS') {
        // 预检放行本机的网站：真正的请求发过来才会弹授权框；能不能拿到数据由授权决定，不靠跨域。
        response.writeHead(NO_CONTENT, cors(webOrigin !== null));
        response.end();
        return;
      }
      // 先认证、再读请求体：认证只看请求头，不带密钥的请求不能让程序先收下几 MB 的数据。
      let caller: Caller | null = null;
      if (this.deps.requiresCaller(method, url)) {
        caller = this.deps.authenticator.authenticate({ remoteAddress, port: localPort, headers });
        if (!this.deps.rateLimiter.take(caller.id)) {
          throw new ApiError('RESOURCE_EXHAUSTED', 'RATE_LIMITED', '请求太快：同一调用方每秒最多 20 个请求');
        }
      }
      const body = method === 'POST' ? await this.readBody(request) : undefined;
      isBodyRead = true;
      const result = await this.deps.handle({ method, url, body, caller });
      send(response, result, cors(isAuthorizedSite));
    } catch (error) {
      const apiError = error instanceof ApiError ? error : internalError(error, method, url);
      const readable = isAuthorizedSite || (webOrigin !== null && AUTHORIZATION_REASONS.has(apiError.reason));
      const closing = !isBodyRead || apiError.reason === 'PAYLOAD_TOO_LARGE';
      send(
        response,
        { status: apiError.httpStatus, contentType: 'application/json', body: errorBody(apiError) },
        { ...cors(readable), ...(closing ? { connection: 'close' } : {}) },
      );
      if (closing) {
        // 请求体没读（或没读完）：回完错误就断开，不再接收剩下的数据。
        response.once('finish', () => request.destroy());
      }
    }
  }

  private limitAddress(remoteAddress: string | undefined): void {
    const limiter = this.deps.addressLimiter;
    if (limiter === undefined || (isLoopbackAddress(remoteAddress) && !this.deps.limitLoopback)) {
      return;
    }
    if (!limiter.take(`address:${remoteAddress ?? 'unknown'}`)) {
      throw new ApiError('RESOURCE_EXHAUSTED', 'RATE_LIMITED', '请求太快，请稍后再试');
    }
  }

  private readBody(request: IncomingMessage): Promise<unknown> {
    const limit = this.deps.bodyLimitBytes ?? BODY_LIMIT_BYTES;
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      return Promise.reject(ApiError.payloadTooLarge(limit));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const onData = (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          request.off('data', onData);
          request.pause();
          reject(ApiError.payloadTooLarge(limit));
          return;
        }
        chunks.push(chunk);
      };
      request.on('data', onData);
      request.once('error', reject);
      // 调用方中途断开：结束等待，不留一个永远不结束的 Promise。
      request.once('aborted', () => reject(ApiError.invalidArgument('请求没有发完就断开了')));
      request.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.trim() === '') {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(ApiError.invalidArgument('请求体不是合法的 JSON'));
        }
      });
    });
  }
}

/** 共用监听的状态 → 本机接口的状态（界面按 lanEnabled 显示地址）。 */
function toApiStatus(status: ListenStatus): ApiServerStatus {
  return status.state === 'listening'
    ? {
        state: 'listening',
        port: status.port,
        lanEnabled: status.scope !== 'loopback',
        skippedPorts: status.skippedPorts,
      }
    : status;
}

function internalError(error: unknown, method: string, url: string): ApiError {
  console.error(`[api] ${method} ${url} failed`, error);
  return new ApiError('INTERNAL', 'INTERNAL', '程序内部错误，已写入电脑上的日志');
}

function send(response: ServerResponse, result: ApiResponse, extraHeaders: Record<string, string>): void {
  if (response.destroyed || response.headersSent) {
    return;
  }
  const isPdf = result.contentType === 'application/pdf';
  const payload =
    isPdf && result.body instanceof Uint8Array ? result.body : Buffer.from(JSON.stringify(result.body), 'utf8');
  response.writeHead(result.status, {
    ...extraHeaders,
    'content-type': isPdf ? 'application/pdf' : 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    // 任务状态随时在变：不让任何中间环节缓存。
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/** node:http 的请求头 → 名字小写、每个头取第一个值。 */
function flattenHeaders(request: IncomingMessage): Headers {
  const headers: Headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}
