import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { randomId } from '../../shared/mobile-crypto';
import {
  IDLE_END_MS,
  MAX_PENDING_JOBS,
  MAX_PHONES_PER_SESSION,
  type PhoneMessage,
  type PhonePrintResult,
  UNCLAIMED_TTL_MS,
} from '../../shared/mobile-protocol';
import { JOB_MEMORY, MAX_JOBS_PER_MINUTE, MobileSession } from './mobile-session';

type Submit = Extract<PhoneMessage, { type: 'submit' }>;

const PRINTED: PhonePrintResult = { status: 'printed', ruleName: '横杠三段', fields: [] };
const MINUTE_MS = 60_000;
const RAW = 'CL5640-TK-图片色-XL';

let clock: FakeClock;
let session: MobileSession;

interface Joined {
  connection: string;
  token: string;
  nonce: string;
  seq: number;
}

/** 手机连上并加入，返回它的连接号、令牌和本次连接的 nonce。 */
function join(connection: string, device = 'iPhone · 微信', token: string | null = null): Joined {
  session.phoneJoined(connection);
  const reply = session.hello(connection, { type: 'hello', token, device });
  if (reply.kind !== 'welcome') {
    throw new Error(`expected welcome, got ${reply.kind}`);
  }
  return { connection, token: reply.token, nonce: reply.nonce, seq: 0 };
}

function submission(phone: Joined, job = randomId(), force = false): Submit {
  phone.seq += 1;
  return { type: 'submit', nonce: phone.nonce, seq: phone.seq, job, raw: RAW, force, images: [], fields: [] };
}

/** 提交一个任务，返回任务号。 */
function queue(phone: Joined): string {
  const message = submission(phone);
  const decision = session.submit(phone.connection, message);
  if (decision.kind !== 'run') {
    throw new Error(`expected run, got ${decision.kind}`);
  }
  return message.job;
}

function finish(job: string): void {
  session.started(job);
  session.complete(job, PRINTED);
}

function phoneId(index: number): string {
  return session.status().phones[index]?.id ?? '';
}

beforeEach(() => {
  clock = new FakeClock();
  session = new MobileSession(clock);
  session.relayOpened();
});

describe('joining', () => {
  test('welcomes phones, each with its own token', () => {
    const first = join('c1', 'iPhone · 微信');
    const second = join('c2', '安卓 · Chrome');
    expect(first.token).not.toBe(second.token);
    expect(session.status().phones).toEqual([
      { id: expect.any(String), device: 'iPhone · 微信', online: true, printed: 0 },
      { id: expect.any(String), device: '安卓 · Chrome', online: true, printed: 0 },
    ]);
  });

  test('turns away a phone once the session is full', () => {
    for (let index = 0; index < MAX_PHONES_PER_SESSION; index += 1) {
      join(`c${index}`);
    }
    session.phoneJoined('extra');
    expect(session.hello('extra', { type: 'hello', token: null, device: 'x' })).toEqual({
      kind: 'denied',
      reason: 'full',
    });
  });

  test('welcomes a phone back with its token and a fresh nonce, as the same phone', () => {
    const first = join('c1');
    session.phoneLeft('c1');
    expect(session.status().phones[0]?.online).toBe(false);
    const again = join('c2', 'iPhone · Safari', first.token);
    expect(again.token).toBe(first.token);
    expect(again.nonce).not.toBe(first.nonce);
    expect(session.status().phones).toEqual([
      { id: expect.any(String), device: 'iPhone · Safari', online: true, printed: 0 },
    ]);
  });

  test('turns away a token it does not know, as a removed phone', () => {
    join('c1');
    session.phoneJoined('c2');
    expect(session.hello('c2', { type: 'hello', token: randomId(), device: 'x' })).toEqual({
      kind: 'denied',
      reason: 'removed',
    });
  });

  test('removes a phone: disconnects it and revokes its token', () => {
    const phone = join('c1');
    expect(session.removePhone(phoneId(0)).kick).toBe('c1');
    expect(session.status().phones).toEqual([]);
    session.phoneJoined('c2');
    expect(session.hello('c2', { type: 'hello', token: phone.token, device: 'x' })).toEqual({
      kind: 'denied',
      reason: 'removed',
    });
  });

  test('stops new phones from joining after a removal, until allowed again', () => {
    join('c1');
    session.removePhone(phoneId(0));
    expect(session.status().joinLocked).toBe(true);
    session.phoneJoined('c2');
    expect(session.hello('c2', { type: 'hello', token: null, device: 'x' })).toEqual({
      kind: 'denied',
      reason: 'locked',
    });
    session.setJoinLocked(false);
    expect(session.hello('c2', { type: 'hello', token: null, device: 'x' }).kind).toBe('welcome');
  });

  test('still welcomes phones it knows while new ones are paused', () => {
    const first = join('c1');
    join('c2');
    session.removePhone(phoneId(1));
    session.phoneLeft('c1');
    expect(join('c3', 'x', first.token).token).toBe(first.token);
  });

  test('does not leave a ghost when a connection says hello as another phone', () => {
    join('c1');
    session.hello('c1', { type: 'hello', token: null, device: '安卓 · Chrome' });
    expect(session.status().phones.map((phone) => phone.online)).toEqual([false, true]);
  });

  test('keeps a phone online on its new connection when the old one closes late', () => {
    const phone = join('c1');
    join('c2', 'x', phone.token);
    session.phoneLeft('c1');
    expect(session.status().phones.map((each) => each.online)).toEqual([true]);
  });

  test('forgets every connection when the relay session is reopened', () => {
    const phone = join('c1');
    session.relayOpened();
    expect(session.status().phones.map((each) => each.online)).toEqual([false]);
    expect(session.submit('c1', submission(phone))).toEqual({ kind: 'ignore' });
  });
});

describe('the queue', () => {
  test('accepts a new job with its place in the queue', () => {
    const phone = join('c1');
    const message = submission(phone);
    expect(session.submit('c1', message)).toEqual({
      kind: 'run',
      reply: { type: 'accepted', job: message.job, ahead: 0 },
      job: message.job,
      request: { raw: RAW, force: false, images: [], fields: [] },
    });
  });

  test('carries the label frames in order and typed fields of a job', () => {
    const phone = join('c1');
    const image = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), code: { x: 10, y: 20, size: 130 } };
    const next = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), code: { x: 11, y: 20, size: 130 } };
    const fields = [{ name: '货架号', value: 'A-1-2-3' }];
    const decision = session.submit('c1', { ...submission(phone), images: [image, next], fields });
    expect(decision).toMatchObject({ kind: 'run', request: { raw: RAW, force: false, images: [image, next], fields } });
  });

  test('queues jobs from every phone in the order they came', () => {
    const first = join('c1');
    const second = join('c2');
    const a = queue(first);
    const message = submission(second);
    expect(session.submit('c2', message)).toMatchObject({ reply: { type: 'accepted', job: message.job, ahead: 1 } });
    expect(session.status().queued).toBe(2);
    expect(session.started(a)).toEqual([{ connection: 'c1', message: { type: 'started', job: a } }]);
  });

  test('sends the result to the phone that asked, and one queue update to every phone that moved up', () => {
    const first = join('c1');
    const second = join('c2');
    const a = queue(first);
    const b = queue(second);
    const c = queue(first);
    const d = queue(first);
    session.started(a);
    expect(session.complete(a, PRINTED)).toEqual([
      { connection: 'c1', message: { type: 'result', job: a, result: PRINTED } },
      { connection: 'c2', message: { type: 'queue', jobs: [{ job: b, ahead: 0 }] } },
      {
        connection: 'c1',
        message: {
          type: 'queue',
          jobs: [
            { job: c, ahead: 1 },
            { job: d, ahead: 2 },
          ],
        },
      },
    ]);
    expect(session.status().phones.map((phone) => phone.printed)).toEqual([1, 0]);
    expect(session.status().printed).toBe(1);
  });

  test('tells nobody when no queued job moved', () => {
    const first = join('c1');
    const second = join('c2');
    queue(first);
    queue(second);
    expect(session.removePhone(phoneId(1)).deliveries).toEqual([]);
  });

  test('keeps a result for a phone that is offline', () => {
    const phone = join('c1');
    const job = queue(phone);
    session.phoneLeft('c1');
    session.started(job);
    expect(session.complete(job, PRINTED)).toEqual([]);
    const again = join('c2', 'x', phone.token);
    expect(session.submit('c2', submission(again, job))).toEqual({
      kind: 'reply',
      message: { type: 'result', job, result: PRINTED },
    });
  });

  test('drops the queued jobs of a removed phone and moves the others up', () => {
    const first = join('c1');
    const second = join('c2');
    const a = queue(first);
    queue(second);
    const c = queue(first);
    expect(session.removePhone(phoneId(1))).toEqual({
      kick: 'c2',
      deliveries: [
        {
          connection: 'c1',
          message: {
            type: 'queue',
            jobs: [
              { job: a, ahead: 0 },
              { job: c, ahead: 1 },
            ],
          },
        },
      ],
    });
    expect(session.status().queued).toBe(2);
  });

  test('does not start a job that is no longer queued', () => {
    const phone = join('c1');
    const job = queue(phone);
    session.removePhone(phoneId(0));
    expect(session.started(job)).toBeNull();
  });
});

describe('submissions', () => {
  test('ignores submissions before the phone has joined', () => {
    session.phoneJoined('c1');
    expect(
      session.submit('c1', {
        type: 'submit',
        nonce: randomId(),
        seq: 1,
        job: randomId(),
        raw: RAW,
        force: false,
        images: [],
        fields: [],
      }),
    ).toEqual({ kind: 'ignore' });
  });

  test('ignores a wrong nonce and a sequence number that does not increase', () => {
    const phone = join('c1');
    expect(session.submit('c1', { ...submission(phone), nonce: randomId() })).toEqual({ kind: 'ignore' });
    const message = submission(phone);
    expect(session.submit('c1', message).kind).toBe('run');
    expect(session.submit('c1', { ...message, job: randomId() })).toEqual({ kind: 'ignore' });
  });

  test('runs a job id once: a repeat gets its progress, then its result', () => {
    const phone = join('c1');
    const job = queue(phone);
    expect(session.submit('c1', submission(phone, job))).toEqual({
      kind: 'reply',
      message: { type: 'accepted', job, ahead: 0 },
    });
    session.started(job);
    expect(session.submit('c1', submission(phone, job))).toEqual({
      kind: 'reply',
      message: { type: 'started', job },
    });
    session.complete(job, PRINTED);
    expect(session.submit('c1', submission(phone, job))).toEqual({
      kind: 'reply',
      message: { type: 'result', job, result: PRINTED },
    });
  });

  test('ignores another phone reusing a job id', () => {
    const first = join('c1');
    const second = join('c2');
    const job = queue(first);
    expect(session.submit('c2', submission(second, job))).toEqual({ kind: 'ignore' });
  });

  test('refuses new jobs from a phone with too many waiting, but not from the others', () => {
    const first = join('c1');
    const second = join('c2');
    for (let index = 0; index < MAX_PENDING_JOBS; index += 1) {
      queue(first);
    }
    const message = submission(first);
    expect(session.submit('c1', message)).toEqual({
      kind: 'reply',
      message: { type: 'refused', job: message.job, reason: 'too-many-pending' },
    });
    expect(session.submit('c2', submission(second)).kind).toBe('run');
  });

  test('refuses jobs beyond the rate limit across all phones, then allows them a minute later', () => {
    const first = join('c1');
    const second = join('c2');
    for (let index = 0; index < MAX_JOBS_PER_MINUTE; index += 1) {
      finish(queue(index % 2 === 0 ? first : second));
    }
    expect(session.submit('c2', submission(second))).toMatchObject({
      kind: 'reply',
      message: { type: 'refused', reason: 'rate-limited' },
    });
    clock.advance(MINUTE_MS);
    expect(session.submit('c2', submission(second)).kind).toBe('run');
  });

  test('forgets the oldest finished jobs beyond its memory', () => {
    const phone = join('c1');
    const first = queue(phone);
    finish(first);
    for (let index = 0; index < JOB_MEMORY; index += 1) {
      // 限流按分钟计：每张之间拉开时间，免得先撞上限流。
      clock.advance(MINUTE_MS / MAX_JOBS_PER_MINUTE);
      finish(queue(phone));
    }
    clock.advance(MINUTE_MS);
    // 最早的任务号已被忘掉：再交上来就是一个新任务。
    expect(session.submit('c1', submission(phone, first)).kind).toBe('run');
  });

  test('lists the connections of the phones that are online', () => {
    join('c1');
    join('c2');
    session.phoneLeft('c1');
    expect(session.onlineConnections()).toEqual(['c2']);
  });
});

describe('expiry', () => {
  test('ends a session nobody joined within the time limit', () => {
    expect(session.unclaimedUntil()).toBe(clock.now() + UNCLAIMED_TTL_MS);
    clock.advance(UNCLAIMED_TTL_MS - 1);
    expect(session.expiry()).toBeNull();
    clock.advance(1);
    expect(session.expiry()).toBe('idle');
  });

  test('starts the join deadline when the code is first shown, not while connecting', () => {
    const fresh = new MobileSession(clock);
    clock.advance(UNCLAIMED_TTL_MS);
    expect(fresh.unclaimedUntil()).toBeNull();
    expect(fresh.expiry()).toBeNull();
    fresh.relayOpened();
    expect(fresh.unclaimedUntil()).toBe(clock.now() + UNCLAIMED_TTL_MS);
  });

  test('keeps the join deadline when the relay session is reopened', () => {
    const deadline = session.unclaimedUntil();
    clock.advance(1_000);
    session.relayOpened();
    expect(session.unclaimedUntil()).toBe(deadline);
  });

  test('stops the join deadline once a phone has joined', () => {
    join('c1');
    expect(session.unclaimedUntil()).toBeNull();
    clock.advance(UNCLAIMED_TTL_MS);
    expect(session.expiry()).toBeNull();
  });

  test('ends a session left idle, counting from the last job', () => {
    const phone = join('c1');
    clock.advance(IDLE_END_MS - 1);
    finish(queue(phone));
    clock.advance(IDLE_END_MS - 1);
    expect(session.expiry()).toBeNull();
    clock.advance(1);
    expect(session.expiry()).toBe('idle');
  });

  test('does not end while a job is still waiting to print', () => {
    queue(join('c1'));
    clock.advance(IDLE_END_MS * 2);
    expect(session.expiry()).toBeNull();
  });
});
