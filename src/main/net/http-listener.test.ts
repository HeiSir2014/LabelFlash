import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import { HttpListener, type ListenStatus, portOrder } from './http-listener';

const listeners: HttpListener[] = [];

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.stop()));
});

function createListener(configure?: (server: Server) => void) {
  const handled: string[] = [];
  const listener = new HttpListener({
    logTag: '[test]',
    requestTimeoutMs: 5_000,
    maxConnections: 8,
    onRequest: (request, response) => {
      handled.push(request.url ?? '');
      response.end('ok');
    },
    configure,
    // 测试只在本机回环上开端口。
    ipv4Host: '127.0.0.1',
  });
  listeners.push(listener);
  return { listener, handled };
}

function portOf(status: ListenStatus): number {
  if (status.state !== 'listening') {
    throw new Error(`not listening: ${JSON.stringify(status)}`);
  }
  return status.port;
}

describe('HttpListener', () => {
  test('listens on the IPv4 host for the ipv4 scope', async () => {
    const { listener, handled } = createListener();
    const status = await listener.start('ipv4', [0]);
    expect(status).toMatchObject({ state: 'listening', scope: 'ipv4', skippedPorts: [] });
    expect(await (await fetch(`http://127.0.0.1:${portOf(status)}/x`)).text()).toBe('ok');
    // 自检请求不交给处理函数。
    expect(handled).toEqual(['/x']);
  });

  test('lets the owner attach its own events to every server it creates', async () => {
    let connections = 0;
    const { listener } = createListener((server) => {
      server.on('connection', () => {
        connections += 1;
      });
    });
    const port = portOf(await listener.start('loopback', [0]));
    await fetch(`http://127.0.0.1:${port}/x`);
    expect(connections).toBeGreaterThan(0);
  });

  test('stops listening', async () => {
    const { listener } = createListener();
    const port = portOf(await listener.start('ipv4', [0]));
    await listener.stop();
    expect(listener.status).toEqual({ state: 'off' });
    expect(listener.port()).toBeNull();
    await expect(fetch(`http://127.0.0.1:${port}/x`)).rejects.toThrow();
  });
});

describe('portOrder', () => {
  test('tries the chosen port, the last good one, the defaults, then any free port', () => {
    expect(portOrder(9000, 8632, [8631, 8632])).toEqual([9000, 8632, 8631, 0]);
    expect(portOrder(null, null, [8631])).toEqual([8631, 0]);
  });
});
