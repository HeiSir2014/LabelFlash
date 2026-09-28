import { describe, expect, test } from 'bun:test';
import type { PhonePreview } from '../../../src/shared/mobile-protocol';
import { confirmView, resultView } from './result-view';

type OkPreview = Extract<PhonePreview, { status: 'ok' }>;

const PREVIEW: OkPreview = {
  status: 'ok',
  ruleName: '横杠三段',
  templateName: '标准',
  fields: [{ name: '编码', value: 'CL5640' }],
  truncated: false,
  recent: null,
  windowMs: 3_000,
  lookupFailure: null,
};

describe('resultView', () => {
  test('confirms a printed label', () => {
    expect(resultView({ kind: 'print', result: { status: 'printed' }, forced: false })).toMatchObject({
      tone: 'success',
      title: '已发送打印',
      actions: ['rescan'],
    });
    expect(resultView({ kind: 'print', result: { status: 'printed' }, forced: true }).title).toBe('已补打');
  });

  test('offers a forced reprint for a duplicate', () => {
    const view = resultView({
      kind: 'print',
      result: { status: 'duplicate', recent: { state: 'printed', at: 0 }, windowMs: 3_000 },
      forced: false,
    });
    expect(view).toMatchObject({ tone: 'warning', title: '重复扫码，已拦截', actions: ['force', 'rescan'] });
    expect(view.detail).toContain('3 秒');
  });

  test('names the printer problem and offers a retry', () => {
    const view = resultView({
      kind: 'print',
      result: { status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机缺纸', issue: 'paperOut' },
      forced: false,
    });
    expect(view).toMatchObject({ tone: 'error', title: '打印机缺纸', actions: ['retry', 'rescan'] });
  });

  test('offers only a forced reprint after a timeout, since the label may be out', () => {
    const view = resultView({
      kind: 'print',
      result: { status: 'failed', reason: 'PRINT_TIMEOUT', detail: null, issue: null },
      forced: false,
    });
    expect(view.actions).toEqual(['force', 'rescan']);
  });

  test('asks for a printer to be chosen on the desktop', () => {
    const view = resultView({ kind: 'print', result: { status: 'no-printer' }, forced: false });
    expect(view).toMatchObject({ title: '请先选择打印机', actions: ['retry', 'rescan'] });
    expect(view.detail).toContain('电脑上');
  });

  test('explains content no rule can read', () => {
    const view = resultView({ kind: 'invalid', reason: 'NO_MATCHING_RULE' });
    expect(view).toMatchObject({ title: '无法识别，请检查扫码内容', actions: ['rescan'] });
    expect(view.detail).toContain('识别规则');
  });
});

describe('confirmView', () => {
  test('lets a fresh label print', () => {
    expect(confirmView(PREVIEW)).toEqual({ action: 'print', notice: null });
  });

  test('turns the button into a forced reprint within the window', () => {
    const view = confirmView({ ...PREVIEW, recent: { state: 'printed', at: 0 } });
    expect(view.action).toBe('force');
    expect(view.notice).toContain('3 秒');
  });

  test('blocks printing while the same label is printing', () => {
    expect(confirmView({ ...PREVIEW, recent: { state: 'printing', at: 0 } }).action).toBeNull();
  });

  test('blocks printing when a required lookup failed', () => {
    const view = confirmView({ ...PREVIEW, lookupFailure: '查询超时' });
    expect(view.action).toBeNull();
    expect(view.notice).toContain('查询超时');
  });
});
