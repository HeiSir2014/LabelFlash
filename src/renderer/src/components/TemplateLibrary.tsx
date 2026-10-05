import type { CSSProperties } from 'react';
import { formatPaperSize } from '../../../shared/driver-paper';
import type { LibraryPreview } from '../../../shared/template-library';
import { type CategoryFilter, type LibraryView, THUMBNAIL_BOX_PX, thumbnailScale } from '../lib/template-library';
import { SelectField } from './form-controls';

export interface TemplateLibraryProps {
  /** 还没读到、或读失败时为 null。 */
  items: readonly LibraryPreview[] | null;
  /** 最近一次读取失败（items 为 null 时才有意义）。 */
  hasError: boolean;
  view: LibraryView;
  category: CategoryFilter;
  onCategory: (category: CategoryFilter) => void;
  onPaper: (paper: string) => void;
  /** 「用这个模板」：复制成自定义模板，进设计器。 */
  onUse: (item: LibraryPreview) => void;
  /** 正在复制：禁用每张卡片的「用这个模板」，避免连点两下建出两个一样的自定义模板。 */
  isCreating: boolean;
  /** 「返回列表」。 */
  onClose: () => void;
}

/** 网格和卡片的尺寸跟着缩略图框走：框的大小只在 lib/template-library.ts 写一处。 */
const GRID_STYLE = {
  '--thumb-box-w': `${THUMBNAIL_BOX_PX.width}px`,
  '--thumb-box-h': `${THUMBNAIL_BOX_PX.height}px`,
} as CSSProperties;

/** 模板库：左边分类，右边纸张筛选和缩略图卡片，底部操作条。 */
export function TemplateLibrary({
  items,
  hasError,
  view,
  category,
  onCategory,
  onPaper,
  onUse,
  isCreating,
  onClose,
}: TemplateLibraryProps) {
  return (
    <div className="template-library">
      <nav className="template-library__categories" aria-label="模板库分类">
        <ul className="template-list__items">
          {view.categories.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="template-item"
                aria-pressed={option.id === category}
                onClick={() => onCategory(option.id)}
              >
                <span className="template-item__text">
                  <span className="template-item__name">{option.label}</span>
                </span>
                <span className="template-library__count">{option.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="template-library__main" aria-label="模板库">
        <div className="template-library__filters">
          <SelectField label="纸张" value={view.paper} options={view.papers} onChange={onPaper} />
          <p className="form-hint">
            缩略图是按示例数据排好的打印内容（203dpi，和实际打印机的分辨率可能不同）。点「用这个模板」复制成自定义模板，在设计器里改字、换纸张；字段名和批量打印的列名一致，Excel
            表头用这些名字就能自动对上。
          </p>
        </div>
        {items === null ? (
          <p className="template-list__empty">
            {hasError ? '读取模板库失败：关掉模板库再打开一次重试，还是不行就看日志。' : '正在读取模板库…'}
          </p>
        ) : (
          <ul className="template-library__grid" aria-label="模板" style={GRID_STYLE}>
            {view.visible.map((item) => (
              <LibraryCard key={item.id} item={item} onUse={onUse} isCreating={isCreating} />
            ))}
          </ul>
        )}
      </section>
      <div className="config-actions">
        <p className="config-actions__status">{items === null ? '' : `${view.visible.length} 个模板`}</p>
        <button type="button" className="button button--quiet" onClick={onClose}>
          返回列表
        </button>
      </div>
    </div>
  );
}

interface LibraryCardProps {
  item: LibraryPreview;
  onUse: (item: LibraryPreview) => void;
  isCreating: boolean;
}

/** 一张卡片：缩略图（真实打印 HTML，sandbox 的 iframe 里显示）、名字、纸张和说明、「用这个模板」。 */
function LibraryCard({ item, onUse, isCreating }: LibraryCardProps) {
  const paperStyle = {
    '--paper-w': item.paper.widthMm,
    '--paper-h': item.paper.heightMm,
    '--thumb-scale': thumbnailScale(item.paper),
  } as CSSProperties;
  return (
    <li>
      <article className="library-card" aria-label={item.name}>
        <div className="library-card__thumb">
          <div className="library-card__paper" style={paperStyle}>
            <iframe
              className="library-card__frame"
              title={`${item.name}（示例）`}
              sandbox=""
              srcDoc={item.html}
              tabIndex={-1}
            />
          </div>
        </div>
        <h3 className="library-card__name">{item.name}</h3>
        <p className="library-card__meta">{`${formatPaperSize(item.paper)} · ${item.description}`}</p>
        <button
          type="button"
          className="button button--small button--primary library-card__use"
          disabled={isCreating}
          onClick={() => onUse(item)}
        >
          用这个模板
        </button>
      </article>
    </li>
  );
}
