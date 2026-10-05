import { useCallback, useId } from 'react';
import { PDF_LIMITS } from '../../../../core/pdf/pdf-model';
import { NO_RENDER_WARNINGS } from '../../../../shared/render-warnings';
import {
  describePdfPrint,
  describePieces,
  describeProcessing,
  type PaperOption,
  parseCopies,
} from '../../lib/pdf-view';
import type { PdfViewModel } from '../../view-models/use-pdf';
import { LabelPreview } from '../LabelPreview';
import { PdfBoxEditor } from './PdfBoxEditor';
import { PdfPieces } from './PdfPieces';
import { PdfSetup } from './PdfSetup';

/** 这一张的预览放大倍数上限：100×150 的面单在右栏放到 2 倍，条码和小字已经看得清。 */
const PDF_PREVIEW_MAX_SCALE = 2;

interface PdfPageProps {
  pdf: PdfViewModel;
  paperOptions: readonly PaperOption[];
  onClose: () => void;
}

/** 打印 PDF 页：和配置中心、批量打印同级，铺满标题栏以下；自上而下文件、纸张和裁切、（框选）、预览，底部是打印和进度。 */
export function PdfPage({ pdf, paperOptions, onClose }: PdfPageProps) {
  const fileTitleId = useId();
  const boxesTitleId = useId();
  const previewTitleId = useId();
  // 打开时焦点落到标题：读屏软件读出所在位置，Tab 从页面内容开始（和配置中心一样）。
  const focusTitle = useCallback((title: HTMLHeadingElement | null) => title?.focus(), []);
  const { pdfFile, result, status } = pdf;
  const progress = status?.print ? describePdfPrint(status.print) : null;
  const statusText = status?.processing ? describeProcessing(status.processing) : (progress?.text ?? '');

  return (
    <div className="pdf-page">
      <div className="config-center__back">
        <button type="button" className="button button--quiet" onClick={onClose}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
      </div>
      <div className="config-header">
        <h1 ref={focusTitle} className="config-header__title" tabIndex={-1}>
          打印 PDF
        </h1>
      </div>
      <div className="config-content">
        <div className="config-content__inner pdf-page__inner">
          <section className="config-card" aria-labelledby={fileTitleId}>
            <h2 id={fileTitleId} className="config-card__title">
              文件
            </h2>
            <p className="config-card__text">
              选一个 PDF，或者直接把 PDF 拖进窗口。最多 {PDF_LIMITS.pages} 页；PDF 在隔离的进程里打开，不连网。
            </p>
            <div className="pdf-file__actions">
              <button type="button" className="button" disabled={pdf.isPrinting} onClick={() => void pdf.openFile()}>
                选择 PDF…
              </button>
              {pdfFile !== null && !pdf.isPrinting && (
                <button type="button" className="button button--quiet" onClick={() => void pdf.close()}>
                  关闭这个文件
                </button>
              )}
            </div>
            {pdfFile !== null && (
              <p className="pdf-file__status">
                {pdfFile.name} · {pdfFile.pageCount} 页
              </p>
            )}
          </section>
          {pdfFile !== null && <PdfSetup pdf={pdf} paperOptions={paperOptions} />}
          {pdfFile !== null && pdf.layout.crop === 'manual' && (
            <section className="config-card" aria-labelledby={boxesTitleId}>
              <h2 id={boxesTitleId} className="config-card__title">
                框选区域
              </h2>
              <PdfBoxEditor
                firstPage={pdfFile.firstPage}
                boxes={pdf.layout.boxes}
                onAdd={pdf.addBox}
                onRemove={pdf.removeBox}
              />
            </section>
          )}
          {pdfFile !== null && (
            <section className="config-card" aria-labelledby={previewTitleId}>
              <h2 id={previewTitleId} className="config-card__title">
                预览
              </h2>
              {result === null ? (
                <p className="config-card__text">
                  {pdf.isLayingOut
                    ? '正在处理…'
                    : pdf.layout.crop === 'manual'
                      ? '在第一页上拖出要打印的区域，这里会列出每一页裁出来的样子。'
                      : '没有可打印的内容。'}
                </p>
              ) : (
                <>
                  <p className="pdf-preview__summary">
                    {describePieces({ total: result.pieces.length, removed: pdf.removed.size, copies: pdf.copies })}
                    {result.skippedPages > 0 ? ` · 跳过 ${result.skippedPages} 页空白页` : ''}
                    {result.truncated ? ` · 超过 ${PDF_LIMITS.pieces} 张，后面的没有处理` : ''}
                    {pdf.removed.size > 0 && !pdf.isPrinting && (
                      <button type="button" className="button button--small button--quiet" onClick={pdf.restoreAll}>
                        恢复删掉的
                      </button>
                    )}
                  </p>
                  <div className="pdf-preview__body">
                    <PdfPieces
                      pieces={result.pieces}
                      order={pdf.order}
                      removed={pdf.removed}
                      selectedId={pdf.selectedId}
                      isLocked={pdf.isPrinting}
                      onSelect={pdf.select}
                      onMove={pdf.move}
                      onRemove={pdf.removePiece}
                    />
                    <div className="pdf-preview__label">
                      <LabelPreview
                        html={pdf.preview?.status === 'ok' ? pdf.preview.html : null}
                        warnings={NO_RENDER_WARNINGS}
                        feedKey={pdf.selectedId ?? ''}
                        maxScale={PDF_PREVIEW_MAX_SCALE}
                        placeholder={
                          pdf.preview?.status === 'invalid' ? pdf.preview.issue : '点一张缩略图，看它打出来的样子'
                        }
                        paper={result.paper}
                      />
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
      <div className="config-actions pdf-actions">
        {pdf.issue === null ? (
          <p className="config-actions__status" role="status">
            {statusText}
          </p>
        ) : (
          <p className="config-actions__status config-actions__status--error" role="alert">
            {pdf.issue}
          </p>
        )}
        {progress !== null && (
          <progress className="batch-progress" max={100} value={progress.percent} aria-label="PDF 打印进度" />
        )}
        {pdf.isPrinting ? (
          <>
            {status?.print?.state === 'paused' ? (
              <button type="button" className="button button--primary" onClick={() => pdf.control('resume')}>
                继续
              </button>
            ) : (
              <button type="button" className="button" onClick={() => pdf.control('pause')}>
                暂停
              </button>
            )}
            <button type="button" className="button" onClick={() => pdf.control('cancel')}>
              取消
            </button>
          </>
        ) : (
          <>
            <label className="pdf-actions__copies">
              每张
              <input
                type="number"
                className="text-field text-field--number"
                aria-label="每张份数"
                min={1}
                max={PDF_LIMITS.copies}
                value={pdf.copies}
                onChange={(event) => pdf.setCopies(parseCopies(event.target.value))}
              />
              份
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={pdf.labelCount === 0 || pdf.isLayingOut}
              onClick={() => void pdf.print()}
            >
              打印 {pdf.labelCount} 张
            </button>
          </>
        )}
      </div>
    </div>
  );
}
