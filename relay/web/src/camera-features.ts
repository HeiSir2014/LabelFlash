/**
 * 摄像头的对焦、变焦、手电筒：按浏览器报告的能力决定怎么设置（纯函数，bun test 测试）。
 *
 * 安卓的 Chrome 和微信内核通过 track.getCapabilities() 报告这些能力（Media Capture 的 Image Capture 扩展），
 * 用 applyConstraints({ advanced: [...] }) 设置。iPhone（Safari 和微信都是 WebKit）从 Safari 17 起只报告变焦，
 * 对焦由系统持续自动完成，网页既读不到也改不了——报告了什么就设什么，没报告的交给系统。
 */

/** getCapabilities() 里和扫码有关的几项。TypeScript 自带的 DOM 类型还没有它们，所以单独声明。 */
export interface CameraCapabilities {
  focusMode?: string[];
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
}

/** 一个点：单位由用法决定（元素上的像素，或视频画面里的归一化坐标）。 */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** 一组约束：每组只设一项，逐组应用，某一项被拒绝不影响其他项。 */
export interface CameraConstraintSet {
  focusMode?: 'continuous' | 'single-shot';
  /** 对焦点：视频画面里的归一化坐标（左上角 0,0，右下角 1,1）。 */
  pointsOfInterest?: Point[];
  zoom?: number;
}

/**
 * 默认变焦倍数。很多手机主摄的最近对焦距离在 10 厘米左右，凑太近反而糊；
 * 放大 1.5 倍后拿远一点标签也能充满框，同时在对焦范围内。更大的倍数画面会抖、会暗。
 */
export const PREFERRED_ZOOM = 1.5;
/**
 * 远焦的变焦倍数：多数带长焦镜头的手机长焦是 3 倍。浏览器拿到的是系统合成的「逻辑摄像头」时，
 * 变焦过了长焦的倍数，系统自己换到长焦镜头；没有长焦的手机是数码放大，拿远一点扫小码也清楚。
 */
export const FAR_ZOOM = 3;
/** 双击：第二下落在这段时间内，并且离第一下不远。和系统的双击时长相当。 */
export const DOUBLE_TAP_MS = 300;
/** 双击两下之间允许的偏移：手指点两下不会正好落在同一点上。 */
export const DOUBLE_TAP_SLOP_PX = 40;
/** 步数取整前加的容差：远小于任何一档步长，只用来吸收浮点误差。 */
const STEP_TOLERANCE = 1e-9;
/** 变焦倍数保留三位小数：设备的步长最细也就 0.01。 */
const ZOOM_PRECISION = 1_000;

/** 焦段：近焦是默认的适中变焦，远焦是长焦（双击取景画面切换）。 */
export type Lens = 'near' | 'far';

export interface LensZooms {
  near: number;
  far: number;
}

/** 一次点按：在哪里、什么时候（毫秒）。 */
export interface Tap {
  point: Point;
  at: number;
}

export function startupConstraints(capabilities: CameraCapabilities, lens: Lens = 'near'): CameraConstraintSet[] {
  const sets: CameraConstraintSet[] = [];
  // 显式要持续对焦：不同厂商的默认对焦模式不一样，有的近距离会一直糊。
  if (capabilities.focusMode?.includes('continuous')) {
    sets.push({ focusMode: 'continuous' });
  }
  const lenses = lensZooms(capabilities);
  const zoom = lenses ? lenses[lens] : alignedZoom(capabilities.zoom, PREFERRED_ZOOM);
  if (zoom !== null) {
    sets.push({ zoom });
  }
  return sets;
}

/** 近焦、远焦各用多少倍；远焦不比近焦更近（不能变焦、最大倍数太小）时不提供切换，返回 null。 */
export function lensZooms(capabilities: CameraCapabilities): LensZooms | null {
  const near = alignedZoom(capabilities.zoom, PREFERRED_ZOOM);
  const far = alignedZoom(capabilities.zoom, FAR_ZOOM);
  return near !== null && far !== null && far > near ? { near, far } : null;
}

export function isDoubleTap(previous: Tap | null, point: Point, at: number): boolean {
  return (
    previous !== null &&
    at - previous.at <= DOUBLE_TAP_MS &&
    Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= DOUBLE_TAP_SLOP_PX
  );
}

/**
 * 点按对焦：把点到的位置设为对焦点。
 * 支持持续对焦的保持持续对焦（对焦区域换成这一点）；只支持单次对焦的单次对焦到这一点。
 */
export function focusAtConstraints(
  capabilities: CameraCapabilities,
  supportsPointsOfInterest: boolean,
  point: Point,
): CameraConstraintSet | null {
  if (!supportsPointsOfInterest) {
    return null;
  }
  if (capabilities.focusMode?.includes('continuous')) {
    return { focusMode: 'continuous', pointsOfInterest: [point] };
  }
  if (capabilities.focusMode?.includes('single-shot')) {
    return { focusMode: 'single-shot', pointsOfInterest: [point] };
  }
  return null;
}

export function hasTorch(capabilities: CameraCapabilities): boolean {
  return capabilities.torch === true;
}

/**
 * 视频画面里在取景元素上看得见的那一块（视频像素坐标）。
 * 视频以 object-fit: cover 铺满元素：按较大的比例缩放，多出来的两边被裁掉。
 * 解码只读这一块：看不见的地方（例如旁边另一张标签）不该被打印；画面小了解码也更快。
 */
export function visibleVideoRect(element: Size, video: Size): Rect {
  if (element.width <= 0 || element.height <= 0) {
    return { x: 0, y: 0, width: video.width, height: video.height };
  }
  const scale = Math.max(element.width / video.width, element.height / video.height);
  const width = Math.min(video.width, element.width / scale);
  const height = Math.min(video.height, element.height / scale);
  return { x: (video.width - width) / 2, y: (video.height - height) / 2, width, height };
}

/** 点在取景元素上的位置（像素）→ 视频画面里的归一化坐标（左上角 0,0，右下角 1,1）。 */
export function tapToVideoPoint(tap: Point, element: Size, video: Size): Point {
  const visible = visibleVideoRect(element, video);
  return {
    x: clampUnit((visible.x + (tap.x / element.width) * visible.width) / video.width),
    y: clampUnit((visible.y + (tap.y / element.height) * visible.height) / video.height),
  };
}

/** 把想要的倍数放进摄像头的范围并按步长对齐；摄像头不能变焦时返回 null。 */
function alignedZoom(range: CameraCapabilities['zoom'], wanted: number): number | null {
  if (!range || range.max <= range.min || range.max <= 1) {
    return null;
  }
  const target = Math.min(Math.max(wanted, range.min), range.max);
  const step = range.step && range.step > 0 ? range.step : null;
  if (step === null) {
    return target;
  }
  // 按步长对齐（向下取，免得超出上限）。(1.2 - 1) / 0.1 在浮点里是 1.9999999999999996，要留一点容差再取整。
  const steps = Math.floor((target - range.min) / step + STEP_TOLERANCE);
  return Math.round((range.min + steps * step) * ZOOM_PRECISION) / ZOOM_PRECISION;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
