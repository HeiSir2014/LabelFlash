import { describe, expect, test } from 'bun:test';
import { BELOW_CODE_AREA } from '../../../core/scan/image-text';
import { areaForPreset, describeArea, presetOf } from './image-text-area';

describe('image text areas', () => {
  test('maps presets to areas and back', () => {
    for (const preset of ['below', 'above', 'left', 'right'] as const) {
      expect(presetOf(areaForPreset(preset, null))).toBe(preset);
    }
    expect(areaForPreset('none', BELOW_CODE_AREA)).toBeNull();
    expect(presetOf(null)).toBe('none');
  });

  test('starts a custom area from the current one', () => {
    const current = { left: 0, top: 1.2, right: 2, bottom: 1.8 };
    expect(areaForPreset('custom', current)).toEqual(current);
    expect(presetOf(current)).toBe('custom');
    expect(areaForPreset('custom', null)).toEqual(BELOW_CODE_AREA);
  });

  test('describes the area in a step summary', () => {
    expect(describeArea(null)).toBe('整张标签');
    expect(describeArea(BELOW_CODE_AREA)).toBe('优先二维码下方');
    expect(describeArea({ left: 0, top: 1.2, right: 2, bottom: 1.8 })).toBe('优先自定义');
  });
});
