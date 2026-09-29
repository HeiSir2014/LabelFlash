/**
 * 扫码页的控制器：把状态机、会话、摄像头、解码和页面接起来。
 * 浏览器能力（摄像头、解码、振动、计时器、页面可见性）都经参数注入，用 bun test 测试；main.ts 只负责创建它们。
 */
import {
  type ImageRequest,
  isRequestRaw,
  MAX_IMAGE_BYTES,
  MAX_MANUAL_VALUE_LENGTH,
  type PhoneImage,
} from '../../../src/shared/mobile-protocol';
import type { CameraPort } from './camera';
import {
  isDoubleTap,
  type Lens,
  type Point,
  type Size,
  type Tap,
  tapToVideoPoint,
  visibleVideoRect,
} from './camera-features';
import type { Decoded, DecoderPort } from './decoder';
import { type CodeCorners, cropLabel, cropLayout, type PixelImage } from './label-crop';
import { type JobExtras, NO_EXTRAS } from './phone-session';
import {
  canSubmit,
  isFinished,
  JOB_HISTORY,
  type JobEntry,
  type PhoneEvent,
  type PhoneState,
  reducePhone,
} from './phone-state';
import {
  FAR_LENS_HINT,
  type JobAction,
  NEAR_LENS_HINT,
  PHOTO_EMPTY_HINT,
  PHOTO_FAILED_HINT,
  resultLevel,
  TOO_LONG_HINT,
  TOO_MANY_PENDING_HINT,
} from './result-view';
import { ScanGate } from './scan-gate';
import type { SoundCue } from './scan-sound';

/** 记住多少个任务带的图：和页面上保留的任务一样多就够了。 */
const JOB_EXTRAS_KEPT = JOB_HISTORY;

/** 复制一份像素（解码会把原来的转交给 worker）。 */
function copyPixels(image: ImageData): PixelImage {
  return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
}

/** 每秒解码约 6 帧：够快，又不让手机发烫。 */
export const SCAN_FRAME_INTERVAL_MS = 160;
/** 一次性提示显示多久：够看完一句话。 */
export const HINT_DISPLAY_MS = 5_000;
/** 扫到一个码时的短振动，相当于扫码枪的「嘀」（安卓支持；iPhone 的浏览器不支持振动）。 */
export const SCANNED_VIBRATE_MS = 40;
/** 故障级结果（缺纸、卡纸、离线……）的振动：两下，和「扫到了」区分开。 */
export const ALERT_VIBRATE_PATTERN_MS = [80, 60, 80];

export interface SessionPort {
  submit(raw: string, force: boolean, extras: JobExtras): string;
}

/** 提示音（sound-player.ts）；测试里换成假的。 */
export interface SoundPort {
  readonly isEnabled: boolean;
  setEnabled(on: boolean): void;
  /** 在用户点按里调用：iPhone 只允许在点按时打开或恢复声音。 */
  unlock(): void;
  play(cue: SoundCue): void;
}

export interface ViewExtras {
  hasTorch: boolean;
  isTorchOn: boolean;
  isSoundOn: boolean;
  /** 当前焦段；不能切换时为 null（不显示焦段按钮）。 */
  lens: Lens | null;
  /** 取景下方的一次性提示；没有时为 null。 */
  hint: string | null;
}

export interface ViewPort {
  render(state: PhoneState, extras: ViewExtras): void;
  /** 取景元素当前的尺寸；还没显示时为 null。 */
  viewfinderSize(): Size | null;
  showFocusRing(tap: Point): void;
}

export interface PageTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PhoneControllerDeps {
  camera: CameraPort;
  decoder: DecoderPort;
  view: ViewPort;
  readPhoto: (file: File) => Promise<ImageData>;
  /** 截下来的标签图压成 JPEG（标准 base64）；压不到上限以下时为 null。 */
  encodeJpeg: (image: PixelImage, maxBytes: number) => Promise<string | null>;
  vibrate: (pattern: number | number[]) => void;
  sound: SoundPort;
  isVisible: () => boolean;
  /** 订阅页面可见性变化，返回取消订阅的函数。 */
  watchVisibility: (listener: () => void) => () => void;
  now: () => number;
  timers: PageTimers;
  reload: () => void;
}

export class PhoneController {
  private state: PhoneState;
  private session: SessionPort | null = null;
  private readonly gate = new ScanGate();
  private isTorchOn = false;
  private isOpeningCamera = false;
  /** 上一次点按取景画面，用来认出双击；双击认出后清空，连点三下只算一次。 */
  private lastTap: Tap | null = null;
  private hint: string | null = null;
  private hintTimer: unknown = null;
  private scanTimer: unknown = null;
  private unwatchVisibility: (() => void) | null = null;
  /** 电脑要的标签图（welcome、printer 里说的）；不需要时为 null，就不截图。 */
  private imageRequest: ImageRequest | null = null;
  /** 最近的任务带的图和手动字段：点「重试」「强制补打」「再打一张」时原样带上，不能丢了货架号。 */
  private readonly jobExtras = new Map<string, JobExtras>();

  constructor(
    private readonly deps: PhoneControllerDeps,
    initial: PhoneState,
  ) {
    this.state = initial;
    deps.camera.onInterrupted = () => {
      this.isTorchOn = false;
      this.dispatch({ type: 'camera', camera: 'unavailable' });
    };
  }

  get current(): PhoneState {
    return this.state;
  }

  /** 页面加载完：画出第一屏；有会话时开始取景循环。会话的事件经 dispatch 送进来。 */
  start(session: SessionPort | null): void {
    this.session = session;
    this.render();
    if (session === null || isFinished(this.state)) {
      return;
    }
    this.scanTimer = this.deps.timers.setInterval(() => this.scanFrame(), SCAN_FRAME_INTERVAL_MS);
    this.unwatchVisibility = this.deps.watchVisibility(() => this.syncCamera());
  }

  dispatch(event: PhoneEvent): void {
    if (event.type === 'welcomed' || event.type === 'printer') {
      this.imageRequest = event.image;
    }
    const previous = this.state;
    this.state = reducePhone(previous, event);
    if (this.state === previous) {
      return;
    }
    if (event.type === 'result' && resultLevel(event.result) === 'alert') {
      this.deps.vibrate(ALERT_VIBRATE_PATTERN_MS);
      this.deps.sound.play('alert');
    }
    if (this.hint === TOO_MANY_PENDING_HINT && canSubmit(this.state)) {
      this.clearHint();
    }
    if (isFinished(this.state)) {
      this.teardown();
    }
    this.render();
    this.syncCamera();
  }

  /** 点了「开始扫码」或「重新打开摄像头」：振动、声音和摄像头授权都要在这样的点按之后。 */
  openCamera(): void {
    this.deps.sound.unlock();
    if (this.state.camera === 'idle' || this.state.camera === 'unavailable') {
      this.dispatch({ type: 'camera', camera: 'starting' });
    }
  }

  jobAction(job: JobEntry, action: JobAction): void {
    this.submit(job.raw, { explicit: true, force: action !== 'retry' }, this.jobExtras.get(job.id) ?? NO_EXTRAS);
  }

  /**
   * 在没认出的任务卡片上手动补了一个字段（例如货架号）：同一内容带着这个字段作为新任务提交，不再带图。
   * 返回是否已提交；没提交时输入框里的内容留着。
   */
  fillField(job: JobEntry, field: string, value: string): boolean {
    const text = value.trim();
    if (text === '' || text.length > MAX_MANUAL_VALUE_LENGTH) {
      return false;
    }
    return this.submit(
      job.raw,
      { explicit: true, force: false },
      { image: null, fields: [{ name: field, value: text }] },
    );
  }

  /** 手动输入：返回是否已提交，没提交时输入框里的内容留着。 */
  manual(raw: string): boolean {
    return this.submit(raw, { explicit: true, force: false }, NO_EXTRAS);
  }

  async photo(file: File): Promise<void> {
    try {
      const image = await this.deps.readPhoto(file);
      // 解码会把像素转交给 worker：要截标签图时先留一份。
      const copy = this.imageRequest === null ? null : copyPixels(image);
      const decoded = await this.deps.decoder.decode(image);
      if (decoded) {
        this.scanned(decoded, () => copy, true);
      } else {
        this.showHint(PHOTO_EMPTY_HINT);
      }
    } catch (error) {
      console.warn('[PhoneController] photo decoding failed', error);
      this.showHint(PHOTO_FAILED_HINT);
    }
  }

  /** 手电筒：设置成功后才改按钮的状态。 */
  torch(on: boolean): void {
    this.deps.camera.setTorch(on).then(
      () => {
        this.isTorchOn = on;
        this.render();
      },
      (error: unknown) => console.warn('[PhoneController] torch failed', error),
    );
  }

  /** 点按取景画面：单击对焦，双击在近焦和远焦之间切换。 */
  tapViewfinder(tap: Point): void {
    const now = this.deps.now();
    if (isDoubleTap(this.lastTap, tap, now)) {
      this.lastTap = null;
      this.switchLens();
      return;
    }
    this.lastTap = { point: tap, at: now };
    this.focusAt(tap);
  }

  /** 切换焦段（双击画面或点焦段按钮）。设备拒绝时焦段不变，按钮照实显示。 */
  switchLens(): void {
    const current = this.deps.camera.currentLens;
    if (this.state.camera !== 'live' || current === null) {
      return;
    }
    const next: Lens = current === 'near' ? 'far' : 'near';
    this.deps.camera.setLens(next).then(
      () => {
        this.showHint(next === 'far' ? FAR_LENS_HINT : NEAR_LENS_HINT);
        this.render();
      },
      (error: unknown) => console.warn('[PhoneController] lens switch failed', error),
    );
  }

  /** 点按对焦。iPhone 等不支持点按对焦的由系统自动对焦，点了也不画对焦圈，免得让人以为对焦了。 */
  private focusAt(tap: Point): void {
    const frame = this.deps.camera.frameSize;
    const element = this.deps.view.viewfinderSize();
    if (this.state.camera !== 'live' || !frame || !element || !this.deps.camera.canFocusAt) {
      return;
    }
    this.deps.view.showFocusRing(tap);
    void this.deps.camera.focusAt(tapToVideoPoint(tap, element, frame));
  }

  reload(): void {
    this.deps.reload();
  }

  /** 声音开关：点它本身就是一次点按，顺带解锁声音。 */
  toggleSound(): void {
    this.deps.sound.setEnabled(!this.deps.sound.isEnabled);
    this.deps.sound.unlock();
    this.render();
  }

  /**
   * 提交一个打印任务。explicit = 拍照识别、手动输入、点重试或补打：用户明确要打这一张，不经过取景防抖，但会被记住。
   * 取景里扫到的码要经过防抖：同一张标签停在镜头里只打一次。
   */
  private submit(raw: string, options: { explicit: boolean; force: boolean }, extras: JobExtras): boolean {
    if (!this.accept(raw, options)) {
      return false;
    }
    this.send(raw, options.force, extras);
    return true;
  }

  /**
   * 扫到一个码：能提交时先给「嘀」的反馈，再按电脑的要求截标签图，截好（或截不了）就提交。
   * 截图在同一帧的画面上做：frame 要在任何 await 之前取，下一次取景才会覆盖画面。
   */
  private scanned(decoded: Decoded, frame: () => PixelImage | null, explicit: boolean): void {
    if (!this.accept(decoded.text, { explicit, force: false })) {
      return;
    }
    const request = this.imageRequest;
    const source = request !== null && decoded.corners !== null ? frame() : null;
    if (request === null || decoded.corners === null || source === null) {
      this.send(decoded.text, false, NO_EXTRAS);
      return;
    }
    void this.labelImage(source, decoded.corners, request).then((image) =>
      this.send(decoded.text, false, { image, fields: [] }),
    );
  }

  /** 截标签图、压 JPEG；出任何问题都返回 null，这一张照样打（电脑那一步按「没有图」处理）。 */
  private async labelImage(
    source: PixelImage,
    corners: CodeCorners,
    request: ImageRequest,
  ): Promise<PhoneImage | null> {
    try {
      const crop = cropLabel(source, corners, request);
      const jpeg = crop === null ? null : await this.deps.encodeJpeg(crop, MAX_IMAGE_BYTES);
      return jpeg === null ? null : { jpeg, code: cropLayout(request).code };
    } catch (error) {
      console.warn('[PhoneController] cannot crop the label', error);
      return null;
    }
  }

  /** 能不能提交这一张（防抖、排队上限、长度）；能的话给「嘀」的反馈。 */
  private accept(raw: string, options: { explicit: boolean; force: boolean }): boolean {
    const now = this.deps.now();
    if (!this.session || !canSubmit(this.state)) {
      this.gate.observe(raw, now);
      if (this.state.screen.name === 'scanning') {
        this.showHint(TOO_MANY_PENDING_HINT);
      }
      return false;
    }
    if (options.explicit) {
      this.gate.remember(raw, now);
    } else if (!this.gate.accept(raw, now)) {
      return false;
    }
    if (!isRequestRaw(raw)) {
      this.showHint(TOO_LONG_HINT);
      return false;
    }
    this.clearHint();
    // 和扫码枪的「嘀」一样：振动给安卓，声音给所有手机（iPhone 的浏览器不能振动）。
    this.deps.vibrate(SCANNED_VIBRATE_MS);
    this.deps.sound.play('scanned');
    return true;
  }

  private send(raw: string, force: boolean, extras: JobExtras): void {
    if (!this.session) {
      return;
    }
    const job = this.session.submit(raw, force, extras);
    if (extras.image !== null || extras.fields.length > 0) {
      this.jobExtras.set(job, extras);
      // 页面上只留最近的任务：更早的图用不到了，不占内存。
      for (const id of [...this.jobExtras.keys()].slice(0, -JOB_EXTRAS_KEPT)) {
        this.jobExtras.delete(id);
      }
    }
  }

  private scanFrame(): void {
    const { camera, decoder, view } = this.deps;
    if (this.state.camera !== 'live' || !camera.isRunning || decoder.isBusy) {
      return;
    }
    const frame = camera.frameSize;
    if (!frame) {
      return;
    }
    const element = view.viewfinderSize();
    const image = camera.grab(element ? visibleVideoRect(element, frame) : { x: 0, y: 0, ...frame });
    if (!image) {
      return;
    }
    decoder.decode(image).then(
      (decoded) => {
        if (decoded) {
          this.scanned(decoded, () => camera.snapshot(), false);
        }
      },
      // 识别组件坏了由 Decoder 报告（decoder 事件），这里只记下这一帧。
      (error: unknown) => console.warn('[PhoneController] frame decoding failed', error),
    );
  }

  /** 按状态开关摄像头：只在扫码中、页面在前台、识别组件可用时开着。 */
  private syncCamera(): void {
    if (isFinished(this.state)) {
      return;
    }
    const shouldRun = this.state.screen.name === 'scanning' && this.deps.isVisible() && this.state.decoder !== 'failed';
    switch (this.state.camera) {
      case 'starting':
      case 'live':
        if (!shouldRun) {
          this.closeCamera();
        } else if (!this.deps.camera.isRunning && !this.isOpeningCamera) {
          this.startCamera();
        }
        return;
      case 'paused':
        if (shouldRun) {
          this.dispatch({ type: 'camera', camera: 'starting' });
        }
        return;
      case 'idle':
      case 'unavailable':
        return;
    }
  }

  private startCamera(): void {
    this.isOpeningCamera = true;
    this.deps.camera.start().then(
      (started) => {
        this.isOpeningCamera = false;
        if (started) {
          this.dispatch({ type: 'camera', camera: 'live' });
        } else {
          // 打开期间被关掉了（例如切到后台）：按现在的状态再对一次。
          this.syncCamera();
        }
      },
      (error: unknown) => {
        this.isOpeningCamera = false;
        console.warn('[PhoneController] camera unavailable', error);
        this.dispatch({ type: 'camera', camera: 'unavailable' });
      },
    );
  }

  private closeCamera(): void {
    this.deps.camera.stop();
    this.isTorchOn = false;
    this.dispatch({ type: 'camera', camera: 'paused' });
  }

  private showHint(text: string): void {
    this.deps.timers.clearTimeout(this.hintTimer);
    this.hintTimer = this.deps.timers.setTimeout(() => this.clearHint(), HINT_DISPLAY_MS);
    if (this.hint !== text) {
      this.hint = text;
      this.render();
    }
  }

  private clearHint(): void {
    this.deps.timers.clearTimeout(this.hintTimer);
    this.hintTimer = null;
    if (this.hint !== null) {
      this.hint = null;
      this.render();
    }
  }

  /** 会话结束：关掉摄像头、取景循环、解码 worker，不再听页面可见性。 */
  private teardown(): void {
    this.deps.timers.clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.deps.timers.clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.hint = null;
    this.unwatchVisibility?.();
    this.unwatchVisibility = null;
    this.deps.camera.stop();
    this.isTorchOn = false;
    this.deps.decoder.dispose();
  }

  private render(): void {
    this.deps.view.render(this.state, {
      hasTorch: this.state.camera === 'live' && this.deps.camera.hasTorch,
      isTorchOn: this.isTorchOn,
      isSoundOn: this.deps.sound.isEnabled,
      lens: this.state.camera === 'live' ? this.deps.camera.currentLens : null,
      hint: this.hint,
    });
  }
}
