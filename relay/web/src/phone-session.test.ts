import { beforeEach, describe, expect, test } from 'bun:test';
import { importSessionKey, openMessage, randomId, randomKey, sealMessage } from '../../../src/shared/mobile-crypto';
import {
  DESKTOP_GRACE_MS,
  type DesktopMessage,
  JOB_ACK_TIMEOUT_MS,
  MOBILE_PROTOCOL_VERSION,
  type PhonePrintResult,
  type SealedBody,
} from '../../../src/shared/mobile-protocol';
import { FakeSocket, FakeTimers } from '../../../src/shared/testing/fake-socket';
import { PhoneSession, type SessionEvent } from './phone-session';
import { createTokenStore, type TokenStore } from './token-store';

const URL = 'wss://relay.example.com/labelflash/ws/phone';
const SESSION = randomId();
const RAW = 'CL5640-TK-图片色-XL';
const WAIT_LIMIT_MS = 2_000;
const PRINTED: PhonePrintResult = { status: 'printed', ruleName: '横杠三段', fields: [] };

let key: CryptoKey;
let timers: FakeTimers;
let sockets: FakeSocket[];
let events: SessionEvent[];
let tokens: TokenStore;
let phone: PhoneSession;

function socket(): FakeSocket {
  const latest = sockets.at(-1);
  if (!latest) {
    throw new Error('no socket');
  }
  return latest;
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
  socket().receive(JSON.stringify({ t: 'recv', body: await sealMessage(key, 'd2p', SESSION, message) }));
}

async function welcome(nonce = randomId()): Promise<string> {
  socket().open();
  await expectSent(1, () => socket().receive('{"t":"online"}'));
  await expectEvent(() => fromDesktop({ type: 'welcome', token: randomId(), nonce, printer: '热敏标签机' }));
  return nonce;
}

async function reconnect(): Promise<string> {
  socket().drop();
  timers.advance(1_000);
  return welcome();
}

beforeEach(async () => {
  key = await importSessionKey(randomKey());
  timers = new FakeTimers();
  sockets = [];
  events = [];
  tokens = createTokenStore(null);
  phone = new PhoneSession({
    relayUrl: URL,
    session: SESSION,
    key,
    device: 'iPhone · 微信',
    tokens,
    timers,
    now: () => timers.now,
    createSocket: (url) => {
      const created = new FakeSocket(url);
      sockets.push(created);
      return created;
    },
    onEvent: (event) => events.push(event),
  });
  phone.start();
});

describe('PhoneSession: joining', () => {
  test('joins the session, then says hello once the desktop is online', async () => {
    socket().open();
    expect(socket().frames()).toEqual([{ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: SESSION }]);
    await expectSent(1, () => socket().receive('{"t":"online"}'));
    expect(await sentMessages()).toEqual([{ type: 'hello', token: null, device: 'iPhone · 微信' }]);
  });

  test('keeps the token and reports the printer on welcome', async () => {
    const token = randomId();
    socket().open();
    await expectSent(1, () => socket().receive('{"t":"online"}'));
    await expectEvent(() => fromDesktop({ type: 'welcome', token, nonce: randomId(), printer: '热敏标签机' }));
    expect(tokens.get(SESSION)).toBe(token);
    expect(events).toContainEqual({ type: 'welcomed', printer: '热敏标签机' });
  });

  test('says hello with the saved token after reconnecting', async () => {
    await welcome();
    const token = tokens.get(SESSION);
    socket().drop();
    timers.advance(1_000);
    socket().open();
    await expectSent(1, () => socket().receive('{"t":"online"}'));
    expect(await sentMessages()).toEqual([{ type: 'hello', token, device: 'iPhone · 微信' }]);
  });

  test('passes on printer changes', async () => {
    await welcome();
    await expectEvent(() => fromDesktop({ type: 'printer', printer: null }));
    expect(events.at(-1)).toEqual({ type: 'printer', printer: null });
  });
});

describe('PhoneSession: jobs', () => {
  test('submits jobs with the connection nonce, increasing sequence numbers and fresh job ids', async () => {
    const nonce = await welcome();
    const first = phone.submit(RAW, false);
    const second = phone.submit(RAW, true);
    await expectSent(3);
    expect(await submits()).toEqual([
      { type: 'submit', nonce, seq: 1, job: first, raw: RAW, force: false },
      { type: 'submit', nonce, seq: 2, job: second, raw: RAW, force: true },
    ]);
    expect(first).not.toBe(second);
  });

  test('reports acknowledgements, results and refusals', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'accepted', job }));
    await expectEvent(() => fromDesktop({ type: 'result', job, result: PRINTED }));
    const refusedJob = phone.submit(RAW, false);
    await expectSent(3);
    await expectEvent(() => fromDesktop({ type: 'refused', job: refusedJob, reason: 'too-many-pending' }));
    expect(events.slice(-3)).toEqual([
      { type: 'accepted', job },
      { type: 'result', job, result: PRINTED },
      { type: 'refused', job: refusedJob, reason: 'too-many-pending' },
    ]);
  });

  test('holds jobs scanned while offline and sends them once welcomed', async () => {
    const job = phone.submit(RAW, false);
    const nonce = await welcome();
    await expectSent(2);
    expect(await submits()).toEqual([{ type: 'submit', nonce, seq: 1, job, raw: RAW, force: false }]);
  });

  test('resends unfinished jobs with the same id after reconnecting, and forgets finished ones', async () => {
    await welcome();
    const finished = phone.submit(RAW, false);
    const unfinished = phone.submit('OTHER', false);
    await expectSent(3);
    await expectEvent(() => fromDesktop({ type: 'accepted', job: unfinished }));
    await expectEvent(() => fromDesktop({ type: 'result', job: finished, result: PRINTED }));
    const nonce = await reconnect();
    await expectSent(2);
    expect(await submits()).toEqual([{ type: 'submit', nonce, seq: 1, job: unfinished, raw: 'OTHER', force: false }]);
  });

  test('resends a job that was not acknowledged in time', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    // 连接本身保持活着，只是这条没有回音。
    for (let elapsed = 0; elapsed < JOB_ACK_TIMEOUT_MS; elapsed += 1_000) {
      timers.advance(1_000);
      socket().receive('{"t":"pong"}');
    }
    await expectSent(3);
    expect((await submits()).map((message) => message['job'])).toEqual([job, job]);
  });

  test('stops resending once the job is acknowledged', async () => {
    await welcome();
    const job = phone.submit(RAW, false);
    await expectSent(2);
    await expectEvent(() => fromDesktop({ type: 'accepted', job }));
    for (let elapsed = 0; elapsed < 3 * JOB_ACK_TIMEOUT_MS; elapsed += 1_000) {
      timers.advance(1_000);
      socket().receive('{"t":"pong"}');
    }
    await Bun.sleep(20);
    expect(await submits()).toHaveLength(1);
  });

  test('ignores results for jobs it does not know', async () => {
    await welcome();
    const before = events.length;
    await fromDesktop({ type: 'result', job: randomId(), result: PRINTED });
    await expectEvent(() => fromDesktop({ type: 'printer', printer: 'X' }));
    expect(events.slice(before)).toEqual([{ type: 'printer', printer: 'X' }]);
  });
});

describe('PhoneSession: link and session end', () => {
  test('reports a dropped link without losing jobs', async () => {
    await welcome();
    phone.submit(RAW, false);
    await expectSent(2);
    socket().drop();
    expect(events.at(-1)).toEqual({ type: 'link', link: 'reconnecting' });
  });

  test('reports a desktop that stepped away', async () => {
    socket().open();
    await expectEvent(() => socket().receive('{"t":"waiting"}'));
    expect(events.at(-1)).toEqual({ type: 'link', link: 'desktop-offline' });
  });

  test('reports a session taken by another phone', async () => {
    socket().open();
    await expectSent(1, () => socket().receive('{"t":"online"}'));
    await expectEvent(() => fromDesktop({ type: 'taken' }));
    expect(events.at(-1)).toEqual({ type: 'taken' });
  });

  test('reports the end of the session', async () => {
    await welcome();
    await expectEvent(() => socket().receive('{"t":"ended","reason":"stopped"}'));
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'stopped' });
  });

  test('treats an unknown session as gone when it was never welcomed', async () => {
    socket().open();
    await expectEvent(() => socket().receive('{"t":"not-found"}'));
    expect(events.at(-1)).toEqual({ type: 'not-found' });
  });

  test('waits for the desktop through the grace period when the relay forgot the session', async () => {
    await welcome();
    socket().receive('{"t":"not-found"}');
    await expectEvent(() => socket().drop());
    expect(events.at(-1)).toEqual({ type: 'link', link: 'reconnecting' });
    timers.advance(DESKTOP_GRACE_MS);
    socket().open();
    await expectEvent(() => socket().receive('{"t":"not-found"}'));
    expect(events.at(-1)).toEqual({ type: 'not-found' });
  });

  test('drops messages it cannot decrypt', async () => {
    socket().open();
    socket().receive(JSON.stringify({ t: 'recv', body: { iv: 'aaaaaaaaaaaaaaaa', ct: 'Y2lwaGVy' } }));
    await expectEvent(() => socket().receive('{"t":"waiting"}'));
    expect(events).toEqual([{ type: 'link', link: 'desktop-offline' }]);
  });
});
