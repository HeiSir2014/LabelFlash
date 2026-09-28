import brandIcon from '../../../../resources/tray.svg';
import { BRAND } from '../../../shared/brand';
import type { PrinterChipView } from '../lib/printer-chip';
import { useWindowControls } from '../view-models/use-window-controls';
import { ConfirmButton } from './ConfirmButton';

export interface ConfigButtonProps {
  isOpen: boolean;
  /** 快捷键的显示文字：Windows「Ctrl+,」，macOS「⌘,」。 */
  shortcutLabel: string;
  onToggle: () => void;
}

interface TitleBarProps {
  /** 当前版本号（如 1.0.1）；读取到之前为 null，不显示。 */
  version: string | null;
  printerChip: PrinterChipView;
  /** 新版本已下载时显示的版本号；null 表示没有待安装的更新。 */
  readyUpdateVersion: string | null;
  config: ConfigButtonProps;
  onInstallUpdate: () => void;
  onOpenShop: () => void;
}

export function TitleBar({
  version,
  printerChip,
  readyUpdateVersion,
  config,
  onInstallUpdate,
  onOpenShop,
}: TitleBarProps) {
  const { chrome, isMaximized, isFullScreen, minimize, toggleMaximize, close } = useWindowControls();
  const hasTrafficLights = chrome === 'mac-traffic-lights';
  // 全屏时系统隐藏红绿灯，标题栏不再为它留位置。
  const className = `title-bar${hasTrafficLights && !isFullScreen ? ' title-bar--traffic-lights' : ''}`;

  return (
    <header className={className}>
      <div className="title-bar__brand">
        <img className="title-bar__logo" src={brandIcon} alt={BRAND.mark} width={28} height={28} draggable={false} />
        <span className="title-bar__title">
          {/* 产品名必须完整显示「CDL-云签速印」：Logo 里的 CDL 是图形，不能代替名称里的品牌前缀。 */}
          <span className="title-bar__name">{BRAND.productName}</span>
          {/* 版本号弱化显示：排查问题时一眼能看到，又不抢产品名的视觉层级。系统窗口标题只保留产品名。 */}
          {version && <span className="title-bar__version">v{version}</span>}
        </span>
        <button type="button" className="title-bar__shop" title={BRAND.shop.url} onClick={onOpenShop}>
          <span className="title-bar__shop-label">淘宝店铺</span>
          <span className="title-bar__shop-name">{BRAND.shop.name}</span>
        </button>
      </div>
      <div className="title-bar__actions">
        {readyUpdateVersion && (
          <ConfirmButton
            className="update-pill"
            label={`新版本 ${readyUpdateVersion} 已就绪 · 重启更新`}
            confirmLabel="再点一次：立即重启并更新"
            onConfirm={onInstallUpdate}
          />
        )}
        <button
          type="button"
          className="config-button"
          aria-pressed={config.isOpen}
          title={`${config.isOpen ? '返回工作台' : '打开配置'}（${config.shortcutLabel}）`}
          onClick={config.onToggle}
        >
          <GearIcon />
          {config.isOpen ? '配置中' : '配置'}
        </button>
        <div className={`printer-chip printer-chip--${printerChip.tone}`} title="当前打印机">
          <span className="printer-chip__dot" aria-hidden="true" />
          <span className="printer-chip__name">{printerChip.text}</span>
        </div>
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

function GearIcon() {
  return (
    <svg className="config-button__icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
      <circle cx="8" cy="8" r="4.5" />
    </svg>
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
