import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type RunResult, ScannerRun } from '../lib/scanner-keys';

interface ImeScanRescueOptions {
  /** 扫码枪一串按键之后停这么久，算扫完（和多行扫码的停顿同一个设置）。 */
  lineGapMs: number;
  /** 按键时框里现有的内容：接管的一串从这里开始，前面已有的内容保留。 */
  content: () => string;
  /** 拼出来了：框里已有的内容 + 扫码枪实际发出的内容（不含结尾的回车）。 */
  onRebuilt: (raw: string) => void;
  /** 输入法截走了扫码枪的按键，又拼不出来：没有提交，要提醒操作员。 */
  onUnreadable: () => void;
}

/**
 * 输入法开着时扫码：按物理按键把扫码枪发出的内容拼回来（规则见 lib/scanner-keys.ts）。
 * macOS 的扫码框和 Windows 的手动编辑模式是普通输入框，输入法开着；扫码模式的密码框里输入法关着，这里不会接管。
 */
export function useImeScanRescue({ lineGapMs, content, onRebuilt, onUnreadable }: ImeScanRescueOptions) {
  const [run] = useState(() => new ScannerRun());
  const timer = useRef<number | null>(null);
  const handlers = useRef({ onRebuilt, onUnreadable });
  useEffect(() => {
    handlers.current = { onRebuilt, onUnreadable };
  });
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const finish = () => {
    timer.current = null;
    const result: RunResult = run.finish();
    if (result.kind === 'rebuilt') {
      handlers.current.onRebuilt(result.contentBefore + result.text);
    } else if (result.kind === 'unreadable') {
      handlers.current.onUnreadable();
    }
  };

  /** 在输入框的 keydown 里最先调用：返回 true 表示这个键已被接管，调用方不要再交给输入框和扫码拼接。 */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    const decision = run.keyDown(
      {
        code: event.code,
        key: event.key,
        shift: event.shiftKey,
        caps: event.getModifierState('CapsLock'),
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        at: event.timeStamp,
      },
      content(),
    );
    if (decision === 'pass') {
      return false;
    }
    event.preventDefault();
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(finish, lineGapMs);
    return true;
  };

  return { onKeyDown };
}
