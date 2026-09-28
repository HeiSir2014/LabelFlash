import { type KeyboardEvent, useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** 会丢东西的那个选择，例如「放弃修改」。 */
  confirmLabel: string;
  /** 安全的选择，例如「继续编辑」：默认焦点，Enter 和 Esc 都选它。 */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 应用内的确认框。Enter 也等于「继续编辑」：扫码枪的 Tab 可能把焦点移到另一个按钮上，
 * 随后的回车不能因此丢掉修改。焦点困在框内，关闭后回到打开前的位置。
 */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
      next?.focus();
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <p id={messageId} className="dialog__message">
          {message}
        </p>
        <div className="dialog__actions">
          <button ref={confirmRef} type="button" className="button button--quiet" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className="button button--primary" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
