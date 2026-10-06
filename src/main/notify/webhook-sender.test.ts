import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Delivery } from '../../core/notify/delivery';
import type { WebhookEndpoint } from '../../core/notify/webhook-model';
import { createWebhookSender, signPayload, WEBHOOK_HEADERS } from './webhook-sender';

const SECRET = 'shared-secret';
const NOW = Date.UTC(2026, 8, 28, 1, 5);
let server: ReturnType<typeof Bun.serve>;
let base: string;
const verified: boolean[] = [];

/** 按文档写的接收方：用同一个密钥重新计算签名并比较。 */
function verify(request: Request, body: string): boolean {
  const timestamp = request.headers.get(WEBHOOK_HEADERS.timestamp) ?? '';
  const signature = request.headers.get(WEBHOOK_HEADERS.signature) ?? '';
  const expected = `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')}`;
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.text();
      verified.push(verify(request, body));
      if (url.pathname === '/moved') {
        return new Response(null, { status: 301, headers: { location: '/ok' } });
      }
      return new Response(null, { status: url.pathname === '/ok' ? 204 : 500 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const DELIVERY: Delivery = {
  id: 1,
  endpointId: 'w1',
  eventId: 'job-1',
  event: 'printed',
  payload: '{"id":"job-1","event":"printed"}',
  state: 'pending',
  attempts: 0,
  lastStatus: null,
  lastError: null,
  createdAt: NOW,
  nextAttemptAt: NOW,
  updatedAt: NOW,
};

function endpoint(path: string, secretName: string | null = '签名'): WebhookEndpoint {
  return {
    id: 'w1',
    name: 'ERP',
    url: `${base}${path}`,
    secretName,
    events: ['printed'],
    sources: ['scan'],
    enabled: true,
  };
}

function createSender(secrets: Record<string, string> = { 签名: SECRET }) {
  return createWebhookSender({
    fetch: (url, init) => fetch(url, init),
    secret: (name) => secrets[name] ?? null,
    now: () => NOW,
    userAgent: 'CDL-LabelFlash/test',
  });
}

describe('createWebhookSender', () => {
  test('posts the payload with a signature the receiver can verify', async () => {
    verified.length = 0;
    expect(await createSender()(endpoint('/ok'), DELIVERY)).toEqual({ status: 204, error: null });
    expect(verified).toEqual([true]);
  });

  test('signs timestamp and body together, so a replayed body with a new timestamp fails', () => {
    const signature = signPayload(SECRET, 100, DELIVERY.payload);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signPayload(SECRET, 101, DELIVERY.payload)).not.toBe(signature);
  });

  test('sends unsigned when no secret is configured, and fails when the named secret is missing', async () => {
    verified.length = 0;
    expect(await createSender()(endpoint('/ok', null), DELIVERY)).toEqual({ status: 204, error: null });
    expect(verified).toEqual([false]);
    expect(await createSender({})(endpoint('/ok'), DELIVERY)).toEqual({
      status: null,
      error: '没有设置签名密钥「签名」',
    });
  });

  test('reports error statuses and does not follow redirects', async () => {
    expect(await createSender()(endpoint('/fail'), DELIVERY)).toEqual({ status: 500, error: '接口返回 500' });
    expect((await createSender()(endpoint('/moved'), DELIVERY)).status).toBe(301);
  });

  test('reports unreachable hosts without a status', async () => {
    const unreachable = { ...endpoint('/ok'), url: 'http://127.0.0.1:1/x' };
    expect(await createSender()(unreachable, DELIVERY)).toEqual({ status: null, error: '网络错误，连不上接口' });
  });
});
