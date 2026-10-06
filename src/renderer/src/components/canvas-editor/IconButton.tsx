import type { ReactNode } from 'react';
import { ICONS, type IconName } from './icons';

interface IconButtonProps {
  icon: IconName;
  /** 读屏念的名字。 */
  name: string;
  /** 悬停提示：名字加快捷键（「置顶（Ctrl+Shift+]）」）；不传就用 name。 */
  tooltip?: string;
  disabled?: boolean;
  /** 开关按钮的状态；普通按钮不传。 */
  pressed?: boolean;
  /** 图标旁边显示的字（「网格」）；只有图标的按钮不传。 */
  text?: ReactNode;
  className?: string;
  onClick: () => void;
}

/** 设计器里的图标按钮：方形、圆角，可点范围至少 32px；名字在 aria-label，快捷键在悬停提示。 */
export function IconButton({
  icon,
  name,
  tooltip,
  disabled = false,
  pressed,
  text,
  className,
  onClick,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={['icon-button', text !== undefined ? 'icon-button--text' : null, className].filter(Boolean).join(' ')}
      title={tooltip ?? name}
      aria-label={name}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {ICONS[icon]}
      {text !== undefined && <span className="icon-button__text">{text}</span>}
    </button>
  );
}
