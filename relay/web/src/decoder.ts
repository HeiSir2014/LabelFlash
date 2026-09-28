/**
 * 主线程这一侧的解码器：同一时间只送一帧给 worker，忙的时候取景循环直接跳过这一帧。
 *
 * - worker 加载好 wasm 之前请求先排着，加载时间（弱网下可能好几秒）不算进单帧的时限；
 * - 一帧超过时限还没结果，说明 worker 卡住了：结束它、重开一个；连续卡住就判定识别组件坏了；
 * - wasm 或 worker 脚本加载失败：判定识别组件坏了，页面提示刷新，改用手动输入。
 */
import type { DecodeRequest, WorkerReply } from './decode-worker';

/** phone-controller 用到的解码能力；测试里换成假的。 */
export interface DecoderPort {
  readonly isBusy: boolean;
  /** 解不出码时为 null；识别组件坏了时抛错。像素缓冲区会转交给 worker，调用后 image 不能再用。 */
  decode(image: ImageData): Promise<string | null>;
  dispose(): void;
}

/** 单帧解码的时限：正常几十到几百毫秒，慢手机上 tryHarder 也不到一秒。 */
const DECODE_TIMEOUT_MS = 5_000;
/** 连续卡住几次就不再重开 worker：再开也是一样。 */
const MAX_RESTARTS = 2;

interface Request {
  id: number;
  image: ImageData;
  resolve: (text: string | null) => void;
  reject: (error: Error) => void;
  timer: number | null;
}

export class Decoder implements DecoderPort {
  private worker: Worker | null = null;
  private status: 'loading' | 'ready' | 'failed' = 'loading';
  private readonly waiting: Request[] = [];
  private current: Request | null = null;
  private nextId = 1;
  private restarts = 0;

  /** onStatus：wasm 加载好了（ready）或者识别组件坏了（failed）。 */
  constructor(
    private readonly workerUrl: string,
    private readonly onStatus: (status: 'ready' | 'failed') => void,
  ) {
    this.spawn();
  }

  get isBusy(): boolean {
    return this.status !== 'ready' || this.current !== null || this.waiting.length > 0;
  }

  decode(image: ImageData): Promise<string | null> {
    if (this.status === 'failed') {
      return Promise.reject(new Error('识别组件没能加载'));
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ id: this.nextId++, image, resolve, reject, timer: null });
      this.pump();
    });
  }

  dispose(): void {
    this.fail('disposed', false);
  }

  private spawn(): void {
    this.status = 'loading';
    // 模块 worker：iOS 15 起支持，和页面的兼容范围一致。
    const worker = new Worker(this.workerUrl, { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (worker === this.worker) {
        this.receive(event.data);
      }
    };
    // worker 脚本本身加载失败（404、CSP）或抛出未捕获的错误。
    worker.onerror = (event) => {
      event.preventDefault();
      if (worker === this.worker) {
        this.fail(event.message || 'worker error', true);
      }
    };
    this.worker = worker;
  }

  private receive(reply: WorkerReply): void {
    switch (reply.type) {
      case 'ready':
        this.status = 'ready';
        this.onStatus('ready');
        this.pump();
        return;
      case 'failed':
        this.fail(reply.message, true);
        return;
      case 'decoded': {
        const request = this.current;
        if (request?.id !== reply.id) {
          return;
        }
        this.finish(request);
        this.restarts = 0;
        request.resolve(reply.text);
        this.pump();
        return;
      }
    }
  }

  private pump(): void {
    if (this.status !== 'ready' || this.current !== null || !this.worker) {
      return;
    }
    const request = this.waiting.shift();
    if (!request) {
      return;
    }
    this.current = request;
    request.timer = window.setTimeout(() => this.timeOut(request), DECODE_TIMEOUT_MS);
    const message: DecodeRequest = { id: request.id, image: request.image };
    this.worker.postMessage(message, [request.image.data.buffer]);
  }

  private timeOut(request: Request): void {
    if (this.current !== request) {
      return;
    }
    this.finish(request);
    request.resolve(null);
    if (this.restarts >= MAX_RESTARTS) {
      this.fail('decoding keeps timing out', true);
      return;
    }
    this.restarts += 1;
    console.warn('[Decoder] decoding timed out, restarting the worker');
    this.worker?.terminate();
    this.spawn();
  }

  private finish(request: Request): void {
    if (request.timer !== null) {
      window.clearTimeout(request.timer);
    }
    this.current = null;
  }

  private fail(reason: string, report: boolean): void {
    if (this.status === 'failed') {
      return;
    }
    if (report) {
      console.error(`[Decoder] ${reason}`);
    }
    this.status = 'failed';
    this.worker?.terminate();
    this.worker = null;
    const pending = [...(this.current ? [this.current] : []), ...this.waiting.splice(0)];
    for (const request of pending) {
      this.finish(request);
      request.reject(new Error(`识别组件不可用：${reason}`));
    }
    if (report) {
      this.onStatus('failed');
    }
  }
}
