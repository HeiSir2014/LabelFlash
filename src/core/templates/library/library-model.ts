import type { PaperSize } from '../../../shared/paper-sizes';
import type { ScanField, ScanResult } from '../../scan/scan-result';
import type { CanvasElement, CanvasTemplate } from '../canvas-model';

/**
 * 模板库：按行业分类的自由设计模板，挑一个复制成自定义模板再改。
 * 设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 4 节。模板库的模板不进模板列表：
 * 不能设为当前模板、不能被规则绑定、本机接口不列出，要用先复制（TemplateCatalog.createFromLibrary）。
 */

/** 分类：顺序就是模板库左栏的顺序，也是 TEMPLATE_LIBRARY 的顺序。 */
export const LIBRARY_CATEGORIES = [
  { id: 'garment', label: '服装吊牌' },
  { id: 'price', label: '价签' },
  { id: 'barcode', label: '商品条码' },
  { id: 'shoe-box', label: '鞋盒标' },
  { id: 'food', label: '食品标签' },
  { id: 'jewelry', label: '珠宝 / 小商品' },
  { id: 'warehouse', label: '仓储' },
] as const;

export type LibraryCategoryId = (typeof LIBRARY_CATEGORIES)[number]['id'];

/** 模板库里模板的编号前缀：和内置（builtin:）、自定义（custom:）分开，TEMPLATE_ID_PATTERN 不认它。 */
export const LIBRARY_TEMPLATE_PREFIX = 'library:';
/** 前缀 + 小写字母、数字、连字符；40 个字符足够写清楚是哪个模板。 */
export const LIBRARY_TEMPLATE_ID_PATTERN = /^library:[a-z0-9-]{1,40}$/;

/** 示例数据：缩略图、复制后设计器里的预览、「打印一张试试」都用它。 */
export interface LibrarySample {
  /** 完整内容：{完整内容}、二维码的「完整内容」。 */
  content: string;
  fields: readonly ScanField[];
}

/** 示例数据算在哪条「规则」名下：{规则} 印出来是「模板库示例」。 */
export const LIBRARY_SAMPLE_RULE = { id: 'library', name: '模板库示例' } as const;

/** 模板库里的一个模板。 */
export interface LibraryEntry {
  category: LibraryCategoryId;
  /** 一句话：印了哪些内容、适合什么场景。 */
  description: string;
  /** 编号是 library:xxx；复制时换成自定义模板的编号。 */
  template: CanvasTemplate;
  sample: LibrarySample;
}

/**
 * 模板库统一用的字段名。批量打印按列名自动对列：Excel 的表头写这些名字就能对上；
 * 编码、颜色、尺码和内置规则「横杠三段」一致，货架号是内置的图中文字识别产出的字段，数量和「多行键值」一致，
 * 序号是批量打印给的。测试核对模板只用这些名字、每个名字都有模板在用。
 */
export const LIBRARY_FIELD_NAMES: readonly string[] = [
  '品名',
  '编码',
  '颜色',
  '尺码',
  '货架号',
  '价格',
  '原价',
  '商品码',
  '规格',
  '产地',
  '等级',
  '单位',
  '成分',
  '执行标准',
  '安全类别',
  '净含量',
  '配料',
  '生产日期',
  '保质期',
  '贮存条件',
  '生产商',
  '材质',
  '重量',
  '资产名称',
  '资产编号',
  '使用部门',
  '数量',
  '序号',
  '备注',
];

/**
 * 示例用的 EAN-13：690 是中国的前缀，校验位按 GS1 算法核对过
 * （6+27+0+3+2+9+4+15+6+21+8+27 = 128，(10 − 8) mod 10 = 2）。
 */
export const SAMPLE_EAN13 = '6901234567892';

/** 写一个模板库模板要给的东西；示例字段按写的顺序成为字段列表。 */
export interface LibraryEntrySpec {
  category: LibraryCategoryId;
  /** 编号里 library: 后面的部分。 */
  slug: string;
  name: string;
  description: string;
  paper: PaperSize;
  elements: CanvasElement[];
  sample: { content: string; fields: Readonly<Record<string, string>> };
}

/**
 * 组装模板库的一个模板。编号不合法时立刻抛错（模板库是随程序发布的数据，写错了在加载时就暴露，测试会挂）。
 * @throws Error slug 不是小写字母、数字、连字符时。
 */
export function libraryEntry(spec: LibraryEntrySpec): LibraryEntry {
  const id = `${LIBRARY_TEMPLATE_PREFIX}${spec.slug}`;
  if (!LIBRARY_TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid library template slug: ${spec.slug}`);
  }
  return {
    category: spec.category,
    description: spec.description,
    template: {
      kind: 'canvas',
      id,
      name: spec.name,
      paper: { ...spec.paper },
      printer: null,
      elements: spec.elements,
    },
    sample: {
      content: spec.sample.content,
      fields: Object.entries(spec.sample.fields).map(([name, value]) => ({ name, value })),
    },
  };
}

/** 示例数据当作一次识别结果（不经过识别规则）；字段是拷贝，调用方改了不会改到模板库。 */
export function librarySampleScan(sample: LibrarySample): ScanResult {
  return {
    raw: sample.content,
    ruleId: LIBRARY_SAMPLE_RULE.id,
    ruleName: LIBRARY_SAMPLE_RULE.name,
    fields: sample.fields.map((field) => ({ ...field })),
  };
}
