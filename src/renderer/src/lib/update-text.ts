import type { UpdateStatus } from '../../../shared/update-status';

export interface UpdateView {
  /** 「关于」里显示的状态文字。 */
  text: string;
  /** 是否允许点「检查更新」。 */
  canCheck: boolean;
  /** 新版本已下载，标题栏显示「重启更新」。 */
  isReady: boolean;
}

export function describeUpdate(status: UpdateStatus): UpdateView {
  switch (status.state) {
    case 'disabled':
      return {
        text:
          status.reason === 'development' ? '开发版不检查更新' : '这个平台暂不支持自动更新，新版本请到发布页下载安装',
        canCheck: false,
        isReady: false,
      };
    case 'idle':
      return { text: '尚未检查更新', canCheck: true, isReady: false };
    case 'checking':
      return { text: '正在检查更新…', canCheck: false, isReady: false };
    case 'up-to-date':
      return {
        text: `已是最新版本（${new Date(status.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })} 检查）`,
        canCheck: true,
        isReady: false,
      };
    case 'downloading':
      return { text: `正在下载新版本 ${status.version}（${status.percent}%）`, canCheck: false, isReady: false };
    case 'ready':
      return { text: `新版本 ${status.version} 已下载，重启后生效`, canCheck: false, isReady: true };
    case 'error':
      return { text: '检查更新失败，详情见日志；稍后会自动重试', canCheck: true, isReady: false };
  }
}
