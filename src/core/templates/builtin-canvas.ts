import { DEFAULT_PAPER } from '../../shared/label-paper';
import type { CanvasElementBase, CanvasTemplate } from './canvas-model';
import { BUILT_IN_TEMPLATE_PREFIX } from './template-model';

/**
 * 内置的自由设计模板（只读，复制后修改）。这里只有一个示例，完整的模板库是子项目 2。
 * 坐标都在 1.5mm 安全区内（打印前检查不报问题，快照测试把关）。
 */

function box(id: string, name: string, x: number, y: number, width: number, height: number): CanvasElementBase {
  return { id, name, x, y, width, height, rotation: 0, locked: false };
}

/** 吊牌示例 60×40：编码大字、颜色尺码表格、Code128、二维码、分隔线、货架号和日期。 */
export const CANVAS_TAG: CanvasTemplate = {
  kind: 'canvas',
  id: `${BUILT_IN_TEMPLATE_PREFIX}canvas-tag`,
  name: '吊牌（自由设计示例）',
  paper: { ...DEFAULT_PAPER },
  printer: null,
  elements: [
    {
      ...box('code', '编码', 2, 2, 38, 7),
      kind: 'text',
      text: '{编码}',
      fontSizeMm: 5,
      bold: true,
      align: 'left',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    },
    { ...box('qr', '二维码', 44, 2, 14, 14), kind: 'qr', value: '{完整内容}', errorCorrection: 'M' },
    {
      ...box('spec', '颜色尺码', 2, 10, 38, 10),
      kind: 'table',
      rowsMm: [5, 0],
      columnsMm: [12, 0],
      borderMm: 0.25,
      cells: [
        [
          { text: '颜色', fontSizeMm: 2.8, bold: true, align: 'left' },
          { text: '{颜色}', fontSizeMm: 2.8, bold: false, align: 'left' },
        ],
        [
          { text: '尺码', fontSizeMm: 2.8, bold: true, align: 'left' },
          { text: '{尺码}', fontSizeMm: 2.8, bold: false, align: 'left' },
        ],
      ],
    },
    {
      ...box('barcode', '编码条码', 2, 21.5, 56, 12),
      kind: 'barcode',
      symbology: 'code128',
      value: '{编码}',
      showText: true,
      textSizeMm: 2.5,
    },
    { ...box('rule', '分隔线', 2, 34, 56, 0.25), kind: 'line', dashed: false },
    {
      ...box('shelf', '货架号', 2, 34.6, 36, 3.6),
      kind: 'text',
      text: '货架号 {货架号}',
      fontSizeMm: 2.6,
      bold: true,
      align: 'left',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    },
    {
      ...box('date', '日期', 40, 34.6, 18, 3.6),
      kind: 'text',
      text: '{日期}',
      fontSizeMm: 2.4,
      bold: false,
      align: 'right',
      valign: 'middle',
      fit: 'shrink',
      inverse: false,
    },
  ],
};

export const BUILT_IN_CANVAS_TEMPLATES: readonly CanvasTemplate[] = [CANVAS_TAG];
