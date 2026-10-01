import { type CSSProperties, useRef } from 'react';
import type { PaperSize } from '../../../shared/paper-sizes';
import { type RenderWarnings, renderWarningTexts } from '../../../shared/render-warnings';
import { useFitScale } from '../view-models/use-fit-scale';
import { RULER_DEPTH_MM, Ruler } from './Ruler';

interface LabelPreviewProps {
  /** 与实际打印相同的标签 HTML；null 时显示 placeholder。 */
  html: string | null;
  /** 生成时发现的问题（二维码、条码放不下，格子被截断）：贴在标签底边。 */
  warnings: RenderWarnings;
  /** 换了一张标签就换一个值：标签做一次「出纸」动画。 */
  feedKey: string;
  /** 放大倍数上限：容器很大时标签也不会大得失真。 */
  maxScale: number;
  placeholder: string;
  /** 模板的纸张：软尺刻度和标签框按它的实际毫米数。 */
  paper: PaperSize;
}

/** 软尺框住的标签（按模板纸张），按容器大小等比缩放。工作台和配置中心共用。 */
export function LabelPreview({ html, warnings, feedKey, maxScale, placeholder, paper }: LabelPreviewProps) {
  const warningText = renderWarningTexts(warnings).join('；');
  const benchRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(benchRef, paper.widthMm + RULER_DEPTH_MM, paper.heightMm + RULER_DEPTH_MM, maxScale);

  return (
    <div
      ref={benchRef}
      className="label-preview"
      style={{ '--preview-scale': scale, '--paper-w': paper.widthMm, '--paper-h': paper.heightMm } as CSSProperties}
    >
      <div className="tape">
        <div className="tape__corner" aria-hidden="true">
          mm
        </div>
        <Ruler orientation="horizontal" lengthMm={paper.widthMm} />
        <Ruler orientation="vertical" lengthMm={paper.heightMm} />
        <div className="label-slot">
          {html && warningText !== '' && <span className="label-badge">{warningText}</span>}
          {html ? (
            <div key={feedKey} className="label-feed">
              <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
            </div>
          ) : (
            <p className="label-placeholder">{placeholder}</p>
          )}
        </div>
      </div>
    </div>
  );
}
