/**
 * 在 Web Worker 里解码，取景画面不卡顿。wasm 由中转服务自己提供（路径由构建脚本注入）：
 * zxing-wasm 默认从国外 CDN 下载 wasm，国内不稳定，CSP 也不允许。
 * 一启动就开始加载 wasm，加载好了（或失败了）告诉页面，页面据此决定能不能扫码。
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import type { CodeCorners } from './label-crop';
import { barcodeText, READER_OPTIONS } from './reader-options';

/** 相对 worker 自己的地址，由 scripts/relay/build.ts 注入（带内容哈希）。 */
declare const READER_WASM_URL: string;

export interface DecodeRequest {
  id: number;
  image: ImageData;
}

export type WorkerReply =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  /** corners：码的四个角（按码自己的方向），截标签图用；读不出时为 null。 */
  | { type: 'decoded'; id: number; text: string | null; corners: CodeCorners | null };

interface WorkerScope {
  location: Location;
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: WorkerReply): void;
}

const scope = self as unknown as WorkerScope;

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? new URL(READER_WASM_URL, scope.location.href).href : prefix + path,
  },
  fireImmediately: true,
}).then(
  () => scope.postMessage({ type: 'ready' }),
  (error: unknown) => scope.postMessage({ type: 'failed', message: String(error) }),
);

scope.onmessage = async (event) => {
  const { id, image } = event.data;
  try {
    const [result] = await readBarcodes(image, READER_OPTIONS);
    const text = result ? barcodeText(result) : null;
    const corners: CodeCorners | null =
      result && text !== null
        ? {
            topLeft: { x: result.position.topLeft.x, y: result.position.topLeft.y },
            topRight: { x: result.position.topRight.x, y: result.position.topRight.y },
            bottomRight: { x: result.position.bottomRight.x, y: result.position.bottomRight.y },
            bottomLeft: { x: result.position.bottomLeft.x, y: result.position.bottomLeft.y },
          }
        : null;
    scope.postMessage({ type: 'decoded', id, text, corners });
  } catch (error) {
    console.error('[decode-worker] decoding failed', error);
    scope.postMessage({ type: 'decoded', id, text: null, corners: null });
  }
};
