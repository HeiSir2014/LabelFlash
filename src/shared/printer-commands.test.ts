import { describe, expect, test } from 'bun:test';
import { notSentText, rawSendFailureText } from './printer-commands';

describe('notSentText', () => {
  test('explains each reason nothing was sent in Chinese', () => {
    expect(notSentText('no-command-set')).toBe('这台打印机设为「不发指令」，没有发送');
    expect(notSentText('unknown-command-set')).toBe('认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种');
    expect(notSentText('nothing-to-send')).toBe('各项都是「不改」，没有要发送的设置');
  });
});

describe('rawSendFailureText', () => {
  test('gives a Chinese message and next step for every failure kind, not the raw English code', () => {
    expect(rawSendFailureText('not-found', '')).toContain('系统里找不到这台打印机');
    expect(rawSendFailureText('access-denied', '')).toContain('没有向这台打印机发送的权限');
    expect(rawSendFailureText('raw-rejected', '')).toContain('驱动不接受直接发送的指令');
    expect(rawSendFailureText('not-sent', '')).toContain('没有发出去');
    expect(rawSendFailureText('unsupported', '')).toContain('不能直接向打印机发送指令');
  });

  // uncertain：探测进程没有及时回应，发没发出去不知道——不是「没做成」，是「不知道做没做成」。
  test('describes an uncertain send as uncertain, not as a plain failure', () => {
    expect(rawSendFailureText('uncertain', '')).toContain('不确定有没有发出去');
  });

  test('truncates a long raw detail and still gives a next step', () => {
    const text = rawSendFailureText('error', 'x'.repeat(200));
    expect(text.length).toBeLessThan(150);
    expect(text).toContain('检查打印机是否开着、连好，再试一次');
  });
});
