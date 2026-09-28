/**
 * 中转服务的接线：HTTP 路由（健康检查、扫码页）和 WebSocket → RelayHub。业务都在 hub.ts。
 */
import type { Server, ServerWebSocket } from 'bun';
import { systemClock } from '../../src/core/types';
import { randomId } from '../../src/shared/mobile-crypto';
import { MAX_FRAME_BYTES } from '../../src/shared/mobile-protocol';
import type { RelayConfig } from './config';
import { CLOSE_POLICY, CLOSE_TRY_LATER, type Peer, type PeerRole, RelayHub } from './hub';
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
 * 协议层的兜底：应用层心跳是 25 秒一次，超过这么久没有任何数据就断开。
 * Bun 按秒计；反向代理的读超时（nginx 的 proxy_read_timeout）也要不少于 120 秒。
 */
const IDLE_TIMEOUT_SECONDS = 120;
const SOCKET_PATHS: Record<string, PeerRole> = {
  '/ws/desktop': 'desktop',
  '/ws/phone': 'phone',
};

export function startRelay(config: RelayConfig, log: (line: string) => void): RunningRelay {
  const hub = new RelayHub({ clock: systemClock, log });

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch(request, server) {
      return route(request, server, config, hub);
    },
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: MAX_FRAME_BYTES,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      sendPings: true,
      // 帧很小，而且内容是加密的，压缩没有意义。
      perMessageDeflate: false,
      open(socket) {
        const peer = toPeer(socket);
        socket.data.peer = peer;
        if (!hub.attach(peer, socket.data.role)) {
          socket.close(CLOSE_TRY_LATER, 'busy');
        }
      },
      message(socket, message) {
        const { peer } = socket.data;
        if (!peer) {
          return;
        }
        if (typeof message !== 'string') {
          socket.close(CLOSE_POLICY, 'text frames only');
          return;
        }
        hub.receive(peer, message);
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
    return upgrade(request, server, config, role);
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
  role: PeerRole,
): Response | undefined {
  // 手机页面只能来自我们自己的站点；电脑端不是浏览器，没有 Origin。
  if (role === 'phone' && request.headers.get('origin') !== config.publicOrigin) {
    return new Response('Forbidden', { status: 403 });
  }
  // 服务只经反向代理访问（容器端口只映射到宿主机的 127.0.0.1），X-Real-IP 由反向代理设置。
  const ip = request.headers.get('x-real-ip') ?? server.requestIP(request)?.address ?? 'unknown';
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
    send: (text) => {
      socket.send(text);
    },
    close: (code, reason) => socket.close(code, reason),
  };
}
