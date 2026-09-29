import { describe, expect, test } from 'bun:test';
import type { MobileStatus } from '../../../shared/mobile-status';
import { describeMobileButton, describeMobileOverlay, describeMobileState, formatCountdown } from './mobile-text';

const NOW = 1_000_000;
const URL = 'https://relay.example.com/labelflash/m/#session.key';
const ready = { hasPrinter: true, now: NOW };

function active(patch: Partial<Extract<MobileStatus, { state: 'active' }>> = {}): MobileStatus {
  return {
    state: 'active',
    url: URL,
    expiresAt: null,
    relayOnline: true,
    joinLocked: false,
    phones: [],
    printed: 0,
    queued: 0,
    ...patch,
  };
}

describe('describeMobileButton', () => {
  test('stays quiet while mobile scanning is off', () => {
    expect(describeMobileButton({ state: 'off' })).toEqual({ tone: 'off', title: '用手机扫码打印' });
  });

  test('counts the phones online during a session', () => {
    const status = active({
      phones: [
        { id: 'a', device: 'iPhone · 微信', online: true, printed: 1 },
        { id: 'b', device: '安卓 · Chrome', online: false, printed: 0 },
      ],
    });
    expect(describeMobileButton(status)).toEqual({ tone: 'active', title: '手机扫码进行中：1 部手机在线' });
  });

  test('shows a reconnect and a failure differently', () => {
    expect(describeMobileButton(active({ relayOnline: false })).tone).toBe('pending');
    expect(describeMobileButton({ state: 'failed', error: 'unreachable' }).tone).toBe('error');
  });
});

describe('describeMobileOverlay', () => {
  test('offers to create a code while off', () => {
    const view = describeMobileOverlay({ state: 'off' }, ready);
    expect(view.actions).toEqual({ start: true, stop: false, regenerate: false });
    expect(view.url).toBeNull();
  });

  test('links to the relay address when none is set', () => {
    const view = describeMobileOverlay({ state: 'failed', error: 'not-configured' }, ready);
    expect(view.link).toEqual({ page: 'mobile', label: '去填写中转地址' });
    expect(view.actions.start).toBe(true);
  });

  test('lets a session that keeps retrying be ended, and a stopped one be started again', () => {
    expect(describeMobileOverlay({ state: 'failed', error: 'unreachable' }, ready).actions).toEqual({
      start: false,
      stop: true,
      regenerate: false,
    });
    expect(describeMobileOverlay({ state: 'failed', error: 'version' }, ready).actions.start).toBe(true);
  });

  test('shows the code with its remaining time until a phone joins', () => {
    const view = describeMobileOverlay(active({ expiresAt: NOW + 9 * 60_000 + 58_000 }), ready);
    expect(view).toMatchObject({ url: URL, countdown: '9:58', message: null });
    expect(view.actions).toEqual({ start: false, stop: true, regenerate: true });
  });

  test('stops counting down once a phone has joined', () => {
    const view = describeMobileOverlay(
      active({ phones: [{ id: 'a', device: '', online: true, printed: 3 }], printed: 3, queued: 1 }),
      ready,
    );
    expect(view.countdown).toBeNull();
    expect(view.actions.regenerate).toBe(false);
    expect(view.phones).toEqual([{ id: 'a', device: '未知设备', isOnline: true, detail: '在线 · 已打印 3 张' }]);
    expect(view.summary).toBe('排队中 1 张 · 本次已打印 3 张');
  });

  test('says when the code has expired', () => {
    const view = describeMobileOverlay(active({ expiresAt: NOW - 1 }), ready);
    expect(view.countdown).toBe('0:00');
    expect(view.message).toContain('二维码已过期');
  });

  test('warns when no printer is assigned', () => {
    const view = describeMobileOverlay(active(), { hasPrinter: false, now: NOW });
    expect(view.message).toContain('还没有分配打印机');
  });

  test('reports a lost relay connection before anything else', () => {
    const view = describeMobileOverlay(active({ relayOnline: false }), { hasPrinter: false, now: NOW });
    expect(view).toMatchObject({ tone: 'pending' });
    expect(view.message).toContain('正在重连');
  });

  test('passes on the join lock', () => {
    expect(describeMobileOverlay(active({ joinLocked: true }), ready).isJoinLocked).toBe(true);
  });
});

describe('describeMobileState', () => {
  test('tells where to start when nothing is running', () => {
    expect(describeMobileState({ state: 'off' })).toContain('标题栏的「手机扫码」');
  });

  test('counts phones and prints during a session', () => {
    const status = active({ phones: [{ id: 'a', device: 'x', online: true, printed: 2 }], printed: 2 });
    expect(describeMobileState(status)).toBe('进行中：1 部手机在线，本次已打印 2 张。');
  });

  test('repeats the failure reason', () => {
    expect(describeMobileState({ state: 'failed', error: 'not-configured' })).toContain('中转地址');
  });
});

describe('formatCountdown', () => {
  test('writes minutes and seconds, rounding up and never below zero', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(61_001)).toBe('1:02');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(-3_000)).toBe('0:00');
  });
});
