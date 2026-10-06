import { FOOD_TEMPLATES } from './food';
import { GARMENT_TEMPLATES } from './garment';
import { JEWELRY_TEMPLATES } from './jewelry';
import type { LibraryEntry } from './library-model';
import { PRICE_TEMPLATES } from './price';
import { PRODUCT_BARCODE_TEMPLATES } from './product-barcode';
import { SHOE_BOX_TEMPLATES } from './shoe-box';
import { WAREHOUSE_TEMPLATES } from './warehouse';

/** 模板库：按 LIBRARY_CATEGORIES 的顺序排好（模板库「全部」里就是这个顺序）。 */
export const TEMPLATE_LIBRARY: readonly LibraryEntry[] = [
  ...GARMENT_TEMPLATES,
  ...PRICE_TEMPLATES,
  ...PRODUCT_BARCODE_TEMPLATES,
  ...SHOE_BOX_TEMPLATES,
  ...FOOD_TEMPLATES,
  ...JEWELRY_TEMPLATES,
  ...WAREHOUSE_TEMPLATES,
];

/** 按编号（library:xxx）找模板库里的模板；没有时返回 null。 */
export function findLibraryEntry(id: string): LibraryEntry | null {
  return TEMPLATE_LIBRARY.find((entry) => entry.template.id === id) ?? null;
}
