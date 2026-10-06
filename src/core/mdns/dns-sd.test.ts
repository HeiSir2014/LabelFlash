import { describe, expect, test } from 'bun:test';
import { encodeTxt, instanceLabel, type MdnsZone, SERVICE_ENUMERATION, zoneRecords } from './dns-sd';

const ZONE: MdnsZone = {
  host: ['labelflash-1a2b3c4d', 'local'],
  address: '192.168.1.10',
  services: [
    {
      instance: '60×40 标签 @ 前台',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal', '_print'],
      port: 8631,
      txt: [
        ['txtvers', '1'],
        ['rp', 'printers/60x40'],
      ],
    },
  ],
};

describe('instanceLabel', () => {
  test('keeps short names and cuts long ones at 63 bytes without splitting a character', () => {
    expect(instanceLabel('60×40 标签 @ 前台')).toBe('60×40 标签 @ 前台');
    const cut = instanceLabel('标'.repeat(30));
    expect(new TextEncoder().encode(cut).length).toBe(63);
    expect(instanceLabel('a\u0000b')).toBe('ab');
    expect(new TextEncoder().encode(instanceLabel('标'.repeat(30), 60)).length).toBe(60);
  });
});

describe('encodeTxt', () => {
  test('writes key=value entries and refuses entries over 255 bytes', () => {
    expect(encodeTxt([['rp', 'printers/60x40']]).map((entry) => new TextDecoder().decode(entry))).toEqual([
      'rp=printers/60x40',
    ]);
    expect(() => encodeTxt([['note', 'x'.repeat(260)]])).toThrow('255');
  });
});

describe('zoneRecords', () => {
  test('lists the service type, the instance under the type and each subtype, its SRV, TXT and the host address', () => {
    const records = zoneRecords(ZONE);
    expect(records.map((record) => `${record.type} ${record.name.join('.')}`)).toEqual([
      `PTR ${SERVICE_ENUMERATION.join('.')}`,
      'PTR _ipp._tcp.local',
      'PTR _universal._sub._ipp._tcp.local',
      'PTR _print._sub._ipp._tcp.local',
      'SRV 60×40 标签 @ 前台._ipp._tcp.local',
      'TXT 60×40 标签 @ 前台._ipp._tcp.local',
      'A labelflash-1a2b3c4d.local',
    ]);
    expect(records.at(-1)).toMatchObject({ type: 'A', address: '192.168.1.10', ttl: 120, cacheFlush: true });
  });
});
