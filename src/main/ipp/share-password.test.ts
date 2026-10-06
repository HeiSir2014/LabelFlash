import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { parseBasicAuth, SharePassword, type SharePasswordStore, type StoredPassword } from './share-password';

class MemoryStore implements SharePasswordStore {
  stored: StoredPassword | null = null;

  readPassword(): StoredPassword | null {
    return this.stored;
  }

  writePassword(password: StoredPassword): void {
    this.stored = password;
  }

  clearPassword(): void {
    this.stored = null;
  }
}

describe('SharePassword', () => {
  test('keeps only a salted digest and checks passwords against it', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    expect(password.isSet()).toBe(false);
    await password.set('前台1234');
    expect(password.isSet()).toBe(true);
    expect(Buffer.from(store.stored?.hash ?? []).toString('utf8')).not.toContain('前台1234');
    expect(Buffer.from(store.stored?.hash ?? []).includes(Buffer.from('前台1234'))).toBe(false);
    expect(await password.verify('前台1234')).toBe(true);
    expect(await password.verify('前台12345')).toBe(false);
  });

  test('uses a new salt every time', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    await password.set('1234');
    const first = store.stored;
    await password.set('1234');
    expect(store.stored?.salt).not.toEqual(first?.salt);
  });

  test('refuses an invalid password and forgets a cleared one', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    await expect(password.set('12')).rejects.toThrow('Invalid share password');
    await password.set('1234');
    password.clear();
    expect(password.isSet()).toBe(false);
    expect(await password.verify('1234')).toBe(false);
  });

  // 对方交来的密码长度不受控：超长的不算 scrypt，直接按错处理。
  test('refuses an overlong candidate without deriving it', async () => {
    const store = new MemoryStore();
    const password = new SharePassword(store, new FakeClock());
    await password.set('1234');
    expect(await password.verify('1'.repeat(10_000))).toBe(false);
  });
});

describe('parseBasicAuth', () => {
  test('reads the user and the password after the first colon', () => {
    const header = `Basic ${Buffer.from('zhang:a:b').toString('base64')}`;
    expect(parseBasicAuth(header)).toEqual({ user: 'zhang', password: 'a:b' });
    expect(parseBasicAuth(`basic ${Buffer.from(':1234').toString('base64')}`)).toEqual({ user: '', password: '1234' });
  });

  test('returns null for other schemes or malformed values', () => {
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth('Bearer x')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('no-colon').toString('base64')}`)).toBeNull();
  });
});
