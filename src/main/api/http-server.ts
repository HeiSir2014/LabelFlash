import { randomUUID } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type ApiServerStatus, isWebOrigin } from '../../shared/local-api';
import { ApiError, errorBody } from './api-error';
import type { Authenticator, Caller } from './authenticator';
import { corsHeaders } from './cors';
import { isLoopbackAddress, isLoopbackHost } from './network';
import type { RateLimiter } from './rate-limiter';
import type { ApiRequest, ApiResponse } from './router';

/** 请求体上限 4MB：1000 张标签、每张十来个字段的批量大约 1MB，留出余量。 */
export const BODY_LIMIT_BYTES = 4 * 1024 * 1024;
/** 默认端口和两个备用端口：写进接口文档，第三方可以依次尝试（用 /v1/service 确认连的是本程序）。 */
export const DEFAULT_PORTS: readonly number[] = [17631, 17632, 17633];
/** 一个请求最长 30 秒（含上传请求体）：挡住慢速连接一直占着服务。 */
const REQUEST_TIMEOUT_MS = 30_000;
/** 这些错误按「端口不能用」处理，换下一个端口：EACCES 是 Windows 上 Hyper-V 等保留的端口段。 */
const PORT_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['EADDRINUSE', 'EACCES']);
/** 自检请求带的请求头：值是这个服务自己的随机口令，只有自己认得。 */
const PROBE_HEADER = 'x-labelflash-probe';
/** 自检最多等这么久：本机回环地址上的请求通常几毫秒就回来。 */
const PROBE_TIMEOUT_MS = 2_000;
const NO_CONTENT = 204;
/** 授权相关的错误：没授权的网站也要能读到它们，才知道该去电脑上点「允许」。 */
const AUTHORIZATION_REASONS: ReadonlySet<string> = new Set(['ORIGIN_NOT_AUTHORIZED', 'ORIGIN_UNSUPPORTED']);

export interface StartOptions {
  lanEnabled: boolean;
  /** 用户指定的端口：只用它，被占用就报错，不悄悄换成别的。 */
  port: number | null;
  /** 没指定端口时依次尝试。 */
  candidatePorts: readonly number[];
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
}

type Headers = Record<string, string | undefined>;

class PortUnavailableError extends Error {}

/**
 * 本机接口的 HTTP 服务（node:http，不加依赖）。
 * 局域网开启时监听所有网卡（::，同时收 IPv4 和 IPv6）；关闭时只监听 127.0.0.1 和 ::1。
 */
export class ApiHttpServer {
  private servers: Server[] = [];
  private current: ApiServerStatus = { state: 'off' };
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

  async start(options: StartOptions): Promise<ApiServerStatus> {
    await this.stop();
    const ports = options.port === null ? options.candidatePorts : [options.port];
    for (const port of ports) {
      try {
        this.servers = await this.listen(port, options.lanEnabled);
        const bound = this.boundPort();
        // Windows 上别的程序占着 127.0.0.1 的这个端口时，监听 :: 照样成功，本机的请求却会到那个程序：
        // 自己从回环地址探测一次，回应不是自己的就当作端口不能用。
        if (!(await this.answersOnLoopback(bound))) {
          await this.closeServers();
          throw new PortUnavailableError(`127.0.0.1:${bound} is answered by another program`);
        }
        this.current = { state: 'listening', port: bound, lanEnabled: options.lanEnabled };
        return this.current;
      } catch (error) {
        if (!(error instanceof PortUnavailableError)) {
          throw error;
        }
        console.warn(`[api] port ${port} is unavailable`, error.message);
      }
    }
    this.current = { state: 'failed', reason: 'PORT_IN_USE', ports: [...ports] };
    return this.current;
  }

  async stop(): Promise<void> {
    this.current = { state: 'off' };
    await this.closeServers();
  }

  private async closeServers(): Promise<void> {
    const servers = this.servers;
    this.servers = [];
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            // 保持连接（keep-alive）的空闲连接不关掉的话，close 要等它们超时。
            server.closeAllConnections();
          }),
      ),
    );
  }

  private async listen(port: number, lanEnabled: boolean): Promise<Server[]> {
    if (lanEnabled) {
      try {
        return [await this.listenOn(port, '::')];
      } catch (error) {
        // 系统关掉了 IPv6：退回只监听 IPv4 的所有网卡。
        if (error instanceof PortUnavailableError) {
          throw error;
        }
        console.warn('[api] cannot listen on ::, falling back to 0.0.0.0', error);
        return [await this.listenOn(port, '0.0.0.0')];
      }
    }
    const primary = await this.listenOn(port, '127.0.0.1');
    const bound = addressPort(primary);
    try {
      return [primary, await this.listenOn(bound, '::1')];
    } catch (error) {
      // 没有 IPv6 或 ::1 上这个端口被占：IPv4 能用就够了，localhost 会退回 127.0.0.1。
      console.warn(`[api] cannot listen on [::1]:${bound}`, error);
      return [primary];
    }
  }

  private listenOn(port: number, host: string): Promise<Server> {
    const server = createServer((request, response) => void this.serve(request, response));
    server.requestTimeout = REQUEST_TIMEOUT_MS;
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

  /** 从 127.0.0.1 请求自己一次，看回应的是不是这个服务。 */
  private answersOnLoopback(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = httpRequest(
        { host: '127.0.0.1', port, path: '/', headers: { [PROBE_HEADER]: this.probeToken }, timeout: PROBE_TIMEOUT_MS },
        (response) => {
          response.resume();
          resolve(response.statusCode === NO_CONTENT && response.headers[PROBE_HEADER] === this.probeToken);
        },
      );
      probe.on('timeout', () => probe.destroy(new Error('probe timed out')));
      probe.on('error', (error) => {
        console.warn(`[api] loopback self-check on port ${port} failed: ${error.message}`);
        resolve(false);
      });
      probe.end();
    });
  }

  private boundPort(): number {
    const [first] = this.servers;
    if (!first) {
      throw new Error('No server is listening');
    }
    return addressPort(first);
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
    const origin = headers['origin'];
    const webOrigin =
      origin !== undefined &&
      isWebOrigin(origin) &&
      isLoopbackAddress(request.socket.remoteAddress) &&
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
    try {
      if (method === 'OPTIONS') {
        // 预检放行本机的网站：真正的请求发过来才会弹授权框；能不能拿到数据由授权决定，不靠跨域。
        response.writeHead(204, cors(webOrigin !== null));
        response.end();
        return;
      }
      const body = method === 'POST' ? await this.readBody(request) : undefined;
      let caller: Caller | null = null;
      if (this.deps.requiresCaller(method, url)) {
        caller = this.deps.authenticator.authenticate({
          remoteAddress: request.socket.remoteAddress,
          port: localPort,
          headers,
        });
        if (!this.deps.rateLimiter.take(caller.id)) {
          throw new ApiError('RESOURCE_EXHAUSTED', 'RATE_LIMITED', '请求太快：同一调用方每秒最多 20 个请求');
        }
      }
      const result = await this.deps.handle({ method, url, body, caller });
      send(response, result, cors(isAuthorizedSite));
    } catch (error) {
      const apiError = error instanceof ApiError ? error : internalError(error, method, url);
      const readable = isAuthorizedSite || (webOrigin !== null && AUTHORIZATION_REASONS.has(apiError.reason));
      send(
        response,
        { status: apiError.httpStatus, contentType: 'application/json', body: errorBody(apiError) },
        cors(readable),
      );
      if (apiError.reason === 'PAYLOAD_TOO_LARGE') {
        // 请求体没读完：回完错误就断开，不再接收剩下的数据。
        response.once('finish', () => request.destroy());
      }
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

function internalError(error: unknown, method: string, url: string): ApiError {
  console.error(`[api] ${method} ${url} failed`, error);
  return new ApiError('INTERNAL', 'INTERNAL', '程序内部错误，已写入电脑上的日志');
}

function send(response: ServerResponse, result: ApiResponse, extraHeaders: Record<string, string>): void {
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

function addressPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server has no TCP address');
  }
  return address.port;
}
