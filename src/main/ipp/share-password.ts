import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../core/types';
import { isValidSharePassword, SHARE_PASSWORD_LENGTH } from '../../shared/ipp-sharing';

/** scrypt 的代价参数 N = 2^14（Node 的默认值）：一次约 50ms，添加打印机感觉不到，局域网里猜密码猜不快。 */
const SCRYPT_COST = 16_384;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const BASIC_PREFIX = 'basic ';
/** UTF-8 一个字最多 4 字节：比最长的合法密码还长的，不算摘要直接按错处理（不让对方拿超长输入耗 CPU）。 */
const MAX_CANDIDATE_BYTES = SHARE_PASSWORD_LENGTH.max * 4;

/** 存下来的只有盐和摘要，没有原文。 */
export interface StoredPassword {
  salt: Uint8Array;
  hash: Uint8Array;
}

/** 共享密码存在哪里（SqliteIppStore 实现）。 */
export interface SharePasswordStore {
  readPassword(): StoredPassword | null;
  writePassword(password: StoredPassword, at: number): void;
  clearPassword(): void;
}

/**
 * 同时最多算 2 个摘要：scrypt 在 libuv 线程池里跑（默认 4 个线程），局域网里几台电脑一起猜也占不满它，
 * 文件读写、DNS 这些同样用线程池的事不会被拖住。正常使用（偶尔有电脑第一次带密码来）远碰不到。
 */
export const MAX_PARALLEL_DERIVATIONS = 2;

/** 按密码和盐算摘要；测试里换成假的。 */
export type DeriveKey = (password: string, salt: Uint8Array) => Promise<Uint8Array>;

function scryptKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, { N: SCRYPT_COST }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

/**
 * 共享密码：只存 scrypt 摘要（校验只需要比对，不需要取回原文）。原文只在设置时经过一次，不写日志。
 * 局域网里的电脑按 HTTP 基本认证交来，用户名不核对（共享只有一个密码）。
 */
export class SharePassword {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly store: SharePasswordStore,
    private readonly clock: Clock,
    private readonly deriveKey: DeriveKey = scryptKey,
  ) {}

  isSet(): boolean {
    return this.store.readPassword() !== null;
  }

  /** @throws Error 密码不合规则（界面会先拦下，到这里说明页面出了问题）；错误信息里不带密码 */
  async set(password: string): Promise<void> {
    if (!isValidSharePassword(password)) {
      throw new Error('Invalid share password');
    }
    const salt = randomBytes(SALT_BYTES);
    this.store.writePassword({ salt, hash: await this.derive(password, salt) }, this.clock.now());
  }

  clear(): void {
    this.store.clearPassword();
  }

  /** 没设密码时返回 false（调用方只在设了密码时才校验）。比较用 timingSafeEqual，不按耗时泄露信息。 */
  async verify(password: string): Promise<boolean> {
    const stored = this.store.readPassword();
    if (stored === null || Buffer.byteLength(password, 'utf8') > MAX_CANDIDATE_BYTES) {
      return false;
    }
    const key = await this.derive(password, stored.salt);
    return key.length === stored.hash.length && timingSafeEqual(key, stored.hash);
  }

  /** 排队算摘要：同时最多 MAX_PARALLEL_DERIVATIONS 个。 */
  private async derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
    if (this.running >= MAX_PARALLEL_DERIVATIONS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await this.deriveKey(password, salt);
    } finally {
      const next = this.waiting.shift();
      if (next) {
        // 名额直接交给排队的下一个，running 不变。
        next();
      } else {
        this.running -= 1;
      }
    }
  }
}

/** Authorization: Basic base64(用户名:密码)；不是基本认证或格式不对返回 null。 */
export function parseBasicAuth(header: string | undefined): { user: string; password: string } | null {
  if (header === undefined || header.slice(0, BASIC_PREFIX.length).toLowerCase() !== BASIC_PREFIX) {
    return null;
  }
  const decoded = Buffer.from(header.slice(BASIC_PREFIX.length).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon < 0 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
