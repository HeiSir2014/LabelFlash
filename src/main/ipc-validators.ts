import { WEBHOOK_ID_PATTERN } from '../core/notify/webhook-model';
import { isValidSecretName, LOOKUP_TABLE_ID_PATTERN } from '../core/scan/enrich-model';
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import { isRuleKind, RULE_ID_PATTERN, type RuleKind } from '../core/scan/rule-model';
import { TEMPLATE_ID_PATTERN } from '../core/templates/template-model';
import type { PrintOptions, RendererPrintSource } from '../shared/ipc-contract';
import { type JobQuery, MAX_JOB_PAGE_SIZE } from '../shared/job-history';
import { isWebOrigin, normalizeApiKeyName } from '../shared/local-api';
import { isRandomId } from '../shared/mobile-protocol';
import { paperKey, parsePaperKey } from '../shared/paper-sizes';
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

/** 一次导出的规则数上限：内置 + 自定义规则总数的余量。 */
const MAX_RULE_IDS = 100;

export function requireRuleId(value: unknown): string {
  if (typeof value !== 'string' || !RULE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid rule id');
  }
  return value;
}

export function requireRuleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_RULE_IDS) {
    throw new TypeError('Invalid rule ids');
  }
  return value.map(requireRuleId);
}

export function requireRuleKind(value: unknown): RuleKind {
  if (typeof value !== 'string' || !isRuleKind(value)) {
    throw new TypeError('Invalid rule kind');
  }
  return value;
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

export function requireSecretName(value: unknown): string {
  if (typeof value !== 'string' || !isValidSecretName(value)) {
    throw new TypeError('Invalid secret name');
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

/** 纸张键（例如 100x180，见 src/shared/paper-sizes.ts）；返回统一写法。 */
export function requirePaperKey(value: unknown): string {
  const paper = typeof value === 'string' ? parsePaperKey(value) : null;
  if (paper === null) {
    throw new TypeError('Invalid paper key');
  }
  return paperKey(paper);
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

export function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

/** 手机扫码状态里的手机 id：电脑生成的 16 字节随机数（不是令牌）。 */
export function requireMobilePhoneId(value: unknown): string {
  if (!isRandomId(value)) {
    throw new TypeError('Invalid mobile phone id');
  }
  return value;
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

/** 程序密钥的编号：生成时用的 UUID。 */
const API_KEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function requireApiKeyId(value: unknown): string {
  if (typeof value !== 'string' || !API_KEY_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid api key id');
  }
  return value;
}

export function requireApiKeyName(value: unknown): string {
  const name = normalizeApiKeyName(value);
  if (name === null) {
    throw new TypeError('Invalid api key name');
  }
  return name;
}

export function requireWebOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_IPC_STRING_LENGTH || !isWebOrigin(value)) {
    throw new TypeError('Invalid web origin');
  }
  return value;
}
