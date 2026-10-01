import { describe, expect, test } from 'bun:test';
import { NO_RENDER_WARNINGS, renderWarningTexts } from './render-warnings';

describe('renderWarningTexts', () => {
  test('says nothing when the label rendered completely', () => {
    expect(renderWarningTexts(NO_RENDER_WARNINGS)).toEqual([]);
  });

  test('lists each problem once, with the number of truncated cells', () => {
    expect(renderWarningTexts({ qrOmitted: true, barcodeOmitted: true, overflowCells: 2 })).toEqual([
      '内容太长，二维码放不下，这张标签不印二维码',
      '条码放不下，或内容里有条码印不了的字（例如中文），这张不印条码',
      '有 2 格内容放不下，已截断：加大这一格或调小字号',
    ]);
  });
});
