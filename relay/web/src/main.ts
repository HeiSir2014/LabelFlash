/**
 * 扫码页入口：读链接里的会话号和密钥，接上连接、摄像头、解码和状态机。
 * 状态转换在 phone-state.ts，文字在 result-view.ts，这里只做接线。
 */
import { importSessionKey } from '../../../src/shared/mobile-crypto';
import { MAX_PENDING_JOBS, parsePhoneFragment } from '../../../src/shared/mobile-protocol';
import { Camera, imageFromFile } from './camera';
import { Decoder } from './decoder';
import { deviceLabel } from './device-label';
import { PhoneSession } from './phone-session';
import { canSubmit, initialPhoneState, type PhoneEvent, type PhoneState, reducePhone } from './phone-state';
import { ScanGate } from './scan-gate';
import { createTokenStore, type KeyValueStorage } from './token-store';
import { PhoneView } from './view';

/** 相对页面地址，由 scripts/relay/build.ts 注入（带内容哈希）。 */
declare const DECODE_WORKER_URL: string;

/** 每秒解码约 6 帧：够快，又不让手机发烫。 */
const SCAN_FRAME_INTERVAL_MS = 160;
/** 扫到一个码时的短振动，相当于扫码枪的「嘀」（安卓支持；iPhone 的浏览器不支持振动）。 */
const SCANNED_VIBRATE_MS = 40;
/** 打印出问题时的振动：两下，和「扫到了」区分开。 */
const PROBLEM_VIBRATE_PATTERN_MS = [80, 60, 80];
const FINISHED_SCREENS: ReadonlySet<PhoneState['screen']> = new Set(['no-link', 'ended', 'not-found', 'taken']);

const fragment = parsePhoneFragment(location.hash);
let state: PhoneState = initialPhoneState(fragment !== null);
let session: PhoneSession | null = null;
let isTorchOn = false;
let hint: string | null = null;

const gate = new ScanGate();
const camera = new Camera(document.getElementById('video') as HTMLVideoElement);
const decoder = new Decoder(new URL(DECODE_WORKER_URL, document.baseURI).href);
const view = new PhoneView(document, {
  onJobAction: (job, action) => submit(job.raw, { explicit: true, force: action === 'force' }),
  onPhoto: (file) => void decodePhoto(file),
  onManual: (raw) => submit(raw, { explicit: true, force: false }),
  onTorch: (on) => {
    isTorchOn = on;
    void camera.setTorch(on).catch((error) => console.warn('[main] torch failed', error));
    render();
  },
});

function render(): void {
  view.render(state, { hasTorch: camera.isRunning && camera.hasTorch, isTorchOn }, hint);
}

function dispatch(event: PhoneEvent): void {
  const previous = state;
  state = reducePhone(state, event);
  if (state === previous) {
    return;
  }
  if (event.type === 'result' && event.result.status !== 'printed' && event.result.status !== 'duplicate') {
    navigator.vibrate?.(PROBLEM_VIBRATE_PATTERN_MS);
  }
  render();
  syncCamera();
}

function showHint(text: string | null): void {
  hint = text;
  render();
}

/**
 * 提交一个打印任务。explicit = 拍照识别、手动输入、点重试或补打：用户明确要打这一张，不经过取景防抖。
 * 取景里扫到的码要经过防抖：同一张标签停在镜头里只打一次。
 */
function submit(raw: string, options: { explicit: boolean; force: boolean }): void {
  const now = Date.now();
  if (!session || !canSubmit(state)) {
    gate.observe(raw, now);
    if (state.screen === 'scanning') {
      showHint(`还有 ${MAX_PENDING_JOBS} 张在等结果，稍等再扫`);
    }
    return;
  }
  if (options.explicit) {
    gate.remember(raw, now);
  } else if (!gate.accept(raw, now)) {
    return;
  }
  const job = session.submit(raw, options.force);
  navigator.vibrate?.(SCANNED_VIBRATE_MS);
  hint = null;
  dispatch({ type: 'submitted', job, raw, force: options.force });
}

/** 会话进行中且页面可见时开着摄像头；结束了或切到后台就关掉。 */
function syncCamera(): void {
  const wantsCamera = state.screen === 'scanning' && document.visibilityState === 'visible';
  if (!wantsCamera) {
    if (camera.isRunning) {
      camera.stop();
      isTorchOn = false;
    }
    return;
  }
  if (camera.isRunning || state.camera === 'unavailable') {
    return;
  }
  camera.start().then(
    () => dispatch({ type: 'camera', camera: 'live' }),
    (error: unknown) => {
      console.warn('[main] camera unavailable', error);
      dispatch({ type: 'camera', camera: 'unavailable' });
    },
  );
}

async function decodePhoto(file: File): Promise<void> {
  try {
    const text = await decoder.decode(await imageFromFile(file));
    if (text) {
      submit(text, { explicit: true, force: false });
    } else {
      showHint('照片里没有找到条码或二维码。靠近一点、对准后再拍。');
    }
  } catch (error) {
    console.warn('[main] photo decoding failed', error);
    showHint('这张照片读不出来，换一张再试。');
  }
}

function scanFrame(): void {
  if (state.screen !== 'scanning' || !camera.isRunning || decoder.isBusy) {
    return;
  }
  const image = camera.grab();
  if (!image) {
    return;
  }
  void decoder.decode(image).then((text) => {
    if (text) {
      submit(text, { explicit: false, force: false });
    }
  });
}

function safeLocalStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  render();
  if (!fragment || FINISHED_SCREENS.has(state.screen)) {
    return;
  }
  // 页面在 <中转地址>m/，WebSocket 在 <中转地址>ws/phone。
  const socketUrl = new URL('../ws/phone', location.href);
  socketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  session = new PhoneSession({
    relayUrl: socketUrl.href,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device: deviceLabel(navigator.userAgent),
    tokens: createTokenStore(safeLocalStorage()),
    createSocket: (url) => new WebSocket(url),
    timers: {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
    now: () => Date.now(),
    onEvent: dispatch,
  });
  session.start();
  window.setInterval(scanFrame, SCAN_FRAME_INTERVAL_MS);
  document.addEventListener('visibilitychange', syncCamera);
}

void start();
