import { useCallback, useEffect, useState } from 'react';
import type { IppSharingStatus } from '../../../shared/ipp-sharing';
import { reportError } from '../lib/notices';

/** 局域网共享页和询问条用的状态和操作。 */
export interface IppSharingModel {
  /** 还没读到时为 null。 */
  status: IppSharingStatus | null;
  /** 返回是否保存了。 */
  setPassword: (password: string) => Promise<boolean>;
  clearPassword: () => Promise<void>;
  decideClient: (address: string, allow: boolean) => Promise<void>;
  forgetClient: (address: string) => Promise<void>;
  /** 正在等操作员在管理员确认框里点选。 */
  isAddingFirewall: boolean;
  addFirewall: () => Promise<void>;
}

/** 局域网共享：状态跟随主进程推送（等确认的电脑、记住的电脑都在里面）；操作经 window.api。 */
export function useIppSharing(): IppSharingModel {
  const [status, setStatus] = useState<IppSharingStatus | null>(null);
  const [isAddingFirewall, setIsAddingFirewall] = useState(false);

  useEffect(() => {
    let isActive = true;
    window.api.getIppSharingStatus().then(
      (current) => {
        if (isActive) {
          setStatus(current);
        }
      },
      (error: unknown) => reportError('读取局域网共享状态', error),
    );
    const unsubscribe = window.api.onIppSharingStatus(setStatus);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const setPassword = useCallback(async (password: string) => {
    try {
      await window.api.setSharePassword(password);
      return true;
    } catch (error) {
      reportError('保存共享密码', error);
      return false;
    }
  }, []);

  const clearPassword = useCallback(async () => {
    try {
      await window.api.clearSharePassword();
    } catch (error) {
      reportError('取消共享密码', error);
    }
  }, []);

  const decideClient = useCallback(async (address: string, allow: boolean) => {
    try {
      await window.api.decideIppClient(address, allow);
    } catch (error) {
      reportError(allow ? '允许电脑' : '拒绝电脑', error);
    }
  }, []);

  const forgetClient = useCallback(async (address: string) => {
    try {
      await window.api.forgetIppClient(address);
    } catch (error) {
      reportError('撤销电脑的决定', error);
    }
  }, []);

  const addFirewall = useCallback(async () => {
    setIsAddingFirewall(true);
    try {
      await window.api.addIppFirewallRule();
    } catch (error) {
      reportError('添加防火墙规则', error);
    } finally {
      setIsAddingFirewall(false);
    }
  }, []);

  return { status, setPassword, clearPassword, decideClient, forgetClient, isAddingFirewall, addFirewall };
}
