import type { SocketLike, SocketTimers } from '../relay-socket';
import { decodeWire, encodeWire } from '../wire';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** 手动推进的计时器：到期的回调按时间先后执行，回调里新设的计时器同样参与这一轮推进。 */
export class FakeTimers implements SocketTimers {
  private current = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.current + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get now(): number {
    return this.current;
  }

  advance(ms: number): void {
    const end = this.current + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, task] of this.tasks) {
        if (task.at <= end && task.at < nextAt) {
          nextId = id;
          nextAt = task.at;
        }
      }
      if (nextId === null) {
        break;
      }
      const task = this.tasks.get(nextId);
      this.tasks.delete(nextId);
      this.current = nextAt;
      task?.callback();
    }
    this.current = end;
  }
}

/** 由测试驱动的 WebSocket：open / receive / drop 模拟服务端，sent 记录发出的帧。 */
export class FakeSocket implements SocketLike {
  readyState = CONNECTING;
  binaryType = 'blob';
  readonly sent: Uint8Array[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: Uint8Array): void {
    if (this.readyState !== OPEN) {
      throw new Error('socket is not open');
    }
    this.sent.push(data);
  }

  /** 客户端主动关闭：真实的 WebSocket 稍后才触发 onclose，这里不触发，由测试决定。 */
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = CLOSED;
  }

  open(): void {
    this.readyState = OPEN;
    this.onopen?.({});
  }

  /** 收到原样的数据（例如老版本发来的文本帧）。 */
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** 收到一帧：和真实的 WebSocket（binaryType 为 arraybuffer）一样，交出 msgpack 的 ArrayBuffer。 */
  receiveFrame(frame: object): void {
    const bytes = encodeWire(frame);
    this.receive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }

  /** 连接断开（服务端关闭或网络中断）。 */
  drop(): void {
    this.readyState = CLOSED;
    this.onclose?.({});
  }

  /** 发出的帧按 msgpack 解开，方便断言。 */
  frames(): unknown[] {
    return this.sent.map((bytes) => decodeWire(bytes));
  }
}
