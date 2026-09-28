import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH } from '../core/scan/normalize-raw';
import {
  buildPhoneUrl,
  type DesktopFrame,
  type DesktopMessage,
  MAX_DEVICE_LENGTH,
  MOBILE_PROTOCOL_VERSION,
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
    expect(parseDesktopFrame(json({ t: 'send', phone: 'p1', body: BODY }))).toEqual({
      t: 'send',
      phone: 'p1',
      body: BODY,
    });
    expect(parseDesktopFrame(json({ t: 'kick', phone: 'p1' }))).toEqual({ t: 'kick', phone: 'p1' });
    expect(parseDesktopFrame(json({ t: 'close', reason: 'idle' }))).toEqual({ t: 'close', reason: 'idle' });
    expect(parseDesktopFrame(json({ t: 'ping' }))).toEqual({ t: 'ping' });
  });

  test('rejects a close frame with an unknown reason', () => {
    expect(parseDesktopFrame(json({ t: 'close', reason: 'desktop-gone' }))).toBeNull();
  });

  test('drops fields that are not part of the frame', () => {
    expect(parseDesktopFrame(json({ t: 'kick', phone: 'p1', extra: 1 }))).toEqual({ t: 'kick', phone: 'p1' });
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
      { t: 'joined', phone: 'p1' },
      { t: 'left', phone: 'p1' },
      { t: 'recv', phone: 'p1', body: BODY },
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

  test('rejects a hello with a malformed token', () => {
    expect(parsePhoneMessage({ type: 'hello', token: 'abc', device: 'x' })).toBeNull();
  });

  test('accepts preview and print requests', () => {
    expect(parsePhoneMessage({ type: 'preview', nonce: SECRET, id: 1, raw: 'CL5640-TK-图片色-XL' })).toEqual({
      type: 'preview',
      nonce: SECRET,
      id: 1,
      raw: 'CL5640-TK-图片色-XL',
    });
    expect(parsePhoneMessage({ type: 'print', nonce: SECRET, id: 2, raw: 'A', force: true })).toEqual({
      type: 'print',
      nonce: SECRET,
      id: 2,
      raw: 'A',
      force: true,
    });
  });

  test('rejects request ids that are not positive safe integers', () => {
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(parsePhoneMessage({ type: 'preview', nonce: SECRET, id, raw: 'A' })).toBeNull();
    }
  });

  test('rejects raw content that is far beyond what printing accepts', () => {
    const raw = 'x'.repeat(MAX_RAW_LENGTH * 4 + 1);
    expect(parsePhoneMessage({ type: 'preview', nonce: SECRET, id: 1, raw })).toBeNull();
  });

  test('rejects a print request without a boolean force flag', () => {
    expect(parsePhoneMessage({ type: 'print', nonce: SECRET, id: 1, raw: 'A', force: 'yes' })).toBeNull();
    expect(parsePhoneMessage({ type: 'print', nonce: SECRET, id: 1, raw: 'A' })).toBeNull();
  });
});

describe('parseDesktopMessage', () => {
  const recent = { state: 'printed', at: 1_000 } as const;

  test('accepts welcome and rejected', () => {
    const welcome: DesktopMessage = { type: 'welcome', token: SECRET, nonce: SESSION, printer: '热敏标签机' };
    expect(parseDesktopMessage(welcome)).toEqual(welcome);
    const noPrinter: DesktopMessage = { type: 'welcome', token: SECRET, nonce: SESSION, printer: null };
    expect(parseDesktopMessage(noPrinter)).toEqual(noPrinter);
    expect(parseDesktopMessage({ type: 'rejected' })).toEqual({ type: 'rejected' });
  });

  test('accepts ok and invalid previews', () => {
    const ok: DesktopMessage = {
      type: 'preview',
      id: 3,
      result: {
        status: 'ok',
        ruleName: '横杠三段',
        templateName: '标准',
        fields: [{ name: '编码', value: 'CL5640' }],
        truncated: false,
        recent,
        windowMs: 3_000,
        lookupFailure: null,
      },
    };
    expect(parseDesktopMessage(ok)).toEqual(ok);
    const invalid: DesktopMessage = {
      type: 'preview',
      id: 4,
      result: { status: 'invalid', reason: 'NO_MATCHING_RULE' },
    };
    expect(parseDesktopMessage(invalid)).toEqual(invalid);
  });

  test('accepts every print result', () => {
    const results: PhonePrintResult[] = [
      { status: 'printed' },
      { status: 'duplicate', recent, windowMs: 3_000 },
      { status: 'invalid', reason: 'INVALID_CONTENT' },
      { status: 'failed', reason: 'PRINTER_NOT_READY', detail: '缺纸', issue: 'paperOut' },
      { status: 'failed', reason: 'PRINT_TIMEOUT', detail: null, issue: null },
      { status: 'no-printer' },
    ];
    for (const result of results) {
      expect(parseDesktopMessage({ type: 'print', id: 5, result })).toEqual({ type: 'print', id: 5, result });
    }
  });

  test('rejects a failure with an unknown reason', () => {
    const result = { status: 'failed', reason: 'ON_FIRE', detail: null, issue: null };
    expect(parseDesktopMessage({ type: 'print', id: 5, result })).toBeNull();
  });

  test('accepts busy and rate-limited replies', () => {
    expect(parseDesktopMessage({ type: 'busy', id: 6 })).toEqual({ type: 'busy', id: 6 });
    expect(parseDesktopMessage({ type: 'rate-limited', id: 7 })).toEqual({ type: 'rate-limited', id: 7 });
  });
});

describe('phone link', () => {
  test('puts the session id and key after the hash', () => {
    expect(buildPhoneUrl('https://yterm.cn/labelflash/', SESSION, KEY)).toBe(
      `https://yterm.cn/labelflash/m/#${SESSION}.${KEY}`,
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
