import { describe, expect, test } from 'bun:test';
import type { ScanImage } from '../../core/scan/image-text';
import { ImageTextReader, type ImageTextReaderDeps, type OcrEnginePort } from './image-text-reader';

const IMAGE: ScanImage = { jpeg: new Uint8Array([0xff, 0xd8, 0xff]), code: { x: 1, y: 2, size: 3 } };
const BOX = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 0, y: 5 },
] as const;

function harness(overrides: Partial<ImageTextReaderDeps> = {}) {
  const calls: { engines: number; closed: number; inputs: unknown[]; unavailable: number; logs: string[] } = {
    engines: 0,
    closed: 0,
    inputs: [],
    unavailable: 0,
    logs: [],
  };
  const engine: OcrEnginePort = {
    recognize: async (input) => {
      calls.inputs.push(input);
      return { regions: [{ box: [...BOX], text: 'A-1-2-3', recognitionScore: 0.98 }] };
    },
    close: () => {
      calls.closed += 1;
    },
  };
  const reader = new ImageTextReader({
    hasFiles: () => true,
    createEngine: async () => {
      calls.engines += 1;
      return engine;
    },
    decodeJpeg: () => ({ data: new Uint8Array(2 * 3 * 4), width: 2, height: 3 }),
    onUnavailable: () => {
      calls.unavailable += 1;
    },
    now: () => 0,
    log: (line) => calls.logs.push(line),
    record: async () => {},
    ...overrides,
  });
  return { reader, calls };
}

describe('ImageTextReader', () => {
  test('decodes the JPEG and reads it as BGRA with the recognition score', async () => {
    const { reader, calls } = harness();
    expect(await reader.read(IMAGE)).toEqual([{ box: [...BOX], text: 'A-1-2-3', score: 0.98 }]);
    expect(calls.inputs).toEqual([{ data: new Uint8Array(24), width: 2, height: 3, stride: 8, pixelFormat: 'BGRA' }]);
  });

  test('creates the engine once for every read', async () => {
    const { reader, calls } = harness();
    reader.warm();
    await reader.read(IMAGE);
    await reader.read(IMAGE);
    expect(calls.engines).toBe(1);
  });

  test('cannot read without the addon and models', async () => {
    const { reader, calls } = harness({ hasFiles: () => false });
    expect(reader.canRead()).toBe(false);
    expect(await reader.read(IMAGE)).toBeNull();
    expect(calls.engines).toBe(0);
  });

  // 引擎加载失败（例如缺运行库）：记日志，从此不能读，并通知手机别再截图。
  test('stops reading and says so when the engine cannot load', async () => {
    const { reader, calls } = harness({
      createEngine: async () => {
        throw new Error('找不到 VCRUNTIME140.dll');
      },
    });
    expect(await reader.read(IMAGE)).toBeNull();
    expect(await reader.read(IMAGE)).toBeNull();
    expect(reader.canRead()).toBe(false);
    expect(calls.unavailable).toBe(1);
    expect(calls.logs.some((line) => line.includes('VCRUNTIME140.dll'))).toBe(true);
  });

  // 换了模型档位：旧引擎关掉（正在跑的识别各自持有引擎，不受影响），下一张用新档位的模型。
  test('reset closes the current engine and the next read loads a new one', async () => {
    const { reader, calls } = harness();
    await reader.read(IMAGE);
    reader.reset();
    await Promise.resolve();
    expect(calls.closed).toBe(1);
    await reader.read(IMAGE);
    expect(calls.engines).toBe(2);
  });

  test('reset lets another tier try to load after an engine failed', async () => {
    let attempts = 0;
    const { reader, calls } = harness({
      createEngine: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('模型文件损坏');
        }
        return { recognize: async () => ({ regions: [] }), close: () => {} };
      },
    });
    expect(await reader.read(IMAGE)).toBeNull();
    expect(reader.canRead()).toBe(false);
    reader.reset();
    expect(reader.canRead()).toBe(true);
    expect(await reader.read(IMAGE)).toEqual([]);
    expect(calls.unavailable).toBe(1);
  });

  test('checks the files of the current tier every time', () => {
    let present = true;
    const { reader } = harness({ hasFiles: () => present });
    expect(reader.canRead()).toBe(true);
    present = false;
    expect(reader.canRead()).toBe(false);
  });

  // 货架号认不出时要看手机实际拍到了什么：每次识别都记下读到的文字，并把图和结果交出去存样本。
  test('logs what was read and hands the image and texts to the sample store', async () => {
    const recorded: unknown[] = [];
    const { reader, calls } = harness({ record: async (image, regions) => void recorded.push({ image, regions }) });
    await reader.read(IMAGE);
    expect(calls.logs).toContain('[ocr] read 1 texts in 0 ms: "A-1-2-3" 0.98');
    expect(recorded).toEqual([{ image: IMAGE, regions: [{ box: [...BOX], text: 'A-1-2-3', score: 0.98 }] }]);
  });

  test('still returns what was read when the sample cannot be saved', async () => {
    const { reader, calls } = harness({
      record: async () => {
        throw new Error('磁盘满了');
      },
    });
    expect(await reader.read(IMAGE)).toEqual([{ box: [...BOX], text: 'A-1-2-3', score: 0.98 }]);
    await Promise.resolve();
    expect(calls.logs.some((line) => line.includes('磁盘满了'))).toBe(true);
  });

  test('reports an image that cannot be decoded', async () => {
    const { reader } = harness({ decodeJpeg: () => null });
    await expect(reader.read(IMAGE)).rejects.toThrow('标签图解不开');
  });
});
