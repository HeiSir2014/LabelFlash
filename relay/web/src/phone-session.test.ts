import { beforeEach, describe, expect, test } from 'bun:test';
import { importSessionKey, openMessage, randomId, randomKey, sealMessage } from '../../../src/shared/mobile-crypto';
import {
  DESKTOP_GRACE_MS,
  type DesktopMessage,
  JOB_ACK_TIMEOUT_MS,
  JOB_STATUS_POLL_MS,
  MAX_REQUEST_RAW_LENGTH,
  MOBILE_PROTOCOL_VERSION,
  type PhonePrintResult,
  type SealedBody,
} from '../../../src/shared/mobile-protocol';
import { FakeSocket, FakeTimers } from '../../../src/shared/testing/fake-socket';
import { PhoneSession, type SessionEvent } from './phone-session';
import { JOB_HISTORY } from './phone-state';
import { openSessionStore, type SessionStore } from './session-store';

const URL = 'wss://relay.example.com/labelflash/ws/phone';
const SESSION = randomId();
const RAW = 'CL5640-TK-图片色-XL';
const WAIT_LIMIT_MS = 2_000;
const PRINTED: PhonePrintResult = { status: 'printed', ruleName: '横杠三段', fields: [] };

let key: CryptoKey;
let timers: FakeTimers;
let sockets: FakeSocket[];
let events: SessionEvent[];
let store: SessionStore;
let phone: PhoneSession;

function socket(): FakeSocket {
  const latest = sockets.at(-1);
  if (!latest) {
    throw new Error('no socket');
  }
  return latest;
}

function createPhone(): PhoneSession {
  return new PhoneSession({
    relayUrl: URL,
    session: SESSION,
    key,
    device: 'iPhone · 微信',
    store,
    timers,
    now: () => timers.now,
    createSocket: (url) => {
      const created = new FakeSocket(url);
      sockets.push(created);
      return created;
    },
    onEvent: (event) => events.push(event),
  });
}

/** 加解密用的是真实的 WebCrypto（异步）：等到条件成立，最多 2 秒。 */
async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await Bun.sleep(1);
  }
}

function sentBodies(): SealedBody[] {
  return socket()
    .frames()
    .filter((frame): frame is { t: 'send'; body: SealedBody } => (frame as { t: string }).t === 'send')
    .map((frame) => frame.body);
}

/** 手机在当前连接上发出的内层消息（解密后）。 */
function sentMessages(): Promise<Record<string, unknown>[]> {
  return Promise.all(
    sentBodies().map(async (body) => (await openMessage(key, 'p2d', SESSION, body)) as Record<string, unknown>),
  );
}

async function submits(): Promise<Record<string, unknown>[]> {
  return (await sentMessages()).filter((message) => message['type'] === 'submit');
}

/** 执行 action，等手机在当前连接上一共发出 count 条加密消息。 */
async function expectSent(count: number, action: () => void = () => {}): Promise<void> {
  action();
  await waitFor(() => sentBodies().length >= count, `${count} outgoing messages`);
}

/** 执行 action，等多收到一个事件。 */
async function expectEvent(action: () => void | Promise<void>): Promise<void> {
  const before = events.length;
  await action();
  await waitFor(() => events.length > before, 'a session event');
}

async function fromDesktop(message: DesktopMessage): Promise<void> {
  socket().receiveFrame({ t: 'recv', body: await sealMessage(key, 'd2p', SESSION, message) });
}

async function welcome(nonce = randomId()): Promise<string> {
  socket().open();
  await expectSent(1, () => socket().receiveFrame({ t: 'online' }));
  await expectEvent(() =>
    fromDesktop({ type: 'welcome', token: randomId(), nonce, printer: '热敏标签机', image: null }),
  );
  return nonce;
}

async function reconnect(): Promise<string> {
  socket().drop();
  timers.advance(1_000);
  return welcome();
}

/** 让时间过去，同时保持连接活着（每秒回一个 pong），只是任务没有回音。 */
function keepAliveFor(ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
    timers.advance(1_000);
    socket().receiveFrame({ t: 'pong' });
  }
}

beforeEach(async () => {
  key = await importSessionKey(randomKey());
  timers = new FakeTimers();
  sockets = [];
  events = [];
  store = openSessionStore(null, SESSION, () => timers.now);
  phone = createPhone();
  phone.start();
});

/** 一帧标签图：JPEG 原始字节（FF D8 FF 开头）。 */
const LABEL_IMAGE = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), code: { x: 325, y: 195, size: 130 } };

describe('PhoneSession: joining', () => {
  test('joins the session, then says hello once the desktop is online', async () => {
    socket().open();
    expect(socket().frames()).toEqual([{ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: SESSION }]);
    await expectSent(1, () => socket().receiveFrame({ t: 'online' }));
    expect(await sentMessages()).toEqual([{ type: 'hello', token: null, device: 'iPhone · 微信' }]);
  });

  test('keeps the token and reports the printer on welcome', async () => {
    const token = randomId();
    socket().open();
    await expectSent(1, () => socket().receiveFrame({ t: 'online' }));
    await expectEvent(() =>
      fromDesktop({ type: 'welcome', token, nonce: randomId(), printer: '热敏标签机', image: null }),
    );
    expect(store.token).toBe(token);
    expect(events).toContainEqual({ type: 'welcomed', printer: '热敏标签机', image: null });
  });

  test('passes on the label image the desktop asks for', async () => {
    socket().open();
    await expectSent(1, () => socket().receiveFrame({ t: 'online' }));
    const image = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130, frames: 3 };
    await expectEvent(() =>
      fromDesktop({ type: 'welcome', token: randomId(), nonce: randomId(), printer: null, image }),
    );
    expect(events).toContainEqual({ type: 'welcomed', printer: null, image });
    await expectEvent(() => fromDesktop({ type: 'printer', printer: null, image: null }));
    expect(events.at(-1)).toEqual({ type: 'printer', printer: null, image: null });
  });

  test('says hello with the saved token after reconnecting', async () => {
    await welcome();
    const token = store.token;
    socket().drop();
    timers.advance(1_000);
    socket().open();
    await expectSent(1, () => socket().receiveFrame({ t: 'online' }));
    expect(await sentMessages()).toEqual([{ type: 'hello', token, device: 'iPhone · 微信' }]);
  });

  test('passes on printer changes', async () => {
    await welcome();
    await expectEvent(() => fromDesktop({ type: 'printer', printer: null, image: null }));
    expect(events.at(-1)).toEqual({ type: 'printer', printer: null, image: null });
  });
});

describe('PhoneSession: jobs', () => {
  test('submits jobs with the connection nonce, increasing sequence numbers and fresh job ids', async () => {
    const nonce = await welcome();
    const first = phone.submit(RAW, false);
    const second = phone.submit(RAW, true);
    await expectSent(3);
    expect(await submits()).toEqual([
      { type: 'submit', nonce, seq: 1, job: first, raw: RAW, force: false, images: [], fields: [] },
      { type: 'submit', nonce, seq: 2, job: second, raw: RAW, force: true, images: [], fields: [] },
    ]);
    expect(first).not.toBe(second);
    expect(events).toContainEqual({ type: 'submitted', job: first, raw: RAW, force: false });
  });

  test('sends the label frames and typed fields with a job', async () => {
    const nonce = await welcome();
    const images = [LABEL_IMAGE, { ...LABEL_IMAGE, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe1]) }];
    const fields = [{ name: '货架号', value: 'A-1-2-3' }];
    const job = phone.submit(RAW, false, { images, fields });
    await expectSent(2);
    expect(await submits()).toEqual([{ type: 'submit', nonce, seq: 1, job, raw: RAW, force: false, images, fields }]);
  });

  test('refuses content beyond the request limit before sending anything', () => {
    expect(() => phone.submit('x'.repeat(MAX_REQUEST_RAW_LENGTH + 1), false)).toThrow();
    expect(store.jobs).toEqual([]);
  });

  test('reports queue positions, starts, results and refusals', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'accepted', job, ahead: 2 }));
    await expectEvent(() => fromDesktop({ type: 'queue', jobs: [{ job, ahead: 0 }] }));
    await expectEvent(() => fromDesktop({ type: 'started', job }));
    await expectEvent(() => fromDesktop({ type: 'result', job, result: PRINTED }));
    const refusedJob = phone.submit(RAW, false);
    await expectSent(3);
    await expectEvent(() => fromDesktop({ type: 'refused', job: refusedJob, reason: 'too-many-pending' }));
    expect(events.filter((event) => event.type !== 'submitted').slice(-5)).toEqual([
      { type: 'queued', positions: [{ job, ahead: 2 }] },
      { type: 'queued', positions: [{ job, ahead: 0 }] },
      { type: 'started', job },
      { type: 'result', job, result: PRINTED },
      { type: 'refused', job: refusedJob, reason: 'too-many-pending' },
    ]);
  });

  test('passes on only the queue positions of jobs still waiting', async () => {
    await welcome();
    const waiting = phone.submit(RAW, false);
    const done = phone.submit('OTHER', false);
    await expectSent(3);
    await expectEvent(() => fromDesktop({ type: 'result', job: done, result: PRINTED }));
    await expectEvent(() =>
      fromDesktop({
        type: 'queue',
        jobs: [
          { job: waiting, ahead: 0 },
          { job: done, ahead: 1 },
        ],
      }),
    );
    expect(events.at(-1)).toEqual({ type: 'queued', positions: [{ job: waiting, ahead: 0 }] });
  });

  test('holds jobs scanned while offline and sends them once welcomed', async () => {
    const job = phone.submit(RAW, false);
    const nonce = await welcome();
    await expectSent(2);
    expect(await submits()).toEqual([
      { type: 'submit', nonce, seq: 1, job, raw: RAW, force: false, images: [], fields: [] },
    ]);
  });

  test('resends unfinished jobs with the same id after reconnecting, and forgets finished ones', async () => {
    await welcome();
    const finished = phone.submit(RAW, false);
    const unfinished = phone.submit('OTHER', false);
    await expectSent(3);
    await expectEvent(() => fromDesktop({ type: 'accepted', job: unfinished, ahead: 0 }));
    await expectEvent(() => fromDesktop({ type: 'result', job: finished, result: PRINTED }));
    const nonce = await reconnect();
    await expectSent(2);
    expect(await submits()).toEqual([
      { type: 'submit', nonce, seq: 1, job: unfinished, raw: 'OTHER', force: false, images: [], fields: [] },
    ]);
  });

  test('resends a job that was not acknowledged in time', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    keepAliveFor(JOB_ACK_TIMEOUT_MS);
    await expectSent(3);
    expect((await submits()).map((message) => message['job'])).toEqual([job, job]);
  });

  test('asks again about an accepted job that has made no progress for a while', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'accepted', job, ahead: 3 }));
    keepAliveFor(JOB_STATUS_POLL_MS - 1_000);
    await Bun.sleep(20);
    expect(await submits()).toHaveLength(1);
    keepAliveFor(1_000);
    await expectSent(3);
    expect((await submits()).map((message) => message['job'])).toEqual([job, job]);
  });

  test('stops asking once the result is in', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'result', job, result: PRINTED }));
    keepAliveFor(2 * JOB_STATUS_POLL_MS);
    await Bun.sleep(20);
    expect(await submits()).toHaveLength(1);
  });

  test('ignores results for jobs it does not know', async () => {
    await welcome();
    const before = events.length;
    await fromDesktop({ type: 'result', job: randomId(), result: PRINTED });
    await expectEvent(() => fromDesktop({ type: 'printer', printer: 'X', image: null }));
    expect(events.slice(before)).toEqual([{ type: 'printer', printer: 'X', image: null }]);
  });
});

describe('PhoneSession: surviving a page reload', () => {
  test('saves the jobs still waiting for a result', async () => {
    await welcome();
    const waiting = phone.submit(RAW, false);
    const done = phone.submit('OTHER', true);
    await expectSent(3);
    await expectEvent(() => fromDesktop({ type: 'result', job: done, result: PRINTED }));
    expect(store.jobs).toEqual([{ id: waiting, raw: RAW, force: false, images: [], fields: [] }]);
  });

  test('shows the saved jobs on start and sends them with the same ids once welcomed', async () => {
    const job = phone.submit(RAW, false);
    phone.stop();
    events = [];
    phone = createPhone();
    phone.start();
    expect(events).toEqual([{ type: 'submitted', job, raw: RAW, force: false }]);
    const nonce = await welcome();
    await expectSent(2);
    expect(await submits()).toEqual([
      { type: 'submit', nonce, seq: 1, job, raw: RAW, force: false, images: [], fields: [] },
    ]);
  });

  // 页面被刷新：还没结果的任务连同标签图一起留着，重新连上后原样重发（不然会打出没有货架号的标签）。
  test('keeps the label frames of a waiting job across a reload', async () => {
    const images = [LABEL_IMAGE, LABEL_IMAGE];
    const job = phone.submit(RAW, false, { images, fields: [] });
    expect(store.jobs).toEqual([{ id: job, raw: RAW, force: false, images, fields: [] }]);
    phone.stop();
    phone = createPhone();
    phone.start();
    const nonce = await welcome();
    await expectSent(2);
    expect(await submits()).toEqual([
      { type: 'submit', nonce, seq: 1, job, raw: RAW, force: false, images, fields: [] },
    ]);
  });

  test('waits for the desktop after a reload when it had been welcomed before', async () => {
    await welcome();
    phone.stop();
    events = [];
    phone = createPhone();
    phone.start();
    socket().open();
    socket().receiveFrame({ t: 'not-found' });
    await expectEvent(() => socket().drop());
    expect(events).toEqual([{ type: 'link', link: 'desktop-offline' }]);
  });

  test('clears the saved jobs when the session ends', async () => {
    await welcome();
    phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => socket().receiveFrame({ t: 'ended', reason: 'stopped' }));
    expect(store.jobs).toEqual([]);
  });
});

// 「重试」「强制补打」「再打一张」按原样重发：内容、标签图、手动字段都由会话保管（唯一的来源），
// 页面刷新后恢复的任务也一样。原来控制器另存一份、只在内存里，刷新后恢复的任务重发时丢了货架号。
describe('PhoneSession: what a job sent', () => {
  const FAILED: PhonePrintResult = {
    status: 'failed',
    reason: 'PRINT_TIMEOUT',
    detail: null,
    issue: null,
    field: null,
  };
  const extras = { images: [LABEL_IMAGE], fields: [{ name: '货架号', value: 'A-1-2-3' }] };

  test('keeps the frames and typed fields of a job after its result arrives', async () => {
    await welcome();
    const job = phone.submit(RAW, false, extras);
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'result', job, result: FAILED }));
    expect(phone.requestOf(job)).toEqual({ raw: RAW, ...extras });
  });

  test('keeps them for a job restored after a page reload', async () => {
    const job = phone.submit(RAW, false, extras);
    phone.stop();
    phone = createPhone();
    phone.start();
    await welcome();
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'result', job, result: FAILED }));
    expect(phone.requestOf(job)).toEqual({ raw: RAW, ...extras });
  });

  // 和页面上显示的任务一样多：更早的卡片已经不显示了，它们的图不再占内存。
  test('forgets finished jobs beyond the history the page shows, but never a waiting one', async () => {
    await welcome();
    const waiting = phone.submit('WAITING', false, extras);
    const finished: string[] = [];
    for (let index = 0; index <= JOB_HISTORY; index += 1) {
      const job = phone.submit(`JOB-${index}`, false);
      finished.push(job);
      await expectEvent(() => fromDesktop({ type: 'result', job, result: PRINTED }));
    }
    expect(phone.requestOf(finished[0] ?? '')).toBeNull();
    expect(phone.requestOf(finished.at(-1) ?? '')).toEqual({ raw: `JOB-${JOB_HISTORY}`, images: [], fields: [] });
    expect(phone.requestOf(waiting)).toEqual({ raw: 'WAITING', ...extras });
  });

  test('knows nothing about a job it never sent', () => {
    expect(phone.requestOf(randomId())).toBeNull();
  });
});

describe('PhoneSession: link and session end', () => {
  test('reports a dropped link without losing jobs', async () => {
    await welcome();
    phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => socket().drop());
    expect(events.at(-1)).toEqual({ type: 'link', link: 'reconnecting' });
    expect(store.jobs).toHaveLength(1);
  });

  test('reports a desktop that stepped away', async () => {
    socket().open();
    await expectEvent(() => socket().receiveFrame({ t: 'waiting' }));
    expect(events.at(-1)).toEqual({ type: 'link', link: 'desktop-offline' });
  });

  test('reports a phone turned away because the session is full', async () => {
    socket().open();
    await expectSent(1, () => socket().receiveFrame({ t: 'online' }));
    await expectEvent(() => fromDesktop({ type: 'denied', reason: 'full' }));
    expect(events.at(-1)).toEqual({ type: 'denied', reason: 'full' });
  });

  test('treats being disconnected by the desktop as being removed', async () => {
    await welcome();
    await expectEvent(() => socket().receiveFrame({ t: 'kicked' }));
    expect(events.at(-1)).toEqual({ type: 'denied', reason: 'removed' });
  });

  test('reports the end of the session', async () => {
    await welcome();
    await expectEvent(() => socket().receiveFrame({ t: 'ended', reason: 'stopped' }));
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'stopped' });
  });

  test('asks for a reload when the relay speaks another protocol version, and stops retrying', async () => {
    socket().open();
    await expectEvent(() => socket().receiveFrame({ t: 'error', code: 'version' }));
    expect(events.at(-1)).toEqual({ type: 'outdated' });
    socket().drop();
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  test('treats an unknown session as gone when it was never welcomed', async () => {
    socket().open();
    await expectEvent(() => socket().receiveFrame({ t: 'not-found' }));
    expect(events.at(-1)).toEqual({ type: 'not-found' });
  });

  test('waits for the desktop through the grace period when the relay forgot the session', async () => {
    await welcome();
    socket().receiveFrame({ t: 'not-found' });
    await expectEvent(() => socket().drop());
    expect(events.at(-1)).toEqual({ type: 'link', link: 'desktop-offline' });
    // 每次按退避重连，中转服务都回 not-found 再断开，直到过了宽限期。
    const start = timers.now;
    let handled = sockets.length;
    while (!events.some((event) => event.type === 'not-found')) {
      if (timers.now - start > 2 * DESKTOP_GRACE_MS) {
        throw new Error('never gave up on the session');
      }
      timers.advance(1_000);
      if (sockets.length > handled) {
        handled = sockets.length;
        socket().open();
        socket().receiveFrame({ t: 'not-found' });
        await Bun.sleep(1);
        socket().drop();
        await Bun.sleep(1);
      }
    }
    expect(timers.now - start).toBeGreaterThanOrEqual(DESKTOP_GRACE_MS - 30_000);
  });

  test('drops messages it cannot decrypt', async () => {
    socket().open();
    socket().receiveFrame({ t: 'recv', body: { iv: new Uint8Array(12), ct: new Uint8Array([1, 2, 3]) } });
    await expectEvent(() => socket().receiveFrame({ t: 'waiting' }));
    expect(events).toEqual([{ type: 'link', link: 'desktop-offline' }]);
  });
});
