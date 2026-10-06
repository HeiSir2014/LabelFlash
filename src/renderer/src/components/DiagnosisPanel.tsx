import type { ReactNode } from 'react';
import { CHECK_TITLES, type DiagnosisCheckId, type DiagnosisFixId, type FixOffer } from '../../../shared/diagnosis';
import {
  type DiagnosisItem,
  type DiagnosisView,
  diagnosisSummary,
  itemBadge,
  shownOffers,
  shownVerdict,
} from '../lib/diagnosis-view';

interface DiagnosisPanelProps {
  view: DiagnosisView;
  /** 面板名字里的打印机显示名，或「后台打印服务」。 */
  title: string;
  onRerun: () => void;
  onClose: () => void;
  onFix: (check: DiagnosisCheckId, offer: FixOffer) => void;
  onAnswerFeed: (works: boolean) => void;
  /** 「打测试页」；只查后台打印服务时没有打印机，为 null。 */
  onTestPrint: (() => void) | null;
  /** 「改指令集」时显示的指令集下拉（5a 的控件）；没有时为 null。 */
  commandSetPicker: ReactNode;
}

/** 一台打印机的诊断：逐项结论、下一步、修复按钮。只管展示，操作经回调交给视图模型。 */
export function DiagnosisPanel({
  view,
  title,
  onRerun,
  onClose,
  onFix,
  onAnswerFeed,
  onTestPrint,
  commandSetPicker,
}: DiagnosisPanelProps) {
  return (
    <section className="diagnosis" aria-label={`诊断：${title}`}>
      <div className="diagnosis__header">
        <p className="diagnosis__summary" role="status">
          {diagnosisSummary(view)}
        </p>
        <button type="button" className="button button--small" onClick={onRerun} disabled={view.busyFix !== null}>
          重新检查
        </button>
        {onTestPrint && (
          <button type="button" className="button button--small" onClick={onTestPrint}>
            打测试页
          </button>
        )}
        <button type="button" className="button button--small button--quiet" onClick={onClose}>
          收起
        </button>
      </div>
      <ol className="diagnosis__list">
        {view.items.map((item) => (
          <DiagnosisRow
            key={item.check}
            item={item}
            busyFix={view.busyFix}
            onFix={onFix}
            onAnswerFeed={onAnswerFeed}
            commandSetPicker={commandSetPicker}
          />
        ))}
      </ol>
    </section>
  );
}

interface DiagnosisRowProps {
  item: DiagnosisItem;
  busyFix: DiagnosisFixId | null;
  onFix: (check: DiagnosisCheckId, offer: FixOffer) => void;
  onAnswerFeed: (works: boolean) => void;
  commandSetPicker: ReactNode;
}

function DiagnosisRow({ item, busyFix, onFix, onAnswerFeed, commandSetPicker }: DiagnosisRowProps) {
  const verdict = shownVerdict(item);
  const badge = itemBadge(item);
  const offers = shownOffers(item);
  const { outcome } = item;
  const isBadOutcome = outcome !== null && outcome.status !== 'done';
  return (
    <li className="diagnosis-item">
      <div className="diagnosis-item__head">
        <h4 className="diagnosis-item__title">{CHECK_TITLES[item.check]}</h4>
        <span className={`badge badge--${badge.tone}`}>{badge.text}</span>
      </div>
      {verdict && <p className="diagnosis-item__detail">{verdict.detail}</p>}
      {verdict?.nextStep && <p className="diagnosis-item__next">{verdict.nextStep}</p>}
      {item.feed === 'asking' && (
        <fieldset className="diagnosis-item__question" aria-label="标签机走出空白标签了吗？">
          <span>标签机走出一张空白标签了吗？</span>
          <button type="button" className="button button--small" onClick={() => onAnswerFeed(true)}>
            走出来了
          </button>
          <button type="button" className="button button--small" onClick={() => onAnswerFeed(false)}>
            没反应
          </button>
        </fieldset>
      )}
      {offers.length > 0 && (
        <div className="diagnosis-item__fixes">
          {offers.map((offer) => (
            <button
              key={offer.id}
              type="button"
              className="button button--small"
              disabled={busyFix !== null}
              onClick={() => onFix(item.check, offer)}
            >
              {busyFix === offer.id ? '正在处理…' : offer.label}
            </button>
          ))}
        </div>
      )}
      {item.isPickingCommandSet && commandSetPicker}
      {outcome && (
        <p
          className={`diagnosis-item__outcome${isBadOutcome ? ' diagnosis-item__outcome--error' : ''}`}
          role={isBadOutcome ? 'alert' : 'status'}
        >
          {outcome.message}
        </p>
      )}
    </li>
  );
}
