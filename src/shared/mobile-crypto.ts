/**
 * 手机与电脑之间的端到端加密：AES-256-GCM。
 *
 * 密钥只在二维码链接的 # 部分里，中转服务拿不到，所以它只能转发、看不到扫码内容和打印结果。
 * 明文是 msgpack（见 wire.ts），密文和 IV 是原始字节，放进同样是 msgpack 的信封。
 * 只用 globalThis.crypto（WebCrypto）：浏览器、Bun 和 Electron 主进程（Node 24）都有，这个文件三方共用。
 */
import {
  ID_BYTES,
  IV_BYTES,
  KEY_BYTES,
  MAX_MESSAGE_BYTES,
  MOBILE_PROTOCOL_VERSION,
  type SealedBody,
} from './mobile-protocol';
import { decodeWire, encodeWire } from './wire';

/** p2d = 手机发给电脑，d2p = 电脑发给手机。写进附加数据，一个方向的消息不能被反射回去。 */
export type Direction = 'p2d' | 'd2p';

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const textEncoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(text)) {
    return null;
  }
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function randomId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

export function randomKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** 导入为不可导出的密钥，只能用来加解密。 */
export async function importSessionKey(key: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(key);
  if (bytes === null || bytes.length !== KEY_BYTES) {
    throw new Error(`会话密钥格式不对：需要 ${KEY_BYTES} 字节的 base64url`);
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 明文超过 MAX_MESSAGE_BYTES 时抛错：发出去也会因为帧太大被中转服务断开，不如在这里就暴露出来。 */
export async function sealMessage(
  key: CryptoKey,
  direction: Direction,
  session: string,
  message: unknown,
): Promise<SealedBody> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = encodeWire(message);
  if (plain.length > MAX_MESSAGE_BYTES) {
    throw new Error(`消息有 ${plain.length} 字节，超过上限 ${MAX_MESSAGE_BYTES}`);
  }
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(direction, session) },
    key,
    toBuffer(plain),
  );
  return { iv, ct: new Uint8Array(sealed) };
}

/** 解不开（密钥、方向、会话不对，或被篡改）时返回 null，由调用方决定是否记日志。 */
export async function openMessage(
  key: CryptoKey,
  direction: Direction,
  session: string,
  body: SealedBody,
): Promise<unknown | null> {
  if (body.iv.length !== IV_BYTES) {
    return null;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(body.iv), additionalData: additionalData(direction, session) },
      key,
      toBuffer(body.ct),
    );
    return decodeWire(new Uint8Array(plain));
  } catch {
    return null;
  }
}

/** WebCrypto 只收以 ArrayBuffer 为底的视图：msgpack 解出来的字节是大缓冲区里的一段，复制出来。 */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function additionalData(direction: Direction, session: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(`labelflash/${MOBILE_PROTOCOL_VERSION}/${direction}/${session}`);
}
