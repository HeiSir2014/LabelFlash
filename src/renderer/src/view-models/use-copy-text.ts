import { useCallback } from 'react';
import { notices, reportError } from '../lib/notices';

/** 复制一段文字到剪贴板（主进程只放行写入纯文本），成功后提示。 */
export function useCopyText() {
  return useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notices.push('info', `已复制 ${text}`);
    } catch (error) {
      reportError('复制', error);
    }
  }, []);
}
