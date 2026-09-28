import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhoneSession, type SessionEvent } from '../../relay/web/src/phone-session';
import { openSessionStore } from '../../relay/web/src/session-store';
import { importSessionKey } from '../../src/shared/mobile-crypto';
import { parsePhoneFragment } from '../../src/shared/mobile-protocol';
import type { SocketLike } from '../../src/shared/relay-socket';
import { APP_ROOT } from './electron-app';

/** 中转服务启动后多久内健康检查要通过：本机进程，正常不到一秒。 */
const RELAY_START_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 100;

export interface LocalRelay {
  /** 电脑设置里填的中转地址，例如 http://localhost:3181/。 */
  baseUrl: string;
  /** 扫码页的 origin：手机连接的 Origin 必须是它。 */
  origin: string;
  stop: () => Promise<void>;
}

/**
 * 构建并在本机随机端口启动中转服务（子进程里用 Bun 运行，和线上容器跑的是同一个 server.js）。
 * 地址用 localhost：中转服务只对 localhost 放行 http。
 */
export async function startLocalRelay(): Promise<LocalRelay> {
  const workDir = await mkdtemp(join(tmpdir(), 'cdl-relay-e2e-'));
  const outDir = join(workDir, 'dist');
  const build = spawnSync('bun', ['scripts/relay/build.ts', outDir], { cwd: APP_ROOT, encoding: 'utf8' });
  if (build.status !== 0) {
    throw new Error(`构建中转服务失败：${build.stderr || build.stdout}`);
  }
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const child = spawn('bun', [join(outDir, 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: origin },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(`${origin}/healthz`);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return {
    baseUrl: `${origin}/`,
    origin,
    stop: async () => {
      await stopChild(child);
      await rm(workDir, { recursive: true, force: true });
    },
  };
}

export interface TestPhone {
  session: PhoneSession;
  events: SessionEvent[];
}

/** 用扫码页自己的协议代码（PhoneSession）当一部手机，连上电脑二维码里的链接。 */
export async function connectTestPhone(relay: LocalRelay, phoneUrl: string, device = 'E2E 手机'): Promise<TestPhone> {
  const fragment = parsePhoneFragment(new URL(phoneUrl).hash);
  if (!fragment) {
    throw new Error(`二维码里的链接不对：${phoneUrl}`);
  }
  const events: SessionEvent[] = [];
  const socketUrl = new URL('ws/phone', relay.baseUrl);
  socketUrl.protocol = 'ws:';
  const session = new PhoneSession({
    relayUrl: socketUrl.href,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device,
    store: openSessionStore(null, fragment.session, () => Date.now()),
    // Node 自带的 WebSocket（undici）支持带请求头：浏览器会自动带 Origin，这里要自己带上。
    createSocket: (url) =>
      new WebSocket(url, { headers: { Origin: relay.origin } } as unknown as string[]) as unknown as SocketLike,
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => Date.now(),
    onEvent: (event) => events.push(event),
  });
  session.start();
  return { session, events };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + RELAY_START_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // 还没开始监听。
    }
    if (Date.now() > deadline) {
      throw new Error(`中转服务 ${RELAY_START_TIMEOUT_MS} 毫秒内没有启动：${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}
