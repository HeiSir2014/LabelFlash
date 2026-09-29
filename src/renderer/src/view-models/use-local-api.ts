import { useCallback, useEffect, useState } from 'react';
import type { ApiKeyInfo, CreatedApiKey, FirewallStatus, LocalApiStatus } from '../../../shared/local-api';
import { reportError } from '../lib/notices';

export interface LocalApiModel {
  /** 还没读到时为 null。 */
  status: LocalApiStatus | null;
  keys: ApiKeyInfo[];
  /** 刚生成的密钥：原文只在这里显示一次，关掉就没了。 */
  newKey: CreatedApiKey | null;
  refreshKeys: () => Promise<void>;
  createKey: (name: string) => Promise<void>;
  renameKey: (id: string, name: string) => Promise<void>;
  removeKey: (id: string) => Promise<void>;
  /** 把刚生成的密钥复制到剪贴板（经主进程）；返回是否复制了。 */
  copyNewKey: () => Promise<boolean>;
  dismissNewKey: () => void;
  revokeOrigin: (origin: string) => Promise<void>;
  firewall: FirewallStatus;
  /** 正在等操作员在管理员确认框里点选。 */
  isAddingFirewall: boolean;
  checkFirewall: () => Promise<void>;
  addFirewall: () => Promise<void>;
}

/**
 * 本机接口：状态跟随主进程推送（授权网站也在里面，授权发生在电脑上的弹框里）；
 * 密钥列表在启动、打开配置页、改动之后和本机接口打了标签时读取（最后使用时间不单独推送）。
 */
export function useLocalApi(): LocalApiModel {
  const [status, setStatus] = useState<LocalApiStatus | null>(null);
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [firewall, setFirewall] = useState<FirewallStatus>('unknown');
  const [isAddingFirewall, setIsAddingFirewall] = useState(false);

  useEffect(() => {
    let isActive = true;
    window.api.getLocalApiStatus().then(
      (current) => {
        if (isActive) {
          setStatus(current);
        }
      },
      (error: unknown) => reportError('读取本机接口状态', error),
    );
    const unsubscribe = window.api.onLocalApiStatus(setStatus);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const refreshKeys = useCallback(async () => {
    try {
      setKeys(await window.api.listApiKeys());
    } catch (error) {
      reportError('读取程序密钥', error);
    }
  }, []);

  // 本机接口打了标签：打印记录里要显示调用方的密钥名称，最后使用时间也变了，一起重读。
  useEffect(() => {
    void refreshKeys();
    return window.api.onJobsChanged(() => void refreshKeys());
  }, [refreshKeys]);

  const createKey = useCallback(
    async (name: string) => {
      try {
        setNewKey(await window.api.createApiKey(name));
      } catch (error) {
        reportError('生成程序密钥', error);
      }
      await refreshKeys();
    },
    [refreshKeys],
  );

  const renameKey = useCallback(
    async (id: string, name: string) => {
      try {
        await window.api.renameApiKey(id, name);
      } catch (error) {
        reportError('修改密钥名称', error);
      }
      await refreshKeys();
    },
    [refreshKeys],
  );

  const removeKey = useCallback(
    async (id: string) => {
      try {
        await window.api.removeApiKey(id);
        setNewKey((current) => (current?.key.id === id ? null : current));
      } catch (error) {
        reportError('撤销程序密钥', error);
      }
      await refreshKeys();
    },
    [refreshKeys],
  );

  const copyNewKey = useCallback(async () => {
    if (newKey === null) {
      return false;
    }
    try {
      return await window.api.copyNewApiKey(newKey.key.id);
    } catch (error) {
      reportError('复制程序密钥', error);
      return false;
    }
  }, [newKey]);

  const dismissNewKey = useCallback(() => setNewKey(null), []);

  const revokeOrigin = useCallback(async (origin: string) => {
    try {
      await window.api.revokeApiOrigin(origin);
    } catch (error) {
      reportError('撤销网站授权', error);
    }
  }, []);

  // 防火墙只在打开配置页、添加之后查：查一次要启动 PowerShell，一两秒。
  const checkFirewall = useCallback(async () => {
    try {
      setFirewall(await window.api.getFirewallStatus());
    } catch (error) {
      reportError('检查防火墙', error);
    }
  }, []);

  const addFirewall = useCallback(async () => {
    setIsAddingFirewall(true);
    try {
      setFirewall(await window.api.addFirewallRule());
    } catch (error) {
      reportError('添加防火墙规则', error);
    } finally {
      setIsAddingFirewall(false);
    }
  }, []);

  return {
    status,
    keys,
    newKey,
    refreshKeys,
    createKey,
    renameKey,
    removeKey,
    copyNewKey,
    dismissNewKey,
    revokeOrigin,
    firewall,
    isAddingFirewall,
    checkFirewall,
    addFirewall,
  };
}
