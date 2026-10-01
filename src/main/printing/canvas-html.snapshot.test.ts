import { describe, expect, test } from 'bun:test';
import { BUILT_IN_CANVAS_TEMPLATES } from '../../core/templates/builtin-canvas';
import { renderCanvasHtml } from './canvas-html';

const SCAN = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
    { name: '货架号', value: 'A-1-2-3' },
  ],
};
// 用本地时间：{日期} 按本地时区显示（和标签快照一样的理由）。
const PRINTED_AT = new Date(2026, 9, 1, 9, 5).getTime();

describe('built-in canvas template HTML stays the same', () => {
  for (const template of BUILT_IN_CANVAS_TEMPLATES) {
    test(template.name, () => {
      const rendered = renderCanvasHtml({ scan: SCAN, template, printedAt: PRINTED_AT });
      expect(rendered.issues).toEqual([]);
      expect(rendered.html).toMatchSnapshot();
    });
  }
});
