import { type RefObject, useEffect, useRef } from 'react';
import {
  type FocusTarget,
  IdleWatcher,
  isScannerCharacter,
  isTypingField,
  keepsFocus,
  returnsFocusWhenIdle,
  SCAN_FOCUS_IDLE_MS,
} from '../lib/scan-focus';
import { WINDOW_TIMERS } from '../lib/timers';

/** 焦点落到按钮、开关、空白处后，稍等一下再拉回：让点击和下拉框先完成自己的操作。 */
const REFOCUS_DELAY_MS = 300;
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
/** 「把焦点还给扫码框」的请求：浮层这类组件关闭时发出，不需要拿到扫码框的 ref。 */
const SCAN_FOCUS_REQUEST_EVENT = 'labelflash:scan-focus';

/** 立即把焦点还给扫码框（例如关掉「手机扫码」浮层时）；工作台不在前台时不起作用。 */
export function returnFocusToScanBox(): void {
  window.dispatchEvent(new Event(SCAN_FOCUS_REQUEST_EVENT));
}

/** 当前焦点所在的元素，交给 lib/scan-focus 的规则判断。 */
export function activeFocusTarget(): FocusTarget | null {
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/**
 * 扫码框的焦点管理：扫码枪只会往当前焦点里「打字」，焦点不在扫码框，扫到的内容就丢了。
 * - 焦点落到按钮、开关、空白处：0.3 秒后拉回（否则扫码枪的回车会「点击」刚才的按钮）。
 * - 焦点不在输入框（下拉框也不算）时按下可打印字符：立即切到扫码框，这个字符也落进扫码框，一个都不丢。
 * - 窗口在前台、鼠标和键盘都 10 秒没动：回到扫码框（已填的内容不会丢）；焦点在下拉框里时不拉回（可能正展开着）。
 * - 窗口重新获得焦点、焦点不在输入框和下拉框：回到扫码框。
 * - 标了 data-keep-focus 的区域（「手机扫码」浮层）里的按钮不拉回，键盘能在里面操作；关掉浮层时它调用
 *   returnFocusToScanBox 立即回到扫码框。
 * 自动回焦只移动焦点，不改动框里的内容和选区；全选只在操作员双击扫码框时发生。
 *
 * isActive 为 false（配置中心打开）时以上规则全部停用：管理员在填表，焦点留在他放的位置。
 * 重新变为 true（回到工作台）时焦点立即回到扫码框。
 */
export function useScanFocus(isActive: boolean): RefObject<HTMLInputElement | null> {
  const inputRef = useRef<HTMLInputElement>(null);

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
        // 窗口在后台时不动焦点：操作员可能正在别的程序里打字。下拉框可能正展开着，不拉回（见 returnsFocusWhenIdle）。
        if (document.hasFocus() && returnsFocusWhenIdle(activeFocusTarget())) {
          focusScanInput();
        }
      },
      WINDOW_TIMERS,
    );
    const onActivity = () => idle.activity();

    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!keepsFocus(activeFocusTarget())) {
          focusScanInput();
        }
      }, REFOCUS_DELAY_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isComposing && isScannerCharacter(event) && !isTypingField(activeFocusTarget())) {
        // 在 keydown 阶段切换焦点：浏览器随后把这个字符输入到新的焦点里。
        focusScanInput();
      }
    };

    const onWindowFocus = () => {
      if (!keepsFocus(activeFocusTarget())) {
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
    window.addEventListener(SCAN_FOCUS_REQUEST_EVENT, focusScanInput);
    return () => {
      window.removeEventListener(SCAN_FOCUS_REQUEST_EVENT, focusScanInput);
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
