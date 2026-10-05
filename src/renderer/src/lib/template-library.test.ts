import { describe, expect, test } from 'bun:test';
import type { LibraryPreview } from '../../../shared/template-library';
import { PX_PER_MM } from './canvas-view';
import { ALL, librarySampleIdFor, libraryView, THUMBNAIL_BOX_PX, thumbnailScale } from './template-library';

function item(id: string, category: LibraryPreview['category'], widthMm: number, heightMm: number): LibraryPreview {
  return {
    id: `library:${id}`,
    category,
    name: id,
    description: '',
    paper: { widthMm, heightMm },
    sampleContent: '',
    html: '',
  };
}

const ITEMS = [
  item('tag', 'garment', 60, 40),
  item('small-tag', 'garment', 50, 30),
  item('price', 'price', 40, 30),
  item('carton', 'warehouse', 100, 150),
];

describe('libraryView', () => {
  test('counts every category, including empty ones, after「全部」', () => {
    const { categories } = libraryView(ITEMS, ALL, ALL);
    expect(categories.map((category) => [category.label, category.count])).toEqual([
      ['全部', 4],
      ['服装吊牌', 2],
      ['价签', 1],
      ['商品条码', 0],
      ['鞋盒标', 0],
      ['食品标签', 0],
      ['珠宝 / 小商品', 0],
      ['仓储', 1],
    ]);
  });

  test('offers the papers of the chosen category, smallest first', () => {
    expect(libraryView(ITEMS, ALL, ALL).papers).toEqual([
      { value: ALL, label: '全部纸张' },
      { value: '40x30', label: '40×30mm' },
      { value: '50x30', label: '50×30mm' },
      { value: '60x40', label: '60×40mm' },
      { value: '100x150', label: '100×150mm' },
    ]);
    expect(libraryView(ITEMS, 'garment', ALL).papers.map((paper) => paper.value)).toEqual([ALL, '50x30', '60x40']);
  });

  test('filters by category and paper', () => {
    expect(libraryView(ITEMS, 'garment', '50x30').visible.map((preview) => preview.id)).toEqual(['library:small-tag']);
    expect(libraryView(ITEMS, ALL, '40x30').visible.map((preview) => preview.id)).toEqual(['library:price']);
  });

  // 换了分类，原来选的纸张这一类里没有：回到「全部纸张」，不会出现一个空的网格。
  test('falls back to all papers when the chosen paper is not in the category', () => {
    const view = libraryView(ITEMS, 'warehouse', '50x30');
    expect(view.paper).toBe(ALL);
    expect(view.visible.map((preview) => preview.id)).toEqual(['library:carton']);
  });
});

describe('thumbnailScale', () => {
  test('fits the paper in the thumbnail box', () => {
    const scale = thumbnailScale({ widthMm: 60, heightMm: 40 });
    expect(60 * PX_PER_MM * scale).toBeLessThanOrEqual(THUMBNAIL_BOX_PX.width + 1e-9);
    expect(40 * PX_PER_MM * scale).toBeLessThanOrEqual(THUMBNAIL_BOX_PX.height + 1e-9);
    expect(thumbnailScale({ widthMm: 100, heightMm: 150 })).toBeCloseTo(THUMBNAIL_BOX_PX.height / (150 * PX_PER_MM));
  });

  // 小标签不放大到超过实物大小：一眼看得出 30×20 比 60×40 小。
  test('never enlarges a small label beyond its real size', () => {
    expect(thumbnailScale({ widthMm: 30, heightMm: 20 })).toBe(1);
  });
});

describe('librarySampleIdFor', () => {
  const binding = { templateId: 'custom:t1', libraryId: 'library:price-simple', content: '6901234567892' };

  test('applies the library sample only to the template copied from it', () => {
    expect(librarySampleIdFor(binding, 'custom:t1')).toBe('library:price-simple');
    expect(librarySampleIdFor(binding, 'custom:t2')).toBeNull();
    expect(librarySampleIdFor(binding, null)).toBeNull();
    expect(librarySampleIdFor(null, 'custom:t1')).toBeNull();
  });
});
