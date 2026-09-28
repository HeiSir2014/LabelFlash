import { useSyncExternalStore } from 'react';

/** 某个 CSS 媒体查询当前是否成立，窗口尺寸变化时自动更新。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
