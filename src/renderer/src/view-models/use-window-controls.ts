import { useEffect, useState } from 'react';

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => window.windowControls.onMaximizedChange(setIsMaximized), []);
  useEffect(() => window.windowControls.onFullScreenChange(setIsFullScreen), []);

  return {
    chrome: window.windowControls.chrome,
    isMaximized,
    isFullScreen,
    minimize: () => window.windowControls.minimize(),
    toggleMaximize: () => window.windowControls.toggleMaximize(),
    close: () => window.windowControls.close(),
  };
}
