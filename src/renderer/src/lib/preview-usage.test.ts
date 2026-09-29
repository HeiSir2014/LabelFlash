import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../../core/scan/scan-result';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { describePreviewPrinter, describePreviewUsage, usageText } from './preview-usage';

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
    templateName: '样衣标准（二维码在左）',
    isTemplateBound: true,
    qrOmitted: false,
    paper: { widthMm: 60, heightMm: 40 },
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
      printer: '打印机：热敏标签机',
    });
    const unbound = preview({ templateName: '通用（二维码在左）', isTemplateBound: false });
    expect(text(unbound, '通用（二维码在左）')).toBe(
      '规则：横杠三段（编码-颜色-尺码） · 模板：通用（二维码在左） · 打印机：热敏标签机',
    );
  });

  test('shows the sample and the current template before anything is scanned', () => {
    expect(text(null, '通用（二维码在左）')).toBe('示例内容 · 模板：通用（二维码在左）');
    const sample = describePreviewUsage(null, '通用（二维码在左）', { printerName: '标签机A', reason: 'paper' });
    expect(sample && usageText(sample)).toBe('示例内容 · 模板：通用（二维码在左） · 打印机：标签机A');
    expect(describePreviewUsage(null, null)).toBeNull();
  });

  test('says nothing for a scan that could not be recognised', () => {
    const invalid = preview({ result: { status: 'invalid', reason: 'INVALID_CONTENT' }, templateName: null });
    expect(describePreviewUsage(invalid, '通用（二维码在左）')).toBeNull();
  });
});

describe('describePreviewPrinter', () => {
  test('names the printer the label goes to', () => {
    expect(describePreviewPrinter({ printerName: '面单机B', reason: 'paper' })).toBe('打印机：面单机B');
  });

  test('explains a fallback from a missing template printer', () => {
    const choice = { printerName: '面单机B', reason: 'template-missing', missingPrinter: '面单机D' } as const;
    expect(describePreviewPrinter(choice)).toBe('打印机：面单机B（模板指定的 面单机D 不在这台电脑上）');
  });

  test('says when there is no printer', () => {
    const choice = { printerName: null, reason: 'unassigned', paperKey: '100x180', missingPrinter: null } as const;
    expect(describePreviewPrinter(choice)).toBe('打印机：还没有');
  });

  test('uses the name the system displays', () => {
    expect(describePreviewPrinter({ printerName: 'Label_Printer_01', reason: 'paper' }, () => '标签机A')).toBe(
      '打印机：标签机A',
    );
  });
});
