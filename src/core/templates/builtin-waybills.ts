import type { ScanField } from '../scan/scan-result';
import { BUILT_IN_TEMPLATE_PREFIX, type TextAlign } from './template-model';
import type {
  RuleStyle,
  VerticalAlign,
  WaybillContent,
  WaybillMargins,
  WaybillNode,
  WaybillParagraph,
  WaybillTemplate,
} from './waybill-model';

/**
 * 内置快递面单。分区和比例照电商平台公开的标准电子面单模板（2026-10-01 下载，各家一联、二联模板里的毫米坐标），
 * 取整到 0.5mm 左右；标识区只印公司名文字，不印商标。依据见设计文档第 2 节。
 */

// ---- 构造格子的小工具：让下面的版式读起来像一张表 ----

interface CellOptions {
  rule?: RuleStyle;
}

function leaf(sizeMm: number, content: WaybillContent, options: CellOptions = {}): WaybillNode {
  return { sizeMm, ruleAfter: options.rule ?? 'solid', body: { content } };
}

/** 每组的最后一格占剩下的：不存尺寸（写下的数字只是读版式时的参考，这里统一置 0，和保存后的模板一致）。 */
function fill(children: WaybillNode[]): WaybillNode[] {
  return children.map((child, index) => (index === children.length - 1 ? { ...child, sizeMm: 0 } : child));
}

function rows(sizeMm: number, children: WaybillNode[], options: CellOptions = {}): WaybillNode {
  return { sizeMm, ruleAfter: options.rule ?? 'solid', body: { split: 'rows', children: fill(children) } };
}

function columns(sizeMm: number, children: WaybillNode[], options: CellOptions = {}): WaybillNode {
  return { sizeMm, ruleAfter: options.rule ?? 'solid', body: { split: 'columns', children: fill(children) } };
}

function p(text: string, fontSizeMm: number, options: { bold?: boolean; wrap?: boolean } = {}): WaybillParagraph {
  return { text, fontSizeMm, bold: options.bold ?? false, wrap: options.wrap ?? false };
}

interface TextOptions extends CellOptions {
  align?: TextAlign;
  valign?: VerticalAlign;
  inverse?: boolean;
  showIf?: string;
}

function text(sizeMm: number, paragraphs: WaybillParagraph[], options: TextOptions = {}): WaybillNode {
  return leaf(
    sizeMm,
    {
      kind: 'text',
      paragraphs,
      align: options.align ?? 'left',
      valign: options.valign ?? 'middle',
      inverse: options.inverse ?? false,
      showIf: options.showIf ?? '',
    },
    options,
  );
}

/** 「收」「寄」「集」这样的反白标记；showIf 给了字段名时，只在那个字段有值时印（例如「集」跟着集包地）。 */
function mark(sizeMm: number, char: string, fontSizeMm: number, showIf = ''): WaybillNode {
  return text(sizeMm, [p(char, fontSizeMm, { bold: true })], { align: 'center', inverse: true, rule: 'none', showIf });
}

function barcode(
  sizeMm: number,
  options: CellOptions & { showText?: boolean; textSizeMm?: number; vertical?: boolean } = {},
): WaybillNode {
  return leaf(
    sizeMm,
    {
      kind: 'barcode',
      value: '{运单号}',
      showText: options.showText ?? true,
      textSizeMm: options.textSizeMm ?? 3,
      vertical: options.vertical ?? false,
    },
    options,
  );
}

function qr(sizeMm: number, options: CellOptions = {}): WaybillNode {
  return leaf(sizeMm, { kind: 'qr', value: '{二维码}' }, options);
}

function gap(sizeMm: number, options: CellOptions = {}): WaybillNode {
  return leaf(sizeMm, { kind: 'empty' }, options);
}

/** 收件人（姓名电话一行加粗，地址折行）。 */
function receiver(sizeMm: number, nameSizeMm: number, addressSizeMm: number, options: CellOptions = {}): WaybillNode {
  return text(
    sizeMm,
    [p('{收件人}  {收件电话}', nameSizeMm, { bold: true }), p('{收件地址}', addressSizeMm, { bold: true, wrap: true })],
    options,
  );
}

function sender(sizeMm: number, nameSizeMm: number, addressSizeMm: number, options: CellOptions = {}): WaybillNode {
  return text(sizeMm, [p('{寄件人}  {寄件电话}', nameSizeMm), p('{寄件地址}', addressSizeMm, { wrap: true })], options);
}

function printTime(sizeMm: number, options: CellOptions = {}): WaybillNode {
  return text(sizeMm, [p('{日期}', 2.4), p('{时间}', 2.4), p('打印时间', 2)], options);
}

/**
 * 商家自定义区：订单系统想印什么都放进「自定义区」字段（例如商品明细）。
 * 平台标准面单在这一区固定印「已验视」（揽件时验视过货物，由揽件员负责），位置照官方模板：
 * 从自定义区顶上往下 inspectionAtMm 毫米，靠右；官方模板没有「已验视」的（顺丰 100×150）传 null。
 */
function customArea(
  inspectionAtMm: number | null,
  paragraphs: WaybillParagraph[] = [p('{自定义区}', 2.8, { wrap: true })],
): WaybillNode {
  if (inspectionAtMm === null) {
    return text(0, paragraphs, { valign: 'top' });
  }
  return rows(0, [
    text(inspectionAtMm, paragraphs, { valign: 'top', rule: 'none' }),
    text(INSPECTION_HEIGHT_MM, [p('已验视', 3, { bold: true })], { align: 'right', rule: 'none' }),
    gap(0),
  ]);
}

/** 「已验视」这一格的高度（mm）：官方模板里是 4mm 左右。 */
const INSPECTION_HEIGHT_MM = 4;

function root(children: WaybillNode[]): WaybillTemplate['root'] {
  return { sizeMm: 0, ruleAfter: 'none', body: { split: 'rows', children: fill(children) } };
}

/** 100×180 的版面左右各留 1mm：平台模板的线从 1mm 画到 98–99mm。 */
const WIDE_MARGINS: WaybillMargins = { top: 0, right: 1, bottom: 0, left: 1 };
/** 一联单左右各留 5mm：平台一联模板的线从 5mm 画到 70mm（纸宽 75），两边留给打印头够不到的地方。 */
const ONE_PART_MARGINS: WaybillMargins = { top: 0, right: 5, bottom: 0, left: 5 };
/** 平台模板的分隔线约 0.3mm（在 203dpi 上取整成 2 个点）。 */
const LINE_WIDTH_MM = 0.3;

function waybill(
  id: string,
  name: string,
  heightMm: number,
  widthMm: number,
  layout: Omit<WaybillTemplate, keyof WaybillBase>,
): WaybillTemplate {
  return {
    kind: 'waybill',
    id: `${BUILT_IN_TEMPLATE_PREFIX}${id}`,
    name,
    paper: { widthMm, heightMm },
    printer: null,
    ...layout,
  };
}

type WaybillBase = Pick<WaybillTemplate, 'kind' | 'id' | 'name' | 'paper' | 'printer'>;

/** 平台标准二联 100×180：中通、圆通、申通、韵达、极兔（通达系）共用（版面宽 98mm）。 */
export const PLATFORM_TWO_PART: WaybillTemplate = waybill('waybill-platform-180', '平台标准二联（通达系）', 180, 100, {
  marginsMm: WIDE_MARGINS,
  lineWidthMm: LINE_WIDTH_MM,
  root: root([
    columns(15, [
      text(40, [p('{快递公司}', 7, { bold: true })], { align: 'center', rule: 'none' }),
      gap(30, { rule: 'none' }),
      text(28, [p('{产品类型}', 4, { bold: true })], { align: 'center', inverse: true }),
    ]),
    columns(15, [
      text(79, [p('{三段码}', 11, { bold: true })], { align: 'center', rule: 'dashed' }),
      // 集包编码只占一行（照官方），放不下就缩小字号，不折成两行。
      text(19, [p('{集包编码}', 4.5, { bold: true })], { align: 'center' }),
    ]),
    columns(10, [mark(9, '集', 5, '集包地'), text(89, [p('{集包地}', 6, { bold: true })])]),
    columns(15, [mark(9, '收', 5.5), receiver(89, 4, 3.4)]),
    columns(12, [mark(9, '寄', 5), sender(89, 3, 2.8)]),
    barcode(22, { textSizeMm: 3.2 }),
    columns(
      19,
      [
        printTime(19),
        rows(60, [
          text(13, [p('{物品}', 2.8, { wrap: true }), p('{备注}', 2.6, { wrap: true })], {
            valign: 'top',
            rule: 'none',
          }),
          text(0, [p('签收栏', 2.6)], { align: 'right' }),
        ]),
        qr(19),
      ],
      { rule: 'none' },
    ),
    // 切点（110mm）前后不画线：纸本身在这里撕开。
    gap(2, { rule: 'none' }),
    columns(10, [
      text(30, [p('{快递公司}', 4.5, { bold: true })], { align: 'center', rule: 'none' }),
      barcode(68, { showText: false }),
    ]),
    // 存根：竖线在 70mm（官方）。
    columns(10, [
      mark(8, '收', 4),
      text(61, [p('{收件人}  {收件电话}', 2.5, { bold: true }), p('{收件地址}', 2.4, { wrap: true })]),
      mark(8, '寄', 4),
      text(0, [p('{寄件人}', 2.4), p('{寄件电话}', 2.4)]),
    ]),
    // 自定义区从 130mm 开始，官方在 156mm 印「已验视」。
    customArea(26),
  ]),
});

/**
 * 平台标准一联 76×130：中通、圆通、申通、韵达、极兔（通达系）共用。分隔线照平台一联模板的坐标：
 * 12（页头）、21（三段码）、37（运单条码）、43.6（集包地 / 末端网点）、48.7（虚拟号码）、69（收件人）、79（寄件人），
 * 左列宽 53mm、右列是竖排条码；79 以下是商家自定义区，103mm 处印「已验视」。
 * 「集」「末」「虚拟号码」只在对应字段有值时印（对照过用户给的抖音电商极兔一联单实物，2026-10-01）。
 */
export const PLATFORM_ONE_PART: WaybillTemplate = waybill('waybill-platform-130', '平台标准一联（通达系）', 130, 76, {
  marginsMm: ONE_PART_MARGINS,
  lineWidthMm: LINE_WIDTH_MM,
  root: root([
    columns(12, [
      rows(
        53,
        [text(7, [p('{快递公司}', 5.5, { bold: true })], { rule: 'none' }), text(0, [p('{日期} {时间}', 2.4)])],
        {
          rule: 'none',
        },
      ),
      // 格子窄到一行正好两个字：「标准快递」折成「标准 / 快递」两行（照实物）。
      text(0, [p('{产品类型}', 4.2, { bold: true, wrap: true })], { align: 'center' }),
    ]),
    text(9, [p('{三段码}', 7.5, { bold: true })], { align: 'center' }),
    columns(58, [
      rows(53, [
        barcode(16, { textSizeMm: 3 }),
        columns(6.6, [
          mark(6, '集', 4, '集包地'),
          text(21, [p('{集包地}', 3.8, { bold: true })], { rule: 'none' }),
          mark(6, '末', 4, '末端网点'),
          text(0, [p('{末端网点}', 3.8, { bold: true })]),
        ]),
        columns(5.1, [
          text(16, [p('虚拟号码', 2.6, { bold: true })], {
            align: 'center',
            inverse: true,
            rule: 'none',
            showIf: '虚拟号码',
          }),
          text(0, [p('{虚拟号码}', 2.8)]),
        ]),
        columns(20.3, [mark(6, '收', 4.5), receiver(0, 3.6, 3.4)]),
        columns(0, [mark(6, '寄', 3.6), sender(0, 2.6, 2.4)]),
      ]),
      barcode(0, { showText: false, vertical: true }),
    ]),
    // 自定义区从 79mm 开始：先印商品（大字）和订单号，官方在 103mm 印「已验视」。
    customArea(24, [p('{物品}', 4, { wrap: true }), p('{自定义区}', 2.8, { wrap: true }), p('订单号：{订单号}', 2.6)]),
  ]),
});

/** 顺丰二联 100×180：条码在左上，右侧时效和代收货款。只给顺丰用，标识区直接印公司名。 */
export const SF_TWO_PART: WaybillTemplate = waybill('waybill-sf-180', '顺丰二联', 180, 100, {
  marginsMm: WIDE_MARGINS,
  lineWidthMm: LINE_WIDTH_MM,
  root: root([
    columns(15, [
      text(45, [p('顺丰速运', 7, { bold: true })], { align: 'center', rule: 'none' }),
      text(53, [p('{产品类型}', 5, { bold: true })], { align: 'center' }),
    ]),
    columns(25, [
      barcode(74, { textSizeMm: 3.2 }),
      rows(24, [
        text(10, [p('{时效}', 4, { bold: true })], { align: 'center', inverse: true }),
        // 一段写完：没有代收货款时整段不印，不留一个孤零零的「代收货款」。
        text(0, [p('代收货款 {代收货款}', 3.2, { bold: true, wrap: true })], { align: 'center' }),
      ]),
    ]),
    text(15, [p('{目的地代码}', 10, { bold: true })], { align: 'center' }),
    columns(15.5, [mark(9, '收', 5.5), receiver(89, 4, 3.4)]),
    columns(12, [mark(9, '寄', 5), sender(89, 3, 2.8)]),
    // 82.6–92：付款方式、声明价值（官方这一行中间没有竖线）。
    columns(9.5, [
      text(50, [p('付款方式：{付款方式}', 3, { bold: true })], { rule: 'none' }),
      text(48, [p('声明价值：{声明价值}', 3, { bold: true })]),
    ]),
    // 92–108：打印时间 | 托寄物（标签列 20–26mm）、收件员 / 派件员 | 签名；竖线在 20、80mm。
    columns(
      16,
      [
        printTime(19),
        rows(60, [
          columns(11, [
            text(6, [p('托寄物', 2.4, { wrap: true })], { align: 'center' }),
            text(0, [p('{托寄物}', 2.8, { wrap: true })], { valign: 'top' }),
          ]),
          text(0, [p('收件员：          派件员：', 2.4)]),
        ]),
        text(0, [p('签名：', 2.6)], { valign: 'top' }),
      ],
      { rule: 'none' },
    ),
    // 切点（110mm）前后不画线：纸本身在这里撕开。
    gap(2, { rule: 'none' }),
    columns(13, [
      text(30, [p('顺丰速运', 5, { bold: true })], { align: 'center', rule: 'none' }),
      barcode(68, { showText: false }),
    ]),
    // 存根：竖线在 80mm（官方）。
    columns(8.5, [
      mark(8, '收', 4),
      text(71, [p('{收件人}  {收件电话}  {收件地址}', 2.4, { wrap: true })]),
      text(0, [p('付款方式：{付款方式}', 2.4, { wrap: true })]),
    ]),
    columns(8.5, [
      mark(8, '寄', 4),
      text(71, [p('{寄件人}  {寄件电话}  {寄件地址}', 2.4, { wrap: true })]),
      text(0, [p('声明价值：{声明价值}', 2.4, { wrap: true })]),
    ]),
    // 自定义区从 140mm 开始，官方在 174mm 印「已验视」。
    customArea(34),
  ]),
});

/** 顺丰 100×150 的版面左边留 2mm、右边留 4mm：平台模板的虚线从 2mm 画到 96mm。 */
const SF_150_MARGINS: WaybillMargins = { top: 0, right: 4, bottom: 0, left: 2 };

/**
 * 顺丰 100×150：顺丰自己的面单纸。从上往下：标识与时效、运单条码、目的地代码、城市代码 / 出港码 / 产品类型、
 * 收件人（右边二维码）、寄件人、进港码与托寄物，下面是商家自定义区；分隔线都是虚线（照平台模板）。
 */
export const SF_150: WaybillTemplate = waybill('waybill-sf-150', '顺丰 100×150', 150, 100, {
  marginsMm: SF_150_MARGINS,
  lineWidthMm: LINE_WIDTH_MM,
  root: root([
    columns(
      12,
      [
        text(28, [p('顺丰速运', 6, { bold: true })], { align: 'center', rule: 'none' }),
        text(48, [p('{日期} {时间}', 2.6)], { align: 'center', rule: 'none' }),
        text(18, [p('{时效}', 3.6, { bold: true })], { align: 'center', inverse: true }),
      ],
      { rule: 'dashed' },
    ),
    barcode(23, { textSizeMm: 3.4, rule: 'dashed' }),
    text(10, [p('{目的地代码}', 8, { bold: true })], { align: 'center', rule: 'dashed' }),
    columns(
      10,
      [
        text(25, [p('{城市代码}', 5, { bold: true })], { rule: 'none' }),
        text(44, [p('{出港码}', 5, { bold: true })], { align: 'center', rule: 'none' }),
        text(25, [p('{产品类型}', 4, { bold: true })], { align: 'right' }),
      ],
      { rule: 'dashed' },
    ),
    columns(26, [mark(6, '收', 4.5), receiver(58, 4, 3.4, { rule: 'dashed' }), qr(30)], { rule: 'dashed' }),
    // 官方在寄件人和进港码之间没有分隔线。
    columns(6.5, [mark(6, '寄', 3.6), text(88, [p('{寄件人}  {寄件电话}  {寄件地址}', 2.6, { wrap: true })])], {
      rule: 'none',
    }),
    columns(
      10.5,
      [
        text(26, [p('{进港码}', 5, { bold: true })], { rule: 'none' }),
        text(68, [p('托寄物：{托寄物}', 2.8, { wrap: true }), p('备注：{备注}', 2.6, { wrap: true })]),
      ],
      { rule: 'dashed' },
    ),
    customArea(null),
  ]),
});

/** 德邦的路由格：一列是一个站点，上面站点名、下面编码。 */
function route(index: number, rule: RuleStyle = 'solid'): WaybillNode {
  return rows(
    24.5,
    [
      // 站点名不折行：放不下先缩小字号，一个站点名不会断成两行。
      text(14, [p(`{路由站${index}}`, 5, { bold: true })], { align: 'center' }),
      text(0, [p(`{路由码${index}}`, 6, { bold: true })], { align: 'center' }),
    ],
    { rule },
  );
}

/** 德邦二联 100×180：条码上方是 4×2 的路由格，下部末端码。只给德邦用，标识区直接印公司名。 */
export const DEPPON_TWO_PART: WaybillTemplate = waybill('waybill-deppon-180', '德邦二联', 180, 100, {
  marginsMm: WIDE_MARGINS,
  lineWidthMm: LINE_WIDTH_MM,
  root: root([
    columns(15, [
      text(40, [p('德邦快递', 7, { bold: true })], { align: 'center', rule: 'none' }),
      text(58, [p('{产品类型}', 5, { bold: true })], { align: 'center' }),
    ]),
    columns(28, [route(1), route(2), route(3), route(4)]),
    // 分隔线照官方：43（路由格）、65.3（条码）、72.1（虚拟号码）、88.3（收件人）、99.8（寄件人）、108（打印时间 / 末端码）。
    barcode(22.3, { textSizeMm: 3.2 }),
    columns(6.8, [
      text(18, [p('虚拟号码', 2.8, { bold: true })], {
        align: 'center',
        inverse: true,
        rule: 'none',
        showIf: '虚拟号码',
      }),
      text(0, [p('{虚拟号码}', 3.2)]),
    ]),
    columns(16.2, [mark(9, '收', 5.5), receiver(89, 4.2, 3.6)]),
    columns(11.5, [mark(9, '寄', 5), sender(89, 3, 2.8)]),
    columns(
      8.2,
      [text(70, [p('{日期} {时间}', 2.8)]), text(28, [p('{末端码}', 5, { bold: true })], { align: 'center' })],
      { rule: 'none' },
    ),
    gap(2, { rule: 'none' }),
    columns(10, [
      text(30, [p('德邦快递', 4.5, { bold: true })], { align: 'center', rule: 'none' }),
      barcode(68, { showText: false }),
    ]),
    // 存根：竖线在 70mm（官方）。
    columns(10, [
      mark(8, '收', 4),
      text(61, [p('{收件人}  {收件电话}', 2.5, { bold: true }), p('{收件地址}', 2.4, { wrap: true })]),
      mark(8, '寄', 4),
      text(0, [p('{寄件人}', 2.4), p('{寄件电话}', 2.4)]),
    ]),
    // 自定义区从 130mm 开始，官方在 156mm 印「已验视」。
    customArea(26),
  ]),
});

export const BUILT_IN_WAYBILLS: readonly WaybillTemplate[] = [
  PLATFORM_ONE_PART,
  PLATFORM_TWO_PART,
  SF_TWO_PART,
  SF_150,
  DEPPON_TWO_PART,
];

/** 预览面单模板时用的示例数据：每个内置字段一份（地址取常见长度，能看出折行）。 */
export const WAYBILL_SAMPLE_FIELDS: readonly ScanField[] = [
  { name: '快递公司', value: '中通快递' },
  { name: '产品类型', value: '标准快递' },
  { name: '运单号', value: '781234567890123' },
  { name: '二维码', value: '781234567890123' },
  { name: '三段码', value: '531-A03 12' },
  { name: '集包地', value: '杭州转运中心' },
  { name: '集包编码', value: '571-01' },
  { name: '末端网点', value: '西湖文三' },
  { name: '虚拟号码', value: '157 8150 4022 转 1077' },
  { name: '订单号', value: 'SO20261001-0007' },
  { name: '收件人', value: '张三' },
  { name: '收件电话', value: '138****0000' },
  { name: '收件地址', value: '浙江省杭州市西湖区文三路 478 号华星时代广场 A 座 1203 室' },
  { name: '寄件人', value: 'CDL 工作室' },
  { name: '寄件电话', value: '139****0000' },
  { name: '寄件地址', value: '广东省广州市白云区石井街道庆丰兴隆路 18 号' },
  { name: '物品', value: '连衣裙 ×1、半身裙 ×2' },
  { name: '备注', value: '易皱，请勿挤压' },
  { name: '时效', value: '次日达' },
  { name: '目的地代码', value: '571WA-010' },
  { name: '代收货款', value: '' },
  { name: '城市代码', value: '571' },
  { name: '出港码', value: 'A01' },
  { name: '进港码', value: 'W08' },
  { name: '付款方式', value: '寄付月结' },
  { name: '声明价值', value: '500 元' },
  { name: '托寄物', value: '服装 3 件' },
  { name: '路由站1', value: '广州白云' },
  { name: '路由码1', value: '020' },
  { name: '路由站2', value: '杭州枢纽' },
  { name: '路由码2', value: '571' },
  { name: '路由站3', value: '西湖营业部' },
  { name: '路由码3', value: 'A12' },
  { name: '路由站4', value: '文三路' },
  { name: '路由码4', value: '07' },
  { name: '末端码', value: 'A12-07' },
  { name: '自定义区', value: '订单 SO20261001-0007  连衣裙（黑 / M）×1、半身裙（白 / S）×2' },
];

/** 内置面单用到的字段名（编辑器「插入字段」的候选、接入说明的字段表）。 */
export const WAYBILL_FIELD_NAMES: readonly string[] = WAYBILL_SAMPLE_FIELDS.map((field) => field.name);
