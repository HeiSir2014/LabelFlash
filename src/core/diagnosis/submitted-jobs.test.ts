import { describe, expect, test } from 'bun:test';
import { FAKE_CLOCK_START, FakeClock } from '../testing/fake-clock';
import { SUBMITTED_JOBS_KEPT, SUBMITTED_JOBS_TTL_MS, SubmittedJobs } from './submitted-jobs';

describe('SubmittedJobs', () => {
  test('records from the call into the driver until the driver answered', () => {
    const clock = new FakeClock();
    const jobs = new SubmittedJobs(clock);
    clock.advance(1_500);
    jobs.record('标签机A', FAKE_CLOCK_START);
    expect(jobs.windowsFor('标签机A')).toEqual([
      { printerName: '标签机A', startedAtMs: FAKE_CLOCK_START, finishedAtMs: FAKE_CLOCK_START + 1_500 },
    ]);
    expect(jobs.windowsFor('面单机B')).toEqual([]);
  });

  test('forgets entries older than a day and keeps only the latest ones', () => {
    const clock = new FakeClock();
    const jobs = new SubmittedJobs(clock);
    jobs.record('标签机A', clock.now());
    clock.advance(SUBMITTED_JOBS_TTL_MS + 1);
    expect(jobs.windowsFor('标签机A')).toEqual([]);
    for (let index = 0; index <= SUBMITTED_JOBS_KEPT; index += 1) {
      jobs.record('标签机A', clock.now());
    }
    expect(jobs.windowsFor('标签机A')).toHaveLength(SUBMITTED_JOBS_KEPT);
  });
});
