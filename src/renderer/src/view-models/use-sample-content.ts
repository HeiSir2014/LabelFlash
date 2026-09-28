import { useState } from 'react';
import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';

/**
 * 模板页的「预览内容」：默认跟着最近一次扫码（还没扫过就用示例），
 * 用户改过之后保持用户的内容，不再被新的扫码覆盖。
 */
export function useSampleContent(latestScanRaw: string | null) {
  const [custom, setCustom] = useState<string | null>(null);
  return { value: custom ?? latestScanRaw ?? SAMPLE_LABEL_RAW, onChange: setCustom };
}
