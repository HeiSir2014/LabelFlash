import { WEBHOOK_LIMITS } from './webhook-model';

/** 一次发送的结果怎么处理：成功、稍后重试、不再重试（配置错误）。 */
export type DeliveryVerdict = 'delivered' | 'retry' | 'reject';

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * status 为 null 表示没拿到响应（网络错误、超时、密钥缺失）：可以重试。
 * 2xx 成功；408、429、5xx 是对方暂时处理不了，重试；其他 4xx 是地址或签名不对，重试也没用。
 */
export function judgeResponse(status: number | null): DeliveryVerdict {
  if (status === null) {
    return 'retry';
  }
  if (status >= 200 && status < 300) {
    return 'delivered';
  }
  if (status === HTTP_REQUEST_TIMEOUT || status === HTTP_TOO_MANY_REQUESTS || status >= 500) {
    return 'retry';
  }
  return 'reject';
}

/**
 * 第 attempts 次尝试失败后，下次什么时候再试；重试次数用完或会超过 24 小时时返回 null（放弃）。
 */
export function nextAttemptAt(attempts: number, createdAt: number, now: number): number | null {
  const delay = WEBHOOK_LIMITS.retryDelaysMs[attempts - 1];
  if (delay === undefined) {
    return null;
  }
  const next = now + delay;
  return next - createdAt > WEBHOOK_LIMITS.giveUpAfterMs ? null : next;
}
