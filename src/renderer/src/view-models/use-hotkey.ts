import { useEffect, useRef } from 'react';

interface HotkeyOptions {
  /** false 时不响应（例如配置中心打开时工作台的 F2）。 */
  enabled?: boolean;
}

/** 全局快捷键；handler 始终取最新闭包，不需要重复注册。 */
export function useHotkey(key: string, handler: () => void, { enabled = true }: HotkeyOptions = {}): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === key && !event.repeat) {
        event.preventDefault();
        handlerRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, enabled]);
}
