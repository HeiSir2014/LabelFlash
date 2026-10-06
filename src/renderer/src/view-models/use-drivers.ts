import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriverStatus } from '../../../shared/drivers';
import { reportError } from '../lib/notices';

export interface DriversModel {
  /** 还没读到时为 null。 */
  status: DriverStatus | null;
  /** force：重新下载清单（「重新检测」按钮）。 */
  detect: (force: boolean) => Promise<void>;
  install: (deviceKey: string) => Promise<void>;
  cancel: () => Promise<void>;
  openPage: (deviceKey: string) => Promise<void>;
}

/**
 * 「驱动」一节：打印机页打开时检测一次；状态跟随主进程推送。一次安装完成（done）时调用 onInstalled 一次
 * （按安装编号记，推送多次也只调一次），让打印机列表立即刷新。
 */
export function useDrivers(isActive: boolean, onInstalled: () => void): DriversModel {
  const [status, setStatus] = useState<DriverStatus | null>(null);
  const onInstalledRef = useRef(onInstalled);
  const handledInstallRef = useRef<number | null>(null);

  useEffect(() => {
    onInstalledRef.current = onInstalled;
  }, [onInstalled]);

  useEffect(() => window.api.onDriverStatus(setStatus), []);

  const detect = useCallback(async (force: boolean) => {
    try {
      setStatus(await window.api.detectDrivers(force));
    } catch (error) {
      reportError('检测驱动', error);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void detect(false);
    }
  }, [isActive, detect]);

  useEffect(() => {
    const install = status?.install;
    if (install && install.state.phase === 'done' && handledInstallRef.current !== install.id) {
      handledInstallRef.current = install.id;
      onInstalledRef.current();
    }
  }, [status]);

  const install = useCallback(async (deviceKey: string) => {
    try {
      setStatus(await window.api.installDriver(deviceKey));
    } catch (error) {
      reportError('安装驱动', error);
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      await window.api.cancelDriverInstall();
    } catch (error) {
      reportError('取消下载驱动', error);
    }
  }, []);

  const openPage = useCallback(async (deviceKey: string) => {
    try {
      await window.api.openDriverDownloadPage(deviceKey);
    } catch (error) {
      reportError('打开驱动下载页', error);
    }
  }, []);

  return { status, detect, install, cancel, openPage };
}
