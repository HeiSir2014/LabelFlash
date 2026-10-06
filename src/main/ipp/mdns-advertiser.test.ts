import { afterEach, describe, expect, test } from 'bun:test';
import { createSocket, type Socket } from 'node:dgram';
import {
  DNS_TYPES,
  type DnsMessage,
  type DnsName,
  decodeDnsMessage,
  encodeDnsMessage,
} from '../../core/mdns/dns-message';
import type { MdnsZone } from '../../core/mdns/dns-sd';
import type { LanInterface } from '../api/network';
import { MdnsAdvertiser } from './mdns-advertiser';

const LOOPBACK: LanInterface = { name: 'lo', address: '127.0.0.1', netmask: '255.0.0.0' };
const INSTANCE = ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'];
/** 等回答最多 1 秒：本机回环上几毫秒就到。 */
const REPLY_TIMEOUT_MS = 1_000;

const zoneFor = (iface: LanInterface): MdnsZone => ({
  host: ['labelflash-1a2b3c4d', 'local'],
  address: iface.address,
  services: [
    {
      instance: INSTANCE[0] ?? '',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal'],
      port: 8631,
      txt: [['rp', 'printers/60x40']],
    },
  ],
});

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function clientSocket(): Socket {
  const socket = createSocket('udp4');
  cleanups.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
  return socket;
}

/** 本机回环上的一个收包口：代替组播地址，收广告器发出的宣告（测试不往局域网发组播）。 */
async function sink(): Promise<{ port: number; received: DnsMessage[] }> {
  const socket = clientSocket();
  const received: DnsMessage[] = [];
  socket.on('message', (bytes) => {
    const message = decodeDnsMessage(bytes);
    if (message !== null) {
      received.push(message);
    }
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  return { port: socket.address().port, received };
}

async function startAdvertiser() {
  const conflicts: DnsName[] = [];
  const announced = await sink();
  const advertiser = new MdnsAdvertiser({
    interfaces: () => [LOOPBACK],
    zoneFor,
    onConflict: (names) => conflicts.push(...names),
    bindPort: 0,
    bindAddress: '127.0.0.1',
    destination: { address: '127.0.0.1', port: announced.port },
    sleep: async () => undefined,
    log: () => undefined,
  });
  expect(await advertiser.start()).toBe(true);
  cleanups.push(() => advertiser.stop());
  const port = advertiser.boundPort();
  if (port === null) {
    throw new Error('not bound');
  }
  return { advertiser, port, conflicts, announced };
}

/** 从一个普通端口发查询（传统单播），等第一条回答。 */
function ask(port: number, message: DnsMessage): Promise<DnsMessage | null> {
  const socket = clientSocket();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
    socket.on('message', (bytes) => {
      clearTimeout(timer);
      resolve(decodeDnsMessage(bytes));
    });
    socket.send(encodeDnsMessage(message), port, '127.0.0.1');
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const query = (name: DnsName, type: number): DnsMessage => ({
  id: 9,
  isResponse: false,
  questions: [{ name, type, unicastResponse: false }],
  answers: [],
  authorities: [],
  additionals: [],
});

describe('MdnsAdvertiser', () => {
  test('probes, then announces every record', async () => {
    const { announced } = await startAdvertiser();
    await waitUntil(() => announced.received.filter((message) => message.isResponse).length >= 2);
    expect(announced.received.filter((message) => !message.isResponse)).toHaveLength(3);
    expect(announced.received.filter((message) => message.isResponse)[0]?.answers).toHaveLength(6);
  });

  test('answers a legacy unicast query for shared printers', async () => {
    const { port } = await startAdvertiser();
    const reply = await ask(port, query(['_ipp', '_tcp', 'local'], DNS_TYPES.PTR));
    expect(reply).toMatchObject({ id: 9, isResponse: true });
    expect(reply?.answers[0]).toMatchObject({ type: 'PTR', target: INSTANCE, ttl: 10 });
    expect(reply?.additionals.find((record) => record.type === 'A')).toMatchObject({ address: '127.0.0.1' });
  });

  test('stays quiet about services it does not have', async () => {
    const { port } = await startAdvertiser();
    expect(await ask(port, query(['_http', '_tcp', 'local'], DNS_TYPES.PTR))).toBeNull();
  });

  test('reports another device answering with its name', async () => {
    const { port, conflicts } = await startAdvertiser();
    const theirs: DnsMessage = {
      id: 0,
      isResponse: true,
      questions: [],
      answers: [{ type: 'SRV', name: INSTANCE, ttl: 120, cacheFlush: true, port: 631, target: ['other', 'local'] }],
      authorities: [],
      additionals: [],
    };
    clientSocket().send(encodeDnsMessage(theirs), port, '127.0.0.1');
    await waitUntil(() => conflicts.length > 0);
    expect(conflicts).toEqual([INSTANCE]);
  });

  test('says goodbye with a zero TTL when it stops', async () => {
    const { advertiser, announced } = await startAdvertiser();
    await waitUntil(() => announced.received.filter((message) => message.isResponse).length >= 2);
    await advertiser.stop();
    await waitUntil(() => announced.received.some((message) => message.answers.some((record) => record.ttl === 0)));
    expect(announced.received.at(-1)?.answers.every((record) => record.ttl === 0)).toBe(true);
  });
});
