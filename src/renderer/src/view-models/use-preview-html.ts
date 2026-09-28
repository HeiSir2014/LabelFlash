import { useEffect, useState } from 'react';
import type { LabelTemplate } from '../../../core/templates/template-model';
import { reportError } from '../lib/notices';

const PREVIEW_DEBOUNCE_MS = 150;

/**
 * 用指定模板渲染 raw，返回标签 HTML：用于没有扫码时的示例标签，以及编辑模板时的草稿效果。
 * template 需要是稳定引用（useMemo），变化时才重新生成。
 */
export function usePreviewHtml(raw: string, template: LabelTemplate | null): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!template) {
      setHtml(null);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const preview = await window.api.previewTemplate(raw, template);
        if (isActive) {
          setHtml(preview.html);
        }
      } catch (error) {
        reportError('生成预览', error);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [raw, template]);

  return html;
}
