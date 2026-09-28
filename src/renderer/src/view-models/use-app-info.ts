import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc-contract';
import { reportError } from '../lib/notices';

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.api.getAppInfo().then(setInfo, (error: unknown) => reportError('读取版本信息', error));
  }, []);

  return info;
}
