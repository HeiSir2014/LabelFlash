import { describe, expect, test } from 'bun:test';
import { systemClock } from '../../core/types';
import { openDatabase } from './database';
import { type SecretCipher, SecretError, SqliteSecretStore } from './sqlite-secret-store';

/** 测试用的可逆「加密」：足以验证存进库里的不是明文。 */
function fakeCipher(isAvailable = true): SecretCipher {
  return {
    isAvailable: () => isAvailable,
    encrypt: (plain) => new TextEncoder().encode([...plain].reverse().join('')),
    decrypt: (data) => [...new TextDecoder().decode(data)].reverse().join(''),
  };
}

function createStore(cipher = fakeCipher()) {
  const db = openDatabase(':memory:');
  return { db, store: new SqliteSecretStore(db, cipher, systemClock) };
}

describe('SqliteSecretStore', () => {
  test('stores encrypted values and lists names only', () => {
    const { db, store } = createStore();
    store.set('仓库接口', 'token-123');
    store.set('群机器人', 'abc');
    expect(store.names()).toEqual(['仓库接口', '群机器人']);
    expect(store.get('仓库接口')).toBe('token-123');
    const stored = db.prepare('SELECT value FROM secrets WHERE name = :name').get({ name: '仓库接口' })?.['value'];
    expect(new TextDecoder().decode(stored as Uint8Array)).not.toContain('token-123');
  });

  test('replaces and removes a secret', () => {
    const { store } = createStore();
    store.set('a', '1');
    store.set('a', '2');
    expect(store.get('a')).toBe('2');
    store.remove('a');
    expect(store.get('a')).toBeNull();
    expect(store.names()).toEqual([]);
  });

  test('rejects bad names and values, and refuses to store without system encryption', () => {
    const { store } = createStore();
    expect(() => store.set('{x}', 'v')).toThrow(SecretError);
    expect(() => store.set('a', 'line\nbreak')).toThrow(SecretError);
    expect(() => store.set('a', '')).toThrow(SecretError);
    expect(() => createStore(fakeCipher(false)).store.set('a', 'v')).toThrow('系统加密不可用');
  });

  test('treats a value that cannot be decrypted as missing', () => {
    const { store } = createStore({
      ...fakeCipher(),
      decrypt: () => {
        throw new Error('wrong machine');
      },
    });
    store.set('a', 'v');
    expect(store.get('a')).toBeNull();
  });
});
