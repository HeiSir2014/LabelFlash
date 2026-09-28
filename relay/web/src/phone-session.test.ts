import { beforeEach, describe, expect, test } from 'bun:test';
import { importSessionKey, openMessage, randomId, randomKey, sealMessage } from '../../../src/shared/mobile-crypto';
import {
  type DesktopMessage,
  MOBILE_PROTOCOL_VERSION,
  RESUME_RETRY_MS,
  type SealedBody,
} from '../../../src/shared/mobile-protocol';
import { FakeSocket, FakeTimers } from '../../../src/shared/testing/fake-socket';
import { PhoneSession, REQUEST_TIMEOUT_MS } from './phone-session';
import type { PhoneEvent } from './phone-state';
import { createTokenStore, type TokenStore } from './token-store';

const URL = 'wss://relay.example.com/labelflash/ws/phone';
const SESSION = randomId();
const RAW = 'CL5640-TK-图片色-XL';
const WAIT_LIMIT_MS = 2_000;

let key: CryptoKey;
let timers: FakeTimers;
let sockets: FakeSocket[];
let events: PhoneEvent[];
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
function sentMessages(): Promise<unknown[]> {
  return Promise.all(sentBodies().map((body) => openMessage(key, 'p2d', SESSION, body)));
}

/** 执行 action，等手机多发出一条加密消息。 */
async function expectSend(action: () => void): Promise<void> {
  const before = sentBodies().length;
  action();
  await waitFor(() => sentBodies().length > before, 'an outgoing message');
}

/** 执行 action，等页面多收到一个事件。 */
async function expectEvent(action: () => void | Promise<void>): Promise<void> {
  const before = events.length;
  await action();
  await waitFor(() => events.length > before, 'a page event');
}

async function fromDesktop(message: DesktopMessage): Promise<void> {
  socket().receive(JSON.stringify({ t: 'recv', body: await sealMessage(key, 'd2p', SESSION, message) }));
}

async function connectAndWelcome(token = randomId(), nonce = randomId()): Promise<{ token: string; nonce: string }> {
  socket().open();
  await expectSend(() => socket().receive('{"t":"online"}'));
  await expectEvent(() => fromDesktop({ type: 'welcome', token, nonce, printer: '热敏标签机' }));
  return { token, nonce };
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

describe('PhoneSession', () => {
  test('joins the session, then says hello once the desktop is online', async () => {
    socket().open();
    expect(socket().frames()).toEqual([{ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: SESSION }]);
    await expectSend(() => socket().receive('{"t":"online"}'));
    expect(await sentMessages()).toEqual([{ type: 'hello', token: null, device: 'iPhone · 微信' }]);
  });

  test('keeps the token and reports the printer on welcome', async () => {
    const { token } = await connectAndWelcome();
    expect(tokens.get(SESSION)).toBe(token);
    expect(events).toContainEqual({ type: 'welcomed', printer: '热敏标签机' });
  });

  test('says hello with the saved token after reconnecting', async () => {
    const { token } = await connectAndWelcome();
    socket().drop();
    timers.advance(1_000);
    socket().open();
    await expectSend(() => socket().receive('{"t":"online"}'));
    expect(await sentMessages()).toEqual([{ type: 'hello', token, device: 'iPhone · 微信' }]);
  });

  test('sends requests with the nonce and increasing ids, and matches the replies', async () => {
    const { nonce } = await connectAndWelcome();
    await expectSend(() => phone.preview(RAW));
    expect((await sentMessages()).at(-1)).toEqual({ type: 'preview', nonce, id: 1, raw: RAW });
    await expectEvent(() =>
      fromDesktop({ type: 'preview', id: 1, result: { status: 'invalid', reason: 'NO_MATCHING_RULE' } }),
    );
    expect(events.at(-1)).toEqual({
      type: 'preview-result',
      result: { status: 'invalid', reason: 'NO_MATCHING_RULE' },
    });
    await expectSend(() => phone.print(RAW, true));
    expect((await sentMessages()).at(-1)).toEqual({ type: 'print', nonce, id: 2, raw: RAW, force: true });
  });

  test('ignores a reply to another request', async () => {
    await connectAndWelcome();
    await expectSend(() => phone.print(RAW, false));
    const before = events.length;
    // 消息按收到的顺序处理：后一条的事件到了，前一条一定已经处理过。
    await fromDesktop({ type: 'print', id: 99, result: { status: 'printed' } });
    await expectEvent(() => fromDesktop({ type: 'busy', id: 1 }));
    expect(events.slice(before)).toEqual([{ type: 'request-failed', reason: 'busy' }]);
  });

  test('gives up on a request without a reply', async () => {
    await connectAndWelcome();
    await expectSend(() => phone.print(RAW, false));
    // 连接本身保持活着（每秒都有帧），只是电脑一直不回复这个请求。
    for (let elapsed = 0; elapsed < REQUEST_TIMEOUT_MS; elapsed += 1_000) {
      timers.advance(1_000);
      socket().receive('{"t":"pong"}');
    }
    expect(events.at(-1)).toEqual({ type: 'request-failed', reason: 'timeout' });
    expect(sockets).toHaveLength(1);
  });

  test('passes on busy and rate-limited replies', async () => {
    await connectAndWelcome();
    await expectSend(() => phone.print(RAW, false));
    await expectEvent(() => fromDesktop({ type: 'rate-limited', id: 1 }));
    expect(events.at(-1)).toEqual({ type: 'request-failed', reason: 'rate-limited' });
  });

  test('fails the pending request and reports the outage when the link drops', async () => {
    await connectAndWelcome();
    await expectSend(() => phone.preview(RAW));
    socket().drop();
    expect(events.slice(-2)).toEqual([
      { type: 'request-failed', reason: 'timeout' },
      { type: 'link', link: 'reconnecting' },
    ]);
  });

  test('reports a desktop that stepped away', async () => {
    socket().open();
    await expectEvent(() => socket().receive('{"t":"waiting"}'));
    expect(events.at(-1)).toEqual({ type: 'link', link: 'desktop-offline' });
  });

  test('reports a session taken by another phone', async () => {
    socket().open();
    await expectSend(() => socket().receive('{"t":"online"}'));
    await expectEvent(() => fromDesktop({ type: 'rejected' }));
    expect(events.at(-1)).toEqual({ type: 'taken' });
  });

  test('reports the end of the session', async () => {
    await connectAndWelcome();
    await expectEvent(() => socket().receive('{"t":"ended","reason":"stopped"}'));
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'stopped' });
  });

  test('treats an unknown session as gone when it was never welcomed', async () => {
    socket().open();
    await expectEvent(() => socket().receive('{"t":"not-found"}'));
    expect(events.at(-1)).toEqual({ type: 'not-found' });
  });

  test('keeps retrying a welcomed session for a while after the relay forgot it', async () => {
    await connectAndWelcome();
    socket().receive('{"t":"not-found"}');
    // 中转服务回复 not-found 后会关掉连接。
    await expectEvent(() => socket().drop());
    expect(events).not.toContainEqual({ type: 'not-found' });
    timers.advance(RESUME_RETRY_MS);
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
