import { afterEach, describe, expect, test } from 'bun:test';
import { connect, createServer, type Server } from 'node:net';
import { FakeClock } from '../../core/testing/fake-clock';
import type { ApiServerStatus } from '../../shared/local-api';
import type { ApiError } from './api-error';
import { hashApiKey } from './api-keys';
import { Authenticator } from './authenticator';
import { ApiHttpServer } from './http-server';
import { RateLimiter } from './rate-limiter';
import type { ApiRequest, ApiResponse } from './router';

const KEY = 'lf_test';
const SITE = 'https://erp.example.com';
/** 测试里用 0：让系统随便给一个空闲端口，不和本机上跑着的程序冲突。 */
const ANY_PORT = 0;

interface Options {
  origins?: string[];
  bodyLimitBytes?: number;
  burst?: number;
  /** 按来源地址限速的突发量；测试里把本机也当作局域网来源，才测得到。 */
  addressBurst?: number;
  handlerDelayMs?: number;
}

const servers: ApiHttpServer[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(blockers.splice(0).map((blocker) => new Promise((resolve) => blocker.close(resolve))));
});

function createTestServer(options: Options = {}) {
  const handled: ApiRequest[] = [];
  const prompts: string[] = [];
  const origins = options.origins ?? [];
  const server = new ApiHttpServer({
    authenticator: new Authenticator({
      findKeyByHash: (hash) => (hash === hashApiKey(KEY) ? { id: 'k1', name: 'ERP' } : null),
      hasAnyKey: () => true,
      isOriginAuthorized: (origin) => origins.includes(origin),
      requestOrigin: (origin) => {
        prompts.push(origin);
        return 'pending';
      },
      touchKey: () => {},
    }),
    rateLimiter: new RateLimiter(new FakeClock(), { perSecond: 1, burst: options.burst ?? 100 }),
    isOriginAuthorized: (origin) => origins.includes(origin),
    handle: async (request): Promise<ApiResponse> => {
      handled.push(request);
      if (options.handlerDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.handlerDelayMs));
      }
      if (request.url === '/v1/boom') {
        throw new Error('secret detail');
      }
      return { status: 200, contentType: 'application/json', body: { ok: true, url: request.url } };
    },
    requiresCaller: (_method, url) => url !== '/v1/service',
    bodyLimitBytes: options.bodyLimitBytes,
    addressLimiter:
      options.addressBurst === undefined
        ? undefined
        : new RateLimiter(new FakeClock(), { perSecond: 1, burst: options.addressBurst }),
    limitLoopback: options.addressBurst !== undefined,
  });
  servers.push(server);
  return { server, handled, prompts };
}

function portOf(status: ApiServerStatus): number {
  if (status.state !== 'listening') {
    throw new Error(`server is not listening: ${JSON.stringify(status)}`);
  }
  return status.port;
}

async function start(server: ApiHttpServer): Promise<number> {
  return portOf(await server.start({ lanEnabled: false, ports: [ANY_PORT] }));
}

async function occupyPort(): Promise<number> {
  const blocker = createServer();
  blockers.push(blocker);
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const address = blocker.address();
  if (address === null || typeof address === 'string') {
    throw new Error('blocker has no port');
  }
  return address.port;
}

const withKey = { authorization: `Bearer ${KEY}` };

/** 直接发一行原始请求（fetch 会把 //x 这类路径规范掉）；返回响应的原文。 */
function rawRequest(port: number, requestLine: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
      socket.write([requestLine, 'Host: 127.0.0.1', 'Connection: close', ...lines, '', ''].join('\r\n'));
    });
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
    });
    socket.on('end', () => resolve(text));
    socket.on('error', reject);
  });
}

describe('ApiHttpServer', () => {
  test('serves open routes without a caller and routes authenticated requests', async () => {
    const { server, handled } = createTestServer();
    const port = await start(server);
    expect(await (await fetch(`http://127.0.0.1:${port}/v1/service`)).json()).toEqual({ ok: true, url: '/v1/service' });
    const denied = await fetch(`http://127.0.0.1:${port}/v1/templates`);
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/v1/templates?pageSize=2`, { headers: withKey });
    expect(allowed.status).toBe(200);
    expect(handled.at(-1)).toMatchObject({ method: 'GET', url: '/v1/templates?pageSize=2', caller: { id: 'key:k1' } });
  });

  test('passes the parsed JSON body on', async () => {
    const { server, handled } = createTestServer();
    const port = await start(server);
    await fetch(`http://127.0.0.1:${port}/v1/printJobs`, {
      method: 'POST',
      headers: { ...withKey, 'content-type': 'application/json' },
      body: JSON.stringify({ copies: 2 }),
    });
    expect(handled.at(-1)?.body).toEqual({ copies: 2 });
  });

  test('rejects a body that is not JSON', async () => {
    const { server } = createTestServer();
    const port = await start(server);
    const response = await fetch(`http://127.0.0.1:${port}/v1/printJobs`, {
      method: 'POST',
      headers: withKey,
      body: '{not json',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: ApiError }).error.status).toBe('INVALID_ARGUMENT');
  });

  test('refuses bodies over the limit with 413', async () => {
    const { server, handled } = createTestServer({ bodyLimitBytes: 16 });
    const port = await start(server);
    const response = await fetch(`http://127.0.0.1:${port}/v1/printJobs`, {
      method: 'POST',
      headers: withKey,
      body: JSON.stringify({ fields: 'x'.repeat(100) }),
    });
    expect(response.status).toBe(413);
    expect(handled).toEqual([]);
  });

  test('limits the request rate per caller', async () => {
    const { server } = createTestServer({ burst: 1 });
    const port = await start(server);
    expect((await fetch(`http://127.0.0.1:${port}/v1/templates`, { headers: withKey })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/v1/templates`, { headers: withKey })).status).toBe(429);
  });

  // 处理出错的细节只写日志，不发给调用方。
  test('answers unexpected failures with INTERNAL and no detail', async () => {
    const { server } = createTestServer();
    const port = await start(server);
    const response = await fetch(`http://127.0.0.1:${port}/v1/boom`, { headers: withKey });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret detail');
  });

  test('moves to the next port when one is taken and says which it skipped', async () => {
    const taken = await occupyPort();
    const { server } = createTestServer();
    const status = await server.start({ lanEnabled: false, ports: [taken, ANY_PORT] });
    expect(status).toMatchObject({ state: 'listening', skippedPorts: [taken] });
    expect(portOf(status)).not.toBe(taken);
  });

  test('reports failure only when every port it may use is taken', async () => {
    const taken = await occupyPort();
    const { server } = createTestServer();
    expect(await server.start({ lanEnabled: false, ports: [taken] })).toEqual({
      state: 'failed',
      reason: 'PORT_IN_USE',
      ports: [taken],
    });
  });

  // Windows 上别的程序占着 127.0.0.1 的这个端口时，监听所有网卡照样成功，本机的请求却会到那个程序：
  // 启动后自己探测一次，回应不是自己的就换端口。
  test('moves on when another program answers on the loopback address of the port', async () => {
    const taken = await occupyPort();
    const { server } = createTestServer();
    const port = portOf(await server.start({ lanEnabled: true, ports: [taken, ANY_PORT] }));
    expect(port).not.toBe(taken);
    expect((await fetch(`http://127.0.0.1:${port}/v1/service`)).status).toBe(200);
  });

  test('treats a port another program answers on locally as taken', async () => {
    const taken = await occupyPort();
    const { server } = createTestServer();
    expect(await server.start({ lanEnabled: true, ports: [taken] })).toMatchObject({
      state: 'failed',
      ports: [taken],
    });
  });

  test('listens on every interface when the LAN is enabled', async () => {
    const { server } = createTestServer();
    const status = await server.start({ lanEnabled: true, ports: [ANY_PORT] });
    expect(status).toMatchObject({ state: 'listening', lanEnabled: true });
    expect((await fetch(`http://127.0.0.1:${portOf(status)}/v1/service`)).status).toBe(200);
  });

  // 请求体在认证之后才读：局域网里不带密钥的机器不能让程序先收下几 MB 的数据。
  test('refuses an unauthenticated request before reading its body', async () => {
    const { server, handled } = createTestServer({ bodyLimitBytes: 16 });
    const port = await start(server);
    const response = await fetch(`http://127.0.0.1:${port}/v1/printJobs`, {
      method: 'POST',
      body: JSON.stringify({ fields: 'x'.repeat(100) }),
    });
    expect(response.status).toBe(401);
    expect(handled).toEqual([]);
  });

  // 路径解析不了也只是「找不到」，不当作程序出错写日志（局域网里的机器可以借此刷日志）。
  test('answers an unparsable path without an internal error', async () => {
    const { server } = createTestServer();
    const port = await start(server);
    const response = await rawRequest(port, 'GET //x HTTP/1.1', withKey);
    expect(response).not.toContain(' 500 ');
  });

  test('limits the request rate per address before authentication', async () => {
    const { server } = createTestServer({ addressBurst: 1 });
    const port = await start(server);
    expect((await fetch(`http://127.0.0.1:${port}/v1/templates`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/v1/templates`)).status).toBe(429);
  });

  // 同时来两次启动（改了端口又马上点开关）：只能留下最后那次的服务，旧的必须关掉。
  test('leaves only the last of two overlapping starts listening', async () => {
    const { server } = createTestServer();
    const [first, second] = await Promise.all([
      server.start({ lanEnabled: true, ports: [ANY_PORT] }),
      server.start({ lanEnabled: false, ports: [ANY_PORT] }),
    ]);
    expect(server.status).toEqual(second);
    await server.stop();
    await expect(fetch(`http://127.0.0.1:${portOf(first)}/v1/service`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${portOf(second)}/v1/service`)).rejects.toThrow();
  });

  // 改设置重启服务时，正在处理的请求要处理完：不然任务已经收下，调用方却收到断线，重试就重复打印。
  test('lets a request in flight finish when it restarts', async () => {
    const { server } = createTestServer({ handlerDelayMs: 300 });
    const port = await start(server);
    const pending = fetch(`http://127.0.0.1:${port}/v1/templates`, { headers: withKey });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.start({ lanEnabled: false, ports: [ANY_PORT] });
    expect((await pending).status).toBe(200);
  });

  test('stops listening', async () => {
    const { server } = createTestServer();
    const port = await start(server);
    await server.stop();
    expect(server.status).toEqual({ state: 'off' });
    await expect(fetch(`http://127.0.0.1:${port}/v1/service`)).rejects.toThrow();
  });

  describe('browsers', () => {
    const preflight = (port: number, origin: string) =>
      fetch(`http://127.0.0.1:${port}/v1/printJobs`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-private-network': 'true',
        },
      });

    test('answers the preflight of an authorized website', async () => {
      const { server } = createTestServer({ origins: [SITE] });
      const port = await start(server);
      const response = await preflight(port, SITE);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
      expect(response.headers.get('access-control-allow-private-network')).toBe('true');
    });

    // 预检不放行，网页的请求就发不出来，电脑上的授权框也就弹不出来。
    test('lets the preflight of a new website through so that its request can ask for authorization', async () => {
      const { server, prompts } = createTestServer();
      const port = await start(server);
      expect((await preflight(port, SITE)).headers.get('access-control-allow-origin')).toBe(SITE);
      const response = await fetch(`http://127.0.0.1:${port}/v1/printJobs`, {
        method: 'POST',
        headers: { origin: SITE },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
      expect(prompts).toEqual([SITE]);
    });

    // 不需要授权的接口也不对没授权的网站开放跨域：网页不能借此探测本机装了这个程序。
    test('does not let an unknown website read open routes', async () => {
      const { server } = createTestServer();
      const port = await start(server);
      const response = await fetch(`http://127.0.0.1:${port}/v1/service`, { headers: { origin: SITE } });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('lets an authorized website read results', async () => {
      const { server } = createTestServer({ origins: [SITE] });
      const port = await start(server);
      const response = await fetch(`http://127.0.0.1:${port}/v1/templates`, { headers: { origin: SITE } });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
    });
  });
});
