/**
 * 示例：识别样张上的货架号。Bun 和 Node.js 都能直接运行（同一个扩展）：
 *   bun native/ocr/node/examples/recognize.ts
 *   node native/ocr/node/examples/recognize.ts
 * 先 bun run ocr:models 下载模型、bun run ocr:build 编译扩展。
 * 识别期间用一个 5 毫秒的定时器量事件循环：推理在线程池上跑，定时器应当照常触发。
 */
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { OcrEngine } from '../src/index.ts';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const TICK_MS = 5;
const SHELF_NUMBER = 'A-1-2-3';

const runtime = typeof Bun === 'undefined' ? `Node ${process.version}` : `Bun ${Bun.version}`;

// 样张解码成 RGBA，再换成 BGRA：走一遍程序里 nativeImage 给的格式。
const { data, info } = await sharp(repo('native/ocr/fixtures/shelf-label.jpg'))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const red = data[i] ?? 0;
  data[i] = data[i + 2] ?? 0;
  data[i + 2] = red;
}

const engine = await OcrEngine.create({
  detModelPath: repo('models/tiny/det.onnx'),
  recModelPath: repo('models/small/rec.onnx'),
  dictionaryPath: repo('models/small/dict.txt'),
  intraThreads: 4,
  recognitionBatchSize: 8,
});

let ticks = 0;
let longestGapMs = 0;
let last = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  longestGapMs = Math.max(longestGapMs, now - last);
  last = now;
  ticks += 1;
}, TICK_MS);

const result = await engine.recognize({
  data,
  width: info.width,
  height: info.height,
  pixelFormat: 'BGRA',
});
clearInterval(timer);
engine.close();

console.log(`${runtime}：${result.width}×${result.height}，${result.regions.length} 段文字`);
for (const region of result.regions) {
  const [topLeft] = region.box;
  console.log(
    `  ${JSON.stringify(region.text)}  检测 ${region.detectionScore.toFixed(3)}  识别 ${region.recognitionScore.toFixed(3)}  左上 (${topLeft.x}, ${topLeft.y})`,
  );
}
const { timing } = result;
console.log(
  `  耗时：预处理 ${timing.preprocessMs.toFixed(1)} ms，检测 ${timing.detectionMs.toFixed(1)} ms，` +
    `后处理 ${timing.detectionPostprocessMs.toFixed(1)} ms，识别 ${timing.recognitionMs.toFixed(1)} ms，共 ${timing.totalMs.toFixed(1)} ms`,
);
console.log(`  识别期间定时器触发 ${ticks} 次，最长间隔 ${longestGapMs.toFixed(1)} ms（事件循环没有被阻塞）`);

if (!result.regions.some((region) => region.text === SHELF_NUMBER)) {
  console.error(`没有读出货架号 ${SHELF_NUMBER}`);
  process.exit(1);
}
