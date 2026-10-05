import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';
import { CANVAS_TAG } from '../builtin-canvas';
import { barcode, hLine, pairTable, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry } from './library-model';

/** 样衣码的示例字段：和内置规则「横杠三段」识别 SAMPLE_LABEL_RAW 的结果一致，再加手机读到的货架号。 */
const GARMENT_FIELDS = { 编码: 'CL5640-TK', 颜色: '图片色', 尺码: 'XL', 货架号: 'A-1-2-3' } as const;

/**
 * 服装吊牌。字段名和内置规则「横杠三段」一致：扫样衣码就能打。
 * 合格证按服装标识的常见内容排：品名、款号、号型、成分、执行标准、等级、安全类别、零售价。
 */
export const GARMENT_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'garment',
    slug: 'garment-sample-tag',
    name: '样衣吊牌',
    description: '编码大字、颜色尺码、Code128、二维码、货架号；扫样衣码直接能打',
    paper: { widthMm: 60, heightMm: 40 },
    // 和内置的「吊牌（自由设计示例）」同一个版式：内置那个可以直接设为当前模板，这里是复制来改的起点。
    elements: CANVAS_TAG.elements,
    sample: { content: SAMPLE_LABEL_RAW, fields: GARMENT_FIELDS },
  }),
  libraryEntry({
    category: 'garment',
    slug: 'garment-certificate',
    name: '服装合格证',
    description: '品名、款号、颜色、号型、成分、执行标准、等级、安全类别、零售价',
    paper: { widthMm: 70, heightMm: 50 },
    elements: [
      text('title', '标题', [2, 2, 66, 6], '合 格 证', { fontSizeMm: 4, bold: true, align: 'center', inverse: true }),
      pairTable(
        'info',
        '参数',
        [2, 9.5, 44, 30],
        12,
        [
          ['品名', '{品名}'],
          ['款号', '{编码}'],
          ['颜色', '{颜色}'],
          ['号型', '{尺码}'],
          ['成分', '{成分}'],
          ['标准', '{执行标准}'],
        ],
        2.6,
      ),
      qr('qr', '二维码', [49, 9.5, 19, 19], '{编码}'),
      text('grade', '等级', [48, 30, 20, 4], '等级 {等级}', { fontSizeMm: 2.6 }),
      text('safety', '安全类别', [48, 35, 20, 4], '{安全类别}', { fontSizeMm: 2.6 }),
      hLine('rule', '分隔线', 2, 41, 66),
      text('price', '零售价', [2, 42, 66, 6], '零售价 ¥{价格}', { fontSizeMm: 4.5, bold: true, align: 'right' }),
    ],
    sample: {
      content: 'CL5640-TK',
      fields: {
        品名: '女式连衣裙',
        编码: 'CL5640-TK',
        颜色: '图片色',
        尺码: '165/88A',
        成分: '面料 100%棉',
        执行标准: 'FZ/T 81004-2022',
        等级: '合格品',
        安全类别: 'GB 18401 B类',
        价格: '399.00',
      },
    },
  }),
  libraryEntry({
    category: 'garment',
    slug: 'garment-simple-tag',
    name: '简洁吊牌',
    description: '编码、颜色尺码、Code128、货架号，50×30 小吊牌',
    paper: { widthMm: 50, heightMm: 30 },
    elements: [
      text('code', '编码', [2, 2, 46, 6], '{编码}', { fontSizeMm: 4.5, bold: true }),
      text('spec', '颜色尺码', [2, 8.5, 46, 4], '{颜色}  {尺码}'),
      barcode('barcode', '编码条码', [2, 13, 46, 12], 'code128', '{编码}', 2.2),
      text('shelf', '货架号', [2, 25, 46, 3], '货架号 {货架号}', { fontSizeMm: 2.4 }),
    ],
    sample: { content: SAMPLE_LABEL_RAW, fields: GARMENT_FIELDS },
  }),
];
