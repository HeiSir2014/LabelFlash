import { beforeEach, describe, expect, test } from 'bun:test';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './mobile-protocol';
import { RelaySocket } from './relay-socket';
import { FakeSocket, FakeTimers } from './testing/fake-socket';

const URL = 'wss://relay.test/ws/desktop';

let timers: FakeTimers;
let sockets: FakeSocket[];
let events: string[];
let relay: RelaySocket;

function latest(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('no socket created');
  }
  return socket;
}

/** 让最新的连接失败，并推进到下一次重连；返回这次等了多久。 */
function failAndMeasure(): number {
  const count = sockets.length;
  latest().drop();
  const start = timers.now;
  while (sockets.length === count) {
    timers.advance(100);
  }
  return timers.now - start;
}

beforeEach(() => {
  timers = new FakeTimers();
  sockets = [];
  events = [];
  relay = new RelaySocket({
    url: URL,
    timers,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    onOpen: () => events.push('open'),
    onFrame: (text) => events.push(`frame:${text}`),
    onDown: () => events.push('down'),
  });
});

describe('RelaySocket', () => {
  test('connects to the url and reports the open', () => {
    relay.start();
    expect(sockets.map((socket) => socket.url)).toEqual([URL]);
    latest().open();
    expect(events).toEqual(['open']);
    expect(relay.isOpen).toBe(true);
  });

  test('sends a heartbeat and stays connected while frames keep arriving', () => {
    relay.start();
    latest().open();
    timers.advance(HEARTBEAT_INTERVAL_MS);
    expect(latest().frames()).toEqual([{ t: 'ping' }]);
    latest().receive('{"t":"pong"}');
    timers.advance(HEARTBEAT_TIMEOUT_MS);
    expect(sockets).toHaveLength(1);
    expect(latest().closedWith).toBeNull();
  });

  test('drops a silent connection and reconnects', () => {
    relay.start();
    const first = latest();
    first.open();
    timers.advance(HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS);
    expect(first.closedWith).not.toBeNull();
    expect(events).toEqual(['open', 'down']);
    timers.advance(1_000);
    expect(sockets).toHaveLength(2);
  });

  test('backs off 1, 2, 5, 10, then 30 seconds between failed attempts', () => {
    relay.start();
    const waits = Array.from({ length: 6 }, () => failAndMeasure());
    expect(waits).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000]);
  });

  test('starts the back-off over after a successful connection', () => {
    relay.start();
    failAndMeasure();
    failAndMeasure();
    latest().open();
    expect(failAndMeasure()).toBe(1_000);
  });

  test('reports each outage once, however many attempts fail', () => {
    relay.start();
    latest().open();
    failAndMeasure();
    failAndMeasure();
    failAndMeasure();
    expect(events.filter((event) => event === 'down')).toHaveLength(1);
    latest().open();
    latest().drop();
    expect(events.filter((event) => event === 'down')).toHaveLength(2);
  });

  test('refuses to send while disconnected', () => {
    relay.start();
    expect(relay.send({ t: 'ping' })).toBe(false);
    latest().open();
    expect(relay.send({ t: 'close', reason: 'stopped' })).toBe(true);
    expect(latest().frames()).toEqual([{ t: 'close', reason: 'stopped' }]);
  });

  test('stops for good: closes normally and ignores the old socket', () => {
    relay.start();
    const socket = latest();
    socket.open();
    relay.stop();
    expect(socket.closedWith?.code).toBe(1000);
    socket.drop();
    socket.receive('{"t":"pong"}');
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(events).toEqual(['open']);
  });

  test('ignores binary frames', () => {
    relay.start();
    latest().open();
    latest().receive(new Uint8Array([1, 2, 3]));
    latest().receive('{"t":"opened"}');
    expect(events).toEqual(['open', 'frame:{"t":"opened"}']);
  });

  test('treats a socket that cannot be created as a failed attempt', () => {
    let calls = 0;
    const failing = new RelaySocket({
      url: 'not a url',
      timers,
      createSocket: () => {
        calls += 1;
        throw new SyntaxError('invalid url');
      },
      onOpen: () => {},
      onFrame: () => {},
      onDown: () => events.push('down'),
    });
    failing.start();
    timers.advance(1_000);
    expect(calls).toBe(2);
    expect(events).toEqual(['down']);
    failing.stop();
  });
});
