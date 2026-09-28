import { useEffect, useRef } from 'react';
import { HOVER_PREVIEW_DELAY_MS, HoverIntent, WINDOW_TIMERS } from '../lib/hover-intent';

/**
 * 列表项的悬停预览：返回 enter(id) / leave()。组件卸载（切走标签页、进入编辑）时自动清除预览。
 * HoverIntent 在组件生命周期内只创建一次；onChange 经 ref 取最新值（在 effect 里更新，不在渲染中改 ref）。
 */
export function useHoverPreview(onChange: (id: string | null) => void): HoverIntent<string> {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const intent = useRef<HoverIntent<string> | null>(null);
  if (intent.current === null) {
    intent.current = new HoverIntent<string>(HOVER_PREVIEW_DELAY_MS, (id) => latest.current(id), WINDOW_TIMERS);
  }
  useEffect(() => {
    const current = intent.current;
    return () => current?.leave();
  }, []);
  return intent.current;
}
