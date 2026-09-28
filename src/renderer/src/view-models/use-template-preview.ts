import { useEffect, useState } from 'react';
import type { LabelTemplate } from '../../../core/templates/template-model';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { reportError } from '../lib/notices';

const PREVIEW_DEBOUNCE_MS = 150;

/** 某个模板的预览结果，带上生成它的模板 id：出纸动画按结果换，而不是按刚点选的模板换。 */
export interface TemplatePreview extends LabelPreview {
  templateId: string;
}

/**
 * 用指定模板渲染 raw：用于没有扫码时的示例标签，以及模板页里选中的模板或草稿。
 * template 需要是稳定引用（useMemo），变化时才重新生成；生成期间保留上一次的结果，第一次生成前为 null。
 */
export function useTemplatePreview(raw: string, template: LabelTemplate | null): TemplatePreview | null {
  const [preview, setPreview] = useState<TemplatePreview | null>(null);

  useEffect(() => {
    if (!template) {
      setPreview(null);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await window.api.previewTemplate(raw, template);
        if (isActive) {
          setPreview({ ...next, templateId: template.id });
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

  return preview;
}
