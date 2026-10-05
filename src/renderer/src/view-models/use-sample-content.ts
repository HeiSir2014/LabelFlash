import { useCallback, useState } from 'react';
import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';
import type { LibrarySampleBinding } from '../lib/template-library';

/**
 * 模板页的「预览内容」：默认跟着最近一次扫码（还没扫过就用示例），
 * 用户改过之后保持用户的内容，不再被新的扫码覆盖。
 * 「用这个模板」从模板库复制出的模板先按模板库的示例数据预览（library）；预览内容一改（打字、扫码）就回到按内容识别。
 */
export function useSampleContent(latestScanRaw: string | null) {
  const [custom, setCustom] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibrarySampleBinding | null>(null);
  const onChange = useCallback((value: string) => {
    setCustom(value);
    setLibrary(null);
  }, []);
  /** 复制出 binding.templateId 之后：预览内容显示示例数据的完整内容，预览、试打用示例数据。 */
  const showLibrarySample = useCallback((binding: LibrarySampleBinding, content: string) => {
    setCustom(content);
    setLibrary(binding);
  }, []);
  return { value: custom ?? latestScanRaw ?? SAMPLE_LABEL_RAW, library, onChange, showLibrarySample };
}
