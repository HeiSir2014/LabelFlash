import { describe, expect, test } from 'bun:test';
import { hashApiKey } from './api-keys';
import { Authenticator, type AuthRequest } from './authenticator';

const KEY = 'lf_test';
const PORT = 17631;
const SITE = 'https://erp.example.com';

function createAuth(options: { origins?: string[]; hasKeys?: boolean; answer?: 'pending' | 'denied' | 'busy' } = {}) {
  const prompts: string[] = [];
  const touched: string[] = [];
  const auth = new Authenticator({
    findKeyByHash: (hash) => (hash === hashApiKey(KEY) ? { id: 'k1', name: 'ERP' } : null),
    hasAnyKey: () => options.hasKeys ?? true,
    isOriginAuthorized: (origin) => (options.origins ?? []).includes(origin),
    requestOrigin: (origin) => {
      prompts.push(origin);
      return options.answer ?? 'pending';
    },
    touchKey: (id) => touched.push(id),
  });
  return { auth, prompts, touched };
}

const local = (headers: AuthRequest['headers']): AuthRequest => ({ remoteAddress: '127.0.0.1', port: PORT, headers });
const lan = (headers: AuthRequest['headers']): AuthRequest => ({ remoteAddress: '192.168.1.30', port: PORT, headers });

describe('Authenticator', () => {
  test('accepts a valid key from anywhere and notes that it was used', () => {
    const { auth, touched } = createAuth();
    expect(auth.authenticate(lan({ authorization: `Bearer ${KEY}` }))).toEqual({ id: 'key:k1', label: 'ERP' });
    expect(touched).toEqual(['k1']);
  });

  // 带有效密钥的程序可以用机器名访问：不核对 Host。
  test('does not check the Host of a request with a key', () => {
    const { auth } = createAuth();
    expect(auth.authenticate(local({ authorization: `Bearer ${KEY}`, host: 'shop-pc:17631', origin: SITE }))).toEqual({
      id: 'key:k1',
      label: 'ERP',
    });
  });

  test('rejects a wrong key', () => {
    const { auth } = createAuth();
    expect(() => auth.authenticate(local({ authorization: 'Bearer lf_wrong' }))).toThrow(
      expect.objectContaining({ status: 'UNAUTHENTICATED', reason: 'KEY_INVALID' }),
    );
  });

  test('accepts an authorized website on loopback with a loopback Host', () => {
    const { auth } = createAuth({ origins: [SITE] });
    expect(auth.authenticate(local({ origin: SITE, host: `127.0.0.1:${PORT}` }))).toEqual({
      id: `origin:${SITE}`,
      label: SITE,
    });
  });

  test('asks the user about an unknown website and refuses for now', () => {
    const { auth, prompts } = createAuth();
    expect(() => auth.authenticate(local({ origin: 'https://new.example.com', host: `127.0.0.1:${PORT}` }))).toThrow(
      expect.objectContaining({ status: 'PERMISSION_DENIED', reason: 'ORIGIN_NOT_AUTHORIZED' }),
    );
    expect(prompts).toEqual(['https://new.example.com']);
  });

  // 被拒绝的网站要能分清「等确认」和「已被拒绝」，不然网页会一直让用户去电脑上点允许。
  test('tells a refused website that it was refused', () => {
    const { auth } = createAuth({ answer: 'denied' });
    expect(() => auth.authenticate(local({ origin: 'https://new.example.com', host: `127.0.0.1:${PORT}` }))).toThrow(
      expect.objectContaining({ status: 'PERMISSION_DENIED', reason: 'ORIGIN_DENIED' }),
    );
  });

  test('refuses a page without a web origin without asking', () => {
    const { auth, prompts } = createAuth();
    expect(() => auth.authenticate(local({ origin: 'null', host: `127.0.0.1:${PORT}` }))).toThrow(
      expect.objectContaining({ status: 'PERMISSION_DENIED', reason: 'ORIGIN_UNSUPPORTED' }),
    );
    expect(prompts).toEqual([]);
  });

  test('refuses a browser request with a foreign Host (DNS rebinding)', () => {
    const { auth, prompts } = createAuth({ origins: [SITE] });
    expect(() => auth.authenticate(local({ origin: SITE, host: `rebind.example.com:${PORT}` }))).toThrow(
      expect.objectContaining({ reason: 'HOST_NOT_ALLOWED' }),
    );
    expect(prompts).toEqual([]);
  });

  test('never accepts a website from the LAN, and asks for a key there', () => {
    const { auth } = createAuth({ origins: [SITE] });
    expect(() => auth.authenticate(lan({ origin: SITE, host: `192.168.1.20:${PORT}` }))).toThrow(
      expect.objectContaining({ reason: 'KEY_REQUIRED' }),
    );
  });

  test('asks local programs without an origin for a key', () => {
    const { auth } = createAuth();
    expect(() => auth.authenticate(local({}))).toThrow(expect.objectContaining({ reason: 'KEY_REQUIRED' }));
  });

  test('explains that a key must be created first when there is none', () => {
    const { auth } = createAuth({ hasKeys: false });
    expect(() => auth.authenticate(lan({}))).toThrow(expect.objectContaining({ reason: 'NO_KEYS_YET' }));
  });
});
