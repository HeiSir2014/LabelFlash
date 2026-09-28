import { BUILT_IN_TEMPLATE_PREFIX, type FieldConfig, type LabelTemplate, type NoteConfig } from './template-model';

function field(prefix: string, fontSizeMm: number, overrides: Partial<FieldConfig> = {}): FieldConfig {
  return { visible: true, prefix, fontSizeMm, bold: true, ...overrides };
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

/** 标准：复刻原标签（二维码在左，三行字段在右，底部完整编码），去掉库位。 */
export const STANDARD_TEMPLATE: LabelTemplate = {
  id: `${BUILT_IN_TEMPLATE_PREFIX}standard`,
  name: '标准（二维码在左）',
  paddingMm: 2.5,
  layout: 'qr-left',
  sideAlign: 'left',
  bottomAlign: 'left',
  qr: { visible: true, sizeMm: 24, errorCorrection: 'M' },
  fields: {
    code: field('编码：', 3.2),
    color: field('颜色：', 3.2),
    size: field('尺码：', 3.2),
    raw: field('', 3),
  },
  note: note(),
};

/** 内置模板都是 60×40mm，只读；要修改先复制成自定义模板。 */
export const BUILT_IN_TEMPLATES: readonly LabelTemplate[] = [
  STANDARD_TEMPLATE,
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}qr-right`,
    name: '二维码在右',
    layout: 'qr-right',
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}big-qr`,
    name: '大二维码 + 日期备注',
    qr: { visible: true, sizeMm: 30, errorCorrection: 'Q' },
    fields: {
      code: field('', 3.4),
      color: field('', 3),
      size: field('', 3.4),
      raw: field('', 2.6, { visible: false }),
    },
    note: note({ visible: true, text: '{日期}', fontSizeMm: 2.4 }),
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}bottom-note`,
    name: '小二维码 + 底部备注',
    qr: { visible: true, sizeMm: 18, errorCorrection: 'M' },
    fields: {
      code: field('编码：', 3.4),
      color: field('颜色：', 3.4),
      size: field('尺码：', 3.4),
      raw: field('', 2.6),
    },
    note: note({ visible: true, text: '{日期} {时间}', placement: 'bottom', fontSizeMm: 2.4 }),
  },
  {
    ...STANDARD_TEMPLATE,
    id: `${BUILT_IN_TEMPLATE_PREFIX}plain`,
    name: '精简（无前缀）',
    fields: {
      code: field('', 3.8),
      color: field('', 3.4),
      size: field('', 3.8),
      raw: field('', 2.8, { bold: false }),
    },
  },
];

export const DEFAULT_TEMPLATE_ID = STANDARD_TEMPLATE.id;
