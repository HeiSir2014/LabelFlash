import { createHash } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  type DecodedIpp,
  decodeIppMessage,
  encodeIppMessage,
  IPP_DECODE_LIMITS,
  IppDecodeError,
} from '../../core/ipp/ipp-codec';
import { OPERATIONS } from '../../core/ipp/ipp-constants';
import type { IppJobBook } from '../../core/ipp/ipp-job-book';
import { type AcceptedPrint, type ClientDecision, handleIppRequest } from '../../core/ipp/ipp-operations';
import type { SharedPrinter } from '../../core/ipp/shared-printer';
import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import type { Clock } from '../../core/types';
import { BRAND } from '../../shared/brand';
import { DEFAULT_IPP_PORT } from '../../shared/ipp-sharing';
import { isLoopbackAddress, plainAddress } from '../api/network';
import { RateLimiter } from '../api/rate-limiter';
import { HttpListener, type ListenStatus } from '../net/http-listener';
import { printerListPage, printerPage } from './ipp-pages';
import { parseBasicAuth } from './share-password';

export const IPP_HTTP_LIMITS = {
  /** 没带（或带错）共享密码时最多收 64KB：够 Get-Printer-Attributes 这类查询，挡住没认证的大文档。 */
  unauthenticatedBytes: IPP_DECODE_LIMITS.headerBytes,
  /** 一个请求最多 = 文档上限（和 PDF 打印一样 50MB）+ 属性部分 64KB。 */
  requestBytes: PDF_LIMITS.fileBytes + IPP_DECODE_LIMITS.headerBytes,
  /**
   * 所有连接同时在收的正文加起来最多两个最大的请求（约 100MB）：64 条连接各传 50MB 会把主进程的内存撑爆；
   * 正常只有一两台电脑同时打印，碰不到。
   */
  inFlightBytes: 2 * (PDF_LIMITS.fileBytes + IPP_DECODE_LIMITS.headerBytes),
} as const;
/** 默认端口被占用时依次试 10 个：8631–8640。 */
const FALLBACK_PORT_COUNT = 10;
export const DEFAULT_IPP_PORTS: readonly number[] = Array.from(
  { length: FALLBACK_PORT_COUNT },
  (_, index) => DEFAULT_IPP_PORT + index,
);
/** 一个请求最长 2 分钟（含上传）：50MB 在慢的 Wi-Fi（约 3MB/s）上也要 20 秒上下，留足余量；挡住慢速连接一直占着。 */
const REQUEST_TIMEOUT_MS = 120_000;
/** 同时最多 64 条连接：几台电脑的打印队列每台只开一两条。 */
const MAX_CONNECTIONS = 64;
/** 每个地址每秒 20 个请求、突发 40 个：打印队列每秒查一两次任务状态，加上查打印机，远用不到。 */
const ADDRESS_LIMITS = { perSecond: 20, burst: 40 };
/** 密码错 5 次之后，每错一次锁 10 秒：正常输错几次不受影响，挡住逐个猜。 */
const AUTH_FAILURE_LIMITS = { perSecond: 0.1, burst: 5 };
const LOCKOUT_MS = 10_000;
const MS_PER_SECOND = 1_000;
/** 密码对了按「地址 + 认证头的摘要」记 10 分钟：打印队列每个请求都带认证头，不必每次都算 scrypt。 */
const VERIFIED_AUTH_MS = 10 * 60_000;
/** 记住的认证、锁定超过这么多条就清掉过期的。 */
const PRUNE_SIZE = 256;
const BYTES_PER_MB = 1024 * 1024;
/** 被限速时让对方 5 秒后再来。 */
const RETRY_AFTER_SECONDS = 5;
const PRINTER_PATH = /^\/printers\/(\d{1,3}(?:\.\d)?x\d{1,3}(?:\.\d)?)(?:\/jobs\/([1-9]\d{0,9}))?\/?$/;
const HOST_PATTERN = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
const HOST_WITH_PORT = /:\d{1,5}$/;
const IPP_CONTENT_TYPE = 'application/ipp';
/**
 * 设了共享密码时要密码的操作：除了查打印机本身（添加打印机时还没输密码），全都要。
 * 查任务也要：任务名、自称用户会泄露谁在打什么；而「只看自己交的任务」按地址分，NAT 后面的几台电脑地址相同。
 */
const OPERATIONS_NEEDING_PASSWORD: ReadonlySet<number> = new Set([
  OPERATIONS.printJob,
  OPERATIONS.validateJob,
  OPERATIONS.cancelJob,
  OPERATIONS.getJobs,
  OPERATIONS.getJobAttributes,
]);
const HTTP = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  methodNotAllowed: 405,
  tooLarge: 413,
  internal: 500,
  unavailable: 503,
} as const;
const PAGE_HEADERS = {
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  'x-content-type-options': 'nosniff',
} as const;

/** 收下的打印任务和它要打到的共享打印机。 */
export interface AcceptedJob extends AcceptedPrint {
  printer: SharedPrinter;
}

/** IppHttpServer 的依赖。 */
export interface IppHttpServerDeps {
  clock: Clock;
  /** 现在共享着的打印机（按纸张键），状态是实时的。 */
  printers: () => ReadonlyMap<string, SharedPrinter>;
  book: IppJobBook;
  password: { isSet(): boolean; verify(password: string): Promise<boolean> };
  decisionFor: (address: string) => ClientDecision;
  onAccepted: (job: AcceptedJob) => void;
  /** 请求没带合规的 Host 时网址里用的主机（这台电脑的第一个局域网地址）。 */
  fallbackHost: () => string;
  /** 只接受这些地址来的连接（IppSharing 给的是「和选中的局域网网卡同一网段」）。 */
  isAllowedAddress: (address: string | undefined) => boolean;
  /** 测试里调小。 */
  limits?: Partial<typeof IPP_HTTP_LIMITS> | undefined;
  /** 绑定的 IPv4 地址，默认 0.0.0.0；测试和 E2E 用 127.0.0.1，不在局域网上开端口。 */
  ipv4Host?: string | undefined;
}

type AuthState = 'not-required' | 'ok' | 'missing' | 'wrong' | 'locked';
type BodyResult = { status: 'ok'; body: Uint8Array } | { status: 'too-large' } | { status: 'busy' };

/** 对方中途断开：不当作程序出错写日志。 */
class ClientGoneError extends Error {}

/**
 * 网址里的主机：用对方请求时的 Host（它就是用这个地址连上来的）；没带端口补上实际端口；
 * 不合规（可能是伪造的）时用这台电脑的局域网地址。
 */
export function requestHost(host: string | undefined, localPort: number, fallback: string): string {
  if (host === undefined || !HOST_PATTERN.test(host)) {
    return `${fallback}:${localPort}`;
  }
  return HOST_WITH_PORT.test(host) && !host.endsWith(']') ? host : `${host}:${localPort}`;
}

/**
 * 局域网共享的 IPP 服务（RFC 8010 §4：IPP over HTTP）。只监听 IPv4；连接一建立就按地址过滤；
 * 先认证再读正文；属性部分、文档大小、同时在收的总量、速率、时长都有上限。业务都在 core 的 handleIppRequest 里，
 * 对方能做的只有那六个操作：碰不到程序的别的功能。
 */
export class IppHttpServer {
  private readonly listener: HttpListener;
  private readonly limits: typeof IPP_HTTP_LIMITS;
  private readonly addressLimiter: RateLimiter;
  private readonly authFailures: RateLimiter;
  private readonly lockedUntil = new Map<string, number>();
  private readonly verified = new Map<string, number>();
  /** 每个地址正在算的那一次摘要（认证头的摘要和结果）。 */
  private readonly verifying = new Map<string, { cacheKey: string; result: Promise<boolean> }>();
  private startedAt = 0;
  /** 所有连接正在收的正文字节数。 */
  private inFlightBytes = 0;

  constructor(private readonly deps: IppHttpServerDeps) {
    this.limits = { ...IPP_HTTP_LIMITS, ...deps.limits };
    this.addressLimiter = new RateLimiter(deps.clock, ADDRESS_LIMITS);
    this.authFailures = new RateLimiter(deps.clock, AUTH_FAILURE_LIMITS);
    this.listener = new HttpListener({
      logTag: '[ipp]',
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxConnections: MAX_CONNECTIONS,
      onRequest: (request, response) => void this.serve(request, response, false),
      configure: (server) => this.configure(server),
      ipv4Host: deps.ipv4Host,
    });
  }

  get status(): ListenStatus {
    return this.listener.status;
  }

  port(): number | null {
    return this.listener.port();
  }

  /** 只监听 IPv4（0.0.0.0）：mDNS 只广播 A 记录，Windows 按地址添加也用 IPv4。 */
  start(ports: readonly number[]): Promise<ListenStatus> {
    this.startedAt = this.deps.clock.now();
    return this.listener.start('ipv4', ports);
  }

  async stop(): Promise<void> {
    this.forgetCredentials();
    await this.listener.stop();
  }

  /** 共享密码改了：记住的认证全部作废。 */
  forgetCredentials(): void {
    this.verified.clear();
    this.lockedUntil.clear();
  }

  private configure(server: Server): void {
    // 不是这台电脑所在网段来的连接一个字节都不读：防火墙没拦住的公网、别的网段、VPN 地址到这里为止。
    // 监听的仍是 0.0.0.0 而不是逐块网卡绑：笔记本换 Wi-Fi、DHCP 换地址时逐个绑的地址会失效，
    // 要跟着重绑；按连接时的网卡列表核对子网，地址变了也立刻生效。
    // 本机回环例外放进来：监听后的自检（HttpListener 从 127.0.0.1 请求自己）要能连上；回环来的其余请求在 serve 里断开。
    server.on('connection', (socket) => {
      if (!this.deps.isAllowedAddress(socket.remoteAddress) && !isLoopbackAddress(socket.remoteAddress)) {
        socket.destroy();
      }
    });
    // 带 Expect: 100-continue 的请求（大文档）：先看过认证和大小，再让对方发正文。
    server.on('checkContinue', (request, response) => void this.serve(request, response, true));
  }

  private async serve(request: IncomingMessage, response: ServerResponse, expectsContinue: boolean): Promise<void> {
    const address = plainAddress(request.socket.remoteAddress ?? '');
    let reserved = 0;
    const reserve = (bytes: number): boolean => {
      if (this.inFlightBytes + bytes > this.limits.inFlightBytes) {
        return false;
      }
      this.inFlightBytes += bytes;
      reserved += bytes;
      return true;
    };
    try {
      // 只有自检能走到这里之前（HttpListener.dispatch 先认它）；不在许可网段的回环连接到这里断开。
      if (!this.deps.isAllowedAddress(request.socket.remoteAddress)) {
        request.socket.destroy();
        return;
      }
      if (!this.addressLimiter.take(address)) {
        sendText(request, response, HTTP.unavailable, '请求太快，请稍后再试', {
          'retry-after': String(RETRY_AFTER_SECONDS),
        });
        return;
      }
      const route = PRINTER_PATH.exec((request.url ?? '/').split('?')[0] ?? '/');
      if (request.method === 'GET' || request.method === 'HEAD') {
        this.servePage(request, response, route?.[1] ?? null);
        return;
      }
      if (request.method !== 'POST') {
        sendText(request, response, HTTP.methodNotAllowed, '这里只接受 IPP 打印请求', { allow: 'GET, HEAD, POST' });
        return;
      }
      const key = route?.[1];
      const printer = key === undefined ? undefined : this.deps.printers().get(key);
      if (key === undefined || printer === undefined) {
        sendText(request, response, HTTP.notFound, '没有这台共享打印机');
        return;
      }
      if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith(IPP_CONTENT_TYPE)) {
        sendText(request, response, HTTP.badRequest, '只接受 application/ipp');
        return;
      }
      const auth = await this.authenticate(request, address);
      if (auth === 'locked') {
        sendText(request, response, HTTP.unavailable, '共享密码输错太多次：稍后再试', {
          'retry-after': String(LOCKOUT_MS / MS_PER_SECOND),
        });
        return;
      }
      const isTrusted = auth === 'ok' || auth === 'not-required';
      const limit = isTrusted ? this.limits.requestBytes : this.limits.unauthenticatedBytes;
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) {
        this.refuseLarge(request, response, isTrusted);
        return;
      }
      if (Number.isFinite(declared) && !reserve(declared)) {
        this.refuseBusy(request, response);
        return;
      }
      if (expectsContinue) {
        response.writeContinue();
      }
      // 声明了长度的已经整块预留；没声明的（分块传输）边收边预留。
      const read = await readBody(request, limit, Number.isFinite(declared) ? () => true : reserve);
      if (read.status === 'too-large') {
        this.refuseLarge(request, response, isTrusted);
        return;
      }
      if (read.status === 'busy') {
        this.refuseBusy(request, response);
        return;
      }
      const body = read.body;
      let decoded: DecodedIpp;
      try {
        decoded = decodeIppMessage(body);
      } catch (error) {
        if (error instanceof IppDecodeError) {
          sendText(request, response, HTTP.badRequest, '请求不是合规的 IPP');
          return;
        }
        throw error;
      }
      if (this.deps.password.isSet() && OPERATIONS_NEEDING_PASSWORD.has(decoded.message.code) && auth !== 'ok') {
        this.challenge(request, response);
        return;
      }
      const host = requestHost(request.headers.host, request.socket.localPort ?? 0, this.deps.fallbackHost());
      const outcome = handleIppRequest(decoded.message, body.subarray(decoded.dataOffset), {
        printer,
        printerUri: `ipp://${host}/printers/${key}`,
        moreInfoUri: `http://${host}/printers/${key}`,
        authentication: this.deps.password.isSet() ? 'basic' : 'none',
        client: address,
        decision: this.deps.decisionFor(address),
        book: this.deps.book,
        pathJobId: route?.[2] === undefined ? null : Number(route[2]),
        startedAt: this.startedAt,
        nowMs: this.deps.clock.now(),
      });
      send(request, response, HTTP.ok, IPP_CONTENT_TYPE, encodeIppMessage(outcome.response));
      if (outcome.accepted !== null) {
        this.deps.onAccepted({ ...outcome.accepted, printer });
      }
    } catch (error) {
      if (error instanceof ClientGoneError) {
        return;
      }
      console.error(`[ipp] ${request.method ?? '?'} ${request.url ?? '?'} from ${address} failed`, error);
      sendText(request, response, HTTP.internal, '程序内部错误，已写入共享打印机那台电脑的日志');
    } finally {
      // 收下的文档由任务表（最多 4 个）管着，不再算「正在收」。
      this.inFlightBytes -= reserved;
    }
  }

  private servePage(request: IncomingMessage, response: ServerResponse, key: string | null): void {
    const printers = this.deps.printers();
    const path = (request.url ?? '/').split('?')[0];
    const printer = key === null ? undefined : printers.get(key);
    const html =
      path === '/' ? printerListPage([...printers.values()]) : printer === undefined ? null : printerPage(printer);
    if (html === null) {
      sendText(request, response, HTTP.notFound, '没有这台共享打印机');
      return;
    }
    send(request, response, HTTP.ok, 'text/html; charset=utf-8', new TextEncoder().encode(html), PAGE_HEADERS);
  }

  /** 认证头：没设密码不用认；对了按「地址 + 认证头摘要」记 10 分钟；错多了锁一会儿（锁着的时候不再算摘要）。 */
  private async authenticate(request: IncomingMessage, address: string): Promise<AuthState> {
    if (!this.deps.password.isSet()) {
      return 'not-required';
    }
    const header = request.headers.authorization;
    const credentials = parseBasicAuth(header);
    if (header === undefined || credentials === null) {
      return 'missing';
    }
    const now = this.deps.clock.now();
    const cacheKey = `${address}\n${createHash('sha256').update(header).digest('hex')}`;
    if ((this.verified.get(cacheKey) ?? 0) > now) {
      return 'ok';
    }
    if ((this.lockedUntil.get(address) ?? 0) > now) {
      return 'locked';
    }
    // 同一个地址同一时间只算一次摘要：同样的认证头等着那一次的结果；换着密码并发来猜的，在算之前就记一次尝试并拒绝。
    // 不这样的话，「先查锁、算完再记失败」之间并发的几十个猜测全都会被算一遍，锁形同虚设。
    const inFlight = this.verifying.get(address);
    if (inFlight !== undefined) {
      if (inFlight.cacheKey === cacheKey) {
        return (await inFlight.result) ? 'ok' : 'wrong';
      }
      return this.countAttempt(address, now) ? 'wrong' : 'locked';
    }
    // 先记一次尝试再算：猜的次数和算的次数一样多，不会多。
    if (!this.countAttempt(address, now)) {
      return 'locked';
    }
    const result = this.deps.password.verify(credentials.password);
    this.verifying.set(address, { cacheKey, result });
    try {
      if (await result) {
        remember(this.verified, cacheKey, now + VERIFIED_AUTH_MS, now);
        return 'ok';
      }
      return 'wrong';
    } finally {
      this.verifying.delete(address);
    }
  }

  /** 记一次认证尝试；超过限额就锁住这个地址一会儿，返回 false。 */
  private countAttempt(address: string, now: number): boolean {
    if (this.authFailures.take(address)) {
      return true;
    }
    remember(this.lockedUntil, address, now + LOCKOUT_MS, now);
    return false;
  }

  private challenge(request: IncomingMessage, response: ServerResponse): void {
    sendText(request, response, HTTP.unauthorized, '需要共享密码', {
      'www-authenticate': `Basic realm="${BRAND.productNameAscii}", charset="UTF-8"`,
    });
  }

  /** 没认证的大请求先要密码；认证过的说明文档太大。 */
  private refuseLarge(request: IncomingMessage, response: ServerResponse, isTrusted: boolean): void {
    if (!isTrusted) {
      this.challenge(request, response);
      return;
    }
    sendText(
      request,
      response,
      HTTP.tooLarge,
      `文档超过 ${PDF_LIMITS.fileBytes / BYTES_PER_MB}MB：拆成几个小一点的再打`,
    );
  }

  private refuseBusy(request: IncomingMessage, response: ServerResponse): void {
    sendText(request, response, HTTP.unavailable, '共享打印机正在接收别的文档：稍后再试', {
      'retry-after': String(RETRY_AFTER_SECONDS),
    });
  }
}

/** 记一条到期时间；表太大时先清掉过期的（局域网里换着地址来的请求不能让它一直涨）。 */
function remember(map: Map<string, number>, key: string, until: number, now: number): void {
  if (map.size >= PRUNE_SIZE) {
    for (const [entry, expiry] of map) {
      if (expiry <= now) {
        map.delete(entry);
      }
    }
  }
  map.set(key, until);
}

/**
 * 读正文：超过 limit 返回 too-large、同时在收的总量不够返回 busy（都不再收剩下的）；
 * 对方中途断开抛 ClientGoneError。
 */
function readBody(request: IncomingMessage, limit: number, reserve: (bytes: number) => boolean): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let isDone = false;
    const stop = (result: BodyResult) => {
      isDone = true;
      request.pause();
      resolve(result);
    };
    request.on('data', (chunk: Buffer) => {
      if (isDone) {
        return;
      }
      size += chunk.length;
      if (size > limit) {
        stop({ status: 'too-large' });
        return;
      }
      if (!reserve(chunk.length)) {
        stop({ status: 'busy' });
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('aborted', () =>
      reject(new ClientGoneError('the client disconnected before sending the whole request')),
    );
    request.once('end', () => {
      if (!isDone) {
        isDone = true;
        const joined = Buffer.concat(chunks);
        resolve({ status: 'ok', body: new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength) });
      }
    });
  });
}

/**
 * 发回复。正文没读完（拒绝在读之前）时带 connection: close 并在发完后断开，不再收剩下的数据。
 * HEAD 只发头。
 */
function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Uint8Array,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.destroyed || response.headersSent) {
    return;
  }
  const isComplete = request.complete;
  response.writeHead(status, {
    ...headers,
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
    ...(isComplete ? {} : { connection: 'close' }),
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  if (!isComplete) {
    response.once('finish', () => request.destroy());
  }
}

function sendText(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  text: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  send(request, response, status, 'text/plain; charset=utf-8', new TextEncoder().encode(text), headers);
}
