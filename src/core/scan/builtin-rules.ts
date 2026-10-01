import type { ImageTextStep } from './enrich-model';
import { SHELF_NUMBER_PATTERN } from './image-text';
import { MAX_RAW_LENGTH } from './normalize-raw';
import { BUILT_IN_RULE_PREFIX, type ScanRule } from './rule-model';

export const DASH_THREE_RULE_ID = `${BUILT_IN_RULE_PREFIX}dash-three`;
export const RAW_RULE_ID = `${BUILT_IN_RULE_PREFIX}raw`;

/** 内置规则读出的货架号写进这个字段；标签的「全部字段」保证它印出来。 */
export const SHELF_NUMBER_FIELD = '货架号';

/**
 * 内置规则都带的一步：手机扫码时从拍下的标签上读货架号（例如 A-1-2-3），样衣间不用自己建规则。
 * 认不出时照常打印、字段留空：没有货架号的标签、扫码枪和本机接口（没有图，这一步跳过）都和以前一样打印。
 * 要「认不出就不打印、手机上手动补」的，复制一条规则把这一步改成拦下。
 */
export const SHELF_NUMBER_STEP: ImageTextStep = {
  kind: 'imageText',
  output: SHELF_NUMBER_FIELD,
  pattern: SHELF_NUMBER_PATTERN,
  flags: '',
  preferredArea: null,
  whenMissing: 'empty',
};

/**
 * 内置规则（只读，要修改先复制），默认按这个顺序匹配。
 * 「原样打印」放在最后兜底：前面的规则都不认识时，整段内容照样能打出来；不需要时可以停用。
 */
export const BUILT_IN_RULES: readonly ScanRule[] = [
  {
    id: DASH_THREE_RULE_ID,
    name: '横杠三段（编码-颜色-尺码）',
    kind: 'delimited',
    delimiter: '-',
    fields: ['编码', '颜色', '尺码'],
    // 编码本身可能带「-」（例如 CL5640-TK）：多出来的横杠都算编码的一部分。
    overflowIndex: 0,
    steps: [SHELF_NUMBER_STEP],
  },
  {
    id: `${BUILT_IN_RULE_PREFIX}digits-order`,
    name: '纯数字订单号',
    kind: 'whole',
    field: '订单号',
    charset: 'digits',
    minLength: 8,
    maxLength: 30,
    steps: [SHELF_NUMBER_STEP],
  },
  {
    id: `${BUILT_IN_RULE_PREFIX}key-value`,
    name: '多行键值',
    kind: 'keyValue',
    separators: [':', '：', '='],
    fields: [
      { name: '订单号', aliases: ['订单编号', '单号', 'Order', 'Order No'] },
      { name: '款号', aliases: ['货号', '编码', 'Style', 'SKU'] },
      { name: '颜色', aliases: ['Color'] },
      { name: '尺码', aliases: ['Size'] },
      { name: '数量', aliases: ['Qty'] },
    ],
    required: [],
    keepUnknown: true,
    steps: [SHELF_NUMBER_STEP],
  },
  {
    id: RAW_RULE_ID,
    name: '原样打印',
    kind: 'whole',
    field: '内容',
    charset: 'any',
    minLength: 1,
    maxLength: MAX_RAW_LENGTH,
    steps: [SHELF_NUMBER_STEP],
  },
];
