import { useEffect, useRef } from 'react';

/** 全局快捷键；handler 始终取最新闭包，不需要重复注册。 */
export function useHotkey(key: string, handler: () => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === key && !event.repeat) {
        event.preventDefault();
        handlerRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key]);
}
