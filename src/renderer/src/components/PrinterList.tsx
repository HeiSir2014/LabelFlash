import { type ReactNode, useMemo, useState } from 'react';
import type { PrinterInfo, PrintResult } from '../../../core/types';
import { DEFAULT_PAPER } from '../../../shared/label-paper';
import { paperKey, parsePaperKey } from '../../../shared/paper-sizes';
import { filterPrinters } from '../lib/list-filters';
import { describePaperCheck } from '../lib/paper-text';
import { expectedPaperKey, type PaperRow, type Responsibilities } from '../lib/printer-assignment';
import { describeResult } from '../lib/status-text';
import type { DiagnosisControls } from '../view-models/use-diagnosis';
import type { PrinterCommandsModel } from '../view-models/use-printer-commands';
import type { PrinterProfile } from '../view-models/use-printer-profiles';
import { DiagnosisPanel } from './DiagnosisPanel';
import { PrinterCommandsPanel } from './PrinterCommandsPanel';

const LABEL_PAPER_KEY = paperKey(DEFAULT_PAPER);

interface PrinterListProps {
  printers: PrinterInfo[];
  isLoading: boolean;
  /** 「纸张 → 打印机」表的每一行。 */
  rows: PaperRow[];
  profileOf: (printerName: string) => PrinterProfile;
  responsibilitiesOf: (printerName: string) => Responsibilities;
  /** 系统打印机名 → 界面上显示的名字。 */
  displayName: (printerName: string) => string;
  /** 正在打开「打印首选项」的打印机。 */
  openingName: string | null;
  onAssign: (paperKey: string, printerName: string | null) => void;
  onOpenPreferences: (printerName: string) => void;
  onRefresh: () => void;
  onTestPrint: (printerName: string, paperKey: string) => Promise<PrintResult | null>;
  /** 每台打印机下面展开的「标签机指令」。 */
  commands: PrinterCommandsModel;
  /** 「诊断」的状态和操作（view-models/use-diagnosis.ts）。 */
  diagnosis: DiagnosisControls;
}

/** 工作台右侧的打印机页：上面按纸张分配打印机，下面列出本机所有打印机和各自负责什么。 */
export function PrinterList({
  printers,
  isLoading,
  rows,
  profileOf,
  responsibilitiesOf,
  displayName,
  openingName,
  onAssign,
  onOpenPreferences,
  onRefresh,
  onTestPrint,
  commands,
  diagnosis,
}: PrinterListProps) {
  const [query, setQuery] = useState('');
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const visible = useMemo(() => filterPrinters(printers, query), [printers, query]);

  const runTest = async (printerName: string, key: string) => {
    setTestMessages((messages) => ({ ...messages, [printerName]: '正在发送测试页…' }));
    const result = await onTestPrint(printerName, key);
    const message =
      result === null
        ? '发送失败：程序内部错误'
        : result.status === 'printed'
          ? '测试页已发送'
          : describeResult(result, Date.now()).detail;
    setTestMessages((messages) => ({ ...messages, [printerName]: message }));
  };

  // 诊断的「改指令集」复用打印机行里已有的「标签机指令」面板，不新写一份选指令集的逻辑。
  const renderCommandSetPicker = (printerName: string): ReactNode => (
    <div className="diagnosis-item__fixes">
      <button type="button" className="button button--small" onClick={() => commands.toggle(printerName)}>
        {commands.openName === printerName ? '已展开下面的「标签机指令」' : '展开下面的「标签机指令」改指令集'}
      </button>
    </div>
  );

  return (
    <div className="panel-body">
      <section className="paper-assignments" aria-label="纸张和打印机">
        <h3 className="paper-assignments__title">纸张 → 打印机</h3>
        {rows.length === 0 ? (
          <p className="paper-assignments__empty">模板还没有用到任何纸张</p>
        ) : (
          <ul className="paper-assignments__list">
            {rows.map((row) => (
              <li key={row.key} className={`paper-row${row.isCovered ? '' : ' paper-row--missing'}`}>
                <span className="paper-row__name">{row.name}</span>
                <select
                  className="select-field paper-row__select"
                  aria-label={`${row.name} 用哪台打印机`}
                  value={row.printer ?? ''}
                  onChange={(event) => {
                    onAssign(row.key, event.target.value || null);
                    // 选完就离开下拉框：焦点留在下拉框里时，扫码框的回焦规则不会把焦点拉回去。
                    event.currentTarget.blur();
                  }}
                >
                  <option value="">还没有打印机</option>
                  {row.printer !== null && row.isMissing && (
                    <option value={row.printer}>{`${row.printer}（这台电脑上没有）`}</option>
                  )}
                  {printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                    </option>
                  ))}
                </select>
                {row.suggestion && (
                  <button
                    type="button"
                    className="button button--small paper-row__suggestion"
                    onClick={() => row.suggestion && onAssign(row.key, row.suggestion)}
                  >
                    建议：{displayName(row.suggestion)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
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
      <ul className="scroll-list">
        {visible.map((printer) => {
          const responsibilities = responsibilitiesOf(printer.name);
          const expectedKey = expectedPaperKey(responsibilities);
          const expected = expectedKey === null ? null : parsePaperKey(expectedKey);
          const { paper, readiness } = profileOf(printer.name);
          const paperView = describePaperCheck(paper, expected);
          const duties = [
            ...responsibilities.papers.map((item) => item.name),
            ...responsibilities.templates.map((item) => item.name),
          ];
          return (
            <li key={printer.name} className="printer-row">
              <span className="printer-row__title">
                {readiness && (
                  <span
                    className={`printer-row__dot printer-row__dot--${readiness.ready ? 'ready' : 'error'}`}
                    aria-hidden="true"
                  />
                )}
                <span className="printer-row__name">{printer.displayName}</span>
                {duties.length > 0 && <PrinterState readiness={readiness} />}
              </span>
              <span className="printer-row__actions">
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-expanded={diagnosis.view?.printerName === printer.name}
                  onClick={() => diagnosis.open(printer.name)}
                >
                  诊断
                </button>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => void runTest(printer.name, expectedKey ?? LABEL_PAPER_KEY)}
                >
                  测试页
                </button>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-expanded={commands.openName === printer.name}
                  onClick={() => commands.toggle(printer.name)}
                >
                  标签机指令
                </button>
              </span>
              {duties.length > 0 && <p className="printer-row__message">负责：{duties.join('；')}</p>}
              {paperView?.tone === 'ok' && <p className="printer-row__message">{paperView.text}</p>}
              {paperView?.tone === 'warning' && (
                <div className="paper-warning" role="alert">
                  <p className="paper-warning__text">{paperView.text}</p>
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => onOpenPreferences(printer.name)}
                    disabled={openingName !== null}
                  >
                    {openingName === printer.name ? '打印首选项已打开…' : '打开打印首选项'}
                  </button>
                </div>
              )}
              {testMessages[printer.name] && <p className="printer-row__message">{testMessages[printer.name]}</p>}
              {diagnosis.view?.printerName === printer.name && (
                <DiagnosisPanel
                  view={diagnosis.view}
                  title={printer.displayName}
                  onRerun={diagnosis.rerun}
                  onClose={diagnosis.close}
                  onFix={diagnosis.applyFix}
                  onAnswerFeed={diagnosis.answerFeed}
                  commandSetPicker={renderCommandSetPicker(printer.name)}
                />
              )}
              {commands.openName === printer.name && (
                <PrinterCommandsPanel model={commands} displayName={printer.displayName} />
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
      {!isLoading && printers.length === 0 && (
        <div className="printer-empty-actions">
          <button type="button" className="button button--small" onClick={() => diagnosis.open(null)}>
            检查后台打印服务
          </button>
        </div>
      )}
      {diagnosis.view !== null && diagnosis.view.printerName === null && (
        <DiagnosisPanel
          view={diagnosis.view}
          title="后台打印服务"
          onRerun={diagnosis.rerun}
          onClose={diagnosis.close}
          onFix={diagnosis.applyFix}
          onAnswerFeed={diagnosis.answerFeed}
          commandSetPicker={null}
        />
      )}
    </div>
  );
}

/** 被分配到的打印机的状态（主进程只检测它们）：就绪 / 出了什么问题 / 未知（macOS、还没查到）。 */
function PrinterState({ readiness }: { readiness: PrinterProfile['readiness'] }) {
  if (readiness === null) {
    return <span className="badge badge--quiet">状态未知</span>;
  }
  return readiness.ready ? (
    <span className="badge badge--quiet">就绪</span>
  ) : (
    <span className="badge badge--error">{readiness.detail}</span>
  );
}
