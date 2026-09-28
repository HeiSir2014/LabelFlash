/**
 * 「手机扫码」在电脑上的文字：标题栏按钮的状态点、浮层的各种状态、配置页的当前状态（纯函数，bun test 测试）。
 * 只说程序确知的事：二维码有效期按主进程给的时间算；打印结果在手机上显示，电脑这边只报数量。
 */
import { MAX_PHONES_PER_SESSION } from '../../../shared/mobile-protocol';
import type { MobileFailure, MobilePhone, MobileStatus } from '../../../shared/mobile-status';
import type { ConfigPage } from './app-view';

export type MobileTone = 'off' | 'pending' | 'active' | 'error';

export interface MobileButtonView {
  tone: MobileTone;
  /** 鼠标悬停和读屏读到的说明。 */
  title: string;
}

export interface MobilePhoneView {
  id: string;
  device: string;
  isOnline: boolean;
  detail: string;
}

export interface MobileOverlayView {
  tone: MobileTone;
  /** 一句话说明现在的状态；没什么要说时为 null。 */
  message: string | null;
  /** 要去配置中心处理时的直达链接。 */
  link: { page: ConfigPage; label: string } | null;
  /** 二维码里的私有链接；没有会话时为 null。 */
  url: string | null;
  /** 还没有手机加入时，二维码的剩余有效期（例如「9:58」）；有手机加入过或没有会话时为 null。 */
  countdown: string | null;
  phones: MobilePhoneView[];
  isJoinLocked: boolean;
  /** 排队和已打印的张数；没有会话时为 null。 */
  summary: string | null;
  /** start = 生成二维码；stop = 结束；regenerate = 换一个新二维码（旧的立即作废）。 */
  actions: { start: boolean; stop: boolean; regenerate: boolean };
}

export interface MobileContext {
  hasPrinter: boolean;
  now: number;
}

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_DIGITS = 2;
const UNKNOWN_DEVICE = '未知设备';
const RELAY_LINK = { page: 'mobile', label: '查看中转地址' } as const;

/** 失败时的说明；running = 会话还在（仍在自动重试），可以结束；否则会话已停，可以重新开始。 */
const FAILURES: Record<MobileFailure, { message: string; isRunning: boolean; link: MobileOverlayView['link'] }> = {
  'not-configured': {
    message: '还没有设置中转地址，手机扫码连不上。',
    isRunning: false,
    link: { page: 'mobile', label: '去填写中转地址' },
  },
  unreachable: {
    message: '连不上中转服务，正在自动重试。请检查网络：电脑要能直接访问中转地址（不支持系统代理）。',
    isRunning: true,
    link: RELAY_LINK,
  },
  'server-busy': { message: '中转服务繁忙，正在自动重试。', isRunning: true, link: null },
  version: { message: '中转服务不支持这个版本的软件，请更新软件后再试。', isRunning: false, link: null },
  'session-taken': {
    message: '中转服务拒绝了这次会话。请重新开始；反复出现时检查中转地址是否正确。',
    isRunning: false,
    link: RELAY_LINK,
  },
};

export function describeMobileButton(status: MobileStatus): MobileButtonView {
  switch (status.state) {
    case 'off':
      return { tone: 'off', title: '用手机扫码打印' };
    case 'connecting':
      return { tone: 'pending', title: '手机扫码：正在连接中转服务…' };
    case 'failed':
      return { tone: 'error', title: `手机扫码：${FAILURES[status.error].message}` };
    case 'active': {
      if (!status.relayOnline) {
        return { tone: 'pending', title: '手机扫码：和中转服务的连接断了，正在重连…' };
      }
      const online = status.phones.filter((phone) => phone.online).length;
      return { tone: 'active', title: `手机扫码进行中：${online} 部手机在线` };
    }
  }
}

/** 配置页「当前状态」的一句话。 */
export function describeMobileState(status: MobileStatus): string {
  switch (status.state) {
    case 'off':
      return '没有进行中的手机扫码。在工作台点标题栏的「手机扫码」开始。';
    case 'connecting':
      return '正在连接中转服务…';
    case 'failed':
      return FAILURES[status.error].message;
    case 'active': {
      if (!status.relayOnline) {
        return '进行中，和中转服务的连接断了，正在重连…';
      }
      const online = status.phones.filter((phone) => phone.online).length;
      return `进行中：${online} 部手机在线，本次已打印 ${status.printed} 张。`;
    }
  }
}

export function describeMobileOverlay(status: MobileStatus, context: MobileContext): MobileOverlayView {
  const idle: MobileOverlayView = {
    tone: 'off',
    message: null,
    link: null,
    url: null,
    countdown: null,
    phones: [],
    isJoinLocked: false,
    summary: null,
    actions: { start: false, stop: false, regenerate: false },
  };
  switch (status.state) {
    case 'off':
      return {
        ...idle,
        message: '生成二维码后，用手机相机或微信扫一扫，手机扫到的条码会在这台电脑上打印。',
        actions: { start: true, stop: false, regenerate: false },
      };
    case 'connecting':
      return {
        ...idle,
        tone: 'pending',
        message: '正在连接中转服务…',
        actions: { start: false, stop: true, regenerate: false },
      };
    case 'failed': {
      const failure = FAILURES[status.error];
      return {
        ...idle,
        tone: 'error',
        message: failure.message,
        link: failure.link,
        actions: { start: !failure.isRunning, stop: failure.isRunning, regenerate: false },
      };
    }
    case 'active':
      return {
        tone: status.relayOnline ? 'active' : 'pending',
        message: activeMessage(status, context),
        link: null,
        url: status.url,
        countdown: status.expiresAt === null ? null : formatCountdown(status.expiresAt - context.now),
        phones: status.phones.map(describePhone),
        isJoinLocked: status.joinLocked,
        summary: `排队中 ${status.queued} 张 · 本次已打印 ${status.printed} 张`,
        // 还没有手机加入时可以换一个新二维码（例如担心二维码被拍走）；有手机加入后换码会把它们都断开，不提供。
        actions: { start: false, stop: true, regenerate: status.expiresAt !== null },
      };
  }
}

/** 二维码下方的说明。 */
export const MOBILE_QR_CAPTION = `用手机相机或微信扫一扫，最多 ${MAX_PHONES_PER_SESSION} 部手机`;

/** 剩余时间写成「分:秒」；已过期写「0:00」。 */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(SECONDS_DIGITS, '0')}`;
}

function activeMessage(status: Extract<MobileStatus, { state: 'active' }>, context: MobileContext): string | null {
  if (!status.relayOnline) {
    return '和中转服务的连接断了，正在重连；手机上扫到的会先存在手机上。';
  }
  if (!context.hasPrinter) {
    return '电脑上还没选打印机：请在工作台右侧的「打印机」里选择，否则手机会提示「请先选择打印机」。';
  }
  if (status.expiresAt !== null && status.expiresAt <= context.now) {
    return '二维码已过期，点「换一个二维码」重新生成。';
  }
  return null;
}

function describePhone(phone: MobilePhone): MobilePhoneView {
  return {
    id: phone.id,
    device: phone.device || UNKNOWN_DEVICE,
    isOnline: phone.online,
    detail: `${phone.online ? '在线' : '离线'} · 已打印 ${phone.printed} 张`,
  };
}
