import { isValidSecretName } from '../scan/enrich-model';

/** 可以订阅的打印结果；test 只由「发送测试」产生，不能订阅。 */
export const WEBHOOK_EVENTS = ['printed', 'failed', 'duplicate', 'invalid'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookEventType = WebhookEvent | 'test';

export const DEFAULT_WEBHOOK_EVENTS: readonly WebhookEvent[] = ['printed', 'failed'];

/** 一个通知接口（本机设置，不随规则导出）。 */
export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  /** 签名用的密钥名称（存在密钥表里）；null = 不签名。 */
  secretName: string | null;
  events: WebhookEvent[];
  enabled: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const WEBHOOK_LIMITS = {
  endpoints: 5,
  nameLength: 30,
  urlLength: 1_000,
  /** 单次请求超时。 */
  timeoutMs: 5_000,
  /** 第 n 次失败后隔多久重试。 */
  retryDelaysMs: [MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * HOUR_MS, 12 * HOUR_MS],
  /** 从产生通知算起，超过这么久仍未成功就放弃。 */
  giveUpAfterMs: 24 * HOUR_MS,
  /** 保留的发送记录（已完成的）条数。 */
  keptDeliveries: 1_000,
  /** 接收方应拒绝时间戳相差超过这么久的请求（写进说明，发送方不用）。 */
  replayWindowMs: 5 * MINUTE_MS,
} as const;

export const WEBHOOK_ID_PATTERN = /^[\w-]{1,64}$/;

/** 设置里的通知接口：不合法的项直接丢掉（和其他设置一样宽松读取，界面保存时逐项校验）。 */
export function sanitizeWebhooks(value: unknown): WebhookEndpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const endpoints: WebhookEndpoint[] = [];
  for (const item of value) {
    const endpoint = sanitizeEndpoint(item);
    if (endpoint && !seen.has(endpoint.id)) {
      seen.add(endpoint.id);
      endpoints.push(endpoint);
    }
    if (endpoints.length === WEBHOOK_LIMITS.endpoints) {
      break;
    }
  }
  return endpoints;
}

function sanitizeEndpoint(value: unknown): WebhookEndpoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, name, url, secretName, events, enabled } = value as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    !WEBHOOK_ID_PATTERN.test(id) ||
    typeof name !== 'string' ||
    name.trim() === '' ||
    name.length > WEBHOOK_LIMITS.nameLength ||
    typeof url !== 'string' ||
    !isWebhookUrl(url) ||
    !(secretName === null || (typeof secretName === 'string' && isValidSecretName(secretName))) ||
    !Array.isArray(events) ||
    typeof enabled !== 'boolean'
  ) {
    return null;
  }
  const known = WEBHOOK_EVENTS.filter((event) => events.includes(event));
  return { id, name: name.trim(), url, secretName, events: known, enabled };
}

export function isWebhookUrl(url: string): boolean {
  if (url.length > WEBHOOK_LIMITS.urlLength) {
    return false;
  }
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === 'http:' || protocol === 'https:') && hostname !== '';
  } catch {
    return false;
  }
}
