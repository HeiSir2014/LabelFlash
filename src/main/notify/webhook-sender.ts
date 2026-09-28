import { createHmac } from 'node:crypto';
import type { Delivery } from '../../core/notify/delivery';
import { WEBHOOK_LIMITS, type WebhookEndpoint } from '../../core/notify/webhook-model';
import type { FetchFunction } from '../scan/http-step';

export interface SendOutcome {
  /** HTTP 状态码；没拿到响应（网络错误、超时、密钥缺失）时为 null。 */
  status: number | null;
  /** 给人看的失败原因；成功时为 null。 */
  error: string | null;
}

export interface WebhookSenderDeps {
  fetch: FetchFunction;
  secret: (name: string) => string | null;
  now: () => number;
  userAgent: string;
}

const MS_PER_SECOND = 1_000;

export const WEBHOOK_HEADERS = {
  event: 'X-LabelFlash-Event',
  delivery: 'X-LabelFlash-Delivery',
  timestamp: 'X-LabelFlash-Timestamp',
  signature: 'X-LabelFlash-Signature',
} as const;

/** 签名：HMAC-SHA256(密钥, 时间戳 + "." + 请求体)，十六进制，前缀 sha256=。 */
export function signPayload(secret: string, timestamp: number, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
}

/** 发送一条通知：带事件头、时间戳和签名；只关心状态码，不读返回内容。 */
export function createWebhookSender(
  deps: WebhookSenderDeps,
): (endpoint: WebhookEndpoint, delivery: Delivery) => Promise<SendOutcome> {
  return async (endpoint, delivery) => {
    const timestamp = Math.floor(deps.now() / MS_PER_SECOND);
    const headers = new Headers({
      'Content-Type': 'application/json',
      'User-Agent': deps.userAgent,
      [WEBHOOK_HEADERS.event]: delivery.event,
      [WEBHOOK_HEADERS.delivery]: delivery.eventId,
      [WEBHOOK_HEADERS.timestamp]: String(timestamp),
    });
    if (endpoint.secretName !== null) {
      const secret = deps.secret(endpoint.secretName);
      if (secret === null) {
        return { status: null, error: `没有设置签名密钥「${endpoint.secretName}」` };
      }
      headers.set(WEBHOOK_HEADERS.signature, signPayload(secret, timestamp, delivery.payload));
    }
    try {
      const response = await deps.fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: delivery.payload,
        // 不跟随跳转：POST 跟随跳转会变成 GET 或把内容发到别处；3xx 按配置错误处理。
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_LIMITS.timeoutMs),
      });
      await response.body?.cancel();
      return { status: response.status, error: response.ok ? null : `接口返回 ${response.status}` };
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
      return {
        status: null,
        error: isTimeout ? `${WEBHOOK_LIMITS.timeoutMs / MS_PER_SECOND} 秒内没有响应` : '网络错误，连不上接口',
      };
    }
  };
}
