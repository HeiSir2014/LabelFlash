import { type RefObject, useEffect, useState } from 'react';
import { PX_PER_MM } from '../lib/canvas-view';

/** 容器再小也不把标签缩到一半以下，否则字段看不清。 */
const MIN_SCALE = 0.5;

/** 让 widthMm × heightMm 的内容在容器里按实物比例尽量放大显示（不超过 maxScale）。 */
export function useFitScale(
  containerRef: RefObject<HTMLElement | null>,
  widthMm: number,
  heightMm: number,
  maxScale: number,
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      const fit = Math.min(width / (widthMm * PX_PER_MM), height / (heightMm * PX_PER_MM), maxScale);
      setScale(Math.max(fit, MIN_SCALE));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, widthMm, heightMm, maxScale]);

  return scale;
}
