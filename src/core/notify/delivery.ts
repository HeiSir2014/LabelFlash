import type { WebhookEventType } from './webhook-model';

export const DELIVERY_STATES = ['pending', 'delivered', 'failed'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** 一条通知发往一个接口的发送记录。 */
export interface Delivery {
  id: number;
  endpointId: string;
  eventId: string;
  event: WebhookEventType;
  /** 请求体（JSON 文本）：入队时定下来，重试时原样重发，签名每次按发送时间重新计算。 */
  payload: string;
  state: DeliveryState;
  attempts: number;
  lastStatus: number | null;
  /** 给人看的失败原因。 */
  lastError: string | null;
  createdAt: number;
  /** pending 时下次发送的时间；其他状态为 null。 */
  nextAttemptAt: number | null;
  updatedAt: number;
}
