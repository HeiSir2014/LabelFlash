import { useCallback, useId } from 'react';
import type { LabelTemplate } from '../../../../core/templates/template-model';
import { DEFAULT_PAPER } from '../../../../shared/label-paper';
import { NO_RENDER_WARNINGS } from '../../../../shared/render-warnings';
import { describeProgress, describeSummary } from '../../lib/batch-view';
import type { BatchViewModel } from '../../view-models/use-batch';
import { LabelPreview } from '../LabelPreview';
import { type PageScanSink, PrintPageScanSink } from '../ScanSinkField';
import { BatchRows } from './BatchRows';
import { BatchSetup } from './BatchSetup';

/** 预览的放大倍数上限：右栏不宽，60×40 的标签放大到 3 倍条码已经看得清。 */
const BATCH_PREVIEW_MAX_SCALE = 3;

interface BatchPageProps {
  batch: BatchViewModel;
  templates: readonly LabelTemplate[];
  scan: PageScanSink;
  onClose: () => void;
}

/** 批量打印页：和配置中心同级，铺满标题栏以下；自上而下五段设置，底部是打印按钮和进度。 */
export function BatchPage({ batch, templates, scan, onClose }: BatchPageProps) {
  const previewTitleId = useId();
  // 打开时焦点落到标题：读屏软件读出所在位置，Tab 从页面内容开始（和配置中心一样）。
  const focusTitle = useCallback((title: HTMLHeadingElement | null) => title?.focus(), []);
  const { status, preview } = batch;
  const progress = status === null ? null : describeProgress(status);
  const isButtonDisabled = batch.labelCount === 0;
  // 按钮点不了（没有要打的标签）时，不管之前有没有别的批打过，都该说清楚为什么点不了——
  // 不能一直显示上一批的旧进度，让操作员以为「打印 0 张」是因为上一批还没完。
  const issue = batch.startIssue ?? (isButtonDisabled ? batch.planIssue : null);
  const statusText = batch.isStopping ? '正在停止…' : (issue ?? progress?.text ?? '');
  const canRetryAll = !batch.isRunning && !batch.isStopping && status !== null && status.failed > 0;
  const currentProblems = batch.dataProblems.get(batch.currentRow + 1) ?? [];

  return (
    <div className="batch-page">
      <div className="config-center__back">
        <button type="button" className="button button--quiet" onClick={onClose}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
      </div>
      <div className="config-header">
        <h1 ref={focusTitle} className="config-header__title" tabIndex={-1}>
          批量打印
        </h1>
        <PrintPageScanSink scan={scan} label="扫码内容（批量打印页上不打印）" />
      </div>
      <div className="config-content">
        <div className="config-content__inner batch-page__inner">
          <BatchSetup batch={batch} templates={templates} />
          <section className="config-card" aria-labelledby={previewTitleId}>
            <h2 id={previewTitleId} className="config-card__title">
              5 预览
            </h2>
            {batch.rowCount === 0 ? (
              <p className="config-card__text">
                导入表格、粘贴数据或选「只按序号打」之后，这里逐行列出要打的内容，右边是这一行打出来的样子。
              </p>
            ) : (
              <>
                <p className="batch-preview__summary">
                  {describeSummary({
                    rowCount: batch.rowCount,
                    selectedCount: batch.selectedCount,
                    labelCount: batch.labelCount,
                    problemRows: batch.problems.size,
                  })}
                  {batch.isChecking ? ' · 正在检查条码和排版…' : ''}
                </p>
                {batch.historyLimitWarning !== null && (
                  <p className="batch-preview__history-warning" role="status">
                    {batch.historyLimitWarning}
                  </p>
                )}
                <div className="batch-preview__body">
                  <div className="batch-preview__list">
                    <input
                      type="search"
                      className="text-field"
                      aria-label="搜索数据"
                      placeholder="搜索任意一格"
                      value={batch.search}
                      onChange={(event) => batch.setSearch(event.target.value)}
                    />
                    <BatchRows
                      columns={batch.columns}
                      table={batch.hasTable ? batch.table : null}
                      rows={batch.visibleRows}
                      problems={batch.problems}
                      failures={batch.failures}
                      currentRow={batch.currentRow}
                      isSelected={batch.isSelected}
                      isAllChecked={batch.isAllVisibleChecked}
                      canRetry={!batch.isRunning && !batch.isStopping && status !== null}
                      onToggleRow={batch.toggleRow}
                      onToggleAll={batch.setVisibleChecked}
                      onSelectRow={batch.setCurrentRow}
                      onRetryRow={(row) => {
                        if (status !== null) {
                          void batch.retryFailed(status.batchId, row);
                        }
                      }}
                    />
                  </div>
                  <div className="batch-preview__label">
                    <div className="batch-preview__nav">
                      <button
                        type="button"
                        className="button button--small"
                        aria-label="上一张预览"
                        onClick={() => batch.stepRow(-1)}
                      >
                        上一张
                      </button>
                      <span>第 {batch.currentRow + 1} 行</span>
                      <button
                        type="button"
                        className="button button--small"
                        aria-label="下一张预览"
                        onClick={() => batch.stepRow(1)}
                      >
                        下一张
                      </button>
                    </div>
                    <LabelPreview
                      html={preview?.status === 'ok' ? preview.preview.html : null}
                      warnings={preview?.status === 'ok' ? preview.preview.warnings : NO_RENDER_WARNINGS}
                      feedKey={String(batch.currentRow)}
                      maxScale={BATCH_PREVIEW_MAX_SCALE}
                      placeholder={preview?.status === 'invalid' ? preview.issue : '正在生成预览…'}
                      paper={
                        preview?.status === 'ok' ? preview.preview.paper : (batch.template?.paper ?? DEFAULT_PAPER)
                      }
                    />
                    {currentProblems.length > 0 && (
                      <ul className="batch-preview__problems">
                        {currentProblems.map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
      <div className="config-actions batch-actions">
        <p className={`config-actions__status${issue === null ? '' : ' config-actions__status--error'}`} role="status">
          {statusText}
        </p>
        {progress !== null && (
          <progress className="batch-progress" max={100} value={progress.percent} aria-label="批量打印进度" />
        )}
        {batch.isRunning ? (
          <>
            {/* 两个按钮不同 key：换成另一个时是新元素，焦点不会留在刚出现的那个上（回车不会立刻点下它）。 */}
            {status?.state === 'paused' ? (
              <button
                key="resume"
                type="button"
                className="button button--primary"
                onClick={() => batch.control('resume')}
              >
                继续
              </button>
            ) : (
              <button key="pause" type="button" className="button" onClick={() => batch.control('pause')}>
                暂停
              </button>
            )}
            <button type="button" className="button" onClick={() => batch.control('cancel')}>
              取消
            </button>
          </>
        ) : batch.isStopping ? (
          // 取消之后正在打的那一张还没结束：这时「打印」不能点得了，点了也只会被拒绝（上一批还没真的停）。
          <button type="button" className="button button--primary" disabled>
            正在停止…
          </button>
        ) : (
          <>
            {canRetryAll && status !== null && (
              <button
                type="button"
                className="button"
                aria-label={`重打失败的 ${status.failed} 张`}
                onClick={() => void batch.retryFailed(status.batchId, null)}
              >
                重打失败的（{status.failed}）
              </button>
            )}
            <button
              type="button"
              className="button button--primary"
              disabled={isButtonDisabled}
              onClick={() => void batch.start()}
            >
              打印 {batch.labelCount} 张
            </button>
          </>
        )}
      </div>
    </div>
  );
}
