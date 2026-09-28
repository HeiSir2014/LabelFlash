/**
 * 摄像头的对焦、变焦、手电筒：按浏览器报告的能力决定怎么设置（纯函数，bun test 测试）。
 *
 * 安卓的 Chrome 和微信内核通过 track.getCapabilities() 报告这些能力（Media Capture 的 Image Capture 扩展），
 * 用 applyConstraints({ advanced: [...] }) 设置。iPhone（Safari 和微信都是 WebKit）不报告，由系统持续自动对焦，
 * 网页既读不到也改不了——这时这里什么都不设，交给系统。
 */

/** getCapabilities() 里和扫码有关的几项。TypeScript 自带的 DOM 类型还没有它们，所以单独声明。 */
export interface CameraCapabilities {
  focusMode?: string[];
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
}

export interface VideoPoint {
  x: number;
  y: number;
}

/** 一组约束：每组只设一项，逐组应用，某一项被拒绝不影响其他项。 */
export interface CameraConstraintSet {
  focusMode?: 'continuous' | 'single-shot';
  pointsOfInterest?: VideoPoint[];
  zoom?: number;
}

/**
 * 默认变焦倍数。很多手机主摄的最近对焦距离在 10 厘米左右，凑太近反而糊；
 * 放大 1.5 倍后拿远一点标签也能充满框，同时在对焦范围内。更大的倍数画面会抖、会暗。
 */
export const PREFERRED_ZOOM = 1.5;
/** 步数取整前加的容差：远小于任何一档步长，只用来吸收浮点误差。 */
const STEP_TOLERANCE = 1e-9;
/** 变焦倍数保留三位小数：设备的步长最细也就 0.01。 */
const ZOOM_PRECISION = 1_000;

export function startupConstraints(capabilities: CameraCapabilities): CameraConstraintSet[] {
  const sets: CameraConstraintSet[] = [];
  // 显式要持续对焦：不同厂商的默认对焦模式不一样，有的近距离会一直糊。
  if (capabilities.focusMode?.includes('continuous')) {
    sets.push({ focusMode: 'continuous' });
  }
  const zoom = preferredZoom(capabilities.zoom);
  if (zoom !== null) {
    sets.push({ zoom });
  }
  return sets;
}

/**
 * 点按对焦：把点到的位置设为对焦点。
 * 支持持续对焦的保持持续对焦（对焦区域换成这一点）；只支持单次对焦的单次对焦到这一点。
 */
export function focusAtConstraints(
  capabilities: CameraCapabilities,
  supportsPointsOfInterest: boolean,
  point: VideoPoint,
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
 * 点在取景元素上的位置 → 视频画面里的归一化坐标（左上角 0,0，右下角 1,1）。
 * 视频以 object-fit: cover 铺满元素：按较大的比例缩放，多出来的两边被裁掉。
 */
export function tapToVideoPoint(
  tap: VideoPoint,
  element: { width: number; height: number },
  video: { width: number; height: number },
): VideoPoint {
  const scale = Math.max(element.width / video.width, element.height / video.height);
  const shownWidth = video.width * scale;
  const shownHeight = video.height * scale;
  const cropLeft = (shownWidth - element.width) / 2;
  const cropTop = (shownHeight - element.height) / 2;
  return {
    x: clampUnit((tap.x + cropLeft) / shownWidth),
    y: clampUnit((tap.y + cropTop) / shownHeight),
  };
}

function preferredZoom(range: CameraCapabilities['zoom']): number | null {
  if (!range || range.max <= range.min || range.max <= 1) {
    return null;
  }
  const target = Math.min(Math.max(PREFERRED_ZOOM, range.min), range.max);
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
