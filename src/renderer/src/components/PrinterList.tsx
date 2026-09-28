import { useMemo, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';
import { filterPrinters } from '../lib/list-filters';
import type { PaperCheckView } from '../lib/paper-text';
import { describeResult } from '../lib/status-text';

/** 当前打印机的驱动纸张检测结果（只显示在选中的那一行）。 */
export interface DriverPaperProps {
  view: PaperCheckView | null;
  isOpening: boolean;
  onOpenPreferences: () => void;
}

interface PrinterListProps {
  printers: PrinterInfo[];
  selected: string | null;
  isLoading: boolean;
  paper: DriverPaperProps;
  onSelect: (printerName: string) => void;
  onRefresh: () => void;
  onTestPrint: (printerName: string) => Promise<PrintResult | null>;
}

export function PrinterList({
  printers,
  selected,
  isLoading,
  paper,
  onSelect,
  onRefresh,
  onTestPrint,
}: PrinterListProps) {
  const [query, setQuery] = useState('');
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const visible = useMemo(() => filterPrinters(printers, query), [printers, query]);
  const isSelectedMissing = selected !== null && !isLoading && !printers.some((printer) => printer.name === selected);

  const runTest = async (printerName: string) => {
    setTestMessages((messages) => ({ ...messages, [printerName]: '正在发送测试页…' }));
    const result = await onTestPrint(printerName);
    const message =
      result === null
        ? '发送失败：程序内部错误'
        : result.status === 'printed'
          ? '测试页已发送'
          : describeResult(result, Date.now()).detail;
    setTestMessages((messages) => ({ ...messages, [printerName]: message }));
  };

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <input
          type="search"
          className="text-field"
          placeholder={`搜索 ${printers.length} 台打印机`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="button button--small" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? '刷新中…' : '刷新'}
        </button>
      </div>
      {isSelectedMissing && <p className="notice-inline">已保存的打印机「{selected}」现在不在系统里，请重新选择</p>}
      <ul className="scroll-list">
        {visible.map((printer) => {
          const isSelected = printer.name === selected;
          return (
            <li key={printer.name} className={`printer-row${isSelected ? ' printer-row--selected' : ''}`}>
              <button
                type="button"
                className="printer-row__select"
                aria-pressed={isSelected}
                onClick={() => onSelect(printer.name)}
              >
                <span className="printer-row__name">{printer.displayName}</span>
                {isSelected && <span className="badge">当前</span>}
              </button>
              <button
                type="button"
                className="button button--small button--quiet"
                onClick={() => void runTest(printer.name)}
              >
                测试页
              </button>
              {testMessages[printer.name] && <p className="printer-row__message">{testMessages[printer.name]}</p>}
              {isSelected && paper.view?.tone === 'ok' && <p className="printer-row__message">{paper.view.text}</p>}
              {isSelected && paper.view?.tone === 'warning' && (
                <div className="paper-warning" role="alert">
                  <p className="paper-warning__text">{paper.view.text}</p>
                  <button
                    type="button"
                    className="button button--small"
                    onClick={paper.onOpenPreferences}
                    disabled={paper.isOpening}
                  >
                    {paper.isOpening ? '打印首选项已打开…' : '打开打印首选项'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!isLoading && visible.length === 0 && (
        <p className="empty">
          {printers.length === 0
            ? '系统里没有打印机。先在 Windows「设置 › 打印机和扫描仪」里添加，再点刷新'
            : `没有名称包含「${query}」的打印机`}
        </p>
      )}
    </div>
  );
}
