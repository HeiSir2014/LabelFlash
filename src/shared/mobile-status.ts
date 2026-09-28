/** 电脑上「手机扫码」的状态：主进程推给界面显示（阶段 5 经 IPC 传递）。 */
export type MobileStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | {
      state: 'active';
      /** 二维码里的私有链接。 */
      url: string;
      /** 还没有手机打开时，二维码的失效时间；已有手机时为 null。 */
      expiresAt: number | null;
      /** 和中转服务的连接是否正常。 */
      relayOnline: boolean;
      phone: { device: string; online: boolean } | null;
      /** 本次会话已打印的张数。 */
      printed: number;
    }
  | { state: 'failed'; error: MobileFailure };

/**
 * not-configured = 没有中转地址；unreachable = 连不上中转服务（仍在自动重试）；
 * version = 中转服务不支持这个版本的协议；server-busy = 中转服务满了（仍在自动重试）。
 */
export type MobileFailure = 'not-configured' | 'unreachable' | 'version' | 'server-busy';
