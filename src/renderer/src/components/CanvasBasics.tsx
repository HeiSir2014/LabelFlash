import type { CanvasTemplate } from '../../../core/templates/canvas-model';
import { type PrinterChoices, TemplateBasics } from './TemplateBasics';

interface CanvasBasicsProps extends PrinterChoices {
  draft: CanvasTemplate;
  onChange: (draft: CanvasTemplate) => void;
}

/** 自由设计模板在设计器做好之前：能改名称、纸张、打印机，元素先用内置示例里的。 */
export function CanvasBasics({ draft, onChange, printers, paperPrinters }: CanvasBasicsProps) {
  return (
    <>
      <TemplateBasics draft={draft} onChange={onChange} printers={printers} paperPrinters={paperPrinters} />
      <p className="form-hint">
        自由设计模板的设计器（拖放元素、对齐、条码、图片、表格）在下一步提供；现在可以预览、打印和改纸张。
      </p>
    </>
  );
}
