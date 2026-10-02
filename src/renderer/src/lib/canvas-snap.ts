/**
 * 拖动和缩放时的吸附：靠近纸边、安全区、纸的中线、其他元素的边和中线时吸过去，并给出要画的参考线。
 * 网格只是显示，不吸网格（设计文档第 3.3 节列的吸附目标里没有网格；吸网格会和吸元素抢位置）。
 */
import { CANVAS_LIMITS } from '../../../core/templates/canvas-model';
import type { PaperSize } from '../../../shared/paper-sizes';
import type { Box, ResizeHandle } from './canvas-edit';
import { pxToMm } from './canvas-view';

/** 离参考线 6 个屏幕像素以内就吸过去：和常见设计软件的手感接近；按缩放换算成毫米，放大后吸得更准。 */
export const SNAP_DISTANCE_PX = 6;

/** 一条参考线：axis 为 x 时是竖线（位置是 x），为 y 时是横线。 */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

/** 能吸附的位置（mm）。 */
export interface SnapTargets {
  x: readonly number[];
  y: readonly number[];
}

/** 吸附后的框和要画的参考线。 */
export interface Snapped {
  box: Box;
  guides: Guide[];
}

/** 吸附距离：屏幕上的 SNAP_DISTANCE_PX 在这个缩放下是多少毫米。 */
export function snapThresholdMm(zoom: number): number {
  return pxToMm(SNAP_DISTANCE_PX, zoom);
}

/** 吸附目标：纸边、安全区、纸的中线，以及没在动的元素的边和中线。 */
export function snapTargets(paper: PaperSize, others: readonly Box[]): SnapTargets {
  const margin = CANVAS_LIMITS.safeMarginMm;
  return {
    x: [
      0,
      margin,
      paper.widthMm / 2,
      paper.widthMm - margin,
      paper.widthMm,
      ...others.flatMap((box) => [box.x, box.x + box.width / 2, box.x + box.width]),
    ],
    y: [
      0,
      margin,
      paper.heightMm / 2,
      paper.heightMm - margin,
      paper.heightMm,
      ...others.flatMap((box) => [box.y, box.y + box.height / 2, box.y + box.height]),
    ],
  };
}

interface Match {
  delta: number;
  at: number;
}

/** 在 edges（框上的几个位置）里找离某条参考线最近的一对；距离超过 threshold 不算。 */
function nearest(edges: readonly number[], targets: readonly number[], threshold: number): Match | null {
  let best: Match | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: target };
      }
    }
  }
  return best;
}

/** 移动时吸附：框的左边、中线、右边（上、中、下）离参考线够近就整个框挪过去。 */
export function snapMove(box: Box, targets: SnapTargets, threshold: number): Snapped {
  const x = nearest([box.x, box.x + box.width / 2, box.x + box.width], targets.x, threshold);
  const y = nearest([box.y, box.y + box.height / 2, box.y + box.height], targets.y, threshold);
  const guides: Guide[] = [];
  if (x !== null) {
    guides.push({ axis: 'x', at: x.at });
  }
  if (y !== null) {
    guides.push({ axis: 'y', at: y.at });
  }
  return { box: { ...box, x: box.x + (x?.delta ?? 0), y: box.y + (y?.delta ?? 0) }, guides };
}

/** 不超过 limit 的候选参考线（拖最小、最上的边时用：对边固定在更大的坐标上）。 */
function atMost(targets: readonly number[], limit: number): number[] {
  return targets.filter((target) => target <= limit);
}

/** 不小于 limit 的候选参考线（拖最大、最下的边时用：对边固定在更小的坐标上）。 */
function atLeast(targets: readonly number[], limit: number): number[] {
  return targets.filter((target) => target >= limit);
}

/**
 * 缩放时吸附：只吸正在拖的那条（那两条）边，对边不动。
 * 细线、小元素的对边离参考线很近时，直接吸过去会把尺寸压到最小尺寸以下（甚至翻过对边），
 * 所以候选参考线先按「不动的那条边减去/加上最小尺寸」筛过一遍，筛掉的目标当作不存在。
 */
export function snapResize(box: Box, handle: ResizeHandle, targets: SnapTargets, threshold: number): Snapped {
  const minSize = CANVAS_LIMITS.minSizeMm;
  let { x, y, width, height } = box;
  const guides: Guide[] = [];
  if (handle.includes('w')) {
    const match = nearest([x], atMost(targets.x, x + width - minSize), threshold);
    if (match !== null) {
      x += match.delta;
      width -= match.delta;
      guides.push({ axis: 'x', at: match.at });
    }
  } else if (handle.includes('e')) {
    const match = nearest([x + width], atLeast(targets.x, x + minSize), threshold);
    if (match !== null) {
      width += match.delta;
      guides.push({ axis: 'x', at: match.at });
    }
  }
  if (handle.includes('n')) {
    const match = nearest([y], atMost(targets.y, y + height - minSize), threshold);
    if (match !== null) {
      y += match.delta;
      height -= match.delta;
      guides.push({ axis: 'y', at: match.at });
    }
  } else if (handle.includes('s')) {
    const match = nearest([y + height], atLeast(targets.y, y + minSize), threshold);
    if (match !== null) {
      height += match.delta;
      guides.push({ axis: 'y', at: match.at });
    }
  }
  return { box: { x, y, width, height }, guides };
}
