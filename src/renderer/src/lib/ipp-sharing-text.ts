import type { IppSharingStatus, PendingClientView, RememberedClientView } from '../../../shared/ipp-sharing';
import { formatDateTime, type StatusTone } from './status-text';

/** 0 是「由系统分配」，不是一个被占用的端口。 */
const ANY_FREE_PORT = 0;
/** 明文传输的提醒：只说确知的事。 */
const PLAIN_HTTP_NOTE = '传输是明文 HTTP，只在可信的局域网里使用。';

/** 共享页顶部的状态：颜色、标题、说明。 */
export interface SharingStatusView {
  tone: StatusTone;
  title: string;
  detail: string;
}

function ownerText(owner: string | null): string {
  return owner === null ? '' : `（${owner}）`;
}

/** 「局域网共享」页顶部的状态。 */
export function describeSharingStatus(status: IppSharingStatus, enabled: boolean): SharingStatusView {
  if (!enabled) {
    return {
      tone: 'idle',
      title: '没有开',
      detail: '打开后，局域网里的电脑可以把这台电脑上的热敏标签机添加为打印机，从任何程序打印（PDF、图片、Word……）。',
    };
  }
  const { server } = status;
  switch (server.state) {
    case 'off':
      return { tone: 'pending', title: '正在启动…', detail: '' };
    case 'held':
      return {
        tone: 'warning',
        title: '等防火墙放行',
        detail: 'Windows 防火墙还没有放行本程序：点下面的「添加防火墙规则」（需要管理员确认）后开始共享。',
      };
    case 'listening': {
      if (status.printers.length === 0) {
        return {
          tone: 'warning',
          title: '没有可共享的纸张',
          detail: '先在「打印机」页给纸张分配打印机：每种分配了打印机的纸张就是一台共享打印机。',
        };
      }
      if (server.skippedPorts.length > 0) {
        return {
          tone: 'warning',
          title: '正在共享（已自动换端口）',
          detail: `端口 ${server.skippedPorts.join('、')} 被别的程序${ownerText(status.portOwner)}占用，已改用 ${server.port}。按旧地址添加过的电脑要重新添加。${PLAIN_HTTP_NOTE}`,
        };
      }
      return { tone: 'success', title: '正在共享', detail: `局域网里的电脑可以添加下面的打印机。${PLAIN_HTTP_NOTE}` };
    }
    case 'failed': {
      if (server.reason === 'START_ERROR') {
        return {
          tone: 'error',
          title: '没有运行',
          detail: '共享启动出错，详情已写入日志（配置中心「通用」页可以打开日志文件夹）。',
        };
      }
      const taken = server.ports.filter((port) => port !== ANY_FREE_PORT);
      return {
        tone: 'error',
        title: '端口被占用',
        detail: `端口 ${taken.join('、')} 被别的程序${ownerText(status.portOwner)}占用了：可以在下面换一个端口，或重启电脑后再试。`,
      };
    }
  }
}

/** 共享（TCP）或自动发现（UDP 5353）有一样还没被防火墙放行：显示「添加防火墙规则」。 */
export function needsSharingFirewall(status: IppSharingStatus): boolean {
  return status.server.state === 'held' || status.discovery === 'blocked' || status.firewall === 'missing';
}

/** 一台共享打印机的地址：Windows「按名称选择共享打印机」要 http://，其他系统、手动填写用 ipp://。没在共享时为空。 */
export function printerAddresses(status: IppSharingStatus, key: string): { windows: string[]; ipp: string[] } {
  if (status.server.state !== 'listening') {
    return { windows: [], ipp: [] };
  }
  const { port } = status.server;
  return {
    windows: status.lanAddresses.map((address) => `http://${address}:${port}/printers/${key}`),
    ipp: status.lanAddresses.map((address) => `ipp://${address}:${port}/printers/${key}`),
  };
}

/** 自动发现（mDNS）的说明；没在共享时为 null。 */
export function describeDiscovery(status: IppSharingStatus): string | null {
  if (status.server.state !== 'listening') {
    return null;
  }
  switch (status.discovery) {
    case 'on':
      return '已在局域网里广播：macOS、iOS 和较新的 Windows 能自动发现这些打印机。';
    case 'off':
      return '没有广播：别的电脑只能按地址添加。';
    case 'blocked':
      return 'Windows 防火墙还没放行自动发现（UDP 5353）：点「添加防火墙规则」后别的电脑才能自动找到；按地址添加不受影响。';
    case 'failed':
      return '自动发现暂时没能开启（端口 5353 被占用，或局域网里重名太多），稍后自动重试：按地址添加不受影响，详情见日志。';
  }
}

/** 询问条上的说明（电脑地址另起一行用等宽字体显示）。 */
export function describeClientRequest(client: PendingClientView): string {
  const who = client.user === '' ? '' : `用户 ${client.user} `;
  const waiting = client.jobs > 1 ? `（${client.jobs} 个任务在等）` : '';
  return `${who}要打印到「${client.printerName}」${waiting}。不认识这台电脑就点「拒绝」。`;
}

/** 共享页里记住的一台电脑。 */
export function describeRememberedClient(client: RememberedClientView): string {
  const decision = client.decision === 'allow' ? '已允许' : '已拒绝';
  const user = client.lastUser === '' ? '' : `，用户 ${client.lastUser}`;
  return `${decision}${user}，${formatDateTime(client.decidedAt)}`;
}
