import { useId } from 'react';
import { CROP_CHOICES, cropLabel, type PaperOption } from '../../lib/pdf-view';
import type { PdfViewModel } from '../../view-models/use-pdf';

interface PdfSetupProps {
  pdf: PdfViewModel;
  paperOptions: readonly PaperOption[];
}

/** 纸张、裁切方式、转黑白：改了就重新出块（阈值停下 0.3 秒再出）。打印中锁住。 */
export function PdfSetup({ pdf, paperOptions }: PdfSetupProps) {
  const titleId = useId();
  const detected = pdf.pdfFile?.detected ?? null;
  const hint = CROP_CHOICES.find((choice) => choice.mode === pdf.layout.crop)?.hint ?? '';
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        纸张和裁切
      </h2>
      <div className="pdf-setup">
        <label className="pdf-setup__row">
          <span className="pdf-setup__label">纸张</span>
          <select
            className="select-field"
            aria-label="纸张"
            value={pdf.layout.paperKey}
            disabled={pdf.isPrinting}
            onChange={(event) => pdf.changeLayout({ paperKey: event.target.value })}
          >
            {paperOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="pdf-setup__choices" disabled={pdf.isPrinting}>
          <legend className="pdf-setup__label">裁切方式</legend>
          {CROP_CHOICES.map((choice) => (
            <label key={choice.mode} className="pdf-setup__choice" title={choice.hint}>
              <input
                type="radio"
                name="pdf-crop"
                checked={pdf.layout.crop === choice.mode}
                onChange={() => pdf.changeLayout({ crop: choice.mode })}
              />
              {cropLabel(choice.mode, detected)}
            </label>
          ))}
        </fieldset>
        <p className="pdf-setup__hint">{hint}</p>
        <fieldset className="pdf-setup__choices" disabled={pdf.isPrinting}>
          <legend className="pdf-setup__label">转黑白</legend>
          <label className="pdf-setup__choice">
            <input
              type="radio"
              name="pdf-mono"
              checked={pdf.layout.mono === 'threshold'}
              onChange={() => pdf.changeLayout({ mono: 'threshold' })}
            />
            阈值（文字、条码）
          </label>
          <label className="pdf-setup__choice">
            <input
              type="radio"
              name="pdf-mono"
              checked={pdf.layout.mono === 'dither'}
              onChange={() => pdf.changeLayout({ mono: 'dither' })}
            />
            抖动（照片）
          </label>
          <label className="pdf-setup__threshold">
            深浅
            <input
              type="range"
              aria-label="阈值"
              min={1}
              max={254}
              value={pdf.layout.threshold}
              onChange={(event) => pdf.changeLayout({ threshold: Number(event.target.value) })}
            />
            <span className="pdf-setup__value">{pdf.layout.threshold}</span>
          </label>
        </fieldset>
      </div>
    </section>
  );
}
