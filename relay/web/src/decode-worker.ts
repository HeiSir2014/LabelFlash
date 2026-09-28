/**
 * 在 Web Worker 里解码，取景画面不卡顿。wasm 由中转服务自己提供（路径由构建脚本注入）：
 * zxing-wasm 默认从国外 CDN 下载 wasm，国内不稳定，CSP 也不允许。
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { barcodeText, READER_OPTIONS } from './reader-options';

/** 相对 worker 自己的地址，由 scripts/relay/build.ts 注入（带内容哈希）。 */
declare const READER_WASM_URL: string;

export interface DecodeRequest {
  id: number;
  image: ImageData;
}

export interface DecodeReply {
  id: number;
  text: string | null;
}

interface WorkerScope {
  location: Location;
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeReply): void;
}

const scope = self as unknown as WorkerScope;

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? new URL(READER_WASM_URL, scope.location.href).href : prefix + path,
  },
});

scope.onmessage = async (event) => {
  const { id, image } = event.data;
  try {
    const [result] = await readBarcodes(image, READER_OPTIONS);
    scope.postMessage({ id, text: result ? barcodeText(result) : null });
  } catch (error) {
    console.error('[decode-worker] decoding failed', error);
    scope.postMessage({ id, text: null });
  }
};
