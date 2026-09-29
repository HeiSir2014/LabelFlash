import type { ApiJobPage, ApiJobStore } from '../api/api-job-store';
import type { PrintJob } from '../api/api-model';

const isUnfinished = (job: PrintJob) => job.state === 'QUEUED' || job.state === 'PRINTING';

/** 测试替身：行为和 SQLite 实现一致，另加 all() 供断言。 */
export class InMemoryApiJobStore implements ApiJobStore {
  private readonly rows: Array<{ seq: number; job: PrintJob }> = [];
  private nextSeq = 1;

  insert(job: PrintJob): void {
    this.rows.push({ seq: this.nextSeq++, job });
  }

  update(job: PrintJob): void {
    const row = this.rows.find((item) => item.job.id === job.id);
    if (!row) {
      throw new Error(`Unknown api job: ${job.id}`);
    }
    row.job = job;
  }

  get(id: string): PrintJob | null {
    return this.rows.find((item) => item.job.id === id)?.job ?? null;
  }

  findByRequestId(caller: string, requestId: string, since: number): PrintJob | null {
    const matches = this.rows.filter(
      ({ job }) => job.caller === caller && job.requestId === requestId && job.createdAt >= since,
    );
    return matches.at(-1)?.job ?? null;
  }

  list(caller: string, limit: number, cursor: number | null): ApiJobPage {
    const rows = this.rows
      .filter(({ seq, job }) => job.caller === caller && (cursor === null || seq < cursor))
      .reverse();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { jobs: page.map((row) => row.job), nextCursor: rows.length > limit && last ? last.seq : null };
  }

  pendingLabels(): number {
    return this.rows
      .filter(({ job }) => isUnfinished(job))
      .reduce((sum, { job }) => sum + job.copies - job.sentCopies, 0);
  }

  listUnfinished(): PrintJob[] {
    return this.rows.filter(({ job }) => isUnfinished(job)).map((row) => row.job);
  }

  deleteFinishedBefore(time: number): void {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      if (row && row.job.createdAt < time && !isUnfinished(row.job)) {
        this.rows.splice(index, 1);
      }
    }
  }

  all(): PrintJob[] {
    return this.rows.map((row) => row.job);
  }
}
