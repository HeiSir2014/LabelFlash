import { barcode, hLine, pairTable, qr, text } from './library-elements';
import { type LibraryEntry, libraryEntry } from './library-model';

/**
 * 仓储：货架 / 库位（库位号大字，隔几米能看清，Code128 给手持终端扫）、资产标签（编号二维码，手机也能扫）、
 * 箱标（100×150，箱号用批量打印的 {序号}，二维码里是整箱的完整内容）。
 */
export const WAREHOUSE_TEMPLATES: readonly LibraryEntry[] = [
  libraryEntry({
    category: 'warehouse',
    slug: 'shelf-location',
    name: '货架 / 库位标',
    description: '大号库位号和 Code128，下面写存放的货品，100×100',
    paper: { widthMm: 100, heightMm: 100 },
    elements: [
      text('title', '标题', [2, 2, 96, 10], '库 位', { fontSizeMm: 6, bold: true, align: 'center', inverse: true }),
      text('location', '库位号', [2, 14, 96, 30], '{货架号}', { fontSizeMm: 15, bold: true, align: 'center' }),
      barcode('barcode', '库位条码', [6, 46, 88, 30], 'code128', '{货架号}', 3),
      hLine('rule', '分隔线', 2, 79, 96),
      text('goods', '存放货品', [2, 81, 96, 15], '存放：{品名}', { fontSizeMm: 5, wrap: true }),
    ],
    sample: { content: 'A-12-03-02', fields: { 货架号: 'A-12-03-02', 品名: '女式连衣裙（夏季款）' } },
  }),
  libraryEntry({
    category: 'warehouse',
    slug: 'asset-tag',
    name: '资产标签',
    description: '「固定资产」反白标题、名称、编号、使用部门、编号二维码，50×30',
    paper: { widthMm: 50, heightMm: 30 },
    elements: [
      text('title', '标题', [2, 2, 46, 5], '固定资产', { fontSizeMm: 3.2, bold: true, align: 'center', inverse: true }),
      pairTable(
        'info',
        '参数',
        [2, 8, 30, 19.5],
        8,
        [
          ['名称', '{资产名称}'],
          ['编号', '{资产编号}'],
          ['部门', '{使用部门}'],
        ],
        2.4,
      ),
      qr('qr', '编号二维码', [33, 8, 15, 15], '{资产编号}'),
    ],
    sample: {
      content: 'ZC-2026-0001',
      fields: { 资产名称: '笔记本电脑', 资产编号: 'ZC-2026-0001', 使用部门: '财务部' },
    },
  }),
  libraryEntry({
    category: 'warehouse',
    slug: 'carton',
    name: '箱标',
    description: '品名、货号、颜色、尺码、数量、箱号（批量打印的序号）、Code128、整箱二维码，100×150',
    paper: { widthMm: 100, heightMm: 150 },
    elements: [
      text('name', '品名', [2, 2, 96, 10], '{品名}', { fontSizeMm: 6, bold: true }),
      pairTable(
        'info',
        '参数',
        [2, 14, 96, 50],
        24,
        [
          ['货号', '{编码}'],
          ['颜色', '{颜色}'],
          ['尺码', '{尺码}'],
          ['数量', '{数量}'],
          ['箱号', '{序号}'],
        ],
        5,
      ),
      barcode('barcode', '货号条码', [2, 68, 96, 30], 'code128', '{编码}', 3.5),
      hLine('rule', '分隔线', 2, 100, 96),
      qr('qr', '整箱二维码', [2, 103, 40, 40], '{完整内容}'),
      text('date', '装箱日期', [46, 104, 52, 8], '装箱日期 {日期}', { fontSizeMm: 3.5 }),
      text('weight', '毛重', [46, 114, 52, 8], '毛重 {重量}', { fontSizeMm: 3.5 }),
      text('note', '备注', [46, 124, 52, 19], '{备注}', { fontSizeMm: 4, wrap: true }),
    ],
    sample: {
      // 批量打印时完整内容就是「字段名：值」逐行拼起来的（batch-labels.ts 的 contentOf）。
      content: '编码：CL5640-TK\n颜色：图片色\n尺码：XL\n数量：50 件\n序号：001',
      fields: {
        品名: '女式连衣裙',
        编码: 'CL5640-TK',
        颜色: '图片色',
        尺码: 'XL',
        数量: '50 件',
        序号: '001',
        重量: '12.5kg',
        备注: '易皱，请勿挤压',
      },
    },
  }),
];
