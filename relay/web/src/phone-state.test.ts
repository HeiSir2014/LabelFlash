import { describe, expect, test } from 'bun:test';
import { MAX_PENDING_JOBS, type PhonePrintResult } from '../../../src/shared/mobile-protocol';
import {
  canSubmit,
  initialPhoneState,
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

const welcomed: PhoneEvent = { type: 'welcomed', printer: '热敏标签机' };
const submitted = (job: string, raw = RAW, force = false): PhoneEvent => ({ type: 'submitted', job, raw, force });

describe('reducePhone', () => {
  test('starts without a link or connecting', () => {
    expect(initialPhoneState(false).screen).toBe('no-link');
    expect(initialPhoneState(true)).toMatchObject({ screen: 'connecting', link: 'reconnecting' });
  });

  test('starts scanning once the desktop welcomes the phone', () => {
    expect(run([welcomed])).toMatchObject({ screen: 'scanning', link: 'online', printer: '热敏标签机' });
  });

  test('follows the desktop printer', () => {
    expect(run([welcomed, { type: 'printer', printer: null }]).printer).toBeNull();
  });

  test('lists a scanned job first, then tracks it to its result', () => {
    let state = run([welcomed, submitted('a'), submitted('b')]);
    expect(state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['b', 'sending'],
      ['a', 'sending'],
    ]);
    state = reducePhone(state, { type: 'accepted', job: 'a', ahead: 3 });
    expect(state.jobs[1]).toMatchObject({ status: 'queued', ahead: 3 });
    state = reducePhone(state, { type: 'accepted', job: 'a', ahead: 1 });
    expect(state.jobs[1]).toMatchObject({ status: 'queued', ahead: 1 });
    state = reducePhone(state, { type: 'started', job: 'a' });
    expect(state.jobs[1]).toMatchObject({ status: 'printing', ahead: null });
    state = reducePhone(state, { type: 'result', job: 'a', result: PRINTED });
    expect(state.jobs[1]).toMatchObject({ status: 'done', result: PRINTED });
  });

  test('does not move a printing or finished job back into the queue', () => {
    const printing = run([welcomed, submitted('a'), { type: 'started', job: 'a' }]);
    expect(reducePhone(printing, { type: 'accepted', job: 'a', ahead: 0 })).toBe(printing);
    const done = reducePhone(printing, { type: 'result', job: 'a', result: PRINTED });
    expect(reducePhone(done, { type: 'started', job: 'a' })).toBe(done);
  });

  test('marks a refused job', () => {
    const state = run([welcomed, submitted('a'), { type: 'refused', job: 'a', reason: 'rate-limited' }]);
    expect(state.jobs[0]).toMatchObject({ status: 'refused', refusal: 'rate-limited' });
  });

  test('keeps only the most recent jobs', () => {
    const events = Array.from({ length: JOB_HISTORY + 5 }, (_, index) => submitted(`job${index}`));
    const state = run([welcomed, ...events]);
    expect(state.jobs).toHaveLength(JOB_HISTORY);
    expect(state.jobs[0]?.id).toBe(`job${JOB_HISTORY + 4}`);
  });

  test('ignores updates for jobs it no longer lists', () => {
    const state = run([welcomed, submitted('a')]);
    expect(reducePhone(state, { type: 'result', job: 'gone', result: PRINTED })).toBe(state);
  });

  test('tracks the link separately from the jobs', () => {
    const state = run([welcomed, submitted('a'), { type: 'link', link: 'reconnecting' }]);
    expect(state).toMatchObject({ screen: 'scanning', link: 'reconnecting' });
    expect(state.jobs[0]?.status).toBe('sending');
  });

  test('ends for good', () => {
    const ended = run([welcomed, { type: 'ended', reason: 'idle' }]);
    expect(ended).toMatchObject({ screen: 'ended', endReason: 'idle' });
    expect(reducePhone(ended, welcomed)).toBe(ended);
    expect(run([{ type: 'not-found' }]).screen).toBe('not-found');
    expect(run([{ type: 'denied', reason: 'full' }])).toMatchObject({ screen: 'denied', denial: 'full' });
  });

  test('remembers whether the camera works', () => {
    expect(run([welcomed, { type: 'camera', camera: 'unavailable' }]).camera).toBe('unavailable');
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
