import { useCallback, useSyncExternalStore } from 'react';

/** 某个 CSS 媒体查询当前是否成立，窗口尺寸变化时自动更新。 */
export function useMediaQuery(query: string): boolean {
  // 订阅函数保持同一个引用：否则每次重新渲染（每次扫码、每次按键）React 都会退订再重新订阅。
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
