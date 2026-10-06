import { describe, expect, test } from 'bun:test';
import { DNS_TYPES, type DnsMessage, type DnsQuestion } from './dns-message';
import type { MdnsZone } from './dns-sd';
import { announcement, answerQuery, conflictingNames, goodbye, probeQuery } from './mdns-responder';

const ZONE: MdnsZone = {
  host: ['labelflash-1a2b3c4d', 'local'],
  address: '192.168.1.10',
  services: [
    {
      instance: '60×40 标签 @ 前台',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal', '_print'],
      port: 8631,
      txt: [['rp', 'printers/60x40']],
    },
  ],
};
const INSTANCE = ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'];

function query(questions: DnsQuestion[], answers: DnsMessage['answers'] = []): DnsMessage {
  return { id: 77, isResponse: false, questions, answers, authorities: [], additionals: [] };
}

const kinds = (records: DnsMessage['answers']) => records.map((record) => `${record.type} ${record.name.join('.')}`);
const ptr = (name: string[]): DnsQuestion => ({ name, type: DNS_TYPES.PTR, unicastResponse: false });

describe('answerQuery', () => {
  test('answers a browse for IPP printers with the instance and adds SRV, TXT and the address', () => {
    const reply = answerQuery(query([ptr(['_ipp', '_tcp', 'local'])]), ZONE, false);
    expect(reply).toMatchObject({ id: 0, isResponse: true, questions: [] });
    expect(kinds(reply?.answers ?? [])).toEqual(['PTR _ipp._tcp.local']);
    expect(kinds(reply?.additionals ?? [])).toEqual([
      `SRV ${INSTANCE.join('.')}`,
      `TXT ${INSTANCE.join('.')}`,
      'A labelflash-1a2b3c4d.local',
    ]);
  });

  test('answers the driverless subtype and the host name', () => {
    const subtype = answerQuery(query([ptr(['_universal', '_sub', '_ipp', '_tcp', 'local'])]), ZONE, false);
    expect(subtype?.answers).toHaveLength(1);
    const host = answerQuery(
      query([{ name: ['LabelFlash-1A2B3C4D', 'local'], type: DNS_TYPES.ANY, unicastResponse: false }]),
      ZONE,
      false,
    );
    expect(host?.answers).toEqual([
      { type: 'A', name: ZONE.host, ttl: 120, cacheFlush: true, address: '192.168.1.10' },
    ]);
  });

  test('stays quiet about names it does not have and about responses', () => {
    expect(answerQuery(query([ptr(['_http', '_tcp', 'local'])]), ZONE, false)).toBeNull();
    expect(answerQuery({ ...query([ptr(['_ipp', '_tcp', 'local'])]), isResponse: true }, ZONE, false)).toBeNull();
  });

  test('skips a PTR the asker already knows and still holds for long', () => {
    const known = [{ type: 'PTR' as const, name: ['_ipp', '_tcp', 'local'], ttl: 4000, target: INSTANCE }];
    expect(answerQuery(query([ptr(['_ipp', '_tcp', 'local'])], known), ZONE, false)).toBeNull();
    const stale = [{ type: 'PTR' as const, name: ['_ipp', '_tcp', 'local'], ttl: 100, target: INSTANCE }];
    expect(answerQuery(query([ptr(['_ipp', '_tcp', 'local'])], stale), ZONE, false)).not.toBeNull();
  });

  test('answers a legacy unicast query like plain DNS', () => {
    const question = { name: INSTANCE, type: DNS_TYPES.SRV, unicastResponse: false };
    const reply = answerQuery(query([question]), ZONE, true);
    expect(reply).toMatchObject({ id: 77, questions: [question] });
    expect(reply?.answers[0]).toMatchObject({ type: 'SRV', ttl: 10, cacheFlush: false });
  });
});

describe('announcement, goodbye and probe', () => {
  test('announce every record and say goodbye with a zero TTL', () => {
    expect(announcement(ZONE).answers).toHaveLength(7);
    expect(goodbye(ZONE).answers.every((record) => record.ttl === 0)).toBe(true);
  });

  test('probe the unique names and propose their records', () => {
    const probe = probeQuery(ZONE);
    expect(probe.questions).toEqual([
      { name: INSTANCE, type: DNS_TYPES.ANY, unicastResponse: true },
      { name: ZONE.host, type: DNS_TYPES.ANY, unicastResponse: true },
    ]);
    expect(kinds(probe.authorities)).toEqual([`SRV ${INSTANCE.join('.')}`, 'A labelflash-1a2b3c4d.local']);
  });
});

describe('conflictingNames', () => {
  test('notices another device answering with our names and different data', () => {
    const theirs: DnsMessage = {
      ...announcement(ZONE),
      answers: [{ type: 'SRV', name: INSTANCE, ttl: 120, cacheFlush: true, port: 631, target: ['other', 'local'] }],
    };
    expect(conflictingNames(theirs, ZONE)).toEqual([INSTANCE]);
  });

  test('ignores the same data and other names', () => {
    expect(conflictingNames(announcement(ZONE), ZONE)).toEqual([]);
  });

  // 告别（TTL 0）不是在争这个名字：同一台电脑上一个刚关掉的实例会发出它。
  test('ignores goodbyes', () => {
    const theirs: DnsMessage = {
      ...announcement(ZONE),
      answers: [{ type: 'SRV', name: INSTANCE, ttl: 0, cacheFlush: true, port: 631, target: ['other', 'local'] }],
    };
    expect(conflictingNames(theirs, ZONE)).toEqual([]);
  });
});
