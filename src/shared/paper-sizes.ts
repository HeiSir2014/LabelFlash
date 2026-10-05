/**
 * 纸张尺寸：模板用多大的纸、打印机装的是多大的纸，都用它描述。纸张用纸张键（宽x高）识别，尺寸相同就是同一种纸。
 *
 * 快递面单的尺寸和各联高度（切点）来自电商平台的标准电子面单说明和面单服务商公开的模板规格汇总（2026-09 查询，
 * 多个来源互相印证），并参考国家标准 GB/T 41833-2022《快递电子运单》。以各快递官方模板规范为准：
 * 做面单模板（第 3 个子项目）前取得官方规范，不一致就改这里。
 */

export interface PaperSize {
  widthMm: number;
  heightMm: number;
}

export interface PaperPreset extends PaperSize {
  name: string;
  /** 二联、三联面单默认的每一联高度（mm），从上到下；一联和普通标签为空。面单模板可以声明自己的切点。 */
  parts: readonly number[];
  /** 用在哪些地方（只用于显示）。 */
  usage: string;
}

/**
 * 自定义尺寸的范围：覆盖所有预设并留出余量。下限 25mm：边距最大 6mm 时，二维码仍放得下最小边长 10mm。
 * 宽度上限 120mm：不做横版纸（例如 150×100）。
 */
export const PAPER_LIMITS_MM = {
  width: { min: 25, max: 120 },
  height: { min: 25, max: 220 },
} as const;

/** 驱动以 0.1mm 为单位保存纸张尺寸，四舍五入后可能差零点几毫米。 */
export const PAPER_TOLERANCE_MM = 1;

/** 尺寸保留到 0.1mm：驱动和打印页面的精度都是这个量级；标签机指令的纸张、间隙也用它。 */
export const TENTHS_PER_MM = 10;

export const PAPER_PRESETS: readonly PaperPreset[] = [
  { name: '60×40 标签', widthMm: 60, heightMm: 40, parts: [], usage: '样衣标签（内置模板）' },
  { name: '50×30 标签', widthMm: 50, heightMm: 30, parts: [], usage: '小标签' },
  { name: '40×30 标签', widthMm: 40, heightMm: 30, parts: [], usage: '小标签' },
  { name: '70×50 标签', widthMm: 70, heightMm: 50, parts: [], usage: '标签' },
  { name: '100×100 标签', widthMm: 100, heightMm: 100, parts: [], usage: '标签、箱唛' },
  { name: '76×130 一联面单', widthMm: 76, heightMm: 130, parts: [], usage: '申通、极兔、中通、圆通、韵达' },
  { name: '100×150 二联面单', widthMm: 100, heightMm: 150, parts: [90, 60], usage: '顺丰、申通、EMS' },
  { name: '100×177 面单', widthMm: 100, heightMm: 177, parts: [107, 70], usage: '德邦' },
  {
    name: '100×180 二联面单',
    widthMm: 100,
    heightMm: 180,
    parts: [110, 70],
    usage: '申通、极兔、中通、圆通、韵达、顺丰、EMS',
  },
  { name: '100×203 二联面单', widthMm: 100, heightMm: 203, parts: [152, 51], usage: '韵达' },
  { name: '100×210 三联面单', widthMm: 100, heightMm: 210, parts: [90, 60, 60], usage: '顺丰' },
  { name: '100×110 二联面单', widthMm: 100, heightMm: 110, parts: [60, 50], usage: '京东' },
];

function roundMm(mm: number): number {
  return Math.round(mm * TENTHS_PER_MM) / TENTHS_PER_MM;
}

/** 纸张分配表的键：宽x高（毫米，去掉多余的 0），例如 60x40、76.5x130。 */
export function paperKey(paper: PaperSize): string {
  return `${roundMm(paper.widthMm)}x${roundMm(paper.heightMm)}`;
}

const PAPER_KEY_PATTERN = /^(\d+(?:\.\d)?)x(\d+(?:\.\d)?)$/;

export function parsePaperKey(key: string): PaperSize | null {
  const match = PAPER_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  const paper = { widthMm: Number(match[1]), heightMm: Number(match[2]) };
  return isWithinLimits(paper) ? paper : null;
}

export function isSamePaper(a: PaperSize, b: PaperSize): boolean {
  return (
    Math.abs(a.widthMm - b.widthMm) <= PAPER_TOLERANCE_MM && Math.abs(a.heightMm - b.heightMm) <= PAPER_TOLERANCE_MM
  );
}

export function findPreset(paper: PaperSize): PaperPreset | null {
  const key = paperKey(paper);
  return PAPER_PRESETS.find((preset) => paperKey(preset) === key) ?? null;
}

/** 例如「60×40 标签」；不是预设时「88×55」。 */
export function formatPaperName(paper: PaperSize): string {
  return findPreset(paper)?.name ?? `${roundMm(paper.widthMm)}×${roundMm(paper.heightMm)}`;
}

export function sanitizePaper(value: unknown, fallback: PaperSize): PaperSize {
  const copy = { widthMm: fallback.widthMm, heightMm: fallback.heightMm };
  if (typeof value !== 'object' || value === null) {
    return copy;
  }
  const input = value as Record<string, unknown>;
  const widthMm = input['widthMm'];
  const heightMm = input['heightMm'];
  if (typeof widthMm !== 'number' || typeof heightMm !== 'number') {
    return copy;
  }
  const paper = { widthMm: roundMm(widthMm), heightMm: roundMm(heightMm) };
  return isWithinLimits(paper) ? paper : copy;
}

function isWithinLimits(paper: PaperSize): boolean {
  const { width, height } = PAPER_LIMITS_MM;
  return (
    Number.isFinite(paper.widthMm) &&
    Number.isFinite(paper.heightMm) &&
    paper.widthMm >= width.min &&
    paper.widthMm <= width.max &&
    paper.heightMm >= height.min &&
    paper.heightMm <= height.max
  );
}
