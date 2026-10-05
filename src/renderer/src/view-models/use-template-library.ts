import { useEffect, useMemo, useState } from 'react';
import type { LibraryPreview } from '../../../shared/template-library';
import { reportError } from '../lib/notices';
import { ALL, type CategoryFilter, libraryView } from '../lib/template-library';

/**
 * 「从模板库新建」：每次打开都重新读一次模板库（主进程按示例数据现排缩略图，18 个模板一共约 20ms，
 * 足够便宜），这样 {日期} 才会跟着当天；关着的时候不读。左栏分类、纸张筛选。
 * 读失败时提示一次，并记下来：items 还是上一次的内容（或 null），页面据此显示「重试」而不是一直转圈。
 */
export function useTemplateLibrary(isOpen: boolean) {
  const [items, setItems] = useState<readonly LibraryPreview[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>(ALL);
  const [paper, setPaper] = useState<string>(ALL);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let isActive = true;
    window.api.listTemplateLibrary().then(
      (next) => {
        if (isActive) {
          setItems(next);
          setHasError(false);
        }
      },
      (error: unknown) => {
        reportError('读取模板库', error);
        if (isActive) {
          setHasError(true);
        }
      },
    );
    return () => {
      isActive = false;
    };
  }, [isOpen]);

  const view = useMemo(() => libraryView(items ?? [], category, paper), [items, category, paper]);
  return { items, hasError, view, category, selectCategory: setCategory, selectPaper: setPaper };
}
