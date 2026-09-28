import { MAX_RAW_LENGTH } from './normalize-raw';
import { BUILT_IN_RULE_PREFIX, type ScanRule } from './rule-model';

export const DASH_THREE_RULE_ID = `${BUILT_IN_RULE_PREFIX}dash-three`;
export const RAW_RULE_ID = `${BUILT_IN_RULE_PREFIX}raw`;

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
  },
  {
    id: `${BUILT_IN_RULE_PREFIX}digits-order`,
    name: '纯数字订单号',
    kind: 'whole',
    field: '订单号',
    charset: 'digits',
    minLength: 8,
    maxLength: 30,
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
  },
  {
    id: RAW_RULE_ID,
    name: '原样打印',
    kind: 'whole',
    field: '内容',
    charset: 'any',
    minLength: 1,
    maxLength: MAX_RAW_LENGTH,
  },
];

/** 内置规则默认绑定的模板：样衣标签沿用 v0.1.0 的标准样式，其余用当前模板。 */
export const DEFAULT_RULE_TEMPLATE_BINDINGS: Readonly<Record<string, string>> = {
  [DASH_THREE_RULE_ID]: 'builtin:standard',
};
