import type { DecodeReply, DecodeRequest } from './decode-worker';

/** 主线程这一侧：同一时间只送一帧给 worker，忙的时候取景循环直接跳过这一帧。 */
export class Decoder {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly waiting = new Map<number, (text: string | null) => void>();

  constructor(workerUrl: string) {
    // 模块 worker：iOS 15 起支持，和页面的兼容范围一致。
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<DecodeReply>) => {
      const resolve = this.waiting.get(event.data.id);
      this.waiting.delete(event.data.id);
      resolve?.(event.data.text);
    };
  }

  get isBusy(): boolean {
    return this.waiting.size > 0;
  }

  /** 像素缓冲区转交给 worker（不复制），调用后 image 不能再用。 */
  decode(image: ImageData): Promise<string | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      const request: DecodeRequest = { id, image };
      this.worker.postMessage(request, [image.data.buffer]);
    });
  }
}
