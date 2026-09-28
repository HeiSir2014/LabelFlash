/**
 * 摄像头：打开后置摄像头、对焦和变焦、取帧、手电筒、屏幕常亮，以及拍照识别时读取照片。
 * 怎么设置由 camera-features.ts 按能力决定（有单元测试）；这里是浏览器 API 的薄封装，
 * 由假摄像头的浏览器测试和真机验收覆盖。
 */
import {
  type CameraCapabilities,
  type CameraConstraintSet,
  focusAtConstraints,
  hasTorch,
  startupConstraints,
  type VideoPoint,
} from './camera-features';

/** 取帧时把画面缩到最长边不超过这个值：再大解码更慢，识别率也不会更高。 */
const MAX_FRAME_EDGE_PX = 1280;

export class Camera {
  private stream: MediaStream | null = null;
  private capabilities: CameraCapabilities = {};
  private readonly canvas = document.createElement('canvas');
  private wakeLock: WakeLockSentinel | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  get isRunning(): boolean {
    return this.stream !== null;
  }

  get hasTorch(): boolean {
    return hasTorch(this.capabilities);
  }

  /** 这台设备能不能点按对焦（安卓 Chrome 多数可以；iPhone 由系统自动对焦，不能也不需要）。 */
  get canFocusAt(): boolean {
    return focusAtConstraints(this.capabilities, supportsPointsOfInterest(), { x: 0.5, y: 0.5 }) !== null;
  }

  /** 视频画面本身的尺寸（点按对焦时换算坐标用）；还没有画面时为 null。 */
  get frameSize(): { width: number; height: number } | null {
    const { videoWidth, videoHeight } = this.video;
    return videoWidth > 0 && videoHeight > 0 ? { width: videoWidth, height: videoHeight } : null;
  }

  /** 打不开（没授权、没有摄像头、浏览器不支持）时抛错，由调用方降级为拍照识别。 */
  async start(): Promise<void> {
    if (this.stream) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('这个浏览器不支持在网页里使用摄像头');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.capabilities = readCapabilities(this.track());
    for (const set of startupConstraints(this.capabilities)) {
      await this.apply(set);
    }
    await this.keepScreenOn();
  }

  stop(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.capabilities = {};
    this.video.srcObject = null;
    void this.wakeLock?.release();
    this.wakeLock = null;
  }

  /** 点按对焦：point 是视频画面里的归一化坐标。 */
  async focusAt(point: VideoPoint): Promise<void> {
    const set = focusAtConstraints(this.capabilities, supportsPointsOfInterest(), point);
    if (set) {
      await this.apply(set);
    }
  }

  async setTorch(on: boolean): Promise<void> {
    await this.track()?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
  }

  /** 当前画面；还没有画面时返回 null。 */
  grab(): ImageData | null {
    const size = this.frameSize;
    if (!this.stream || !size) {
      return null;
    }
    return drawToImageData(this.canvas, this.video, size.width, size.height);
  }

  private track(): MediaStreamTrack | undefined {
    return this.stream?.getVideoTracks()[0];
  }

  /** 每组约束单独应用：设备拒绝某一项（抛 OverconstrainedError）时记下来，不影响其他项和扫码。 */
  private async apply(set: CameraConstraintSet): Promise<void> {
    try {
      await this.track()?.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
    } catch (error) {
      console.warn('[Camera] constraint not applied', set, error);
    }
  }

  /** 取景时保持屏幕常亮；不支持或被拒绝都不影响扫码。 */
  private async keepScreenOn(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch (error) {
      console.warn('[Camera] wake lock unavailable', error);
    }
  }
}

/** 拍照识别：把照片按同样的尺寸上限画出来。 */
export async function imageFromFile(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    return drawToImageData(document.createElement('canvas'), bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** getCapabilities 在一些浏览器上不存在（旧版 Firefox），有的会抛错：都当作「什么都不支持」。 */
function readCapabilities(track: MediaStreamTrack | undefined): CameraCapabilities {
  try {
    return (track?.getCapabilities?.() as CameraCapabilities | undefined) ?? {};
  } catch (error) {
    console.warn('[Camera] capabilities unavailable', error);
    return {};
  }
}

/** 对焦点不是范围值，getCapabilities 里没有它，只能从浏览器支持的约束列表里看。 */
function supportsPointsOfInterest(): boolean {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined;
  return supported?.['pointsOfInterest'] === true;
}

function drawToImageData(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  const scale = Math.min(1, MAX_FRAME_EDGE_PX / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('浏览器不支持 canvas 2d');
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
