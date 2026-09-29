/**
 * 扫码页入口：读链接里的会话号和密钥，创建真实的摄像头、解码器、页面和会话，交给 PhoneController。
 * 状态转换在 phone-state.ts，文字在 result-view.ts，编排在 phone-controller.ts，这里只做接线。
 */
import { importSessionKey } from '../../../src/shared/mobile-crypto';
import { parsePhoneFragment } from '../../../src/shared/mobile-protocol';
import { Camera, imageFromFile } from './camera';
import { Decoder } from './decoder';
import { deviceLabel } from './device-label';
import { PhoneController } from './phone-controller';
import { PhoneSession } from './phone-session';
import { initialPhoneState } from './phone-state';
import { readSoundSetting, writeSoundSetting } from './scan-sound';
import { type KeyValueStorage, openSessionStore } from './session-store';
import { SoundPlayer } from './sound-player';
import { PhoneView } from './view';

/** 相对页面地址，由 scripts/relay/build.ts 注入（带内容哈希）。 */
declare const DECODE_WORKER_URL: string;

function safeLocalStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  const fragment = parsePhoneFragment(location.hash);
  const camera = new Camera(document.getElementById('video') as HTMLVideoElement);
  // 控制器要先有，页面和解码器的回调才能交给它；构造完之前它们不会触发。
  let controller: PhoneController | null = null;
  const decoder = new Decoder(new URL(DECODE_WORKER_URL, document.baseURI).href, (status) =>
    controller?.dispatch({ type: 'decoder', decoder: status }),
  );
  const view = new PhoneView(document, {
    onOpenCamera: () => controller?.openCamera(),
    onJobAction: (job, action) => controller?.jobAction(job, action),
    onPhoto: (file) => void controller?.photo(file),
    onManual: (raw) => controller?.manual(raw) ?? false,
    onTorch: (on) => controller?.torch(on),
    onToggleSound: () => controller?.toggleSound(),
    onViewfinderTap: (tap) => controller?.focusAt(tap),
    onReload: () => controller?.reload(),
  });
  const storage = safeLocalStorage();
  const sound = new SoundPlayer(readSoundSetting(storage), (isOn) => writeSoundSetting(storage, isOn));
  // 页面上的任何一次点按都顺带解锁 / 恢复声音：iPhone 切到后台再回来会把声音挂起，要等下一次点按才能恢复。
  document.addEventListener('pointerdown', () => sound.unlock(), { capture: true, passive: true });
  const pageController = new PhoneController(
    {
      camera,
      decoder,
      view,
      readPhoto: imageFromFile,
      // 没有振动的浏览器（iPhone）上什么都不做；还没点按过页面时浏览器会忽略振动。
      vibrate: (pattern) => void navigator.vibrate?.(pattern),
      sound,
      isVisible: () => document.visibilityState === 'visible',
      watchVisibility: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
      now: () => Date.now(),
      timers: {
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
        setInterval: (callback, ms) => window.setInterval(callback, ms),
        clearInterval: (handle) => window.clearInterval(handle as number),
      },
      reload: () => location.reload(),
    },
    initialPhoneState(fragment !== null),
  );
  controller = pageController;
  if (!fragment) {
    decoder.dispose();
    pageController.start(null);
    return;
  }
  // 页面在 <中转地址>m/，WebSocket 在 <中转地址>ws/phone。
  const socketUrl = new URL('../ws/phone', location.href);
  socketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const session = new PhoneSession({
    relayUrl: socketUrl.href,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device: deviceLabel(navigator.userAgent),
    store: openSessionStore(storage, fragment.session, () => Date.now()),
    createSocket: (url) => new WebSocket(url),
    timers: {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
    now: () => Date.now(),
    onEvent: (event) => pageController.dispatch(event),
  });
  pageController.start(session);
  session.start();
}

start().catch((error: unknown) => {
  // 走到这里是页面本身出了问题（例如浏览器不支持 WebCrypto）：显示出来，不留一个空白页。
  console.error('[main] the scan page could not start', error);
  const title = document.getElementById('message-title');
  if (title) {
    title.textContent = '这个浏览器打不开扫码页，请换用系统浏览器或微信再试';
  }
});
