/**
 * 手机扫码打印的协议：电脑、手机与云端中转服务三方共用。
 *
 * 分两层：外层信封由中转服务按会话路由；内层消息加密后放在信封的 body 里，只有手机和电脑能解开。
 * 所有收到的消息都不可信：解析函数逐字段检查，只返回白名单里的字段，不合法时返回 null。
 */
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import { type InvalidReason, PRINT_FAILURE_REASONS, type PrintFailureReason, type RecentPrint } from '../core/types';
import { PRINTER_ISSUES, type PrinterIssue } from './printer-readiness';

export const MOBILE_PROTOCOL_VERSION = 1;
/** 会话号、所有权密钥、手机令牌、nonce：16 字节随机数（128 位，不可猜），base64url 后 22 个字符。 */
export const ID_BYTES = 16;
/** 内容密钥：AES-256，32 字节，base64url 后 43 个字符。 */
export const KEY_BYTES = 32;
/** AES-GCM 的 IV：12 字节，base64url 后 16 个字符。 */
export const IV_BYTES = 12;
/** 单帧上限：最长的内容是 30 个字段的预览，远小于这个值；中转服务按它设置 maxPayloadLength。 */
export const MAX_FRAME_BYTES = 64 * 1024;
/** 心跳间隔：远小于 nginx 的 proxy_read_timeout（120 秒）和移动网络 NAT 常见的 60 秒空闲回收。 */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** 发出心跳后多久收不到任何消息就判定断线：正常往返不到 1 秒，留足弱网余量。 */
export const HEARTBEAT_TIMEOUT_MS = 10_000;
/** 断线后依次等待这么久再重连，之后一直按最后一项。 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** 连接后必须在这段时间内发出第一帧（open / join），否则中转服务断开它。 */
export const FIRST_FRAME_TIMEOUT_MS = 10_000;
/** 电脑断线后中转服务保留会话的时间：够电脑换网络或中转服务重启后重连。 */
export const DESKTOP_GRACE_MS = 120_000;
/** 被接纳过的手机收到 not-found 后继续重试的时间：中转服务重启时手机可能比电脑先连上。 */
export const RESUME_RETRY_MS = 30_000;
/** 手机的简短描述（例如「iPhone · 微信」）只用于电脑上显示，超出截断。 */
export const MAX_DEVICE_LENGTH = 40;
/**
 * 请求里原文的长度上限。准确的上限（规范化后 1–1000 字符）由 PrintService 判断，
 * 这里只挡住明显超大的输入；留出 4 倍是因为规范化会去掉首尾空白、统一换行。
 */
export const MAX_REQUEST_RAW_LENGTH = MAX_RAW_LENGTH * 4;
/** 中转服务分配的手机连接号。 */
const MAX_PHONE_ID_LENGTH = 64;

export const CLOSE_REASONS = ['stopped', 'idle', 'quit'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const END_REASONS = [...CLOSE_REASONS, 'desktop-gone'] as const;
export type EndReason = (typeof END_REASONS)[number];
export const RELAY_ERROR_CODES = ['version', 'session-taken', 'bad-frame', 'rate-limited', 'server-busy'] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

/** 加密后的内层消息：iv 和密文都是 base64url。 */
export interface SealedBody {
  iv: string;
  ct: string;
}

export type DesktopFrame =
  | { t: 'open'; v: number; session: string; secret: string }
  | { t: 'send'; phone: string; body: SealedBody }
  | { t: 'kick'; phone: string }
  | { t: 'close'; reason: CloseReason }
  | { t: 'ping' };

export type RelayToDesktop =
  | { t: 'opened' }
  | { t: 'joined'; phone: string }
  | { t: 'left'; phone: string }
  | { t: 'recv'; phone: string; body: SealedBody }
  | { t: 'pong' }
  | { t: 'error'; code: RelayErrorCode };

export type PhoneFrame = { t: 'join'; v: number; session: string } | { t: 'send'; body: SealedBody } | { t: 'ping' };

export type RelayToPhone =
  | { t: 'online' }
  | { t: 'waiting' }
  | { t: 'recv'; body: SealedBody }
  | { t: 'ended'; reason: EndReason }
  | { t: 'not-found' }
  | { t: 'kicked' }
  | { t: 'pong' }
  | { t: 'error'; code: RelayErrorCode };

export type PhoneMessage =
  | { type: 'hello'; token: string | null; device: string }
  | { type: 'preview'; nonce: string; id: number; raw: string }
  | { type: 'print'; nonce: string; id: number; raw: string; force: boolean };

export interface PhoneField {
  name: string;
  value: string;
}

export type PhonePreview =
  | {
      status: 'ok';
      ruleName: string;
      templateName: string;
      fields: PhoneField[];
      /** 字段数或字段值超过上限被截断了。 */
      truncated: boolean;
      recent: RecentPrint | null;
      windowMs: number;
      /** 设为「拦下不打印」的查询失败了：打印会被拦下，这里是原因。 */
      lookupFailure: string | null;
    }
  | { status: 'invalid'; reason: InvalidReason };

export type PhonePrintResult =
  | { status: 'printed' }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'failed'; reason: PrintFailureReason; detail: string | null; issue: PrinterIssue | null }
  /** 电脑上还没有选打印机。 */
  | { status: 'no-printer' };

export type DesktopMessage =
  | { type: 'welcome'; token: string; nonce: string; printer: string | null }
  | { type: 'rejected' }
  | { type: 'preview'; id: number; result: PhonePreview }
  | { type: 'print'; id: number; result: PhonePrintResult }
  | { type: 'busy'; id: number }
  | { type: 'rate-limited'; id: number };

const INVALID_REASONS: readonly InvalidReason[] = ['INVALID_CONTENT', 'NO_MATCHING_RULE'];
const RECENT_STATES: readonly RecentPrint['state'][] = ['printing', 'printed'];
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const RANDOM_ID_LENGTH = base64UrlLength(ID_BYTES);
const KEY_LENGTH = base64UrlLength(KEY_BYTES);
const IV_LENGTH = base64UrlLength(IV_BYTES);

/** 不带填充的 base64url 长度。 */
function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

export function isRandomId(value: unknown): value is string {
  return typeof value === 'string' && value.length === RANDOM_ID_LENGTH && BASE64URL.test(value);
}

export function isSessionKey(value: unknown): value is string {
  return typeof value === 'string' && value.length === KEY_LENGTH && BASE64URL.test(value);
}

export function parseDesktopFrame(text: string): DesktopFrame | null {
  const frame = parseRecord(text);
  switch (frame?.['t']) {
    case 'open': {
      const { v, session, secret } = frame;
      return isVersion(v) && isRandomId(session) && isRandomId(secret) ? { t: 'open', v, session, secret } : null;
    }
    case 'send': {
      const { phone } = frame;
      const body = readBody(frame['body']);
      return isPhoneId(phone) && body ? { t: 'send', phone, body } : null;
    }
    case 'kick':
      return isPhoneId(frame['phone']) ? { t: 'kick', phone: frame['phone'] } : null;
    case 'close':
      return isOneOf(frame['reason'], CLOSE_REASONS) ? { t: 'close', reason: frame['reason'] } : null;
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

export function parseRelayToDesktop(text: string): RelayToDesktop | null {
  const frame = parseRecord(text);
  switch (frame?.['t']) {
    case 'opened':
      return { t: 'opened' };
    case 'joined':
    case 'left':
      return isPhoneId(frame['phone']) ? { t: frame['t'], phone: frame['phone'] } : null;
    case 'recv': {
      const { phone } = frame;
      const body = readBody(frame['body']);
      return isPhoneId(phone) && body ? { t: 'recv', phone, body } : null;
    }
    case 'pong':
      return { t: 'pong' };
    case 'error':
      return isOneOf(frame['code'], RELAY_ERROR_CODES) ? { t: 'error', code: frame['code'] } : null;
    default:
      return null;
  }
}

export function parsePhoneFrame(text: string): PhoneFrame | null {
  const frame = parseRecord(text);
  switch (frame?.['t']) {
    case 'join': {
      const { v, session } = frame;
      return isVersion(v) && isRandomId(session) ? { t: 'join', v, session } : null;
    }
    case 'send': {
      const body = readBody(frame['body']);
      return body ? { t: 'send', body } : null;
    }
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

export function parseRelayToPhone(text: string): RelayToPhone | null {
  const frame = parseRecord(text);
  switch (frame?.['t']) {
    case 'online':
    case 'waiting':
    case 'not-found':
    case 'kicked':
    case 'pong':
      return { t: frame['t'] };
    case 'recv': {
      const body = readBody(frame['body']);
      return body ? { t: 'recv', body } : null;
    }
    case 'ended':
      return isOneOf(frame['reason'], END_REASONS) ? { t: 'ended', reason: frame['reason'] } : null;
    case 'error':
      return isOneOf(frame['code'], RELAY_ERROR_CODES) ? { t: 'error', code: frame['code'] } : null;
    default:
      return null;
  }
}

export function parsePhoneMessage(value: unknown): PhoneMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['type']) {
    case 'hello': {
      const { token, device } = value;
      if ((token !== null && !isRandomId(token)) || typeof device !== 'string') {
        return null;
      }
      return { type: 'hello', token, device: device.slice(0, MAX_DEVICE_LENGTH) };
    }
    case 'preview': {
      const { nonce, id, raw } = value;
      return isRandomId(nonce) && isRequestId(id) && isRequestRaw(raw) ? { type: 'preview', nonce, id, raw } : null;
    }
    case 'print': {
      const { nonce, id, raw, force } = value;
      if (!isRandomId(nonce) || !isRequestId(id) || !isRequestRaw(raw) || typeof force !== 'boolean') {
        return null;
      }
      return { type: 'print', nonce, id, raw, force };
    }
    default:
      return null;
  }
}

export function parseDesktopMessage(value: unknown): DesktopMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['type']) {
    case 'welcome': {
      const { token, nonce, printer } = value;
      if (!isRandomId(token) || !isRandomId(nonce) || !isStringOrNull(printer)) {
        return null;
      }
      return { type: 'welcome', token, nonce, printer };
    }
    case 'rejected':
      return { type: 'rejected' };
    case 'preview': {
      const result = readPreview(value['result']);
      return isRequestId(value['id']) && result ? { type: 'preview', id: value['id'], result } : null;
    }
    case 'print': {
      const result = readPrintResult(value['result']);
      return isRequestId(value['id']) && result ? { type: 'print', id: value['id'], result } : null;
    }
    case 'busy':
    case 'rate-limited':
      return isRequestId(value['id']) ? { type: value['type'], id: value['id'] } : null;
    default:
      return null;
  }
}

export function buildPhoneUrl(baseUrl: string, session: string, key: string): string {
  return `${new URL('m/', baseUrl).href}#${session}.${key}`;
}

/** 链接里 # 后面的部分：浏览器不会把它发给服务器，所以会话号和密钥不会出现在服务器日志里。 */
export function parsePhoneFragment(hash: string): { session: string; key: string } | null {
  const [session, key, ...rest] = hash.replace(/^#/, '').split('.');
  return rest.length === 0 && isRandomId(session) && isSessionKey(key) ? { session, key } : null;
}

function readPreview(value: unknown): PhonePreview | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value['status'] === 'invalid') {
    return isOneOf(value['reason'], INVALID_REASONS) ? { status: 'invalid', reason: value['reason'] } : null;
  }
  if (value['status'] !== 'ok') {
    return null;
  }
  const { ruleName, templateName, truncated, windowMs, lookupFailure } = value;
  const fields = readFields(value['fields']);
  const recent = value['recent'] === null ? null : readRecent(value['recent']);
  if (
    typeof ruleName !== 'string' ||
    typeof templateName !== 'string' ||
    fields === null ||
    typeof truncated !== 'boolean' ||
    recent === undefined ||
    !isDuration(windowMs) ||
    !isStringOrNull(lookupFailure)
  ) {
    return null;
  }
  return { status: 'ok', ruleName, templateName, fields, truncated, recent, windowMs, lookupFailure };
}

function readPrintResult(value: unknown): PhonePrintResult | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['status']) {
    case 'printed':
      return { status: 'printed' };
    case 'no-printer':
      return { status: 'no-printer' };
    case 'duplicate': {
      const recent = readRecent(value['recent']);
      const { windowMs } = value;
      return recent && isDuration(windowMs) ? { status: 'duplicate', recent, windowMs } : null;
    }
    case 'invalid':
      return isOneOf(value['reason'], INVALID_REASONS) ? { status: 'invalid', reason: value['reason'] } : null;
    case 'failed': {
      const { reason, detail, issue } = value;
      if (!isOneOf(reason, PRINT_FAILURE_REASONS) || !isStringOrNull(detail)) {
        return null;
      }
      if (issue !== null && !isOneOf(issue, PRINTER_ISSUES)) {
        return null;
      }
      return { status: 'failed', reason, detail, issue };
    }
    default:
      return null;
  }
}

function readFields(value: unknown): PhoneField[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const fields: PhoneField[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item['name'] !== 'string' || typeof item['value'] !== 'string') {
      return null;
    }
    fields.push({ name: item['name'], value: item['value'] });
  }
  return fields;
}

/** 不合法时返回 undefined（和合法的 null 区分开）。 */
function readRecent(value: unknown): RecentPrint | undefined {
  if (!isRecord(value) || !isOneOf(value['state'], RECENT_STATES) || !Number.isFinite(value['at'])) {
    return undefined;
  }
  return { state: value['state'], at: value['at'] as number };
}

function readBody(value: unknown): SealedBody | null {
  if (!isRecord(value)) {
    return null;
  }
  const { iv, ct } = value;
  const isIv = typeof iv === 'string' && iv.length === IV_LENGTH && BASE64URL.test(iv);
  const isCipherText = typeof ct === 'string' && ct.length <= MAX_FRAME_BYTES && BASE64URL.test(ct);
  return isIv && isCipherText ? { iv, ct } : null;
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isDuration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRequestRaw(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_REQUEST_RAW_LENGTH;
}

function isPhoneId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PHONE_ID_LENGTH && BASE64URL.test(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
