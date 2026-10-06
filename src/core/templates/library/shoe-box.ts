import { barcode, pairTable, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 鞋盒标：尺码反白放大（仓库里隔着货架也认得出），EAN-13 给收银，货号给库存。 */
export const SHOE_BOX_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'shoe-box',
    slug: 'shoe-box-standard',
    name: '鞋盒标',
    description: '品名、货号、颜色、价格，反白大尺码，EAN-13 和货号二维码',
    paper: { widthMm: 70, heightMm: 50 },
    elements: [
      text('name', '品名', [2, 2, 46, 6], '{品名}', { fontSizeMm: 4, bold: true }),
      text('size', '尺码', [50, 2, 18, 14], '{尺码}', { fontSizeMm: 9, bold: true, align: 'center', inverse: true }),
      text('size-label', '尺码标题', [50, 16.5, 18, 4], '尺码', { fontSizeMm: 2.6, align: 'center' }),
      pairTable(
        'info',
        '参数',
        [2, 9, 46, 15],
        10,
        [
          ['货号', '{编码}'],
          ['颜色', '{颜色}'],
          ['价格', '¥{价格}'],
        ],
        2.8,
      ),
      barcode('barcode', '商品码', [2, 26, 46, 20], 'ean13', '{商品码}'),
      qr('qr', '货号二维码', [51, 27, 17, 17], '{编码}'),
    ],
    sample: {
      content: 'XZ2026-BK',
      fields: { 品名: '男式休闲鞋', 尺码: '42', 编码: 'XZ2026-BK', 颜色: '黑色', 价格: '459.00', 商品码: SAMPLE_EAN13 },
    },
  }),
  libraryEntry({
    category: 'shoe-box',
    slug: 'shoe-box-compact',
    name: '鞋盒标（大尺码）',
    description: '反白大尺码在左，品名、货号、颜色，Code128 货号，60×40',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('size', '尺码', [2, 2, 20, 16], '{尺码}', { fontSizeMm: 9, bold: true, align: 'center', inverse: true }),
      text('name', '品名', [24, 2, 34, 5], '{品名}', { fontSizeMm: 3.2, bold: true }),
      text('code', '货号', [24, 7.5, 34, 4.5], '货号 {编码}', { fontSizeMm: 2.8 }),
      text('color', '颜色', [24, 12.5, 34, 4.5], '颜色 {颜色}', { fontSizeMm: 2.8 }),
      barcode('barcode', '货号条码', [2, 19.5, 56, 18], 'code128', '{编码}'),
    ],
    sample: { content: 'XZ2026-BK', fields: { 尺码: '42', 品名: '男式休闲鞋', 编码: 'XZ2026-BK', 颜色: '黑色' } },
  }),
];
