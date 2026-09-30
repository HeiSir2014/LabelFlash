/**
 * 手机扫码打印的协议：电脑、手机与云端中转服务三方共用。
 *
 * 分两层：外层信封由中转服务按会话路由；内层消息加密后放在信封的 body 里，只有手机和电脑能解开。
 * 所有收到的消息都不可信：解析函数逐字段检查，只返回白名单里的字段，不合法时返回 null。
 */
import type { CodeRelativeArea, CodeSquare } from '../core/scan/image-text';
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import { isValidFieldName } from '../core/scan/rule-model';
import { type InvalidReason, PRINT_FAILURE_REASONS, type PrintFailureReason, type RecentPrint } from '../core/types';
import { PRINTER_ISSUES, type PrinterIssue } from './printer-readiness';

export const MOBILE_PROTOCOL_VERSION = 1;
/** 会话号、所有权密钥、手机令牌、nonce、任务号、中转服务分配的连接号：16 字节随机数（128 位，不可猜），base64url 后 22 个字符。 */
export const ID_BYTES = 16;
/** 内容密钥：AES-256，32 字节，base64url 后 43 个字符。 */
export const KEY_BYTES = 32;
/** AES-GCM 的 IV：12 字节，base64url 后 16 个字符。 */
export const IV_BYTES = 12;
/**
 * 单帧上限（字节）：中转服务按它设置 maxPayloadLength，超过的连接直接断开。
 * 手机随扫码带一张标签图（最多 MAX_IMAGE_BYTES），所以比只有文字时大。
 */
export const MAX_FRAME_BYTES = 1152 * 1024;
/**
 * 内层消息的明文上限（UTF-8 字节）：加密后经 base64url 约变成 4/3 倍，加上信封仍小于 MAX_FRAME_BYTES。
 * 最长的请求（MAX_REQUEST_RAW_LENGTH 个字符，每个 JSON 转义后最多 6 字节，加上最大的图和手动字段）
 * 和最长的结果都在这个范围内，由测试保证。
 */
export const MAX_MESSAGE_BYTES = 768 * 1024;
/**
 * 标签图（JPEG）的上限：画质优先，字的边缘越清楚 OCR 越准；4G 下 0.5 MB 也只要零点几秒。
 * 实际多大由电脑要的清晰度（ImageRequest.pixelsPerCode）决定，手机压不到这么小时才降低画质。
 * 图在消息里是 base64（约 4/3 倍），整条消息加密后再 base64url 一次，所以 MAX_MESSAGE_BYTES、MAX_FRAME_BYTES 跟着放大。
 */
export const MAX_IMAGE_BYTES = 512 * 1024;
/**
 * 一次扫码最多带几帧标签图（同一张标签连续的几帧）。货架号的横杠这类细笔画，在有的帧里淡到读不出，
 * 真手机试扫时单帧只有约 2/3 能读出；几帧依次识别，一帧读不出还有下一帧。所有帧合起来仍不超过 MAX_IMAGE_BYTES。
 */
export const MAX_LABEL_FRAMES = 3;
/** 截图的边长上限（像素）：整张标签是二维码边长的 6 倍宽，1600 像素够每个边长截 260 多像素；再大手机编码太慢。 */
export const MAX_IMAGE_SIDE = 1600;
/** 每个二维码边长截多少像素：太少字看不清，太多图太大（见 ImageRequest）。 */
export const PIXELS_PER_CODE_RANGE = { min: 40, max: 400 } as const;
/** 区域离二维码最多这么多个边长（和加工步骤的 areaExtent 一致）。 */
export const IMAGE_AREA_EXTENT = 10;
/** 手机上手动输入的字段：最多几个、每个值多长（货架号这类短值）。 */
export const MAX_MANUAL_FIELDS = 10;
export const MAX_MANUAL_VALUE_LENGTH = 100;
/** 心跳间隔：远小于 nginx 的 proxy_read_timeout（120 秒）和移动网络 NAT 常见的 60 秒空闲回收。 */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** 发出心跳后多久收不到任何消息就判定断线：正常往返不到 1 秒，留足弱网余量。 */
export const HEARTBEAT_TIMEOUT_MS = 10_000;
/** 发起连接后多久还没连上就放弃这次、按退避重来：弱网下握手偶尔会卡住，浏览器自己要等很久才报错。 */
export const CONNECT_TIMEOUT_MS = 10_000;
/** 连接失败后依次等待这么久再重连，之后一直按最后一项。连上并被会话接纳后才从头算起。 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** 连接后必须在这段时间内发出第一帧（open / join），否则中转服务断开它。 */
export const FIRST_FRAME_TIMEOUT_MS = 10_000;
/**
 * 电脑断线后会话的宽限期：够电脑换网络或中转服务重启后重连。
 * 中转服务按它保留断线电脑的会话；中转服务重启后状态已丢，被接纳过的手机收到 not-found 时，也按同一个宽限期等电脑回来。
 */
export const DESKTOP_GRACE_MS = 120_000;
/** 二维码显示后多久没有手机加入就作废：拍到屏幕的人拿到的也只是一个很快过期的链接。 */
export const UNCLAIMED_TTL_MS = 10 * 60_000;
/** 多久没有任务就自动结束：偶尔补打用完就放下了，不该一直连着。 */
export const IDLE_END_MS = 30 * 60_000;
/** 手机提交的任务多久没收到 accepted 就用同一个任务号重发（幂等，不会多打）。 */
export const JOB_ACK_TIMEOUT_MS = 10_000;
/**
 * 已被接受的任务多久没有任何进展（排队位置、开始打印、结果）就用同一个任务号再问一次，电脑只回当前进度。
 * 中转服务限速或对端刚断开时会丢帧；端到端靠这个补上，不依赖中转服务可靠。
 */
export const JOB_STATUS_POLL_MS = 30_000;
/**
 * 一部手机同时在电脑上排队、还没出结果的任务上限：扫码比打印快时让手机先等一等（背压），
 * 10 张足够连续扫一小批，又不至于在打印机出问题时积压太多。
 */
export const MAX_PENDING_JOBS = 10;
/**
 * 一个会话里同时加入的手机上限：样衣间几个人一起补打够用；再多，排队时间长到失去意义，
 * 也更难看清是谁在用。电脑上可以移除不用的手机腾出位置。
 */
export const MAX_PHONES_PER_SESSION = 5;
/** 手机的简短描述（例如「iPhone · 微信」）只用于电脑上显示，超出截断（按字符，不拆开一个字）。 */
export const MAX_DEVICE_LENGTH = 40;
/**
 * 请求里原文的长度上限。准确的上限（规范化后 1–1000 字符）由 PrintService 判断，
 * 这里只挡住明显超大的输入；留出 4 倍是因为规范化会去掉首尾空白、统一换行。
 */
export const MAX_REQUEST_RAW_LENGTH = MAX_RAW_LENGTH * 4;

/** WebSocket 关闭码：1000–1015 是标准码，4000–4999 留给应用。三方都从这里取。 */
export const CLOSE_CODES = {
  normal: 1000,
  /** 违反协议：坏帧、版本不对、会话号被占、第一帧超时、持续刷帧。 */
  policy: 1008,
  /** 中转服务满了，稍后再试。 */
  tryLater: 1013,
  /** 客户端发现心跳超时，主动断开。 */
  heartbeatTimeout: 4000,
  /** 同一台电脑的新连接接管了会话，旧连接让位。 */
  replaced: 4001,
  /** 客户端等不到连接建立，主动放弃。 */
  connectTimeout: 4002,
} as const;

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

export const DENIAL_REASONS = ['full', 'removed', 'locked'] as const;
/**
 * 手机没被接纳的原因：full = 会话里的手机满了；removed = 电脑上把这部手机移除了（它的令牌已作废）；
 * locked = 电脑上暂停了新手机加入（移除手机后自动暂停，免得被移除的人换个浏览器又加进来）。
 */
export type DenialReason = (typeof DENIAL_REASONS)[number];

export const REFUSAL_REASONS = ['rate-limited', 'too-many-pending'] as const;
/** 任务没被接受（也就没有执行）的原因：稍后可以用同一个任务号重发。 */
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/**
 * 电脑要手机随扫码截的标签图：以二维码为基准的区域（单位是二维码边长），每个边长截多少像素。
 * 只在有加工步骤「图中文字识别」、这台电脑能识别时才要。
 */
export interface ImageRequest {
  area: CodeRelativeArea;
  pixelsPerCode: number;
  /** 要连续几帧（1 到 MAX_LABEL_FRAMES）；老电脑不发，按 1 帧。 */
  frames: number;
}

/** 手机截的标签图：按二维码摆正后的 JPEG（标准 base64），二维码在图里的位置（像素）。 */
export interface PhoneImage {
  jpeg: string;
  code: CodeSquare;
}

/** 手机 → 电脑。 */
export type PhoneMessage =
  /** 加入或恢复会话；token 是之前 welcome 给的令牌，第一次为 null。 */
  | { type: 'hello'; token: string | null; device: string }
  /**
   * 提交一个打印任务，或者查询它的进度。
   * - job：手机生成的随机任务号，也是幂等键。同一个任务号电脑只执行一次，重发只会拿到已有的进度或结果。
   *   断线重连后，手机把还没结果的任务原样重发，不会丢，也不会多打。
   * - nonce、seq：防重放。nonce 是本次连接的 welcome 给的，seq 在本次连接内严格递增。
   * - force：强制补打（跳过防重复窗口）。补打是一个新任务，有自己的任务号。
   * - image：电脑要图时（见 welcome.image）随扫码截的标签图；老手机页面、电脑没要时没有。
   * - moreImages：电脑要几帧时，同一张标签接下来的几帧（不含 image），和 image 合起来不超过 MAX_IMAGE_BYTES；没有时省略。
   * - fields：手机上手动输入的字段（例如没认出时补的货架号）；没有时省略。
   */
  | {
      type: 'submit';
      nonce: string;
      seq: number;
      job: string;
      raw: string;
      force: boolean;
      image?: PhoneImage;
      moreImages?: PhoneImage[];
      fields?: PhoneField[];
    };

export interface PhoneField {
  name: string;
  value: string;
}

export type PhonePrintResult =
  /** 打印成功时带上识别结果的摘要，手机上能看到打的是哪一张。 */
  | { status: 'printed'; ruleName: string; fields: PhoneField[] }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: InvalidReason }
  | {
      status: 'failed';
      reason: PrintFailureReason;
      detail: string | null;
      issue: PrinterIssue | null;
      /** TEXT_NOT_FOUND 时没认出的字段名（手机上显示它的输入框）；老电脑不发，按 null。 */
      field: string | null;
    }
  /** 这张的纸在电脑上没有可用的打印机（协议不变：手机不需要知道是哪种纸）。 */
  | { status: 'no-printer' };

/** 排队中的一个任务：前面还有 ahead 个任务（所有手机的任务共用一个队列，包括正在打印的那张）。 */
export interface QueuePosition {
  job: string;
  ahead: number;
}

/** 电脑 → 手机。 */
export type DesktopMessage =
  /**
   * 加入或恢复成功：这部手机的令牌、本次连接的 nonce、当前打印机（显示名，没选时为 null）。
   * image：要手机随扫码截标签图时才有（老电脑没有，手机就不截）。
   */
  | { type: 'welcome'; token: string; nonce: string; printer: string | null; image?: ImageRequest }
  /** 没被接纳。 */
  | { type: 'denied'; reason: DenialReason }
  /** 电脑上选的打印机变了，或者要不要截图变了（加工步骤改了）：image 同 welcome。 */
  | { type: 'printer'; printer: string | null; image?: ImageRequest }
  /** 任务已收到，在排队（回复 submit）。 */
  | { type: 'accepted'; job: string; ahead: number }
  /**
   * 队伍往前走了：这部手机所有还在排队的任务的新位置，一部手机一条，不按任务逐条发。
   * 只发给位置变了的手机。
   */
  | { type: 'queue'; jobs: QueuePosition[] }
  /** 任务开始打印。 */
  | { type: 'started'; job: string }
  /** 任务的最终结果。 */
  | { type: 'result'; job: string; result: PhonePrintResult }
  /** 任务没被接受。 */
  | { type: 'refused'; job: string; reason: RefusalReason };

const INVALID_REASONS: readonly InvalidReason[] = ['INVALID_CONTENT', 'NO_MATCHING_RULE'];
const RECENT_STATES: readonly RecentPrint['state'][] = ['printing', 'printed'];
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/**
 * 设备描述里去掉的字符：控制字符（含换行，防止伪造日志行）、格式字符（含双向文字控制符，防止显示被反转）、
 * 行和段分隔符。
 */
const UNSAFE_LABEL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
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

/** 手机能不能把这段内容作为任务提交：不超过请求的长度上限。是否能打印由电脑判断。 */
export function isRequestRaw(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_REQUEST_RAW_LENGTH;
}

/** 按字符（码点）截断，不会把一个汉字或表情拆成半个。 */
export function clipText(text: string, maxCharacters: number): string {
  const characters = Array.from(text);
  return characters.length <= maxCharacters ? text : characters.slice(0, maxCharacters).join('');
}

/** 设备描述只用于显示：去掉不可见和会改变显示方向的字符，去掉首尾空白，截断。 */
export function cleanDeviceLabel(text: string): string {
  return clipText(text.replace(UNSAFE_LABEL_CHARACTERS, '').trim(), MAX_DEVICE_LENGTH);
}

export function parseDesktopFrame(text: string): DesktopFrame | null {
  const frame = parseRecord(text);
  switch (frame?.['t']) {
    case 'open': {
      const { v, session, secret } = frame;
      return isPositiveInteger(v) && isRandomId(session) && isRandomId(secret)
        ? { t: 'open', v, session, secret }
        : null;
    }
    case 'send': {
      const { phone } = frame;
      const body = readBody(frame['body']);
      return isRandomId(phone) && body ? { t: 'send', phone, body } : null;
    }
    case 'kick':
      return isRandomId(frame['phone']) ? { t: 'kick', phone: frame['phone'] } : null;
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
      return isRandomId(frame['phone']) ? { t: frame['t'], phone: frame['phone'] } : null;
    case 'recv': {
      const { phone } = frame;
      const body = readBody(frame['body']);
      return isRandomId(phone) && body ? { t: 'recv', phone, body } : null;
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
      return isPositiveInteger(v) && isRandomId(session) ? { t: 'join', v, session } : null;
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
      return { type: 'hello', token, device: cleanDeviceLabel(device) };
    }
    case 'submit': {
      const { nonce, seq, job, raw, force } = value;
      if (
        !isRandomId(nonce) ||
        !isPositiveInteger(seq) ||
        !isRandomId(job) ||
        !isRequestRaw(raw) ||
        typeof force !== 'boolean'
      ) {
        return null;
      }
      const image = value['image'] === undefined ? undefined : parsePhoneImage(value['image']);
      const moreImages = value['moreImages'] === undefined ? undefined : parseMoreImages(value['moreImages']);
      const fields = value['fields'] === undefined ? undefined : parseManualFields(value['fields']);
      if (image === null || moreImages === null || fields === null) {
        return null;
      }
      if (moreImages !== undefined && (image === undefined || !withinImageBudget([image, ...moreImages]))) {
        return null;
      }
      return {
        type: 'submit',
        nonce,
        seq,
        job,
        raw,
        force,
        ...(image === undefined ? {} : { image }),
        ...(moreImages === undefined ? {} : { moreImages }),
        ...(fields === undefined ? {} : { fields }),
      };
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
      const image = value['image'] === undefined ? undefined : readImageRequest(value['image']);
      if (!isRandomId(token) || !isRandomId(nonce) || !isStringOrNull(printer) || image === null) {
        return null;
      }
      return { type: 'welcome', token, nonce, printer, ...(image === undefined ? {} : { image }) };
    }
    case 'denied':
      return isOneOf(value['reason'], DENIAL_REASONS) ? { type: 'denied', reason: value['reason'] } : null;
    case 'printer': {
      const { printer } = value;
      const image = value['image'] === undefined ? undefined : readImageRequest(value['image']);
      if (!isStringOrNull(printer) || image === null) {
        return null;
      }
      return { type: 'printer', printer, ...(image === undefined ? {} : { image }) };
    }
    case 'accepted': {
      const position = readQueuePosition(value);
      return position ? { type: 'accepted', ...position } : null;
    }
    case 'queue': {
      const jobs = readQueue(value['jobs']);
      return jobs ? { type: 'queue', jobs } : null;
    }
    case 'started':
      return isRandomId(value['job']) ? { type: 'started', job: value['job'] } : null;
    case 'result': {
      const { job } = value;
      const result = readPrintResult(value['result']);
      return isRandomId(job) && result ? { type: 'result', job, result } : null;
    }
    case 'refused': {
      const { job, reason } = value;
      return isRandomId(job) && isOneOf(reason, REFUSAL_REASONS) ? { type: 'refused', job, reason } : null;
    }
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

function readPrintResult(value: unknown): PhonePrintResult | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['status']) {
    case 'printed': {
      const { ruleName } = value;
      const fields = readFields(value['fields']);
      return typeof ruleName === 'string' && fields ? { status: 'printed', ruleName, fields } : null;
    }
    case 'no-printer':
      return { status: 'no-printer' };
    case 'duplicate': {
      const recent = readRecent(value['recent']);
      const { windowMs } = value;
      return recent && isNonNegativeInteger(windowMs) ? { status: 'duplicate', recent, windowMs } : null;
    }
    case 'invalid':
      return isOneOf(value['reason'], INVALID_REASONS) ? { status: 'invalid', reason: value['reason'] } : null;
    case 'failed': {
      const { reason, detail, issue } = value;
      // 老电脑不发 field：按 null。
      const field = value['field'] ?? null;
      if (!isOneOf(reason, PRINT_FAILURE_REASONS) || !isStringOrNull(detail) || !isStringOrNull(field)) {
        return null;
      }
      if (issue !== null && !isOneOf(issue, PRINTER_ISSUES)) {
        return null;
      }
      return { status: 'failed', reason, detail, issue, field };
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

function readQueue(value: unknown): QueuePosition[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PENDING_JOBS) {
    return null;
  }
  const positions: QueuePosition[] = [];
  for (const item of value) {
    const position = readQueuePosition(item);
    if (!position) {
      return null;
    }
    positions.push(position);
  }
  return positions;
}

function readQueuePosition(value: unknown): QueuePosition | null {
  if (!isRecord(value)) {
    return null;
  }
  const { job, ahead } = value;
  return isRandomId(job) && isNonNegativeInteger(ahead) ? { job, ahead } : null;
}

function readRecent(value: unknown): RecentPrint | null {
  if (!isRecord(value) || !isOneOf(value['state'], RECENT_STATES) || !Number.isFinite(value['at'])) {
    return null;
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

/** 标准 base64 的 JPEG：以 FF D8 FF 开头（base64 后是 /9j/），解码后不超过 MAX_IMAGE_BYTES。 */
const JPEG_BASE64 = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/;
/** MAX_IMAGE_BYTES 换成 base64 的长度：一次扫码带的所有帧合起来按它检查。 */
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** 同一张标签接下来的几帧：数组，最多 MAX_LABEL_FRAMES - 1 张，每张都是合法的标签图。 */
export function parseMoreImages(value: unknown): PhoneImage[] | null {
  if (!Array.isArray(value) || value.length > MAX_LABEL_FRAMES - 1) {
    return null;
  }
  const images = value.map(parsePhoneImage);
  return images.every((image): image is PhoneImage => image !== null) ? images : null;
}

/** 一次扫码带的所有帧合起来不超过 MAX_IMAGE_BYTES（按 base64 长度算），消息和帧的上限因此不用变。 */
export function withinImageBudget(images: readonly PhoneImage[]): boolean {
  return images.reduce((total, image) => total + image.jpeg.length, 0) <= MAX_IMAGE_BASE64_LENGTH;
}

export function parsePhoneImage(value: unknown): PhoneImage | null {
  if (!isRecord(value) || !isRecord(value['code'])) {
    return null;
  }
  const { jpeg } = value;
  const { x, y, size } = value['code'];
  const isCoordinate = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_IMAGE_SIDE;
  if (
    typeof jpeg !== 'string' ||
    jpeg.length > MAX_IMAGE_BASE64_LENGTH ||
    jpeg.length % 4 !== 0 ||
    !JPEG_BASE64.test(jpeg) ||
    !isCoordinate(x) ||
    !isCoordinate(y) ||
    !isCoordinate(size) ||
    size <= 0
  ) {
    return null;
  }
  return { jpeg, code: { x, y, size } };
}

/** 手动输入的字段：名称按规则的字段名要求，值去掉首尾空白后 1–100 个字、不含控制字符，名称不重复。 */
export function parseManualFields(value: unknown): PhoneField[] | null {
  if (!Array.isArray(value) || value.length > MAX_MANUAL_FIELDS) {
    return null;
  }
  const fields: PhoneField[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const { name } = item;
    const text = item['value'];
    if (typeof name !== 'string' || !isValidFieldName(name) || typeof text !== 'string') {
      return null;
    }
    const trimmed = text.trim();
    if (
      trimmed === '' ||
      trimmed.length > MAX_MANUAL_VALUE_LENGTH ||
      /\p{Cc}/u.test(trimmed) ||
      fields.some((field) => field.name === name)
    ) {
      return null;
    }
    fields.push({ name, value: trimmed });
  }
  return fields;
}

function readImageRequest(value: unknown): ImageRequest | null {
  if (!isRecord(value) || !isRecord(value['area'])) {
    return null;
  }
  const { pixelsPerCode } = value;
  const frames = value['frames'] ?? 1;
  const { left, top, right, bottom } = value['area'];
  const inRange = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= IMAGE_AREA_EXTENT;
  if (
    !inRange(left) ||
    !inRange(top) ||
    !inRange(right) ||
    !inRange(bottom) ||
    left >= right ||
    top >= bottom ||
    !Number.isSafeInteger(pixelsPerCode) ||
    (pixelsPerCode as number) < PIXELS_PER_CODE_RANGE.min ||
    (pixelsPerCode as number) > PIXELS_PER_CODE_RANGE.max ||
    !Number.isSafeInteger(frames) ||
    (frames as number) < 1 ||
    (frames as number) > MAX_LABEL_FRAMES
  ) {
    return null;
  }
  return { area: { left, top, right, bottom }, pixelsPerCode: pixelsPerCode as number, frames: frames as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/** 协议版本、消息序号（本次连接内从 1 开始）。 */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** 排队位置、时长（毫秒）。 */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
