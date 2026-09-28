import { useCallback } from 'react';
import { notices, reportError } from '../lib/notices';

/** 复制一段文字到剪贴板（由主进程写，页面本身没有剪贴板权限），成功后提示。 */
export function useCopyText() {
  return useCallback(async (text: string) => {
    try {
      await window.api.copyText(text);
      notices.push('info', `已复制 ${text}`);
    } catch (error) {
      reportError('复制', error);
    }
  }, []);
}
