/** 电脑上「手机扫码」的状态：主进程推给界面显示（阶段 5 经 IPC 传递）。 */
export type MobileStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | {
      state: 'active';
      /** 二维码里的私有链接，几部手机共用。 */
      url: string;
      /** 还没有手机加入时，二维码的失效时间；有手机加入过之后为 null。 */
      expiresAt: number | null;
      /** 和中转服务的连接是否正常。 */
      relayOnline: boolean;
      /** 是否暂停了新手机加入（移除手机后自动暂停，可以在电脑上重新允许）。 */
      joinLocked: boolean;
      /** 加入过的手机，按加入顺序。 */
      phones: MobilePhone[];
      /** 本次会话已打印的张数。 */
      printed: number;
      /** 排队中和正在打印的任务数。 */
      queued: number;
    }
  | { state: 'failed'; error: MobileFailure };

export interface MobilePhone {
  /** 用来在电脑上移除这部手机；不是令牌。 */
  id: string;
  /** 例如「iPhone · 微信」。 */
  device: string;
  online: boolean;
  printed: number;
}

/**
 * - not-configured：没有中转地址；
 * - unreachable：连不上中转服务（仍在自动重试）；
 * - server-busy：中转服务满了（仍在自动重试）；
 * - version：中转服务不支持这个版本的协议，会话已结束，要更新软件；
 * - session-taken：中转服务连续拒绝了新会话，会话已结束，要检查中转地址是否指向正确的服务。
 */
export type MobileFailure = 'not-configured' | 'unreachable' | 'server-busy' | 'version' | 'session-taken';
