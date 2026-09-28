import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reportError } from './lib/notices';
import './styles/tokens.css';
import './styles/app.css';

window.addEventListener('unhandledrejection', (event) => reportError('后台操作', event.reason));

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
