import type { JobStore, LastPrinted } from '../job-store';
import type { JobRecord } from '../types';

/** 测试替身：只实现 PrintService 需要的能力，另加 listRecent 供断言。 */
export class InMemoryJobStore implements JobStore {
  private readonly jobs: JobRecord[] = [];

  append(job: JobRecord): void {
    this.jobs.push(job);
  }

  listLastPrinted(since: number): LastPrinted[] {
    const latest = new Map<string, number>();
    for (const job of this.jobs) {
      if (job.status === 'printed' && job.createdAt >= since && job.caller === undefined) {
        latest.set(job.raw, Math.max(latest.get(job.raw) ?? job.createdAt, job.createdAt));
      }
    }
    return [...latest].map(([raw, printedAt]) => ({ raw, printedAt }));
  }

  listRecent(limit: number): JobRecord[] {
    return this.jobs.slice(-limit).reverse();
  }
}
