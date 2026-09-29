import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningRelay, startRelay } from '../../../relay/src/server';
import { PhoneSession, type SessionEvent } from '../../../relay/web/src/phone-session';
import { openSessionStore } from '../../../relay/web/src/session-store';
import { systemClock } from '../../core/types';
import { importSessionKey, openMessage, randomId, sealMessage } from '../../shared/mobile-crypto';
import {
  type DesktopMessage,
  type ImageRequest,
  MAX_PHONES_PER_SESSION,
  MOBILE_PROTOCOL_VERSION,
  type PhonePrintResult,
  parsePhoneFragment,
  type SealedBody,
} from '../../shared/mobile-protocol';
import type { MobileStatus } from '../../shared/mobile-status';
import type { SocketLike, SocketTimers } from '../../shared/relay-socket';
import { MobileHost } from './mobile-host';
import type { PhoneJob } from './mobile-session';

const ORIGIN = 'https://relay.example.com';
const RAW = 'CL5640-TK-图片色-XL';
const PRINTED: PhonePrintResult = {
  status: 'printed',
  ruleName: '横杠三段',
  fields: [{ name: '编码', value: 'CL5640' }],
};
/** 系统里的打印机名和界面上显示的名字不一样：打印用前者，告诉手机用后者。 */
/** 电脑上的打印机汇总（一台时是它的显示名）。 */
const PRINTER_LABEL = '热敏标签机';
const WAIT_LIMIT_MS = 10_000;
/** 中转服务重启要等电脑和手机按退避重连（1 秒、2 秒……）。 */
const RESTART_TEST_TIMEOUT_MS = 30_000;

type Active = Extract<MobileStatus, { state: 'active' }>;

const timers: SocketTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let webRoot: string;
let relay: RunningRelay;
let port: number;
let host: MobileHost;
let prints: { raw: string; force: boolean }[];
let requests: PhoneJob[];
let imageRequest: ImageRequest | null;
let printerLabel: string | null;
let printResult: PhonePrintResult;
/** 打印在这里等着，直到测试放行：排队顺序和位置不再取决于打印有多快。 */
let held: (() => void)[];
let isHolding: boolean;
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
    printerLabel: async () => printerLabel,
    imageRequest: () => imageRequest,
    print: async (request) => {
      const { raw, force } = request;
      requests.push(request);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      prints.push({ raw, force });
      if (isHolding) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      running -= 1;
      return printResult;
    },
    log: () => {},
  });
}

/** 放行正在等的那张打印。 */
async function releaseOne(): Promise<void> {
  await waitFor(() => held.length > 0, 'a print to release');
  held.shift()?.();
}

function active(): Active {
  const status = host.status();
  if (status.state !== 'active') {
    throw new Error(`expected an active session, got ${status.state}`);
  }
  return status;
}

async function activeUrl(): Promise<string> {
  host.start();
  await waitFor(() => host.status().state === 'active', 'an active session');
  return active().url;
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
    store: openSessionStore(null, fragment.session, () => Date.now()),
    createSocket: (socketUrl) => new WebSocket(socketUrl, { headers: { Origin: ORIGIN } }) as unknown as SocketLike,
    timers,
    now: () => Date.now(),
    onEvent: (event) => events.push(event),
  });
  phones.push(phone);
  phone.start();
  return phone;
}

async function welcomedPhone(url: string, events: SessionEvent[], device?: string): Promise<PhoneSession> {
  const phone = await connectPhone(url, events, device);
  await waitFor(() => events.some((event) => event.type === 'welcomed'), `the welcome of ${device ?? 'the phone'}`);
  return phone;
}

function positions(events: SessionEvent[], job: string): number[] {
  return events.flatMap((event) =>
    event.type === 'queued' ? event.positions.filter((entry) => entry.job === job).map((entry) => entry.ahead) : [],
  );
}

beforeEach(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'mobile-host-'));
  relay = startTestRelay(0);
  port = Number(relay.url.port);
  prints = [];
  requests = [];
  imageRequest = null;
  printerLabel = PRINTER_LABEL;
  printResult = PRINTED;
  held = [];
  isHolding = false;
  running = 0;
  maxRunning = 0;
  host = createHost(new URL(`http://127.0.0.1:${port}/`));
});

afterEach(async () => {
  for (const release of held.splice(0)) {
    release();
  }
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
    expect(active()).toMatchObject({ relayOnline: true, joinLocked: false, phones: [], printed: 0, queued: 0 });
  });

  test('claims the phone that opens the link and names the printer as the desktop shows it', async () => {
    const events: SessionEvent[] = [];
    await welcomedPhone(await activeUrl(), events);
    expect(events).toContainEqual({ type: 'welcomed', printer: '热敏标签机', image: null });
    expect(active()).toMatchObject({ phones: [{ device: '测试手机', online: true, printed: 0 }] });
  });

  test('prints a submitted job on the system printer and reports it back', async () => {
    const events: SessionEvent[] = [];
    const phone = await welcomedPhone(await activeUrl(), events);
    const job = phone.submit(RAW, false);
    await waitFor(() => events.some((event) => event.type === 'result'), 'the result');
    expect(positions(events, job)).toEqual([0]);
    expect(events).toContainEqual({ type: 'started', job });
    expect(events).toContainEqual({ type: 'result', job, result: PRINTED });
    expect(prints).toEqual([{ raw: RAW, force: false }]);
    expect(active()).toMatchObject({ printed: 1, queued: 0, phones: [{ printed: 1 }] });
  });

  test('prints jobs one after another, in the order they came', async () => {
    isHolding = true;
    const events: SessionEvent[] = [];
    const phone = await welcomedPhone(await activeUrl(), events);
    for (const raw of ['A', 'B', 'C']) {
      phone.submit(raw, false);
    }
    for (let index = 0; index < 3; index += 1) {
      await releaseOne();
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

  // 电脑上决定打印机（按模板的纸张）：这种纸没有打印机时，手机收到 no-printer。
  test('passes on a no-printer answer from the desktop', async () => {
    printResult = { status: 'no-printer' };
    const events: SessionEvent[] = [];
    const phone = await welcomedPhone(await activeUrl(), events);
    const job = phone.submit(RAW, false);
    await waitFor(() => events.some((event) => event.type === 'result'), 'the result');
    expect(events).toContainEqual({ type: 'result', job, result: { status: 'no-printer' } });
  });

  test('tells the phone when the printer changes', async () => {
    const events: SessionEvent[] = [];
    await welcomedPhone(await activeUrl(), events);
    printerLabel = '另一台热敏标签机';
    host.printerChanged();
    await waitFor(() => events.some((event) => event.type === 'printer'), 'the printer change');
    expect(events).toContainEqual({ type: 'printer', printer: '另一台热敏标签机', image: null });
  });

  // 货架号识别：电脑要图时 welcome 里告诉手机截哪块；手机带着图和手动字段提交，电脑原样交给打印。
  test('asks the phone for the label image and hands the image and typed fields to printing', async () => {
    imageRequest = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130 };
    const events: SessionEvent[] = [];
    const phone = await welcomedPhone(await activeUrl(), events);
    expect(events).toContainEqual({ type: 'welcomed', printer: '热敏标签机', image: imageRequest });
    const image = { jpeg: '/9j/4AAQSkZJRgABAQ==', code: { x: 325, y: 195, size: 130 } };
    const fields = [{ name: '货架号', value: 'A-1-2-3' }];
    phone.submit(RAW, false, { image, fields });
    await waitFor(() => requests.length === 1, 'the job');
    expect(requests).toEqual([{ raw: RAW, force: false, image, fields }]);
  });

  test('tells the phone when the image request changes', async () => {
    const events: SessionEvent[] = [];
    await welcomedPhone(await activeUrl(), events);
    imageRequest = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130 };
    host.printerChanged();
    await waitFor(() => events.some((event) => event.type === 'printer'), 'the update');
    expect(events).toContainEqual({ type: 'printer', printer: '热敏标签机', image: imageRequest });
  });

  test('queues jobs from several phones together and moves each phone up with one update', async () => {
    isHolding = true;
    const url = await activeUrl();
    const first: SessionEvent[] = [];
    const second: SessionEvent[] = [];
    const phoneA = await welcomedPhone(url, first, '手机甲');
    const phoneB = await welcomedPhone(url, second, '手机乙');
    const a1 = phoneA.submit('A1', false);
    await waitFor(() => prints.length === 1, 'the first job to start printing');
    const b1 = phoneB.submit('B1', false);
    await waitFor(() => positions(second, b1).length === 1, 'the second acceptance');
    const a2 = phoneA.submit('A2', false);
    await waitFor(() => positions(first, a2).length === 1, 'the third acceptance');
    // 甲的第一张在打印：乙的排在它后面，甲的第二张排在乙后面。
    expect(positions(second, b1)).toEqual([1]);
    expect(positions(first, a2)).toEqual([2]);
    await releaseOne();
    await waitFor(() => positions(first, a2).length === 2, 'the queue update');
    expect(positions(second, b1)).toEqual([1, 0]);
    expect(positions(first, a2)).toEqual([2, 1]);
    await releaseOne();
    await releaseOne();
    await waitFor(() => [...first, ...second].filter((event) => event.type === 'result').length === 3, 'three results');
    expect(prints.map((entry) => entry.raw)).toEqual(['A1', 'B1', 'A2']);
    expect(maxRunning).toBe(1);
    const resultJobs = (events: SessionEvent[]) =>
      events.flatMap((event) => (event.type === 'result' ? [event.job] : []));
    expect(resultJobs(first)).toEqual([a1, a2]);
    expect(resultJobs(second)).toEqual([b1]);
    expect(active()).toMatchObject({
      printed: 3,
      phones: [
        { device: '手机甲', printed: 2 },
        { device: '手机乙', printed: 1 },
      ],
    });
  });

  test('turns away a phone once the session is full', async () => {
    const url = await activeUrl();
    for (let index = 0; index < MAX_PHONES_PER_SESSION; index += 1) {
      await welcomedPhone(url, [], `手机${index}`);
    }
    const extra: SessionEvent[] = [];
    await connectPhone(url, extra, '多出来的手机');
    await waitFor(() => extra.some((event) => event.type === 'denied'), 'the refusal');
    expect(extra).toContainEqual({ type: 'denied', reason: 'full' });
    expect(active().phones).toHaveLength(MAX_PHONES_PER_SESSION);
  });

  test('removes a phone on request and pauses new phones until allowed again', async () => {
    const url = await activeUrl();
    const events: SessionEvent[] = [];
    await welcomedPhone(url, events);
    host.removePhone(active().phones[0]?.id ?? '');
    await waitFor(() => events.some((event) => event.type === 'denied'), 'the removal');
    expect(events).toContainEqual({ type: 'denied', reason: 'removed' });
    expect(active()).toMatchObject({ phones: [], joinLocked: true });
    // 被移除的人换个浏览器（没有令牌）也进不来。
    const stranger: SessionEvent[] = [];
    await connectPhone(url, stranger, '换了浏览器');
    await waitFor(() => stranger.some((event) => event.type === 'denied'), 'the pause');
    expect(stranger).toContainEqual({ type: 'denied', reason: 'locked' });
    host.setJoinLocked(false);
    await welcomedPhone(url, [], '新同事');
    expect(active().phones.map((phone) => phone.device)).toEqual(['新同事']);
  });

  test(
    'carries on through a relay restart, printing a job scanned meanwhile exactly once',
    async () => {
      const events: SessionEvent[] = [];
      const phone = await welcomedPhone(await activeUrl(), events);
      await relay.stop();
      await waitFor(() => events.some((event) => event.type === 'link'), 'the outage');
      const job = phone.submit(RAW, false);
      relay = startTestRelay(port);
      await waitFor(() => events.some((event) => event.type === 'result'), 'the result after the restart');
      expect(events).toContainEqual({ type: 'result', job, result: PRINTED });
      expect(prints).toHaveLength(1);
      // 电脑重连后手机列表对得上：这部手机重新打过招呼，在线，没有多出幽灵手机。
      await waitFor(() => active().phones[0]?.online === true, 'the phone back online');
      expect(active().phones).toHaveLength(1);
    },
    RESTART_TEST_TIMEOUT_MS,
  );

  test('ends the session for the phone when stopped', async () => {
    const events: SessionEvent[] = [];
    await welcomedPhone(await activeUrl(), events);
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

  test('keeps working when a status listener throws', async () => {
    host.onStatus(() => {
      throw new Error('listener bug');
    });
    const events: SessionEvent[] = [];
    const phone = await welcomedPhone(await activeUrl(), events);
    phone.submit(RAW, false);
    await waitFor(() => events.some((event) => event.type === 'result'), 'the result');
  });
});
