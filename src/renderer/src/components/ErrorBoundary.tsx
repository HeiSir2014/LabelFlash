import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** 渲染异常时给出可恢复的界面，而不是整窗白屏；错误会被主进程日志收集。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] UI crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="crash-screen" role="alert">
        <h1>界面出错了</h1>
        <p>错误已写入日志。打印记录和设置不受影响。</p>
        <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
          重新加载界面
        </button>
      </div>
    );
  }
}
