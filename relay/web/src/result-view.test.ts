import { describe, expect, test } from 'bun:test';
import type { PhonePrintResult } from '../../../src/shared/mobile-protocol';
import { initialPhoneState, type JobEntry, type PhoneState } from './phone-state';
import { jobView, linkBanner, messageView } from './result-view';

const RAW = 'CL5640-TK-图片色-XL';
const PRINTED: PhonePrintResult = {
  status: 'printed',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};

function job(patch: Partial<JobEntry>): JobEntry {
  return { id: 'a', raw: RAW, force: false, status: 'sending', ahead: null, result: null, refusal: null, ...patch };
}

const done = (result: PhonePrintResult, force = false) => job({ status: 'done', result, force });

describe('jobView', () => {
  test('shows a job on its way', () => {
    expect(jobView(job({}), 'online')).toMatchObject({ tone: 'pending', title: '正在发送…', detail: RAW });
    expect(jobView(job({}), 'desktop-offline').title).toContain('连上');
    expect(jobView(job({ status: 'queued', ahead: 3 }), 'online')).toMatchObject({
      tone: 'pending',
      title: '排队中，前面还有 3 张',
    });
    expect(jobView(job({ status: 'queued', ahead: 0 }), 'online').title).toBe('排队中，下一张就是它');
    expect(jobView(job({ status: 'printing' }), 'online')).toMatchObject({ tone: 'pending', title: '正在打印…' });
  });

  test('confirms a printed label and shows what it was', () => {
    expect(jobView(done(PRINTED), 'online')).toEqual({
      tone: 'success',
      title: '已发送打印',
      detail: 'CL5640 · 图片色 · XL',
      actions: [],
    });
    expect(jobView(done(PRINTED, true), 'online').title).toBe('已补打');
  });

  test('falls back to the scanned text when a printed label has no fields', () => {
    expect(jobView(done({ ...PRINTED, fields: [] }), 'online').detail).toBe(RAW);
  });

  test('offers a forced reprint for a duplicate', () => {
    const view = jobView(done({ status: 'duplicate', recent: { state: 'printed', at: 0 }, windowMs: 3_000 }), 'online');
    expect(view).toMatchObject({ tone: 'warning', title: '重复扫码，已拦截', actions: ['force'] });
    expect(view.detail).toContain('3 秒');
  });

  test('offers nothing while the same label is still printing', () => {
    const view = jobView(
      done({ status: 'duplicate', recent: { state: 'printing', at: 0 }, windowMs: 3_000 }),
      'online',
    );
    expect(view).toMatchObject({ title: '正在打印，请稍候', actions: [] });
  });

  test('names the printer problem and offers a retry', () => {
    const view = jobView(
      done({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机缺纸', issue: 'paperOut' }),
      'online',
    );
    expect(view).toMatchObject({ tone: 'error', title: '打印机缺纸', actions: ['retry'] });
  });

  test('offers only a forced reprint after a timeout, since the label may be out', () => {
    const view = jobView(done({ status: 'failed', reason: 'PRINT_TIMEOUT', detail: null, issue: null }), 'online');
    expect(view.actions).toEqual(['force']);
  });

  test('asks for a printer to be chosen on the desktop', () => {
    const view = jobView(done({ status: 'no-printer' }), 'online');
    expect(view).toMatchObject({ title: '请先选择打印机', actions: ['retry'] });
    expect(view.detail).toContain('电脑上');
  });

  test('explains content no rule can read', () => {
    const view = jobView(done({ status: 'invalid', reason: 'NO_MATCHING_RULE' }), 'online');
    expect(view).toMatchObject({ title: '无法识别，请检查扫码内容', actions: [] });
    expect(view.detail).toContain('识别规则');
  });

  test('explains a refused job, which was not printed', () => {
    const view = jobView(job({ status: 'refused', refusal: 'too-many-pending' }), 'online');
    expect(view).toMatchObject({ tone: 'warning', actions: ['retry'] });
    expect(view.title).toContain('没有打印');
  });
});

describe('messageView', () => {
  const state = (patch: Partial<PhoneState>): PhoneState => ({ ...initialPhoneState(true), ...patch });

  test('tells a visitor without a link where to start', () => {
    expect(messageView(initialPhoneState(false))?.text).toContain('手机扫码');
  });

  test('explains each way a session ends', () => {
    expect(messageView(state({ screen: 'ended', endReason: 'stopped' }))?.text).toContain('电脑上已结束');
    expect(messageView(state({ screen: 'ended', endReason: 'idle' }))?.text).toContain('30 分钟');
    expect(messageView(state({ screen: 'ended', endReason: 'quit' }))?.text).toContain('退出');
    expect(messageView(state({ screen: 'ended', endReason: 'desktop-gone' }))?.text).toContain('断线');
  });

  test('explains an expired link', () => {
    expect(messageView(state({ screen: 'not-found' }))?.title).toBe('链接已失效');
  });

  test('explains why a phone was turned away', () => {
    expect(messageView(state({ screen: 'denied', denial: 'full' }))?.text).toContain('移除不用的手机');
    expect(messageView(state({ screen: 'denied', denial: 'removed' }))?.title).toBe('这部手机已被移除');
  });

  test('has no message while scanning', () => {
    expect(messageView(state({ screen: 'scanning' }))).toBeNull();
  });
});

describe('linkBanner', () => {
  test('says nothing while online', () => {
    expect(linkBanner('online')).toBeNull();
  });

  test('tells a reconnect from a desktop that stepped away', () => {
    expect(linkBanner('reconnecting')).toContain('重新连接');
    expect(linkBanner('desktop-offline')).toContain('电脑');
  });
});
