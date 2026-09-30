/**
 * 线上的编码：手机、电脑、中转服务之间的每一帧，和加密前的内层消息，都是 msgpack（WebSocket 二进制帧）。
 * 标签图是原始字节，不再两次 base64（JSON 里一次、加密后放进信封再一次），上传量约为原来的 56%。
 *
 * 收到的都不可信：解码时限制字符串、字节、数组、键值对的长度（在分配内存之前检查），不接受扩展类型，
 * __proto__ 这样的键由库拒绝；解不开一律返回 null。字段是否合法由 mobile-protocol.ts 的解析函数逐项检查。
 */
import { type DecoderOptions, decode, encode } from '@msgpack/msgpack';
import { MAX_FRAME_BYTES, MAX_REQUEST_RAW_LENGTH } from './mobile-protocol';

/** UTF-8 一个字符最多 4 字节。 */
const MAX_UTF8_BYTES_PER_CHARACTER = 4;

export const WIRE_LIMITS = {
  /** 最长的字符串是请求的原文。 */
  maxStrLength: MAX_REQUEST_RAW_LENGTH * MAX_UTF8_BYTES_PER_CHARACTER,
  /** 最长的字节是信封里的密文，不会超过一帧。 */
  maxBinLength: MAX_FRAME_BYTES,
  /** 最长的数组：排队位置、手动字段、结果里的字段（都在十几项以内）。 */
  maxArrayLength: 64,
  /** 字段最多的消息也只有十来个键。 */
  maxMapLength: 32,
  /** 协议里没有扩展类型（例如时间戳）：一律拒绝。 */
  maxExtLength: 0,
} as const satisfies DecoderOptions;

export function encodeWire(value: unknown): Uint8Array {
  return encode(value);
}

/** 解不开（不是恰好一个 msgpack 值、超过长度限制、有扩展类型或 __proto__ 键）时返回 null。 */
export function decodeWire(bytes: Uint8Array): unknown {
  try {
    return decode(bytes, WIRE_LIMITS);
  } catch {
    return null;
  }
}
