import { describe, expect, test } from 'bun:test';
import type { BatchProgress } from '../../../core/batch/batch-runner';
import { describePauseReason, describeRunProgress, runButtonProgress } from './print-run-text';

const RUNNING: BatchProgress = {
  batchId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  state: 'running',
  total: 120,
  sent: 35,
  failed: 0,
  pauseReason: null,
};

describe('describeRunProgress', () => {
  test('describes a run in every state with the same words for batch and PDF', () => {
    expect(describeRunProgress(RUNNING)).toEqual({ text: '正在打印 · 已发送 35 / 120 张', percent: 29 });
    expect(describeRunProgress({ ...RUNNING, state: 'paused', pauseReason: 'operator' }).text).toBe(
      '已暂停（点继续接着打）· 已发送 35 / 120 张',
    );
    expect(describeRunProgress({ ...RUNNING, state: 'canceled', failed: 2 }).text).toBe(
      '已取消 · 已发送 35 / 120 张 · 失败 2 张',
    );
    expect(describeRunProgress({ ...RUNNING, state: 'done', sent: 120 })).toEqual({
      text: '全部已发送 · 已发送 120 / 120 张',
      percent: 100,
    });
    expect(describeRunProgress({ ...RUNNING, state: 'done', sent: 118, failed: 2 }).text).toBe(
      '已结束 · 已发送 118 / 120 张 · 失败 2 张',
    );
  });

  test('counts sent and failed labels toward the percentage', () => {
    expect(describeRunProgress({ ...RUNNING, sent: 50, failed: 10 }).percent).toBe(50);
  });
});

describe('describePauseReason', () => {
  test('says why the run paused and what to do next', () => {
    expect(describePauseReason('no-printer')).toBe('这种纸还没有打印机：到「打印机」页分配后点继续');
    expect(describePauseReason('PRINTER_NOT_READY')).toBe('打印机现在不能打印：缺纸、离线或卡纸，处理好后点继续');
    expect(describePauseReason('PRINTER_NOT_FOUND')).toBe('找不到打印机：检查连接后点继续');
    expect(describePauseReason(null)).toBe('点继续接着打');
  });

  // 连续失败自动暂停的两种原因：措辞不一样，超时那种要提醒操作员自己确认有没有出纸，不能直接当成没打。
  test('explains the two consecutive-failure pause reasons differently', () => {
    expect(describePauseReason('consecutive-failures')).toBe('连续几张都没打印成功：检查打印机后点继续');
    expect(describePauseReason('consecutive-failures-after-timeout')).toBe(
      '最后一张可能已经打出来了：看一眼打印机，确认后点继续',
    );
  });
});

describe('runButtonProgress', () => {
  test('counts sent and failed labels of the total while a run prints or waits', () => {
    expect(runButtonProgress({ ...RUNNING, failed: 1 })).toBe('36/120');
    expect(runButtonProgress({ ...RUNNING, state: 'paused', pauseReason: 'operator' })).toBe('35/120');
    expect(runButtonProgress({ ...RUNNING, state: 'done' })).toBeNull();
    expect(runButtonProgress({ ...RUNNING, state: 'canceled' })).toBeNull();
    expect(runButtonProgress(null)).toBeNull();
  });
});
