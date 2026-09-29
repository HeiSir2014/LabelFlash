/**
 * 本地 OCR 引擎的 TypeScript 包装：Bun 和 Node.js 共用同一个 Node-API 扩展（native/ocr/crates/ocr-addon）。
 * 模型加载和识别都在线程池上执行，不阻塞事件循环。设计：docs/superpowers/specs/2026-09-30-ocr-engine-design.md。
 */
import { fileURLToPath } from 'node:url';
import { addonFileName } from './addon-name.ts';

export type PixelFormat = 'BGRA' | 'RGBA' | 'BGR' | 'RGB';

export interface DetectionOptions {
  /** 缩放时对齐的边长，默认 64（官方 OCR 流水线）。 */
  limitSideLen?: number;
  /** 按短边（min，默认）还是长边（max）对齐 limitSideLen。 */
  limitType?: 'min' | 'max';
  /** 长边上限，默认 4000。 */
  maxSideLimit?: number;
  /** 概率图二值化阈值，默认 0.3。 */
  thresh?: number;
  /** 框内平均概率低于它的框丢掉，默认 0.6。 */
  boxThresh?: number;
  /** 框向外扩的比例，默认 1.5。 */
  unclipRatio?: number;
  /** 最多处理多少个候选区域，默认 3000。 */
  maxCandidates?: number;
}

export interface OcrEngineOptions {
  /** 检测模型（det.onnx）。检测和识别可以用不同档的模型，例如 tiny 检测 + small 识别。 */
  detModelPath: string;
  /** 识别模型（rec.onnx）。 */
  recModelPath: string;
  /** 和识别模型配套的字典（dict.txt）。 */
  dictionaryPath: string;
  /** 一个算子内部用几个线程，默认 4。 */
  intraThreads?: number;
  /** 识别每批几行，默认 8。 */
  recognitionBatchSize?: number;
  detection?: DetectionOptions;
  /** 扩展文件的位置，默认 native/ocr/node/bin 下按平台命名的文件。 */
  addonPath?: string;
}

export interface RecognizeInput {
  /** 像素。识别结束（Promise 结束）之前不要改这块内存：工作线程直接读它，不复制。 */
  data: Uint8Array;
  width: number;
  height: number;
  /** 每行的字节数，默认紧密排列（width × 每像素字节数）。 */
  stride?: number;
  pixelFormat: PixelFormat;
}

export interface OcrPoint {
  x: number;
  y: number;
}

export interface OcrRegion {
  /** 原图坐标，左上、右上、右下、左下。 */
  box: [OcrPoint, OcrPoint, OcrPoint, OcrPoint];
  text: string;
  detectionScore: number;
  recognitionScore: number;
}

export interface OcrResult {
  width: number;
  height: number;
  /** 按阅读顺序排列。 */
  regions: OcrRegion[];
  timing: {
    preprocessMs: number;
    detectionMs: number;
    detectionPostprocessMs: number;
    recognitionMs: number;
    totalMs: number;
  };
}

interface NativeEngine {
  recognize(input: Required<RecognizeInput>): Promise<OcrResult>;
  close(): void;
}

interface Addon {
  createEngine(config: Omit<OcrEngineOptions, 'addonPath'>): Promise<NativeEngine>;
}

const BYTES_PER_PIXEL: Record<PixelFormat, number> = { BGRA: 4, RGBA: 4, BGR: 3, RGB: 3 };

/** 参数校验（和扩展里的一致，出错时在调用处就报出来）；返回补上默认 stride 的输入。 */
export function checkRecognizeInput(input: RecognizeInput): Required<RecognizeInput> {
  const bytesPerPixel = BYTES_PER_PIXEL[input.pixelFormat];
  if (bytesPerPixel === undefined) {
    throw new TypeError(`pixelFormat 只能是 BGRA、RGBA、BGR、RGB，收到 ${String(input.pixelFormat)}`);
  }
  if (!(input.data instanceof Uint8Array)) {
    throw new TypeError('data 要是 Uint8Array 或 Buffer');
  }
  for (const [name, value] of [
    ['width', input.width],
    ['height', input.height],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} 要是正整数，收到 ${value}`);
    }
  }
  const row = input.width * bytesPerPixel;
  const stride = input.stride ?? row;
  if (!Number.isInteger(stride) || stride < row) {
    throw new RangeError(`stride ${stride} 小于一行像素的字节数 ${row}`);
  }
  const required = stride * (input.height - 1) + row;
  if (input.data.byteLength < required) {
    throw new RangeError(
      `像素数据只有 ${input.data.byteLength} 字节，${input.width}×${input.height}、stride ${stride} 至少要 ${required} 字节`,
    );
  }
  return { ...input, stride };
}

function defaultAddonPath(): string {
  return fileURLToPath(new URL(`../bin/${addonFileName(process.platform, process.arch)}`, import.meta.url));
}

const addons = new Map<string, Addon>();

/** 同一个扩展文件只加载一次。用 process.dlopen：Node.js、Bun、Electron 都支持，打包成 CommonJS 也不依赖 import.meta。 */
function loadAddon(path: string): Addon {
  let addon = addons.get(path);
  if (addon === undefined) {
    const module = { exports: {} as unknown };
    process.dlopen(module, path);
    addon = module.exports as Addon;
    addons.set(path, addon);
  }
  return addon;
}

export class OcrEngine {
  private native: NativeEngine | null;

  private constructor(native: NativeEngine) {
    this.native = native;
  }

  /** 加载模型、创建引擎（在线程池上执行）。 */
  static async create(options: OcrEngineOptions): Promise<OcrEngine> {
    const { addonPath, ...config } = options;
    const addon = loadAddon(addonPath ?? defaultAddonPath());
    return new OcrEngine(await addon.createEngine(config));
  }

  /** 识别一张图（在线程池上执行）。 */
  recognize(input: RecognizeInput): Promise<OcrResult> {
    if (this.native === null) {
      return Promise.reject(new Error('引擎已经关闭'));
    }
    try {
      return this.native.recognize(checkRecognizeInput(input));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** 释放模型会话；正在进行的识别会先做完。 */
  close(): void {
    this.native?.close();
    this.native = null;
  }
}
