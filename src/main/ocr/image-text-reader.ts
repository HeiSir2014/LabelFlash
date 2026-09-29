/**
 * 主进程里读标签图上的字（加工步骤「图中文字识别」用）：解 JPEG、交给本地 OCR 引擎（native/ocr）。
 * 不 import electron：解码、创建引擎都由参数注入，用 bun test 测试；index.ts 负责接上 nativeImage 和扩展。
 */
import type { ImageTextRegion, ScanImage } from '../../core/scan/image-text';

/** 引擎里这里用到的部分（native/ocr/node 的 NativeEngine）。 */
export interface OcrEnginePort {
  recognize(input: {
    data: Uint8Array;
    width: number;
    height: number;
    stride: number;
    pixelFormat: 'BGRA';
  }): Promise<{ regions: ReadonlyArray<{ box: ImageTextRegion['box']; text: string; recognitionScore: number }> }>;
}

/** 解出来的像素：BGRA，紧密排列（Electron nativeImage.toBitmap 在 Windows、macOS 上就是这样）。 */
export interface BgraImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ImageTextSource {
  /** 这台电脑能不能读：不能时不向手机要图，这一步跳过。 */
  canRead(): boolean;
  /** 读出图上的所有文字（按阅读顺序）；不能读时返回 null；图解不开时抛错。 */
  read(image: ScanImage): Promise<ImageTextRegion[] | null>;
  /** 提前加载模型（有这类步骤时启动后在后台做），第一张不用等。 */
  warm(): void;
}

export interface ImageTextReaderDeps {
  /** 扩展和模型文件都在（见 ocr-files.ts）。 */
  hasFiles: boolean;
  createEngine: () => Promise<OcrEnginePort>;
  decodeJpeg: (jpeg: Uint8Array) => BgraImage | null;
  /** 引擎加载失败，从此不能读（手机不该再截图）。 */
  onUnavailable: () => void;
  now: () => number;
  log: (line: string) => void;
}

const BGRA_BYTES = 4;

export class ImageTextReader implements ImageTextSource {
  private engine: Promise<OcrEnginePort> | null = null;
  private hasFailed = false;

  constructor(private readonly deps: ImageTextReaderDeps) {}

  canRead(): boolean {
    return this.deps.hasFiles && !this.hasFailed;
  }

  warm(): void {
    if (this.canRead()) {
      void this.loadEngine();
    }
  }

  async read(image: ScanImage): Promise<ImageTextRegion[] | null> {
    if (!this.canRead()) {
      return null;
    }
    const engine = await this.loadEngine();
    if (engine === null) {
      return null;
    }
    const decoded = this.deps.decodeJpeg(image.jpeg);
    if (decoded === null) {
      throw new Error('标签图解不开');
    }
    const result = await engine.recognize({
      data: decoded.data,
      width: decoded.width,
      height: decoded.height,
      stride: decoded.width * BGRA_BYTES,
      pixelFormat: 'BGRA',
    });
    return result.regions.map((region) => ({ box: region.box, text: region.text, score: region.recognitionScore }));
  }

  /** 引擎只创建一次；创建失败记日志、从此不能读（换文件要重启程序）。 */
  private async loadEngine(): Promise<OcrEnginePort | null> {
    if (this.engine === null) {
      const startedAt = this.deps.now();
      this.engine = this.deps.createEngine();
      // 加载成功记一行：安装版里扩展、运行库、模型是否都找得到，看日志就知道。
      this.engine.then(
        () => this.deps.log(`[ocr] text recognition engine ready in ${Math.round(this.deps.now() - startedAt)} ms`),
        () => {},
      );
    }
    try {
      return await this.engine;
    } catch (error) {
      if (!this.hasFailed) {
        this.hasFailed = true;
        this.deps.log(`[ocr] cannot load the text recognition engine: ${String(error)}`);
        this.deps.onUnavailable();
      }
      return null;
    }
  }
}
