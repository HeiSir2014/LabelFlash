import { DEFAULT_PAPER } from '../../shared/label-paper';
import { BUILT_IN_CANVAS_TEMPLATES } from './builtin-canvas';
import { BUILT_IN_WAYBILLS } from './builtin-waybills';
import {
  BUILT_IN_TEMPLATE_PREFIX,
  type FieldSlot,
  type FieldsArea,
  type LabelTemplate,
  type NoteConfig,
  type QrLabelTemplate,
} from './template-model';

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

/** 「指定字段」的预设：样衣码的三段和货架号。内置模板用「全部字段」，复制后切到「指定字段」就有这几行。 */
const GARMENT_SLOTS: FieldSlot[] = ['编码', '颜色', '尺码', '货架号'].map((field) => ({
  field,
  prefix: `${field}：`,
  fontSizeMm: 3.2,
  bold: true,
}));

/**
 * 内置标签模板的字段区：按识别顺序列出全部字段。
 * 扫样衣码时就是编码、颜色、尺码，内置规则从手机拍的标签上读到货架号时再多一行（没读到不显示）。
 */
const ALL_FIELDS: FieldsArea = {
  mode: 'all',
  arrangement: 'inline',
  all: { fontSizeMm: 3, bold: true, showNames: true, separator: '：' },
  slots: GARMENT_SLOTS,
};

function allFields(overrides: Partial<FieldsArea['all']>): FieldsArea {
  return { ...ALL_FIELDS, all: { ...ALL_FIELDS.all, ...overrides } };
}

/** 通用：二维码在左，右侧列出识别到的全部字段，底部完整内容。新装软件的默认模板。 */
export const GENERIC_TEMPLATE: QrLabelTemplate = {
  kind: 'label',
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

/**
 * 内置模板不指定打印机，只读；要修改先复制成自定义模板（复制后可以换纸张）。
 * 标签模板都是 60×40mm，面单模板按各自的面单纸（见 builtin-waybills.ts）。
 * 大二维码、底部备注两个沿用原来「样衣」的编号，设置里存着它们的电脑不用换。
 */
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
    fieldsArea: { ...allFields({ fontSizeMm: 3.2, separator: '' }), arrangement: 'stacked' },
  },
  {
    ...GENERIC_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}generic-large`,
    name: '通用 · 大字（无二维码）',
    qr: { ...GENERIC_TEMPLATE.qr, visible: false },
    fieldsArea: allFields({ fontSizeMm: 5.5, showNames: false }),
  },
  {
    ...GENERIC_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}big-qr`,
    name: '通用 · 大二维码 + 日期备注',
    qr: { ...GENERIC_TEMPLATE.qr, sizeMm: 30, errorCorrection: 'Q' },
    fieldsArea: allFields({ fontSizeMm: 3.4, showNames: false }),
    bottom: { visible: false, fontSizeMm: 2.6, bold: true },
    note: note({ visible: true, text: '{日期}', fontSizeMm: 2.4 }),
  },
  {
    ...GENERIC_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}bottom-note`,
    name: '通用 · 小二维码 + 底部备注',
    qr: { ...GENERIC_TEMPLATE.qr, sizeMm: 18 },
    bottom: { visible: true, fontSizeMm: 2.6, bold: true },
    note: note({ visible: true, text: '{日期} {时间}', placement: 'bottom', fontSizeMm: 2.4 }),
  },
  ...BUILT_IN_WAYBILLS,
  ...BUILT_IN_CANVAS_TEMPLATES,
];

export const DEFAULT_TEMPLATE_ID = GENERIC_TEMPLATE.id;

/**
 * 1.3.0 并进「通用」后去掉的「样衣」模板 → 版式最接近的通用模板（二维码在同一侧）。
 * 设置、规则绑定、按字段换模板、本机接口、打印记录里还写着旧编号的，读的时候换过去：打出来还是编码、颜色、尺码、货架号，
 * 只是都带字段名（「精简」原来不印字段名）、字号统一。
 */
const RETIRED_TEMPLATE_IDS: Readonly<Record<string, string>> = {
  [`${BUILT_IN_TEMPLATE_PREFIX}standard`]: GENERIC_TEMPLATE.id,
  [`${BUILT_IN_TEMPLATE_PREFIX}qr-right`]: `${BUILT_IN_TEMPLATE_PREFIX}generic-qr-right`,
  [`${BUILT_IN_TEMPLATE_PREFIX}plain`]: GENERIC_TEMPLATE.id,
};

/** 模板编号的现用编号：去掉的内置模板换成替代它的那个，其余原样。 */
export function currentTemplateId(id: string): string {
  return RETIRED_TEMPLATE_IDS[id] ?? id;
}
