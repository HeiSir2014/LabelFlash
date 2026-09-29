import { BELOW_CODE_AREA, type CodeRelativeArea } from '../../../core/scan/image-text';

/** 「优先查找」的预设：单位是二维码边长，原点是二维码左上角（见 core/scan/image-text.ts）。 */
export const AREA_PRESETS = ['none', 'below', 'above', 'left', 'right', 'custom'] as const;
export type AreaPreset = (typeof AREA_PRESETS)[number];

export const AREA_PRESET_LABELS: Record<AreaPreset, string> = {
  none: '不分先后（整张标签）',
  below: '二维码下方',
  above: '二维码上方',
  left: '二维码左侧',
  right: '二维码右侧',
  custom: '自定义',
};

const PRESET_AREAS: Record<Exclude<AreaPreset, 'none' | 'custom'>, CodeRelativeArea> = {
  below: BELOW_CODE_AREA,
  above: { left: -0.1, top: -0.6, right: 1.1, bottom: 0 },
  left: { left: -2.5, top: -0.1, right: 0, bottom: 1.1 },
  right: { left: 1, top: -0.1, right: 3.5, bottom: 1.1 },
};

/** 选了某个预设之后的区域；自定义从当前区域（或「二维码下方」）开始改。 */
export function areaForPreset(preset: AreaPreset, current: CodeRelativeArea | null): CodeRelativeArea | null {
  switch (preset) {
    case 'none':
      return null;
    case 'custom':
      return current ?? BELOW_CODE_AREA;
    default:
      return PRESET_AREAS[preset];
  }
}

/** 区域对应哪个预设：和某个预设完全一样就是它，否则是自定义。 */
export function presetOf(area: CodeRelativeArea | null): AreaPreset {
  if (area === null) {
    return 'none';
  }
  const same = (a: CodeRelativeArea, b: CodeRelativeArea) =>
    a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  const found = (Object.keys(PRESET_AREAS) as Array<keyof typeof PRESET_AREAS>).find((key) =>
    same(PRESET_AREAS[key], area),
  );
  return found ?? 'custom';
}

/** 步骤摘要里的一小段：「优先二维码下方」。 */
export function describeArea(area: CodeRelativeArea | null): string {
  const preset = presetOf(area);
  return preset === 'none' ? '整张标签' : `优先${AREA_PRESET_LABELS[preset]}`;
}
