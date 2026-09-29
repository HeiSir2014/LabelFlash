import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import type { JobRecord } from '../types';
import { payloadOf, testPayload } from './webhook-event';
import { sanitizeWebhooks } from './webhook-model';

const STATION = { name: '样衣间-1', app: '1.0.1' };
const AT = Date.UTC(2026, 8, 28, 1, 5);
const JOB: JobRecord = {
  id: 'job-1',
  createdAt: AT,
  raw: 'CL5640-TK-图片色-XL',
  printerName: '热敏标签机',
  source: 'desktop',
  status: 'printed',
  forced: false,
};
const SCAN: ScanResult = {
  raw: JOB.raw,
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '货架号', value: 'A-01' },
  ],
};

describe('payloadOf', () => {
  test('describes a printed label with its fields and the station', () => {
    expect(payloadOf(JOB, SCAN, STATION)).toEqual({
      id: 'job-1',
      event: 'printed',
      occurredAt: '2026-09-28T01:05:00.000Z',
      raw: JOB.raw,
      rule: { id: 'builtin:dash-three', name: '横杠三段（编码-颜色-尺码）' },
      fields: { 编码: 'CL5640-TK', 货架号: 'A-01' },
      printer: '热敏标签机',
      paper: null,
      source: 'desktop',
      forced: false,
      failureReason: null,
      station: STATION,
    });
  });

  test('carries the failure reason, and no rule or fields when nothing was recognised', () => {
    expect(payloadOf({ ...JOB, status: 'failed', failureReason: 'LOOKUP_FAILED' }, SCAN, STATION)).toMatchObject({
      event: 'failed',
      failureReason: 'LOOKUP_FAILED',
    });
    expect(payloadOf({ ...JOB, status: 'invalid' }, null, STATION)).toMatchObject({
      event: 'invalid',
      rule: null,
      fields: null,
    });
  });
});

describe('payload paper', () => {
  test('carries the paper of the job, or null for jobs without one', () => {
    expect(payloadOf({ ...JOB, paper: '100x180' }, SCAN, STATION).paper).toBe('100x180');
    expect(payloadOf(JOB, SCAN, STATION).paper).toBeNull();
  });
});

describe('testPayload', () => {
  test('has the same shape as a real event', () => {
    expect(Object.keys(testPayload('test-1', AT, STATION)).sort()).toEqual(
      Object.keys(payloadOf(JOB, SCAN, STATION)).sort(),
    );
  });
});

describe('sanitizeWebhooks', () => {
  const endpoint = {
    id: 'w1',
    name: 'ERP',
    url: 'https://erp.example.com/hooks/labels',
    secretName: 'ERP 签名',
    events: ['printed', 'failed', 'bogus'],
    enabled: true,
  };

  test('keeps valid endpoints and unknown events are dropped', () => {
    expect(sanitizeWebhooks([endpoint])).toEqual([{ ...endpoint, events: ['printed', 'failed'] }]);
  });

  test('drops endpoints with a bad url, id or secret name, duplicates, and anything past five', () => {
    const bad = [
      { ...endpoint, id: 'a', url: 'ftp://x' },
      { ...endpoint, id: 'b', secretName: '{x}' },
      { ...endpoint, id: '../c' },
      endpoint,
      endpoint,
      ...Array.from({ length: 6 }, (_, index) => ({ ...endpoint, id: `n${index}` })),
    ];
    expect(sanitizeWebhooks(bad).map((item) => item.id)).toEqual(['w1', 'n0', 'n1', 'n2', 'n3']);
    expect(sanitizeWebhooks('x')).toEqual([]);
  });
});
