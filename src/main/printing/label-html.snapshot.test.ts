import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../core/scan/scan-result';
import { BUILT_IN_TEMPLATES } from '../../core/templates/builtin-templates';
import { renderLabelHtml } from './label-html';

const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};
// 用本地时间：{日期}、{时间} 按本地时区显示，用 UTC 时间戳的话东八区录的快照到 UTC 的 CI 上会对不上。
const PRINTED_AT = new Date(2026, 8, 29, 9, 5).getTime();

// 支持多种纸张以后，60×40 的每个内置模板必须和现在一字不差：操作员天天在打的标签不能变。
describe('60x40 label HTML stays the same', () => {
  for (const template of BUILT_IN_TEMPLATES) {
    test(template.name, () => {
      expect(renderLabelHtml({ scan: SCAN, template, printedAt: PRINTED_AT }).html).toMatchSnapshot();
    });
  }
});
