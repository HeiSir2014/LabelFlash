import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing');
}

// 占位界面：Task 13 替换为完整的 App。
createRoot(container).render(
  <StrictMode>
    <p style={{ padding: 24 }}>CDL-云签速印：外壳已就绪</p>
  </StrictMode>,
);
