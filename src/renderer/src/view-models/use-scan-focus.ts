import { type RefObject, useEffect, useRef } from 'react';
import { WINDOW_TIMERS } from '../lib/hover-intent';
import { IdleWatcher, isScannerCharacter, SCAN_FOCUS_IDLE_MS } from '../lib/scan-focus';

/** 焦点落到按钮、开关、空白处后，稍等一下再拉回：让点击和下拉框先完成自己的操作。 */
const REFOCUS_DELAY_MS = 300;
const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'number']);
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

function isTextEntry(element: Element | null): boolean {
  if (element instanceof HTMLInputElement) {
    return TEXT_ENTRY_TYPES.has(element.type);
  }
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

/**
 * 扫码框的焦点管理：扫码枪只会往当前焦点里「打字」，焦点不在扫码框，扫到的内容就丢了。
 * - 焦点落到按钮、开关、空白处：0.3 秒后拉回（否则扫码枪的回车会「点击」刚才的按钮）。
 * - 焦点不在任何输入框时按下可打印字符：立即切到扫码框，这个字符也落进扫码框，一个都不丢。
 * - 窗口在前台、鼠标和键盘都 10 秒没动：回到扫码框（设置、模板编辑里也一样，已填的内容不会丢）。
 * - 窗口重新获得焦点、焦点不在输入框：回到扫码框。
 * 自动回焦只移动焦点，不改动框里的内容和选区；全选只在操作员双击扫码框时发生。
 *
 * isActive 为 false（配置中心打开）时以上规则全部停用：管理员在填表，焦点留在他放的位置。
 * 重新变为 true（回到工作台）时焦点立即回到扫码框。
 */
export function useScanFocus(isActive: boolean): RefObject<HTMLTextAreaElement | null> {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    let isDisposed = false;
    // focus() 会恢复输入框上次的选区（不会全选），所以自动回焦不会让下一次扫码覆盖掉已有内容。
    const focusScanInput = () => {
      if (!isDisposed && document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    };

    const idle = new IdleWatcher(
      SCAN_FOCUS_IDLE_MS,
      () => {
        // 窗口在后台时不动焦点：操作员可能正在别的程序里打字。
        if (document.hasFocus()) {
          focusScanInput();
        }
      },
      WINDOW_TIMERS,
    );
    const onActivity = () => idle.activity();

    const onFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active !== inputRef.current && !isTextEntry(active)) {
          focusScanInput();
        }
      }, REFOCUS_DELAY_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isComposing && isScannerCharacter(event) && !isTextEntry(document.activeElement)) {
        // 在 keydown 阶段切换焦点：浏览器随后把这个字符输入到新的焦点里。
        focusScanInput();
      }
    };

    const onWindowFocus = () => {
      if (!isTextEntry(document.activeElement)) {
        focusScanInput();
      }
    };

    focusScanInput();
    idle.activity();
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      isDisposed = true;
      idle.dispose();
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [isActive]);

  return inputRef;
}
