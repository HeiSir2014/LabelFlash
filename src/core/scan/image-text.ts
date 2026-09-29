/**
 * 「图中文字识别」的纯逻辑：从 OCR 结果里按「二维码附近的区域 + 正则」挑出一个字段值（例如货架号 A-1-2-3）。
 * OCR 本身在主进程里做（native/ocr），这里只处理它给出的文字，不依赖 Electron 和 OCR 引擎。
 *
 * 坐标约定：手机按二维码的四个角把截图摆正，截图里二维码是正的正方形。区域用「二维码边长」做单位、
 * 以二维码左上角为原点描述，和拍摄的远近、角度都无关。
 *
 * 不依赖固定位置：手机截整张标签，OCR 读出所有文字，按正则找。设置里的区域只决定先看哪里——
 * 那里没有匹配就接着找标签的其他地方，货架号换了位置照样认得出；两处都像时，区域里的优先。
 */

import type { RegexRunner } from './recognize';

export interface ImagePoint {
  x: number;
  y: number;
}

/** OCR 读出的一段文字（截图上的像素坐标，四点按左上、右上、右下、左下）。 */
export interface ImageTextRegion {
  box: readonly [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  text: string;
  /** 识别分（0–1）。 */
  score: number;
}

/** 二维码在截图里的位置：摆正后的正方形，左上角和边长（像素）。 */
export interface CodeSquare {
  x: number;
  y: number;
  size: number;
}

/** 手机截下来的标签图：按二维码摆正后的 JPEG，和二维码在图里的位置。 */
export interface ScanImage {
  jpeg: Uint8Array;
  code: CodeSquare;
}

/** 以二维码为基准的矩形区域：单位是二维码边长，原点是二维码左上角，向右、向下为正。 */
export interface CodeRelativeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 常用区域：二维码正下方一条（货架号印在二维码下面时）。 */
export const BELOW_CODE_AREA: CodeRelativeArea = { left: -0.1, top: 1, right: 1.1, bottom: 1.6 };

/**
 * 手机截图的默认范围：整张标签。二维码可能在标签的左边或右边，四周各留出足够的边长倍数，
 * 60×40 这类样衣标签上二维码之外的文字都在里面。
 */
export const LABEL_AREA: CodeRelativeArea = { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 };

/** 默认的货架号格式：1–2 个大写字母，后面三段 1–3 位数字（段可以是两位数）；两边是词边界，不从长串里截半段。 */
export const SHELF_NUMBER_PATTERN = String.raw`\b[A-Z]{1,2}-\d{1,3}-\d{1,3}-\d{1,3}\b`;

/** OCR 常把连字符读成这些字符（中文破折号、全角、各种横线）。 */
const DASHES = /[‐‑‒–—―−－一ー─━]/g;
/** 连字符两边多出来的空格。 */
const SPACES_AROUND_DASH = /\s*-\s*/g;

/**
 * 规整 OCR 读出的文字再匹配：全角转半角（NFKC），各种横线统一成 `-`，去掉连字符两边的空格和首尾空白。
 * 只做不会改变意思的替换；字母数字的混淆（O/0、A/4）不在这里猜。
 */
export function normalizeImageText(text: string): string {
  return text.normalize('NFKC').replace(DASHES, '-').replace(SPACES_AROUND_DASH, '-').trim();
}

function center(region: ImageTextRegion): ImagePoint {
  const sum = region.box.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / 4, y: sum.y / 4 };
}

/** 换算到以二维码为基准的坐标（单位：二维码边长）。 */
function toCodeUnits(point: ImagePoint, code: CodeSquare): ImagePoint {
  return { x: (point.x - code.x) / code.size, y: (point.y - code.y) / code.size };
}

function inside(point: ImagePoint, area: CodeRelativeArea): boolean {
  return point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom;
}

const CODE_ITSELF: CodeRelativeArea = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * 按查找的先后排好文字段：优先区域里的在前，其余的在后（各自保持 OCR 的阅读顺序）；没有优先区域时就是阅读顺序。
 * 中心落在二维码本身上的一律去掉（那是把码当成了字）。
 */
export function searchOrder(
  regions: readonly ImageTextRegion[],
  code: CodeSquare,
  preferred: CodeRelativeArea | null,
): ImageTextRegion[] {
  const located = regions
    .map((region) => ({ region, at: toCodeUnits(center(region), code) }))
    .filter(({ at }) => !inside(at, CODE_ITSELF));
  const first = preferred === null ? [] : located.filter(({ at }) => inside(at, preferred));
  const rest = located.filter((item) => !first.includes(item));
  return [...first, ...rest].map(({ region }) => region);
}

/** 包住调用方正则的分组名：取整段匹配（调用方的正则里不需要写命名分组）。 */
const MATCH_GROUP = 'imageTextMatch';

/** 实际执行的正则：把调用方的正则包进一个命名分组（校验时也按这个写法编译一次）。 */
export function wrapImageTextPattern(pattern: string): string {
  return `(?<${MATCH_GROUP}>${pattern})`;
}

export interface ImageTextQuery {
  pattern: string;
  flags: string;
  /** 优先查找的区域；null 表示不分先后。 */
  preferredArea: CodeRelativeArea | null;
}

/**
 * 按查找的先后（见 searchOrder），取第一段能匹配正则的文字里匹配的部分；都不匹配返回 null。
 * 正则由调用方注入的 `runRegex` 在隔离环境里执行（有超时），核心层不直接执行来路不明的正则。
 */
export function findImageText(
  regions: readonly ImageTextRegion[],
  code: CodeSquare,
  query: ImageTextQuery,
  runRegex: RegexRunner,
): string | null {
  const wrapped = wrapImageTextPattern(query.pattern);
  for (const region of searchOrder(regions, code, query.preferredArea)) {
    const match = runRegex(wrapped, query.flags, normalizeImageText(region.text))?.[MATCH_GROUP];
    if (match !== undefined && match !== '') {
      return match;
    }
  }
  return null;
}
