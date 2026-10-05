import { barcode, hLine, pairTable, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 价签。明码标价签按要素排：品名、产地、规格、等级、计价单位、零售价。 */
export const PRICE_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'price',
    slug: 'price-simple',
    name: '简洁价签',
    description: '品名、大号价格、EAN-13',
    paper: { widthMm: 40, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 36, 5], '{品名}', { fontSizeMm: 3.2, bold: true }),
      text('price', '价格', [2, 7.5, 36, 10], '¥{价格}', { fontSizeMm: 8, bold: true, align: 'center' }),
      barcode('barcode', '商品码', [2, 18, 36, 10], 'ean13', '{商品码}', 2),
    ],
    sample: { content: SAMPLE_EAN13, fields: { 品名: '纯棉袜子', 价格: '12.80', 商品码: SAMPLE_EAN13 } },
  }),
  libraryEntry({
    category: 'price',
    slug: 'price-standard',
    name: '明码标价签',
    description: '品名、产地、规格、等级、单位、零售价、EAN-13，按明码标价的要素排',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('name', '品名', [2, 2, 56, 6], '{品名}', { fontSizeMm: 4, bold: true }),
      pairTable(
        'info',
        '参数',
        [2, 8.5, 30, 20],
        10,
        [
          ['产地', '{产地}'],
          ['规格', '{规格}'],
          ['等级', '{等级}'],
          ['单位', '{单位}'],
        ],
        2.6,
      ),
      text('price-label', '零售价标题', [33, 8.5, 25, 4], '零售价', { fontSizeMm: 2.6, align: 'center' }),
      text('price', '零售价', [33, 12.5, 25, 10], '¥{价格}', { fontSizeMm: 6, bold: true, align: 'center' }),
      barcode('barcode', '商品码', [2, 29.5, 36, 8.5], 'ean13', '{商品码}', 2),
      text('code', '货号', [40, 33, 18, 4], '{编码}', { fontSizeMm: 2.4, align: 'right' }),
    ],
    sample: {
      content: SAMPLE_EAN13,
      fields: {
        品名: '红富士苹果',
        产地: '山东烟台',
        规格: '75mm 以上',
        等级: '一级',
        单位: '500g',
        价格: '6.80',
        商品码: SAMPLE_EAN13,
        编码: 'GP0301',
      },
    },
  }),
  libraryEntry({
    category: 'price',
    slug: 'price-promo',
    name: '促销价签',
    description: '「特价」反白横幅、原价和现价、EAN-13',
    paper: { widthMm: 70, heightMm: 50 },
    elements: [
      text('banner', '特价', [2, 2, 66, 8], '特 价', { fontSizeMm: 6, bold: true, align: 'center', inverse: true }),
      text('name', '品名', [2, 11, 66, 6], '{品名}', { fontSizeMm: 4, bold: true, align: 'center' }),
      text('was', '原价', [2, 18.5, 32, 5], '原价 ¥{原价}'),
      text('spec', '规格', [36, 18.5, 32, 5], '{规格}', { align: 'right' }),
      text('price', '现价', [2, 24, 66, 12], '¥{价格}', { fontSizeMm: 10, bold: true, align: 'center' }),
      hLine('rule', '分隔线', 2, 37, 66),
      barcode('barcode', '商品码', [2, 38, 40, 10], 'ean13', '{商品码}', 2),
      text('code', '货号', [44, 41, 24, 5], '货号 {编码}', { fontSizeMm: 2.6, align: 'right' }),
    ],
    sample: {
      content: SAMPLE_EAN13,
      fields: {
        品名: '保温杯 500ml',
        原价: '89.00',
        规格: '500ml',
        价格: '59.00',
        商品码: SAMPLE_EAN13,
        编码: 'BW0500',
      },
    },
  }),
];
