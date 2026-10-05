import type { BatchPlan } from '../core/batch/batch-model';
import { BATCH_ID_PATTERN } from '../core/batch/batch-model';
import { parseBatchPlan } from '../core/batch/parse-batch-plan';
import type { RequestedDiagnosisFix } from '../core/diagnosis/diagnosis-model';
import { WEBHOOK_ID_PATTERN } from '../core/notify/webhook-model';
import { isPrinterAction, type PrinterAction, type PrinterCommandConfig } from '../core/printer-commands/command-model';
import { parseCommandConfig } from '../core/printer-commands/sanitize-command-config';
import { isValidSecretName, LOOKUP_TABLE_ID_PATTERN } from '../core/scan/enrich-model';
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import { isRuleKind, RULE_ID_PATTERN, type RuleKind } from '../core/scan/rule-model';
import { LIBRARY_TEMPLATE_ID_PATTERN } from '../core/templates/library/library-model';
import { TEMPLATE_ID_PATTERN } from '../core/templates/template-model';
import { type DiagnosisCheckId, isDiagnosisCheckId, isDiagnosisFixId } from '../shared/diagnosis';
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

/** 模板库里模板的编号（library:xxx）；模板库里有没有这个模板由 TemplateCatalog / findLibraryEntry 核对。 */
export function requireLibraryTemplateId(value: unknown): string {
  if (typeof value !== 'string' || !LIBRARY_TEMPLATE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid library template id');
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
  const batchId = query['batchId'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_PAGE_SIZE) {
    throw new TypeError('Invalid job query limit');
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > MAX_IPC_STRING_LENGTH)) {
    throw new TypeError('Invalid job query search');
  }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    throw new TypeError('Invalid job query cursor');
  }
  if (batchId !== undefined && (typeof batchId !== 'string' || !BATCH_ID_PATTERN.test(batchId))) {
    throw new TypeError('Invalid job query batch');
  }
  return { limit, search, before, batchId };
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

/** 批量打印的设置：逐项核对（见 core/batch/parse-batch-plan.ts）。 */
export function requireBatchPlan(value: unknown): BatchPlan {
  const plan = parseBatchPlan(value);
  if (plan === null) {
    throw new TypeError('Invalid batch plan');
  }
  return plan;
}

export function requireBatchId(value: unknown): string {
  if (typeof value !== 'string' || !BATCH_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid batch id');
  }
  return value;
}

/** 标签机指令的设置：每一项都要有、都合法（core 的严格校验），不纠正。 */
export function requirePrinterCommandConfig(value: unknown): PrinterCommandConfig {
  const config = parseCommandConfig(value);
  if (config === null) {
    throw new TypeError('Invalid printer command config');
  }
  return config;
}

export function requirePrinterAction(value: unknown): PrinterAction {
  if (!isPrinterAction(value)) {
    throw new TypeError('Invalid printer action');
  }
  return value;
}

/** 界面读出来的文件字节（拖进窗口的文件）：只收 Uint8Array，长度有上限。 */
export function requireBytes(value: unknown, name: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length > maxBytes) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

/** 从 0 数的下标（行号等）。 */
export function requireIndex(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

/**
 * settings:update 的补丁：是一个对象即可，但 printerCommands 只能经 printer:commands-apply 的严格校验
 * （认指令集、核对打印机在系统列表里、按范围把关）写入，这里要把它挡在外面，不让界面绕过去直接改设置表。
 */
export function requireSettingsPatch(value: unknown): Record<string, unknown> {
  const patch = requireRecord(value, 'settings patch');
  const { printerCommands: _ignored, ...rest } = patch;
  return rest;
}

export function requireDiagnosisCheck(value: unknown): DiagnosisCheckId {
  if (!isDiagnosisCheckId(value)) {
    throw new TypeError('Invalid diagnosis check');
  }
  return value;
}

/** 打印机名可以为 null（只查、只修后台打印服务时）。 */
export function requireNullablePrinterName(value: unknown): string | null {
  return value === null ? null : requireString(value, 'printerName');
}

/**
 * 修复请求：修复项是枚举，管理员是布尔；要取消哪些任务、写什么纸张都由主进程自己查，请求里没有
 * （M2：纸张不收渲染进程报来的纸张键，DiagnosisStation.fix 按打印机名现查设置和模板）。
 */
export function requireDiagnosisFixRequest(value: unknown): RequestedDiagnosisFix {
  const record = requireRecord(value, 'diagnosis fix request');
  const fix = record['fix'];
  if (!isDiagnosisFixId(fix)) {
    throw new TypeError('Invalid diagnosis fix');
  }
  return {
    printerName: requireNullablePrinterName(record['printerName']),
    fix,
    admin: requireBoolean(record['admin'], 'admin'),
  };
}
