import { barcode, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 商品条码：零售结算用 EAN-13；货号条码用 Code128（字母、数字、连字符都能编）。 */
export const PRODUCT_BARCODE_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'barcode',
    slug: 'barcode-ean13-small',
    name: 'EAN-13 商品条码',
    description: '品名、EAN-13、规格，40×30',
    paper: { widthMm: 40, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 36, 5], '{品名}', { bold: true, align: 'center' }),
      barcode('barcode', '商品码', [2, 8, 36, 16], 'ean13', '{商品码}'),
      text('spec', '规格', [2, 24, 36, 4], '{规格}', { fontSizeMm: 2.6, align: 'center' }),
    ],
    sample: { content: SAMPLE_EAN13, fields: { 品名: '纯棉袜子', 商品码: SAMPLE_EAN13, 规格: '均码 3双装' } },
  }),
  libraryEntry({
    category: 'barcode',
    slug: 'barcode-ean13-price',
    name: 'EAN-13 条码 + 价格',
    description: '品名、价格、EAN-13，50×30',
    paper: { widthMm: 50, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 30, 5], '{品名}', { bold: true }),
      text('price', '价格', [32, 2, 16, 5], '¥{价格}', { fontSizeMm: 3.4, bold: true, align: 'right' }),
      barcode('barcode', '商品码', [2, 8, 46, 20], 'ean13', '{商品码}'),
    ],
    sample: { content: SAMPLE_EAN13, fields: { 品名: '纯棉袜子', 价格: '12.80', 商品码: SAMPLE_EAN13 } },
  }),
  libraryEntry({
    category: 'barcode',
    slug: 'barcode-code128',
    name: 'Code128 货号条码',
    description: '品名、货号、颜色尺码、Code128、价格，60×40',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('name', '品名', [2, 2, 56, 5], '{品名}', { fontSizeMm: 3.2, bold: true }),
      text('code', '货号', [2, 7.5, 56, 4.5], '货号 {编码}'),
      text('spec', '颜色尺码', [2, 12.5, 56, 4.5], '颜色 {颜色}   尺码 {尺码}'),
      barcode('barcode', '货号条码', [2, 18, 56, 16], 'code128', '{编码}', 2.5),
      text('price', '价格', [2, 34, 56, 4], '¥{价格}', { bold: true, align: 'right' }),
    ],
    sample: {
      content: 'CL5640-TK',
      fields: { 品名: '女式连衣裙', 编码: 'CL5640-TK', 颜色: '图片色', 尺码: 'XL', 价格: '399.00' },
    },
  }),
];
