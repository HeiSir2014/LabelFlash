import { type ImageMode, ROTATIONS, type TextFit } from '../../../../core/templates/canvas-model';
import type { QrErrorLevel, TextAlign } from '../../../../core/templates/template-model';
import type { VerticalAlign } from '../../../../core/templates/waybill-model';

/** 属性栏里分段按钮的选项（文字、表格格子共用）。 */
export const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

export const VALIGN_OPTIONS: ReadonlyArray<{ value: VerticalAlign; label: string }> = [
  { value: 'top', label: '靠上' },
  { value: 'middle', label: '居中' },
];

export const FIT_OPTIONS: ReadonlyArray<{ value: TextFit; label: string }> = [
  { value: 'shrink', label: '缩小' },
  { value: 'wrap', label: '折行' },
];

/**
 * 二维码容错：选项上只写一两个字，检查器窄的时候（1024 宽、260px）也不折行；能恢复多少、码会变多密在悬停提示里，
 * 选的时候知道代价。
 */
export const QR_LEVEL_OPTIONS: ReadonlyArray<{ value: QrErrorLevel; label: string; hint: string }> = [
  { value: 'L', label: '低', hint: '容错低（L）：污损约 7% 还能扫，码最疏' },
  { value: 'M', label: '中', hint: '容错中（M）：污损约 15% 还能扫' },
  { value: 'Q', label: '较高', hint: '容错较高（Q）：污损约 25% 还能扫' },
  { value: 'H', label: '高', hint: '容错高（H）：污损约 30% 还能扫，码最密' },
];

export const IMAGE_MODE_OPTIONS: ReadonlyArray<{ value: ImageMode; label: string }> = [
  { value: 'threshold', label: '阈值' },
  { value: 'dither', label: '抖动' },
];

export const ROTATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = ROTATIONS.map((rotation) => ({
  value: String(rotation),
  label: `${rotation}°`,
}));

/** 位置和大小按 0.1mm 调：和方向键一步一样。 */
export const POSITION_STEP_MM = 0.1;
/** 字号按 0.1mm 调：热敏纸上能分辨的字号差。 */
export const FONT_STEP_MM = 0.1;
/** 边框按 0.05mm 调：203dpi 一个点约 0.125mm，再细调没有意义。 */
export const BORDER_STEP_MM = 0.05;
/** 圆角按 0.5mm 调。 */
export const RADIUS_STEP_MM = 0.5;
