import { LIBRARY_CATEGORIES, type LibraryCategoryId } from '../../../core/templates/library/library-model';
import { formatPaperSize } from '../../../shared/driver-paper';
import { type PaperSize, paperKey } from '../../../shared/paper-sizes';
import type { LibraryPreview } from '../../../shared/template-library';
import { PX_PER_MM } from './canvas-view';

/** 左栏「全部」和纸张下拉框「全部纸张」的值：不会和分类、纸张键重名。 */
export const ALL = 'all';

/** 左栏选的分类。 */
export type CategoryFilter = LibraryCategoryId | typeof ALL;

/** 左栏的一项：分类名和这一类有几个模板。 */
export interface CategoryOption {
  id: CategoryFilter;
  label: string;
  count: number;
}

/** 纸张下拉框的一项。 */
export interface PaperOption {
  value: string;
  label: string;
}

/** 模板库页面上显示什么。 */
export interface LibraryView {
  categories: CategoryOption[];
  /** 这一类里有的纸张（「全部纸张」在最前）。 */
  papers: PaperOption[];
  /** 实际生效的纸张：选的纸张这一类里没有时回到「全部纸张」。 */
  paper: string;
  visible: LibraryPreview[];
}

/** 按分类、纸张筛选模板库。分类的个数不随纸张变：左栏说的是这一类一共有几个。 */
export function libraryView(items: readonly LibraryPreview[], category: CategoryFilter, paper: string): LibraryView {
  const inCategory = category === ALL ? [...items] : items.filter((item) => item.category === category);
  const papers = paperOptions(inCategory);
  const effective = papers.some((option) => option.value === paper) ? paper : ALL;
  return {
    categories: [
      { id: ALL, label: '全部', count: items.length },
      ...LIBRARY_CATEGORIES.map(({ id, label }) => ({
        id,
        label,
        count: items.filter((item) => item.category === id).length,
      })),
    ],
    papers,
    paper: effective,
    visible: effective === ALL ? inCategory : inCategory.filter((item) => paperKey(item.paper) === effective),
  };
}

/** 纸张从小到大（先比宽、再比高）。 */
function paperOptions(items: readonly LibraryPreview[]): PaperOption[] {
  const papers = new Map<string, PaperSize>();
  for (const item of items) {
    papers.set(paperKey(item.paper), item.paper);
  }
  const sorted = [...papers.entries()].sort(([, a], [, b]) => a.widthMm - b.widthMm || a.heightMm - b.heightMm);
  return [
    { value: ALL, label: '全部纸张' },
    ...sorted.map(([value, paper]) => ({ value, label: formatPaperSize(paper) })),
  ];
}

/** 卡片里给缩略图留的框（px）：一行放得下 60×40 的标签，100×150 的箱标按高度缩小。 */
export const THUMBNAIL_BOX_PX = { width: 200, height: 140 } as const;
/** 缩略图最多按实物大小（96dpi 屏幕像素）显示：小标签不会放得比大标签还大，一眼看出纸的大小。 */
const MAX_THUMBNAIL_SCALE = 1;

/** 缩略图的缩放比例：整张纸放进 THUMBNAIL_BOX_PX，不超过实物大小。 */
export function thumbnailScale(paper: PaperSize): number {
  return Math.min(
    THUMBNAIL_BOX_PX.width / (paper.widthMm * PX_PER_MM),
    THUMBNAIL_BOX_PX.height / (paper.heightMm * PX_PER_MM),
    MAX_THUMBNAIL_SCALE,
  );
}

/** 「用这个模板」后预览内容绑着的模板库示例：哪个自定义模板是从哪个模板库模板复制来的，以及示例的完整内容。 */
export interface LibrarySampleBinding {
  templateId: string;
  libraryId: string;
  /** 示例数据的完整内容：绑定生效时「预览内容」显示它，不随扫码变。 */
  content: string;
}

/**
 * 正在预览的模板用不用模板库的示例数据：只对复制出的那个模板生效（回到列表点别的模板时，按预览内容识别）。
 * 返回模板库编号，或 null。
 */
export function librarySampleIdFor(binding: LibrarySampleBinding | null, templateId: string | null): string | null {
  return binding !== null && binding.templateId === templateId ? binding.libraryId : null;
}
