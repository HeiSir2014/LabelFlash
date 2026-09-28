import { useEffect, useState } from 'react';

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => window.windowControls.onMaximizedChange(setIsMaximized), []);

  return {
    isMaximized,
    minimize: () => window.windowControls.minimize(),
    toggleMaximize: () => window.windowControls.toggleMaximize(),
    close: () => window.windowControls.close(),
  };
}
