import { type CSSProperties, useRef } from 'react';
import { LABEL_PAPER_MM } from '../../../shared/label-paper';
import type { ScanView } from '../lib/status-text';
import { useFitScale } from '../view-models/use-fit-scale';
import type { ScanState } from '../view-models/use-scan-station';
import { ConfirmButton } from './ConfirmButton';
import { RULER_DEPTH_MM, Ruler } from './Ruler';

const MAX_PREVIEW_SCALE = 2.8;

export interface PreviewOverride {
  html: string | null;
  /** 显示在预览角上的说明，例如「模板编辑中」「示例」。 */
  badge: string;
}

interface PreviewStageProps {
  scan: ScanState | null;
  view: ScanView;
  override: PreviewOverride | null;
  onPrint: () => void;
  onForceReprint: () => void;
}

export function PreviewStage({ scan, view, override, onPrint, onForceReprint }: PreviewStageProps) {
  const benchRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(
    benchRef,
    LABEL_PAPER_MM.width + RULER_DEPTH_MM,
    LABEL_PAPER_MM.height + RULER_DEPTH_MM,
    MAX_PREVIEW_SCALE,
  );
  const html = override ? override.html : (scan?.preview.html ?? null);
  const feedKey = override ? `override-${override.badge}` : `scan-${scan?.seq ?? 0}`;

  return (
    <section className={`preview-stage tone--${view.status.tone}`} aria-label="标签预览">
      <div ref={benchRef} className="preview-stage__bench" style={{ '--preview-scale': scale } as CSSProperties}>
        <div className="tape">
          <div className="tape__corner" aria-hidden="true">
            mm
          </div>
          <Ruler orientation="horizontal" lengthMm={LABEL_PAPER_MM.width} />
          <Ruler orientation="vertical" lengthMm={LABEL_PAPER_MM.height} />
          <div className="label-slot">
            {override && <span className="label-badge">{override.badge}</span>}
            {html ? (
              <div key={feedKey} className="label-feed">
                <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
              </div>
            ) : (
              <p className="label-placeholder">
                {scan
                  ? '这个二维码无法生成标签'
                  : `扫码后在这里预览 ${LABEL_PAPER_MM.width}×${LABEL_PAPER_MM.height} 标签`}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="status-strip" role="status" aria-live="polite">
        <div className="status-strip__text">
          <strong className="status-strip__title">{view.status.title}</strong>
          <span className="status-strip__detail">{view.status.detail}</span>
        </div>
        <div className="status-strip__actions">
          {view.actions.forceReprint && (
            <ConfirmButton
              key={scan?.seq}
              label="强制补打"
              confirmLabel="再点一次确认补打"
              onConfirm={onForceReprint}
            />
          )}
          {view.actions.print && (
            <button type="button" className="button button--primary" onClick={onPrint}>
              {view.actions.print === 'retry' ? '重试打印' : '打印'}
              <kbd>F2</kbd>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
