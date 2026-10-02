import { describe, expect, test } from 'bun:test';
import { NO_RENDER_WARNINGS, renderWarningTexts } from './render-warnings';

describe('renderWarningTexts', () => {
  test('says nothing when the label rendered completely', () => {
    expect(renderWarningTexts(NO_RENDER_WARNINGS)).toEqual([]);
  });

  test('lists each problem once, with the number of truncated cells', () => {
    expect(renderWarningTexts({ qrOmitted: true, barcodeOmitted: true, overflowCells: 2, issues: [] })).toEqual([
      '内容太长，二维码放不下，这张标签不印二维码',
      '条码放不下，或内容里有条码印不了的字（例如中文），这张不印条码',
      '有 2 格内容放不下，已截断：加大这一格或调小字号',
    ]);
  });

  test('shows only the per-element checks of a canvas template, not the generic texts', () => {
    // 自由设计模板：issues 已经逐条写清楚是哪个元素、怎么了；qrOmitted/barcodeOmitted/overflowCells
    // 这类笼统文案这时反而可能对不上号（例如下面这条其实是条码的问题，不是二维码），不重复显示。
    expect(
      renderWarningTexts({
        qrOmitted: true,
        barcodeOmitted: false,
        overflowCells: 1,
        issues: ['条码「商品码」不印：EAN-13（商品条码）：位数不对'],
      }),
    ).toEqual(['条码「商品码」不印：EAN-13（商品条码）：位数不对']);
  });

  test('shows every per-element check when there is more than one', () => {
    expect(
      renderWarningTexts({
        ...NO_RENDER_WARNINGS,
        issues: ['「字段 A」靠近纸边（离纸边不到 1.5mm），可能打不全', '条码「商品码」不印：框不够宽'],
      }),
    ).toEqual(['「字段 A」靠近纸边（离纸边不到 1.5mm），可能打不全', '条码「商品码」不印：框不够宽']);
  });
});
