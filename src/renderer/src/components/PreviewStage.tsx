import type { ReactNode } from 'react';
import { LABEL_PAPER_MM } from '../../../shared/label-paper';
import type { ConfigPage } from '../lib/app-view';
import type { ScanView } from '../lib/status-text';
import type { ScanState } from '../view-models/use-scan-station';
import { ConfirmButton } from './ConfirmButton';
import { LabelPreview } from './LabelPreview';

const MAX_PREVIEW_SCALE = 2.8;

/** 不按扫码结果、而是按指定模板预览：还没扫码时用示例内容展示当前模板。 */
export interface PreviewOverride {
  html: string | null;
  qrOmitted: boolean;
  /** 换了模板就换一个值：预览做一次出纸动画。 */
  feedKey: string;
}

export interface PreviewStageProps {
  /** 预览区顶部的工具条。 */
  toolbar: ReactNode;
  scan: ScanState | null;
  view: ScanView;
  override: PreviewOverride | null;
  onPrint: () => void;
  onForceReprint: () => void;
  /** 状态条上的直达按钮：打开配置中心的对应页面。 */
  onOpenPage: (page: ConfigPage) => void;
}

export function PreviewStage({
  toolbar,
  scan,
  view,
  override,
  onPrint,
  onForceReprint,
  onOpenPage,
}: PreviewStageProps) {
  const { link } = view.status;
  const html = override ? override.html : (scan?.preview.html ?? null);
  const isQrOmitted = override ? override.qrOmitted : (scan?.preview.qrOmitted ?? false);
  const feedKey = override ? `override-${override.feedKey}` : `scan-${scan?.seq ?? 0}`;

  return (
    <section className={`preview-stage tone--${view.status.tone}`} aria-label="标签预览">
      {toolbar}
      <LabelPreview
        html={html}
        qrOmitted={isQrOmitted}
        feedKey={feedKey}
        maxScale={MAX_PREVIEW_SCALE}
        placeholder={
          scan ? '这次扫码无法生成标签' : `扫码后在这里预览 ${LABEL_PAPER_MM.width}×${LABEL_PAPER_MM.height} 标签`
        }
      />
      <div className="status-strip" role="status" aria-live="polite">
        <div className="status-strip__text">
          <strong className="status-strip__title">{view.status.title}</strong>
          <span className="status-strip__detail">{view.status.detail}</span>
        </div>
        <div className="status-strip__actions">
          {link && (
            <button type="button" className="button button--quiet" onClick={() => onOpenPage(link.page)}>
              {link.label}
            </button>
          )}
          {view.actions.forceReprint && (
            <ConfirmButton
              key={scan?.seq}
              label="强制补打"
              confirmLabel="再点一次确认补打"
              onConfirm={onForceReprint}
            />
          )}
          {view.actions.print && (
            <button type="button" className="button button--primary button--large" onClick={onPrint}>
              {view.actions.print === 'retry' ? '重试打印' : '打印'}
              <kbd>F2</kbd>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
