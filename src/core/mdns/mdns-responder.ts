import {
  DNS_TYPES,
  type DnsMessage,
  type DnsName,
  type DnsQuestion,
  type DnsRecord,
  sameName,
  typeCode,
} from './dns-message';
import { instanceName, type MdnsZone, zoneRecords } from './dns-sd';

/** 传统单播查询（源端口不是 5353）的回答 TTL 上限（RFC 6762 §6.7）。 */
const LEGACY_UNICAST_TTL_SECONDS = 10;
/** 对方已知的回答剩余 TTL 不少于我们的一半，才省掉这一条（RFC 6762 §7.1）。 */
const KNOWN_ANSWER_TTL_FRACTION = 0.5;

/*
 * mDNS 应答器的纯逻辑：只回答这一个区域（本程序自己的主机名和共享打印机）里的记录，
 * 别人的名字一律不答——不替局域网里的其他设备说话。
 */

function matches(question: DnsQuestion, record: DnsRecord): boolean {
  return (
    sameName(question.name, record.name) && (question.type === DNS_TYPES.ANY || question.type === typeCode(record))
  );
}

function isKnown(known: readonly DnsRecord[], record: DnsRecord): boolean {
  return (
    record.type === 'PTR' &&
    known.some(
      (item) =>
        item.type === 'PTR' &&
        sameName(item.name, record.name) &&
        sameName(item.target, record.target) &&
        item.ttl >= record.ttl * KNOWN_ANSWER_TTL_FRACTION,
    )
  );
}

/** 附加记录（RFC 6763 §12）：答了实例的 PTR 就附上它的 SRV、TXT；有 SRV 就附上主机地址。 */
function additionalsFor(answers: readonly DnsRecord[], records: readonly DnsRecord[]): DnsRecord[] {
  const extra: DnsRecord[] = [];
  const add = (record: DnsRecord) => {
    if (!answers.includes(record) && !extra.includes(record)) {
      extra.push(record);
    }
  };
  for (const answer of answers) {
    if (answer.type !== 'PTR') {
      continue;
    }
    for (const record of records) {
      if ((record.type === 'SRV' || record.type === 'TXT') && sameName(record.name, answer.target)) {
        add(record);
      }
    }
  }
  if ([...answers, ...extra].some((record) => record.type === 'SRV')) {
    for (const record of records) {
      if (record.type === 'A') {
        add(record);
      }
    }
  }
  return extra;
}

function legacyRecord(record: DnsRecord): DnsRecord {
  const ttl = Math.min(record.ttl, LEGACY_UNICAST_TTL_SECONDS);
  return 'cacheFlush' in record ? { ...record, ttl, cacheFlush: false } : { ...record, ttl };
}

/**
 * 回答一条查询；没有要答的返回 null。legacy：对方不是 mDNS 响应器（源端口不是 5353），
 * 按普通 DNS 单播回答：带上问题和编号，TTL 不超过 10 秒，不带缓存刷新位。
 */
export function answerQuery(query: DnsMessage, zone: MdnsZone, legacy: boolean): DnsMessage | null {
  if (query.isResponse) {
    return null;
  }
  const records = zoneRecords(zone);
  const answers: DnsRecord[] = [];
  for (const question of query.questions) {
    for (const record of records) {
      if (matches(question, record) && !answers.includes(record) && !isKnown(query.answers, record)) {
        answers.push(record);
      }
    }
  }
  if (answers.length === 0) {
    return null;
  }
  const additionals = additionalsFor(answers, records);
  const shape = (record: DnsRecord): DnsRecord => (legacy ? legacyRecord(record) : record);
  return {
    id: legacy ? query.id : 0,
    isResponse: true,
    questions: legacy ? query.questions : [],
    answers: answers.map(shape),
    authorities: [],
    additionals: additionals.map(shape),
  };
}

/** 宣告（RFC 6762 §8.3）：把全部记录主动发出去。 */
export function announcement(zone: MdnsZone): DnsMessage {
  return { id: 0, isResponse: true, questions: [], answers: zoneRecords(zone), authorities: [], additionals: [] };
}

/** 告别（RFC 6762 §10.1）：同样的记录，TTL 0，别的设备马上把它们从缓存里删掉。 */
export function goodbye(zone: MdnsZone): DnsMessage {
  return { ...announcement(zone), answers: zoneRecords(zone).map((record) => ({ ...record, ttl: 0 })) };
}

/** 只属于这台电脑的名字：每个实例名和主机名。 */
function uniqueNames(zone: MdnsZone): DnsName[] {
  return [...zone.services.map(instanceName), zone.host];
}

/** 探测（RFC 6762 §8.1）：问一问这些名字有没有人用，权威部分写上我们打算用的 SRV 和 A。 */
export function probeQuery(zone: MdnsZone): DnsMessage {
  const records = zoneRecords(zone);
  return {
    id: 0,
    isResponse: false,
    questions: uniqueNames(zone).map((name) => ({ name, type: DNS_TYPES.ANY, unicastResponse: true })),
    answers: [],
    authorities: records.filter((record) => record.type === 'SRV' || record.type === 'A'),
    additionals: [],
  };
}

function sameData(a: DnsRecord, b: DnsRecord): boolean {
  if (a.type === 'SRV' && b.type === 'SRV') {
    return a.port === b.port && sameName(a.target, b.target);
  }
  if (a.type === 'A' && b.type === 'A') {
    return a.address === b.address;
  }
  return false;
}

/**
 * 别的设备（调用方已经排除了自己发的包）用我们的实例名或主机名回答、探测，而且内容不同：这些名字冲突了。
 * TTL 为 0 的告别不算：那是在放弃这个名字。
 */
export function conflictingNames(message: DnsMessage, zone: MdnsZone): DnsName[] {
  const ours = zoneRecords(zone).filter((record) => record.type === 'SRV' || record.type === 'A');
  const theirs = [...message.answers, ...message.authorities, ...message.additionals].filter(
    (record) => (record.type === 'SRV' || record.type === 'A') && record.ttl > 0,
  );
  const names: DnsName[] = [];
  for (const record of ours) {
    const clashes = theirs.some((other) => sameName(other.name, record.name) && !sameData(other, record));
    if (clashes && !names.some((name) => sameName(name, record.name))) {
      names.push(record.name);
    }
  }
  return names;
}
