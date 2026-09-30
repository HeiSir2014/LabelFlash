import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../../core/scan/scan-result';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { describePreviewUsage } from './preview-usage';

const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [],
};

function preview(overrides: Partial<LabelPreview> = {}): LabelPreview {
  return {
    result: {
      status: 'ok',
      scan: SCAN,
      recent: null,
      lookupFailure: null,
      printer: { printerName: '热敏标签机', reason: 'paper' },
    },
    html: '<html></html>',
    templateId: 'builtin:standard',
    templateName: '样衣标准（二维码在左）',
    isTemplateBound: true,
    qrOmitted: false,
    paper: { widthMm: 60, heightMm: 40 },
    ...overrides,
  };
}
const ACTIVE = 'builtin:generic';

describe('describePreviewUsage', () => {
  // 模板只显示一处：下拉框显示这一张实际用的模板。原来下拉框写当前模板、旁边又写规则指定的模板，两处对不上。
  test('shows the template the rule chose in the template box and locks it', () => {
    expect(describePreviewUsage(preview(), ACTIVE)).toEqual({
      source: '规则：横杠三段（编码-颜色-尺码）',
      templateId: 'builtin:standard',
      isRuleBound: true,
    });
  });

  test('leaves the current template selectable when the rule does not choose one', () => {
    const unbound = preview({ templateId: ACTIVE, templateName: '通用（二维码在左）', isTemplateBound: false });
    expect(describePreviewUsage(unbound, ACTIVE)).toEqual({
      source: '规则：横杠三段（编码-颜色-尺码）',
      templateId: ACTIVE,
      isRuleBound: false,
    });
  });

  test('says the sample is shown before anything is scanned', () => {
    expect(describePreviewUsage(null, ACTIVE)).toEqual({ source: '示例内容', templateId: ACTIVE, isRuleBound: false });
  });

  test('names no source for a scan that could not be recognised', () => {
    const invalid = preview({
      result: { status: 'invalid', reason: 'INVALID_CONTENT' },
      templateId: null,
      templateName: null,
    });
    expect(describePreviewUsage(invalid, ACTIVE)).toEqual({ source: null, templateId: ACTIVE, isRuleBound: false });
  });
});
