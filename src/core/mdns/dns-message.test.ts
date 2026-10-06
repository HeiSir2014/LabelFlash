import { describe, expect, test } from 'bun:test';
import { DNS_TYPES, type DnsMessage, decodeDnsMessage, encodeDnsMessage, sameName } from './dns-message';

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const label = (text: string): number[] => {
  const bytes = [...new TextEncoder().encode(text)];
  return [bytes.length, ...bytes];
};
/** 12 字节的头：编号、标志、四部分的条数。 */
const header = (questions: number, flags = 0): number[] => [
  ...u16(0),
  ...u16(flags),
  ...u16(questions),
  0,
  0,
  0,
  0,
  0,
  0,
];

const RESPONSE: DnsMessage = {
  id: 0,
  isResponse: true,
  questions: [],
  answers: [
    { type: 'PTR', name: ['_ipp', '_tcp', 'local'], ttl: 4500, target: ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'] },
    {
      type: 'SRV',
      name: ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'],
      ttl: 120,
      cacheFlush: true,
      port: 8631,
      target: ['labelflash-1a2b3c4d', 'local'],
    },
    {
      type: 'TXT',
      name: ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'],
      ttl: 4500,
      cacheFlush: true,
      entries: [new TextEncoder().encode('txtvers=1'), new TextEncoder().encode('rp=printers/60x40')],
    },
  ],
  authorities: [],
  additionals: [
    { type: 'A', name: ['labelflash-1a2b3c4d', 'local'], ttl: 120, cacheFlush: true, address: '192.168.1.10' },
  ],
};

describe('encodeDnsMessage and decodeDnsMessage', () => {
  test('round-trip a response with PTR, SRV, TXT and A records', () => {
    expect(decodeDnsMessage(encodeDnsMessage(RESPONSE))).toEqual(RESPONSE);
  });

  test('write the response and authoritative flags and the cache-flush bit', () => {
    const bytes = encodeDnsMessage(RESPONSE);
    expect([bytes[2], bytes[3]]).toEqual([0x84, 0x00]);
    expect([bytes[6], bytes[7], bytes[10], bytes[11]]).toEqual([0, 3, 0, 1]);
  });

  test('refuse to encode a label over 63 bytes', () => {
    const message: DnsMessage = {
      ...RESPONSE,
      answers: [],
      additionals: [{ type: 'A', name: ['x'.repeat(64), 'local'], ttl: 1, cacheFlush: false, address: '1.2.3.4' }],
    };
    expect(() => encodeDnsMessage(message)).toThrow('bytes');
  });
});

describe('decodeDnsMessage', () => {
  test('reads questions with compressed names and the unicast bit', () => {
    // 第 1 个问题从第 12 字节开始；第 2 个问题的名字末尾用指针指回第 12 字节（_ipp._tcp.local）。
    const bytes = Uint8Array.from([
      ...header(2),
      ...label('_ipp'),
      ...label('_tcp'),
      ...label('local'),
      0,
      ...u16(DNS_TYPES.PTR),
      ...u16(0x8001),
      ...label('_universal'),
      ...label('_sub'),
      0xc0,
      12,
      ...u16(DNS_TYPES.PTR),
      ...u16(0x0001),
    ]);
    expect(decodeDnsMessage(bytes)?.questions).toEqual([
      { name: ['_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: true },
      { name: ['_universal', '_sub', '_ipp', '_tcp', 'local'], type: DNS_TYPES.PTR, unicastResponse: false },
    ]);
  });

  test('drops packets with pointer loops, forward pointers, long labels or missing bytes', () => {
    const question = (name: number[]) => Uint8Array.from([...header(1), ...name, ...u16(DNS_TYPES.PTR), ...u16(1)]);
    expect(decodeDnsMessage(question([0xc0, 12]))).toBeNull();
    expect(decodeDnsMessage(question([0xc0, 40]))).toBeNull();
    expect(decodeDnsMessage(question([64, ...new Array(64).fill(0x61), 0]))).toBeNull();
    expect(decodeDnsMessage(Uint8Array.from([...header(1), ...label('_ipp')]))).toBeNull();
    expect(decodeDnsMessage(Uint8Array.of(0, 1, 2))).toBeNull();
    expect(decodeDnsMessage(Uint8Array.from([...u16(0), ...u16(0), ...u16(65), 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  test('keeps records of other types only by name and type', () => {
    // biome-ignore format: 按 DNS 报文的字段逐个对照
    const bytes = Uint8Array.from([
      ...u16(0),
      ...u16(0x8400),
      0, 0, 0, 1, 0, 0, 0, 0,
      ...label('host'),
      ...label('local'),
      0,
      ...u16(47),
      ...u16(1),
      0, 0, 0, 120,
      ...u16(2),
      0, 0,
    ]);
    expect(decodeDnsMessage(bytes)?.answers).toEqual([{ type: 'OTHER', name: ['host', 'local'], ttl: 120, code: 47 }]);
  });
});

describe('sameName', () => {
  test('compares ASCII letters without case and everything else exactly', () => {
    expect(sameName(['_IPP', '_tcp', 'LOCAL'], ['_ipp', '_tcp', 'local'])).toBe(true);
    expect(sameName(['标签'], ['标签'])).toBe(true);
    expect(sameName(['_ipp', 'local'], ['_ipp', '_tcp', 'local'])).toBe(false);
  });
});
