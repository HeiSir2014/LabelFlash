/** 本机接口里主进程和界面共用的类型和规则。 */

/**
 * 新生成的密钥原文留这么久：主进程的内存里（给「复制」按钮）和界面上都只留这么久。
 * 够操作员复制到调用方的配置里，又不长期留着。
 */
export const FRESH_SECRET_MS = 10 * 60_000;

/** 程序密钥的名称上限：配置中心一行放得下（例如「ERP 服务器」「仓库面单机」）。 */
export const API_KEY_NAME_LENGTH = 40;

// biome-ignore lint/suspicious/noControlCharactersInRegex: 名称里不允许任何控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** 本机接口的 HTTP 服务状态。 */
export type ApiServerStatus =
  | { state: 'off' }
  /** skippedPorts：想用却被占用、自动跳过的端口（按尝试的顺序）；为空表示用上了首选的端口。 */
  | { state: 'listening'; port: number; lanEnabled: boolean; skippedPorts: number[] }
  | { state: 'failed'; reason: 'PORT_IN_USE'; ports: number[] }
  /** 不是端口的问题（例如网络组件出错）：详情在日志里。 */
  | { state: 'failed'; reason: 'START_ERROR' };

/** 配置中心「本机接口」页要显示的全部状态（主进程在变化时推送）。 */
export interface LocalApiStatus {
  server: ApiServerStatus;
  /** 这台电脑在局域网里的 IPv4 地址（局域网里的程序用它访问）。 */
  lanAddresses: string[];
  /** 首选的端口被占用时，占用它的程序名；查不到时为 null。 */
  portOwner: string | null;
  /** 已授权的网站：放在这里是因为授权发生在主进程（电脑上的授权框），界面要跟着刷新。 */
  authorizedOrigins: string[];
  /** 正在等操作员确认的网站（先来的在前）：程序顶部显示「允许 / 拒绝」。 */
  pendingOrigins: string[];
  /** Windows 防火墙让不让局域网连进来；只在局域网访问打开时查，其余为 unknown。 */
  firewall: FirewallStatus;
  /** 局域网访问打开了，但防火墙还没放行本程序，暂时只接受本机：加上防火墙规则后自动对局域网开放。 */
  lanHeldBack: boolean;
}

/**
 * Windows 防火墙让不让局域网连进来（见 src/shared/firewall-rule.ts 的查询脚本）：
 * allowed = 放行；missing = 没放行；unknown = 读不到或不是 Windows（不拦局域网，界面不显示这一项）。
 */
export const FIREWALL_STATES = ['allowed', 'missing', 'unknown'] as const;
export type FirewallStatus = (typeof FIREWALL_STATES)[number];

/** 一个程序密钥（不含密钥原文：原文只在生成时显示一次）。 */
export interface ApiKeyInfo {
  id: string;
  name: string;
  createdAt: number;
  /** 最后一次使用的时间（按分钟记）；没用过为 null。 */
  lastUsedAt: number | null;
}

/** 刚生成的密钥：secret 是原文，只在这一次返回。 */
export interface CreatedApiKey {
  key: ApiKeyInfo;
  secret: string;
}

/** 能按网站记住授权的来源：http 或 https 的网站（file:// 页面、沙盒 iframe 的 Origin 是 null）。 */
export function isWebOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
  } catch {
    return false;
  }
}

/** 密钥名称：去掉首尾空白后 1–40 个字、不含控制字符；不合格返回 null。 */
export function normalizeApiKeyName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = value.trim();
  return name.length > 0 && name.length <= API_KEY_NAME_LENGTH && !CONTROL_CHARACTERS.test(name) ? name : null;
}
