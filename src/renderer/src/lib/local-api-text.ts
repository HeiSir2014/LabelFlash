import type { ApiKeyInfo, LocalApiStatus } from '../../../shared/local-api';
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
      return {
        tone: 'success',
        title: '正在运行',
        addresses: hosts.map((host) => `http://${host}:${server.port}`),
        detail: server.lanEnabled
          ? '局域网里的程序要带程序密钥；传输是明文 HTTP，只在可信的局域网里使用。'
          : '只接受这台电脑上的网页和程序。',
      };
    }
    case 'failed': {
      const owner = status.portOwner === null ? '' : `（${status.portOwner}）`;
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
