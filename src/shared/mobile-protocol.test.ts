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

const SESSION = 'AbCdEfGhIjKlMnOpQrSt_-';
const SECRET = 'zyxwvutsrqponmlkjihg01';
const KEY = 'K'.repeat(43);
const JOB = 'JobJobJobJobJobJobJob0';
const OTHER_JOB = 'JobJobJobJobJobJobJob1';
/** 中转服务分配的连接号也是 16 字节随机数。 */
const PHONE = 'PhonePhonePhonePhone01';
const BODY = { iv: 'aaaaaaaaaaaaaaaa', ct: 'bbbb-_cc' };

const json = (value: unknown) => JSON.stringify(value);

describe('parseDesktopFrame', () => {
  test('accepts an open frame', () => {
    const frame: DesktopFrame = { t: 'open', v: MOBILE_PROTOCOL_VERSION, session: SESSION, secret: SECRET };
    expect(parseDesktopFrame(json(frame))).toEqual(frame);
  });

  test('rejects an open frame with a malformed session id', () => {
    expect(parseDesktopFrame(json({ t: 'open', v: 1, session: 'short', secret: SECRET }))).toBeNull();
    expect(parseDesktopFrame(json({ t: 'open', v: 1, session: `${SESSION.slice(1)}+`, secret: SECRET }))).toBeNull();
  });

  test('rejects an open frame without a secret or with a fractional version', () => {
    expect(parseDesktopFrame(json({ t: 'open', v: 1, session: SESSION }))).toBeNull();
    expect(parseDesktopFrame(json({ t: 'open', v: 1.5, session: SESSION, secret: SECRET }))).toBeNull();
  });

  test('accepts send, kick, close and ping', () => {
    expect(parseDesktopFrame(json({ t: 'send', phone: PHONE, body: BODY }))).toEqual({
      t: 'send',
      phone: PHONE,
      body: BODY,
    });
    expect(parseDesktopFrame(json({ t: 'kick', phone: PHONE }))).toEqual({ t: 'kick', phone: PHONE });
    expect(parseDesktopFrame(json({ t: 'close', reason: 'idle' }))).toEqual({ t: 'close', reason: 'idle' });
    expect(parseDesktopFrame(json({ t: 'ping' }))).toEqual({ t: 'ping' });
  });

  test('rejects a phone id that the relay could not have assigned', () => {
    expect(parseDesktopFrame(json({ t: 'kick', phone: 'p1' }))).toBeNull();
  });

  test('rejects a close frame with an unknown reason', () => {
    expect(parseDesktopFrame(json({ t: 'close', reason: 'desktop-gone' }))).toBeNull();
  });

  test('drops fields that are not part of the frame', () => {
    expect(parseDesktopFrame(json({ t: 'kick', phone: PHONE, extra: 1 }))).toEqual({ t: 'kick', phone: PHONE });
  });

  test('rejects unknown types, invalid JSON, arrays and null', () => {
    expect(parseDesktopFrame(json({ t: 'shout' }))).toBeNull();
    expect(parseDesktopFrame('{')).toBeNull();
    expect(parseDesktopFrame('[]')).toBeNull();
    expect(parseDesktopFrame('null')).toBeNull();
  });
});

describe('parsePhoneFrame', () => {
  test('accepts join, send and ping', () => {
    expect(parsePhoneFrame(json({ t: 'join', v: 1, session: SESSION }))).toEqual({ t: 'join', v: 1, session: SESSION });
    expect(parsePhoneFrame(json({ t: 'send', body: BODY }))).toEqual({ t: 'send', body: BODY });
    expect(parsePhoneFrame(json({ t: 'ping' }))).toEqual({ t: 'ping' });
  });

  test('rejects a body whose iv is not base64url', () => {
    expect(parsePhoneFrame(json({ t: 'send', body: { iv: 'a+b/', ct: 'cc' } }))).toBeNull();
    expect(parsePhoneFrame(json({ t: 'send', body: { iv: 'aa' } }))).toBeNull();
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
      expect(parseRelayToDesktop(json(frame))).toEqual(frame);
    }
  });

  test('rejects an unknown error code', () => {
    expect(parseRelayToDesktop(json({ t: 'error', code: 'oops' }))).toBeNull();
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
      expect(parseRelayToPhone(json(frame))).toEqual(frame);
    }
  });

  test('rejects an unknown end reason', () => {
    expect(parseRelayToPhone(json({ t: 'ended', reason: 'bored' }))).toBeNull();
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

  const image = { jpeg: '/9j/4AAQSkZJRgABAQ==', code: { x: 325, y: 195, size: 130 } };

  test('accepts a submission with the label image and typed fields', () => {
    const message = { ...submit, image, fields: [{ name: '货架号', value: ' A-1-2-3 ' }] };
    expect(parsePhoneMessage(message)).toEqual({ ...message, fields: [{ name: '货架号', value: 'A-1-2-3' }] });
  });

  test('rejects an image that is not a JPEG, too large or placed nowhere', () => {
    const tooLarge = `/9j/${'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4)}`;
    for (const bad of [
      { ...image, jpeg: 'iVBORw0KGgo=' },
      { ...image, jpeg: '/9j/<script>' },
      { ...image, jpeg: tooLarge },
      { ...image, code: { x: 1, y: 1, size: 0 } },
      { ...image, code: { x: Number.NaN, y: 1, size: 10 } },
      { jpeg: image.jpeg },
    ]) {
      expect(parsePhoneMessage({ ...submit, image: bad })).toBeNull();
    }
  });

  // 多帧择优：同一张标签接下来的几帧一起发，电脑依次识别（货架号的横杠太淡时，单帧只有约 2/3 能读出）。
  test('accepts more frames of the same label', () => {
    const message = { ...submit, image, moreImages: [image, image] };
    expect(parsePhoneMessage(message)).toEqual(message);
  });

  test('rejects more frames without the first, too many frames or frames beyond the image budget', () => {
    const half = { ...image, jpeg: `/9j/${'A'.repeat((Math.ceil(MAX_IMAGE_BYTES / 3) * 4) / 2)}` };
    for (const bad of [
      { ...submit, moreImages: [image] },
      { ...submit, image, moreImages: Array.from({ length: MAX_LABEL_FRAMES }, () => image) },
      { ...submit, image, moreImages: [{ ...image, jpeg: 'iVBORw0KGgo=' }] },
      { ...submit, image, moreImages: image },
      { ...submit, image: half, moreImages: [half] },
    ]) {
      expect(parsePhoneMessage(bad)).toBeNull();
    }
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
    const { force: _force, ...withoutForce } = submit;
    expect(parsePhoneMessage(withoutForce)).toBeNull();
  });
});

describe('parseDesktopMessage', () => {
  const recent = { state: 'printed', at: 1_000 } as const;

  test('accepts the session messages', () => {
    const messages: DesktopMessage[] = [
      { type: 'welcome', token: SECRET, nonce: SESSION, printer: '热敏标签机' },
      { type: 'welcome', token: SECRET, nonce: SESSION, printer: null },
      { type: 'denied', reason: 'full' },
      { type: 'denied', reason: 'removed' },
      { type: 'denied', reason: 'locked' },
      { type: 'printer', printer: '热敏标签机' },
      { type: 'printer', printer: null },
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
  test('reads a failure from an older desktop without the field name', () => {
    const result = { status: 'failed', reason: 'PRINT_ERROR', detail: null, issue: null } as const;
    expect(parseDesktopMessage({ type: 'result', job: JOB, result })).toEqual({
      type: 'result',
      job: JOB,
      result: { ...result, field: null },
    });
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

  test('carries how many frames the desktop wants and treats an old request as one frame', () => {
    const area = { left: -2.5, top: -1.5, right: 3.5, bottom: 2.5 };
    const wanted = { area, pixelsPerCode: 170, frames: 3 };
    expect(parseDesktopMessage({ type: 'printer', printer: null, image: wanted })).toEqual({
      type: 'printer',
      printer: null,
      image: wanted,
    });
    expect(parseDesktopMessage({ type: 'printer', printer: null, image: { area, pixelsPerCode: 170 } })).toEqual({
      type: 'printer',
      printer: null,
      image: { area, pixelsPerCode: 170, frames: 1 },
    });
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
