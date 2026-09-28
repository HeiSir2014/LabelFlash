import { useEffect, useState } from 'react';
import type { WindowChrome } from '../../../shared/window-chrome';

/** 主进程按平台选的窗口样式，启动后不会变。 */
export function windowChrome(): WindowChrome {
  return window.windowControls.chrome;
}

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => window.windowControls.onMaximizedChange(setIsMaximized), []);
  useEffect(() => window.windowControls.onFullScreenChange(setIsFullScreen), []);

  return {
    chrome: windowChrome(),
    isMaximized,
    isFullScreen,
    minimize: () => window.windowControls.minimize(),
    toggleMaximize: () => window.windowControls.toggleMaximize(),
    close: () => window.windowControls.close(),
  };
}
