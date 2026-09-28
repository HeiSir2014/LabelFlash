import { describe, expect, test } from 'bun:test';
import {
  fromBase64Url,
  importSessionKey,
  openMessage,
  randomId,
  randomKey,
  sealMessage,
  toBase64Url,
} from './mobile-crypto';
import {
  isRandomId,
  isSessionKey,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_REQUEST_RAW_LENGTH,
  type PhoneMessage,
} from './mobile-protocol';

const SESSION = randomId();
const MESSAGE = { type: 'preview', nonce: randomId(), id: 1, raw: 'CL5640-TK-图片色-XL' };

describe('random ids and keys', () => {
  test('produces well-formed, distinct ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(isRandomId(id)).toBe(true);
    }
  });

  test('produces a well-formed key', () => {
    expect(isSessionKey(randomKey())).toBe(true);
  });
});

describe('base64url', () => {
  test('round-trips every byte value without padding or unsafe characters', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  test('rejects text that is not base64url', () => {
    expect(fromBase64Url('a+b/')).toBeNull();
  });
});

describe('sealMessage / openMessage', () => {
  test('round-trips a message with Chinese text', async () => {
    const key = await importSessionKey(randomKey());
    const body = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    expect(await openMessage(key, 'p2d', SESSION, body)).toEqual(MESSAGE);
  });

  test('uses a fresh iv for every message', async () => {
    const key = await importSessionKey(randomKey());
    const first = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    const second = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    expect(first.iv).not.toBe(second.iv);
  });

  test('refuses a message reflected back in the other direction', async () => {
    const key = await importSessionKey(randomKey());
    const body = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    expect(await openMessage(key, 'd2p', SESSION, body)).toBeNull();
  });

  test('refuses a message moved to another session', async () => {
    const key = await importSessionKey(randomKey());
    const body = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    expect(await openMessage(key, 'p2d', randomId(), body)).toBeNull();
  });

  test('refuses a message sealed with another key', async () => {
    const body = await sealMessage(await importSessionKey(randomKey()), 'p2d', SESSION, MESSAGE);
    expect(await openMessage(await importSessionKey(randomKey()), 'p2d', SESSION, body)).toBeNull();
  });

  test('refuses a tampered cipher text', async () => {
    const key = await importSessionKey(randomKey());
    const body = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    const flipped = body.ct.startsWith('A') ? `B${body.ct.slice(1)}` : `A${body.ct.slice(1)}`;
    expect(await openMessage(key, 'p2d', SESSION, { ...body, ct: flipped })).toBeNull();
  });

  test('fits the largest request in one frame', async () => {
    const key = await importSessionKey(randomKey());
    // 控制字符在 JSON 里转义成 \u0001 这样的 6 个字节，是最坏情况。
    const raw = String.fromCharCode(1).repeat(MAX_REQUEST_RAW_LENGTH);
    const message: PhoneMessage = { type: 'submit', nonce: randomId(), seq: 1, job: randomId(), raw, force: false };
    const body = await sealMessage(key, 'p2d', SESSION, message);
    const frame = JSON.stringify({ t: 'recv', phone: randomId(), body });
    expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  test('refuses to seal a message beyond the size limit', async () => {
    const key = await importSessionKey(randomKey());
    const huge = { raw: 'x'.repeat(MAX_MESSAGE_BYTES) };
    await expect(sealMessage(key, 'p2d', SESSION, huge)).rejects.toThrow('超过上限');
  });

  test('refuses an iv of the wrong length', async () => {
    const key = await importSessionKey(randomKey());
    const body = await sealMessage(key, 'p2d', SESSION, MESSAGE);
    expect(await openMessage(key, 'p2d', SESSION, { ...body, iv: body.iv.slice(4) })).toBeNull();
  });
});
