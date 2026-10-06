import { randomUUID } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { SerialQueue } from '../../core/serial-queue';

/** 重启服务时，正在处理的请求最多再等这么久：收下的任务要把回应发出去，不然调用方重试会重复打印。 */
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
/** 设了请求头时限时每秒查一次超时：查得太稀，15 秒的时限实际会拖到 45 秒。 */
const TIMEOUT_CHECK_MS = 1_000;
/** 端口候选的最后一个：0 = 由系统分配一个空闲端口，保证服务总能起来。 */
export const ANY_FREE_PORT = 0;

/** 监听哪些地址：loopback = 只本机（127.0.0.1 和 ::1）；all = 所有网卡（::，没有 IPv6 时 0.0.0.0）；ipv4 = 所有 IPv4 网卡（0.0.0.0）。 */
export type ListenScope = 'loopback' | 'all' | 'ipv4';

export type ListenStatus =
  | { state: 'off' }
  /** skippedPorts：想用却被占用、自动跳过的端口（按尝试的顺序）；为空表示用上了首选的端口。 */
  | { state: 'listening'; port: number; scope: ListenScope; skippedPorts: number[] }
  | { state: 'failed'; reason: 'PORT_IN_USE'; ports: number[] };

/** 一组监听的设置和回调。 */
export interface HttpListenerOptions {
  /** 日志前缀，例如 [api]、[ipp]。 */
  logTag: string;
  requestTimeoutMs: number;
  /** 请求头要在这么久内收完（不设用 node:http 的默认 60 秒，每 30 秒才查一次）。 */
  headersTimeoutMs?: number | undefined;
  maxConnections: number;
  /** 每个请求（自检请求除外）。 */
  onRequest: (request: IncomingMessage, response: ServerResponse) => void;
  /** 每新建一个 node:http 服务调用一次：挂上额外的事件（例如 connection、checkContinue）。 */
  configure?: ((server: Server) => void) | undefined;
  /** ipv4 范围绑定的地址，默认 0.0.0.0（所有 IPv4 网卡）。测试和 E2E 用 127.0.0.1：不在局域网上开端口。 */
  ipv4Host?: string | undefined;
}

/** ipv4 范围默认监听所有 IPv4 网卡。 */
const ALL_IPV4 = '0.0.0.0';

class PortUnavailableError extends Error {}

interface Listening {
  servers: [Server, ...Server[]];
  /** 在 IPv6 回环地址 ::1 上也能收到请求：自检时两个回环地址都要查。 */
  hasIpv6: boolean;
}

/** 依次尝试的端口：指定的 → 上次用成功的 → 默认的几个 → 系统分配的空闲端口（去重）。 */
export function portOrder(preferred: number | null, last: number | null, candidates: readonly number[]): number[] {
  const ports = [preferred, last, ...candidates, ANY_FREE_PORT];
  return [...new Set(ports.filter((port): port is number => port !== null))];
}

/**
 * 一组 node:http 服务的监听：依次试端口，被占用就换；监听后从回环地址请求自己一次，回应不是自己的也换；
 * 启动、停止一次只做一件（两次启动交错时，先起来的那组服务会被后一次覆盖，再也关不掉）。
 * 本机接口和局域网共享共用。
 */
export class HttpListener {
  private servers: Server[] = [];
  private current: ListenStatus = { state: 'off' };
  private readonly lifecycle = new SerialQueue();
  /** 自检口令：每个服务一个，别的程序不可能回应它。 */
  private readonly probeToken = randomUUID();

  constructor(private readonly options: HttpListenerOptions) {}

  get status(): ListenStatus {
    return this.current;
  }

  /** 正在监听的端口；没有监听时为 null。 */
  port(): number | null {
    return this.current.state === 'listening' ? this.current.port : null;
  }

  /** 按顺序试 ports，用上第一个能用的；都不能用时状态是 failed。 */
  start(scope: ListenScope, ports: readonly number[]): Promise<ListenStatus> {
    return this.lifecycle.run(() => this.startNow(scope, ports));
  }

  /** 停止监听：正在处理的请求最多再等 DRAIN_GRACE_MS。 */
  stop(): Promise<void> {
    return this.lifecycle.run(async () => {
      this.current = { state: 'off' };
      await drain(this.take());
    });
  }

  private async startNow(scope: ListenScope, ports: readonly number[]): Promise<ListenStatus> {
    this.current = { state: 'off' };
    await drain(this.take());
    const skippedPorts: number[] = [];
    for (const port of ports) {
      try {
        // 新起的服务先放在局部变量里，自检通过才交给 this.servers。
        const listening = await this.listen(port, scope);
        const bound = addressPort(listening.servers[0]);
        if (!(await this.answersOnLoopback(bound, listening.hasIpv6))) {
          await drain(listening.servers);
          throw new PortUnavailableError(`port ${bound} is answered by another program on a loopback address`);
        }
        this.servers = listening.servers;
        this.current = { state: 'listening', port: bound, scope, skippedPorts };
        return this.current;
      } catch (error) {
        if (!(error instanceof PortUnavailableError)) {
          throw error;
        }
        console.warn(`${this.options.logTag} port ${port} is unavailable`, error.message);
        skippedPorts.push(port);
      }
    }
    this.current = { state: 'failed', reason: 'PORT_IN_USE', ports: [...ports] };
    return this.current;
  }

  private take(): Server[] {
    const servers = this.servers;
    this.servers = [];
    return servers;
  }

  private async listen(port: number, scope: ListenScope): Promise<Listening> {
    switch (scope) {
      case 'ipv4':
        return { servers: [await this.listenOn(port, this.options.ipv4Host ?? ALL_IPV4)], hasIpv6: false };
      case 'all':
        try {
          return { servers: [await this.listenOn(port, '::')], hasIpv6: true };
        } catch (error) {
          if (!isNoIpv6(error)) {
            throw error;
          }
          console.warn(`${this.options.logTag} no IPv6, listening on ${ALL_IPV4}`, error);
          return { servers: [await this.listenOn(port, ALL_IPV4)], hasIpv6: false };
        }
      case 'loopback': {
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
          console.warn(`${this.options.logTag} no IPv6 loopback, listening on 127.0.0.1:${bound} only`);
          return { servers: [primary], hasIpv6: false };
        }
      }
    }
  }

  private listenOn(port: number, host: string): Promise<Server> {
    const handler = (request: IncomingMessage, response: ServerResponse) => this.dispatch(request, response);
    const { headersTimeoutMs } = this.options;
    // node:http 按 connectionsCheckingInterval（默认 30 秒）才查一次超时：设了短的请求头时限就跟着查勤一些。
    const server =
      headersTimeoutMs === undefined
        ? createServer(handler)
        : createServer({ headersTimeout: headersTimeoutMs, connectionsCheckingInterval: TIMEOUT_CHECK_MS }, handler);
    server.requestTimeout = this.options.requestTimeoutMs;
    server.maxConnections = this.options.maxConnections;
    this.options.configure?.(server);
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
        server.on('error', (error) => console.error(`${this.options.logTag} server error`, error));
        resolve(server);
      });
    });
  }

  private dispatch(request: IncomingMessage, response: ServerResponse): void {
    if (request.headers[PROBE_HEADER] === this.probeToken) {
      response.writeHead(NO_CONTENT, { [PROBE_HEADER]: this.probeToken });
      response.end();
      return;
    }
    this.options.onRequest(request, response);
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
        console.warn(`${this.options.logTag} self-check on ${host}:${port} failed: ${error.message}`);
        resolve(false);
      });
      probe.end();
    });
  }
}

/**
 * 关掉服务：先关空闲的保持连接，正在处理的请求给一点时间把回应发出去，到时间还没完就强行断开。
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

function addressPort(server: Server | undefined): number {
  const address = server?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Server has no TCP address');
  }
  return address.port;
}
