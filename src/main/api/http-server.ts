import { randomUUID } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { SerialQueue } from '../../core/serial-queue';
import { type ApiServerStatus, isWebOrigin } from '../../shared/local-api';
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
/** 重启服务时，正在处理的请求最多再等这么久：收下的批量要把回应发出去，不然调用方重试会重复打印。 */
const DRAIN_GRACE_MS = 5_000;
/** 这些错误按「端口不能用」处理，换下一个端口：EACCES 是 Windows 上 Hyper-V 等保留的端口段。 */
const PORT_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['EADDRINUSE', 'EACCES']);
/** 这些错误说明这台电脑没有 IPv6：只用 IPv4 就行。 */
const NO_IPV6_CODES: ReadonlySet<string> = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);
/** 自检请求带的请求头：值是这个服务自己的随机口令，只有自己认得。 */
const PROBE_HEADER = 'x-labelflash-probe';
/** 自检最多等这么久：本机回环地址上的请求通常几毫秒就回来。 */
const PROBE_TIMEOUT_MS = 2_000;
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

class PortUnavailableError extends Error {}

interface Listening {
  servers: Server[];
  /** 在 IPv6 回环地址 ::1 上也能收到请求（监听了 :: 或 ::1）：自检时两个回环地址都要查。 */
  hasIpv6: boolean;
}

/**
 * 本机接口的 HTTP 服务（node:http，不加依赖）。
 * 局域网开启时监听所有网卡（::，同时收 IPv4 和 IPv6）；关闭时只监听 127.0.0.1 和 ::1。
 * 启动、停止一次只做一件：两次启动交错时，先起来的那组服务会被后一次覆盖掉，再也关不掉。
 */
export class ApiHttpServer {
  private servers: Server[] = [];
  private current: ApiServerStatus = { state: 'off' };
  private readonly lifecycle = new SerialQueue();
  /** 自检口令：每个服务一个，别的程序不可能回应它。 */
  private readonly probeToken = randomUUID();

  constructor(private readonly deps: ApiHttpServerDeps) {}

  get status(): ApiServerStatus {
    return this.current;
  }

  /** 正在监听的端口；没有监听时为 null。 */
  port(): number | null {
    return this.current.state === 'listening' ? this.current.port : null;
  }

  start(options: StartOptions): Promise<ApiServerStatus> {
    return this.lifecycle.run(() => this.startNow(options));
  }

  stop(): Promise<void> {
    return this.lifecycle.run(async () => {
      this.current = { state: 'off' };
      await drain(this.take());
    });
  }

  private async startNow(options: StartOptions): Promise<ApiServerStatus> {
    this.current = { state: 'off' };
    await drain(this.take());
    const skippedPorts: number[] = [];
    for (const port of options.ports) {
      try {
        // 新起的服务先放在局部变量里，自检通过才交给 this.servers。
        const listening = await this.listen(port, options.lanEnabled);
        const bound = addressPort(listening.servers[0]);
        if (!(await this.answersOnLoopback(bound, listening.hasIpv6))) {
          await drain(listening.servers);
          throw new PortUnavailableError(`port ${bound} is answered by another program on a loopback address`);
        }
        this.servers = listening.servers;
        this.current = { state: 'listening', port: bound, lanEnabled: options.lanEnabled, skippedPorts };
        return this.current;
      } catch (error) {
        if (!(error instanceof PortUnavailableError)) {
          throw error;
        }
        console.warn(`[api] port ${port} is unavailable`, error.message);
        skippedPorts.push(port);
      }
    }
    this.current = { state: 'failed', reason: 'PORT_IN_USE', ports: [...options.ports] };
    return this.current;
  }

  private take(): Server[] {
    const servers = this.servers;
    this.servers = [];
    return servers;
  }

  private async listen(port: number, lanEnabled: boolean): Promise<Listening & { servers: [Server, ...Server[]] }> {
    if (lanEnabled) {
      try {
        return { servers: [await this.listenOn(port, '::')], hasIpv6: true };
      } catch (error) {
        if (!isNoIpv6(error)) {
          throw error;
        }
        console.warn('[api] no IPv6, listening on 0.0.0.0', error);
        return { servers: [await this.listenOn(port, '0.0.0.0')], hasIpv6: false };
      }
    }
    const primary = await this.listenOn(port, '127.0.0.1');
    const bound = addressPort(primary);
    try {
      return { servers: [primary, await this.listenOn(bound, '::1')], hasIpv6: true };
    } catch (error) {
      if (!isNoIpv6(error)) {
        // ::1 上这个端口被别的程序占着：用 localhost 访问的调用方会连到那个程序，这个端口不能用。
        await drain([primary]);
        throw error;
      }
      console.warn(`[api] no IPv6 loopback, listening on 127.0.0.1:${bound} only`);
      return { servers: [primary], hasIpv6: false };
    }
  }

  private listenOn(port: number, host: string): Promise<Server> {
    const server = createServer((request, response) => void this.serve(request, response));
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.maxConnections = MAX_CONNECTIONS;
    return new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.close();
        reject(
          error.code !== undefined && PORT_UNAVAILABLE_CODES.has(error.code)
            ? new PortUnavailableError(`${host}:${port} ${error.code}`)
            : error,
        );
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        server.on('error', (error) => console.error('[api] server error', error));
        resolve(server);
      });
    });
  }

  /**
   * Windows 上别的程序占着 127.0.0.1（或 ::1）的这个端口时，监听 :: 照样成功，本机的请求却会到那个程序：
   * 从两个回环地址各请求自己一次，回应不是自己的就当作端口不能用。
   */
  private async answersOnLoopback(port: number, hasIpv6: boolean): Promise<boolean> {
    const hosts = hasIpv6 ? ['127.0.0.1', '::1'] : ['127.0.0.1'];
    for (const host of hosts) {
      if (!(await this.answersOn(host, port))) {
        return false;
      }
    }
    return true;
  }

  private answersOn(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = httpRequest(
        {
          host,
          port,
          path: '/',
          headers: { [PROBE_HEADER]: this.probeToken },
          timeout: PROBE_TIMEOUT_MS,
          // 每次都开新连接：默认的连接池会复用上一次自检的连接，重启后那条连接已经被关掉了。
          agent: false,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode === NO_CONTENT && response.headers[PROBE_HEADER] === this.probeToken);
        },
      );
      probe.on('timeout', () => probe.destroy(new Error('probe timed out')));
      probe.on('error', (error) => {
        console.warn(`[api] self-check on ${host}:${port} failed: ${error.message}`);
        resolve(false);
      });
      probe.end();
    });
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers = flattenHeaders(request);
    if (headers[PROBE_HEADER] === this.probeToken) {
      response.writeHead(NO_CONTENT, { [PROBE_HEADER]: this.probeToken });
      response.end();
      return;
    }
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

/**
 * 关掉服务：先关空闲的保持连接，正在处理的请求给一点时间把回应发出去，到时间还没完就强行断开。
 * 收下的批量必须让调用方收到回应，不然它重试时（没带 requestId）会重复打印。
 */
function drain(servers: readonly Server[]): Promise<void> {
  return Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => server.closeAllConnections(), DRAIN_GRACE_MS);
          server.close(() => {
            clearTimeout(timer);
            resolve();
          });
          server.closeIdleConnections();
        }),
    ),
  ).then(() => undefined);
}

function isNoIpv6(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && NO_IPV6_CODES.has(code);
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

function addressPort(server: Server | undefined): number {
  const address = server?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Server has no TCP address');
  }
  return address.port;
}
