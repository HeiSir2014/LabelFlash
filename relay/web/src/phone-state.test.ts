import { describe, expect, test } from 'bun:test';
import { MAX_PENDING_JOBS, type PhonePrintResult } from '../../../src/shared/mobile-protocol';
import {
  canSubmit,
  initialPhoneState,
  isFinished,
  JOB_HISTORY,
  type PhoneEvent,
  type PhoneState,
  reducePhone,
} from './phone-state';

const RAW = 'CL5640-TK-图片色-XL';
const PRINTED: PhonePrintResult = {
  status: 'printed',
  ruleName: '横杠三段',
  fields: [{ name: '编码', value: 'CL5640' }],
};

function run(events: PhoneEvent[], start: PhoneState = initialPhoneState(true)): PhoneState {
  return events.reduce(reducePhone, start);
}

const welcomed: PhoneEvent = { type: 'welcomed', printer: '热敏标签机', image: null };
const submitted = (job: string, raw = RAW, force = false): PhoneEvent => ({ type: 'submitted', job, raw, force });
const queued = (job: string, ahead: number): PhoneEvent => ({ type: 'queued', positions: [{ job, ahead }] });

describe('reducePhone', () => {
  test('starts without a link or connecting', () => {
    expect(initialPhoneState(false).screen).toEqual({ name: 'no-link' });
    expect(initialPhoneState(true)).toMatchObject({
      screen: { name: 'connecting' },
      link: 'reconnecting',
      camera: 'idle',
      decoder: 'loading',
    });
  });

  test('starts scanning once the desktop welcomes the phone', () => {
    expect(run([welcomed])).toMatchObject({ screen: { name: 'scanning' }, link: 'online', printer: '热敏标签机' });
  });

  test('follows the desktop printer', () => {
    expect(run([welcomed, { type: 'printer', printer: null, image: null }]).printer).toBeNull();
  });

  test('lists a scanned job first, then tracks it to its result', () => {
    let state = run([welcomed, submitted('a'), submitted('b')]);
    expect(state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['b', 'sending'],
      ['a', 'sending'],
    ]);
    state = reducePhone(state, queued('a', 3));
    expect(state.jobs[1]).toMatchObject({ status: 'queued', ahead: 3 });
    state = reducePhone(state, queued('a', 1));
    expect(state.jobs[1]).toMatchObject({ status: 'queued', ahead: 1 });
    state = reducePhone(state, { type: 'started', job: 'a' });
    expect(state.jobs[1]).toEqual({ id: 'a', raw: RAW, force: false, status: 'printing' });
    state = reducePhone(state, { type: 'result', job: 'a', result: PRINTED });
    expect(state.jobs[1]).toEqual({ id: 'a', raw: RAW, force: false, status: 'done', result: PRINTED });
  });

  test('moves several jobs of one queue update at once', () => {
    const state = run([
      welcomed,
      submitted('a'),
      submitted('b'),
      {
        type: 'queued',
        positions: [
          { job: 'a', ahead: 0 },
          { job: 'b', ahead: 1 },
        ],
      },
    ]);
    expect(state.jobs.map((job) => (job.status === 'queued' ? job.ahead : null))).toEqual([1, 0]);
  });

  test('does not move a printing or finished job back into the queue', () => {
    const printing = run([welcomed, submitted('a'), { type: 'started', job: 'a' }]);
    expect(reducePhone(printing, queued('a', 0))).toBe(printing);
    const done = reducePhone(printing, { type: 'result', job: 'a', result: PRINTED });
    expect(reducePhone(done, { type: 'started', job: 'a' })).toBe(done);
    expect(reducePhone(done, { type: 'refused', job: 'a', reason: 'rate-limited' })).toBe(done);
  });

  test('marks a refused job', () => {
    const state = run([welcomed, submitted('a'), { type: 'refused', job: 'a', reason: 'rate-limited' }]);
    expect(state.jobs[0]).toMatchObject({ status: 'refused', reason: 'rate-limited' });
  });

  test('lists a restored job only once', () => {
    const state = run([submitted('a'), welcomed, submitted('a')]);
    expect(state.jobs).toHaveLength(1);
  });

  test('keeps only the most recent finished jobs', () => {
    const events = Array.from({ length: JOB_HISTORY + 5 }, (_, index) => [
      submitted(`job${index}`),
      { type: 'result', job: `job${index}`, result: PRINTED } as PhoneEvent,
    ]).flat();
    const state = run([welcomed, ...events]);
    expect(state.jobs).toHaveLength(JOB_HISTORY);
    expect(state.jobs[0]?.id).toBe(`job${JOB_HISTORY + 4}`);
  });

  test('keeps a job still waiting for its result however many came after it', () => {
    const later = Array.from({ length: JOB_HISTORY }, (_, index) => [
      submitted(`job${index}`),
      { type: 'result', job: `job${index}`, result: PRINTED } as PhoneEvent,
    ]).flat();
    const state = run([welcomed, submitted('waiting'), ...later]);
    expect(state.jobs.at(-1)).toMatchObject({ id: 'waiting', status: 'sending' });
  });

  test('ignores updates for jobs it no longer lists', () => {
    const state = run([welcomed, submitted('a')]);
    expect(reducePhone(state, { type: 'result', job: 'gone', result: PRINTED })).toBe(state);
  });

  test('tracks the link separately from the jobs', () => {
    const state = run([welcomed, submitted('a'), { type: 'link', link: 'reconnecting' }]);
    expect(state).toMatchObject({ screen: { name: 'scanning' }, link: 'reconnecting' });
    expect(state.jobs[0]?.status).toBe('sending');
  });

  test('ends for good', () => {
    const ended = run([welcomed, { type: 'ended', reason: 'idle' }]);
    expect(ended.screen).toEqual({ name: 'ended', reason: 'idle' });
    expect(isFinished(ended)).toBe(true);
    expect(reducePhone(ended, welcomed)).toBe(ended);
    expect(run([{ type: 'not-found' }]).screen).toEqual({ name: 'not-found' });
    expect(run([{ type: 'denied', reason: 'locked' }]).screen).toEqual({ name: 'denied', reason: 'locked' });
    expect(run([{ type: 'outdated' }]).screen).toEqual({ name: 'outdated' });
  });

  test('tracks the camera and the decoder', () => {
    const state = run([welcomed, { type: 'camera', camera: 'unavailable' }, { type: 'decoder', decoder: 'failed' }]);
    expect(state).toMatchObject({ camera: 'unavailable', decoder: 'failed' });
  });
});

describe('canSubmit', () => {
  test('allows scanning while the session is active, even offline', () => {
    expect(canSubmit(run([welcomed]))).toBe(true);
    expect(canSubmit(run([welcomed, { type: 'link', link: 'desktop-offline' }]))).toBe(true);
  });

  test('refuses before the first welcome and after the end', () => {
    expect(canSubmit(initialPhoneState(true))).toBe(false);
    expect(canSubmit(run([welcomed, { type: 'ended', reason: 'stopped' }]))).toBe(false);
  });

  test('holds scanning while too many jobs wait for their result', () => {
    const pending = Array.from({ length: MAX_PENDING_JOBS }, (_, index) => submitted(`job${index}`));
    const full = run([welcomed, ...pending, { type: 'started', job: 'job0' }]);
    expect(canSubmit(full)).toBe(false);
    expect(canSubmit(reducePhone(full, { type: 'result', job: 'job0', result: PRINTED }))).toBe(true);
  });
});
