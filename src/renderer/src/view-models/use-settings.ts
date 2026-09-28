import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../../../shared/settings';
import { reportError } from '../lib/notices';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);

  const load = useCallback(async () => {
    setHasLoadError(false);
    try {
      setSettings(await window.api.getSettings());
    } catch (error) {
      reportError('读取设置', error);
      setHasLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 返回主进程校验后的设置（数值可能被纠正）；失败返回 null。 */
  const update = useCallback(async (patch: Partial<AppSettings>): Promise<AppSettings | null> => {
    try {
      const next = await window.api.updateSettings(patch);
      setSettings(next);
      return next;
    } catch (error) {
      reportError('保存设置', error);
      return null;
    }
  }, []);

  return { settings, hasLoadError, reload: load, update, replace: setSettings };
}
