import { BRAND } from '../../../shared/brand';
import type { PrinterChipView } from '../lib/printer-chip';
import { useWindowControls } from '../view-models/use-window-controls';

interface TitleBarProps {
  printerChip: PrinterChipView;
}

export function TitleBar({ printerChip }: TitleBarProps) {
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <header className="title-bar">
      <div className="title-bar__brand">
        <span className="brand-mark">{BRAND.mark}</span>
        <span className="title-bar__name">{BRAND.productName.replace(`${BRAND.mark}-`, '')}</span>
      </div>
      <div className={`printer-chip printer-chip--${printerChip.tone}`} title="当前打印机">
        <span className="printer-chip__dot" aria-hidden="true" />
        <span className="printer-chip__name">{printerChip.text}</span>
      </div>
      <div className="window-controls">
        <button type="button" className="window-button" aria-label="最小化" onClick={minimize}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          className="window-button"
          aria-label={isMaximized ? '还原' : '最大化'}
          onClick={toggleMaximize}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            {isMaximized ? <path d="M2.5 .5h7v7M.5 2.5h7v7h-7z" /> : <path d="M.5 .5h9v9h-9z" />}
          </svg>
        </button>
        <button type="button" className="window-button window-button--close" aria-label="关闭到托盘" onClick={close}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </header>
  );
}
