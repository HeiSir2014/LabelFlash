import { describe, expect, test } from 'bun:test';
import { IPP_BLOCKS_UPDATE_ISSUE, ippBlocksUpdate, ippQuitDialogText, settleWithin } from './ipp-quit';

describe('ippQuitDialogText', () => {
  test('says how many shared jobs are still open and what quitting does to them', () => {
    const { message, detail } = ippQuitDialogText(2);
    expect(message).toBe('局域网共享还有 2 个任务没打完，现在退出吗？');
    expect(detail).toContain('不会再打');
  });
});

describe('ippBlocksUpdate', () => {
  test('refuses to install an update while shared jobs are open', () => {
    expect(ippBlocksUpdate(1)).toBe(IPP_BLOCKS_UPDATE_ISSUE);
    expect(ippBlocksUpdate(0)).toBeNull();
  });
});

describe('settleWithin', () => {
  test('waits for the work but not longer than the limit', async () => {
    expect(await settleWithin(Promise.resolve(), 1_000)).toBe(true);
    expect(await settleWithin(new Promise(() => undefined), 10)).toBe(false);
    expect(await settleWithin(Promise.reject(new Error('x')), 1_000)).toBe(true);
  });
});
