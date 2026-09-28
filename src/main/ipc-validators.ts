import { WEBHOOK_ID_PATTERN } from '../core/notify/webhook-model';
import { LOOKUP_TABLE_ID_PATTERN } from '../core/scan/enrich-model';
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import { TEMPLATE_ID_PATTERN } from '../core/templates/template-model';
import type { PrintOptions, RendererPrintSource } from '../shared/ipc-contract';
import { type JobQuery, MAX_JOB_PAGE_SIZE } from '../shared/job-history';
import { isRecord } from '../shared/settings';
import { isVoiceCue, type VoiceCue } from '../shared/voice';

/** 渲染进程不可信：IPC 参数在进入业务层之前逐一校验，不合法直接抛错（fail loudly）。 */
export const MAX_IPC_STRING_LENGTH = 1_024;
const RENDERER_PRINT_SOURCES: ReadonlySet<string> = new Set<RendererPrintSource>(['desktop', 'history']);

/**
 * 扫码内容在规范化之前的长度上限：规范化后最多 1000 字符，但换行可能是 CRLF、首尾可能有空白，
 * 这里留足余量，超长的交给业务层判为「无法识别」并记录，而不是在 IPC 层直接报错。
 */
export const MAX_RAW_INPUT_LENGTH = 4 * MAX_RAW_LENGTH;

export function requireString(value: unknown, name: string, maxLength = MAX_IPC_STRING_LENGTH): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function requireRaw(value: unknown): string {
  return requireString(value, 'raw', MAX_RAW_INPUT_LENGTH);
}

export function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value as number;
}

export function requireWebhookId(value: unknown): string {
  if (typeof value !== 'string' || !WEBHOOK_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid webhook id');
  }
  return value;
}

export function requireLookupTableId(value: unknown): string {
  if (typeof value !== 'string' || !LOOKUP_TABLE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid lookup table id');
  }
  return value;
}

export function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function requireTemplateId(value: unknown): string {
  if (typeof value !== 'string' || !TEMPLATE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid template id');
  }
  return value;
}

export function requireVoiceCue(value: unknown): VoiceCue {
  if (!isVoiceCue(value)) {
    throw new TypeError('Invalid voice cue');
  }
  return value;
}

export function requirePrintOptions(value: unknown): PrintOptions {
  const options = requireRecord(value, 'print options');
  const source = options['source'];
  const force = options['force'];
  if (typeof source !== 'string' || !RENDERER_PRINT_SOURCES.has(source) || typeof force !== 'boolean') {
    throw new TypeError('Invalid print options');
  }
  return { source: source as RendererPrintSource, force };
}

export function requireJobQuery(value: unknown): JobQuery {
  const query = requireRecord(value, 'job query');
  const limit = query['limit'];
  const search = query['search'];
  const before = query['before'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_PAGE_SIZE) {
    throw new TypeError('Invalid job query limit');
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > MAX_IPC_STRING_LENGTH)) {
    throw new TypeError('Invalid job query search');
  }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    throw new TypeError('Invalid job query cursor');
  }
  return { limit, search, before };
}
