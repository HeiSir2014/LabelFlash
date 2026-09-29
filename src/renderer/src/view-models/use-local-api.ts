import { useCallback, useEffect, useState } from 'react';
import {
  type ApiKeyInfo,
  type CreatedApiKey,
  type FirewallStatus,
  FRESH_SECRET_MS,
  type LocalApiStatus,
} from '../../../shared/local-api';
import { reportError } from '../lib/notices';

export interface LocalApiModel {
  /** 还没读到时为 null。 */
  status: LocalApiStatus | null;
  keys: ApiKeyInfo[];
  /** 密钥列表读到过没有：没读到之前，打印记录里不能把调用方说成「已撤销的密钥」。 */
  hasLoadedKeys: boolean;
  /** 刚生成的密钥：原文只在这里显示一次，关掉、离开这一页或过了 FRESH_SECRET_MS 就没了。 */
  newKey: CreatedApiKey | null;
  refreshKeys: () => Promise<void>;
  /** 返回是否生成了。 */
  createKey: (name: string) => Promise<boolean>;
  renameKey: (id: string, name: string) => Promise<void>;
  removeKey: (id: string) => Promise<void>;
  /** 把刚生成的密钥复制到剪贴板（经主进程）。expired：主进程里的原文已经过期或密钥已撤销。 */
  copyNewKey: () => Promise<CopyResult>;
  dismissNewKey: () => void;
  revokeOrigin: (origin: string) => Promise<void>;
  /** 对等确认的网站点了「允许」或「拒绝」。 */
  decideOrigin: (origin: string, allow: boolean) => Promise<void>;
  firewall: FirewallStatus;
  /** 局域网访问开着，但防火墙还没放行，暂时只接受本机。 */
  lanHeldBack: boolean;
  /** 正在等操作员在管理员确认框里点选。 */
  isAddingFirewall: boolean;
  checkFirewall: () => Promise<void>;
  addFirewall: () => Promise<void>;
}

export type CopyResult = 'copied' | 'expired' | 'failed';

/**
 * 本机接口：状态跟随主进程推送（授权网站和等确认的网站也在里面，操作员在程序顶部的询问里点选）；
 * 密钥列表在启动、打开配置页、改动之后和本机接口打了标签时读取（最后使用时间不单独推送）。
 */
export function useLocalApi(): LocalApiModel {
  const [status, setStatus] = useState<LocalApiStatus | null>(null);
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [hasLoadedKeys, setHasLoadedKeys] = useState(false);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
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
      setHasLoadedKeys(true);
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
      let isCreated = false;
      try {
        setNewKey(await window.api.createApiKey(name));
        isCreated = true;
      } catch (error) {
        reportError('生成程序密钥', error);
      }
      await refreshKeys();
      return isCreated;
    },
    [refreshKeys],
  );

  // 原文在主进程里只留 FRESH_SECRET_MS，界面上也不多留：过期后收起，不让它一直显示在屏幕上。
  useEffect(() => {
    if (newKey === null) {
      return;
    }
    const timer = window.setTimeout(() => setNewKey(null), FRESH_SECRET_MS);
    return () => window.clearTimeout(timer);
  }, [newKey]);

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

  const copyNewKey = useCallback(async (): Promise<CopyResult> => {
    if (newKey === null) {
      return 'expired';
    }
    try {
      return (await window.api.copyNewApiKey(newKey.key.id)) ? 'copied' : 'expired';
    } catch (error) {
      reportError('复制程序密钥', error);
      return 'failed';
    }
  }, [newKey]);

  const dismissNewKey = useCallback(() => setNewKey(null), []);

  const decideOrigin = useCallback(async (origin: string, allow: boolean) => {
    try {
      await window.api.decideApiOrigin(origin, allow);
    } catch (error) {
      reportError(allow ? '允许网站' : '拒绝网站', error);
    }
  }, []);

  const revokeOrigin = useCallback(async (origin: string) => {
    try {
      await window.api.revokeApiOrigin(origin);
    } catch (error) {
      reportError('撤销网站授权', error);
    }
  }, []);

  // 防火墙在打开配置页、添加之后重新查（查一次要启动 PowerShell，一两秒）；结果随状态推送回来。
  const checkFirewall = useCallback(async () => {
    try {
      await window.api.getFirewallStatus();
    } catch (error) {
      reportError('检查防火墙', error);
    }
  }, []);

  const addFirewall = useCallback(async () => {
    setIsAddingFirewall(true);
    try {
      await window.api.addFirewallRule();
    } catch (error) {
      reportError('添加防火墙规则', error);
    } finally {
      setIsAddingFirewall(false);
    }
  }, []);

  return {
    status,
    keys,
    hasLoadedKeys,
    newKey,
    refreshKeys,
    createKey,
    renameKey,
    removeKey,
    copyNewKey,
    dismissNewKey,
    revokeOrigin,
    decideOrigin,
    firewall: status?.firewall ?? 'unknown',
    lanHeldBack: status?.lanHeldBack ?? false,
    isAddingFirewall,
    checkFirewall,
    addFirewall,
  };
}
