import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { randomId } from '../../shared/mobile-crypto';
import { MAX_PENDING_JOBS, type PhoneMessage, type PhonePrintResult } from '../../shared/mobile-protocol';
import { IDLE_END_MS, JOB_MEMORY, MAX_JOBS_PER_MINUTE, MobileSession, UNCLAIMED_TTL_MS } from './mobile-session';

type Submit = Extract<PhoneMessage, { type: 'submit' }>;

const PRINTED: PhonePrintResult = { status: 'printed', ruleName: '横杠三段', fields: [] };
const MINUTE_MS = 60_000;
const RAW = 'CL5640-TK-图片色-XL';

let clock: FakeClock;
let session: MobileSession;

/** 手机连上并被认领，返回它的连接号、令牌和本次连接的 nonce。 */
function claim(phone = 'p1'): { phone: string; token: string; nonce: string } {
  session.phoneJoined(phone);
  const reply = session.hello(phone, { type: 'hello', token: null, device: 'iPhone · 微信' });
  if (reply.kind !== 'welcome') {
    throw new Error('expected welcome');
  }
  return { phone, token: reply.token, nonce: reply.nonce };
}

function submission(nonce: string, seq: number, job = randomId(), force = false): Submit {
  return { type: 'submit', nonce, seq, job, raw: RAW, force };
}

beforeEach(() => {
  clock = new FakeClock();
  session = new MobileSession(clock);
});

describe('claiming', () => {
  test('welcomes the first phone and remembers it', () => {
    const { token, nonce } = claim();
    expect(token).toHaveLength(22);
    expect(nonce).toHaveLength(22);
    expect(session.status()).toEqual({ phone: { device: 'iPhone · 微信', online: true }, printed: 0 });
  });

  test('welcomes the same phone back with its token and a fresh nonce', () => {
    const first = claim();
    session.phoneLeft(first.phone);
    expect(session.status().phone?.online).toBe(false);
    session.phoneJoined('p2');
    const reply = session.hello('p2', { type: 'hello', token: first.token, device: 'iPhone · Safari' });
    expect(reply).toMatchObject({ kind: 'welcome', token: first.token });
    expect(reply.kind === 'welcome' && reply.nonce).not.toBe(first.nonce);
    expect(session.status().phone).toEqual({ device: 'iPhone · Safari', online: true });
  });

  test('turns away another phone', () => {
    claim();
    session.phoneJoined('p2');
    expect(session.hello('p2', { type: 'hello', token: null, device: '安卓 · Chrome' })).toEqual({ kind: 'taken' });
    expect(session.hello('p2', { type: 'hello', token: randomId(), device: '安卓 · Chrome' })).toEqual({
      kind: 'taken',
    });
  });
});

describe('submissions', () => {
  test('accepts a new job and hands it over to run', () => {
    const { phone, nonce } = claim();
    const message = submission(nonce, 1);
    expect(session.submit(phone, message)).toEqual({
      kind: 'run',
      reply: { type: 'accepted', job: message.job },
      job: message.job,
      raw: RAW,
      force: false,
    });
  });

  test('ignores submissions before the phone is claimed', () => {
    session.phoneJoined('p1');
    expect(session.submit('p1', submission(randomId(), 1))).toEqual({ kind: 'ignore' });
  });

  test('ignores submissions from a phone that was turned away', () => {
    claim();
    session.phoneJoined('p2');
    session.hello('p2', { type: 'hello', token: null, device: 'x' });
    expect(session.submit('p2', submission(randomId(), 1))).toEqual({ kind: 'ignore' });
  });

  test('ignores a wrong nonce and a sequence number that does not increase', () => {
    const { phone, nonce } = claim();
    expect(session.submit(phone, submission(randomId(), 1))).toEqual({ kind: 'ignore' });
    expect(session.submit(phone, submission(nonce, 2)).kind).toBe('run');
    expect(session.submit(phone, submission(nonce, 2))).toEqual({ kind: 'ignore' });
    expect(session.submit(phone, submission(nonce, 1))).toEqual({ kind: 'ignore' });
  });

  test('runs a job id once: a repeat gets its progress, then its result', () => {
    const { phone, nonce } = claim();
    const job = randomId();
    expect(session.submit(phone, submission(nonce, 1, job)).kind).toBe('run');
    expect(session.submit(phone, submission(nonce, 2, job))).toEqual({
      kind: 'reply',
      message: { type: 'accepted', job },
    });
    expect(session.complete(job, PRINTED)).toEqual({ type: 'result', job, result: PRINTED });
    expect(session.submit(phone, submission(nonce, 3, job))).toEqual({
      kind: 'reply',
      message: { type: 'result', job, result: PRINTED },
    });
    expect(session.status().printed).toBe(1);
  });

  test('recognises a job resent over a new connection', () => {
    const first = claim();
    const job = randomId();
    session.submit(first.phone, submission(first.nonce, 1, job));
    session.phoneLeft(first.phone);
    session.phoneJoined('p2');
    const reply = session.hello('p2', { type: 'hello', token: first.token, device: 'x' });
    const nonce = reply.kind === 'welcome' ? reply.nonce : '';
    expect(session.submit('p2', submission(nonce, 1, job))).toEqual({
      kind: 'reply',
      message: { type: 'accepted', job },
    });
  });

  test('refuses new jobs while too many wait for their result, without remembering them', () => {
    const { phone, nonce } = claim();
    for (let seq = 1; seq <= MAX_PENDING_JOBS; seq += 1) {
      expect(session.submit(phone, submission(nonce, seq)).kind).toBe('run');
    }
    const job = randomId();
    expect(session.submit(phone, submission(nonce, MAX_PENDING_JOBS + 1, job))).toEqual({
      kind: 'reply',
      message: { type: 'refused', job, reason: 'too-many-pending' },
    });
  });

  test('lets a refused job id be submitted again later', () => {
    const { phone, nonce } = claim();
    const pending: string[] = [];
    for (let seq = 1; seq <= MAX_PENDING_JOBS; seq += 1) {
      const message = submission(nonce, seq);
      session.submit(phone, message);
      pending.push(message.job);
    }
    const job = randomId();
    session.submit(phone, submission(nonce, MAX_PENDING_JOBS + 1, job));
    session.complete(pending[0] ?? '', PRINTED);
    expect(session.submit(phone, submission(nonce, MAX_PENDING_JOBS + 2, job)).kind).toBe('run');
  });

  test('refuses jobs beyond the rate limit, then allows them a minute later', () => {
    const { phone, nonce } = claim();
    let seq = 0;
    for (let index = 0; index < MAX_JOBS_PER_MINUTE; index += 1) {
      seq += 1;
      const message = submission(nonce, seq);
      session.submit(phone, message);
      session.complete(message.job, PRINTED);
    }
    seq += 1;
    expect(session.submit(phone, submission(nonce, seq))).toMatchObject({
      kind: 'reply',
      message: { type: 'refused', reason: 'rate-limited' },
    });
    clock.advance(MINUTE_MS);
    seq += 1;
    expect(session.submit(phone, submission(nonce, seq)).kind).toBe('run');
  });

  test('forgets the oldest finished jobs beyond its memory', () => {
    const { phone, nonce } = claim();
    const first = randomId();
    session.submit(phone, submission(nonce, 1, first));
    session.complete(first, PRINTED);
    for (let index = 0; index < JOB_MEMORY; index += 1) {
      const job = randomId();
      session.submit(phone, submission(nonce, index + 2, job));
      session.complete(job, PRINTED);
      // 限流按分钟计：拉开时间，免得先撞上限流。
      clock.advance(MINUTE_MS / MAX_JOBS_PER_MINUTE);
    }
    expect(session.submit(phone, submission(nonce, JOB_MEMORY + 2, first)).kind).toBe('run');
  });

  test('says who gets the result: the phone connection currently claimed', () => {
    const first = claim();
    expect(session.claimedConnection()).toBe(first.phone);
    session.phoneLeft(first.phone);
    expect(session.claimedConnection()).toBeNull();
  });
});

describe('expiry', () => {
  test('ends a session nobody opened within the time limit', () => {
    clock.advance(UNCLAIMED_TTL_MS - 1);
    expect(session.expiry()).toBeNull();
    clock.advance(1);
    expect(session.expiry()).toBe('idle');
  });

  test('reports when an unclaimed link stops working', () => {
    expect(session.unclaimedUntil()).toBe(clock.now() + UNCLAIMED_TTL_MS);
    claim();
    expect(session.unclaimedUntil()).toBeNull();
  });

  test('ends a claimed session left idle, counting from the last job', () => {
    const { phone, nonce } = claim();
    clock.advance(IDLE_END_MS - 1);
    const message = submission(nonce, 1);
    session.submit(phone, message);
    session.complete(message.job, PRINTED);
    clock.advance(IDLE_END_MS - 1);
    expect(session.expiry()).toBeNull();
    clock.advance(1);
    expect(session.expiry()).toBe('idle');
  });

  test('does not end while a job is still waiting to print', () => {
    const { phone, nonce } = claim();
    session.submit(phone, submission(nonce, 1));
    clock.advance(IDLE_END_MS * 2);
    expect(session.expiry()).toBeNull();
  });
});
