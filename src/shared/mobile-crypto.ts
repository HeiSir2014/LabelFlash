/**
 * 手机与电脑之间的端到端加密：AES-256-GCM。
 *
 * 密钥只在二维码链接的 # 部分里，中转服务拿不到，所以它只能转发、看不到扫码内容和打印结果。
 * 只用 globalThis.crypto（WebCrypto）：浏览器、Bun 和 Electron 主进程（Node 24）都有，这个文件三方共用。
 */
import { ID_BYTES, IV_BYTES, KEY_BYTES, MOBILE_PROTOCOL_VERSION, type SealedBody } from './mobile-protocol';

/** p2d = 手机发给电脑，d2p = 电脑发给手机。写进附加数据，一个方向的消息不能被反射回去。 */
export type Direction = 'p2d' | 'd2p';

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
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

export async function sealMessage(
  key: CryptoKey,
  direction: Direction,
  session: string,
  message: unknown,
): Promise<SealedBody> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = textEncoder.encode(JSON.stringify(message));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(direction, session) },
    key,
    plain,
  );
  return { iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(sealed)) };
}

/** 解不开（密钥、方向、会话不对，或被篡改）时返回 null，由调用方决定是否记日志。 */
export async function openMessage(
  key: CryptoKey,
  direction: Direction,
  session: string,
  body: SealedBody,
): Promise<unknown | null> {
  const iv = fromBase64Url(body.iv);
  const cipherText = fromBase64Url(body.ct);
  if (iv === null || iv.length !== IV_BYTES || cipherText === null) {
    return null;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(direction, session) },
      key,
      cipherText,
    );
    return JSON.parse(textDecoder.decode(plain));
  } catch {
    return null;
  }
}

function additionalData(direction: Direction, session: string): Uint8Array {
  return textEncoder.encode(`labelflash/${MOBILE_PROTOCOL_VERSION}/${direction}/${session}`);
}
