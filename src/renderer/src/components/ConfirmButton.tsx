import { useEffect, useState } from 'react';

const CONFIRM_WINDOW_MS = 3_000;

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}

/** 界面内两步确认：第一次点击进入待确认状态，3 秒内再点才执行；超时自动复原。不弹系统对话框。 */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'button' }: ConfirmButtonProps) {
  const [isArmed, setIsArmed] = useState(false);

  useEffect(() => {
    if (!isArmed) {
      return;
    }
    const timer = window.setTimeout(() => setIsArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [isArmed]);

  const handleClick = () => {
    if (isArmed) {
      setIsArmed(false);
      onConfirm();
    } else {
      setIsArmed(true);
    }
  };

  return (
    <button type="button" className={`${className}${isArmed ? ' button--armed' : ''}`} onClick={handleClick}>
      {isArmed ? confirmLabel : label}
    </button>
  );
}

interface DeleteButtonProps {
  onConfirm: () => void;
  className?: string;
}

/** 删除：各页统一的「删除 → 确认删除」两步确认。 */
export function DeleteButton({ onConfirm, className = 'button button--small button--quiet' }: DeleteButtonProps) {
  return <ConfirmButton className={className} label="删除" confirmLabel="确认删除" onConfirm={onConfirm} />;
}
