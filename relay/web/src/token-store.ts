/**
 * 手机的令牌按会话保存：刷新页面、断线重连后，电脑凭它认出还是这部手机。
 * 无痕模式或禁用存储时 localStorage 可能抛错，这时退回内存：本页有效，刷新后需要在电脑上重新开始。
 */
import { isRandomId } from '../../../src/shared/mobile-protocol';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TokenStore {
  get(session: string): string | null;
  set(session: string, token: string): void;
}

const KEY_PREFIX = 'labelflash.token.';

export function createTokenStore(storage: KeyValueStorage | null): TokenStore {
  const memory = new Map<string, string>();
  return {
    get(session) {
      const remembered = memory.get(session);
      if (remembered) {
        return remembered;
      }
      try {
        const stored = storage?.getItem(KEY_PREFIX + session) ?? null;
        return isRandomId(stored) ? stored : null;
      } catch {
        return null;
      }
    },
    set(session, token) {
      memory.set(session, token);
      try {
        storage?.setItem(KEY_PREFIX + session, token);
      } catch {
        // 存不进去也没关系：内存里有，本页继续可用。
      }
    },
  };
}
