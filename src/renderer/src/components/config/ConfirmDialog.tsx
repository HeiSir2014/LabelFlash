import { type KeyboardEvent, type SyntheticEvent, useEffect, useId, useRef } from 'react';

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
 * 应用内的确认框，用原生模态 dialog：打开期间标题栏、工作台、配置中心都不可操作，Tab 也走不出去。
 * Enter 也等于「继续编辑」：扫码枪的 Tab 可能把焦点移到另一个按钮上，随后的回车不能因此丢掉修改。
 */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      // 焦点回到打开前的位置，但不抢：「放弃修改」后换了页面时，焦点已经交给新页面的标题，
      // 原来的元素也可能已经不在页面上了。
      const active = document.activeElement;
      const isFocusFree = active === null || active === document.body;
      if (isFocusFree && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
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

  // 系统的「关闭请求」（例如 Esc 没经过上面的按键处理）也按「继续编辑」处理，不让浏览器自己关掉对话框。
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onCancel();
  };

  return (
    // tabIndex 让点在对话框空白处时焦点留在对话框里，Enter 和 Esc 仍由它处理。
    <dialog
      ref={dialogRef}
      className="dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
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
    </dialog>
  );
}
