import { DEFAULT_PAPER } from '../../shared/label-paper';
import { paperKey } from '../../shared/paper-sizes';
import type { ScanResult } from '../scan/scan-result';
import type { JobRecord, PrintFailureReason, PrintSource, PrintStatus } from '../types';
import type { WebhookEvent, WebhookEventType } from './webhook-model';

/** 这台电脑的身份：接收方用来区分多个打印台。 */
export interface Station {
  name: string;
  app: string;
}

/** 通知的请求体（JSON）。字段只增不改，接收方可以放心按名取值。 */
export interface WebhookPayload {
  /** 事件编号：打印记录 id；测试事件以 test- 开头。接收方靠它去重。 */
  id: string;
  event: WebhookEventType;
  /** ISO 8601（UTC）。 */
  occurredAt: string;
  raw: string;
  rule: { id: string; name: string } | null;
  /** 识别和加工后的字段（字段名 → 值）；识别不了时为 null。 */
  fields: Record<string, string> | null;
  printer: string;
  /** 纸张键（例如 100x180）；旧记录和识别不了的记录为 null。新增字段，不影响已有的接收方。 */
  paper: string | null;
  source: PrintSource | null;
  forced: boolean;
  failureReason: PrintFailureReason | null;
  station: Station;
}

const EVENT_OF_STATUS: Record<PrintStatus, WebhookEvent> = {
  printed: 'printed',
  failed: 'failed',
  duplicate: 'duplicate',
  invalid: 'invalid',
};

export function eventOf(status: PrintStatus): WebhookEvent {
  return EVENT_OF_STATUS[status];
}

/** 由一条打印记录（以及当时的识别结果）生成通知内容。 */
export function payloadOf(job: JobRecord, scan: ScanResult | null, station: Station): WebhookPayload {
  return {
    id: job.id,
    event: eventOf(job.status),
    occurredAt: new Date(job.createdAt).toISOString(),
    raw: job.raw,
    rule: scan ? { id: scan.ruleId, name: scan.ruleName } : null,
    fields: scan ? Object.fromEntries(scan.fields.map((field) => [field.name, field.value])) : null,
    printer: job.printerName,
    paper: job.paper ?? null,
    source: job.source,
    forced: job.forced,
    failureReason: job.failureReason ?? null,
    station,
  };
}

/** 「发送测试」的内容：结构和真实事件相同，方便接收方按真实格式调试。 */
export function testPayload(id: string, now: number, station: Station): WebhookPayload {
  return {
    id,
    event: 'test',
    occurredAt: new Date(now).toISOString(),
    raw: 'TEST-0001-测试色-XL',
    rule: { id: 'builtin:dash-three', name: '横杠三段（编码-颜色-尺码）' },
    fields: { 编码: 'TEST-0001', 颜色: '测试色', 尺码: 'XL' },
    printer: '',
    paper: paperKey(DEFAULT_PAPER),
    source: null,
    forced: false,
    failureReason: null,
    station,
  };
}
