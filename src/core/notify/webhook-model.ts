import { isValidSecretName } from '../scan/enrich-model';
import type { JobRecord } from '../types';

/** 可以订阅的打印结果；test 只由「发送测试」产生，不能订阅。 */
export const WEBHOOK_EVENTS = ['printed', 'failed', 'duplicate', 'invalid'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookEventType = WebhookEvent | 'test';

export const DEFAULT_WEBHOOK_EVENTS: readonly WebhookEvent[] = ['printed', 'failed'];

/**
 * 通知按打印从哪来分组，每个接口自己勾选：扫码（扫码枪和按内容重打）、手机扫码、本机接口、局域网共享、批量打印、打印 PDF。
 * 从打印记录重打的那一张算它原来的来源（重打批量打的那一张还是「批量打印」）。
 */
export const WEBHOOK_SOURCES = ['scan', 'mobile', 'api', 'ipp', 'batch', 'pdf'] as const;
export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

/**
 * 默认不发批量打印和打印 PDF：一批几千上万张，每张一条通知，5 个接口就是几万条排队，接收方和本机队列都会被压垮。
 * 要的话在接口上勾上。
 */
export const DEFAULT_WEBHOOK_SOURCES: readonly WebhookSource[] = ['scan', 'mobile', 'api', 'ipp'];

/** 一个通知接口（本机设置，不随规则导出）。 */
export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  /** 签名用的密钥名称（存在密钥表里）；null = 不签名。 */
  secretName: string | null;
  events: WebhookEvent[];
  /** 发哪些来源的打印结果；没有这一项的旧设置按 DEFAULT_WEBHOOK_SOURCES。 */
  sources: WebhookSource[];
  enabled: boolean;
}

/** 这条打印记录算哪个来源（见 WEBHOOK_SOURCES）。 */
export function webhookSourceOf(job: JobRecord): WebhookSource {
  if (job.batch !== undefined || job.source === 'batch') {
    return 'batch';
  }
  if (job.pdf !== undefined || job.source === 'pdf') {
    return 'pdf';
  }
  if (job.ipp !== undefined || job.source === 'ipp') {
    return 'ipp';
  }
  if (job.caller !== undefined || job.source === 'api') {
    return 'api';
  }
  return job.source === 'mobile' ? 'mobile' : 'scan';
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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
  /**
   * 等待发送的最多这么多条（所有接口合计），多出的最早那些放弃：接收方长时间不通时队列不能无限长。
   * 5 个接口各 2000 条，一个班次扫码、接口打的量都放得下。
   */
  maxPendingDeliveries: 10_000,
  /**
   * 等待发送超过这么久的放弃：正常的重试 24 小时内就有结果，剩下的是接口停用后留着的；
   * 停用一周以上再启用，发出去的也早已没有意义。
   */
  pendingMaxAgeMs: 7 * DAY_MS,
  /** 清理等待队列最多这么久做一次：每打一张都查一遍太费。 */
  pendingPruneIntervalMs: MINUTE_MS,
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
  const { id, name, url, secretName, events, sources, enabled } = value as Record<string, unknown>;
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
  // 2.0.0 之前保存的接口没有 sources：按默认（不含批量、PDF），和以前收到的一样。
  const chosenSources = Array.isArray(sources)
    ? WEBHOOK_SOURCES.filter((source) => sources.includes(source))
    : [...DEFAULT_WEBHOOK_SOURCES];
  return { id, name: name.trim(), url, secretName, events: known, sources: chosenSources, enabled };
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
