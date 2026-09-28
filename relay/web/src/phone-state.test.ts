import { describe, expect, test } from 'bun:test';
import type { PhonePreview, PhonePrintResult } from '../../../src/shared/mobile-protocol';
import { initialPhoneState, type PhoneEvent, type PhoneState, reducePhone } from './phone-state';

const RAW = 'CL5640-TK-图片色-XL';
const OK_PREVIEW: PhonePreview = {
  status: 'ok',
  ruleName: '横杠三段',
  templateName: '标准',
  fields: [{ name: '编码', value: 'CL5640' }],
  truncated: false,
  recent: null,
  windowMs: 3_000,
  lookupFailure: null,
};
const PRINTED: PhonePrintResult = { status: 'printed' };

function run(events: PhoneEvent[], start: PhoneState = initialPhoneState(true)): PhoneState {
  return events.reduce(reducePhone, start);
}

const welcomed: PhoneEvent = { type: 'welcomed', printer: '热敏标签机' };

describe('reducePhone', () => {
  test('starts without a link or connecting', () => {
    expect(initialPhoneState(false).screen).toBe('no-link');
    expect(initialPhoneState(true)).toMatchObject({ screen: 'connecting', link: 'reconnecting' });
  });

  test('starts scanning once the desktop welcomes the phone', () => {
    expect(run([welcomed])).toMatchObject({ screen: 'scanning', link: 'online', printer: '热敏标签机' });
  });

  test('checks a decoded code, then asks to confirm', () => {
    const state = run([welcomed, { type: 'decoded', raw: RAW }]);
    expect(state).toMatchObject({ screen: 'checking', raw: RAW });
    expect(reducePhone(state, { type: 'preview-result', result: OK_PREVIEW })).toMatchObject({
      screen: 'confirm',
      preview: OK_PREVIEW,
    });
  });

  test('prints after confirmation and shows the result', () => {
    const state = run([
      welcomed,
      { type: 'decoded', raw: RAW },
      { type: 'preview-result', result: OK_PREVIEW },
      { type: 'print-requested', force: false },
    ]);
    expect(state.screen).toBe('printing');
    expect(reducePhone(state, { type: 'print-result', result: PRINTED })).toMatchObject({
      screen: 'result',
      result: { kind: 'print', result: PRINTED, forced: false },
    });
  });

  test('shows an unreadable code as a result', () => {
    const state = run([
      welcomed,
      { type: 'decoded', raw: RAW },
      { type: 'preview-result', result: { status: 'invalid', reason: 'NO_MATCHING_RULE' } },
    ]);
    expect(state).toMatchObject({ screen: 'result', result: { kind: 'invalid', reason: 'NO_MATCHING_RULE' } });
  });

  test('goes back to scanning and forgets the last code', () => {
    const state = run([
      welcomed,
      { type: 'decoded', raw: RAW },
      { type: 'preview-result', result: OK_PREVIEW },
      { type: 'rescan' },
    ]);
    expect(state).toMatchObject({ screen: 'scanning', raw: null, preview: null, result: null });
  });

  test('retries a failed print from the result screen', () => {
    const failed: PhonePrintResult = { status: 'no-printer' };
    const state = run([
      welcomed,
      { type: 'decoded', raw: RAW },
      { type: 'preview-result', result: OK_PREVIEW },
      { type: 'print-requested', force: false },
      { type: 'print-result', result: failed },
      { type: 'print-requested', force: true },
    ]);
    expect(state).toMatchObject({ screen: 'printing', raw: RAW, forced: true });
  });

  test('ignores codes decoded while busy', () => {
    const printing = run([
      welcomed,
      { type: 'decoded', raw: RAW },
      { type: 'preview-result', result: OK_PREVIEW },
      { type: 'print-requested', force: false },
    ]);
    expect(reducePhone(printing, { type: 'decoded', raw: 'OTHER' })).toBe(printing);
  });

  test('ignores codes decoded while the desktop is offline', () => {
    const offline = run([welcomed, { type: 'link', link: 'desktop-offline' }]);
    expect(reducePhone(offline, { type: 'decoded', raw: RAW })).toBe(offline);
  });

  test('returns to the previous step with a notice when a request fails', () => {
    const checking = run([welcomed, { type: 'decoded', raw: RAW }]);
    const afterPreview = reducePhone(checking, { type: 'request-failed', reason: 'timeout' });
    expect(afterPreview.screen).toBe('scanning');
    expect(afterPreview.notice).not.toBeNull();

    const printing = run([
      welcomed,
      { type: 'decoded', raw: RAW },
      { type: 'preview-result', result: OK_PREVIEW },
      { type: 'print-requested', force: false },
    ]);
    const afterPrint = reducePhone(printing, { type: 'request-failed', reason: 'busy' });
    expect(afterPrint).toMatchObject({ screen: 'confirm', preview: OK_PREVIEW });
    expect(afterPrint.notice).not.toBeNull();
  });

  test('tracks the link separately from the scan flow', () => {
    const state = run([welcomed, { type: 'decoded', raw: RAW }, { type: 'link', link: 'reconnecting' }]);
    expect(state).toMatchObject({ screen: 'checking', link: 'reconnecting' });
  });

  test('ends for good', () => {
    const ended = run([welcomed, { type: 'ended', reason: 'idle' }]);
    expect(ended).toMatchObject({ screen: 'ended', endReason: 'idle' });
    expect(reducePhone(ended, welcomed)).toBe(ended);
    expect(run([{ type: 'not-found' }]).screen).toBe('not-found');
    expect(run([{ type: 'taken' }]).screen).toBe('taken');
  });

  test('remembers whether the camera works', () => {
    expect(run([welcomed, { type: 'camera', camera: 'unavailable' }]).camera).toBe('unavailable');
  });
});
