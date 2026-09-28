import { useCallback, useEffect, useRef, useState } from 'react';
import type { MobileStatus } from '../../../shared/mobile-status';
import { reportError } from '../lib/notices';
import { returnFocusToScanBox } from './use-scan-focus';

/** 倒计时刷新的间隔：显示到秒。 */
const COUNTDOWN_TICK_MS = 1_000;

interface MobileStationOptions {
  /** 手机的任务打完（成功或失败）时调用：打印记录里多了一条。 */
  onJobsChanged: () => void;
}

/**
 * 「手机扫码」：跟随主进程推送的状态；浮层的开关；开始、结束、换二维码、移除手机、允许新手机加入。
 * 在 App 里创建（标题栏按钮和配置页都要用），组件只拿到数据和回调。
 */
export function useMobileStation({ onJobsChanged }: MobileStationOptions) {
  const [status, setStatus] = useState<MobileStatus>({ state: 'off' });
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const onJobsChangedRef = useRef(onJobsChanged);

  useEffect(() => {
    onJobsChangedRef.current = onJobsChanged;
  });

  useEffect(() => {
    let isActive = true;
    window.api.getMobileStatus().then(
      (current) => {
        if (isActive) {
          setStatus(current);
        }
      },
      (error: unknown) => reportError('读取手机扫码状态', error),
    );
    const unsubscribe = window.api.onMobileStatus(setStatus);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  // 手机的任务打完时刷新打印记录：已打印数或排队数变了就说明有任务出了结果。
  const printed = status.state === 'active' ? status.printed : 0;
  const queued = status.state === 'active' ? status.queued : 0;
  const lastCounts = useRef({ printed, queued });
  useEffect(() => {
    const previous = lastCounts.current;
    lastCounts.current = { printed, queued };
    if (printed > previous.printed || queued < previous.queued) {
      onJobsChangedRef.current();
    }
  }, [printed, queued]);

  // 浮层开着、二维码还在倒计时的时候每秒刷新一次。
  const expiresAt = status.state === 'active' ? status.expiresAt : null;
  useEffect(() => {
    if (!isOpen || expiresAt === null) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isOpen, expiresAt]);

  const start = useCallback(() => {
    window.api.startMobile().then(setStatus, (error: unknown) => reportError('开始手机扫码', error));
  }, []);

  const stop = useCallback(() => {
    window.api.stopMobile().catch((error: unknown) => reportError('结束手机扫码', error));
  }, []);

  /** 换一个新二维码：结束当前会话（旧链接立即作废）再开始。 */
  const regenerate = useCallback(() => {
    window.api
      .stopMobile()
      .then(() => window.api.startMobile())
      .then(setStatus, (error: unknown) => reportError('重新生成二维码', error));
  }, []);

  const removePhone = useCallback((id: string) => {
    window.api.removeMobilePhone(id).catch((error: unknown) => reportError('移除手机', error));
  }, []);

  const allowNewPhones = useCallback(() => {
    window.api.setMobileJoinLocked(false).catch((error: unknown) => reportError('允许新手机加入', error));
  }, []);

  /** 打开浮层；还没开始（或已停下）时顺带开始，这时电脑才连中转服务。 */
  const open = useCallback(() => {
    setIsOpen(true);
    if (status.state === 'off') {
      start();
    }
  }, [status.state, start]);

  const close = useCallback(() => {
    setIsOpen(false);
    returnFocusToScanBox();
  }, []);

  return { status, isOpen, now, open, close, start, stop, regenerate, removePhone, allowNewPhones };
}

export type MobileStationModel = ReturnType<typeof useMobileStation>;
