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
  type Lens,
  lensZooms,
  type Point,
  type Rect,
  type Size,
  startupConstraints,
} from './camera-features';

/** 取帧时把画面缩到最长边不超过这个值：再大解码更慢，识别率也不会更高。 */
const MAX_FRAME_EDGE_PX = 1280;
/** 想要的画面尺寸：够看清一维码的细条，又不会让手机发烫。 */
const IDEAL_VIDEO_SIZE: Size = { width: 1280, height: 720 };

/** phone-controller 用到的摄像头能力；测试里换成假的。 */
export interface CameraPort {
  readonly isRunning: boolean;
  readonly hasTorch: boolean;
  readonly canFocusAt: boolean;
  readonly frameSize: Size | null;
  /** 画面被系统中断（别的应用占用摄像头、权限被收回）时调用。 */
  onInterrupted: (() => void) | null;
  /** 打开成功返回 true；打开期间被 stop() 取消返回 false；打不开时抛错。 */
  start(): Promise<boolean>;
  stop(): void;
  focusAt(point: Point): Promise<void>;
  /** 设置失败时抛错，调用方据此决定手电筒按钮的状态。 */
  setTorch(on: boolean): Promise<void>;
  /** 画面里 area 这一块（视频像素坐标）；还没有画面时返回 null。 */
  grab(area: Rect): ImageData | null;
  /** 当前焦段；摄像头没开，或这台设备只有一种变焦（不能切换）时为 null。 */
  readonly currentLens: Lens | null;
  /** 切换焦段；设备拒绝时抛错，焦段不变。重新打开摄像头时沿用选好的焦段。 */
  setLens(lens: Lens): Promise<void>;
}

export class Camera implements CameraPort {
  onInterrupted: (() => void) | null = null;
  private stream: MediaStream | null = null;
  private capabilities: CameraCapabilities = {};
  private readonly canvas = document.createElement('canvas');
  private wakeLock: WakeLockSentinel | null = null;
  /** 选好的焦段：切到后台再回来、重新打开摄像头时沿用。 */
  private lens: Lens = 'near';
  /** 每次 start / stop 加一：等待授权、等画面的时候被 stop 了，拿到的东西要立即放掉。 */
  private generation = 0;

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

  get currentLens(): Lens | null {
    return this.stream && lensZooms(this.capabilities) ? this.lens : null;
  }

  /** 视频画面本身的尺寸；还没有画面时为 null。 */
  get frameSize(): Size | null {
    const { videoWidth, videoHeight } = this.video;
    return videoWidth > 0 && videoHeight > 0 ? { width: videoWidth, height: videoHeight } : null;
  }

  async start(): Promise<boolean> {
    if (this.stream) {
      return true;
    }
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('这个浏览器不支持在网页里使用摄像头');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: IDEAL_VIDEO_SIZE.width },
        height: { ideal: IDEAL_VIDEO_SIZE.height },
      },
    });
    const track = stream.getVideoTracks()[0];
    if (generation !== this.generation || !track) {
      stopTracks(stream);
      if (!track) {
        throw new Error('摄像头没有给出画面');
      }
      return false;
    }
    try {
      this.video.srcObject = stream;
      await this.video.play();
    } catch (error) {
      stopTracks(stream);
      if (this.video.srcObject === stream) {
        this.video.srcObject = null;
      }
      throw error;
    }
    if (generation !== this.generation) {
      stopTracks(stream);
      return false;
    }
    this.stream = stream;
    track.addEventListener('ended', () => {
      if (this.stream === stream) {
        this.release();
        this.onInterrupted?.();
      }
    });
    this.capabilities = readCapabilities(track);
    for (const set of startupConstraints(this.capabilities, this.lens)) {
      await this.apply(set);
    }
    await this.keepScreenOn(generation);
    return true;
  }

  stop(): void {
    this.generation += 1;
    this.release();
  }

  /** 点按对焦：point 是视频画面里的归一化坐标。 */
  async focusAt(point: Point): Promise<void> {
    const set = focusAtConstraints(this.capabilities, supportsPointsOfInterest(), point);
    if (set) {
      await this.apply(set);
    }
  }

  async setLens(lens: Lens): Promise<void> {
    const zooms = lensZooms(this.capabilities);
    const track = this.track();
    if (!track || !zooms) {
      throw new Error('这台设备不能切换焦段');
    }
    // 不经 apply()：切换失败要让调用方知道，按钮和提示才不会说错。
    await track.applyConstraints({ advanced: [{ zoom: zooms[lens] } as MediaTrackConstraintSet] });
    this.lens = lens;
  }

  async setTorch(on: boolean): Promise<void> {
    const track = this.track();
    if (!track) {
      throw new Error('摄像头没有打开');
    }
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
  }

  grab(area: Rect): ImageData | null {
    if (!this.stream || !this.frameSize) {
      return null;
    }
    return drawToImageData(this.canvas, this.video, area);
  }

  private release(): void {
    if (this.stream) {
      stopTracks(this.stream);
    }
    this.stream = null;
    this.capabilities = {};
    this.video.srcObject = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
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

  /** 取景时保持屏幕常亮；不支持或被拒绝都不影响扫码。拿到时摄像头已经关了就立即放掉。 */
  private async keepScreenOn(generation: number): Promise<void> {
    try {
      const lock = (await navigator.wakeLock?.request('screen')) ?? null;
      if (generation === this.generation) {
        this.wakeLock = lock;
      } else {
        void lock?.release();
      }
    } catch (error) {
      console.warn('[Camera] wake lock unavailable', error);
    }
  }
}

/** 拍照识别：把照片按同样的尺寸上限画出来。 */
export async function imageFromFile(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    return drawToImageData(document.createElement('canvas'), bitmap, {
      x: 0,
      y: 0,
      width: bitmap.width,
      height: bitmap.height,
    });
  } finally {
    bitmap.close();
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** getCapabilities 在一些浏览器上不存在（旧版 Firefox），有的会抛错：都当作「什么都不支持」。 */
function readCapabilities(track: MediaStreamTrack): CameraCapabilities {
  try {
    return (track.getCapabilities?.() as CameraCapabilities | undefined) ?? {};
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

function drawToImageData(canvas: HTMLCanvasElement, source: CanvasImageSource, area: Rect): ImageData {
  const scale = Math.min(1, MAX_FRAME_EDGE_PX / Math.max(area.width, area.height));
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('浏览器不支持 canvas 2d');
  }
  context.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
