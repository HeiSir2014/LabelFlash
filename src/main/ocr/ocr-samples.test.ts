import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageTextRegion, ScanImage } from '../../core/scan/image-text';
import { describeRecognition, OcrSamples } from './ocr-samples';

const IMAGE: ScanImage = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), code: { x: 425, y: 255, size: 170 } };
const BOX = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 0, y: 5 },
] as const;

function region(text: string, score: number): ImageTextRegion {
  return { box: [...BOX], text, score };
}

describe('describeRecognition', () => {
  test('lists every text with its score so a log line shows what was read', () => {
    expect(describeRecognition([region('A-1-2-3', 0.9968), region('尺码：36', 1)], 231.6)).toBe(
      '[ocr] read 2 texts in 232 ms: "A-1-2-3" 1.00 | "尺码：36" 1.00',
    );
  });

  test('says when nothing was read', () => {
    expect(describeRecognition([], 12)).toBe('[ocr] read 0 texts in 12 ms');
  });
});

describe('OcrSamples', () => {
  let dir: string;
  let clock: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cdl-ocr-samples-'));
    clock = Date.UTC(2026, 8, 30, 13, 4, 58, 123);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const samples = (keep = 3) => new OcrSamples(join(dir, 'ocr-samples'), keep, () => clock);

  test('keeps the label image and what was read from it', async () => {
    await samples().save(IMAGE, [region('A-1-2-3', 0.99)]);
    const names = (await readdir(join(dir, 'ocr-samples'))).sort();
    expect(names).toEqual(['20260930-130458-123.jpg', '20260930-130458-123.json']);
    const jpeg = await readFile(join(dir, 'ocr-samples', names[0] as string));
    expect([...jpeg]).toEqual([...IMAGE.jpeg]);
    const json = JSON.parse(await readFile(join(dir, 'ocr-samples', names[1] as string), 'utf8'));
    expect(json).toEqual({ code: IMAGE.code, regions: [region('A-1-2-3', 0.99)] });
  });

  test('keeps only the most recent samples', async () => {
    const store = samples(2);
    for (let index = 0; index < 4; index += 1) {
      clock += 1000;
      await store.save(IMAGE, []);
    }
    const names = (await readdir(join(dir, 'ocr-samples'))).sort();
    expect(names).toEqual([
      '20260930-130501-123.jpg',
      '20260930-130501-123.json',
      '20260930-130502-123.jpg',
      '20260930-130502-123.json',
    ]);
  });

  test('does not overwrite a sample saved in the same millisecond', async () => {
    const store = samples();
    await store.save(IMAGE, []);
    await store.save(IMAGE, []);
    expect(await readdir(join(dir, 'ocr-samples'))).toHaveLength(4);
  });
});
