import { type LibraryEntry, librarySampleScan } from '../../core/templates/library/library-model';
import type { LibraryPreview } from '../../shared/template-library';
import { renderLabelHtml } from './label-html';
import { DEFAULT_PRINTER_DPI } from './qr-code';

/**
 * 模板库的缩略图：每个模板按自己的示例数据排一次，和打印同一份 HTML（renderLabelHtml）。
 * 按 203dpi 画：缩略图不对应某台打印机。18 个模板一共约 20ms、80KB（写计划时实测），
 * 所以每次打开模板库现排、不缓存，{日期} 跟着今天。
 */
export function renderLibraryPreviews(entries: readonly LibraryEntry[], printedAt: number): LibraryPreview[] {
  return entries.map(({ category, description, template, sample }) => ({
    id: template.id,
    category,
    name: template.name,
    description,
    paper: { ...template.paper },
    sampleContent: sample.content,
    html: renderLabelHtml({ scan: librarySampleScan(sample), template, printedAt }, DEFAULT_PRINTER_DPI).html,
  }));
}
