import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { HttpRequest } from '../../core/scan/enrich';
import { createHttpStepRunner, MAX_RESPONSE_BYTES } from './http-step';

interface Received {
  method: string;
  path: string;
  authorization: string | null;
  contentType: string | null;
  body: string;
}

let server: ReturnType<typeof Bun.serve>;
let base: string;
const received: Received[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      received.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.get('authorization'),
        contentType: request.headers.get('content-type'),
        body: await request.text(),
      });
      switch (url.pathname) {
        case '/shelf':
          return Response.json({ data: { shelf: 'A-01' } });
        case '/slow':
          await Bun.sleep(500);
          return Response.json({});
        case '/error':
          return new Response('nope', { status: 503 });
        case '/html':
          return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
        case '/huge':
          return new Response('x'.repeat(MAX_RESPONSE_BYTES + 1));
        default:
          return new Response('missing', { status: 404 });
      }
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'GET',
    url: `${base}/shelf?code=CL1`,
    headers: [],
    body: null,
    timeoutMs: 1_000,
    cacheSeconds: 0,
    ...overrides,
  };
}

function createRunner(secrets: Record<string, string> = {}) {
  let now = 0;
  const warnings: string[] = [];
  const run = createHttpStepRunner({
    fetch: (url, init) => fetch(url, init),
    secret: (name) => secrets[name] ?? null,
    now: () => now,
    userAgent: 'CDL-LabelFlash/test',
    warn: (message) => warnings.push(message),
  });
  return {
    run,
    warnings,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createHttpStepRunner', () => {
  test('returns the parsed JSON reply', async () => {
    const { run } = createRunner();
    expect(await run(request())).toEqual({ ok: true, json: { data: { shelf: 'A-01' } } });
  });

  test('fills secrets into headers and sends a JSON body', async () => {
    const { run, warnings } = createRunner({ 仓库接口: 'token-123' });
    received.length = 0;
    await run(
      request({
        method: 'POST',
        headers: [{ name: 'Authorization', value: 'Bearer {密钥:仓库接口}' }],
        body: '{"code":"CL1"}',
      }),
    );
    expect(received[0]).toMatchObject({
      method: 'POST',
      authorization: 'Bearer token-123',
      contentType: 'application/json',
      body: '{"code":"CL1"}',
    });
    expect(warnings).toEqual([]);
  });

  test('fails without sending when a referenced secret is missing, and never logs secrets', async () => {
    const { run, warnings } = createRunner({ 其他: 'token-123' });
    received.length = 0;
    const outcome = await run(request({ headers: [{ name: 'Authorization', value: '{密钥:仓库接口}' }] }));
    expect(outcome).toEqual({ ok: false, detail: '没有设置密钥「仓库接口」' });
    expect(received).toHaveLength(0);
    expect(warnings.join('\n')).not.toContain('token-123');
  });

  test('explains timeouts, error statuses, non-JSON and oversized replies', async () => {
    const { run } = createRunner();
    expect(await run(request({ url: `${base}/slow`, timeoutMs: 200 }))).toEqual({
      ok: false,
      detail: '查询超时（200 毫秒没有返回）',
    });
    expect(await run(request({ url: `${base}/error` }))).toEqual({ ok: false, detail: '接口返回 503' });
    expect(await run(request({ url: `${base}/html` }))).toEqual({ ok: false, detail: '接口返回的不是 JSON' });
    const huge = await run(request({ url: `${base}/huge` }));
    expect(huge).toMatchObject({ ok: false, detail: expect.stringContaining('超过') });
  });

  test('refuses anything but http and https and reports unreachable hosts', async () => {
    const { run } = createRunner();
    const file = await run(request({ url: 'file:///etc/passwd' }));
    expect(file).toEqual({ ok: false, detail: '只支持 http 和 https 地址' });
    expect(await run(request({ url: 'http://127.0.0.1:1/x' }))).toEqual({ ok: false, detail: '网络错误，连不上接口' });
  });

  test('logs only the origin, not the path that may contain scanned content', async () => {
    const { run, warnings } = createRunner();
    await run(request({ url: `${base}/error?code=SECRET-ORDER` }));
    expect(warnings[0]).toContain(base);
    expect(warnings[0]).not.toContain('SECRET-ORDER');
  });

  test('reuses a successful reply while it is fresh, and never caches failures', async () => {
    const { run, advance } = createRunner();
    received.length = 0;
    await run(request({ cacheSeconds: 60 }));
    await run(request({ cacheSeconds: 60 }));
    expect(received).toHaveLength(1);
    advance(61_000);
    await run(request({ cacheSeconds: 60 }));
    expect(received).toHaveLength(2);

    received.length = 0;
    await run(request({ url: `${base}/error`, cacheSeconds: 60 }));
    await run(request({ url: `${base}/error`, cacheSeconds: 60 }));
    expect(received).toHaveLength(2);
  });
});
