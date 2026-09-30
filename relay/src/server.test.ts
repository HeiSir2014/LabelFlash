import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomId } from '../../src/shared/mobile-crypto';
import { CLOSE_CODES, MAX_FRAME_BYTES, MOBILE_PROTOCOL_VERSION } from '../../src/shared/mobile-protocol';
import { decodeWire, encodeWire } from '../../src/shared/wire';
import type { RelayConfig } from './config';
import { type RunningRelay, startRelay } from './server';

const ORIGIN = 'https://relay.example.com';
const BODY = { iv: new Uint8Array(12).fill(7), ct: new Uint8Array([1, 2, 3, 4]) };
/** 帧超过 maxPayloadLength 时 Bun 直接断开 TCP 连接，不发关闭帧，客户端看到的是 1006。 */
const CLOSE_ABNORMAL = 1006;

let webRoot: string;
let relay: RunningRelay;
const clients: WebSocket[] = [];

/** 收到的帧排队，按顺序取；等不到就超时失败。 */
class Client {
  private readonly frames: unknown[] = [];
  private readonly waiters: ((frame: unknown) => void)[] = [];
  readonly closed: Promise<number>;

  constructor(readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (event) => {
      // 二进制帧是 msgpack；文本帧只有中转服务回给协议 1 客户端的 version 错误。
      const frame =
        typeof event.data === 'string' ? JSON.parse(event.data) : decodeWire(new Uint8Array(event.data as ArrayBuffer));
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(frame);
      } else {
        this.frames.push(frame);
      }
    };
    this.closed = new Promise((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });
  }

  send(frame: object): void {
    this.socket.send(encodeWire(frame));
  }

  next(): Promise<unknown> {
    const frame = this.frames.shift();
    if (frame !== undefined) {
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

async function connect(path: string, origin?: string): Promise<Client> {
  const url = new URL(path, relay.url).href.replace(/^http/, 'ws');
  const socket = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
  clients.push(socket);
  const client = new Client(socket);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error(`cannot connect to ${path}`));
  });
  return client;
}

beforeAll(async () => {
  webRoot = join(await mkdtemp(join(tmpdir(), 'relay-server-')), 'web');
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>扫码</title>');
  const config: RelayConfig = { host: '127.0.0.1', port: 0, publicOrigin: ORIGIN, webRoot, version: 'test-1' };
  relay = startRelay(config, () => {});
});

afterEach(() => {
  for (const socket of clients.splice(0)) {
    socket.close();
  }
});

afterAll(async () => {
  await relay.stop();
  await rm(join(webRoot, '..'), { recursive: true, force: true });
});

describe('http routes', () => {
  test('reports health without session details', async () => {
    const response = await fetch(new URL('/healthz', relay.url));
    expect(await response.json()).toEqual({ ok: true, version: 'test-1', sessions: 0, connections: 0 });
  });

  test('sends the bare path to the scan page', async () => {
    const response = await fetch(new URL('/', relay.url), { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('m/');
  });

  test('serves the scan page', async () => {
    const response = await fetch(new URL('/m/', relay.url));
    expect(await response.text()).toContain('扫码');
  });

  test('answers 404 elsewhere', async () => {
    expect((await fetch(new URL('/admin', relay.url))).status).toBe(404);
  });

  test('answers a NUL in the path without leaking internals', async () => {
    const response = await fetch(new URL('/m/%00', relay.url));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
});

describe('websockets', () => {
  test('relays a whole session between a desktop and a phone', async () => {
    const session = randomId();
    const desktop = await connect('/ws/desktop');
    desktop.send({ t: 'open', v: MOBILE_PROTOCOL_VERSION, session, secret: randomId() });
    expect(await desktop.next()).toEqual({ t: 'opened' });

    const phone = await connect('/ws/phone', ORIGIN);
    phone.send({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session });
    expect(await phone.next()).toEqual({ t: 'online' });
    const joined = (await desktop.next()) as { t: string; phone: string };
    expect(joined.t).toBe('joined');

    phone.send({ t: 'send', body: BODY });
    expect(await desktop.next()).toEqual({ t: 'recv', phone: joined.phone, body: BODY });
    desktop.send({ t: 'send', phone: joined.phone, body: BODY });
    expect(await phone.next()).toEqual({ t: 'recv', body: BODY });

    desktop.send({ t: 'close', reason: 'stopped' });
    expect(await phone.next()).toEqual({ t: 'ended', reason: 'stopped' });
    expect(await phone.closed).toBe(1000);
  });

  // 1.1.0 及更早的电脑、没刷新的老扫码页发 JSON 文本帧：按它们认得的格式回 version 错误再断开，它们会提示更新。
  test('answers a protocol 1 text frame with a version error it can read, then closes', async () => {
    const desktop = await connect('/ws/desktop');
    desktop.socket.send(JSON.stringify({ t: 'open', v: 1, session: randomId(), secret: randomId() }));
    expect(await desktop.next()).toEqual({ t: 'error', code: 'version' });
    expect(await desktop.closed).toBe(CLOSE_CODES.policy);
  });

  test('refuses a phone from another origin', async () => {
    await expect(connect('/ws/phone', 'https://evil.example')).rejects.toThrow();
  });

  test('closes a connection that sends an oversized frame', async () => {
    const desktop = await connect('/ws/desktop');
    desktop.socket.send(new Uint8Array(MAX_FRAME_BYTES + 1));
    expect(await desktop.closed).toBe(CLOSE_ABNORMAL);
  });
});

describe('capacity', () => {
  test('answers 503 instead of upgrading when full', async () => {
    const full = startRelay(
      { host: '127.0.0.1', port: 0, publicOrigin: ORIGIN, webRoot, version: 'test-1' },
      () => {},
      { maxConnections: 0 },
    );
    try {
      const response = await fetch(new URL('/ws/desktop', full.url), {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('30');
    } finally {
      await full.stop();
    }
  });
});
