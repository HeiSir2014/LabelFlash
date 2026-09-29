import { beforeEach, describe, expect, test } from 'bun:test';
import { MAX_PENDING_JOBS, MAX_REQUEST_RAW_LENGTH, type PhonePrintResult } from '../../../src/shared/mobile-protocol';
import { FakeTimers } from '../../../src/shared/testing/fake-socket';
import type { CameraPort } from './camera';
import { DOUBLE_TAP_MS, type Lens, type Point, type Rect, type Size } from './camera-features';
import type { Decoded, DecoderPort } from './decoder';
import type { CodeCorners, PixelImage } from './label-crop';
import {
  ALERT_VIBRATE_PATTERN_MS,
  HINT_DISPLAY_MS,
  type PageTimers,
  PhoneController,
  SCAN_FRAME_INTERVAL_MS,
  SCANNED_VIBRATE_MS,
  type SoundPort,
  type ViewExtras,
  type ViewPort,
} from './phone-controller';
import type { JobExtras } from './phone-session';
import { initialPhoneState, type PhoneState } from './phone-state';
import { FAR_LENS_HINT, NEAR_LENS_HINT, TOO_LONG_HINT, TOO_MANY_PENDING_HINT } from './result-view';
import { SAME_CODE_REARM_MS } from './scan-gate';
import type { SoundCue } from './scan-sound';

const RAW = 'CL5640-TK-图片色-XL';
const FRAME: Size = { width: 1280, height: 720 };
const VIEWFINDER: Size = { width: 360, height: 360 };

/** 页面计时器：setInterval 用反复的 setTimeout 模拟。 */
class FakePageTimers extends FakeTimers implements PageTimers {
  private readonly intervals = new Map<number, unknown>();
  private nextInterval = 1;

  setInterval(callback: () => void, ms: number): unknown {
    const id = this.nextInterval++;
    const tick = () => {
      this.intervals.set(id, this.setTimeout(tick, ms));
      callback();
    };
    this.intervals.set(id, this.setTimeout(tick, ms));
    return id;
  }

  clearInterval(handle: unknown): void {
    this.clearTimeout(this.intervals.get(handle as number));
    this.intervals.delete(handle as number);
  }
}

class FakeCamera implements CameraPort {
  isRunning = false;
  hasTorch = true;
  canFocusAt = true;
  onInterrupted: (() => void) | null = null;
  failsToStart = false;
  starts = 0;
  stops = 0;
  torchFails = false;
  grabbed: Rect[] = [];
  /** 最近一帧的像素（截标签图用）；snapshots 记下取了几次。 */
  frameImage: PixelImage | null = null;
  snapshots = 0;
  focused: Point[] = [];
  private pendingStart: ((started: boolean) => void) | null = null;
  /** true 时 start() 等测试调用 finishStart() 才完成（模拟等待授权）。 */
  holdsStart = false;

  get frameSize(): Size | null {
    return this.isRunning ? FRAME : null;
  }

  start(): Promise<boolean> {
    this.starts += 1;
    if (this.failsToStart) {
      return Promise.reject(new Error('NotAllowedError'));
    }
    if (this.holdsStart) {
      return new Promise((resolve) => {
        this.pendingStart = resolve;
      });
    }
    this.isRunning = true;
    return Promise.resolve(true);
  }

  finishStart(): void {
    const resolve = this.pendingStart;
    this.pendingStart = null;
    // 等待期间被 stop() 过就算取消。
    const cancelled = this.stops > 0;
    this.isRunning = !cancelled;
    resolve?.(!cancelled);
  }

  stop(): void {
    this.stops += 1;
    this.isRunning = false;
  }

  async focusAt(point: Point): Promise<void> {
    this.focused.push(point);
  }

  setTorch(): Promise<void> {
    return this.torchFails ? Promise.reject(new Error('OverconstrainedError')) : Promise.resolve();
  }

  grab(area: Rect): ImageData | null {
    this.grabbed.push(area);
    return {} as ImageData;
  }

  snapshot(): ImageData | null {
    this.snapshots += 1;
    return this.frameImage as ImageData | null;
  }

  /** 摄像头开着时报告当前焦段；null 表示这台设备不能切换。 */
  lens: Lens | null = 'near';
  lensFails = false;
  readonly lensSwitches: Lens[] = [];

  get currentLens(): Lens | null {
    return this.isRunning ? this.lens : null;
  }

  setLens(lens: Lens): Promise<void> {
    if (this.lensFails) {
      return Promise.reject(new Error('OverconstrainedError'));
    }
    this.lensSwitches.push(lens);
    this.lens = lens;
    return Promise.resolve();
  }
}

class FakeDecoder implements DecoderPort {
  isBusy = false;
  text: string | null = null;
  corners: CodeCorners | null = null;
  disposed = false;

  decode(): Promise<Decoded | null> {
    return Promise.resolve(this.text === null ? null : { text: this.text, corners: this.corners });
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeView implements ViewPort {
  state: PhoneState | null = null;
  extras: ViewExtras | null = null;
  rings: Point[] = [];

  render(state: PhoneState, extras: ViewExtras): void {
    this.state = state;
    this.extras = extras;
  }

  viewfinderSize(): Size | null {
    return VIEWFINDER;
  }

  showFocusRing(tap: Point): void {
    this.rings.push(tap);
  }
}

class FakeSound implements SoundPort {
  isEnabled = true;
  unlocks = 0;
  readonly played: SoundCue[] = [];

  setEnabled(on: boolean): void {
    this.isEnabled = on;
  }

  unlock(): void {
    this.unlocks += 1;
  }

  play(cue: SoundCue): void {
    this.played.push(cue);
  }
}

let timers: FakePageTimers;
let camera: FakeCamera;
let decoder: FakeDecoder;
let view: FakeView;
let sound: FakeSound;
let vibrations: (number | number[])[];
let visible: boolean;
let visibilityListener: (() => void) | null;
let submitted: { raw: string; force: boolean }[];
let extras: JobExtras[];
let jpeg: string | null;
let controller: PhoneController;
let nextJob: number;

const session = {
  submit(raw: string, force: boolean, jobExtras: JobExtras): string {
    submitted.push({ raw, force });
    extras.push(jobExtras);
    nextJob += 1;
    const job = `job${nextJob}`;
    controller.dispatch({ type: 'submitted', job, raw, force });
    return job;
  },
};

function createController(hasLink = true): PhoneController {
  return new PhoneController(
    {
      camera,
      decoder,
      view,
      readPhoto: async () => ({}) as ImageData,
      encodeJpeg: async () => jpeg,
      vibrate: (pattern) => vibrations.push(pattern),
      sound,
      isVisible: () => visible,
      watchVisibility: (listener) => {
        visibilityListener = listener;
        return () => {
          visibilityListener = null;
        };
      },
      now: () => timers.now,
      timers,
      reload: () => {},
    },
    initialPhoneState(hasLink),
  );
}

/** 让已经完成的 Promise 回调跑完。 */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
  }
}

async function scanning(): Promise<void> {
  controller.start(session);
  controller.dispatch({ type: 'welcomed', printer: '热敏标签机', image: null });
  controller.dispatch({ type: 'decoder', decoder: 'ready' });
  controller.openCamera();
  await settle();
}

/** 取景循环跑一帧，并等解码结果回来。 */
async function frame(text: string | null): Promise<void> {
  decoder.text = text;
  timers.advance(SCAN_FRAME_INTERVAL_MS);
  await settle();
}

beforeEach(() => {
  timers = new FakePageTimers();
  camera = new FakeCamera();
  decoder = new FakeDecoder();
  view = new FakeView();
  sound = new FakeSound();
  vibrations = [];
  visible = true;
  visibilityListener = null;
  submitted = [];
  extras = [];
  jpeg = '/9j/fake';
  nextJob = 0;
  controller = createController();
});

describe('PhoneController: the camera', () => {
  test('shows the page without a link and does nothing else', () => {
    controller = createController(false);
    controller.start(null);
    expect(view.state?.screen).toEqual({ name: 'no-link' });
    timers.advance(10 * SCAN_FRAME_INTERVAL_MS);
    expect(camera.grabbed).toEqual([]);
  });

  test('waits for a tap before opening the camera', async () => {
    controller.start(session);
    controller.dispatch({ type: 'welcomed', printer: null, image: null });
    await settle();
    expect(camera.starts).toBe(0);
    controller.openCamera();
    await settle();
    expect(controller.current.camera).toBe('live');
  });

  test('offers the camera again after it could not be opened', async () => {
    camera.failsToStart = true;
    await scanning();
    expect(controller.current.camera).toBe('unavailable');
    camera.failsToStart = false;
    controller.openCamera();
    await settle();
    expect(controller.current.camera).toBe('live');
  });

  test('closes the camera in the background and opens it again in front', async () => {
    await scanning();
    visible = false;
    visibilityListener?.();
    expect(camera.isRunning).toBe(false);
    expect(controller.current.camera).toBe('paused');
    visible = true;
    visibilityListener?.();
    await settle();
    expect(controller.current.camera).toBe('live');
  });

  test('cancels an opening camera when the page goes to the background', async () => {
    camera.holdsStart = true;
    await scanning();
    visible = false;
    visibilityListener?.();
    camera.finishStart();
    await settle();
    expect(camera.isRunning).toBe(false);
    expect(controller.current.camera).toBe('paused');
  });

  test('reports a camera taken away by the system', async () => {
    await scanning();
    camera.isRunning = false;
    camera.onInterrupted?.();
    expect(controller.current.camera).toBe('unavailable');
  });

  test('closes the camera when the decoder cannot load', async () => {
    await scanning();
    controller.dispatch({ type: 'decoder', decoder: 'failed' });
    expect(camera.isRunning).toBe(false);
  });

  test('turns the torch button on only after the torch did', async () => {
    await scanning();
    camera.torchFails = true;
    controller.torch(true);
    await settle();
    expect(view.extras?.isTorchOn).toBe(false);
    camera.torchFails = false;
    controller.torch(true);
    await settle();
    expect(view.extras?.isTorchOn).toBe(true);
  });

  test('focuses where the viewfinder was tapped', async () => {
    await scanning();
    controller.tapViewfinder({ x: 180, y: 180 });
    expect(view.rings).toEqual([{ x: 180, y: 180 }]);
    expect(camera.focused).toEqual([{ x: 0.5, y: 0.5 }]);
  });
});

describe('PhoneController: switching lenses', () => {
  const TAP: Point = { x: 180, y: 180 };

  async function doubleTap(): Promise<void> {
    controller.tapViewfinder(TAP);
    timers.advance(DOUBLE_TAP_MS / 2);
    controller.tapViewfinder(TAP);
    await settle();
  }

  test('shows the near lens once the camera is live', async () => {
    await scanning();
    expect(view.extras?.lens).toBe('near');
  });

  test('switches to the far lens on a double tap and back on the next one', async () => {
    await scanning();
    await doubleTap();
    expect(camera.lensSwitches).toEqual(['far']);
    expect(view.extras?.lens).toBe('far');
    expect(view.extras?.hint).toBe(FAR_LENS_HINT);
    timers.advance(DOUBLE_TAP_MS * 2);
    await doubleTap();
    expect(camera.lensSwitches).toEqual(['far', 'near']);
    expect(view.extras?.hint).toBe(NEAR_LENS_HINT);
  });

  test('does not take two slow taps as a double tap', async () => {
    await scanning();
    controller.tapViewfinder(TAP);
    timers.advance(DOUBLE_TAP_MS * 2);
    controller.tapViewfinder(TAP);
    await settle();
    expect(camera.lensSwitches).toEqual([]);
    expect(camera.focused).toHaveLength(2);
  });

  test('switches once for three quick taps', async () => {
    await scanning();
    await doubleTap();
    controller.tapViewfinder(TAP);
    await settle();
    expect(camera.lensSwitches).toEqual(['far']);
  });

  test('switches with the lens button too', async () => {
    await scanning();
    controller.switchLens();
    await settle();
    expect(camera.lensSwitches).toEqual(['far']);
  });

  test('hides the switch when the camera has a single zoom', async () => {
    camera.lens = null;
    await scanning();
    await doubleTap();
    expect(camera.lensSwitches).toEqual([]);
    expect(view.extras?.lens).toBeNull();
  });

  test('keeps the lens when the camera refuses to switch', async () => {
    camera.lensFails = true;
    await scanning();
    await doubleTap();
    expect(view.extras?.lens).toBe('near');
  });
});

describe('PhoneController: scanning', () => {
  test('decodes only the part of the frame that is visible', async () => {
    await scanning();
    await frame(null);
    expect(camera.grabbed).toEqual([{ x: 280, y: 0, width: 720, height: 720 }]);
  });

  test('prints a label held in view once and beeps', async () => {
    await scanning();
    for (let index = 0; index < 20; index += 1) {
      await frame(RAW);
    }
    expect(submitted).toEqual([{ raw: RAW, force: false }]);
    expect(vibrations).toEqual([SCANNED_VIBRATE_MS]);
    // iPhone 不能振动：声音是它唯一的「扫到了」，同一张标签停在镜头里也只响一次。
    expect(sound.played).toEqual(['scanned']);
  });

  test('beeps again when the same label comes back after leaving the view', async () => {
    await scanning();
    await frame(RAW);
    timers.advance(SAME_CODE_REARM_MS);
    await frame(RAW);
    expect(sound.played).toEqual(['scanned', 'scanned']);
  });

  test('stays quiet when nothing was sent', async () => {
    await scanning();
    controller.manual('x'.repeat(MAX_REQUEST_RAW_LENGTH + 1));
    expect(sound.played).toEqual([]);
  });

  test('does not print the label in view again after something is typed by hand', async () => {
    await scanning();
    await frame(RAW);
    expect(controller.manual('typed')).toBe(true);
    await frame(RAW);
    expect(submitted.map((entry) => entry.raw)).toEqual([RAW, 'typed']);
  });

  test('holds scanning and keeps the typed text while too many jobs wait', async () => {
    await scanning();
    for (let index = 0; index < MAX_PENDING_JOBS; index += 1) {
      controller.manual(`code${index}`);
    }
    expect(controller.manual('one more')).toBe(false);
    expect(view.extras?.hint).toBe(TOO_MANY_PENDING_HINT);
    controller.dispatch({ type: 'result', job: 'job1', result: { status: 'printed', ruleName: '', fields: [] } });
    expect(view.extras?.hint).toBeNull();
  });

  test('refuses content too long to send', async () => {
    await scanning();
    expect(controller.manual('x'.repeat(MAX_REQUEST_RAW_LENGTH + 1))).toBe(false);
    expect(view.extras?.hint).toBe(TOO_LONG_HINT);
    expect(submitted).toEqual([]);
  });

  test('lets a hint fade after a while', async () => {
    await scanning();
    controller.manual('x'.repeat(MAX_REQUEST_RAW_LENGTH + 1));
    timers.advance(HINT_DISPLAY_MS);
    expect(view.extras?.hint).toBeNull();
  });

  test('retries and forces a job from its buttons', async () => {
    await scanning();
    controller.manual(RAW);
    const job = controller.current.jobs[0];
    if (!job) {
      throw new Error('no job');
    }
    controller.jobAction(job, 'force');
    expect(submitted.at(-1)).toEqual({ raw: RAW, force: true });
  });

  // 一卷内容相同的标签：镜头一直看得到同一个码，防抖不会放行；「再打一张」明确要打，电脑的防重复窗口也不挡。
  test('prints the label again from its button while the same code stays in view', async () => {
    await scanning();
    await frame(RAW);
    const job = controller.current.jobs[0];
    if (!job) {
      throw new Error('no job');
    }
    controller.jobAction(job, 'again');
    await frame(RAW);
    expect(submitted).toEqual([
      { raw: RAW, force: false },
      { raw: RAW, force: true },
    ]);
    expect(sound.played).toEqual(['scanned', 'scanned']);
  });

  test('buzzes for a printer fault but not for content the desktop cannot read', async () => {
    await scanning();
    controller.manual('A');
    controller.manual('B');
    vibrations = [];
    const fault: PhonePrintResult = {
      status: 'failed',
      reason: 'PRINTER_NOT_READY',
      detail: null,
      issue: 'paperOut',
      field: null,
    };
    controller.dispatch({ type: 'result', job: 'job1', result: { status: 'invalid', reason: 'INVALID_CONTENT' } });
    controller.dispatch({ type: 'result', job: 'job2', result: fault });
    expect(vibrations).toEqual([ALERT_VIBRATE_PATTERN_MS]);
  });

  test('sounds the alert for a printer fault but not for content the desktop cannot read', async () => {
    await scanning();
    controller.manual('A');
    controller.manual('B');
    sound.played.length = 0;
    const fault: PhonePrintResult = {
      status: 'failed',
      reason: 'PRINTER_NOT_READY',
      detail: null,
      issue: 'paperOut',
      field: null,
    };
    controller.dispatch({ type: 'result', job: 'job1', result: { status: 'invalid', reason: 'INVALID_CONTENT' } });
    controller.dispatch({ type: 'result', job: 'job2', result: fault });
    expect(sound.played).toEqual(['alert']);
  });
});

describe('PhoneController: the label image', () => {
  const REQUEST = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 20 };
  const CORNERS: CodeCorners = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 30, y: 10 },
    bottomRight: { x: 30, y: 30 },
    bottomLeft: { x: 10, y: 30 },
  };
  const FRAME: PixelImage = { data: new Uint8ClampedArray(40 * 40 * 4).fill(200), width: 40, height: 40 };

  async function scanningWithImages(): Promise<void> {
    await scanning();
    controller.dispatch({ type: 'printer', printer: '热敏标签机', image: REQUEST });
    camera.frameImage = FRAME;
    decoder.corners = CORNERS;
  }

  test('crops the whole label from the same frame and sends it when the desktop asks', async () => {
    await scanningWithImages();
    await frame(RAW);
    expect(submitted).toEqual([{ raw: RAW, force: false }]);
    expect(extras).toEqual([{ image: { jpeg: '/9j/fake', code: { x: 50, y: 30, size: 20 } }, fields: [] }]);
    expect(camera.snapshots).toBe(1);
  });

  test('does not crop when the desktop did not ask', async () => {
    await scanning();
    camera.frameImage = FRAME;
    decoder.corners = CORNERS;
    await frame(RAW);
    expect(extras).toEqual([{ image: null, fields: [] }]);
    expect(camera.snapshots).toBe(0);
  });

  test('still prints when the image cannot be made small enough', async () => {
    await scanningWithImages();
    jpeg = null;
    await frame(RAW);
    expect(submitted).toEqual([{ raw: RAW, force: false }]);
    expect(extras).toEqual([{ image: null, fields: [] }]);
  });

  test('does not crop a label that is held in view again', async () => {
    await scanningWithImages();
    await frame(RAW);
    await frame(RAW);
    expect(camera.snapshots).toBe(1);
  });

  test('sends the same image again when a job is retried', async () => {
    await scanningWithImages();
    await frame(RAW);
    const job = view.state?.jobs[0];
    if (!job) throw new Error('expected a job');
    controller.jobAction(job, 'retry');
    expect(extras).toHaveLength(2);
    expect(extras[1]).toEqual(extras[0]);
  });

  test('sends a typed shelf number with the same content and no image', async () => {
    await scanningWithImages();
    await frame(RAW);
    const job = view.state?.jobs[0];
    if (!job) throw new Error('expected a job');
    expect(controller.fillField(job, '货架号', '   ')).toBe(false);
    expect(controller.fillField(job, '货架号', ' A-1-2-3 ')).toBe(true);
    expect(submitted.at(-1)).toEqual({ raw: RAW, force: false });
    expect(extras.at(-1)).toEqual({ image: null, fields: [{ name: '货架号', value: 'A-1-2-3' }] });
  });
});

describe('PhoneController: sound', () => {
  test('unlocks sound with the tap that opens the camera, as iPhone requires', async () => {
    await scanning();
    expect(sound.unlocks).toBe(1);
  });

  test('turns sound off and on from its switch and shows the state', async () => {
    await scanning();
    expect(view.extras?.isSoundOn).toBe(true);
    controller.toggleSound();
    expect(sound.isEnabled).toBe(false);
    expect(view.extras?.isSoundOn).toBe(false);
    controller.toggleSound();
    expect(sound.isEnabled).toBe(true);
    // 「开始扫码」解锁一次；每点一下开关也是一次点按，同样用来解锁声音。
    expect(sound.unlocks).toBe(3);
  });
});

describe('PhoneController: the end', () => {
  test('lets go of the camera, the decoder and the page once the session ends', async () => {
    await scanning();
    controller.dispatch({ type: 'ended', reason: 'stopped' });
    expect(camera.isRunning).toBe(false);
    expect(decoder.disposed).toBe(true);
    expect(visibilityListener).toBeNull();
    const grabs = camera.grabbed.length;
    timers.advance(10 * SCAN_FRAME_INTERVAL_MS);
    expect(camera.grabbed).toHaveLength(grabs);
  });
});
