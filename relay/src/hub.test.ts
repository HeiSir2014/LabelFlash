import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeClock } from '../../src/core/testing/fake-clock';
import { randomId } from '../../src/shared/mobile-crypto';
import {
  DESKTOP_GRACE_MS,
  FIRST_FRAME_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_PENDING_JOBS,
  MOBILE_PROTOCOL_VERSION,
  type SealedBody,
} from '../../src/shared/mobile-protocol';
import { type Peer, RelayHub } from './hub';

const BODY: SealedBody = { iv: 'aaaaaaaaaaaaaaaa', ct: 'Y2lwaGVy' };

class FakePeer implements Peer {
  readonly received: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(
    readonly id: string,
    readonly ip = '203.0.113.1',
  ) {}

  send(text: string): void {
    this.received.push(JSON.parse(text));
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  last(): Record<string, unknown> | undefined {
    return this.received.at(-1);
  }

  types(): unknown[] {
    return this.received.map((frame) => frame['t']);
  }
}

let clock: FakeClock;
let logs: string[];
let hub: RelayHub;

function createHub(limits = {}): RelayHub {
  return new RelayHub({ clock, log: (line) => logs.push(line), limits });
}

/** 连接号和 server.ts 一样用随机数：电脑发来的 phone 字段必须是这种格式。 */
function peer(ip?: string): FakePeer {
  return new FakePeer(randomId(), ip);
}

function send(from: FakePeer, frame: object): void {
  hub.receive(from, JSON.stringify(frame));
}

function openDesktop(
  session = randomId(),
  secret = randomId(),
): { desktop: FakePeer; session: string; secret: string } {
  const desktop = peer();
  hub.attach(desktop, 'desktop');
  send(desktop, { t: 'open', v: MOBILE_PROTOCOL_VERSION, session, secret });
  return { desktop, session, secret };
}

function joinPhone(session: string, ip?: string): FakePeer {
  const phone = peer(ip);
  hub.attach(phone, 'phone');
  send(phone, { t: 'join', v: MOBILE_PROTOCOL_VERSION, session });
  return phone;
}

beforeEach(() => {
  clock = new FakeClock();
  logs = [];
  hub = createHub();
});

describe('opening a session', () => {
  test('registers the session and confirms it', () => {
    const { desktop } = openDesktop();
    expect(desktop.types()).toEqual(['opened']);
    expect(hub.stats()).toEqual({ sessions: 1, connections: 1 });
  });

  test('refuses another protocol version', () => {
    const desktop = peer();
    hub.attach(desktop, 'desktop');
    send(desktop, { t: 'open', v: MOBILE_PROTOCOL_VERSION + 1, session: randomId(), secret: randomId() });
    expect(desktop.last()).toEqual({ t: 'error', code: 'version' });
    expect(desktop.closed?.code).toBe(1008);
    expect(hub.stats().sessions).toBe(0);
  });

  test('lets the owner take the session over from a stale connection', () => {
    const { desktop: stale, session, secret } = openDesktop();
    const phone = joinPhone(session);
    const { desktop: fresh } = openDesktop(session, secret);
    expect(stale.closed?.code).toBe(4001);
    expect(fresh.received).toEqual([{ t: 'opened' }, { t: 'joined', phone: phone.id }]);
    send(phone, { t: 'send', body: BODY });
    expect(fresh.last()).toEqual({ t: 'recv', phone: phone.id, body: BODY });
    expect(hub.stats().sessions).toBe(1);
  });

  test('ignores frames from a replaced desktop connection', () => {
    const { desktop: stale, session, secret } = openDesktop();
    const phone = joinPhone(session);
    openDesktop(session, secret);
    send(stale, { t: 'close', reason: 'stopped' });
    expect(phone.types()).toEqual(['online', 'online']);
    expect(hub.stats().sessions).toBe(1);
  });

  test('refuses a session id held by someone else', () => {
    const { session } = openDesktop();
    const { desktop: intruder } = openDesktop(session, randomId());
    expect(intruder.last()).toEqual({ t: 'error', code: 'session-taken' });
    expect(intruder.closed?.code).toBe(1008);
  });

  test('refuses a first frame that is not open', () => {
    const desktop = peer();
    hub.attach(desktop, 'desktop');
    send(desktop, { t: 'ping' });
    expect(desktop.last()).toEqual({ t: 'error', code: 'bad-frame' });
    expect(desktop.closed?.code).toBe(1008);
  });
});

describe('joining a session', () => {
  test('tells both ends when a phone joins', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    expect(phone.types()).toEqual(['online']);
    expect(desktop.last()).toEqual({ t: 'joined', phone: phone.id });
  });

  test('turns away a phone with an unknown session', () => {
    const phone = joinPhone(randomId());
    expect(phone.types()).toEqual(['not-found']);
    expect(phone.closed?.code).toBe(1000);
  });

  test('makes a phone wait while the desktop is away', () => {
    const { desktop, session } = openDesktop();
    hub.detach(desktop);
    const phone = joinPhone(session);
    expect(phone.types()).toEqual(['waiting']);
  });
});

describe('forwarding', () => {
  test('forwards phone messages to the desktop with the phone id', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    send(phone, { t: 'send', body: BODY });
    expect(desktop.last()).toEqual({ t: 'recv', phone: phone.id, body: BODY });
  });

  test('forwards desktop messages only to the addressed phone', () => {
    const { desktop, session } = openDesktop();
    const first = joinPhone(session);
    const second = joinPhone(session);
    send(desktop, { t: 'send', phone: second.id, body: BODY });
    expect(second.last()).toEqual({ t: 'recv', body: BODY });
    expect(first.types()).toEqual(['online']);
  });

  test('drops desktop messages to a phone of another session', () => {
    const { session: other } = openDesktop();
    const stranger = joinPhone(other);
    const { desktop } = openDesktop();
    send(desktop, { t: 'send', phone: stranger.id, body: BODY });
    expect(stranger.types()).toEqual(['online']);
  });

  test('answers pings', () => {
    const { desktop } = openDesktop();
    send(desktop, { t: 'ping' });
    expect(desktop.last()).toEqual({ t: 'pong' });
  });
});

describe('ending', () => {
  test('kicks a phone on request', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    send(desktop, { t: 'kick', phone: phone.id });
    expect(phone.last()).toEqual({ t: 'kicked' });
    expect(phone.closed?.code).toBe(1000);
    expect(desktop.last()).toEqual({ t: 'left', phone: phone.id });
  });

  test('closes the session for everyone', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    send(desktop, { t: 'close', reason: 'stopped' });
    expect(phone.last()).toEqual({ t: 'ended', reason: 'stopped' });
    expect(phone.closed?.code).toBe(1000);
    expect(desktop.closed?.code).toBe(1000);
    expect(hub.stats()).toEqual({ sessions: 0, connections: 0 });
  });

  test('tells the desktop when a phone leaves', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    hub.detach(phone);
    expect(desktop.last()).toEqual({ t: 'left', phone: phone.id });
  });
});

describe('desktop grace period', () => {
  test('keeps the session while the desktop reconnects', () => {
    const { desktop, session, secret } = openDesktop();
    const phone = joinPhone(session);
    hub.detach(desktop);
    expect(phone.last()).toEqual({ t: 'waiting' });
    clock.advance(DESKTOP_GRACE_MS - 1);
    hub.tick();
    openDesktop(session, secret);
    expect(phone.last()).toEqual({ t: 'online' });
  });

  test('ends the session when the desktop stays away', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    hub.detach(desktop);
    clock.advance(DESKTOP_GRACE_MS);
    hub.tick();
    expect(phone.last()).toEqual({ t: 'ended', reason: 'desktop-gone' });
    expect(hub.stats()).toEqual({ sessions: 0, connections: 0 });
  });
});

describe('limits', () => {
  test('closes a connection that never sends its first frame', () => {
    const silent = peer();
    hub.attach(silent, 'phone');
    clock.advance(FIRST_FRAME_TIMEOUT_MS);
    hub.tick();
    expect(silent.closed?.code).toBe(1008);
    expect(hub.stats().connections).toBe(0);
  });

  test('refuses new sessions when full', () => {
    hub = createHub({ maxSessions: 1 });
    openDesktop();
    const { desktop } = openDesktop();
    expect(desktop.last()).toEqual({ t: 'error', code: 'server-busy' });
    expect(desktop.closed?.code).toBe(1013);
  });

  test('refuses extra phones in one session', () => {
    hub = createHub({ maxPhonesPerSession: 1 });
    const { session } = openDesktop();
    joinPhone(session);
    const extra = joinPhone(session);
    expect(extra.last()).toEqual({ t: 'error', code: 'server-busy' });
    expect(extra.closed?.code).toBe(1013);
  });

  test('refuses connections beyond the per-address limit', () => {
    hub = createHub({ maxConnectionsPerIp: 1 });
    expect(hub.attach(peer('198.51.100.7'), 'phone')).toBe(true);
    expect(hub.hasRoom('198.51.100.7')).toBe(false);
    expect(hub.attach(peer('198.51.100.7'), 'phone')).toBe(false);
    expect(hub.attach(peer('198.51.100.8'), 'phone')).toBe(true);
  });

  test('frees the slot of a closed connection', () => {
    hub = createHub({ maxConnectionsPerIp: 1 });
    const first = peer('198.51.100.7');
    hub.attach(first, 'phone');
    hub.detach(first);
    expect(hub.hasRoom('198.51.100.7')).toBe(true);
  });

  test('refuses every connection when the relay is full', () => {
    hub = createHub({ maxConnections: 1 });
    hub.attach(peer('198.51.100.7'), 'desktop');
    expect(hub.hasRoom('198.51.100.8')).toBe(false);
  });

  test('lets a desktop answer a burst from every phone after reconnecting', () => {
    const { desktop, session } = openDesktop();
    joinPhone(session);
    for (let index = 0; index < 100; index += 1) {
      send(desktop, { t: 'ping' });
    }
    expect(desktop.received).not.toContainEqual({ t: 'error', code: 'rate-limited' });
  });

  test('drops frames beyond the rate limit and closes a flooding connection', () => {
    const { session } = openDesktop();
    const phone = joinPhone(session);
    for (let index = 0; index < 200; index += 1) {
      send(phone, { t: 'ping' });
    }
    expect(phone.received).toContainEqual({ t: 'error', code: 'rate-limited' });
    expect(phone.closed?.code).toBe(1008);
  });
});

describe('phone bytes', () => {
  /** 接近单帧上限的一帧（一张最大的标签图）。 */
  const bigFrame = () => JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_FRAME_BYTES - 64) });

  test('lets a phone resend its whole outbox with label images after reconnecting', () => {
    const { session } = openDesktop();
    const phone = joinPhone(session);
    for (let index = 0; index < 1 + MAX_PENDING_JOBS; index += 1) {
      hub.receive(phone, bigFrame());
    }
    expect(phone.received).not.toContainEqual({ t: 'error', code: 'rate-limited' });
  });

  test('drops large frames from a phone that keeps pushing more than its byte budget', () => {
    const { session } = openDesktop();
    const phone = joinPhone(session);
    // 帧数还在帧数限速之内（突发 2 × (1 + MAX_PENDING_JOBS) 帧），只是字节超了。
    for (let index = 0; index < Math.ceil(1.5 * (1 + MAX_PENDING_JOBS)); index += 1) {
      hub.receive(phone, bigFrame());
    }
    expect(phone.received).toContainEqual({ t: 'error', code: 'rate-limited' });
  });
});

describe('logging', () => {
  test('never writes a full session id or a message body', () => {
    const { desktop, session } = openDesktop();
    const phone = joinPhone(session);
    send(phone, { t: 'send', body: BODY });
    send(desktop, { t: 'close', reason: 'stopped' });
    const text = logs.join('\n');
    expect(text).toContain(session.slice(0, 6));
    expect(text).not.toContain(session);
    expect(text).not.toContain(BODY.ct);
  });
});
