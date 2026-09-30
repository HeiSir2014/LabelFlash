/**
 * 货架号识别的评估：模拟「手机摄像头拍热敏标签 → 扫码页按二维码摆正截图 → 电脑 OCR → 找货架号」整条路，
 * 在几组测试集上比较不同档位的模型（检测 / 识别可以分开选）：读对、读错、耗时、内存。
 *
 * 为什么要模拟：样张是一张清楚的照片，真实扫码时是视频帧：离得远二维码只有一百来像素、对焦不准、光线不匀、
 * 视频压缩。每一步都用程序里真实的代码：扫码页的 cropLabel、电脑端的 findImageText 和默认的货架号正则。
 * 「读错」（读出一个不对的货架号）比「没找到」危险：没找到时手机会提示重扫或手动输入，读错会直接打出错的标签。
 *
 * 用法：bun run ocr:eval [--sets normal,far,blur,dark,tilt,jpeg] [--pairs small/small,medium/medium]
 *                        [--enhance none,clahe,...] [--pixels-per-code 130]
 *                        [--samples 200] [--seed 1] [--frame-scale 1.5] [--no-back-off] [--out <目录>]
 * --enhance：识别前对截图做的增强（ENHANCEMENTS），和 --pairs 交叉组合；用 sharp 做原型，采用哪种再在引擎里实现。
 * --pixels-per-code：截图时每个二维码边长多少像素（电脑向手机要的，现在是 130）。
 * --pairs 是「检测档位/识别档位」，模型放在 models/<档位>/（bun run ocr:models）；需要编好的扩展（bun run ocr:build）。
 * 每个组合在单独的进程里跑，内存各算各的。截图留在 --out 目录里（默认 native/ocr/target/eval），可以打开看。
 * 结论记在货架号识别设计的第 10 节。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { OcrEngine } from '../../native/ocr/node/src/index.ts';
import { type CodeCorners, cropLabel, cropLayout, type Point } from '../../relay/web/src/label-crop';
import {
  BELOW_CODE_AREA,
  findImageText,
  type ImageTextRegion,
  LABEL_AREA,
  SHELF_NUMBER_PATTERN,
} from '../../src/core/scan/image-text';
import { MAX_IMAGE_BYTES } from '../../src/shared/mobile-protocol';

/** 热敏标签机 203 dpi：每毫米 8 个点。标签 60×40 毫米。 */
const DOTS_PER_MM = 8;
const LABEL_MM = { width: 60, height: 40 };
/** 渲染到帧里之前把标签放大两倍（最近邻，保持打印点的样子），缩小到帧里时少一些锯齿。 */
const LABEL_SUPERSAMPLE = 2;
/** 扫码页取帧的基准大小（1280×720）；--frame-scale 1.5 是现在的 1080p 截图。 */
const BASE_FRAME = { width: 1280, height: 720 };
/** 和电脑向手机要的一样（mobile/image-request.ts）；--pixels-per-code 可以改。 */
const DEFAULT_PIXELS_PER_CODE = 130;
/** 看识别置信度门槛的效果：低于门槛的结果当作「没认出」。 */
const SCORE_THRESHOLDS = [0.8, 0.85, 0.9, 0.95] as const;

type SharpImage = ReturnType<typeof sharp>;

/** 识别前的增强候选（sharp 做原型）。 */
const ENHANCEMENTS: Record<string, { title: string; apply: (image: SharpImage) => SharpImage }> = {
  none: { title: '不处理', apply: (image) => image },
  gray: { title: '灰度', apply: (image) => image.greyscale() },
  stretch: { title: '对比度拉伸', apply: (image) => image.normalise({ lower: 1, upper: 99 }) },
  clahe: { title: '局部均衡（CLAHE）', apply: (image) => image.clahe({ width: 64, height: 64, maxSlope: 3 }) },
  'sharpen-light': { title: '轻度锐化', apply: (image) => image.sharpen({ sigma: 0.8 }) },
  sharpen: { title: '较强锐化', apply: (image) => image.sharpen({ sigma: 1.5, m1: 1, m2: 4 }) },
  'stretch-sharpen': {
    title: '拉伸 + 轻度锐化',
    apply: (image) => image.normalise({ lower: 1, upper: 99 }).sharpen({ sigma: 0.8 }),
  },
};
/**
 * 文档扫描类应用的常见处理（在灰度上逐像素做）：
 * - flatten：去阴影、白底。最大值滤波抹掉深色笔画只剩纸，再模糊得到光照背景，原图除以背景，纸变成均匀的白。
 * - flatten-sharpen：去阴影后再轻度锐化。
 * - binarize：自适应二值化（Sauvola），按局部均值和标准差定黑白阈值，即「黑白」模式。
 * - flatten-binarize：先去阴影再二值化。
 */
const DOCUMENT_FILTERS: Record<
  string,
  { title: string; apply: (gray: Uint8Array, width: number, height: number) => Promise<Uint8Array> }
> = {
  flatten: { title: '去阴影（背景平整）', apply: (gray, width, height) => flattenBackground(gray, width, height) },
  'flatten-sharpen': {
    title: '去阴影 + 轻度锐化',
    apply: async (gray, width, height) =>
      new Uint8Array(
        await sharp(await flattenBackground(gray, width, height), { raw: { width, height, channels: 1 } })
          .sharpen({ sigma: 0.8 })
          // 单通道进来，sharp 默认按 sRGB 输出三个通道：只取一个。
          .extractChannel(0)
          .raw()
          .toBuffer(),
      ),
  },
  binarize: { title: '自适应二值化（黑白）', apply: async (gray, width, height) => sauvola(gray, width, height) },
  // 文档扫描类应用的「黑白」多是先增强再二值化：直接在暗、对比度低的图上二值化，细笔画会被当成背景。
  'flatten-binarize': {
    title: '去阴影 + 二值化',
    apply: async (gray, width, height) => sauvola(await flattenBackground(gray, width, height), width, height),
  },
};
/** 去阴影时抹掉笔画的窗口：比笔画粗、比字间距小（截图宽的 1/50，130 像素一个二维码边长时约 16 像素）。 */
const FLATTEN_WINDOW_FRACTION = 1 / 50;
/** Sauvola 的窗口（截图宽的 1/30）和参数（论文里常用的 k = 0.2、R = 128）。 */
const SAUVOLA_WINDOW_FRACTION = 1 / 30;
const SAUVOLA_K = 0.2;
const SAUVOLA_R = 128;

/** 一维最大值滤波（横、竖各做一次就是方形窗口）。 */
function maxFilter(source: Uint8Array, width: number, height: number, radius: number, horizontal: boolean): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let d = -radius; d <= radius; d += 1) {
        const xx = horizontal ? Math.min(width - 1, Math.max(0, x + d)) : x;
        const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + d));
        max = Math.max(max, source[yy * width + xx] ?? 0);
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

async function flattenBackground(gray: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const radius = Math.max(2, Math.round((width * FLATTEN_WINDOW_FRACTION) / 2));
  const paper = maxFilter(maxFilter(gray, width, height, radius, true), width, height, radius, false);
  const background = await sharp(paper, { raw: { width, height, channels: 1 } })
    .blur(radius)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = Math.min(255, Math.round(((gray[i] ?? 0) / Math.max(1, background[i] ?? 255)) * 255));
  }
  return out;
}

function sauvola(gray: Uint8Array, width: number, height: number): Uint8Array {
  // 积分图：任意窗口的和、平方和都是常数时间。
  const sum = new Float64Array((width + 1) * (height + 1));
  const squares = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    let rowSquares = 0;
    for (let x = 0; x < width; x += 1) {
      const value = gray[y * width + x] ?? 0;
      row += value;
      rowSquares += value * value;
      const at = (y + 1) * (width + 1) + x + 1;
      sum[at] = (sum[at - width - 1] ?? 0) + row;
      squares[at] = (squares[at - width - 1] ?? 0) + rowSquares;
    }
  }
  const half = Math.max(3, Math.round((width * SAUVOLA_WINDOW_FRACTION) / 2));
  const out = new Uint8Array(gray.length);
  const area = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    (table[y1 * (width + 1) + x1] ?? 0) -
    (table[y0 * (width + 1) + x1] ?? 0) -
    (table[y1 * (width + 1) + x0] ?? 0) +
    (table[y0 * (width + 1) + x0] ?? 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const y0 = Math.max(0, y - half);
      const x1 = Math.min(width, x + half + 1);
      const y1 = Math.min(height, y + half + 1);
      const count = (x1 - x0) * (y1 - y0);
      const mean = area(sum, x0, y0, x1, y1) / count;
      const deviation = Math.sqrt(Math.max(0, area(squares, x0, y0, x1, y1) / count - mean * mean));
      const threshold = mean * (1 + SAUVOLA_K * (deviation / SAUVOLA_R - 1));
      out[y * width + x] = (gray[y * width + x] ?? 0) > threshold ? 255 : 0;
    }
  }
  return out;
}

/** 扫码页压 JPEG 依次试的质量（jpeg-encoder.ts）。 */
const JPEG_QUALITIES = [85, 70, 55, 40] as const;
const MAX_PLACEMENT_ATTEMPTS = 200;
/** 模拟用户退远：每次缩小一成。 */
const BACK_OFF_STEP = 0.9;
/** 光线最暗到多少（相对纸的亮度）。 */
const DARKEST_SHADE = 0.2;
const DEFAULT_PAIRS = 'small/small,small/medium,medium/small,medium/medium';

type Range = readonly [number, number];

/** 一组测试集：各项拍摄条件的范围（二维码边长、模糊按 1280×720 取帧时的像素算）。 */
interface Scenario {
  title: string;
  codeSidePx: Range;
  blur: Range;
  noise: Range;
  tilt: Range;
  cameraJpeg: Range;
  light: Range;
}

/** 常规：二维码一百到三百多像素（离得远到离得近），轻到中等的模糊、噪点、倾斜，正常的视频压缩和光线。 */
const NORMAL: Scenario = {
  title: '常规',
  codeSidePx: [100, 320],
  blur: [0.3, 2.0],
  noise: [2, 8],
  tilt: [0, 0.12],
  cameraJpeg: [70, 92],
  light: [0.55, 1],
};

const SCENARIOS: Record<string, Scenario> = {
  normal: NORMAL,
  far: { ...NORMAL, title: '远距离（码 90–150 px）', codeSidePx: [90, 150] },
  blur: { ...NORMAL, title: '强模糊（σ 1.8–3）', blur: [1.8, 3.0] },
  dark: { ...NORMAL, title: '弱光 + 强噪点', noise: [10, 18], light: [0.3, 0.55] },
  tilt: { ...NORMAL, title: '大倾斜（15–30%）', tilt: [0.15, 0.3] },
  jpeg: { ...NORMAL, title: '低画质视频（JPEG 30–50）', cameraJpeg: [30, 50] },
};

/** 固定种子的随机数（mulberry32）：每次跑出来的样本一样，换模型、改参数前后能直接比。 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  shelf: string;
  placement: 'belowCode' | 'rightOfCode' | 'bottomLine';
  codeSidePx: number;
  blur: number;
}

function shelfNumber(next: () => number): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter = () => letters[Math.floor(next() * letters.length)] ?? 'A';
  const number = () => String(1 + Math.floor(next() ** 2 * 120));
  return `${next() < 0.2 ? letter() + letter() : letter()}-${number()}-${number()}-${number()}`;
}

// ---- 标签 ----

interface Label {
  /** 灰度，0 是墨，255 是纸；已经放大 LABEL_SUPERSAMPLE 倍。 */
  pixels: Uint8Array;
  width: number;
  height: number;
  /** 二维码四个角，标签像素坐标（放大后）。 */
  code: CodeCorners;
}

async function renderLabel(sample: Sample, next: () => number): Promise<Label> {
  const width = LABEL_MM.width * DOTS_PER_MM;
  const height = LABEL_MM.height * DOTS_PER_MM;
  const style = `CL${1000 + Math.floor(next() * 9000)}-${['TK', 'QZ', 'MX', 'DY'][Math.floor(next() * 4)]}`;
  const color = ['图片色', '黑色', '米白', '藏青', '卡其'][Math.floor(next() * 5)] ?? '黑色';
  const size = String(34 + Math.floor(next() * 8));
  const qr = QRCode.create(`${style}|${color}|${size}`, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size;
  const modulePx = Math.floor(168 / modules);
  const codeX = 8;
  const codeY = 28;
  const codeSide = modules * modulePx;
  const rects: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (qr.modules.get(row, col)) {
        rects.push(
          `<rect x="${codeX + col * modulePx}" y="${codeY + row * modulePx}" width="${modulePx}" height="${modulePx}"/>`,
        );
      }
    }
  }
  const right = codeX + codeSide + 16;
  const texts: Array<[number, number, string]> = [
    [right, 48, `编码：${style}`],
    [right, 110, `颜色：${color}`],
    [right, 172, `尺码：${size}`],
    [8, 304, `${style}-${color}-${size}`],
  ];
  const shelfAt: Record<Sample['placement'], [number, number]> = {
    belowCode: [16, codeY + codeSide + 34],
    rightOfCode: [right, 234],
    bottomLine: [300, 304],
  };
  const [shelfX, shelfY] = shelfAt[sample.placement];
  texts.push([shelfX, shelfY, sample.shelf]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}</g>
<g font-family="SimSun, NSimSun, 'Microsoft YaHei', sans-serif" font-size="22" fill="#000">${texts
    .map(([x, y, text]) => `<text x="${x}" y="${y}">${text}</text>`)
    .join('')}</g></svg>`;
  // 热敏打印只有黑白两种点：先轻微模糊再二值化，像打印头的点稍微晕开。
  const printed = await sharp(Buffer.from(svg))
    .greyscale()
    .blur(0.5)
    .threshold(150)
    .resize(width * LABEL_SUPERSAMPLE, height * LABEL_SUPERSAMPLE, { kernel: 'nearest' })
    .raw()
    .toBuffer();
  const s = LABEL_SUPERSAMPLE;
  return {
    pixels: new Uint8Array(printed),
    width: width * s,
    height: height * s,
    code: {
      topLeft: { x: codeX * s, y: codeY * s },
      topRight: { x: (codeX + codeSide) * s, y: codeY * s },
      bottomRight: { x: (codeX + codeSide) * s, y: (codeY + codeSide) * s },
      bottomLeft: { x: codeX * s, y: (codeY + codeSide) * s },
    },
  };
}

// ---- 透视变换 ----

type Homography = number[];

/** 四对点求单应矩阵（8 个未知数的线性方程组，高斯消元）。 */
function homography(from: Point[], to: Point[]): Homography {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i] as Point;
    const { x: u, y: v } = to[i] as Point;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(rows[row]?.[col] ?? 0) > Math.abs(rows[pivot]?.[col] ?? 0)) pivot = row;
    }
    [rows[col], rows[pivot]] = [rows[pivot] as number[], rows[col] as number[]];
    const top = rows[col] as number[];
    for (let row = 0; row < 8; row += 1) {
      const current = rows[row] as number[];
      if (row === col) continue;
      const factor = (current[col] ?? 0) / (top[col] ?? 1);
      for (let k = col; k < 9; k += 1) current[k] = (current[k] ?? 0) - factor * (top[k] ?? 0);
    }
  }
  const h = rows.map((row) => (row[8] ?? 0) / (row[rows.indexOf(row)] ?? 1));
  return [...h, 1];
}

function apply(h: Homography, x: number, y: number): Point {
  const w = (h[6] ?? 0) * x + (h[7] ?? 0) * y + (h[8] ?? 1);
  return {
    x: ((h[0] ?? 0) * x + (h[1] ?? 0) * y + (h[2] ?? 0)) / w,
    y: ((h[3] ?? 0) * x + (h[4] ?? 0) * y + (h[5] ?? 0)) / w,
  };
}

const range = (next: () => number, [min, max]: readonly [number, number]) => min + next() * (max - min);

// ---- 拍照 ----

interface Frame {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  code: CodeCorners;
}

interface Capture {
  frame: { width: number; height: number };
  scenario: Scenario;
  frameScale: number;
  backOff: boolean;
}

async function photograph(label: Label, sample: Sample, capture: Capture, next: () => number): Promise<Frame> {
  const { frame, scenario } = capture;
  const labelCorners: Point[] = [
    { x: 0, y: 0 },
    { x: label.width, y: 0 },
    { x: label.width, y: label.height },
    { x: 0, y: label.height },
  ];
  const codeSideInLabel = label.code.topRight.x - label.code.topLeft.x;
  let scale = sample.codeSidePx / codeSideInLabel;
  // 放不下就换个角度、位置再试；--back-off（默认）时还放不下就模拟用户退远一点，比较的是模型，不是「拍出了画面」。
  let frameCorners: Point[] = [];
  for (let attempt = 0; ; attempt += 1) {
    const angle = next() * Math.PI * 2;
    const center = { x: frame.width * range(next, [0.3, 0.7]), y: frame.height * range(next, [0.3, 0.7]) };
    const tilt = range(next, scenario.tilt) * Math.max(label.width, label.height) * scale;
    frameCorners = labelCorners.map(({ x, y }) => {
      const dx = (x - label.width / 2) * scale;
      const dy = (y - label.height / 2) * scale;
      return {
        x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle) + (next() - 0.5) * 2 * tilt,
        y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) + (next() - 0.5) * 2 * tilt,
      };
    });
    const inside = frameCorners.every(({ x, y }) => x >= 0 && y >= 0 && x < frame.width && y < frame.height);
    if (inside) break;
    if (attempt > MAX_PLACEMENT_ATTEMPTS) {
      if (!capture.backOff) break;
      scale *= BACK_OFF_STEP;
      attempt = 0;
    }
  }
  const toFrame = homography(labelCorners, frameCorners);
  const toLabel = homography(frameCorners, labelCorners);
  const paper = 230 + next() * 22;
  const ink = 25 + next() * 45;
  const background = [150 + next() * 60, 160 + next() * 60, 170 + next() * 60];
  const light = [range(next, scenario.light), range(next, [-0.3, 0.3]), range(next, [-0.3, 0.3])] as const;
  const rgb = new Uint8ClampedArray(frame.width * frame.height * 3);
  for (let fy = 0; fy < frame.height; fy += 1) {
    for (let fx = 0; fx < frame.width; fx += 1) {
      const { x, y } = apply(toLabel, fx, fy);
      let values: number[];
      if (x >= 0 && y >= 0 && x < label.width - 1 && y < label.height - 1) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const ax = x - x0;
        const ay = y - y0;
        const at = (px: number, py: number) => label.pixels[py * label.width + px] ?? 255;
        const grey =
          at(x0, y0) * (1 - ax) * (1 - ay) +
          at(x0 + 1, y0) * ax * (1 - ay) +
          at(x0, y0 + 1) * (1 - ax) * ay +
          at(x0 + 1, y0 + 1) * ax * ay;
        const value = ink + ((paper - ink) * grey) / 255;
        values = [value, value, value];
      } else {
        const texture = ((fx >> 3) + (fy >> 3)) % 2 === 0 ? 8 : -8;
        values = background.map((channel) => channel + texture);
      }
      const shade = light[0] + (light[1] * fx) / frame.width + (light[2] * fy) / frame.height;
      const offset = (fy * frame.width + fx) * 3;
      for (let c = 0; c < 3; c += 1) {
        rgb[offset + c] = (values[c] ?? 0) * Math.min(1.1, Math.max(DARKEST_SHADE, shade));
      }
    }
  }
  const noise = range(next, scenario.noise);
  for (let i = 0; i < rgb.length; i += 1) {
    const gaussian = Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
    rgb[i] = (rgb[i] ?? 0) + gaussian * noise;
  }
  // 对焦不准 + 视频压缩。
  const camera = await sharp(Buffer.from(rgb), { raw: { width: frame.width, height: frame.height, channels: 3 } })
    .blur(sample.blur)
    .jpeg({ quality: Math.round(range(next, scenario.cameraJpeg)) })
    .toBuffer();
  const decoded = await sharp(camera).ensureAlpha().raw().toBuffer();
  const code = label.code;
  return {
    rgba: new Uint8ClampedArray(decoded),
    width: frame.width,
    height: frame.height,
    code: {
      topLeft: apply(toFrame, code.topLeft.x, code.topLeft.y),
      topRight: apply(toFrame, code.topRight.x, code.topRight.y),
      bottomRight: apply(toFrame, code.bottomRight.x, code.bottomRight.y),
      bottomLeft: apply(toFrame, code.bottomLeft.x, code.bottomLeft.y),
    },
  };
}

// ---- 扫码页截图 ----

/** 和扫码页一样：按二维码摆正截整张标签，从高到低试 JPEG 质量，直到不超过 MAX_IMAGE_BYTES。 */
async function phoneCrop(frame: Frame, pixelsPerCode: number, firstQuality: number): Promise<Buffer> {
  // 评估的是单帧的读出率：一次只截一帧。
  const request = { area: LABEL_AREA, pixelsPerCode, frames: 1 };
  const crop = cropLabel({ data: frame.rgba, width: frame.width, height: frame.height }, frame.code, request);
  if (crop === null) {
    throw new Error('截不了图');
  }
  // 先试 firstQuality（--jpeg-quality），超过上限再按扫码页的档位往下降。
  const qualities = [firstQuality, ...JPEG_QUALITIES.filter((quality) => quality < firstQuality)];
  for (const quality of qualities) {
    const jpeg = await sharp(Buffer.from(crop.data), { raw: { width: crop.width, height: crop.height, channels: 4 } })
      .jpeg({ quality })
      .toBuffer();
    if (jpeg.length <= MAX_IMAGE_BYTES || quality === qualities.at(-1)) {
      return jpeg;
    }
  }
  throw new Error('unreachable');
}

// ---- 测试集 ----

interface ManifestEntry {
  set: string;
  file: string;
  shelf: string;
  bytes: number;
}

interface Manifest {
  pixelsPerCode: number;
  entries: ManifestEntry[];
}

async function generateSet(name: string, scenario: Scenario, options: GenerateOptions): Promise<ManifestEntry[]> {
  const frame = {
    width: Math.round(BASE_FRAME.width * options.frameScale),
    height: Math.round(BASE_FRAME.height * options.frameScale),
  };
  const capture: Capture = { frame, scenario, frameScale: options.frameScale, backOff: options.backOff };
  // 每组测试集用自己的种子：加减别的组不影响这一组的样本。
  const next = random(options.seed * 1000 + [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const placements: Sample['placement'][] = ['belowCode', 'belowCode', 'rightOfCode', 'bottomLine'];
  const dir = join(options.outDir, name);
  mkdirSync(dir, { recursive: true });
  const entries: ManifestEntry[] = [];
  for (let i = 0; i < options.samples; i += 1) {
    const sample: Sample = {
      shelf: shelfNumber(next),
      placement: placements[Math.floor(next() * placements.length)] ?? 'belowCode',
      codeSidePx: range(next, scenario.codeSidePx) * options.frameScale,
      blur: range(next, scenario.blur) * options.frameScale,
    };
    const label = await renderLabel(sample, next);
    const jpeg = await phoneCrop(
      await photograph(label, sample, capture, next),
      options.pixelsPerCode,
      options.jpegQuality,
    );
    const file = join(dir, `${String(i).padStart(3, '0')}-${sample.shelf}.jpg`);
    writeFileSync(file, jpeg);
    entries.push({ set: name, file, shelf: sample.shelf, bytes: jpeg.length });
  }
  return entries;
}

interface GenerateOptions {
  samples: number;
  seed: number;
  frameScale: number;
  backOff: boolean;
  outDir: string;
  pixelsPerCode: number;
  jpegQuality: number;
}

// ---- 识别（每个组合一个子进程） ----

interface WorkerResult {
  /** score：读出货架号的那一段文字的识别置信度（没读出时为 null）。 */
  results: Array<{ found: string | null; score: number | null; ms: number; read: string }>;
  rssBeforeMb: number;
  rssLoadedMb: number;
  rssPeakMb: number;
}

const runRegex = (pattern: string, flags: string, input: string) =>
  new RegExp(pattern, flags).exec(input)?.groups ?? null;

/** 识别用的 RGBA：灰度等处理后通道数会变，补齐成 4 个通道。 */
async function decodeForRecognition(file: string, enhance: string) {
  const documentFilter = DOCUMENT_FILTERS[enhance];
  if (documentFilter) {
    const { data: gray, info: grayInfo } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
    const filtered = await documentFilter.apply(new Uint8Array(gray), grayInfo.width, grayInfo.height);
    return expandToRgba(Buffer.from(filtered), grayInfo.width, grayInfo.height, 1);
  }
  const enhancement = ENHANCEMENTS[enhance];
  if (!enhancement) {
    throw new Error(`没有增强方式 ${enhance}，可选：${enhancementNames().join('、')}`);
  }
  const { data, info } = await enhancement.apply(sharp(file)).raw().toBuffer({ resolveWithObject: true });
  return expandToRgba(data, info.width, info.height, info.channels);
}

function enhancementNames(): string[] {
  return [...Object.keys(ENHANCEMENTS), ...Object.keys(DOCUMENT_FILTERS)];
}

function enhancementTitle(name: string): string {
  return ENHANCEMENTS[name]?.title ?? DOCUMENT_FILTERS[name]?.title ?? name;
}

function expandToRgba(data: Buffer, width: number, height: number, channels: number) {
  const info = { width, height, channels };
  if (info.channels === 4) {
    return { data, width: info.width, height: info.height };
  }
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    for (let c = 0; c < 3; c += 1) {
      rgba[pixel * 4 + c] = data[pixel * info.channels + (info.channels >= 3 ? c : 0)] ?? 0;
    }
    rgba[pixel * 4 + 3] = 255;
  }
  return { data: rgba, width: info.width, height: info.height };
}

/** --dump：把每种增强处理后的前几张存成 PNG，看处理得对不对。 */
const DUMPED_IMAGES = 3;

async function runWorker(pair: string, enhance: string, manifestPath: string, dumpDir?: string): Promise<void> {
  const [det, rec] = pair.split('/');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const entries = manifest.entries;
  const layout = cropLayout({ area: LABEL_AREA, pixelsPerCode: manifest.pixelsPerCode, frames: 1 });
  const mb = () => process.memoryUsage().rss / 1024 / 1024;
  const rssBeforeMb = mb();
  const engine = await OcrEngine.create({
    detModelPath: `models/${det}/det.onnx`,
    recModelPath: `models/${rec}/rec.onnx`,
    dictionaryPath: `models/${rec}/dict.txt`,
    intraThreads: 4,
    recognitionBatchSize: 8,
  });
  const rssLoadedMb = mb();
  let rssPeakMb = rssLoadedMb;
  const results: WorkerResult['results'] = [];
  for (const entry of entries) {
    const image = await decodeForRecognition(entry.file, enhance);
    if (dumpDir !== undefined && results.length < DUMPED_IMAGES) {
      mkdirSync(dumpDir, { recursive: true });
      await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
        .png()
        .toFile(join(dumpDir, `${enhance}-${results.length}.png`));
    }
    const started = performance.now();
    const result = await engine.recognize({ ...image, pixelFormat: 'RGBA' });
    const ms = performance.now() - started;
    rssPeakMb = Math.max(rssPeakMb, mb());
    const regions: ImageTextRegion[] = result.regions.map((region) => ({
      box: region.box,
      text: region.text,
      score: region.recognitionScore,
    }));
    const query = { pattern: SHELF_NUMBER_PATTERN, flags: '', preferredArea: BELOW_CODE_AREA };
    const match = findImageText(regions, layout.code, query, runRegex);
    const found = match?.value ?? null;
    const score = match?.score ?? null;
    results.push({ found, score, ms, read: regions.map((region) => region.text).join(' | ') });
  }
  engine.close();
  const output: WorkerResult = { results, rssBeforeMb, rssLoadedMb, rssPeakMb };
  console.log(JSON.stringify(output));
}

async function recognizeWith(
  pair: string,
  enhance: string,
  manifestPath: string,
  dumpDir?: string,
): Promise<WorkerResult> {
  const args = [
    '--worker',
    pair,
    '--enhance',
    enhance,
    '--manifest',
    manifestPath,
    ...(dumpDir ? ['--dump', dumpDir] : []),
  ];
  const child = Bun.spawn([process.execPath, import.meta.path, ...args], {
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error(`${pair} 的识别进程失败`);
  }
  return JSON.parse(text.trim().split('\n').at(-1) ?? '{}') as WorkerResult;
}

// ---- 汇总 ----

const percent = (count: number, total: number) => (total === 0 ? '-' : `${((100 * count) / total).toFixed(1)}%`);
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};

function modelSizeMb(variant: string): number {
  const [det, rec] = (variant.split(' + ')[0] ?? '').split('/');
  return (statSync(`models/${det}/det.onnx`).size + statSync(`models/${rec}/rec.onnx`).size) / 1024 / 1024;
}

function report(entries: ManifestEntry[], sets: string[], outcomes: Map<string, WorkerResult>): void {
  const pairs = [...outcomes.keys()];
  const header = `| 测试集 | ${pairs.map((pair) => `${pair} 读对 / 读错`).join(' | ')} |`;
  console.log(`\n${header}\n|---|${pairs.map(() => '---').join('|')}|`);
  const rows = [...sets, 'all'];
  for (const set of rows) {
    const cells = pairs.map((pair) => {
      const results = outcomes.get(pair)?.results ?? [];
      let correct = 0;
      let wrong = 0;
      let total = 0;
      entries.forEach((entry, i) => {
        if (set !== 'all' && entry.set !== set) return;
        total += 1;
        const found = results[i]?.found ?? null;
        if (found === entry.shelf) correct += 1;
        else if (found !== null) wrong += 1;
      });
      return `${percent(correct, total)} / ${percent(wrong, total)}`;
    });
    const title = set === 'all' ? `**合计（${entries.length} 张）**` : (SCENARIOS[set]?.title ?? set);
    console.log(`| ${title} | ${cells.join(' | ')} |`);
  }
  console.log('\n| 组合 | 模型大小 | 中位 / p90 耗时 | 加载后内存 | 识别时峰值 |\n|---|---|---|---|---|');
  for (const pair of pairs) {
    const outcome = outcomes.get(pair);
    if (!outcome) continue;
    const times = outcome.results.map((result) => result.ms);
    console.log(
      `| ${pair} | ${modelSizeMb(pair).toFixed(0)} MB | ${quantile(times, 0.5).toFixed(0)} / ${quantile(times, 0.9).toFixed(0)} ms | ${outcome.rssLoadedMb.toFixed(0)} MB | ${outcome.rssPeakMb.toFixed(0)} MB |`,
    );
  }
  for (const pair of pairs) {
    const results = outcomes.get(pair)?.results ?? [];
    const wrong = entries
      .map((entry, i) => ({ entry, result: results[i] }))
      .filter(({ entry, result }) => result?.found != null && result.found !== entry.shelf);
    if (wrong.length > 0) {
      console.log(
        `\n${pair} 读错的：${wrong.map(({ entry, result }) => `${entry.shelf}→${result?.found}（${result?.score?.toFixed(3)}）`).join('，')}`,
      );
    }
  }
  console.log(
    `\n识别置信度门槛（低于门槛当作没认出，手机提示重扫或手动输入），合计读对 / 读错：\n\n| 组合 | 不设 | ${SCORE_THRESHOLDS.join(' | ')} |\n|---|---|${SCORE_THRESHOLDS.map(() => '---').join('|')}|`,
  );
  for (const pair of pairs) {
    const results = outcomes.get(pair)?.results ?? [];
    const cells = [0, ...SCORE_THRESHOLDS].map((threshold) => {
      let correct = 0;
      let wrong = 0;
      entries.forEach((entry, i) => {
        const result = results[i];
        if (!result || result.found === null || (result.score ?? 0) < threshold) return;
        if (result.found === entry.shelf) correct += 1;
        else wrong += 1;
      });
      return `${percent(correct, entries.length)} / ${percent(wrong, entries.length)}`;
    });
    console.log(`| ${pair} | ${cells.join(' | ')} |`);
  }
}

// ---- 入口 ----

const { values } = parseArgs({
  options: {
    sets: { type: 'string', default: Object.keys(SCENARIOS).join(',') },
    pairs: { type: 'string', default: DEFAULT_PAIRS },
    enhance: { type: 'string', default: 'none' },
    'pixels-per-code': { type: 'string', default: String(DEFAULT_PIXELS_PER_CODE) },
    // 扫码页压 JPEG 先试的质量（现在是 85）。
    'jpeg-quality': { type: 'string', default: String(JPEG_QUALITIES[0]) },
    samples: { type: 'string', default: '200' },
    seed: { type: 'string', default: '1' },
    // 取帧分辨率相对 1280×720 的倍数：1.5 是现在扫码页的 1080p 截图，1 是改之前。
    'frame-scale': { type: 'string', default: '1.5' },
    // 默认模拟「标签拍出画面时用户退远一点」，比较的是模型；--no-back-off 看拍得太近时的样子。
    'no-back-off': { type: 'boolean', default: false },
    out: { type: 'string', default: join('native', 'ocr', 'target', 'eval') },
    worker: { type: 'string' },
    dump: { type: 'string' },
    manifest: { type: 'string' },
  },
});

if (values.worker !== undefined && values.manifest !== undefined) {
  await runWorker(values.worker, values.enhance, values.manifest, values.dump);
} else {
  const sets = values.sets.split(',');
  const pairs = values.pairs.split(',');
  const enhancements = values.enhance.split(',');
  for (const enhance of enhancements) {
    if (!enhancementNames().includes(enhance)) {
      throw new Error(`没有增强方式 ${enhance}，可选：${enhancementNames().join('、')}`);
    }
  }
  for (const set of sets) {
    if (!SCENARIOS[set]) {
      throw new Error(`没有测试集 ${set}，可选：${Object.keys(SCENARIOS).join('、')}`);
    }
  }
  for (const pair of pairs) {
    const [det, rec] = pair.split('/');
    for (const file of [`models/${det}/det.onnx`, `models/${rec}/rec.onnx`, `models/${rec}/dict.txt`]) {
      if (!det || !rec || !existsSync(file)) {
        throw new Error(`--pairs 的格式是「检测档位/识别档位」，模型要放在 models/<档位>/：缺 ${file}`);
      }
    }
  }
  const options: GenerateOptions = {
    samples: Number(values.samples),
    seed: Number(values.seed),
    frameScale: Number(values['frame-scale']),
    backOff: !values['no-back-off'],
    outDir: resolve(values.out),
    pixelsPerCode: Number(values['pixels-per-code']),
    jpegQuality: Number(values['jpeg-quality']),
  };
  const entries: ManifestEntry[] = [];
  for (const set of sets) {
    const started = performance.now();
    entries.push(...(await generateSet(set, SCENARIOS[set] as Scenario, options)));
    console.log(
      `[eval] ${SCENARIOS[set]?.title}：${options.samples} 张，${((performance.now() - started) / 1000).toFixed(0)} 秒`,
    );
  }
  const manifestPath = join(options.outDir, 'manifest.json');
  const manifest: Manifest = { pixelsPerCode: options.pixelsPerCode, entries };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const outcomes = new Map<string, WorkerResult>();
  for (const pair of pairs) {
    for (const enhance of enhancements) {
      const variant = enhance === 'none' ? pair : `${pair} + ${enhancementTitle(enhance)}`;
      const started = performance.now();
      outcomes.set(variant, await recognizeWith(pair, enhance, manifestPath, values.dump));
      console.log(`[eval] ${variant}：${((performance.now() - started) / 1000).toFixed(0)} 秒`);
    }
  }
  const sizes = entries.map((entry) => entry.bytes / 1024);
  console.log(
    `\n取帧 ${BASE_FRAME.width * options.frameScale}×${BASE_FRAME.height * options.frameScale}，每组 ${options.samples} 张，种子 ${options.seed}${options.backOff ? '' : '，不退远'}；` +
      `截图每个二维码边长 ${options.pixelsPerCode} 像素、JPEG 先试质量 ${options.jpegQuality}，JPEG 平均 ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(0)} KB、最大 ${Math.max(...sizes).toFixed(0)} KB`,
  );
  report(entries, sets, outcomes);
}
