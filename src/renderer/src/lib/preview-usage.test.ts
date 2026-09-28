import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../../core/scan/scan-result';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { describePreviewUsage, usageText } from './preview-usage';

const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [],
};

function preview(overrides: Partial<LabelPreview> = {}): LabelPreview {
  return {
    result: { status: 'ok', scan: SCAN, recent: null, lookupFailure: null },
    html: '<html></html>',
    templateName: '样衣标准（二维码在左）',
    isTemplateBound: true,
    qrOmitted: false,
    ...overrides,
  };
}

function text(value: LabelPreview | null, activeTemplateName: string | null): string | null {
  const usage = describePreviewUsage(value, activeTemplateName);
  return usage && usageText(usage);
}

describe('describePreviewUsage', () => {
  test('names the rule and the template, marking a template chosen by the rule', () => {
    expect(describePreviewUsage(preview(), '通用（二维码在左）')).toEqual({
      source: '规则：横杠三段（编码-颜色-尺码）',
      template: '模板：样衣标准（二维码在左）（规则指定）',
    });
    const unbound = preview({ templateName: '通用（二维码在左）', isTemplateBound: false });
    expect(text(unbound, '通用（二维码在左）')).toBe('规则：横杠三段（编码-颜色-尺码） · 模板：通用（二维码在左）');
  });

  test('shows the sample and the current template before anything is scanned', () => {
    expect(text(null, '通用（二维码在左）')).toBe('示例内容 · 模板：通用（二维码在左）');
    expect(describePreviewUsage(null, null)).toBeNull();
  });

  test('says nothing for a scan that could not be recognised', () => {
    const invalid = preview({ result: { status: 'invalid', reason: 'INVALID_CONTENT' }, templateName: null });
    expect(describePreviewUsage(invalid, '通用（二维码在左）')).toBeNull();
  });
});
