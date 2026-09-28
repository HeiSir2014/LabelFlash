import { useCallback } from 'react';
import { secretReference } from '../../../core/scan/enrich-model';
import { notices, reportError } from '../lib/notices';

/** 复制密钥引用 {密钥:名称}：由主进程写进剪贴板（页面本身没有剪贴板权限），成功后提示。 */
export function useCopySecretReference() {
  return useCallback(async (name: string) => {
    try {
      await window.api.copySecretReference(name);
      notices.push('info', `已复制 ${secretReference(name)}`);
    } catch (error) {
      reportError('复制', error);
    }
  }, []);
}
