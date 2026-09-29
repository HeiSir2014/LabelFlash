/**
 * 加载本地 OCR 的 Node-API 扩展并创建引擎。用 process.dlopen 按绝对路径加载：主进程的 bundle 里不留
 * 对 .node 的 require（verify:bundle 要求 bundle 自包含），也不依赖 import.meta。类型取自 native/ocr/node。
 */
import type { OcrEngineOptions } from '../../../native/ocr/node/src/index';
import type { OcrEnginePort } from './image-text-reader';

interface NativeAddon {
  createEngine(config: Omit<OcrEngineOptions, 'addonPath'>): Promise<OcrEnginePort & { close(): void }>;
}

export async function createOcrEngine(
  addonPath: string,
  options: Omit<OcrEngineOptions, 'addonPath'>,
): Promise<OcrEnginePort> {
  const module = { exports: {} as unknown };
  process.dlopen(module, addonPath);
  return (module.exports as NativeAddon).createEngine(options);
}
