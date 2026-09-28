import brandIcon from '../../../../resources/tray.svg';
import { BRAND } from '../../../shared/brand';
import type { PrinterChipView } from '../lib/printer-chip';
import { useWindowControls } from '../view-models/use-window-controls';
import { ConfirmButton } from './ConfirmButton';

interface TitleBarProps {
  printerChip: PrinterChipView;
  /** 新版本已下载时显示的版本号；null 表示没有待安装的更新。 */
  readyUpdateVersion: string | null;
  onInstallUpdate: () => void;
}

export function TitleBar({ printerChip, readyUpdateVersion, onInstallUpdate }: TitleBarProps) {
  const { chrome, isMaximized, isFullScreen, minimize, toggleMaximize, close } = useWindowControls();
  const hasTrafficLights = chrome === 'mac-traffic-lights';
  // 全屏时系统隐藏红绿灯，标题栏不再为它留位置。
  const className = `title-bar${hasTrafficLights && !isFullScreen ? ' title-bar--traffic-lights' : ''}`;

  return (
    <header className={className}>
      <div className="title-bar__brand">
        <img className="title-bar__logo" src={brandIcon} alt={BRAND.mark} width={28} height={28} draggable={false} />
        <span className="title-bar__name">{BRAND.productName.replace(`${BRAND.mark}-`, '')}</span>
      </div>
      {readyUpdateVersion && (
        <ConfirmButton
          className="update-pill"
          label={`新版本 ${readyUpdateVersion} 已就绪 · 重启更新`}
          confirmLabel="再点一次：立即重启并更新"
          onConfirm={onInstallUpdate}
        />
      )}
      <div className={`printer-chip printer-chip--${printerChip.tone}`} title="当前打印机">
        <span className="printer-chip__dot" aria-hidden="true" />
        <span className="printer-chip__name">{printerChip.text}</span>
      </div>
      {!hasTrafficLights && (
        <WindowButtons
          isMaximized={isMaximized}
          onMinimize={minimize}
          onToggleMaximize={toggleMaximize}
          onClose={close}
        />
      )}
    </header>
  );
}

interface WindowButtonsProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/** Windows 风格的窗口按钮（macOS 用系统红绿灯，不画这组按钮）。 */
function WindowButtons({ isMaximized, onMinimize, onToggleMaximize, onClose }: WindowButtonsProps) {
  return (
    <div className="window-controls">
      <button type="button" className="window-button" aria-label="最小化" onClick={onMinimize}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="window-button"
        aria-label={isMaximized ? '还原' : '最大化'}
        onClick={onToggleMaximize}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          {isMaximized ? <path d="M2.5 .5h7v7M.5 2.5h7v7h-7z" /> : <path d="M.5 .5h9v9h-9z" />}
        </svg>
      </button>
      <button type="button" className="window-button window-button--close" aria-label="关闭到托盘" onClick={onClose}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  );
}
