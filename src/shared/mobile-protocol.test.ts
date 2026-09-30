import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import {
  buildPhoneUrl,
  clipText,
  type DesktopFrame,
  type DesktopMessage,
  isRequestRaw,
  MAX_DEVICE_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_LABEL_FRAMES,
  MAX_MANUAL_FIELDS,
  MAX_MANUAL_VALUE_LENGTH,
  MAX_PENDING_JOBS,
  MAX_REQUEST_RAW_LENGTH,
  MOBILE_PROTOCOL_VERSION,
  type PhoneMessage,
  type PhonePrintResult,
  parseDesktopFrame,
  parseDesktopMessage,
  parsePhoneFragment,
  parsePhoneFrame,
  parsePhoneMessage,
  parseRelayToDesktop,
  parseRelayToPhone,
  type RelayToDesktop,
  type RelayToPhone,
} from './mobile-protocol';
import { decodeWire, encodeWire } from './wire';

const SESSION = 'AbCdEfGhIjKlMnOpQrSt_-';
const SECRET = 'zyxwvutsrqponmlkjihg01';
const KEY = 'K'.repeat(43);
const JOB = 'JobJobJobJobJobJobJob0';
const OTHER_JOB = 'JobJobJobJobJobJobJob1';
/** 中转服务分配的连接号也是 16 字节随机数。 */
const PHONE = 'PhonePhonePhonePhone01';
const BODY = { iv: new Uint8Array(12).fill(1), ct: new Uint8Array([2, 3, 4]) };

/** 经过真实的线上编码再解析：测的是 msgpack 和解析函数合起来的结果。 */
const wire = (value: unknown) => decodeWire(encodeWire(value));

describe('parseDesktopFrame', () => {
  test('accepts an open frame', () => {
    const frame: DesktopFrame = { t: 'open', v: MOBILE_PROTOCOL_VERSION, session: SESSION, secret: SECRET };
    expect(parseDesktopFrame(wire(frame))).toEqual(frame);
  });

  test('rejects an open frame with a malformed session id', () => {
    expect(parseDesktopFrame(wire({ t: 'open', v: 1, session: 'short', secret: SECRET }))).toBeNull();
    expect(parseDesktopFrame(wire({ t: 'open', v: 1, session: `${SESSION.slice(1)}+`, secret: SECRET }))).toBeNull();
  });

  test('rejects an open frame without a secret or with a fractional version', () => {
    expect(parseDesktopFrame(wire({ t: 'open', v: 1, session: SESSION }))).toBeNull();
    expect(parseDesktopFrame(wire({ t: 'open', v: 1.5, session: SESSION, secret: SECRET }))).toBeNull();
  });

  test('accepts send, kick, close and ping', () => {
    expect(parseDesktopFrame(wire({ t: 'send', phone: PHONE, body: BODY }))).toEqual({
      t: 'send',
      phone: PHONE,
      body: BODY,
    });
    expect(parseDesktopFrame(wire({ t: 'kick', phone: PHONE }))).toEqual({ t: 'kick', phone: PHONE });
    expect(parseDesktopFrame(wire({ t: 'close', reason: 'idle' }))).toEqual({ t: 'close', reason: 'idle' });
    expect(parseDesktopFrame(wire({ t: 'ping' }))).toEqual({ t: 'ping' });
  });

  test('rejects a phone id that the relay could not have assigned', () => {
    expect(parseDesktopFrame(wire({ t: 'kick', phone: 'p1' }))).toBeNull();
  });

  test('rejects a close frame with an unknown reason', () => {
    expect(parseDesktopFrame(wire({ t: 'close', reason: 'desktop-gone' }))).toBeNull();
  });

  test('drops fields that are not part of the frame', () => {
    expect(parseDesktopFrame(wire({ t: 'kick', phone: PHONE, extra: 1 }))).toEqual({ t: 'kick', phone: PHONE });
  });

  test('rejects unknown types, bytes that are not msgpack, arrays, bytes and null', () => {
    expect(parseDesktopFrame(wire({ t: 'shout' }))).toBeNull();
    expect(parseDesktopFrame(decodeWire(new Uint8Array([0xc1])))).toBeNull();
    expect(parseDesktopFrame(wire([]))).toBeNull();
    expect(parseDesktopFrame(wire(new Uint8Array([1])))).toBeNull();
    expect(parseDesktopFrame(wire(null))).toBeNull();
  });

  // 协议 1 的 JSON 文本不再认：中转服务在 server.ts 里就回 version 错误断开了。
  test('rejects a frame that is still JSON text', () => {
    expect(parseDesktopFrame(JSON.stringify({ t: 'ping' }))).toBeNull();
  });
});

describe('parsePhoneFrame', () => {
  test('accepts join, send and ping', () => {
    expect(parsePhoneFrame(wire({ t: 'join', v: 1, session: SESSION }))).toEqual({ t: 'join', v: 1, session: SESSION });
    expect(parsePhoneFrame(wire({ t: 'send', body: BODY }))).toEqual({ t: 'send', body: BODY });
    expect(parsePhoneFrame(wire({ t: 'ping' }))).toEqual({ t: 'ping' });
  });

  test('rejects a body whose iv is not 12 bytes or whose cipher text is not bytes', () => {
    expect(parsePhoneFrame(wire({ t: 'send', body: { iv: new Uint8Array(11), ct: BODY.ct } }))).toBeNull();
    expect(parsePhoneFrame(wire({ t: 'send', body: { iv: 'aaaaaaaaaaaaaaaa', ct: BODY.ct } }))).toBeNull();
    expect(parsePhoneFrame(wire({ t: 'send', body: { iv: BODY.iv, ct: 'bbbb' } }))).toBeNull();
    expect(parsePhoneFrame(wire({ t: 'send', body: { iv: BODY.iv, ct: new Uint8Array(0) } }))).toBeNull();
  });
});

describe('parseRelayToDesktop', () => {
  test('accepts every relay message', () => {
    const frames: RelayToDesktop[] = [
      { t: 'opened' },
      { t: 'joined', phone: PHONE },
      { t: 'left', phone: PHONE },
      { t: 'recv', phone: PHONE, body: BODY },
      { t: 'pong' },
      { t: 'error', code: 'session-taken' },
    ];
    for (const frame of frames) {
      expect(parseRelayToDesktop(wire(frame))).toEqual(frame);
    }
  });

  test('rejects an unknown error code', () => {
    expect(parseRelayToDesktop(wire({ t: 'error', code: 'oops' }))).toBeNull();
  });
});

describe('parseRelayToPhone', () => {
  test('accepts every relay message', () => {
    const frames: RelayToPhone[] = [
      { t: 'online' },
      { t: 'waiting' },
      { t: 'recv', body: BODY },
      { t: 'ended', reason: 'desktop-gone' },
      { t: 'not-found' },
      { t: 'kicked' },
      { t: 'pong' },
      { t: 'error', code: 'rate-limited' },
    ];
    for (const frame of frames) {
      expect(parseRelayToPhone(wire(frame))).toEqual(frame);
    }
  });

  test('rejects an unknown end reason', () => {
    expect(parseRelayToPhone(wire({ t: 'ended', reason: 'bored' }))).toBeNull();
  });
});

describe('parsePhoneMessage', () => {
  test('accepts a first hello without a token', () => {
    expect(parsePhoneMessage({ type: 'hello', token: null, device: 'iPhone · 微信' })).toEqual({
      type: 'hello',
      token: null,
      device: 'iPhone · 微信',
    });
  });

  test('truncates a long device label instead of rejecting the hello', () => {
    const message = parsePhoneMessage({ type: 'hello', token: SECRET, device: 'x'.repeat(100) });
    expect(message).toEqual({ type: 'hello', token: SECRET, device: 'x'.repeat(MAX_DEVICE_LENGTH) });
  });

  test('strips line breaks and direction overrides from the device label', () => {
    const newline = String.fromCharCode(0x0a);
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    const device = ` iPhone${newline}2026-09-29 forged log line ${rightToLeftOverride}微信 `;
    expect(parsePhoneMessage({ type: 'hello', token: null, device })).toEqual({
      type: 'hello',
      token: null,
      device: 'iPhone2026-09-29 forged log line 微信',
    });
  });

  test('rejects a hello with a malformed token', () => {
    expect(parsePhoneMessage({ type: 'hello', token: 'abc', device: 'x' })).toBeNull();
  });

  const submit: PhoneMessage = {
    type: 'submit',
    nonce: SECRET,
    seq: 1,
    job: JOB,
    raw: 'CL5640-TK-图片色-XL',
    force: false,
    images: [],
    fields: [],
  };

  test('accepts a job submission', () => {
    expect(parsePhoneMessage(submit)).toEqual(submit);
  });

  test('rejects sequence numbers that are not positive safe integers', () => {
    for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(parsePhoneMessage({ ...submit, seq })).toBeNull();
    }
  });

  test('rejects a malformed job id', () => {
    expect(parsePhoneMessage({ ...submit, job: 'job-1' })).toBeNull();
  });

  test('rejects raw content that is far beyond what printing accepts', () => {
    expect(parsePhoneMessage({ ...submit, raw: 'x'.repeat(MAX_RAW_LENGTH * 4 + 1) })).toBeNull();
  });

  /** 标签图是 JPEG 原始字节（FF D8 FF 开头）。 */
  const image = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), code: { x: 325, y: 195, size: 130 } };

  test('accepts a submission with the label frames and typed fields', () => {
    const message = { ...submit, images: [image, image], fields: [{ name: '货架号', value: ' A-1-2-3 ' }] };
    expect(parsePhoneMessage(wire(message))).toEqual({ ...message, fields: [{ name: '货架号', value: 'A-1-2-3' }] });
  });

  // 每一帧各自最多 MAX_IMAGE_BYTES，最多 MAX_LABEL_FRAMES 帧（几帧合起来可以超过一帧的上限）。
  test('accepts every frame up to the per-frame limit', () => {
    const full = { ...image, jpeg: new Uint8Array(MAX_IMAGE_BYTES) };
    full.jpeg.set(image.jpeg);
    const frames = Array.from({ length: MAX_LABEL_FRAMES }, () => full);
    expect(parsePhoneMessage({ ...submit, images: frames })).toEqual({ ...submit, images: frames });
  });

  test('rejects a frame that is not a JPEG, too large or placed nowhere, and too many frames', () => {
    const tooLarge = new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff);
    for (const bad of [
      { ...image, jpeg: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      { ...image, jpeg: '/9j/4AAQSkZJRgABAQ==' },
      { ...image, jpeg: tooLarge },
      { ...image, code: { x: 1, y: 1, size: 0 } },
      { ...image, code: { x: Number.NaN, y: 1, size: 10 } },
      { jpeg: image.jpeg },
    ]) {
      expect(parsePhoneMessage({ ...submit, images: [bad] })).toBeNull();
    }
    const tooMany = Array.from({ length: MAX_LABEL_FRAMES + 1 }, () => image);
    expect(parsePhoneMessage({ ...submit, images: tooMany })).toBeNull();
    expect(parsePhoneMessage({ ...submit, images: image })).toBeNull();
  });

  test('rejects a submission without its image and field lists', () => {
    const { images: _images, ...withoutImages } = submit as Extract<PhoneMessage, { type: 'submit' }>;
    expect(parsePhoneMessage(withoutImages)).toBeNull();
    const { fields: _fields, ...withoutFields } = submit as Extract<PhoneMessage, { type: 'submit' }>;
    expect(parsePhoneMessage(withoutFields)).toBeNull();
  });

  test('rejects typed fields with bad names, empty or long values, control characters or duplicates', () => {
    const field = { name: '货架号', value: 'A-1-2-3' };
    for (const fields of [
      [{ ...field, name: '{货架号}' }],
      [{ ...field, value: '  ' }],
      [{ ...field, value: 'x'.repeat(MAX_MANUAL_VALUE_LENGTH + 1) }],
      [{ ...field, value: 'A\n1' }],
      [field, field],
      Array.from({ length: MAX_MANUAL_FIELDS + 1 }, (_, i) => ({ name: `字段${i}`, value: 'x' })),
      'A-1-2-3',
    ]) {
      expect(parsePhoneMessage({ ...submit, fields })).toBeNull();
    }
  });

  test('rejects a submission without a boolean force flag', () => {
    expect(parsePhoneMessage({ ...submit, force: 'yes' })).toBeNull();
    const { force: _force, ...withoutForce } = submit as Extract<PhoneMessage, { type: 'submit' }>;
    expect(parsePhoneMessage(withoutForce)).toBeNull();
  });
});

describe('parseDesktopMessage', () => {
  const recent = { state: 'printed', at: 1_000 } as const;

  test('accepts the session messages', () => {
    const messages: DesktopMessage[] = [
      { type: 'welcome', token: SECRET, nonce: SESSION, printer: '热敏标签机', image: null },
      { type: 'welcome', token: SECRET, nonce: SESSION, printer: null, image: null },
      { type: 'denied', reason: 'full' },
      { type: 'denied', reason: 'removed' },
      { type: 'denied', reason: 'locked' },
      { type: 'printer', printer: '热敏标签机', image: null },
      { type: 'printer', printer: null, image: null },
    ];
    for (const message of messages) {
      expect(parseDesktopMessage(message)).toEqual(message);
    }
  });

  test('rejects an unknown denial reason', () => {
    expect(parseDesktopMessage({ type: 'denied', reason: 'bored' })).toBeNull();
  });

  test('accepts queue positions, starts and refusals', () => {
    expect(parseDesktopMessage({ type: 'accepted', job: JOB, ahead: 0 })).toEqual({
      type: 'accepted',
      job: JOB,
      ahead: 0,
    });
    expect(parseDesktopMessage({ type: 'accepted', job: JOB, ahead: 3 })).toEqual({
      type: 'accepted',
      job: JOB,
      ahead: 3,
    });
    expect(parseDesktopMessage({ type: 'accepted', job: JOB, ahead: -1 })).toBeNull();
    expect(parseDesktopMessage({ type: 'accepted', job: JOB })).toBeNull();
    expect(parseDesktopMessage({ type: 'started', job: JOB })).toEqual({ type: 'started', job: JOB });
    for (const reason of ['rate-limited', 'too-many-pending'] as const) {
      expect(parseDesktopMessage({ type: 'refused', job: JOB, reason })).toEqual({ type: 'refused', job: JOB, reason });
    }
    expect(parseDesktopMessage({ type: 'refused', job: JOB, reason: 'busy' })).toBeNull();
  });

  test('accepts the queue positions of one phone', () => {
    const message: DesktopMessage = {
      type: 'queue',
      jobs: [
        { job: JOB, ahead: 1 },
        { job: OTHER_JOB, ahead: 4 },
      ],
    };
    expect(parseDesktopMessage(message)).toEqual(message);
  });

  test('rejects an empty, oversized or malformed queue update', () => {
    expect(parseDesktopMessage({ type: 'queue', jobs: [] })).toBeNull();
    const tooMany = Array.from({ length: MAX_PENDING_JOBS + 1 }, () => ({ job: JOB, ahead: 0 }));
    expect(parseDesktopMessage({ type: 'queue', jobs: tooMany })).toBeNull();
    expect(parseDesktopMessage({ type: 'queue', jobs: [{ job: JOB, ahead: -1 }] })).toBeNull();
    expect(parseDesktopMessage({ type: 'queue', jobs: [{ job: 'job-1', ahead: 0 }] })).toBeNull();
  });

  test('accepts every job result', () => {
    const results: PhonePrintResult[] = [
      { status: 'printed', ruleName: '横杠三段', fields: [{ name: '编码', value: 'CL5640' }] },
      { status: 'duplicate', recent, windowMs: 3_000 },
      { status: 'invalid', reason: 'INVALID_CONTENT' },
      { status: 'failed', reason: 'PRINTER_NOT_READY', detail: '缺纸', issue: 'paperOut', field: null },
      { status: 'failed', reason: 'PRINT_TIMEOUT', detail: null, issue: null, field: null },
      { status: 'failed', reason: 'TEXT_NOT_FOUND', detail: '没认出货架号', issue: null, field: '货架号' },
      { status: 'no-printer' },
    ];
    for (const result of results) {
      expect(parseDesktopMessage({ type: 'result', job: JOB, result })).toEqual({ type: 'result', job: JOB, result });
    }
  });

  test('rejects a printed result without its summary', () => {
    expect(parseDesktopMessage({ type: 'result', job: JOB, result: { status: 'printed' } })).toBeNull();
    const badField = { status: 'printed', ruleName: '横杠三段', fields: [{ name: '编码' }] };
    expect(parseDesktopMessage({ type: 'result', job: JOB, result: badField })).toBeNull();
  });

  // 老电脑的失败结果没有 field：按 null。
  test('rejects a failure without a field name or with one that is not text', () => {
    const result = { status: 'failed', reason: 'PRINT_ERROR', detail: null, issue: null } as const;
    expect(parseDesktopMessage({ type: 'result', job: JOB, result })).toBeNull();
    expect(parseDesktopMessage({ type: 'result', job: JOB, result: { ...result, field: 3 } })).toBeNull();
  });

  test('carries the image request in welcome and printer updates', () => {
    const image = { area: { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 }, pixelsPerCode: 130, frames: 3 };
    const messages: DesktopMessage[] = [
      { type: 'welcome', token: SECRET, nonce: SESSION, printer: null, image },
      { type: 'printer', printer: '热敏标签机', image },
    ];
    for (const message of messages) {
      expect(parseDesktopMessage(message)).toEqual(message);
    }
  });

  test('carries how many frames the desktop wants and requires it', () => {
    const area = { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 };
    const wanted = { area, pixelsPerCode: 170, frames: 3 };
    expect(parseDesktopMessage({ type: 'printer', printer: null, image: wanted })).toEqual({
      type: 'printer',
      printer: null,
      image: wanted,
    });
    expect(parseDesktopMessage({ type: 'printer', printer: null, image: { area, pixelsPerCode: 170 } })).toBeNull();
    expect(parseDesktopMessage({ type: 'printer', printer: null })).toBeNull();
    for (const frames of [0, MAX_LABEL_FRAMES + 1, 1.5, '3']) {
      expect(
        parseDesktopMessage({ type: 'printer', printer: null, image: { area, pixelsPerCode: 170, frames } }),
      ).toBeNull();
    }
  });

  test('rejects an image request that is empty, too far out or too fine', () => {
    const area = { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 };
    for (const image of [
      { area: { ...area, right: -2.5 }, pixelsPerCode: 130 },
      { area: { ...area, left: -11 }, pixelsPerCode: 130 },
      { area, pixelsPerCode: 1_000 },
      { area, pixelsPerCode: 130.5 },
      { area: null, pixelsPerCode: 130 },
    ]) {
      expect(parseDesktopMessage({ type: 'printer', printer: null, image })).toBeNull();
    }
  });

  test('rejects a failure with an unknown reason', () => {
    const result = { status: 'failed', reason: 'ON_FIRE', detail: null, issue: null };
    expect(parseDesktopMessage({ type: 'result', job: JOB, result })).toBeNull();
  });
});

describe('clipText', () => {
  test('keeps short text as it is', () => {
    expect(clipText('热敏标签机', 10)).toBe('热敏标签机');
  });

  test('never splits a character made of two code units', () => {
    const smile = String.fromCodePoint(0x1f600);
    expect(clipText(`${smile}${smile}${smile}`, 2)).toBe(`${smile}${smile}`);
  });
});

describe('isRequestRaw', () => {
  test('accepts content up to the request limit and nothing longer', () => {
    expect(isRequestRaw('x'.repeat(MAX_REQUEST_RAW_LENGTH))).toBe(true);
    expect(isRequestRaw('x'.repeat(MAX_REQUEST_RAW_LENGTH + 1))).toBe(false);
    expect(isRequestRaw(42)).toBe(false);
  });
});

describe('phone link', () => {
  test('puts the session id and key after the hash', () => {
    expect(buildPhoneUrl('https://relay.example.com/labelflash/', SESSION, KEY)).toBe(
      `https://relay.example.com/labelflash/m/#${SESSION}.${KEY}`,
    );
  });

  test('reads the session id and key back from the hash', () => {
    expect(parsePhoneFragment(`#${SESSION}.${KEY}`)).toEqual({ session: SESSION, key: KEY });
  });

  test('rejects a missing or malformed hash', () => {
    expect(parsePhoneFragment('')).toBeNull();
    expect(parsePhoneFragment(`#${SESSION}${KEY}`)).toBeNull();
    expect(parsePhoneFragment(`#${SESSION}.${KEY.slice(1)}`)).toBeNull();
  });
});
