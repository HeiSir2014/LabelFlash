import { describe, expect, test } from 'bun:test';
import { AnswerThrottle, MULTICAST_ANSWER_INTERVAL_MS } from './answer-throttle';
import type { DnsRecord } from './dns-message';

const PTR: DnsRecord = {
  type: 'PTR',
  name: ['_ipp', '_tcp', 'local'],
  ttl: 4500,
  target: ['a', '_ipp', '_tcp', 'local'],
};
const A: DnsRecord = { type: 'A', name: ['host', 'local'], ttl: 120, cacheFlush: true, address: '192.168.1.10' };

describe('AnswerThrottle', () => {
  // RFC 6762 §6：同一条记录在同一块网卡上一秒内最多组播一次，别的设备怎么刷查询也放大不了流量。
  test('lets each record out once per second on each card', () => {
    const throttle = new AnswerThrottle();
    expect(throttle.take('192.168.1.10', [PTR, A], 0)).toEqual([PTR, A]);
    expect(throttle.take('192.168.1.10', [PTR, A], MULTICAST_ANSWER_INTERVAL_MS - 1)).toEqual([]);
    expect(throttle.take('10.0.0.5', [PTR], 1)).toEqual([PTR]);
    expect(throttle.take('192.168.1.10', [PTR], MULTICAST_ANSWER_INTERVAL_MS)).toEqual([PTR]);
  });

  test('treats names without case', () => {
    const throttle = new AnswerThrottle();
    throttle.take('x', [A], 0);
    expect(throttle.take('x', [{ ...A, name: ['HOST', 'LOCAL'] }], 10)).toEqual([]);
  });
});
