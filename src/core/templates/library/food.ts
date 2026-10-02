import { barcode, pairTable, text } from './library-elements';
import { type LibraryEntry, libraryEntry, SAMPLE_EAN13 } from './library-model';

/** 现做现卖、散装食品常用的示例日期：生产日期按批量打印或本机接口每批给，不用 {日期}（打印日不一定是生产日）。 */
const SAMPLE_PRODUCTION_DATE = '2026-10-02';

/**
 * 食品标签。预包装食品标签的要素：品名、配料、净含量、生产日期、保质期、贮存条件、生产者、产地；
 * 净含量在大标签上单独放大（包装正面要求醒目）。
 */
export const FOOD_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'food',
    slug: 'food-simple',
    name: '食品标签',
    description: '品名、净含量、生产日期、保质期、贮存条件、生产商，60×40',
    paper: { widthMm: 60, heightMm: 40 },
    elements: [
      text('name', '品名', [2, 2, 56, 6], '{品名}', { fontSizeMm: 4, bold: true }),
      pairTable(
        'info',
        '参数',
        [2, 9, 56, 20],
        14,
        [
          ['净含量', '{净含量}'],
          ['生产日期', '{生产日期}'],
          ['保质期', '{保质期}'],
          ['贮存条件', '{贮存条件}'],
        ],
        2.6,
      ),
      text('maker', '生产商', [2, 30, 56, 4], '生产商：{生产商}', { fontSizeMm: 2.6 }),
    ],
    sample: {
      content: '手工曲奇饼干',
      fields: {
        品名: '手工曲奇饼干',
        净含量: '200g',
        生产日期: SAMPLE_PRODUCTION_DATE,
        保质期: '30 天',
        贮存条件: '常温避光保存',
        生产商: '广州市某某食品有限公司',
      },
    },
  }),
  libraryEntry({
    category: 'food',
    slug: 'food-full',
    name: '预包装食品标签',
    description: '品名、配料、生产日期、保质期、贮存条件、生产商、产地、醒目的净含量、EAN-13，100×100',
    paper: { widthMm: 100, heightMm: 100 },
    elements: [
      text('name', '品名', [2, 2, 96, 8], '{品名}', { fontSizeMm: 6, bold: true }),
      text('ingredients', '配料', [2, 11, 96, 14], '配料：{配料}', { wrap: true }),
      pairTable(
        'info',
        '参数',
        [2, 26, 96, 35],
        20,
        [
          ['生产日期', '{生产日期}'],
          ['保质期', '{保质期}'],
          ['贮存条件', '{贮存条件}'],
          ['生产商', '{生产商}'],
          ['产地', '{产地}'],
        ],
        3,
      ),
      barcode('barcode', '商品码', [2, 64, 60, 30], 'ean13', '{商品码}', 3),
      text('net-label', '净含量标题', [64, 66, 34, 6], '净含量', { align: 'center' }),
      text('net', '净含量', [64, 72, 34, 14], '{净含量}', { fontSizeMm: 7, bold: true, align: 'center' }),
    ],
    sample: {
      content: SAMPLE_EAN13,
      fields: {
        品名: '手工曲奇饼干',
        配料: '小麦粉、黄油、白砂糖、鸡蛋、全脂乳粉、食用盐、食品添加剂（碳酸氢铵）',
        生产日期: SAMPLE_PRODUCTION_DATE,
        保质期: '30 天',
        贮存条件: '常温避光保存',
        生产商: '广州市某某食品有限公司',
        产地: '广东广州',
        净含量: '200g',
        商品码: SAMPLE_EAN13,
      },
    },
  }),
];
