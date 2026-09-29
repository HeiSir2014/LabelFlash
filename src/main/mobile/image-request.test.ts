import { describe, expect, test } from 'bun:test';
import type { EnrichStep } from '../../core/scan/enrich-model';
import { LABEL_AREA, SHELF_NUMBER_PATTERN } from '../../core/scan/image-text';
import { PIXELS_PER_CODE, phoneImageRequest } from './image-request';

const SHELF: EnrichStep = {
  kind: 'imageText',
  pattern: SHELF_NUMBER_PATTERN,
  flags: '',
  preferredArea: null,
  whenMissing: 'block',
  output: '货架号',
};
const TEMPLATE: EnrichStep = { kind: 'template', text: 'x', output: 'y' };

describe('phoneImageRequest', () => {
  test('asks for the whole label when an enabled rule reads text from it', () => {
    expect(phoneImageRequest([[TEMPLATE], [SHELF]], true)).toEqual({
      area: LABEL_AREA,
      pixelsPerCode: PIXELS_PER_CODE,
    });
  });

  test('does not ask when no rule needs the image', () => {
    expect(phoneImageRequest([[TEMPLATE], []], true)).toBeNull();
  });

  // macOS 这一版没有打包 OCR：要了图也读不了，不让手机白截。
  test('does not ask when this computer cannot read images', () => {
    expect(phoneImageRequest([[SHELF]], false)).toBeNull();
  });
});
