import { useEffect } from 'react';
import type { Notice } from '../lib/notices';

const AUTO_DISMISS_MS = 8_000;

interface NoticeBarProps {
  notices: readonly Notice[];
  onDismiss: (id: number) => void;
}

export function NoticeBar({ notices, onDismiss }: NoticeBarProps) {
  useEffect(() => {
    const timers = notices.map((notice) => window.setTimeout(() => onDismiss(notice.id), AUTO_DISMISS_MS));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [notices, onDismiss]);

  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="notice-bar" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice notice--${notice.tone}`}>
          <span>{notice.message}</span>
          <button type="button" className="notice__close" aria-label="关闭提示" onClick={() => onDismiss(notice.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
