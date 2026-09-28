/**
 * 连接中转服务的 WebSocket：断线自动重连，应用层心跳发现半开连接。
 * 电脑（Electron 主进程的全局 WebSocket）和手机（浏览器）共用；WebSocket 和计时器由参数注入，便于测试。
 */
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, RECONNECT_DELAYS_MS } from './mobile-protocol';

/**
 * 浏览器 WebSocket 和 Node 24 的全局 WebSocket 都满足的最小接口。
 * 两边的事件类型各不相同，处理函数的参数写成 never 才能都放进来；RelaySocket 设置处理函数时再注明它读什么
 * （只读 message 事件的 data）。
 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: never) => void) | null;
  onmessage: ((event: never) => void) | null;
  onclose: ((event: never) => void) | null;
  onerror: ((event: never) => void) | null;
}

interface MessageEventLike {
  data: unknown;
}

export interface SocketTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RelaySocketOptions {
  url: string;
  createSocket: (url: string) => SocketLike;
  timers: SocketTimers;
  onOpen: () => void;
  onFrame: (text: string) => void;
  /** 每次断线只报一次；连续重连失败不重复报，直到重新连上。 */
  onDown: () => void;
}

/** WebSocket.OPEN。 */
const OPEN = 1;
const CLOSE_NORMAL = 1000;
/** 心跳超时由客户端主动关闭：4000–4999 是应用自定义的关闭码。 */
const CLOSE_HEARTBEAT_TIMEOUT = 4000;

export class RelaySocket {
  private socket: SocketLike | null = null;
  private isStopped = true;
  private hasReportedDown = false;
  private attempt = 0;
  private heartbeatTimer: unknown = null;
  private deadlineTimer: unknown = null;
  private retryTimer: unknown = null;

  constructor(private readonly options: RelaySocketOptions) {}

  get isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  start(): void {
    if (!this.isStopped) {
      return;
    }
    this.isStopped = false;
    this.hasReportedDown = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.isStopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(CLOSE_NORMAL, 'stopped');
  }

  send(frame: object): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private connect(): void {
    let socket: SocketLike;
    try {
      socket = this.options.createSocket(this.options.url);
    } catch (error) {
      console.error('[RelaySocket] cannot create socket', error);
      this.handleDown();
      return;
    }
    this.socket = socket;
    // 旧连接的事件可能在新连接建立后才到：只处理当前这个连接的事件。
    socket.onopen = () => {
      if (socket === this.socket) {
        this.attempt = 0;
        this.hasReportedDown = false;
        this.scheduleHeartbeat();
        this.options.onOpen();
      }
    };
    socket.onmessage = (event: MessageEventLike) => {
      if (socket !== this.socket) {
        return;
      }
      // 收到任何一帧都说明连接还活着。
      this.clearTimer('deadlineTimer');
      if (typeof event.data === 'string') {
        this.options.onFrame(event.data);
      }
    };
    socket.onclose = () => {
      if (socket === this.socket) {
        this.handleDown();
      }
    };
    // 出错之后一定会触发 close，统一在 onclose 里处理。
    socket.onerror = () => {};
  }

  private scheduleHeartbeat(): void {
    this.heartbeatTimer = this.options.timers.setTimeout(() => {
      this.send({ t: 'ping' });
      this.deadlineTimer = this.options.timers.setTimeout(() => this.dropSilentSocket(), HEARTBEAT_TIMEOUT_MS);
      this.scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** 半开连接（对端已经不在，本机还没发现）可能很久都不触发 close：直接当作断线处理。 */
  private dropSilentSocket(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close(CLOSE_HEARTBEAT_TIMEOUT, 'heartbeat timeout');
    this.handleDown();
  }

  private handleDown(): void {
    this.clearTimers();
    this.socket = null;
    if (this.isStopped) {
      return;
    }
    if (!this.hasReportedDown) {
      this.hasReportedDown = true;
      this.options.onDown();
    }
    // 下标不会越界（取了 min），?? 只是让类型检查满意。
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] ?? RECONNECT_DELAYS_MS[0];
    this.attempt += 1;
    this.retryTimer = this.options.timers.setTimeout(() => this.connect(), delay);
  }

  private clearTimers(): void {
    this.clearTimer('heartbeatTimer');
    this.clearTimer('deadlineTimer');
    this.clearTimer('retryTimer');
  }

  private clearTimer(name: 'heartbeatTimer' | 'deadlineTimer' | 'retryTimer'): void {
    if (this[name] !== null) {
      this.options.timers.clearTimeout(this[name]);
      this[name] = null;
    }
  }
}
