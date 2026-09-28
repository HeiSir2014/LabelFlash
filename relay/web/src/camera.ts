/**
 * 摄像头：打开后置摄像头、取帧、手电筒、屏幕常亮，以及拍照识别时读取照片。
 * 这些都是浏览器 API 的薄封装，由假摄像头的浏览器测试和真机验收覆盖。
 */

/** 取帧时把画面缩到最长边不超过这个值：再大解码更慢，识别率也不会更高。 */
const MAX_FRAME_EDGE_PX = 1280;

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

export class Camera {
  private stream: MediaStream | null = null;
  private readonly canvas = document.createElement('canvas');
  private wakeLock: WakeLockSentinel | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  get isRunning(): boolean {
    return this.stream !== null;
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
    await this.keepScreenOn();
  }

  stop(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
    void this.wakeLock?.release();
    this.wakeLock = null;
  }

  get hasTorch(): boolean {
    const track = this.stream?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
    return capabilities?.torch === true;
  }

  async setTorch(on: boolean): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
  }

  /** 当前画面；还没有画面时返回 null。 */
  grab(): ImageData | null {
    const { videoWidth, videoHeight } = this.video;
    if (!this.stream || videoWidth === 0 || videoHeight === 0) {
      return null;
    }
    return drawToImageData(this.canvas, this.video, videoWidth, videoHeight);
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
