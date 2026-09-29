import { describe, expect, test } from 'bun:test';
import type { PhonePrintResult } from '../../../src/shared/mobile-protocol';
import { initialPhoneState, type JobEntry, type PhoneState, type Screen } from './phone-state';
import { jobView, linkBanner, messageView, printerLine, resultLevel, scanHint, viewfinderCover } from './result-view';

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

const sending: JobEntry = { id: 'a', raw: RAW, force: false, status: 'sending' };
const done = (result: PhonePrintResult, force = false): JobEntry => ({ ...sending, force, status: 'done', result });
const state = (patch: Partial<PhoneState>): PhoneState => ({ ...initialPhoneState(true), ...patch });
const onScreen = (screen: Screen): PhoneState => state({ screen });

describe('jobView', () => {
  test('shows a job on its way', () => {
    expect(jobView(sending, 'online')).toMatchObject({ tone: 'pending', title: '正在发送…', detail: RAW });
    expect(jobView(sending, 'desktop-offline').title).toContain('连上');
    expect(jobView({ ...sending, status: 'queued', ahead: 3 }, 'online')).toMatchObject({
      tone: 'pending',
      title: '排队中，前面还有 3 张',
    });
    expect(jobView({ ...sending, status: 'queued', ahead: 0 }, 'online').title).toBe('排队中，下一张就是它');
    expect(jobView({ ...sending, status: 'printing' }, 'online')).toMatchObject({
      tone: 'pending',
      title: '正在打印…',
    });
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

  test('offers another copy of the latest printed label only', () => {
    expect(jobView(done(PRINTED), 'online', true).actions).toEqual(['again']);
    expect(jobView(done(PRINTED, true), 'online', true).actions).toEqual(['again']);
    expect(jobView(done(PRINTED), 'online', false).actions).toEqual([]);
  });

  test('offers no extra copy for a label that did not print', () => {
    const view = jobView(done({ status: 'failed', reason: 'PRINT_ERROR', detail: null, issue: null }), 'online', true);
    expect(view.actions).toEqual(['retry']);
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
    expect(view).toMatchObject({ tone: 'warning', title: '没有可用的打印机', actions: ['retry'] });
    expect(view.detail).toContain('电脑上');
  });

  test('explains content no rule can read', () => {
    const view = jobView(done({ status: 'invalid', reason: 'NO_MATCHING_RULE' }), 'online');
    expect(view).toMatchObject({ title: '无法识别，请检查扫码内容', actions: [] });
    expect(view.detail).toContain('识别规则');
  });

  test('explains a refused job, which was not printed', () => {
    const view = jobView({ ...sending, status: 'refused', reason: 'too-many-pending' }, 'online');
    expect(view).toMatchObject({ tone: 'warning', actions: ['retry'] });
    expect(view.title).toContain('没有打印');
  });
});

describe('resultLevel', () => {
  test('rates printer faults as alerts and everything the operator can fix as notices', () => {
    expect(resultLevel({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: null, issue: 'paperOut' })).toBe(
      'alert',
    );
    expect(resultLevel({ status: 'invalid', reason: 'INVALID_CONTENT' })).toBe('notice');
    expect(resultLevel({ status: 'no-printer' })).toBe('notice');
    expect(resultLevel(PRINTED)).toBe('confirm');
  });
});

describe('messageView', () => {
  test('tells a visitor without a link where to start', () => {
    expect(messageView(initialPhoneState(false))?.text).toContain('手机扫码');
  });

  test('explains each way a session ends, with the real time limits', () => {
    expect(messageView(onScreen({ name: 'ended', reason: 'stopped' }))?.text).toContain('电脑上已结束');
    expect(messageView(onScreen({ name: 'ended', reason: 'idle' }))?.text).toContain('超过 30 分钟');
    expect(messageView(onScreen({ name: 'ended', reason: 'quit' }))?.text).toContain('退出');
    expect(messageView(onScreen({ name: 'ended', reason: 'desktop-gone' }))?.text).toContain('断线超过 2 分钟');
  });

  test('explains an expired link', () => {
    expect(messageView(onScreen({ name: 'not-found' }))?.title).toBe('链接已失效');
  });

  test('explains why a phone was turned away', () => {
    expect(messageView(onScreen({ name: 'denied', reason: 'full' }))?.text).toContain('移除不用的手机');
    expect(messageView(onScreen({ name: 'denied', reason: 'removed' }))?.title).toBe('这部手机已被移除');
    expect(messageView(onScreen({ name: 'denied', reason: 'locked' }))?.text).toContain('允许新手机加入');
  });

  test('offers a reload for an outdated page', () => {
    expect(messageView(onScreen({ name: 'outdated' }))).toMatchObject({ title: '页面需要更新', action: 'reload' });
  });

  test('has no message while scanning', () => {
    expect(messageView(onScreen({ name: 'scanning' }))).toBeNull();
  });
});

describe('printerLine', () => {
  test('names the printer only while scanning', () => {
    expect(printerLine(state({ screen: { name: 'scanning' }, printer: '热敏标签机' }))).toBe('打印机：热敏标签机');
    expect(printerLine(state({ screen: { name: 'scanning' }, printer: null }))).toBe('电脑上还没选打印机');
    expect(printerLine(state({ screen: { name: 'connecting' }, printer: null }))).toBeNull();
    expect(printerLine(state({ screen: { name: 'ended', reason: 'stopped' }, printer: '热敏标签机' }))).toBeNull();
  });
});

describe('the viewfinder', () => {
  test('waits for a tap before opening the camera', () => {
    expect(viewfinderCover(state({ camera: 'idle' }))).toMatchObject({ button: '开始扫码' });
    expect(scanHint(state({ camera: 'idle' }))).toContain('开始扫码');
  });

  test('offers to open the camera again after a failure', () => {
    expect(viewfinderCover(state({ camera: 'unavailable' }))).toMatchObject({ button: '重新打开摄像头' });
  });

  test('stays clear while the camera is live', () => {
    expect(viewfinderCover(state({ camera: 'live', decoder: 'ready' }))).toBeNull();
    expect(scanHint(state({ camera: 'live' }))).toContain('扫到就打印');
  });

  test('says so when the decoder could not load', () => {
    expect(viewfinderCover(state({ camera: 'live', decoder: 'failed' }))).toMatchObject({ button: null });
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
