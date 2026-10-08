import { describe, expect, test } from 'bun:test';
import {
  IdleWatcher,
  isScannerCharacter,
  isTypingField,
  keepsFocus,
  returnsFocusWhenIdle,
  SCAN_FOCUS_IDLE_MS,
} from './scan-focus';
import type { Timers } from './timers';

const KEY = { ctrlKey: false, altKey: false, metaKey: false };

const input = (type: string) => ({ tagName: 'INPUT', type, isContentEditable: false });
const element = (tagName: string, isContentEditable = false) => ({ tagName, type: '', isContentEditable });

describe('isTypingField', () => {
  test('treats every input that takes text as a field the user is typing in', () => {
    for (const type of ['text', 'search', 'number', 'password', 'email', 'url', 'tel']) {
      expect(isTypingField(input(type))).toBe(true);
    }
    expect(isTypingField(element('TEXTAREA'))).toBe(true);
    expect(isTypingField(element('DIV', true))).toBe(true);
  });

  test('leaves switches, buttons, dropdowns and plain elements to the scanner', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color']) {
      expect(isTypingField(input(type))).toBe(false);
    }
    expect(isTypingField(element('SELECT'))).toBe(false);
    expect(isTypingField(element('BUTTON'))).toBe(false);
    expect(isTypingField(element('BODY'))).toBe(false);
    expect(isTypingField(null)).toBe(false);
  });
});

describe('keepsFocus', () => {
  test('keeps focus in typing fields and open dropdowns, and pulls it back from everything else', () => {
    expect(keepsFocus(input('password'))).toBe(true);
    expect(keepsFocus(element('SELECT'))).toBe(true);
    expect(keepsFocus(input('checkbox'))).toBe(false);
    expect(keepsFocus(element('BUTTON'))).toBe(false);
    expect(keepsFocus(null)).toBe(false);
  });

  test('keeps focus on buttons inside an area marked to keep it, such as the mobile scan overlay', () => {
    const inside = {
      ...element('BUTTON'),
      closest: (selector: string) => (selector === '[data-keep-focus]' ? {} : null),
    };
    const outside = { ...element('BUTTON'), closest: () => null };
    expect(keepsFocus(inside)).toBe(true);
    expect(keepsFocus(outside)).toBe(false);
  });
});

describe('returnsFocusWhenIdle', () => {
  // 下拉框展开时，鼠标在弹出的选项列表上动，页面收不到：看着像没人操作，拉回就把正在选的列表收起来了。
  test('leaves a dropdown alone, since its open list hides the pointer from the page', () => {
    expect(returnsFocusWhenIdle(element('SELECT'))).toBe(false);
  });

  test('pulls focus back from everything else, typing fields included', () => {
    expect(returnsFocusWhenIdle(input('search'))).toBe(true);
    expect(returnsFocusWhenIdle(element('BUTTON'))).toBe(true);
    expect(returnsFocusWhenIdle(element('BODY'))).toBe(true);
    expect(returnsFocusWhenIdle(null)).toBe(true);
  });
});

describe('isScannerCharacter', () => {
  test('accepts the printable characters a scanner types', () => {
    for (const key of ['C', 'l', '5', '-', '图']) {
      expect(isScannerCharacter({ ...KEY, key })).toBe(true);
    }
  });

  test('leaves shortcuts, navigation and space to the focused control', () => {
    expect(isScannerCharacter({ ...KEY, key: 'Enter' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'F2' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'Tab' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: ' ' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'c', ctrlKey: true })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'a', metaKey: true })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'x', altKey: true })).toBe(false);
  });
});

/** 可手动推进的假时钟：advance 按到期顺序触发计时器，并同步推进 now()。 */
function createClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    set(callback, ms) {
      const handle = nextHandle++;
      pending.set(handle, { at: now + ms, callback });
      return handle;
    },
    clear(handle) {
      pending.delete(handle);
    },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...pending].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      const [handle, timer] = due;
      now = timer.at;
      pending.delete(handle);
      timer.callback();
    }
    now = target;
  };
  return { timers, advance, now: () => now };
}

describe('IdleWatcher', () => {
  test('fires once the operator has been idle for the whole period', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(SCAN_FOCUS_IDLE_MS, () => idle++, clock.timers, clock.now);
    watcher.activity();
    clock.advance(SCAN_FOCUS_IDLE_MS - 1);
    expect(idle).toBe(0);
    clock.advance(1);
    expect(idle).toBe(1);
  });

  test('every activity restarts the period', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(10_000, () => idle++, clock.timers, clock.now);
    watcher.activity();
    clock.advance(6_000);
    watcher.activity();
    clock.advance(6_000);
    expect(idle).toBe(0);
    clock.advance(4_000);
    expect(idle).toBe(1);
  });

  test('fires again only after new activity followed by another idle period', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(10_000, () => idle++, clock.timers, clock.now);
    watcher.activity();
    clock.advance(30_000);
    expect(idle).toBe(1);
    watcher.activity();
    clock.advance(10_000);
    expect(idle).toBe(2);
  });

  test('stops after dispose', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(10_000, () => idle++, clock.timers, clock.now);
    watcher.activity();
    watcher.dispose();
    clock.advance(20_000);
    expect(idle).toBe(0);
  });
});
