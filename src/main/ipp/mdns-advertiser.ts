import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import {
  type DnsMessage,
  type DnsName,
  decodeDnsMessage,
  encodeDnsMessage,
  nameText,
} from '../../core/mdns/dns-message';
import type { MdnsZone } from '../../core/mdns/dns-sd';
import { announcement, answerQuery, conflictingNames, goodbye, probeQuery } from '../../core/mdns/mdns-responder';
import { isLanClientAddress, isSameSubnet, type LanInterface } from '../api/network';

/** mDNS 的端口和 IPv4 组播地址（RFC 6762 §3）。 */
export const MDNS_PORT = 5353;
export const MDNS_GROUP = '224.0.0.251';
/** RFC 6762 §8.1：探测 3 次、每次隔 250ms；§8.3：宣告 2 次、隔 1 秒。 */
const PROBE_COUNT = 3;
const PROBE_INTERVAL_MS = 250;
const ANNOUNCE_COUNT = 2;
const ANNOUNCE_INTERVAL_MS = 1_000;
/** 组播的 TTL 必须是 255（RFC 6762 §11）。 */
const MULTICAST_TTL = 255;
/** 默认绑所有 IPv4 网卡：每块局域网网卡都要收到查询。 */
const ALL_IPV4 = '0.0.0.0';

/** 宣告、组播回答发到哪里。 */
export interface MdnsDestination {
  address: string;
  port: number;
}

/** MdnsAdvertiser 的依赖。 */
export interface MdnsAdvertiserDeps {
  interfaces: () => LanInterface[];
  /** 一块网卡上要回答的区域（用那块网卡的地址）。 */
  zoneFor: (iface: LanInterface) => MdnsZone;
  /** 别的设备在用我们的名字：IppSharing 换个名字重新广播。 */
  onConflict: (names: DnsName[]) => void;
  /** 绑定的端口；测试里用 0（系统随便给），默认 5353。 */
  bindPort?: number | undefined;
  /** 绑定的地址；测试里用 127.0.0.1，默认 0.0.0.0。 */
  bindAddress?: string | undefined;
  /** 宣告和组播回答的目的地；测试里换成本机回环上的收包口（这时不加入组播组），默认 224.0.0.251:5353。 */
  destination?: MdnsDestination | undefined;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

function bind(socket: Socket, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once('error', onError);
    socket.bind(port, address, () => {
      socket.off('error', onError);
      resolve();
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * mDNS 的收发（node:dgram）。报文的内容都由 core 的 mdns-responder 决定，这里只管套接字、网卡和时机。
 * 绑定 0.0.0.0:5353 时带 reuseAddr：Windows 的 DNS 客户端服务、macOS 的 mDNSResponder 都占着这个端口，大家共用。
 * 只回答局域网地址发来的查询，只回答本程序自己的记录。
 */
export class MdnsAdvertiser {
  private socket: Socket | null = null;
  private interfaces: LanInterface[] = [];
  /** 最近一次宣告的区域（按网卡地址）：告别时要用当时宣告的内容，不是改过之后的。 */
  private readonly announced = new Map<string, MdnsZone>();
  private isProbing = false;
  /** 每次启动、刷新加一：上一轮还没宣告完就又刷新了，旧的那一轮停下。 */
  private round = 0;

  constructor(private readonly deps: MdnsAdvertiserDeps) {}

  private get isMulticast(): boolean {
    return this.deps.destination === undefined;
  }

  private get destination(): MdnsDestination {
    return this.deps.destination ?? { address: MDNS_GROUP, port: MDNS_PORT };
  }

  /** 绑定并开始探测、宣告（在后台进行）。端口绑不上返回 false：共享照常，只是不能自动发现。 */
  async start(): Promise<boolean> {
    await this.stop();
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    try {
      await bind(socket, this.deps.bindPort ?? MDNS_PORT, this.deps.bindAddress ?? ALL_IPV4);
    } catch (error) {
      socket.close();
      this.deps.log(`[ipp] mDNS could not bind: ${describe(error)}`);
      return false;
    }
    this.socket = socket;
    socket.on('error', (error) => this.deps.log(`[ipp] mDNS socket error: ${describe(error)}`));
    socket.on('message', (bytes, remote) => this.receive(bytes, remote));
    this.interfaces = this.deps.interfaces();
    if (this.isMulticast) {
      try {
        socket.setMulticastTTL(MULTICAST_TTL);
        socket.setMulticastLoopback(true);
      } catch (error) {
        this.deps.log(`[ipp] mDNS multicast options failed: ${describe(error)}`);
      }
      for (const iface of this.interfaces) {
        try {
          socket.addMembership(MDNS_GROUP, iface.address);
        } catch (error) {
          this.deps.log(`[ipp] mDNS cannot join the group on ${iface.name} ${iface.address}: ${describe(error)}`);
        }
      }
    }
    void this.probeAndAnnounce();
    return true;
  }

  /** 服务变了（纸张分配、端口、名字、密码）：告别旧的，再探测、宣告新的。 */
  async refresh(): Promise<void> {
    if (this.socket === null) {
      return;
    }
    await this.sendGoodbyes();
    await this.probeAndAnnounce();
  }

  /** 告别（TTL 0）后关掉套接字。 */
  async stop(): Promise<void> {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    this.round += 1;
    await this.sendGoodbyes();
    this.socket = null;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  /** 实际绑定的端口（测试用）。 */
  boundPort(): number | null {
    return this.socket === null ? null : this.socket.address().port;
  }

  private async probeAndAnnounce(): Promise<void> {
    this.round += 1;
    const round = this.round;
    this.isProbing = true;
    for (let index = 0; index < PROBE_COUNT; index += 1) {
      await this.multicastEach((zone) => probeQuery(zone), false);
      await this.deps.sleep(PROBE_INTERVAL_MS);
      if (round !== this.round) {
        return;
      }
    }
    this.isProbing = false;
    for (let index = 0; index < ANNOUNCE_COUNT; index += 1) {
      await this.multicastEach((zone) => announcement(zone), true);
      if (index + 1 < ANNOUNCE_COUNT) {
        await this.deps.sleep(ANNOUNCE_INTERVAL_MS);
        if (round !== this.round) {
          return;
        }
      }
    }
  }

  private async multicastEach(build: (zone: MdnsZone) => DnsMessage, remember: boolean): Promise<void> {
    for (const iface of this.interfaces) {
      const zone = this.deps.zoneFor(iface);
      if (remember) {
        this.announced.set(iface.address, zone);
      }
      await this.multicast(iface, build(zone));
    }
  }

  private multicast(iface: LanInterface, message: DnsMessage): Promise<void> {
    const socket = this.socket;
    if (socket === null) {
      return Promise.resolve();
    }
    const { address, port } = this.destination;
    return new Promise((resolve) => {
      try {
        if (this.isMulticast) {
          // 从这块网卡发出去：多网卡的电脑上，默认网卡不一定是对方所在的那块。
          socket.setMulticastInterface(iface.address);
        }
        socket.send(encodeDnsMessage(message), port, address, (error) => {
          if (error) {
            this.deps.log(`[ipp] mDNS send on ${iface.address} failed: ${describe(error)}`);
          }
          resolve();
        });
      } catch (error) {
        this.deps.log(`[ipp] mDNS send on ${iface.address} failed: ${describe(error)}`);
        resolve();
      }
    });
  }

  private async sendGoodbyes(): Promise<void> {
    for (const iface of this.interfaces) {
      const zone = this.announced.get(iface.address);
      if (zone !== undefined) {
        await this.multicast(iface, goodbye(zone));
      }
    }
    this.announced.clear();
  }

  private receive(bytes: Buffer, remote: RemoteInfo): void {
    // 只理局域网里的设备：不给别处来的包当放大器。自己发出又回环收到的也不理。
    if (!isLanClientAddress(remote.address)) {
      return;
    }
    const ownPort = this.boundPort();
    if (remote.port === ownPort && this.interfaces.some((iface) => iface.address === remote.address)) {
      return;
    }
    const message = decodeDnsMessage(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (message === null) {
      return;
    }
    const iface =
      this.interfaces.find((item) => isSameSubnet(item.address, remote.address, item.netmask)) ?? this.interfaces[0];
    if (iface === undefined) {
      return;
    }
    const zone = this.deps.zoneFor(iface);
    // 别人的回答、或者探测时别人也在探测同样的名字：看有没有冲突。
    if (message.isResponse || (this.isProbing && message.authorities.length > 0)) {
      const names = conflictingNames(message, zone);
      if (names.length > 0) {
        this.deps.log(`[ipp] mDNS name conflict: ${names.map(nameText).join(', ')}`);
        this.deps.onConflict(names);
      }
      if (message.isResponse) {
        return;
      }
    }
    const isLegacy = remote.port !== MDNS_PORT;
    const reply = answerQuery(message, zone, isLegacy);
    if (reply === null) {
      return;
    }
    if (isLegacy || message.questions.some((question) => question.unicastResponse)) {
      this.socket?.send(encodeDnsMessage(reply), remote.port, remote.address);
    } else {
      void this.multicast(iface, reply);
    }
  }
}
