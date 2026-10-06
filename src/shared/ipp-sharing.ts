/** 局域网共享里主进程和界面共用的规则和类型。设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 8.1 节。 */
import type { FirewallStatus } from './local-api';

/** 默认端口 8631：macOS 的 631 是 CUPS 的（主进程依次试 8631–8640，界面上的说明也按它写）。 */
export const DEFAULT_IPP_PORT = 8631;

/** 共享密码 4–64 个字：短于 4 个字随手就能试出来；再长没有意义（明文 HTTP 上本来就能被抓包）。 */
export const SHARE_PASSWORD_LENGTH = { min: 4, max: 64 } as const;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 密码里不允许任何控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** 共享密码合不合规则（界面和主进程用同一条）。 */
export function isValidSharePassword(value: unknown): value is string {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) {
    return false;
  }
  const length = [...value].length;
  return length >= SHARE_PASSWORD_LENGTH.min && length <= SHARE_PASSWORD_LENGTH.max;
}

/** 共享服务的状态。 */
export type IppServerState =
  | { state: 'off' }
  /** 安装版上 Windows 防火墙还没放行：先不监听，等操作员点「添加防火墙规则」。 */
  | { state: 'held' }
  /** skippedPorts：想用却被占用、自动跳过的端口。 */
  | { state: 'listening'; port: number; skippedPorts: number[] }
  | { state: 'failed'; reason: 'PORT_IN_USE'; ports: number[] }
  /** 不是端口的问题：详情在日志里。 */
  | { state: 'failed'; reason: 'START_ERROR' };

/** 自动发现（mDNS）：on = 正在广播；off = 没开（共享没开，或开发版关掉了）；blocked = 防火墙没放行 UDP 5353；failed = 绑不上端口或名字冲突太多（稍后自动重试）。 */
export type DiscoveryState = 'off' | 'on' | 'blocked' | 'failed';

/** 一台共享打印机（一种纸）。 */
export interface SharedPrinterView {
  /** 纸张键，也是网址里的名字。 */
  key: string;
  /** 「60×40 标签」。 */
  name: string;
  /** 实际打到的本机打印机。 */
  printerName: string;
}

/** 正在等确认的一台电脑（程序顶部的询问条）。 */
export interface PendingClientView {
  address: string;
  user: string;
  printerName: string;
  jobs: number;
}

/** 记住的一台电脑（共享页里可以撤销）。 */
export interface RememberedClientView {
  address: string;
  decision: 'allow' | 'deny';
  lastUser: string;
  decidedAt: number;
}

/** 配置中心「局域网共享」页和顶部询问条要的全部状态（主进程在变化时推送）。 */
export interface IppSharingStatus {
  server: IppServerState;
  discovery: DiscoveryState;
  /** 本程序在 mDNS 里的主机名（labelflash-xxxx.local）；没在共享时为 null。 */
  hostName: string | null;
  /** 这台电脑的局域网地址：按地址添加时用。 */
  lanAddresses: string[];
  printers: SharedPrinterView[];
  /** 首选端口被占用时，占用它的程序名。 */
  portOwner: string | null;
  firewall: FirewallStatus;
  passwordSet: boolean;
  pendingClients: PendingClientView[];
  clients: RememberedClientView[];
  /** 收下还没结束的任务数。 */
  activeJobs: number;
}
