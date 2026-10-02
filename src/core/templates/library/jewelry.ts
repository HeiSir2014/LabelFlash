import { barcode, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry } from './library-model';

/**
 * 珠宝 / 小商品。30×20 上放不下 Code128（8 位编码连静区要 30mm 以上），编码用二维码；40×30 放得下 Code128。
 * 真正的哑铃形尾巴标（72×10 这类）比纸张高度下限还矮，这一期不做。
 */
export const JEWELRY_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'jewelry',
    slug: 'jewelry-tag',
    name: '珠宝标',
    description: '品名、材质重量、价格、编码二维码，30×20',
    paper: { widthMm: 30, heightMm: 20 },
    elements: [
      text('name', '品名', [2, 2, 15, 4], '{品名}', { fontSizeMm: 2.4, bold: true }),
      text('material', '材质重量', [2, 6.5, 15, 3.5], '{材质} {重量}', { fontSizeMm: 2 }),
      text('price', '价格', [2, 10.5, 15, 5], '¥{价格}', { fontSizeMm: 3.4, bold: true }),
      qr('qr', '编码二维码', [17.5, 2, 10.5, 10.5], '{编码}'),
      text('code', '编码', [2, 15.5, 26, 3], '{编码}', { fontSizeMm: 2 }),
    ],
    sample: {
      content: 'JW260001',
      fields: { 品名: '足金吊坠', 材质: '足金999', 重量: '3.25g', 价格: '2680', 编码: 'JW260001' },
    },
  }),
  libraryEntry({
    category: 'jewelry',
    slug: 'small-goods-tag',
    name: '小商品标',
    description: '品名、价格、规格、Code128 编码，40×30',
    paper: { widthMm: 40, heightMm: 30 },
    elements: [
      text('name', '品名', [2, 2, 36, 5], '{品名}', { bold: true }),
      text('price', '价格', [2, 7, 20, 8], '¥{价格}', { fontSizeMm: 6, bold: true }),
      text('spec', '规格', [22, 7, 16, 8], '{规格}', { fontSizeMm: 2.6, align: 'right' }),
      barcode('barcode', '编码条码', [2, 16, 36, 12], 'code128', '{编码}', 2),
    ],
    sample: { content: 'SP1024', fields: { 品名: '发夹', 价格: '9.90', 规格: '2只装', 编码: 'SP1024' } },
  }),
];
