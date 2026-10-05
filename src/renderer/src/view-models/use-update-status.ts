import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../shared/update-status';
import { notices, reportError } from '../lib/notices';

/** 自动更新状态：先取一次当前状态，之后跟随主进程推送。 */
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });

  useEffect(() => {
    let isActive = true;
    window.api.getUpdateStatus().then(
      (current) => {
        if (isActive) {
          setStatus(current);
        }
      },
      (error: unknown) => reportError('读取更新状态', error),
    );
    const unsubscribe = window.api.onUpdateStatus(setStatus);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const check = useCallback(() => {
    window.api.checkForUpdates().catch((error: unknown) => reportError('检查更新', error));
  }, []);

  const install = useCallback(() => {
    window.api
      .installUpdate()
      .then((result) => {
        if (result.status === 'refused') {
          notices.push('warning', result.issue);
        }
      })
      .catch((error: unknown) => reportError('安装更新', error));
  }, []);

  return { status, check, install };
}
