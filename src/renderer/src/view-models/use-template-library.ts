import { useEffect, useMemo, useState } from 'react';
import type { LibraryPreview } from '../../../shared/template-library';
import { reportError } from '../lib/notices';
import { ALL, type CategoryFilter, libraryView } from '../lib/template-library';

/**
 * 「从模板库新建」：第一次打开时读一次模板库（主进程按示例数据排好的缩略图），之后留着
 * （模板库随程序发布，不会变）；左栏分类、纸张筛选。读失败时提示，下次打开再读。
 */
export function useTemplateLibrary(isOpen: boolean) {
  const [items, setItems] = useState<readonly LibraryPreview[] | null>(null);
  const [category, setCategory] = useState<CategoryFilter>(ALL);
  const [paper, setPaper] = useState<string>(ALL);
  const hasItems = items !== null;

  useEffect(() => {
    if (!isOpen || hasItems) {
      return;
    }
    let isActive = true;
    window.api.listTemplateLibrary().then(
      (next) => {
        if (isActive) {
          setItems(next);
        }
      },
      (error: unknown) => reportError('读取模板库', error),
    );
    return () => {
      isActive = false;
    };
  }, [isOpen, hasItems]);

  const view = useMemo(() => libraryView(items ?? [], category, paper), [items, category, paper]);
  return { items, view, category, selectCategory: setCategory, selectPaper: setPaper };
}

export type TemplateLibraryModel = ReturnType<typeof useTemplateLibrary>;
