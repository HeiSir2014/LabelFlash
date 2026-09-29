import type { ApiKeyInfo, FirewallStatus, LocalApiStatus } from '../../../shared/local-api';
import { formatDateTime, type StatusTone } from './status-text';

export interface ApiStatusView {
  tone: StatusTone;
  title: string;
  /** 调用方可以用的地址：本机的，局域网开着时再加上这台电脑的局域网地址。 */
  addresses: string[];
  detail: string;
}

/** 配置中心「本机接口」页顶部的状态。 */
export function describeApiStatus(status: LocalApiStatus): ApiStatusView {
  const { server } = status;
  switch (server.state) {
    case 'off':
      return { tone: 'idle', title: '没有运行', addresses: [], detail: '程序启动后自动开启。' };
    case 'listening': {
      const hosts = ['127.0.0.1', ...(server.lanEnabled ? status.lanAddresses : [])];
      const scope = server.lanEnabled
        ? '局域网里的程序要带程序密钥；传输是明文 HTTP，只在可信的局域网里使用。'
        : '只接受这台电脑上的网页和程序。';
      const moved = server.skippedPorts.length > 0;
      return {
        tone: moved ? 'warning' : 'success',
        title: moved ? '正在运行（已自动换端口）' : '正在运行',
        addresses: hosts.map((host) => `http://${host}:${server.port}`),
        detail: moved
          ? `端口 ${server.skippedPorts.join('、')} 被别的程序${ownerText(status.portOwner)}占用，已自动改用 ${server.port}。已经配好旧端口的程序要改成新端口。${scope}`
          : scope,
      };
    }
    case 'failed': {
      const owner = ownerText(status.portOwner);
      const ports = server.ports.join('、');
      const subject = server.ports.length > 1 ? `端口 ${ports} 都` : `端口 ${ports} `;
      return {
        tone: 'error',
        title: '端口被占用',
        addresses: [],
        detail: `${subject}被别的程序${owner}占用了：可以在下面换一个端口。`,
      };
    }
  }
}

function ownerText(owner: string | null): string {
  return owner === null ? '' : `（${owner}）`;
}

const KEY_PREFIX = 'key:';
const ORIGIN_PREFIX = 'origin:';

/** 打印记录里的调用方显示成什么：密钥的名称，或网站；不是本机接口的记录为 null。 */
export function describeCaller(caller: string | undefined, keys: readonly ApiKeyInfo[]): string | null {
  if (caller === undefined) {
    return null;
  }
  if (caller.startsWith(KEY_PREFIX)) {
    const id = caller.slice(KEY_PREFIX.length);
    return keys.find((key) => key.id === id)?.name ?? '已撤销的密钥';
  }
  return caller.startsWith(ORIGIN_PREFIX) ? caller.slice(ORIGIN_PREFIX.length) : caller;
}

export function describeKeyUsage(key: ApiKeyInfo): string {
  return key.lastUsedAt === null ? '还没有用过' : `最后使用：${formatDateTime(key.lastUsedAt)}`;
}

/** 防火墙一行的说明；查不到（或不是 Windows）时不显示这一行。 */
export function describeFirewall(status: FirewallStatus): { text: string; canAdd: boolean } | null {
  switch (status) {
    case 'allowed':
      return { text: '已放行本程序（专用网络和域网络）。', canAdd: false };
    case 'missing':
      return { text: 'Windows 防火墙还没有放行本程序，局域网里的电脑可能连不上。', canAdd: true };
    case 'unknown':
      return null;
  }
}
