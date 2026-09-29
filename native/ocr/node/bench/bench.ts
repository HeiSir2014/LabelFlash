/**
 * 最小 benchmark：三种模型组合 × 两种输入（整张照片、手机会截下来的二维码附近一块），
 * 预热后连续识别，报告各阶段耗时的中位数和 p95。
 *   bun run ocr:bench        （Node.js：node native/ocr/node/bench/bench.ts）
 */
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { OcrEngine, type OcrResult, type RecognizeInput } from '../src/index.ts';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const WARMUP_RUNS = 3;
const MEASURED_RUNS = 20;
const PERCENTILE_95 = 0.95;
/** 样张里二维码和货架号所在的一块（手机只会截这么大）。 */
const QR_AREA = { left: 240, top: 190, width: 640, height: 530 };

const COMBINATIONS = [
  { detection: 'tiny', recognition: 'tiny' },
  { detection: 'tiny', recognition: 'small' },
  { detection: 'small', recognition: 'small' },
] as const;

async function load(area?: typeof QR_AREA): Promise<RecognizeInput> {
  let image = sharp(repo('native/ocr/fixtures/shelf-label.jpg'));
  if (area !== undefined) {
    image = image.extract(area);
  }
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, pixelFormat: 'RGBA' };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

function summary(results: OcrResult[], pick: (timing: OcrResult['timing']) => number): string {
  const values = results.map((result) => pick(result.timing));
  return `${percentile(values, 0.5).toFixed(1)} / ${percentile(values, PERCENTILE_95).toFixed(1)}`;
}

const runtime = typeof Bun === 'undefined' ? `Node ${process.version}` : `Bun ${Bun.version}`;
const inputs = [
  { name: '整张照片', input: await load() },
  { name: '二维码附近', input: await load(QR_AREA) },
];

console.log(`${runtime}，intraThreads 4，识别每批 8 行；每格是中位数 / p95（毫秒），各 ${MEASURED_RUNS} 次`);
console.log('| 检测 + 识别 | 输入 | 预处理 | 检测 | 后处理 | 识别 | 总计 | 货架号 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const { detection, recognition } of COMBINATIONS) {
  const engine = await OcrEngine.create({
    detModelPath: repo(`models/${detection}/det.onnx`),
    recModelPath: repo(`models/${recognition}/rec.onnx`),
    dictionaryPath: repo(`models/${recognition}/dict.txt`),
    intraThreads: 4,
    recognitionBatchSize: 8,
  });
  for (const { name, input } of inputs) {
    for (let i = 0; i < WARMUP_RUNS; i += 1) {
      await engine.recognize(input);
    }
    const results: OcrResult[] = [];
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
      results.push(await engine.recognize(input));
    }
    const shelf = results[0]?.regions.find((region) => /-\d+-\d+-\d+$/.test(region.text))?.text ?? '—';
    console.log(
      `| ${detection} + ${recognition} | ${name} ${input.width}×${input.height} | ` +
        `${summary(results, (t) => t.preprocessMs)} | ${summary(results, (t) => t.detectionMs)} | ` +
        `${summary(results, (t) => t.detectionPostprocessMs)} | ${summary(results, (t) => t.recognitionMs)} | ` +
        `${summary(results, (t) => t.totalMs)} | ${shelf} |`,
    );
  }
  engine.close();
}
