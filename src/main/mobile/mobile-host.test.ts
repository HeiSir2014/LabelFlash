import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningRelay, startRelay } from '../../../relay/src/server';
import { PhoneSession, type SessionEvent } from '../../../relay/web/src/phone-session';
import { createTokenStore } from '../../../relay/web/src/token-store';
import { systemClock } from '../../core/types';
import { importSessionKey, openMessage, randomId, sealMessage } from '../../shared/mobile-crypto';
import {
  type DesktopMessage,
  MAX_PHONES_PER_SESSION,
  MOBILE_PROTOCOL_VERSION,
  type PhonePrintResult,
  parsePhoneFragment,
  type SealedBody,
} from '../../shared/mobile-protocol';
import type { MobileStatus } from '../../shared/mobile-status';
import type { SocketLike, SocketTimers } from '../../shared/relay-socket';
import { MobileHost } from './mobile-host';

const ORIGIN = 'https://relay.example.com';
const RAW = 'CL5640-TK-图片色-XL';
const PRINTED: PhonePrintResult = {
  status: 'printed',
  ruleName: '横杠三段',
  fields: [{ name: '编码', value: 'CL5640' }],
};
const WAIT_LIMIT_MS = 10_000;
/** 中转服务重启要等电脑和手机按退避重连（1 秒、2 秒……）。 */
const RESTART_TEST_TIMEOUT_MS = 30_000;

const timers: SocketTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let webRoot: string;
let relay: RunningRelay;
let port: number;
let host: MobileHost;
let prints: { raw: string; force: boolean; printer: string }[];
let printer: string | null;
let printDelayMs: number;
let running: number;
let maxRunning: number;
const phones: PhoneSession[] = [];

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await Bun.sleep(10);
  }
}

function startTestRelay(listenPort: number): RunningRelay {
  return startRelay({ host: '127.0.0.1', port: listenPort, publicOrigin: ORIGIN, webRoot, version: 'test' }, () => {});
}

function createHost(base: URL): MobileHost {
  return new MobileHost({
    relayBase: base,
    clock: systemClock,
    timers,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    printerName: () => printer,
    print: async (raw, force, printerName) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      prints.push({ raw, force, printer: printerName });
      await Bun.sleep(printDelayMs);
      running -= 1;
      return PRINTED;
    },
    log: () => {},
  });
}

async function activeUrl(): Promise<string> {
  host.start();
  await waitFor(() => host.status().state === 'active', 'an active session');
  const status = host.status() as Extract<MobileStatus, { state: 'active' }>;
  return status.url;
}

/** 用手机端的真实代码连上来。 */
async function connectPhone(url: string, events: SessionEvent[], device = '测试手机'): Promise<PhoneSession> {
  const fragment = parsePhoneFragment(new URL(url).hash);
  if (!fragment) {
    throw new Error(`bad phone url ${url}`);
  }
  const phone = new PhoneSession({
    relayUrl: `ws://127.0.0.1:${port}/ws/phone`,
    session: fragment.session,
    key: await importSessionKey(fragment.key),
    device,
    tokens: createTokenStore(null),
    createSocket: (socketUrl) => new WebSocket(socketUrl, { headers: { Origin: ORIGIN } }) as unknown as SocketLike,
    timers,
    now: () => Date.now(),
    onEvent: (event) => events.push(event),
  });
  phones.push(phone);
  phone.start();
  return phone;
}

beforeEach(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'mobile-host-'));
  relay = startTestRelay(0);
  port = Number(relay.url.port);
  prints = [];
  printer = '热敏标签机';
  printDelayMs = 0;
  running = 0;
  maxRunning = 0;
  host = createHost(new URL(`http://127.0.0.1:${port}/`));
});

afterEach(async () => {
  host.stop('quit');
  for (const phone of phones.splice(0)) {
    phone.stop();
  }
  await relay.stop();
  await rm(webRoot, { recursive: true, force: true });
});

describe('MobileHost', () => {
  test('opens a session with a private link for the phone', async () => {
    const url = await activeUrl();
    expect(url.startsWith(`http://127.0.0.1:${port}/m/#`)).toBe(true);
    expect(parsePhoneFragment(new URL(url).hash)).not.toBeNull();
    expect(host.status()).toMatchObject({ state: 'active', relayOnline: true, phones: [], printed: 0, queued: 0 });
  });

  test('claims the phone that opens the link', async () => {
    const events: SessionEvent[] = [];
    await connectPhone(await activeUrl(), events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    expect(events).toContainEqual({ type: 'welcomed', printer: '热敏标签机' });
    expect(host.status()).toMatchObject({ phones: [{ device: '测试手机', online: true, printed: 0 }] });
  });

  test('prints a submitted job and reports it back', async () => {
    const events: SessionEvent[] = [];
    const phone = await connectPhone(await activeUrl(), events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    const job = phone.submit(RAW, false);
    await waitFor(() => events.some((event) => event.type === 'result'), 'the result');
    expect(events).toContainEqual({ type: 'accepted', job, ahead: 0 });
    expect(events).toContainEqual({ type: 'started', job });
    expect(events).toContainEqual({ type: 'result', job, result: PRINTED });
    expect(prints).toEqual([{ raw: RAW, force: false, printer: '热敏标签机' }]);
    expect(host.status()).toMatchObject({ printed: 1, queued: 0, phones: [{ printed: 1 }] });
  });

  test('prints jobs one after another, in the order they came', async () => {
    printDelayMs = 50;
    const events: SessionEvent[] = [];
    const phone = await connectPhone(await activeUrl(), events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    for (const raw of ['A', 'B', 'C']) {
      phone.submit(raw, false);
    }
    await waitFor(() => events.filter((event) => event.type === 'result').length === 3, 'three results');
    expect(prints.map((entry) => entry.raw)).toEqual(['A', 'B', 'C']);
    expect(maxRunning).toBe(1);
  });

  test('prints a job id only once, however often it is sent', async () => {
    const url = await activeUrl();
    const fragment = parsePhoneFragment(new URL(url).hash);
    if (!fragment) {
      throw new Error('bad url');
    }
    const key = await importSessionKey(fragment.key);
    // 手写一部手机，把同一个任务号连发两次（模拟网络重传）。
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/phone`, { headers: { Origin: ORIGIN } });
    const received: DesktopMessage[] = [];
    let isOnline = false;
    socket.onmessage = async (event) => {
      const frame = JSON.parse(String(event.data)) as { t: string; body?: SealedBody };
      isOnline ||= frame.t === 'online';
      if (frame.t === 'recv' && frame.body) {
        received.push((await openMessage(key, 'd2p', fragment.session, frame.body)) as DesktopMessage);
      }
    };
    await new Promise((resolve) => {
      socket.onopen = resolve;
    });
    const send = async (message: object) =>
      socket.send(JSON.stringify({ t: 'send', body: await sealMessage(key, 'p2d', fragment.session, message) }));
    socket.send(JSON.stringify({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: fragment.session }));
    await waitFor(() => isOnline, 'the relay to report the desktop online');
    await send({ type: 'hello', token: null, device: '手写手机' });
    await waitFor(() => received.some((message) => message.type === 'welcome'), 'the welcome');
    const welcome = received.find((message) => message.type === 'welcome');
    const nonce = welcome?.type === 'welcome' ? welcome.nonce : '';
    const job = randomId();
    await send({ type: 'submit', nonce, seq: 1, job, raw: RAW, force: false });
    await waitFor(() => received.some((message) => message.type === 'result'), 'the first result');
    await send({ type: 'submit', nonce, seq: 2, job, raw: RAW, force: false });
    await waitFor(() => received.filter((message) => message.type === 'result').length === 2, 'the repeated result');
    expect(prints).toHaveLength(1);
    socket.close();
  });

  test('answers no-printer without printing when none is selected', async () => {
    printer = null;
    const events: SessionEvent[] = [];
    const phone = await connectPhone(await activeUrl(), events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    const job = phone.submit(RAW, false);
    await waitFor(() => events.some((event) => event.type === 'result'), 'the result');
    expect(events).toContainEqual({ type: 'result', job, result: { status: 'no-printer' } });
    expect(prints).toEqual([]);
  });

  test('tells the phone when the printer changes', async () => {
    const events: SessionEvent[] = [];
    await connectPhone(await activeUrl(), events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    printer = '另一台热敏标签机';
    host.printerChanged();
    await waitFor(() => events.some((event) => event.type === 'printer'), 'the printer change');
    expect(events).toContainEqual({ type: 'printer', printer: '另一台热敏标签机' });
  });

  test('queues jobs from several phones together and answers each phone about its own', async () => {
    printDelayMs = 50;
    const url = await activeUrl();
    const first: SessionEvent[] = [];
    const second: SessionEvent[] = [];
    const phoneA = await connectPhone(url, first, '手机甲');
    const phoneB = await connectPhone(url, second, '手机乙');
    await waitFor(
      () => [first, second].every((events) => events.some((event) => event.type === 'welcomed')),
      'both welcomes',
    );
    const a1 = phoneA.submit('A1', false);
    await waitFor(() => first.some((event) => event.type === 'accepted'), 'the first acceptance');
    const b1 = phoneB.submit('B1', false);
    await waitFor(() => second.some((event) => event.type === 'accepted'), 'the second acceptance');
    const a2 = phoneA.submit('A2', false);
    await waitFor(() => [...first, ...second].filter((event) => event.type === 'result').length === 3, 'three results');
    expect(prints.map((entry) => entry.raw)).toEqual(['A1', 'B1', 'A2']);
    expect(maxRunning).toBe(1);
    // 乙的任务排在甲的第一张后面；甲的第一张打完，它往前挪到第一位。
    expect(second).toContainEqual({ type: 'accepted', job: b1, ahead: 1 });
    expect(second).toContainEqual({ type: 'accepted', job: b1, ahead: 0 });
    const resultJobs = (events: SessionEvent[]) =>
      events.flatMap((event) => (event.type === 'result' ? [event.job] : []));
    expect(resultJobs(first)).toEqual([a1, a2]);
    expect(resultJobs(second)).toEqual([b1]);
    expect(host.status()).toMatchObject({
      printed: 3,
      phones: [
        { device: '手机甲', printed: 2 },
        { device: '手机乙', printed: 1 },
      ],
    });
  });

  test('turns away a phone once the session is full', async () => {
    const url = await activeUrl();
    const joined: SessionEvent[][] = [];
    for (let index = 0; index < MAX_PHONES_PER_SESSION; index += 1) {
      const events: SessionEvent[] = [];
      joined.push(events);
      await connectPhone(url, events, `手机${index}`);
      await waitFor(() => events.some((event) => event.type === 'welcomed'), `welcome ${index}`);
    }
    const extra: SessionEvent[] = [];
    await connectPhone(url, extra, '多出来的手机');
    await waitFor(() => extra.some((event) => event.type === 'denied'), 'the refusal');
    expect(extra).toContainEqual({ type: 'denied', reason: 'full' });
    const status = host.status() as Extract<MobileStatus, { state: 'active' }>;
    expect(status.phones).toHaveLength(MAX_PHONES_PER_SESSION);
  });

  test('removes a phone on request, and keeps it out', async () => {
    const url = await activeUrl();
    const events: SessionEvent[] = [];
    await connectPhone(url, events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    const status = host.status() as Extract<MobileStatus, { state: 'active' }>;
    host.removePhone(status.phones[0]?.id ?? '');
    await waitFor(() => events.some((event) => event.type === 'denied'), 'the removal');
    expect(events).toContainEqual({ type: 'denied', reason: 'removed' });
    expect(host.status()).toMatchObject({ phones: [] });
  });

  test(
    'carries on through a relay restart, printing a job scanned meanwhile exactly once',
    async () => {
      const events: SessionEvent[] = [];
      const phone = await connectPhone(await activeUrl(), events);
      await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
      await relay.stop();
      await waitFor(() => events.some((event) => event.type === 'link'), 'the outage');
      const job = phone.submit(RAW, false);
      relay = startTestRelay(port);
      await waitFor(() => events.some((event) => event.type === 'result'), 'the result after the restart');
      expect(events).toContainEqual({ type: 'result', job, result: PRINTED });
      expect(prints).toHaveLength(1);
    },
    RESTART_TEST_TIMEOUT_MS,
  );

  test('ends the session for the phone when stopped', async () => {
    const events: SessionEvent[] = [];
    await connectPhone(await activeUrl(), events);
    await waitFor(() => events.some((event) => event.type === 'welcomed'), 'the welcome');
    host.stop('stopped');
    await waitFor(() => events.some((event) => event.type === 'ended'), 'the end');
    expect(events).toContainEqual({ type: 'ended', reason: 'stopped' });
    expect(host.status()).toEqual({ state: 'off' });
  });

  test('reports an unreachable relay and keeps trying', async () => {
    await relay.stop();
    host.start();
    await waitFor(() => host.status().state === 'failed', 'the failure');
    expect(host.status()).toEqual({ state: 'failed', error: 'unreachable' });
    relay = startTestRelay(port);
    await waitFor(() => host.status().state === 'active', 'the recovery');
  });

  test('keeps the current session when started again', async () => {
    const url = await activeUrl();
    host.start();
    expect(host.status()).toMatchObject({ state: 'active', url });
  });
});
