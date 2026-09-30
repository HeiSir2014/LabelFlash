/**
 * 中转服务的接线：HTTP 路由（健康检查、扫码页）和 WebSocket → RelayHub。业务都在 hub.ts。
 */
import type { Server, ServerWebSocket } from 'bun';
import { randomId } from '../../src/shared/mobile-crypto';
import { CLOSE_CODES, MAX_FRAME_BYTES } from '../../src/shared/mobile-protocol';
import type { RelayConfig } from './config';
import { type HubLimits, type Peer, type PeerRole, RelayHub } from './hub';
import { serveStatic } from './static-files';

export interface RunningRelay {
  url: URL;
  hub: RelayHub;
  stop(): Promise<void>;
}

interface SocketData {
  role: PeerRole;
  id: string;
  ip: string;
  peer: Peer | null;
}

const TICK_INTERVAL_MS = 1_000;
/**
 * 协议 1 的客户端（1.1.0 及更早的电脑、没刷新的老扫码页）发的是 JSON 文本帧：按它们认得的格式回一个 version 错误再断开，
 * 电脑和手机上就会提示更新，而不是一直重连。
 */
const LEGACY_VERSION_ERROR = JSON.stringify({ t: 'error', code: 'version' });
/** 连接满了时让客户端过这么久再试（HTTP 503 的 Retry-After，单位秒）；客户端本来就按退避重连。 */
const RETRY_AFTER_SECONDS = 30;
/**
 * 中转服务只比较时间差（限速、第一帧超时、宽限期），用单调时钟：服务器校时把系统时间往回拨时，
 * 限速额度不会被扣光，宽限期也不会被拉长或缩短。
 */
const monotonicClock = { now: () => performance.now() };
/**
 * 协议层的兜底：应用层心跳是 25 秒一次，超过这么久没有任何数据就断开。
 * Bun 按秒计；反向代理的读超时（nginx 的 proxy_read_timeout）也要不少于 120 秒。
 */
const IDLE_TIMEOUT_SECONDS = 120;
const SOCKET_PATHS: Record<string, PeerRole> = {
  '/ws/desktop': 'desktop',
  '/ws/phone': 'phone',
};

export function startRelay(
  config: RelayConfig,
  log: (line: string) => void,
  limits?: Partial<HubLimits>,
): RunningRelay {
  const hub = new RelayHub({ clock: monotonicClock, log, limits });

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    // 生产模式：出错时不把堆栈和源码路径写进响应。
    development: false,
    fetch(request, server) {
      return route(request, server, config, hub);
    },
    error(error) {
      log(`http error: ${error.message}`);
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    },
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: MAX_FRAME_BYTES,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      sendPings: true,
      // 内容是加密的（图也在里面），压缩没有意义。
      perMessageDeflate: false,
      open(socket) {
        const peer = toPeer(socket);
        socket.data.peer = peer;
        if (!hub.attach(peer, socket.data.role)) {
          socket.close(CLOSE_CODES.tryLater, 'busy');
        }
      },
      message(socket, message) {
        const { peer } = socket.data;
        if (!peer) {
          return;
        }
        if (typeof message === 'string') {
          socket.send(LEGACY_VERSION_ERROR);
          socket.close(CLOSE_CODES.policy, 'binary frames only');
          return;
        }
        hub.receive(peer, new Uint8Array(message));
      },
      close(socket) {
        if (socket.data.peer) {
          hub.detach(socket.data.peer);
        }
      },
    },
  });

  const ticker = setInterval(() => hub.tick(), TICK_INTERVAL_MS);
  log(`relay ${config.version} listening on ${server.url.href}`);

  return {
    url: server.url,
    hub,
    async stop() {
      clearInterval(ticker);
      await server.stop(true);
    },
  };
}

async function route(
  request: Request,
  server: Server<SocketData>,
  config: RelayConfig,
  hub: RelayHub,
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  const role = SOCKET_PATHS[pathname];
  if (role) {
    return upgrade(request, server, config, hub, role);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (pathname === '/healthz') {
    return Response.json({ ok: true, version: config.version, ...hub.stats() });
  }
  if (pathname === '/') {
    // 相对地址：经反向代理的路径前缀（例如 /labelflash/）访问时，跳到前缀下的 m/。
    return new Response(null, { status: 302, headers: { Location: 'm/' } });
  }
  return serveStatic(config.webRoot, pathname, config.publicOrigin);
}

function upgrade(
  request: Request,
  server: Server<SocketData>,
  config: RelayConfig,
  hub: RelayHub,
  role: PeerRole,
): Response | undefined {
  // 手机页面只能来自我们自己的站点；电脑端不是浏览器，没有 Origin。
  if (role === 'phone' && request.headers.get('origin') !== config.publicOrigin) {
    return new Response('Forbidden', { status: 403 });
  }
  // 服务只经反向代理访问（容器端口只映射到宿主机的 127.0.0.1），X-Real-IP 由反向代理设置。
  const ip = request.headers.get('x-real-ip') ?? server.requestIP(request)?.address ?? 'unknown';
  // 满了就不升级：客户端看到的是连接失败，按退避重连，不会先连上再被踢、立刻重连。
  if (!hub.hasRoom(ip)) {
    return new Response('Service Unavailable', {
      status: 503,
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }
  const data: SocketData = { role, id: randomId(), ip, peer: null };
  if (server.upgrade(request, { data })) {
    return undefined;
  }
  return new Response('Upgrade Required', { status: 426 });
}

function toPeer(socket: ServerWebSocket<SocketData>): Peer {
  return {
    id: socket.data.id,
    ip: socket.data.ip,
    send: (bytes) => {
      socket.send(bytes);
    },
    close: (code, reason) => socket.close(code, reason),
  };
}
