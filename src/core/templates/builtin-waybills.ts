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
    },
    options,
  );
}

/** 「收」「寄」「集」这样的反白标记。 */
function mark(sizeMm: number, char: string, fontSizeMm: number): WaybillNode {
  return text(sizeMm, [p(char, fontSizeMm, { bold: true })], { align: 'center', inverse: true, rule: 'none' });
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

/** 商家自定义区：订单系统想印什么都放进「自定义区」字段（例如商品明细）。 */
function customArea(): WaybillNode {
  return text(0, [p('{自定义区}', 2.8, { wrap: true })], { valign: 'top' });
}

function root(children: WaybillNode[]): WaybillTemplate['root'] {
  return { sizeMm: 0, ruleAfter: 'none', body: { split: 'rows', children: fill(children) } };
}

/** 100×180 的版面左右各留 1mm：平台模板的线从 1mm 画到 98–99mm。 */
const WIDE_MARGINS: WaybillMargins = { top: 0, right: 1, bottom: 0, left: 1 };
/** 一联单左右各留 4mm：平台模板的版面只用中间约 65mm，两边留给打印头够不到的地方。 */
const NARROW_MARGINS: WaybillMargins = { top: 0, right: 4, bottom: 0, left: 4 };
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
      text(19, [p('{集包编码}', 4.5, { bold: true, wrap: true })], { align: 'center' }),
    ]),
    columns(10, [mark(9, '集', 5), text(89, [p('{集包地}', 6, { bold: true })])]),
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
    columns(10, [
      mark(8, '收', 4),
      text(60, [p('{收件人}  {收件电话}', 2.5, { bold: true }), p('{收件地址}', 2.4, { wrap: true })]),
      mark(8, '寄', 4),
      text(22, [p('{寄件人}', 2.4), p('{寄件电话}', 2.4)]),
    ]),
    customArea(),
  ]),
});

/** 平台标准一联 76×130：中通、圆通、申通、韵达、极兔（通达系）共用（版面宽 68mm，右侧一列是竖排条码）。 */
export const PLATFORM_ONE_PART: WaybillTemplate = waybill('waybill-platform-130', '平台标准一联（通达系）', 130, 76, {
  marginsMm: NARROW_MARGINS,
  lineWidthMm: LINE_WIDTH_MM,
  root: root([
    columns(12, [
      text(28, [p('{快递公司}', 6, { bold: true })], { align: 'center', rule: 'none' }),
      text(22, [p('{产品类型}', 3.4, { bold: true })], { align: 'center', inverse: true, rule: 'none' }),
      text(18, [p('{日期}', 2.2), p('{时间}', 2.2)], { align: 'right' }),
    ]),
    text(9, [p('{三段码}', 7.5, { bold: true })], { align: 'center' }),
    columns(58, [
      rows(55, [
        barcode(16, { textSizeMm: 2.8 }),
        columns(6, [
          text(20, [p('{集包编码}', 3.6, { bold: true })], { align: 'center', inverse: true }),
          text(35, [p('{集包地}', 4, { bold: true })]),
        ]),
        columns(22, [mark(6, '收', 4), receiver(49, 3.4, 3)]),
        columns(0, [mark(6, '寄', 4), sender(49, 2.6, 2.4)]),
      ]),
      barcode(13, { showText: false, vertical: true }),
    ]),
    customArea(),
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
    columns(10, [
      text(50, [p('付款方式：{付款方式}', 3, { bold: true })]),
      text(48, [p('声明价值：{声明价值}', 3, { bold: true })]),
    ]),
    columns(
      17.5,
      [
        printTime(20),
        rows(50, [
          text(11, [p('托寄物：{托寄物}', 2.8, { wrap: true })], { valign: 'top' }),
          text(0, [p('收件员：          派件员：', 2.4)]),
        ]),
        text(28, [p('签名：', 2.6)], { valign: 'top' }),
      ],
      { rule: 'none' },
    ),
    columns(13, [
      text(30, [p('顺丰速运', 5, { bold: true })], { align: 'center', rule: 'none' }),
      barcode(68, { showText: false }),
    ]),
    columns(8.5, [
      mark(8, '收', 4),
      text(60, [p('{收件人}  {收件电话}  {收件地址}', 2.4, { wrap: true })]),
      text(30, [p('付款方式：{付款方式}', 2.4)]),
    ]),
    columns(8.5, [
      mark(8, '寄', 4),
      text(60, [p('{寄件人}  {寄件电话}  {寄件地址}', 2.4, { wrap: true })]),
      text(30, [p('声明价值：{声明价值}', 2.4)]),
    ]),
    customArea(),
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
    barcode(22, { textSizeMm: 3.2 }),
    columns(21, [mark(9, '收', 5.5), receiver(89, 4.2, 3.6)]),
    columns(13, [mark(9, '寄', 5), sender(89, 3, 2.8)]),
    columns(
      9,
      [text(70, [p('{日期} {时间}', 2.8)]), text(28, [p('{末端码}', 5, { bold: true })], { align: 'center' })],
      { rule: 'none' },
    ),
    gap(2, { rule: 'none' }),
    columns(10, [
      text(30, [p('德邦快递', 4.5, { bold: true })], { align: 'center', rule: 'none' }),
      barcode(68, { showText: false }),
    ]),
    columns(10, [
      mark(8, '收', 4),
      text(60, [p('{收件人}  {收件电话}', 2.5, { bold: true }), p('{收件地址}', 2.4, { wrap: true })]),
      mark(8, '寄', 4),
      text(22, [p('{寄件人}', 2.4), p('{寄件电话}', 2.4)]),
    ]),
    customArea(),
  ]),
});

export const BUILT_IN_WAYBILLS: readonly WaybillTemplate[] = [
  PLATFORM_ONE_PART,
  PLATFORM_TWO_PART,
  SF_TWO_PART,
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
