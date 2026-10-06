import { afterEach, describe, expect, test } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { integerAttr, nameAttr, stringValue } from '../../core/ipp/ipp-attributes';
import { encodeIppMessage } from '../../core/ipp/ipp-codec';
import { GROUP_TAGS, OPERATIONS, STATUS } from '../../core/ipp/ipp-constants';
import { IppJobBook } from '../../core/ipp/ipp-job-book';
import type { ClientDecision } from '../../core/ipp/ipp-operations';
import { attributeIn, ippRequest, MINIMAL_PDF, testPrinter } from '../../core/ipp/testing/ipp-requests';
import { FakeClock } from '../../core/testing/fake-clock';
import { type AcceptedJob, IPP_HTTP_LIMITS, IppHttpServer, requestHost } from './ipp-http-server';
import { basicAuth, sendIpp } from './testing/ipp-client';

const PRINTER = testPrinter();
const servers: IppHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

interface Options {
  password?: string;
  decision?: ClientDecision;
  limits?: Partial<typeof IPP_HTTP_LIMITS>;
}

function createServer(options: Options = {}) {
  const clock = new FakeClock();
  const book = new IppJobBook(clock);
  const accepted: AcceptedJob[] = [];
  const verified: string[] = [];
  let isAllowed = true;
  const server = new IppHttpServer({
    clock,
    printers: () => new Map([[PRINTER.key, PRINTER]]),
    book,
    password: {
      isSet: () => options.password !== undefined,
      verify: async (value) => {
        verified.push(value);
        return value === options.password;
      },
    },
    decisionFor: () => options.decision ?? 'allowed',
    onAccepted: (job) => accepted.push(job),
    fallbackHost: () => '192.168.1.10',
    isAllowedAddress: () => isAllowed,
    limits: options.limits,
    // 测试只在本机回环上开端口。
    ipv4Host: '127.0.0.1',
  });
  servers.push(server);
  return {
    server,
    book,
    accepted,
    verified,
    clock,
    refuseEveryone: () => {
      isAllowed = false;
    },
  };
}

async function start(server: IppHttpServer): Promise<{ base: string; url: string; port: number }> {
  const status = await server.start([0]);
  if (status.state !== 'listening') {
    throw new Error(`not listening: ${JSON.stringify(status)}`);
  }
  const base = `http://127.0.0.1:${status.port}`;
  return { base, url: `${base}/printers/60x40`, port: status.port };
}

/** 带 Expect: 100-continue 发一个请求，记下服务有没有先回 100 再收正文。 */
function sendExpectingContinue(port: number, body: Uint8Array): Promise<{ status: number; continued: boolean }> {
  return new Promise((resolve, reject) => {
    let continued = false;
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/printers/60x40',
        method: 'POST',
        headers: {
          'content-type': 'application/ipp',
          'content-length': String(body.length),
          expect: '100-continue',
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode ?? 0, continued }));
      },
    );
    request.on('continue', () => {
      continued = true;
      request.end(body);
    });
    request.on('error', reject);
  });
}

/**
 * 用裸 TCP 发一段请求，收到连接关闭为止，返回收到的全部文字。
 * 不用 fetch：Bun 1.4 的 fetch 碰到服务端一连上就断开时偶尔会让整个测试进程崩溃（Bun 自己的问题）。
 */
function rawExchange(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    let received = '';
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.on('data', (chunk) => {
      received += chunk.toString();
    });
    socket.on('error', () => undefined);
    socket.on('close', () => resolve(received));
  });
}

describe('IppHttpServer', () => {
  test('answers Get-Printer-Attributes with URIs built from the Host the client used', async () => {
    const { server } = createServer();
    const { url, base } = await start(server);
    const reply = await sendIpp(url, ippRequest(OPERATIONS.getPrinterAttributes));
    expect(reply.httpStatus).toBe(200);
    expect(reply.message?.code).toBe(STATUS.ok);
    const message = reply.message ?? ippRequest(0);
    expect(stringValue(attributeIn(message, GROUP_TAGS.printer, 'printer-name'))).toBe('60×40 标签');
    expect(stringValue(attributeIn(message, GROUP_TAGS.printer, 'printer-uri-supported'))).toBe(
      `${base.replace('http:', 'ipp:')}/printers/60x40`,
    );
  });

  test('accepts a print job and hands the document over', async () => {
    const { server, accepted } = createServer();
    const { url } = await start(server);
    const reply = await sendIpp(
      url,
      ippRequest(OPERATIONS.printJob, { operation: [nameAttr('job-name', '面单')] }),
      MINIMAL_PDF,
    );
    expect(reply.message?.code).toBe(STATUS.ok);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      printer: { key: '60x40' },
      job: { name: '面单', client: '127.0.0.1' },
      needsApproval: false,
    });
    expect(accepted[0]?.document.data).toEqual(MINIMAL_PDF);
  });

  test('answers 404 for a paper that is not shared and 400 for what is not IPP', async () => {
    const { server } = createServer();
    const { base, url } = await start(server);
    expect((await sendIpp(`${base}/printers/100x150`, ippRequest(OPERATIONS.getPrinterAttributes))).httpStatus).toBe(
      404,
    );
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(
      400,
    );
    expect(
      (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/ipp' }, body: 'xx' })).status,
    ).toBe(400);
    expect((await fetch(url, { method: 'PUT' })).status).toBe(405);
  });

  test('asks for the share password before taking or cancelling jobs, but not to describe the printer', async () => {
    const { server, accepted } = createServer({ password: '1234' });
    const { url } = await start(server);
    expect((await sendIpp(url, ippRequest(OPERATIONS.getPrinterAttributes))).httpStatus).toBe(200);
    const anonymous = await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF);
    expect(anonymous.httpStatus).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain('Basic realm=');
    expect(
      (await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF, basicAuth('zhang', 'wrong'))).httpStatus,
    ).toBe(401);
    expect(
      (await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF, basicAuth('zhang', '1234'))).message?.code,
    ).toBe(STATUS.ok);
    expect(
      (await sendIpp(url, ippRequest(OPERATIONS.cancelJob, { operation: [integerAttr('job-id', 1)] }))).httpStatus,
    ).toBe(401);
    expect(accepted).toHaveLength(1);
  });

  test('remembers a good password for a while instead of deriving it on every request', async () => {
    const { server, verified } = createServer({ password: '1234' });
    const { url } = await start(server);
    const auth = basicAuth('zhang', '1234');
    await sendIpp(url, ippRequest(OPERATIONS.getJobs), new Uint8Array(), auth);
    await sendIpp(url, ippRequest(OPERATIONS.getJobs), new Uint8Array(), auth);
    expect(verified).toEqual(['1234']);
  });

  test('locks an address out for a while after repeated wrong passwords', async () => {
    const { server, verified } = createServer({ password: '1234' });
    const { url } = await start(server);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push(
        (await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF, basicAuth('x', `w${attempt}`))).httpStatus,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.at(-1)).toBe(503);
    // 锁住以后不再算摘要：错的密码不会让程序一直花 CPU。
    expect(verified.length).toBeLessThan(7);
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), MINIMAL_PDF, basicAuth('x', '1234'))).httpStatus).toBe(
      503,
    );
  });

  test('refuses a large upload without the password before reading it', async () => {
    const { server, accepted } = createServer({ password: '1234' });
    const { url } = await start(server);
    const big = new Uint8Array(IPP_HTTP_LIMITS.unauthenticatedBytes + 1);
    big.set(MINIMAL_PDF);
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), big)).httpStatus).toBe(401);
    expect(accepted).toEqual([]);
  });

  test('waits for the password check before letting a client send a large body', async () => {
    const { server } = createServer({ password: '1234' });
    const { port } = await start(server);
    const head = encodeIppMessage(ippRequest(OPERATIONS.printJob));
    const big = new Uint8Array(IPP_HTTP_LIMITS.unauthenticatedBytes + head.length);
    big.set(head);
    expect(await sendExpectingContinue(port, big)).toEqual({ status: 401, continued: false });
  });

  test('refuses a document over the limit', async () => {
    const { server, accepted } = createServer({ limits: { requestBytes: 2048 } });
    const { url } = await start(server);
    const big = new Uint8Array(4096);
    big.set(MINIMAL_PDF);
    expect((await sendIpp(url, ippRequest(OPERATIONS.printJob), big)).httpStatus).toBe(413);
    expect(accepted).toEqual([]);
  });

  // 64 条连接各传 50MB 会把内存撑爆：同时在收的正文总量有上限，超过就请对方稍后再来。
  test('says busy when too many bytes are being uploaded at once', async () => {
    const { server, accepted } = createServer({ limits: { inFlightBytes: 2048 } });
    const { url } = await start(server);
    const big = new Uint8Array(4096);
    big.set(MINIMAL_PDF);
    const reply = await sendIpp(url, ippRequest(OPERATIONS.printJob), big);
    expect(reply.httpStatus).toBe(503);
    expect(accepted).toEqual([]);
  });

  test('serves a plain status page to browsers', async () => {
    const { server } = createServer();
    const { url } = await start(server);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await response.text()).toContain('60×40 标签');
  });

  test('drops connections from addresses outside the LAN', async () => {
    const { server, refuseEveryone } = createServer();
    const { url, port } = await start(server);
    refuseEveryone();
    expect(await rawExchange(port, `GET ${new URL(url).pathname} HTTP/1.1\r\nHost: x\r\n\r\n`)).toBe('');
  });
});

describe('requestHost', () => {
  test('uses the Host the client sent, adds the port, and falls back for odd values', () => {
    expect(requestHost('192.168.1.10:8631', 8631, '10.0.0.1')).toBe('192.168.1.10:8631');
    expect(requestHost('labelflash-1a2b.local', 8631, '10.0.0.1')).toBe('labelflash-1a2b.local:8631');
    expect(requestHost('evil"host', 8631, '10.0.0.1')).toBe('10.0.0.1:8631');
    expect(requestHost(undefined, 8631, '10.0.0.1')).toBe('10.0.0.1:8631');
  });
});
