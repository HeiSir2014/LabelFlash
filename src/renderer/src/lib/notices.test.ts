import { describe, expect, test } from 'bun:test';
import { NoticeCenter } from './notices';

describe('NoticeCenter', () => {
  test('notifies subscribers and keeps only the newest three notices', () => {
    const center = new NoticeCenter();
    const seen: string[][] = [];
    center.subscribe((notices) => seen.push(notices.map((n) => n.message)));
    for (const message of ['a', 'b', 'c', 'd']) center.push('error', message);
    expect(center.snapshot().map((n) => n.message)).toEqual(['b', 'c', 'd']);
    expect(seen).toHaveLength(4);
  });

  test('does not stack the same message twice in a row', () => {
    const center = new NoticeCenter();
    center.push('error', 'x');
    center.push('error', 'x');
    expect(center.snapshot()).toHaveLength(1);
  });

  test('dismisses by id and stops notifying after unsubscribe', () => {
    const center = new NoticeCenter();
    let calls = 0;
    const unsubscribe = center.subscribe(() => {
      calls += 1;
    });
    center.push('info', 'hello');
    const [first] = center.snapshot();
    unsubscribe();
    center.dismiss(first?.id ?? -1);
    expect(center.snapshot()).toEqual([]);
    expect(calls).toBe(1);
  });
});
