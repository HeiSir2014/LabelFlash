import { DEFAULT_PAPER } from '../../shared/label-paper';
import {
  BUILT_IN_TEMPLATE_PREFIX,
  type FieldSlot,
  type FieldsArea,
  type LabelTemplate,
  type NoteConfig,
} from './template-model';

function slot(field: string, prefix: string, fontSizeMm: number): FieldSlot {
  return { field, prefix, fontSizeMm, bold: true };
}

function note(overrides: Partial<NoteConfig> = {}): NoteConfig {
  return {
    visible: false,
    text: '',
    placement: 'beside-qr',
    fontSizeMm: 2.6,
    bold: false,
    ...overrides,
  };
}

/** 通用模板的字段区：按识别顺序列出全部字段。 */
const ALL_FIELDS: FieldsArea = {
  mode: 'all',
  arrangement: 'inline',
  all: { fontSizeMm: 3, bold: true, showNames: true, separator: '：' },
  slots: [],
};

/** 样衣模板的字段区：只显示编码、颜色、尺码（「横杠三段」规则识别出的字段）。 */
function garmentFields(prefixes: [string, string, string], sizes: [number, number, number]): FieldsArea {
  return {
    mode: 'pick',
    arrangement: 'inline',
    all: ALL_FIELDS.all,
    slots: [
      slot('编码', prefixes[0], sizes[0]),
      slot('颜色', prefixes[1], sizes[1]),
      slot('尺码', prefixes[2], sizes[2]),
    ],
  };
}

const WITH_PREFIX: [string, string, string] = ['编码：', '颜色：', '尺码：'];
const NO_PREFIX: [string, string, string] = ['', '', ''];

/** 通用：二维码在左，右侧列出识别到的全部字段，底部完整内容。新装软件的默认模板。 */
export const GENERIC_TEMPLATE: LabelTemplate = {
  id: `${BUILT_IN_TEMPLATE_PREFIX}generic`,
  name: '通用（二维码在左）',
  paper: { ...DEFAULT_PAPER },
  printer: null,
  paddingMm: 2.5,
  layout: 'qr-left',
  sideAlign: 'left',
  bottomAlign: 'left',
  qr: { visible: true, sizeMm: 22, errorCorrection: 'M', content: { kind: 'raw' } },
  fieldsArea: ALL_FIELDS,
  bottom: { visible: true, fontSizeMm: 2.6, bold: false },
  note: note(),
};

/** 样衣标准：复刻原标签（二维码在左，编码 / 颜色 / 尺码三行，底部完整编码）。默认绑定「横杠三段」规则。 */
export const STANDARD_TEMPLATE: LabelTemplate = {
  id: `${BUILT_IN_TEMPLATE_PREFIX}standard`,
  name: '样衣标准（二维码在左）',
  paper: { ...DEFAULT_PAPER },
  printer: null,
  paddingMm: 2.5,
  layout: 'qr-left',
  sideAlign: 'left',
  bottomAlign: 'left',
  qr: { visible: true, sizeMm: 24, errorCorrection: 'M', content: { kind: 'raw' } },
  fieldsArea: garmentFields(WITH_PREFIX, [3.2, 3.2, 3.2]),
  bottom: { visible: true, fontSizeMm: 3, bold: true },
  note: note(),
};

/** 内置模板都是 60×40mm、不指定打印机，只读；要修改先复制成自定义模板（复制后可以换纸张）。 */
export const BUILT_IN_TEMPLATES: readonly LabelTemplate[] = [
  GENERIC_TEMPLATE,
  {
    ...GENERIC_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}generic-qr-right`,
    name: '通用（二维码在右）',
    layout: 'qr-right',
  },
  {
    ...GENERIC_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}generic-stacked`,
    name: '通用（字段名在上）',
    fieldsArea: { ...ALL_FIELDS, arrangement: 'stacked', all: { ...ALL_FIELDS.all, fontSizeMm: 3.2, separator: '' } },
  },
  {
    ...GENERIC_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}generic-large`,
    name: '通用 · 大字（无二维码）',
    qr: { ...GENERIC_TEMPLATE.qr, visible: false },
    fieldsArea: { ...ALL_FIELDS, all: { ...ALL_FIELDS.all, fontSizeMm: 5.5, showNames: false } },
  },
  STANDARD_TEMPLATE,
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}qr-right`,
    name: '样衣 · 二维码在右',
    layout: 'qr-right',
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}big-qr`,
    name: '样衣 · 大二维码 + 日期备注',
    qr: { ...STANDARD_TEMPLATE.qr, sizeMm: 30, errorCorrection: 'Q' },
    fieldsArea: garmentFields(NO_PREFIX, [3.4, 3, 3.4]),
    bottom: { visible: false, fontSizeMm: 2.6, bold: true },
    note: note({ visible: true, text: '{日期}', fontSizeMm: 2.4 }),
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}bottom-note`,
    name: '样衣 · 小二维码 + 底部备注',
    qr: { ...STANDARD_TEMPLATE.qr, sizeMm: 18 },
    fieldsArea: garmentFields(WITH_PREFIX, [3.4, 3.4, 3.4]),
    bottom: { visible: true, fontSizeMm: 2.6, bold: true },
    note: note({ visible: true, text: '{日期} {时间}', placement: 'bottom', fontSizeMm: 2.4 }),
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}plain`,
    name: '样衣 · 精简（无前缀）',
    fieldsArea: garmentFields(NO_PREFIX, [3.8, 3.4, 3.8]),
    bottom: { visible: true, fontSizeMm: 2.8, bold: false },
  },
];

export const DEFAULT_TEMPLATE_ID = GENERIC_TEMPLATE.id;
