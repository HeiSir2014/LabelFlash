/**
 * 中转服务的核心：按会话号在电脑和手机的连接之间转发消息。
 *
 * 只转发，不解析内层消息（它是加密的），不写磁盘。会话由电脑持有：中转服务重启后状态全部丢失，
 * 电脑用同一个 ownerSecret 重新 open、手机重新 join 就能继续。
 * 这里是纯逻辑，连接由 Peer 接口注入，Bun.serve 的接线在 server.ts。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../src/core/types';
import {
  CLOSE_CODES,
  DESKTOP_GRACE_MS,
  type DesktopFrame,
  type EndReason,
  FIRST_FRAME_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_PENDING_JOBS,
  MAX_PHONES_PER_SESSION,
  MOBILE_PROTOCOL_VERSION,
  type PhoneFrame,
  parseDesktopFrame,
  parsePhoneFrame,
  type RelayErrorCode,
  type RelayToDesktop,
  type RelayToPhone,
} from '../../src/shared/mobile-protocol';
import { decodeWire, encodeWire } from '../../src/shared/wire';
import { TokenBucket } from './token-bucket';

export interface Peer {
  readonly id: string;
  readonly ip: string;
  /** 一帧 msgpack（二进制帧）。 */
  send(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
}

export type PeerRole = 'desktop' | 'phone';

export interface HubLimits {
  maxSessions: number;
  maxConnections: number;
  maxPhonesPerSession: number;
  maxConnectionsPerIp: number;
}

export interface HubDeps {
  clock: Clock;
  log: (line: string) => void;
  limits?: Partial<HubLimits>;
}

/**
 * 容量按一台和其他服务共用的小型服务器估算：每个连接只占几 KB，远到不了内存上限；
 * 这些数字是防止被刷爆的闸门，不是性能极限。
 */
const DEFAULT_LIMITS: HubLimits = {
  maxSessions: 500,
  maxConnections: 2_000,
  // 电脑最多接纳 MAX_PHONES_PER_SESSION 部手机；翻倍是给刷新页面、换网络时新旧连接短暂重叠，
  // 多出来的连接由电脑拒绝，中转服务只防刷爆。
  maxPhonesPerSession: MAX_PHONES_PER_SESSION * 2,
  // 一家店的所有设备通常共用一个出口 IP。
  maxConnectionsPerIp: 20,
};

/** 手机平均每秒最多 5 帧：正常使用每扫一张只有一帧，加上心跳。 */
const PHONE_FRAMES_PER_SECOND = 5;
/** 手机重新被接纳时一次发出：hello 加上发件箱里所有还没结果的任务；留一倍余量。 */
const PHONE_FRAME_BURST = 2 * (1 + MAX_PENDING_JOBS);
/** 电脑平均每秒最多 50 帧：打印一张最多是一条结果加上每部手机一条排队更新，远低于这个数。 */
const DESKTOP_FRAMES_PER_SECOND = 50;
/** 电脑重连时一次回复所有手机：每部手机的 welcome 加上它每个任务的进度；留一倍余量。 */
const DESKTOP_FRAME_BURST = 2 * MAX_PHONES_PER_SESSION * (1 + MAX_PENDING_JOBS);
/**
 * 手机平均每秒最多一个最大帧的字节数：一帧可以带同一张标签的几帧图（最大约 1.6 MB），正常扫码一两秒一张、每张几百 KB。
 * 只按帧数限速的话，手机每秒能推 5 个最大帧，服务器扛不住几个这样的连接。
 */
const PHONE_BYTES_PER_SECOND = MAX_FRAME_BYTES;
/** 手机重新被接纳时一次补发发件箱里所有还没结果的任务，每个都可能带一张最大的图。 */
const PHONE_BYTE_BURST = (1 + MAX_PENDING_JOBS) * MAX_FRAME_BYTES;
/** 超出限速累计这么多次就断开：偶尔超出只丢帧，持续刷就关掉。 */
const MAX_RATE_VIOLATIONS = 50;
/** 日志里只记会话号的前几个字符，够排查问题，又不能拿来加入会话。 */
const LOGGED_SESSION_CHARS = 6;

interface Connection {
  peer: Peer;
  role: PeerRole;
  attachedAt: number;
  /** 发出第一帧（open / join）之后才有。 */
  session: string | null;
  bucket: TokenBucket;
  /** 按字节限速（只有手机）。 */
  bytes: TokenBucket | null;
  violations: number;
}

interface Session {
  id: string;
  secretHash: Buffer;
  desktop: Connection | null;
  phones: Map<string, Connection>;
  /** 电脑断线的时间；在线时为 null。 */
  offlineSince: number | null;
}

export class RelayHub {
  private readonly limits: HubLimits;
  private readonly connections = new Map<string, Connection>();
  private readonly sessions = new Map<string, Session>();
  private readonly connectionsPerIp = new Map<string, number>();

  constructor(private readonly deps: HubDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
  }

  /** 还能不能再接一个来自 ip 的连接：升级成 WebSocket 之前先问，满了直接回 HTTP 503。 */
  hasRoom(ip: string): boolean {
    const perIp = this.connectionsPerIp.get(ip) ?? 0;
    return this.connections.size < this.limits.maxConnections && perIp < this.limits.maxConnectionsPerIp;
  }

  /** 超出容量时返回 false，由调用方以 1013 关闭（升级之前已经问过 hasRoom，这里是同时涌入时的最后一道闸）。 */
  attach(peer: Peer, role: PeerRole): boolean {
    if (!this.hasRoom(peer.ip)) {
      this.deps.log(`refused ${role} ip=${peer.ip}: too many connections`);
      return false;
    }
    const perIp = this.connectionsPerIp.get(peer.ip) ?? 0;
    const bucket =
      role === 'phone'
        ? new TokenBucket(PHONE_FRAMES_PER_SECOND, PHONE_FRAME_BURST, this.deps.clock)
        : new TokenBucket(DESKTOP_FRAMES_PER_SECOND, DESKTOP_FRAME_BURST, this.deps.clock);
    // 电脑只转发结果和排队更新，帧都很小，不按字节限速。
    const bytes = role === 'phone' ? new TokenBucket(PHONE_BYTES_PER_SECOND, PHONE_BYTE_BURST, this.deps.clock) : null;
    this.connections.set(peer.id, {
      peer,
      role,
      attachedAt: this.deps.clock.now(),
      session: null,
      bucket,
      bytes,
      violations: 0,
    });
    this.connectionsPerIp.set(peer.ip, perIp + 1);
    return true;
  }

  /** 一帧 msgpack。帧的字节数上限由 server.ts 的 maxPayloadLength 把关，超了连接直接被关掉，到不了这里。 */
  receive(peer: Peer, bytes: Uint8Array): void {
    const connection = this.connections.get(peer.id);
    if (!connection) {
      return;
    }
    if (!connection.bucket.take() || (connection.bytes !== null && !connection.bytes.take(bytes.length))) {
      this.throttle(connection);
      return;
    }
    const frame = decodeWire(bytes);
    if (connection.role === 'desktop') {
      this.receiveFromDesktop(connection, parseDesktopFrame(frame));
    } else {
      this.receiveFromPhone(connection, parsePhoneFrame(frame));
    }
  }

  /** 连接已关闭。可以重复调用。 */
  detach(peer: Peer): void {
    const connection = this.connections.get(peer.id);
    if (!connection) {
      return;
    }
    this.connections.delete(peer.id);
    const perIp = (this.connectionsPerIp.get(peer.ip) ?? 1) - 1;
    if (perIp > 0) {
      this.connectionsPerIp.set(peer.ip, perIp);
    } else {
      this.connectionsPerIp.delete(peer.ip);
    }
    const session = connection.session === null ? undefined : this.sessions.get(connection.session);
    if (!session) {
      return;
    }
    if (connection.role === 'desktop' && session.desktop === connection) {
      session.desktop = null;
      session.offlineSince = this.deps.clock.now();
      this.deps.log(`desktop away session=${short(session.id)}`);
      for (const phone of session.phones.values()) {
        sendTo(phone, { t: 'waiting' });
      }
    } else if (connection.role === 'phone' && session.phones.delete(peer.id)) {
      this.deps.log(`phone left session=${short(session.id)} phone=${peer.id}`);
      if (session.desktop) {
        sendTo(session.desktop, { t: 'left', phone: peer.id });
      }
    }
  }

  /** 每秒调用：第一帧超时、电脑断线超过宽限期。 */
  tick(): void {
    const now = this.deps.clock.now();
    for (const connection of [...this.connections.values()]) {
      if (connection.session === null && now - connection.attachedAt >= FIRST_FRAME_TIMEOUT_MS) {
        this.close(connection, CLOSE_CODES.policy, 'no first frame');
      }
    }
    for (const session of [...this.sessions.values()]) {
      if (session.offlineSince !== null && now - session.offlineSince >= DESKTOP_GRACE_MS) {
        this.deps.log(`session expired session=${short(session.id)}`);
        this.end(session, 'desktop-gone');
      }
    }
  }

  stats(): { sessions: number; connections: number } {
    return { sessions: this.sessions.size, connections: this.connections.size };
  }

  private receiveFromDesktop(connection: Connection, frame: DesktopFrame | null): void {
    if (frame === null) {
      this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
      return;
    }
    if (connection.session === null) {
      if (frame.t === 'open') {
        this.open(connection, frame);
      } else {
        this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
      }
      return;
    }
    const session = this.sessions.get(connection.session);
    if (!session || session.desktop !== connection) {
      return;
    }
    switch (frame.t) {
      case 'open':
        this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
        return;
      case 'send': {
        const phone = session.phones.get(frame.phone);
        if (phone) {
          sendTo(phone, { t: 'recv', body: frame.body });
        }
        return;
      }
      case 'kick': {
        const phone = session.phones.get(frame.phone);
        if (phone) {
          sendTo(phone, { t: 'kicked' });
          this.close(phone, CLOSE_CODES.normal, 'kicked');
        }
        return;
      }
      case 'close':
        this.deps.log(`session closed session=${short(session.id)} reason=${frame.reason}`);
        this.end(session, frame.reason);
        return;
      case 'ping':
        sendTo(connection, { t: 'pong' });
        return;
    }
  }

  private receiveFromPhone(connection: Connection, frame: PhoneFrame | null): void {
    if (frame === null) {
      this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
      return;
    }
    if (connection.session === null) {
      if (frame.t === 'join') {
        this.join(connection, frame);
      } else {
        this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
      }
      return;
    }
    switch (frame.t) {
      case 'join':
        this.refuse(connection, 'bad-frame', CLOSE_CODES.policy);
        return;
      case 'send': {
        const desktop = this.sessions.get(connection.session)?.desktop;
        // 电脑不在时丢弃：手机已经收到 waiting，不会在这时发请求。
        if (desktop) {
          sendTo(desktop, { t: 'recv', phone: connection.peer.id, body: frame.body });
        }
        return;
      }
      case 'ping':
        sendTo(connection, { t: 'pong' });
        return;
    }
  }

  private open(connection: Connection, frame: Extract<DesktopFrame, { t: 'open' }>): void {
    if (frame.v !== MOBILE_PROTOCOL_VERSION) {
      this.refuse(connection, 'version', CLOSE_CODES.policy);
      return;
    }
    const secretHash = sha256(frame.secret);
    const existing = this.sessions.get(frame.session);
    if (existing) {
      if (!timingSafeEqual(existing.secretHash, secretHash)) {
        this.deps.log(`session taken session=${short(frame.session)} ip=${connection.peer.ip}`);
        this.refuse(connection, 'session-taken', CLOSE_CODES.policy);
        return;
      }
      this.takeOver(existing, connection);
      return;
    }
    if (this.sessions.size >= this.limits.maxSessions) {
      this.refuse(connection, 'server-busy', CLOSE_CODES.tryLater);
      return;
    }
    this.sessions.set(frame.session, {
      id: frame.session,
      secretHash,
      desktop: connection,
      phones: new Map(),
      offlineSince: null,
    });
    connection.session = frame.session;
    sendTo(connection, { t: 'opened' });
    this.deps.log(`session opened session=${short(frame.session)} ip=${connection.peer.ip}`);
  }

  /** 电脑重连（包括旧连接其实已断、服务端还没发现的半开连接）：新连接接管，旧连接让位。 */
  private takeOver(session: Session, connection: Connection): void {
    const stale = session.desktop;
    session.desktop = connection;
    session.offlineSince = null;
    connection.session = session.id;
    if (stale && stale !== connection) {
      // 先解除旧连接和会话的关系，关闭它时就不会把会话标成离线。
      stale.session = null;
      this.close(stale, CLOSE_CODES.replaced, 'replaced');
    }
    sendTo(connection, { t: 'opened' });
    for (const phone of session.phones.values()) {
      sendTo(connection, { t: 'joined', phone: phone.peer.id });
      sendTo(phone, { t: 'online' });
    }
    this.deps.log(`session resumed session=${short(session.id)} ip=${connection.peer.ip}`);
  }

  private join(connection: Connection, frame: Extract<PhoneFrame, { t: 'join' }>): void {
    if (frame.v !== MOBILE_PROTOCOL_VERSION) {
      this.refuse(connection, 'version', CLOSE_CODES.policy);
      return;
    }
    const session = this.sessions.get(frame.session);
    if (!session) {
      sendTo(connection, { t: 'not-found' });
      this.close(connection, CLOSE_CODES.normal, 'not found');
      return;
    }
    if (session.phones.size >= this.limits.maxPhonesPerSession) {
      this.refuse(connection, 'server-busy', CLOSE_CODES.tryLater);
      return;
    }
    session.phones.set(connection.peer.id, connection);
    connection.session = session.id;
    this.deps.log(`phone joined session=${short(session.id)} phone=${connection.peer.id} ip=${connection.peer.ip}`);
    if (session.desktop) {
      sendTo(connection, { t: 'online' });
      sendTo(session.desktop, { t: 'joined', phone: connection.peer.id });
    } else {
      sendTo(connection, { t: 'waiting' });
    }
  }

  private end(session: Session, reason: EndReason): void {
    this.sessions.delete(session.id);
    for (const phone of session.phones.values()) {
      phone.session = null;
      sendTo(phone, { t: 'ended', reason });
      this.close(phone, CLOSE_CODES.normal, 'session ended');
    }
    if (session.desktop) {
      session.desktop.session = null;
      this.close(session.desktop, CLOSE_CODES.normal, 'session ended');
    }
  }

  private throttle(connection: Connection): void {
    connection.violations += 1;
    if (connection.violations >= MAX_RATE_VIOLATIONS) {
      this.deps.log(`closed flooding ${connection.role} ip=${connection.peer.ip}`);
      this.close(connection, CLOSE_CODES.policy, 'rate limited');
      return;
    }
    sendTo(connection, { t: 'error', code: 'rate-limited' });
  }

  private refuse(connection: Connection, code: RelayErrorCode, closeCode: number): void {
    sendTo(connection, { t: 'error', code });
    this.close(connection, closeCode, code);
  }

  /** 关闭连接并立即从表里移除，不依赖关闭事件回来。 */
  private close(connection: Connection, code: number, reason: string): void {
    connection.peer.close(code, reason);
    this.detach(connection.peer);
  }
}

function sendTo(connection: Connection, frame: RelayToDesktop | RelayToPhone): void {
  connection.peer.send(encodeWire(frame));
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function short(session: string): string {
  return `${session.slice(0, LOGGED_SESSION_CHARS)}…`;
}
