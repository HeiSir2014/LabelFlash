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
  MAX_IMAGE_BYTES,
  MAX_LABEL_FRAMES,
  MAX_MANUAL_FIELDS,
  MAX_MANUAL_VALUE_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_REQUEST_RAW_LENGTH,
  type PhoneMessage,
  parsePhoneMessage,
  parseRelayToDesktop,
} from './mobile-protocol';
import { decodeWire, encodeWire } from './wire';

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
    const flipped = new Uint8Array(body.ct);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(await openMessage(key, 'p2d', SESSION, { ...body, ct: flipped })).toBeNull();
  });

  test('fits the largest request in one frame', async () => {
    const key = await importSessionKey(randomKey());
    // 常用汉字按 UTF-8 是 3 个字节，是按 UTF-16 长度计的原文里最占字节的情况。
    const raw = '\u4e00'.repeat(MAX_REQUEST_RAW_LENGTH);
    // 满额的几帧图，每帧 MAX_IMAGE_BYTES。
    const jpeg = new Uint8Array(MAX_IMAGE_BYTES);
    jpeg.set([0xff, 0xd8, 0xff]);
    const fields = Array.from({ length: MAX_MANUAL_FIELDS }, (_, i) => ({
      name: `${String.fromCharCode(0x4e00 + i)}`.repeat(20),
      value: '\u4e00'.repeat(MAX_MANUAL_VALUE_LENGTH),
    }));
    const message: PhoneMessage = {
      type: 'submit',
      nonce: randomId(),
      seq: 1,
      job: randomId(),
      raw,
      force: false,
      images: Array.from({ length: MAX_LABEL_FRAMES }, () => ({ jpeg, code: { x: 325.5, y: 195.25, size: 130 } })),
      fields,
    };
    expect(parsePhoneMessage(message)).not.toBeNull();
    const body = await sealMessage(key, 'p2d', SESSION, message);
    const frame = encodeWire({ t: 'recv', phone: randomId(), body });
    expect(frame.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    // 中转服务和电脑按线上的长度限制解得开这一帧。
    expect(parseRelayToDesktop(decodeWire(frame))).not.toBeNull();
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
